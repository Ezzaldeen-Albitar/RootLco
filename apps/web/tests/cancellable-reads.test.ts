import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { globSync } from 'tinyglobby';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cancellable authenticated reads (P1-32-PRE-OD-READ).
 *
 * Seven browser reads moved from a Server Action — which the installed Next
 * sends one at a time per page and cannot abort — to a route under `/reads/*`
 * whose request signal Next aborts when the browser disconnects; six of the
 * seven actions retired, and the seventh (`searchCustomers`) has no caller.
 * Four families carry text an operator typed and are a POST
 * whose parameters are a JSON body — the Owner's standing rule is that search
 * terms never go in the URL; the overview figures and a customer's vehicles
 * carry identifiers only and stay a GET. This suite holds five properties:
 *
 *   1. **Nothing widens.** Each route forwards exactly what its server core
 *      sends when called directly: the same API path, the same options, the
 *      same envelope. Proved by running both against one mocked transport.
 *   2. **Refusals are refusals.** No custom header, a cross-site fetch, a foreign
 *      origin (including behind a proxy chain), an unknown key, a query string on
 *      a POST, a body that is not JSON — each is refused before any session is
 *      read. A missing session is the core's own `expired`.
 *   3. **Search text never reaches an address.** The browser half of a POST
 *      family addresses the bare route and carries every term in its body.
 *   4. **The cancellation is real.** The route hands its request signal to the
 *      API call, and aborting the browser's signal aborts that request.
 *   5. **Cancelled is not unavailable, and a fault is not a framework page.** A
 *      caller's abort rejects with an `AbortError`; an outage, a 5xx or the
 *      ceiling resolves `unavailable`; a core that throws answers the family's
 *      own `unavailable` envelope with the same private, uncached headers.
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
  presentParams,
  readFailure,
} = await import('@/lib/api/browser-read');
const {
  READ_BODY_LIMIT_BYTES,
  READ_RESPONSE_HEADERS,
  isJsonContentType,
  queryObject,
  refusalOf,
  requestHost,
  sameAuthority,
  serveBrowserRead,
} = await import('@/lib/api/read-route');
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
type Handler = (request: Request) => Promise<Response>;
type Method = 'GET' | 'POST';

interface Family {
  readonly name: string;
  readonly route: string;
  readonly method: Method;
  readonly handler: () => Promise<Partial<Record<Method, Handler>>>;
  /** The server core, called directly with the family's arguments and no signal. */
  readonly core: () => Promise<unknown>;
  /** The browser half, called with the same arguments and a signal. */
  readonly cancellable: (signal?: AbortSignal) => Promise<unknown>;
  /** The parameters the browser half sends for the same arguments. */
  readonly params: Params;
  /** The operator's typed text, which must never appear in an address. */
  readonly typed: readonly string[];
  /** What the API answers, in the shape this family reads. */
  readonly data: unknown;
}

const PAGE_DATA = { items: [{ id: 'row-1' }], nextCursor: 'next-1', hasMore: true };

const RECEPTION_ARGS = [
  { companyId: COMPANY, branchId: BRANCH },
  { statusGroup: 'open', q: 'Kha', from: '2026-09-01T00:00:00+03:00', vehicleId: VEHICLE },
  REQUEST_25,
  'cursor-1',
] as const;
const WORK_ORDER_ARGS = [
  { companyId: COMPANY, branchId: null },
  { stateGroup: 'active', assignedToMe: true, awaitingParts: false, q: '12-34' },
  REQUEST_25,
  null,
] as const;
const DASHBOARD_ARGS = [
  { companyId: COMPANY, branchId: BRANCH },
  { period: 'custom', from: '2026-09-01', to: '2026-09-10' },
] as const;
const DIRECTORY_ARGS = [
  { ...INITIAL_REQUEST, pageSize: 10 },
  'cursor-2',
  { name: '  Layla  ', partyType: 'individual', q: 'x', phone: '0501 22' },
] as const;
const VEHICLE_ARGS = [
  { ...EMPTY_CRITERIA, plate: ' ABC ', make: 'Toyota', vin: 'JT1234' },
  REQUEST_25,
  null,
] as const;
const CUSTOMER_VEHICLE_ARGS = [CUSTOMER, { ...INITIAL_REQUEST, pageSize: 10 }, 'cursor-3'] as const;

const FAMILIES: readonly Family[] = [
  {
    name: 'reception board',
    route: '/reads/receptions',
    method: 'POST',
    handler: () => import('@/app/reads/receptions/route'),
    core: async () =>
      (await import('@/features/receptions/reception-list-read.server')).readReceptionList(
        ...RECEPTION_ARGS
      ),
    cancellable: (signal) => reception.listReceptionsCancellable(...RECEPTION_ARGS, signal),
    params: reception.receptionListParams(...RECEPTION_ARGS),
    typed: ['Kha'],
    data: PAGE_DATA,
  },
  {
    name: 'work-order board',
    route: '/reads/work-orders',
    method: 'POST',
    handler: () => import('@/app/reads/work-orders/route'),
    core: async () =>
      (await import('@/features/work-orders/work-order-list-read.server')).readWorkOrderList(
        ...WORK_ORDER_ARGS
      ),
    cancellable: (signal) => workOrder.listWorkOrdersCancellable(...WORK_ORDER_ARGS, signal),
    params: workOrder.workOrderListParams(...WORK_ORDER_ARGS),
    typed: ['12-34'],
    data: PAGE_DATA,
  },
  {
    name: 'overview figures',
    route: '/reads/dashboard-summary',
    method: 'GET',
    handler: () => import('@/app/reads/dashboard-summary/route'),
    core: async () =>
      (await import('@/features/overview/dashboard-summary-read.server')).readDashboardSummaryState(
        ...DASHBOARD_ARGS
      ),
    cancellable: (signal) => dashboard.readDashboardSummaryCancellable(...DASHBOARD_ARGS, signal),
    params: dashboard.dashboardSummaryParams(...DASHBOARD_ARGS),
    typed: [],
    data: { sections: [] },
  },
  {
    name: 'customer search',
    route: '/reads/customer-directory',
    method: 'POST',
    handler: () => import('@/app/reads/customer-directory/route'),
    core: async () =>
      (await import('@/lib/customers/directory-read.server')).readCustomerDirectory(
        ...DIRECTORY_ARGS
      ),
    cancellable: (signal) =>
      directory.searchCustomerDirectoryCancellable(...DIRECTORY_ARGS, signal),
    params: directory.customerDirectoryParams(...DIRECTORY_ARGS),
    typed: ['Layla', '0501'],
    data: PAGE_DATA,
  },
  {
    name: 'vehicle search',
    route: '/reads/vehicles',
    method: 'POST',
    handler: () => import('@/app/reads/vehicles/route'),
    core: async () =>
      (await import('@/features/vehicles/vehicle-search-read.server')).readVehicleSearch(
        ...VEHICLE_ARGS
      ),
    cancellable: (signal) => vehicles.searchVehiclesCancellable(...VEHICLE_ARGS, signal),
    params: vehicles.vehicleSearchParams(...VEHICLE_ARGS),
    typed: ['ABC', 'Toyota', 'JT1234'],
    data: PAGE_DATA,
  },
  {
    name: "a customer's vehicles",
    route: '/reads/customer-vehicles',
    method: 'GET',
    handler: () => import('@/app/reads/customer-vehicles/route'),
    core: async () =>
      (await import('@/lib/customers/vehicles-read.server')).readCustomerVehicles(
        ...CUSTOMER_VEHICLE_ARGS
      ),
    cancellable: (signal) =>
      customerVehicles.listCustomerVehiclesCancellable(...CUSTOMER_VEHICLE_ARGS, signal),
    params: customerVehicles.customerVehiclesParams(...CUSTOMER_VEHICLE_ARGS),
    typed: [],
    data: PAGE_DATA,
  },
];

const POST_FAMILIES = FAMILIES.filter((family) => family.method === 'POST');
const GET_FAMILIES = FAMILIES.filter((family) => family.method === 'GET');
const RECEPTIONS = FAMILIES[0] as Family;
const OVERVIEW = FAMILIES[2] as Family;

/** The handler a family's route exports for its own method. */
async function handlerOf(family: Family): Promise<Handler> {
  const handler = (await family.handler())[family.method];
  if (!handler) throw new Error(`${family.route} exports no ${family.method}`);
  return handler;
}

interface RequestShape {
  readonly headers?: Record<string, string | null>;
  readonly signal?: AbortSignal;
  /** Replaces the JSON body a POST family would send. */
  readonly body?: string;
  /** Appended to the address as-is, e.g. `?q=Kha`. */
  readonly search?: string;
}

/** A request as our own browser half sends it for this family, with overrides. */
function readRequest(family: Family, params: Params, shape: RequestShape = {}): Request {
  const post = family.method === 'POST';
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    host: HOST,
    [BROWSER_READ_HEADER]: '1',
    'sec-fetch-site': 'same-origin',
    ...(post ? { 'content-type': 'application/json' } : {}),
    ...shape.headers,
  })) {
    if (value !== null) merged[key] = value;
  }
  const address = post ? family.route : browserReadUrl(family.route, params);
  return new Request(`http://${HOST}${address}${shape.search ?? ''}`, {
    method: family.method,
    headers: merged,
    ...(post ? { body: shape.body ?? JSON.stringify(presentParams(params)) } : {}),
    ...(shape.signal ? { signal: shape.signal } : {}),
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

describe('each route forwards exactly what its server core sends', () => {
  it.each(FAMILIES)('$name: same API request, same envelope', async (family) => {
    get.mockResolvedValue({ ok: true, status: 200, data: family.data, correlationId: 'corr-1' });

    const fromCore = await family.core();
    expect(get).toHaveBeenCalledTimes(1);
    const [corePath, coreOptions] = get.mock.calls[0] as [string, Record<string, unknown>?];

    get.mockClear();
    const handle = await handlerOf(family);
    const response = await handle(readRequest(family, family.params));
    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledTimes(1);
    const [routePath, routeOptions] = get.mock.calls[0] as [string, Record<string, unknown>];

    // The same operation, the same parameters, in the same order.
    expect(routePath).toBe(corePath);
    // The same options, plus the signal and nothing else.
    const { signal, ...rest } = routeOptions;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(rest).toEqual(coreOptions ?? {});
    // And the same answer, carried unchanged to the browser.
    expect(await response.json()).toEqual(fromCore);
    expect(response.headers.get('x-correlation-id')).toBe('corr-1');
  });

  it.each(FAMILIES)('$name: a missing session is the core’s own expired', async (family) => {
    authorizedClient.mockResolvedValue(null);
    const fromCore = await family.core();
    const handle = await handlerOf(family);
    const response = await handle(readRequest(family, family.params));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fromCore);
    expect(fromCore).toMatchObject({ status: 'expired' });
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
    const fromCore = await family.core();
    const handle = await handlerOf(family);
    const body = await (await handle(readRequest(family, family.params))).json();
    expect(body).toEqual(fromCore);
    expect(body).toMatchObject({ status: 'denied', correlationId: 'corr-403' });
  });

  it('proves the equivalence is not vacuous — a different ask is a different request', async () => {
    get.mockResolvedValue({ ok: true, status: 200, data: PAGE_DATA, correlationId: 'c' });
    const handle = await handlerOf(RECEPTIONS);
    await handle(
      readRequest(
        RECEPTIONS,
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
  it.each(
    [RECEPTIONS, OVERVIEW].flatMap((family) =>
      (
        [
          ['no custom header', { [BROWSER_READ_HEADER]: null }],
          ['a wrong header value', { [BROWSER_READ_HEADER]: 'yes' }],
          ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
          ['a sibling-subdomain fetch', { 'sec-fetch-site': 'same-site' }],
          ['a top-level navigation', { 'sec-fetch-site': 'none' }],
          ['a foreign Origin', { origin: 'https://elsewhere.test' }],
          ['a malformed Origin', { origin: 'not a url' }],
          [
            'a foreign first forwarded host',
            { origin: `http://${HOST}`, 'x-forwarded-host': 'elsewhere.test, web.test' },
          ],
        ] as const
      ).map(
        ([label, headers]) =>
          [`${family.method} ${family.name}: ${label}`, family, headers] as const
      )
    )
  )('refuses %s with 403 and reads no session', async (_label, family, headers) => {
    const handle = await handlerOf(family);
    const response = await handle(readRequest(family, family.params, { headers }));
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
    const handle = await handlerOf(RECEPTIONS);
    const withOrigin = await handle(
      readRequest(RECEPTIONS, RECEPTIONS.params, { headers: { origin: `http://${HOST}` } })
    );
    expect(withOrigin.status).toBe(200);
    // A client that is not a browser sends no fetch metadata and cannot carry
    // someone else's cookie, so the header alone is its requirement.
    const bare = await handle(
      readRequest(RECEPTIONS, RECEPTIONS.params, { headers: { 'sec-fetch-site': null } })
    );
    expect(bare.status).toBe(200);
  });
});

describe('the host an Origin is compared with, behind a proxy chain', () => {
  const at = (headers: Record<string, string | null>, origin: string) =>
    refusalOf(readRequest(RECEPTIONS, RECEPTIONS.params, { headers: { ...headers, origin } }));

  it('checks the host the edge saw when a proxy forwards it', () => {
    expect(at({ host: 'internal:3100', 'x-forwarded-host': HOST }, `https://${HOST}`)).toBeNull();
    // Without the forwarded host, the internal address is not the origin's.
    expect(at({ host: 'internal:3100' }, `https://${HOST}`)).toBe('origin');
  });

  it('takes the FIRST value of a chain, trimmed and lowercased', () => {
    const chain = {
      host: 'internal:3100',
      'x-forwarded-host': ' WEB.test , proxy-2:8080, internal',
    };
    expect(at(chain, `https://${HOST}`)).toBeNull();
    expect(requestHost(readRequest(RECEPTIONS, RECEPTIONS.params, { headers: chain }))).toBe(
      'web.test'
    );
    // A later hop naming this host does not rescue a foreign first value.
    expect(
      at({ host: HOST, 'x-forwarded-host': `elsewhere.test, ${HOST}` }, `https://${HOST}`)
    ).toBe('origin');
  });

  it('compares host AND port, reading a default port the same both ways', () => {
    expect(at({ 'x-forwarded-host': `${HOST}:443` }, `https://${HOST}`)).toBeNull();
    expect(at({ 'x-forwarded-host': `${HOST}:80` }, `http://${HOST}`)).toBeNull();
    expect(at({ 'x-forwarded-host': `${HOST}:8443` }, `https://${HOST}`)).toBe('origin');
    expect(at({ 'x-forwarded-host': `${HOST}:443` }, `http://${HOST}`)).toBe('origin');
    expect(at({ host: `${HOST}:3100` }, `http://${HOST}:3100`)).toBeNull();
    expect(at({ host: `${HOST}:3100` }, `http://${HOST}:3101`)).toBe('origin');
  });

  it('refuses a forwarded value that is not a bare host', () => {
    for (const forged of [', web.test', 'user@web.test', 'web.test/x', 'web.test?x', '']) {
      expect(at({ host: HOST, 'x-forwarded-host': forged }, `https://${HOST}`), forged).toBe(
        'origin'
      );
    }
    expect(sameAuthority(new URL(`https://${HOST}`), null)).toBe(false);
    expect(sameAuthority(new URL(`https://${HOST}`), `evil.test@${HOST}`)).toBe(false);
    expect(sameAuthority(new URL(`https://${HOST}`), HOST)).toBe(true);
  });
});

describe('a POST family accepts exactly one JSON body, and nothing in the address', () => {
  it.each(POST_FAMILIES)('$name: serves the body it is sent', async (family) => {
    get.mockResolvedValue({ ok: true, status: 200, data: family.data, correlationId: 'c' });
    const handle = await handlerOf(family);
    expect((await handle(readRequest(family, family.params))).status).toBe(200);
  });

  it.each(
    POST_FAMILIES.flatMap((family) =>
      (
        [
          [
            'an unknown key',
            { body: JSON.stringify({ ...presentParams(family.params), tenantId: '1' }) },
            400,
          ],
          ['a query string beside the body', { search: '?q=Kha' }, 400],
          ['a parameter moved into the address', { search: '?pageSize=25' }, 400],
          ['a text/plain body', { headers: { 'content-type': 'text/plain' } }, 415],
          [
            'a form body',
            { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
            415,
          ],
          ['no content type', { headers: { 'content-type': null } }, 415],
          ['a body that is not JSON', { body: 'q=Kha' }, 400],
          ['a JSON array', { body: '[]' }, 400],
          ['JSON null', { body: 'null' }, 400],
          [
            'a number where text belongs',
            { body: JSON.stringify({ ...presentParams(family.params), pageSize: 25 }) },
            400,
          ],
          [
            'an over-long term',
            { body: JSON.stringify({ ...presentParams(family.params), q: 'x'.repeat(257) }) },
            400,
          ],
          [
            'a body over the limit',
            { body: JSON.stringify({ q: 'x'.repeat(READ_BODY_LIMIT_BYTES) }) },
            413,
          ],
        ] as const
      ).map(
        ([label, shape, status]) => [`${family.name}: ${label}`, family, shape, status] as const
      )
    )
  )('refuses %s, before any session is read', async (_label, family, shape, status) => {
    const handle = await handlerOf(family);
    const response = await handle(readRequest(family, family.params, shape));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ status: 'error', correlationId: null });
    for (const [name, value] of Object.entries(READ_RESPONSE_HEADERS)) {
      expect(response.headers.get(name), name).toBe(value);
    }
    expect(authorizedClient).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('accepts JSON with a charset, and nothing that merely resembles JSON', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('Application/JSON; charset=utf-8')).toBe(true);
    expect(isJsonContentType('application/json-patch+json')).toBe(false);
    expect(isJsonContentType('text/json')).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });

  it('refuses a body read through the wrong method with 405', async () => {
    const response = await serveBrowserRead(readRequest(OVERVIEW, OVERVIEW.params), {
      input: 'body',
      schema: reception.receptionListQuery,
      run: async () => pageFailure('error', null),
      failure: pageFailure,
    });
    expect(response.status).toBe(405);
    expect(authorizedClient).not.toHaveBeenCalled();
  });
});

describe('a GET family validates its query', () => {
  it.each([
    ['an unknown parameter', { ...OVERVIEW.params, tenantId: '1' }],
    ['a malformed company', { ...OVERVIEW.params, companyId: 'c1' }],
    ['a missing company', { ...OVERVIEW.params, companyId: undefined }],
    ['a period the overview does not know', { ...OVERVIEW.params, period: 'forever' }],
    ['an over-long bound', { ...OVERVIEW.params, from: 'x'.repeat(257) }],
  ] as const)('refuses %s with 400 and reads no session', async (_label, params) => {
    const handle = await handlerOf(OVERVIEW);
    const response = await handle(readRequest(OVERVIEW, params));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: 'error', correlationId: null });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(authorizedClient).not.toHaveBeenCalled();
  });

  it('refuses a repeated parameter rather than choosing one of its values', async () => {
    const handle = await handlerOf(OVERVIEW);
    const url = `http://${HOST}${browserReadUrl(OVERVIEW.route, OVERVIEW.params)}&companyId=${COMPANY}`;
    const response = await handle(
      new Request(url, {
        headers: { host: HOST, [BROWSER_READ_HEADER]: '1', 'sec-fetch-site': 'same-origin' },
      })
    );
    expect(response.status).toBe(400);
    expect(queryObject(new URL(url))).toBeNull();
    expect(queryObject(new URL(`http://${HOST}/reads/x?a=1&b=2`))).toEqual({ a: '1', b: '2' });
  });
});

describe('the board and search fields a POST body validates', () => {
  it.each([
    ['a page size no table offers', { pageSize: '1000' }],
    ['a non-numeric page size', { pageSize: 'ten' }],
    ['a missing page size', { pageSize: undefined }],
    ['a malformed company', { companyId: 'c1' }],
    ['a missing company', { companyId: undefined }],
    ['a status the board does not know', { status: 'teleported' }],
  ] as const)('refuses %s with 400 and reads no session', async (_label, change) => {
    const handle = await handlerOf(RECEPTIONS);
    const response = await handle(readRequest(RECEPTIONS, { ...RECEPTIONS.params, ...change }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: 'error', correlationId: null });
    expect(authorizedClient).not.toHaveBeenCalled();
  });
});

describe('every answer is private, uncached and keyed by cookie', () => {
  it.each(FAMILIES)('$name: a served answer', async (family) => {
    get.mockResolvedValue({ ok: true, status: 200, data: family.data, correlationId: 'c' });
    const handle = await handlerOf(family);
    const response = await handle(readRequest(family, family.params));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.each(FAMILIES)(
    '$name: a core that THROWS answers its own unavailable envelope, with the same headers',
    async (family) => {
      get.mockRejectedValue(new Error('socket hang up at 10.0.0.7'));
      const handle = await handlerOf(family);
      const response = await handle(readRequest(family, family.params));
      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;
      // The family's own shape, so the browser half accepts it as a failure
      // rather than as a malformed answer, and the screen offers Retry.
      const expected =
        family === OVERVIEW ? readFailure('unavailable', null) : pageFailure('unavailable', null);
      expect(body).toEqual(expected);
      // Nothing of the fault itself reaches the browser.
      expect(JSON.stringify(body)).not.toContain('10.0.0.7');
      for (const [name, value] of Object.entries(READ_RESPONSE_HEADERS)) {
        expect(response.headers.get(name), name).toBe(value);
      }
    }
  );
});

describe('the browser half keeps search text out of every address', () => {
  function recordingFetch() {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Response.json({
          status: 'ok',
          rows: [],
          nextCursor: null,
          hasMore: false,
          correlationId: 'c',
        });
      })
    );
    return calls;
  }

  it.each(POST_FAMILIES)('$name: POSTs a JSON body to the bare route', async (family) => {
    const calls = recordingFetch();
    await family.cancellable(new AbortController().signal);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(init.method).toBe('POST');
    // The address is the route and nothing else: no query string at all.
    expect(url).toBe(family.route);
    expect(url).not.toContain('?');
    for (const term of family.typed) expect(url).not.toContain(term);
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    // Every parameter the route needs is in the body, exactly as it parses it.
    const sent = JSON.parse(String(init.body)) as Record<string, string>;
    expect(sent).toEqual(presentParams(family.params));
    expect(family.typed.length).toBeGreaterThan(0);
    for (const term of family.typed) expect(String(init.body)).toContain(term);
  });

  it.each(GET_FAMILIES)(
    '$name: GETs its identifiers in the query, with no body',
    async (family) => {
      const calls = recordingFetch();
      await family.cancellable(new AbortController().signal);
      const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
      expect(init.method).toBe('GET');
      expect(url).toBe(browserReadUrl(family.route, family.params));
      expect(url).toContain('?');
      expect(init.body).toBeUndefined();
    }
  );
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
    const request = readRequest(family, family.params, { signal: controller.signal });
    const handle = await handlerOf(family);
    const answered = handle(request);
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
      method: 'GET',
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
    expect(init.body).toBeUndefined();
  });

  it('sends a POST to the bare route with the present parameters as a JSON body', async () => {
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
    await browserRead({
      route: '/reads/receptions',
      method: 'POST',
      params: { companyId: COMPANY, q: 'Kha', empty: '', gone: null },
      accept: acceptServerPage,
      failure: pageFailure,
    });
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/reads/receptions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ companyId: COMPANY, q: 'Kha' });
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers[BROWSER_READ_HEADER]).toBe('1');
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
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
    const { POST } = await import('@/app/reads/receptions/route');
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
    // becomes the request signal, as Next's disconnect wiring makes it, and the
    // method, headers and body are the ones the browser half built.
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      const headers = { ...(init.headers as Record<string, string>), host: HOST };
      return POST(
        new Request(`http://${HOST}${url}`, {
          method: init.method ?? 'GET',
          headers: { ...headers, 'sec-fetch-site': 'same-origin', origin: `http://${HOST}` },
          ...(typeof init.body === 'string' ? { body: init.body } : {}),
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
    // The term reached the API request through the body, never an address.
    expect(String(get.mock.calls[0]?.[0])).toContain('q=Kha');

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

/** What a route receives: empty and absent values dropped, through JSON as a POST sends it. */
function clean(params: Params): Record<string, string> {
  const viaBody = JSON.parse(JSON.stringify(presentParams(params))) as Record<string, string>;
  const viaQuery =
    queryObject(new URL(`http://${HOST}${browserReadUrl('/reads/x', params)}`)) ?? {};
  // The two transports deliver the same parameters, so either family's schema
  // meets exactly what its browser half sent.
  expect(viaBody).toEqual(viaQuery);
  return viaBody;
}

/* ------------------------------------------------------------------ *
 * Structure: six routes, server-only cores, one new fetch, no actions
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
  it('serves exactly the six phase-one routes, each on its one method and nothing else', () => {
    const routes = readdirSync(READS_DIR).sort();
    expect(routes).toEqual([
      'customer-directory',
      'customer-vehicles',
      'dashboard-summary',
      'receptions',
      'vehicles',
      'work-orders',
    ]);
    // Search text rides in a body: the four families that carry any are POST.
    const METHOD: Record<string, Method> = {
      'customer-directory': 'POST',
      'customer-vehicles': 'GET',
      'dashboard-summary': 'GET',
      receptions: 'POST',
      vehicles: 'POST',
      'work-orders': 'POST',
    };
    for (const route of routes) {
      const source = code(readFileSync(join(READS_DIR, route, 'route.ts'), 'utf8'));
      const exported = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)]
        .map((match) => match[1])
        .sort();
      expect(exported, route).toEqual([METHOD[route]]);
      expect(source, route).toContain(`input: '${METHOD[route] === 'POST' ? 'body' : 'query'}'`);
      expect(FAMILIES.find((family) => family.route === `/reads/${route}`)?.method, route).toBe(
        METHOD[route]
      );
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

  it('retired six of the seven Server Actions, and nothing calls the seventh', () => {
    const CALLS =
      /\b(listReceptions|listWorkOrders|readDashboardSummary|searchCustomerDirectory|searchVehicles|listCustomerVehicles)\s*\(/;
    const files = globSync(['**/*.ts', '**/*.tsx'], { cwd: WEB_SRC, absolute: true });
    // Every module, the Server Action modules included: a declaration is a call
    // site's shape too, so an action that came back would be found either way.
    const offenders = files
      .filter((file) => CALLS.test(code(readFileSync(file, 'utf8'))))
      .map((file) => relative(WEB_SRC, file));
    expect(offenders).toEqual([]);
    // The three modules that held nothing else are gone.
    for (const gone of [
      join(WEB_SRC, 'features', 'overview', 'api.ts'),
      join(WEB_SRC, 'lib', 'customers', 'directory.ts'),
      join(WEB_SRC, 'lib', 'customers', 'vehicles.ts'),
    ]) {
      expect(existsSync(gone), relative(WEB_SRC, gone)).toBe(false);
    }
    // `searchCustomers` stays declared in exactly one module — kept only for the
    // coverage baseline's file count, see its docblock — and is called nowhere.
    const declaring = files
      .filter((file) => /\bsearchCustomers\s*\(/.test(code(readFileSync(file, 'utf8'))))
      .map((file) => relative(WEB_SRC, file).split(sep).join('/'));
    expect(declaring).toEqual(['features/crm/customers/api.ts']);
    const declaration = code(
      readFileSync(join(WEB_SRC, 'features', 'crm', 'customers', 'api.ts'), 'utf8')
    );
    expect(declaration.match(/\bsearchCustomers\s*\(/g)).toHaveLength(1);
    expect(declaration).toContain('export async function searchCustomers(');
    // The detector finds what it is for.
    expect(CALLS.test('export async function listReceptions(scope)')).toBe(true);
    expect(CALLS.test('listReceptionsCancellable(scope)')).toBe(false);
  });
});
