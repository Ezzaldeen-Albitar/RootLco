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
  makeWorkOrder,
  buildReadyDelivery,
  seedCompletedDelivery,
  completeDelivery,
  seedPartner,
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
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.delivery_records (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id, delivering_employee_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, otherVehicle, USER_A]
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
