/**
 * Pricing vocabulary and the discount arithmetic contract (Phase 1-20,
 * P1-20-BE-004…006).
 *
 * Constants are transcribed from CHECK constraints on the frozen `svc` schema.
 * The one piece of real logic here — `discountBaseExpression` — is deliberately a
 * SQL FRAGMENT rather than a TypeScript calculation, for the reason the whole
 * phase turns on: the authoritative arithmetic is PostgreSQL's, and a TypeScript
 * copy of it could disagree with the CHECK constraint that validates the result.
 */

import { Decimal, PERCENTAGE } from './decimal';

export class PricingRuleError extends Error {
  public override readonly name = 'PricingRuleError';
}

/** `ck_price_list_versions_status`. */
export const PRICE_LIST_VERSION_STATES = Object.freeze(['draft', 'published', 'archived'] as const);
export type PriceListVersionState = (typeof PRICE_LIST_VERSION_STATES)[number];

/** `ck_discount_rules_type_value`. */
export const DISCOUNT_TYPES = Object.freeze(['percentage', 'amount'] as const);
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** `ck_pricing_approval_policies_type`. */
export const APPROVAL_POLICY_TYPES = Object.freeze([
  'discount',
  'quotation_total',
  'price_override',
] as const);
export type ApprovalPolicyType = (typeof APPROVAL_POLICY_TYPES)[number];

/** `ck_pricing_approval_policies_kind`. */
export const THRESHOLD_KINDS = Object.freeze(['percentage', 'amount'] as const);
export type ThresholdKind = (typeof THRESHOLD_KINDS)[number];

/**
 * The `limit_type` used when reading `iam.approval_limits` for a discount.
 *
 * A named constant because the string has to match what an administrator typed
 * when they created the limit; a typo here silently means "no ceiling", which
 * fails closed but for the wrong reason.
 */
export const DISCOUNT_LIMIT_TYPE = 'discount';

/**
 * SQL for the discount base — the amount a percentage discount applies to.
 *
 * `ck_quotation_items_tax_amount` fixes the tax base as
 * `(unit_price * quantity) - discount`, so the discount itself must be computed
 * from `unit_price * quantity` **before** tax. This fragment is interpolated into
 * a parameterised statement with the caller's own placeholders; it contains no
 * user input, only the two placeholder names the caller passes.
 */
export function discountBaseExpression(unitPriceParam: string, quantityParam: string): string {
  return `(${unitPriceParam}::numeric * ${quantityParam}::numeric)`;
}

/**
 * Refuses a percentage outside `0..100`.
 *
 * Mirrors `ck_discount_rules_type_value`. Stated in the application so a caller
 * gets `ERR-VAL-001` naming the field, not a constraint violation.
 *
 * The bound is checked with the exact `Decimal` comparator, not `parseFloat`.
 * A percentage is a financial value: `parseFloat` would accept exponential
 * notation, silently round a 5th decimal place the column cannot hold, and
 * compare `100.00000000000001` as equal to `100`. Every one of those is a way
 * for an over-limit discount to slip past a ceiling check.
 */
export function assertPercentageRange(value: string, label: string): void {
  const parsed = Decimal.parse(value, PERCENTAGE);
  if (parsed.isNegative || parsed.greaterThan(Decimal.parse('100', PERCENTAGE))) {
    throw new PricingRuleError(`${label}: percentage must be between 0 and 100`);
  }
}

/**
 * A discount rule's applicability, checked before it may be used on a line.
 *
 * Every nullable column on `svc.discount_rules` is a WILDCARD: `company_id IS
 * NULL` means "any company". So a rule applies when each of its non-null
 * dimensions equals the line's. Getting this backwards — treating NULL as "no
 * match" — would make every tenant-wide discount unusable.
 */
export function discountRuleApplies(
  rule: {
    companyId: string | null;
    branchId: string | null;
    customerClass: string | null;
    serviceId: string | null;
  },
  line: {
    companyId: string;
    branchId: string;
    customerClass: string | null;
    serviceId: string | null;
  }
): boolean {
  if (rule.companyId !== null && rule.companyId !== line.companyId) return false;
  if (rule.branchId !== null && rule.branchId !== line.branchId) return false;
  if (rule.customerClass !== null && rule.customerClass !== line.customerClass) return false;
  if (rule.serviceId !== null && rule.serviceId !== line.serviceId) return false;
  return true;
}
