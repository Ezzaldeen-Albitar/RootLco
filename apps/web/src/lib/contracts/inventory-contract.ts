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
