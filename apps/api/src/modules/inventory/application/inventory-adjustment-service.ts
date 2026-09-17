/**
 * Stock adjustments routed through the existing maker-checker tables
 * (P1-32-PRE-046).
 *
 * `inv.stock_adjustments`, `inv.stock_adjustment_details` and
 * `inv.approve_adjustment` shipped in Phase 1-10 with no operation over them, so a
 * quantity correction could only arrive through an opening batch. This service
 * requests an adjustment (pending, no stock effect) and records a second person's
 * decision on it. Only an APPROVAL posts a movement, through the protected function,
 * and only after `inv.guard_adjustment_approval` has confirmed the approver is not
 * the requester.
 *
 * ## Why the maker-checker rule is checked here as well as in the database
 *
 * The trigger refuses a self-approval with a `check_violation`, which the shared
 * mapper can only report as "would break a stock invariant" — true, and useless to
 * the person reading it. Asking first lets the refusal say what actually happened.
 * The database stays the guarantee; `inv.reject_adjustment` applies the same rule
 * to rejections, which the trigger alone did not cover.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { pageRequest, type Page } from '@/server/db/pagination';
import { callerHoldsPermission, type ScopeAuthorizer } from '@/server/auth/authorization';
import type { DbHandle } from '@/server/db/transaction';
import {
  ADJUSTMENT_ORDER,
  type AdjustmentListRow,
  type AdjustmentRow,
  type InventoryRepository,
} from '../data/inventory-repository';
import { assertLegalMovementReference, type AdjustmentDecision } from '../domain/inventory';
import { parseQuantity, toDomainFailure } from './inventory-failures';
import type { InventoryStockService } from './inventory-stock-service';

/** `numeric(18, 4)` value impact; may be negative, because a write-down is one. */
const VALUE_IMPACT_LITERAL = /^-?\d{1,14}(\.\d{1,4})?$/;

export interface AdjustmentView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly direction: string;
  readonly quantity: string;
  readonly reason: string;
  readonly status: string;
  readonly requestedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
}

export interface AdjustmentListView extends AdjustmentView {
  readonly sku: string;
  readonly locationCode: string;
}

const toAdjustmentView = (row: AdjustmentRow): AdjustmentView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  itemId: row.itemId,
  locationId: row.locationId,
  direction: row.direction,
  quantity: row.quantity,
  reason: row.reason,
  status: row.status,
  requestedBy: row.requestedBy,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
  recordVersion: row.recordVersion,
  createdAt: row.createdAt.toISOString(),
});

const toAdjustmentListView = (row: AdjustmentListRow): AdjustmentListView => ({
  ...toAdjustmentView(row),
  sku: row.sku,
  locationCode: row.locationCode,
});

export class InventoryAdjustmentService {
  public constructor(
    private readonly repository: InventoryRepository,
    private readonly stock: InventoryStockService
  ) {}

  /**
   * Requests an adjustment. Pending, and moves nothing.
   *
   * The location's own company and branch must match the pair the caller named and
   * was authorized for; otherwise a caller authorized in one branch could raise an
   * adjustment against another branch's shelf by naming its location.
   */
  public async request(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId: string;
      readonly locationId: string;
      readonly direction: string;
      readonly quantity: string;
      readonly reason: string;
      readonly valueImpact?: string;
      readonly currencyCode?: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<AdjustmentView> {
    await authorizeScope({ companyId: input.companyId, branchId: input.branchId });
    const quantity = parseQuantity(input.quantity);

    const location = await this.stock.requireLocation(db, input.locationId);
    if (location.companyId !== input.companyId || location.branchId !== input.branchId) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'locationId names a different company or branch from the one authorized',
        safeDetails: { violations: [{ path: 'body.locationId', rule: 'custom' }] },
      });
    }
    if (location.locationType === 'transit') {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `Stock location ${location.locationCode} holds transfers in transit; receive or ` +
          'cancel the transfer instead of adjusting it',
      });
    }
    await this.stock.requireStockTrackedItem(db, input.itemId);

    if ((input.valueImpact === undefined) !== (input.currencyCode === undefined)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A value impact and its currency must be given together',
        safeDetails: { violations: [{ path: 'body.currencyCode', rule: 'custom' }] },
      });
    }
    if (input.valueImpact !== undefined) {
      if (!VALUE_IMPACT_LITERAL.test(input.valueImpact)) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'A value impact must be a decimal with at most four decimal places',
          safeDetails: { violations: [{ path: 'body.valueImpact', rule: 'custom' }] },
        });
      }
      const mayCost = await callerHoldsPermission(db, 'inv.cost.view', {
        companyId: input.companyId,
        branchId: input.branchId,
      });
      if (!mayCost) {
        throw new AppFailure('ERR-VAL-001', {
          message:
            'A value impact may be recorded only by someone permitted to view inventory cost.',
          safeDetails: { violations: [{ path: 'body.valueImpact', rule: 'custom' }] },
        });
      }
    }

    let adjustmentId: string;
    try {
      const created = await this.repository.createAdjustment(db, {
        companyId: input.companyId,
        branchId: input.branchId,
        itemId: input.itemId,
        locationId: input.locationId,
        direction: input.direction,
        quantity: quantity.toString(),
        reason: input.reason,
      });
      adjustmentId = created.id;
      if (input.valueImpact !== undefined && input.currencyCode !== undefined) {
        await this.repository.createAdjustmentDetail(db, {
          companyId: input.companyId,
          branchId: input.branchId,
          adjustmentId,
          valueImpact: input.valueImpact,
          currencyCode: input.currencyCode,
        });
      }
    } catch (error) {
      toDomainFailure(error, 'Stock adjustment');
    }

    const adjustment = await this.requireAdjustment(db, adjustmentId);
    await appendAudit(db, {
      action: 'inv.stock_adjustment.requested',
      entityType: 'inv.stock_adjustment',
      entityId: adjustment.id,
      companyId: adjustment.companyId,
      branchId: adjustment.branchId,
      requestRef: 'inv.stock-adjustment-create',
      details: [
        { field: 'itemId', classification: 'internal', value: adjustment.itemId },
        { field: 'locationId', classification: 'internal', value: adjustment.locationId },
        { field: 'direction', classification: 'internal', value: adjustment.direction },
        { field: 'quantity', classification: 'internal', value: adjustment.quantity },
        { field: 'reason', classification: 'internal', value: adjustment.reason },
        {
          field: 'valueImpact',
          classification: 'restricted',
          value: input.valueImpact ?? null,
        },
      ],
    });
    return toAdjustmentView(adjustment);
  }

  /**
   * Records a checker's decision on a pending adjustment.
   *
   * An approval posts the movement through `inv.approve_adjustment`; a rejection
   * moves nothing. An `out` approval may release reservations at the cell through
   * `inv.free_reservations_for_loss` — the approved correction is a loss that has
   * already happened — and each release is audited and published exactly as the
   * damage path does, so the same state change is attributable however it arose.
   */
  public async decide(
    db: DbHandle,
    adjustmentId: string,
    input: { readonly decision: AdjustmentDecision; readonly reason: string },
    authorizeScope: ScopeAuthorizer
  ): Promise<AdjustmentView> {
    const before = await this.repository.lockAdjustment(db, adjustmentId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Stock adjustment ${adjustmentId} was not found`,
      });
    }
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    if (before.status !== 'pending') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Stock adjustment ${adjustmentId} is ${before.status} and has already been decided`,
      });
    }
    if (before.requestedBy === db.context.principal.userId) {
      throw new AppFailure('ERR-TRN-001', {
        message:
          'The person who requested a stock adjustment may not decide it. Ask another ' +
          'approver to review the request.',
      });
    }

    const reservationsBefore =
      input.decision === 'approved' && before.direction === 'out'
        ? await this.repository.activeReservationsAt(db, before.itemId, before.locationId)
        : [];

    try {
      if (input.decision === 'approved') {
        assertLegalMovementReference('adjustment', 'adjustment', before.direction);
        await this.repository.approveAdjustment(db, adjustmentId);
      } else {
        await this.repository.rejectAdjustment(db, adjustmentId);
      }
    } catch (error) {
      toDomainFailure(error, 'Stock adjustment decision');
    }

    if (input.decision === 'approved') {
      for (const reservation of reservationsBefore) {
        const after = await this.repository.readReservation(db, reservation.id);
        if (after && after.status === 'active') continue;
        await appendAudit(db, {
          action: 'inv.stock.reservation_released',
          entityType: 'inv.stock_reservation',
          entityId: reservation.id,
          companyId: reservation.companyId,
          branchId: reservation.branchId,
          requestRef: 'inv.stock-adjustment-approve',
          details: [
            {
              field: 'status',
              classification: 'internal',
              previousValue: 'active',
              value: 'released',
            },
            { field: 'reason', classification: 'internal', value: 'stock_loss' },
            { field: 'quantity', classification: 'internal', value: reservation.quantity },
            { field: 'adjustmentId', classification: 'internal', value: adjustmentId },
          ],
        });
        await publishEvent(db, {
          eventType: 'stock.reservation.released',
          aggregateId: reservation.id,
          aggregateVersion: reservation.recordVersion,
          producer: 'inventory.inventory-adjustment-service',
          companyId: reservation.companyId,
          branchId: reservation.branchId,
          eventKey: `stock.reservation.released:${reservation.id}`,
          payload: {
            reservationId: reservation.id,
            itemId: reservation.itemId,
            locationId: reservation.locationId,
            quantity: reservation.quantity,
            reason: 'stock_loss',
          },
        });
      }
      await this.stock.publishPostedMovements(db, 'adjustment', adjustmentId);
    }

    const after = await this.requireAdjustment(db, adjustmentId);
    await appendAudit(db, {
      action:
        input.decision === 'approved'
          ? 'inv.stock_adjustment.approved'
          : 'inv.stock_adjustment.rejected',
      entityType: 'inv.stock_adjustment',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'inv.stock-adjustment-approve',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        { field: 'decisionReason', classification: 'internal', value: input.reason },
        { field: 'requestedBy', classification: 'internal', value: after.requestedBy },
      ],
    });
    return toAdjustmentView(after);
  }

  public async list(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
      readonly itemId?: string | undefined;
      readonly locationId?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<AdjustmentListView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listAdjustments(
      db,
      filter,
      pageRequest(ADJUSTMENT_ORDER, page)
    );
    return { ...result, items: result.items.map(toAdjustmentListView) };
  }

  private async requireAdjustment(db: DbHandle, adjustmentId: string): Promise<AdjustmentRow> {
    const row = await this.repository.readAdjustment(db, adjustmentId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'Stock adjustment vanished after it was written',
      });
    }
    return row;
  }
}
