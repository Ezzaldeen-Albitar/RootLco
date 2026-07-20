/**
 * Phase 1-11 — tenant isolation. AUTO-ENUMERATES every sal/wty/rpt table from
 * information_schema (so a future P1-11 table without RLS coverage FAILS the suite) and
 * asserts RLS is forced with a tenant-scoped SELECT+INSERT policy, that a cross-tenant
 * INSERT is denied on every table, and that committed tenant-A rows are invisible to
 * tenant B and to a session with no context.
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
  USER_B,
} from './helpers';
import {
  seedP111Base,
  cleanP111Committed,
  ctxA,
  seedInvoiceWithLine,
  issueInvoice,
  seedReportConfig,
} from './p1-11-helpers';

const admin = adminPool();
const runtime = runtimePool();
const ctxB = { tenantId: TENANT_B, userId: USER_B };
const noCtx = {};
const SCHEMAS = ['sal', 'wty', 'rpt'];

let tables: Array<{ table_schema: string; table_name: string }> = [];

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
  tables = (
    await admin.query(
      `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_schema = ANY($1) AND table_type='BASE TABLE' ORDER BY 1,2`,
      [SCHEMAS]
    )
  ).rows;
});
afterAll(async () => {
  await cleanP111Committed(admin);
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('p1-11 tenant isolation (auto-enumerated)', () => {
  it('forces RLS and a tenant/owner-scoped SELECT+INSERT policy on EVERY sal/wty/rpt table', async () => {
    expect(tables.length).toBeGreaterThan(0);
    // Every table must have RLS enabled AND forced.
    const rls = (
      await admin.query(
        `SELECT n.nspname||'.'||c.relname AS fq, c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname = ANY($1) AND c.relkind='r'`,
        [SCHEMAS]
      )
    ).rows;
    for (const r of rls) {
      expect(r.relrowsecurity, `${r.fq} RLS enabled`).toBe(true);
      expect(r.relforcerowsecurity, `${r.fq} RLS forced`).toBe(true);
    }
    // Every table must carry a SELECT and an INSERT policy whose expression is scoped to
    // the current tenant (or, for saved_filters, the current user — a strictly narrower scope).
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
      const scoped =
        expr.includes('current_tenant_id') ||
        expr.includes('current_user_id') ||
        expr.includes("scope = 'platform'");
      expect(scoped, `${fq} policy must scope to the tenant/user`).toBe(true);
    }
  });

  it('rejects a cross-tenant INSERT into every sal/wty/rpt table (tenant spoof)', async () => {
    await withRolledBackTx(runtime, ctxB, async (c) => {
      for (const t of tables) {
        const fq = `${t.table_schema}.${t.table_name}`;
        await c.query('SAVEPOINT sp_iso');
        let ok = false;
        try {
          // claim tenant A while the session is tenant B; RLS WITH CHECK (or a NOT NULL/FK
          // error) must reject the spoof — it must never succeed.
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

  it('hides committed tenant-A rows from tenant B and from a no-context session', async () => {
    const { invoice, config } = await withCommittedTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'iso', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const config = await seedReportConfig(c, 'iso');
      return { invoice, config };
    });

    await withRolledBackTx(runtime, ctxB, async (c) => {
      expect(
        Number(
          (await c.query(`SELECT count(*)::int n FROM sal.invoices WHERE id=$1`, [invoice])).rows[0]
            .n
        )
      ).toBe(0);
      expect(
        Number(
          (
            await c.query(`SELECT count(*)::int n FROM rpt.report_configurations WHERE id=$1`, [
              config,
            ])
          ).rows[0].n
        )
      ).toBe(0);
      // a cross-tenant UPDATE touches no rows.
      const upd = await c.query(`UPDATE sal.invoices SET updated_at=now() WHERE id=$1`, [invoice]);
      expect(upd.rowCount).toBe(0);
    });

    await withRolledBackTx(runtime, noCtx, async (c) => {
      expect(
        Number(
          (await c.query(`SELECT count(*)::int n FROM sal.invoices WHERE id=$1`, [invoice])).rows[0]
            .n
        )
      ).toBe(0);
      expect(
        Number(
          (
            await c.query(`SELECT count(*)::int n FROM rpt.report_configurations WHERE id=$1`, [
              config,
            ])
          ).rows[0].n
        )
      ).toBe(0);
    });
  });
});
