/**
 * BR-03 backend fixtures — technician roster and capability administration.
 *
 * ## Why a fifth helpers file rather than widening `p1-19-helpers`
 *
 * Not one principal in `p1-19-helpers` holds `tech.technician.manage`, because
 * the permission did not exist until this slice. Adding it to `FULL` would
 * silently change what fourteen existing suites prove: every P1-19 test that
 * asserts a refusal would start asserting it against a principal with more
 * authority than the phase shipped. The precedent is `p1-21-helpers`, which
 * exists for exactly this reason and says so in its own header.
 *
 * ## The principals, and what each one is FOR
 *
 * Every one of them exists to make a specific claim falsifiable:
 *
 *  - `ROSTER_ADMIN` — read + manage, unrestricted. The positive path.
 *  - `ROSTER_READER` — read ONLY. Its refusals prove a 403 is about the missing
 *    `manage` authority and not about tenancy, scope or a malformed request,
 *    because it is identical to `ROSTER_ADMIN` in every other respect.
 *  - `ROSTER_SENSITIVE` — read + manage + `iam.sensitive.view`. One permission
 *    apart from `ROSTER_ADMIN`, which is what makes the restricted certificate
 *    number testable in BOTH directions: reachable for one, refused for the
 *    other, with nothing else varying.
 *  - `ROSTER_SCOPED_A2` — read + manage scoped to branch A2, *plus a widening
 *    grant of an unrelated permission scoped to A1*. The widening grant is the
 *    whole point and the file would be misleading without it: it puts A1 into
 *    `iam.allowed_branch_ids()` WITHOUT giving this principal any technician
 *    authority there. `app.branch_ids` is the permission-blind union of every
 *    active grant (P1-18-A-01), so without the widening grant an A1 row is
 *    invisible to RLS anyway and an isolation test would pass against a
 *    completely scope-blind implementation. With it, the only thing that can
 *    refuse the A1 request is the scoped permission check itself.
 *  - `ROSTER_TENANT_B` — read + manage, unrestricted, in tenant B. A refusal
 *    from it is the tenant boundary rather than authority.
 *
 * ## The free user accounts
 *
 * `uq_technician_profiles_active_user` permits one live profile per user per
 * tenant, so a create test needs a user who has none. These accounts exist for
 * that and hold no grants: a technician is not required to be able to sign in,
 * and giving them roles would confuse "is on the roster" with "may use the
 * system", which are separate facts this platform deliberately keeps apart.
 *
 * `BR03_USER_TENANT_B` is seeded so a tenant-A create can NAME a real user id
 * that belongs to another tenant. Naming a random uuid would prove only that
 * unknown ids are refused; naming a real foreign one proves the check is
 * tenant-scoped rather than existence-scoped.
 */
import type { Pool } from 'pg';
import { BRANCH_A1, COMPANY_A1, IDENTITY_PROVIDER, TENANT_A, TENANT_B, USER_A } from './helpers';
import { BRANCH_A2, BRANCH_B1, COMPANY_B1, type Principal } from './p1-19-helpers';
import { StaticClaimsAuthenticator, setSessionAuthenticator } from '@/server/context/principal';

export const TECHNICIAN_READ = 'tech.technician.read';
export const TECHNICIAN_MANAGE = 'tech.technician.manage';
export const SENSITIVE_VIEW = 'iam.sensitive.view';

/**
 * An unrelated permission used only to widen a grant union.
 *
 * `org.tenant.read` is chosen because it grants nothing in the `tech` schema,
 * so it cannot accidentally satisfy the check under test.
 */
const WIDENING_PERMISSION = 'org.tenant.read';
const WIDENING_ROLE = 'f3000000-0000-4000-8000-0000000000e1';
const WIDENING_GRANT = 'f3000000-0000-4000-8000-0000000000e2';

const ROSTER_PERMISSIONS = [TECHNICIAN_READ, TECHNICIAN_MANAGE];

export const ROSTER_ADMIN: Principal = {
  roleId: 'f3000000-0000-4000-8000-000000000101',
  userId: 'f3000000-0000-4000-8000-000000000102',
  subject: 'fx_br_03_admin',
  tenantId: TENANT_A,
  permissions: ROSTER_PERMISSIONS,
};

export const ROSTER_READER: Principal = {
  roleId: 'f3000000-0000-4000-8000-000000000111',
  userId: 'f3000000-0000-4000-8000-000000000112',
  subject: 'fx_br_03_reader',
  tenantId: TENANT_A,
  permissions: [TECHNICIAN_READ],
};

export const ROSTER_SENSITIVE: Principal = {
  roleId: 'f3000000-0000-4000-8000-000000000121',
  userId: 'f3000000-0000-4000-8000-000000000122',
  subject: 'fx_br_03_sensitive',
  tenantId: TENANT_A,
  permissions: [...ROSTER_PERMISSIONS, SENSITIVE_VIEW],
};

export const ROSTER_SCOPED_A2: Principal = {
  roleId: 'f3000000-0000-4000-8000-000000000131',
  userId: 'f3000000-0000-4000-8000-000000000132',
  subject: 'fx_br_03_scoped_a2',
  tenantId: TENANT_A,
  permissions: ROSTER_PERMISSIONS,
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: 'f3000000-0000-4000-8000-000000000133',
};

export const ROSTER_TENANT_B: Principal = {
  roleId: 'f3000000-0000-4000-8000-000000000141',
  userId: 'f3000000-0000-4000-8000-000000000142',
  subject: 'fx_br_03_tenant_b',
  tenantId: TENANT_B,
  permissions: ROSTER_PERMISSIONS,
};

export const BR03_PRINCIPALS: readonly Principal[] = [
  ROSTER_ADMIN,
  ROSTER_READER,
  ROSTER_SENSITIVE,
  ROSTER_SCOPED_A2,
  ROSTER_TENANT_B,
];

// ---- Free user accounts, holding no live technician profile ----------------

export const BR03_USER_ONE = 'f3000000-0000-4000-8000-000000000201';
export const BR03_USER_TWO = 'f3000000-0000-4000-8000-000000000202';
export const BR03_USER_THREE = 'f3000000-0000-4000-8000-000000000203';
export const BR03_USER_FOUR = 'f3000000-0000-4000-8000-000000000204';
export const BR03_USER_FIVE = 'f3000000-0000-4000-8000-000000000205';
export const BR03_USER_SIX = 'f3000000-0000-4000-8000-000000000206';
export const BR03_USER_SEVEN = 'f3000000-0000-4000-8000-000000000207';
export const BR03_USER_EIGHT = 'f3000000-0000-4000-8000-000000000208';
/** A REAL account in tenant B, named by a tenant-A create to prove the check. */
export const BR03_USER_TENANT_B = 'f3000000-0000-4000-8000-0000000002b1';

const FREE_USERS_A: readonly string[] = [
  BR03_USER_ONE,
  BR03_USER_TWO,
  BR03_USER_THREE,
  BR03_USER_FOUR,
  BR03_USER_FIVE,
  BR03_USER_SIX,
  BR03_USER_SEVEN,
  BR03_USER_EIGHT,
];

// ---- Catalogue fixtures ----------------------------------------------------

/** Tenant-scope skill in tenant A. */
export const BR03_SKILL_CODE = 'fx_br_03_engine';
/**
 * A PLATFORM-scope skill (`tenant_id IS NULL`).
 *
 * It is the reason `catalogueVisible` cannot be replaced by a composite foreign
 * key: `fk_technician_skills_skill` is single-column precisely because a
 * platform row has no tenant to compose with, so the database cannot decide
 * whether this tenant may reference it and the service must.
 */
export const BR03_SKILL_PLATFORM_CODE = 'fx_br_03_platform_skill';
/** Tenant-scope, but INACTIVE. Attaching it would create an unsatisfiable fact. */
export const BR03_SKILL_INACTIVE_CODE = 'fx_br_03_retired_skill';
/** Tenant-scope in tenant B, so a tenant-A caller naming it is a real crossing. */
export const BR03_SKILL_TENANT_B_CODE = 'fx_br_03_foreign_skill';

export const BR03_LEVEL_ONE_CODE = 'fx_br_03_level_one';
export const BR03_LEVEL_TWO_CODE = 'fx_br_03_level_two';

export const BR03_CERT_CODE = 'fx_br_03_cert';
export const BR03_CERT_ALT_CODE = 'fx_br_03_cert_alt';
export const BR03_CERT_TENANT_B_CODE = 'fx_br_03_foreign_cert';

/** Resolved catalogue ids, filled by `establishBr03Fixtures`. */
export const catalogue = {
  skill: '',
  platformSkill: '',
  inactiveSkill: '',
  tenantBSkill: '',
  levelOne: '',
  levelTwo: '',
  certification: '',
  certificationAlt: '',
  tenantBCertification: '',
};

let admin: Pool;

export function authAs(principal: Principal): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: principal.subject,
      tenantId: principal.tenantId,
    })
  );
}

export async function countRowsOf(sql: string, values: readonly unknown[] = []): Promise<number> {
  const result = await admin.query<{ n: string }>(sql, [...values]);
  return Number(result.rows[0]?.n ?? '0');
}

/** Audit records for ONE action against ONE entity. Never a tenant-wide total. */
export function auditCountFor(action: string, entityId: string): Promise<number> {
  return countRowsOf(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );
}

/**
 * Every audit DETAIL row recorded against one entity, flattened for a leak
 * assertion.
 *
 * Details live in `iam.audit_record_details`, not in a column of
 * `iam.audit_records` — the record carries the fact and the details carry the
 * field-level before/after, each with its own `value_classification`. The whole
 * row is concatenated rather than one column read, so a value that leaked into
 * `field_name` instead of `new_value_masked` would still be caught.
 */
export async function auditDetailValues(entityId: string): Promise<readonly string[]> {
  const result = await admin.query<{ payload: string }>(
    `SELECT concat_ws('|', d.field_name, d.value_classification,
                      coalesce(d.old_value_masked, ''), coalesce(d.new_value_masked, '')) AS payload
       FROM iam.audit_record_details d
       JOIN iam.audit_records r ON r.tenant_id = d.tenant_id AND r.id = d.audit_record_id
      WHERE r.entity_id = $1`,
    [entityId]
  );
  return result.rows.map((row) => row.payload);
}

/** Reads a profile as the OWNER, so an assertion never rests on RLS visibility. */
export async function rawProfile(id: string): Promise<{
  readonly branchId: string;
  readonly userId: string;
  readonly isActive: boolean;
  readonly deletedAt: string | null;
  readonly recordVersion: number;
} | null> {
  const result = await admin.query<{
    branch_id: string;
    user_id: string;
    is_active: boolean;
    deleted_at: string | null;
    record_version: number;
  }>(
    `SELECT branch_id, user_id, is_active, deleted_at, record_version
       FROM tech.technician_profiles WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  return row
    ? {
        branchId: row.branch_id,
        userId: row.user_id,
        isActive: row.is_active,
        deletedAt: row.deleted_at,
        recordVersion: row.record_version,
      }
    : null;
}

/** The soft-delete marker for one held skill, read as the owner. */
export function liveSkillCount(profileId: string, skillId: string): Promise<number> {
  return countRowsOf(
    `SELECT count(*)::text AS n FROM tech.technician_skills
      WHERE technician_profile_id = $1 AND skill_id = $2 AND deleted_at IS NULL`,
    [profileId, skillId]
  );
}

/** Rows INCLUDING soft-deleted ones — the assertion that history survived. */
export function anySkillCount(profileId: string, skillId: string): Promise<number> {
  return countRowsOf(
    `SELECT count(*)::text AS n FROM tech.technician_skills
      WHERE technician_profile_id = $1 AND skill_id = $2`,
    [profileId, skillId]
  );
}

export function liveAvailabilityCount(profileId: string): Promise<number> {
  return countRowsOf(
    `SELECT count(*)::text AS n FROM tech.technician_availability
      WHERE technician_profile_id = $1 AND deleted_at IS NULL`,
    [profileId]
  );
}

/**
 * Empties the roster between tests, leaving the catalogue and the accounts.
 *
 * `uq_technician_profiles_active_user` permits ONE live profile per user per
 * tenant, so without this every test after the first would collide on the fixed
 * fixture accounts — and a suite that worked around it by minting a new account
 * per assertion would make row counts depend on execution order. Children first:
 * skills, certifications and availability all reference the profile.
 *
 * Deletes rather than soft-deletes on purpose. A soft delete is the PRODUCT
 * behaviour under test; a fixture reset that used it would leave rows the next
 * test's counts would have to know about.
 */
export async function resetRoster(): Promise<void> {
  await admin.query('DELETE FROM tech.technician_certification_details');
  await admin.query('DELETE FROM tech.technician_certifications');
  await admin.query('DELETE FROM tech.technician_skills');
  await admin.query('DELETE FROM tech.technician_availability');
  await admin.query('DELETE FROM tech.technician_profiles');
}

/** The restricted certificate number, read as the owner and never through RLS. */
export async function rawCertificateNumber(
  technicianCertificationId: string
): Promise<string | null> {
  const result = await admin.query<{ certificate_number: string }>(
    `SELECT certificate_number FROM tech.technician_certification_details
      WHERE technician_certification_id = $1 AND deleted_at IS NULL`,
    [technicianCertificationId]
  );
  return result.rows[0]?.certificate_number ?? null;
}

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','BR-03 Principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'BR-03 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  for (const code of principal.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, USER_A, code]
    );
  }

  if (principal.scope === undefined) {
    const existing = await admin.query(
      `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
      [principal.tenantId, principal.userId, principal.roleId]
    );
    if (existing.rowCount === 0) {
      await admin.query(
        `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
        [principal.tenantId, principal.userId, principal.roleId, USER_A]
      );
    }
    return;
  }
  // A scoped ACTIVE grant must carry at least one scope, enforced by a DEFERRABLE
  // constraint trigger — so the grant and its scope land in one transaction.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
      principal.grantId,
    ]);
    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [principal.grantId, principal.tenantId, principal.userId, principal.roleId, USER_A]
      );
      await client.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,'branch',$3,$4,$5)`,
        [
          principal.tenantId,
          principal.grantId,
          principal.scope.companyId,
          principal.scope.branchId,
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

/**
 * The widening grant described in the file header.
 *
 * Without it `ROSTER_SCOPED_A2` has branch A1 outside its allowed-branch union,
 * RLS hides every A1 row, and an isolation assertion would pass against an
 * implementation that never consulted scope at all.
 */
async function seedWideningGrant(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_br_03_widening','BR-03 widening',$3) ON CONFLICT (id) DO NOTHING`,
    [WIDENING_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, WIDENING_ROLE, USER_A, WIDENING_PERMISSION]
  );
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
      WIDENING_GRANT,
    ]);
    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [WIDENING_GRANT, TENANT_A, ROSTER_SCOPED_A2.userId, WIDENING_ROLE, USER_A]
      );
      await client.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1,$2,'branch',$3,$4,$5)`,
        [TENANT_A, WIDENING_GRANT, COMPANY_A1, BRANCH_A1, USER_A]
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

async function seedFreeUsers(): Promise<void> {
  for (const id of FREE_USERS_A) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,$3,$4,$4||'@example.test','BR-03 Roster Candidate','active',$5)
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, IDENTITY_PROVIDER, `fx_br_03_free_${id.slice(-4)}`, USER_A]
    );
  }
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','BR-03 Roster Candidate','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [BR03_USER_TENANT_B, TENANT_B, IDENTITY_PROVIDER, 'fx_br_03_free_tenant_b', USER_A]
  );
}

async function catalogueId(table: string, code: string): Promise<string> {
  const result = await admin.query<{ id: string }>(`SELECT id FROM ${table} WHERE code = $1`, [
    code,
  ]);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`BR-03 fixture: ${table} row ${code} was not seeded`);
  return id;
}

/**
 * Seeds the catalogue rows and the accounts, then resolves the generated ids.
 *
 * Runs as the owner with the actor GUC set, because `created_by` is NOT NULL on
 * every catalogue table and the touch triggers read `iam.current_user_id()`.
 */
export async function establishBr03Fixtures(pool: Pool): Promise<void> {
  admin = pool;
  for (const principal of BR03_PRINCIPALS) await seedPrincipal(principal);
  await seedWideningGrant();
  await seedFreeUsers();

  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `INSERT INTO tech.skills (scope, tenant_id, code, name, status, created_by)
       VALUES ('tenant',$1,$2,'Engine systems','active',$3)`,
      [TENANT_A, BR03_SKILL_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO tech.skills (scope, tenant_id, code, name, status, created_by)
       VALUES ('platform',NULL,$1,'Platform default skill','active',$2)`,
      [BR03_SKILL_PLATFORM_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO tech.skills (scope, tenant_id, code, name, status, created_by)
       VALUES ('tenant',$1,$2,'Retired discipline','inactive',$3)`,
      [TENANT_A, BR03_SKILL_INACTIVE_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO tech.skills (scope, tenant_id, code, name, status, created_by)
       VALUES ('tenant',$1,$2,'Foreign discipline','active',$3)`,
      [TENANT_B, BR03_SKILL_TENANT_B_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO tech.skill_levels (scope, tenant_id, code, name, rank, status, created_by)
       VALUES ('tenant',$1,$2,'Level one',10,'active',$3)`,
      [TENANT_A, BR03_LEVEL_ONE_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO tech.skill_levels (scope, tenant_id, code, name, rank, status, created_by)
       VALUES ('tenant',$1,$2,'Level two',20,'active',$3)`,
      [TENANT_A, BR03_LEVEL_TWO_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO tech.certifications
         (scope, tenant_id, code, name, is_safety_critical, status, created_by)
       VALUES ('tenant',$1,$2,'Air conditioning handling',false,'active',$3)`,
      [TENANT_A, BR03_CERT_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO tech.certifications
         (scope, tenant_id, code, name, is_safety_critical, status, created_by)
       VALUES ('tenant',$1,$2,'Welding',true,'active',$3)`,
      [TENANT_A, BR03_CERT_ALT_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO tech.certifications
         (scope, tenant_id, code, name, is_safety_critical, status, created_by)
       VALUES ('tenant',$1,$2,'Foreign credential',false,'active',$3)`,
      [TENANT_B, BR03_CERT_TENANT_B_CODE, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  catalogue.skill = await catalogueId('tech.skills', BR03_SKILL_CODE);
  catalogue.platformSkill = await catalogueId('tech.skills', BR03_SKILL_PLATFORM_CODE);
  catalogue.inactiveSkill = await catalogueId('tech.skills', BR03_SKILL_INACTIVE_CODE);
  catalogue.tenantBSkill = await catalogueId('tech.skills', BR03_SKILL_TENANT_B_CODE);
  catalogue.levelOne = await catalogueId('tech.skill_levels', BR03_LEVEL_ONE_CODE);
  catalogue.levelTwo = await catalogueId('tech.skill_levels', BR03_LEVEL_TWO_CODE);
  catalogue.certification = await catalogueId('tech.certifications', BR03_CERT_CODE);
  catalogue.certificationAlt = await catalogueId('tech.certifications', BR03_CERT_ALT_CODE);
  catalogue.tenantBCertification = await catalogueId(
    'tech.certifications',
    BR03_CERT_TENANT_B_CODE
  );
}

export { BRANCH_A1, BRANCH_A2, BRANCH_B1, COMPANY_A1, COMPANY_B1, TENANT_A, TENANT_B };
