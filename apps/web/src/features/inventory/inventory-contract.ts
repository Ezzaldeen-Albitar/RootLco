/**
 * The inventory contract this phase consumes (P1-30, `W4`, FE-008 item search,
 * FE-009 stock balance, FE-010 reservations; `W5`, FE-011 issues, FE-012
 * returns, FE-013 stock movements).
 *
 * | operation                          | method | path                                        | permission          |
 * | ---------------------------------- | ------ | ------------------------------------------- | ------------------- |
 * | `inv.item-search`                  | GET    | `/items`                                    | `inv.item.read`     |
 * | `inv.stock-availability-read`      | GET    | `/stock-availability`                       | `inv.stock.read`    |
 * | `inv.stock-reservation-list`       | GET    | `/stock-reservations`                       | `inv.stock.read`    |
 * | `inv.stock-location-list`          | GET    | `/stock-locations`                          | `inv.stock.read`    |
 * | `org.branch-list`                  | GET    | `/org/branches`                             | `org.branch.read`   |
 * | `inv.stock-reservation-create`     | POST   | `/stock-reservations`                       | `inv.stock.operate` |
 * | `inv.stock-reservation-release`    | POST   | `/stock-reservations/{reservationId}/release` | `inv.stock.operate` |
 * | `inv.work-order-part-issue-list`   | GET    | `/work-orders/{workOrderId}/part-issues`    | `inv.stock.read`    |
 * | `wo.required-part-list`            | GET    | `/work-orders/{workOrderId}/required-parts` | `wo.work_order.read`|
 * | `inv.stock-movement-list`          | GET    | `/stock-movements`                          | `inv.stock.read`    |
 * | `inv.stock-issue-create`           | POST   | `/stock-issues`                             | `inv.stock.operate` |
 * | `inv.stock-return-create`          | POST   | `/stock-returns`                            | `inv.stock.operate` |
 *
 * Typed from the routes that own the shapes and from the views in
 * `apps/api/src/modules/inventory/application/*`. The published document
 * carries no field schema for any inventory response, so these interfaces are
 * the only field-level contract. The backend proofs
 * (`tests/backend/p1-30-w4-inventory.test.ts`, `p1-30-w5-parts-movements.test.ts`)
 * hold rows that came out of the database against the fields these views
 * publish, with local row types and literal expected strings; they do not
 * parse this file, so a field renamed here is caught by the type checker and
 * the DOM tests, not by them.
 *
 * ## Every quantity is a decimal string, and none is computed here
 *
 * `onHand`, `reserved`, `available` and every `quantity` are `numeric(12,3)`
 * and travel as STRINGS. `available` is a column the database generates; a
 * screen renders it and never subtracts one figure from another. There is no
 * per-item total anywhere in the API — availability is one row per (item,
 * location) cell — and the screen does not invent one.
 *
 * ## No money crosses here
 *
 * No inventory read publishes a cost, a price or a valuation. The plan's
 * "`inv.cost.view` gates cost fields" has nothing to gate on these reads; the
 * screen shows no cost and says nothing about one.
 *
 * ## No record version guards any inventory write
 *
 * Nothing in the inventory surface is version-guarded. A reservation carries a
 * `recordVersion` the server never asks back. Concurrency is the database's:
 * balances are locked per cell, and a release of a reservation that is no
 * longer active is reported as `replayed`, not as a conflict.
 *
 * ## Reads the backend does not publish, said here rather than hidden
 *
 * - No item detail, no item-category list (`itemCategoryId` is an identifier
 *   with nothing to resolve it against), no unit-of-measure list.
 * - No reservation detail: a reservation is found through the list.
 * - No item or location WRITER exists at all: a workshop that has recorded no
 *   items and no locations sees an empty product here, and the screen says so.
 * - (W5) No issue or return detail, and no return list: a part issue is found
 *   through its work order, and what has come back is `returnedQty` on that
 *   row. A movement row carries the location's identifier but no code, and the
 *   ledger cannot be filtered by the reference's identifier.
 *
 * ## W5: issues and returns carry a transport key and no body key
 *
 * `inv.stock-issue-create` and `inv.stock-return-create` are marked idempotent,
 * so the transport attaches the header key to every send; NEITHER takes a key
 * in its body, so neither echoes `replayed` — a repeat under the same header
 * key returns the stored response. `PartIssue.returnedQty` and `quantity` are
 * two exact operands the screen shows side by side; the difference is never
 * taken here, and `ReturnEcho.totalReturned` / `issuedQuantity` are shown as
 * the server states them. Reading the movement ledger is AUDITED
 * (`inv.movement_history.read`), so a screen reads it only on an explicit
 * action, never on first paint.
 */

/** The permissions the W4 screen consults, as the backend registers them. */
export const INVENTORY_PERMISSIONS = {
  /** The item search — tenant-wide, and the page's own gate. */
  itemRead: 'inv.item.read',
  /** Availability, reservations and locations — all branch-targeted. */
  stockRead: 'inv.stock.read',
  /** Reserving and releasing. */
  operate: 'inv.stock.operate',
  /** The branch picker's own code. */
  branchRead: 'org.branch.read',
  /** (W5) The work-order header and its required parts, for the parts screen. */
  workOrderRead: 'wo.work_order.read',
  /** W10: the category, item and location writers (`inv.item.manage`, held tenant-wide). */
  itemManage: 'inv.item.manage',
  /** W10: opening-batch approval (`inv.adjustment.approve`, a second person — maker ≠ checker). */
  approve: 'inv.adjustment.approve',
  /** P1-32: the cost history, and a unit cost on a goods-receipt line (the server refuses it otherwise). */
  costView: 'inv.cost.view',
} as const;

/** `ck_item_master_type`, mirrored. */
export const ITEM_TYPES = ['part', 'material', 'consumable', 'fluid', 'kit'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** `ck_item_master_lifecycle`, mirrored. The search defaults to `active` on the server. */
export const ITEM_LIFECYCLE_STATES = ['active', 'archived'] as const;
export type ItemLifecycleState = (typeof ITEM_LIFECYCLE_STATES)[number];

/** `ck_stock_reservations_status`, mirrored. Every state but `active` is terminal. */
export const RESERVATION_STATES = ['active', 'released', 'consumed', 'expired'] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

/**
 * `ck_stock_locations_type`, mirrored. Quarantine is excluded from availability
 * unless asked for; `transit` holds dispatched transfers and is never listed as
 * availability at all.
 */
export const LOCATION_TYPES = ['warehouse', 'storage', 'quarantine', 'transit'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/**
 * The location types an operator may create. `transit` is system-owned — one per
 * branch, created by the first transfer — and the create operation refuses it.
 */
export const OPERATOR_LOCATION_TYPES = ['warehouse', 'storage', 'quarantine'] as const;
export type OperatorLocationType = (typeof OPERATOR_LOCATION_TYPES)[number];

/** `ck_stock_locations_status`, mirrored. Inactive locations are listed, not hidden. */
export const ACTIVATION_STATES = ['active', 'inactive'] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];

/** `MOVEMENT_TYPES` of the inventory domain, mirrored (W5). */
export const MOVEMENT_TYPES = [
  'opening',
  'issue',
  'return',
  'damage',
  'adjustment',
  'transfer',
  'receipt',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** `REFERENCE_KINDS` of the inventory domain, mirrored (W5): what a movement points back at. */
export const REFERENCE_KINDS = [
  'opening_line',
  'part_issue',
  'part_return',
  'damage',
  'adjustment',
  'transfer_dispatch',
  'transfer_receipt',
  'goods_receipt_line',
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** A movement's direction, mirrored (W5). */
export const DIRECTIONS = ['in', 'out'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * A quantity as every inventory write accepts it: up to nine integer digits
 * and three decimals, no sign, no exponent. Zero passes the pattern and is
 * refused by the server (`QUANTITY_MIN` is `0.001`).
 */
export const QUANTITY = /^\d{1,9}(\.\d{1,3})?$/;
export const QUANTITY_MIN = '0.001';

/** Column widths, mirrored, so a form can refuse before the 422 does. */
export const MAX_NAME = 200;
export const MAX_REASON = 2000;

/** One row of `inv.item-search` — `ItemView`. No cost field exists on it. */
export interface InventoryItem {
  readonly id: string;
  readonly itemCategoryId: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string | null;
  readonly unitOfMeasure: UnitOfMeasure;
  readonly itemType: ItemType;
  readonly isStockTracked: boolean;
  readonly isSerialized: boolean;
  readonly lifecycleStatus: ItemLifecycleState;
  readonly recordVersion: number;
}

/** The unit an item is counted in, joined from the unit table; `code` is the only surface a unit has. */
export interface UnitOfMeasure {
  readonly id: string;
  readonly code: string;
}

/**
 * One (item, location) cell of `inv.stock-availability-read` — `AvailabilityView`.
 * Three decimal STRINGS; `available` is generated by the database.
 */
export interface StockAvailability {
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationType: LocationType;
  readonly companyId: string;
  readonly branchId: string;
  readonly onHand: string;
  readonly reserved: string;
  readonly available: string;
  /**
   * What this item has in transit in the branch, repeated on every cell of the
   * item (P1-32). Part of neither `onHand` nor `available`: a dispatched
   * transfer has left its source and not reached its destination.
   */
  readonly inTransitQty: string;
}

/** One row of `inv.stock-reservation-list` — `ReservationListView`. */
export interface StockReservation {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly workOrderId: string | null;
  readonly quantity: string;
  readonly status: ReservationState;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly recordVersion: number;
}

/**
 * The echo of `inv.stock-reservation-create` and `-release` — `ReservationView`.
 * A DIFFERENT shape from the list row: no `sku`, no `locationCode`, no
 * `createdAt`, and `replayed` — true when the create returned the reservation
 * that already existed for the same key, or when the release found the
 * reservation already past `active` and did nothing.
 */
export interface ReservationEcho {
  readonly id: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string | null;
  readonly quantity: string;
  readonly status: ReservationState;
  readonly expiresAt: string | null;
  readonly recordVersion: number;
  readonly replayed: boolean;
}

/** One row of `inv.stock-location-list` — `StockLocationView`. */
export interface StockLocation {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationCode: string;
  readonly name: string;
  readonly locationType: LocationType;
  readonly parentLocationId: string | null;
  readonly status: ActivationState;
}

/**
 * One row of `inv.work-order-part-issue-list` — `PartIssueListView` (W5).
 * `quantity` and `returnedQty` are two exact decimal strings; the row carries
 * no remaining figure and the screen computes none.
 */
export interface PartIssue {
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

/** The echo of `inv.stock-issue-create` — `IssueView` (W5). */
export interface IssueEcho {
  readonly id: string;
  readonly movementId: string;
  readonly workOrderId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly quantity: string;
  readonly reservationId: string | null;
}

/**
 * The echo of `inv.stock-return-create` — `ReturnView` (W5). `totalReturned`
 * and `issuedQuantity` are the server's running figures for the issue; they
 * are shown as stated and never combined here.
 */
export interface ReturnEcho {
  readonly id: string;
  readonly partIssueId: string;
  readonly quantity: string;
  readonly totalReturned: string;
  readonly issuedQuantity: string;
}

/**
 * One row of `inv.stock-movement-list` — `MovementView` (W5). `sequence` is
 * the ledger's own order as a STRING (a bigint), served newest first;
 * `signedQuantity` is the server's signed figure. The row names the location
 * by identifier only.
 */
export interface StockMovement {
  readonly id: string;
  readonly sequence: string;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly movementType: MovementType;
  readonly direction: Direction;
  readonly quantity: string;
  readonly signedQuantity: string;
  readonly reference: MovementReference;
  readonly occurredAt: string;
  readonly correlationId: string | null;
}

/** What a movement points back at: the kind of record and its identifier. */
export interface MovementReference {
  readonly kind: ReferenceKind;
  readonly id: string;
}

/**
 * One required part of a work order — `wo.required-part-list` (W5), the
 * work-order module's `LineRow`. `reference` is the item's identifier when the
 * line was recorded against one; `unit` is free text the line was written with.
 */
export interface RequiredPart {
  readonly id: string;
  readonly workOrderId: string;
  readonly jobId: string | null;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string;
  readonly reference: string | null;
  readonly recordVersion: number;
}

/** What the movement ledger may narrow by (W5); instants are FULL ISO-8601 strings. */
export interface MovementCriteria {
  readonly itemId?: string;
  readonly locationId?: string;
  readonly workOrderId?: string;
  readonly movementType?: MovementType;
  readonly referenceKind?: ReferenceKind;
  readonly occurredFrom?: string;
  readonly occurredTo?: string;
}

/** The branch pair every stock read is addressed to — the read's TARGET, re-authorized server-side. */
export interface StockTarget {
  readonly companyId: string;
  readonly branchId: string;
}

/** What the item search may narrow by; every key is one the route's strict query accepts. */
export interface ItemSearchCriteria {
  readonly categoryId?: string;
  readonly itemType?: ItemType;
  readonly lifecycleStatus?: ItemLifecycleState;
  /** The route takes the words, not a boolean. */
  readonly stockTrackedOnly?: 'true' | 'false';
  /** A case-insensitive PREFIX on the SKU or the name; the backend escapes it. */
  readonly search?: string;
}

/** Selectors on availability: an item, a location (pinned to the target), and whether quarantine is included. */
export interface AvailabilityCriteria {
  readonly itemId?: string;
  readonly locationId?: string;
  readonly includeQuarantine?: 'true' | 'false';
}

/** Selectors on the reservation list. */
export interface ReservationCriteria {
  readonly itemId?: string;
  readonly locationId?: string;
  readonly workOrderId?: string;
  readonly status?: ReservationState;
}

/* ------------------------------------------------------------------ *
 * W10 — inventory setup and opening stock (change-control CC-05)
 *
 * | operation                        | method | path                                            | permission               |
 * | -------------------------------- | ------ | ----------------------------------------------- | ------------------------ |
 * | `inv.item-category-list`         | GET    | `/item-categories`                              | `inv.item.read`          |
 * | `inv.item-category-create`       | POST   | `/item-categories`                              | `inv.item.manage`        |
 * | `inv.uom-list`                   | GET    | `/units-of-measure`                             | `inv.item.read`          |
 * | `inv.item-create`                | POST   | `/items`                                        | `inv.item.manage`        |
 * | `inv.stock-location-create`      | POST   | `/stock-locations`                              | `inv.item.manage`        |
 * | `inv.opening-batch-create`       | POST   | `/opening-inventory-batches`                    | `inv.stock.operate`      |
 * | `inv.opening-batch-line-create`  | POST   | `/opening-inventory-batches/{batchId}/lines`    | `inv.stock.operate`      |
 * | `inv.opening-batch-approve`      | POST   | `/opening-inventory-batches/{batchId}/approval` | `inv.adjustment.approve` |
 * | `inv.opening-batch-list`         | GET    | `/opening-inventory-batches`                    | `inv.stock.read`         |
 * | `inv.opening-batch-read`         | GET    | `/opening-inventory-batches/{batchId}`          | `inv.stock.read`         |
 *
 * The two reads landed with the batch-recovery slice (seam S-17) on
 * `inv.stock.read`, the code the opening-stock page already gates on. Before
 * them a batch was write-only on the wire, so it survived only as the state of
 * the tab that created it; now a batch persists AND is reachable — listed for
 * its branch, and read back with its counted lines — which is what makes the
 * maker-and-checker rule satisfiable by a second person in their own session.
 * ------------------------------------------------------------------ */

/** The server category-code rule, lower-case snake case. Mirrors `CATEGORY_CODE_FORMAT`. */
export const CATEGORY_CODE = /^[a-z][a-z0-9_]{1,62}$/;
/** The server SKU rule. Mirrors `SKU_FORMAT`. */
export const SKU_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;
/** The server location and batch code rule. Mirrors `LOCATION_CODE_FORMAT`. */
export const LOCATION_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;
/** A plain ISO date, the only precision `as_of_date` has. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_DESCRIPTION = 2000;

/** One row of `inv.item-category-list` and the echo of `inv.item-category-create` (`ItemCategoryView`). */
export interface ItemCategory {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentCategoryId: string | null;
  readonly status: ActivationState;
  readonly recordVersion: number;
}

export const UNIT_SCOPES = ['platform', 'tenant'] as const;
export type UnitScope = (typeof UNIT_SCOPES)[number];

/** One row of `inv.uom-list` (`UnitOfMeasureView`): the platform set plus the tenant units. */
export interface UnitOfMeasureOption {
  readonly id: string;
  readonly scope: UnitScope;
  readonly code: string;
  readonly name: string;
  readonly dimension: string;
}

/** The echo of `inv.stock-location-create` (`CreatedStockLocationView`): a location plus its version. */
export interface CreatedStockLocation extends StockLocation {
  readonly recordVersion: number;
}

/**
 * The echo of `inv.opening-batch-create` and of `inv.opening-batch-approve`
 * (`OpeningBatchView`). `countedBy` is the creator, `approvedBy` the second
 * person — the server refuses the same person (409), and the screen renders
 * that refusal as published.
 */
export interface OpeningBatch {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly batchCode: string;
  readonly status: string;
  readonly countedBy: string;
  readonly approvedBy: string | null;
  readonly recordVersion: number;
}

/** The echo of `inv.opening-batch-line-create` (`OpeningLineView`). `quantity` is the exact decimal string. */
export interface OpeningBatchLine {
  readonly id: string;
  readonly batchId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
}

/**
 * One row of `inv.opening-batch-list` and the header of
 * `inv.opening-batch-read` (`OpeningBatchListView`).
 *
 * A superset of the write echo above, so a batch read back from the server can
 * be shown by the same panel that shows a batch just opened. `countedBy` and
 * `approvedBy` are user identifiers exactly as stored — the approver is the
 * half of the maker-and-checker rule a reader has to be able to check, and
 * resolving either to a display name is a separate read with its own
 * permission question. `status` is left a `string`: the values the server
 * publishes are its own, and the screen renders the one it is given rather
 * than a set this file would have to keep in step.
 */
export interface OpeningBatchSummary {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly batchCode: string;
  /** A plain ISO date — `as_of_date` is a `date`, with no time to publish. */
  readonly asOfDate: string;
  readonly status: string;
  readonly countedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  /** The server's own count of the counted lines. Never derived here. */
  readonly lineCount: number;
  readonly createdAt: string;
  readonly recordVersion: number;
}

/**
 * One counted line as `inv.opening-batch-read` publishes it
 * (`OpeningBatchLineView`): the create echo plus the codes the operator chose
 * the cell by, so a batch read back names its items and locations without a
 * second read. `quantity` stays the exact decimal string.
 */
export interface OpeningBatchLineDetail extends OpeningBatchLine {
  readonly sku: string;
  readonly itemName: string;
  readonly locationCode: string;
}

/** The answer of `inv.opening-batch-read` (`OpeningBatchDetailView`): a batch and everything counted on it. */
export interface OpeningBatchDetail {
  readonly batch: OpeningBatchSummary;
  readonly lines: readonly OpeningBatchLineDetail[];
}

/* ------------------------------------------------------------------ *
 * P1-32 — stock operations: transfers, goods receipts, adjustments and counts
 *
 * | operation                                | method | path                                                   | permission               |
 * | ---------------------------------------- | ------ | ------------------------------------------------------ | ------------------------ |
 * | `inv.stock-transfer-list`                | GET    | `/stock-transfers`                                     | `inv.stock.read`         |
 * | `inv.stock-transfer-create`              | POST   | `/stock-transfers`                                     | `inv.stock.operate`      |
 * | `inv.stock-transfer-receive`             | POST   | `/stock-transfers/{transferId}/receipt`                | `inv.stock.operate`      |
 * | `inv.stock-transfer-cancel`              | POST   | `/stock-transfers/{transferId}/cancellation`           | `inv.stock.operate`      |
 * | `inv.stock-transfer-discrepancy-resolve` | POST   | `/stock-transfers/{transferId}/discrepancy-resolution` | `inv.stock.operate`      |
 * | `inv.stock-transfer-settlement-list`     | GET    | `/stock-transfer-settlements`                          | `inv.stock.read`         |
 * | `inv.stock-transfer-write-off-decide`    | POST   | `/stock-transfer-settlements/{settlementId}/decision`  | `inv.adjustment.approve` |
 * | `inv.goods-receipt-list`                 | GET    | `/goods-receipts`                                      | `inv.stock.read`         |
 * | `inv.goods-receipt-read`                 | GET    | `/goods-receipts/{receiptId}`                          | `inv.stock.read`         |
 * | `inv.goods-receipt-create`               | POST   | `/goods-receipts`                                      | `inv.stock.operate`      |
 * | `inv.goods-receipt-post`                 | POST   | `/goods-receipts/{receiptId}/posting` (If-Match)       | `inv.stock.operate`      |
 * | `inv.item-cost-history-read`             | GET    | `/items/{itemId}/cost-history`                         | `inv.cost.view`          |
 * | `inv.stock-adjustment-list`              | GET    | `/stock-adjustments`                                   | `inv.stock.read`         |
 * | `inv.stock-adjustment-create`            | POST   | `/stock-adjustments`                                   | `inv.stock.operate`      |
 * | `inv.stock-adjustment-approve`           | POST   | `/stock-adjustments/{adjustmentId}/approval`           | `inv.adjustment.approve` |
 * | `inv.stock-count-list`                   | GET    | `/stock-counts`                                        | `inv.stock.read`         |
 * | `inv.stock-count-read`                   | GET    | `/stock-counts/{countId}`                              | `inv.stock.read`         |
 * | `inv.stock-count-open`                   | POST   | `/stock-counts`                                        | `inv.stock.operate`      |
 * | `inv.stock-count-line-record`            | PUT    | `/stock-counts/{countId}/lines/{itemId}` (If-Match)    | `inv.stock.operate`      |
 * | `inv.stock-count-reconcile`              | POST   | `/stock-counts/{countId}/reconciliation`               | `inv.stock.operate`      |
 * | `inv.stock-count-cancel`                 | POST   | `/stock-counts/{countId}/cancellation`                 | `inv.stock.operate`      |
 *
 * Typed from the views in `apps/api/src/modules/inventory/application/`
 * (`inventory-transfer-service.ts`, `inventory-receipt-service.ts`,
 * `inventory-adjustment-service.ts`, `inventory-count-service.ts`). Every
 * quantity and every cost is the exact decimal string the server sent; nothing
 * here or on the screens adds or subtracts figures to derive another.
 *
 * ## A write-off is decided from the list that reaches it
 *
 * `inv.stock-transfer-write-off-decide` names a SETTLEMENT.
 * `inv.stock-transfer-settlement-list` (P1-32-PRE-141) lists a branch's returns
 * and write-offs, sent or inbound, so the person who may decide a pending
 * write-off — someone other than the requester — reaches it in their own session.
 * ------------------------------------------------------------------ */

/** `TRANSFER_STATES`, mirrored. `received`, `settled` and `cancelled` are terminal. */
export const TRANSFER_STATES = [
  'dispatched',
  'partially_received',
  'received',
  'settled',
  'cancelled',
] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

/** Which side of a transfer the branch is read as (`inv.stock-transfer-list`). */
export const TRANSFER_DIRECTIONS = ['outbound', 'inbound'] as const;
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];

/** `TRANSFER_DISCREPANCY_KINDS`, mirrored: the two acts that settle units that did not arrive. */
export const TRANSFER_DISCREPANCY_KINDS = ['return_to_origin', 'write_off'] as const;
export type TransferDiscrepancyKind = (typeof TRANSFER_DISCREPANCY_KINDS)[number];

/** `GOODS_RECEIPT_STATES`, mirrored. */
export const GOODS_RECEIPT_STATES = ['draft', 'posted', 'cancelled'] as const;
export type GoodsReceiptState = (typeof GOODS_RECEIPT_STATES)[number];

/** `STOCK_COUNT_STATES`, mirrored. `reconciled` and `cancelled` are terminal. */
export const STOCK_COUNT_STATES = ['open', 'counting', 'reconciled', 'cancelled'] as const;
export type StockCountState = (typeof STOCK_COUNT_STATES)[number];

/** `ADJUSTMENT_STATES`, mirrored. */
export const ADJUSTMENT_STATES = ['pending', 'approved', 'rejected'] as const;
export type AdjustmentState = (typeof ADJUSTMENT_STATES)[number];

/** `ADJUSTMENT_DECISIONS`, mirrored: what a second person may record on a pending adjustment. */
export const ADJUSTMENT_DECISIONS = ['approved', 'rejected'] as const;
export type AdjustmentDecision = (typeof ADJUSTMENT_DECISIONS)[number];

/** `MATERIAL_DRAW_REFUSAL_REASONS`, mirrored: why a work-order draw was refused (`ERR-INV-001`). */
export const MATERIAL_DRAW_REASONS = [
  'exceeds_requirement',
  'approval_required',
  'missing_conversion',
  'missing_specification',
  'no_requirement',
] as const;
export type MaterialDrawReason = (typeof MATERIAL_DRAW_REASONS)[number];

/** A unit cost as `numeric(18,4)` accepts it: non-negative, up to four decimals. */
export const UNIT_COST = /^\d{1,14}(\.\d{1,4})?$/;
/** An ISO-4217 alphabetic currency code. */
export const CURRENCY_CODE = /^[A-Z]{3}$/;

/** The echo of every transfer write (`TransferView`). */
export interface TransferEcho {
  readonly id: string;
  readonly companyId: string;
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
  /** The server's figure for what is still in transit. Never derived here. */
  readonly outstandingQuantity: string;
  readonly status: TransferState;
  readonly inTransit: boolean;
  readonly reason: string | null;
  readonly cancelReason: string | null;
  readonly dispatchedAt: string;
  readonly receivedAt: string | null;
  readonly cancelledAt: string | null;
  readonly recordVersion: number;
  readonly replayed: boolean;
}

/** One row of `inv.stock-transfer-list` (`TransferListView`). */
export interface StockTransfer extends Omit<TransferEcho, 'replayed'> {
  readonly sku: string;
  /** Null when that end's location is outside what the reader may see. */
  readonly fromLocationCode: string | null;
  readonly toLocationCode: string | null;
  readonly createdAt: string;
}

/** The echo of `inv.stock-transfer-discrepancy-resolve` (`TransferSettlementWriteView`). */
export interface TransferSettlementEcho {
  readonly id: string;
  readonly transferId: string;
  readonly kind: 'receipt' | TransferDiscrepancyKind;
  readonly quantity: string;
  readonly reason: string | null;
  /** `posted`, or `pending` for a write-off awaiting a second person. */
  readonly status: 'pending' | 'posted' | 'rejected';
  readonly requestedBy: string;
  readonly createdAt: string;
  readonly recordVersion: number;
  readonly transfer: TransferEcho;
  readonly replayed: boolean;
}

/** `status` of `inv.stock-transfer-settlement-list`: the decision a write-off is waiting for or received. */
export const SETTLEMENT_DECISIONS = ['pending', 'approved', 'rejected'] as const;
export type SettlementDecision = (typeof SETTLEMENT_DECISIONS)[number];

/** One row of `inv.stock-transfer-settlement-list` (`TransferSettlementReadView`). */
export interface TransferSettlement {
  readonly id: string;
  readonly transferId: string;
  readonly companyId: string;
  /** The branch that sent the transfer; the decision is authorized there. */
  readonly branchId: string;
  readonly toBranchId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly kind: TransferDiscrepancyKind;
  readonly quantity: string;
  readonly reason: string | null;
  readonly status: 'pending' | 'posted' | 'rejected';
  readonly requestedBy: string;
  /** Null for a return to origin, which posts at once and is never decided. */
  readonly decision: SettlementDecision | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
}

/** One row of `inv.goods-receipt-list` (`GoodsReceiptView`). */
export interface GoodsReceiptSummary {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly reference: string | null;
  readonly supplierReference: string | null;
  /** A plain ISO date. */
  readonly receivedOn: string;
  readonly status: GoodsReceiptState;
  readonly notes: string | null;
  readonly postedAt: string | null;
  readonly lineCount: number;
  readonly recordVersion: number;
  readonly createdAt: string;
}

/** One line of a receipt as read back. Whether it is priced, never the figure. */
export interface GoodsReceiptLine {
  readonly id: string;
  readonly lineNo: number;
  readonly itemId: string;
  readonly sku: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly quantity: string;
  readonly hasUnitCost: boolean;
}

/** `inv.goods-receipt-read`, and the echo of posting (`GoodsReceiptDetailView`). */
export interface GoodsReceiptDetail extends GoodsReceiptSummary {
  readonly lines: readonly GoodsReceiptLine[];
  /** Present on the create echo only. */
  readonly replayed?: boolean;
}

/** One appended cost layer (`CostLayerView`). */
export interface CostLayer {
  readonly id: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly quantity: string;
  readonly unitCost: string;
  readonly currencyCode: string;
  readonly effectiveAt: string;
}

/** `inv.item-cost-history-read` (`ItemCostHistoryView`). */
export interface ItemCostHistory {
  readonly itemId: string;
  readonly companyId: string;
  readonly branchId: string;
  /** Null when nothing has ever been priced. */
  readonly latestUnitCost: string | null;
  /** Null when there are no layers, and when the layers span more than one currency. */
  readonly weightedAverageCost: string | null;
  readonly currencyCode: string | null;
  readonly mixedCurrencies: boolean;
  readonly layerCount: number;
  readonly totalQuantity: string;
  readonly layers: {
    readonly items: readonly CostLayer[];
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

/** The echo of the adjustment writes (`AdjustmentView`). */
export interface AdjustmentEcho {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly direction: Direction;
  readonly quantity: string;
  readonly reason: string;
  readonly status: AdjustmentState;
  readonly requestedBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
}

/** One row of `inv.stock-adjustment-list` (`AdjustmentListView`). */
export interface StockAdjustment extends AdjustmentEcho {
  readonly sku: string;
  readonly locationCode: string;
}

/** One line of a stock count (`StockCountLineView`). */
export interface StockCountLine {
  readonly id: string;
  readonly itemId: string;
  readonly sku: string;
  /** What the location held when the count was opened. */
  readonly snapshotQty: string;
  /** Null until the line is counted. */
  readonly countedQty: string | null;
  /** The net of the movements posted at the location after the snapshot. */
  readonly movementDeltaDuringCount: string;
  /** The database's generated variance; null until counted. */
  readonly varianceQty: string | null;
  readonly adjustmentId: string | null;
  readonly adjustmentStatus: AdjustmentState | null;
}

/** One row of `inv.stock-count-list` (`StockCountListView`). */
export interface StockCountSummary {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly status: StockCountState;
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
  readonly varianceLineCount: number;
  /** The server's sum of absolute variances. */
  readonly absoluteVarianceQty: string;
}

/**
 * `inv.stock-count-read` and the echo of every count write
 * (`StockCountDetailView`). The detail carries no location code; the screen
 * keeps the one it chose the count by.
 */
export interface StockCountDetail extends Omit<StockCountSummary, 'locationCode'> {
  readonly lines: readonly StockCountLine[];
  /** Present on the open echo only. */
  readonly replayed?: boolean;
  /** Present on the reconcile echo only: how many PENDING adjustments were raised. */
  readonly adjustmentsRaised?: number;
}
