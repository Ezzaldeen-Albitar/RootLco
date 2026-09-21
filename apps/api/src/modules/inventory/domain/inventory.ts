/**
 * Inventory vocabulary and the exact-quantity value object (Phase 1-21).
 *
 * Every constant here is transcribed from a CHECK constraint on the frozen `inv`
 * schema, and the transcription is asserted against the live catalog in the
 * database suite — a constant that drifts from its constraint fails the build
 * rather than rotting quietly. See
 * `docs/phase-1/phase-1-21/wave-1-contract-archaeology.md`.
 *
 * ## Why a value object rather than a number
 *
 * Every inventory quantity column is `numeric(12, 3)`. IEEE-754 cannot represent
 * `0.001` exactly, so a `number` round-trip is lossy at the third decimal — the
 * exact place inventory counts. `Quantity` therefore carries an exact decimal
 * **string** and does all arithmetic in scaled integers. Nothing on an
 * authoritative path calls `parseFloat`, `Number`, `Math.round`, or `toFixed`.
 */

export class InventoryRuleError extends Error {
  public override readonly name = 'InventoryRuleError';
}

// ---------------------------------------------------------------------------
// Vocabularies — transcribed from `inv` CHECK constraints.
// ---------------------------------------------------------------------------

/** `ck_stock_movements_type`. */
export const MOVEMENT_TYPES = Object.freeze([
  'opening',
  'issue',
  'return',
  'damage',
  'adjustment',
  'transfer',
  'receipt',
  // A counter sale: stock sold over the counter leaves at issuance, `out` only.
  'sale',
] as const);
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** `ck_stock_movements_reference_kind`. The complete legal business-reference set. */
export const REFERENCE_KINDS = Object.freeze([
  'opening_line',
  'part_issue',
  'part_return',
  'damage',
  'adjustment',
  'transfer_dispatch',
  'transfer_receipt',
  'goods_receipt_line',
  'invoice_line',
  'sales_return',
] as const);
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/**
 * `ck_sales_returns_condition`. The condition decides which cell the returned unit
 * lands in — a sellable one or a quarantine one — and nothing else about a return
 * depends on it.
 */
export const RETURN_CONDITIONS = Object.freeze(['restockable', 'damaged'] as const);
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

/** `ck_sales_returns_source_kind`. What the returned unit left on. */
export const SALES_RETURN_SOURCE_KINDS = Object.freeze(['part_issue', 'invoice_line'] as const);
export type SalesReturnSourceKind = (typeof SALES_RETURN_SOURCE_KINDS)[number];

/**
 * `ck_sales_returns_status`. `credited` means the return raised a pending credit
 * note; a second person still approves it. There is no third state: nothing in this
 * slice closes a return.
 */
export const SALES_RETURN_STATES = Object.freeze(['received', 'credited'] as const);
export type SalesReturnState = (typeof SALES_RETURN_STATES)[number];

/** `ck_stock_movements_direction`. */
export const DIRECTIONS = Object.freeze(['in', 'out'] as const);
export type Direction = (typeof DIRECTIONS)[number];

/** `ck_stock_reservations_status`. Anything other than `active` is terminal. */
export const RESERVATION_STATES = Object.freeze([
  'active',
  'released',
  'consumed',
  'expired',
] as const);
export type ReservationState = (typeof RESERVATION_STATES)[number];

/**
 * `ck_stock_locations_type`. `quarantine` holds damaged stock; `transit` holds the
 * quantity of a dispatched transfer until it is received.
 *
 * Neither is sellable, and neither is a flag: a unit leaves availability because it
 * SITS somewhere else, which no application filter can forget to apply. A `transit`
 * location is branch-level and parentless (`inv.guard_stock_location_hierarchy`),
 * created on first use by `inv.ensure_transit_location`, and never created through
 * the location-catalogue write path.
 */
export const LOCATION_TYPES = Object.freeze([
  'warehouse',
  'storage',
  'quarantine',
  'transit',
] as const);
export type LocationType = (typeof LOCATION_TYPES)[number];

/**
 * The location types an operator may create.
 *
 * `transit` is absent on purpose. It is system-owned: exactly one per branch, named
 * by `inv.dispatch_transfer`, and a second one an operator created by hand would
 * hold transfers that no transfer row points at.
 */
export const OPERATOR_LOCATION_TYPES = Object.freeze([
  'warehouse',
  'storage',
  'quarantine',
] as const);
export type OperatorLocationType = (typeof OPERATOR_LOCATION_TYPES)[number];

/**
 * `ck_stock_transfers_status`. `received`, `settled` and `cancelled` are terminal.
 * `partially_received` holds a short delivery whose remainder is still in transit;
 * `settled` is a transfer with nothing outstanding whose shortfall was returned to
 * the origin or written off.
 */
export const TRANSFER_STATES = Object.freeze([
  'dispatched',
  'partially_received',
  'received',
  'settled',
  'cancelled',
] as const);
export type TransferState = (typeof TRANSFER_STATES)[number];

/**
 * The two acts that take an undelivered remainder out of transit
 * (`ck_stock_transfer_settlements_kind` less `receipt`, which is the receipt route).
 */
export const TRANSFER_DISCREPANCY_KINDS = Object.freeze(['return_to_origin', 'write_off'] as const);
export type TransferDiscrepancyKind = (typeof TRANSFER_DISCREPANCY_KINDS)[number];

/** `ck_stock_transfer_settlements_status`. Only a write-off is ever `pending`. */
export const TRANSFER_SETTLEMENT_STATES = Object.freeze(['pending', 'posted', 'rejected'] as const);
export type TransferSettlementState = (typeof TRANSFER_SETTLEMENT_STATES)[number];

/** `ck_material_requirements_status`. */
export const MATERIAL_REQUIREMENT_STATES = Object.freeze([
  'approval_required',
  'pending_approval',
  'approved',
  'rejected',
  'cancelled',
] as const);
export type MaterialRequirementState = (typeof MATERIAL_REQUIREMENT_STATES)[number];

/** `ck_material_requirements_basis`: a confirmed specification, or an entered value. */
export const MATERIAL_REQUIREMENT_BASES = Object.freeze(['specification', 'entered'] as const);
export type MaterialRequirementBasis = (typeof MATERIAL_REQUIREMENT_BASES)[number];

/** `ck_material_requirements_reason`. */
export const MATERIAL_APPROVAL_REQUIRED_REASONS = Object.freeze([
  'missing_specification',
  'missing_unit_conversion',
] as const);
export type MaterialApprovalRequiredReason = (typeof MATERIAL_APPROVAL_REQUIRED_REASONS)[number];

/** `ck_material_requirement_exceptions_status`. */
export const MATERIAL_EXCEPTION_STATES = Object.freeze([
  'pending',
  'approved',
  'rejected',
] as const);
export type MaterialExceptionState = (typeof MATERIAL_EXCEPTION_STATES)[number];

/** `ck_material_requests_status`. `closed` and `cancelled` are terminal. */
export const MATERIAL_REQUEST_STATES = Object.freeze(['open', 'closed', 'cancelled'] as const);
export type MaterialRequestState = (typeof MATERIAL_REQUEST_STATES)[number];

/**
 * Why a work-order draw on a requirement was refused. Every one is a state a person
 * can act on: ask for and approve a requirement, approve the one there is, add the
 * conversion or the specification, or request an exception for the excess.
 * `no_requirement` (P1-32-PRE-132): the work order has no requirement covering the
 * item at all — the absence of a requirement is a refusal, never an unlimited draw.
 */
export const MATERIAL_DRAW_REFUSAL_REASONS = Object.freeze([
  'exceeds_requirement',
  'approval_required',
  'missing_conversion',
  'missing_specification',
  'no_requirement',
] as const);
export type MaterialDrawRefusalReason = (typeof MATERIAL_DRAW_REFUSAL_REASONS)[number];

/**
 * Why a material REQUIREMENT write was refused, as a rule token on the wire
 * (DEF-T-16).
 *
 * A draw publishes `materialDraw.reason` with its figures. A requirement write
 * published nothing: `mapMaterialFailure` turned each database rule into a
 * status and a sentence, and `problemFor` reads the catalogue entry and the safe
 * details only, so the sentence never left the process. Asking twice for the same
 * part on the same service line therefore reached the operator as a bare
 * "This change cannot be saved" and a correlation reference.
 *
 * These are the tokens that failure carries instead, each in `violations` beside
 * the request part it belongs to — the same channel `duplicate_opening_cell`
 * already uses on `ERR-RES-002`. They name a RULE, never a record: no identifier,
 * no quantity and no name is in a token, so nothing here can leak what the caller
 * may not read.
 *
 * `material_demand_rule` is the honest residual. The database states many
 * distinct material rules through one check violation and this layer does not
 * parse their text beyond the three prefixes above it, so a rule it cannot name
 * is published as one it cannot name rather than as a guess.
 */
export const MATERIAL_REFUSAL_RULES = Object.freeze([
  'material_duplicate_demand',
  'material_separation_of_duties',
  'material_approval_required',
  'material_unknown_reference',
  'material_demand_rule',
] as const);
export type MaterialRefusalRule = (typeof MATERIAL_REFUSAL_RULES)[number];

/** `ck_item_unit_conversions_status`. */
export const UNIT_CONVERSION_STATES = Object.freeze(['active', 'retired'] as const);
export type UnitConversionState = (typeof UNIT_CONVERSION_STATES)[number];

/** `ck_vehicle_fluid_specifications_status`. Only `confirmed` resolves. */
export const VEHICLE_SPECIFICATION_STATES = Object.freeze([
  'recorded',
  'confirmed',
  'retired',
] as const);
export type VehicleSpecificationState = (typeof VEHICLE_SPECIFICATION_STATES)[number];

/** `ck_vehicle_fluid_specifications_condition_format` and its requirement twin. */
export const SERVICE_CONDITION_FORMAT = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * An exact conversion factor as a decimal string: `numeric(24,12)`, so at most twelve
 * integer and twelve fractional digits. Positivity is checked by the database.
 */
export const CONVERSION_FACTOR_FORMAT = /^\d{1,12}(\.\d{1,12})?$/;

/** Upper bounds on free text the reference data and requirements carry. */
export const MAX_SOURCE_REFERENCE = 500;
export const MAX_ENGINE_VARIANT = 100;

/** `ck_goods_receipts_status`. */
export const GOODS_RECEIPT_STATES = Object.freeze(['draft', 'posted', 'cancelled'] as const);
export type GoodsReceiptState = (typeof GOODS_RECEIPT_STATES)[number];

/** `ck_stock_counts_status`. */
export const STOCK_COUNT_STATES = Object.freeze([
  'open',
  'counting',
  'reconciled',
  'cancelled',
] as const);
export type StockCountState = (typeof STOCK_COUNT_STATES)[number];

/** `ck_stock_adjustments_status`. */
export const ADJUSTMENT_STATES = Object.freeze(['pending', 'approved', 'rejected'] as const);
export type AdjustmentState = (typeof ADJUSTMENT_STATES)[number];

/**
 * The two decisions a checker may record on a pending adjustment.
 *
 * Deliberately not `ADJUSTMENT_STATES`: `pending` is a state no decision can
 * produce, and offering it as one would make "decide nothing" a request the API
 * accepts and silently drops.
 */
export const ADJUSTMENT_DECISIONS = Object.freeze(['approved', 'rejected'] as const);
export type AdjustmentDecision = (typeof ADJUSTMENT_DECISIONS)[number];

/** `ck_item_cost_layers_source_kind`. */
export const COST_LAYER_SOURCE_KINDS = Object.freeze([
  'goods_receipt_line',
  'opening_line',
  'external_purchase',
] as const);
export type CostLayerSourceKind = (typeof COST_LAYER_SOURCE_KINDS)[number];

/** `ck_item_master_type`. */
export const ITEM_TYPES = Object.freeze([
  'part',
  'material',
  'consumable',
  'fluid',
  'kit',
] as const);
export type ItemType = (typeof ITEM_TYPES)[number];

/** `ck_item_master_lifecycle`. `archived` is terminal (`inv.guard_item_lifecycle`). */
export const ITEM_LIFECYCLE_STATES = Object.freeze(['active', 'archived'] as const);
export type ItemLifecycleState = (typeof ITEM_LIFECYCLE_STATES)[number];

/** `ck_opening_inventory_batches_status`. */
export const OPENING_BATCH_STATES = Object.freeze(['draft', 'approved'] as const);
export type OpeningBatchState = (typeof OPENING_BATCH_STATES)[number];

/** `ck_damaged_stock_disposition`. */
export const DAMAGE_DISPOSITIONS = Object.freeze([
  'quarantined',
  'scrapped',
  'returned_to_supplier',
] as const);
export type DamageDisposition = (typeof DAMAGE_DISPOSITIONS)[number];

/** `ck_customer_supplied_parts_custody`. */
export const CUSTODY_STATES = Object.freeze([
  'received',
  'in_use',
  'returned',
  'consumed',
] as const);
export type CustodyState = (typeof CUSTODY_STATES)[number];

/** `ck_external_purchase_parts_status`. */
export const EXTERNAL_PURCHASE_STATES = Object.freeze(['recorded', 'linked', 'cancelled'] as const);
export type ExternalPurchaseState = (typeof EXTERNAL_PURCHASE_STATES)[number];

/** `ck_item_identifiers_kind`. */
export const IDENTIFIER_KINDS = Object.freeze([
  'internal',
  'gtin',
  'ean',
  'upc',
  'manufacturer_part_number',
  'supplier_code',
] as const);
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

/**
 * The kinds a user may ENTER. `internal` is absent: an internal code is only ever
 * allocated by `inv.assign_internal_barcode`, and `inv.add_item_identifier` refuses it.
 */
export const ENTERABLE_IDENTIFIER_KINDS = Object.freeze([
  'gtin',
  'ean',
  'upc',
  'manufacturer_part_number',
  'supplier_code',
] as const);
export type EnterableIdentifierKind = (typeof ENTERABLE_IDENTIFIER_KINDS)[number];

/** `ck_item_identifiers_value_length`. */
export const MAX_IDENTIFIER_VALUE = 64;

/** The symbology a label printer should render a code in. A hint, not a contract. */
export const BARCODE_SYMBOLOGIES = Object.freeze([
  'code128',
  'ean13',
  'ean8',
  'upca',
  'itf14',
] as const);
export type BarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number];

/**
 * Chooses the symbology for a stored, already normalised code.
 *
 * The retail kinds are decided by LENGTH, because a GTIN may legally be 8, 12, 13 or
 * 14 digits and each length has its own symbology. Every internal or free-text code
 * is `code128`, which encodes the full alphanumeric set.
 */
export function barcodeSymbologyFor(kind: string, normalizedValue: string): BarcodeSymbology {
  if (kind === 'gtin' || kind === 'ean' || kind === 'upc') {
    switch (normalizedValue.length) {
      case 8:
        return 'ean8';
      case 12:
        return 'upca';
      case 13:
        return 'ean13';
      case 14:
        return 'itf14';
      default:
        return 'code128';
    }
  }
  return 'code128';
}

/** `ck_item_master_sku_format` — mixed case permitted for this external code. */
export const SKU_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;

/** `ck_stock_locations_code_format`. */
export const LOCATION_CODE_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;
/** `ck_item_categories_code_format` — the lower-snake internal code, unlike a SKU. */
export const CATEGORY_CODE_FORMAT = /^[a-z][a-z0-9_]{1,62}$/;

/** Column widths, so a caller gets a 422 rather than a driver truncation error. */
export const MAX_DESCRIPTION = 2000;
export const MAX_REASON = 2000;
export const MAX_NAME = 200;

// ---------------------------------------------------------------------------
// The movement/reference matrix (P1-21-BE-015).
// ---------------------------------------------------------------------------

/**
 * The only legal `(movement_type, reference_kind, direction)` combinations.
 *
 * Transcribed from `ck_stock_movements_type_direction` **and**
 * `inv.guard_stock_movement_provenance`, which together are the trust root. This
 * table exists so an invalid pairing is refused with a readable message before it
 * reaches the database, and so the mechanical matrix test has one source to walk.
 *
 * `damage` and `adjustment` legitimately appear twice: damage posts a paired
 * `out`/`in`, and an adjustment may correct in either direction.
 */
export const MOVEMENT_REFERENCE_MATRIX: readonly {
  readonly movementType: MovementType;
  readonly referenceKind: ReferenceKind;
  readonly direction: Direction;
}[] = Object.freeze([
  { movementType: 'opening', referenceKind: 'opening_line', direction: 'in' },
  { movementType: 'issue', referenceKind: 'part_issue', direction: 'out' },
  { movementType: 'return', referenceKind: 'part_return', direction: 'in' },
  { movementType: 'damage', referenceKind: 'damage', direction: 'out' },
  { movementType: 'damage', referenceKind: 'damage', direction: 'in' },
  { movementType: 'adjustment', referenceKind: 'adjustment', direction: 'in' },
  { movementType: 'adjustment', referenceKind: 'adjustment', direction: 'out' },
  // A transfer posts two pairs separated in time: the dispatch takes the quantity
  // out of the source cell and into transit, and the settlement takes it out of
  // transit and into either the destination (received) or the origin (cancelled).
  // Four rows, because each leg is a separate movement the ledger keeps forever.
  { movementType: 'transfer', referenceKind: 'transfer_dispatch', direction: 'out' },
  { movementType: 'transfer', referenceKind: 'transfer_dispatch', direction: 'in' },
  { movementType: 'transfer', referenceKind: 'transfer_receipt', direction: 'out' },
  { movementType: 'transfer', referenceKind: 'transfer_receipt', direction: 'in' },
  { movementType: 'receipt', referenceKind: 'goods_receipt_line', direction: 'in' },
  // A counter sale leaves the shelf once, at issuance, against the invoice line
  // that sold it. There is no `in` leg: stock comes back only as a sales return,
  // which is the row below and a separate act.
  { movementType: 'sale', referenceKind: 'invoice_line', direction: 'out' },
  { movementType: 'return', referenceKind: 'sales_return', direction: 'in' },
]);

/** True when the triple is one the protected schema will accept. */
export function isLegalMovementReference(
  movementType: string,
  referenceKind: string,
  direction: string
): boolean {
  return MOVEMENT_REFERENCE_MATRIX.some(
    (row) =>
      row.movementType === movementType &&
      row.referenceKind === referenceKind &&
      row.direction === direction
  );
}

/** Refuses an illegal triple before the provenance guard has to. */
export function assertLegalMovementReference(
  movementType: string,
  referenceKind: string,
  direction: string
): void {
  if (!isLegalMovementReference(movementType, referenceKind, direction)) {
    throw new InventoryRuleError(
      `movement ${movementType}/${direction} may not cite reference kind "${referenceKind}"; ` +
        'see the protected inv.guard_stock_movement_provenance matrix'
    );
  }
}

// ---------------------------------------------------------------------------
// Quantity — exact decimal, scale 3, from `numeric(12, 3)`.
// ---------------------------------------------------------------------------

/** `numeric(12, 3)`: 12 significant digits of which 3 are fractional. */
export const QUANTITY_PRECISION = 12;
export const QUANTITY_SCALE = 3;
/** 10^(12-3) − 10^-3, i.e. the largest representable value. */
export const QUANTITY_MAX = '999999999.999';
/** Every quantity CHECK in `inv` is `> 0`, so this is the smallest legal value. */
export const QUANTITY_MIN = '0.001';

/**
 * Accepts a plain decimal literal only.
 *
 * Scientific notation, a leading `+`, `NaN`, and `Infinity` are all refused
 * here rather than coerced — PostgreSQL would accept `1e3` for a numeric and
 * silently store 1000, which is a different number from the one a caller who
 * typed `1e3` by accident meant.
 */
const DECIMAL_LITERAL = /^-?\d{1,9}(\.\d{1,3})?$/;

/**
 * Zero as a `bigint`, built rather than written as `0n`.
 *
 * The project compiles to ES2017, where a BigInt *literal* is a syntax error even
 * though the `BigInt` function is available at runtime. Raising the target to reach
 * `0n` would change how every file in the repository is emitted, which is far more
 * than this value object needs.
 */
const ZERO = BigInt(0);

/**
 * An exact inventory quantity.
 *
 * Stored as a scaled integer (`BigInt` of thousandths) so comparison and
 * addition are exact, and rendered back to a fixed-scale decimal string for the
 * driver. There is deliberately no `toNumber()`: offering one would make the
 * lossy path the convenient path.
 */
export class Quantity {
  private constructor(private readonly thousandths: bigint) {}

  /** Parses an exact decimal string. Throws `InventoryRuleError` on anything else. */
  public static parse(raw: string, field = 'quantity'): Quantity {
    if (typeof raw !== 'string') {
      throw new InventoryRuleError(`${field} must be a decimal string, not a number`);
    }
    const text = raw.trim();
    if (text === '') {
      throw new InventoryRuleError(`${field} must not be blank`);
    }
    if (!DECIMAL_LITERAL.test(text)) {
      throw new InventoryRuleError(
        `${field} must be a plain decimal with at most ${QUANTITY_SCALE} decimal places ` +
          `and ${QUANTITY_PRECISION - QUANTITY_SCALE} integer digits (no exponent, no sign prefix)`
      );
    }
    const negative = text.startsWith('-');
    const unsigned = negative ? text.slice(1) : text;
    const [whole, fraction = ''] = unsigned.split('.');
    const scaled = BigInt(`${whole}${fraction.padEnd(QUANTITY_SCALE, '0')}`);
    return new Quantity(negative ? -scaled : scaled);
  }

  /**
   * Parses a value the database returned.
   *
   * `pg` hands back `numeric` as a string; a `number` here means someone
   * installed a type parser that already lost precision, so it is refused rather
   * than trusted.
   */
  public static fromDatabase(raw: unknown, field = 'quantity'): Quantity {
    if (typeof raw === 'string') return Quantity.parse(raw, field);
    throw new InventoryRuleError(
      `${field} came back from the database as ${typeof raw}; numeric must stay a string`
    );
  }

  public static readonly ZERO = new Quantity(ZERO);

  /** Rejects a quantity the protected schema would refuse. */
  public assertPostable(field = 'quantity'): this {
    if (this.thousandths <= ZERO) {
      throw new InventoryRuleError(
        `${field} must be strictly greater than zero; every inv quantity CHECK is "> 0"`
      );
    }
    if (this.thousandths > Quantity.parse(QUANTITY_MAX).thousandths) {
      throw new InventoryRuleError(`${field} exceeds numeric(12,3) (max ${QUANTITY_MAX})`);
    }
    return this;
  }

  public plus(other: Quantity): Quantity {
    return new Quantity(this.thousandths + other.thousandths);
  }

  public minus(other: Quantity): Quantity {
    return new Quantity(this.thousandths - other.thousandths);
  }

  public isGreaterThan(other: Quantity): boolean {
    return this.thousandths > other.thousandths;
  }

  public equals(other: Quantity): boolean {
    return this.thousandths === other.thousandths;
  }

  public get isPositive(): boolean {
    return this.thousandths > ZERO;
  }

  /** Fixed-scale decimal string, exactly what the `numeric(12,3)` column holds. */
  public toString(): string {
    const negative = this.thousandths < ZERO;
    const digits = (negative ? -this.thousandths : this.thousandths).toString().padStart(4, '0');
    const whole = digits.slice(0, -QUANTITY_SCALE);
    const fraction = digits.slice(-QUANTITY_SCALE);
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  public toJSON(): string {
    return this.toString();
  }
}

// ---------------------------------------------------------------------------
// Lifecycle rules the backend owns because the protected functions do not.
// ---------------------------------------------------------------------------

/**
 * A work order must be able to accept parts before stock is issued to it.
 *
 * `inv.issue_part` selects `wo.work_orders.state` and then never reads the
 * variable, so the protected function accepts an issue against a `draft` work
 * order (finding `P1-21-D-02`, reproduced against a live database). There is no
 * `allows_parts` flag on `wo.work_order_states`, so the rule is derived from the
 * flags that do exist: a work order that is closed, terminal, or not yet
 * accepting jobs is not accepting parts either.
 */
export function assertWorkOrderAcceptsParts(state: {
  readonly code: string;
  readonly isClosed: boolean;
  readonly isTerminal: boolean;
  readonly allowsJobs: boolean;
}): void {
  if (state.isClosed || state.isTerminal) {
    throw new InventoryRuleError(
      `work order state "${state.code}" is terminal or closed and cannot receive parts`
    );
  }
  if (!state.allowsJobs) {
    throw new InventoryRuleError(
      `work order state "${state.code}" does not yet allow work, so it cannot receive parts`
    );
  }
}

/**
 * A reservation may only be consumed by the issue it actually belongs to.
 *
 * `inv.issue_part` consumes whatever reservation id it is handed and releases
 * reserved quantity on an unrelated cell (finding `P1-21-D-03`, reproduced).
 * `fk_part_issues_reservation` constrains scope but not item, location, or work
 * order, so coherence is checked here.
 */
export function assertReservationMatchesIssue(
  reservation: {
    readonly id: string;
    readonly itemId: string;
    readonly locationId: string;
    readonly workOrderId: string | null;
    readonly status: string;
  },
  issue: { readonly itemId: string; readonly locationId: string; readonly workOrderId: string }
): void {
  if (reservation.status !== 'active') {
    throw new InventoryRuleError(
      `reservation ${reservation.id} is ${reservation.status} and cannot be consumed`
    );
  }
  if (reservation.itemId !== issue.itemId) {
    throw new InventoryRuleError(`reservation ${reservation.id} is for a different item`);
  }
  if (reservation.locationId !== issue.locationId) {
    throw new InventoryRuleError(`reservation ${reservation.id} is for a different stock location`);
  }
  if (reservation.workOrderId !== null && reservation.workOrderId !== issue.workOrderId) {
    throw new InventoryRuleError(`reservation ${reservation.id} belongs to a different work order`);
  }
}

/**
 * Damage must move stock out of a sellable location and in to a quarantine one.
 *
 * `ck_damaged_stock_locations` only requires the two locations to differ, so
 * without this a "damaged" unit could be moved into another sellable location and
 * stay available — the exact availability inflation P1-21-BE-008 must prevent.
 */
export function assertQuarantineDestination(
  from: { readonly id: string; readonly locationType: string },
  quarantine: { readonly id: string; readonly locationType: string }
): void {
  if (from.id === quarantine.id) {
    throw new InventoryRuleError('damage must move stock between two different locations');
  }
  if (quarantine.locationType !== 'quarantine') {
    throw new InventoryRuleError(
      `damaged stock must land in a quarantine location, not a ${quarantine.locationType}; ` +
        'otherwise damaged units stay sellable'
    );
  }
  if (from.locationType === 'quarantine') {
    throw new InventoryRuleError('stock already in quarantine cannot be damaged again');
  }
  // The quantity in a transit location is exactly what its open transfers will take
  // out on receipt. Damaging part of it would leave a transfer that can never be
  // received, because `inv.receive_transfer` must move the whole dispatched amount.
  if (from.locationType === 'transit') {
    throw new InventoryRuleError(
      'stock in transit cannot be recorded as damaged; receive or cancel the transfer first'
    );
  }
}

// ---------------------------------------------------------------------------
// Transfer and count rules the protected functions state less readably.
// ---------------------------------------------------------------------------

/**
 * A transfer moves stock between two sellable locations of ONE company.
 *
 * `inv.dispatch_transfer` refuses a cross-company pair too, but as a
 * `check_violation` whose message is not a caller-safe contract. The company rule
 * is not a convenience either: `inv.stock_transfers` carries ONE `company_id` for
 * both ends, so a cross-company transfer is unrepresentable rather than merely
 * refused.
 *
 * Quarantine and transit are excluded at both ends. Quarantined stock leaves
 * through an approved adjustment and a second person, so letting a transfer move it
 * to a sellable location in another branch would be a way around that rule; and a
 * transit location is the interval between two places, not a place.
 */
export function assertTransferEndpoints(
  from: { readonly id: string; readonly companyId: string; readonly locationType: string },
  to: { readonly id: string; readonly companyId: string; readonly locationType: string }
): void {
  if (from.id === to.id) {
    throw new InventoryRuleError('a transfer must move stock between two different locations');
  }
  if (from.companyId !== to.companyId) {
    throw new InventoryRuleError(
      'a transfer may not cross a company boundary; move the stock within one company'
    );
  }
  if (from.locationType === 'transit' || to.locationType === 'transit') {
    throw new InventoryRuleError(
      'a transit location holds transfers already under way and cannot be an endpoint of one'
    );
  }
  if (from.locationType === 'quarantine' || to.locationType === 'quarantine') {
    throw new InventoryRuleError(
      'quarantined stock leaves through an approved adjustment, not through a transfer'
    );
  }
}

/**
 * A stock count addresses a location whose quantities describe a shelf.
 *
 * Counting a transit location would compare a shelf against quantities that are by
 * definition on no shelf, and every line would read as a shortage.
 */
export function assertCountableLocation(location: {
  readonly locationCode: string;
  readonly locationType: string;
}): void {
  if (location.locationType === 'transit') {
    throw new InventoryRuleError(
      `stock location ${location.locationCode} holds transfers in transit and cannot be counted`
    );
  }
}
