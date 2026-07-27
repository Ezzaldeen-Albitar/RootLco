/**
 * Exact decimal value object (Phase 1-20, P1-20-BE-014).
 *
 * ## Why this exists at all
 *
 * PostgreSQL `numeric` is the authoritative financial engine for this platform.
 * Every amount P1-20 stores is computed by the database, in `numeric` arithmetic,
 * inside the same expression shape the CHECK constraints on `quo.quotation_items`
 * enforce — so the database validates its own output and a wrong TypeScript
 * calculation cannot be persisted.
 *
 * This type is therefore deliberately NOT a calculation engine. It exists to do
 * the three things the boundary needs and the database cannot do for us:
 *
 *  1. **Parse and validate** a client-supplied decimal string against the exact
 *     precision and scale of the target column, before it reaches SQL.
 *  2. **Compare** amounts (against a discount ceiling, an approval threshold)
 *     without ever materialising an IEEE-754 double.
 *  3. **Serialize** deterministically, so the same stored value always crosses
 *     the API as the same string.
 *
 * ## Why scaled `bigint` and not a dependency
 *
 * `package.json` has no decimal library and the instruction forbids adding one
 * without cause. A `bigint` scaled by a fixed power of ten is exact for every
 * value the protected columns can hold, needs no dependency, and cannot silently
 * lose a digit the way `number` does. `pg` already returns `numeric` (OID 1700)
 * as a string and this repository never overrides that with `setTypeParser`, so
 * a database value arrives here without having passed through a double.
 *
 * ## The scales in force, read off the live catalog
 *
 * | Column                                   | Type            |
 * | ---------------------------------------- | --------------- |
 * | money (`captured_unit_price`, `amount`)  | `numeric(18,4)` |
 * | quantity (`captured_quantity`)           | `numeric(12,3)` |
 * | tax rate (`captured_tax_rate`, `rate`)   | `numeric(9,6)`  |
 * | labour minutes (`standard_minutes`)      | `numeric(10,2)` |
 *
 * A value that does not fit its column is rejected here with a precise message
 * rather than surfacing as a driver-level `numeric field overflow`.
 */

/** Precision/scale of a protected `numeric` column. */
export interface DecimalSpec {
  /** Total significant digits — the `p` in `numeric(p, s)`. */
  readonly precision: number;
  /** Digits after the point — the `s` in `numeric(p, s)`. */
  readonly scale: number;
  /** Used in error messages so a caller learns which column refused the value. */
  readonly label: string;
}

/** `numeric(18,4)` — every money column in `svc` and `quo`. */
export const MONEY: DecimalSpec = Object.freeze({ precision: 18, scale: 4, label: 'money' });
/** `numeric(12,3)` — `quo.quotation_items.captured_quantity`. */
export const QUANTITY: DecimalSpec = Object.freeze({ precision: 12, scale: 3, label: 'quantity' });
/** `numeric(9,6)` — `org.tax_rates.rate` and `captured_tax_rate`, a FRACTION in [0,1]. */
export const TAX_RATE: DecimalSpec = Object.freeze({ precision: 9, scale: 6, label: 'tax rate' });
/** `numeric(10,2)` — `svc.standard_labor_times.standard_minutes`. */
export const MINUTES: DecimalSpec = Object.freeze({ precision: 10, scale: 2, label: 'minutes' });
/** `numeric(18,4)` used as a percentage in `0..100` — `svc.discount_rules.value`. */
export const PERCENTAGE: DecimalSpec = Object.freeze({
  precision: 18,
  scale: 4,
  label: 'percentage',
});

export class DecimalError extends Error {
  public override readonly name = 'DecimalError';
}

/**
 * A plain decimal literal: optional sign, digits, optional fractional part.
 *
 * Exponential notation is **rejected**, not normalised. `1e3` in a money field is
 * far more likely to be a client bug or a probe than an intentional 1000, and
 * accepting it would mean this type's input language is wider than the column's
 * printed form. The refusal is asserted in the abuse-case tests.
 */
const DECIMAL_LITERAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/**
 * `BigInt(...)` calls rather than `0n`/`10n` literals.
 *
 * `tsconfig.json` targets ES2017 and TypeScript gates the literal *syntax* on
 * ES2020, while the `BigInt` global itself comes from the `esnext` lib and is
 * present on the Node 22 runtime. Constructing the values keeps this module
 * compiling without widening the build target for the whole application — a
 * change with a large blast radius and no benefit here.
 */
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);

function pow10(n: number): bigint {
  let out = ONE;
  for (let i = 0; i < n; i += 1) out *= TEN;
  return out;
}

/**
 * An exact decimal, carried as an integer scaled by `10 ** scale`.
 *
 * Immutable. Two instances are equal when they represent the same mathematical
 * value at the same scale; `equals` compares across scales by rescaling, so
 * `1.5` at scale 4 equals `1.5` at scale 6.
 */
export class Decimal {
  private constructor(
    /** The value multiplied by `10 ** scale`. */
    private readonly units: bigint,
    private readonly spec: DecimalSpec
  ) {}

  /**
   * Parses a decimal string against a column spec.
   *
   * Rejects, with a message naming the spec: a non-literal (including `NaN`,
   * `Infinity`, exponential notation, whitespace, and the empty string), more
   * fractional digits than the column's scale, and more total digits than its
   * precision. Trailing zeros within scale are accepted and normalised, because
   * `1.50` and `1.5` are the same money.
   */
  public static parse(input: string, spec: DecimalSpec): Decimal {
    if (typeof input !== 'string' || !DECIMAL_LITERAL.test(input)) {
      throw new DecimalError(
        `${spec.label}: "${String(input)}" is not a plain decimal literal (exponential notation is not accepted)`
      );
    }
    const negative = input.startsWith('-');
    const magnitude = negative ? input.slice(1) : input;
    const dot = magnitude.indexOf('.');
    const whole = dot === -1 ? magnitude : magnitude.slice(0, dot);
    const fraction = dot === -1 ? '' : magnitude.slice(dot + 1);

    if (fraction.length > spec.scale) {
      throw new DecimalError(
        `${spec.label}: "${input}" has ${fraction.length} decimal places but the column holds ${spec.scale}`
      );
    }
    const padded = fraction.padEnd(spec.scale, '0');
    // `whole` is already free of leading zeros by the literal pattern, so its
    // length IS its digit count — except for a lone "0", which contributes none.
    const wholeDigits = whole === '0' ? 0 : whole.length;
    if (wholeDigits + spec.scale > spec.precision) {
      throw new DecimalError(
        `${spec.label}: "${input}" needs ${wholeDigits + spec.scale} digits but the column holds ${spec.precision}`
      );
    }
    const units = BigInt(whole + padded);
    return new Decimal(negative ? -units : units, spec);
  }

  /**
   * Wraps a value that came OUT of the database.
   *
   * Separate from `parse` because the intent differs: a stored value has already
   * satisfied the column, so a failure here is a schema-drift bug rather than bad
   * input, and the message says so.
   */
  public static fromDatabase(input: string, spec: DecimalSpec): Decimal {
    try {
      return Decimal.parse(input, spec);
    } catch (cause) {
      throw new DecimalError(
        `${spec.label}: stored value "${input}" does not fit its own column — schema drift`
      );
    }
  }

  /** The additive identity at this spec's scale. */
  public static zero(spec: DecimalSpec): Decimal {
    return new Decimal(ZERO, spec);
  }

  public get isZero(): boolean {
    return this.units === ZERO;
  }

  public get isNegative(): boolean {
    return this.units < ZERO;
  }

  /** `-1`, `0`, or `1`. Rescales to the finer of the two scales first. */
  public compare(other: Decimal): -1 | 0 | 1 {
    const scale = Math.max(this.spec.scale, other.spec.scale);
    const a = this.units * pow10(scale - this.spec.scale);
    const b = other.units * pow10(scale - other.spec.scale);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  public equals(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  public lessThan(other: Decimal): boolean {
    return this.compare(other) < 0;
  }

  public greaterThan(other: Decimal): boolean {
    return this.compare(other) > 0;
  }

  /**
   * Canonical string form, always carrying exactly `scale` decimal places.
   *
   * Fixed-width rather than shortest-form so a value round-trips through the API
   * unchanged and two equal amounts are byte-equal on the wire.
   */
  public toString(): string {
    const negative = this.units < ZERO;
    const digits = (negative ? -this.units : this.units)
      .toString()
      .padStart(this.spec.scale + 1, '0');
    const cut = digits.length - this.spec.scale;
    const whole = digits.slice(0, cut);
    const fraction = digits.slice(cut);
    const body = this.spec.scale === 0 ? whole : `${whole}.${fraction}`;
    return negative ? `-${body}` : body;
  }

  /** JSON serialization is the canonical string — never a float. */
  public toJSON(): string {
    return this.toString();
  }
}

/**
 * Parses a decimal that must not be negative, e.g. a price or a discount.
 *
 * A separate helper rather than a flag because "must be a decimal" and "must not
 * be negative" are different refusals and the caller should not have to remember
 * to check the second.
 */
export function parseNonNegative(input: string, spec: DecimalSpec): Decimal {
  const value = Decimal.parse(input, spec);
  if (value.isNegative) {
    throw new DecimalError(`${spec.label}: "${input}" must not be negative`);
  }
  return value;
}

/** Parses a decimal that must be strictly greater than zero, e.g. a quantity. */
export function parsePositive(input: string, spec: DecimalSpec): Decimal {
  const value = parseNonNegative(input, spec);
  if (value.isZero) {
    throw new DecimalError(`${spec.label}: "${input}" must be greater than zero`);
  }
  return value;
}
