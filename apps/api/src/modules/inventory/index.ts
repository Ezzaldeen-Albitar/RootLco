/**
 * `inventory` module — public surface (Phase 1-21).
 *
 * The ONLY legal import path for this module (ADR-001): `@/modules/inventory`.
 * The boundary checker and the ESLint rule both reject
 * `@/modules/inventory/<anything>`.
 *
 * ## What this module owns
 *
 * The whole `inv` schema: the item catalog and units of measure, stock locations,
 * the movement ledger, balances, reservations, opening batches, adjustments, part
 * issues and returns, damaged stock, customer-supplied parts, external-purchase
 * references, stock transfers, goods receipts with their cost history, and stock
 * counts.
 *
 * ## What no other module may do
 *
 * Read or write an `inv` table directly. `work-order`, `pricing`, and `reception`
 * all have reasons to care about stock, and all three must ask this module — the
 * boundary checker enforces it. That is not bureaucracy: the balance invariants
 * hold only because every mutation funnels through the protected `inv` functions
 * that take the balance-row lock first, and a second module writing
 * `inv.stock_balances` would be a read-then-write race by construction.
 *
 * ## What this module deliberately does not do
 *
 * - **It returns cost through exactly one read.** `ItemView` has no amount field,
 *   no read path selects `inv.item_cost_details`, and the goods-receipt reads say
 *   whether a line is priced without saying the figure. The only cost this module
 *   returns is `inv.item-cost-history-read`, over `inv.item_cost_layers`, whose
 *   every policy is gated on `inv.cost.view` — so the database, not this file,
 *   decides who reads it. Cost history is APPENDED and never rewritten; nothing
 *   here writes `inv.item_cost_details.standard_cost`.
 * - **It transfers stock, but never in one step.** Since P1-32 a transfer is two
 *   paired postings separated in time — dispatch into the branch's `transit`
 *   location, then receipt out of it (or cancellation back to the origin) — so the
 *   ledger can express the interval in which stock is at neither end. Partial
 *   receipt is unrepresentable (`ck_stock_transfers_received_quantity`).
 * - **It receives goods, but does not run procurement.** A goods receipt adds stock
 *   against a supplier reference; there is still no purchase order, no matching,
 *   and no accounts-payable posting. `inv.external_purchase_parts` remains a
 *   work-order reference with `is_procurement = false`.
 * - **A stock count never posts stock.** Reconciling a count raises PENDING
 *   adjustments; approving them is the separate maker-checker act it always was.
 * - **It does not invoice.** Consuming stock and billing for it are different acts
 *   owned by different phases.
 */
import { composeModule } from '@/server/layering';
import { InventoryRepository } from './data/inventory-repository';
import { InventoryReadService } from './application/inventory-read-service';
import { InventoryStockService } from './application/inventory-stock-service';
import { InventoryIntakeService } from './application/inventory-intake-service';
import { InventoryCatalogService } from './application/inventory-catalog-service';
import { InventoryReportPort } from './application/inventory-report-port';
import { InventoryTransferService } from './application/inventory-transfer-service';
import { InventoryReceiptService } from './application/inventory-receipt-service';
import { InventoryAdjustmentService } from './application/inventory-adjustment-service';
import { InventoryCountService } from './application/inventory-count-service';

export type {
  AdjustmentListRow,
  AdjustmentRow,
  BalanceReconciliationRow,
  CostLayerRow,
  GoodsReceiptLineRow,
  GoodsReceiptRow,
  ItemCategoryRow,
  ItemCostSummaryRow,
  ItemListFilter,
  ItemRow,
  MovementListFilter,
  MovementReportFilter,
  MovementRow,
  OpeningBatchHeaderRow,
  OpeningLineRow,
  ReservationRow,
  StockBalanceRow,
  StockCountLineRow,
  StockCountListRow,
  StockCountRow,
  StockLocationRow,
  TransferListRow,
  TransferRow,
  UnitOfMeasureRow,
  WorkOrderStateRow,
} from './data/inventory-repository';

export type { TransferListView, TransferView } from './application/inventory-transfer-service';

export type {
  CostLayerView,
  CreatedGoodsReceiptView,
  GoodsReceiptDetailView,
  GoodsReceiptLineInput,
  GoodsReceiptLineView,
  GoodsReceiptView,
  ItemCostHistoryView,
} from './application/inventory-receipt-service';

export type {
  AdjustmentListView,
  AdjustmentView,
} from './application/inventory-adjustment-service';

export type {
  OpenedStockCountView,
  ReconciledStockCountView,
  StockCountDetailView,
  StockCountLineView,
  StockCountListView,
  StockCountView,
} from './application/inventory-count-service';

export type {
  CreateItemCategoryInput,
  CreateItemInput,
  CreateStockLocationInput,
  CreatedItemView,
  CreatedStockLocationView,
  ItemCategoryView,
  UnitOfMeasureView,
} from './application/inventory-catalog-service';

export type {
  AvailabilityView,
  ItemView,
  MovementView,
  OpenInventoryCommitments,
  OpeningBatchDetailView,
  OpeningBatchLineView,
  OpeningBatchListView,
  PartIssueListView,
  ReconciliationView,
  ReservationListView,
  StockLocationView,
} from './application/inventory-read-service';

export type {
  DamageView,
  IssueView,
  ReservationView,
  ReturnView,
} from './application/inventory-stock-service';

export type {
  MovementReportEntry,
  MovementReportSummary,
  MovementReportTotal,
} from './application/inventory-report-port';

export type {
  CustomerSuppliedPartView,
  ExternalPurchasePartView,
  OpeningBatchView,
  OpeningLineView,
} from './application/inventory-intake-service';

export {
  ADJUSTMENT_DECISIONS,
  ADJUSTMENT_STATES,
  CATEGORY_CODE_FORMAT,
  COST_LAYER_SOURCE_KINDS,
  CUSTODY_STATES,
  DAMAGE_DISPOSITIONS,
  DIRECTIONS,
  EXTERNAL_PURCHASE_STATES,
  GOODS_RECEIPT_STATES,
  ITEM_LIFECYCLE_STATES,
  ITEM_TYPES,
  InventoryRuleError,
  LOCATION_CODE_FORMAT,
  LOCATION_TYPES,
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_REASON,
  MOVEMENT_REFERENCE_MATRIX,
  MOVEMENT_TYPES,
  OPENING_BATCH_STATES,
  OPERATOR_LOCATION_TYPES,
  QUANTITY_MAX,
  QUANTITY_MIN,
  QUANTITY_PRECISION,
  QUANTITY_SCALE,
  Quantity,
  REFERENCE_KINDS,
  RESERVATION_STATES,
  SKU_FORMAT,
  STOCK_COUNT_STATES,
  TRANSFER_STATES,
  assertCountableLocation,
  assertLegalMovementReference,
  assertQuarantineDestination,
  assertReservationMatchesIssue,
  assertTransferEndpoints,
  assertWorkOrderAcceptsParts,
  isLegalMovementReference,
  type AdjustmentDecision,
  type AdjustmentState,
  type CostLayerSourceKind,
  type CustodyState,
  type DamageDisposition,
  type Direction,
  type ExternalPurchaseState,
  type GoodsReceiptState,
  type ItemLifecycleState,
  type ItemType,
  type LocationType,
  type MovementType,
  type OpeningBatchState,
  type OperatorLocationType,
  type ReferenceKind,
  type ReservationState,
  type StockCountState,
  type TransferState,
} from './domain/inventory';

/**
 * Composition root: constructs the module's services once per process.
 *
 * Three services over ONE repository. The split is by authority — reads need
 * `inv.stock.read`, stock mutations need `inv.stock.operate`, and intake spans
 * `inv.adjustment.approve`, `inv.custody.manage`, and
 * `inv.external_purchase.record` — while the SQL for a table stays in one file,
 * because two files writing `inv.stock_balances` is how a tenant predicate ends up
 * on one query and not the other.
 */
export const inventoryModule = composeModule({
  module: 'inventory',
  create: () => {
    const repository = new InventoryRepository();
    const stock = new InventoryStockService(repository);
    return {
      reads: new InventoryReadService(repository),
      stock,
      intake: new InventoryIntakeService(repository),
      // The master data every movement is keyed on (P1-30 corrective slice):
      // categories, items, units and locations. Writes catalogue rows only —
      // never stock, never cost — so the opening batch stays the sole path by
      // which stock appears from nothing.
      catalog: new InventoryCatalogService(repository),
      // P1-31 P-11 slice 3. The REPORTING port. Separate from `reads` because
      // `InventoryReadService.listMovements` takes a scope authorizer and writes
      // an `inv.movement_history.read` audit row on every call — a report run is
      // audited as itself, and a second entry attributed to an operation the
      // caller never invoked would be a false trail.
      reportPort: new InventoryReportPort(repository),
      // P1-32 preparatory slice. Each composes the stock service for the shared
      // preconditions (location, stock-tracked item) and for publishing
      // `stock.movement.posted`, so the rules a movement must satisfy are stated
      // once however the movement was caused.
      transfers: new InventoryTransferService(repository, stock),
      receipts: new InventoryReceiptService(repository, stock),
      adjustments: new InventoryAdjustmentService(repository, stock),
      counts: new InventoryCountService(repository, stock),
    };
  },
});
