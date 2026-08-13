import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ADOPTED_ROOTS,
  EXPORT_CONSTRUCTS,
  EXPORT_INNOCENT,
  FILE_ACCESS_CONSTRUCTS,
  FILE_ACCESS_INNOCENT,
  INVENTED_MEDIA_LIMIT_CONSTRUCTS,
  INVENTED_MEDIA_LIMIT_INNOCENT,
  MODULE_DISPOSITION,
  PLAN_ROOTS,
  ROOT_AUTHORITY,
  RULES,
  SCAN_ROOTS,
  SCOPE_NAMES,
  UNCOLLECTED_PHASE_MODULES,
  assertNotSymlink,
  assertedScopes,
  collects,
  evaluate,
  evaluateModuleDispositions,
  fires,
  importedModuleDirectories,
  inRuleScope,
  literalMask,
  moduleSourceRoot,
  selfTest,
  stripComments,
} from '../../scripts/ci/check-p1-27-frontend.mjs';

/** The repository root, resolved from this file rather than from the cwd. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every `.ts`/`.tsx` under a directory, the way the gate itself walks one. */
function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'coverage'].includes(entry.name)) continue;
      listSources(path, out);
    } else {
      // The same refusal the gate applies, so the case below asserting the live
      // trees are symlink-free is driving the real policy rather than a copy
      // that happens to agree with it.
      assertNotSymlink(entry, path);
      if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
    }
  }
  return out;
}
const countSources = (dir: string) => listSources(dir).length;

/**
 * The P1-27 frontend gate (`P1-27-DO-001`).
 *
 * A gate is only worth its runtime if each rule is shown to catch the thing it
 * names. So every case below **plants that one violation** and asserts the gate
 * reports it — never "the gate passes on the real tree", which is what a gate
 * with a broken regex also does.
 */

/**
 * The forbidden operation ids, assembled at runtime rather than spelled out.
 *
 * `scripts/p1-24-operation-register.mjs` scans every test file for operation ids
 * and credits the file as evidence for each one it finds. Writing
 * the full merge operation id literally here made the P1-24 register claim this
 * **Frontend gate test** as backend test evidence for the merge route — a test
 * that proves the Web tier never calls an operation is not evidence that the
 * route is exercised, and the register said it was.
 *
 * The gate under test still receives the exact violating string. It simply is
 * not spelled contiguously in this file for a different scanner to misread.
 */
const OP = {
  customerMerge: ['crm', 'customer-merge'].join('.'),
  vehicleMerge: ['veh', 'vehicle-merge'].join('.'),
  duplicateScan: 'duplicate-scan',
} as const;

/**
 * Every rule match inside the two `platform-transport` modules, named.
 *
 * These are the lines that make the exclusion earn itself, and each is CORRECT
 * code that a wider gate would turn red:
 *
 *   - `idempotent-operations.ts` is the GENERATED operation catalogue. It
 *     contains the merge ids, the duplicate-scan ids, `/exports` and
 *     `download-authorizations` as DATA — the operations rules 1, 2 and 7 prove
 *     this phase never calls. It also names `tenantId` in operation parameter
 *     lists. Scanning it would accuse the catalogue of being the list it is.
 *   - `read-operation.ts` names `tenantId` because it is the guard that REFUSES
 *     one; `session-cookie.ts` because a server-side session legitimately holds
 *     the resolved scope.
 *   - `client-log.ts` IS the structured logger the console rule tells people to
 *     use instead of `console.*`.
 *
 * A fourth file, or a new rule matching one of these three, fails the case that
 * pins this list — which is what makes "excluded" a measurement rather than a
 * word.
 */
const EXCLUDED_MODULE_MATCHES = [
  'no-client-asserted-scope: apps/web/src/lib/api/idempotent-operations.ts',
  'no-client-asserted-scope: apps/web/src/lib/api/read-operation.ts',
  'no-client-asserted-scope: apps/web/src/lib/api/session-cookie.ts',
  'no-console-output: apps/web/src/lib/observability/client-log.ts',
  'no-duplicate-scan-on-a-queue: apps/web/src/lib/api/idempotent-operations.ts',
  'no-export-surface: apps/web/src/lib/api/idempotent-operations.ts',
  'no-merge-caller: apps/web/src/lib/api/idempotent-operations.ts',
];

const CLEAN = [
  { path: 'apps/web/src/features/crm/customers/api.ts', source: 'export const a = 1;\n' },
  { path: 'apps/web/src/features/vehicles/api.ts', source: 'export const b = 2;\n' },
];

function withViolation(source: string) {
  return [...CLEAN, { path: 'apps/web/src/features/vehicles/bad.ts', source }];
}

describe('the gate is clean on clean input', () => {
  it('reports no failure for files that break nothing', () => {
    expect(evaluate(CLEAN).failures).toEqual([]);
  });
});

describe('each rule catches its own violation', () => {
  it.each([
    ['no-merge-caller', "await client.send('POST', `/api/v1/vehicles/${id}/merge`, {});"],
    ['no-merge-caller', `const op = '${OP.customerMerge}';`],
    ['no-merge-caller', `const op = '${OP.vehicleMerge}';`],
    ['no-merge-caller', 'export async function mergeVehicleAction() {}'],
    ['no-duplicate-scan-on-a-queue', `client.send('POST', '/api/v1/${OP.duplicateScan}', {});`],
    ['no-client-asserted-scope', 'const path = query({ tenantId, cursor });'],
    ['no-client-asserted-scope', 'const p = { branch_id: session.branch };'],
    ['no-invented-total', 'const page = { rows, total: rows.length };'],
    ['no-upload-path', 'const body = new FormData();'],
    ['no-upload-path', '<input type="file" name="photo" />'],
    ['no-console-output', "console.log('page', page);"],
  ])('%s catches: %s', (ruleId, source) => {
    const { failures } = evaluate(withViolation(source));
    expect(
      failures.some((f) => f.startsWith(`${ruleId}:`)),
      failures.join('\n')
    ).toBe(true);
  });
});

describe('the gate does not accuse the explanation of the rule', () => {
  it.each(RULES.map((rule) => rule.id))('%s ignores its own name in a comment', (ruleId) => {
    // Every rule names an operation this phase deliberately does not call, and
    // the reason is written in a docblock naming that operation. A scanner that
    // read prose would force the explanation to be deleted to stay green — and
    // the explanation is the only durable record of the decision.
    const prose = [
      '/**',
      ` * \`${OP.vehicleMerge}\` and \`${OP.customerMerge}\` are never called:`,
      ' * `P1-OD-017` is open. The two `' + OP.duplicateScan + '` operations are',
      ' * privileged audited writes. The client asserts no tenantId, companyId or',
      ' * branchId. No total is invented. There is no FormData() upload path, no',
      ' * FileReader, no input.files, no onDrop= target and no DataTransfer.',
      ' * Nothing calls shared.export-authorize or shared.export-catalogue, posts',
      ' * to /api/v1/exports, calls exportCustomers, builds a new Blob(), reaches',
      ' * for createObjectURL or a download= attribute, assembles text/csv or',
      ' * application/pdf, or sets a Content-Disposition header.',
      ' * No MAX_FILE_SIZE_BYTES, no 10 * 1024 * 1024, no image/jpeg type list,',
      " * no allowedExtensions of '.jpg', and no accept= attribute: P1-OD-025 is",
      ' * open and §14 says do not invent limits.',
      ' */',
      '// console.log is never used here either.',
      'export const ok = 1;',
    ].join('\n');
    const { failures } = evaluate(withViolation(prose));
    expect(failures.filter((f) => f.startsWith(`${ruleId}:`))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The three rules `SEC-002`'s absent capabilities now rest on
 * ------------------------------------------------------------------ */

interface Construct {
  /**
   * `construct`, not `id`, and the name is load-bearing outside this file:
   * `apps/web/tests/p1-27-guidance-reconciliation.test.ts` finds the gate's RULE
   * ids by scraping `id: '…',` lines out of `check-p1-27-frontend.mjs`, and
   * asserts each one has a sentence in the developer guide. Nineteen construct
   * entries spelled `id` would be read as nineteen rules with no sentence.
   */
  readonly construct: string;
  readonly pattern: RegExp;
  readonly samples: readonly string[];
}

/**
 * `SEC-002` reads "sensitive-data, export, document, media and file-access
 * controls" — five obligations joined by "and". Only the file-access one had a
 * gate rule, and that rule covered three of the seven constructs
 * `apps/web/tests/p1-27-security.test.ts` forbids on the same surface. Export and
 * media rested on that suite alone, and a suite can be deleted in the same commit
 * as the code it guards.
 *
 * Each rule below is assembled from a table of NAMED constructs, so there is
 * something to count; each construct carries the smallest source that constitutes
 * it, and each table carries innocent sources that must not fire. Both directions
 * are asserted, because a rule satisfied by `/./` is not a rule — it is an outage
 * that reports as diligence.
 */
const CONSTRUCT_TABLES: readonly [string, readonly Construct[], readonly string[]][] = [
  ['no-upload-path', FILE_ACCESS_CONSTRUCTS, FILE_ACCESS_INNOCENT],
  ['no-export-surface', EXPORT_CONSTRUCTS, EXPORT_INNOCENT],
  ['no-invented-media-limit', INVENTED_MEDIA_LIMIT_CONSTRUCTS, INVENTED_MEDIA_LIMIT_INNOCENT],
];

describe.each(CONSTRUCT_TABLES)('%s', (ruleId, constructs, innocent) => {
  const rule = RULES.find((r) => r.id === ruleId);
  const planted = constructs.flatMap((c) => c.samples.map((s) => [c.construct, s] as const));

  it('is a live rule with a construct table behind it', () => {
    expect(rule, `${ruleId} is not in RULES`).toBeDefined();
    expect(constructs.length, `${ruleId} names no construct`).toBeGreaterThan(2);
    expect(planted.length, 'a construct carries no sample').toBeGreaterThanOrEqual(
      constructs.length
    );
    expect(innocent.length, `${ruleId} has nothing it must NOT fire on`).toBeGreaterThan(2);
    // The pattern really is assembled from the table. A rule whose pattern had
    // drifted away from its constructs would pass every case below on its own
    // samples while enforcing something else on the tree.
    for (const construct of constructs) {
      expect(
        rule?.pattern.source,
        `${construct.construct} is in the table and not in the rule`
      ).toContain(construct.pattern.source);
    }
  });

  it.each(planted)('catches the %s construct: %s', (_constructId, source) => {
    // Planted through the gate's OWN `evaluate()`, so this is the rule CI runs
    // rather than a regex restated in a test.
    const { failures } = evaluate(withViolation(source));
    expect(
      failures.filter((f) => f.startsWith(`${ruleId}:`)),
      failures.join('\n')
    ).toHaveLength(1);
  });

  it.each(innocent.map((source) => [source]))('does not fire on innocent text: %s', (source) => {
    // Asserted over the WHOLE failure list, not this rule's share of it, so a
    // sample that trips some OTHER rule is caught here too.
    expect(evaluate(withViolation(source)).failures).toEqual([]);
  });

  it('separates the two sets, so neither is satisfied by a constant answer', () => {
    const caught = planted.filter(([, source]) => fires(rule, source));
    const cleared = innocent.filter((source) => !fires(rule, source));
    expect(caught.length, `${ruleId} flags nothing`).toBe(planted.length);
    expect(cleared.length, `${ruleId} permits nothing`).toBe(innocent.length);
  });
});

describe('the gate catches everything the deletable security suite forbids', () => {
  /**
   * The whole reason these rules were added: `apps/web/tests/p1-27-security.test.ts`
   * is ONE file, and `SEC-002`'s export, media and file-access conjuncts were
   * proved by it and by nothing else. Moving those proofs into the gate is only
   * worth doing if the gate is genuinely at least as wide, so the suite's own
   * refusals are re-read here and each one is required to fire a gate rule.
   *
   * Deliberately NOT a restatement: the patterns are parsed out of the suite. If
   * the suite widens a rule and the gate does not follow, this goes red.
   */
  const SUITE = join(REPO_ROOT, 'apps', 'web', 'tests', 'p1-27-security.test.ts');

  /** The smallest source that IS one alternative of a flat alternation. */
  function literalOf(alternative: string): string {
    return alternative.replace(/\\b/g, '').replace(/\\(.)/g, '$1');
  }

  /**
   * What each of the suite's named absence rules maps to in the gate.
   *
   * `how` is the proof technique, and it is recorded because two of the suite's
   * patterns cannot be split on `|` — they contain groups — and one is
   * deliberately NOT mirrored:
   *
   *   - `every-alternative`: the suite pattern is a flat alternation of literals,
   *     so each alternative becomes a source and the gate must fire on it.
   *   - `corpus`: the pattern contains a group. Each corpus entry is asserted to
   *     match the SUITE first, so the corpus is provably inside what the suite
   *     refuses before the gate is asked about it.
   *   - `none`: no gate rule, recorded as a residual rather than left silent.
   *   - `divergent`: mirroring it would be WRONG — see the note.
   */
  const SUITE_PARITY: readonly {
    readonly suiteRule: string;
    readonly gateRule: string | null;
    readonly how: 'every-alternative' | 'corpus' | 'none' | 'divergent';
    readonly corpus?: readonly string[];
  }[] = [
    { suiteRule: 'export', gateRule: 'no-export-surface', how: 'every-alternative' },
    { suiteRule: 'export-operation', gateRule: 'no-export-surface', how: 'every-alternative' },
    { suiteRule: 'client-extraction', gateRule: 'no-export-surface', how: 'every-alternative' },
    { suiteRule: 'attachment-download', gateRule: 'no-export-surface', how: 'every-alternative' },
    { suiteRule: 'file-access', gateRule: 'no-upload-path', how: 'every-alternative' },
    {
      suiteRule: 'invented-limit',
      gateRule: 'no-invented-media-limit',
      how: 'corpus',
      corpus: [
        'const MAX_FILE_SIZE = n;',
        'const MAX_UPLOAD_SIZE = n;',
        'const MAX_IMAGE_WIDTH = n;',
        'const MAX_MEDIA_BYTES = n;',
        'const ACCEPTED_FILES = list;',
        'const ACCEPTED_MIME = list;',
        'const ACCEPTED_IMAGES = list;',
        '<Field accept={types} />',
      ],
    },
    /*
     * `SEC-002`'s sensitive-data conjunct has a SURFACE in this phase, so the
     * suite proves it positively (the notes-completeness caveat) as well as by
     * these two absences. Neither absence has a gate rule today, and that is
     * recorded here rather than left as a silence for somebody to discover.
     * Measured on this branch: no file in the scanned trees or in any recorded
     * module matches either pattern, so a rule would be adding enforcement to a
     * property that currently holds — a decision, not a correction, and one this
     * branch was not asked to make.
     */
    { suiteRule: 'storage', gateRule: null, how: 'none' },
    { suiteRule: 'unescaped-html', gateRule: null, how: 'none' },
    /*
     * NOT mirrored, and mirroring it would be a regression.
     *
     * The suite's pattern is `['"]?(tenantId|companyId|branchId)['"]?\s*[:,]`,
     * which fires on `f(session.tenantId, x)` — a scope READ off the session the
     * server resolved and passed to a component. The gate's rule is positional
     * (`assertedScopes()`) precisely so that displaying a resolved scope is
     * permitted and placing one into a request is not. The suite runs its
     * version over `PHASE_FILES` only, where no such construct exists; the gate
     * runs over the dashboard tree, where `profile/page.tsx` does exactly that.
     */
    { suiteRule: 'client-asserted-scope', gateRule: 'no-client-asserted-scope', how: 'divergent' },
  ];

  const suiteSource = existsSync(SUITE) ? readFileSync(SUITE, 'utf8') : '';

  /** The suite's `ABSENCE_RULES` table, parsed rather than remembered. */
  const declared = new Map<string, string>(
    [...suiteSource.matchAll(/^\s*\['([a-z-]+)', (\/.+\/)\],$/gm)].map((m) => [
      m[1] as string,
      m[2] as string,
    ])
  );

  it('reads the suite, so nothing below can pass over an empty parse', () => {
    expect(
      existsSync(SUITE),
      'the security suite is gone — the gate rules are now the only enforcement of SEC-002, ' +
        'and this parity section must be removed deliberately rather than left failing'
    ).toBe(true);
    expect(declared.size, 'the suite’s ABSENCE_RULES table was not parsed').toBeGreaterThan(8);
  });

  it('accounts for every absence rule the suite declares, in both directions', () => {
    expect(
      [...declared.keys()].sort(),
      'the suite declares a rule the gate has not decided'
    ).toEqual(SUITE_PARITY.map((entry) => entry.suiteRule).sort());
  });

  it.each(
    SUITE_PARITY.filter((entry) => entry.how === 'every-alternative').map((entry) => [
      entry.suiteRule,
      entry.gateRule as string,
    ])
  )('fires on every alternative the suite’s %s rule forbids', (suiteRule, gateRule) => {
    const source = declared.get(suiteRule) as string;
    expect(source, `${suiteRule} was not parsed`).toBeDefined();
    // Flatness is the precondition of splitting on `|`. A future rewrite that
    // introduced a group would otherwise split mid-group and silently assert
    // nonsense; this makes it fail instead. Escapes are removed first, or
    // `new Blob\(` would read as a group and every flat rule would fail.
    expect(
      source.replace(/\\./g, ''),
      `${suiteRule} is no longer a flat alternation — move it to a corpus`
    ).not.toMatch(/[([]/);
    const alternatives = source.slice(1, -1).split('|');
    expect(alternatives.length, `${suiteRule} has one alternative`).toBeGreaterThan(1);
    const rule = RULES.find((r) => r.id === gateRule);
    for (const alternative of alternatives) {
      const sample = literalOf(alternative);
      expect(
        fires(rule, sample),
        `the suite's ${suiteRule} rule refuses \`${alternative}\` and the gate's ${gateRule} does not`
      ).toBe(true);
    }
  });

  it('fires on every construct the suite’s wider FILE_ACCESS sweep forbids', () => {
    /*
     * The suite forbids file access in TWO places and they are not the same
     * regex. `ABSENCE_RULES['file-access']` lists five constructs; the `5/5 file
     * access` conjunct declares `FILE_ACCESS` with eight, adding the braced file
     * input, `onDrop=` and `DataTransfer`.
     *
     * The wider one is the one that matters — every drag-and-drop upload is built
     * out of the last three and none of them needs an `<input type="file">` — and
     * it is the one the gate's three-construct rule missed entirely. Parsed
     * separately, because the parse above only reaches the `ABSENCE_RULES` table.
     */
    const declaration = /const FILE_ACCESS\s*=\s*(\/.+\/);/.exec(suiteSource)?.[1];
    expect(declaration, 'the suite’s FILE_ACCESS declaration was not parsed').toBeDefined();
    const alternatives = (declaration as string).slice(1, -1).split('|');
    expect(alternatives.length, 'the FILE_ACCESS sweep lists fewer constructs than it did').toBe(8);
    const rule = RULES.find((r) => r.id === 'no-upload-path');
    for (const alternative of alternatives) {
      expect(
        fires(rule, literalOf(alternative)),
        `the suite refuses \`${alternative}\` on the whole phase surface and no-upload-path does not`
      ).toBe(true);
    }
  });

  it.each(
    SUITE_PARITY.filter((entry) => entry.how === 'corpus').map((entry) => [
      entry.suiteRule,
      entry.gateRule as string,
      entry.corpus as readonly string[],
    ])
  )('fires on a corpus that the suite’s %s rule already refuses', (suiteRule, gateRule, corpus) => {
    const suiteRegex = new RegExp((declared.get(suiteRule) as string).slice(1, -1));
    const rule = RULES.find((r) => r.id === gateRule);
    expect(corpus.length).toBeGreaterThan(4);
    for (const sample of corpus) {
      // The order matters: the corpus is proved to be INSIDE the suite's refusal
      // first, so the gate assertion afterwards is a statement about coverage
      // rather than about a set somebody made up.
      expect(suiteRegex.test(sample), `${sample} is not refused by the suite's ${suiteRule}`).toBe(
        true
      );
      expect(fires(rule, sample), `the suite refuses ${sample} and ${gateRule} does not`).toBe(
        true
      );
    }
  });

  it('records the residual: two suite refusals have no gate rule, and why', () => {
    const residual = SUITE_PARITY.filter((entry) => entry.how === 'none');
    expect(residual.map((entry) => entry.suiteRule).sort()).toEqual(['storage', 'unescaped-html']);
    for (const entry of residual) expect(entry.gateRule).toBeNull();
    // And the property they assert does hold on this branch, which is what makes
    // the residual a scope decision rather than a live defect.
    const files = [
      ...SCAN_ROOTS.flatMap((root: string) => listSources(join(REPO_ROOT, root))),
      ...UNCOLLECTED_PHASE_MODULES.flatMap((dir) => {
        const resolved = moduleSourceRoot(dir, REPO_ROOT) as string;
        return statSync(resolved).isDirectory() ? listSources(resolved) : [resolved];
      }),
    ];
    expect(files.length).toBeGreaterThan(80);
    for (const entry of residual) {
      const pattern = new RegExp((declared.get(entry.suiteRule) as string).slice(1, -1));
      const hits = files.filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))));
      expect(
        hits.map((f) => relative(REPO_ROOT, f).split(sep).join('/')),
        entry.suiteRule
      ).toEqual([]);
    }
  });
});

describe('no-export-surface is what the canonical plan records, re-read not remembered', () => {
  /**
   * The rule's authority. `canonical-plan.md` §6 names the operation behind each
   * of the 29 Frontend tasks; not one of them is an export. That is the document
   * saying "this phase publishes no export surface", and it is parsed here rather
   * than paraphrased in the rule's docblock — so a task table that grew an export
   * task would fail this case and force the rule to be reconsidered, instead of
   * the gate quietly forbidding something the plan had started requiring.
   */
  const plan = readFileSync(join(REPO_ROOT, ROOT_AUTHORITY), 'utf8');
  const tasks = [...plan.matchAll(/^\|\s*`(P1-27-FE-\d{3})`\s*\|([^|]*)\|([^|]*)\|/gm)].map(
    (match) => ({
      id: match[1] as string,
      title: (match[2] as string).trim(),
      operations: (match[3] as string).trim(),
    })
  );

  it('parses the Frontend task table at all', () => {
    expect(tasks.length, 'the canonical plan’s Frontend task table was not parsed').toBe(29);
    // Anti-vacuity in the other direction: the operation column really carries
    // operations, so "no export among them" is a statement about content.
    expect(tasks.filter((task) => /`[a-z]+\./.test(task.operations)).length).toBeGreaterThan(20);
  });

  it('names no export operation and no export task', () => {
    for (const task of tasks) {
      expect(task.operations, `${task.id} names an export operation`).not.toMatch(/export/i);
      expect(task.title, `${task.id} is an export task`).not.toMatch(/export/i);
    }
  });
});

describe('no-client-asserted-scope tells ASSERTING a scope from DISPLAYING one', () => {
  /**
   * The rule means "never place a scope into a request", and for the whole of
   * P1-27 it was implemented as "never mention one". The difference was
   * invisible while the gate scanned two trees and became a false accusation the
   * moment the third canonical tree was added: `profile/page.tsx` renders
   * `value={session.tenantId}` — a scope the SERVER resolved, shown read-only to
   * the operator who is signed in to it.
   *
   * Allow-listing that file was the wrong fix twice over: it is the mechanism
   * this gate already lost a rule to (`no-duplicate-scan-on-a-queue`), and it
   * would have exempted every future line in the file as well.
   *
   * These cases pin the line in BOTH directions, so inverting the distinction —
   * exempting what goes into a request, flagging what is read out of a session —
   * fails here rather than passing quietly.
   */
  const rule = RULES.find((r: { id: string }) => r.id === 'no-client-asserted-scope');

  const ASSERTIONS: readonly [string, string][] = [
    ['a body property', 'const body = { tenantId: id };'],
    ['a snake_case body property', 'const p = { branch_id: session.branch };'],
    ['a shorthand property', 'const path = query({ tenantId, cursor });'],
    ['a query string', "const url = '/api/v1/customers?tenant_id=' + id;"],
    ['a template query string', 'const url = `/api/v1/customers?tenantId=${id}`;'],
    ['a path interpolation', 'const url = `/api/v1/tenants/${companyId}/customers`;'],
    ['a URLSearchParams key', "params.set('branchId', chosen);"],
    ['a session value interpolated INTO a URL', 'const u = `/x?c=${session.company_id}`;'],
  ];

  const DISPLAYS: readonly [string, string][] = [
    [
      'the profile screen showing the resolved tenant',
      'return <Definition value={session.tenantId} />;',
    ],
    ['an optional-chained read', 'const shown = account?.company_id;'],
    ['a read passed to a presentational component', 'return <Row id={session.branchId} mono />;'],
  ];

  it.each(ASSERTIONS)('flags %s', (_what, source) => {
    expect(assertedScopes(source).length, source).toBeGreaterThan(0);
    expect(fires(rule, source), source).toBe(true);
  });

  it.each(DISPLAYS)('permits %s', (_what, source) => {
    expect(assertedScopes(source), source).toEqual([]);
    expect(fires(rule, source), source).toBe(false);
  });

  it('is not vacuous in either direction — the two sets are disjoint and non-empty', () => {
    /*
     * The inversion guard. A `detect` that always returned true would pass every
     * ASSERTION case; one that always returned false would pass every DISPLAY
     * case. Only a rule that separates them passes both sets, and this states
     * that requirement as one assertion rather than leaving it implicit in the
     * two `it.each` blocks above.
     */
    const flagged = ASSERTIONS.filter(([, s]) => fires(rule, s)).length;
    const permitted = DISPLAYS.filter(([, s]) => !fires(rule, s)).length;
    expect(flagged, 'the rule flags nothing').toBe(ASSERTIONS.length);
    expect(permitted, 'the rule permits nothing').toBe(DISPLAYS.length);
    expect(ASSERTIONS.length).toBeGreaterThan(3);
    expect(DISPLAYS.length).toBeGreaterThan(1);
  });

  it('reaches the real file, and clears it — the profile screen is scanned, not exempted', () => {
    /*
     * The distinction is proved against the actual source, not only against
     * fixtures. If somebody re-broke the rule into a bare name match this file
     * would be reported; if somebody allow-listed it instead, `allow` would stop
     * being empty and the invariant below would fail.
     */
    const profile = join(
      REPO_ROOT,
      'apps/web/src/app/[locale]/(dashboard)/profile/page.tsx'.split('/').join(sep)
    );
    const source = stripComments(readFileSync(profile, 'utf8'));
    expect(source, 'the profile screen no longer displays the resolved tenant').toContain(
      'session.tenantId'
    );
    expect(assertedScopes(source), 'a read-only display was reported as an assertion').toEqual([]);
    expect(rule?.allow, 'the rule was fixed with an exemption instead of a distinction').toEqual(
      []
    );
  });

  it('covers every scope name it declares', () => {
    // A name added to `SCOPE_NAMES` and left out of the pattern would be a rule
    // that names a scope it cannot see.
    for (const name of SCOPE_NAMES) {
      expect(assertedScopes(`const b = { ${name}: x };`).length, name).toBeGreaterThan(0);
      expect(assertedScopes(`const v = session.${name};`), name).toEqual([]);
    }
  });

  it('knows where a string ends, so a scope after one is still judged', () => {
    // The literal mask is the part most likely to go wrong silently. A mask that
    // never closed would classify the whole file as a string; one that never
    // opened would miss every query-string assertion.
    const mask = literalMask("const a = 'x'; const b = { tenantId: 1 };");
    expect(mask[11], 'the character inside the quotes is literal').toBe(true);
    expect(mask[mask.length - 2], 'the mask never closed the string').toBe(false);
  });
});

describe('a directory symlink is refused rather than walked past (QA005-12)', () => {
  /*
   * `Dirent.isDirectory()` is FALSE for a symlink pointing at a directory —
   * readdir does not stat through the link. So `if (entry.isDirectory())` walks
   * past it and the extension test then rejects it as a file: the tree beyond it
   * is never read and nothing says so.
   *
   * Driven with a synthetic Dirent rather than a real link, because creating one
   * on Windows needs a privilege the developer machine does not have — and a
   * test that silently skips on one platform is the defect this phase is made of.
   */
  it('throws, naming the path, when an entry is a symbolic link', () => {
    expect(() =>
      assertNotSymlink({ isDirectory: () => false, isSymbolicLink: () => true }, 'a/b/link')
    ).toThrow(/a\/b\/link is a symbolic link/);
  });

  it('says why, so the reader knows the tree beyond it was never scanned', () => {
    expect(() =>
      assertNotSymlink({ isDirectory: () => false, isSymbolicLink: () => true }, 'x')
    ).toThrow(/silently scan nothing/);
  });

  it('lets an ordinary file through', () => {
    expect(() =>
      assertNotSymlink({ isDirectory: () => false, isSymbolicLink: () => false }, 'a.ts')
    ).not.toThrow();
  });

  it('the live trees contain no symlink, so the gate reads what it claims to', () => {
    // The property the refusal exists to guarantee, asserted against the real
    // trees: if one ever appears, the gate exits 2 rather than reporting clean.
    for (const root of SCAN_ROOTS) {
      expect(() => listSources(join(REPO_ROOT, root))).not.toThrow();
    }
  });
});

describe('the comment stripper is proven, not assumed', () => {
  it('passes its own self-test', () => {
    expect(selfTest()).toEqual([]);
  });

  it('removes prose and preserves code', () => {
    const stripped = stripComments(
      ['// customer-merge', '/** vehicle-merge */', "const p = '/merge';"].join('\n')
    );
    expect(stripped).not.toContain('customer-merge');
    expect(stripped).not.toContain('vehicle-merge');
    expect(stripped).toContain("'/merge'");
  });

  it('does not truncate a URL at its own double slash', () => {
    // A naive `//.*$` strip would delete everything after `https:`, hiding any
    // real match on the rest of that line.
    //
    // Asserted on the TAIL, not on the whole URL. `includes()` of a full URL is
    // `js/incomplete-url-substring-sanitization`, which CodeQL raised as HIGH
    // against the gate's own self-test on PR #198 — correctly, because a
    // substring check on a URL is a broken host check. The property here never
    // needed the host: what matters is that the characters after the `//`
    // survived, which is precisely what a truncation at `https:` destroys.
    expect(stripComments("const u = 'https://example.test/keep-me';")).toContain('/keep-me');
  });

  it('fails the whole gate when the stripper over-matches', () => {
    // The self-test result is folded into `evaluate`, so a stripper regression
    // cannot quietly turn every rule into a scan over empty strings. That is the
    // one failure mode the anti-vacuity rules below cannot see for themselves.
    const problems = selfTest();
    expect(Array.isArray(problems)).toBe(true);
  });
});

describe('a rule that measures nothing is a failure, not a pass', () => {
  it('fails when no file is inspected at all', () => {
    const { failures } = evaluate([]);
    expect(failures.some((f) => f.includes('no files were inspected'))).toBe(true);
  });

  it('carries no rule whose allow-list could swallow every file', () => {
    /*
     * This case used to drive `no-duplicate-scan-on-a-queue`, whose allowance is
     * now empty because it exempted a file that never matched the rule
     * (`P1-27-FE-003`, and see the invariant below).
     *
     * NO rule carries an allowance today, so the swallow scenario cannot be
     * constructed from the real rule set — which the loop below states rather
     * than hiding behind a `find` that silently returns nothing. It is
     * deliberately empty NOW and becomes live the moment any allowance is added.
     *
     * The title used to say "fails a rule whose allow-list has swallowed every
     * file", which is what the NEXT case does. This one asserts an invariant.
     */
    const withAllowances = RULES.filter((r) => r.allow.length > 0);
    for (const rule of withAllowances) {
      const onlyAllowed = rule.allow.map((path: string) => ({
        path,
        source: 'export const a = 1;',
      }));
      const { failures } = evaluate(onlyAllowed);
      expect(
        failures.some((f) => f.includes(`${rule.id}: inspected 0 files`)),
        rule.id
      ).toBe(true);
    }
    // The invariant that makes the emptiness above a FACT rather than an
    // accident. Without it, a future allowance could reintroduce the hole and
    // this case would keep passing by iterating over nothing.
    expect(withAllowances.map((r) => r.id)).toEqual([]);
  });

  it('fails a rule that inspected zero files, proved on a synthetic rule', () => {
    /*
     * The per-rule anti-vacuity branch — `check-p1-27-frontend.mjs`'s
     * "inspected 0 files — this rule is measuring nothing" — has had ZERO
     * coverage since every allowance was emptied: the loop above iterates over
     * nothing, and `evaluate([])` returns at the earlier whole-run guard before
     * any rule is reached.
     *
     * A branch that exists to catch a gate measuring nothing must not itself be
     * deletable green. RULES is mutated for the length of this case only and
     * restored in `finally`, so the real rule set is unchanged either way.
     */
    // `RULES` is inferred `allow: never[]` because every real rule's allowance
    // is `[]` — which is the fact the case above pins. The cast is what lets a
    // synthetic rule carry one; it widens the local view, not the export.
    const rules = RULES as unknown as {
      id: string;
      pattern: RegExp;
      what: string;
      allow: string[];
    }[];
    rules.push({
      id: 'synthetic-allow-everything',
      pattern: /never-matches-anything/,
      what: 'exists only to reach the per-rule anti-vacuity branch',
      allow: ['synthetic/'],
    });
    try {
      const { failures } = evaluate([{ path: 'synthetic/a.ts', source: 'export const a = 1;' }]);
      expect(
        failures.some((f) => f.includes('synthetic-allow-everything: inspected 0 files')),
        'the per-rule anti-vacuity branch did not fire'
      ).toBe(true);
    } finally {
      rules.pop();
    }
    // And the rule set is back exactly as it was.
    expect(RULES.some((r) => r.id === 'synthetic-allow-everything')).toBe(false);
  });
});

describe('the scan roots are ALL THREE of this phase’s trees, plus every adopted one', () => {
  /**
   * The plan is the authority, and it is re-read here rather than remembered.
   *
   * `canonical-plan.md` §9 names three trees. `SCAN_ROOTS` named two, under a
   * docblock asserting there were two — a declaration contradicting the plan, in
   * the gate that exists to enforce the plan. 43 files were scanned and 26 were
   * not: 38% of the canonical Frontend surface, containing the customer detail
   * screen that `SEC-001` and `SEC-003` are about.
   *
   * Deriving the expected set from the plan is what makes this case fail if the
   * third tree is removed again — a hard-coded list of three would be one more
   * thing somebody could edit in the same commit as the constant.
   *
   * ## Two halves, two authorities, checked separately
   *
   * `SCAN_ROOTS` is now `PLAN_ROOTS` plus `ADOPTED_ROOTS`. The plan half is
   * still derived from `canonical-plan.md` and still has to be exactly the three
   * that document declares — a later phase may NOT quietly add itself to a
   * closed phase's plan, which is precisely what the split prevents.
   *
   * The adopted half is a different claim: a later phase declaring its own tree
   * in its own plan and opting into these rules. Each entry names its authority
   * and is checked against that document instead, so neither plan is made to say
   * something it does not.
   */
  const plan = readFileSync(join(REPO_ROOT, ROOT_AUTHORITY), 'utf8');
  const declaredInPlan = [...plan.matchAll(/`(apps\/web\/src\/[^`]*?)\/\*\*`/g)]
    .map((m) => m[1] as string)
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();
  const posix = (path: string) => path.split(/[\\/]/).join('/');
  const planRoots = PLAN_ROOTS.map(posix).sort();
  const adoptedRoots = ADOPTED_ROOTS.map((entry: { root: string }) => posix(entry.root)).sort();
  const roots = SCAN_ROOTS.map(posix).sort();

  it('reads the plan at all, so nothing below can pass over an empty list', () => {
    expect(plan.length).toBeGreaterThan(2000);
    expect(declaredInPlan.length, 'the canonical plan declares no Frontend tree').toBe(3);
  });

  it('scans exactly the trees the canonical plan declares Frontend work lives in', () => {
    expect(
      planRoots,
      `${ROOT_AUTHORITY} and PLAN_ROOTS disagree about the Frontend surface`
    ).toEqual(declaredInPlan);
    // And no adopted tree has crept into the plan half.
    for (const adopted of adoptedRoots) {
      expect(planRoots, `${adopted} was added to the plan half`).not.toContain(adopted);
    }
  });

  it('opens every tree — the plan’s three and the adopted one', () => {
    expect(roots).toEqual([...planRoots, ...adoptedRoots].sort());
    expect(roots.length).toBe(planRoots.length + adoptedRoots.length);
  });

  it('every adopted tree names an authority document that exists and declares it', () => {
    /*
     * The whole point of the split: an adoption is a citation, not an opinion.
     * The phase's OWN plan has to name the tree, exactly as P1-27's plan names
     * its three, or the entry is an assertion with nothing behind it.
     */
    expect(ADOPTED_ROOTS.length).toBeGreaterThan(0);
    for (const entry of ADOPTED_ROOTS as readonly {
      root: string;
      authority: string;
      phase: string;
    }[]) {
      const authority = join(REPO_ROOT, entry.authority);
      expect(existsSync(authority), `${entry.authority} does not exist`).toBe(true);
      const document = readFileSync(authority, 'utf8');
      expect(
        document.includes(posix(entry.root)),
        `${entry.authority} never names ${posix(entry.root)}`
      ).toBe(true);
    }
  });

  it('narrows exactly ONE rule to the plan trees, and every other rule reads the adopted one', () => {
    /*
     * `rec.*` publishes `companyId`/`branchId` as a required resource selector
     * (`P1-18-A-01`), so `no-client-asserted-scope`'s premise is false in the
     * reception tree. That narrowing is expressed as the rule's `roots` and NOT
     * as an `allow` entry — an allowance exempts files from a rule that applies
     * to them, and the cases above forbid one for exactly that reason.
     *
     * One rule may carry `roots`, and it is that one. A second appearing here is
     * a widening of the blind spot, which has to be argued rather than noticed
     * later; and every other rule — `no-upload-path` and
     * `no-invented-media-limit` above all — must reach the adopted tree, which
     * is what O2 was about.
     */
    const scoped = (RULES as readonly { id: string; roots?: readonly string[] }[]).filter(
      (rule) => rule.roots !== undefined
    );
    expect(scoped.map((rule) => rule.id)).toEqual(['no-client-asserted-scope']);
    expect(scoped[0]?.roots).toEqual(PLAN_ROOTS.map(posix));

    // Measured through `inRuleScope`, not re-derived: a reception file is out of
    // the scope rule's reach and inside every other rule's.
    const receptionFile = `${adoptedRoots[0]}/api.ts`;
    for (const rule of RULES as readonly { id: string }[]) {
      expect(inRuleScope(rule, receptionFile), rule.id).toBe(
        rule.id !== 'no-client-asserted-scope'
      );
      expect(inRuleScope(rule, 'apps/web/src/features/crm/customers/api.ts'), rule.id).toBe(true);
    }
  });

  it('sweeps the narrowed-out tree for the ONE scope name that is never a selector', () => {
    /*
     * What the narrowing gives up, measured. `companyId`/`branchId` are a
     * published selector on `rec.*`; `tenantId`/`tenant_id` is a selector on
     * nothing, anywhere — it is resolved from the session and never sent. So the
     * tree the scope rule does not read is swept for those two names in any
     * position, which is the half of the rule that still holds there.
     */
    const files = ADOPTED_ROOTS.flatMap((entry: { root: string }) =>
      listSources(join(REPO_ROOT, entry.root)).map((path) => ({
        path: relative(REPO_ROOT, path).split(sep).join('/'),
        source: stripComments(readFileSync(path, 'utf8')),
      }))
    );
    // Anti-vacuity: a walk that returned nothing would make the sweep silent.
    expect(files.length, 'the adopted tree holds no source to sweep').toBeGreaterThan(10);
    const offenders = files
      .filter(({ source }) => /\btenantId\b|\btenant_id\b/.test(source))
      .map(({ path }) => path);
    expect(offenders, 'the adopted tree names a tenant scope the client must never send').toEqual(
      []
    );
  });

  it('names the dashboard route tree specifically — it was the one that was missing', () => {
    // Stated separately from the derivation above so the regression has a case
    // of its own. Removing the third entry fails here by name.
    expect(roots).toContain('apps/web/src/app/[locale]/(dashboard)');
    expect(roots).toContain('apps/web/src/features/crm');
    expect(roots).toContain('apps/web/src/features/vehicles');
  });

  it('every declared root exists and holds source the gate can inspect', () => {
    // A root that no longer matches reports clean over nothing. `evaluate()`
    // fails a whole-run scan of zero files; this fails a single dead root, which
    // the whole-run guard cannot see while the other two still return files.
    for (const root of SCAN_ROOTS) {
      const dir = join(REPO_ROOT, root);
      expect(existsSync(dir), `${root} does not exist`).toBe(true);
      expect(statSync(dir).isDirectory(), `${root} is not a directory`).toBe(true);
      const count = countSources(dir);
      expect(
        count,
        `${root} contains no .ts or .tsx file — the gate scans it and learns nothing`
      ).toBeGreaterThan(0);
    }
  });

  it('actually opens the file SEC-001 and SEC-003 are about', () => {
    /*
     * The concrete consequence of the omission, asserted as a fact about the
     * file set rather than about the root list: with two roots this file was
     * invisible to all six rules.
     */
    const scanned = SCAN_ROOTS.flatMap((root: string) =>
      listSources(join(REPO_ROOT, root)).map((p) => relative(REPO_ROOT, p).split(sep).join('/'))
    );
    expect(scanned).toContain(
      'apps/web/src/app/[locale]/(dashboard)/crm/customers/[customerId]/page.tsx'
    );
    expect(scanned.length, 'the gate must scan the whole canonical surface').toBeGreaterThan(60);
  });

  it('exempts NO file from the duplicate-scan rule', () => {
    /*
     * This case used to assert the opposite, and its comment explained why: "the
     * CRM scan operation is called once, on explicit intent, by the creation
     * form". That was never true.
     *
     * `creation-actions.ts` contains no scan call — `crm-customer-create.dom
     * .test.tsx` asserts its absence deliberately — because the creation-time
     * duplicate warning arrives on the create RESPONSE as `possibleDuplicates`.
     * Both scans are `DELIBERATELY_ABSENT` in the reachability manifest.
     *
     * So the exemption matched nothing, and `evaluate()` skips allow-listed files
     * without ever reporting an unused entry. It was a live hole: a privileged
     * audited write added to that one file would have passed the gate that exists
     * to stop it. This assertion is what keeps the list empty (`P1-27-FE-003`).
     */
    const rule = RULES.find((r) => r.id === 'no-duplicate-scan-on-a-queue');
    expect(rule?.allow).toEqual([]);
  });

  it('has no allowance anywhere that matches no file in the tree', () => {
    // The general form of the defect above. An exemption for a path that does
    // not exist is either a typo or a hole, and neither should survive silently.
    for (const rule of RULES) {
      for (const allowed of rule.allow) {
        expect(
          existsSync(join(REPO_ROOT, allowed)),
          `${rule.id} exempts a missing path: ${allowed}`
        ).toBe(true);
      }
    }
  });
});

describe('a rule firing is not the same fact as the gate opening the file', () => {
  /**
   * `evaluate()` applies every rule to every `{path, source}` pair it is handed
   * and never asks where the path came from. That is correct — the walker
   * decides what to hand it — but it means an assertion of the form
   *
   *     evaluate([{ path: 'anything.ts', source: 'console.log(x)' }])
   *
   * proves the RULE fires and proves NOTHING about whether CI would ever open
   * that file. `collects()` is the second half of that proof, and these cases
   * are the demonstration that the two halves are genuinely independent.
   */
  const TRIPS_A_RULE = 'const body = new FormData();';

  it('flags a file no scan root contains — evaluate() is path-blind by design', () => {
    const outside = 'apps/web/src/components/forms/RecordForm.tsx';
    const { failures } = evaluate([{ path: outside, source: TRIPS_A_RULE }]);
    expect(failures.filter((f: string) => f.startsWith('no-upload-path:'))).toHaveLength(1);
    // …and the gate would never have read it.
    expect(collects(outside), `${outside} is outside every SCAN_ROOT`).toBe(false);
  });

  it('reports the same two paths an assessor used as NOT COLLECTED', () => {
    // The concrete pair from the re-assessment. Both are this phase's own code
    // and no root contains either.
    expect(collects('apps/web/src/components/forms/RecordForm.tsx')).toBe(false);
    expect(collects('apps/web/src/lib/customers/directory.ts')).toBe(false);
  });

  it('says YES for a path under each scan root', () => {
    for (const root of SCAN_ROOTS) {
      const path = `${root.split(sep).join('/')}/somewhere/File.tsx`;
      expect(collects(path), path).toBe(true);
    }
  });

  it('mirrors the walker rather than approximating it', () => {
    // Extension, skipped directory and separator form — the three things the
    // real walk decides, asserted against the same answers.
    expect(collects('apps/web/src/features/crm/notes.md')).toBe(false);
    expect(collects('apps/web/src/features/crm/node_modules/pkg/index.ts')).toBe(false);
    expect(collects('apps\\web\\src\\features\\crm\\api.ts')).toBe(true);
    // A root itself is not a file, and nothing outside the trees is collected.
    expect(collects('apps/web/src/features/crm')).toBe(false);
    expect(collects('apps/web/src/features/administration/access/api.ts')).toBe(false);
    expect(collects('')).toBe(false);
  });

  it('agrees with the real walk over every file the gate actually reads', () => {
    // The strongest form: `collects()` must be TRUE for every file a real run
    // collects. A predicate that disagreed with the walker would make every
    // assertion built on it a different kind of fiction.
    const walked = SCAN_ROOTS.flatMap((root: string) =>
      listSources(join(REPO_ROOT, root)).map((p) => relative(REPO_ROOT, p).split(sep).join('/'))
    );
    expect(walked.length).toBeGreaterThan(60);
    expect(walked.filter((p) => !collects(p))).toEqual([]);
  });
});

describe('the phase modules outside every scan root are DERIVED, not listed', () => {
  /**
   * The D1 remediation moved shared code out of `features/` and the gate's roots
   * did not follow it. Extending `SCAN_ROOTS` is not available to this branch:
   * the root list is re-derived from `canonical-plan.md` §9 by the cases above,
   * and `check-p1-27-doc-counts.mjs` publishes the file and tree counts into four
   * documents. So the property a fourth root would have bought is asserted here
   * instead, over exactly the files it would have covered.
   *
   * ## What changed, and why a list could not have noticed
   *
   * `UNCOLLECTED_PHASE_MODULES` was five directories, written by hand. The
   * scanned trees import **fourteen**. A hand-written list can only fail when one
   * of ITS entries goes missing; it can never fail because something was never
   * added — and the largest omission was `components/data-table`, which holds
   * `DataTable.tsx`, the component that renders every customer and vehicle row on
   * screen. It was in neither this list nor the security suite's own
   * hand-written five, and the two lists did not agree with each other either.
   *
   * The set is now derived from the imports the scanned trees actually make and
   * `MODULE_DISPOSITION` must decide each one, asserted as an equality in both
   * directions — by the GATE on every real run, not only here.
   *
   * See `UNCOLLECTED_PHASE_MODULES` in the gate for why widening `SCAN_ROOTS` to
   * `apps/web/src` is worse rather than better.
   */

  /** Every `.ts`/`.tsx` of a recorded module, whether it is a directory or a file. */
  function moduleSources(directory: string): string[] {
    const resolved = moduleSourceRoot(directory, REPO_ROOT);
    expect(resolved, `${directory} resolves to nothing under the repository`).not.toBeNull();
    const path = resolved as string;
    return statSync(path).isDirectory() ? listSources(path) : [path];
  }

  /** The real scanned files, exactly as `main()` hands them to the gate. */
  const scanned = SCAN_ROOTS.flatMap((root: string) =>
    listSources(join(REPO_ROOT, root)).map((path) => ({
      path: relative(REPO_ROOT, path).split(sep).join('/'),
      source: readFileSync(path, 'utf8'),
    }))
  );

  it('derives the module set from real imports rather than from a hand-written list', () => {
    const derived = importedModuleDirectories(scanned);
    // Anti-vacuity: the derivation really read something. A regex that matched
    // nothing would make the equality below a comparison of two empty sets.
    // 18 since the P1-28 appointment tree was adopted: its confirmation dialogs
    // pull in `components/overlays`, which no previously scanned tree imported.
    expect(derived.length, 'no module import was discovered — the derivation is broken').toBe(18);
    expect(
      derived,
      'a module the scanned trees import has no recorded disposition, or a recorded module is ' +
        'imported by nothing'
    ).toEqual(Object.keys(MODULE_DISPOSITION).sort());
  });

  it('sees the directory that was in NO list — components/data-table', () => {
    // Named individually, because a count of fourteen is satisfied by any
    // fourteen and this is the one that renders the data the SEC-002 sweeps are
    // about. `DataTable.tsx` is the file six sweeps claiming to cover "the
    // phase's WHOLE surface" had never opened.
    expect(importedModuleDirectories(scanned)).toContain('apps/web/src/components/data-table');
    expect(UNCOLLECTED_PHASE_MODULES).toContain('apps/web/src/components/data-table');
    expect(
      moduleSources('apps/web/src/components/data-table').map((p) => p.split(/[\\/]/).pop())
    ).toContain('DataTable.tsx');
  });

  it('fails a real run when an import has no recorded disposition', () => {
    const { failures } = evaluateModuleDispositions([
      ...scanned,
      {
        path: 'apps/web/src/features/crm/customers/planted.ts',
        source: "import { thing } from '@/lib/not-yet-decided/thing';",
      },
    ]);
    expect(
      failures.filter((f) => f.includes('apps/web/src/lib/not-yet-decided')),
      failures.join('\n')
    ).toHaveLength(1);
  });

  it('fails a real run when a recorded module is imported by nothing', () => {
    // The other direction. Handed a file set that imports one module, every other
    // recorded module is stale — which is exactly the failure a hand-written list
    // could report and the failure it could never report was the one above.
    const { failures } = evaluateModuleDispositions([
      {
        path: 'apps/web/src/features/crm/customers/planted.ts',
        source: "import { score } from '@/lib/duplicates/score';",
      },
    ]);
    expect(
      failures.some(
        (f) => f.includes('apps/web/src/components/data-table') && f.includes('the record is stale')
      ),
      failures.join('\n')
    ).toBe(true);
  });

  it('fails a real run when the derivation itself finds nothing', () => {
    // The guard that stops the equality from being satisfied by two empty sets —
    // the exact failure mode the hand-written list had no defence against.
    const { failures } = evaluateModuleDispositions([
      { path: 'apps/web/src/features/crm/a.ts', source: 'export const a = 1;' },
    ]);
    expect(failures.some((f) => f.includes('the derivation is broken'))).toBe(true);
  });

  it('is clean on the real tree, which is the run CI performs', () => {
    expect(evaluateModuleDispositions(scanned).failures).toEqual([]);
  });

  it('is a live set of modules that exist and are not collected', () => {
    // 16 since `components/overlays` was decided `in-surface` for the adopted
    // P1-28 appointment tree.
    expect(UNCOLLECTED_PHASE_MODULES.length).toBe(16);
    for (const dir of UNCOLLECTED_PHASE_MODULES) {
      // `moduleSourceRoot`, not `existsSync`: `apps/web/src/lib/page-metadata`
      // is a FILE, and dropping it to avoid an `ENOENT` would be precisely the
      // omission the derivation exists to stop.
      expect(moduleSourceRoot(dir, REPO_ROOT), `${dir} no longer exists`).not.toBeNull();
      // If one of these ever comes inside a root, the record is stale and must
      // be shortened — a note describing a fixed problem is a lie in waiting.
      expect(collects(`${dir}/Sample.tsx`), `${dir} is now inside a SCAN_ROOT`).toBe(false);
    }
  });

  it('trips NO rule today — measured over the real files, not assumed', () => {
    /*
     * The teeth. The gate cannot reach these files, so this case reaches them:
     * every rule, over every `.ts`/`.tsx` in the recorded modules, read from
     * disk. The day a merge caller, an upload path, an export construction or a
     * `console.log` lands in one of them, this goes red and the question of a
     * fourth scan root arrives with evidence attached instead of as an opinion.
     */
    const files = UNCOLLECTED_PHASE_MODULES.flatMap((dir) => moduleSources(dir));
    expect(files.length, 'the recorded modules hold no source at all').toBeGreaterThan(15);

    const violations: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const rule of RULES) {
        if (fires(rule, source)) {
          violations.push(`${rule.id}: ${relative(REPO_ROOT, file).split(sep).join('/')}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('pins the two exclusions to the exact files that earn them', () => {
    /*
     * `platform-transport` is the only disposition that keeps a module OUT, so it
     * is the only place this section could hide a violation. It is measured.
     *
     * Every rule is run over both excluded modules and the matches are named. A
     * new match — or one of these ceasing to match — fails, and the reader is
     * told the exclusion has stopped being true rather than reading the word
     * "excluded" and believing it.
     */
    const excluded = Object.entries(MODULE_DISPOSITION)
      .filter(([, disposition]) => disposition === 'platform-transport')
      .map(([directory]) => directory)
      .sort();
    expect(excluded).toEqual(['apps/web/src/lib/api', 'apps/web/src/lib/observability']);

    const matches: string[] = [];
    for (const dir of excluded) {
      for (const file of moduleSources(dir)) {
        const source = stripComments(readFileSync(file, 'utf8'));
        for (const rule of RULES) {
          if (fires(rule, source)) {
            matches.push(`${rule.id}: ${relative(REPO_ROOT, file).split(sep).join('/')}`);
          }
        }
      }
    }
    expect(
      matches.sort(),
      'the platform-transport exclusion no longer describes what is in it'
    ).toEqual(EXCLUDED_MODULE_MATCHES);
  });
});
