/**
 * P1-29 `W4` — the technician workspace, proved on real responses.
 *
 * The workspace makes one claim every other claim depends on, and it is proved
 * first: a signed-in technician can learn their OWN `technicianProfileId`
 * through operations that already exist, with no ambiguity and no permission
 * beyond the one the queue itself needs. `tech.technician-me-queue` withholds
 * the id on purpose; `tech.labor-session-start` demands it. The composition —
 * the queue row's `assignmentId` matched against `wo.job-assignment-list` —
 * either yields the caller's own profile on a real response, or W4 needs a
 * Backend item. It yields it (`W4-2`), so W4 adds zero backend.
 *
 * The rest is the chain the screen introduces, each link on the real database:
 *
 *   queue        the caller's own assigned work, and NOTHING about paging,
 *                because the operation pages nothing
 *   identity     the seam above, including on a job two technicians share
 *   labour       a real persisted start, re-read; a real stop, re-read; a stale
 *                stop refused and the record left alone
 *   work log     a real persisted free-text entry, re-read verbatim; no edit
 *                and no delete exist to be offered
 *   evidence     a real persisted binding, re-read
 *   access       no permission is refused; read authority is not write
 *                authority; another tenant's job is not visible
 *
 * ## One measured fact this file pins WITHOUT endorsing
 *
 * `W4-5e` records that a caller holding `tech.labor.record` in a branch may
 * start a session for ANY active technician profile in that branch — the
 * backend's authority for labour is scope-level, as `p1-19` designed it for a
 * timekeeper recording on a technician's behalf. The workspace adapter refuses
 * to build such a request (`apps/web/tests/technicians-workspace-api.test.ts`),
 * but an adapter is not a boundary. The case is a TRIPWIRE: the day the backend
 * refuses it, this test fails loudly and the finding in
 * `docs/phase-1/phase-1-29/canonical-plan.md` closes.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
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
  AVAILABLE_FROM,
  AVAILABLE_MID,
  AVAILABLE_TO,
  BRANCH_B1,
  COMPANY_B1,
  FULL,
  READER,
  SCOPED_ELSEWHERE,
  SPLIT_WINDOW,
  TENANT_B_FULL,
  authAs,
  authAsSubject,
  createOpenWorkOrder,
  establishP1_19Fixtures,
  establishTechnicianFixtures,
  seedDocumentVersion,
} from './p1-19-helpers';
import { mirrorFields } from './p1-29-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as ME_QUEUE } from '@/app/api/v1/technicians/me/queue/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as JOB_TRANSITION } from '@/app/api/v1/jobs/[jobId]/transition/route';
import {
  GET as LIST_ASSIGNMENTS,
  POST as ASSIGN,
} from '@/app/api/v1/jobs/[jobId]/assignments/route';
import {
  GET as LIST_SESSIONS,
  POST as START,
} from '@/app/api/v1/jobs/[jobId]/labor-sessions/route';
import { POST as STOP } from '@/app/api/v1/labor-sessions/[sessionId]/stop/route';
import { POST as CORRECT } from '@/app/api/v1/labor-sessions/[sessionId]/corrections/route';
import {
  GET as LIST_WORK_LOG,
  POST as RECORD_WORK_LOG,
} from '@/app/api/v1/jobs/[jobId]/work-logs/route';
import {
  GET as LIST_EVIDENCE,
  POST as RECORD_EVIDENCE,
} from '@/app/api/v1/jobs/[jobId]/evidence/route';

const WEB = join(process.cwd(), 'apps', 'web', 'src');
const CONTRACT = join(WEB, 'features', 'technicians', 'technicians-contract.ts');
const W3_CONTRACT = join(WEB, 'features', 'work-orders', 'work-orders-contract.ts');

/**
 * The principals THIS file seeds — technicians with accounts of their own.
 *
 * `p1-19`'s fixture technicians hang off accounts no principal signs in as, so
 * none of them can drive `tech.technician-me-queue`, whose whole point is the
 * session. Each principal below is an account, a role carrying exactly the
 * codes named, an unrestricted grant, and a live profile in one branch. All of
 * it is removed in `afterAll`.
 */
interface WorkspacePrincipal {
  readonly roleId: string;
  readonly userId: string;
  readonly profileId: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly codes: readonly string[];
}

const TECHNICIAN_CODES = ['tech.technician.read', 'tech.labor.record', 'wo.work_order.read'];

/** A technician in A1 who may record labour. The workspace's persona. */
const TECH_ONE: WorkspacePrincipal = {
  roleId: '29400000-0000-4000-8000-000000000001',
  userId: '29400000-0000-4000-8000-000000000002',
  profileId: '29400000-0000-4000-8000-000000000010',
  subject: 'fx_p1_29_w4_tech_one',
  tenantId: TENANT_A,
  companyId: COMPANY_A1,
  branchId: BRANCH_A1,
  codes: TECHNICIAN_CODES,
};

/** A second technician in the SAME branch, for the cross-technician probes. */
const TECH_TWO: WorkspacePrincipal = {
  roleId: '29400000-0000-4000-8000-000000000003',
  userId: '29400000-0000-4000-8000-000000000004',
  profileId: '29400000-0000-4000-8000-000000000011',
  subject: 'fx_p1_29_w4_tech_two',
  tenantId: TENANT_A,
  companyId: COMPANY_A1,
  branchId: BRANCH_A1,
  codes: TECHNICIAN_CODES,
};

/** A technician in tenant B, for the cross-tenant probes. */
const TECH_B: WorkspacePrincipal = {
  roleId: '29400000-0000-4000-8000-000000000005',
  userId: '29400000-0000-4000-8000-000000000006',
  profileId: '29400000-0000-4000-8000-000000000012',
  subject: 'fx_p1_29_w4_tech_b',
  tenantId: TENANT_B,
  companyId: COMPANY_B1,
  branchId: BRANCH_B1,
  codes: TECHNICIAN_CODES,
};

/**
 * A technician who may SEE the queue and read the job but may not record.
 *
 * The "read is not write" probe: `tech.technician.read` opens the workspace;
 * every mutation needs `tech.labor.record`, which this principal lacks.
 */
const TECH_READ_ONLY: WorkspacePrincipal = {
  roleId: '29400000-0000-4000-8000-000000000007',
  userId: '29400000-0000-4000-8000-000000000008',
  profileId: '29400000-0000-4000-8000-000000000013',
  subject: 'fx_p1_29_w4_read_only',
  tenantId: TENANT_A,
  companyId: COMPANY_A1,
  branchId: BRANCH_A1,
  codes: ['tech.technician.read', 'wo.work_order.read'],
};

const LOCAL_PRINCIPALS = [TECH_ONE, TECH_TWO, TECH_B, TECH_READ_ONLY] as const;

let admin: Pool;
let runtime: Pool;

/* ------------------------------------------------------------------ *
 * Requests, through the real handlers
 * ------------------------------------------------------------------ */

const json = <T>(response: Response): Promise<T> => response.json() as Promise<T>;

const withKey = (headers: Record<string, string> = {}): Record<string, string> => ({
  'content-type': 'application/json',
  'idempotency-key': randomUUID(),
  ...headers,
});

const meQueue = (scope: { companyId: string; branchId: string }, extra = ''): Promise<Response> =>
  ME_QUEUE(
    new Request(
      `http://localhost/api/v1/technicians/me/queue?companyId=${scope.companyId}&branchId=${scope.branchId}${extra}`
    )
  );

const assignments = (jobId: string): Promise<Response> =>
  LIST_ASSIGNMENTS(new Request(`http://localhost/api/v1/jobs/${jobId}/assignments`), {
    params: Promise.resolve({ jobId }),
  });

const start = (jobId: string, body: unknown): Promise<Response> =>
  START(
    new Request(`http://localhost/api/v1/jobs/${jobId}/labor-sessions`, {
      method: 'POST',
      headers: withKey(),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );

const sessions = (jobId: string): Promise<Response> =>
  LIST_SESSIONS(new Request(`http://localhost/api/v1/jobs/${jobId}/labor-sessions`), {
    params: Promise.resolve({ jobId }),
  });

const stop = (sessionId: string, version: number | null): Promise<Response> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (version !== null) headers['if-match'] = String(version);
  return STOP(
    new Request(`http://localhost/api/v1/labor-sessions/${sessionId}/stop`, {
      method: 'POST',
      headers,
    }),
    { params: Promise.resolve({ sessionId }) }
  );
};

const correct = (sessionId: string, body: unknown, version: number): Promise<Response> =>
  CORRECT(
    new Request(`http://localhost/api/v1/labor-sessions/${sessionId}/corrections`, {
      method: 'POST',
      headers: withKey({ 'if-match': String(version) }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId }) }
  );

const recordWorkLog = (jobId: string, body: unknown): Promise<Response> =>
  RECORD_WORK_LOG(
    new Request(`http://localhost/api/v1/jobs/${jobId}/work-logs`, {
      method: 'POST',
      headers: withKey(),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );

const workLog = (jobId: string): Promise<Response> =>
  LIST_WORK_LOG(new Request(`http://localhost/api/v1/jobs/${jobId}/work-logs`), {
    params: Promise.resolve({ jobId }),
  });

const recordEvidence = (jobId: string, body: unknown): Promise<Response> =>
  RECORD_EVIDENCE(
    new Request(`http://localhost/api/v1/jobs/${jobId}/evidence`, {
      method: 'POST',
      headers: withKey(),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) }
  );

const evidence = (jobId: string): Promise<Response> =>
  LIST_EVIDENCE(new Request(`http://localhost/api/v1/jobs/${jobId}/evidence`), {
    params: Promise.resolve({ jobId }),
  });

/* ------------------------------------------------------------------ *
 * Shapes, as the web mirror names them
 * ------------------------------------------------------------------ */

interface QueueEntry {
  readonly assignmentId: string;
  readonly jobId: string;
  readonly workOrderId: string;
  readonly jobState: string;
}
interface AssignmentRow {
  readonly id: string;
  readonly technicianProfileId: string;
  readonly validTo: string | null;
}
interface SessionRow {
  readonly id: string;
  readonly technicianProfileId: string;
  readonly jobId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly recordVersion: number;
}
interface WorkLogRow {
  readonly id: string;
  readonly entry: string;
}
interface EvidenceRow {
  readonly id: string;
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note: string | null;
}
interface Items<T> {
  readonly items: readonly T[];
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** The role, the account, the unrestricted grant, and the live profile. */
async function seedPrincipal(principal: WorkspacePrincipal): Promise<void> {
  const creator = principal.tenantId === TENANT_B ? TENANT_B_FULL.userId : FULL.userId;
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','W4 technician','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, creator]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'W4 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, creator]
  );
  for (const code of principal.codes) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, creator, code]
    );
  }
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [principal.tenantId, principal.userId, principal.roleId, creator]
  );

  // The profile and its availability, inside one transaction with the GUCs
  // set: `set_config(..., true)` is transaction-local, and the profile guard
  // reads the actor from it.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, principal.tenantId]
    );
    await client.query(
      `INSERT INTO tech.technician_profiles
         (id, tenant_id, company_id, branch_id, user_id, trade, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,'mechanic',true,$6)`,
      [
        principal.profileId,
        principal.tenantId,
        principal.companyId,
        principal.branchId,
        principal.userId,
        USER_A,
      ]
    );
    for (const [from, to] of [
      [AVAILABLE_FROM, AVAILABLE_MID],
      [AVAILABLE_MID, AVAILABLE_TO],
    ] as const) {
      await client.query(
        `INSERT INTO tech.technician_availability
           (tenant_id, company_id, branch_id, technician_profile_id, available_from,
            available_to, availability_kind, created_by)
         VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,'available',$7)`,
        [
          principal.tenantId,
          principal.companyId,
          principal.branchId,
          principal.profileId,
          from,
          to,
          USER_A,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function removePrincipals(): Promise<void> {
  const profiles = LOCAL_PRINCIPALS.map((p) => p.profileId);
  const users = LOCAL_PRINCIPALS.map((p) => p.userId);
  const roles = LOCAL_PRINCIPALS.map((p) => p.roleId);
  await admin.query('DELETE FROM tech.labor_sessions WHERE technician_profile_id = ANY($1)', [
    profiles,
  ]);
  await admin.query('DELETE FROM wo.job_assignments WHERE technician_profile_id = ANY($1)', [
    profiles,
  ]);
  await admin.query(
    'DELETE FROM tech.technician_availability WHERE technician_profile_id = ANY($1)',
    [profiles]
  );
  await admin.query('DELETE FROM tech.technician_profiles WHERE id = ANY($1)', [profiles]);
  await admin.query('DELETE FROM iam.role_grants WHERE user_id = ANY($1)', [users]);
  await admin.query('DELETE FROM iam.role_permissions WHERE role_id = ANY($1)', [roles]);
  await admin.query('DELETE FROM iam.roles WHERE id = ANY($1)', [roles]);
  await admin.query('DELETE FROM iam.user_accounts WHERE id = ANY($1)', [users]);
}

/**
 * A job in `assigned` — the first state whose `labor_allowed` is true — with
 * the named technician(s) assigned. Everything through the real routes, as the
 * administrator (`FULL`) who holds the assignment and transition authorities the
 * technicians deliberately do not.
 */
async function seedAssignedJob(
  technicians: readonly { profileId: string; role?: 'primary' | 'assist' }[],
  scope: { tenantId?: string; companyId?: string; branchId?: string } = {}
): Promise<{ readonly jobId: string; readonly workOrderId: string }> {
  const tenantB = scope.tenantId === TENANT_B;
  const as = tenantB ? TENANT_B_FULL : FULL;
  const order = await createOpenWorkOrder(
    tenantB
      ? { tenantId: TENANT_B, companyId: COMPANY_B1, branchId: BRANCH_B1 }
      : scope.branchId === undefined
        ? {}
        : { branchId: scope.branchId }
  );
  authAs(as);
  const created = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/jobs`, {
      method: 'POST',
      headers: withKey(),
      body: JSON.stringify({ title: 'W4 fixture — replace front pads' }),
    }),
    { params: Promise.resolve({ workOrderId: order.workOrderId }) }
  );
  if (created.status !== 201) throw new Error(`fixture job failed with ${created.status}`);
  const job = await json<{ id: string; recordVersion: number }>(created);

  for (const technician of technicians) {
    authAs(as);
    const assigned = await ASSIGN(
      new Request(`http://localhost/api/v1/jobs/${job.id}/assignments`, {
        method: 'POST',
        headers: withKey(),
        body: JSON.stringify({
          technicianProfileId: technician.profileId,
          ...(technician.role === undefined ? {} : { assignmentRole: technician.role }),
          window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
        }),
      }),
      { params: Promise.resolve({ jobId: job.id }) }
    );
    if (assigned.status !== 201) {
      throw new Error(
        `fixture assignment failed with ${assigned.status}: ${await assigned.text()}`
      );
    }
  }

  authAs(as);
  const moved = await JOB_TRANSITION(
    new Request(`http://localhost/api/v1/jobs/${job.id}/transition`, {
      method: 'POST',
      headers: withKey({ 'if-match': String(job.recordVersion) }),
      body: JSON.stringify({ toState: 'assigned' }),
    }),
    { params: Promise.resolve({ jobId: job.id }) }
  );
  if (moved.status !== 200) {
    throw new Error(`fixture transition failed with ${moved.status}: ${await moved.text()}`);
  }
  return { jobId: job.id, workOrderId: order.workOrderId };
}

/** The identity seam, exactly as the web adapter performs it. */
async function resolveOwnProfile(
  principal: WorkspacePrincipal,
  jobId: string
): Promise<{ readonly assignmentId: string; readonly technicianProfileId: string }> {
  authAsSubject(principal.subject, principal.tenantId);
  const queue = await json<Items<QueueEntry>>(
    await meQueue({ companyId: principal.companyId, branchId: principal.branchId })
  );
  const own = queue.items.find((entry) => entry.jobId === jobId);
  if (own === undefined) throw new Error('the job is not in the caller’s own queue');

  authAsSubject(principal.subject, principal.tenantId);
  const listed = await json<Items<AssignmentRow>>(await assignments(jobId));
  const row = listed.items.find((entry) => entry.id === own.assignmentId);
  if (row === undefined) throw new Error('the own assignment is not in the assignment list');
  return { assignmentId: own.assignmentId, technicianProfileId: row.technicianProfileId };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishTechnicianFixtures();
  for (const principal of LOCAL_PRINCIPALS) await seedPrincipal(principal);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await removePrincipals();
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

/* ------------------------------------------------------------------ *
 * Proofs
 * ------------------------------------------------------------------ */

describe('P1-29 W4 — the personal queue is real, and it is not paged', () => {
  it('W4-1 a technician reads their own assigned job, and the web mirror is its shape', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);

    authAsSubject(TECH_ONE.subject);
    const response = await meQueue({ companyId: COMPANY_A1, branchId: BRANCH_A1 });
    expect(response.status).toBe(200);
    const payload = await json<Items<QueueEntry>>(response);

    // ANTI-VACUITY: the seeded job is NAMED. An empty queue is a valid response
    // for a technician with no work and would satisfy "renders a queue".
    const own = payload.items.find((entry) => entry.jobId === seeded.jobId);
    expect(own, 'the assigned job is missing from the caller’s own queue').toBeDefined();
    expect(own?.workOrderId).toBe(seeded.workOrderId);
    expect(own?.jobState).toBe('assigned');

    expect(Object.keys(own as object).sort()).toEqual(
      [...mirrorFields(CONTRACT, 'TechnicianQueueEntry')].sort()
    );
    // The id the route withholds is withheld. The mirror must not name it either.
    expect(own).not.toHaveProperty('technicianProfileId');
    expect(mirrorFields(CONTRACT, 'TechnicianQueueEntry')).not.toContain('technicianProfileId');
  });

  it('W4-1b `limit` is accepted and DISCARDED — the response carries no paging at all', async () => {
    await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);

    authAsSubject(TECH_ONE.subject);
    const limited = await meQueue({ companyId: COMPANY_A1, branchId: BRANCH_A1 }, '&limit=1');
    expect(limited.status).toBe(200);
    const payload = await json<Items<QueueEntry> & Record<string, unknown>>(limited);

    // More than the limit came back, and no cursor came with it. A screen that
    // offered "next page" on this response would be offering nothing.
    expect(payload.items.length).toBeGreaterThan(1);
    expect(Object.keys(payload)).toEqual(['items']);
  });
});

describe('P1-29 W4 — the identity seam closes on existing operations', () => {
  it('W4-2 the queue row’s assignmentId names the caller’s own profile in the assignment list', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);

    const resolved = await resolveOwnProfile(TECH_ONE, seeded.jobId);
    expect(resolved.technicianProfileId).toBe(TECH_ONE.profileId);

    // The assignment list is the W3 mirror's shape too — both features read it.
    authAsSubject(TECH_ONE.subject);
    const listed = await json<Items<AssignmentRow>>(await assignments(seeded.jobId));
    const row = listed.items.find((entry) => entry.id === resolved.assignmentId);
    expect(Object.keys(row as object).sort()).toEqual(
      [...mirrorFields(CONTRACT, 'JobAssignmentRow')].sort()
    );
    expect(Object.keys(row as object).sort()).toEqual(
      [...mirrorFields(W3_CONTRACT, 'JobAssignment')].sort()
    );
  });

  it('W4-2b on a job two technicians share, the correlation is by ASSIGNMENT and cannot cross', async () => {
    const seeded = await seedAssignedJob([
      { profileId: TECH_ONE.profileId, role: 'primary' },
      { profileId: TECH_TWO.profileId, role: 'assist' },
    ]);

    // Both see two open assignments; each resolves ONLY their own.
    const one = await resolveOwnProfile(TECH_ONE, seeded.jobId);
    const two = await resolveOwnProfile(TECH_TWO, seeded.jobId);
    expect(one.technicianProfileId).toBe(TECH_ONE.profileId);
    expect(two.technicianProfileId).toBe(TECH_TWO.profileId);
    expect(one.assignmentId).not.toBe(two.assignmentId);

    authAsSubject(TECH_ONE.subject);
    const listed = await json<Items<AssignmentRow>>(await assignments(seeded.jobId));
    expect(listed.items.filter((entry) => entry.validTo === null)).toHaveLength(2);
  });

  it('W4-2c the seam needs no permission beyond tech.technician.read', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_READ_ONLY.profileId }]);
    // Holds `tech.technician.read` and `wo.work_order.read` — NOT `tech.labor.record`.
    const resolved = await resolveOwnProfile(TECH_READ_ONLY, seeded.jobId);
    expect(resolved.technicianProfileId).toBe(TECH_READ_ONLY.profileId);
  });
});

describe('P1-29 W4 — labour is recorded against the resolved identity, and re-read', () => {
  it('W4-3 a start PERSISTS, and the web mirror is the session’s shape', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    const own = await resolveOwnProfile(TECH_ONE, seeded.jobId);

    authAsSubject(TECH_ONE.subject);
    const started = await start(seeded.jobId, { technicianProfileId: own.technicianProfileId });
    expect(started.status).toBe(201);
    const session = await json<SessionRow>(started);
    expect(session.technicianProfileId).toBe(TECH_ONE.profileId);
    expect(session.jobId).toBe(seeded.jobId);
    expect(session.endedAt).toBeNull();
    expect(Object.keys(session).sort()).toEqual([...mirrorFields(CONTRACT, 'LaborSession')].sort());

    authAsSubject(TECH_ONE.subject);
    const listed = await json<Items<SessionRow>>(await sessions(seeded.jobId));
    const persisted = listed.items.find((entry) => entry.id === session.id);
    expect(persisted, 'the started session is not in the re-read').toBeDefined();
    expect(persisted?.endedAt).toBeNull();

    // Leave nothing open: the EXCLUDE would refuse every later start for this technician.
    authAsSubject(TECH_ONE.subject);
    expect((await stop(session.id, session.recordVersion)).status).toBe(200);
  });

  it('W4-4 a stop PERSISTS an end; a stale stop is refused and changes nothing', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    const own = await resolveOwnProfile(TECH_ONE, seeded.jobId);

    authAsSubject(TECH_ONE.subject);
    const session = await json<SessionRow>(
      await start(seeded.jobId, { technicianProfileId: own.technicianProfileId })
    );

    // Absent If-Match: 428, and the session is still open.
    authAsSubject(TECH_ONE.subject);
    expect((await stop(session.id, null)).status).toBe(428);

    // Stale version: refused, and the session is still open.
    authAsSubject(TECH_ONE.subject);
    const stale = await stop(session.id, session.recordVersion + 1);
    expect(stale.status).toBe(409);
    authAsSubject(TECH_ONE.subject);
    const still = await json<Items<SessionRow>>(await sessions(seeded.jobId));
    expect(still.items.find((entry) => entry.id === session.id)?.endedAt).toBeNull();

    // The version on screen: stops.
    authAsSubject(TECH_ONE.subject);
    const stopped = await stop(session.id, session.recordVersion);
    expect(stopped.status).toBe(200);
    const closed = await json<SessionRow>(stopped);
    expect(closed.endedAt).not.toBeNull();
    expect(closed.recordVersion).toBeGreaterThan(session.recordVersion);

    authAsSubject(TECH_ONE.subject);
    const after = await json<Items<SessionRow>>(await sessions(seeded.jobId));
    expect(after.items.find((entry) => entry.id === session.id)?.endedAt).toBe(closed.endedAt);

    // Stopping a stopped session is refused, whatever version is sent.
    authAsSubject(TECH_ONE.subject);
    expect((await stop(session.id, closed.recordVersion)).status).not.toBe(200);
  });

  it('W4-4b a correction is a HIGHER authority the recording technician does not hold', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    const own = await resolveOwnProfile(TECH_ONE, seeded.jobId);
    authAsSubject(TECH_ONE.subject);
    const session = await json<SessionRow>(
      await start(seeded.jobId, { technicianProfileId: own.technicianProfileId })
    );
    authAsSubject(TECH_ONE.subject);
    const closed = await json<SessionRow>(await stop(session.id, session.recordVersion));

    const window = {
      startedAt: closed.startedAt,
      endedAt: closed.endedAt,
      reason: 'W4 — clock started late',
    };
    // `tech.labor.record` does not confer `tech.labor.correct`.
    authAsSubject(TECH_ONE.subject);
    expect((await correct(session.id, window, closed.recordVersion)).status).toBe(403);
    // The holder of `tech.labor.correct` may, with the version the screen shows.
    authAs(FULL);
    expect((await correct(session.id, window, closed.recordVersion)).status).toBe(201);
  });
});

describe('P1-29 W4 — cross-technician and cross-tenant execution', () => {
  it('W4-5a another tenant’s technician cannot start on this job, whatever id they name', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    authAsSubject(TECH_B.subject, TENANT_B);
    const response = await start(seeded.jobId, { technicianProfileId: TECH_ONE.profileId });
    expect(response.status).toBe(404);
  });

  it('W4-5b a grant in another branch cannot start on this branch’s job', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    authAs(SCOPED_ELSEWHERE); // holds tech.labor.record — in BRANCH_A2 only
    const response = await start(seeded.jobId, { technicianProfileId: TECH_ONE.profileId });
    // 404, not 403: a profile outside the caller's scope is NOT VISIBLE, and the
    // backend does not confirm that a record it will not show exists.
    expect(response.status).toBe(404);
    authAsSubject(TECH_ONE.subject);
    const listed = await json<Items<SessionRow>>(await sessions(seeded.jobId));
    expect(listed.items).toHaveLength(0);
  });

  it('W4-5c read authority is not write authority — queue yes, start no', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_READ_ONLY.profileId }]);
    const own = await resolveOwnProfile(TECH_READ_ONLY, seeded.jobId);
    authAsSubject(TECH_READ_ONLY.subject);
    expect(
      (await start(seeded.jobId, { technicianProfileId: own.technicianProfileId })).status
    ).toBe(403);
    authAsSubject(TECH_READ_ONLY.subject);
    expect((await recordWorkLog(seeded.jobId, { entry: 'not permitted' })).status).toBe(403);
  });

  it('W4-5d another technician cannot stop this technician’s session with a guessed version, and the record is unchanged', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    const own = await resolveOwnProfile(TECH_ONE, seeded.jobId);
    authAsSubject(TECH_ONE.subject);
    const session = await json<SessionRow>(
      await start(seeded.jobId, { technicianProfileId: own.technicianProfileId })
    );

    // Tenant B: not visible at all.
    authAsSubject(TECH_B.subject, TENANT_B);
    expect((await stop(session.id, session.recordVersion)).status).toBe(404);
    // Another branch: not visible.
    authAs(SCOPED_ELSEWHERE);
    expect((await stop(session.id, session.recordVersion)).status).toBe(404);
    // No labour authority: refused.
    authAsSubject(TECH_READ_ONLY.subject);
    expect((await stop(session.id, session.recordVersion)).status).toBe(403);

    authAsSubject(TECH_ONE.subject);
    const still = await json<Items<SessionRow>>(await sessions(seeded.jobId));
    expect(still.items.find((entry) => entry.id === session.id)?.endedAt).toBeNull();

    authAsSubject(TECH_ONE.subject);
    expect((await stop(session.id, session.recordVersion)).status).toBe(200);
  });

  it('W4-5e TRIPWIRE — the backend does NOT refuse a same-branch technician naming another’s profile', async () => {
    /*
     * MEASURED, not endorsed. `tech.labor.record` is a branch-scoped recording
     * authority (`p1-19`), so TECH_TWO — a technician, not a timekeeper — can
     * clock TECH_ONE onto a job through the API. The workspace adapter refuses
     * to build this request, and that refusal is proved in
     * `apps/web/tests/technicians-workspace-api.test.ts`; but an adapter is not
     * a boundary, and this case says so in the only place it cannot be
     * overlooked. When the backend closes it, this assertion fails and the
     * finding recorded in the canonical plan is closed with it.
     */
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    authAsSubject(TECH_TWO.subject);
    const response = await start(seeded.jobId, { technicianProfileId: TECH_ONE.profileId });
    const text = await response.clone().text();
    expect(response.status, text).toBe(201);

    // Leave nothing open for TECH_ONE.
    const session = await json<SessionRow>(response);
    expect(session.technicianProfileId).toBe(TECH_ONE.profileId);
    authAsSubject(TECH_TWO.subject);
    expect((await stop(session.id, session.recordVersion)).status).toBe(200);
  });
});

describe('P1-29 W4 — the work log is free text, append-only, and re-read verbatim', () => {
  it('W4-6 an entry PERSISTS exactly as written, and the web mirror is its shape', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    // The seam is what the adapter uses to know the job is the caller's own;
    // the backend itself scopes the write to the branch.
    await resolveOwnProfile(TECH_ONE, seeded.jobId);

    const text = `Bled the rear circuit; pedal firm. ${randomUUID()}`;
    authAsSubject(TECH_ONE.subject);
    const recorded = await recordWorkLog(seeded.jobId, { entry: text });
    expect(recorded.status).toBe(201);
    const entry = await json<WorkLogRow>(recorded);
    expect(entry.entry).toBe(text);
    expect(Object.keys(entry).sort()).toEqual([...mirrorFields(CONTRACT, 'WorkLogEntry')].sort());
    // No version on the row: there is nothing to edit it with.
    expect(entry).not.toHaveProperty('recordVersion');

    authAsSubject(TECH_ONE.subject);
    const listed = await json<Items<WorkLogRow>>(await workLog(seeded.jobId));
    expect(listed.items.find((row) => row.id === entry.id)?.entry).toBe(text);
  });

  it('W4-6b another tenant and another branch are refused; the row count does not move', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    authAsSubject(TECH_ONE.subject);
    const before = (await json<Items<WorkLogRow>>(await workLog(seeded.jobId))).items.length;

    authAsSubject(TECH_B.subject, TENANT_B);
    expect((await recordWorkLog(seeded.jobId, { entry: 'from tenant B' })).status).toBe(404);
    authAs(SCOPED_ELSEWHERE);
    expect((await recordWorkLog(seeded.jobId, { entry: 'from branch A2' })).status).toBe(404);
    authAsSubject(TECH_B.subject, TENANT_B);
    expect((await workLog(seeded.jobId)).status).toBe(404);

    authAsSubject(TECH_ONE.subject);
    const after = (await json<Items<WorkLogRow>>(await workLog(seeded.jobId))).items.length;
    expect(after).toBe(before);
  });
});

describe('P1-29 W4 — evidence binds a captured version, and is re-read', () => {
  it('W4-9 a binding PERSISTS, and the web mirror is its shape', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);
    await resolveOwnProfile(TECH_ONE, seeded.jobId);
    const versionId = await seedDocumentVersion();

    authAsSubject(TECH_ONE.subject);
    const recorded = await recordEvidence(seeded.jobId, {
      documentVersionId: versionId,
      evidenceType: 'after',
      note: 'Pads seated, rotor surface clean.',
    });
    expect(recorded.status).toBe(201);
    const row = await json<EvidenceRow>(recorded);
    expect(row.documentVersionId).toBe(versionId);
    expect(Object.keys(row).sort()).toEqual([...mirrorFields(CONTRACT, 'JobEvidenceEntry')].sort());

    authAsSubject(TECH_ONE.subject);
    const listed = await json<Items<EvidenceRow>>(await evidence(seeded.jobId));
    expect(listed.items.find((entry) => entry.id === row.id)?.evidenceType).toBe('after');

    // Read authority does not bind.
    authAsSubject(TECH_READ_ONLY.subject);
    expect(
      (await recordEvidence(seeded.jobId, { documentVersionId: versionId, evidenceType: 'x' }))
        .status
    ).toBe(403);
  });
});

describe('P1-29 W4 — access to the workspace itself', () => {
  it('W4-7 no permission is refused; a work-order reader is refused the queue', async () => {
    authAsSubject(SUBJECT_UNPERMITTED);
    expect((await meQueue({ companyId: COMPANY_A1, branchId: BRANCH_A1 })).status).toBe(403);
    authAs(READER); // wo.work_order.read only
    expect((await meQueue({ companyId: COMPANY_A1, branchId: BRANCH_A1 })).status).toBe(403);
  });

  it('W4-8 another tenant’s technician sees none of this tenant’s work', async () => {
    const seeded = await seedAssignedJob([{ profileId: TECH_ONE.profileId }]);

    // Their own queue, in their own tenant, does not carry it.
    authAsSubject(TECH_B.subject, TENANT_B);
    const ownQueue = await meQueue({ companyId: COMPANY_B1, branchId: BRANCH_B1 });
    expect(ownQueue.status).toBe(200);
    expect(
      (await json<Items<QueueEntry>>(ownQueue)).items.map((entry) => entry.jobId)
    ).not.toContain(seeded.jobId);

    // Naming this tenant's branch as the target answers the EMPTY queue — byte-
    // identical to "no profile", which is the route's documented posture: a
    // distinct refusal would tell a prober that the pair exists somewhere.
    authAsSubject(TECH_B.subject, TENANT_B);
    const foreign = await meQueue({ companyId: COMPANY_A1, branchId: BRANCH_A1 });
    expect(foreign.status).toBe(200);
    expect((await json<Items<QueueEntry>>(foreign)).items).toEqual([]);

    // The job's reads are invisible from there.
    authAsSubject(TECH_B.subject, TENANT_B);
    expect((await assignments(seeded.jobId)).status).toBe(404);
    authAsSubject(TECH_B.subject, TENANT_B);
    expect((await sessions(seeded.jobId)).status).toBe(404);
    authAsSubject(TECH_B.subject, TENANT_B);
    expect((await evidence(seeded.jobId)).status).toBe(404);
  });
});
