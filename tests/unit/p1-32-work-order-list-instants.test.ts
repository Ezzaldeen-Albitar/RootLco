import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `wo.work-order-list` hands its date bounds to the query EXACTLY as they were
 * sent (Owner directive, the Material UI work-order slice).
 *
 * The web sends the last instant of a branch's day written to the microsecond
 * (`…T23:59:59.999999±HH:MM`, `lib/branch-time.ts#endOfDayBound`) because the
 * board compares `opened_at <= openedTo`, closed, and PostgreSQL keeps
 * `timestamptz` to the microsecond. The route used to pass each bound through
 * `new Date(...)`, which keeps milliseconds only, so the bound reached the query
 * as `.999` and a row stamped in the last 999 microseconds of the day was left
 * off the "today" board. The backend half of the proof — a row at `.999500`
 * inside the bound and one at the next day's first instant outside it — is in
 * `tests/backend/p1-19-work-order-reads.test.ts`, which needs a database; this
 * file holds the route's own contract without one.
 *
 * The pipeline is replaced by a stand-in that runs the handler with a database
 * handle nobody reads, so what is observed is exactly what the route hands the
 * module. The query validation is the real one: a bound that is not an instant
 * with an offset must still be refused before the module is reached.
 */

const list = vi.fn();
const resolveBoardFilters = vi.fn();

vi.mock('@api/server/http/route-handler', () => ({
  handleOperation: async (
    _operation: unknown,
    _request: Request,
    handler: (input: Record<string, unknown>) => Promise<{ body: unknown }>
  ) => {
    const result = await handler({
      db: {},
      authorizedBranches: async () => [BRANCH],
    });
    return Response.json(result.body);
  },
}));

vi.mock('@api/modules/work-order', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    workOrderModule: () => ({ workOrders: { list, resolveBoardFilters } }),
  };
});

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';

const { GET } = await import('@api/app/api/v1/work-orders/route');

function board(query: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/v1/work-orders');
  url.searchParams.set('companyId', COMPANY);
  url.searchParams.set('branchId', BRANCH);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return GET(new Request(url));
}

/** The filter the route handed the module on its last call. */
function sentFilter(): Record<string, unknown> {
  return (list.mock.lastCall?.[1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  resolveBoardFilters.mockReset();
  resolveBoardFilters.mockResolvedValue({});
});

describe('wo.work-order-list passes its date bounds through unchanged', () => {
  it('hands the opened window to the module as the strings that were sent', async () => {
    const openedFrom = '2031-03-14T00:00:00.000000+03:00';
    const openedTo = '2031-03-14T23:59:59.999999+03:00';
    const response = await board({ openedFrom, openedTo });
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledTimes(1);
    expect(sentFilter()['openedFrom']).toBe(openedFrom);
    expect(sentFilter()['openedTo']).toBe(openedTo);
    // Not a Date, and not re-serialised: `toISOString()` would have written
    // `20:59:59.999Z` and lost the last three digits.
    expect(typeof sentFilter()['openedTo']).toBe('string');
  });

  it('hands the completion window to the module the same way', async () => {
    const completedFrom = '2031-03-14T00:00:00+03:00';
    const completedTo = '2031-03-14T23:59:59.999999+03:00';
    await board({ completedFrom, completedTo });
    expect(sentFilter()['completedFrom']).toBe(completedFrom);
    expect(sentFilter()['completedTo']).toBe(completedTo);
  });

  it('sends no bound at all when none was asked for', async () => {
    await board({});
    for (const key of ['openedFrom', 'openedTo', 'completedFrom', 'completedTo']) {
      expect(sentFilter()[key], key).toBeUndefined();
    }
  });
});

describe('the bounds are still validated before they are passed on', () => {
  it.each([
    ['a wall-clock string with no offset', '2031-03-14T23:59:59.999999'],
    ['a calendar day', '2031-03-14'],
    ['words', 'end of today'],
    ['an impossible month', '2031-13-14T00:00:00+03:00'],
  ])('refuses %s and never reaches the module', async (_name, value) => {
    await expect(board({ openedTo: value })).rejects.toMatchObject({ code: 'ERR-VAL-001' });
    await expect(board({ completedFrom: value })).rejects.toMatchObject({ code: 'ERR-VAL-001' });
    expect(list).not.toHaveBeenCalled();
  });

  it('still refuses an inverted completion window, compared as instants', async () => {
    await expect(
      board({
        completedFrom: '2031-03-15T00:00:00+03:00',
        completedTo: '2031-03-14T23:59:59.999999+03:00',
      })
    ).rejects.toMatchObject({ code: 'ERR-VAL-001' });
    expect(list).not.toHaveBeenCalled();
  });
});
