#!/usr/bin/env node
/**
 * The final gate (CSA-06).
 *
 * Branch protection today requires four job NAMES. Renaming a job silently
 * removes a required check; adding a job does not add one; a job that never
 * runs leaves the check Pending forever. `ci-gate` replaces all of that with one
 * stable check that has to reason explicitly about every outcome.
 *
 * A required job may end in five states and only two of them are acceptable:
 *
 *   success              → pass
 *   skipped + not needed → pass, and the reason is printed
 *   skipped + needed     → FAIL (unexpected skip)
 *   failure              → FAIL
 *   cancelled            → FAIL
 *
 * Two further failures have nothing to do with job results:
 *
 *   - a job in the DECLARED list is absent from `needs`  → the gate is stale
 *   - a job in `needs` is absent from the DECLARED list  → the gate is blind
 *
 * Both are real: the first is what happens when someone renames a job, the
 * second is what happens when someone adds one. A gate that only checks the
 * jobs it already knows about cannot detect either.
 *
 * Usage:
 *   node scripts/ci/evaluate-ci-gate.mjs \
 *     --needs needs.json --classification classification.json \
 *     [--evidence evidence-dir] [--expected-sha SHA] [--actual-sha SHA] \
 *     [--markdown out.md] [--json out.json]
 *
 * Exit codes: 0 Go · 1 No-Go · 2 IO/shape error.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The authoritative list of jobs the gate governs.
 *
 * `alwaysRequired: true` means a skip is NEVER acceptable, whatever change
 * detection says. `change-detection` is on that list because the gate's own
 * skip reasoning depends on it — if it did not run, no skip below can be
 * justified.
 */
export const DECLARED_JOBS = [
  { id: 'change-detection', alwaysRequired: true },
  { id: 'static-quality', alwaysRequired: true },
  { id: 'unit-tests-coverage', alwaysRequired: true },
  { id: 'application-build', alwaysRequired: false },
  { id: 'database-migration-replay', alwaysRequired: false },
  { id: 'database-security', alwaysRequired: false },
  { id: 'integration-tests', alwaysRequired: false },
  { id: 'dependency-security', alwaysRequired: true },
  { id: 'code-security', alwaysRequired: false },
  { id: 'container-security', alwaysRequired: false },
  { id: 'secret-scan', alwaysRequired: true },
  { id: 'hosted-clean-room', alwaysRequired: true },
];

export const ACCEPTABLE_RESULTS = new Set(['success', 'skipped']);

/**
 * @param {Record<string, {result?: string, outputs?: object}>} needs the `needs` context
 * @param {object|null} classification output of classify-changes.mjs
 * @param {{expectedSha?: string, actualSha?: string}} shas
 */
export function evaluate(needs, classification, shas = {}) {
  const failures = [];
  const notes = [];
  const jobs = [];

  const declaredIds = new Set(DECLARED_JOBS.map((j) => j.id));
  const presentIds = new Set(Object.keys(needs ?? {}));

  // ---- the gate must know about exactly the jobs that exist ---------------
  for (const id of declaredIds) {
    if (!presentIds.has(id)) {
      failures.push(
        `job \`${id}\` is declared in the gate but absent from \`needs\` — ` +
          `it was renamed or removed without updating scripts/ci/evaluate-ci-gate.mjs`
      );
    }
  }
  for (const id of presentIds) {
    if (!declaredIds.has(id)) {
      failures.push(
        `job \`${id}\` ran but the gate does not govern it — ` +
          `add it to DECLARED_JOBS or the gate is blind to its result`
      );
    }
  }

  // ---- per-job outcome ---------------------------------------------------
  for (const declared of DECLARED_JOBS) {
    const need = needs?.[declared.id];
    if (!need) {
      jobs.push({
        id: declared.id,
        result: 'absent',
        accepted: false,
        reason: 'not present in needs',
      });
      continue;
    }
    const result = need.result ?? 'unknown';
    let accepted = false;
    let reason = '';

    if (result === 'success') {
      accepted = true;
      reason = 'succeeded';
    } else if (result === 'skipped') {
      if (declared.alwaysRequired) {
        reason = 'skipped, but this job may never be skipped';
        failures.push(
          `required job \`${declared.id}\` was skipped — it is unconditionally required`
        );
      } else if (!classification) {
        reason = 'skipped, but no change classification is available to justify it';
        failures.push(
          `job \`${declared.id}\` was skipped and change detection produced no classification — ` +
            `a skip with no recorded reason is indistinguishable from a missing check`
        );
      } else {
        const decision = classification.jobs?.[declared.id];
        if (!decision) {
          reason = 'skipped, but change detection made no decision about this job';
          failures.push(
            `job \`${declared.id}\` was skipped and change detection has no entry for it — ` +
              `the skip cannot be justified`
          );
        } else if (decision.required) {
          reason = `skipped, but change detection required it (${decision.reason})`;
          failures.push(
            `job \`${declared.id}\` was skipped although change detection required it: ${decision.reason}`
          );
        } else {
          accepted = true;
          reason = `expected skip — ${decision.reason}`;
          notes.push(`\`${declared.id}\` skipped: ${decision.reason}`);
        }
      }
    } else if (result === 'cancelled') {
      reason = 'cancelled — a cancelled job proves nothing';
      failures.push(`required job \`${declared.id}\` was cancelled`);
    } else if (result === 'failure') {
      reason = 'failed';
      failures.push(`required job \`${declared.id}\` failed`);
    } else {
      reason = `ambiguous result \`${result}\``;
      failures.push(`job \`${declared.id}\` reported an ambiguous result \`${result}\``);
    }

    jobs.push({ id: declared.id, result, accepted, reason });
  }

  // ---- exact-SHA agreement ----------------------------------------------
  if (shas.expectedSha && shas.actualSha && shas.expectedSha !== shas.actualSha) {
    failures.push(
      `exact-SHA disagreement: the gate was asked about \`${shas.expectedSha}\` ` +
        `but the workflow ran against \`${shas.actualSha}\``
    );
  }

  return {
    decision: failures.length === 0 ? 'Go' : 'No-Go',
    ok: failures.length === 0,
    failures,
    notes,
    jobs,
    shas,
  };
}

/** Reads whatever evidence files the jobs uploaded into the gate's working directory. */
export function collectEvidence(dir) {
  const evidence = {};
  if (!dir || !existsSync(dir)) return evidence;
  const walk = (current, depth) => {
    if (depth > 3) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;
      try {
        evidence[entry.name.replace(/\.json$/, '')] = JSON.parse(readFileSync(full, 'utf8'));
      } catch {
        // A malformed evidence file is reported, not fatal: the job that produced
        // it already passed or failed on its own merits.
        evidence[entry.name.replace(/\.json$/, '')] = { error: 'unparseable' };
      }
    }
  };
  walk(dir, 0);
  return evidence;
}

const ICON = { success: '✅', skipped: '➖', failure: '❌', cancelled: '🚫', absent: '❓' };

export function toMarkdown(result, classification, evidence = {}) {
  const lines = [];
  lines.push('## CI gate');
  lines.push('');
  lines.push(`### Decision: ${result.ok ? '**Go**' : '**No-Go**'}`);
  lines.push('');

  lines.push('| Item | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Head SHA | \`${result.shas.actualSha ?? '—'}\` |`);
  lines.push(`| Base SHA | \`${result.shas.baseSha ?? '—'}\` |`);
  lines.push(`| Changed files | ${classification?.files?.length ?? '—'} |`);
  lines.push(
    `| Categories | ${classification?.categories?.length ? classification.categories.join(', ') : '—'} |`
  );
  lines.push(
    `| Documentation only | ${classification ? (classification.documentationOnly ? 'yes' : 'no') : '—'} |`
  );
  lines.push('');

  lines.push('### Jobs');
  lines.push('');
  lines.push('| Job | Result | Accepted | Reason |');
  lines.push('| --- | --- | --- | --- |');
  for (const job of result.jobs) {
    lines.push(
      `| \`${job.id}\` | ${ICON[job.result] ?? '•'} ${job.result} | ${job.accepted ? 'yes' : 'no'} | ${job.reason} |`
    );
  }
  lines.push('');

  // ---- evidence, only where a job actually produced it -------------------
  const rows = [];
  const push = (label, value) => {
    if (value !== undefined && value !== null && value !== '') rows.push([label, value]);
  };
  const cov = evidence['coverage-gate'];
  if (cov?.totals) {
    push('Coverage — lines', `${cov.totals.lines?.measured ?? '—'}%`);
    push('Coverage — branches', `${cov.totals.branches?.measured ?? '—'}%`);
    push('Coverage — functions', `${cov.totals.functions?.measured ?? '—'}%`);
    push('Coverage — statements', `${cov.totals.statements?.measured ?? '—'}%`);
  }
  // Each tier uploads `test-totals-<tier>.json`; the gate reads whichever
  // arrived rather than assuming a single combined file exists.
  for (const [key, value] of Object.entries(evidence)) {
    const tier = /^test-totals-(.+)$/.exec(key)?.[1];
    if (!tier || typeof value?.total !== 'number') continue;
    push(
      `${tier[0].toUpperCase()}${tier.slice(1)} tests`,
      `${value.total} (${value.passed} passed, ${value.failed} failed)`
    );
  }
  const api = evidence['openapi-totals'];
  if (api) {
    push('OpenAPI paths', api.paths);
    push('OpenAPI operations', api.operations);
  }
  const db = evidence['migration-replay'];
  if (db) {
    push('Migrations applied', db.migrations);
    push('Schema hash', db.schemaHash ? `\`${db.schemaHash}\`` : undefined);
    push('Application tables before migration', db.tablesBefore);
  }
  const image = evidence['image-metadata'];
  if (image) {
    push('Image digest', image.digest ? `\`${image.digest}\`` : undefined);
    push('Image size', image.sizeHuman);
    push('Runtime uid', image.uid);
  }
  const sec = evidence['security-findings'];
  if (sec) {
    push('Dependency findings (prod)', sec.dependencyProduction);
    push('Container CRITICAL/HIGH', sec.containerBlocking);
    push('Secret-scan findings', sec.secrets);
    push('SAST blocking findings', sec.sastBlocking);
  }
  if (rows.length) {
    lines.push('### Evidence');
    lines.push('');
    lines.push('| Measure | Value |');
    lines.push('| --- | --- |');
    for (const [k, v] of rows) lines.push(`| ${k} | ${v} |`);
    lines.push('');
  }

  if (result.notes.length) {
    lines.push('### Expected skips');
    lines.push('');
    for (const n of result.notes) lines.push(`- ${n}`);
    lines.push('');
  }

  if (result.failures.length) {
    lines.push('### Failures');
    lines.push('');
    for (const f of result.failures) lines.push(`- ❌ ${f}`);
    lines.push('');
  }

  lines.push(
    '> Artifacts for this run are attached to the workflow run — open the run summary and ' +
      'scroll to **Artifacts**. Evidence is uploaded even when a job fails.'
  );
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const readJson = (path, label, optional = false) => {
    if (!path) {
      if (optional) return null;
      console.error(`missing --${label}`);
      process.exit(2);
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      if (optional) return null;
      console.error(`cannot read ${label} at ${path}: ${error.message}`);
      process.exit(2);
    }
  };

  const needs = readJson(arg('--needs'), 'needs');
  const classification = readJson(arg('--classification'), 'classification', true);
  const evidence = collectEvidence(arg('--evidence'));

  const result = evaluate(needs, classification, {
    expectedSha: arg('--expected-sha'),
    actualSha: arg('--actual-sha'),
    baseSha: arg('--base-sha'),
  });
  result.shas.baseSha = arg('--base-sha');

  const md = toMarkdown(result, classification, evidence);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${md}\n`);
  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ ...result, evidence }, null, 2)}\n`);
  console.log(md);

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
