/**
 * ADR-023 D12 extension (Owner decision 2026-10-03) — the database-free half of
 * recording PERMISSION refusals on the four financial approval decisions:
 * approving and rejecting a credit note, approving and rejecting a receipt
 * reversal.
 *
 * The end-to-end half — the row surviving the rollback under the runtime role,
 * nothing financial moving, row-level security on the read — is
 * `tests/backend/od-finance-permission-refusals.test.ts`. These cases pin what
 * that half cannot see cheaply:
 *
 *  - the detail has a closed shape of five fixed keys and refuses any part that
 *    could carry caller text or a document attribute;
 *  - marking a refusal never changes it, and a failure carries ONE mark, so an
 *    attempt can never be recorded both as a permission refusal and as a
 *    business-rule refusal;
 *  - the authorization layer marks every denial it raises with the codes that
 *    evaluated false, and says whether it was the gate or the deferred scope check;
 *  - the pipeline writes exactly one `authorization.denied` row for the four
 *    operations and NOTHING for a fifth, and a failing write — the insert or the
 *    transaction around it — still answers the same 403;
 *  - a refusal the database raises for want of a permission inside the two
 *    services is marked as a `database` permission refusal, not as a rule.
 *
 * Each assertion is written so it fails if the protection it names is removed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResultRow } from 'pg';
import { randomUUID } from 'node:crypto';

const harness = vi.hoisted(() => ({
  tenant: '0f000000-0000-4000-8000-00000000a001',
  actor: '0f000000-0000-4000-8000-00000000a002',
  /** Permission codes `iam.has_permission` answers false for. */
  deniedAnywhere: new Set<string>(),
  /** Permission codes `iam.has_permission_in_scope` answers false for. */
  deniedInScope: new Set<string>(),
  /** Every INSERT INTO iam.security_events: [event type, detail, tenant, actor, correlation]. */
  inserted: [] as unknown[][],
  /** When set, the security-event INSERT throws this. */
  insertFailure: null as Error | null,
  /** When set, every transaction after the first throws this before running. */
  laterTransactionFailure: null as Error | null,
  transactions: 0,
}));

vi.mock('@api/server/db/transaction', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    withTransaction: async (
      context: unknown,
      fn: (db: unknown) => Promise<unknown>,
      options: { connection?: 'primary' | 'platform' } = {}
    ) => {
      harness.transactions += 1;
      if (harness.transactions > 1 && harness.laterTransactionFailure !== null) {
        throw harness.laterTransactionFailure;
      }
      const db = {
        context,
        depth: 0,
        connection: options.connection ?? 'primary',
        async query(text: string, values: readonly unknown[] = []) {
          if (text.includes('current_user AS role')) {
            return { rows: [{ role: 'app_runtime', bypassrls: false }] };
          }
          if (text.includes(' AS ok')) return { rows: [{ ok: true }] };
          if (text.includes('iam.has_permission_in_scope')) {
            return { rows: [{ allowed: !harness.deniedInScope.has(String(values[0])) }] };
          }
          if (text.includes('iam.has_permission(')) {
            return { rows: [{ allowed: !harness.deniedAnywhere.has(String(values[0])) }] };
          }
          if (text.includes('INSERT INTO iam.security_events')) {
            if (harness.insertFailure !== null) throw harness.insertFailure;
            harness.inserted.push([values[1], values[4], values[0], values[3], values[5]]);
            return { rows: [] };
          }
          return { rows: [] };
        },
      };
      return fn(db);
    },
  };
});

vi.mock('@api/server/context/resolve-context', async () => {
  const { buildRequestContext } = await import('@api/server/context/request-context');
  return {
    resolveRequestContext: async (input: {
      correlationId: string;
      operation: string;
      module: string;
    }) =>
      buildRequestContext({
        correlationId: input.correlationId,
        principal: { tenantId: harness.tenant, userId: harness.actor },
        operation: input.operation,
        module: input.module,
      }),
  };
});

import { AppFailure } from '@api/server/errors/app-failure';
import {
  BUSINESS_REFUSAL_EVENT,
  PERMISSION_REFUSAL_EVENT,
  PERMISSION_REFUSAL_OPERATIONS,
  businessRefusalOf,
  permissionRefusalDetail,
  permissionRefusalOf,
  recordPermissionRefusal,
  recordsPermissionRefusals,
  withBusinessRefusal,
  withPermissionRefusal,
} from '@api/server/audit/business-refusals';
import { __resetCapabilitiesForTests } from '@api/server/db/capabilities';
import { __resetBackendConfigForTests } from '@api/server/config/backend-config';
import {
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@api/server/context/principal';
import { handleOperation, type OperationHandler } from '@api/server/http/route-handler';
import { requirePermissions, requireScopedPermissions } from '@api/server/auth/authorization';
import type { RegisteredOperation } from '@api/server/auth/operation-registry';
import type { DbHandle } from '@api/server/db/transaction';
import type { RequestContext } from '@api/server/context/request-context';
import { CREDIT_NOTE_APPROVE_OPERATION } from '@api/app/api/v1/credit-notes/[creditNoteId]/approval/route';
import { CREDIT_NOTE_REJECT_OPERATION } from '@api/app/api/v1/credit-notes/[creditNoteId]/rejection/route';
import { CREDIT_NOTE_WITHDRAW_OPERATION } from '@api/app/api/v1/credit-notes/[creditNoteId]/withdrawal/route';
import { RECEIPT_REVERSAL_APPROVE_OPERATION } from '@api/app/api/v1/receipt-reversals/[reversalId]/approval/route';
import { RECEIPT_REVERSAL_REJECT_OPERATION } from '@api/app/api/v1/receipt-reversals/[reversalId]/rejection/route';
import { InvoiceService } from '@api/modules/billing/application/invoice-service';
import type { BillingRepository } from '@api/modules/billing/data/billing-repository';
import { ReceiptReversalService } from '@api/modules/payments/application/receipt-reversal-service';

const TENANT = harness.tenant;
const ACTOR = harness.actor;
const REQUESTER = '0f000000-0000-4000-8000-00000000a003';
const COMPANY = '0f000000-0000-4000-8000-00000000d001';
const BRANCH = '0f000000-0000-4000-8000-00000000d002';
const DOCUMENT = '0f000000-0000-4000-8000-00000000c0de';

const FOUR = [
  CREDIT_NOTE_APPROVE_OPERATION,
  CREDIT_NOTE_REJECT_OPERATION,
  RECEIPT_REVERSAL_APPROVE_OPERATION,
  RECEIPT_REVERSAL_REJECT_OPERATION,
];

/** A handle for the seam and the services: answers capability probes, records statements. */
function fakeHandle(options: { readonly insertThrows?: boolean } = {}): {
  db: DbHandle;
  statements: { text: string; values: unknown[] }[];
} {
  const statements: { text: string; values: unknown[] }[] = [];
  const context = {
    module: 'billing',
    operation: 'sal.credit-note-approve',
    correlationId: '0f000000-0000-4000-8000-00000000c001',
    principal: { tenantId: TENANT, userId: ACTOR },
    branchIds: [],
    companyIds: [],
  } as unknown as RequestContext;
  const db = {
    context,
    depth: 0,
    async query<R extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
      statements.push({ text, values });
      if (text.includes('current_user AS role')) {
        return { rows: [{ role: 'app_runtime', bypassrls: false }] as unknown as R[] };
      }
      if (text.includes(' AS ok')) return { rows: [{ ok: true }] as unknown as R[] };
      if (text.includes('INSERT INTO iam.security_events') && options.insertThrows === true) {
        throw new Error('insert refused');
      }
      if (text.includes('iam.has_permission_in_scope')) {
        return {
          rows: [{ allowed: !harness.deniedInScope.has(String(values[0])) }] as unknown as R[],
        };
      }
      if (text.includes('iam.has_permission(')) {
        return {
          rows: [{ allowed: !harness.deniedAnywhere.has(String(values[0])) }] as unknown as R[],
        };
      }
      return { rows: [] as R[] };
    },
  } as unknown as DbHandle;
  return { db, statements };
}

beforeEach(() => {
  __resetCapabilitiesForTests();
  harness.deniedAnywhere.clear();
  harness.deniedInScope.clear();
  harness.inserted.length = 0;
  harness.insertFailure = null;
  harness.laterTransactionFailure = null;
  harness.transactions = 0;
});

describe('D12 extension — the four operations, and only those', () => {
  it('lists exactly the four financial approval decisions, by their declared ids', () => {
    expect([...PERMISSION_REFUSAL_OPERATIONS].sort()).toEqual(FOUR.map((op) => op.id).sort());
    for (const operation of FOUR) expect(recordsPermissionRefusals(operation.id)).toBe(true);
    expect(recordsPermissionRefusals(CREDIT_NOTE_WITHDRAW_OPERATION.id)).toBe(false);
    expect(recordsPermissionRefusals('sal.receipt-reversal-request')).toBe(false);
    expect(PERMISSION_REFUSAL_EVENT).toBe('authorization.denied');
    expect(PERMISSION_REFUSAL_EVENT).not.toBe(BUSINESS_REFUSAL_EVENT);
  });
});

describe('D12 extension — the detail has a closed shape', () => {
  it('writes operation, branch, missing codes, source and outcome as fixed keys', () => {
    expect(
      permissionRefusalDetail({
        operationId: 'sal.credit-note-approve',
        source: 'scope',
        missing: ['sal.credit.approve', 'sal.finance.view'],
        branchId: BRANCH.toUpperCase(),
      })
    ).toBe(
      `operation=sal.credit-note-approve branch=${BRANCH} ` +
        'missing=sal.credit.approve,sal.finance.view source=scope outcome=refused'
    );
    expect(
      permissionRefusalDetail({
        operationId: 'sal.receipt-reversal-reject',
        source: 'route',
        missing: ['sal.finance.view', 'sal.finance.view'],
        branchId: null,
      })
    ).toBe(
      'operation=sal.receipt-reversal-reject branch=none missing=sal.finance.view ' +
        'source=route outcome=refused'
    );
    expect(
      permissionRefusalDetail({
        operationId: 'sal.receipt-reversal-approve',
        source: 'database',
        missing: [],
        branchId: BRANCH,
      })
    ).toBe(
      `operation=sal.receipt-reversal-approve branch=${BRANCH} missing=undetermined ` +
        'source=database outcome=refused'
    );
  });

  it('refuses a part that could carry caller text, and any operation outside the four', () => {
    const fine = {
      operationId: 'sal.credit-note-reject',
      source: 'route' as const,
      missing: ['sal.credit.approve'],
      branchId: null,
    };
    expect(permissionRefusalDetail(fine)).not.toBeNull();
    expect(
      permissionRefusalDetail({ ...fine, operationId: 'sal.credit-note-withdraw' })
    ).toBeNull();
    expect(permissionRefusalDetail({ ...fine, branchId: 'Main branch' })).toBeNull();
    expect(
      permissionRefusalDetail({ ...fine, missing: ['sal.credit.approve amount=10'] })
    ).toBeNull();
    expect(permissionRefusalDetail({ ...fine, missing: ['approve'] })).toBeNull();
    expect(permissionRefusalDetail({ ...fine, source: 'body' as unknown as 'route' })).toBeNull();
  });
});

describe('D12 extension — marking never changes the failure, and one mark wins', () => {
  it('returns the same failure unchanged and carries the permission refusal beside it', () => {
    const failure = new AppFailure('ERR-IAM-001', {
      message: 'denied',
      safeDetails: { requiredPermissions: ['sal.credit.approve', 'sal.finance.view'] },
    });
    const marked = withPermissionRefusal(failure, {
      source: 'route',
      missing: ['sal.credit.approve'],
      branchId: null,
    });
    expect(marked).toBe(failure);
    expect(marked.code).toBe('ERR-IAM-001');
    expect(marked.safeDetails).toEqual({
      requiredPermissions: ['sal.credit.approve', 'sal.finance.view'],
    });
    expect(permissionRefusalOf(marked)).toEqual({
      source: 'route',
      missing: ['sal.credit.approve'],
      branchId: null,
    });
    expect(businessRefusalOf(marked)).toBeUndefined();
  });

  it('keeps one mark per failure, whichever was set last', () => {
    const failure = new AppFailure('ERR-IAM-001', { message: 'denied' });
    withPermissionRefusal(failure, {
      source: 'scope',
      missing: ['sal.credit.approve'],
      branchId: BRANCH,
    });
    withBusinessRefusal(failure, {
      entityType: 'sal.credit_note',
      entityId: DOCUMENT,
      rule: 'credit_no_approval_limit',
    });
    expect(permissionRefusalOf(failure)).toBeUndefined();
    expect(businessRefusalOf(failure)?.rule).toBe('credit_no_approval_limit');
    withPermissionRefusal(failure, { source: 'database', missing: [], branchId: BRANCH });
    expect(businessRefusalOf(failure)).toBeUndefined();
    expect(permissionRefusalOf(failure)?.source).toBe('database');
    expect(permissionRefusalOf(new AppFailure('ERR-IAM-001', { message: 'x' }))).toBeUndefined();
    expect(permissionRefusalOf('ERR-IAM-001')).toBeUndefined();
    expect(permissionRefusalOf(null)).toBeUndefined();
  });
});

describe('D12 extension — the record', () => {
  it('writes one security event of its own type, with the session tenant, actor and correlation', async () => {
    const { db, statements } = fakeHandle();
    const outcome = await recordPermissionRefusal(db, {
      operationId: 'sal.credit-note-approve',
      source: 'route',
      missing: ['sal.credit.approve'],
      branchId: null,
    });
    expect(outcome).toEqual({ logged: true, persisted: true });
    const inserts = statements.filter((s) => s.text.includes('INSERT INTO iam.security_events'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values).toEqual([
      TENANT,
      'authorization.denied',
      'warning',
      ACTOR,
      'operation=sal.credit-note-approve branch=none missing=sal.credit.approve source=route outcome=refused',
      '0f000000-0000-4000-8000-00000000c001',
    ]);
  });

  it('writes nothing at all for an operation outside the four', async () => {
    const { db, statements } = fakeHandle();
    const outcome = await recordPermissionRefusal(db, {
      operationId: 'sal.credit-note-withdraw',
      source: 'route',
      missing: ['sal.credit.manage'],
      branchId: null,
    });
    expect(outcome).toBeNull();
    expect(statements).toHaveLength(0);
  });

  it('resolves, unpersisted, when the insert itself fails', async () => {
    const { db } = fakeHandle({ insertThrows: true });
    await expect(
      recordPermissionRefusal(db, {
        operationId: 'sal.receipt-reversal-approve',
        source: 'scope',
        missing: ['sal.reversal.approve'],
        branchId: BRANCH,
      })
    ).resolves.toEqual({ logged: true, persisted: false });
  });
});

describe('D12 extension — the authorization layer marks every denial it raises', () => {
  it('marks the gate denial with the codes that evaluated false and no branch', async () => {
    harness.deniedAnywhere.add('sal.finance.view');
    const { db } = fakeHandle();
    const error = await requirePermissions(
      db,
      CREDIT_NOTE_APPROVE_OPERATION as RegisteredOperation
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AppFailure);
    // The answer still names the DECLARED codes, never the caller's gap.
    expect((error as AppFailure).safeDetails).toEqual({
      requiredPermissions: ['sal.credit.approve', 'sal.finance.view'],
    });
    expect(permissionRefusalOf(error)).toEqual({
      source: 'route',
      missing: ['sal.finance.view'],
      branchId: null,
    });
  });

  it('marks the deferred scope denial with the scope branch', async () => {
    harness.deniedInScope.add('sal.reversal.approve');
    const { db } = fakeHandle();
    const error = await requireScopedPermissions(
      db,
      RECEIPT_REVERSAL_APPROVE_OPERATION as RegisteredOperation,
      { companyId: COMPANY, branchId: BRANCH }
    ).catch((thrown: unknown) => thrown);
    expect(permissionRefusalOf(error)).toEqual({
      source: 'scope',
      missing: ['sal.reversal.approve'],
      branchId: BRANCH,
    });
  });
});

describe('D12 extension — the pipeline writes one row after the refusal, and only for the four', () => {
  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_ENABLED', 'false');
    __resetBackendConfigForTests();
    setSessionAuthenticator({
      authenticate: async () => ({
        identityProvider: 'test_harness',
        providerSubject: 'fx_d12x_unit',
        tenantId: TENANT,
      }),
    });
  });
  afterEach(() => {
    __resetAuthenticatorForTests();
    vi.unstubAllEnvs();
    __resetBackendConfigForTests();
  });

  const send = async (
    operation: RegisteredOperation,
    handler: OperationHandler<unknown>
  ): Promise<Response> =>
    handleOperation(
      operation,
      new Request('http://localhost/api/v1/probe', {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID(), 'if-match': '1' },
      }),
      handler,
      { params: { id: DOCUMENT } }
    );

  const untouched: OperationHandler<unknown> = async () => {
    throw new Error('the handler ran past the gate');
  };

  it('records a gate refusal on each of the four once, and the handler never runs', async () => {
    harness.deniedAnywhere.add('sal.credit.approve');
    harness.deniedAnywhere.add('sal.reversal.approve');
    for (const operation of FOUR) {
      harness.inserted.length = 0;
      const response = await send(operation as RegisteredOperation, untouched);
      expect(response.status, operation.id).toBe(403);
      const correlation = response.headers.get('x-correlation-id');
      const missing = operation.permissions.filter((code) => code !== 'sal.finance.view');
      expect(harness.inserted, operation.id).toEqual([
        [
          'authorization.denied',
          `operation=${operation.id} branch=none missing=${missing.join(',')} source=route outcome=refused`,
          TENANT,
          ACTOR,
          correlation,
        ],
      ]);
    }
  });

  it('records a scope refusal raised inside the handler with the scope branch', async () => {
    harness.deniedInScope.add('sal.finance.view');
    const response = await send(
      RECEIPT_REVERSAL_REJECT_OPERATION as RegisteredOperation,
      async ({ authorizeScope }) => {
        await authorizeScope({ companyId: COMPANY, branchId: BRANCH });
        return { body: {} };
      }
    );
    expect(response.status).toBe(403);
    expect(harness.inserted.map((row) => row[1])).toEqual([
      `operation=sal.receipt-reversal-reject branch=${BRANCH} missing=sal.finance.view source=scope outcome=refused`,
    ]);
  });

  it('records nothing for the same refusal on a fifth operation', async () => {
    harness.deniedAnywhere.add('sal.credit.manage');
    const response = await send(CREDIT_NOTE_WITHDRAW_OPERATION as RegisteredOperation, untouched);
    expect(response.status).toBe(403);
    expect(harness.inserted).toEqual([]);
    // No second transaction was even opened for a record.
    expect(harness.transactions).toBe(1);
  });

  it('answers the same 403 when the insert fails', async () => {
    harness.deniedAnywhere.add('sal.credit.approve');
    const recorded = await send(CREDIT_NOTE_APPROVE_OPERATION as RegisteredOperation, untouched);
    const recordedBody = (await recorded.json()) as Record<string, unknown>;
    harness.insertFailure = new Error('security_events refused the row');
    const lost = await send(CREDIT_NOTE_APPROVE_OPERATION as RegisteredOperation, untouched);
    expect(lost.status).toBe(403);
    const lostBody = (await lost.json()) as Record<string, unknown>;
    expect({ ...lostBody, correlationId: null }).toEqual({ ...recordedBody, correlationId: null });
  });

  it('answers the same 403 when the record transaction itself fails', async () => {
    harness.deniedAnywhere.add('sal.reversal.approve');
    harness.laterTransactionFailure = new Error('pool exhausted');
    const response = await send(
      RECEIPT_REVERSAL_APPROVE_OPERATION as RegisteredOperation,
      untouched
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('ERR-IAM-001');
    expect(harness.inserted).toEqual([]);
  });

  it('records a business-rule refusal as before, and never also as a permission refusal', async () => {
    const response = await send(CREDIT_NOTE_APPROVE_OPERATION as RegisteredOperation, async () => {
      throw withBusinessRefusal(
        withPermissionRefusal(new AppFailure('ERR-IAM-001', { message: 'limit' }), {
          source: 'database',
          missing: [],
          branchId: BRANCH,
        }),
        { entityType: 'sal.credit_note', entityId: DOCUMENT, rule: 'credit_limit_exceeded' }
      );
    });
    expect(response.status).toBe(403);
    expect(harness.inserted.map((row) => row[0])).toEqual(['business-rule.refused']);
  });
});

describe('D12 extension — a permission the database refused inside the services', () => {
  const privilege = (message: string) => Object.assign(new Error(message), { code: '42501' });
  const allowed = async () => undefined;

  const note = {
    id: DOCUMENT,
    invoiceId: '0f000000-0000-4000-8000-00000000b111',
    companyId: COMPANY,
    branchId: BRANCH,
    currencyCode: 'USD',
    amount: '10.0000',
    reason: 'probe',
    approvalState: 'pending',
    requestedBy: REQUESTER,
    recordVersion: 1,
  };

  const creditService = (rejectError: Error) =>
    new InvoiceService({
      findCreditNoteForUpdate: async () => note,
      rejectCreditNote: async () => Promise.reject(rejectError),
      findInvoiceForUpdate: async () => ({ id: note.invoiceId, currencyCode: 'USD' }),
      // ADR-023 D2: the approval is bounded by what the invoice can still be credited.
      creditCeiling: async () => ({ creditable: '100.0000', owed: '100.0000' }),
      businessDate: async () => '2026-10-03',
      cumulativeApprovedCreditWith: async () => '10.0000',
      approveCreditNote: async () => Promise.reject(rejectError),
    } as unknown as BillingRepository);

  it('marks the credit-note rejection guard token with the approval code and the note branch', async () => {
    const { db } = fakeHandle();
    const error = await creditService(
      privilege('credit_note_reject_permission_missing: rejecting credit note x requires it')
    )
      .rejectCreditNote(db, DOCUMENT, { reason: 'Wrong invoice' }, 1, allowed)
      .catch((thrown: unknown) => thrown);
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect(permissionRefusalOf(error)).toEqual({
      source: 'database',
      missing: ['sal.credit.approve'],
      branchId: BRANCH,
    });
    expect(businessRefusalOf(error)).toBeUndefined();
  });

  it('marks a bare privilege refusal on a credit-note rejection as undetermined', async () => {
    const { db } = fakeHandle();
    const error = await creditService(privilege('permission denied for table credit_notes'))
      .rejectCreditNote(db, DOCUMENT, { reason: 'Wrong invoice' }, 1, allowed)
      .catch((thrown: unknown) => thrown);
    expect(permissionRefusalOf(error)).toEqual({
      source: 'database',
      missing: [],
      branchId: BRANCH,
    });
  });

  it('marks the credit-note approval guard token as a permission refusal, with the same answer', async () => {
    const { db } = fakeHandle();
    const counted = {
      ...db,
      context: db.context,
      query: async (text: string, values: unknown[] = []) =>
        text.includes('iam.approval_limits')
          ? { rows: [{ amount: '1000.0000', currency_code: 'USD', own_creation: false }] }
          : db.query(text, values),
    } as unknown as DbHandle;
    const error = await creditService(
      privilege('credit_approval_permission_missing: approving credit note x requires it')
    )
      .approveCreditNote(counted, DOCUMENT, allowed)
      .catch((thrown: unknown) => thrown);
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect((error as AppFailure).safeDetails).toEqual({
      violations: [{ path: 'path.creditNoteId', rule: 'credit_approval_permission_missing' }],
    });
    expect(permissionRefusalOf(error)).toEqual({
      source: 'database',
      missing: ['sal.credit.approve'],
      branchId: BRANCH,
    });
    expect(businessRefusalOf(error)).toBeUndefined();
  });

  const reversal = {
    id: DOCUMENT,
    companyId: COMPANY,
    branchId: BRANCH,
    originalReceiptId: '0f000000-0000-4000-8000-00000000b001',
    currencyCode: 'USD',
    amount: '80.0000',
    reason: 'Wrong payer',
    approvalState: 'pending',
    requestedBy: REQUESTER,
    recordVersion: 1,
  };
  const reversalService = (decisionError: Error) =>
    new ReceiptReversalService({
      findReversal: async () => reversal,
      findReversalForUpdate: async () => reversal,
      findReceiptForUpdate: async () => ({
        id: reversal.originalReceiptId,
        status: 'recorded',
        deletedAt: null,
      }),
      approveReversal: async () => Promise.reject(decisionError),
      rejectReversal: async () => Promise.reject(decisionError),
      withdrawReversal: async () => Promise.reject(decisionError),
    } as never);

  it('marks the reversal guard tokens on approval and rejection with the deciding code', async () => {
    const { db } = fakeHandle();
    const approving = await reversalService(
      privilege('receipt_reversal_approve_permission_missing: approving x requires it')
    )
      .approveReversal(db, DOCUMENT, allowed)
      .catch((thrown: unknown) => thrown);
    const rejecting = await reversalService(
      privilege('receipt_reversal_reject_permission_missing: rejecting x requires it')
    )
      .rejectReversal(db, DOCUMENT, { reason: 'Correct' }, 1, allowed)
      .catch((thrown: unknown) => thrown);
    for (const error of [approving, rejecting]) {
      expect((error as AppFailure).code).toBe('ERR-IAM-001');
      expect(permissionRefusalOf(error)).toEqual({
        source: 'database',
        missing: ['sal.reversal.approve'],
        branchId: BRANCH,
      });
      expect(businessRefusalOf(error)).toBeUndefined();
    }
  });

  it('marks a bare privilege refusal on a reversal decision, and leaves a withdrawal unmarked', async () => {
    const { db } = fakeHandle();
    const deciding = await reversalService(privilege('permission denied'))
      .approveReversal(db, DOCUMENT, allowed)
      .catch((thrown: unknown) => thrown);
    expect(permissionRefusalOf(deciding)).toEqual({
      source: 'database',
      missing: [],
      branchId: BRANCH,
    });
    const requesterDb = {
      ...db,
      context: { ...db.context, principal: { tenantId: TENANT, userId: REQUESTER } },
      query: db.query,
    } as unknown as DbHandle;
    const withdrawing = await reversalService(privilege('permission denied'))
      .withdrawReversal(requesterDb, DOCUMENT, 1, allowed)
      .catch((thrown: unknown) => thrown);
    expect((withdrawing as AppFailure).code).toBe('ERR-IAM-001');
    expect(permissionRefusalOf(withdrawing)).toBeUndefined();
  });
});
