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
 * A SIXTH state exists for exactly one class of job: one that must run whenever
 * this run is allowed to run it, and that a fork pull request is deliberately
 * refused. Its three outcomes are named, and the gate says which it is:
 *
 *   REQUIRED_AND_PASSED               → pass
 *   REQUIRED_AND_FAILED               → FAIL, including "required but skipped"
 *   NOT_ELIGIBLE_FOR_SECURITY_REASON  → pass, and ONLY when the caller states,
 *                                       explicitly, that this run was not
 *                                       eligible. Silence is not a statement:
 *                                       an unexplained skip is a failure.
 *
 * The alternative — treating `skipped` as acceptable and letting the fork case
 * ride on that — is how a required check becomes optional without anybody
 * editing the word "required". See `acceptableResults` below, which replaced a
 * module-level `ACCEPTABLE_RESULTS` set that contained `'skipped'`, was exported,
 * and was READ BY NOTHING: the real skip reasoning was always the branch further
 * down. A constant that states a policy the code does not consult is worse than
 * no constant, because a reader checks it and believes it.
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
 *     [--trusted-context true|false] [--markdown out.md] [--json out.json]
 *
 * Exit codes: 0 Go · 1 No-Go · 2 IO/shape error.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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
  // ALWAYS required, not conditional on a frontend change. The web gates are
  // cheap, and the failure this closes was not "someone edited the web app and
  // we missed it" — it was that hosted CI invoked zero web commands at all, so
  // the application's lint had never run once in its life. A job that is
  // skippable on a technicality is a job that can rot the same way.
  { id: 'web-quality', alwaysRequired: true },
  { id: 'application-build', alwaysRequired: false },
  { id: 'database-migration-replay', alwaysRequired: false },
  { id: 'database-security', alwaysRequired: false },
  { id: 'integration-tests', alwaysRequired: false },
  { id: 'dependency-security', alwaysRequired: true },
  { id: 'code-security', alwaysRequired: false },
  { id: 'container-security', alwaysRequired: false },
  { id: 'secret-scan', alwaysRequired: true },
  { id: 'hosted-clean-room', alwaysRequired: true },
  // The AUTHENTICATED browser tier: the repository's only end-to-end
  // tenant-isolation proof and its only route-level accessibility proof.
  //
  // `alwaysRequired` for the same reason `web-quality` is — the failure it
  // closes was not "somebody edited the browser tests and we missed it", it was
  // that no gate waited for the result at all, so both gates could report Go
  // while this check was red.
  //
  // `securityEligibility` is the ONE recognised excuse, and it is not a
  // classification decision: a fork pull request is refused privileged browser
  // execution, so on that event alone the job legitimately does not run. The
  // caller must SAY SO (`--trusted-context false`). Nothing is inferred.
  {
    id: 'authenticated-browser',
    alwaysRequired: true,
    securityEligibility: 'same-repository head',
  },
];

/**
 * The results that may be accepted for a job, derived from the job.
 *
 * This is consulted — see the cross-check at the end of the per-job loop. Its
 * predecessor was a module-level `Set(['success', 'skipped'])` that nothing
 * imported and nothing read, so it documented a policy ("a skip is acceptable")
 * that was never the policy for an unconditionally required job.
 *
 * `skipped` is acceptable ONLY where change detection is allowed to stand a job
 * down. For an `alwaysRequired` job, and for a security-gated one, `success` is
 * the only acceptable RESULT — the security-gated job's one escape is an
 * explicit ineligibility, which is a state rather than a result and is handled
 * where it can be reasoned about.
 *
 * @param {{alwaysRequired?: boolean, securityEligibility?: string}} job
 */
export function acceptableResults(job) {
  if (job.alwaysRequired || job.securityEligibility) return new Set(['success']);
  return new Set(['success', 'skipped']);
}

/** The three states a governed job's outcome is reported as. */
export const STATE = Object.freeze({
  PASSED: 'REQUIRED_AND_PASSED',
  FAILED: 'REQUIRED_AND_FAILED',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE_FOR_SECURITY_REASON',
  /** A conditional job that change detection legitimately stood down. */
  EXPECTED_SKIP: 'EXPECTED_SKIP',
});

/**
 * @param {Record<string, {result?: string, outputs?: object}>} needs the `needs` context
 * @param {object|null} classification output of classify-changes.mjs
 * @param {{expectedSha?: string, actualSha?: string}} shas
 * @param {{trustedContext?: boolean}} context
 *   `trustedContext` is the caller's explicit statement about whether this run
 *   was allowed to give a job privileged execution. `undefined` means nobody
 *   said, and that is NOT the same as `true` or `false`: it fails a skip closed.
 */
export function evaluate(needs, classification, shas = {}, context = {}) {
  const failures = [];
  const notes = [];
  const jobs = [];
  const trusted = context.trustedContext;

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
      // A key present with a falsy value (`null`, `0`, `""`) is NOT the same as
      // a missing key — the missing-key case is already reported above — so
      // this branch must push a failure of its own. Without it the job is
      // recorded as unaccepted while `failures` stays empty, and the decision,
      // derived from `failures.length`, comes out Go. Reachable through any
      // writer that rewrites the needs document, such as
      // protected-classification.mjs.
      failures.push(
        `job \`${declared.id}\` has no usable entry in \`needs\` (value was ` +
          `\`${JSON.stringify(need)}\`), so nothing is known about whether it ran.`
      );
      jobs.push({
        id: declared.id,
        result: 'absent',
        accepted: false,
        state: STATE.FAILED,
        reason: 'no usable entry in needs',
      });
      continue;
    }
    const result = need.result ?? 'unknown';
    let accepted = false;
    let reason = '';
    let state = STATE.FAILED;

    if (result === 'success') {
      accepted = true;
      state = STATE.PASSED;
      reason = 'succeeded';
    } else if (result === 'skipped' && declared.securityEligibility) {
      // ---- the security-gated case, decided BEFORE the generic skip rules ---
      //
      // The only place a skip of an unconditionally required job may be
      // accepted, and it is accepted on the CALLER'S STATEMENT, never on
      // inference. `true` and `undefined` both fail: a run nobody vouched for is
      // exactly the run whose skip must not be excused.
      if (trusted === false) {
        accepted = true;
        state = STATE.NOT_ELIGIBLE;
        reason =
          `not eligible — this run may not give a job privileged execution ` +
          `(requires ${declared.securityEligibility}), so the job did not run`;
        notes.push(
          `\`${declared.id}\` — ${STATE.NOT_ELIGIBLE}: this run is not a trusted context ` +
            `(${declared.securityEligibility}), so the job was deliberately not given privileged ` +
            'execution. This is a refusal, not a pass: the assurance is UNPROVEN for this run.'
        );
      } else if (trusted === true) {
        state = STATE.FAILED;
        reason = 'skipped in a trusted context, where it is unconditionally required';
        failures.push(
          `required job \`${declared.id}\` was skipped although this run IS a trusted context — ` +
            'a required job that did not run cannot be reported as a pass'
        );
      } else {
        state = STATE.FAILED;
        reason = 'skipped, and no eligibility statement was supplied — failing closed';
        failures.push(
          `required job \`${declared.id}\` was skipped and the gate was given no ` +
            '`--trusted-context` statement, so the skip cannot be attributed to a security ' +
            'refusal. An unexplained skip of a required job fails closed.'
        );
      }
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
          state = STATE.EXPECTED_SKIP;
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

    // The cross-check that makes `acceptableResults` load-bearing rather than
    // decorative. An accepted result must either BE acceptable for this job, or
    // be the one state that is allowed to override the result — an explicit
    // security ineligibility. Any future branch that sets `accepted = true` on a
    // skip of a required job is caught here rather than shipping a green gate.
    if (accepted && !acceptableResults(declared).has(result) && state !== STATE.NOT_ELIGIBLE) {
      accepted = false;
      state = STATE.FAILED;
      failures.push(
        `job \`${declared.id}\` was accepted with result \`${result}\`, which is not an ` +
          `acceptable result for it (${[...acceptableResults(declared)].join(', ')}) and was not ` +
          `recorded as ${STATE.NOT_ELIGIBLE}.`
      );
    }

    jobs.push({ id: declared.id, result, accepted, state, reason });
  }

  // ---- exact-SHA agreement ----------------------------------------------
  if (shas.expectedSha && shas.actualSha && shas.expectedSha !== shas.actualSha) {
    failures.push(
      `exact-SHA disagreement: the gate was asked about \`${shas.expectedSha}\` ` +
        `but the workflow ran against \`${shas.actualSha}\``
    );
  }

  // Belt and braces: the decision is Go only if nothing was recorded as a
  // failure AND every governed job was positively accepted. Deriving it from
  // `failures.length` alone means any future branch that marks a job
  // unaccepted without also pushing a failure silently produces a Go.
  const unaccepted = jobs.filter((job) => !job.accepted);
  for (const job of unaccepted) {
    if (!failures.some((f) => f.includes(`\`${job.id}\``))) {
      failures.push(
        `job \`${job.id}\` was not accepted (${job.reason}) but recorded no failure of its own. ` +
          'Treating an unaccounted-for job as a failure.'
      );
    }
  }

  const ok = failures.length === 0 && unaccepted.length === 0;
  return {
    decision: ok ? 'Go' : 'No-Go',
    ok,
    failures,
    notes,
    jobs,
    shas,
    // The eligibility statement is published, not merely consumed. A gate record
    // that says Go has to be readable as "and here is what was, and was not,
    // eligible to be proved on this run".
    trustedContext: trusted === undefined ? 'unstated' : trusted,
    securityGated: DECLARED_JOBS.filter((j) => j.securityEligibility).map((j) => ({
      id: j.id,
      requires: j.securityEligibility,
      state: jobs.find((row) => row.id === j.id)?.state ?? STATE.FAILED,
    })),
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
      const key = entry.name.replace(/\.json$/, '');
      // Flattening by basename across artifact directories silently overwrites:
      // two jobs uploading the same filename means the gate summary — which a
      // gate record then cites — can carry the wrong job's numbers. Keep the
      // first and record the collision rather than losing it.
      if (key in evidence) {
        evidence[`${key}__collision`] = [
          ...(evidence[`${key}__collision`] ?? []),
          relative(dir, full).replace(/\\/g, '/'),
        ];
        continue;
      }
      try {
        evidence[key] = JSON.parse(readFileSync(full, 'utf8'));
      } catch {
        // A malformed evidence file is reported, not fatal: the job that produced
        // it already passed or failed on its own merits.
        evidence[key] = { error: 'unparseable' };
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
  lines.push('| Job | Result | State | Accepted | Reason |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const job of result.jobs) {
    lines.push(
      `| \`${job.id}\` | ${ICON[job.result] ?? '•'} ${job.result} | \`${job.state ?? '—'}\` | ` +
        `${job.accepted ? 'yes' : 'no'} | ${job.reason} |`
    );
  }
  lines.push('');

  // ---- security-gated assurance, stated rather than implied ---------------
  //
  // A reader of a Go must be able to tell "this was proved" from "this run was
  // not allowed to prove it". Those are different facts and the gate is the only
  // place that knows which one applies.
  if (result.securityGated?.length) {
    lines.push('### Security-gated assurance');
    lines.push('');
    lines.push(`Trusted context: \`${result.trustedContext}\``);
    lines.push('');
    lines.push('| Job | Requires | State |');
    lines.push('| --- | --- | --- |');
    for (const row of result.securityGated) {
      lines.push(`| \`${row.id}\` | ${row.requires} | \`${row.state}\` |`);
    }
    lines.push('');
  }

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

  /*
   * THREE values, not two. `--trusted-context` absent, or carrying anything but
   * `true`/`false`, means the caller did not state an eligibility — which is a
   * different fact from stating `false`, and only `false` excuses a skip.
   *
   * Parsed strictly on purpose. A shell expression that evaluates to an empty
   * string (an `if:` that did not resolve, an unset env var) must NOT read as
   * "not eligible", because that is precisely the accident that would turn a
   * required-but-skipped job into a green gate.
   */
  const raw = arg('--trusted-context');
  const trustedContext = raw === 'true' ? true : raw === 'false' ? false : undefined;
  if (raw !== undefined && trustedContext === undefined) {
    console.error(
      `--trusted-context was given \`${raw}\`, which is neither \`true\` nor \`false\`. ` +
        'Treating the eligibility as UNSTATED, which fails a skip closed.'
    );
  }

  const result = evaluate(
    needs,
    classification,
    {
      expectedSha: arg('--expected-sha'),
      actualSha: arg('--actual-sha'),
      baseSha: arg('--base-sha'),
    },
    { trustedContext }
  );
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
