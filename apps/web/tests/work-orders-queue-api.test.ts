import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The work-order board ADAPTER (P1-29, `W1`) — `listWorkOrders`.
 *
 * ## Why this file exists at all
 *
 * A DOM test of the screen mocks this module wholesale, so it exercises the
 * screen and CANNOT exercise the adapter. That is not a supposition here: the
 * CRM profile adapters carry the same note, and it was proved by mutation —
 * hard-coding a mapped field left twenty DOM tests green. A layer that survives
 * its own mutation is a layer nothing is testing.
 *
 * So this talks to the adapter directly with only the HTTP client mocked, and
 * the row it feeds through is the shape the BACKEND really answers with. That
 * shape is not taken on trust either: `tests/backend/p1-29-w1-work-order-queue`
 * parses the same contract mirror and holds it against a row that came out of
 * the database, so the two halves of the chain meet on a checked shape rather
 * than on two independent guesses.
 *
 * ## The distinction this file exists to protect
 *
 * A refusal is not an empty board. If a 403 ever maps to `ok` with zero rows, an
 * operator is told "this branch has no work orders" — a false statement about
 * the business — when the truth is "you may not read this".
 */

const get = vi.fn();
const client = { get };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const { listWorkOrders, readWorkOrderCatalogue } = await import('@/features/work-orders/api');

const TARGET = {
  companyId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
} as const;

/** One published row. Every field is one the backend really returns. */
const ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  companyId: TARGET.companyId,
  branchId: TARGET.branchId,
  receptionVisitId: '44444444-4444-4444-8444-444444444444',
  vehicleId: '55555555-5555-4555-8555-555555555555',
  kind: 'ordinary',
  state: 'open',
  partsForwardState: 'none',
  displayNumber: 'WO-000123',
  openedAt: '2026-09-01T09:30:00.000Z',
  recordVersion: 1,
  customer: {
    partnerId: '66666666-6666-4666-8666-666666666666',
    displayName: 'A registered partner',
    relationshipRole: 'service_requester',
    hasAdditionalParties: false,
  },
  vehicle: {
    vehicleId: '55555555-5555-4555-8555-555555555555',
    registrationPlate: 'ABC-1234',
    makeModel: 'A make and model',
  },
  // The three fields the Owner directive added to the published row. Present
  // here because they are present there: a fixture that omitted them would let
  // an adapter that dropped them pass.
  assignedTechnician: { id: '77777777-7777-4777-8777-777777777777', displayName: null },
  completedAt: null,
  qualityState: null,
};

const REQUEST = { pageSize: 25 } as never;

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });

beforeEach(() => {
  get.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('listWorkOrders maps a published page onto table rows', () => {
  it('carries the row through unchanged, with the server’s own end-of-set signals', async () => {
    get.mockResolvedValue(ok({ items: [ROW], nextCursor: 'cur-2', hasMore: true }));

    const result = await listWorkOrders(TARGET, {}, REQUEST, null);

    expect(result.status).toBe('ok');
    expect(result.rows).toHaveLength(1);
    // Field by field rather than a reference comparison: `toBe` on the same
    // object would pass even if the adapter rebuilt the row and dropped half of
    // it, because it would be comparing the fixture to itself.
    expect(result.rows[0]).toEqual(ROW);
    expect(result.rows[0]?.customer?.relationshipRole).toBe('service_requester');
    expect(result.rows[0]?.vehicle.registrationPlate).toBe('ABC-1234');
    expect(result.nextCursor).toBe('cur-2');
    expect(result.hasMore).toBe(true);
    expect(result.correlationId).toBe('corr-1');
  });

  it('renders the null customer as null instead of failing on it', async () => {
    // A visit may legitimately name no service requester, so this is a real
    // state of the data and not an error the screen should hide.
    get.mockResolvedValue(
      ok({ items: [{ ...ROW, customer: null }], nextCursor: null, hasMore: false })
    );

    const result = await listWorkOrders(TARGET, {}, REQUEST, null);

    expect(result.status).toBe('ok');
    expect(result.rows[0]?.customer).toBeNull();
  });

  it('sends the branch pair as a TARGET, and the criteria beside it', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));

    await listWorkOrders(
      TARGET,
      { kind: 'rework', state: 'awaiting_parts' },
      REQUEST,
      'cursor-from-the-server'
    );

    const path = String(get.mock.calls[0]?.[0]);
    expect(path).toContain(`companyId=${TARGET.companyId}`);
    expect(path).toContain(`branchId=${TARGET.branchId}`);
    expect(path).toContain('kind=rework');
    expect(path).toContain('state=awaiting_parts');
    expect(path).toContain('cursor=cursor-from-the-server');
    expect(path).toContain('limit=25');

    // A board is an `expensive-read` at the backend. Re-running it for an
    // operator under a rate limit they cannot see is not a kindness.
    expect(get.mock.calls[0]?.[1]).toEqual({ retries: 0 });
  });

  it('omits a criterion that was not chosen rather than sending it empty', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));

    await listWorkOrders(TARGET, {}, REQUEST, null);

    const path = String(get.mock.calls[0]?.[0]);
    expect(path).not.toContain('kind=');
    expect(path).not.toContain('state=');
    // `.strict()` at the backend means an empty-but-present parameter is a 422,
    // not a silent ignore, so "not sent" has to mean not sent.
    expect(path).not.toContain('customerId=');
    expect(path).not.toContain('number=');
    expect(path).not.toContain('q=');
  });

  it('sends the P1-32 number and free-text criteria as typed, beside the target', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));

    await listWorkOrders(TARGET, { number: '١٢٣', q: 'Nadia' }, REQUEST, null);

    const url = new URL(`https://api.invalid${String(get.mock.calls[0]?.[0])}`);
    expect(url.searchParams.get('companyId')).toBe(TARGET.companyId);
    expect(url.searchParams.get('branchId')).toBe(TARGET.branchId);
    // Not folded here: the backend folds Arabic-Indic digits itself.
    expect(url.searchParams.get('number')).toBe('١٢٣');
    expect(url.searchParams.get('q')).toBe('Nadia');
  });

  it('a REFUSAL is a refusal, never an empty board', async () => {
    get.mockResolvedValue(failure('forbidden'));

    const result = await listWorkOrders(TARGET, {}, REQUEST, null);

    // Both halves asserted: the status must be the denial, AND it must not be
    // the success that an empty list would be rendered as.
    expect(result.status).toBe('denied');
    expect(result.status).not.toBe('ok');
    expect(result.rows).toEqual([]);
    expect(result.correlationId).toBe('corr-1');
  });

  it('maps every transport outcome to a state the table can render', async () => {
    for (const [kind, expected] of [
      ['unauthenticated', 'expired'],
      ['not-found', 'not-found'],
      ['rate-limited', 'unavailable'],
      ['server', 'error'],
      ['network', 'unavailable'],
      ['timeout', 'unavailable'],
    ] as const) {
      get.mockReset();
      get.mockResolvedValue(failure(kind));
      const result = await listWorkOrders(TARGET, {}, REQUEST, null);
      expect(result.status, `${kind} mapped wrong`).toBe(expected);
      expect(result.rows).toEqual([]);
    }
  });

  it('does not call the backend at all without a session', async () => {
    authorizedClient.mockResolvedValue(null);

    const result = await listWorkOrders(TARGET, {}, REQUEST, null);

    expect(result.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

/**
 * The board scope and the board flags (Owner directive, `P1-32-PRE-OD-UX`).
 *
 * Two contract changes meet in this adapter and both are easy to get quietly
 * wrong. An absent branch must be OMITTED rather than sent blank — the route
 * reads an omission as "every branch of this company I may read" and a blank
 * value as a malformed reference. And a flag turned OFF must travel as the
 * literal word, because the route parses `'true'`/`'false'` and a coerced
 * boolean would make every non-empty string true.
 */
describe('the branch may be left unnamed, and that is a request', () => {
  it('sends the company alone when no branch is named', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));

    await listWorkOrders({ companyId: TARGET.companyId, branchId: null }, {}, REQUEST, null);

    const url = new URL(`https://api.invalid${String(get.mock.calls[0]?.[0])}`);
    expect(url.searchParams.get('companyId')).toBe(TARGET.companyId);
    // Omitted, not blank. A blank one would be a malformed reference at the
    // backend and a 422 far from the mistake.
    expect(url.searchParams.has('branchId')).toBe(false);
    expect(String(get.mock.calls[0]?.[0])).not.toContain('branchId=');
  });

  it('refuses a blank company rather than asking for everything', async () => {
    await expect(
      listWorkOrders({ companyId: '', branchId: null }, {}, REQUEST, null)
    ).rejects.toThrow(/companyId/);
  });

  it('still refuses a scope key smuggled among the filters', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await expect(
      listWorkOrders(TARGET, { state: 'open', branchId: 'forged' } as never, REQUEST, null)
    ).resolves.toBeDefined();
    // The criteria are named one by one in the adapter, so an unknown key is
    // never handed to the query builder at all — which is why the call above
    // succeeds and the forged value simply does not travel.
    expect(String(get.mock.calls[0]?.[0])).not.toContain('forged');
  });
});

describe('a board flag is three-valued on the wire', () => {
  it('sends the literal word for a flag that was asked for', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));

    await listWorkOrders(
      TARGET,
      {
        assignedToMe: true,
        awaitingParts: true,
        awaitingApproval: true,
        awaitingQuality: true,
        readyForDelivery: true,
      },
      REQUEST,
      null
    );

    const url = new URL(`https://api.invalid${String(get.mock.calls[0]?.[0])}`);
    for (const flag of [
      'assignedToMe',
      'awaitingParts',
      'awaitingApproval',
      'awaitingQuality',
      'readyForDelivery',
    ]) {
      expect(url.searchParams.get(flag), flag).toBe('true');
    }
  });

  it('distinguishes a flag turned OFF from a flag nobody asked about', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));

    await listWorkOrders(TARGET, { assignedToMe: false }, REQUEST, null);

    const url = new URL(`https://api.invalid${String(get.mock.calls[0]?.[0])}`);
    // OFF is a request. The route reads the word, so this must be the word and
    // not an omission — and not an empty value, which the query builder drops.
    expect(url.searchParams.get('assignedToMe')).toBe('false');
    // The four nobody mentioned are absent entirely.
    for (const flag of [
      'awaitingParts',
      'awaitingApproval',
      'awaitingQuality',
      'readyForDelivery',
    ]) {
      expect(url.searchParams.has(flag), flag).toBe(false);
    }
  });
});

describe('the state catalogue read the board labels its rows from', () => {
  it('asks the tenant-scoped catalogue with no parameters at all', async () => {
    get.mockResolvedValue(
      ok({
        workOrderStates: [
          { code: 'open', name: 'Open', isTerminal: false, isClosed: false, isCancellation: false },
        ],
        jobStates: [],
        workOrderTransitions: [],
        jobTransitions: [],
      })
    );

    const read = await readWorkOrderCatalogue();

    // `.strict()` and deliberately empty: a cursor or a limit here would imply a
    // page boundary the catalogue does not have.
    expect(String(get.mock.calls[0]?.[0])).toBe('/api/v1/work-order-catalogue');
    expect(read.status).toBe('ok');
    expect(read.status === 'ok' ? read.data.workOrderStates[0]?.code : null).toBe('open');
  });

  it('answers a refusal as a refusal, so a board can go on rendering codes', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const read = await readWorkOrderCatalogue();
    expect(read.status).toBe('denied');
  });
});
