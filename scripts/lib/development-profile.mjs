/**
 * TDP-2026-10 — the TEMPORARY development-path CI policy, as data and pure
 * functions.
 *
 * The Owner approved this policy on 2026-10-05. It governs ONLY pull requests
 * whose base is `develop`, and what happens on `develop` after a merge. It does
 * not apply to `main`, tags, releases, deployments or the nightly run, and it
 * changes no phase-gate or promotion obligation. The full policy text, its
 * review point and its restoration order live in
 * `docs/engineering/ci-automation/pr-gate.md`.
 *
 * Two rules hold everywhere below:
 *
 *   1. A relaxation needs a `pull_request` event whose base is `develop`. A
 *      branch name, an ambient ref or a missing value never relaxes anything.
 *   2. Anything missing, unknown, or disagreeing resolves to `full` / STRICT.
 *
 * Dependency-free (node: builtins only) because `change-detection` runs it
 * before `npm ci`, and because the PR gate runs the BASE branch's copy of this
 * file beside the head's copy and keeps the stricter answer — so it must load
 * from a bare `git show` into a temporary directory.
 */

/** The policy identifier printed in every summary that applies it. */
export const TDP_ID = 'TDP-2026-10';

/**
 * The review date. There is deliberately NO automatic expiry: an automatic flip
 * would leave `develop` requiring a check-run name that nothing produces. The
 * gate prints this date and raises a warning once it has passed.
 */
export const TDP_REVIEW_DATE = '2026-11-05';

export const GATE_PROFILES = Object.freeze(['full', 'development']);
export const CLEAN_ROOM_PROFILES = Object.freeze(['full', 'development']);
export const RECORDS_MODES = Object.freeze(['strict', 'checkpoint-deferred']);

export const REPOSITORY = 'Ezzaldeen-Albitar/RootLco';

/** The check-run name `main` requires. Only a pull request INTO main may emit it. */
export const MAIN_GATE_NAME = 'ci-gate';
/** The check-run name `develop` requires while the policy is in force. */
export const DEVELOPMENT_GATE_NAME = 'ci-gate (development)';

/** A pull-request run of the PR gate, from any pull-request ref. */
export const PR_CI_WORKFLOW_REF_PREFIX = `${REPOSITORY}/.github/workflows/pr-ci.yml@`;
/** The ONE dispatch that may defer records: the checkpoint, dispatched on develop. */
export const CHECKPOINT_WORKFLOW_REF = `${REPOSITORY}/.github/workflows/protected-develop-verification.yml@refs/heads/develop`;
export const CHECKPOINT_ID_PATTERN = /^CP-\d{8}-\d+$/;

/** The run record a records pull request edits. Editing it forces STRICT. */
export const RUN_LEDGER_PATH = 'docs/phase-1/phase-1-27/evidence/local-run-ledger.json';

/* ------------------------------------------------------------------ *
 * Profiles
 * ------------------------------------------------------------------ */

/**
 * `development` only for a pull request into develop. Every other event, base
 * or missing value is `full`.
 */
export function decideGateProfile({ event, baseRef } = {}) {
  return event === 'pull_request' && baseRef === 'develop' ? 'development' : 'full';
}

/**
 * The check-run name the PR gate emits. Mirrors the expression in
 * `.github/workflows/pr-ci.yml` (a test holds the two together): ONLY a pull
 * request whose base is `main` can produce the name `main` requires.
 */
export function gateCheckRunName({ event, baseRef } = {}) {
  return event === 'pull_request' && baseRef === 'main' ? MAIN_GATE_NAME : DEVELOPMENT_GATE_NAME;
}

/**
 * Whether the run record may be deferred to the next checkpoint.
 *
 * DEFERRED needs BOTH an explicit request and corroboration by the event:
 *
 *   (a) a `pull_request` into develop, run by the PR gate workflow; or
 *   (b) a `workflow_dispatch` of the protected verification workflow ON develop,
 *       carrying a well-formed checkpoint id.
 *
 * Everything else is STRICT — release verification, nightly, `ci.yml`, a
 * dispatch from any other ref, a pull request into main, a push, a local run,
 * and any request that cannot be corroborated.
 */
export function decideRunRecordMode({ requested, event, baseRef, workflowRef, checkpointId } = {}) {
  if (requested !== 'checkpoint-deferred') {
    return { mode: 'strict', reason: 'no deferral was requested' };
  }
  if (
    event === 'pull_request' &&
    baseRef === 'develop' &&
    typeof workflowRef === 'string' &&
    workflowRef.startsWith(PR_CI_WORKFLOW_REF_PREFIX)
  ) {
    return {
      mode: 'checkpoint-deferred',
      reason: 'a pull request into develop, run by the PR gate (TDP-2026-10 case a)',
    };
  }
  if (
    event === 'workflow_dispatch' &&
    workflowRef === CHECKPOINT_WORKFLOW_REF &&
    typeof checkpointId === 'string' &&
    CHECKPOINT_ID_PATTERN.test(checkpointId)
  ) {
    return {
      mode: 'checkpoint-deferred',
      reason: `checkpoint ${checkpointId} dispatched on develop (TDP-2026-10 case b)`,
    };
  }
  return {
    mode: 'strict',
    reason:
      'a deferral was requested but the event does not corroborate it ' +
      `(event=${event ?? '∅'}, base=${baseRef ?? '∅'}, workflow=${workflowRef ?? '∅'}) — STRICT`,
  };
}

/**
 * The records mode a command-line validator runs in.
 *
 * The request is EXPLICIT: `--mode <value>` on the command line, or the
 * `ROOTLCO_RECORDS_MODE` variable a workflow step sets on purpose (an npm `&&`
 * aggregate such as `verify:policies` cannot forward a flag to one inner
 * command). Without a request the answer is STRICT and no `GITHUB_*` variable is
 * read at all. With one, the corroboration above decides.
 *
 * @returns {{mode: 'strict'|'checkpoint-deferred', reason: string, error?: string}}
 */
export function resolveRecordsMode(argv = [], env = {}) {
  const at = argv.indexOf('--mode');
  const fromFlag = at === -1 ? undefined : argv[at + 1];
  const requested = fromFlag ?? (env.ROOTLCO_RECORDS_MODE || undefined);
  if (requested === undefined) {
    return { mode: 'strict', reason: 'no mode was requested — STRICT' };
  }
  if (!RECORDS_MODES.includes(requested)) {
    return {
      mode: 'strict',
      reason: `unknown records mode \`${requested}\``,
      error: `unknown records mode \`${requested}\`; expected ${RECORDS_MODES.join(' or ')}`,
    };
  }
  const cpAt = argv.indexOf('--checkpoint-id');
  return decideRunRecordMode({
    requested,
    event: env.GITHUB_EVENT_NAME,
    baseRef: env.GITHUB_BASE_REF,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    checkpointId: cpAt === -1 ? env.ROOTLCO_CHECKPOINT_ID : argv[cpAt + 1],
  });
}

/* ------------------------------------------------------------------ *
 * Path matching
 * ------------------------------------------------------------------ */

/**
 * A minimal glob: `**` crosses directories, `*` does not. Nothing else is
 * special. Kept here rather than imported because this module must load from a
 * bare `git show` with no `node_modules`.
 */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i += 1;
      if (glob[i + 1] === '/') {
        // `**/` is zero or more whole directories.
        out += '(?:.*/)?';
        i += 1;
      } else {
        out += '.*';
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

const compiled = new Map();
export function matchesAny(path, globs) {
  return globs.some((glob) => {
    let re = compiled.get(glob);
    if (!re) {
      re = globToRegExp(glob);
      compiled.set(glob, re);
    }
    return re.test(path);
  });
}

/* ------------------------------------------------------------------ *
 * The development-profile trigger tables
 * ------------------------------------------------------------------ */

/**
 * Paths that ESCALATE a development pull request to the full set: every job
 * and the full clean room. Matched on the raw path, before any category, so
 * `apps/web/package.json` is a dependency change and not a frontend one.
 *
 * The classifier, the gate and this file are all inside `scripts/ci/**`,
 * `scripts/lib/**` or `.github/workflows/**`, so a change to the rules is always
 * judged by the full set.
 */
export const ESCALATION_PATHS = Object.freeze([
  '.github/workflows/**',
  '.github/actions/**',
  'scripts/ci/**',
  'scripts/lib/**',
  'tests/ci/**',
  'package.json',
  'package-lock.json',
  'apps/*/package.json',
  'tsconfig*',
  'apps/*/tsconfig*',
  'eslint.config*',
  'apps/*/eslint.config*',
  'vitest.config*',
  'apps/*/vitest.config*',
  'next.config*',
  'apps/*/next.config*',
  'apps/web/playwright.config.ts',
  'Dockerfile',
  '.dockerignore',
  'docker-compose*',
  'supabase/config.toml',
]);

/**
 * `.github/ci-baselines/<file>` routed to the jobs that consume it. Every mapped
 * baseline is also a validation input (unit tier, always run, plus
 * `web-quality`). A baseline not listed here escalates.
 */
export const BASELINE_CONSUMERS = Object.freeze({
  'schema-baseline.json': {
    jobs: ['database-migration-replay', 'database-security'],
    databaseBlock: true,
  },
  'test-count-baseline.json': { jobs: [] },
  'coverage-baseline.unit.json': { jobs: [] },
  'coverage-baseline.web.json': { jobs: [] },
  'coverage-baseline.backend.json': { jobs: ['integration-tests'] },
  'phase-ownership-profiles.json': { jobs: [] },
  'container-baseline.json': { jobs: ['container-security'] },
  'build-size-baseline.json': { jobs: ['application-build'] },
  'codeql-baseline.json': { jobs: ['code-security'] },
  'dependency-exceptions.json': { jobs: [] },
  'unrun-test-tiers.json': { jobs: [] },
  'p1-27-citation-anchors.json': { jobs: [] },
});

/**
 * `web-quality` runs for these (and for every escalation and baseline). The
 * list is the union of what the web tier READS outside `apps/web`; a test scans
 * `apps/web/tests` for repository-root reads and fails if one is not covered.
 */
export const WEB_QUALITY_TRIGGERS = Object.freeze([
  'apps/web/**',
  'apps/api/src/**',
  'supabase/**',
  'docs/api/**',
  'docs/phase-1/**',
  'docs/database/**',
  'docs/product/owner-directive-2026-09-16/route-checklist.md',
  'scripts/**',
  '.github/ci-baselines/**',
  '.prettierignore',
]);

/**
 * `authenticated-browser` runs for any change here — by INVERSION: everything
 * under these roots, minus a short allow-list pinned by a test.
 */
export const AUTHENTICATED_BROWSER_TRIGGERS = Object.freeze([
  'apps/web/src/**',
  'apps/api/src/**',
  'supabase/**',
  'apps/web/tests/e2e/**',
  'apps/web/public/**',
  // The owner-acceptance setup the job runs, the development configuration it
  // imports, and the platform scripts it reads (TDP-2026-10 fix round 1). A
  // test derives every script the job reaches and fails on one not listed.
  'scripts/dev/**',
  'scripts/platform/**',
]);

/** The ONLY exemptions from the trigger above (Owner-adopted, 2026-10-05). */
export const AUTHENTICATED_BROWSER_ALLOW_LIST = Object.freeze([
  '**/*.scss',
  '**/*.css',
  'apps/web/src/i18n/messages/**',
]);

/** The serial one-database block in the development clean room. */
export const SERIAL_BLOCK_TRIGGERS = Object.freeze([
  'supabase/**',
  'scripts/db/**',
  'tests/db/**',
  'tests/backend/**',
  'vitest.config.db.ts',
  'vitest.config.backend.ts',
  'vitest.config.db-fixture.ts',
  'apps/api/src/**/data/**',
  // Scripts the database and backend suites import or spawn: the platform
  // operator and backfill scripts, the owner-acceptance fixture setup and its
  // development configuration, and the classification guards tests/db spawns
  // (TDP-2026-10 fix round 1). A test derives every script tests/backend and
  // tests/db reach and fails on one that does not run this block.
  'scripts/platform/**',
  'scripts/dev/**',
  'scripts/check-*-classification.mjs',
]);

/**
 * Repository scripts only the integration-tests job runs (TDP-2026-10 fix
 * round 2): the P1-23 and P1-24 hostile mutation matrices, which validate the
 * route authorization gate, the denial document and the finance blocker. No
 * clean-room profile, aggregate or unit test runs them, and their category
 * (`scripts`) does not trigger the job. A test derives every script each
 * conditional job's workflow reaches and fails on one that does not run it.
 */
export const INTEGRATION_TESTS_TRIGGERS = Object.freeze([
  'scripts/p1-23-mutation-matrix.mjs',
  'scripts/p1-24-mutation-matrix.mjs',
]);

/** Any API source change: the database, integration and analysis jobs. */
export const API_SOURCE_JOBS = Object.freeze([
  'integration-tests',
  'database-security',
  'code-security',
]);

/** Migrations and RLS. */
export const DATABASE_JOBS = Object.freeze([
  'database-migration-replay',
  'database-security',
  'integration-tests',
  'authenticated-browser',
  'web-quality',
]);

/** Money source. A test asserts every glob matches an existing path. */
export const MONEY_API_GLOBS = Object.freeze(
  [
    'billing',
    'payments',
    'pricing',
    'quotation',
    'inventory',
    'warranty',
    'delivery',
    'reporting',
  ].map((m) => `apps/api/src/modules/${m}/**`)
);
export const MONEY_WEB_GLOBS = Object.freeze(
  [
    'billing',
    'payments',
    'pricing',
    'quotations',
    'inventory',
    'warranty',
    'delivery',
    'reports',
  ].map((m) => `apps/web/src/features/${m}/**`)
);
export const MONEY_WEB_JOBS = Object.freeze(['web-quality', 'authenticated-browser']);

/**
 * Every authenticated end-to-end spec mapped to at least one path that triggers
 * it, plus the BASE every spec passes through. A test asserts every spec under
 * `apps/web/tests/e2e/authenticated/` has a row and every glob triggers the job.
 */
export const AUTH_E2E_BASE = Object.freeze([
  'apps/web/src/proxy.ts',
  'apps/web/src/app/**',
  'apps/web/src/components/**',
  'apps/web/src/lib/**',
  'apps/web/src/config/**',
  'apps/web/src/features/overview/**',
  'apps/web/src/features/authentication/**',
  'apps/web/src/features/working-context/**',
  'apps/web/public/**',
  'apps/api/src/server/**',
  'apps/api/src/modules/iam/**',
  'supabase/**',
  'scripts/dev/**',
  'scripts/platform/**',
  'apps/web/tests/e2e/**',
]);
export const AUTH_E2E_SPEC_MAP = Object.freeze({
  'accessibility.spec.ts': ['apps/web/src/features/administration/**'],
  'administration.spec.ts': ['apps/web/src/features/administration/**'],
  'appointments-and-receptions.spec.ts': ['apps/web/src/features/receptions/**'],
  'audit-log-p1-31.spec.ts': ['apps/api/src/modules/iam/**'],
  'crm-and-vehicles.spec.ts': ['apps/web/src/features/crm/**'],
  'delivery-p1-31.spec.ts': ['apps/web/src/features/delivery/**'],
  'delivery-writes-p1-31.spec.ts': ['apps/api/src/modules/delivery/**'],
  'drawer-and-restore.spec.ts': ['apps/web/src/components/shell/**'],
  'isolation.spec.ts': ['supabase/migrations/**'],
  'overview-p1-31.spec.ts': ['apps/api/src/modules/overview/**'],
  'reports-p1-31.spec.ts': ['apps/web/src/features/reports/**'],
  'shared-ux.spec.ts': ['apps/web/src/components/shell/**'],
  'warranty-p1-31.spec.ts': ['apps/web/src/features/warranty/**'],
  'auth.setup.ts': ['apps/web/src/features/authentication/**'],
});

/**
 * The files a checkpoint RECORDS pull request may touch. Change detection
 * reports whether a pull request stays inside it (`records-only`), so the
 * records PR's scope is computed rather than asserted.
 */
export const RECORDS_FILE_ALLOW_LIST = Object.freeze([
  'docs/phase-1/phase-1-27/**',
  'docs/phase-1/phase-1-28/**',
  'docs/product/owner-directive-2026-09-16/capability-status.md',
]);

/** Whether a path escalates a development pull request to the full set. */
export function isEscalationPath(path) {
  return matchesAny(path, ESCALATION_PATHS);
}

/** Whether `authenticated-browser` must run for this path. */
export function requiresAuthenticatedBrowser(path) {
  return (
    matchesAny(path, AUTHENTICATED_BROWSER_TRIGGERS) &&
    !matchesAny(path, AUTHENTICATED_BROWSER_ALLOW_LIST)
  );
}

/* ------------------------------------------------------------------ *
 * Keeping the stricter of two classifications
 * ------------------------------------------------------------------ */

/** What one classifier copy decided, small enough to record beside the result. */
export function decisionSummary(classification) {
  if (!classification || typeof classification !== 'object') return null;
  const jobs = {};
  for (const [id, decision] of Object.entries(classification.jobs ?? {})) {
    jobs[id] = Boolean(decision?.required);
  }
  return {
    profile: classification.profile ?? null,
    escalated: classification.escalated ?? null,
    cleanRoomProfile: classification.cleanRoomProfile ?? null,
    runDatabaseBlock: classification.runDatabaseBlock ?? null,
    runContainerBlock: classification.runContainerBlock ?? null,
    recordsMode: classification.recordsMode ?? null,
    jobs,
  };
}

/**
 * Whether a base-branch classification carries a development-profile decision
 * this head can compare against. A base that predates the policy does not.
 */
export function baseIsComparable(base) {
  return Boolean(
    base &&
    typeof base === 'object' &&
    GATE_PROFILES.includes(base.profile) &&
    CLEAN_ROOM_PROFILES.includes(base.cleanRoomProfile) &&
    base.jobs &&
    typeof base.jobs === 'object'
  );
}
