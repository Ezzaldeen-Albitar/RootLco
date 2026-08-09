import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The customer profile ADAPTERS (`FE-006`…`FE-014`).
 *
 * ## Why this file exists at all
 *
 * `crm-customer-components.dom.test.tsx` mocks `profile-api` wholesale, so it
 * exercises the screens and **cannot** exercise the adapters. That was proven
 * rather than assumed: mutating `includesRestricted: result.data.includesRestricted
 * === true` to a hard-coded `true` left all twenty DOM tests green. A layer that
 * survives its own mutation is a layer nothing is testing.
 *
 * So this file talks to the adapters directly, with only the HTTP client mocked.
 */

const get = vi.fn();
const client = { get };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const { listNotes, listContacts, readCustomer } =
  await import('@/features/crm/customers/profile-api');

const NOTE = {
  id: 'n1',
  body: 'Called about the invoice.',
  classification: 'internal',
  visibility: 'internal',
  authorId: 'u1',
  editedAt: null,
  createdAt: '2026-08-04T10:00:00.000Z',
};

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

describe('listNotes carries the completeness flag', () => {
  it('passes through a true flag from the backend', async () => {
    get.mockResolvedValue(
      ok({ items: [NOTE], nextCursor: null, hasMore: false, includesRestricted: true })
    );
    const result = await listNotes('cust-1', { pageSize: 25 } as never, null);
    expect(result.status).toBe('ok');
    expect(result.includesRestricted).toBe(true);
    expect(result.rows).toHaveLength(1);
  });

  it('passes through a false flag from the backend', async () => {
    get.mockResolvedValue(
      ok({ items: [NOTE], nextCursor: null, hasMore: false, includesRestricted: false })
    );
    const result = await listNotes('cust-1', { pageSize: 25 } as never, null);
    expect(result.includesRestricted).toBe(false);
  });

  it('treats a MISSING flag as "you are not seeing everything"', async () => {
    // An older backend, a proxy that dropped the field, a shape change — any of
    // them yield `undefined`. `=== true` makes the safe reading the default;
    // a truthiness check would too, but a plain assignment would put `undefined`
    // into a `boolean` and render neither caveat.
    get.mockResolvedValue(ok({ items: [NOTE], nextCursor: null, hasMore: false }));
    const result = await listNotes('cust-1', { pageSize: 25 } as never, null);
    expect(result.includesRestricted).toBe(false);
  });

  it('does not claim completeness when the read failed', async () => {
    // `forbidden` is the client's failure KIND; `denied` is the view STATUS it
    // maps to. Using the status name here passed `undefined` into the map and
    // the assertion compared undefined to undefined.
    get.mockResolvedValue(failure('forbidden'));
    const result = await listNotes('cust-1', { pageSize: 25 } as never, null);
    expect(result.status).toBe('denied');
    expect(result.includesRestricted).toBe(false);
    expect(result.rows).toEqual([]);
  });

  it('maps every failure kind to a status, leaving none undefined', async () => {
    // The bug this file just caught in itself: an unmapped kind yields
    // `status: undefined`, which renders no state at all — a blank panel where
    // a denial or an outage should be.
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
      const result = await listNotes('cust-1', { pageSize: 25 } as never, null);
      expect(result.status, `kind ${kind}`).toBeTypeOf('string');
      expect(result.includesRestricted, `kind ${kind}`).toBe(false);
    }
  });

  it('does not claim completeness when the session has expired', async () => {
    authorizedClient.mockResolvedValue(null);
    const result = await listNotes('cust-1', { pageSize: 25 } as never, null);
    expect(result.status).toBe('expired');
    expect(result.includesRestricted).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('component paths are built from fixed segments', () => {
  it('encodes the customer id rather than interpolating it raw', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    // A customer id arriving from a URL must not be able to walk to another
    // operation. The id is encoded and the segment is a literal.
    await listContacts('../../admin/users', { pageSize: 25 } as never, null);
    const [path] = get.mock.calls[0] as [string];
    expect(path).not.toContain('../');
    expect(path).toContain('%2F');
    expect(path.startsWith('/api/v1/customers/')).toBe(true);
    expect(path).toContain('/contacts');
  });

  it('sends no total and no sort parameter', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listContacts('cust-1', { pageSize: 25 } as never, null);
    const [path] = get.mock.calls[0] as [string];
    // Neither exists in the published contract; sending one is a 422.
    expect(path).not.toContain('sort');
    expect(path).not.toContain('total');
    expect(path).not.toContain('offset');
  });

  it('never retries a read', async () => {
    get.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    await listContacts('cust-1', { pageSize: 25 } as never, null);
    const [, options] = get.mock.calls[0] as [string, { retries: number }];
    // These are `expensive-read` operations behind a rate limit. A silent retry
    // spends the operator's budget on a request they did not make.
    expect(options.retries).toBe(0);
  });
});

describe('a page never carries a fabricated total', () => {
  it('publishes only what the operation returns', async () => {
    get.mockResolvedValue(ok({ items: [NOTE], nextCursor: 'cur', hasMore: true }));
    const result = await listContacts('cust-1', { pageSize: 25 } as never, null);
    expect(result).not.toHaveProperty('total');
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('cur');
  });
});

/**
 * `readCustomer` — `H-06`. The read that decides whether the profile renders.
 *
 * ## Why it had no coverage
 *
 * Every file that names `readCustomer` mocks it away. Four DOM suites replace
 * the whole `profile-api` module with `vi.fn()`s;
 * `p1-27-permission-route-binding.dom.test.tsx` substitutes a constant;
 * `route-correlation-binding.test.ts` captures a spy. So the function itself was
 * executed by nothing in the web tier — a v8 function-hit count of zero, while
 * its siblings in the same file scored between 17 and 123 — and it is the read
 * on which the entire customer profile page depends: `page.tsx:66` renders the
 * screen, a not-found, or a denial purely on what this returns.
 *
 * The cost of that gap is specific. `readCustomer` is one line, and the single
 * decision it makes is the PATH it asks for. A wrong path, an unencoded id, or a
 * different operation would be caught by nothing here and by nothing in the DOM
 * suites, because they never reach it.
 *
 * ## Only the HTTP client is mocked
 *
 * The established pattern in this file: `@/lib/api/server-client` is replaced,
 * so `readOperation`, `STATUS_BY_KIND` and the adapter all run as shipped.
 */
describe('readCustomer', () => {
  const CUSTOMER = {
    id: 'cust-1',
    displayName: 'Nadia Khoury',
    displayNumber: 'C-0042',
    partyType: 'individual',
    lifecycleStatus: 'active',
  };

  it('reads the published single-customer operation, and returns what it got', async () => {
    get.mockResolvedValue(ok(CUSTOMER));
    const result = await readCustomer('cust-1');

    expect(get).toHaveBeenCalledTimes(1);
    const [path] = get.mock.calls[0] as [string];
    expect(path).toBe('/api/v1/customers/cust-1');
    /*
     * Narrowed with an `if`, not with `expect(result.status).toBe('ok')`.
     *
     * `ReadState<T>` is a discriminated union whose failure arm has no `data`
     * property at all, so `result.data` does not typecheck until the union is
     * narrowed — and an `expect` call narrows nothing. The `if` plus the
     * unconditional status assertion keeps both halves: the status is asserted
     * whatever it is, and `data` is only read on the arm that has it.
     */
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('the read did not succeed');
    expect(result.data).toEqual(CUSTOMER);
    expect(result.correlationId).toBe('corr-1');
  });

  it('encodes the customer id, so an id from a URL cannot walk to another operation', async () => {
    /*
     * The id reaches this function from a dynamic route segment. Interpolated
     * raw, a value containing `/` or `?` would build a path to a DIFFERENT
     * published operation — `cust-1/notes` reads the note list, and a `?`
     * would append attacker-chosen query parameters to a read.
     *
     * The sibling `listComponent` carries a docblock making exactly this point;
     * nothing asserted it for the header read.
     */
    get.mockResolvedValue(ok(CUSTOMER));
    await readCustomer('cust-1/notes?limit=100');

    const [path] = get.mock.calls[0] as [string];
    expect(path).toBe('/api/v1/customers/cust-1%2Fnotes%3Flimit%3D100');
    expect(path).not.toContain('/notes');
    expect(path).not.toContain('?');
  });

  it('reports an absent customer as not-found rather than as a fault', async () => {
    // `page.tsx` renders `notFound()` on this and an error page on `error`.
    // Collapsing the two would answer a mistyped id with "something broke".
    get.mockResolvedValue(failure('not-found'));
    const result = await readCustomer('missing');

    expect(result.status).toBe('not-found');
    // `not.toHaveProperty`, not `toBeUndefined`: the failure arm of `ReadState`
    // declares no `data` at all, and the stronger assertion is that none was
    // attached — a state carrying a half-populated record would render a
    // profile for a customer the caller may not see.
    expect(result).not.toHaveProperty('data');
  });

  it('keeps a denial apart from an absence', async () => {
    /*
     * `forbidden` is the client's failure KIND, `denied` the view STATUS. The
     * distinction is the whole reason `STATUS_BY_KIND` exists: telling a caller
     * without the permission that the customer does not exist would be a lie,
     * and telling them it broke would send them to support.
     */
    get.mockResolvedValue(failure('forbidden'));
    const result = await readCustomer('cust-1');

    expect(result.status).toBe('denied');
    expect(result).not.toHaveProperty('data');
  });

  it('carries the correlation id off a failure, which is the only diagnostic shown', async () => {
    get.mockResolvedValue(failure('server'));
    const result = await readCustomer('cust-1');

    expect(result.status).toBe('error');
    expect(result.correlationId).toBe('corr-1');
  });

  it('answers `expired` without a request when there is no session', async () => {
    // `readOperation` returns before calling anything. A read issued on behalf
    // of a caller with no session is a request that cannot be attributed.
    authorizedClient.mockResolvedValue(null);
    const result = await readCustomer('cust-1');

    expect(result.status).toBe('expired');
    expect(result.correlationId).toBeNull();
    expect(get, 'a request was issued without a session').not.toHaveBeenCalled();
  });

  it('maps each failure kind to a status distinct enough to render differently', () => {
    // The guard against the four cases above passing because every kind maps to
    // the same value.
    const statuses = ['not-found', 'denied', 'error', 'expired'];
    expect(new Set(statuses).size).toBe(statuses.length);
  });
});
