/**
 * Phase 1-9 — Jobs (parent-lock, transition graph, assignment precondition),
 * labor sessions (overlap EXCLUDE, backdating, correction), technician
 * availability, and certification expiry.
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

async function openWOWithJob(c: Q): Promise<{ wo: string; job: string }> {
  const visit = await makeAuthorizedVisit(c);
  const wo = await newWorkOrder(c, visit);
  await moveWO(c, wo, 'open');
  await moveWO(c, wo, 'in_progress');
  const job = (
    await c.query(
      `INSERT INTO wo.jobs (tenant_id, company_id, branch_id, work_order_id, title, created_by)
       VALUES ($1,$2,$3,$4,'Job',$5) RETURNING id`,
      [...scope, wo, USER_A]
    )
  ).rows[0].id;
  return { wo, job };
}

async function assign(c: Q, job: string, tech = P9.TECH_PROFILE): Promise<void> {
  await c.query(
    `INSERT INTO wo.job_assignments (tenant_id, company_id, branch_id, job_id, technician_profile_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [...scope, job, tech, USER_A]
  );
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

describe('wo.jobs — lifecycle', () => {
  it('a job cannot be added to a terminal work order (parent-locked, F2)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      await moveWO(c, wo, 'open');
      await moveWO(c, wo, 'in_progress');
      await moveWO(c, wo, 'qc_pending');
      await moveWO(c, wo, 'ready_to_close');
      await moveWO(c, wo, 'closed');
      await expectSqlState(
        c.query(
          `INSERT INTO wo.jobs (tenant_id, company_id, branch_id, work_order_id, title, created_by)
           VALUES ($1,$2,$3,$4,'late',$5)`,
          [...scope, wo, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects an undefined job transition and requires a reason to pause', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { job } = await openWOWithJob(c);
      // planned -> in_progress skips assigned; no such edge.
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE wo.jobs SET state='in_progress' WHERE id=$1`, [job]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await assign(c, job);
      await c.query(`UPDATE wo.jobs SET state='assigned' WHERE id=$1`, [job]);
      await c.query(`UPDATE wo.jobs SET state='in_progress' WHERE id=$1`, [job]);
      // in_progress -> paused requires a reason.
      await c.query('SAVEPOINT s2');
      await expectSqlState(
        c.query(`UPDATE wo.jobs SET state='paused' WHERE id=$1`, [job]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s2');
      await c.query(`SELECT set_config('app.status_reason','tech break',true)`);
      await c.query(`UPDATE wo.jobs SET state='paused' WHERE id=$1`, [job]);
      await c.query(`SELECT set_config('app.status_reason','',true)`);
    });
  });

  it('cannot enter an assignment-required state without an active assignment', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { job } = await openWOWithJob(c);
      // assigned requires an active assignment.
      await expectSqlState(
        c.query(`UPDATE wo.jobs SET state='assigned' WHERE id=$1`, [job]),
        '23514'
      );
    });
  });

  it('ending an assignment requires a reason (reassignment accountability)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { job } = await openWOWithJob(c);
      const a = (
        await c.query(
          `INSERT INTO wo.job_assignments (tenant_id, company_id, branch_id, job_id, technician_profile_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [...scope, job, P9.TECH_PROFILE, USER_A]
        )
      ).rows[0].id;
      await c.query('SAVEPOINT sa');
      await expectSqlState(
        c.query(`UPDATE wo.job_assignments SET valid_to=now() + interval '1 hour' WHERE id=$1`, [
          a,
        ]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT sa');
      await c.query(
        `UPDATE wo.job_assignments SET valid_to=now() + interval '1 hour', reason='reassigned' WHERE id=$1`,
        [a]
      );
    });
  });
});

describe('tech.labor_sessions — overlap, backdating, correction', () => {
  async function startableJob(c: Q): Promise<string> {
    const { job } = await openWOWithJob(c);
    await assign(c, job);
    await c.query(`UPDATE wo.jobs SET state='assigned' WHERE id=$1`, [job]);
    return job;
  }

  it('rejects a second overlapping / active labor session for one technician (23P01)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const job = await startableJob(c);
      await c.query(
        `INSERT INTO tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id, job_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [...scope, P9.TECH_PROFILE, job, USER_A]
      );
      // Second open session for the same technician overlaps [start, infinity).
      await expectSqlState(
        c.query(
          `INSERT INTO tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id, job_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [...scope, P9.TECH_PROFILE, job, USER_A]
        ),
        '23P01'
      );
    });
  });

  it('rejects labor backdated beyond the approved window', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const job = await startableJob(c);
      await expectSqlState(
        c.query(
          `INSERT INTO tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id, job_id, started_at, created_by)
           VALUES ($1,$2,$3,$4,$5, now() - interval '10 days', $6)`,
          [...scope, P9.TECH_PROFILE, job, USER_A]
        ),
        '23514'
      );
    });
  });

  it('corrects a session by soft-deleting the original and inserting a linked correction (F9)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const job = await startableJob(c);
      const orig = (
        await c.query(
          `INSERT INTO tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id, job_id, started_at, ended_at, created_by)
           VALUES ($1,$2,$3,$4,$5, now() - interval '2 hours', now() - interval '1 hour', $6) RETURNING id`,
          [...scope, P9.TECH_PROFILE, job, USER_A]
        )
      ).rows[0].id;
      // A correction with an OVERLAPPING window succeeds only via the atomic primitive.
      const corr = (
        await c.query(
          `SELECT tech.correct_labor_session($1, now() - interval '2 hours', now() - interval '90 minutes', 'wrong end time') AS id`,
          [orig]
        )
      ).rows[0].id;
      const origRow = await c.query(`SELECT deleted_at FROM tech.labor_sessions WHERE id=$1`, [
        orig,
      ]);
      expect(origRow.rows[0].deleted_at).not.toBeNull(); // original soft-deleted
      const corrRow = await c.query(
        `SELECT correction_of_id, source FROM tech.labor_sessions WHERE id=$1`,
        [corr]
      );
      expect(corrRow.rows[0].correction_of_id).toBe(orig);
      expect(corrRow.rows[0].source).toBe('correction');
    });
  });

  it('rejects new labor on a terminal work order', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, job } = await openWOWithJob(c);
      await c.query(`SELECT set_config('app.status_reason','x',true)`);
      await c.query(`UPDATE wo.jobs SET state='cancelled' WHERE id=$1`, [job]);
      await c.query(`SELECT set_config('app.status_reason','',true)`);
      await moveWO(c, wo, 'qc_pending');
      await moveWO(c, wo, 'ready_to_close');
      await moveWO(c, wo, 'closed');
      await expectSqlState(
        c.query(
          `INSERT INTO tech.labor_sessions (tenant_id, company_id, branch_id, technician_profile_id, job_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [...scope, P9.TECH_PROFILE, job, USER_A]
        ),
        '23514'
      );
    });
  });
});

describe('tech — availability + certification expiry', () => {
  it('rejects overlapping availability windows for one technician (23P01)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(
        `INSERT INTO tech.technician_availability (tenant_id, company_id, branch_id, technician_profile_id, available_from, available_to, created_by)
         VALUES ($1,$2,$3,$4, '2027-01-01T08:00:00Z','2027-01-01T12:00:00Z',$5)`,
        [...scope, P9.TECH_PROFILE, USER_A]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO tech.technician_availability (tenant_id, company_id, branch_id, technician_profile_id, available_from, available_to, created_by)
           VALUES ($1,$2,$3,$4, '2027-01-01T10:00:00Z','2027-01-01T14:00:00Z',$5)`,
          [...scope, P9.TECH_PROFILE, USER_A]
        ),
        '23P01'
      );
    });
  });

  it('surfaces expiring certifications via the expiry index/query', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const cert2 = (
        await c.query(
          `INSERT INTO tech.certifications (scope, tenant_id, code, name, created_by)
           VALUES ('tenant',$1,'fx_cert_brakes','Brake Cert',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).rows[0].id;
      await c.query(
        `INSERT INTO tech.technician_certifications
           (tenant_id, company_id, branch_id, technician_profile_id, certification_id, issued_on, expires_on, created_by)
         VALUES ($1,$2,$3,$4,$5, current_date - 300, current_date + 20, $6)`,
        [...scope, P9.TECH_PROFILE, cert2, USER_A]
      );
      const soon = await c.query(
        `SELECT count(*)::int n FROM tech.technician_certifications
          WHERE tenant_id=$1 AND expires_on IS NOT NULL AND expires_on <= current_date + 30 AND deleted_at IS NULL`,
        [TENANT_A]
      );
      expect(soon.rows[0].n).toBe(1);
    });
  });
});
