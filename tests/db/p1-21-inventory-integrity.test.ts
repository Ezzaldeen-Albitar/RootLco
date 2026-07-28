/**
 * Inventory integrity under concurrency (Phase 1-21, P1-21-BE-012, BE-013, BE-015,
 * P1-21-QA-004).
 *
 * These run against a real PostgreSQL with real concurrent connections, because the
 * guarantees under test are transactional and cannot be observed from a single
 * session. A mock cannot have a race.
 *
 * Three things are proved here that no application-level test can prove:
 *
 *  - **Single-winner reservation.** Two sessions racing for the same final unit
 *    leave exactly one committed reservation, because `inv.reserve_stock` re-reads
 *    availability inside the balance-row `FOR UPDATE` lock.
 *  - **Negative stock is structurally impossible.** The refusal comes from CHECK
 *    constraints on `inv.stock_balances`, so it holds even for a raw statement that
 *    bypasses every application path.
 *  - **The application's vocabulary matches the deployed catalog.** The domain
 *    constants are read back from `pg_constraint`, so a constant that drifts from
 *    its CHECK fails the build rather than rotting quietly.
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
import { seedItem, seedLocations, seedStock, expectFail } from './p1-10-helpers';
import {
  DAMAGE_DISPOSITIONS,
  DIRECTIONS,
  ITEM_TYPES,
  LOCATION_TYPES,
  MOVEMENT_REFERENCE_MATRIX,
  MOVEMENT_TYPES,
  REFERENCE_KINDS,
  RESERVATION_STATES,
} from '@/modules/inventory';

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

/** Reads the values of a CHECK constraint's `IN (...)` list from the live catalog. */
async function checkValues(table: string, constraint: string): Promise<string[]> {
  const result = await admin.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = $1::regclass AND conname = $2`,
    [table, constraint]
  );
  const def = result.rows[0]?.def ?? '';
  return [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1] as string).sort();
}

describe('P1-21 vocabulary matches the deployed inv catalog', () => {
  it('transcribes every CHECK constraint exactly', async () => {
    // The application refuses a bad value with a readable message instead of
    // surfacing a check_violation from four layers down — but only while the
    // transcription is accurate. This is what keeps it accurate.
    expect(await checkValues('inv.stock_movements', 'ck_stock_movements_type')).toEqual(
      [...MOVEMENT_TYPES].sort()
    );
    expect(await checkValues('inv.stock_movements', 'ck_stock_movements_reference_kind')).toEqual(
      [...REFERENCE_KINDS].sort()
    );
    expect(await checkValues('inv.stock_movements', 'ck_stock_movements_direction')).toEqual(
      [...DIRECTIONS].sort()
    );
    expect(await checkValues('inv.stock_reservations', 'ck_stock_reservations_status')).toEqual(
      [...RESERVATION_STATES].sort()
    );
    expect(await checkValues('inv.stock_locations', 'ck_stock_locations_type')).toEqual(
      [...LOCATION_TYPES].sort()
    );
    expect(await checkValues('inv.item_master', 'ck_item_master_type')).toEqual(
      [...ITEM_TYPES].sort()
    );
    expect(await checkValues('inv.damaged_stock', 'ck_damaged_stock_disposition')).toEqual(
      [...DAMAGE_DISPOSITIONS].sort()
    );
  });

  it('confirms quantity is numeric(12,3) everywhere it is stored', async () => {
    // The exact-decimal value object is built on this. If a column were widened the
    // Quantity scale would silently start truncating.
    const result = await admin.query<{ table_name: string; precision: number; scale: number }>(
      `SELECT table_name, numeric_precision AS precision, numeric_scale AS scale
         FROM information_schema.columns
        WHERE table_schema = 'inv' AND column_name = 'quantity'
        ORDER BY table_name`
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(`${row.table_name}:${row.precision},${row.scale}`).toBe(`${row.table_name}:12,3`);
    }
  });
});

describe('P1-21-BE-013 — concurrent reservation protection', () => {
  it('leaves exactly one winner when two sessions race for the last unit', async () => {
    // Fixtures must COMMIT, because the two racing sessions are separate connections
    // and cannot see an uncommitted setup.
    const setup = await runtime.connect();
    let item = '';
    let warehouse = '';
    try {
      await setup.query('BEGIN');
      await setup.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      const seededItem = await seedItem(setup, 'race1');
      const seededLocations = await seedLocations(setup, 'race1');
      item = seededItem.item;
      warehouse = seededLocations.warehouse;
      await seedStock(setup, item, warehouse, 1, 'race1');
      await setup.query('COMMIT');
    } catch (error) {
      await setup.query('ROLLBACK');
      throw error;
    } finally {
      setup.release();
    }

    const attempt = async (): Promise<'won' | 'lost'> => {
      const client = await runtime.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
          [USER_A, TENANT_A]
        );
        await client.query(`SELECT inv.reserve_stock($1,$2,1)`, [item, warehouse]);
        await client.query('COMMIT');
        return 'won';
      } catch {
        await client.query('ROLLBACK').catch(() => undefined);
        return 'lost';
      } finally {
        client.release();
      }
    };

    // Ten simultaneous attempts on one unit.
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => attempt()));
    const winners = outcomes.filter((o) => o === 'won').length;
    expect(winners).toBe(1);

    // The balance agrees, and available never went negative.
    const balance = await admin.query<{
      on_hand_qty: string;
      reserved_qty: string;
      available_qty: string;
    }>(
      `SELECT on_hand_qty, reserved_qty, available_qty FROM inv.stock_balances
        WHERE item_id = $1 AND location_id = $2`,
      [item, warehouse]
    );
    expect(balance.rows[0]?.reserved_qty).toBe('1.000');
    expect(balance.rows[0]?.available_qty).toBe('0.000');

    // Exactly one active reservation row exists — no partial or duplicate booking.
    const reservations = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM inv.stock_reservations
        WHERE item_id = $1 AND location_id = $2 AND status = 'active'`,
      [item, warehouse]
    );
    expect(Number(reservations.rows[0]?.n)).toBe(1);
  }, 60_000);
});

describe('P1-21-BE-012 — negative stock is structurally impossible', () => {
  it('refuses a raw balance write that would go negative, bypassing every function', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'neg1');
      const { warehouse } = await seedLocations(c, 'neg1');
      await seedStock(c, item, warehouse, 5, 'neg1');
      // Not through inv.post_stock_movement — a DIRECT update, which app_runtime is
      // granted. The refusal therefore comes from the constraint, not the function.
      await expectFail(
        c,
        '23514',
        `UPDATE inv.stock_balances SET on_hand_qty = -1
          WHERE tenant_id = $1 AND item_id = $2 AND location_id = $3`,
        [TENANT_A, item, warehouse]
      );
      await expectFail(
        c,
        '23514',
        `UPDATE inv.stock_balances SET reserved_qty = on_hand_qty + 1
          WHERE tenant_id = $1 AND item_id = $2 AND location_id = $3`,
        [TENANT_A, item, warehouse]
      );
    });
  });

  it('refuses an issue larger than stock even when a work order is open', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const { item } = await seedItem(c, 'neg2');
      const { warehouse } = await seedLocations(c, 'neg2');
      await seedStock(c, item, warehouse, 2, 'neg2');
      await expectFail(c, '23514', `SELECT inv.issue_part($1,$2,$3,3)`, [wo, item, warehouse]);
    });
  });

  it('keeps stored balances coherent with the ledger after every posting', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const { item } = await seedItem(c, 'coh1');
      const { warehouse } = await seedLocations(c, 'coh1');
      await seedStock(c, item, warehouse, 10, 'coh1');
      await c.query(`SELECT inv.issue_part($1,$2,$3,4)`, [wo, item, warehouse]);

      const check = await c.query<{ stored: string; ledger: string }>(
        `SELECT b.on_hand_qty AS stored,
                COALESCE((SELECT sum(m.signed_qty) FROM inv.stock_movements m
                           WHERE m.item_id = b.item_id AND m.location_id = b.location_id), 0)::text
                  AS ledger
           FROM inv.stock_balances b
          WHERE b.item_id = $1 AND b.location_id = $2`,
        [item, warehouse]
      );
      // The reconciliation endpoint reports exactly this comparison; here it is
      // asserted directly so the endpoint's zero-discrepancy claim has a basis.
      expect(check.rows[0]?.stored).toBe(check.rows[0]?.ledger);
    });
  });
});

describe('P1-21-BE-015 — every movement carries a valid business reference', () => {
  it('refuses every illegal (type, reference_kind, direction) triple', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'ref1');
      const { warehouse } = await seedLocations(c, 'ref1');

      // Walk the whole product. The 7 legal triples are excluded; every other one
      // must be refused by ck_stock_movements_type_direction or the provenance guard,
      // even with a well-formed row and a real item and location.
      let refused = 0;
      for (const movementType of MOVEMENT_TYPES) {
        for (const referenceKind of REFERENCE_KINDS) {
          for (const direction of DIRECTIONS) {
            const legal = MOVEMENT_REFERENCE_MATRIX.some(
              (r) =>
                r.movementType === movementType &&
                r.referenceKind === referenceKind &&
                r.direction === direction
            );
            if (legal) continue;
            await expectFail(
              c,
              ['23514', '23503'],
              `INSERT INTO inv.stock_movements
                 (tenant_id, company_id, branch_id, item_id, location_id, movement_type,
                  direction, quantity, reference_kind, reference_id, occurred_at, actor_id, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,gen_random_uuid(),now(),$9,$9)`,
              [
                TENANT_A,
                COMPANY_A1,
                BRANCH_A1,
                item,
                warehouse,
                movementType,
                direction,
                referenceKind,
                USER_A,
              ]
            );
            refused += 1;
          }
        }
      }
      expect(refused).toBe(43);
    });
  }, 60_000);

  it('refuses a legal triple whose source row does not exist', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'ref2');
      const { warehouse } = await seedLocations(c, 'ref2');
      // The shape is legal; the provenance is forged. A movement cannot mint stock
      // without a quantity-matched source in the correct state.
      await expectFail(
        c,
        ['23514', '23503'],
        `INSERT INTO inv.stock_movements
           (tenant_id, company_id, branch_id, item_id, location_id, movement_type,
            direction, quantity, reference_kind, reference_id, occurred_at, actor_id, created_by)
         VALUES ($1,$2,$3,$4,$5,'opening','in',999,'opening_line',gen_random_uuid(),now(),$6,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, item, warehouse, USER_A]
      );
    });
  });

  it('refuses a second movement citing the same source and direction (single-use)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const { item } = await seedItem(c, 'ref3');
      const { warehouse } = await seedLocations(c, 'ref3');
      await seedStock(c, item, warehouse, 10, 'ref3');
      const issue = (
        await c.query<{ id: string }>(`SELECT inv.issue_part($1,$2,$3,2) AS id`, [
          wo,
          item,
          warehouse,
        ])
      ).rows[0]!.id;
      // uq_stock_movements_source makes each source single-use, which is what blocks
      // a replayed post from taking the stock twice.
      await expectFail(
        c,
        ['23505', '23514'],
        `INSERT INTO inv.stock_movements
           (tenant_id, company_id, branch_id, item_id, location_id, movement_type,
            direction, quantity, reference_kind, reference_id, occurred_at, actor_id, created_by)
         VALUES ($1,$2,$3,$4,$5,'issue','out',2,'part_issue',$6,now(),$7,$7)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, item, warehouse, issue, USER_A]
      );
    });
  });

  it('keeps the movement ledger append-only', async () => {
    // SELECT + INSERT only. A correction is a new movement, never an edit — so there
    // is no "fix the balance" path that leaves no trace.
    const grants = await admin.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'inv' AND table_name = 'stock_movements' AND grantee = 'app_runtime'
        ORDER BY privilege_type`
    );
    expect(grants.rows.map((r) => r.privilege_type).sort()).toEqual(['INSERT', 'SELECT']);
  });
});

describe('customer-supplied and external-purchase parts never touch stock', () => {
  it('has no reference kind that either could cite', async () => {
    const kinds = await checkValues('inv.stock_movements', 'ck_stock_movements_reference_kind');
    expect(kinds).not.toContain('customer_supplied');
    expect(kinds).not.toContain('external_purchase');
  });

  it('records both without creating a movement or a balance', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      const before = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM inv.stock_movements WHERE tenant_id = $1`,
        [TENANT_A]
      );
      await c.query(
        `INSERT INTO inv.customer_supplied_parts
           (tenant_id, company_id, branch_id, work_order_id, description, quantity, created_by)
         VALUES ($1,$2,$3,$4,'Customer battery',1,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, USER_A]
      );
      await c.query(
        `INSERT INTO inv.external_purchase_parts
           (tenant_id, company_id, branch_id, work_order_id, supplier_name, description,
            quantity, created_by)
         VALUES ($1,$2,$3,$4,'Local supplier','Bearing',1,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, USER_A]
      );
      const after = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM inv.stock_movements WHERE tenant_id = $1`,
        [TENANT_A]
      );
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });
  });

  it('makes company ownership of a customer part unrepresentable', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.customer_supplied_parts
           (tenant_id, company_id, branch_id, work_order_id, description, quantity,
            customer_owned, created_by)
         VALUES ($1,$2,$3,$4,'Customer battery',1,false,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, USER_A]
      );
    });
  });

  it('makes an external purchase into procurement unrepresentable', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await makeAuthorizedVisit(c);
      const wo = await newWorkOrder(c, visit);
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.external_purchase_parts
           (tenant_id, company_id, branch_id, work_order_id, supplier_name, description,
            quantity, is_procurement, created_by)
         VALUES ($1,$2,$3,$4,'Local supplier','Bearing',1,true,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, USER_A]
      );
    });
  });
});
