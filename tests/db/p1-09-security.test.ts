/**
 * Phase 1-9 security posture (P1-09-SEC), auto-enumerated over every wo/dia/tech/
 * qms table + function. A new table/function that lacks RLS, minimal grants, the
 * sensitive gate, append-only protection, or SECURITY INVOKER + empty search_path
 * fails automatically.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool } from './helpers';

const SCHEMAS = ['wo', 'dia', 'tech', 'qms'];
// Restricted 1:1 payload tables: every policy must require sensitive.view.
const RESTRICTED_TABLES = new Set([
  'tech.technician_certification_details',
  'wo.additional_work_request_details',
  'qms.rework_link_details',
]);
// Append-only ledgers: runtime may INSERT + SELECT but never UPDATE/DELETE.
const APPEND_ONLY = new Set([
  'wo.work_order_status_history',
  'wo.job_status_history',
  'wo.customer_approval_evidence',
  'dia.diagnostic_report_status_history',
  'dia.diagnostic_evidence',
  'dia.diagnostic_reviews',
  'qms.qc_status_history',
  'qms.reopen_attempts',
]);
// Dual-scope config catalogs (tenant_id nullable; not branch-scoped).
const CONFIG_CATALOGS = new Set([
  'wo.work_order_states',
  'wo.work_order_transitions',
  'wo.job_states',
  'wo.job_transitions',
  'tech.skills',
  'tech.skill_levels',
  'tech.certifications',
  'dia.diagnostic_types',
  'qms.qc_checks',
]);
// Tenant-scoped (tenant_id NOT NULL, no company/branch): diagnostic templates.
const TENANT_ONLY = new Set([
  'dia.inspection_templates',
  'dia.template_versions',
  'dia.template_items',
]);

let admin: Pool;
let tables: string[] = [];

beforeAll(async () => {
  admin = adminPool();
  const { rows } = await admin.query(
    `SELECT table_schema || '.' || table_name AS fq FROM information_schema.tables
      WHERE table_schema = ANY($1) AND table_type='BASE TABLE' ORDER BY 1`,
    [SCHEMAS]
  );
  tables = rows.map((r) => r.fq);
});
afterAll(async () => {
  await admin.end();
});

describe('P1-09 security posture (auto-enumerated)', () => {
  it('discovered the full wo/dia/tech/qms table set (47)', () => {
    expect(tables.length).toBe(47);
  });

  it('every table has RLS enabled AND forced', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname||'.'||c.relname AS fq, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname = ANY($1) AND c.relkind='r'`,
      [SCHEMAS]
    );
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.fq} RLS enabled`).toBe(true);
      expect(r.relforcerowsecurity, `${r.fq} RLS forced`).toBe(true);
    }
  });

  it('no table grants DELETE to any application role', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema||'.'||table_name AS fq FROM information_schema.role_table_grants
        WHERE table_schema = ANY($1) AND grantee IN ('app_runtime','app_readonly','app_worker')
          AND privilege_type='DELETE'`,
      [SCHEMAS]
    );
    expect(rows.map((r) => r.fq)).toEqual([]);
  });

  it('app_readonly holds SELECT only', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema||'.'||table_name AS fq, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = ANY($1) AND grantee='app_readonly' AND privilege_type IN ('INSERT','UPDATE','DELETE')`,
      [SCHEMAS]
    );
    expect(rows.map((r) => `${r.fq}:${r.privilege_type}`)).toEqual([]);
  });

  it('every table carries a SELECT and an INSERT policy', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname||'.'||c.relname AS fq, p.polcmd FROM pg_policy p
         JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname = ANY($1)`,
      [SCHEMAS]
    );
    const byTable = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!byTable.has(r.fq)) byTable.set(r.fq, new Set());
      byTable.get(r.fq)!.add(r.polcmd);
    }
    for (const t of tables) {
      const cmds = byTable.get(t) ?? new Set();
      expect(cmds.has('r'), `${t} SELECT policy`).toBe(true);
      expect(cmds.has('a'), `${t} INSERT policy`).toBe(true);
    }
  });

  it('restricted-payload tables gate reads on iam.sensitive.view', async () => {
    for (const t of RESTRICTED_TABLES) {
      const [schema, name] = t.split('.');
      const { rows } = await admin.query(
        `SELECT pg_get_expr(p.polqual, p.polrelid) AS qual FROM pg_policy p
           JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=$1 AND c.relname=$2 AND p.polcmd='r'`,
        [schema, name]
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.qual, `${t} gate`).toContain('has_permission');
    }
  });

  it('append-only ledgers grant INSERT+SELECT but never UPDATE to the runtime', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema||'.'||table_name AS fq, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = ANY($1) AND grantee='app_runtime' AND privilege_type IN ('INSERT','SELECT','UPDATE')`,
      [SCHEMAS]
    );
    const g = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!g.has(r.fq)) g.set(r.fq, new Set());
      g.get(r.fq)!.add(r.privilege_type);
    }
    for (const t of APPEND_ONLY) {
      const gt = g.get(t) ?? new Set();
      expect(gt.has('INSERT'), `${t} INSERT`).toBe(true);
      expect(gt.has('SELECT'), `${t} SELECT`).toBe(true);
      expect(gt.has('UPDATE'), `${t} no UPDATE`).toBe(false);
    }
  });

  it('every function is SECURITY INVOKER with an empty search_path', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname||'.'||p.proname AS fq, p.prosecdef, p.proconfig
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname = ANY($1)`,
      [SCHEMAS]
    );
    for (const r of rows) {
      expect(r.prosecdef, `${r.fq} must be SECURITY INVOKER`).toBe(false);
      const cfg = (r.proconfig ?? []) as string[];
      expect(
        cfg.some((c) => c.startsWith('search_path=')),
        `${r.fq} must SET search_path=''`
      ).toBe(true);
    }
  });

  it('branch-scoped tables carry tenant/company/branch NOT NULL', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema||'.'||table_name AS fq, column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = ANY($1) AND column_name IN ('tenant_id','company_id','branch_id')`,
      [SCHEMAS]
    );
    const cols = new Map<string, Map<string, string>>();
    for (const r of rows) {
      if (!cols.has(r.fq)) cols.set(r.fq, new Map());
      cols.get(r.fq)!.set(r.column_name, r.is_nullable);
    }
    for (const t of tables) {
      if (CONFIG_CATALOGS.has(t) || TENANT_ONLY.has(t)) continue;
      const c = cols.get(t)!;
      expect(c.get('tenant_id'), `${t} tenant_id NOT NULL`).toBe('NO');
      expect(c.get('company_id'), `${t} company_id NOT NULL`).toBe('NO');
      expect(c.get('branch_id'), `${t} branch_id NOT NULL`).toBe('NO');
    }
  });
});
