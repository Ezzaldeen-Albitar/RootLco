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

  it('a direct history insert cannot spoof the actor or backdate — the trigger server-stamps both', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO org.branch_status_history (tenant_id, branch_id, from_state, to_state, reason, actor_id, occurred_at)
         VALUES ($1, $2, 'active', 'inactive', 'attempted forgery', '99999999-9999-4999-8999-999999999999', '2000-01-01T00:00:00Z')
         RETURNING actor_id, occurred_at`,
        [TENANT_A, BRANCH_A1]
      );
      // The spoofed actor and backdate were overwritten from the session context.
      expect(rows[0].actor_id).toBe(USER_A);
      expect(new Date(rows[0].occurred_at).getFullYear()).toBeGreaterThanOrEqual(2026);
    });
  });

  it('a direct history insert with no session user is rejected (23514)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO org.branch_status_history (tenant_id, branch_id, from_state, to_state, reason, actor_id)
           VALUES ($1, $2, 'active', 'inactive', 'no actor', $3)`,
          [TENANT_A, BRANCH_A1, USER_A]
        ),
        '23514'
      );
    });
  });
});

describe('org.legal_companies — creation attribution is immutable (adversarial-review fix)', () => {
  it('a runtime session cannot rewrite created_by or created_at (23514)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`UPDATE org.legal_companies SET created_by = $1 WHERE id = $2`, [
          USER_B,
          COMPANY_A1,
        ]),
        '23514'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`UPDATE org.legal_companies SET created_at = now() WHERE id = $1`, [COMPANY_A1]),
        '23514'
      );
    });
  });

  it('a legitimate field update still works and stamps updated_by (attribution intact)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const before = await c.query('SELECT created_by FROM org.legal_companies WHERE id = $1', [
        COMPANY_A1,
      ]);
      await c.query(`UPDATE org.legal_companies SET legal_name = 'Renamed Co' WHERE id = $1`, [
        COMPANY_A1,
      ]);
      const after = await c.query(
        'SELECT created_by, updated_by, legal_name FROM org.legal_companies WHERE id = $1',
        [COMPANY_A1]
      );
      expect(after.rows[0].created_by).toBe(before.rows[0].created_by); // unchanged
      expect(after.rows[0].updated_by).toBe(USER_A); // trigger-stamped
      expect(after.rows[0].legal_name).toBe('Renamed Co');
    });
  });
});

// ---------------------------------------------------------------------------
// PRE-P1-29 Wave C — the legal-company status lifecycle.
//
// Every case runs inside withRolledBackTx, so residue is zero by construction
// rather than by a cleanup step that can be forgotten.
//
// The company subsystem differs from the branch precedent directly above in one
// respect, and these proofs are mostly about that one: history is emitted by a
// trigger on org.legal_companies rather than written by the transition function,
// so a RAW UPDATE cannot bypass the record. C7 and C8 are that difference.
// ---------------------------------------------------------------------------
describe('org.change_company_status — two-state lifecycle, emitter-owned history', () => {
  const companyHistory = async (
    c: { query: Pool['query'] },
    companyId: string
  ): Promise<{ rows: Record<string, unknown>[] }> =>
    c.query(
      `SELECT from_state, to_state, reason, actor_id, occurred_at, correlation_id
         FROM org.company_status_history WHERE company_id = $1 ORDER BY occurred_at`,
      [companyId]
    );

  it('C1 deactivates a company, emitting EXACTLY one server-attributed history row', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(`SELECT org.change_company_status($1, 'inactive', 'ceased trading')`, [
        COMPANY_A1,
      ]);
      const company = await c.query('SELECT status FROM org.legal_companies WHERE id = $1', [
        COMPANY_A1,
      ]);
      expect(company.rows[0].status).toBe('inactive');

      const h = await companyHistory(c, COMPANY_A1);
      // EXACTLY one. Not "at least one": the emitter is the only writer, and a
      // second row would mean the function had started inserting as well —
      // precisely the duplication this arrangement exists to make impossible.
      expect(h.rows).toHaveLength(1);
      expect(h.rows[0]).toMatchObject({
        from_state: 'active',
        to_state: 'inactive',
        reason: 'ceased trading',
        // Server-derived by shared.stamp_status_history() from the SESSION, never
        // from an argument — org.change_company_status has no actor parameter at all.
        actor_id: USER_A,
      });
      expect(h.rows[0].correlation_id).toBeNull();
    });

    // Zero residue: the rollback reverted the status AND the history row.
    const after = await admin.query(
      `SELECT status, (SELECT count(*)::int FROM org.company_status_history WHERE company_id = $1) AS h
         FROM org.legal_companies WHERE id = $1`,
      [COMPANY_A1]
    );
    expect(after.rows[0].status).toBe('active');
    expect(after.rows[0].h).toBe(0);
  });

  it('C2 reactivates: the reverse edge is legal, because two states have no illegal edge', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(`SELECT org.change_company_status($1, 'inactive', 'first')`, [COMPANY_A1]);
      await c.query(`SELECT org.change_company_status($1, 'active', 'reopened')`, [COMPANY_A1]);

      const company = await c.query('SELECT status FROM org.legal_companies WHERE id = $1', [
        COMPANY_A1,
      ]);
      expect(company.rows[0].status).toBe('active');

      const h = await companyHistory(c, COMPANY_A1);
      expect(h.rows).toHaveLength(2);
      expect(h.rows.map((r) => `${r.from_state}->${r.to_state}`)).toEqual([
        'active->inactive',
        'inactive->active',
      ]);
      // The second reason did not inherit the first: change_company_status clears
      // app.status_reason after its UPDATE, so a later transition in the SAME
      // transaction cannot silently reuse it.
      expect(h.rows[1].reason).toBe('reopened');
    });
  });

  it('C3 refuses a blank reason (23514)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`SELECT org.change_company_status($1, 'inactive', '   ')`, [COMPANY_A1]),
        '23514'
      );
    });
  });

  it('C4 refuses a no-op transition (23514)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`SELECT org.change_company_status($1, 'active', 'already there')`, [COMPANY_A1]),
        '23514'
      );
    });
  });

  it('C5 refuses a destination outside the two-state vocabulary (23514)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      // 'suspended' is a TENANT state. Companies must not acquire the tenant graph
      // by accident, and this is the case that would go red if they did.
      await expectSqlState(
        c.query(`SELECT org.change_company_status($1, 'suspended', 'wrong graph')`, [COMPANY_A1]),
        '23514'
      );
    });
  });

  it('C6 refuses another tenant, and leaves no trace (RLS: P0002 + zero delta)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_B }, async (c) => {
      await expectSqlState(
        c.query(`SELECT org.change_company_status($1, 'inactive', 'hostile')`, [COMPANY_A1]),
        'P0002'
      );
    });
    // Asserting the error alone would pass even if the refusal happened AFTER a
    // partial write, so the side effect is measured independently.
    const after = await admin.query(
      `SELECT status, (SELECT count(*)::int FROM org.company_status_history WHERE company_id = $1) AS h
         FROM org.legal_companies WHERE id = $1`,
      [COMPANY_A1]
    );
    expect(after.rows[0].status).toBe('active');
    expect(after.rows[0].h).toBe(0);
  });

  it('C7 refuses a RAW UPDATE that publishes no reason — the branch precedent does not', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      // This is the whole reason history is emitted rather than written by the
      // function. Run against org.branches, the equivalent statement SUCCEEDS and
      // silently records nothing; here the emitter raises.
      await expectSqlState(
        c.query(`UPDATE org.legal_companies SET status = 'inactive' WHERE id = $1`, [COMPANY_A1]),
        '23514'
      );
    });
  });

  it('C8 records a RAW UPDATE that DOES publish a reason — bypass is impossible, not merely discouraged', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(`SELECT set_config('app.status_reason', 'raw but accounted for', true)`);
      const updated = await c.query(
        `UPDATE org.legal_companies SET status = 'inactive' WHERE id = $1`,
        [COMPANY_A1]
      );
      // Assert the UPDATE actually landed before concluding anything about
      // history: a refused UPDATE would otherwise read as "no bypass" for the
      // wrong reason.
      expect(updated.rowCount).toBe(1);

      const h = await companyHistory(c, COMPANY_A1);
      expect(h.rows).toHaveLength(1);
      expect(h.rows[0]).toMatchObject({
        from_state: 'active',
        to_state: 'inactive',
        reason: 'raw but accounted for',
        actor_id: USER_A,
      });
    });
  });

  it('C9 is append-only: no UPDATE or DELETE grant exists, and neither verb is reachable', async () => {
    // The GRANT BITS, not just the refusal. FORCE RLS with no UPDATE policy would
    // refuse the write even if the grant were later added, so a refusal-only test
    // would keep passing after the control was removed.
    const bits = await admin.query(
      `SELECT
         has_table_privilege('app_runtime',  'org.company_status_history', 'SELECT') AS r_sel,
         has_table_privilege('app_runtime',  'org.company_status_history', 'INSERT') AS r_ins,
         has_table_privilege('app_runtime',  'org.company_status_history', 'UPDATE') AS r_upd,
         has_table_privilege('app_runtime',  'org.company_status_history', 'DELETE') AS r_del,
         has_table_privilege('app_readonly', 'org.company_status_history', 'SELECT') AS o_sel,
         has_table_privilege('app_readonly', 'org.company_status_history', 'INSERT') AS o_ins,
         has_table_privilege('app_platform', 'org.company_status_history', 'SELECT') AS p_sel,
         has_table_privilege('app_platform', 'org.company_status_history', 'INSERT') AS p_ins`
    );
    expect(bits.rows[0]).toEqual({
      r_sel: true,
      r_ins: true,
      r_upd: false,
      r_del: false,
      o_sel: true,
      o_ins: false,
      // The control plane provisions a company; running its lifecycle is a
      // tenant-scoped act, so app_platform holds nothing here.
      p_sel: false,
      p_ins: false,
    });

    // One refusal per transaction. The first error ABORTS the transaction, so a
    // second statement in the same one returns 25P02 ("current transaction is
    // aborted") rather than its own SQLSTATE — which would have made this case
    // assert 42501 and measure the abort instead.
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`UPDATE org.company_status_history SET reason = 'rewritten'`),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(c.query('DELETE FROM org.company_status_history'), '42501');
    });
  });

  it('C10 refuses a forged history row that disagrees with the company (23514)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      // The company is 'active'. Exactly ONE input is varied away from a row the
      // guard would admit — to_state — so the refusal can only be the coherence
      // guard. A blank reason, an equal from/to pair or another tenant’s company
      // would each be refused by something else and prove nothing about it.
      await expectSqlState(
        c.query(
          `INSERT INTO org.company_status_history
             (tenant_id, company_id, from_state, to_state, reason, actor_id)
           VALUES ($1, $2, 'active', 'inactive', 'claiming a transition that never happened', $3)`,
          [TENANT_A, COMPANY_A1, USER_A]
        ),
        '23514'
      );
    });
  });

  it('C11 overwrites a caller-supplied actor and occurred_at rather than trusting them', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      // Coherent by construction: the company IS 'active', so to_state 'active'
      // satisfies the guard, and from_state 'inactive' satisfies the state-change
      // CHECK. The insert must SUCCEED — the assertion is on the STORED ROW,
      // because a refusal here would prove nothing about the stamp.
      await c.query(
        `INSERT INTO org.company_status_history
           (tenant_id, company_id, from_state, to_state, reason, actor_id, occurred_at)
         VALUES ($1, $2, 'inactive', 'active', 'forged', $3, '2020-01-01T00:00:00Z')`,
        [TENANT_A, COMPANY_A1, USER_B]
      );
      const h = await companyHistory(c, COMPANY_A1);
      expect(h.rows).toHaveLength(1);
      // USER_B was supplied; USER_A is the session. The session wins.
      expect(h.rows[0].actor_id).toBe(USER_A);
      expect(new Date(h.rows[0].occurred_at as string).getUTCFullYear()).toBeGreaterThan(2020);
    });
  });

  it('C12 pins the residual: deactivation gates nothing, so a branch may still be created', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(`SELECT org.change_company_status($1, 'inactive', 'pinning the residual')`, [
        COMPANY_A1,
      ]);
      // Confirm the precondition in the same transaction, or the insert below
      // succeeds for the wrong reason.
      const company = await c.query('SELECT status FROM org.legal_companies WHERE id = $1', [
        COMPANY_A1,
      ]);
      expect(company.rows[0].status).toBe('inactive');

      // org.guard_parent_company_live() reads deleted_at and archived_at and
      // never reads status — measured, the word does not occur in its body. So
      // an inactive company still receives new branches. This test exists to PIN
      // that, not to bless it: if the guard is ever made status-aware, this case
      // goes red and forces the change to be deliberate rather than incidental.
      const branch = await c.query(
        `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
         VALUES ($1, $2, 'wc_residual', 'Branch under an inactive company', 'UTC', $3)
         RETURNING id`,
        [TENANT_A, COMPANY_A1, USER_A]
      );
      expect(branch.rows).toHaveLength(1);
    });
  });
});
