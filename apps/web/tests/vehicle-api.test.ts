import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Vehicle search and catalogue ADAPTERS (`FE-017`, `FE-018`).
 *
 * A DOM test that mocks these modules exercises the screens and cannot exercise
 * the adapters — proven in Wave 5, where mutating an adapter left twenty green
 * component tests untouched. This file talks to them directly with only the HTTP
 * client mocked.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const { searchVehicles, createVehicleAction } = await import('@/features/vehicles/api');
const { listMakes, listModels, listTrims, listBodyTypes, listPowertrainTypes } =
  await import('@/features/vehicles/catalogue-api');
const { EMPTY_CRITERIA } = await import('@/features/vehicles/contract');

const REQUEST = { pageSize: 25 } as never;

function page(items: readonly unknown[], nextCursor: string | null = null, hasMore = false) {
  return { ok: true as const, data: { items, nextCursor, hasMore }, correlationId: 'corr-1' };
}

function failure(kind: string) {
  return { ok: false as const, kind, correlationId: 'corr-1' };
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
}

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('search never issues a request it was not asked for', () => {
  it('sends NOTHING for empty criteria', async () => {
    const result = await searchVehicles(EMPTY_CRITERIA, REQUEST, null);
    expect(get).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
    expect(result.rows).toEqual([]);
  });

  it('sends nothing when every criterion is whitespace', async () => {
    await searchVehicles({ ...EMPTY_CRITERIA, vin: '   ', plate: '\t' }, REQUEST, null);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the search request carries only what the strict schema accepts', () => {
  it('sends the supplied criteria and omits the rest', async () => {
    get.mockResolvedValue(page([]));
    await searchVehicles(
      { ...EMPTY_CRITERIA, vin: ' 1HGCM8 ', lifecycleStatus: 'active' },
      REQUEST,
      null
    );

    const [path] = get.mock.calls[0] as [string];
    expect(path).toContain('vin=1HGCM8');
    expect(path).toContain('lifecycleStatus=active');
    // Absent, not empty — `?plate=` would be a 422 for the whole request.
    expect(path).not.toContain('plate=');
    expect(path).not.toContain('vehicleNumber=');
  });

  it('never sends a sort, page, offset or total parameter', async () => {
    get.mockResolvedValue(page([]));
    await searchVehicles({ ...EMPTY_CRITERIA, vin: 'X' }, REQUEST, null);
    const [path] = get.mock.calls[0] as [string];
    for (const forbidden of ['sort=', 'page=', 'offset=', 'total=', 'order=']) {
      expect(path).not.toContain(forbidden);
    }
  });

  it('never retries — search is expensive-read at 30/min', async () => {
    get.mockResolvedValue(page([]));
    await searchVehicles({ ...EMPTY_CRITERIA, vin: 'X' }, REQUEST, null);
    const [, options] = get.mock.calls[0] as [string, { retries: number }];
    expect(options.retries).toBe(0);
  });

  it('propagates the cursor verbatim', async () => {
    get.mockResolvedValue(page([]));
    const cursor = 'eyJrIjoidmVoLnZlaGljbGVzOmNyZWF0ZWRfYXRfZGVzYyJ9';
    await searchVehicles({ ...EMPTY_CRITERIA, vin: 'X' }, REQUEST, cursor);
    const [path] = get.mock.calls[0] as [string];
    // Encoded, never reconstructed. A cursor rebuilt from a published
    // millisecond timestamp is exactly the row loss `P1-27-INT-008` fixed.
    expect(path).toContain(encodeURIComponent(cursor));
  });
});

describe('the search response is passed through without embellishment', () => {
  it('publishes no total', async () => {
    get.mockResolvedValue(page([{ id: 'v1' }], 'cur', true));
    const result = await searchVehicles({ ...EMPTY_CRITERIA, vin: 'X' }, REQUEST, null);
    expect(result).not.toHaveProperty('total');
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('cur');
  });

  it('preserves mergedIntoId so a merged vehicle is distinguishable', async () => {
    get.mockResolvedValue(page([{ id: 'v1', mergedIntoId: 'v2', lifecycleStatus: 'merged' }]));
    const result = await searchVehicles({ ...EMPTY_CRITERIA, vin: 'X' }, REQUEST, null);
    expect(result.rows[0]).toMatchObject({ mergedIntoId: 'v2' });
  });

  it('preserves a null VIN and a null model year rather than coercing them', async () => {
    get.mockResolvedValue(page([{ id: 'v1', vin: null, modelYear: null, makeId: null }]));
    const result = await searchVehicles({ ...EMPTY_CRITERIA, vin: 'X' }, REQUEST, null);
    expect(result.rows[0]).toMatchObject({ vin: null, modelYear: null, makeId: null });
  });

  it('maps every failure kind to a status, never undefined', async () => {
    for (const kind of [
      'unauthenticated',
      'forbidden',
      'not-found',
      'conflict',
      'validation',
      'rate-limited',
      'server',
      'unavailable',
      'timeout',
      'cancelled',
      'network',
    ]) {
      get.mockResolvedValue(failure(kind));
      const result = await searchVehicles({ ...EMPTY_CRITERIA, vin: 'X' }, REQUEST, null);
      expect(result.status, `kind ${kind}`).toBeTypeOf('string');
      expect(result.rows, `kind ${kind}`).toEqual([]);
    }
  });

  it('reports an expired session without calling the API', async () => {
    authorizedClient.mockResolvedValue(null);
    const result = await searchVehicles({ ...EMPTY_CRITERIA, vin: 'X' }, REQUEST, null);
    expect(result.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the catalogue adapter walks pages and reports its own bound', () => {
  it('concatenates every page', async () => {
    get
      .mockResolvedValueOnce(page([{ id: 'a', name: 'Alpha' }], 'c1', true))
      .mockResolvedValueOnce(page([{ id: 'b', name: 'Bravo' }], null, false));

    const result = await listMakes();
    expect(result.status).toBe('ok');
    expect(result.options.map((o) => o.name)).toEqual(['Alpha', 'Bravo']);
    expect(result.truncated).toBe(false);
  });

  it('stops at the bound and SAYS the list is incomplete', async () => {
    // A backend that always reports `hasMore` must not hang the form, and a
    // partial catalogue must not be presented as the whole one.
    get.mockResolvedValue(page([{ id: 'x', name: 'X' }], 'c', true));
    const result = await listMakes();
    expect(result.truncated).toBe(true);
    expect(get).toHaveBeenCalledTimes(20);
  });

  it('encodes the parent id into the nested path', async () => {
    get.mockResolvedValue(page([]));
    await listModels('../../admin');
    const [path] = get.mock.calls[0] as [string];
    expect(path).not.toContain('../');
    expect(path).toContain('%2F');
    expect(path).toContain('/vehicle-catalogue/makes/');
    expect(path).toContain('/models');
  });

  it('reports a failure rather than an empty catalogue', async () => {
    // An empty list and a failed read say different things to an operator: one
    // means "nothing configured", the other means "we could not find out".
    get.mockResolvedValue(failure('forbidden'));
    const result = await listMakes();
    expect(result.status).toBe('denied');
    expect(result.options).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe('all FIVE catalogue adapters, not the two that happened to be imported', () => {
  /*
   * `QA-002`'s exclusion map cited this file as the coverage for `listTrims`,
   * `listBodyTypes` and `listPowertrainTypes`. It imported none of them: their
   * only other appearances anywhere in the suite were as `vi.fn()` stubs that
   * mock the real adapter away. Three adapters `VehicleCreateScreen` actually
   * calls had no path, failure-mapping or bound coverage at all, hidden behind a
   * citation that named a file rather than a behaviour.
   *
   * The citation is now true. Each adapter is driven here on its own.
   */
  const CASES = [
    { name: 'listTrims', call: () => listTrims('m1'), path: '/vehicle-catalogue/models/' },
    { name: 'listBodyTypes', call: () => listBodyTypes(), path: '/vehicle-catalogue/body-types' },
    {
      name: 'listPowertrainTypes',
      call: () => listPowertrainTypes(),
      path: '/vehicle-catalogue/powertrain-types',
    },
  ] as const;

  it.each(CASES)('$name reads its own operation path', async ({ call, path }) => {
    get.mockResolvedValue(page([{ id: 'a', name: 'Alpha' }]));
    const result = await call();
    expect(result.status).toBe('ok');
    expect(result.options.map((o) => o.name)).toEqual(['Alpha']);
    const [requested] = get.mock.calls[0] as [string];
    expect(requested).toContain(path);
  });

  it.each(CASES)('$name reports a denial rather than an empty catalogue', async ({ call }) => {
    get.mockResolvedValue(failure('forbidden'));
    const result = await call();
    expect(result.status).toBe('denied');
    expect(result.options).toEqual([]);
  });

  it.each(CASES)('$name stops at the page bound and says so', async ({ call }) => {
    get.mockResolvedValue(page([{ id: 'x', name: 'X' }], 'c', true));
    const result = await call();
    expect(result.truncated).toBe(true);
    expect(get).toHaveBeenCalledTimes(20);
  });

  it('encodes the model id into the trims path rather than concatenating it', async () => {
    get.mockResolvedValue(page([]));
    await listTrims('../../admin');
    const [path] = get.mock.calls[0] as [string];
    expect(path).not.toContain('../');
    expect(path).toContain('%2F');
    expect(path).toContain('/trims');
  });
});

describe('creation sends the schema shape', () => {
  it('converts the model year to a NUMBER', async () => {
    send.mockResolvedValue({ ok: true, data: { vehicleId: 'v1' }, correlationId: 'c' });
    await createVehicleAction({ status: 'idle' }, form({ modelYear: '2019' }));
    const [, , body] = send.mock.calls[0] as [string, string, Record<string, unknown>];
    // `z.number()` rejects the string a form field yields, so an unconverted
    // value would be a 422 the operator could not act on.
    expect(body.modelYear).toBe(2019);
    expect(typeof body.modelYear).toBe('number');
  });

  it('omits every untouched field rather than sending empty strings', async () => {
    send.mockResolvedValue({ ok: true, data: { vehicleId: 'v1' }, correlationId: 'c' });
    await createVehicleAction(
      { status: 'idle' },
      form({ vin: 'ABC', color: '', displayNumber: '  ' })
    );
    const [, , body] = send.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(body).toEqual({ vin: 'ABC' });
    expect(Object.keys(body)).not.toContain('color');
    expect(Object.keys(body)).not.toContain('displayNumber');
  });

  it('posts to the vehicles collection', async () => {
    send.mockResolvedValue({ ok: true, data: { vehicleId: 'v1' }, correlationId: 'c' });
    await createVehicleAction({ status: 'idle' }, form({ vin: 'ABC' }));
    const [method, path] = send.mock.calls[0] as [string, string];
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/vehicles');
  });

  it('does NOT set an Idempotency-Key itself', async () => {
    send.mockResolvedValue({ ok: true, data: { vehicleId: 'v1' }, correlationId: 'c' });
    await createVehicleAction({ status: 'idle' }, form({ vin: 'ABC' }));
    // The key comes from the shared contract-derived authority inside the
    // client. A second idempotency authority is the shape of P1-27-INT-003,
    // not its fix — so this action must pass exactly three arguments.
    expect(send.mock.calls[0]).toHaveLength(3);
  });

  it('surfaces a 409 rather than reinterpreting it', async () => {
    // `ERR-RES-002` — a live vehicle in this tenant already has that VIN.
    send.mockResolvedValue(failure('conflict'));
    const result = await createVehicleAction({ status: 'idle' }, form({ vin: 'DUP' }));
    expect(result.status).not.toBe('success');
    expect(result.created).toBeUndefined();
  });

  it('does not call the API when the session has expired', async () => {
    authorizedClient.mockResolvedValue(null);
    const result = await createVehicleAction({ status: 'idle' }, form({ vin: 'ABC' }));
    expect(result.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });

  it('returns the created vehicle, including hasVin', async () => {
    send.mockResolvedValue({
      ok: true,
      data: { vehicleId: 'v1', lifecycleStatus: 'draft', powertrainCategory: 'ice', hasVin: true },
      correlationId: 'c',
    });
    const result = await createVehicleAction({ status: 'idle' }, form({ vin: 'ABC' }));
    expect(result.status).toBe('success');
    // `hasVin`, not the VIN — it is `internal`-classified and never echoed.
    expect(result.created).toMatchObject({ hasVin: true, lifecycleStatus: 'draft' });
    expect(result.created).not.toHaveProperty('vin');
  });

  it('increments the attempt counter so a retry is distinguishable', async () => {
    send.mockResolvedValue(failure('server'));
    const first = await createVehicleAction({ status: 'idle' }, form({ vin: 'A' }));
    const second = await createVehicleAction(first, form({ vin: 'A' }));
    expect(second.attempt).toBe((first.attempt ?? 0) + 1);
  });
});
