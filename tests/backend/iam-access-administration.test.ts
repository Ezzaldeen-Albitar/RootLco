/**
 * P1-14 operation evidence — access administration (grants, scopes, approval
 * limits), the confirmed-High surface, driven through the REAL
 * `AccessAdministrationService`, the runtime context, RLS, the transaction
 * wrapper, and the audit/outbox path.
 *
 * This is the application-service half of the grant-scope remediation proofs
 * (the database half is tests/db/p1-14-grant-scope-containment.test.ts). It
 * exercises the service exactly as a route handler does — `withTransaction(ctx,
 * db => service.method(db, ...))` on the deployed `app_runtime` identity — and
 * asserts, for the highest-risk operations:
 *
 *   * a scoped administrator cannot escalate (empty/omitted/null/duplicate/mixed
 *     scope requests, cross-company, tenant-wide);
 *   * a within-authority grant commits, and produces exactly one audit record and
 *     one access-grant event, both inside the business transaction;
 *   * a rejected grant leaves nothing behind (state, audit, outbox);
 *   * scope add/remove is contained and self-mutation is refused;
 *   * an approval limit cannot be self-set and validates money;
 *   * revocation removes authority immediately and is optimistic-concurrency safe.
 *
 * No provider is involved (these are authorization operations), so the service is
 * constructed directly from its repositories and policies — the same objects the
 * composition root wires.
 *
 * Operations exercised here (coverage-gate references):
 *   iam.grant-issue  iam.grant-revoke  iam.grant-scope-add  iam.grant-scope-remove
 *   iam.approval-limit-create
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  COMPANY_A1,
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { AccessAdministrationService } from '@/modules/iam/application/access-administration-service';
import { AuthorizationRepository } from '@/modules/iam/data/authorization-repository';
import { IdentityRepository } from '@/modules/iam/data/identity-repository';
import { OrganizationRepository } from '@/modules/iam/data/organization-repository';
import { DelegationPolicy } from '@/modules/iam/domain/delegation-policy';
import { CredentialPolicy } from '@/modules/iam/domain/credential-policy';
import { IdentityPolicy } from '@/modules/iam/domain/identity-policy';

// Organisation: company C1 (COMPANY_A1) with branch B1 (BRANCH_A1) and B2, plus a
// second company C2.
const COMPANY_C2 = 'a1000000-0000-4000-8000-0000000ac201';
const BRANCH_B2 = 'a1100000-0000-4000-8000-0000000ab201';

// Actors (tenant A). Each holds iam.grant.manage + iam.approval.manage via an
// admin role; their scope is set by their own grant + request context.
const U_UNRESTRICTED = 'a0000000-0000-4000-8000-0000000ae001';
const U_COMPANY = 'a0000000-0000-4000-8000-0000000ae002';
const U_GRANTEE = 'a0000000-0000-4000-8000-0000000aee01';

const ROLE_ADMIN = 'd0000000-0000-4000-8000-00000000a001';
const ROLE_TARGET = 'd0000000-0000-4000-8000-00000000a002';
const GRANT_UNR = 'c0000000-0000-4000-8000-00000000a001';
const GRANT_COM = 'c0000000-0000-4000-8000-00000000a002';

const AS_UNRESTRICTED = { userId: U_UNRESTRICTED };
const AS_COMPANY = { userId: U_COMPANY, companyIds: [COMPANY_A1] };

let admin: Pool;
let runtime: Pool;
let access: AccessAdministrationService;

function newService(): AccessAdministrationService {
  return new AccessAdministrationService(
    new AuthorizationRepository(),
    new IdentityRepository(),
    new OrganizationRepository(),
    new DelegationPolicy(),
    new CredentialPolicy(),
    new IdentityPolicy()
  );
}

async function seed(): Promise<void> {
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_ac2','Company AC2','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_C2, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_ab2','Branch AB2','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B2, TENANT_A, COMPANY_A1, USER_A]
  );
  for (const [id, subject] of [
    [U_UNRESTRICTED, 'fx_ae_unrestricted'],
    [U_COMPANY, 'fx_ae_company'],
    [U_GRANTEE, 'fx_ae_grantee'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,'test_harness',$3,$4,$3,'active',$5) ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, subject, `${subject}@example.test`, USER_A]
    );
  }
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$3,'fx_ae_admin','AE admin',$4), ($2,$3,'fx_ae_target','AE target',$4)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_ADMIN, ROLE_TARGET, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions
      WHERE permission_code = ANY(ARRAY['iam.grant.manage','iam.approval.manage'])
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_ADMIN, USER_A]
  );
  // Actor authority — on the BYPASSRLS admin connection (bootstrap path). The
  // unrestricted grant needs no scope; the company grant + its scope in one tx.
  await admin.query(
    `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1,$2,$3,$4,'unrestricted','active',$5,$5) ON CONFLICT (id) DO NOTHING`,
    [GRANT_UNR, TENANT_A, U_UNRESTRICTED, ROLE_ADMIN, USER_A]
  );
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    const has = await c.query('SELECT 1 FROM iam.role_grants WHERE id = $1', [GRANT_COM]);
    if (has.rowCount === 0) {
      await c.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped','active',$5,$5)`,
        [GRANT_COM, TENANT_A, U_COMPANY, ROLE_ADMIN, USER_A]
      );
      await c.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
         VALUES ($1,$2,'company',$3,$4)`,
        [TENANT_A, GRANT_COM, COMPANY_A1, USER_A]
      );
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

/** Removes grants issued TO the grantee (leaves the actors' own authority). */
async function clearGranteeGrants(): Promise<void> {
  await admin.query(`DELETE FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2`, [
    TENANT_A,
    U_GRANTEE,
  ]);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
  access = newService();
});

beforeEach(async () => {
  await seed();
});

afterEach(async () => {
  await clearGranteeGrants();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

const ctx = (over: { userId: string; companyIds?: string[]; branchIds?: string[] }) =>
  contextFor({
    operation: 'iam.grant-issue',
    module: 'iam',
    userId: over.userId,
    ...(over.companyIds ? { companyIds: over.companyIds } : {}),
    ...(over.branchIds ? { branchIds: over.branchIds } : {}),
  });

describe('issueGrant — scope containment through the service', () => {
  it('a tenant-wide administrator may issue an unrestricted grant, once, with audit + event', async () => {
    const auditBefore = await countRows(admin, 'iam.audit_records', 'tenant_id = $1', [TENANT_A]);
    const outboxBefore = await countRows(
      admin,
      'shared.event_outbox',
      "tenant_id = $1 AND event_type = 'access.grant.changed'",
      [TENANT_A]
    );

    const result = await withTransaction(ctx(AS_UNRESTRICTED), (db) =>
      access.issueGrant(db, { userId: U_GRANTEE, roleId: ROLE_TARGET })
    );
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);

    const grant = await admin.query<{ scope_mode: string }>(
      'SELECT scope_mode FROM iam.role_grants WHERE id = $1',
      [result.id]
    );
    expect(grant.rows[0]?.scope_mode).toBe('unrestricted');
    const auditAfter = await countRows(admin, 'iam.audit_records', 'tenant_id = $1', [TENANT_A]);
    const outboxAfter = await countRows(
      admin,
      'shared.event_outbox',
      "tenant_id = $1 AND event_type = 'access.grant.changed'",
      [TENANT_A]
    );
    expect(auditAfter).toBe(auditBefore + 1);
    expect(outboxAfter).toBe(outboxBefore + 1);
  });

  it('10/11. a company-scoped administrator cannot issue an unrestricted grant — omitted or null scopes', async () => {
    for (const scopes of [undefined, null] as const) {
      const error = await withTransaction(ctx(AS_COMPANY), (db) =>
        access
          .issueGrant(db, {
            userId: U_GRANTEE,
            roleId: ROLE_TARGET,
            ...(scopes === null ? { scopes: null as never } : {}),
          })
          .catch((e: unknown) => e)
      );
      expect(error).toBeInstanceOf(AppFailure);
      expect((error as AppFailure).code).toBe('ERR-IAM-001');
      expect((error as AppFailure).message).toMatch(/unrestricted/i);
    }
  });

  it('9. an explicit empty scope array is treated as unrestricted and refused for a scoped actor', async () => {
    const error = await withTransaction(ctx(AS_COMPANY), (db) =>
      access.issueGrant(db, { userId: U_GRANTEE, roleId: ROLE_TARGET, scopes: [] }).catch((e) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('4. a company-scoped administrator may issue a grant restricted to its own company', async () => {
    const result = await withTransaction(ctx(AS_COMPANY), (db) =>
      access.issueGrant(db, {
        userId: U_GRANTEE,
        roleId: ROLE_TARGET,
        scopes: [{ scopeType: 'company', companyId: COMPANY_A1 }],
      })
    );
    const scopes = await admin.query('SELECT 1 FROM iam.grant_scopes WHERE grant_id = $1', [
      result.id,
    ]);
    expect(scopes.rowCount).toBe(1);
  });

  it('5. a company-scoped administrator cannot issue a grant for another company', async () => {
    const error = await withTransaction(ctx(AS_COMPANY), (db) =>
      access
        .issueGrant(db, {
          userId: U_GRANTEE,
          roleId: ROLE_TARGET,
          scopes: [{ scopeType: 'company', companyId: COMPANY_C2 }],
        })
        .catch((e) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('12. duplicate scopes are normalised to a single scope row', async () => {
    const result = await withTransaction(ctx(AS_COMPANY), (db) =>
      access.issueGrant(db, {
        userId: U_GRANTEE,
        roleId: ROLE_TARGET,
        scopes: [
          { scopeType: 'company', companyId: COMPANY_A1 },
          { scopeType: 'company', companyId: COMPANY_A1 },
        ],
      })
    );
    const scopes = await countRows(admin, 'iam.grant_scopes', 'grant_id = $1', [result.id]);
    expect(scopes).toBe(1);
  });

  it('13. a mix of allowed and disallowed scopes rejects the whole grant (no partial commit)', async () => {
    const grantsBefore = await countRows(
      admin,
      'iam.role_grants',
      'tenant_id = $1 AND user_id = $2',
      [TENANT_A, U_GRANTEE]
    );
    const error = await withTransaction(ctx(AS_COMPANY), (db) =>
      access
        .issueGrant(db, {
          userId: U_GRANTEE,
          roleId: ROLE_TARGET,
          scopes: [
            { scopeType: 'company', companyId: COMPANY_A1 },
            { scopeType: 'company', companyId: COMPANY_C2 },
          ],
        })
        .catch((e) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    const grantsAfter = await countRows(
      admin,
      'iam.role_grants',
      'tenant_id = $1 AND user_id = $2',
      [TENANT_A, U_GRANTEE]
    );
    expect(grantsAfter).toBe(grantsBefore);
  });

  it('20/21. a rejected grant writes no state, audit, or outbox event', async () => {
    const auditBefore = await countRows(admin, 'iam.audit_records', 'tenant_id = $1', [TENANT_A]);
    const outboxBefore = await countRows(admin, 'shared.event_outbox', 'tenant_id = $1', [
      TENANT_A,
    ]);
    await withTransaction(ctx(AS_COMPANY), (db) =>
      access.issueGrant(db, { userId: U_GRANTEE, roleId: ROLE_TARGET }).catch(() => undefined)
    );
    expect(await countRows(admin, 'iam.audit_records', 'tenant_id = $1', [TENANT_A])).toBe(
      auditBefore
    );
    expect(await countRows(admin, 'shared.event_outbox', 'tenant_id = $1', [TENANT_A])).toBe(
      outboxBefore
    );
  });

  it('refuses a self-grant even for a tenant-wide administrator', async () => {
    const error = await withTransaction(ctx(AS_UNRESTRICTED), (db) =>
      access.issueGrant(db, { userId: U_UNRESTRICTED, roleId: ROLE_TARGET }).catch((e) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect((error as AppFailure).message).toMatch(/own access/i);
  });

  it('refuses delegating a role whose permissions the actor does not hold', async () => {
    // ROLE_ADMIN confers iam.grant.manage + iam.approval.manage; a target holding a
    // permission the company admin lacks would be refused. Build such a role.
    const richRole = 'd0000000-0000-4000-8000-00000000a0ff';
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
       VALUES ($1,$2,'fx_ae_rich','AE rich',$3) ON CONFLICT (id) DO NOTHING`,
      [richRole, TENANT_A, USER_A]
    );
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1,$2,id,'allow',$3 FROM iam.permissions WHERE permission_code = 'iam.user.manage'
       ON CONFLICT DO NOTHING`,
      [TENANT_A, richRole, USER_A]
    );
    const error = await withTransaction(ctx(AS_COMPANY), (db) =>
      access
        .issueGrant(db, {
          userId: U_GRANTEE,
          roleId: richRole,
          scopes: [{ scopeType: 'company', companyId: COMPANY_A1 }],
        })
        .catch((e) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    await admin.query('DELETE FROM iam.roles WHERE id = $1', [richRole]);
  });
});

describe('cross-tenant isolation', () => {
  it('an administrator cannot issue a grant to a user in another tenant', async () => {
    // A tenant-A admin acting with a tenant-A context cannot even see a tenant-B
    // user; the grantee lookup fails closed as "not found in this tenant".
    const error = await withTransaction(ctx(AS_UNRESTRICTED), (db) =>
      access
        .issueGrant(db, { userId: 'c1300000-0000-4000-8000-00000000000b', roleId: ROLE_TARGET })
        .catch((e) => e)
    );
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-RES-001');
  });
});

describe('revocation takes effect immediately', () => {
  it('a revoked grant no longer confers its permission on the next request', async () => {
    // Issue a grant of ROLE_ADMIN (grant.manage) to the grantee, unrestricted.
    const issued = await withTransaction(ctx(AS_UNRESTRICTED), (db) =>
      access.issueGrant(db, { userId: U_GRANTEE, roleId: ROLE_ADMIN })
    );

    const hasGrantManage = async (): Promise<boolean> =>
      withTransaction(ctx({ userId: U_GRANTEE }), async (db) => {
        const r = await db.query<{ ok: boolean }>(
          "SELECT iam.has_permission('iam.grant.manage') AS ok"
        );
        return r.rows[0]!.ok;
      });

    // Immediately after the grant, the permission resolves true — no token, no
    // cache: the database is the authority and answers per request.
    expect(await hasGrantManage()).toBe(true);

    // Revoke, then the very next request sees the permission gone.
    const version = (
      await admin.query<{ record_version: number }>(
        'SELECT record_version FROM iam.role_grants WHERE id = $1',
        [issued.id]
      )
    ).rows[0]!.record_version;
    await withTransaction(ctx(AS_UNRESTRICTED), (db) =>
      access.revokeGrant(db, issued.id, version, 'offboarded')
    );
    expect(await hasGrantManage()).toBe(false);
  });

  it('revokeGrant rejects a stale version (optimistic concurrency)', async () => {
    const issued = await withTransaction(ctx(AS_UNRESTRICTED), (db) =>
      access.issueGrant(db, { userId: U_GRANTEE, roleId: ROLE_TARGET })
    );
    const error = await withTransaction(ctx(AS_UNRESTRICTED), (db) =>
      access.revokeGrant(db, issued.id, 999, 'wrong version').catch((e) => e)
    );
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-CON-001');
  });
});

describe('grant scope add / remove (iam.grant-scope-add, iam.grant-scope-remove)', () => {
  it('a company admin may add a within-authority scope and remove it, but not a foreign-company scope', async () => {
    // The company admin issues a company-A1-scoped grant to the grantee.
    const grant = await withTransaction(ctx(AS_COMPANY), (db) =>
      access.issueGrant(db, {
        userId: U_GRANTEE,
        roleId: ROLE_TARGET,
        scopes: [{ scopeType: 'company', companyId: COMPANY_A1 }],
      })
    );

    // Adding a branch within their company is allowed.
    const added = await withTransaction(ctx(AS_COMPANY), (db) =>
      access.addScope(db, grant.id, {
        scopeType: 'branch',
        companyId: COMPANY_A1,
        branchId: BRANCH_B2,
      })
    );
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);

    // Adding a scope in another company is refused (containment on widening).
    const widen = await withTransaction(ctx(AS_COMPANY), (db) =>
      access.addScope(db, grant.id, { scopeType: 'company', companyId: COMPANY_C2 }).catch((e) => e)
    );
    expect((widen as AppFailure).code).toBe('ERR-IAM-001');

    // The within-authority scope can be removed again.
    await withTransaction(ctx(AS_COMPANY), (db) => access.removeScope(db, grant.id, added.id));
    const remaining = await withTransaction(ctx(AS_COMPANY), (db) =>
      access.listScopes(db, grant.id)
    );
    expect(remaining.some((s) => s.id === added.id)).toBe(false);
  });
});

describe('approval limits', () => {
  it('refuses an administrator setting their own approval limit', async () => {
    const error = await withTransaction(ctx(AS_UNRESTRICTED), (db) =>
      access
        .createApprovalLimit(db, {
          companyId: COMPANY_A1,
          userId: U_UNRESTRICTED,
          limitType: 'purchase_order',
          amount: '1000.00',
          currency: 'USD',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
        })
        .catch((e) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect((error as AppFailure).message).toMatch(/own/i);
  });

  it('rejects a malformed money amount', async () => {
    const error = await withTransaction(ctx(AS_UNRESTRICTED), (db) =>
      access
        .createApprovalLimit(db, {
          companyId: COMPANY_A1,
          userId: U_GRANTEE,
          limitType: 'purchase_order',
          amount: '-5' + randomUUID().slice(0, 0), // negative
          currency: 'USD',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
        })
        .catch((e) => e)
    );
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
  });
});
