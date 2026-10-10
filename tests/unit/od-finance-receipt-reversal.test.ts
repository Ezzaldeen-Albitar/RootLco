/**
 * P1-32-PRE-OD-FD4 — the database-free half of the receipt reversal of ADR-023 D4:
 * what the service decides before it ever calls a primitive, and how it names a
 * refusal the database raised.
 *
 * The end-to-end half — the primitives, the locks, the audit records, the security
 * events — is `tests/backend/od-finance-receipt-reversal.test.ts` and
 * `tests/db/sal-receipt-reversal-requests.test.ts`. These cases pin what those
 * cannot see cheaply: that the request never forwards an amount, that the receipt
 * is locked before the reversal, that each refusal names its rule and is marked
 * for the record exactly once, and that a version conflict is NOT recorded as a
 * refusal. Each assertion fails if the protection it names is removed.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppFailure } from '@api/server/errors/app-failure';
import { businessRefusalOf } from '@api/server/audit/business-refusals';
import type { DbHandle } from '@api/server/db/transaction';
import {
  ReceiptReversalService,
  reversalRefusalToken,
} from '@api/modules/payments/application/receipt-reversal-service';
import { RECEIPT_REVERSAL_RULES } from '@api/modules/payments/domain/payments';

const TENANT = '0f000000-0000-4000-8000-00000000a001';
const REQUESTER = '0f000000-0000-4000-8000-00000000a002';
const APPROVER = '0f000000-0000-4000-8000-00000000a003';
const RECEIPT = '0f000000-0000-4000-8000-00000000b001';
const REVERSAL = '0f000000-0000-4000-8000-00000000c001';
const COMPANY = '0f000000-0000-4000-8000-00000000d001';
const BRANCH = '0f000000-0000-4000-8000-00000000d002';

function handle(userId: string): DbHandle {
  return {
    context: {
      module: 'payments',
      operation: 'sal.receipt-reversal-approve',
      correlationId: '0f000000-0000-4000-8000-00000000e001',
      principal: { tenantId: TENANT, userId },
    },
    depth: 0,
    query: vi.fn(async () => ({ rows: [] })),
  } as unknown as DbHandle;
}

function receipt(over: Record<string, unknown> = {}) {
  return {
    id: RECEIPT,
    companyId: COMPANY,
    branchId: BRANCH,
    receiptNumber: '000042',
    paymentMethodId: '0f000000-0000-4000-8000-00000000f001',
    payerPartnerId: '0f000000-0000-4000-8000-00000000f002',
    currencyCode: 'USD',
    amount: '80.0000',
    receivedAt: new Date('2026-10-02T08:00:00Z'),
    evidenceDocumentVersionId: null,
    status: 'recorded',
    idempotencyKey: null,
    deletedAt: null,
    recordVersion: 3,
    replacesReceiptId: null,
    ...over,
  };
}

function reversal(over: Record<string, unknown> = {}) {
  return {
    id: REVERSAL,
    companyId: COMPANY,
    branchId: BRANCH,
    originalReceiptId: RECEIPT,
    currencyCode: 'USD',
    amount: '80.0000',
    reason: 'Wrong payer',
    approvalState: 'pending',
    requestedBy: REQUESTER,
    requestedAt: new Date('2026-10-02T09:00:00Z'),
    approvedBy: null,
    approvedAt: null,
    reversedAt: null,
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    idempotencyKey: null,
    recordVersion: 1,
    ...over,
  };
}

function repository(over: Record<string, unknown> = {}) {
  const order: string[] = [];
  const repo = {
    order,
    findReceiptForUpdate: vi.fn(async () => {
      order.push('lock-receipt');
      return receipt();
    }),
    findReceipt: vi.fn(async () => receipt()),
    findReversal: vi.fn(async () => {
      order.push('find-reversal');
      return reversal();
    }),
    findReversalForUpdate: vi.fn(async () => {
      order.push('lock-reversal');
      return reversal();
    }),
    findReversalByIdempotencyKey: vi.fn(async () => null),
    findCurrentReversal: vi.fn(async () => null),
    requestReversal: vi.fn(async () => ({ id: REVERSAL })),
    approveReversal: vi.fn(async () => undefined),
    rejectReversal: vi.fn(async () => undefined),
    withdrawReversal: vi.fn(async () => undefined),
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

describe('D4 — the request never forwards an amount', () => {
  it('refuses a blank reason on the field before anything is read, and records nothing', async () => {
    const repo = repository();
    const service = new ReceiptReversalService(repo as never);
    const failure = await failureOf(() =>
      service.requestReversal(handle(REQUESTER), RECEIPT, { reason: '   ' }, 3, allowed)
    );
    expect(failure.code).toBe('ERR-VAL-001');
    expect(failure.safeDetails).toEqual({
      violations: [{ path: 'body.reason', rule: 'too_small' }],
    });
    expect(businessRefusalOf(failure)).toBeUndefined();
    expect(repo.findReceiptForUpdate).not.toHaveBeenCalled();
  });

  it('calls the primitive with the receipt, the trimmed reason and the key — and no amount', async () => {
    const repo = repository();
    const service = new ReceiptReversalService(repo as never);
    await service
      .requestReversal(
        handle(REQUESTER),
        RECEIPT,
        { reason: '  Wrong payer  ', idempotencyKey: 'key-1' },
        3,
        allowed
      )
      .catch(() => undefined);
    expect(repo.requestReversal).toHaveBeenCalledTimes(1);
    expect(repo.requestReversal.mock.calls[0]?.slice(1)).toEqual([RECEIPT, 'Wrong payer', 'key-1']);
  });

  it('answers a stale receipt version as a conflict that is not a refusal by rule', async () => {
    const service = new ReceiptReversalService(repository() as never);
    const failure = await failureOf(() =>
      service.requestReversal(handle(REQUESTER), RECEIPT, { reason: 'x' }, 2, allowed)
    );
    expect(failure.code).toBe('ERR-CON-001');
    expect(businessRefusalOf(failure)).toBeUndefined();
  });

  it('refuses a reversed receipt and a receipt with a live reversal by name, marked once', async () => {
    const reversed = new ReceiptReversalService(
      repository({
        findReceiptForUpdate: vi.fn(async () => receipt({ status: 'reversed' })),
      }) as never
    );
    const first = await failureOf(() =>
      reversed.requestReversal(handle(REQUESTER), RECEIPT, { reason: 'x' }, 3, allowed)
    );
    expect(first.safeDetails).toEqual({
      violations: [{ path: 'path.paymentId', rule: RECEIPT_REVERSAL_RULES.receiptReversed }],
    });
    expect(businessRefusalOf(first)).toEqual({
      entityType: 'sal.receipt',
      entityId: RECEIPT,
      rule: RECEIPT_REVERSAL_RULES.receiptReversed,
    });

    const repo = repository({ findCurrentReversal: vi.fn(async () => reversal()) });
    const live = new ReceiptReversalService(repo as never);
    const second = await failureOf(() =>
      live.requestReversal(handle(REQUESTER), RECEIPT, { reason: 'x' }, 3, allowed)
    );
    expect(businessRefusalOf(second)?.rule).toBe(RECEIPT_REVERSAL_RULES.exists);
    expect(repo.requestReversal).not.toHaveBeenCalled();
  });
});

describe('D4 — the decision', () => {
  it('locks the receipt before the reversal, the order the primitives take', async () => {
    const repo = repository({
      approveReversal: vi.fn(async () => Promise.reject(new Error('stop'))),
    });
    const service = new ReceiptReversalService(repo as never);
    await service.approveReversal(handle(APPROVER), REVERSAL, allowed).catch(() => undefined);
    expect(repo.order).toEqual(['find-reversal', 'lock-receipt', 'lock-reversal']);
  });

  it('refuses the requester approving, marked on the reversal, and never calls the primitive', async () => {
    const repo = repository();
    const service = new ReceiptReversalService(repo as never);
    const failure = await failureOf(() =>
      service.approveReversal(handle(REQUESTER), REVERSAL, allowed)
    );
    expect(failure.code).toBe('ERR-TRN-001');
    expect(failure.safeDetails).toEqual({
      violations: [{ path: 'path.reversalId', rule: RECEIPT_REVERSAL_RULES.selfApproval }],
    });
    expect(businessRefusalOf(failure)).toEqual({
      entityType: 'sal.receipt_reversal',
      entityId: REVERSAL,
      rule: RECEIPT_REVERSAL_RULES.selfApproval,
    });
    expect(repo.approveReversal).not.toHaveBeenCalled();
  });

  it('refuses the requester rejecting and anyone else withdrawing, each by name', async () => {
    const service = new ReceiptReversalService(repository() as never);
    const rejecting = await failureOf(() =>
      service.rejectReversal(handle(REQUESTER), REVERSAL, { reason: 'mine' }, 1, allowed)
    );
    expect(businessRefusalOf(rejecting)?.rule).toBe(RECEIPT_REVERSAL_RULES.selfRejection);
    const withdrawing = await failureOf(() =>
      service.withdrawReversal(handle(APPROVER), REVERSAL, 1, allowed)
    );
    expect(businessRefusalOf(withdrawing)?.rule).toBe(RECEIPT_REVERSAL_RULES.notRequester);
  });

  it('holds a decided reversal frozen, and answers the same decision as a replay', async () => {
    const decided = (state: string) =>
      new ReceiptReversalService(
        repository({
          findReversal: vi.fn(async () => reversal({ approvalState: state })),
          findReversalForUpdate: vi.fn(async () => reversal({ approvalState: state })),
        }) as never
      );
    const frozen = await failureOf(() =>
      decided('rejected').approveReversal(handle(APPROVER), REVERSAL, allowed)
    );
    expect(businessRefusalOf(frozen)?.rule).toBe(RECEIPT_REVERSAL_RULES.decided);
    const replay = await decided('approved').approveReversal(handle(APPROVER), REVERSAL, allowed);
    expect(replay.replayed).toBe(true);
    expect(replay.reversal.state).toBe('approved');
  });

  it('names a rule the database raised under the lock, and records it', async () => {
    const repo = repository({
      approveReversal: vi.fn(async () =>
        Promise.reject(
          Object.assign(
            new Error('receipt_reversal_decision_frozen: receipt reversal is rejected'),
            {
              code: '23514',
            }
          )
        )
      ),
    });
    const service = new ReceiptReversalService(repo as never);
    const failure = await failureOf(() =>
      service.approveReversal(handle(APPROVER), REVERSAL, allowed)
    );
    expect(failure.safeDetails).toEqual({
      violations: [{ path: 'path.reversalId', rule: RECEIPT_REVERSAL_RULES.decided }],
    });
    expect(businessRefusalOf(failure)?.rule).toBe(RECEIPT_REVERSAL_RULES.decided);
  });
});

describe('D4 — reading a guard token', () => {
  it('reads only receipt-reversal and replacement tokens, and only from a refusal SQLSTATE', () => {
    const error = (code: string, message: string) => Object.assign(new Error(message), { code });
    expect(reversalRefusalToken(error('23514', 'receipt_reversal_exists: x'))).toBe(
      'receipt_reversal_exists'
    );
    expect(
      reversalRefusalToken(error('42501', 'receipt_reversal_approve_permission_missing: x'))
    ).toBe('receipt_reversal_approve_permission_missing');
    expect(reversalRefusalToken(error('23503', 'receipt_replacement_not_reversed: x'))).toBe(
      'receipt_replacement_not_reversed'
    );
    expect(reversalRefusalToken(error('23514', 'credit_note_decision_frozen: x'))).toBeNull();
    expect(reversalRefusalToken(error('P0001', 'receipt_reversal_exists: x'))).toBeNull();
    expect(reversalRefusalToken(new Error('receipt_reversal_exists: x'))).toBeNull();
  });
});
