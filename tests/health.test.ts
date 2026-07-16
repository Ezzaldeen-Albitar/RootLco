import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * The health endpoint is the container's liveness signal and the first thing an
 * operator hits. Its contract: never leak a secret, and report degraded rather
 * than lying when configuration is absent.
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
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
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
});
