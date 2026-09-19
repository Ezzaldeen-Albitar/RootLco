/**
 * Owner directive — `inv.item_reorder_levels`, the database half.
 *
 * The table holds a threshold and nothing else: no movement, no balance, no
 * amount. What it still owes, exactly as every other `inv` table does, is that the
 * rules are the SCHEMA's rather than the application's:
 *
 *  - a level is invisible and unwritable across the tenant boundary;
 *  - a session narrowed to one branch cannot create or alter another branch's
 *    level, even though it can READ the organisation-wide one that applies to it;
 *  - one ACTIVE row per (item, company, branch, location), with NULL treated as a
 *    value — so the organisation-wide row, the company row, the branch row and the
 *    shelf row are four rows that cannot be duplicated;
 *  - retiring frees the signature without rewriting the retired row;
 *  - the narrowing columns are frozen once written;
 *  - a zero threshold is legal and a negative one is not; a preferred order
 *    quantity of zero is not an order.
 *
 * Cases run inside rolled-back transactions on the runtime role, except the
 * isolation census, which needs committed rows; `cleanFixtures` unwinds it.
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
  withCommittedTx,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
  USER_B,
} from './helpers';
import { seedItem, seedLocations, expectFail } from './p1-10-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_B };

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

const one = async <T>(c: Q, sql: string, params: unknown[] = []): Promise<T> =>
  (await c.query(sql, params)).rows[0] as T;

/** Writes one level and returns its id. NULLs are the wider scope. */
async function insertLevel(
  c: Q,
  input: {
    readonly item: string;
    readonly company?: string | null;
    readonly branch?: string | null;
    readonly location?: string | null;
    readonly quantity?: string;
    readonly preferred?: string | null;
    readonly tenant?: string;
    readonly actor?: string;
  }
): Promise<string> {
  const row = await one<{ id: string }>(
    c,
    `INSERT INTO inv.item_reorder_levels
       (tenant_id, item_id, company_id, branch_id, location_id,
        reorder_level_qty, preferred_order_qty, created_by)
     VALUES ($1,$2,$3::uuid,$4::uuid,$5::uuid,$6::numeric,$7::numeric,$8) RETURNING id`,
    [
      input.tenant ?? TENANT_A,
      input.item,
      input.company ?? null,
      input.branch ?? null,
      input.location ?? null,
      input.quantity ?? '5',
      input.preferred ?? null,
      input.actor ?? USER_A,
    ]
  );
  return row.id;
}

describe('inv.item_reorder_levels — the signature', () => {
  it('holds one ACTIVE row per (item, company, branch, location), counting NULL as a value', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rl_sig');
      const { warehouse } = await seedLocations(c, 'rl_sig');

      // Four different narrowings of the SAME item all coexist.
      await insertLevel(c, { item });
      await insertLevel(c, { item, company: COMPANY_A1 });
      await insertLevel(c, { item, company: COMPANY_A1, branch: BRANCH_A1 });
      await insertLevel(c, { item, company: COMPANY_A1, branch: BRANCH_A1, location: warehouse });
      expect(
        (
          await one<{ n: number }>(
            c,
            `SELECT count(*)::int AS n FROM inv.item_reorder_levels WHERE item_id = $1`,
            [item]
          )
        ).n
      ).toBe(4);

      // A second organisation-wide row for the same item is refused: NULLS NOT
      // DISTINCT means the two NULL company columns collide.
      await expectFail(
        c,
        '23505',
        `INSERT INTO inv.item_reorder_levels
           (tenant_id, item_id, reorder_level_qty, created_by) VALUES ($1,$2,3,$3)`,
        [TENANT_A, item, USER_A]
      );
      // And a second shelf row for the same shelf.
      await expectFail(
        c,
        '23505',
        `INSERT INTO inv.item_reorder_levels
           (tenant_id, item_id, company_id, branch_id, location_id, reorder_level_qty, created_by)
         VALUES ($1,$2,$3,$4,$5,3,$6)`,
        [TENANT_A, item, COMPANY_A1, BRANCH_A1, warehouse, USER_A]
      );
    });
  });

  it('frees the signature on retirement without rewriting the retired row', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rl_retire');
      const first = await insertLevel(c, { item, company: COMPANY_A1, branch: BRANCH_A1 });

      await c.query(
        `UPDATE inv.item_reorder_levels
            SET status = 'retired', retired_at = now(), retired_by = $2,
                record_version = record_version + 1
          WHERE id = $1`,
        [first, USER_A]
      );
      const second = await insertLevel(c, {
        item,
        company: COMPANY_A1,
        branch: BRANCH_A1,
        quantity: '9',
      });
      expect(second).not.toBe(first);

      const rows = await c.query<{ id: string; status: string; reorder_level_qty: string }>(
        `SELECT id, status, reorder_level_qty FROM inv.item_reorder_levels
          WHERE item_id = $1 ORDER BY status`,
        [item]
      );
      expect(rows.rows.map((r) => r.status)).toEqual(['active', 'retired']);
      // The retired row kept the threshold it was retired with.
      expect(rows.rows.find((r) => r.id === first)?.reorder_level_qty).toBe('5.000');
    });
  });

  it('refuses a retired status without its instant, and an instant without its actor', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rl_state');
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.item_reorder_levels
           (tenant_id, item_id, reorder_level_qty, status, created_by) VALUES ($1,$2,1,'retired',$3)`,
        [TENANT_A, item, USER_A]
      );
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.item_reorder_levels
           (tenant_id, item_id, reorder_level_qty, status, retired_at, created_by)
         VALUES ($1,$2,1,'retired',now(),$3)`,
        [TENANT_A, item, USER_A]
      );
    });
  });
});

describe('inv.item_reorder_levels — the quantities and the narrowing', () => {
  it('accepts a zero threshold, refuses a negative one and refuses a zero order quantity', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rl_qty');

      // Zero is a real level: "tell me the moment this runs out".
      const zero = await insertLevel(c, { item, company: COMPANY_A1, quantity: '0' });
      expect(
        (
          await one<{ q: string }>(
            c,
            `SELECT reorder_level_qty AS q FROM inv.item_reorder_levels WHERE id = $1`,
            [zero]
          )
        ).q
      ).toBe('0.000');

      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.item_reorder_levels
           (tenant_id, item_id, reorder_level_qty, created_by) VALUES ($1,$2,-1,$3)`,
        [TENANT_A, item, USER_A]
      );
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.item_reorder_levels
           (tenant_id, item_id, reorder_level_qty, preferred_order_qty, created_by)
         VALUES ($1,$2,1,0,$3)`,
        [TENANT_A, item, USER_A]
      );
    });
  });

  it('refuses a branch without its company and a location without its branch', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rl_narrow');
      const { warehouse } = await seedLocations(c, 'rl_narrow');
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.item_reorder_levels
           (tenant_id, item_id, branch_id, reorder_level_qty, created_by) VALUES ($1,$2,$3,1,$4)`,
        [TENANT_A, item, BRANCH_A1, USER_A]
      );
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.item_reorder_levels
           (tenant_id, item_id, company_id, location_id, reorder_level_qty, created_by)
         VALUES ($1,$2,$3,$4,1,$5)`,
        [TENANT_A, item, COMPANY_A1, warehouse, USER_A]
      );
    });
  });

  it('freezes the narrowing once written', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rl_frozen');
      // A DIFFERENT item, because the guard compares OLD with NEW: re-stating the
      // same value is not a change and must not be refused, so an assertion that
      // wrote the item back onto itself would prove nothing about the guard.
      const { item: otherItem } = await seedItem(c, 'rl_frozen_other');
      const id = await insertLevel(c, { item, company: COMPANY_A1, branch: BRANCH_A1 });
      // Moving a live level to another scope would silently re-target an alert
      // somebody is already acting on. The honest change is retire-and-replace.
      await expectFail(
        c,
        ['23514', 'P0001'],
        `UPDATE inv.item_reorder_levels SET branch_id = NULL WHERE id = $1`,
        [id]
      );
      await expectFail(
        c,
        ['23514', 'P0001'],
        `UPDATE inv.item_reorder_levels SET item_id = $2 WHERE id = $1`,
        [id, otherItem]
      );
      // The threshold itself is revisable.
      await c.query(`UPDATE inv.item_reorder_levels SET reorder_level_qty = 12 WHERE id = $1`, [
        id,
      ]);
      expect(
        (
          await one<{ q: string }>(
            c,
            `SELECT reorder_level_qty AS q FROM inv.item_reorder_levels WHERE id = $1`,
            [id]
          )
        ).q
      ).toBe('12.000');
    });
  });
});

describe('inv.item_reorder_levels — tenant and scope isolation', () => {
  it('hides a tenant A level from tenant B, and refuses a tenant B write into tenant A', async () => {
    const seeded = await withCommittedTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rl_iso');
      await insertLevel(c, { item, company: COMPANY_A1, branch: BRANCH_A1 });
      return { item };
    });

    const seenByA = await withRolledBackTx(runtime, ctxA, async (c) =>
      one<{ n: number }>(c, `SELECT count(*)::int AS n FROM inv.item_reorder_levels`)
    );
    expect(seenByA.n).toBeGreaterThan(0);

    await withRolledBackTx(runtime, ctxB, async (c) => {
      const seen = await one<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM inv.item_reorder_levels`
      );
      expect(seen.n, 'inv.item_reorder_levels must be invisible to tenant B').toBe(0);
      await expectFail(
        c,
        '42501',
        `INSERT INTO inv.item_reorder_levels
           (tenant_id, item_id, company_id, branch_id, reorder_level_qty, created_by)
         VALUES ($1,$2,$3,$4,1,$5)`,
        [TENANT_A, seeded.item, COMPANY_A1, BRANCH_A1, USER_B]
      );
    });
  });

  it('lets a branch-narrowed session READ the organisation-wide level and not WRITE another branch', async () => {
    const seeded = await withCommittedTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'rl_scope');
      const wide = await insertLevel(c, { item });
      return { item, wide };
    });

    // A session whose allowed branches exclude BRANCH_A1 entirely.
    const narrowed = {
      tenantId: TENANT_A,
      userId: USER_A,
      companyIds: [COMPANY_A1],
      branchIds: ['a1100000-0000-4000-8000-0000000000ff'],
    };
    await withRolledBackTx(runtime, narrowed, async (c) => {
      // The organisation-wide row names no branch, so it is READABLE: it is the
      // level that actually applies here, and hiding it would leave this session
      // unable to see what it is being measured against.
      const visible = await one<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM inv.item_reorder_levels WHERE id = $1`,
        [seeded.wide]
      );
      expect(visible.n).toBe(1);

      // Writing a level for a branch it does not hold is refused by the policy.
      await expectFail(
        c,
        '42501',
        `INSERT INTO inv.item_reorder_levels
           (tenant_id, item_id, company_id, branch_id, reorder_level_qty, created_by)
         VALUES ($1,$2,$3,$4,1,$5)`,
        [TENANT_A, seeded.item, COMPANY_A1, BRANCH_A1, USER_A]
      );
    });
  });
});
