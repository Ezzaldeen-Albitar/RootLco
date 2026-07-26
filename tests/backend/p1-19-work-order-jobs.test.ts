/**
 * Job creation and update (Phase 1-19, P1-19-BE-009…010).
 *
 * Two properties here are the reason the suite exists, and both are the kind that
 * look fine in review and fail in production:
 *
 *  1. **A job's state cannot be written by the update path.** A job moves through
 *     `wo.job_transitions` and nowhere else. `state` is absent from the update
 *     schema, the schema is `.strict()` so naming it is a 422, and the repository's
 *     UPDATE does not carry the column — three independent refusals, because an
 *     update that could set the state would be the easiest possible bypass of the
 *     graph, the reason requirement and `wo.guard_job_transition`.
 *  2. **`PATCH /jobs/{jobId}` is addressed by job id alone**, so the pre-handler
 *     authorization check has no branch to narrow by and `scope: 'branch'` would be
 *     inert. The scope is re-decided against the LOCKED job's own company and
 *     branch (P1-18-A-01), and the isolation case proves a caller granted only in
 *     another branch is refused — which RLS alone cannot do, because
 *     `app.branch_ids` unions every active grant regardless of permission.
 *
 * The initial state is never a literal: `ck_jobs_state_format` checks only the
 * FORMAT, so the vocabulary is entirely `wo.job_states` and a tenant may shadow it.
 *
 * Operations exercised here: wo.job-create, wo.job-update.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.job-create: route service authorization success denial cross-tenant isolation audit idempotency
 *   wo.job-update: route service authorization success denial cross-tenant isolation audit stale-version
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  SUBJECT_UNPERMITTED,
  TENANT_A,
  TENANT_B,
  USER_A,
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
  TENANT_B_FULL,
  advance,
  auditCount,
  authAs,
  authAsSubject,
  createOpenWorkOrder,
  createWorkOrder,
  establishP1_19Fixtures,
  readJob,
  waitForBlockedBackends,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { PATCH as UPDATE_JOB } from '@/app/api/v1/jobs/[jobId]/route';

const CREATED_ACTION = 'wo.job.created';
const UPDATED_ACTION = 'wo.job.updated';

let admin: Pool;
let runtime: Pool;

function createJob(
  workOrderId: string,
  body: unknown,
  options: { readonly key?: string } = {}
): Promise<Response> {
  return CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/jobs`, {
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

function updateJob(
  jobId: string,
  body: unknown,
  options: { readonly version?: number | null } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return UPDATE_JOB(
    new Request(`http://localhost/api/v1/jobs/${jobId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );
}

interface JobBody {
  readonly id: string;
  readonly workOrderId: string;
  readonly title: string;
  readonly jobType: string | null;
  readonly state: string;
  readonly requiresDiagnostic: boolean;
  readonly recordVersion: number;
}

/** A job on an `open` work order, created through the real route. */
async function seedJob(
  input: { readonly branchId?: string; readonly tenantId?: string } = {}
): Promise<{ readonly job: JobBody; readonly workOrderId: string }> {
  const created =
    input.tenantId === TENANT_B
      ? await (async () => {
          const order = await createWorkOrder({
            tenantId: TENANT_B,
            companyId: COMPANY_B1,
            branchId: BRANCH_B1,
          });
          await advance(order.workOrderId, [{ toState: 'open' }], TENANT_B_FULL);
          return order;
        })()
      : await createOpenWorkOrder(input.branchId === undefined ? {} : { branchId: input.branchId });
  const as = input.tenantId === TENANT_B ? TENANT_B_FULL : FULL;
  authAs(as);
  const response = await createJob(created.workOrderId, { title: 'Replace front pads' });
  if (response.status !== 201) {
    throw new Error(`fixture job creation failed with ${response.status}`);
  }
  return { job: (await response.json()) as JobBody, workOrderId: created.workOrderId };
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

describe('wo.job-create', () => {
  it('adds a job in the catalog-resolved initial state, audited, with no event', async () => {
    const created = await createOpenWorkOrder();

    authAs(FULL);
    const response = await createJob(created.workOrderId, {
      title: 'Replace front pads',
      jobType: 'brakes',
      requiresDiagnostic: true,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as JobBody;
    expect(body.workOrderId).toBe(created.workOrderId);
    expect(body.title).toBe('Replace front pads');
    expect(body.jobType).toBe('brakes');
    expect(body.requiresDiagnostic).toBe(true);
    expect(body.recordVersion).toBe(1);
    // Resolved from `wo.job_states` — the lowest non-terminal state needing no
    // assignment — not from a literal.
    expect(body.state).toBe('planned');
    expect(response.headers.get('etag')).toBe('"1"');

    expect(await readJob(body.id)).toEqual({
      state: 'planned',
      title: 'Replace front pads',
      jobType: 'brakes',
      version: 1,
    });
    expect(await auditCount(CREATED_ACTION, body.id)).toBe(1);
    // The approved catalog reserves `job.assigned` and `job.state-changed` and
    // nothing for creation, so publishing anything here would be an invented event.
    const events = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM shared.event_outbox WHERE aggregate_id = $1`,
      [body.id]
    );
    expect(events.rows[0]?.n).toBe('0');
  });

  it('401 without an authenticator, 403 without wo.job.manage, and writes nothing', async () => {
    const created = await createOpenWorkOrder();

    __resetAuthenticatorForTests();
    expect((await createJob(created.workOrderId, { title: 'x' })).status).toBe(401);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await createJob(created.workOrderId, { title: 'x' })).status).toBe(403);

    // A read-only principal can see the work order and must not be able to add work
    // to it.
    authAs(READER);
    const reader = await createJob(created.workOrderId, { title: 'x' });
    expect(reader.status).toBe(403);
    expect(((await reader.json()) as { code: string }).code).toBe('ERR-IAM-001');

    const jobs = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.jobs WHERE work_order_id = $1`,
      [created.workOrderId]
    );
    expect(jobs.rows[0]?.n).toBe('0');
  });

  it('refuses a parent that does not accept jobs, a terminal parent, and a terminal initial state', async () => {
    // `draft` has allows_jobs = false. `wo.guard_job_refs` is the enforcement
    // point; the service turns it into a readable refusal rather than a raw 23514.
    const draft = await createWorkOrder();
    authAs(FULL);
    const tooEarly = await createJob(draft.workOrderId, { title: 'Premature' });
    expect(tooEarly.status).toBe(409);
    expect(((await tooEarly.json()) as { code: string }).code).toBe('ERR-TRN-001');

    const cancelled = await createWorkOrder();
    await advance(cancelled.workOrderId, [
      { toState: 'cancelled', reason: 'customer withdrew the vehicle' },
    ]);
    authAs(FULL);
    expect((await createJob(cancelled.workOrderId, { title: 'After the end' })).status).toBe(409);

    // A job may not be born terminal, and an unconfigured state is not a state.
    const open = await createOpenWorkOrder();
    authAs(FULL);
    const terminal = await createJob(open.workOrderId, {
      title: 'Done already',
      state: 'completed',
    });
    expect(terminal.status).toBe(422);
    expect(
      ((await terminal.json()) as { violations?: { rule: string }[] }).violations?.[0]?.rule
    ).toBe('terminal_state');
    authAs(FULL);
    const unknown = await createJob(open.workOrderId, { title: 'Odd', state: 'not_a_job_state' });
    expect(unknown.status).toBe(422);
    expect(
      ((await unknown.json()) as { violations?: { rule: string }[] }).violations?.[0]?.rule
    ).toBe('unknown_state');
  });

  it('refuses a blank title, an oversized title, an unknown field and a malformed parent id', async () => {
    const open = await createOpenWorkOrder();

    authAs(FULL);
    expect((await createJob(open.workOrderId, { title: '   ' })).status).toBe(422);
    authAs(FULL);
    expect((await createJob(open.workOrderId, { title: 'x'.repeat(201) })).status).toBe(422);
    authAs(FULL);
    expect((await createJob(open.workOrderId, { title: 'ok', unexpected: 1 })).status).toBe(422);
    authAs(FULL);
    expect((await createJob(open.workOrderId, {})).status).toBe(422);
    authAs(FULL);
    expect((await createJob('not-a-uuid', { title: 'ok' })).status).toBe(422);
  });

  it('a replay under one idempotency key adds one job, not two', async () => {
    const open = await createOpenWorkOrder();
    const key = crypto.randomUUID();

    authAs(FULL);
    const first = await createJob(open.workOrderId, { title: 'Balance wheels' }, { key });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as JobBody;

    authAs(FULL);
    const replay = await createJob(open.workOrderId, { title: 'Balance wheels' }, { key });
    // The platform replays the STORED response, and the store answers 200 rather
    // than repeating the original 201 — a replay did not create anything.
    expect(replay.status).toBe(200);
    expect((await replay.json()) as JobBody).toEqual(firstBody);

    const jobs = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.jobs WHERE work_order_id = $1`,
      [open.workOrderId]
    );
    expect(jobs.rows[0]?.n).toBe('1');
    expect(await auditCount(CREATED_ACTION, firstBody.id)).toBe(1);
  });

  it('isolation and cross-tenant: refused in another branch, refused across tenants, allowed in its own', async () => {
    const inA1 = await createOpenWorkOrder();
    const inA2 = await createOpenWorkOrder({ branchId: BRANCH_A2 });

    // Visible through the widening grant, so RLS cannot refuse it; the deferred
    // scoped permission check does (P1-18-A-01).
    authAs(PERMISSION_ELSEWHERE);
    expect((await createJob(inA1.workOrderId, { title: 'Out of scope' })).status).toBe(403);
    authAs(PERMISSION_ELSEWHERE);
    expect((await createJob(inA2.workOrderId, { title: 'In scope' })).status).toBe(201);
    // No grant in A1 at all: the row is invisible, so the uniform 404.
    authAs(SCOPED_ELSEWHERE);
    expect((await createJob(inA1.workOrderId, { title: 'Invisible' })).status).toBe(404);

    authAs(TENANT_B_FULL);
    const foreign = await createJob(inA1.workOrderId, { title: 'Foreign' });
    expect(foreign.status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await createJob(crypto.randomUUID(), { title: 'Unknown' })).status).toBe(404);
  });
});

describe('wo.job-update', () => {
  it('updates the descriptive fields, bumps the version, and audits only what moved', async () => {
    const { job } = await seedJob();

    authAs(FULL);
    const response = await updateJob(
      job.id,
      { title: 'Replace front and rear pads', jobType: 'brakes', requiresDiagnostic: true },
      { version: job.recordVersion }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as JobBody;
    expect(body.title).toBe('Replace front and rear pads');
    expect(body.jobType).toBe('brakes');
    expect(body.requiresDiagnostic).toBe(true);
    expect(body.recordVersion).toBe(job.recordVersion + 1);
    // The state is untouched: this path cannot move a job.
    expect(body.state).toBe('planned');
    expect(response.headers.get('etag')).toBe(`"${job.recordVersion + 1}"`);

    expect(await readJob(job.id)).toEqual({
      state: 'planned',
      title: 'Replace front and rear pads',
      jobType: 'brakes',
      version: job.recordVersion + 1,
    });
    expect(await auditCount(UPDATED_ACTION, job.id)).toBe(1);

    const details = await admin.query<{ field: string }>(
      `SELECT d.field_name AS field
         FROM iam.audit_record_details d
         JOIN iam.audit_records r ON r.id = d.audit_record_id
        WHERE r.action = $1 AND r.entity_id = $2
        ORDER BY d.field_name`,
      [UPDATED_ACTION, job.id]
    );
    // `job_type` moved from NULL to 'brakes' and `requires_diagnostic` from false
    // to true; the title moved too. An audit entry claiming an unchanged field
    // moved is as misleading as a missing one.
    expect(details.rows.map((row) => row.field)).toEqual([
      'job_type',
      'requires_diagnostic',
      'title',
    ]);
  });

  it('omitting jobType clears it, and omitting requiresDiagnostic preserves it', async () => {
    const { job } = await seedJob();

    authAs(FULL);
    const withType = await updateJob(
      job.id,
      { title: job.title, jobType: 'brakes', requiresDiagnostic: true },
      { version: job.recordVersion }
    );
    expect(withType.status).toBe(200);
    const first = (await withType.json()) as JobBody;

    // A full replacement of the descriptive fields: an absent `jobType` means
    // "clear it". `requiresDiagnostic` is the deliberate exception — it drives
    // closure blocker B4, so omitting it must not silently drop a diagnostic
    // requirement.
    authAs(FULL);
    const cleared = await updateJob(
      job.id,
      { title: 'Retitled' },
      { version: first.recordVersion }
    );
    expect(cleared.status).toBe(200);
    const second = (await cleared.json()) as JobBody;
    expect(second.jobType).toBeNull();
    expect(second.requiresDiagnostic).toBe(true);
    expect(await readJob(job.id)).toMatchObject({ jobType: null, title: 'Retitled' });
  });

  it('refuses any attempt to write the state, so the graph has no bypass', async () => {
    const { job } = await seedJob();

    // `.strict()` makes naming the column a validation failure rather than a
    // silently ignored field — a caller must be told the write did not happen.
    for (const body of [
      { title: job.title, state: 'completed' },
      { title: job.title, state: 'in_progress' },
      { state: 'completed' },
    ]) {
      authAs(FULL);
      const response = await updateJob(job.id, body, { version: job.recordVersion });
      expect(response.status).toBe(422);
    }
    expect(await readJob(job.id)).toMatchObject({ state: 'planned', version: 1 });
  });

  it('refuses a stale version, a missing If-Match, a blank title and a malformed id', async () => {
    const { job } = await seedJob();

    authAs(FULL);
    const stale = await updateJob(job.id, { title: 'Nope' }, { version: job.recordVersion + 5 });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe('ERR-CON-001');

    authAs(FULL);
    const noIfMatch = await updateJob(job.id, { title: 'Nope' }, { version: null });
    expect(noIfMatch.status).toBe(428);
    expect(((await noIfMatch.json()) as { code: string }).code).toBe('ERR-CON-002');

    authAs(FULL);
    expect((await updateJob(job.id, { title: '  ' }, { version: job.recordVersion })).status).toBe(
      422
    );
    authAs(FULL);
    expect((await updateJob('not-a-uuid', { title: 'x' }, { version: 1 })).status).toBe(422);

    expect(await readJob(job.id)).toMatchObject({ title: 'Replace front pads', version: 1 });
  });

  it('401, 403, and an unknown job id', async () => {
    const { job } = await seedJob();

    __resetAuthenticatorForTests();
    expect((await updateJob(job.id, { title: 'x' }, { version: 1 })).status).toBe(401);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await updateJob(job.id, { title: 'x' }, { version: 1 })).status).toBe(403);

    authAs(READER);
    expect((await updateJob(job.id, { title: 'x' }, { version: 1 })).status).toBe(403);

    authAs(FULL);
    expect((await updateJob(crypto.randomUUID(), { title: 'x' }, { version: 1 })).status).toBe(404);
  });

  it('isolation: the branch scope is decided on the LOCKED job, not on the path', async () => {
    const inA1 = await seedJob();
    const inA2 = await seedJob({ branchId: BRANCH_A2 });

    // There is no branch in `/jobs/{jobId}`, so the pre-handler check had nothing
    // to narrow by. Only the deferred check against the LOCKED job's own scope can
    // refuse this — RLS cannot, because this principal's widening grant puts
    // BRANCH_A1 into `iam.allowed_branch_ids()` and that union is blind to which
    // permission each grant carries.
    authAs(PERMISSION_ELSEWHERE);
    const refused = await updateJob(
      inA1.job.id,
      { title: 'Out of scope' },
      { version: inA1.job.recordVersion }
    );
    expect(refused.status).toBe(403);
    expect(await readJob(inA1.job.id)).toMatchObject({ title: 'Replace front pads', version: 1 });

    // A caller with no grant in A1 at all cannot see the job: the uniform 404.
    authAs(SCOPED_ELSEWHERE);
    expect(
      (await updateJob(inA1.job.id, { title: 'Invisible' }, { version: inA1.job.recordVersion }))
        .status
    ).toBe(404);

    authAs(PERMISSION_ELSEWHERE);
    const allowed = await updateJob(
      inA2.job.id,
      { title: 'In scope' },
      { version: inA2.job.recordVersion }
    );
    expect(allowed.status).toBe(200);
    expect(await readJob(inA2.job.id)).toMatchObject({ title: 'In scope', version: 2 });
  });

  it('cross-tenant: a tenant-A job is invisible to tenant B and the reverse', async () => {
    const inA = await seedJob();
    const inB = await seedJob({ tenantId: TENANT_B });

    authAs(TENANT_B_FULL);
    const foreign = await updateJob(
      inA.job.id,
      { title: 'Foreign edit' },
      { version: inA.job.recordVersion }
    );
    expect(foreign.status).toBe(404);
    expect(((await foreign.json()) as { code: string }).code).toBe('ERR-RES-001');
    expect(await readJob(inA.job.id)).toMatchObject({ title: 'Replace front pads', version: 1 });

    authAs(FULL);
    expect(
      (await updateJob(inB.job.id, { title: 'Reverse' }, { version: inB.job.recordVersion })).status
    ).toBe(404);

    // Each tenant edits its own, so the 404s above are isolation rather than a
    // broken route.
    authAs(TENANT_B_FULL);
    expect(
      (await updateJob(inB.job.id, { title: 'Own edit' }, { version: inB.job.recordVersion }))
        .status
    ).toBe(200);
  });

  it('a job cannot be re-parented, because the update path names no parent at all', async () => {
    const first = await seedJob();
    const second = await createOpenWorkOrder();

    authAs(FULL);
    const attempt = await updateJob(
      first.job.id,
      { title: 'Move me', workOrderId: second.workOrderId },
      { version: first.job.recordVersion }
    );
    expect(attempt.status).toBe(422);
    const stillThere = await admin.query<{ work_order_id: string }>(
      `SELECT work_order_id FROM wo.jobs WHERE id = $1`,
      [first.job.id]
    );
    expect(stillThere.rows[0]?.work_order_id).toBe(first.workOrderId);
  });
});

describe('the job/work-order transaction boundary', () => {
  it('a job insert serialises against a concurrent close rather than racing it', async () => {
    // The window this closes is real and invisible in review: `createJob` reads the
    // parent WITHOUT a lock to produce a readable refusal, so the parent can become
    // terminal between that read and the INSERT. `wo.guard_job_refs` locks the
    // parent FOR UPDATE inside the insert, so the insert WAITS on a cancellation in
    // flight and then sees the terminal parent.
    //
    // Arranged so the unlocked read sees `in_progress`, which does allow jobs — the
    // point is to get past the pre-check and be refused by the guard. The refusal
    // arrives as a bare `check_violation` and must surface as a 409, not a 500.
    const created = await createOpenWorkOrder();
    await advance(created.workOrderId, [{ toState: 'in_progress' }]);

    const gate = await admin.connect();
    let settled = false;
    try {
      await gate.query('BEGIN');
      await gate.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true),
                set_config('app.status_reason','customer recalled the vehicle',true)`,
        [USER_A, TENANT_A]
      );
      // A cancellation, so the closure blockers are bypassed and this arrangement
      // needs no QC or job completion — the parent simply becomes terminal.
      await gate.query(`UPDATE wo.work_orders SET state = 'cancelled' WHERE id = $1`, [
        created.workOrderId,
      ]);

      authAs(FULL);
      const pending = createJob(created.workOrderId, { title: 'Sneaked in' });
      await waitForBlockedBackends(1);
      await gate.query('COMMIT');
      settled = true;
      const response = await pending;
      expect(response.status).toBe(409);
      expect(((await response.json()) as { code: string }).code).toBe('ERR-TRN-001');
    } finally {
      if (!settled) await gate.query('ROLLBACK').catch(() => undefined);
      gate.release();
    }

    const jobs = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.jobs WHERE work_order_id = $1 AND title = 'Sneaked in'`,
      [created.workOrderId]
    );
    expect(jobs.rows[0]?.n).toBe('0');
  });
});
