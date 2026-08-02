/**
 * Mutation tests for the phase changed-file ownership gate.
 *
 * The expensive failure this prevents is not a broken build. It is a Backend or
 * Database change riding inside a Frontend phase: reviewed as Frontend, gated
 * by no Backend job, and invisible until it breaks something in production.
 */
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

describe('profile declarations', () => {
  it('declares both profiles with a reason and disjoint allow/forbid sets', () => {
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
