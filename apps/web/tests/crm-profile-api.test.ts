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

const { listNotes, listContacts } = await import('@/features/crm/customers/profile-api');

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
