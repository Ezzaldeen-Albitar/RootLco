/**
 * Money and currency contracts (Phase 1-20, P1-20-BE-014).
 *
 * A bare `Decimal` is not money: `100.0000` means nothing until you know whether
 * it is JOD or USD, and the whole class of bugs this phase must not ship is the
 * one where two amounts in different currencies are added, compared, or quietly
 * treated as interchangeable.
 *
 * So money is always a pair, and every operation on a pair checks the currency
 * first and **fails deterministically** on a mismatch. There is no conversion
 * path in this file, on purpose: foreign exchange is out of scope for Phase 1,
 * and the way to guarantee no silent conversion is to make conversion
 * unexpressible rather than merely discouraged.
 */
import { Decimal, DecimalError, MONEY } from './decimal';

/**
 * ISO 4217 alphabetic code.
 *
 * Validated by shape only. The platform deliberately ships no currency table and
 * no jurisdiction defaults — a tenant's currency comes from its own price list
 * (`svc.price_lists.currency_code`, which is immutable once set), never from a
 * hard-coded country. Nothing here knows or cares which currency a pilot tenant
 * happens to use.
 */
const CURRENCY_CODE = /^[A-Z]{3}$/;

export class CurrencyMismatchError extends Error {
  public override readonly name = 'CurrencyMismatchError';
  public constructor(
    public readonly expected: string,
    public readonly actual: string,
    context: string
  ) {
    super(`${context}: currency ${actual} does not match ${expected}`);
  }
}

export function assertCurrencyCode(code: string): string {
  if (typeof code !== 'string' || !CURRENCY_CODE.test(code)) {
    throw new DecimalError(`currency: "${String(code)}" is not a three-letter ISO 4217 code`);
  }
  return code;
}

/**
 * An exact amount in a named currency.
 *
 * Immutable, and comparable only against the same currency. There is no `add`
 * or `multiply`: the authoritative sums and products are computed by PostgreSQL
 * in `numeric`, and offering them here would create a second, weaker engine that
 * could disagree with the CHECK constraints.
 */
export class Money {
  private constructor(
    public readonly amount: Decimal,
    public readonly currency: string
  ) {}

  /** Parses a client- or database-supplied decimal string in a given currency. */
  public static of(amount: string, currency: string): Money {
    return new Money(Decimal.parse(amount, MONEY), assertCurrencyCode(currency));
  }

  /** Wraps a value read out of a `numeric(18,4)` column. */
  public static fromDatabase(amount: string, currency: string): Money {
    return new Money(Decimal.fromDatabase(amount, MONEY), assertCurrencyCode(currency));
  }

  public static zero(currency: string): Money {
    return new Money(Decimal.zero(MONEY), assertCurrencyCode(currency));
  }

  /**
   * Throws unless `other` is in this currency.
   *
   * `context` names the comparison so the failure says *which* two things
   * disagreed — "quotation line 3" rather than an anonymous mismatch.
   */
  public assertSameCurrency(other: Money, context: string): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency, context);
    }
  }

  public compare(other: Money, context: string): -1 | 0 | 1 {
    this.assertSameCurrency(other, context);
    return this.amount.compare(other.amount);
  }

  public greaterThan(other: Money, context: string): boolean {
    return this.compare(other, context) > 0;
  }

  public get isZero(): boolean {
    return this.amount.isZero;
  }

  /** The wire shape: a decimal string plus an explicit currency, never a float. */
  public toJSON(): MoneyView {
    return { amount: this.amount.toString(), currency: this.currency };
  }
}

/**
 * How money crosses the API boundary.
 *
 * `amount` is a fixed-scale decimal STRING. This is not a stylistic choice: a
 * `numeric(18,4)` holds values IEEE-754 cannot represent, so a JSON number would
 * lose money for some inputs, and the loss would be silent and unrepeatable.
 * The same rule the repository already applies to `wo.rework_cost`.
 */
export interface MoneyView {
  readonly amount: string;
  readonly currency: string;
}

/** Renders a stored `numeric(18,4)` string and its currency as the wire shape. */
export function moneyView(amount: string, currency: string): MoneyView {
  return Money.fromDatabase(amount, currency).toJSON();
}
