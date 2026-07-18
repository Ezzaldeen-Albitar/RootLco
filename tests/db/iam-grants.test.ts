/**
 * Phase 1-4 Increment C — iam.role_grants / iam.grant_scopes
 * (P1-04-DB-008..009, §19.D deferred scope integrity).
 *
 * The deferred "scoped active grant needs ≥1 scope" rule is exercised with
 * `SET CONSTRAINTS ALL IMMEDIATE` inside a rolled-back transaction (forces the
 * INITIALLY DEFERRED constraint to fire without committing) and with real
 * concurrent commits. Isolation assertions run as the non-owner runtime login.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  TENANT_A,
  TENANT_B,
  USER_A,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const ACC_A = 'a0400000-0000-4000-8000-000000000001';
const ACC_B = 'b0400000-0000-4000-8000-000000000001';
const R_A = 'd0400000-0000-4000-8000-000000000001';
const R_B = 'd0400000-0000-4000-8000-00000000000b';
const COMPANY_A2 = 'a1000000-0000-4000-8000-000000000002';
const BRANCH_A2 = 'a1100000-0000-4000-8000-000000000002';
const DEPT_A1 = 'a1200000-0000-4000-8000-000000000001';
const COMPANY_B1 = 'b1000000-0000-4000-8000-000000000001';
const GRANTER = USER_A;

let admin: Pool;
let runtime: Pool;

async function seed(): Promise<void> {
  // Users and roles in each tenant.
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$3,'supabase','grantee_a','ga@example.com','Grantee A','active',$5),
            ($2,$4,'supabase','grantee_b','gb@example.com','Grantee B','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [ACC_A, ACC_B, TENANT_A, TENANT_B, GRANTER]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$3,'grant_role_a','Role A',$5), ($2,$4,'grant_role_b','Role B',$5)
     ON CONFLICT (id) DO NOTHING`,
    [R_A, R_B, TENANT_A, TENANT_B, GRANTER]
  );
  // A second company/branch in tenant A (cross-company target) and a dept.
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$3,'company_a2','Company A2','USD',$5), ($2,$4,'company_b1','Company B1','USD',$5)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_A2, COMPANY_B1, TENANT_A, TENANT_B, GRANTER]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_a2','Branch A2','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A2, GRANTER]
  );
  await admin.query(
    `INSERT INTO org.departments (id, tenant_id, company_id, branch_id, department_code, name, created_by)
     VALUES ($1,$2,$3,$4,'dept_a1','Dept A1',$5) ON CONFLICT (id) DO NOTHING`,
    [DEPT_A1, TENANT_A, COMPANY_A1, BRANCH_A1, GRANTER]
  );
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

describe('iam.role_grants — creation, isolation, and self-grant denial', () => {
  it('an unrestricted grant needs no scope and satisfies the deferred check', async () => {
    await withRolledBackTx(admin, { userId: GRANTER }, async (c) => {
      await c.query(
        `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, granted_by, created_by)
         VALUES ($1,$2,$3,$4,$4)`,
        [TENANT_A, ACC_A, R_A, GRANTER]
      );
      await c.query('SET CONSTRAINTS ALL IMMEDIATE'); // must not throw
      expect(true).toBe(true);
    });
  });

  it('denies a self-grant (granted_by = grantee)', async () => {
    await withRolledBackTx(admin, { userId: ACC_A }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, granted_by, created_by)
           VALUES ($1,$2,$3,$2,$2)`,
          [TENANT_A, ACC_A, R_A]
        ),
        '23514'
      )
    );
  });

  it('rejects a grant to a user from another tenant (composite FK)', async () => {
    await withRolledBackTx(admin, { userId: GRANTER }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, granted_by, created_by)
           VALUES ($1,$2,$3,$4,$4)`,
          [TENANT_A, ACC_B, R_A, GRANTER]
        ),
        '23503'
      )
    );
  });

  it('runtime sees only its own tenant grants and cannot write grants', async () => {
    // Seed one committed grant in tenant A, clean it up after.
    const gid = 'aa000000-0000-4000-8000-0000000000c1';
    await withCommittedTx(admin, { userId: GRANTER }, (c) =>
      c.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, granted_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$5)`,
        [gid, TENANT_A, ACC_A, R_A, GRANTER]
      )
    );
    try {
      const a = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACC_A }, (c) =>
        c.query(`SELECT id FROM iam.role_grants WHERE id = $1`, [gid])
      );
      expect(a.rows).toHaveLength(1);
      const b = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: ACC_B }, (c) =>
        c.query(`SELECT id FROM iam.role_grants WHERE id = $1`, [gid])
      );
      expect(b.rows).toHaveLength(0);
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACC_A }, (c) =>
        expectSqlState(c.query(`DELETE FROM iam.role_grants WHERE id = $1`, [gid]), '42501')
      );
    } finally {
      await admin.query(`DELETE FROM iam.role_grants WHERE id = $1`, [gid]);
    }
  });

  it('scope_mode and identity columns are immutable', async () => {
    const gid = 'aa000000-0000-4000-8000-0000000000c2';
    await withRolledBackTx(admin, { userId: GRANTER }, async (c) => {
      await c.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, granted_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$5)`,
        [gid, TENANT_A, ACC_A, R_A, GRANTER]
      );
      await expectSqlState(
        c.query(`UPDATE iam.role_grants SET scope_mode='scoped' WHERE id=$1`, [gid]),
        '23514'
      );
    });
  });
});

describe('iam.grant_scopes — scoping and cross-tenant/company safety', () => {
  async function withScopedGrant(
    body: (c: { query: Pool['query'] }, gid: string) => Promise<void>
  ) {
    const gid = 'aa000000-0000-4000-8000-0000000000d0';
    await withRolledBackTx(admin, { userId: GRANTER }, async (c) => {
      await c.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [gid, TENANT_A, ACC_A, R_A, GRANTER]
      );
      await body(c, gid);
    });
  }

  it('accepts company, branch, and department scopes in one transaction', async () => {
    await withScopedGrant(async (c, gid) => {
      await c.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by) VALUES ($1,$2,'company',$3,$4)`,
        [TENANT_A, gid, COMPANY_A1, GRANTER]
      );
      await c.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by) VALUES ($1,$2,'branch',$3,$4,$5)`,
        [TENANT_A, gid, COMPANY_A1, BRANCH_A1, GRANTER]
      );
      await c.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, department_id, created_by) VALUES ($1,$2,'department',$3,$4,$5,$6)`,
        [TENANT_A, gid, COMPANY_A1, BRANCH_A1, DEPT_A1, GRANTER]
      );
      await c.query('SET CONSTRAINTS ALL IMMEDIATE'); // all valid → no throw
      expect(true).toBe(true);
    });
  });

  it('rejects a company scope from another tenant (composite FK)', async () => {
    await withScopedGrant(async (c, gid) => {
      await expectSqlState(
        c.query(
          `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by) VALUES ($1,$2,'company',$3,$4)`,
          [TENANT_A, gid, COMPANY_B1, GRANTER]
        ),
        '23503'
      );
    });
  });

  it('rejects a branch that does not belong to the scoped company (cross-company)', async () => {
    await withScopedGrant(async (c, gid) => {
      // BRANCH_A2 belongs to COMPANY_A2, not COMPANY_A1 → composite FK violation.
      await expectSqlState(
        c.query(
          `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by) VALUES ($1,$2,'branch',$3,$4,$5)`,
          [TENANT_A, gid, COMPANY_A1, BRANCH_A2, GRANTER]
        ),
        '23503'
      );
    });
  });

  it('rejects a malformed scope (branch type without a branch_id)', async () => {
    await withScopedGrant(async (c, gid) => {
      await expectSqlState(
        c.query(
          `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by) VALUES ($1,$2,'branch',$3,$4)`,
          [TENANT_A, gid, COMPANY_A1, GRANTER]
        ),
        '23514'
      );
    });
  });
});

describe('§19.D — deferred scope integrity', () => {
  it('a scoped active grant with no scope fails the deferred check', async () => {
    await withRolledBackTx(admin, { userId: GRANTER }, async (c) => {
      await c.query(
        `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,'scoped',$4,$4)`,
        [TENANT_A, ACC_A, R_A, GRANTER]
      );
      await expectSqlState(c.query('SET CONSTRAINTS ALL IMMEDIATE'), '23514');
    });
  });

  it('removing the last scope of a scoped active grant is rejected', async () => {
    const gid = 'aa000000-0000-4000-8000-0000000000e0';
    // Commit a scoped grant with one scope, then try to strip its last scope.
    await withCommittedTx(admin, { userId: GRANTER }, async (c) => {
      await c.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
         VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
        [gid, TENANT_A, ACC_A, R_A, GRANTER]
      );
      await c.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by) VALUES ($1,$2,'company',$3,$4)`,
        [TENANT_A, gid, COMPANY_A1, GRANTER]
      );
    });
    try {
      await withRolledBackTx(admin, { userId: GRANTER }, async (c) => {
        await c.query(`DELETE FROM iam.grant_scopes WHERE grant_id=$1`, [gid]);
        await expectSqlState(c.query('SET CONSTRAINTS ALL IMMEDIATE'), '23514');
      });
    } finally {
      await admin.query(`DELETE FROM iam.role_grants WHERE id=$1`, [gid]); // cascade scopes
    }
  });

  it('concurrent scoped-grant creations each keep their scope (no bypass)', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `aa000000-0000-4000-8000-0000000000f${i}`);
    try {
      await Promise.all(
        ids.map((gid) =>
          withCommittedTx(admin, { userId: GRANTER }, async (c) => {
            await c.query(
              `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
               VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
              [gid, TENANT_A, ACC_A, R_A, GRANTER]
            );
            await c.query(
              `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by) VALUES ($1,$2,'company',$3,$4)`,
              [TENANT_A, gid, COMPANY_A1, GRANTER]
            );
          })
        )
      );
      const { rows } = await admin.query(
        `SELECT grant_id FROM iam.grant_scopes WHERE grant_id = ANY($1::uuid[])`,
        [ids]
      );
      expect(new Set(rows.map((r) => r.grant_id)).size).toBe(5);
    } finally {
      await admin.query(`DELETE FROM iam.role_grants WHERE id = ANY($1::uuid[])`, [ids]);
    }
  });
});

describe('iam.role_grants — active-grant predicate (expiry and revocation)', () => {
  const ACTIVE = `status='active' AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`;
  const G_ACTIVE = 'aa000000-0000-4000-8000-00000000aa01';
  const G_EXPIRED = 'aa000000-0000-4000-8000-00000000aa02';
  const G_REVOKED = 'aa000000-0000-4000-8000-00000000aa03';

  it('an in-window active grant is active; expired and revoked are not', async () => {
    await withRolledBackTx(admin, { userId: GRANTER }, async (c) => {
      await c.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, granted_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$5)`,
        [G_ACTIVE, TENANT_A, ACC_A, R_A, GRANTER]
      );
      await c.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, granted_by, created_by, valid_from, valid_to)
         VALUES ($1,$2,$3,$4,$5,$5, now() - interval '10 days', now() - interval '1 day')`,
        [G_EXPIRED, TENANT_A, ACC_A, R_A, GRANTER]
      );
      await c.query(
        `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, granted_by, created_by, status, revoked_at, revoke_reason)
         VALUES ($1,$2,$3,$4,$5,$5, 'revoked', now(), 'left company')`,
        [G_REVOKED, TENANT_A, ACC_A, R_A, GRANTER]
      );
      const { rows } = await c.query(
        `SELECT id, (${ACTIVE}) AS is_active FROM iam.role_grants
         WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[G_ACTIVE, G_EXPIRED, G_REVOKED]]
      );
      expect(rows.map((r) => r.is_active)).toEqual([true, false, false]);
    });
  });
});
