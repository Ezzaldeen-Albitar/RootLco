#!/usr/bin/env node
/**
 * The owner-visible local launcher, in either of two modes.
 *
 *     npm run dev:all            development — next dev, compiled on demand
 *     npm run acceptance:serve   production  — next build, then next start
 *
 * Running either twice is safe. The second run adopts the stack the first one
 * started and exits 0.
 *
 * ## Why there is a production mode — the false 401
 *
 * `next dev` compiles a route bundle the first time that route is requested.
 * The API's authenticator is a module-level singleton installed as a SIDE
 * EFFECT of composing the IAM module inside the login handler, so a route
 * bundle Next compiled on demand WITHOUT having run that composition still
 * holds the unconfigured authenticator — which fails closed.
 *
 * Measured twice on this checkout, ONE valid owner bearer token, ONE process:
 * `GET /api/v1/receptions` answered 200 while `GET /api/v1/vehicles` and
 * `GET /api/v1/work-orders` answered 401 `ERR-IAM-002`; a second `next dev`
 * process refused a completely different subset. On a production `next build`
 * plus `next start` of the same tree, every one of them answered 200.
 *
 * The Owner acceptance environment is started by this launcher. In development
 * mode it can therefore refuse authenticated reads on an arbitrary subset of
 * routes and manufacture product defects that do not exist. The acceptance
 * stack must be the production mode; `next dev` stays untouched for ordinary
 * development, where compile-on-demand is the entire point.
 *
 * Everything else in this file is mode-agnostic on purpose. The lock, the
 * process discovery, the enumerated plan, the readiness rule and the state file
 * are ONE implementation serving both modes — a second launcher that could also
 * spawn is exactly the duplicate-stack defect this file was rebuilt to prevent.
 *
 * ## The defect this was rebuilt around — `P1-26-F-063`
 *
 * The previous version asked "is this port free?" by binding it, and on Windows
 * a bind probe only conflicts with a listener holding the SAME address. Against
 * a live stack bound to `::1`, binding `127.0.0.1`, `0.0.0.0` and `::` all
 * SUCCEEDED. So the check passed, two children were spawned, Next bound with
 * exclusive semantics and both died with `EADDRINUSE` — and then the readiness
 * probe fetched the URL, the ORIGINAL server answered 200, and the launcher
 * printed "RootLco local stack is up" over two corpses.
 *
 * Three fixes, none of which is a sleep or a retry:
 *
 * 1. Ports are no longer probed by binding. The operating system is asked which
 *    process holds them, and the answer is classified against this checkout by
 *    walking the process tree (`process-discovery.mjs`).
 * 2. One enumerated decision is made before anything is spawned
 *    (`local-stack-plan.mjs`), and `ADOPT_EXISTING` returns before the spawn
 *    path exists.
 * 3. Readiness is only ever claimed for a child THIS launcher is still watching.
 *    A dead child fails the wait instead of borrowing the incumbent's 200.
 *
 * Design rules retained from earlier rounds, each bought with a real failure:
 *
 * - **Node child processes, no shell string.** `spawn` with an argument array
 *   sidesteps the cmd.exe/Git Bash quoting divergence entirely.
 * - **Own-children-only lifecycle.** Never `taskkill /IM node.exe` — the
 *   owner's editor tooling is also node.
 * - **Readiness is polled, then printed.** "It started" means "it answers".
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import {
  API_ORIGIN,
  API_PORT,
  API_READY_PATH,
  DEV_HOST,
  DEV_DIST_DIR,
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
import { acquireLock, releaseLock } from './launcher-lock.mjs';
import { buildState, readState, writeStateAtomic } from './runtime-state.mjs';
import { maySpawn, planLocalStack } from './local-stack-plan.mjs';
import {
  DEVELOPMENT,
  PRODUCTION,
  describeMode,
  nextSubcommandFor,
  parseModeArgv,
} from './launch-mode.mjs';

const root = repoRoot();

/** The production build directory. `next build` and `next start` both use it. */
const PRODUCTION_DIST_DIR = '.next';

/**
 * A production build sitting in the directory `next dev` is about to use.
 * `BUILD_ID` is written by `next build` and never by `next dev`.
 * @param {string} dir
 */
const holdsProductionBuild = (dir) => existsSync(`${dir}/BUILD_ID`);

/**
 * Clears a contaminated development build directory — only ever when we are
 * about to start that tier, so nothing is reading it.
 *
 * Two things it must NOT do, both of which it would have done if this were
 * still a one-line existence check:
 *
 * 1. **Never in production mode.** The directory it clears is the one the
 *    production build was just written into. Clearing it there would delete the
 *    thing about to be served.
 * 2. **Never for a tier whose development server reads somewhere else.** The
 *    web tier develops into `.next-dev`, so its `.next` is not in its way at
 *    all — and since the production acceptance stack lives in `.next`, wiping
 *    it on every `dev:all` would silently force a full rebuild before the next
 *    acceptance session. The API tier's development server does use `.next`,
 *    so for that tier the clear is still exactly right.
 *
 * @param {'api'|'web'} workspace
 * @param {string} mode
 */
function clearStaleProductionBuild(workspace, mode) {
  if (mode !== DEVELOPMENT) return null;
  if (TIERS[workspace].devDistDir !== PRODUCTION_DIST_DIR) return null;
  const dir = `${root}/apps/${workspace}/${PRODUCTION_DIST_DIR}`;
  if (!holdsProductionBuild(dir)) return null;
  rmSync(dir, { recursive: true, force: true });
  return dir;
}

/**
 * Reports an `apps/web/.env.local` that contradicts the canonical API origin.
 * Git-ignored, read by Next in preference to the schema default, and invisible
 * to every gate in this repository (`P1-26-F-062`).
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
  console.log('     Fix it or delete the line unless you meant it.');
  console.log('');
}

/** The workspaces hoist next to the root — resolve wherever npm put it. */
const nextBin = (ws) => `${root}/apps/${ws}/node_modules/next/dist/bin/next`;
const nextEntry = (ws) =>
  existsSync(nextBin(ws)) ? nextBin(ws) : `${root}/node_modules/next/dist/bin/next`;

const TIERS = {
  api: {
    label: 'api',
    port: API_PORT,
    origin: API_ORIGIN,
    readyPath: API_READY_PATH,
    // The API's development server has no isolated directory of its own, so it
    // shares `.next` with the production build — which is why the stale-build
    // clear below still applies to this tier and not to the web one.
    devDistDir: PRODUCTION_DIST_DIR,
    env: { development: {}, production: {} },
  },
  web: {
    label: 'web',
    port: WEB_PORT,
    origin: WEB_ORIGIN,
    readyPath: WEB_READY_PATH,
    devDistDir: DEV_DIST_DIR,
    // Development is redirected to `.next-dev` (`P1-26-F-055`). Production is
    // deliberately NOT — `next build` and `next start` must agree on `.next`,
    // which is also what Docker, the browser suite and CI use.
    env: { development: { ROOTLCO_DIST_DIR: DEV_DIST_DIR }, production: {} },
  },
};

/**
 * The exact argv a tier is started with. Also what ownership matches on.
 *
 * The subcommand is the ONLY difference between the two modes here, and it is
 * derived from the mode rather than branched on, so a third caller cannot
 * invent a spelling. It is also what `nextModeOfCommand` reads back off the
 * live process, which is how `dev:status` reports a mode it can prove.
 */
export function tierArgs(tier, mode) {
  const { port } = TIERS[tier];
  return [
    nextEntry(tier),
    nextSubcommandFor(mode),
    `apps/${tier}`,
    '--hostname',
    DEV_HOST,
    '--port',
    String(port),
  ];
}

/** The argv that produces the build `next start` will serve. */
function buildArgs(tier) {
  return [nextEntry(tier), 'build', `apps/${tier}`];
}

/** stdout and stderr, one line at a time, tagged with the tier they came from. */
function forwardOutput(child, label) {
  const prefix = `[${label}] `;
  const forward = (stream, out) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/))
        if (line.trim()) out.write(prefix + line + '\n');
    });
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
}

function tierEnv(tier, mode) {
  const spec = TIERS[tier];
  return {
    ...process.env,
    PORT: String(spec.port),
    NEXT_TELEMETRY_DISABLED: '1',
    ...spec.env[mode],
  };
}

function launch(tier, mode) {
  const spec = TIERS[tier];
  const child = spawn(process.execPath, tierArgs(tier, mode), {
    cwd: root,
    env: tierEnv(tier, mode),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  forwardOutput(child, spec.label);
  return child;
}

/**
 * Compiles one tier for production, and REFUSES to continue if it fails.
 *
 * Awaited, never fire-and-forget. A failed build that is not waited for leaves
 * `next start` serving whatever was in `.next` from an earlier commit — a stack
 * that is up, answers every probe, and is not the tree anybody asked about.
 * That is the same class of wrong answer as the false 401.
 *
 * There is deliberately no `--skip-build` escape hatch. An acceptance
 * environment serving a build nobody can date is worse than a slow one, and the
 * fast path already exists: it is called development mode.
 */
function buildTier(tier) {
  return new Promise((resolve, reject) => {
    const spec = TIERS[tier];
    console.log(`  building ${spec.label} for production…`);
    const child = spawn(process.execPath, buildArgs(tier), {
      cwd: root,
      env: tierEnv(tier, PRODUCTION),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    forwardOutput(child, `${spec.label} build`);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        // `BUILD_ID` is written by `next build` and by nothing else, so its
        // presence is the proof that a build really landed. A zero exit code is
        // the build's own claim about itself.
        const dir = `${root}/apps/${tier}/${PRODUCTION_DIST_DIR}`;
        if (!holdsProductionBuild(dir)) {
          reject(
            new Error(
              `${spec.label} build exited 0 but wrote no BUILD_ID to ${dir}. Refusing to serve a build that is not there.`
            )
          );
          return;
        }
        resolve();
        return;
      }
      reject(new Error(`${spec.label} production build failed with exit code ${code}`));
    });
  });
}

/**
 * Waits for a URL, but only while the child that should be serving it is alive.
 *
 * The `child` argument is the whole correction. Without it a dead child's
 * readiness is satisfied by whatever else happens to hold the port, which is
 * precisely how "stack is up" got printed over two `EADDRINUSE` failures.
 */
async function waitFor(url, label, child, timeoutMs = 180_000) {
  const start = Date.now();
  for (;;) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `${label} exited with code ${child.exitCode} before it answered. ` +
          `Anything answering ${url} now is NOT this launcher's process.`
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return response.status;
    } catch {
      if (Date.now() - start > timeoutMs)
        throw new Error(`${label} did not answer within ${timeoutMs / 1000}s at ${url}`);
      await delay(1_500);
    }
  }
}

/** One readiness check with no child attached — used to judge existing servers. */
async function answers(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Everything the decision needs, gathered once.
 *
 * The requested `mode` travels in the survey rather than as a second argument
 * to `planLocalStack`, because the plan's whole contract is "one pure function,
 * facts in, one enumerated verdict out". Which mode was asked for is one of the
 * facts, and the tiers report which mode they are actually SERVING, so the plan
 * can compare the two without asking anything itself.
 */
async function surveyStack(mode) {
  const listeners = listenersOnPorts([API_PORT, WEB_PORT]);
  const table = processTable();
  const api = classifyPort({
    port: API_PORT,
    listeners,
    table,
    repoRootPath: root,
    workspace: 'api',
  });
  const web = classifyPort({
    port: WEB_PORT,
    listeners,
    table,
    repoRootPath: root,
    workspace: 'web',
  });
  const apiHealthy =
    api.state === 'owned' ? await answers(`${API_ORIGIN}${API_READY_PATH}`) : false;
  const webHealthy =
    web.state === 'owned' ? await answers(`${WEB_ORIGIN}${WEB_READY_PATH}`) : false;
  return { listeners, table, api, web, apiHealthy, webHealthy, mode };
}

/**
 * The mode line, printed everywhere a stack is reported.
 *
 * It is the answer to the question whose wrong answer cost this phase a false
 * 401 diagnosis, so it is never left to be inferred from which command was
 * typed. Where a live stack is being described the mode is read back off the
 * running processes; where one is being started it is the mode we started.
 */
function printMode(mode, { observed = false } = {}) {
  console.log('');
  console.log(`  MODE: ${describeMode(mode)}`);
  if (observed) console.log("        read from the running processes' own command lines");
  if (mode === DEVELOPMENT) {
    console.log('        NOT the Owner acceptance configuration — see npm run acceptance:serve.');
  }
}

function printOrigins({ apiStatus, webStatus }) {
  console.log('');
  console.log('  API:');
  console.log(`    ${API_ORIGIN}`);
  console.log('');
  console.log('  API readiness:');
  console.log(`    ${API_ORIGIN}${API_READY_PATH}${apiStatus ? `  -> HTTP ${apiStatus}` : ''}`);
  console.log('');
  console.log('  Web:');
  console.log(`    ${WEB_ORIGIN}${webStatus ? `  (${WEB_READY_PATH} -> HTTP ${webStatus})` : ''}`);
  console.log('');
  console.log('  English login:');
  console.log(`    ${WEB_ORIGIN}/en/login`);
  console.log('');
  console.log('  Arabic login:');
  console.log(`    ${WEB_ORIGIN}/ar/login`);
  console.log('');
}

function reportRefusal(blocked) {
  console.error('');
  console.error('RootLco will not start: a canonical port belongs to something else.');
  console.error('');
  for (const { tier, detail } of blocked) {
    const port = tier === 'api' ? API_PORT : WEB_PORT;
    console.error(`  port ${port} (${tier})`);
    console.error(`    owning pid   ${detail.pid}`);
    console.error(`    process      ${detail.name}`);
    console.error(`    command line ${detail.command}`);
    console.error(`    addresses    ${(detail.addresses ?? []).join(', ') || '(unknown)'}`);
    console.error(
      `    why not ours no ancestor of this process runs "next dev apps/${tier}" from ${root}`
    );
    console.error('');
  }
  console.error('  This launcher never kills a process it cannot prove it started, and it never');
  console.error('  moves RootLco to another port. Inspect it yourself:');
  console.error('');
  console.error('    Get-NetTCPConnection -State Listen -LocalPort 3000,3100 |');
  console.error('      Select-Object LocalAddress, LocalPort, OwningProcess');
  console.error('    Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" |');
  console.error('      Select-Object ProcessId, Name, CommandLine');
  console.error('');
}

/**
 * The stack is ours, from this checkout, and serving the OTHER mode.
 *
 * Nothing is killed and nothing is started. A `next dev` stack answers every
 * readiness probe a `next start` stack answers, so silently adopting one would
 * report the acceptance environment as up while handing the Owner the exact
 * compile-on-demand refusals the production mode exists to remove.
 */
function reportModeMismatch(plan) {
  console.error('');
  console.error('RootLco will not start: the running stack is serving a different mode.');
  console.error('');
  console.error(`  asked for   ${describeMode(plan.mode)}`);
  for (const { tier, running, detail } of plan.mismatched) {
    console.error(`  ${tier} is running ${describeMode(running)}`);
    console.error(`    owning pid   ${detail.ownerPid}`);
    console.error(`    command line ${detail.command}`);
  }
  console.error('');
  console.error('  A mode is a property of the whole stack, not of one tier, and the two are');
  console.error('  not interchangeable: a development server compiles each route on first');
  console.error('  request, which is what makes an authenticated read fail on some routes and');
  console.error('  not others. Adopting half of one would produce a stack nobody can reproduce.');
  console.error('');
  console.error('  Stop it and start the mode you want:');
  console.error('');
  console.error('    npm run dev:stop');
  console.error('    npm run acceptance:serve      # production, for Owner acceptance');
  console.error('    npm run dev:all               # development');
  console.error('');
}

/** Stops one verified-ours listener whose server is not answering. */
async function stopUnhealthyOwned(tier, detail) {
  const pids = [detail.ownerPid, detail.pid].filter(
    (p, index, all) => Number.isInteger(p) && p > 0 && all.indexOf(p) === index
  );
  console.log(`  ${tier}: a RootLco process from this checkout holds the port and is not`);
  console.log(`      answering. Stopping only pid(s) ${pids.join(', ')} and replacing it.`);
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(250);
    const still = listenersOnPorts([tier === 'api' ? API_PORT : WEB_PORT]);
    if (still.length === 0) return true;
  }
  return false;
}

/**
 * The "already running" report.
 *
 * Reached from two directions, which is why it is a function. The obvious one
 * is a second `dev:all` after the first launcher exited. The COMMON one is a
 * second `dev:all` while the first is still attached in another terminal —
 * that hits the lock, and the first version of this stopped there and printed
 * lock contention. Technically true, useless to the Owner, and not what the
 * contract promises: the question they asked is "is my stack up", and the
 * answer is yes.
 */
function reportAdopted(survey, { repairState }) {
  console.log('');
  console.log('RootLco local stack is already running.');
  console.log('');
  console.log(`  API pid ${survey.api.ownerPid} (listener ${survey.api.pid})`);
  console.log(`  Web pid ${survey.web.ownerPid} (listener ${survey.web.pid})`);
  // The mode of an ADOPTED stack is whatever the running processes say it is.
  // The plan has already refused anything that disagrees with what was asked
  // for, so these two are the same fact — but this one is the measured one.
  const observed = survey.api.mode ?? survey.web.mode ?? survey.mode;
  printMode(observed, { observed: true });
  if (repairState) {
    const existing = readState(STATE_FILE);
    writeStateAtomic(
      STATE_FILE,
      buildState({
        checkout: root,
        launcherPid: null,
        mode: observed,
        api: {
          pid: survey.api.ownerPid,
          listenerPid: survey.api.pid,
          port: API_PORT,
          command: survey.api.command,
          acquisition: 'adopted',
        },
        web: {
          pid: survey.web.ownerPid,
          listenerPid: survey.web.pid,
          port: WEB_PORT,
          command: survey.web.command,
          acquisition: 'adopted',
        },
        origin: { api: API_ORIGIN, web: WEB_ORIGIN },
      })
    );
    console.log(
      existing.problem ? `  state file repaired (${existing.problem})` : '  state file refreshed'
    );
  } else {
    // The live launcher owns the state file; rewriting it underneath would make
    // its recorded launcher pid disagree with reality.
    console.log('  state file left to the running launcher');
  }
  printOrigins({});
  console.log('  Nothing was started. Stop it with "npm run dev:stop".');
  console.log('');
}

async function main() {
  // The mode is settled BEFORE anything else happens, and an argument this
  // launcher does not recognise stops it. `dev:all --produciton` quietly
  // starting a development stack would leave an operator certain they were
  // looking at a production build — the single belief this whole mode exists to
  // make impossible.
  const { mode, errors } = parseModeArgv(process.argv.slice(2));
  if (errors.length > 0) {
    console.error('');
    console.error('RootLco will not start: the command line was not understood.');
    for (const error of errors) console.error(`  ${error}`);
    console.error('');
    console.error('    npm run dev:all               development');
    console.error('    npm run acceptance:serve      production');
    console.error('');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`RootLco local stack — ${describeMode(mode)}`);

  warnOnContradictingEnvLocal();

  const lock = acquireLock(LOCK_FILE, {
    checkout: root,
    command: mode === PRODUCTION ? 'npm run acceptance:serve' : 'npm run dev:all',
  });
  if (!lock.acquired) {
    // Another launcher is mid-flight. Do NOT spawn: that is exactly how two
    // stacks appear. But still answer the question that was asked.
    if (lock.reason === 'foreign') {
      console.error('');
      console.error(`Another RootLco launcher (pid ${lock.lock.pid}) is running for a DIFFERENT`);
      console.error(`checkout: ${lock.lock.checkout}`);
      console.error("Its ports and its state are not this checkout's to reason about.");
      process.exitCode = 1;
      return;
    }
    let held;
    try {
      held = await surveyStack(mode);
    } catch {
      held = null;
    }
    if (held && planLocalStack(held).decision === 'ADOPT_EXISTING') {
      reportAdopted(held, { repairState: false });
      console.log(`  (a launcher is attached to it in another terminal, pid ${lock.lock.pid})`);
      console.log('');
      return;
    }
    console.log('');
    console.log(`A RootLco launcher is already starting this checkout (pid ${lock.lock.pid}).`);
    console.log('Not starting a second one. Check progress with: npm run dev:status');
    return;
  }

  let releaseOnExit = true;
  try {
    let survey;
    try {
      survey = await surveyStack(mode);
    } catch (error) {
      if (error instanceof DiscoveryFailure) {
        console.error('');
        console.error('RootLco cannot determine which processes hold the canonical ports.');
        console.error(`  ${error.message}`);
        console.error('');
        console.error('  Refusing to start rather than guessing: starting blind is how the');
        console.error('  duplicate-stack defect happened in the first place.');
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    const plan = planLocalStack(survey);

    if (plan.decision === 'REFUSE_UNRELATED') {
      reportRefusal(plan.blocked);
      process.exitCode = 1;
      return;
    }

    if (plan.decision === 'REFUSE_MODE_MISMATCH') {
      // Also an early return above the spawn, for the same reason the two either
      // side of it are: adopting a stack in the other mode would report the
      // acceptance environment as up while serving the configuration that
      // manufactures 401s.
      reportModeMismatch(plan);
      process.exitCode = 1;
      return;
    }

    if (plan.decision === 'ADOPT_EXISTING') {
      // THE EARLY RETURN. Everything below this block spawns processes; this
      // path must never reach it. `tests/ci/local-stack-single-instance.test.ts`
      // asserts this block's LAST statement is `return;`, because an earlier
      // version only asserted a return existed somewhere between here and the
      // spawn — and a mutation deleting this one still passed.
      reportAdopted(survey, { repairState: true });
      return;
    }

    if (plan.recover.length > 0) {
      console.log('');
      for (const tier of plan.recover) {
        const detail = tier === 'api' ? survey.api : survey.web;
        const freed = await stopUnhealthyOwned(tier, detail);
        if (!freed) {
          console.error(
            `  ${tier}: the port did not become free after stopping our own process. Refusing to continue.`
          );
          process.exitCode = 1;
          return;
        }
      }
    }

    const toStart = [...plan.start, ...plan.recover];

    // Belt and braces, and not decoration: the early returns above are what
    // normally prevent a spawn, and a mutation test proved an earlier version of
    // this file could lose one without any suite noticing. This makes the rule
    // enforced at runtime rather than merely asserted about the source, so
    // deleting a `return` produces a loud refusal instead of a second stack.
    if (!maySpawn(plan.decision)) {
      throw new Error(
        `refusing to start anything on a ${plan.decision} verdict — this is a launcher bug, ` +
          `not a machine problem. Plan: ${JSON.stringify(plan)}`
      );
    }
    if (plan.adopt.length > 0) {
      console.log('');
      console.log(
        `  Adopting the running ${plan.adopt.join(' and ')} tier; starting only ${toStart.join(' and ')}.`
      );
    }

    for (const tier of toStart) {
      const cleared = clearStaleProductionBuild(tier, mode);
      if (cleared) {
        console.log(`Cleared a production build left in ${cleared} — see P1-26-F-055.`);
      }
    }
    if (
      mode === DEVELOPMENT &&
      toStart.includes('web') &&
      holdsProductionBuild(`${root}/apps/web/${PRODUCTION_DIST_DIR}`)
    ) {
      console.log(
        `apps/web/${PRODUCTION_DIST_DIR} holds a production build; development will use ${DEV_DIST_DIR} and leave it alone.`
      );
    }

    // THE ENVIRONMENT IS SETTLED BEFORE THE BUILD, NOT BEFORE THE SPAWN.
    //
    // Every `NEXT_PUBLIC_*` value is inlined by Next during `next build`, so in
    // production mode a variable set after the build reaches nothing. Setting
    // these three afterwards would produce a stack that is up, answers every
    // probe, and has the wrong API origin baked into the client bundle.
    const gallery = process.env.ROOTLCO_ENABLE_GALLERY ?? 'true';
    process.env.ROOTLCO_ENABLE_GALLERY = gallery;
    process.env.NEXT_PUBLIC_API_BASE_URL ??= API_ORIGIN;
    if (mode === PRODUCTION) {
      // `local` is what keeps the session cookie unmarked `Secure`. The schema
      // in `apps/web/src/lib/env.ts` defaults to `production` deliberately — the
      // unsafe mode is the one you have to ask for — and a `Secure` cookie is
      // discarded in silence by a browser on a plain-HTTP origin, so the Owner
      // would sign in successfully and land back on the login page. It is a
      // BUILD-time value, which is why it is set here and not at start.
      process.env.NEXT_PUBLIC_APP_ENV ??= 'local';
      console.log('');
      console.log(`  NEXT_PUBLIC_API_BASE_URL  ${process.env.NEXT_PUBLIC_API_BASE_URL}`);
      console.log(`  NEXT_PUBLIC_APP_ENV       ${process.env.NEXT_PUBLIC_APP_ENV}`);
      console.log(
        '  Both are inlined by next build, so they are fixed for the life of this stack.'
      );
      console.log('');
      for (const tier of toStart) await buildTier(tier);
    }

    /** @type {Record<string, import('node:child_process').ChildProcess>} */
    const children = {};
    for (const tier of toStart) children[tier] = launch(tier, mode);

    mkdirSync(join(root, '.local'), { recursive: true });

    let dying = false;
    const shutdown = (code) => {
      if (dying) return;
      dying = true;
      for (const child of Object.values(children)) if (child.exitCode === null) child.kill();
      releaseLock(LOCK_FILE);
      process.exit(code);
    };
    process.on('SIGINT', () => shutdown(0));
    process.on('SIGTERM', () => shutdown(0));
    for (const [tier, child] of Object.entries(children)) {
      child.on('exit', (code) => {
        if (!dying) {
          console.error(`[${tier}] exited unexpectedly with code ${code}`);
          shutdown(code ?? 1);
        }
      });
    }

    // Readiness is bound to OUR child where we started one.
    const apiStatus = children.api
      ? await waitFor(`${API_ORIGIN}${API_READY_PATH}`, 'API', children.api)
      : 'adopted';
    const webStatus = children.web
      ? await waitFor(`${WEB_ORIGIN}${WEB_READY_PATH}`, 'Web', children.web)
      : 'adopted';

    const describe = (tier) =>
      children[tier]
        ? {
            pid: children[tier].pid,
            acquisition: 'spawned',
            command: tierArgs(tier, mode).join(' '),
          }
        : {
            pid: (tier === 'api' ? survey.api : survey.web).ownerPid,
            listenerPid: (tier === 'api' ? survey.api : survey.web).pid,
            acquisition: 'adopted',
            command: (tier === 'api' ? survey.api : survey.web).command,
          };

    writeStateAtomic(
      STATE_FILE,
      buildState({
        checkout: root,
        launcherPid: process.pid,
        mode,
        api: { ...describe('api'), port: API_PORT },
        web: { ...describe('web'), port: WEB_PORT },
        origin: { api: API_ORIGIN, web: WEB_ORIGIN },
      })
    );

    console.log('');
    console.log('RootLco local stack is up.');
    printMode(mode);
    printOrigins({ apiStatus, webStatus });
    console.log(
      `  Gallery: ${gallery === 'true' ? `${WEB_ORIGIN}/en/gallery` : 'disabled (set ROOTLCO_ENABLE_GALLERY=true)'}`
    );
    console.log('');
    console.log(
      `  Both tiers are bound to ${DEV_HOST}, so that is the only address that answers.` +
        ' Next treats it and the loopback literal as different origins in development.'
    );
    console.log('');
    const again = mode === PRODUCTION ? 'npm run acceptance:serve' : 'npm run dev:all';
    console.log(`  Running "${again}" again is safe — it will adopt this stack.`);
    console.log('  Stop with Ctrl+C here, or "npm run dev:stop" from another terminal.');
    if (mode === PRODUCTION) {
      console.log('');
      console.log('  This is a BUILD. Code changes do not appear until it is stopped and');
      console.log('  started again — that is the property the acceptance environment needs.');
    }

    // The launcher stays attached for the children it owns, so the lock stays
    // held until it exits.
    releaseOnExit = false;
  } finally {
    if (releaseOnExit) releaseLock(LOCK_FILE);
  }
}

await main();
