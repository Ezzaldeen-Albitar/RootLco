/**
 * Technician identity authority — `GET /technicians/me/queue` (PRE-P1-29-BR-01).
 *
 * Closes `INS-04` (CRITICAL) and threat `T-11`. The existing queue read takes the
 * technician profile id from the PATH, and `GET /auth/session` returns no profile
 * reference — so a signed-in technician had no legitimate way to learn the id the
 * endpoint demands, and the only available shapes were matching on a display name
 * (which collides) or walking ids against the endpoint (an enumeration oracle over
 * staff assignments).
 *
 * The invariants this suite exists for:
 *
 *  1. **The subject is the session, and there is nothing to forge.** The schema has
 *     no field naming a technician, and `.strict()` REFUSES one rather than
 *     ignoring it — a caller who believes they selected a subject must be told they
 *     did not, never quietly served their own queue instead.
 *  2. **The identifier never crosses the wire in either direction.** The response
 *     is `{items}` alone; the existing endpoint's envelope carries the id only
 *     because the caller supplied it.
 *  3. **Three different "no" answers are ONE indistinguishable response.** No
 *     profile, a profile in a branch the caller did not name, and an inactive or
 *     soft-deleted profile all answer `200 {items: []}`, byte-identical. A `404`
 *     or a distinct code would tell an unauthorised prober that somebody else IS a
 *     technician — the same oracle, moved rather than closed.
 *  4. **The company/branch pair is evaluated, not merely accepted.** A caller
 *     holding the read in one branch and some unrelated grant in another is
 *     REFUSED the second, which is only provable with a principal whose grant union
 *     contains both (P1-18-A-01).
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   tech.technician-me-queue: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
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
  AVAILABLE_FROM,
  AVAILABLE_MID,
  AVAILABLE_TO,
  FULL,
  SPLIT_WINDOW,
  authAsSubject,
  createOpenWorkOrder,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import {
  ROSTER_ADMIN,
  ROSTER_READER,
  ROSTER_SCOPED_A2,
  ROSTER_TENANT_B,
  authAs,
  establishBr03Fixtures,
  resetRoster,
} from './br-03-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as ME_QUEUE } from '@/app/api/v1/technicians/me/queue/route';
import { GET as OTHER_QUEUE } from '@/app/api/v1/technicians/[technicianProfileId]/queue/route';
import { POST as CREATE_JOB } from '@/app/api/v1/work-orders/[workOrderId]/jobs/route';
import { POST as ASSIGN } from '@/app/api/v1/jobs/[jobId]/assignments/route';

let admin: Pool;
let runtime: Pool;

interface QueueBody {
  readonly items: readonly { readonly jobId: string; readonly workOrderId: string }[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

function meQueue(query: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/v1/technicians/me/queue');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return ME_QUEUE(new Request(url));
}

function otherQueue(technicianProfileId: string): Promise<Response> {
  return OTHER_QUEUE(
    new Request(`http://localhost/api/v1/technicians/${technicianProfileId}/queue`),
    { params: Promise.resolve({ technicianProfileId }) }
  );
}

const inScope = { companyId: COMPANY_A1, branchId: BRANCH_A1 };

/**
 * Gives an EXISTING principal a technician profile.
 *
 * The P1-19 fixture technicians each carry their own generated account, which
 * holds no grant — so none of them can sign in. This operation's whole subject is
 * the signed-in caller, so the fixture it needs is the other way round: a
 * principal that already holds `tech.technician.read` and is ALSO on the roster.
 */
async function seedProfileFor(
  userId: string,
  options: {
    readonly companyId?: string;
    readonly branchId?: string;
    readonly tenantId?: string;
    readonly isActive?: boolean;
    readonly softDeleted?: boolean;
  } = {}
): Promise<string> {
  const tenantId = options.tenantId ?? TENANT_A;
  const companyId = options.companyId ?? COMPANY_A1;
  const branchId = options.branchId ?? BRANCH_A1;
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tech.technician_profiles
         (tenant_id, company_id, branch_id, user_id, trade, is_active, created_by)
       VALUES ($1,$2,$3,$4,'mechanic',$5,$6) RETURNING id`,
      [tenantId, companyId, branchId, userId, options.isActive ?? true, USER_A]
    );
    const id = inserted.rows[0]?.id ?? '';
    // The split shift the P1-19 fixtures use. Without it `assertEligible` refuses
    // the assignment and the queue would be empty for a reason that has nothing to
    // do with what this suite is testing.
    for (const [from_, to_] of [
      [AVAILABLE_FROM, AVAILABLE_MID],
      [AVAILABLE_MID, AVAILABLE_TO],
    ] as const) {
      await client.query(
        `INSERT INTO tech.technician_availability
           (tenant_id, company_id, branch_id, technician_profile_id, available_from,
            available_to, availability_kind, created_by)
         VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,'available',$7)`,
        [tenantId, companyId, branchId, id, from_, to_, USER_A]
      );
    }
    if (options.softDeleted === true) {
      await client.query(
        `UPDATE tech.technician_profiles SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
        [id, USER_A]
      );
    }
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** An open work order with one job, ready to receive an assignment. */
async function seedJob(branchId = BRANCH_A1): Promise<string> {
  const order = await createOpenWorkOrder({ branchId });
  // FULL, not a roster principal: creating a job needs `wo.job.manage`, which the
  // BR-03 roster principals deliberately do not hold.
  authAs(FULL);
  const created = await CREATE_JOB(
    new Request(`http://localhost/api/v1/work-orders/${order.workOrderId}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ title: 'BR-01 fixture job' }),
    }),
    { params: Promise.resolve({ workOrderId: order.workOrderId }) }
  );
  expect(created.status).toBe(201);
  return (await bodyOf<{ id: string }>(created)).id;
}

async function assignTo(jobId: string, technicianProfileId: string): Promise<void> {
  authAs(FULL);
  const response = await ASSIGN(
    new Request(`http://localhost/api/v1/jobs/${jobId}/assignments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({
        technicianProfileId,
        window: { from: SPLIT_WINDOW.from, to: SPLIT_WINDOW.to },
      }),
    }),
    { params: Promise.resolve({ jobId }) }
  );
  expect(response.status).toBe(201);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishBr03Fixtures(admin);
  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);
});

afterEach(async () => {
  __resetAuthenticatorForTests();
  // Assignments reference the profile by foreign key, so they unwind first —
  // `resetRoster` alone hits fk_job_assignments_technician.
  await admin.query('DELETE FROM wo.job_assignments');
  await resetRoster();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('tech.technician-me-queue — positive', () => {
  it('P1/P2 serves the caller their own queue, and never names the profile', async () => {
    const profileId = await seedProfileFor(ROSTER_READER.userId);
    const jobId = await seedJob();
    await assignTo(jobId, profileId);

    authAs(ROSTER_READER);
    const response = await meQueue(inScope);
    expect(response.status).toBe(200);
    const body = await bodyOf<QueueBody>(response);
    expect(body.items.map((row) => row.jobId)).toEqual([jobId]);

    // P2, asserted as a KEY SET rather than field-by-field: naming the field that
    // must be absent would pass an implementation that added a different one.
    expect(Object.keys(body)).toEqual(['items']);
    expect(JSON.stringify(body)).not.toContain(profileId);
  });

  it('P3 returns exactly what the supervisor path returns for that profile', async () => {
    const profileId = await seedProfileFor(ROSTER_READER.userId);
    const first = await seedJob();
    const second = await seedJob();
    await assignTo(first, profileId);
    await assignTo(second, profileId);

    authAs(ROSTER_READER);
    const mine = await bodyOf<QueueBody>(await meQueue(inScope));
    authAs(ROSTER_ADMIN);
    const theirs = await bodyOf<{ technicianProfileId: string; items: QueueBody['items'] }>(
      await otherQueue(profileId)
    );

    // Same rows, same order — the two paths differ only in how the subject is
    // determined, never in what they answer.
    expect(mine.items).toEqual(theirs.items);
    // ...and the supervisor envelope still carries the id, because that caller
    // supplied it. This slice adds a safe path; it does not remove the other one.
    expect(theirs.technicianProfileId).toBe(profileId);
  });

  it('P4 serves a caller holding the code company-wide who also has a profile', async () => {
    const profileId = await seedProfileFor(ROSTER_ADMIN.userId);
    const jobId = await seedJob();
    await assignTo(jobId, profileId);
    authAs(ROSTER_ADMIN);
    const body = await bodyOf<QueueBody>(await meQueue(inScope));
    expect(body.items.map((row) => row.jobId)).toEqual([jobId]);
  });
});

describe('tech.technician-me-queue — negative', () => {
  it('N2 refuses a caller without tech.technician.read', async () => {
    authAsSubject(SUBJECT_UNPERMITTED);
    const response = await meQueue(inScope);
    expect(response.status).toBe(403);
    expect((await bodyOf<{ code?: string }>(response)).code).toBe('ERR-IAM-001');
  });

  it('N3/N4/N6 refuse a missing or malformed scope pair', async () => {
    authAs(ROSTER_READER);
    expect((await meQueue({ branchId: BRANCH_A1 })).status).toBe(422);
    expect((await meQueue({ companyId: COMPANY_A1 })).status).toBe(422);
    expect((await meQueue({ companyId: 'not-a-uuid', branchId: BRANCH_A1 })).status).toBe(422);
  });

  it('N5 REFUSES a client-supplied technicianProfileId rather than ignoring it', async () => {
    const profileId = await seedProfileFor(ROSTER_READER.userId);
    authAs(ROSTER_READER);
    // The exact shape this slice exists to make impossible: a caller trying to
    // name a subject. `.strict()` must refuse, never silently serve the caller's
    // own queue and leave them believing they selected somebody.
    const response = await meQueue({ ...inScope, technicianProfileId: profileId });
    expect(response.status).toBe(422);
    expect((await bodyOf<{ code?: string }>(response)).code).toBe('ERR-VAL-001');
  });

  it('N7 answers 200 with an empty queue when the caller has no profile', async () => {
    authAs(ROSTER_READER);
    const response = await meQueue(inScope);
    expect(response.status).toBe(200);
    expect(await bodyOf<QueueBody>(response)).toEqual({ items: [] });
  });

  it('N8/N9 answer the same for an inactive and for a soft-deleted profile', async () => {
    await seedProfileFor(ROSTER_READER.userId, { isActive: false });
    authAs(ROSTER_READER);
    expect(await bodyOf<QueueBody>(await meQueue(inScope))).toEqual({ items: [] });
    await resetRoster();

    await seedProfileFor(ROSTER_READER.userId, { softDeleted: true });
    authAs(ROSTER_READER);
    expect(await bodyOf<QueueBody>(await meQueue(inScope))).toEqual({ items: [] });
  });
});

describe('tech.technician-me-queue — security', () => {
  it('S1 cross-tenant: a tenant-A identity resolves nothing from tenant B', async () => {
    // A real profile exists in tenant B for the tenant-B principal.
    await seedProfileFor(ROSTER_TENANT_B.userId, {
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    authAs(ROSTER_READER);
    const response = await meQueue(inScope);
    expect(response.status).toBe(200);
    expect(await bodyOf<QueueBody>(response)).toEqual({ items: [] });
  });

  it('S2 cross-branch: a profile in another branch is not served under the named one', async () => {
    // The caller's profile is in A2; they name A1, where they also hold the read.
    const profileId = await seedProfileFor(ROSTER_READER.userId, { branchId: BRANCH_A2 });
    const jobId = await seedJob(BRANCH_A2);
    await assignTo(jobId, profileId);

    authAs(ROSTER_READER);
    const response = await meQueue(inScope);
    expect(response.status).toBe(200);
    // Empty — NOT the other branch's queue.
    expect(await bodyOf<QueueBody>(response)).toEqual({ items: [] });
  });

  it('S3 the scope pair is EVALUATED, not merely accepted', async () => {
    await seedProfileFor(ROSTER_SCOPED_A2.userId, { branchId: BRANCH_A2 });
    authAs(ROSTER_SCOPED_A2);
    // This principal holds `tech.technician.read` scoped to A2 and an unrelated
    // permission scoped to A1 — so A1 is inside its allowed-branch UNION and RLS
    // would show A1 rows. Only the scoped permission check can refuse this.
    expect((await meQueue(inScope)).status).toBe(403);
    // ...and its own branch is served, so the refusal is about scope.
    expect((await meQueue({ companyId: COMPANY_A1, branchId: BRANCH_A2 })).status).toBe(200);
  });

  it('S4 two technicians in one tenant each receive only their own rows', async () => {
    const mine = await seedProfileFor(ROSTER_READER.userId);
    const theirs = await seedProfileFor(ROSTER_ADMIN.userId);
    const myJob = await seedJob();
    const theirJob = await seedJob();
    await assignTo(myJob, mine);
    await assignTo(theirJob, theirs);

    authAs(ROSTER_READER);
    expect((await bodyOf<QueueBody>(await meQueue(inScope))).items.map((r) => r.jobId)).toEqual([
      myJob,
    ]);
    authAs(ROSTER_ADMIN);
    expect((await bodyOf<QueueBody>(await meQueue(inScope))).items.map((r) => r.jobId)).toEqual([
      theirJob,
    ]);
  });

  it('S5 the three empty cases are BYTE-IDENTICAL', async () => {
    authAs(ROSTER_READER);
    const noProfile = await (await meQueue(inScope)).text();

    await seedProfileFor(ROSTER_READER.userId, { isActive: false });
    authAs(ROSTER_READER);
    const inactive = await (await meQueue(inScope)).text();
    await resetRoster();

    await seedProfileFor(ROSTER_READER.userId, { branchId: BRANCH_A2 });
    authAs(ROSTER_READER);
    const otherBranch = await (await meQueue(inScope)).text();

    // The oracle is closed only if a prober cannot tell them apart.
    expect(inactive).toBe(noProfile);
    expect(otherBranch).toBe(noProfile);
  });

  it('S6 the profile-to-user edge cannot be re-pointed by the runtime role', async () => {
    const profileId = await seedProfileFor(ROSTER_READER.userId);
    // `tg_technician_profiles_immutable` guards user_id. Attempted as the runtime
    // login, not as the owner, so this is the authority the application actually
    // has.
    const client = await runtime.connect();
    let refused = false;
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      await client.query(`UPDATE tech.technician_profiles SET user_id = $2 WHERE id = $1`, [
        profileId,
        ROSTER_ADMIN.userId,
      ]);
      await client.query('COMMIT');
    } catch {
      refused = true;
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(refused, 'user_id must not be re-pointable').toBe(true);
  });
});
