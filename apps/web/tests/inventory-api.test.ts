import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The inventory ADAPTERS (P1-30, `W4`).
 *
 * The DOM tests mock this module wholesale and the backend proof calls the
 * routes directly, so neither says what request an adapter builds. That is
 * asserted HERE, with only the transport mocked.
 *
 * The properties this file protects: the item search asserts no scope; every
 * stock read is addressed to its branch TARGET and to nothing else; the
 * reservation writes send quantities as the strings they were typed, and pass
 * `replayed` through so the screen can tell a fresh booking from a repeat.
 * (W5) The per-work-order reads name the parent and no scope; the ledger read
 * carries the target and full instants; the issue and return writes send the
 * body as typed, and the transport's own contract table marks both as
 * idempotent so a key is attached to every send. (W10) The opening-batch list
 * is branch-targeted and the batch read names the batch alone; a repeated line
 * for the same counted cell is a conflict rather than a second line.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const {
  approveOpeningBatch,
  createIssue,
  createItem,
  createItemCategory,
  createOpeningBatch,
  createOpeningBatchLine,
  createReservation,
  createReturn,
  createStockLocation,
  listAvailability,
  listBranches,
  listItemCategories,
  listItems,
  listLocations,
  listMovements,
  listOpeningBatches,
  listPartIssues,
  listRequiredParts,
  listReservations,
  listUnitsOfMeasure,
  readOpeningBatch,
  releaseReservation,
} = await import('@/features/inventory/api');
const { requiresIdempotencyKey, resolveOperation } = await import('@/lib/api/operation-contract');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const RESERVATION_ID = '55555555-5555-4555-8555-555555555555';
const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const BATCH_ID = '88888888-8888-4888-8888-888888888888';

const TARGET = { companyId: COMPANY_ID, branchId: BRANCH_ID };
const REQUEST = { pageSize: 25 } as never;
const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });
const params = (path: string) => new URLSearchParams(path.slice(path.indexOf('?')));

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('the item search is tenant-wide and asserts no scope', () => {
  it('sends the criteria, the page size and the cursor, and no company or branch', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: 'c2', hasMore: true }));
    const page = await listItems(
      { search: 'brake', itemType: 'part', stockTrackedOnly: 'true', lifecycleStatus: 'archived' },
      REQUEST,
      'c1'
    );
    expect(page.status).toBe('ok');
    expect(page.nextCursor).toBe('c2');
    expect(page.hasMore).toBe(true);
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/items?')).toBe(true);
    const search = params(path);
    expect(search.get('search')).toBe('brake');
    expect(search.get('itemType')).toBe('part');
    expect(search.get('stockTrackedOnly')).toBe('true');
    expect(search.get('lifecycleStatus')).toBe('archived');
    expect(search.get('limit')).toBe('25');
    expect(search.get('cursor')).toBe('c1');
    expect(search.has('companyId')).toBe(false);
    expect(search.has('branchId')).toBe(false);
    expect(search.has('tenantId')).toBe(false);
  });

  it('omits every unset criterion rather than sending it empty', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listItems({}, REQUEST, null);
    const search = params(String(get.mock.calls[0]?.[0]));
    expect([...search.keys()].sort()).toEqual(['limit']);
  });

  it('a refusal is a refusal, never an empty catalogue', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const page = await listItems({}, REQUEST, null);
    expect(page.status).toBe('denied');
    expect(page.rows).toEqual([]);
    expect(page.correlationId).toBe('corr-1');
  });

  it('an ended session is reported before any request is made', async () => {
    authorizedClient.mockResolvedValue(null);
    const page = await listItems({}, REQUEST, null);
    expect(page.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('every stock read is addressed to its branch target', () => {
  it('availability carries the target, the filters and the quarantine choice', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listAvailability(
      TARGET,
      { itemId: ITEM_ID, locationId: LOCATION_ID, includeQuarantine: 'true' },
      REQUEST,
      null
    );
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/stock-availability?')).toBe(true);
    const search = params(path);
    expect(search.get('companyId')).toBe(COMPANY_ID);
    expect(search.get('branchId')).toBe(BRANCH_ID);
    expect(search.get('itemId')).toBe(ITEM_ID);
    expect(search.get('locationId')).toBe(LOCATION_ID);
    expect(search.get('includeQuarantine')).toBe('true');
    expect(search.get('limit')).toBe('25');
  });

  it('availability without the quarantine choice sends nothing for it, so the route excludes quarantine', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listAvailability(TARGET, {}, REQUEST, null);
    const search = params(String(get.mock.calls[0]?.[0]));
    expect(search.has('includeQuarantine')).toBe(false);
    expect([...search.keys()].sort()).toEqual(['branchId', 'companyId', 'limit']);
  });

  it('passes the three quantities through as the strings they arrived as', async () => {
    const cell = {
      itemId: ITEM_ID,
      sku: 'BRK-001',
      locationId: LOCATION_ID,
      locationCode: 'WH-1',
      locationType: 'warehouse',
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      onHand: '12.500',
      reserved: '2.000',
      available: '10.500',
    };
    get.mockResolvedValue(ok({ items: [cell], nextCursor: null, hasMore: false }));
    const page = await listAvailability(TARGET, {}, REQUEST, null);
    expect(page.rows[0]).toEqual(cell);
    expect(typeof page.rows[0]?.onHand).toBe('string');
    expect(typeof page.rows[0]?.available).toBe('string');
  });

  it('reservations carry the target, the status and the work order', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listReservations(
      TARGET,
      { status: 'active', workOrderId: WORK_ORDER_ID, itemId: ITEM_ID },
      REQUEST,
      'c9'
    );
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/stock-reservations?')).toBe(true);
    const search = params(path);
    expect(search.get('companyId')).toBe(COMPANY_ID);
    expect(search.get('branchId')).toBe(BRANCH_ID);
    expect(search.get('status')).toBe('active');
    expect(search.get('workOrderId')).toBe(WORK_ORDER_ID);
    expect(search.get('itemId')).toBe(ITEM_ID);
    expect(search.get('cursor')).toBe('c9');
  });

  it('locations are read one page at the route maximum, with the target', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: true }));
    const state = await listLocations(TARGET);
    expect(state.status).toBe('ok');
    if (state.status === 'ok') expect(state.data.hasMore).toBe(true);
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/stock-locations?')).toBe(true);
    const search = params(path);
    expect(search.get('companyId')).toBe(COMPANY_ID);
    expect(search.get('branchId')).toBe(BRANCH_ID);
    expect(search.get('limit')).toBe('100');
  });

  it('a refused stock read is a refusal with its reference', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const page = await listReservations(TARGET, {}, REQUEST, null);
    expect(page.status).toBe('denied');
    expect(page.correlationId).toBe('corr-1');
    const locations = await listLocations(TARGET);
    expect(locations.status).toBe('denied');
  });

  it('the branch list is its own read', async () => {
    get.mockResolvedValue(ok({ items: [] }));
    const state = await listBranches();
    expect(state.status).toBe('ok');
    expect(String(get.mock.calls[0]?.[0])).toBe('/api/v1/org/branches');
  });
});

describe('the reservation writes', () => {
  it('reserves with the quantity as the string it was typed, and reports a fresh booking', async () => {
    const echo = {
      id: RESERVATION_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      workOrderId: WORK_ORDER_ID,
      quantity: '2.500',
      status: 'active',
      expiresAt: null,
      recordVersion: 1,
      replayed: false,
    };
    send.mockResolvedValue(ok(echo));
    const outcome = await createReservation({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2.5',
      workOrderId: WORK_ORDER_ID,
      idempotencyKey: '99999999-9999-4999-8999-999999999999',
    });
    expect(outcome.state.status).toBe('success');
    expect(outcome.state.messageKey).toBe('inventory.reserve.success');
    expect(outcome.created).toEqual(echo);
    const [method, path, body, options] = send.mock.calls[0] as unknown[];
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/stock-reservations');
    expect(body).toEqual({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2.5',
      workOrderId: WORK_ORDER_ID,
      idempotencyKey: '99999999-9999-4999-8999-999999999999',
    });
    expect(typeof (body as { quantity: unknown }).quantity).toBe('string');
    // No version guard exists on any inventory write.
    expect(options).toBeUndefined();
  });

  it('passes a replay through as a replay, never as a second booking', async () => {
    send.mockResolvedValue(ok({ id: RESERVATION_ID, quantity: '2.500', replayed: true }));
    const outcome = await createReservation({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2.5',
    });
    expect(outcome.state.status).toBe('success');
    expect(outcome.created?.replayed).toBe(true);
  });

  it('a refused reservation is a refusal with its reference and nothing created', async () => {
    send.mockResolvedValue(failure('forbidden'));
    const outcome = await createReservation({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2.5',
    });
    expect(outcome.state.status).toBe('denied');
    expect(outcome.state.correlationId).toBe('corr-1');
    expect(outcome.created).toBeNull();
  });

  it('releases by reservation id with the reason body and no version', async () => {
    send.mockResolvedValue(ok({ id: RESERVATION_ID, status: 'released', replayed: false }));
    const outcome = await releaseReservation(RESERVATION_ID, { reason: 'customer declined' });
    expect(outcome.state.status).toBe('success');
    expect(outcome.state.messageKey).toBe('inventory.release.success');
    const [method, path, body, options] = send.mock.calls[0] as unknown[];
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/stock-reservations/${RESERVATION_ID}/release`);
    expect(body).toEqual({ reason: 'customer declined' });
    expect(options).toBeUndefined();
  });

  it('a release of a reservation already ended is reported as a replay', async () => {
    send.mockResolvedValue(ok({ id: RESERVATION_ID, status: 'released', replayed: true }));
    const outcome = await releaseReservation(RESERVATION_ID, {});
    expect(outcome.created?.replayed).toBe(true);
  });

  it('an ended session is reported before any write is sent', async () => {
    authorizedClient.mockResolvedValue(null);
    const reserved = await createReservation({
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '1',
    });
    const released = await releaseReservation(RESERVATION_ID, {});
    expect(reserved.state.status).toBe('expired');
    expect(released.state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('W5 — the parts of a work order name the parent and no scope', () => {
  it('lists part issues under the work order with the page size and the cursor', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: 'c2', hasMore: true }));
    const page = await listPartIssues(WORK_ORDER_ID, REQUEST, 'c1');
    expect(page.status).toBe('ok');
    expect(page.hasMore).toBe(true);
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith(`/api/v1/work-orders/${WORK_ORDER_ID}/part-issues?`)).toBe(true);
    const search = params(path);
    expect(search.get('limit')).toBe('25');
    expect(search.get('cursor')).toBe('c1');
    expect(search.has('companyId')).toBe(false);
    expect(search.has('branchId')).toBe(false);
  });

  it('passes quantity and returnedQty through as the strings they arrived as', async () => {
    const row = {
      id: 'pi-1',
      workOrderId: WORK_ORDER_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      itemId: ITEM_ID,
      sku: 'BRK-001',
      locationId: LOCATION_ID,
      locationCode: 'WH-1',
      reservationId: null,
      quantity: '2.500',
      returnedQty: '1.000',
      issuedAt: '2026-09-01T09:00:00Z',
    };
    get.mockResolvedValue(ok({ items: [row], nextCursor: null, hasMore: false }));
    const page = await listPartIssues(WORK_ORDER_ID, REQUEST, null);
    expect(page.rows[0]).toEqual(row);
    expect(typeof page.rows[0]?.returnedQty).toBe('string');
  });

  it('reads the required parts under the work order, with no query', async () => {
    get.mockResolvedValue(ok({ items: [] }));
    const state = await listRequiredParts(WORK_ORDER_ID);
    expect(state.status).toBe('ok');
    expect(String(get.mock.calls[0]?.[0])).toBe(
      `/api/v1/work-orders/${WORK_ORDER_ID}/required-parts`
    );
  });

  it('a refused list is a refusal with its reference', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const page = await listPartIssues(WORK_ORDER_ID, REQUEST, null);
    expect(page.status).toBe('denied');
    expect(page.correlationId).toBe('corr-1');
  });
});

describe('W5 — the ledger is addressed to its branch, with full instants', () => {
  it('carries the target, every filter, and the instants untouched', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listMovements(
      TARGET,
      {
        itemId: ITEM_ID,
        locationId: LOCATION_ID,
        workOrderId: WORK_ORDER_ID,
        movementType: 'issue',
        referenceKind: 'part_issue',
        occurredFrom: '2026-09-01T08:00:00.000Z',
        occurredTo: '2026-09-02T08:00:00.000Z',
      },
      REQUEST,
      'c3'
    );
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/stock-movements?')).toBe(true);
    const search = params(path);
    expect(search.get('companyId')).toBe(COMPANY_ID);
    expect(search.get('branchId')).toBe(BRANCH_ID);
    expect(search.get('itemId')).toBe(ITEM_ID);
    expect(search.get('locationId')).toBe(LOCATION_ID);
    expect(search.get('workOrderId')).toBe(WORK_ORDER_ID);
    expect(search.get('movementType')).toBe('issue');
    expect(search.get('referenceKind')).toBe('part_issue');
    expect(search.get('occurredFrom')).toBe('2026-09-01T08:00:00.000Z');
    expect(search.get('occurredTo')).toBe('2026-09-02T08:00:00.000Z');
    expect(search.get('cursor')).toBe('c3');
    expect(search.get('limit')).toBe('25');
  });

  it('sends only the target when nothing is narrowed', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listMovements(TARGET, {}, REQUEST, null);
    const search = params(String(get.mock.calls[0]?.[0]));
    expect([...search.keys()].sort()).toEqual(['branchId', 'companyId', 'limit']);
  });

  it('passes sequence and the signed figure through as strings', async () => {
    const row = {
      id: 'm-1',
      sequence: '1042',
      itemId: ITEM_ID,
      sku: 'BRK-001',
      locationId: LOCATION_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      movementType: 'issue',
      direction: 'out',
      quantity: '2.500',
      signedQuantity: '-2.500',
      reference: { kind: 'part_issue', id: 'pi-1' },
      occurredAt: '2026-09-01T09:00:00Z',
      correlationId: null,
    };
    get.mockResolvedValue(ok({ items: [row], nextCursor: null, hasMore: false }));
    const page = await listMovements(TARGET, {}, REQUEST, null);
    expect(page.rows[0]).toEqual(row);
    expect(typeof page.rows[0]?.sequence).toBe('string');
    expect(typeof page.rows[0]?.signedQuantity).toBe('string');
  });
});

describe('W5 — issuing and returning carry a transport key and send the body as typed', () => {
  it('the transport contract marks both writes idempotent, so a key is attached to every send', () => {
    expect(resolveOperation('POST', '/api/v1/stock-issues')?.operationId).toBe(
      'inv.stock-issue-create'
    );
    expect(resolveOperation('POST', '/api/v1/stock-returns')?.operationId).toBe(
      'inv.stock-return-create'
    );
    expect(requiresIdempotencyKey('POST', '/api/v1/stock-issues')).toBe(true);
    expect(requiresIdempotencyKey('POST', '/api/v1/stock-returns')).toBe(true);
  });

  it('issues with the body as given and no version', async () => {
    const echo = {
      id: 'pi-9',
      movementId: 'm-9',
      workOrderId: WORK_ORDER_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      quantity: '2.500',
      reservationId: RESERVATION_ID,
    };
    send.mockResolvedValue(ok(echo));
    const outcome = await createIssue({
      workOrderId: WORK_ORDER_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2.5',
      reservationId: RESERVATION_ID,
      requiredPartRef: '88888888-8888-4888-8888-888888888888',
    });
    expect(outcome.state.status).toBe('success');
    expect(outcome.state.messageKey).toBe('inventory.issue.success');
    expect(outcome.created).toEqual(echo);
    const [method, path, body, options] = send.mock.calls[0] as unknown[];
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/stock-issues');
    expect(body).toEqual({
      workOrderId: WORK_ORDER_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '2.5',
      reservationId: RESERVATION_ID,
      requiredPartRef: '88888888-8888-4888-8888-888888888888',
    });
    expect(typeof (body as { quantity: unknown }).quantity).toBe('string');
    expect(options).toBeUndefined();
  });

  it('a refused issue (an over-issue is a conflict) is a refusal with its reference and nothing created', async () => {
    send.mockResolvedValue(failure('conflict'));
    const outcome = await createIssue({
      workOrderId: WORK_ORDER_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '9',
    });
    expect(outcome.state.status).not.toBe('success');
    expect(outcome.state.correlationId).toBe('corr-1');
    expect(outcome.created).toBeNull();
  });

  it('returns against the issue only, with the running figures passed through as strings', async () => {
    const echo = {
      id: 'ret-1',
      partIssueId: 'pi-9',
      quantity: '1.000',
      totalReturned: '1.000',
      issuedQuantity: '2.500',
    };
    send.mockResolvedValue(ok(echo));
    const outcome = await createReturn({ partIssueId: 'pi-9', quantity: '1', reason: 'unused' });
    expect(outcome.state.status).toBe('success');
    expect(outcome.state.messageKey).toBe('inventory.return.success');
    expect(outcome.created).toEqual(echo);
    expect(typeof outcome.created?.totalReturned).toBe('string');
    const [method, path, body, options] = send.mock.calls[0] as unknown[];
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/stock-returns');
    expect(body).toEqual({ partIssueId: 'pi-9', quantity: '1', reason: 'unused' });
    expect(options).toBeUndefined();
  });

  it('an ended session is reported before any write is sent', async () => {
    authorizedClient.mockResolvedValue(null);
    const issued = await createIssue({
      workOrderId: WORK_ORDER_ID,
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '1',
    });
    const returned = await createReturn({ partIssueId: 'pi-9', quantity: '1' });
    expect(issued.state.status).toBe('expired');
    expect(returned.state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('W10 — the setup reads are tenant-wide and assert no scope', () => {
  it('lists the categories in one page of a hundred, and the units with no query', async () => {
    get.mockResolvedValueOnce(ok({ items: [], nextCursor: null, hasMore: false }));
    const categories = await listItemCategories();
    expect(categories.status).toBe('ok');
    expect(String(get.mock.calls[0]?.[0])).toBe('/api/v1/item-categories?limit=100');

    get.mockResolvedValueOnce(ok({ items: [] }));
    const units = await listUnitsOfMeasure();
    expect(units.status).toBe('ok');
    expect(String(get.mock.calls[1]?.[0])).toBe('/api/v1/units-of-measure');
  });

  it('reports a refused read as denied, not as an empty catalogue', async () => {
    get.mockResolvedValue(failure('forbidden'));
    expect((await listItemCategories()).status).toBe('denied');
    expect((await listUnitsOfMeasure()).status).toBe('denied');
  });

  it('resolves every W10 write to a published idempotent operation', () => {
    expect(resolveOperation('POST', '/api/v1/item-categories')?.operationId).toBe(
      'inv.item-category-create'
    );
    expect(resolveOperation('POST', '/api/v1/items')?.operationId).toBe('inv.item-create');
    expect(resolveOperation('POST', '/api/v1/stock-locations')?.operationId).toBe(
      'inv.stock-location-create'
    );
    expect(resolveOperation('POST', '/api/v1/opening-inventory-batches')?.operationId).toBe(
      'inv.opening-batch-create'
    );
    expect(
      resolveOperation('POST', `/api/v1/opening-inventory-batches/${BATCH_ID}/lines`)?.operationId
    ).toBe('inv.opening-batch-line-create');
    expect(
      resolveOperation('POST', `/api/v1/opening-inventory-batches/${BATCH_ID}/approval`)
        ?.operationId
    ).toBe('inv.opening-batch-approve');
    for (const path of [
      '/api/v1/item-categories',
      '/api/v1/items',
      '/api/v1/stock-locations',
      '/api/v1/opening-inventory-batches',
      `/api/v1/opening-inventory-batches/${BATCH_ID}/approval`,
    ]) {
      expect(requiresIdempotencyKey('POST', path)).toBe(true);
    }
    // The line create is published WITHOUT an idempotency key, and that is a
    // DECISION (P1-30 CC-18), not a gap this suite should paper over. What the
    // sentence here used to claim — that a repeated request adds a second line
    // — was false: `uq_opening_inventory_lines_cell` allows one live line per
    // (item, location) inside a batch, so a repeat of the same counted cell is
    // refused by the index and answers `409` since the mapping landed. Only a
    // genuinely different cell adds a line, which is a different count rather
    // than a replay. A key would add no guarantee and no correction path, so
    // none is published and the transport attaches none.
    expect(
      requiresIdempotencyKey('POST', `/api/v1/opening-inventory-batches/${BATCH_ID}/lines`)
    ).toBe(false);
  });
});

describe('W10 — the setup writes send the body as given and state the outcome', () => {
  it('creates a category, an item and a location at their routes with the body untouched', async () => {
    send.mockResolvedValueOnce(ok({ id: 'cat-1', code: 'brakes' }));
    const category = await createItemCategory({ code: 'brakes', name: 'Brakes' });
    expect(category.state.status).toBe('success');
    expect(category.state.messageKey).toBe('inventory.setup.category.success');
    expect(category.created).toEqual({ id: 'cat-1', code: 'brakes' });
    expect(send.mock.calls[0]).toEqual([
      'POST',
      '/api/v1/item-categories',
      { code: 'brakes', name: 'Brakes' },
    ]);

    send.mockResolvedValueOnce(ok({ id: ITEM_ID, sku: 'BRK-001' }));
    const body = {
      itemCategoryId: 'cat-1',
      sku: 'BRK-001',
      name: 'Brake pad',
      uomId: 'u-1',
      itemType: 'part' as const,
      isStockTracked: true,
      isSerialized: false,
    };
    const item = await createItem(body);
    expect(item.state.messageKey).toBe('inventory.setup.item.success');
    expect(send.mock.calls[1]).toEqual(['POST', '/api/v1/items', body]);

    send.mockResolvedValueOnce(ok({ id: LOCATION_ID, locationCode: 'WH-1' }));
    const location = await createStockLocation({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      locationCode: 'WH-1',
      name: 'Main',
      locationType: 'warehouse',
    });
    expect(location.state.messageKey).toBe('inventory.setup.location.success');
    expect(send.mock.calls[2]?.[1]).toBe('/api/v1/stock-locations');
  });

  it('a refused write is a refusal with its correlation reference, and nothing created', async () => {
    send.mockResolvedValue({
      ok: false as const,
      kind: 'validation',
      correlationId: 'corr-9',
      problem: { violations: [{ path: 'body.parentCategoryId', rule: 'unknown_category' }] },
    });
    const outcome = await createItemCategory({ code: 'pads', name: 'Pads' });
    expect(outcome.created).toBeNull();
    expect(outcome.state.status).toBe('invalid');
    expect(outcome.state.correlationId).toBe('corr-9');
    expect(outcome.state.fieldErrors).toEqual({
      parentCategoryId: 'form.violation.unknown_category',
    });
  });

  it('an expired session is reported as expired before any request', async () => {
    authorizedClient.mockResolvedValue(null);
    const outcome = await createItem({
      itemCategoryId: 'cat-1',
      sku: 'X',
      name: 'x',
      uomId: 'u',
      itemType: 'part',
    });
    expect(outcome.state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('W10 — the opening batch is opened, lined and approved at its own routes', () => {
  it('opens the batch and adds a line with the quantity as a string', async () => {
    send.mockResolvedValueOnce(ok({ id: BATCH_ID, status: 'draft' }));
    const batch = await createOpeningBatch({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      batchCode: 'OPEN-1',
      asOfDate: '2026-09-06',
    });
    expect(batch.state.messageKey).toBe('inventory.opening.batch.success');
    expect(send.mock.calls[0]?.[1]).toBe('/api/v1/opening-inventory-batches');

    send.mockResolvedValueOnce(ok({ id: 'line-1', quantity: '12.000' }));
    const line = await createOpeningBatchLine(BATCH_ID, {
      itemId: ITEM_ID,
      locationId: LOCATION_ID,
      quantity: '12.000',
    });
    expect(line.state.messageKey).toBe('inventory.opening.line.success');
    expect(send.mock.calls[1]).toEqual([
      'POST',
      `/api/v1/opening-inventory-batches/${BATCH_ID}/lines`,
      { itemId: ITEM_ID, locationId: LOCATION_ID, quantity: '12.000' },
    ]);
  });

  it('approves with no body — the batch is in the path and the approver is the caller', async () => {
    send.mockResolvedValueOnce(ok({ id: BATCH_ID, status: 'approved' }));
    const outcome = await approveOpeningBatch(BATCH_ID);
    expect(outcome.state.messageKey).toBe('inventory.opening.approve.success');
    expect(send.mock.calls[0]).toEqual([
      'POST',
      `/api/v1/opening-inventory-batches/${BATCH_ID}/approval`,
      undefined,
    ]);
  });

  it('the counter approving is a conflict, stated as one', async () => {
    send.mockResolvedValue(failure('conflict'));
    const outcome = await approveOpeningBatch(BATCH_ID);
    expect(outcome.created).toBeNull();
    expect(outcome.state.status).toBe('conflict');
  });

  /**
   * The route's OTHER refusal, and the seam that made it unreadable.
   *
   * `uq_stock_movements_opening_cell` allows one approved `opening` movement per
   * (item, location) in a branch, so approving a second batch that counts a cell
   * already opened is refused. It arrives as `ERR-RES-002` carrying
   * `path.batchId` + `duplicate_opening_cell`, and that violation is the ONLY
   * statement of the reason on the wire: `problemFor` never reads the failure's
   * own message, which a hosted run measured as absent.
   *
   * The DOM suite mocks this module, so this case is what makes its fixture
   * honest — the state asserted there is the state produced here, from the body
   * the API really sends.
   */
  it('a cell the branch already opened is refused with its reason, not a bare conflict', async () => {
    send.mockResolvedValue({
      ok: false as const,
      kind: 'conflict' as const,
      status: 409,
      problem: {
        type: 'urn:rootlco:error:ERR-RES-002',
        title: 'Resource already exists',
        status: 409,
        code: 'ERR-RES-002',
        correlationId: 'corr-1',
        violations: [{ path: 'path.batchId', rule: 'duplicate_opening_cell' }],
      },
      correlationId: 'corr-1',
    });
    const outcome = await approveOpeningBatch(BATCH_ID);
    expect(outcome.created).toBeNull();
    expect(outcome.state.status).toBe('conflict');
    expect(outcome.state.messageKey).toBe('form.violation.duplicate_opening_cell');
    // The batch identifier is a segment of the address, not a box on a form —
    // the approval sends no body at all — so nothing is filed under a control.
    expect(outcome.state.fieldErrors).toBeUndefined();
  });

  /**
   * What a REPEATED line request actually does — the assertion this suite owed.
   *
   * `uq_opening_inventory_lines_cell` allows one live line per (item, location)
   * inside a batch, so sending the same cell twice does not add a second line:
   * the index refuses it and the route answers `409`, which reaches the adapter
   * as `conflict` and creates nothing. The screen therefore has something true
   * to say, rather than a duplicate it would have to explain afterwards.
   */
  it('a repeated line for the same counted cell is refused as a conflict, not added twice', async () => {
    const cell = { itemId: ITEM_ID, locationId: LOCATION_ID, quantity: '12.000' };
    send.mockResolvedValueOnce(ok({ id: 'line-1', batchId: BATCH_ID, ...cell }));
    const first = await createOpeningBatchLine(BATCH_ID, cell);
    expect(first.state.status).toBe('success');
    expect(first.created).toEqual({ id: 'line-1', batchId: BATCH_ID, ...cell });

    send.mockResolvedValueOnce(failure('conflict'));
    const again = await createOpeningBatchLine(BATCH_ID, cell);
    expect(again.state.status).toBe('conflict');
    expect(again.created).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('W10 — the batch reads are what make a batch reachable again', () => {
  it('lists one branch batches at the branch target with a page limit and no other filter', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    const state = await listOpeningBatches(TARGET);
    expect(state.status).toBe('ok');
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/opening-inventory-batches?')).toBe(true);
    const sent = params(path);
    expect(sent.get('companyId')).toBe(COMPANY_ID);
    expect(sent.get('branchId')).toBe(BRANCH_ID);
    expect(sent.get('limit')).toBe('50');
    expect(sent.get('status')).toBeNull();
    expect(sent.get('cursor')).toBeNull();
  });

  it('reads one batch by id alone, and asserts no scope in the query', async () => {
    get.mockResolvedValue(
      ok({ batch: { id: BATCH_ID, status: 'draft' }, lines: [{ id: 'l-1', quantity: '12.000' }] })
    );
    const state = await readOpeningBatch(BATCH_ID);
    expect(state.status).toBe('ok');
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/opening-inventory-batches/${BATCH_ID}`);
  });

  it('passes the line quantities through as the strings the server sent', async () => {
    get.mockResolvedValue(
      ok({
        batch: { id: BATCH_ID, status: 'draft', lineCount: 1 },
        lines: [{ id: 'l-1', sku: 'BRK-001', locationCode: 'WH-1', quantity: '0.500' }],
      })
    );
    const state = await readOpeningBatch(BATCH_ID);
    expect(state.status === 'ok' && state.data.lines[0]?.quantity).toBe('0.500');
    expect(state.status === 'ok' && typeof state.data.lines[0]?.quantity).toBe('string');
  });

  it('reports a refused list as denied and a missing batch as not-found, never as an empty branch', async () => {
    get.mockResolvedValueOnce(failure('forbidden'));
    expect((await listOpeningBatches(TARGET)).status).toBe('denied');
    get.mockResolvedValueOnce(failure('not-found'));
    expect((await readOpeningBatch(BATCH_ID)).status).toBe('not-found');
  });

  it('an ended session is reported before either read is sent', async () => {
    authorizedClient.mockResolvedValue(null);
    expect((await listOpeningBatches(TARGET)).status).toBe('expired');
    expect((await readOpeningBatch(BATCH_ID)).status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});
