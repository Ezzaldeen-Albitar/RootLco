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
  const files = report.numTotalTestSuites ?? report.testResults?.length ?? 0;

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

export function verdict(summary, minTests) {
  const problems = [];
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
  if (typeof minTests === 'number' && minTests > 0 && summary.total < minTests) {
    problems.push(
      `\`${summary.label}\` ran ${summary.total} tests but at least ${minTests} were expected. ` +
        'A suite that shrinks without explanation is a silently disabled suite.'
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
  let minTests = arg('--min-tests') ? Number(arg('--min-tests')) : undefined;
  if (minTests === undefined) {
    const baselinePath =
      arg('--counts') ?? join('.github', 'ci-baselines', 'test-count-baseline.json');
    if (existsSync(baselinePath)) {
      try {
        const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
        const tier = baseline.tiers?.[label];
        if (tier && typeof tier.minTests === 'number') minTests = tier.minTests;
      } catch (error) {
        console.error(
          `::error::test-count baseline at ${baselinePath} does not parse: ${error.message}`
        );
        process.exit(2);
      }
    }
  }
  if (minTests === undefined) {
    console.log(
      `::warning::no minimum test count is recorded for tier \`${label}\`, so a shrinking suite would not be detected. Add it to .github/ci-baselines/test-count-baseline.json.`
    );
  }

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
