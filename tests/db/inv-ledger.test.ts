/**
 * Phase 1-10 — Inventory ledger, balances, reservations (FR-INV-001/002/003, BR-INV-001/002).
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
  USER_A,
} from './helpers';
import { seedItem, seedLocations, seedStock, expectFail } from './p1-10-helpers';

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
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
    ).rows[0].on_hand_qty
  );
const available = async (c: { query: typeof runtime.query }, item: string, loc: string) =>
  Number(
    (
      await c.query(
        `SELECT available_qty FROM inv.stock_balances WHERE item_id=$1 AND location_id=$2`,
        [item, loc]
      )
    ).rows[0].available_qty
  );

describe('inv ledger & reservations', () => {
  it('derives on_hand from an approved opening movement (coherence)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'l1');
      const { warehouse } = await seedLocations(c, 'l1');
      await seedStock(c, item, warehouse, 10, 'l1');
      expect(await onHand(c, item, warehouse)).toBe(10);
    });
  });

  it('reserves against available and rejects oversell', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'l2');
      const { warehouse } = await seedLocations(c, 'l2');
      await seedStock(c, item, warehouse, 10, 'l2');
      await c.query(`SELECT inv.reserve_stock($1,$2,8)`, [item, warehouse]);
      expect(await available(c, item, warehouse)).toBe(2);
      await expectFail(c, '23514', `SELECT inv.reserve_stock($1,$2,5)`, [item, warehouse]);
    });
  });

  it('rejects a forged/incoherent direct balance write (BR-INV-002)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'l3');
      const { warehouse } = await seedLocations(c, 'l3');
      await seedStock(c, item, warehouse, 10, 'l3');
      await expectFail(
        c,
        '23514',
        `UPDATE inv.stock_balances SET on_hand_qty=999 WHERE item_id=$1 AND location_id=$2`,
        [item, warehouse]
      );
    });
  });

  it('release restores availability; consume keeps it consumed', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'l4');
      const { warehouse } = await seedLocations(c, 'l4');
      await seedStock(c, item, warehouse, 10, 'l4');
      const r = (await c.query(`SELECT inv.reserve_stock($1,$2,6) AS id`, [item, warehouse]))
        .rows[0].id;
      expect(await available(c, item, warehouse)).toBe(4);
      await c.query(`SELECT inv.release_reservation($1,'test')`, [r]);
      expect(await available(c, item, warehouse)).toBe(10);
    });
  });

  it('is idempotent for a repeated reservation key', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'l5');
      const { warehouse } = await seedLocations(c, 'l5');
      await seedStock(c, item, warehouse, 10, 'l5');
      const a = (
        await c.query(`SELECT inv.reserve_stock($1,$2,3,NULL,'k1') AS id`, [item, warehouse])
      ).rows[0].id;
      const b = (
        await c.query(`SELECT inv.reserve_stock($1,$2,3,NULL,'k1') AS id`, [item, warehouse])
      ).rows[0].id;
      expect(a).toBe(b);
      expect(await available(c, item, warehouse)).toBe(7);
    });
  });

  it('forbids UPDATE/DELETE on the immutable movement ledger', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'l6');
      const { warehouse } = await seedLocations(c, 'l6');
      await seedStock(c, item, warehouse, 5, 'l6');
      // no UPDATE/DELETE grant on stock_movements -> 42501
      await expectFail(c, '42501', `UPDATE inv.stock_movements SET quantity=1 WHERE item_id=$1`, [
        item,
      ]);
      await expectFail(c, '42501', `DELETE FROM inv.stock_movements WHERE item_id=$1`, [item]);
    });
  });
});
