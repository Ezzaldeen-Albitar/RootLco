/**
 * P1-32 preparatory inventory slice — the eighteen operations, end to end through
 * their route handlers (P1-32-PRE-040…049).
 *
 * The assertions rest on the LEDGER and the BALANCE, not on the HTTP status: a 201
 * proves a row was written, and only on-hand quantities, movement rows, cost layers
 * and adjustment states prove the right one was. The five properties this suite
 * exists to hold:
 *
 *  - a dispatched transfer is in transit — gone from its source, absent from its
 *    destination, excluded from available stock, and reported as `inTransitQty`;
 *  - a transfer is received once, and a cross-branch receipt needs authority at
 *    BOTH ends;
 *  - posting a goods receipt appends cost history and NEVER rewrites an earlier
 *    layer; cost is accepted and readable only with `inv.cost.view`;
 *  - an adjustment moves nothing until someone other than its requester approves it;
 *  - reconciling a count raises pending adjustments and posts nothing, folding in
 *    the movements that happened while the shelf was being counted.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.stock-transfer-create: route service authorization success denial audit outbox idempotency isolation
 *   inv.stock-transfer-list: route service authorization success isolation
 *   inv.stock-transfer-receive: route service authorization success denial cross-tenant audit outbox idempotency isolation
 *   inv.stock-transfer-cancel: route service authorization success denial cross-tenant audit outbox idempotency isolation
 *   inv.goods-receipt-create: route service authorization success denial audit idempotency isolation
 *   inv.goods-receipt-list: route service authorization success isolation
 *   inv.goods-receipt-read: route service authorization success cross-tenant isolation
 *   inv.goods-receipt-post: route service authorization success denial cross-tenant stale-version audit outbox idempotency isolation
 *   inv.item-cost-history-read: route service authorization success denial cross-tenant isolation
 *   inv.stock-adjustment-create: route service authorization success denial audit idempotency isolation
 *   inv.stock-adjustment-list: route service authorization success isolation
 *   inv.stock-adjustment-approve: route service authorization success denial cross-tenant audit outbox idempotency isolation
 *   inv.stock-count-open: route service authorization success denial audit idempotency isolation
 *   inv.stock-count-list: route service authorization success isolation
 *   inv.stock-count-read: route service authorization success cross-tenant isolation
 *   inv.stock-count-line-record: route service authorization success denial cross-tenant stale-version audit idempotency isolation
 *   inv.stock-count-reconcile: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.stock-count-cancel: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.part-issue-list: route service authorization success denial cross-tenant isolation pagination
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { randomInt, randomUUID } from 'node:crypto';
import { Quantity } from '@/modules/inventory';
import {
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';
import { BRANCH_A2, FULL, createOpenWorkOrder, establishP1_19Fixtures } from './p1-19-helpers';
import {
  CATEGORY_A,
  INV_APPROVER,
  INV_COUNTER,
  INV_FULL,
  INV_NO_COST,
  INV_PERMISSION_ELSEWHERE,
  INV_READER,
  INV_READER_NAMED,
  INV_SCOPED_A2,
  INV_TENANT_B,
  ITEM_A,
  ITEM_A_ALT,
  ITEM_A_WILDCARD,
  QUARANTINE_A1,
  UOM_EACH,
  WAREHOUSE_A1,
  WAREHOUSE_A2,
  auditCountFor,
  authAs,
  balanceOf,
  cleanP1_21Fixtures,
  countRowsOf,
  establishP1_21Fixtures,
  freshLocation,
  seedApprovedMaterialRequirement,
  seedStock,
} from './p1-21-helpers';
import { GET as TRANSFER_LIST, POST as TRANSFER_CREATE } from '@/app/api/v1/stock-transfers/route';
import { POST as TRANSFER_RECEIVE } from '@/app/api/v1/stock-transfers/[transferId]/receipt/route';
import { POST as TRANSFER_CANCEL } from '@/app/api/v1/stock-transfers/[transferId]/cancellation/route';
import { GET as RECEIPT_LIST, POST as RECEIPT_CREATE } from '@/app/api/v1/goods-receipts/route';
import { GET as RECEIPT_READ } from '@/app/api/v1/goods-receipts/[receiptId]/route';
import { POST as RECEIPT_POST } from '@/app/api/v1/goods-receipts/[receiptId]/posting/route';
import { GET as COST_HISTORY } from '@/app/api/v1/items/[itemId]/cost-history/route';
import {
  GET as ADJUSTMENT_LIST,
  POST as ADJUSTMENT_CREATE,
} from '@/app/api/v1/stock-adjustments/route';
import { POST as ADJUSTMENT_DECIDE } from '@/app/api/v1/stock-adjustments/[adjustmentId]/approval/route';
import { GET as COUNT_LIST, POST as COUNT_OPEN } from '@/app/api/v1/stock-counts/route';
import { GET as COUNT_READ } from '@/app/api/v1/stock-counts/[countId]/route';
import { PUT as COUNT_LINE } from '@/app/api/v1/stock-counts/[countId]/lines/[itemId]/route';
import { POST as COUNT_RECONCILE } from '@/app/api/v1/stock-counts/[countId]/reconciliation/route';
import { POST as COUNT_CANCEL } from '@/app/api/v1/stock-counts/[countId]/cancellation/route';
import { GET as AVAILABILITY } from '@/app/api/v1/stock-availability/route';
import { POST as ISSUE } from '@/app/api/v1/stock-issues/route';
import { POST as RETURN } from '@/app/api/v1/stock-returns/route';
import { PART_ISSUE_LIST_OPERATION, GET as PART_ISSUE_LIST } from '@/app/api/v1/part-issues/route';
import { GET as WORK_ORDER_PART_ISSUES } from '@/app/api/v1/work-orders/[workOrderId]/part-issues/route';
import { POST as SALES_RETURN_CREATE } from '@/app/api/v1/sales-returns/route';
import { GET as RETURNABLE } from '@/app/api/v1/returnable-quantities/route';
import { GET as LIST_WORK_ORDERS } from '@/app/api/v1/work-orders/route';
import { primaryPool } from '@/server/db/pool';
import { withReadOnlyTransaction } from '@/server/db/transaction';
import { buildRequestContext } from '@/server/context/request-context';
import { __resetRateLimitForTests } from '@/server/http/rate-limit';

let admin: Pool;

type Handler = (request: Request) => Promise<Response>;
type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

const json = (
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Request =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const post = (handler: Handler, path: string, body: unknown, headers?: Record<string, string>) =>
  handler(json('POST', path, body, headers));

const postAt = <P>(
  handler: ParamHandler<P>,
  path: string,
  params: P,
  body: unknown,
  headers?: Record<string, string>
) => handler(json('POST', path, body, headers), { params: Promise.resolve(params) });

const putAt = <P>(
  handler: ParamHandler<P>,
  path: string,
  params: P,
  body: unknown,
  headers?: Record<string, string>
) => handler(json('PUT', path, body, headers), { params: Promise.resolve(params) });

const get = (handler: Handler, path: string) =>
  handler(new Request(`http://localhost${path}`, { method: 'GET' }));

const getAt = <P>(handler: ParamHandler<P>, path: string, params: P) =>
  handler(new Request(`http://localhost${path}`, { method: 'GET' }), {
    params: Promise.resolve(params),
  });

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/** Outbox rows describing every movement a business reference posted. */
const movementEventsFor = (referenceId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM shared.event_outbox o
       JOIN inv.stock_movements m ON o.event_key = 'stock.movement.posted:' || m.id::text
      WHERE m.reference_id = $1`,
    [referenceId]
  );

const onHandAt = async (itemId: string, locationId: string): Promise<string> =>
  (await balanceOf(itemId, locationId))?.onHand ?? '0.000';

interface TransferBody {
  id: string;
  status: string;
  inTransit: boolean;
  quantity: string;
  transitLocationId: string;
  replayed: boolean;
  recordVersion: number;
}

async function dispatch(
  body: Record<string, unknown>,
  principal = INV_FULL
): Promise<{ response: Response; transfer: TransferBody }> {
  authAs(principal);
  const response = await post(TRANSFER_CREATE, '/api/v1/stock-transfers', body);
  return { response, transfer: await bodyOf<TransferBody>(response.clone()) };
}

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

// ---------------------------------------------------------------------------
// Transfers.
// ---------------------------------------------------------------------------

describe('inv.stock-transfer-create', () => {
  it('dispatches into transit: gone from the source, not at the destination, reported as in transit', async () => {
    const from = await freshLocation();
    const to = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '10.000' });

    const { response, transfer } = await dispatch({
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: to,
      quantity: '4.250',
      reason: 'move to the front store',
    });
    expect(response.status).toBe(201);
    expect(transfer.status).toBe('dispatched');
    expect(transfer.inTransit).toBe(true);
    expect(transfer.replayed).toBe(false);

    expect(await onHandAt(ITEM_A, from)).toBe('5.750');
    expect(await onHandAt(ITEM_A, to)).toBe('0.000');
    // The transit movements this transfer posted: in by exactly its quantity.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.stock_movements
          WHERE reference_id = $1 AND location_id = $2 AND direction = 'in' AND quantity = 4.250`,
        [transfer.id, transfer.transitLocationId]
      )
    ).toBe(1);

    expect(await auditCountFor('inv.stock_transfer.dispatched', transfer.id)).toBe(1);
    // Both legs are published — out of the source and in to transit.
    expect(await movementEventsFor(transfer.id)).toBe(2);

    // Availability: the transit cell is never listed as a place to pick from, and
    // every cell of the item carries the in-transit quantity instead.
    authAs(INV_READER);
    const availability = await get(
      AVAILABILITY,
      `/api/v1/stock-availability?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&itemId=${ITEM_A}&limit=100`
    );
    expect(availability.status).toBe(200);
    const page = await bodyOf<{
      items: { locationId: string; locationType: string; inTransitQty: string }[];
    }>(availability);
    expect(page.items.some((row) => row.locationType === 'transit')).toBe(false);
    const source = page.items.find((row) => row.locationId === from);
    expect(source).toBeDefined();
    // At least this transfer's quantity is in transit for the item in the branch.
    expect(page.items.every((row) => row.inTransitQty === source?.inTransitQty)).toBe(true);
    const inTransit = await countRowsOf(
      `SELECT count(*)::text AS n FROM inv.stock_balances
        WHERE location_id = $1 AND item_id = $2 AND on_hand_qty = $3::numeric`,
      [transfer.transitLocationId, ITEM_A, source?.inTransitQty ?? '-1']
    );
    expect(inTransit).toBe(1);
  });

  it('replays an idempotency key instead of moving the stock twice (idempotency)', async () => {
    const from = await freshLocation();
    const to = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '5.000' });
    const payload = {
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: to,
      quantity: '1.000',
      idempotencyKey: `odinv-${randomUUID()}`,
    };
    const first = await dispatch(payload);
    expect(first.response.status).toBe(201);
    const replay = await dispatch(payload);
    expect(replay.response.status).toBe(200);
    expect(replay.transfer.id).toBe(first.transfer.id);
    expect(replay.transfer.replayed).toBe(true);
    expect(await onHandAt(ITEM_A, from)).toBe('4.000');
    expect(await auditCountFor('inv.stock_transfer.dispatched', first.transfer.id)).toBe(1);

    const conflicting = await dispatch({ ...payload, quantity: '2.000' });
    expect(conflicting.response.status).toBe(409);
  });

  it('refuses more than is available, a quarantine endpoint, and a malformed quantity (denial)', async () => {
    const from = await freshLocation();
    const to = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '1.000' });
    const tooMuch = await dispatch({
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: to,
      quantity: '1.001',
    });
    expect(tooMuch.response.status).toBe(409);
    expect(await onHandAt(ITEM_A, from)).toBe('1.000');

    const zero = await dispatch({
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: to,
      quantity: '0',
    });
    expect(zero.response.status).toBe(422);

    const same = await dispatch({
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: from,
      quantity: '0.500',
    });
    expect(same.response.status).toBe(409);
  });

  it('refuses a caller without inv.stock.operate (authorization)', async () => {
    const from = await freshLocation();
    const to = await freshLocation();
    const refused = await dispatch(
      { itemId: ITEM_A, fromLocationId: from, toLocationId: to, quantity: '1.000' },
      INV_READER
    );
    expect(refused.response.status).toBe(403);
  });

  it('refuses a caller whose authority is in another branch, although RLS admits the row (isolation)', async () => {
    const from = await freshLocation();
    const to = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '2.000' });
    const refused = await dispatch(
      { itemId: ITEM_A, fromLocationId: from, toLocationId: to, quantity: '1.000' },
      INV_PERMISSION_ELSEWHERE
    );
    expect(refused.response.status).toBe(403);
    expect(await onHandAt(ITEM_A, from)).toBe('2.000');
  });
});

describe('inv.stock-transfer-receive', () => {
  it('receives in full: out of transit and into the destination, once (success, outbox, audit)', async () => {
    const from = await freshLocation();
    const to = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '6.000' });
    const { transfer } = await dispatch({
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: to,
      quantity: '2.500',
    });

    const transitBefore = await onHandAt(ITEM_A, transfer.transitLocationId);
    authAs(INV_FULL);
    const path = `/api/v1/stock-transfers/${transfer.id}/receipt`;
    const received = await postAt(
      TRANSFER_RECEIVE,
      path,
      { transferId: transfer.id },
      {
        quantity: '2.500',
      }
    );
    expect(received.status).toBe(200);
    const body = await bodyOf<TransferBody>(received);
    expect(body.status).toBe('received');
    expect(body.inTransit).toBe(false);
    expect(await onHandAt(ITEM_A, to)).toBe('2.500');
    expect(await onHandAt(ITEM_A, transfer.transitLocationId)).toBe(
      Quantity.parse(transitBefore).minus(Quantity.parse('2.500')).toString()
    );
    expect(await auditCountFor('inv.stock_transfer.received', transfer.id)).toBe(1);
    // Dispatch pair plus settlement pair.
    expect(await movementEventsFor(transfer.id)).toBe(4);

    // A second receipt is refused rather than posting stock twice (denial).
    const again = await postAt(
      TRANSFER_RECEIVE,
      path,
      { transferId: transfer.id },
      {
        quantity: '2.500',
      }
    );
    expect(again.status).toBe(409);
    expect(await onHandAt(ITEM_A, to)).toBe('2.500');
  });

  it('refuses a receipt beyond what is in transit (denial) and replays a retried receipt by its key (idempotency)', async () => {
    const from = await freshLocation();
    const to = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '3.000' });
    const { transfer } = await dispatch({
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: to,
      quantity: '3.000',
    });
    authAs(INV_FULL);
    const path = `/api/v1/stock-transfers/${transfer.id}/receipt`;
    // More than was dispatched: nothing that did not travel can be received.
    const beyond = await postAt(
      TRANSFER_RECEIVE,
      path,
      { transferId: transfer.id },
      {
        quantity: '4.000',
      }
    );
    expect(beyond.status).toBe(409);
    expect(await onHandAt(ITEM_A, to)).toBe('0.000');

    const key = randomUUID();
    const first = await postAt(
      TRANSFER_RECEIVE,
      path,
      { transferId: transfer.id },
      { quantity: '3.000' },
      { 'idempotency-key': key }
    );
    expect(first.status).toBe(200);
    const replay = await postAt(
      TRANSFER_RECEIVE,
      path,
      { transferId: transfer.id },
      { quantity: '3.000' },
      { 'idempotency-key': key }
    );
    expect(replay.status).toBe(200);
    expect(await onHandAt(ITEM_A, to)).toBe('3.000');
    expect(await auditCountFor('inv.stock_transfer.received', transfer.id)).toBe(1);
  });

  it('needs authority at BOTH ends of a cross-branch transfer (authorization, isolation)', async () => {
    const from = await freshLocation(BRANCH_A1);
    const to = await freshLocation(BRANCH_A2);
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '2.000' });
    const { transfer } = await dispatch({
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: to,
      quantity: '1.000',
    });
    const path = `/api/v1/stock-transfers/${transfer.id}/receipt`;

    // The destination branch can SEE what is coming to it...
    authAs(INV_SCOPED_A2);
    const inbound = await get(
      TRANSFER_LIST,
      `/api/v1/stock-transfers?companyId=${COMPANY_A1}&branchId=${BRANCH_A2}&direction=inbound`
    );
    expect(inbound.status).toBe(200);
    const listed = await bodyOf<{ items: { id: string }[] }>(inbound);
    expect(listed.items.map((row) => row.id)).toContain(transfer.id);

    // ...but receiving settles the source branch's transit too, so a caller with no
    // authority there is refused.
    const refused = await postAt(
      TRANSFER_RECEIVE,
      path,
      { transferId: transfer.id },
      {
        quantity: '1.000',
      }
    );
    expect(refused.status).toBe(403);

    authAs(INV_READER);
    const reader = await postAt(
      TRANSFER_RECEIVE,
      path,
      { transferId: transfer.id },
      {
        quantity: '1.000',
      }
    );
    expect(reader.status).toBe(403);

    authAs(INV_FULL);
    const received = await postAt(
      TRANSFER_RECEIVE,
      path,
      { transferId: transfer.id },
      {
        quantity: '1.000',
      }
    );
    expect(received.status).toBe(200);
    expect(await onHandAt(ITEM_A, to)).toBe('1.000');
  });

  it('answers not found to another tenant (cross-tenant)', async () => {
    const from = await freshLocation();
    const to = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '1.000' });
    const { transfer } = await dispatch({
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: to,
      quantity: '1.000',
    });
    authAs(INV_TENANT_B);
    const foreign = await postAt(
      TRANSFER_RECEIVE,
      `/api/v1/stock-transfers/${transfer.id}/receipt`,
      { transferId: transfer.id },
      { quantity: '1.000' }
    );
    expect(foreign.status).toBe(404);
    expect(await onHandAt(ITEM_A, to)).toBe('0.000');
  });
});

describe('inv.stock-transfer-cancel', () => {
  it('returns the quantity from transit to the origin and refuses a second cancellation', async () => {
    const from = await freshLocation();
    const to = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: from, quantity: '4.000' });
    const { transfer } = await dispatch({
      itemId: ITEM_A,
      fromLocationId: from,
      toLocationId: to,
      quantity: '1.500',
    });
    const path = `/api/v1/stock-transfers/${transfer.id}/cancellation`;
    const transitBefore = await onHandAt(ITEM_A, transfer.transitLocationId);

    authAs(INV_READER);
    const reader = await postAt(
      TRANSFER_CANCEL,
      path,
      { transferId: transfer.id },
      {
        reason: 'wrong part',
      }
    );
    expect(reader.status).toBe(403);

    authAs(INV_PERMISSION_ELSEWHERE);
    const elsewhere = await postAt(
      TRANSFER_CANCEL,
      path,
      { transferId: transfer.id },
      {
        reason: 'wrong part',
      }
    );
    expect(elsewhere.status).toBe(403);

    authAs(INV_TENANT_B);
    const foreign = await postAt(
      TRANSFER_CANCEL,
      path,
      { transferId: transfer.id },
      {
        reason: 'wrong part',
      }
    );
    expect(foreign.status).toBe(404);

    authAs(INV_FULL);
    const key = randomUUID();
    const cancelled = await postAt(
      TRANSFER_CANCEL,
      path,
      { transferId: transfer.id },
      { reason: 'wrong part' },
      { 'idempotency-key': key }
    );
    expect(cancelled.status).toBe(200);
    expect((await bodyOf<TransferBody>(cancelled)).status).toBe('cancelled');
    expect(await onHandAt(ITEM_A, from)).toBe('4.000');
    expect(await onHandAt(ITEM_A, transfer.transitLocationId)).toBe(
      Quantity.parse(transitBefore).minus(Quantity.parse('1.500')).toString()
    );
    expect(await onHandAt(ITEM_A, to)).toBe('0.000');
    expect(await auditCountFor('inv.stock_transfer.cancelled', transfer.id)).toBe(1);
    expect(await movementEventsFor(transfer.id)).toBe(4);

    const replay = await postAt(
      TRANSFER_CANCEL,
      path,
      { transferId: transfer.id },
      { reason: 'wrong part' },
      { 'idempotency-key': key }
    );
    expect(replay.status).toBe(200);
    const again = await postAt(
      TRANSFER_CANCEL,
      path,
      { transferId: transfer.id },
      {
        reason: 'again',
      }
    );
    expect(again.status).toBe(409);
    expect(await auditCountFor('inv.stock_transfer.cancelled', transfer.id)).toBe(1);
  });
});

describe('inv.stock-transfer-list', () => {
  it('lists outbound transfers for an authorized branch and refuses the rest', async () => {
    const from = await freshLocation();
    const to = await freshLocation();
    await seedStock({ itemId: ITEM_A_ALT, locationId: from, quantity: '2.000' });
    const { transfer } = await dispatch({
      itemId: ITEM_A_ALT,
      fromLocationId: from,
      toLocationId: to,
      quantity: '1.000',
    });
    const path = `/api/v1/stock-transfers?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&status=dispatched&itemId=${ITEM_A_ALT}`;

    authAs(INV_READER);
    const listed = await get(TRANSFER_LIST, path);
    expect(listed.status).toBe(200);
    const page = await bodyOf<{ items: { id: string; sku: string; inTransit: boolean }[] }>(listed);
    const row = page.items.find((item) => item.id === transfer.id);
    expect(row?.inTransit).toBe(true);
    expect(row?.sku).toBeTruthy();

    authAs(FULL);
    expect((await get(TRANSFER_LIST, path)).status).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await get(TRANSFER_LIST, path)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Goods receipts and cost history.
// ---------------------------------------------------------------------------

interface ReceiptBody {
  id: string;
  status: string;
  recordVersion: number;
  replayed: boolean;
  lines: { lineNo: number; quantity: string; hasUnitCost: boolean }[];
}

async function createReceipt(
  lines: Record<string, unknown>[],
  principal = INV_FULL,
  extra: Record<string, unknown> = {}
): Promise<{ response: Response; receipt: ReceiptBody }> {
  authAs(principal);
  const response = await post(RECEIPT_CREATE, '/api/v1/goods-receipts', {
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    receivedOn: '2026-09-15',
    supplierReference: 'delivery note 4471',
    lines,
    ...extra,
  });
  return { response, receipt: await bodyOf<ReceiptBody>(response.clone()) };
}

const postReceipt = (receiptId: string, version: number, headers: Record<string, string> = {}) =>
  postAt(RECEIPT_POST, `/api/v1/goods-receipts/${receiptId}/posting`, { receiptId }, undefined, {
    'if-match': String(version),
    ...headers,
  });

describe('inv.goods-receipt-create', () => {
  it('creates a draft with its lines and moves nothing until it is posted', async () => {
    const location = await freshLocation();
    const { response, receipt } = await createReceipt([
      { itemId: ITEM_A, locationId: location, quantity: '5.000' },
    ]);
    expect(response.status).toBe(201);
    expect(receipt.status).toBe('draft');
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0]?.hasUnitCost).toBe(false);
    expect(await onHandAt(ITEM_A, location)).toBe('0.000');
    expect(await auditCountFor('inv.goods_receipt.created', receipt.id)).toBe(1);
  });

  it('replays its body key (idempotency) and refuses cost from a caller who may not view cost (denial)', async () => {
    const location = await freshLocation();
    const key = `odinv-${randomUUID()}`;
    const lines = [{ itemId: ITEM_A, locationId: location, quantity: '1.000' }];
    const first = await createReceipt(lines, INV_FULL, { idempotencyKey: key });
    expect(first.response.status).toBe(201);
    const replay = await createReceipt(lines, INV_FULL, { idempotencyKey: key });
    expect(replay.response.status).toBe(200);
    expect(replay.receipt.id).toBe(first.receipt.id);
    expect(replay.receipt.replayed).toBe(true);

    const priced = await createReceipt(
      [
        {
          itemId: ITEM_A,
          locationId: location,
          quantity: '1.000',
          unitCost: '9.5000',
          currencyCode: 'USD',
        },
      ],
      INV_NO_COST
    );
    expect(priced.response.status).toBe(422);
    const unpriced = await createReceipt(
      [{ itemId: ITEM_A, locationId: location, quantity: '1.000' }],
      INV_NO_COST
    );
    expect(unpriced.response.status).toBe(201);

    const floating = await createReceipt([
      { itemId: ITEM_A, locationId: location, quantity: 1 as unknown as string },
    ]);
    expect(floating.response.status).toBe(422);
  });

  it('refuses a reader (authorization) and a branch the caller holds no authority in (isolation)', async () => {
    const location = await freshLocation();
    const lines = [{ itemId: ITEM_A, locationId: location, quantity: '1.000' }];
    expect((await createReceipt(lines, INV_READER)).response.status).toBe(403);
    expect((await createReceipt(lines, INV_PERMISSION_ELSEWHERE)).response.status).toBe(403);
  });
});

describe('inv.goods-receipt-post', () => {
  it('adds stock, appends cost history, and never rewrites an earlier layer', async () => {
    const location = await freshLocation();
    const first = await createReceipt([
      {
        itemId: ITEM_A,
        locationId: location,
        quantity: '2.000',
        unitCost: '10.0000',
        currencyCode: 'USD',
      },
    ]);
    authAs(INV_FULL);
    const postedFirst = await postReceipt(first.receipt.id, first.receipt.recordVersion);
    expect(postedFirst.status).toBe(200);
    expect((await bodyOf<ReceiptBody>(postedFirst)).status).toBe('posted');
    expect(await onHandAt(ITEM_A, location)).toBe('2.000');
    expect(await auditCountFor('inv.goods_receipt.posted', first.receipt.id)).toBe(1);

    const layerBefore = await admin.query<{ id: string; unit_cost: string }>(
      `SELECT l.id, l.unit_cost::text FROM inv.item_cost_layers l
         JOIN inv.goods_receipt_lines g ON g.id = l.source_id
        WHERE g.receipt_id = $1`,
      [first.receipt.id]
    );
    expect(layerBefore.rows).toHaveLength(1);
    expect(layerBefore.rows[0]?.unit_cost).toBe('10.0000');
    const lineId = await admin.query<{ id: string }>(
      `SELECT id FROM inv.goods_receipt_lines WHERE receipt_id = $1`,
      [first.receipt.id]
    );
    expect(await movementEventsFor(lineId.rows[0]?.id ?? '')).toBe(1);

    const second = await createReceipt([
      {
        itemId: ITEM_A,
        locationId: location,
        quantity: '1.000',
        unitCost: '13.0000',
        currencyCode: 'USD',
      },
    ]);
    authAs(INV_FULL);
    expect((await postReceipt(second.receipt.id, second.receipt.recordVersion)).status).toBe(200);

    // The earlier layer is exactly as it was: same row, same figure.
    const layerAfter = await admin.query<{ unit_cost: string }>(
      `SELECT unit_cost::text FROM inv.item_cost_layers WHERE id = $1`,
      [layerBefore.rows[0]?.id]
    );
    expect(layerAfter.rows[0]?.unit_cost).toBe('10.0000');
    // And no standard cost was written anywhere.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.item_cost_details WHERE item_id = $1`,
        [ITEM_A]
      )
    ).toBe(0);
  });

  it('refuses a stale If-Match, a second posting, and a priced posting without cost authority', async () => {
    const location = await freshLocation();
    const { receipt } = await createReceipt([
      { itemId: ITEM_A, locationId: location, quantity: '1.000' },
    ]);
    authAs(INV_FULL);
    const stale = await postReceipt(receipt.id, receipt.recordVersion + 7);
    expect(stale.status).toBe(409);
    expect(await onHandAt(ITEM_A, location)).toBe('0.000');

    const key = randomUUID();
    const posted = await postReceipt(receipt.id, receipt.recordVersion, { 'idempotency-key': key });
    expect(posted.status).toBe(200);
    const replay = await postReceipt(receipt.id, receipt.recordVersion, { 'idempotency-key': key });
    expect(replay.status).toBe(200);
    expect(await onHandAt(ITEM_A, location)).toBe('1.000');
    const version = (await bodyOf<ReceiptBody>(posted)).recordVersion;
    expect((await postReceipt(receipt.id, version)).status).toBe(409);
    expect(await onHandAt(ITEM_A, location)).toBe('1.000');

    const priced = await createReceipt([
      {
        itemId: ITEM_A,
        locationId: location,
        quantity: '1.000',
        unitCost: '1.0000',
        currencyCode: 'USD',
      },
    ]);
    authAs(INV_NO_COST);
    expect((await postReceipt(priced.receipt.id, priced.receipt.recordVersion)).status).toBe(403);
    expect(await onHandAt(ITEM_A, location)).toBe('1.000');
  });

  it('refuses a reader, another branch, and another tenant', async () => {
    const location = await freshLocation();
    const { receipt } = await createReceipt([
      { itemId: ITEM_A, locationId: location, quantity: '1.000' },
    ]);
    authAs(INV_READER);
    expect((await postReceipt(receipt.id, receipt.recordVersion)).status).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await postReceipt(receipt.id, receipt.recordVersion)).status).toBe(403);
    authAs(INV_TENANT_B);
    expect((await postReceipt(receipt.id, receipt.recordVersion)).status).toBe(404);
    expect(await onHandAt(ITEM_A, location)).toBe('0.000');
  });
});

describe('inv.goods-receipt-read and inv.goods-receipt-list', () => {
  it('reads a receipt without its unit costs and lists it for the branch', async () => {
    const location = await freshLocation();
    const { receipt } = await createReceipt([
      {
        itemId: ITEM_A,
        locationId: location,
        quantity: '1.000',
        unitCost: '4.2000',
        currencyCode: 'USD',
      },
    ]);
    authAs(INV_READER);
    const read = await getAt(RECEIPT_READ, `/api/v1/goods-receipts/${receipt.id}`, {
      receiptId: receipt.id,
    });
    expect(read.status).toBe(200);
    const text = await read.text();
    expect(text).not.toContain('4.2000');
    expect(text).not.toContain('unitCost');
    expect(JSON.parse(text).lines[0].hasUnitCost).toBe(true);

    const listPath = `/api/v1/goods-receipts?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&status=draft`;
    const listed = await get(RECEIPT_LIST, listPath);
    expect(listed.status).toBe(200);
    const page = await bodyOf<{ items: { id: string }[] }>(listed);
    expect(page.items.map((row) => row.id)).toContain(receipt.id);

    authAs(FULL);
    expect(
      (await getAt(RECEIPT_READ, `/api/v1/goods-receipts/${receipt.id}`, { receiptId: receipt.id }))
        .status
    ).toBe(403);
    expect((await get(RECEIPT_LIST, listPath)).status).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect(
      (await getAt(RECEIPT_READ, `/api/v1/goods-receipts/${receipt.id}`, { receiptId: receipt.id }))
        .status
    ).toBe(403);
    expect((await get(RECEIPT_LIST, listPath)).status).toBe(403);
    authAs(INV_TENANT_B);
    expect(
      (await getAt(RECEIPT_READ, `/api/v1/goods-receipts/${receipt.id}`, { receiptId: receipt.id }))
        .status
    ).toBe(404);
  });
});

describe('inv.item-cost-history-read', () => {
  it('derives the latest and weighted-average cost from appended layers, only for cost viewers', async () => {
    const location = await freshLocation();
    for (const [quantity, unitCost] of [
      ['2.000', '10.0000'],
      ['1.000', '13.0000'],
    ] as const) {
      const { receipt } = await createReceipt([
        { itemId: ITEM_A_ALT, locationId: location, quantity, unitCost, currencyCode: 'USD' },
      ]);
      authAs(INV_FULL);
      expect((await postReceipt(receipt.id, receipt.recordVersion)).status).toBe(200);
    }
    const path = `/api/v1/items/${ITEM_A_ALT}/cost-history?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;
    authAs(INV_FULL);
    const history = await getAt(COST_HISTORY, path, { itemId: ITEM_A_ALT });
    expect(history.status).toBe(200);
    const body = await bodyOf<{
      latestUnitCost: string | null;
      weightedAverageCost: string | null;
      mixedCurrencies: boolean;
      layerCount: number;
      layers: { items: { unitCost: string }[] };
    }>(history);
    expect(body.layerCount).toBeGreaterThanOrEqual(2);
    expect(body.latestUnitCost).toBe('13.0000');
    expect(body.mixedCurrencies).toBe(false);
    // Every layer this item has in the branch, re-derived from the table itself, so
    // the assertion does not depend on how many layers other cases appended.
    const expected = await admin.query<{ avg: string }>(
      `SELECT round(SUM(quantity * unit_cost) / SUM(quantity), 4)::numeric(18,4)::text AS avg
         FROM inv.item_cost_layers WHERE item_id = $1 AND branch_id = $2`,
      [ITEM_A_ALT, BRANCH_A1]
    );
    expect(body.weightedAverageCost).toBe(expected.rows[0]?.avg);
    expect(body.layers.items.map((layer) => layer.unitCost)).toContain('10.0000');

    // Without inv.cost.view the operation itself refuses (authorization, denial).
    authAs(INV_NO_COST);
    expect((await getAt(COST_HISTORY, path, { itemId: ITEM_A_ALT })).status).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await getAt(COST_HISTORY, path, { itemId: ITEM_A_ALT })).status).toBe(403);
    // Another tenant cannot resolve the item at all (cross-tenant).
    authAs(INV_TENANT_B);
    const foreign = await getAt(COST_HISTORY, path, { itemId: ITEM_A_ALT });
    expect([403, 404]).toContain(foreign.status);
  });
});

// ---------------------------------------------------------------------------
// Adjustments.
// ---------------------------------------------------------------------------

interface AdjustmentBody {
  id: string;
  status: string;
  requestedBy: string;
  recordVersion: number;
}

async function requestAdjustment(
  body: Record<string, unknown>,
  principal = INV_FULL
): Promise<{ response: Response; adjustment: AdjustmentBody }> {
  authAs(principal);
  const response = await post(ADJUSTMENT_CREATE, '/api/v1/stock-adjustments', {
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
    itemId: ITEM_A,
    direction: 'in',
    quantity: '1.000',
    reason: 'found during tidy-up',
    ...body,
  });
  return { response, adjustment: await bodyOf<AdjustmentBody>(response.clone()) };
}

const decide = (adjustmentId: string, decision: string, headers: Record<string, string> = {}) =>
  postAt(
    ADJUSTMENT_DECIDE,
    `/api/v1/stock-adjustments/${adjustmentId}/approval`,
    { adjustmentId },
    { decision, reason: 'checked on the shelf' },
    headers
  );

describe('inv.stock-adjustment-create', () => {
  it('requests a pending adjustment that moves nothing, with a restricted value impact only for cost viewers', async () => {
    const location = await freshLocation();
    const { response, adjustment } = await requestAdjustment({
      locationId: location,
      valueImpact: '12.5000',
      currencyCode: 'USD',
    });
    expect(response.status).toBe(201);
    expect(adjustment.status).toBe('pending');
    expect(await onHandAt(ITEM_A, location)).toBe('0.000');
    expect(await auditCountFor('inv.stock_adjustment.requested', adjustment.id)).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.stock_adjustment_details WHERE adjustment_id = $1`,
        [adjustment.id]
      )
    ).toBe(1);

    const noCost = await requestAdjustment(
      { locationId: location, valueImpact: '1.0000', currencyCode: 'USD' },
      INV_NO_COST
    );
    expect(noCost.response.status).toBe(422);

    // The header key replays the stored response instead of requesting twice.
    const key = randomUUID();
    authAs(INV_FULL);
    const once = await post(
      ADJUSTMENT_CREATE,
      '/api/v1/stock-adjustments',
      {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        itemId: ITEM_A,
        locationId: location,
        direction: 'out',
        quantity: '0.500',
        reason: 'broken seal',
      },
      { 'idempotency-key': key }
    );
    expect(once.status).toBe(201);
    const twice = await post(
      ADJUSTMENT_CREATE,
      '/api/v1/stock-adjustments',
      {
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        itemId: ITEM_A,
        locationId: location,
        direction: 'out',
        quantity: '0.500',
        reason: 'broken seal',
      },
      { 'idempotency-key': key }
    );
    expect(twice.status).toBe(200);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.stock_adjustments WHERE location_id = $1 AND direction = 'out'`,
        [location]
      )
    ).toBe(1);
  });

  it('refuses a reader, a location outside the named branch, and a branch without authority', async () => {
    const location = await freshLocation();
    const other = await freshLocation(BRANCH_A2);
    expect((await requestAdjustment({ locationId: location }, INV_READER)).response.status).toBe(
      403
    );
    expect((await requestAdjustment({ locationId: other })).response.status).toBe(422);
    expect(
      (await requestAdjustment({ locationId: location }, INV_PERMISSION_ELSEWHERE)).response.status
    ).toBe(403);
  });
});

describe('inv.stock-adjustment-approve', () => {
  it('posts only on approval by someone other than the requester, and a rejection moves nothing', async () => {
    const location = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: location, quantity: '5.000' });
    const { adjustment } = await requestAdjustment({
      locationId: location,
      direction: 'out',
      quantity: '2.000',
    });

    // The requester may not decide it.
    authAs(INV_FULL);
    const self = await decide(adjustment.id, 'approved');
    expect(self.status).toBe(409);
    expect(await onHandAt(ITEM_A, location)).toBe('5.000');

    authAs(INV_READER);
    expect((await decide(adjustment.id, 'approved')).status).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await decide(adjustment.id, 'approved')).status).toBe(403);
    authAs(INV_TENANT_B);
    expect((await decide(adjustment.id, 'approved')).status).toBe(404);

    authAs(INV_APPROVER);
    const key = randomUUID();
    const approved = await decide(adjustment.id, 'approved', { 'idempotency-key': key });
    expect(approved.status).toBe(200);
    expect((await bodyOf<AdjustmentBody>(approved)).status).toBe('approved');
    expect(await onHandAt(ITEM_A, location)).toBe('3.000');
    expect(await auditCountFor('inv.stock_adjustment.approved', adjustment.id)).toBe(1);
    expect(await movementEventsFor(adjustment.id)).toBe(1);
    const replay = await decide(adjustment.id, 'approved', { 'idempotency-key': key });
    expect(replay.status).toBe(200);
    expect(await onHandAt(ITEM_A, location)).toBe('3.000');
    expect((await decide(adjustment.id, 'rejected')).status).toBe(409);

    const rejectable = await requestAdjustment({ locationId: location, quantity: '9.000' });
    authAs(INV_APPROVER);
    const rejected = await decide(rejectable.adjustment.id, 'rejected');
    expect(rejected.status).toBe(200);
    expect((await bodyOf<AdjustmentBody>(rejected)).status).toBe('rejected');
    expect(await onHandAt(ITEM_A, location)).toBe('3.000');
    expect(await auditCountFor('inv.stock_adjustment.rejected', rejectable.adjustment.id)).toBe(1);
  });
});

describe('inv.stock-adjustment-list', () => {
  it('lists a branch adjustments by status for readers and refuses the rest', async () => {
    const location = await freshLocation();
    const { adjustment } = await requestAdjustment({ locationId: location });
    const path = `/api/v1/stock-adjustments?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&status=pending&locationId=${location}`;
    authAs(INV_READER);
    const listed = await get(ADJUSTMENT_LIST, path);
    expect(listed.status).toBe(200);
    const page = await bodyOf<{ items: { id: string }[] }>(listed);
    expect(page.items.map((row) => row.id)).toEqual([adjustment.id]);
    authAs(FULL);
    expect((await get(ADJUSTMENT_LIST, path)).status).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await get(ADJUSTMENT_LIST, path)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Stock counts.
// ---------------------------------------------------------------------------

interface CountBody {
  id: string;
  status: string;
  recordVersion: number;
  replayed: boolean;
  varianceLineCount: number;
  absoluteVarianceQty: string;
  adjustmentsRaised?: number;
  lines: {
    itemId: string;
    snapshotQty: string;
    countedQty: string | null;
    movementDeltaDuringCount: string;
    varianceQty: string | null;
    adjustmentId: string | null;
    adjustmentStatus: string | null;
  }[];
}

async function openCount(
  body: Record<string, unknown>,
  principal = INV_FULL
): Promise<{ response: Response; count: CountBody }> {
  authAs(principal);
  const response = await post(COUNT_OPEN, '/api/v1/stock-counts', body);
  return { response, count: await bodyOf<CountBody>(response.clone()) };
}

const recordLine = (
  count: { id: string; recordVersion: number },
  itemId: string,
  countedQty: string,
  headers: Record<string, string> = {}
) =>
  putAt(
    COUNT_LINE,
    `/api/v1/stock-counts/${count.id}/lines/${itemId}`,
    { countId: count.id, itemId },
    { countedQty },
    { 'if-match': String(count.recordVersion), ...headers }
  );

describe('inv.stock-count-open', () => {
  it('snapshots the location, replays its key, and refuses a second open count of the same shelf', async () => {
    const location = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: location, quantity: '8.000' });
    const key = `odinv-${randomUUID()}`;
    const { response, count } = await openCount({ locationId: location, idempotencyKey: key });
    expect(response.status).toBe(201);
    expect(count.status).toBe('open');
    expect(count.lines.find((line) => line.itemId === ITEM_A)?.snapshotQty).toBe('8.000');
    expect(await auditCountFor('inv.stock_count.opened', count.id)).toBe(1);

    const replay = await openCount({ locationId: location, idempotencyKey: key });
    expect(replay.response.status).toBe(200);
    expect(replay.count.replayed).toBe(true);
    expect(replay.count.id).toBe(count.id);

    const second = await openCount({ locationId: location });
    expect(second.response.status).toBe(409);

    expect((await openCount({ locationId: location }, INV_READER)).response.status).toBe(403);
    expect(
      (await openCount({ locationId: location }, INV_PERMISSION_ELSEWHERE)).response.status
    ).toBe(403);
  });
});

describe('inv.stock-count-line-record, inv.stock-count-reconcile, inv.stock-count-read', () => {
  it('folds in movements posted during the count and raises pending adjustments that post nothing until approved', async () => {
    const location = await freshLocation();
    const elsewhere = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: location, quantity: '10.000' });
    const { count } = await openCount({ locationId: location });

    // Trading continues while the shelf is counted: three units leave by transfer.
    const moved = await dispatch({
      itemId: ITEM_A,
      fromLocationId: location,
      toLocationId: elsewhere,
      quantity: '3.000',
    });
    expect(moved.response.status).toBe(201);

    authAs(INV_FULL);
    const stale = await recordLine(
      { id: count.id, recordVersion: count.recordVersion + 5 },
      ITEM_A,
      '6'
    );
    expect(stale.status).toBe(409);
    authAs(INV_READER);
    expect((await recordLine(count, ITEM_A, '6')).status).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await recordLine(count, ITEM_A, '6')).status).toBe(403);
    authAs(INV_TENANT_B);
    expect((await recordLine(count, ITEM_A, '6')).status).toBe(404);

    // The counter finds 6. Expected is 10 - 3 = 7, so the variance is -1.
    authAs(INV_FULL);
    const recorded = await recordLine(count, ITEM_A, '6', { 'idempotency-key': randomUUID() });
    expect(recorded.status).toBe(200);
    const afterRecord = await bodyOf<CountBody>(recorded);
    expect(afterRecord.status).toBe('counting');
    expect(await auditCountFor('inv.stock_count.line_recorded', count.id)).toBe(1);

    const reconcilePath = `/api/v1/stock-counts/${count.id}/reconciliation`;
    authAs(INV_READER);
    expect(
      (await postAt(COUNT_RECONCILE, reconcilePath, { countId: count.id }, undefined)).status
    ).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect(
      (await postAt(COUNT_RECONCILE, reconcilePath, { countId: count.id }, undefined)).status
    ).toBe(403);
    authAs(INV_TENANT_B);
    expect(
      (await postAt(COUNT_RECONCILE, reconcilePath, { countId: count.id }, undefined)).status
    ).toBe(404);

    authAs(INV_FULL);
    const key = randomUUID();
    const reconciled = await postAt(
      COUNT_RECONCILE,
      reconcilePath,
      { countId: count.id },
      undefined,
      { 'idempotency-key': key }
    );
    expect(reconciled.status).toBe(200);
    const result = await bodyOf<CountBody>(reconciled);
    expect(result.status).toBe('reconciled');
    expect(result.adjustmentsRaised).toBe(1);
    expect(result.varianceLineCount).toBe(1);
    expect(result.absoluteVarianceQty).toBe('1.000');
    const line = result.lines.find((row) => row.itemId === ITEM_A);
    expect(line?.movementDeltaDuringCount).toBe('-3.000');
    expect(line?.varianceQty).toBe('-1.000');
    expect(line?.adjustmentStatus).toBe('pending');
    expect(await auditCountFor('inv.stock_count.reconciled', count.id)).toBe(1);
    const replay = await postAt(COUNT_RECONCILE, reconcilePath, { countId: count.id }, undefined, {
      'idempotency-key': key,
    });
    expect(replay.status).toBe(200);
    expect(
      (await postAt(COUNT_RECONCILE, reconcilePath, { countId: count.id }, undefined)).status
    ).toBe(409);

    // Nothing posted: the shelf balance is still the ledger's 7.
    expect(await onHandAt(ITEM_A, location)).toBe('7.000');

    // The read shows the same, and is refused where it should be.
    const readPath = `/api/v1/stock-counts/${count.id}`;
    authAs(INV_READER);
    const read = await getAt(COUNT_READ, readPath, { countId: count.id });
    expect(read.status).toBe(200);
    expect((await bodyOf<CountBody>(read)).varianceLineCount).toBe(1);
    authAs(FULL);
    expect((await getAt(COUNT_READ, readPath, { countId: count.id })).status).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await getAt(COUNT_READ, readPath, { countId: count.id })).status).toBe(403);
    authAs(INV_TENANT_B);
    expect((await getAt(COUNT_READ, readPath, { countId: count.id })).status).toBe(404);

    // Only an approval by a second person moves the stock.
    authAs(INV_APPROVER);
    expect((await decide(line?.adjustmentId ?? '', 'approved')).status).toBe(200);
    expect(await onHandAt(ITEM_A, location)).toBe('6.000');
  });
});

describe('inv.stock-count-cancel and inv.stock-count-list', () => {
  it('cancels an open count without raising anything, and lists counts with their discrepancy figures', async () => {
    const location = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: location, quantity: '2.000' });
    const { count } = await openCount({ locationId: location });
    const path = `/api/v1/stock-counts/${count.id}/cancellation`;

    authAs(INV_READER);
    expect(
      (await postAt(COUNT_CANCEL, path, { countId: count.id }, { reason: 'recount' })).status
    ).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect(
      (await postAt(COUNT_CANCEL, path, { countId: count.id }, { reason: 'recount' })).status
    ).toBe(403);
    authAs(INV_TENANT_B);
    expect(
      (await postAt(COUNT_CANCEL, path, { countId: count.id }, { reason: 'recount' })).status
    ).toBe(404);

    authAs(INV_FULL);
    const key = randomUUID();
    const cancelled = await postAt(
      COUNT_CANCEL,
      path,
      { countId: count.id },
      { reason: 'recount tomorrow' },
      { 'idempotency-key': key }
    );
    expect(cancelled.status).toBe(200);
    expect((await bodyOf<CountBody>(cancelled)).status).toBe('cancelled');
    expect(await auditCountFor('inv.stock_count.cancelled', count.id)).toBe(1);
    const replay = await postAt(
      COUNT_CANCEL,
      path,
      { countId: count.id },
      { reason: 'recount tomorrow' },
      { 'idempotency-key': key }
    );
    expect(replay.status).toBe(200);
    expect(
      (await postAt(COUNT_CANCEL, path, { countId: count.id }, { reason: 'again' })).status
    ).toBe(409);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.stock_adjustments WHERE location_id = $1`,
        [location]
      )
    ).toBe(0);

    const listPath = `/api/v1/stock-counts?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&locationId=${location}`;
    authAs(INV_READER);
    const listed = await get(COUNT_LIST, listPath);
    expect(listed.status).toBe(200);
    const page = await bodyOf<{
      items: {
        id: string;
        status: string;
        varianceLineCount: number;
        absoluteVarianceQty: string;
      }[];
    }>(listed);
    const row = page.items.find((item) => item.id === count.id);
    expect(row?.status).toBe('cancelled');
    expect(row?.varianceLineCount).toBe(0);
    expect(row?.absoluteVarianceQty).toBe('0.000');
    authAs(FULL);
    expect((await get(COUNT_LIST, listPath)).status).toBe(403);
    authAs(INV_PERMISSION_ELSEWHERE);
    expect((await get(COUNT_LIST, listPath)).status).toBe(403);
  });
});

/** The violations half of a problem document, for the refusals below. */
interface ProblemViolations {
  readonly violations?: readonly { path: string; rule: string }[];
}
/**
 * CC-OD-32 — the purchase-cost refusal names a permission, not the typed value.
 *
 * It travelled as rule `custom` on the cost control, which the catalogue
 * renders as "This value is not accepted here" — true of nothing the operator
 * typed, and silent about the one thing they can do: take the cost out.
 */
describe('CC-OD-32: the purchase-cost refusal names the permission', () => {
  it('puts the rule on every priced line when the receipt is entered', async () => {
    const location = await freshLocation();
    const { response: refused } = await createReceipt(
      [
        { itemId: ITEM_A, locationId: location, quantity: '1.000' },
        {
          itemId: ITEM_A,
          locationId: location,
          quantity: '1.000',
          unitCost: '9.5000',
          currencyCode: 'USD',
        },
      ],
      INV_NO_COST
    );
    expect(refused.status).toBe(422);
    // Only the priced line is named: the operator is not asked to change a line
    // that is already correct.
    expect((await bodyOf<ProblemViolations>(refused)).violations).toEqual([
      { path: 'body.lines.1.unitCost', rule: 'stock_receipt_cost_permission' },
    ]);
  });

  it('names the same rule when a stored priced receipt is entered into stock', async () => {
    const location = await freshLocation();
    const { receipt: draft } = await createReceipt([
      {
        itemId: ITEM_A,
        locationId: location,
        quantity: '1.000',
        unitCost: '9.5000',
        currencyCode: 'USD',
      },
    ]);
    authAs(INV_NO_COST);
    const refused = await postReceipt(draft.id, draft.recordVersion);
    expect(refused.status).toBe(403);
    // Against the request, not a control: the costs are already stored by now
    // and there is no box on the posting screen to clear.
    expect((await bodyOf<ProblemViolations>(refused)).violations).toEqual([
      { path: 'body', rule: 'stock_receipt_cost_permission' },
    ]);
    expect(await onHandAt(ITEM_A, location)).toBe('0.000');
  });
});

/**
 * The refusal TOKENS these operations publish, driven through their routes.
 *
 * The sibling half of the block at the foot of `p1-21-inventory-stock.test.ts`:
 * `STOCK_REFUSAL_RULES` carries a web sentence for each of eighteen refusals and
 * no backend case drove any of them, so nothing held the path or the token
 * steady. Each case asserts the status, the catalogue code, and the violation
 * exactly — the path decides which control the sentence appears beside, the rule
 * decides which sentence it is.
 */
describe('the intake and counting refusal tokens, on the wire', () => {
  it('names a goods-receipt line pointed at a quarantine cell', async () => {
    const { response } = await createReceipt([
      { itemId: ITEM_A, locationId: QUARANTINE_A1, quantity: '3.000' },
    ]);
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemViolations>(response)).violations).toEqual([
      { path: 'body.lines.0.locationId', rule: 'stock_location_quarantine' },
    ]);
  });

  it('names a goods-receipt line pointed at a transit cell', async () => {
    // The transit cell is minted by a real dispatch, because no operator may
    // create one: it is system-owned, one per branch, named by the transfer.
    const source = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: source, quantity: '4.000' });
    const destination = await freshLocation();
    const { transfer } = await dispatch({
      itemId: ITEM_A,
      fromLocationId: source,
      toLocationId: destination,
      quantity: '2.000',
    });
    const { response } = await createReceipt([
      { itemId: ITEM_A, locationId: transfer.transitLocationId, quantity: '1.000' },
    ]);
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemViolations>(response)).violations).toEqual([
      { path: 'body.lines.0.locationId', rule: 'stock_location_transit' },
    ]);
  });

  it('names a goods receipt that has already been entered into stock', async () => {
    const location = await freshLocation();
    const { receipt } = await createReceipt([
      { itemId: ITEM_A, locationId: location, quantity: '2.000' },
    ]);
    authAs(INV_FULL);
    const posted = await postReceipt(receipt.id, receipt.recordVersion);
    expect(posted.status).toBe(200);
    const again = await bodyOf<ReceiptBody>(posted.clone());

    const second = await postReceipt(receipt.id, again.recordVersion);
    expect(second.status).toBe(409);
    expect((await bodyOf<ProblemViolations>(second)).violations).toEqual([
      { path: 'body', rule: 'stock_receipt_not_draft' },
    ]);
  });

  it('names an adjustment against a transit cell', async () => {
    const source = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: source, quantity: '4.000' });
    const destination = await freshLocation();
    const { transfer } = await dispatch({
      itemId: ITEM_A,
      fromLocationId: source,
      toLocationId: destination,
      quantity: '2.000',
    });
    const { response } = await requestAdjustment({ locationId: transfer.transitLocationId });
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemViolations>(response)).violations).toEqual([
      { path: 'body.locationId', rule: 'stock_location_transit' },
    ]);
  });

  it('names an adjustment somebody has already decided', async () => {
    const location = await freshLocation();
    const { adjustment } = await requestAdjustment({ locationId: location });
    authAs(INV_APPROVER);
    expect((await decide(adjustment.id, 'rejected')).status).toBe(200);

    const again = await decide(adjustment.id, 'approved');
    expect(again.status).toBe(409);
    expect((await bodyOf<ProblemViolations>(again)).violations).toEqual([
      { path: 'body', rule: 'stock_adjustment_already_decided' },
    ]);
  });

  it('names the requester who tried to decide their own adjustment', async () => {
    const location = await freshLocation();
    const { adjustment } = await requestAdjustment({ locationId: location }, INV_APPROVER);
    // The same person, now wearing the approving hat. Maker-checker is the point.
    authAs(INV_APPROVER);
    const response = await decide(adjustment.id, 'approved');
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemViolations>(response)).violations).toEqual([
      { path: 'body', rule: 'stock_adjustment_separation_of_duties' },
    ]);
  });

  it('names a count that has been closed and can take no more lines', async () => {
    const location = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: location, quantity: '2.000' });
    const { count } = await openCount({ locationId: location });
    authAs(INV_FULL);
    const cancelled = await postAt(
      COUNT_CANCEL,
      `/api/v1/stock-counts/${count.id}/cancellation`,
      { countId: count.id },
      { reason: 'recount tomorrow' }
    );
    expect(cancelled.status).toBe(200);
    const closed = await bodyOf<CountBody>(cancelled);

    const response = await recordLine(
      { id: count.id, recordVersion: closed.recordVersion },
      ITEM_A,
      '2.000'
    );
    expect(response.status).toBe(409);
    expect((await bodyOf<ProblemViolations>(response)).violations).toEqual([
      { path: 'body', rule: 'stock_count_closed' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The branch-wide issued-parts read (Owner directive, P1-32-PRE-OD-UX).
//
// Every case below bounds its page with `issuedFrom`, captured immediately
// before the fixtures it is about. A branch-wide list accumulates, and a
// `not.toContain` over an unbounded page is an assertion about which rows
// happened to fit — which is not the assertion any of these cases means.
// ---------------------------------------------------------------------------

interface IssuedPartRow {
  id: string;
  workOrderId: string;
  workOrderDisplayNumber: string | null;
  item: { id: string; code: string; name: string };
  quantity: string;
  returnedQuantity: string;
  returnableQuantity: string;
  unitCode: string;
  issuedAt: string;
  issuedBy: { id: string; displayName: string | null };
  branchId: string;
}

/** One part issued to a fresh open work order, through the shipped write path. */
async function issuePart(
  options: {
    readonly branchId?: string;
    readonly locationId?: string;
    readonly itemId?: string;
    readonly quantity?: string;
  } = {}
): Promise<{ id: string; workOrderId: string; vehicleId: string; visitId: string }> {
  const branchId = options.branchId ?? BRANCH_A1;
  const locationId = options.locationId ?? WAREHOUSE_A1;
  const itemId = options.itemId ?? ITEM_A;
  const order = await createOpenWorkOrder({ companyId: COMPANY_A1, branchId });
  const materialRequirementId = await seedApprovedMaterialRequirement({
    workOrderId: order.workOrderId,
    itemId,
  });
  await seedStock({ itemId, locationId, branchId, quantity: '50.000' });
  authAs(INV_FULL);
  const response = await post(ISSUE, '/api/v1/stock-issues', {
    workOrderId: order.workOrderId,
    itemId,
    locationId,
    quantity: options.quantity ?? '2.000',
    materialRequirementId,
  });
  expect(response.status).toBe(201);
  const issued = await bodyOf<{ id: string }>(response);
  return {
    id: issued.id,
    workOrderId: order.workOrderId,
    vehicleId: order.vehicleId,
    visitId: order.visitId,
  };
}

/** Runs fixture SQL as tenant A, so every trigger that stamps an actor finds one. */
async function asTenantA(work: (client: PoolClient) => Promise<unknown>): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
      [USER_A, TENANT_A]
    );
    await work(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** An instant a shade before now, as the inclusive lower bound of a page. */
const justBefore = (): string => new Date(Date.now() - 5_000).toISOString();

const listIssuedParts = (query: string): Promise<Response> =>
  get(PART_ISSUE_LIST, `/api/v1/part-issues?${query}`);

const idsOf = async (response: Response): Promise<string[]> =>
  (await bodyOf<{ items: IssuedPartRow[] }>(response)).items.map((row) => row.id);

const rowsOf = async (response: Response): Promise<IssuedPartRow[]> =>
  (await bodyOf<{ items: IssuedPartRow[] }>(response)).items;

/** A page of issued parts as the wire carries it, cursor included. */
interface IssuedPartPage {
  items: IssuedPartRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Every ASCII digit rewritten as its Arabic-Indic twin (U+0660..U+0669). */
const arabicIndic = (value: string): string =>
  value.replace(/[0-9]/g, (digit) => String.fromCharCode(0x0660 + Number(digit)));

// Statement counting for the issued-parts read. The route reaches the database
// through the primary pool, so that pool is wrapped at its connection boundary —
// below the route, the service, the repository and the transaction helper — and
// every statement PostgreSQL is asked is recorded, the technique
// `p1-24-read-path-shape.test.ts` uses. Counting is OFF unless a case turns it
// on, so every other case in this file runs unobserved.
let issuedPartStatements: string[] = [];
let countingIssuedPartStatements = false;
const countedClients = new WeakSet<PoolClient>();

function countClient(client: PoolClient): void {
  if (countedClients.has(client)) return;
  countedClients.add(client);
  const query = client.query.bind(client) as (...args: readonly unknown[]) => unknown;
  const counted = (...args: readonly unknown[]): unknown => {
    if (countingIssuedPartStatements) {
      const first = args[0];
      issuedPartStatements.push(
        typeof first === 'string'
          ? first
          : String((first as { text?: string } | undefined)?.text ?? '<config>')
      );
    }
    return query(...args);
  };
  (client as unknown as { query: unknown }).query = counted;
}

/** Wraps every client the pool hands out, in both of `pg`'s calling styles. */
function countStatementsOn(pool: Pool): void {
  const connect = pool.connect.bind(pool) as (...args: readonly unknown[]) => unknown;
  const patched = (...args: readonly unknown[]): unknown => {
    const callback = args[0];
    if (typeof callback === 'function') {
      return connect((error: unknown, client: PoolClient | undefined, release: unknown) => {
        if (client !== undefined) countClient(client);
        (callback as (...values: readonly unknown[]) => void)(error, client, release);
      });
    }
    return (connect() as Promise<PoolClient>).then((client) => {
      countClient(client);
      return client;
    });
  };
  (pool as unknown as { connect: unknown }).connect = patched;
}

/** Runs one request with counting on, and returns its page and every statement it sent. */
async function measureIssuedParts(
  query: string
): Promise<{ status: number; page: IssuedPartPage; statements: readonly string[] }> {
  issuedPartStatements = [];
  countingIssuedPartStatements = true;
  try {
    const response = await listIssuedParts(query);
    return {
      status: response.status,
      page: await bodyOf<IssuedPartPage>(response),
      statements: [...issuedPartStatements],
    };
  } finally {
    countingIssuedPartStatements = false;
  }
}

describe('inv.part-issue-list', () => {
  beforeAll(() => {
    countStatementsOn(primaryPool());
  });

  // Several cases below make many list calls as one caller; without a fresh
  // limiter a later case answers 429 and reads as a broken filter.
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it('answers the branch that is named, and the AUTHORIZED union when none is', async () => {
    const since = justBefore();
    const inA1 = await issuePart({ branchId: BRANCH_A1, locationId: WAREHOUSE_A1 });
    const inA2 = await issuePart({ branchId: BRANCH_A2, locationId: WAREHOUSE_A2 });
    const window = `companyId=${COMPANY_A1}&issuedFrom=${encodeURIComponent(since)}&limit=100`;

    // A named branch answers for that branch and no other.
    authAs(INV_READER);
    const named = await listIssuedParts(`${window}&branchId=${BRANCH_A1}`);
    expect(named.status).toBe(200);
    expect(await idsOf(named)).toContain(inA1.id);
    expect(await idsOf(await listIssuedParts(`${window}&branchId=${BRANCH_A1}`))).not.toContain(
      inA2.id
    );

    // Omitting the branch answers for every branch of the company this caller may
    // run the operation in. Unrestricted, so that is both.
    const union = await listIssuedParts(window);
    expect(union.status).toBe(200);
    const unionIds = await idsOf(union);
    expect(unionIds).toContain(inA1.id);
    expect(unionIds).toContain(inA2.id);

    // The decisive case. `INV_PERMISSION_ELSEWHERE` holds the inventory codes in
    // A2 only, and an unrelated grant in A1 — so A1's rows ARE visible to RLS for
    // it. Omitting the branch must still answer for A2 alone: the union is the set
    // of branches that carry THIS operation's codes, never the permission-blind
    // union of every grant (P1-18-A-01).
    authAs(INV_PERMISSION_ELSEWHERE);
    const narrowed = await listIssuedParts(window);
    expect(narrowed.status).toBe(200);
    const narrowedIds = await idsOf(narrowed);
    expect(narrowedIds).toContain(inA2.id);
    expect(narrowedIds).not.toContain(inA1.id);
  });

  it('refuses a named branch the caller holds no authority in, and another tenant', async () => {
    const since = justBefore();
    const inA1 = await issuePart({ branchId: BRANCH_A1, locationId: WAREHOUSE_A1 });
    const window = `companyId=${COMPANY_A1}&issuedFrom=${encodeURIComponent(since)}&limit=100`;

    // Named A1 by a caller whose inventory grant is in A2. RLS would admit the
    // row; the scoped permission check is the only thing that refuses it.
    authAs(INV_PERMISSION_ELSEWHERE);
    const tampered = await listIssuedParts(`${window}&branchId=${BRANCH_A1}`);
    expect(tampered.status).toBe(403);
    expect(await tampered.text()).not.toContain(inA1.id);

    // Authority, not tenancy: a tenant-A caller holding no inventory read at all.
    authAs(FULL);
    expect((await listIssuedParts(`${window}&branchId=${BRANCH_A1}`)).status).toBe(403);

    // The tenant boundary. A tenant-B caller naming tenant A's company holds the
    // codes and no branch narrowing, so the seam treats the company as the scope
    // (`resolveAuthorizedBranches`, first case) and the page is read under tenant
    // B's own tenant and row-level security: an EMPTY page, never a line of
    // tenant A. The policy half is proved on its own in the RLS case below.
    authAs(INV_TENANT_B);
    const foreign = await listIssuedParts(window);
    expect(foreign.status).toBe(200);
    expect((await bodyOf<{ items: IssuedPartRow[] }>(foreign.clone())).items).toEqual([]);
    expect(await foreign.text()).not.toContain(inA1.id);
  });

  it('matches the item name, the item code and the work-order number, and nothing else', async () => {
    const since = justBefore();
    const pad = await issuePart({ itemId: ITEM_A });
    const filter = await issuePart({ itemId: ITEM_A_ALT });
    const window = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&issuedFrom=${encodeURIComponent(
      since
    )}&limit=100`;

    authAs(INV_READER);
    // The NAME arm. `Fixture brake pad` is folded by `shared.fold_search_text`,
    // the SQL twin of the rule the fragment was folded by.
    const byName = await listIssuedParts(`${window}&q=brake`);
    expect(byName.status).toBe(200);
    const nameIds = await idsOf(byName);
    expect(nameIds).toContain(pad.id);
    expect(nameIds).not.toContain(filter.id);

    // The CODE arm. `FX-P121-B` is the oil filter's SKU and no part of the brake
    // pad's name or code.
    const byCode = await idsOf(
      await listIssuedParts(`${window}&q=${encodeURIComponent('P121-B')}`)
    );
    expect(byCode).toContain(filter.id);
    expect(byCode).not.toContain(pad.id);

    // The paperwork-number arm, searched by the number actually allocated to the
    // pad's job rather than by a number this test invented.
    const number = (await rowsOf(await listIssuedParts(window))).find(
      (row) => row.id === pad.id
    )?.workOrderDisplayNumber;
    expect(number).toBeTruthy();
    const byNumber = await idsOf(
      await listIssuedParts(`${window}&q=${encodeURIComponent(number ?? '')}`)
    );
    expect(byNumber).toContain(pad.id);
    expect(byNumber).not.toContain(filter.id);
  });

  it('reports the remainder the DATABASE computed, after a partial return', async () => {
    const since = justBefore();
    const issued = await issuePart({ quantity: '4.000' });
    const window = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&issuedFrom=${encodeURIComponent(
      since
    )}&limit=100`;

    authAs(INV_READER);
    const before = (await rowsOf(await listIssuedParts(window))).find(
      (row) => row.id === issued.id
    );
    expect(before?.quantity).toBe('4.000');
    expect(before?.returnedQuantity).toBe('0.000');
    expect(before?.returnableQuantity).toBe('4.000');
    // The row is readable without already knowing the job: a name, a code and a unit.
    expect(before?.item.name).toBe('Fixture brake pad');
    expect(before?.item.code).toBe('FX-P121-A');
    expect(before?.unitCode).toBeTruthy();
    expect(before?.branchId).toBe(BRANCH_A1);

    authAs(INV_FULL);
    const returned = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: issued.id,
      quantity: '1.500',
      reason: 'wrong part fitted',
    });
    expect(returned.status).toBe(201);

    authAs(INV_READER);
    const after = (await rowsOf(await listIssuedParts(window))).find((row) => row.id === issued.id);
    // All three operands travel, so the subtraction is checkable rather than
    // asserted — and none of it happened in JavaScript.
    expect(after?.quantity).toBe('4.000');
    expect(after?.returnedQuantity).toBe('1.500');
    expect(after?.returnableQuantity).toBe('2.500');
  });

  it('counts BOTH return paths on both issue reads, exactly as the ceiling does', async () => {
    const since = justBefore();
    const issued = await issuePart({ quantity: '5.000' });
    const window = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&issuedFrom=${encodeURIComponent(
      since
    )}&limit=100`;

    // One unit back through the legacy stock-return path, two through the
    // sales-return path. The schema allows both against one issue line and bounds
    // them by ONE ceiling over both tables.
    authAs(INV_FULL);
    const legacy = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: issued.id,
      quantity: '1.000',
      reason: 'not needed',
    });
    expect(legacy.status).toBe(201);
    authAs(INV_COUNTER);
    const received = await post(SALES_RETURN_CREATE, '/api/v1/sales-returns', {
      sourceKind: 'part_issue',
      sourceId: issued.id,
      quantity: '2.000',
      condition: 'restockable',
      receivedLocationId: WAREHOUSE_A1,
    });
    expect(received.status).toBe(201);

    // The figure the database binds a return against.
    authAs(INV_READER);
    const ceiling = await bodyOf<{
      sourceQuantity: string;
      returnedQuantity: string;
      remainingQuantity: string;
    }>(
      await get(
        RETURNABLE,
        `/api/v1/returnable-quantities?sourceKind=part_issue&sourceId=${issued.id}`
      )
    );
    expect(ceiling).toMatchObject({
      sourceQuantity: '5.000',
      returnedQuantity: '3.000',
      remainingQuantity: '2.000',
    });

    // The branch-wide read agrees with it.
    const branchRow = (await rowsOf(await listIssuedParts(window))).find(
      (row) => row.id === issued.id
    );
    expect(branchRow?.returnedQuantity).toBe(ceiling.returnedQuantity);
    expect(branchRow?.returnableQuantity).toBe(ceiling.remainingQuantity);

    // And so does the per-work-order read of the same line.
    const perOrder = await getAt(
      WORK_ORDER_PART_ISSUES,
      `/api/v1/work-orders/${issued.workOrderId}/part-issues`,
      { workOrderId: issued.workOrderId }
    );
    expect(perOrder.status).toBe(200);
    const orderRow = (
      await bodyOf<{ items: { id: string; quantity: string; returnedQty: string }[] }>(perOrder)
    ).items.find((row) => row.id === issued.id);
    expect(orderRow?.quantity).toBe('5.000');
    expect(orderRow?.returnedQty).toBe(ceiling.returnedQuantity);

    // The legacy return's own pre-check reads the same figure: 2.5 more fits a
    // count of the stock-return table alone (1 + 2.5 <= 5) and does not fit the
    // ceiling (3 + 2.5 > 5), so it is refused by the named rule before any insert.
    authAs(INV_FULL);
    const excess = await post(RETURN, '/api/v1/stock-returns', {
      partIssueId: issued.id,
      quantity: '2.500',
    });
    expect(excess.status).toBe(409);
    expect((await bodyOf<ProblemViolations>(excess)).violations).toEqual([
      { path: 'body.quantity', rule: 'stock_return_exceeds_issue' },
    ]);
  });

  it('finds an issue of a retired catalogue item by the name and code it is listed under', async () => {
    const since = justBefore();
    const suffix = String(randomInt(100000, 999999));
    const itemId = randomUUID();
    const sku = `FX-RET-${suffix}`;
    const name = `Fixture retired gasket ${suffix}`;
    await admin.query(
      `INSERT INTO inv.item_master
         (id, tenant_id, item_category_id, sku, name, uom_id, is_stock_tracked,
          lifecycle_status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,true,'active',$7)`,
      [itemId, TENANT_A, CATEGORY_A, sku, name, UOM_EACH, USER_A]
    );
    const retired = await issuePart({ itemId });
    const other = await issuePart({ itemId: ITEM_A });
    await asTenantA((client) =>
      client.query(
        `UPDATE inv.item_master SET deleted_at = now(), deleted_by = $3
          WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, itemId, USER_A]
      )
    );
    const window = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&issuedFrom=${encodeURIComponent(
      since
    )}&limit=100`;

    authAs(INV_READER);
    // The list still shows the line, under the retired entry's name and code...
    const shown = (await rowsOf(await listIssuedParts(window))).find(
      (row) => row.id === retired.id
    );
    expect(shown?.item.name).toBe(name);
    expect(shown?.item.code).toBe(sku);

    // ...so the box has to reach it by exactly those.
    const byName = await idsOf(
      await listIssuedParts(`${window}&q=${encodeURIComponent(`retired gasket ${suffix}`)}`)
    );
    expect(byName).toContain(retired.id);
    expect(byName).not.toContain(other.id);
    const byCode = await idsOf(await listIssuedParts(`${window}&q=${encodeURIComponent(sku)}`));
    expect(byCode).toContain(retired.id);
    expect(byCode).not.toContain(other.id);
  });

  it('matches the plate and the VIN, and never the customer name or phone', async () => {
    const since = justBefore();
    const target = await issuePart();
    const other = await issuePart();
    const plate = `PIQ ${randomInt(10000, 99999)}`;
    const nameTerm = `qarnawi${randomInt(1000, 9999)}`;
    const phone = `9627${randomInt(10000000, 99999999)}`;
    const partnerId = randomUUID();
    await asTenantA(async (client) => {
      await client.query(
        `INSERT INTO veh.plate_history
           (tenant_id, vehicle_id, country_code, plate_raw, valid_from, created_by)
         VALUES ($1,$2,'JO',$3,current_date,$4)`,
        [TENANT_A, target.vehicleId, plate, USER_A]
      );
      // A customer on the target's visit whose name and phone are the search
      // terms below, and whose terms appear in no field of either issue line.
      await client.query(
        `INSERT INTO crm.business_partners
           (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
         VALUES ($1,$2,'individual',$3,'active',$4)`,
        [partnerId, TENANT_A, `Zubaydah ${nameTerm}`, USER_A]
      );
      await client.query(
        `INSERT INTO crm.contact_points
           (tenant_id, partner_id, channel, normalized_value, raw_value, is_primary, created_by)
         VALUES ($1,$2,'mobile',$3,$3,true,$4)`,
        [TENANT_A, partnerId, phone, USER_A]
      );
      await client.query(
        `INSERT INTO rec.reception_party_roles
           (tenant_id, company_id, branch_id, reception_visit_id, partner_id, relationship_role,
            valid_from, created_by)
         VALUES ($1,$2,$3,$4,$5,'service_requester',now(),$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, target.visitId, partnerId, USER_A]
      );
    });
    const vin =
      (
        await admin.query<{ vin_normalized: string }>(
          `SELECT vin_normalized FROM veh.vehicles WHERE id = $1`,
          [target.vehicleId]
        )
      ).rows[0]?.vin_normalized ?? '';
    expect(vin.length).toBeGreaterThan(6);
    const window = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&issuedFrom=${encodeURIComponent(
      since
    )}&limit=100`;

    authAs(INV_READER);
    const byPlate = await idsOf(await listIssuedParts(`${window}&q=${encodeURIComponent(plate)}`));
    expect(byPlate).toContain(target.id);
    expect(byPlate).not.toContain(other.id);
    const byVin = await idsOf(await listIssuedParts(`${window}&q=${encodeURIComponent(vin)}`));
    expect(byVin).toContain(target.id);
    expect(byVin).not.toContain(other.id);

    // Positive controls: the customer really is connected to the target's job.
    // The work-order board searches a party's NAME on its visit and finds it; it
    // has no phone arm, so the phone half is proved on the rows the shared phone
    // arm reads — a live role on the visit naming a partner whose stored mobile
    // number is exactly the digits typed.
    authAs(FULL);
    const board = await LIST_WORK_ORDERS(
      new Request(
        `http://localhost/api/v1/work-orders?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}` +
          `&q=${encodeURIComponent(nameTerm)}`
      )
    );
    expect(board.status).toBe(200);
    expect((await bodyOf<{ items: { id: string }[] }>(board)).items.map((row) => row.id)).toContain(
      target.workOrderId
    );
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n
           FROM rec.reception_party_roles r
           JOIN crm.contact_points cp
             ON cp.tenant_id = r.tenant_id AND cp.partner_id = r.partner_id
          WHERE r.tenant_id = $1 AND r.reception_visit_id = $2 AND r.deleted_at IS NULL
            AND r.valid_to IS NULL AND cp.deleted_at IS NULL
            AND cp.channel = 'mobile' AND cp.normalized_value = $3`,
        [TENANT_A, target.visitId, phone]
      )
    ).toBe(1);

    // The issued-parts box never reaches the customer: both answer 200 and
    // without the target line.
    authAs(INV_READER);
    for (const term of [nameTerm, phone]) {
      const response = await listIssuedParts(`${window}&q=${encodeURIComponent(term)}`);
      expect(response.status, term).toBe(200);
      expect(await idsOf(response), term).not.toContain(target.id);
    }
  });

  it('names who issued the part only to a caller holding iam.user.read', async () => {
    const since = justBefore();
    const issued = await issuePart();
    const window = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&issuedFrom=${encodeURIComponent(
      since
    )}&limit=100`;

    // Without the directory code: the id is published, the NAME is not.
    authAs(INV_READER);
    const unnamed = (await rowsOf(await listIssuedParts(window))).find(
      (row) => row.id === issued.id
    );
    expect(unnamed?.issuedBy.id).toBe(INV_FULL.userId);
    expect(unnamed?.issuedBy.displayName).toBeNull();

    // With it: the same row, named. Without this half the assertion above would
    // pass against a resolution that is broken for everybody.
    authAs(INV_READER_NAMED);
    const named = (await rowsOf(await listIssuedParts(window))).find((row) => row.id === issued.id);
    expect(named?.issuedBy.id).toBe(INV_FULL.userId);
    expect(named?.issuedBy.displayName).toBe('P1-21 Principal');
  });

  it('refuses an inverted issued window with a catalogued token instead of an empty page', async () => {
    const from = '2026-03-02T00:00:00Z';
    const to = '2026-03-01T00:00:00Z';
    authAs(INV_READER);
    const response = await listIssuedParts(
      `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}` +
        `&issuedFrom=${encodeURIComponent(from)}&issuedTo=${encodeURIComponent(to)}`
    );
    expect(response.status).toBe(422);
    expect((await bodyOf<ProblemViolations>(response)).violations).toEqual([
      { path: 'query.issuedTo', rule: 'issued_window_inverted' },
    ]);

    // The same two instants the right way round are an ordinary page, so the
    // refusal is about the ORDER and not about the parameters existing.
    const ordered = await listIssuedParts(
      `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}` +
        `&issuedFrom=${encodeURIComponent(to)}&issuedTo=${encodeURIComponent(from)}`
    );
    expect(ordered.status).toBe(200);
  });

  it('reaches the item code and the work-order number through Arabic-Indic digits', async () => {
    const since = justBefore();
    const pad = await issuePart({ itemId: ITEM_A });
    const filter = await issuePart({ itemId: ITEM_A_ALT });
    const window = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&issuedFrom=${encodeURIComponent(
      since
    )}&limit=100`;

    authAs(INV_READER);
    // The CODE arm, typed with the digits a keyboard set to Arabic produces: the
    // fragment folds to `P121-B`, which is the oil filter's SKU and no part of the
    // brake pad's.
    const byCode = await listIssuedParts(
      `${window}&q=${encodeURIComponent(arabicIndic('P121-B'))}`
    );
    expect(byCode.status).toBe(200);
    const codeIds = await idsOf(byCode);
    expect(codeIds).toContain(filter.id);
    expect(codeIds).not.toContain(pad.id);

    // The paperwork-number arm, with every digit of the number actually allocated
    // to the pad's job rewritten. Anti-vacuity: the number carries digits, so the
    // query below really differs from the ASCII spelling.
    const number = (await rowsOf(await listIssuedParts(window))).find(
      (row) => row.id === pad.id
    )?.workOrderDisplayNumber;
    expect(number).toMatch(/[0-9]/);
    const typed = arabicIndic(number ?? '');
    expect(typed).not.toBe(number);
    const byNumber = await idsOf(await listIssuedParts(`${window}&q=${encodeURIComponent(typed)}`));
    expect(byNumber).toContain(pad.id);
    expect(byNumber).not.toContain(filter.id);
  });

  it('treats a LIKE metacharacter in the box as a literal character', async () => {
    const since = justBefore();
    const pad = await issuePart({ itemId: ITEM_A });
    const wildcard = await issuePart({ itemId: ITEM_A_WILDCARD });
    const window = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&issuedFrom=${encodeURIComponent(
      since
    )}&limit=100`;

    authAs(INV_READER);
    // `FX_P121` unescaped would read `_` as "any one character" and match the
    // brake pad's `FX-P121-A` too. Escaped, it matches the SKU that really holds
    // an underscore, `FX_P121_WILD`, and nothing else.
    const response = await listIssuedParts(`${window}&q=${encodeURIComponent('FX_P121')}`);
    expect(response.status).toBe(200);
    const ids = await idsOf(response);
    expect(ids).toContain(wildcard.id);
    expect(ids).not.toContain(pad.id);
  });

  it('narrows by work order and by item, and a page walked by cursor is the whole page', async () => {
    const since = justBefore();
    const first = await issuePart({ itemId: ITEM_A });
    const second = await issuePart({ itemId: ITEM_A_ALT });
    const third = await issuePart({ itemId: ITEM_A });
    const window = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&issuedFrom=${encodeURIComponent(
      since
    )}`;

    authAs(INV_READER);
    // The two exact filters. Each is a predicate on the row, so each answers its
    // own line and no other line of this window.
    const byOrder = await idsOf(
      await listIssuedParts(`${window}&workOrderId=${second.workOrderId}`)
    );
    expect(byOrder).toEqual([second.id]);
    const byItem = await idsOf(await listIssuedParts(`${window}&itemId=${ITEM_A_ALT}&limit=100`));
    expect(byItem).toContain(second.id);
    expect(byItem).not.toContain(first.id);
    expect(byItem).not.toContain(third.id);

    // The whole window in one page, newest first.
    const whole = await bodyOf<IssuedPartPage>(await listIssuedParts(`${window}&limit=100`));
    expect(whole.hasMore).toBe(false);
    const wholeIds = whole.items.map((row) => row.id);
    expect(wholeIds).toEqual(expect.arrayContaining([first.id, second.id, third.id]));
    // Newest first, compared as INSTANTS: `issuedAt` never increases down the page.
    const instants = whole.items.map((row) => Date.parse(row.issuedAt));
    expect(instants).toEqual([...instants].sort((a, b) => b - a));

    // The same window walked one row at a time. The keyset is (created_at, id), so
    // every row arrives exactly once and in the same order as the single page —
    // no duplicate at a page boundary and no row skipped between two.
    const walked: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < wholeIds.length + 2; guard += 1) {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const page: IssuedPartPage = await bodyOf<IssuedPartPage>(
        await listIssuedParts(`${window}&limit=1${suffix}`)
      );
      expect(page.items.length).toBeLessThanOrEqual(1);
      walked.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(walked).toEqual(wholeIds);
  });

  it('refuses a malformed filter with the rule that names it', async () => {
    authAs(INV_READER);
    const base = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`;
    const refusals: ReadonlyArray<readonly [string, ProblemViolations['violations']]> = [
      [`branchId=${BRANCH_A1}`, [{ path: 'query.companyId', rule: 'invalid_type' }]],
      [
        `${base}&workOrderId=not-a-work-order`,
        [{ path: 'query.workOrderId', rule: 'invalid_format' }],
      ],
      [`${base}&itemId=not-an-item`, [{ path: 'query.itemId', rule: 'invalid_format' }]],
      // An instant with no offset is refused rather than read in the server's zone.
      [
        `${base}&issuedFrom=2026-03-01T00:00:00`,
        [{ path: 'query.issuedFrom', rule: 'invalid_format' }],
      ],
      [`${base}&issuedTo=yesterday`, [{ path: 'query.issuedTo', rule: 'invalid_format' }]],
      [`${base}&q=a`, [{ path: 'query.q', rule: 'too_small' }]],
      // `.strict()`: a parameter the read does not know is refused, never ignored.
      [`${base}&customerId=${COMPANY_A1}`, [{ path: 'query', rule: 'unrecognized_keys' }]],
    ];
    for (const [query, violations] of refusals) {
      const response = await listIssuedParts(query);
      expect(response.status, query).toBe(422);
      expect((await bodyOf<ProblemViolations>(response)).violations, query).toEqual(violations);
    }
  });

  it('is hidden from another tenant by row-level security, not only by the query', async () => {
    const issued = await issuePart();
    // The statement carries NO tenant predicate of its own, so the only thing that
    // can hide the row from tenant B is the policy on the runtime role.
    const sql = `SELECT pi.id::text AS id
                   FROM inv.part_issues pi
                   JOIN inv.item_master i ON i.id = pi.item_id
                   JOIN wo.work_orders w ON w.id = pi.work_order_id
                  WHERE pi.id = $1`;
    const readAs = (userId: string, tenantId: string): Promise<string[]> =>
      withReadOnlyTransaction(
        buildRequestContext({
          correlationId: randomUUID(),
          principal: { userId, tenantId },
          operation: PART_ISSUE_LIST_OPERATION.id,
          module: 'inventory',
        }),
        async (db) => (await db.query<{ id: string }>(sql, [issued.id])).rows.map((row) => row.id)
      );

    // The positive control FIRST: the same statement, on the same runtime pool,
    // answers for the row's own tenant — so the empty answer below is the policy
    // and not a statement that finds nothing for anybody.
    expect(await readAs(INV_READER.userId, TENANT_A)).toEqual([issued.id]);
    expect(await readAs(INV_TENANT_B.userId, TENANT_B)).toEqual([]);

    // And through the route: a tenant-B caller naming tenant A's company is never
    // handed tenant A's line, whatever the status it is answered with.
    authAs(INV_TENANT_B);
    const foreign = await listIssuedParts(`companyId=${COMPANY_A1}&limit=100`);
    expect(await foreign.text()).not.toContain(issued.id);
  });

  it('sends the same statements for one row as for three, names included', async () => {
    const since = justBefore();
    await issuePart();
    await issuePart();
    await issuePart();
    const window = `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&issuedFrom=${encodeURIComponent(
      since
    )}`;

    // A caller holding `iam.user.read`, so every row's issuer IS named and the
    // directory statement is part of what is measured rather than skipped.
    authAs(INV_READER_NAMED);
    // Warm, then measure: a cold pool client issues session-setup statements a
    // reused one does not, which would read as the larger page being cheaper.
    await listIssuedParts(`${window}&limit=1`).then((response) => response.text());
    await listIssuedParts(`${window}&limit=3`).then((response) => response.text());

    const one = await measureIssuedParts(`${window}&limit=1`);
    const three = await measureIssuedParts(`${window}&limit=3`);
    expect(one.status).toBe(200);
    expect(three.status).toBe(200);
    expect(one.page.items).toHaveLength(1);
    expect(three.page.items).toHaveLength(3);
    for (const row of three.page.items) expect(row.issuedBy.displayName).toBe('P1-21 Principal');

    // Anti-vacuity: counting really observed the read.
    const readsIssues = (text: string): boolean => /FROM\s+inv\.part_issues/i.test(text);
    expect(one.statements.filter(readsIssues)).toHaveLength(1);
    // No statement per row: two more rows, and not one more statement.
    expect(three.statements.length).toBe(one.statements.length);
    expect(three.statements.filter(readsIssues)).toHaveLength(1);
  });
});
