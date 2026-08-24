/**
 * Technician roster administration — profiles (BR-03, PRE-P1-29 backend remediation).
 *
 * The invariants this suite exists for:
 *
 *  1. **`branch_id` and `user_id` are IMMUTABLE, and the API says so rather than
 *     ignoring it.** `tg_technician_profiles_immutable` freezes both. A PATCH
 *     naming either is a 422 from `.strict()` — never a silent drop, because a
 *     caller who believes a branch transfer happened when it did not is worse
 *     off than one who was refused. The suite asserts the refusal AND that the
 *     stored branch is unchanged, read as the owner rather than through RLS.
 *  2. **A branch transfer is retire-then-create, and it works.** The suite drives
 *     the whole cycle to prove the documented path is real: retiring frees the
 *     `uq_technician_profiles_active_user` slot, and the create in the target
 *     branch then succeeds — which it cannot while the first profile is live.
 *  3. **Scope is decided from the ROW, not from the request.** Every id-addressed
 *     operation resolves the profile first and re-decides against the profile's
 *     own company and branch. `ROSTER_SCOPED_A2` is refused an A1 profile *while
 *     A1 is inside its allowed-branch union*, which is the only arrangement in
 *     which the refusal proves a scoped permission check rather than RLS
 *     (P1-18-A-01).
 *  4. **A retirement is a soft delete.** The row survives with `deleted_at` set,
 *     because assignments and labour sessions were decided against it.
 *  5. **No personal data enters the profile.** The create body has no word for a
 *     name, an email or a contact detail, and the read returns none.
 *
 * Operations exercised here: tech.technician-list, tech.technician-create,
 * tech.technician-detail, tech.technician-update.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   tech.technician-list: route service authorization success denial isolation
 *   tech.technician-create: route service authorization success denial isolation audit idempotency
 *   tech.technician-detail: route service authorization success denial cross-tenant isolation
 *   tech.technician-update: route service authorization success denial cross-tenant isolation audit stale-version
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  SUBJECT_UNPERMITTED,
  TENANT_A,
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
  authAsSubject,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import {
  BR03_USER_EIGHT,
  BR03_USER_FIVE,
  BR03_USER_FOUR,
  BR03_USER_ONE,
  BR03_USER_SEVEN,
  BR03_USER_SIX,
  BR03_USER_TENANT_B,
  BR03_USER_THREE,
  BR03_USER_TWO,
  ROSTER_ADMIN,
  ROSTER_READER,
  ROSTER_SCOPED_A2,
  ROSTER_TENANT_B,
  auditCountFor,
  authAs,
  establishBr03Fixtures,
  rawProfile,
  resetRoster,
} from './br-03-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as LIST, POST as CREATE } from '@/app/api/v1/technicians/route';
import {
  GET as DETAIL,
  PATCH as UPDATE,
} from '@/app/api/v1/technicians/[technicianProfileId]/route';

const CREATED_ACTION = 'tech.technician.profile_created';
const UPDATED_ACTION = 'tech.technician.profile_updated';
const RETIRED_ACTION = 'tech.technician.profile_retired';

let admin: Pool;
let runtime: Pool;

interface ProfileBody {
  readonly id: string;
  readonly userId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly trade: string | null;
  readonly employmentRef: string | null;
  readonly isActive: boolean;
  readonly recordVersion: number;
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const problem = async (
  response: Response
): Promise<{
  code?: string;
  violations?: readonly { path: string; rule: string }[];
}> =>
  (await response.json()) as {
    code?: string;
    violations?: readonly { path: string; rule: string }[];
  };

function list(query: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/v1/technicians');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return LIST(new Request(url));
}

function create(body: unknown, options: { readonly key?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key !== null) headers['idempotency-key'] = options.key ?? randomUUID();
  return CREATE(
    new Request('http://localhost/api/v1/technicians', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  );
}

function detail(technicianProfileId: string): Promise<Response> {
  return DETAIL(new Request(`http://localhost/api/v1/technicians/${technicianProfileId}`), {
    params: Promise.resolve({ technicianProfileId }),
  });
}

function update(
  technicianProfileId: string,
  body: unknown,
  options: { readonly version?: number | null } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return UPDATE(
    new Request(`http://localhost/api/v1/technicians/${technicianProfileId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ technicianProfileId }) }
  );
}

/** Creates a profile as `ROSTER_ADMIN` and returns it. Fails loudly, never silently. */
async function newProfile(
  userId: string,
  branchId = BRANCH_A1,
  extra: Record<string, unknown> = {}
): Promise<ProfileBody> {
  authAs(ROSTER_ADMIN);
  const response = await create({ userId, companyId: COMPANY_A1, branchId, ...extra });
  expect(response.status).toBe(201);
  return bodyOf<ProfileBody>(response);
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

describe('tech.technician-create', () => {
  it('puts a user on a branch roster, active, and audits the fact', async () => {
    authAs(ROSTER_ADMIN);
    const response = await create({
      userId: BR03_USER_ONE,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      trade: 'mechanic',
      employmentRef: 'EMP-0001',
    });
    expect(response.status).toBe(201);
    const profile = await bodyOf<ProfileBody>(response);
    expect(profile.userId).toBe(BR03_USER_ONE);
    expect(profile.branchId).toBe(BRANCH_A1);
    expect(profile.trade).toBe('mechanic');
    expect(profile.employmentRef).toBe('EMP-0001');
    // A created profile is ACTIVE. The body has no word for anything else.
    expect(profile.isActive).toBe(true);
    expect(profile.recordVersion).toBe(1);
    expect(await auditCountFor(CREATED_ACTION, profile.id)).toBe(1);
  });

  it('never carries a name, an email or any other personal detail', async () => {
    const profile = await newProfile(BR03_USER_TWO);
    // A KEY-SET assertion in both directions. Naming the fields that must be
    // absent would pass an implementation that added a seventh personal one.
    expect(Object.keys(profile).sort()).toEqual([
      'branchId',
      'companyId',
      'employmentRef',
      'id',
      'isActive',
      'recordVersion',
      'trade',
      'userId',
    ]);
  });

  it('refuses a body field the schema does not enumerate', async () => {
    authAs(ROSTER_ADMIN);
    // Mass assignment is prohibited: `isActive` is a real COLUMN and is
    // deliberately not a create field, so this is the exact shape a mass
    // assignment would take.
    const response = await create({
      userId: BR03_USER_THREE,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      isActive: false,
    });
    expect(response.status).toBe(422);
    expect((await problem(response)).code).toBe('ERR-VAL-001');
    expect(await rosterCount(BRANCH_A1, BR03_USER_THREE)).toBe(0);
  });

  it('refuses a second live profile for a user who already has one', async () => {
    const first = await newProfile(BR03_USER_FOUR);
    authAs(ROSTER_ADMIN);
    const again = await create({
      userId: BR03_USER_FOUR,
      companyId: COMPANY_A1,
      branchId: BRANCH_A2,
    });
    expect(again.status).toBe(409);
    const failure = await problem(again);
    expect(failure.code).toBe('ERR-RES-002');
    expect(failure.violations?.[0]?.rule).toBe('duplicate-active-profile');
    // And the existing profile is untouched — a refused create writes nothing.
    expect((await rawProfile(first.id))?.branchId).toBe(BRANCH_A1);
  });

  it('refuses a user account that belongs to another tenant', async () => {
    authAs(ROSTER_ADMIN);
    // A REAL account, not a random uuid: naming a uuid that exists nowhere would
    // prove only that unknown ids are refused, not that the check is scoped to
    // the caller's tenant.
    const response = await create({
      userId: BR03_USER_TENANT_B,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    expect(response.status).toBe(422);
    expect((await problem(response)).violations?.[0]?.rule).toBe('unknown-user');
  });

  it('refuses a caller holding read but not manage', async () => {
    authAs(ROSTER_READER);
    const response = await create({
      userId: BR03_USER_FIVE,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    expect(response.status).toBe(403);
    expect((await problem(response)).code).toBe('ERR-IAM-001');
    expect(await rosterCount(BRANCH_A1, BR03_USER_FIVE)).toBe(0);
  });

  it('refuses a branch outside the caller scope, and serves the one inside it', async () => {
    authAs(ROSTER_SCOPED_A2);
    // A1 is inside this principal's allowed-branch UNION (the widening grant), so
    // RLS would happily show it. The only thing that can refuse this is the
    // scoped permission check itself.
    const outside = await create({
      userId: BR03_USER_SIX,
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
    });
    expect(outside.status).toBe(403);
    expect(await rosterCount(BRANCH_A1, BR03_USER_SIX)).toBe(0);

    const inside = await create({
      userId: BR03_USER_SIX,
      companyId: COMPANY_A1,
      branchId: BRANCH_A2,
    });
    expect(inside.status).toBe(201);
    expect((await bodyOf<ProfileBody>(inside)).branchId).toBe(BRANCH_A2);
  });

  it('replays under one idempotency key without creating a second profile', async () => {
    const key = randomUUID();
    authAs(ROSTER_ADMIN);
    const first = await create(
      { userId: BR03_USER_SEVEN, companyId: COMPANY_A1, branchId: BRANCH_A1 },
      { key }
    );
    expect(first.status).toBe(201);
    const created = await bodyOf<ProfileBody>(first);

    const replay = await create(
      { userId: BR03_USER_SEVEN, companyId: COMPANY_A1, branchId: BRANCH_A1 },
      { key }
    );
    // 200 rather than the original 201, and that is the platform's contract, not
    // a BR-03 choice: `withIdempotency` replays the stored BODY only, so the
    // handler result carries no status and the response falls back to 200.
    expect(replay.status).toBe(200);
    expect((await bodyOf<ProfileBody>(replay)).id).toBe(created.id);
    // Counted as DELTAS on the side effects, not on the response: a replay that
    // returned the right body while writing a second audit row would still be a
    // broken replay (CSA-22).
    expect(await rosterCount(BRANCH_A1, BR03_USER_SEVEN)).toBe(1);
    expect(await auditCountFor(CREATED_ACTION, created.id)).toBe(1);
  });

  it('refuses an idempotency-critical request with no key', async () => {
    authAs(ROSTER_ADMIN);
    const response = await create(
      { userId: BR03_USER_EIGHT, companyId: COMPANY_A1, branchId: BRANCH_A1 },
      { key: null }
    );
    expect(response.status).toBe(400);
    expect((await problem(response)).code).toBe('ERR-INT-002');
  });
});

describe('tech.technician-detail', () => {
  it('resolves a profile id to its operational attributes', async () => {
    const created = await newProfile(BR03_USER_ONE, BRANCH_A1, { trade: 'diagnostician' });
    authAs(ROSTER_READER);
    const response = await detail(created.id);
    expect(response.status).toBe(200);
    const body = await bodyOf<{
      profile: ProfileBody;
      skills: readonly unknown[];
      certifications: readonly unknown[];
      availability: readonly unknown[];
    }>(response);
    expect(body.profile.id).toBe(created.id);
    expect(body.profile.trade).toBe('diagnostician');
    // The aggregate `INS-24` needs: one call, one screen. Empty is a real answer.
    expect(body.skills).toEqual([]);
    expect(body.certifications).toEqual([]);
    expect(body.availability).toEqual([]);
  });

  it('answers 404 for a tenant-B caller rather than confirming the profile exists', async () => {
    const created = await newProfile(BR03_USER_TWO);
    authAs(ROSTER_TENANT_B);
    const response = await detail(created.id);
    expect(response.status).toBe(404);
    expect((await problem(response)).code).toBe('ERR-RES-001');
  });

  it('separates a row it cannot see from a row it may not touch', async () => {
    const created = await newProfile(BR03_USER_THREE);
    authAs(ROSTER_SCOPED_A2);
    const outOfScope = await detail(created.id);
    const unknown = await detail(randomUUID());
    // 403 and 404, NOT the same answer — and this is the measured platform
    // convention rather than the one this suite first assumed. The profile is
    // read before the scope decision, and A1 is inside this principal's
    // allowed-branch union (the widening grant), so the row IS visible and
    // `authorizeScope` is what refuses it. That is the shipped `bil.invoice-read`
    // shape: load, then re-decide against the row's own company and branch.
    //
    // The split is therefore a property of the union, not of the branch: the
    // same principal WITHOUT the widening grant sees neither, and both answers
    // collapse to 404. `app.branch_ids` is permission-blind (P1-18-A-01), which
    // is exactly why the scope check cannot be left to RLS.
    expect(outOfScope.status).toBe(403);
    expect((await problem(outOfScope)).code).toBe('ERR-IAM-001');
    expect(unknown.status).toBe(404);
  });

  it('refuses a caller holding no technician permission at all', async () => {
    const created = await newProfile(BR03_USER_FOUR);
    // A tenant-A subject whose role carries no permission mappings. Its refusal
    // is 403 rather than the 404 an out-of-scope caller gets, because it fails
    // at the pre-handler check and the profile is never resolved.
    authAsSubject(SUBJECT_UNPERMITTED);
    const response = await detail(created.id);
    expect(response.status).toBe(403);
    expect((await problem(response)).code).toBe('ERR-IAM-001');

    authAs(ROSTER_READER);
    expect((await detail(created.id)).status).toBe(200);
  });
});

describe('tech.technician-update', () => {
  it('changes the mutable attributes and audits the change', async () => {
    const created = await newProfile(BR03_USER_ONE, BRANCH_A1, { trade: 'mechanic' });
    authAs(ROSTER_ADMIN);
    const response = await update(
      created.id,
      { trade: 'electrician', employmentRef: 'EMP-9', isActive: false },
      { version: created.recordVersion }
    );
    expect(response.status).toBe(200);
    const updated = await bodyOf<ProfileBody>(response);
    expect(updated.trade).toBe('electrician');
    expect(updated.employmentRef).toBe('EMP-9');
    expect(updated.isActive).toBe(false);
    expect(updated.recordVersion).toBe(created.recordVersion + 1);
    expect(await auditCountFor(UPDATED_ACTION, created.id)).toBe(1);
    // Deactivated is NOT retired: the row is live and still holds its slot.
    const stored = await rawProfile(created.id);
    expect(stored?.deletedAt).toBeNull();
    expect(stored?.isActive).toBe(false);
  });

  it('clears a nullable attribute when the caller sends null', async () => {
    const created = await newProfile(BR03_USER_TWO, BRANCH_A1, { trade: 'mechanic' });
    authAs(ROSTER_ADMIN);
    const response = await update(created.id, { trade: null }, { version: created.recordVersion });
    expect(response.status).toBe(200);
    expect((await bodyOf<ProfileBody>(response)).trade).toBeNull();
  });

  it('refuses a branch transfer by rejecting the field, and leaves the branch alone', async () => {
    const created = await newProfile(BR03_USER_THREE, BRANCH_A1);
    authAs(ROSTER_ADMIN);
    const response = await update(
      created.id,
      { branchId: BRANCH_A2 },
      { version: created.recordVersion }
    );
    // 422 rather than a silent drop. `tg_technician_profiles_immutable` would
    // refuse the write anyway, but a caller who believed the transfer happened
    // would act on a roster that never changed.
    expect(response.status).toBe(422);
    expect((await problem(response)).code).toBe('ERR-VAL-001');
    expect((await rawProfile(created.id))?.branchId).toBe(BRANCH_A1);
  });

  it('refuses a change of user_id for the same reason', async () => {
    const created = await newProfile(BR03_USER_FOUR);
    authAs(ROSTER_ADMIN);
    const response = await update(
      created.id,
      { userId: BR03_USER_FIVE },
      { version: created.recordVersion }
    );
    expect(response.status).toBe(422);
    expect((await rawProfile(created.id))?.userId).toBe(BR03_USER_FOUR);
  });

  it('refuses an empty body and a retire combined with a field change', async () => {
    const created = await newProfile(BR03_USER_SIX);
    authAs(ROSTER_ADMIN);
    const empty = await update(created.id, {}, { version: created.recordVersion });
    expect(empty.status).toBe(422);
    expect((await problem(empty)).violations?.[0]?.rule).toBe('empty-update');

    const both = await update(
      created.id,
      { retire: true, trade: 'mechanic' },
      { version: created.recordVersion }
    );
    expect(both.status).toBe(422);
    expect((await problem(both)).violations?.[0]?.rule).toBe('exclusive');
    expect((await rawProfile(created.id))?.deletedAt).toBeNull();
  });

  it('refuses a stale record version and a missing If-Match', async () => {
    const created = await newProfile(BR03_USER_SEVEN);
    authAs(ROSTER_ADMIN);
    const first = await update(created.id, { trade: 'a' }, { version: created.recordVersion });
    expect(first.status).toBe(200);

    const stale = await update(created.id, { trade: 'b' }, { version: created.recordVersion });
    expect(stale.status).toBe(409);
    expect((await problem(stale)).code).toBe('ERR-CON-001');

    const noHeader = await update(created.id, { trade: 'c' }, { version: null });
    expect(noHeader.status).toBe(428);
    expect((await problem(noHeader)).code).toBe('ERR-CON-002');
    // Neither refusal moved the row past the one successful edit.
    expect((await rawProfile(created.id))?.recordVersion).toBe(created.recordVersion + 1);
  });

  it('refuses a reader, and a profile outside the caller branch scope', async () => {
    const created = await newProfile(BR03_USER_EIGHT, BRANCH_A1);
    authAs(ROSTER_READER);
    const reader = await update(created.id, { trade: 'x' }, { version: created.recordVersion });
    expect(reader.status).toBe(403);

    authAs(ROSTER_SCOPED_A2);
    const scoped = await update(created.id, { trade: 'x' }, { version: created.recordVersion });
    // 403: the row is visible to this principal (A1 is inside its allowed-branch
    // union) and the scope check is what refuses the write. The refusal happens
    // AFTER the profile is loaded and BEFORE anything is written, which is the
    // assertion on the next line.
    expect(scoped.status).toBe(403);
    expect((await rawProfile(created.id))?.recordVersion).toBe(created.recordVersion);
  });

  it('retires by soft delete, keeping the row and its history', async () => {
    const created = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const response = await update(created.id, { retire: true }, { version: created.recordVersion });
    expect(response.status).toBe(200);
    expect(await auditCountFor(RETIRED_ACTION, created.id)).toBe(1);
    // The row SURVIVES. Assignments and labour sessions were decided against it.
    const stored = await rawProfile(created.id);
    expect(stored).not.toBeNull();
    expect(stored?.deletedAt).not.toBeNull();
    // And it is gone from every read.
    expect((await detail(created.id)).status).toBe(404);
  });

  it('makes a branch transfer possible as retire-then-create, in that order', async () => {
    const inA1 = await newProfile(BR03_USER_TWO, BRANCH_A1, { trade: 'mechanic' });

    // The order matters and the test proves it: while the A1 profile is live the
    // create is refused by `uq_technician_profiles_active_user`.
    authAs(ROSTER_ADMIN);
    const tooSoon = await create({
      userId: BR03_USER_TWO,
      companyId: COMPANY_A1,
      branchId: BRANCH_A2,
    });
    expect(tooSoon.status).toBe(409);

    const retired = await update(inA1.id, { retire: true }, { version: inA1.recordVersion });
    expect(retired.status).toBe(200);

    const inA2 = await newProfile(BR03_USER_TWO, BRANCH_A2);
    expect(inA2.branchId).toBe(BRANCH_A2);
    expect(inA2.id).not.toBe(inA1.id);
    // Both halves survive: the transfer is recorded, not rewritten.
    expect((await rawProfile(inA1.id))?.deletedAt).not.toBeNull();
  });
});

describe('tech.technician-list', () => {
  it('pages one branch roster and never another branch or another tenant', async () => {
    await newProfile(BR03_USER_ONE, BRANCH_A1);
    await newProfile(BR03_USER_TWO, BRANCH_A2);
    authAs(ROSTER_READER);
    const response = await list({ companyId: COMPANY_A1, branchId: BRANCH_A1, limit: '100' });
    expect(response.status).toBe(200);
    const page = await bodyOf<{ items: readonly ProfileBody[]; hasMore: boolean }>(response);
    const branches = new Set(page.items.map((row) => row.branchId));
    expect([...branches]).toEqual([BRANCH_A1]);
    expect(page.items.some((row) => row.userId === BR03_USER_ONE)).toBe(true);
    expect(page.items.some((row) => row.userId === BR03_USER_TWO)).toBe(false);
  });

  it('filters by active state without hiding the inactive roster by default', async () => {
    const active = await newProfile(BR03_USER_THREE, BRANCH_A1);
    const inactive = await newProfile(BR03_USER_FOUR, BRANCH_A1);
    authAs(ROSTER_ADMIN);
    expect(
      (await update(inactive.id, { isActive: false }, { version: inactive.recordVersion })).status
    ).toBe(200);

    authAs(ROSTER_READER);
    const all = await bodyOf<{ items: readonly ProfileBody[] }>(
      await list({ companyId: COMPANY_A1, branchId: BRANCH_A1, limit: '100' })
    );
    const ids = all.items.map((row) => row.id);
    expect(ids).toContain(active.id);
    expect(ids).toContain(inactive.id);

    const onlyActive = await bodyOf<{ items: readonly ProfileBody[] }>(
      await list({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        isActive: 'true',
        limit: '100',
      })
    );
    expect(onlyActive.items.map((row) => row.id)).toContain(active.id);
    expect(onlyActive.items.map((row) => row.id)).not.toContain(inactive.id);
  });

  it('walks a keyset page boundary without dropping or repeating a row', async () => {
    // The cursor renders microsecond precision deliberately: a JS `Date` cursor
    // truncates to milliseconds, and rows created inside the same millisecond
    // are then silently skipped (P1-27-INT-006). Eight rows created back to back
    // is exactly that condition.
    const users = [
      BR03_USER_ONE,
      BR03_USER_TWO,
      BR03_USER_THREE,
      BR03_USER_FOUR,
      BR03_USER_FIVE,
      BR03_USER_SIX,
      BR03_USER_SEVEN,
      BR03_USER_EIGHT,
    ];
    for (const user of users) await newProfile(user, BRANCH_A1);

    authAs(ROSTER_READER);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const query: Record<string, string> = {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        limit: '3',
      };
      if (cursor !== null) query.cursor = cursor;
      const page = await bodyOf<{
        items: readonly ProfileBody[];
        nextCursor: string | null;
        hasMore: boolean;
      }>(await list(query));
      seen.push(...page.items.map((row) => row.id));
      if (!page.hasMore) break;
      cursor = page.nextCursor;
      expect(cursor).not.toBeNull();
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(users.length);
  });

  it('refuses a branch the caller has no technician authority in', async () => {
    await newProfile(BR03_USER_ONE, BRANCH_A1);
    authAs(ROSTER_SCOPED_A2);
    const outside = await list({ companyId: COMPANY_A1, branchId: BRANCH_A1, limit: '10' });
    // Refused rather than answered EMPTY. An empty roster and a forbidden one
    // read the same to a screen, and a supervisor would conclude nobody works
    // in that branch.
    expect(outside.status).toBe(403);

    const inside = await list({ companyId: COMPANY_A1, branchId: BRANCH_A2, limit: '10' });
    expect(inside.status).toBe(200);
  });

  it('refuses an unknown query parameter and a malformed cursor', async () => {
    authAs(ROSTER_READER);
    const unknown = await list({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      sortBy: 'trade',
    });
    expect(unknown.status).toBe(422);

    const badCursor = await list({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      cursor: 'not-a-cursor',
    });
    expect(badCursor.status).toBe(400);
    expect((await problem(badCursor)).code).toBe('ERR-PAG-001');
  });

  it('never serves another tenant a roster in this tenant', async () => {
    await newProfile(BR03_USER_ONE, BRANCH_A1);
    authAs(ROSTER_TENANT_B);
    const response = await list({ companyId: COMPANY_A1, branchId: BRANCH_A1, limit: '10' });
    // 200 and EMPTY, not 403 — and that is the measured behaviour rather than
    // the expected one. `iam.has_permission_in_scope` returns true for ANY
    // company/branch pair when the grant is unrestricted, including a pair from
    // another tenant, so the permission check cannot be the tenant boundary
    // here. The boundary is the query's own `tenant_id = current tenant`
    // predicate with RLS behind it, and an empty page discloses less than a
    // refusal that would confirm the branch exists somewhere.
    expect(response.status).toBe(200);
    expect((await bodyOf<{ items: readonly ProfileBody[] }>(response)).items).toEqual([]);

    const own = await list({ companyId: COMPANY_B1, branchId: BRANCH_B1, limit: '10' });
    expect(own.status).toBe(200);
    expect((await bodyOf<{ items: readonly ProfileBody[] }>(own)).items).toEqual([]);
  });

  it('refuses a caller holding no technician permission at all', async () => {
    await newProfile(BR03_USER_ONE, BRANCH_A1);
    authAsSubject(SUBJECT_UNPERMITTED);
    const response = await list({ companyId: COMPANY_A1, branchId: BRANCH_A1, limit: '10' });
    expect(response.status).toBe(403);
    expect((await problem(response)).code).toBe('ERR-IAM-001');
  });
});

/** Live profiles for one (branch, user), read as the owner rather than via RLS. */
async function rosterCount(branchId: string, userId: string): Promise<number> {
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM tech.technician_profiles
      WHERE tenant_id = $1 AND branch_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
    [TENANT_A, branchId, userId]
  );
  return Number(result.rows[0]?.n ?? '0');
}
