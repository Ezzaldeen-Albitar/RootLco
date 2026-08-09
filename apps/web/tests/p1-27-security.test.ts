import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_PERMISSIONS, VEHICLE_PERMISSIONS, holds } from '@/features/crm/permissions';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import { companyFilterQuery, query } from '@/lib/api/read-operation';
import {
  carriableSearchParams,
  FORBIDDEN_URL_KEYS,
  isForbiddenUrlKey,
  toSearchParams,
} from '@/components/data-table/table-state';
import { PUBLISHED_OPERATIONS } from '@/lib/api/idempotent-operations';
import { searchCustomerDirectory } from '@/lib/customers/directory';
import {
  DOCUMENT_LIST_PERMISSION,
  MEDIA_BLOCKING_DECISION,
  MEDIA_STATUS,
} from '@/features/vehicles/documents-contract';
import enMessages from '../src/i18n/messages/en.json';
import arMessages from '../src/i18n/messages/ar.json';

/**
 * The session cookie, faked, so the REAL server read path can run here.
 *
 * `next/headers` is the only thing in that path that needs a request context.
 * Replacing it — and nothing else — means `authorizedClient()`, `ApiClient` and
 * the query builder are all the shipped code, and the only substitution below
 * this line is the transport itself. See the `P1-27-QA-003` section at the foot
 * of this file, which is the only place it is used.
 */
const cookieJar = vi.hoisted(() => ({ token: 'session-token-for-tenant-a' }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.token === null ? undefined : { name, value: cookieJar.token },
  }),
}));

/** The two catalogues, as plain lookups. A key missing from one is a real gap. */
const EN = enMessages as Record<string, string>;
const AR = arMessages as Record<string, string>;

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

/**
 * Every file under `dir`, with POSIX separators.
 *
 * The separator is normalised because these sweeps select files by PATTERN, and
 * a pattern anchored on `/` silently matches nothing on Windows. `\/api\.ts$`
 * below is exactly that: on a developer's Windows machine it never examined
 * `features/crm/customers/api.ts` at all, so the sweep passed by not looking —
 * while on `ubuntu-latest`, where hosted CI runs, it looked and failed.
 *
 * A path-shaped assertion must therefore be written against one canonical
 * spelling, not against whatever the host filesystem happens to use.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full.split(sep).join('/'));
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

/**
 * The phase's WHOLE surface, including the parts that left `features/`.
 *
 * `PHASE_FILES` walks `features/crm` and `features/vehicles` and nothing else,
 * which was the entire phase surface when it was written. It is not any more.
 * D1 and D2 moved real P1-27 code out, because a feature may never import
 * another feature and both trees needed the same customer selector and the same
 * duplicate explanations:
 *
 *   components/party/CustomerSelector.tsx   components/party/PartyLabel.tsx
 *   components/duplicates/MatchExplanation.tsx
 *   lib/customers/directory.ts              lib/customers/directory-contract.ts
 *   lib/duplicates/explanations.ts          lib/duplicates/score.ts
 *
 * Seven files that render customer names and duplicate evidence — precisely the
 * material `SEC-002` is about — sat outside every sweep that claims to cover
 * "the CRM and vehicle surface". The routes were outside it too.
 *
 * `PHASE_FILES` is left as it is, so the `SEC-001` and `SEC-003` cases keep
 * asserting exactly what they asserted before; only the `SEC-002` sweeps move to
 * the wider set. Narrowing a passing rule while widening another in one commit
 * is how a regression hides.
 */
/*
 * `components/forms` joined this list as `R1`.
 *
 * The commit that created `PHASE_SURFACE` also added `RecordForm` to the QA-001
 * inventory, calling it a P1-27 deliverable that "eleven P1-27 write surfaces
 * render through" — and left it out of the security surface in the same breath.
 * What `PHASE_SURFACE` held was the one-line re-export shim under
 * `features/crm/customers/components/`, never the implementation.
 *
 * So the 331-line component every customer and vehicle write submits through was
 * outside every sweep that claims to cover "the phase's WHOLE surface" — the
 * upload-path rule most of all, since a file-input would be added to a form
 * component and nowhere else.
 */
const MOVED_OUT = [
  'components/party',
  'components/duplicates',
  'components/forms',
  'lib/customers',
  'lib/duplicates',
];

/**
 * The P1-27 gate module itself, imported so a rule can never be RESTATED here.
 *
 * ## Why the import, and why it is spelled like this
 *
 * `SEC-004`'s console case used to carry its own regex —
 * `/console\.(log|info|debug|warn|error)\(/` — five names, while the gate bans
 * ANY console method. `console.table(customer)`, `console.trace()` and
 * `console.dir(vehicle)` therefore passed the test that was cited as the proof
 * of the rule, and `table` and `dir` are precisely the two a developer reaches
 * for to print an object. A test narrower than the gate it cites is not a proof
 * of that gate; it is a proof of a smaller rule with the same name.
 *
 * So the rule is now READ from the gate. The two cannot drift, because there is
 * only one of them.
 *
 * The specifier is computed rather than written as a literal on purpose. The web
 * package sets `allowJs: false` and includes only TypeScript sources, so a static
 * `import … from '../../../scripts/ci/check-p1-27-frontend.mjs'` is `TS2307` in
 * `typecheck:web` — the check would be bought at the price of a broken build.
 * A runtime specifier is resolved by Node, not by TypeScript.
 */
interface GateRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly what: string;
  readonly allow: readonly string[];
}
const GATE = (await import(
  pathToFileURL(join(process.cwd(), '..', '..', 'scripts', 'ci', 'check-p1-27-frontend.mjs')).href
)) as {
  readonly RULES: readonly GateRule[];
  readonly SCAN_ROOTS: readonly string[];
  readonly stripComments: (source: string) => string;
  readonly evaluate: (files: readonly { path: string; source: string }[]) => {
    readonly failures: string[];
    readonly counts: Record<string, number>;
  };
};

const PHASE_SURFACE = [
  ...PHASE_FILES,
  ...MOVED_OUT.flatMap((rel) => walk(join(process.cwd(), 'src', ...rel.split('/')))).map(
    (path) => ({
      path,
      source: code(readFileSync(path, 'utf8')),
    })
  ),
  ...PHASE_ROUTES.map((path) => ({ path, source: code(readFileSync(path, 'utf8')) })),
];

describe('P1-27-SEC-001 — permission and resolved scope', () => {
  it('found the surface it is about to make claims about', () => {
    // Without this the sweeps below pass on an empty array and this whole file
    // becomes a green report on nothing.
    expect(PHASE_FILES.length).toBeGreaterThan(20);
    expect(PHASE_ROUTES.length).toBeGreaterThan(5);
    // And the stripper left real code behind. A `code()` that returned '' would
    // make every absence sweep in this file vacuous at once.
    expect(PHASE_FILES.filter((f) => f.source.includes('export')).length).toBeGreaterThan(20);

    /*
     * And the WIDER surface really is wider, by the files that left `features/`.
     *
     * Without this, `PHASE_SURFACE` could silently collapse back to
     * `PHASE_FILES` — a renamed directory, a moved file, a typo in `MOVED_OUT` —
     * and every SEC-002 sweep would go on passing while covering less than it
     * says. Named individually rather than by count alone, because a count is
     * satisfied by any seven files and these seven are the ones that render
     * customer names and duplicate evidence.
     */
    expect(PHASE_SURFACE.length).toBeGreaterThan(PHASE_FILES.length + 10);
    for (const required of [
      'components/party/CustomerSelector.tsx',
      'components/party/PartyLabel.tsx',
      'components/duplicates/MatchExplanation.tsx',
      'lib/customers/directory.ts',
      'lib/duplicates/explanations.ts',
    ]) {
      expect(
        PHASE_SURFACE.some((f) => f.path.endsWith(required)),
        `${required} is P1-27 surface and is outside the sweep`
      ).toBe(true);
    }
  });

  it('strips comments without blinding itself to code', () => {
    const sample = [
      '// customer-merge named in a line comment',
      '/** vehicle-merge named in a docblock */',
      "const path = '/merge';",
      "const doc = 'https://example.test/keep-me';",
    ].join('\n');
    const stripped = code(sample);
    // Prose about an absence is gone …
    expect(stripped).not.toContain('customer-merge');
    expect(stripped).not.toContain('vehicle-merge');
    // … and the code that would constitute the thing itself is still there.
    expect(stripped).toContain("'/merge'");
    // The TAIL, not the whole URL: `includes()` of a full URL is
    // `js/incomplete-url-substring-sanitization`, raised as HIGH on PR #198.
    // What this proves is that the characters after the `//` survived, which is
    // exactly what a truncation at `https:` would destroy.
    expect(stripped).toContain('/keep-me');
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
    // a plate or a customer's phone number must never reach it.
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

  it('publishes NO table state to the address bar at all, which is why the above holds', () => {
    /*
     * The assertion before this one describes a filter, and a filter is not what
     * protects the address bar today.
     *
     * `toSearchParams` has no production caller: no screen publishes its table
     * request to the URL. Both search screens keep their criteria in React state
     * (`draft` / `committed`) and mount the table with `INITIAL_REQUEST`, so a
     * customer's name or a VIN is never a candidate for the query string in the
     * first place. That is a stronger guarantee than a deny-list — a deny-list is
     * a promise to have thought of every dangerous name in advance — and it is
     * the guarantee `SEC-002` actually rests on.
     *
     * Asserting it structurally matters because the previous case, alone, would
     * pass with both search screens deleted. This one would not.
     *
     * `isForbiddenUrlKey` is NOT dead, and an audit of this task reported that it
     * was. It is called by `carriableSearchParams`, which the locale switcher
     * calls on every page to preserve page and sort across a language change —
     * so the deny-list guards the one place table state DOES cross a navigation.
     */
    const writers = PHASE_SURFACE.filter(({ source }) =>
      /toSearchParams|history\.(push|replace)State|window\.location\.search\s*=/.test(source)
    );
    expect(
      writers.map((f) => f.path),
      'a P1-27 screen started publishing table state to the URL'
    ).toEqual([]);

    // And the live deny-list is genuinely applied where table state DOES travel.
    expect(isForbiddenUrlKey('search')).toBe(true);
    expect(isForbiddenUrlKey('customer_name')).toBe(true);
    expect(carriableSearchParams('page=3&sort=name&search=Nadia&vin=JH4').toString()).toBe(
      'page=3&sort=name'
    );
  });

  it('calls no export operation anywhere in this phase', () => {
    // Bulk extraction of customer or vehicle records is not a P1-27 task and no
    // screen offers it. An export added later must be a deliberate decision
    // with its own permission, not an affordance that appeared.
    for (const { path, source } of PHASE_SURFACE) {
      expect(source, path).not.toMatch(/\/export|-export|exportC|downloadAll/);
    }
  });

  it('offers no upload path of any kind', () => {
    // `P1-OD-025` must decide accepted types, size limits and storage before a
    // vehicle media operation can exist. There is none to call.
    for (const { path, source } of PHASE_SURFACE) {
      expect(source, path).not.toMatch(/FormData\(\)|multipart\/form-data|type="file"/);
    }
  });

  it('never renders unescaped HTML from any server value', () => {
    for (const { path, source } of PHASE_SURFACE) {
      expect(source, path).not.toContain('dangerouslySetInnerHTML');
    }
  });
});

/* ------------------------------------------------------------------ *
 * SEC-002 is a CONJUNCTION, and is proved one conjunct at a time
 * ------------------------------------------------------------------ */

/**
 * `SEC-002` reads "sensitive-data, export, document, media and file-access
 * controls". Five obligations joined by "and" — so it is satisfied only when all
 * five are, and finding A42-14 adjudicated it on the strength of the address-bar
 * work alone. Three of the five had no case anywhere in this file.
 *
 * Named as data so a conjunct cannot be dropped by deleting a `describe`.
 */
const SEC_002_PARTS = ['sensitive-data', 'export', 'document', 'media', 'file-access'] as const;

/** Which of the five have a SURFACE in this phase, and which are absences. */
const SEC_002_DISPOSITION: Readonly<Record<(typeof SEC_002_PARTS)[number], 'surface' | 'absence'>> =
  {
    'sensitive-data': 'surface',
    export: 'absence',
    document: 'surface',
    media: 'absence',
    'file-access': 'absence',
  };

describe('P1-27-SEC-002 — five conjuncts, proved separately', () => {
  it('states all five and which of them are absences', () => {
    expect(SEC_002_PARTS).toHaveLength(5);
    expect(Object.keys(SEC_002_DISPOSITION).sort()).toEqual([...SEC_002_PARTS].sort());
    // Three of the five are proved by ABSENCE. An absence is only a finding when
    // the thing being refused exists to be called, which the cases below
    // establish from the published contract rather than from a regex.
    expect(Object.values(SEC_002_DISPOSITION).filter((d) => d === 'absence')).toHaveLength(3);
  });

  describe('1/5 sensitive data — a real surface, and it does not overstate itself', () => {
    it('never presents a note list as complete when the backend may have shortened it', () => {
      /*
       * `sel_notes_tenant` drops `restricted` and `secret` rows for a caller
       * without `iam.sensitive.view`, and drops them SILENTLY: the list is just
       * shorter. A screen that said nothing would present a partial record as
       * the whole one — which is a sensitive-data failure in the direction that
       * matters, because the operator cannot tell that anything is missing.
       */
      const api = PHASE_FILES.find((f) => f.path.endsWith('crm/customers/profile-api.ts'));
      expect(api, 'the notes adapter is the thing under test').toBeDefined();
      expect(api?.source, 'listNotes must carry the completeness flag out').toContain(
        'includesRestricted'
      );

      const screen = PHASE_FILES.find((f) =>
        f.path.endsWith('components/CustomerProfileScreen.tsx')
      );
      expect(screen?.source).toContain('crm.customers.notes.includesRestricted');
      expect(screen?.source).toContain('crm.customers.notes.restrictedHidden');
      // `null` means no successful read yet, so NEITHER claim is made. A default
      // of "you are seeing everything" would be the lie this exists to prevent.
      expect(screen?.source).toMatch(/includesRestricted === null\s*\n?\s*\?\s*null/);
    });

    it('publishes both completeness sentences in both catalogues', () => {
      // A caveat only present in English is a caveat an Arabic operator does not
      // get, on the one screen where not getting it means believing a short list.
      for (const key of [
        'crm.customers.notes.includesRestricted',
        'crm.customers.notes.restrictedHidden',
      ]) {
        expect(Object.keys(EN), key).toContain(key);
        expect(Object.keys(AR), key).toContain(key);
        expect(EN[key], key).not.toBe(AR[key]);
      }
    });

    it('puts no customer or vehicle value in browser storage', () => {
      // The address-bar cases above cover the URL. Storage is the other place a
      // value outlives the request, and it survives a logout.
      for (const { path, source } of PHASE_SURFACE) {
        expect(source, path).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      }
    });
  });

  describe('2/5 export — the platform publishes one, and this phase calls neither', () => {
    it('confirms the export operations exist, so their absence here is a decision', () => {
      // Anti-vacuity, and the reason this conjunct is worth asserting at all: a
      // sweep for a thing that does not exist proves nothing about restraint.
      for (const id of ['shared.export-authorize', 'shared.export-catalogue']) {
        expect(
          PUBLISHED_OPERATIONS.some((op) => op.operationId === id),
          `${id} is not in the published contract — this sweep would be vacuous`
        ).toBe(true);
      }
    });

    it('calls neither export operation, and builds no client-side extraction', () => {
      for (const { path, source } of PHASE_SURFACE) {
        expect(source, path).not.toMatch(/export-authorize|export-catalogue|\/exports\b/);
        // The other way to export: assemble the bytes in the browser.
        expect(source, path).not.toMatch(
          /new Blob\(|createObjectURL|download=|text\/csv|application\/pdf/
        );
      }
    });
  });

  describe('3/5 documents — a real surface with three controls', () => {
    it('gates the list on a manage capability from a DIFFERENT module', () => {
      expect(DOCUMENT_LIST_PERMISSION).toBe('shared.document.manage');
      // Not a vehicle code. Every other vehicle sub-resource is gated by one, so
      // a copy-paste to `veh.vehicle.read` would open the tab to every reader.
      expect(DOCUMENT_LIST_PERMISSION.startsWith('veh.')).toBe(false);

      const route = PHASE_ROUTES.find((p) => p.includes('/vehicles/[vehicleId]/page.tsx'));
      expect(route, 'the vehicle profile route is where the gate lives').toBeDefined();
      const source = code(readFileSync(route as string, 'utf8'));
      // The list is READ only when the capability is held: a denied operator must
      // not spend an `expensive-read` slot discovering they cannot see it.
      expect(source).toMatch(/canListDocuments\s*\n?\s*\?\s*await listVehicleDocuments/);
    });

    it('constructs no download URL and prefetches no download authorization', () => {
      expect(
        PUBLISHED_OPERATIONS.some(
          (op) => op.operationId === 'shared.attachment-download-authorize'
        ),
        'the download authorization exists — this absence is a decision, not a gap'
      ).toBe(true);
      for (const { path, source } of PHASE_SURFACE) {
        expect(source, path).not.toMatch(/attachment-download|download-authorizations/);
      }
    });

    it('publishes only what the operation returns — an id list, and no metadata', () => {
      // `veh.vehicle-document-list` returns ids and nothing else. A `name`,
      // `size` or `mimeType` field here would be a value invented on the client
      // and presented to an operator as a fact about a document.
      const contract = readFileSync(join(FEATURES, 'vehicles', 'documents-contract.ts'), 'utf8');
      const shape = /export interface VehicleDocuments \{([\s\S]*?)\n\}/.exec(contract)?.[1] ?? '';
      expect(shape, 'the VehicleDocuments interface was not found').not.toBe('');
      expect(shape).toContain('documentIds');
      for (const invented of ['fileName', 'name', 'size', 'mimeType', 'uploadedAt', 'type']) {
        expect(shape, `VehicleDocuments invents a ${invented}`).not.toMatch(
          new RegExp(`\\b${invented}\\b`)
        );
      }
    });
  });

  describe('4/5 media — decision-neutral, and it says so rather than pretending', () => {
    /*
     * Canonical plan §7: `P1-OD-025` is OPEN. The disposition is a
     * decision-neutral foundation, upload acceptance BLOCKED, and no invented
     * limits. Three separate obligations, and the third is the one a
     * well-meaning implementation breaks: a "sensible default" of 10 MB and
     * JPEG/PNG would pre-empt the decision while looking like diligence.
     */
    it('carries one closed status and names the open decision', () => {
      expect(MEDIA_STATUS).toBe('blocked-on-p1-od-025');
      expect(MEDIA_BLOCKING_DECISION).toBe('P1-OD-025');
    });

    it('states the policy is PENDING, in both catalogues', () => {
      for (const key of ['vehicles.media.heading', 'vehicles.media.blocked']) {
        expect(Object.keys(EN), key).toContain(key);
        expect(Object.keys(AR), key).toContain(key);
        expect(EN[key], key).not.toBe(AR[key]);
      }
      // The English copy has to say the two things the disposition requires:
      // that nothing is available yet, and that a decision is outstanding.
      expect(EN['vehicles.media.blocked']?.toLowerCase()).toContain('pending');
      expect(EN['vehicles.media.blocked']?.toLowerCase()).toContain('decision');
    });

    it('invents no accepted type, no size limit and no storage placement', () => {
      // A number or a file extension in this copy IS the invented limit. There
      // is no decision to derive one from.
      for (const key of ['vehicles.media.blocked'] as const) {
        for (const catalogue of [EN, AR]) {
          expect(catalogue[key], key).not.toMatch(/\d/);
          expect(catalogue[key], key).not.toMatch(/jpe?g|png|heic|mp4|\bMB\b|\bKB\b/i);
        }
      }
      // And nowhere in the code either — not as a constant waiting to be used.
      for (const { path, source } of PHASE_SURFACE) {
        expect(source, path).not.toMatch(
          /MAX_(FILE|UPLOAD|IMAGE|MEDIA)_|ACCEPTED_(FILE|MIME|IMAGE)|accept=/
        );
      }
    });

    it('renders the statement with NO control beside it', () => {
      /*
       * Not even a disabled one. A greyed-out upload button advertises a
       * capability the product does not have and cannot have until the decision
       * is made — and a disabled control is the single most likely thing for a
       * later commit to enable.
       *
       * Read out of the media `<section>` itself rather than the whole file, so
       * the documents section above it cannot satisfy this by being control-free.
       */
      const file = readFileSync(
        join(FEATURES, 'vehicles', 'components', 'VehicleDocumentsSection.tsx'),
        'utf8'
      );
      const media = /<section\s+aria-labelledby="vehicle-media-heading"([\s\S]*?)<\/section>/.exec(
        code(file)
      )?.[1];
      expect(
        media,
        'the media section was not found — this case is measuring nothing'
      ).toBeDefined();
      expect(media).toContain('vehicles.media.blocked');
      expect(media).toContain('MEDIA_BLOCKING_DECISION');
      for (const control of ['<button', '<input', '<form', '<a ', 'onClick', 'disabled']) {
        expect(media, `the media section renders ${control}`).not.toContain(control);
      }
    });
  });

  describe('5/5 file access — no path in, and none out', () => {
    it('has no upload, drag-drop or file-reading construct on the whole surface', () => {
      const FILE_ACCESS =
        /new FormData\(|multipart\/form-data|type="file"|type={'file'}|FileReader|\.files\b|onDrop=|DataTransfer/;
      for (const { path, source } of PHASE_SURFACE) {
        expect(source, path).not.toMatch(FILE_ACCESS);
      }
    });

    it('is enforced by the phase GATE as well as by this suite', () => {
      /*
       * A test can be deleted in the same commit as the code it guards. The gate
       * runs in CI over the tree, so the two failures are independent.
       *
       * Asserted through the gate's own `evaluate`, with the rule read from the
       * gate — the same discipline the console rule now follows.
       */
      const rule = GATE.RULES.find((r) => r.id === 'no-upload-path');
      expect(rule, 'the gate has no no-upload-path rule').toBeDefined();
      const planted = GATE.evaluate([
        {
          path: 'apps/web/src/features/vehicles/components/VehicleDocumentsSection.tsx',
          source: 'const body = new FormData();',
        },
      ]);
      expect(planted.failures.filter((f) => f.startsWith('no-upload-path:'))).toHaveLength(1);
    });
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
    // An operator who cannot quote a correlation reference cannot have an
    // incident traced. Every adapter carries one out of the failure, including
    // the ones that return an empty page.
    //
    // An adapter satisfies this in one of two ways: it maps the failure itself,
    // or it DELEGATES that mapping to `action-support.ts`, which exists because
    // the customer write actions had one copy of the mapping between them and a
    // second copy would drift. Delegation is not a loophole — the delegate is
    // asserted to carry the reference below, so a file that delegated to
    // something which did not would still fail.
    const SUPPORT = 'action-support.ts';
    const adapters = PHASE_FILES.filter((f) =>
      /-api\.ts$|\/api\.ts$|-actions\.ts$|action-support\.ts$/.test(f.path)
    );
    expect(adapters.length).toBeGreaterThan(8);

    const support = adapters.find((f) => f.path.endsWith(SUPPORT));
    expect(support, 'the shared failure mapping must exist to be delegated to').toBeDefined();
    expect(support?.source, SUPPORT).toContain('correlationId');

    /*
     * The two modules an adapter may delegate its failure mapping to, each
     * asserted to carry the reference itself so delegation is never a loophole.
     *
     * `lib/customers/directory` joined the list when the customer-search adapter
     * moved there: `features/vehicles` needs the same search to choose a
     * customer and no feature may import another, so the implementation went to
     * `lib/` and `features/crm/customers/api.ts` became a thin wrapper. That
     * wrapper carries no `correlationId` of its own — correctly, because it adds
     * no behaviour — and the rule had no way to say so.
     */
    const DELEGATES = [`./${SUPPORT.replace('.ts', '')}`, '@/lib/customers/directory'] as const;

    const directory = readFileSync(
      join(process.cwd(), 'src', 'lib', 'customers', 'directory.ts'),
      'utf8'
    );
    expect(
      directory,
      'the customer directory must carry the reference it is trusted for'
    ).toContain('correlationId');

    for (const { path, source } of adapters) {
      if (source.includes('correlationId')) continue;
      expect(
        DELEGATES.some((delegate) => source.includes(delegate)),
        `${path} neither carries a correlation reference nor delegates to one that does`
      ).toBe(true);
    }
  });

  it('renders the reference on the ROUTE failure states, not only inside adapters', () => {
    /*
     * The sweep above walks `PHASE_FILES` — `src/features` — and never opens a
     * route. So it asserted that every adapter CARRIES a correlation reference
     * out of a failure, and nothing asserted that any screen ever SHOWS one.
     *
     * That blind spot held a real defect. `crm/customers/[customerId]/page.tsx`
     * rendered `<BackendUnavailableState messages={messages} />` with no
     * reference, twelve lines below a `<PermissionDeniedState>` that passed one,
     * and beside a vehicle profile route that passed one too. The backend
     * outcome carried it the whole way; the last line dropped it — on the one
     * state where an operator has nothing else to quote. `correlationId` is an
     * optional prop (`States.tsx:199`), so the compiler had no opinion either.
     *
     * This walks the rendered TAGS. A file-level `includes('correlationId')`
     * would have passed on that page, because the denial branch above already
     * contained the word.
     */
    const FAILURE_STATES = /<(BackendUnavailableState|ErrorState)\b([^>]*)>/g;

    const inspected: string[] = [];
    for (const path of PHASE_ROUTES) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(FAILURE_STATES)) {
        const [, component = '', attributes = ''] = match;
        inspected.push(`${path.replace(/\\/g, '/').split('/src/app/')[1]} <${component}>`);
        expect(
          attributes,
          `${path} renders <${component}> without a correlation reference — ` +
            'an operator seeing this state has nothing to quote'
        ).toContain('correlationId');
      }
    }

    /*
     * WHICH tags were inspected, not how many.
     *
     * `R4`: this guard was `expect(inspected).toBeGreaterThan(0)`, a suite-wide
     * counter over a sweep that matches exactly two tags across eight routes.
     * Renaming either failure-state component, or moving or deleting either
     * route, would have dropped one of the two and left the counter at 1 — still
     * greater than zero, still green, and the comment beside it claiming that
     * "a rename or a route move cannot make it pass by matching nothing".
     *
     * A count above zero is not coverage; it is the weakest possible statement
     * that something happened. Naming the pair means a route joining or leaving
     * the recoverable surface has to be acknowledged here.
     */
    expect(inspected.sort(), 'the set of inspected route failure states changed').toEqual([
      '[locale]/(dashboard)/crm/customers/[customerId]/page.tsx <BackendUnavailableState>',
      '[locale]/(dashboard)/vehicles/[vehicleId]/page.tsx <ErrorState>',
    ]);
  });

  /*
   * ------------------------------------------------------------------
   * The console rule — the GATE's rule, not a second one wearing its name
   * ------------------------------------------------------------------
   *
   * Three obligations, and the old single assertion met none of them:
   *
   *   1. the test must apply the SAME pattern the gate applies;
   *   2. the pattern must be shown to match every console method a developer
   *      might actually reach for, so importing it cannot become circular — an
   *      imported rule weakened to `/never-matches/` would otherwise make the
   *      sweep pass by matching nothing;
   *   3. the pattern must be shown NOT to match innocent text, or the previous
   *      obligation could be met by `/./`.
   */

  const consoleRule = GATE.RULES.find((rule) => rule.id === 'no-console-output');

  it('reads the console rule out of the gate that enforces it', () => {
    expect(GATE.RULES.length, 'the gate exposed no rules').toBeGreaterThan(4);
    expect(consoleRule, 'the gate has no rule called no-console-output').toBeDefined();
    /*
     * The rule's reach may never shrink below the two feature trees.
     *
     * This asserted equality against a hand-listed pair, with a comment saying a
     * third tree "has to be acknowledged rather than silently reducing what the
     * rule covers". The intent was right and the assertion was the wrong shape
     * for it: a third tree does not reduce coverage, it widens it, and equality
     * turned the correct widening into a failure here while the gate itself was
     * green. Written this way, a rename or a deletion still fails — which is the
     * reduction the comment was actually about — and growth does not.
     *
     * The FULL root list is pinned to the canonical plan in the gate's own suite
     * (`tests/ci/p1-27-frontend-gate.test.ts`, which re-derives it from
     * `canonical-plan.md`). Restating that authority here would be a second copy
     * to drift, which is the fault this phase keeps finding.
     */
    const roots = GATE.SCAN_ROOTS.map((root: string) => root.split(sep).join('/'));
    expect(roots, 'the CRM tree left the console rule').toContain('apps/web/src/features/crm');
    expect(roots, 'the vehicle tree left the console rule').toContain(
      'apps/web/src/features/vehicles'
    );
    // This test's own comment stripper must not be weaker than the gate's, or
    // the sweep below could pass on text the gate would have kept.
    const sample = "// console.table(x)\nconst keep = 'https://e.test/keep';\nconsole.dir(y);";
    expect(code(sample)).toBe(GATE.stripComments(sample));
  });

  it('matches EVERY console method, which is the rule the five-name version missed', () => {
    /*
     * `table`, `trace` and `dir` are the three the old assertion let through,
     * and they are named first because they are the ones that print an object
     * most legibly — the shape of the mistake this rule exists to catch.
     */
    const METHODS = [
      'table',
      'trace',
      'dir',
      'group',
      'count',
      'assert',
      'log',
      'error',
      'warn',
      'info',
      'debug',
      'dirxml',
      'groupCollapsed',
      'timeEnd',
    ];
    for (const method of METHODS) {
      expect(
        consoleRule?.pattern.test(`console.${method}(customer)`),
        `console.${method}() would pass the rule`
      ).toBe(true);
    }
    // Whitespace before the parenthesis is in the pattern, so a formatter
    // cannot launder a violation past it.
    expect(consoleRule?.pattern.test('console.table (customer)')).toBe(true);
  });

  it('does not match innocent text, so the case above is not satisfied by /./', () => {
    const INNOCENT = [
      "const note = 'the console is not used on this screen';",
      'const consoleLabel = "diagnostics";',
      'logger.info({ customerId: id });',
      'type Printer = typeof console.log;',
      'const method = "console.table";',
    ];
    for (const sample of INNOCENT) {
      expect(consoleRule?.pattern.test(sample), sample).toBe(false);
    }
  });

  it('fails the gate on a planted console.table and passes it on clean source', () => {
    // Through `evaluate`, so this exercises the rule the way the gate does —
    // comment stripping, allow list and all — rather than the pattern alone.
    const planted = GATE.evaluate([
      { path: 'apps/web/src/features/crm/customers/profile-api.ts', source: 'console.table(c);' },
    ]);
    expect(planted.failures.filter((f) => f.startsWith('no-console-output:'))).toHaveLength(1);

    const clean = GATE.evaluate([
      {
        path: 'apps/web/src/features/crm/customers/profile-api.ts',
        // A docblock NAMING the rule is not a violation of it, and a gate that
        // could not tell the difference would forbid documenting the refusal.
        source: '/** never console.table here */\nexport const ok = 1;',
      },
    ]);
    expect(clean.failures).toEqual([]);
  });

  // The title is unchanged from the assertion this replaces, deliberately: the
  // phase traceability document quotes it, and a rename would have broken a
  // document this branch does not own to say the same thing in new words.
  it('never logs a server value to the browser console', () => {
    /*
     * `PHASE_SURFACE`, not `PHASE_FILES`. The gate scans `features/crm` and
     * `features/vehicles`; this sweep also covers `src/app` and the seven
     * modules that left `features/` — which the gate structurally cannot see.
     *
     * The test may be WIDER than the gate. It must never be narrower, which is
     * exactly what it had been.
     */
    expect(PHASE_SURFACE.length).toBeGreaterThan(PHASE_FILES.length);
    const offenders = PHASE_SURFACE.filter(({ source }) => consoleRule?.pattern.test(source)).map(
      (f) => f.path
    );
    expect(offenders, 'these P1-27 files write to the console').toEqual([]);
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

/**
 * `P1-27-QA-003` — tenant, company and branch isolation.
 *
 * ## Read this before believing the section title
 *
 * **This tier cannot close QA-003, and does not claim to.** Isolation is
 * enforced by the server: the token identifies the caller, the backend resolves
 * tenant, company and branch from it, and a row belonging to another tenant is
 * refused before it is selected. The only proof that the refusal WORKS is a
 * proof against a real database with two real tenants, and in this repository
 * that is `tests/e2e/authenticated/isolation.spec.ts` — which is gated behind
 * `ROOTLCO_E2E_AUTH=1` and runs in no CI job. That gap is real and is not
 * papered over here.
 *
 * The obvious substitute — stub the transport so it answers as a different
 * tenant would, and assert the read layer refuses the row — was attempted and
 * abandoned, because it cannot be built honestly: **the client has nothing to
 * compare the row against.** `CustomerSearchHit`
 * carries `id`, `displayNumber`, `displayName`, `partyType`, `lifecycleStatus`
 * and `createdAt` — no tenant, no company, no branch. A row belonging to another
 * tenant is byte-for-byte indistinguishable from one belonging to this one, so a
 * client-side "refusal" could only ever be theatre: a check that passes every
 * input and would be cited later as evidence of a control that never existed.
 * The last thing this phase needs is another assertion that agrees with itself.
 *
 * ## So what IS proved here, at a tier that actually runs
 *
 * Four true things, each with a control that shows the instrument can fail:
 *
 * 1. The real read path, driven end to end with only the transport replaced,
 *    sends NO scope — not in the query string and not in a header. The
 *    operator's own criteria do travel, which is what stops "no scope found"
 *    from being satisfied by an empty request.
 * 2. The caller is identified by the session bearer alone.
 * 3. The URL the real path produces is byte-identical to what the guarded query
 *    builder produces, so the builder that REFUSES a scope key is on the path a
 *    read actually takes — not merely exported nearby.
 * 4. When the server refuses — which is how isolation reaches a screen — the
 *    read layer propagates the refusal instead of rendering it as an empty list.
 *    An operator must never read "you may not see this" as "there is nothing
 *    here".
 *
 * And one thing is pinned as a FACT rather than as a desired property: the row
 * payload and the session share no scope field. If a future payload ever gains
 * one, that case fails, and the reader who fixes it will be told that a
 * client-side comparison has become possible for the first time.
 */

/** Where the client points when nothing sets `NEXT_PUBLIC_API_BASE_URL`. */
const API_ORIGIN = 'http://localhost:3000';

/** Every spelling of a scope this application refuses to assert from a client. */
const SCOPE_NAMES = [
  'tenantId',
  'companyId',
  'branchId',
  'tenant_id',
  'company_id',
  'branch_id',
] as const;

/** Scope parameters present in a URL. The instrument, checked below before use. */
function scopeParamsIn(url: string): string[] {
  const parameters = new URL(url).searchParams;
  return SCOPE_NAMES.filter((name) => parameters.has(name)).sort();
}

/** Header names that name a scope. Same question, other half of the request. */
function scopeHeadersIn(headers: Headers): string[] {
  const found: string[] = [];
  headers.forEach((_value, name) => {
    if (/tenant|company|branch/i.test(name)) found.push(name);
  });
  return found.sort();
}

interface CapturedRequest {
  readonly url: string;
  readonly headers: Headers;
}

const captured: CapturedRequest[] = [];

/**
 * The one request the read path issued.
 *
 * Throws rather than returning undefined, so a case that asserts a property of
 * "the request" can never pass by asserting it of nothing — the failure mode
 * that makes a transport observation worthless.
 */
function onlyRequest(): CapturedRequest {
  const first = captured[0];
  if (!first) throw new Error('the read path issued no request at all');
  return first;
}

/**
 * A backend that answers with `body`, recording what it was asked.
 *
 * Only `fetch` is replaced. `searchCustomerDirectory`, `authorizedClient`,
 * `ApiClient` and `query` are all the shipped implementations, so what is
 * observed here is the request the application really assembles.
 */
function backendAnswering(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({ url: String(url), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
        },
      });
    })
  );
}

const TABLE_REQUEST = { page: 1, pageSize: 25, sort: null, filters: [], search: '' } as const;

/**
 * A page as the backend publishes one — and every row in it belongs to a
 * DIFFERENT tenant than the session does.
 *
 * Nothing in the payload says so. That is the point, and it is why no assertion
 * below claims the client detected it.
 */
const PAGE_FROM_ANOTHER_TENANT = {
  items: [
    {
      id: '9a1d3c77-0e5b-4a2f-b8d1-6c4e2f0a7b95',
      displayNumber: 'C-000991',
      displayName: 'A customer of some other tenant',
      partyType: 'organization',
      lifecycleStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  nextCursor: null,
  hasMore: false,
};

describe('P1-27-QA-003 — what the client tier can prove about isolation', () => {
  beforeEach(() => {
    captured.length = 0;
    cookieJar.token = 'session-token-for-tenant-a';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the instrument fires — a request that DOES carry a scope is detected', () => {
    // The positive control. Without it, "no scope found" is equally consistent
    // with a detector that finds nothing anywhere.
    for (const name of SCOPE_NAMES) {
      expect(scopeParamsIn(`${API_ORIGIN}/api/v1/customers?name=ali&${name}=x`)).toEqual([name]);
    }
    expect(scopeParamsIn(`${API_ORIGIN}/api/v1/customers?name=ali`)).toEqual([]);

    const leaky = new Headers({ authorization: 'Bearer x', 'x-tenant-id': 't' });
    expect(scopeHeadersIn(leaky)).toEqual(['x-tenant-id']);
    expect(scopeHeadersIn(new Headers({ authorization: 'Bearer x' }))).toEqual([]);
  });

  it('sends no tenant, company or branch on the real read path', async () => {
    backendAnswering(200, PAGE_FROM_ANOTHER_TENANT);
    await searchCustomerDirectory(TABLE_REQUEST, null, { name: 'Nadia' });

    expect(captured).toHaveLength(1);
    const { url } = onlyRequest();
    expect(url.startsWith(`${API_ORIGIN}/api/v1/customers?`)).toBe(true);
    // Anti-vacuity: the request really did carry the operator's criteria, so an
    // empty scope list is a fact about the request rather than about an empty
    // one that was never sent.
    expect(new URL(url).searchParams.get('name')).toBe('Nadia');
    expect(new URL(url).searchParams.get('limit')).toBe('25');
    expect(scopeParamsIn(url)).toEqual([]);
  });

  it('identifies the caller by the session bearer, and by nothing else', async () => {
    backendAnswering(200, PAGE_FROM_ANOTHER_TENANT);
    await searchCustomerDirectory(TABLE_REQUEST, null, { name: 'Nadia' });

    const { headers } = onlyRequest();
    expect(headers.get('authorization')).toBe('Bearer session-token-for-tenant-a');
    expect(scopeHeadersIn(headers)).toEqual([]);
  });

  it('builds that URL with the builder that REFUSES a scope, not beside it', async () => {
    /*
     * The guard is only worth anything if the read path goes through it. Rather
     * than reading the source and hoping, the URL the application actually sent
     * is compared with what `query()` produces for the same parameters: equal
     * strings mean the observed request came out of the guarded builder.
     */
    backendAnswering(200, PAGE_FROM_ANOTHER_TENANT);
    await searchCustomerDirectory(TABLE_REQUEST, null, { name: 'Nadia' });

    const expected =
      `${API_ORIGIN}/api/v1/customers` + query({ cursor: null, limit: 25, name: 'Nadia' });
    expect(onlyRequest().url).toBe(expected);

    // And that builder refuses every scope spelling, while letting a real search
    // criterion through — the negative and the positive of the same rule.
    for (const name of SCOPE_NAMES) {
      expect(() => query({ [name]: 'x' })).toThrow(new RegExp(name));
    }
    expect(query({ name: 'Nadia' })).toBe('?name=Nadia');
  });

  it('propagates the server refusal instead of rendering it as an empty list', async () => {
    /*
     * This is how server-enforced isolation reaches a screen. A record the
     * caller's scope does not cover comes back as a refusal, and the one way the
     * client can get isolation wrong is to turn that refusal into content —
     * "no results" reads to an operator as "there is nothing here", which is a
     * false statement about the tenant's own data.
     */
    for (const [status, expected] of [
      [403, 'denied'],
      [404, 'not-found'],
      [401, 'expired'],
    ] as const) {
      backendAnswering(status, { type: 'urn:rootlco:error:ERR-IAM-001', status });
      const page = await searchCustomerDirectory(TABLE_REQUEST, null, { name: 'Nadia' });
      expect(page.status, `HTTP ${status}`).toBe(expected);
      expect(page.rows, `HTTP ${status}`).toEqual([]);
      expect(page.hasMore).toBe(false);
      vi.unstubAllGlobals();
    }

    // The control: a 200 is NOT reported as a refusal, so the case above is not
    // passing because every outcome maps to one.
    backendAnswering(200, PAGE_FROM_ANOTHER_TENANT);
    const ok = await searchCustomerDirectory(TABLE_REQUEST, null, { name: 'Nadia' });
    expect(ok.status).toBe('ok');
  });

  it('CANNOT refuse a cross-tenant row, because the payload carries no tenant', async () => {
    /*
     * Stated as a limitation, proved as a fact, and deliberately not dressed up
     * as a control.
     *
     * The stub answers with a page whose row belongs to another tenant. The read
     * path returns it, because there is no field on it to compare against
     * `SessionSummary.tenantId` — the row's own tenancy is not on the wire.
     * A real backend does not send this; only a compromised or misconfigured one
     * would, and detecting that is beyond what any client-tier test can do.
     *
     * `apps/web/tests/e2e/authenticated/isolation.spec.ts` is where the real
     * claim lives, and it is gated behind `ROOTLCO_E2E_AUTH=1` and runs in no CI
     * job. QA-003 is therefore NOT closed by this file.
     */
    backendAnswering(200, PAGE_FROM_ANOTHER_TENANT);
    const page = await searchCustomerDirectory(TABLE_REQUEST, null, { name: 'Nadia' });
    expect(page.status).toBe('ok');
    expect(page.rows).toHaveLength(1);
  });

  it('pins the absence that makes the limitation above structural', () => {
    /*
     * A TRIPWIRE, not a preference. If `CustomerSearchHit` ever gains a tenant,
     * company or branch field, this fails — and whoever fixes it is told the
     * thing worth knowing: a client-side isolation comparison has become
     * possible for the first time, and QA-003 could then be narrowed at this
     * tier rather than deferred to a suite nothing runs.
     */
    const contract = readFileSync(
      join(process.cwd(), 'src', 'lib', 'customers', 'directory-contract.ts'),
      'utf8'
    );
    const hit = /interface\s+CustomerSearchHit\s*\{([\s\S]*?)\n\}/.exec(code(contract))?.[1];
    expect(hit, 'CustomerSearchHit was not found — this assertion examined nothing').toBeDefined();

    const fields = [...(hit ?? '').matchAll(/readonly\s+([A-Za-z_$][\w$]*)\s*\??:/g)]
      .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
      .sort();
    // Anti-vacuity: the row type really was read, and it really does have fields.
    expect(fields).toEqual([
      'createdAt',
      'displayName',
      'displayNumber',
      'id',
      'lifecycleStatus',
      'partyType',
    ]);
    for (const name of SCOPE_NAMES) {
      expect(fields, `CustomerSearchHit now carries ${name}`).not.toContain(name);
    }

    // The session, by contrast, knows all three. The asymmetry is the reason the
    // comparison cannot be made: one side has the answer and the other has no
    // question to ask.
    const session = code(
      readFileSync(
        join(process.cwd(), 'src', 'features', 'authentication', 'types', 'session.ts'),
        'utf8'
      )
    );
    expect(session).toContain('tenantId');
    expect(session).toContain('companyIds');
    expect(session).toContain('branchIds');
  });

  it('names the suite that DOES prove isolation, and keeps its debt declared', () => {
    /*
     * The gap is asserted in executable form so it cannot survive only as a
     * sentence in a document. If the spec is deleted, or the gate is removed, or
     * the debt is quietly dropped from the register, this fails and the phase
     * record has to be corrected rather than rot.
     *
     * `tests/ci/e2e-tier-coverage.test.ts` owns the other direction — a declared
     * spec that IS executed also fails, so a declaration cannot hide a runnable
     * tier. This case only holds the pointer from the security obligation to it.
     */
    const spec = readFileSync(
      join(process.cwd(), 'tests', 'e2e', 'authenticated', 'isolation.spec.ts'),
      'utf8'
    );
    expect(spec.length).toBeGreaterThan(0);

    const config = readFileSync(join(process.cwd(), 'playwright.config.ts'), 'utf8');
    expect(config).toContain('ROOTLCO_E2E_AUTH');

    const register = readFileSync(
      join(process.cwd(), '..', '..', '.github', 'ci-baselines', 'unrun-test-tiers.json'),
      'utf8'
    );
    expect(register).toContain('apps/web/tests/e2e/authenticated/isolation.spec.ts');
  });
});
