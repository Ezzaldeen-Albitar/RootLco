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
 * path; the plan list asks for the issuable state and asserts no scope of its own; the
 * generation posts under the DELIVERY and carries a policy only when one was
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
const { generateWarranty, listBranches, listWarranties, listWarrantyPolicies, readWarranty } =
  adapters;
const { ISSUABLE_POLICY_STATUS, PAGE_SIZE } = await import('@/features/warranty/warranty-contract');

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

describe('the plans a warranty may be issued under', () => {
  const emptyPolicies = { policies: { items: [], nextCursor: null, hasMore: false } };

  it('reads the published plan list', async () => {
    get.mockResolvedValue(ok(emptyPolicies));
    await listWarrantyPolicies();
    expect(new URL(requested(), 'https://test.local').pathname).toBe('/api/v1/warranty-policies');
  });

  it('asks for the state a warranty can actually be issued under', async () => {
    // A plan that is not in use is refused by the generation, so offering one in a
    // picker is offering a choice whose only outcome is a refusal.
    get.mockResolvedValue(ok(emptyPolicies));
    await listWarrantyPolicies({ status: ISSUABLE_POLICY_STATUS });
    expect(new URL(requested(), 'https://test.local').searchParams.get('status')).toBe('active');
  });

  it('omits the state filter when none was asked for', async () => {
    // The route treats an absent filter as "every plan", which is what a
    // configuration reader wants. An empty value is not a missing one.
    get.mockResolvedValue(ok(emptyPolicies));
    await listWarrantyPolicies();
    expect(requested()).not.toContain('status');
  });

  it('sends no scope of its own, and a page the route will accept', async () => {
    get.mockResolvedValue(ok(emptyPolicies));
    await listWarrantyPolicies();
    const params = new URL(requested(), 'https://test.local').searchParams;
    // The read is scoped server-side from the session; the route offers no company
    // filter at all, so none is invented here.
    expect(params.get('companyId')).toBeNull();
    expect(Number(params.get('limit'))).toBe(PAGE_SIZE);
    expect(Number(params.get('limit'))).toBeLessThanOrEqual(100);
  });

  it('passes a further page back exactly as the server minted it', async () => {
    get.mockResolvedValue(ok(emptyPolicies));
    await listWarrantyPolicies({ cursor: CURSOR });
    expect(new URL(requested(), 'https://test.local').searchParams.get('cursor')).toBe(CURSOR);
  });

  it('sends no cursor on the first page', async () => {
    get.mockResolvedValue(ok(emptyPolicies));
    await listWarrantyPolicies();
    expect(requested()).not.toContain('cursor');
  });

  it('carries the page the route published without flattening it', async () => {
    // The body is `{ policies: { ... } }` and not a bare page. Flattening it here
    // would disagree with the wire at the one place a disagreement is invisible.
    get.mockResolvedValue(
      ok({ policies: { items: [{ id: POLICY_ID }], nextCursor: null, hasMore: false } })
    );
    const state = await listWarrantyPolicies();
    expect(state.status).toBe('ok');
    expect(state.status === 'ok' && state.data.policies.items).toHaveLength(1);
  });

  it('reports a refused plan list as denied rather than as no plans at all', async () => {
    // The difference the picker depends on: "you may not see these" hides the
    // control and says so, while "there are none" would silently look the same.
    get.mockResolvedValue(failure('forbidden'));
    const state = await listWarrantyPolicies();
    expect(state.status).toBe('denied');
    expect(state.correlationId).toBe('corr-9');
  });

  it('reports an ended session without asking the transport at all', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const state = await listWarrantyPolicies();
    expect(state.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
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

describe('the plan administration writes', () => {
  const COVERAGE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const POLICY_VERSION = 4;
  const COVERAGE_VERSION = 9;

  const {
    createCoverageWindow,
    createWarrantyPolicy,
    readWarrantyPolicy,
    renameWarrantyPolicy,
    setCoverageWindowStatus,
    setWarrantyPolicyStatus,
  } = adapters;

  /** The transport options one write was given, which is where both headers live. */
  const options = () => send.mock.calls[0]?.[3] as Record<string, unknown> | undefined;

  it('reads one plan by naming it in the path', async () => {
    get.mockResolvedValue(ok({ policy: { id: POLICY_ID }, coverage: [] }));
    const state = await readWarrantyPolicy(POLICY_ID);
    expect(state.status).toBe('ok');
    expect(requested()).toBe(`/api/v1/warranty-policies/${POLICY_ID}`);
  });

  it('reports a plan it could not resolve as missing rather than as refused', async () => {
    // Absence is decided before scope, so "no such plan" and "a plan in a company
    // you cannot reach" arrive identically and neither confirms the other.
    get.mockResolvedValue(failure('not-found'));
    expect((await readWarrantyPolicy(POLICY_ID)).status).toBe('not-found');
  });

  it('creates a plan against the collection, with the company it claims', async () => {
    send.mockResolvedValue(ok({ id: POLICY_ID, recordVersion: 1 }));
    const state = await createWarrantyPolicy({
      companyId: COMPANY_ID,
      policyCode: 'standard_12',
      name: 'Standard cover',
    });
    expect(send.mock.calls[0]?.[0]).toBe('POST');
    expect(send.mock.calls[0]?.[1]).toBe('/api/v1/warranty-policies');
    expect(send.mock.calls[0]?.[2]).toEqual({
      companyId: COMPANY_ID,
      policyCode: 'standard_12',
      name: 'Standard cover',
    });
    expect(state.status).toBe('success');
    expect(state.policy?.id).toBe(POLICY_ID);
  });

  it('attaches no retry key of its own to the create', async () => {
    // The transport mints one from the published contract. A key written here would
    // either duplicate that or be reused across two genuine attempts.
    send.mockResolvedValue(ok({ id: POLICY_ID }));
    await createWarrantyPolicy({ companyId: COMPANY_ID, policyCode: 'a_b', name: 'n' });
    expect(options()?.['idempotencyKey']).toBeUndefined();
  });

  it('renames through the plan path and sends the version it was given', async () => {
    send.mockResolvedValue(ok({ id: POLICY_ID, name: 'Renamed', recordVersion: 5 }));
    await renameWarrantyPolicy(POLICY_ID, { name: 'Renamed' }, POLICY_VERSION);
    expect(send.mock.calls[0]?.[0]).toBe('PATCH');
    expect(send.mock.calls[0]?.[1]).toBe(`/api/v1/warranty-policies/${POLICY_ID}`);
    expect(send.mock.calls[0]?.[2]).toEqual({ name: 'Renamed' });
    expect(options()?.['ifMatch']).toBe(POLICY_VERSION);
  });

  it('sends the plan state to the plan own state path', async () => {
    send.mockResolvedValue(ok({ id: POLICY_ID, status: 'archived', recordVersion: 5 }));
    await setWarrantyPolicyStatus(POLICY_ID, { status: 'archived' }, POLICY_VERSION);
    expect(send.mock.calls[0]?.[1]).toBe(`/api/v1/warranty-policies/${POLICY_ID}/status`);
    expect(send.mock.calls[0]?.[2]).toEqual({ status: 'archived' });
    expect(options()?.['ifMatch']).toBe(POLICY_VERSION);
  });

  it('adds a window under the plan, keeping the distance an exact string', async () => {
    // The allowance is a distance and crosses the wire as the string it was typed
    // as. Turning it into a number to send it is the one place it could change.
    send.mockResolvedValue(ok({ id: COVERAGE_ID, recordVersion: 1 }));
    await createCoverageWindow(POLICY_ID, {
      coveredScope: 'all',
      durationMonths: 12,
      odometerAllowance: '20000',
      effectiveFrom: '2026-01-01',
    });
    expect(send.mock.calls[0]?.[1]).toBe(`/api/v1/warranty-policies/${POLICY_ID}/coverage-windows`);
    const body = send.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(body['odometerAllowance']).toBe('20000');
    expect(typeof body['odometerAllowance']).toBe('string');
    expect(body['durationMonths']).toBe(12);
    expect(body['effectiveTo']).toBeUndefined();
  });

  it('sends a window state to that window own path, with that window version', async () => {
    // Never the plan's. The path names both rows and they carry independent
    // counters, which is exactly the shape a caller gets wrong silently.
    send.mockResolvedValue(ok({ id: COVERAGE_ID, status: 'archived', recordVersion: 10 }));
    await setCoverageWindowStatus(POLICY_ID, COVERAGE_ID, { status: 'archived' }, COVERAGE_VERSION);
    expect(send.mock.calls[0]?.[1]).toBe(
      `/api/v1/warranty-policies/${POLICY_ID}/coverage-windows/${COVERAGE_ID}/status`
    );
    expect(options()?.['ifMatch']).toBe(COVERAGE_VERSION);
    expect(options()?.['ifMatch']).not.toBe(POLICY_VERSION);
  });

  it('sends the version on every guarded write, so the missing-header refusal cannot happen', async () => {
    // The backend refuses a version-guarded write without the header, and that
    // refusal is unreachable from here BY CONSTRUCTION: each of these three takes
    // the version as a required argument. Proved rather than asserted, because the
    // property is about the call shape and a default argument would quietly break it.
    const guarded = [
      () => renameWarrantyPolicy(POLICY_ID, { name: 'n' }, POLICY_VERSION),
      () => setWarrantyPolicyStatus(POLICY_ID, { status: 'active' }, POLICY_VERSION),
      () => setCoverageWindowStatus(POLICY_ID, COVERAGE_ID, { status: 'active' }, COVERAGE_VERSION),
    ];
    for (const write of guarded) {
      send.mockReset();
      send.mockResolvedValue(ok({ id: POLICY_ID }));
      await write();
      const sent = send.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
      expect(sent?.['ifMatch']).toEqual(expect.any(Number));
    }
  });
});

describe('a refused plan write says which of one code meanings it was', () => {
  const { createCoverageWindow, createWarrantyPolicy, renameWarrantyPolicy } = adapters;

  it('carries no rule when the view was simply stale', async () => {
    // The concurrency loss names no violation, and that absence is the signal the
    // screen reads to offer a reload rather than a correction.
    send.mockResolvedValue(failure('conflict', { code: 'ERR-CON-001' }));
    const state = await renameWarrantyPolicy(POLICY_ID, { name: 'n' }, 2);
    expect(state.status).not.toBe('success');
    expect(state.code).toBe('ERR-CON-001');
    expect(state.rule).toBeUndefined();
  });

  it('carries the overlap rule when the window was already covered', async () => {
    send.mockResolvedValue(
      failure('conflict', {
        code: 'ERR-CON-001',
        violations: [{ path: 'body.effectiveFrom', rule: 'overlapping_coverage' }],
      })
    );
    const state = await createCoverageWindow(POLICY_ID, {
      coveredScope: 'all',
      durationMonths: 12,
      effectiveFrom: '2026-01-01',
    });
    expect(state.code).toBe('ERR-CON-001');
    expect(state.rule).toBe('overlapping_coverage');
    expect(state.coverage).toBeUndefined();
  });

  it('carries the duplicate rule when the plan reference was taken', async () => {
    send.mockResolvedValue(
      failure('conflict', {
        code: 'ERR-CON-001',
        violations: [{ path: 'body.policyCode', rule: 'duplicate_code' }],
      })
    );
    const state = await createWarrantyPolicy({
      companyId: COMPANY_ID,
      policyCode: 'taken',
      name: 'n',
    });
    expect(state.rule).toBe('duplicate_code');
  });

  it('carries a refused field and a refused authority', async () => {
    send.mockResolvedValue(
      failure('validation', {
        code: 'ERR-VAL-001',
        violations: [{ path: 'body.companyId', rule: 'unknown_company' }],
      })
    );
    const invalid = await createWarrantyPolicy({
      companyId: COMPANY_ID,
      policyCode: 'a_b',
      name: 'n',
    });
    expect(invalid.code).toBe('ERR-VAL-001');
    expect(invalid.rule).toBe('unknown_company');

    send.mockReset();
    send.mockResolvedValue(
      failure('forbidden', { code: 'ERR-IAM-001', requiredPermissions: ['wty.policy.manage'] })
    );
    const denied = await createWarrantyPolicy({
      companyId: COMPANY_ID,
      policyCode: 'a_b',
      name: 'n',
    });
    expect(denied.status).toBe('denied');
    expect(denied.requiredPermissions).toEqual(['wty.policy.manage']);
  });

  it('carries the missing code when the plan could not be resolved', async () => {
    send.mockResolvedValue(failure('not-found', { code: 'ERR-RES-001' }));
    const state = await renameWarrantyPolicy(POLICY_ID, { name: 'n' }, 2);
    expect(state.code).toBe('ERR-RES-001');
  });

  it('reports an ended session without sending anything', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const state = await createWarrantyPolicy({
      companyId: COMPANY_ID,
      policyCode: 'a_b',
      name: 'n',
    });
    expect(state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});
