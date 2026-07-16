import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __schemas, EnvironmentValidationError } from '@/config/env';

const { clientSchema, serverSchema } = __schemas;

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key-value',
  NEXT_PUBLIC_APP_ENV: 'local',
};

describe('client environment schema', () => {
  it('accepts a valid local configuration', () => {
    const r = clientSchema.safeParse(VALID);
    expect(r.success).toBe(true);
  });

  it('defaults NEXT_PUBLIC_APP_ENV to "local" when absent', () => {
    const { NEXT_PUBLIC_APP_ENV: _omitted, ...rest } = VALID;
    const r = clientSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.NEXT_PUBLIC_APP_ENV).toBe('local');
  });

  it('rejects a missing Supabase URL', () => {
    const { NEXT_PUBLIC_SUPABASE_URL: _omitted, ...rest } = VALID;
    const r = clientSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('rejects a non-URL Supabase URL', () => {
    const r = clientSchema.safeParse({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' });
    expect(r.success).toBe(false);
  });

  it('rejects an empty anon key', () => {
    const r = clientSchema.safeParse({ ...VALID, NEXT_PUBLIC_SUPABASE_ANON_KEY: '' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown environment name', () => {
    const r = clientSchema.safeParse({ ...VALID, NEXT_PUBLIC_APP_ENV: 'prod' });
    expect(r.success).toBe(false);
  });
});

describe('server environment schema', () => {
  it('treats server secrets as optional in Phase 1-1', () => {
    // No privileged server operation exists yet, so absence must not crash the app.
    const r = serverSchema.safeParse({ NODE_ENV: 'development' });
    expect(r.success).toBe(true);
  });

  it('rejects an empty service-role key when one is supplied', () => {
    const r = serverSchema.safeParse({ NODE_ENV: 'development', SUPABASE_SERVICE_ROLE_KEY: '' });
    expect(r.success).toBe(false);
  });
});

describe('EnvironmentValidationError', () => {
  it('never contains a secret value', () => {
    // The whole point of the safe-error rule: names and reasons, never values.
    const secret = 'super-secret-service-role-value-9f3a';
    const parsed = clientSchema.safeParse({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: secret });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const err = new EnvironmentValidationError(
      'client',
      parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    );
    expect(err.message).not.toContain(secret);
    expect(err.message).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(err.name).toBe('EnvironmentValidationError');
  });
});

describe('serverEnv browser guard', () => {
  const original = globalThis.window;
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });
  afterEach(() => {
    if (original === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = original;
  });

  it('refuses to read server configuration in the browser', async () => {
    const { serverEnv } = await import('@/config/env');
    expect(() => serverEnv()).toThrow(/called in the browser/i);
  });
});
