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
import { halfOpenLocalDayRange } from '@/server/db/period';

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
 * The REPORT's ordering over the same ledger: newest `occurred_at` first, id
 * tie-break (P1-31 P-11, engine slice 3).
 *
 * Deliberately NOT `MOVEMENT_ORDER`, and the difference is the point. The ledger
 * list sorts on `seq`, which is a strict total order; this report is a report
 * ABOUT A PERIOD, and the period is expressed on `occurred_at` (D-17). Sorting a
 * period report on an insertion sequence would let a movement whose `occurred_at`
 * falls on the third be paged between two that fall on the fifth — a page that is
 * correct as a set and unreadable as a report.
 *
 * `occurred_at` is not unique, so it is not a total order on its own; the keyset
 * carries the row id as the tie-break, exactly as the labour report does over
 * `started_at`, and the cursor value is the microsecond-precision string rather
 * than a JS `Date` (`P1-27-INT-006`).
 *
 * The key is QUALIFIED, unlike `MOVEMENT_ORDER` above: the two orderings are over
 * the same table and a cursor minted for one must be refused by the other, which a
 * bare `occurred_at_desc` could not guarantee.
 */
export const MOVEMENT_REPORT_ORDER: OrderingContract = Object.freeze({
  key: 'inv.stock_movements:occurred_at_desc',
  direction: 'desc',
});

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

/** Categories are listed by code; `uq_item_categories_code` makes `(code, id)` total. */
export const CATEGORY_ORDER: OrderingContract = Object.freeze({
  key: 'inv.item_categories:code_asc',
  direction: 'asc',
});

/**
 * Opening batches are listed newest-first by `created_at` (Phase 1-30, seam S-17).
 *
 * `as_of_date` is the date the count claims to describe, not the moment it was
 * opened, and two batches may share it — so it is not a chronology a cursor can
 * page on. `approved_at` is NULL for every draft, which is precisely the set the
 * approver is looking for. `created_at` is the only instant every row carries.
 */
export const OPENING_BATCH_ORDER: OrderingContract = Object.freeze({
  key: 'inv.opening_inventory_batches:created_at_desc',
  direction: 'desc',
});

/**
 * Transfers are listed newest-first by `created_at`.
 *
 * Not `dispatched_at`, even though `inv.dispatch_transfer` writes both from one
 * `now()` today: `dispatched_at` is a business column a later slice could backdate,
 * and a cursor over a backdatable column repeats or skips rows across a page
 * boundary. The key is qualified, so a cursor minted here cannot be replayed
 * against another list that happens to sort on a column of the same name.
 */
export const TRANSFER_ORDER: OrderingContract = Object.freeze({
  key: 'inv.stock_transfers:created_at_desc',
  direction: 'desc',
});

/**
 * Transfer settlements are listed newest-first by `created_at`, which the row carries
 * from its insert and never changes; a decision stamps `approved_at` or `rejected_at`
 * and leaves it alone. Qualified, so a transfer-list cursor is refused here.
 */
export const TRANSFER_SETTLEMENT_ORDER: OrderingContract = Object.freeze({
  key: 'inv.stock_transfer_settlements:created_at_desc',
  direction: 'desc',
});

/** Goods receipts are listed newest-first by `created_at`, like every other draft. */
export const GOODS_RECEIPT_ORDER: OrderingContract = Object.freeze({
  key: 'inv.goods_receipts:created_at_desc',
  direction: 'desc',
});

/**
 * Stock counts are listed newest-first by `created_at`.
 *
 * Not `snapshot_at`, for the same reason: the two are written from one `now()`
 * today, and a count that later recorded an earlier snapshot instant would reorder
 * a list a reader has already paged through.
 */
export const STOCK_COUNT_ORDER: OrderingContract = Object.freeze({
  key: 'inv.stock_counts:created_at_desc',
  direction: 'desc',
});

/** Adjustments are listed newest-first by `created_at`. */
export const ADJUSTMENT_ORDER: OrderingContract = Object.freeze({
  key: 'inv.stock_adjustments:created_at_desc',
  direction: 'desc',
});

/**
 * Cost layers are listed newest-effective-first.
 *
 * `effective_at` rather than `created_at`, because the question a cost history
 * answers is what something cost WHEN, and the two differ the moment a receipt is
 * drafted on one day and posted on another.
 */
export const COST_LAYER_ORDER: OrderingContract = Object.freeze({
  key: 'inv.item_cost_layers:effective_at_desc',
  direction: 'desc',
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

/** One item category — tenant-wide, like the item it files. */
export interface ItemCategoryRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentCategoryId: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

/** One unit of measure as the catalogue exposes it: platform or the tenant's own. */
export interface UnitOfMeasureRow {
  readonly id: string;
  readonly scope: string;
  readonly code: string;
  readonly name: string;
  readonly dimension: string;
  readonly status: string;
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
  /**
   * What this ITEM has in transit in this branch, as an exact decimal string.
   *
   * Repeated on every cell of the item rather than returned once, because the read
   * is paged per cell and a reader who landed on the second page of an item's
   * locations would otherwise see the transfer disappear. It is a real balance —
   * `inv.stock_balances` at the branch's `transit` location — and deliberately NOT
   * part of `available`: stock in transit belongs to neither end until the receipt
   * posts, so adding it to either would let the same unit be promised twice.
   */
  readonly inTransitQty: string;
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

/** One stock transfer, as both the detail read and the list need it. */
export interface TransferRow {
  readonly id: string;
  readonly companyId: string;
  /** The SOURCE branch, which owns the row. */
  readonly branchId: string;
  readonly itemId: string;
  readonly fromLocationId: string;
  readonly transitLocationId: string;
  readonly toBranchId: string;
  readonly toLocationId: string;
  readonly quantity: string;
  readonly receivedQuantity: string | null;
  /** Units that did not arrive and were returned to the origin or written off. */
  readonly resolvedQuantity: string;
  /** Dispatched less received less resolved: what is still in transit. */
  readonly outstandingQuantity: string;
  readonly status: string;
  readonly reason: string | null;
  readonly cancelReason: string | null;
  readonly dispatchedAt: Date;
  readonly receivedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly idempotencyKey: string | null;
  readonly recordVersion: number;
  readonly createdAt: Date;
}

/** A transfer with the labels a list must show instead of ids. */
export interface TransferListRow extends TransferRow {
  readonly sku: string;
  /**
   * Null when the reader cannot see that end's location. A destination-branch
   * reader sees the transfer through `sel_stock_transfers_destination` but not the
   * source branch's locations, and an inner join would silently drop the row.
   */
  readonly fromLocationCode: string | null;
  readonly toLocationCode: string | null;
}

export interface GoodsReceiptRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly reference: string | null;
  readonly supplierReference: string | null;
  readonly receivedOn: string;
  readonly status: string;
  readonly notes: string | null;
  readonly postedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly idempotencyKey: string | null;
  readonly recordVersion: number;
  readonly createdAt: Date;
  readonly lineCount: number;
}

/**
 * One goods-receipt line WITHOUT its cost.
 *
 * `unit_cost` and `currency_code` are deliberately absent. They are the input a
 * cost layer is built from at posting time, and the durable, readable cost record
 * is `inv.item_cost_layers`, whose every policy is gated on `inv.cost.view`.
 * Selecting them here would publish cost through a read that is not gated, which
 * is the whole reason cost lives in its own table in this schema.
 */
export interface GoodsReceiptLineRow {
  readonly id: string;
  readonly lineNo: number;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly quantity: string;
  /** Whether posting this line will append a cost layer — not what the figure is. */
  readonly hasUnitCost: boolean;
}

export interface CostLayerRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly quantity: string;
  readonly unitCost: string;
  readonly currencyCode: string;
  readonly effectiveAt: Date;
}

/**
 * The derived reference costs of one item.
 *
 * Both figures are computed IN SQL over `numeric` and cross as exact decimal
 * strings. Neither is stored anywhere, which is the point: a later receipt appends
 * a layer and the derived figures move, and there is no column an append could
 * overwrite. `null` when the item has no priced layer at all — an item nobody has
 * ever costed has no cost, and returning zero would assert that it is free.
 */
export interface ItemCostSummaryRow {
  readonly latestUnitCost: string | null;
  readonly weightedAverageCost: string | null;
  readonly currencyCode: string | null;
  /** More than one means the average is not a figure anyone should read. */
  readonly currencyCount: number;
  readonly layerCount: number;
  readonly totalQuantity: string;
}

export interface AdjustmentRow {
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
  readonly approvedAt: Date | null;
  readonly recordVersion: number;
  readonly createdAt: Date;
}

export interface AdjustmentListRow extends AdjustmentRow {
  readonly sku: string;
  readonly locationCode: string;
}

export interface StockCountRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationId: string;
  readonly status: string;
  readonly snapshotAt: Date;
  readonly countedBy: string;
  readonly reconciledAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly notes: string | null;
  readonly idempotencyKey: string | null;
  readonly recordVersion: number;
  readonly createdAt: Date;
}

/**
 * A count with the two discrepancy figures a later dashboard needs.
 *
 * Computed in SQL over the GENERATED `variance_qty` column, so they cannot drift
 * from the lines they summarise, and both cross as exact decimal strings. They are
 * on the LIST as well as the detail so a discrepancy can be seen without opening
 * every count, which is what stops a dashboard needing a read of its own.
 */
export interface StockCountListRow extends StockCountRow {
  readonly locationCode: string;
  readonly lineCount: number;
  readonly countedLineCount: number;
  readonly varianceLineCount: number;
  readonly absoluteVarianceQty: string;
}

export interface StockCountLineRow {
  readonly id: string;
  readonly itemId: string;
  readonly sku: string;
  readonly snapshotQty: string;
  readonly countedQty: string | null;
  readonly movementDeltaDuringCount: string;
  readonly varianceQty: string | null;
  readonly adjustmentId: string | null;
  readonly adjustmentStatus: string | null;
}

/**
 * SQL projections shared by a detail read and its list.
 *
 * One string per table, so a column added to the detail cannot be forgotten on the
 * list. The two drifting apart is how a field ends up present on one screen and
 * absent on the other with every test still green.
 */
interface TransferSqlRow {
  id: string;
  company_id: string;
  branch_id: string;
  item_id: string;
  from_location_id: string;
  transit_location_id: string;
  to_branch_id: string;
  to_location_id: string;
  quantity: string;
  received_quantity: string | null;
  resolved_quantity: string;
  outstanding_quantity: string;
  status: string;
  reason: string | null;
  cancel_reason: string | null;
  dispatched_at: Date;
  received_at: Date | null;
  cancelled_at: Date | null;
  idempotency_key: string | null;
  record_version: number;
  created_at: Date;
}

const TRANSFER_COLUMNS = `SELECT t.id, t.company_id, t.branch_id, t.item_id, t.from_location_id,
              t.transit_location_id, t.to_branch_id, t.to_location_id, t.quantity,
              t.received_quantity, t.resolved_quantity::text AS resolved_quantity,
              t.outstanding_quantity::text AS outstanding_quantity, t.status, t.reason,
              t.cancel_reason, t.dispatched_at,
              t.received_at, t.cancelled_at, t.idempotency_key, t.record_version, t.created_at`;

const toTransferRow = (row: TransferSqlRow): TransferRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  itemId: row.item_id,
  fromLocationId: row.from_location_id,
  transitLocationId: row.transit_location_id,
  toBranchId: row.to_branch_id,
  toLocationId: row.to_location_id,
  quantity: row.quantity,
  receivedQuantity: row.received_quantity,
  resolvedQuantity: row.resolved_quantity,
  outstandingQuantity: row.outstanding_quantity,
  status: row.status,
  reason: row.reason,
  cancelReason: row.cancel_reason,
  dispatchedAt: row.dispatched_at,
  receivedAt: row.received_at,
  cancelledAt: row.cancelled_at,
  idempotencyKey: row.idempotency_key,
  recordVersion: row.record_version,
  createdAt: row.created_at,
});

interface GoodsReceiptSqlRow {
  id: string;
  company_id: string;
  branch_id: string;
  reference: string | null;
  supplier_reference: string | null;
  received_on: string;
  status: string;
  notes: string | null;
  posted_at: Date | null;
  cancelled_at: Date | null;
  idempotency_key: string | null;
  record_version: number;
  created_at: Date;
  line_count: string;
}

const GOODS_RECEIPT_COLUMNS = `SELECT r.id, r.company_id, r.branch_id, r.reference,
              r.supplier_reference, r.received_on::text AS received_on, r.status, r.notes,
              r.posted_at, r.cancelled_at, r.idempotency_key, r.record_version, r.created_at,
              (SELECT count(*)::text FROM inv.goods_receipt_lines gl
                WHERE gl.tenant_id = r.tenant_id AND gl.receipt_id = r.id) AS line_count`;

const toGoodsReceiptRow = (row: GoodsReceiptSqlRow): GoodsReceiptRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  reference: row.reference,
  supplierReference: row.supplier_reference,
  receivedOn: row.received_on,
  status: row.status,
  notes: row.notes,
  postedAt: row.posted_at,
  cancelledAt: row.cancelled_at,
  idempotencyKey: row.idempotency_key,
  recordVersion: row.record_version,
  createdAt: row.created_at,
  lineCount: Number.parseInt(row.line_count, 10),
});

interface AdjustmentSqlRow {
  id: string;
  company_id: string;
  branch_id: string;
  item_id: string;
  location_id: string;
  direction: string;
  quantity: string;
  reason: string;
  status: string;
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  record_version: number;
  created_at: Date;
}

const ADJUSTMENT_COLUMNS = `SELECT a.id, a.company_id, a.branch_id, a.item_id, a.location_id,
              a.direction, a.quantity, a.reason, a.status, a.requested_by, a.approved_by,
              a.approved_at, a.record_version, a.created_at`;

const toAdjustmentRow = (row: AdjustmentSqlRow): AdjustmentRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  itemId: row.item_id,
  locationId: row.location_id,
  direction: row.direction,
  quantity: row.quantity,
  reason: row.reason,
  status: row.status,
  requestedBy: row.requested_by,
  approvedBy: row.approved_by,
  approvedAt: row.approved_at,
  recordVersion: row.record_version,
  createdAt: row.created_at,
});

interface StockCountSqlRow {
  id: string;
  company_id: string;
  branch_id: string;
  location_id: string;
  status: string;
  snapshot_at: Date;
  counted_by: string;
  reconciled_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  notes: string | null;
  idempotency_key: string | null;
  record_version: number;
  created_at: Date;
}

const STOCK_COUNT_COLUMNS = `SELECT c.id, c.company_id, c.branch_id, c.location_id, c.status,
              c.snapshot_at, c.counted_by, c.reconciled_at, c.cancelled_at, c.cancel_reason,
              c.notes, c.idempotency_key, c.record_version, c.created_at`;

/**
 * The discrepancy figures, as SQL rather than as a second query.
 *
 * `absolute_variance_qty` sums `abs(variance_qty)`: summing the SIGNED variances
 * would let a surplus of ten hide a shortage of ten and report a count with two
 * errors as a count with none.
 */
const STOCK_COUNT_VARIANCE_COLUMNS = `(SELECT count(*)::text FROM inv.stock_count_lines v
                WHERE v.tenant_id = c.tenant_id AND v.count_id = c.id) AS line_count,
              (SELECT count(*)::text FROM inv.stock_count_lines v
                WHERE v.tenant_id = c.tenant_id AND v.count_id = c.id
                  AND v.counted_qty IS NOT NULL) AS counted_line_count,
              (SELECT count(*)::text FROM inv.stock_count_lines v
                WHERE v.tenant_id = c.tenant_id AND v.count_id = c.id
                  AND v.variance_qty IS NOT NULL AND v.variance_qty <> 0) AS variance_line_count,
              (SELECT COALESCE(SUM(abs(v.variance_qty)), 0)::numeric(12, 3)::text
                 FROM inv.stock_count_lines v
                WHERE v.tenant_id = c.tenant_id AND v.count_id = c.id) AS absolute_variance_qty`;

const toStockCountRow = (row: StockCountSqlRow): StockCountRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  locationId: row.location_id,
  status: row.status,
  snapshotAt: row.snapshot_at,
  countedBy: row.counted_by,
  reconciledAt: row.reconciled_at,
  cancelledAt: row.cancelled_at,
  cancelReason: row.cancel_reason,
  notes: row.notes,
  idempotencyKey: row.idempotency_key,
  recordVersion: row.record_version,
  createdAt: row.created_at,
});

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

/**
 * The period a movement report covers, in the reporting branch's own timezone.
 *
 * The three period fields are the shape `halfOpenLocalDayRange` consumes, and the
 * calendar days are DAYS rather than instants for the reason D-17 gives: a caller
 * who sent an instant would carry an offset of their own choosing, which would
 * silently override the zone the period is supposed to be expressed in.
 */
export interface MovementReportFilter {
  /** REQUIRED. The authorized scope, and a predicate on every statement. */
  readonly companyId: string;
  readonly branchId: string;
  /** Inclusive first day, `YYYY-MM-DD`, in `timezoneName`. */
  readonly from: string;
  /** First day EXCLUDED — the day after the last one reported, `YYYY-MM-DD`. */
  readonly toExclusive: string;
  /** An IANA zone name: the reporting branch's `org.branches.timezone_name`. */
  readonly timezoneName: string;
}

/**
 * One movement of the reported period, with the master data a report row names.
 *
 * Every quantity is a decimal STRING. `inv.stock_movements.quantity` is
 * `numeric(12,3)`, `pg` returns OID 1700 as text and this repository never
 * overrides that, because IEEE-754 cannot represent the third decimal place.
 */
export interface MovementReportRow {
  readonly id: string;
  readonly occurredAt: Date;
  readonly referenceKind: string;
  readonly referenceId: string;
  readonly movementType: string;
  readonly direction: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationName: string;
  /** A decimal string. Always positive — `ck_stock_movements_quantity`. */
  readonly quantity: string;
  /** `inv.units_of_measure.code` of the item's own unit. */
  readonly uomCode: string;
  readonly uomName: string;
}

/**
 * One total of the WHOLE selection, keyed by item, unit and movement type.
 *
 * ## Why the key carries all three, and why there is no grand total
 *
 * Owner decision D-5 forbids a single quantity across unlike items, and D-4
 * requires totals "separated by item and by compatible unit". The unit is in the
 * key even though an item has exactly one unit today, because the key is what
 * makes the separation VISIBLE: a consumer reading the group can see which unit
 * the number is in without resolving the item, and an item whose unit is ever
 * re-pointed cannot silently merge two incompatible histories into one figure.
 *
 * The movement type is in the key because D-4 requires that "the distinct
 * meanings of a return and a transfer are preserved". Netting a return against
 * an issue would destroy exactly that distinction, so the two never meet in one
 * measure: the totals are per type, and within a type the `in` and `out` halves
 * are separate columns rather than a signed sum.
 */
export interface MovementReportTotalRow {
  readonly itemId: string;
  readonly sku: string;
  readonly uomCode: string;
  readonly movementType: string;
  /** Sum of `quantity` over `direction = 'in'`, as a decimal string. */
  readonly quantityIn: string;
  /** Sum of `quantity` over `direction = 'out'`, as a decimal string. */
  readonly quantityOut: string;
}

export interface MovementReportRows {
  readonly totals: readonly MovementReportTotalRow[];
  readonly page: Page<MovementReportRow>;
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

/**
 * A batch as the recovery reads publish it (Phase 1-30, seam S-17).
 *
 * Extends the write-echo shape rather than replacing it: the POST responses are a
 * published contract and this read must not quietly change them. The four extra
 * columns are the ones an operator needs before deciding to approve — WHEN the
 * count claims to apply, WHETHER it is already approved and when, and HOW MANY
 * cells it covers, which is the difference between a real count and an empty
 * draft that would attest to nothing.
 *
 * `lineCount` is counted in SQL over the live lines. Paging the lines to count
 * them client-side would make an approver's decision depend on a page size.
 */
export interface OpeningBatchHeaderRow extends OpeningBatchRow {
  /** `date`, read as text — a date column has no time and must not gain one. */
  readonly asOfDate: string;
  readonly approvedAt: Date | null;
  readonly createdAt: Date;
  readonly lineCount: number;
}

/** One counted cell, with the codes an operator reads instead of the ids. */
export interface OpeningLineRow {
  readonly id: string;
  readonly batchId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly locationId: string;
  readonly locationCode: string;
  /** `numeric(12,3)` — a decimal STRING, never a JSON number. */
  readonly quantity: string;
}

interface OpeningBatchHeaderSql {
  id: string;
  company_id: string;
  branch_id: string;
  batch_code: string;
  as_of_date: string;
  status: string;
  counted_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  record_version: number;
  created_at: Date;
  line_count: number;
}

/**
 * The header projection, written once because the list and the detail must not
 * drift: a field the list publishes and the detail omits is a shape the reader
 * has to discover by trying it.
 *
 * `as_of_date` is cast to text so a `date` column never acquires a time it does
 * not have, and `line_count` is a correlated count over the live lines rather
 * than a client-side length, which would depend on a page size.
 */
const OPENING_BATCH_HEADER_COLUMNS = `b.id, b.company_id, b.branch_id, b.batch_code,
              b.as_of_date::text AS as_of_date, b.status, b.counted_by, b.approved_by,
              b.approved_at, b.record_version, b.created_at,
              (SELECT count(*)::int
                 FROM inv.opening_inventory_lines l
                WHERE l.tenant_id = b.tenant_id AND l.batch_id = b.id
                  AND l.deleted_at IS NULL) AS line_count`;

const toOpeningBatchHeaderRow = (row: OpeningBatchHeaderSql): OpeningBatchHeaderRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  batchCode: row.batch_code,
  asOfDate: row.as_of_date,
  status: row.status,
  countedBy: row.counted_by,
  approvedBy: row.approved_by,
  approvedAt: row.approved_at,
  recordVersion: row.record_version,
  createdAt: row.created_at,
  lineCount: row.line_count,
});

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

const CATEGORY_COLUMNS = `id, code, name, description, parent_category_id, status, record_version`;

interface ItemCategorySql {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parent_category_id: string | null;
  status: string;
  record_version: number;
}

const toItemCategory = (r: ItemCategorySql): ItemCategoryRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  parentCategoryId: r.parent_category_id,
  status: r.status,
  recordVersion: r.record_version,
});

interface UnitOfMeasureSql {
  id: string;
  scope: string;
  code: string;
  name: string;
  dimension: string;
  status: string;
}

const toUnitOfMeasure = (r: UnitOfMeasureSql): UnitOfMeasureRow => ({
  id: r.id,
  scope: r.scope,
  code: r.code,
  name: r.name,
  dimension: r.dimension,
  status: r.status,
});

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

/** One barcode or packaging identifier of an item (P1-32-PRE-100). */
export interface ItemIdentifierRow {
  readonly id: string;
  readonly itemId: string;
  readonly kind: string;
  readonly value: string;
  readonly normalizedValue: string;
  readonly unitId: string;
  readonly unitCode: string;
  /** Exact decimal string: base units one scan of this code represents. */
  readonly packQuantity: string;
  readonly isPrimary: boolean;
  readonly retiredAt: Date | null;
  readonly recordVersion: number;
  readonly createdAt: Date;
}

/** A live identifier matched by a scan, with the item it names. */
export interface ResolvedIdentifierRow extends ItemIdentifierRow {
  readonly sku: string;
  readonly itemName: string;
  readonly isSerialized: boolean;
  readonly isStockTracked: boolean;
  readonly lifecycleStatus: string;
}

const IDENTIFIER_COLUMNS = `x.id, x.item_id, x.identifier_kind, x.value, x.normalized_value,
  x.unit_id, u.code AS unit_code, x.pack_quantity, x.is_primary, x.retired_at,
  x.record_version, x.created_at`;

interface ItemIdentifierSql {
  id: string;
  item_id: string;
  identifier_kind: string;
  value: string;
  normalized_value: string;
  unit_id: string;
  unit_code: string;
  pack_quantity: string;
  is_primary: boolean;
  retired_at: Date | null;
  record_version: number;
  created_at: Date;
}

const toItemIdentifier = (r: ItemIdentifierSql): ItemIdentifierRow => ({
  id: r.id,
  itemId: r.item_id,
  kind: r.identifier_kind,
  value: r.value,
  normalizedValue: r.normalized_value,
  unitId: r.unit_id,
  unitCode: r.unit_code,
  packQuantity: r.pack_quantity,
  isPrimary: r.is_primary,
  retiredAt: r.retired_at,
  recordVersion: r.record_version,
  createdAt: r.created_at,
});

/** One selling-price row of an item (P1-32-PRE-105). */
export interface ItemSalePriceRow {
  readonly id: string;
  readonly itemId: string;
  /** Null applies the price to every company of the tenant. */
  readonly companyId: string | null;
  /** Null applies the price to every branch of the named company. */
  readonly branchId: string | null;
  readonly currencyCode: string;
  /** Exact decimal string: `numeric(18,4)`, never a number. */
  readonly unitPrice: string;
  readonly taxClassId: string | null;
  readonly taxClassCode: string | null;
  readonly status: string;
  readonly recordVersion: number;
  readonly createdAt: Date;
}

const SALE_PRICE_COLUMNS = `p.id, p.item_id, p.company_id, p.branch_id, p.currency_code,
  p.unit_price::text AS unit_price, p.tax_class_id, tc.tax_class_code, p.status,
  p.record_version, p.created_at`;

interface ItemSalePriceSql {
  id: string;
  item_id: string;
  company_id: string | null;
  branch_id: string | null;
  currency_code: string;
  unit_price: string;
  tax_class_id: string | null;
  tax_class_code: string | null;
  status: string;
  record_version: number;
  created_at: Date;
}

const toItemSalePrice = (r: ItemSalePriceSql): ItemSalePriceRow => ({
  id: r.id,
  itemId: r.item_id,
  companyId: r.company_id,
  branchId: r.branch_id,
  currencyCode: r.currency_code,
  unitPrice: r.unit_price,
  taxClassId: r.tax_class_id,
  taxClassCode: r.tax_class_code,
  status: r.status,
  recordVersion: r.record_version,
  createdAt: r.created_at,
});

/** A part that came back (P1-32-PRE-112). */
export interface SalesReturnRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly itemId: string;
  /** Exact decimal string. */
  readonly quantity: string;
  readonly condition: string;
  readonly receivedLocationId: string;
  readonly quarantineLocationId: string | null;
  readonly reason: string | null;
  readonly creditNoteId: string | null;
  readonly status: string;
  readonly recordVersion: number;
  readonly createdAt: Date;
}

/** A listed return, with the SKU of what came back. */
export interface SalesReturnListRow extends SalesReturnRow {
  readonly sku: string;
}

/** How much of a source may still be returned (P1-32-PRE-116). */
export interface ReturnableQuantityRow {
  readonly sourceQuantity: string;
  readonly returnedQuantity: string;
  readonly remainingQuantity: string;
  readonly itemId: string;
  readonly companyId: string;
  readonly branchId: string;
}

/** Returns are listed newest-first by `created_at`, like every other event row. */
export const SALES_RETURN_ORDER: OrderingContract = Object.freeze({
  key: 'inv.sales_returns:created_at_desc',
  direction: 'desc',
});

const SALES_RETURN_COLUMNS = `r.id, r.company_id, r.branch_id, r.source_kind, r.source_id,
  r.item_id, r.quantity::text AS quantity, r.return_condition, r.received_location_id,
  r.quarantine_location_id, r.reason, r.credit_note_id, r.status, r.record_version, r.created_at`;

interface SalesReturnSql {
  id: string;
  company_id: string;
  branch_id: string;
  source_kind: string;
  source_id: string;
  item_id: string;
  quantity: string;
  return_condition: string;
  received_location_id: string;
  quarantine_location_id: string | null;
  reason: string | null;
  credit_note_id: string | null;
  status: string;
  record_version: number;
  created_at: Date;
}

const toSalesReturn = (r: SalesReturnSql): SalesReturnRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  sourceKind: r.source_kind,
  sourceId: r.source_id,
  itemId: r.item_id,
  quantity: r.quantity,
  condition: r.return_condition,
  receivedLocationId: r.received_location_id,
  quarantineLocationId: r.quarantine_location_id,
  reason: r.reason,
  creditNoteId: r.credit_note_id,
  status: r.status,
  recordVersion: r.record_version,
  createdAt: r.created_at,
});

// ---------------------------------------------------------------------------
// P1-32 preparatory slice 3b — material demand control, reference data and
// transfer settlements.
// ---------------------------------------------------------------------------

/**
 * An exact quantity in a requirement unit, as text.
 *
 * A stock quantity (three places) times a conversion factor (twelve places) is
 * exact at fifteen places. It is printed at the quantity scale when that loses
 * nothing, and with every significant digit when it would — never rounded, because
 * a figure a person is held to must be the figure the database compared.
 */
const exactQuantityText = (expression: string): string =>
  `CASE WHEN (${expression}) IS NULL THEN NULL
        WHEN (${expression}) = round((${expression}), 3) THEN round((${expression}), 3)::numeric(18, 3)::text
        ELSE trim_scale(${expression})::text END`;

/** One exact, attributable unit conversion (`inv.item_unit_conversions`). */
export interface UnitConversionRow {
  readonly id: string;
  readonly itemId: string | null;
  readonly itemSku: string | null;
  readonly fromUomId: string;
  readonly fromUomCode: string;
  readonly toUomId: string;
  readonly toUomCode: string;
  /** Exact decimal string, trailing zeros trimmed. */
  readonly factor: string;
  readonly sourceReference: string;
  readonly status: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly retiredBy: string | null;
  readonly retiredAt: Date | null;
  readonly recordVersion: number;
}

export const UNIT_CONVERSION_ORDER: OrderingContract = Object.freeze({
  key: 'inv.item_unit_conversions:created_at_desc',
  direction: 'desc',
});

const UNIT_CONVERSION_COLUMNS = `c.id, c.item_id, i.sku AS item_sku, c.from_uom_id, fu.code AS from_uom_code,
  c.to_uom_id, tu.code AS to_uom_code, trim_scale(c.factor)::text AS factor, c.source_reference,
  c.status, c.created_by, c.created_at, c.retired_by, c.retired_at, c.record_version`;

const UNIT_CONVERSION_FROM = `FROM inv.item_unit_conversions c
  JOIN inv.units_of_measure fu ON fu.id = c.from_uom_id
  JOIN inv.units_of_measure tu ON tu.id = c.to_uom_id
  LEFT JOIN inv.item_master i ON i.tenant_id = c.tenant_id AND i.id = c.item_id`;

interface UnitConversionSql {
  id: string;
  item_id: string | null;
  item_sku: string | null;
  from_uom_id: string;
  from_uom_code: string;
  to_uom_id: string;
  to_uom_code: string;
  factor: string;
  source_reference: string;
  status: string;
  created_by: string;
  created_at: Date;
  retired_by: string | null;
  retired_at: Date | null;
  record_version: number;
}

const toUnitConversion = (r: UnitConversionSql): UnitConversionRow => ({
  id: r.id,
  itemId: r.item_id,
  itemSku: r.item_sku,
  fromUomId: r.from_uom_id,
  fromUomCode: r.from_uom_code,
  toUomId: r.to_uom_id,
  toUomCode: r.to_uom_code,
  factor: r.factor,
  sourceReference: r.source_reference,
  status: r.status,
  createdBy: r.created_by,
  createdAt: r.created_at,
  retiredBy: r.retired_by,
  retiredAt: r.retired_at,
  recordVersion: r.record_version,
});

/** One attributable service capacity (`inv.vehicle_fluid_specifications`). */
export interface VehicleSpecificationRow {
  readonly id: string;
  readonly makeId: string;
  readonly modelId: string | null;
  readonly modelYearFrom: number | null;
  readonly modelYearTo: number | null;
  readonly engineVariant: string | null;
  readonly serviceCondition: string;
  readonly itemCategoryId: string | null;
  /** Exact decimal string. */
  readonly capacity: string;
  readonly uomId: string;
  readonly uomCode: string;
  readonly sourceReference: string;
  readonly status: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly confirmedBy: string | null;
  readonly confirmedAt: Date | null;
  readonly retiredBy: string | null;
  readonly retiredAt: Date | null;
  readonly recordVersion: number;
}

export const VEHICLE_SPECIFICATION_ORDER: OrderingContract = Object.freeze({
  key: 'inv.vehicle_fluid_specifications:created_at_desc',
  direction: 'desc',
});

const VEHICLE_SPECIFICATION_COLUMNS = `s.id, s.make_id, s.model_id, s.model_year_from, s.model_year_to,
  s.engine_variant, s.service_condition, s.item_category_id, s.capacity::text AS capacity, s.uom_id,
  u.code AS uom_code, s.source_reference, s.status, s.created_by, s.created_at, s.confirmed_by,
  s.confirmed_at, s.retired_by, s.retired_at, s.record_version`;

interface VehicleSpecificationSql {
  id: string;
  make_id: string;
  model_id: string | null;
  model_year_from: number | null;
  model_year_to: number | null;
  engine_variant: string | null;
  service_condition: string;
  item_category_id: string | null;
  capacity: string;
  uom_id: string;
  uom_code: string;
  source_reference: string;
  status: string;
  created_by: string;
  created_at: Date;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  retired_by: string | null;
  retired_at: Date | null;
  record_version: number;
}

const toVehicleSpecification = (r: VehicleSpecificationSql): VehicleSpecificationRow => ({
  id: r.id,
  makeId: r.make_id,
  modelId: r.model_id,
  modelYearFrom: r.model_year_from,
  modelYearTo: r.model_year_to,
  engineVariant: r.engine_variant,
  serviceCondition: r.service_condition,
  itemCategoryId: r.item_category_id,
  capacity: r.capacity,
  uomId: r.uom_id,
  uomCode: r.uom_code,
  sourceReference: r.source_reference,
  status: r.status,
  createdBy: r.created_by,
  createdAt: r.created_at,
  confirmedBy: r.confirmed_by,
  confirmedAt: r.confirmed_at,
  retiredBy: r.retired_by,
  retiredAt: r.retired_at,
  recordVersion: r.record_version,
});

/**
 * A material requirement with its usage, every figure in the requirement unit
 * (`inv.material_requirement_usage`). The usage figures are advisory when read here;
 * they bind only when the ceiling guard reads them under the requirement lock.
 */
export interface MaterialRequirementRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly serviceLineId: string;
  readonly itemId: string | null;
  readonly itemCategoryId: string | null;
  readonly basis: string;
  readonly specificationId: string | null;
  readonly serviceCondition: string | null;
  readonly engineVariant: string | null;
  readonly allowanceQuantity: string | null;
  readonly uomId: string | null;
  readonly sourceReference: string | null;
  readonly status: string;
  readonly approvalRequiredReason: string | null;
  readonly requestedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: Date | null;
  readonly rejectionReason: string | null;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly recordVersion: number;
  readonly createdAt: Date;
  readonly approvedExceptionQuantity: string;
  readonly effectiveAllowance: string | null;
  readonly openRequestQuantity: string;
  readonly reservedQuantity: string;
  readonly issuedQuantity: string;
  readonly returnedQuantity: string;
  readonly committedQuantity: string;
  readonly remainingQuantity: string | null;
}

export const MATERIAL_REQUIREMENT_ORDER: OrderingContract = Object.freeze({
  key: 'inv.material_requirements:created_at_desc',
  direction: 'desc',
});

const MATERIAL_REQUIREMENT_COLUMNS = `r.id, r.company_id, r.branch_id, r.work_order_id, r.service_line_id,
  r.item_id, r.item_category_id, r.basis, r.specification_id, r.service_condition, r.engine_variant,
  r.allowance_quantity::text AS allowance_quantity, r.uom_id, r.source_reference, r.status,
  r.approval_required_reason, r.requested_by, r.approved_by, r.approved_at, r.rejected_by,
  r.rejected_at, r.rejection_reason, r.cancelled_at, r.cancel_reason, r.record_version, r.created_at,
  ${exactQuantityText('u.approved_exception_quantity')} AS approved_exception_quantity,
  ${exactQuantityText('u.effective_allowance')} AS effective_allowance,
  ${exactQuantityText('u.open_request_quantity')} AS open_request_quantity,
  ${exactQuantityText('u.reserved_quantity')} AS reserved_quantity,
  ${exactQuantityText('u.issued_quantity')} AS issued_quantity,
  ${exactQuantityText('u.returned_quantity')} AS returned_quantity,
  ${exactQuantityText('u.committed_quantity')} AS committed_quantity,
  ${exactQuantityText('u.remaining_quantity')} AS remaining_quantity`;

const MATERIAL_REQUIREMENT_FROM = `FROM inv.material_requirements r
  LEFT JOIN LATERAL inv.material_requirement_usage(r.tenant_id, r.id) u ON true`;

interface MaterialRequirementSql {
  id: string;
  company_id: string;
  branch_id: string;
  work_order_id: string;
  service_line_id: string;
  item_id: string | null;
  item_category_id: string | null;
  basis: string;
  specification_id: string | null;
  service_condition: string | null;
  engine_variant: string | null;
  allowance_quantity: string | null;
  uom_id: string | null;
  source_reference: string | null;
  status: string;
  approval_required_reason: string | null;
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  rejected_by: string | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  record_version: number;
  created_at: Date;
  approved_exception_quantity: string | null;
  effective_allowance: string | null;
  open_request_quantity: string | null;
  reserved_quantity: string | null;
  issued_quantity: string | null;
  returned_quantity: string | null;
  committed_quantity: string | null;
  remaining_quantity: string | null;
}

const toMaterialRequirement = (r: MaterialRequirementSql): MaterialRequirementRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  workOrderId: r.work_order_id,
  serviceLineId: r.service_line_id,
  itemId: r.item_id,
  itemCategoryId: r.item_category_id,
  basis: r.basis,
  specificationId: r.specification_id,
  serviceCondition: r.service_condition,
  engineVariant: r.engine_variant,
  allowanceQuantity: r.allowance_quantity,
  uomId: r.uom_id,
  sourceReference: r.source_reference,
  status: r.status,
  approvalRequiredReason: r.approval_required_reason,
  requestedBy: r.requested_by,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  rejectedBy: r.rejected_by,
  rejectedAt: r.rejected_at,
  rejectionReason: r.rejection_reason,
  cancelledAt: r.cancelled_at,
  cancelReason: r.cancel_reason,
  recordVersion: r.record_version,
  createdAt: r.created_at,
  approvedExceptionQuantity: r.approved_exception_quantity ?? '0.000',
  effectiveAllowance: r.effective_allowance,
  openRequestQuantity: r.open_request_quantity ?? '0.000',
  reservedQuantity: r.reserved_quantity ?? '0.000',
  issuedQuantity: r.issued_quantity ?? '0.000',
  returnedQuantity: r.returned_quantity ?? '0.000',
  committedQuantity: r.committed_quantity ?? '0.000',
  remainingQuantity: r.remaining_quantity,
});

/** A finite exception on an approved requirement. */
export interface MaterialExceptionRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly requirementId: string;
  readonly additionalQuantity: string;
  readonly resultingAllowance: string | null;
  readonly reason: string;
  readonly status: string;
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  readonly recordVersion: number;
  readonly createdAt: Date;
}

const MATERIAL_EXCEPTION_COLUMNS = `e.id, e.company_id, e.branch_id, e.requirement_id,
  e.additional_quantity::text AS additional_quantity, e.resulting_allowance::text AS resulting_allowance,
  e.reason, e.status, e.requested_by, e.decided_by, e.decided_at, e.decision_note, e.record_version,
  e.created_at`;

interface MaterialExceptionSql {
  id: string;
  company_id: string;
  branch_id: string;
  requirement_id: string;
  additional_quantity: string;
  resulting_allowance: string | null;
  reason: string;
  status: string;
  requested_by: string;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  record_version: number;
  created_at: Date;
}

const toMaterialException = (r: MaterialExceptionSql): MaterialExceptionRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  requirementId: r.requirement_id,
  additionalQuantity: r.additional_quantity,
  resultingAllowance: r.resulting_allowance,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requested_by,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
  recordVersion: r.record_version,
  createdAt: r.created_at,
});

/**
 * What a draw on a requirement would do, read under the requirement lock: whether
 * the requirement covers the item, whether a conversion exists, and the figures a
 * refusal must state.
 */
export interface MaterialDrawCheckRow {
  readonly status: string;
  readonly approvalRequiredReason: string | null;
  readonly workOrderId: string;
  readonly coversItem: boolean;
  readonly hasFactor: boolean;
  readonly allowance: string | null;
  readonly committed: string;
  readonly requested: string | null;
  readonly exceeds: boolean;
  /**
   * The code of the unit the three quantities are stated in (CC-OD-32).
   *
   * Null while the requirement has no unit yet — a derivation waiting on its
   * specification has none — which is exactly when there are no figures to
   * label either. A figure without its unit is not a smaller answer, it is a
   * wrong one: "4" of a fluid means nothing until it says litres.
   */
  readonly unit: string | null;
}

/** The material request a reservation fulfills, when it fulfills one. */
export interface MaterialReservationLinkRow {
  readonly requestId: string;
  readonly requirementId: string;
  readonly requestStatus: string;
  readonly hasIssue: boolean;
}

/**
 * A material request: a quantity of one item in its stock unit drawn on a
 * requirement, with the exact factor into the requirement unit it was measured by.
 */
export interface MaterialRequestRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly requirementId: string;
  readonly workOrderId: string;
  readonly itemId: string;
  readonly quantity: string;
  readonly requirementUnitFactor: string;
  readonly status: string;
  readonly requestedBy: string;
  readonly closedBy: string | null;
  readonly closedAt: Date | null;
  readonly closeReason: string | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly recordVersion: number;
  readonly createdAt: Date;
}

/** One act that took units of a transfer out of transit. */
export interface TransferSettlementRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly transferId: string;
  readonly toBranchId: string;
  readonly kind: string;
  readonly quantity: string;
  readonly reason: string | null;
  readonly status: string;
  readonly requestedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: Date | null;
  readonly idempotencyKey: string | null;
  readonly recordVersion: number;
  readonly createdAt: Date;
}

const TRANSFER_SETTLEMENT_COLUMNS = `s.id, s.company_id, s.branch_id, s.transfer_id, s.to_branch_id,
  s.settlement_kind, s.quantity::text AS quantity, s.reason, s.status, s.requested_by, s.approved_by,
  s.approved_at, s.rejected_by, s.rejected_at, s.idempotency_key, s.record_version, s.created_at`;

interface TransferSettlementSql {
  id: string;
  company_id: string;
  branch_id: string;
  transfer_id: string;
  to_branch_id: string;
  settlement_kind: string;
  quantity: string;
  reason: string | null;
  status: string;
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  rejected_by: string | null;
  rejected_at: Date | null;
  idempotency_key: string | null;
  record_version: number;
  created_at: Date;
}

const toTransferSettlement = (r: TransferSettlementSql): TransferSettlementRow => ({
  id: r.id,
  companyId: r.company_id,
  branchId: r.branch_id,
  transferId: r.transfer_id,
  toBranchId: r.to_branch_id,
  kind: r.settlement_kind,
  quantity: r.quantity,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requested_by,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  rejectedBy: r.rejected_by,
  rejectedAt: r.rejected_at,
  idempotencyKey: r.idempotency_key,
  recordVersion: r.record_version,
  createdAt: r.created_at,
});

/** A settlement with the item its transfer moves, for a reader deciding what it is. */
export interface TransferSettlementListRow extends TransferSettlementRow {
  readonly itemId: string;
  readonly sku: string;
}

/** The decision a settlement list is narrowed by; see `listTransferSettlements`. */
export type TransferSettlementDecisionFilter = 'pending' | 'approved' | 'rejected';

// ---------------------------------------------------------------------------
// Operational alerts (Owner directive) — reorder levels and the four stock
// alerts computed over them and over the ledger.
//
// Every one of these is a READ. None writes stock, none writes money, and none
// asks anything outside this database: an alert here is an arithmetic statement
// about rows the caller is already allowed to see, and the operations publish the
// inputs so a reader can redo the arithmetic.
// ---------------------------------------------------------------------------

/** Reorder levels are listed by SKU, with the level's own id as the tie-break. */
export const REORDER_LEVEL_ORDER: OrderingContract = Object.freeze({
  key: 'inv.item_reorder_levels:sku_asc',
  direction: 'asc',
});

/**
 * Low-stock rows are listed by SKU.
 *
 * NOT by shortfall, though a "worst first" list is the tempting default: the
 * shortfall changes with every movement, so a cursor issued against it would page
 * over a set that has re-sorted itself underneath the reader. The SKU is stable,
 * and the shortfall is published on every row for a client to sort a page by.
 */
export const LOW_STOCK_ORDER: OrderingContract = Object.freeze({
  key: 'inv.low_stock:sku_asc',
  direction: 'asc',
});

/** Count variances are listed newest count first; the LINE id is the tie-break. */
export const COUNT_DISCREPANCY_ORDER: OrderingContract = Object.freeze({
  key: 'inv.count_discrepancy:reconciled_at_desc',
  direction: 'desc',
});

/** Unusual consumption is listed by SKU, for the reason `LOW_STOCK_ORDER` gives. */
export const UNUSUAL_CONSUMPTION_ORDER: OrderingContract = Object.freeze({
  key: 'inv.unusual_consumption:sku_asc',
  direction: 'asc',
});

/** Aged transfers are listed oldest dispatch first — the point of the alert. */
export const AGED_TRANSIT_ORDER: OrderingContract = Object.freeze({
  key: 'inv.aged_in_transit:dispatched_at_asc',
  direction: 'asc',
});

/** One configured reorder level, exactly as the table stores it. */
export interface ReorderLevelRow {
  readonly id: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  /** `numeric(12,3)` — a decimal STRING, never a JSON number. */
  readonly reorderLevelQty: string;
  readonly preferredOrderQty: string | null;
  readonly status: string;
  readonly retiredAt: Date | null;
  readonly recordVersion: number;
}

/** The narrowing a level is written against. NULLs are the wider scope. */
export interface ReorderLevelSignature {
  readonly itemId: string;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly locationId: string | null;
}

/** One low-stock finding: what applies, what is there, and the gap. */
export interface LowStockRow {
  readonly reorderLevelId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly companyId: string;
  readonly branchId: string;
  /** `location` when the level names a shelf, `branch` when it does not. */
  readonly scope: string;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly onHandQty: string;
  readonly reservedQty: string;
  readonly availableQty: string;
  readonly reorderLevelQty: string;
  /** `reorderLevelQty - availableQty`, computed in `numeric` by the database. */
  readonly shortfallQty: string;
  readonly preferredOrderQty: string | null;
}

/**
 * The low-stock SELECTION, written ONCE.
 *
 * Two reads answer with it — the alert's page and the dashboard's count — and
 * they must agree by construction rather than by inspection. A second copy of
 * this text would be a second definition of what "low" means, and the two would
 * drift the first time a location type, a specificity rule or an archived-item
 * exclusion changed on one of them: the alert would list eleven items and the
 * dashboard would say twelve, and nothing would fail.
 *
 * It is a COMPLETE statement, so the page appends its keyset window to the
 * trailing `WHERE` and the count wraps the whole thing as a subquery. Neither
 * has to know how the other reads it.
 *
 * Parameters, in the order every caller binds them:
 *   $1 tenant id · $2 company id · $3 branch id · $4 item id or NULL
 *
 * The three structural properties the alert route publishes live in this text
 * and not in either caller: the query STARTS from `inv.item_reorder_levels`, so
 * an item with no configured level is never low however empty its shelf; the
 * comparison is on the GENERATED `available_qty` column, never re-derived; and
 * quarantine and transit cells are excluded from a branch total, because stock
 * nobody can fit is not stock the branch has.
 */
const LOW_STOCK_SELECTION = `WITH applicable AS (
         SELECT r.id, r.item_id, r.location_id, r.reorder_level_qty, r.preferred_order_qty,
                row_number() OVER (
                  PARTITION BY r.item_id, r.location_id
                  ORDER BY (r.branch_id IS NOT NULL) DESC, (r.company_id IS NOT NULL) DESC
                ) AS specificity_rank
           FROM inv.item_reorder_levels r
          WHERE r.tenant_id = $1
            AND r.status = 'active'
            AND (r.company_id IS NULL OR r.company_id = $2)
            AND (r.branch_id IS NULL OR r.branch_id = $3)
            AND ($4::uuid IS NULL OR r.item_id = $4)
       ),
       branch_totals AS (
         SELECT b.item_id,
                sum(b.on_hand_qty)   AS on_hand_qty,
                sum(b.reserved_qty)  AS reserved_qty,
                sum(b.available_qty) AS available_qty
           FROM inv.stock_balances b
           JOIN inv.stock_locations sl ON sl.tenant_id = b.tenant_id AND sl.id = b.location_id
          WHERE b.tenant_id = $1 AND b.company_id = $2 AND b.branch_id = $3
            AND sl.location_type NOT IN ('quarantine', 'transit')
          GROUP BY b.item_id
       )
       SELECT a.id, a.item_id, i.sku, i.name AS item_name,
              CASE WHEN a.location_id IS NULL THEN 'branch' ELSE 'location' END AS scope,
              a.location_id, l.location_code,
              q.on_hand_qty, q.reserved_qty, q.available_qty,
              a.reorder_level_qty,
              a.reorder_level_qty - q.available_qty AS shortfall_qty,
              a.preferred_order_qty,
              i.sku AS sort_value
         FROM applicable a
         JOIN inv.item_master i ON i.tenant_id = $1 AND i.id = a.item_id
         LEFT JOIN inv.stock_locations l ON l.tenant_id = $1 AND l.id = a.location_id
         LEFT JOIN branch_totals bt ON bt.item_id = a.item_id
         LEFT JOIN inv.stock_balances c
           ON c.tenant_id = $1 AND c.company_id = $2 AND c.branch_id = $3
          AND c.item_id = a.item_id AND c.location_id = a.location_id
         CROSS JOIN LATERAL (
           SELECT COALESCE(CASE WHEN a.location_id IS NULL THEN bt.on_hand_qty   ELSE c.on_hand_qty   END, 0) AS on_hand_qty,
                  COALESCE(CASE WHEN a.location_id IS NULL THEN bt.reserved_qty  ELSE c.reserved_qty  END, 0) AS reserved_qty,
                  COALESCE(CASE WHEN a.location_id IS NULL THEN bt.available_qty ELSE c.available_qty END, 0) AS available_qty
         ) q
        WHERE a.specificity_rank = 1
          AND i.deleted_at IS NULL
          AND i.lifecycle_status <> 'archived'
          AND q.available_qty <= a.reorder_level_qty`;

/** One counted line whose variance was not zero, with its adjustment's state. */
export interface CountDiscrepancyRow {
  readonly countId: string;
  readonly lineId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly snapshotQty: string;
  readonly countedQty: string | null;
  readonly movementDeltaDuringCount: string;
  readonly varianceQty: string;
  readonly reconciledAt: Date;
  readonly adjustmentId: string | null;
  /** `pending` | `approved` | `rejected`, or null when no adjustment was raised. */
  readonly adjustmentStatus: string | null;
  readonly adjustmentApprovedAt: Date | null;
}

/** One window of the consumption comparison, with what was issued in it. */
export interface ConsumptionPeriodRow {
  /** Inclusive start, ISO-8601. */
  readonly from: string;
  /** Exclusive end, ISO-8601. */
  readonly to: string;
  readonly issuedQty: string;
}

/** One item whose issued quantity broke out of its own recent history. */
export interface UnusualConsumptionRow {
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly observedQty: string;
  readonly baselineMedianQty: string;
  readonly observedPeriod: ConsumptionPeriodRow;
  readonly baselinePeriods: readonly ConsumptionPeriodRow[];
}

/** One transfer that has been in transit longer than the caller asked about. */
export interface AgedInTransitRow {
  readonly transferId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly status: string;
  readonly companyId: string;
  readonly fromBranchId: string;
  readonly fromLocationId: string;
  readonly fromLocationCode: string;
  readonly toBranchId: string;
  readonly toLocationId: string;
  readonly toLocationCode: string;
  readonly quantity: string;
  readonly receivedQuantity: string | null;
  readonly outstandingQuantity: string;
  readonly dispatchedAt: Date;
  /** Whole days between dispatch and the read's own `asOf`. */
  readonly ageDays: number;
}

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
    // ALWAYS excluded, with no opt-in. A transit cell is not a place stock can be
    // picked from, so listing it beside the shelves would make a dispatched
    // transfer read as available stock in the branch that has already given it up.
    // The quantity is still reported — as `in_transit_qty` on every cell of the
    // item, below — so it is hidden from availability without being hidden.
    clauses.push(`l.location_type <> 'transit'`);

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
      in_transit_qty: string;
      id: string;
    }>(
      db,
      `SELECT b.id, b.item_id, i.sku, b.location_id, l.location_code, l.location_type,
              b.company_id, b.branch_id, b.on_hand_qty, b.reserved_qty, b.available_qty,
              COALESCE((SELECT SUM(tb.on_hand_qty)
                          FROM inv.stock_balances tb
                          JOIN inv.stock_locations tl
                            ON tl.tenant_id = tb.tenant_id AND tl.company_id = tb.company_id
                           AND tl.branch_id = tb.branch_id AND tl.id = tb.location_id
                         WHERE tb.tenant_id = b.tenant_id AND tb.company_id = b.company_id
                           AND tb.branch_id = b.branch_id AND tb.item_id = b.item_id
                           AND tl.location_type = 'transit'), 0)::numeric(12, 3)
                AS in_transit_qty
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
      inTransitQty: r.in_transit_qty,
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
                           AND pr.part_issue_id = pi.id), 0)::numeric(12,3)::text AS returned_qty,
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

  // -------------------------------------------------------------------------
  // P1-30 corrective slice — the master data every movement is keyed on.
  // -------------------------------------------------------------------------

  public async listItemCategories(
    db: DbHandle,
    filter: { readonly status?: string | undefined },
    request: PageRequest
  ): Promise<Page<ItemCategoryRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, filter.status ?? null];
    const keyset = keysetFragment(
      request,
      { sort: 'code', id: 'id' },
      CATEGORY_ORDER,
      values.length + 1
    );
    const result = await this.run<ItemCategorySql>(
      db,
      `SELECT ${CATEGORY_COLUMNS}
         FROM inv.item_categories
        WHERE tenant_id = $1 AND deleted_at IS NULL
          AND ($2::text IS NULL OR status = $2)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPage(result.rows.map(toItemCategory), request, CATEGORY_ORDER, (row) => ({
      sortValue: row.code,
      id: row.id,
    }));
  }

  public async readItemCategory(db: DbHandle, categoryId: string): Promise<ItemCategoryRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ItemCategorySql>(
      db,
      `SELECT ${CATEGORY_COLUMNS}
         FROM inv.item_categories
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, categoryId]
    );
    return row ? toItemCategory(row) : null;
  }

  public async insertItemCategory(
    db: DbHandle,
    input: {
      readonly code: string;
      readonly name: string;
      readonly description: string | null;
      readonly parentCategoryId: string | null;
    }
  ): Promise<ItemCategoryRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<ItemCategorySql>(
      db,
      `INSERT INTO inv.item_categories
         (tenant_id, parent_category_id, code, name, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${CATEGORY_COLUMNS}`,
      [
        context.principal.tenantId,
        input.parentCategoryId,
        input.code,
        input.name,
        input.description,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('inventory: item category insert returned no row');
    return toItemCategory(row);
  }

  /** Active units the tenant may use: the platform set plus its own, by code. */
  public async listUnitsOfMeasure(db: DbHandle): Promise<readonly UnitOfMeasureRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<UnitOfMeasureSql>(
      db,
      `SELECT id, scope, code, name, dimension, status
         FROM inv.units_of_measure
        WHERE (scope = 'platform' OR tenant_id = $1)
          AND status = 'active' AND deleted_at IS NULL
        ORDER BY (scope = 'tenant') DESC, code ASC, id ASC`,
      [context.principal.tenantId]
    );
    return result.rows.map(toUnitOfMeasure);
  }

  public async readUnitOfMeasure(db: DbHandle, uomId: string): Promise<UnitOfMeasureRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<UnitOfMeasureSql>(
      db,
      `SELECT id, scope, code, name, dimension, status
         FROM inv.units_of_measure
        WHERE (scope = 'platform' OR tenant_id = $1) AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, uomId]
    );
    return row ? toUnitOfMeasure(row) : null;
  }

  /**
   * Inserts an item and returns its id. The full row is read back through
   * `readItem`, whose UoM join is what supplies `uomCode` — the insert cannot.
   */
  public async insertItem(
    db: DbHandle,
    input: {
      readonly itemCategoryId: string;
      readonly sku: string;
      readonly name: string;
      readonly description: string | null;
      readonly uomId: string;
      readonly itemType: string;
      readonly isStockTracked: boolean;
      readonly isSerialized: boolean;
    }
  ): Promise<string> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO inv.item_master
         (tenant_id, item_category_id, sku, name, description, uom_id, item_type,
          is_stock_tracked, is_serialized, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.itemCategoryId,
        input.sku,
        input.name,
        input.description,
        input.uomId,
        input.itemType,
        input.isStockTracked,
        input.isSerialized,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('inventory: item insert returned no row');
    return row.id;
  }

  public async insertStockLocation(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly locationCode: string;
      readonly name: string;
      readonly locationType: string;
      readonly parentLocationId: string | null;
    }
  ): Promise<StockLocationListRow & { readonly recordVersion: number }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      branch_id: string;
      location_code: string;
      name: string;
      location_type: string;
      parent_location_id: string | null;
      status: string;
      record_version: number;
    }>(
      db,
      `INSERT INTO inv.stock_locations
         (tenant_id, company_id, branch_id, location_code, name, location_type,
          parent_location_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, company_id, branch_id, location_code, name, location_type,
                 parent_location_id, status, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.locationCode,
        input.name,
        input.locationType,
        input.parentLocationId,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('inventory: stock location insert returned no row');
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      locationCode: row.location_code,
      name: row.name,
      locationType: row.location_type,
      parentLocationId: row.parent_location_id,
      status: row.status,
      recordVersion: row.record_version,
    };
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
   * `ck_opening_inventory_batches_maker` enforces maker ≠ approver and
   * `inv.guard_opening_batch_approval` freezes the row afterwards. All of it
   * stays in the database — this is a call, not a reimplementation.
   *
   * The movements it posts are also where `uq_stock_movements_opening_cell` bites:
   * at most ONE `opening` movement per (tenant, company, branch, item, location),
   * so a second batch counting a cell this branch has already opened raises
   * `23505` here and the whole approval — the status UPDATE included — rolls back.
   * The service maps it to `ERR-RES-002` rather than letting it surface as a 500.
   */
  public async approveOpeningBatch(db: DbHandle, batchId: string): Promise<void> {
    await this.run(db, `SELECT inv.approve_opening_batch($1)`, [batchId]);
  }

  /**
   * One branch's opening batches, newest first (Phase 1-30, seam S-17).
   *
   * `(companyId, branchId)` are REQUIRED and are the operation's
   * `authorizationTarget`, on the `inv.stock-location-list` precedent. They are
   * bound as predicates here too: RLS narrows to `app.branch_ids`, the
   * permission-blind union of every active grant, so without the explicit columns
   * a caller holding `inv.stock.read` in one branch could read another branch's
   * counts through a grant carrying a different permission (P1-18-A-01).
   *
   * `ix_opening_inventory_batches_branch` covers the equality prefix.
   */
  public async listOpeningBatches(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<OpeningBatchHeaderRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.status ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'b.created_at', id: 'b.id' },
      OPENING_BATCH_ORDER,
      values.length + 1
    );
    const result = await this.run<OpeningBatchHeaderSql & { sort_value: string }>(
      db,
      // The optional filter is bound as `($n::text IS NULL OR col = $n)` so no
      // predicate is assembled from input and the keyset parameter index is fixed.
      `SELECT ${OPENING_BATCH_HEADER_COLUMNS},
              ${cursorTimestamp('b.created_at')} AS sort_value
         FROM inv.opening_inventory_batches b
        WHERE b.tenant_id = $1 AND b.company_id = $2 AND b.branch_id = $3
          AND b.deleted_at IS NULL
          AND ($4::text IS NULL OR b.status = $4)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: toOpeningBatchHeaderRow(row),
        // Microsecond precision minted in SQL. A JS `Date` truncates to
        // milliseconds and would skip every row sharing the boundary row's
        // millisecond (`P1-27-INT-006`) — and two batches opened by one script
        // share `transaction_timestamp()` far more often than two by hand.
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      OPENING_BATCH_ORDER
    );
  }

  /**
   * One batch's header by id, with no scope predicate (Phase 1-30, seam S-17).
   *
   * Deliberately tenant-scoped ONLY. The caller — `InventoryReadService` — needs
   * the row's own company and branch in order to authorize against them, so a
   * scope predicate here would make an unauthorized batch and a non-existent one
   * indistinguishable *to the service* and leave `authorizeScope` unreachable.
   * RLS still narrows, and a row RLS hides reads as `null`, which the service
   * turns into the same 404 an unknown id gets.
   */
  public async readOpeningBatchHeader(
    db: DbHandle,
    batchId: string
  ): Promise<OpeningBatchHeaderRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<OpeningBatchHeaderSql>(
      db,
      `SELECT ${OPENING_BATCH_HEADER_COLUMNS}
         FROM inv.opening_inventory_batches b
        WHERE b.tenant_id = $1 AND b.id = $2 AND b.deleted_at IS NULL`,
      [context.principal.tenantId, batchId]
    );
    return row ? toOpeningBatchHeaderRow(row) : null;
  }

  /**
   * Every counted line on one batch (Phase 1-30, seam S-17).
   *
   * Unpaged, and bounded by construction: `uq_opening_inventory_lines_cell` allows
   * one live line per (item, location) inside a batch, so the collection is the
   * branch's counted cells and not an open-ended log. A cursor here would split a
   * count across pages and make the approver's total depend on a page size.
   *
   * Ordered by location then SKU — the order the shelves are walked in — and both
   * columns are joined in so the reader sees codes rather than uuids. Quantity
   * crosses as the exact decimal STRING `pg` returns.
   */
  public async listOpeningLines(db: DbHandle, batchId: string): Promise<readonly OpeningLineRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      batch_id: string;
      item_id: string;
      sku: string;
      item_name: string;
      location_id: string;
      location_code: string;
      quantity: string;
    }>(
      db,
      `SELECT l.id, l.batch_id, l.item_id, i.sku, i.name AS item_name,
              l.location_id, s.location_code, l.quantity
         FROM inv.opening_inventory_lines l
         JOIN inv.item_master i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
         JOIN inv.stock_locations s ON s.tenant_id = l.tenant_id AND s.id = l.location_id
        WHERE l.tenant_id = $1 AND l.batch_id = $2 AND l.deleted_at IS NULL
        ORDER BY s.location_code, i.sku, l.id`,
      [context.principal.tenantId, batchId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      batchId: row.batch_id,
      itemId: row.item_id,
      sku: row.sku,
      itemName: row.item_name,
      locationId: row.location_id,
      locationCode: row.location_code,
      quantity: row.quantity,
    }));
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
   *
   * This form names NO work order. A reservation for a work order is a draw on its
   * approved demand and goes through `reserveMaterialRequest`; the database refuses
   * one written here.
   */
  public async reserveStock(
    db: DbHandle,
    input: {
      readonly itemId: string;
      readonly locationId: string;
      readonly quantity: string;
      readonly idempotencyKey: string | null;
      readonly expiresAt: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<{ readonly id: string }> {
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.reserve_stock($1, $2, $3::numeric, NULL, $4, $5::timestamptz, $6) AS id`,
      [
        input.itemId,
        input.locationId,
        input.quantity,
        input.idempotencyKey,
        input.expiresAt,
        input.correlationId,
      ]
    );
    if (!row?.id) throw new Error('inventory: reserve_stock returned no id');
    return { id: row.id };
  }

  /**
   * Reserves stock for a work order, drawn on an open material request
   * (`inv.reserve_material_request`, P1-32-PRE-132).
   *
   * The same single-winner primitive runs underneath, with the request named for the
   * duration of the call, so the reservation row is linked to the request as it is
   * inserted — under the requirement then request lock, and bounded by the request.
   * A reservation for a work order written any other way is refused by the database.
   */
  public async reserveMaterialRequest(
    db: DbHandle,
    input: {
      readonly requestId: string;
      readonly locationId: string;
      readonly quantity: string;
      readonly idempotencyKey: string | null;
      readonly expiresAt: string | null;
    }
  ): Promise<{ readonly id: string }> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.reserve_material_request($1, $2, $3::numeric, $4, $5::timestamptz) AS id`,
      [input.requestId, input.locationId, input.quantity, input.idempotencyKey, input.expiresAt]
    );
    if (!row?.id) throw new Error('inventory: inv.reserve_material_request returned no id');
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
   * Issues stock to a work order, drawn on an open material request
   * (`inv.issue_material_request`, P1-32-PRE-132).
   *
   * Every part issue names a work order, and since `20260917099000` the database
   * links it at insert to the material request the function names, under the
   * requirement then request lock, or refuses it. The request is the draw's measure:
   * it was bounded by the approved allowance when it was opened, and the link is
   * bounded by the request.
   *
   * The same migration fixed the ordering this method used to perform by hand
   * (`P1-21-D-01`): `inv.issue_part` now inserts the issue row, consumes the
   * reservation, and only then posts the `out` movement, so `reserved` falls before
   * `on_hand` does and `ck_stock_balances_available` never sees the same units
   * twice. There is no second path.
   */
  public async issuePart(
    db: DbHandle,
    input: {
      readonly requestId: string;
      readonly locationId: string;
      readonly quantity: string;
      readonly reservationId: string | null;
      readonly requiredPartRef: string | null;
    }
  ): Promise<{ readonly issueId: string; readonly movementId: string }> {
    const context = this.assertContext(db);
    const issue = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.issue_material_request($1, $2, $3::numeric, $4, $5) AS id`,
      [
        input.requestId,
        input.locationId,
        input.quantity,
        input.reservationId,
        input.requiredPartRef,
      ]
    );
    if (!issue?.id) throw new Error('inventory: inv.issue_material_request returned no id');
    const movement = await this.runOne<{ id: string }>(
      db,
      `SELECT id FROM inv.stock_movements
        WHERE tenant_id = $1 AND reference_kind = 'part_issue' AND reference_id = $2
          AND direction = 'out'`,
      [context.principal.tenantId, issue.id]
    );
    if (!movement?.id) throw new Error('inventory: the issue posted no movement');
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
                           AND pr.part_issue_id = pi.id), 0)::numeric(12,3)::text AS returned_qty
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

  /**
   * The branch's stock movements in a calendar period, and the totals of the
   * whole selection (P1-31 prerequisite P-11, engine slice 3 — D-4, D-5, D-17).
   *
   * ## Why this is not `listMovements` with two more filters
   *
   * `listMovements` answers the ledger screen: it pages on `seq`, it accepts
   * instants, and it returns no master data beyond the SKU. This read answers a
   * REPORT: the period is a half-open range of calendar days in the branch's own
   * zone, the page is ordered by the instant the report is about, and each row
   * carries the unit and the location the Owner's column list names. Bolting both
   * onto one method would have given the ledger screen a second ordering contract
   * and a timezone it has no use for.
   *
   * ## ONE scope predicate, composed by both statements
   *
   * The totals and the page are computed over the same `FROM`/`WHERE`, written
   * once and interpolated into both. Two copies is how a total stops matching the
   * rows it is supposed to total — the specific defect a report cannot survive,
   * because nothing about it fails.
   *
   * ## The totals are separated, never netted
   *
   * `GROUP BY item, unit, movement type` with `in` and `out` as two FILTERed sums
   * rather than one signed sum over `signed_qty`. D-4 requires that a return and a
   * transfer keep their distinct meanings and D-5 forbids one quantity across
   * unlike items; a signed sum collapses a return into a negative issue, which is
   * the arithmetic those decisions exist to prevent. `signed_qty` is not selected
   * at all here.
   *
   * A FILTERed `sum` over an empty set is NULL, and the zero is supplied as
   * `0::numeric(12,3)` so the measure is a decimal string of the same scale as a
   * real one. The SUM ITSELF IS NEVER CAST: casting it back to `numeric(12,3)`
   * would make a large branch's total raise an overflow rather than report a
   * number, and nothing is rounded on the way out.
   *
   * ## No `deleted_at` filter, because the ledger has no delete
   *
   * `inv.stock_movements` is append-only and immutable — it has no `deleted_at`
   * and no status column. Every row that exists happened, which is why the period
   * and the branch are the only things narrowing this selection.
   */
  public async movementReport(
    db: DbHandle,
    filter: MovementReportFilter,
    request: PageRequest
  ): Promise<MovementReportRows> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.from,
      filter.toExclusive,
      filter.timezoneName,
    ];
    // Company and branch are predicates, not options. RLS narrows too, but on the
    // permission-blind grant union — so this is the predicate that makes the read
    // match the scope that was actually authorized.
    const scope = `FROM inv.stock_movements m
         JOIN inv.item_master i ON i.tenant_id = m.tenant_id AND i.id = m.item_id
         JOIN inv.units_of_measure u ON u.id = i.uom_id
         JOIN inv.stock_locations l
           ON l.tenant_id = m.tenant_id AND l.company_id = m.company_id
          AND l.branch_id = m.branch_id AND l.id = m.location_id
        WHERE m.tenant_id = $1 AND m.company_id = $2 AND m.branch_id = $3
          AND ${halfOpenLocalDayRange('m.occurred_at', 4, 5, 6)}`;

    const totals = await this.run<{
      item_id: string;
      sku: string;
      uom_code: string;
      movement_type: string;
      quantity_in: string;
      quantity_out: string;
    }>(
      db,
      `SELECT m.item_id, i.sku, u.code AS uom_code, m.movement_type,
              coalesce(sum(m.quantity) FILTER (WHERE m.direction = 'in'),
                       0::numeric(12, 3))::text  AS quantity_in,
              coalesce(sum(m.quantity) FILTER (WHERE m.direction = 'out'),
                       0::numeric(12, 3))::text  AS quantity_out
         ${scope}
        GROUP BY m.item_id, i.sku, u.code, m.movement_type
        ORDER BY i.sku, u.code, m.movement_type`,
      values
    );

    const keyset = keysetFragment(
      request,
      { sort: 'm.occurred_at', id: 'm.id' },
      MOVEMENT_REPORT_ORDER,
      values.length + 1
    );
    const rows = await this.run<{
      id: string;
      occurred_at: Date;
      reference_kind: string;
      reference_id: string;
      movement_type: string;
      direction: string;
      item_id: string;
      sku: string;
      item_name: string;
      location_id: string;
      location_code: string;
      location_name: string;
      quantity: string;
      uom_code: string;
      uom_name: string;
      sort_value: string;
    }>(
      db,
      `SELECT m.id, m.occurred_at, m.reference_kind, m.reference_id, m.movement_type,
              m.direction, m.item_id, i.sku, i.name AS item_name, m.location_id,
              l.location_code, l.name AS location_name, m.quantity,
              u.code AS uom_code, u.name AS uom_name,
              ${cursorTimestamp('m.occurred_at')} AS sort_value
         ${scope}
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );

    return {
      totals: totals.rows.map((row) => ({
        itemId: row.item_id,
        sku: row.sku,
        uomCode: row.uom_code,
        movementType: row.movement_type,
        quantityIn: row.quantity_in,
        quantityOut: row.quantity_out,
      })),
      // `buildPageWithCursors` rather than `buildPage`, because the cursor value
      // is NOT the published timestamp. `pg` decodes `timestamptz` into a JS
      // `Date`, which holds milliseconds while PostgreSQL stores microseconds, and
      // a cursor minted from `.toISOString()` silently SKIPS every row sharing the
      // boundary row's millisecond at a higher microsecond (`P1-27-INT-006`). The
      // `sort_value` column above is the microsecond-precision string.
      page: buildPageWithCursors(
        rows.rows.map((row) => ({
          item: {
            id: row.id,
            occurredAt: row.occurred_at,
            referenceKind: row.reference_kind,
            referenceId: row.reference_id,
            movementType: row.movement_type,
            direction: row.direction,
            itemId: row.item_id,
            sku: row.sku,
            itemName: row.item_name,
            locationId: row.location_id,
            locationCode: row.location_code,
            locationName: row.location_name,
            quantity: row.quantity,
            uomCode: row.uom_code,
            uomName: row.uom_name,
          },
          sortValue: row.sort_value,
          id: row.id,
        })),
        request,
        MOVEMENT_REPORT_ORDER
      ),
    };
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

  // -------------------------------------------------------------------------
  // Stock transfers (P1-32-PRE-040…042).
  //
  // Every quantity change below goes through `inv.dispatch_transfer`,
  // `inv.receive_transfer` or `inv.cancel_transfer`, which take the balance-row
  // `FOR UPDATE` lock and post the movements themselves. Nothing here reads a
  // balance and then writes based on the read.
  // -------------------------------------------------------------------------

  /**
   * Looks a transfer up by its idempotency key, BEFORE the dispatch is attempted.
   *
   * The same reason `readReservationByIdempotencyKey` exists:
   * `inv.dispatch_transfer` resolves a replay inside the balance lock and returns
   * the transfer that already exists, which is correct but indistinguishable from a
   * fresh dispatch once it returns — so a retrying client could not tell whether it
   * had moved the stock twice.
   */
  public async readTransferByIdempotencyKey(
    db: DbHandle,
    idempotencyKey: string
  ): Promise<TransferRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT id FROM inv.stock_transfers WHERE tenant_id = $1 AND idempotency_key = $2`,
      [context.principal.tenantId, idempotencyKey]
    );
    return row ? this.readTransfer(db, row.id) : null;
  }

  public async readTransfer(db: DbHandle, transferId: string): Promise<TransferRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<TransferSqlRow>(
      db,
      `${TRANSFER_COLUMNS} FROM inv.stock_transfers t WHERE t.tenant_id = $1 AND t.id = $2`,
      [context.principal.tenantId, transferId]
    );
    return row ? toTransferRow(row) : null;
  }

  /**
   * Reads the transfer under `FOR UPDATE`.
   *
   * Used by the receipt and cancellation paths so the scope check, the status
   * check, and the state change are one atomic decision. An unlocked pre-read would
   * let a concurrent receipt land between the check and the call, and this module
   * would then audit a state change that the other transaction actually made.
   */
  public async lockTransfer(db: DbHandle, transferId: string): Promise<TransferRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<TransferSqlRow>(
      db,
      `${TRANSFER_COLUMNS} FROM inv.stock_transfers t
        WHERE t.tenant_id = $1 AND t.id = $2
        FOR UPDATE`,
      [context.principal.tenantId, transferId]
    );
    return row ? toTransferRow(row) : null;
  }

  public async dispatchTransfer(
    db: DbHandle,
    input: {
      readonly itemId: string;
      readonly fromLocationId: string;
      readonly toLocationId: string;
      readonly quantity: string;
      readonly reason: string | null;
      readonly idempotencyKey: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<{ readonly id: string }> {
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.dispatch_transfer($1, $2, $3, $4::numeric, $5, $6, $7) AS id`,
      [
        input.itemId,
        input.fromLocationId,
        input.toLocationId,
        input.quantity,
        input.reason,
        input.idempotencyKey,
        input.correlationId,
      ]
    );
    if (!row?.id) throw new Error('inventory: dispatch_transfer returned no id');
    return { id: row.id };
  }

  public async receiveTransfer(
    db: DbHandle,
    input: {
      readonly transferId: string;
      readonly quantity: string;
      readonly correlationId: string | null;
    }
  ): Promise<void> {
    await this.run(db, `SELECT inv.receive_transfer($1, $2::numeric, $3)`, [
      input.transferId,
      input.quantity,
      input.correlationId,
    ]);
  }

  public async cancelTransfer(
    db: DbHandle,
    input: {
      readonly transferId: string;
      readonly reason: string;
      readonly correlationId: string | null;
    }
  ): Promise<void> {
    await this.run(db, `SELECT inv.cancel_transfer($1, $2, $3)`, [
      input.transferId,
      input.reason,
      input.correlationId,
    ]);
  }

  /**
   * One branch's transfers, newest first.
   *
   * `direction` selects which side of the branch the list is about. The two are
   * genuinely different questions — what this branch sent, and what is coming to
   * it — and `inv.stock_transfers` answers both from one row because the
   * destination reads it through `sel_stock_transfers_destination`. The predicate
   * is explicit rather than left to RLS, for the reason recorded on
   * `listMovements`: `app.branch_ids` is the permission-blind union of every active
   * grant, so without it a caller with any grant in a second branch would see that
   * branch's transfers here too.
   */
  public async listTransfers(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly direction: 'outbound' | 'inbound';
      readonly status?: string | undefined;
      readonly itemId?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<TransferListRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.status ?? null,
      filter.itemId ?? null,
    ];
    const branchColumn = filter.direction === 'inbound' ? 't.to_branch_id' : 't.branch_id';
    const keyset = keysetFragment(
      request,
      { sort: 't.created_at', id: 't.id' },
      TRANSFER_ORDER,
      values.length + 1
    );
    const result = await this.run<
      TransferSqlRow & {
        sku: string;
        from_location_code: string | null;
        to_location_code: string | null;
        sort_value: string;
      }
    >(
      db,
      `${TRANSFER_COLUMNS}, i.sku, fl.location_code AS from_location_code,
              tl.location_code AS to_location_code,
              ${cursorTimestamp('t.created_at')} AS sort_value
         FROM inv.stock_transfers t
         JOIN inv.item_master i ON i.tenant_id = t.tenant_id AND i.id = t.item_id
         LEFT JOIN inv.stock_locations fl ON fl.tenant_id = t.tenant_id AND fl.id = t.from_location_id
         LEFT JOIN inv.stock_locations tl ON tl.tenant_id = t.tenant_id AND tl.id = t.to_location_id
        WHERE t.tenant_id = $1 AND t.company_id = $2 AND ${branchColumn} = $3
          AND ($4::text IS NULL OR t.status = $4)
          AND ($5::uuid IS NULL OR t.item_id = $5)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          ...toTransferRow(row),
          sku: row.sku,
          fromLocationCode: row.from_location_code,
          toLocationCode: row.to_location_code,
        },
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      TRANSFER_ORDER
    );
  }

  // -------------------------------------------------------------------------
  // Goods receipts (P1-32-PRE-043…045).
  // -------------------------------------------------------------------------

  public async readGoodsReceiptByIdempotencyKey(
    db: DbHandle,
    idempotencyKey: string
  ): Promise<GoodsReceiptRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT id FROM inv.goods_receipts WHERE tenant_id = $1 AND idempotency_key = $2`,
      [context.principal.tenantId, idempotencyKey]
    );
    return row ? this.readGoodsReceipt(db, row.id) : null;
  }

  /**
   * Inserts the draft header.
   *
   * A plain INSERT, unlike every stock path in this file, and legitimately so: a
   * draft receipt moves nothing. Stock appears only when `inv.post_goods_receipt`
   * runs, and that goes through `inv.post_stock_movement` like everything else.
   */
  public async createGoodsReceipt(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly reference: string | null;
      readonly supplierReference: string | null;
      readonly receivedOn: string;
      readonly notes: string | null;
      readonly idempotencyKey: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<{ readonly id: string }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO inv.goods_receipts
         (tenant_id, company_id, branch_id, reference, supplier_reference, received_on,
          status, notes, correlation_id, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, 'draft', $7, $8, $9, $10)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.reference,
        input.supplierReference,
        input.receivedOn,
        input.notes,
        input.correlationId,
        input.idempotencyKey,
        context.principal.userId,
      ]
    );
    if (!row?.id) throw new Error('inventory: goods receipt insert returned no id');
    return { id: row.id };
  }

  public async insertGoodsReceiptLine(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly receiptId: string;
      readonly lineNo: number;
      readonly itemId: string;
      readonly locationId: string;
      readonly quantity: string;
      readonly unitCost: string | null;
      readonly currencyCode: string | null;
    }
  ): Promise<{ readonly id: string }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO inv.goods_receipt_lines
         (tenant_id, company_id, branch_id, receipt_id, line_no, item_id, location_id,
          quantity, unit_cost, currency_code, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10, $11)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receiptId,
        input.lineNo,
        input.itemId,
        input.locationId,
        input.quantity,
        input.unitCost,
        input.currencyCode,
        context.principal.userId,
      ]
    );
    if (!row?.id) throw new Error('inventory: goods receipt line insert returned no id');
    return { id: row.id };
  }

  public async readGoodsReceipt(db: DbHandle, receiptId: string): Promise<GoodsReceiptRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<GoodsReceiptSqlRow>(
      db,
      `${GOODS_RECEIPT_COLUMNS}
         FROM inv.goods_receipts r
        WHERE r.tenant_id = $1 AND r.id = $2`,
      [context.principal.tenantId, receiptId]
    );
    return row ? toGoodsReceiptRow(row) : null;
  }

  public async lockGoodsReceipt(db: DbHandle, receiptId: string): Promise<GoodsReceiptRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<GoodsReceiptSqlRow>(
      db,
      `${GOODS_RECEIPT_COLUMNS}
         FROM inv.goods_receipts r
        WHERE r.tenant_id = $1 AND r.id = $2
        FOR UPDATE OF r`,
      [context.principal.tenantId, receiptId]
    );
    return row ? toGoodsReceiptRow(row) : null;
  }

  /**
   * The lines of one receipt, by line number — WITHOUT their unit cost.
   *
   * `has_unit_cost` says whether a line will produce a cost layer without saying
   * what the figure is, so an operator who may not see cost can still tell a priced
   * line from an unpriced one. The figure itself is readable only through the
   * `inv.cost.view`-gated `inv.item_cost_layers`.
   */
  public async listGoodsReceiptLines(
    db: DbHandle,
    receiptId: string
  ): Promise<readonly GoodsReceiptLineRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      line_no: number;
      item_id: string;
      sku: string;
      location_id: string;
      location_code: string;
      quantity: string;
      has_unit_cost: boolean;
    }>(
      db,
      `SELECT l.id, l.line_no, l.item_id, i.sku, l.location_id, loc.location_code,
              l.quantity, (l.unit_cost IS NOT NULL) AS has_unit_cost
         FROM inv.goods_receipt_lines l
         JOIN inv.item_master i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
         JOIN inv.stock_locations loc ON loc.tenant_id = l.tenant_id AND loc.id = l.location_id
        WHERE l.tenant_id = $1 AND l.receipt_id = $2
        ORDER BY l.line_no`,
      [context.principal.tenantId, receiptId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      lineNo: row.line_no,
      itemId: row.item_id,
      sku: row.sku,
      locationId: row.location_id,
      locationCode: row.location_code,
      quantity: row.quantity,
      hasUnitCost: row.has_unit_cost,
    }));
  }

  public async postGoodsReceipt(
    db: DbHandle,
    receiptId: string,
    correlationId: string | null
  ): Promise<number> {
    const row = await this.runOne<{ lines: string }>(
      db,
      `SELECT inv.post_goods_receipt($1, $2)::text AS lines`,
      [receiptId, correlationId]
    );
    return Number.parseInt(row?.lines ?? '0', 10);
  }

  public async listGoodsReceipts(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<GoodsReceiptRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.status ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'r.created_at', id: 'r.id' },
      GOODS_RECEIPT_ORDER,
      values.length + 1
    );
    const result = await this.run<GoodsReceiptSqlRow & { sort_value: string }>(
      db,
      `${GOODS_RECEIPT_COLUMNS}, ${cursorTimestamp('r.created_at')} AS sort_value
         FROM inv.goods_receipts r
        WHERE r.tenant_id = $1 AND r.company_id = $2 AND r.branch_id = $3
          AND ($4::text IS NULL OR r.status = $4)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: toGoodsReceiptRow(row),
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      GOODS_RECEIPT_ORDER
    );
  }

  // -------------------------------------------------------------------------
  // Cost history (P1-32-PRE-045).
  // -------------------------------------------------------------------------

  /**
   * One item's cost layers in this branch, newest effective first.
   *
   * Every row is behind `sel_item_cost_layers_gated`, so a caller without
   * `inv.cost.view` reads an empty page from the DATABASE rather than from an `if`
   * in this file. That is the whole reason the layers live in their own table.
   */
  public async listItemCostLayers(
    db: DbHandle,
    itemId: string,
    scope: { readonly companyId: string; readonly branchId: string },
    request: PageRequest
  ): Promise<Page<CostLayerRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, itemId, scope.companyId, scope.branchId];
    const keyset = keysetFragment(
      request,
      { sort: 'c.effective_at', id: 'c.id' },
      COST_LAYER_ORDER,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      company_id: string;
      branch_id: string;
      source_kind: string;
      source_id: string;
      quantity: string;
      unit_cost: string;
      currency_code: string;
      effective_at: Date;
      sort_value: string;
    }>(
      db,
      `SELECT c.id, c.company_id, c.branch_id, c.source_kind, c.source_id, c.quantity,
              c.unit_cost, c.currency_code, c.effective_at,
              ${cursorTimestamp('c.effective_at')} AS sort_value
         FROM inv.item_cost_layers c
        WHERE c.tenant_id = $1 AND c.item_id = $2 AND c.company_id = $3 AND c.branch_id = $4
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
          sourceKind: row.source_kind,
          sourceId: row.source_id,
          quantity: row.quantity,
          unitCost: row.unit_cost,
          currencyCode: row.currency_code,
          effectiveAt: row.effective_at,
        },
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      COST_LAYER_ORDER
    );
  }

  /**
   * The two derived reference costs, computed in SQL over `numeric`.
   *
   * `SUM(quantity * unit_cost) / SUM(quantity)` never leaves the database, and is
   * rounded there to the `numeric(18,4)` scale every stored cost has — a division
   * carries sixteen fractional digits that no column could hold. Doing the same
   * division in JavaScript would be the floating-point arithmetic the money rule
   * forbids, and would be wrong in the third decimal place of a real cost.
   *
   * `currency_count` is returned rather than hidden: layers in two currencies
   * cannot be averaged into one figure, and the caller must be told that instead of
   * being handed a number that means nothing.
   */
  public async readItemCostSummary(
    db: DbHandle,
    itemId: string,
    scope: { readonly companyId: string; readonly branchId: string }
  ): Promise<ItemCostSummaryRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      latest_unit_cost: string | null;
      weighted_average_cost: string | null;
      currency_code: string | null;
      currency_count: string;
      layer_count: string;
      total_quantity: string;
    }>(
      db,
      `SELECT
         (SELECT l.unit_cost FROM inv.item_cost_layers l
           WHERE l.tenant_id = $1 AND l.item_id = $2 AND l.company_id = $3 AND l.branch_id = $4
           ORDER BY l.effective_at DESC, l.id DESC LIMIT 1) AS latest_unit_cost,
         (SELECT CASE WHEN SUM(l.quantity) > 0
                      THEN round(SUM(l.quantity * l.unit_cost) / SUM(l.quantity), 4)::numeric(18, 4)
                 END
            FROM inv.item_cost_layers l
           WHERE l.tenant_id = $1 AND l.item_id = $2 AND l.company_id = $3 AND l.branch_id = $4)
           AS weighted_average_cost,
         (SELECT l.currency_code FROM inv.item_cost_layers l
           WHERE l.tenant_id = $1 AND l.item_id = $2 AND l.company_id = $3 AND l.branch_id = $4
           ORDER BY l.effective_at DESC, l.id DESC LIMIT 1) AS currency_code,
         (SELECT count(DISTINCT l.currency_code)::text FROM inv.item_cost_layers l
           WHERE l.tenant_id = $1 AND l.item_id = $2 AND l.company_id = $3 AND l.branch_id = $4)
           AS currency_count,
         (SELECT count(*)::text FROM inv.item_cost_layers l
           WHERE l.tenant_id = $1 AND l.item_id = $2 AND l.company_id = $3 AND l.branch_id = $4)
           AS layer_count,
         (SELECT COALESCE(SUM(l.quantity), 0)::numeric(12, 3)::text FROM inv.item_cost_layers l
           WHERE l.tenant_id = $1 AND l.item_id = $2 AND l.company_id = $3 AND l.branch_id = $4)
           AS total_quantity`,
      [context.principal.tenantId, itemId, scope.companyId, scope.branchId]
    );
    return {
      latestUnitCost: row?.latest_unit_cost ?? null,
      weightedAverageCost: row?.weighted_average_cost ?? null,
      currencyCode: row?.currency_code ?? null,
      currencyCount: Number.parseInt(row?.currency_count ?? '0', 10),
      layerCount: Number.parseInt(row?.layer_count ?? '0', 10),
      totalQuantity: row?.total_quantity ?? '0.000',
    };
  }

  // -------------------------------------------------------------------------
  // Stock adjustments (P1-32-PRE-046).
  // -------------------------------------------------------------------------

  public async createAdjustment(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId: string;
      readonly locationId: string;
      readonly direction: string;
      readonly quantity: string;
      readonly reason: string;
    }
  ): Promise<{ readonly id: string }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO inv.stock_adjustments
         (tenant_id, company_id, branch_id, item_id, location_id, direction, quantity,
          reason, status, requested_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, 'pending', $9, $9)
       RETURNING id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.itemId,
        input.locationId,
        input.direction,
        input.quantity,
        input.reason,
        context.principal.userId,
      ]
    );
    if (!row?.id) throw new Error('inventory: adjustment insert returned no id');
    return { id: row.id };
  }

  /**
   * Writes the RESTRICTED value impact of an adjustment.
   *
   * `ins_stock_adjustment_details_gated` requires `inv.cost.view`, so a caller
   * without it is refused by the DATABASE — this method does not check, because a
   * second check in application code would be a second definition of who may see
   * cost, and the two would eventually disagree.
   */
  public async createAdjustmentDetail(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly adjustmentId: string;
      readonly valueImpact: string;
      readonly currencyCode: string;
    }
  ): Promise<void> {
    const context = this.assertContext(db);
    await this.run(
      db,
      `INSERT INTO inv.stock_adjustment_details
         (tenant_id, company_id, branch_id, adjustment_id, value_impact, currency_code, created_by)
       VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.adjustmentId,
        input.valueImpact,
        input.currencyCode,
        context.principal.userId,
      ]
    );
  }

  public async readAdjustment(db: DbHandle, adjustmentId: string): Promise<AdjustmentRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<AdjustmentSqlRow>(
      db,
      `${ADJUSTMENT_COLUMNS} FROM inv.stock_adjustments a
        WHERE a.tenant_id = $1 AND a.id = $2 AND a.deleted_at IS NULL`,
      [context.principal.tenantId, adjustmentId]
    );
    return row ? toAdjustmentRow(row) : null;
  }

  public async lockAdjustment(db: DbHandle, adjustmentId: string): Promise<AdjustmentRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<AdjustmentSqlRow>(
      db,
      `${ADJUSTMENT_COLUMNS} FROM inv.stock_adjustments a
        WHERE a.tenant_id = $1 AND a.id = $2 AND a.deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, adjustmentId]
    );
    return row ? toAdjustmentRow(row) : null;
  }

  public async approveAdjustment(db: DbHandle, adjustmentId: string): Promise<void> {
    await this.run(db, `SELECT inv.approve_adjustment($1)`, [adjustmentId]);
  }

  public async rejectAdjustment(db: DbHandle, adjustmentId: string): Promise<void> {
    await this.run(db, `SELECT inv.reject_adjustment($1)`, [adjustmentId]);
  }

  public async listAdjustments(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
      readonly itemId?: string | undefined;
      readonly locationId?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<AdjustmentListRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.status ?? null,
      filter.itemId ?? null,
      filter.locationId ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'a.created_at', id: 'a.id' },
      ADJUSTMENT_ORDER,
      values.length + 1
    );
    const result = await this.run<
      AdjustmentSqlRow & { sku: string; location_code: string; sort_value: string }
    >(
      db,
      `${ADJUSTMENT_COLUMNS}, i.sku, l.location_code,
              ${cursorTimestamp('a.created_at')} AS sort_value
         FROM inv.stock_adjustments a
         JOIN inv.item_master i ON i.tenant_id = a.tenant_id AND i.id = a.item_id
         JOIN inv.stock_locations l ON l.tenant_id = a.tenant_id AND l.id = a.location_id
        WHERE a.tenant_id = $1 AND a.company_id = $2 AND a.branch_id = $3
          AND a.deleted_at IS NULL
          AND ($4::text IS NULL OR a.status = $4)
          AND ($5::uuid IS NULL OR a.item_id = $5)
          AND ($6::uuid IS NULL OR a.location_id = $6)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: { ...toAdjustmentRow(row), sku: row.sku, locationCode: row.location_code },
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      ADJUSTMENT_ORDER
    );
  }

  // -------------------------------------------------------------------------
  // Stock counts (P1-32-PRE-047…049).
  // -------------------------------------------------------------------------

  public async readStockCountByIdempotencyKey(
    db: DbHandle,
    idempotencyKey: string
  ): Promise<StockCountRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT id FROM inv.stock_counts WHERE tenant_id = $1 AND idempotency_key = $2`,
      [context.principal.tenantId, idempotencyKey]
    );
    return row ? this.readStockCount(db, row.id) : null;
  }

  public async openStockCount(
    db: DbHandle,
    input: {
      readonly locationId: string;
      readonly notes: string | null;
      readonly idempotencyKey: string | null;
      readonly correlationId: string | null;
    }
  ): Promise<{ readonly id: string }> {
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.open_stock_count($1, $2, $3, $4) AS id`,
      [input.locationId, input.notes, input.idempotencyKey, input.correlationId]
    );
    if (!row?.id) throw new Error('inventory: open_stock_count returned no id');
    return { id: row.id };
  }

  public async readStockCount(db: DbHandle, countId: string): Promise<StockCountRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<StockCountSqlRow>(
      db,
      `${STOCK_COUNT_COLUMNS} FROM inv.stock_counts c WHERE c.tenant_id = $1 AND c.id = $2`,
      [context.principal.tenantId, countId]
    );
    return row ? toStockCountRow(row) : null;
  }

  public async lockStockCount(db: DbHandle, countId: string): Promise<StockCountRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<StockCountSqlRow>(
      db,
      `${STOCK_COUNT_COLUMNS} FROM inv.stock_counts c
        WHERE c.tenant_id = $1 AND c.id = $2
        FOR UPDATE`,
      [context.principal.tenantId, countId]
    );
    return row ? toStockCountRow(row) : null;
  }

  public async recordStockCountLine(
    db: DbHandle,
    input: {
      readonly countId: string;
      readonly itemId: string;
      readonly countedQuantity: string;
    }
  ): Promise<void> {
    await this.run(db, `SELECT inv.record_stock_count_line($1, $2, $3::numeric)`, [
      input.countId,
      input.itemId,
      input.countedQuantity,
    ]);
  }

  /** Returns the number of PENDING adjustments the reconciliation raised. */
  public async reconcileStockCount(
    db: DbHandle,
    countId: string,
    correlationId: string | null
  ): Promise<number> {
    const row = await this.runOne<{ raised: string }>(
      db,
      `SELECT inv.reconcile_stock_count($1, $2)::text AS raised`,
      [countId, correlationId]
    );
    return Number.parseInt(row?.raised ?? '0', 10);
  }

  public async cancelStockCount(db: DbHandle, countId: string, reason: string): Promise<void> {
    await this.run(db, `SELECT inv.cancel_stock_count($1, $2)`, [countId, reason]);
  }

  /**
   * One count's lines, by SKU, with the adjustment each variance raised.
   *
   * `variance_qty` is read from the GENERATED column rather than recomputed, so
   * the figure a reader sees is the figure the database derived from the three
   * inputs beside it.
   */
  public async listStockCountLines(
    db: DbHandle,
    countId: string
  ): Promise<readonly StockCountLineRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      item_id: string;
      sku: string;
      snapshot_qty: string;
      counted_qty: string | null;
      movement_delta_during_count: string;
      variance_qty: string | null;
      adjustment_id: string | null;
      adjustment_status: string | null;
    }>(
      db,
      `SELECT ln.id, ln.item_id, i.sku, ln.snapshot_qty, ln.counted_qty,
              ln.movement_delta_during_count, ln.variance_qty, ln.adjustment_id,
              a.status AS adjustment_status
         FROM inv.stock_count_lines ln
         JOIN inv.item_master i ON i.tenant_id = ln.tenant_id AND i.id = ln.item_id
         LEFT JOIN inv.stock_adjustments a
           ON a.tenant_id = ln.tenant_id AND a.id = ln.adjustment_id
        WHERE ln.tenant_id = $1 AND ln.count_id = $2
        ORDER BY i.sku, ln.id`,
      [context.principal.tenantId, countId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      sku: row.sku,
      snapshotQty: row.snapshot_qty,
      countedQty: row.counted_qty,
      movementDeltaDuringCount: row.movement_delta_during_count,
      varianceQty: row.variance_qty,
      adjustmentId: row.adjustment_id,
      adjustmentStatus: row.adjustment_status,
    }));
  }

  public async listStockCounts(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
      readonly locationId?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<StockCountListRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.status ?? null,
      filter.locationId ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'c.created_at', id: 'c.id' },
      STOCK_COUNT_ORDER,
      values.length + 1
    );
    const result = await this.run<
      StockCountSqlRow & {
        location_code: string;
        line_count: string;
        counted_line_count: string;
        variance_line_count: string;
        absolute_variance_qty: string;
        sort_value: string;
      }
    >(
      db,
      `${STOCK_COUNT_COLUMNS}, l.location_code,
              ${STOCK_COUNT_VARIANCE_COLUMNS},
              ${cursorTimestamp('c.created_at')} AS sort_value
         FROM inv.stock_counts c
         JOIN inv.stock_locations l ON l.tenant_id = c.tenant_id AND l.id = c.location_id
        WHERE c.tenant_id = $1 AND c.company_id = $2 AND c.branch_id = $3
          AND ($4::text IS NULL OR c.status = $4)
          AND ($5::uuid IS NULL OR c.location_id = $5)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          ...toStockCountRow(row),
          locationCode: row.location_code,
          lineCount: Number.parseInt(row.line_count, 10),
          countedLineCount: Number.parseInt(row.counted_line_count, 10),
          varianceLineCount: Number.parseInt(row.variance_line_count, 10),
          absoluteVarianceQty: row.absolute_variance_qty,
        },
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      STOCK_COUNT_ORDER
    );
  }

  /**
   * The discrepancy figures for ONE count.
   *
   * The same SQL the list uses, so the detail screen and the list cannot disagree
   * about how many lines varied. `absolute_variance_qty` sums `abs(variance_qty)`
   * in `numeric` and crosses as a decimal string: summing signed variances would
   * let a surplus of ten hide a shortage of ten and report a perfect count.
   */
  public async readStockCountVariance(
    db: DbHandle,
    countId: string
  ): Promise<{
    readonly lineCount: number;
    readonly countedLineCount: number;
    readonly varianceLineCount: number;
    readonly absoluteVarianceQty: string;
  }> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      line_count: string;
      counted_line_count: string;
      variance_line_count: string;
      absolute_variance_qty: string;
    }>(
      db,
      `SELECT ${STOCK_COUNT_VARIANCE_COLUMNS}
         FROM inv.stock_counts c
        WHERE c.tenant_id = $1 AND c.id = $2`,
      [context.principal.tenantId, countId]
    );
    return {
      lineCount: Number.parseInt(row?.line_count ?? '0', 10),
      countedLineCount: Number.parseInt(row?.counted_line_count ?? '0', 10),
      varianceLineCount: Number.parseInt(row?.variance_line_count ?? '0', 10),
      absoluteVarianceQty: row?.absolute_variance_qty ?? '0.000',
    };
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

  // -------------------------------------------------------------------------
  // P1-32-PRE-100…104 — item barcodes and packaging identifiers.
  // -------------------------------------------------------------------------

  /** Every identifier of one item, live first, then by kind and value. */
  public async listItemIdentifiers(
    db: DbHandle,
    itemId: string,
    options: { readonly includeRetired: boolean }
  ): Promise<readonly ItemIdentifierRow[]> {
    const context = this.assertContext(db);
    const rows = await this.run<ItemIdentifierSql>(
      db,
      `SELECT ${IDENTIFIER_COLUMNS}
         FROM inv.item_identifiers x
         JOIN inv.units_of_measure u ON u.id = x.unit_id
        WHERE x.tenant_id = $1 AND x.item_id = $2
          AND ($3::boolean OR x.retired_at IS NULL)
        ORDER BY (x.retired_at IS NULL) DESC, x.is_primary DESC, x.identifier_kind, x.normalized_value, x.id`,
      [context.principal.tenantId, itemId, options.includeRetired]
    );
    return rows.rows.map(toItemIdentifier);
  }

  public async readItemIdentifier(
    db: DbHandle,
    identifierId: string
  ): Promise<ItemIdentifierRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ItemIdentifierSql>(
      db,
      `SELECT ${IDENTIFIER_COLUMNS}
         FROM inv.item_identifiers x
         JOIN inv.units_of_measure u ON u.id = x.unit_id
        WHERE x.tenant_id = $1 AND x.id = $2`,
      [context.principal.tenantId, identifierId]
    );
    return row ? toItemIdentifier(row) : null;
  }

  /** `inv.add_item_identifier`, which demotes a previous primary in the same call. */
  public async addItemIdentifier(
    db: DbHandle,
    input: {
      readonly itemId: string;
      readonly kind: string;
      readonly value: string;
      readonly unitId: string | null;
      readonly packQuantity: string;
      readonly isPrimary: boolean;
    }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.add_item_identifier($1, $2, $3, $4, $5::numeric, $6) AS id`,
      [input.itemId, input.kind, input.value, input.unitId, input.packQuantity, input.isPrimary]
    );
    if (!row) throw new Error('inventory: inv.add_item_identifier returned no row');
    return row.id;
  }

  /** `inv.assign_internal_barcode` — idempotent per item. */
  public async assignInternalBarcode(db: DbHandle, itemId: string): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.assign_internal_barcode($1) AS id`,
      [itemId]
    );
    if (!row) throw new Error('inventory: inv.assign_internal_barcode returned no row');
    return row.id;
  }

  public async retireItemIdentifier(db: DbHandle, identifierId: string): Promise<void> {
    this.assertContext(db);
    await this.run(db, `SELECT inv.retire_item_identifier($1)`, [identifierId]);
  }

  /**
   * Every LIVE identifier whose normalised value equals the scanned value, with its
   * item. The scanned value is normalised by the same SQL function that generates
   * the stored column, so there is one rule rather than two.
   */
  public async resolveItemIdentifiers(
    db: DbHandle,
    scanned: string
  ): Promise<readonly ResolvedIdentifierRow[]> {
    const context = this.assertContext(db);
    const rows = await this.run<
      ItemIdentifierSql & {
        sku: string;
        item_name: string;
        is_serialized: boolean;
        is_stock_tracked: boolean;
        lifecycle_status: string;
      }
    >(
      db,
      `SELECT ${IDENTIFIER_COLUMNS}, i.sku, i.name AS item_name, i.is_serialized,
              i.is_stock_tracked, i.lifecycle_status
         FROM inv.item_identifiers x
         JOIN inv.units_of_measure u ON u.id = x.unit_id
         JOIN inv.item_master i ON i.tenant_id = x.tenant_id AND i.id = x.item_id
        WHERE x.tenant_id = $1 AND x.retired_at IS NULL AND i.deleted_at IS NULL
          AND x.normalized_value = inv.normalize_item_identifier($2)
        ORDER BY x.item_id, x.is_primary DESC, x.id`,
      [context.principal.tenantId, scanned]
    );
    return rows.rows.map((r) => ({
      ...toItemIdentifier(r),
      sku: r.sku,
      itemName: r.item_name,
      isSerialized: r.is_serialized,
      isStockTracked: r.is_stock_tracked,
      lifecycleStatus: r.lifecycle_status,
    }));
  }

  // -------------------------------------------------------------------------
  // P1-32-PRE-105…106 — the selling price of an item.
  // -------------------------------------------------------------------------

  /** Every live price row of one item, most specific first. */
  public async listItemSalePrices(
    db: DbHandle,
    itemId: string
  ): Promise<readonly ItemSalePriceRow[]> {
    const context = this.assertContext(db);
    const rows = await this.run<ItemSalePriceSql>(
      db,
      `SELECT ${SALE_PRICE_COLUMNS}
         FROM inv.item_sale_prices p
         LEFT JOIN org.tax_classes tc
           ON tc.tenant_id = p.tenant_id AND tc.company_id = p.company_id AND tc.id = p.tax_class_id
        WHERE p.tenant_id = $1 AND p.item_id = $2 AND p.deleted_at IS NULL
        ORDER BY (p.branch_id IS NOT NULL) DESC, (p.company_id IS NOT NULL) DESC, p.id`,
      [context.principal.tenantId, itemId]
    );
    return rows.rows.map(toItemSalePrice);
  }

  public async readItemSalePrice(db: DbHandle, priceId: string): Promise<ItemSalePriceRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ItemSalePriceSql>(
      db,
      `SELECT ${SALE_PRICE_COLUMNS}
         FROM inv.item_sale_prices p
         LEFT JOIN org.tax_classes tc
           ON tc.tenant_id = p.tenant_id AND tc.company_id = p.company_id AND tc.id = p.tax_class_id
        WHERE p.tenant_id = $1 AND p.id = $2 AND p.deleted_at IS NULL`,
      [context.principal.tenantId, priceId]
    );
    return row ? toItemSalePrice(row) : null;
  }

  /** `inv.set_item_sale_price` — one live row per (item, company, branch). */
  public async setItemSalePrice(
    db: DbHandle,
    input: {
      readonly itemId: string;
      readonly companyId: string | null;
      readonly branchId: string | null;
      readonly currencyCode: string;
      /** Exact decimal STRING; never a number. */
      readonly unitPrice: string;
      readonly taxClassId: string | null;
    }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.set_item_sale_price($1, $2, $3, $4, $5::numeric, $6) AS id`,
      [
        input.itemId,
        input.companyId,
        input.branchId,
        input.currencyCode,
        input.unitPrice,
        input.taxClassId,
      ]
    );
    if (!row) throw new Error('inventory: inv.set_item_sale_price returned no row');
    return row.id;
  }

  // -------------------------------------------------------------------------
  // P1-32-PRE-111…116 — the counter sale's stock leg, and sales returns.
  // -------------------------------------------------------------------------

  /**
   * `inv.post_counter_sale_line` — the `sale`/`out` movement of ONE invoice line.
   *
   * The line id is the only argument: the item, the cell and the quantity are read
   * from the line inside the function, so nothing a caller passes can redirect the
   * posting to another shelf.
   */
  public async postCounterSaleLine(db: DbHandle, invoiceLineId: string): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.post_counter_sale_line($1, $2) AS id`,
      [invoiceLineId, db.context.correlationId]
    );
    if (!row) throw new Error('inventory: inv.post_counter_sale_line returned no movement');
    return row.id;
  }

  /** `inv.returnable_quantity` — advisory; null when the source cannot be returned. */
  public async readReturnableQuantity(
    db: DbHandle,
    sourceKind: string,
    sourceId: string
  ): Promise<ReturnableQuantityRow | null> {
    this.assertContext(db);
    const row = await this.runOne<{
      source_quantity: string;
      returned_quantity: string;
      remaining_quantity: string;
      item_id: string;
      company_id: string;
      branch_id: string;
    }>(
      db,
      `SELECT source_quantity::text AS source_quantity,
              returned_quantity::text AS returned_quantity,
              remaining_quantity::text AS remaining_quantity,
              item_id, company_id, branch_id
         FROM inv.returnable_quantity($1, $2)`,
      [sourceKind, sourceId]
    );
    return row
      ? {
          sourceQuantity: row.source_quantity,
          returnedQuantity: row.returned_quantity,
          remainingQuantity: row.remaining_quantity,
          itemId: row.item_id,
          companyId: row.company_id,
          branchId: row.branch_id,
        }
      : null;
  }

  /** `inv.receive_sales_return` — the row, the movement and, for a sale, the credit. */
  public async receiveSalesReturn(
    db: DbHandle,
    input: {
      readonly sourceKind: string;
      readonly sourceId: string;
      readonly quantity: string;
      readonly condition: string;
      readonly receivedLocationId: string;
      readonly quarantineLocationId: string | null;
      readonly reason: string | null;
      readonly idempotencyKey: string | null;
    }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.receive_sales_return($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9) AS id`,
      [
        input.sourceKind,
        input.sourceId,
        input.quantity,
        input.condition,
        input.receivedLocationId,
        input.quarantineLocationId,
        input.reason,
        input.idempotencyKey,
        db.context.correlationId,
      ]
    );
    if (!row) throw new Error('inventory: inv.receive_sales_return returned no row');
    return row.id;
  }

  public async readSalesReturn(db: DbHandle, returnId: string): Promise<SalesReturnRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<SalesReturnSql>(
      db,
      `SELECT ${SALES_RETURN_COLUMNS}
         FROM inv.sales_returns r
        WHERE r.tenant_id = $1 AND r.id = $2`,
      [context.principal.tenantId, returnId]
    );
    return row ? toSalesReturn(row) : null;
  }

  public async readSalesReturnByIdempotencyKey(
    db: DbHandle,
    key: string
  ): Promise<SalesReturnRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<SalesReturnSql>(
      db,
      `SELECT ${SALES_RETURN_COLUMNS}
         FROM inv.sales_returns r
        WHERE r.tenant_id = $1 AND r.idempotency_key = $2`,
      [context.principal.tenantId, key]
    );
    return row ? toSalesReturn(row) : null;
  }

  /** One branch's returns, newest first, optionally narrowed to one source. */
  public async listSalesReturns(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly sourceKind?: string | undefined;
      readonly sourceId?: string | undefined;
      readonly condition?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<SalesReturnListRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.sourceKind ?? null,
      filter.sourceId ?? null,
      filter.condition ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'r.created_at', id: 'r.id' },
      SALES_RETURN_ORDER,
      values.length + 1
    );
    const result = await this.run<SalesReturnSql & { sku: string; sort_value: string }>(
      db,
      `SELECT ${SALES_RETURN_COLUMNS}, i.sku,
              ${cursorTimestamp('r.created_at')} AS sort_value
         FROM inv.sales_returns r
         JOIN inv.item_master i ON i.tenant_id = r.tenant_id AND i.id = r.item_id
        WHERE r.tenant_id = $1 AND r.company_id = $2 AND r.branch_id = $3
          AND ($4::text IS NULL OR r.source_kind = $4)
          AND ($5::uuid IS NULL OR r.source_id = $5)
          AND ($6::text IS NULL OR r.return_condition = $6)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: { ...toSalesReturn(row), sku: row.sku },
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      SALES_RETURN_ORDER
    );
  }

  // -------------------------------------------------------------------------
  // P1-32 preparatory slice 3b — unit conversions (P1-32-PRE-125).
  // -------------------------------------------------------------------------

  public async listUnitConversions(
    db: DbHandle,
    filter: { readonly itemId?: string | undefined; readonly includeRetired: boolean },
    request: PageRequest
  ): Promise<Page<UnitConversionRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.itemId ?? null,
      filter.includeRetired,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'c.created_at', id: 'c.id' },
      UNIT_CONVERSION_ORDER,
      values.length + 1
    );
    const result = await this.run<UnitConversionSql & { sort_value: string }>(
      db,
      `SELECT ${UNIT_CONVERSION_COLUMNS}, ${cursorTimestamp('c.created_at')} AS sort_value
         ${UNIT_CONVERSION_FROM}
        WHERE c.tenant_id = $1
          AND ($2::uuid IS NULL OR c.item_id = $2 OR c.item_id IS NULL)
          AND ($3::boolean OR c.status = 'active')
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: toUnitConversion(row),
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      UNIT_CONVERSION_ORDER
    );
  }

  public async readUnitConversion(
    db: DbHandle,
    conversionId: string
  ): Promise<UnitConversionRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<UnitConversionSql>(
      db,
      `SELECT ${UNIT_CONVERSION_COLUMNS} ${UNIT_CONVERSION_FROM}
        WHERE c.tenant_id = $1 AND c.id = $2`,
      [context.principal.tenantId, conversionId]
    );
    return row ? toUnitConversion(row) : null;
  }

  /** `inv.set_item_unit_conversion` — retires the live row of the signature, then states the new one. */
  public async setUnitConversion(
    db: DbHandle,
    input: {
      readonly itemId: string | null;
      readonly fromUomId: string;
      readonly toUomId: string;
      readonly factor: string;
      readonly sourceReference: string;
    }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.set_item_unit_conversion($1, $2, $3, $4::numeric, $5) AS id`,
      [input.itemId, input.fromUomId, input.toUomId, input.factor, input.sourceReference]
    );
    if (!row) throw new Error('inventory: inv.set_item_unit_conversion returned no row');
    return row.id;
  }

  public async retireUnitConversion(db: DbHandle, conversionId: string): Promise<void> {
    await this.run(db, `SELECT inv.retire_item_unit_conversion($1)`, [conversionId]);
  }

  // -------------------------------------------------------------------------
  // P1-32 preparatory slice 3b — vehicle service specifications (P1-32-PRE-126).
  // -------------------------------------------------------------------------

  public async listVehicleSpecifications(
    db: DbHandle,
    filter: {
      readonly makeId?: string | undefined;
      readonly modelId?: string | undefined;
      readonly serviceCondition?: string | undefined;
      readonly status?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<VehicleSpecificationRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.makeId ?? null,
      filter.modelId ?? null,
      filter.serviceCondition ?? null,
      filter.status ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 's.created_at', id: 's.id' },
      VEHICLE_SPECIFICATION_ORDER,
      values.length + 1
    );
    const result = await this.run<VehicleSpecificationSql & { sort_value: string }>(
      db,
      `SELECT ${VEHICLE_SPECIFICATION_COLUMNS}, ${cursorTimestamp('s.created_at')} AS sort_value
         FROM inv.vehicle_fluid_specifications s
         JOIN inv.units_of_measure u ON u.id = s.uom_id
        WHERE s.tenant_id = $1
          AND ($2::uuid IS NULL OR s.make_id = $2)
          AND ($3::uuid IS NULL OR s.model_id = $3)
          AND ($4::text IS NULL OR s.service_condition = $4)
          AND ($5::text IS NULL OR s.status = $5)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: toVehicleSpecification(row),
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      VEHICLE_SPECIFICATION_ORDER
    );
  }

  public async readVehicleSpecification(
    db: DbHandle,
    specificationId: string
  ): Promise<VehicleSpecificationRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<VehicleSpecificationSql>(
      db,
      `SELECT ${VEHICLE_SPECIFICATION_COLUMNS}
         FROM inv.vehicle_fluid_specifications s
         JOIN inv.units_of_measure u ON u.id = s.uom_id
        WHERE s.tenant_id = $1 AND s.id = $2`,
      [context.principal.tenantId, specificationId]
    );
    return row ? toVehicleSpecification(row) : null;
  }

  public async recordVehicleSpecification(
    db: DbHandle,
    input: {
      readonly makeId: string;
      readonly modelId: string | null;
      readonly modelYearFrom: number | null;
      readonly modelYearTo: number | null;
      readonly engineVariant: string | null;
      readonly serviceCondition: string;
      readonly itemCategoryId: string | null;
      readonly capacity: string;
      readonly uomId: string;
      readonly sourceReference: string;
    }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.record_vehicle_fluid_specification(
                $1, $2, $3::integer, $4::integer, $5, $6, $7, $8::numeric, $9, $10) AS id`,
      [
        input.makeId,
        input.modelId,
        input.modelYearFrom,
        input.modelYearTo,
        input.engineVariant,
        input.serviceCondition,
        input.itemCategoryId,
        input.capacity,
        input.uomId,
        input.sourceReference,
      ]
    );
    if (!row) throw new Error('inventory: inv.record_vehicle_fluid_specification returned no row');
    return row.id;
  }

  public async confirmVehicleSpecification(db: DbHandle, specificationId: string): Promise<void> {
    await this.run(db, `SELECT inv.confirm_vehicle_fluid_specification($1)`, [specificationId]);
  }

  public async retireVehicleSpecification(db: DbHandle, specificationId: string): Promise<void> {
    await this.run(db, `SELECT inv.retire_vehicle_fluid_specification($1)`, [specificationId]);
  }

  // -------------------------------------------------------------------------
  // P1-32 preparatory slice 3b — material requirements (P1-32-PRE-127…129).
  // -------------------------------------------------------------------------

  /** The company, branch and work order a service line belongs to, as the caller sees it. */
  public async readServiceLineScope(
    db: DbHandle,
    serviceLineId: string
  ): Promise<{ companyId: string; branchId: string; workOrderId: string } | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ company_id: string; branch_id: string; work_order_id: string }>(
      db,
      `SELECT l.company_id, l.branch_id, l.work_order_id
         FROM wo.work_order_service_lines l
        WHERE l.tenant_id = $1 AND l.id = $2 AND l.deleted_at IS NULL`,
      [context.principal.tenantId, serviceLineId]
    );
    return row
      ? { companyId: row.company_id, branchId: row.branch_id, workOrderId: row.work_order_id }
      : null;
  }

  /** `inv.propose_material_requirement` — an ENTERED allowance with its source. */
  public async proposeMaterialRequirement(
    db: DbHandle,
    input: {
      readonly serviceLineId: string;
      readonly itemId: string | null;
      readonly itemCategoryId: string | null;
      readonly allowanceQuantity: string;
      readonly uomId: string;
      readonly sourceReference: string;
    }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.propose_material_requirement($1, $2, $3, $4::numeric, $5, $6) AS id`,
      [
        input.serviceLineId,
        input.itemId,
        input.itemCategoryId,
        input.allowanceQuantity,
        input.uomId,
        input.sourceReference,
      ]
    );
    if (!row) throw new Error('inventory: inv.propose_material_requirement returned no row');
    return row.id;
  }

  /**
   * `inv.derive_material_requirement` — the allowance a confirmed specification
   * states, or none. The function is the single path, for every vehicle: one with no
   * make resolves no specification and is stored as `approval_required` /
   * `missing_specification` with no allowance (`20260917099000` fixed the function,
   * which used to fail for exactly that vehicle).
   */
  public async deriveMaterialRequirement(
    db: DbHandle,
    input: {
      readonly serviceLineId: string;
      readonly itemId: string | null;
      readonly itemCategoryId: string | null;
      readonly serviceCondition: string;
      readonly engineVariant: string | null;
    }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.derive_material_requirement($1, $2, $3, $4, $5) AS id`,
      [
        input.serviceLineId,
        input.itemId,
        input.itemCategoryId,
        input.serviceCondition,
        input.engineVariant,
      ]
    );
    if (!row) throw new Error('inventory: inv.derive_material_requirement returned no row');
    return row.id;
  }

  public async readMaterialRequirement(
    db: DbHandle,
    requirementId: string
  ): Promise<MaterialRequirementRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<MaterialRequirementSql>(
      db,
      `SELECT ${MATERIAL_REQUIREMENT_COLUMNS} ${MATERIAL_REQUIREMENT_FROM}
        WHERE r.tenant_id = $1 AND r.id = $2`,
      [context.principal.tenantId, requirementId]
    );
    return row ? toMaterialRequirement(row) : null;
  }

  public async listMaterialRequirements(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly workOrderId?: string | undefined;
      readonly status?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<MaterialRequirementRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.workOrderId ?? null,
      filter.status ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'r.created_at', id: 'r.id' },
      MATERIAL_REQUIREMENT_ORDER,
      values.length + 1
    );
    const result = await this.run<MaterialRequirementSql & { sort_value: string }>(
      db,
      `SELECT ${MATERIAL_REQUIREMENT_COLUMNS}, ${cursorTimestamp('r.created_at')} AS sort_value
         ${MATERIAL_REQUIREMENT_FROM}
        WHERE r.tenant_id = $1 AND r.company_id = $2 AND r.branch_id = $3
          AND ($4::uuid IS NULL OR r.work_order_id = $4)
          AND ($5::text IS NULL OR r.status = $5)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: toMaterialRequirement(row),
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      MATERIAL_REQUIREMENT_ORDER
    );
  }

  public async approveMaterialRequirement(db: DbHandle, requirementId: string): Promise<void> {
    await this.run(db, `SELECT inv.approve_material_requirement($1)`, [requirementId]);
  }

  public async rejectMaterialRequirement(
    db: DbHandle,
    requirementId: string,
    reason: string
  ): Promise<void> {
    await this.run(db, `SELECT inv.reject_material_requirement($1, $2)`, [requirementId, reason]);
  }

  public async listMaterialExceptions(
    db: DbHandle,
    requirementId: string
  ): Promise<readonly MaterialExceptionRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<MaterialExceptionSql>(
      db,
      `SELECT ${MATERIAL_EXCEPTION_COLUMNS}
         FROM inv.material_requirement_exceptions e
        WHERE e.tenant_id = $1 AND e.requirement_id = $2
        ORDER BY e.created_at, e.id`,
      [context.principal.tenantId, requirementId]
    );
    return result.rows.map(toMaterialException);
  }

  public async readMaterialException(
    db: DbHandle,
    exceptionId: string
  ): Promise<MaterialExceptionRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<MaterialExceptionSql>(
      db,
      `SELECT ${MATERIAL_EXCEPTION_COLUMNS}
         FROM inv.material_requirement_exceptions e
        WHERE e.tenant_id = $1 AND e.id = $2`,
      [context.principal.tenantId, exceptionId]
    );
    return row ? toMaterialException(row) : null;
  }

  public async requestMaterialException(
    db: DbHandle,
    input: {
      readonly requirementId: string;
      readonly additionalQuantity: string;
      readonly reason: string;
    }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.request_material_exception($1, $2::numeric, $3) AS id`,
      [input.requirementId, input.additionalQuantity, input.reason]
    );
    if (!row) throw new Error('inventory: inv.request_material_exception returned no row');
    return row.id;
  }

  public async decideMaterialException(
    db: DbHandle,
    input: { readonly exceptionId: string; readonly approve: boolean; readonly note: string | null }
  ): Promise<void> {
    await this.run(db, `SELECT inv.decide_material_exception($1, $2, $3)`, [
      input.exceptionId,
      input.approve,
      input.note,
    ]);
  }

  /**
   * The requirements on a work order that cover an item, by the item itself or by
   * its family, in ANY state. A rejected or cancelled requirement still governs: the
   * absence of an approval is a refusal, never a return to an unlimited draw.
   */
  public async findCoveringMaterialRequirements(
    db: DbHandle,
    workOrderId: string,
    itemId: string
  ): Promise<readonly string[]> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT r.id
         FROM inv.material_requirements r
         JOIN inv.item_master i ON i.tenant_id = r.tenant_id AND i.id = $3
        WHERE r.tenant_id = $1 AND r.work_order_id = $2
          AND (r.item_id = i.id OR r.item_category_id = i.item_category_id)
        ORDER BY r.created_at, r.id`,
      [context.principal.tenantId, workOrderId, itemId]
    );
    return result.rows.map((row) => row.id);
  }

  /**
   * Locks the requirement, then reads what a draw of `quantity` of `itemId` would
   * do to it — in the lock order every material writer uses (requirement first).
   */
  public async checkMaterialDraw(
    db: DbHandle,
    input: { readonly requirementId: string; readonly itemId: string; readonly quantity: string }
  ): Promise<MaterialDrawCheckRow | null> {
    const context = this.assertContext(db);
    const locked = await this.runOne<{ id: string }>(
      db,
      `SELECT id FROM inv.material_requirements WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [context.principal.tenantId, input.requirementId]
    );
    if (!locked) return null;
    const row = await this.runOne<{
      status: string;
      approval_required_reason: string | null;
      work_order_id: string;
      covers_item: boolean;
      has_factor: boolean;
      allowance: string | null;
      committed: string | null;
      requested: string | null;
      exceeds: boolean;
      unit: string | null;
    }>(
      db,
      `SELECT r.status, r.approval_required_reason, r.work_order_id,
              (COALESCE(r.item_id = i.id, false)
                OR COALESCE(r.item_category_id = i.item_category_id, false)) AS covers_item,
              f.factor IS NOT NULL AS has_factor,
              ${exactQuantityText('u.effective_allowance')} AS allowance,
              ${exactQuantityText('u.committed_quantity')} AS committed,
              ${exactQuantityText('$3::numeric * f.factor')} AS requested,
              COALESCE(u.committed_quantity + $3::numeric * f.factor > u.effective_allowance, false)
                AS exceeds,
              ru.code AS unit
         FROM inv.material_requirements r
         JOIN inv.item_master i ON i.tenant_id = r.tenant_id AND i.id = $4
         LEFT JOIN inv.units_of_measure ru ON ru.id = r.uom_id
        CROSS JOIN LATERAL (
              SELECT inv.unit_conversion_factor(r.tenant_id, i.id, i.uom_id, r.uom_id) AS factor) f
         LEFT JOIN LATERAL inv.material_requirement_usage(r.tenant_id, r.id) u ON true
        WHERE r.tenant_id = $1 AND r.id = $2`,
      [context.principal.tenantId, input.requirementId, input.quantity, input.itemId]
    );
    return row
      ? {
          status: row.status,
          approvalRequiredReason: row.approval_required_reason,
          workOrderId: row.work_order_id,
          coversItem: row.covers_item,
          hasFactor: row.has_factor,
          allowance: row.allowance,
          committed: row.committed ?? '0.000',
          requested: row.requested,
          exceeds: row.exceeds,
          unit: row.unit,
        }
      : null;
  }

  /** `inv.create_material_request` — bounded by the ceiling guard under the requirement lock. */
  public async createMaterialRequest(
    db: DbHandle,
    input: { readonly requirementId: string; readonly itemId: string; readonly quantity: string }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.create_material_request($1, $2, $3::numeric, NULL, $4) AS id`,
      [input.requirementId, input.itemId, input.quantity, db.context.correlationId]
    );
    if (!row) throw new Error('inventory: inv.create_material_request returned no row');
    return row.id;
  }

  /**
   * `inv.recheck_material_requirement` — moves an `approval_required` requirement on
   * once the fact it was missing exists, and returns the status that resulted.
   */
  public async recheckMaterialRequirement(db: DbHandle, requirementId: string): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ status: string }>(
      db,
      `SELECT inv.recheck_material_requirement($1) AS status`,
      [requirementId]
    );
    if (!row) throw new Error('inventory: inv.recheck_material_requirement returned no row');
    return row.status;
  }

  /**
   * `inv.cancel_material_requirement` — refused while the requirement has an open
   * request or any committed quantity.
   */
  public async cancelMaterialRequirement(
    db: DbHandle,
    requirementId: string,
    reason: string
  ): Promise<void> {
    await this.run(db, `SELECT inv.cancel_material_requirement($1, $2)`, [requirementId, reason]);
  }

  public async readMaterialRequest(
    db: DbHandle,
    requestId: string
  ): Promise<MaterialRequestRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      branch_id: string;
      requirement_id: string;
      work_order_id: string;
      item_id: string;
      quantity: string;
      requirement_unit_factor: string;
      status: string;
      requested_by: string;
      closed_by: string | null;
      closed_at: Date | null;
      close_reason: string | null;
      cancelled_by: string | null;
      cancelled_at: Date | null;
      cancel_reason: string | null;
      record_version: number;
      created_at: Date;
    }>(
      db,
      `SELECT q.id, q.company_id, q.branch_id, q.requirement_id, q.work_order_id, q.item_id,
              q.quantity::text AS quantity, q.requirement_unit_factor::text AS requirement_unit_factor,
              q.status, q.requested_by, q.closed_by, q.closed_at, q.close_reason, q.cancelled_by,
              q.cancelled_at, q.cancel_reason, q.record_version, q.created_at
         FROM inv.material_requests q
        WHERE q.tenant_id = $1 AND q.id = $2`,
      [context.principal.tenantId, requestId]
    );
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          branchId: row.branch_id,
          requirementId: row.requirement_id,
          workOrderId: row.work_order_id,
          itemId: row.item_id,
          quantity: row.quantity,
          requirementUnitFactor: row.requirement_unit_factor,
          status: row.status,
          requestedBy: row.requested_by,
          closedBy: row.closed_by,
          closedAt: row.closed_at,
          closeReason: row.close_reason,
          cancelledBy: row.cancelled_by,
          cancelledAt: row.cancelled_at,
          cancelReason: row.cancel_reason,
          recordVersion: row.record_version,
          createdAt: row.created_at,
        }
      : null;
  }

  /** The active reservations fulfilling a request: what finishing it will release. */
  public async activeReservationsOfRequest(
    db: DbHandle,
    requestId: string
  ): Promise<readonly ReservationRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT sr.id
         FROM inv.material_request_fulfillments f
         JOIN inv.stock_reservations sr ON sr.tenant_id = f.tenant_id AND sr.id = f.reservation_id
        WHERE f.tenant_id = $1 AND f.material_request_id = $2 AND sr.status = 'active'
        ORDER BY sr.item_id, sr.location_id, sr.id`,
      [context.principal.tenantId, requestId]
    );
    const rows: ReservationRow[] = [];
    for (const { id } of result.rows) {
      const reservation = await this.readReservation(db, id);
      if (reservation) rows.push(reservation);
    }
    return rows;
  }

  /** `inv.finish_material_request` — releases the request's active reservations explicitly. */
  public async finishMaterialRequest(
    db: DbHandle,
    input: {
      readonly requestId: string;
      readonly outcome: 'closed' | 'cancelled';
      readonly reason: string | null;
    }
  ): Promise<void> {
    await this.run(db, `SELECT inv.finish_material_request($1, $2, $3)`, [
      input.requestId,
      input.outcome,
      input.reason,
    ]);
  }

  public async readMaterialLinkForReservation(
    db: DbHandle,
    reservationId: string
  ): Promise<MaterialReservationLinkRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      request_id: string;
      requirement_id: string;
      status: string;
      has_issue: boolean;
    }>(
      db,
      `SELECT q.id AS request_id, q.requirement_id, q.status,
              EXISTS (SELECT 1 FROM inv.material_request_fulfillments fi
                       WHERE fi.tenant_id = q.tenant_id AND fi.material_request_id = q.id
                         AND fi.fulfillment_kind = 'issue') AS has_issue
         FROM inv.material_request_fulfillments f
         JOIN inv.material_requests q ON q.tenant_id = f.tenant_id AND q.id = f.material_request_id
        WHERE f.tenant_id = $1 AND f.reservation_id = $2`,
      [context.principal.tenantId, reservationId]
    );
    return row
      ? {
          requestId: row.request_id,
          requirementId: row.requirement_id,
          requestStatus: row.status,
          hasIssue: row.has_issue,
        }
      : null;
  }

  // -------------------------------------------------------------------------
  // P1-32 preparatory slice 3b — transfer settlements (P1-32-PRE-130).
  // -------------------------------------------------------------------------

  public async readTransferSettlement(
    db: DbHandle,
    settlementId: string
  ): Promise<TransferSettlementRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<TransferSettlementSql>(
      db,
      `SELECT ${TRANSFER_SETTLEMENT_COLUMNS}
         FROM inv.stock_transfer_settlements s
        WHERE s.tenant_id = $1 AND s.id = $2`,
      [context.principal.tenantId, settlementId]
    );
    return row ? toTransferSettlement(row) : null;
  }

  /**
   * One settlement with its transfer's item. Visible to a reader of either branch
   * through `sel_stock_transfer_settlements_scope` or `..._destination`; the service
   * decides which of the two branches authorizes the read.
   */
  public async readTransferSettlementDetail(
    db: DbHandle,
    settlementId: string
  ): Promise<TransferSettlementListRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<TransferSettlementSql & { item_id: string; sku: string }>(
      db,
      `SELECT ${TRANSFER_SETTLEMENT_COLUMNS}, t.item_id, i.sku
         FROM inv.stock_transfer_settlements s
         JOIN inv.stock_transfers t ON t.tenant_id = s.tenant_id AND t.id = s.transfer_id
         JOIN inv.item_master i ON i.tenant_id = t.tenant_id AND i.id = t.item_id
        WHERE s.tenant_id = $1 AND s.id = $2`,
      [context.principal.tenantId, settlementId]
    );
    return row ? { ...toTransferSettlement(row), itemId: row.item_id, sku: row.sku } : null;
  }

  /**
   * One branch's discrepancy settlements — returns to the origin and write-offs —
   * whether the branch sent the transfer or is its destination, newest first.
   *
   * A `receipt` settlement is not listed: it is the receipt of what arrived, already
   * visible on the transfer, and nobody decides it. The branch predicate is explicit,
   * for the reason `listTransfers` records: `app.branch_ids` is the permission-blind
   * union of every active grant.
   *
   * The decision filter reads the stored columns: `pending` and `rejected` are the
   * status, `approved` is a write-off posted with `approved_at` stamped. A return to
   * the origin posts at once and is never decided, so it matches none of the three.
   */
  public async listTransferSettlements(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly decision?: TransferSettlementDecisionFilter | undefined;
      readonly kind?: string | undefined;
      readonly transferId?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<TransferSettlementListRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.decision ?? null,
      filter.kind ?? null,
      filter.transferId ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 's.created_at', id: 's.id' },
      TRANSFER_SETTLEMENT_ORDER,
      values.length + 1
    );
    const result = await this.run<
      TransferSettlementSql & { item_id: string; sku: string; sort_value: string }
    >(
      db,
      `SELECT ${TRANSFER_SETTLEMENT_COLUMNS}, t.item_id, i.sku,
              ${cursorTimestamp('s.created_at')} AS sort_value
         FROM inv.stock_transfer_settlements s
         JOIN inv.stock_transfers t ON t.tenant_id = s.tenant_id AND t.id = s.transfer_id
         JOIN inv.item_master i ON i.tenant_id = t.tenant_id AND i.id = t.item_id
        WHERE s.tenant_id = $1 AND s.company_id = $2
          AND (s.branch_id = $3 OR s.to_branch_id = $3)
          AND s.settlement_kind IN ('return_to_origin', 'write_off')
          AND ($4::text IS NULL
               OR ($4 = 'pending' AND s.status = 'pending')
               OR ($4 = 'rejected' AND s.status = 'rejected')
               OR ($4 = 'approved' AND s.status = 'posted' AND s.approved_at IS NOT NULL))
          AND ($5::text IS NULL OR s.settlement_kind = $5)
          AND ($6::uuid IS NULL OR s.transfer_id = $6)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: { ...toTransferSettlement(row), itemId: row.item_id, sku: row.sku },
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      TRANSFER_SETTLEMENT_ORDER
    );
  }

  public async readTransferSettlementByIdempotencyKey(
    db: DbHandle,
    key: string
  ): Promise<TransferSettlementRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<TransferSettlementSql>(
      db,
      `SELECT ${TRANSFER_SETTLEMENT_COLUMNS}
         FROM inv.stock_transfer_settlements s
        WHERE s.tenant_id = $1 AND s.idempotency_key = $2`,
      [context.principal.tenantId, key]
    );
    return row ? toTransferSettlement(row) : null;
  }

  /**
   * The receipt settlement `inv.receive_transfer` wrote in THIS transaction, when
   * the receipt was a part settlement. `created_at` defaults to `now()`, which is the
   * transaction's start time, so a row of an earlier receipt can never match.
   */
  public async readReceiptSettlementOfThisTransaction(
    db: DbHandle,
    transferId: string
  ): Promise<TransferSettlementRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<TransferSettlementSql>(
      db,
      `SELECT ${TRANSFER_SETTLEMENT_COLUMNS}
         FROM inv.stock_transfer_settlements s
        WHERE s.tenant_id = $1 AND s.transfer_id = $2 AND s.settlement_kind = 'receipt'
          AND s.created_at = now()
        ORDER BY s.id
        LIMIT 1`,
      [context.principal.tenantId, transferId]
    );
    return row ? toTransferSettlement(row) : null;
  }

  public async returnTransferRemainder(
    db: DbHandle,
    input: {
      readonly transferId: string;
      readonly quantity: string;
      readonly reason: string;
      readonly idempotencyKey: string | null;
    }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.return_transfer_remainder($1, $2::numeric, $3, $4, $5) AS id`,
      [
        input.transferId,
        input.quantity,
        input.reason,
        input.idempotencyKey,
        db.context.correlationId,
      ]
    );
    if (!row) throw new Error('inventory: inv.return_transfer_remainder returned no row');
    return row.id;
  }

  public async requestTransferWriteOff(
    db: DbHandle,
    input: {
      readonly transferId: string;
      readonly quantity: string;
      readonly reason: string;
      readonly idempotencyKey: string | null;
    }
  ): Promise<string> {
    this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `SELECT inv.request_transfer_write_off($1, $2::numeric, $3, $4, $5) AS id`,
      [
        input.transferId,
        input.quantity,
        input.reason,
        input.idempotencyKey,
        db.context.correlationId,
      ]
    );
    if (!row) throw new Error('inventory: inv.request_transfer_write_off returned no row');
    return row.id;
  }

  public async decideTransferWriteOff(
    db: DbHandle,
    settlementId: string,
    approve: boolean
  ): Promise<void> {
    await this.run(db, `SELECT inv.decide_transfer_write_off($1, $2)`, [settlementId, approve]);
  }

  // -------------------------------------------------------------------------
  // Operational alerts (Owner directive).
  //
  // `readAsOf` is taken from the DATABASE, inside the request's transaction, and
  // published with every alert. A clock read in this process is a different
  // instant from the one the rows were selected at, and an alert whose freshness
  // stamp does not belong to its own snapshot is worse than none: it invites a
  // reader to trust a figure that was already stale when it was rendered.
  // -------------------------------------------------------------------------

  public async readAsOf(db: DbHandle): Promise<Date> {
    const row = await this.runOne<{ as_of: Date }>(db, `SELECT now() AS as_of`);
    if (!row) throw new Error('inventory: now() returned no row');
    return row.as_of;
  }

  /** Reads one reorder level by id, or null when it is absent or invisible. */
  public async readReorderLevel(db: DbHandle, levelId: string): Promise<ReorderLevelRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ReorderLevelSqlRow>(
      db,
      `${REORDER_LEVEL_COLUMNS}
         FROM inv.item_reorder_levels r
         JOIN inv.item_master i ON i.tenant_id = r.tenant_id AND i.id = r.item_id
         LEFT JOIN inv.stock_locations l ON l.tenant_id = r.tenant_id AND l.id = r.location_id
        WHERE r.tenant_id = $1 AND r.id = $2`,
      [context.principal.tenantId, levelId]
    );
    return row === null ? null : toReorderLevel(row);
  }

  /**
   * The configured levels, most-specific narrowing NOT applied.
   *
   * This is the CONFIGURATION list, so it shows every row rather than the winner:
   * an operator editing levels has to be able to see the company-wide row that a
   * branch row is currently overriding, or they cannot understand why changing it
   * had no effect. Resolution happens in the low-stock read, which is the place
   * that has to pick one.
   */
  public async listReorderLevels(
    db: DbHandle,
    filter: {
      readonly itemId?: string | undefined;
      readonly companyId?: string | undefined;
      readonly branchId?: string | undefined;
      readonly includeRetired?: boolean | undefined;
    },
    request: PageRequest
  ): Promise<Page<ReorderLevelRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.itemId ?? null,
      filter.companyId ?? null,
      filter.branchId ?? null,
      filter.includeRetired === true,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'i.sku', id: 'r.id' },
      REORDER_LEVEL_ORDER,
      values.length + 1
    );
    const result = await this.run<ReorderLevelSqlRow & { sort_value: string }>(
      db,
      `${REORDER_LEVEL_COLUMNS}, i.sku AS sort_value
         FROM inv.item_reorder_levels r
         JOIN inv.item_master i ON i.tenant_id = r.tenant_id AND i.id = r.item_id
         LEFT JOIN inv.stock_locations l ON l.tenant_id = r.tenant_id AND l.id = r.location_id
        WHERE r.tenant_id = $1
          AND ($2::uuid IS NULL OR r.item_id = $2)
          -- A company or branch filter asks "what applies HERE", so the wider
          -- rows that also apply here are included rather than hidden.
          AND ($3::uuid IS NULL OR r.company_id IS NULL OR r.company_id = $3)
          AND ($4::uuid IS NULL OR r.branch_id IS NULL OR r.branch_id = $4)
          AND ($5::boolean OR r.status = 'active')
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: toReorderLevel(row),
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      REORDER_LEVEL_ORDER
    );
  }

  /** The live level holding one signature, or null. Used to decide set vs insert. */
  public async findActiveReorderLevel(
    db: DbHandle,
    signature: ReorderLevelSignature
  ): Promise<ReorderLevelRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<ReorderLevelSqlRow>(
      db,
      `${REORDER_LEVEL_COLUMNS}
         FROM inv.item_reorder_levels r
         JOIN inv.item_master i ON i.tenant_id = r.tenant_id AND i.id = r.item_id
         LEFT JOIN inv.stock_locations l ON l.tenant_id = r.tenant_id AND l.id = r.location_id
        WHERE r.tenant_id = $1 AND r.status = 'active' AND r.item_id = $2
          AND r.company_id IS NOT DISTINCT FROM $3::uuid
          AND r.branch_id IS NOT DISTINCT FROM $4::uuid
          AND r.location_id IS NOT DISTINCT FROM $5::uuid`,
      [
        context.principal.tenantId,
        signature.itemId,
        signature.companyId,
        signature.branchId,
        signature.locationId,
      ]
    );
    return row === null ? null : toReorderLevel(row);
  }

  public async insertReorderLevel(
    db: DbHandle,
    signature: ReorderLevelSignature,
    quantities: { readonly reorderLevelQty: string; readonly preferredOrderQty: string | null }
  ): Promise<string> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO inv.item_reorder_levels
         (tenant_id, item_id, company_id, branch_id, location_id,
          reorder_level_qty, preferred_order_qty, created_by)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, $6::numeric, $7::numeric, $8)
       RETURNING id`,
      [
        context.principal.tenantId,
        signature.itemId,
        signature.companyId,
        signature.branchId,
        signature.locationId,
        quantities.reorderLevelQty,
        quantities.preferredOrderQty,
        context.principal.userId,
      ]
    );
    if (!row) throw new Error('inventory: reorder level insert returned no row');
    return row.id;
  }

  /**
   * Revises the quantities on a live level. Returns null when the expected version
   * does not match, which the caller turns into the shared stale-version refusal.
   */
  public async reviseReorderLevel(
    db: DbHandle,
    levelId: string,
    quantities: { readonly reorderLevelQty: string; readonly preferredOrderQty: string | null },
    expectedVersion: number
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `UPDATE inv.item_reorder_levels
          SET reorder_level_qty = $3::numeric,
              preferred_order_qty = $4::numeric,
              record_version = record_version + 1,
              updated_by = $5
        WHERE tenant_id = $1 AND id = $2 AND status = 'active' AND record_version = $6
        RETURNING id`,
      [
        context.principal.tenantId,
        levelId,
        quantities.reorderLevelQty,
        quantities.preferredOrderQty,
        context.principal.userId,
        expectedVersion,
      ]
    );
    return row?.id ?? null;
  }

  /** Retires a live level. Returns null when it is already retired or stale. */
  public async retireReorderLevel(
    db: DbHandle,
    levelId: string,
    expectedVersion: number
  ): Promise<string | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ id: string }>(
      db,
      `UPDATE inv.item_reorder_levels
          SET status = 'retired',
              retired_at = now(),
              retired_by = $3,
              record_version = record_version + 1,
              updated_by = $3
        WHERE tenant_id = $1 AND id = $2 AND status = 'active' AND record_version = $4
        RETURNING id`,
      [context.principal.tenantId, levelId, context.principal.userId, expectedVersion]
    );
    return row?.id ?? null;
  }

  /**
   * Items at or below the level that applies to them, in one branch.
   *
   * Three properties are structural rather than intended:
   *
   *  - the query STARTS from `inv.item_reorder_levels`, so an item with no level
   *    cannot appear however low it is. "Low" is only a fact once somebody has
   *    said what low means for that item;
   *  - the comparison is on `available_qty`, which is the GENERATED column
   *    `on_hand_qty - reserved_qty`. It is never re-derived here, so the alert and
   *    the availability read cannot disagree;
   *  - QUARANTINE and TRANSIT cells are excluded from the branch total. Damaged
   *    stock and stock that has left one branch and not reached another are not
   *    available to anybody, so counting them would answer the alert with units
   *    nobody can fit.
   *
   * A level naming a location is compared against that one cell; a level naming
   * none is compared against the branch's whole sellable holding. When two levels
   * could apply to the same target, the narrower one wins: branch over company
   * over tenant-wide.
   */
  public async listLowStock(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<LowStockRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.itemId ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'i.sku', id: 'a.id' },
      LOW_STOCK_ORDER,
      values.length + 1
    );
    const result = await this.run<LowStockSqlRow & { sort_value: string }>(
      db,
      `${LOW_STOCK_SELECTION}
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          reorderLevelId: row.id,
          itemId: row.item_id,
          sku: row.sku,
          itemName: row.item_name,
          companyId: filter.companyId,
          branchId: filter.branchId,
          scope: row.scope,
          locationId: row.location_id,
          locationCode: row.location_code,
          onHandQty: row.on_hand_qty,
          reservedQty: row.reserved_qty,
          availableQty: row.available_qty,
          reorderLevelQty: row.reorder_level_qty,
          shortfallQty: row.shortfall_qty,
          preferredOrderQty: row.preferred_order_qty,
        },
        sortValue: row.sort_value,
        id: row.id,
      })),
      request,
      LOW_STOCK_ORDER
    );
  }

  /**
   * WHICH ITEMS are low in one branch (Owner directive — the dashboard).
   *
   * The same selection the alert pages, projected to distinct item ids instead
   * of windowed, so the definition of "low" behind the dashboard figure and the
   * list behind the alert is one piece of text in this file.
   *
   * ## Item IDS and not a count, and that is the whole point of the shape
   *
   * The alert's unit is a FINDING — one row per applicable reorder level per
   * branch — so one item can raise several: a branch-wide level and a level on
   * each of two shelves are three rows about one part, and the same part low in
   * two branches is two more. A caller that added per-branch counts would
   * therefore publish "5 items low" for a stock-room holding one empty bin.
   * Returning the ids lets the caller take the union across the branches it is
   * reporting on and answer the question a person actually asks, which is how
   * many PARTS are running out.
   *
   * `DISTINCT item_id` already collapses the several-levels-per-item case within
   * one branch; the cross-branch collapse belongs to whoever chose the branch
   * set.
   *
   * No `itemId` parameter. The alert narrows to one item because an operator
   * asks about one; a dashboard figure narrowed to one item would be a number
   * whose meaning depended on a filter nobody can see, so `$4` is bound NULL.
   *
   * ONE branch, matching the alert exactly. The selection resolves level
   * specificity per `(item, location)` against a single `$3`, and widening that
   * to a branch ARRAY would change which level wins for an item that has both a
   * company-wide and a branch-specific one — a change to the RULE rather than to
   * the plumbing. A caller reporting on several branches asks once per branch.
   */
  public async lowStockItemIds(
    db: DbHandle,
    filter: { readonly companyId: string; readonly branchId: string }
  ): Promise<readonly string[]> {
    const context = this.assertContext(db);
    const result = await this.run<{ item_id: string }>(
      db,
      `SELECT DISTINCT item_id FROM (${LOW_STOCK_SELECTION}) low`,
      [context.principal.tenantId, filter.companyId, filter.branchId, null]
    );
    return result.rows.map((row) => row.item_id);
  }

  /**
   * Counted lines whose variance was not zero, on counts that were reconciled.
   *
   * Only RECONCILED counts: an open count's lines are a work in progress, and
   * `variance_qty` on one is the difference between a snapshot and a half-finished
   * tally. `variance_qty` is the GENERATED column, so the figure published here is
   * the same one the adjustment was raised from.
   */
  public async listCountDiscrepancies(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId?: string | undefined;
      readonly locationId?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<CountDiscrepancyRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.itemId ?? null,
      filter.locationId ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'c.reconciled_at', id: 'cl.id' },
      COUNT_DISCREPANCY_ORDER,
      values.length + 1
    );
    const result = await this.run<CountDiscrepancySqlRow & { sort_value: string }>(
      db,
      `SELECT c.id AS count_id, cl.id AS line_id, cl.company_id, cl.branch_id,
              c.location_id, l.location_code,
              cl.item_id, i.sku, i.name AS item_name,
              cl.snapshot_qty, cl.counted_qty, cl.movement_delta_during_count, cl.variance_qty,
              c.reconciled_at, cl.adjustment_id,
              adj.status AS adjustment_status, adj.approved_at AS adjustment_approved_at,
              ${cursorTimestamp('c.reconciled_at')} AS sort_value
         FROM inv.stock_count_lines cl
         JOIN inv.stock_counts c ON c.tenant_id = cl.tenant_id AND c.id = cl.count_id
         JOIN inv.stock_locations l ON l.tenant_id = c.tenant_id AND l.id = c.location_id
         JOIN inv.item_master i ON i.tenant_id = cl.tenant_id AND i.id = cl.item_id
         LEFT JOIN inv.stock_adjustments adj
           ON adj.tenant_id = cl.tenant_id AND adj.id = cl.adjustment_id
        WHERE cl.tenant_id = $1 AND cl.company_id = $2 AND cl.branch_id = $3
          AND c.status = 'reconciled'
          AND cl.variance_qty IS NOT NULL
          AND cl.variance_qty <> 0
          AND ($4::uuid IS NULL OR cl.item_id = $4)
          AND ($5::uuid IS NULL OR c.location_id = $5)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          countId: row.count_id,
          lineId: row.line_id,
          companyId: row.company_id,
          branchId: row.branch_id,
          locationId: row.location_id,
          locationCode: row.location_code,
          itemId: row.item_id,
          sku: row.sku,
          itemName: row.item_name,
          snapshotQty: row.snapshot_qty,
          countedQty: row.counted_qty,
          movementDeltaDuringCount: row.movement_delta_during_count,
          varianceQty: row.variance_qty,
          reconciledAt: row.reconciled_at,
          adjustmentId: row.adjustment_id,
          adjustmentStatus: row.adjustment_status,
          adjustmentApprovedAt: row.adjustment_approved_at,
        },
        sortValue: row.sort_value,
        id: row.line_id,
      })),
      request,
      COUNT_DISCREPANCY_ORDER
    );
  }

  /**
   * Items whose issued quantity broke out of their OWN preceding history.
   *
   * The windows are cut by the database from its own `now()`, so every period the
   * response publishes is the period the arithmetic used. The baseline is
   * `percentile_disc(0.5)` — the lower of the two middle values on an even count —
   * chosen over `percentile_cont` because the continuous form averages two
   * observations into a quantity nobody issued and returns it as a float. There is
   * no weighting of any kind: each baseline window counts once.
   *
   * Every figure the comparison rests on is returned, per item and per window, so
   * the decision can be re-done by hand from the response.
   */
  public async listUnusualConsumption(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly periodDays: number;
      readonly baselinePeriods: number;
      readonly multiple: string;
      readonly minimumQty: string;
      readonly itemId?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<UnusualConsumptionRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.periodDays,
      filter.baselinePeriods,
      filter.multiple,
      filter.minimumQty,
      filter.itemId ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 'im.sku', id: 'o.item_id' },
      UNUSUAL_CONSUMPTION_ORDER,
      values.length + 1
    );
    const result = await this.run<UnusualConsumptionSqlRow & { sort_value: string }>(
      db,
      `WITH windows AS (
         SELECT g.idx,
                now() - make_interval(days => $4::int * (g.idx + 1)) AS win_from,
                now() - make_interval(days => $4::int * g.idx)       AS win_to
           FROM generate_series(0, $5::int) AS g(idx)
       ),
       issued AS (
         SELECT w.idx, m.item_id, sum(m.quantity) AS qty
           FROM windows w
           JOIN inv.stock_movements m
             ON m.tenant_id = $1 AND m.company_id = $2 AND m.branch_id = $3
            AND m.movement_type = 'issue' AND m.direction = 'out'
            AND m.occurred_at >= w.win_from AND m.occurred_at < w.win_to
            AND ($8::uuid IS NULL OR m.item_id = $8)
          GROUP BY w.idx, m.item_id
       ),
       moved_items AS (SELECT DISTINCT item_id FROM issued),
       grid AS (
         SELECT mi.item_id, w.idx, w.win_from, w.win_to, COALESCE(s.qty, 0) AS qty
           FROM moved_items mi
           CROSS JOIN windows w
           LEFT JOIN issued s ON s.item_id = mi.item_id AND s.idx = w.idx
       ),
       observed AS (SELECT item_id, qty, win_from, win_to FROM grid WHERE idx = 0),
       baseline AS (
         SELECT item_id, percentile_disc(0.5) WITHIN GROUP (ORDER BY qty) AS median_qty
           FROM grid WHERE idx > 0 GROUP BY item_id
       ),
       baseline_windows AS (
         SELECT item_id,
                jsonb_agg(jsonb_build_object(
                  'from', ${cursorTimestamp('win_from')},
                  'to',   ${cursorTimestamp('win_to')},
                  'issuedQty', qty::text) ORDER BY idx ASC) AS periods
           FROM grid WHERE idx > 0 GROUP BY item_id
       )
       SELECT o.item_id, im.sku, im.name AS item_name,
              o.qty AS observed_qty, b.median_qty,
              ${cursorTimestamp('o.win_from')} AS observed_from,
              ${cursorTimestamp('o.win_to')}   AS observed_to,
              bw.periods AS baseline_periods,
              im.sku AS sort_value
         FROM observed o
         JOIN baseline b ON b.item_id = o.item_id
         JOIN baseline_windows bw ON bw.item_id = o.item_id
         JOIN inv.item_master im ON im.tenant_id = $1 AND im.id = o.item_id
        WHERE o.qty >= $7::numeric
          AND o.qty >= $6::numeric * b.median_qty
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          itemId: row.item_id,
          sku: row.sku,
          itemName: row.item_name,
          companyId: filter.companyId,
          branchId: filter.branchId,
          observedQty: row.observed_qty,
          baselineMedianQty: row.median_qty,
          observedPeriod: {
            from: row.observed_from,
            to: row.observed_to,
            issuedQty: row.observed_qty,
          },
          baselinePeriods: row.baseline_periods,
        },
        sortValue: row.sort_value,
        id: row.item_id,
      })),
      request,
      UNUSUAL_CONSUMPTION_ORDER
    );
  }

  /**
   * Transfers dispatched more than `minimumAgeDays` ago that have not arrived.
   *
   * Both ends of a transfer are served: the predicate matches the branch as SOURCE
   * or as DESTINATION, because a consignment lost in transit is the receiving
   * branch's problem as much as the sending one's, and the destination already has
   * a SELECT policy for exactly that reason.
   *
   * `outstanding_quantity` is the GENERATED column on `inv.stock_transfers` —
   * dispatched less received less resolved — so the quantity still in transit is
   * the schema's own figure and not arithmetic invented here.
   */
  public async listAgedInTransit(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly minimumAgeDays: number;
      readonly itemId?: string | undefined;
    },
    request: PageRequest
  ): Promise<Page<AgedInTransitRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.minimumAgeDays,
      filter.itemId ?? null,
    ];
    const keyset = keysetFragment(
      request,
      { sort: 't.dispatched_at', id: 't.id' },
      AGED_TRANSIT_ORDER,
      values.length + 1
    );
    const result = await this.run<AgedInTransitSqlRow & { sort_value: string }>(
      db,
      `SELECT t.id AS transfer_id, t.item_id, i.sku, i.name AS item_name, t.status,
              t.company_id, t.branch_id AS from_branch_id,
              t.from_location_id, fl.location_code AS from_location_code,
              t.to_branch_id, t.to_location_id, tl.location_code AS to_location_code,
              t.quantity, t.received_quantity, t.outstanding_quantity, t.dispatched_at,
              floor(extract(epoch FROM (now() - t.dispatched_at)) / 86400)::int AS age_days,
              ${cursorTimestamp('t.dispatched_at')} AS sort_value
         FROM inv.stock_transfers t
         JOIN inv.item_master i ON i.tenant_id = t.tenant_id AND i.id = t.item_id
         JOIN inv.stock_locations fl ON fl.tenant_id = t.tenant_id AND fl.id = t.from_location_id
         JOIN inv.stock_locations tl ON tl.tenant_id = t.tenant_id AND tl.id = t.to_location_id
        WHERE t.tenant_id = $1 AND t.company_id = $2
          AND (t.branch_id = $3 OR t.to_branch_id = $3)
          AND t.status IN ('dispatched', 'partially_received')
          AND t.dispatched_at < now() - make_interval(days => $4::int)
          AND ($5::uuid IS NULL OR t.item_id = $5)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    return buildPageWithCursors(
      result.rows.map((row) => ({
        item: {
          transferId: row.transfer_id,
          itemId: row.item_id,
          sku: row.sku,
          itemName: row.item_name,
          status: row.status,
          companyId: row.company_id,
          fromBranchId: row.from_branch_id,
          fromLocationId: row.from_location_id,
          fromLocationCode: row.from_location_code,
          toBranchId: row.to_branch_id,
          toLocationId: row.to_location_id,
          toLocationCode: row.to_location_code,
          quantity: row.quantity,
          receivedQuantity: row.received_quantity,
          outstandingQuantity: row.outstanding_quantity,
          dispatchedAt: row.dispatched_at,
          ageDays: row.age_days,
        },
        sortValue: row.sort_value,
        id: row.transfer_id,
      })),
      request,
      AGED_TRANSIT_ORDER
    );
  }
}

/** The projection every reorder-level read shares. */
const REORDER_LEVEL_COLUMNS = `SELECT r.id, r.item_id, i.sku, i.name AS item_name,
              r.company_id, r.branch_id, r.location_id, l.location_code,
              r.reorder_level_qty, r.preferred_order_qty, r.status,
              r.retired_at, r.record_version`;

interface ReorderLevelSqlRow {
  id: string;
  item_id: string;
  sku: string;
  item_name: string;
  company_id: string | null;
  branch_id: string | null;
  location_id: string | null;
  location_code: string | null;
  reorder_level_qty: string;
  preferred_order_qty: string | null;
  status: string;
  retired_at: Date | null;
  record_version: number;
}

const toReorderLevel = (r: ReorderLevelSqlRow): ReorderLevelRow => ({
  id: r.id,
  itemId: r.item_id,
  sku: r.sku,
  itemName: r.item_name,
  companyId: r.company_id,
  branchId: r.branch_id,
  locationId: r.location_id,
  locationCode: r.location_code,
  reorderLevelQty: r.reorder_level_qty,
  preferredOrderQty: r.preferred_order_qty,
  status: r.status,
  retiredAt: r.retired_at,
  recordVersion: r.record_version,
});

interface LowStockSqlRow {
  id: string;
  item_id: string;
  sku: string;
  item_name: string;
  scope: string;
  location_id: string | null;
  location_code: string | null;
  on_hand_qty: string;
  reserved_qty: string;
  available_qty: string;
  reorder_level_qty: string;
  shortfall_qty: string;
  preferred_order_qty: string | null;
}

interface CountDiscrepancySqlRow {
  count_id: string;
  line_id: string;
  company_id: string;
  branch_id: string;
  location_id: string;
  location_code: string;
  item_id: string;
  sku: string;
  item_name: string;
  snapshot_qty: string;
  counted_qty: string | null;
  movement_delta_during_count: string;
  variance_qty: string;
  reconciled_at: Date;
  adjustment_id: string | null;
  adjustment_status: string | null;
  adjustment_approved_at: Date | null;
}

interface UnusualConsumptionSqlRow {
  item_id: string;
  sku: string;
  item_name: string;
  observed_qty: string;
  median_qty: string;
  observed_from: string;
  observed_to: string;
  baseline_periods: ConsumptionPeriodRow[];
}

interface AgedInTransitSqlRow {
  transfer_id: string;
  item_id: string;
  sku: string;
  item_name: string;
  status: string;
  company_id: string;
  from_branch_id: string;
  from_location_id: string;
  from_location_code: string;
  to_branch_id: string;
  to_location_id: string;
  to_location_code: string;
  quantity: string;
  received_quantity: string | null;
  outstanding_quantity: string;
  dispatched_at: Date;
  age_days: number;
}
