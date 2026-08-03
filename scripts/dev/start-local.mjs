#!/usr/bin/env node
/**
 * The owner-visible local development launcher.
 *
 * One command from the repository root starts the full local stack:
 *
 *     npm run dev:all
 *
 * Design rules, each bought with a real Windows failure mode:
 *
 * - **Node child processes, no shell string.** `spawn` with an argument array
 *   sidesteps the cmd.exe/Git Bash quoting divergence entirely.
 * - **Own-children-only lifecycle.** PIDs are written to `.local/dev-state.json`
 *   and `stop-local.mjs` kills ONLY those PIDs (verified still alive and still
 *   node). Never `taskkill /IM node.exe` — the owner's editor tooling is also
 *   node.
 * - **Ports are asserted before launch.** A port already in use produces a
 *   named error naming the port and the state file, not a cryptic EADDRINUSE
 *   five seconds into a Next boot.
 * - **Readiness is polled, then printed.** The launcher exits its wait loop
 *   only when both HTTP surfaces answer, so "it started" means "it answers",
 *   not "the process exists".
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
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

function assertPortFree(port, owner) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(
        new Error(
          `Port ${port} (${owner}) is already in use. If a previous RootLco launcher owns it, ` +
            `run "npm run dev:stop"; otherwise choose the process yourself — this launcher ` +
            `never kills anything it did not start.`
        )
      )
    );
    probe.once('listening', () => probe.close(() => resolve()));
    probe.listen(port, '127.0.0.1');
  });
}

function launch(name, args, port) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `[${name}] `;
  const forward = (stream, out) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/))
        if (line.trim()) out.write(prefix + line + '\n');
    });
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  return child;
}

async function waitFor(url, label, timeoutMs = 180_000) {
  const start = Date.now();
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      // Readiness may legitimately be 503 while Supabase is down; the surface
      // ANSWERING is what "the process is up" means. The verdict is reported.
      return response.status;
    } catch {
      if (Date.now() - start > timeoutMs)
        throw new Error(`${label} did not answer within ${timeoutMs / 1000}s at ${url}`);
      await delay(1_500);
    }
  }
}

// The workspaces hoist next to the root — resolve wherever npm put it.
const nextBin = (ws) => `${root}/apps/${ws}/node_modules/next/dist/bin/next`;
const nextEntry = (ws) =>
  existsSync(nextBin(ws)) ? nextBin(ws) : `${root}/node_modules/next/dist/bin/next`;

await assertPortFree(API_PORT, 'API');
await assertPortFree(WEB_PORT, 'Web');

const gallery = process.env.ROOTLCO_ENABLE_GALLERY ?? 'true';
process.env.ROOTLCO_ENABLE_GALLERY = gallery;
process.env.NEXT_PUBLIC_API_BASE_URL ??= `http://127.0.0.1:${API_PORT}`;

const api = launch(
  'api',
  [nextEntry('api'), 'dev', 'apps/api', '--port', String(API_PORT)],
  API_PORT
);
const web = launch(
  'web',
  [nextEntry('web'), 'dev', 'apps/web', '--port', String(WEB_PORT)],
  WEB_PORT
);

mkdirSync(`${root}/.local`, { recursive: true });
writeFileSync(
  STATE_FILE,
  `${JSON.stringify(
    {
      launcher: 'rootlco-dev',
      apiPid: api.pid,
      webPid: web.pid,
      apiPort: API_PORT,
      webPort: WEB_PORT,
      startedFrom: root,
    },
    null,
    2
  )}\n`
);

let dying = false;
const shutdown = (code) => {
  if (dying) return;
  dying = true;
  for (const child of [api, web]) if (child.exitCode === null) child.kill();
  process.exit(code);
};
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
api.on('exit', (code) => {
  if (!dying) {
    console.error(`[api] exited unexpectedly with code ${code}`);
    shutdown(code ?? 1);
  }
});
web.on('exit', (code) => {
  if (!dying) {
    console.error(`[web] exited unexpectedly with code ${code}`);
    shutdown(code ?? 1);
  }
});

// Probes are server-to-server, so the loopback literal is fine and avoids any
// dependence on name resolution. The addresses PRINTED are what a browser will
// open, and those must be `localhost` — see BROWSER_HOST.
const apiStatus = await waitFor(`http://${PROBE_HOST}:${API_PORT}${API_READY_PATH}`, 'API');
const webStatus = await waitFor(`http://${PROBE_HOST}:${WEB_PORT}/en`, 'Web');

const webUrl = (path = '') => `http://${BROWSER_HOST}:${WEB_PORT}${path}`;

console.log('');
console.log('RootLco local stack is up.');
console.log(
  `  API   http://${BROWSER_HOST}:${API_PORT}  (readiness ${API_READY_PATH} -> HTTP ${apiStatus})`
);
console.log(`  Web   ${webUrl()}  (/en -> HTTP ${webStatus})`);
console.log(`  en    ${webUrl('/en')}`);
console.log(`  ar    ${webUrl('/ar')}`);
console.log(
  `  gallery ${gallery === 'true' ? webUrl('/en/gallery') : 'disabled (set ROOTLCO_ENABLE_GALLERY=true)'}`
);
console.log('');
console.log(
  `  Open ${BROWSER_HOST}, not 127.0.0.1: Next treats them as different origins in development` +
    ' and refuses its own dev resources to the other one, which leaves every table loading for ever.'
);
console.log('');
console.log('Stop with Ctrl+C here, or "npm run dev:stop" from another terminal.');
