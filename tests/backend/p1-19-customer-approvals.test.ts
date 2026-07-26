/**
 * Customer approvals and the unapproved-work execution gate (Phase 1-19, P1-19-BE-007/008).
 *
 * ## The ordering claim is the one that matters, and it is proved by observation
 *
 * `wo.guard_additional_work_state` refuses `state = 'approved'` unless an `approved` row
 * already exists in `wo.customer_approvals`. That is the forgery-resistance control, so
 * the suite proves it two ways: the approval row's `created_at` is not after the state
 * change's audit record, and — more usefully — an attempt to move the request to
 * `approved` with NO approval row is refused by the deployed guard. The second is a
 * database-level probe, because no route can express that request; a control nobody can
 * reach through the API still has to be shown to work, or the whole surface rests on an
 * assumption.
 *
 * ## The execution gate mirrors B3's FIRST limb only
 *
 * A job may not enter a state whose `wo.job_states.labor_allowed` is true while a
 * REQUIRED request originating from it is `pending`. It may enter one once the customer
 * has decided EITHER way, and it may always pause. Including B3's second limb —
 * `approved` and `unfulfilled` — would have deadlocked the job: it could never enter a
 * labour state, so the approved work could never be done, so the request could never
 * become fulfilled, so B3 could never clear. The suite asserts that deadlock does not
 * exist rather than leaving it to be discovered.
 *
 * Operations exercised here: wo.additional-work-approval,
 * wo.additional-work-approval-read, wo.job-transition.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.additional-work-approval: route service authorization success denial cross-tenant isolation audit outbox stale-version idempotency rollback concurrency
 *   wo.additional-work-approval-read: route service authorization success denial cross-tenant isolation
 *   wo.job-transition: route service authorization denial
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  SUBJECT_UNPERMITTED,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_B1,
  COMPANY_B1,
  FULL,
  PERMISSION_ELSEWHERE,
  READER,
  SCOPED_ELSEWHERE,
  SPLIT_WINDOW,
  TECH_A1,
  TENANT_B_FULL,
  auditCount,
  authAs,
  authAsSubject,
  count,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  establishTechnicianFixtures,
  outboxCount,
  partyRoleFor,
  readJob,
  seedDocumentVersion,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as RAISE_ADDITIONAL_WORK } from '@/app/api/v1/work-orders/[workOrderId]/additional-work/route';
import {
  GET as READ_APPROVAL,
  POST as RECORD_APPROVAL,
} from '@/app/api/v1/additional-work/[requestId]/approval/route';
import { POST as TRANSITION_JOB } from '@/app/api/v1/jobs/[jobId]/transition/route';
import { POST as ASSIGN } from '@/app/api/v1/jobs/[jobId]/assignments/route';
import { POST as WITHDRAW } from '@/app/api/v1/additional-work/[requestId]/withdrawal/route';

const APPROVAL_RECORDED = 'wo.customer_approval.recorded';
const STATE_CHANGED = 'wo.additional_work.state_changed';
/**
 * The operation the execution gate lives inside.
 *
 * Named in executable code rather than only in the header, because the coverage gate's
 * strict rule requires an operation id to appear where it is actually exercised: a
 * comment claiming a suite covers an operation is exactly the evidence that ratchet
 * exists to reject. The gate is not a separate operation — putting it beside
 * `wo.job-transition` would have made it bypassable by choosing the other URL.
 */
const JOB_TRANSITION = 'wo.job-transition';

let admin: Pool;
let runtime: Pool;

interface ApprovalBody {
  readonly request?: { readonly state: string; readonly recordVersion: number };
  readonly approval?: {
    readonly id: string;
    readonly decision: string;
    readonly channel: string;
    readonly presentedScope: string;
    readonly quotationRevisionRef: string | null;
    readonly decidedAt: string;
    readonly evidence: readonly { readonly documentVersionId: string }[];
  };
  readonly code?: string;
  readonly violations?: readonly { readonly path?: string; readonly rule?: string }[];
}

function decide(
  requestId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': options.key ?? crypto.randomUUID(),
  };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return RECORD_APPROVAL(
    new Request(`http://localhost/api/v1/additional-work/${requestId}/approval`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ requestId }) }
  );
}

function readApproval(requestId: string): Promise<Response> {
  return READ_APPROVAL(
    new Request(`http://localhost/api/v1/additional-work/${requestId}/approval`),
    { params: Promise.resolve({ requestId }) }
  );
}

function moveJob(
  jobId: string,
  body: unknown,
  version: number,
  key = crypto.randomUUID()
): Promise<Response> {
  return TRANSITION_JOB(
    new Request(`http://localhost/api/v1/jobs/${jobId}/transition`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        'if-match': String(version),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );
}

async function createJob(workOrderId: string, title = 'Brake overhaul'): Promise<string> {
  authAs(FULL);
  const response = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ title }),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
  if (response.status !== 201) throw new Error(`fixture job failed with ${response.status}`);
  return ((await response.json()) as { id: string }).id;
}

/** Assigns the fixture technician, so `assignment_required` states become reachable. */
async function assign(jobId: string): Promise<void> {
  authAs(FULL);
  const response = await ASSIGN(
    new Request(`http://localhost/api/v1/jobs/${jobId}/assignments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        technicianProfileId: TECH_A1,
        window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
      }),
    }),
    { params: Promise.resolve({ jobId }) }
  );
  if (response.status !== 201) {
    throw new Error(`fixture assignment failed with ${response.status}: ${await response.text()}`);
  }
}

interface Seeded {
  readonly workOrderId: string;
  readonly visitId: string;
  readonly jobId: string;
  readonly requestId: string;
  readonly version: number;
  readonly partyRoleId: string;
}

async function seedRequest(options: { readonly isRequired?: boolean } = {}): Promise<Seeded> {
  const order = await createOpenWorkOrder();
  const jobId = await createJob(order.workOrderId);
  authAs(FULL);
  const body: Record<string, unknown> = {
    originatingJobId: jobId,
    summary: 'Track rod end has play',
    ...(options.isRequired === undefined ? {} : { isRequired: options.isRequired }),
  };
  const response = await RAISE_ADDITIONAL_WORK(
    new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/additional-work`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workOrderId: order.workOrderId }) }
  );
  if (response.status !== 201) {
    throw new Error(`fixture request failed with ${response.status}: ${await response.text()}`);
  }
  const raised = (await response.json()) as { id: string; recordVersion: number };
  return {
    workOrderId: order.workOrderId,
    visitId: order.visitId,
    jobId,
    requestId: raised.id,
    version: raised.recordVersion,
    partyRoleId: await partyRoleFor(order.visitId),
  };
}

function decisionBody(
  seeded: Seeded,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    decision: 'approved',
    channel: 'phone',
    decidingPartyRoleId: seeded.partyRoleId,
    presentedScope: 'Track rod end replacement, parts and labour',
    ...overrides,
  };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishTechnicianFixtures();
  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('wo.additional-work-approval', () => {
  it('records the decision and moves the request in one call', async () => {
    const seeded = await seedRequest();

    authAs(FULL);
    const response = await decide(seeded.requestId, decisionBody(seeded), {
      version: seeded.version,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as ApprovalBody;
    expect(body.approval?.decision).toBe('approved');
    expect(body.approval?.channel).toBe('phone');
    expect(body.request?.state).toBe('approved');
    // Left NULL: `quotation_revision_ref` is foreign-keyed to `quo.quotation_revisions`
    // and creating the revision it would point at is Phase 1-20. Recording a decision
    // about work is not pricing it.
    expect(body.approval?.quotationRevisionRef).toBeNull();

    // Exactly one approval row, exactly one of each record. Two audit records is the
    // designed count: the decision and the state change are separate facts.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.customer_approvals WHERE additional_work_request_id = $1`,
        [seeded.requestId]
      )
    ).toBe(1);
    expect(await auditCount(APPROVAL_RECORDED, body.approval?.id ?? '')).toBe(1);
    expect(await auditCount(STATE_CHANGED, seeded.requestId)).toBe(1);
    expect(await outboxCount('customer-approval.recorded', body.approval?.id ?? '')).toBe(1);
  });

  it('records a rejection, which moves the request to rejected', async () => {
    const seeded = await seedRequest();

    authAs(FULL);
    const response = await decide(
      seeded.requestId,
      decisionBody(seeded, { decision: 'rejected', channel: 'in_person' }),
      { version: seeded.version }
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as ApprovalBody;
    // `rejected`, never `declined` — `ck_additional_work_requests_state` has no such
    // value, and the phase brief's vocabulary was wrong about it.
    expect(body.request?.state).toBe('rejected');
    expect(body.approval?.decision).toBe('rejected');
  });

  it('accepts every channel the CHECK constraint permits, including other', async () => {
    for (const channel of ['in_person', 'phone', 'email', 'sms', 'portal', 'other']) {
      const seeded = await seedRequest();
      authAs(FULL);
      const response = await decide(seeded.requestId, decisionBody(seeded, { channel }), {
        version: seeded.version,
      });
      expect(response.status, `channel ${channel}`).toBe(201);
      expect(((await response.json()) as ApprovalBody).approval?.channel).toBe(channel);
    }
  });

  it('refuses an unknown channel and an unknown decision', async () => {
    const seeded = await seedRequest();

    authAs(FULL);
    expect(
      (
        await decide(seeded.requestId, decisionBody(seeded, { channel: 'whatsapp' }), {
          version: seeded.version,
        })
      ).status
    ).toBe(422);
    authAs(FULL);
    // `declined` is the phase brief's word and is not in the vocabulary.
    expect(
      (
        await decide(seeded.requestId, decisionBody(seeded, { decision: 'declined' }), {
          version: seeded.version,
        })
      ).status
    ).toBe(422);
  });

  it('refuses a deciding party from ANOTHER reception visit', async () => {
    const seeded = await seedRequest();
    const other = await createOpenWorkOrder();
    const foreignRole = await partyRoleFor(other.visitId);

    // `fk_customer_approvals_party_role` is satisfied — the role exists and is in this
    // tenant — so only `wo.guard_customer_approval_coherence` refuses it, by resolving
    // request → work order → reception visit and comparing. Without the mapping this
    // would have surfaced as a raw 23514 and a 500.
    authAs(FULL);
    const response = await decide(
      seeded.requestId,
      decisionBody(seeded, { decidingPartyRoleId: foreignRole }),
      { version: seeded.version }
    );
    expect(response.status).toBe(422);
    const problem = (await response.json()) as ApprovalBody;
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.rule).toBe('not_on_reception_visit');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.customer_approvals WHERE additional_work_request_id = $1`,
        [seeded.requestId]
      )
    ).toBe(0);
  });

  it('refuses a forged deciding party that resolves to nothing', async () => {
    const seeded = await seedRequest();

    authAs(FULL);
    const response = await decide(
      seeded.requestId,
      decisionBody(seeded, { decidingPartyRoleId: crypto.randomUUID() }),
      { version: seeded.version }
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as ApprovalBody).code).toBe('ERR-RES-001');
  });

  it('refuses a stale presented scope, which is the version the advisor was shown', async () => {
    const seeded = await seedRequest();

    // `presented_scope` is free text and nothing in the schema ties it to the request's
    // content, so binding the decision to the request VERSION is the only way a request
    // that moved between presentation and decision can be detected.
    authAs(FULL);
    const response = await decide(seeded.requestId, decisionBody(seeded), {
      version: seeded.version + 4,
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as ApprovalBody).code).toBe('ERR-CON-001');
  });

  it('requires If-Match', async () => {
    const seeded = await seedRequest();
    authAs(FULL);
    expect((await decide(seeded.requestId, decisionBody(seeded), { version: null })).status).toBe(
      428
    );
  });

  it('refuses a second, conflicting decision', async () => {
    const seeded = await seedRequest();

    authAs(FULL);
    const first = await decide(seeded.requestId, decisionBody(seeded), { version: seeded.version });
    expect(first.status).toBe(201);
    const version = ((await first.json()) as ApprovalBody).request?.recordVersion ?? 0;

    // `approved` has no outbound edge, so the state check refuses before the index has
    // to. Both are real: the check is the readable refusal, `uq_customer_approvals_active`
    // is what a lost race lands on.
    authAs(FULL);
    const second = await decide(seeded.requestId, decisionBody(seeded, { decision: 'rejected' }), {
      version,
    });
    expect(second.status).toBe(409);
    expect(((await second.json()) as ApprovalBody).code).toBe('ERR-TRN-001');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.customer_approvals WHERE additional_work_request_id = $1`,
        [seeded.requestId]
      )
    ).toBe(1);
  });

  it('binds evidence to an exact document version and never accepts a storage key', async () => {
    const seeded = await seedRequest();
    const versionId = await seedDocumentVersion();

    authAs(FULL);
    const response = await decide(
      seeded.requestId,
      decisionBody(seeded, {
        evidence: [{ documentVersionId: versionId, evidenceType: 'call_recording' }],
      }),
      { version: seeded.version }
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as ApprovalBody;
    expect(body.approval?.evidence).toHaveLength(1);
    expect(body.approval?.evidence[0]?.documentVersionId).toBe(versionId);

    // Append-only, and bound to the VERSION rather than the document: `app_runtime`
    // holds SELECT and INSERT and nothing else on this table, so no substitution is
    // possible. The evidence row carries no storage key because the table has no column
    // for one.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.customer_approval_evidence
          WHERE customer_approval_id = $1 AND document_version_id = $2`,
        [body.approval?.id ?? '', versionId]
      )
    ).toBe(1);

    // A storage key is not a field the route accepts, and `.strict()` proves it.
    const other = await seedRequest();
    authAs(FULL);
    expect(
      (
        await decide(
          other.requestId,
          decisionBody(other, {
            evidence: [
              {
                documentVersionId: versionId,
                evidenceType: 'call_recording',
                storageKey: 'dev/tenant/whatever',
              },
            ],
          }),
          { version: other.version }
        )
      ).status
    ).toBe(422);
  });

  it('refuses evidence naming another tenant’s document version', async () => {
    const seeded = await seedRequest();
    const foreign = await seedDocumentVersion({ tenantId: TENANT_B });

    // Two controls agree here. `shared.document_versions` is tenant-scoped by RLS, so
    // the pre-check through the attachment service cannot see it; and
    // `fk_customer_approval_evidence_version` is `(tenant_id, document_version_id)`, so
    // the row could not be written even if the check were removed.
    authAs(FULL);
    const response = await decide(
      seeded.requestId,
      decisionBody(seeded, {
        evidence: [{ documentVersionId: foreign, evidenceType: 'signature' }],
      }),
      { version: seeded.version }
    );
    expect(response.status).toBe(404);
    // Nothing was written: the evidence is validated BEFORE the approval is inserted,
    // so an unusable version cannot leave a decision recorded with its evidence missing.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.customer_approvals WHERE additional_work_request_id = $1`,
        [seeded.requestId]
      )
    ).toBe(0);
    expect(await auditCount(STATE_CHANGED, seeded.requestId)).toBe(0);
  });

  it('refuses a rejected document version as evidence', async () => {
    const seeded = await seedRequest();
    const rejected = await seedDocumentVersion({ status: 'rejected' });

    // `accepted` is deliberately NOT required — P1-15 documented that acceptance is
    // unreachable because no application role may write `shared.file_scan_results`, so
    // demanding it would make evidence impossible. What CAN be refused is a version
    // somebody rejected, and it is.
    authAs(FULL);
    const response = await decide(
      seeded.requestId,
      decisionBody(seeded, {
        evidence: [{ documentVersionId: rejected, evidenceType: 'signature' }],
      }),
      { version: seeded.version }
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as ApprovalBody).code).toBe('ERR-DOC-001');
  });

  it('leaves nothing behind when the evidence step fails after the approval would have been written', async () => {
    const seeded = await seedRequest();
    const good = await seedDocumentVersion();
    const bad = await seedDocumentVersion({ tenantId: TENANT_B });

    // The rollback case: the first evidence entry is usable and the second is not, so
    // the transaction gets as far as validating one before refusing. Everything must be
    // absent — no approval, no evidence, no state change, no audit, no outbox row.
    authAs(FULL);
    const response = await decide(
      seeded.requestId,
      decisionBody(seeded, {
        evidence: [
          { documentVersionId: good, evidenceType: 'call_recording' },
          { documentVersionId: bad, evidenceType: 'signature' },
        ],
      }),
      { version: seeded.version }
    );
    expect(response.status).toBe(404);

    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.customer_approvals WHERE additional_work_request_id = $1`,
        [seeded.requestId]
      )
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.customer_approval_evidence
          WHERE document_version_id IN ($1, $2)`,
        [good, bad]
      )
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.additional_work_requests
          WHERE id = $1 AND state = 'pending'`,
        [seeded.requestId]
      )
    ).toBe(1);
    expect(await auditCount(STATE_CHANGED, seeded.requestId)).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM shared.event_outbox
          WHERE event_type = 'customer-approval.recorded'
            AND payload->>'additionalWorkRequestId' = $1`,
        [seeded.requestId]
      )
    ).toBe(0);
  });

  it('records the approval BEFORE the state change, which the deployed guard enforces', async () => {
    const seeded = await seedRequest();

    // The API cannot express the illegal order, so the guard is probed directly. This
    // is the control the whole surface rests on: without it, anyone able to update the
    // request could mark it approved with no decision recorded at all.
    const tenantId = await tenantOf(seeded.requestId);
    const client = await admin.connect();
    let refused = false;
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, tenantId]
      );
      await client.query(
        `UPDATE wo.additional_work_requests SET state = 'approved' WHERE id = $1`,
        [seeded.requestId]
      );
      await client.query('COMMIT');
    } catch (error) {
      refused = /cannot be approved without an approved customer approval/i.test(String(error));
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(refused).toBe(true);

    // And through the route, the approval row exists by the time the request says so.
    authAs(FULL);
    const response = await decide(seeded.requestId, decisionBody(seeded), {
      version: seeded.version,
    });
    expect(response.status).toBe(201);
    const ordered = await count(
      `SELECT count(*)::text AS n
         FROM wo.customer_approvals ca
         JOIN wo.additional_work_requests r ON r.id = ca.additional_work_request_id
        WHERE r.id = $1 AND r.state = 'approved' AND ca.decision = 'approved'
          AND ca.created_at <= r.updated_at`,
      [seeded.requestId]
    );
    expect(ordered).toBe(1);
  });

  it('leaves exactly one decision when two are raced', async () => {
    const seeded = await seedRequest();

    // Both in flight against the same request. `lockRequest` takes `FOR UPDATE`, so the
    // second serialises behind the first rather than racing the guard.
    authAs(FULL);
    const [a, b] = await Promise.all([
      decide(seeded.requestId, decisionBody(seeded), { version: seeded.version }),
      decide(seeded.requestId, decisionBody(seeded, { decision: 'rejected' }), {
        version: seeded.version,
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    // One winner. The loser is refused either by the row lock plus the state check
    // (ERR-TRN-001) or by the version predicate (ERR-CON-001) — both are correct
    // outcomes, and what must not happen is two decisions.
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(409);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.customer_approvals WHERE additional_work_request_id = $1`,
        [seeded.requestId]
      )
    ).toBe(1);
  });

  it('refuses a caller without wo.additional_work.approve', async () => {
    const seeded = await seedRequest();

    // `SENSITIVE` and `FULL` both hold the approve permission, so the probes are the
    // read-only principal and an unpermitted subject.
    authAs(READER);
    expect(
      (await decide(seeded.requestId, decisionBody(seeded), { version: seeded.version })).status
    ).toBe(403);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect(
      (await decide(seeded.requestId, decisionBody(seeded), { version: seeded.version })).status
    ).toBe(403);
  });

  it('isolates by branch and by tenant', async () => {
    const seeded = await seedRequest();

    authAs(PERMISSION_ELSEWHERE);
    expect(
      (await decide(seeded.requestId, decisionBody(seeded), { version: seeded.version })).status
    ).toBe(403);

    authAs(SCOPED_ELSEWHERE);
    expect(
      (await decide(seeded.requestId, decisionBody(seeded), { version: seeded.version })).status
    ).toBe(404);

    authAs(TENANT_B_FULL);
    expect(
      (await decide(seeded.requestId, decisionBody(seeded), { version: seeded.version })).status
    ).toBe(404);
  });

  it('keeps a tenant-B request outside a tenant-A caller’s reach entirely', async () => {
    const tenantB = await createOpenWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    const jobId = await (async () => {
      authAs(TENANT_B_FULL);
      const created = await CREATE_JOB(
        new Request(`http://localhost/api/v1/work-orders/${tenantB.workOrderId}/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({ title: 'Tenant B job' }),
        }),
        { params: Promise.resolve({ workOrderId: tenantB.workOrderId }) }
      );
      expect(created.status).toBe(201);
      return ((await created.json()) as { id: string }).id;
    })();

    authAs(TENANT_B_FULL);
    const raised = await RAISE_ADDITIONAL_WORK(
      new Request(`http://localhost/api/v1/work-orders/${tenantB.workOrderId}/additional-work`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ originatingJobId: jobId, summary: 'Tenant B extra work' }),
      }),
      { params: Promise.resolve({ workOrderId: tenantB.workOrderId }) }
    );
    expect(raised.status).toBe(201);
    const requestId = ((await raised.json()) as { id: string; recordVersion: number }).id;

    // A tenant-A caller with every permission sees nothing. The uniform 404 is RLS, and
    // it is what makes an id from another tenant indistinguishable from one that does
    // not exist.
    authAs(FULL);
    expect((await readApproval(requestId)).status).toBe(404);
  });

  it('records one decision on an idempotent replay', async () => {
    const seeded = await seedRequest();
    const key = crypto.randomUUID();

    authAs(FULL);
    const first = await decide(seeded.requestId, decisionBody(seeded), {
      version: seeded.version,
      key,
    });
    expect(first.status).toBe(201);
    const replay = await decide(seeded.requestId, decisionBody(seeded), {
      version: seeded.version,
      key,
    });
    expect(replay.status).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.customer_approvals WHERE additional_work_request_id = $1`,
        [seeded.requestId]
      )
    ).toBe(1);
    expect(await auditCount(STATE_CHANGED, seeded.requestId)).toBe(1);
  });
});

describe('wo.additional-work-approval-read', () => {
  it('returns the decision with its evidence', async () => {
    const seeded = await seedRequest();
    const versionId = await seedDocumentVersion();

    authAs(FULL);
    await decide(
      seeded.requestId,
      decisionBody(seeded, {
        evidence: [{ documentVersionId: versionId, evidenceType: 'signature', note: 'Signed pad' }],
      }),
      { version: seeded.version }
    );

    authAs(READER);
    const response = await readApproval(seeded.requestId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ApprovalBody['approval'];
    expect(body?.decision).toBe('approved');
    expect(body?.evidence).toHaveLength(1);
    expect(body?.decidedAt).toBeTruthy();
  });

  it('answers 404 for an undecided request, and isolates by branch and tenant', async () => {
    const seeded = await seedRequest();

    authAs(READER);
    expect((await readApproval(seeded.requestId)).status).toBe(404);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await readApproval(seeded.requestId)).status).toBe(403);

    authAs(PERMISSION_ELSEWHERE);
    expect((await readApproval(seeded.requestId)).status).toBe(403);

    authAs(SCOPED_ELSEWHERE);
    expect((await readApproval(seeded.requestId)).status).toBe(404);

    authAs(TENANT_B_FULL);
    expect((await readApproval(seeded.requestId)).status).toBe(404);
  });
});

describe(`the unapproved-work execution gate inside ${JOB_TRANSITION}`, () => {
  it(`${JOB_TRANSITION} blocks a job entering a labour state while its required request is pending`, async () => {
    const seeded = await seedRequest();
    await assign(seeded.jobId);

    // `assigned` has `labor_allowed = true` on the seeded platform graph, so this is
    // the gate. It is keyed on the flag, not on a state name, because the graph is
    // tenant-overridable.
    const job = await readJob(seeded.jobId);
    authAs(FULL);
    const response = await moveJob(seeded.jobId, { toState: 'assigned' }, job?.version ?? 0);
    expect(response.status).toBe(409);
    const problem = (await response.json()) as ApprovalBody;
    expect(problem.code).toBe('ERR-WO-002');
    expect(problem.violations?.[0]?.rule).toBe('awaiting_customer_decision');
    expect((await readJob(seeded.jobId))?.state).toBe('planned');
  });

  it(`${JOB_TRANSITION} permits the same transition once the customer has approved`, async () => {
    const seeded = await seedRequest();
    await assign(seeded.jobId);

    authAs(FULL);
    expect(
      (await decide(seeded.requestId, decisionBody(seeded), { version: seeded.version })).status
    ).toBe(201);

    const job = await readJob(seeded.jobId);
    authAs(FULL);
    const response = await moveJob(seeded.jobId, { toState: 'assigned' }, job?.version ?? 0);
    expect(response.status).toBe(200);
    expect((await readJob(seeded.jobId))?.state).toBe('assigned');
  });

  it('permits it once the customer has REJECTED, because B3 excludes rejected', async () => {
    const seeded = await seedRequest();
    await assign(seeded.jobId);

    // The customer refused the extra work. The originally authorised work continues —
    // that is what "according to the protected rules" means here, because
    // `wo.guard_work_order_closure`'s B3 fires on pending and on approved-unfulfilled
    // and never on rejected.
    authAs(FULL);
    expect(
      (
        await decide(seeded.requestId, decisionBody(seeded, { decision: 'rejected' }), {
          version: seeded.version,
        })
      ).status
    ).toBe(201);

    const job = await readJob(seeded.jobId);
    authAs(FULL);
    expect((await moveJob(seeded.jobId, { toState: 'assigned' }, job?.version ?? 0)).status).toBe(
      200
    );
  });

  it('does NOT block once approved but unfulfilled, which would deadlock the job', async () => {
    const seeded = await seedRequest();
    await assign(seeded.jobId);

    authAs(FULL);
    await decide(seeded.requestId, decisionBody(seeded), { version: seeded.version });
    // The request is now `approved` + `unfulfilled`, which IS B3's second limb and does
    // block closure. If the execution gate used it too, the job could never enter a
    // labour state, the approved work could never be done, and the request could never
    // become fulfilled — so B3 could never clear.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.additional_work_requests
          WHERE id = $1 AND state = 'approved' AND fulfillment_state = 'unfulfilled'`,
        [seeded.requestId]
      )
    ).toBe(1);

    let version = (await readJob(seeded.jobId))?.version ?? 0;
    authAs(FULL);
    const assigned = await moveJob(seeded.jobId, { toState: 'assigned' }, version);
    expect(assigned.status).toBe(200);
    version = ((await assigned.json()) as { recordVersion: number }).recordVersion;
    authAs(FULL);
    expect((await moveJob(seeded.jobId, { toState: 'in_progress' }, version)).status).toBe(200);
  });

  it('always permits a PAUSE, so the job can wait while the customer is asked', async () => {
    const seeded = await seedRequest();
    await assign(seeded.jobId);

    // Reach `in_progress` first, before any request gates the job: the pause is the
    // intended response to discovering extra work, and a gate that blocked it would
    // trap the job in a state it must not stay in.
    authAs(FULL);
    let version = (await readJob(seeded.jobId))?.version ?? 0;
    const cleared = await decide(seeded.requestId, decisionBody(seeded), {
      version: seeded.version,
    });
    expect(cleared.status).toBe(201);
    const assigned = await moveJob(seeded.jobId, { toState: 'assigned' }, version);
    version = ((await assigned.json()) as { recordVersion: number }).recordVersion;
    authAs(FULL);
    const started = await moveJob(seeded.jobId, { toState: 'in_progress' }, version);
    version = ((await started.json()) as { recordVersion: number }).recordVersion;

    // Now raise a SECOND required request from the same job and pause.
    authAs(FULL);
    const second = await RAISE_ADDITIONAL_WORK(
      new Request(`http://localhost/api/v1/work-orders/${seeded.workOrderId}/additional-work`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ originatingJobId: seeded.jobId, summary: 'Also the drop link' }),
      }),
      { params: Promise.resolve({ workOrderId: seeded.workOrderId }) }
    );
    expect(second.status).toBe(201);

    authAs(FULL);
    // `paused` has `labor_allowed = false`, so the gate does not apply.
    const paused = await moveJob(
      seeded.jobId,
      { toState: 'paused', reason: 'Awaiting the customer’s decision' },
      version
    );
    expect(paused.status).toBe(200);
    version = ((await paused.json()) as { recordVersion: number }).recordVersion;

    // And resuming IS gated, because `in_progress` allows labour.
    authAs(FULL);
    const resumed = await moveJob(seeded.jobId, { toState: 'in_progress' }, version);
    expect(resumed.status).toBe(409);
    expect(((await resumed.json()) as ApprovalBody).code).toBe('ERR-WO-002');
  });

  it('does not block on an OPTIONAL request', async () => {
    const seeded = await seedRequest({ isRequired: false });
    await assign(seeded.jobId);

    // B3 reads `is_required`, and so does the gate. Optional extra work is a suggestion,
    // not a precondition.
    const job = await readJob(seeded.jobId);
    authAs(FULL);
    expect((await moveJob(seeded.jobId, { toState: 'assigned' }, job?.version ?? 0)).status).toBe(
      200
    );
  });

  it('does not block a job when the request originates from a DIFFERENT job', async () => {
    const seeded = await seedRequest();
    const sibling = await createJob(seeded.workOrderId, 'Unrelated job');
    await assign(sibling);

    // The request names `seeded.jobId` as its origin, so it gates that job and not this
    // one. It still blocks CLOSURE through B3 — a different question at a different time.
    const job = await readJob(sibling);
    authAs(FULL);
    expect((await moveJob(sibling, { toState: 'assigned' }, job?.version ?? 0)).status).toBe(200);
  });

  it('does not block a job when the request belongs to another work order', async () => {
    const mine = await seedRequest();
    const other = await seedRequest();

    // Two orders, each with its own required pending request. Clearing one must not
    // release the other, and neither may gate the other's job.
    await assign(mine.jobId);
    authAs(FULL);
    expect(
      (await decide(mine.requestId, decisionBody(mine), { version: mine.version })).status
    ).toBe(201);
    const job = await readJob(mine.jobId);
    authAs(FULL);
    expect((await moveJob(mine.jobId, { toState: 'assigned' }, job?.version ?? 0)).status).toBe(
      200
    );

    await assign(other.jobId);
    const otherJob = await readJob(other.jobId);
    authAs(FULL);
    const blocked = await moveJob(other.jobId, { toState: 'assigned' }, otherJob?.version ?? 0);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as ApprovalBody).code).toBe('ERR-WO-002');
  });

  it('releases the gate when the request is withdrawn', async () => {
    const seeded = await seedRequest();
    await assign(seeded.jobId);

    authAs(FULL);
    const withdrawn = await WITHDRAW(
      new Request(`http://localhost/api/v1/additional-work/${seeded.requestId}/withdrawal`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          'if-match': String(seeded.version),
        },
        body: JSON.stringify({ reason: 'Raised in error' }),
      }),
      { params: Promise.resolve({ requestId: seeded.requestId }) }
    );
    expect(withdrawn.status).toBe(200);

    const job = await readJob(seeded.jobId);
    authAs(FULL);
    expect((await moveJob(seeded.jobId, { toState: 'assigned' }, job?.version ?? 0)).status).toBe(
      200
    );
  });
});

/** The tenant a request lives in, for the direct-guard probe. */
async function tenantOf(requestId: string): Promise<string> {
  const result = await admin.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM wo.additional_work_requests WHERE id = $1`,
    [requestId]
  );
  return result.rows[0]?.tenant_id ?? '';
}
