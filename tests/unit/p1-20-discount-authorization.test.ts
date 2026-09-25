/**
 * Discount authorization (Phase 1-20, P1-20-BE-006, P1-20-SEC-003; two-step since
 * P1-32-PRE-OD-DISC-01).
 *
 * These are the escalation tests. Every case below is a way an actor could give
 * away more money than they are entitled to, and each asserts the refusal rather
 * than the happy path.
 *
 * The service answers two questions at two moments. `assess` runs when the
 * discount is ASKED for and decides only whether it needs approval — measured
 * against the policy in force, whose version it returns for the snapshot.
 * `authorizeApproval` runs when somebody APPROVES it and decides whether that
 * person may: never the requester, only with the snapshotted permission, and only
 * within a limit they did not set themselves.
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
  readonly id?: string;
  readonly versionNo?: number;
  readonly thresholdKind: string;
  readonly thresholdValue: string;
  readonly currencyCode: string | null;
  readonly requiredPermissionCode: string;
  readonly makerApproverDistinct: boolean;
}

function build(options: {
  policy?: PolicyShape | null;
  ceiling?: { amount: string; currencyCode: string } | null;
}): { service: DiscountAuthorizationService; ceilingReads: () => number } {
  const repository = {
    findApprovalPolicy: vi
      .fn()
      .mockResolvedValue(
        options.policy === undefined || options.policy === null
          ? null
          : { id: 'policy-1', versionNo: 1, ...options.policy }
      ),
  } as unknown as PricingRepository;
  const read = vi.fn().mockResolvedValue(options.ceiling ?? null);
  const ceilings: ApprovalCeilingReader = { callerApprovalCeiling: read };
  return {
    service: new DiscountAuthorizationService(repository, ceilings),
    ceilingReads: () => read.mock.calls.length,
  };
}

const allow = async (): Promise<boolean> => true;
const deny = async (): Promise<boolean> => false;

/** Settles a refused call into its `AppFailure`, or `null` when it was allowed. */
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

const assessment = (over: Partial<Parameters<DiscountAuthorizationService['assess']>[1]> = {}) => ({
  companyId: 'c1',
  discountAmount: '10.0000',
  currency: 'JOD',
  lineBase: '100.0000',
  asOf: '2026-07-27',
  ...over,
});

const approval = (
  over: Partial<Parameters<DiscountAuthorizationService['authorizeApproval']>[1]> = {}
) => ({
  companyId: 'c1',
  discountAmount: '60.0000',
  currency: 'JOD',
  asOf: '2026-07-27',
  requestedBy: 'user-maker',
  approverId: 'user-approver',
  requiredPermissionCode: 'svc.price.manage',
  ...over,
});

describe('discount assessment — input bounds', () => {
  it('refuses a negative discount', async () => {
    const { service } = build({});
    await expect(service.assess(db, assessment({ discountAmount: '-0.0001' }))).rejects.toThrow(
      /may not be negative/
    );
  });

  it('refuses a discount larger than the line base, mirroring the CHECK', async () => {
    const { service } = build({});
    await expect(
      service.assess(db, assessment({ discountAmount: '100.0001', lineBase: '100.0000' }))
    ).rejects.toThrow(/may not exceed the line total before tax/);
  });

  it('needs no approval for a zero discount with no policy, because nothing is given away', async () => {
    const { service } = build({});
    const result = await service.assess(db, assessment({ discountAmount: '0' }));
    expect(result).toEqual({ requiresApproval: false, permissionCode: null, threshold: null });
  });

  it('rejects a discount that is not a plain decimal', async () => {
    const { service } = build({});
    await expect(service.assess(db, assessment({ discountAmount: '1e2' }))).rejects.toThrow(
      /not a plain decimal literal/
    );
  });
});

describe('discount assessment — fails closed when unconfigured', () => {
  it('treats a missing policy as a zero threshold, not an infinite one', async () => {
    const { service } = build({ policy: null });
    const result = await service.assess(db, assessment({ discountAmount: '0.0001' }));
    // Even the smallest discount needs approval, by the default permission, and the
    // snapshot records that no policy existed.
    expect(result).toEqual({
      requiresApproval: true,
      permissionCode: 'svc.price.manage',
      threshold: null,
    });
  });
});

describe('discount assessment — amount thresholds', () => {
  const policy: PolicyShape = {
    id: 'policy-7',
    versionNo: 3,
    thresholdKind: 'amount',
    thresholdValue: '50.0000',
    currencyCode: 'JOD',
    requiredPermissionCode: 'quo.decision.record',
    // Legacy column value. Nothing reads it: separation applies whenever approval is
    // required, whatever a policy row says.
    makerApproverDistinct: false,
  };

  it('lets a discount below the threshold through with no approval', async () => {
    const { service } = build({ policy });
    const result = await service.assess(db, assessment({ discountAmount: '49.9999' }));
    expect(result.requiresApproval).toBe(false);
    expect(result.permissionCode).toBeNull();
  });

  it('treats a discount exactly AT the threshold as needing approval, and snapshots the version', async () => {
    const { service } = build({ policy });
    const result = await service.assess(
      db,
      assessment({ discountAmount: '50.0000', lineBase: '100.0000' })
    );
    expect(result.requiresApproval).toBe(true);
    // The version measured against travels with the request, so a later change to the
    // company threshold cannot move it.
    expect(result.threshold).toEqual({
      policyId: 'policy-7',
      versionNo: 3,
      kind: 'amount',
      value: '50.0000',
      currency: 'JOD',
    });
    // The permission an APPROVER will need comes from the policy, not from the default.
    expect(result.permissionCode).toBe('quo.decision.record');
  });

  it('never consults the requester’s own authority: asking is not approving', async () => {
    const { service, ceilingReads } = build({
      policy,
      ceiling: { amount: '999.0000', currencyCode: 'JOD' },
    });
    await service.assess(db, assessment({ discountAmount: '60.0000' }));
    expect(ceilingReads()).toBe(0);
  });

  it('treats a policy in another currency as exceeded rather than comparing across currencies', async () => {
    const { service } = build({ policy: { ...policy, currencyCode: 'USD' } });
    // A 1.0000 JOD discount is far under a 50 threshold numerically, but the
    // threshold is denominated in USD, so it cannot wave anything through here.
    const result = await service.assess(db, assessment({ discountAmount: '1.0000' }));
    expect(result.requiresApproval).toBe(true);
  });
});

describe('discount assessment — percentage thresholds are exact', () => {
  const policy: PolicyShape = {
    thresholdKind: 'percentage',
    thresholdValue: '15.0000',
    currencyCode: null,
    requiredPermissionCode: 'svc.price.manage',
    makerApproverDistinct: false,
  };

  it.each([
    ['10.0000', '100.0000', false, 'ten percent of a hundred is under fifteen'],
    ['14.9999', '100.0000', false, 'just under the threshold'],
    ['15.0000', '100.0000', true, 'exactly at the threshold counts as over'],
    ['15.0001', '100.0000', true, 'just over the threshold'],
    ['0.1500', '1.0000', true, 'fifteen percent of a small base still trips it'],
    ['0.1499', '1.0000', false, 'just under, at the smallest representable step'],
  ])('discount %s on base %s → approval=%s (%s)', async (amount, base, expected) => {
    const { service } = build({ policy });
    const result = await service.assess(db, assessment({ discountAmount: amount, lineBase: base }));
    expect(result.requiresApproval).toBe(expected);
  });

  it('never reaches the percentage comparison with a zero base, because the base check fires first', async () => {
    const { service } = build({ policy });
    await expect(
      service.assess(db, assessment({ discountAmount: '0.0001', lineBase: '0.0000' }))
    ).rejects.toThrow(/may not exceed the line total before tax/);
  });

  it('stays exact on a base a double would round', async () => {
    const { service } = build({ policy });
    // 1.005 * 15% = 0.15075. A discount of 0.1507 is under; 0.1508 is over.
    const under = await service.assess(
      db,
      assessment({ discountAmount: '0.1507', lineBase: '1.0050' })
    );
    expect(under.requiresApproval).toBe(false);
    const over = await service.assess(
      db,
      assessment({ discountAmount: '0.1508', lineBase: '1.0050' })
    );
    expect(over.requiresApproval).toBe(true);
  });

  it('fails CLOSED on a percentage threshold above 100, which could otherwise never be reached', async () => {
    const { service } = build({ policy: { ...policy, thresholdValue: '150.0000' } });
    const result = await service.assess(db, assessment({ discountAmount: '1.0000' }));
    expect(result.requiresApproval).toBe(true);
  });
});

describe('discount approval — the approver is never the requester', () => {
  const ceiling = { amount: '9999.0000', currencyCode: 'JOD' };

  it('refuses the requester, by name, before reading any limit or permission', async () => {
    const { service, ceilingReads } = build({ ceiling });
    const probe = vi.fn(allow);
    const failure = await refusal(
      service.authorizeApproval(db, approval({ requestedBy: 'u1', approverId: 'u1' }), probe)
    );
    expect(failure?.code).toBe('ERR-IAM-001');
    expect(rulesOf(failure)).toEqual(['discount_approver_must_differ']);
    // A requester holding every authority is still refused: nothing about their
    // authority is even consulted, so no configuration can switch the rule off.
    expect(probe).not.toHaveBeenCalled();
    expect(ceilingReads()).toBe(0);
  });

  it('allows a different approver with the permission and a sufficient limit', async () => {
    const { service } = build({ ceiling });
    const result = await service.authorizeApproval(
      db,
      approval({ requestedBy: 'u1', approverId: 'u2' }),
      allow
    );
    expect(result.ceiling).toEqual({ amount: '9999.0000', currency: 'JOD' });
  });
});

describe('discount approval — the approver’s authority', () => {
  it('asks for the permission the SNAPSHOT names, not the default', async () => {
    const { service } = build({ ceiling: { amount: '999.0000', currencyCode: 'JOD' } });
    const probe = vi.fn(deny);
    await expect(
      service.authorizeApproval(
        db,
        approval({ requiredPermissionCode: 'quo.decision.record' }),
        probe
      )
    ).rejects.toThrow(/requires quo.decision.record/);
    expect(probe).toHaveBeenCalledWith('quo.decision.record');
  });

  it('falls back to svc.price.manage when the snapshot names nothing', async () => {
    const { service } = build({ ceiling: { amount: '999.0000', currencyCode: 'JOD' } });
    const probe = vi.fn(deny);
    await expect(
      service.authorizeApproval(db, approval({ requiredPermissionCode: '' }), probe)
    ).rejects.toThrow(/requires svc.price.manage/);
    expect(probe).toHaveBeenCalledWith('svc.price.manage');
  });

  it('treats a missing limit as no authority, not unlimited, and says so by name', async () => {
    const { service } = build({ ceiling: null });
    const failure = await refusal(service.authorizeApproval(db, approval(), allow));
    expect(failure?.message).toMatch(/no discount approval limit/);
    expect(rulesOf(failure)).toEqual(['discount_no_approval_limit']);
  });

  it('refuses a discount over the approver’s limit, by name', async () => {
    const { service } = build({ ceiling: { amount: '55.0000', currencyCode: 'JOD' } });
    const failure = await refusal(
      service.authorizeApproval(db, approval({ discountAmount: '55.0001' }), allow)
    );
    expect(failure?.code).toBe('ERR-IAM-001');
    expect(rulesOf(failure)).toEqual(['discount_over_approval_limit']);
  });

  it('allows a discount exactly at the limit', async () => {
    const { service } = build({ ceiling: { amount: '60.0000', currencyCode: 'JOD' } });
    const result = await service.authorizeApproval(
      db,
      approval({ discountAmount: '60.0000' }),
      allow
    );
    expect(result.ceiling).toEqual({ amount: '60.0000', currency: 'JOD' });
  });

  it('refuses when the limit is in a different currency, never converting', async () => {
    /**
     * A refusal the CALLER can read, not an internal error. `Money.greaterThan` still
     * throws `CurrencyMismatchError` — silent FX must stay unexpressible — but that is a
     * plain `Error`, which the route handler would serve as HTTP 500.
     */
    const { service } = build({ ceiling: { amount: '999.0000', currencyCode: 'USD' } });
    const failure = await refusal(
      service.authorizeApproval(db, approval({ currency: 'JOD' }), allow)
    );
    expect(failure?.code).toBe('ERR-IAM-001');
    expect(failure?.message).toMatch(/denominated in USD/);
    expect(failure?.message).toMatch(/no conversion is performed/);
    // The mismatch is still the CAUSE, so the operational log keeps the exact detail.
    expect((failure as { cause?: unknown } | null)?.cause).toBeInstanceOf(CurrencyMismatchError);
  });
});

describe('discount rejection — the same separation, no limit needed', () => {
  it('refuses the requester turning down their own request', async () => {
    const { service } = build({});
    const failure = await refusal(
      service.authorizeRejection(
        { requestedBy: 'u1', approverId: 'u1', requiredPermissionCode: 'svc.price.manage' },
        allow
      )
    );
    expect(rulesOf(failure)).toEqual(['discount_approver_must_differ']);
  });

  it('refuses a person without the snapshotted permission', async () => {
    const { service } = build({});
    await expect(
      service.authorizeRejection(
        { requestedBy: 'u1', approverId: 'u2', requiredPermissionCode: 'svc.price.manage' },
        deny
      )
    ).rejects.toThrow(/requires svc.price.manage/);
  });

  it('lets another person with the permission turn it down, reading no limit', async () => {
    const { service, ceilingReads } = build({ ceiling: null });
    await expect(
      service.authorizeRejection(
        { requestedBy: 'u1', approverId: 'u2', requiredPermissionCode: 'svc.price.manage' },
        allow
      )
    ).resolves.toBeUndefined();
    expect(ceilingReads()).toBe(0);
  });
});
