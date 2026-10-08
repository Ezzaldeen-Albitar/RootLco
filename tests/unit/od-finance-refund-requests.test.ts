/**
 * P1-32-PRE-OD-FD2B — the database-free half of the refund requests of ADR-023 D2,
 * part 2: what the service decides before it ever calls a primitive, and how it
 * names a refusal the database raised.
 *
 * The end-to-end half — the primitives, the locks, the audit records, the security
 * events — is `tests/backend/od-finance-refund-requests.test.ts` and
 * `tests/db/sal-refund-requests.test.ts`. These cases pin what those cannot see
 * cheaply: that the obligation is locked before the request, that each refusal
 * names its rule on the right path and is marked for the record exactly once, that a
 * permission refusal the database decided is marked as one, that a version conflict
 * is NOT a refusal by rule, and that the reader's state of a request and the D7
 * refund status are derived, never stored. Each assertion fails if the protection
 * it names is removed.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppFailure } from '@api/server/errors/app-failure';
import { businessRefusalOf, permissionRefusalOf } from '@api/server/audit/business-refusals';
import type { DbHandle } from '@api/server/db/transaction';
import {
  RefundService,
  refundRefusalToken,
  toRefundRequestView,
} from '@api/modules/billing/application/refund-service';
import { REFUND_RULES, refundRequestState } from '@api/modules/billing/domain/billing';

const TENANT = '0f000000-0000-4000-8000-00000000a101';
const REQUESTER = '0f000000-0000-4000-8000-00000000a102';
const APPROVER = '0f000000-0000-4000-8000-00000000a103';
const OBLIGATION = '0f000000-0000-4000-8000-00000000b101';
const REQUEST = '0f000000-0000-4000-8000-00000000c101';
const COMPANY = '0f000000-0000-4000-8000-00000000d101';
const BRANCH = '0f000000-0000-4000-8000-00000000d102';
const METHOD = '0f000000-0000-4000-8000-00000000e101';

function handle(userId: string): DbHandle {
  return {
    context: {
      module: 'billing',
      operation: 'sal.refund-approve',
      correlationId: '0f000000-0000-4000-8000-00000000f101',
      principal: { tenantId: TENANT, userId },
    },
    depth: 0,
    query: vi.fn(async () => ({ rows: [] })),
  } as unknown as DbHandle;
}

function obligation(over: Record<string, unknown> = {}) {
  return {
    id: OBLIGATION,
    companyId: COMPANY,
    branchId: BRANCH,
    partnerId: '0f000000-0000-4000-8000-00000000a1f1',
    invoiceId: '0f000000-0000-4000-8000-00000000a1f2',
    currencyCode: 'USD',
    amount: '30.0000',
    state: 'open',
    recordVersion: 1,
    paidOut: '0.0000',
    stillOwed: '30.0000',
    ...over,
  };
}

function request(over: Record<string, unknown> = {}) {
  return {
    id: REQUEST,
    companyId: COMPANY,
    branchId: BRANCH,
    obligationId: OBLIGATION,
    invoiceId: '0f000000-0000-4000-8000-00000000a1f2',
    payeePartnerId: '0f000000-0000-4000-8000-00000000a1f1',
    currencyCode: 'USD',
    amount: '10.0000',
    paymentMethodId: METHOD,
    reason: 'Paid twice',
    approvalState: 'pending',
    requestedBy: REQUESTER,
    requestedAt: new Date('2026-10-08T09:00:00Z'),
    approvedBy: null,
    approvedAt: null,
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    executedBy: null,
    executedAt: null,
    payoutReference: null,
    payoutDate: null,
    idempotencyKey: null,
    executionIdempotencyKey: null,
    recordVersion: 2,
    invoiceNumber: '000042',
    workOrderId: null,
    ...over,
  };
}

function repository(over: Record<string, unknown> = {}) {
  const order: string[] = [];
  const repo = {
    order,
    findObligation: vi.fn(async (_db: unknown, _id: string, lock?: boolean) => {
      order.push(lock ? 'lock-obligation' : 'find-obligation');
      return obligation();
    }),
    findRequest: vi.fn(async (_db: unknown, _id: string, lock?: boolean) => {
      order.push(lock ? 'lock-request' : 'find-request');
      return request();
    }),
    findRequestByIdempotencyKey: vi.fn(async () => null),
    findLiveRequest: vi.fn(async () => null),
    fitsWithinObligation: vi.fn(async () => true),
    findTenantMethod: vi.fn(async () => ({
      id: METHOD,
      methodCode: 'cash',
      kind: 'cash',
      displayName: 'Cash',
      active: true,
    })),
    methodsById: vi.fn(async () => new Map()),
    requestRefund: vi.fn(async () => REQUEST),
    approveRequest: vi.fn(async () => undefined),
    rejectRequest: vi.fn(async () => undefined),
    withdrawRequest: vi.fn(async () => undefined),
    executeRequest: vi.fn(async () => undefined),
    // The branch's own calendar day (P1-32-PRE-OD-FRX), not the database's.
    branchToday: vi.fn(async () => '2026-10-08'),
    listRequests: vi.fn(),
    minorUnitsFor: vi.fn(async () => new Map([['USD', 2]])),
    ...over,
  };
  return repo;
}

async function failureOf(run: () => Promise<unknown>): Promise<AppFailure> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppFailure) return error;
    throw error;
  }
  throw new Error('expected a refusal but the command succeeded');
}

const allowed = vi.fn(async () => undefined);
const body = { amount: '10.00', paymentMethodId: METHOD, reason: 'Paid twice' };

/** A driver error as the database raises a guard refusal. */
function guard(token: string, code = '23514'): Error {
  return Object.assign(new Error(`${token}: refused`), { code });
}

describe('D2 part 2 — the request', () => {
  it('refuses a blank reason and an amount of zero on their fields, before anything is read, and records nothing', async () => {
    const repo = repository();
    const service = new RefundService(repo as never);
    const blank = await failureOf(() =>
      service.requestRefund(handle(REQUESTER), OBLIGATION, { ...body, reason: '  ' }, allowed)
    );
    expect(blank.code).toBe('ERR-VAL-001');
    expect(blank.safeDetails).toEqual({ violations: [{ path: 'body.reason', rule: 'too_small' }] });
    const zero = await failureOf(() =>
      service.requestRefund(handle(REQUESTER), OBLIGATION, { ...body, amount: '0.00' }, allowed)
    );
    expect(zero.safeDetails).toEqual({ violations: [{ path: 'body.amount', rule: 'too_small' }] });
    expect(businessRefusalOf(blank)).toBeUndefined();
    expect(repo.findObligation).not.toHaveBeenCalled();
  });

  it('locks the obligation and refuses an obligation that is not open, a live request, an excess and an inactive method, each by name and marked once', async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [
        { findObligation: vi.fn(async () => obligation({ state: 'settled' })) },
        REFUND_RULES.obligationNotOpen,
        'path.obligationId',
      ],
      [
        { findLiveRequest: vi.fn(async () => request()) },
        REFUND_RULES.liveExists,
        'path.obligationId',
      ],
      [
        { fitsWithinObligation: vi.fn(async () => false) },
        REFUND_RULES.exceedsObligation,
        'body.amount',
      ],
      [
        {
          findTenantMethod: vi.fn(async () => ({
            id: METHOD,
            methodCode: 'old',
            kind: 'cash',
            displayName: 'Old',
            active: false,
          })),
        },
        REFUND_RULES.methodUnavailable,
        'body.paymentMethodId',
      ],
    ];
    for (const [over, rule, path] of cases) {
      const repo = repository(over);
      const failure = await failureOf(() =>
        new RefundService(repo as never).requestRefund(handle(REQUESTER), OBLIGATION, body, allowed)
      );
      expect(failure.code, rule).toBe('ERR-TRN-001');
      expect(failure.safeDetails, rule).toEqual({ violations: [{ path, rule }] });
      expect(businessRefusalOf(failure), rule).toEqual({
        entityType: 'sal.refund_obligation',
        entityId: OBLIGATION,
        rule,
      });
      expect(repo.requestRefund, rule).not.toHaveBeenCalled();
    }
  });

  it('refuses an amount finer than the currency on the field, as a validation error', async () => {
    const repo = repository();
    const failure = await failureOf(() =>
      new RefundService(repo as never).requestRefund(
        handle(REQUESTER),
        OBLIGATION,
        { ...body, amount: '1.005' },
        allowed
      )
    );
    expect(failure.code).toBe('ERR-VAL-001');
    expect(failure.safeDetails).toEqual({
      violations: [{ path: 'body.amount', rule: 'minor_unit_scale' }],
    });
  });

  it('marks a permission the database refused as a permission refusal, not a rule', async () => {
    const repo = repository({
      requestRefund: vi.fn(async () => {
        throw guard(REFUND_RULES.requestPermissionMissing, '42501');
      }),
    });
    const failure = await failureOf(() =>
      new RefundService(repo as never).requestRefund(handle(REQUESTER), OBLIGATION, body, allowed)
    );
    expect(failure.code).toBe('ERR-IAM-001');
    expect(permissionRefusalOf(failure)).toEqual({
      source: 'database',
      missing: ['sal.payment.record'],
      branchId: BRANCH,
    });
    expect(businessRefusalOf(failure)).toBeUndefined();
  });

  it('names the live-request race the unique index lost', async () => {
    const repo = repository({
      requestRefund: vi.fn(async () => {
        throw Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'uq_refund_requests_obligation_live',
        });
      }),
    });
    const failure = await failureOf(() =>
      new RefundService(repo as never).requestRefund(handle(REQUESTER), OBLIGATION, body, allowed)
    );
    expect(failure.safeDetails).toEqual({
      violations: [{ path: 'path.obligationId', rule: REFUND_RULES.liveExists }],
    });
  });
});

describe('D2 part 2 — the decision', () => {
  it('locks the obligation before the request, and answers a stale version as a conflict that is not a refusal', async () => {
    const repo = repository();
    const failure = await failureOf(() =>
      new RefundService(repo as never).approveRefund(handle(APPROVER), REQUEST, 9, allowed)
    );
    expect(repo.order).toEqual(['find-request', 'lock-obligation', 'lock-request']);
    expect(failure.code).toBe('ERR-CON-001');
    expect(businessRefusalOf(failure)).toBeUndefined();
  });

  it('refuses the requester approving and rejecting, and anyone else withdrawing, each by name, without calling the primitive', async () => {
    const repo = repository();
    const service = new RefundService(repo as never);
    const approve = await failureOf(() =>
      service.approveRefund(handle(REQUESTER), REQUEST, 2, allowed)
    );
    expect(approve.safeDetails).toEqual({
      violations: [{ path: 'path.requestId', rule: REFUND_RULES.selfApproval }],
    });
    expect(businessRefusalOf(approve)).toEqual({
      entityType: 'sal.refund_request',
      entityId: REQUEST,
      rule: REFUND_RULES.selfApproval,
    });
    const reject = await failureOf(() =>
      service.rejectRefund(handle(REQUESTER), REQUEST, { reason: 'mine' }, 2, allowed)
    );
    expect(reject.safeDetails).toEqual({
      violations: [{ path: 'path.requestId', rule: REFUND_RULES.selfRejection }],
    });
    const withdraw = await failureOf(() =>
      service.withdrawRefund(handle(APPROVER), REQUEST, 2, allowed)
    );
    expect(withdraw.safeDetails).toEqual({
      violations: [{ path: 'path.requestId', rule: REFUND_RULES.notRequester }],
    });
    expect(repo.approveRequest).not.toHaveBeenCalled();
    expect(repo.rejectRequest).not.toHaveBeenCalled();
    expect(repo.withdrawRequest).not.toHaveBeenCalled();
  });

  it('holds a decided request frozen, and a paid-out one as already executed', async () => {
    const rejected = repository({
      findRequest: vi.fn(async () => request({ approvalState: 'rejected' })),
    });
    const frozen = await failureOf(() =>
      new RefundService(rejected as never).approveRefund(handle(APPROVER), REQUEST, 2, allowed)
    );
    expect(frozen.safeDetails).toEqual({
      violations: [{ path: 'path.requestId', rule: REFUND_RULES.decided }],
    });
    const paid = repository({
      findRequest: vi.fn(async () =>
        request({ approvalState: 'approved', executedAt: new Date('2026-10-08T10:00:00Z') })
      ),
    });
    const executed = await failureOf(() =>
      new RefundService(paid as never).withdrawRefund(handle(REQUESTER), REQUEST, 2, allowed)
    );
    expect(executed.safeDetails).toEqual({
      violations: [{ path: 'path.requestId', rule: REFUND_RULES.alreadyExecuted }],
    });
  });

  it('marks the decision code the database refused as a permission refusal in the request branch', async () => {
    const repo = repository({
      approveRequest: vi.fn(async () => {
        throw guard(REFUND_RULES.approvePermissionMissing, '42501');
      }),
    });
    const failure = await failureOf(() =>
      new RefundService(repo as never).approveRefund(handle(APPROVER), REQUEST, 2, allowed)
    );
    expect(failure.code).toBe('ERR-IAM-001');
    expect(permissionRefusalOf(failure)).toEqual({
      source: 'database',
      missing: ['sal.refund.approve'],
      branchId: BRANCH,
    });
  });
});

describe('D2 part 2 — the payout', () => {
  const payout = { paymentMethodId: METHOD, payoutReference: 'TRF-1', payoutDate: '2026-10-08' };

  it('refuses a payout before approval and by another method, by name; and a future day on its field', async () => {
    const pending = repository();
    const early = await failureOf(() =>
      new RefundService(pending as never).executeRefund(
        handle(REQUESTER),
        REQUEST,
        payout,
        2,
        allowed
      )
    );
    expect(early.safeDetails).toEqual({
      violations: [{ path: 'path.requestId', rule: REFUND_RULES.notApproved }],
    });
    const approved = () =>
      repository({ findRequest: vi.fn(async () => request({ approvalState: 'approved' })) });
    const method = await failureOf(() =>
      new RefundService(approved() as never).executeRefund(
        handle(REQUESTER),
        REQUEST,
        { ...payout, paymentMethodId: '0f000000-0000-4000-8000-00000000e1ff' },
        2,
        allowed
      )
    );
    expect(method.safeDetails).toEqual({
      violations: [{ path: 'body.paymentMethodId', rule: REFUND_RULES.payoutMethodMismatch }],
    });
    const future = await failureOf(() =>
      new RefundService(approved() as never).executeRefund(
        handle(REQUESTER),
        REQUEST,
        { ...payout, payoutDate: '2026-10-09' },
        2,
        allowed
      )
    );
    expect(future.code).toBe('ERR-VAL-001');
    expect(future.safeDetails).toEqual({
      violations: [{ path: 'body.payoutDate', rule: REFUND_RULES.payoutDateInvalid }],
    });
    expect(businessRefusalOf(future)).toBeUndefined();
  });

  it('judges the day on the request branch calendar, which may be ahead of the server (P1-32-PRE-OD-FRX)', async () => {
    // The branch's today is the 9th while a server in another zone still reads the
    // 8th: a payout dated the branch's today is recorded, the day after refused.
    // The write is a stand-in that stops the call once the date check let it
    // through: what follows it (the audit record) needs a database.
    const ahead = () =>
      repository({
        findRequest: vi.fn(async () => request({ approvalState: 'approved' })),
        branchToday: vi.fn(async () => '2026-10-09'),
        executeRequest: vi.fn(async () => {
          throw new Error('reached the payout write');
        }),
      });
    const accepted = ahead();
    const outcome = await new RefundService(accepted as never)
      .executeRefund(
        handle(REQUESTER),
        REQUEST,
        { ...payout, payoutDate: '2026-10-09' },
        2,
        allowed
      )
      .then(
        () => null,
        (error: unknown) => error
      );
    // The date check let the branch's today through to the write; whatever the
    // stand-in then stopped, it was not the date rule.
    expect((outcome as { safeDetails?: unknown } | null)?.safeDetails).not.toEqual({
      violations: [{ path: 'body.payoutDate', rule: REFUND_RULES.payoutDateInvalid }],
    });
    expect(accepted.executeRequest).toHaveBeenCalledTimes(1);
    expect(accepted.executeRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ payoutDate: '2026-10-09' })
    );
    expect(accepted.branchToday).toHaveBeenCalledWith(expect.anything(), {
      companyId: COMPANY,
      branchId: BRANCH,
    });
    const refused = ahead();
    const tomorrow = await failureOf(() =>
      new RefundService(refused as never).executeRefund(
        handle(REQUESTER),
        REQUEST,
        { ...payout, payoutDate: '2026-10-10' },
        2,
        allowed
      )
    );
    expect(tomorrow.safeDetails).toEqual({
      violations: [{ path: 'body.payoutDate', rule: REFUND_RULES.payoutDateInvalid }],
    });
    expect(refused.executeRequest).not.toHaveBeenCalled();
  });

  it('answers a repeat under the payout key before comparing the version, and refuses any other repeat', async () => {
    const paid = repository({
      findRequest: vi.fn(async () =>
        request({
          approvalState: 'approved',
          executedAt: new Date('2026-10-08T10:00:00Z'),
          executionIdempotencyKey: 'key-1',
          recordVersion: 5,
        })
      ),
    });
    const service = new RefundService(paid as never);
    const replay = await service.executeRefund(
      handle(REQUESTER),
      REQUEST,
      { ...payout, idempotencyKey: 'key-1' },
      2,
      allowed
    );
    expect(replay.replayed).toBe(true);
    expect(paid.executeRequest).not.toHaveBeenCalled();
    const again = await failureOf(() =>
      service.executeRefund(
        handle(REQUESTER),
        REQUEST,
        { ...payout, idempotencyKey: 'key-2' },
        5,
        allowed
      )
    );
    expect(again.safeDetails).toEqual({
      violations: [{ path: 'path.requestId', rule: REFUND_RULES.alreadyExecuted }],
    });
  });
});

describe('D2 part 2 — derived, never stored', () => {
  it('reads only refund tokens, and only from a refusal SQLSTATE', () => {
    expect(refundRefusalToken(guard('refund_self_approval'))).toBe('refund_self_approval');
    expect(refundRefusalToken(guard('receipt_reversal_exists'))).toBeNull();
    expect(
      refundRefusalToken(Object.assign(new Error('refund_x: y'), { code: '22023' }))
    ).toBeNull();
  });

  it('names a paid-out request executed, else by its decision', () => {
    expect(refundRequestState('approved', new Date())).toBe('executed');
    expect(refundRequestState('approved', null)).toBe('approved');
    expect(refundRequestState('pending', null)).toBe('pending');
    expect(refundRequestState('withdrawn', null)).toBe('withdrawn');
    const view = toRefundRequestView(
      request({ approvalState: 'approved', approvedBy: APPROVER, approvedAt: new Date() }) as never,
      new Map([['USD', 2]]),
      new Map()
    );
    expect(view.state).toBe('approved');
    expect(view.decidedBy).toBe(APPROVER);
    expect(view.paymentMethod).toBeNull();
  });
});
