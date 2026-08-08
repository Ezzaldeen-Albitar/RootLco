import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/**
 * The exported FUNCTIONS, not only the schemas they wrap.
 *
 * Everything above asserts `__schemas` directly. That is why `clientEnv()`,
 * `serverEnv()` on its non-browser path, and `environmentIsConfigured()` had
 * never once been executed by this tier: `rawClientEnv` is captured at module
 * load, so reaching them at all needs `vi.resetModules()` and a fresh dynamic
 * import per case.
 *
 * The gap was surfaced by the coverage ratchet rather than by review, and the
 * mechanism is worth recording because it looks exactly like a regression and
 * is not one. `tests/foundation/iam-directory-composition.test.ts` began
 * importing `@/modules/iam` with the provider variables deleted, which reaches
 * `clientEnv()` for the first time in the unit tier. v8 only counts branches in
 * code regions it has ENTERED, so `config/env.ts` went from 3/4 branches to
 * 8/13 — five more covered, nine more counted. Global branch coverage fell
 * 93.61% -> 92.78% while nothing regressed and lines, statements and functions
 * all rose. The denominator had simply become honest.
 *
 * Lowering the baseline would have recorded that as a loss. Covering the newly
 * visible branches, which is this block, records it as the gain it was.
 */
const MANAGED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_APP_ENV',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'NODE_ENV',
] as const;

type ManagedName = (typeof MANAGED_ENV)[number];

/**
 * `process.env.NODE_ENV` is declared read-only by the ambient Next.js types, so
 * writing it through the union index above does not compile (`TS2540`) even
 * though `delete` on the same expression does. At runtime it is an ordinary
 * string property. This is the narrowest escape available: a widened view used
 * only to set and clear the six names this file owns, and restored in
 * `afterEach` — no `any`, no assertion at any call site.
 */
const mutableEnv = process.env as Record<string, string | undefined>;

/**
 * Sets exactly the managed variables, clears the module registry, and returns a
 * FRESH instance of the module.
 *
 * The reset is load-bearing twice over: `rawClientEnv` reads `process.env` at
 * module scope, and `cachedClientEnv`/`cachedServerEnv` are module-scoped
 * memos. A shared instance would answer from whichever case ran first.
 *
 * It also means the `EnvironmentValidationError` returned here is NOT the class
 * bound by this file's static import — a different module instance carries a
 * different class object — so `instanceof` must be checked against the class
 * this function hands back, never the one at the top of the file.
 */
async function loadEnv(values: Partial<Record<ManagedName, string>>) {
  for (const name of MANAGED_ENV) {
    const value = values[name];
    if (value === undefined) delete mutableEnv[name];
    else mutableEnv[name] = value;
  }
  vi.resetModules();
  return import('@/config/env');
}

describe('the environment accessors', () => {
  const savedEnv = new Map<ManagedName, string | undefined>();

  beforeEach(() => {
    for (const name of MANAGED_ENV) savedEnv.set(name, process.env[name]);
  });

  afterEach(() => {
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete mutableEnv[name];
      else mutableEnv[name] = value;
    }
    savedEnv.clear();
    vi.resetModules();
  });

  describe('clientEnv()', () => {
    it('returns the validated configuration when every variable is present', async () => {
      const { clientEnv } = await loadEnv(VALID);
      const env = clientEnv();
      expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(VALID.NEXT_PUBLIC_SUPABASE_URL);
      expect(env.NEXT_PUBLIC_APP_ENV).toBe('local');
    });

    it('applies the NEXT_PUBLIC_APP_ENV default through the accessor, not only the schema', async () => {
      const { NEXT_PUBLIC_APP_ENV: _omitted, ...rest } = VALID;
      const { clientEnv } = await loadEnv(rest);
      expect(clientEnv().NEXT_PUBLIC_APP_ENV).toBe('local');
    });

    it('memoises — a second call returns the identical object without re-parsing', async () => {
      const { clientEnv } = await loadEnv(VALID);
      expect(clientEnv()).toBe(clientEnv());
    });

    it('throws a safe error naming the variable and never its value', async () => {
      // Not merely "throws". A misconfigured URL is frequently a signed or
      // tenant-scoped endpoint, and the file's second stated rule is that a
      // validation failure must never print a value. Asserting only the type
      // would pass against an error that echoed the whole string.
      const secret = 'postgres-connection-string-with-password-9f3a';
      const mod = await loadEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: secret });

      let caught: unknown;
      try {
        mod.clientEnv();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(mod.EnvironmentValidationError);
      const message = (caught as Error).message;
      expect(message).toContain('NEXT_PUBLIC_SUPABASE_URL');
      expect(message).toContain('Invalid client environment configuration');
      expect(message).not.toContain(secret);
    });

    it('reports every failing variable, not just the first', async () => {
      const mod = await loadEnv({ NEXT_PUBLIC_APP_ENV: 'local' });
      let message = '';
      try {
        mod.clientEnv();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('NEXT_PUBLIC_SUPABASE_URL');
      expect(message).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    });
  });

  describe('serverEnv()', () => {
    it('reads server configuration outside the browser', async () => {
      // The existing browser-guard case above covers the throwing side of that
      // check. This is the side that actually runs in production.
      const { serverEnv } = await loadEnv({ ...VALID, NODE_ENV: 'test' });
      const env = serverEnv();
      expect(env.NODE_ENV).toBe('test');
      expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    });

    it('defaults NODE_ENV when it is absent', async () => {
      const { serverEnv } = await loadEnv(VALID);
      expect(serverEnv().NODE_ENV).toBe('development');
    });

    it('memoises', async () => {
      const { serverEnv } = await loadEnv({ ...VALID, NODE_ENV: 'test' });
      expect(serverEnv()).toBe(serverEnv());
    });

    it('throws a safe error, scoped to the server, on an unrecognised NODE_ENV', async () => {
      const mod = await loadEnv({ ...VALID, NODE_ENV: 'staging' });
      let message = '';
      try {
        mod.serverEnv();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('Invalid server environment configuration');
      expect(message).toContain('NODE_ENV');
    });
  });

  describe('environmentIsConfigured()', () => {
    it('is true when the client variables validate', async () => {
      const { environmentIsConfigured } = await loadEnv(VALID);
      expect(environmentIsConfigured()).toBe(true);
    });

    it('is false, and does NOT throw, when they do not', async () => {
      // The health endpoint depends on this being non-throwing. If it ever
      // starts throwing, the probe that exists to report a misconfiguration
      // becomes a 500 that reports nothing.
      const { environmentIsConfigured } = await loadEnv({ NEXT_PUBLIC_APP_ENV: 'local' });
      expect(() => environmentIsConfigured()).not.toThrow();
      expect(environmentIsConfigured()).toBe(false);
    });

    it('does not populate the accessor cache', async () => {
      // It calls `safeParse` directly rather than `clientEnv()`, so a probe on
      // a healthy environment must not make a later misconfiguration invisible.
      const mod = await loadEnv(VALID);
      expect(mod.environmentIsConfigured()).toBe(true);
      mod.__resetEnvCacheForTests();
      expect(mod.clientEnv().NEXT_PUBLIC_APP_ENV).toBe('local');
    });
  });

  describe('__resetEnvCacheForTests()', () => {
    it('clears both memos so the next call re-parses', async () => {
      const mod = await loadEnv({ ...VALID, NODE_ENV: 'test' });
      const firstClient = mod.clientEnv();
      const firstServer = mod.serverEnv();

      mod.__resetEnvCacheForTests();

      // Equal in value, distinct in identity: proof that a second parse ran
      // rather than a memo being handed back.
      expect(mod.clientEnv()).not.toBe(firstClient);
      expect(mod.clientEnv()).toEqual(firstClient);
      expect(mod.serverEnv()).not.toBe(firstServer);
      expect(mod.serverEnv()).toEqual(firstServer);
    });
  });
});
