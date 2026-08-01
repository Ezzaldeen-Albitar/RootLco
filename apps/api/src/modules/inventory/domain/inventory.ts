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
] as const);
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** `ck_stock_movements_reference_kind`. The complete legal business-reference set. */
export const REFERENCE_KINDS = Object.freeze([
  'opening_line',
  'part_issue',
  'part_return',
  'damage',
  'adjustment',
] as const);
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

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

/** `ck_stock_locations_type`. `quarantine` holds damaged stock. */
export const LOCATION_TYPES = Object.freeze(['warehouse', 'storage', 'quarantine'] as const);
export type LocationType = (typeof LOCATION_TYPES)[number];

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

/** `ck_item_master_sku_format` — mixed case permitted for this external code. */
export const SKU_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;

/** `ck_stock_locations_code_format`. */
export const LOCATION_CODE_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;

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
}
