/**
 * Phase 1-4 Increment H — iam.has_permission / has_permission_in_scope and the
 * current_company_ids/current_branch_ids wrappers (P1-04-DB-020..021).
 *
 * Resolution is exercised as the NON-OWNER runtime login with a server-set
 * context: deny precedence, scope enforcement, inactive-user and expired-grant
 * denial, unmapped-role denial, unset/invalid-context denial, and cross-tenant
 * context spoofing all resolve safely.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  withRolledBackTx,
} from './helpers';

const P_READ = 'e1000000-0000-4000-8000-000000000001';
const P_WRITE = 'e1000000-0000-4000-8000-000000000002';
const R_ALLOW = 'd1000000-0000-4000-8000-000000000001';
const R_DENY = 'd1000000-0000-4000-8000-000000000002';
const R_WRITE = 'd1000000-0000-4000-8000-000000000003';
const R_EMPTY = 'd1000000-0000-4000-8000-000000000004';
const U_ALLOW = 'a7000000-0000-4000-8000-000000000001';
const U_DENY = 'a7000000-0000-4000-8000-000000000002';
const U_SCOPED = 'a7000000-0000-4000-8000-000000000003';
const U_EXPIRED = 'a7000000-0000-4000-8000-000000000004';
const U_LOCKED = 'a7000000-0000-4000-8000-000000000005';
const U_EMPTY = 'a7000000-0000-4000-8000-000000000006';
const COMPANY_A2 = 'a1000000-0000-4000-8000-000000000002';
const GRANTER = USER_A;
const READ = 'test.doc.read';
const WRITE = 'test.doc.write';

let admin: Pool;
let runtime: Pool;

async function grantRole(
  user: string,
  role: string,
  opts: { validFrom?: string; validTo?: string } = {}
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, granted_by, created_by, valid_from, valid_to)
     VALUES ($1,$2,$3,$4,$4, COALESCE($5::timestamptz, now()), $6)`,
    [TENANT_A, user, role, GRANTER, opts.validFrom ?? null, opts.validTo ?? null]
  );
}

async function seed(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.permissions (id, permission_code, domain, description, created_by)
     VALUES ($1,$3,'test','read',$5), ($2,$4,'test','write',$5) ON CONFLICT (id) DO NOTHING`,
    [P_READ, P_WRITE, READ, WRITE, GRANTER]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$5,'perm_allow','Allow',$6),($2,$5,'perm_deny','Deny',$6),
            ($3,$5,'perm_write','Write',$6),($4,$5,'perm_empty','Empty',$6)
     ON CONFLICT (id) DO NOTHING`,
    [R_ALLOW, R_DENY, R_WRITE, R_EMPTY, TENANT_A, GRANTER]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     VALUES ($1,$2,$5,'allow',$7), ($1,$3,$5,'deny',$7), ($1,$4,$6,'allow',$7)
     ON CONFLICT DO NOTHING`,
    [TENANT_A, R_ALLOW, R_DENY, R_WRITE, P_READ, P_WRITE, GRANTER]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'perm_company_a2','Company A2','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_A2, TENANT_A, GRANTER]
  );
  // Users: active except U_LOCKED.
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$7,'supabase','pu1','pu1@x.com','U Allow','active',$8),
            ($2,$7,'supabase','pu2','pu2@x.com','U Deny','active',$8),
            ($3,$7,'supabase','pu3','pu3@x.com','U Scoped','active',$8),
            ($4,$7,'supabase','pu4','pu4@x.com','U Expired','active',$8),
            ($5,$7,'supabase','pu5','pu5@x.com','U Locked','locked',$8),
            ($6,$7,'supabase','pu6','pu6@x.com','U Empty','active',$8)
     ON CONFLICT (id) DO NOTHING`,
    [U_ALLOW, U_DENY, U_SCOPED, U_EXPIRED, U_LOCKED, U_EMPTY, TENANT_A, GRANTER]
  );
  // Grants.
  await grantRole(U_ALLOW, R_ALLOW);
  await grantRole(U_DENY, R_ALLOW);
  await grantRole(U_DENY, R_DENY);
  await grantRole(U_EXPIRED, R_ALLOW, {
    validFrom: new Date(Date.now() - 10 * 86400000).toISOString(),
    validTo: new Date(Date.now() - 86400000).toISOString(),
  });
  await grantRole(U_LOCKED, R_ALLOW);
  await grantRole(U_EMPTY, R_EMPTY);
  // U_SCOPED: scoped grant of R_WRITE limited to COMPANY_A1 (grant + scope in one tx).
  await admin.query('BEGIN');
  const g = await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'scoped',$4,$4) RETURNING id`,
    [TENANT_A, U_SCOPED, R_WRITE, GRANTER]
  );
  await admin.query(
    `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
     VALUES ($1,$2,'company',$3,$4)`,
    [TENANT_A, g.rows[0].id, COMPANY_A1, GRANTER]
  );
  await admin.query('COMMIT');
}

async function can(
  user: string | null,
  code: string,
  tenant: string | null = TENANT_A
): Promise<boolean> {
  const ctx: { tenantId?: string; userId?: string } = {};
  if (tenant) ctx.tenantId = tenant;
  if (user) ctx.userId = user;
  return withRolledBackTx(runtime, ctx, async (c) => {
    const r = await c.query(`SELECT iam.has_permission($1) AS ok`, [code]);
    return r.rows[0].ok as boolean;
  });
}

async function canScope(
  user: string,
  code: string,
  company: string | null,
  branch: string | null = null,
  dept: string | null = null
): Promise<boolean> {
  return withRolledBackTx(runtime, { tenantId: TENANT_A, userId: user }, async (c) => {
    const r = await c.query(`SELECT iam.has_permission_in_scope($1,$2,$3,$4) AS ok`, [
      code,
      company,
      branch,
      dept,
    ]);
    return r.rows[0].ok as boolean;
  });
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seed();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('iam.current_company_ids / current_branch_ids wrappers', () => {
  it('reflect the transaction context (and are NULL when unset)', async () => {
    const set = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: U_ALLOW, companyIds: [COMPANY_A1], branchIds: [COMPANY_A2] },
      (c) => c.query(`SELECT iam.current_company_ids() AS co, iam.current_branch_ids() AS br`)
    );
    expect(set.rows[0].co).toEqual([COMPANY_A1]);
    expect(set.rows[0].br).toEqual([COMPANY_A2]);
    const unset = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: U_ALLOW }, (c) =>
      c.query(`SELECT iam.current_company_ids() AS co`)
    );
    expect(unset.rows[0].co).toBeNull();
  });
});

describe('iam.has_permission — deny precedence and denial paths', () => {
  it('grants an allowed permission to an active user', async () => {
    expect(await can(U_ALLOW, READ)).toBe(true);
  });
  it('does not grant a permission the user was never given', async () => {
    expect(await can(U_ALLOW, WRITE)).toBe(false);
  });
  it('deny overrides allow (BR-IAM-001)', async () => {
    expect(await can(U_DENY, READ)).toBe(false);
  });
  it('denies an expired grant', async () => {
    expect(await can(U_EXPIRED, READ)).toBe(false);
  });
  it('denies a locked (inactive) user', async () => {
    expect(await can(U_LOCKED, READ)).toBe(false);
  });
  it('a role with no mapping confers nothing (no role-name authorization)', async () => {
    expect(await can(U_EMPTY, READ)).toBe(false);
  });
  it('denies an unknown permission code', async () => {
    expect(await can(U_ALLOW, 'test.nonexistent')).toBe(false);
  });
  it('denies when the context is unset', async () => {
    expect(await can(null, READ, null)).toBe(false);
    expect(await can(U_ALLOW, READ, null)).toBe(false);
  });
  it('denies (does not error) on an invalid UUID in the context', async () => {
    const r = await withRolledBackTx(runtime, { tenantId: 'not-a-uuid', userId: U_ALLOW }, (c) =>
      c.query(`SELECT iam.has_permission($1) AS ok`, [READ])
    );
    expect(r.rows[0].ok).toBe(false);
  });
  it('denies cross-tenant context spoofing (A user under a B tenant claim)', async () => {
    expect(await can(U_ALLOW, READ, TENANT_B)).toBe(false);
  });
});

describe('iam.has_permission_in_scope — scope enforcement', () => {
  it('grants a scoped permission within the granted company', async () => {
    expect(await canScope(U_SCOPED, WRITE, COMPANY_A1)).toBe(true);
  });
  it('denies a scoped permission outside the granted company', async () => {
    expect(await canScope(U_SCOPED, WRITE, COMPANY_A2)).toBe(false);
    expect(await canScope(U_SCOPED, WRITE, null)).toBe(false);
  });
  it('an unrestricted grant applies in any scope', async () => {
    expect(await canScope(U_ALLOW, READ, COMPANY_A2)).toBe(true);
  });
  it('deny precedence holds in scoped resolution too', async () => {
    expect(await canScope(U_DENY, READ, COMPANY_A1)).toBe(false);
  });
});
