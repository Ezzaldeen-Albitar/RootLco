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
 *
 * ## It reports the MODE, and reads it off the live processes
 *
 * "Which mode is this" is the question whose wrong answer cost this phase a
 * false 401 diagnosis: a `next dev` stack compiles each route on first request,
 * and a route bundle compiled without having run the API's IAM composition
 * refuses a perfectly valid bearer token on an arbitrary subset of routes. An
 * operator who believes they are on a production build attributes that to the
 * product.
 *
 * So the mode is derived from the argv of the processes actually holding the
 * ports — not from the state file, which can be stale, absent for an adopted
 * stack, or describe a stack that died and was replaced by hand. The state
 * file's claim is printed too, and printed as AGREEING or NOT.
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
import { observedMode } from './local-stack-plan.mjs';
import { DEVELOPMENT, PRODUCTION, describeMode } from './launch-mode.mjs';

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

  const mode = observedMode(survey);
  if (mode.verdict === 'none') {
    console.log('  MODE       n/a — nothing of ours is running');
  } else if (mode.verdict === 'mixed') {
    console.log(`  MODE       MIXED — ${mode.modes.map((m) => `${m.tier}=${m.mode}`).join(', ')}`);
    console.log('             The two tiers are serving different modes. Stop the stack and');
    console.log('             start one mode: npm run dev:stop, then dev:all OR acceptance:serve.');
    process.exitCode = 1;
  } else if (mode.verdict === 'unknown') {
    console.log('  MODE       UNKNOWN — a command line named no Next subcommand we serve with');
    for (const m of mode.modes) console.log(`             ${m.tier}: ${survey[m.tier].command}`);
  } else {
    console.log(`  MODE       ${describeMode(mode.verdict)}`);
    console.log("             read from the running processes' own command lines");
    if (mode.verdict === DEVELOPMENT) {
      console.log('             This is NOT the Owner acceptance configuration. A development');
      console.log('             server compiles each route on first request, and a route');
      console.log('             compiled without the API IAM composition refuses a valid token');
      console.log('             on an arbitrary subset of routes. Use npm run acceptance:serve.');
    }
    if (mode.verdict === PRODUCTION) {
      console.log('             This is the Owner acceptance configuration. Code changes are');
      console.log('             not picked up until the stack is stopped and started again.');
    }
  }
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
      console.log(`    mode       ${info.mode ?? 'unknown'}`);
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
    console.log(`             mode recorded as ${state.mode ?? '(not recorded)'}`);
    const agrees = state.api?.pid === survey.api.ownerPid && state.web?.pid === survey.web.ownerPid;
    console.log(`             agrees with the live processes: ${agrees ? 'yes' : 'NO'}`);
    // The file's claim about the mode is checked against the measurement, not
    // printed beside it and left for a reader to compare.
    if (mode.verdict === DEVELOPMENT || mode.verdict === PRODUCTION) {
      const modeAgrees = state.mode === mode.verdict;
      console.log(
        `             mode agrees with the live processes: ${modeAgrees ? 'yes' : `NO — running ${mode.verdict}`}`
      );
    }
  }
  console.log(`  lock       ${lockVerdict}${lock?.pid ? ` (launcher pid ${lock.pid})` : ''}`);
  console.log('');
  console.log(`  Open ${DEV_HOST} in the browser, never 127.0.0.1 — see dev-config.mjs.`);

  if (verdict === 'UNRELATED PORT OWNER') process.exitCode = 1;
}
