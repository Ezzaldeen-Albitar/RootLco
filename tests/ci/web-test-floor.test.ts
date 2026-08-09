import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  verdict,
  summarise,
  executed,
  resolveFloor,
  FLOORED_TIERS,
} from '../../scripts/ci/summarise-vitest.mjs';

/**
 * The web tier's anti-shrink floor, driven through the code that enforces it.
 *
 * ## Why this file exists
 *
 * `summarise-vitest.mjs` fails a tier that runs fewer tests than its recorded
 * floor. `web` had no floor for the whole of P1-27, so the guard was dormant:
 * every hosted run printed "no minimum test count is recorded for tier `web`"
 * as an annotation and the check went green regardless.
 *
 * ## The first version of this file was refuted, and the refutation is the point
 *
 * It drove `verdict()` with a synthetic summary and proved the comparison
 * worked. An adversarial review then demonstrated three ways the floor did not
 * bite anyway, none of which this file could see:
 *
 *   1. **`numTotalTests` counts skipped tests.** `it.skip` across the whole tier
 *      leaves `total` at 1216, `failed` 0 and `success` true. The floor was
 *      satisfied by a suite that executed nothing.
 *   2. **The lookup had no coverage at all.** It lived inside `main()`, which
 *      nothing imports. Renaming `baseline.tiers` to `baseline.tier` disarmed the
 *      floor and every test still passed.
 *   3. **Fail-open.** An unresolvable baseline warned and exited 0, so a wrong
 *      working directory silently disarmed every tier.
 *
 * So this file now covers the whole path — `summarise` → `executed` →
 * `resolveFloor` → `verdict` — rather than the one function that was easy to
 * call.
 *
 * ## Driven from the committed baseline, never a literal
 *
 * Every case reads `minTests` out of the real file. Hard-coding it here would
 * make this pass against a baseline edited to 1 — the test would be asserting
 * its own copy of the number rather than the one CI uses.
 */

const BASELINE = join(process.cwd(), '.github', 'ci-baselines', 'test-count-baseline.json');
const WEB_TESTS = join(process.cwd(), 'apps', 'web', 'tests');

interface Tier {
  readonly minTests: number;
  readonly measured: number;
  readonly measuredFiles?: number;
  readonly note: string;
  readonly whatTheHeadroomGuarantees?: string;
}

/**
 * Test cases the web tier DECLARES on disk, per file.
 *
 * ## Why a static count, and what it is and is not
 *
 * `WTF-08`: every committed assertion about the web floor was satisfied by
 * lowering `minTests` and `measured` together, because the whole chain — this
 * file, `baseline-integrity.test.ts`, the baseline's own notes — compared the
 * two numbers against each other and against prose. The anchor terminated in a
 * hand-written figure. Nothing in the repository could say the floor was too
 * low, because nothing in the repository knew how big the suite was.
 *
 * This does. It counts `it(` / `test(` declarations in the real test files, so
 * the floor is finally compared against the thing it is a floor for.
 *
 * It is deliberately a LOWER BOUND: `it.each([...])` is one declaration and many
 * cases, so the real collected count is always at least this. Every assertion
 * below is written in the direction a lower bound can support.
 */
function webCasesPerFile(): { file: string; cases: number }[] {
  const DECLARATION =
    /(?:^|[\s;{(])(?:it|test)(?:\.(?:each|concurrent|sequential|skip|todo|fails|only))*\s*[(`]/g;
  const out: { file: string; cases: number }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.test\.tsx?$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8');
        out.push({ file: path, cases: (source.match(DECLARATION) ?? []).length });
      }
    }
  };
  walk(WEB_TESTS);
  return out;
}

function tier(label: string): Tier {
  const parsed = JSON.parse(readFileSync(BASELINE, 'utf8')) as { tiers: Record<string, Tier> };
  const entry = parsed.tiers[label];
  expect(entry, `the ${label} tier has no baseline entry`).toBeDefined();
  return entry as Tier;
}

/**
 * A summary in the shape `summarise()` produces — built BY `summarise()` from a
 * synthetic vitest report, not hand-written, so the fields and their meanings
 * cannot drift apart from the real thing.
 */
function report({
  files = 65,
  passed = 0,
  skipped = 0,
  todo = 0,
  failed = 0,
  suitesPerFile = 1,
}: {
  files?: number;
  passed?: number;
  skipped?: number;
  todo?: number;
  failed?: number;
  suitesPerFile?: number;
}) {
  const total = passed + skipped + todo + failed;
  const perFile = Math.max(1, Math.ceil(total / Math.max(1, files)));
  const testResults = Array.from({ length: files }, (_, f) => ({
    name: `/repo/apps/web/tests/file-${f}.test.ts`,
    assertionResults: Array.from({ length: perFile }, (_, i) => ({
      title: `case ${f}-${i}`,
      status: 'passed',
      duration: 1,
    })),
  }));
  return {
    numTotalTests: total,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: skipped,
    numTodoTests: todo,
    numTotalTestSuites: files * suitesPerFile,
    testResults,
    success: failed === 0,
  };
}

const web = tier('web');
const summaryOf = (o: Parameters<typeof report>[0]) => summarise(report(o), 'web');

describe('the web floor counts tests that RAN, not tests that were collected', () => {
  it('1. accepts a healthy run above the floor', () => {
    expect(verdict(summaryOf({ passed: web.measured }), web.minTests)).toEqual([]);
  });

  it('2. refuses a run one executed test below the floor', () => {
    const problems = verdict(summaryOf({ passed: web.minTests - 1 }), web.minTests);
    expect(problems.length, 'a shrinking web suite passed the guard').toBe(1);
    expect(problems[0]).toContain(`at least ${web.minTests} were expected`);
  });

  it('3. refuses a run COLLECTED above the floor whose EXECUTED count is below it', () => {
    /*
     * The defect that refuted the first version of this file. Collected 1216,
     * executed 100, 1116 skipped: `numTotalTests` is unchanged, `failed` is 0 and
     * `success` is true, so every other rule in `verdict()` is satisfied.
     */
    const summary = summaryOf({ passed: 100, skipped: web.measured - 100 });
    expect(summary.total, 'the collected count must still be above the floor').toBeGreaterThan(
      web.minTests
    );
    expect(executed(summary)).toBe(100);
    const problems = verdict(summary, web.minTests);
    expect(problems.length, 'a suite that skipped its way under the floor passed').toBeGreaterThan(
      0
    );
    expect(problems.join(' ')).toContain('skipped or todo');
  });

  it('4. refuses a run in which every collected test is skipped', () => {
    const summary = summaryOf({ skipped: web.measured });
    expect(summary.total).toBe(web.measured);
    expect(executed(summary)).toBe(0);
    const problems = verdict(summary, web.minTests);
    expect(problems.some((p: string) => p.includes('executed none of them'))).toBe(true);
  });

  it('4b. refuses a run in which every collected test is `todo`', () => {
    const summary = summaryOf({ todo: web.measured });
    expect(executed(summary)).toBe(0);
    expect(verdict(summary, web.minTests).length).toBeGreaterThan(0);
  });

  it('5. still refuses an empty run, which no floor can express', () => {
    const problems = verdict(summaryOf({}), web.minTests);
    expect(problems.some((p: string) => p.includes('reported zero tests'))).toBe(true);
  });

  it('6. fails on failing tests independently of the floor', () => {
    const summary = summaryOf({ passed: web.measured, failed: 3 });
    expect(executed(summary)).toBeGreaterThan(web.minTests);
    const problems = verdict(summary, web.minTests);
    expect(problems.some((p: string) => p.includes('failing test'))).toBe(true);
  });

  it('refuses a net loss of more than the headroom — the bound the baseline states', () => {
    // The bound itself, driven through `verdict()`. This is arithmetic about the
    // two committed numbers and nothing else, which is why it is not sufficient
    // on its own — see the tree-anchored cases below.
    const headroom = web.measured - web.minTests;
    expect(verdict(summaryOf({ passed: web.measured - headroom }), web.minTests)).toEqual([]);
    expect(
      verdict(summaryOf({ passed: web.measured - headroom - 1 }), web.minTests).length
    ).toBeGreaterThan(0);
  });
});

describe('the floor is anchored to the TREE, not to another number in the same file', () => {
  /**
   * `WTF-08` and `WTF-09`, the two defects that made everything above
   * insufficient.
   *
   * `WTF-08`: lowering `minTests` and `measured` together satisfied every
   * committed assertion. `baseline-integrity.test.ts` requires
   * `minTests <= measured` and a headroom ratio; this file reads `minTests` out
   * of the baseline and compares it against itself. Set both to 12 and the whole
   * chain stays green, because the chain terminates in a hand-written number and
   * a paragraph of prose.
   *
   * `WTF-09`: the deleted-file property was asserted against a frozen
   * `measured`, so it decayed. `measured` is refreshed upward whenever a hosted
   * run re-measures the tier; if `minTests` is not raised with it the headroom
   * grows silently, and the "a deleted file trips the floor" reasoning quietly
   * stops holding while every case still passes.
   *
   * Both are fixed the same way: read the suite off disk.
   */
  const perFile = webCasesPerFile();
  const declared = perFile.reduce((n, f) => n + f.cases, 0);
  const largest = perFile.reduce((n, f) => Math.max(n, f.cases), 0);
  const headroom = web.measured - web.minTests;

  it('finds the web tier on disk, so nothing below passes over an empty tree', () => {
    expect(perFile.length, 'no web test files were read').toBeGreaterThan(50);
    expect(declared, 'no test declarations were counted').toBeGreaterThan(500);
    expect(largest, 'no file carries a case').toBeGreaterThan(10);
  });

  it('WTF-08: the floor is at least the number of cases the tree declares', () => {
    /*
     * The anchor. `declared` is a LOWER bound on what any honest run collects —
     * `it.each` is one declaration and many cases — so a floor beneath it is a
     * floor beneath cases that physically exist in the repository right now.
     *
     * This is what lowering `minTests` now fails against: the number on the
     * other side of the comparison is the suite itself.
     */
    expect(
      web.minTests,
      `apps/web/tests declares ${declared} test cases; a floor of ${web.minTests} sits below ` +
        'cases that exist on disk. Raise `minTests` (and re-measure `measured`) in the commit ' +
        'that added them — see `howToRaise` in the baseline.'
    ).toBeGreaterThanOrEqual(declared);
  });

  it('WTF-09: the headroom never grows past the largest file in the tree', () => {
    /*
     * The decay this closes: `measured` moves up with each hosted re-measurement
     * and `minTests` does not have to move with it. Nothing compared the gap
     * against anything real, so the headroom could widen until a whole test file
     * fitted inside it — at which point the floor detects no file deletion at
     * all, while the baseline goes on describing a bound it no longer has.
     *
     * `largest` is recomputed from disk on every run, so this cannot go stale.
     */
    const biggest = perFile.reduce((a, b) => (b.cases > a.cases ? b : a));
    expect(
      headroom,
      `the floor absorbs ${headroom} lost tests while the largest web test file ` +
        `(${biggest.file}) declares only ${largest}. A whole file now fits inside the headroom, ` +
        'so deleting it would not trip the floor. Raise `minTests`.'
    ).toBeLessThanOrEqual(largest);
  });

  it('WTF-09: the stated guarantee is the arithmetic, not a remembered number', () => {
    // The sentence and the numbers drifted apart once already — the note claimed
    // a deleted-file guarantee the arithmetic did not support. Deriving the
    // figure from `measured - minTests` means the prose cannot be edited alone.
    expect(web.whatTheHeadroomGuarantees, 'the web tier states no guarantee').toBeTruthy();
    expect(
      web.whatTheHeadroomGuarantees,
      `the guarantee must name ${headroom}, which is measured (${web.measured}) minus the floor (${web.minTests})`
    ).toContain(`NET LOSS OF MORE THAN ${headroom} EXECUTED TESTS`);
  });

  it('WTF-09: the tier has not lost a file since the measurement was taken', () => {
    /*
     * `measuredFiles` is provenance — what the named hosted run observed. It is
     * not re-derivable locally, so it is not asserted equal to the tree. What IS
     * derivable is the direction: the suite must not have shrunk below the file
     * count the floor was established against.
     */
    expect(web.measuredFiles, 'the web tier records no measured file count').toBeTypeOf('number');
    expect(
      perFile.length,
      `the tier held ${web.measuredFiles} test files when the floor was set and holds ` +
        `${perFile.length} now — a test file was deleted`
    ).toBeGreaterThanOrEqual(web.measuredFiles as number);
  });
});

describe('`files` means test files, and `suites` means `describe` blocks', () => {
  it('counts ONE file as one file however many describe blocks it holds', () => {
    /*
     * The exact defect: `files` preferred `numTotalTestSuites`, which vitest sets
     * to every `describe` recursively. The web tier reported `files: 379` for a
     * run over 65 test files, and that figure was copied into the baseline under
     * the name `measuredFiles`.
     */
    const summary = summarise(report({ files: 1, passed: 12, suitesPerFile: 9 }), 'web');
    expect(summary.files, 'a describe block is not a file').toBe(1);
    expect(summary.suites, 'the suite count is still published, under its own name').toBe(9);
  });

  it('publishes both numbers, so an older artifact can be compared honestly', () => {
    const summary = summaryOf({ passed: 10, suitesPerFile: 3 });
    expect(summary.files).toBe(65);
    expect(summary.suites).toBe(195);
    expect(summary.executed).toBe(10);
  });
});

describe('the floor LOOKUP is covered, because it was the only unreachable step', () => {
  it('resolves the committed floor for the web tier', () => {
    const resolved = resolveFloor('web', { baselinePath: BASELINE });
    expect(resolved.problem).toBeUndefined();
    expect(resolved.minTests).toBe(web.minTests);
  });

  it('FAILS CLOSED when the baseline cannot be found, rather than warning', () => {
    // A wrong working directory, a moved file and a renamed step all arrive here.
    // Every one of them used to produce "no floor recorded" and exit 0.
    const resolved = resolveFloor('web', { baselinePath: 'nowhere/test-counts.json' });
    expect(resolved.minTests).toBeUndefined();
    expect(resolved.problem, 'a missing baseline must be fatal').toMatch(/was not found/);
  });

  it('FAILS CLOSED when a floored tier has no entry — the rename attack', () => {
    /*
     * The adversarial demonstration: change `baseline.tiers` to `baseline.tier`
     * and the floor goes dormant with a warning while every test passes. Driven
     * here through a baseline whose `tiers` key is misspelled.
     */
    const resolved = resolveFloor('web', {
      baselinePath: BASELINE,
      exists: () => true,
      read: () => JSON.stringify({ tier: { web: { minTests: 1180 } } }),
    });
    expect(resolved.minTests).toBeUndefined();
    expect(resolved.problem).toMatch(/no `minTests`/);
    expect(resolved.problem).toMatch(/Refusing to run the tier unguarded/);
  });

  it('names every tier this repository floors, and each carries an entry', () => {
    const parsed = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
      tiers: Record<string, Tier | undefined>;
    };
    for (const label of FLOORED_TIERS) {
      expect(parsed.tiers[label], `${label} is declared floored and has no entry`).toBeDefined();
      expect(resolveFloor(label, { baselinePath: BASELINE }).minTests).toBeTypeOf('number');
    }
  });

  it('records where the number came from, in enough detail to re-derive it', () => {
    /*
     * The run id is matched as a SHAPE, not as a literal.
     *
     * This case used to assert `toContain('31311573993')`, which pinned the note
     * to the one run that established the floor. That reads as strictness and is
     * the opposite: the moment the tier is honestly re-measured on a different
     * hosted run, the note must either keep naming a superseded run or the test
     * has to be edited to let the truth through. A check that an honest update
     * has to defeat is a check that teaches people to defeat checks — and this
     * phase has spent five rounds on exactly that failure mode.
     *
     * What actually needs proving is that the number is TRACEABLE: the note
     * names the pull request and at least one runnable GitHub Actions run id.
     * A run id is 10-12 digits, which no other figure in this note resembles.
     */
    expect(web.note, 'the note names no pull request').toMatch(/#\d+/);
    expect(web.note, 'the note names no GitHub Actions run id').toMatch(/\b\d{10,12}\b/);
    expect(web.measured).toBeGreaterThan(web.minTests);
  });

  it('says plainly when the recorded measurement is local rather than hosted', () => {
    /*
     * `measured` is provenance, and provenance that quietly changes meaning is
     * worth less than none. A figure taken in a working checkout is not the same
     * evidence as one taken by a named hosted run, so the entry has to say which
     * it is rather than letting the reader assume the stricter one.
     */
    const provenance = (web as { measurementProvenance?: string }).measurementProvenance;
    if (provenance === undefined) return;
    expect(provenance, 'a local measurement must say so unambiguously').toMatch(/\bLOCAL\b/);
    expect(provenance, 'a local measurement must name what replaces it').toMatch(/QA-005|hosted/i);
  });
});
