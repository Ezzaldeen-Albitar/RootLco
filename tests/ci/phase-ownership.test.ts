/**
 * Mutation tests for the phase changed-file ownership gate.
 *
 * The expensive failure this prevents is not a broken build. It is a Backend or
 * Database change riding inside a Frontend phase: reviewed as Frontend, gated
 * by no Backend job, and invisible until it breaks something in production.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, evaluate, PROFILES } from '../../scripts/ci/check-phase-ownership.mjs';

describe('classify', () => {
  it('places each path in the bucket that owns it', () => {
    expect(classify('apps/web/src/features/authentication/login/LoginForm.tsx')).toBe('web');
    expect(classify('apps/api/src/app/api/v1/users/route.ts')).toBe('apiSource');
    expect(classify('apps/api/package.json')).toBe('apiConfig');
    expect(classify('supabase/migrations/0120_new.sql')).toBe('migrations');
    expect(classify('supabase/config.toml')).toBe('supabase');
    expect(classify('docs/phase-1/phase-1-26/task-register.md')).toBe('docs');
    expect(classify('scripts/ci/check-api-backend-only.mjs')).toBe('tooling');
    expect(classify('.github/workflows/pr-ci.yml')).toBe('tooling');
    expect(classify('tests/ci/phase-ownership.test.ts')).toBe('tests');
    expect(classify('package.json')).toBe('rootConfig');
    expect(classify('Dockerfile')).toBe('rootConfig');
  });

  it('classifies a migration as a migration, never merely as supabase', () => {
    // Order matters: the specific rule must win, or a new migration would be
    // permitted anywhere `supabase` is permitted.
    expect(classify('supabase/migrations/0001_extensions.sql')).toBe('migrations');
  });
});

describe('p1-26-frontend profile', () => {
  const FRONTEND_CHANGES = [
    'apps/web/src/features/authentication/login/LoginForm.tsx',
    'apps/web/tests/login.dom.test.tsx',
    'docs/phase-1/phase-1-26/task-register.md',
    'scripts/ci/check-phase-ownership.mjs',
    'tests/ci/phase-ownership.test.ts',
    'package.json',
  ];

  it('permits a Frontend phase to change web, docs, tooling, tests and root config', () => {
    const { failures, counts } = evaluate(FRONTEND_CHANGES, 'p1-26-frontend');
    expect(failures).toEqual([]);
    expect(counts.web).toBeGreaterThan(0);
    expect(counts.changed).toBe(FRONTEND_CHANGES.length);
  });

  it.each([
    ['API source', 'apps/api/src/modules/iam/application/user-service.ts', 'apiSource'],
    ['API config', 'apps/api/next.config.ts', 'apiConfig'],
    ['a migration', 'supabase/migrations/0120_p1_26.sql', 'migrations'],
    ['the database', 'supabase/config.toml', 'supabase'],
  ])('fails when a Frontend phase changes %s', (_label, path, bucket) => {
    const { failures } = evaluate([...FRONTEND_CHANGES, path], 'p1-26-frontend');
    expect(failures.some((f) => f.startsWith(`${bucket}:`) && f.includes(path))).toBe(true);
  });

  it('names the Backend remediation as the route for an API change', () => {
    // The gate must not merely refuse — a refusal with no route is where a
    // Backend change gets smuggled in instead of being separated.
    const { failures } = evaluate(
      [...FRONTEND_CHANGES, 'apps/api/src/modules/iam/application/authentication-service.ts'],
      'p1-26-frontend'
    );
    expect(failures.some((f) => f.includes('Backend remediation'))).toBe(true);
  });

  it('fails on an unclassified file rather than shrugging', () => {
    const { failures } = evaluate([...FRONTEND_CHANGES, 'weird/place/thing.bin'], 'p1-26-frontend');
    expect(failures.some((f) => f.includes('unclassified changed file'))).toBe(true);
  });

  it('fails on an empty change set rather than passing vacuously', () => {
    // Every rule iterates the changed set, so an empty set judges nothing. That
    // is indistinguishable from a diff against the wrong base ref.
    const { failures } = evaluate([], 'p1-26-frontend');
    expect(failures.some((f) => f.includes('broken comparison'))).toBe(true);
  });

  it('rejects an unknown profile instead of defaulting to a permissive one', () => {
    const { failures } = evaluate(FRONTEND_CHANGES, 'no-such-profile');
    expect(failures.some((f) => f.includes('unknown ownership profile'))).toBe(true);
  });
});

describe('api-boundary profile', () => {
  it('permits the remediation to change API source and tooling', () => {
    const { failures } = evaluate(
      [
        'apps/api/src/app/api/health/route.ts',
        'apps/api/package.json',
        'scripts/ci/check-api-backend-only.mjs',
        'docs/phase-1/phase-1-26/preflight/findings.md',
      ],
      'api-boundary'
    );
    expect(failures).toEqual([]);
  });

  it('still forbids the remediation from touching migrations or the database', () => {
    const { failures } = evaluate(
      ['apps/api/package.json', 'supabase/migrations/0120_x.sql'],
      'api-boundary'
    );
    expect(failures.some((f) => f.includes('must not change a migration'))).toBe(true);
  });
});

describe('backend-login-contract profile', () => {
  const BACKEND_CHANGES = [
    'apps/api/src/modules/iam/application/authentication-service.ts',
    'apps/api/src/modules/iam/provider/supabase-provider.ts',
    'apps/api/src/app/api/v1/auth/login/route.ts',
    'tests/backend/iam-auth-provider.test.ts',
    'docs/phase-1/phase-1-26/login-identity-contract.md',
    'scripts/ci/check-phase-ownership.mjs',
  ];

  it('permits the login-contract remediation to change API source, tests and docs', () => {
    const { failures, counts } = evaluate(BACKEND_CHANGES, 'backend-login-contract');
    expect(failures).toEqual([]);
    expect(counts.apiSource).toBeGreaterThan(0);
  });

  it('forbids the Frontend half from riding along in the Backend change', () => {
    // The point of a separate profile. A Backend profile that also permitted
    // `web` would let both halves of a contract change land in one commit that
    // neither the Frontend nor the Backend review would see whole — the same
    // hole `p1-26-frontend` closes, merely pointing the other way.
    const { failures } = evaluate(
      [...BACKEND_CHANGES, 'apps/web/src/features/authentication/login/LoginForm.tsx'],
      'backend-login-contract'
    );
    expect(failures.some((f) => f.startsWith('web:'))).toBe(true);
  });

  it.each([
    ['a migration', 'supabase/migrations/0121_login.sql', 'migrations'],
    ['the database', 'supabase/config.toml', 'supabase'],
  ])('still forbids %s', (_label, path, bucket) => {
    const { failures } = evaluate([...BACKEND_CHANGES, path], 'backend-login-contract');
    expect(failures.some((f) => f.startsWith(`${bucket}:`) && f.includes(path))).toBe(true);
  });
});

describe('p1-27-backend-partner-identity profile', () => {
  /*
   * This profile exists because seven API source files were riding inside the
   * P1-27 FRONTEND branch — reviewed by nobody as Backend and triggered by no
   * Backend gate, which is the exact failure `p1-26-frontend` was written to
   * stop and which it caught here.
   */
  const BACKEND_CHANGES = [
    'apps/api/src/modules/vehicle/application/partner-identity.ts',
    'apps/api/src/modules/crm/application/customer-read-service.ts',
    'apps/api/src/modules/crm/data/customer-read-repository.ts',
    'tests/backend/vehicle-partner-identity.test.ts',
    'docs/phase-1/phase-1-27/final-canonical-remediation.md',
    'scripts/ci/check-phase-ownership.mjs',
  ];

  it('permits the partner-identity remediation to change API source, tests and docs', () => {
    const { failures, counts } = evaluate(BACKEND_CHANGES, 'p1-27-backend-partner-identity');
    expect(failures).toEqual([]);
    expect(counts.apiSource).toBeGreaterThan(0);
  });

  it('forbids the Frontend half from riding along', () => {
    const { failures } = evaluate(
      [...BACKEND_CHANGES, 'apps/web/src/components/party/PartyLabel.tsx'],
      'p1-27-backend-partner-identity'
    );
    expect(failures.some((f) => f.startsWith('web:'))).toBe(true);
  });

  it.each([
    ['a migration', 'supabase/migrations/0121_identity.sql', 'migrations'],
    ['the database', 'supabase/config.toml', 'supabase'],
  ])('still forbids %s', (_label, path, bucket) => {
    const { failures } = evaluate([...BACKEND_CHANGES, path], 'p1-27-backend-partner-identity');
    expect(failures.some((f) => f.startsWith(`${bucket}:`) && f.includes(path))).toBe(true);
  });
});

describe('p1-27-frontend profile', () => {
  it('forbids API source under P1-27’s own name, not under P1-26’s', () => {
    /*
     * The gate defaults to `p1-26-frontend` when no profile argument is given,
     * so P1-27 was measured against ANOTHER phase's declaration for its entire
     * life. The rules are identical; the declaration is the point. A phase that
     * borrows a profile has not declared what it may change.
     */
    const { failures } = evaluate(
      ['apps/web/src/features/crm/customers/api.ts', 'apps/api/src/modules/crm/index.ts'],
      'p1-27-frontend'
    );
    expect(failures.some((f) => f.startsWith('apiSource:'))).toBe(true);
    for (const bucket of ['apiSource', 'apiConfig', 'migrations', 'supabase']) {
      expect(Object.keys(PROFILES['p1-27-frontend'].forbidden)).toContain(bucket);
    }
  });

  it('permits exactly what the P1-26 Frontend profile permits', () => {
    // Divergence between two Frontend profiles would be a governance difference
    // nobody decided on. If one is ever loosened, this says so.
    expect([...PROFILES['p1-27-frontend'].allowed].sort()).toEqual(
      [...PROFILES['p1-26-frontend'].allowed].sort()
    );
    expect(Object.keys(PROFILES['p1-27-frontend'].forbidden).sort()).toEqual(
      Object.keys(PROFILES['p1-26-frontend'].forbidden).sort()
    );
  });
});

describe('every profile is SELECTABLE, not merely declared', () => {
  it('is reachable by name from the command line or the environment', () => {
    /*
     * The gate's npm script passes no argument, so every invocation used the
     * `p1-26-frontend` default — which forbids `apiSource` and therefore cannot
     * pass on a Backend branch at all. The two P1-27 profiles were reachable
     * from no script and no workflow: a profile nothing can select is a
     * declaration, not a gate, and that is this phase's own recurring defect
     * appearing in its own tooling.
     *
     * Asserted by reading the script, because the selection happens in `main()`
     * which this file does not call.
     */
    const source = readFileSync(
      join(process.cwd(), 'scripts', 'ci', 'check-phase-ownership.mjs'),
      'utf8'
    );
    expect(source).toContain('process.env.PHASE_OWNERSHIP_PROFILE');
    expect(source).toContain('process.env.PHASE_OWNERSHIP_BASE');
    // And every declared profile must be a name `evaluate` accepts, or the
    // selection mechanism points at nothing.
    for (const name of Object.keys(PROFILES)) {
      const { failures } = evaluate(['apps/web/src/x.ts'], name);
      expect(
        failures.some((f) => f.includes('unknown ownership profile')),
        name
      ).toBe(false);
    }
  });
});

describe('profile declarations', () => {
  it('declares every profile with a reason and disjoint allow/forbid sets', () => {
    for (const [name, profile] of Object.entries(PROFILES)) {
      expect(profile.why, `${name} states why it exists`).toBeTruthy();
      for (const bucket of profile.allowed) {
        expect(Object.keys(profile.forbidden), `${name}: ${bucket}`).not.toContain(bucket);
      }
    }
  });

  it('forbids API source, supabase and migrations in the P1-26 Frontend profile', () => {
    // The three that matter for P1-26's governance statement.
    const forbidden = Object.keys(PROFILES['p1-26-frontend'].forbidden);
    expect(forbidden).toContain('apiSource');
    expect(forbidden).toContain('supabase');
    expect(forbidden).toContain('migrations');
  });
});
