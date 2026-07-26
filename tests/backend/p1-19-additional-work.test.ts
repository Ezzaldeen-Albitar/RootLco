/**
 * Additional-work requests and their restricted detail (Phase 1-19, P1-19-BE-006).
 *
 * Two claims carry this suite, and both are asserted rather than described.
 *
 * **Provenance is real.** `fk_additional_work_requests_job` is the composite scope key,
 * so it pins the originating job to the same BRANCH and not to the same work order — a
 * job under a different order in the same branch satisfies it, and that is exactly the
 * fixture used below. `originating_finding_id` has no foreign key at all, so nothing in
 * the database refuses a finding from another work order or a uuid that names nothing;
 * a read through the `diagnostics` module is the only check there is, and its absence
 * would have been invisible to the database.
 *
 * **The restricted description is a separate authority.** `iam.sensitive.view` is
 * required on both detail operations IN ADDITION to the functional permission, and the
 * suite proves the two directions with two principals that differ by exactly that one
 * permission: `FULL` (refused) and `SENSITIVE` (served). It also proves the negative
 * that matters — that the description never reaches the request list, the audit trail
 * or an event payload — because a gate that only guards one door is not a gate.
 *
 * Operations exercised here: wo.additional-work-request, wo.additional-work-list,
 * wo.additional-work-detail-record, wo.additional-work-detail-read,
 * wo.additional-work-withdraw, wo.additional-work-fulfillment.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.additional-work-request: route service authorization success denial cross-tenant isolation audit outbox idempotency
 *   wo.additional-work-list: route service authorization success denial cross-tenant isolation
 *   wo.additional-work-detail-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   wo.additional-work-detail-read: route service authorization success denial cross-tenant isolation audit
 *   wo.additional-work-withdraw: route service authorization success denial cross-tenant isolation audit stale-version idempotency
 *   wo.additional-work-fulfillment: route service authorization success denial cross-tenant isolation audit stale-version idempotency
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  SUBJECT_UNPERMITTED,
  TENANT_A,
  TENANT_B,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import {
  BRANCH_A2,
  BRANCH_B1,
  COMPANY_B1,
  FULL,
  PERMISSION_ELSEWHERE,
  READER,
  SCOPED_ELSEWHERE,
  SENSITIVE,
  TENANT_B_FULL,
  advance,
  auditCount,
  authAs,
  authAsSubject,
  count,
  createOpenWorkOrder,
  createWorkOrder,
  establishP1_19Fixtures,
  outboxCount,
  partyRoleFor,
  seedFinding,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import {
  GET as LIST_ADDITIONAL_WORK,
  POST as RAISE_ADDITIONAL_WORK,
} from '@/app/api/v1/work-orders/[workOrderId]/additional-work/route';
import {
  GET as READ_DETAIL,
  PUT as WRITE_DETAIL,
} from '@/app/api/v1/additional-work/[requestId]/detail/route';
import { POST as WITHDRAW } from '@/app/api/v1/additional-work/[requestId]/withdrawal/route';
import { POST as SET_FULFILLMENT } from '@/app/api/v1/additional-work/[requestId]/fulfillment/route';
import { POST as RECORD_APPROVAL } from '@/app/api/v1/additional-work/[requestId]/approval/route';

const REQUESTED = 'wo.additional_work.requested';
const STATE_CHANGED = 'wo.additional_work.state_changed';
const DETAIL_RECORDED = 'wo.additional_work.detail_recorded';
const DETAIL_READ = 'wo.additional_work.detail_read';
const FULFILLMENT_CHANGED = 'wo.additional_work.fulfillment_changed';
/**
 * The restricted text, carrying a token that appears NOWHERE else.
 *
 * The leak assertion searches the audit trail for this token, so it must not overlap
 * the summary — an earlier version shared the words "track rod" with it and the
 * assertion failed against the request's own perfectly legitimate summary audit,
 * which would have read as a leak that was not one.
 */
const RESTRICTED_TOKEN = 'ZZRESTRICTEDZZ';
const RESTRICTED = `Customer told: nearside end has play, MOT advisory ${RESTRICTED_TOKEN}`;

let admin: Pool;
let runtime: Pool;

interface RequestBody {
  readonly id: string;
  readonly workOrderId: string;
  readonly originatingJobId: string | null;
  readonly originatingFindingId: string | null;
  readonly summary: string;
  readonly state: string;
  readonly fulfillmentState: string;
  readonly isRequired: boolean;
  readonly recordVersion: number;
  readonly code?: string;
  readonly violations?: readonly { readonly path?: string; readonly rule?: string }[];
}

function raise(
  workOrderId: string,
  body: unknown,
  options: { readonly key?: string } = {}
): Promise<Response> {
  return RAISE_ADDITIONAL_WORK(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/additional-work`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.key ?? crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
}

function listRequests(workOrderId: string): Promise<Response> {
  return LIST_ADDITIONAL_WORK(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/additional-work`),
    { params: Promise.resolve({ workOrderId }) }
  );
}

function writeDetail(
  requestId: string,
  body: unknown,
  options: { readonly key?: string } = {}
): Promise<Response> {
  return WRITE_DETAIL(
    new Request(`http://localhost/api/v1/additional-work/${requestId}/detail`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.key ?? crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ requestId }) }
  );
}

function readDetail(requestId: string): Promise<Response> {
  return READ_DETAIL(new Request(`http://localhost/api/v1/additional-work/${requestId}/detail`), {
    params: Promise.resolve({ requestId }),
  });
}

function versioned(
  handler: (
    request: Request,
    route: { params: Promise<{ requestId: string }> }
  ) => Promise<Response>,
  segment: string,
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
  return handler(
    new Request(`http://localhost/api/v1/additional-work/${requestId}/${segment}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ requestId }) }
  );
}

const withdraw = (
  requestId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> => versioned(WITHDRAW, 'withdrawal', requestId, body, options);

const setFulfillment = (
  requestId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> => versioned(SET_FULFILLMENT, 'fulfillment', requestId, body, options);

/** Creates a job on a work order through the real route, returning its id. */
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
  if (response.status !== 201) {
    throw new Error(`fixture job creation failed with ${response.status}`);
  }
  return ((await response.json()) as { id: string }).id;
}

/** A work order in `open` with one job and one required pending request on it. */
async function orderWithRequest(): Promise<{
  readonly workOrderId: string;
  readonly visitId: string;
  readonly jobId: string;
  readonly requestId: string;
  readonly version: number;
}> {
  const order = await createOpenWorkOrder();
  const jobId = await createJob(order.workOrderId);
  authAs(FULL);
  const response = await raise(order.workOrderId, {
    originatingJobId: jobId,
    summary: 'Track rod end has play',
  });
  if (response.status !== 201) {
    throw new Error(`fixture request failed with ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as RequestBody;
  return {
    workOrderId: order.workOrderId,
    visitId: order.visitId,
    jobId,
    requestId: body.id,
    version: body.recordVersion,
  };
}

/** Approves a request through the real route, so fulfilment has a legal starting state. */
async function approve(requestId: string, visitId: string, version: number): Promise<number> {
  authAs(FULL);
  const response = await RECORD_APPROVAL(
    new Request(`http://localhost/api/v1/additional-work/${requestId}/approval`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': String(version),
      },
      body: JSON.stringify({
        decision: 'approved',
        channel: 'phone',
        decidingPartyRoleId: await partyRoleFor(visitId),
        presentedScope: 'Track rod end replacement, parts and labour',
      }),
    }),
    { params: Promise.resolve({ requestId }) }
  );
  if (response.status !== 201) {
    throw new Error(`fixture approval failed with ${response.status}: ${await response.text()}`);
  }
  return ((await response.json()) as { request: { recordVersion: number } }).request.recordVersion;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
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

describe('wo.additional-work-request', () => {
  it('raises a request from a job, audits it once and publishes once', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);

    authAs(FULL);
    const response = await raise(order.workOrderId, {
      originatingJobId: jobId,
      summary: 'Track rod end has play',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as RequestBody;
    expect(body.workOrderId).toBe(order.workOrderId);
    expect(body.originatingJobId).toBe(jobId);
    expect(body.originatingFindingId).toBeNull();
    // Both defaults come from the schema and both matter: `pending` and `unfulfilled`
    // are exactly the pair closure blocker B3's first limb fires on.
    expect(body.state).toBe('pending');
    expect(body.fulfillmentState).toBe('unfulfilled');
    // Silence means required. The safe reading is that a vehicle should not leave with
    // discovered work undone, and `is_required` is immutable after insert.
    expect(body.isRequired).toBe(true);

    expect(await auditCount(REQUESTED, body.id)).toBe(1);
    expect(await outboxCount('additional-work.requested', body.id)).toBe(1);
  });

  it('accepts an explicitly optional request', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);

    authAs(FULL);
    const response = await raise(order.workOrderId, {
      originatingJobId: jobId,
      summary: 'Wiper blades are marginal',
      isRequired: false,
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as RequestBody).isRequired).toBe(false);
  });

  it('refuses a request with neither origin', async () => {
    const order = await createOpenWorkOrder();

    // Both columns are nullable, so this is the application's rule and not the
    // database's: additional work whose provenance is unrecorded cannot be traced back
    // to what discovered it, which is the only reason those columns exist.
    authAs(FULL);
    const response = await raise(order.workOrderId, { summary: 'Something else is wrong' });
    expect(response.status).toBe(422);
    const problem = (await response.json()) as RequestBody;
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.rule).toBe('origin_required');
  });

  it('refuses a job that belongs to a DIFFERENT work order in the same branch', async () => {
    const mine = await createOpenWorkOrder();
    const other = await createOpenWorkOrder();
    const foreignJob = await createJob(other.workOrderId, 'Someone else’s job');

    // The composite foreign key is satisfied by this job — same tenant, company and
    // branch — so the database would have accepted it. Only the explicit ownership
    // check refuses it, and without that check the provenance would silently point at
    // work on another vehicle.
    authAs(FULL);
    const response = await raise(mine.workOrderId, {
      originatingJobId: foreignJob,
      summary: 'Attributed to the wrong order',
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as RequestBody).code).toBe('ERR-RES-001');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.additional_work_requests WHERE work_order_id = $1`,
        [mine.workOrderId]
      )
    ).toBe(0);
  });

  it('accepts a real finding, and DERIVES the originating job from it', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);
    const findingId = await seedFinding(order.workOrderId, jobId);

    // The positive half of the provenance check. Without it an implementation that
    // refused EVERY finding — including by never reading the diagnostics module at
    // all — would pass every other case in this suite, because they are all
    // refusals.
    authAs(FULL);
    const response = await raise(order.workOrderId, {
      originatingFindingId: findingId,
      summary: 'Raised from a diagnostic finding',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as RequestBody;
    expect(body.originatingFindingId).toBe(findingId);
    // Derived, not left null. The execution gate keys on `originating_job_id`, so a
    // finding-only request would otherwise have gated no job — extra work found by a
    // diagnostic would let the very job that found it carry on unapproved, while the
    // same work found by hand stopped it.
    expect(body.originatingJobId).toBe(jobId);
  });

  it('refuses a caller-named job that disagrees with the finding’s own job', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);
    const sibling = await createJob(order.workOrderId, 'A different job');
    const findingId = await seedFinding(order.workOrderId, jobId);

    // Both references are individually valid and both belong to this work order, so
    // nothing in the database objects. Two different answers to "where did this come
    // from" mean one is wrong, and silently reconciling them would record a
    // provenance nobody stated.
    authAs(FULL);
    const response = await raise(order.workOrderId, {
      originatingJobId: sibling,
      originatingFindingId: findingId,
      summary: 'Contradictory provenance',
    });
    expect(response.status).toBe(422);
    const problem = (await response.json()) as RequestBody;
    expect(problem.code).toBe('ERR-VAL-001');
    expect(problem.violations?.[0]?.rule).toBe('origin_conflict');
  });

  it('accepts a finding whose job the caller also names, when they agree', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);
    const findingId = await seedFinding(order.workOrderId, jobId);

    // Naming both is permitted rather than refused: a finding is discovered while
    // working a job, so the pair is more informative than either alone and nothing in
    // the schema treats them as alternatives.
    authAs(FULL);
    const response = await raise(order.workOrderId, {
      originatingJobId: jobId,
      originatingFindingId: findingId,
      summary: 'Both origins, in agreement',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as RequestBody;
    expect(body.originatingJobId).toBe(jobId);
    expect(body.originatingFindingId).toBe(findingId);
  });

  it('refuses a finding that belongs to ANOTHER work order', async () => {
    const mine = await createOpenWorkOrder();
    const other = await createOpenWorkOrder();
    const otherJob = await createJob(other.workOrderId);
    const foreignFinding = await seedFinding(other.workOrderId, otherJob);

    // `originating_finding_id` carries no foreign key at all, so this uuid would have
    // been stored happily and the request would claim provenance on another vehicle's
    // diagnostic.
    authAs(FULL);
    const response = await raise(mine.workOrderId, {
      originatingFindingId: foreignFinding,
      summary: 'Provenance from someone else’s vehicle',
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as RequestBody).code).toBe('ERR-RES-001');
  });

  it('refuses a finding that resolves to nothing', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);

    // `originating_finding_id` carries NO foreign key, so an arbitrary uuid would have
    // been stored happily. The refusal comes from a read through the `diagnostics`
    // module — the only possible check, and one the database cannot make.
    authAs(FULL);
    const response = await raise(order.workOrderId, {
      originatingJobId: jobId,
      originatingFindingId: crypto.randomUUID(),
      summary: 'Cites a finding that does not exist',
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as RequestBody).code).toBe('ERR-RES-001');
  });

  it('refuses a state whose allows_additional_work is false, even though it is not terminal', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);
    // `qc_pending` is non-terminal and carries `allows_additional_work = false` on the
    // seeded platform graph — the case terminality alone would have missed, letting a
    // technician widen the scope of an order already presented for quality control.
    await advance(order.workOrderId, [{ toState: 'in_progress' }, { toState: 'qc_pending' }]);

    authAs(FULL);
    const response = await raise(order.workOrderId, {
      originatingJobId: jobId,
      summary: 'Discovered after the work was submitted for QC',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as RequestBody).code).toBe('ERR-TRN-001');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.additional_work_requests WHERE work_order_id = $1`,
        [order.workOrderId]
      )
    ).toBe(0);
  });

  it('refuses a terminal work order', async () => {
    const order = await createWorkOrder();
    // `draft → cancelled` is a real configured edge and `cancelled` is terminal.
    const cancelled = await advance(order.workOrderId, [
      { toState: 'cancelled', reason: 'Customer withdrew' },
    ]);
    expect(cancelled).toBeGreaterThan(0);

    authAs(FULL);
    const response = await raise(order.workOrderId, {
      originatingFindingId: crypto.randomUUID(),
      summary: 'Too late',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as RequestBody).code).toBe('ERR-TRN-001');
  });

  it('refuses a blank summary and an unknown field', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);

    authAs(FULL);
    expect(
      (await raise(order.workOrderId, { originatingJobId: jobId, summary: '   ' })).status
    ).toBe(422);
    // `.strict()`: a client sending `description` here would otherwise believe it had
    // recorded the restricted text through an ungated surface.
    expect(
      (
        await raise(order.workOrderId, {
          originatingJobId: jobId,
          summary: 'Valid',
          description: RESTRICTED,
        })
      ).status
    ).toBe(422);
  });

  it('refuses a caller without wo.additional_work.request', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);

    authAs(READER);
    expect(
      (await raise(order.workOrderId, { originatingJobId: jobId, summary: 'No' })).status
    ).toBe(403);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect(
      (await raise(order.workOrderId, { originatingJobId: jobId, summary: 'No' })).status
    ).toBe(403);
  });

  it('refuses a principal granted in another branch, and distinguishes 403 from 404', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);

    // `PERMISSION_ELSEWHERE` holds an unrelated grant in BRANCH_A1, so RLS makes the
    // row VISIBLE and only the scoped permission check can refuse the write.
    authAs(PERMISSION_ELSEWHERE);
    expect(
      (await raise(order.workOrderId, { originatingJobId: jobId, summary: 'No' })).status
    ).toBe(403);

    // `SCOPED_ELSEWHERE` holds nothing in BRANCH_A1, so RLS hides the row first. The
    // 404 is defence in depth; the 403 above is the control.
    authAs(SCOPED_ELSEWHERE);
    expect(
      (await raise(order.workOrderId, { originatingJobId: jobId, summary: 'No' })).status
    ).toBe(404);
  });

  it('refuses a tenant-B caller against a tenant-A work order', async () => {
    const order = await createOpenWorkOrder();

    authAs(TENANT_B_FULL);
    const response = await raise(order.workOrderId, {
      originatingFindingId: crypto.randomUUID(),
      summary: 'Cross-tenant',
    });
    expect(response.status).toBe(404);
  });

  it('adds one request on an idempotent replay, not two', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);
    const key = crypto.randomUUID();

    authAs(FULL);
    const first = await raise(
      order.workOrderId,
      { originatingJobId: jobId, summary: 'Once' },
      { key }
    );
    expect(first.status).toBe(201);
    const replay = await raise(
      order.workOrderId,
      { originatingJobId: jobId, summary: 'Once' },
      { key }
    );
    // A replay returns the recorded response, which for a command whose first answer
    // was 201 is served as 200 by the platform's idempotency layer.
    expect(replay.status).toBe(200);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.additional_work_requests WHERE work_order_id = $1`,
        [order.workOrderId]
      )
    ).toBe(1);
  });
});

describe('wo.additional-work-list', () => {
  it('lists live requests oldest first and carries no restricted description', async () => {
    const seeded = await orderWithRequest();

    authAs(SENSITIVE);
    expect((await writeDetail(seeded.requestId, { description: RESTRICTED })).status).toBe(200);

    // Read by the principal that CAN see restricted data. Even for it, the list is the
    // safe projection: the description has its own operation, so nothing can reach it
    // by listing.
    authAs(SENSITIVE);
    const response = await listRequests(seeded.workOrderId);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(RESTRICTED);
    const body = JSON.parse(text) as { items: readonly RequestBody[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.summary).toBe('Track rod end has play');
  });

  it('refuses an unpermitted caller and isolates by branch and tenant', async () => {
    const seeded = await orderWithRequest();

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await listRequests(seeded.workOrderId)).status).toBe(403);

    authAs(PERMISSION_ELSEWHERE);
    expect((await listRequests(seeded.workOrderId)).status).toBe(403);

    authAs(SCOPED_ELSEWHERE);
    expect((await listRequests(seeded.workOrderId)).status).toBe(404);

    authAs(TENANT_B_FULL);
    expect((await listRequests(seeded.workOrderId)).status).toBe(404);
  });
});

describe('wo.additional-work-detail-record and wo.additional-work-detail-read', () => {
  it('records and reads the restricted description for a caller holding iam.sensitive.view', async () => {
    const seeded = await orderWithRequest();

    authAs(SENSITIVE);
    const written = await writeDetail(seeded.requestId, { description: RESTRICTED });
    expect(written.status).toBe(200);
    const detail = (await written.json()) as { description: string; classification: string };
    expect(detail.description).toBe(RESTRICTED);
    // CHECK-fixed to a single value; a row claiming anything else cannot exist.
    expect(detail.classification).toBe('restricted');
    expect(await auditCount(DETAIL_RECORDED, seeded.requestId)).toBe(1);

    authAs(SENSITIVE);
    const read = await readDetail(seeded.requestId);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { description: string }).description).toBe(RESTRICTED);
    // A read of restricted data is itself recorded — the one read in this module that is.
    expect(await auditCount(DETAIL_READ, seeded.requestId)).toBe(1);
  });

  it('refuses a caller with the operation permission but WITHOUT iam.sensitive.view', async () => {
    const seeded = await orderWithRequest();

    // `FULL` holds `wo.additional_work.request` and `wo.work_order.read` and differs
    // from `SENSITIVE` by exactly one permission. This is the control: the operation
    // declares `iam.sensitive.view` as a second requirement, and permissions are a
    // conjunction, so the refusal happens before any row is touched.
    authAs(FULL);
    expect((await writeDetail(seeded.requestId, { description: RESTRICTED })).status).toBe(403);
    expect((await readDetail(seeded.requestId)).status).toBe(403);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.additional_work_request_details
          WHERE additional_work_request_id = $1`,
        [seeded.requestId]
      )
    ).toBe(0);
  });

  it('does not put the restricted text into the audit trail', async () => {
    const seeded = await orderWithRequest();

    authAs(SENSITIVE);
    expect((await writeDetail(seeded.requestId, { description: RESTRICTED })).status).toBe(200);

    // `iam.audit_records` is NOT gated by `iam.sensitive.view`, so a detail row copied
    // into an audit record would be readable by every auditor — routing restricted data
    // around the gate that protects it. The audit records the FACT and the length.
    const leaked = await count(
      `SELECT count(*)::text AS n FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.entity_id = $1
          AND (d.new_value_masked LIKE '%' || $2 || '%'
               OR d.old_value_masked LIKE '%' || $2 || '%')`,
      [seeded.requestId, RESTRICTED_TOKEN]
    );
    expect(leaked).toBe(0);

    // And the detail row itself DOES hold it, so the assertion above is about where the
    // text lives rather than about the text having been dropped on the floor.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.additional_work_request_details
          WHERE additional_work_request_id = $1 AND description = $2`,
        [seeded.requestId, RESTRICTED]
      )
    ).toBe(1);
  });

  it('replaces the description rather than refusing a second write', async () => {
    const seeded = await orderWithRequest();

    authAs(SENSITIVE);
    expect((await writeDetail(seeded.requestId, { description: RESTRICTED })).status).toBe(200);
    authAs(SENSITIVE);
    const replaced = await writeDetail(seeded.requestId, { description: 'Corrected wording' });
    expect(replaced.status).toBe(200);
    expect(((await replaced.json()) as { description: string }).description).toBe(
      'Corrected wording'
    );
    // Still 1:1 — `uq_additional_work_request_details_request` is a partial unique index
    // over live rows, and the write path infers it rather than inserting a second row.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.additional_work_request_details
          WHERE additional_work_request_id = $1 AND deleted_at IS NULL`,
        [seeded.requestId]
      )
    ).toBe(1);
  });

  it('answers 404 for a request with no recorded description', async () => {
    const seeded = await orderWithRequest();

    authAs(SENSITIVE);
    const response = await readDetail(seeded.requestId);
    expect(response.status).toBe(404);
    // The caller HOLDS the sensitive permission, so this 404 genuinely means "no
    // detail" rather than "hidden from you" — which is why the operation declares the
    // permission instead of letting the policy silently return nothing.
    expect(((await response.json()) as RequestBody).code).toBe('ERR-RES-001');
  });

  it('isolates the detail surface by branch and by tenant', async () => {
    const seeded = await orderWithRequest();
    authAs(SENSITIVE);
    await writeDetail(seeded.requestId, { description: RESTRICTED });

    // Both hold `iam.sensitive.view`, scoped to BRANCH_A2 — so a refusal here is the
    // SCOPE check refusing, not a missing permission.
    authAs(PERMISSION_ELSEWHERE);
    expect((await readDetail(seeded.requestId)).status).toBe(403);
    expect((await writeDetail(seeded.requestId, { description: 'No' })).status).toBe(403);

    authAs(SCOPED_ELSEWHERE);
    expect((await readDetail(seeded.requestId)).status).toBe(404);

    authAs(TENANT_B_FULL);
    expect((await readDetail(seeded.requestId)).status).toBe(404);
  });

  it('is idempotent on replay', async () => {
    const seeded = await orderWithRequest();
    const key = crypto.randomUUID();

    authAs(SENSITIVE);
    expect((await writeDetail(seeded.requestId, { description: RESTRICTED }, { key })).status).toBe(
      200
    );
    expect((await writeDetail(seeded.requestId, { description: RESTRICTED }, { key })).status).toBe(
      200
    );
    expect(await auditCount(DETAIL_RECORDED, seeded.requestId)).toBe(1);
  });
});

describe('wo.additional-work-withdraw', () => {
  it('withdraws a pending request and records the reason', async () => {
    const seeded = await orderWithRequest();

    authAs(FULL);
    const response = await withdraw(
      seeded.requestId,
      { reason: 'Raised against the wrong vehicle' },
      { version: seeded.version }
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as RequestBody).state).toBe('withdrawn');
    expect(await auditCount(STATE_CHANGED, seeded.requestId)).toBe(1);
  });

  it('refuses a second withdrawal, because withdrawn is terminal', async () => {
    const seeded = await orderWithRequest();

    authAs(FULL);
    const first = await withdraw(
      seeded.requestId,
      { reason: 'Mistake' },
      { version: seeded.version }
    );
    expect(first.status).toBe(200);
    const version = ((await first.json()) as RequestBody).recordVersion;

    authAs(FULL);
    const second = await withdraw(seeded.requestId, { reason: 'Again' }, { version });
    expect(second.status).toBe(409);
    expect(((await second.json()) as RequestBody).code).toBe('ERR-TRN-001');
  });

  it('refuses a stale version and a missing If-Match', async () => {
    const seeded = await orderWithRequest();

    authAs(FULL);
    const stale = await withdraw(
      seeded.requestId,
      { reason: 'Stale' },
      { version: seeded.version + 5 }
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as RequestBody).code).toBe('ERR-CON-001');

    authAs(FULL);
    const missing = await withdraw(seeded.requestId, { reason: 'No header' }, { version: null });
    expect(missing.status).toBe(428);
  });

  it('requires a reason', async () => {
    const seeded = await orderWithRequest();
    authAs(FULL);
    expect((await withdraw(seeded.requestId, {}, { version: seeded.version })).status).toBe(422);
  });

  it('refuses an unpermitted, out-of-branch or cross-tenant caller', async () => {
    const seeded = await orderWithRequest();

    authAs(READER);
    expect(
      (await withdraw(seeded.requestId, { reason: 'No' }, { version: seeded.version })).status
    ).toBe(403);

    authAs(PERMISSION_ELSEWHERE);
    expect(
      (await withdraw(seeded.requestId, { reason: 'No' }, { version: seeded.version })).status
    ).toBe(403);

    authAs(SCOPED_ELSEWHERE);
    expect(
      (await withdraw(seeded.requestId, { reason: 'No' }, { version: seeded.version })).status
    ).toBe(404);

    authAs(TENANT_B_FULL);
    expect(
      (await withdraw(seeded.requestId, { reason: 'No' }, { version: seeded.version })).status
    ).toBe(404);
  });

  it('withdraws once on an idempotent replay', async () => {
    const seeded = await orderWithRequest();
    const key = crypto.randomUUID();

    authAs(FULL);
    expect(
      (await withdraw(seeded.requestId, { reason: 'Once' }, { version: seeded.version, key }))
        .status
    ).toBe(200);
    expect(
      (await withdraw(seeded.requestId, { reason: 'Once' }, { version: seeded.version, key }))
        .status
    ).toBe(200);
    expect(await auditCount(STATE_CHANGED, seeded.requestId)).toBe(1);
  });
});

describe('wo.additional-work-fulfillment', () => {
  it('records approved additional work as fulfilled', async () => {
    const seeded = await orderWithRequest();
    const version = await approve(seeded.requestId, seeded.visitId, seeded.version);

    authAs(FULL);
    const response = await setFulfillment(
      seeded.requestId,
      { fulfillmentState: 'fulfilled' },
      { version }
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as RequestBody).fulfillmentState).toBe('fulfilled');
    expect(await auditCount(FULFILLMENT_CHANGED, seeded.requestId)).toBe(1);
  });

  it('requires a reason to waive, and records it', async () => {
    const seeded = await orderWithRequest();
    const version = await approve(seeded.requestId, seeded.visitId, seeded.version);

    authAs(FULL);
    const missing = await setFulfillment(
      seeded.requestId,
      { fulfillmentState: 'waived' },
      { version }
    );
    expect(missing.status).toBe(422);

    authAs(FULL);
    const waived = await setFulfillment(
      seeded.requestId,
      { fulfillmentState: 'waived', reason: 'Customer collected before the part arrived' },
      { version }
    );
    expect(waived.status).toBe(200);
    expect(((await waived.json()) as RequestBody).fulfillmentState).toBe('waived');
  });

  it('refuses fulfilment of a request that is not approved', async () => {
    const seeded = await orderWithRequest();

    // Recording pending work as done would record work the customer has not agreed to.
    authAs(FULL);
    const pending = await setFulfillment(
      seeded.requestId,
      { fulfillmentState: 'fulfilled' },
      { version: seeded.version }
    );
    expect(pending.status).toBe(409);
    expect(((await pending.json()) as RequestBody).code).toBe('ERR-TRN-001');
  });

  it('refuses unfulfilled as a target, and an unknown value', async () => {
    const seeded = await orderWithRequest();
    const version = await approve(seeded.requestId, seeded.visitId, seeded.version);

    // `unfulfilled` is in the CHECK vocabulary and is deliberately not settable: moving
    // back to it would un-record a completion nobody retracted, and no trigger freezes
    // the column, so nothing in the schema would refuse it.
    authAs(FULL);
    expect(
      (await setFulfillment(seeded.requestId, { fulfillmentState: 'unfulfilled' }, { version }))
        .status
    ).toBe(422);
    authAs(FULL);
    expect(
      (await setFulfillment(seeded.requestId, { fulfillmentState: 'not_required' }, { version }))
        .status
    ).toBe(422);
  });

  it('refuses a stale version, and an unpermitted, out-of-branch or cross-tenant caller', async () => {
    const seeded = await orderWithRequest();
    const version = await approve(seeded.requestId, seeded.visitId, seeded.version);

    authAs(FULL);
    const stale = await setFulfillment(
      seeded.requestId,
      { fulfillmentState: 'fulfilled' },
      { version: version + 3 }
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as RequestBody).code).toBe('ERR-CON-001');

    authAs(READER);
    expect(
      (await setFulfillment(seeded.requestId, { fulfillmentState: 'fulfilled' }, { version }))
        .status
    ).toBe(403);

    authAs(PERMISSION_ELSEWHERE);
    expect(
      (await setFulfillment(seeded.requestId, { fulfillmentState: 'fulfilled' }, { version }))
        .status
    ).toBe(403);

    authAs(SCOPED_ELSEWHERE);
    expect(
      (await setFulfillment(seeded.requestId, { fulfillmentState: 'fulfilled' }, { version }))
        .status
    ).toBe(404);

    authAs(TENANT_B_FULL);
    expect(
      (await setFulfillment(seeded.requestId, { fulfillmentState: 'fulfilled' }, { version }))
        .status
    ).toBe(404);
  });

  it('refuses fulfilment once the work order is terminal', async () => {
    const order = await createOpenWorkOrder();
    const jobId = await createJob(order.workOrderId);
    authAs(FULL);
    const raised = await raise(order.workOrderId, {
      originatingJobId: jobId,
      summary: 'Optional extra, approved and not yet done',
      // OPTIONAL, so B3 ignores it entirely and the order can close with it still
      // `approved` + `unfulfilled` — which is exactly the state that made this
      // reachable. B3's second limb only ever looks at REQUIRED requests.
      isRequired: false,
    });
    const body = (await raised.json()) as RequestBody;
    const version = await approve(body.id, order.visitId, body.recordVersion);

    // Cancel the order, which is terminal and bypasses B1–B6 by design.
    await advance(order.workOrderId, [
      { toState: 'cancelled', reason: 'Customer took the vehicle away' },
    ]);

    authAs(FULL);
    const response = await setFulfillment(body.id, { fulfillmentState: 'fulfilled' }, { version });
    // Every other command on this aggregate refuses a terminal parent, and an earlier
    // draft of the service left this one writable — so a closed order's record could
    // be marked fulfilled after the vehicle was released, or a fulfilled one flipped
    // to `waived`, rewriting the fact the closure was granted on.
    expect(response.status).toBe(409);
    expect(((await response.json()) as RequestBody).code).toBe('ERR-TRN-001');
    expect(
      await count(
        `SELECT count(*)::text AS n FROM wo.additional_work_requests
          WHERE id = $1 AND fulfillment_state = 'unfulfilled'`,
        [body.id]
      )
    ).toBe(1);
  });

  it('applies once on an idempotent replay', async () => {
    const seeded = await orderWithRequest();
    const version = await approve(seeded.requestId, seeded.visitId, seeded.version);
    const key = crypto.randomUUID();

    authAs(FULL);
    expect(
      (await setFulfillment(seeded.requestId, { fulfillmentState: 'fulfilled' }, { version, key }))
        .status
    ).toBe(200);
    expect(
      (await setFulfillment(seeded.requestId, { fulfillmentState: 'fulfilled' }, { version, key }))
        .status
    ).toBe(200);
    expect(await auditCount(FULFILLMENT_CHANGED, seeded.requestId)).toBe(1);
  });
});

describe('cross-tenant containment of the whole surface', () => {
  it('keeps a tenant-B request invisible to tenant A and vice versa', async () => {
    const tenantB = await createOpenWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });

    authAs(TENANT_B_FULL);
    const raised = await raise(tenantB.workOrderId, {
      originatingFindingId: crypto.randomUUID(),
      summary: 'Tenant B work',
    });
    // Tenant B has no diagnostics either, so the finding check refuses it — which is
    // itself the point: the same rule applies in both tenants.
    expect(raised.status).toBe(404);

    // And tenant A cannot see tenant B's work order at all.
    authAs(FULL);
    expect((await listRequests(tenantB.workOrderId)).status).toBe(404);
    expect(TENANT_A).not.toBe(TENANT_B);
    expect(BRANCH_A2).toBeTruthy();
  });
});
