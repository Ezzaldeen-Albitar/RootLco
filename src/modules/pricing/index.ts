/**
 * `pricing` module — public surface (Phase 1-20).
 *
 * The ONLY legal import path for this module (ADR-001): `@/modules/pricing`.
 *
 * ## What this module owns
 *
 * The pricing half of the `svc` schema — `price_lists`, `price_list_versions`,
 * `price_rules`, `price_list_assignments`, `discount_rules`,
 * `pricing_approval_policies` — plus the `org.tax_classes` / `org.tax_rates`
 * reads, which no other module performs.
 *
 * The catalog half of `svc` belongs to `@/modules/service-catalog`. The split is
 * by aggregate: a service and its price change for different reasons, under
 * different permissions, and never in one transaction.
 *
 * ## What it does NOT own
 *
 * `iam.approval_limits` and `iam.role_grants`. A discount ceiling is read through
 * `@/modules/iam`'s public surface, because a second reader would be a second
 * definition of which grant confers which authority.
 *
 * ## The exact-decimal contract
 *
 * `Decimal` and `Money` are exported because every module that touches money
 * needs them, and because having exactly one such type is the control. Neither
 * performs authoritative arithmetic — PostgreSQL `numeric` does, inside the same
 * expression shape the `quo.quotation_items` CHECK constraints validate. `Money`
 * exposes no `add`, `multiply`, or `convert`, so a silent currency conversion is
 * unexpressible rather than merely discouraged.
 */
import { composeModule } from '@/server/layering';
import { iamModule } from '@/modules/iam';
import { PricingRepository } from './data/pricing-repository';
import { PriceResolutionService } from './application/price-resolution-service';
import { DiscountAuthorizationService } from './application/discount-authorization-service';

export type {
  ApprovalPolicyRow,
  DiscountRuleRow,
  PriceListRow,
  PriceListVersionRow,
  ResolvedPriceRow,
  TaxRateRow,
} from './data/pricing-repository';

export type { PriceQuery, ResolvedPrice } from './application/price-resolution-service';
export type {
  ApprovalCeilingReader,
  DiscountAuthorization,
  DiscountRequest,
  PermissionProbe,
} from './application/discount-authorization-service';

export {
  Decimal,
  DecimalError,
  MINUTES,
  MONEY,
  PERCENTAGE,
  QUANTITY,
  TAX_RATE,
  parseNonNegative,
  parsePositive,
  type DecimalSpec,
} from './domain/decimal';

export {
  CurrencyMismatchError,
  Money,
  assertCurrencyCode,
  moneyView,
  type MoneyView,
} from './domain/money';

export {
  APPROVAL_POLICY_TYPES,
  DISCOUNT_LIMIT_TYPE,
  DISCOUNT_TYPES,
  PRICE_LIST_VERSION_STATES,
  PricingRuleError,
  THRESHOLD_KINDS,
  assertPercentageRange,
  discountBaseExpression,
  discountRuleApplies,
  type ApprovalPolicyType,
  type DiscountType,
  type PriceListVersionState,
  type ThresholdKind,
} from './domain/pricing';

/** Composition root: constructs the module's services once per process. */
export const pricingModule = composeModule({
  module: 'pricing',
  create: () => {
    const repository = new PricingRepository();
    return {
      prices: new PriceResolutionService(repository),
      // The ceiling reader is the iam module's own service, injected rather than
      // reached into: `DiscountAuthorizationService` depends on the narrow
      // `ApprovalCeilingReader` port, so it can be tested without iam and cannot
      // reach anything else on that surface.
      discounts: new DiscountAuthorizationService(repository, {
        callerApprovalCeiling: (db, companyId, limitType, asOf) =>
          iamModule().access.callerApprovalCeiling(db, companyId, limitType, asOf),
      }),
    };
  },
});
