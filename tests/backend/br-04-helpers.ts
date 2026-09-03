/**
 * BR-04 backend fixtures — inspection-template authoring.
 *
 * ## Why a sixth helpers file rather than widening `p1-19-helpers`
 *
 * Not one principal in `p1-19-helpers` holds `dia.catalogue.manage`, because the
 * permission did not exist until this slice. Adding it to `FULL` would silently
 * change what fourteen existing suites prove — every P1-19 diagnostics test that
 * asserts a refusal would start asserting it against a principal carrying more
 * authority than the phase shipped. `p1-21-helpers` and `br-03-helpers` exist for
 * exactly this reason and both say so in their own headers.
 *
 * ## The principals, and the claim each one exists to make falsifiable
 *
 *  - `TEMPLATE_ADMIN` — `dia.catalogue.manage` + `dia.diagnostic.read`. The
 *    positive path, and the only principal that may author.
 *  - `TEMPLATE_READER` — `dia.diagnostic.read` ONLY. Its refusals prove a 403 is
 *    about the missing `manage` authority rather than tenancy, scope or a
 *    malformed request, because it is identical to `TEMPLATE_ADMIN` in every
 *    other respect.
 *  - `DIAGNOSTIC_RECORDER` — every one of the FOUR pre-existing `dia` codes
 *    (`record`, `complete`, `review`, `read`) and NOT `dia.catalogue.manage`.
 *    This is the S5 principal, and it is the reason the slice mints a new code
 *    instead of widening an old one: if any of the four conferred authoring
 *    authority, the mint would be theatre. It also holds `dia.diagnostic.record`,
 *    which is what operation 8 costs, so the same principal proves both halves —
 *    it may SEE what it can inspect against and may not AUTHOR it.
 *  - `TEMPLATE_TENANT_B` — the same authority as `TEMPLATE_ADMIN`, in tenant B. A
 *    refusal from it is the tenant boundary rather than a missing permission.
 *
 * ## The diagnostic-type fixtures, and the Owner-content item they stand in for
 *
 * `dia.inspection_templates.diagnostic_type_id` is NOT NULL, and there is no
 * tenant operation in BR-04 (or anywhere) that creates a diagnostic type. The
 * BR-04 contract calls for a PLATFORM vocabulary whose content is an Owner
 * decision; no approved vocabulary exists anywhere in the repository, the plan or
 * the seeds, so **this slice ships no `dia.diagnostic_types` seed** and these
 * fixtures are test scaffolding rather than a proposed product vocabulary. Their
 * codes are `fx_br_04_*` for exactly that reason — nothing here should ever be
 * mistaken for content awaiting approval.
 *
 * Four of them, each carrying a specific job:
 *
 *  - `typeTenantA` — the ordinary tenant-scope type.
 *  - `typePlatform` — `scope = 'platform'`, `tenant_id IS NULL`. The row that
 *    proves `diagnosticTypeVisible` is not a tenant-equality test: a platform row
 *    must be ACCEPTED, and `fk_inspection_templates_diagnostic_type` is
 *    single-column precisely because a platform row has no tenant to compose
 *    with, so the database cannot make this decision and the service must.
 *  - `typeInactive` — tenant scope, `status = 'inactive'`. Referencing a retired
 *    type would create a template classified by something the tenant has
 *    withdrawn.
 *  - `typeTenantB` — a REAL row in tenant B. A tenant-A create naming it is a
 *    genuine crossing; naming a random uuid would prove only that unknown ids are
 *    refused, which is a much weaker claim.
 */
import type { Pool } from 'pg';
import { IDENTITY_PROVIDER, TENANT_A, TENANT_B, USER_A } from './helpers';
import type { Principal } from './p1-19-helpers';
import { StaticClaimsAuthenticator, setSessionAuthenticator } from '@/server/context/principal';

export const CATALOGUE_MANAGE = 'dia.catalogue.manage';
export const DIAGNOSTIC_READ = 'dia.diagnostic.read';
export const DIAGNOSTIC_RECORD = 'dia.diagnostic.record';
export const DIAGNOSTIC_COMPLETE = 'dia.diagnostic.complete';
export const DIAGNOSTIC_REVIEW = 'dia.diagnostic.review';

/** The four codes that existed BEFORE this slice. None may confer authoring. */
export const PRE_EXISTING_DIA_CODES = [
  DIAGNOSTIC_RECORD,
  DIAGNOSTIC_COMPLETE,
  DIAGNOSTIC_REVIEW,
  DIAGNOSTIC_READ,
];

export const TEMPLATE_ADMIN: Principal = {
  roleId: 'f4000000-0000-4000-8000-000000000101',
  userId: 'f4000000-0000-4000-8000-000000000102',
  subject: 'fx_br_04_admin',
  tenantId: TENANT_A,
  permissions: [CATALOGUE_MANAGE, DIAGNOSTIC_READ],
};

export const TEMPLATE_READER: Principal = {
  roleId: 'f4000000-0000-4000-8000-000000000111',
  userId: 'f4000000-0000-4000-8000-000000000112',
  subject: 'fx_br_04_reader',
  tenantId: TENANT_A,
  permissions: [DIAGNOSTIC_READ],
};

export const DIAGNOSTIC_RECORDER: Principal = {
  roleId: 'f4000000-0000-4000-8000-000000000121',
  userId: 'f4000000-0000-4000-8000-000000000122',
  subject: 'fx_br_04_recorder',
  tenantId: TENANT_A,
  permissions: PRE_EXISTING_DIA_CODES,
};

export const TEMPLATE_TENANT_B: Principal = {
  roleId: 'f4000000-0000-4000-8000-000000000131',
  userId: 'f4000000-0000-4000-8000-000000000132',
  subject: 'fx_br_04_tenant_b',
  tenantId: TENANT_B,
  permissions: [CATALOGUE_MANAGE, DIAGNOSTIC_READ],
};

export const BR04_PRINCIPALS: readonly Principal[] = [
  TEMPLATE_ADMIN,
  TEMPLATE_READER,
  DIAGNOSTIC_RECORDER,
  TEMPLATE_TENANT_B,
];

// ---- Diagnostic-type fixture codes -----------------------------------------

export const BR04_TYPE_CODE = 'fx_br_04_type';
export const BR04_TYPE_PLATFORM_CODE = 'fx_br_04_platform_type';
export const BR04_TYPE_INACTIVE_CODE = 'fx_br_04_retired_type';
export const BR04_TYPE_TENANT_B_CODE = 'fx_br_04_foreign_type';

/** Resolved ids, filled by `establishBr04Fixtures`. */
export const diagnosticTypes = {
  typeTenantA: '',
  typePlatform: '',
  typeInactive: '',
  typeTenantB: '',
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
 * A template version's status and item count, read as the OWNER.
 *
 * Read outside RLS on purpose: an assertion that a published version is really
 * published must not itself depend on the visibility rules under test.
 */
export async function rawVersion(versionId: string): Promise<{
  readonly status: string;
  readonly publishedAt: string | null;
  readonly versionNumber: number;
  readonly templateId: string;
  readonly itemCount: number;
} | null> {
  const result = await admin.query<{
    status: string;
    published_at: string | null;
    version_number: number;
    template_id: string;
    item_count: string;
  }>(
    `SELECT v.status, v.published_at::text AS published_at, v.version_number, v.template_id,
            (SELECT count(*) FROM dia.template_items i
              WHERE i.template_version_id = v.id AND i.deleted_at IS NULL)::text AS item_count
       FROM dia.template_versions v WHERE v.id = $1`,
    [versionId]
  );
  const row = result.rows[0];
  return row
    ? {
        status: row.status,
        publishedAt: row.published_at,
        versionNumber: row.version_number,
        templateId: row.template_id,
        itemCount: Number(row.item_count),
      }
    : null;
}

/** One version's item codes in the order the read contract promises. */
export async function rawItemCodes(versionId: string): Promise<readonly string[]> {
  const result = await admin.query<{ item_code: string }>(
    `SELECT item_code FROM dia.template_items
      WHERE template_version_id = $1 AND deleted_at IS NULL
      ORDER BY sequence ASC, id ASC`,
    [versionId]
  );
  return result.rows.map((row) => row.item_code);
}

export function liveTemplateCount(tenantId: string): Promise<number> {
  return countRowsOf(
    `SELECT count(*)::text AS n FROM dia.inspection_templates
      WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId]
  );
}

/**
 * Empties the template library between tests, leaving the diagnostic types.
 *
 * `uq_inspection_templates_tenant_code` permits one live template per code per
 * tenant, so without this the second test to use a fixed code would collide.
 *
 * ## The report chain goes first, and that ordering is a real fact about the model
 *
 * `dia.diagnostic_reports.template_version_id` is a hard foreign key with no
 * cascade, so a published version that a report cites CANNOT be deleted while the
 * report exists. That is the pin working exactly as designed — it is what stops a
 * template version from being removed out from under a historical report — and it
 * means a fixture reset has to unwind the reports first. The eight report children
 * precede the reports for the same reason.
 *
 * Discovered rather than assumed: the child list is every table `pg_constraint`
 * reports as referencing `dia.diagnostic_reports` or `dia.template_items`.
 *
 * Hard deletes rather than soft ones: the soft delete is PRODUCT behaviour under
 * test, and a fixture reset that used it would leave rows every later count would
 * have to know about.
 */
export async function resetTemplates(): Promise<void> {
  // Report children — three of them also reference dia.template_items directly.
  await admin.query('DELETE FROM dia.report_item_results');
  await admin.query('DELETE FROM dia.measurements');
  await admin.query('DELETE FROM dia.findings');
  await admin.query('DELETE FROM dia.dtc_records');
  await admin.query('DELETE FROM dia.diagnostic_evidence');
  await admin.query('DELETE FROM dia.recommendations');
  await admin.query('DELETE FROM dia.diagnostic_reviews');
  await admin.query('DELETE FROM dia.diagnostic_report_status_history');
  // The reports themselves, which pin the versions below.
  await admin.query('DELETE FROM dia.diagnostic_reports');
  // Then the library: items, versions, templates.
  await admin.query('DELETE FROM dia.template_items');
  await admin.query('DELETE FROM dia.template_versions');
  await admin.query('DELETE FROM dia.inspection_templates');
}

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','BR-04 Principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'BR-04 fixture',$4) ON CONFLICT (id) DO NOTHING`,
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
}

async function typeId(code: string, tenantId: string | null): Promise<string> {
  const result = await admin.query<{ id: string }>(
    tenantId === null
      ? `SELECT id FROM dia.diagnostic_types WHERE code = $1 AND scope = 'platform'`
      : `SELECT id FROM dia.diagnostic_types WHERE code = $1 AND tenant_id = $2`,
    tenantId === null ? [code] : [code, tenantId]
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`BR-04 fixture: diagnostic type ${code} was not seeded`);
  return id;
}

/**
 * Seeds the principals and the four diagnostic types, then resolves their ids.
 *
 * Runs as the owner with the actor GUC set: `created_by` is NOT NULL on
 * `dia.diagnostic_types` and the touch trigger reads `iam.current_user_id()`.
 * Idempotent, because the suite may share a database with its neighbours.
 */
export async function establishBr04Fixtures(pool: Pool): Promise<void> {
  admin = pool;
  for (const principal of BR04_PRINCIPALS) await seedPrincipal(principal);

  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `INSERT INTO dia.diagnostic_types (scope, tenant_id, code, name, status, created_by)
       VALUES ('tenant',$1,$2,'BR-04 fixture type','active',$3)
       ON CONFLICT DO NOTHING`,
      [TENANT_A, BR04_TYPE_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO dia.diagnostic_types (scope, tenant_id, code, name, status, created_by)
       VALUES ('platform',NULL,$1,'BR-04 fixture platform type','active',$2)
       ON CONFLICT DO NOTHING`,
      [BR04_TYPE_PLATFORM_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO dia.diagnostic_types (scope, tenant_id, code, name, status, created_by)
       VALUES ('tenant',$1,$2,'BR-04 fixture retired type','inactive',$3)
       ON CONFLICT DO NOTHING`,
      [TENANT_A, BR04_TYPE_INACTIVE_CODE, USER_A]
    );
    await client.query(
      `INSERT INTO dia.diagnostic_types (scope, tenant_id, code, name, status, created_by)
       VALUES ('tenant',$1,$2,'BR-04 fixture foreign type','active',$3)
       ON CONFLICT DO NOTHING`,
      [TENANT_B, BR04_TYPE_TENANT_B_CODE, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  diagnosticTypes.typeTenantA = await typeId(BR04_TYPE_CODE, TENANT_A);
  diagnosticTypes.typePlatform = await typeId(BR04_TYPE_PLATFORM_CODE, null);
  diagnosticTypes.typeInactive = await typeId(BR04_TYPE_INACTIVE_CODE, TENANT_A);
  diagnosticTypes.typeTenantB = await typeId(BR04_TYPE_TENANT_B_CODE, TENANT_B);
}
