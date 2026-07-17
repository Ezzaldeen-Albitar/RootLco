/**
 * Phase 1-3 — legal companies, branches, branch status history
 * (P1-03-DB-005/006/007, P1-03-QA-001/002 subsets).
 *
 * Isolation and lifecycle assertions run as the NON-OWNER runtime login.
 * Admin provisions fixtures only — never RLS evidence.
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
  USER_B,
  withRolledBackTx,
} from './helpers';

let admin: Pool;
let runtime: Pool;
/** A company owned by tenant B, provisioned by admin for cross-tenant probes. */
let companyB1: string;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  const b = await admin.query(
    `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, 'company_b1', 'Fixture Company B1', 'USD', $2) RETURNING id`,
    [TENANT_B, USER_B]
  );
  companyB1 = b.rows[0].id;
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('org.legal_companies — tenant-scoped CRUD as the runtime role', () => {
  it('a tenant session creates a company in its own tenant', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
         VALUES ($1, 'created_by_runtime', 'Runtime Co', 'USD', $2) RETURNING id, status`,
        [TENANT_A, USER_A]
      );
      expect(rows[0].status).toBe('active');
    });
  });

  it('a tenant session cannot create a company inside ANOTHER tenant (WITH CHECK → 42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
           VALUES ($1, 'smuggled', 'Smuggled Co', 'USD', $2)`,
          [TENANT_B, USER_A]
        ),
        '42501'
      );
    });
  });

  it('tenant A sees only its own companies; B rows are invisible even by id', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      const all = await c.query('SELECT tenant_id FROM org.legal_companies');
      expect(all.rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
      const direct = await c.query('SELECT id FROM org.legal_companies WHERE id = $1', [companyB1]);
      expect(direct.rows).toHaveLength(0);
    });
  });

  it('cross-tenant UPDATE affects zero rows', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const r = await c.query(
        `UPDATE org.legal_companies SET legal_name = 'defaced' WHERE id = $1`,
        [companyB1]
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it('company narrowing: a session narrowed to one company cannot see the others', async () => {
    const other = await admin.query(
      `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
       VALUES ($1, 'company_a2', 'Fixture Company A2', 'USD', $2) RETURNING id`,
      [TENANT_A, USER_A]
    );
    try {
      await withRolledBackTx(
        runtime,
        { tenantId: TENANT_A, companyIds: [COMPANY_A1] },
        async (c) => {
          const { rows } = await c.query('SELECT id FROM org.legal_companies');
          expect(rows.map((r) => r.id)).toEqual([COMPANY_A1]);
        }
      );
    } finally {
      await admin.query('DELETE FROM org.legal_companies WHERE id = $1', [other.rows[0].id]);
    }
  });
});

describe('org.legal_companies — integrity', () => {
  it('duplicate ACTIVE company code within a tenant is rejected (23505)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
         VALUES ($1, 'company_a1', 'Duplicate', 'USD', $2)`,
        [TENANT_A, USER_A]
      ),
      '23505'
    );
  });

  it('the SAME code in a DIFFERENT tenant is allowed (scope-local uniqueness)', async () => {
    const { rows } = await admin.query(
      `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
       VALUES ($1, 'company_a1', 'Same code, other tenant', 'USD', $2) RETURNING id`,
      [TENANT_B, USER_B]
    );
    await admin.query('DELETE FROM org.legal_companies WHERE id = $1', [rows[0].id]);
  });

  it('soft delete frees the code for reuse (partial unique index)', async () => {
    const first = await admin.query(
      `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
       VALUES ($1, 'reusable_co', 'First life', 'USD', $2) RETURNING id`,
      [TENANT_A, USER_A]
    );
    await admin.query(
      `UPDATE org.legal_companies SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
      [first.rows[0].id, USER_A]
    );
    const second = await admin.query(
      `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
       VALUES ($1, 'reusable_co', 'Second life', 'USD', $2) RETURNING id`,
      [TENANT_A, USER_A]
    );
    await admin.query('DELETE FROM org.legal_companies WHERE id IN ($1, $2)', [
      first.rows[0].id,
      second.rows[0].id,
    ]);
  });

  it('base currency must reference platform reference data (23503)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
         VALUES ($1, 'bad_currency_co', 'Bad', 'ZZZ', $2)`,
        [TENANT_A, USER_A]
      ),
      '23503'
    );
  });

  it('tenant_id and company_code are immutable (23514)', async () => {
    await expectSqlState(
      admin.query(`UPDATE org.legal_companies SET tenant_id = $1 WHERE id = $2`, [
        TENANT_B,
        COMPANY_A1,
      ]),
      '23514'
    );
  });
});

describe('org.branches — composite-scope integrity', () => {
  it("a branch cannot reference another tenant's company — FK violation, not a filter (23503)", async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
         VALUES ($1, $2, 'crosslink', 'Cross-tenant branch', 'UTC', $3)`,
        [TENANT_A, companyB1, USER_A]
      ),
      '23503'
    );
  });

  it('duplicate ACTIVE branch code within tenant+company is rejected (23505)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
         VALUES ($1, $2, 'branch_a1', 'Duplicate', 'UTC', $3)`,
        [TENANT_A, COMPANY_A1, USER_A]
      ),
      '23505'
    );
  });

  it('the same branch code under ANOTHER company/tenant is allowed', async () => {
    const { rows } = await admin.query(
      `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
       VALUES ($1, $2, 'branch_a1', 'Same code, other tenant', 'UTC', $3) RETURNING id`,
      [TENANT_B, companyB1, USER_B]
    );
    await admin.query('DELETE FROM org.branches WHERE id = $1', [rows[0].id]);
  });

  it('timezone must reference the approved IANA approval list (23503)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
         VALUES ($1, $2, 'bad_tz', 'Bad TZ', 'Not/AZone', $3)`,
        [TENANT_A, COMPANY_A1, USER_A]
      ),
      '23503'
    );
  });

  it('a soft-deleted or archived company rejects NEW branches (guard → 23514)', async () => {
    const dead = await admin.query(
      `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by, archived_at, archived_by)
       VALUES ($1, 'archived_co', 'Archived Co', 'USD', $2, now(), $2) RETURNING id`,
      [TENANT_A, USER_A]
    );
    try {
      await expectSqlState(
        admin.query(
          `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
           VALUES ($1, $2, 'orphan', 'Orphan branch', 'UTC', $3)`,
          [TENANT_A, dead.rows[0].id, USER_A]
        ),
        '23514'
      );
    } finally {
      await admin.query('DELETE FROM org.legal_companies WHERE id = $1', [dead.rows[0].id]);
    }
  });

  it('branch scope columns are immutable (23514)', async () => {
    await expectSqlState(
      admin.query(`UPDATE org.branches SET company_id = $1 WHERE id = $2`, [companyB1, BRANCH_A1]),
      '23514'
    );
  });

  it('tenant A sees its branch; tenant B sees none; branch narrowing works', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      const { rows } = await c.query('SELECT id FROM org.branches');
      expect(rows.map((r) => r.id)).toContain(BRANCH_A1);
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_B }, async (c) => {
      const { rows } = await c.query('SELECT id FROM org.branches WHERE id = $1', [BRANCH_A1]);
      expect(rows).toHaveLength(0);
    });
    await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, branchIds: ['00000000-0000-4000-8000-00000000dead'] },
      async (c) => {
        const { rows } = await c.query('SELECT id FROM org.branches');
        expect(rows).toHaveLength(0);
      }
    );
  });
});

describe('org.change_branch_status — atomic, runtime-executable, append-only history', () => {
  it('a runtime session deactivates its own branch; history row lands atomically', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(`SELECT org.change_branch_status($1, 'inactive', 'seasonal closure')`, [
        BRANCH_A1,
      ]);
      const b = await c.query('SELECT status FROM org.branches WHERE id = $1', [BRANCH_A1]);
      expect(b.rows[0].status).toBe('inactive');
      const h = await c.query(
        `SELECT from_state, to_state, reason, actor_id FROM org.branch_status_history WHERE branch_id = $1`,
        [BRANCH_A1]
      );
      expect(h.rows).toHaveLength(1);
      expect(h.rows[0]).toMatchObject({
        from_state: 'active',
        to_state: 'inactive',
        reason: 'seasonal closure',
        actor_id: USER_A,
      });
    });
    // The rolled-back transaction reverted both the status and the history.
    const after = await admin.query(
      'SELECT status, (SELECT count(*)::int FROM org.branch_status_history WHERE branch_id = $1) AS h FROM org.branches WHERE id = $1',
      [BRANCH_A1]
    );
    expect(after.rows[0].status).toBe('active');
    expect(after.rows[0].h).toBe(0);
  });

  it('deactivation without a reason is rejected (23514)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`SELECT org.change_branch_status($1, 'inactive', '  ')`, [BRANCH_A1]),
        '23514'
      );
    });
  });

  it("another tenant's session cannot transition the branch (RLS: not found → P0002)", async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_B }, async (c) => {
      await expectSqlState(
        c.query(`SELECT org.change_branch_status($1, 'inactive', 'hostile takeover')`, [BRANCH_A1]),
        'P0002'
      );
    });
  });

  it('runtime cannot rewrite or purge branch history (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`UPDATE org.branch_status_history SET reason = 'rewritten'`),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(c.query('DELETE FROM org.branch_status_history'), '42501');
    });
  });

  it('runtime cannot forge history for another tenant (WITH CHECK → 42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO org.branch_status_history (tenant_id, branch_id, from_state, to_state, reason, actor_id)
           VALUES ($1, $2, 'active', 'inactive', 'forged', $3)`,
          [TENANT_B, BRANCH_A1, USER_A]
        ),
        '42501'
      );
    });
  });
});
