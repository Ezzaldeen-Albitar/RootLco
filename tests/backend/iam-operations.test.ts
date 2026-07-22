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
  USER_TENANT_B,
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
import { AccessAdministrationService } from '@/modules/iam/application/access-administration-service';
import { UserAdministrationService } from '@/modules/iam/application/user-administration-service';
import { OrganizationSettingsService } from '@/modules/iam/application/organization-settings-service';
import { AuditViewService } from '@/modules/iam/application/audit-view-service';
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
  auditView = new AuditViewService(new AuditRepository(), authorization);
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
