import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * The P1-32 stock-operation ADAPTERS: transfers, goods receipts, cost history,
 * adjustments and counts — and how a refusal is said.
 *
 * Only the transport is mocked. The properties this file protects: every list
 * is addressed to its branch target; quantities and costs travel as the strings
 * they were typed; the two version-guarded writes send the version they are
 * handed as If-Match and nothing else; the discrepancy settlement re-presents the
 * key its form holds; and a refusal names its reason — a material-draw refusal
 * by the reason the server publishes, a state refusal by the act that was
 * refused — without downgrading a specific violation the server stated.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const {
  cancelStockCount,
  cancelTransfer,
  createAdjustment,
  createGoodsReceipt,
  createIssue,
  createReservation,
  createTransfer,
  decideAdjustment,
  decideTransferWriteOff,
  listAdjustments,
  listGoodsReceipts,
  listStockCounts,
  listTransferWriteOffs,
  listTransfers,
  openStockCount,
  postGoodsReceipt,
  readGoodsReceipt,
  readItemCostHistory,
  readStockCount,
  receiveTransfer,
  reconcileStockCount,
  recordStockCountLine,
  resolveTransferDiscrepancy,
} = await import('@/features/inventory/api');
const { MATERIAL_DRAW_REASONS } = await import('@/features/inventory/inventory-contract');

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const TRANSFER_ID = '55555555-5555-4555-8555-555555555555';
const RECEIPT_ID = '66666666-6666-4666-8666-666666666666';
const COUNT_ID = '77777777-7777-4777-8777-777777777777';
const ADJUSTMENT_ID = '88888888-8888-4888-8888-888888888888';
const TARGET = { companyId: COMPANY_ID, branchId: BRANCH_ID };

const ok = (data: unknown) => ({ ok: true as const, status: 200, data, correlationId: 'corr-1' });
const refused = (kind: string, problem: Record<string, unknown> | null = null) => ({
  ok: false as const,
  kind,
  status: 409,
  problem,
  correlationId: 'corr-1',
});
const params = (path: string) => new URLSearchParams(path.slice(path.indexOf('?')));
const EMPTY_PAGE = { items: [], nextCursor: null, hasMore: false };

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('every stock-operation list is addressed to its branch target', () => {
  it('transfers carry the target and the direction', async () => {
    get.mockResolvedValue(ok(EMPTY_PAGE));
    await listTransfers(TARGET, 'inbound');
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/stock-transfers?')).toBe(true);
    const search = params(path);
    expect(search.get('companyId')).toBe(COMPANY_ID);
    expect(search.get('branchId')).toBe(BRANCH_ID);
    expect(search.get('direction')).toBe('inbound');
  });

  it('goods receipts and counts carry the target and nothing else but the page size', async () => {
    get.mockResolvedValue(ok(EMPTY_PAGE));
    await listGoodsReceipts(TARGET);
    await listStockCounts(TARGET);
    for (const [index, root] of [
      [0, '/api/v1/goods-receipts?'],
      [1, '/api/v1/stock-counts?'],
    ] as const) {
      const path = String(get.mock.calls[index]?.[0]);
      expect(path.startsWith(root)).toBe(true);
      expect([...params(path).keys()].sort()).toEqual(['branchId', 'companyId', 'limit']);
    }
  });

  it('write-offs carry the target, the write-off kind and the decision they wait for', async () => {
    get.mockResolvedValue(ok(EMPTY_PAGE));
    await listTransferWriteOffs(TARGET, 'pending');
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/stock-transfer-settlements?')).toBe(true);
    const search = params(path);
    expect(search.get('companyId')).toBe(COMPANY_ID);
    expect(search.get('branchId')).toBe(BRANCH_ID);
    expect(search.get('kind')).toBe('write_off');
    expect(search.get('status')).toBe('pending');
  });

  it('adjustments send a status only when one is chosen', async () => {
    get.mockResolvedValue(ok(EMPTY_PAGE));
    await listAdjustments(TARGET, 'pending');
    await listAdjustments(TARGET, null);
    expect(params(String(get.mock.calls[0]?.[0])).get('status')).toBe('pending');
    expect(params(String(get.mock.calls[1]?.[0])).has('status')).toBe(false);
  });

  it('the cost history names the item in the path and the branch as its target', async () => {
    get.mockResolvedValue(ok({}));
    await readItemCostHistory(ITEM_ID, TARGET);
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith(`/api/v1/items/${ITEM_ID}/cost-history?`)).toBe(true);
    expect(params(path).get('branchId')).toBe(BRANCH_ID);
  });

  it('a receipt and a count are read by their own identifier alone', async () => {
    get.mockResolvedValue(ok({}));
    await readGoodsReceipt(RECEIPT_ID);
    await readStockCount(COUNT_ID);
    expect(get.mock.calls[0]?.[0]).toBe(`/api/v1/goods-receipts/${RECEIPT_ID}`);
    expect(get.mock.calls[1]?.[0]).toBe(`/api/v1/stock-counts/${COUNT_ID}`);
  });

  it('a refused list is a refusal, never an empty branch', async () => {
    get.mockResolvedValue(refused('forbidden'));
    const state = await listTransfers(TARGET, 'outbound');
    expect(state.status).toBe('denied');
  });
});

describe('the writes send what was typed, to the right place', () => {
  it('a transfer sends its body key and the quantity string', async () => {
    send.mockResolvedValue(ok({ id: TRANSFER_ID, replayed: false }));
    const body = {
      itemId: ITEM_ID,
      fromLocationId: LOCATION_ID,
      toLocationId: COUNT_ID,
      quantity: '2.500',
      idempotencyKey: 'form-key',
    };
    const outcome = await createTransfer(body);
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/stock-transfers', body, {});
    expect(outcome.state.status).toBe('success');
    expect(outcome.created).toEqual({ id: TRANSFER_ID, replayed: false });
  });

  it('a receipt of part of a transfer sends only the quantity that arrived', async () => {
    send.mockResolvedValue(ok({ id: TRANSFER_ID, status: 'partially_received' }));
    await receiveTransfer(TRANSFER_ID, { quantity: '1.000' });
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/stock-transfers/${TRANSFER_ID}/receipt`,
      { quantity: '1.000' },
      {}
    );
  });

  it('a discrepancy settlement re-presents the key its form holds', async () => {
    send.mockResolvedValue(ok({ id: 's-1', status: 'pending' }));
    const body = { kind: 'write_off' as const, quantity: '1.000', reason: 'Lost on the way' };
    const first = await resolveTransferDiscrepancy(TRANSFER_ID, body, 'settle-key');
    await resolveTransferDiscrepancy(TRANSFER_ID, body, 'settle-key');
    expect(send.mock.calls[0]).toEqual([
      'POST',
      `/api/v1/stock-transfers/${TRANSFER_ID}/discrepancy-resolution`,
      body,
      { idempotencyKey: 'settle-key' },
    ]);
    expect(send.mock.calls[1]?.[3]).toEqual({ idempotencyKey: 'settle-key' });
    expect(first.state.messageKey).toBe('inventory.transfers.resolve.writeOffRequested');
  });

  it('cancelling a transfer and a count sends the reason', async () => {
    send.mockResolvedValue(ok({}));
    await cancelTransfer(TRANSFER_ID, { reason: 'Sent by mistake' });
    await cancelStockCount(COUNT_ID, { reason: 'Started on the wrong shelf' });
    expect(send.mock.calls[0]?.[1]).toBe(`/api/v1/stock-transfers/${TRANSFER_ID}/cancellation`);
    expect(send.mock.calls[1]?.[1]).toBe(`/api/v1/stock-counts/${COUNT_ID}/cancellation`);
    expect(send.mock.calls[1]?.[2]).toEqual({ reason: 'Started on the wrong shelf' });
  });

  it('a goods receipt sends its lines with costs as strings', async () => {
    send.mockResolvedValue(ok({ id: RECEIPT_ID }));
    const body = {
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      receivedOn: '2026-09-17',
      idempotencyKey: 'receipt-key',
      lines: [
        {
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: '4.000',
          unitCost: '12.5000',
          currencyCode: 'USD',
        },
      ],
    };
    await createGoodsReceipt(body);
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/goods-receipts', body, {});
  });

  it('posting a receipt sends no body and the version it was handed as If-Match', async () => {
    send.mockResolvedValue(ok({ id: RECEIPT_ID, status: 'posted' }));
    const outcome = await postGoodsReceipt(RECEIPT_ID, 3);
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/goods-receipts/${RECEIPT_ID}/posting`,
      undefined,
      { ifMatch: 3 }
    );
    expect(outcome.state.messageKey).toBe('inventory.receipts.post.success');
  });

  it('recording a counted line is a PUT carrying the count version as If-Match', async () => {
    send.mockResolvedValue(ok({ id: COUNT_ID }));
    await recordStockCountLine(COUNT_ID, ITEM_ID, { countedQty: '0' }, 7);
    expect(send).toHaveBeenCalledWith(
      'PUT',
      `/api/v1/stock-counts/${COUNT_ID}/lines/${ITEM_ID}`,
      { countedQty: '0' },
      { ifMatch: 7 }
    );
  });

  it('opening and reconciling a count, and requesting and deciding an adjustment', async () => {
    send.mockResolvedValue(ok({}));
    await openStockCount({ locationId: LOCATION_ID, idempotencyKey: 'count-key' });
    await reconcileStockCount(COUNT_ID);
    await createAdjustment({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      direction: 'out',
      quantity: '1.000',
      reason: 'Broken on the shelf',
    });
    const decided = await decideAdjustment(ADJUSTMENT_ID, {
      decision: 'rejected',
      reason: 'Found on another shelf',
    });
    expect(send.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['POST', '/api/v1/stock-counts'],
      ['POST', `/api/v1/stock-counts/${COUNT_ID}/reconciliation`],
      ['POST', '/api/v1/stock-adjustments'],
      ['POST', `/api/v1/stock-adjustments/${ADJUSTMENT_ID}/approval`],
    ]);
    expect(send.mock.calls[1]?.[2]).toBeUndefined();
    expect(decided.state.messageKey).toBe('inventory.adjustments.decide.rejected');
  });

  it('deciding a write-off posts the decision and reason to the settlement, with no version', async () => {
    send.mockResolvedValue(ok({ id: TRANSFER_ID }));
    const outcome = await decideTransferWriteOff(TRANSFER_ID, {
      decision: 'rejected',
      reason: 'Found at the dock',
    });
    expect(send.mock.calls[0]).toEqual([
      'POST',
      `/api/v1/stock-transfer-settlements/${TRANSFER_ID}/decision`,
      { decision: 'rejected', reason: 'Found at the dock' },
      {},
    ]);
    expect(outcome.state.messageKey).toBe('inventory.transfers.writeOffs.decide.rejected');
    expect(EN['inventory.transfers.writeOffs.decide.rejected']).toBeTruthy();
    expect(AR['inventory.transfers.writeOffs.decide.rejected']).toBeTruthy();
  });

  it('an ended session is reported before any request is made', async () => {
    authorizedClient.mockResolvedValue(null);
    const outcome = await postGoodsReceipt(RECEIPT_ID, 1);
    expect(outcome.state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('a refusal is said by its reason', () => {
  it.each(MATERIAL_DRAW_REASONS)(
    'a work-order draw refused for %s names that reason, in both languages',
    async (reason) => {
      send.mockResolvedValue(
        refused('conflict', {
          code: 'ERR-INV-001',
          materialDraw: {
            allowance: '2.000',
            alreadyCommitted: '2.000',
            requested: '1.000',
            reason,
          },
        })
      );
      const reserve = await createReservation({
        itemId: ITEM_ID,
        locationId: LOCATION_ID,
        quantity: '1.000',
      });
      const key = `inventory.refusal.materialDraw.${reason}`;
      expect(reserve.state.status).toBe('conflict');
      expect(reserve.state.messageKey).toBe(key);
      expect(EN[key]).toBeTruthy();
      expect(AR[key]).toBeTruthy();
    }
  );

  it('an issue refused by its material requirement is said the same way', async () => {
    send.mockResolvedValue(
      refused('conflict', {
        code: 'ERR-INV-001',
        materialDraw: {
          allowance: null,
          alreadyCommitted: '0',
          requested: null,
          reason: 'no_requirement',
        },
      })
    );
    const outcome = await createIssue({
      workOrderId: COUNT_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '1.000',
    });
    expect(outcome.state.messageKey).toBe('inventory.refusal.materialDraw.no_requirement');
  });

  it('a state refusal names the act it refused', async () => {
    send.mockResolvedValue(refused('conflict', { code: 'ERR-TRN-001' }));
    const receive = await receiveTransfer(TRANSFER_ID, { quantity: '9.000' });
    const decide = await decideAdjustment(ADJUSTMENT_ID, { decision: 'approved', reason: 'ok' });
    const post = await postGoodsReceipt(RECEIPT_ID, 2);
    const record = await recordStockCountLine(COUNT_ID, ITEM_ID, { countedQty: '1' }, 2);
    expect(receive.state.messageKey).toBe('inventory.transfers.receive.refused');
    expect(decide.state.messageKey).toBe('inventory.adjustments.decide.refused');
    expect(post.state.messageKey).toBe('inventory.receipts.post.refused');
    expect(record.state.messageKey).toBe('inventory.counts.closed');
    expect(receive.state.correlationId).toBe('corr-1');
  });

  it('a stale version keeps the concurrency sentence', async () => {
    send.mockResolvedValue(refused('conflict', { code: 'ERR-CON-001' }));
    const post = await postGoodsReceipt(RECEIPT_ID, 2);
    expect(post.state.messageKey).toBe('state.conflict.title');
  });

  it('a specific violation the server stated is not replaced', async () => {
    send.mockResolvedValue(
      refused('conflict', {
        code: 'ERR-TRN-001',
        violations: [{ path: 'path.transferId', rule: 'duplicate_opening_cell' }],
      })
    );
    const outcome = await cancelTransfer(TRANSFER_ID, { reason: 'x' });
    expect(outcome.state.messageKey?.startsWith('form.violation.')).toBe(true);
  });

  it('an unknown draw reason falls back to the conflict sentence rather than a missing key', async () => {
    send.mockResolvedValue(
      refused('conflict', {
        code: 'ERR-INV-001',
        materialDraw: { allowance: null, alreadyCommitted: '0', requested: null, reason: 'other' },
      })
    );
    const outcome = await createReservation({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '1.000',
    });
    expect(outcome.state.messageKey).toBe('state.conflict.blocked.title');
  });
});
