import { readFileSync, readdirSync, statSync } from 'node:fs';
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
/*
 * The write table, shared with `write-adapters-driven.test.ts`.
 *
 * Imported after `vi.mock` above like every other feature module here — the mock
 * is hoisted, so the adapters this module pulls in resolve the mocked client.
 * Sharing it is the point: two suites that each kept their own list could
 * disagree about which adapters exist, and the one that mattered was the shorter.
 */
const { WRITE_DRIVES, exportedWriteAdapters } = await import('./support/write-drives');

/** A FormData from a plain object, so a write can be driven from a table. */
function formOf(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.append(k, v);
  return data;
}

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

/**
 * Every component this phase ships, across all four trees it owns.
 *
 * Walked rather than listed, because a list is exactly what let six components
 * ship untested while this task reported green.
 */
function componentNames(): readonly string[] {
  const roots = [
    join(process.cwd(), 'src', 'features', 'crm'),
    join(process.cwd(), 'src', 'features', 'vehicles'),
    // The two shared trees P1-27 introduced. `PartyLabel`, `CustomerSelector`
    // and `MatchExplanation` are P1-27 deliverables that live outside the two
    // feature directories only because a feature may not import another feature
    // — leaving them out of the inventory made "every component this phase
    // ships" false by construction.
    join(process.cwd(), 'src', 'components', 'party'),
    join(process.cwd(), 'src', 'components', 'duplicates'),
    /*
     * `RecordForm` is a P1-27 deliverable and was outside this inventory.
     *
     * Its own docblock says why it exists: "React resets an uncontrolled form
     * once a Server Action completes … Every field here is controlled … **This
     * is the same defect `FE-004` hit** and it is the reason this component
     * exists rather than a `<form>` per section." Six customer component writes
     * and five vehicle writes render through it, so a regression in it is a
     * regression in eleven P1-27 surfaces at once.
     *
     * The FILE, not the directory. `Field.tsx` and `MoneyField.tsx` beside it
     * are pre-P1-27 (`4af54ba`), and pulling the whole directory in would demand
     * P1-27 coverage for components another phase shipped. Naming the file makes
     * that a decision rather than an oversight — which is the same reason the
     * two shared trees above are listed individually.
     */
    join(process.cwd(), 'src', 'components', 'forms', 'RecordForm.tsx'),
  ];
  const names = new Set<string>();

  /** Every component name one `.tsx` file exports. */
  const collect = (file: string) => {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/^export function ([A-Z]\w+)/gm)) {
      if (m[1]) names.add(m[1]);
    }
    /*
     * `export const Foo = (…) => …` as well, which the original pattern could
     * not see. A value export such as `MODEL_YEAR_BOUNDS` is NOT a component
     * and is excluded by requiring an arrow within the declaration head —
     * counting it would demand "coverage" for a constant.
     */
    for (const m of source.matchAll(/^export const ([A-Z]\w+)\b/gm)) {
      const head = source
        .slice(m.index ?? 0)
        .split('\n')
        .slice(0, 8)
        .join('\n');
      if (m[1] && head.includes('=>')) names.add(m[1]);
    }
  };

  const walk = (dir: string) => {
    // A root may be a single FILE, so that one component can be named without
    // adopting its neighbours. Without this the entry above would throw ENOTDIR.
    if (!statSync(dir).isDirectory()) {
      collect(dir);
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.tsx')) continue;
      collect(full);
    }
  };
  for (const root of roots) walk(root);
  return [...names].sort();
}

/**
 * Source with comments removed.
 *
 * Mirrors `stripComments` in `scripts/ci/check-p1-27-frontend.mjs`, and carries
 * the same self-test below, because the gate script lives outside this
 * workspace's resolution root. `//` is a comment start only when it is not
 * preceded by `:`, so a `https://` inside a string literal is not truncated.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/**
 * Every test source in this workspace, comments stripped, THIS FILE EXCLUDED.
 *
 * Both exclusions are load-bearing and each was a live hole:
 *
 * - **Comments.** The sweep below asks whether a component name appears in the
 *   test corpus. Every explanatory docblock in these files names the components
 *   it is about, so prose satisfied the check. Six components whose names appear
 *   in this file's own docblock — as the list of things that shipped UNTESTED —
 *   were counted as tested by those very words.
 * - **This file.** It is the meter, not a consumer. A name mentioned here can
 *   never be evidence that the name is exercised somewhere else.
 */
function testSources(): string {
  const dir = join(process.cwd(), 'tests');
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && entry.name !== 'p1-27-qa.test.ts') {
        out.push(stripComments(readFileSync(full, 'utf8')));
      }
    }
  };
  walk(dir);
  return out.join('\n');
}

describe('P1-27-QA-001 — every adapter is reached, and this file proves it', () => {
  it('drives eighteen list adapters, not a sample of them', () => {
    // A count assertion, so deleting a case from the table fails rather than
    // quietly narrowing what the loops below cover.
    expect(LIST_ADAPTERS).toHaveLength(18);
  });

  it('drives every paginated list adapter the feature trees export', () => {
    /*
     * The count above pins the table against deletion; this pins it against
     * OMISSION, which is the failure that actually happened. `LIST_ADAPTERS` is
     * hand-written, so an adapter that was never added is invisible to it —
     * exactly how `listVehicleDocuments` stayed untested while the case above
     * asserted "not a sample of them".
     *
     * Derived from the adapter modules. `listVehicleDocuments` is excluded BY
     * NAME with a reason: it takes no `TableRequest` and returns
     * `DocumentsState`, so it cannot be driven by these loops — it has its own
     * suite in `vehicle-documents.test.ts`, and that exclusion is stated here so
     * it is a decision rather than an oversight.
     */
    /*
     * Each exclusion names the FILE that covers it, and that citation is checked
     * below against the file's own text rather than taken on trust.
     *
     * Three of these cited `vehicle-api.test.ts` for adapters it did not import:
     * `listTrims`, `listBodyTypes` and `listPowertrainTypes` appeared nowhere in
     * it, and their only other appearances in the suite were `vi.fn()` stubs
     * that mock the real adapter away. Three adapters `VehicleCreateScreen`
     * calls had no path, failure-mapping or bound coverage, behind a citation
     * that named a file rather than a behaviour. The citations are true now, and
     * `citationIsReal` is what keeps them true.
     */
    const EXCLUDED = new Map([
      ['listVehicleDocuments', 'vehicle-documents.test.ts'],
      ['listMakes', 'vehicle-api.test.ts'],
      ['listModels', 'vehicle-api.test.ts'],
      ['listTrims', 'vehicle-api.test.ts'],
      ['listBodyTypes', 'vehicle-api.test.ts'],
      ['listPowertrainTypes', 'vehicle-api.test.ts'],
    ]);

    const exported = new Set<string>();
    const roots = [
      join(process.cwd(), 'src', 'features', 'crm'),
      join(process.cwd(), 'src', 'features', 'vehicles'),
    ];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/-api\.ts$|\/api\.ts$|^api\.ts$/.test(entry.name)) continue;
        for (const m of readFileSync(full, 'utf8').matchAll(/^export async function (list\w+)/gm)) {
          if (m[1]) exported.add(m[1]);
        }
      }
    };
    for (const root of roots) walk(root);

    expect(exported.size, 'no list adapters were discovered').toBeGreaterThan(10);

    const driven = new Set(LIST_ADAPTERS.map((a) => a.name));
    const missing = [...exported].filter((n) => !driven.has(n) && !EXCLUDED.has(n));
    expect(
      missing,
      `these list adapters are driven by nothing:\n  ${missing.join('\n  ')}`
    ).toEqual([]);

    // And no exclusion may name an adapter that no longer exists, or the list
    // becomes a place to hide things.
    for (const name of EXCLUDED.keys()) {
      expect(exported.has(name), `${name} is excluded but no longer exported`).toBe(true);
    }

    /*
     * The citation itself is checked. "Still exported" was the ONLY guard, so an
     * exclusion could name any file at all — and three did name a file that
     * never mentioned the adapter.
     *
     * The cited file must IMPORT the name (a `vi.fn()` stub of the same name is
     * not coverage — it replaces the adapter under test), which is why the
     * assertion looks for it inside an import list rather than anywhere in the
     * text, and reads the file with comments stripped so a citation cannot be
     * satisfied by a sentence about it.
     */
    for (const [name, file] of EXCLUDED) {
      const source = stripComments(readFileSync(join(process.cwd(), 'tests', file), 'utf8'));
      const imports = [
        // `const { a, b } = await import('…')` — how these suites load a module
        // they also mock — and the static `import { a } from '…'` form.
        ...source.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*await\s+import\s*\(/g),
        ...source.matchAll(/import\s*\{([^}]*)\}\s*from/g),
      ]
        .flatMap((m) => (m[1] ?? '').split(','))
        .map(
          (entry) =>
            entry
              .trim()
              .split(/\s+as\s+/)[0]
              ?.trim() ?? ''
        );
      expect(imports, `${file} is cited for ${name} but does not import it`).toContain(name);
    }
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

  it('renders every component this phase ships', () => {
    /*
     * DERIVED from the filesystem, not listed here.
     *
     * This case used to assert that fifteen NAMED test files exist. A filename
     * assertion can only fail if a file is renamed — never if a component is
     * untested — so six components delivered under six canonical FE tasks shipped
     * with zero component coverage while `QA-001` reported green:
     * `VehicleCreateScreen`, `VehicleProfileScreen`, `VinField`,
     * `VehicleDocumentsSection`, `DuplicateDecisionPanel` and `EvProfileSection`.
     *
     * The inventory is now the components themselves, so a new one is covered by
     * this rule the moment it is written rather than the moment somebody
     * remembers to add its filename.
     */
    const components = componentNames();
    expect(components.length, 'no components were discovered — the walk is broken').toBeGreaterThan(
      15
    );

    /*
     * Whole-word, against comment-stripped test sources with this file removed.
     *
     * `suite.includes(name)` was a substring match over raw text, so a mention in
     * a docblock — including the docblock in THIS file listing the six untested
     * components — satisfied it. Three components (`VehicleProfileScreen`,
     * `VinField`, `DuplicateDecisionPanel`) appeared in the entire corpus only
     * inside `*` comment lines while this case reported green. They each have a
     * direct suite now, and the mechanism can no longer be satisfied by prose.
     */
    const suite = testSources();
    const unreferenced = components.filter((name) => !new RegExp(`\\b${name}\\b`).test(suite));
    expect(
      unreferenced,
      `these components are rendered by no test:\n  ${unreferenced.join('\n  ')}`
    ).toEqual([]);
  });

  it('cannot be satisfied by a component named only in prose', () => {
    // The positive control for the case above. If the stripper ever stopped
    // removing comments, this fails rather than the sweep silently widening.
    const sample = [
      '/** RenderedNowhereScreen is deliberately named in this docblock. */',
      "// AlsoNowhereScreen in a line comment, and a URL that must survive: 'https://example.test/keep'",
      "const path = '/merge';",
    ].join('\n');
    const stripped = stripComments(sample);
    expect(stripped).not.toContain('RenderedNowhereScreen');
    expect(stripped).not.toContain('AlsoNowhereScreen');
    expect(stripped).toContain("'/merge'");
  });

  it('excludes itself from the corpus it measures', () => {
    // A meter that counts its own prose measures nothing. `componentNames()` is
    // defined in this file and named nowhere else, so it must not appear.
    expect(testSources()).not.toContain('componentNames');
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

/**
 * Every feature source, comment-stripped, paired with its repository path.
 *
 * Comments are removed for the reason the component sweep above removes them,
 * and it is the same reason for the sixth time in this repository: the docblocks
 * in these files QUOTE the construct the rule forbids, in order to explain why
 * it is forbidden. A raw-text scan reads that prose as code and reports the very
 * files the fix corrected.
 */
function featureSources(): readonly { readonly path: string; readonly source: string }[] {
  const root = join(process.cwd(), 'src', 'features');
  const out: { path: string; source: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      out.push({
        path: full.slice(process.cwd().length + 1).replace(/\\/g, '/'),
        source: stripComments(readFileSync(full, 'utf8')),
      });
    }
  };
  walk(root);
  return out;
}

/**
 * The platform date and time formatters, with whatever they were handed as a
 * locale. `new` is optional on `Intl.DateTimeFormat`, and the `toLocale*`
 * methods take the locale in the same first position, so one pattern covers all
 * five spellings.
 */
const LOCALE_FORMATTERS =
  /(?:(?:new\s+)?Intl\.DateTimeFormat|\.toLocale(?:Date|Time)?String)\s*\(\s*([^,)]*)/g;

/** The only locale expression that is a real BCP-47 tag in this application. */
function goesThroughIntlLocale(argument: string): boolean {
  return argument.trim().startsWith('intlLocale(');
}

function bareLocaleFormatters(source: string): readonly string[] {
  const found: string[] = [];
  for (const match of source.matchAll(LOCALE_FORMATTERS)) {
    if (!goesThroughIntlLocale(match[1] ?? '')) found.push(match[0].trim());
  }
  return found;
}

/**
 * A `Locale` is not a locale tag (`P1-27-FE-030`).
 *
 * ## The defect
 *
 * `Locale` is `'en' | 'ar'` — the two segments this application puts in a URL.
 * They are not the tags it FORMATS in: `intlLocale` maps `en` to `en-GB` and
 * `ar` to `ar-JO-u-nu-latn`, the second because Jordanian workshop paperwork is
 * written in Latin digits. Both are deliberate and both are documented in
 * `src/lib/format.ts`. Seven call sites across five components passed the bare
 * union member straight to `Intl.DateTimeFormat`, so they silently asked for
 * whatever CLDR considers plain `en`, which is US convention. Measured on this
 * tree for `2026-03-04T09:14:00Z` in Asia/Amman:
 *
 *     'en'    -> Mar 4, 2026, 12:14 PM   <- what those seven sites printed
 *     'en-GB' ->   4 Mar 2026, 12:14     <- what the rest of the product prints
 *
 * So an English operator read month-day order and a 12-hour clock in the CRM
 * timeline and the vehicle history, and day-month order and a 24-hour clock in
 * the audit log and the users list. Two conventions, one screen apart, for the
 * same instant.
 *
 * The Arabic half does NOT reproduce: bare `'ar'` already resolves to Latin
 * digits, so `ar` and `ar-JO-u-nu-latn` agree here. That is luck, not design —
 * it is exactly the kind of agreement a CLDR update withdraws — and the rule
 * below is written against the construct rather than against the one output it
 * happened to change.
 *
 * ## Why a source rule and not seven rendered assertions
 *
 * A rendered assertion proves the seven sites that exist. The eighth is written
 * next week by copying the sixth, and the divergence returns in a component no
 * test has been taught to look at. The construct is what is wrong, so the
 * construct is what is banned; `intlLocale(locale)` stays allowed so a genuinely
 * different set of options is still expressible without leaving the product's
 * locale mapping behind.
 */
describe('P1-27-FE-030 — no feature file hands a bare Locale to a formatter', () => {
  it('scanned a real corpus, so the sweep below is not vacuous', () => {
    const files = featureSources();
    expect(files.length, 'the feature walk found nothing — the scan is broken').toBeGreaterThan(30);
    expect(
      files.filter((f) => f.path.endsWith('.tsx')).length,
      'no component files were scanned'
    ).toBeGreaterThan(10);
    // The corpus really contains the text this rule is about. Without this, a
    // walk that silently returned empty strings would pass the sweep.
    expect(
      files.some((f) => f.source.includes('formatDateTime(')),
      'no feature file formats a date at all — the corpus is not the one under test'
    ).toBe(true);
  });

  it('fires on the construct it forbids, and spares the one it allows', () => {
    // The positive control. If this stopped detecting, the sweep would report
    // green over any amount of the defect.
    expect(
      bareLocaleFormatters("new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })")
    ).toHaveLength(1);
    expect(bareLocaleFormatters('Intl.DateTimeFormat(locale).format(d)')).toHaveLength(1);
    expect(bareLocaleFormatters('d.toLocaleDateString(locale)')).toHaveLength(1);
    expect(bareLocaleFormatters('d.toLocaleTimeString(locale)')).toHaveLength(1);
    expect(bareLocaleFormatters('d.toLocaleString(locale)')).toHaveLength(1);
    // No locale at all is the same defect wearing a different hat: it formats
    // in whatever the host default happens to be.
    expect(bareLocaleFormatters('d.toLocaleString()')).toHaveLength(1);
    // The permitted form.
    expect(
      bareLocaleFormatters("new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium' })")
    ).toEqual([]);
  });

  it('cannot be satisfied — or triggered — by prose', () => {
    // Both directions matter. The docblocks in `format.ts` and in the corrected
    // components quote `Intl.DateTimeFormat(locale, ...)` to explain the ban, so
    // a scanner that reads comments reports the fixed files as broken.
    const sample = [
      '/** Never write new Intl.DateTimeFormat(locale, {}) — use the helper. */',
      '// d.toLocaleDateString(locale) is wrong for the same reason',
      "const keep = 'https://example.test/x';",
    ].join('\n');
    expect(bareLocaleFormatters(stripComments(sample))).toEqual([]);
    expect(stripComments(sample)).toContain("'https://example.test/x'");
  });

  it('finds no bare-Locale formatter anywhere under src/features', () => {
    const offenders = featureSources()
      .map((file) => ({ file, hits: bareLocaleFormatters(file.source) }))
      .filter((entry) => entry.hits.length > 0);
    expect(
      offenders.map((entry) => `${entry.file.path}: ${entry.hits.join(' | ')}`),
      'these format an instant outside the product locale mapping'
    ).toEqual([]);
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
      // The positive control. `?? ''` made "no request at all" pass as "no
      // scope" — an adapter that silently stopped calling the client would have
      // satisfied this loop perfectly. Assert the call happened FIRST, then
      // assert what it contained.
      expect(get, `${adapter.name} issued no request`).toHaveBeenCalledTimes(1);
      // The whole call, not argument zero: a scope smuggled into the options
      // object would never appear in the path.
      const call = JSON.stringify(get.mock.calls[0]);
      expect(call, adapter.name).not.toMatch(/tenant|company|branch/i);
    }
  });

  it('sends no scope in any write BODY either', async () => {
    /*
     * The reads were swept; the writes were not, and a scope asserted in a JSON
     * body is exactly as wrong as one in a query string. `send` was already
     * mocked in this file and never asserted on.
     *
     * ## This used to drive three of twenty-three, and said so
     *
     * A stated sample is honest, and it was still a hole: nine of the twenty
     * adapters outside the sample were driven by NOTHING anywhere in the suite,
     * so the only runtime evidence about their bodies was this loop, and it did
     * not look at them. The table now comes from `tests/support/write-drives.ts`
     * and covers every adapter both trees export — the same table
     * `write-adapters-driven.test.ts` executes, so the two suites cannot come to
     * disagree about what the set is.
     *
     * The static rule remains the guarantee for code no test drives:
     * `check-p1-27-frontend.mjs` scans both trees for `tenantId` / `companyId` /
     * `branchId` with `allow: []`. This runtime sweep proves the assembled
     * bodies, which is what a text scan cannot see.
     */
    for (const write of WRITE_DRIVES) {
      send.mockReset();
      send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });
      await write.call();
      // The positive control. A `?? ''` here would let "no request at all" pass
      // as "no scope", and an adapter that stopped calling the client would
      // satisfy the sweep perfectly.
      expect(send, `${write.name} issued no request`).toHaveBeenCalledTimes(1);
      const call = JSON.stringify(send.mock.calls[0]);
      expect(call, write.name).not.toMatch(/tenant|company|branch/i);
    }
  });

  it('refuses a plausible odometer timestamp locally rather than spending a request on it', async () => {
    /*
     * `P1-27-FE-023`. The edge validated `observedAt` by LENGTH only — 16 to 40
     * characters — mirroring the route's Zod (`odometer-readings/route.ts:39`)
     * rather than the rule that actually decides, which is the strict ISO-8601
     * pattern in the domain (`vehicle-odometer.ts:46`).
     *
     * `2026-03-01 09:30` is exactly 16 characters, is what an operator will
     * plausibly type, and is refused by the server. Before this, it passed the
     * edge, spent one of thirty requests per minute, and came back rejected —
     * and came back marking NO field, because the client parses `errors` while
     * the platform publishes `violations` (`P1-27-INT-028`, foundation-owned).
     *
     * So the operator saw a generic failure on a form that looked correct. The
     * value of catching it locally is precisely that local field errors work.
     *
     * `toHaveBeenCalledTimes(0)` is the load-bearing half: a version that
     * rejected the value AFTER issuing the request would satisfy an
     * error-message assertion and still burn the rate-limit slot.
     */
    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });

    const rejected = await vehHistory.recordOdometerAction(
      'v1',
      { status: 'idle' } as never,
      formOf({ value: '123456', unit: 'km', observedAt: '2026-03-01 09:30' })
    );

    expect(send, 'the edge sent a request it could have refused itself').toHaveBeenCalledTimes(0);
    expect(JSON.stringify(rejected)).toContain('observedAt');

    // The control: the same shape with a real ISO-8601 timestamp DOES go out.
    // Without this the case above would pass against an edge that rejected
    // everything.
    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });
    await vehHistory.recordOdometerAction(
      'v1',
      { status: 'idle' } as never,
      formOf({ value: '123456', unit: 'km', observedAt: '2026-03-01T09:30:00Z' })
    );
    expect(send, 'a valid timestamp was refused too').toHaveBeenCalledTimes(1);
  });

  it('refuses a well-shaped timestamp that is not a real instant', async () => {
    /*
     * `F3` — `FE-023` copied half of the rule that decides.
     *
     * The domain's `normalizeObservedAt` (`vehicle-odometer.ts:93`) is
     * `ISO_DATETIME.test(trimmed) && !Number.isNaN(Date.parse(trimmed))`. Only
     * the regex reached the edge, so a value that MATCHES the shape but names no
     * instant passed the client, spent one of the thirty requests a minute, and
     * came back refused with no field marked — the exact failure `FE-023` exists
     * to prevent, surviving inside its own fix.
     *
     * A day/month swap is the way an operator meets this: `2026-13-05` is what
     * "5 December" becomes when the two fields are entered the other way round.
     * It matches the regex exactly and names no instant.
     */
    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });

    const rejected = await vehHistory.recordOdometerAction(
      'v1',
      { status: 'idle' } as never,
      formOf({ value: '123456', unit: 'km', observedAt: '2026-13-05T09:30:00Z' })
    );

    expect(
      send,
      'a month of 13 reached the platform; the edge only checked the shape'
    ).toHaveBeenCalledTimes(0);
    expect(JSON.stringify(rejected)).toContain('observedAt');
  });

  it('does NOT refuse a rolled-over date the platform accepts', async () => {
    /*
     * The bound in the other direction, and it corrected this file's own first
     * draft. `2026-02-30` was asserted as refused on the assumption that a
     * thirty-day February is impossible. It is not, to JavaScript: `Date.parse`
     * ROLLS IT OVER to 2 March and returns a number.
     *
     * The domain rule is `!Number.isNaN(Date.parse(trimmed))`, so the platform
     * accepts it and stores 2 March. Refusing it here would make the client
     * stricter than the server — a client bound that rejects a value the server
     * would have stored, which `RecordForm`'s `FieldSpec` docblock names as the
     * thing these edges must never do.
     *
     * Recorded rather than fixed: mirroring the platform means mirroring this
     * too. An operator who types 30 February gets a reading dated 2 March, and
     * that is a foundation-owned question about `normalizeObservedAt`, not one
     * this screen may answer differently from the write it calls.
     */
    expect(Number.isNaN(Date.parse('2026-02-30T09:30:00Z'))).toBe(false);

    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });
    await vehHistory.recordOdometerAction(
      'v1',
      { status: 'idle' } as never,
      formOf({ value: '123456', unit: 'km', observedAt: '2026-02-30T09:30:00Z' })
    );
    expect(
      send,
      'the edge refused a value the platform stores — it is now stricter than the server'
    ).toHaveBeenCalledTimes(1);
  });

  /**
   * The correction body (`P1-27-FE-023`).
   *
   * An odometer reading recorded too high could never be brought back down from
   * the product. `guard_odometer_reading` refuses a NORMAL reading below the
   * current effective value — correctly; that refusal is the anomaly detection —
   * and the disposition is a CORRECTION: the same operation,
   * `veh.vehicle-odometer-record`, with two more body fields. The form offered
   * neither, so the platform accepted a correction the interface could not
   * express.
   *
   * These cases are about the BODY, which is the half a DOM suite cannot see:
   * mutating an adapter left twenty DOM tests green in Wave 5.
   */
  const ODO_BASE = { value: '118000', unit: 'km', observedAt: '2026-03-04T09:30:00Z' };
  const PRIOR = 'f1a2b3c4-0000-4000-8000-000000000001';

  /** The body of the single request the adapter issued. */
  function sentBody(): Record<string, unknown> {
    expect(send, 'the adapter issued no request').toHaveBeenCalledTimes(1);
    const [method, path, body] = send.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(method).toBe('POST');
    expect(path).toContain('/odometer-readings');
    return body;
  }

  it('sends NEITHER correction field for an ordinary reading', async () => {
    /*
     * Omitted, not blanked. `ck_odometer_readings_correction_meta` requires a
     * non-correction to carry `correction_reason IS NULL` and
     * `anomaly_flag = false`, and the domain refuses a reason with no reference
     * outright (`vehicle-odometer.ts:141-146`) — so a form that helpfully sent
     * empty strings would turn every ordinary reading into a 422.
     *
     * `toEqual` rather than a pair of `not.toHaveProperty` checks: an exact body
     * also fails if a THIRD field is smuggled in later.
     */
    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });

    await vehHistory.recordOdometerAction('v1', { status: 'idle' } as never, formOf(ODO_BASE));

    expect(sentBody()).toEqual({
      value: 118000,
      unit: 'km',
      observedAt: '2026-03-04T09:30:00Z',
    });
  });

  it('sends BOTH correction fields when a prior reading and a reason are chosen', async () => {
    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });

    await vehHistory.recordOdometerAction(
      'v1',
      { status: 'idle' } as never,
      formOf({ ...ODO_BASE, correctionOf: PRIOR, correctionReason: 'data_entry_correction' })
    );

    const body = sentBody();
    // The two values, by name. This is the assertion the capability exists for:
    // before it, no request the product could issue carried either field.
    expect(body.correctionOf).toBe(PRIOR);
    expect(body.correctionReason).toBe('data_entry_correction');
    // And nothing the caller must NOT claim. `captureMethod: 'correction'` and
    // the anomaly flag are set server-side (`vehicle-odometer.ts:130-138`); a
    // client that sent either would be asserting the platform's own conclusion.
    expect(body).not.toHaveProperty('anomalyFlag');
    expect(body.captureMethod).toBeUndefined();
  });

  it('refuses a reference with no reason, exactly as the server would, without sending', async () => {
    /*
     * `toOdometerReadingPlan` decides `isCorrection` from `correctionOf` alone
     * and then requires the reason — `body.correctionReason` / `required`. The
     * mirror is local because the alternative is a 422 the operator waited for,
     * on an operation limited to thirty calls a minute.
     *
     * `toHaveBeenCalledTimes(0)` is the load-bearing half: refusing AFTER the
     * request satisfies the message assertion and still burns the slot.
     */
    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });

    const rejected = await vehHistory.recordOdometerAction(
      'v1',
      { status: 'idle' } as never,
      formOf({ ...ODO_BASE, correctionOf: PRIOR })
    );

    expect(send, 'a correction with no reason reached the platform').toHaveBeenCalledTimes(0);
    expect(rejected.fieldErrors?.correctionReason).toBe('vehicles.odometer.error.reasonRequired');
  });

  it('refuses a reason with no reference, against the field the server names', async () => {
    // The other direction. `vehicle-odometer.ts:141-146` throws `unexpected` on
    // `body.correctionReason`, so the error lands on the control the operator can
    // actually clear.
    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });

    const rejected = await vehHistory.recordOdometerAction(
      'v1',
      { status: 'idle' } as never,
      formOf({ ...ODO_BASE, correctionReason: 'possible_rollover' })
    );

    expect(send, 'a lone reason reached the platform').toHaveBeenCalledTimes(0);
    expect(rejected.fieldErrors?.correctionReason).toBe(
      'vehicles.odometer.error.reasonWithoutReading'
    );
  });

  it('refuses a reason outside the approved vocabulary', async () => {
    // `unknown_reason` is what the domain answers. The select cannot produce
    // one, so this is about the adapter being the authority rather than the
    // control — a hand-built request is the only way in, and it stops here.
    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });

    const rejected = await vehHistory.recordOdometerAction(
      'v1',
      { status: 'idle' } as never,
      formOf({ ...ODO_BASE, correctionOf: PRIOR, correctionReason: 'because_i_said_so' })
    );

    expect(send).toHaveBeenCalledTimes(0);
    expect(rejected.status).toBe('invalid');
    expect(rejected.fieldErrors?.correctionReason).toBeTruthy();
  });

  it('does NOT add a bound the server does not have: a lower value still goes out', async () => {
    /*
     * The direction that keeps this a mirror rather than a tightening.
     *
     * Whether a value is below the current effective odometer is decided by the
     * database, against rows this process cannot see. A client that guessed
     * would refuse readings the server would have stored — the exact thing
     * `FieldSpec`'s docblock forbids — so a correction carrying a LOWER value is
     * sent, and `below_current_odometer` is catalogued for the refusal that is
     * the server's to make.
     */
    send.mockReset();
    send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });

    await vehHistory.recordOdometerAction(
      'v1',
      { status: 'idle' } as never,
      formOf({ ...ODO_BASE, value: '1', correctionOf: PRIOR, correctionReason: 'lower_than_prior' })
    );

    expect(sentBody().value, 'the edge invented a floor the server does not have').toBe(1);
  });

  it('the write sweep is exhaustive, and fails closed when an adapter is added', () => {
    /*
     * The number of write adapters the sweep above DRIVES, against the number
     * the two trees export. This was `DRIVEN = 3` asserted `toBeLessThan` the
     * exported count — a statement that the sample is a sample, which can never
     * fail however far the two numbers drift apart.
     *
     * It is an EQUALITY now, per name and not per count. A twenty-fourth adapter
     * added without a drive fails here, and a drive naming an adapter that no
     * longer exists fails too, so the table cannot become a place to park a name.
     * A count alone could not do this: adding one adapter while driving another
     * would balance.
     */
    const DRIVEN = WRITE_DRIVES.map((drive) => drive.name).sort();
    const exported = exportedWriteAdapters();

    expect(exported.length, 'no write adapters were discovered — the walk is broken').toBe(23);
    expect(DRIVEN).toEqual([...exported]);

    // And the static rule that covers code no test drives at all, read from the
    // gate rather than asserted: `no-client-asserted-scope` must scan both trees
    // with no allowance, or the sentence above about CI is false.
    const gate = readFileSync(
      join(process.cwd(), '..', '..', 'scripts', 'ci', 'check-p1-27-frontend.mjs'),
      'utf8'
    );
    const rule = /id:\s*'no-client-asserted-scope'[\s\S]*?allow:\s*(\[[^\]]*\])/.exec(gate);
    expect(rule?.[1], 'the scope rule carries an allowance').toBe('[]');
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

/**
 * `P1-27-SEC-004` — the audit half, asserted against the calls the app MAKES.
 *
 * ## Why this lives beside the adapters rather than beside the contract
 *
 * `operation-contract.test.ts` asserts that the published table classifies every
 * P1-27 write `privileged` and every P1-27 read `none`. That is a fact about the
 * contract, and it would hold in full while this application called an operation
 * the contract does not publish at all — in which case the client's fail-safe
 * sends an idempotency key, the request works, and nothing anywhere knows which
 * audit class the operation it just invoked declares.
 *
 * So the set here is not written down. It is whatever the shipped adapters
 * actually ask the client for, captured from the mock: `WRITE_DRIVES` is every
 * write adapter both feature trees export, and `LIST_ADAPTERS` is every
 * paginated read, each already proven exhaustive by `QA-001`. Every path they
 * produce must resolve to a published operation, and that operation must carry
 * the class the contract publishes for it.
 *
 * Before the generator carried `x-audit-class`, none of this could be written:
 * `PublishedOperation` had no audit field, so the only place the word
 * `auditClass` appeared in this workspace was inside docblocks.
 */
describe('P1-27-SEC-004 — every operation this app calls declares an audit class', () => {
  it('classifies every write the shipped write adapters actually issue', async () => {
    const seen: string[] = [];
    for (const write of WRITE_DRIVES) {
      send.mockReset();
      send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });
      await write.call();
      // The positive control, same as the scope sweep above: an adapter that
      // issued no request would otherwise satisfy every expectation below by
      // never producing a path to check.
      expect(send, `${write.name} issued no request`).toHaveBeenCalledTimes(1);

      const method = String(send.mock.calls[0]?.[0] ?? '');
      const path = String(send.mock.calls[0]?.[1] ?? '');
      const operation = resolveOperation(method, path);
      expect(
        operation,
        `${write.name} calls ${method} ${path}, which the contract does not publish`
      ).not.toBeNull();
      // A write with no audit event is a mutation nobody can attribute after the
      // fact. `''` would mean the document published no class at all.
      expect(operation?.auditClass, `${write.name} → ${operation?.operationId}`).toBe('privileged');
      seen.push(`${write.name} ${operation?.operationId}`);
    }
    // Non-vacuity for the loop itself. `WRITE_DRIVES` is imported, so a version
    // of it that had become empty would make the whole case pass silently.
    expect(seen.length, 'no write adapters were driven').toBeGreaterThanOrEqual(20);
  });

  it('classifies every read the shipped list adapters actually issue as none', async () => {
    const seen: string[] = [];
    for (const adapter of LIST_ADAPTERS) {
      get.mockReset();
      get.mockResolvedValue({
        ok: true,
        data: { items: [], nextCursor: null, hasMore: false },
        correlationId: 'corr-1',
      });
      await adapter.call();
      expect(get, `${adapter.name} issued no request`).toHaveBeenCalledTimes(1);

      const path = String(get.mock.calls[0]?.[0] ?? '');
      const operation = resolveOperation('GET', path);
      expect(
        operation,
        `${adapter.name} calls GET ${path}, which the contract does not publish`
      ).not.toBeNull();
      /*
       * `none` is the assertion, not merely "some class". A read that started
       * writing a `privileged` audit event would mean every page view of a
       * customer profile produced a permanent attributed record — a change in
       * what the product retains about its operators, arriving silently through
       * a backend registration nobody in this tier reviewed.
       */
      expect(operation?.auditClass, `${adapter.name} → ${operation?.operationId}`).toBe('none');
      seen.push(`${adapter.name} ${operation?.operationId}`);
    }
    expect(seen.length, 'no list adapters were driven').toBeGreaterThanOrEqual(18);
  });

  it('resolves nothing for a path the contract does not publish — the guard is real', () => {
    /*
     * The control for the `not.toBeNull()` guard in both loops above.
     *
     * That guard is the half that catches "the app calls something the contract
     * never published", where there is no audit class to check because there is
     * no operation. A resolver that answered with SOME row for every path would
     * make it unfailable, and the loops would then be asserting the class of
     * whatever happened to sort first.
     *
     * Deliberately not a restatement of the class rule: asserting that `''` is
     * not `'privileged'` would be a tautology dressed as a control, and the
     * evidence that the class rule can fail is the recorded mutation, not a test
     * that arranges its own failure.
     */
    expect(resolveOperation('POST', '/api/v1/vehicles/v1/invented-sub-resource')).toBeNull();
    expect(resolveOperation('GET', '/api/v1/not/a/real/operation')).toBeNull();
    // And the positive half, so the two lines above cannot pass by the resolver
    // having stopped resolving anything at all.
    expect(resolveOperation('POST', '/api/v1/vehicles')?.operationId).toBe('veh.vehicle-create');
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
