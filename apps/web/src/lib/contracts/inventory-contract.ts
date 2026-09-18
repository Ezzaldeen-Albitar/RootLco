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

/* ------------------------------------------------------------------ *
 * P1-32 — the barcode, pricing and customer-return screens. Each
 * interface below is sent by a screen under
 * `app/[locale]/(dashboard)/inventory/**`.
 *
 * `inv.item-identifier-retire` and `inv.item-barcode-assign` carry no body at
 * all and are declared BODYLESS in the gate: the first names the item and the
 * identifier in the path, and the second allocates the next internal code from
 * the tenant's own counter, so there is nothing for a caller to state.
 * ------------------------------------------------------------------ */

/**
 * `inv.item-identifier-add` — `POST /items/{itemId}/identifiers`.
 *
 * `kind` excludes `internal`: an internal code is allocated, never entered, so
 * the server refuses that kind here. `value` is the code as printed on the part
 * or its packaging — the database generates the normalised form and checks the
 * retail check digit. `packQuantity` is a decimal string saying how many base
 * units one scan of this code stands for; `unitId` names the unit it is counted
 * in. Idempotent: the screen derives its key once per user confirmation, so a
 * doubled scanner frame replays the first write instead of colliding.
 */
export interface ItemIdentifierAddBody {
  readonly kind: 'gtin' | 'ean' | 'upc' | 'manufacturer_part_number' | 'supplier_code';
  readonly value: string;
  readonly unitId?: string;
  readonly packQuantity?: string;
  readonly isPrimary?: boolean;
}

/**
 * `inv.item-sale-price-set` — `POST /items/{itemId}/sale-prices`.
 *
 * A row may name a company, or a company and a branch, or neither; neither
 * means every branch of every company and requires `inv.item.manage` held
 * tenant-wide. `unitPrice` is a decimal STRING at scale four — a price carried
 * as a JSON number is a price nobody agreed to. Exactly one live row exists per
 * signature, so this SETS rather than appends.
 */
export interface ItemSalePriceSetBody {
  readonly companyId?: string;
  readonly branchId?: string;
  /** A three-letter ISO 4217 code. */
  readonly currencyCode: string;
  /** A decimal string of at most four places. */
  readonly unitPrice: string;
  /** A company's tax class; a tenant-wide price may not name one. */
  readonly taxClassId?: string;
}

/**
 * `inv.sales-return-create` — `POST /sales-returns`.
 *
 * The SOURCE bounds how much may come back and decides whether money moves; the
 * CONDITION decides which shelf it lands on. `quarantineLocationId` is REQUIRED
 * when the condition is `damaged` and refused when it is not. No company or
 * branch: the return is received in the branch that issued or sold the part,
 * resolved by the server from the source itself. Idempotent through the
 * transport key, derived once per confirmation.
 */
export interface SalesReturnCreateBody {
  readonly sourceKind: 'part_issue' | 'invoice_line';
  readonly sourceId: string;
  /** A decimal string, up to nine integer digits and three decimals. */
  readonly quantity: string;
  readonly condition: 'restockable' | 'damaged';
  readonly receivedLocationId: string;
  readonly quarantineLocationId?: string;
  readonly reason?: string;
}

/* ------------------------------------------------------------------ *
 * P1-32 — material demand control and its reference data. Each
 * interface below is sent by a screen under
 * `app/[locale]/(dashboard)/inventory/**`: the material requirements
 * panel on the parts screen, and the unit-conversion and vehicle
 * specification screens.
 *
 * `inv.material-requirement-recheck` carries no body at all and is
 * declared BODYLESS in the gate: it re-reads the requirement named in
 * the path, so there is nothing for a caller to state.
 *
 * `inv.material-requirement-create` is the one write on this surface
 * whose schema is a DISCRIMINATED UNION — an entered allowance with its
 * source, or a derivation from the confirmed vehicle specification — so
 * its shape is declared in `features/inventory/inventory-contract.ts`
 * beside the screen that sends it. The parity comparison comprehends a
 * single object shape only, and a one-interface mirror of a two-branch
 * body would state a shape the API does not accept.
 * ------------------------------------------------------------------ */

/**
 * `inv.material-requirement-approve` —
 * `POST /material-requirements/{requirementId}/approval`.
 *
 * Decided by someone OTHER than the person who asked: the service refuses the
 * requester readably and the database refuses them whatever codes they hold.
 * `reason` is what a rejection is recorded with.
 */
export interface MaterialRequirementApproveBody {
  readonly decision: 'approved' | 'rejected';
  readonly reason?: string;
}

/**
 * `inv.material-exception-create` —
 * `POST /material-requirements/{requirementId}/exceptions`.
 *
 * A FINITE extra quantity in the requirement's own unit, as an exact decimal
 * string, with the reason it is being asked for. There is no unbounded
 * exception: an approved one raises the allowance by exactly this much.
 */
export interface MaterialExceptionCreateBody {
  readonly additionalQuantity: string;
  readonly reason: string;
}

/**
 * `inv.material-exception-decide` —
 * `POST /material-exceptions/{exceptionId}/decision`. A different approver
 * again; `note` is what the decision is recorded with.
 */
export interface MaterialExceptionDecideBody {
  readonly decision: 'approved' | 'rejected';
  readonly note?: string;
}

/**
 * `inv.material-requirement-cancel` —
 * `POST /material-requirements/{requirementId}/cancellation`. Refused while
 * anything is still committed against the requirement.
 */
export interface MaterialRequirementCancelBody {
  readonly reason: string;
}

/**
 * `inv.material-request-close` — `POST /material-requests/{requestId}/closure`.
 * `reason` is optional: finishing a request that was fully drawn needs no
 * explanation.
 */
export interface MaterialRequestCloseBody {
  readonly reason?: string;
}

/** `inv.material-request-cancel` — `POST /material-requests/{requestId}/cancellation`. */
export interface MaterialRequestCancelBody {
  readonly reason: string;
}

/**
 * `inv.unit-conversion-set` — `POST /unit-conversions`.
 *
 * One row says "1 from-unit = factor to-units" and nothing else; there is no
 * implied reverse, because 1 / factor is not exact in general. `itemId` is
 * REQUIRED by the server when the two units measure different kinds of
 * quantity, and refused on a tenant-wide row that crosses kinds. `factor` is an
 * exact decimal string, never a number.
 */
export interface UnitConversionSetBody {
  readonly itemId?: string;
  readonly fromUomId: string;
  readonly toUomId: string;
  readonly factor: string;
  readonly sourceReference: string;
}

/**
 * `inv.vehicle-specification-create` — `POST /vehicle-fluid-specifications`.
 *
 * Records a capacity, unconfirmed: only a confirmed specification resolves a
 * requirement. `capacity` is an exact decimal string and is always positive —
 * an unknown capacity is not recorded at all — and `sourceReference` says where
 * it was read from.
 */
export interface VehicleSpecificationCreateBody {
  readonly makeId: string;
  readonly modelId?: string;
  readonly modelYearFrom?: number;
  readonly modelYearTo?: number;
  readonly engineVariant?: string;
  readonly serviceCondition: string;
  readonly itemCategoryId?: string;
  readonly capacity: string;
  readonly uomId: string;
  readonly sourceReference: string;
}
