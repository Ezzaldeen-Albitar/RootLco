/**
 * Phase 1-9 — Work Order master: reception origin, configurable state graph,
 * terminal freeze (BR-WO-002), append-only status history, display number,
 * record_version, and branch isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import { P9, ctxA, seedP109Base, makeAuthorizedVisit, newWorkOrder, moveWO } from './p1-09-helpers';

let admin: Pool;
let runtime: Pool;

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

describe('wo.work_orders — reception origin', () => {
  it('creates a work order from an authorized reception visit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const id = await newWorkOrder(c, visit);
      const { rows } = await c.query(
        `SELECT state, kind, vehicle_id FROM wo.work_orders WHERE id=$1`,
        [id]
      );
      expect(rows[0].state).toBe('draft');
      expect(rows[0].kind).toBe('ordinary');
      expect(rows[0].vehicle_id).toBe(P9.V_A);
    });
  });

  it('rejects a work order for a non-authorized visit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // Build an opened (not authorized) visit.
      const wi = (
        await c.query(
          `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, vehicle_id, created_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, P9.V_A, USER_A]
        )
      ).rows[0].id;
      const visit = (
        await c.query(
          `SELECT rec.accept_check_in($1,$2,$3,NULL,$4,$5,$6,NULL,NULL,NULL,NULL) AS id`,
          [COMPANY_A1, BRANCH_A1, P9.V_A, wi, USER_A, P9.SR]
        )
      ).rows[0].id;
      await expectSqlState(newWorkOrder(c, visit), '23514');
    });
  });

  it('rejects a work order whose Vehicle differs from the reception visit Vehicle', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      await expectSqlState(newWorkOrder(c, visit, { vehicle: P9.V_B }), '23514');
    });
  });

  it('rejects a SECOND ordinary work order per reception origin, but allows a rework', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      await newWorkOrder(c, visit, { kind: 'ordinary' });
      await c.query('SAVEPOINT s');
      await expectSqlState(newWorkOrder(c, visit, { kind: 'ordinary' }), '23505');
      await c.query('ROLLBACK TO SAVEPOINT s');
      // A rework work order reuses the same reception origin.
      const rework = await newWorkOrder(c, visit, { kind: 'rework' });
      expect(rework).toBeTruthy();
    });
  });

  it('cannot be created directly in a terminal state (F6)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      await expectSqlState(
        c.query(
          `INSERT INTO wo.work_orders (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, state, created_by)
           VALUES ($1,$2,$3,$4,$5,'closed',$6)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, visit, P9.V_A, USER_A]
        ),
        '23514'
      );
    });
  });
});

describe('wo.work_orders — configurable state graph', () => {
  it('follows the approved graph and emits append-only status history', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const id = await newWorkOrder(c, visit);
      await moveWO(c, id, 'open');
      await moveWO(c, id, 'in_progress');
      await moveWO(c, id, 'qc_pending');
      const { rows } = await c.query(
        `SELECT from_state, to_state FROM wo.work_order_status_history WHERE work_order_id=$1 ORDER BY seq`,
        [id]
      );
      expect(rows.map((r) => `${r.from_state ?? ''}->${r.to_state}`)).toEqual([
        'draft->open',
        'open->in_progress',
        'in_progress->qc_pending',
      ]);
    });
  });

  it('rejects a transition that is not an active edge in the graph', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const id = await newWorkOrder(c, visit);
      // draft -> in_progress skips open; no such edge.
      await expectSqlState(moveWO(c, id, 'in_progress'), '23514');
    });
  });

  it('requires a reason when the edge requires one', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const id = await newWorkOrder(c, visit);
      await moveWO(c, id, 'open');
      await moveWO(c, id, 'in_progress');
      // in_progress -> awaiting_parts requires a reason.
      await c.query('SAVEPOINT sr');
      await expectSqlState(moveWO(c, id, 'awaiting_parts'), '23514');
      await c.query('ROLLBACK TO SAVEPOINT sr');
      await moveWO(c, id, 'awaiting_parts', 'waiting on brake pads');
      const { rows } = await c.query(`SELECT state FROM wo.work_orders WHERE id=$1`, [id]);
      expect(rows[0].state).toBe('awaiting_parts');
    });
  });

  it('freezes a terminal state — a closed work order never reopens (BR-WO-002)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const id = await newWorkOrder(c, visit);
      await moveWO(c, id, 'open');
      await moveWO(c, id, 'in_progress');
      await moveWO(c, id, 'qc_pending');
      await moveWO(c, id, 'ready_to_close');
      await moveWO(c, id, 'closed');
      // Any outbound transition from a terminal state is rejected.
      await expectSqlState(moveWO(c, id, 'open'), '23514');
    });
  });
});

describe('wo.work_order_status_history — coherence + append-only', () => {
  it('rejects a forged history row whose to_state != the live state', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const id = await newWorkOrder(c, visit);
      await expectSqlState(
        c.query(
          `INSERT INTO wo.work_order_status_history (tenant_id, company_id, branch_id, work_order_id, from_state, to_state, actor_id)
           VALUES ($1,$2,$3,$4,'draft','open',$5)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, id, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects UPDATE/DELETE on the append-only ledger (no grant)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const id = await newWorkOrder(c, visit);
      await moveWO(c, id, 'open');
      await c.query('SAVEPOINT su');
      await expectSqlState(
        c.query(`UPDATE wo.work_order_status_history SET reason='x' WHERE work_order_id=$1`, [id]),
        '42501'
      );
      await c.query('ROLLBACK TO SAVEPOINT su');
      await expectSqlState(
        c.query(`DELETE FROM wo.work_order_status_history WHERE work_order_id=$1`, [id]),
        '42501'
      );
    });
  });
});

describe('wo.work_orders — display number + record_version + isolation', () => {
  it('allocates a unique display number via shared.next_display_number', async () => {
    // Provision the work_order sequence for tenant A (onboarding config, admin).
    await admin.query(
      `INSERT INTO shared.number_sequences (tenant_id, sequence_code, prefix_template, pad_width, created_by)
       VALUES ($1,'work_order','WO-',6,$2)
       ON CONFLICT ON CONSTRAINT uq_number_sequences_scope DO NOTHING`,
      [TENANT_A, USER_A]
    );
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const dn = (
        await c.query(`SELECT display_number FROM shared.next_display_number('work_order')`)
      ).rows[0].display_number;
      expect(dn).toMatch(/^WO-\d{6}$/);
      await c.query(
        `INSERT INTO wo.work_orders (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, display_number, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, visit, P9.V_A, dn, USER_A]
      );
    });
  });

  it('advances record_version by exactly 1 per update', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const id = await newWorkOrder(c, visit);
      await moveWO(c, id, 'open');
      const { rows } = await c.query(`SELECT record_version FROM wo.work_orders WHERE id=$1`, [id]);
      expect(rows[0].record_version).toBe(2);
    });
  });

  it('cannot insert a work order in another tenant scope (guard/RLS reject)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      // Tenant B scope with a tenant A visit: the refs guard (23503) or the RLS
      // WITH CHECK (42501) rejects — either is a valid cross-scope denial.
      await expectSqlState(
        c.query(
          `INSERT INTO wo.work_orders (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [TENANT_B, COMPANY_A1, BRANCH_A1, visit, P9.V_A, USER_A]
        ),
        '42501',
        '23503'
      );
    });
  });
});
