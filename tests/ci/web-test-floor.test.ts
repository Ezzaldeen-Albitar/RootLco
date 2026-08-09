import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verdict } from '../../scripts/ci/summarise-vitest.mjs';

/**
 * The web tier's anti-shrink floor, driven through the code that enforces it.
 *
 * ## Why this file exists
 *
 * `summarise-vitest.mjs` fails a tier that runs fewer tests than its recorded
 * floor. `web` had no floor for the whole of P1-27, so the guard was dormant:
 * every hosted run printed
 *
 *   "no minimum test count is recorded for tier `web`, so a shrinking suite
 *    would not be detected"
 *
 * as an annotation, and the check went green regardless. The tier that grew from
 * 39 test files to 65 during this phase was the one tier nothing was watching.
 *
 * `baseline-integrity.test.ts` asserts the floor EXISTS and is sanely placed.
 * This file asserts it BITES — that the number in the baseline actually changes
 * what `verdict()` returns, in both directions. A floor that is recorded and not
 * enforced is the same as no floor, and looks better.
 *
 * ## Driven from the committed baseline, never a literal
 *
 * Every case reads `minTests` out of the real file. Hard-coding 1180 here would
 * make this pass against a baseline that had been edited to 1 — the test would
 * be asserting its own copy of the number rather than the one CI uses.
 */

const BASELINE = join(process.cwd(), '.github', 'ci-baselines', 'test-count-baseline.json');

interface Tier {
  readonly minTests: number;
  readonly measured: number;
  readonly measuredFiles: number;
  readonly note: string;
}

function tier(label: string): Tier {
  const parsed = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
    tiers: Record<string, Tier>;
  };
  const entry = parsed.tiers[label];
  expect(entry, `the ${label} tier has no baseline entry`).toBeDefined();
  return entry as Tier;
}

/** A summary in the shape `summarise-vitest.mjs` builds from the vitest report. */
function summary(total: number, overrides: Record<string, unknown> = {}) {
  return {
    label: 'web',
    files: 65,
    total,
    passed: total,
    failed: 0,
    pending: 0,
    todo: 0,
    success: true,
    ...overrides,
  };
}

describe('the web tier floor is enforced, not merely recorded', () => {
  const web = tier('web');

  it('accepts a run at the floor', () => {
    expect(verdict(summary(web.minTests), web.minTests)).toEqual([]);
  });

  it('accepts the run that established it', () => {
    // 1216, measured on the hosted runner at cc77255. If the floor were ever
    // raised above its own provenance this case would fail, which is the
    // arithmetic `baseline-integrity` asserts stated as behaviour.
    expect(verdict(summary(web.measured), web.minTests)).toEqual([]);
  });

  it('REFUSES a run one test below the floor', () => {
    const problems = verdict(summary(web.minTests - 1), web.minTests);
    expect(problems.length, 'a shrinking web suite passed the guard').toBe(1);
    expect(problems[0]).toContain(`at least ${web.minTests} were expected`);
    expect(problems[0]).toContain('silently disabled suite');
  });

  it('REFUSES the shape the floor exists for — a whole test file deleted', () => {
    /*
     * The largest web test file carries 41 cases; the floor leaves 36 of
     * headroom precisely so that losing one cannot slip through. This is the
     * scenario `unitFloorCaveat` describes as the failure of a too-loose floor.
     */
    const afterDeletingTheLargestFile = web.measured - 41;
    expect(
      verdict(summary(afterDeletingTheLargestFile), web.minTests).length,
      'deleting the largest web test file did not trip the floor'
    ).toBe(1);
  });

  it('still refuses an empty run, which no floor can express', () => {
    // `total === 0` is caught by its own rule, because a floor of 1180 would
    // report "ran 0, expected 1180" and hide that the run never happened.
    const problems = verdict(summary(0, { passed: 0 }), web.minTests);
    expect(problems.some((p: string) => p.includes('reported zero tests'))).toBe(true);
  });

  it('is dormant when no floor is recorded — the state web was in', () => {
    /*
     * The regression this file guards. With `minTests` undefined, `verdict()`
     * returns NO problems for a suite that has collapsed to three tests. That is
     * not a bug in `verdict` — it is why the baseline entry is mandatory, and
     * why `baseline-integrity.test.ts` now derives the summarised labels from the
     * workflow rather than trusting anyone to remember.
     */
    expect(verdict(summary(3), undefined)).toEqual([]);
  });

  it('records where the number came from, in enough detail to re-derive it', () => {
    // Provenance is the difference between a measurement and a guess. The note
    // must name the PR, the run and the head, because a floor whose origin is
    // unknown cannot be raised or lowered with any confidence later.
    expect(web.note).toContain('#214');
    expect(web.note).toContain('31311573993');
    expect(web.note).toContain('cc77255d7343a6691077b4574d4491e05615ed95');
    expect(web.measured).toBeGreaterThan(web.minTests);
  });
});
