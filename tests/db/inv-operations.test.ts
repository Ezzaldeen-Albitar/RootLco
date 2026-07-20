/**
 * Phase 1-10 — Inventory operations: opening, adjustments, damage, issue/return,
 * customer-supplied, external purchase, and movement provenance (FR-INV-003/004).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
import { seedP109Base, makeAuthorizedVisit, newWorkOrder } from './p1-09-helpers';
import { seedItem, seedLocations, seedStock, expectFail, OTHER_ACTOR } from './p1-10-helpers';

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP109Base(admin);
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

const onHand = async (c: { query: typeof runtime.query }, item: string, loc: string) =>
  Number(
    (
      await c.query(
        `SELECT on_hand_qty FROM inv.stock_balances WHERE item_id=$1 AND location_id=$2`,
        [item, loc]
      )
    ).rows[0]?.on_hand_qty ?? 0
  );

describe('inv operations', () => {
  it('approves an opening batch and rejects a self-approved one', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'o1');
      const { warehouse } = await seedLocations(c, 'o1');
      await seedStock(c, item, warehouse, 10, 'o1');
      expect(await onHand(c, item, warehouse)).toBe(10);
      // self-approval (counted_by = the approver = current user) is rejected
      const batch = (
        await c.query(
          `INSERT INTO inv.opening_inventory_batches (tenant_id, company_id, branch_id, batch_code, as_of_date, counted_by, created_by)
           VALUES ($1,$2,$3,'ob_self',DATE '2026-01-01',$4,$4) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
        )
      ).rows[0].id;
      await expectFail(c, '23514', `SELECT inv.approve_opening_batch($1)`, [batch]);
    });
  });

  it('posts an approved adjustment movement only after approval, maker<>approver', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'o2');
      const { warehouse } = await seedLocations(c, 'o2');
      await seedStock(c, item, warehouse, 10, 'o2');
      const adj = (
        await c.query(
          `INSERT INTO inv.stock_adjustments (tenant_id, company_id, branch_id, item_id, location_id, direction, quantity, reason, requested_by, created_by)
           VALUES ($1,$2,$3,$4,$5,'out',3,'shrink',$6,$7) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, item, warehouse, OTHER_ACTOR, USER_A]
        )
      ).rows[0].id;
      // no movement while pending
      const pending = Number(
        (
          await c.query(
            `SELECT count(*)::int c FROM inv.stock_movements WHERE reference_kind='adjustment' AND reference_id=$1`,
            [adj]
          )
        ).rows[0].c
      );
      expect(pending).toBe(0);
      await c.query(`SELECT inv.approve_adjustment($1)`, [adj]);
      expect(await onHand(c, item, warehouse)).toBe(7);
    });
  });

  it('records damage into quarantine keeping available >= 0 (loss release)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'o3');
      const { warehouse, quarantine } = await seedLocations(c, 'o3');
      await seedStock(c, item, warehouse, 7, 'o3');
      await c.query(`SELECT inv.reserve_stock($1,$2,6)`, [item, warehouse]);
      await c.query(`SELECT inv.record_damage($1,$2,$3,5,'dropped')`, [
        item,
        warehouse,
        quarantine,
      ]);
      const bal = (
        await c.query(
          `SELECT on_hand_qty, available_qty FROM inv.stock_balances WHERE item_id=$1 AND location_id=$2`,
          [item, warehouse]
        )
      ).rows[0];
      expect(Number(bal.on_hand_qty)).toBe(2);
      expect(Number(bal.available_qty)).toBeGreaterThanOrEqual(0);
      expect(await onHand(c, item, quarantine)).toBe(5);
    });
  });

  it('rejects a raw forged movement with no valid source (provenance)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'o4');
      const { warehouse } = await seedLocations(c, 'o4');
      await expectFail(
        c,
        ['23503', '23514'],
        `INSERT INTO inv.stock_movements (tenant_id, company_id, branch_id, item_id, location_id, movement_type, direction, quantity, reference_kind, reference_id, occurred_at, actor_id, created_by)
         VALUES ($1,$2,$3,$4,$5,'opening','in',999,'opening_line',gen_random_uuid(),now(),$6,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, item, warehouse, USER_A]
      );
    });
  });

  it('issues to an open work order and rejects a return beyond the issued quantity', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const { item } = await seedItem(c, 'o5');
      const { warehouse } = await seedLocations(c, 'o5');
      await seedStock(c, item, warehouse, 10, 'o5');
      const res = (await c.query(`SELECT inv.reserve_stock($1,$2,5) AS id`, [item, warehouse]))
        .rows[0].id;
      const issue = (
        await c.query(`SELECT inv.issue_part($1,$2,$3,5,$4) AS id`, [wo, item, warehouse, res])
      ).rows[0].id;
      expect(await onHand(c, item, warehouse)).toBe(5);
      await c.query(`SELECT inv.return_part($1,3)`, [issue]);
      expect(await onHand(c, item, warehouse)).toBe(8);
      // total returns cannot exceed the 5 issued (3 already returned, +3 -> 6 > 5)
      await expectFail(c, '23514', `SELECT inv.return_part($1,3)`, [issue]);
    });
  });

  it('customer-supplied parts have zero stock effect; external purchase stays non-procurement', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      await c.query(
        `INSERT INTO inv.customer_supplied_parts (tenant_id, company_id, branch_id, work_order_id, description, quantity, created_by)
         VALUES ($1,$2,$3,$4,'Customer battery',1,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, USER_A]
      );
      const movements = Number(
        (
          await c.query(`SELECT count(*)::int c FROM inv.stock_movements WHERE tenant_id=$1`, [
            TENANT_A,
          ])
        ).rows[0].c
      );
      expect(movements).toBe(0);
      // external purchase must be non-procurement and use the closed status vocabulary
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.external_purchase_parts (tenant_id, company_id, branch_id, work_order_id, supplier_name, description, quantity, is_procurement, created_by)
         VALUES ($1,$2,$3,$4,'Acme','Special part',1,true,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, USER_A]
      );
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.external_purchase_parts (tenant_id, company_id, branch_id, work_order_id, supplier_name, description, quantity, status, created_by)
         VALUES ($1,$2,$3,$4,'Acme','Special part',1,'goods_received',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, USER_A]
      );
    });
  });
});
