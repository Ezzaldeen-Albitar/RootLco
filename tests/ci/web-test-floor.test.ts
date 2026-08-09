import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

interface Tier {
  readonly minTests: number;
  readonly measured: number;
  readonly note: string;
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

  it('refuses the shape the floor exists for — a whole test file deleted', () => {
    // The largest web test file carries 41 cases. This is the property the
    // baseline note claims, stated as a bound rather than as a slogan: any
    // deletion of MORE than the headroom trips the floor.
    const headroom = web.measured - web.minTests;
    expect(verdict(summaryOf({ passed: web.measured - headroom }), web.minTests)).toEqual([]);
    expect(
      verdict(summaryOf({ passed: web.measured - headroom - 1 }), web.minTests).length
    ).toBeGreaterThan(0);
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
    expect(web.note).toContain('#214');
    expect(web.note).toContain('31311573993');
    expect(web.measured).toBeGreaterThan(web.minTests);
  });
});
