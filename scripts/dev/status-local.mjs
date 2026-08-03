#!/usr/bin/env node
/**
 * Reports the local stack's actual state: process, port, and HTTP answer.
 * Read-only — this script changes nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  API_PORT,
  API_READY_PATH,
  BROWSER_HOST,
  PROBE_HOST,
  STATE_FILE,
  WEB_PORT,
  repoRoot,
} from './dev-config.mjs';

const root = repoRoot();

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    return `HTTP ${response.status}`;
  } catch {
    return 'no answer';
  }
}

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : null;
const branch = execFileSync('git', ['branch', '--show-current'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

console.log('RootLco local stack status');
console.log(`  branch     ${branch || '(detached)'}`);
console.log(`  HEAD       ${sha}`);
console.log(
  `  state file ${state ? STATE_FILE : '(none — launcher not running or never started)'}`
);
if (state) {
  console.log(`  API pid    ${state.apiPid} (${alive(state.apiPid) ? 'alive' : 'gone'})`);
  console.log(`  Web pid    ${state.webPid} (${alive(state.webPid) ? 'alive' : 'gone'})`);
}
// Probed over the loopback literal, PRINTED as the host a browser must use.
// See BROWSER_HOST in dev-config.mjs — opening 127.0.0.1 in a browser leaves
// every client component unhydrated.
const api = (path) => `http://${PROBE_HOST}:${API_PORT}${path}`;
const web = (path) => `http://${PROBE_HOST}:${WEB_PORT}${path}`;
const shown = (port, path) => `http://${BROWSER_HOST}:${port}${path}`;

console.log(
  `  API        ${shown(API_PORT, API_READY_PATH)} -> ${await probe(api(API_READY_PATH))}`
);
console.log(`  Web /en    ${shown(WEB_PORT, '/en')} -> ${await probe(web('/en'))}`);
console.log(`  Web /ar    ${shown(WEB_PORT, '/ar')} -> ${await probe(web('/ar'))}`);
console.log(`  Gallery    ${shown(WEB_PORT, '/en/gallery')} -> ${await probe(web('/en/gallery'))}`);
console.log('');
console.log(`  Open ${BROWSER_HOST} in the browser, never 127.0.0.1 — see dev-config.mjs.`);
