#!/usr/bin/env node
/**
 * Stops the processes the RootLco launcher started.
 *
 * Never a name-based kill: the owner's editor tooling is also node.exe, and
 * `taskkill /IM node.exe` would take it down too. Only PIDs this launcher
 * recorded, and only after checking they are still alive.
 *
 * ## Why it verifies rather than assuming
 *
 * The first version printed "stopped" whenever `process.kill` did not throw,
 * and cleared the state file regardless. That produced a real failure: a
 * launcher parent died while its Next dev children kept the ports, so the
 * recorded PIDs were gone, `dev:stop` reported success, and the servers went on
 * serving. A stop command that cannot tell "stopped" from "was never mine to
 * stop" is the same defect class as a check that measures nothing.
 *
 * So it now reports one of three honest outcomes per process — stopped, already
 * gone, or still alive after the signal — and if a recorded port is still
 * answering at the end it says so and exits non-zero, naming the port rather
 * than pretending the stack is down.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { STATE_FILE } from './dev-config.mjs';

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** @param {number} port */
async function answering(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(STATE_FILE)) {
  console.log('No launcher state file — nothing this script is allowed to stop.');
  process.exit(0);
}

const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
if (state.launcher !== 'rootlco-dev') {
  console.error('State file was not written by the RootLco launcher; refusing to act on it.');
  process.exit(1);
}

const targets = [
  ['api', state.apiPid, state.apiPort],
  ['web', state.webPid, state.webPort],
];

for (const [name, pid] of targets) {
  if (!pid) continue;
  if (!alive(pid)) {
    console.log(`${name} (pid ${pid}) was already gone`);
    continue;
  }
  try {
    process.kill(pid);
  } catch {
    // It exited between the check and the signal — the next probe settles it.
  }
  await delay(400);
  console.log(alive(pid) ? `${name} (pid ${pid}) did NOT stop` : `stopped ${name} (pid ${pid})`);
}

// The ports are the truth. A recorded PID being gone does not mean the port is
// free — that is exactly the case this check exists for.
const stillUp = [];
for (const [name, , port] of targets) {
  if (port && (await answering(port))) stillUp.push(`${name} on ${port}`);
}

if (stillUp.length > 0) {
  console.error('');
  console.error(`Still answering after stop: ${stillUp.join(', ')}.`);
  console.error(
    'These are NOT processes this launcher recorded, so it will not kill them — it has no way ' +
      'to prove they are yours. Find the owner of the port and stop it deliberately:'
  );
  for (const [, , port] of targets) if (port) console.error(`  netstat -ano | findstr :${port}`);
  console.error('The launcher state file has been left in place so the PIDs remain visible.');
  process.exit(1);
}

rmSync(STATE_FILE, { force: true });
console.log('launcher state cleared');
