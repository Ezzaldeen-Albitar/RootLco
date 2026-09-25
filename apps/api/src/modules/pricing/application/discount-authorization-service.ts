/**
 * Discount authorization (Phase 1-20, P1-20-BE-006; two-step since
 * P1-32-PRE-OD-DISC-01).
 *
 * Answers two questions, at two different moments, asked of two different people.
 *
 *  1. **When the discount is asked for — does it need approval?** `assess` measures
 *     the discount against the company's policy in force at that moment
 *     (`svc.pricing_approval_policies`). Under the threshold, anyone who may edit
 *     the quotation may apply it. At or over it, the discount is recorded as a
 *     PENDING request, and the policy version it was measured against is returned
 *     so the caller can snapshot it. Nothing about the requester's own authority is
 *     checked here: asking is not approving. A quotation is held to the policy
 *     version the database pinned when it was written, so the caller PINS that
 *     version and the discount is measured against it instead of the policy in
 *     force (P1-32-PRE-OD-DISC-07): a threshold change reaches only quotations
 *     written after it, and no revision of an existing quotation can reach it.
 *
 *  2. **When somebody approves it — may THIS person approve it?** `authorizeApproval`
 *     is called by the approver, against the snapshot. Three gates, all of which must
 *     pass:
 *
 *     - **Separation of duties.** The approver is never the requester. The requester
 *       is the person who created the revision, recorded by the server — the client
 *       cannot name one. There is no sole-administrator exception and no
 *       configuration that switches it off; `maker_approver_distinct` is a legacy
 *       column that nothing reads.
 *     - **The permission** the snapshotted policy names (`svc.price.manage` when the
 *       company had none) — the ONLY approval permission: the decision route itself is
 *       gated by the quotation read code.
 *     - **The approver's own limit** — `iam.approval_limits`, read through the
 *       foundation helper `callerApprovalCeiling` in `@/server/auth/authorization`,
 *       NOT through `@/modules/iam`. That helper records why routing it through the
 *       iam module was rejected. It never counts a limit the approver created, for
 *       their own account or for a role they hold.
 *
 *     A permission says *what kind* of thing you may approve; a limit says *how
 *     much*. Holding the permission does not raise the limit, and having a large
 *     limit does not grant the permission.
 *
 * ## Fail-closed
 *
 * No policy configured means the threshold is **zero**, not infinite: an
 * unconfigured company needs approval for every non-zero discount. No limit means
 * **no authority**, not unlimited. Both defaults were chosen so that a missing row
 * can never widen access.
 */
import type { DbHandle } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { Decimal, MONEY, PERCENTAGE } from '../domain/decimal';
import { CurrencyMismatchError, Money } from '../domain/money';
import { DISCOUNT_LIMIT_TYPE, PricingRuleError, assertPercentageRange } from '../domain/pricing';
import type { PricingRepository } from '../data/pricing-repository';

/** Reads the caller's ceiling. Satisfied by `callerApprovalCeiling` (foundation). */
export interface ApprovalCeilingReader {
  callerApprovalCeiling(
    db: DbHandle,
    companyId: string,
    limitType: string,
    asOf: string
  ): Promise<{ amount: string; currencyCode: string } | null>;
}

/**
 * Checks whether the CALLER holds a permission code.
 *
 * Supplied by the calling APPLICATION service, not the route — the quotation
 * module binds it to the quotation's own company and branch. A route-supplied probe
 * would be a B11 violation, and it would also have to read a scope from the
 * request, which is the bypass this phase spent its authorization budget removing.
 */
export type PermissionProbe = (permissionCode: string) => Promise<boolean>;

/** The permission an approver needs when the company has configured no policy. */
export const DEFAULT_DISCOUNT_APPROVAL_PERMISSION = 'svc.price.manage';

/** What is asked for, measured against the policy in force. */
export interface DiscountAssessmentRequest {
  readonly companyId: string;
  /** The discount amount in the line's currency, as a `numeric(18,4)` STRING. */
  readonly discountAmount: string;
  readonly currency: string;
  /** `(unit_price * quantity)` for the line — the base a percentage applies to. */
  readonly lineBase: string;
  readonly asOf: string;
}

/**
 * The policy version a request was measured against.
 *
 * `null` in `DiscountAssessment.threshold` means **no policy row existed**, which is
 * not the same as "no threshold": an unconfigured company is treated as threshold
 * zero, so a null beside `requiresApproval: true` says the discount needs approval
 * *because nothing was configured*.
 */
export interface DiscountThresholdSnapshot {
  readonly policyId: string;
  readonly versionNo: number;
  readonly kind: string;
  readonly value: string;
  readonly currency: string | null;
}

/**
 * The policy version a quotation is held to for its whole life, pinned by the
 * database when the quotation was written (P1-32-PRE-OD-DISC-07).
 *
 * `threshold: null` is the snapshot of "nothing was configured" — a threshold of
 * zero — and is NOT the same as passing no pin at all, which measures against the
 * policy in force.
 */
export interface PinnedDiscountPolicy {
  readonly threshold: DiscountThresholdSnapshot | null;
  /** The permission an approver of a request under this version must hold. */
  readonly permissionCode: string;
}

export interface DiscountAssessment {
  /** Whether this discount must be approved by somebody other than the requester. */
  readonly requiresApproval: boolean;
  /** The permission an approver must hold. `null` when no approval is required. */
  readonly permissionCode: string | null;
  readonly threshold: DiscountThresholdSnapshot | null;
}

/** An approval being given, against the snapshot recorded with the request. */
export interface DiscountApprovalRequest {
  readonly companyId: string;
  /** The recorded discount total, `numeric(18,4)` STRING, in `currency`. */
  readonly discountAmount: string;
  readonly currency: string;
  /** The approver's business date: the limit that counts is the one in force now. */
  readonly asOf: string;
  /** Recorded by the server when the discount was asked for. */
  readonly requestedBy: string;
  /** The signed-in approver. */
  readonly approverId: string;
  /** Copied from the policy version the request was measured against. */
  readonly requiredPermissionCode: string;
}

export interface DiscountApprovalAuthorization {
  /** The approver's limit that the discount was within, for the record. */
  readonly ceiling: { readonly amount: string; readonly currency: string };
}

/**
 * Why a person may not approve a recorded discount, named so the screen can say it
 * without showing any amount: their own request, a missing permission, no limit that
 * counts (or only one in another currency), or a limit below the discount.
 */
export type DiscountApprovalBlock =
  | 'discount_approver_must_differ'
  | 'discount_approval_permission_missing'
  | 'discount_no_approval_limit'
  | 'discount_limit_currency_mismatch'
  | 'discount_over_approval_limit';

/** Whether the signed-in person could approve a request, and if not, why. */
export type DiscountApprovalStanding =
  | { readonly canApprove: true; readonly ceiling: DiscountApprovalAuthorization['ceiling'] }
  | {
      readonly canApprove: false;
      readonly block: DiscountApprovalBlock;
      /** Set for a currency mismatch so the refusal can name the limit's currency. */
      readonly ceilingCurrency?: string;
      /** The `CurrencyMismatchError` behind a currency mismatch, kept for the log. */
      readonly cause?: unknown;
    };

/**
 * Memo for one read of many requests: the caller's ceiling per company, read once.
 * Keyed by `companyId|asOf`.
 */
export type ApprovalCeilingMemo = Map<
  string,
  Promise<{ amount: string; currencyCode: string } | null>
>;

/** A named refusal the screen can put next to the decision. */
function refuse(rule: string, message: string, path = 'body'): never {
  throw new AppFailure('ERR-IAM-001', {
    message,
    safeDetails: { violations: [{ path, rule }] },
  });
}

/**
 * The permission a decision consults: the one the snapshot recorded.
 *
 * The code is a value copied from a policy version, so no operation declaration can
 * name it; it is proven instead by the foreign keys on
 * `svc.pricing_approval_policies.required_permission_code` and
 * `quo.discount_approvals.required_permission_code`, both into `iam.permissions`.
 * The fallback is the literal an unconfigured company's request records.
 */
function snapshotPermission(requiredPermissionCode: string): string {
  return requiredPermissionCode || DEFAULT_DISCOUNT_APPROVAL_PERMISSION;
}

/**
 * The ONE place a decision asks whether the caller holds the recorded permission —
 * approving and turning down alike — so the permission-parity gate sees a single
 * declared dynamic site.
 */
function holdsSnapshotPermission(
  requiredPermissionCode: string,
  hasPermission: PermissionProbe
): Promise<boolean> {
  return hasPermission(snapshotPermission(requiredPermissionCode));
}

export class DiscountAuthorizationService {
  public constructor(
    private readonly repository: PricingRepository,
    private readonly ceilings: ApprovalCeilingReader
  ) {}

  /**
   * Whether a discount needs approval under the policy in force on `asOf`.
   *
   * Refuses only what is malformed — a negative discount, or one larger than the
   * line — because those are wrong whoever approves them. Everything else is an
   * answer, never a refusal: a discount that needs approval is recorded as a
   * request, not rejected.
   */
  public async assess(
    db: DbHandle,
    request: DiscountAssessmentRequest,
    pinned?: PinnedDiscountPolicy
  ): Promise<DiscountAssessment> {
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
      // Nothing is being given away, so there is nothing to approve. Returning
      // early keeps a zero discount from demanding a configured policy.
      return { requiresApproval: false, permissionCode: null, threshold: null };
    }

    if (pinned !== undefined) {
      /**
       * Measured against the version the quotation is held to, never the policy in
       * force: a threshold changed after the quotation was written must not reach it,
       * however it is revised (P1-32-PRE-OD-DISC-07).
       */
      const snapshot = pinned.threshold;
      const needs =
        snapshot === null ||
        this.exceedsThreshold(
          {
            thresholdKind: snapshot.kind,
            thresholdValue: snapshot.value,
            currencyCode: snapshot.currency,
          },
          discount,
          base,
          request.currency
        );
      return {
        requiresApproval: needs,
        permissionCode: needs ? pinned.permissionCode : null,
        threshold: snapshot,
      };
    }

    const policy = await this.repository.findApprovalPolicy(
      db,
      request.companyId,
      'discount',
      request.asOf
    );

    // No policy → threshold zero → any non-zero discount needs approval.
    // Fail-closed: an unconfigured company cannot discount freely.
    const requiresApproval =
      policy === null || this.exceedsThreshold(policy, discount, base, request.currency);

    // `policy.makerApproverDistinct` is deliberately NOT read. The column is legacy:
    // the separation in `authorizeApproval` applies whenever approval is required,
    // and no configuration row can switch it off.
    return {
      requiresApproval,
      permissionCode: requiresApproval
        ? (policy?.requiredPermissionCode ?? DEFAULT_DISCOUNT_APPROVAL_PERMISSION)
        : null,
      threshold:
        policy === null
          ? null
          : {
              policyId: policy.id,
              versionNo: policy.versionNo,
              kind: policy.thresholdKind,
              value: policy.thresholdValue,
              currency: policy.currencyCode,
            },
    };
  }

  /**
   * Whether the signed-in person could approve a recorded discount request, and if
   * not, the ONE reason — without throwing and without exposing their limit.
   *
   * The order is the order a person would want to be told: first whether they may
   * approve this at all (they asked for it), then whether they hold the kind of
   * authority it needs, then whether they hold enough of it. `authorizeApproval`
   * turns a block into a named refusal; the approvals list turns it into the
   * per-row `canDecide` answer, so the two can never disagree.
   */
  public async evaluateApproval(
    db: DbHandle,
    request: DiscountApprovalRequest,
    hasPermission: PermissionProbe,
    memo?: ApprovalCeilingMemo
  ): Promise<DiscountApprovalStanding> {
    /**
     * Maker ≠ approver, unconditionally.
     *
     * `requestedBy` is a server fact — the person who created the revision — so this
     * comparison cannot be satisfied by naming somebody else, which is how the
     * single-request design could be bypassed. `ck_discount_approvals_separation`
     * refuses the same thing whatever reaches the database.
     */
    if (request.requestedBy === request.approverId) {
      return { canApprove: false, block: 'discount_approver_must_differ' };
    }

    /**
     * The permission comes from the SNAPSHOT, so a later change to the company's
     * policy cannot change who may approve a request already made. It is the ONLY
     * permission a decision needs beyond reading quotations: the operation's own
     * gate is the read code, so the approver population is exactly the holders of
     * the recorded permission.
     */
    if (!(await holdsSnapshotPermission(request.requiredPermissionCode, hasPermission))) {
      return { canApprove: false, block: 'discount_approval_permission_missing' };
    }

    const key = `${request.companyId}|${request.asOf}`;
    let pending = memo?.get(key);
    if (pending === undefined) {
      pending = this.ceilings.callerApprovalCeiling(
        db,
        request.companyId,
        DISCOUNT_LIMIT_TYPE,
        request.asOf
      );
      memo?.set(key, pending);
    }
    const ceiling = await pending;
    if (ceiling === null) {
      // Named, because since `callerApprovalCeiling` stopped counting a limit the
      // caller set (QA row 7.1d) an administrator can hold a limit on file and
      // still have none that counts — the screen has to say why.
      return { canApprove: false, block: 'discount_no_approval_limit' };
    }
    const allowed = Money.of(ceiling.amount, ceiling.currencyCode);
    const requested = Money.of(request.discountAmount, request.currency);
    /**
     * Currency mismatch is a hard REFUSAL, never a conversion.
     *
     * `Money.greaterThan` throws `CurrencyMismatchError`; a limit denominated in USD
     * against a price list in JOD is a mismatch, not a bug, and it authorizes
     * nothing here. Silent FX is the thing `Money` exists to make unexpressible.
     */
    let overCeiling: boolean;
    try {
      overCeiling = requested.greaterThan(allowed, 'discount approval limit');
    } catch (cause) {
      if (cause instanceof CurrencyMismatchError) {
        return {
          canApprove: false,
          block: 'discount_limit_currency_mismatch',
          ceilingCurrency: ceiling.currencyCode,
          cause,
        };
      }
      throw cause;
    }
    if (overCeiling) {
      return { canApprove: false, block: 'discount_over_approval_limit' };
    }
    return {
      canApprove: true,
      ceiling: { amount: ceiling.amount, currency: ceiling.currencyCode },
    };
  }

  /**
   * Authorizes the signed-in approver to approve a recorded discount request, or
   * throws a named refusal (`evaluateApproval` decides; this names it).
   */
  public async authorizeApproval(
    db: DbHandle,
    request: DiscountApprovalRequest,
    hasPermission: PermissionProbe
  ): Promise<DiscountApprovalAuthorization> {
    const standing = await this.evaluateApproval(db, request, hasPermission);
    if (standing.canApprove) return { ceiling: standing.ceiling };
    switch (standing.block) {
      case 'discount_approver_must_differ':
        return refuse(
          'discount_approver_must_differ',
          'The approver of a discount must be someone other than the person who requested it'
        );
      case 'discount_approval_permission_missing':
        return refuse(
          'discount_approval_permission_missing',
          `Deciding this discount requires ${snapshotPermission(request.requiredPermissionCode)}`
        );
      case 'discount_no_approval_limit':
        return refuse(
          'discount_no_approval_limit',
          'You have no discount approval limit for this company'
        );
      case 'discount_limit_currency_mismatch':
        // Named, and a refusal the caller can read rather than an internal error; the
        // mismatch stays the CAUSE so the operational log keeps the exact detail.
        throw new AppFailure('ERR-IAM-001', {
          message:
            `Your discount approval limit is denominated in ${standing.ceilingCurrency ?? 'another currency'} ` +
            `and this discount is in ${request.currency}. A limit in another currency ` +
            'authorizes nothing here, and no conversion is performed.',
          cause: standing.cause,
          safeDetails: { violations: [{ path: 'body', rule: 'discount_limit_currency_mismatch' }] },
        });
      case 'discount_over_approval_limit':
        // Named since P1-32-PRE-OD-DISC-01: an approver who holds a limit that is too
        // small is told so, rather than being left to guess which gate refused them.
        return refuse('discount_over_approval_limit', 'The discount exceeds your approval limit');
    }
  }

  /**
   * Authorizes the signed-in person to TURN DOWN a recorded discount request.
   *
   * The same separation and the same permission as an approval: turning a request
   * down is a decision on it, and the person who asked does not decide their own
   * request either way — they change the quotation instead. No limit is needed to
   * refuse money being given away.
   */
  public async authorizeRejection(
    request: Pick<DiscountApprovalRequest, 'requestedBy' | 'approverId' | 'requiredPermissionCode'>,
    hasPermission: PermissionProbe
  ): Promise<void> {
    if (request.requestedBy === request.approverId) {
      refuse(
        'discount_approver_must_differ',
        'A discount request is decided by someone other than the person who requested it'
      );
    }
    if (!(await holdsSnapshotPermission(request.requiredPermissionCode, hasPermission))) {
      refuse(
        'discount_approval_permission_missing',
        `Deciding this discount requires ${snapshotPermission(request.requiredPermissionCode)}`
      );
    }
  }

  /**
   * Whether the signed-in person may TURN DOWN a recorded discount request, without
   * throwing: the same separation and the same recorded permission
   * `authorizeRejection` names, and no limit. The approvals list reports it per row
   * (`canReject`) beside the approval standing, because a person with the permission
   * and no limit that covers the discount may refuse it but not approve it.
   */
  public async mayReject(
    request: Pick<DiscountApprovalRequest, 'requestedBy' | 'approverId' | 'requiredPermissionCode'>,
    hasPermission: PermissionProbe
  ): Promise<boolean> {
    if (request.requestedBy === request.approverId) return false;
    return holdsSnapshotPermission(request.requiredPermissionCode, hasPermission);
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
      /**
       * An unparseable threshold fails CLOSED, for the same reason an out-of-range
       * percentage does.
       *
       * `ck_pricing_approval_policies_threshold_value` bounds the value at `>= 0` and
       * the column is `numeric(18,4)`, so this should always parse — but "should
       * always" is not a guarantee, and `Decimal.parse` throwing here would surface as
       * an HTTP 500 on a legitimate quotation. A configuration this service cannot read
       * is treated as exceeded, so a malformed policy can never be more permissive than
       * no policy at all.
       */
      try {
        return !discount.lessThan(Decimal.parse(policy.thresholdValue, MONEY));
      } catch {
        return true;
      }
    }
    if (policy.thresholdKind === 'percentage') {
      /**
       * A percentage threshold outside `0..100` is treated as EXCEEDED.
       *
       * `ck_pricing_approval_policies_threshold_value` bounds the value only at
       * `>= 0` — there is no upper bound for the percentage case. Since `assess`
       * already guarantees `discount <= base`, the ratio can never exceed 100%, so a
       * threshold above 100 made `overThreshold` permanently false: no elevated
       * permission, no maker/approver check, and the ceiling block skipped entirely.
       * One mistyped configuration row disabled the whole discount control.
       *
       * Failing CLOSED here rather than throwing keeps the module's stance
       * consistent — a MISSING policy already means threshold zero — so an invalid
       * policy cannot be more permissive than no policy at all.
       */
      try {
        assertPercentageRange(policy.thresholdValue, 'threshold_value');
      } catch {
        return true;
      }
      // `base` cannot be zero here: `assess` returns early on a zero discount
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
