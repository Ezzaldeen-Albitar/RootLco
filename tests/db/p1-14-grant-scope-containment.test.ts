/**
 * Phase 1-14 grant-scope containment backstop
 * (migration 20260727090000; confirmed-High remediation).
 *
 * Proves — through the REAL non-owner `app_runtime` login, never the admin
 * connection — that the database backstop refuses a delegation exceeding the
 * acting administrator's own scope, independently of the application service:
 *
 *   * a scoped administrator cannot mint an unrestricted (tenant-wide) grant;
 *   * a company-scoped administrator cannot delegate another company, nor
 *     tenant-wide;
 *   * a branch-scoped administrator cannot delegate another branch, nor
 *     company-wide, nor tenant-wide;
 *   * each within-authority delegation is accepted;
 *   * a mixture of allowed and disallowed scopes rolls the whole transaction back;
 *   * cross-tenant / cross-company scope identifiers are structurally refused;
 *   * a rejected commit leaves no grant or scope row behind;
 *   * revocation removes the actor's authority immediately.
 *
 * The deferred backstop is forced with `SET CONSTRAINTS ALL IMMEDIATE` inside a
 * rolled-back transaction (mirroring iam-grants.test.ts) so no fixture is mutated;
 * the durable cases use a committed transaction that is cleaned up afterwards.
 *
 * The administrators' OWN authority grants are provisioned on the admin
 * (BYPASSRLS) connection — that path bypasses RLS and this backstop alike, which
 * is exactly how the owner/operator bootstrap boundary is preserved. Every
 * ASSERTION below runs as `app_runtime`.
 *
 * Application-layer proofs that are not expressible in raw SQL — empty/omitted/
 * null/duplicate scope normalisation, idempotency replay, and the audit/outbox
 * evidence of a successful grant — live in the operation-evidence layer
 * (tests/backend/iam-access-administration.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  BRANCH_A1,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  setContext,
  TENANT_A,
  TENANT_B,
  USER_A,
  withRolledBackTx,
} from './helpers';

// Organisation: company C1 (COMPANY_A1) with branches B1 (BRANCH_A1) and B2, and
// department D1 in B1; a second company C2. A company C1B in tenant B for the
// cross-tenant proof.
const COMPANY_C2 = 'a1000000-0000-4000-8000-0000000000c2';
const BRANCH_B2 = 'a1100000-0000-4000-8000-0000000000b2';
const DEPT_D1 = 'a1200000-0000-4000-8000-0000000000d1';
const COMPANY_B1 = 'b1000000-0000-4000-8000-0000000000b1';

// Actors (all in tenant A).
const U_UNRESTRICTED = 'a0000000-0000-4000-8000-00000000ad01';
const U_COMPANY = 'a0000000-0000-4000-8000-00000000ad02';
const U_BRANCH = 'a0000000-0000-4000-8000-00000000ad03';
const U_GRANTEE = 'a0000000-0000-4000-8000-00000000ee01';

const ROLE_ADMIN = 'd0000000-0000-4000-8000-00000000a001';
const ROLE_TARGET = 'd0000000-0000-4000-8000-00000000a002';

const SYS = USER_A;

let admin: Pool;
let runtime: Pool;

const AS_UNRESTRICTED = { tenantId: TENANT_A, userId: U_UNRESTRICTED };
const AS_COMPANY = { tenantId: TENANT_A, userId: U_COMPANY, companyIds: [COMPANY_A1] };
const AS_BRANCH = {
  tenantId: TENANT_A,
  userId: U_BRANCH,
  companyIds: [COMPANY_A1],
  branchIds: [BRANCH_A1],
};

/** Provision the org objects, users, roles, and the actors' own authority. */
async function seed(): Promise<void> {
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_c2','Company C2','USD',$3), ($4,$5,'company_b1','Company B1','USD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_C2, TENANT_A, SYS, COMPANY_B1, TENANT_B]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_b2','Branch B2','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B2, TENANT_A, COMPANY_A1, SYS]
  );
  await admin.query(
    `INSERT INTO org.departments (id, tenant_id, company_id, branch_id, department_code, name, created_by)
     VALUES ($1,$2,$3,$4,'dept_d1','Dept D1',$5)
     ON CONFLICT (id) DO NOTHING`,
    [DEPT_D1, TENANT_A, COMPANY_A1, BRANCH_A1, SYS]
  );

  for (const [id, subject, email] of [
    [U_UNRESTRICTED, 'gsc_unrestricted', 'gscu@example.com'],
    [U_COMPANY, 'gsc_company', 'gscc@example.com'],
    [U_BRANCH, 'gsc_branch', 'gscb@example.com'],
    [U_GRANTEE, 'gsc_grantee', 'gscg@example.com'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,'supabase',$3,$4,$5,'active',$6) ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, subject, email, subject, SYS]
    );
  }

  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$3,'gsc_admin','Grant admin',$4), ($2,$3,'gsc_target','Grant target',$4)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_ADMIN, ROLE_TARGET, TENANT_A, SYS]
  );
  // ROLE_ADMIN carries iam.grant.manage so its holders pass ins_role_grants_delegable.
  // ROLE_TARGET is deliberately empty (delegating it checks scope, not permissions).
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = 'iam.grant.manage'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_ADMIN, SYS]
  );

  // The actors' OWN authority — provisioned on the BYPASSRLS admin connection, so
  // the backstop does not (and must not) constrain the bootstrap of authority. The
  // unrestricted grant needs no scope; each scoped grant and its scope are written
  // in ONE transaction so the deferred require-scope check sees a coherent grant.
  const G_UNR = 'c0000000-0000-4000-8000-00000000a001';
  const G_COM = 'c0000000-0000-4000-8000-00000000a002';
  const G_BRA = 'c0000000-0000-4000-8000-00000000a003';
  await admin.query(
    `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1,$2,$3,$4,'unrestricted','active',$5,$5) ON CONFLICT (id) DO NOTHING`,
    [G_UNR, TENANT_A, U_UNRESTRICTED, ROLE_ADMIN, SYS]
  );
  const scopedGrant = async (
    grantId: string,
    userId: string,
    scopeSql: string,
    scopeParams: unknown[]
  ): Promise<void> => {
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      const existing = await c.query('SELECT 1 FROM iam.role_grants WHERE id = $1', [grantId]);
      if (existing.rowCount === 0) {
        await c.query(
          `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
           VALUES ($1,$2,$3,$4,'scoped','active',$5,$5)`,
          [grantId, TENANT_A, userId, ROLE_ADMIN, SYS]
        );
        await c.query(scopeSql, scopeParams);
      }
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  };
  await scopedGrant(
    G_COM,
    U_COMPANY,
    `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
     VALUES ($1,$2,'company',$3,$4)`,
    [TENANT_A, G_COM, COMPANY_A1, SYS]
  );
  await scopedGrant(
    G_BRA,
    U_BRANCH,
    `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
     VALUES ($1,$2,'branch',$3,$4,$5)`,
    [TENANT_A, G_BRA, COMPANY_A1, BRANCH_A1, SYS]
  );
}

/**
 * Inserts a grant (and optional scopes) as `app_runtime` under `ctx`, then forces
 * the deferred backstop with SET CONSTRAINTS ALL IMMEDIATE. Rolls back either way.
 * Returns the SQLSTATE if it threw at the immediate check, or null if it passed.
 */
async function attemptGrant(
  ctx: Parameters<typeof setContext>[1],
  mode: 'unrestricted' | 'scoped',
  scopes: Array<{
    type: 'company' | 'branch' | 'department';
    company: string;
    branch?: string;
    dept?: string;
  }>
): Promise<{ ok: boolean; code: string | null }> {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx);
    const grantId = (
      await client.query<{ id: string }>(
        `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
        [TENANT_A, U_GRANTEE, ROLE_TARGET, mode, ctx.userId]
      )
    ).rows[0]!.id;
    for (const s of scopes) {
      await client.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, department_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [TENANT_A, grantId, s.type, s.company, s.branch ?? null, s.dept ?? null, ctx.userId]
      );
    }
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: (err as { code?: string }).code ?? null };
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
});

beforeEach(async () => {
  await seed();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('P1-14 grant-scope containment — unrestricted delegation', () => {
  it('1. a tenant-wide administrator may issue an approved unrestricted grant', async () => {
    const r = await attemptGrant(AS_UNRESTRICTED, 'unrestricted', []);
    expect(r).toEqual({ ok: true, code: null });
  });

  it('2. a company-scoped administrator cannot issue an unrestricted grant', async () => {
    const r = await attemptGrant(AS_COMPANY, 'unrestricted', []);
    expect(r).toEqual({ ok: false, code: '42501' });
  });

  it('3. a branch-scoped administrator cannot issue an unrestricted grant', async () => {
    const r = await attemptGrant(AS_BRANCH, 'unrestricted', []);
    expect(r).toEqual({ ok: false, code: '42501' });
  });

  it('9. an unrestricted grant with zero scope rows cannot bypass containment (empty-scope path)', async () => {
    // The application maps an empty/omitted scope list to scope_mode=unrestricted;
    // at the database this is a scope-less grant, refused for a scoped actor.
    const r = await attemptGrant(AS_COMPANY, 'unrestricted', []);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('42501');
  });
});

describe('P1-14 grant-scope containment — company-scoped administrator', () => {
  it('4. may issue a grant restricted to its own company', async () => {
    const r = await attemptGrant(AS_COMPANY, 'scoped', [{ type: 'company', company: COMPANY_A1 }]);
    expect(r).toEqual({ ok: true, code: null });
  });

  it('5. cannot issue a grant for another company', async () => {
    const r = await attemptGrant(AS_COMPANY, 'scoped', [{ type: 'company', company: COMPANY_C2 }]);
    expect(r).toEqual({ ok: false, code: '42501' });
  });

  it('may issue a grant restricted to a branch or department within its company', async () => {
    const branch = await attemptGrant(AS_COMPANY, 'scoped', [
      { type: 'branch', company: COMPANY_A1, branch: BRANCH_A1 },
    ]);
    expect(branch).toEqual({ ok: true, code: null });
    const dept = await attemptGrant(AS_COMPANY, 'scoped', [
      { type: 'department', company: COMPANY_A1, branch: BRANCH_A1, dept: DEPT_D1 },
    ]);
    expect(dept).toEqual({ ok: true, code: null });
  });
});

describe('P1-14 grant-scope containment — branch-scoped administrator', () => {
  it('6. may issue a grant restricted to its own branch', async () => {
    const r = await attemptGrant(AS_BRANCH, 'scoped', [
      { type: 'branch', company: COMPANY_A1, branch: BRANCH_A1 },
    ]);
    expect(r).toEqual({ ok: true, code: null });
  });

  it('7. cannot issue a grant for another branch', async () => {
    const r = await attemptGrant(AS_BRANCH, 'scoped', [
      { type: 'branch', company: COMPANY_A1, branch: BRANCH_B2 },
    ]);
    expect(r).toEqual({ ok: false, code: '42501' });
  });

  it('8. cannot issue a company-wide grant', async () => {
    const r = await attemptGrant(AS_BRANCH, 'scoped', [{ type: 'company', company: COMPANY_A1 }]);
    expect(r).toEqual({ ok: false, code: '42501' });
  });

  it('may issue a grant restricted to a department within its branch', async () => {
    const r = await attemptGrant(AS_BRANCH, 'scoped', [
      { type: 'department', company: COMPANY_A1, branch: BRANCH_A1, dept: DEPT_D1 },
    ]);
    expect(r).toEqual({ ok: true, code: null });
  });
});

describe('P1-14 grant-scope containment — mixed, malformed, and cross-tenant scopes', () => {
  it('13. a mixture of allowed and disallowed scopes rejects the whole transaction', async () => {
    const r = await attemptGrant(AS_COMPANY, 'scoped', [
      { type: 'company', company: COMPANY_A1 }, // allowed
      { type: 'company', company: COMPANY_C2 }, // disallowed
    ]);
    expect(r).toEqual({ ok: false, code: '42501' });
  });

  it('14. a company scope from another tenant is rejected (composite FK)', async () => {
    const r = await attemptGrant(AS_COMPANY, 'scoped', [{ type: 'company', company: COMPANY_B1 }]);
    expect(r.ok).toBe(false);
    // Composite FK carrying tenant_id refuses the cross-tenant company outright.
    expect(r.code).toBe('23503');
  });

  it('15. a branch that does not belong to the scoped company is rejected (composite FK)', async () => {
    // BRANCH_A1 belongs to COMPANY_A1, not COMPANY_C2.
    const r = await attemptGrant(AS_COMPANY, 'scoped', [
      { type: 'branch', company: COMPANY_C2, branch: BRANCH_A1 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('23503');
  });

  it('16. direct runtime SQL cannot bypass the backstop by issuing a wider grant', async () => {
    // The whole suite is raw app_runtime SQL; this states the invariant plainly:
    // neither the unrestricted path nor a foreign-company scope succeeds.
    expect((await attemptGrant(AS_BRANCH, 'unrestricted', [])).ok).toBe(false);
    expect(
      (await attemptGrant(AS_COMPANY, 'scoped', [{ type: 'company', company: COMPANY_C2 }])).ok
    ).toBe(false);
  });

  it('17. a scoped grant with no scope rows fails before commit (existing require-scope guard)', async () => {
    const r = await attemptGrant(AS_UNRESTRICTED, 'scoped', []);
    expect(r.ok).toBe(false);
    // 23514 from tg_role_grants_require_scope (a scoped active grant needs ≥1 scope).
    expect(r.code).toBe('23514');
  });
});

describe('P1-14 grant-scope containment — durability, deletion, revocation', () => {
  it('18. removing the last scope of a scoped grant cannot turn it into unrestricted', async () => {
    // Create a within-authority scoped grant durably (committed) as the company
    // admin, then attempt to delete its only scope — the require-scope guard fires.
    const client = await runtime.connect();
    let grantId: string | null = null;
    try {
      await client.query('BEGIN');
      await setContext(client, AS_COMPANY);
      grantId = (
        await client.query<{ id: string }>(
          `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
           VALUES ($1,$2,$3,'scoped',$4,$4) RETURNING id`,
          [TENANT_A, U_GRANTEE, ROLE_TARGET, U_COMPANY]
        )
      ).rows[0]!.id;
      await client.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
         VALUES ($1,$2,'company',$3,$4)`,
        [TENANT_A, grantId, COMPANY_A1, U_COMPANY]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
    try {
      await client.query('BEGIN');
      await setContext(client, AS_COMPANY);
      await client.query(`DELETE FROM iam.grant_scopes WHERE tenant_id = $1 AND grant_id = $2`, [
        TENANT_A,
        grantId,
      ]);
      await expectSqlState(client.query('SET CONSTRAINTS ALL IMMEDIATE'), '23514');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    // Cleanup the durable grant.
    await admin.query(`DELETE FROM iam.role_grants WHERE id = $1`, [grantId]);
  });

  it('19. two concurrent within-authority grants each keep their own scope (no bypass)', async () => {
    const mk = async (branch: string): Promise<string> => {
      const c = await runtime.connect();
      try {
        await c.query('BEGIN');
        await setContext(c, AS_UNRESTRICTED);
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
             VALUES ($1,$2,$3,'scoped',$4,$4) RETURNING id`,
            [TENANT_A, U_GRANTEE, ROLE_TARGET, U_UNRESTRICTED]
          )
        ).rows[0]!.id;
        await c.query(
          `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
           VALUES ($1,$2,'branch',$3,$4,$5)`,
          [TENANT_A, id, COMPANY_A1, branch, U_UNRESTRICTED]
        );
        await c.query('COMMIT');
        return id;
      } finally {
        c.release();
      }
    };
    const [g1, g2] = await Promise.all([mk(BRANCH_A1), mk(BRANCH_B2)]);
    const rows = await admin.query<{ branch_id: string }>(
      `SELECT branch_id FROM iam.grant_scopes WHERE grant_id = ANY($1::uuid[]) ORDER BY branch_id`,
      [[g1, g2]]
    );
    expect(rows.rows.map((r) => r.branch_id).sort()).toEqual([BRANCH_A1, BRANCH_B2].sort());
    await admin.query(`DELETE FROM iam.role_grants WHERE id = ANY($1::uuid[])`, [[g1, g2]]);
  });

  it('20. a rejected commit leaves no role grant or scope row behind', async () => {
    const client = await runtime.connect();
    let threw = false;
    try {
      await client.query('BEGIN');
      await setContext(client, AS_COMPANY);
      await client.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'unrestricted',$5,$5)`,
        ['c0000000-0000-4000-8000-00000000fa11', TENANT_A, U_GRANTEE, ROLE_TARGET, U_COMPANY]
      );
      await client.query('COMMIT'); // deferred backstop fires here → throws
    } catch {
      threw = true;
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(threw).toBe(true);
    const left = await admin.query(`SELECT 1 FROM iam.role_grants WHERE id = $1`, [
      'c0000000-0000-4000-8000-00000000fa11',
    ]);
    expect(left.rowCount).toBe(0);
  });

  it('25. revoking the administrator authority removes it immediately', async () => {
    // With the company admin's own authority revoked, has_permission is false and
    // a subsequent grant attempt is refused by the delegability policy (42501).
    await admin.query(
      `UPDATE iam.role_grants SET status='revoked', revoked_at=now(), revoke_reason='revoked for test'
        WHERE user_id=$1 AND status='active'`,
      [U_COMPANY]
    );
    try {
      await withRolledBackTx(runtime, AS_COMPANY, (c) =>
        expectSqlState(
          c.query(
            `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
             VALUES ($1,$2,$3,'scoped',$4,$4)`,
            [TENANT_A, U_GRANTEE, ROLE_TARGET, U_COMPANY]
          ),
          '42501'
        )
      );
    } finally {
      await admin.query(
        `UPDATE iam.role_grants SET status='active', revoked_at=NULL, revoke_reason=NULL
          WHERE user_id=$1`,
        [U_COMPANY]
      );
    }
  });
});
