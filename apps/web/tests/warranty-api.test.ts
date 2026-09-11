import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The warranty ADAPTERS (P1-31, FE-008 warranty record, FE-009 partial).
 *
 * The rendering tests replace this module wholesale and no backend proof runs in
 * this tier, so neither says what request an adapter actually builds. That is
 * asserted here, with only the transport replaced.
 *
 * The properties this file protects: the branch pair travels as the read's TARGET
 * and a scope name smuggled in among the filters is refused rather than sent; the
 * one filter the route accepts is sent when it is meant and omitted when it is not;
 * the page asked for stays inside the bound the route enforces; a refusal arrives as
 * a refusal rather than as an empty branch; the detail read names its warranty in the
 * path; the generation posts under the DELIVERY and carries a policy only when one was
 * chosen; it attaches no retry key of its own, because the transport owns that; and a
 * refusal carries the catalogue code the screen branches on.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const adapters = await import('@/features/warranty/warranty-api');
const { generateWarranty, listBranches, listWarranties, readWarranty } = adapters;
const { PAGE_SIZE } = await import('@/features/warranty/warranty-contract');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const WARRANTY_ID = '77777777-7777-4777-8777-777777777777';
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const VEHICLE_ID = '55555555-5555-4555-8555-555555555555';
const POLICY_ID = '88888888-8888-4888-8888-888888888888';
const CURSOR = 'd2FycmFudHktY3Vyc29y';

const TARGET = { companyId: COMPANY_ID, branchId: BRANCH_ID };

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string, problem?: unknown) => ({
  ok: false as const,
  kind,
  correlationId: 'corr-9',
  ...(problem === undefined ? {} : { problem }),
});

const emptyPage = { items: [], nextCursor: null, hasMore: false };

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

/** The path the transport was asked for, as one string. */
const requested = () => String(get.mock.calls[0]?.[0]);

describe('the list is addressed to one branch', () => {
  it('sends the branch pair the route requires, as the read’s target', async () => {
    get.mockResolvedValue(ok(emptyPage));
    await listWarranties(TARGET, null, null);
    const url = new URL(requested(), 'https://test.local');
    expect(url.pathname).toBe('/api/v1/warranties');
    expect(url.searchParams.get('companyId')).toBe(COMPANY_ID);
    expect(url.searchParams.get('branchId')).toBe(BRANCH_ID);
  });

  it('asks for a page the route will accept', async () => {
    // The route refuses anything above one hundred, so a page size that exceeded it
    // would be a request refused for the whole screen rather than a longer list.
    get.mockResolvedValue(ok(emptyPage));
    await listWarranties(TARGET, null, null);
    const limit = new URL(requested(), 'https://test.local').searchParams.get('limit');
    expect(Number(limit)).toBe(PAGE_SIZE);
    expect(Number(limit)).toBeLessThanOrEqual(100);
    expect(Number(limit)).toBeGreaterThan(0);
  });

  it('refuses to send a branch pair smuggled in among the ordinary filters', async () => {
    // The pair has exactly one door. A second one would be a place where a client
    // could assert a scope instead of naming a resource, and the two sentences are
    // different: the server resolves who you are and never accepts it from here.
    get.mockResolvedValue(ok(emptyPage));
    await expect(
      listWarranties({ companyId: COMPANY_ID, branchId: '' }, null, null)
    ).rejects.toThrow(/mandatory/i);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the one filter the route accepts', () => {
  it('sends the vehicle when one was named', async () => {
    get.mockResolvedValue(ok(emptyPage));
    await listWarranties(TARGET, VEHICLE_ID, null);
    expect(new URL(requested(), 'https://test.local').searchParams.get('vehicleId')).toBe(
      VEHICLE_ID
    );
  });

  it('omits the vehicle entirely when none was named', async () => {
    // The route is strict about what it does not recognise, and an empty value is
    // not a missing one: a blank filter would be a request refused for the page.
    get.mockResolvedValue(ok(emptyPage));
    await listWarranties(TARGET, null, null);
    expect(requested()).not.toContain('vehicleId');
  });

  it('passes the cursor back exactly as the server minted it', async () => {
    get.mockResolvedValue(ok(emptyPage));
    await listWarranties(TARGET, null, CURSOR);
    expect(new URL(requested(), 'https://test.local').searchParams.get('cursor')).toBe(CURSOR);
  });

  it('sends no cursor on the first page', async () => {
    get.mockResolvedValue(ok(emptyPage));
    await listWarranties(TARGET, null, null);
    expect(requested()).not.toContain('cursor');
  });
});

describe('a refusal is a refusal, never an empty branch', () => {
  it('reports a forbidden list as denied and returns no rows', async () => {
    get.mockResolvedValue(failure('forbidden'));
    const state = await listWarranties(TARGET, null, null);
    expect(state.status).toBe('denied');
    expect(state.rows).toEqual([]);
    expect(state.hasMore).toBe(false);
    expect(state.correlationId).toBe('corr-9');
  });

  it('reports an ended session without asking the transport at all', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const state = await listWarranties(TARGET, null, null);
    expect(state.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });

  it('carries the server’s own end-of-set signals rather than inferring them', async () => {
    get.mockResolvedValue(ok({ items: [{ id: WARRANTY_ID }], nextCursor: CURSOR, hasMore: true }));
    const state = await listWarranties(TARGET, null, null);
    expect(state.status).toBe('ok');
    expect(state.hasMore).toBe(true);
    expect(state.nextCursor).toBe(CURSOR);
    expect(state.rows).toHaveLength(1);
  });
});

describe('the record read names its warranty in the path', () => {
  it('reads one warranty', async () => {
    get.mockResolvedValue(ok({ id: WARRANTY_ID, status: 'issued', items: [] }));
    const state = await readWarranty(WARRANTY_ID);
    expect(state.status).toBe('ok');
    expect(requested()).toBe(`/api/v1/warranties/${WARRANTY_ID}`);
  });

  it('reports a record it could not resolve as missing rather than as refused', async () => {
    // The backend deliberately does not confirm that a record it will not show you
    // exists, so "in another branch" and "names nothing" arrive the same way.
    get.mockResolvedValue(failure('not-found'));
    const state = await readWarranty(WARRANTY_ID);
    expect(state.status).toBe('not-found');
  });

  it('reads the branch directory the target picker offers', async () => {
    get.mockResolvedValue(ok({ items: [] }));
    await listBranches();
    expect(requested()).toBe('/api/v1/org/branches');
  });
});

describe('the generation posts under the handover', () => {
  it('addresses the delivery, not a top-level warranty create', async () => {
    send.mockResolvedValue(ok({ id: WARRANTY_ID }));
    await generateWarranty(DELIVERY_ID);
    expect(send.mock.calls[0]?.[0]).toBe('POST');
    expect(send.mock.calls[0]?.[1]).toBe(`/api/v1/deliveries/${DELIVERY_ID}/warranties`);
  });

  it('sends an empty body when no plan was chosen', async () => {
    // Omitting the plan is what makes the company's single one resolve. An empty
    // string is not a missing value and the route's body is strict about it.
    send.mockResolvedValue(ok({ id: WARRANTY_ID }));
    await generateWarranty(DELIVERY_ID);
    expect(send.mock.calls[0]?.[2]).toEqual({});
  });

  it('sends the chosen plan and nothing besides', async () => {
    // No duration, no distance limit, no covered scope and no start date: every one
    // of those is a coverage term the workshop configures, and accepting any of them
    // from this side would let the screen write its own warranty.
    send.mockResolvedValue(ok({ id: WARRANTY_ID }));
    await generateWarranty(DELIVERY_ID, { policyId: POLICY_ID });
    expect(send.mock.calls[0]?.[2]).toEqual({ policyId: POLICY_ID });
  });

  it('attaches no retry key of its own', async () => {
    // The transport reads the published contract and mints one for every send that
    // needs it. A key written here would either duplicate that or be reused across
    // two genuine attempts, turning the second into a replay of the first.
    send.mockResolvedValue(ok({ id: WARRANTY_ID }));
    await generateWarranty(DELIVERY_ID);
    const options = send.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
    expect(options?.['idempotencyKey']).toBeUndefined();
  });

  it('returns the record it created so the screen can open it', async () => {
    send.mockResolvedValue(ok({ id: WARRANTY_ID, status: 'issued' }));
    const state = await generateWarranty(DELIVERY_ID);
    expect(state.status).toBe('success');
    expect(state.created?.id).toBe(WARRANTY_ID);
  });

  it('carries the catalogue code a refusal published', async () => {
    // A conflict alone does not say whether the vehicle is already covered or the
    // request was already recorded, and the two lead an operator somewhere different.
    send.mockResolvedValue(failure('conflict', { code: 'ERR-CON-001' }));
    const state = await generateWarranty(DELIVERY_ID);
    expect(state.status).not.toBe('success');
    expect(state.code).toBe('ERR-CON-001');
    expect(state.created).toBeUndefined();
  });

  it('carries the authority a denial named', async () => {
    send.mockResolvedValue(
      failure('forbidden', { code: 'ERR-IAM-001', requiredPermissions: ['a.b.c'] })
    );
    const state = await generateWarranty(DELIVERY_ID);
    expect(state.status).toBe('denied');
    expect(state.requiredPermissions).toEqual(['a.b.c']);
  });

  it('reports an ended session without sending anything', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const state = await generateWarranty(DELIVERY_ID);
    expect(state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});
