import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { globSync } from 'tinyglobby';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cancellable authenticated reads (P1-32-PRE-OD-READ).
 *
 * Seven browser reads moved from a Server Action — which the installed Next
 * sends one at a time per page and cannot abort — to a GET route under
 * `/reads/*` whose request signal Next aborts when the browser disconnects.
 * This suite holds the four properties that move has to keep:
 *
 *   1. **Nothing widens.** Each route forwards exactly what its Server Action
 *      would have sent: the same API path, the same options, the same envelope.
 *      Proved by running both against one mocked transport and comparing.
 *   2. **Refusals are refusals.** No custom header, a cross-site fetch, a foreign
 *      origin, an unknown or repeated parameter — each is refused before any
 *      session is read. A missing session is the action's own `expired`.
 *   3. **The cancellation is real.** The route hands its request signal to the
 *      API call, and aborting the browser's signal aborts that request.
 *   4. **Cancelled is not unavailable.** A caller's abort rejects with an
 *      `AbortError`; an outage, a 5xx or the ceiling resolves `unavailable`.
 */

const get = vi.fn();
const authorizedClient = vi.fn();
vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const { INITIAL_REQUEST } = await import('@/components/data-table/table-state');
const {
  BROWSER_READ_HEADER,
  acceptReadState,
  acceptServerPage,
  browserRead,
  browserReadUrl,
  isCancelledRead,
  pageFailure,
} = await import('@/lib/api/browser-read');
const { READ_RESPONSE_HEADERS, queryObject, refusalOf } = await import('@/lib/api/read-route');
const { CLIENT_READ_TIMEOUT_MS } = await import('@/lib/api/read-budget');

const reception = await import('@/features/receptions/reception-list-read');
const workOrder = await import('@/features/work-orders/work-order-list-read');
const dashboard = await import('@/features/overview/dashboard-summary-read');
const directory = await import('@/lib/customers/directory-read');
const vehicles = await import('@/features/vehicles/vehicle-search-read');
const customerVehicles = await import('@/lib/customers/vehicles-read');
const { EMPTY_CRITERIA } = await import('@/features/vehicles/contract');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '66666666-6666-4666-8666-666666666666';
const VEHICLE = '77777777-7777-4777-8777-777777777777';
const HOST = 'web.test';
const REQUEST_25 = { ...INITIAL_REQUEST, pageSize: 25 };

type Params = Readonly<Record<string, string | undefined | null>>;

interface Family {
  readonly name: string;
  readonly route: string;
  readonly handler: () => Promise<{ GET: (request: Request) => Promise<Response> }>;
  /** The Server Action, invoked with `args`. */
  readonly action: () => Promise<unknown>;
  /** The query the browser half sends for the same `args`. */
  readonly params: Params;
  /** What the API answers, in the shape this family reads. */
  readonly data: unknown;
}

const PAGE_DATA = { items: [{ id: 'row-1' }], nextCursor: 'next-1', hasMore: true };

const FAMILIES: readonly Family[] = [
  {
    name: 'reception board',
    route: '/reads/receptions',
    handler: () => import('@/app/reads/receptions/route'),
    action: async () =>
      (await import('@/features/receptions/api')).listReceptions(
        { companyId: COMPANY, branchId: BRANCH },
        { statusGroup: 'open', q: 'Kha', from: '2026-09-01T00:00:00+03:00', vehicleId: VEHICLE },
        REQUEST_25,
        'cursor-1'
      ),
    params: reception.receptionListParams(
      { companyId: COMPANY, branchId: BRANCH },
      { statusGroup: 'open', q: 'Kha', from: '2026-09-01T00:00:00+03:00', vehicleId: VEHICLE },
      REQUEST_25,
      'cursor-1'
    ),
    data: PAGE_DATA,
  },
  {
    name: 'work-order board',
    route: '/reads/work-orders',
    handler: () => import('@/app/reads/work-orders/route'),
    action: async () =>
      (await import('@/features/work-orders/api')).listWorkOrders(
        { companyId: COMPANY, branchId: null },
        { stateGroup: 'active', assignedToMe: true, awaitingParts: false, q: '12-34' },
        REQUEST_25,
        null
      ),
    params: workOrder.workOrderListParams(
      { companyId: COMPANY, branchId: null },
      { stateGroup: 'active', assignedToMe: true, awaitingParts: false, q: '12-34' },
      REQUEST_25,
      null
    ),
    data: PAGE_DATA,
  },
  {
    name: 'overview figures',
    route: '/reads/dashboard-summary',
    handler: () => import('@/app/reads/dashboard-summary/route'),
    action: async () =>
      (await import('@/features/overview/api')).readDashboardSummary(
        { companyId: COMPANY, branchId: BRANCH },
        { period: 'custom', from: '2026-09-01', to: '2026-09-10' }
      ),
    params: dashboard.dashboardSummaryParams(
      { companyId: COMPANY, branchId: BRANCH },
      { period: 'custom', from: '2026-09-01', to: '2026-09-10' }
    ),
    data: { sections: [] },
  },
  {
    name: 'customer search',
    route: '/reads/customer-directory',
    handler: () => import('@/app/reads/customer-directory/route'),
    action: async () =>
      (await import('@/lib/customers/directory')).searchCustomerDirectory(
        { ...INITIAL_REQUEST, pageSize: 10 },
        'cursor-2',
        { name: '  Layla  ', partyType: 'individual', q: 'x' }
      ),
    params: directory.customerDirectoryParams({ ...INITIAL_REQUEST, pageSize: 10 }, 'cursor-2', {
      name: '  Layla  ',
      partyType: 'individual',
      q: 'x',
    }),
    data: PAGE_DATA,
  },
  {
    name: 'vehicle search',
    route: '/reads/vehicles',
    handler: () => import('@/app/reads/vehicles/route'),
    action: async () =>
      (await import('@/features/vehicles/api')).searchVehicles(
        { ...EMPTY_CRITERIA, plate: ' ABC ', make: 'Toyota' },
        REQUEST_25,
        null
      ),
    params: vehicles.vehicleSearchParams(
      { ...EMPTY_CRITERIA, plate: ' ABC ', make: 'Toyota' },
      REQUEST_25,
      null
    ),
    data: PAGE_DATA,
  },
  {
    name: "a customer's vehicles",
    route: '/reads/customer-vehicles',
    handler: () => import('@/app/reads/customer-vehicles/route'),
    action: async () =>
      (await import('@/lib/customers/vehicles')).listCustomerVehicles(
        CUSTOMER,
        { ...INITIAL_REQUEST, pageSize: 10 },
        'cursor-3'
      ),
    params: customerVehicles.customerVehiclesParams(
      CUSTOMER,
      { ...INITIAL_REQUEST, pageSize: 10 },
      'cursor-3'
    ),
    data: PAGE_DATA,
  },
];

/** A request as our own browser half sends it, with overrides. */
function readRequest(
  route: string,
  params: Params,
  headers: Record<string, string | null> = {},
  signal?: AbortSignal
): Request {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    host: HOST,
    [BROWSER_READ_HEADER]: '1',
    'sec-fetch-site': 'same-origin',
    ...headers,
  })) {
    if (value !== null) merged[key] = value;
  }
  return new Request(`http://${HOST}${browserReadUrl(route, params)}`, {
    headers: merged,
    ...(signal ? { signal } : {}),
  });
}

beforeEach(() => {
  get.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue({ get });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('each route forwards exactly what its Server Action sends', () => {
  it.each(FAMILIES)('$name: same API request, same envelope', async (family) => {
    get.mockResolvedValue({ ok: true, status: 200, data: family.data, correlationId: 'corr-1' });

    const fromAction = await family.action();
    expect(get).toHaveBeenCalledTimes(1);
    const [actionPath, actionOptions] = get.mock.calls[0] as [string, Record<string, unknown>?];

    get.mockClear();
    const { GET } = await family.handler();
    const response = await GET(readRequest(family.route, family.params));
    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledTimes(1);
    const [routePath, routeOptions] = get.mock.calls[0] as [string, Record<string, unknown>];

    // The same operation, the same parameters, in the same order.
    expect(routePath).toBe(actionPath);
    // The same options, plus the signal and nothing else.
    const { signal, ...rest } = routeOptions;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(rest).toEqual(actionOptions ?? {});
    // And the same answer, carried unchanged to the browser.
    expect(await response.json()).toEqual(fromAction);
    expect(response.headers.get('x-correlation-id')).toBe('corr-1');
  });

  it.each(FAMILIES)('$name: a missing session is the action’s own expired', async (family) => {
    authorizedClient.mockResolvedValue(null);
    const fromAction = await family.action();
    const { GET } = await family.handler();
    const response = await GET(readRequest(family.route, family.params));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fromAction);
    expect(fromAction).toMatchObject({ status: 'expired' });
    expect(get).not.toHaveBeenCalled();
  });

  it.each(FAMILIES)('$name: an API refusal arrives as the same refusal', async (family) => {
    get.mockResolvedValue({
      ok: false,
      kind: 'forbidden',
      status: 403,
      problem: null,
      correlationId: 'corr-403',
    });
    const fromAction = await family.action();
    const { GET } = await family.handler();
    const body = await (await GET(readRequest(family.route, family.params))).json();
    expect(body).toEqual(fromAction);
    expect(body).toMatchObject({ status: 'denied', correlationId: 'corr-403' });
  });

  it('proves the equivalence is not vacuous — a different ask is a different request', async () => {
    get.mockResolvedValue({ ok: true, status: 200, data: PAGE_DATA, correlationId: 'c' });
    const { GET } = await import('@/app/reads/receptions/route');
    await GET(
      readRequest(
        '/reads/receptions',
        reception.receptionListParams(
          { companyId: COMPANY, branchId: null },
          { status: 'opened' },
          REQUEST_25,
          null
        )
      )
    );
    const path = String(get.mock.calls[0]?.[0]);
    expect(path).toContain(`companyId=${COMPANY}`);
    expect(path).not.toContain('branchId');
    expect(path).toContain('status=opened');
    expect(path).toContain('limit=25');
  });
});

describe('the route refuses a request that is not our own browser read', () => {
  const family = FAMILIES[0] as Family;

  it.each([
    ['no custom header', { [BROWSER_READ_HEADER]: null }],
    ['a wrong header value', { [BROWSER_READ_HEADER]: 'yes' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['a sibling-subdomain fetch', { 'sec-fetch-site': 'same-site' }],
    ['a top-level navigation', { 'sec-fetch-site': 'none' }],
    ['a foreign Origin', { origin: 'https://elsewhere.test' }],
    ['a malformed Origin', { origin: 'not a url' }],
  ] as const)('refuses %s with 403 and reads no session', async (_label, headers) => {
    const { GET } = await family.handler();
    const response = await GET(readRequest(family.route, family.params, headers));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ status: 'denied', correlationId: null });
    expect(authorizedClient).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    for (const [name, value] of Object.entries(READ_RESPONSE_HEADERS)) {
      expect(response.headers.get(name), name).toBe(value);
    }
  });

  it('serves a same-origin fetch whose Origin names this host, and one with no fetch metadata', async () => {
    get.mockResolvedValue({ ok: true, status: 200, data: PAGE_DATA, correlationId: 'c' });
    const { GET } = await family.handler();
    const withOrigin = await GET(
      readRequest(family.route, family.params, { origin: `http://${HOST}` })
    );
    expect(withOrigin.status).toBe(200);
    // A client that is not a browser sends no fetch metadata and cannot carry
    // someone else's cookie, so the header alone is its requirement.
    const bare = await GET(readRequest(family.route, family.params, { 'sec-fetch-site': null }));
    expect(bare.status).toBe(200);
  });

  it('checks the host the edge saw when a proxy forwards it', () => {
    const forwarded = readRequest(family.route, family.params, {
      host: 'internal:3100',
      'x-forwarded-host': HOST,
      origin: `https://${HOST}`,
    });
    expect(refusalOf(forwarded)).toBeNull();
    const spoofedElsewhere = readRequest(family.route, family.params, {
      host: 'internal:3100',
      origin: `https://${HOST}`,
    });
    expect(refusalOf(spoofedElsewhere)).toBe('origin');
  });

  it.each([
    ['an unknown parameter', { ...family.params, tenantId: '1' }],
    ['a page size no table offers', { ...family.params, pageSize: '1000' }],
    ['a non-numeric page size', { ...family.params, pageSize: 'ten' }],
    ['a missing page size', { ...family.params, pageSize: undefined }],
    ['a malformed company', { ...family.params, companyId: 'c1' }],
    ['a missing company', { ...family.params, companyId: undefined }],
    ['a status the board does not know', { ...family.params, status: 'teleported' }],
    ['an over-long term', { ...family.params, q: 'x'.repeat(257) }],
  ] as const)('refuses %s with 400 and reads no session', async (_label, params) => {
    const { GET } = await family.handler();
    const response = await GET(readRequest(family.route, params));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: 'error', correlationId: null });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(authorizedClient).not.toHaveBeenCalled();
  });

  it('refuses a repeated parameter rather than choosing one of its values', async () => {
    const { GET } = await family.handler();
    const url = `http://${HOST}${browserReadUrl(family.route, family.params)}&companyId=${COMPANY}`;
    const response = await GET(
      new Request(url, {
        headers: { host: HOST, [BROWSER_READ_HEADER]: '1', 'sec-fetch-site': 'same-origin' },
      })
    );
    expect(response.status).toBe(400);
    expect(queryObject(new URL(url))).toBeNull();
    expect(queryObject(new URL(`http://${HOST}/reads/x?a=1&b=2`))).toEqual({ a: '1', b: '2' });
  });

  it.each(FAMILIES)('$name: every answer is private, uncached and keyed by cookie', async (f) => {
    get.mockResolvedValue({ ok: true, status: 200, data: f.data, correlationId: 'c' });
    const { GET } = await f.handler();
    const response = await GET(readRequest(f.route, f.params));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('the route hands its request signal to the API call', () => {
  it.each(FAMILIES)('$name: aborting the request aborts the API call', async (family) => {
    let seen: AbortSignal | undefined;
    get.mockImplementation(
      (_path: string, options: { signal?: AbortSignal } = {}) =>
        new Promise((resolve) => {
          seen = options.signal;
          options.signal?.addEventListener('abort', () =>
            resolve({
              ok: false,
              kind: 'cancelled',
              status: null,
              problem: null,
              correlationId: 'x',
            })
          );
        })
    );
    const controller = new AbortController();
    const request = readRequest(family.route, family.params, {}, controller.signal);
    const { GET } = await family.handler();
    const answered = GET(request);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    expect(seen).toBe(request.signal);
    expect(seen?.aborted).toBe(false);
    controller.abort();
    expect(seen?.aborted).toBe(true);
    // The API call ended because the signal did; the route still answers.
    expect((await answered).status).toBe(200);
  });
});

describe('browserRead: cancelled is not unavailable', () => {
  const read = (signal?: AbortSignal, timeoutMs?: number) =>
    browserRead({
      route: '/reads/receptions',
      params: { companyId: COMPANY, pageSize: '25', empty: '', gone: null },
      signal,
      accept: acceptServerPage,
      failure: pageFailure,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });

  it('sends a same-origin GET with the read header, no cache, and its own signal', async () => {
    const fetchStub = vi.fn(async () =>
      Response.json({
        status: 'ok',
        rows: [],
        nextCursor: null,
        hasMore: false,
        correlationId: 'c',
      })
    );
    vi.stubGlobal('fetch', fetchStub);
    await expect(read()).resolves.toMatchObject({ status: 'ok', correlationId: 'c' });
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/reads/receptions?companyId=${COMPANY}&pageSize=25`);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)[BROWSER_READ_HEADER]).toBe('1');
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses to address anything outside the read routes', () => {
    expect(() => browserReadUrl('/api/v1/receptions', {})).toThrow(/\/reads\//);
    expect(() => browserReadUrl('https://elsewhere.test/reads/x', {})).toThrow(/\/reads\//);
  });

  it('rejects with an AbortError, without a request, when already cancelled', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const controller = new AbortController();
    controller.abort();
    const error = await read(controller.signal).catch((caught: unknown) => caught);
    expect(isCancelledRead(error)).toBe(true);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('aborts the fetch and rejects — never resolves unavailable — when cancelled mid-flight', async () => {
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            fetchSignal = init.signal ?? undefined;
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      )
    );
    const controller = new AbortController();
    const pending = read(controller.signal);
    await vi.waitFor(() => expect(fetchSignal).toBeDefined());
    controller.abort();
    const outcome = await pending.then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error })
    );
    expect('rejected' in outcome && isCancelledRead(outcome.rejected)).toBe(true);
    expect(fetchSignal?.aborted).toBe(true);
  });

  it('drops a response that raced the abort rather than answering with it', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        return Response.json({
          status: 'ok',
          rows: [{ id: 'stale' }],
          nextCursor: null,
          hasMore: false,
          correlationId: 'c',
        });
      })
    );
    const error = await read(controller.signal).catch((caught: unknown) => caught);
    expect(isCancelledRead(error)).toBe(true);
  });

  it('resolves unavailable when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(read(new AbortController().signal)).resolves.toEqual(
      pageFailure('unavailable', null)
    );
  });

  it.each([
    [503, 'unavailable'],
    [502, 'unavailable'],
    [500, 'unavailable'],
    [429, 'unavailable'],
    [401, 'expired'],
    [403, 'denied'],
    [400, 'error'],
    [404, 'error'],
  ] as const)('maps a bare HTTP %s to %s', async (status, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status, headers: { 'x-correlation-id': 'h' } }))
    );
    await expect(read()).resolves.toEqual(pageFailure(expected, 'h'));
  });

  it('believes the refusal a route stated in its body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'denied', correlationId: null }, { status: 403 }))
    );
    await expect(read()).resolves.toEqual(pageFailure('denied', null));
  });

  it('calls a 200 whose body is not an envelope an error, not an empty page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ rows: 'nope' }))
    );
    await expect(read()).resolves.toEqual(pageFailure('error', null));
  });

  it('gives up at the ceiling, answers unavailable, and aborts the fetch', async () => {
    vi.useFakeTimers();
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            fetchSignal = init.signal ?? undefined;
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      )
    );
    const pending = read(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS - 1);
    expect(fetchSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual(pageFailure('unavailable', null));
    expect(fetchSignal?.aborted).toBe(true);
  });

  it('accepts only the envelope shapes a route sends', () => {
    expect(acceptServerPage(null)).toBeNull();
    expect(
      acceptServerPage({ status: 'maybe', rows: [], nextCursor: null, hasMore: false })
    ).toBeNull();
    expect(
      acceptServerPage({
        status: 'ok',
        rows: [],
        nextCursor: 3,
        hasMore: false,
        correlationId: null,
      })
    ).toBeNull();
    expect(acceptReadState({ status: 'ok', correlationId: null })).toBeNull();
    expect(acceptReadState({ status: 'ok', data: {}, correlationId: 'c' })).toEqual({
      status: 'ok',
      data: {},
      correlationId: 'c',
    });
    expect(acceptReadState({ status: 'expired', correlationId: null })).toEqual({
      status: 'expired',
      correlationId: null,
    });
  });
});

describe('end to end in one process: the browser abort reaches the API call', () => {
  it('cancels the route, and the API request behind it, when the caller aborts', async () => {
    const { GET } = await import('@/app/reads/receptions/route');
    let apiSignal: AbortSignal | undefined;
    get.mockImplementation(
      (_path: string, options: { signal?: AbortSignal } = {}) =>
        new Promise((resolve) => {
          apiSignal = options.signal;
          options.signal?.addEventListener('abort', () =>
            resolve({
              ok: false,
              kind: 'cancelled',
              status: null,
              problem: null,
              correlationId: 'x',
            })
          );
        })
    );
    // The browser's fetch, served by the route in-process: the fetch signal
    // becomes the request signal, as Next's disconnect wiring makes it.
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      const headers = { ...(init.headers as Record<string, string>), host: HOST };
      return GET(
        new Request(`http://${HOST}${url}`, {
          headers: { ...headers, 'sec-fetch-site': 'same-origin' },
          ...(init.signal ? { signal: init.signal } : {}),
        })
      );
    });

    const controller = new AbortController();
    const pending = reception.listReceptionsCancellable(
      { companyId: COMPANY, branchId: BRANCH },
      { q: 'Kha' },
      REQUEST_25,
      null,
      controller.signal
    );
    await vi.waitFor(() => expect(apiSignal).toBeDefined());
    expect(apiSignal?.aborted).toBe(false);

    controller.abort();
    expect(apiSignal?.aborted).toBe(true);
    const error = await pending.catch((caught: unknown) => caught);
    expect(isCancelledRead(error)).toBe(true);
  });
});

describe('each family’s query survives the trip exactly', () => {
  it('reception board', () => {
    const args = [
      { companyId: COMPANY, branchId: null },
      { status: 'opened', from: 'a', to: 'b', q: 'Kh' },
      REQUEST_25,
      'c1',
    ] as const;
    const query = reception.receptionListQuery.parse(clean(reception.receptionListParams(...args)));
    expect(reception.receptionListArgs(query)).toEqual(args);
  });

  it('work-order board, flags included', () => {
    const args = [
      { companyId: COMPANY, branchId: BRANCH },
      { kind: 'rework', readyForDelivery: false, assignedToMe: true, customerId: CUSTOMER },
      REQUEST_25,
      null,
    ] as const;
    const query = workOrder.workOrderListQuery.parse(clean(workOrder.workOrderListParams(...args)));
    expect(workOrder.workOrderListArgs(query)).toEqual(args);
  });

  it('overview figures', () => {
    const args = [{ companyId: COMPANY, branchId: null }, { period: 'last7' }] as const;
    const query = dashboard.dashboardSummaryQuery.parse(
      clean(dashboard.dashboardSummaryParams(...args))
    );
    expect(dashboard.dashboardSummaryArgs(query)).toEqual(args);
  });

  it('customer search, normalised on the way', () => {
    const query = directory.customerDirectoryQuery.parse(
      clean(
        directory.customerDirectoryParams(REQUEST_25, null, {
          phone: ' 0501 ',
          lifecycleStatus: 'active',
          q: 'a',
        })
      )
    );
    // The one-character free text is dropped exactly as the server core drops it.
    expect(directory.customerDirectoryArgs(query)).toEqual([
      REQUEST_25,
      null,
      { phone: '0501', lifecycleStatus: 'active' },
    ]);
  });

  it('vehicle search', () => {
    const criteria = { ...EMPTY_CRITERIA, vin: 'JT123', model: 'Corolla' };
    const query = vehicles.vehicleSearchQuery.parse(
      clean(vehicles.vehicleSearchParams(criteria, REQUEST_25, 'c9'))
    );
    expect(vehicles.vehicleSearchArgs(query)).toEqual([criteria, REQUEST_25, 'c9']);
  });

  it("a customer's vehicles", () => {
    const query = customerVehicles.customerVehiclesQuery.parse(
      clean(customerVehicles.customerVehiclesParams(CUSTOMER, REQUEST_25, null))
    );
    expect(customerVehicles.customerVehiclesArgs(query)).toEqual([CUSTOMER, REQUEST_25, null]);
  });

  it('asks nothing of the network for a search with nothing to search on', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    await expect(
      directory.searchCustomerDirectoryCancellable(REQUEST_25, null, { q: ' ' })
    ).resolves.toMatchObject({ status: 'ok', rows: [] });
    await expect(
      vehicles.searchVehiclesCancellable(EMPTY_CRITERIA, REQUEST_25, null)
    ).resolves.toMatchObject({ status: 'ok', rows: [] });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

/** The query a URL would carry: empty and absent values dropped. */
function clean(params: Params): Record<string, string> {
  return queryObject(new URL(`http://${HOST}${browserReadUrl('/reads/x', params)}`)) ?? {};
}

/* ------------------------------------------------------------------ *
 * Structure: six routes, server-only cores, one new fetch
 * ------------------------------------------------------------------ */

const WEB_SRC = join(__dirname, '..', 'src');
const READS_DIR = join(WEB_SRC, 'app', 'reads');
const CORES = [
  join(WEB_SRC, 'features', 'receptions', 'reception-list-read.server.ts'),
  join(WEB_SRC, 'features', 'work-orders', 'work-order-list-read.server.ts'),
  join(WEB_SRC, 'features', 'overview', 'dashboard-summary-read.server.ts'),
  join(WEB_SRC, 'lib', 'customers', 'directory-read.server.ts'),
  join(WEB_SRC, 'features', 'vehicles', 'vehicle-search-read.server.ts'),
  join(WEB_SRC, 'lib', 'customers', 'vehicles-read.server.ts'),
].map((file) => resolve(file));

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/** The directive a module opens with, if any (same reading as the platform suite). */
function directiveOf(source: string): string | null {
  const match =
    /^(?:\s|\/\/[^\n]*\n|\/\*(?:[^*]|\*(?!\/))*\*\/)*['"](use (?:client|server))['"]/.exec(source);
  return match ? (match[1] ?? null) : null;
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = resolve(WEB_SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
  return candidates.find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate)) ?? null;
}

function localImportsOf(file: string, source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const target = resolveLocal(file, match[1] ?? '');
    if (target) out.push(target);
  }
  return out;
}

describe('the read structure', () => {
  it('serves exactly the six phase-one routes, each a GET and nothing else', () => {
    const routes = readdirSync(READS_DIR).sort();
    expect(routes).toEqual([
      'customer-directory',
      'customer-vehicles',
      'dashboard-summary',
      'receptions',
      'vehicles',
      'work-orders',
    ]);
    for (const route of routes) {
      const source = code(readFileSync(join(READS_DIR, route, 'route.ts'), 'utf8'));
      const exported = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)]
        .map((match) => match[1])
        .sort();
      expect(exported, route).toEqual(['GET']);
      // One door for every refusal and header, and one core per route.
      expect(source, route).toContain('serveBrowserRead(');
      expect(source.match(/from '@\/[^']+\.server'/g) ?? [], route).toHaveLength(1);
      // No route caches, and none claims to be static.
      expect(source, route).not.toMatch(/revalidate|force-static|unstable_cache|'use cache'/);
    }
  });

  it('matches every browser half to a route that exists', () => {
    for (const route of [
      reception.RECEPTION_LIST_ROUTE,
      workOrder.WORK_ORDER_LIST_ROUTE,
      dashboard.DASHBOARD_SUMMARY_ROUTE,
      directory.CUSTOMER_DIRECTORY_ROUTE,
      vehicles.VEHICLE_SEARCH_ROUTE,
      customerVehicles.CUSTOMER_VEHICLES_ROUTE,
    ]) {
      expect(
        existsSync(join(WEB_SRC, 'app', ...route.split('/').filter(Boolean), 'route.ts')),
        route
      ).toBe(true);
    }
  });

  it('keeps every read core server-only: no directive, and reachable from no client module', () => {
    for (const core of CORES) {
      const source = readFileSync(core, 'utf8');
      expect(directiveOf(source), relative(WEB_SRC, core)).toBeNull();
      expect(source, relative(WEB_SRC, core)).toContain('authorizedClient()');
    }
    const files = globSync(['**/*.ts', '**/*.tsx'], { cwd: WEB_SRC, absolute: true }).map((file) =>
      resolve(file)
    );
    const clientFiles = files.filter(
      (file) => directiveOf(readFileSync(file, 'utf8')) === 'use client'
    );
    expect(clientFiles.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const start of clientFiles) {
      const seen = new Set<string>([start]);
      const queue = [start];
      while (queue.length > 0) {
        const file = queue.shift() as string;
        const source = readFileSync(file, 'utf8');
        // A Server Action module ends the chain: the browser receives a
        // reference to it, never its imports.
        if (file !== start && directiveOf(source) === 'use server') continue;
        for (const target of localImportsOf(file, source)) {
          if (CORES.includes(target)) offenders.push(`${relative(WEB_SRC, start)} -> ${target}`);
          if (!seen.has(target)) {
            seen.add(target);
            queue.push(target);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('would notice a client module that reached a core', () => {
    const probe = resolve(WEB_SRC, 'features', 'receptions', 'components', 'Probe.tsx');
    expect(
      localImportsOf(probe, "import { readReceptionList } from '../reception-list-read.server';")
    ).toContain(CORES[0]);
  });

  it('adds exactly one fetch, in the API layer', () => {
    const source = code(readFileSync(join(WEB_SRC, 'lib', 'api', 'browser-read.ts'), 'utf8'));
    expect(source.match(/\bfetch\s*\(/g)).toHaveLength(1);
    for (const file of [
      ...CORES,
      ...readdirSync(READS_DIR).map((r) => join(READS_DIR, r, 'route.ts')),
    ]) {
      expect(code(readFileSync(file, 'utf8')), file).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('switched every phase-one browser caller off the Server Action', () => {
    const ACTIONS =
      /\b(listReceptions|listWorkOrders|readDashboardSummary|searchCustomerDirectory|searchCustomers|searchVehicles|listCustomerVehicles)\s*\(/;
    const files = globSync(['**/*.ts', '**/*.tsx'], { cwd: WEB_SRC, absolute: true });
    // Every module but the Server Action modules themselves — a plain module a
    // client component imports ships to the browser just the same.
    const callers = files
      .filter((file) => directiveOf(readFileSync(file, 'utf8')) !== 'use server')
      .filter((file) => ACTIONS.test(code(readFileSync(file, 'utf8'))))
      .map((file) => relative(WEB_SRC, file));
    expect(callers).toEqual([]);
  });
});
