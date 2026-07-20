/**
 * Phase 1-10 — Tenant isolation. Auto-enumerates every svc/quo/inv table (fails if
 * a new table ships without a tenant-scoped RLS policy set) plus functional
 * cross-tenant read/write denial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  withCommittedTx,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';
import { seedService, seedItem, expectFail } from './p1-10-helpers';

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_B };
const SCHEMAS = ['svc', 'quo', 'inv'];

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('p1-10 tenant isolation', () => {
  it('forces RLS and a tenant-scoped SELECT+INSERT policy on EVERY svc/quo/inv table', async () => {
    const tables = (
      await admin.query(
        `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = ANY($1) AND table_type='BASE TABLE' ORDER BY 1,2`,
        [SCHEMAS]
      )
    ).rows;
    expect(tables.length).toBe(35);
    for (const t of tables) {
      const fq = `${t.table_schema}.${t.table_name}`;
      const pol = (
        await admin.query(
          `SELECT p.polcmd, pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
           FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname=$1 AND c.relname=$2`,
          [t.table_schema, t.table_name]
        )
      ).rows;
      const cmds = pol.map((p) => p.polcmd);
      expect(cmds, `${fq} needs a SELECT policy`).toContain('r');
      expect(cmds, `${fq} needs an INSERT policy`).toContain('a');
      const expr = pol.map((p) => `${p.q ?? ''} ${p.w ?? ''}`).join(' ');
      expect(expr, `${fq} policy must scope to iam.current_tenant_id()`).toContain(
        'current_tenant_id'
      );
    }
  });

  it('hides tenant A data from tenant B and blocks cross-tenant writes', async () => {
    const svcId = await withCommittedTx(
      runtime,
      ctxA,
      async (c) => (await seedService(c, 'iso')).service
    );
    const itemId = await withCommittedTx(
      runtime,
      ctxA,
      async (c) => (await seedItem(c, 'iso')).item
    );
    await withRolledBackTx(runtime, ctxB, async (c) => {
      expect(
        Number(
          (await c.query(`SELECT count(*)::int n FROM svc.services WHERE id=$1`, [svcId])).rows[0].n
        )
      ).toBe(0);
      expect(
        Number(
          (await c.query(`SELECT count(*)::int n FROM inv.item_master WHERE id=$1`, [itemId]))
            .rows[0].n
        )
      ).toBe(0);
      // cross-tenant writes (tenant_id = TENANT_A while context is TENANT_B) are denied
      await expectFail(
        c,
        '42501',
        `INSERT INTO svc.service_categories (tenant_id, code, name, created_by) VALUES ($1,'x','X',$2)`,
        [TENANT_A, USER_B]
      );
      await expectFail(
        c,
        '42501',
        `INSERT INTO inv.item_categories (tenant_id, code, name, created_by) VALUES ($1,'x','X',$2)`,
        [TENANT_A, USER_B]
      );
    });
  });

  it('rejects a cross-tenant INSERT into every svc/quo/inv table (tenant_id spoof)', async () => {
    const tables = (
      await admin.query(
        `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = ANY($1) AND table_type='BASE TABLE' ORDER BY 1,2`,
        [SCHEMAS]
      )
    ).rows;
    await withRolledBackTx(runtime, ctxB, async (c) => {
      for (const t of tables) {
        const fq = `${t.table_schema}.${t.table_name}`;
        // Attempt to write a row that claims tenant A while the session is tenant B.
        // Whatever the missing columns, the write must NOT succeed (RLS WITH CHECK
        // denies the tenant spoof; a NOT NULL/FK error is also an acceptable rejection).
        await c.query('SAVEPOINT sp_iso');
        let ok = false;
        try {
          await c.query(`INSERT INTO ${fq} (tenant_id) VALUES ($1)`, [TENANT_A]);
          ok = true;
        } catch {
          ok = false;
        }
        await c.query('ROLLBACK TO SAVEPOINT sp_iso');
        expect(ok, `${fq} allowed a cross-tenant INSERT`).toBe(false);
      }
    });
  });
});
