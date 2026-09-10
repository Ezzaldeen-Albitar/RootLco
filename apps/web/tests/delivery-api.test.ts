import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The delivery read ADAPTERS (P1-31).
 *
 * The rendering tests replace this module wholesale and the backend proof calls
 * the routes directly, so neither says what request an adapter builds. That is
 * asserted HERE, with only the transport replaced.
 *
 * The properties this file protects: every read names its delivery in the path
 * and reaches the operation the screen claims it does; the three paged reads
 * send the cursor they were given and no scope of their own; a refusal arrives
 * as a refusal rather than as an empty result; and this slice contains no write
 * at all.
 *
 * The ready-for-delivery queue (FE-001) is a separate module with a separate
 * contract and is asserted at the end of this file, because the branch pair it
 * carries and the page ceiling it respects belong to no other read here.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const adapters = await import('@/features/delivery/api');
const {
  listChecklistResults,
  listSignatures,
  listStatusHistory,
  readDelivery,
  readEligibility,
  readReceiver,
  readWorkOrderDelivery,
} = adapters;
const { PAGE_SIZE } = await import('@/features/delivery/delivery-contract');

const { listDeliveryReadiness, readDeliveryReadinessScopes } =
  await import('@/features/delivery/readiness-api');
const { MAX_READINESS_PAGE_SIZE, READINESS_PAGE_SIZE, readinessPageSize } =
  await import('@/features/delivery/readiness-contract');

const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const CURSOR = 'b3JkZXItY3Vyc29y';

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-9' });

const emptyPage = { items: [], nextCursor: null, hasMore: false };

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

/** The path the transport was asked for, as one string. */
const requested = () => String(get.mock.calls[0]?.[0]);

describe('every read names its delivery in the path', () => {
  it('reads the delivery record itself', async () => {
    get.mockResolvedValue(ok({ id: DELIVERY_ID, status: 'ready', recordVersion: 2 }));
    const state = await readDelivery(DELIVERY_ID);
    expect(state.status).toBe('ok');
    expect(requested()).toBe(`/api/v1/deliveries/${DELIVERY_ID}`);
  });

  it('reads the release checks under the delivery', async () => {
    get.mockResolvedValue(ok({ deliveryId: DELIVERY_ID, eligible: true, blockers: [] }));
    await readEligibility(DELIVERY_ID);
    expect(requested()).toBe(`/api/v1/deliveries/${DELIVERY_ID}/eligibility`);
  });

  it('reads the confirmed receiver under the delivery', async () => {
    get.mockResolvedValue(ok({ deliveryId: DELIVERY_ID, receiver: null }));
    const state = await readReceiver(DELIVERY_ID);
    expect(state.status).toBe('ok');
    // Absence is a 200 with nothing inside, never a 404 — the adapter passes
    // that through rather than turning it into a missing subject.
    if (state.status === 'ok') expect(state.data.receiver).toBeNull();
    expect(requested()).toBe(`/api/v1/deliveries/${DELIVERY_ID}/authorized-receiver`);
  });

  it('reads the live delivery of a work order under the WORK ORDER', async () => {
    get.mockResolvedValue(ok({ workOrderId: WORK_ORDER_ID, delivery: null }));
    const state = await readWorkOrderDelivery(WORK_ORDER_ID);
    expect(state.status).toBe('ok');
    if (state.status === 'ok') expect(state.data.delivery).toBeNull();
    expect(requested()).toBe(`/api/v1/work-orders/${WORK_ORDER_ID}/delivery`);
  });

  it('encodes the identifier it was handed rather than pasting it in', async () => {
    get.mockResolvedValue(ok({ id: 'x' }));
    await readDelivery('a/b c');
    expect(requested()).toBe('/api/v1/deliveries/a%2Fb%20c');
  });
});

describe('the paged reads send the cursor they were given, and a page size', () => {
  const paged = [
    ['signatures', listSignatures, 'signatures'],
    ['checklist results', listChecklistResults, 'checklist-results'],
    ['status history', listStatusHistory, 'status-history'],
  ] as const;

  it.each(paged)('%s: the first page carries no cursor', async (_name, read, segment) => {
    get.mockResolvedValue(ok({ deliveryId: DELIVERY_ID, items: emptyPage }));
    await read(DELIVERY_ID, null);
    expect(requested()).toBe(
      `/api/v1/deliveries/${DELIVERY_ID}/${segment}?limit=${String(PAGE_SIZE)}`
    );
  });

  it.each(paged)('%s: a further page carries the server’s cursor', async (_name, read, segment) => {
    get.mockResolvedValue(ok({ deliveryId: DELIVERY_ID, items: emptyPage }));
    await read(DELIVERY_ID, CURSOR);
    const path = requested();
    expect(path.startsWith(`/api/v1/deliveries/${DELIVERY_ID}/${segment}?`)).toBe(true);
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('cursor')).toBe(CURSOR);
    expect(query.get('limit')).toBe(String(PAGE_SIZE));
    // Scope is resolved from the session server-side. A client that asserted it
    // would at best be ignored and at worst believed.
    for (const name of ['companyId', 'branchId', 'tenantId']) {
      expect(query.get(name), name).toBeNull();
    }
  });
});

describe('a refusal arrives as a refusal, never as an empty result', () => {
  it('maps a forbidden read to a denial that carries the reference', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const state = await readEligibility(DELIVERY_ID);
    expect(state.status).toBe('denied');
    expect(state.correlationId).toBe('corr-9');
  });

  it('maps a missing subject to not-found rather than to an empty ledger', async () => {
    get.mockResolvedValue(failure('not-found'));
    const state = await listStatusHistory(DELIVERY_ID, null);
    expect(state.status).toBe('not-found');
  });

  it('maps an ended session to expired before any request is made', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const state = await readDelivery(DELIVERY_ID);
    expect(state.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });

  it('maps a rate limit to unavailable, because a 429 is not a fault', async () => {
    get.mockResolvedValue(failure('rate-limited'));
    const state = await listSignatures(DELIVERY_ID, null);
    expect(state.status).toBe('unavailable');
  });
});

describe('this slice reads and does not write', () => {
  it('exports seven adapters and no write path is exercised', async () => {
    const names = Object.keys(adapters).filter((name) => name !== 'default');
    expect(names.length).toBeGreaterThanOrEqual(7);
    get.mockResolvedValue(ok({}));
    for (const read of [
      () => readDelivery(DELIVERY_ID),
      () => readEligibility(DELIVERY_ID),
      () => readReceiver(DELIVERY_ID),
      () => readWorkOrderDelivery(WORK_ORDER_ID),
      () => listSignatures(DELIVERY_ID, null),
      () => listChecklistResults(DELIVERY_ID, null),
      () => listStatusHistory(DELIVERY_ID, null),
    ]) {
      await read();
    }
    expect(get).toHaveBeenCalledTimes(7);
    // Every write in this application goes through `send`. Nothing in this
    // feature calls it, and a future adapter that does will fail here first.
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * The ready-for-delivery queue adapter (P1-31, FE-001).
 *
 * A separate module from `api.ts` with a separate contract, so it gets its own
 * cases rather than being folded into the sweeps above: the branch pair it
 * carries is an authorization TARGET the other seven reads do not have, and the
 * page ceiling it respects belongs to no other operation in this feature.
 */
describe('the ready-for-delivery queue names its branch and respects the queue ceiling', () => {
  const emptyQueue = { items: [], nextCursor: null, hasMore: false };
  const request = {
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    cursor: null,
    limit: READINESS_PAGE_SIZE,
  };
  const companies = { items: [{ id: COMPANY_ID, legalName: 'Workshop company' }] };
  const branches = { items: [{ id: BRANCH_ID, companyId: COMPANY_ID, name: 'Service branch' }] };
  const requested = () =>
    String(
      get.mock.calls.find(([path]) => String(path).startsWith('/api/v1/delivery-readiness?'))?.[0]
    );
  function answerQueue(response: unknown) {
    get.mockImplementation(async (path: string) =>
      path === '/api/v1/org/companies'
        ? ok(companies)
        : path === '/api/v1/org/branches'
          ? ok(branches)
          : response
    );
  }

  it('addresses the queue operation and carries both halves of the branch target', async () => {
    answerQueue(ok(emptyQueue));
    const page = await listDeliveryReadiness({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      cursor: null,
      limit: READINESS_PAGE_SIZE,
    });
    expect(page.status).toBe('ok');
    const path = requested();
    expect(path.startsWith('/api/v1/delivery-readiness?')).toBe(true);
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    // The pair is the resource this queue is ABOUT and the target the backend
    // authorizes against. Omitting it degrades a branch-scoped check into a
    // scope-blind permission test.
    expect(query.get('companyId')).toBe(COMPANY_ID);
    expect(query.get('branchId')).toBe(BRANCH_ID);
    expect(query.get('limit')).toBe(String(READINESS_PAGE_SIZE));
    expect(query.get('cursor')).toBeNull();
    // No eligibility may be asserted by a request. The route publishes no such
    // parameter and this adapter must never invent one.
    for (const name of ['ready', 'readyToStartDelivery', 'eligible', 'tenantId']) {
      expect(query.get(name), name).toBeNull();
    }
  });

  it('sends the server’s own cursor back unchanged for a further page', async () => {
    answerQueue(ok(emptyQueue));
    await listDeliveryReadiness({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      cursor: CURSOR,
      limit: READINESS_PAGE_SIZE,
    });
    const path = requested();
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('cursor')).toBe(CURSOR);
  });

  it('never asks for more rows than the queue serves', async () => {
    // The table offers 100. The route REFUSES above its own ceiling rather than
    // clamping, so a request built from the table's number would be an error the
    // operator could not act on.
    answerQueue(ok(emptyQueue));
    await listDeliveryReadiness({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      cursor: null,
      limit: 100,
    });
    const path = requested();
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('limit')).toBe(String(MAX_READINESS_PAGE_SIZE));
    expect(readinessPageSize(100)).toBe(MAX_READINESS_PAGE_SIZE);
    expect(readinessPageSize(10)).toBe(10);
    expect(readinessPageSize(0)).toBe(READINESS_PAGE_SIZE);
  });

  it('reports the rows and the end-of-set signals the server published', async () => {
    answerQueue(ok({ items: [{ readyToStartDelivery: true }], nextCursor: CURSOR, hasMore: true }));
    const page = await listDeliveryReadiness({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      cursor: null,
      limit: READINESS_PAGE_SIZE,
    });
    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).toBe(CURSOR);
    expect(page.hasMore).toBe(true);
    // No total is requested and none is invented.
    expect(page.total).toBeUndefined();
  });

  it('maps a refusal to a refusal rather than to an empty queue', async () => {
    answerQueue(failure('forbidden'));
    const page = await listDeliveryReadiness({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      cursor: null,
      limit: READINESS_PAGE_SIZE,
    });
    // "Nothing is ready" and "you may not see this" are different sentences and
    // an operator acts differently on each.
    expect(page.status).toBe('denied');
    expect(page.rows).toEqual([]);
    expect(page.correlationId).toBe('corr-9');
  });

  it('refuses to send a half-built branch target instead of naming it undefined', async () => {
    await expect(
      listDeliveryReadiness({
        companyId: COMPANY_ID,
        branchId: '',
        cursor: null,
        limit: READINESS_PAGE_SIZE,
      })
    ).rejects.toThrow(/branchId/);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    { companyId: COMPANY_ID, branchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', branchId: BRANCH_ID },
  ])('refuses a target outside the returned company/branch relationship: %j', async (target) => {
    answerQueue(ok(emptyQueue));
    expect((await listDeliveryReadiness({ ...request, ...target })).status).toBe('denied');
    expect(
      get.mock.calls.some(([path]) => String(path).startsWith('/api/v1/delivery-readiness'))
    ).toBe(false);
  });

  it.each(['forbidden', 'network', 'unauthenticated'])(
    'propagates directory failure %s before the queue read',
    async (kind) => {
      get.mockResolvedValue(failure(kind));
      const result = await listDeliveryReadiness(request);
      expect(result.status).toBe(
        kind === 'forbidden' ? 'denied' : kind === 'unauthenticated' ? 'expired' : 'unavailable'
      );
      expect(result.rows).toEqual([]);
      expect(
        get.mock.calls.some(([path]) => String(path).startsWith('/api/v1/delivery-readiness'))
      ).toBe(false);
    }
  );

  it('keeps directory membership checks separate from queue permission checks', async () => {
    answerQueue(failure('forbidden'));
    expect((await readDeliveryReadinessScopes()).status).toBe('ok');
    expect((await listDeliveryReadiness(request)).status).toBe('denied');
  });
});
