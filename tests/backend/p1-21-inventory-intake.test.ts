/**
 * Inventory intake (Phase 1-21, P1-21-BE-002, BE-009, BE-010, P1-21-QA-002).
 *
 * Three ways a stock-or-adjacent fact enters the system, and the suite's job is to
 * prove they are NOT the same shape.
 *
 * Opening balances are the only path that mints stock, and they do it through an
 * approved batch: a `draft` batch is a counted intention, and
 * `ck_opening_inventory_batches_maker` forbids the counter from being the approver.
 *
 * Customer-supplied parts and external-purchase parts change **no** stock at all,
 * and the tests assert that on the LEDGER and the BALANCE rather than on the
 * response body. The failure being guarded against is a customer's alternator
 * appearing in the company's on-hand balance, or a purchase note raising stock
 * without anyone approving it — so "the movement count did not change" is the
 * assertion that matters, not "the endpoint returned 201".
 *
 * Operations exercised here: inv.opening-batch-create, inv.opening-batch-line-create,
 * inv.opening-batch-approve, inv.customer-supplied-part-create,
 * inv.external-purchase-part-create.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.opening-batch-create: route service authorization success denial audit idempotency isolation
 *   inv.opening-batch-line-create: route service authorization success denial cross-tenant isolation
 *   inv.opening-batch-approve: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.customer-supplied-part-create: route service authorization success denial audit idempotency isolation
 *   inv.external-purchase-part-create: route service authorization success denial audit idempotency isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  INV_NO_COST,
  INV_PERMISSION_ELSEWHERE,
  INV_READER,
  ITEM_A,
  ITEM_A_ALT,
  ITEM_A_ARCHIVED,
  QUARANTINE_A1,
  STORAGE_A1,
  WAREHOUSE_A1,
  WAREHOUSE_A2,
  auditCountFor,
  authAs,
  balanceOf,
  cleanP1_21Fixtures,
  countRowsOf,
  establishP1_21Fixtures,
  freshLocation,
} from './p1-21-helpers';
import { Quantity } from '@/modules/inventory';
import { POST as BATCH_CREATE } from '@/app/api/v1/opening-inventory-batches/route';
import { POST as LINE_CREATE } from '@/app/api/v1/opening-inventory-batches/[batchId]/lines/route';
import { POST as BATCH_APPROVE } from '@/app/api/v1/opening-inventory-batches/[batchId]/approval/route';
import { POST as CUSTOMER_PART } from '@/app/api/v1/customer-supplied-parts/route';
import { POST as EXTERNAL_PART } from '@/app/api/v1/external-purchase-parts/route';

let admin: Pool;
let codeSeq = 0;

const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  key = randomUUID()
): Promise<Response> =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const lineCall = (batchId: string, body: unknown): Promise<Response> =>
  LINE_CREATE(
    new Request(`http://localhost/api/v1/opening-inventory-batches/${batchId}/lines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ batchId }) }
  );

const approveCall = (batchId: string, key = randomUUID()): Promise<Response> =>
  BATCH_APPROVE(
    new Request(`http://localhost/api/v1/opening-inventory-batches/${batchId}/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
    }),
    { params: Promise.resolve({ batchId }) }
  );

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const newBatch = async (branchId = BRANCH_A1): Promise<string> => {
  const response = await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', {
    companyId: COMPANY_A1,
    branchId,
    batchCode: `FX-B-${(codeSeq += 1)}-${Date.now() % 100000}`,
    asOfDate: '2026-07-01',
  });
  expect(response.status).toBe(201);
  return (await bodyOf<{ id: string }>(response)).id;
};

const ledgerCount = (): Promise<number> =>
  countRowsOf(`SELECT count(*)::text AS n FROM inv.stock_movements WHERE tenant_id = $1`, [
    TENANT_A,
  ]);

/** Live lines on one batch, counted in the database rather than from a response. */
const lineCountOf = (batchId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM inv.opening_inventory_lines
      WHERE batch_id = $1 AND deleted_at IS NULL`,
    [batchId]
  );

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
}, 180_000);

afterAll(async () => {
  await cleanP1_21Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('inv.opening-batch-create', () => {
  it('creates a DRAFT batch counted by the caller, and mints no stock', async () => {
    authAs(INV_FULL);
    const before = await ledgerCount();
    const response = await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      batchCode: `FX-B-CREATE-${Date.now() % 100000}`,
      asOfDate: '2026-07-01',
    });
    expect(response.status).toBe(201);
    const batch = await bodyOf<{ id: string; status: string; countedBy: string }>(response);
    expect(batch.status).toBe('draft');
    // The counter is the authenticated caller, not a body field.
    expect(batch.countedBy).toBe(INV_FULL.userId);
    // A draft batch is an intention. Nothing has entered the ledger.
    expect(await ledgerCount()).toBe(before);
    expect(await auditCountFor('inv.opening_batch.created', batch.id)).toBe(1);
  });

  it('refuses a caller-supplied countedBy, which would defeat maker-checker (denial)', async () => {
    authAs(INV_FULL);
    const response = await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      batchCode: `FX-B-MAKER-${Date.now() % 100000}`,
      asOfDate: '2026-07-01',
      countedBy: INV_APPROVER.userId,
    });
    // `.strict()` refuses it: if a caller could name the counter, one person could
    // open a batch "counted by" a colleague and approve it themselves.
    expect(response.status).toBe(422);
  });

  it('refuses a malformed batch code and date (denial)', async () => {
    authAs(INV_FULL);
    expect(
      (
        await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          batchCode: 'not a code!',
          asOfDate: '2026-07-01',
        })
      ).status
    ).toBe(422);
    expect(
      (
        await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
          batchCode: `FX-B-D-${Date.now() % 100000}`,
          asOfDate: '2026-07-01T00:00:00Z',
        })
      ).status
    ).toBe(422);
  });

  it('replays an idempotency key instead of opening a second batch (idempotency)', async () => {
    authAs(INV_FULL);
    const key = randomUUID();
    const batchCode = `FX-B-IDEM-${Date.now() % 100000}`;
    const payload = {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      batchCode,
      asOfDate: '2026-07-01',
    };
    const first = await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', payload, key);
    expect(first.status).toBe(201);
    const firstBody = await bodyOf<{ id: string }>(first);

    const replay = await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', payload, key);
    expect([200, 201]).toContain(replay.status);
    expect((await bodyOf<{ id: string }>(replay)).id).toBe(firstBody.id);
    // One batch, not two — the idempotency record and the command committed together.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.opening_inventory_batches WHERE batch_code = $1`,
        [batchCode]
      )
    ).toBe(1);
    expect(await auditCountFor('inv.opening_batch.created', firstBody.id)).toBe(1);
  });

  it('answers 409 for a batch code already used in the branch, not 500 (denial)', async () => {
    // `uq_opening_inventory_batches_code` is partial on `deleted_at IS NULL` and
    // makes the code unique inside a branch. The violation used to be UNMAPPED, so
    // it left the service as a raw SQLSTATE 23505 and reached the caller as
    // ERR-SYS-001 — a 500 saying the request broke the server, with an
    // error-monitoring capture, for a rule the database enforced exactly as
    // designed. This case is what makes the mapping falsifiable.
    authAs(INV_FULL);
    const batchCode = `FX-B-DUP-${Date.now() % 100000}`;
    const payload = {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      batchCode,
      asOfDate: '2026-07-01',
    };
    expect((await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', payload)).status).toBe(
      201
    );

    // A DIFFERENT idempotency key, so this is a genuine second request and not a
    // replay: the refusal comes from the unique index, not from the replay store.
    const duplicate = await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', payload);
    expect(duplicate.status).toBe(409);
    const failure = await bodyOf<{
      code: string;
      violations?: readonly { path: string; rule: string }[];
    }>(duplicate);
    expect(failure.code).toBe('ERR-RES-002');
    expect(failure.violations).toEqual([{ path: 'body.batchCode', rule: 'duplicate_code' }]);

    // One row, so the refusal is a refusal and not a silently swallowed insert.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.opening_inventory_batches WHERE batch_code = $1`,
        [batchCode]
      )
    ).toBe(1);
  });

  it('refuses a caller lacking inv.stock.operate (authorization)', async () => {
    authAs(INV_READER);
    const response = await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      batchCode: `FX-B-AUTH-${Date.now() % 100000}`,
      asOfDate: '2026-07-01',
    });
    expect(response.status).toBe(403);
  });

  it('refuses a branch the caller is not scoped to (isolation)', async () => {
    authAs(INV_PERMISSION_ELSEWHERE);
    const response = await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      batchCode: `FX-B-ISO-${Date.now() % 100000}`,
      asOfDate: '2026-07-01',
    });
    expect(response.status).toBe(403);
    // The same caller succeeds in the branch it IS scoped to.
    const allowed = await post(BATCH_CREATE, '/api/v1/opening-inventory-batches', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A2,
      batchCode: `FX-B-ISO2-${Date.now() % 100000}`,
      asOfDate: '2026-07-01',
    });
    expect(allowed.status).toBe(201);
  });
});

describe('inv.opening-batch-line-create', () => {
  it('records a counted line without minting stock yet', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch();
    const before = await ledgerCount();
    const response = await lineCall(batchId, {
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '12.250',
    });
    expect(response.status).toBe(201);
    const line = await bodyOf<{ quantity: string }>(response);
    expect(line.quantity).toBe('12.250');
    // Still nothing in the ledger — approval is what posts movements.
    expect(await ledgerCount()).toBe(before);
  });

  it('answers 409 for a cell already counted, and only a different cell adds a line', async () => {
    /*
     * The record this replaces said a repeated request "adds a second line". It
     * does not. `uq_opening_inventory_lines_cell` allows ONE live line per
     * (item, location) inside a batch, so the counted cell is exactly-once at the
     * row level with no idempotency key involved — and a repeat is refused. Only a
     * genuinely DIFFERENT cell adds a line, which is a different count.
     *
     * Before the 23505 mapping this refusal surfaced as 500 ERR-SYS-001 with an
     * error-monitoring capture. Removing the mapping turns this case red on
     * exactly that, which is what makes the mapping load-bearing rather than
     * decorative.
     */
    authAs(INV_FULL);
    const batchId = await newBatch();
    const ledgerBefore = await ledgerCount();
    expect(
      (await lineCall(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '1.000' }))
        .status
    ).toBe(201);

    const repeat = await lineCall(batchId, {
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '2.000',
    });
    expect(repeat.status).toBe(409);
    const failure = await bodyOf<{
      code: string;
      violations?: readonly { path: string; rule: string }[];
    }>(repeat);
    expect(failure.code).toBe('ERR-RES-002');
    expect(failure.violations).toEqual([{ path: 'body.locationId', rule: 'duplicate_cell' }]);
    expect(await lineCountOf(batchId)).toBe(1);

    // The SAME item at a different location IS a different cell, and is counted.
    expect(
      (await lineCall(batchId, { itemId: ITEM_A, locationId: STORAGE_A1, quantity: '3.000' }))
        .status
    ).toBe(201);
    expect(await lineCountOf(batchId)).toBe(2);

    // Nothing reached the ledger either way: approval is what posts movements.
    expect(await ledgerCount()).toBe(ledgerBefore);
  });

  it('lets exactly one of two concurrent counts of one cell win', async () => {
    // The index is the arbiter, not a read-then-write check in the service, so the
    // race has one winner rather than two lines or a lost update.
    authAs(INV_FULL);
    const batchId = await newBatch();
    const both = await Promise.all([
      lineCall(batchId, { itemId: ITEM_A_ALT, locationId: WAREHOUSE_A1, quantity: '4.000' }),
      lineCall(batchId, { itemId: ITEM_A_ALT, locationId: WAREHOUSE_A1, quantity: '5.000' }),
    ]);
    expect(both.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await lineCountOf(batchId)).toBe(1);
  });

  it('refuses a line whose location is in a different branch from the batch', async () => {
    // inv.approve_opening_batch posts each movement from the LINE's location, so a
    // cross-branch line would mint stock in a branch the batch never authorized.
    authAs(INV_FULL);
    const batchId = await newBatch(BRANCH_A1);
    const response = await lineCall(batchId, {
      itemId: ITEM_A,
      locationId: WAREHOUSE_A2,
      quantity: '1.000',
    });
    expect(response.status).toBe(409);
  });

  it('refuses counting straight into a quarantine location (denial)', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch();
    const response = await lineCall(batchId, {
      itemId: ITEM_A,
      locationId: QUARANTINE_A1,
      quantity: '1.000',
    });
    expect(response.status).toBe(409);
  });

  it('refuses an archived item and a zero quantity (denial)', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch();
    expect(
      (
        await lineCall(batchId, {
          itemId: ITEM_A_ARCHIVED,
          locationId: WAREHOUSE_A1,
          quantity: '1.000',
        })
      ).status
    ).toBe(409);
    expect(
      (await lineCall(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '0' })).status
    ).toBe(422);
  });

  it('refuses an unknown batch (cross-tenant)', async () => {
    authAs(INV_FULL);
    const response = await lineCall(randomUUID(), {
      itemId: ITEM_A,
      locationId: WAREHOUSE_A1,
      quantity: '1.000',
    });
    expect(response.status).toBe(404);
  });

  it('refuses a caller lacking inv.stock.operate (authorization)', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch();
    authAs(INV_READER);
    expect(
      (await lineCall(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '1.000' }))
        .status
    ).toBe(403);
  });

  it('refuses a batch in a branch the caller is not scoped to (isolation)', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch(BRANCH_A1);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect(
      (await lineCall(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '1.000' }))
        .status
    ).toBe(403);
  });
});

describe('inv.opening-batch-approve', () => {
  it('mints stock only on approval, by a DIFFERENT actor', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch();
    await lineCall(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '7.500' });
    const balanceBefore = (await balanceOf(ITEM_A, WAREHOUSE_A1))?.onHand ?? '0.000';

    // The counter may not approve their own count.
    const selfApproval = await approveCall(batchId);
    expect(selfApproval.status).toBe(409);

    // A different actor can.
    authAs(INV_APPROVER);
    const response = await approveCall(batchId);
    expect(response.status).toBe(200);
    const approved = await bodyOf<{ status: string; approvedBy: string }>(response);
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe(INV_APPROVER.userId);

    // NOW the stock exists, and it exists because a movement was posted.
    // Exact decimal arithmetic rather than Number(): 7.5 is binary-exact, so a
    // float assertion would pass here and would also pass against an implementation
    // that truncated the third decimal.
    expect((await balanceOf(ITEM_A, WAREHOUSE_A1))!.onHand).toBe(
      Quantity.parse(balanceBefore).plus(Quantity.parse('7.500')).toString()
    );
    expect(await auditCountFor('inv.opening_batch.approved', batchId)).toBe(1);
  });

  it('refuses approving an EMPTY batch (denial)', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch();
    authAs(INV_APPROVER);
    // Approving nothing records an approval attesting to no count — worse than an
    // error, because it looks like evidence.
    expect((await approveCall(batchId)).status).toBe(409);
  });

  it('refuses a second approval, because the batch is no longer draft (denial)', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch();
    // A never-opened cell, so the refusal below is the batch's own status and not
    // `uq_stock_movements_opening_cell` catching a cell an earlier case opened. Both
    // answer 409 and the two rules are proved apart:
    // `p1-30-opening-count-uniqueness.test.ts` owns the cell rule.
    await lineCall(batchId, {
      itemId: ITEM_A,
      locationId: await freshLocation(),
      quantity: '1.000',
    });
    authAs(INV_APPROVER);
    expect((await approveCall(batchId)).status).toBe(200);
    expect((await approveCall(batchId)).status).toBe(409);
  });

  it('refuses adding a line to an approved batch (frozen)', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch();
    const cell = await freshLocation();
    await lineCall(batchId, { itemId: ITEM_A, locationId: cell, quantity: '1.000' });
    authAs(INV_APPROVER);
    await approveCall(batchId);
    authAs(INV_FULL);
    expect(
      (await lineCall(batchId, { itemId: ITEM_A, locationId: cell, quantity: '1.000' })).status
    ).toBe(409);
  });

  it('replays an idempotency key instead of posting the movements twice (idempotency)', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch();
    const cell = await freshLocation();
    await lineCall(batchId, { itemId: ITEM_A, locationId: cell, quantity: '3.000' });
    authAs(INV_APPROVER);
    const key = randomUUID();
    const first = await approveCall(batchId, key);
    expect(first.status).toBe(200);
    const afterFirst = (await balanceOf(ITEM_A, cell))!.onHand;

    const replay = await approveCall(batchId, key);
    // The replay returns the stored response instead of the 409 a fresh second
    // approval would get — that difference IS the idempotency guarantee.
    expect(replay.status).toBe(200);
    // And, decisively, the opening movements were posted once: a second posting
    // would have doubled the stock this batch minted.
    expect((await balanceOf(ITEM_A, cell))!.onHand).toBe(afterFirst);
    expect(await auditCountFor('inv.opening_batch.approved', batchId)).toBe(1);
  });

  it('refuses an unknown batch (cross-tenant)', async () => {
    authAs(INV_APPROVER);
    expect((await approveCall(randomUUID())).status).toBe(404);
  });

  it('refuses a caller holding operate but not approve (authorization)', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch();
    await lineCall(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '1.000' });
    // INV_READER holds neither; the pointed case is that approving needs a DIFFERENT
    // permission from counting, which is why the operation declares
    // inv.adjustment.approve rather than inv.stock.operate.
    authAs(INV_READER);
    expect((await approveCall(batchId)).status).toBe(403);
  });

  it('refuses approval in a branch the caller is not scoped to (isolation)', async () => {
    authAs(INV_FULL);
    const batchId = await newBatch(BRANCH_A1);
    await lineCall(batchId, { itemId: ITEM_A, locationId: WAREHOUSE_A1, quantity: '1.000' });
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await approveCall(batchId)).status).toBe(403);
  });
});

describe('inv.customer-supplied-part-create — custody, never stock', () => {
  it('records custody and changes NO balance and NO movement', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_FULL);
    const ledgerBefore = await ledgerCount();
    const balanceBefore = (await balanceOf(ITEM_A, WAREHOUSE_A1))?.onHand ?? null;

    const response = await post(CUSTOMER_PART, '/api/v1/customer-supplied-parts', {
      workOrderId: wo.workOrderId,
      description: 'Customer-supplied alternator',
      quantity: '1.000',
      itemRef: ITEM_A,
    });
    expect(response.status).toBe(201);
    const created = await bodyOf<{
      id: string;
      customerOwned: boolean;
      affectsStock: boolean;
      custodyState: string;
    }>(response);
    expect(created.customerOwned).toBe(true);
    expect(created.affectsStock).toBe(false);
    expect(created.custodyState).toBe('received');

    // THE assertion. A customer's part must never appear in company on-hand.
    expect(await ledgerCount()).toBe(ledgerBefore);
    expect((await balanceOf(ITEM_A, WAREHOUSE_A1))?.onHand ?? null).toBe(balanceBefore);
    expect(await auditCountFor('inv.customer_supplied_part.recorded', created.id)).toBe(1);
  });

  it('refuses an unknown work order and an unknown item reference (denial)', async () => {
    authAs(INV_FULL);
    expect(
      (
        await post(CUSTOMER_PART, '/api/v1/customer-supplied-parts', {
          workOrderId: randomUUID(),
          description: 'Part',
          quantity: '1.000',
        })
      ).status
    ).toBe(404);
    const wo = await createOpenWorkOrder();
    authAs(INV_FULL);
    expect(
      (
        await post(CUSTOMER_PART, '/api/v1/customer-supplied-parts', {
          workOrderId: wo.workOrderId,
          description: 'Part',
          quantity: '1.000',
          itemRef: randomUUID(),
        })
      ).status
    ).toBe(404);
  });

  it('refuses a caller-supplied ownership claim (denial)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_FULL);
    // `customerOwned` is not a settable field: ck_customer_supplied_parts_owned makes
    // company ownership unrepresentable, so offering the parameter would be a lie.
    const response = await post(CUSTOMER_PART, '/api/v1/customer-supplied-parts', {
      workOrderId: wo.workOrderId,
      description: 'Part',
      quantity: '1.000',
      customerOwned: false,
    });
    expect(response.status).toBe(422);
  });

  it('is idempotent under a replayed key (idempotency)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_FULL);
    const key = randomUUID();
    const payload = {
      workOrderId: wo.workOrderId,
      description: 'Customer-supplied filter',
      quantity: '2.000',
    };
    expect(
      (await post(CUSTOMER_PART, '/api/v1/customer-supplied-parts', payload, key)).status
    ).toBe(201);
    const replay = await post(CUSTOMER_PART, '/api/v1/customer-supplied-parts', payload, key);
    expect([200, 201]).toContain(replay.status);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.customer_supplied_parts WHERE work_order_id = $1`,
        [wo.workOrderId]
      )
    ).toBe(1);
  });

  it('refuses a caller lacking inv.custody.manage (authorization)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_READER);
    const response = await post(CUSTOMER_PART, '/api/v1/customer-supplied-parts', {
      workOrderId: wo.workOrderId,
      description: 'Part',
      quantity: '1.000',
    });
    expect(response.status).toBe(403);
  });

  it('refuses a work order in a branch the caller is not scoped to (isolation)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_PERMISSION_ELSEWHERE);
    const response = await post(CUSTOMER_PART, '/api/v1/customer-supplied-parts', {
      workOrderId: wo.workOrderId,
      description: 'Part',
      quantity: '1.000',
    });
    expect(response.status).toBe(403);
  });
});

describe('inv.external-purchase-part-create — a reference, not procurement', () => {
  it('records the purchase, adds no stock, and never echoes the cost', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_FULL);
    const ledgerBefore = await ledgerCount();

    const response = await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', {
      workOrderId: wo.workOrderId,
      description: 'Bearing bought from a local supplier',
      quantity: '2.000',
      supplierName: 'Local supplier',
      unitCost: { amount: '12.5000', currency: 'USD' },
    });
    expect(response.status).toBe(201);
    const created = await bodyOf<{
      id: string;
      isProcurement: boolean;
      affectsStock: boolean;
      costRecorded: boolean;
    }>(response);
    expect(created.isProcurement).toBe(false);
    expect(created.affectsStock).toBe(false);
    expect(created.costRecorded).toBe(true);
    // The amount is never in the response — costRecorded is a boolean.
    expect(JSON.stringify(created)).not.toContain('12.5000');
    // No stock appeared: a purchase note is not a goods receipt.
    expect(await ledgerCount()).toBe(ledgerBefore);
    expect(await auditCountFor('inv.external_purchase.recorded', created.id)).toBe(1);
  });

  it('refuses a purchase naming neither a supplier partner nor a supplier name', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_FULL);
    const response = await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', {
      workOrderId: wo.workOrderId,
      description: 'Bearing',
      quantity: '1.000',
    });
    // ck_external_purchase_parts_supplier, surfaced as a field-level refusal rather
    // than a constraint name.
    expect(response.status).toBe(422);
  });

  it('refuses a caller-supplied is_procurement claim (denial)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_FULL);
    const response = await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', {
      workOrderId: wo.workOrderId,
      description: 'Bearing',
      quantity: '1.000',
      supplierName: 'Supplier',
      isProcurement: true,
    });
    expect(response.status).toBe(422);
  });

  it('refuses the cost to a caller without inv.cost.view, rather than dropping it', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_NO_COST);
    const response = await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', {
      workOrderId: wo.workOrderId,
      description: 'Bearing',
      quantity: '1.000',
      supplierName: 'Supplier',
      unitCost: { amount: '10.0000', currency: 'USD' },
    });
    // Every RLS policy on the detail table is gated by inv.cost.view, so the write is
    // refused. Silently dropping the cost would be worse: the caller would believe a
    // figure had been recorded.
    expect([403, 409]).toContain(response.status);
    // And nothing partial survived — the whole transaction rolled back.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.external_purchase_parts WHERE work_order_id = $1`,
        [wo.workOrderId]
      )
    ).toBe(0);
  });

  it('records a purchase without a cost for a caller who has no cost authority', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_NO_COST);
    const response = await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', {
      workOrderId: wo.workOrderId,
      description: 'Bearing',
      quantity: '1.000',
      supplierName: 'Supplier',
    });
    // The refusal above is specific to the COST, not to the purchase record.
    expect(response.status).toBe(201);
    const created = await bodyOf<{ costRecorded: boolean }>(response);
    expect(created.costRecorded).toBe(false);
  });

  it('refuses a malformed unit cost and an unknown currency (denial)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_FULL);
    expect(
      (
        await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', {
          workOrderId: wo.workOrderId,
          description: 'Bearing',
          quantity: '1.000',
          supplierName: 'Supplier',
          unitCost: { amount: '10.00000', currency: 'USD' },
        })
      ).status
    ).toBe(422);
    expect(
      (
        await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', {
          workOrderId: wo.workOrderId,
          description: 'Bearing',
          quantity: '1.000',
          supplierName: 'Supplier',
          unitCost: { amount: '10.0000', currency: 'ZZZ' },
        })
      ).status
    ).toBe(404);
  });

  it('is idempotent under a replayed key (idempotency)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_FULL);
    const key = randomUUID();
    const payload = {
      workOrderId: wo.workOrderId,
      description: 'Bearing',
      quantity: '1.000',
      supplierName: 'Supplier',
    };
    expect(
      (await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', payload, key)).status
    ).toBe(201);
    const replay = await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', payload, key);
    expect([200, 201]).toContain(replay.status);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.external_purchase_parts WHERE work_order_id = $1`,
        [wo.workOrderId]
      )
    ).toBe(1);
  });

  it('refuses a caller lacking inv.external_purchase.record (authorization)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_READER);
    const response = await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', {
      workOrderId: wo.workOrderId,
      description: 'Bearing',
      quantity: '1.000',
      supplierName: 'Supplier',
    });
    expect(response.status).toBe(403);
  });

  it('refuses a work order in a branch the caller is not scoped to (isolation)', async () => {
    const wo = await createOpenWorkOrder();
    authAs(INV_PERMISSION_ELSEWHERE);
    const response = await post(EXTERNAL_PART, '/api/v1/external-purchase-parts', {
      workOrderId: wo.workOrderId,
      description: 'Bearing',
      quantity: '1.000',
      supplierName: 'Supplier',
    });
    expect(response.status).toBe(403);
  });
});

/**
 * H3 and the cross-tenant evidence repair.
 *
 * The three `cross-tenant` tokens in this file were previously backed by a
 * random-UUID 404 — an id that exists nowhere, which answers identically with RLS
 * disabled and therefore proves nothing about tenancy. They are now backed by a REAL
 * tenant-B batch, so the refusal is the tenant boundary.
 */
describe('opening approval publishes its movements, and tenancy is proved on real rows', () => {
  it('H3 — publishes one stock.movement.posted per counted line', async () => {
    // Approval is the ONLY way stock is created from nothing, so a consumer that
    // missed these events would have no opening balance at all and every later issue
    // would take its projection negative.
    authAs(INV_FULL);
    const batchId = await newBatch();
    // Two lines, one location, two items — and a location no batch has opened, so
    // the count under test is the EVENT count and not a cell collision.
    const cell = await freshLocation();
    await lineCall(batchId, { itemId: ITEM_A, locationId: cell, quantity: '2.000' });
    await lineCall(batchId, { itemId: ITEM_A_ALT, locationId: cell, quantity: '3.000' });
    authAs(INV_APPROVER);
    expect((await approveCall(batchId)).status).toBe(200);

    const published = await countRowsOf(
      `SELECT count(*)::text AS n FROM shared.event_outbox o
         JOIN inv.stock_movements m ON o.event_key = 'stock.movement.posted:' || m.id::text
         JOIN inv.opening_inventory_lines l ON l.id = m.reference_id
        WHERE m.reference_kind = 'opening_line' AND l.batch_id = $1`,
      [batchId]
    );
    expect(published).toBe(2);
  });

  it('refuses a REAL tenant-B batch, so the boundary is proved on a row that exists', async () => {
    // Seeded directly, because tenant B has no branch-scoped inventory fixtures and
    // the point is only that the row EXISTS and is unreachable from tenant A.
    const seeded = await admin.query<{ id: string }>(
      `INSERT INTO inv.opening_inventory_batches
         (tenant_id, company_id, branch_id, batch_code, as_of_date, counted_by, created_by)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$5) RETURNING id`,
      [TENANT_B, COMPANY_B1, BRANCH_B1, `FX-B-XT-${Date.now() % 100000}`, USER_A]
    );
    const tenantBBatch = seeded.rows[0]!.id;

    authAs(INV_FULL);
    // A real row, invisible across the tenant boundary — so it resolves as absent.
    expect(
      (
        await lineCall(tenantBBatch, {
          itemId: ITEM_A,
          locationId: WAREHOUSE_A1,
          quantity: '1.000',
        })
      ).status
    ).toBe(404);
    authAs(INV_APPROVER);
    expect((await approveCall(tenantBBatch)).status).toBe(404);

    // And it is genuinely still there — otherwise the 404s above would be vacuous.
    const stillThere = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM inv.opening_inventory_batches WHERE id = $1`,
      [tenantBBatch]
    );
    expect(Number(stillThere.rows[0]?.n)).toBe(1);
    await admin.query(`DELETE FROM inv.opening_inventory_batches WHERE id = $1`, [tenantBBatch]);
  });
});
