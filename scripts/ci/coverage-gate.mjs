#!/usr/bin/env node
/**
 * Coverage ratchet and critical-module floors (CSA-07).
 *
 * The repository had a coverage PROVIDER configured and no gate: `npm run
 * test:coverage` was never called by any workflow, so nothing stopped coverage
 * falling to zero. This script is that gate.
 *
 * Policy, in order of strictness:
 *
 *   1. GLOBAL RATCHET — no metric may fall below the recorded baseline by more
 *      than `tolerancePercentagePoints`. The tolerance exists because v8 line
 *      attribution shifts by fractions of a point across Node patch releases;
 *      it is not a licence to lose coverage.
 *   2. CRITICAL FLOORS — named modules must hold an absolute minimum whatever
 *      the global number does. Averages hide a module going dark.
 *   3. TOUCHED-FILE FLOOR — a production file changed by this pull request must
 *      not be materially uncovered. A large global number cannot buy a new
 *      untested file.
 *
 * The baseline is a committed file, so raising it is a reviewable diff. Lowering
 * it is also a reviewable diff — which is the point.
 *
 * Usage:
 *   node scripts/ci/coverage-gate.mjs \
 *     --summary coverage/coverage-summary.json \
 *     --baseline .github/ci-baselines/coverage-baseline.json \
 *     [--changed changed.txt] [--markdown out.md] [--json out.json] [--update]
 *
 * Exit codes: 0 pass · 1 gate failure · 2 IO/shape error.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { relative, resolve } from 'node:path';
import { REPOSITORY_ROOT } from '../lib/repository-paths.mjs';

export const METRICS = ['lines', 'statements', 'functions', 'branches'];

/** Normalises an absolute or relative v8 key to a repository-relative POSIX path. */
export function normaliseKey(key, root = REPOSITORY_ROOT) {
  if (key === 'total') return 'total';
  const rel = key.includes(':') || key.startsWith('/') ? relative(root, key) : key;
  return rel.replace(/\\/g, '/');
}

/** Percentage covered, defined so that "nothing to cover" is 100 rather than NaN. */
export function pct(entry) {
  if (!entry || typeof entry.total !== 'number') return null;
  if (entry.total === 0) return 100;
  return Number(((entry.covered / entry.total) * 100).toFixed(2));
}

/**
 * Evaluates a coverage summary against a baseline.
 *
 * @param {object} summary  istanbul/v8 `coverage-summary.json`
 * @param {object} baseline committed baseline document
 * @param {string[]} changedFiles repository-relative paths changed by the PR
 */
export function evaluate(summary, baseline, changedFiles = [], root = REPOSITORY_ROOT) {
  const failures = [];
  const warnings = [];

  if (!summary || typeof summary !== 'object' || !summary.total) {
    return {
      ok: false,
      failures: ['coverage summary has no `total` key — the coverage run did not produce a report'],
      warnings: [],
      totals: {},
      criticalModules: [],
      touchedFiles: [],
    };
  }

  // ---- 0. the baseline document must itself be usable --------------------
  // A one-token edit to the baseline could otherwise silence the whole gate.
  // `Number('n/a')` is NaN, and `delta < -NaN` is always false, so every metric
  // would pass at any coverage. Refuse the document instead.
  const tolerance = Number(baseline.tolerancePercentagePoints ?? 0.5);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 2) {
    failures.push(
      `\`tolerancePercentagePoints\` is \`${JSON.stringify(baseline.tolerancePercentagePoints)}\`, ` +
        'which is not a number between 0 and 2. A non-numeric tolerance disables the ratchet entirely.'
    );
  }

  // A baseline that WAS established and has since been emptied is a silenced
  // gate. A baseline that was never established is measure-first and legitimate
  // — the difference is `establishedBy`, so the two cases are distinguished
  // rather than both being waved through.
  const globalIsEmpty = !baseline.global || Object.keys(baseline.global).length === 0;
  if (globalIsEmpty && baseline.establishedBy) {
    failures.push(
      `the baseline records \`establishedBy: ${JSON.stringify(baseline.establishedBy)}\` but its ` +
        '`global` block is empty. A baseline that was established and then emptied is a disabled ratchet, ' +
        'not a measure-first placeholder.'
    );
  }

  const totals = {};
  for (const metric of METRICS) {
    const measured = pct(summary.total[metric]);
    const expected = baseline.global?.[metric];
    totals[metric] = { measured, baseline: expected ?? null, delta: null };
    if (measured === null) {
      failures.push(`metric \`${metric}\` is absent from the coverage summary`);
      continue;
    }
    if (typeof expected !== 'number') {
      warnings.push(`no baseline recorded for \`${metric}\` — recording ${measured}%`);
      continue;
    }
    const delta = Number((measured - expected).toFixed(2));
    totals[metric].delta = delta;
    if (delta < -tolerance) {
      failures.push(
        `global ${metric} coverage fell from ${expected}% to ${measured}% ` +
          `(${delta} pp, tolerance ${tolerance} pp)`
      );
    }
  }

  // ---- 2. critical-module floors ----------------------------------------
  const fileEntries = Object.entries(summary)
    .filter(([key]) => key !== 'total')
    .map(([key, value]) => [normaliseKey(key, root), value]);

  const criticalModules = [];
  for (const rule of baseline.criticalModules ?? []) {
    const metric = rule.metric ?? 'lines';
    if (!METRICS.includes(metric)) {
      // A mistyped metric makes every lookup `undefined`, so the aggregate is
      // {covered: 0, total: 0}, `pct` returns 100 by its "nothing to cover"
      // rule, and the floor passes at any real coverage.
      failures.push(
        `critical-module rule \`${rule.id}\` names metric \`${metric}\`, which is not one of ` +
          `${METRICS.join(', ')}. The rule would score 100% whatever the module's coverage is.`
      );
      criticalModules.push({ ...rule, matchedFiles: 0, measured: null, ok: false });
      continue;
    }
    // A trailing separator, so `.../server/errors` cannot match
    // `.../server/errors-legacy/`.
    const prefix = rule.pathPrefix.endsWith('/') ? rule.pathPrefix : `${rule.pathPrefix}/`;
    const matched = fileEntries.filter(
      ([key]) => key === rule.pathPrefix || key.startsWith(prefix)
    );
    if (matched.length === 0) {
      // A floor that matches nothing is a silently dead rule. Refuse it.
      failures.push(
        `critical-module rule \`${rule.id}\` matches no file under \`${rule.pathPrefix}\` — ` +
          `the floor is vacuous and would pass whatever happens to that module`
      );
      criticalModules.push({ ...rule, matchedFiles: 0, measured: null, ok: false });
      continue;
    }
    const aggregate = { covered: 0, total: 0 };
    for (const [, value] of matched) {
      const entry = value[metric];
      aggregate.covered += entry?.covered ?? 0;
      aggregate.total += entry?.total ?? 0;
    }

    // Files matched but nothing measurable in them: `pct` would return 100 by
    // its "nothing to cover" rule and the floor would pass. That is the same
    // vacuity as a rule matching no file at all.
    if (aggregate.total === 0) {
      failures.push(
        `critical-module rule \`${rule.id}\` matched ${matched.length} file(s) under ` +
          `\`${rule.pathPrefix}\` but none carries a measurable \`${metric}\` count, so the floor is vacuous.`
      );
      criticalModules.push({ ...rule, matchedFiles: matched.length, measured: null, ok: false });
      continue;
    }

    // A rule may declare how many files it expects to govern. Coverage
    // `include` lists narrow silently; without this, removing files from the
    // instrumented set shrinks what the floor actually protects while the
    // percentage stays reassuring.
    if (typeof rule.minMatchedFiles === 'number' && matched.length < rule.minMatchedFiles) {
      failures.push(
        `critical-module rule \`${rule.id}\` matched ${matched.length} file(s) but expects at least ` +
          `${rule.minMatchedFiles}. The instrumented set narrowed, so this floor now protects less than it did.`
      );
    }

    const measured = pct(aggregate);
    const ok = measured >= rule.minimum;
    if (!ok) {
      failures.push(
        `critical module \`${rule.id}\` (${rule.pathPrefix}) is at ${measured}% ` +
          `${metric} coverage, below its ${rule.minimum}% floor`
      );
    }
    criticalModules.push({ ...rule, matchedFiles: matched.length, measured, ok });
  }

  // ---- 3. touched-file floor --------------------------------------------
  const touchedMinimum = Number(baseline.touchedFileMinimum ?? 0);
  const touchedFiles = [];
  if (touchedMinimum > 0 && changedFiles.length > 0) {
    const changedSet = new Set(changedFiles.map((f) => f.replace(/\\/g, '/')));
    for (const [key, value] of fileEntries) {
      if (!changedSet.has(key)) continue;
      const measured = pct(value.lines);
      const exempt = (baseline.touchedFileExemptPrefixes ?? []).some((p) => key.startsWith(p));
      const ok = exempt || measured >= touchedMinimum;
      touchedFiles.push({ file: key, measured, exempt, ok });
      if (!ok) {
        failures.push(
          `\`${key}\` was changed by this pull request and is at ${measured}% line coverage, ` +
            `below the ${touchedMinimum}% floor for touched production files`
        );
      }
    }
  }

  return { ok: failures.length === 0, failures, warnings, totals, criticalModules, touchedFiles };
}

export function toMarkdown(result, baseline) {
  const lines = [];
  lines.push('### Coverage');
  lines.push('');
  lines.push('| Metric | Measured | Baseline | Δ |');
  lines.push('| --- | --- | --- | --- |');
  for (const metric of METRICS) {
    const t = result.totals[metric] ?? {};
    const delta =
      t.delta === null || t.delta === undefined ? '—' : `${t.delta > 0 ? '+' : ''}${t.delta} pp`;
    lines.push(`| ${metric} | ${t.measured ?? '—'}% | ${t.baseline ?? '—'}% | ${delta} |`);
  }
  lines.push('');
  lines.push(
    `Tolerance: ${baseline.tolerancePercentagePoints ?? 0.5} pp · Touched-file floor: ${baseline.touchedFileMinimum ?? 0}%`
  );
  if (result.criticalModules.length) {
    lines.push('');
    lines.push('| Critical module | Files | Metric | Measured | Floor | |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const m of result.criticalModules) {
      lines.push(
        `| \`${m.id}\` | ${m.matchedFiles} | ${m.metric ?? 'lines'} | ${m.measured ?? '—'}% | ${m.minimum}% | ${m.ok ? '✅' : '❌'} |`
      );
    }
  }
  if (result.touchedFiles.length) {
    lines.push('');
    lines.push('<details><summary>Touched production files</summary>');
    lines.push('');
    lines.push('| File | Line coverage | |');
    lines.push('| --- | --- | --- |');
    for (const f of result.touchedFiles) {
      lines.push(
        `| \`${f.file}\` | ${f.measured}% | ${f.ok ? (f.exempt ? '➖ exempt' : '✅') : '❌'} |`
      );
    }
    lines.push('');
    lines.push('</details>');
  }
  if (result.warnings.length) {
    lines.push('');
    for (const w of result.warnings) lines.push(`> ⚠️ ${w}`);
  }
  if (result.failures.length) {
    lines.push('');
    lines.push('**Coverage gate failures**');
    lines.push('');
    for (const f of result.failures) lines.push(`- ❌ ${f}`);
  } else {
    lines.push('');
    lines.push('**Coverage gate: pass**');
  }
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const summaryPath = arg('--summary') ?? 'coverage/coverage-summary.json';
  const baselinePath = arg('--baseline') ?? '.github/ci-baselines/coverage-baseline.json';

  let summary;
  let baseline;
  try {
    summary = JSON.parse(readFileSync(resolve(summaryPath), 'utf8'));
  } catch (error) {
    console.error(`cannot read coverage summary at ${summaryPath}: ${error.message}`);
    process.exit(2);
  }
  try {
    baseline = JSON.parse(readFileSync(resolve(baselinePath), 'utf8'));
  } catch (error) {
    console.error(`cannot read coverage baseline at ${baselinePath}: ${error.message}`);
    process.exit(2);
  }

  const changedPath = arg('--changed');
  let changed = [];
  if (changedPath && existsSync(changedPath)) {
    changed = readFileSync(changedPath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }

  const result = evaluate(summary, baseline, changed);

  if (argv.includes('--update')) {
    // Records the measured numbers back into the baseline. Used only when a
    // human deliberately re-baselines; never invoked by the PR gate.
    const next = { ...baseline, global: {} };
    for (const metric of METRICS) next.global[metric] = result.totals[metric]?.measured ?? null;
    next.establishedBy = process.env.GITHUB_SHA ?? 'local';
    writeFileSync(resolve(baselinePath), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`baseline updated at ${baselinePath}`);
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
