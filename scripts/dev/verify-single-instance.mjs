#!/usr/bin/env node
/**
 * Proves the single-instance contract against the real machine.
 *
 *     npm run dev:verify-single-instance                  development
 *     npm run dev:verify-single-instance -- --production  production
 *
 * Opt-in, because it starts and stops the local servers. It touches no
 * database, no fixtures and no credentials — only processes and ports.
 *
 * The `--production` run is the SAME contract against the acceptance mode, and
 * it has to be run separately rather than inferred from the development one:
 * the single-instance guarantee is about how the launcher identifies a running
 * server, and a production stack's command line is `next start`, not `next dev`.
 * A guard proven against one subcommand is not proven against the other — that
 * is exactly the assumption that would have let the production stack be
 * classified as an unrelated process. It is much slower, because it builds both
 * workspaces twice.
 *
 * This exists because the defect it guards (`P1-26-F-063`) is invisible to
 * every other tier. The unit suite proves the DECISION is right for a given set
 * of facts; only running two launchers in sequence proves the facts are
 * gathered correctly on this operating system. The bug was precisely in the
 * gathering: a bind probe that could not see a listener on another address.
 *
 * Exit code is the verdict. Every step prints what it measured, so a failure
 * says which invariant broke rather than "it did not work".
 */
import { spawn, spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  API_ORIGIN,
  API_PORT,
  API_READY_PATH,
  WEB_ORIGIN,
  WEB_PORT,
  WEB_READY_PATH,
  repoRoot,
} from './dev-config.mjs';
import { listenersOnPorts } from './process-discovery.mjs';
import { PRODUCTION, parseModeArgv } from './launch-mode.mjs';

const root = repoRoot();
const failures = [];
let step = 0;

const { mode: MODE, errors: MODE_ERRORS } = parseModeArgv(process.argv.slice(2));
if (MODE_ERRORS.length > 0) {
  for (const error of MODE_ERRORS) console.error(`  ${error}`);
  process.exit(2);
}

/** The command an operator would type for this mode — and what this proves about. */
const START_SCRIPT = MODE === PRODUCTION ? 'acceptance:serve' : 'dev:all';
/** A production run compiles both workspaces before it can answer anything. */
const READY_BUDGET_MS = MODE === PRODUCTION ? 900_000 : 240_000;

function check(label, ok, detail = '') {
  step += 1;
  if (!ok) failures.push(label);
  console.log(
    `  ${String(step).padStart(2)}. ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`
  );
}

/** npm through the current Node, so no `.cmd` and no shell quoting. */
function npm(script, { detached = false } = {}) {
  const entry = process.env.npm_execpath;
  const useEntry = entry && entry.endsWith('.js');
  const file = useEntry ? process.execPath : 'npm';
  const args = useEntry ? [entry, 'run', script] : ['run', script];
  return spawnSync(file, args, {
    cwd: root,
    encoding: 'utf8',
    shell: !useEntry && process.platform === 'win32',
    // A second `acceptance:serve` still has to reach the adopt decision, which
    // happens before any build — so this budget covers a survey, not a compile.
    timeout: detached ? 60_000 : 300_000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Starts `dev:all` in the background.
 *
 * `spawn` with `detached` and `unref`, NOT `cmd /c start /b`: the `start`
 * builtin keeps the console attached, so `spawnSync` waits for the launcher —
 * which never exits, because staying attached to its children is its whole
 * lifecycle. The first version of this script did exactly that and timed out
 * having launched nothing, then reported the stack as down.
 *
 * @param {string} logName
 */
function startDetached(logName) {
  const log = openSync(join(root, '.local', logName), 'a');
  const args = ['scripts/dev/start-local.mjs'];
  if (MODE === PRODUCTION) args.push('--production');
  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env },
  });
  child.unref();
  return child;
}

const listenerPids = (port) => {
  try {
    return listenersOnPorts([port])
      .map((l) => l.pid)
      .sort();
  } catch {
    return null;
  }
};

/**
 * A generous timeout on purpose.
 *
 * `next dev` compiles a route on first request, so a cold
 * `/api/v1/health/ready` can take far longer than a liveness probe would
 * suggest — and this script also spawns PowerShell for every discovery call,
 * which competes for the same machine. A four-second budget made this report
 * "the API is not answering" about an API that was answering 200 the moment it
 * was asked by hand. An impatient check is a false negative, and a false
 * negative in a verification script is worse than no check.
 */
async function answers(url, timeoutMs = 30_000) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })).ok;
  } catch {
    return false;
  }
}

async function waitForPortsFree(timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    const held = listenersOnPorts([API_PORT, WEB_PORT]);
    if (held.length === 0) return true;
    if (Date.now() - start > timeoutMs) return false;
    await delay(500);
  }
}

async function waitForReady(timeoutMs = READY_BUDGET_MS) {
  const start = Date.now();
  for (;;) {
    if (
      (await answers(`${API_ORIGIN}${API_READY_PATH}`)) &&
      (await answers(`${WEB_ORIGIN}${WEB_READY_PATH}`))
    )
      return true;
    if (Date.now() - start > timeoutMs) return false;
    await delay(1_000);
  }
}

console.log('');
console.log(`RootLco single-instance contract — ${MODE} mode (npm run ${START_SCRIPT})`);
console.log('');

// --- 1. clean slate -------------------------------------------------------
const stopFirst = npm('dev:stop');
check(
  'dev:stop leaves the canonical ports free',
  await waitForPortsFree(),
  stopFirst.status === 0 ? '' : `stop exit ${stopFirst.status}`
);

// --- 2. first start -------------------------------------------------------
// `dev:all` stays attached to its children by design, so it is started in the
// background and observed through the ports.
startDetached('verify-first.log');
const ready = await waitForReady();
check(`first ${START_SCRIPT} brings both tiers up`, ready);

const apiPids = listenerPids(API_PORT);
const webPids = listenerPids(WEB_PORT);
check(
  'a listener holds the API port',
  (apiPids ?? []).length > 0,
  `pids ${JSON.stringify(apiPids)}`
);
check(
  'a listener holds the Web port',
  (webPids ?? []).length > 0,
  `pids ${JSON.stringify(webPids)}`
);

// --- 3. second start must adopt ------------------------------------------
const second = npm(START_SCRIPT);
const output = `${second.stdout ?? ''}${second.stderr ?? ''}`;

check(`second ${START_SCRIPT} exits 0`, second.status === 0, `exit ${second.status}`);
check(
  `second ${START_SCRIPT} reports the stack is already running`,
  /already running/i.test(output)
);
check(`second ${START_SCRIPT} reports EADDRINUSE nowhere`, !/EADDRINUSE/i.test(output));
check(`second ${START_SCRIPT} started nothing`, !/RootLco local stack is up/i.test(output));
// The adopt path proves ownership through the process tree, and in production
// mode the command line it has to recognise is `next start`. A launcher that
// did not would have reported the Owner's own stack as an unrelated process.
check(`second ${START_SCRIPT} names the running mode`, new RegExp(MODE).test(output), MODE);

// --- 3b. the OTHER mode must be refused, never adopted --------------------
// A running stack answers every readiness probe whichever mode it is in, so
// without this refusal the acceptance command would adopt a development stack
// and report the acceptance environment as up.
const otherScript = MODE === PRODUCTION ? 'dev:all' : 'acceptance:serve';
const crossed = npm(otherScript);
const crossedOut = `${crossed.stdout ?? ''}${crossed.stderr ?? ''}`;
check(
  `${otherScript} against a ${MODE} stack exits non-zero`,
  crossed.status !== 0,
  `exit ${crossed.status}`
);
check(
  `${otherScript} refuses rather than adopting the other mode`,
  /different mode/i.test(crossedOut)
);
check(`${otherScript} started nothing`, !/RootLco local stack is up/i.test(crossedOut));

check(
  'the API listener pid is unchanged',
  JSON.stringify(listenerPids(API_PORT)) === JSON.stringify(apiPids),
  `${JSON.stringify(apiPids)} -> ${JSON.stringify(listenerPids(API_PORT))}`
);
check(
  'the Web listener pid is unchanged',
  JSON.stringify(listenerPids(WEB_PORT)) === JSON.stringify(webPids),
  `${JSON.stringify(webPids)} -> ${JSON.stringify(listenerPids(WEB_PORT))}`
);
check('nothing fell back to port 3001', (listenerPids(3001) ?? []).length === 0);
check('nothing fell back to port 3101', (listenerPids(3101) ?? []).length === 0);
check('the API is still answering', await answers(`${API_ORIGIN}${API_READY_PATH}`));
check('the Web tier is still answering', await answers(`${WEB_ORIGIN}${WEB_READY_PATH}`));

// --- 4. status must be truthful ------------------------------------------
const status = npm('dev:status');
const statusOut = `${status.stdout ?? ''}${status.stderr ?? ''}`;
check('dev:status exits 0', status.status === 0, `exit ${status.status}`);
check('dev:status reports the stack as running', /VERDICT\s+RUNNING/.test(statusOut));
// The question whose wrong answer cost this phase a false 401 diagnosis.
check(
  `dev:status reports the mode as ${MODE}`,
  new RegExp(`MODE\\s+${MODE}`).test(statusOut),
  statusOut.match(/MODE\s+\S+/)?.[0] ?? '(no MODE line)'
);
check(
  'dev:status names the live listener pids',
  (apiPids ?? []).every((p) => statusOut.includes(String(p))) &&
    (webPids ?? []).every((p) => statusOut.includes(String(p)))
);
check(
  'dev:status prints localhost URLs, never the loopback literal',
  /http:\/\/localhost:3000/.test(statusOut) && !/http:\/\/127\.0\.0\.1:31?00/.test(statusOut)
);

// --- 5. stop must actually free the ports --------------------------------
const stop = npm('dev:stop');
check('dev:stop exits 0', stop.status === 0, `exit ${stop.status}`);
check('both canonical ports are free after dev:stop', await waitForPortsFree());

// --- 6. and it starts cleanly again --------------------------------------
startDetached('verify-restart.log');
check(`a fresh ${START_SCRIPT} starts a clean stack`, await waitForReady());
const restartedApi = listenerPids(API_PORT);
check(
  'the restarted stack has NEW pids, proving the stop was real',
  JSON.stringify(restartedApi) !== JSON.stringify(apiPids),
  `${JSON.stringify(apiPids)} -> ${JSON.stringify(restartedApi)}`
);

console.log('');
if (failures.length === 0) {
  console.log(`  ${step}/${step} invariants hold. Running ${START_SCRIPT} twice is safe.`);
  console.log('');
  process.exit(0);
}
console.log(`  ${failures.length} of ${step} invariants FAILED:`);
for (const f of failures) console.log(`    - ${f}`);
console.log('');
process.exit(1);
