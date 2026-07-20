/**
 * Phase 1-9 — transactional atomicity: an operation that fails partway leaves
 * ZERO partial rows. Covers the labor-correction primitive (soft-delete + linked
 * insert must both roll back on failure) and a multi-step work-order + job build.
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
  setContext,
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import { P9, ctxA, seedP109Base, makeAuthorizedVisit, newWorkOrder, moveWO } from './p1-09-helpers';

type Q = { query: Client['query'] };
let admin: Pool;
let runtime: Pool;
const scope = [TENANT_A, COMPANY_A1, BRANCH_A1];

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedP109Base(admin);
  runtime = runtimePool();
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('P1-09 rollback / atomicity', () => {
  it('a failed labor correction leaves the original session intact (soft-delete rolls back)', async () => {
    // Commit a startable job + two non-overlapping labor sessions A and B.
    let job = '';
    let sessionA = '';
    await withCommittedTx(admin, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c as Q);
      const wo = await newWorkOrder(c as Q, visit);
      await moveWO(c as Q, wo, 'open');
      await moveWO(c as Q, wo, 'in_progress');
      job = (
        await c.query(
          `INSERT INTO wo.jobs (tenant_id, company_id, branch_id, work_order_id, title, created_by)
           VALUES ($1,$2,$3,$4,'RB',$5) RETURNING id`,
          [...scope, wo, USER_A]
        )
      ).rows[0].id;
      await c.query(
        `INSERT INTO wo.job_assignments (tenant_id, company_id, branch_id, job_id, technician_profile_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [...scope, job, P9.TECH_PROFILE, USER_A]
      );
      await c.query(`UPDATE wo.jobs SET state='assigned' WHERE id=$1`, [job]);
      sessionA = (
        await c.query(
          `INSERT INTO tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id, job_id, started_at, ended_at, created_by)
           VALUES ($1,$2,$3,$4,$5, now() - interval '1 hour', now() - interval '30 minutes', $6) RETURNING id`,
          [...scope, P9.TECH_PROFILE, job, USER_A]
        )
      ).rows[0].id;
      await c.query(
        `INSERT INTO tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id, job_id, started_at, ended_at, created_by)
         VALUES ($1,$2,$3,$4,$5, now() - interval '3 hours', now() - interval '2 hours', $6)`,
        [...scope, P9.TECH_PROFILE, job, USER_A]
      );
    });

    // Attempt to correct A into a window that overlaps B -> the linked insert fails
    // (23P01); the correction must roll back, leaving A NOT soft-deleted.
    const c = await runtime.connect();
    try {
      await c.query('BEGIN');
      await setContext(c, ctxA);
      let threw = false;
      try {
        await c.query(
          `SELECT tech.correct_labor_session($1, now() - interval '3 hours', now() - interval '2 hours', 'overlap')`,
          [sessionA]
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }

    const row = await admin.query(`SELECT deleted_at FROM tech.labor_sessions WHERE id=$1`, [
      sessionA,
    ]);
    expect(row.rows[0].deleted_at).toBeNull(); // original untouched
    const n = await admin.query(`SELECT count(*)::int n FROM tech.labor_sessions WHERE job_id=$1`, [
      job,
    ]);
    expect(n.rows[0].n).toBe(2); // no orphan correction row

    // Cleanup committed fixtures for this suite's tenant.
    for (const t of [
      'tech.labor_sessions',
      'wo.job_assignments',
      'wo.job_status_history',
      'wo.jobs',
      'wo.work_order_status_history',
      'wo.work_orders',
    ]) {
      await admin.query(`DELETE FROM ${t} WHERE tenant_id=$1`, [TENANT_A]);
    }
  });

  it('a work order + job build that fails midway persists nothing', async () => {
    // Clean any tenant-A work-order/reception residue so the assertion is exact.
    for (const t of [
      'tech.labor_sessions',
      'wo.job_assignments',
      'wo.job_status_history',
      'wo.jobs',
      'wo.work_order_service_lines',
      'wo.required_parts',
      'wo.additional_work_requests',
      'wo.work_order_status_history',
      'wo.work_orders',
      'rec.reception_status_history',
      'rec.custody_history',
      'rec.authorizations',
      'rec.reception_party_roles',
      'rec.reception_visits',
      'rec.walk_in_references',
    ]) {
      await admin.query(`DELETE FROM ${t} WHERE tenant_id=$1`, [TENANT_A]);
    }
    let threw = false;
    let visitId = '';
    try {
      await withCommittedTx(admin, ctxA, async (c) => {
        visitId = await makeAuthorizedVisit(c as Q);
        const wo = await newWorkOrder(c as Q, visitId);
        await moveWO(c as Q, wo, 'open');
        // Insert a job with a non-existent state -> guard rejects -> whole tx aborts.
        await c.query(
          `INSERT INTO wo.jobs (tenant_id, company_id, branch_id, work_order_id, title, state, created_by)
           VALUES ($1,$2,$3,$4,'bad','no_such_state',$5)`,
          [...scope, wo, USER_A]
        );
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Nothing from the aborted transaction persisted.
    const wo = await admin.query(`SELECT count(*)::int n FROM wo.work_orders WHERE tenant_id=$1`, [
      TENANT_A,
    ]);
    expect(wo.rows[0].n).toBe(0);
    const visits = await admin.query(
      `SELECT count(*)::int n FROM rec.reception_visits WHERE tenant_id=$1`,
      [TENANT_A]
    );
    expect(visits.rows[0].n).toBe(0);
  });
});
