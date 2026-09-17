/**
 * Request-payload mirror for the `inv.` (inventory) writes — P1-30, `W4`.
 *
 * Transcribed by hand for the reason `services-contract.ts` records, and
 * compared against the routes' zod schemas by `check-p1-30-payload-parity.mjs`.
 * One interface per operation, named by `typeNameFor`.
 *
 * ## Quantities are strings
 *
 * `quantity` is a decimal STRING (up to nine integer digits and three
 * decimals); a JSON number is refused by the route. Nothing here is a money
 * field — no inventory write carries a cost in this wave.
 *
 * W4 mirrors the two reservation writes, W5 the issue and return writes, and
 * W10 (the inventory setup and opening-stock screens, change-control CC-05)
 * the category, item, location and opening-batch writes. The damage and
 * intake writes belong to no P1-30 screen; they stay declared PENDING in the
 * gate rather than mirrored without a consumer.
 */

/**
 * `inv.stock-reservation-create` — `POST /stock-reservations`.
 *
 * No company or branch: the server resolves the location's own pair and
 * authorizes it inside the transaction. `idempotencyKey` is a second key the
 * reservation keeps for its whole life, separate from the transport's
 * `Idempotency-Key` header. `expiresAt` is an instant with an offset.
 */
export interface StockReservationCreateBody {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
  readonly workOrderId?: string;
  readonly idempotencyKey?: string;
  readonly expiresAt?: string;
  /**
   * The material requirement the reservation draws on. Required by the server when
   * the work order has a requirement covering the item; a draw beyond what it allows
   * is refused (409).
   */
  readonly materialRequirementId?: string;
}

/**
 * `inv.stock-reservation-release` — `POST /stock-reservations/{reservationId}/release`.
 * The body may be empty; `reason` defaults to `released` on the server.
 */
export interface StockReservationReleaseBody {
  readonly reason?: string;
}

/**
 * `inv.stock-issue-create` — `POST /stock-issues` (W5). The transport attaches
 * the header key; there is no body key. The location decides the branch, and
 * the work order must accept parts (open, not draft). An issue larger than the
 * reservation it names is refused (409); issuing against a reservation
 * consumes it in full.
 */
export interface StockIssueCreateBody {
  readonly workOrderId: string;
  readonly itemId: string;
  readonly locationId: string;
  /** A decimal string, up to nine integer digits and three decimals, above zero. */
  readonly quantity: string;
  readonly reservationId?: string;
  /** The required-part line this issue satisfies, when it was recorded against one. */
  readonly requiredPartRef?: string;
  /**
   * The material requirement the issue draws on. Required by the server when the
   * work order has a requirement covering the item, unless the named reservation
   * already draws on it; a draw beyond what it allows is refused (409).
   */
  readonly materialRequirementId?: string;
}

/**
 * `inv.stock-return-create` — `POST /stock-returns` (W5). A return names ONLY
 * the issue; the server refuses a return that would exceed what was issued.
 */
export interface StockReturnCreateBody {
  readonly partIssueId: string;
  readonly quantity: string;
  readonly reason?: string;
}

/**
 * `inv.item-category-create` — `POST /item-categories`. Tenant-wide: the body
 * names no company or branch, and the route requires `inv.item.manage` held
 * tenant-wide. `code` is lower-case snake case (`^[a-z][a-z0-9_]{1,62}$`);
 * `parentCategoryId` must name an ACTIVE category of the same tenant.
 */
export interface ItemCategoryCreateBody {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly parentCategoryId?: string;
}

/**
 * `inv.item-create` — `POST /items`. A catalogue row only: no cost and no
 * stock — stock first appears through an approved opening batch. `uomId`
 * must name an active unit visible to the tenant (platform or its own).
 */
export interface ItemCreateBody {
  readonly itemCategoryId: string;
  readonly sku: string;
  readonly name: string;
  readonly description?: string;
  readonly uomId: string;
  readonly itemType: 'part' | 'material' | 'consumable' | 'fluid' | 'kit';
  readonly isStockTracked?: boolean;
  readonly isSerialized?: boolean;
}

/**
 * `inv.stock-location-create` — `POST /stock-locations`. Branch-scoped by the
 * pair in the body. A warehouse has no parent; storage and quarantine need a
 * parent that is a warehouse of the same branch — the server states which
 * rule refused, by the field.
 */
export interface StockLocationCreateBody {
  readonly companyId: string;
  readonly branchId: string;
  readonly locationCode: string;
  readonly name: string;
  readonly locationType: 'warehouse' | 'storage' | 'quarantine';
  readonly parentLocationId?: string;
}

/**
 * `inv.opening-batch-create` — `POST /opening-inventory-batches`. `asOfDate`
 * is a plain ISO date (the column is a `date`). The batch is the only path by
 * which stock first appears. `GET /opening-inventory-batches` and
 * `GET /opening-inventory-batches/{batchId}` read it back on `inv.stock.read`,
 * so the screen no longer depends on holding this echo; the reads carry no
 * request body and are mirrored as view types in the feature contract rather
 * than here.
 */
export interface OpeningBatchCreateBody {
  readonly companyId: string;
  readonly branchId: string;
  readonly batchCode: string;
  readonly asOfDate: string;
  readonly notes?: string;
}

/**
 * `inv.opening-batch-line-create` — `POST /opening-inventory-batches/{batchId}/lines`.
 * `quantity` is a decimal string. The approval (`inv.opening-batch-approve`)
 * carries no body and is declared BODYLESS in the gate.
 */
export interface OpeningBatchLineCreateBody {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
}

/* ------------------------------------------------------------------ *
 * P1-32 — the stock-operation screens (transfers, goods receipts,
 * adjustments, counts). Each interface below is sent by a screen under
 * `app/[locale]/(dashboard)/inventory/**`, the write-off decision included:
 * the transfers screen reaches a pending settlement through
 * `inv.stock-transfer-settlement-list` (P1-32-PRE-144).
 * ------------------------------------------------------------------ */

/**
 * `inv.stock-transfer-create` — `POST /stock-transfers`. The locations decide
 * both branches. `idempotencyKey` is kept for the transfer's whole life, so a
 * retry after it was received still resolves to it (`replayed`).
 */
export interface StockTransferCreateBody {
  readonly itemId: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  /** A decimal string, up to nine integer digits and three decimals. */
  readonly quantity: string;
  readonly reason?: string;
  readonly idempotencyKey?: string;
}

/**
 * `inv.stock-transfer-receive` — `POST /stock-transfers/{transferId}/receipt`.
 * `quantity` is what physically arrived, up to what is still in transit; less
 * leaves the remainder in transit.
 */
export interface StockTransferReceiveBody {
  readonly quantity: string;
}

/** `inv.stock-transfer-cancel` — `POST /stock-transfers/{transferId}/cancellation`. A dispatched transfer only. */
export interface StockTransferCancelBody {
  readonly reason: string;
}

/**
 * `inv.stock-transfer-discrepancy-resolve` —
 * `POST /stock-transfers/{transferId}/discrepancy-resolution`. A return to the
 * origin posts at once; a write-off waits for a second person.
 */
export interface StockTransferDiscrepancyResolveBody {
  readonly kind: 'return_to_origin' | 'write_off';
  readonly quantity: string;
  readonly reason: string;
}

/**
 * One line of `inv.goods-receipt-create`. `unitCost` and `currencyCode` travel
 * together, and only a holder of `inv.cost.view` may send them — the server
 * refuses the field otherwise rather than dropping it.
 */
export interface GoodsReceiptCreateLine {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
  /** A non-negative decimal string of at most four places. */
  readonly unitCost?: string;
  readonly currencyCode?: string;
}

/** `inv.goods-receipt-create` — `POST /goods-receipts`. Creates a DRAFT; posting is a separate act. */
export interface GoodsReceiptCreateBody {
  readonly companyId: string;
  readonly branchId: string;
  readonly reference?: string;
  readonly supplierReference?: string;
  /** A plain ISO date. */
  readonly receivedOn: string;
  readonly notes?: string;
  readonly idempotencyKey?: string;
  readonly lines: readonly GoodsReceiptCreateLine[];
}

/**
 * `inv.stock-adjustment-create` — `POST /stock-adjustments`. Pending, with no
 * stock effect, until a different person approves it. `valueImpact` (with its
 * currency) is recorded only by a holder of `inv.cost.view`; the screen does
 * not send it.
 */
export interface StockAdjustmentCreateBody {
  readonly companyId: string;
  readonly branchId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly direction: 'in' | 'out';
  readonly quantity: string;
  readonly reason: string;
  readonly valueImpact?: string;
  readonly currencyCode?: string;
}

/**
 * `inv.stock-adjustment-approve` — `POST /stock-adjustments/{adjustmentId}/approval`.
 * The requester may not decide; the server refuses them (409).
 */
export interface StockAdjustmentApproveBody {
  readonly decision: 'approved' | 'rejected';
  readonly reason: string;
}

/**
 * `inv.stock-transfer-write-off-decide` —
 * `POST /stock-transfer-settlements/{settlementId}/decision`. A pending write-off
 * only, decided by someone other than its requester; the server refuses the
 * requester (409).
 */
export interface StockTransferWriteOffDecideBody {
  readonly decision: 'approved' | 'rejected';
  readonly reason: string;
}

/** `inv.stock-count-open` — `POST /stock-counts`. Snapshots what the location holds. */
export interface StockCountOpenBody {
  readonly locationId: string;
  readonly notes?: string;
  readonly idempotencyKey?: string;
}

/**
 * `inv.stock-count-line-record` — `PUT /stock-counts/{countId}/lines/{itemId}`,
 * with the COUNT's record version as If-Match.
 */
export interface StockCountLineRecordBody {
  readonly countedQty: string;
}

/** `inv.stock-count-cancel` — `POST /stock-counts/{countId}/cancellation`. Raises no adjustment. */
export interface StockCountCancelBody {
  readonly reason: string;
}
