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
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import {
  TRANSFER_ORDER,
  type InventoryRepository,
  type TransferListRow,
  type TransferRow,
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
  readonly status: string;
  /** True while the quantity sits in the transit location. */
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
    status: row.status,
    inTransit: row.status === 'dispatched',
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
   * Receives a dispatched transfer in full: transit -> destination.
   *
   * The transfer is LOCKED before the status is read, so two concurrent receipts
   * of one transfer resolve to one winner — the second finds `received` and is
   * refused rather than posting a second settlement pair that the unique movement
   * source index would then reject mid-transaction.
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

    if (before.status !== 'dispatched') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Transfer ${transferId} is ${before.status} and can no longer be received`,
      });
    }
    if (!Quantity.fromDatabase(before.quantity, 'quantity').equals(quantity)) {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `The received quantity ${quantity.toString()} must equal the dispatched ` +
          `${before.quantity}. Partial receipt is not supported: receive the full ` +
          'quantity, or cancel the transfer and dispatch what actually travels.',
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
    await this.stock.publishPostedMovements(db, 'transfer_receipt', after.id);
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
        { field: 'receivedQuantity', classification: 'internal', value: after.receivedQuantity },
        { field: 'toLocationId', classification: 'internal', value: after.toLocationId },
      ],
    });
    return toTransferView(after, false);
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

  private async requireTransfer(db: DbHandle, transferId: string): Promise<TransferRow> {
    const row = await this.repository.readTransfer(db, transferId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', { message: 'Transfer vanished after it was written' });
    }
    return row;
  }
}
