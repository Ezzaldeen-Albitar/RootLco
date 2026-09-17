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
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Quantity } from '@/modules/inventory';
import {
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  BRANCH_A1,
  COMPANY_A1,
} from './helpers';
import { BRANCH_A2, FULL, establishP1_19Fixtures } from './p1-19-helpers';
import {
  INV_APPROVER,
  INV_FULL,
  INV_NO_COST,
  INV_PERMISSION_ELSEWHERE,
  INV_READER,
  INV_SCOPED_A2,
  INV_TENANT_B,
  ITEM_A,
  ITEM_A_ALT,
  auditCountFor,
  authAs,
  balanceOf,
  cleanP1_21Fixtures,
  countRowsOf,
  establishP1_21Fixtures,
  freshLocation,
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

  it('refuses a partial receipt (denial) and replays a retried receipt by its key (idempotency)', async () => {
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
    const partial = await postAt(
      TRANSFER_RECEIVE,
      path,
      { transferId: transfer.id },
      {
        quantity: '2.000',
      }
    );
    expect(partial.status).toBe(409);
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
