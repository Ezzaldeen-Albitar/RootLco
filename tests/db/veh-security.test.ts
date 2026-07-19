/**
 * Phase 1-7 Vehicle RLS / grant / function-security inventory (P1-07-DB-021).
 *
 * Pure-introspection guards that auto-cover EVERY live veh table and routine, so
 * a new object that forgets RLS, leaks a grant, or ships SECURITY DEFINER fails
 * here automatically. Proves: RLS enabled + forced on every table; SELECT/INSERT
 * policies present; DELETE granted to no app role and no del_ policy (soft delete
 * only); app_readonly is read-only; app_worker touches nothing; every function is
 * SECURITY INVOKER with a locked search_path and no PUBLIC execute; app roles own
 * no veh object.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool } from './helpers';

let admin: Pool;

beforeAll(async () => {
  admin = adminPool();
});
afterAll(async () => {
  await admin.end();
});

describe('veh RLS + FORCE coverage (P1-07-DB-021)', () => {
  it('every veh base table has RLS ENABLED and FORCED', async () => {
    const { rows } = await admin.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'veh' AND c.relkind = 'r'
        ORDER BY 1`
    );
    expect(rows.length).toBeGreaterThanOrEqual(23);
    const bad = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity);
    expect(
      bad.map((r) => r.relname),
      'tables missing ENABLE/FORCE RLS'
    ).toEqual([]);
  });

  it('every veh table has SELECT and INSERT policies; none has a DELETE policy', async () => {
    const { rows } = await admin.query(
      `SELECT c.relname,
              bool_or(p.cmd = 'SELECT') AS has_sel,
              bool_or(p.cmd = 'INSERT') AS has_ins,
              bool_or(p.cmd = 'DELETE') AS has_del
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_policies p ON p.schemaname = 'veh' AND p.tablename = c.relname
        WHERE n.nspname = 'veh' AND c.relkind = 'r'
        GROUP BY c.relname
        ORDER BY 1`
    );
    const noSel = rows.filter((r) => !r.has_sel).map((r) => r.relname);
    const noIns = rows.filter((r) => !r.has_ins).map((r) => r.relname);
    const hasDel = rows.filter((r) => r.has_del).map((r) => r.relname);
    expect(noSel, 'tables without a SELECT policy').toEqual([]);
    expect(noIns, 'tables without an INSERT policy').toEqual([]);
    expect(hasDel, 'tables with a DELETE policy (soft-delete only)').toEqual([]);
  });
});

describe('veh grants (P1-07-DB-021)', () => {
  it('no app role holds DELETE on any veh table', async () => {
    const { rows } = await admin.query(
      `SELECT c.relname, r.rolname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN (VALUES ('app_runtime'),('app_readonly'),('app_worker')) AS r(rolname)
        WHERE n.nspname = 'veh' AND c.relkind = 'r'
          AND has_table_privilege(r.rolname, c.oid, 'DELETE')
        ORDER BY 1,2`
    );
    expect(
      rows.map((r) => `${r.relname}:${r.rolname}`),
      'DELETE grants to app roles'
    ).toEqual([]);
  });

  it('app_readonly holds only SELECT (no INSERT/UPDATE) on veh tables', async () => {
    const { rows } = await admin.query(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'veh' AND c.relkind = 'r'
          AND (has_table_privilege('app_readonly', c.oid, 'INSERT')
            OR has_table_privilege('app_readonly', c.oid, 'UPDATE'))
        ORDER BY 1`
    );
    expect(
      rows.map((r) => r.relname),
      'app_readonly write grants'
    ).toEqual([]);
  });

  it('app_worker holds NO privilege on any veh table (veh is not worker-touched)', async () => {
    const { rows } = await admin.query(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'veh' AND c.relkind = 'r'
          AND (has_table_privilege('app_worker', c.oid, 'SELECT')
            OR has_table_privilege('app_worker', c.oid, 'INSERT')
            OR has_table_privilege('app_worker', c.oid, 'UPDATE')
            OR has_table_privilege('app_worker', c.oid, 'DELETE'))
        ORDER BY 1`
    );
    expect(
      rows.map((r) => r.relname),
      'app_worker grants on veh'
    ).toEqual([]);
  });
});

describe('veh function security (P1-07-DB-021)', () => {
  it('no veh routine is SECURITY DEFINER; all lock search_path; none is PUBLIC-executable', async () => {
    const { rows } = await admin.query(
      `SELECT p.proname,
              p.prosecdef,
              COALESCE(array_to_string(p.proconfig, ','), '') AS cfg,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'veh'
        ORDER BY 1`
    );
    expect(rows.length).toBeGreaterThanOrEqual(29);
    const definer = rows.filter((r) => r.prosecdef).map((r) => r.proname);
    const noPath = rows.filter((r) => !/search_path=/.test(r.cfg)).map((r) => r.proname);
    const publicExec = rows.filter((r) => r.public_exec).map((r) => r.proname);
    expect(definer, 'SECURITY DEFINER veh routines').toEqual([]);
    expect(noPath, 'veh routines without a locked search_path').toEqual([]);
    expect(publicExec, 'veh routines executable by PUBLIC').toEqual([]);
  });
});

describe('veh object ownership (P1-07-DB-021)', () => {
  it('application roles own no veh table or routine', async () => {
    const tbl = await admin.query(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles o ON o.oid = c.relowner
        WHERE n.nspname = 'veh' AND o.rolname IN ('app_runtime','app_readonly','app_worker')`
    );
    const fn = await admin.query(
      `SELECT p.proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles o ON o.oid = p.proowner
        WHERE n.nspname = 'veh' AND o.rolname IN ('app_runtime','app_readonly','app_worker')`
    );
    expect(tbl.rows, 'app-role-owned veh tables').toEqual([]);
    expect(fn.rows, 'app-role-owned veh routines').toEqual([]);
  });
});
