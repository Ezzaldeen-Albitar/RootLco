/**
 * P1-30 Backend remediation — an opening balance is counted ONCE per cell.
 *
 * ## The hole these cases close
 *
 * `uq_opening_inventory_lines_cell` carries `batch_id`, so it makes a counted
 * (item, location) exactly-once INSIDE ONE BATCH and says nothing across batches.
 * `inv.approve_opening_batch` takes `FOR UPDATE` on its own batch row and refuses
 * anything that is not `draft`, which serialises one batch against itself and does
 * not see a second batch at all. Two DRAFT batches in the same branch could
 * therefore each carry a line for the same cell, and approving both posted TWO
 * `opening` movements into it — the stock doubled while the ledger stayed perfectly
 * coherent, because `on_hand` really was the sum of the movements. Listing draft
 * batches (seam S-17, PR #334) makes that pair easy to reach.
 *
 * The Owner was asked directly whether counting the same item at the same location
 * a second time is ever legitimate, and answered that it never is: it must be
 * forbidden by the database, and a wrong count is corrected by an ADJUSTMENT — which
 * carries a reason and its own approval — never by a second opening.
 * `uq_stock_movements_opening_cell` is that rule.
 *
 * ## Why the index and not a check in the service
 *
 * The service cannot hold it. Two approvals racing in separate transactions would
 * both read "no opening movement here" and both post; only a unique index decides
 * a race. The cases below therefore assert the ANSWER the service gives, and the
 * LEDGER the database refuses to write, as two separate facts.
 *
 * ## Falsifiability — each mutation applied and reverted
 *
 * **A — the migration's `WHERE movement_type = 'opening'` predicate removed, making
 * the index total.** RED on OC-5: the first adjustment top-up into an already-opened
 * cell was refused 409 instead of posting. That is the case which proves the index
 * constrains opening ALONE, and it is the one that fails when the predicate goes.
 *
 * **B — the `uniqueViolation` branch deleted from `approveBatch`.** RED on OC-2:
 * the second approval answered `500 ERR-SYS-001` instead of `409 ERR-RES-002`. The
 * ledger assertions in the same case stayed GREEN, which is the point of asserting
 * both — the database was already refusing; only the answer was wrong.
 *
 * **C — `branch_id` dropped from the index key.** RED on OC-4: branch A2's opening
 * of ITEM_A was refused because branch A1 had already opened that item. A tenant
 * that opens a warehouse in a second branch must not be blocked by the first.
 *
 * These suites approve several batches, so they need several NEVER-OPENED cells:
 * `freshLocation()` mints one, which is also why the fixture catalogue's four
 * tenant-A cells are not a ceiling on this file.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
} from './helpers';
import {
  BRANCH_A2,
  BRANCH_B1,
  COMPANY_B1,
  createOpenWorkOrder,
  establishP1_19Fixtures,
} from './p1-19-helpers';
import {
  INV_APPROVER,
  INV_FULL,
  ITEM_A,
  ITEM_A_ALT,
  ITEM_B,
  WAREHOUSE_B1,
  authAs,
  balanceOf,
  cleanP1_21Fixtures,
  countRowsOf,
  establishP1_21Fixtures,
  freshLocation,
  seedStock,
} from './p1-21-helpers';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import { POST as BATCH_CREATE } from '@/app/api/v1/opening-inventory-batches/route';
import { POST as LINE_CREATE } from '@/app/api/v1/opening-inventory-batches/[batchId]/lines/route';
import { POST as BATCH_APPROVE } from '@/app/api/v1/opening-inventory-batches/[batchId]/approval/route';
import { POST as ISSUE } from '@/app/api/v1/stock-issues/route';
import { POST as RETURN } from '@/app/api/v1/stock-returns/route';

let admin: Pool;
let codeSeq = 0;

const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown
): Promise<Response> =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify(body),
    })
  );

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const lineCall = (batchId: string, body: unknown): Promise<Response> =>
  LINE_CREATE(
    new Request(`http://localhost/api/v1/opening-inventory-batches/${batchId}/lines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ batchId }) }
  );

const approveCall = (batchId: string): Promise<Response> =>
  BATCH_APPROVE(
    new Request(`http://localhost/api/v1/opening-inventory-batches/${batchId}/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    }),
    { params: Promise.resolve({ batchId }) }
  );

const newBatch = async (branchId = BRANCH_A1, companyId = COMPANY_A1): Promise<string> => {
  const response = await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', {
    companyId,
    branchId,
    batchCode: `FX-OCU-${(codeSeq += 1)}-${Date.now() % 100000}`,
    asOfDate: '2026-07-01',
  });
  expect(response.status).toBe(201);
  return (await bodyOf<{ id: string }>(response)).id;
};

/** A counted, unapproved batch holding exactly one line. */
const draftCounting = async (
  itemId: string,
  locationId: string,
  quantity: string,
  branchId = BRANCH_A1
): Promise<string> => {
  authAs(INV_FULL);
  const batchId = await newBatch(branchId);
  expect((await lineCall(batchId, { itemId, locationId, quantity })).status).toBe(201);
  return batchId;
};

const statusOf = async (batchId: string): Promise<string> => {
  const row = await admin.query<{ status: string }>(
    `SELECT status FROM inv.opening_inventory_batches WHERE id = $1`,
    [batchId]
  );
  return row.rows[0]?.status ?? 'missing';
};

/** Movements of ONE kind in a cell — the ledger fact each case rests on. */
const movementsOfKind = (itemId: string, locationId: string, kind: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM inv.stock_movements
      WHERE item_id = $1 AND location_id = $2 AND movement_type = $3`,
    [itemId, locationId, kind]
  );

/**
 * An approved `in` adjustment, written the way the database requires.
 *
 * No write route publishes an adjustment yet, so this goes through
 * `inv.approve_adjustment` directly — the same function the eventual route will
 * call, with the same maker ≠ approver split. It is a fixture, not the subject:
 * what OC-5 asserts is the MOVEMENT the approval posts.
 */
const approveAdjustmentIn = async (
  itemId: string,
  locationId: string,
  quantity: string,
  reason: string
): Promise<void> => {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    const row = await client.query<{ id: string }>(
      `INSERT INTO inv.stock_adjustments
         (tenant_id, company_id, branch_id, item_id, location_id, direction, quantity,
          reason, requested_by, created_by)
       VALUES ($1,$2,$3,$4,$5,'in',$6::numeric,$7,$8,$8) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, itemId, locationId, quantity, reason, USER_A]
    );
    await client.query(`SELECT set_config('app.user_id',$1,true)`, [INV_APPROVER.userId]);
    await client.query(`SELECT inv.approve_adjustment($1)`, [row.rows[0]?.id ?? '']);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
}, 180_000);

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  await cleanP1_21Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('uq_stock_movements_opening_cell — the rule as the database holds it', () => {
  it('OC-0 keys on the whole cell identity and is partial on opening alone', async () => {
    const row = await admin.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'inv' AND tablename = 'stock_movements'
          AND indexname = 'uq_stock_movements_opening_cell'`
    );
    // Asserted as a whole definition rather than by substring: `tenant_id` and
    // `branch_id` being IN the key is what makes the isolation case below a
    // property of the index and not of the fixtures, and a partial predicate
    // naming only `opening` is what leaves every other movement kind alone.
    expect(row.rows[0]?.indexdef).toBe(
      'CREATE UNIQUE INDEX uq_stock_movements_opening_cell ON inv.stock_movements ' +
        'USING btree (tenant_id, company_id, branch_id, item_id, location_id) ' +
        "WHERE (movement_type = 'opening'::text)"
    );
  });
});

describe('inv.opening-batch-approve — one opening count per cell', () => {
  it('OC-1 approves the first batch and posts its opening movement', async () => {
    const cell = await freshLocation();
    const batchId = await draftCounting(ITEM_A, cell, '12.500');

    authAs(INV_APPROVER);
    const response = await approveCall(batchId);
    expect(response.status).toBe(200);
    expect((await bodyOf<{ status: string }>(response)).status).toBe('approved');

    // The stock exists BECAUSE a movement was posted, and there is exactly one.
    expect(await movementsOfKind(ITEM_A, cell, 'opening')).toBe(1);
    expect((await balanceOf(ITEM_A, cell))?.onHand).toBe('12.500');
  });

  it('OC-2 refuses a second batch counting the same cell, and says what to do', async () => {
    const cell = await freshLocation();
    // Both counted while both are drafts — which is exactly the reachable case:
    // nothing stops two counters opening a batch each for the same shelf, and the
    // per-batch unique index never sees the pair.
    const first = await draftCounting(ITEM_A, cell, '10.000');
    const second = await draftCounting(ITEM_A, cell, '4.000');

    authAs(INV_APPROVER);
    expect((await approveCall(first)).status).toBe(200);

    const refused = await approveCall(second);
    // The registered conflict answer, and the SAME code the duplicate cell inside
    // one batch already returns — one rule at two ranges. Never ERR-SYS-001: the
    // database enforced a rule, it did not break.
    expect(refused.status).toBe(409);
    const failure = await bodyOf<{ code: string; message: string }>(refused);
    expect(failure.code).toBe('ERR-RES-002');
    // The remedy is named, because the caller cannot deduce it: the ledger is
    // append-only, so nothing posted can be withdrawn.
    expect(failure.message).toMatch(/adjustment/i);

    // Nothing happened. The batch is still a draft — the violation rolled its own
    // approval UPDATE back with it — and the cell holds one count, not two.
    expect(await statusOf(second)).toBe('draft');
    expect(await movementsOfKind(ITEM_A, cell, 'opening')).toBe(1);
    expect((await balanceOf(ITEM_A, cell))?.onHand).toBe('10.000');
  });

  it('OC-3 still approves a second batch counting a DIFFERENT cell in the branch', async () => {
    // The refusal above must be about the CELL. If it were about the branch, or
    // about "a second opening batch", this would fail too — and a branch could
    // count its stock only once in its life.
    const opened = await freshLocation();
    const other = await freshLocation();
    // `draftCounting` authenticates as the COUNTER, so the approver is chosen after
    // the draft exists — never in the same expression, where the counter would win
    // and every approval below would be a maker-checker refusal instead.
    const sameCell = await draftCounting(ITEM_A, opened, '3.000');
    authAs(INV_APPROVER);
    expect((await approveCall(sameCell)).status).toBe(200);

    // A different LOCATION for the same item, and a different ITEM at the location
    // already opened: both halves of the cell key are exercised.
    const otherLocation = await draftCounting(ITEM_A, other, '5.000');
    authAs(INV_APPROVER);
    expect((await approveCall(otherLocation)).status).toBe(200);

    const otherItem = await draftCounting(ITEM_A_ALT, opened, '7.000');
    authAs(INV_APPROVER);
    expect((await approveCall(otherItem)).status).toBe(200);

    expect(await movementsOfKind(ITEM_A, opened, 'opening')).toBe(1);
    expect(await movementsOfKind(ITEM_A, other, 'opening')).toBe(1);
    expect(await movementsOfKind(ITEM_A_ALT, opened, 'opening')).toBe(1);
  });

  it('OC-4 leaves another branch and another tenant free to open the same item', async () => {
    // A1 opens ITEM_A. The index key carries `tenant_id`, `company_id` and
    // `branch_id` (OC-0), so neither of the two openings below may be refused.
    //
    // Literally the same `location_id` in two branches is unrepresentable, and
    // that is a schema fact rather than a gap in this case:
    // `fk_stock_movements_location` is
    // (tenant_id, company_id, branch_id, location_id) -> inv.stock_locations, so a
    // location row belongs to exactly one branch of one tenant. What "the same
    // item and location" can mean across a boundary is what is asserted here —
    // the same ITEM, at that branch's own warehouse.
    const a1Cell = await freshLocation();
    const inA1 = await draftCounting(ITEM_A, a1Cell, '2.000');
    authAs(INV_APPROVER);
    expect((await approveCall(inA1)).status).toBe(200);

    // Another BRANCH of the same company and tenant.
    const a2Cell = await freshLocation(BRANCH_A2);
    const inA2 = await draftCounting(ITEM_A, a2Cell, '6.000', BRANCH_A2);
    authAs(INV_APPROVER);
    expect((await approveCall(inA2)).status).toBe(200);
    expect(await movementsOfKind(ITEM_A, a2Cell, 'opening')).toBe(1);
    // And A1's count is untouched by A2's.
    expect((await balanceOf(ITEM_A, a1Cell))?.onHand).toBe('2.000');

    // Another TENANT. Seeded rather than driven through the routes because tenant B
    // carries one inventory principal and maker ≠ approver needs two; the assertion
    // is that the opening SUCCEEDS while tenant A holds openings of its own.
    await seedStock({
      itemId: ITEM_B,
      locationId: WAREHOUSE_B1,
      quantity: '8.000',
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
    });
    expect(await movementsOfKind(ITEM_B, WAREHOUSE_B1, 'opening')).toBe(1);
    expect((await balanceOf(ITEM_B, WAREHOUSE_B1))?.onHand).toBe('8.000');
  });

  it('OC-5 constrains no other movement kind in an already-opened cell', async () => {
    // The whole point of a PARTIAL index: a cell that has been opened must still
    // accept every correction and every ordinary movement, repeatedly. If it did
    // not, the remedy OC-2's message names would not exist.
    const cell = await freshLocation();
    const batchId = await draftCounting(ITEM_A, cell, '10.000');
    authAs(INV_APPROVER);
    expect((await approveCall(batchId)).status).toBe(200);

    // TWO adjustments into the same cell — the correction path, and it repeats.
    await approveAdjustmentIn(ITEM_A, cell, '1.500', 'recount correction');
    await approveAdjustmentIn(ITEM_A, cell, '2.500', 'second recount correction');
    expect(await movementsOfKind(ITEM_A, cell, 'adjustment')).toBe(2);
    expect((await balanceOf(ITEM_A, cell))?.onHand).toBe('14.000');

    // An issue OUT of the cell and a return back INTO it, through the shipped
    // routes: a second `in` movement lands in a cell that already holds an
    // `opening` `in`, which a total index would have refused.
    const wo = await createOpenWorkOrder();
    authAs(INV_FULL);
    const issued = await post(ISSUE, '/api/v1/stock-issues', {
      workOrderId: wo.workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity: '4.000',
    });
    expect(issued.status).toBe(201);

    authAs(INV_FULL);
    const returned = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: (await bodyOf<{ id: string }>(issued)).id,
      quantity: '4.000',
      reason: 'not required',
    });
    expect(returned.status).toBe(201);

    expect(await movementsOfKind(ITEM_A, cell, 'issue')).toBe(1);
    expect(await movementsOfKind(ITEM_A, cell, 'return')).toBe(1);
    // Still exactly one opening, and the balance is the ledger sum of all five.
    expect(await movementsOfKind(ITEM_A, cell, 'opening')).toBe(1);
    expect((await balanceOf(ITEM_A, cell))?.onHand).toBe('14.000');
  });
});
