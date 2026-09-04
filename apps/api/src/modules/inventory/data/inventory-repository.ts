/**
 * `inv` SQL (Phase 1-21, P1-21-BE-001…015).
 *
 * The only place inventory SQL is written. Three conventions hold without
 * exception:
 *
 *  - **Every query carries an explicit `tenant_id` predicate** even though RLS
 *    already narrows. RLS is the guarantee; the predicate is the intent, and it
 *    keeps the plan on the tenant-leading composite indexes.
 *  - **`numeric` values are read and written as STRINGS.** Every quantity column
 *    is `numeric(12,3)` and every cost is `numeric(18,4)`; `pg` returns OID 1700
 *    as text and this repository never overrides that, because IEEE-754 cannot
 *    represent the third decimal place exactly.
 *  - **Mutations go through the protected `inv` functions**, which take the
 *    balance-row `FOR UPDATE` lock first. This repository never reads a balance
 *    and then writes based on the read — that is the race the lock exists to
 *    prevent.
 *
 * Where a protected function is demonstrably wrong (`P1-21-D-01`/`D-03`, see
 * `docs/phase-1/phase-1-21/wave-1-contract-archaeology.md`), the individual
 * granted primitives are composed here in the correct order instead. No migration
 * is authorized and none is needed: every statement below uses an existing
 * `app_runtime` grant.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPage,
  buildPageWithCursors,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';

/** Items are listed by SKU — a total order backed by `uq_item_master_sku`. */
export const ITEM_ORDER: OrderingContract = Object.freeze({ key: 'sku', direction: 'asc' });

/**
 * Movements are listed newest-first by `seq`.
 *
 * `seq` is `GENERATED ALWAYS AS IDENTITY` on `inv.stock_movements`, so it is a
 * strict total order that `occurred_at` is not: two movements posted inside one
 * transaction share `now()` to the microsecond, and a timestamp cursor would then
 * skip or repeat rows across a page boundary.
 */
export const MOVEMENT_ORDER: OrderingContract = Object.freeze({ key: 'seq', direction: 'desc' });

/**
 * Reservations are listed newest-first by `created_at` (Phase 1-30 A2, S-14).
 *
 * A reservation has no identity sequence, and `expires_at` is nullable, so
 * `created_at` is the only chronology every row carries. The key is qualified —
 * `ITEM_ORDER` and `MOVEMENT_ORDER` above are two of the three unqualified keys
 * left in the codebase and are not the pattern to copy; a bare `sku` or `seq`
 * could be replayed against any list sorting on a column of that name.
 */
export const RESERVATION_ORDER: OrderingContract = Object.freeze({
  key: 'inv.stock_reservations:created_at_desc',
  direction: 'desc',
});

/**
 * Part issues are listed newest-first by `created_at` (Phase 1-30 A2, S-15).
 *
 * `inv.part_issues` has no separate business instant — there is no `issued_at`
 * column — so `created_at` IS the moment the part left the store, written by the
 * same statement that posted the movement. Naming it here rather than assuming a
 * business-time column exists: measured against the table, not the vocabulary.
 */
export const PART_ISSUE_ORDER: OrderingContract = Object.freeze({
  key: 'inv.part_issues:created_at_desc',
  direction: 'desc',
});

/**
 * Stock locations are listed by `location_code` (Phase 1-30 A2, S-16).
 *
 * `uq_stock_locations_code` makes the code unique within a branch, so it is a
 * total order there, and it is the string an operator actually reads. Ascending,
 * because a location list is a picker and a picker is alphabetical.
 */
export const LOCATION_ORDER: OrderingContract = Object.freeze({
  key: 'inv.stock_locations:location_code_asc',
  direction: 'asc',
});

/** Escapes LIKE metacharacters. Binding a value does not neutralise `%` or `_`. */
function escapeLikeTerm(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export interface ItemRow {
  readonly id: string;
  readonly itemCategoryId: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string | null;
  readonly uomId: string;
  readonly uomCode: string;
  readonly itemType: string;
  readonly isStockTracked: boolean;
  readonly isSerialized: boolean;
  readonly lifecycleStatus: string;
  readonly recordVersion: number;
}

export interface ItemListFilter {
  readonly categoryId?: string;
  readonly itemType?: string;
  readonly lifecycleStatus?: string;
  readonly search?: string;
  readonly stockTrackedOnly?: boolean;
}

/**
 * One balance cell.
 *
 * `availableQty` is the `GENERATED` column, never application arithmetic — the
 * database is the only thing that computes `on_hand − reserved`.
 */
export interface StockBalanceRow {
  /** The balance row's own id — the cursor tie-breaker that makes the order total. */
  readonly id: string;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationType: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly onHandQty: string;
  readonly reservedQty: string;
  readonly availableQty: string;
}

export interface StockLocationRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationCode: string;
  readonly locationType: string;
  readonly status: string;
}

/**
 * A stock location as the picker list renders it (Phase 1-30 A2, S-16).
 *
 * `StockLocationRow` below is the SCOPE ANCHOR used by the write paths and
 * deliberately carries only what those need. This adds `name` and
 * `parentLocationId`, because a list an operator picks from must show the label
 * a human reads and the warehouse a bin nests under — `ck_stock_locations_type`
 * lets `storage` and `quarantine` nest, and two bins in different warehouses can
 * carry indistinguishable names otherwise.
 */
export interface StockLocationListRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationCode: string;
  readonly name: string;
  readonly locationType: string;
  readonly parentLocationId: string | null;
  readonly status: string;
}

export interface ReservationRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly workOrderId: string | null;
  readonly quantity: string;
  readonly status: string;
  readonly idempotencyKey: string | null;
  readonly expiresAt: Date | null;
  readonly recordVersion: number;
}

export interface WorkOrderStateRow {
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly code: string;
  readonly isClosed: boolean;
  readonly isTerminal: boolean;
  readonly allowsJobs: boolean;
}

export interface PartIssueRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly reservationId: string | null;
  readonly quantity: string;
  readonly returnedQty: string;
}

/**
 * One reservation as the list renders it (Phase 1-30 A2, S-14).
 *
 * `ReservationRow` plus the two labels a list needs to be readable — the item's
 * SKU and the location's code. Both are joined from real tables rather than
 * derived, so the shipped read convention holds: an id is returned for
 * navigation, never as the visible label. `createdAt` is added because the list
 * is ordered by it and a reader cannot verify an ordering whose key is invisible.
 */
export interface ReservationListRow extends ReservationRow {
  readonly sku: string;
  readonly locationCode: string;
  readonly createdAt: Date;
}

/**
 * One part issue as the per-work-order list renders it (Phase 1-30 A2, S-15).
 *
 * `PartIssueRow` — including the `returned_qty` sum `readPartIssue` already
 * computes in SQL — plus the SKU and location code, and `createdAt` for the same
 * reason as above. `quantity` and `returnedQty` are `numeric(12,3)` and stay
 * decimal STRINGS; the OUTSTANDING amount is deliberately NOT computed here,
 * because subtracting two decimals in JavaScript is exactly the arithmetic the
 * server-owned-money rule forbids. The consumer has both exact strings.
 */
export interface PartIssueListRow extends PartIssueRow {
  readonly sku: string;
  readonly locationCode: string;
  readonly createdAt: Date;
}

export interface MovementRow {
  readonly id: string;
  readonly seq: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly movementType: string;
  readonly direction: string;
  readonly quantity: string;
  readonly signedQty: string;
  readonly referenceKind: string;
  readonly referenceId: string;
  readonly occurredAt: Date;
  readonly correlationId: string | null;
}

/** A movement a protected function posted, resolved from its business reference. */
export interface PostedMovement {
  readonly id: string;
  readonly direction: string;
  readonly quantity: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly movementType: string;
  readonly companyId: string;
  readonly branchId: string;
  /** Present when the movements were resolved per line rather than per reference. */
  readonly referenceId?: string;
}

export interface MovementListFilter {
  /** REQUIRED. The authorized scope, and a predicate on every query. */
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId?: string;
  readonly locationId?: string;
  readonly workOrderId?: string;
  readonly movementType?: string;
  readonly referenceKind?: string;
  readonly occurredFrom?: string;
  readonly occurredTo?: string;
}

export interface OpeningBatchRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  /** `ck_opening_inventory_batches_code_format`. NOT NULL. */
  readonly batchCode: string;
  readonly status: string;
  /** NOT NULL, and `ck_opening_inventory_batches_maker` forbids approver = counter. */
  readonly countedBy: string;
  readonly approvedBy: string | null;
  readonly recordVersion: number;
}

/** One reconciliation row: the stored balance against the ledger sum. */
export interface BalanceReconciliationRow {
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
}

const ITEM_COLUMNS = `i.id, i.item_category_id, i.sku, i.name, i.description, i.uom_id,
  u.code AS uom_code, i.item_type, i.is_stock_tracked, i.is_serialized,
  i.lifecycle_status, i.record_version`;

interface ItemSql {
  id: string;
  item_category_id: string;
  sku: string;
  name: string;
  description: string | null;
  uom_id: string;
  uom_code: string;
  item_type: string;
  is_stock_tracked: boolean;
  is_serialized: boolean;
  lifecycle_status: string;
  record_version: number;
}

const toItem = (r: ItemSql): ItemRow => ({
  id: r.id,
  itemCategoryId: r.item_category_id,
  sku: r.sku,
  name: r.name,
  description: r.description,
  uomId: r.uom_id,
  uomCode: r.uom_code,
  itemType: r.item_type,
  isStockTracked: r.is_stock_tracked,
  isSerialized: r.is_serialized,
  lifecycleStatus: r.lifecycle_status,
  recordVersion: r.record_version,
});

export class InventoryRepository extends Repository {
  protected readonly module = 'inventory';

  // -------------------------------------------------------------------------
  // P1-21-BE-001 — item search.
  // -------------------------------------------------------------------------

  /**
   * Lists items for the caller's tenant.
   *
   * The UoM is joined rather than looked up per row — that join is the reason this
   * is not an N+1 — and ordering is `(sku, id)`, a total order backed by
   * `uq_item_master_sku`, so a page is stable even when two items share a name.
   *
   * `inv.item_master` has **no** company or branch column: an item is tenant-wide
   * catalog reference data. Branch narrowing therefore belongs to availability
   * (`readAvailability`), not to item search, and this method deliberately offers
   * no branch filter rather than a decorative one.
   */
  public async listItems(
    db: DbHandle,
    filter: ItemListFilter,
    request: PageRequest
  ): Promise<Page<ItemRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId];
    const clauses: string[] = ['i.tenant_id = $1', 'i.deleted_at IS NULL'];

    if (filter.categoryId !== undefined) {
      values.push(filter.categoryId);
      clauses.push(`i.item_category_id = $${values.length}`);
    }
    if (filter.itemType !== undefined) {
      values.push(filter.itemType);
      clauses.push(`i.item_type = $${values.length}`);
    }
    if (filter.lifecycleStatus !== undefined) {
      values.push(filter.lifecycleStatus);
      clauses.push(`i.lifecycle_status = $${values.length}`);
    }
    if (filter.stockTrackedOnly === true) {
      clauses.push('i.is_stock_tracked');
    }
    if (filter.search !== undefined) {
      // Escaped, not merely bound: a bound `%` is still a wildcard, so a search
      // for `%` would return the whole catalog and a literal `_` would match any
      // character. Both are wrong answers to the question the caller asked.
      values.push(`${escapeLikeTerm(filter.search)}%`);
      clauses.push(
        `(i.sku ILIKE $${values.length} ESCAPE '\\'` +
          ` OR i.name ILIKE $${values.length} ESCAPE '\\')`
      );
    }

    const keyset = keysetFragment(
      request,
      { sort: 'i.sku', id: 'i.id' },
      ITEM_ORDER,
      values.length + 1
    );
    const rows = await this.run<ItemSql>(
      db,
      `SELECT ${ITEM_COLUMNS}
         FROM inv.item_master i
         JOIN inv.units_of_measure u ON u.id = i.uom_id
        WHERE ${clauses.join(' AND ')} ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPage(rows.rows.map(toItem), request, ITEM_ORDER, (row) => ({
      sortValue: row.sku,
      id: row.id,
    }));
  }

  public async readItem(db: DbHandle, itemId: string): Promise<ItemRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ItemSql>(
      db,
      `SELECT ${ITEM_COLUMNS}
         FROM inv.item_master i
         JOIN inv.units_of_measure u ON u.id = i.uom_id
        WHERE i.tenant_id = $1 AND i.id = $2 AND i.deleted_at IS NULL`,
      [context.principal.tenantId, itemId]
    );
    return row ? toItem(row) : null;
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-003 — stock availability.
  // -------------------------------------------------------------------------

  /**
   * Reads balance cells.
   *
   * Only the four concepts the protected schema actually stores are returned:
   * `on_hand`, `reserved`, `available` (GENERATED), and the location's type — which
   * is how damaged stock is distinguished, because damage moves units into a
   * `quarantine` location rather than setting a flag. No `damagedQty`,
   * `customerSuppliedQty`, or `externalPurchasePendingQty` field is invented,
   * because no column holds them.
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
    request: PageRequest
  ): Promise<Page<StockBalanceRow>> {
    const context = this.assertContext(db);
    // Company and branch are predicates, not options — see `listMovements`.
    const values: unknown[] = [context.principal.tenantId, filter.companyId, filter.branchId];
    const clauses: string[] = ['b.tenant_id = $1', 'b.company_id = $2', 'b.branch_id = $3'];

    if (filter.itemId !== undefined) {
      values.push(filter.itemId);
      clauses.push(`b.item_id = $${values.length}`);
    }
    if (filter.locationId !== undefined) {
      values.push(filter.locationId);
      clauses.push(`b.location_id = $${values.length}`);
    }
    if (filter.includeQuarantine !== true) {
      clauses.push(`l.location_type <> 'quarantine'`);
    }

    const keyset = keysetFragment(
      request,
      { sort: 'i.sku', id: 'b.id' },
      ITEM_ORDER,
      values.length + 1
    );
    const rows = await this.run<{
      item_id: string;
      sku: string;
      location_id: string;
      location_code: string;
      location_type: string;
      company_id: string;
      branch_id: string;
      on_hand_qty: string;
      reserved_qty: string;
      available_qty: string;
      id: string;
    }>(
      db,
      `SELECT b.id, b.item_id, i.sku, b.location_id, l.location_code, l.location_type,
              b.company_id, b.branch_id, b.on_hand_qty, b.reserved_qty, b.available_qty
         FROM inv.stock_balances b
         JOIN inv.item_master i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
         JOIN inv.stock_locations l
           ON l.tenant_id = b.tenant_id AND l.company_id = b.company_id
          AND l.branch_id = b.branch_id AND l.id = b.location_id
        WHERE ${clauses.join(' AND ')} ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const items: StockBalanceRow[] = rows.rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      sku: r.sku,
      locationId: r.location_id,
      locationCode: r.location_code,
      locationType: r.location_type,
      companyId: r.company_id,
      branchId: r.branch_id,
      onHandQty: r.on_hand_qty,
      reservedQty: r.reserved_qty,
      availableQty: r.available_qty,
    }));
    return buildPage(items, request, ITEM_ORDER, (row) => ({
      sortValue: row.sku,
      id: row.id,
    }));
  }

  // -------------------------------------------------------------------------
  // Scope anchors.
  // -------------------------------------------------------------------------

  /**
   * One branch's stock locations, by code (Phase 1-30 A2, seam S-16).
   *
   * The caller has already authorized `(companyId, branchId)` - they are the
   * operation's `authorizationTarget`, exactly as on `inv.stock-movement-list`.
   * They are bound as filter columns here as well: RLS narrows to
   * `app.branch_ids`, the permission-blind union of every active grant, so
   * without the explicit predicate a caller holding `inv.stock.read` in one
   * branch could read another branch's locations through a grant carrying a
   * different permission (P1-18-A-01).
   *
   * `ix_stock_locations_branch` covers the equality prefix and
   * `uq_stock_locations_code` orders inside it.
   */
  public async listLocations(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly locationType?: string | undefined;
      readonly status?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<StockLocationListRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.locationType ?? null,
      filter.status ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'location_code', id: 'id' },
      LOCATION_ORDER,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      company_id: string;
      branch_id: string;
      location_code: string;
      name: string;
      location_type: string;
      parent_location_id: string | null;
      status: string;
    }>(
      db,
      // Optional filters are bound as `($n::type IS NULL OR col = $n)` so no
      // predicate is assembled from input and the keyset parameter index is fixed.
      `SELECT id, company_id, branch_id, location_code, name, location_type,
              parent_location_id, status
         FROM inv.stock_locations
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND deleted_at IS NULL
          AND ($4::text IS NULL OR location_type = $4)
          AND ($5::text IS NULL OR status = $5)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPage(
      result.rows.map((row) => ({
        id: row.id,
        companyId: row.company_id,
        branchId: row.branch_id,
        locationCode: row.location_code,
        name: row.name,
        locationType: row.location_type,
        parentLocationId: row.parent_location_id,
        status: row.status,
      })),
      request,
      LOCATION_ORDER,
      (row) => ({ sortValue: row.locationCode, id: row.id })
    );
  }

  /**
   * One branch's stock reservations, newest first (Phase 1-30 A2, seam S-14).
   *
   * `(companyId, branchId)` are REQUIRED and are the operation's
   * `authorizationTarget` - the `inv.stock-movement-list` precedent, for the
   * reason recorded there: optional scope columns skip `authorizeScope`
   * altogether and leave RLS as the only narrowing.
   *
   * `expiresAt` is published as it is stored, including NULL. A reservation with
   * no expiry is a genuine state (`inv.reserve_stock` may be called without one),
   * and substituting a far-future instant would make an open commitment look
   * time-bounded.
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
    request: PageRequest
  ): Promise<Page<ReservationListRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.itemId ?? null,
      filter.locationId ?? null,
      filter.workOrderId ?? null,
      filter.status ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'r.created_at', id: 'r.id' },
      RESERVATION_ORDER,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      company_id: string;
      branch_id: string;
      item_id: string;
      sku: string;
      location_id: string;
      location_code: string;
      work_order_id: string | null;
      quantity: string;
      status: string;
      idempotency_key: string | null;
      expires_at: Date | null;
      record_version: number;
      created_at: Date;
      sort_value: string;
    }>(
      db,
      `SELECT r.id, r.company_id, r.branch_id, r.item_id, i.sku,
              r.location_id, l.location_code, r.work_order_id,
              r.quantity, r.status, r.idempotency_key, r.expires_at,
              r.record_version, r.created_at,
              ${cursorTimestamp('r.created_at')} AS sort_value
         FROM inv.stock_reservations r
         JOIN inv.item_master i ON i.tenant_id = r.tenant_id AND i.id = r.item_id
         JOIN inv.stock_locations l ON l.tenant_id = r.tenant_id AND l.id = r.location_id
        WHERE r.tenant_id = $1 AND r.company_id = $2 AND r.branch_id = $3
          AND ($4::uuid IS NULL OR r.item_id = $4)
          AND ($5::uuid IS NULL OR r.location_id = $5)
          AND ($6::uuid IS NULL OR r.work_order_id = $6)
          AND ($7::text IS NULL OR r.status = $7)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          id: row.id,
          companyId: row.company_id,
          branchId: row.branch_id,
          itemId: row.item_id,
          sku: row.sku,
          locationId: row.location_id,
          locationCode: row.location_code,
          workOrderId: row.work_order_id,
          quantity: row.quantity,
          status: row.status,
          idempotencyKey: row.idempotency_key,
          expiresAt: row.expires_at,
          recordVersion: row.record_version,
          createdAt: row.created_at,
        },
        // Microsecond precision, minted in SQL. A JS `Date` truncates to
        // milliseconds and silently SKIPS every row sharing the boundary row's
        // millisecond (`P1-27-INT-006`) - and reservations posted by one
        // transaction share `transaction_timestamp()` exactly.
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      RESERVATION_ORDER
    );
  }

  /**
   * One WORK ORDER's part issues, newest first (Phase 1-30 A2, seam S-15).
   *
   * Keyed on `work_order_id`, not on a caller-supplied branch. The parent row is
   * what the application check authorizes - `InventoryReadService` resolves it
   * through `@/modules/work-order` first - so the collection cannot be addressed
   * without naming a work order the caller may see. A top-level
   * `GET /stock-issues?workOrderId=...` would name no parent and leave the
   * declared `scope: 'branch'` inert (P1-18-A-01).
   *
   * `returned_qty` is the SAME correlated sum `readPartIssue` computes, in SQL,
   * over `inv.part_returns`. Both quantities cross as decimal STRINGS and neither
   * is netted here: `numeric(12,3)` subtraction in JavaScript is precisely the
   * arithmetic the server-owned-amount rule forbids.
   */
  public async listPartIssuesForWorkOrder(
    db: DbHandle,
    workOrderId: string,
    request: PageRequest
  ): Promise<Page<PartIssueListRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, workOrderId];
    const keyset = keysetFragment(
      request,
      { sort: 'pi.created_at', id: 'pi.id' },
      PART_ISSUE_ORDER,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      company_id: string;
      branch_id: string;
      work_order_id: string;
      item_id: string;
      sku: string;
      location_id: string;
      location_code: string;
      reservation_id: string | null;
      quantity: string;
      returned_qty: string;
      created_at: Date;
      sort_value: string;
    }>(
      db,
      `SELECT pi.id, pi.company_id, pi.branch_id, pi.work_order_id, pi.item_id, i.sku,
              pi.location_id, l.location_code, pi.reservation_id, pi.quantity,
              COALESCE((SELECT sum(pr.quantity) FROM inv.part_returns pr
                         WHERE pr.tenant_id = pi.tenant_id
                           AND pr.part_issue_id = pi.id), 0)::text AS returned_qty,
              pi.created_at,
              ${cursorTimestamp('pi.created_at')} AS sort_value
         FROM inv.part_issues pi
         JOIN inv.item_master i ON i.tenant_id = pi.tenant_id AND i.id = pi.item_id
         JOIN inv.stock_locations l ON l.tenant_id = pi.tenant_id AND l.id = pi.location_id
        WHERE pi.tenant_id = $1 AND pi.work_order_id = $2 AND pi.deleted_at IS NULL
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          id: row.id,
          companyId: row.company_id,
          branchId: row.branch_id,
          workOrderId: row.work_order_id,
          itemId: row.item_id,
          sku: row.sku,
          locationId: row.location_id,
          locationCode: row.location_code,
          reservationId: row.reservation_id,
          quantity: row.quantity,
          returnedQty: row.returned_qty,
          createdAt: row.created_at,
        },
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      PART_ISSUE_ORDER
    );
  }

  /**
   * Reads a stock location.
   *
   * The location is the **scope anchor** for every movement:
   * `inv.post_stock_movement` derives `company_id`/`branch_id` from it rather than
   * from anything the caller sends, so resolving it here is what lets a route
   * supply a concrete `authorizationTarget` (P1-18-A-01) instead of falling back to
   * a scope-blind permission check.
   */
  public async readLocation(db: DbHandle, locationId: string): Promise<StockLocationRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      branch_id: string;
      location_code: string;
      location_type: string;
      status: string;
    }>(
      db,
      `SELECT id, company_id, branch_id, location_code, location_type, status
         FROM inv.stock_locations
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, locationId]
    );
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          branchId: row.branch_id,
          locationCode: row.location_code,
          locationType: row.location_type,
          status: row.status,
        }
      : null;
  }

  /**
   * Reads a work order with its configured state flags, locking the row.
   *
   * `FOR UPDATE` on the work order is what makes the lifecycle check meaningful:
   * without it a concurrent transition could close the work order between the check
   * and the issue. `wo.work_order_states` is a data-driven graph, so the flags are
   * read rather than hard-coded.
   */
  public async lockWorkOrderState(
    db: DbHandle,
    workOrderId: string
  ): Promise<WorkOrderStateRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      work_order_id: string;
      company_id: string;
      branch_id: string;
      code: string;
      is_closed: boolean;
      is_terminal: boolean;
      allows_jobs: boolean;
    }>(
      db,
      // ORDER BY is load-bearing, not cosmetic. `wo.work_order_states` carries TWO
      // unique indexes — one for platform codes, one per tenant — so a tenant row may
      // legally shadow a platform code and this join then matches both. Without the
      // ordering the flag set would be whichever row the planner returned, and two
      // call sites could reach opposite lifecycle verdicts for the same work order.
      // `wo.guard_work_order_transition` and `WorkOrderCatalogRepository` both resolve
      // it the same way: a tenant row shadows the platform row of the same code.
      `SELECT w.id AS work_order_id, w.company_id, w.branch_id,
              s.code, s.is_closed, s.is_terminal, s.allows_jobs
         FROM wo.work_orders w
         JOIN wo.work_order_states s
           ON s.code = w.state
          AND (s.scope = 'platform' OR s.tenant_id = w.tenant_id)
        WHERE w.tenant_id = $1 AND w.id = $2
        ORDER BY (s.scope = 'tenant') DESC
        LIMIT 1
          FOR UPDATE OF w`,
      [context.principal.tenantId, workOrderId]
    );
    return row
      ? {
          workOrderId: row.work_order_id,
          companyId: row.company_id,
          branchId: row.branch_id,
          code: row.code,
          isClosed: row.is_closed,
          isTerminal: row.is_terminal,
          allowsJobs: row.allows_jobs,
        }
      : null;
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-002 — opening balances.
  // -------------------------------------------------------------------------

  public async createOpeningBatch(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly batchCode: string;
      readonly asOfDate: string;
      readonly countedBy: string;
      readonly notes: string | null;
    }
  ): Promise<OpeningBatchRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      branch_id: string;
      batch_code: string;
      status: string;
      counted_by: string;
      approved_by: string | null;
      record_version: number;
    }>(
      db,
      `INSERT INTO inv.opening_inventory_batches
         (tenant_id, company_id, branch_id, batch_code, as_of_date, counted_by, notes, created_by)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)
       RETURNING id, company_id, branch_id, batch_code, status, counted_by, approved_by,
                 record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.batchCode,
        input.asOfDate,
        input.countedBy,
        input.notes,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('inventory: opening batch insert returned no row');
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      batchCode: row.batch_code,
      status: row.status,
      countedBy: row.counted_by,
      approvedBy: row.approved_by,
      recordVersion: row.record_version,
    };
  }

  public async readOpeningBatch(db: DbHandle, batchId: string): Promise<OpeningBatchRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      branch_id: string;
      batch_code: string;
      status: string;
      counted_by: string;
      approved_by: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, company_id, branch_id, batch_code, status, counted_by, approved_by,
              record_version
         FROM inv.opening_inventory_batches
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, batchId]
    );
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          branchId: row.branch_id,
          batchCode: row.batch_code,
          status: row.status,
          countedBy: row.counted_by,
          approvedBy: row.approved_by,
          recordVersion: row.record_version,
        }
      : null;
  }

  /** Adds an opening line. Quantity is bound as an exact decimal string. */
  public async addOpeningLine(
    db: DbHandle,
    input: {
      readonly batchId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId: string;
      readonly locationId: string;
      readonly quantity: string;
    }
  ): Promise<{ readonly id: string }> {
    const context = this.assertContext(db);
    // The line carries its OWN company and branch — both NOT NULL, and what its RLS
    // policy narrows on, so they cannot be left to be inherited silently.
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO inv.opening_inventory_lines
         (tenant_id, company_id, branch_id, batch_id, item_id, location_id, quantity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.batchId,
        input.itemId,
        input.locationId,
        input.quantity,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('inventory: opening line insert returned no row');
    return { id: row.id };
  }

  /** Counts lines on a batch, so an empty batch is not silently approved. */
  public async countOpeningLines(db: DbHandle, batchId: string): Promise<number> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM inv.opening_inventory_lines
        WHERE tenant_id = $1 AND batch_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, batchId]
    );
    return Number(row?.n ?? '0');
  }

  /**
   * Approves a batch, which posts one `opening` movement per line.
   *
   * `inv.approve_opening_batch` enforces draft-only and stamps the approver;
   * `ck_opening_inventory_batches_maker_checker` enforces maker ≠ approver. Both
   * stay in the database — this is a call, not a reimplementation.
   */
  public async approveOpeningBatch(db: DbHandle, batchId: string): Promise<void> {
    await this.run(db, `SELECT inv.approve_opening_batch($1)`, [batchId]);
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-004/005/013 — reservations.
  // -------------------------------------------------------------------------

  /**
   * Reserves stock through the protected single-winner primitive.
   *
   * `inv.reserve_stock` takes the balance-row lock, opportunistically expires stale
   * rows for the cell, re-reads `on_hand` and the active-reservation sum **inside**
   * the lock, and raises `23514` when the request exceeds availability. That is why
   * two concurrent requests for the same final unit produce exactly one winner —
   * and why this method never pre-checks availability itself.
   *
   * Idempotency spans the reservation's whole lifetime via
   * `uq_stock_reservations_idempotency`, and the function resolves a replay inside
   * the lock by returning the existing id.
   */
  public async reserveStock(
    db: DbHandle,
    input: {
      readonly itemId: string;
      readonly locationId: string;
      readonly quantity: string;
      readonly workOrderId: string | null;
      readonly idempotencyKey: string | null;
      readonly expiresAt: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<{ readonly id: string }> {
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.reserve_stock($1, $2, $3::numeric, $4, $5, $6::timestamptz, $7) AS id`,
      [
        input.itemId,
        input.locationId,
        input.quantity,
        input.workOrderId,
        input.idempotencyKey,
        input.expiresAt,
        input.correlationId,
      ]
    );
    if (!row?.id) throw new Error('inventory: reserve_stock returned no id');
    return { id: row.id };
  }

  /**
   * Looks a reservation up by its idempotency key.
   *
   * Called BEFORE `reserve_stock` so a replay can be reported as a replay.
   * `inv.reserve_stock` resolves the key inside the balance lock and returns the
   * existing id, which is correct but indistinguishable from a fresh reservation
   * once it returns — the caller cannot tell whether its retry booked new stock.
   * `uq_stock_reservations_idempotency` spans the whole lifetime, so a released or
   * consumed reservation is found here too.
   */
  public async readReservationByIdempotencyKey(
    db: DbHandle,
    idempotencyKey: string
  ): Promise<ReservationRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT id FROM inv.stock_reservations
        WHERE tenant_id = $1 AND idempotency_key = $2`,
      [context.principal.tenantId, idempotencyKey]
    );
    return row ? this.readReservation(db, row.id) : null;
  }

  public async readReservation(
    db: DbHandle,
    reservationId: string
  ): Promise<ReservationRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      branch_id: string;
      item_id: string;
      location_id: string;
      work_order_id: string | null;
      quantity: string;
      status: string;
      idempotency_key: string | null;
      expires_at: Date | null;
      record_version: number;
    }>(
      db,
      `SELECT id, company_id, branch_id, item_id, location_id, work_order_id,
              quantity, status, idempotency_key, expires_at, record_version
         FROM inv.stock_reservations
        WHERE tenant_id = $1 AND id = $2`,
      [context.principal.tenantId, reservationId]
    );
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          branchId: row.branch_id,
          itemId: row.item_id,
          locationId: row.location_id,
          workOrderId: row.work_order_id,
          quantity: row.quantity,
          status: row.status,
          idempotencyKey: row.idempotency_key,
          expiresAt: row.expires_at,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * Releases a reservation.
   *
   * `inv.release_reservation` is a no-op when the reservation is already terminal —
   * a duplicate release is therefore safe rather than an error, which is the
   * behaviour a retrying client needs.
   */
  public async releaseReservation(
    db: DbHandle,
    reservationId: string,
    reason: string
  ): Promise<void> {
    await this.run(db, `SELECT inv.release_reservation($1, $2)`, [reservationId, reason]);
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-006 — issue to work order.
  // -------------------------------------------------------------------------

  /**
   * Issues stock to a work order in the ONLY order the constraints permit.
   *
   * `inv.issue_part` posts the `out` movement before consuming the reservation, so
   * `on_hand` drops while `reserved` is still held and
   * `ck_stock_balances_available` (`on_hand − reserved >= 0`) rejects the write
   * whenever the reservation covers the stock being issued. That is finding
   * `P1-21-D-01`, reproduced against a live database: the natural
   * reserve-exactly-then-issue flow fails inside the protected function.
   *
   * The fix is ordering, not privilege. The same three granted operations run here
   * as `part_issues` insert → `consume_reservation` → `post_stock_movement`, so
   * `reserved` is released before `on_hand` falls and the invariant never dips
   * below zero. Every guard still applies: the provenance trigger binds the
   * movement to the issue row's quantity, and the balance coherence guard re-derives
   * both sums.
   */
  public async issuePart(
    db: DbHandle,
    input: {
      readonly workOrderId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId: string;
      readonly locationId: string;
      readonly quantity: string;
      readonly reservationId: string | null;
      readonly requiredPartRef: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<{ readonly issueId: string; readonly movementId: string }> {
    const context = this.assertContext(db);
    const issue = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO inv.part_issues
         (tenant_id, company_id, branch_id, work_order_id, item_id, location_id,
          reservation_id, required_part_ref, quantity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.itemId,
        input.locationId,
        input.reservationId,
        input.requiredPartRef,
        input.quantity,
        context.principal.userId,
      ]
    );
    if (!issue) throw new Error('inventory: part issue insert returned no row');

    // Release the reservation FIRST. See the ordering note above.
    if (input.reservationId !== null) {
      await this.run(db, `SELECT inv.consume_reservation($1)`, [input.reservationId]);
    }

    const movement = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.post_stock_movement($1, $2, 'issue', 'out', $3::numeric,
                                      'part_issue', $4, $5) AS id`,
      [input.itemId, input.locationId, input.quantity, issue.id, input.correlationId]
    );
    if (!movement?.id) throw new Error('inventory: issue movement returned no id');
    return { issueId: issue.id, movementId: movement.id };
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-007 — return from work order.
  // -------------------------------------------------------------------------

  /**
   * Reads a part issue with the quantity already returned against it.
   *
   * The returned sum is what makes over-return detectable before the ceiling
   * trigger has to raise; the trigger stays the trust root.
   */
  public async readPartIssue(db: DbHandle, partIssueId: string): Promise<PartIssueRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      branch_id: string;
      work_order_id: string;
      item_id: string;
      location_id: string;
      reservation_id: string | null;
      quantity: string;
      returned_qty: string;
    }>(
      db,
      `SELECT pi.id, pi.company_id, pi.branch_id, pi.work_order_id, pi.item_id,
              pi.location_id, pi.reservation_id, pi.quantity,
              COALESCE((SELECT sum(pr.quantity) FROM inv.part_returns pr
                         WHERE pr.tenant_id = pi.tenant_id
                           AND pr.part_issue_id = pi.id), 0)::text AS returned_qty
         FROM inv.part_issues pi
        WHERE pi.tenant_id = $1 AND pi.id = $2 AND pi.deleted_at IS NULL`,
      [context.principal.tenantId, partIssueId]
    );
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          branchId: row.branch_id,
          workOrderId: row.work_order_id,
          itemId: row.item_id,
          locationId: row.location_id,
          reservationId: row.reservation_id,
          quantity: row.quantity,
          returnedQty: row.returned_qty,
        }
      : null;
  }

  /**
   * Returns a previously issued part.
   *
   * `inv.return_part` row-locks the parent issue and enforces
   * `Σ returns ≤ issued`; `inv.guard_part_return_ceiling` enforces the same rule at
   * the constraint layer, which is what closes the phantom-stock path a raw insert
   * would otherwise open. The ordering problem does not arise here: a return is an
   * `in` movement, so `on_hand` rises and the available invariant cannot dip.
   */
  public async returnPart(
    db: DbHandle,
    input: {
      readonly partIssueId: string;
      readonly quantity: string;
      readonly reason: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<{ readonly returnId: string }> {
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.return_part($1, $2::numeric, $3, $4) AS id`,
      [input.partIssueId, input.quantity, input.reason, input.correlationId]
    );
    if (!row?.id) throw new Error('inventory: return_part returned no id');
    return { returnId: row.id };
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-008 — damaged return.
  // -------------------------------------------------------------------------

  /**
   * Records damage as a paired movement out of sellable stock and in to quarantine.
   *
   * `inv.record_damage` frees conflicting reservations at the sellable location
   * first (`inv.free_reservations_for_loss`), so reducing `on_hand` cannot drive
   * `available` negative, then posts both legs. The two legs are distinguishable to
   * `uq_stock_movements_source` only by `direction`, which is why damage is the one
   * reference kind that legitimately produces two rows.
   */
  public async recordDamage(
    db: DbHandle,
    input: {
      readonly itemId: string;
      readonly fromLocationId: string;
      readonly quarantineLocationId: string;
      readonly quantity: string;
      readonly reason: string;
      readonly disposition: string;
      readonly responsiblePartyRef: string | null;
      readonly evidenceRef: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<{ readonly damageId: string }> {
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.record_damage($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9) AS id`,
      [
        input.itemId,
        input.fromLocationId,
        input.quarantineLocationId,
        input.quantity,
        input.reason,
        input.disposition,
        input.responsiblePartyRef,
        input.evidenceRef,
        input.correlationId,
      ]
    );
    if (!row?.id) throw new Error('inventory: record_damage returned no id');
    return { damageId: row.id };
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-009 — customer-supplied part (NO stock effect).
  // -------------------------------------------------------------------------

  /**
   * Records a customer-owned part in custody.
   *
   * Deliberately posts **no movement and touches no balance**:
   * `inv.customer_supplied_parts` is "custody-tracked, never valued stock" and
   * `ck_customer_supplied_parts_owned CHECK (customer_owned)` makes company
   * ownership unrepresentable. There is no `customer_supplied` reference kind, so a
   * movement citing one could not be posted even if this tried.
   */
  public async recordCustomerSuppliedPart(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly workOrderId: string;
      readonly receptionVisitRef: string | null;
      readonly itemRef: string | null;
      readonly description: string;
      readonly quantity: string;
      readonly custodyState: string;
      readonly itemCondition: string | null;
      readonly evidenceRef: string | null;
    }
  ): Promise<{ readonly id: string; readonly recordVersion: number }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string; record_version: number }>(
      db,
      `INSERT INTO inv.customer_supplied_parts
         (tenant_id, company_id, branch_id, work_order_id, reception_visit_ref, item_ref,
          description, quantity, custody_state, item_condition, evidence_ref, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9, $10, $11, $12)
       RETURNING id, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.receptionVisitRef,
        input.itemRef,
        input.description,
        input.quantity,
        input.custodyState,
        input.itemCondition,
        input.evidenceRef,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('inventory: customer-supplied insert returned no row');
    return { id: row.id, recordVersion: row.record_version };
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-010 — external-purchase part entry (NON-procurement).
  // -------------------------------------------------------------------------

  /**
   * Records an ad-hoc external purchase reference against a work order.
   *
   * `ck_external_purchase_parts_not_procurement CHECK (is_procurement = false)` is
   * the schema refusing to be a procurement workflow, so this method records a
   * reference and nothing more: no purchase order, no goods receipt, no stock
   * movement. Unit cost, when supplied, goes to the restricted 1:1 detail whose
   * every RLS policy is gated by `inv.cost.view` — a caller without that permission
   * cannot write it and cannot read it back.
   */
  public async recordExternalPurchasePart(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly workOrderId: string;
      readonly supplierPartnerId: string | null;
      readonly supplierName: string | null;
      readonly itemRef: string | null;
      readonly description: string;
      readonly quantity: string;
      readonly status: string;
      readonly evidenceRef: string | null;
    }
  ): Promise<{ readonly id: string; readonly recordVersion: number }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string; record_version: number }>(
      db,
      `INSERT INTO inv.external_purchase_parts
         (tenant_id, company_id, branch_id, work_order_id, supplier_partner_id, supplier_name,
          item_ref, description, quantity, status, evidence_ref, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10, $11, $12)
       RETURNING id, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.supplierPartnerId,
        input.supplierName,
        input.itemRef,
        input.description,
        input.quantity,
        input.status,
        input.evidenceRef,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('inventory: external-purchase insert returned no row');
    return { id: row.id, recordVersion: row.record_version };
  }

  /** Writes the restricted unit cost. Fails `42501`-style via RLS without `inv.cost.view`. */
  public async recordExternalPurchaseCost(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly externalPurchasePartId: string;
      readonly unitCost: string;
      readonly currencyCode: string;
    }
  ): Promise<{ readonly id: string }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO inv.external_purchase_part_details
         (tenant_id, company_id, branch_id, external_purchase_part_id, unit_cost,
          currency_code, created_by)
       VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.externalPurchasePartId,
        input.unitCost,
        input.currencyCode,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('inventory: external-purchase cost insert returned no row');
    return { id: row.id };
  }

  /**
   * Finds the movements a protected function just posted for one business reference.
   *
   * `inv.return_part`, `inv.record_damage` and `inv.approve_opening_batch` return the
   * business row's id, not the movement id — so publishing `stock.movement.posted`
   * for them needs this lookup. `uq_stock_movements_source` makes
   * `(reference_kind, reference_id, direction)` unique, so a reference yields one row
   * per direction: one for a return or an opening line, two for damage.
   */
  public async findMovementsForReference(
    db: DbHandle,
    referenceKind: string,
    referenceId: string
  ): Promise<readonly PostedMovement[]> {
    const context = this.assertContext(db);
    const rows = await this.run<{
      id: string;
      direction: string;
      quantity: string;
      item_id: string;
      location_id: string;
      movement_type: string;
      company_id: string;
      branch_id: string;
    }>(
      db,
      `SELECT id, direction, quantity, item_id, location_id, movement_type,
              company_id, branch_id
         FROM inv.stock_movements
        WHERE tenant_id = $1 AND reference_kind = $2 AND reference_id = $3
        ORDER BY direction`,
      [context.principal.tenantId, referenceKind, referenceId]
    );
    return rows.rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      quantity: r.quantity,
      itemId: r.item_id,
      locationId: r.location_id,
      movementType: r.movement_type,
      companyId: r.company_id,
      branchId: r.branch_id,
    }));
  }

  /**
   * The `opening` movements an approved batch posted, one per counted line.
   *
   * `inv.approve_opening_batch` returns void and loops over the lines internally, so
   * the movements can only be found through the lines that referenced them.
   */
  public async findOpeningMovementsForBatch(
    db: DbHandle,
    batchId: string
  ): Promise<readonly PostedMovement[]> {
    const context = this.assertContext(db);
    const rows = await this.run<{
      id: string;
      direction: string;
      quantity: string;
      item_id: string;
      location_id: string;
      movement_type: string;
      company_id: string;
      branch_id: string;
      reference_id: string;
    }>(
      db,
      `SELECT m.id, m.direction, m.quantity, m.item_id, m.location_id, m.movement_type,
              m.company_id, m.branch_id, m.reference_id
         FROM inv.stock_movements m
         JOIN inv.opening_inventory_lines l
           ON l.tenant_id = m.tenant_id AND l.id = m.reference_id
        WHERE m.tenant_id = $1 AND m.reference_kind = 'opening_line' AND l.batch_id = $2
        ORDER BY m.seq`,
      [context.principal.tenantId, batchId]
    );
    return rows.rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      quantity: r.quantity,
      itemId: r.item_id,
      locationId: r.location_id,
      movementType: r.movement_type,
      companyId: r.company_id,
      branchId: r.branch_id,
      referenceId: r.reference_id,
    }));
  }

  /**
   * The active reservations at one cell.
   *
   * Read BEFORE `inv.record_damage`, because that function calls
   * `inv.free_reservations_for_loss`, which terminates reservations the application
   * never named. Comparing before and after is the only way to attribute a
   * loss-driven release to the damage that caused it.
   */
  public async activeReservationsAt(
    db: DbHandle,
    itemId: string,
    locationId: string
  ): Promise<readonly ReservationRow[]> {
    const context = this.assertContext(db);
    const rows = await this.run<{ id: string }>(
      db,
      `SELECT id FROM inv.stock_reservations
        WHERE tenant_id = $1 AND item_id = $2 AND location_id = $3 AND status = 'active'
        ORDER BY created_at DESC, id DESC`,
      [context.principal.tenantId, itemId, locationId]
    );
    const out: ReservationRow[] = [];
    for (const row of rows.rows) {
      const full = await this.readReservation(db, row.id);
      if (full) out.push(full);
    }
    return out;
  }

  /**
   * Reads a reservation and LOCKS it, so a status decision cannot be raced.
   *
   * `inv.release_reservation` silently returns when the row is no longer `active`.
   * Deciding "did this call change anything" from an unlocked pre-read is therefore
   * wrong: a concurrent issue can consume the reservation in between, and the release
   * would then record an audit entry and publish an event for a transition that never
   * happened — telling consumers the quantity returned to available when it had in
   * fact left through an `out` movement.
   */
  public async lockReservation(
    db: DbHandle,
    reservationId: string
  ): Promise<ReservationRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT id FROM inv.stock_reservations
        WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
      [context.principal.tenantId, reservationId]
    );
    return row ? this.readReservation(db, row.id) : null;
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-011 — movement history.
  // -------------------------------------------------------------------------

  /**
   * Lists movements, newest first, keyed on `seq`.
   *
   * The work-order filter resolves through the reference rather than a column,
   * because `inv.stock_movements` has no `work_order_id`: an issue's work order is
   * on `inv.part_issues`, and a return's is on the issue its `part_returns` row
   * points at. Doing it in one `EXISTS` per kind keeps the correlation honest
   * instead of inventing a denormalised column the schema does not have.
   */
  public async listMovements(
    db: DbHandle,
    filter: MovementListFilter,
    request: PageRequest
  ): Promise<Page<MovementRow>> {
    const context = this.assertContext(db);
    // Company and branch are predicates, not options. RLS narrows too, but on the
    // permission-blind grant union — so this is the predicate that makes the read
    // match the scope that was actually authorized.
    const values: unknown[] = [context.principal.tenantId, filter.companyId, filter.branchId];
    const clauses: string[] = ['m.tenant_id = $1', 'm.company_id = $2', 'm.branch_id = $3'];

    if (filter.itemId !== undefined) {
      values.push(filter.itemId);
      clauses.push(`m.item_id = $${values.length}`);
    }
    if (filter.locationId !== undefined) {
      values.push(filter.locationId);
      clauses.push(`m.location_id = $${values.length}`);
    }
    if (filter.movementType !== undefined) {
      values.push(filter.movementType);
      clauses.push(`m.movement_type = $${values.length}`);
    }
    if (filter.referenceKind !== undefined) {
      values.push(filter.referenceKind);
      clauses.push(`m.reference_kind = $${values.length}`);
    }
    if (filter.occurredFrom !== undefined) {
      values.push(filter.occurredFrom);
      clauses.push(`m.occurred_at >= $${values.length}::timestamptz`);
    }
    if (filter.occurredTo !== undefined) {
      values.push(filter.occurredTo);
      clauses.push(`m.occurred_at < $${values.length}::timestamptz`);
    }
    if (filter.workOrderId !== undefined) {
      values.push(filter.workOrderId);
      const p = values.length;
      clauses.push(`(
        (m.reference_kind = 'part_issue' AND EXISTS (
           SELECT 1 FROM inv.part_issues pi
            WHERE pi.tenant_id = m.tenant_id AND pi.id = m.reference_id
              AND pi.work_order_id = $${p}))
        OR (m.reference_kind = 'part_return' AND EXISTS (
           SELECT 1 FROM inv.part_returns pr
             JOIN inv.part_issues pi2 ON pi2.tenant_id = pr.tenant_id
                                     AND pi2.id = pr.part_issue_id
            WHERE pr.tenant_id = m.tenant_id AND pr.id = m.reference_id
              AND pi2.work_order_id = $${p}))
      )`);
    }

    const keyset = keysetFragment(
      request,
      { sort: 'm.seq', id: 'm.id' },
      MOVEMENT_ORDER,
      values.length + 1
    );
    const rows = await this.run<{
      id: string;
      seq: string;
      company_id: string;
      branch_id: string;
      item_id: string;
      sku: string;
      location_id: string;
      movement_type: string;
      direction: string;
      quantity: string;
      signed_qty: string;
      reference_kind: string;
      reference_id: string;
      occurred_at: Date;
      correlation_id: string | null;
    }>(
      db,
      `SELECT m.id, m.seq::text AS seq, m.company_id, m.branch_id, m.item_id, i.sku,
              m.location_id, m.movement_type, m.direction, m.quantity, m.signed_qty,
              m.reference_kind, m.reference_id, m.occurred_at, m.correlation_id
         FROM inv.stock_movements m
         JOIN inv.item_master i ON i.tenant_id = m.tenant_id AND i.id = m.item_id
        WHERE ${clauses.join(' AND ')} ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const items: MovementRow[] = rows.rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      companyId: r.company_id,
      branchId: r.branch_id,
      itemId: r.item_id,
      sku: r.sku,
      locationId: r.location_id,
      movementType: r.movement_type,
      direction: r.direction,
      quantity: r.quantity,
      signedQty: r.signed_qty,
      referenceKind: r.reference_kind,
      referenceId: r.reference_id,
      occurredAt: r.occurred_at,
      correlationId: r.correlation_id,
    }));
    return buildPage(items, request, MOVEMENT_ORDER, (row) => ({
      sortValue: row.seq,
      id: row.id,
    }));
  }

  // -------------------------------------------------------------------------
  // P1-21-BE-014 — inventory audit / reconciliation.
  // -------------------------------------------------------------------------

  /**
   * Reconciles every stored balance against the movement ledger.
   *
   * This re-derives what `inv.guard_stock_balance_coherence` asserts on write, so a
   * `coherent = false` row would mean the guard had been bypassed. It is a read:
   * the evidence an operator needs to show that stored balances still equal
   * `Σ signed_qty` and `Σ active reservations`, without trusting the cache that is
   * being audited.
   */
  public async reconcileBalances(
    db: DbHandle,
    filter: { readonly companyId: string; readonly branchId: string; readonly itemId?: string },
    limit: number
  ): Promise<readonly BalanceReconciliationRow[]> {
    const context = this.assertContext(db);
    // H6: company AND branch are PREDICATES, and neither is optional.
    //
    // This read used to filter on `branch_id` alone. `iam.has_permission_in_scope`
    // matches (scope_type='company' AND company_id = p_company) OR (scope_type='branch'
    // AND branch_id = p_branch), so a caller holding the permission COMPANY-scoped to
    // company X passes the check while naming a branch of company Y — and the branch-only
    // filter then returned company Y's balances, admitted by RLS because
    // `iam.allowed_branch_ids()` is the permission-blind union of every active grant.
    // Measured before the fix: 200 with `companyId=<A1>&branchId=<branch of A9>`
    // returning A9's SKU and on-hand, while `/stock-availability` with the identical
    // pair returned zero items — because IT carries both predicates. This is that same
    // pair of predicates, so the incoherent pair now selects nothing structurally.
    const values: unknown[] = [context.principal.tenantId, filter.companyId, filter.branchId];
    const clauses: string[] = ['b.tenant_id = $1', 'b.company_id = $2', 'b.branch_id = $3'];
    if (filter.itemId !== undefined) {
      values.push(filter.itemId);
      clauses.push(`b.item_id = $${values.length}`);
    }
    values.push(limit);
    const rows = await this.run<{
      item_id: string;
      sku: string;
      location_id: string;
      company_id: string;
      branch_id: string;
      stored_on_hand: string;
      ledger_on_hand: string;
      stored_reserved: string;
      active_reserved: string;
      coherent: boolean;
    }>(
      db,
      `SELECT b.item_id, i.sku, b.location_id, b.company_id, b.branch_id,
              b.on_hand_qty AS stored_on_hand,
              COALESCE(led.total, 0)::text AS ledger_on_hand,
              b.reserved_qty AS stored_reserved,
              COALESCE(res.total, 0)::text AS active_reserved,
              (b.on_hand_qty = COALESCE(led.total, 0)
               AND b.reserved_qty = COALESCE(res.total, 0)) AS coherent
         FROM inv.stock_balances b
         JOIN inv.item_master i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
         LEFT JOIN LATERAL (
           SELECT sum(m.signed_qty) AS total FROM inv.stock_movements m
            WHERE m.tenant_id = b.tenant_id AND m.item_id = b.item_id
              AND m.location_id = b.location_id) led ON true
         LEFT JOIN LATERAL (
           SELECT sum(r.quantity) AS total FROM inv.stock_reservations r
            WHERE r.tenant_id = b.tenant_id AND r.item_id = b.item_id
              AND r.location_id = b.location_id AND r.status = 'active') res ON true
        WHERE ${clauses.join(' AND ')}
        ORDER BY i.sku ASC, b.location_id ASC
        LIMIT $${values.length}`,
      values
    );
    return rows.rows.map((r) => ({
      itemId: r.item_id,
      sku: r.sku,
      locationId: r.location_id,
      companyId: r.company_id,
      branchId: r.branch_id,
      storedOnHand: r.stored_on_hand,
      ledgerOnHand: r.ledger_on_hand,
      storedReserved: r.stored_reserved,
      activeReserved: r.active_reserved,
      coherent: r.coherent,
    }));
  }

  /**
   * Counts open inventory commitments against a work order.
   *
   * The forward hook `wo.work_orders.parts_forward_state` and the closure blockers
   * P1-19 deferred to P1-21 both need this fact, and so does refusing a second
   * issue against a work order that is no longer accepting parts.
   */
  /**
   * The company/branch a work order belongs to, without locking it.
   *
   * `lockWorkOrderState` takes `FOR UPDATE`, which is right on a write path and wrong
   * on a read: an audit read must not block the row it reports on. This exists so
   * `reconcile` can refuse a `workOrderId` that points outside the authorized pair —
   * `countOpenCommitments` filters on tenant and work order alone, so without this
   * check a caller could count another branch's commitments for any work-order id it
   * could name and that RLS admitted.
   */
  public async readWorkOrderScope(
    db: DbHandle,
    workOrderId: string
  ): Promise<{ readonly companyId: string; readonly branchId: string } | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ company_id: string; branch_id: string }>(
      db,
      `SELECT company_id, branch_id FROM wo.work_orders WHERE tenant_id = $1 AND id = $2`,
      [context.principal.tenantId, workOrderId]
    );
    return row ? { companyId: row.company_id, branchId: row.branch_id } : null;
  }

  public async countOpenCommitments(
    db: DbHandle,
    workOrderId: string
  ): Promise<{ readonly activeReservations: number; readonly openIssues: number }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ reservations: string; issues: string }>(
      db,
      `SELECT
         (SELECT count(*)::text FROM inv.stock_reservations r
           WHERE r.tenant_id = $1 AND r.work_order_id = $2 AND r.status = 'active')
           AS reservations,
         (SELECT count(*)::text FROM inv.part_issues pi
           WHERE pi.tenant_id = $1 AND pi.work_order_id = $2 AND pi.deleted_at IS NULL
             AND pi.quantity > COALESCE((SELECT sum(pr.quantity) FROM inv.part_returns pr
                                          WHERE pr.tenant_id = pi.tenant_id
                                            AND pr.part_issue_id = pi.id), 0))
           AS issues`,
      [context.principal.tenantId, workOrderId]
    );
    return {
      activeReservations: Number(row?.reservations ?? '0'),
      openIssues: Number(row?.issues ?? '0'),
    };
  }
}
