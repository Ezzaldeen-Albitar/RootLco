import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The service-catalogue ADAPTERS (P1-30, `W1`).
 *
 * ## Why this file exists at all
 *
 * A DOM test of the screens mocks this module wholesale, so it exercises the
 * screens and CANNOT exercise the adapters — and the backend proof calls the
 * routes directly, so it says nothing about whether these adapters send the
 * version, the body or the query at all. An adapter that dropped `If-Match`
 * would leave every backend case green while the screen silently overwrote
 * other people's work. So the request each adapter actually builds is asserted
 * HERE, with only the HTTP client mocked.
 *
 * ## The distinction this file exists to protect
 *
 * A refusal is not an empty catalogue. If a 403 ever maps to `ok` with zero
 * rows, an operator is told "there are no services" — a false statement about
 * the business — when the truth is "you may not read them".
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const {
  createService,
  createServiceCategory,
  createServiceVersion,
  listBranches,
  listServiceCategories,
  listServices,
  publishServiceVersion,
  readService,
  setBranchAvailability,
  updateService,
} = await import('@/features/services/api');

const SERVICE_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';

/** One published row. Every field is one the backend really returns. */
const ROW = {
  id: SERVICE_ID,
  serviceCode: 'OIL-CHANGE',
  name: 'Oil change',
  description: null,
  categoryId: '55555555-5555-4555-8555-555555555555',
  lifecycleStatus: 'active',
  recordVersion: 3,
};

const REQUEST = { pageSize: 25 } as never;
const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('the catalogue read builds the request the route accepts', () => {
  it('reads /api/v1/services with the page size and nothing else when unfiltered', async () => {
    get.mockResolvedValue(ok({ items: [ROW], nextCursor: null, hasMore: false }));
    const page = await listServices({}, REQUEST, null);
    expect(page.status).toBe('ok');
    expect(page.rows).toEqual([ROW]);
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/services?')).toBe(true);
    const search = new URLSearchParams(path.slice(path.indexOf('?')));
    expect(search.get('limit')).toBe('25');
    // No scope is ever asserted from the client: the catalogue is tenant-wide.
    expect(search.has('companyId')).toBe(false);
    expect(search.has('branchId')).toBe(false);
    expect(search.has('tenantId')).toBe(false);
  });

  it('sends every filter under the name the route declares, and the cursor', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listServices(
      {
        search: 'OIL',
        categoryId: ROW.categoryId,
        lifecycleStatus: 'archived',
        availableAtBranchId: BRANCH_ID,
        effectiveOn: '2026-09-05',
      },
      REQUEST,
      'cursor-1'
    );
    const path = String(get.mock.calls[0]?.[0]);
    const search = new URLSearchParams(path.slice(path.indexOf('?')));
    expect(search.get('search')).toBe('OIL');
    expect(search.get('categoryId')).toBe(ROW.categoryId);
    expect(search.get('lifecycleStatus')).toBe('archived');
    // A RESOURCE SELECTOR, not a scope assertion — the route re-authorizes it.
    expect(search.get('availableAtBranchId')).toBe(BRANCH_ID);
    expect(search.get('effectiveOn')).toBe('2026-09-05');
    expect(search.get('cursor')).toBe('cursor-1');
  });

  it('passes the server’s own end-of-set signals through and invents no total', async () => {
    get.mockResolvedValue(ok({ items: [ROW], nextCursor: 'c2', hasMore: true }));
    const page = await listServices({}, REQUEST, null);
    expect(page.nextCursor).toBe('c2');
    expect(page.hasMore).toBe(true);
    expect('total' in page && page.total !== undefined).toBe(false);
  });

  it('a refusal is a refusal, never an empty catalogue', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const page = await listServices({}, REQUEST, null);
    expect(page.status).toBe('denied');
    expect(page.rows).toEqual([]);
    expect(page.correlationId).toBe('corr-1');
  });

  it('an ended session is reported as expired before any request is made', async () => {
    authorizedClient.mockResolvedValue(null);
    const page = await listServices({}, REQUEST, null);
    expect(page.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the other reads address the right resource', () => {
  it('reads one service by id, encoded', async () => {
    get.mockResolvedValue(ok(ROW));
    const state = await readService(SERVICE_ID);
    expect(state.status).toBe('ok');
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/services/${SERVICE_ID}`);
  });

  it('asks the taxonomy for its largest page and keeps hasMore', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: 'more', hasMore: true }));
    const state = await listServiceCategories();
    expect(state.status).toBe('ok');
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/service-categories?')).toBe(true);
    expect(new URLSearchParams(path.slice(path.indexOf('?'))).get('limit')).toBe('100');
    if (state.status === 'ok') expect(state.data.hasMore).toBe(true);
  });

  it('reads the branch list, and its refusal is its own', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const state = await listBranches();
    // `org.branch.read` is a separate code: the picker must be able to say so
    // rather than render an empty list that claims the tenant has no branches.
    expect(state.status).toBe('denied');
    expect(String(get.mock.calls[0]?.[0])).toBe('/api/v1/org/branches');
  });
});

describe('the guarded writes carry the version, and the others carry none', () => {
  it('updateService sends a PATCH with If-Match and the body unchanged', async () => {
    send.mockResolvedValue(ok({ ...ROW, recordVersion: 4 }));
    const body = { name: 'Oil and filter', description: null };
    const state = await updateService(SERVICE_ID, body, 3);
    expect(state.status).toBe('success');
    expect(send).toHaveBeenCalledWith('PATCH', `/api/v1/services/${SERVICE_ID}`, body, {
      ifMatch: 3,
    });
    // `description: null` CLEARS; it must not have been dropped or turned into undefined.
    expect(send.mock.calls[0]?.[2]).toHaveProperty('description', null);
  });

  it('publishServiceVersion guards the SERVICE version, not the draft’s', async () => {
    send.mockResolvedValue(ok({ id: VERSION_ID, status: 'published' }));
    const state = await publishServiceVersion(
      SERVICE_ID,
      VERSION_ID,
      { effectiveFrom: '2026-10-01' },
      3
    );
    expect(state.status).toBe('success');
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/services/${SERVICE_ID}/versions/${VERSION_ID}/publication`,
      { effectiveFrom: '2026-10-01' },
      { ifMatch: 3 }
    );
  });

  it('a stale version is a conflict, reported as one', async () => {
    send.mockResolvedValue(failure('conflict'));
    const state = await updateService(SERVICE_ID, { name: 'x' }, 2);
    expect(state.status).toBe('conflict');
    expect(state.correlationId).toBe('corr-1');
  });

  it('createService returns the created row and passes no version', async () => {
    send.mockResolvedValue(ok(ROW));
    const outcome = await createService({
      serviceCategoryId: ROW.categoryId,
      serviceCode: 'OIL-CHANGE',
      name: 'Oil change',
    });
    expect(outcome.state.status).toBe('success');
    expect(outcome.created).toEqual(ROW);
    expect(send.mock.calls[0]?.[0]).toBe('POST');
    expect(send.mock.calls[0]?.[1]).toBe('/api/v1/services');
    // Not version-guarded: nothing exists yet to guard.
    expect(send.mock.calls[0]?.[3]).toBeUndefined();
  });

  it('createService on a refusal returns no created row', async () => {
    send.mockResolvedValue(failure('forbidden'));
    const outcome = await createService({
      serviceCategoryId: ROW.categoryId,
      serviceCode: 'X',
      name: 'x',
    });
    expect(outcome.state.status).toBe('denied');
    expect(outcome.created).toBeNull();
  });

  it('createServiceVersion returns the draft — the only place its id is ever published', async () => {
    const draft = {
      id: VERSION_ID,
      serviceId: SERVICE_ID,
      versionNo: 2,
      effectiveFrom: '2026-10-01',
      effectiveTo: null,
      status: 'draft',
      laborTimes: [],
    };
    send.mockResolvedValue(ok(draft));
    const outcome = await createServiceVersion(SERVICE_ID, { effectiveFrom: '2026-10-01' });
    expect(outcome.created).toEqual(draft);
    expect(send.mock.calls[0]?.[1]).toBe(`/api/v1/services/${SERVICE_ID}/versions`);
    expect(send.mock.calls[0]?.[3]).toBeUndefined();
  });

  it('setBranchAvailability sends the scope pair in the BODY, where the route wants it', async () => {
    send.mockResolvedValue(ok({ id: 'a1', isAvailable: false }));
    const body = { companyId: COMPANY_ID, branchId: BRANCH_ID, isAvailable: false };
    const state = await setBranchAvailability(SERVICE_ID, body);
    expect(state.status).toBe('success');
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/services/${SERVICE_ID}/branch-availability`,
      body
    );
  });

  it('createServiceCategory posts to the taxonomy and returns the row', async () => {
    const category = { id: 'c1', code: 'engine', name: 'Engine', status: 'active' };
    send.mockResolvedValue(ok(category));
    const outcome = await createServiceCategory({ code: 'engine', name: 'Engine' });
    expect(outcome.created).toEqual(category);
    expect(send.mock.calls[0]?.[1]).toBe('/api/v1/service-categories');
  });

  it('every write reports an ended session without sending anything', async () => {
    authorizedClient.mockResolvedValue(null);
    expect((await updateService(SERVICE_ID, { name: 'x' }, 1)).status).toBe('expired');
    expect(
      (await createService({ serviceCategoryId: 'c', serviceCode: 'X', name: 'x' })).state.status
    ).toBe('expired');
    expect(
      (
        await setBranchAvailability(SERVICE_ID, {
          companyId: COMPANY_ID,
          branchId: BRANCH_ID,
          isAvailable: true,
        })
      ).status
    ).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});
