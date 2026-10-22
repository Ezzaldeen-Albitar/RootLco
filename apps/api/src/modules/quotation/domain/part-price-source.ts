/**
 * Which authorised sales price a quotation part line is quoted at
 * (P1-32-PRE-OD-FD6, Owner decision D6 of 2026-09-30, ADR-023).
 *
 * D6: a part is quoted at an AUTHORISED SALES price, never at inventory cost.
 *
 * ## One source can price an item today
 *
 * The item selling price — `inv.item_sale_prices`, resolved by
 * `inv.resolve_item_sale_price` (the branch row, else the company row, else the
 * tenant-wide row) — is the only authorised sales-price source that can price an
 * ITEM. `svc.price_rules` cannot: its `service_id` is NOT NULL with a foreign key
 * to `svc.services`, and `svc.resolve_price` takes a service id. Counter sales are
 * priced from the same row, so a part costs a customer the same on a quotation and
 * at the counter of the same branch.
 *
 * ## Why a resolution step exists for one source
 *
 * So that a second source can never be added silently. The caller hands this
 * function EVERY authorised source's answer; it returns the price only when they
 * agree, and refuses when they disagree — it never picks one. Which source would
 * win if two could price the same part is a pricing-policy question for the Owner
 * (open question Q16, which applies only if price lists are ever extended to
 * items) and is deliberately not answered here.
 *
 * Pure: no database, no clock, no `Number` — prices are compared as exact decimal
 * strings.
 */

/** A source of authorised sales prices for an item. Only one exists today. */
export const PART_PRICE_SOURCES = ['item_sale_price'] as const;
export type PartPriceSource = (typeof PART_PRICE_SOURCES)[number];

/** One source's answer for one item at one branch. */
export interface AuthorisedPartPrice {
  readonly source: PartPriceSource;
  /** The row that priced it, captured on the line. */
  readonly priceRef: string;
  /** `numeric(18,4)` decimal STRING. */
  readonly unitPrice: string;
  readonly currency: string;
  /** The tax class the price names; `null` is untaxed. */
  readonly taxClassId: string | null;
}

/** The refusal rules, each a field rule the quotation line editor puts in words. */
export const PART_PRICE_REFUSALS = [
  'no_authorised_sale_price',
  'conflicting_authorised_sale_prices',
] as const;
export type PartPriceRefusal = (typeof PART_PRICE_REFUSALS)[number];

export type PartPriceResolution =
  | { readonly status: 'priced'; readonly price: AuthorisedPartPrice }
  | { readonly status: 'refused'; readonly rule: PartPriceRefusal };

/**
 * A decimal string in a canonical form, so `12.5` and `12.5000` compare equal.
 *
 * Leading zeros of the whole part and trailing zeros of the fraction are dropped;
 * a value that is not a plain non-negative decimal is returned unchanged, so it
 * can only ever compare equal to itself.
 */
function canonicalDecimal(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (match === null) return value;
  const whole = (match[1] ?? '0').replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

/** Whether two answers state the same price: amount, currency and tax treatment. */
function samePrice(a: AuthorisedPartPrice, b: AuthorisedPartPrice): boolean {
  return (
    canonicalDecimal(a.unitPrice) === canonicalDecimal(b.unitPrice) &&
    a.currency === b.currency &&
    a.taxClassId === b.taxClassId
  );
}

/**
 * The price a part line is quoted at, from every authorised source's answer.
 *
 *  - no source answered        → refused, `no_authorised_sale_price`;
 *  - one source answered       → that price;
 *  - several, all the same     → that price (the first answer's row is captured);
 *  - several that disagree     → refused, `conflicting_authorised_sale_prices` —
 *    never a silent choice between them.
 *
 * `null` entries are sources that hold no price for the item, and are ignored.
 * Cost is not a source and has no place in the input.
 */
export function resolveAuthorisedPartPrice(
  answers: readonly (AuthorisedPartPrice | null)[]
): PartPriceResolution {
  const found = answers.filter((answer): answer is AuthorisedPartPrice => answer !== null);
  const first = found[0];
  if (first === undefined) return { status: 'refused', rule: 'no_authorised_sale_price' };
  for (const other of found.slice(1)) {
    if (!samePrice(first, other)) {
      return { status: 'refused', rule: 'conflicting_authorised_sale_prices' };
    }
  }
  return { status: 'priced', price: first };
}

/**
 * The field rule a part line is refused with when its selling price or tax moved
 * while it was being quoted (P1-32-PRE-OD-FD6 follow-up).
 *
 * The service reads the item's selling price and its tax rate, then writes the
 * line; `quo.guard_quotation_part_line` re-reads both as the line is written and
 * admits it only at exactly what applies then. A price row added, replaced or
 * withdrawn — or a tax rate changed — between the two is therefore refused by the
 * guard, and that refusal is about the line's part, not a fault of the server.
 */
export const PART_PRICE_CHANGED = 'part_price_changed';

/**
 * The guard's tokens that mean the price or the tax applying to the part is no
 * longer the one the service read. Every other token of that guard is a defect of
 * the writer (a shape, a frozen snapshot) and stays a fault.
 */
const PART_PRICE_RACE_TOKENS: ReadonlySet<string> = new Set(['part_line_price', 'part_line_tax']);

/**
 * `part_price_changed` for a guard token that says the price or tax moved under
 * the write, else `null` — the caller then re-throws the error unchanged.
 */
export function partPriceRaceRule(guardToken: string | null): typeof PART_PRICE_CHANGED | null {
  return guardToken !== null && PART_PRICE_RACE_TOKENS.has(guardToken) ? PART_PRICE_CHANGED : null;
}
