/**
 * Inventory reads (Phase 1-21, P1-21-BE-001, BE-003, BE-011, BE-014).
 *
 * Every read here is scoped twice: RLS narrows the rows, and — when the caller
 * names a branch — `authorizeScope` re-evaluates the operation's own permissions
 * against that concrete branch. The second check is not redundant. `app.branch_ids`
 * is the union of every active grant regardless of which permission it carries
 * (P1-18-A-01), so RLS alone would let a principal holding `inv.stock.read` in one
 * branch read stock in another branch they merely have some grant in. Worse, the
 * difference between an empty and a non-empty page is itself information: it
 * reveals whether a branch exists and stocks an item.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { resolveLimit, decodeCursor, type Page } from '@/server/db/pagination';
import { ITEM_ORDER, MOVEMENT_ORDER } from '../data/inventory-repository';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import type {
  BalanceReconciliationRow,
  InventoryRepository,
  ItemListFilter,
  ItemRow,
  MovementListFilter,
  MovementRow,
  StockBalanceRow,
} from '../data/inventory-repository';

/** An item as the API renders it. Carries no cost — that is `inv.cost.view` data. */
export interface ItemView {
  readonly id: string;
  readonly itemCategoryId: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string | null;
  readonly unitOfMeasure: { readonly id: string; readonly code: string };
  readonly itemType: string;
  readonly isStockTracked: boolean;
  readonly isSerialized: boolean;
  readonly lifecycleStatus: string;
  readonly recordVersion: number;
}

/**
 * One availability cell.
 *
 * The four quantity concepts are exactly the ones the schema stores. There is no
 * `damagedQty` field because damage is represented as stock sitting in a
 * `quarantine` location, and no `customerSuppliedQty` because customer-owned parts
 * are not stock at all.
 */
export interface AvailabilityView {
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationType: string;
  readonly companyId: string;
  readonly branchId: string;
  /** Exact decimal strings, never numbers. */
  readonly onHand: string;
  readonly reserved: string;
  readonly available: string;
}

export interface MovementView {
  readonly id: string;
  readonly sequence: string;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly movementType: string;
  readonly direction: string;
  readonly quantity: string;
  readonly signedQuantity: string;
  readonly reference: { readonly kind: string; readonly id: string };
  readonly occurredAt: string;
  readonly correlationId: string | null;
}

export interface ReconciliationView {
  readonly checkedAt: string;
  readonly cellsChecked: number;
  readonly incoherentCells: number;
  readonly openCommitments: {
    readonly activeReservations: number;
    readonly openIssues: number;
  } | null;
  readonly cells: readonly {
    readonly itemId: string;
    readonly sku: string;
    readonly locationId: string;
    readonly companyId: string;
    readonly branchId: string;
    readonly storedOnHand: string;
    readonly ledgerOnHand: string;
    readonly storedReserved: string;
    readonly activeReserved: string;
    readonly coherent: boolean;
  }[];
}

const toItemView = (row: ItemRow): ItemView => ({
  id: row.id,
  itemCategoryId: row.itemCategoryId,
  sku: row.sku,
  name: row.name,
  description: row.description,
  unitOfMeasure: { id: row.uomId, code: row.uomCode },
  itemType: row.itemType,
  isStockTracked: row.isStockTracked,
  isSerialized: row.isSerialized,
  lifecycleStatus: row.lifecycleStatus,
  recordVersion: row.recordVersion,
});

const toAvailabilityView = (row: StockBalanceRow): AvailabilityView => ({
  itemId: row.itemId,
  sku: row.sku,
  locationId: row.locationId,
  locationCode: row.locationCode,
  locationType: row.locationType,
  companyId: row.companyId,
  branchId: row.branchId,
  onHand: row.onHandQty,
  reserved: row.reservedQty,
  available: row.availableQty,
});

const toMovementView = (row: MovementRow): MovementView => ({
  id: row.id,
  sequence: row.seq,
  itemId: row.itemId,
  sku: row.sku,
  locationId: row.locationId,
  companyId: row.companyId,
  branchId: row.branchId,
  movementType: row.movementType,
  direction: row.direction,
  quantity: row.quantity,
  signedQuantity: row.signedQty,
  reference: { kind: row.referenceKind, id: row.referenceId },
  occurredAt: row.occurredAt.toISOString(),
  correlationId: row.correlationId,
});

export class InventoryReadService {
  public constructor(private readonly repository: InventoryRepository) {}

  /**
   * P1-21-BE-001 — item search.
   *
   * `inv.item_master` is tenant-wide reference data with no company or branch
   * column, so this is a tenant-scoped read and offers no branch filter. Archived
   * items are excluded unless asked for explicitly: an archived SKU can never be
   * reactivated (`inv.guard_item_lifecycle`), so surfacing it by default would
   * invite callers to build against something unusable.
   */
  public async searchItems(
    db: DbHandle,
    filter: ItemListFilter,
    page: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Page<ItemView>> {
    const request = {
      limit: resolveLimit(page.limit),
      cursor: page.cursor ? decodeCursor(page.cursor, ITEM_ORDER) : null,
    };
    const effective: ItemListFilter =
      filter.lifecycleStatus === undefined ? { ...filter, lifecycleStatus: 'active' } : filter;
    const result = await this.repository.listItems(db, effective, request);
    return { ...result, items: result.items.map(toItemView) };
  }

  /**
   * P1-21-BE-003 — stock availability.
   *
   * A named branch is authorized before it is used, so the caller cannot probe
   * which branches exist by comparing empty and non-empty pages. A named location
   * is resolved to its own company/branch first and authorized the same way —
   * otherwise `locationId` would be a way around the branch check.
   */
  public async readAvailability(
    db: DbHandle,
    filter: {
      readonly itemId?: string;
      readonly locationId?: string;
      readonly branchId?: string;
      readonly includeQuarantine?: boolean;
    },
    page: { readonly cursor?: string; readonly limit?: number },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<AvailabilityView>> {
    if (filter.locationId !== undefined) {
      const location = await this.repository.readLocation(db, filter.locationId);
      if (!location) {
        throw new AppFailure('ERR-RES-001', {
          message: `Stock location ${filter.locationId} was not found`,
        });
      }
      await authorizeScope({ companyId: location.companyId, branchId: location.branchId });
      if (filter.branchId !== undefined && filter.branchId !== location.branchId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'branchId and locationId name different branches',
          safeDetails: { violations: [{ path: 'query.branchId', rule: 'custom' }] },
        });
      }
    } else if (filter.branchId !== undefined) {
      const companyId = await this.resolveCompanyForBranch(db, filter.branchId);
      await authorizeScope({ companyId, branchId: filter.branchId });
    }

    const request = {
      limit: resolveLimit(page.limit),
      cursor: page.cursor ? decodeCursor(page.cursor, ITEM_ORDER) : null,
    };
    const result = await this.repository.readAvailability(db, filter, request);
    return { ...result, items: result.items.map(toAvailabilityView) };
  }

  /**
   * P1-21-BE-011 — movement history.
   *
   * Reading the ledger is a privileged act and is audited: the movement history is
   * the complete record of what a branch holds and consumes, and an unlogged bulk
   * read of it is exactly the reconnaissance an audit trail exists to catch. The
   * audit record names the filter, not the rows.
   */
  public async listMovements(
    db: DbHandle,
    filter: MovementListFilter,
    page: { readonly cursor?: string; readonly limit?: number },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<MovementView>> {
    if (filter.locationId !== undefined) {
      const location = await this.repository.readLocation(db, filter.locationId);
      if (!location) {
        throw new AppFailure('ERR-RES-001', {
          message: `Stock location ${filter.locationId} was not found`,
        });
      }
      await authorizeScope({ companyId: location.companyId, branchId: location.branchId });
    }
    const request = {
      limit: resolveLimit(page.limit),
      cursor: page.cursor ? decodeCursor(page.cursor, MOVEMENT_ORDER) : null,
    };
    const result = await this.repository.listMovements(db, filter, request);

    await appendAudit(db, {
      action: 'inv.movement_history.read',
      entityType: 'inv.stock_movements',
      entityId: filter.itemId ?? null,
      requestRef: 'inv.stock-movement-list',
      details: [
        { field: 'itemId', classification: 'internal', value: filter.itemId ?? null },
        { field: 'locationId', classification: 'internal', value: filter.locationId ?? null },
        { field: 'workOrderId', classification: 'internal', value: filter.workOrderId ?? null },
        {
          field: 'returnedRows',
          classification: 'internal',
          value: String(result.items.length),
        },
      ],
    });

    return { ...result, items: result.items.map(toMovementView) };
  }

  /**
   * P1-21-BE-014 — inventory audit and reconciliation.
   *
   * Re-derives every stored balance from the ledger and reports any cell where the
   * cache and the movements disagree. `inv.guard_stock_balance_coherence` should
   * make `incoherentCells` structurally zero, so a non-zero count is evidence the
   * guard was bypassed rather than a routine finding — which is why the result is
   * reported rather than silently repaired.
   */
  public async reconcile(
    db: DbHandle,
    filter: { readonly branchId?: string; readonly itemId?: string; readonly workOrderId?: string },
    limit: number | undefined,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReconciliationView> {
    if (filter.branchId !== undefined) {
      const companyId = await this.resolveCompanyForBranch(db, filter.branchId);
      await authorizeScope({ companyId, branchId: filter.branchId });
    }
    // Built by spreading rather than by assigning `undefined`:
    // `exactOptionalPropertyTypes` is on, so an absent filter must be an absent KEY.
    const cellFilter: { branchId?: string; itemId?: string } = {
      ...(filter.branchId === undefined ? {} : { branchId: filter.branchId }),
      ...(filter.itemId === undefined ? {} : { itemId: filter.itemId }),
    };
    const cells: readonly BalanceReconciliationRow[] = await this.repository.reconcileBalances(
      db,
      cellFilter,
      resolveLimit(limit)
    );
    const openCommitments =
      filter.workOrderId === undefined
        ? null
        : await this.repository.countOpenCommitments(db, filter.workOrderId);
    const incoherent = cells.filter((c) => !c.coherent).length;

    await appendAudit(db, {
      action: 'inv.reconciliation.performed',
      entityType: 'inv.stock_balances',
      entityId: filter.itemId ?? null,
      requestRef: 'inv.inventory-reconciliation-read',
      details: [
        { field: 'branchId', classification: 'internal', value: filter.branchId ?? null },
        { field: 'cellsChecked', classification: 'internal', value: String(cells.length) },
        { field: 'incoherentCells', classification: 'internal', value: String(incoherent) },
      ],
    });

    return {
      // The database clock, not the process clock: the reconciliation is a
      // statement about a transaction snapshot, and a host with a skewed clock
      // must not be able to misdate the evidence.
      checkedAt: await this.databaseNow(db),
      cellsChecked: cells.length,
      incoherentCells: incoherent,
      openCommitments,
      cells: cells.map((c) => ({ ...c })),
    };
  }

  /**
   * Resolves the company a branch belongs to.
   *
   * Needed because `authorizeScope` narrows on a company/branch PAIR — a branch
   * alone would leave the company half empty and `requiresScopedEvaluation` would
   * fall back to the scope-blind check.
   */
  private async resolveCompanyForBranch(db: DbHandle, branchId: string): Promise<string> {
    const row = await db.query<{ company_id: string }>(
      `SELECT company_id FROM org.branches
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [db.context.principal.tenantId, branchId]
    );
    const companyId = row.rows[0]?.company_id;
    if (!companyId) {
      throw new AppFailure('ERR-RES-001', { message: `Branch ${branchId} was not found` });
    }
    return companyId;
  }

  private async databaseNow(db: DbHandle): Promise<string> {
    const row = await db.query<{ now: Date }>('SELECT now() AS now');
    const now = row.rows[0]?.now;
    if (!now)
      throw new AppFailure('ERR-SYS-001', { message: 'Database clock read returned no row' });
    return now.toISOString();
  }
}
