/**
 * Labour sessions: start, stop, correct, and the job's labour log (Phase 1-19,
 * P1-19-BE-017…019).
 *
 * The invariants this suite exists for:
 *
 *  1. **No timestamp is accepted on the recording path.** `started_at` and `ended_at`
 *     are the server clock. The one place a caller may state a window is a correction,
 *     behind its own higher-risk permission.
 *  2. **One open session per technician, and it is an EXCLUDE.**
 *     `ex_labor_sessions_overlap` covers `tstzrange(started_at, COALESCE(ended_at,
 *     'infinity'))`, so two open sessions overlap by construction and arrive as
 *     `23P01`. A technician double-clocked onto two jobs is a payroll and liability
 *     problem, so it is mapped rather than surfacing as a 500.
 *  3. **`ended_at` is write-once and a correction is a NEW ROW.**
 *     `tech.correct_labor_session` soft-deletes the original and inserts a linked
 *     replacement, so the corrected hours and the hours they replaced both survive.
 *  4. **Pause is not a column.** A pause is stopping the session plus a job transition
 *     into `paused`, whose `reason_required` is true — so the reason lives in
 *     `wo.job_status_history`. The suite drives the whole pause/resume cycle through
 *     the real routes to prove the two halves compose.
 *
 * Operations exercised here: tech.labor-session-start, tech.labor-session-list,
 * tech.labor-session-stop, tech.labor-session-correct.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   tech.labor-session-start: route service authorization success denial cross-tenant isolation audit outbox idempotency concurrency
 *   tech.labor-session-list: route service authorization success denial cross-tenant isolation
 *   tech.labor-session-stop: route service authorization success denial cross-tenant isolation audit outbox stale-version
 *   tech.labor-session-correct: route service authorization success denial cross-tenant isolation audit outbox stale-version
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
  SPLIT_WINDOW,
  TECH_A1,
  TECH_A1_ALT,
  TECH_A1_INACTIVE,
  TECH_A2,
  TECH_B1,
  TENANT_B_FULL,
  advance,
  auditCount,
  authAs,
  authAsSubject,
  createOpenWorkOrder,
  createWorkOrder,
  establishP1_19Fixtures,
  establishTechnicianFixtures,
  outboxCount,
  readJob,
  waitForBlockedBackends,
} from './p1-19-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as JOB_TRANSITION } from '@/app/api/v1/jobs/[jobId]/transition/route';
import { POST as ASSIGN } from '@/app/api/v1/jobs/[jobId]/assignments/route';
import {
  GET as LIST_SESSIONS,
  POST as START,
} from '@/app/api/v1/jobs/[jobId]/labor-sessions/route';
import { POST as STOP } from '@/app/api/v1/labor-sessions/[sessionId]/stop/route';
import { POST as CORRECT } from '@/app/api/v1/labor-sessions/[sessionId]/corrections/route';

const STARTED_ACTION = 'tech.labor.session_started';
const STOPPED_ACTION = 'tech.labor.session_stopped';
const CORRECTED_ACTION = 'tech.labor.session_corrected';
const SESSION_EVENT = 'labor.session-changed';

let admin: Pool;
let runtime: Pool;

interface SessionBody {
  readonly id: string;
  readonly technicianProfileId: string;
  readonly jobId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly source: string;
  readonly correctionOfId: string | null;
  readonly recordVersion: number;
}

function start(
  jobId: string,
  body: unknown,
  options: { readonly key?: string } = {}
): Promise<Response> {
  return START(
    new Request(`http://localhost/api/v1/jobs/${jobId}/labor-sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.key ?? crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );
}

function listSessions(jobId: string, query: Record<string, string> = {}): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/jobs/${jobId}/labor-sessions`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return LIST_SESSIONS(new Request(url), { params: Promise.resolve({ jobId }) });
}

function stop(
  sessionId: string,
  options: { readonly version?: number | null } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return STOP(
    new Request(`http://localhost/api/v1/labor-sessions/${sessionId}/stop`, {
      method: 'POST',
      headers,
    }),
    { params: Promise.resolve({ sessionId }) }
  );
}

function correct(
  sessionId: string,
  body: unknown,
  options: { readonly version?: number | null } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return CORRECT(
    new Request(`http://localhost/api/v1/labor-sessions/${sessionId}/corrections`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId }) }
  );
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

/**
 * A job in `in_progress` with `TECH_A1` assigned — the only state that allows labour.
 *
 * `labor_allowed` is false for `planned`, so the fixture must walk the real graph:
 * assign, then `planned → assigned → in_progress`. That walk is itself only possible
 * because the assignment exists, which is the precondition
 * `wo.guard_job_transition` added.
 */
async function seedWorkingJob(
  input: {
    readonly branchId?: string;
    readonly tenantId?: string;
    readonly technicianProfileId?: string;
  } = {}
): Promise<{ readonly id: string; readonly workOrderId: string; readonly version: number }> {
  const tenantB = input.tenantId === TENANT_B;
  const as = tenantB ? TENANT_B_FULL : FULL;
  let workOrderId: string;
  if (tenantB) {
    const order = await createWorkOrder({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    await advance(order.workOrderId, [{ toState: 'open' }], TENANT_B_FULL);
    workOrderId = order.workOrderId;
  } else {
    const order = await createOpenWorkOrder(
      input.branchId === undefined ? {} : { branchId: input.branchId }
    );
    workOrderId = order.workOrderId;
  }

  authAs(as);
  const created = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ title: 'Replace front pads' }),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
  if (created.status !== 201) throw new Error(`job creation failed with ${created.status}`);
  const job = (await created.json()) as { id: string; recordVersion: number };

  const technicianProfileId =
    input.technicianProfileId ??
    (tenantB ? TECH_B1 : input.branchId === BRANCH_A2 ? TECH_A2 : TECH_A1);
  authAs(as);
  const assigned = await ASSIGN(
    new Request(`http://localhost/api/v1/jobs/${job.id}/assignments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        technicianProfileId,
        window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
      }),
    }),
    { params: Promise.resolve({ jobId: job.id }) }
  );
  if (assigned.status !== 201) {
    throw new Error(`assignment failed with ${assigned.status}: ${await assigned.text()}`);
  }

  let version = job.recordVersion;
  for (const toState of ['assigned', 'in_progress']) {
    authAs(as);
    const moved = await JOB_TRANSITION(
      new Request(`http://localhost/api/v1/jobs/${job.id}/transition`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          'if-match': String(version),
        },
        body: JSON.stringify({ toState }),
      }),
      { params: Promise.resolve({ jobId: job.id }) }
    );
    if (moved.status !== 200) {
      throw new Error(`job move to ${toState} failed with ${moved.status}: ${await moved.text()}`);
    }
    version = ((await moved.json()) as { recordVersion: number }).recordVersion;
  }
  return { id: job.id, workOrderId, version };
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

/**
 * Closes every session this suite left open, as admin.
 *
 * `ex_labor_sessions_overlap` is per TECHNICIAN and tenant-wide, not per job: an open
 * session left behind by one test makes every later `start` for that technician fail
 * with the very refusal one of the tests is asserting. Without this the suite would
 * pass or fail on execution order, which is worse than a fixture that resets — and
 * `ended_at` is settable from NULL, so this uses the same write the route would.
 */
afterEach(async () => {
  __resetAuthenticatorForTests();
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `UPDATE tech.labor_sessions SET ended_at = now(), updated_by = $1
        WHERE ended_at IS NULL AND deleted_at IS NULL`,
      [USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('tech.labor-session-start', () => {
  it('starts a session on the server clock, audits it and publishes one event', async () => {
    const job = await seedWorkingJob();
    const before = Date.now();

    authAs(FULL);
    const response = await start(job.id, { technicianProfileId: TECH_A1 });
    expect(response.status).toBe(201);
    const body = (await response.json()) as SessionBody;
    expect(body.jobId).toBe(job.id);
    expect(body.technicianProfileId).toBe(TECH_A1);
    expect(body.endedAt).toBeNull();
    expect(body.correctionOfId).toBeNull();
    // `manual`, because a request IS a manual entry. `timer` is reserved for a
    // device-driven producer this phase does not build, and `correction` may only be
    // written by the protected function.
    expect(body.source).toBe('manual');
    // The clock is the server's: no timestamp was sent, and the recorded start is
    // within the request's own window.
    expect(Date.parse(body.startedAt)).toBeGreaterThanOrEqual(before - 60_000);
    expect(Date.parse(body.startedAt)).toBeLessThanOrEqual(Date.now() + 1_000);

    expect(await auditCount(STARTED_ACTION, body.id)).toBe(1);
    expect(await outboxCount(SESSION_EVENT, body.id)).toBe(1);
    const event = await admin.query<{ producer: string; event_key: string }>(
      `SELECT producer, event_key FROM shared.event_outbox WHERE aggregate_id = $1`,
      [body.id]
    );
    // Owner `tech` here, unlike the job events: the labour session IS the aggregate
    // and this module writes it, so the producer prefix matches the catalog owner.
    expect(event.rows[0]?.producer).toBe('tech.labor-session-service');
    expect(event.rows[0]?.event_key).toBe(`labor.session-changed:${body.id}:started`);
  });

  it('refuses a second open session for the same technician — the EXCLUDE, not a lookup', async () => {
    const first = await seedWorkingJob();
    const second = await seedWorkingJob({ technicianProfileId: TECH_A1_ALT });

    authAs(FULL);
    expect((await start(first.id, { technicianProfileId: TECH_A1 })).status).toBe(201);

    // A different JOB, the same technician. Two open sessions would put one person on
    // two jobs at once; the partial gist EXCLUDE makes that impossible because two
    // infinite ranges always overlap.
    authAs(FULL);
    const double = await start(second.id, { technicianProfileId: TECH_A1 });
    expect(double.status).toBe(422);
    expect((await problem(double)).violations?.[0]?.rule).toBe('session-already-open');

    // The other technician is unaffected — the constraint is per technician.
    authAs(FULL);
    expect((await start(second.id, { technicianProfileId: TECH_A1_ALT })).status).toBe(201);
  });

  it('refuses labour on a job state that does not allow it, and on an inactive technician', async () => {
    // `planned` has `labor_allowed = false`; `tech.guard_labor_session` enforces it.
    const order = await createOpenWorkOrder();
    authAs(FULL);
    const created = await CREATE_JOB(
      new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ title: 'Not started yet' }),
      }),
      { params: Promise.resolve({ workOrderId: order.workOrderId }) }
    );
    const planned = (await created.json()) as { id: string };
    authAs(FULL);
    const tooEarly = await start(planned.id, { technicianProfileId: TECH_A1 });
    expect(tooEarly.status).toBe(409);
    expect((await problem(tooEarly)).code).toBe('ERR-TRN-001');

    const working = await seedWorkingJob();
    authAs(FULL);
    const inactive = await start(working.id, { technicianProfileId: TECH_A1_INACTIVE });
    expect(inactive.status).toBe(422);
    expect((await problem(inactive)).violations?.[0]?.rule).toBe('profile-inactive');
  });

  it('401, 403 without tech.labor.record, malformed input, and a replayed key', async () => {
    const job = await seedWorkingJob();

    __resetAuthenticatorForTests();
    expect((await start(job.id, { technicianProfileId: TECH_A1 })).status).toBe(401);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await start(job.id, { technicianProfileId: TECH_A1 })).status).toBe(403);
    authAs(READER);
    const reader = await start(job.id, { technicianProfileId: TECH_A1 });
    expect(reader.status).toBe(403);
    expect((await problem(reader)).code).toBe('ERR-IAM-001');

    // No timestamp is accepted on this path at all.
    authAs(FULL);
    expect(
      (await start(job.id, { technicianProfileId: TECH_A1, startedAt: SPLIT_WINDOW.from })).status
    ).toBe(422);
    authAs(FULL);
    expect((await start(job.id, {})).status).toBe(422);
    authAs(FULL);
    expect((await start('not-a-uuid', { technicianProfileId: TECH_A1 })).status).toBe(422);

    const key = crypto.randomUUID();
    authAs(FULL);
    const first = await start(job.id, { technicianProfileId: TECH_A1 }, { key });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as SessionBody;
    authAs(FULL);
    const replay = await start(job.id, { technicianProfileId: TECH_A1 }, { key });
    expect(replay.status).toBe(200);
    expect((await replay.json()) as SessionBody).toEqual(firstBody);
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tech.labor_sessions WHERE job_id = $1`,
      [job.id]
    );
    expect(rows.rows[0]?.n).toBe('1');
  });

  it('isolation and cross-tenant: 403 where RLS admits the profile, 404 where it does not', async () => {
    const inA1 = await seedWorkingJob();
    const inA2 = await seedWorkingJob({ branchId: BRANCH_A2 });
    const inB = await seedWorkingJob({ tenantId: TENANT_B });

    authAs(PERMISSION_ELSEWHERE);
    expect((await start(inA1.id, { technicianProfileId: TECH_A1 })).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await start(inA1.id, { technicianProfileId: TECH_A1 })).status).toBe(404);
    authAs(PERMISSION_ELSEWHERE);
    expect((await start(inA2.id, { technicianProfileId: TECH_A2 })).status).toBe(201);

    authAs(TENANT_B_FULL);
    const foreign = await start(inA1.id, { technicianProfileId: TECH_A1 });
    expect(foreign.status).toBe(404);
    expect((await problem(foreign)).code).toBe('ERR-RES-001');
    // A tenant-A job with a tenant-B technician: the composite FK cannot span
    // tenants, so it answers the same 404 rather than a foreign-key error.
    authAs(TENANT_B_FULL);
    expect((await start(inA1.id, { technicianProfileId: TECH_B1 })).status).toBe(404);
    authAs(TENANT_B_FULL);
    expect((await start(inB.id, { technicianProfileId: TECH_B1 })).status).toBe(201);
  });

  it('two concurrent starts for one technician leave exactly one open session', async () => {
    const first = await seedWorkingJob();
    const second = await seedWorkingJob({ technicianProfileId: TECH_A1_ALT });

    // Forced: an admin transaction holds the technician's profile row, both requests
    // read it and block, and the lock is released only once both are waiting.
    const gate = await admin.connect();
    let released = false;
    try {
      await gate.query('BEGIN');
      await gate.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await gate.query('SELECT id FROM tech.technician_profiles WHERE id = $1 FOR UPDATE', [
        TECH_A1,
      ]);
      authAs(FULL);
      const a = start(first.id, { technicianProfileId: TECH_A1 });
      const b = start(second.id, { technicianProfileId: TECH_A1 });
      await waitForBlockedBackends(1);
      await gate.query('ROLLBACK');
      released = true;
      const [one, two] = await Promise.all([a, b]);
      expect([one.status, two.status].sort()).toEqual([201, 422]);
    } finally {
      if (!released) await gate.query('ROLLBACK').catch(() => undefined);
      gate.release();
    }
    const open = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tech.labor_sessions
        WHERE technician_profile_id = $1 AND ended_at IS NULL AND deleted_at IS NULL`,
      [TECH_A1]
    );
    expect(open.rows[0]?.n).toBe('1');
  });
});

describe('tech.labor-session-stop and the pause cycle', () => {
  it('stops on the server clock, audits it, and refuses a second stop', async () => {
    const job = await seedWorkingJob();
    authAs(FULL);
    const opened = (await (
      await start(job.id, { technicianProfileId: TECH_A1 })
    ).json()) as SessionBody;

    authAs(FULL);
    const response = await stop(opened.id, { version: opened.recordVersion });
    expect(response.status).toBe(200);
    const stopped = (await response.json()) as SessionBody;
    expect(stopped.endedAt).not.toBeNull();
    expect(Date.parse(stopped.endedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(stopped.startedAt));
    expect(await auditCount(STOPPED_ACTION, opened.id)).toBe(1);
    expect(await outboxCount(SESSION_EVENT, opened.id)).toBe(2);

    // `ended_at` is write-once in the guard, so a second stop must be refused here
    // rather than reaching the trigger as an attempted rewrite.
    authAs(FULL);
    const again = await stop(opened.id, { version: stopped.recordVersion });
    expect(again.status).toBe(409);
    expect((await problem(again)).code).toBe('ERR-TRN-001');

    // Stopping frees the technician for another job.
    const next = await seedWorkingJob({ technicianProfileId: TECH_A1_ALT });
    authAs(FULL);
    expect((await start(next.id, { technicianProfileId: TECH_A1 })).status).toBe(201);
  });

  it('pause and resume compose from a stop plus a job transition, with the reason in the ledger', async () => {
    const job = await seedWorkingJob();
    authAs(FULL);
    const opened = (await (
      await start(job.id, { technicianProfileId: TECH_A1 })
    ).json()) as SessionBody;

    // PAUSE, half one: stop the clock.
    authAs(FULL);
    expect((await stop(opened.id, { version: opened.recordVersion })).status).toBe(200);
    // PAUSE, half two: move the job. `paused` has `reason_required`, so the reason for
    // pausing is recorded in `wo.job_status_history` — there is no pause column on a
    // labour session to put it on.
    authAs(FULL);
    const paused = await JOB_TRANSITION(
      new Request(`http://localhost/api/v1/jobs/${job.id}/transition`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          'if-match': String(job.version),
        },
        body: JSON.stringify({ toState: 'paused', reason: 'waiting for a hub assembly' }),
      }),
      { params: Promise.resolve({ jobId: job.id }) }
    );
    expect(paused.status).toBe(200);
    const pausedVersion = ((await paused.json()) as { recordVersion: number }).recordVersion;
    expect(await readJob(job.id)).toMatchObject({ state: 'paused' });

    const ledger = await admin.query<{ reason: string | null }>(
      `SELECT reason FROM wo.job_status_history WHERE job_id = $1 AND to_state = 'paused'`,
      [job.id]
    );
    expect(ledger.rows[0]?.reason).toBe('waiting for a hub assembly');

    // RESUME: back to `in_progress`, then a NEW session. The first one is untouched,
    // so the two intervals are the real worked time.
    authAs(FULL);
    const resumed = await JOB_TRANSITION(
      new Request(`http://localhost/api/v1/jobs/${job.id}/transition`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          'if-match': String(pausedVersion),
        },
        body: JSON.stringify({ toState: 'in_progress' }),
      }),
      { params: Promise.resolve({ jobId: job.id }) }
    );
    expect(resumed.status).toBe(200);
    authAs(FULL);
    const second = await start(job.id, { technicianProfileId: TECH_A1 });
    expect(second.status).toBe(201);

    const sessions = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tech.labor_sessions
        WHERE job_id = $1 AND deleted_at IS NULL`,
      [job.id]
    );
    expect(sessions.rows[0]?.n).toBe('2');
  });

  it('401, 403, a stale version, a missing If-Match, an unknown id, another tenant and branch', async () => {
    const job = await seedWorkingJob();
    authAs(FULL);
    const opened = (await (
      await start(job.id, { technicianProfileId: TECH_A1 })
    ).json()) as SessionBody;

    __resetAuthenticatorForTests();
    expect((await stop(opened.id, { version: 1 })).status).toBe(401);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await stop(opened.id, { version: 1 })).status).toBe(403);
    authAs(READER);
    expect((await stop(opened.id, { version: 1 })).status).toBe(403);

    authAs(FULL);
    const stale = await stop(opened.id, { version: 99 });
    expect(stale.status).toBe(409);
    expect((await problem(stale)).code).toBe('ERR-CON-001');
    authAs(FULL);
    const noIfMatch = await stop(opened.id, { version: null });
    expect(noIfMatch.status).toBe(428);
    expect((await problem(noIfMatch)).code).toBe('ERR-CON-002');
    authAs(FULL);
    expect((await stop('not-a-uuid', { version: 1 })).status).toBe(422);
    authAs(FULL);
    expect((await stop(crypto.randomUUID(), { version: 1 })).status).toBe(404);

    authAs(TENANT_B_FULL);
    expect((await stop(opened.id, { version: 1 })).status).toBe(404);
    authAs(PERMISSION_ELSEWHERE);
    expect((await stop(opened.id, { version: 1 })).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await stop(opened.id, { version: 1 })).status).toBe(404);
  });
});

describe('tech.labor-session-correct', () => {
  it('preserves the original and links the replacement, rather than editing', async () => {
    const job = await seedWorkingJob();
    authAs(FULL);
    const opened = (await (
      await start(job.id, { technicianProfileId: TECH_A1 })
    ).json()) as SessionBody;
    authAs(FULL);
    const stopped = (await (
      await stop(opened.id, { version: opened.recordVersion })
    ).json()) as SessionBody;

    authAs(FULL);
    const response = await correct(
      opened.id,
      {
        startedAt: '2026-07-26T09:00:00.000Z',
        endedAt: '2026-07-26T11:30:00.000Z',
        reason: 'technician forgot to clock in until mid-morning',
      },
      { version: stopped.recordVersion }
    );
    expect(response.status).toBe(201);
    const corrected = (await response.json()) as SessionBody;
    expect(corrected.id).not.toBe(opened.id);
    expect(corrected.correctionOfId).toBe(opened.id);
    expect(corrected.source).toBe('correction');
    expect(corrected.startedAt).toBe('2026-07-26T09:00:00.000Z');
    expect(corrected.endedAt).toBe('2026-07-26T11:30:00.000Z');
    expect(await auditCount(CORRECTED_ACTION, corrected.id)).toBe(1);
    expect(await outboxCount(SESSION_EVENT, corrected.id)).toBe(1);

    // The ORIGINAL survives, soft-deleted. The corrected hours and the hours they
    // replaced are both on the record, which is what makes a payroll correction
    // auditable instead of a rewrite.
    const original = await admin.query<{ deleted_at: Date | null; started_at: Date }>(
      `SELECT deleted_at, started_at FROM tech.labor_sessions WHERE id = $1`,
      [opened.id]
    );
    expect(original.rows[0]?.deleted_at).not.toBeNull();
    expect(original.rows[0]?.started_at.toISOString()).toBe(opened.startedAt);
  });

  it('refuses an inverted window, a blank reason, a timezone-less bound, a stale version and a missing If-Match', async () => {
    const job = await seedWorkingJob();
    authAs(FULL);
    const opened = (await (
      await start(job.id, { technicianProfileId: TECH_A1 })
    ).json()) as SessionBody;
    authAs(FULL);
    const stopped = (await (
      await stop(opened.id, { version: opened.recordVersion })
    ).json()) as SessionBody;
    const good = {
      startedAt: '2026-07-26T09:00:00.000Z',
      endedAt: '2026-07-26T11:30:00.000Z',
      reason: 'amended',
    };

    authAs(FULL);
    expect(
      (
        await correct(
          opened.id,
          { ...good, startedAt: '2026-07-26T12:00:00.000Z', endedAt: '2026-07-26T10:00:00.000Z' },
          { version: stopped.recordVersion }
        )
      ).status
    ).toBe(422);
    authAs(FULL);
    expect(
      (await correct(opened.id, { ...good, reason: '  ' }, { version: stopped.recordVersion }))
        .status
    ).toBe(422);
    authAs(FULL);
    expect(
      (
        await correct(
          opened.id,
          { ...good, startedAt: '2026-07-26T09:00:00' },
          { version: stopped.recordVersion }
        )
      ).status
    ).toBe(422);
    authAs(FULL);
    const stale = await correct(opened.id, good, { version: 99 });
    expect(stale.status).toBe(409);
    expect((await problem(stale)).code).toBe('ERR-CON-001');
    authAs(FULL);
    expect((await correct(opened.id, good, { version: null })).status).toBe(428);

    // Nothing was written: still exactly one live row, and it is the original.
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tech.labor_sessions
        WHERE job_id = $1 AND deleted_at IS NULL`,
      [job.id]
    );
    expect(rows.rows[0]?.n).toBe('1');
  });

  it('401, 403 without tech.labor.correct, another tenant and another branch', async () => {
    const job = await seedWorkingJob();
    authAs(FULL);
    const opened = (await (
      await start(job.id, { technicianProfileId: TECH_A1 })
    ).json()) as SessionBody;
    const payload = {
      startedAt: '2026-07-26T09:00:00.000Z',
      endedAt: '2026-07-26T11:30:00.000Z',
      reason: 'amended',
    };

    __resetAuthenticatorForTests();
    expect((await correct(opened.id, payload, { version: 1 })).status).toBe(401);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await correct(opened.id, payload, { version: 1 })).status).toBe(403);
    // `tech.labor.correct` is a separate, higher-risk permission from
    // `tech.labor.record`: recording hours and rewriting them are different
    // authorities, and the reader holds neither.
    authAs(READER);
    expect((await correct(opened.id, payload, { version: 1 })).status).toBe(403);

    authAs(TENANT_B_FULL);
    expect((await correct(opened.id, payload, { version: 1 })).status).toBe(404);
    authAs(PERMISSION_ELSEWHERE);
    expect((await correct(opened.id, payload, { version: 1 })).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await correct(opened.id, payload, { version: 1 })).status).toBe(404);
  });
});

describe('tech.labor-session-list', () => {
  it("returns a job's labour log newest-first, corrections included, keyset paginated", async () => {
    const job = await seedWorkingJob();
    authAs(FULL);
    const first = (await (
      await start(job.id, { technicianProfileId: TECH_A1 })
    ).json()) as SessionBody;
    authAs(FULL);
    await stop(first.id, { version: first.recordVersion });
    authAs(FULL);
    const second = (await (
      await start(job.id, { technicianProfileId: TECH_A1 })
    ).json()) as SessionBody;

    authAs(FULL);
    const response = await listSessions(job.id);
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      items: readonly SessionBody[];
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(page.items.map((item) => item.id)).toEqual([second.id, first.id]);
    const keys = page.items.map((item) => `${item.startedAt}|${item.id}`);
    expect([...keys].sort().reverse()).toEqual(keys);

    authAs(FULL);
    const firstPage = (await (await listSessions(job.id, { limit: '1' })).json()) as {
      items: readonly SessionBody[];
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    authAs(FULL);
    const nextPage = (await (
      await listSessions(job.id, { limit: '1', cursor: firstPage.nextCursor ?? '' })
    ).json()) as { items: readonly SessionBody[] };
    expect(nextPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
  });

  it('401, 403 without tech.technician.read, a bad cursor, a malformed id and another tenant', async () => {
    const job = await seedWorkingJob();

    __resetAuthenticatorForTests();
    expect((await listSessions(job.id)).status).toBe(401);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await listSessions(job.id)).status).toBe(403);
    // Timesheets are employee-derived: reading the board does not entitle a caller to
    // who worked and for how long.
    authAs(READER);
    expect((await listSessions(job.id)).status).toBe(403);

    authAs(FULL);
    const badCursor = await listSessions(job.id, { cursor: 'not-a-cursor' });
    expect(badCursor.status).toBe(400);
    expect((await problem(badCursor)).code).toBe('ERR-PAG-001');
    authAs(FULL);
    expect((await listSessions('not-a-uuid')).status).toBe(422);

    authAs(FULL);
    const opened = (await (
      await start(job.id, { technicianProfileId: TECH_A1 })
    ).json()) as SessionBody;
    expect(opened.id).not.toBe('');

    // A cross-tenant caller gets 404, and an earlier revision of this test asserted
    // 200-with-an-empty-log instead — reasoning that "the job id is not resolved
    // first here, and RLS narrows the rows". That was describing the defect, not a
    // decision: this read resolved no scope at all, so `scope: 'branch'` on the
    // operation was inert and RLS was the ONLY narrowing (P1-18-A-01). The job's
    // scope is now resolved and re-checked before any session row is read.
    authAs(TENANT_B_FULL);
    expect((await listSessions(job.id)).status).toBe(404);

    // The probe that would have caught it, and did not exist: PERMISSION_ELSEWHERE
    // holds `tech.technician.read` in BRANCH_A2 and is RLS-visible in A1 through an
    // unrelated grant. Under the old handler it received A1's timesheets — who worked
    // and for how long, in a branch where it holds no technician-read permission.
    authAs(PERMISSION_ELSEWHERE);
    expect((await listSessions(job.id)).status).toBe(403);

    // No grant in A1 at all, so RLS hides the job first: defence in depth, and told
    // apart from the case above so a regression in either is visible.
    authAs(SCOPED_ELSEWHERE);
    expect((await listSessions(job.id)).status).toBe(404);
  });
});
