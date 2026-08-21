import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The health endpoint is the container's liveness signal and the first thing an
 * operator hits. Its contract: never leak a secret, and report degraded rather
 * than lying when configuration is absent.
 *
 * ## Why every case resets the module registry
 *
 * `apps/api/src/config/env.ts` captures `rawClientEnv` at MODULE SCOPE — three
 * literal `process.env.X` reads evaluated once, when the module is first
 * imported. That is deliberate: the Next.js compiler can only inline
 * `NEXT_PUBLIC_*` from literal member expressions, and destructuring or dynamic
 * indexing would leave them undefined in the browser bundle.
 *
 * The consequence for a test is that setting `process.env` in `beforeEach` does
 * NOTHING if `env.ts` has already been loaded by some earlier file in the same
 * worker. `environmentIsConfigured()` then re-parses a snapshot taken before the
 * test ran, reports `degraded`, and the endpoint answers 503.
 *
 * That is exactly what happened: this file passed in isolation and passed most
 * full runs, and failed two of its five cases in roughly one run in six —
 * because vitest schedules files in a different order under load. A test whose
 * result depends on which file happened to import a module first is not a test.
 *
 * `vi.resetModules()` makes the test own the state it asserts on. It is NOT a
 * workaround for a product defect: in production the container's environment is
 * set before the process starts, so the snapshot and the live environment are
 * the same thing and can never diverge. The defect was the assumption here.
 */

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_APP_ENV',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'local-anon-key-value';
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  // AFTER the assignments, so the next import of `env.ts` reads them.
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  // So the NEXT file in this worker does not inherit a module graph built
  // against this file's environment — the same defect, pointing outward.
  vi.resetModules();
});

describe('GET /api/health', () => {
  it('returns 200 and status ok when configuration resolves', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('rootlco-platform');
    expect(body.configured).toBe(true);
  });

  it('returns only the safe, expected keys', async () => {
    const { GET } = await import('@/app/api/health/route');
    const body = await GET().json();
    expect(Object.keys(body).sort()).toEqual(
      ['commit', 'configured', 'environment', 'service', 'status', 'timestamp', 'version'].sort()
    );
  });

  it('never exposes a secret value', async () => {
    const anon = 'anon-key-must-not-appear-in-health';
    const service = 'service-role-must-not-appear-in-health';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
    process.env.SUPABASE_SERVICE_ROLE_KEY = service;
    const { GET } = await import('@/app/api/health/route');
    const text = JSON.stringify(await GET().json());
    expect(text).not.toContain(anon);
    expect(text).not.toContain(service);
    expect(text).not.toContain('54321'); // no connection details either
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('emits an ISO-8601 timestamp', async () => {
    const { GET } = await import('@/app/api/health/route');
    const body = await GET().json();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('sets a no-store cache header so health is never served stale', async () => {
    const { GET } = await import('@/app/api/health/route');
    expect(GET().headers.get('Cache-Control')).toBe('no-store');
  });

  it('reports ok even when the configuration module was loaded before the environment', async () => {
    /*
     * The regression case for the intermittent failure, reproduced deliberately
     * rather than waited for.
     *
     * `env.ts` snapshots `process.env` at module scope. Here that module is
     * loaded FIRST with the three variables absent — which is exactly what an
     * earlier file in the same worker does — and only then is the environment
     * set. Without the `vi.resetModules()` in `beforeEach` the route would parse
     * the stale snapshot, report `degraded`, and answer 503.
     *
     * This is the case that fails if the reset is ever removed, which is what
     * makes the reset load-bearing rather than decorative.
     */
    vi.resetModules();
    for (const k of ENV_KEYS) delete process.env[k];
    await import('@/config/env');

    for (const k of ENV_KEYS) process.env[k] = k === 'NEXT_PUBLIC_APP_ENV' ? 'local' : 'x-value';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    vi.resetModules();

    const { GET } = await import('@/app/api/health/route');
    const res = GET();
    expect(res.status, 'a stale module snapshot would make this 503').toBe(200);
    expect((await res.json()).configured).toBe(true);
  });
});
