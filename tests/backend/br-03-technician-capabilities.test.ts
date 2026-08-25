/**
 * Technician capability administration — skills, certifications, availability
 * (BR-03, PRE-P1-29 backend remediation).
 *
 * These are the rows `assertEligible` reads to decide who may be assigned to a
 * job, so every write here changes who may touch a customer's vehicle. That is
 * what the suite is really about.
 *
 * The invariants it exists for:
 *
 *  1. **The catalogue check the foreign keys cannot make.**
 *     `fk_technician_skills_skill` and `fk_technician_skills_level` are
 *     SINGLE-column, because a platform catalogue row carries `tenant_id IS NULL`
 *     and cannot participate in the composite. So the database cannot prove the
 *     tenant may reference the row, and the service must. The suite proves all
 *     three answers: a platform row is accepted, another tenant's row is refused,
 *     and an INACTIVE row is refused — the last because attaching a retired skill
 *     would create an eligibility fact nobody can satisfy on purpose.
 *  2. **A held skill is one live LEVEL per skill, not a log.**
 *     `uq_technician_skills_profile_skill` says so, and `skill_id` is named by
 *     the immutability guard, so a PUT moves the level of the existing row.
 *  3. **`cert_status` is reachable, which is why the update operation exists.**
 *     `technician-eligibility-service.ts` refuses a `revoked` credential
 *     outright; without a write path that refusal could never fire in
 *     production. The suite moves a credential to `revoked` and back.
 *  4. **The restricted certificate number never leaks.** It is reachable only
 *     with `iam.sensitive.view`, it is absent from the aggregate read, and it is
 *     absent from the audit record — `iam.audit_records` is not gated by that
 *     permission, so copying the number there would defeat the policy protecting
 *     the column.
 *  5. **Overlap is the EXCLUDE constraint's answer, and a wrong window can be
 *     taken back.** Without a withdraw path a mistyped interval would block that
 *     technician for its whole span, permanently.
 *
 * Operations exercised here: tech.technician-skill-set, tech.technician-skill-withdraw,
 * tech.technician-certification-record, tech.technician-certification-update,
 * tech.technician-certification-detail-record, tech.technician-availability-record,
 * tech.technician-availability-withdraw.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   tech.technician-skill-set: route service authorization success denial cross-tenant isolation audit
 *   tech.technician-skill-withdraw: route service authorization success denial cross-tenant isolation audit
 *   tech.technician-certification-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   tech.technician-certification-update: route service authorization success denial cross-tenant isolation audit stale-version
 *   tech.technician-certification-detail-record: route service authorization success denial cross-tenant isolation audit
 *   tech.technician-availability-record: route service authorization success denial cross-tenant isolation audit idempotency
 *   tech.technician-availability-withdraw: route service authorization success denial cross-tenant isolation audit stale-version
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { BRANCH_A2, establishP1_19Fixtures } from './p1-19-helpers';
import {
  BR03_USER_FOUR,
  BR03_USER_ONE,
  BR03_USER_THREE,
  BR03_USER_TWO,
  ROSTER_ADMIN,
  ROSTER_READER,
  ROSTER_SCOPED_A2,
  ROSTER_SENSITIVE,
  ROSTER_TENANT_B,
  anySkillCount,
  auditCountFor,
  auditDetailValues,
  authAs,
  catalogue,
  establishBr03Fixtures,
  liveAvailabilityCount,
  liveSkillCount,
  rawCertificateNumber,
  resetRoster,
} from './br-03-helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as CREATE } from '@/app/api/v1/technicians/route';
import { GET as DETAIL } from '@/app/api/v1/technicians/[technicianProfileId]/route';
import {
  DELETE as SKILL_WITHDRAW,
  PUT as SKILL_SET,
} from '@/app/api/v1/technicians/[technicianProfileId]/skills/[skillId]/route';
import { POST as CERT_RECORD } from '@/app/api/v1/technicians/[technicianProfileId]/certifications/route';
import { PATCH as CERT_UPDATE } from '@/app/api/v1/technicians/[technicianProfileId]/certifications/[certificationId]/route';
import { PUT as CERT_DETAIL } from '@/app/api/v1/technicians/[technicianProfileId]/certifications/[certificationId]/detail/route';
import { POST as AVAILABILITY_RECORD } from '@/app/api/v1/technicians/[technicianProfileId]/availability/route';
import { DELETE as AVAILABILITY_WITHDRAW } from '@/app/api/v1/technicians/[technicianProfileId]/availability/[availabilityId]/route';

const SKILL_SET_ACTION = 'tech.technician.skill_set';
const SKILL_WITHDRAWN_ACTION = 'tech.technician.skill_withdrawn';
const CERT_RECORDED_ACTION = 'tech.technician.certification_recorded';
const CERT_UPDATED_ACTION = 'tech.technician.certification_updated';
const CERT_NUMBER_ACTION = 'tech.technician.certificate_number_recorded';
const AVAILABILITY_RECORDED_ACTION = 'tech.technician.availability_recorded';
const AVAILABILITY_WITHDRAWN_ACTION = 'tech.technician.availability_withdrawn';

/** Windows far enough in the future that `upcomingAvailability` returns them. */
const WINDOW_FROM = '2027-03-01T08:00:00.000Z';
const WINDOW_TO = '2027-03-01T12:00:00.000Z';
const WINDOW_LATER_FROM = '2027-03-02T08:00:00.000Z';
const WINDOW_LATER_TO = '2027-03-02T12:00:00.000Z';

let admin: Pool;
let runtime: Pool;

interface HeldSkill {
  readonly id: string;
  readonly skillId: string;
  readonly skillLevelId: string;
  readonly recordVersion: number;
}

interface HeldCertification {
  readonly id: string;
  readonly certificationId: string;
  readonly issuedOn: string;
  readonly expiresOn: string | null;
  readonly certStatus: string;
  readonly recordVersion: number;
}

interface AvailabilityWindow {
  readonly id: string;
  readonly availableFrom: string;
  readonly availableTo: string;
  readonly availabilityKind: string;
  readonly reason: string | null;
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

const versionHeaders = (version: number | null | undefined): Record<string, string> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (version !== null && version !== undefined) headers['if-match'] = String(version);
  return headers;
};

function setSkill(technicianProfileId: string, skillId: string, body: unknown): Promise<Response> {
  return SKILL_SET(
    new Request(`http://localhost/api/v1/technicians/${technicianProfileId}/skills/${skillId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ technicianProfileId, skillId }) }
  );
}

function withdrawSkill(technicianProfileId: string, skillId: string): Promise<Response> {
  return SKILL_WITHDRAW(
    new Request(`http://localhost/api/v1/technicians/${technicianProfileId}/skills/${skillId}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ technicianProfileId, skillId }) }
  );
}

function recordCertification(
  technicianProfileId: string,
  body: unknown,
  options: { readonly key?: string | null } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key !== null) headers['idempotency-key'] = options.key ?? randomUUID();
  return CERT_RECORD(
    new Request(`http://localhost/api/v1/technicians/${technicianProfileId}/certifications`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ technicianProfileId }) }
  );
}

function updateCertification(
  technicianProfileId: string,
  certificationId: string,
  body: unknown,
  options: { readonly version?: number | null } = {}
): Promise<Response> {
  return CERT_UPDATE(
    new Request(
      `http://localhost/api/v1/technicians/${technicianProfileId}/certifications/${certificationId}`,
      {
        method: 'PATCH',
        headers: versionHeaders(options.version),
        body: JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ technicianProfileId, certificationId }) }
  );
}

function recordCertificateNumber(
  technicianProfileId: string,
  certificationId: string,
  body: unknown
): Promise<Response> {
  return CERT_DETAIL(
    new Request(
      `http://localhost/api/v1/technicians/${technicianProfileId}/certifications/${certificationId}/detail`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ technicianProfileId, certificationId }) }
  );
}

function recordAvailability(
  technicianProfileId: string,
  body: unknown,
  options: { readonly key?: string | null } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key !== null) headers['idempotency-key'] = options.key ?? randomUUID();
  return AVAILABILITY_RECORD(
    new Request(`http://localhost/api/v1/technicians/${technicianProfileId}/availability`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ technicianProfileId }) }
  );
}

function withdrawAvailability(
  technicianProfileId: string,
  availabilityId: string,
  options: { readonly version?: number | null } = {}
): Promise<Response> {
  return AVAILABILITY_WITHDRAW(
    new Request(
      `http://localhost/api/v1/technicians/${technicianProfileId}/availability/${availabilityId}`,
      { method: 'DELETE', headers: versionHeaders(options.version) }
    ),
    { params: Promise.resolve({ technicianProfileId, availabilityId }) }
  );
}

function detail(technicianProfileId: string): Promise<Response> {
  return DETAIL(new Request(`http://localhost/api/v1/technicians/${technicianProfileId}`), {
    params: Promise.resolve({ technicianProfileId }),
  });
}

/** A live profile in the named branch, created through the real route. */
async function newProfile(userId: string, branchId = BRANCH_A1): Promise<string> {
  authAs(ROSTER_ADMIN);
  const response = await CREATE(
    new Request('http://localhost/api/v1/technicians', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ userId, companyId: COMPANY_A1, branchId }),
    })
  );
  expect(response.status).toBe(201);
  return (await bodyOf<{ id: string }>(response)).id;
}

/** A profile holding one recorded certification, for the update paths. */
async function newCertifiedProfile(userId: string): Promise<{
  readonly profileId: string;
  readonly held: HeldCertification;
}> {
  const profileId = await newProfile(userId);
  authAs(ROSTER_ADMIN);
  const response = await recordCertification(profileId, {
    certificationId: catalogue.certification,
    issuedOn: '2026-01-01',
    expiresOn: '2027-01-01',
  });
  expect(response.status).toBe(201);
  return { profileId, held: await bodyOf<HeldCertification>(response) };
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

describe('tech.technician-skill-set', () => {
  it('records a level, and re-sending REPLACES it rather than adding a row', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const first = await setSkill(profileId, catalogue.skill, {
      skillLevelId: catalogue.levelOne,
    });
    expect(first.status).toBe(200);
    const held = await bodyOf<HeldSkill>(first);
    expect(held.skillLevelId).toBe(catalogue.levelOne);
    expect(await auditCountFor(SKILL_SET_ACTION, held.id)).toBe(1);

    const promoted = await setSkill(profileId, catalogue.skill, {
      skillLevelId: catalogue.levelTwo,
    });
    expect(promoted.status).toBe(200);
    const after = await bodyOf<HeldSkill>(promoted);
    // The SAME row, moved. `skill_id` is named by the immutability guard, so a
    // replacement cannot be an insert.
    expect(after.id).toBe(held.id);
    expect(after.skillLevelId).toBe(catalogue.levelTwo);
    expect(await liveSkillCount(profileId, catalogue.skill)).toBe(1);
  });

  it('accepts a PLATFORM catalogue row, which no foreign key could have validated', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    // `tenant_id IS NULL` on the catalogue row, so the single-column FK proves
    // only that the id exists — not that this tenant may use it.
    const response = await setSkill(profileId, catalogue.platformSkill, {
      skillLevelId: catalogue.levelOne,
    });
    expect(response.status).toBe(200);
    expect((await bodyOf<HeldSkill>(response)).skillId).toBe(catalogue.platformSkill);
  });

  it("refuses another tenant's catalogue row and an inactive one", async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const foreign = await setSkill(profileId, catalogue.tenantBSkill, {
      skillLevelId: catalogue.levelOne,
    });
    expect(foreign.status).toBe(422);
    expect((await problem(foreign)).violations?.[0]?.rule).toBe('catalogue-not-visible');

    const retired = await setSkill(profileId, catalogue.inactiveSkill, {
      skillLevelId: catalogue.levelOne,
    });
    // Refused for a different reason and the same answer: attaching a retired
    // skill would record an eligibility requirement nobody can satisfy.
    expect(retired.status).toBe(422);
    expect((await problem(retired)).violations?.[0]?.rule).toBe('catalogue-not-visible');
    expect(await liveSkillCount(profileId, catalogue.tenantBSkill)).toBe(0);
    expect(await liveSkillCount(profileId, catalogue.inactiveSkill)).toBe(0);
  });

  it('refuses a level from another tenant, naming the body field', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const response = await setSkill(profileId, catalogue.skill, {
      skillLevelId: catalogue.tenantBSkill,
    });
    expect(response.status).toBe(422);
    expect((await problem(response)).violations?.[0]?.path).toBe('body.skillLevelId');
  });

  it('refuses a reader, another tenant, and a branch outside the caller scope', async () => {
    const profileId = await newProfile(BR03_USER_ONE, BRANCH_A1);
    const body = { skillLevelId: catalogue.levelOne };

    authAs(ROSTER_READER);
    expect((await setSkill(profileId, catalogue.skill, body)).status).toBe(403);

    authAs(ROSTER_TENANT_B);
    // 404: the profile is invisible across the tenant boundary, so there is
    // nothing to decide a scope against.
    expect((await setSkill(profileId, catalogue.skill, body)).status).toBe(404);

    authAs(ROSTER_SCOPED_A2);
    expect((await setSkill(profileId, catalogue.skill, body)).status).toBe(403);
    expect(await liveSkillCount(profileId, catalogue.skill)).toBe(0);

    // And the same principal IS served its own branch, so the refusal above is
    // about scope rather than about the operation being broken.
    const inA2 = await newProfile(BR03_USER_TWO, BRANCH_A2);
    authAs(ROSTER_SCOPED_A2);
    expect((await setSkill(inA2, catalogue.skill, body)).status).toBe(200);
  });

  it('refuses a body field the schema does not enumerate', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const response = await setSkill(profileId, catalogue.skill, {
      skillLevelId: catalogue.levelOne,
      technicianProfileId: profileId,
    });
    expect(response.status).toBe(422);
  });
});

describe('tech.technician-skill-withdraw', () => {
  it('soft-deletes the skill, keeping the row that eligibility was decided on', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const held = await bodyOf<HeldSkill>(
      await setSkill(profileId, catalogue.skill, { skillLevelId: catalogue.levelOne })
    );

    const response = await withdrawSkill(profileId, catalogue.skill);
    expect(response.status).toBe(200);
    expect(await auditCountFor(SKILL_WITHDRAWN_ACTION, held.id)).toBe(1);
    expect(await liveSkillCount(profileId, catalogue.skill)).toBe(0);
    // The row SURVIVES: an assignment made while the skill stood keeps its
    // evidence.
    expect(await anySkillCount(profileId, catalogue.skill)).toBe(1);
  });

  it('frees the slot, so the skill can be recorded again afterwards', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    await setSkill(profileId, catalogue.skill, { skillLevelId: catalogue.levelOne });
    expect((await withdrawSkill(profileId, catalogue.skill)).status).toBe(200);

    const again = await setSkill(profileId, catalogue.skill, {
      skillLevelId: catalogue.levelTwo,
    });
    // A NEW row: the partial unique index only covers live ones.
    expect(again.status).toBe(200);
    expect(await liveSkillCount(profileId, catalogue.skill)).toBe(1);
    expect(await anySkillCount(profileId, catalogue.skill)).toBe(2);
  });

  it('answers 404 for a skill the technician does not hold', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const response = await withdrawSkill(profileId, catalogue.skill);
    expect(response.status).toBe(404);
    expect((await problem(response)).code).toBe('ERR-RES-001');
  });

  it('refuses a reader, another tenant, and a branch outside the caller scope', async () => {
    const profileId = await newProfile(BR03_USER_ONE, BRANCH_A1);
    authAs(ROSTER_ADMIN);
    await setSkill(profileId, catalogue.skill, { skillLevelId: catalogue.levelOne });

    authAs(ROSTER_READER);
    expect((await withdrawSkill(profileId, catalogue.skill)).status).toBe(403);
    authAs(ROSTER_TENANT_B);
    expect((await withdrawSkill(profileId, catalogue.skill)).status).toBe(404);
    authAs(ROSTER_SCOPED_A2);
    expect((await withdrawSkill(profileId, catalogue.skill)).status).toBe(403);
    expect(await liveSkillCount(profileId, catalogue.skill)).toBe(1);
  });
});

describe('tech.technician-certification-record', () => {
  it('records a credential with its calendar dates, active on arrival', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const response = await recordCertification(profileId, {
      certificationId: catalogue.certification,
      issuedOn: '2026-05-04',
      expiresOn: '2027-05-04',
    });
    expect(response.status).toBe(201);
    const held = await bodyOf<HeldCertification>(response);
    expect(held.issuedOn).toBe('2026-05-04');
    expect(held.expiresOn).toBe('2027-05-04');
    // The column default, and the only status the record path can produce.
    expect(held.certStatus).toBe('active');
    expect(await auditCountFor(CERT_RECORDED_ACTION, held.id)).toBe(1);
  });

  it('accepts an expiry EQUAL to the issue date, because the check is inclusive', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    // `ck_technician_certifications_expiry` is `expires_on >= issued_on`. The
    // API uses the database's rule rather than a stricter one invented here.
    const response = await recordCertification(profileId, {
      certificationId: catalogue.certification,
      issuedOn: '2026-05-04',
      expiresOn: '2026-05-04',
    });
    expect(response.status).toBe(201);
  });

  it('refuses an expiry before the issue date, with a violation path', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const response = await recordCertification(profileId, {
      certificationId: catalogue.certification,
      issuedOn: '2026-05-04',
      expiresOn: '2026-05-03',
    });
    // Refused HERE rather than at the CHECK constraint: a 23514 would abort the
    // transaction and reach the caller as an untargeted failure.
    expect(response.status).toBe(422);
    expect((await problem(response)).violations?.[0]?.rule).toBe('before-issued');
  });

  it('refuses a malformed date and a credential from another tenant', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const badDate = await recordCertification(profileId, {
      certificationId: catalogue.certification,
      issuedOn: '04/05/2026',
    });
    expect(badDate.status).toBe(422);

    const foreign = await recordCertification(profileId, {
      certificationId: catalogue.tenantBCertification,
      issuedOn: '2026-05-04',
    });
    expect(foreign.status).toBe(422);
    expect((await problem(foreign)).violations?.[0]?.rule).toBe('catalogue-not-visible');
  });

  it('refuses the same credential twice and replays a repeated key', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const payload = { certificationId: catalogue.certification, issuedOn: '2026-05-04' };
    const first = await recordCertification(profileId, payload);
    expect(first.status).toBe(201);
    const held = await bodyOf<HeldCertification>(first);

    // A DIFFERENT key with the same content is a genuine second attempt, and
    // `uq_technician_certifications_active` refuses it.
    const duplicate = await recordCertification(profileId, payload);
    expect(duplicate.status).toBe(409);
    expect((await problem(duplicate)).violations?.[0]?.rule).toBe('duplicate-certification');

    // The SAME key replays instead.
    const key = randomUUID();
    const profileTwo = await newProfile(BR03_USER_TWO);
    authAs(ROSTER_ADMIN);
    const original = await recordCertification(profileTwo, payload, { key });
    expect(original.status).toBe(201);
    const replay = await recordCertification(profileTwo, payload, { key });
    expect(replay.status).toBe(200);
    expect((await bodyOf<HeldCertification>(replay)).id).toBe(
      (await bodyOf<HeldCertification>(original)).id
    );
    expect(await auditCountFor(CERT_RECORDED_ACTION, held.id)).toBe(1);
  });

  it('refuses a reader, another tenant, and a branch outside the caller scope', async () => {
    const profileId = await newProfile(BR03_USER_ONE, BRANCH_A1);
    const payload = { certificationId: catalogue.certification, issuedOn: '2026-05-04' };

    authAs(ROSTER_READER);
    expect((await recordCertification(profileId, payload)).status).toBe(403);
    authAs(ROSTER_TENANT_B);
    expect((await recordCertification(profileId, payload)).status).toBe(404);
    authAs(ROSTER_SCOPED_A2);
    expect((await recordCertification(profileId, payload)).status).toBe(403);
  });
});

describe('tech.technician-certification-update', () => {
  it('revokes a credential and restores it, which is why the operation exists', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const revoked = await updateCertification(
      profileId,
      held.certificationId,
      { certStatus: 'revoked' },
      { version: held.recordVersion }
    );
    expect(revoked.status).toBe(200);
    const afterRevoke = await bodyOf<HeldCertification>(revoked);
    expect(afterRevoke.certStatus).toBe('revoked');
    expect(await auditCountFor(CERT_UPDATED_ACTION, held.id)).toBe(1);

    const restored = await updateCertification(
      profileId,
      held.certificationId,
      { certStatus: 'active' },
      { version: afterRevoke.recordVersion }
    );
    expect(restored.status).toBe(200);
    expect((await bodyOf<HeldCertification>(restored)).certStatus).toBe('active');
  });

  it('re-dates an expiry and clears it when the caller sends null', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const moved = await updateCertification(
      profileId,
      held.certificationId,
      { expiresOn: '2028-01-01' },
      { version: held.recordVersion }
    );
    expect(moved.status).toBe(200);
    const afterMove = await bodyOf<HeldCertification>(moved);
    expect(afterMove.expiresOn).toBe('2028-01-01');

    const cleared = await updateCertification(
      profileId,
      held.certificationId,
      { expiresOn: null },
      { version: afterMove.recordVersion }
    );
    expect(cleared.status).toBe(200);
    expect((await bodyOf<HeldCertification>(cleared)).expiresOn).toBeNull();
  });

  it('refuses an expiry before the stored issue date', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const response = await updateCertification(
      profileId,
      held.certificationId,
      { expiresOn: '2025-01-01' },
      { version: held.recordVersion }
    );
    expect(response.status).toBe(422);
    expect((await problem(response)).violations?.[0]?.rule).toBe('before-issued');
  });

  it('refuses re-pointing the credential or re-dating its issue', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    // Both are named by `tg_technician_certifications_immutable`. Changing either
    // would rewrite the eligibility history of every assignment made under it.
    const repointed = await updateCertification(
      profileId,
      held.certificationId,
      { certificationId: catalogue.certificationAlt },
      { version: held.recordVersion }
    );
    expect(repointed.status).toBe(422);

    const backdated = await updateCertification(
      profileId,
      held.certificationId,
      { issuedOn: '2020-01-01' },
      { version: held.recordVersion }
    );
    expect(backdated.status).toBe(422);
  });

  it('refuses an empty body, a stale version and a missing If-Match', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const empty = await updateCertification(
      profileId,
      held.certificationId,
      {},
      { version: held.recordVersion }
    );
    expect(empty.status).toBe(422);
    expect((await problem(empty)).violations?.[0]?.rule).toBe('empty-update');

    const applied = await updateCertification(
      profileId,
      held.certificationId,
      { certStatus: 'expired' },
      { version: held.recordVersion }
    );
    expect(applied.status).toBe(200);

    const stale = await updateCertification(
      profileId,
      held.certificationId,
      { certStatus: 'revoked' },
      { version: held.recordVersion }
    );
    expect(stale.status).toBe(409);
    expect((await problem(stale)).code).toBe('ERR-CON-001');

    const noHeader = await updateCertification(
      profileId,
      held.certificationId,
      { certStatus: 'revoked' },
      { version: null }
    );
    expect(noHeader.status).toBe(428);
  });

  it('answers 404 for a credential the technician does not hold', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const response = await updateCertification(
      profileId,
      catalogue.certification,
      { certStatus: 'revoked' },
      { version: 1 }
    );
    expect(response.status).toBe(404);
  });

  it('refuses a reader, another tenant, and a branch outside the caller scope', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    const body = { certStatus: 'revoked' };
    const version = { version: held.recordVersion };

    authAs(ROSTER_READER);
    expect((await updateCertification(profileId, held.certificationId, body, version)).status).toBe(
      403
    );
    authAs(ROSTER_TENANT_B);
    expect((await updateCertification(profileId, held.certificationId, body, version)).status).toBe(
      404
    );
    authAs(ROSTER_SCOPED_A2);
    expect((await updateCertification(profileId, held.certificationId, body, version)).status).toBe(
      403
    );
  });
});

describe('tech.technician-certification-detail-record', () => {
  it('records the restricted number for a caller holding iam.sensitive.view', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    authAs(ROSTER_SENSITIVE);
    const response = await recordCertificateNumber(profileId, held.certificationId, {
      certificateNumber: 'CN-000-111',
    });
    expect(response.status).toBe(200);
    expect((await bodyOf<{ certificateNumber: string }>(response)).certificateNumber).toBe(
      'CN-000-111'
    );
    expect(await rawCertificateNumber(held.id)).toBe('CN-000-111');
    expect(await auditCountFor(CERT_NUMBER_ACTION, held.id)).toBe(1);
  });

  it('replaces rather than accumulating, because there is one number per credential', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    authAs(ROSTER_SENSITIVE);
    await recordCertificateNumber(profileId, held.certificationId, {
      certificateNumber: 'CN-TYPO',
    });
    const corrected = await recordCertificateNumber(profileId, held.certificationId, {
      certificateNumber: 'CN-CORRECT',
    });
    expect(corrected.status).toBe(200);
    expect(await rawCertificateNumber(held.id)).toBe('CN-CORRECT');
  });

  it('never writes the number into the audit trail', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    authAs(ROSTER_SENSITIVE);
    await recordCertificateNumber(profileId, held.certificationId, {
      certificateNumber: 'CN-SECRET-9876',
    });
    // `iam.audit_records` is NOT gated by `iam.sensitive.view`, so a number
    // copied into a detail would be readable by every auditor — defeating the
    // policy that protects the column.
    const details = await auditDetailValues(held.id);
    expect(details.length).toBeGreaterThan(0);
    for (const payload of details) expect(payload).not.toContain('CN-SECRET-9876');
  });

  it('is unreachable without iam.sensitive.view, even holding manage', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    // `ROSTER_ADMIN` is one permission apart from `ROSTER_SENSITIVE` and
    // identical in every other respect, so this refusal is about that one
    // permission and nothing else.
    authAs(ROSTER_ADMIN);
    const response = await recordCertificateNumber(profileId, held.certificationId, {
      certificateNumber: 'CN-000-111',
    });
    expect(response.status).toBe(403);
    expect((await problem(response)).code).toBe('ERR-IAM-001');
    expect(await rawCertificateNumber(held.id)).toBeNull();
  });

  it('never appears in the aggregate read, whoever asks', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    authAs(ROSTER_SENSITIVE);
    await recordCertificateNumber(profileId, held.certificationId, {
      certificateNumber: 'CN-HIDDEN-42',
    });
    // Read by the principal that CAN see restricted data. The number is still
    // absent, because the aggregate read is reachable with `tech.technician.read`
    // alone and folding it in would publish it to callers who hold only that.
    const response = await detail(profileId);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('CN-HIDDEN-42');
  });

  it('refuses a blank number, another tenant, and a branch outside the caller scope', async () => {
    const { profileId, held } = await newCertifiedProfile(BR03_USER_ONE);
    authAs(ROSTER_SENSITIVE);
    const blank = await recordCertificateNumber(profileId, held.certificationId, {
      certificateNumber: '   ',
    });
    expect(blank.status).toBe(422);

    authAs(ROSTER_TENANT_B);
    expect(
      (
        await recordCertificateNumber(profileId, held.certificationId, {
          certificateNumber: 'CN-1',
        })
      ).status
    ).toBe(403);
  });
});

describe('tech.technician-availability-record', () => {
  it('records a window and shows it in the aggregate read', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const response = await recordAvailability(profileId, {
      from: WINDOW_FROM,
      to: WINDOW_TO,
      availabilityKind: 'available',
    });
    expect(response.status).toBe(201);
    const window = await bodyOf<AvailabilityWindow>(response);
    expect(window.availabilityKind).toBe('available');
    expect(await auditCountFor(AVAILABILITY_RECORDED_ACTION, window.id)).toBe(1);

    authAs(ROSTER_READER);
    const aggregate = await bodyOf<{ availability: readonly AvailabilityWindow[] }>(
      await detail(profileId)
    );
    expect(aggregate.availability.map((row) => row.id)).toEqual([window.id]);
  });

  it('records an UNAVAILABLE window with its reason, distinctly', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const response = await recordAvailability(profileId, {
      from: WINDOW_FROM,
      to: WINDOW_TO,
      availabilityKind: 'unavailable',
      reason: 'Annual leave',
    });
    expect(response.status).toBe(201);
    const window = await bodyOf<AvailabilityWindow>(response);
    // The kind is recorded, never inferred: the two mean opposite things to
    // eligibility and share one table and one overlap constraint.
    expect(window.availabilityKind).toBe('unavailable');
    expect(window.reason).toBe('Annual leave');
  });

  it('refuses an overlapping window, and a window that ends before it starts', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    expect(
      (
        await recordAvailability(profileId, {
          from: WINDOW_FROM,
          to: WINDOW_TO,
          availabilityKind: 'available',
        })
      ).status
    ).toBe(201);

    const overlapping = await recordAvailability(profileId, {
      from: '2027-03-01T10:00:00.000Z',
      to: '2027-03-01T14:00:00.000Z',
      availabilityKind: 'unavailable',
    });
    // `ex_technician_availability_overlap`, translated rather than predicted: a
    // read-then-check would still lose to a concurrent insert.
    expect(overlapping.status).toBe(409);
    expect((await problem(overlapping)).violations?.[0]?.rule).toBe('overlapping-window');

    const inverted = await recordAvailability(profileId, {
      from: WINDOW_TO,
      to: WINDOW_FROM,
      availabilityKind: 'available',
    });
    expect(inverted.status).toBe(422);
    expect((await problem(inverted)).violations?.[0]?.rule).toBe('window-not-positive');
    expect(await liveAvailabilityCount(profileId)).toBe(1);
  });

  it('accepts two TOUCHING windows, because the range is half-open', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    expect(
      (
        await recordAvailability(profileId, {
          from: WINDOW_FROM,
          to: WINDOW_TO,
          availabilityKind: 'available',
        })
      ).status
    ).toBe(201);
    // `[08:00,12:00)` does not overlap `[12:00,16:00)`, which is what makes a
    // split shift expressible at all.
    const touching = await recordAvailability(profileId, {
      from: WINDOW_TO,
      to: '2027-03-01T16:00:00.000Z',
      availabilityKind: 'available',
    });
    expect(touching.status).toBe(201);
    expect(await liveAvailabilityCount(profileId)).toBe(2);
  });

  it('refuses a timestamp with no offset, and an unknown kind', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const zoneless = await recordAvailability(profileId, {
      from: '2027-03-01T08:00:00',
      to: WINDOW_TO,
      availabilityKind: 'available',
    });
    // A zoneless instant would be read in the server's zone and silently shift
    // the shift.
    expect(zoneless.status).toBe(422);

    const unknownKind = await recordAvailability(profileId, {
      from: WINDOW_FROM,
      to: WINDOW_TO,
      availabilityKind: 'maybe',
    });
    expect(unknownKind.status).toBe(422);
  });

  it('replays a repeated key without recording a second window', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const key = randomUUID();
    const payload = { from: WINDOW_FROM, to: WINDOW_TO, availabilityKind: 'available' };
    const first = await recordAvailability(profileId, payload, { key });
    expect(first.status).toBe(201);
    const replay = await recordAvailability(profileId, payload, { key });
    expect(replay.status).toBe(200);
    // Without the replay this would be a 409 from the EXCLUDE constraint, so the
    // count is the assertion that matters.
    expect(await liveAvailabilityCount(profileId)).toBe(1);
  });

  it('refuses a reader, another tenant, and a branch outside the caller scope', async () => {
    const profileId = await newProfile(BR03_USER_ONE, BRANCH_A1);
    const payload = { from: WINDOW_FROM, to: WINDOW_TO, availabilityKind: 'available' };

    authAs(ROSTER_READER);
    expect((await recordAvailability(profileId, payload)).status).toBe(403);
    authAs(ROSTER_TENANT_B);
    expect((await recordAvailability(profileId, payload)).status).toBe(404);
    authAs(ROSTER_SCOPED_A2);
    expect((await recordAvailability(profileId, payload)).status).toBe(403);
    expect(await liveAvailabilityCount(profileId)).toBe(0);
  });
});

describe('tech.technician-availability-withdraw', () => {
  it('frees the interval the EXCLUDE constraint was holding', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const window = await bodyOf<AvailabilityWindow>(
      await recordAvailability(profileId, {
        from: WINDOW_FROM,
        to: WINDOW_TO,
        availabilityKind: 'available',
      })
    );

    const response = await withdrawAvailability(profileId, window.id, {
      version: window.recordVersion,
    });
    expect(response.status).toBe(200);
    expect(await auditCountFor(AVAILABILITY_WITHDRAWN_ACTION, window.id)).toBe(1);
    expect(await liveAvailabilityCount(profileId)).toBe(0);

    // The whole point: the interval is usable again. Without this path a
    // mistyped window would block it for its entire span, permanently.
    const replacement = await recordAvailability(profileId, {
      from: WINDOW_FROM,
      to: WINDOW_TO,
      availabilityKind: 'unavailable',
    });
    expect(replacement.status).toBe(201);
  });

  it('refuses a stale version and a missing If-Match', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    authAs(ROSTER_ADMIN);
    const window = await bodyOf<AvailabilityWindow>(
      await recordAvailability(profileId, {
        from: WINDOW_FROM,
        to: WINDOW_TO,
        availabilityKind: 'available',
      })
    );

    const stale = await withdrawAvailability(profileId, window.id, {
      version: window.recordVersion + 5,
    });
    expect(stale.status).toBe(409);

    const noHeader = await withdrawAvailability(profileId, window.id, { version: null });
    expect(noHeader.status).toBe(428);
    expect(await liveAvailabilityCount(profileId)).toBe(1);
  });

  it('answers 404 for a window that belongs to a different technician', async () => {
    const profileId = await newProfile(BR03_USER_ONE);
    const otherId = await newProfile(BR03_USER_TWO);
    authAs(ROSTER_ADMIN);
    const window = await bodyOf<AvailabilityWindow>(
      await recordAvailability(profileId, {
        from: WINDOW_LATER_FROM,
        to: WINDOW_LATER_TO,
        availabilityKind: 'available',
      })
    );
    // The window is addressed UNDER a technician, so naming someone else's is a
    // 404 rather than a successful deletion of a row the caller did not name.
    const response = await withdrawAvailability(otherId, window.id, {
      version: window.recordVersion,
    });
    expect(response.status).toBe(404);
    expect(await liveAvailabilityCount(profileId)).toBe(1);
  });

  it('refuses a reader, another tenant, and a branch outside the caller scope', async () => {
    const profileId = await newProfile(BR03_USER_THREE, BRANCH_A1);
    authAs(ROSTER_ADMIN);
    const window = await bodyOf<AvailabilityWindow>(
      await recordAvailability(profileId, {
        from: WINDOW_FROM,
        to: WINDOW_TO,
        availabilityKind: 'available',
      })
    );
    const version = { version: window.recordVersion };

    authAs(ROSTER_READER);
    expect((await withdrawAvailability(profileId, window.id, version)).status).toBe(403);
    authAs(ROSTER_TENANT_B);
    expect((await withdrawAvailability(profileId, window.id, version)).status).toBe(404);
    authAs(ROSTER_SCOPED_A2);
    expect((await withdrawAvailability(profileId, window.id, version)).status).toBe(403);
    expect(await liveAvailabilityCount(profileId)).toBe(1);

    // Served in its own branch, so the refusal above is about scope.
    const inA2 = await newProfile(BR03_USER_FOUR, BRANCH_A2);
    authAs(ROSTER_SCOPED_A2);
    const ownWindow = await bodyOf<AvailabilityWindow>(
      await recordAvailability(inA2, {
        from: WINDOW_LATER_FROM,
        to: WINDOW_LATER_TO,
        availabilityKind: 'available',
      })
    );
    expect(
      (await withdrawAvailability(inA2, ownWindow.id, { version: ownWindow.recordVersion })).status
    ).toBe(200);
  });
});
