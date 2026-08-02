#!/usr/bin/env node
/**
 * Stops ONLY the processes the RootLco launcher started, identified by the
 * PIDs it recorded. Never a name-based kill: the owner's editor tooling is
 * also node.exe, and `taskkill /IM node.exe` would take it down too.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { STATE_FILE } from './dev-config.mjs';

if (!existsSync(STATE_FILE)) {
  console.log('No launcher state file — nothing this script is allowed to stop.');
  process.exit(0);
}

const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
if (state.launcher !== 'rootlco-dev') {
  console.error('State file was not written by the RootLco launcher; refusing to act on it.');
  process.exit(1);
}

for (const [name, pid] of [
  ['api', state.apiPid],
  ['web', state.webPid],
]) {
  if (!pid) continue;
  try {
    process.kill(pid);
    console.log(`stopped ${name} (pid ${pid})`);
  } catch {
    console.log(`${name} (pid ${pid}) was already gone`);
  }
}

rmSync(STATE_FILE, { force: true });
console.log('launcher state cleared');
