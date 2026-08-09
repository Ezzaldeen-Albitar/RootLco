#!/usr/bin/env node
/**
 * Vitest result summariser and honesty check (CSA-15, initiative §35).
 *
 * "Test count reported without checking exit status" is the first item on the
 * test-honesty list, and it is exactly what happened in P1-21: a suite was red
 * at every commit and reported green because the number in the summary came from
 * a different place than the pass/fail decision.
 *
 * This script therefore derives its verdict from the SAME document it derives
 * the counts from, and refuses three specific ways of being lied to:
 *
 *   - a report with zero tests (an empty suite passes);
 *   - a report with failures (whatever the surrounding shell decided);
 *   - a report that does not parse (absence of evidence is not success).
 *
 * It also surfaces the slowest tests, which is the raw material for the flaky
 * and performance conversations later.
 *
 * Usage:
 *   node scripts/ci/summarise-vitest.mjs --input vitest-unit.json --label unit \
 *     [--min-tests 900] [--json out.json] [--markdown out.md]
 *
 * Exit codes: 0 pass · 1 the report itself says something is wrong · 2 IO error.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Flattens the vitest JSON reporter shape into a stable summary. */
export function summarise(report, label) {
  const total = report.numTotalTests ?? 0;
  const passed = report.numPassedTests ?? 0;
  const failed = report.numFailedTests ?? 0;
  const pending = report.numPendingTests ?? 0;
  const todo = report.numTodoTests ?? 0;
  /*
   * `files` must be FILES. It preferred `numTotalTestSuites`, which vitest sets
   * to `getSuites(files).length` — every `describe` block, recursively. The web
   * tier duly reported `files: 379` for a run over 65 test files, and the figure
   * was copied into the baseline as `measuredFiles`. Four tiers recorded a suite
   * count under a name that says files.
   *
   * `testResults` is one entry per test FILE in the vitest JSON reporter, so it
   * is the honest source. Both are published: a reader comparing this artifact
   * against an older one needs to see which number changed meaning.
   */
  const files = report.testResults?.length ?? 0;
  const suites = report.numTotalTestSuites ?? 0;

  const tests = [];
  for (const suite of report.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      tests.push({
        file: suite.name,
        title: assertion.fullName ?? assertion.title,
        status: assertion.status,
        durationMs: assertion.duration ?? 0,
      });
    }
  }
  const slowest = [...tests].sort((a, b) => b.durationMs - a.durationMs).slice(0, 15);
  const failures = tests.filter((t) => t.status === 'failed');
  const skipped = tests.filter(
    (t) => t.status === 'pending' || t.status === 'skipped' || t.status === 'todo'
  );

  return {
    label,
    files,
    total,
    passed,
    failed,
    pending,
    todo,
    durationMs: report.duration ?? null,
    success: report.success === true,
    slowest,
    failures,
    skipped: skipped.map((t) => ({ file: t.file, title: t.title, status: t.status })),
  };
}

/**
 * Tests that actually RAN — the only number the floor may be compared against.
 *
 * `numTotalTests` counts skipped and todo cases: vitest derives all three from
 * one array and then filters. So `it.skip` applied to an entire tier leaves
 * `total` unchanged, `failed` at 0 and `success` true, and a floor placed
 * against `total` is satisfied by a suite in which nothing executed. That is the
 * precise failure this baseline exists to detect, passing the detector.
 *
 * Found by an adversarial review of the commit that introduced the web floor,
 * which demonstrated it in memory: 1216 tests, all skipped, `problems: []`.
 */
export function executed(summary) {
  return summary.total - summary.pending - summary.todo;
}

export function verdict(summary, minTests) {
  const problems = [];
  const ran = executed(summary);
  if (summary.total === 0) {
    problems.push(
      `\`${summary.label}\` reported zero tests. An empty suite passes and proves nothing — ` +
        'either the include glob stopped matching or the run never happened.'
    );
  }
  if (summary.failed > 0) {
    problems.push(`\`${summary.label}\` has ${summary.failed} failing test(s).`);
  }
  if (summary.success !== true && summary.total > 0) {
    problems.push(`\`${summary.label}\` reporter recorded \`success: false\`.`);
  }
  if (summary.total > 0 && ran === 0) {
    problems.push(
      `\`${summary.label}\` reported ${summary.total} tests and executed none of them — ` +
        'every case is skipped or todo. A suite that runs nothing passes everything.'
    );
  }
  if (typeof minTests === 'number' && minTests > 0 && ran < minTests) {
    const skipped = summary.pending + summary.todo;
    problems.push(
      `\`${summary.label}\` EXECUTED ${ran} tests but at least ${minTests} were expected` +
        (skipped > 0 ? ` (${summary.total} collected, ${skipped} skipped or todo)` : '') +
        '. A suite that shrinks without explanation is a silently disabled suite.'
    );
  }
  return problems;
}

export function toMarkdown(summary, problems) {
  const lines = [`### Tests — ${summary.label}`, ''];
  lines.push('| Measure | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Files | ${summary.files} |`);
  lines.push(`| Tests | ${summary.total} |`);
  lines.push(`| Passed | ${summary.passed} |`);
  lines.push(`| Failed | ${summary.failed} |`);
  lines.push(`| Skipped / todo | ${summary.pending + summary.todo} |`);
  if (summary.durationMs) lines.push(`| Duration | ${(summary.durationMs / 1000).toFixed(1)} s |`);
  lines.push('');
  if (summary.skipped.length) {
    lines.push(`<details><summary>Skipped tests (${summary.skipped.length})</summary>`);
    lines.push('');
    for (const t of summary.skipped.slice(0, 40)) lines.push(`- \`${t.status}\` ${t.title}`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (summary.slowest.length) {
    lines.push('<details><summary>Slowest tests</summary>');
    lines.push('');
    lines.push('| ms | Test |');
    lines.push('| --- | --- |');
    for (const t of summary.slowest) lines.push(`| ${Math.round(t.durationMs)} | ${t.title} |`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (summary.failures.length) {
    lines.push('**Failures**');
    lines.push('');
    for (const f of summary.failures.slice(0, 40)) lines.push(`- ❌ ${f.title}`);
    lines.push('');
  }
  if (problems.length) {
    lines.push('**Honesty checks failed**');
    lines.push('');
    for (const p of problems) lines.push(`- ❌ ${p}`);
  }
  return lines.join('\n');
}

/** Labels this repository summarises. Every one must carry a committed floor. */
export const FLOORED_TIERS = ['unit', 'web', 'database', 'backend'];

/**
 * Resolve the floor for a tier — the step between the baseline and `verdict()`.
 *
 * Exported because it was the ONLY unreachable code on the enforcement path.
 * `verdict()` was well covered while this lived inside `main()`, which nothing
 * imports, so an adversarial review could rename `baseline.tiers` to
 * `baseline.tier`, watch the floor go dormant with a warning, and see all
 * twenty-one tests still pass. A guard whose lookup is untested is a guard whose
 * lookup nobody has ever checked.
 *
 * Returns `{ minTests, source, problem }`. `problem` is fatal — the caller exits
 * 2 — because every failure here is FAIL-OPEN if merely warned about: a wrong
 * cwd, a moved baseline, a renamed label and a typo in the lookup all end in
 * "no floor recorded", which reads as an annotation nobody must act on.
 */
export function resolveFloor(label, { minTestsArg, baselinePath, exists, read } = {}) {
  const fileExists = exists ?? existsSync;
  const readFile = read ?? ((p) => readFileSync(p, 'utf8'));

  if (minTestsArg !== undefined && minTestsArg !== null && `${minTestsArg}` !== '') {
    const explicit = Number(minTestsArg);
    if (!Number.isFinite(explicit)) {
      return { problem: `--min-tests ${minTestsArg} is not a number` };
    }
    return { minTests: explicit, source: '--min-tests' };
  }

  const path = baselinePath ?? join('.github', 'ci-baselines', 'test-count-baseline.json');
  if (!fileExists(path)) {
    return {
      problem:
        `the test-count baseline was not found at ${path}. It is resolved relative to the ` +
        'working directory, so this usually means the step ran from the wrong one — which ' +
        'silently disarms the anti-shrink floor for every tier.',
    };
  }

  let baseline;
  try {
    baseline = JSON.parse(readFile(path));
  } catch (error) {
    return { problem: `test-count baseline at ${path} does not parse: ${error.message}` };
  }

  const tier = baseline.tiers?.[label];
  if (!tier || typeof tier.minTests !== 'number') {
    const known = Object.keys(baseline.tiers ?? {}).join(', ') || '(none)';
    if (FLOORED_TIERS.includes(label)) {
      return {
        problem:
          `tier \`${label}\` has no \`minTests\` in ${path}, but it is one of the tiers this ` +
          `repository floors. Known tiers: ${known}. Refusing to run the tier unguarded.`,
      };
    }
    // An ad-hoc label a developer invented locally. Say so, and keep going —
    // this is the one case where no floor is the honest answer rather than a
    // broken lookup, because `baseline-integrity.test.ts` derives the tiers CI
    // actually summarises and requires each of them to be floored.
    return { source: `no floor recorded for ad-hoc tier \`${label}\`` };
  }
  return { minTests: tier.minTests, source: path };
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const input = arg('--input');
  const label = arg('--label') ?? 'tests';
  if (!input || !existsSync(input)) {
    console.error(
      `vitest report not found at ${input}. The suite produced no evidence — treating as failure.`
    );
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(input, 'utf8'));
  } catch (error) {
    console.error(`vitest report at ${input} does not parse: ${error.message}`);
    process.exit(2);
  }

  const summary = summarise(report, label);

  // The floor comes from a committed baseline unless overridden. Leaving
  // `--min-tests` implemented but never passed made the anti-shrink guard
  // dormant: a broken include glob would drop the tier to a handful of tests
  // and every other check would still pass.
  const floor = resolveFloor(label, {
    minTestsArg: arg('--min-tests'),
    baselinePath: arg('--counts'),
  });
  if (floor.problem) {
    // Exit 2, not a warning. Every way this resolution can fail ends in "no
    // floor", and a warning about no floor is indistinguishable from a green run.
    console.error(`::error::${floor.problem}`);
    process.exit(2);
  }
  const minTests = floor.minTests;
  if (minTests === undefined) console.log(`::warning::${floor.source}`);

  const problems = verdict(summary, minTests);

  const md = toMarkdown(summary, problems);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${md}\n`);
  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ ...summary, problems }, null, 2)}\n`);
  console.log(md);
  process.exit(problems.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
