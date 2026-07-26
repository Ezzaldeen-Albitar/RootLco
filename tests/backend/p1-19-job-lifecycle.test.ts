/**
 * Job transitions and the job status ledger (Phase 1-19, P1-19-BE-011…012).
 *
 * This route is the ONLY way a job's state changes. `PATCH /jobs/{jobId}` cannot
 * write the column and the repository's UPDATE does not carry it, so the graph in
 * `wo.job_transitions` has no bypass — which is what makes the assignment
 * precondition below meaningful rather than advisory.
 *
 * The precondition is the thing to understand here. The job-assignments migration
 * REPLACED `wo.guard_job_transition` to refuse a target whose `assignment_required`
 * is true unless an ACTIVE `wo.job_assignments` row exists for the job. So
 * `planned → assigned` is a configured edge, needs no reason, and STILL fails until
 * a technician is assigned — a refusal that is invisible in the graph and would
 * surface as a bare `23514` if the service did not map it. Assignment itself is
 * Wave 5's next slice; this suite proves the refusal is a readable 422 today rather
 * than leaving it to be discovered as a 500 later.
 *
 * Operations exercised here: wo.job-transition, wo.job-history.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.job-transition: route service authorization success denial cross-tenant isolation audit outbox stale-version idempotency concurrency
 *   wo.job-history: route service authorization success denial cross-tenant isolation
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
  outboxCount,
  readJob,
  waitForBlockedBackends,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as JOB_TRANSITION } from '@/app/api/v1/jobs/[jobId]/transition/route';
import { GET as JOB_HISTORY } from '@/app/api/v1/jobs/[jobId]/history/route';

const STATE_CHANGED_ACTION = 'wo.job.state_changed';
const STATE_CHANGED_EVENT = 'job.state-changed';

let admin: Pool;
let runtime: Pool;

interface JobBody {
  readonly id: string;
  readonly workOrderId: string;
  readonly state: string;
  readonly recordVersion: number;
}

function transitionJob(
  jobId: string,
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
  return JOB_TRANSITION(
    new Request(`http://localhost/api/v1/jobs/${jobId}/transition`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );
}

function jobHistory(jobId: string, query: Record<string, string> = {}): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/jobs/${jobId}/history`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return JOB_HISTORY(new Request(url), { params: Promise.resolve({ jobId }) });
}

/** A `planned` job on an `open` work order, created through the real route. */
async function seedJob(
  input: { readonly branchId?: string; readonly tenantId?: string } = {}
): Promise<JobBody> {
  let workOrderId: string;
  let as = FULL;
  if (input.tenantId === TENANT_B) {
    const order = await createWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    await advance(order.workOrderId, [{ toState: 'open' }], TENANT_B_FULL);
    workOrderId = order.workOrderId;
    as = TENANT_B_FULL;
  } else {
    const order = await createOpenWorkOrder(
      input.branchId === undefined ? {} : { branchId: input.branchId }
    );
    workOrderId = order.workOrderId;
  }
  authAs(as);
  const response = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ title: 'Replace front pads' }),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
  if (response.status !== 201) {
    throw new Error(`fixture job creation failed with ${response.status}`);
  }
  return (await response.json()) as JobBody;
}

async function problem(response: Response): Promise<{
  code?: string;
  violations?: readonly { path: string; rule: string }[];
}> {
  return (await response.json()) as {
    code?: string;
    violations?: readonly { path: string; rule: string }[];
  };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
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

describe('wo.job-transition', () => {
  it('moves a job and writes ONE ledger row, ONE audit record and ONE event', async () => {
    const job = await seedJob();

    // `planned -> cancelled` requires a reason on the edge AND on the target state,
    // and needs no assignment — the only outbound edge from `planned` that a job
    // with no technician can take today.
    authAs(FULL);
    const response = await transitionJob(
      job.id,
      { toState: 'cancelled', reason: 'not required after inspection' },
      { version: job.recordVersion }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'cancelled', recordVersion: 2 });
    expect(response.headers.get('etag')).toBe('"2"');

    expect(await readJob(job.id)).toMatchObject({ state: 'cancelled', version: 2 });
    expect(await auditCount(STATE_CHANGED_ACTION, job.id)).toBe(1);
    expect(await outboxCount(STATE_CHANGED_EVENT, job.id)).toBe(1);

    const ledger = await admin.query<{
      from_state: string;
      to_state: string;
      reason: string | null;
      actor_id: string;
    }>(
      `SELECT from_state, to_state, reason, actor_id FROM wo.job_status_history
        WHERE job_id = $1`,
      [job.id]
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.from_state).toBe('planned');
    expect(ledger.rows[0]?.to_state).toBe('cancelled');
    // The reason reached the ledger, which it can only do through
    // `app.status_reason` — the same GUC the guard reads to decide whether the
    // reason was supplied at all.
    expect(ledger.rows[0]?.reason).toBe('not required after inspection');
    expect(ledger.rows[0]?.actor_id).toBe(FULL.userId);

    const event = await admin.query<{
      aggregate_type: string;
      producer: string;
      payload: { jobId: string; workOrderId: string; fromState: string; toState: string };
    }>(
      `SELECT aggregate_type, producer, payload FROM shared.event_outbox
        WHERE aggregate_id = $1 AND event_type = $2`,
      [job.id, STATE_CHANGED_EVENT]
    );
    expect(event.rows[0]?.aggregate_type).toBe('wo.job');
    // Owner `wo`, not `tech`: the job row belongs to the work-order module, and
    // `buildEventEnvelope` refuses a producer whose leading segment differs from the
    // catalog owner.
    expect(event.rows[0]?.producer).toBe('wo.work-order-service');
    expect(event.rows[0]?.payload.workOrderId).toBe(job.workOrderId);
    expect(event.rows[0]?.payload.fromState).toBe('planned');
  });

  it('refuses an assignment-required target while the job has no active assignment', async () => {
    const job = await seedJob();

    // `planned -> assigned` IS in the graph and needs no reason. What refuses it is
    // the precondition the assignments migration added to the guard, and it is
    // invisible in the graph — exactly the case that would otherwise reach a caller
    // as an unexplained 500.
    authAs(FULL);
    const response = await transitionJob(
      job.id,
      { toState: 'assigned' },
      { version: job.recordVersion }
    );
    expect(response.status).toBe(422);
    const detail = await problem(response);
    expect(detail.code).toBe('ERR-TECH-001');
    expect(detail.violations?.[0]?.rule).toBe('assignment_precondition');

    // Nothing moved, and nothing was recorded: the audit and the event are written
    // after the state change, so a refusal at the write leaves neither.
    expect(await readJob(job.id)).toMatchObject({ state: 'planned', version: 1 });
    expect(await auditCount(STATE_CHANGED_ACTION, job.id)).toBe(0);
    expect(await outboxCount(STATE_CHANGED_EVENT, job.id)).toBe(0);
  });

  it('refuses a missing reason, an absent edge, and any move out of a terminal state', async () => {
    const job = await seedJob();

    authAs(FULL);
    const noReason = await transitionJob(
      job.id,
      { toState: 'cancelled' },
      { version: job.recordVersion }
    );
    expect(noReason.status).toBe(422);
    expect((await problem(noReason)).code).toBe('ERR-VAL-001');

    // `planned -> completed` is not in the graph.
    authAs(FULL);
    const noEdge = await transitionJob(
      job.id,
      { toState: 'completed' },
      { version: job.recordVersion }
    );
    expect(noEdge.status).toBe(409);
    expect((await problem(noEdge)).code).toBe('ERR-TRN-001');

    // Terminal freeze: `cancelled` has no outbound edge and the guard refuses one
    // regardless of what the graph contains.
    authAs(FULL);
    expect(
      (
        await transitionJob(
          job.id,
          { toState: 'cancelled', reason: 'closing the job' },
          { version: job.recordVersion }
        )
      ).status
    ).toBe(200);
    authAs(FULL);
    const frozen = await transitionJob(job.id, { toState: 'assigned' }, { version: 2 });
    expect(frozen.status).toBe(409);
    expect((await problem(frozen)).code).toBe('ERR-TRN-001');
    expect(await readJob(job.id)).toMatchObject({ state: 'cancelled', version: 2 });
  });

  it('refuses a malformed state code, an unknown field, a malformed id and a missing If-Match', async () => {
    const job = await seedJob();

    authAs(FULL);
    expect((await transitionJob(job.id, { toState: 'CANCELLED' }, { version: 1 })).status).toBe(
      422
    );
    authAs(FULL);
    expect(
      (await transitionJob(job.id, { toState: 'cancelled', force: true }, { version: 1 })).status
    ).toBe(422);
    authAs(FULL);
    expect(
      (await transitionJob('not-a-uuid', { toState: 'cancelled' }, { version: 1 })).status
    ).toBe(422);
    authAs(FULL);
    const noIfMatch = await transitionJob(
      job.id,
      { toState: 'cancelled', reason: 'x' },
      { version: null }
    );
    expect(noIfMatch.status).toBe(428);
    expect((await problem(noIfMatch)).code).toBe('ERR-CON-002');

    expect(await readJob(job.id)).toMatchObject({ state: 'planned', version: 1 });
  });

  it('401, 403 without wo.job.transition, and a read-only principal is refused', async () => {
    const job = await seedJob();

    __resetAuthenticatorForTests();
    expect((await transitionJob(job.id, { toState: 'cancelled' }, { version: 1 })).status).toBe(
      401
    );

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await transitionJob(job.id, { toState: 'cancelled' }, { version: 1 })).status).toBe(
      403
    );

    // The reader holds `wo.work_order.read` and nothing else. Describing work and
    // declaring it started are different authorities, which is why the seeded
    // catalog gives `wo.job.transition` its own code.
    authAs(READER);
    const reader = await transitionJob(
      job.id,
      { toState: 'cancelled', reason: 'x' },
      { version: 1 }
    );
    expect(reader.status).toBe(403);
    expect((await problem(reader)).code).toBe('ERR-IAM-001');
    expect(await readJob(job.id)).toMatchObject({ state: 'planned', version: 1 });
  });

  it('isolation and cross-tenant: 403 where RLS admits the row, 404 where it does not', async () => {
    const inA1 = await seedJob();
    const inA2 = await seedJob({ branchId: BRANCH_A2 });
    const inB = await seedJob({ tenantId: TENANT_B });

    authAs(PERMISSION_ELSEWHERE);
    const refused = await transitionJob(
      inA1.id,
      { toState: 'cancelled', reason: 'out of scope' },
      { version: inA1.recordVersion }
    );
    expect(refused.status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect(
      (
        await transitionJob(
          inA1.id,
          { toState: 'cancelled', reason: 'invisible' },
          { version: inA1.recordVersion }
        )
      ).status
    ).toBe(404);
    // The same principal succeeds inside its granted branch, so the refusals above
    // are scope rather than a broken principal.
    authAs(PERMISSION_ELSEWHERE);
    expect(
      (
        await transitionJob(
          inA2.id,
          { toState: 'cancelled', reason: 'in scope' },
          { version: inA2.recordVersion }
        )
      ).status
    ).toBe(200);

    authAs(TENANT_B_FULL);
    const foreign = await transitionJob(
      inA1.id,
      { toState: 'cancelled', reason: 'foreign' },
      { version: inA1.recordVersion }
    );
    expect(foreign.status).toBe(404);
    expect((await problem(foreign)).code).toBe('ERR-RES-001');
    authAs(TENANT_B_FULL);
    expect(
      (await transitionJob(crypto.randomUUID(), { toState: 'cancelled' }, { version: 1 })).status
    ).toBe(404);
    // Tenant B moves its own job, so the 404 is isolation.
    authAs(TENANT_B_FULL);
    expect(
      (
        await transitionJob(
          inB.id,
          { toState: 'cancelled', reason: 'own job' },
          { version: inB.recordVersion }
        )
      ).status
    ).toBe(200);

    expect(await readJob(inA1.id)).toMatchObject({ state: 'planned', version: 1 });
  });

  it('refuses a stale version, replays one key once, and leaves one winner in a forced race', async () => {
    const stale = await seedJob();
    authAs(FULL);
    const wrongVersion = await transitionJob(
      stale.id,
      { toState: 'cancelled', reason: 'x' },
      { version: stale.recordVersion + 5 }
    );
    expect(wrongVersion.status).toBe(409);
    expect((await problem(wrongVersion)).code).toBe('ERR-CON-001');

    const replayed = await seedJob();
    const key = crypto.randomUUID();
    authAs(FULL);
    expect(
      (
        await transitionJob(
          replayed.id,
          { toState: 'cancelled', reason: 'replayed' },
          { version: replayed.recordVersion, key }
        )
      ).status
    ).toBe(200);
    authAs(FULL);
    const replay = await transitionJob(
      replayed.id,
      { toState: 'cancelled', reason: 'replayed' },
      { version: replayed.recordVersion, key }
    );
    expect(replay.status).toBe(200);
    expect(await readJob(replayed.id)).toMatchObject({ state: 'cancelled', version: 2 });
    expect(await auditCount(STATE_CHANGED_ACTION, replayed.id)).toBe(1);
    expect(await outboxCount(STATE_CHANGED_EVENT, replayed.id)).toBe(1);

    // A forced race: an admin transaction holds the job row, both requests must
    // block on it, and the lock is released only once both are provably waiting.
    const raced = await seedJob();
    const gate = await admin.connect();
    let released = false;
    try {
      await gate.query('BEGIN');
      await gate.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await gate.query('SELECT id FROM wo.jobs WHERE id = $1 FOR UPDATE', [raced.id]);
      authAs(FULL);
      const first = transitionJob(
        raced.id,
        { toState: 'cancelled', reason: 'race a' },
        { version: raced.recordVersion }
      );
      const second = transitionJob(
        raced.id,
        { toState: 'cancelled', reason: 'race b' },
        { version: raced.recordVersion }
      );
      await waitForBlockedBackends(2);
      await gate.query('ROLLBACK');
      released = true;
      const [a, b] = await Promise.all([first, second]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    } finally {
      if (!released) await gate.query('ROLLBACK').catch(() => undefined);
      gate.release();
    }
    expect(await readJob(raced.id)).toMatchObject({ state: 'cancelled', version: 2 });
    expect(await auditCount(STATE_CHANGED_ACTION, raced.id)).toBe(1);
    expect(await outboxCount(STATE_CHANGED_EVENT, raced.id)).toBe(1);
  });
});

describe('wo.job-history', () => {
  it('returns the ledger newest-first with the genesis state the ledger cannot hold', async () => {
    const job = await seedJob();
    authAs(FULL);
    expect(
      (
        await transitionJob(
          job.id,
          { toState: 'cancelled', reason: 'superseded by a warranty claim' },
          { version: job.recordVersion }
        )
      ).status
    ).toBe(200);

    authAs(READER);
    const response = await jobHistory(job.id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jobId: string;
      workOrderId: string;
      origin: { initialState: string };
      transitions: {
        items: readonly { fromState: string | null; toState: string; reason: string | null }[];
      };
    };
    expect(body.jobId).toBe(job.id);
    expect(body.workOrderId).toBe(job.workOrderId);
    expect(body.transitions.items.map((entry) => entry.toState)).toEqual(['cancelled']);
    expect(body.transitions.items[0]?.reason).toBe('superseded by a warranty claim');
    // The creation emits no ledger row — the emitter is AFTER UPDATE only — so the
    // opening state is derived from the oldest entry's own origin.
    expect(body.origin.initialState).toBe('planned');
  });

  it('reports the current state as the initial state while the ledger is empty', async () => {
    const job = await seedJob();

    authAs(READER);
    const body = (await (await jobHistory(job.id)).json()) as {
      origin: { initialState: string };
      transitions: { items: readonly unknown[]; nextCursor: string | null };
    };
    expect(body.transitions.items).toEqual([]);
    expect(body.transitions.nextCursor).toBeNull();
    expect(body.origin.initialState).toBe('planned');
  });

  it('401, 403, a malformed id, a bad cursor, another tenant and another branch', async () => {
    const job = await seedJob();

    __resetAuthenticatorForTests();
    expect((await jobHistory(job.id)).status).toBe(401);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await jobHistory(job.id)).status).toBe(403);

    authAs(READER);
    expect((await jobHistory('not-a-uuid')).status).toBe(422);
    authAs(READER);
    const badCursor = await jobHistory(job.id, { cursor: 'not-a-cursor' });
    expect(badCursor.status).toBe(400);
    expect((await problem(badCursor)).code).toBe('ERR-PAG-001');
    authAs(READER);
    expect((await jobHistory(crypto.randomUUID())).status).toBe(404);

    authAs(TENANT_B_FULL);
    expect((await jobHistory(job.id)).status).toBe(404);
    authAs(PERMISSION_ELSEWHERE);
    expect((await jobHistory(job.id)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await jobHistory(job.id)).status).toBe(404);
  });
});
