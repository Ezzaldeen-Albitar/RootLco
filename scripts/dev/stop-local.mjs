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
import { API_PORT, STATE_FILE, WEB_PORT } from './dev-config.mjs';

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probes a CANONICAL port — one of the two compile-time constants in
 * `dev-config.mjs`, never a value read from the state file.
 *
 * `js/file-access-to-http` (CodeQL, Medium) caught the first version doing the
 * latter: `state.apiPort` came out of `dev-state.json` and flowed straight into
 * a `fetch` URL, so a file this script does not own decided where it sent a
 * request. The port authority already exists as a constant; reading it from a
 * file was both the taint and the weaker design.
 *
 * @param {typeof API_PORT | typeof WEB_PORT} port
 */
async function answering(port) {
  const url = port === API_PORT ? `http://127.0.0.1:${API_PORT}/` : `http://127.0.0.1:${WEB_PORT}/`;
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) });
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

// PIDs come from the state file — they are the whole point of it. PORTS come
// from the configuration constants, so nothing this script sends a request to
// is decided by file contents.
const targets = [
  ['api', state.apiPid, API_PORT],
  ['web', state.webPid, WEB_PORT],
];

for (const [name, , port] of targets) {
  const recorded = name === 'api' ? state.apiPort : state.webPort;
  if (recorded !== undefined && recorded !== port) {
    console.error(
      `state file records ${name} on port ${recorded}, but the configured port is ${port}. ` +
        'Probing the configured port; the state file may be from an older launcher.'
    );
  }
}

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
