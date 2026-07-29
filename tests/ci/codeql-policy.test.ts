/**
 * The CodeQL/SARIF policy gate, and the commit check-run enumerator.
 *
 * Both exist because of AR-52: a `CodeQL` check from GitHub Advanced Security
 * sat red on five consecutive heads of the previous initiative while every
 * report said the workflow was 14/14 green. The workflow WAS green — uploading
 * SARIF is what that job does. The alerts it uploaded were judged by a separate
 * check-run that `/actions/runs` does not list.
 *
 * Every test below is a mutation in disguise: each asserts that some way of
 * being blind produces No-Go rather than silence.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  extractFindings,
  isApplicationPath,
  normalisePath,
  severityOf,
  validateSarif,
  toMarkdown,
} from '../../scripts/ci/codeql-policy.mjs';
import {
  evaluate as evaluateChecks,
  safeText,
  toMarkdown as checksMarkdown,
} from '../../scripts/ci/check-commit-checks.mjs';

/** A minimal but realistic CodeQL SARIF document. */
const sarif = (results: unknown[], driver = 'CodeQL') => ({
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: driver,
          rules: [
            {
              id: 'js/remote-property-injection',
              name: 'js/remote-property-injection',
              properties: { 'security-severity': '7.5', precision: 'high' },
            },
            {
              id: 'js/file-system-race',
              name: 'js/file-system-race',
              properties: { 'security-severity': '7.0', precision: 'medium' },
            },
            {
              id: 'js/template-syntax-in-string-literal',
              name: 'js/template-syntax-in-string-literal',
              properties: { precision: 'high' },
              defaultConfiguration: { level: 'warning' },
            },
          ],
        },
      },
      results,
    },
  ],
});

const result = (ruleId: string, path: string, extra: Record<string, unknown> = {}) => ({
  ruleId,
  message: { text: `finding in ${path}` },
  locations: [{ physicalLocation: { artifactLocation: { uri: path }, region: { startLine: 10 } } }],
  ...extra,
});

const docs = (document: unknown, label = 'javascript.sarif') => [{ label, document }];

const BASE = { expectedLanguages: [], today: '2026-07-29' };

describe('the gate refuses to report clean when it cannot see', () => {
  it('fails when no SARIF exists at all', () => {
    const verdict = evaluate({ documents: [], baseline: BASE });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/did not run must never read as/);
  });

  it('fails when `runs` is empty — nothing was analysed', () => {
    const verdict = evaluate({ documents: docs({ version: '2.1.0', runs: [] }), baseline: BASE });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/`runs` is empty/);
  });

  it('fails when `results` is absent, because absent is not empty', () => {
    const broken = {
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'CodeQL' } } }],
    };
    expect(evaluate({ documents: docs(broken), baseline: BASE }).ok).toBe(false);
    expect(validateSarif(broken, 'x').join('\n')).toMatch(/absent is not the same as empty/);
  });

  it('fails on a document that is not SARIF 2.1', () => {
    expect(validateSarif({ version: '1.0.0', runs: [] }, 'x').join('\n')).toMatch(/not 2\.1/);
    expect(validateSarif(null, 'x').join('\n')).toMatch(/not a JSON object/);
  });

  it('fails when an expected language produced no SARIF', () => {
    const verdict = evaluate({
      documents: docs(sarif([]), 'javascript-typescript.sarif'),
      baseline: { ...BASE, expectedLanguages: ['javascript-typescript', 'actions'] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/no SARIF for actions/);
  });

  it('accepts the filename CodeQL actually writes for a multi-part pack', () => {
    // Analysing `javascript-typescript` produces `javascript.sarif` — the file
    // is named after the LANGUAGE, not the pack. An exact-substring match
    // reported "no SARIF for javascript-typescript" on the hosted runner while
    // the document was sitting right there. This gate's first real finding was
    // in this gate.
    const verdict = evaluate({
      documents: docs(sarif([]), 'sarif-results/javascript.sarif'),
      languages: ['javascript-typescript'],
      baseline: BASE,
    });
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('still fails when the language genuinely produced nothing', () => {
    const verdict = evaluate({
      documents: docs(sarif([]), 'sarif-results/javascript.sarif'),
      languages: ['actions'],
      baseline: BASE,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/no SARIF for actions/);
  });

  it('lets the caller name its own language, overriding the baseline list', () => {
    // Each matrix leg only has its own SARIF, so a baseline-wide list would fail
    // every leg for the language it is not running.
    const verdict = evaluate({
      documents: docs(sarif([]), 'sarif-results/actions.sarif'),
      languages: ['actions'],
      baseline: { ...BASE, expectedLanguages: ['javascript-typescript', 'actions'] },
    });
    expect(verdict.ok).toBe(true);
  });

  it('fails when the analysis reported zero files', () => {
    const verdict = evaluate({
      documents: docs(sarif([])),
      baseline: BASE,
      filesAnalysed: 0,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/empty scan is not a clean scan/);
  });

  it('passes a genuinely clean analysis, so the gate is not merely a refuser', () => {
    const verdict = evaluate({ documents: docs(sarif([])), baseline: BASE, filesAnalysed: 400 });
    expect(verdict.ok).toBe(true);
    expect(verdict.decision).toBe('Go');
    expect(verdict.counts.total).toBe(0);
  });
});

describe('blocking severities', () => {
  it('fails on an unresolved application High', () => {
    const verdict = evaluate({
      documents: docs(
        sarif([result('js/remote-property-injection', 'src/server/http/validation.ts')])
      ),
      baseline: BASE,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/unresolved HIGH/);
    expect(verdict.counts.application).toBe(1);
  });

  it('fails on an unresolved tooling High too — "CI only" is not a disposition', () => {
    const verdict = evaluate({
      documents: docs(sarif([result('js/file-system-race', 'scripts/check-encoding.mjs')])),
      baseline: BASE,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.counts.tooling).toBe(1);
  });

  it('does not block a warning-level quality finding', () => {
    const verdict = evaluate({
      documents: docs(sarif([result('js/template-syntax-in-string-literal', 'tests/x.test.ts')])),
      baseline: BASE,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.counts.bySeverity.warning).toBe(1);
  });

  it('maps security-severity scores to the right bands', () => {
    expect(severityOf({ properties: { 'security-severity': '9.1' } }, {}).level).toBe('critical');
    expect(severityOf({ properties: { 'security-severity': '7.0' } }, {}).level).toBe('high');
    expect(severityOf({ properties: { 'security-severity': '4.0' } }, {}).level).toBe('medium');
    expect(severityOf({ properties: { 'security-severity': '1.0' } }, {}).level).toBe('low');
  });
});

describe('dismissal governance', () => {
  const finding = result('js/file-system-race', 'scripts/legacy.mjs');
  const good = {
    ruleId: 'js/file-system-race',
    path: 'scripts/legacy.mjs',
    source: 'a repository path from readdirSync',
    sink: 'readFileSync in a try/catch',
    reason: 'no concurrent writer exists in a CI checkout; reproduced by …',
    reviewer: 'platform-owner',
    reviewedOn: '2026-07-29',
    expiresOn: '2099-01-01',
  };

  it('accepts a complete, unexpired, path-exact dismissal', () => {
    const verdict = evaluate({
      documents: docs(sarif([finding])),
      baseline: { ...BASE, dismissals: [good] },
    });
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('refuses a dismissal that covers APPLICATION source', () => {
    const verdict = evaluate({
      documents: docs(sarif([result('js/file-system-race', 'src/server/x.ts')])),
      baseline: { ...BASE, dismissals: [{ ...good, path: 'src/server/x.ts' }] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/covers APPLICATION source/);
  });

  it('refuses an expired dismissal', () => {
    const verdict = evaluate({
      documents: docs(sarif([finding])),
      baseline: { ...BASE, dismissals: [{ ...good, expiresOn: '2026-01-01' }] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/expired on 2026-01-01/);
  });

  it('refuses a dismissal missing any of its required evidence fields', () => {
    for (const field of ['reason', 'reviewer', 'reviewedOn', 'source', 'sink']) {
      const entry: Record<string, unknown> = { ...good };
      delete entry[field];
      const verdict = evaluate({
        documents: docs(sarif([finding])),
        baseline: { ...BASE, dismissals: [entry] },
      });
      expect(verdict.ok, field).toBe(false);
      expect(verdict.failures.join('\n'), field).toContain(`\`${field}\``);
    }
  });

  it('fails when a dismissal matches nothing — the finding moved or was fixed', () => {
    const verdict = evaluate({
      documents: docs(sarif([])),
      baseline: { ...BASE, dismissals: [good] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/matches nothing/);
  });

  // `code-security` is a MATRIX. A leg running the `actions` pack can never emit
  // a `js/…` result, so its silence about a `js/…` dismissal is not evidence the
  // entry is dead. An adversarial reviewer filed exactly this and I refuted it,
  // because their reproduction was against a dirty tree. A flawed reproduction is
  // not a refuted finding, and a hosted run then reded the leg.
  //
  // Scoped by the RULE SET the analysis declares. `run.artifacts` was the first
  // fix and it was wrong: CodeQL listed 17 files for the `actions` leg on a pull
  // request (`diff-informed`) and 712 on the push to `develop` — same leg, same
  // language — so path scoping agreed once by luck and then reproduced the same
  // false failure on a protected branch. Measured on the real SARIFs; both
  // artifact shapes are pinned below.
  const withRules = (
    document: ReturnType<typeof sarif>,
    ruleIds: string[],
    uris: string[] = []
  ) => ({
    ...document,
    runs: document.runs.map((run) => ({
      ...run,
      tool: { driver: { name: 'CodeQL' }, extensions: [{ rules: ruleIds.map((id) => ({ id })) }] },
      artifacts: uris.map((uri) => ({ location: { uri } })),
    })),
  });

  // The 27 `actions` rules are all `actions/…`; none can produce `js/…`.
  const ACTIONS_RULES = [
    'actions/missing-workflow-permissions',
    'actions/unversioned-immutable-action',
  ];

  it('does NOT call a dismissal stale when this pack cannot report that rule', () => {
    const verdict = evaluate({
      documents: docs(withRules(sarif([]), ACTIONS_RULES), 'actions.sarif'),
      baseline: { ...BASE, dismissals: [good] },
    });
    expect(verdict.failures.join('\n')).not.toMatch(/matches nothing/);
    expect(verdict.ok).toBe(true);
    // Silence would be the wrong outcome too — not judging must be visible.
    expect(verdict.warnings.join('\n')).toMatch(/was NOT judged here/);
    expect(verdict.counts.dismissalsOutOfScope).toBe(1);
  });

  it('is NOT fooled by the artifact list — the develop-push shape', () => {
    // THE REGRESSION. On the push to `develop` the `actions` leg listed 712
    // artifacts including 55 `.mjs` files it cannot analyse. Path scoping called
    // the dismissal stale and reded a protected branch. The rule set is identical
    // between the two shapes, so the verdict must be too.
    const verdict = evaluate({
      documents: docs(
        withRules(sarif([]), ACTIONS_RULES, [
          'scripts/legacy.mjs',
          'scripts/ci/check-commit-checks.mjs',
          '.github/workflows/pr-ci.yml',
        ]),
        'actions.sarif'
      ),
      baseline: { ...BASE, dismissals: [good] },
    });
    expect(
      verdict.failures.join('\n'),
      'listing a .mjs artifact does not make the actions pack able to analyse it'
    ).not.toMatch(/matches nothing/);
    expect(verdict.ok).toBe(true);
  });

  it('reads the rule set from tool.driver.rules too, not only from extensions', () => {
    // Real CodeQL puts its rules in `tool.extensions[].rules` — measured at 0
    // driver rules and 27/201 extension rules across three hosted SARIFs. The
    // SARIF spec's primary home is `tool.driver.rules`, so both are read.
    //
    // This case is the one that can tell the difference: if driver rules were
    // ignored the set would be EMPTY, the gate would fall back to judging blind,
    // and it would wrongly report this entry stale — the same failure by another
    // route. A mutation deleting that branch survived the whole suite until this
    // test existed.
    const verdict = evaluate({
      documents: docs(
        {
          version: '2.1.0',
          runs: [
            {
              tool: { driver: { name: 'CodeQL', rules: ACTIONS_RULES.map((id) => ({ id })) } },
              results: [],
            },
          ],
        },
        'actions.sarif'
      ),
      baseline: { ...BASE, dismissals: [good] },
    });
    expect(verdict.failures.join('\n')).not.toMatch(/matches nothing/);
    expect(verdict.warnings.join('\n')).not.toMatch(/no run declared its rule set/);
    expect(verdict.warnings.join('\n')).toMatch(/was NOT judged here/);
    expect(verdict.ok).toBe(true);
  });

  it('STILL calls it stale when this pack OWNS the rule and found nothing', () => {
    // The other half. Scoping must not become a way for a genuinely dead entry
    // to survive: same empty result set, and the only difference is that this
    // analysis could have reported the rule.
    const verdict = evaluate({
      documents: docs(withRules(sarif([]), ['js/file-system-race', 'js/http-to-file-access'])),
      baseline: { ...BASE, dismissals: [good] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/matches nothing/);
  });

  it('judges anyway, and says so, when no run declares a rule set', () => {
    // Old CodeQL, or a hand-built SARIF. Losing the staleness check silently is
    // worse than an occasional false stale report, because the first is
    // invisible — so the gate keeps judging and warns that it is doing so blind.
    const verdict = evaluate({
      documents: docs({
        version: '2.1.0',
        runs: [{ tool: { driver: { name: 'CodeQL' } }, results: [] }],
      }),
      baseline: { ...BASE, dismissals: [good] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/matches nothing/);
    expect(verdict.warnings.join('\n')).toMatch(/no run declared its rule set/);
  });

  it('fails when the dismissed rule appears at a DIFFERENT path', () => {
    const verdict = evaluate({
      documents: docs(
        sarif([finding, result('js/file-system-race', 'scripts/somewhere-else.mjs')])
      ),
      baseline: { ...BASE, dismissals: [good] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/somewhere-else\.mjs/);
    expect(verdict.failures.join('\n')).toMatch(/per-path on purpose/);
  });

  it('treats a GitHub-suppressed result as adjudicated, not as live', () => {
    const suppressed = result('js/file-system-race', 'scripts/legacy.mjs', {
      suppressions: [{ kind: 'external' }],
    });
    const verdict = evaluate({ documents: docs(sarif([suppressed])), baseline: BASE });
    expect(verdict.ok).toBe(true);
    expect(verdict.counts.total).toBe(0);
    expect(verdict.counts.suppressed).toBe(1);
  });
});

describe('the alert-count ratchet', () => {
  const dismissal = (ruleId: string, path: string) => ({
    ruleId,
    path,
    source: 'an authenticated API response',
    sink: 'a file the operator named',
    reason: 'reproduced: the flow is the script’s purpose and the content is sanitised',
    reviewer: 'platform-owner',
    reviewedOn: '2026-07-29',
    expiresOn: '2099-01-01',
  });

  it('fails when the open count rises above the recorded ceiling', () => {
    const verdict = evaluate({
      documents: docs(sarif([result('js/file-system-race', 'scripts/a.mjs')])),
      baseline: { ...BASE, maximumOpenFindings: 0 },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/rose to 1, above the recorded ceiling of 0/);
  });

  it('does not count a dismissed finding as open — it is adjudicated', () => {
    // Otherwise "dismiss it" and "raise the ceiling" would be the same action,
    // which is exactly the laxity the ceiling exists to prevent.
    const verdict = evaluate({
      documents: docs(sarif([result('js/file-system-race', 'scripts/a.mjs')])),
      baseline: {
        ...BASE,
        maximumOpenFindings: 0,
        dismissals: [dismissal('js/file-system-race', 'scripts/a.mjs')],
      },
    });
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.counts.open).toBe(0);
    expect(verdict.counts.dismissed).toBe(1);
    expect(verdict.counts.total).toBe(1);
  });

  it('validates a dismissal at ANY severity, not only blocking ones', () => {
    // A medium-severity dismissal used to skip its own evidence checks and was
    // never marked used — so it was then reported as matching nothing while
    // sitting on a real finding.
    const incomplete = { ...dismissal('js/file-system-race', 'scripts/a.mjs') } as Record<
      string,
      unknown
    >;
    delete incomplete.reviewer;
    const medium = {
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'CodeQL',
              rules: [
                {
                  id: 'js/file-system-race',
                  properties: { 'security-severity': '5.0' },
                },
              ],
            },
          },
          results: [result('js/file-system-race', 'scripts/a.mjs')],
        },
      ],
    };
    const verdict = evaluate({
      documents: docs(medium),
      baseline: { ...BASE, dismissals: [incomplete] },
    });
    expect(verdict.counts.bySeverity.medium).toBe(1);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toContain('`reviewer`');
    expect(verdict.failures.join('\n'), 'and it must NOT also be called stale').not.toMatch(
      /matches nothing/
    );
  });

  it('warns rather than fails when the count falls, so the gain can be locked in', () => {
    const verdict = evaluate({
      documents: docs(sarif([])),
      baseline: { ...BASE, maximumOpenFindings: 3 },
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.join('\n')).toMatch(/lower the ceiling/);
  });
});

describe('path classification', () => {
  it('separates application source from tooling', () => {
    expect(isApplicationPath('src/server/http/validation.ts')).toBe(true);
    expect(isApplicationPath('scripts/ci/x.mjs')).toBe(false);
    expect(isApplicationPath('tests/foundation/x.test.ts')).toBe(false);
  });

  it('normalises SARIF artifact URIs', () => {
    expect(normalisePath('file:///src/a.ts')).toBe('src/a.ts');
    expect(normalisePath('src\\a.ts')).toBe('src/a.ts');
    expect(normalisePath(undefined)).toBe('');
  });

  it('extracts rule, severity, path and line together', () => {
    const [finding] = extractFindings(
      docs(sarif([result('js/remote-property-injection', 'src/a.ts')]))
    );
    expect(finding).toMatchObject({
      ruleId: 'js/remote-property-injection',
      severity: 'high',
      path: 'src/a.ts',
      startLine: 10,
      scope: 'application',
      precision: 'high',
    });
  });

  it('renders a report that states the counts it is claiming', () => {
    const verdict = evaluate({ documents: docs(sarif([])), baseline: BASE });
    const markdown = toMarkdown(verdict);
    expect(markdown).toContain('CodeQL policy: Go');
    expect(markdown).toContain('| Open findings | 0 |');
    expect(markdown).toContain('| Tools | CodeQL |');
  });
});

/**
 * The other half of AR-52: a listing that only sees Actions is the listing that
 * missed the red check for five commits.
 */
describe('commit check-run enumeration', () => {
  const check = (name: string, conclusion: string | null, app = 'github-actions') => ({
    name,
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    app: { slug: app },
    output: { title: null },
    html_url: null,
  });

  it('passes when every check completed acceptably', () => {
    const verdict = evaluateChecks([
      check('ci-gate', 'success'),
      check('CodeQL', 'success', 'github-advanced-security'),
    ]);
    expect(verdict.ok).toBe(true);
  });

  it('FAILS on a red check produced by an app other than Actions — the AR-52 case', () => {
    const verdict = evaluateChecks([
      check('ci-gate', 'success'),
      check('unit-tests-coverage / unit-coverage', 'success'),
      check('CodeQL', 'failure', 'github-advanced-security'),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/`CodeQL` concluded `failure`/);
    expect(verdict.failures.join('\n')).toMatch(/github-advanced-security/);
  });

  it('fails on a check still running — a merge now is a merge without it', () => {
    const verdict = evaluateChecks([check('ci-gate', null)]);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/is in_progress, not completed/);
  });

  it('fails on an empty check list, because nothing judged the commit', () => {
    const verdict = evaluateChecks([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/ZERO check-runs/);
  });

  it('fails when a REQUIRED check is absent entirely (CSA-06)', () => {
    const verdict = evaluateChecks([check('ci-gate', 'success')], { required: ['CodeQL'] });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/`CodeQL` is absent from the commit entirely/);
  });

  it('accepts skipped and neutral, which are real outcomes', () => {
    expect(evaluateChecks([check('a', 'skipped'), check('b', 'neutral')]).ok).toBe(true);
  });

  it('bounds a check name that arrived over HTTP before it reaches a report', () => {
    // `js/http-to-file-access`, found by this repository's own new gate on its
    // very first hosted run: GitHub API strings were written into a build
    // artifact unbounded and unsanitised. Not a claim that GitHub is hostile —
    // a report should be a report whatever the API returns.
    expect(safeText('a|b'), 'a pipe would break out of its table cell').toBe('a\\|b');
    expect(safeText('x'.repeat(300), 20)).toHaveLength(21);
    expect(safeText(null)).toBe('');
    expect(safeText(undefined)).toBe('');

    const withEscape = safeText(`a${String.fromCharCode(27)}[31mred${String.fromCharCode(0)}b`);
    expect(withEscape, 'no control character may survive').not.toMatch(/[\u0000-\u001f]/);
    expect(withEscape).toContain('red');
  });

  it('escapes the backslash BEFORE the pipe, which is the whole defect', () => {
    // `js/incomplete-sanitization`, HIGH — reported against the FIX for the
    // finding above. Escaping `|` without escaping `\` first turns the input
    // `\|` into `\\|`: an escaped backslash followed by a LIVE cell separator,
    // so the escaper hands back exactly the injection it was added to prevent.
    //
    // The `a|b` assertion above cannot see this. Both orderings map `a|b` to
    // `a\|b`, so it passes against the defect — a hostile mutation dropping the
    // backslash rule survived the entire suite, which is how this test came to
    // exist. An input containing BOTH characters is the only one that
    // distinguishes them.
    expect(safeText('evil\\|name')).toBe('evil\\\\\\|name');

    // Stated as the property as well as the string, because the property is
    // what matters: after escaping, every `|` must be preceded by an ODD number
    // of backslashes — an even number means the last one is itself escaped and
    // the pipe still separates cells once Markdown consumes them.
    const escaped = safeText('a\\|b\\\\|c|d');
    for (let index = 0; index < escaped.length; index += 1) {
      if (escaped[index] !== '|') continue;
      let backslashes = 0;
      for (let back = index - 1; back >= 0 && escaped[back] === '\\'; back -= 1) backslashes += 1;
      expect(backslashes % 2, `the pipe at ${index} of \`${escaped}\` is still live`).toBe(1);
    }
  });

  it('sanitises through the real evaluate path, not only in isolation', () => {
    const hostile = [
      {
        name: `evil${String.fromCharCode(27)}[31m|name`,
        status: 'completed',
        conclusion: 'success',
        app: { slug: 'github-actions' },
        output: { title: null },
        html_url: null,
      },
    ];
    const verdict = evaluateChecks(hostile);
    expect(verdict.checks[0]?.name).not.toMatch(/[\u0000-\u001f]/);
    expect(verdict.checks[0]?.name).toContain('\\|');
  });

  it('reports how many checks came from apps other than Actions', () => {
    const verdict = evaluateChecks([
      check('ci-gate', 'success'),
      check('CodeQL', 'success', 'github-advanced-security'),
    ]);
    expect(verdict.nonActions).toHaveLength(1);
    const markdown = checksMarkdown(verdict, 'abc1234def');
    expect(markdown).toContain('other than GitHub Actions: **1**');
    expect(markdown).toContain('Commit checks: Go');
  });

  it('warns when everything came from Actions, rather than assuming that is complete', () => {
    const verdict = evaluateChecks([check('ci-gate', 'success')]);
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.join('\n')).toMatch(/AR-52 was a check from another app/);
  });
});
