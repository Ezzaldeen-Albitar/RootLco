/**
 * P1-32 preparatory inventory slice — the database half (P1-32-PRE-040…049).
 *
 * Stock transfers with a branch-level transit location, goods receipts with an
 * append-only restricted cost history, rejected adjustments, and stock counts that
 * raise pending adjustments. Every assertion here is on the LEDGER and the BALANCE
 * as the protected functions leave them, because the application layer is only as
 * safe as the invariants these functions and their guards keep:
 *
 *  - a transfer's quantity is in exactly one cell at every instant, and the
 *    provenance guard refuses any transfer movement that names the wrong location,
 *    the wrong quantity, or the wrong status;
 *  - a posted receipt appends a cost layer and rewrites nothing, and a cost layer
 *    cannot be written or read without `inv.cost.view`;
 *  - a count never posts stock — reconciling it raises a PENDING adjustment;
 *  - every new table is tenant-isolated by RLS, and a transfer is visible to its
 *    destination branch and to no other branch.
 *
 * Cases run inside rolled-back transactions on the runtime role, except the three
 * that need COMMITTED rows: the count delta (a movement must come from a later
 * transaction than the snapshot), the tenant-isolation census, and the single-winner
 * race. `cleanFixtures` unwinds those through `deleteTenantCascade`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  runtimeClient,
  setContext,
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
import { seedItem, seedLocations, seedStock, expectFail, OTHER_ACTOR } from './p1-10-helpers';

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

const onHand = async (c: Q, item: string, location: string): Promise<string> =>
  (
    await c.query(
      `SELECT COALESCE((SELECT on_hand_qty FROM inv.stock_balances
                         WHERE item_id = $1 AND location_id = $2), 0)::numeric(12,3)::text AS q`,
      [item, location]
    )
  ).rows[0].q;

/** Σ signed movements for a cell — the ledger fact every balance must equal. */
const ledger = async (c: Q, item: string, location: string): Promise<string> =>
  (
    await c.query(
      `SELECT COALESCE(SUM(signed_qty), 0)::numeric(12,3)::text AS q
         FROM inv.stock_movements WHERE item_id = $1 AND location_id = $2`,
      [item, location]
    )
  ).rows[0].q;

const asUser = (c: Q, userId: string) =>
  c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

const asBranches = (c: Q, branchIds: string[] | null) =>
  c.query(`SELECT set_config('app.branch_ids', $1, true)`, [branchIds ? branchIds.join(',') : '']);

/** A sellable storage location under an existing warehouse in branch A1. */
async function storageUnder(c: Q, warehouse: string, tag: string): Promise<string> {
  return (
    await one<{ id: string }>(
      c,
      `INSERT INTO inv.stock_locations
         (tenant_id, company_id, branch_id, location_code, name, location_type, parent_location_id, created_by)
       VALUES ($1,$2,$3,$4,$5,'storage',$6,$7) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, `st_${tag}`, `Storage ${tag}`, warehouse, USER_A]
    )
  ).id;
}

/** A second branch of company A1 with its own warehouse, created inside the caller's tx. */
async function secondBranch(c: Q, tag: string): Promise<{ branch: string; warehouse: string }> {
  const branch = (
    await one<{ id: string }>(
      c,
      `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
       VALUES ($1,$2,$3,$4,'UTC',$5) RETURNING id`,
      [TENANT_A, COMPANY_A1, `br_${tag}`, `Branch ${tag}`, USER_A]
    )
  ).id;
  const warehouse = (
    await one<{ id: string }>(
      c,
      `INSERT INTO inv.stock_locations
         (tenant_id, company_id, branch_id, location_code, name, location_type, created_by)
       VALUES ($1,$2,$3,$4,$5,'warehouse',$6) RETURNING id`,
      [TENANT_A, COMPANY_A1, branch, `wh2_${tag}`, `Warehouse ${tag}`, USER_A]
    )
  ).id;
  return { branch, warehouse };
}

describe('transit location', () => {
  it('is parentless, system-created once per branch, and reused', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const first = (
        await one<{ id: string }>(c, `SELECT inv.ensure_transit_location($1,$2) AS id`, [
          COMPANY_A1,
          BRANCH_A1,
        ])
      ).id;
      const second = (
        await one<{ id: string }>(c, `SELECT inv.ensure_transit_location($1,$2) AS id`, [
          COMPANY_A1,
          BRANCH_A1,
        ])
      ).id;
      expect(second).toBe(first);
      const row = await one<{ location_type: string; parent_location_id: string | null }>(
        c,
        `SELECT location_type, parent_location_id FROM inv.stock_locations WHERE id = $1`,
        [first]
      );
      expect(row.location_type).toBe('transit');
      expect(row.parent_location_id).toBeNull();

      // A transit location that names a parent is refused by the hierarchy guard.
      const { warehouse } = await seedLocations(c, 'tr_parent');
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.stock_locations
           (tenant_id, company_id, branch_id, location_code, name, location_type, parent_location_id, created_by)
         VALUES ($1,$2,$3,'TRANSIT_X','Nested transit','transit',$4,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, warehouse, USER_A]
      );
    });
  });
});

describe('stock transfers', () => {
  it('dispatches into transit and receives out of it, keeping every balance equal to its ledger', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'tr1');
      const { warehouse } = await seedLocations(c, 'tr1');
      const storage = await storageUnder(c, warehouse, 'tr1');
      await seedStock(c, item, warehouse, 10, 'tr1');

      const transfer = (
        await one<{ id: string }>(
          c,
          `SELECT inv.dispatch_transfer($1,$2,$3,4.250,'restock',NULL,NULL) AS id`,
          [item, warehouse, storage]
        )
      ).id;
      const row = await one<{ status: string; transit_location_id: string }>(
        c,
        `SELECT status, transit_location_id FROM inv.stock_transfers WHERE id = $1`,
        [transfer]
      );
      expect(row.status).toBe('dispatched');
      const transit = row.transit_location_id;

      // In transit: gone from the source, not yet at the destination.
      expect(await onHand(c, item, warehouse)).toBe('5.750');
      expect(await onHand(c, item, transit)).toBe('4.250');
      expect(await onHand(c, item, storage)).toBe('0.000');

      await c.query(`SELECT inv.receive_transfer($1, 4.250, NULL)`, [transfer]);
      expect(await onHand(c, item, transit)).toBe('0.000');
      expect(await onHand(c, item, storage)).toBe('4.250');
      const received = await one<{ status: string; received_quantity: string }>(
        c,
        `SELECT status, received_quantity::text FROM inv.stock_transfers WHERE id = $1`,
        [transfer]
      );
      expect(received.status).toBe('received');
      expect(received.received_quantity).toBe('4.250');

      // Coherence re-adds: every touched balance equals its own movement sum.
      for (const location of [warehouse, transit, storage]) {
        expect(await onHand(c, item, location)).toBe(await ledger(c, item, location));
      }
      const kinds = (
        await c.query(
          `SELECT reference_kind, direction, location_id FROM inv.stock_movements
            WHERE reference_id = $1 ORDER BY seq`,
          [transfer]
        )
      ).rows;
      expect(kinds).toEqual([
        { reference_kind: 'transfer_dispatch', direction: 'out', location_id: warehouse },
        { reference_kind: 'transfer_dispatch', direction: 'in', location_id: transit },
        { reference_kind: 'transfer_receipt', direction: 'out', location_id: transit },
        { reference_kind: 'transfer_receipt', direction: 'in', location_id: storage },
      ]);
    });
  });

  it('refuses a partial receipt, a second receipt, and a receipt after cancellation', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'tr2');
      const { warehouse } = await seedLocations(c, 'tr2');
      const storage = await storageUnder(c, warehouse, 'tr2');
      await seedStock(c, item, warehouse, 5, 'tr2');
      const transfer = (
        await one<{ id: string }>(
          c,
          `SELECT inv.dispatch_transfer($1,$2,$3,3,NULL,NULL,NULL) AS id`,
          [item, warehouse, storage]
        )
      ).id;

      await expectFail(c, '23514', `SELECT inv.receive_transfer($1, 2, NULL)`, [transfer]);
      // The constraint, not only the function, makes partial receipt unrepresentable.
      await expectFail(
        c,
        '23514',
        `UPDATE inv.stock_transfers SET received_quantity = 2 WHERE id = $1`,
        [transfer]
      );

      await c.query(`SELECT inv.cancel_transfer($1, 'wrong item picked', NULL)`, [transfer]);
      expect(await onHand(c, item, warehouse)).toBe('5.000');
      expect(await onHand(c, item, storage)).toBe('0.000');
      await expectFail(c, '23514', `SELECT inv.receive_transfer($1, 3, NULL)`, [transfer]);
      await expectFail(c, '23514', `SELECT inv.cancel_transfer($1, 'again', NULL)`, [transfer]);
      // The cancelled transfer leaves four movements with a zero net effect.
      const movements = await one<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM inv.stock_movements WHERE reference_id = $1`,
        [transfer]
      );
      expect(movements.n).toBe(4);
    });
  });

  it('refuses a dispatch beyond available stock, a same-location pair, and a cross-company pair', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'tr3');
      const { warehouse } = await seedLocations(c, 'tr3');
      const storage = await storageUnder(c, warehouse, 'tr3');
      await seedStock(c, item, warehouse, 2, 'tr3');
      // Reserved stock is not available to a transfer: the dispatch is refused
      // rather than releasing someone else's reservation.
      await c.query(`SELECT inv.reserve_stock($1,$2,1.5)`, [item, warehouse]);
      await expectFail(c, '23514', `SELECT inv.dispatch_transfer($1,$2,$3,1,NULL,NULL,NULL)`, [
        item,
        warehouse,
        storage,
      ]);
      await expectFail(c, '23514', `SELECT inv.dispatch_transfer($1,$2,$2,0.5,NULL,NULL,NULL)`, [
        item,
        warehouse,
      ]);

      const company = (
        await one<{ id: string }>(
          c,
          `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
           VALUES ($1,'company_tr3','Company tr3','USD',$2) RETURNING id`,
          [TENANT_A, USER_A]
        )
      ).id;
      const branch = (
        await one<{ id: string }>(
          c,
          `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
           VALUES ($1,$2,'branch_tr3','Branch tr3','UTC',$3) RETURNING id`,
          [TENANT_A, company, USER_A]
        )
      ).id;
      const foreign = (
        await one<{ id: string }>(
          c,
          `INSERT INTO inv.stock_locations (tenant_id, company_id, branch_id, location_code, name, location_type, created_by)
           VALUES ($1,$2,$3,'wh_tr3x','Warehouse tr3x','warehouse',$4) RETURNING id`,
          [TENANT_A, company, branch, USER_A]
        )
      ).id;
      await expectFail(c, '23514', `SELECT inv.dispatch_transfer($1,$2,$3,0.5,NULL,NULL,NULL)`, [
        item,
        warehouse,
        foreign,
      ]);
    });
  });

  it('resolves a replayed idempotency key to the transfer that already exists', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'tr4');
      const { warehouse } = await seedLocations(c, 'tr4');
      const storage = await storageUnder(c, warehouse, 'tr4');
      await seedStock(c, item, warehouse, 5, 'tr4');
      const sql = `SELECT inv.dispatch_transfer($1,$2,$3,1,NULL,'odinv-key-tr4',NULL) AS id`;
      const first = (await one<{ id: string }>(c, sql, [item, warehouse, storage])).id;
      const second = (await one<{ id: string }>(c, sql, [item, warehouse, storage])).id;
      expect(second).toBe(first);
      expect(await onHand(c, item, warehouse)).toBe('4.000');
      const rows = await one<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM inv.stock_transfers WHERE idempotency_key = 'odinv-key-tr4'`
      );
      expect(rows.n).toBe(1);
    });
  });

  it('refuses a forged transfer movement: wrong location, wrong status, unknown transfer', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'tr5');
      const { warehouse } = await seedLocations(c, 'tr5');
      const storage = await storageUnder(c, warehouse, 'tr5');
      await seedStock(c, item, warehouse, 5, 'tr5');
      const transfer = (
        await one<{ id: string }>(
          c,
          `SELECT inv.dispatch_transfer($1,$2,$3,1,NULL,NULL,NULL) AS id`,
          [item, warehouse, storage]
        )
      ).id;
      const insert = `INSERT INTO inv.stock_movements
          (tenant_id, company_id, branch_id, item_id, location_id, movement_type, direction,
           quantity, reference_kind, reference_id, occurred_at, actor_id, created_by)
        VALUES ($1,$2,$3,$4,$5,'transfer',$6,1,$7,$8,now(),$9,$9)`;
      // A settlement leg while the transfer is still dispatched would deliver stock
      // no receipt authorised.
      await expectFail(c, ['23514', '23505'], insert, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        item,
        storage,
        'in',
        'transfer_receipt',
        transfer,
        USER_A,
      ]);
      // A dispatch leg naming a location the transfer does not name.
      await expectFail(c, ['23514', '23505'], insert, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        item,
        storage,
        'in',
        'transfer_dispatch',
        transfer,
        USER_A,
      ]);
      // A transfer that does not exist.
      await expectFail(c, '23503', insert, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        item,
        storage,
        'in',
        'transfer_dispatch',
        '00000000-0000-4000-8000-00000000ffff',
        USER_A,
      ]);
    });
  });

  it('shows a transfer to its destination branch and to no unrelated branch or tenant', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'tr6');
      const { warehouse } = await seedLocations(c, 'tr6');
      await seedStock(c, item, warehouse, 5, 'tr6');
      const destination = await secondBranch(c, 'tr6');
      const unrelated = await secondBranch(c, 'tr6u');
      const transfer = (
        await one<{ id: string }>(
          c,
          `SELECT inv.dispatch_transfer($1,$2,$3,2,NULL,NULL,NULL) AS id`,
          [item, warehouse, destination.warehouse]
        )
      ).id;
      const visible = async () =>
        (
          await one<{ n: number }>(
            c,
            `SELECT count(*)::int AS n FROM inv.stock_transfers WHERE id = $1`,
            [transfer]
          )
        ).n;

      await asBranches(c, [destination.branch]);
      expect(await visible()).toBe(1);
      await asBranches(c, [unrelated.branch]);
      expect(await visible()).toBe(0);
      await asBranches(c, [BRANCH_A1]);
      expect(await visible()).toBe(1);
      await asBranches(c, null);
    });
  });
});

describe('goods receipts and the cost history', () => {
  async function draftReceipt(
    c: Q,
    tag: string,
    lines: { item: string; location: string; qty: string; cost?: string }[]
  ): Promise<string> {
    const receipt = (
      await one<{ id: string }>(
        c,
        `INSERT INTO inv.goods_receipts (tenant_id, company_id, branch_id, reference, received_on, created_by)
         VALUES ($1,$2,$3,$4,DATE '2026-09-01',$5) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, `GR-${tag}`, USER_A]
      )
    ).id;
    let lineNo = 0;
    for (const line of lines) {
      lineNo += 1;
      await c.query(
        `INSERT INTO inv.goods_receipt_lines
           (tenant_id, company_id, branch_id, receipt_id, line_no, item_id, location_id, quantity,
            unit_cost, currency_code, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10,$11)`,
        [
          TENANT_A,
          COMPANY_A1,
          BRANCH_A1,
          receipt,
          lineNo,
          line.item,
          line.location,
          line.qty,
          line.cost ?? null,
          line.cost === undefined ? null : 'USD',
          USER_A,
        ]
      );
    }
    return receipt;
  }

  it('posts one receipt movement per line, and writes no cost layer for unpriced lines', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'gr1');
      const { warehouse } = await seedLocations(c, 'gr1');
      const storage = await storageUnder(c, warehouse, 'gr1');
      const receipt = await draftReceipt(c, 'gr1', [
        { item, location: warehouse, qty: '3.000' },
        { item, location: storage, qty: '1.500' },
      ]);

      // A draft cannot be cited by a movement — the provenance guard demands posted.
      const line = (
        await one<{ id: string }>(
          c,
          `SELECT id FROM inv.goods_receipt_lines WHERE receipt_id = $1 AND line_no = 1`,
          [receipt]
        )
      ).id;
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.stock_movements
           (tenant_id, company_id, branch_id, item_id, location_id, movement_type, direction,
            quantity, reference_kind, reference_id, occurred_at, actor_id, created_by)
         VALUES ($1,$2,$3,$4,$5,'receipt','in',3,'goods_receipt_line',$6,now(),$7,$7)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, item, warehouse, line, USER_A]
      );

      const posted = await one<{ n: number }>(c, `SELECT inv.post_goods_receipt($1) AS n`, [
        receipt,
      ]);
      expect(posted.n).toBe(2);
      expect(await onHand(c, item, warehouse)).toBe('3.000');
      expect(await onHand(c, item, storage)).toBe('1.500');
      expect(await onHand(c, item, warehouse)).toBe(await ledger(c, item, warehouse));
      const status = await one<{ status: string }>(
        c,
        `SELECT status FROM inv.goods_receipts WHERE id = $1`,
        [receipt]
      );
      expect(status.status).toBe('posted');
      await expectFail(c, '23514', `SELECT inv.post_goods_receipt($1)`, [receipt]);
    });
  });

  it('refuses to post an empty receipt', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await draftReceipt(c, 'gr2', []);
      await expectFail(c, '23514', `SELECT inv.post_goods_receipt($1)`, [receipt]);
    });
  });

  it('refuses a priced posting without inv.cost.view, and moves no stock when it does', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'gr3');
      const { warehouse } = await seedLocations(c, 'gr3');
      const receipt = await draftReceipt(c, 'gr3', [
        { item, location: warehouse, qty: '2.000', cost: '12.3456' },
      ]);
      // USER_A holds no inv.cost.view, so the gated layer INSERT fails and the whole
      // posting — movement included — is refused as one statement.
      await expectFail(c, '42501', `SELECT inv.post_goods_receipt($1)`, [receipt]);
      expect(await onHand(c, item, warehouse)).toBe('0.000');
    });
  });

  it('makes the cost layers append-only and gated on inv.cost.view', async () => {
    const grants = await admin.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'inv' AND table_name = 'item_cost_layers' AND grantee = 'app_runtime'
        ORDER BY 1`
    );
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);

    const policies = await admin.query<{ polname: string; expr: string }>(
      `SELECT p.polname, COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
              COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') AS expr
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'inv' AND c.relname = 'item_cost_layers'`
    );
    expect(policies.rows.length).toBe(2);
    for (const policy of policies.rows) {
      expect(policy.expr, policy.polname).toContain("has_permission('inv.cost.view'");
    }

    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'gr4');
      await expectFail(
        c,
        '42501',
        `INSERT INTO inv.item_cost_layers
           (tenant_id, company_id, branch_id, item_id, source_kind, source_id, quantity, unit_cost, currency_code, created_by)
         VALUES ($1,$2,$3,$4,'goods_receipt_line',gen_random_uuid(),1,5,'USD',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, item, USER_A]
      );
      await expectFail(c, '42501', `UPDATE inv.item_cost_layers SET unit_cost = 0`);
      await expectFail(c, '42501', `DELETE FROM inv.item_cost_layers`);
    });
  });
});

describe('adjustment rejection', () => {
  it('refuses a self-rejection, and a rejection by someone else moves nothing', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'adj1');
      const { warehouse } = await seedLocations(c, 'adj1');
      const adjustment = (
        await one<{ id: string }>(
          c,
          `INSERT INTO inv.stock_adjustments
             (tenant_id, company_id, branch_id, item_id, location_id, direction, quantity, reason, requested_by, created_by)
           VALUES ($1,$2,$3,$4,$5,'in',2,'found on shelf',$6,$6) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, item, warehouse, USER_A]
        )
      ).id;
      await expectFail(c, '23514', `SELECT inv.reject_adjustment($1)`, [adjustment]);
      await asUser(c, OTHER_ACTOR);
      await c.query(`SELECT inv.reject_adjustment($1)`, [adjustment]);
      await asUser(c, USER_A);
      const row = await one<{ status: string }>(
        c,
        `SELECT status FROM inv.stock_adjustments WHERE id = $1`,
        [adjustment]
      );
      expect(row.status).toBe('rejected');
      expect(await onHand(c, item, warehouse)).toBe('0.000');
      await asUser(c, OTHER_ACTOR);
      await expectFail(c, '23514', `SELECT inv.approve_adjustment($1)`, [adjustment]);
      await asUser(c, USER_A);
    });
  });
});

describe('stock counts', () => {
  it('folds in movements posted during the count and raises a pending adjustment without posting', async () => {
    // Three COMMITTED transactions, because that is the case the delta exists for:
    // `snapshot_at` is the opening transaction's time, and only a movement from a
    // LATER transaction is strictly after it. One rolled-back transaction would
    // share one `now()` and could not show the delta at all.
    const opened = await withCommittedTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'odinv_sc1');
      const { item: surplusItem } = await seedItem(c, 'odinv_sc1s');
      const { warehouse } = await seedLocations(c, 'odinv_sc1');
      const storage = await storageUnder(c, warehouse, 'odinv_sc1');
      await seedStock(c, item, warehouse, 10, 'odinv_sc1');
      const count = (
        await one<{ id: string }>(c, `SELECT inv.open_stock_count($1,NULL,NULL,NULL) AS id`, [
          warehouse,
        ])
      ).id;
      const snapshot = await one<{ snapshot_qty: string }>(
        c,
        `SELECT snapshot_qty::text FROM inv.stock_count_lines WHERE count_id = $1 AND item_id = $2`,
        [count, item]
      );
      expect(snapshot.snapshot_qty).toBe('10.000');
      return { item, surplusItem, warehouse, storage, count };
    });

    // The ledger keeps moving: three units leave by transfer while the shelf is
    // being counted. Nothing about the open count stops it.
    await withCommittedTx(runtime, ctxA, async (c) => {
      await c.query(`SELECT inv.dispatch_transfer($1,$2,$3,3,NULL,NULL,NULL)`, [
        opened.item,
        opened.warehouse,
        opened.storage,
      ]);
    });

    await withRolledBackTx(runtime, ctxA, async (c) => {
      // The counter finds 6. Expected is 10 - 3 = 7, so the variance is -1 — not
      // the -4 a count that ignored the movement would report.
      await c.query(`SELECT inv.record_stock_count_line($1,$2,6)`, [opened.count, opened.item]);
      // A surplus item the snapshot never saw.
      await c.query(`SELECT inv.record_stock_count_line($1,$2,2)`, [
        opened.count,
        opened.surplusItem,
      ]);
      const status = await one<{ status: string }>(
        c,
        `SELECT status FROM inv.stock_counts WHERE id = $1`,
        [opened.count]
      );
      expect(status.status).toBe('counting');

      const raised = await one<{ n: number }>(c, `SELECT inv.reconcile_stock_count($1) AS n`, [
        opened.count,
      ]);
      expect(raised.n).toBe(2);

      const lines = (
        await c.query(
          `SELECT l.item_id, l.snapshot_qty::text AS snapshot_qty, l.counted_qty::text AS counted_qty,
                  l.movement_delta_during_count::text AS delta, l.variance_qty::text AS variance_qty,
                  a.direction, a.quantity::text AS adj_qty, a.status AS adj_status
             FROM inv.stock_count_lines l
             LEFT JOIN inv.stock_adjustments a ON a.id = l.adjustment_id
            WHERE l.count_id = $1`,
          [opened.count]
        )
      ).rows as {
        item_id: string;
        snapshot_qty: string;
        counted_qty: string;
        delta: string;
        variance_qty: string;
        direction: string | null;
        adj_qty: string | null;
        adj_status: string | null;
      }[];
      const byItem = new Map(lines.map((line) => [line.item_id, line]));

      const counted = byItem.get(opened.item);
      expect(counted?.snapshot_qty).toBe('10.000');
      expect(counted?.delta).toBe('-3.000');
      expect(counted?.variance_qty).toBe('-1.000');
      expect(counted?.direction).toBe('out');
      expect(counted?.adj_qty).toBe('1.000');
      expect(counted?.adj_status).toBe('pending');

      const surplus = byItem.get(opened.surplusItem);
      expect(surplus?.snapshot_qty).toBe('0.000');
      expect(surplus?.variance_qty).toBe('2.000');
      expect(surplus?.direction).toBe('in');
      expect(surplus?.adj_status).toBe('pending');

      // Posts nothing: the balance still says what the ledger says, 10 - 3.
      expect(await onHand(c, opened.item, opened.warehouse)).toBe('7.000');
      expect(await onHand(c, opened.surplusItem, opened.warehouse)).toBe('0.000');
      const final = await one<{ status: string }>(
        c,
        `SELECT status FROM inv.stock_counts WHERE id = $1`,
        [opened.count]
      );
      expect(final.status).toBe('reconciled');
      await expectFail(c, '23514', `SELECT inv.reconcile_stock_count($1)`, [opened.count]);
      await expectFail(c, '23514', `SELECT inv.record_stock_count_line($1,$2,1)`, [
        opened.count,
        opened.item,
      ]);
    });
  }, 60_000);

  it('allows one open count per location, and a cancelled count raises nothing', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'sc2');
      const { warehouse } = await seedLocations(c, 'sc2');
      await seedStock(c, item, warehouse, 4, 'sc2');
      const count = (
        await one<{ id: string }>(c, `SELECT inv.open_stock_count($1,NULL,NULL,NULL) AS id`, [
          warehouse,
        ])
      ).id;
      await expectFail(c, '23505', `SELECT inv.open_stock_count($1,NULL,NULL,NULL)`, [warehouse]);
      await c.query(`SELECT inv.record_stock_count_line($1,$2,0)`, [count, item]);
      await c.query(`SELECT inv.cancel_stock_count($1,'recount tomorrow')`, [count]);
      const adjustments = await one<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM inv.stock_adjustments WHERE location_id = $1`,
        [warehouse]
      );
      expect(adjustments.n).toBe(0);
      await expectFail(c, '23514', `SELECT inv.reconcile_stock_count($1)`, [count]);
      // Once cancelled, the location may be counted again.
      await c.query(`SELECT inv.open_stock_count($1,NULL,NULL,NULL)`, [warehouse]);
    });
  });
});

describe('tenant isolation of the new tables', () => {
  it('hides every new table row of tenant A from tenant B', async () => {
    const seeded = await withCommittedTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'iso_odinv');
      const { warehouse } = await seedLocations(c, 'iso_odinv');
      const storage = await storageUnder(c, warehouse, 'iso_odinv');
      await seedStock(c, item, warehouse, 5, 'iso_odinv');
      await c.query(`SELECT inv.dispatch_transfer($1,$2,$3,1,NULL,NULL,NULL)`, [
        item,
        warehouse,
        storage,
      ]);
      const receipt = (
        await one<{ id: string }>(
          c,
          `INSERT INTO inv.goods_receipts (tenant_id, company_id, branch_id, received_on, created_by)
           VALUES ($1,$2,$3,DATE '2026-09-01',$4) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
        )
      ).id;
      await c.query(
        `INSERT INTO inv.goods_receipt_lines
           (tenant_id, company_id, branch_id, receipt_id, line_no, item_id, location_id, quantity, created_by)
         VALUES ($1,$2,$3,$4,1,$5,$6,1,$7)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, item, warehouse, USER_A]
      );
      await c.query(`SELECT inv.open_stock_count($1,NULL,NULL,NULL)`, [warehouse]);
      return { item, warehouse };
    });

    const tables = [
      'inv.stock_transfers',
      'inv.goods_receipts',
      'inv.goods_receipt_lines',
      'inv.item_cost_layers',
      'inv.stock_counts',
      'inv.stock_count_lines',
    ];
    const seen = await withRolledBackTx(runtime, ctxA, async (c) => {
      const out: Record<string, number> = {};
      for (const table of tables) {
        out[table] = (await one<{ n: number }>(c, `SELECT count(*)::int AS n FROM ${table}`)).n;
      }
      return out;
    });
    // Tenant A sees what it wrote (cost layers are gated and USER_A may not see them).
    expect(seen['inv.stock_transfers']).toBeGreaterThan(0);
    expect(seen['inv.goods_receipts']).toBeGreaterThan(0);
    expect(seen['inv.goods_receipt_lines']).toBeGreaterThan(0);
    expect(seen['inv.stock_counts']).toBeGreaterThan(0);
    expect(seen['inv.stock_count_lines']).toBeGreaterThan(0);

    await withRolledBackTx(runtime, ctxB, async (c) => {
      for (const table of tables) {
        const n = (await one<{ n: number }>(c, `SELECT count(*)::int AS n FROM ${table}`)).n;
        expect(n, `${table} must be invisible to tenant B`).toBe(0);
      }
      // And tenant B cannot write into tenant A's scope.
      await expectFail(
        c,
        '42501',
        `INSERT INTO inv.goods_receipts (tenant_id, company_id, branch_id, received_on, created_by)
         VALUES ($1,$2,$3,DATE '2026-09-01',$4)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, USER_B]
      );
      await expectFail(c, ['23503', '42501'], `SELECT inv.open_stock_count($1,NULL,NULL,NULL)`, [
        seeded.warehouse,
      ]);
    });
  });
});

describe('single-winner transfer receipt', () => {
  async function race(sql: string, params: unknown[]): Promise<string> {
    const client = runtimeClient();
    await client.connect();
    try {
      await client.query('BEGIN');
      await setContext(client, ctxA);
      await client.query(sql, params);
      await client.query('COMMIT');
      return 'ok';
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // the connection is closed below either way
      }
      return (error as { code?: string }).code ?? 'error';
    } finally {
      await client.end();
    }
  }

  it('receives a transfer exactly once when two receipts race (x3)', async () => {
    for (let rep = 0; rep < 3; rep += 1) {
      const { transfer, item, storage } = await withCommittedTx(runtime, ctxA, async (c) => {
        const { item: seededItem } = await seedItem(c, `odinv_race${rep}`);
        const { warehouse } = await seedLocations(c, `odinv_race${rep}`);
        const destination = await storageUnder(c, warehouse, `odinv_race${rep}`);
        await seedStock(c, seededItem, warehouse, 2, `odinv_race${rep}`);
        const id = (
          await one<{ id: string }>(
            c,
            `SELECT inv.dispatch_transfer($1,$2,$3,2,NULL,NULL,NULL) AS id`,
            [seededItem, warehouse, destination]
          )
        ).id;
        return { transfer: id, item: seededItem, storage: destination };
      });
      const results = await Promise.all([
        race(`SELECT inv.receive_transfer($1, 2, NULL)`, [transfer]),
        race(`SELECT inv.receive_transfer($1, 2, NULL)`, [transfer]),
      ]);
      expect(results.filter((r) => r === 'ok').length, `rep ${rep}: one winner`).toBe(1);
      expect(results.filter((r) => r === '23514').length, `rep ${rep}: loser refused`).toBe(1);
      const balance = await admin.query<{ q: string }>(
        `SELECT on_hand_qty::text AS q FROM inv.stock_balances WHERE item_id = $1 AND location_id = $2`,
        [item, storage]
      );
      expect(balance.rows[0]?.q).toBe('2.000');
    }
  });
});
