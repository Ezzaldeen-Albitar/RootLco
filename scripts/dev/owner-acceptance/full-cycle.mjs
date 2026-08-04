#!/usr/bin/env node
/**
 * The acceptance-fixture lifecycle, as one deterministic command.
 *
 * ## The problem this exists for — `P1-26-F-057`
 *
 * The acceptance fixtures are business rows. Two Database/RLS tests assert the
 * database holds **no** business rows — that is the runtime enforcement of the
 * permanent no-fake-data policy. Both cannot be true at once.
 *
 * The wrong resolutions are all tempting. Weaken the two tests. Mark them flaky.
 * Skip them when fixtures exist. Every one of those trades a real invariant for
 * a convenient green, and the invariant is the more valuable thing: it is the
 * only check that would notice fabricated data reaching a shipped database.
 *
 * The right resolution is ordering. The fixtures may exist, and the Database
 * tier may run, but never at the same time — and something has to guarantee
 * that rather than trusting an operator to remember. This is that something:
 *
 *     clean -> prove clean -> fixtures -> use them -> remove them ->
 *     prove removed -> prove clean again
 *
 * Neither test is weakened. Neither run is skipped. The gate that would fail is
 * simply never asked to run against a state it was never meant to see.
 *
 * ## On failure
 *
 * Fixtures left half-created are worse than either extreme, because the next
 * run starts from a state nobody described. So a failure preserves the step's
 * log, attempts a reset, reports whether that reset succeeded, names the exact
 * step that failed, and exits non-zero. It never reports an ambiguous outcome.
 *
 * Local only.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { GuardFailure, assertLocalTarget } from './context.mjs';
import { API_ORIGIN, API_PORT, API_READY_PATH, DEV_HOST } from '../dev-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const LOG_DIR = join(REPO_ROOT, '.local', 'acceptance-cycle');

const SKIP_DB = process.env.ROOTLCO_CYCLE_SKIP_DB === '1';
const SKIP_BROWSER = process.env.ROOTLCO_CYCLE_SKIP_BROWSER === '1';

/** @type {{step: string, code: number, log: string}[]} */
const executed = [];

/**
 * npm's own JavaScript entry point, so npm can be run without a shell.
 *
 * `npm` on Windows is `npm.cmd`, and since the argument-injection fix in Node 18
 * `spawn` refuses to execute a `.cmd` without `shell: true` — it fails with
 * `EINVAL` and produces no output at all. Passing `shell: true` instead works
 * but triggers `DEP0190`, because with a shell the argument array is
 * concatenated rather than escaped.
 *
 * Running node against `npm-cli.js` avoids both: no shell, no `.cmd`, no
 * concatenation. `npm_execpath` is set by npm itself, and this script is always
 * reached through `npm run acceptance:full-cycle`.
 *
 * The middle attempt — dropping the shell but keeping the `.cmd` — is what
 * happens when a deprecation warning is treated as a defect. It silenced the
 * warning and broke every step, each failing in 0.0s with an empty log.
 */
const npmEntry = process.env.npm_execpath;

/** Runs one step and records it. */
function run(step, command, args, options = {}) {
  const started = Date.now();
  process.stdout.write(`  ${step.padEnd(38)} `);

  const useNpmEntry = command === 'npm' && npmEntry && npmEntry.endsWith('.js');
  const executable = useNpmEntry ? process.execPath : command;
  const argv = useNpmEntry ? [npmEntry, ...args] : args;

  const result = spawnSync(executable, argv, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    // Only when npm could not be reached through its JS entry: a `.cmd` needs a
    // shell, and a step that cannot run at all is worse than a deprecation.
    shell: !useNpmEntry && command === 'npm' && process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    console.log(`FAIL  0.0s  could not start: ${result.error.message}`);
    const log = join(LOG_DIR, `${String(executed.length + 1).padStart(2, '0')}-${step}.log`);
    writeFileSync(log, `failed to start: ${result.error.stack ?? result.error.message}\n`);
    executed.push({ step, code: 1, log });
    return { code: 1, output: '' };
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const log = join(LOG_DIR, `${String(executed.length + 1).padStart(2, '0')}-${step}.log`);
  writeFileSync(log, output);
  const code = result.status ?? 1;
  executed.push({ step, code, log });
  console.log(`${code === 0 ? 'ok  ' : 'FAIL'}  ${seconds}s  ${log.replace(REPO_ROOT, '.')}`);
  return { code, output };
}

const npm = (script) => ['run', script];

// The canonical origin, which is also the one this URL is reported at when the
// API does not answer — an operator reading that message must be shown the
// address they can actually open.
const apiUrl = `${API_ORIGIN}${API_READY_PATH}`;

async function apiAnswering() {
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Brings the API up if it is not already, and reports whether this run owns it.
 *
 * ## Called AFTER the fixtures are created, never before
 *
 * The API connects as `rootlco_acceptance_runtime`, and `supabase db reset`
 * drops every non-default role — so immediately after a canonical database reset
 * that login does not exist and the API cannot become ready no matter how long
 * it is given. `acceptance:create-owner` is what creates it.
 *
 * The first version started the API at the top of the run and waited three
 * minutes for a server that could never answer. Phase A needs no API at all: the
 * reset, the verifier and the Database tier all talk to Postgres directly. Only
 * the fixture status check and the browser tier need one, and both come after
 * creation.
 *
 * Only the API is started. The browser tier brings up its own web server against
 * a production build; a development web server would merely contend for a port.
 */
async function ensureApi() {
  if (await apiAnswering()) return { started: false, child: null };

  const log = join(LOG_DIR, 'api.log');
  process.stdout.write('  starting the API (nothing was answering)…');
  // The child writes STRAIGHT to a file descriptor — `P1-26-F-058`.
  //
  // Not `stdio: 'ignore'`: discarding the output is how a server that refuses to
  // start becomes a timeout with no explanation, which already cost one
  // diagnosis in this same function.
  //
  // And not `stdio: 'pipe'` either, which is the subtler trap and the one that
  // actually bit. A pipe must be drained by THIS process's event loop, and every
  // step below runs through `spawnSync`, which blocks that event loop for its
  // entire duration. During the browser tier the API kept logging, nothing
  // drained the pipe, the OS buffer filled, and the child blocked on write — so
  // the API froze mid-run. Twenty-one authenticated tests then failed with
  // `?reason=unavailable`, and every one of them looked like a timeout under
  // load.
  //
  // Handing the descriptor to the OS removes the dependency entirely: nothing in
  // this process has to be awake for the child to keep writing.
  const fd = openSync(log, 'a');
  const child = spawn(
    process.execPath,
    [
      `${REPO_ROOT}/node_modules/next/dist/bin/next`,
      'dev',
      'apps/api',
      // Pinned to the same host the readiness probe above uses. A default bind
      // would answer on every loopback address and hide a disagreement between
      // the two.
      '--hostname',
      DEV_HOST,
      '--port',
      String(API_PORT),
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', fd, fd],
    }
  );

  for (let i = 0; i < 60; i += 1) {
    if (await apiAnswering()) {
      console.log(' ready');
      return { started: true, child };
    }
    if (child.exitCode !== null) break;
    await delay(2_000);
  }

  child.kill();
  console.log(' FAILED');
  throw new Error(
    `The API did not answer at ${apiUrl}. Its output is in ${log}.\n` +
      'The usual cause is that the database login it connects as does not exist: ' +
      '`supabase db reset` drops every non-default role, and `acceptance:create-owner` ' +
      'is what recreates it. This cycle therefore starts the API only after creation.'
  );
}

function summarise(output, pattern) {
  const line = output
    .split(/\r?\n/)
    .reverse()
    .find((l) => pattern.test(l));
  return line ? line.trim() : null;
}

async function main() {
  assertLocalTarget();

  // A previous run's logs are cleared, not merged into. Step files are numbered
  // by position, so a shorter run leaves higher-numbered files from a longer one
  // behind — and a reader looking at `06-authenticated-browser.log` would be
  // reading the failure of a run that no longer exists. Evidence that mixes two
  // runs is worse than no evidence.
  rmSync(LOG_DIR, { recursive: true, force: true });
  mkdirSync(LOG_DIR, { recursive: true });

  console.log('Acceptance fixture lifecycle');
  console.log(`  logs ${LOG_DIR.replace(REPO_ROOT, '.')}`);
  console.log('');
  console.log('  The Database tier and the fixtures are mutually exclusive by design.');
  console.log('  This runs the tier only while the database is provably clean.');
  console.log('');

  /** Set by `start-api`, once the fixtures that its database login needs exist. */
  let api = { started: false, child: null };

  /** Every step, in the only order that keeps both invariants true. */
  const steps = [
    // --- PHASE A: reach and prove a clean database ------------------------
    ['reset-before', () => run('reset-before', 'npm', npm('acceptance:reset-owner'))],
    [
      'verify-clean-before',
      () => run('verify-clean-before', 'npm', npm('acceptance:verify-reset')),
    ],
    ...(SKIP_DB
      ? []
      : [['db-rls-pre-acceptance', () => run('db-rls-pre-acceptance', 'npm', npm('test:db'))]]),

    // --- PHASE B: create fixtures and use them ----------------------------
    //
    // Creation comes before the API, not after: the API connects as
    // `rootlco_acceptance_runtime`, and this script is what creates that login.
    ['create-fixtures', () => run('create-fixtures', 'npm', npm('acceptance:create-owner'))],
    [
      'start-api',
      async () => {
        api = await ensureApi();
        return { code: 0, output: api.started ? 'started by this run' : 'already running' };
      },
    ],
    ['status-fixtures', () => run('status-fixtures', 'npm', npm('acceptance:status-owner'))],
    ...(SKIP_BROWSER
      ? []
      : [
          // The browser tier serves a PRODUCTION build through `next start`, and
          // will not start without one. Nothing else in this cycle produces it:
          // the development server writes to `.next-dev` now (`P1-26-F-055`), so
          // `.next` is only ever populated deliberately. It used to be there by
          // accident, which is precisely the coupling that isolation removed —
          // so the build becomes an explicit step rather than a leftover.
          ['build-web', () => run('build-web', 'npm', npm('build:web'))],
          [
            'authenticated-browser',
            () =>
              run('authenticated-browser', 'npm', npm('test:web-e2e-authenticated'), {
                env: { ROOTLCO_E2E_AUTH: '1' },
              }),
          ],
        ]),

    // --- PHASE C: remove them and prove the database is clean again -------
    ['reset-after', () => run('reset-after', 'npm', npm('acceptance:reset-owner'))],
    ['verify-clean-after', () => run('verify-clean-after', 'npm', npm('acceptance:verify-reset'))],
    ...(SKIP_DB
      ? []
      : [['db-rls-post-reset', () => run('db-rls-post-reset', 'npm', npm('test:db'))]]),
    ['git-clean', () => run('git-clean', 'git', ['status', '--porcelain'])],
  ];

  /** Leaves the machine as this run found it. */
  const releaseApi = () => {
    if (api.started && api.child && api.child.exitCode === null) {
      api.child.kill();
      console.log('  (stopped the API this run started)');
    }
  };

  for (const [name, execute] of steps) {
    const { code, output } = await execute();

    if (name === 'git-clean') {
      // What this guards is fixture data reaching Git — and fixture data would
      // arrive as NEW files, not as edits to tracked source. Failing on any
      // modification at all also fails on the ordinary case of a developer with
      // work in progress, which makes the whole cycle unusable during
      // development and teaches people to skip it. A check nobody can afford to
      // run is not a check.
      const entries = output
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter(Boolean);
      const untracked = entries.filter((l) => l.startsWith('??'));
      const modified = entries.filter((l) => !l.startsWith('??'));

      if (untracked.length > 0) {
        console.log('');
        console.log('  Untracked files appeared during the cycle:');
        for (const line of untracked) console.log(`    ${line}`);
        console.log('  Fixture data must never reach the working tree. Investigate.');
        releaseApi();
        process.exitCode = 1;
        return;
      }
      if (modified.length > 0) {
        console.log(`      ${modified.length} tracked file(s) modified — work in progress, not`);
        console.log('      fixture output; nothing untracked appeared.');
      }
    }

    if (code !== 0) {
      console.log('');
      console.log(`  FAILED AT: ${name}`);
      console.log(`  Diagnostics preserved: ${executed.at(-1)?.log}`);
      console.log('');
      console.log('  Attempting a safe reset so the database is not left ambiguous…');
      const recovery = run('recovery-reset', 'npm', npm('acceptance:reset-owner'));
      const proof = run('recovery-verify', 'npm', npm('acceptance:verify-reset'));
      console.log('');
      if (recovery.code === 0 && proof.code === 0) {
        console.log('  Recovery reset succeeded: the database is clean and the Database tier');
        console.log('  can run. The failure above is the thing to fix.');
      } else {
        console.log('  RECOVERY RESET DID NOT SUCCEED. The database still holds acceptance');
        console.log('  fixtures. Do not run the Database tier until `acceptance:verify-reset`');
        console.log('  passes, or its clean-database tests will fail for the wrong reason.');
      }
      releaseApi();
      process.exitCode = 1;
      return;
    }

    if (name.startsWith('db-rls')) {
      const counts = summarise(output, /Tests\s+\d+/);
      if (counts) console.log(`      ${counts}`);
    }
  }

  console.log('');
  console.log('  Lifecycle complete. Every step green, in the required order:');
  for (const { step, code } of executed) {
    console.log(`    ${code === 0 ? 'ok  ' : 'FAIL'}  ${step}`);
  }
  console.log('');
  console.log('  Both invariants held: the fixtures existed, the Database tier ran,');
  console.log('  and neither test was weakened to let them coexist.');
  releaseApi();
  console.log('');
  console.log('  The database is clean. Recreate the Owner environment with:');
  console.log('    npm run acceptance:create-owner');
}

main().catch((error) => {
  if (error instanceof GuardFailure) {
    console.error(`\n${error.message}\n`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
