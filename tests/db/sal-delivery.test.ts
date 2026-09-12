/**
 * Phase 1-11 — sal delivery / custody closure: the atomic complete_delivery primitive,
 * exactly-once custody release (C1), the delivery gates enforced inside complete_delivery,
 * M-dlv-2 (authorized receiver), the mandatory-checklist gate (L-dlv-1), M-dlv-1
 * (delivery/WO vehicle+visit coherence), and append-only signatures.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  expectFail,
  deliveringEmployee,
  makeWorkOrder,
  buildReadyDelivery,
  seedCompletedDelivery,
  completeDelivery,
  seedPartner,
  insertMandatoryChecklist,
  passAllMandatory,
} from './p1-11-helpers';
import { seedVehicle } from './p1-10-helpers';

const admin = adminPool();
const runtime = runtimePool();

const releasedCount = async (c: { query: Client['query'] }, visit: string): Promise<number> =>
  Number(
    (
      await c.query(
        `SELECT count(*)::int n FROM rec.custody_history WHERE reception_visit_id=$1 AND to_state='released'`,
        [visit]
      )
    ).rows[0].n
  );

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('p1-11 sal delivery / custody closure', () => {
  it('completes a delivery: one custody "released" row + status delivered', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { delivery, visit } = await seedCompletedDelivery(c, 'dhp');
      const d = (
        await c.query(
          `SELECT status, delivered_at, final_odometer_reading_id FROM sal.delivery_records WHERE id=$1`,
          [delivery]
        )
      ).rows[0];
      expect(d.status).toBe('delivered');
      expect(d.delivered_at).not.toBeNull();
      expect(d.final_odometer_reading_id).not.toBeNull();
      expect(await releasedCount(c, visit)).toBe(1);
      const sh = (
        await c.query(
          `SELECT count(*)::int n FROM sal.delivery_status_history WHERE delivery_record_id=$1 AND to_status='delivered'`,
          [delivery]
        )
      ).rows[0];
      expect(sh.n).toBe(1);
    });
  });

  it('is idempotent and blocks a second custody release (23514; one released row)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { delivery, visit } = await seedCompletedDelivery(c, 'd2');
      const odo1 = (
        await c.query(`SELECT final_odometer_reading_id o FROM sal.delivery_records WHERE id=$1`, [
          delivery,
        ])
      ).rows[0].o;
      const odo2 = await completeDelivery(c, delivery); // idempotent: returns the same odometer id
      expect(odo2).toBe(odo1);
      expect(await releasedCount(c, visit)).toBe(1);
      // a raw second custody release is blocked (transition/state-change guard shadows uq_custody_history_released).
      await expectFail(
        c,
        ['23514', '23505'],
        `INSERT INTO rec.custody_history (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state, actor_id)
         VALUES ($1,$2,$3,$4,'accepted','released',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, visit, USER_A]
      );
    });
  });

  // H-dlv-1 is an accepted residual: the delivery gates are enforced inside
  // sal.complete_delivery (see the receiver/checklist/signature tests below); a raw
  // custody release is a rec-domain operation governed by the merged P1-8 custody state
  // machine + the exactly-once unique index — there is no rec-forward gate to test here.

  it('rejects an unauthorized receiver (no active reception role for the visit) (M-dlv-2 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const b = await buildReadyDelivery(c, 'unauth', { addReceiver: false });
      const stranger = await seedPartner(c, 'stranger');
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.authorized_receivers (tenant_id, company_id, branch_id, delivery_record_id, receiver_partner_id, verified_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, b.delivery, stranger, USER_A]
      );
    });
  });

  it('blocks completion when a mandatory checklist item is not passed/waived (L-dlv-1 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const b = await buildReadyDelivery(c, 'nomand', { addChecklistResults: false });
      await expectFail(c, '23514', `SELECT sal.complete_delivery($1,100000,'km')`, [b.delivery]);
    });
  });

  it('rejects a delivery whose vehicle does not match the work order (M-dlv-1 23514)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, visit } = await makeWorkOrder(c, 'coh');
      const otherVehicle = await seedVehicle(c, 'cohX');
      // A REAL employee, so the refusal below is M-dlv-1 and nothing else. Passing
      // a login-account id here would still fail, but by the P1-31 P-17 eligibility
      // trigger if the two BEFORE INSERT triggers were ever reordered — a green
      // that would have stopped meaning what the case name says.
      const employee = await deliveringEmployee(c, 'coh');
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.delivery_records (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id, delivering_employee_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, otherVehicle, employee, USER_A]
      );
    });
  });

  it('keeps delivery signatures append-only (no UPDATE grant -> 42501)', async () => {
    // no UPDATE/DELETE grant to app_runtime.
    const { rows } = await admin.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema='sal' AND table_name='delivery_signatures' AND grantee='app_runtime'
          AND privilege_type IN ('UPDATE','DELETE')`
    );
    expect(rows).toEqual([]);
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const b = await buildReadyDelivery(c, 'sig');
      const sig = (
        await c.query(
          `SELECT id FROM sal.delivery_signatures WHERE delivery_record_id=$1 LIMIT 1`,
          [b.delivery]
        )
      ).rows[0].id;
      await expectFail(
        c,
        '42501',
        `UPDATE sal.delivery_signatures SET signer_role='witness' WHERE id=$1`,
        [sig]
      );
    });
  });
});

// ===========================================================================
// P1-31 P-9b — only an ACTIVE, non-deleted template is in force
// (migration 20260909090000_sal_complete_delivery_active_template_gate.sql,
//  closing CC-14). Before it, `sal.complete_delivery` filtered mandatory items
//  on the ITEM's deleted_at alone and never joined the parent template, so a
//  template that had been retired — or soft-deleted, and therefore unreachable
//  from every read — went on refusing every handover in the company.
// ===========================================================================
describe('p1-31 P-9b sal.complete_delivery template lifecycle gate', () => {
  const deactivate = (c: { query: Client['query'] }, template: string): Promise<unknown> =>
    c.query(`UPDATE sal.delivery_checklist_templates SET status='inactive' WHERE id=$1`, [
      template,
    ]);
  const reactivate = (c: { query: Client['query'] }, template: string): Promise<unknown> =>
    c.query(`UPDATE sal.delivery_checklist_templates SET status='active' WHERE id=$1`, [template]);
  const softDelete = (c: { query: Client['query'] }, template: string): Promise<unknown> =>
    c.query(
      `UPDATE sal.delivery_checklist_templates SET deleted_at=now(), deleted_by=$2 WHERE id=$1`,
      [template, USER_A]
    );
  const statusOf = async (c: { query: Client['query'] }, delivery: string): Promise<string> =>
    (await c.query(`SELECT status FROM sal.delivery_records WHERE id=$1`, [delivery])).rows[0]
      .status;

  it('still refuses while the template is ACTIVE, and lets the handover through once it is deactivated', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const b = await buildReadyDelivery(c, 'p9bdeact', { addChecklistResults: false });

      // The unmet mandatory item blocks, exactly as L-dlv-1 pins it. This half is the
      // regression guard: the join must not have withdrawn an item that IS in force.
      await expectFail(c, '23514', `SELECT sal.complete_delivery($1,100000,'km')`, [b.delivery]);

      // Retiring the TEMPLATE — not the item — is now the operator's remedy.
      await deactivate(c, b.template);
      const odo = await completeDelivery(c, b.delivery, 100001);
      expect(odo).toBeTruthy();
      expect(await statusOf(c, b.delivery)).toBe('delivered');
    });
  });

  it('lets the handover through when the template is SOFT-DELETED, and the item row survives', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const b = await buildReadyDelivery(c, 'p9bdel', { addChecklistResults: false });
      await expectFail(c, '23514', `SELECT sal.complete_delivery($1,100000,'km')`, [b.delivery]);

      await softDelete(c, b.template);
      expect(await completeDelivery(c, b.delivery, 100002)).toBeTruthy();
      expect(await statusOf(c, b.delivery)).toBe('delivered');

      // A soft delete, so every outcome ever recorded against the item stays
      // resolvable: the gate stopped counting the item, nothing was destroyed.
      const items = await c.query(
        `SELECT deleted_at FROM sal.delivery_checklist_template_items WHERE id=$1`,
        [b.item]
      );
      expect(items.rows).toHaveLength(1);
      expect(items.rows[0].deleted_at).toBeNull();
    });
  });

  it('gates again once a deactivated template is REACTIVATED', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const b = await buildReadyDelivery(c, 'p9breact', { addChecklistResults: false });

      await deactivate(c, b.template);
      // Proved not-blocking at this point by the savepoint probe rather than by
      // completing, because completing is terminal and the case needs the delivery
      // back in `ready` to test reactivation on the SAME record.
      await c.query('SAVEPOINT sp_p9b_reactivate');
      expect(await completeDelivery(c, b.delivery, 100003)).toBeTruthy();
      await c.query('ROLLBACK TO SAVEPOINT sp_p9b_reactivate');
      expect(await statusOf(c, b.delivery)).toBe('ready');

      await reactivate(c, b.template);
      await expectFail(c, '23514', `SELECT sal.complete_delivery($1,100000,'km')`, [b.delivery]);

      // And recording the result is what clears it, with the template in force.
      await passAllMandatory(c, b.delivery);
      expect(await completeDelivery(c, b.delivery, 100004)).toBeTruthy();
      expect(await statusOf(c, b.delivery)).toBe('delivered');
    });
  });

  it('keeps excluding a WITHDRAWN item under an active template (the pre-existing rule)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const b = await buildReadyDelivery(c, 'p9bitem', { addChecklistResults: false });
      await expectFail(c, '23514', `SELECT sal.complete_delivery($1,100000,'km')`, [b.delivery]);

      // The template stays ACTIVE. The item's own deleted_at filter is untouched by
      // this migration — the join ADDS a condition and removes none.
      await c.query(
        `UPDATE sal.delivery_checklist_template_items SET deleted_at=now(), deleted_by=$2 WHERE id=$1`,
        [b.item, USER_A]
      );
      expect(await completeDelivery(c, b.delivery, 100005)).toBeTruthy();
      expect(await statusOf(c, b.delivery)).toBe('delivered');
    });
  });

  it('counts a mandatory item of a SECOND active template, and stops when that one is retired', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // The scan stays COMPANY-wide across all templates — that is unchanged, and it
      // is what makes template status the operator's only company-level remedy.
      const b = await buildReadyDelivery(c, 'p9bsecond');
      const second = await insertMandatoryChecklist(c, 'p9bsecond_x');

      await expectFail(c, '23514', `SELECT sal.complete_delivery($1,100000,'km')`, [b.delivery]);

      await deactivate(c, second.template);
      expect(await completeDelivery(c, b.delivery, 100006)).toBeTruthy();
      expect(await statusOf(c, b.delivery)).toBe('delivered');
    });
  });
});
