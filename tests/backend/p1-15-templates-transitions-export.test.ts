/**
 * P1-15 operation evidence — message-template administration, the status-
 * transition engine, and export authorization, driven through the REAL wiring.
 *
 * Every assertion runs `withTransaction(ctx, db => sharedServicesModule().…)` on
 * the deployed `app_runtime` identity (`rootlco_test_runtime`), so RLS, the
 * column grants added by DBCR-P1-15-001, the transaction wrapper, and the
 * audit/outbox path are all genuinely exercised. The `postgres` admin connection
 * appears only to provision preconditions and to read back what actually landed;
 * it carries BYPASSRLS, so nothing it does is evidence.
 *
 * Denial shapes are observed, not assumed, and the three that occur here are
 * genuinely different because the policies are different:
 *
 *   * **INSERT to either template table: SQLSTATE 42501.**
 *     `ins_message_templates_tenant` and `ins_template_versions_tenant` demand
 *     `iam.has_permission('org.settings.manage')` in their `WITH CHECK`, and a
 *     failed INSERT check raises rather than returning zero rows.
 *   * **UPDATE on `shared.message_templates`: zero rows, no error.**
 *     `upd_message_templates_tenant` is the only UPDATE policy on that table, so
 *     a caller without the permission fails its `USING` clause and the row is
 *     not there to update. The service can only report that as `ERR-CON-001` —
 *     "wrong version" versus "not yours" would leak existence — so the proof it
 *     was the POLICY is the row itself: unchanged, un-versioned, unaudited.
 *   * **UPDATE on `shared.template_versions`: SQLSTATE 42501.** That table
 *     carries a SECOND permissive UPDATE policy,
 *     `lck_template_versions_reference` (`USING (tenant matches)` with
 *     `WITH CHECK (false)`), which exists only so `guard_outbound_message_scope`
 *     can take `FOR SHARE` on a platform version during enqueue. Permissive
 *     policies OR their `USING` clauses, so the row IS admitted to the update —
 *     and then every `WITH CHECK` evaluates false and the write is refused
 *     outright. The lock-only policy changes the SHAPE of the refusal without
 *     weakening it, and this suite records that instead of papering over it.
 *
 * `org.branches` is different again, and this file says so rather than
 * pretending otherwise: `upd_branches_scope` predicates tenant, company and
 * branch scope but requires **no permission**. So the `org.settings.manage`
 * requirement for `shared.branch-status-change` lives entirely in the operation
 * declaration, and the denial is proved where it actually lives —
 * `requirePermissions()` against the operation, the same database-evaluated
 * check `handleOperation` runs. The database-enforced refusal that DOES exist
 * for branches is scope, and that is proved separately as isolation.
 *
 * Operations exercised here (coverage-gate references):
 *   shared.template-create           shared.template-update
 *   shared.template-version-create   shared.template-version-revise
 *   shared.template-version-approve  shared.template-version-retire
 *   shared.template-activation-set   shared.template-version-preview
 *   shared.branch-status-change      shared.branch-status-read
 *   shared.export-authorize          shared.export-catalogue
 *
 * COVERAGE-EVIDENCE (P1-15 templates, transitions and export):
 *   shared.template-create: success denial cross-tenant audit
 *   shared.template-update: success denial audit stale-version
 *   shared.template-version-create: success denial audit outbox
 *   shared.template-version-revise: success denial stale-version
 *   shared.template-version-approve: success denial audit outbox stale-version
 *   shared.template-version-retire: success denial audit stale-version
 *   shared.template-activation-set: success denial audit stale-version
 *   shared.template-version-preview: success
 *   shared.branch-status-change: success denial isolation audit outbox stale-version
 *   shared.branch-status-read: success
 *   shared.export-authorize: success denial audit
 *   shared.export-catalogue: success
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_UNPERMITTED,
  USER_TENANT_B,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { requirePermissions } from '@/server/auth/authorization';
import { sharedServicesModule } from '@/modules/shared-services';
import type { TemplateService } from '@/modules/shared-services/application/template-service';
import type { StatusTransitionService } from '@/modules/shared-services/application/status-transition-service';
import type { ExportAuthorizationService } from '@/modules/shared-services/application/export-authorization-service';
import { TEMPLATE_CREATE_OPERATION } from '@/app/api/v1/message-templates/route';
import { TEMPLATE_VERSION_CREATE_OPERATION } from '@/app/api/v1/message-templates/[templateId]/versions/route';
import { TEMPLATE_VERSION_APPROVE_OPERATION } from '@/app/api/v1/template-versions/[versionId]/approval/route';
import {
  BRANCH_STATUS_CHANGE_OPERATION,
  BRANCH_STATUS_READ_OPERATION,
} from '@/app/api/v1/organization/branches/[branchId]/status/route';
import { EXPORT_AUTHORIZE_OPERATION } from '@/app/api/v1/exports/authorizations/route';
import { EXPORT_CATALOGUE_OPERATION } from '@/app/api/v1/exports/resources/route';

// ---------------------------------------------------------------------------
// Deterministic fixtures. A distinct id space (a8…/b8…/c8…) from every other
// backend suite, so a concurrent fixture can never collide with one of these.
// All of it is ephemeral scaffolding removed by cleanBackendFixtures(); no
// business data is created, shipped, or retained.
// ---------------------------------------------------------------------------

/** Tenant A principal holding every permission these operations declare. */
const U_ADMIN = 'a8000000-0000-4000-8000-000000000001';
/** Tenant A principal holding `rpt.export` and NOTHING else. */
const U_EXPORT_ONLY = 'a8000000-0000-4000-8000-000000000002';
const ROLE_ADMIN = 'a8100000-0000-4000-8000-000000000001';
const ROLE_EXPORT_ONLY = 'a8100000-0000-4000-8000-000000000002';

/** Tenant B template + version: real rows, so "invisible" is not "absent". */
const TEMPLATE_B = 'b8600000-0000-4000-8000-000000000001';
const TPLVER_B = 'b8700000-0000-4000-8000-000000000001';
/** Platform template + version: readable by every tenant, writable by none. */
const TEMPLATE_PLATFORM = 'c8600000-0000-4000-8000-000000000001';
const TPLVER_PLATFORM = 'c8700000-0000-4000-8000-000000000001';

/** Template identity shared by tenant A and tenant B in the isolation proof. */
const SHARED_TEMPLATE_CODE = 'fx_p15_tx_shared';
const PLATFORM_TEMPLATE_CODE = 'fx_p15_tx_platform';

const ADMIN_PERMISSIONS = [
  'org.settings.manage',
  'org.branch.read',
  'rpt.export',
  'shared.document.manage',
  'shared.notification.send',
];

const BODY = 'Hello {{name}}, this is a P1-15 evidence template body.';
const REVISED_BODY = 'Hello {{name}}, this body was revised while still a draft.';

let admin: Pool;
let runtime: Pool;
let templates: TemplateService;
let transitions: StatusTransitionService;
let exportAuthorization: ExportAuthorizationService;

/** Monotonic suffixes: template codes and branch codes are unique per tenant. */
let codeSeq = 0;
const nextTemplateCode = (): string => `fx_p15_tx_t${++codeSeq}`;
let branchSeq = 0;

const asAdmin = () =>
  contextFor({ userId: U_ADMIN, operation: 'shared.p1-15-evidence', module: 'shared-services' });
const asExportOnly = () =>
  contextFor({
    userId: U_EXPORT_ONLY,
    operation: 'shared.p1-15-evidence',
    module: 'shared-services',
  });
const asUnpriv = () =>
  contextFor({
    userId: USER_UNPERMITTED,
    operation: 'shared.p1-15-evidence',
    module: 'shared-services',
  });
/** The same administrator, narrowed to one branch — a scope, not a permission. */
const asBranchScoped = (branchId: string) =>
  contextFor({
    userId: U_ADMIN,
    operation: 'shared.p1-15-evidence',
    module: 'shared-services',
    companyIds: [COMPANY_A1],
    branchIds: [branchId],
  });

// ---------------------------------------------------------------------------
// Readers. `admin` is used here and only here — reading back what landed is not
// a capability claim, and a privilege-poor reader would make "absent" and
// "invisible" indistinguishable.
// ---------------------------------------------------------------------------

const auditCount = (action: string, entityId: string): Promise<number> =>
  countRows(admin, 'iam.audit_records', 'action = $1 AND entity_id = $2', [action, entityId]);

const exportAuditCount = (): Promise<number> =>
  countRows(admin, 'iam.audit_records', 'action = $1 AND entity_id IS NULL AND tenant_id = $2', [
    'shared.export.authorized',
    TENANT_A,
  ]);

const outboxCount = (eventKey: string): Promise<number> =>
  countRows(admin, 'shared.event_outbox', 'tenant_id = $1 AND event_key = $2', [
    TENANT_A,
    eventKey,
  ]);

interface TemplateSnapshot {
  readonly scope: string;
  readonly tenant_id: string | null;
  readonly name: string;
  readonly status: string;
  readonly active_version_id: string | null;
  readonly record_version: number;
}

async function templateRow(templateId: string): Promise<TemplateSnapshot | undefined> {
  const result = await admin.query<TemplateSnapshot>(
    `SELECT scope, tenant_id, name, status, active_version_id, record_version
       FROM shared.message_templates WHERE id = $1`,
    [templateId]
  );
  return result.rows[0];
}

interface VersionSnapshot {
  readonly status: string;
  readonly record_version: number;
  readonly version_number: number;
  readonly subject: string | null;
  readonly body: string;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly retired_at: string | null;
  readonly tenant_id: string | null;
}

async function versionRow(versionId: string): Promise<VersionSnapshot | undefined> {
  const result = await admin.query<VersionSnapshot>(
    `SELECT status, record_version, version_number, subject, body,
            approved_by, approved_at, retired_at, tenant_id
       FROM shared.template_versions WHERE id = $1`,
    [versionId]
  );
  return result.rows[0];
}

async function branchRow(
  branchId: string
): Promise<{ status: string; record_version: number } | undefined> {
  const result = await admin.query<{ status: string; record_version: number }>(
    'SELECT status, record_version FROM org.branches WHERE id = $1',
    [branchId]
  );
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Service-driven builders. Everything a test needs as a *precondition* is built
// through the service on the runtime role, so a precondition that silently
// stopped working would fail the test rather than hide behind an admin INSERT.
// ---------------------------------------------------------------------------

const createTemplate = (
  over: { templateCode?: string; localeCode?: string; description?: string | null } = {}
) =>
  withTransaction(asAdmin(), (db) =>
    templates.createTemplate(db, {
      templateCode: over.templateCode ?? nextTemplateCode(),
      name: 'P1-15 evidence template',
      channel: 'email',
      purpose: 'transactional',
      localeCode: over.localeCode ?? 'en',
      description: over.description ?? null,
    })
  );

const createDraft = (templateId: string, body = BODY) =>
  withTransaction(asAdmin(), (db) =>
    templates.createVersion(db, templateId, { subject: 'P1-15 evidence subject', body })
  );

/** A template with one approved version. Returns both ids and both versions. */
async function templateWithApprovedVersion(): Promise<{
  templateId: string;
  versionId: string;
  /** `record_version` of the version AFTER approval. */
  versionRecordVersion: number;
}> {
  const { templateId } = await createTemplate();
  const draft = await createDraft(templateId);
  await withTransaction(asAdmin(), (db) =>
    templates.approveVersion(db, draft.versionId, draft.recordVersion)
  );
  return {
    templateId,
    versionId: draft.versionId,
    versionRecordVersion: draft.recordVersion + 1,
  };
}

/** Provisions a branch as ADMIN. A precondition, never evidence. */
async function seedBranch(): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO org.branches
       (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $2, $3, $4, 'P1-15 transition fixture', 'UTC', $5)`,
    [id, TENANT_A, COMPANY_A1, `fx_p15_br_${++branchSeq}`, USER_A]
  );
  return id;
}

// ---------------------------------------------------------------------------

async function seedSuiteFixtures(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $3, 'test_harness', 'fx_p15_tx_admin', 'fx-p15-tx-admin@example.test',
             'P1-15 Template Fixture', 'active', $4),
            ($2, $3, 'test_harness', 'fx_p15_tx_export', 'fx-p15-tx-export@example.test',
             'P1-15 Export Fixture', 'active', $4)
     ON CONFLICT (id) DO NOTHING`,
    [U_ADMIN, U_EXPORT_ONLY, TENANT_A, USER_A]
  );

  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $3, 'fx_p15_tx_admin', 'P1-15 shared administration', $4),
            ($2, $3, 'fx_p15_tx_export', 'P1-15 export switch only', $4)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_ADMIN, ROLE_EXPORT_ONLY, TENANT_A, USER_A]
  );

  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = ANY($4::text[])
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_ADMIN, USER_A, ADMIN_PERMISSIONS]
  );
  // The export-only role deliberately holds the platform switch and no resource
  // entitlement, so "missing rpt.export" and "missing the resource permission"
  // can be shown to produce the SAME refusal.
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = 'rpt.export'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_EXPORT_ONLY, USER_A]
  );

  for (const [userId, roleId] of [
    [U_ADMIN, ROLE_ADMIN],
    [U_EXPORT_ONLY, ROLE_EXPORT_ONLY],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_grants
         (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       SELECT $1, $2, $3, 'unrestricted', 'active', $4, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3)`,
      [TENANT_A, userId, roleId, USER_A]
    );
  }

  // A tenant-B template, so "a tenant-B id is not found from tenant A" is a
  // statement about a row that genuinely exists rather than about a typo. Its
  // code is the one tenant A also creates, so the identity uniqueness proof is
  // about scope rather than about two different strings.
  await admin.query(
    `INSERT INTO shared.message_templates
       (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, status, created_by)
     VALUES ($1, 'tenant', $2, $3, 'P1-15 tenant B template', 'email', 'transactional',
             'en', 'active', $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEMPLATE_B, TENANT_B, SHARED_TEMPLATE_CODE, USER_TENANT_B]
  );
  await admin.query(
    `INSERT INTO shared.template_versions
       (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
     VALUES ($1, $2, $3, 1, 'Tenant B subject', $4, decode(repeat('bb', 32), 'hex'), $5)
     ON CONFLICT (id) DO NOTHING`,
    [TPLVER_B, TENANT_B, TEMPLATE_B, BODY, USER_TENANT_B]
  );

  // A PLATFORM template and version. Every tenant reads them
  // (`sel_message_templates_visible`); no tenant may write them — which is what
  // the ERR-IAM-001 refusals below prove from the application side.
  await admin.query(
    `INSERT INTO shared.message_templates
       (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, status, created_by)
     VALUES ($1, 'platform', NULL, $2, 'P1-15 platform template', 'email', 'transactional',
             'en', 'active', $3)
     ON CONFLICT (id) DO NOTHING`,
    [TEMPLATE_PLATFORM, PLATFORM_TEMPLATE_CODE, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.template_versions
       (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
     VALUES ($1, NULL, $2, 1, 'Platform subject', $3, decode(repeat('aa', 32), 'hex'), $4)
     ON CONFLICT (id) DO NOTHING`,
    [TPLVER_PLATFORM, TEMPLATE_PLATFORM, BODY, USER_A]
  );
}

beforeAll(async () => {
  __resetBackendConfigForTests();
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await seedSuiteFixtures();

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);

  const module_ = sharedServicesModule();
  templates = module_.templates;
  transitions = module_.transitions;
  exportAuthorization = module_.exports;
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

// ===========================================================================
// shared.template-create
// ===========================================================================
describe('shared.template-create', () => {
  it('creates a tenant-scoped template with no active version and audits the creation', async () => {
    const code = nextTemplateCode();
    const { templateId } = await createTemplate({ templateCode: code });

    const row = await templateRow(templateId);
    // `scope` is pinned to 'tenant' by the repository AND by the INSERT policy:
    // there is no request shape that produces a platform template from here.
    expect(row?.scope).toBe('tenant');
    expect(row?.tenant_id).toBe(TENANT_A);
    expect(row?.status).toBe('active');
    // `guard_template_active_version` refuses an INSERT that already names one.
    expect(row?.active_version_id).toBeNull();
    expect(row?.record_version).toBe(1);

    expect(await auditCount('shared.template.created', templateId)).toBe(1);
  });

  it('denial: a principal without org.settings.manage is refused by the INSERT policy (42501)', async () => {
    const code = nextTemplateCode();
    const error = await withTransaction(asUnpriv(), (db) =>
      templates
        .createTemplate(db, {
          templateCode: code,
          name: 'nope',
          channel: 'email',
          purpose: 'transactional',
          localeCode: 'en',
          description: null,
        })
        .catch((e: unknown) => e)
    );
    // An INSERT that fails the RLS WITH CHECK raises 42501; it does not return
    // zero rows, so the service's ERR-IAM-001 branch is not the observed shape.
    expect((error as { code?: string }).code).toBe('42501');
    expect(await countRows(admin, 'shared.message_templates', 'template_code = $1', [code])).toBe(
      0
    );
  });

  it('denial: the operation gate refuses the same principal with ERR-IAM-001', async () => {
    const error = await withTransaction(asUnpriv(), (db) =>
      requirePermissions(db, TEMPLATE_CREATE_OPERATION).catch((e: unknown) => e)
    );
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('cross-tenant: a tenant-B template with the same identity neither blocks nor is touched', async () => {
    // Tenant B already owns SHARED_TEMPLATE_CODE / email / en. Creating the same
    // identity in tenant A must succeed — uniqueness is per tenant — and must
    // leave the tenant-B row exactly as it was.
    const { templateId } = await createTemplate({ templateCode: SHARED_TEMPLATE_CODE });
    const created = await templateRow(templateId);
    expect(created?.tenant_id).toBe(TENANT_A);
    expect(templateId).not.toBe(TEMPLATE_B);

    const tenantB = await templateRow(TEMPLATE_B);
    expect(tenantB?.tenant_id).toBe(TENANT_B);
    expect(tenantB?.name).toBe('P1-15 tenant B template');
    expect(tenantB?.record_version).toBe(1);

    // …and the uniqueness that does apply is the caller's own tenant's.
    const conflict = await withTransaction(asAdmin(), (db) =>
      templates
        .createTemplate(db, {
          templateCode: SHARED_TEMPLATE_CODE,
          name: 'duplicate identity',
          channel: 'email',
          purpose: 'transactional',
          localeCode: 'en',
          description: null,
        })
        .catch((e: unknown) => e)
    );
    expect((conflict as AppFailure).code).toBe('ERR-RES-002');
  });

  it('an unregistered locale is refused with ERR-VAL-001 and creates nothing', async () => {
    const code = nextTemplateCode();
    const error = await withTransaction(asAdmin(), (db) =>
      templates
        .createTemplate(db, {
          templateCode: code,
          name: 'unknown locale',
          channel: 'email',
          purpose: 'transactional',
          localeCode: 'zz',
          description: null,
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
    expect(await countRows(admin, 'shared.message_templates', 'template_code = $1', [code])).toBe(
      0
    );
  });
});

// ===========================================================================
// shared.template-update
// ===========================================================================
describe('shared.template-update', () => {
  it('renames a template under the version guard and audits the change', async () => {
    const { templateId } = await createTemplate();

    await withTransaction(asAdmin(), (db) =>
      templates.updateTemplate(db, templateId, 1, { name: 'P1-15 renamed template' })
    );

    const row = await templateRow(templateId);
    expect(row?.name).toBe('P1-15 renamed template');
    // `shared.touch_row_metadata()` advanced the version in a BEFORE trigger.
    expect(row?.record_version).toBe(2);
    expect(await auditCount('shared.template.updated', templateId)).toBe(1);
  });

  it('stale-version: a wrong record_version is refused (ERR-CON-001) and changes nothing', async () => {
    const { templateId } = await createTemplate();

    const error = await withTransaction(asAdmin(), (db) =>
      templates.updateTemplate(db, templateId, 999, { name: 'nope' }).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');

    const row = await templateRow(templateId);
    expect(row?.name).toBe('P1-15 evidence template');
    expect(row?.record_version).toBe(1);
    expect(await auditCount('shared.template.updated', templateId)).toBe(0);
  });

  it('denial: a principal without org.settings.manage updates zero rows (ERR-CON-001)', async () => {
    const { templateId } = await createTemplate();

    const error = await withTransaction(asUnpriv(), (db) =>
      templates.updateTemplate(db, templateId, 1, { name: 'nope' }).catch((e: unknown) => e)
    );
    // `upd_message_templates_tenant` filters the row out of the USING clause, so
    // the UPDATE affects zero rows and raises nothing; the service can only
    // report that as a conflict. The proof it was the POLICY is the row: the
    // name and version are untouched and no audit record exists.
    expect((error as AppFailure).code).toBe('ERR-CON-001');
    const row = await templateRow(templateId);
    expect(row?.name).toBe('P1-15 evidence template');
    expect(row?.record_version).toBe(1);
    expect(await auditCount('shared.template.updated', templateId)).toBe(0);
  });

  it('a PLATFORM template cannot be mutated by a tenant (ERR-IAM-001)', async () => {
    const before = await templateRow(TEMPLATE_PLATFORM);
    const error = await withTransaction(asAdmin(), (db) =>
      templates
        .updateTemplate(db, TEMPLATE_PLATFORM, before?.record_version ?? 1, { name: 'hijacked' })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');

    const after = await templateRow(TEMPLATE_PLATFORM);
    expect(after?.name).toBe('P1-15 platform template');
    expect(after?.record_version).toBe(before?.record_version);
  });

  it('cross-tenant: a tenant-B template is not found from tenant A (ERR-RES-001)', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      templates.updateTemplate(db, TEMPLATE_B, 1, { name: 'nope' }).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
    expect((await templateRow(TEMPLATE_B))?.name).toBe('P1-15 tenant B template');
  });
});

// ===========================================================================
// shared.template-version-create
// ===========================================================================
describe('shared.template-version-create', () => {
  it('creates a draft version, audits it, and publishes exactly one event', async () => {
    const { templateId } = await createTemplate();

    const view = await createDraft(templateId);
    expect(view.versionNumber).toBe(1);
    // A version is always born a draft: `guard_template_version_lifecycle`
    // refuses an INSERT that arrives in any other state.
    expect(view.status).toBe('draft');
    expect(view.recordVersion).toBe(1);
    expect(view.variables).toEqual(['name']);

    const row = await versionRow(view.versionId);
    expect(row?.status).toBe('draft');
    expect(row?.tenant_id).toBe(TENANT_A);
    expect(row?.approved_by).toBeNull();
    expect(row?.approved_at).toBeNull();

    expect(await auditCount('shared.template.version_created', view.versionId)).toBe(1);
    expect(await outboxCount(`template.change:${templateId}:version_created:1`)).toBe(1);
  });

  it('numbers the next draft sequentially', async () => {
    const { templateId } = await createTemplate();
    const first = await createDraft(templateId);
    const second = await createDraft(templateId);
    expect(first.versionNumber).toBe(1);
    expect(second.versionNumber).toBe(2);
    expect(await outboxCount(`template.change:${templateId}:version_created:2`)).toBe(1);
  });

  it('denial: a principal without org.settings.manage is refused by the INSERT policy (42501)', async () => {
    const { templateId } = await createTemplate();

    const error = await withTransaction(asUnpriv(), (db) =>
      templates
        .createVersion(db, templateId, { subject: null, body: BODY })
        .catch((e: unknown) => e)
    );
    expect((error as { code?: string }).code).toBe('42501');
    expect(
      await countRows(admin, 'shared.template_versions', 'template_id = $1', [templateId])
    ).toBe(0);
  });

  it('denial: the operation gate refuses the same principal with ERR-IAM-001', async () => {
    const error = await withTransaction(asUnpriv(), (db) =>
      requirePermissions(db, TEMPLATE_VERSION_CREATE_OPERATION).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('a PLATFORM template cannot receive a tenant-authored version (ERR-IAM-001)', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      templates
        .createVersion(db, TEMPLATE_PLATFORM, { subject: null, body: BODY })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect(
      await countRows(admin, 'shared.template_versions', 'template_id = $1', [TEMPLATE_PLATFORM])
    ).toBe(1);
  });

  it('cross-tenant: a tenant-B template is not found from tenant A (ERR-RES-001)', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      templates
        .createVersion(db, TEMPLATE_B, { subject: null, body: BODY })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
    expect(
      await countRows(admin, 'shared.template_versions', 'template_id = $1', [TEMPLATE_B])
    ).toBe(1);
  });
});

// ===========================================================================
// shared.template-version-revise
// ===========================================================================
describe('shared.template-version-revise', () => {
  it('revises draft content and re-derives the content hash', async () => {
    const { templateId } = await createTemplate();
    const draft = await createDraft(templateId);
    const before = await versionRow(draft.versionId);

    await withTransaction(asAdmin(), (db) =>
      templates.reviseDraft(db, draft.versionId, draft.recordVersion, {
        subject: 'Revised subject',
        body: REVISED_BODY,
      })
    );

    const after = await versionRow(draft.versionId);
    expect(after?.body).toBe(REVISED_BODY);
    expect(after?.subject).toBe('Revised subject');
    expect(after?.status).toBe('draft');
    expect(after?.record_version).toBe((before?.record_version ?? 0) + 1);
  });

  it('approved content can no longer be revised (ERR-TRN-001)', async () => {
    const { versionId, versionRecordVersion } = await templateWithApprovedVersion();

    const error = await withTransaction(asAdmin(), (db) =>
      templates
        .reviseDraft(db, versionId, versionRecordVersion, { subject: null, body: REVISED_BODY })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-TRN-001');
    // The service refuses before writing; the body is the approved one.
    expect((await versionRow(versionId))?.body).toBe(BODY);
  });

  it('stale-version: a wrong record_version is refused (ERR-CON-001)', async () => {
    const { templateId } = await createTemplate();
    const draft = await createDraft(templateId);

    const error = await withTransaction(asAdmin(), (db) =>
      templates
        .reviseDraft(db, draft.versionId, 999, { subject: null, body: REVISED_BODY })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
    expect((await versionRow(draft.versionId))?.body).toBe(BODY);
  });

  it('denial: a principal without org.settings.manage is refused by the WITH CHECK (42501)', async () => {
    const { templateId } = await createTemplate();
    const draft = await createDraft(templateId);

    const error = await withTransaction(asUnpriv(), (db) =>
      templates
        .reviseDraft(db, draft.versionId, draft.recordVersion, {
          subject: null,
          body: REVISED_BODY,
        })
        .catch((e: unknown) => e)
    );
    // Observed, not assumed, and the shape differs from the templates table on
    // purpose. `shared.template_versions` carries a SECOND permissive UPDATE
    // policy — `lck_template_versions_reference`, `USING (tenant matches)` with
    // `WITH CHECK (false)` — which exists so an enqueue can take `FOR SHARE` on
    // a platform version. Permissive policies OR their USING clauses, so the row
    // IS admitted to the update; both WITH CHECK clauses then evaluate false for
    // a caller without `org.settings.manage`, and the write is refused outright
    // rather than silently affecting zero rows.
    expect((error as { code?: string }).code).toBe('42501');
    expect((error as Error).message).toContain('row-level security policy');
    const row = await versionRow(draft.versionId);
    expect(row?.body).toBe(BODY);
    expect(row?.record_version).toBe(draft.recordVersion);
  });

  it('a PLATFORM template version is read-only for a tenant (ERR-IAM-001)', async () => {
    const before = await versionRow(TPLVER_PLATFORM);
    const error = await withTransaction(asAdmin(), (db) =>
      templates
        .reviseDraft(db, TPLVER_PLATFORM, before?.record_version ?? 1, {
          subject: null,
          body: REVISED_BODY,
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect((await versionRow(TPLVER_PLATFORM))?.body).toBe(BODY);
  });
});

// ===========================================================================
// shared.template-version-approve
// ===========================================================================
describe('shared.template-version-approve', () => {
  it('approves a draft, attributes it to the session, audits it, and publishes one event', async () => {
    const { templateId } = await createTemplate();
    const draft = await createDraft(templateId);

    await withTransaction(asAdmin(), (db) =>
      templates.approveVersion(db, draft.versionId, draft.recordVersion)
    );

    const row = await versionRow(draft.versionId);
    expect(row?.status).toBe('approved');
    // The approver comes from the session context, never from the request — a
    // caller who could name the approver could blame someone else.
    expect(row?.approved_by).toBe(U_ADMIN);
    expect(row?.approved_at).not.toBeNull();
    expect(row?.record_version).toBe(draft.recordVersion + 1);

    expect(await auditCount('shared.template.version_approved', draft.versionId)).toBe(1);
    expect(await outboxCount(`template.change:${templateId}:version_approved:1`)).toBe(1);
  });

  it('stale-version: a wrong record_version is refused (ERR-CON-001)', async () => {
    const { templateId } = await createTemplate();
    const draft = await createDraft(templateId);

    const error = await withTransaction(asAdmin(), (db) =>
      templates.approveVersion(db, draft.versionId, 999).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
    expect((await versionRow(draft.versionId))?.status).toBe('draft');
  });

  it('denial: a principal without org.settings.manage is refused by the WITH CHECK (42501)', async () => {
    const { templateId } = await createTemplate();
    const draft = await createDraft(templateId);

    const error = await withTransaction(asUnpriv(), (db) =>
      templates.approveVersion(db, draft.versionId, draft.recordVersion).catch((e: unknown) => e)
    );
    // Same shape as the revise denial, for the same reason: the lock-only policy
    // admits the row, and every WITH CHECK refuses the write. The approval is
    // not merely rejected — the row never reaches `approved`.
    expect((error as { code?: string }).code).toBe('42501');
    expect((error as Error).message).toContain('row-level security policy');
    const row = await versionRow(draft.versionId);
    expect(row?.status).toBe('draft');
    expect(row?.approved_by).toBeNull();
    expect(await auditCount('shared.template.version_approved', draft.versionId)).toBe(0);
  });

  it('denial: the operation gate refuses the same principal with ERR-IAM-001', async () => {
    const error = await withTransaction(asUnpriv(), (db) =>
      requirePermissions(db, TEMPLATE_VERSION_APPROVE_OPERATION).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('a version that is already approved cannot be approved again (ERR-TRN-001)', async () => {
    const { versionId, versionRecordVersion } = await templateWithApprovedVersion();

    const error = await withTransaction(asAdmin(), (db) =>
      templates.approveVersion(db, versionId, versionRecordVersion).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-TRN-001');
    expect(await auditCount('shared.template.version_approved', versionId)).toBe(1);
  });
});

// ===========================================================================
// shared.template-activation-set
// ===========================================================================
describe('shared.template-activation-set', () => {
  it('points a template at an approved version, audits it, and publishes one event', async () => {
    const { templateId, versionId } = await templateWithApprovedVersion();

    await withTransaction(asAdmin(), (db) =>
      templates.setActiveVersion(db, templateId, 1, versionId)
    );

    const row = await templateRow(templateId);
    expect(row?.active_version_id).toBe(versionId);
    expect(row?.record_version).toBe(2);
    expect(await auditCount('shared.template.updated', templateId)).toBe(1);
    expect(await outboxCount(`template.change:${templateId}:activated:2`)).toBe(1);
  });

  it('activation is refused for a version that is not approved (ERR-TRN-001)', async () => {
    const { templateId } = await createTemplate();
    const draft = await createDraft(templateId);

    const error = await withTransaction(asAdmin(), (db) =>
      templates.setActiveVersion(db, templateId, 1, draft.versionId).catch((e: unknown) => e)
    );
    // `guard_template_active_version()` re-reads the version FOR UPDATE and
    // raises a check violation; the service maps it to a state refusal.
    expect((error as AppFailure).code).toBe('ERR-TRN-001');
    expect((await templateRow(templateId))?.active_version_id).toBeNull();
    expect(await auditCount('shared.template.updated', templateId)).toBe(0);
  });

  it('stale-version: a wrong record_version is refused (ERR-CON-001)', async () => {
    const { templateId, versionId } = await templateWithApprovedVersion();

    const error = await withTransaction(asAdmin(), (db) =>
      templates.setActiveVersion(db, templateId, 999, versionId).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
    expect((await templateRow(templateId))?.active_version_id).toBeNull();
  });

  it('denial: a principal without org.settings.manage activates zero rows (ERR-CON-001)', async () => {
    const { templateId, versionId } = await templateWithApprovedVersion();

    const error = await withTransaction(asUnpriv(), (db) =>
      templates.setActiveVersion(db, templateId, 1, versionId).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
    const row = await templateRow(templateId);
    expect(row?.active_version_id).toBeNull();
    expect(row?.record_version).toBe(1);
    expect(await auditCount('shared.template.updated', templateId)).toBe(0);
  });

  it('a version belonging to another template is refused with ERR-VAL-001', async () => {
    const target = await templateWithApprovedVersion();
    const foreign = await templateWithApprovedVersion();

    const error = await withTransaction(asAdmin(), (db) =>
      templates
        .setActiveVersion(db, target.templateId, 1, foreign.versionId)
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
    expect((await templateRow(target.templateId))?.active_version_id).toBeNull();
  });
});

// ===========================================================================
// shared.template-version-retire
// ===========================================================================
describe('shared.template-version-retire', () => {
  it('refuses to retire the active version, then permits it after deactivation', async () => {
    const { templateId, versionId, versionRecordVersion } = await templateWithApprovedVersion();
    await withTransaction(asAdmin(), (db) =>
      templates.setActiveVersion(db, templateId, 1, versionId)
    );

    const refused = await withTransaction(asAdmin(), (db) =>
      templates.retireVersion(db, versionId, versionRecordVersion).catch((e: unknown) => e)
    );
    expect((refused as AppFailure).code).toBe('ERR-TRN-001');
    expect((await versionRow(versionId))?.status).toBe('approved');
    expect(await auditCount('shared.template.version_retired', versionId)).toBe(0);

    // Deactivate first — that is the whole point of the guard: a retirement must
    // not silently disarm a live template.
    await withTransaction(asAdmin(), (db) => templates.setActiveVersion(db, templateId, 2, null));

    await withTransaction(asAdmin(), (db) =>
      templates.retireVersion(db, versionId, versionRecordVersion)
    );

    const row = await versionRow(versionId);
    expect(row?.status).toBe('retired');
    expect(row?.retired_at).not.toBeNull();
    // Retirement is not deletion: the approval attribution survives, because
    // messages already sent reference this version.
    expect(row?.approved_by).toBe(U_ADMIN);
    expect(await auditCount('shared.template.version_retired', versionId)).toBe(1);
    expect(await outboxCount(`template.change:${templateId}:version_retired:1`)).toBe(1);
  });

  it('stale-version: a wrong record_version is refused (ERR-CON-001)', async () => {
    const { versionId } = await templateWithApprovedVersion();

    const error = await withTransaction(asAdmin(), (db) =>
      templates.retireVersion(db, versionId, 999).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
    expect((await versionRow(versionId))?.status).toBe('approved');
  });

  it('denial: a principal without org.settings.manage is refused by the WITH CHECK (42501)', async () => {
    const { versionId, versionRecordVersion } = await templateWithApprovedVersion();

    const error = await withTransaction(asUnpriv(), (db) =>
      templates.retireVersion(db, versionId, versionRecordVersion).catch((e: unknown) => e)
    );
    // The lock-only policy admits the row; every WITH CHECK refuses the write.
    expect((error as { code?: string }).code).toBe('42501');
    expect((error as Error).message).toContain('row-level security policy');
    expect((await versionRow(versionId))?.status).toBe('approved');
    expect(await auditCount('shared.template.version_retired', versionId)).toBe(0);
  });

  it('a draft version cannot be retired (ERR-TRN-001)', async () => {
    const { templateId } = await createTemplate();
    const draft = await createDraft(templateId);

    const error = await withTransaction(asAdmin(), (db) =>
      templates.retireVersion(db, draft.versionId, draft.recordVersion).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-TRN-001');
    expect((await versionRow(draft.versionId))?.status).toBe('draft');
  });
});

// ===========================================================================
// shared.template-version-preview
// ===========================================================================
describe('shared.template-version-preview', () => {
  it('renders a version with sample values, escaping the variables and not the body', async () => {
    const { templateId } = await createTemplate();
    const draft = await createDraft(templateId);

    const rendered = await withTransaction(asAdmin(), (db) =>
      templates.previewVersion(db, draft.versionId, { name: 'fx <Recipient> & Co' })
    );

    expect(rendered.variables).toEqual(['name']);
    // The caller-supplied value is HTML-escaped; the administrator-authored body
    // is not, because escaping it would corrupt the markup they wrote.
    expect(rendered.body).toContain('fx &lt;Recipient&gt; &amp; Co');
    expect(rendered.body).toContain('this is a P1-15 evidence template body.');
    expect(rendered.subject).toBe('P1-15 evidence subject');

    // A preview changes nothing: the version is still an unapproved draft.
    const row = await versionRow(draft.versionId);
    expect(row?.status).toBe('draft');
    expect(row?.record_version).toBe(draft.recordVersion);
  });

  it('a placeholder with no supplied value is refused with ERR-VAL-001', async () => {
    const { templateId } = await createTemplate();
    const draft = await createDraft(templateId);

    const error = await withTransaction(asAdmin(), (db) =>
      templates.previewVersion(db, draft.versionId, {}).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
  });
});

// ===========================================================================
// shared.branch-status-change
// ===========================================================================
describe('shared.branch-status-change', () => {
  it('moves active -> inactive with module-owned history, one audit record and one event', async () => {
    const branchId = await seedBranch();

    const result = await withTransaction(asAdmin(), (db) =>
      transitions.apply(db, {
        aggregate: 'org.branch',
        id: branchId,
        to: 'inactive',
        reason: 'fx-p15 deactivated by the evidence suite',
        expectedVersion: 1,
      })
    );

    expect(result.from).toBe('active');
    expect(result.to).toBe('inactive');
    expect(result.recordVersion).toBe(2);
    expect(result.nextStates).toEqual(['active']);

    const branch = await branchRow(branchId);
    expect(branch?.status).toBe('inactive');
    expect(branch?.record_version).toBe(2);

    // The history is the aggregate module's own table, not a generic one.
    const history = await admin.query<{
      from_state: string | null;
      to_state: string;
      reason: string;
      actor_id: string;
      correlation_id: string | null;
    }>(
      `SELECT from_state, to_state, reason, actor_id, correlation_id
         FROM org.branch_status_history WHERE branch_id = $1`,
      [branchId]
    );
    expect(history.rowCount).toBe(1);
    expect(history.rows[0]?.from_state).toBe('active');
    expect(history.rows[0]?.to_state).toBe('inactive');
    expect(history.rows[0]?.reason).toBe('fx-p15 deactivated by the evidence suite');
    // `org.stamp_branch_history()` overwrites actor and timestamp from the
    // session, so the attribution cannot be supplied by the caller.
    expect(history.rows[0]?.actor_id).toBe(U_ADMIN);
    expect(history.rows[0]?.correlation_id).not.toBeNull();

    expect(await auditCount('org.branch.status_changed', branchId)).toBe(1);
    expect(await outboxCount(`org.branch:${branchId}:2`)).toBe(1);
  });

  it('a repeat of the same target state is refused with ERR-TRN-001', async () => {
    const branchId = await seedBranch();
    await withTransaction(asAdmin(), (db) =>
      transitions.apply(db, {
        aggregate: 'org.branch',
        id: branchId,
        to: 'inactive',
        reason: 'first deactivation',
        expectedVersion: 1,
      })
    );

    const error = await withTransaction(asAdmin(), (db) =>
      transitions
        .apply(db, {
          aggregate: 'org.branch',
          id: branchId,
          to: 'inactive',
          reason: 'second deactivation',
          expectedVersion: 2,
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-TRN-001');
    // Nothing was written twice: one history row, one audit record, one event.
    expect(await countRows(admin, 'org.branch_status_history', 'branch_id = $1', [branchId])).toBe(
      1
    );
    expect(await auditCount('org.branch.status_changed', branchId)).toBe(1);
    expect(await outboxCount(`org.branch:${branchId}:2`)).toBe(1);
  });

  it('stale-version: a wrong record_version is refused (ERR-CON-001) and writes no history', async () => {
    const branchId = await seedBranch();

    const error = await withTransaction(asAdmin(), (db) =>
      transitions
        .apply(db, {
          aggregate: 'org.branch',
          id: branchId,
          to: 'inactive',
          reason: 'stale attempt',
          expectedVersion: 999,
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
    expect((await branchRow(branchId))?.status).toBe('active');
    expect(await countRows(admin, 'org.branch_status_history', 'branch_id = $1', [branchId])).toBe(
      0
    );
    expect(await auditCount('org.branch.status_changed', branchId)).toBe(0);
  });

  it('an unregistered target state is refused with ERR-VAL-001', async () => {
    const branchId = await seedBranch();

    const error = await withTransaction(asAdmin(), (db) =>
      transitions
        .apply(db, {
          aggregate: 'org.branch',
          id: branchId,
          to: 'archived',
          reason: 'unregistered target',
          expectedVersion: 1,
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
    expect((await branchRow(branchId))?.status).toBe('active');
  });

  it('an unregistered aggregate is refused with ERR-VAL-001', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      transitions
        .apply(db, {
          aggregate: 'zz.not_an_aggregate',
          id: randomUUID(),
          to: 'inactive',
          reason: 'unregistered aggregate',
          expectedVersion: 1,
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
  });

  it('a blank reason is refused with ERR-VAL-001 before anything is written', async () => {
    const branchId = await seedBranch();

    const error = await withTransaction(asAdmin(), (db) =>
      transitions
        .apply(db, {
          aggregate: 'org.branch',
          id: branchId,
          to: 'inactive',
          reason: '   ',
          expectedVersion: 1,
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
    expect((await branchRow(branchId))?.status).toBe('active');
  });

  it('denial: the operation gate refuses a principal without org.settings.manage (ERR-IAM-001)', async () => {
    const branchId = await seedBranch();

    // `upd_branches_scope` predicates SCOPE, not permission — so the
    // org.settings.manage requirement lives in the operation declaration, and
    // this is the same database-evaluated check `handleOperation` performs.
    const error = await withTransaction(asUnpriv(), (db) =>
      requirePermissions(db, BRANCH_STATUS_CHANGE_OPERATION, { branchId }).catch((e: unknown) => e)
    );
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-IAM-001');

    // …and the permitted administrator passes the same gate, so the assertion
    // above is about the principal rather than about a gate that always denies.
    await expect(
      withTransaction(asAdmin(), (db) =>
        requirePermissions(db, BRANCH_STATUS_CHANGE_OPERATION, { branchId })
      )
    ).resolves.toBeUndefined();
  });

  it('isolation: a branch outside the caller scope is invisible and cannot be transitioned', async () => {
    const target = await seedBranch();
    const other = await seedBranch();

    // The SAME administrator, narrowed to a different branch. Nothing about the
    // permission changed — only the scope the request runs under.
    const error = await withTransaction(asBranchScoped(other), (db) =>
      transitions
        .apply(db, {
          aggregate: 'org.branch',
          id: target,
          to: 'inactive',
          reason: 'out-of-scope attempt',
          expectedVersion: 1,
        })
        .catch((e: unknown) => e)
    );
    // Out of scope and non-existent are deliberately indistinguishable.
    expect((error as AppFailure).code).toBe('ERR-RES-001');
    expect((await branchRow(target))?.status).toBe('active');
    expect(await countRows(admin, 'org.branch_status_history', 'branch_id = $1', [target])).toBe(0);
    expect(await auditCount('org.branch.status_changed', target)).toBe(0);
  });
});

// ===========================================================================
// shared.branch-status-read
// ===========================================================================
describe('shared.branch-status-read', () => {
  it('returns the current state and the states reachable from it', async () => {
    const branchId = await seedBranch();

    const before = await withTransaction(asAdmin(), (db) =>
      transitions.describe(db, 'org.branch', branchId)
    );
    expect(before.state).toBe('active');
    expect(before.recordVersion).toBe(1);
    expect(before.nextStates).toEqual(['inactive']);

    await withTransaction(asAdmin(), (db) =>
      transitions.apply(db, {
        aggregate: 'org.branch',
        id: branchId,
        to: 'inactive',
        reason: 'so the read reflects a real change',
        expectedVersion: 1,
      })
    );

    const after = await withTransaction(asAdmin(), (db) =>
      transitions.describe(db, 'org.branch', branchId)
    );
    expect(after.state).toBe('inactive');
    expect(after.recordVersion).toBe(2);
    expect(after.nextStates).toEqual(['active']);

    // The read operation declares its own permission; the permitted principal
    // passes the same gate the pipeline applies.
    await expect(
      withTransaction(asAdmin(), (db) =>
        requirePermissions(db, BRANCH_STATUS_READ_OPERATION, { branchId })
      )
    ).resolves.toBeUndefined();
  });
});

// ===========================================================================
// shared.export-authorize
// ===========================================================================
describe('shared.export-authorize', () => {
  it('authorizes an export for a caller holding both permissions and writes an export audit record', async () => {
    const auditBefore = await exportAuditCount();

    const authorization = await withTransaction(asAdmin(), (db) =>
      exportAuthorization.authorize(db, {
        resource: 'branches',
        fields: [],
        filters: [{ field: 'status', operator: 'eq', value: 'active' }],
        reason: 'fx-p15 evidence: operational branch reporting',
      })
    );

    expect(authorization.resource).toBe('branches');
    // No file is produced by this phase, and the response says so.
    expect(authorization.generated).toBe(false);
    expect(authorization.maxRows).toBe(50_000);
    expect(authorization.estimatedRows).toBeGreaterThanOrEqual(1);
    expect(new Date(authorization.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(authorization.fields).toContain('branchCode');
    // Free-text columns are flagged for the generator that will eventually
    // write a CSV; P1-15 writes none, so this is advisory metadata only.
    expect(authorization.formulaRiskyFields).toContain('name');

    expect(await exportAuditCount()).toBe(auditBefore + 1);
  });

  it('denial: a caller holding neither permission is refused with ERR-IAM-001', async () => {
    const auditBefore = await exportAuditCount();

    const error = await withTransaction(asUnpriv(), (db) =>
      exportAuthorization
        .authorize(db, {
          resource: 'branches',
          fields: [],
          filters: [],
          reason: 'no entitlement at all',
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect((error as AppFailure).message).toBe('Export is not permitted for this caller');
    // A refused authorization is not an authorization: nothing is audited.
    expect(await exportAuditCount()).toBe(auditBefore);
  });

  it('denial: holding rpt.export without the resource permission gives the SAME refusal', async () => {
    const error = await withTransaction(asExportOnly(), (db) =>
      exportAuthorization
        .authorize(db, {
          resource: 'branches',
          fields: [],
          filters: [],
          reason: 'export switch only',
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    // Byte-identical to the "neither permission" message above: which of the two
    // permissions is missing is deliberately not disclosed.
    expect((error as AppFailure).message).toBe('Export is not permitted for this caller');
  });

  it('denial: the operation gate refuses a principal without rpt.export (ERR-IAM-001)', async () => {
    const error = await withTransaction(asUnpriv(), (db) =>
      requirePermissions(db, EXPORT_AUTHORIZE_OPERATION).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('an unregistered resource is refused with ERR-VAL-001', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      exportAuthorization
        .authorize(db, {
          resource: 'iam_user_accounts',
          fields: [],
          filters: [],
          reason: 'not exportable',
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
  });

  it('an unregistered field is refused with ERR-VAL-001', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      exportAuthorization
        .authorize(db, {
          resource: 'branches',
          fields: ['branchCode', 'secretColumn'],
          filters: [],
          reason: 'field not in the allow-list',
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
  });

  it('a sensitive field without iam.sensitive.view is refused with ERR-IAM-001', async () => {
    // The caller holds rpt.export AND shared.notification.send, so the resource
    // gate passes and the refusal is unambiguously about the FIELD.
    const error = await withTransaction(asAdmin(), (db) =>
      exportAuthorization
        .authorize(db, {
          resource: 'outbound_messages',
          fields: ['id', 'recipientUserId'],
          filters: [],
          reason: 'sensitive field probe',
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect((error as AppFailure).message).toBe('Requested fields require additional permission');

    // And an unqualified request does not smuggle it in by omission: the default
    // field set is "every field the caller may read", not "every field".
    const authorization = await withTransaction(asAdmin(), (db) =>
      exportAuthorization.authorize(db, {
        resource: 'outbound_messages',
        fields: [],
        filters: [],
        reason: 'default field set probe',
      })
    );
    expect(authorization.fields).not.toContain('recipientUserId');
    expect(authorization.fields).not.toContain('dedupeKey');
    expect(authorization.fields).toContain('status');
  });

  it('a blank reason is refused with ERR-VAL-001', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      exportAuthorization
        .authorize(db, { resource: 'branches', fields: [], filters: [], reason: '   ' })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
  });
});

// ===========================================================================
// shared.export-catalogue
// ===========================================================================
describe('shared.export-catalogue', () => {
  it('lists the registered resources and their fields', async () => {
    const catalogue = exportAuthorization.catalogue();
    const codes = catalogue.map((entry) => entry.code).sort();
    expect(codes).toEqual(['branches', 'documents', 'outbound_messages']);

    const branches = catalogue.find((entry) => entry.code === 'branches');
    expect(branches?.fields).toContain('branchCode');
    expect(branches?.description.length).toBeGreaterThan(0);

    // Sensitive field NAMES appear — a caller must know a field exists to ask
    // for the permission — while the values stay unreachable (proved above).
    const messages = catalogue.find((entry) => entry.code === 'outbound_messages');
    expect(messages?.fields).toContain('recipientUserId');
    // Withheld by construction: a storage key or an integrity digest is not
    // exportable at all, so it is absent from every registry entry.
    const documents = catalogue.find((entry) => entry.code === 'documents');
    expect(documents?.fields).not.toContain('storageKey');
    expect(documents?.fields).not.toContain('sha256');

    await expect(
      withTransaction(asAdmin(), (db) => requirePermissions(db, EXPORT_CATALOGUE_OPERATION))
    ).resolves.toBeUndefined();
  });
});
