#!/usr/bin/env node
/**
 * Nightly summary and gate (initiative §27).
 *
 * Nightly is not a merge gate, but "not blocking" must not mean "nobody looks".
 * This produces one record of the night and fails the gate job when a
 * BLOCKING-tier nightly job failed, so the run appears red in the Actions list
 * rather than being a green tick over a broken drill.
 *
 * The tiering is the point:
 *
 *   blocking      a failure means the system is not what we think it is —
 *                 isolation, migration replay, restore, secrets.
 *   informational a failure is a signal to act on, not proof of a defect —
 *                 the next Node or PostgreSQL major, deep scans that include
 *                 findings with no available fix.
 *
 * A job that is neither listed nor recognised is treated as BLOCKING, so adding
 * a nightly job without deciding its tier fails loudly instead of being ignored.
 *
 * Usage: node scripts/ci/nightly-summary.mjs --needs needs.json [--json out.json] [--markdown out.md]
 * Exit codes: 0 · 1 a blocking nightly job failed · 2 IO error.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TIERS = {
  'full-backend-e2e': 'blocking',
  'full-rls-matrix': 'blocking',
  'migration-replay': 'blocking',
  'historical-secret-scan': 'blocking',
  'mutation-assurance': 'blocking',
  'backup-restore-drill': 'blocking',
  'code-security': 'blocking',
  'dependency-deep-scan': 'informational',
  'container-deep-scan': 'informational',
  'performance-baseline': 'informational',
  'compatibility-matrix': 'informational',
};

export const TIER_REASONS = {
  'dependency-deep-scan':
    'includes the outdated inventory, which is behind almost by definition. The BLOCKING dependency check runs on every pull request.',
  'container-deep-scan':
    'drops the ignore-unfixed filter, so it reports base-image findings with no available patch. The blocking container check runs on every pull request.',
  'performance-baseline':
    'measured on a shared runner. A single slow night is jitter; the budget catches a sustained regression.',
  'compatibility-matrix':
    'the experimental combinations are early warning about the NEXT Node and PostgreSQL majors, not a veto from an unsupported one.',
};

export function evaluate(needs) {
  const rows = [];
  const failures = [];
  const informational = [];

  for (const [id, need] of Object.entries(needs ?? {})) {
    if (id === 'nightly-gate') continue;
    const result = need?.result ?? 'unknown';
    // Unrecognised jobs default to blocking: adding one without deciding its
    // tier must fail loudly rather than default to being ignored.
    const tier = TIERS[id] ?? 'blocking';
    rows.push({ id, result, tier, recognised: id in TIERS });

    if (!(id in TIERS)) {
      failures.push(
        `nightly job \`${id}\` has no recorded tier in scripts/ci/nightly-summary.mjs. ` +
          'Decide whether its failure is blocking or informational.'
      );
    }
    if (result === 'success' || result === 'skipped') continue;
    if (tier === 'blocking') {
      failures.push(`blocking nightly job \`${id}\` reported \`${result}\`.`);
    } else {
      informational.push(
        `\`${id}\` reported \`${result}\` — ${TIER_REASONS[id] ?? 'informational tier'}`
      );
    }
  }

  if (rows.length === 0) {
    failures.push(
      'the nightly gate received no job results, so it has nothing to report. Treated as a failure.'
    );
  }

  return { ok: failures.length === 0, rows, failures, informational };
}

export function toMarkdown(result) {
  const lines = ['## Nightly assurance', ''];
  const failed = result.rows.filter((r) => r.result !== 'success' && r.result !== 'skipped');
  lines.push(
    `**${result.rows.length - failed.length}/${result.rows.length}** nightly jobs succeeded. ` +
      `Gate: ${result.ok ? '**pass**' : '**fail**'}.`
  );
  lines.push('');
  lines.push('| Job | Tier | Result |');
  lines.push('| --- | --- | --- |');
  for (const row of result.rows) {
    const icon = row.result === 'success' ? '✅' : row.result === 'skipped' ? '➖' : '❌';
    lines.push(`| \`${row.id}\` | ${row.tier} | ${icon} ${row.result} |`);
  }
  if (result.informational.length) {
    lines.push('');
    lines.push('**Informational failures** — worth acting on, not proof of a defect:');
    lines.push('');
    for (const i of result.informational) lines.push(`- ⚠️ ${i}`);
  }
  if (result.failures.length) {
    lines.push('');
    lines.push('**Blocking failures**');
    lines.push('');
    for (const f of result.failures) lines.push(`- ❌ ${f}`);
  }
  lines.push('');
  lines.push(
    '_Nightly is never a required check for a merge. It answers a different question: is the system still what we think it is._'
  );
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const needsPath = arg('--needs');
  if (!needsPath) {
    console.error('missing --needs');
    process.exit(2);
  }
  let needs;
  try {
    needs = JSON.parse(readFileSync(needsPath, 'utf8'));
  } catch (error) {
    console.error(`cannot read needs at ${needsPath}: ${error.message}`);
    process.exit(2);
  }

  const result = evaluate(needs);
  const md = toMarkdown(result);
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
