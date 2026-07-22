/**
 * P1-14 operation evidence — the administrative WRITE surface that was
 * previously registered but never invoked below the OpenAPI layer (residual
 * R-9). Every operation here is driven through the REAL application service on
 * the deployed `app_runtime` identity — `withTransaction(ctx, db => svc.method(db,
 * …))` — so RLS, the runtime DB role, the transaction wrapper, and the
 * audit/outbox path are all genuinely exercised. This is acceptance evidence.
 *
 * For each mutation the suite proves the properties the strict coverage gate
 * requires of it: a success path with an audit assertion; a fail-closed denial
 * for a principal that lacks the governing permission (RLS, not a code check); a
 * cross-tenant / out-of-scope refusal where the operation takes an id; an
 * optimistic-concurrency (stale-version) refusal for versioned mutations; and an
 * atomic outbox event for operations that publish one.
 *
 * Operations exercised here (coverage-gate references):
 *   iam.role-update  iam.role-permission-add  iam.role-permission-update
 *   iam.role-permission-remove  iam.user-update  iam.user-status-change
 *   iam.user-session-revoke-all  iam.tenant-settings-update
 *   iam.company-settings-write  iam.branch-settings-write  iam.approval-limit-end
 *
 * COVERAGE-EVIDENCE (machine-checked by scripts/check-operation-test-coverage.mjs):
 *   iam.role-update: success denial cross-tenant audit stale-version
 *   iam.role-permission-add: success denial audit
 *   iam.role-permission-update: success denial audit stale-version
 *   iam.role-permission-remove: success denial audit
 *   iam.user-update: success denial cross-tenant audit stale-version
 *   iam.user-status-change: success denial audit outbox
 *   iam.user-session-revoke-all: success denial audit outbox idempotency
 *   iam.tenant-settings-update: success denial audit stale-version
 *   iam.company-settings-write: success audit isolation
 *   iam.branch-settings-write: success audit isolation
 *   iam.approval-limit-end: success denial audit stale-version
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
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
import { FakeIdentityProvider } from '@/modules/iam';
import { AccessAdministrationService } from '@/modules/iam/application/access-administration-service';
import { UserAdministrationService } from '@/modules/iam/application/user-administration-service';
import { OrganizationSettingsService } from '@/modules/iam/application/organization-settings-service';
import { AuthorizationRepository } from '@/modules/iam/data/authorization-repository';
import { IdentityRepository } from '@/modules/iam/data/identity-repository';
import { OrganizationRepository } from '@/modules/iam/data/organization-repository';
import { DelegationPolicy } from '@/modules/iam/domain/delegation-policy';
import { CredentialPolicy } from '@/modules/iam/domain/credential-policy';
import { IdentityPolicy } from '@/modules/iam/domain/identity-policy';

// Actors and objects (tenant A unless noted). Distinct id space from the other
// backend suites so concurrent fixtures never collide.
const U_WADMIN = 'a2000000-0000-4000-8000-000000000001';
const U_TARGET = 'a2000000-0000-4000-8000-000000000002';
const WADMIN_ROLE = 'a2100000-0000-4000-8000-000000000001';
const ROLE_TARGET = 'a2100000-0000-4000-8000-000000000002';
const ROLE_B = 'a2100000-0000-4000-8000-0000000000b1'; // tenant B, for cross-tenant proof
const COMPANY_C2 = 'a2300000-0000-4000-8000-000000000001';

const WADMIN_PERMISSIONS = [
  'iam.role.manage',
  'iam.user.manage',
  'iam.approval.manage',
  'org.settings.manage',
  'iam.user.read',
  'iam.session.view_all',
];

let admin: Pool;
let runtime: Pool;
let access: AccessAdministrationService;
let users: UserAdministrationService;
let organization: OrganizationSettingsService;

const asAdmin = (over: { companyIds?: string[]; branchIds?: string[] } = {}) =>
  contextFor({
    userId: U_WADMIN,
    operation: 'iam.admin-write',
    module: 'iam',
    ...(over.companyIds ? { companyIds: over.companyIds } : {}),
    ...(over.branchIds ? { branchIds: over.branchIds } : {}),
  });
const asUnpriv = () =>
  contextFor({ userId: USER_UNPERMITTED, operation: 'iam.admin-write', module: 'iam' });

/** Inserts an ephemeral live session for a user and returns its ref. */
async function seedSession(userId: string): Promise<string> {
  const ref = randomUUID();
  await admin.query(
    `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, last_seen_at, created_by)
     VALUES ($1,$2,$3, now(), $2)`,
    [TENANT_A, userId, ref]
  );
  return ref;
}

async function currentRoleVersion(roleId: string): Promise<number> {
  const r = await admin.query<{ record_version: number }>(
    'SELECT record_version FROM iam.roles WHERE id = $1',
    [roleId]
  );
  return r.rows[0]!.record_version;
}
async function currentUserVersion(userId: string): Promise<number> {
  const r = await admin.query<{ record_version: number }>(
    'SELECT record_version FROM iam.user_accounts WHERE id = $1',
    [userId]
  );
  return r.rows[0]!.record_version;
}

async function seedStructure(): Promise<void> {
  // A second company for the settings out-of-scope (isolation) proof.
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_c2','Company C2','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_C2, TENANT_A, USER_A]
  );
  // Actors.
  for (const [id, subject, email] of [
    [U_WADMIN, 'fx_aw_wadmin', 'fx-aw-wadmin@example.test'],
    [U_TARGET, 'fx_aw_target', 'fx-aw-target@example.test'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,'test_harness',$3,$4,'AW Fixture','active',$5) ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, subject, email, USER_A]
    );
  }
  // Admin role with the full write-permission set, granted unrestricted.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_aw_admin','AW admin',$3) ON CONFLICT (id) DO NOTHING`,
    [WADMIN_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1,$2,id,'allow',$3 FROM iam.permissions WHERE permission_code = ANY($4::text[])
     ON CONFLICT DO NOTHING`,
    [TENANT_A, WADMIN_ROLE, USER_A, WADMIN_PERMISSIONS]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     SELECT $1,$2,$3,'unrestricted','active',$4,$4
      WHERE NOT EXISTS (SELECT 1 FROM iam.role_grants WHERE tenant_id=$1 AND user_id=$2 AND role_id=$3)`,
    [TENANT_A, U_WADMIN, WADMIN_ROLE, USER_A]
  );
  // A plain, non-system target role in tenant A.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_aw_target_role','AW target role',$3) ON CONFLICT (id) DO NOTHING`,
    [ROLE_TARGET, TENANT_A, USER_A]
  );
  // A tenant-B role, used only to prove cross-tenant refusal.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_aw_role_b','AW role B',$3) ON CONFLICT (id) DO NOTHING`,
    [ROLE_B, TENANT_B, USER_A]
  );
}

async function cleanStructure(): Promise<void> {
  await admin.query('DELETE FROM iam.role_grants WHERE user_id = ANY($1::uuid[])', [
    [U_WADMIN, U_TARGET],
  ]);
  await admin.query('DELETE FROM iam.role_permissions WHERE role_id = ANY($1::uuid[])', [
    [WADMIN_ROLE, ROLE_TARGET],
  ]);
  await admin.query('DELETE FROM iam.approval_limits WHERE user_id = ANY($1::uuid[])', [
    [U_TARGET],
  ]);
  await admin.query('DELETE FROM iam.user_sessions WHERE user_id = ANY($1::uuid[])', [
    [U_WADMIN, U_TARGET],
  ]);
  await admin.query('DELETE FROM iam.user_status_history WHERE user_id = ANY($1::uuid[])', [
    [U_TARGET],
  ]);
  await admin.query('DELETE FROM iam.roles WHERE id = ANY($1::uuid[])', [
    [WADMIN_ROLE, ROLE_TARGET, ROLE_B],
  ]);
  await admin.query('DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])', [
    [U_WADMIN, U_TARGET],
  ]);
  await admin.query('DELETE FROM org.company_settings WHERE company_id = ANY($1::uuid[])', [
    [COMPANY_A1, COMPANY_C2],
  ]);
  await admin.query('DELETE FROM org.branch_settings WHERE branch_id = ANY($1::uuid[])', [
    [BRANCH_A1],
  ]);
}

beforeAll(async () => {
  __resetBackendConfigForTests();
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);

  const provider = new FakeIdentityProvider({
    secret: 'iam-admin-writes-secret-not-real',
    issuer: 'https://auth.test.local/auth/v1',
    audience: 'authenticated',
  });
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
    provider,
    identities,
    authorization,
    new IdentityPolicy(),
    new DelegationPolicy()
  );
  organization = new OrganizationSettingsService(org, authorization, new DelegationPolicy());
});

beforeEach(async () => {
  await cleanStructure();
  await seedStructure();
});

afterEach(async () => {
  await cleanStructure();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await admin.query('DELETE FROM org.legal_companies WHERE id = $1', [COMPANY_C2]);
  await cleanBackendFixtures(admin);
  await admin.end();
});

// ===========================================================================
// iam.role-update
// ===========================================================================
describe('iam.role-update', () => {
  it('renames a role, writes an audit record, and reflects the new name', async () => {
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'iam.role.updated' AND entity_id = $1",
      [ROLE_TARGET]
    );
    const version = await currentRoleVersion(ROLE_TARGET);
    const updated = await withTransaction(asAdmin(), (db) =>
      access.updateRole(db, ROLE_TARGET, version, { name: 'AW target role renamed' })
    );
    expect(updated.name).toBe('AW target role renamed');
    expect(
      await countRows(
        admin,
        'iam.audit_records',
        "action = 'iam.role.updated' AND entity_id = $1",
        [ROLE_TARGET]
      )
    ).toBe(auditBefore + 1);
  });

  it('denial: a principal without iam.role.manage cannot update the role', async () => {
    const version = await currentRoleVersion(ROLE_TARGET);
    const error = await withTransaction(asUnpriv(), (db) =>
      access.updateRole(db, ROLE_TARGET, version, { name: 'nope' }).catch((e: unknown) => e)
    );
    expect(error).toBeInstanceOf(AppFailure);
    // 0 rows updated under RLS is indistinguishable from a stale version.
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });

  it('cross-tenant: a tenant-A administrator cannot update a tenant-B role', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      access.updateRole(db, ROLE_B, 1, { name: 'nope' }).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
  });

  it('stale-version: a wrong record_version is refused (ERR-CON-001)', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      access.updateRole(db, ROLE_TARGET, 999, { name: 'nope' }).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });
});

// ===========================================================================
// iam.role-permission-add / -update / -remove
// ===========================================================================
describe('iam.role-permission-add', () => {
  it('adds a delegable allow mapping and audits it', async () => {
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'iam.role.permission_added'",
      []
    );
    const result = await withTransaction(asAdmin(), (db) =>
      access.addRolePermission(db, ROLE_TARGET, {
        permissionCode: 'iam.user.read',
        effect: 'allow',
      })
    );
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await countRows(admin, 'iam.audit_records', "action = 'iam.role.permission_added'", [])
    ).toBe(auditBefore + 1);
  });

  it('denial: a principal without iam.role.manage cannot add a mapping', async () => {
    const error = await withTransaction(asUnpriv(), (db) =>
      access
        .addRolePermission(db, ROLE_TARGET, { permissionCode: 'iam.user.read', effect: 'deny' })
        .catch((e: unknown) => e)
    );
    // deny does not require holding the permission, so the RLS role.manage check
    // is what refuses — surfaced as an insufficient-privilege driver error.
    expect((error as { code?: string }).code).toBe('42501');
  });
});

describe('iam.role-permission-update', () => {
  async function addMapping(): Promise<{ id: string }> {
    return withTransaction(asAdmin(), (db) =>
      access.addRolePermission(db, ROLE_TARGET, {
        permissionCode: 'iam.user.read',
        effect: 'allow',
      })
    );
  }
  async function mappingVersion(mappingId: string): Promise<number> {
    const r = await admin.query<{ record_version: number }>(
      'SELECT record_version FROM iam.role_permissions WHERE id = $1',
      [mappingId]
    );
    return r.rows[0]!.record_version;
  }

  it('changes a mapping effect and audits it', async () => {
    const { id } = await addMapping();
    const version = await mappingVersion(id);
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'iam.role.permission_changed' AND entity_id = $1",
      [id]
    );
    await withTransaction(asAdmin(), (db) =>
      access.changeRolePermissionEffect(db, ROLE_TARGET, id, version, 'deny')
    );
    const effect = await admin.query<{ effect: string }>(
      'SELECT effect FROM iam.role_permissions WHERE id = $1',
      [id]
    );
    expect(effect.rows[0]?.effect).toBe('deny');
    expect(
      await countRows(
        admin,
        'iam.audit_records',
        "action = 'iam.role.permission_changed' AND entity_id = $1",
        [id]
      )
    ).toBe(auditBefore + 1);
  });

  it('stale-version: a wrong record_version is refused', async () => {
    const { id } = await addMapping();
    const error = await withTransaction(asAdmin(), (db) =>
      access.changeRolePermissionEffect(db, ROLE_TARGET, id, 999, 'deny').catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });

  it('denial: a principal without iam.role.manage cannot change a mapping effect', async () => {
    const { id } = await addMapping();
    const version = await mappingVersion(id);
    const error = await withTransaction(asUnpriv(), (db) =>
      access
        .changeRolePermissionEffect(db, ROLE_TARGET, id, version, 'deny')
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });
});

describe('iam.role-permission-remove', () => {
  it('removes a mapping and audits it', async () => {
    const { id } = await withTransaction(asAdmin(), (db) =>
      access.addRolePermission(db, ROLE_TARGET, {
        permissionCode: 'iam.user.read',
        effect: 'allow',
      })
    );
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'iam.role.permission_removed' AND entity_id = $1",
      [id]
    );
    await withTransaction(asAdmin(), (db) => access.removeRolePermission(db, ROLE_TARGET, id));
    expect(await countRows(admin, 'iam.role_permissions', 'id = $1', [id])).toBe(0);
    expect(
      await countRows(
        admin,
        'iam.audit_records',
        "action = 'iam.role.permission_removed' AND entity_id = $1",
        [id]
      )
    ).toBe(auditBefore + 1);
  });

  it('denial: a principal without iam.role.manage cannot remove a mapping', async () => {
    const { id } = await withTransaction(asAdmin(), (db) =>
      access.addRolePermission(db, ROLE_TARGET, {
        permissionCode: 'iam.user.read',
        effect: 'allow',
      })
    );
    const error = await withTransaction(asUnpriv(), (db) =>
      access.removeRolePermission(db, ROLE_TARGET, id).catch((e: unknown) => e)
    );
    // The DELETE policy refuses; the service reports it as not-found (0 rows).
    expect((error as AppFailure).code).toBe('ERR-RES-001');
    // The mapping is still there — nothing was removed.
    expect(await countRows(admin, 'iam.role_permissions', 'id = $1', [id])).toBe(1);
  });
});

// ===========================================================================
// iam.user-update
// ===========================================================================
describe('iam.user-update', () => {
  it('updates a profile field, audits it, and returns the new value', async () => {
    const version = await currentUserVersion(U_TARGET);
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'iam.user.updated' AND entity_id = $1",
      [U_TARGET]
    );
    const view = await withTransaction(asAdmin(), (db) =>
      users.updateProfile(db, U_TARGET, version, { displayName: 'Renamed Target' })
    );
    expect(view.displayName).toBe('Renamed Target');
    expect(
      await countRows(
        admin,
        'iam.audit_records',
        "action = 'iam.user.updated' AND entity_id = $1",
        [U_TARGET]
      )
    ).toBe(auditBefore + 1);
  });

  it('denial: a principal without iam.user.manage cannot update a profile', async () => {
    const version = await currentUserVersion(U_TARGET);
    const error = await withTransaction(asUnpriv(), (db) =>
      users.updateProfile(db, U_TARGET, version, { displayName: 'nope' }).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });

  it('cross-tenant: a tenant-A administrator cannot update a tenant-B user', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      users.updateProfile(db, USER_TENANT_B, 1, { displayName: 'nope' }).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
  });

  it('stale-version: a wrong record_version is refused', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      users.updateProfile(db, U_TARGET, 999, { displayName: 'nope' }).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });
});

// ===========================================================================
// iam.user-status-change
// ===========================================================================
describe('iam.user-status-change', () => {
  it('locks an active user: revokes sessions, audits, and publishes one event', async () => {
    const ref = await seedSession(U_TARGET);
    const outboxBefore = await countRows(
      admin,
      'shared.event_outbox',
      "event_type = 'user.status.changed' AND aggregate_id = $1",
      [U_TARGET]
    );
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'iam.user.locked' AND entity_id = $1",
      [U_TARGET]
    );
    const view = await withTransaction(asAdmin(), (db) =>
      users.changeStatus(db, U_TARGET, 'locked', 'Suspended pending review')
    );
    expect(view.status).toBe('locked');
    // The live session was revoked as part of losing `active`.
    const session = await admin.query<{ revoked_at: string | null }>(
      'SELECT revoked_at FROM iam.user_sessions WHERE session_ref = $1',
      [ref]
    );
    expect(session.rows[0]?.revoked_at).not.toBeNull();
    expect(
      await countRows(admin, 'iam.audit_records', "action = 'iam.user.locked' AND entity_id = $1", [
        U_TARGET,
      ])
    ).toBe(auditBefore + 1);
    expect(
      await countRows(
        admin,
        'shared.event_outbox',
        "event_type = 'user.status.changed' AND aggregate_id = $1",
        [U_TARGET]
      )
    ).toBe(outboxBefore + 1);
  });

  it('denial: a principal without iam.user.manage cannot change status', async () => {
    const error = await withTransaction(asUnpriv(), (db) =>
      users.changeStatus(db, U_TARGET, 'locked', 'nope').catch((e: unknown) => e)
    );
    expect(error).toBeInstanceOf(Error);
    // The status-history INSERT is refused under RLS (42501); nothing changed.
    const status = await admin.query<{ status: string }>(
      'SELECT status FROM iam.user_accounts WHERE id = $1',
      [U_TARGET]
    );
    expect(status.rows[0]?.status).toBe('active');
  });

  it('refuses an administrator changing their own status', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      users.changeStatus(db, U_WADMIN, 'locked', 'self').catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });
});

// ===========================================================================
// iam.user-session-revoke-all
// ===========================================================================
describe('iam.user-session-revoke-all', () => {
  it('revokes every live session, audits, publishes an event, and is idempotent', async () => {
    await seedSession(U_TARGET);
    await seedSession(U_TARGET);
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'iam.session.revoked_all' AND entity_id = $1",
      [U_TARGET]
    );
    const outboxBefore = await countRows(
      admin,
      'shared.event_outbox',
      "event_type = 'session.revoked' AND aggregate_id = $1",
      [U_TARGET]
    );
    const revoked = await withTransaction(asAdmin(), (db) =>
      users.revokeAllSessions(db, U_TARGET, 'Compromise response')
    );
    expect(revoked).toBe(2);
    expect(
      await countRows(admin, 'iam.user_sessions', 'user_id = $1 AND revoked_at IS NULL', [U_TARGET])
    ).toBe(0);
    expect(
      await countRows(
        admin,
        'iam.audit_records',
        "action = 'iam.session.revoked_all' AND entity_id = $1",
        [U_TARGET]
      )
    ).toBe(auditBefore + 1);
    expect(
      await countRows(
        admin,
        'shared.event_outbox',
        "event_type = 'session.revoked' AND aggregate_id = $1",
        [U_TARGET]
      )
    ).toBe(outboxBefore + 1);

    // Idempotency: a second revoke-all finds nothing live and revokes zero.
    const again = await withTransaction(asAdmin(), (db) =>
      users.revokeAllSessions(db, U_TARGET, 'Compromise response')
    );
    expect(again).toBe(0);
  });

  it('denial: an unprivileged principal cannot revoke another user’s sessions', async () => {
    const ref = await seedSession(U_TARGET);
    const revoked = await withTransaction(asUnpriv(), (db) =>
      users.revokeAllSessions(db, U_TARGET, 'nope')
    );
    // RLS protected the row: zero revoked, and the session is still live.
    expect(revoked).toBe(0);
    const session = await admin.query<{ revoked_at: string | null }>(
      'SELECT revoked_at FROM iam.user_sessions WHERE session_ref = $1',
      [ref]
    );
    expect(session.rows[0]?.revoked_at).toBeNull();
  });
});

// ===========================================================================
// iam.tenant-settings-update
// ===========================================================================
describe('iam.tenant-settings-update', () => {
  it('updates a tenant setting field and audits it', async () => {
    const before = await withTransaction(asAdmin(), (db) => organization.readTenant(db));
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'org.tenant.settings_updated'",
      []
    );
    const updated = await withTransaction(asAdmin(), (db) =>
      organization.updateTenant(db, before.recordVersion, { displayName: 'Tenant A Renamed' })
    );
    expect(updated.displayName).toBe('Tenant A Renamed');
    expect(
      await countRows(admin, 'iam.audit_records', "action = 'org.tenant.settings_updated'", [])
    ).toBe(auditBefore + 1);
    // Restore the display name so the shared tenant fixture is left as found.
    await withTransaction(asAdmin(), (db) =>
      organization.updateTenant(db, updated.recordVersion, { displayName: before.displayName })
    );
  });

  it('denial: a principal without org.settings.manage cannot update tenant settings', async () => {
    const before = await withTransaction(asAdmin(), (db) => organization.readTenant(db));
    const error = await withTransaction(asUnpriv(), (db) =>
      organization
        .updateTenant(db, before.recordVersion, { displayName: 'nope' })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });

  it('stale-version: a wrong record_version is refused', async () => {
    const error = await withTransaction(asAdmin(), (db) =>
      organization.updateTenant(db, 999999, { displayName: 'nope' }).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });
});

// ===========================================================================
// iam.company-settings-write / iam.branch-settings-write
// ===========================================================================
describe('iam.company-settings-write', () => {
  it('writes a company setting version and audits it', async () => {
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'org.company.settings_updated'",
      []
    );
    const written = await withTransaction(asAdmin(), (db) =>
      organization.writeCompanySetting(db, COMPANY_A1, {
        settingKey: 'fx.aw.company_key',
        settingValue: 'value-one',
        valueType: 'string',
      })
    );
    expect(written.version).toBe(1);
    // A second write appends the next version (append-only history).
    const second = await withTransaction(asAdmin(), (db) =>
      organization.writeCompanySetting(db, COMPANY_A1, {
        settingKey: 'fx.aw.company_key',
        settingValue: 'value-two',
        valueType: 'string',
      })
    );
    expect(second.version).toBe(2);
    expect(
      await countRows(admin, 'iam.audit_records', "action = 'org.company.settings_updated'", [])
    ).toBe(auditBefore + 2);
  });

  it('isolation: a company-A1-scoped administrator cannot write company C2 settings', async () => {
    const error = await withTransaction(asAdmin({ companyIds: [COMPANY_A1] }), (db) =>
      organization
        .writeCompanySetting(db, COMPANY_C2, {
          settingKey: 'fx.aw.evil',
          settingValue: 'nope',
          valueType: 'string',
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect(await countRows(admin, 'org.company_settings', 'company_id = $1', [COMPANY_C2])).toBe(0);
  });
});

describe('iam.branch-settings-write', () => {
  it('writes a branch setting version and audits it', async () => {
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'org.branch.settings_updated'",
      []
    );
    const written = await withTransaction(asAdmin(), (db) =>
      organization.writeBranchSetting(db, BRANCH_A1, {
        settingKey: 'fx.aw.branch_key',
        settingValue: 'branch-value',
        valueType: 'string',
      })
    );
    expect(written.version).toBe(1);
    expect(
      await countRows(admin, 'iam.audit_records', "action = 'org.branch.settings_updated'", [])
    ).toBe(auditBefore + 1);
  });

  it('isolation: a branch outside the administrator’s scope is invisible and cannot be written', async () => {
    // Scoped to a company/branch that is NOT BRANCH_A1's company. BRANCH_A1 is not
    // in the caller's allowed_company_ids, so RLS hides it entirely — the branch
    // resolves as "not found" and no setting can be written for it.
    const error = await withTransaction(
      asAdmin({ companyIds: [COMPANY_C2], branchIds: [randomUUID()] }),
      (db) =>
        organization
          .writeBranchSetting(db, BRANCH_A1, {
            settingKey: 'fx.aw.evil',
            settingValue: 'nope',
            valueType: 'string',
          })
          .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
    expect(await countRows(admin, 'org.branch_settings', 'branch_id = $1', [BRANCH_A1])).toBe(0);
  });
});

// ===========================================================================
// iam.approval-limit-end
// ===========================================================================
describe('iam.approval-limit-end', () => {
  async function seedLimit(): Promise<{ id: string; version: number }> {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO iam.approval_limits
         (id, tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
       VALUES ($1,$2,$3,$4,'purchase_order',1000.00,'USD','2026-01-01T00:00:00.000Z',$5)`,
      [id, TENANT_A, COMPANY_A1, U_TARGET, USER_A]
    );
    const v = await admin.query<{ record_version: number }>(
      'SELECT record_version FROM iam.approval_limits WHERE id = $1',
      [id]
    );
    return { id, version: v.rows[0]!.record_version };
  }

  it('ends an approval limit’s window and audits it', async () => {
    const { id, version } = await seedLimit();
    const auditBefore = await countRows(
      admin,
      'iam.audit_records',
      "action = 'iam.approval_limit.ended' AND entity_id = $1",
      [id]
    );
    await withTransaction(asAdmin(), (db) =>
      access.endApprovalLimit(db, id, version, '2026-06-01T00:00:00.000Z')
    );
    const row = await admin.query<{ effective_to: string | null }>(
      'SELECT effective_to FROM iam.approval_limits WHERE id = $1',
      [id]
    );
    expect(row.rows[0]?.effective_to).not.toBeNull();
    expect(
      await countRows(
        admin,
        'iam.audit_records',
        "action = 'iam.approval_limit.ended' AND entity_id = $1",
        [id]
      )
    ).toBe(auditBefore + 1);
  });

  it('denial: a principal without iam.approval.manage cannot end a limit', async () => {
    const { id, version } = await seedLimit();
    const error = await withTransaction(asUnpriv(), (db) =>
      access.endApprovalLimit(db, id, version, '2026-06-01T00:00:00.000Z').catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });

  it('stale-version: a wrong record_version is refused', async () => {
    const { id } = await seedLimit();
    const error = await withTransaction(asAdmin(), (db) =>
      access.endApprovalLimit(db, id, 999, '2026-06-01T00:00:00.000Z').catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });
});
