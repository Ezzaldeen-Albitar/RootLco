#!/usr/bin/env node
/**
 * Stops the RootLco local stack — and nothing else.
 *
 * Never a name-based kill: the owner's editor tooling is also `node.exe`, and
 * `taskkill /IM node.exe` would take it down too.
 *
 * ## Why it no longer trusts the state file alone
 *
 * The previous version killed the pids the state file recorded. Two ways that
 * is wrong, both seen on this machine: the recorded pid is the `next dev`
 * parent while the LISTENER is its child, so killing the parent could leave the
 * port held; and a launcher that died leaves a state file describing pids that
 * may since have been reused by something unrelated.
 *
 * So the ports are interrogated, ownership is proved through the process tree,
 * and the whole owned chain is stopped — then the ports are re-checked. A
 * `process.kill` that does not throw is not evidence; a free port is.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { rmSync } from 'node:fs';
import { API_PORT, LOCK_FILE, STATE_FILE, WEB_PORT, repoRoot } from './dev-config.mjs';
import {
  classifyPort,
  listenersOnPorts,
  processTable,
  DiscoveryFailure,
} from './process-discovery.mjs';
import { pidAlive } from './launcher-lock.mjs';
import { readState } from './runtime-state.mjs';

const root = repoRoot();

function survey() {
  const listeners = listenersOnPorts([API_PORT, WEB_PORT]);
  const table = processTable();
  return {
    listeners,
    table,
    api: classifyPort({ port: API_PORT, listeners, table, repoRootPath: root, workspace: 'api' }),
    web: classifyPort({ port: WEB_PORT, listeners, table, repoRootPath: root, workspace: 'web' }),
  };
}

let current;
try {
  current = survey();
} catch (error) {
  if (error instanceof DiscoveryFailure) {
    console.error('Cannot determine which processes hold the canonical ports:');
    console.error(`  ${error.message}`);
    console.error('Refusing to kill anything on a guess.');
    process.exit(2);
  }
  throw error;
}

const refusals = [];
const targets = [];

for (const [tier, port] of [
  ['api', API_PORT],
  ['web', WEB_PORT],
]) {
  const info = current[tier];
  if (info.state === 'free') {
    console.log(`${tier}: port ${port} is already free.`);
    continue;
  }
  if (info.state === 'unrelated') {
    refusals.push({ tier, port, info });
    continue;
  }
  // Naming the mode being stopped, because "I stopped it" and "I stopped the
  // one I thought I was looking at" are different claims, and both modes serve
  // on the same two ports.
  console.log(`${tier}: stopping the ${info.mode ?? 'unrecognised-mode'} server on port ${port}.`);
  // The listener AND the `next dev` parent, plus the launcher that owns both if
  // it is still alive — stopping the parent alone can orphan the listener.
  for (const pid of [info.pid, info.ownerPid]) {
    if (Number.isInteger(pid) && pid > 0 && !targets.some((t) => t.pid === pid)) {
      targets.push({ pid, tier });
    }
  }
}

// The launcher process itself, but only when the state file names it AND it is
// still alive AND it belongs to this checkout. Otherwise it respawns children
// the moment they die.
const { state } = readState(STATE_FILE);
if (state?.launcherPid && state.checkout === root && pidAlive(state.launcherPid)) {
  targets.unshift({ pid: state.launcherPid, tier: 'launcher' });
}

if (refusals.length > 0) {
  for (const { tier, port, info } of refusals) {
    console.error('');
    console.error(`REFUSING to stop port ${port} (${tier}).`);
    console.error(`  owning pid   ${info.pid}`);
    console.error(`  process      ${info.name}`);
    console.error(`  command line ${info.command}`);
    console.error(`  addresses    ${info.addresses.join(', ')}`);
    console.error(
      `  This is not a RootLco server from ${root}, so it is not this script's to kill.`
    );
  }
  console.error('');
}

for (const { pid, tier } of targets) {
  if (!pidAlive(pid)) {
    console.log(`${tier}: pid ${pid} was already gone.`);
    continue;
  }
  try {
    process.kill(pid);
    console.log(`${tier}: signalled pid ${pid}.`);
  } catch (error) {
    console.log(`${tier}: could not signal pid ${pid} (${error.code ?? error.message}).`);
  }
}

// A signal is a request. Proof is the port.
//
// Only the LISTENERS are re-read in the loop. Reading the whole process table
// each time — which the first version did, once per listener per attempt —
// spawns a PowerShell process per iteration and turns a two-second wait into
// minutes.
let free = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  await delay(250);
  let remaining;
  try {
    remaining = listenersOnPorts([API_PORT, WEB_PORT]);
  } catch {
    break;
  }
  if (remaining.length === 0) {
    free = true;
    break;
  }
  // Something still holds a port. Only now is it worth asking who.
  let table;
  try {
    table = processTable();
  } catch {
    break;
  }
  const stillOurs = remaining.filter((listener) => {
    const tier = listener.port === API_PORT ? 'api' : 'web';
    return (
      classifyPort({
        port: listener.port,
        listeners: [listener],
        table,
        repoRootPath: root,
        workspace: tier,
      }).state === 'owned'
    );
  });
  if (stillOurs.length === 0) {
    free = true;
    break;
  }
}

rmSync(LOCK_FILE, { force: true });

if (!free) {
  console.error('');
  console.error('A RootLco listener is still holding a canonical port after being signalled.');
  console.error('  The launcher state file has been left in place so the pids remain visible.');
  console.error('  Inspect it: npm run dev:status -- --diagnostic');
  process.exit(1);
}

rmSync(STATE_FILE, { force: true });
console.log('');
console.log(
  refusals.length > 0
    ? 'RootLco processes stopped. The unrelated port owner above was left running.'
    : 'RootLco local stack stopped; ports 3000 and 3100 are free.'
);
process.exit(refusals.length > 0 ? 1 : 0);
