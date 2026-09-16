/**
 * What a deployment is required to be given, and what refuses it when it is not.
 *
 * Until now every value in `backend-config.ts` was optional-or-defaulted, which
 * is exactly right for a repository whose only environment is a developer's
 * machine — the whole test tier, the launcher and a fresh clone run with no
 * database, no identity provider and no object store. The cost is that a
 * deployment missing its database URL, its JWT secret or its redirect allow-list
 * starts cleanly and fails at the first request instead of at boot.
 *
 * `productionConfigurationProblems()` is the answer, and the property that makes
 * it safe to wire into readiness is asserted first below: OUTSIDE `staging` and
 * `production` it returns nothing at all, so local and test behaviour cannot
 * change. Every later case is about what it refuses once the environment says
 * it is deployed.
 *
 * Two things it deliberately does NOT do, both asserted:
 *   - it never reports a VALUE, only a name, because the names it reports are
 *     the names of credentials;
 *   - it does not read `process.env` itself. It is handed the record, which is
 *     why these cases need no environment mutation and no reset seam.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  productionConfigurationProblems,
  __resetBackendConfigForTests,
} from '@api/server/config/backend-config';
import { foundationReadiness } from '@api/server/health/readiness';

/**
 * A record in which nothing a deployment owes is missing.
 *
 * The values are not credentials and are not shaped like any: the function
 * under test only ever asks whether a value is present, so `set` is enough and
 * anything more would be a credential-shaped string in a tracked file for no
 * benefit at all.
 */
function fullyConfigured(): Record<string, string> {
  return {
    NEXT_PUBLIC_APP_ENV: 'production',
    DATABASE_URL: 'set',
    PLATFORM_DATABASE_URL: 'set',
    SUPABASE_SERVICE_ROLE_KEY: 'set',
    AUTH_JWT_SECRET: 'set',
    AUTH_JWT_ISSUER: 'set',
    AUTH_REDIRECT_ALLOWLIST: 'set',
    CORS_ALLOWED_ORIGINS: 'set',
    STORAGE_PROVIDER: 's3_compatible',
    STORAGE_S3_ENDPOINT: 'set',
    STORAGE_S3_ACCESS_KEY_ID: 'set',
    STORAGE_S3_SECRET_ACCESS_KEY: 'set',
    RATE_LIMIT_ENABLED: 'true',
  };
}

describe('environments that are not deployed', () => {
  it('reports nothing for the local environment, however empty it is', () => {
    expect(productionConfigurationProblems({ NEXT_PUBLIC_APP_ENV: 'local' })).toEqual([]);
  });

  it('reports nothing when the environment is unset at all', () => {
    // The schema's own default is `local`, and an unset value must behave the
    // same way: a fresh clone has no `.env.local` yet.
    expect(productionConfigurationProblems({})).toEqual([]);
  });

  it('reports nothing for `development`', () => {
    expect(productionConfigurationProblems({ NEXT_PUBLIC_APP_ENV: 'development' })).toEqual([]);
  });
});

describe('a deployed environment with everything supplied', () => {
  it('reports no problems in production', () => {
    expect(productionConfigurationProblems(fullyConfigured())).toEqual([]);
  });

  it('reports no problems in staging, which is held to the same bar', () => {
    expect(
      productionConfigurationProblems({ ...fullyConfigured(), NEXT_PUBLIC_APP_ENV: 'staging' })
    ).toEqual([]);
  });
});

describe('a deployed environment with values missing', () => {
  it('names exactly the two that are absent, and nothing else', () => {
    const env = fullyConfigured();
    delete env['PLATFORM_DATABASE_URL'];
    delete env['AUTH_JWT_SECRET'];

    expect(productionConfigurationProblems(env)).toEqual([
      'PLATFORM_DATABASE_URL',
      'AUTH_JWT_SECRET',
    ]);
  });

  it('treats an empty and a whitespace-only value as absent', () => {
    // `AUTH_REDIRECT_ALLOWLIST=` in a template is how "unset" is written, and a
    // present-but-empty comma list rejects every redirect just as an absent one
    // does. Reporting only `undefined` would miss the commonest spelling.
    const env = { ...fullyConfigured(), AUTH_REDIRECT_ALLOWLIST: '', CORS_ALLOWED_ORIGINS: '   ' };

    expect(productionConfigurationProblems(env)).toEqual([
      'AUTH_REDIRECT_ALLOWLIST',
      'CORS_ALLOWED_ORIGINS',
    ]);
  });

  it('reports names only — no value from the record reaches the result', () => {
    const env = fullyConfigured();
    delete env['DATABASE_URL'];
    env['AUTH_JWT_SECRET'] = 'a-value-that-must-never-be-echoed';

    const problems = productionConfigurationProblems(env);
    expect(problems).toEqual(['DATABASE_URL']);
    expect(problems.join(' ')).not.toContain('a-value-that-must-never-be-echoed');
  });
});

describe('storage, which is not feature-gated', () => {
  it('refuses the default `unconfigured`, which cannot serve an attachment', () => {
    const env = { ...fullyConfigured(), STORAGE_PROVIDER: 'unconfigured' };
    expect(productionConfigurationProblems(env)).toEqual(['STORAGE_PROVIDER']);
  });

  it('refuses the in-process adapter, which signs against an unresolvable host', () => {
    const env = { ...fullyConfigured(), STORAGE_PROVIDER: 'local_fake' };
    expect(productionConfigurationProblems(env)).toEqual(['STORAGE_PROVIDER']);
  });

  it('demands the S3 credentials once the S3 adapter is selected', () => {
    const env = fullyConfigured();
    delete env['STORAGE_S3_ACCESS_KEY_ID'];
    delete env['STORAGE_S3_SECRET_ACCESS_KEY'];

    expect(productionConfigurationProblems(env)).toEqual([
      'STORAGE_S3_ACCESS_KEY_ID',
      'STORAGE_S3_SECRET_ACCESS_KEY',
    ]);
  });
});

describe('the rate limiter', () => {
  it('lists RATE_LIMIT_ENABLED when a deployment switches it off', () => {
    const env = { ...fullyConfigured(), RATE_LIMIT_ENABLED: 'false' };
    expect(productionConfigurationProblems(env)).toEqual(['RATE_LIMIT_ENABLED']);
  });

  it('accepts it unset, because the schema default is on', () => {
    const env = fullyConfigured();
    delete env['RATE_LIMIT_ENABLED'];
    expect(productionConfigurationProblems(env)).toEqual([]);
  });

  it('does not list it when a local environment switches it off', () => {
    // Turning the limiter off locally is a legitimate thing to do while
    // exercising a route by hand, and must not be reported as a defect.
    expect(
      productionConfigurationProblems({ NEXT_PUBLIC_APP_ENV: 'local', RATE_LIMIT_ENABLED: 'false' })
    ).toEqual([]);
  });
});

/**
 * The readiness wiring, exercised without a database.
 *
 * `foundationReadiness()` normally opens a read-only transaction, which is why
 * its other cases live in the database-bound tier. These two do not need one:
 * with `DATABASE_URL` absent the pool refuses to be built before any connection
 * is attempted, so the report is produced from the catch path — and that is
 * precisely the path the configuration check has to survive, because a
 * deployment that is unconfigured is usually also unreachable, and reporting
 * only "the database did not answer" would send an operator to the wrong place.
 */
describe('readiness reports the configuration verdict', () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    __resetBackendConfigForTests();
  });

  /** Clears the whole environment and installs exactly the given names. */
  function only(env: Record<string, string>): void {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    __resetBackendConfigForTests();
  }

  it('carries the check, passing, outside a deployed environment', async () => {
    only({ NEXT_PUBLIC_APP_ENV: 'local' });

    const report = await foundationReadiness('00000000-0000-0000-0000-000000000000');
    const check = report.checks.find((entry) => entry.name === 'configuration.production-required');

    expect(check?.ok).toBe(true);
    // No detail at all when there is nothing to report — an empty string here
    // would read as "a problem whose name we lost".
    expect(check?.detail).toBeUndefined();
  });

  it('is unavailable and names the missing values in production', async () => {
    only({ NEXT_PUBLIC_APP_ENV: 'production' });

    const report = await foundationReadiness('00000000-0000-0000-0000-000000000000');
    const check = report.checks.find((entry) => entry.name === 'configuration.production-required');

    expect(report.state).toBe('unavailable');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('DATABASE_URL');
    expect(check?.detail).toContain('AUTH_JWT_SECRET');
  });
});
