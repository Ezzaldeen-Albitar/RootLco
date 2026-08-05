import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRM_PERMISSIONS, VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import { companyFilterQuery, query } from '@/lib/api/read-operation';
import { FORBIDDEN_URL_KEYS, toSearchParams } from '@/components/data-table/table-state';

/**
 * `P1-27-SEC-001` … `P1-27-SEC-004` — the security obligations of this phase's
 * 29 Frontend tasks, asserted against the source that shipped rather than
 * against a description of it.
 *
 * Every test in this file reads real files off disk. A test that asserts a
 * property of "the CRM and vehicle surface" and never opens it proves the
 * property of nothing — so each sweep first asserts that it found files, and
 * that assertion is the reason the rest of the sweep means anything.
 */

const FEATURES = join(process.cwd(), 'src', 'features');
const ROUTES = join(process.cwd(), 'src', 'app');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Source with comments removed.
 *
 * Every absence sweep below failed on its first run — not because the code was
 * wrong, but because the **docblock explaining why the operation is absent**
 * contains its name. A raw-text sweep cannot tell "calls `veh.vehicle-merge`"
 * from "explains that `veh.vehicle-merge` is never called", and a phase whose
 * central discipline is writing down refusals would have had to stop writing
 * them down to keep the sweep green.
 *
 * `//` is only treated as a comment when it is not preceded by `:`, so a
 * `https://` inside a string literal survives. The next test proves both halves
 * of that claim, because a stripper that removed too much would make every sweep
 * below pass on an empty string.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/** Every CRM and vehicle module file this phase added or touched. */
const PHASE_FILES = [...walk(join(FEATURES, 'crm')), ...walk(join(FEATURES, 'vehicles'))].map(
  (path) => ({ path, source: code(readFileSync(path, 'utf8')) })
);

/** Every route segment under the dashboard, CRM and vehicles alike. */
const PHASE_ROUTES = walk(ROUTES).filter((p) => /[\\/](crm|vehicles)[\\/]/.test(p));

describe('P1-27-SEC-001 — permission and resolved scope', () => {
  it('found the surface it is about to make claims about', () => {
    // Without this the sweeps below pass on an empty array and this whole file
    // becomes a green report on nothing.
    expect(PHASE_FILES.length).toBeGreaterThan(20);
    expect(PHASE_ROUTES.length).toBeGreaterThan(5);
    // And the stripper left real code behind. A `code()` that returned '' would
    // make every absence sweep in this file vacuous at once.
    expect(PHASE_FILES.filter((f) => f.source.includes('export')).length).toBeGreaterThan(20);
  });

  it('strips comments without blinding itself to code', () => {
    const sample = [
      '// customer-merge named in a line comment',
      '/** vehicle-merge named in a docblock */',
      "const path = '/merge';",
      "const doc = 'https://example.test/merge';",
    ].join('\n');
    const stripped = code(sample);
    // Prose about an absence is gone …
    expect(stripped).not.toContain('customer-merge');
    expect(stripped).not.toContain('vehicle-merge');
    // … and the code that would constitute the thing itself is still there.
    expect(stripped).toContain("'/merge'");
    expect(stripped).toContain('https://example.test/merge');
  });

  it('checks a permission by exact membership, never by prefix', () => {
    // A prefix test would let `crm.customer.read` satisfy a control that needs
    // `crm.customer.read.sensitive`, and the direction of that mistake is
    // always toward showing more.
    expect(holds(['crm.customer.read'], 'crm.customer.read')).toBe(true);
    expect(holds(['crm.customer.read'], 'crm.customer.read.sensitive')).toBe(false);
    expect(holds(['crm.customer.readx'], 'crm.customer.read')).toBe(false);
    expect(holds([], 'crm.customer.read')).toBe(false);
  });

  it('never sends a tenant, company or branch from the client', () => {
    // Scope is resolved server-side from the session on every operation this
    // phase calls. A client that sent one would be asking to be believed.
    for (const { path, source } of PHASE_FILES) {
      expect(source, path).not.toMatch(/['"]?(tenantId|companyId|branchId)['"]?\s*[:,]/);
    }
  });

  it('permits a company FILTER at exactly one call site, and nowhere else', () => {
    // The first version of the rule refused `companyId` everywhere and broke a
    // working P1-26 screen the moment it ran against the real application. Two
    // different sentences share the word:
    //
    //   "I am in company X"                    — never sent; the server knows.
    //   "show me company X's approval limits"  — a resource selector, sent and
    //                                            authorized like any parameter.
    //
    // `GET /api/v1/iam/approval-limits` is the only operation of the second
    // shape, and the operator picks the company from a control that exists
    // because a session may resolve to no single one. Pinning the call sites
    // here means widening the exception requires changing a test that says why
    // it is not wider.
    const callers = [...walk(FEATURES), ...walk(join(process.cwd(), 'src', 'lib'))]
      .map((path) => ({ path, source: code(readFileSync(path, 'utf8')) }))
      .filter((f) => /companyFilterQuery\s*\(/.test(f.source))
      .map((f) => f.path.split(/[\\/]/).slice(-3).join('/'));

    expect(callers.sort()).toEqual([
      // The one operation with this shape.
      'administration/access/api.ts',
      // The definition itself. Not filtered out, so this assertion fails if the
      // helper moves — the re-export in `administration/shared/api.ts` names it
      // without calling it and is correctly not matched.
      'lib/api/read-operation.ts',
    ]);
  });

  it('still refuses a tenant or branch even alongside a company filter', () => {
    expect(() => companyFilterQuery({ tenantId: 't1' })).toThrow(/tenantId/);
    expect(() => companyFilterQuery({ branchId: 'b1' })).toThrow(/branchId/);
    expect(companyFilterQuery({ companyId: 'c1' })).toBe('?companyId=c1');
  });

  it('throws if a caller ever passes a scope key to the API query builder', () => {
    // Structural rather than conventional. Dropping the key silently would let
    // a caller believe it had asserted a scope that never left the process;
    // throwing says so at the moment of the mistake. No code path constructs
    // one, so this can only ever fire in development or in this suite.
    expect(() => query({ tenantId: 't1', name: 'ali' })).toThrow(/tenantId/);
    expect(() => query({ companyId: 'c1' })).toThrow(/companyId/);
    expect(() => query({ branchId: 'b1' })).toThrow(/branchId/);
    // And it does not over-reach: a real search criterion goes through.
    expect(query({ name: 'ali' })).toBe('?name=ali');
  });

  it('gates every CRM and vehicle route on a permission before it reads', () => {
    for (const path of PHASE_ROUTES) {
      const source = readFileSync(path, 'utf8');
      if (!source.includes('export default async function')) continue;
      // `holds(` must appear before the first `await read`/`await list`/
      // `await search` — the denial renders INSTEAD of the screen, so a denied
      // operator never issues the first request.
      const gate = source.indexOf('holds(');
      const read = source.search(/await (read|list|search)[A-Z]/);
      expect(gate, `${path} has no permission gate`).toBeGreaterThan(-1);
      if (read > -1) expect(gate, `${path} reads before it checks`).toBeLessThan(read);
    }
  });

  it('separates read from write on both domains, rather than one blanket code', () => {
    // One read code fans out to five write codes on vehicles and eight on CRM.
    // Rendering an edit control from read access would be wrong on every
    // sub-resource at once.
    const crm = new Set(Object.values(CRM_PERMISSIONS));
    const veh = new Set(Object.values(VEHICLE_PERMISSIONS));
    expect(crm.size).toBeGreaterThanOrEqual(10);
    expect(veh.size).toBeGreaterThanOrEqual(7);
    expect(crm.has('crm.customer.read')).toBe(true);
    expect(crm.has('crm.customer.consent.write')).toBe(true);
    expect(crm.has('crm.customer.restriction.manage')).toBe(true);
    expect(veh.has('veh.vehicle.read')).toBe(true);
    expect(veh.has('veh.vehicle.status.manage')).toBe(true);
  });
});

describe('P1-27-SEC-002 — sensitive data, export, documents and media', () => {
  it('keeps every CRM and vehicle search term out of the browser address bar', () => {
    // Two different URLs, two different policies, and conflating them would be
    // a mistake in one direction or the other.
    //
    // The BROWSER url is history, proxy logs and the `Referer` header, so a VIN,
    // a plate or a customer's phone number must never reach it — `FORBIDDEN_URL_KEYS`
    // refuses them and `toSearchParams` drops them.
    //
    // The API url is one TLS hop to the backend, and a VIN search criterion has
    // to travel on it or vehicle search cannot work at all. Blocking `vin` there
    // would not be caution, it would be breaking `FE-017`.
    for (const key of ['vin', 'plate', 'phone', 'email', 'search']) {
      expect(FORBIDDEN_URL_KEYS, key).toContain(key);
    }
    expect(
      toSearchParams(
        { page: 1, pageSize: 25, sort: null, filters: [], search: 'JH4KA7561PC008269' },
        []
      ).toString()
    ).toBe('');
    // And the API path does carry it, which is the point of the distinction.
    expect(query({ vin: 'JH4KA7561PC008269' })).toBe('?vin=JH4KA7561PC008269');
  });

  it('calls no export operation anywhere in this phase', () => {
    // Bulk extraction of customer or vehicle records is not a P1-27 task and no
    // screen offers it. An export added later must be a deliberate decision
    // with its own permission, not an affordance that appeared.
    for (const { path, source } of PHASE_FILES) {
      expect(source, path).not.toMatch(/\/export|-export|exportC|downloadAll/);
    }
  });

  it('offers no upload path of any kind', () => {
    // `P1-OD-025` must decide accepted types, size limits and storage before a
    // vehicle media operation can exist. There is none to call.
    for (const { path, source } of PHASE_FILES) {
      expect(source, path).not.toMatch(/FormData\(\)|multipart\/form-data|type="file"/);
    }
  });

  it('never renders unescaped HTML from any server value', () => {
    for (const { path, source } of PHASE_FILES) {
      expect(source, path).not.toContain('dangerouslySetInnerHTML');
    }
  });
});

describe('P1-27-SEC-003 — abuse cases and privilege escalation', () => {
  it('exposes no merge caller in either domain', () => {
    // `P1-OD-017` is open. An unused action that can POST an irreversible merge
    // is one edit away from being wired to a button.
    for (const { path, source } of PHASE_FILES) {
      expect(source, path).not.toMatch(/customer-merge|vehicle-merge|\/merge['"`]/);
    }
  });

  it('exposes no duplicate-scan caller on any review screen', () => {
    // `crm.duplicate-scan` and `veh.vehicle-duplicate-scan` read like queries
    // and are privileged audited writes that create rows and are throttled.
    // The creation form calls the CRM one once on explicit intent; no queue
    // calls either to populate or refresh itself.
    const reviewScreens = PHASE_FILES.filter((f) => /[Dd]uplicate(Review|s-api)/.test(f.path));
    expect(reviewScreens.length).toBeGreaterThan(1);
    for (const { path, source } of reviewScreens) {
      expect(source, path).not.toMatch(/duplicate-scan|scanDuplicates/);
    }
  });

  it('sends an idempotency key on every write and on no read', () => {
    const writes: readonly [string, string][] = [
      ['POST', '/api/v1/customers/c1/notes'],
      ['POST', '/api/v1/customers/c1/consents'],
      ['POST', '/api/v1/customer-duplicates/c1/review'],
      ['POST', '/api/v1/vehicle-duplicates/c1/review'],
      ['POST', '/api/v1/vehicles'],
    ];
    for (const [method, path] of writes) {
      expect(requiresIdempotencyKey(method, path), `${method} ${path}`).toBe(true);
    }
    const reads: readonly [string, string][] = [
      ['GET', '/api/v1/customers'],
      ['GET', '/api/v1/vehicles'],
      ['GET', '/api/v1/vehicle-duplicates'],
      ['GET', '/api/v1/vehicles/v1/history'],
    ];
    for (const [method, path] of reads) {
      expect(requiresIdempotencyKey(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it('resolves every operation this phase calls, so none was invented', () => {
    const OPERATIONS: readonly [string, string, string][] = [
      ['GET', '/api/v1/customers', 'crm.customer-search'],
      ['GET', '/api/v1/vehicles', 'veh.vehicle-search'],
      ['GET', '/api/v1/vehicle-duplicates', 'veh.vehicle-duplicate-list'],
      ['GET', '/api/v1/vehicles/v1/history', 'veh.vehicle-history'],
      ['GET', '/api/v1/vehicles/v1/documents', 'veh.vehicle-document-list'],
    ];
    for (const [method, path, id] of OPERATIONS) {
      expect(resolveOperation(method, path)?.operationId, path).toBe(id);
    }
  });
});

describe('P1-27-SEC-004 — audit-event coverage', () => {
  it('surfaces a correlation reference on every failure path', () => {
    // An operator who cannot quote a correlation ID cannot have an incident
    // traced. Every adapter carries one out of the failure, including the ones
    // that return an empty page.
    const adapters = PHASE_FILES.filter((f) => /-api\.ts$|\/api\.ts$|-actions\.ts$/.test(f.path));
    expect(adapters.length).toBeGreaterThan(8);
    for (const { path, source } of adapters) {
      expect(source, path).toContain('correlationId');
    }
  });

  it('never logs a server value to the browser console', () => {
    for (const { path, source } of PHASE_FILES) {
      expect(source, path).not.toMatch(/console\.(log|info|debug|warn|error)\(/);
    }
  });

  it('keeps every write behind a server action rather than a client fetch', () => {
    // A client-side fetch would put the session token in reach of page script
    // and would bypass the audited server boundary entirely.
    for (const { path, source } of PHASE_FILES) {
      if (!/-api\.ts$|\/api\.ts$|-actions\.ts$/.test(path)) continue;
      expect(source, path).toContain("'use server'");
      expect(source, path).not.toMatch(/\bfetch\(/);
    }
  });
});
