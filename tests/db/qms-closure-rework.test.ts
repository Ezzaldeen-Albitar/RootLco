/**
 * Phase 1-9 — Work Order closure gate (B1..B6), reopen prohibition (BR-WO-002),
 * rework + independent sign-off (BR-QMS-001), and QC finalize immutability (F10).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
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

/** Creates a WO and advances it to in_progress; returns { id, visit }. */
async function openWO(c: Q): Promise<{ id: string; visit: string }> {
  const visit = await makeAuthorizedVisit(c);
  const id = await newWorkOrder(c, visit);
  await moveWO(c, id, 'open');
  await moveWO(c, id, 'in_progress');
  return { id, visit };
}

/** Advances an in_progress WO through qc_pending -> ready_to_close, then attempts close. */
async function attemptClose(c: Q, id: string): Promise<void> {
  await moveWO(c, id, 'qc_pending');
  await moveWO(c, id, 'ready_to_close');
  await moveWO(c, id, 'closed');
}

async function addJob(
  c: Q,
  wo: string,
  opts: { requiresDiagnostic?: boolean } = {}
): Promise<string> {
  const { rows } = await c.query(
    `INSERT INTO wo.jobs (tenant_id, company_id, branch_id, work_order_id, title, requires_diagnostic, created_by)
     VALUES ($1,$2,$3,$4,'Job',$5,$6) RETURNING id`,
    [...scope, wo, opts.requiresDiagnostic ?? false, USER_A]
  );
  return rows[0].id;
}

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

describe('wo closure gate — blockers', () => {
  it('B1: a non-terminal job blocks closure; cancelling it clears the block', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { id } = await openWO(c);
      const job = await addJob(c, id); // planned (non-terminal)
      await moveWO(c, id, 'qc_pending');
      await moveWO(c, id, 'ready_to_close');
      await c.query('SAVEPOINT b1');
      await expectSqlState(moveWO(c, id, 'closed'), '23514');
      await c.query('ROLLBACK TO SAVEPOINT b1');
      // Cancel the job (reason required), then close succeeds.
      await c.query(`SELECT set_config('app.status_reason','not needed',true)`);
      await c.query(`UPDATE wo.jobs SET state='cancelled' WHERE id=$1`, [job]);
      await c.query(`SELECT set_config('app.status_reason','',true)`);
      await moveWO(c, id, 'closed');
      const { rows } = await c.query(`SELECT state FROM wo.work_orders WHERE id=$1`, [id]);
      expect(rows[0].state).toBe('closed');
    });
  });

  it('B2: an active labor session blocks closure', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { id } = await openWO(c);
      const job = await addJob(c, id);
      // Assign + start labor (job must allow labor -> assigned/in_progress).
      await c.query(
        `INSERT INTO wo.job_assignments (tenant_id, company_id, branch_id, job_id, technician_profile_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [...scope, job, P9.TECH_PROFILE, USER_A]
      );
      await c.query(`UPDATE wo.jobs SET state='assigned' WHERE id=$1`, [job]);
      await c.query(
        `INSERT INTO tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id, job_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [...scope, P9.TECH_PROFILE, job, USER_A]
      );
      // Cancel the job so B1 is clear, but the labor session stays open -> B2.
      await c.query(`SELECT set_config('app.status_reason','x',true)`);
      await c.query(`UPDATE wo.jobs SET state='cancelled' WHERE id=$1`, [job]);
      await c.query(`SELECT set_config('app.status_reason','',true)`);
      await moveWO(c, id, 'qc_pending');
      await moveWO(c, id, 'ready_to_close');
      await expectSqlState(moveWO(c, id, 'closed'), '23514');
    });
  });

  it('B3: a required pending additional-work request blocks closure', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { id } = await openWO(c);
      await c.query(
        `INSERT INTO wo.additional_work_requests (tenant_id, company_id, branch_id, work_order_id, summary, is_required, created_by)
         VALUES ($1,$2,$3,$4,'extra brake work',true,$5)`,
        [...scope, id, USER_A]
      );
      await moveWO(c, id, 'qc_pending');
      await moveWO(c, id, 'ready_to_close');
      await expectSqlState(moveWO(c, id, 'closed'), '23514');
    });
  });

  it('B4: a requires_diagnostic job without a completed report blocks closure', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { id } = await openWO(c);
      const job = await addJob(c, id, { requiresDiagnostic: true });
      await c.query(`SELECT set_config('app.status_reason','x',true)`);
      await c.query(`UPDATE wo.jobs SET state='cancelled' WHERE id=$1`, [job]); // terminal, clears B1
      await c.query(`SELECT set_config('app.status_reason','',true)`);
      await moveWO(c, id, 'qc_pending');
      await moveWO(c, id, 'ready_to_close');
      await expectSqlState(moveWO(c, id, 'closed'), '23514');
    });
  });

  it('B5: a failed QC blocks closure', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { id } = await openWO(c);
      const qc = (
        await c.query(
          `INSERT INTO qms.quality_control_records (tenant_id, company_id, branch_id, work_order_id, created_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [...scope, id, USER_A]
        )
      ).rows[0].id;
      await c.query(`UPDATE qms.quality_control_records SET overall_result='failed' WHERE id=$1`, [
        qc,
      ]);
      await moveWO(c, id, 'qc_pending');
      await moveWO(c, id, 'ready_to_close');
      await expectSqlState(moveWO(c, id, 'closed'), '23514');
    });
  });

  it('closes cleanly when no blocker exists', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { id } = await openWO(c);
      await attemptClose(c, id);
      const { rows } = await c.query(`SELECT state FROM wo.work_orders WHERE id=$1`, [id]);
      expect(rows[0].state).toBe('closed');
    });
  });
});

describe('BR-WO-002 — reopen prohibition', () => {
  it('records a rejected reopen attempt and never mutates the closed work order', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { id } = await openWO(c);
      await attemptClose(c, id);
      const attempt = (
        await c.query(`SELECT qms.attempt_reopen($1,'customer changed mind') AS id`, [id])
      ).rows[0].id;
      const rec = await c.query(`SELECT outcome FROM qms.reopen_attempts WHERE id=$1`, [attempt]);
      expect(rec.rows[0].outcome).toBe('rejected');
      const wo = await c.query(`SELECT state FROM wo.work_orders WHERE id=$1`, [id]);
      expect(wo.rows[0].state).toBe('closed'); // never reopened
    });
  });
});

describe('BR-QMS-001 — rework independent sign-off', () => {
  it('blocks closing a safety-critical rework until an independent technician signs off', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // Original ordinary WO, closed.
      const visit = await makeAuthorizedVisit(c);
      const original = await newWorkOrder(c, visit, { kind: 'ordinary' });
      await moveWO(c, original, 'open');
      await moveWO(c, original, 'in_progress');
      await attemptClose(c, original);
      // Rework WO on the same visit.
      const rework = await newWorkOrder(c, visit, { kind: 'rework' });
      await moveWO(c, rework, 'open');
      await moveWO(c, rework, 'in_progress');
      // Safety-critical rework link, lead technician = TECH_PROFILE, unsigned.
      const link = (
        await c.query(
          `INSERT INTO qms.rework_links
             (tenant_id, company_id, branch_id, original_work_order_id, rework_work_order_id,
              root_cause, corrective_action, lead_technician_id, is_safety_critical, created_by)
           VALUES ($1,$2,$3,$4,$5,'brake defect','replace caliper',$6,true,$7) RETURNING id`,
          [...scope, original, rework, P9.TECH_PROFILE, USER_A]
        )
      ).rows[0].id;
      // The lead technician cannot sign off their own rework (CHECK).
      await c.query('SAVEPOINT sd');
      await expectSqlState(
        c.query(`UPDATE qms.rework_links SET independent_sign_off_by=$2 WHERE id=$1`, [
          link,
          P9.TECH_PROFILE,
        ]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT sd');
      // Closure blocked (B6) while unsigned.
      await moveWO(c, rework, 'qc_pending');
      await moveWO(c, rework, 'ready_to_close');
      await c.query('SAVEPOINT sc');
      await expectSqlState(moveWO(c, rework, 'closed'), '23514');
      await c.query('ROLLBACK TO SAVEPOINT sc');
      // Independent technician signs off -> closure succeeds.
      await c.query(`UPDATE qms.rework_links SET independent_sign_off_by=$2 WHERE id=$1`, [
        link,
        P9.TECH_PROFILE2,
      ]);
      await moveWO(c, rework, 'closed');
      const { rows } = await c.query(`SELECT state FROM wo.work_orders WHERE id=$1`, [rework]);
      expect(rows[0].state).toBe('closed');
    });
  });
});

describe('F10 — QC finalize immutability', () => {
  it('freezes overall_result/checker/time once finalized', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { id } = await openWO(c);
      const qc = (
        await c.query(
          `INSERT INTO qms.quality_control_records (tenant_id, company_id, branch_id, work_order_id, created_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [...scope, id, USER_A]
        )
      ).rows[0].id;
      await c.query(`UPDATE qms.quality_control_records SET overall_result='passed' WHERE id=$1`, [
        qc,
      ]);
      const row = await c.query(
        `SELECT checker_id, finalized_at FROM qms.quality_control_records WHERE id=$1`,
        [qc]
      );
      expect(row.rows[0].checker_id).toBe(USER_A); // server-stamped
      expect(row.rows[0].finalized_at).not.toBeNull();
      // Flipping a finalized result is rejected.
      await expectSqlState(
        c.query(`UPDATE qms.quality_control_records SET overall_result='failed' WHERE id=$1`, [qc]),
        '23514'
      );
    });
  });
});
