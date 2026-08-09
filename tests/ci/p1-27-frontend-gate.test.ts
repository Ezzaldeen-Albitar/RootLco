import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ROOT_AUTHORITY,
  RULES,
  SCAN_ROOTS,
  SCOPE_NAMES,
  UNCOLLECTED_PHASE_MODULES,
  assertNotSymlink,
  assertedScopes,
  collects,
  evaluate,
  fires,
  literalMask,
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
      ' * branchId. No total is invented. There is no FormData() upload path.',
      ' */',
      '// console.log is never used here either.',
      'export const ok = 1;',
    ].join('\n');
    const { failures } = evaluate(withViolation(prose));
    expect(failures.filter((f) => f.startsWith(`${ruleId}:`))).toEqual([]);
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

describe('the scan roots are ALL THREE of this phase’s trees', () => {
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
   */
  const plan = readFileSync(join(REPO_ROOT, ROOT_AUTHORITY), 'utf8');
  const declaredInPlan = [...plan.matchAll(/`(apps\/web\/src\/[^`]*?)\/\*\*`/g)]
    .map((m) => m[1] as string)
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();
  const roots = SCAN_ROOTS.map((r: string) => r.split(/[\\/]/).join('/')).sort();

  it('reads the plan at all, so nothing below can pass over an empty list', () => {
    expect(plan.length).toBeGreaterThan(2000);
    expect(declaredInPlan.length, 'the canonical plan declares no Frontend tree').toBe(3);
  });

  it('scans exactly the trees the canonical plan declares Frontend work lives in', () => {
    expect(roots, `${ROOT_AUTHORITY} and SCAN_ROOTS disagree about the Frontend surface`).toEqual(
      declaredInPlan
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

describe('the phase modules that live outside every scan root', () => {
  /**
   * The D1 remediation moved shared code out of `features/` and the gate's roots
   * did not follow it. Extending `SCAN_ROOTS` is not available to this branch:
   * the root list is re-derived from `canonical-plan.md` §9 by the cases above,
   * and `check-p1-27-doc-counts.mjs` publishes the file and tree counts into four
   * documents. So the property a fourth root would have bought is asserted here
   * instead, over exactly the files it would have covered.
   *
   * See `UNCOLLECTED_PHASE_MODULES` in the gate for the full reasoning, including
   * why widening to `apps/web/src` is worse rather than better.
   */
  it('is a live, non-empty list of directories that exist and are not collected', () => {
    expect(UNCOLLECTED_PHASE_MODULES.length).toBeGreaterThan(0);
    for (const dir of UNCOLLECTED_PHASE_MODULES) {
      expect(existsSync(join(REPO_ROOT, dir)), `${dir} no longer exists`).toBe(true);
      // If one of these ever comes inside a root, the record is stale and must
      // be shortened — a note describing a fixed problem is a lie in waiting.
      expect(collects(`${dir}/Sample.tsx`), `${dir} is now inside a SCAN_ROOT`).toBe(false);
    }
  });

  it('is reached from inside the scanned trees, so it is unambiguously this phase', () => {
    const scanned = SCAN_ROOTS.flatMap((root: string) => listSources(join(REPO_ROOT, root)));
    const imported = new Set<string>();
    for (const file of scanned) {
      const source = readFileSync(file, 'utf8');
      for (const dir of UNCOLLECTED_PHASE_MODULES) {
        // `apps/web/src/lib/customers` -> the `@/lib/customers` alias the tree uses.
        const alias = `@/${dir.replace('apps/web/src/', '')}/`;
        if (source.includes(`from '${alias}`)) imported.add(dir);
      }
    }
    expect(
      [...imported].sort(),
      'a recorded module nothing imports is not this phase’s surface'
    ).toEqual([...UNCOLLECTED_PHASE_MODULES].sort());
  });

  it('trips NO rule today — measured over the real files, not assumed', () => {
    /*
     * The teeth. The gate cannot reach these files, so this case reaches them:
     * every rule, over every `.ts`/`.tsx` in the recorded directories, read from
     * disk. Green today at 10 files. The day a merge caller, an upload path or a
     * `console.log` lands in one of them, this goes red and the question of a
     * fourth scan root arrives with evidence attached instead of as an opinion.
     */
    const files = UNCOLLECTED_PHASE_MODULES.flatMap((dir) => listSources(join(REPO_ROOT, dir)));
    expect(files.length, 'the recorded directories hold no source at all').toBeGreaterThan(0);

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
});
