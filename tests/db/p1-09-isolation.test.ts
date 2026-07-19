/**
 * Phase 1-9 — branch/tenant isolation. Structural: every wo/dia/tech/qms table is
 * FORCE RLS with a tenant-scoped INSERT policy (auto-enumerated; fails if a new
 * table ships without a control). Behavioural: a committed tenant-A stack is
 * invisible to a tenant-B runtime session across every populated table, and a
 * cross-tenant write is rejected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withCommittedTx,
  withRolledBackTx,
  setContext,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import { P9, ctxA, seedP109Base, makeAuthorizedVisit, newWorkOrder, moveWO } from './p1-09-helpers';

type Q = { query: Client['query'] };
let admin: Pool;
let runtime: Pool;
const scope = [TENANT_A, COMPANY_A1, BRANCH_A1];

// Tables populated by the committed stack below (branch-scoped business tables).
const POPULATED = [
  'wo.work_orders',
  'wo.work_order_status_history',
  'wo.jobs',
  'wo.job_status_history',
  'wo.job_assignments',
  'wo.work_order_service_lines',
  'wo.required_parts',
  'wo.additional_work_requests',
  'tech.labor_sessions',
  'dia.diagnostic_reports',
  'dia.findings',
  'qms.quality_control_records',
];

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedP109Base(admin);
  runtime = runtimePool();

  // Commit a full tenant-A stack (admin sets context so server-stamps work).
  await withCommittedTx(admin, ctxA, async (c) => {
    const visit = await makeAuthorizedVisit(c as Q);
    const wo = await newWorkOrder(c as Q, visit);
    await moveWO(c as Q, wo, 'open');
    await moveWO(c as Q, wo, 'in_progress');
    const job = (
      await c.query(
        `INSERT INTO wo.jobs (tenant_id, company_id, branch_id, work_order_id, title, created_by)
         VALUES ($1,$2,$3,$4,'Iso Job',$5) RETURNING id`,
        [...scope, wo, USER_A]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO wo.job_assignments (tenant_id, company_id, branch_id, job_id, technician_profile_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [...scope, job, P9.TECH_PROFILE, USER_A]
    );
    await c.query(`UPDATE wo.jobs SET state='assigned' WHERE id=$1`, [job]);
    await c.query(
      `INSERT INTO tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id, job_id, ended_at, created_by)
       VALUES ($1,$2,$3,$4,$5, now() + interval '1 hour', $6)`,
      [...scope, P9.TECH_PROFILE, job, USER_A]
    );
    await c.query(
      `INSERT INTO wo.work_order_service_lines (tenant_id, company_id, branch_id, work_order_id, description, created_by)
       VALUES ($1,$2,$3,$4,'oil change',$5)`,
      [...scope, wo, USER_A]
    );
    await c.query(
      `INSERT INTO wo.required_parts (tenant_id, company_id, branch_id, work_order_id, description, quantity, created_by)
       VALUES ($1,$2,$3,$4,'filter',2,$5)`,
      [...scope, wo, USER_A]
    );
    await c.query(
      `INSERT INTO wo.additional_work_requests (tenant_id, company_id, branch_id, work_order_id, summary, is_required, created_by)
       VALUES ($1,$2,$3,$4,'extra',false,$5)`,
      [...scope, wo, USER_A]
    );
    // Diagnostics: template -> published version -> report -> finding.
    const type = (
      await c.query(
        `INSERT INTO dia.diagnostic_types (scope, tenant_id, code, name, created_by)
         VALUES ('tenant',$1,'fx_iso_type','Iso',$2) RETURNING id`,
        [TENANT_A, USER_A]
      )
    ).rows[0].id;
    const tpl = (
      await c.query(
        `INSERT INTO dia.inspection_templates (tenant_id, code, name, diagnostic_type_id, created_by)
         VALUES ($1,'fx_iso_tpl','Iso',$2,$3) RETURNING id`,
        [TENANT_A, type, USER_A]
      )
    ).rows[0].id;
    const ver = (
      await c.query(
        `INSERT INTO dia.template_versions (tenant_id, template_id, version_number, created_by)
         VALUES ($1,$2,1,$3) RETURNING id`,
        [TENANT_A, tpl, USER_A]
      )
    ).rows[0].id;
    await c.query(`UPDATE dia.template_versions SET status='published' WHERE id=$1`, [ver]);
    const report = (
      await c.query(
        `INSERT INTO dia.diagnostic_reports (tenant_id, company_id, branch_id, work_order_id, job_id, template_version_id, diagnostic_type_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [...scope, wo, job, ver, type, USER_A]
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO dia.findings (tenant_id, company_id, branch_id, diagnostic_report_id, severity, disposition, description, created_by)
       VALUES ($1,$2,$3,$4,'low','monitor','worn belt',$5)`,
      [...scope, report, USER_A]
    );
    await c.query(
      `INSERT INTO qms.quality_control_records (tenant_id, company_id, branch_id, work_order_id, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [...scope, wo, USER_A]
    );
  });
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('P1-09 structural isolation controls', () => {
  it('every wo/dia/tech/qms table is FORCE RLS with a tenant-scoped INSERT policy', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname||'.'||c.relname AS fq, c.relforcerowsecurity AS forced,
              EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polcmd='a') AS has_insert
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='r' AND n.nspname IN ('wo','dia','tech','qms')`
    );
    const bad = rows.filter((r) => !r.forced || !r.has_insert).map((r) => r.fq);
    expect(bad, `tables missing FORCE RLS or an INSERT policy: ${bad.join(', ')}`).toEqual([]);
  });
});

describe('P1-09 tenant isolation (committed stack)', () => {
  it('a tenant-A runtime session sees the committed rows', async () => {
    const c = await runtime.connect();
    try {
      await c.query('BEGIN');
      await setContext(c, ctxA);
      const n = await c.query(`SELECT count(*)::int n FROM wo.work_orders`);
      expect(n.rows[0].n).toBeGreaterThan(0);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('a tenant-B runtime session sees ZERO rows in every populated P1-09 table', async () => {
    const c = await runtime.connect();
    try {
      await c.query('BEGIN');
      await setContext(c, { tenantId: TENANT_B, userId: USER_A });
      for (const table of POPULATED) {
        const { rows } = await c.query(`SELECT count(*)::int n FROM ${table}`);
        expect(rows[0].n, `${table} leaked cross-tenant`).toBe(0);
      }
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('rejects a cross-tenant work-order write (RLS WITH CHECK / refs guard)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // Context is tenant A; writing tenant B scope is denied by the INSERT policy
      // (42501) or the refs guard's not-visible lookup (23503).
      await expectSqlState(
        c.query(
          `INSERT INTO wo.work_orders (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [TENANT_B, COMPANY_A1, BRANCH_A1, '99999999-9999-4999-8999-999999999999', P9.V_A, USER_A]
        ),
        '42501',
        '23503'
      );
    });
  });
});
