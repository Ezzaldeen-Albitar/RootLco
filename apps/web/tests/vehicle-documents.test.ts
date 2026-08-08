import { describe, expect, it, vi, beforeEach } from 'vitest';
import { STATUS_BY_KIND } from '@/lib/api/read-operation';

/**
 * The vehicle document ADAPTER (`P1-27-FE-026`, `P1-27-QA-002`).
 *
 * ## Why this file exists
 *
 * `listVehicleDocuments` was in no test at all, and it is not in the
 * `LIST_ADAPTERS` table that `p1-27-qa.test.ts` drives through every failure
 * kind — the table's own case asserts it covers "eighteen list adapters, not a
 * sample of them", which made the omission look like completeness.
 *
 * The reason it was omitted is structural rather than careless: that sweep is
 * keyed to one shape — a paginated `{ status, rows, nextCursor }` list — and this
 * operation takes no `TableRequest` and returns `DocumentsState`. A read adapter
 * with a different response shape simply never got added, and the hand-written
 * count locked the gap in as if it were the full set.
 *
 * ## The state that matters most
 *
 * `not-found` is its own state and must NOT fold into an error. This operation
 * checks the vehicle explicitly and 404s an unknown or cross-tenant id, so a 404
 * means "no such vehicle" — not "this vehicle has no documents". Collapsing them
 * would tell an operator a vehicle they can see has no papers.
 *
 * ## What is NOT tested, deliberately
 *
 * No upload. `P1-OD-025` is an open Owner decision and the frontend gate's
 * `no-upload-path` rule forbids the affordance, so its absence is correct and is
 * asserted in the DOM suite rather than treated as a gap here.
 */

const get = vi.fn();
const client = { get };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const { listVehicleDocuments } = await import('@/features/vehicles/documents-api');

const VEHICLE = 'a1b2c3d4-0000-4000-8000-000000000001';

function ok(data: unknown) {
  return { ok: true as const, data, correlationId: 'corr-1' };
}
function failure(kind: string) {
  return { ok: false as const, kind, correlationId: 'corr-1' };
}

beforeEach(() => {
  get.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('the request the adapter issues', () => {
  it('asks the documents path for this vehicle, encoded', async () => {
    get.mockResolvedValue(ok({ documentIds: [] }));
    await listVehicleDocuments('a b/c');
    const path = String(get.mock.calls[0]?.[0] ?? '');
    expect(path).toBe(`/api/v1/vehicles/${encodeURIComponent('a b/c')}/documents`);
    // Encoded, so an id can never walk to another operation.
    expect(path).not.toContain('a b/c');
  });

  it('sends no cursor, limit or page — the operation accepts none', async () => {
    get.mockResolvedValue(ok({ documentIds: [] }));
    await listVehicleDocuments(VEHICLE);
    const path = String(get.mock.calls[0]?.[0] ?? '');
    // A `.strict()` schema would answer 422 for any of these.
    expect(path).not.toMatch(/[?&](cursor|limit|page|pageSize)=/);
  });

  it('asserts no scope of its own', async () => {
    get.mockResolvedValue(ok({ documentIds: [] }));
    await listVehicleDocuments(VEHICLE);
    const call = JSON.stringify(get.mock.calls[0] ?? []);
    expect(call).not.toMatch(/tenant|company|branch/i);
  });

  it('does not retry, because a document list is not worth a second round trip', async () => {
    get.mockResolvedValue(ok({ documentIds: [] }));
    await listVehicleDocuments(VEHICLE);
    expect(get.mock.calls[0]?.[1]).toEqual({ retries: 0 });
  });
});

describe('every failure kind maps to a state the screen can render', () => {
  const KINDS = Object.keys(STATUS_BY_KIND);

  it('covers every kind the shared table defines', () => {
    // Driven from `STATUS_BY_KIND` rather than a list typed here, so a new kind
    // is covered the day it is added instead of the day somebody remembers.
    expect(KINDS.length).toBeGreaterThanOrEqual(11);
  });

  it.each(KINDS)('maps %s', async (kind) => {
    get.mockResolvedValue(failure(kind));
    const state = await listVehicleDocuments(VEHICLE);

    if (kind === 'not-found') {
      // Its own state, carrying no correlation id — there is nothing to trace,
      // the vehicle simply is not there.
      expect(state).toEqual({ status: 'not-found' });
      return;
    }

    const expected = STATUS_BY_KIND[kind as keyof typeof STATUS_BY_KIND];
    expect(state.status).toBe(expected === 'not-found' ? 'error' : expected);
    // Every failure carries the reference an operator quotes in an incident.
    expect(state).toHaveProperty('correlationId', 'corr-1');
  });

  it('keeps "no such vehicle" apart from "no documents"', async () => {
    get.mockResolvedValue(failure('not-found'));
    const missing = await listVehicleDocuments(VEHICLE);
    get.mockResolvedValue(ok({ documentIds: [] }));
    const empty = await listVehicleDocuments(VEHICLE);

    // The distinction the docblock exists for. Folding them would tell an
    // operator a vehicle they can see has no papers on file.
    expect(missing.status).toBe('not-found');
    expect(empty.status).toBe('ok');
    expect(missing.status).not.toBe(empty.status);
  });
});

describe('an expired session never reaches the network', () => {
  it('returns expired without issuing a request', async () => {
    authorizedClient.mockResolvedValue(null);
    const state = await listVehicleDocuments(VEHICLE);
    expect(state).toEqual({ status: 'expired', correlationId: null });
    // Spending a request on a session known to be gone wastes a rate-limit slot
    // and produces a 401 that says less than the state already does.
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the successful shape', () => {
  it('passes the ids through unchanged', async () => {
    get.mockResolvedValue(ok({ documentIds: ['d1', 'd2'] }));
    const state = await listVehicleDocuments(VEHICLE);
    expect(state).toEqual({ status: 'ok', documentIds: ['d1', 'd2'] });
  });

  it('treats an empty list as a successful read', async () => {
    get.mockResolvedValue(ok({ documentIds: [] }));
    expect(await listVehicleDocuments(VEHICLE)).toEqual({ status: 'ok', documentIds: [] });
  });
});

describe('this file is not vacuous', () => {
  it('drives the real adapter, with only the HTTP client mocked', async () => {
    get.mockResolvedValue(ok({ documentIds: ['d1'] }));
    await listVehicleDocuments(VEHICLE);
    expect(get).toHaveBeenCalledTimes(1);
    expect(authorizedClient).toHaveBeenCalled();
  });
});
