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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  API_ORIGIN,
  API_PORT,
  API_READY_PATH,
  DEV_HOST,
  DEV_DIST_DIR,
  STATE_FILE,
  WEB_ORIGIN,
  WEB_PORT,
  repoRoot,
} from './dev-config.mjs';

const root = repoRoot();

/**
 * A production build sitting in the directory `next dev` is about to use.
 *
 * `BUILD_ID` is written by `next build` and never by `next dev`, so its presence
 * is the discriminator. See `DEV_DIST_DIR` for what a mixed directory does.
 *
 * @param {string} dir
 */
const holdsProductionBuild = (dir) => existsSync(`${dir}/BUILD_ID`);

/**
 * Clears a contaminated development build directory — but only ever AFTER
 * `assertPortFree` has proven no server is using it.
 *
 * `apps/web` is isolated by `ROOTLCO_DIST_DIR`, so this exists for `apps/api`,
 * whose configuration is Backend-owned and which a Frontend phase may not
 * change. Detecting the stale manifest and clearing it from the launcher side
 * needs no `apps/api` edit and is the strategy the runbook records.
 *
 * @param {string} workspace
 */
function clearStaleProductionBuild(workspace) {
  const dir = `${root}/apps/${workspace}/.next`;
  if (!holdsProductionBuild(dir)) return null;
  rmSync(dir, { recursive: true, force: true });
  return dir;
}

/**
 * Reports an `apps/web/.env.local` that contradicts the canonical API origin.
 *
 * That file is git-ignored, so it is invisible to every gate in this repository
 * — and Next reads it in preference to the schema default in
 * `apps/web/src/lib/env.ts`. A stale one left over from before `P1-26-F-062`
 * still says `http://127.0.0.1:3000`, which means the browser is handed the
 * broken origin no matter what the launcher, the schema and the example file
 * now agree on. Correcting the tracked defaults without noticing the untracked
 * override would have looked like a complete fix and changed nothing that runs.
 *
 * It warns rather than refuses: pointing the web tier at a different API is a
 * legitimate thing to want. What is not legitimate is it happening silently.
 */
function warnOnContradictingEnvLocal() {
  const file = `${root}/apps/web/.env.local`;
  if (!existsSync(file)) return;
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const match = contents.match(/^\s*NEXT_PUBLIC_API_BASE_URL\s*=\s*(.+?)\s*$/m);
  const configured = match?.[1]?.replace(/^["']|["']$/g, '');
  if (!configured || configured === API_ORIGIN) return;

  console.log('');
  console.log('  !! apps/web/.env.local overrides the API origin the launcher configures.');
  console.log(`       it says   ${configured}`);
  console.log(`       canonical ${API_ORIGIN}`);
  console.log('     That file is git-ignored, so nothing else in this repository can see it.');
  console.log('     The browser will be told to call the address above, and if that is a');
  console.log('     different origin from the page it will leave every table loading for ever.');
  console.log('     Fix it or delete the line unless you meant it.');
  console.log('');
}

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
    // Bound to the SAME host the servers are about to bind. This used to be the
    // `127.0.0.1` literal, which was a real hole once the servers started
    // binding by name: a stale RootLco server on `::1` left the literal free, so
    // the check passed and `next dev` then failed with EADDRINUSE — the exact
    // cryptic failure this function exists to replace.
    probe.listen(port, DEV_HOST);
  });
}

function launch(name, args, port, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: '1', ...extraEnv },
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

warnOnContradictingEnvLocal();

// Ports first. Both checks passing is what makes the directory work below safe:
// nothing is listening, so nothing is reading the build directory either.
await assertPortFree(API_PORT, 'API');
await assertPortFree(WEB_PORT, 'Web');

const clearedApi = clearStaleProductionBuild('api');
if (clearedApi) {
  console.log(`Cleared a production build left in ${clearedApi} — see P1-26-F-055.`);
  console.log('  Development and production write incompatible manifests to the same directory.');
}
if (holdsProductionBuild(`${root}/apps/web/.next`)) {
  console.log(
    `apps/web/.next holds a production build; development will use ${DEV_DIST_DIR} and leave it alone.`
  );
}

const gallery = process.env.ROOTLCO_ENABLE_GALLERY ?? 'true';
process.env.ROOTLCO_ENABLE_GALLERY = gallery;
// The address the BROWSER is told to call. `NEXT_PUBLIC_*` is inlined into the
// client bundle, so this is not a server setting: it is a literal baked into
// the page. It used to be the loopback literal while the very same launcher
// printed `localhost` — the page was served from one origin and instructed to
// call another, which is also what put `127.0.0.1` into the CSP `connect-src`
// that `src/proxy.ts` derives from this value (`P1-26-F-062`).
process.env.NEXT_PUBLIC_API_BASE_URL ??= API_ORIGIN;

// `--hostname` is passed explicitly to BOTH tiers. Next 16 defaults to
// `0.0.0.0`, which answers on every loopback address and so hides a mismatch
// between the host that is configured and the host that is advertised. Pinning
// the canonical name means the wrong origin fails to connect at all instead of
// half-working — see DEV_HOST in dev-config.mjs for the measurement.
const api = launch(
  'api',
  [nextEntry('api'), 'dev', 'apps/api', '--hostname', DEV_HOST, '--port', String(API_PORT)],
  API_PORT
);
// The web tier builds into its own directory, so `next start` — the browser
// suite, a production smoke, Docker — can never corrupt this server and this
// server can never corrupt them.
const web = launch(
  'web',
  [nextEntry('web'), 'dev', 'apps/web', '--hostname', DEV_HOST, '--port', String(WEB_PORT)],
  WEB_PORT,
  { ROOTLCO_DIST_DIR: DEV_DIST_DIR }
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

// Probed on the SAME origin that is advertised. One name for the bind, the
// probe and the printed address is what makes "it answers" mean "it answers
// where you were told to open it".
const apiStatus = await waitFor(`${API_ORIGIN}${API_READY_PATH}`, 'API');
const webStatus = await waitFor(`${WEB_ORIGIN}/en`, 'Web');

const webUrl = (path = '') => `${WEB_ORIGIN}${path}`;

console.log('');
console.log('RootLco local stack is up.');
console.log('');
console.log('  API:');
console.log(`    ${API_ORIGIN}`);
console.log('');
console.log('  API readiness:');
console.log(`    ${API_ORIGIN}${API_READY_PATH}  -> HTTP ${apiStatus}`);
console.log('');
console.log('  Web:');
console.log(`    ${WEB_ORIGIN}  (/en -> HTTP ${webStatus})`);
console.log('');
console.log('  English login:');
console.log(`    ${webUrl('/en/login')}`);
console.log('');
console.log('  Arabic login:');
console.log(`    ${webUrl('/ar/login')}`);
console.log('');
console.log(
  `  Gallery: ${gallery === 'true' ? webUrl('/en/gallery') : 'disabled (set ROOTLCO_ENABLE_GALLERY=true)'}`
);
console.log('');
console.log(
  `  Both tiers are bound to ${DEV_HOST}, so that is the only address that answers.` +
    ' Next treats it and the loopback literal as different origins in development and refuses' +
    ' its own dev resources to the other one, which leaves every table loading for ever.'
);
console.log('');
console.log('Stop with Ctrl+C here, or "npm run dev:stop" from another terminal.');
