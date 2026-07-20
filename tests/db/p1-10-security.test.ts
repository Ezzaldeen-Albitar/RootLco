/**
 * Phase 1-10 — Security posture: RLS forced, no SECURITY DEFINER, locked search_path,
 * append-only grants, restricted cost gating, worker isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  TENANT_A,
  USER_A,
} from './helpers';
import { seedItem, expectFail } from './p1-10-helpers';

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };
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

describe('p1-10 security posture', () => {
  it('enables AND forces RLS on every svc/quo/inv table', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname||'.'||c.relname AS fq, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname = ANY($1) AND c.relkind='r'`,
      [SCHEMAS]
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.fq} RLS enabled`).toBe(true);
      expect(r.relforcerowsecurity, `${r.fq} RLS forced`).toBe(true);
    }
  });

  it('has NO SECURITY DEFINER routine and locks every search_path', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname||'.'||p.proname AS fq, p.prosecdef, p.proconfig
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname = ANY($1)`,
      [SCHEMAS]
    );
    const definer = rows.filter((r) => r.prosecdef).map((r) => r.fq);
    expect(definer, 'SECURITY DEFINER routines').toEqual([]);
    for (const r of rows) {
      const cfg = (r.proconfig ?? []) as string[];
      expect(
        cfg.some((c) => c.startsWith('search_path=')),
        `${r.fq} must lock search_path`
      ).toBe(true);
    }
  });

  it('is not PUBLIC-executable for any svc/quo/inv routine', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname||'.'||p.proname AS fq
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname = ANY($1)
         AND has_function_privilege('public', p.oid, 'EXECUTE')`,
      [SCHEMAS]
    );
    expect(rows.map((r) => r.fq)).toEqual([]);
  });

  it('grants no UPDATE/DELETE on append-only ledgers', async () => {
    const { rows } = await admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = ANY($1) AND grantee IN ('app_runtime','app_readonly')
         AND privilege_type IN ('UPDATE','DELETE')
         AND table_name IN ('stock_movements','approval_decisions','approval_evidence','quotation_status_history')`,
      [SCHEMAS]
    );
    expect(rows).toEqual([]);
  });

  it('grants the infrastructure worker NO privilege on any svc/quo/inv table', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema||'.'||table_name AS fq FROM information_schema.role_table_grants
       WHERE table_schema = ANY($1) AND grantee = 'app_worker'`,
      [SCHEMAS]
    );
    expect(rows).toEqual([]);
  });

  it('gates every restricted cost table on iam.has_permission(inv.cost.view)', async () => {
    const gated = [
      'item_cost_details',
      'external_purchase_part_details',
      'stock_adjustment_details',
    ];
    const { rows } = await admin.query(
      `SELECT c.relname AS tbl, p.polname, pg_get_expr(p.polqual, p.polrelid) AS using_q, pg_get_expr(p.polwithcheck, p.polrelid) AS check_q
       FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='inv' AND c.relname = ANY($1)`,
      [gated]
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const expr = `${r.using_q ?? ''} ${r.check_q ?? ''}`;
      expect(expr, `${r.tbl}.${r.polname} must gate on inv.cost.view`).toContain(
        "has_permission('inv.cost.view'"
      );
    }
  });

  it('denies a restricted cost write without the inv.cost.view permission', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'sec');
      await expectFail(
        c,
        '42501',
        `INSERT INTO inv.item_cost_details (tenant_id, item_id, standard_cost, currency_code, created_by)
         VALUES ($1,$2,10,'USD',$3)`,
        [TENANT_A, item, USER_A]
      );
    });
  });
});
