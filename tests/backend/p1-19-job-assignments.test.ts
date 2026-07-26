/**
 * Technician assignment, unassignment, reassignment and the queue (Phase 1-19,
 * P1-19-BE-013…016).
 *
 * Three properties carry this suite:
 *
 *  1. **Eligibility is complete and it is enforced before the write.** A technician
 *     failing on three counts is refused with three reasons, not one per round trip.
 *     Availability is evaluated against the UNION of the technician's intervals,
 *     because `ex_technician_availability_overlap` makes a split shift two touching
 *     half-open rows and no single one spans a window crossing the boundary.
 *  2. **Assignment is temporal, and nothing is deleted.** Ending one stamps
 *     `valid_to` plus a mandatory reason; the row survives, and the history read
 *     shows both. `uq_job_assignments_active_primary` is a PARTIAL unique index, so
 *     a second live primary arrives as `23505` and is mapped to a conflict.
 *  3. **Reassignment is atomic.** Two calls from a client would leave a window with
 *     no active assignment, during which `wo.guard_job_transition` refuses any
 *     `assignment_required` state — so the handover is one transaction that writes
 *     the end, the new assignment, both audit records and one event, or none.
 *
 * This is also what unblocks the job graph: `planned → assigned` is a configured,
 * reason-free edge that the guard refuses without an active assignment, so this suite
 * is the first place a job can legitimately reach `in_progress` and `completed`.
 *
 * Operations exercised here: wo.job-assignment-create, wo.job-assignment-list,
 * wo.job-assignment-end, wo.job-reassignment, tech.technician-queue.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   wo.job-assignment-create: route service authorization success denial cross-tenant isolation audit outbox idempotency concurrency
 *   wo.job-assignment-list: route service authorization success denial cross-tenant isolation
 *   wo.job-assignment-end: route service authorization success denial cross-tenant isolation audit stale-version
 *   wo.job-reassignment: route service authorization success denial cross-tenant isolation audit outbox idempotency rollback
 *   tech.technician-queue: route service authorization success denial cross-tenant isolation
 *   tech.technician-available: route service authorization success denial isolation
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
import { BRANCH_A1, COMPANY_A1 } from './helpers';
import {
  BRANCH_A2,
  BRANCH_B1,
  CERT_HV,
  COMPANY_B1,
  FULL,
  PERMISSION_ELSEWHERE,
  RANK_SENIOR,
  READER,
  SCOPED_ELSEWHERE,
  SKILL_BRAKES,
  SKILL_HYBRID,
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
import {
  GET as LIST_ASSIGNMENTS,
  POST as ASSIGN,
} from '@/app/api/v1/jobs/[jobId]/assignments/route';
import { POST as REASSIGN } from '@/app/api/v1/jobs/[jobId]/reassignments/route';
import { POST as END_ASSIGNMENT } from '@/app/api/v1/assignments/[assignmentId]/end/route';
import { GET as QUEUE } from '@/app/api/v1/technicians/[technicianProfileId]/queue/route';
import { GET as AVAILABLE } from '@/app/api/v1/technicians/available/route';

const ASSIGNED_ACTION = 'wo.job.assigned';
const ENDED_ACTION = 'wo.job.assignment_ended';
const ASSIGNED_EVENT = 'job.assigned';

let admin: Pool;
let runtime: Pool;

interface AssignmentBody {
  readonly id: string;
  readonly jobId: string;
  readonly technicianProfileId: string;
  readonly assignmentRole: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly reason: string | null;
  readonly recordVersion: number;
}

function assign(
  jobId: string,
  body: unknown,
  options: { readonly key?: string } = {}
): Promise<Response> {
  return ASSIGN(
    new Request(`http://localhost/api/v1/jobs/${jobId}/assignments`, {
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

function listAssignments(jobId: string): Promise<Response> {
  return LIST_ASSIGNMENTS(new Request(`http://localhost/api/v1/jobs/${jobId}/assignments`), {
    params: Promise.resolve({ jobId }),
  });
}

function reassign(
  jobId: string,
  body: unknown,
  options: { readonly key?: string } = {}
): Promise<Response> {
  return REASSIGN(
    new Request(`http://localhost/api/v1/jobs/${jobId}/reassignments`, {
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

function endAssignment(
  assignmentId: string,
  body: unknown,
  options: { readonly version?: number | null } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return END_ASSIGNMENT(
    new Request(`http://localhost/api/v1/assignments/${assignmentId}/end`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ assignmentId }) }
  );
}

function queue(technicianProfileId: string): Promise<Response> {
  return QUEUE(new Request(`http://localhost/api/v1/technicians/${technicianProfileId}/queue`), {
    params: Promise.resolve({ technicianProfileId }),
  });
}

function available(query: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/v1/technicians/available');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return AVAILABLE(new Request(url));
}

/** The minimal legal assign body: a technician and the window to check. */
const basic = (technicianProfileId: string): Record<string, unknown> => ({
  technicianProfileId,
  window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
});

async function problem(response: Response): Promise<{
  code?: string;
  violations?: readonly { path: string; rule: string }[];
}> {
  return (await response.json()) as {
    code?: string;
    violations?: readonly { path: string; rule: string }[];
  };
}

/** A `planned` job on an `open` work order, created through the real routes. */
async function seedJob(
  input: { readonly branchId?: string; readonly tenantId?: string } = {}
): Promise<{ readonly id: string; readonly workOrderId: string; readonly recordVersion: number }> {
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
  return (await response.json()) as { id: string; workOrderId: string; recordVersion: number };
}

/** Moves a job through the real transition route. */
async function moveJob(jobId: string, toState: string, version: number): Promise<number> {
  authAs(FULL);
  const response = await JOB_TRANSITION(
    new Request(`http://localhost/api/v1/jobs/${jobId}/transition`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': String(version),
      },
      body: JSON.stringify({ toState }),
    }),
    { params: Promise.resolve({ jobId }) }
  );
  if (response.status !== 200) {
    throw new Error(
      `job move to ${toState} failed with ${response.status}: ${await response.text()}`
    );
  }
  return ((await response.json()) as { recordVersion: number }).recordVersion;
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

describe('wo.job-assignment-create', () => {
  it('assigns an eligible technician, audits it, publishes one event, and unblocks the job graph', async () => {
    const job = await seedJob();

    authAs(FULL);
    const response = await assign(job.id, {
      ...basic(TECH_A1),
      requiredSkills: [{ skillCode: SKILL_BRAKES, minimumRank: RANK_SENIOR }],
      requiredCertificationCodes: [CERT_HV],
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as AssignmentBody;
    expect(body.jobId).toBe(job.id);
    expect(body.technicianProfileId).toBe(TECH_A1);
    expect(body.assignmentRole).toBe('primary');
    expect(body.validTo).toBeNull();
    expect(body.reason).toBeNull();
    expect(body.recordVersion).toBe(1);

    expect(await auditCount(ASSIGNED_ACTION, body.id)).toBe(1);
    // Keyed by the ASSIGNMENT, and the aggregate is the JOB — the catalog declares
    // `aggregateType: 'wo.job'`, and a job is legitimately assigned more than once.
    expect(await outboxCount(ASSIGNED_EVENT, job.id)).toBe(1);
    const event = await admin.query<{ event_key: string; producer: string }>(
      `SELECT event_key, producer FROM shared.event_outbox
        WHERE aggregate_id = $1 AND event_type = $2`,
      [job.id, ASSIGNED_EVENT]
    );
    expect(event.rows[0]?.event_key).toBe(`job.assigned:${body.id}`);
    expect(event.rows[0]?.producer).toBe('wo.job-assignment-service');

    // The whole point: `planned -> assigned` was refused before this, because
    // `wo.guard_job_transition` requires an active assignment for an
    // `assignment_required` target. It is now reachable, and so is the rest of the
    // graph.
    const assigned = await moveJob(job.id, 'assigned', job.recordVersion);
    const inProgress = await moveJob(job.id, 'in_progress', assigned);
    await moveJob(job.id, 'completed', inProgress);
    expect(await readJob(job.id)).toMatchObject({ state: 'completed' });
  });

  it('reports EVERY ineligibility reason at once, not one per attempt', async () => {
    const job = await seedJob();

    // Three failures in one request: the alternate holds `brakes` at JUNIOR (below
    // the senior minimum), holds no `hybrid` skill at all, and holds no high-voltage
    // certification.
    authAs(FULL);
    const response = await assign(job.id, {
      ...basic(TECH_A1_ALT),
      requiredSkills: [
        { skillCode: SKILL_BRAKES, minimumRank: RANK_SENIOR },
        { skillCode: SKILL_HYBRID, minimumRank: 1 },
      ],
      requiredCertificationCodes: [CERT_HV],
    });
    expect(response.status).toBe(422);
    const detail = await problem(response);
    expect(detail.code).toBe('ERR-TECH-001');
    const rules = (detail.violations ?? []).map((violation) => violation.rule);
    expect(rules).toContain('skill-level-insufficient');
    expect(rules).toContain('skill-missing');
    expect(rules).toContain('certification-missing');

    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.job_assignments WHERE job_id = $1`,
      [job.id]
    );
    expect(rows.rows[0]?.n).toBe('0');
  });

  it('refuses an inactive profile, a profile in another branch, and a window nothing covers', async () => {
    const job = await seedJob();

    authAs(FULL);
    const inactive = await assign(job.id, basic(TECH_A1_INACTIVE));
    expect(inactive.status).toBe(422);
    expect((await problem(inactive)).violations?.map((v) => v.rule)).toContain('profile-inactive');

    // A technician in BRANCH_A2 is out of scope for a BRANCH_A1 job. The composite
    // FK would refuse the row anyway; eligibility refuses it readably first.
    authAs(FULL);
    const otherBranch = await assign(job.id, basic(TECH_A2));
    expect(otherBranch.status).toBe(422);
    expect((await problem(otherBranch)).violations?.map((v) => v.rule)).toContain(
      'profile-out-of-scope'
    );

    // Outside the split shift entirely.
    authAs(FULL);
    const unavailable = await assign(job.id, {
      technicianProfileId: TECH_A1,
      window: { from: '2026-07-27T09:00:00.000Z', to: '2026-07-27T10:00:00.000Z' },
    });
    expect(unavailable.status).toBe(422);
    expect((await problem(unavailable)).violations?.map((v) => v.rule)).toContain(
      'availability-missing'
    );
  });

  it('accepts a window that crosses a split-shift boundary, which no single interval spans', async () => {
    const job = await seedJob();

    // 09:00–13:00 straddles the 12:00 boundary between two touching availability
    // rows. Asking whether any ONE row spans it answers no; the union answers yes.
    authAs(FULL);
    const response = await assign(job.id, basic(TECH_A1));
    expect(response.status).toBe(201);

    const single = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tech.technician_availability
        WHERE technician_profile_id = $1
          AND available_from <= $2::timestamptz AND available_to >= $3::timestamptz`,
      [TECH_A1, SPLIT_WINDOW.from, SPLIT_WINDOW.to]
    );
    // Proves the window really is un-spannable by one row, so the acceptance above
    // could only have come from the union check.
    expect(single.rows[0]?.n).toBe('0');
  });

  it('refuses a second active primary, permits a second assist, and one winner survives a forced race', async () => {
    const job = await seedJob();
    authAs(FULL);
    expect((await assign(job.id, basic(TECH_A1))).status).toBe(201);

    authAs(FULL);
    const second = await assign(job.id, basic(TECH_A1_ALT));
    expect(second.status).toBe(409);
    expect((await problem(second)).violations?.[0]?.rule).toBe('primary_already_assigned');

    // `assist` carries no partial unique index: a job may have several helpers.
    authAs(FULL);
    const assist = await assign(job.id, { ...basic(TECH_A1_ALT), assignmentRole: 'assist' });
    expect(assist.status).toBe(201);
    expect(((await assist.json()) as AssignmentBody).assignmentRole).toBe('assist');

    // Forced race for the primary slot on a fresh job: an admin transaction holds the
    // job row, both requests must block on it, and the lock is released only once
    // both are provably waiting.
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
      const first = assign(raced.id, basic(TECH_A1));
      const rival = assign(raced.id, basic(TECH_A1_ALT));
      await waitForBlockedBackends(2);
      await gate.query('ROLLBACK');
      released = true;
      const [a, b] = await Promise.all([first, rival]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
    } finally {
      if (!released) await gate.query('ROLLBACK').catch(() => undefined);
      gate.release();
    }
    const primaries = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.job_assignments
        WHERE job_id = $1 AND assignment_role = 'primary' AND valid_to IS NULL`,
      [raced.id]
    );
    expect(primaries.rows[0]?.n).toBe('1');
  });

  it('refuses assignment to a terminal job and to a job under a terminal work order', async () => {
    const cancelledJob = await seedJob();
    authAs(FULL);
    const moved = await JOB_TRANSITION(
      new Request(`http://localhost/api/v1/jobs/${cancelledJob.id}/transition`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          'if-match': String(cancelledJob.recordVersion),
        },
        body: JSON.stringify({ toState: 'cancelled', reason: 'not needed' }),
      }),
      { params: Promise.resolve({ jobId: cancelledJob.id }) }
    );
    expect(moved.status).toBe(200);
    authAs(FULL);
    const onTerminalJob = await assign(cancelledJob.id, basic(TECH_A1));
    expect(onTerminalJob.status).toBe(409);
    expect((await problem(onTerminalJob)).code).toBe('ERR-TRN-001');

    // A live job whose PARENT has been cancelled. Assigning work on a frozen
    // aggregate would put a live row on something the guards will never move again.
    const orphaned = await seedJob();
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true),
                set_config('app.status_reason','customer recalled the vehicle',true)`,
        [USER_A, TENANT_A]
      );
      await client.query(`UPDATE wo.work_orders SET state = 'cancelled' WHERE id = $1`, [
        orphaned.workOrderId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    authAs(FULL);
    const onTerminalParent = await assign(orphaned.id, basic(TECH_A1));
    expect(onTerminalParent.status).toBe(409);
    expect((await problem(onTerminalParent)).code).toBe('ERR-TRN-001');
  });

  it('401, 403 without tech.assignment.manage, a malformed body and a replayed key', async () => {
    const job = await seedJob();

    __resetAuthenticatorForTests();
    expect((await assign(job.id, basic(TECH_A1))).status).toBe(401);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await assign(job.id, basic(TECH_A1))).status).toBe(403);
    authAs(READER);
    const reader = await assign(job.id, basic(TECH_A1));
    expect(reader.status).toBe(403);
    expect((await problem(reader)).code).toBe('ERR-IAM-001');

    // The window is required, both bounds must carry an offset, and unknown fields
    // are refused.
    authAs(FULL);
    expect((await assign(job.id, { technicianProfileId: TECH_A1 })).status).toBe(422);
    authAs(FULL);
    expect(
      (
        await assign(job.id, {
          technicianProfileId: TECH_A1,
          window: { from: '2026-07-26T09:00:00', to: '2026-07-26T13:00:00' },
        })
      ).status
    ).toBe(422);
    authAs(FULL);
    expect((await assign(job.id, { ...basic(TECH_A1), unexpected: 1 })).status).toBe(422);
    authAs(FULL);
    expect((await assign('not-a-uuid', basic(TECH_A1))).status).toBe(422);

    const key = crypto.randomUUID();
    authAs(FULL);
    const first = await assign(job.id, basic(TECH_A1), { key });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as AssignmentBody;
    authAs(FULL);
    const replay = await assign(job.id, basic(TECH_A1), { key });
    expect(replay.status).toBe(200);
    expect((await replay.json()) as AssignmentBody).toEqual(firstBody);
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.job_assignments WHERE job_id = $1`,
      [job.id]
    );
    expect(rows.rows[0]?.n).toBe('1');
  });

  it('isolation and cross-tenant: 403 where RLS admits the job, 404 where it does not', async () => {
    const inA1 = await seedJob();
    const inA2 = await seedJob({ branchId: BRANCH_A2 });
    const inB = await seedJob({ tenantId: TENANT_B });

    authAs(PERMISSION_ELSEWHERE);
    expect((await assign(inA1.id, basic(TECH_A1))).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await assign(inA1.id, basic(TECH_A1))).status).toBe(404);
    // The same principal succeeds in its own branch, with that branch's technician.
    authAs(PERMISSION_ELSEWHERE);
    expect((await assign(inA2.id, basic(TECH_A2))).status).toBe(201);

    authAs(TENANT_B_FULL);
    const foreign = await assign(inA1.id, basic(TECH_A1));
    expect(foreign.status).toBe(404);
    expect((await problem(foreign)).code).toBe('ERR-RES-001');
    // A tenant-A technician is invisible to tenant B even on tenant B's own job.
    authAs(TENANT_B_FULL);
    const foreignTech = await assign(inB.id, basic(TECH_A1));
    expect(foreignTech.status).toBe(422);
    expect((await problem(foreignTech)).violations?.map((v) => v.rule)).toContain(
      'profile-out-of-scope'
    );
    authAs(TENANT_B_FULL);
    expect((await assign(inB.id, basic(TECH_B1))).status).toBe(201);
  });
});

describe('wo.job-assignment-end and wo.job-assignment-list', () => {
  it('ends an assignment, keeps the row, records the reason, and shows both in the history', async () => {
    const job = await seedJob();
    authAs(FULL);
    const opened = (await (await assign(job.id, basic(TECH_A1))).json()) as AssignmentBody;

    authAs(FULL);
    const response = await endAssignment(
      opened.id,
      { reason: 'technician reassigned to a breakdown' },
      { version: opened.recordVersion }
    );
    expect(response.status).toBe(200);
    const ended = (await response.json()) as AssignmentBody;
    expect(ended.validTo).not.toBeNull();
    expect(ended.reason).toBe('technician reassigned to a breakdown');
    expect(await auditCount(ENDED_ACTION, opened.id)).toBe(1);

    // The row SURVIVES: ending is a stamp, not a delete. This is what makes "who
    // worked this vehicle in March" answerable.
    const rows = await admin.query<{ n: string; valid_to: Date | null }>(
      `SELECT count(*)::text AS n, max(valid_to) AS valid_to FROM wo.job_assignments
        WHERE id = $1 AND deleted_at IS NULL`,
      [opened.id]
    );
    expect(rows.rows[0]?.n).toBe('1');
    expect(rows.rows[0]?.valid_to).not.toBeNull();

    // Ending frees the primary slot.
    authAs(FULL);
    expect((await assign(job.id, basic(TECH_A1_ALT))).status).toBe(201);

    authAs(FULL);
    const history = await listAssignments(job.id);
    expect(history.status).toBe(200);
    const items = ((await history.json()) as { items: readonly AssignmentBody[] }).items;
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.validTo === null)).toHaveLength(1);
    expect(items.map((item) => item.technicianProfileId).sort()).toEqual(
      [TECH_A1, TECH_A1_ALT].sort()
    );
  });

  it('refuses a missing reason, a stale version, a missing If-Match, an already-ended assignment', async () => {
    const job = await seedJob();
    authAs(FULL);
    const opened = (await (await assign(job.id, basic(TECH_A1))).json()) as AssignmentBody;

    authAs(FULL);
    expect((await endAssignment(opened.id, {}, { version: 1 })).status).toBe(422);
    authAs(FULL);
    expect((await endAssignment(opened.id, { reason: '  ' }, { version: 1 })).status).toBe(422);
    authAs(FULL);
    const stale = await endAssignment(opened.id, { reason: 'x' }, { version: 99 });
    expect(stale.status).toBe(409);
    expect((await problem(stale)).code).toBe('ERR-CON-001');
    authAs(FULL);
    const noIfMatch = await endAssignment(opened.id, { reason: 'x' }, { version: null });
    expect(noIfMatch.status).toBe(428);
    expect((await problem(noIfMatch)).code).toBe('ERR-CON-002');

    authAs(FULL);
    expect(
      (await endAssignment(opened.id, { reason: 'first' }, { version: opened.recordVersion }))
        .status
    ).toBe(200);
    authAs(FULL);
    const again = await endAssignment(opened.id, { reason: 'second' }, { version: 2 });
    expect(again.status).toBe(409);
    expect((await problem(again)).code).toBe('ERR-TRN-001');
  });

  it('401, 403, an unknown id, another tenant and another branch, on both operations', async () => {
    const job = await seedJob();
    authAs(FULL);
    const opened = (await (await assign(job.id, basic(TECH_A1))).json()) as AssignmentBody;

    __resetAuthenticatorForTests();
    expect((await endAssignment(opened.id, { reason: 'x' }, { version: 1 })).status).toBe(401);
    expect((await listAssignments(job.id)).status).toBe(401);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await endAssignment(opened.id, { reason: 'x' }, { version: 1 })).status).toBe(403);
    // The list needs `tech.technician.read`: a caller who may read the board is not
    // thereby entitled to the roster.
    authAs(READER);
    expect((await listAssignments(job.id)).status).toBe(403);

    authAs(FULL);
    expect((await endAssignment(crypto.randomUUID(), { reason: 'x' }, { version: 1 })).status).toBe(
      404
    );
    authAs(FULL);
    expect((await listAssignments('not-a-uuid')).status).toBe(422);

    authAs(TENANT_B_FULL);
    expect((await endAssignment(opened.id, { reason: 'x' }, { version: 1 })).status).toBe(404);
    expect((await listAssignments(job.id)).status).toBe(404);
    authAs(PERMISSION_ELSEWHERE);
    expect((await endAssignment(opened.id, { reason: 'x' }, { version: 1 })).status).toBe(403);
    expect((await listAssignments(job.id)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await listAssignments(job.id)).status).toBe(404);
  });
});

describe('wo.job-reassignment', () => {
  it('ends the outgoing assignment and opens the new one in ONE transaction', async () => {
    const job = await seedJob();
    authAs(FULL);
    const original = (await (await assign(job.id, basic(TECH_A1))).json()) as AssignmentBody;

    authAs(FULL);
    const response = await reassign(job.id, {
      technicianProfileId: TECH_A1_ALT,
      reason: 'original technician is on a breakdown call',
      window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ended: AssignmentBody | null;
      opened: AssignmentBody;
    };
    expect(body.ended?.id).toBe(original.id);
    expect(body.opened.technicianProfileId).toBe(TECH_A1_ALT);

    // Both halves of the handover are recorded, and exactly one primary is live.
    expect(await auditCount(ENDED_ACTION, original.id)).toBe(1);
    expect(await auditCount(ASSIGNED_ACTION, body.opened.id)).toBe(1);
    const primaries = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.job_assignments
        WHERE job_id = $1 AND assignment_role = 'primary' AND valid_to IS NULL`,
      [job.id]
    );
    expect(primaries.rows[0]?.n).toBe('1');
    // Two `job.assigned` events for this job — one per assignment — because the key
    // is the assignment id and a job is legitimately assigned more than once.
    expect(await outboxCount(ASSIGNED_EVENT, job.id)).toBe(2);
  });

  it('rollback: an ineligible incoming technician leaves the outgoing assignment untouched', async () => {
    const job = await seedJob();
    authAs(FULL);
    const original = (await (await assign(job.id, basic(TECH_A1))).json()) as AssignmentBody;

    // The end is written BEFORE eligibility is evaluated for the incoming technician,
    // so this is the case that proves the transaction is the unit: the refusal must
    // undo the end, not leave the job unassigned.
    authAs(FULL);
    const refused = await reassign(job.id, {
      technicianProfileId: TECH_A1_INACTIVE,
      reason: 'attempted handover to an inactive profile',
      window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
    });
    expect(refused.status).toBe(422);
    expect((await problem(refused)).violations?.map((v) => v.rule)).toContain('profile-inactive');

    const row = await admin.query<{ valid_to: Date | null; reason: string | null }>(
      `SELECT valid_to, reason FROM wo.job_assignments WHERE id = $1`,
      [original.id]
    );
    expect(row.rows[0]?.valid_to).toBeNull();
    expect(row.rows[0]?.reason).toBeNull();
    expect(await auditCount(ENDED_ACTION, original.id)).toBe(0);
  });

  it('refuses a handover to the technician who already holds it, and works with no incumbent', async () => {
    const held = await seedJob();
    authAs(FULL);
    await assign(held.id, basic(TECH_A1));
    authAs(FULL);
    const sameTech = await reassign(held.id, {
      technicianProfileId: TECH_A1,
      reason: 'no-op handover',
      window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
    });
    expect(sameTech.status).toBe(422);
    expect((await problem(sameTech)).violations?.[0]?.rule).toBe('already_assigned');

    // With no incumbent it degenerates to an assignment, and says so honestly.
    const fresh = await seedJob();
    authAs(FULL);
    const response = await reassign(fresh.id, {
      technicianProfileId: TECH_A1,
      reason: 'first assignment through the handover route',
      window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { ended: unknown }).ended).toBeNull();
  });

  it('401, 403, a replayed key, another tenant and another branch', async () => {
    const job = await seedJob();
    authAs(FULL);
    await assign(job.id, basic(TECH_A1));
    const payload = {
      technicianProfileId: TECH_A1_ALT,
      reason: 'handover',
      window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
    };

    __resetAuthenticatorForTests();
    expect((await reassign(job.id, payload)).status).toBe(401);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await reassign(job.id, payload)).status).toBe(403);
    authAs(READER);
    expect((await reassign(job.id, payload)).status).toBe(403);
    authAs(FULL);
    expect((await reassign(job.id, { ...payload, reason: ' ' })).status).toBe(422);

    authAs(TENANT_B_FULL);
    expect((await reassign(job.id, payload)).status).toBe(404);
    authAs(PERMISSION_ELSEWHERE);
    expect((await reassign(job.id, payload)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await reassign(job.id, payload)).status).toBe(404);

    const key = crypto.randomUUID();
    authAs(FULL);
    const first = await reassign(job.id, payload, { key });
    expect(first.status).toBe(201);
    authAs(FULL);
    const replay = await reassign(job.id, payload, { key });
    expect(replay.status).toBe(200);
    const primaries = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wo.job_assignments
        WHERE job_id = $1 AND assignment_role = 'primary' AND valid_to IS NULL`,
      [job.id]
    );
    expect(primaries.rows[0]?.n).toBe('1');
  });
});

describe('tech.technician-queue', () => {
  it('returns the live assignments of one technician with their job and work-order context', async () => {
    const first = await seedJob();
    const second = await seedJob();
    authAs(FULL);
    await assign(first.id, basic(TECH_A1));
    authAs(FULL);
    const secondAssignment = (await (
      await assign(second.id, basic(TECH_A1))
    ).json()) as AssignmentBody;

    authAs(FULL);
    const response = await queue(TECH_A1);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      technicianProfileId: string;
      items: readonly {
        jobId: string;
        workOrderId: string;
        jobState: string;
        workOrderState: string;
        displayNumber: string | null;
        assignmentRole: string;
      }[];
    };
    expect(body.technicianProfileId).toBe(TECH_A1);
    const jobIds = body.items.map((item) => item.jobId);
    expect(jobIds).toContain(first.id);
    expect(jobIds).toContain(second.id);
    const entry = body.items.find((item) => item.jobId === first.id);
    expect(entry?.workOrderId).toBe(first.workOrderId);
    expect(entry?.jobState).toBe('planned');
    expect(entry?.workOrderState).toBe('open');
    expect(entry?.displayNumber).toMatch(/^WO-\d{6}$/);
    expect(entry?.assignmentRole).toBe('primary');

    // Ending an assignment removes it from the queue without removing the row.
    authAs(FULL);
    expect(
      (
        await endAssignment(
          secondAssignment.id,
          { reason: 'work finished early' },
          { version: secondAssignment.recordVersion }
        )
      ).status
    ).toBe(200);
    authAs(FULL);
    const after = (await (await queue(TECH_A1)).json()) as { items: readonly { jobId: string }[] };
    expect(after.items.map((item) => item.jobId)).not.toContain(second.id);
    expect(after.items.map((item) => item.jobId)).toContain(first.id);
  });

  it('discloses no employee-derived detail beyond the profile id the caller named', async () => {
    const job = await seedJob();
    authAs(FULL);
    await assign(job.id, basic(TECH_A1));

    authAs(FULL);
    const text = await (await queue(TECH_A1)).text();
    // A queue answers "what is this technician on", not "who is this technician".
    // `trade` and `employment_ref` are on the profile and must not appear, and
    // nothing from `tech.technician_certification_details` — whose `classification`
    // column marks it restricted — may either.
    expect(text).not.toContain('mechanic');
    expect(text).not.toContain('employmentRef');
    expect(text).not.toContain('userId');
    expect(text).not.toContain('certificateNumber');
  });

  it('401, 403 without tech.technician.read, an unknown profile, another tenant and another branch', async () => {
    __resetAuthenticatorForTests();
    expect((await queue(TECH_A1)).status).toBe(401);

    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await queue(TECH_A1)).status).toBe(403);
    authAs(READER);
    expect((await queue(TECH_A1)).status).toBe(403);

    authAs(FULL);
    expect((await queue('not-a-uuid')).status).toBe(422);
    authAs(FULL);
    expect((await queue(crypto.randomUUID())).status).toBe(404);

    // The profile is resolved BEFORE any assignment row is read, so a tenant-B
    // caller learns nothing about a tenant-A technician.
    authAs(TENANT_B_FULL);
    expect((await queue(TECH_A1)).status).toBe(404);
    authAs(PERMISSION_ELSEWHERE);
    expect((await queue(TECH_A1)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    expect((await queue(TECH_A1)).status).toBe(404);
    // Its own branch's technician is visible to it.
    authAs(PERMISSION_ELSEWHERE);
    expect((await queue(TECH_A2)).status).toBe(200);
  });
});

describe('tech.technician-available', () => {
  it('ranks every active candidate with its verdict, eligible first', async () => {
    authAs(FULL);
    const response = await available({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      from: SPLIT_WINDOW.from,
      to: SPLIT_WINDOW.to,
      skills: `${SKILL_BRAKES}:${RANK_SENIOR}`,
      certifications: CERT_HV,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: readonly {
        technicianProfileId: string;
        eligible: boolean;
        findings: readonly { reason: string }[];
      }[];
      truncatedAt: number | null;
    };

    // TECH_A1 holds brakes at senior and the high-voltage certification; TECH_A1_ALT
    // holds brakes at junior and no certification. Both appear — reporting only the
    // eligible ones would leave an assigner with an empty list and no reason.
    const ids = body.items.map((item) => item.technicianProfileId);
    expect(ids).toContain(TECH_A1);
    expect(ids).toContain(TECH_A1_ALT);
    // The INACTIVE profile is excluded at the query, not evaluated and discarded: a
    // technician who is not employed is not a candidate.
    expect(ids).not.toContain(TECH_A1_INACTIVE);
    // Another branch's technician is never a candidate for this branch.
    expect(ids).not.toContain(TECH_A2);

    const senior = body.items.find((item) => item.technicianProfileId === TECH_A1);
    const junior = body.items.find((item) => item.technicianProfileId === TECH_A1_ALT);
    expect(senior?.eligible).toBe(true);
    expect(junior?.eligible).toBe(false);
    expect(junior?.findings.map((finding) => finding.reason)).toContain('skill-level-insufficient');
    expect(junior?.findings.map((finding) => finding.reason)).toContain('certification-missing');
    // Eligible first, so the common case reads top-down.
    expect(body.items[0]?.eligible).toBe(true);
    // Nothing was dropped, and the field says so rather than leaving it to be assumed.
    expect(body.truncatedAt).toBeNull();
  });

  it('requires the scope and the window, and refuses a malformed skill encoding', async () => {
    authAs(FULL);
    expect((await available({ companyId: COMPANY_A1, branchId: BRANCH_A1 })).status).toBe(422);
    authAs(FULL);
    expect(
      (
        await available({
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          from: '2026-07-26T09:00:00',
          to: SPLIT_WINDOW.to,
        })
      ).status
    ).toBe(422);
    authAs(FULL);
    expect(
      (
        await available({
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          from: SPLIT_WINDOW.from,
          to: SPLIT_WINDOW.to,
          skills: 'brakes',
        })
      ).status
    ).toBe(422);
    authAs(FULL);
    expect(
      (
        await available({
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          from: SPLIT_WINDOW.from,
          to: SPLIT_WINDOW.to,
          unexpected: 'x',
        })
      ).status
    ).toBe(422);
  });

  it('401, 403 without tech.technician.read, and 403 for a branch the caller is not permitted in', async () => {
    const scope = {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      from: SPLIT_WINDOW.from,
      to: SPLIT_WINDOW.to,
    };

    __resetAuthenticatorForTests();
    expect((await available(scope)).status).toBe(401);
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await available(scope)).status).toBe(403);
    // A roster is employee-derived: reading the work-order board does not entitle a
    // caller to it.
    authAs(READER);
    expect((await available(scope)).status).toBe(403);

    // The scoped principal is refused BRANCH_A1 and served BRANCH_A2. The pair in the
    // query is the authorization target, so this is the scoped permission check
    // refusing a roster rather than RLS returning an empty one.
    authAs(SCOPED_ELSEWHERE);
    expect((await available(scope)).status).toBe(403);
    authAs(SCOPED_ELSEWHERE);
    const own = await available({ ...scope, branchId: BRANCH_A2 });
    expect(own.status).toBe(200);
    const ids = ((await own.json()) as { items: readonly { technicianProfileId: string }[] }).items;
    expect(ids.map((item) => item.technicianProfileId)).toEqual([TECH_A2]);
  });
});
