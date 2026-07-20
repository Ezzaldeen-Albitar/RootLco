/**
 * Phase 1-9 — service/part lines (positive quantity), additional-work approval
 * (forgery resistance + party-role coherence), and immutable approval evidence.
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

async function openWithVisit(c: Q): Promise<{ wo: string; visit: string; srRole: string }> {
  const visit = await makeAuthorizedVisit(c);
  const wo = await newWorkOrder(c, visit);
  await moveWO(c, wo, 'open');
  await moveWO(c, wo, 'in_progress');
  const srRole = (
    await c.query(
      `SELECT id FROM rec.reception_party_roles WHERE reception_visit_id=$1 AND relationship_role='service_requester'`,
      [visit]
    )
  ).rows[0].id;
  return { wo, visit, srRole };
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

describe('wo — service/part lines', () => {
  it('rejects a non-positive quantity', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await openWithVisit(c);
      await c.query('SAVEPOINT sq');
      await expectSqlState(
        c.query(
          `INSERT INTO wo.required_parts (tenant_id, company_id, branch_id, work_order_id, description, quantity, created_by)
           VALUES ($1,$2,$3,$4,'filter',0,$5)`,
          [...scope, wo, USER_A]
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT sq');
      await c.query(
        `INSERT INTO wo.work_order_service_lines (tenant_id, company_id, branch_id, work_order_id, description, quantity, created_by)
         VALUES ($1,$2,$3,$4,'oil change',1.5,$5)`,
        [...scope, wo, USER_A]
      );
    });
  });
});

describe('wo — additional-work approval', () => {
  it('cannot mark a request approved without an approved customer approval (forgery resistance)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await openWithVisit(c);
      const req = (
        await c.query(
          `INSERT INTO wo.additional_work_requests (tenant_id, company_id, branch_id, work_order_id, summary, created_by)
           VALUES ($1,$2,$3,$4,'extra',$5) RETURNING id`,
          [...scope, wo, USER_A]
        )
      ).rows[0].id;
      await expectSqlState(
        c.query(`UPDATE wo.additional_work_requests SET state='approved' WHERE id=$1`, [req]),
        '23514'
      );
    });
  });

  it('rejects a deciding party role from a different reception visit (coherence)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo } = await openWithVisit(c);
      // A party role on a SECOND, unrelated visit (different tenant-A vehicle to avoid one-open conflict).
      const otherVisit = await makeAuthorizedVisit(c, P9.V_A2);
      const otherRole = (
        await c.query(
          `SELECT id FROM rec.reception_party_roles WHERE reception_visit_id=$1 LIMIT 1`,
          [otherVisit]
        )
      ).rows[0].id;
      const req = (
        await c.query(
          `INSERT INTO wo.additional_work_requests (tenant_id, company_id, branch_id, work_order_id, summary, created_by)
           VALUES ($1,$2,$3,$4,'extra',$5) RETURNING id`,
          [...scope, wo, USER_A]
        )
      ).rows[0].id;
      await expectSqlState(
        c.query(
          `INSERT INTO wo.customer_approvals
             (tenant_id, company_id, branch_id, additional_work_request_id, deciding_party_role_id, decision, channel, presented_scope, created_by)
           VALUES ($1,$2,$3,$4,$5,'approved','phone','replace pads',$6)`,
          [...scope, req, otherRole, USER_A]
        ),
        '23514'
      );
    });
  });

  it('approves, binds immutable evidence, and clears the closure blocker', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, srRole } = await openWithVisit(c);
      const req = (
        await c.query(
          `INSERT INTO wo.additional_work_requests (tenant_id, company_id, branch_id, work_order_id, summary, is_required, created_by)
           VALUES ($1,$2,$3,$4,'extra',true,$5) RETURNING id`,
          [...scope, wo, USER_A]
        )
      ).rows[0].id;
      const appr = (
        await c.query(
          `INSERT INTO wo.customer_approvals
             (tenant_id, company_id, branch_id, additional_work_request_id, deciding_party_role_id, decision, channel, presented_scope, created_by)
           VALUES ($1,$2,$3,$4,$5,'approved','in_person','replace pads',$6) RETURNING id`,
          [...scope, req, srRole, USER_A]
        )
      ).rows[0].id;
      await c.query(
        `UPDATE wo.additional_work_requests SET state='approved', fulfillment_state='fulfilled' WHERE id=$1`,
        [req]
      );
      // A finalized approval is immutable.
      await c.query('SAVEPOINT sm');
      await expectSqlState(
        c.query(`UPDATE wo.customer_approvals SET decision='rejected' WHERE id=$1`, [appr]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT sm');
      const { rows } = await c.query(
        `SELECT state, fulfillment_state FROM wo.additional_work_requests WHERE id=$1`,
        [req]
      );
      expect(rows[0].state).toBe('approved');
      expect(rows[0].fulfillment_state).toBe('fulfilled');
    });
  });
});
