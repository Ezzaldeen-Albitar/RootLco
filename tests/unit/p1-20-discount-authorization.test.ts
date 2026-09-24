/**
 * Discount authorization (Phase 1-20, P1-20-BE-006, P1-20-SEC-003).
 *
 * These are the escalation tests. Every case below is a way an actor could give
 * away more money than they are entitled to, and each asserts the refusal rather
 * than the happy path.
 *
 * The percentage-threshold cases matter most: the comparison is cross-multiplied
 * to avoid a division the schema never defines, and an off-by-one in that
 * arithmetic is invisible until someone discounts just over a limit.
 */
import { describe, expect, it, vi } from 'vitest';
import { DiscountAuthorizationService } from '@/modules/pricing/application/discount-authorization-service';
import type { ApprovalCeilingReader } from '@/modules/pricing/application/discount-authorization-service';
import type { PricingRepository } from '@/modules/pricing/data/pricing-repository';
import { CurrencyMismatchError } from '@/modules/pricing/domain/money';
import { AppFailure } from '@/server/errors/app-failure';

const db = {} as never;

interface PolicyShape {
  readonly thresholdKind: string;
  readonly thresholdValue: string;
  readonly currencyCode: string | null;
  readonly requiredPermissionCode: string;
  readonly makerApproverDistinct: boolean;
}

function build(options: {
  policy?: PolicyShape | null;
  ceiling?: { amount: string; currencyCode: string } | null;
  /** Whether a named discount requester resolves to an active user in this tenant. */
  requesterExists?: boolean;
}): DiscountAuthorizationService {
  const repository = {
    findApprovalPolicy: vi.fn().mockResolvedValue(options.policy ?? null),
    isActiveUserInTenant: vi.fn().mockResolvedValue(options.requesterExists ?? true),
  } as unknown as PricingRepository;
  const ceilings: ApprovalCeilingReader = {
    callerApprovalCeiling: vi.fn().mockResolvedValue(options.ceiling ?? null),
  };
  return new DiscountAuthorizationService(repository, ceilings);
}

/** A second, real user id — the party a maker/approver separation names. */
const OTHER_USER = 'd2900000-0000-4000-8000-0000000000ff';

const allow = async (): Promise<boolean> => true;
const deny = async (): Promise<boolean> => false;

/** Settles a refused authorization into its `AppFailure`, or `null` when it was allowed. */
async function refusal(pending: Promise<unknown>): Promise<AppFailure | null> {
  return pending.then(
    () => null,
    (error: unknown) => {
      expect(error).toBeInstanceOf(AppFailure);
      return error as AppFailure;
    }
  );
}

/** The named rules a refusal carries in its caller-safe details. */
function rulesOf(failure: AppFailure | null): readonly string[] {
  return (failure?.safeDetails.violations ?? []).map((violation) => violation.rule);
}

const request = (over: Partial<Parameters<DiscountAuthorizationService['authorize']>[1]> = {}) => ({
  companyId: 'c1',
  branchId: 'b1',
  discountAmount: '10.0000',
  currency: 'JOD',
  lineBase: '100.0000',
  asOf: '2026-07-27',
  requestedBy: 'user-maker',
  actorId: 'user-approver',
  ...over,
});

describe('discount authorization — input bounds', () => {
  it('refuses a negative discount', async () => {
    const service = build({});
    await expect(
      service.authorize(db, request({ discountAmount: '-0.0001' }), allow)
    ).rejects.toThrow(/may not be negative/);
  });

  it('refuses a discount larger than the line base, mirroring the CHECK', async () => {
    const service = build({});
    await expect(
      service.authorize(db, request({ discountAmount: '100.0001', lineBase: '100.0000' }), allow)
    ).rejects.toThrow(/may not exceed the line total before tax/);
  });

  it('allows a zero discount with no policy and no ceiling, because nothing is given away', async () => {
    const service = build({});
    const result = await service.authorize(db, request({ discountAmount: '0' }), deny);
    expect(result.authorized).toBe(true);
    expect(result.requiredElevatedPermission).toBe(false);
  });

  it('rejects a discount that is not a plain decimal', async () => {
    const service = build({});
    await expect(service.authorize(db, request({ discountAmount: '1e2' }), allow)).rejects.toThrow(
      /not a plain decimal literal/
    );
  });
});

describe('discount authorization — fails closed when unconfigured', () => {
  it('treats a missing policy as a zero threshold, not an infinite one', async () => {
    const service = build({ policy: null, ceiling: { amount: '999.0000', currencyCode: 'JOD' } });
    // The elevated permission is demanded even though no policy exists.
    await expect(service.authorize(db, request(), deny)).rejects.toThrow(
      /requires svc.price.manage/
    );
  });

  it('treats a missing ceiling as no authority, not unlimited', async () => {
    const service = build({ policy: null, ceiling: null });
    const failure = await refusal(service.authorize(db, request(), allow));
    expect(failure?.message).toMatch(/no discount approval limit/);
    expect(rulesOf(failure)).toEqual(['discount_no_approval_limit']);
  });
});

describe('discount authorization — amount thresholds', () => {
  const policy: PolicyShape = {
    thresholdKind: 'amount',
    thresholdValue: '50.0000',
    currencyCode: 'JOD',
    requiredPermissionCode: 'svc.price.manage',
    // Legacy column value. It has no effect since the Owner's decision of 2026-09-24:
    // requester and approver must differ whenever approval is required.
    makerApproverDistinct: false,
  };

  it('refuses self-approval at the threshold even though the legacy flag says false (Owner decision 2026-09-24)', async () => {
    // The rule CHANGED by Owner decision; this input used to be authorized. It is a
    // refusal now because no configuration may switch the separation off.
    const service = build({ policy, ceiling: { amount: '999.0000', currencyCode: 'JOD' } });
    const failure = await refusal(
      service.authorize(
        db,
        request({ discountAmount: '60.0000', requestedBy: 'user-approver' }),
        allow
      )
    );
    expect(failure?.code).toBe('ERR-IAM-001');
    expect(rulesOf(failure)).toEqual(['discount_approver_must_differ']);
  });

  it('lets a discount below the threshold through without the elevated permission', async () => {
    const service = build({ policy });
    const result = await service.authorize(db, request({ discountAmount: '49.9999' }), deny);
    expect(result.requiredElevatedPermission).toBe(false);
    expect(result.permissionCode).toBeNull();
  });

  it('treats a discount exactly AT the threshold as requiring authorization', async () => {
    const service = build({ policy, ceiling: { amount: '999.0000', currencyCode: 'JOD' } });
    const result = await service.authorize(
      db,
      request({ discountAmount: '50.0000', lineBase: '100.0000' }),
      allow
    );
    expect(result.requiredElevatedPermission).toBe(true);
  });

  it('refuses when the actor lacks the required permission', async () => {
    const service = build({ policy, ceiling: { amount: '999.0000', currencyCode: 'JOD' } });
    await expect(
      service.authorize(db, request({ discountAmount: '60.0000' }), deny)
    ).rejects.toThrow(/requires svc.price.manage/);
  });

  it('refuses when the discount exceeds the actor ceiling even with the permission', async () => {
    const service = build({ policy, ceiling: { amount: '55.0000', currencyCode: 'JOD' } });
    await expect(
      service.authorize(db, request({ discountAmount: '60.0000' }), allow)
    ).rejects.toThrow(/exceeds your approval limit/);
  });

  it('allows a discount exactly at the ceiling', async () => {
    const service = build({ policy, ceiling: { amount: '60.0000', currencyCode: 'JOD' } });
    const result = await service.authorize(db, request({ discountAmount: '60.0000' }), allow);
    expect(result.ceiling).toEqual({ amount: '60.0000', currency: 'JOD' });
  });

  it('treats a policy in another currency as exceeded rather than comparing across currencies', async () => {
    const service = build({
      policy: { ...policy, currencyCode: 'USD' },
      ceiling: { amount: '999.0000', currencyCode: 'JOD' },
    });
    // A 1.0000 JOD discount is far under a 50 threshold numerically, but the
    // threshold is denominated in USD, so it cannot authorize anything here.
    const result = await service.authorize(db, request({ discountAmount: '1.0000' }), allow);
    expect(result.requiredElevatedPermission).toBe(true);
  });

  it('refuses when the ceiling is in a different currency, never converting', async () => {
    /**
     * A refusal the CALLER can read, not an internal error.
     *
     * `Money.greaterThan` still throws `CurrencyMismatchError` — silent FX must stay
     * unexpressible — but that is a plain `Error`, which the route handler classifies
     * `ERR-SYS-001` and serves as HTTP 500. An approval limit in USD against a JOD price
     * list is ordinary configuration, not a bug, so it is translated into an
     * authorization refusal naming both currencies. This test asserted the raw
     * `CurrencyMismatchError` message and therefore pinned the 500 in place.
     */
    const service = build({ policy, ceiling: { amount: '999.0000', currencyCode: 'USD' } });
    const failure = await service
      .authorize(db, request({ discountAmount: '60.0000', currency: 'JOD' }), allow)
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(failure).toBeInstanceOf(AppFailure);
    expect((failure as AppFailure).code).toBe('ERR-IAM-001');
    expect((failure as AppFailure).message).toMatch(/denominated in USD/);
    expect((failure as AppFailure).message).toMatch(/no conversion is performed/);
    // The mismatch is still the CAUSE, so the operational log keeps the exact detail.
    expect((failure as { cause?: unknown }).cause).toBeInstanceOf(CurrencyMismatchError);
  });
});

describe('discount authorization — percentage thresholds are exact', () => {
  const policy: PolicyShape = {
    thresholdKind: 'percentage',
    thresholdValue: '15.0000',
    currencyCode: null,
    requiredPermissionCode: 'svc.price.manage',
    // Legacy column value, ignored since the Owner's decision of 2026-09-24.
    makerApproverDistinct: false,
  };
  const ceiling = { amount: '9999.0000', currencyCode: 'JOD' };

  it('refuses an unnamed requester over the threshold even though the legacy flag says false (Owner decision 2026-09-24)', async () => {
    // The rule CHANGED by Owner decision: an omitted requester means the caller is
    // requesting it themselves, which is now refused whatever the policy row says.
    const service = build({ policy, ceiling });
    const failure = await refusal(
      service.authorize(
        db,
        request({ discountAmount: '15.0000', lineBase: '100.0000', requestedBy: null }),
        allow
      )
    );
    expect(failure?.code).toBe('ERR-IAM-001');
    expect(rulesOf(failure)).toEqual(['discount_approver_must_differ']);
  });

  it('still needs no requester UNDER the threshold, where no approval is required', async () => {
    const service = build({ policy, ceiling });
    const result = await service.authorize(
      db,
      request({ discountAmount: '14.9999', lineBase: '100.0000', requestedBy: null }),
      deny
    );
    expect(result.requiredElevatedPermission).toBe(false);
  });

  it.each([
    ['10.0000', '100.0000', false, 'ten percent of a hundred is under fifteen'],
    ['14.9999', '100.0000', false, 'just under the threshold'],
    ['15.0000', '100.0000', true, 'exactly at the threshold counts as over'],
    ['15.0001', '100.0000', true, 'just over the threshold'],
    ['0.1500', '1.0000', true, 'fifteen percent of a small base still trips it'],
    ['0.1499', '1.0000', false, 'just under, at the smallest representable step'],
  ])('discount %s on base %s → elevated=%s (%s)', async (amount, base, expected) => {
    const service = build({ policy, ceiling });
    const result = await service.authorize(
      db,
      request({ discountAmount: amount, lineBase: base }),
      allow
    );
    expect(result.requiredElevatedPermission).toBe(expected);
  });

  it('never reaches the percentage comparison with a zero base, because the base check fires first', async () => {
    const service = build({ policy, ceiling });
    // A non-zero discount on a zero base exceeds the base, so it is refused
    // before any division-shaped comparison could happen. This pins the ordering:
    // if the base check ever moved after the threshold check, a zero base would
    // reach the ratio and the refusal message here would change.
    await expect(
      service.authorize(db, request({ discountAmount: '0.0001', lineBase: '0.0000' }), allow)
    ).rejects.toThrow(/may not exceed the line total before tax/);
  });

  it('stays exact on a base a double would round', async () => {
    const service = build({ policy, ceiling });
    // 1.005 * 15% = 0.15075. A discount of 0.1507 is under; 0.1508 is over.
    const under = await service.authorize(
      db,
      request({ discountAmount: '0.1507', lineBase: '1.0050' }),
      allow
    );
    expect(under.requiredElevatedPermission).toBe(false);
    const over = await service.authorize(
      db,
      request({ discountAmount: '0.1508', lineBase: '1.0050' }),
      allow
    );
    expect(over.requiredElevatedPermission).toBe(true);
  });
});

describe('discount authorization — maker must not be approver', () => {
  const policy: PolicyShape = {
    thresholdKind: 'amount',
    thresholdValue: '0.0000',
    currencyCode: 'JOD',
    requiredPermissionCode: 'svc.price.manage',
    makerApproverDistinct: true,
  };
  const ceiling = { amount: '9999.0000', currencyCode: 'JOD' };

  it('refuses when the requester and the approver are the same actor', async () => {
    const service = build({ policy, ceiling });
    const failure = await refusal(
      service.authorize(db, request({ requestedBy: 'u1', actorId: 'u1' }), allow)
    );
    expect(failure?.message).toMatch(/someone other than the person who requested it/);
    expect(failure?.safeDetails.violations).toEqual([
      { path: 'body.discountRequestedBy', rule: 'discount_approver_must_differ' },
    ]);
  });

  it('allows when they are different actors', async () => {
    const service = build({ policy, ceiling });
    const result = await service.authorize(
      db,
      request({ requestedBy: 'u1', actorId: 'u2' }),
      allow
    );
    expect(result.authorized).toBe(true);
  });

  /**
   * The rule CHANGED by Owner decision on 2026-09-24 (Option A, strict separation).
   *
   * This case used to assert that a policy row saying `maker_approver_distinct = false`
   * switched the separation off and let the actor approve their own discount. The Owner
   * decided that no configuration may switch the rule off, so the same input is now a
   * refusal. The column is legacy and ignored; this pins that it stays ignored.
   */
  it('still refuses self-approval when a policy row carries the legacy flag set to false (Owner decision 2026-09-24)', async () => {
    const service = build({ policy: { ...policy, makerApproverDistinct: false }, ceiling });
    const failure = await refusal(
      service.authorize(db, request({ requestedBy: 'u1', actorId: 'u1' }), allow)
    );
    expect(failure?.code).toBe('ERR-IAM-001');
    expect(failure?.safeDetails.violations).toEqual([
      { path: 'body.discountRequestedBy', rule: 'discount_approver_must_differ' },
    ]);
  });
});

/**
 * The named requester must EXIST (P1-20-BE-006, P1-20-SEC-003).
 *
 * `maker_approver_distinct` was cleared by any well-formed UUID other than the actor's own:
 * `discountRequestedBy` arrived from the request body, was compared against the actor id and
 * nothing else, and was never persisted — so an actor could authorize their own
 * over-threshold discount by inventing a colleague, and the invention left no trace. The
 * hostile audit confirmed it against `information_schema`: zero `%request%` columns anywhere
 * in `quo`.
 *
 * Distinctness is not separation of duties. These cases pin the difference.
 */
describe('discount maker/approver — the requester is resolved, not merely distinct', () => {
  const policy = {
    id: 'd2000000-0000-4000-8000-0000000009f1',
    thresholdKind: 'amount' as const,
    thresholdValue: '10.0000',
    currencyCode: 'JOD',
    requiredPermissionCode: 'svc.price.manage',
    makerApproverDistinct: true,
  };

  it('refuses a requester that resolves to no active user in this tenant', async () => {
    const service = build({
      policy,
      ceiling: { amount: '999.0000', currencyCode: 'JOD' },
      requesterExists: false,
    });
    const failure = await service
      .authorize(db, request({ discountAmount: '50.0000', requestedBy: OTHER_USER }), allow)
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(failure).toBeInstanceOf(AppFailure);
    expect((failure as AppFailure).code).toBe('ERR-IAM-001');
    expect((failure as AppFailure).message).toMatch(/not an active user in this tenant/);
  });

  it('refuses an unresolved requester even under a policy row whose legacy flag says false (Owner decision 2026-09-24)', async () => {
    const service = build({
      policy: { ...policy, makerApproverDistinct: false },
      ceiling: { amount: '999.0000', currencyCode: 'JOD' },
      requesterExists: false,
    });
    const failure = await refusal(
      service.authorize(db, request({ discountAmount: '50.0000', requestedBy: OTHER_USER }), allow)
    );
    expect(failure?.code).toBe('ERR-IAM-001');
    expect(failure?.message).toMatch(/not an active user in this tenant/);
  });

  it('accepts a requester that resolves, and returns it for the audit record', async () => {
    const service = build({
      policy,
      ceiling: { amount: '999.0000', currencyCode: 'JOD' },
      requesterExists: true,
    });
    const result = await service.authorize(
      db,
      request({ discountAmount: '50.0000', requestedBy: OTHER_USER }),
      allow
    );
    expect(result.requiredElevatedPermission).toBe(true);
    // The value is carried out so the caller can audit WHO the control was satisfied by.
    expect(result.requestedBy).toBe(OTHER_USER);
  });
});
