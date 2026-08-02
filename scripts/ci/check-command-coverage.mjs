/**
 * Every quality command is owned, classified, and reachable.
 *
 * ## Why this gate exists
 *
 * Three defects found during the workspace normalization shared one shape: a
 * check existed, was correct, and had never run.
 *
 *   - `security:scope-exclusions` went red the day `apps/web` landed and stayed
 *     red, because no aggregate invoked it.
 *   - `lint:web` had never once succeeded — its config crashed inside its own
 *     error formatter — and nothing noticed, because no aggregate invoked it.
 *   - `apps/web`'s Stylelint RTL rule was declared with an invalid option shape,
 *     so Stylelint skipped it and reported "0 problems" for that rule forever.
 *
 * A repository cannot tell the difference between "this check passes" and "this
 * check never ran" by looking at a green log. The only durable answer is a
 * register that must account for every command, and a mechanical proof that
 * every REQUIRED one is reachable from the aggregate a human actually runs and
 * from the workflows CI actually executes.
 *
 * ## What it proves
 *
 *   1. Every script in every workspace appears in the register below — a new
 *      command cannot be added without being classified.
 *   2. Every register entry names a script that still exists — the register
 *      cannot rot into a description of a repository that no longer exists.
 *   3. Every `required` command is reachable from `verify:workspaces` by
 *      following `npm run` edges transitively.
 *   4. Every `required` command is invoked by at least one hosted workflow,
 *      directly or through an aggregate it is reachable from.
 *
 * Usage: node scripts/ci/check-command-coverage.mjs [--json]
 * Exit codes: 0 covered · 1 a gap · 2 IO error.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  API_ROOT,
  GITHUB_ROOT,
  WEB_ROOT,
  fromRoot,
  toRepositoryPath,
} from '../lib/repository-paths.mjs';

/** The command a developer runs, and the root of the reachability proof. */
export const AGGREGATE = 'verify:workspaces';

const ROOT = 'root';
const API = '@rootlco/api';
const WEB = '@rootlco/web';

/**
 * The register. `tier` is the whole point:
 *
 *   required      — a quality gate. Must be reachable from the aggregate AND
 *                   invoked by hosted CI. This is the class that silently rotted.
 *   informational — produces a report or a fix; failing it is not a verdict.
 *   interactive   — a developer convenience (watch mode, dev server, database
 *                   lifecycle). Running it in CI would hang or mutate state.
 *   environment   — needs a live database, Docker or credentials, so it runs in
 *                   its own workflow job rather than from the local aggregate.
 */
export const REGISTER = Object.freeze([
  // --- root: repository-level quality gates ---------------------------------
  { name: 'lint', owner: ROOT, tier: 'required', why: 'repository tooling, tests and configs' },
  { name: 'typecheck', owner: ROOT, tier: 'required', why: 'repository tests and scripts' },
  { name: 'format:check', owner: ROOT, tier: 'required', why: 'repository-owned files' },
  { name: 'format:check:all', owner: ROOT, tier: 'required', why: 'root plus every workspace' },
  { name: 'test:unit', owner: ROOT, tier: 'required', why: 'unit and component tier' },
  { name: 'validate:encoding', owner: ROOT, tier: 'required', why: 'Trojan Source and mojibake' },
  { name: 'validate:run-block-syntax', owner: ROOT, tier: 'required', why: 'workflow run blocks' },
  { name: 'validate:no-fake-data', owner: ROOT, tier: 'required', why: 'no-fake-data policy' },
  { name: 'validate:module-boundaries', owner: ROOT, tier: 'required', why: 'ADR-001 boundaries' },
  {
    name: 'validate:authorization-coverage',
    owner: ROOT,
    tier: 'required',
    why: 'every route guarded',
  },
  { name: 'validate:operation-coverage', owner: ROOT, tier: 'required', why: 'operation evidence' },
  { name: 'validate:openapi', owner: ROOT, tier: 'required', why: 'published contract' },
  { name: 'validate:exact-money', owner: ROOT, tier: 'required', why: 'decimal money surface' },
  { name: 'validate:p1-19-inventory', owner: ROOT, tier: 'required', why: 'phase inventory' },
  { name: 'validate:p1-20-inventory', owner: ROOT, tier: 'required', why: 'phase inventory' },
  { name: 'validate:p1-21-inventory', owner: ROOT, tier: 'required', why: 'phase inventory' },
  { name: 'validate:p1-22-inventory', owner: ROOT, tier: 'required', why: 'phase inventory' },
  { name: 'validate:p1-23-inventory', owner: ROOT, tier: 'required', why: 'phase inventory' },
  { name: 'validate:p1-24-register', owner: ROOT, tier: 'required', why: 'operation register' },
  { name: 'validate:command-coverage', owner: ROOT, tier: 'required', why: 'this gate' },
  { name: 'dev:all', owner: ROOT, tier: 'interactive', why: 'owner-visible local stack launcher' },
  { name: 'dev:status', owner: ROOT, tier: 'interactive', why: 'reports the live local stack' },
  { name: 'dev:stop', owner: ROOT, tier: 'interactive', why: 'stops only launcher-owned PIDs' },
  {
    name: 'validate:p1-26-readiness',
    owner: ROOT,
    tier: 'informational',
    // A REPORTER, not a gate: "not ready" is the correct state while OIR-01 and
    // OIR-06 are open, so it exits 0 either way. The P1-26 branch-creation step
    // calls it with --assert-ready, which does fail. Its rule table is proven by
    // tests/ci/p1-26-readiness.test.ts in the required unit tier.
    why: 'derives P1-26 dependency readiness from the tree so the answer cannot go stale',
  },
  {
    name: 'validate:product-name',
    owner: ROOT,
    tier: 'required',
    why: 'one product name across both tiers — both pending, or both the same approved value',
  },
  {
    name: 'validate:api-backend-only',
    owner: ROOT,
    tier: 'required',
    why: 'apps/api is Backend-only — no page, stylesheet, client component or tracked build output',
  },
  {
    name: 'validate:generated-artifacts',
    owner: ROOT,
    tier: 'required',
    why: 'no generated output tracked anywhere, one root lockfile, ignore rules intact',
  },
  {
    name: 'validate:phase-ownership',
    owner: ROOT,
    tier: 'informational',
    // Takes a profile and a base ref, so it is invoked per phase branch rather
    // than from the repository-wide aggregate. P1-26's CI job runs it with the
    // p1-26-frontend profile; the pre-P1-26 remediation runs it with
    // api-boundary. Its rule table is proven by tests/ci/phase-ownership.test.ts,
    // which runs in the required unit tier.
    why: 'per-phase changed-file ownership; parameterised, so invoked by the phase job not the aggregate',
  },
  {
    name: 'validate:web-topology',
    owner: ROOT,
    tier: 'required',
    why: 'one App Router root under src, proxy convention, no nested lockfile, no tracked artefacts',
  },
  { name: 'security:all', owner: ROOT, tier: 'required', why: 'security gate aggregate' },
  { name: 'security:tracked-secrets', owner: ROOT, tier: 'required', why: 'committed secrets' },
  {
    name: 'security:browser-secrets',
    owner: ROOT,
    tier: 'required',
    why: 'client-exposed secrets',
  },
  { name: 'security:scope-exclusions', owner: ROOT, tier: 'required', why: 'excluded-scope guard' },
  {
    name: 'validate:canonical-docs',
    owner: ROOT,
    tier: 'environment',
    why: 'canonical DOCX live outside the repository',
  },
  {
    name: 'validate:crm-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'CRM classification',
  },
  {
    name: 'validate:veh-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'vehicle classification',
  },
  {
    name: 'validate:aptrec-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'appointment classification',
  },
  {
    name: 'validate:wo-tech-dia-qms-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'work-order classification',
  },
  {
    name: 'validate:svc-quo-inv-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'catalogue classification',
  },
  {
    name: 'validate:sal-wty-rpt-classification',
    owner: ROOT,
    tier: 'environment',
    why: 'billing classification',
  },

  // --- root: workspace delegation -------------------------------------------
  { name: 'verify:workspaces', owner: ROOT, tier: 'required', why: 'the aggregate itself' },
  {
    name: 'verify:policies',
    owner: ROOT,
    tier: 'required',
    why: 'encoding, run-block, command coverage',
  },
  { name: 'verify:repository', owner: ROOT, tier: 'required', why: 'repository-level quality' },
  { name: 'verify:api', owner: ROOT, tier: 'required', why: 'API workspace quality' },
  { name: 'verify:web', owner: ROOT, tier: 'required', why: 'web workspace quality' },
  { name: 'verify:contracts', owner: ROOT, tier: 'required', why: 'API contract validators' },
  { name: 'verify:inventories', owner: ROOT, tier: 'required', why: 'phase endpoint inventories' },
  {
    name: 'verify:classifications',
    owner: ROOT,
    tier: 'environment',
    why: 'domain classification validators — every one needs PostgreSQL (P1-25-F-023)',
  },
  {
    name: 'build',
    owner: ROOT,
    tier: 'informational',
    why: 'historical alias of build:api, which the aggregate runs',
  },
  { name: 'build:api', owner: ROOT, tier: 'required', why: 'API production build' },
  { name: 'build:web', owner: ROOT, tier: 'required', why: 'web production build' },
  { name: 'lint:api', owner: ROOT, tier: 'required', why: 'API lint' },
  { name: 'lint:web', owner: ROOT, tier: 'required', why: 'web lint' },
  { name: 'typecheck:api', owner: ROOT, tier: 'required', why: 'API typecheck' },
  { name: 'typecheck:web', owner: ROOT, tier: 'required', why: 'web typecheck' },
  {
    name: 'style:check',
    owner: ROOT,
    tier: 'informational',
    // After the pre-P1-26 boundary remediation apps/api holds no stylesheets,
    // so this root name now resolves to exactly the same stylelint run as
    // `style:check:web`. ADR-013, CONTRIBUTING and the styling standard name
    // it as the developer-facing gating form, so it keeps working — but the
    // REQUIRED coverage is carried once, by style:check:web.
    why: 'documented developer alias of style:check:web, which carries the required coverage',
  },
  { name: 'style:check:web', owner: ROOT, tier: 'required', why: 'web Sass' },
  {
    name: 'style:check:all',
    owner: ROOT,
    tier: 'informational',
    why: 'convenience alias; verify:api and verify:web each run their own half',
  },
  { name: 'test:web', owner: ROOT, tier: 'required', why: 'web component tier' },
  {
    name: 'test:web-ci',
    owner: ROOT,
    tier: 'informational',
    why: 'the same suite as test:web, with the reporters CI needs for evidence',
  },
  { name: 'format:check:api', owner: ROOT, tier: 'required', why: 'API formatting' },
  { name: 'format:check:web', owner: ROOT, tier: 'required', why: 'web formatting' },
  { name: 'validate:web-tokens', owner: ROOT, tier: 'required', why: 'design-token gate' },
  { name: 'validate:web-brand', owner: ROOT, tier: 'required', why: 'brand-isolation gate' },
  {
    name: 'validate:web-boundary',
    owner: ROOT,
    tier: 'required',
    why: 'no fetch outside the API layer, no API or Supabase import, no unsafe HTML',
  },
  {
    name: 'test:web-e2e',
    owner: ROOT,
    tier: 'required',
    why: 'browser smoke across five viewport and direction projects',
  },

  // --- root: environment-bound --------------------------------------------
  {
    name: 'test',
    owner: ROOT,
    tier: 'informational',
    why: 'alias of test:unit, kept for muscle memory',
  },
  { name: 'test:backend', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'test:db', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'test:integration', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  {
    name: 'test:coverage',
    owner: ROOT,
    tier: 'environment',
    why: 'coverage run, gated separately',
  },
  { name: 'db:apply-migrations', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'validate:seed-state', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'validate:schema-inventory', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'validate:structural-review', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'validate:upgrade-matrix', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'validate:baseline-manifest', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  { name: 'gate:p1-12', owner: ROOT, tier: 'environment', why: 'needs PostgreSQL' },
  {
    name: 'validate:p1-23-mutations',
    owner: ROOT,
    tier: 'environment',
    why: 'mutation run, needs PostgreSQL',
  },
  {
    name: 'validate:p1-24-mutations',
    owner: ROOT,
    tier: 'environment',
    why: 'mutation run, needs PostgreSQL',
  },

  // --- root: interactive / fix-mode ----------------------------------------
  { name: 'dev', owner: ROOT, tier: 'interactive', why: 'dev server' },
  { name: 'dev:api', owner: ROOT, tier: 'interactive', why: 'dev server' },
  { name: 'dev:web', owner: ROOT, tier: 'interactive', why: 'dev server' },
  { name: 'dev:container', owner: ROOT, tier: 'interactive', why: 'dev server in a container' },
  { name: 'start', owner: ROOT, tier: 'interactive', why: 'production server' },
  { name: 'test:watch', owner: ROOT, tier: 'interactive', why: 'watch mode' },
  { name: 'lint:fix', owner: ROOT, tier: 'interactive', why: 'fix mode' },
  { name: 'format', owner: ROOT, tier: 'interactive', why: 'fix mode' },
  { name: 'style:lint', owner: ROOT, tier: 'interactive', why: 'report mode' },
  { name: 'style:fix', owner: ROOT, tier: 'interactive', why: 'fix mode' },
  { name: 'dev:up', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'dev:down', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'dev:logs', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'dev:reset', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'supabase:start', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'supabase:stop', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'supabase:status', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'supabase:reset', owner: ROOT, tier: 'interactive', why: 'local stack lifecycle' },
  { name: 'verify', owner: ROOT, tier: 'informational', why: 'superseded by verify:workspaces' },
  { name: 'gate:p1-13', owner: ROOT, tier: 'informational', why: 'historical phase gate' },

  // --- API workspace --------------------------------------------------------
  { name: 'build', owner: API, tier: 'required', why: 'reached through build:api' },
  { name: 'lint', owner: API, tier: 'required', why: 'reached through lint:api' },
  { name: 'typecheck', owner: API, tier: 'required', why: 'reached through typecheck:api' },
  { name: 'format:check', owner: API, tier: 'required', why: 'reached through format:check:api' },

  { name: 'dev', owner: API, tier: 'interactive', why: 'dev server' },
  { name: 'dev:container', owner: API, tier: 'interactive', why: 'dev server' },
  { name: 'start', owner: API, tier: 'interactive', why: 'production server' },
  { name: 'lint:fix', owner: API, tier: 'interactive', why: 'fix mode' },
  { name: 'format', owner: API, tier: 'interactive', why: 'fix mode' },

  // --- web workspace --------------------------------------------------------
  { name: 'build', owner: WEB, tier: 'required', why: 'reached through build:web' },
  { name: 'lint', owner: WEB, tier: 'required', why: 'reached through lint:web' },
  { name: 'typecheck', owner: WEB, tier: 'required', why: 'reached through typecheck:web' },
  { name: 'format:check', owner: WEB, tier: 'required', why: 'reached through format:check:web' },
  { name: 'style:check', owner: WEB, tier: 'required', why: 'reached through style:check:web' },
  { name: 'style:lint', owner: WEB, tier: 'interactive', why: 'report mode' },
  { name: 'style:fix', owner: WEB, tier: 'interactive', why: 'fix mode' },
  { name: 'test', owner: WEB, tier: 'required', why: 'reached through test:web' },
  {
    name: 'validate:tokens',
    owner: WEB,
    tier: 'required',
    why: 'reached through validate:web-tokens',
  },
  {
    name: 'validate:brand',
    owner: WEB,
    tier: 'required',
    why: 'reached through validate:web-brand',
  },
  {
    name: 'validate:boundary',
    owner: WEB,
    tier: 'required',
    why: 'reached through validate:web-boundary',
  },
  { name: 'test:e2e', owner: WEB, tier: 'required', why: 'reached through test:web-e2e' },
  {
    name: 'test:ci',
    owner: WEB,
    tier: 'informational',
    why: 'the same suite as test, with the reporters CI needs for evidence',
  },
  {
    name: 'test:e2e:install',
    owner: WEB,
    tier: 'environment',
    why: 'downloads a browser; the CI job installs it as its own step',
  },
  { name: 'dev', owner: WEB, tier: 'interactive', why: 'dev server' },
  { name: 'start', owner: WEB, tier: 'interactive', why: 'production server' },
  { name: 'test:watch', owner: WEB, tier: 'interactive', why: 'watch mode' },
  { name: 'format', owner: WEB, tier: 'interactive', why: 'fix mode' },
]);

const MANIFESTS = Object.freeze([
  { owner: ROOT, path: fromRoot('package.json') },
  { owner: API, path: join(API_ROOT, 'package.json') },
  { owner: WEB, path: join(WEB_ROOT, 'package.json') },
]);

/** `owner::name`, the register's primary key. */
export const key = (owner, name) => `${owner}::${name}`;

/** Every script that exists, as a Map of key -> command line. */
export function readScripts(read = (p) => readFileSync(p, 'utf8')) {
  const scripts = new Map();
  for (const manifest of MANIFESTS) {
    const parsed = JSON.parse(read(manifest.path));
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
      scripts.set(key(manifest.owner, name), command);
    }
  }
  return scripts;
}

/**
 * The `npm run` edges out of one command line.
 *
 * `--workspace @rootlco/web` retargets the edge, which is what makes the
 * reachability proof cross the workspace boundary instead of stopping at it.
 */
export function edgesOf(command, owner) {
  const out = [];
  const pattern = /npm run (?:--silent )?([a-zA-Z0-9:_-]+)((?:\s+--workspace[= ]\S+)?)/g;
  let match;
  while ((match = pattern.exec(command)) !== null) {
    const target = match[1];
    const workspace = /--workspace[= ](\S+)/.exec(match[2] ?? '');
    out.push(key(workspace ? workspace[1] : owner, target));
  }
  return out;
}

/** Transitive closure of `npm run` edges from one command. */
export function reachableFrom(scripts, start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const command = scripts.get(current);
    if (!command) continue;
    const owner = current.slice(0, current.indexOf('::'));
    for (const next of edgesOf(command, owner)) queue.push(next);
  }
  return seen;
}

/** Every `npm run <name>` a hosted workflow executes, as a root-owned key. */
export function readWorkflowInvocations(
  list = () => readdirSync(join(GITHUB_ROOT, 'workflows')),
  read = (name) => readFileSync(join(GITHUB_ROOT, 'workflows', name), 'utf8')
) {
  const invoked = new Set();
  for (const file of list()) {
    if (!/\.ya?ml$/.test(file)) continue;
    for (const edge of edgesOf(read(file), ROOT)) invoked.add(edge);
  }
  return invoked;
}

export function evaluate({ scripts, workflowInvocations, register = REGISTER }) {
  const failures = [];
  const registered = new Map(register.map((entry) => [key(entry.owner, entry.name), entry]));

  for (const scriptKey of scripts.keys()) {
    if (!registered.has(scriptKey)) {
      failures.push(
        `${scriptKey} is not in the register — every command must be classified before it can be trusted or ignored`
      );
    }
  }
  for (const registeredKey of registered.keys()) {
    if (!scripts.has(registeredKey)) {
      failures.push(
        `${registeredKey} is registered but no such script exists — the register has rotted`
      );
    }
  }

  const locallyReachable = reachableFrom(scripts, key(ROOT, AGGREGATE));
  const ciReachable = new Set();
  for (const invocation of workflowInvocations) {
    for (const reached of reachableFrom(scripts, invocation)) ciReachable.add(reached);
  }

  const rows = [];
  for (const entry of register) {
    const entryKey = key(entry.owner, entry.name);
    if (!scripts.has(entryKey)) continue;
    const local = locallyReachable.has(entryKey);
    const ci = ciReachable.has(entryKey);
    rows.push({ ...entry, key: entryKey, aggregate: local, hostedCi: ci });
    if (entry.tier !== 'required') continue;
    if (!local) {
      failures.push(`${entryKey} is required but not reachable from \`npm run ${AGGREGATE}\``);
    }
    if (!ci) {
      failures.push(`${entryKey} is required but no hosted workflow invokes it`);
    }
  }

  return { failures, rows };
}

function main() {
  let scripts;
  let workflowInvocations;
  try {
    scripts = readScripts();
    workflowInvocations = readWorkflowInvocations();
  } catch (error) {
    console.error(`IO error: ${error.message}`);
    process.exit(2);
  }

  const { failures, rows } = evaluate({ scripts, workflowInvocations });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ aggregate: AGGREGATE, failures, commands: rows }, null, 2));
  } else {
    const required = rows.filter((r) => r.tier === 'required');
    console.log(
      `Command coverage: ${rows.length} registered command(s), ${required.length} required`
    );
    console.log(
      `  reachable from ${AGGREGATE}: ${required.filter((r) => r.aggregate).length}/${required.length}`
    );
    console.log(
      `  invoked by hosted CI:        ${required.filter((r) => r.hostedCi).length}/${required.length}`
    );
    for (const row of rows.filter((r) => r.tier !== 'required')) {
      if (row.aggregate) continue;
      // Informational only: a non-required command outside the aggregate is the
      // expected state, printed so the classification stays visible.
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} coverage gap(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      `\nA command that no aggregate runs is a command that has never run. Register it, ` +
        `or make it reachable. Registers live in ${toRepositoryPath(fromRoot('scripts/ci/check-command-coverage.mjs'))}.`
    );
    process.exit(1);
  }
  console.log('OK: every required command is reachable locally and in hosted CI');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
