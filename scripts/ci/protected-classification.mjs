#!/usr/bin/env node
/**
 * Synthetic classification for a protected-branch run.
 *
 * A `push` event has no base to diff against, so there is no change detection
 * and therefore no legitimate skip: on `develop` and `main` every job runs,
 * every time. `evaluate-ci-gate.mjs` still needs a classification document to
 * reason with, so this produces one in which EVERY job is required — which is
 * what makes any skip on a protected branch a failure rather than a decision.
 *
 * It also reconciles the `needs` document. `change-detection` exists only in the
 * pull-request workflow, and the gate refuses a governed job that is absent from
 * `needs` (that check is what catches a renamed job). Rather than weaken the
 * gate for this one case, the protected run records `change-detection` as
 * satisfied by construction, with the reason stated here rather than hidden in
 * a shell fragment.
 *
 * Usage:
 *   node scripts/ci/protected-classification.mjs \
 *     --needs needs.json --out-classification classification.json --out-needs needs.json
 * Exit codes: 0 always, 2 on IO error.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DECLARED_JOBS } from './evaluate-ci-gate.mjs';

export function buildClassification() {
  const jobs = {};
  for (const job of DECLARED_JOBS) {
    jobs[job.id] = {
      required: true,
      reason: 'protected branch: no change detection, everything runs',
    };
  }
  return { files: [], categories: [], documentationOnly: false, jobs };
}

export function reconcileNeeds(needs, gateJobId = 'protected-gate') {
  const reconciled = { ...needs };
  delete reconciled[gateJobId];
  reconciled['change-detection'] = {
    result: 'success',
    outputs: {},
    note: 'Not a job on a push event. Recorded as satisfied because a protected run performs no change detection and permits no skip.',
  };
  return reconciled;
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

  writeFileSync(
    arg('--out-classification') ?? 'classification.json',
    `${JSON.stringify(buildClassification(), null, 2)}\n`
  );
  writeFileSync(
    arg('--out-needs') ?? needsPath,
    `${JSON.stringify(reconcileNeeds(needs, arg('--gate-job') ?? 'protected-gate'), null, 2)}\n`
  );
  console.log(`protected classification written for ${DECLARED_JOBS.length} job(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
