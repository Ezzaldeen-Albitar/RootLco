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
 * counts, item barcodes and packaging identifiers, the selling price of an item,
 * and sales returns.
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
 *   ledger can express the interval in which stock is at neither end. Since
 *   slice 3 a receipt records what arrived: a short delivery leaves the remainder
 *   in transit until a further receipt, a return to origin, or a write-off a
 *   second person approves.
 * - **It governs what a job may draw, but does not plan the job.** A material
 *   requirement on a work-order service line bounds every reservation and issue
 *   for the item it covers (`MaterialDrawGovernor`); the requirement itself is
 *   asked for and approved by people, from a confirmed vehicle specification or
 *   an entered value with its source.
 * - **It receives goods, but does not run procurement.** A goods receipt adds stock
 *   against a supplier reference; there is still no purchase order, no matching,
 *   and no accounts-payable posting. `inv.external_purchase_parts` remains a
 *   work-order reference with `is_procurement = false`.
 * - **A stock count never posts stock.** Reconciling a count raises PENDING
 *   adjustments; approving them is the separate maker-checker act it always was.
 * - **It does not invoice.** Consuming stock and billing for it are different acts
 *   owned by different phases. Since P1-32 it does hold the SELLING price of an
 *   item (`inv.item_sale_prices`) and it does post the stock leg of a counter sale
 *   — `stock.postCounterSaleLines`, the port `@/modules/billing` calls after
 *   `sal.issue_invoice` — but the document, its numbering and its money remain
 *   entirely that module's. The price lives here because it is a property of the
 *   ITEM, and because `svc.price_rules` prices services only.
 * - **It raises no credit note itself.** A sales return against a counter sale
 *   credits the customer through `sal.request_return_credit_note`, the `sal`-owned
 *   primitive `inv.receive_sales_return` calls in the same transaction. No
 *   TypeScript in this module reads or writes a `sal` table, and none imports
 *   `@/modules/billing` — which would close a cycle, because billing imports this
 *   module.
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
import { InventoryIdentifierService } from './application/inventory-identifier-service';
import { InventorySalesReturnService } from './application/inventory-sales-return-service';
import { InventoryMaterialService } from './application/inventory-material-service';
import { InventoryReferenceDataService } from './application/inventory-reference-data-service';
import { InventoryAlertService } from './application/inventory-alert-service';

export type {
  AdjustmentListRow,
  AdjustmentRow,
  BalanceReconciliationRow,
  CostLayerRow,
  GoodsReceiptLineRow,
  GoodsReceiptRow,
  ItemIdentifierRow,
  ItemCategoryRow,
  ItemCostSummaryRow,
  ItemListFilter,
  ItemRow,
  ItemSalePriceRow,
  MaterialExceptionRow,
  MaterialRequirementRow,
  MovementListFilter,
  MovementReportFilter,
  MovementRow,
  OpeningBatchHeaderRow,
  OpeningLineRow,
  ReservationRow,
  ResolvedIdentifierRow,
  ReturnableQuantityRow,
  SalesReturnListRow,
  SalesReturnRow,
  StockBalanceRow,
  StockCountLineRow,
  StockCountListRow,
  StockCountRow,
  StockLocationRow,
  TransferListRow,
  TransferRow,
  TransferSettlementRow,
  UnitConversionRow,
  UnitOfMeasureRow,
  VehicleSpecificationRow,
  WorkOrderStateRow,
} from './data/inventory-repository';

export type {
  TransferListView,
  TransferSettlementReadView,
  TransferSettlementView,
  TransferSettlementWriteView,
  TransferView,
} from './application/inventory-transfer-service';

export type {
  MaterialExceptionView,
  MaterialRequestView,
  MaterialRequirementListView,
  MaterialRequirementView,
} from './application/inventory-material-service';

export type {
  UnitConversionView,
  UnitConversionWriteView,
  VehicleSpecificationView,
  VehicleSpecificationWriteView,
} from './application/inventory-reference-data-service';

export type {
  AgedInTransitAlertView,
  AgedInTransitView,
  ConsumptionPeriodView,
  CountDiscrepancyAlertView,
  CountDiscrepancyView,
  LowStockAlertView,
  LowStockRuleView,
  LowStockView,
  ReorderLevelListView,
  ReorderLevelView,
  ReorderLevelWriteView,
  UnusualConsumptionAlertView,
  UnusualConsumptionRuleView,
  UnusualConsumptionView,
} from './application/inventory-alert-service';

export {
  AGED_TRANSIT_BOUNDS,
  UNUSUAL_CONSUMPTION_BOUNDS,
} from './application/inventory-alert-service';

export type {
  AgedInTransitRow,
  ConsumptionPeriodRow,
  CountDiscrepancyRow,
  LowStockRow,
  ReorderLevelRow,
  UnusualConsumptionRow,
} from './data/inventory-repository';

export type {
  BarcodeResolutionView,
  ItemIdentifierListView,
  ItemIdentifierView,
  ItemIdentifierWriteView,
  ItemLabelView,
} from './application/inventory-identifier-service';

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
  ItemSalePriceListView,
  ItemSalePriceView,
  UnitOfMeasureView,
} from './application/inventory-catalog-service';

export type {
  ReturnableQuantityView,
  SalesReturnListView,
  SalesReturnView,
} from './application/inventory-sales-return-service';

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
  BARCODE_SYMBOLOGIES,
  CATEGORY_CODE_FORMAT,
  CONVERSION_FACTOR_FORMAT,
  COST_LAYER_SOURCE_KINDS,
  CUSTODY_STATES,
  DAMAGE_DISPOSITIONS,
  DIRECTIONS,
  ENTERABLE_IDENTIFIER_KINDS,
  EXTERNAL_PURCHASE_STATES,
  GOODS_RECEIPT_STATES,
  IDENTIFIER_KINDS,
  ITEM_LIFECYCLE_STATES,
  ITEM_TYPES,
  InventoryRuleError,
  LOCATION_CODE_FORMAT,
  LOCATION_TYPES,
  MATERIAL_APPROVAL_REQUIRED_REASONS,
  MATERIAL_DRAW_REFUSAL_REASONS,
  MATERIAL_EXCEPTION_STATES,
  MATERIAL_REQUEST_STATES,
  MATERIAL_REFUSAL_RULES,
  MATERIAL_REQUIREMENT_BASES,
  MATERIAL_REQUIREMENT_STATES,
  MAX_DESCRIPTION,
  MAX_ENGINE_VARIANT,
  MAX_IDENTIFIER_VALUE,
  MAX_NAME,
  MAX_REASON,
  MAX_SOURCE_REFERENCE,
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
  RETURN_CONDITIONS,
  SALES_RETURN_SOURCE_KINDS,
  SALES_RETURN_STATES,
  SERVICE_CONDITION_FORMAT,
  SKU_FORMAT,
  STOCK_COUNT_STATES,
  STOCK_REFUSAL_RULES,
  TRANSFER_DISCREPANCY_KINDS,
  TRANSFER_REFUSAL_RULES,
  TRANSFER_SETTLEMENT_STATES,
  TRANSFER_STATES,
  UNIT_CONVERSION_STATES,
  VEHICLE_SPECIFICATION_STATES,
  assertCountableLocation,
  assertLegalMovementReference,
  assertQuarantineDestination,
  assertReservationMatchesIssue,
  assertTransferEndpoints,
  assertWorkOrderAcceptsParts,
  barcodeSymbologyFor,
  isLegalMovementReference,
  type AdjustmentDecision,
  type AdjustmentState,
  type BarcodeSymbology,
  type CostLayerSourceKind,
  type CustodyState,
  type DamageDisposition,
  type Direction,
  type EnterableIdentifierKind,
  type ExternalPurchaseState,
  type GoodsReceiptState,
  type IdentifierKind,
  type ItemLifecycleState,
  type ItemType,
  type LocationType,
  type MaterialApprovalRequiredReason,
  type MaterialDrawRefusalReason,
  type MaterialExceptionState,
  type MaterialRefusalRule,
  type MaterialRequestState,
  type MaterialRequirementBasis,
  type MaterialRequirementState,
  type MovementType,
  type OpeningBatchState,
  type OperatorLocationType,
  type ReferenceKind,
  type ReservationState,
  type ReturnCondition,
  type SalesReturnSourceKind,
  type SalesReturnState,
  type StockCountState,
  type StockRefusalRule,
  type TransferDiscrepancyKind,
  type TransferRefusalRule,
  type TransferSettlementState,
  type TransferState,
  type UnitConversionState,
  type VehicleSpecificationState,
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
    const reads = new InventoryReadService(repository);
    return {
      reads,
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
      // P1-32 preparatory slice 2. Barcodes and packaging identifiers: catalogue
      // reference data that moves no stock. Composes `reads` only so a scan can
      // report availability through the one read that already authorizes a branch.
      identifiers: new InventoryIdentifierService(repository, reads),
      // P1-32 preparatory slice 2. A part coming back: from the job it was fitted
      // to, or from the counter sale it was sold on. Composes `stock` for the
      // location preconditions and for publishing the `in` leg, exactly as the
      // transfer and receipt services do.
      salesReturns: new InventorySalesReturnService(repository, stock),
      // P1-32 preparatory slice 3b. Material requirements and their exceptions. The
      // draw governance itself lives inside `stock`, on the two stock paths it
      // bounds, so no draw can reach the ledger around it.
      materials: new InventoryMaterialService(repository),
      // P1-32 preparatory slice 3b. Tenant-wide unit conversions and vehicle service
      // specifications: the facts every allowance is measured against.
      referenceData: new InventoryReferenceDataService(repository),
      // Owner directive. Reorder levels and the four stock alerts computed over
      // them and over the ledger. Composes NOTHING but the repository, and that is
      // the design: an alert is an arithmetic statement about rows the caller may
      // already read, so it needs no stock service, posts no movement, and must
      // never acquire a path that could.
      alerts: new InventoryAlertService(repository),
    };
  },
});
