/**
 * P1-32-PRE-OD-ADM2B — what the technician administration screens read, end to
 * end through the route handlers.
 *
 * Two additions, both reads:
 *
 *  1. **`tech.skill-list`**, the skill vocabulary a technician can be given.
 *     `tech.technician-skill-set` takes a skill id and a level id, and nothing
 *     published either until this read. It answers the ACTIVE skills and levels
 *     the caller's tenant may reference — the platform's rows and the tenant's
 *     own — and never another tenant's row or an inactive one, because the set
 *     command refuses both.
 *  2. **A name on the roster** (route checklist prerequisite 13). The list and
 *     the detail read publish `displayName` beside `userId`, resolved through
 *     the iam directory: the person's name for a caller holding
 *     `iam.user.read`, and `null` for a caller who does not. The create response
 *     stays without it. The detail's held skills and certifications carry the
 *     catalogue's names, each certification its calendar issue day and its
 *     version — the `If-Match` `tech.technician-certification-update` needs.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   tech.skill-list: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  SUBJECT_UNPERMITTED,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { authAsSubject, establishP1_19Fixtures } from './p1-19-helpers';
import {
  BR03_LEVEL_ONE_CODE,
  BR03_LEVEL_TWO_CODE,
  BR03_SKILL_CODE,
  BR03_SKILL_INACTIVE_CODE,
  BR03_SKILL_PLATFORM_CODE,
  BR03_SKILL_TENANT_B_CODE,
  BR03_USER_ONE,
  BR03_USER_TWO,
  ROSTER_ADMIN,
  ROSTER_DIRECTORY,
  ROSTER_READER,
  ROSTER_TENANT_B,
  TENANT_A,
  TENANT_B,
  authAs,
  catalogue,
  establishBr03Fixtures,
  resetRoster,
} from './br-03-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { GET as SKILL_LIST } from '@/app/api/v1/technician-skills/route';
import { GET as LIST, POST as CREATE } from '@/app/api/v1/technicians/route';
import { GET as DETAIL } from '@/app/api/v1/technicians/[technicianProfileId]/route';
import { PUT as SET_SKILL } from '@/app/api/v1/technicians/[technicianProfileId]/skills/[skillId]/route';
import { POST as RECORD_CERTIFICATION } from '@/app/api/v1/technicians/[technicianProfileId]/certifications/route';

let admin: Pool;
let runtime: Pool;

/** The display name `establishBr03Fixtures` gives every free roster candidate. */
const CANDIDATE_NAME = 'BR-03 Roster Candidate';

interface CatalogueEntry {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

interface CatalogueBody {
  readonly skills: readonly (CatalogueEntry & { readonly discipline: string | null })[];
  readonly skillLevels: readonly (CatalogueEntry & { readonly rank: number })[];
}

interface RosterEntryBody {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string | null;
  readonly recordVersion: number;
}

interface DetailBody {
  readonly profile: RosterEntryBody;
  readonly skills: readonly {
    readonly skillId: string;
    readonly skillName: string;
    readonly skillLevelId: string;
    readonly skillLevelName: string;
  }[];
  readonly certifications: readonly {
    readonly certificationId: string;
    readonly certificationName: string;
    readonly issuedOnDay: string;
    readonly expiresOn: string | null;
    readonly recordVersion: number;
  }[];
}

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const skillList = () =>
  SKILL_LIST(new Request('http://localhost/api/v1/technician-skills', { method: 'GET' }));

function list(): Promise<Response> {
  const url = new URL('http://localhost/api/v1/technicians');
  url.searchParams.set('companyId', COMPANY_A1);
  url.searchParams.set('branchId', BRANCH_A1);
  url.searchParams.set('limit', '50');
  return LIST(new Request(url));
}

function detail(technicianProfileId: string): Promise<Response> {
  return DETAIL(new Request(`http://localhost/api/v1/technicians/${technicianProfileId}`), {
    params: Promise.resolve({ technicianProfileId }),
  });
}

/** Puts a free account on the A1 roster as `ROSTER_ADMIN`. Fails loudly. */
async function newProfile(userId: string): Promise<RosterEntryBody> {
  authAs(ROSTER_ADMIN);
  const response = await CREATE(
    new Request('http://localhost/api/v1/technicians', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ userId, companyId: COMPANY_A1, branchId: BRANCH_A1 }),
    })
  );
  expect(response.status).toBe(201);
  return bodyOf<RosterEntryBody>(response);
}

/**
 * The codes a tenant may reference, read as the OWNER and never through RLS:
 * platform rows and the tenant's own, a tenant row shadowing the platform row of
 * the same code, and only where the row that wins is active — the rule the set
 * command applies.
 */
async function visibleCodes(table: string, tenantId: string): Promise<readonly string[]> {
  const result = await admin.query<{ code: string }>(
    `SELECT code FROM (
       SELECT DISTINCT ON (code) code, status FROM ${table}
        WHERE (scope = 'platform' OR tenant_id = $1) AND deleted_at IS NULL
        ORDER BY code, (scope = 'tenant') DESC
     ) resolved
     WHERE status = 'active'`,
    [tenantId]
  );
  // Sorted here, by code unit, exactly as the response side is: the database's
  // collation may order `_` differently, and the order is not what is under test.
  return result.rows.map((row) => row.code).sort();
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
}, 180_000);

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

describe('tech.skill-list', () => {
  it("answers the tenant's own and the platform's active skills and levels (success)", async () => {
    authAs(ROSTER_READER);
    const response = await skillList();
    expect(response.status).toBe(200);
    const body = await bodyOf<CatalogueBody>(response);
    const skillCodes = body.skills.map((skill) => skill.code);
    expect(skillCodes).toContain(BR03_SKILL_CODE);
    expect(skillCodes).toContain(BR03_SKILL_PLATFORM_CODE);
    const own = body.skills.find((skill) => skill.code === BR03_SKILL_CODE);
    expect(own).toMatchObject({ id: catalogue.skill, name: 'Engine systems' });
    const levelCodes = body.skillLevels.map((level) => level.code);
    expect(levelCodes).toContain(BR03_LEVEL_ONE_CODE);
    expect(levelCodes).toContain(BR03_LEVEL_TWO_CODE);
    expect(body.skillLevels.find((level) => level.code === BR03_LEVEL_TWO_CODE)).toMatchObject({
      id: catalogue.levelTwo,
      name: 'Level two',
      rank: 20,
    });
  });

  it('never offers an inactive skill, which the set command would refuse', async () => {
    authAs(ROSTER_READER);
    const body = await bodyOf<CatalogueBody>(await skillList());
    expect(body.skills.map((skill) => skill.code)).not.toContain(BR03_SKILL_INACTIVE_CODE);
    expect(body.skills.map((skill) => skill.id)).not.toContain(catalogue.inactiveSkill);
  });

  it("never answers another tenant's skill, in either direction (cross-tenant)", async () => {
    authAs(ROSTER_READER);
    const forA = await bodyOf<CatalogueBody>(await skillList());
    expect(forA.skills.map((skill) => skill.id)).not.toContain(catalogue.tenantBSkill);

    authAs(ROSTER_TENANT_B);
    const response = await skillList();
    expect(response.status).toBe(200);
    const forB = await bodyOf<CatalogueBody>(response);
    const codesForB = forB.skills.map((skill) => skill.code);
    expect(codesForB).toContain(BR03_SKILL_TENANT_B_CODE);
    expect(codesForB).not.toContain(BR03_SKILL_CODE);
    expect(forB.skillLevels.map((level) => level.id)).not.toContain(catalogue.levelOne);
  });

  it('answers exactly the rows its tenant may reference, as the owner reads them (isolation)', async () => {
    authAs(ROSTER_READER);
    const body = await bodyOf<CatalogueBody>(await skillList());
    // Code-level equality against the owner's own reading of "platform or this
    // tenant, active": nothing more, nothing less, and every code once.
    expect([...body.skills.map((skill) => skill.code)].sort()).toEqual(
      await visibleCodes('tech.skills', TENANT_A)
    );
    expect([...body.skillLevels.map((level) => level.code)].sort()).toEqual(
      await visibleCodes('tech.skill_levels', TENANT_A)
    );
    authAs(ROSTER_TENANT_B);
    const forB = await bodyOf<CatalogueBody>(await skillList());
    expect([...forB.skills.map((skill) => skill.code)].sort()).toEqual(
      await visibleCodes('tech.skills', TENANT_B)
    );
  });

  it('refuses a caller without tech.technician.read (denial)', async () => {
    authAsSubject(SUBJECT_UNPERMITTED);
    const response = await skillList();
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe('ERR-IAM-001');
  });
});

describe('tech.technician-list and tech.technician-detail name the person', () => {
  it('publishes the display name to a caller who may read user accounts', async () => {
    const created = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_DIRECTORY);
    const page = await bodyOf<{ items: readonly RosterEntryBody[] }>(await list());
    const row = page.items.find((item) => item.id === created.id);
    expect(row?.userId).toBe(BR03_USER_ONE);
    expect(row?.displayName).toBe(CANDIDATE_NAME);

    const response = await detail(created.id);
    expect(response.status).toBe(200);
    expect((await bodyOf<DetailBody>(response)).profile.displayName).toBe(CANDIDATE_NAME);
  });

  it('publishes null, and the reference alone, to a caller who may not', async () => {
    const created = await newProfile(BR03_USER_TWO);
    authAs(ROSTER_READER);
    const page = await bodyOf<{ items: readonly RosterEntryBody[] }>(await list());
    const row = page.items.find((item) => item.id === created.id);
    expect(row).toBeDefined();
    expect(row?.displayName).toBeNull();
    expect(row?.userId).toBe(BR03_USER_TWO);
    expect((await bodyOf<DetailBody>(await detail(created.id))).profile.displayName).toBeNull();
  });

  it('keeps the create response without a name: it answers the write, not the roster', async () => {
    const created = await newProfile(BR03_USER_ONE);
    expect(Object.keys(created)).not.toContain('displayName');
  });

  it("names each holding and carries each certification's day and version", async () => {
    const created = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const set = await SET_SKILL(
      new Request(`http://localhost/api/v1/technicians/${created.id}/skills/${catalogue.skill}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillLevelId: catalogue.levelTwo }),
      }),
      { params: Promise.resolve({ technicianProfileId: created.id, skillId: catalogue.skill }) }
    );
    expect(set.status).toBe(200);
    const recorded = await RECORD_CERTIFICATION(
      new Request(`http://localhost/api/v1/technicians/${created.id}/certifications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify({
          certificationId: catalogue.certification,
          issuedOn: '2026-05-04',
          expiresOn: '2027-05-04',
        }),
      }),
      { params: Promise.resolve({ technicianProfileId: created.id }) }
    );
    expect(recorded.status).toBe(201);
    const held = await bodyOf<{ recordVersion: number }>(recorded);

    authAs(ROSTER_READER);
    const body = await bodyOf<DetailBody>(await detail(created.id));
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0]).toMatchObject({
      skillId: catalogue.skill,
      skillName: 'Engine systems',
      skillLevelId: catalogue.levelTwo,
      skillLevelName: 'Level two',
    });
    expect(body.certifications).toHaveLength(1);
    expect(body.certifications[0]).toMatchObject({
      certificationId: catalogue.certification,
      certificationName: 'Air conditioning handling',
      issuedOnDay: '2026-05-04',
      expiresOn: '2027-05-04',
      recordVersion: held.recordVersion,
    });
  });
});
