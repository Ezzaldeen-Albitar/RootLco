/**
 * Decimal money, as strings, always.
 *
 * ## The rule
 *
 * A canonical business amount is a DECIMAL STRING and never becomes a
 * JavaScript number. Not on input, not on validation, not on display, not on
 * submit. `Number('100.9500')` is 100.95, and `0.1 + 0.2` is 0.30000000000000004
 * — an invoice total that has been through a double is no longer the invoice
 * total, and nothing downstream can tell that it changed.
 *
 * The backend stores `numeric(18,4)` and validates a CHECK constraint against
 * the exact value. This module's whole job is to get the operator's typing to
 * that constraint without a float in between, so:
 *
 *   - no `Number()`, no `parseFloat`, no `+value`, no `*`, `/`, `+`, `-`
 *   - no `toFixed`, which formats a double
 *   - comparison and scaling are done on the DIGITS
 *
 * `Intl.NumberFormat` appears exactly once, in `formatMoney`, and only to
 * produce text for a human to read. Its output is never parsed back.
 *
 * ## Scale
 *
 * Four decimal places, matching `numeric(18,4)`. A value with fewer is padded;
 * a value with more is a validation error rather than something to round,
 * because rounding money silently is how a total stops matching its lines.
 */

export const MONEY_SCALE = 4;
export const MAX_MONEY_PRECISION = 18;

/** ISO 4217, as published by the backend. Presentation only — never a rate. */
export type CurrencyCode = string;

export interface Money {
  /** Canonical decimal string, e.g. `"1234.5000"`. Never a number. */
  readonly amount: string;
  readonly currency: CurrencyCode;
}

/** Optional sign, digits, optional fraction. Nothing else — no exponent, no comma. */
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

export type MoneyProblem =
  'empty' | 'not-decimal' | 'too-many-decimals' | 'too-many-digits' | 'negative-zero';

export interface MoneyValidation {
  readonly ok: boolean;
  readonly problem?: MoneyProblem;
  /** The canonical form, present only when `ok`. */
  readonly canonical?: string;
}

/**
 * Validates and canonicalises typed input WITHOUT arithmetic.
 *
 * Padding and trimming are string operations on the fraction, so `"12.5"`
 * becomes `"12.5000"` by appending characters — not by multiplying by 10000.
 */
export function parseMoneyInput(raw: string): MoneyValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, problem: 'empty' };
  if (!DECIMAL.test(trimmed)) return { ok: false, problem: 'not-decimal' };

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = unsigned.split('.');

  if (fraction.length > MONEY_SCALE) return { ok: false, problem: 'too-many-decimals' };

  const significantWhole = whole.replace(/^0+(?=\d)/, '');
  if (significantWhole.length + MONEY_SCALE > MAX_MONEY_PRECISION) {
    return { ok: false, problem: 'too-many-digits' };
  }

  const padded = fraction.padEnd(MONEY_SCALE, '0');
  const isZero = /^0*$/.test(significantWhole) && /^0*$/.test(padded);
  // `-0.0000` is not a number a ledger should ever hold, and it compares equal
  // to `0.0000` while serialising differently.
  if (negative && isZero) return { ok: false, problem: 'negative-zero' };

  return {
    ok: true,
    canonical: `${negative ? '-' : ''}${significantWhole}.${padded}`,
  };
}

export function isCanonicalMoney(value: string): boolean {
  const result = parseMoneyInput(value);
  return result.ok && result.canonical === value;
}

/** Canonicalises, or throws. For code paths where a bad value is a defect. */
export function toCanonicalMoney(raw: string): string {
  const result = parseMoneyInput(raw);
  if (!result.ok || !result.canonical) {
    throw new Error(`not a canonical decimal amount: ${result.problem ?? 'unknown'}`);
  }
  return result.canonical;
}

/**
 * Compares two canonical amounts by their DIGITS.
 *
 * Returns -1, 0 or 1. Used for sorting and for range validation. A numeric
 * comparison would be correct for small values and quietly wrong for large
 * ones, which is the worst possible failure profile.
 */
export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const left = toCanonicalMoney(a);
  const right = toCanonicalMoney(b);
  const leftNegative = left.startsWith('-');
  const rightNegative = right.startsWith('-');
  if (leftNegative !== rightNegative) return leftNegative ? -1 : 1;

  const strip = (value: string) => value.replace('-', '').replace('.', '');
  const l = strip(left);
  const r = strip(right);
  const width = Math.max(l.length, r.length);
  const lp = l.padStart(width, '0');
  const rp = r.padStart(width, '0');

  if (lp === rp) return 0;
  const bigger = lp > rp;
  // Both negative: the larger magnitude is the smaller value.
  return (leftNegative ? !bigger : bigger) ? 1 : -1;
}

export function isZeroMoney(value: string): boolean {
  return /^-?0+\.0+$/.test(toCanonicalMoney(value));
}

export function isNegativeMoney(value: string): boolean {
  return toCanonicalMoney(value).startsWith('-') && !isZeroMoney(value);
}

/**
 * Formats for DISPLAY only.
 *
 * The output is text for a human: locale digits, locale grouping, and the ISO
 * code shown explicitly because a symbol is ambiguous across the currencies a
 * multi-company tenant may hold. It is never parsed back — `formatMoney` is a
 * one-way function and the canonical string remains the value of record.
 *
 * `Intl` takes a number, which is the one place a double is unavoidable. It is
 * safe here and only here: a rendering error of one ulp changes a pixel, not a
 * ledger. The canonical string is what gets submitted.
 */
export function formatMoney(money: Money, locale: string): string {
  const canonical = toCanonicalMoney(money.amount);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: MONEY_SCALE,
    useGrouping: true,
  }).format(displayNumber(canonical));
  return `${formatted} ${money.currency}`;
}

/**
 * The ONLY place a canonical amount becomes a number, isolated so it is easy to
 * find and easy to assert on. Nothing may call this except `formatMoney`.
 */
function displayNumber(canonical: string): number {
  return globalThis.Number(canonical);
}

/** Trims trailing zeros for compact display, still without arithmetic. */
export function trimTrailingZeros(canonical: string): string {
  const value = toCanonicalMoney(canonical);
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-' || trimmed === '' ? '0' : trimmed;
}
