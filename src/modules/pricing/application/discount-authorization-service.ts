/**
 * Discount authorization (Phase 1-20, P1-20-BE-006).
 *
 * Answers one question before a discount may go on a quotation line: *is this
 * actor allowed to give away this much?*
 *
 * Two independent gates, and both must pass:
 *
 *  1. **The policy threshold** — `svc.pricing_approval_policies` says how large a
 *     discount may be before it needs a specific permission. Under the threshold,
 *     any actor who may edit the quotation may apply it. At or over it, the actor
 *     must hold `required_permission_code`.
 *  2. **The actor's own ceiling** — `iam.approval_limits`, read through the iam
 *     module's public surface. A permission says *what kind* of thing you may
 *     approve; a limit says *how much*. Holding the permission does not raise the
 *     ceiling, and having a large ceiling does not grant the permission.
 *
 * ## Maker ≠ approver
 *
 * `maker_approver_distinct` defaults to `true` and is the invariant flag the
 * P1-10 contract names. When it is set, the actor requesting the discount may not
 * be the actor authorizing it — a request cannot grant its own approval. This
 * service refuses; it never quietly self-approves.
 *
 * ## Fail-closed
 *
 * No policy configured means the threshold is **zero**, not infinite: an
 * unconfigured tenant cannot discount without the permission. No ceiling
 * configured means **no authority**, not unlimited. Both defaults were chosen so
 * that a missing row can never widen access.
 */
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { Decimal, MONEY, PERCENTAGE } from '../domain/decimal';
import { Money } from '../domain/money';
import { DISCOUNT_LIMIT_TYPE, PricingRuleError } from '../domain/pricing';
import type { PricingRepository } from '../data/pricing-repository';

/** Reads the caller's ceiling. Satisfied by the `iam` module's public surface. */
export interface ApprovalCeilingReader {
  callerApprovalCeiling(
    db: DbHandle,
    companyId: string,
    limitType: string,
    asOf: string
  ): Promise<{ amount: string; currencyCode: string } | null>;
}

/** Checks whether the CALLER holds a permission code. Supplied by the route. */
export type PermissionProbe = (permissionCode: string) => Promise<boolean>;

export interface DiscountRequest {
  readonly companyId: string;
  readonly branchId: string;
  /** The discount amount in the line's currency, as a `numeric(18,4)` STRING. */
  readonly discountAmount: string;
  readonly currency: string;
  /** `(unit_price * quantity)` for the line — the base a percentage applies to. */
  readonly lineBase: string;
  readonly asOf: string;
  /**
   * Who asked for the discount, when that is someone other than the caller.
   * `null` when the caller is both maker and approver, which
   * `maker_approver_distinct` then refuses.
   */
  readonly requestedBy: string | null;
  /** The caller's own user id, for the maker≠approver comparison. */
  readonly actorId: string;
}

export interface DiscountAuthorization {
  readonly authorized: true;
  /** Whether clearing the policy threshold required the elevated permission. */
  readonly requiredElevatedPermission: boolean;
  readonly permissionCode: string | null;
  /** The ceiling that was checked, for the audit record. `null` when none applied. */
  readonly ceiling: { amount: string; currency: string } | null;
}

export class DiscountAuthorizationService {
  public constructor(
    private readonly repository: PricingRepository,
    private readonly ceilings: ApprovalCeilingReader
  ) {}

  /**
   * Authorizes a discount, or throws.
   *
   * Returns a record of *why* it was allowed so the caller can put that in the
   * audit trail — "authorized" with no reason is not an auditable fact.
   */
  public async authorize(
    db: DbHandle,
    request: DiscountRequest,
    hasPermission: PermissionProbe
  ): Promise<DiscountAuthorization> {
    const discount = Decimal.parse(request.discountAmount, MONEY);
    if (discount.isNegative) {
      throw new AppFailure('ERR-VAL-001', { message: 'A discount may not be negative' });
    }
    const base = Decimal.parse(request.lineBase, MONEY);
    if (discount.greaterThan(base)) {
      // Mirrors `ck_quotation_items_discount`, refused here so the caller gets a
      // field-level message rather than a constraint violation.
      throw new AppFailure('ERR-VAL-001', {
        message: 'A discount may not exceed the line total before tax',
      });
    }
    if (discount.isZero) {
      // Nothing is being given away, so there is nothing to authorize. Returning
      // early keeps a zero discount from demanding a configured policy.
      return {
        authorized: true,
        requiredElevatedPermission: false,
        permissionCode: null,
        ceiling: null,
      };
    }

    const policy = await this.repository.findApprovalPolicy(
      db,
      request.companyId,
      'discount',
      request.asOf
    );

    // No policy → threshold zero → any non-zero discount needs the elevated
    // permission. Fail-closed: an unconfigured tenant cannot discount freely.
    const overThreshold =
      policy === null || this.exceedsThreshold(policy, discount, base, request.currency);

    let permissionCode: string | null = null;
    if (overThreshold) {
      permissionCode = policy?.requiredPermissionCode ?? 'svc.price.manage';
      if (!(await hasPermission(permissionCode))) {
        throw new AppFailure('ERR-IAM-001', {
          message: `Authorizing this discount requires ${permissionCode}`,
        });
      }
      if (policy?.makerApproverDistinct === true && request.requestedBy === request.actorId) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'This company requires the approver of a discount to be someone other than the ' +
            'person who requested it',
        });
      }
    }

    const ceiling = await this.ceilings.callerApprovalCeiling(
      db,
      request.companyId,
      DISCOUNT_LIMIT_TYPE,
      request.asOf
    );

    if (overThreshold) {
      if (ceiling === null) {
        throw new AppFailure('ERR-IAM-001', {
          message: 'You have no discount approval limit for this company',
        });
      }
      const allowed = Money.of(ceiling.amount, ceiling.currencyCode);
      const requested = Money.of(request.discountAmount, request.currency);
      // Currency mismatch here is a hard refusal, never a conversion: a ceiling
      // denominated in another currency does not authorize this discount at all.
      if (requested.greaterThan(allowed, 'discount approval limit')) {
        throw new AppFailure('ERR-IAM-001', {
          message: 'The discount exceeds your approval limit',
        });
      }
    }

    return {
      authorized: true,
      requiredElevatedPermission: overThreshold,
      permissionCode,
      ceiling: ceiling === null ? null : { amount: ceiling.amount, currency: ceiling.currencyCode },
    };
  }

  /**
   * Whether the discount reaches the policy threshold.
   *
   * `threshold_kind` decides what the number means: `amount` compares money to
   * money in the policy's own currency, `percentage` compares the discount's
   * share of the line base. A policy denominated in another currency cannot be
   * compared to this discount, and is treated as **exceeded** — the fail-closed
   * reading, because the alternative would let a mismatched currency wave a
   * large discount through.
   */
  private exceedsThreshold(
    policy: {
      thresholdKind: string;
      thresholdValue: string;
      currencyCode: string | null;
    },
    discount: Decimal,
    base: Decimal,
    currency: string
  ): boolean {
    if (policy.thresholdKind === 'amount') {
      if (policy.currencyCode !== currency) return true;
      return !discount.lessThan(Decimal.parse(policy.thresholdValue, MONEY));
    }
    if (policy.thresholdKind === 'percentage') {
      // `base` cannot be zero here: `authorize` returns early on a zero discount
      // and refuses any discount greater than the base, so reaching this line
      // means `base >= discount > 0`. A zero-base guard would be unreachable
      // code, and unreachable code is a claim nothing tests.
      // Compare `discount / base` against `threshold / 100` WITHOUT dividing, by
      // cross-multiplying: `discount * 100 >= threshold * base`. Division would
      // introduce a rounding decision the schema does not define, and this keeps
      // the comparison exact.
      return !crossMultiplyLess(discount, base, Decimal.parse(policy.thresholdValue, PERCENTAGE));
    }
    throw new PricingRuleError(`Unknown approval threshold kind "${policy.thresholdKind}"`);
  }
}

/**
 * True when `discount / base < threshold / 100`, computed exactly.
 *
 * Cross-multiplied rather than divided: `discount / base < threshold / 100`
 * becomes `discount * 100 < threshold * base`. Division would force a rounding
 * decision the schema does not define, and any rounding here would be a business
 * rule we are not authorized to invent.
 *
 * Each `Decimal` carries units of `10 ** scale`, so substituting
 * `value = units / 10 ** scale` and clearing denominators gives
 *
 *     units(d) * 100 * 10 ** (scale(t) + scale(b) - scale(d))  <  units(t) * units(b)
 *
 * The exponent is DERIVED from the operands' own scales rather than assuming all
 * three are `numeric(_,4)`. They happen to be today; a future column with a
 * different scale would silently skew a hard-coded version of this comparison,
 * and skewing it is exactly how an over-limit discount would pass.
 */
function crossMultiplyLess(discount: Decimal, base: Decimal, thresholdPercent: Decimal): boolean {
  const shift = thresholdPercent.scale + base.scale - discount.scale;
  // `shift` is non-negative for every spec in `decimal.ts` (money/percentage are
  // both 4, so it is exactly 4). Handle the other direction rather than trusting
  // that, so the identity holds whichever side needs scaling.
  const left = discount.scaledUnits * BigInt(100);
  const right = thresholdPercent.scaledUnits * base.scaledUnits;
  return shift >= 0 ? left * pow10(shift) < right : left < right * pow10(-shift);
}

/** `10 ** n` as an exact `bigint`. */
function pow10(n: number): bigint {
  let out = BigInt(1);
  for (let i = 0; i < n; i += 1) out *= BigInt(10);
  return out;
}
