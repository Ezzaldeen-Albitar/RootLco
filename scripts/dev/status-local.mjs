#!/usr/bin/env node
/**
 * What is ACTUALLY running — verified, not recited.
 *
 * The previous version read the state file, checked the recorded pids were
 * alive, and probed the URLs. Every one of those can be true while the answer
 * is wrong: the pids can have been reused, the state can describe a stack that
 * died and was replaced by hand, and a URL answers whoever holds the port. It
 * reported on a file, not on a machine.
 *
 * This version asks the operating system which processes hold 3000 and 3100,
 * proves ownership through the process tree, and treats the state file as a
 * claim to be checked rather than a source of truth. Read-only: it changes
 * nothing, including a state file it finds to be wrong.
 */
import { execFileSync } from 'node:child_process';
import {
  API_ORIGIN,
  API_PORT,
  API_READY_PATH,
  DEV_HOST,
  LOCK_FILE,
  STATE_FILE,
  WEB_ORIGIN,
  WEB_PORT,
  WEB_READY_PATH,
  repoRoot,
} from './dev-config.mjs';
import {
  classifyPort,
  listenersOnPorts,
  processTable,
  DiscoveryFailure,
} from './process-discovery.mjs';
import { classifyLock, readLock } from './launcher-lock.mjs';
import { readState } from './runtime-state.mjs';

const root = repoRoot();
const diagnostic = process.argv.includes('--diagnostic') || process.argv.includes('-d');

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    return `HTTP ${response.status}`;
  } catch {
    return 'no answer';
  }
}

const branch = (() => {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '(unknown)';
  }
})();
const sha = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '(unknown)';
  }
})();

console.log('RootLco local stack status');
console.log(`  checkout   ${root}`);
console.log(`  branch     ${branch || '(detached)'}`);
console.log(`  HEAD       ${sha}`);

let survey;
try {
  const listeners = listenersOnPorts([API_PORT, WEB_PORT]);
  const table = processTable();
  survey = {
    api: classifyPort({ port: API_PORT, listeners, table, repoRootPath: root, workspace: 'api' }),
    web: classifyPort({ port: WEB_PORT, listeners, table, repoRootPath: root, workspace: 'web' }),
  };
} catch (error) {
  if (error instanceof DiscoveryFailure) {
    console.log('');
    console.log('  VERDICT    UNKNOWN — the platform could not be interrogated');
    console.log(`             ${error.message}`);
    console.log('');
    console.log(
      '  Reporting "stopped" here would be a guess, and a guess that reads as good news.'
    );
    process.exitCode = 2;
  } else {
    throw error;
  }
}

if (survey) {
  const apiReady =
    survey.api.state === 'owned' ? await probe(`${API_ORIGIN}${API_READY_PATH}`) : 'not probed';
  const webReady =
    survey.web.state === 'owned' ? await probe(`${WEB_ORIGIN}${WEB_READY_PATH}`) : 'not probed';

  const { state, problem } = readState(STATE_FILE);
  const lock = readLock(LOCK_FILE);
  const lockVerdict = classifyLock(lock, root);

  const owned = (t) => survey[t].state === 'owned';
  const healthy = (t) => (t === 'api' ? apiReady : webReady) === 'HTTP 200';
  const unrelated = survey.api.state === 'unrelated' || survey.web.state === 'unrelated';

  let verdict;
  if (unrelated) verdict = 'UNRELATED PORT OWNER';
  else if (owned('api') && owned('web') && healthy('api') && healthy('web')) {
    // "Owned" means it belongs to this checkout. Whether THIS state file
    // recorded it is what separates a stack we launched from one we adopted.
    const recorded =
      state?.api?.pid === survey.api.ownerPid && state?.web?.pid === survey.web.ownerPid;
    verdict = recorded ? 'RUNNING — OWNED' : 'RUNNING — ADOPTED';
  } else if (owned('api') || owned('web')) verdict = 'PARTIAL';
  else if (state || problem) verdict = 'STALE STATE';
  else verdict = 'STOPPED';

  console.log('');
  console.log(`  VERDICT    ${verdict}`);
  console.log('');

  for (const [tier, port, origin, readyPath, ready] of [
    ['api', API_PORT, API_ORIGIN, API_READY_PATH, apiReady],
    ['web', WEB_PORT, WEB_ORIGIN, WEB_READY_PATH, webReady],
  ]) {
    const info = survey[tier];
    console.log(`  ${tier.toUpperCase()}`);
    console.log(`    url        ${origin}`);
    console.log(`    readiness  ${origin}${readyPath} -> ${ready}`);
    if (info.state === 'free') {
      console.log(`    port ${port}  nothing is listening`);
    } else if (info.state === 'owned') {
      console.log(
        `    port ${port}  held by pid ${info.pid} (listener), owned by pid ${info.ownerPid}`
      );
      console.log(`    addresses  ${info.addresses.join(', ')}`);
      if (diagnostic) console.log(`    command    ${info.command}`);
    } else {
      console.log(`    port ${port}  held by pid ${info.pid} — NOT RootLco (${info.name})`);
      console.log(`    addresses  ${info.addresses.join(', ')}`);
      console.log(`    command    ${info.command}`);
    }
    console.log('');
  }

  console.log(`  state file ${STATE_FILE}`);
  if (problem) console.log(`             UNUSABLE — ${problem}`);
  else if (!state) console.log('             absent');
  else {
    console.log(`             api pid ${state.api?.pid} (${state.api?.acquisition})`);
    console.log(`             web pid ${state.web?.pid} (${state.web?.acquisition})`);
    const agrees = state.api?.pid === survey.api.ownerPid && state.web?.pid === survey.web.ownerPid;
    console.log(`             agrees with the live processes: ${agrees ? 'yes' : 'NO'}`);
  }
  console.log(`  lock       ${lockVerdict}${lock?.pid ? ` (launcher pid ${lock.pid})` : ''}`);
  console.log('');
  console.log(`  Open ${DEV_HOST} in the browser, never 127.0.0.1 — see dev-config.mjs.`);

  if (verdict === 'UNRELATED PORT OWNER') process.exitCode = 1;
}
