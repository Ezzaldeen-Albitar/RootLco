#!/usr/bin/env node
/**
 * Proves the single-instance contract against the real machine.
 *
 *     npm run dev:verify-single-instance
 *
 * Opt-in, because it starts and stops the local servers. It touches no
 * database, no fixtures and no credentials — only processes and ports.
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

const root = repoRoot();
const failures = [];
let step = 0;

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
  const child = spawn(process.execPath, ['scripts/dev/start-local.mjs'], {
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

async function waitForReady(timeoutMs = 240_000) {
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
console.log('RootLco single-instance contract');
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
check('first dev:all brings both tiers up', ready);

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
const second = npm('dev:all');
const output = `${second.stdout ?? ''}${second.stderr ?? ''}`;

check('second dev:all exits 0', second.status === 0, `exit ${second.status}`);
check('second dev:all reports the stack is already running', /already running/i.test(output));
check('second dev:all reports EADDRINUSE nowhere', !/EADDRINUSE/i.test(output));
check('second dev:all started nothing', !/RootLco local stack is up/i.test(output));

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
check('a fresh dev:all starts a clean stack', await waitForReady());
const restartedApi = listenerPids(API_PORT);
check(
  'the restarted stack has NEW pids, proving the stop was real',
  JSON.stringify(restartedApi) !== JSON.stringify(apiPids),
  `${JSON.stringify(apiPids)} -> ${JSON.stringify(restartedApi)}`
);

console.log('');
if (failures.length === 0) {
  console.log(`  ${step}/${step} invariants hold. Running dev:all twice is safe.`);
  console.log('');
  process.exit(0);
}
console.log(`  ${failures.length} of ${step} invariants FAILED:`);
for (const f of failures) console.log(`    - ${f}`);
console.log('');
process.exit(1);
