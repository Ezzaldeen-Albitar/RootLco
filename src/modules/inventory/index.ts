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
 * issues and returns, damaged stock, customer-supplied parts, and external-purchase
 * references.
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
 * - **It does not return cost.** `ItemView` has no amount field and no read path
 *   here selects `inv.item_cost_details`. Cost is gated by `inv.cost.view` inside
 *   the RLS policy itself, and the only cost this module writes is the restricted
 *   external-purchase unit cost, which it never reads back.
 * - **It does not transfer stock between locations.** The `transfer` movement kind
 *   and the `transit` location type were dropped in Phase 1-10, so there is no
 *   primitive to build one on. Inventing a two-movement "transfer" would mint a
 *   business fact the ledger cannot express.
 * - **It does not run procurement.** `inv.external_purchase_parts` is a reference
 *   with `is_procurement = false`; there is no purchase order, no goods receipt,
 *   and no accounts-payable posting.
 * - **It does not invoice.** Consuming stock and billing for it are different acts
 *   owned by different phases.
 */
import { composeModule } from '@/server/layering';
import { InventoryRepository } from './data/inventory-repository';
import { InventoryReadService } from './application/inventory-read-service';
import { InventoryStockService } from './application/inventory-stock-service';
import { InventoryIntakeService } from './application/inventory-intake-service';

export type {
  BalanceReconciliationRow,
  ItemListFilter,
  ItemRow,
  MovementListFilter,
  MovementRow,
  ReservationRow,
  StockBalanceRow,
  StockLocationRow,
  WorkOrderStateRow,
} from './data/inventory-repository';

export type {
  AvailabilityView,
  ItemView,
  MovementView,
  OpenInventoryCommitments,
  ReconciliationView,
} from './application/inventory-read-service';

export type {
  DamageView,
  IssueView,
  ReservationView,
  ReturnView,
} from './application/inventory-stock-service';

export type {
  CustomerSuppliedPartView,
  ExternalPurchasePartView,
  OpeningBatchView,
  OpeningLineView,
} from './application/inventory-intake-service';

export {
  CUSTODY_STATES,
  DAMAGE_DISPOSITIONS,
  DIRECTIONS,
  EXTERNAL_PURCHASE_STATES,
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
  QUANTITY_MAX,
  QUANTITY_MIN,
  QUANTITY_PRECISION,
  QUANTITY_SCALE,
  Quantity,
  REFERENCE_KINDS,
  RESERVATION_STATES,
  SKU_FORMAT,
  assertLegalMovementReference,
  assertQuarantineDestination,
  assertReservationMatchesIssue,
  assertWorkOrderAcceptsParts,
  isLegalMovementReference,
  type CustodyState,
  type DamageDisposition,
  type Direction,
  type ExternalPurchaseState,
  type ItemLifecycleState,
  type ItemType,
  type LocationType,
  type MovementType,
  type OpeningBatchState,
  type ReferenceKind,
  type ReservationState,
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
    return {
      reads: new InventoryReadService(repository),
      stock: new InventoryStockService(repository),
      intake: new InventoryIntakeService(repository),
    };
  },
});
