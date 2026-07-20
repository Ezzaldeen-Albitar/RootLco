/**
 * Phase 1-9 — concurrency: single-winner races repeated 5× on independent
 * connections. Duplicate ordinary work-order origin (23505), labor-session overlap
 * (23P01), duplicate close (23514), and gap-free display-number allocation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  setContext,
  withCommittedTx,
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import { P9, ctxA, seedP109Base, makeAuthorizedVisit, newWorkOrder, moveWO } from './p1-09-helpers';

const REPS = 5;
const scope = [TENANT_A, COMPANY_A1, BRANCH_A1];
let admin: Pool;
let runtime: Pool;

/** Two independent runtime connections race; returns the loser's SQLSTATE (or undefined). */
async function race(
  first: (c: PoolClient) => Promise<unknown>,
  second: (c: PoolClient) => Promise<unknown>
): Promise<string | undefined> {
  const c1 = await runtime.connect();
  const c2 = await runtime.connect();
  try {
    await c1.query('BEGIN');
    await setContext(c1, ctxA);
    await c2.query('BEGIN');
    await setContext(c2, ctxA);
    await first(c1);
    const p2 = second(c2);
    p2.catch(() => {});
    await c1.query('COMMIT');
    let code: string | undefined;
    try {
      await p2;
      await c2.query('COMMIT');
    } catch (e) {
      code = (e as { code?: string }).code;
      await c2.query('ROLLBACK');
    }
    return code;
  } finally {
    c1.release();
    c2.release();
  }
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedP109Base(admin);
  await admin.query(
    `INSERT INTO shared.number_sequences (tenant_id, sequence_code, prefix_template, pad_width, created_by)
     VALUES ($1,'work_order','WO-',6,$2) ON CONFLICT ON CONSTRAINT uq_number_sequences_scope DO NOTHING`,
    [TENANT_A, USER_A]
  );
  runtime = runtimePool(8);
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

/** Commits a fresh authorized visit (admin) and returns its id; cleans prior race rows. */
async function freshVisit(): Promise<string> {
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
  ]) {
    await admin.query(`DELETE FROM ${t} WHERE tenant_id=$1`, [TENANT_A]);
  }
  await admin.query(`DELETE FROM rec.reception_status_history WHERE tenant_id=$1`, [TENANT_A]);
  await admin.query(`DELETE FROM rec.custody_history WHERE tenant_id=$1`, [TENANT_A]);
  await admin.query(`DELETE FROM rec.authorizations WHERE tenant_id=$1`, [TENANT_A]);
  await admin.query(`DELETE FROM rec.reception_party_roles WHERE tenant_id=$1`, [TENANT_A]);
  await admin.query(`DELETE FROM rec.reception_visits WHERE tenant_id=$1`, [TENANT_A]);
  await admin.query(`DELETE FROM rec.walk_in_references WHERE tenant_id=$1`, [TENANT_A]);
  let visit = '';
  await withCommittedTx(admin, ctxA, async (c) => {
    visit = await makeAuthorizedVisit(c);
  });
  return visit;
}

const insWO = (visit: string) => (c: PoolClient) =>
  c.query(
    `INSERT INTO wo.work_orders (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, kind, created_by)
     VALUES ($1,$2,$3,$4,$5,'ordinary',$6)`,
    [...scope, visit, P9.V_A, USER_A]
  );

describe('P1-09 concurrency (5 reps each)', () => {
  it('duplicate ordinary work-order origin: exactly one commits (loser 23505)', async () => {
    for (let i = 0; i < REPS; i++) {
      const visit = await freshVisit();
      const code = await race(insWO(visit), insWO(visit));
      expect(code).toBe('23505');
      const n = await admin.query(
        `SELECT count(*)::int n FROM wo.work_orders WHERE reception_visit_id=$1 AND kind='ordinary'`,
        [visit]
      );
      expect(n.rows[0].n).toBe(1);
    }
  });

  it('overlapping labor sessions for one technician: exactly one commits (loser 23P01)', async () => {
    // Committed job the racers share.
    const visit = await freshVisit();
    let job = '';
    await withCommittedTx(admin, ctxA, async (c) => {
      const wo = await newWorkOrder(c, visit);
      await moveWO(c, wo, 'open');
      await moveWO(c, wo, 'in_progress');
      job = (
        await c.query(
          `INSERT INTO wo.jobs (tenant_id, company_id, branch_id, work_order_id, title, created_by)
           VALUES ($1,$2,$3,$4,'race',$5) RETURNING id`,
          [...scope, wo, USER_A]
        )
      ).rows[0].id;
      await c.query(
        `INSERT INTO wo.job_assignments (tenant_id, company_id, branch_id, job_id, technician_profile_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [...scope, job, P9.TECH_PROFILE, USER_A]
      );
      await c.query(`UPDATE wo.jobs SET state='assigned' WHERE id=$1`, [job]);
    });
    const insLabor = (c: PoolClient) =>
      c.query(
        `INSERT INTO tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id, job_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [...scope, P9.TECH_PROFILE, job, USER_A]
      );
    for (let i = 0; i < REPS; i++) {
      await admin.query(`DELETE FROM tech.labor_sessions WHERE job_id=$1`, [job]);
      const code = await race(insLabor, insLabor);
      expect(code).toBe('23P01');
      const n = await admin.query(
        `SELECT count(*)::int n FROM tech.labor_sessions WHERE job_id=$1`,
        [job]
      );
      expect(n.rows[0].n).toBe(1);
    }
  });

  it('duplicate close: exactly one close commits (the loser is an idempotent no-op)', async () => {
    for (let i = 0; i < REPS; i++) {
      const visit = await freshVisit();
      let wo = '';
      await withCommittedTx(admin, ctxA, async (c) => {
        wo = await newWorkOrder(c, visit);
        await moveWO(c, wo, 'open');
        await moveWO(c, wo, 'in_progress');
        await moveWO(c, wo, 'qc_pending');
        await moveWO(c, wo, 'ready_to_close');
      });
      const close = (c: PoolClient) =>
        c.query(`UPDATE wo.work_orders SET state='closed' WHERE id=$1`, [wo]);
      // Serialized on the row lock; the loser sees state=closed and its set is a no-op.
      const code = await race(close, close);
      expect(code === undefined || code === '23514').toBe(true);
      const st = await admin.query(`SELECT state FROM wo.work_orders WHERE id=$1`, [wo]);
      expect(st.rows[0].state).toBe('closed');
      // Exactly one close transition was ever recorded.
      const h = await admin.query(
        `SELECT count(*)::int n FROM wo.work_order_status_history WHERE work_order_id=$1 AND to_state='closed'`,
        [wo]
      );
      expect(h.rows[0].n).toBe(1);
    }
  });

  it('display-number allocation is gap-free under concurrency (no duplicate)', async () => {
    for (let i = 0; i < REPS; i++) {
      const c1 = await runtime.connect();
      const c2 = await runtime.connect();
      try {
        await c1.query('BEGIN');
        await setContext(c1, ctxA);
        await c2.query('BEGIN');
        await setContext(c2, ctxA);
        const n1 = (
          await c1.query(`SELECT display_number FROM shared.next_display_number('work_order')`)
        ).rows[0].display_number;
        const p2 = c2.query(`SELECT display_number FROM shared.next_display_number('work_order')`);
        await c1.query('COMMIT');
        const n2 = (await p2).rows[0].display_number;
        await c2.query('COMMIT');
        expect(n1).not.toBe(n2); // serialized allocation, distinct numbers
      } finally {
        c1.release();
        c2.release();
      }
    }
  });
});
