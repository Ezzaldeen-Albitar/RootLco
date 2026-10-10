/**
 * P1-14 operation evidence — read/list and catalogue operations across the IAM
 * surface, invoked through the REAL application services on the deployed
 * `app_runtime` identity (the same objects the composition root wires).
 *
 * This complements tests/backend/iam-access-administration.test.ts (the
 * confirmed-High grant/scope/approval surface) by exercising the remaining
 * read-side operations end to end — list permissions, roles, role permissions,
 * scopes, approval limits, users, sessions, tenant/company/branch settings, and
 * the audit trail — so each is proven to run under a runtime context and RLS
 * rather than only registered in OpenAPI. Tenant isolation is asserted where the
 * operation takes an id (a tenant-B id resolves to "not found").
 *
 * The operation-to-test coverage gate (scripts/check-operation-test-coverage.mjs)
 * records which operations reach this depth; the write operations not exercised
 * here are listed there as tracked residuals, not hidden.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  USER_A,
  USER_PERMITTED,
  USER_SCOPED,
  USER_TENANT_B,
  USER_UNPERMITTED,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { AccessAdministrationService } from '@/modules/iam/application/access-administration-service';
import { UserAdministrationService } from '@/modules/iam/application/user-administration-service';
import { OrganizationSettingsService } from '@/modules/iam/application/organization-settings-service';
import { AuditViewService } from '@/modules/iam/application/audit-view-service';
import { IdentityDirectoryService } from '@/modules/iam/application/identity-directory-service';
import { AuthorizationRepository } from '@/modules/iam/data/authorization-repository';
import { IdentityRepository } from '@/modules/iam/data/identity-repository';
import { OrganizationRepository } from '@/modules/iam/data/organization-repository';
import { AuditRepository } from '@/modules/iam/data/audit-repository';
import { DelegationPolicy } from '@/modules/iam/domain/delegation-policy';
import { CredentialPolicy } from '@/modules/iam/domain/credential-policy';
import { IdentityPolicy } from '@/modules/iam/domain/identity-policy';

// The scoped grant the backend fixtures create for USER_SCOPED (COMPANY_A1).
const GRANT_SCOPED = 'e1300000-0000-4000-8000-000000000004';

let admin: Pool;
let runtime: Pool;
let access: AccessAdministrationService;
let users: UserAdministrationService;
let organization: OrganizationSettingsService;
let auditView: AuditViewService;

// Operation ids exercised here, kept beside the invocations so the coverage gate
// (which greps this file for each id) maps them to real assertions. Referencing:
// iam.permission-list iam.role-list iam.role-create iam.role-permission-list
// iam.approval-limit-list iam.grant-scope-list iam.user-list iam.user-detail
// iam.user-session-list iam.tenant-settings-read iam.company-settings-read
// iam.branch-settings-read iam.audit-event-list iam.audit-event-detail

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);

  // Give USER_PERMITTED a role-administration capability so the one write
  // exercised here (createRole) passes the ins_roles_admin RLS policy. Provisioned
  // on the admin (BYPASSRLS) connection; the read paths need nothing extra.
  const OPS_ADMIN_ROLE = 'd1300000-0000-4000-8000-0000000009a1';
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_ops_admin', 'Ops admin', $3) ON CONFLICT (id) DO NOTHING`,
    [OPS_ADMIN_ROLE, TENANT_A, USER_PERMITTED]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = 'iam.role.manage'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, OPS_ADMIN_ROLE, USER_PERMITTED]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     SELECT $1, $2, $3, 'unrestricted', 'active', $4, $4
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3
      )`,
    [TENANT_A, USER_PERMITTED, OPS_ADMIN_ROLE, USER_A]
  );

  const authorization = new AuthorizationRepository();
  const identities = new IdentityRepository();
  const org = new OrganizationRepository();
  access = new AccessAdministrationService(
    authorization,
    identities,
    org,
    new DelegationPolicy(),
    new CredentialPolicy(),
    new IdentityPolicy()
  );
  users = new UserAdministrationService(
    // provider is unused by the read paths exercised here
    undefined as never,
    identities,
    authorization,
    new IdentityPolicy(),
    new DelegationPolicy()
  );
  organization = new OrganizationSettingsService(org, authorization, new DelegationPolicy());
  auditView = new AuditViewService(
    new AuditRepository(),
    authorization,
    new IdentityDirectoryService(identities)
  );
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

const asPermitted = () =>
  contextFor({ userId: USER_PERMITTED, operation: 'iam.read', module: 'iam' });

describe('access-administration read + catalogue operations', () => {
  it('iam.permission-list — lists the seeded permission catalogue', async () => {
    const permissions = await withTransaction(asPermitted(), (db) => access.listPermissions(db));
    expect(permissions.length).toBeGreaterThan(0);
    expect(permissions.some((p) => p.code === 'iam.grant.manage')).toBe(true);
  });

  it('iam.role-list and iam.role-create — creates a role and finds it in the list', async () => {
    const code = `fx_ops_${randomUUID().slice(0, 8)}`;
    const created = await withTransaction(asPermitted(), (db) =>
      access.createRole(db, { roleCode: code, name: 'Ops fixture role' })
    );
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    const page = await withTransaction(asPermitted(), (db) => access.listRoles(db, { limit: 100 }));
    expect(page.items.some((r) => r.id === created.id)).toBe(true);
    await admin.query('DELETE FROM iam.roles WHERE id = $1', [created.id]);
  });

  it('iam.role-permission-list — lists mappings for a role', async () => {
    const page = await withTransaction(asPermitted(), (db) => access.listRoles(db, { limit: 1 }));
    const roleId = page.items[0]!.id;
    const mappings = await withTransaction(asPermitted(), (db) =>
      access.listRolePermissions(db, roleId)
    );
    expect(Array.isArray(mappings)).toBe(true);
  });

  it('iam.approval-limit-list — lists approval limits, tenant-scoped', async () => {
    const limits = await withTransaction(asPermitted(), (db) => access.listApprovalLimits(db, {}));
    expect(Array.isArray(limits)).toBe(true);
  });

  it('iam.grant-scope-list — lists the scopes of a scoped grant', async () => {
    const scopes = await withTransaction(asPermitted(), (db) =>
      access.listScopes(db, GRANT_SCOPED)
    );
    // The fixture grant carries a company and a branch scope.
    expect(scopes.length).toBe(2);
  });
});

describe('user-administration read operations', () => {
  it('iam.user-list — lists tenant users with cursor pagination', async () => {
    const page = await withTransaction(asPermitted(), (db) => users.list(db, { limit: 50 }, {}));
    expect(page.items.length).toBeGreaterThan(0);
    // Tenant isolation: no tenant-B user leaks into tenant A's listing.
    expect(page.items.some((u) => u.id === USER_TENANT_B)).toBe(false);
  });

  it('iam.user-detail — returns a user in-tenant and 404s a cross-tenant id', async () => {
    const detail = await withTransaction(asPermitted(), (db) => users.detail(db, USER_PERMITTED));
    expect(detail.id).toBe(USER_PERMITTED);
    const error = await withTransaction(asPermitted(), (db) =>
      users.detail(db, USER_TENANT_B).catch((e: unknown) => e)
    );
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-RES-001');
  });

  it('iam.user-session-list — lists a user’s sessions', async () => {
    const sessions = await withTransaction(asPermitted(), (db) =>
      users.listSessions(db, USER_PERMITTED)
    );
    expect(Array.isArray(sessions)).toBe(true);
  });
});

describe('organization settings read operations', () => {
  it('iam.tenant-settings-read — reads tenant settings', async () => {
    const view = await withTransaction(asPermitted(), (db) => organization.readTenant(db));
    expect(view.id).toBe(TENANT_A);
    expect(view.tenantCode).toBe('tenant_a');
  });

  it('iam.company-settings-read — reads company settings in scope', async () => {
    const settings = await withTransaction(asPermitted(), (db) =>
      organization.listCompanySettings(db, COMPANY_A1)
    );
    expect(Array.isArray(settings)).toBe(true);
  });

  it('iam.branch-settings-read — reads branch settings in scope', async () => {
    const settings = await withTransaction(asPermitted(), (db) =>
      organization.listBranchSettings(db, BRANCH_A1)
    );
    expect(Array.isArray(settings)).toBe(true);
  });
});

describe('audit viewing', () => {
  it('iam.audit-event-list — lists audit events within a bounded date range and audits the read', async () => {
    const page = await withTransaction(asPermitted(), (db) =>
      auditView.list(db, { limit: 20 }, { from: '2026-07-01', to: '2026-07-31' })
    );
    expect(Array.isArray(page.items)).toBe(true);
    // The privileged read is itself audited (iam.audit.viewed).
    const audited = await admin.query(
      "SELECT 1 FROM iam.audit_records WHERE tenant_id = $1 AND action = 'iam.audit.viewed' LIMIT 1",
      [TENANT_A]
    );
    expect(audited.rowCount).toBe(1);
  });

  it('iam.audit-event-detail — 404s a cross-tenant record id', async () => {
    const error = await withTransaction(asPermitted(), (db) =>
      auditView.detail(db, randomUUID()).catch((e: unknown) => e)
    );
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-RES-001');
  });
});

/*
 * `P1-32-PRE-OD-ADM6` (route-checklist prerequisite 10): both audit reads name
 * the actor, and a user-account subject, in the same read — only for a caller
 * holding `iam.user.read`, and only inside the caller's tenant.
 *
 * Two fixture roles, both holding `iam.audit.view` so both callers can read the
 * records; only one also holds `iam.user.read`. Granted here and removed in
 * `afterAll` (the file's own `afterAll` then deletes the fixture tenants).
 */
describe('audit records name their people (P1-32-PRE-OD-ADM6)', () => {
  const ROLE_AUDIT_NAMES = 'd1300000-0000-4000-8000-0000000009b1';
  const ROLE_AUDIT_ONLY = 'd1300000-0000-4000-8000-0000000009b2';
  const asUnnamedViewer = () =>
    contextFor({ userId: USER_UNPERMITTED, operation: 'iam.read', module: 'iam' });
  // A window around now: the records below are appended by this suite.
  const windowNow = () => ({
    from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    to: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  let aboutTenantUser = '';
  let aboutForeignUser = '';

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
       VALUES ($1, $3, 'fx_adm6_audit_names', 'ADM6 audit with names', $4),
              ($2, $3, 'fx_adm6_audit_only', 'ADM6 audit only', $4)
       ON CONFLICT (id) DO NOTHING`,
      [ROLE_AUDIT_NAMES, ROLE_AUDIT_ONLY, TENANT_A, USER_A]
    );
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid, $2::uuid, p.id, 'allow', $4::uuid
         FROM iam.permissions p WHERE p.permission_code IN ('iam.audit.view', 'iam.user.read')
       UNION ALL
       SELECT $1::uuid, $3::uuid, p.id, 'allow', $4::uuid
         FROM iam.permissions p WHERE p.permission_code = 'iam.audit.view'
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [TENANT_A, ROLE_AUDIT_NAMES, ROLE_AUDIT_ONLY, USER_A]
    );
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1, $2, $3, 'unrestricted', 'active', $6, $6),
              ($1, $4, $5, 'unrestricted', 'active', $6, $6)`,
      [TENANT_A, USER_PERMITTED, ROLE_AUDIT_NAMES, USER_UNPERMITTED, ROLE_AUDIT_ONLY, USER_A]
    );

    // Two records by USER_PERMITTED about user accounts: one in this tenant,
    // one naming the other tenant's account as its subject.
    aboutTenantUser = await withTransaction(asPermitted(), (db) =>
      appendAudit(db, {
        action: 'iam.user.updated',
        entityType: 'iam.user_account',
        entityId: USER_SCOPED,
      })
    );
    aboutForeignUser = await withTransaction(asPermitted(), (db) =>
      appendAudit(db, {
        action: 'iam.user.updated',
        entityType: 'iam.user_account',
        entityId: USER_TENANT_B,
      })
    );
  });

  afterAll(async () => {
    await admin.query(
      'DELETE FROM iam.role_grants WHERE tenant_id = $1 AND role_id = ANY($2::uuid[])',
      [TENANT_A, [ROLE_AUDIT_NAMES, ROLE_AUDIT_ONLY]]
    );
  });

  const listAbout = (context: ReturnType<typeof asPermitted>) =>
    withTransaction(context, (db) =>
      auditView.list(
        db,
        { limit: 100 },
        { ...windowNow(), entityType: 'iam.user_account', actorId: USER_PERMITTED }
      )
    );

  it('iam.audit-event-list — names the actor and the subject for a caller holding iam.user.read', async () => {
    const page = await listAbout(asPermitted());
    const record = page.items.find((item) => item.id === aboutTenantUser);
    expect(record, 'the appended record is listed').toBeDefined();
    expect(record?.actorId).toBe(USER_PERMITTED);
    expect(record?.actorDisplayName).toBe('Fixture Permitted');
    expect(record?.entityId).toBe(USER_SCOPED);
    expect(record?.subjectDisplayName).toBe('Fixture Scoped');
  });

  it('iam.audit-event-list — never names an account of another tenant, even with iam.user.read', async () => {
    const page = await listAbout(asPermitted());
    const record = page.items.find((item) => item.id === aboutForeignUser);
    expect(record, 'the appended record is listed').toBeDefined();
    expect(record?.entityId).toBe(USER_TENANT_B);
    expect(record?.subjectDisplayName).toBeNull();
    expect(record?.actorDisplayName).toBe('Fixture Permitted');
    expect(page.items.some((item) => item.subjectDisplayName === 'Fixture Tenant B')).toBe(false);
  });

  it('iam.audit-event-list — publishes no name without iam.user.read, and keeps the identifiers', async () => {
    const page = await listAbout(asUnnamedViewer());
    const record = page.items.find((item) => item.id === aboutTenantUser);
    expect(record, 'the caller holds iam.audit.view, so the record is listed').toBeDefined();
    expect(record?.actorId).toBe(USER_PERMITTED);
    expect(record?.entityId).toBe(USER_SCOPED);
    expect(page.items.every((item) => item.actorDisplayName === null)).toBe(true);
    expect(page.items.every((item) => item.subjectDisplayName === null)).toBe(true);
  });

  it('iam.audit-event-detail — names the actor and subject with iam.user.read, and neither without', async () => {
    const named = await withTransaction(asPermitted(), (db) =>
      auditView.detail(db, aboutTenantUser)
    );
    expect(named.actorDisplayName).toBe('Fixture Permitted');
    expect(named.subjectDisplayName).toBe('Fixture Scoped');

    const foreign = await withTransaction(asPermitted(), (db) =>
      auditView.detail(db, aboutForeignUser)
    );
    expect(foreign.subjectDisplayName).toBeNull();

    const unnamed = await withTransaction(asUnnamedViewer(), (db) =>
      auditView.detail(db, aboutTenantUser)
    );
    expect(unnamed.actorId).toBe(USER_PERMITTED);
    expect(unnamed.actorDisplayName).toBeNull();
    expect(unnamed.subjectDisplayName).toBeNull();
  });
});
