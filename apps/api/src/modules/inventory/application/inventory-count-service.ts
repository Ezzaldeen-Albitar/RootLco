/**
 * Stock counts with variance, tolerant of movements during the count
 * (P1-32-PRE-047…049).
 *
 * Opening a count snapshots the on-hand quantity of every item held at one
 * location. The branch keeps trading while the shelf is being counted: nothing is
 * frozen, and an issue or a receipt posted mid-count is ordinary ledger activity.
 * Reconciliation then re-reads the movements posted AFTER the snapshot and folds
 * them into the expected quantity, so the variance is
 *
 *     counted − (snapshot + movements during the count)
 *
 * — which is the database's GENERATED `variance_qty`, not arithmetic here.
 *
 * ## A count never posts stock
 *
 * Every non-zero variance raises a PENDING `inv.stock_adjustments` row, linked from
 * the line, and the count stops there. The correction reaches the ledger only when
 * a second person approves that adjustment through `inv.stock-adjustment-approve`,
 * which is the rule every other quantity correction in this schema already obeys.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { pageRequest, type Page } from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import {
  STOCK_COUNT_ORDER,
  type InventoryRepository,
  type StockCountLineRow,
  type StockCountListRow,
  type StockCountRow,
} from '../data/inventory-repository';
import { assertCountableLocation } from '../domain/inventory';
import { parseCountedQuantity, toDomainFailure } from './inventory-failures';
import type { InventoryStockService } from './inventory-stock-service';

export interface StockCountLineView {
  readonly id: string;
  readonly itemId: string;
  readonly sku: string;
  /** Exact decimal strings, never numbers. */
  readonly snapshotQty: string;
  readonly countedQty: string | null;
  readonly movementDeltaDuringCount: string;
  /** Null until the line is counted — distinct from a counted line that matched. */
  readonly varianceQty: string | null;
  readonly adjustmentId: string | null;
  readonly adjustmentStatus: string | null;
}

export interface StockCountView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationId: string;
  readonly status: string;
  readonly snapshotAt: string;
  readonly countedBy: string;
  readonly reconciledAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly notes: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly lineCount: number;
  readonly countedLineCount: number;
  /** Lines whose counted quantity differs from what the ledger expected. */
  readonly varianceLineCount: number;
  /** Σ|variance| — a surplus never hides a shortage. */
  readonly absoluteVarianceQty: string;
}

export interface StockCountListView extends StockCountView {
  readonly locationCode: string;
}

export interface StockCountDetailView extends StockCountView {
  readonly lines: readonly StockCountLineView[];
}

export interface OpenedStockCountView extends StockCountDetailView {
  /** True when an idempotent replay returned the count that already existed. */
  readonly replayed: boolean;
}

export interface ReconciledStockCountView extends StockCountDetailView {
  /** How many PENDING adjustments the reconciliation raised. None was posted. */
  readonly adjustmentsRaised: number;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

const toLineView = (row: StockCountLineRow): StockCountLineView => ({
  id: row.id,
  itemId: row.itemId,
  sku: row.sku,
  snapshotQty: row.snapshotQty,
  countedQty: row.countedQty,
  movementDeltaDuringCount: row.movementDeltaDuringCount,
  varianceQty: row.varianceQty,
  adjustmentId: row.adjustmentId,
  adjustmentStatus: row.adjustmentStatus,
});

function toCountView(
  row: StockCountRow,
  variance: {
    readonly lineCount: number;
    readonly countedLineCount: number;
    readonly varianceLineCount: number;
    readonly absoluteVarianceQty: string;
  }
): StockCountView {
  return {
    id: row.id,
    companyId: row.companyId,
    branchId: row.branchId,
    locationId: row.locationId,
    status: row.status,
    snapshotAt: row.snapshotAt.toISOString(),
    countedBy: row.countedBy,
    reconciledAt: iso(row.reconciledAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    notes: row.notes,
    recordVersion: row.recordVersion,
    createdAt: row.createdAt.toISOString(),
    lineCount: variance.lineCount,
    countedLineCount: variance.countedLineCount,
    varianceLineCount: variance.varianceLineCount,
    absoluteVarianceQty: variance.absoluteVarianceQty,
  };
}

const toCountListView = (row: StockCountListRow): StockCountListView => ({
  ...toCountView(row, row),
  locationCode: row.locationCode,
});

export class InventoryCountService {
  public constructor(
    private readonly repository: InventoryRepository,
    private readonly stock: InventoryStockService
  ) {}

  /** Opens a count of one location, snapshotting every item it holds. */
  public async open(
    db: DbHandle,
    input: {
      readonly locationId: string;
      readonly notes?: string;
      readonly idempotencyKey?: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<OpenedStockCountView> {
    const location = await this.stock.requireLocation(db, input.locationId);
    await authorizeScope({ companyId: location.companyId, branchId: location.branchId });
    try {
      assertCountableLocation(location);
    } catch (error) {
      toDomainFailure(error, 'Stock count');
    }

    if (input.idempotencyKey !== undefined) {
      const existing = await this.repository.readStockCountByIdempotencyKey(
        db,
        input.idempotencyKey
      );
      if (existing) {
        if (existing.locationId !== input.locationId) {
          throw new AppFailure('ERR-INT-001', {
            message:
              'This idempotency key already opened a count of a different location. Reuse a ' +
              'key only for an identical request.',
          });
        }
        return { ...(await this.detail(db, existing)), replayed: true };
      }
    }

    let countId: string;
    try {
      const opened = await this.repository.openStockCount(db, {
        locationId: input.locationId,
        notes: input.notes ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: db.context.correlationId,
      });
      countId = opened.id;
    } catch (error) {
      // `uq_stock_counts_open_location` is the one unique index a fresh key can hit:
      // a second count of a shelf that is already being counted.
      toDomainFailure(error, 'A count of this location');
    }

    const count = await this.requireCount(db, countId);
    const view = await this.detail(db, count);
    await appendAudit(db, {
      action: 'inv.stock_count.opened',
      entityType: 'inv.stock_count',
      entityId: count.id,
      companyId: count.companyId,
      branchId: count.branchId,
      requestRef: 'inv.stock-count-open',
      details: [
        { field: 'locationId', classification: 'internal', value: count.locationId },
        { field: 'snapshotAt', classification: 'internal', value: view.snapshotAt },
        { field: 'lineCount', classification: 'internal', value: String(view.lineCount) },
      ],
    });
    return { ...view, replayed: false };
  }

  /**
   * Records what was physically counted for one item.
   *
   * `If-Match` names the COUNT's version, because the count is the aggregate two
   * counters would race on: the first write moves the count from `open` to
   * `counting` and bumps its version, so a second counter holding a stale read of
   * the same count is told so instead of overwriting a line they never saw change.
   */
  public async recordLine(
    db: DbHandle,
    countId: string,
    itemId: string,
    input: { readonly countedQty: string; readonly expectedVersion: number },
    authorizeScope: ScopeAuthorizer
  ): Promise<StockCountDetailView> {
    const counted = parseCountedQuantity(input.countedQty);
    const before = await this.lockCountOrFail(db, countId);
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    if (before.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The stock count changed since it was last read; read it again before recording',
      });
    }
    this.assertInProgress(before);
    const item = await this.repository.readItem(db, itemId);
    if (!item) {
      throw new AppFailure('ERR-RES-001', { message: `Item ${itemId} was not found` });
    }

    try {
      await this.repository.recordStockCountLine(db, {
        countId,
        itemId,
        countedQuantity: counted.toString(),
      });
    } catch (error) {
      toDomainFailure(error, 'Stock count line');
    }

    const after = await this.requireCount(db, countId);
    await appendAudit(db, {
      action: 'inv.stock_count.line_recorded',
      entityType: 'inv.stock_count',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'inv.stock-count-line-record',
      details: [
        { field: 'itemId', classification: 'internal', value: itemId },
        { field: 'countedQty', classification: 'internal', value: counted.toString() },
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
      ],
    });
    return this.detail(db, after);
  }

  /**
   * Folds in the movements posted during the count and raises a PENDING adjustment
   * for every non-zero variance. Posts nothing.
   */
  public async reconcile(
    db: DbHandle,
    countId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReconciledStockCountView> {
    const before = await this.lockCountOrFail(db, countId);
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    this.assertInProgress(before);

    let raised: number;
    try {
      raised = await this.repository.reconcileStockCount(db, countId, db.context.correlationId);
    } catch (error) {
      toDomainFailure(error, 'Stock count reconciliation');
    }

    const after = await this.requireCount(db, countId);
    const view = await this.detail(db, after);
    await appendAudit(db, {
      action: 'inv.stock_count.reconciled',
      entityType: 'inv.stock_count',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'inv.stock-count-reconcile',
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: before.status,
          value: after.status,
        },
        {
          field: 'varianceLineCount',
          classification: 'internal',
          value: String(view.varianceLineCount),
        },
        {
          field: 'absoluteVarianceQty',
          classification: 'internal',
          value: view.absoluteVarianceQty,
        },
        { field: 'adjustmentsRaised', classification: 'internal', value: String(raised) },
      ],
    });
    return { ...view, adjustmentsRaised: raised };
  }

  public async cancel(
    db: DbHandle,
    countId: string,
    input: { readonly reason: string },
    authorizeScope: ScopeAuthorizer
  ): Promise<StockCountDetailView> {
    const before = await this.lockCountOrFail(db, countId);
    await authorizeScope({ companyId: before.companyId, branchId: before.branchId });
    this.assertInProgress(before);
    try {
      await this.repository.cancelStockCount(db, countId, input.reason);
    } catch (error) {
      toDomainFailure(error, 'Stock count cancellation');
    }
    const after = await this.requireCount(db, countId);
    await appendAudit(db, {
      action: 'inv.stock_count.cancelled',
      entityType: 'inv.stock_count',
      entityId: after.id,
      companyId: after.companyId,
      branchId: after.branchId,
      requestRef: 'inv.stock-count-cancel',
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
    return this.detail(db, after);
  }

  public async read(
    db: DbHandle,
    countId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<StockCountDetailView> {
    const count = await this.repository.readStockCount(db, countId);
    if (!count) {
      throw new AppFailure('ERR-RES-001', { message: `Stock count ${countId} was not found` });
    }
    await authorizeScope({ companyId: count.companyId, branchId: count.branchId });
    return this.detail(db, count);
  }

  public async list(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
      readonly locationId?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<StockCountListView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listStockCounts(
      db,
      filter,
      pageRequest(STOCK_COUNT_ORDER, page)
    );
    return { ...result, items: result.items.map(toCountListView) };
  }

  private assertInProgress(count: StockCountRow): void {
    if (count.status !== 'open' && count.status !== 'counting') {
      throw new AppFailure('ERR-TRN-001', {
        message: `Stock count ${count.id} is ${count.status} and can no longer change`,
      });
    }
  }

  private async detail(db: DbHandle, count: StockCountRow): Promise<StockCountDetailView> {
    const variance = await this.repository.readStockCountVariance(db, count.id);
    const lines = await this.repository.listStockCountLines(db, count.id);
    return { ...toCountView(count, variance), lines: lines.map(toLineView) };
  }

  private async lockCountOrFail(db: DbHandle, countId: string): Promise<StockCountRow> {
    const row = await this.repository.lockStockCount(db, countId);
    if (!row) {
      throw new AppFailure('ERR-RES-001', { message: `Stock count ${countId} was not found` });
    }
    return row;
  }

  private async requireCount(db: DbHandle, countId: string): Promise<StockCountRow> {
    const row = await this.repository.readStockCount(db, countId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', { message: 'Stock count vanished after it was written' });
    }
    return row;
  }
}
