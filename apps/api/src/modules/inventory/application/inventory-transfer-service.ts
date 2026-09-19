/**
 * Stock transfers between locations, with an in-transit interval
 * (P1-32-PRE-040…042).
 *
 * A transfer is two paired postings separated in time. Dispatch moves the quantity
 * OUT of the source cell and IN to the source branch's `transit` location; receipt
 * moves it OUT of transit and IN to the destination; cancellation moves it OUT of
 * transit and back IN to the origin. At every instant the quantity is in exactly one
 * cell, so no read can see it twice and no read can see it vanish.
 *
 * ## Where the guarantees live
 *
 * In `inv.dispatch_transfer`, `inv.receive_transfer` and `inv.cancel_transfer`,
 * which take the balance-row lock, check availability INSIDE it, and post the
 * movements that `inv.guard_stock_movement_provenance` binds to the transfer's own
 * quantity and locations. This service adds only what those functions cannot state
 * readably — which endpoints are legal, and who may act at each end.
 *
 * ## A receipt records what arrived (P1-32-PRE-130)
 *
 * A receipt states the quantity that physically arrived, which may be less than was
 * dispatched. The remainder stays in transit — a real balance in the source branch's
 * transit location, out of the origin's availability and not yet in the
 * destination's — until a further receipt, a return to the origin with a reason, or
 * a write-off with a reason that posts only when a second person approves it
 * (`inv.stock_transfer_settlements`). Units that arrived damaged were received; they
 * go to quarantine through the damage path, not through a write-off.
 *
 * ## Who may receive
 *
 * The row is owned by the SOURCE branch, and the settlement posts an `out` leg in
 * the source branch's transit location and an `in` leg at the destination. Both
 * movements are branch-scoped by RLS, so a receipt is authorized in BOTH branches.
 * For the common case — a transfer inside one branch — that is one check. For a
 * cross-branch transfer it means the receiver must hold `inv.stock.operate` at both
 * ends; a two-party handshake in which each branch acts only on its own side is not
 * part of this slice, and the database would refuse the half that crossed a scope
 * the actor does not hold.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { pageRequest, type Page } from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';
import { callerHoldsPermission, type ScopeAuthorizer } from '@/server/auth/authorization';
import {
  TRANSFER_ORDER,
  TRANSFER_SETTLEMENT_ORDER,
  type InventoryRepository,
  type TransferListRow,
  type TransferRow,
  type TransferSettlementDecisionFilter,
  type TransferSettlementListRow,
  type TransferSettlementRow,
} from '../data/inventory-repository';
import {
  Quantity,
  assertLegalMovementReference,
  assertTransferEndpoints,
} from '../domain/inventory';
import { parseQuantity, toDomainFailure } from './inventory-failures';
import type { InventoryStockService } from './inventory-stock-service';

export interface TransferView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId: string;
  readonly fromLocationId: string;
  readonly transitLocationId: string;
  readonly toBranchId: string;
  readonly toLocationId: string;
  /** Exact decimal strings, never numbers. */
  readonly quantity: string;
  readonly receivedQuantity: string | null;
  /** Units that did not arrive and were returned to the origin or written off. */
  readonly resolvedQuantity: string;
  /** Dispatched less received less resolved: what is still in the transit location. */
  readonly outstandingQuantity: string;
  readonly status: string;
  /** True while any of the quantity sits in the transit location. */
  readonly inTransit: boolean;
  readonly reason: string | null;
  readonly cancelReason: string | null;
  readonly dispatchedAt: string;
  readonly receivedAt: string | null;
  readonly cancelledAt: string | null;
  readonly recordVersion: number;
  /** True when an idempotent replay returned the transfer that already existed. */
  readonly replayed: boolean;
}

export interface TransferListView extends Omit<TransferView, 'replayed'> {
  readonly sku: string;
  /** Null when that end's location is outside what the reader may see. */
  readonly fromLocationCode: string | null;
  readonly toLocationCode: string | null;
  readonly createdAt: string;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function toTransferView(row: TransferRow, replayed: boolean): TransferView {
  return {
    id: row.id,
    companyId: row.companyId,
    branchId: row.branchId,
    itemId: row.itemId,
    fromLocationId: row.fromLocationId,
    transitLocationId: row.transitLocationId,
    toBranchId: row.toBranchId,
    toLocationId: row.toLocationId,
    quantity: row.quantity,
    receivedQuantity: row.receivedQuantity,
    resolvedQuantity: row.resolvedQuantity,
    outstandingQuantity: row.outstandingQuantity,
    status: row.status,
    inTransit: row.status === 'dispatched' || row.status === 'partially_received',
    reason: row.reason,
    cancelReason: row.cancelReason,
    dispatchedAt: row.dispatchedAt.toISOString(),
    receivedAt: iso(row.receivedAt),
    cancelledAt: iso(row.cancelledAt),
    recordVersion: row.recordVersion,
    replayed,
  };
}

function toTransferListView(row: TransferListRow): TransferListView {
  const { replayed: _replayed, ...view } = toTransferView(row, false);
  return {
    ...view,
    sku: row.sku,
    fromLocationCode: row.fromLocationCode,
    toLocationCode: row.toLocationCode,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One act that took units of a transfer out of transit. */
export interface TransferSettlementView {
  readonly id: string;
  readonly transferId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly toBranchId: string;
  /** `receipt`, `return_to_origin` or `write_off`. */
  readonly kind: string;
  readonly quantity: string;
  readonly reason: string | null;
  /** `posted`, or `pending` / `rejected` for a write-off awaiting or refused a decision. */
  readonly status: string;
  readonly requestedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
}

/**
 * A discrepancy settlement as a reader of either branch sees it
 * (`inv.stock-transfer-settlement-list`, `inv.stock-transfer-settlement-read`).
 */
export interface TransferSettlementReadView extends TransferSettlementView {
  readonly itemId: string;
  readonly sku: string;
  /**
   * `pending` or `rejected` for a write-off in that status, `approved` for a write-off
   * a second person approved, and `null` for a return to the origin, which posts at
   * once and is never decided.
   */
  readonly decision: 'pending' | 'approved' | 'rejected' | null;
  /** Who approved or rejected a write-off, and when; `null` until it is decided. */
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
}

function decisionOf(row: TransferSettlementRow): TransferSettlementReadView['decision'] {
  if (row.kind !== 'write_off') return null;
  if (row.status === 'pending') return 'pending';
  if (row.status === 'rejected') return 'rejected';
  return row.approvedAt === null ? null : 'approved';
}

function toSettlementReadView(row: TransferSettlementListRow): TransferSettlementReadView {
  return {
    ...toSettlementView(row),
    itemId: row.itemId,
    sku: row.sku,
    decision: decisionOf(row),
    decidedBy: row.approvedBy ?? row.rejectedBy,
    decidedAt: iso(row.approvedAt ?? row.rejectedAt),
  };
}

/** `inv.stock.read`: the code both settlement reads declare. */
const STOCK_READ = 'inv.stock.read';

/** A settlement with the transfer as it stands after it. */
export interface TransferSettlementWriteView extends TransferSettlementView {
  readonly transfer: TransferView;
  /** True when an idempotent replay returned the settlement that already existed. */
  readonly replayed: boolean;
}

function toSettlementView(row: TransferSettlementRow): TransferSettlementView {
  return {
    id: row.id,
    transferId: row.transferId,
    companyId: row.companyId,
    branchId: row.branchId,
    toBranchId: row.toBranchId,
    kind: row.kind,
    quantity: row.quantity,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    rejectedBy: row.rejectedBy,
    rejectedAt: iso(row.rejectedAt),
    recordVersion: row.recordVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export class InventoryTransferService {
  public constructor(
    private readonly repository: InventoryRepository,
    private readonly stock: InventoryStockService
  ) {}

  /**
   * Dispatches a transfer: source cell -> transit.
   *
   * Both ends are authorized before anything is written. The source because the
   * stock leaves it; the destination because naming a location is naming a branch,
   * and a caller who could send stock into a branch they hold no authority in could
   * use a transfer to place quantity where they cannot otherwise act.
   */
  public async dispatch(
    db: DbHandle,
    input: {
      readonly itemId: string;
      readonly fromLocationId: string;
      readonly toLocationId: string;
      readonly quantity: string;
      readonly reason?: string;
      readonly idempotencyKey?: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<TransferView> {
    const quantity = parseQuantity(input.quantity);
    assertLegalMovementReference('transfer', 'transfer_dispatch', 'out');
    assertLegalMovementReference('transfer', 'transfer_dispatch', 'in');

    const from = await this.stock.requireLocation(db, input.fromLocationId);
    const to = await this.stock.requireLocation(db, input.toLocationId);
    await authorizeScope({ companyId: from.companyId, branchId: from.branchId });
    await authorizeScope({ companyId: to.companyId, branchId: to.branchId });
    try {
      assertTransferEndpoints(from, to);
    } catch (error) {
      toDomainFailure(error, 'Transfer');
    }
    await this.stock.requireStockTrackedItem(db, input.itemId);

    // Detected BEFORE the call, for the reason `reserve` records: the function
    // returns an existing transfer for a replayed key, which from the outside is
    // indistinguishable from moving the stock a second time.
    const existing =
      input.idempotencyKey === undefined
        ? null
        : await this.repository.readTransferByIdempotencyKey(db, input.idempotencyKey);
    if (existing) {
      if (
        existing.itemId !== input.itemId ||
        existing.fromLocationId !== input.fromLocationId ||
        existing.toLocationId !== input.toLocationId ||
        !Quantity.fromDatabase(existing.quantity, 'quantity').equals(quantity)
      ) {
        throw new AppFailure('ERR-INT-001', {
          message:
            'This idempotency key already dispatched a different transfer. Reuse a key only ' +
            'for an identical request.',
        });
      }
      return toTransferView(existing, true);
    }

    let transferId: string;
    try {
      const created = await this.repository.dispatchTransfer(db, {
        itemId: input.itemId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        quantity: quantity.toString(),
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: db.context.correlationId,
      });
      transferId = created.id;
    } catch (error) {
      toDomainFailure(error, 'Transfer');
    }

    const transfer = await this.requireTransfer(db, transferId);
    await this.stock.publishPostedMovements(db, 'transfer_dispatch', transfer.id);
    await appendAudit(db, {
      action: 'inv.stock_transfer.dispatched',
      entityType: 'inv.stock_transfer',
      entityId: transfer.id,
      companyId: transfer.companyId,
      branchId: transfer.branchId,
      requestRef: 'inv.stock-transfer-create',
      details: [
        { field: 'itemId', classification: 'internal', value: transfer.itemId },
        { field: 'fromLocationId', classification: 'internal', value: transfer.fromLocationId },
        { field: 'toLocationId', classification: 'internal', value: transfer.toLocationId },
        { field: 'toBranchId', classification: 'internal', value: transfer.toBranchId },
        { field: 'quantity', classification: 'internal', value: transfer.quantity },
        { field: 'reason', classification: 'internal', value: transfer.reason },
      ],
    });
    return toTransferView(transfer, false);
  }

  /**
   * Receives what arrived of a transfer: transit -> destination.
   *
   * The whole dispatched quantity of an untouched transfer settles it as one pair,
   * exactly as before. Any other quantity up to what is still outstanding is a part
   * settlement, and the transfer is `partially_received` while anything remains.
   *
   * The transfer is LOCKED before the status is read, so two concurrent receipts of
   * one transfer serialize and the second sees the first — neither can take units
   * the other already received.
   */
  public async receive(
    db: DbHandle,
    transferId: string,
    input: { readonly quantity: string },
    authorizeScope: ScopeAuthorizer
  ): Promise<TransferView> {
    const quantity = parseQuantity(input.quantity);
    // Read, authorize, THEN lock. A destination-branch caller can SEE the transfer
    // (`sel_stock_transfers_destination`) but a `FOR UPDATE` evaluates the UPDATE
    // policy too, which is scoped to the source branch — so locking first would
    // answer that caller "not found" for a row it can list. Authorizing on the
    // unlocked read gives it the honest 403, and the lock then re-reads the status
    // the decision actually rests on.
    const visible = await this.readTransferOrFail(db, transferId);
    await authorizeScope({ companyId: visible.companyId, branchId: visible.branchId });
    await authorizeScope({ companyId: visible.companyId, branchId: visible.toBranchId });
    const before = await this.lockTransferOrFail(db, transferId);

    if (before.status !== 'dispatched' && before.status !== 'partially_received') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Transfer ${transferId} is ${before.status} and can no longer be received`,
      });
    }
    if (quantity.isGreaterThan(Quantity.fromDatabase(before.outstandingQuantity, 'outstanding'))) {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `The received quantity ${quantity.toString()} exceeds the ${before.outstandingQuantity} ` +
          'still in transit. Record only what arrived.',
      });
    }

    try {
      await this.repository.receiveTransfer(db, {
        transferId,
        quantity: quantity.toString(),
        correlationId: db.context.correlationId,
      });
    } catch (error) {
      toDomainFailure(error, 'Transfer receipt');
    }

    const after = await this.requireTransfer(db, transferId);
    // A whole-transfer receipt cites the transfer; a part receipt cites the
    // settlement row it wrote, and its movements are published under that id.
    const settlement = await this.repository.readReceiptSettlementOfThisTransaction(db, transferId);
    await this.stock.publishPostedMovements(db, 'transfer_receipt', settlement?.id ?? after.id);
    await appendAudit(db, {
      action: 'inv.stock_transfer.received',
      entityType: 'inv.stock_transfer',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'inv.stock-transfer-receive',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        { field: 'quantity', classification: 'internal', value: quantity.toString() },
        { field: 'receivedQuantity', classification: 'internal', value: after.receivedQuantity },
        {
          field: 'outstandingQuantity',
          classification: 'internal',
          value: after.outstandingQuantity,
        },
        { field: 'settlementId', classification: 'internal', value: settlement?.id ?? null },
        { field: 'toLocationId', classification: 'internal', value: after.toLocationId },
      ],
    });
    return toTransferView(after, false);
  }

  /**
   * Settles units that did not arrive: back to the origin, or a write-off.
   *
   * A return to the origin posts at once. A write-off is born PENDING and moves
   * nothing until a second person approves it, but it claims its quantity at once, so
   * the same units cannot also be received or returned meanwhile. Both legs of either
   * act post in the SOURCE branch — out of its transit location, and for a return
   * back into the origin — so the source branch is the one authorized.
   */
  public async resolveDiscrepancy(
    db: DbHandle,
    transferId: string,
    input: {
      readonly kind: 'return_to_origin' | 'write_off';
      readonly quantity: string;
      readonly reason: string;
      readonly idempotencyKey?: string | undefined;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<TransferSettlementWriteView> {
    const quantity = parseQuantity(input.quantity);
    const visible = await this.readTransferOrFail(db, transferId);
    await authorizeScope({ companyId: visible.companyId, branchId: visible.branchId });

    const existing =
      input.idempotencyKey === undefined
        ? null
        : await this.repository.readTransferSettlementByIdempotencyKey(db, input.idempotencyKey);
    if (existing) {
      if (
        existing.transferId !== transferId ||
        existing.kind !== input.kind ||
        !Quantity.fromDatabase(existing.quantity, 'quantity').equals(quantity)
      ) {
        throw new AppFailure('ERR-INT-001', {
          message:
            'This idempotency key already settled a different discrepancy. Reuse a key only ' +
            'for an identical request.',
        });
      }
      const transfer = await this.requireTransfer(db, transferId);
      return {
        ...toSettlementView(existing),
        transfer: toTransferView(transfer, true),
        replayed: true,
      };
    }

    const before = await this.lockTransferOrFail(db, transferId);
    if (before.status !== 'dispatched' && before.status !== 'partially_received') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Transfer ${transferId} is ${before.status} and has nothing in transit`,
      });
    }
    if (quantity.isGreaterThan(Quantity.fromDatabase(before.outstandingQuantity, 'outstanding'))) {
      throw new AppFailure('ERR-TRN-001', {
        message: `${quantity.toString()} exceeds the ${before.outstandingQuantity} still in transit`,
      });
    }

    let settlementId: string;
    try {
      const request = {
        transferId,
        quantity: quantity.toString(),
        reason: input.reason,
        idempotencyKey: input.idempotencyKey ?? null,
      };
      settlementId =
        input.kind === 'return_to_origin'
          ? await this.repository.returnTransferRemainder(db, request)
          : await this.repository.requestTransferWriteOff(db, request);
    } catch (error) {
      // `transfer_settlement_exceeded` counts a PENDING write-off too, which the
      // outstanding figure above does not subtract until it is approved.
      toDomainFailure(error, 'Transfer settlement');
    }

    const settlement = await this.requireSettlement(db, settlementId);
    if (settlement.status === 'posted') {
      await this.stock.publishPostedMovements(db, 'transfer_receipt', settlement.id);
    }
    const after = await this.requireTransfer(db, transferId);
    await appendAudit(db, {
      action: 'inv.stock_transfer.discrepancy_resolved',
      entityType: 'inv.stock_transfer_settlement',
      entityId: settlement.id,
      companyId: settlement.companyId,
      branchId: settlement.branchId,
      requestRef: 'inv.stock-transfer-discrepancy-resolve',
      details: [
        { field: 'transferId', classification: 'internal', value: transferId },
        { field: 'kind', classification: 'internal', value: settlement.kind },
        { field: 'quantity', classification: 'internal', value: settlement.quantity },
        { field: 'reason', classification: 'internal', value: settlement.reason },
        { field: 'settlementStatus', classification: 'internal', value: settlement.status },
        {
          field: 'transferStatus',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
      ],
    });
    return {
      ...toSettlementView(settlement),
      transfer: toTransferView(after, false),
      replayed: false,
    };
  }

  /**
   * A second person decides a pending write-off. Approval takes the units out of
   * transit; rejection leaves them there and frees the quantity for a receipt or a
   * return. `inv.adjustment.approve`, because a write-off is a stock loss and every
   * other stock loss is approved under that authority.
   */
  public async decideWriteOff(
    db: DbHandle,
    settlementId: string,
    input: { readonly decision: 'approved' | 'rejected'; readonly reason: string },
    authorizeScope: ScopeAuthorizer
  ): Promise<TransferSettlementWriteView> {
    const before = await this.repository.readTransferSettlement(db, settlementId);
    if (!before) {
      throw new AppFailure('ERR-RES-001', {
        message: `Transfer settlement ${settlementId} was not found`,
      });
    }
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    if (before.kind !== 'write_off' || before.status !== 'pending') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Settlement ${settlementId} is a ${before.kind} in status ${before.status}; only a pending write-off is decided`,
      });
    }
    if (before.requestedBy === db.context.principal.userId) {
      throw new AppFailure('ERR-TRN-001', {
        message:
          'The person who requested a write-off may not decide it. Ask another approver to ' +
          'review the request.',
      });
    }
    const transferBefore = await this.requireTransfer(db, before.transferId);
    try {
      await this.repository.decideTransferWriteOff(db, settlementId, input.decision === 'approved');
    } catch (error) {
      toDomainFailure(error, 'Write-off decision');
    }
    const settlement = await this.requireSettlement(db, settlementId);
    if (settlement.status === 'posted') {
      await this.stock.publishPostedMovements(db, 'transfer_receipt', settlement.id);
    }
    const after = await this.requireTransfer(db, before.transferId);
    await appendAudit(db, {
      action:
        input.decision === 'approved'
          ? 'inv.stock_transfer.write_off_approved'
          : 'inv.stock_transfer.write_off_rejected',
      entityType: 'inv.stock_transfer_settlement',
      entityId: settlement.id,
      companyId: settlement.companyId,
      branchId: settlement.branchId,
      requestRef: 'inv.stock-transfer-write-off-decide',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: settlement.status,
        },
        { field: 'quantity', classification: 'internal', value: settlement.quantity },
        { field: 'decisionReason', classification: 'internal', value: input.reason },
        { field: 'requestedBy', classification: 'internal', value: settlement.requestedBy },
        {
          field: 'transferStatus',
          classification: 'internal',
          previousValue: transferBefore.status,
          value: after.status,
        },
      ],
    });
    return {
      ...toSettlementView(settlement),
      transfer: toTransferView(after, false),
      replayed: false,
    };
  }

  /**
   * Cancels a dispatched transfer: transit -> back to the origin.
   *
   * Authorized in the SOURCE branch only. Both legs of a cancellation post there —
   * out of the source branch's transit location, in to the source location — so the
   * destination has no part in it and needs no authority over it.
   */
  public async cancel(
    db: DbHandle,
    transferId: string,
    input: { readonly reason: string },
    authorizeScope: ScopeAuthorizer
  ): Promise<TransferView> {
    const visible = await this.readTransferOrFail(db, transferId);
    await authorizeScope({ companyId: visible.companyId, branchId: visible.branchId });
    const before = await this.lockTransferOrFail(db, transferId);
    if (before.status !== 'dispatched') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Transfer ${transferId} is ${before.status} and can no longer be cancelled`,
      });
    }

    try {
      await this.repository.cancelTransfer(db, {
        transferId,
        reason: input.reason,
        correlationId: db.context.correlationId,
      });
    } catch (error) {
      toDomainFailure(error, 'Transfer cancellation');
    }

    const after = await this.requireTransfer(db, transferId);
    await this.stock.publishPostedMovements(db, 'transfer_receipt', after.id);
    await appendAudit(db, {
      action: 'inv.stock_transfer.cancelled',
      entityType: 'inv.stock_transfer',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'inv.stock-transfer-cancel',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        { field: 'cancelReason', classification: 'internal', value: after.cancelReason },
      ],
    });
    return toTransferView(after, false);
  }

  /**
   * One branch's transfers — the ones it sent, or the ones coming to it.
   *
   * The branch is authorized unconditionally, exactly as `readAvailability` does;
   * `direction` decides only which column the branch is matched on.
   */
  public async list(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly direction: 'outbound' | 'inbound';
      readonly status?: string | undefined;
      readonly itemId?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<TransferListView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listTransfers(
      db,
      filter,
      pageRequest(TRANSFER_ORDER, page)
    );
    return { ...result, items: result.items.map(toTransferListView) };
  }

  /**
   * One branch's returns to the origin and write-offs, whether it sent the transfer
   * or is its destination — the same two readers `inv.stock_transfers` admits. The
   * named branch is authorized unconditionally, as `list` does.
   */
  public async listSettlements(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly decision?: TransferSettlementDecisionFilter | undefined;
      readonly kind?: string | undefined;
      readonly transferId?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<TransferSettlementReadView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listTransferSettlements(
      db,
      filter,
      pageRequest(TRANSFER_SETTLEMENT_ORDER, page)
    );
    return { ...result, items: result.items.map(toSettlementReadView) };
  }

  /**
   * One settlement, for a reader of the source branch or of the destination branch.
   *
   * RLS already shows the row to either (`sel_stock_transfer_settlements_scope` and
   * `..._destination`), so the decisive check is which branch the caller reads in:
   * the source when the caller holds `inv.stock.read` there, otherwise the
   * destination, whose `authorizeScope` refuses a caller who holds it in neither.
   */
  public async readSettlement(
    db: DbHandle,
    settlementId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<TransferSettlementReadView> {
    const row = await this.repository.readTransferSettlementDetail(db, settlementId);
    if (!row || row.kind === 'receipt') {
      throw new AppFailure('ERR-RES-001', {
        message: `Transfer settlement ${settlementId} was not found`,
      });
    }
    const source = { companyId: row.companyId, branchId: row.branchId };
    if (await callerHoldsPermission(db, STOCK_READ, source)) {
      await authorizeScope(source);
    } else {
      await authorizeScope({ companyId: row.companyId, branchId: row.toBranchId });
    }
    return toSettlementReadView(row);
  }

  private async readTransferOrFail(db: DbHandle, transferId: string): Promise<TransferRow> {
    const row = await this.repository.readTransfer(db, transferId);
    if (!row) {
      throw new AppFailure('ERR-RES-001', { message: `Transfer ${transferId} was not found` });
    }
    return row;
  }

  private async lockTransferOrFail(db: DbHandle, transferId: string): Promise<TransferRow> {
    const row = await this.repository.lockTransfer(db, transferId);
    if (!row) {
      throw new AppFailure('ERR-RES-001', { message: `Transfer ${transferId} was not found` });
    }
    return row;
  }

  private async requireSettlement(
    db: DbHandle,
    settlementId: string
  ): Promise<TransferSettlementRow> {
    const row = await this.repository.readTransferSettlement(db, settlementId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'Transfer settlement vanished after it was written',
      });
    }
    return row;
  }

  private async requireTransfer(db: DbHandle, transferId: string): Promise<TransferRow> {
    const row = await this.repository.readTransfer(db, transferId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', { message: 'Transfer vanished after it was written' });
    }
    return row;
  }
}
