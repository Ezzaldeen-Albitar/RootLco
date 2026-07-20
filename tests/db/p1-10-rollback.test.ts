/**
 * Phase 1-10 — Rollback / atomicity: a failed operation leaves no partial rows.
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

const count = async (c: { query: typeof runtime.query }, sql: string, params: unknown[]) =>
  Number((await c.query(sql, params)).rows[0].n);

describe('p1-10 rollback / atomicity', () => {
  it('leaves reserved unchanged after a failed over-reservation', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rb1');
      const { warehouse } = await seedLocations(c, 'rb1');
      await seedStock(c, item, warehouse, 5, 'rb1');
      await c.query(`SELECT inv.reserve_stock($1,$2,3)`, [item, warehouse]);
      await expectFail(c, '23514', `SELECT inv.reserve_stock($1,$2,999)`, [item, warehouse]);
      const reserved = Number(
        (
          await c.query(
            `SELECT reserved_qty FROM inv.stock_balances WHERE item_id=$1 AND location_id=$2`,
            [item, warehouse]
          )
        ).rows[0].reserved_qty
      );
      expect(reserved).toBe(3);
    });
  });

  it('posts nothing when record_damage would drive on_hand negative', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rb2');
      const { warehouse, quarantine } = await seedLocations(c, 'rb2');
      await seedStock(c, item, warehouse, 3, 'rb2');
      await expectFail(c, '23514', `SELECT inv.record_damage($1,$2,$3,5,'too much')`, [
        item,
        warehouse,
        quarantine,
      ]);
      expect(
        await count(c, `SELECT count(*)::int n FROM inv.damaged_stock WHERE item_id=$1`, [item])
      ).toBe(0);
      expect(
        await count(
          c,
          `SELECT count(*)::int n FROM inv.stock_movements WHERE item_id=$1 AND movement_type='damage'`,
          [item]
        )
      ).toBe(0);
      // the opening on-hand is intact
      expect(
        Number(
          (
            await c.query(
              `SELECT on_hand_qty FROM inv.stock_balances WHERE item_id=$1 AND location_id=$2`,
              [item, warehouse]
            )
          ).rows[0].on_hand_qty
        )
      ).toBe(3);
    });
  });

  it('creates no part issue or movement when the work order does not exist', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rb3');
      const { warehouse } = await seedLocations(c, 'rb3');
      await seedStock(c, item, warehouse, 5, 'rb3');
      await expectFail(c, ['23503', '23514'], `SELECT inv.issue_part(gen_random_uuid(),$1,$2,2)`, [
        item,
        warehouse,
      ]);
      expect(
        await count(c, `SELECT count(*)::int n FROM inv.part_issues WHERE item_id=$1`, [item])
      ).toBe(0);
      expect(
        await count(
          c,
          `SELECT count(*)::int n FROM inv.stock_movements WHERE item_id=$1 AND movement_type='issue'`,
          [item]
        )
      ).toBe(0);
    });
  });
});
