#!/usr/bin/env node
/**
 * Performance regression budget (initiative §27).
 *
 * `scripts/db/perf-baseline.mjs` already measures the tenant-leading indexed
 * query families — median, p95, p99, and the actual plan from EXPLAIN. What it
 * never had was somewhere to compare against.
 *
 * Measure first, budget second, exactly as the initiative requires. Until a
 * baseline is recorded this reports the measurement and passes; inventing a
 * millisecond threshold before anything has been measured on a hosted runner
 * would be a guess wearing the costume of a gate.
 *
 * Two things ARE asserted from the first run, because neither depends on a
 * baseline and both are absolute correctness properties:
 *
 *   - a query family that fell back to a sequential scan on an indexed lookup;
 *   - a measurement set that is empty, which must never read as "fast".
 *
 * Usage:
 *   node scripts/ci/performance-gate.mjs --report performance.json \
 *     --baseline .github/ci-baselines/performance-baseline.json [--update]
 * Exit codes: 0 pass · 1 regression or plan fault · 2 IO error.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Pulls `{ name, p50, p95, p99, plan }` out of whatever shape the report uses. */
export function normalise(report) {
  const source = Array.isArray(report)
    ? report
    : (report.queries ?? report.measurements ?? report.results ?? []);
  const rows = Array.isArray(source)
    ? source
    : Object.entries(source).map(([name, v]) => ({ name, ...v }));
  return rows
    .map((row) => ({
      name: row.name ?? row.query ?? row.id ?? 'unnamed',
      p50: Number(row.p50 ?? row.median ?? row.med ?? NaN),
      p95: Number(row.p95 ?? NaN),
      p99: Number(row.p99 ?? NaN),
      plan: row.plan ?? row.scan ?? row.node ?? null,
      rows: row.rows ?? null,
    }))
    .filter((row) => Number.isFinite(row.p50) || Number.isFinite(row.p95));
}

export function evaluate(report, baseline) {
  const measurements = normalise(report);
  const failures = [];
  const warnings = [];
  const comparisons = [];

  if (measurements.length === 0) {
    return {
      ok: false,
      failures: [
        'the performance report contains no measurement. An empty result set must never be read as "fast" — ' +
          'either the harness did not run or its output shape changed.',
      ],
      warnings: [],
      comparisons: [],
      measurements,
    };
  }

  // ---- absolute: an indexed lookup must not sequentially scan --------------
  for (const m of measurements) {
    if (typeof m.plan === 'string' && /seq\s*scan/i.test(m.plan)) {
      failures.push(
        `\`${m.name}\` executed a sequential scan. These families are the tenant-leading indexed lookups; ` +
          'a sequential scan here is a missing or unusable index, not a slow machine.'
      );
    }
  }

  // ---- relative: the regression budget -------------------------------------
  const recorded = baseline?.queries ?? {};
  const budget = Number(baseline?.regressionBudgetRatio ?? 1.5);
  const noiseFloorMs = Number(baseline?.noiseFloorMs ?? 5);

  for (const m of measurements) {
    const previous = recorded[m.name];
    if (!previous) {
      warnings.push(`no baseline for \`${m.name}\` — recording p50 ${m.p50} ms, p95 ${m.p95} ms.`);
      comparisons.push({ ...m, baselineP95: null, ratio: null });
      continue;
    }
    const baseP95 = Number(previous.p95);
    const ratio = baseP95 > 0 ? Number((m.p95 / baseP95).toFixed(3)) : null;
    comparisons.push({ ...m, baselineP95: baseP95, ratio });
    // A shared CI runner is noisy. Below the noise floor the ratio is arithmetic
    // about jitter, so it is not treated as a signal.
    if (m.p95 <= noiseFloorMs && baseP95 <= noiseFloorMs) continue;
    if (ratio !== null && ratio > budget) {
      failures.push(
        `\`${m.name}\` p95 went from ${baseP95} ms to ${m.p95} ms (×${ratio}); the budget is ×${budget}.`
      );
    }
  }

  return { ok: failures.length === 0, failures, warnings, comparisons, measurements };
}

export function toMarkdown(result, baseline) {
  const lines = ['### Performance baseline', ''];
  lines.push(
    `Regression budget: ×${baseline?.regressionBudgetRatio ?? 1.5} on p95 · ` +
      `noise floor: ${baseline?.noiseFloorMs ?? 5} ms · measurements: ${result.measurements.length}`
  );
  lines.push('');
  lines.push('| Query family | p50 (ms) | p95 (ms) | p99 (ms) | baseline p95 | ratio |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const c of result.comparisons) {
    lines.push(
      `| \`${c.name}\` | ${Number.isFinite(c.p50) ? c.p50 : '—'} | ${Number.isFinite(c.p95) ? c.p95 : '—'} | ` +
        `${Number.isFinite(c.p99) ? c.p99 : '—'} | ${c.baselineP95 ?? '—'} | ${c.ratio ? `×${c.ratio}` : '—'} |`
    );
  }
  lines.push('');
  lines.push(
    '_Measured on a shared GitHub-hosted runner against a GENERATED, non-personal dataset. ' +
      'These are validation baselines, not production-capacity claims._'
  );
  if (result.warnings.length) {
    lines.push('');
    for (const w of result.warnings.slice(0, 20)) lines.push(`> ⚠️ ${w}`);
  }
  if (result.failures.length) {
    lines.push('');
    lines.push('**Performance failures**');
    lines.push('');
    for (const f of result.failures) lines.push(`- ❌ ${f}`);
  }
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const reportPath = arg('--report');
  if (!reportPath || !existsSync(reportPath)) {
    console.error(
      `performance report not found at ${reportPath}. A missing measurement is not a passing one.`
    );
    process.exit(2);
  }
  const baselinePath = arg('--baseline') ?? '.github/ci-baselines/performance-baseline.json';
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));

  const result = evaluate(report, baseline);

  if (argv.includes('--update')) {
    const queries = {};
    for (const m of result.measurements) queries[m.name] = { p50: m.p50, p95: m.p95, p99: m.p99 };
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ ...baseline, queries, establishedBy: process.env.GITHUB_SHA ?? 'local' }, null, 2)}\n`
    );
    console.log(`performance baseline updated at ${baselinePath}`);
  }

  const md = toMarkdown(result, baseline);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${md}\n`);
  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  console.log(md);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
