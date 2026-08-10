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
const { ApiClient } = await import('@/lib/api/client');
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

  it('says a value is already used, and does NOT say which', async () => {
    /*
     * `P1-27-FE-020`'s third leg. The generic conflict copy — "Someone else
     * changed this" — is not what happened on a create and is not something an
     * operator can act on, so the message is replaced. What is NOT done is
     * naming the field.
     *
     * An earlier version of this case asserted `fieldErrors.vin` on the premise
     * that the active-VIN collision is the only 409 `POST /vehicles` raises.
     * `veh.vehicles` carries TWO tenant-scoped unique indexes —
     * `uq_vehicles_active_vin` and `uq_vehicles_active_display_number` — and
     * `mapWriteConflict` branches on SQLSTATE alone without reading the
     * constraint name, so a duplicate REFERENCE NUMBER produces the identical
     * 409 and would have been rendered as "This VIN is already used", beside
     * the VIN field, about a value the operator did not duplicate.
     */
    send.mockResolvedValue(failure('conflict'));
    const result = await createVehicleAction({ status: 'idle' }, form({ vin: 'DUP' }));
    expect(result.status).toBe('conflict');
    expect(result.messageKey).toBe('vehicles.create.conflict');
    // The assertion that keeps it honest: no field is accused.
    expect(result.fieldErrors?.vin).toBeUndefined();
    expect(result.fieldErrors?.displayNumber).toBeUndefined();
  });

  it('leaves every other failure kind alone', async () => {
    for (const kind of ['validation', 'forbidden', 'rate-limited', 'server'] as const) {
      send.mockResolvedValue(failure(kind));
      const result = await createVehicleAction({ status: 'idle' }, form({ vin: 'ABC' }));
      expect(result.messageKey, kind).not.toBe('vehicles.create.conflict');
    }
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

/**
 * The `idempotent replay` path of the canonical 18-path matrix
 * (`canonical-plan.md` §6) — driven as far as this tier honestly reaches, and
 * NO further.
 *
 * ## What the matrix says is missing, and what these cases add
 *
 * The recorded reason is: "the key is proved on the wire; no P1-27 request is
 * replayed with effects counted as a DELTA." Both halves are accurate.
 * `tests/api-client.test.ts` proves a key reaches the wire, that a caller key is
 * preferred, and that two calls mint two keys. None of that is a replay: a
 * replay is the SAME request presented TWICE under ONE key, and until these
 * cases nothing in `apps/web` presented one.
 *
 * So here a real P1-27 write — `createVehicleAction`, `veh.vehicle-create`,
 * `idempotent: true`, `auditClass: privileged` — is driven through the real
 * `ApiClient` over a transport that arbitrates by key the way `route-handler.ts`
 * and `withIdempotency` do: no key is `400 ERR-INT-002`; a key never seen
 * executes and is reserved; the same key with the same payload replays the
 * stored body and executes nothing; the same key with a DIFFERENT payload is
 * `409 ERR-INT-001` and executes neither version.
 *
 * Everything is counted as a DELTA around the replay, never as an absolute —
 * the precedent is `tests/backend/p1-14-idempotency-replay.test.ts`, and its
 * reason applies unchanged: "an absolute count would pass just as happily if the
 * command had written nothing at all, which is the failure mode these tests are
 * supposed to catch." Three counters move here: requests issued, distinct keys
 * on the wire, and vehicles created.
 *
 * ## The honest limit — this does NOT discharge the path
 *
 * Two things are true of the deltas above and must be said plainly rather than
 * rounded up:
 *
 *  1. **The side-effect counter is this file's own fixture.** `createdVehicles`
 *     is a fake array in a fake backend. That a replay creates no second row,
 *     writes no second audit record and publishes no second outbox event is a
 *     property of `veh.vehicle-create` in PostgreSQL, and nothing at this tier
 *     can observe it. `p1-14-idempotency-replay.test.ts` counts those four
 *     durable consequences against a real database for ten IAM operations; **no
 *     equivalent exists for any CRM or Vehicle operation**, and this file does
 *     not become one by naming it.
 *  2. **No production code path replays.** The replay below is issued through
 *     `client.send(..., { idempotencyKey })`, because no P1-27 adapter accepts a
 *     key — `grep idempotencyKey src/` finds it in `client.ts` and nowhere else.
 *     `createVehicleAction` mints a fresh key per invocation, deliberately and
 *     correctly ("one send is one logical attempt"), so a double-submit is two
 *     attempts and not a replay. The deliberate re-presentation the backend's
 *     keys exist for is a capability of the client that no screen currently
 *     uses.
 *
 * What these cases DO prove, at full strength, is the client half that a real
 * replay depends on: a caller-supplied key survives to the wire unchanged across
 * the replay, and one `send` is exactly one request. If either failed, every
 * replay in this application would silently become a second logical attempt —
 * which for `veh.vehicle-create` means a second vehicle.
 */
describe('a deliberate replay, counted as a delta rather than asserted as a flag', () => {
  interface WireAttempt {
    readonly method: string;
    readonly path: string;
    readonly key: string | null;
    readonly body: string | null;
  }

  interface FakeBackend {
    readonly wire: WireAttempt[];
    readonly createdVehicles: string[];
    readonly fetchImpl: typeof fetch;
  }

  /** As `route-handler.ts` behaves for an operation registered `idempotent`. */
  function backendThatArbitratesByKey(): FakeBackend {
    const wire: WireAttempt[] = [];
    const createdVehicles: string[] = [];
    const reservations = new Map<string, { readonly payload: string; readonly body: unknown }>();

    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    const fetchImpl = (async (input: unknown, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const headers = new Headers(init.headers as HeadersInit);
      const body = typeof init.body === 'string' ? init.body : null;
      wire.push({
        method: String(init.method ?? 'GET'),
        path: `${url.pathname}${url.search}`,
        key: headers.get('idempotency-key'),
        body,
      });

      const key = headers.get('idempotency-key');
      // `requireIdempotencyKey` answers this BEFORE permissions are evaluated.
      if (key === null) {
        return json(400, { code: 'ERR-INT-002', status: 400, title: 'Idempotency key required' });
      }

      const held = reservations.get(key);
      if (held) {
        // A key issued for one command may not be grafted onto another.
        if (held.payload !== (body ?? '')) {
          return json(409, { code: 'ERR-INT-001', status: 409, title: 'Idempotency key reused' });
        }
        // The stored body, and NOTHING executed. Status 200 on replay, as
        // `withIdempotency` rebuilds it — measured in the P1-14 suite.
        return json(200, held.body);
      }

      const vehicleId = `veh-${createdVehicles.length + 1}`;
      createdVehicles.push(vehicleId);
      const created = {
        vehicleId,
        lifecycleStatus: 'draft',
        powertrainCategory: 'ice',
        hasVin: true,
      };
      reservations.set(key, { payload: body ?? '', body: created });
      return json(201, created);
    }) as unknown as typeof fetch;

    return { wire, createdVehicles, fetchImpl };
  }

  function clientOver(backend: FakeBackend) {
    const real = new ApiClient({
      baseUrl: 'https://api.invalid',
      fetchImpl: backend.fetchImpl,
      newCorrelationId: () => 'corr-replay',
    });
    authorizedClient.mockResolvedValue(real as unknown);
    return real;
  }

  const keysOn = (wire: readonly WireAttempt[]) => new Set(wire.map((attempt) => attempt.key)).size;

  it('the adapter reaches the wire with a key at all, or nothing below means anything', async () => {
    const backend = backendThatArbitratesByKey();
    clientOver(backend);

    const result = await createVehicleAction(
      { status: 'idle' },
      form({ vin: 'JH4KA7561PC008269' })
    );

    // The control for every delta below: the write really executed against the
    // fake backend, so a later delta of zero is a replay rather than a no-op.
    expect(result.status).toBe('success');
    expect(backend.wire).toHaveLength(1);
    expect(backend.createdVehicles).toEqual(['veh-1']);
    expect(backend.wire[0]?.key, 'the adapter reached the wire with no key').toBeTruthy();
  });

  it('re-presenting the SAME key issues one more request and creates NO second vehicle', async () => {
    const backend = backendThatArbitratesByKey();
    const real = clientOver(backend);
    await createVehicleAction({ status: 'idle' }, form({ vin: 'JH4KA7561PC008269' }));

    const sent = backend.wire[0] as WireAttempt;
    const requestsBefore = backend.wire.length;
    const vehiclesBefore = backend.createdVehicles.length;
    const keysBefore = keysOn(backend.wire);

    // The replay. The adapter's own request — its method, its path, its body —
    // re-presented under the key it already carried.
    const replay = await real.send<{ vehicleId: string }>(
      'POST',
      sent.path,
      JSON.parse(sent.body as string),
      { idempotencyKey: sent.key as string }
    );

    expect(replay.ok, 'the replay was refused').toBe(true);

    // Delta 1 — REQUESTS. Exactly one. The client neither suppressed the replay
    // client-side (which would make the key pointless) nor retried it (a
    // retried mutation is the defect the module note forbids outright).
    expect(
      backend.wire.length - requestsBefore,
      'one send did not produce exactly one request'
    ).toBe(1);

    // Delta 2 — DISTINCT KEYS. Zero. The replay carried the first attempt's key
    // rather than a fresh one, which is the whole of what makes it a replay.
    expect(keysOn(backend.wire) - keysBefore, 'the replay minted a NEW key').toBe(0);
    expect(backend.wire.at(-1)?.key).toBe(sent.key);

    // Delta 3 — EFFECTS, as far as this tier can see them. Zero. Read the
    // docblock: this counter is a fixture, not a database.
    expect(
      backend.createdVehicles.length - vehiclesBefore,
      'the replay executed the command a second time'
    ).toBe(0);
    // And it answered with the FIRST attempt's record, not a new one.
    expect(replay.ok && replay.data.vehicleId).toBe('veh-1');
  });

  it('a second ATTEMPT is not a replay: a new key, and a second vehicle', async () => {
    /*
     * The case that keeps the one above honest. Without it, every delta of zero
     * there would also be satisfied by a backend fixture that never created
     * anything and a client that never sent a key.
     *
     * It is also the shipped behaviour of a double-submit, stated on purpose:
     * `createVehicleAction` mints a fresh key per invocation, so two submissions
     * are two vehicles. That is correct for a client that never retries, and it
     * is the reason a genuine replay has to be a deliberate act.
     */
    const backend = backendThatArbitratesByKey();
    clientOver(backend);

    await createVehicleAction({ status: 'idle' }, form({ vin: 'JH4KA7561PC008269' }));
    const vehiclesBefore = backend.createdVehicles.length;
    const keysBefore = keysOn(backend.wire);

    await createVehicleAction({ status: 'idle' }, form({ vin: 'JH4KA7561PC008269' }));

    expect(keysOn(backend.wire) - keysBefore, 'the second attempt reused the first key').toBe(1);
    expect(backend.createdVehicles.length - vehiclesBefore).toBe(1);
    expect(backend.createdVehicles).toEqual(['veh-1', 'veh-2']);
  });

  it('the same key with a DIFFERENT payload is refused, and executes neither version', async () => {
    /*
     * The third leg of the P1-14 precedent. Without it, "idempotent" could be
     * implemented as "ignore the body and replay whatever is stored", which
     * would let a key issued for one command be grafted onto another. The
     * alternative payload is independently valid — it would succeed under a
     * fresh key — so the refusal can only come from the key comparison.
     */
    const backend = backendThatArbitratesByKey();
    const real = clientOver(backend);
    await createVehicleAction({ status: 'idle' }, form({ vin: 'JH4KA7561PC008269' }));

    const sent = backend.wire[0] as WireAttempt;
    const vehiclesBefore = backend.createdVehicles.length;

    const grafted = await real.send(
      'POST',
      sent.path,
      { vin: 'DIFFERENTVIN00001' },
      {
        idempotencyKey: sent.key as string,
      }
    );

    expect(grafted.ok).toBe(false);
    expect(grafted.ok === false && grafted.status).toBe(409);
    expect(backend.createdVehicles.length - vehiclesBefore, 'a grafted key executed').toBe(0);
  });

  it('the fixture really refuses a keyless request, so its arbitration is not decoration', async () => {
    /*
     * Two things at once.
     *
     * The fixture's `key === null` branch would otherwise be unreachable code
     * asserting nothing, and a fake backend whose refusal path never runs is not
     * a model of `requireIdempotencyKey` — it is a comment shaped like one.
     * `P1-26-F-015` is what that branch represents: every idempotent operation
     * failed 100% of the time because no call site attached a header, and the
     * 400 surfaced as a validation banner naming no field.
     *
     * The way in is an EMPTY caller key, which is the one input that reaches the
     * wire keyless: `options.idempotencyKey ?? …` treats `''` as supplied — it
     * is not nullish — and `if (idempotencyKey)` then omits the header. So an
     * empty string is neither the caller's key nor the default. Recorded as an
     * observation of a narrow edge no call site produces today, not blessed:
     * nothing in `src/` passes this option at all.
     */
    const backend = backendThatArbitratesByKey();
    const real = clientOver(backend);

    const keyless = await real.send(
      'POST',
      '/api/v1/vehicles',
      { vin: 'JH4KA7561PC008269' },
      { idempotencyKey: '' }
    );

    expect(backend.wire.at(-1)?.key, 'a key reached the wire after all').toBeNull();
    expect(keyless.ok).toBe(false);
    expect(keyless.ok === false && keyless.problem?.code).toBe('ERR-INT-002');
    expect(backend.createdVehicles, 'a keyless request executed').toEqual([]);
  });
});
