/**
 * P1-15 health projections: what a probe endpoint is allowed to say.
 *
 * Two claims are under test, and both are about *disclosure*, not availability.
 *
 * ## Liveness answers one question and touches nothing
 *
 * `liveness()` exists to answer "is this process running?". Everything else an
 * operator might want — build version, commit, environment, hostname, the name
 * of a dependency — is an invitation to fingerprint a deployment from an
 * endpoint that is unauthenticated by necessity and reachable from the load
 * balancer's network. So the payload is pinned by its *exact key set*, not by a
 * spot check: a later "just add the version, it is harmless" is a failing test
 * rather than a review comment somebody might miss.
 *
 * It is also proven to do no I/O: `liveness()` returns a plain object, not a
 * promise, so it cannot have awaited a database round trip. That matters beyond
 * tidiness — a liveness probe that touches the database restarts a healthy
 * process every time the database hiccups, converting a brief dependency blip
 * into a rolling outage. Nothing in this file opens a connection, and the whole
 * suite runs with no database configured.
 *
 * ## Readiness reports a verdict, never a topology
 *
 * `foundationReadiness()` (P1-13) computes rich internal detail, including the
 * database **role name** the connection opened as (`detail: preflight.currentRole`).
 * That is right for an operator reading a log and wrong for an HTTP body. The
 * P1-15 projection keeps check names and booleans and drops every `detail`.
 *
 * This file proves that at two depths, without calling the probe:
 *
 *  1. **Compile time.** `ReadinessProjection` cannot express a `detail` at all —
 *     asserted with `@ts-expect-error`, which `npm run typecheck` verifies (this
 *     file is inside the root `tsconfig.json` include set). `HealthService.readiness`
 *     is separately pinned as returning exactly that type, so no detail string
 *     can reach a caller of the real method either.
 *  2. **Shape.** A synthetic `ReadinessReport` whose every check carries a
 *     `detail` — a role name, a host, a database name — is mapped the way
 *     `HealthService.readiness()` maps it, and the result is required to contain
 *     only `{ name, ok }`, with none of those secrets anywhere in its JSON.
 *
 * GAP (deliberate, stated rather than papered over): the mapping in test 2 is a
 * *mirror* of the one inside `HealthService.readiness()`, because the real method
 * calls `foundationReadiness()` and this file must not open a database
 * connection. The mirror proves the projection contract; what binds the real
 * method to that contract is the return-type pin plus the `@ts-expect-error`
 * proof above, not the mirror. Executing the wired method against a live
 * database belongs to the database/backend tier.
 *
 * ## /api/health is untouched
 *
 * The Phase 1-1 endpoint is the container healthcheck in `docker-compose.yml`
 * (`curl -fsS`, which fails on any non-2xx). P1-15 adds *new versioned paths*
 * instead of reshaping it. `tests/health.test.ts` owns that endpoint's contract
 * and is neither duplicated nor modified here: this file only asserts that the
 * route still exports `GET` and that the seven-key pin in that test still exists
 * and still names exactly the same seven keys.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  HealthService,
  type LivenessReport,
  type ReadinessProjection,
} from '@/modules/shared-services/application/health-service';
import type { ReadinessReport } from '@/server/health/readiness';
import { APP_NAME, APP_VERSION, COMMIT_SHA } from '@/shared/constants/app';
import { API_SRC_ROOT } from '../../scripts/lib/repository-paths.mjs';

/**
 * Compile-time equality. `Exact<A, B>` is `true` only when the two types are
 * mutually assignable, so a widened key union collapses it to `false` and the
 * `const … : Exact<…> = true` declarations below stop compiling.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type ProjectedCheck = ReadinessProjection['checks'][number];
type ReportedCheck = ReadinessReport['checks'][number];

/**
 * A readiness report exactly as `foundationReadiness()` builds one, including
 * the `detail` strings that must never leave the process. The values are
 * fixture-only stand-ins for the real internals: the connection role, the host,
 * and the database name.
 */
const ROLE_NAME = 'app_runtime';
const INTERNAL_HOST = 'fx-db-primary.internal.invalid';
const INTERNAL_DATABASE = 'fx_rootlco_primary';

const REPORT_WITH_DETAILS: ReadinessReport = {
  role: 'web',
  state: 'degraded',
  checks: [
    { name: 'database.reachable', ok: true, detail: INTERNAL_HOST },
    { name: 'database.role.no-bypassrls', ok: true, detail: ROLE_NAME },
    { name: 'capability.shared.document_write', ok: false, detail: INTERNAL_DATABASE },
  ],
};

/**
 * The projection under test, written exactly as `HealthService.readiness()`
 * writes it: the state becomes the status, and each check is rebuilt from its
 * name and verdict. `detail` is *dropped, not summarised* — it is never read, so
 * there is no transformation of it that could be tightened later and no path by
 * which a longer or shorter version of it reaches the body.
 */
function project(report: ReadinessReport): ReadinessProjection {
  return {
    status: report.state,
    checks: report.checks.map((check) => ({ name: check.name, ok: check.ok })),
  };
}

describe('liveness discloses that the process is running, and nothing else', () => {
  it('returns exactly { status, uptimeSeconds }', () => {
    const report = new HealthService().liveness();

    // The exact key set, not a subset: adding a field is a failing test.
    expect(Object.keys(report).sort()).toEqual(['status', 'uptimeSeconds']);
  });

  it('reports status "alive" and a non-negative integer uptime', () => {
    const report = new HealthService().liveness();

    expect(report.status).toBe('alive');
    expect(Number.isInteger(report.uptimeSeconds)).toBe(true);
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    // Seconds since process start — a duration, never a wall-clock instant that
    // would date the deployment.
    expect(report.uptimeSeconds).toBeLessThanOrEqual(Math.ceil(process.uptime()));
  });

  it('carries no version, commit, environment, hostname, or dependency name', () => {
    const report = new HealthService().liveness();
    const body = JSON.stringify(report);

    for (const forbidden of ['version', 'commit', 'environment', 'hostname', 'host', 'database']) {
      expect(Object.keys(report)).not.toContain(forbidden);
    }
    // Not just the key names — the actual values a fingerprinting caller wants.
    for (const secret of [APP_NAME, APP_VERSION, COMMIT_SHA, hostname()]) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toContain(process.env.NEXT_PUBLIC_APP_ENV ?? 'local');
  });

  it('does no I/O: it returns a value, not a promise, with no database configured', () => {
    // This suite runs with no database. A liveness probe that reached one would
    // have to be async, and would fail here rather than answering.
    const returned: LivenessReport = new HealthService().liveness();

    expect(returned).not.toBeInstanceOf(Promise);
    expect(returned.status).toBe('alive');
  });

  it('is safe to call at any rate and never reports time going backwards', () => {
    const service = new HealthService();
    const samples = Array.from({ length: 500 }, () => service.liveness().uptimeSeconds);

    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index] ?? -1).toBeGreaterThanOrEqual(samples[index - 1] ?? -1);
    }
  });
});

describe('the readiness projection type cannot carry a detail string', () => {
  it('declares checks with exactly the keys name and ok', () => {
    // Compile-time assertions. `npm run typecheck` covers `tests/**` (root
    // tsconfig `include` is `**/*.ts`), so a widened projection type fails the
    // build; the runtime `expect` below is only the carrier for the constants.
    const projectedKeysAreExact: Exact<keyof ProjectedCheck, 'name' | 'ok'> = true;
    // The *source* type is wider — it does carry a detail. If it did not, the
    // projection would be proving nothing at all.
    const reportedKeysIncludeDetail: Exact<keyof ReportedCheck, 'name' | 'ok' | 'detail'> = true;

    expect(projectedKeysAreExact).toBe(true);
    expect(reportedKeysIncludeDetail).toBe(true);
  });

  it('rejects a projection literal that smuggles a detail through', () => {
    const smuggled: ReadinessProjection = {
      status: 'ready',
      checks: [
        // @ts-expect-error — `detail` is not part of ReadinessProjection. This
        // line failing to error would mean the type had been widened and a role
        // name could reach an unauthenticated HTTP body.
        { name: 'database.role.no-bypassrls', ok: true, detail: ROLE_NAME },
      ],
    };

    // TypeScript refused the literal; the value itself shows what would have
    // been disclosed had it been accepted.
    expect(Object.keys(smuggled.checks[0] ?? {})).toContain('detail');
  });

  it('pins HealthService.readiness to that return type', () => {
    // If the method's return type were ever widened to the raw ReadinessReport,
    // this assignment stops compiling — which is what makes the two proofs above
    // statements about the real endpoint rather than about a local alias.
    const pinned: (probeTenantId: string) => Promise<ReadinessProjection> = new HealthService()
      .readiness;

    expect(typeof pinned).toBe('function');
  });
});

describe('projecting a readiness report drops every detail', () => {
  it('keeps only { name, ok } for every check', () => {
    const projection = project(REPORT_WITH_DETAILS);

    expect(projection.checks).toHaveLength(REPORT_WITH_DETAILS.checks.length);
    for (const check of projection.checks) {
      expect(Object.keys(check).sort()).toEqual(['name', 'ok']);
    }
  });

  it('leaks no role name, host, or database name into the JSON body', () => {
    const body = JSON.stringify(project(REPORT_WITH_DETAILS));

    expect(body).not.toContain(ROLE_NAME);
    expect(body).not.toContain(INTERNAL_HOST);
    expect(body).not.toContain(INTERNAL_DATABASE);
    expect(body).not.toContain('detail');
  });

  it('discloses no role field either — a verdict, not a topology', () => {
    const projection = project(REPORT_WITH_DETAILS);

    expect(Object.keys(projection).sort()).toEqual(['checks', 'status']);
    // `web` / `worker` tells a caller which tier answered. The verdict does not
    // need it, so it is not projected.
    expect(JSON.stringify(projection)).not.toContain('web');
  });

  it('carries the verdict and the per-check booleans through unchanged', () => {
    // Dropping detail must not blur the answer: the balancer still learns the
    // state and which named check failed.
    for (const state of ['ready', 'degraded', 'unavailable'] as const) {
      expect(project({ ...REPORT_WITH_DETAILS, state }).status).toBe(state);
    }

    const projection = project(REPORT_WITH_DETAILS);
    expect(projection.checks.map((check) => check.name)).toEqual([
      'database.reachable',
      'database.role.no-bypassrls',
      'capability.shared.document_write',
    ]);
    expect(projection.checks.map((check) => check.ok)).toEqual([true, true, false]);
  });

  it('projects an empty check list without inventing a check', () => {
    const projection = project({ role: 'worker', state: 'unavailable', checks: [] });

    expect(projection).toEqual({ status: 'unavailable', checks: [] });
  });
});

describe('/api/health (Phase 1-1) is unchanged by P1-15', () => {
  const PINNED_KEYS = [
    'commit',
    'configured',
    'environment',
    'service',
    'status',
    'timestamp',
    'version',
  ] as const;

  const HEALTH_TEST_PATH = join(process.cwd(), 'tests', 'health.test.ts');

  it('still exports GET, and P1-15 adds nothing to the original route module', () => {
    // Read as source rather than imported.
    //
    // `tests/health.test.ts` already imports this module and exercises the
    // handler; importing it a *second* time here doubled the cold Next.js module
    // load, and under full-suite parallelism that pushed the sibling file's
    // assertion past the default timeout. The flake was ours, so it is removed at
    // the source rather than papered over with a longer timeout — and reading the
    // file proves the same two facts: the export exists, and P1-15 did not touch it.
    const source = readFileSync(join(API_SRC_ROOT, 'app', 'api', 'health', 'route.ts'), 'utf8');

    // Synchronous by design — the Phase 1-1 probe performs no I/O.
    expect(source).toMatch(/export\s+function\s+GET\s*\(/);
    // P1-15's health work lives at /api/v1/health/*; nothing from the
    // shared-services module may appear in the Phase 1-1 route.
    expect(source).not.toContain('shared-services');
    expect(source).not.toContain('defineOperation');
  });

  it('still has its seven-key contract pinned by tests/health.test.ts', () => {
    const source = readFileSync(HEALTH_TEST_PATH, 'utf8');
    const pin = /expect\(Object\.keys\(body\)\.sort\(\)\)\.toEqual\(\s*\[([^\]]*)\]/.exec(source);

    // A missing pin is the failure this guards against: the endpoint could then
    // grow a field with nothing objecting.
    expect(pin).not.toBeNull();

    const pinnedKeys = [...(pin?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(pinnedKeys).toHaveLength(7);
    expect([...pinnedKeys].sort()).toEqual([...PINNED_KEYS].sort());
  });

  it('is not one of the new versioned paths, so the container probe is untouched', () => {
    // The P1-15 endpoints live at /api/v1/health/*. If a phase ever repointed
    // the old path at the new projection, this file would still exist but the
    // seven-key pin above would have had to change — which is why both
    // assertions are kept together.
    const source = readFileSync(HEALTH_TEST_PATH, 'utf8');

    expect(source).toContain("import('@/app/api/health/route')");
    expect(source).not.toContain('/api/v1/health');
  });
});
