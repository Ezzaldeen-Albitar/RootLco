import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The pricing ADAPTERS (P1-30, `W2`).
 *
 * The DOM tests mock this module wholesale and the backend proof calls the
 * routes directly, so neither says whether an adapter sends the version, the
 * body or the query at all. The request each adapter builds is asserted HERE,
 * with only the transport mocked.
 *
 * Two properties this file exists to protect: a refusal is never an empty
 * list of price lists, and money crosses this boundary as the string it
 * arrived as — no adapter below touches an amount.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const {
  createPriceList,
  createPriceListAssignment,
  createPriceListVersion,
  listBranches,
  listPriceLists,
  listPriceRules,
  publishPriceListVersion,
  readPriceList,
  recordPriceRule,
  resolvePrice,
} = await import('@/features/pricing/api');

const LIST_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';

const LIST = {
  id: LIST_ID,
  priceListCode: 'RETAIL',
  name: 'Retail',
  currency: 'JOD',
  description: null,
  status: 'active',
  recordVersion: 1,
};

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-1' });

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('the list read is bounded, not paged, and says so', () => {
  it('asks for the bound and nothing else', async () => {
    get.mockResolvedValue(ok({ items: [LIST] }));
    const page = await listPriceLists();
    expect(page.status).toBe('ok');
    expect(page.rows).toEqual([LIST]);
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/price-lists?')).toBe(true);
    const search = new URLSearchParams(path.slice(path.indexOf('?')));
    expect(search.get('limit')).toBe('100');
    expect(search.has('cursor')).toBe(false);
    expect(search.has('companyId')).toBe(false);
    expect(search.has('branchId')).toBe(false);
    expect(search.has('tenantId')).toBe(false);
  });

  it('reports no next page and no total, because the contract has neither', async () => {
    get.mockResolvedValue(ok({ items: [LIST] }));
    const page = await listPriceLists();
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
    expect('total' in page && page.total !== undefined).toBe(false);
  });

  it('a refusal is a refusal, never an empty list', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const page = await listPriceLists();
    expect(page.status).toBe('denied');
    expect(page.rows).toEqual([]);
    expect(page.correlationId).toBe('corr-1');
  });

  it('an ended session is reported before any request is made', async () => {
    authorizedClient.mockResolvedValue(null);
    const page = await listPriceLists();
    expect(page.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the other reads address the right resource', () => {
  it('reads one price list by id, encoded', async () => {
    get.mockResolvedValue(ok({ ...LIST, versions: [], versionsTruncated: false }));
    const state = await readPriceList(LIST_ID);
    expect(state.status).toBe('ok');
    expect(String(get.mock.calls[0]?.[0])).toBe(`/api/v1/price-lists/${LIST_ID}`);
  });

  it('reads the rules of one version under its list', async () => {
    get.mockResolvedValue(ok({ rules: [], truncated: false }));
    await listPriceRules(LIST_ID, VERSION_ID);
    expect(String(get.mock.calls[0]?.[0])).toBe(
      `/api/v1/price-lists/${LIST_ID}/versions/${VERSION_ID}/rules`
    );
  });

  it('resolves a price with the branch pair as the TARGET and the rest as filters', async () => {
    get.mockResolvedValue(
      ok({
        asOf: '2026-09-05',
        priceRuleId: 'r-1',
        unitPrice: '77.5000',
        currency: 'JOD',
        taxClassId: null,
        taxRate: '0.000000',
        taxClassCode: null,
      })
    );
    const state = await resolvePrice({
      serviceId: SERVICE_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      customerClass: 'fleet',
      asOf: '2026-09-05',
    });
    expect(state.status).toBe('ok');
    const path = String(get.mock.calls[0]?.[0]);
    expect(path.startsWith('/api/v1/prices?')).toBe(true);
    const search = new URLSearchParams(path.slice(path.indexOf('?')));
    expect(search.get('serviceId')).toBe(SERVICE_ID);
    expect(search.get('companyId')).toBe(COMPANY_ID);
    expect(search.get('branchId')).toBe(BRANCH_ID);
    expect(search.get('customerClass')).toBe('fleet');
    expect(search.get('asOf')).toBe('2026-09-05');
    // The figures pass through untouched: strings in, the same strings out.
    if (state.status === 'ok') {
      expect(state.data.unitPrice).toBe('77.5000');
      expect(state.data.taxRate).toBe('0.000000');
    }
  });

  it('omits the optional filters it was not given', async () => {
    get.mockResolvedValue(ok({}));
    await resolvePrice({ serviceId: SERVICE_ID, companyId: COMPANY_ID, branchId: BRANCH_ID });
    const path = String(get.mock.calls[0]?.[0]);
    const search = new URLSearchParams(path.slice(path.indexOf('?')));
    expect(search.has('customerClass')).toBe(false);
    expect(search.has('asOf')).toBe(false);
  });

  it('reads the branch list, and its refusal is its own', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const state = await listBranches();
    expect(state.status).toBe('denied');
    expect(String(get.mock.calls[0]?.[0])).toBe('/api/v1/org/branches');
  });
});

describe('the guarded writes carry the LIST version, and the others carry none', () => {
  it('createPriceListVersion sends If-Match with the body unchanged', async () => {
    send.mockResolvedValue(ok({ id: VERSION_ID, versionNo: 2, status: 'draft' }));
    const outcome = await createPriceListVersion(LIST_ID, { effectiveFrom: '2026-10-01' }, 3);
    expect(outcome.state.status).toBe('success');
    expect(outcome.created).toEqual({ id: VERSION_ID, versionNo: 2, status: 'draft' });
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/price-lists/${LIST_ID}/versions`,
      { effectiveFrom: '2026-10-01' },
      { ifMatch: 3 }
    );
  });

  it('publishPriceListVersion sends If-Match to the publication path', async () => {
    send.mockResolvedValue(ok({ id: VERSION_ID, status: 'published' }));
    const state = await publishPriceListVersion(
      LIST_ID,
      VERSION_ID,
      { effectiveFrom: '2026-10-01' },
      3
    );
    expect(state.status).toBe('success');
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/price-lists/${LIST_ID}/versions/${VERSION_ID}/publication`,
      { effectiveFrom: '2026-10-01' },
      { ifMatch: 3 }
    );
  });

  it('a stale version is a conflict, reported as one', async () => {
    send.mockResolvedValue(failure('conflict'));
    const state = await publishPriceListVersion(LIST_ID, VERSION_ID, { effectiveFrom: 'x' }, 2);
    expect(state.status).toBe('conflict');
    expect(state.correlationId).toBe('corr-1');
  });

  it('recordPriceRule sends the amount as the string it was given, and no version', async () => {
    send.mockResolvedValue(ok({ id: 'r-1', amount: '12.5000', currency: 'JOD', recordVersion: 1 }));
    const body = { serviceId: SERVICE_ID, amount: '12.5000', companyId: COMPANY_ID, priority: 5 };
    const outcome = await recordPriceRule(LIST_ID, VERSION_ID, body);
    expect(outcome.state.status).toBe('success');
    expect(outcome.created?.amount).toBe('12.5000');
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/price-lists/${LIST_ID}/versions/${VERSION_ID}/rules`,
      body
    );
    expect(typeof send.mock.calls[0]?.[2].amount).toBe('string');
    expect(send.mock.calls[0]?.[3]).toBeUndefined();
  });

  it('createPriceList returns the created row and passes no version', async () => {
    send.mockResolvedValue(ok(LIST));
    const outcome = await createPriceList({
      priceListCode: 'RETAIL',
      name: 'Retail',
      currency: 'JOD',
    });
    expect(outcome.state.status).toBe('success');
    expect(outcome.created).toEqual(LIST);
    expect(send.mock.calls[0]?.[1]).toBe('/api/v1/price-lists');
    expect(send.mock.calls[0]?.[3]).toBeUndefined();
  });

  it('createPriceListAssignment posts to the top-level path', async () => {
    send.mockResolvedValue(ok({ id: 'a-1', priceListId: LIST_ID }));
    const body = { priceListId: LIST_ID, companyId: COMPANY_ID, effectiveFrom: '2026-10-01' };
    const outcome = await createPriceListAssignment(body);
    expect(outcome.created).toEqual({ id: 'a-1', priceListId: LIST_ID });
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/price-list-assignments', body);
  });

  it('every write reports an ended session without sending anything', async () => {
    authorizedClient.mockResolvedValue(null);
    expect(
      (await createPriceList({ priceListCode: 'X', name: 'x', currency: 'JOD' })).state.status
    ).toBe('expired');
    expect((await createPriceListVersion(LIST_ID, { effectiveFrom: 'x' }, 1)).state.status).toBe(
      'expired'
    );
    expect(
      (await publishPriceListVersion(LIST_ID, VERSION_ID, { effectiveFrom: 'x' }, 1)).status
    ).toBe('expired');
    expect(
      (await recordPriceRule(LIST_ID, VERSION_ID, { serviceId: SERVICE_ID, amount: '1' })).state
        .status
    ).toBe('expired');
    expect(
      (await createPriceListAssignment({ priceListId: LIST_ID, effectiveFrom: 'x' })).state.status
    ).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});
