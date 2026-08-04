#!/usr/bin/env node
/**
 * Reports the local stack's actual state: process, port, and HTTP answer.
 * Read-only — this script changes nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  API_ORIGIN,
  API_READY_PATH,
  DEV_HOST,
  STATE_FILE,
  WEB_ORIGIN,
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
// The URL probed and the URL printed are now the same string. They used to
// differ — probe on the loopback literal, print `localhost` — which meant this
// command could report a healthy stack at an address that was never tested.
const api = (path) => `${API_ORIGIN}${path}`;
const web = (path) => `${WEB_ORIGIN}${path}`;

console.log(`  API        ${api(API_READY_PATH)} -> ${await probe(api(API_READY_PATH))}`);
console.log(`  Web        ${WEB_ORIGIN} -> ${await probe(web('/en'))}`);
console.log(`  en login   ${web('/en/login')} -> ${await probe(web('/en/login'))}`);
console.log(`  ar login   ${web('/ar/login')} -> ${await probe(web('/ar/login'))}`);
console.log(`  Gallery    ${web('/en/gallery')} -> ${await probe(web('/en/gallery'))}`);
console.log('');
console.log(`  Open ${DEV_HOST} in the browser, never 127.0.0.1 — see dev-config.mjs.`);
