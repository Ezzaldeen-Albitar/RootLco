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
import { pageRequest, resolveLimit, decodeCursor, type Page } from '@/server/db/pagination';
import {
  ITEM_ORDER,
  LOCATION_ORDER,
  MOVEMENT_ORDER,
  PART_ISSUE_ORDER,
  RESERVATION_ORDER,
} from '../data/inventory-repository';
import { workOrderModule } from '@/modules/work-order';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import type {
  BalanceReconciliationRow,
  InventoryRepository,
  ItemListFilter,
  ItemRow,
  MovementListFilter,
  MovementRow,
  PartIssueListRow,
  ReservationListRow,
  StockBalanceRow,
  StockLocationListRow,
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

/**
 * Open inventory commitments against one work order.
 *
 * The fact `wo.work_orders.parts_forward_state` was left as a hook for
 * (`DEFERRED_CLOSURE_BLOCKERS` in `@/modules/work-order`, owner `P1-21`): a work
 * order must not be certified complete while stock is still reserved for it or
 * still issued to it and unreturned.
 */
export interface OpenInventoryCommitments {
  readonly activeReservations: number;
  readonly openIssues: number;
  /** True when either count is non-zero, i.e. closure must be refused. */
  readonly blocking: boolean;
}

/**
 * One stock reservation as the list renders it (Phase 1-30 A2, S-14).
 *
 * `quantity` is `numeric(12, 3)` and stays a decimal STRING. `expiresAt` is
 * `null` when the reservation carries no expiry - a real state, not a missing
 * value, and not one to paper over with a far-future instant.
 */
export interface ReservationListView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly workOrderId: string | null;
  readonly quantity: string;
  readonly status: string;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly recordVersion: number;
}

/**
 * One part issue as the per-work-order list renders it (Phase 1-30 A2, S-15).
 *
 * `quantity` and `returnedQty` are both `numeric(12, 3)` decimal STRINGS, and the
 * outstanding amount is deliberately NOT published: netting them here would mean
 * subtracting two exact decimals in IEEE-754, which is the arithmetic the
 * server-owned-amount rule exists to prevent. A consumer that needs the
 * difference has both exact operands.
 */
export interface PartIssueListView {
  readonly id: string;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly reservationId: string | null;
  readonly quantity: string;
  readonly returnedQty: string;
  readonly issuedAt: string;
}

/** One stock location as the picker renders it (Phase 1-30 A2, S-16). */
export interface StockLocationView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationCode: string;
  readonly name: string;
  readonly locationType: string;
  readonly parentLocationId: string | null;
  readonly status: string;
}

const toReservationListView = (row: ReservationListRow): ReservationListView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  itemId: row.itemId,
  sku: row.sku,
  locationId: row.locationId,
  locationCode: row.locationCode,
  workOrderId: row.workOrderId,
  quantity: row.quantity,
  status: row.status,
  expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  recordVersion: row.recordVersion,
});

const toPartIssueListView = (row: PartIssueListRow): PartIssueListView => ({
  id: row.id,
  workOrderId: row.workOrderId,
  companyId: row.companyId,
  branchId: row.branchId,
  itemId: row.itemId,
  sku: row.sku,
  locationId: row.locationId,
  locationCode: row.locationCode,
  reservationId: row.reservationId,
  quantity: row.quantity,
  returnedQty: row.returnedQty,
  // `inv.part_issues` has no `issued_at` column; `created_at` IS the instant the
  // part left the store, written by the statement that posted the movement.
  issuedAt: row.createdAt.toISOString(),
});

const toStockLocationView = (row: StockLocationListRow): StockLocationView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  locationCode: row.locationCode,
  name: row.name,
  locationType: row.locationType,
  parentLocationId: row.parentLocationId,
  status: row.status,
});

export class InventoryReadService {
  public constructor(private readonly repository: InventoryRepository) {}

  /**
   * Answers "does this work order still hold stock?" for the work-order module.
   *
   * Deliberately a **port on the public surface** rather than a table read by the
   * caller: `work-order` may not touch `inv` tables, exactly as it may not touch
   * `qms` ones and asks `@/modules/quality` for B5/B6 instead. The dependency runs
   * one way only — this module reads `wo.work_orders` through SQL and imports
   * nothing from `work-order` — so there is no cycle.
   *
   * This is a **read with no authorization of its own**. It is called from inside
   * the work-order closure transaction, after that operation has already locked
   * and authorized the work order against its own company and branch, and it
   * returns two integers about that already-authorized row. Adding a second
   * permission check here would demand `inv.stock.read` of every caller allowed to
   * close a work order, which is a different and wrong rule.
   */
  public async openCommitmentsFor(
    db: DbHandle,
    workOrderId: string
  ): Promise<OpenInventoryCommitments> {
    const counts = await this.repository.countOpenCommitments(db, workOrderId);
    return {
      activeReservations: counts.activeReservations,
      openIssues: counts.openIssues,
      blocking: counts.activeReservations > 0 || counts.openIssues > 0,
    };
  }

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
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId?: string;
      readonly locationId?: string;
      readonly includeQuarantine?: boolean;
    },
    page: { readonly cursor?: string; readonly limit?: number },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<AvailabilityView>> {
    // UNCONDITIONAL. This check used to sit inside `if (filter present)`, so omitting
    // the filter skipped it and left RLS — which narrows on the permission-blind
    // grant union — as the only barrier. There is no longer a path through this
    // method that does not name a branch and authorize it.
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });

    if (filter.locationId !== undefined) {
      const location = await this.repository.readLocation(db, filter.locationId);
      if (!location) {
        throw new AppFailure('ERR-RES-001', {
          message: `Stock location ${filter.locationId} was not found`,
        });
      }
      // A location may not reach past the authorized pair.
      if (location.companyId !== filter.companyId || location.branchId !== filter.branchId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'locationId names a different company or branch from the one authorized',
          safeDetails: { violations: [{ path: 'query.locationId', rule: 'custom' }] },
        });
      }
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
    // Unconditional — see `readAvailability`. The ledger is the complete record of
    // what a branch holds and consumes, so an unauthorized read of it is the most
    // valuable one an attacker could make.
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });

    if (filter.locationId !== undefined) {
      const location = await this.repository.readLocation(db, filter.locationId);
      if (!location) {
        throw new AppFailure('ERR-RES-001', {
          message: `Stock location ${filter.locationId} was not found`,
        });
      }
      if (location.companyId !== filter.companyId || location.branchId !== filter.branchId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'locationId names a different company or branch from the one authorized',
          safeDetails: { violations: [{ path: 'query.locationId', rule: 'custom' }] },
        });
      }
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
      // The scope is recorded, so a single-branch read is distinguishable in the
      // trail from a wider sweep. Every mutation in this phase already does it.
      companyId: filter.companyId,
      branchId: filter.branchId,
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
   * One branch's stock reservations, newest first (Phase 1-30 A2, seam S-14).
   *
   * `authorizeScope` is UNCONDITIONAL and runs BEFORE any row is read, for the
   * reason the class docblock gives: the difference between an empty and a
   * non-empty page is itself information, so authorizing after the query would
   * still leak whether a branch holds commitments.
   *
   * A named `locationId` is resolved to its OWN company and branch and compared
   * against the authorized pair - otherwise it would be a way past the branch
   * check, which is exactly the hole `readAvailability` closes the same way.
   *
   * `auditClass` on the route is `none`, matching `inv.stock-availability-read`
   * rather than `inv.stock-movement-list`. The movement ledger is audited because
   * it is the complete record of what a branch holds and consumes; a list of open
   * commitments is not that record, and A2 does not invent read-audit actions for
   * ordinary reads.
   */
  public async listReservations(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId?: string | undefined;
      readonly locationId?: string | undefined;
      readonly workOrderId?: string | undefined;
      readonly status?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<ReservationListView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });

    if (filter.locationId !== undefined) {
      const location = await this.repository.readLocation(db, filter.locationId);
      if (!location) {
        throw new AppFailure('ERR-RES-001', {
          message: `Stock location ${filter.locationId} was not found`,
        });
      }
      if (location.companyId !== filter.companyId || location.branchId !== filter.branchId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'locationId names a different company or branch from the one authorized',
          safeDetails: { violations: [{ path: 'query.locationId', rule: 'custom' }] },
        });
      }
    }

    const result = await this.repository.listReservations(
      db,
      filter,
      pageRequest(RESERVATION_ORDER, page)
    );
    return { ...result, items: result.items.map(toReservationListView) };
  }

  /**
   * One WORK ORDER's part issues, newest first (Phase 1-30 A2, seam S-15).
   *
   * ## Why the parent is mandatory
   *
   * The work order is resolved through `@/modules/work-order` BEFORE any issue is
   * read, and that call performs the deferred scoped authorization against the
   * ROW's own company and branch. The alternative shape - a top-level
   * `GET /stock-issues?workOrderId=...` - names no parent, so
   * `requiresScopedEvaluation` sees an empty target, returns false whatever the
   * declaration says, and the check degrades to the scope-blind
   * `iam.has_permission` (P1-18-A-01). RLS would then be the only narrowing, and
   * `app.branch_ids` is the permission-blind union of every active grant.
   *
   * It also settles what an empty answer means: a visible work order with no
   * parts issued returns an empty page; one the caller may not see is
   * `ERR-RES-001` before a single issue row is touched, so an empty page can
   * never stand in for a refusal.
   *
   * Reading this module's own rows through the work-order module's public
   * surface, not its tables - the same one-way dependency `openCommitmentsFor`
   * describes in the other direction.
   */
  public async listPartIssuesForWorkOrder(
    db: DbHandle,
    workOrderId: string,
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<PartIssueListView>> {
    const workOrder = await workOrderModule().workOrders.requireWorkOrder(
      db,
      workOrderId,
      authorizeScope
    );
    const result = await this.repository.listPartIssuesForWorkOrder(
      db,
      workOrder.id,
      pageRequest(PART_ISSUE_ORDER, page)
    );
    return { ...result, items: result.items.map(toPartIssueListView) };
  }

  /**
   * One branch's stock locations, by code (Phase 1-30 A2, seam S-16).
   *
   * The location is the scope anchor every movement derives from, so a picker
   * that offered locations outside the authorized branch would be offering ids
   * that `inv.post_stock_movement` will refuse - and revealing that those
   * branches exist. `authorizeScope` therefore runs first and unconditionally,
   * on the same required `(companyId, branchId)` the reservation list uses.
   *
   * Inactive locations are NOT hidden by default. Stock already sitting in a
   * location that was later deactivated still has to be findable, and a picker
   * that silently omitted it would make that stock unreachable; `status` is
   * published on every row and offered as a filter instead.
   */
  public async listLocations(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly locationType?: string | undefined;
      readonly status?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<StockLocationView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listLocations(
      db,
      filter,
      pageRequest(LOCATION_ORDER, page)
    );
    return { ...result, items: result.items.map(toStockLocationView) };
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
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId?: string;
      readonly workOrderId?: string;
    },
    limit: number | undefined,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReconciliationView> {
    // Unconditional — see `readAvailability`.
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    // Built by spreading rather than by assigning `undefined`:
    // `exactOptionalPropertyTypes` is on, so an absent filter must be an absent KEY.
    // H6: `companyId` is passed through and applied as a SQL predicate. Authorization
    // is satisfied by company OR branch, so the query — not the check — is what makes
    // an incoherent (company, branch) pair select nothing.
    const cellFilter: { companyId: string; branchId: string; itemId?: string } = {
      companyId: filter.companyId,
      branchId: filter.branchId,
      ...(filter.itemId === undefined ? {} : { itemId: filter.itemId }),
    };
    const cells: readonly BalanceReconciliationRow[] = await this.repository.reconcileBalances(
      db,
      cellFilter,
      resolveLimit(limit)
    );
    let openCommitments: {
      readonly activeReservations: number;
      readonly openIssues: number;
    } | null = null;
    if (filter.workOrderId !== undefined) {
      // `countOpenCommitments` filters on tenant and work order only — deliberately, because
      // its other caller is the closure port where the work order IS the authorized subject.
      // Here the id is caller-supplied, so it must be pinned to the authorized pair first.
      const scope = await this.repository.readWorkOrderScope(db, filter.workOrderId);
      if (!scope) {
        throw new AppFailure('ERR-RES-001', {
          message: `Work order ${filter.workOrderId} was not found`,
        });
      }
      if (scope.companyId !== filter.companyId || scope.branchId !== filter.branchId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'workOrderId names a different company or branch from the one authorized',
          safeDetails: { violations: [{ path: 'query.workOrderId', rule: 'custom' }] },
        });
      }
      openCommitments = await this.repository.countOpenCommitments(db, filter.workOrderId);
    }
    const incoherent = cells.filter((c) => !c.coherent).length;

    await appendAudit(db, {
      action: 'inv.reconciliation.performed',
      entityType: 'inv.stock_balances',
      entityId: filter.itemId ?? null,
      companyId: filter.companyId,
      branchId: filter.branchId,
      requestRef: 'inv.inventory-reconciliation-read',
      details: [
        { field: 'branchId', classification: 'internal', value: filter.branchId },
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

  // `resolveCompanyForBranch` was removed with the optional-filter reads. It existed
  // to derive the company half of a scope pair from a lone `branchId`; every read now
  // requires the pair outright, so there is nothing left to derive — and a helper
  // that turns half a target into a whole one is exactly the shape that made the
  // scope check look present while being skippable.

  private async databaseNow(db: DbHandle): Promise<string> {
    const row = await db.query<{ now: Date }>('SELECT now() AS now');
    const now = row.rows[0]?.now;
    if (!now)
      throw new AppFailure('ERR-SYS-001', { message: 'Database clock read returned no row' });
    return now.toISOString();
  }
}
