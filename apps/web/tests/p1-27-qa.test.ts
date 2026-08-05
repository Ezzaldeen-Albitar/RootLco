import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STATUS_BY_KIND } from '@/lib/api/read-operation';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';

/**
 * `P1-27-QA-001` … `P1-27-QA-005`.
 *
 * ## The one thing this file is for
 *
 * The DOM suites mock every adapter wholesale, so they exercise the screens and
 * cannot exercise the adapters — proven in Wave 5, when mutating an adapter left
 * twenty DOM tests green. The unit suites exercise the contracts. **Nothing was
 * driving every adapter through every failure kind**, and there are eleven of
 * them, so a mapping that was right for `forbidden` and wrong for `rate-limited`
 * had nowhere to be caught.
 *
 * This file drives all eighteen list adapters through all eleven kinds. That is
 * 198 assertions written as one loop, which is the only honest way to write
 * them: a hand-picked sample of three would be a claim about the other eight.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const crmProfile = await import('@/features/crm/customers/profile-api');
const crmIdentity = await import('@/features/crm/customers/identity-api');
const vehHistory = await import('@/features/vehicles/history-api');
const vehRelations = await import('@/features/vehicles/relations-api');
const vehDuplicates = await import('@/features/vehicles/duplicates-api');
const vehApi = await import('@/features/vehicles/api');
const crmApi = await import('@/features/crm/customers/api');

const REQUEST = { pageSize: 25 } as never;

/** Every list adapter this phase publishes, with a call that reaches the client. */
const LIST_ADAPTERS: readonly { name: string; call: () => Promise<{ status: string }> }[] = [
  { name: 'listContacts', call: () => crmProfile.listContacts('c1', REQUEST, null) },
  { name: 'listAddresses', call: () => crmProfile.listAddresses('c1', REQUEST, null) },
  { name: 'listPreferences', call: () => crmProfile.listPreferences('c1', REQUEST, null) },
  { name: 'listConsents', call: () => crmProfile.listConsents('c1', REQUEST, null) },
  { name: 'listNotes', call: () => crmProfile.listNotes('c1', REQUEST, null) },
  { name: 'listAlerts', call: () => crmProfile.listAlerts('c1', REQUEST, null) },
  { name: 'listTags', call: () => crmProfile.listTags('c1', REQUEST, null) },
  { name: 'listRestrictions', call: () => crmProfile.listRestrictions('c1', REQUEST, null) },
  { name: 'listTimeline', call: () => crmIdentity.listTimeline('c1', REQUEST, null) },
  { name: 'listDuplicates', call: () => crmIdentity.listDuplicates('open', REQUEST, null) },
  { name: 'listOwnerships', call: () => vehHistory.listOwnerships('v1', REQUEST, null) },
  { name: 'listPlates', call: () => vehHistory.listPlates('v1', REQUEST, null) },
  {
    name: 'listOdometerReadings',
    call: () => vehHistory.listOdometerReadings('v1', REQUEST, null),
  },
  { name: 'listRelationships', call: () => vehRelations.listRelationships('v1', REQUEST, null) },
  {
    name: 'listVehicleDuplicates',
    call: () => vehDuplicates.listVehicleDuplicates('open', REQUEST, null),
  },
  {
    name: 'listAttributeHistory',
    call: () => vehDuplicates.listAttributeHistory('v1', REQUEST, null),
  },
  // Both searches, with real criteria. Called with EMPTY criteria they refuse
  // to issue a request at all — a deliberate refusal, asserted in their own
  // suites — so passing a criterion here is what makes them reach the client.
  {
    name: 'searchCustomers',
    call: () => crmApi.searchCustomers(REQUEST, null, { name: 'Nadia' } as never),
  },
  {
    name: 'searchVehicles',
    // `plate`, not `plateNumber`. This line said `plateNumber` until
    // `normalizeCriteria` stopped iterating the object and started reading the
    // five contract keys — at which point the criterion vanished, the search
    // was correctly refused as empty, and four cases here failed. The old code
    // would have forwarded `plateNumber` to a `.strict()` schema, which is a 422
    // for the whole search.
    call: () => vehApi.searchVehicles({ plate: '12-3456' } as never, REQUEST, null),
  },
];

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('P1-27-QA-001 — every adapter is reached, and this file proves it', () => {
  it('drives eighteen list adapters, not a sample of them', () => {
    // A count assertion, so deleting a case from the table fails rather than
    // quietly narrowing what the loops below cover.
    expect(LIST_ADAPTERS).toHaveLength(18);
  });

  it('actually issues a request for each one', async () => {
    for (const adapter of LIST_ADAPTERS) {
      get.mockReset();
      get.mockResolvedValue({
        ok: true,
        data: { items: [], nextCursor: null, hasMore: false },
        correlationId: 'corr-1',
      });
      await adapter.call();
      // Without this, an adapter that returned a hard-coded empty page would
      // pass every failure-mapping test below without ever calling anything.
      expect(get, adapter.name).toHaveBeenCalledTimes(1);
    }
  });

  it('has a test file for every feature module that ships behaviour', () => {
    // Named from `readdirSync`, not from memory. The first draft of this list
    // asserted `vehicle-search.test.ts` and `vehicle-create.dom.test.tsx`, and
    // neither exists — the same two names had already been written into the
    // task register as evidence for Wave 7. A register that cites a file that is
    // not there is worse than one that cites nothing.
    const tests = readdirSync(join(process.cwd(), 'tests')).join('\n');
    for (const name of [
      'crm-customer-search.test.ts',
      'crm-customer-search.dom.test.tsx',
      'crm-customer-create.dom.test.tsx',
      'crm-customer-profile.dom.test.tsx',
      'crm-customer-components.dom.test.tsx',
      'crm-profile-api.test.ts',
      'crm-governance-writes.test.ts',
      'crm-duplicate-review.test.ts',
      'vehicle-api.test.ts',
      'vehicle-contract.test.ts',
      'vehicle-profile.test.ts',
      'vehicle-history.test.ts',
      'vehicle-relations.test.ts',
      'vehicle-duplicates.test.ts',
      'vehicle-screens.dom.test.tsx',
    ]) {
      expect(tests, name).toContain(name);
    }
  });

  it('covers BOTH domains at the component level, not just CRM', () => {
    // Until `QA-001` the vehicle domain had no `.dom` suite at all: seven
    // screens across Waves 7–12 with contract and adapter coverage only. Those
    // prove what a function returns; they cannot prove a merge control is absent
    // from what an operator actually sees.
    const tests = readdirSync(join(process.cwd(), 'tests'));
    const dom = tests.filter((name) => name.includes('.dom.test.'));
    expect(dom.filter((name) => name.startsWith('crm-')).length).toBeGreaterThan(0);
    expect(dom.filter((name) => name.startsWith('vehicle-')).length).toBeGreaterThan(0);
  });
});

describe('P1-27-QA-002 — every adapter through every failure kind', () => {
  const KINDS = Object.keys(STATUS_BY_KIND);

  it('covers all eleven transport kinds', () => {
    expect(KINDS).toHaveLength(11);
  });

  it('maps each kind to the view state the operator should see', () => {
    // A 429 is "try again shortly", not a fault. Telling an operator something
    // broke when they merely searched too fast sends them to support for
    // nothing, and a 403 rendered as an empty list reads as "there is nothing
    // here" when the truth is "you may not see it".
    expect(STATUS_BY_KIND.forbidden).toBe('denied');
    expect(STATUS_BY_KIND.unauthenticated).toBe('expired');
    expect(STATUS_BY_KIND['rate-limited']).toBe('unavailable');
    expect(STATUS_BY_KIND['not-found']).toBe('not-found');
    expect(STATUS_BY_KIND.timeout).toBe('unavailable');
    expect(STATUS_BY_KIND.network).toBe('unavailable');
    // Not one of them silently becomes `ok`.
    for (const status of Object.values(STATUS_BY_KIND)) {
      expect(status).not.toBe('ok');
    }
  });

  it('returns the mapped state from every adapter for every kind, and never throws', async () => {
    for (const adapter of LIST_ADAPTERS) {
      for (const kind of KINDS) {
        get.mockReset();
        get.mockResolvedValue({ ok: false, kind, correlationId: 'corr-1' });
        const result = await adapter.call();
        expect(result.status, `${adapter.name} on ${kind}`).toBe(
          STATUS_BY_KIND[kind as keyof typeof STATUS_BY_KIND]
        );
      }
    }
  });

  it('carries the correlation reference out of every failure', async () => {
    for (const adapter of LIST_ADAPTERS) {
      get.mockReset();
      get.mockResolvedValue({ ok: false, kind: 'server', correlationId: 'corr-xyz' });
      const result = (await adapter.call()) as unknown as { correlationId: string | null };
      expect(result.correlationId, adapter.name).toBe('corr-xyz');
    }
  });

  it('reports an expired session without issuing a request', async () => {
    for (const adapter of LIST_ADAPTERS) {
      get.mockReset();
      authorizedClient.mockResolvedValueOnce(null as unknown);
      const result = await adapter.call();
      expect(result.status, adapter.name).toBe('expired');
      // A request with no session is a request that cannot succeed. Sending it
      // spends a rate-limit slot to be told what was already known.
      expect(get, adapter.name).not.toHaveBeenCalled();
    }
  });

  it('renders an empty page as empty, never as an error', async () => {
    for (const adapter of LIST_ADAPTERS) {
      get.mockReset();
      get.mockResolvedValue({
        ok: true,
        data: { items: [], nextCursor: null, hasMore: false },
        correlationId: 'corr-1',
      });
      const result = (await adapter.call()) as unknown as {
        status: string;
        rows: readonly unknown[];
      };
      expect(result.status, adapter.name).toBe('ok');
      expect(result.rows, adapter.name).toEqual([]);
    }
  });
});

describe('P1-27-QA-003 — tenant, company and branch isolation', () => {
  it('sends no scope on any list request', async () => {
    for (const adapter of LIST_ADAPTERS) {
      get.mockReset();
      get.mockResolvedValue({
        ok: true,
        data: { items: [], nextCursor: null, hasMore: false },
        correlationId: 'c',
      });
      await adapter.call();
      const path = String(get.mock.calls[0]?.[0] ?? '');
      expect(path, adapter.name).not.toMatch(/tenant|company|branch/i);
    }
  });

  it('encodes every path parameter, so an id cannot escape its segment', async () => {
    get.mockReset();
    get.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    await vehDuplicates.listAttributeHistory('v1/../../admin', REQUEST, null);
    const path = String(get.mock.calls[0]?.[0] ?? '');
    expect(path).toContain('v1%2F..%2F..%2Fadmin');
    expect(path).not.toContain('/../');
  });
});

describe('P1-27-QA-004 — concurrency and idempotency', () => {
  it('requires a key on every write this phase performs', () => {
    const WRITES: readonly [string, string][] = [
      ['POST', '/api/v1/customers/c1/contacts'],
      ['POST', '/api/v1/customers/c1/addresses'],
      ['PUT', '/api/v1/customers/c1/preferences'],
      ['POST', '/api/v1/customers/c1/consents'],
      ['POST', '/api/v1/customers/c1/notes'],
      ['POST', '/api/v1/customers/c1/alerts'],
      ['POST', '/api/v1/customers/c1/tags'],
      ['POST', '/api/v1/customers/c1/restrictions'],
      ['POST', '/api/v1/customer-duplicates/c1/review'],
      ['POST', '/api/v1/vehicle-duplicates/c1/review'],
      ['POST', '/api/v1/vehicles'],
    ];
    for (const [method, path] of WRITES) {
      expect(requiresIdempotencyKey(method, path), `${method} ${path}`).toBe(true);
    }
  });

  it('requires no key on any read, so a GET never answers 400 before authorization', () => {
    const READS: readonly [string, string][] = [
      ['GET', '/api/v1/customers'],
      ['GET', '/api/v1/customers/c1'],
      ['GET', '/api/v1/customers/c1/notes'],
      ['GET', '/api/v1/vehicles'],
      ['GET', '/api/v1/vehicles/v1'],
      ['GET', '/api/v1/vehicle-duplicates'],
      ['GET', '/api/v1/vehicles/v1/history'],
    ];
    for (const [method, path] of READS) {
      expect(requiresIdempotencyKey(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it('reads idempotency off the operation, not off the HTTP verb', () => {
    // `crm.preference-set` is a PUT and IS idempotent; deriving from the method
    // is what produced `P1-27-INT-003`, where nine operations answered
    // `400 ERR-INT-002` before authorization on every attempt.
    expect(requiresIdempotencyKey('PUT', '/api/v1/customers/c1/preferences')).toBe(true);
    expect(resolveOperation('PUT', '/api/v1/customers/c1/preferences')?.operationId).toBe(
      'crm.preference-set'
    );
  });

  it('maps a conflict to an error state rather than to a silent success', async () => {
    // A merged or frozen vehicle answers 409 on update. Reporting that as
    // success would tell an operator their edit landed when it did not.
    expect(STATUS_BY_KIND.conflict).toBe('error');
    get.mockReset();
    get.mockResolvedValue({ ok: false, kind: 'conflict', correlationId: 'corr-1' });
    const result = await vehDuplicates.listVehicleDuplicates('open', REQUEST, null);
    expect(result.status).toBe('error');
  });
});

describe('P1-27-QA-005 — the evidence is real and it is complete', () => {
  it('names every wave in the durable record', async () => {
    const fs = await import('node:fs');
    const docs = join(process.cwd(), '..', '..', 'docs', 'phase-1', 'phase-1-27');
    const findings = fs.readFileSync(join(docs, 'findings.md'), 'utf8');
    const register = fs.readFileSync(join(docs, 'task-register.md'), 'utf8');

    // Every Frontend task id appears in the register. A register that stops at
    // FE-002 while 29 are delivered is not evidence, it is a stale document.
    for (let n = 1; n <= 29; n += 1) {
      const id = `FE-${String(n).padStart(3, '0')}`;
      expect(register, `${id} missing from the register`).toContain(id);
    }
    // And the defects this phase found are written down, not just fixed.
    for (const finding of ['P1-OD-017', 'P1-OD-025', 'P1-27-INT-003']) {
      expect(findings, finding).toContain(finding);
    }
  });

  it('records the four documents the phase is closed against', async () => {
    const fs = await import('node:fs');
    const docs = join(process.cwd(), '..', '..', 'docs', 'phase-1', 'phase-1-27');
    for (const name of [
      'canonical-plan.md',
      'contract-archaeology.md',
      'execution-checkpoint.md',
      'findings.md',
      'task-register.md',
    ]) {
      expect(fs.existsSync(join(docs, name)), name).toBe(true);
    }
  });
});
