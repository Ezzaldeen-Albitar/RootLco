/**
 * TDP-2026-10 — the temporary development-path CI policy (Owner approval
 * 2026-10-05), tested for the two things that would make it dangerous:
 *
 *   1. that it RELAXES anything outside a pull request into develop — main's
 *      path must be byte-for-byte the gate it was at bd6b9179; and
 *   2. that, inside a pull request into develop, it lets a change skip a job
 *      that change needs.
 *
 * Every assertion about `main` is made against the repository as it stood at
 * bd6b9179 (read from git, not from a copy in this file), and every assertion
 * about a workflow expression is made by EVALUATING it for a pull request into
 * main and one into develop, not by matching its text.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ALWAYS_REQUIRED,
  CATEGORY_RULES,
  DEVELOPMENT_CONDITIONAL_JOBS,
  classify,
  classifyPath,
  keepStricter,
} from '../../scripts/ci/classify-changes.mjs';
import {
  DECLARED_JOBS,
  STATE,
  acceptableResults,
  declaredJobsFor,
  evaluate,
  toMarkdown,
} from '../../scripts/ci/evaluate-ci-gate.mjs';
import {
  AUTHENTICATED_BROWSER_ALLOW_LIST,
  AUTH_E2E_BASE,
  AUTH_E2E_SPEC_MAP,
  CHECKPOINT_WORKFLOW_REF,
  DEVELOPMENT_GATE_NAME,
  ESCALATION_PATHS,
  INTEGRATION_TESTS_TRIGGERS,
  MAIN_GATE_NAME,
  MONEY_API_GLOBS,
  MONEY_WEB_GLOBS,
  TDP_REVIEW_DATE,
  WEB_QUALITY_TRIGGERS,
  decideGateProfile,
  decideRunRecordMode,
  gateCheckRunName,
  isEscalationPath,
  matchesAny,
  resolveRecordsMode,
} from '../../scripts/lib/development-profile.mjs';
import {
  type ExpressionValue,
  evaluateExpression,
  stepsOf,
  topLevelJobs,
  unwrap,
} from './workflow-expression';

const ROOT = join(__dirname, '../..');
/** The develop tip this policy was designed against. Main's path is pinned to it. */
const BASELINE = 'bd6b9179d203cea20679aebf63221a5e141c40e0';
const readRepo = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tracked = git('ls-files').split('\n').filter(Boolean);

/** Materialises files as they stood at a commit, so the OLD module can be imported. */
const scratch: string[] = [];
async function importAt<T>(sha: string, entry: string, alongside: string[] = []): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'tdp-baseline-'));
  scratch.push(dir);
  for (const file of [entry, ...alongside]) {
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, git('show', `${sha}:${file}`));
  }
  return (await import(pathToFileURL(join(dir, entry)).href)) as T;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const PR_MAIN = { event: 'pull_request', baseRef: 'main' } as const;
const PR_DEVELOP = { event: 'pull_request', baseRef: 'develop' } as const;

type Job = { id: string; alwaysRequired?: boolean; securityEligibility?: string };
type Decision = { required: boolean; reason: string };
type Classification = ReturnType<typeof classify> & {
  jobs: Record<string, Decision>;
  profile?: string;
  cleanRoomProfile?: string;
  runDatabaseBlock?: boolean;
  runContainerBlock?: boolean;
  recordsMode?: string;
  escalated?: boolean;
};
const required = (c: Classification): string[] =>
  Object.entries(c.jobs)
    .filter(([, d]) => d.required)
    .map(([id]) => id)
    .sort();

/* ======================================================================== */

describe('the resolver relaxes only a pull request into develop', () => {
  it('decides the gate profile from the event and the base alone', () => {
    expect(decideGateProfile(PR_DEVELOP)).toBe('development');
    for (const context of [
      PR_MAIN,
      { event: 'push', baseRef: 'develop' },
      { event: 'push', baseRef: 'main' },
      { event: 'workflow_dispatch', baseRef: 'develop' },
      { event: 'schedule' },
      { event: 'pull_request' },
      { baseRef: 'develop' },
      {},
    ]) {
      expect(decideGateProfile(context), JSON.stringify(context)).toBe('full');
    }
  });

  it('names the check run `ci-gate` ONLY for a pull request into main', () => {
    expect(gateCheckRunName(PR_MAIN)).toBe(MAIN_GATE_NAME);
    expect(MAIN_GATE_NAME).toBe('ci-gate');
    for (const context of [PR_DEVELOP, { event: 'push', baseRef: 'main' }, {}]) {
      expect(gateCheckRunName(context)).toBe(DEVELOPMENT_GATE_NAME);
    }
  });

  const PR_CI_REF = 'Ezzaldeen-Albitar/RootLco/.github/workflows/pr-ci.yml@refs/pull/9/merge';
  const deferred = 'checkpoint-deferred';
  const rows: Array<[string, Parameters<typeof decideRunRecordMode>[0], string]> = [
    [
      'case a: a pull request into develop, run by the PR gate',
      { requested: deferred, event: 'pull_request', baseRef: 'develop', workflowRef: PR_CI_REF },
      'checkpoint-deferred',
    ],
    [
      'case b: the checkpoint dispatched on develop with a valid id',
      {
        requested: deferred,
        event: 'workflow_dispatch',
        workflowRef: CHECKPOINT_WORKFLOW_REF,
        checkpointId: 'CP-20261006-1',
      },
      'checkpoint-deferred',
    ],
    [
      'a pull request into main',
      { requested: deferred, event: 'pull_request', baseRef: 'main', workflowRef: PR_CI_REF },
      'strict',
    ],
    [
      'a push to main',
      {
        requested: deferred,
        event: 'push',
        workflowRef:
          'Ezzaldeen-Albitar/RootLco/.github/workflows/protected-develop-verification.yml@refs/heads/main',
      },
      'strict',
    ],
    [
      'release verification',
      {
        requested: deferred,
        event: 'workflow_dispatch',
        workflowRef:
          'Ezzaldeen-Albitar/RootLco/.github/workflows/release-verification.yml@refs/heads/develop',
        checkpointId: 'CP-20261006-1',
      },
      'strict',
    ],
    [
      'nightly assurance',
      {
        requested: deferred,
        event: 'schedule',
        workflowRef:
          'Ezzaldeen-Albitar/RootLco/.github/workflows/nightly-assurance.yml@refs/heads/main',
      },
      'strict',
    ],
    [
      'ci.yml',
      {
        requested: deferred,
        event: 'pull_request',
        baseRef: 'develop',
        workflowRef: 'Ezzaldeen-Albitar/RootLco/.github/workflows/ci.yml@refs/pull/9/merge',
      },
      'strict',
    ],
    [
      'a dispatch of the PR gate from develop',
      {
        requested: deferred,
        event: 'workflow_dispatch',
        workflowRef: 'Ezzaldeen-Albitar/RootLco/.github/workflows/pr-ci.yml@refs/heads/develop',
        checkpointId: 'CP-20261006-1',
      },
      'strict',
    ],
    [
      'the checkpoint workflow dispatched from a work branch',
      {
        requested: deferred,
        event: 'workflow_dispatch',
        workflowRef:
          'Ezzaldeen-Albitar/RootLco/.github/workflows/protected-develop-verification.yml@refs/heads/feature/x',
        checkpointId: 'CP-20261006-1',
      },
      'strict',
    ],
    [
      'the checkpoint dispatch without a checkpoint id',
      { requested: deferred, event: 'workflow_dispatch', workflowRef: CHECKPOINT_WORKFLOW_REF },
      'strict',
    ],
    [
      'the checkpoint dispatch with a malformed checkpoint id',
      {
        requested: deferred,
        event: 'workflow_dispatch',
        workflowRef: CHECKPOINT_WORKFLOW_REF,
        checkpointId: 'CP-2026-1',
      },
      'strict',
    ],
    [
      'no request at all, even on case a',
      { event: 'pull_request', baseRef: 'develop', workflowRef: PR_CI_REF },
      'strict',
    ],
    ['a local run', { requested: deferred }, 'strict'],
  ];
  it.each(rows)('%s', (_label, input, mode) => {
    expect(decideRunRecordMode(input).mode).toBe(mode);
  });

  it('reads no GITHUB_* variable unless a mode is requested', () => {
    const ambient = {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_REF: 'develop',
      GITHUB_WORKFLOW_REF: PR_CI_REF,
    };
    expect(resolveRecordsMode([], ambient).mode).toBe('strict');
    expect(resolveRecordsMode([], ambient).reason).toMatch(/no mode was requested/);
    expect(resolveRecordsMode(['--mode', deferred], ambient).mode).toBe('checkpoint-deferred');
    expect(resolveRecordsMode([], { ...ambient, ROOTLCO_RECORDS_MODE: deferred }).mode).toBe(
      'checkpoint-deferred'
    );
    expect(resolveRecordsMode(['--mode', 'strict'], ambient).mode).toBe('strict');
    expect(resolveRecordsMode(['--mode', 'lenient'], ambient).error).toBeTruthy();
  });

  it('the two records validators run STRICT under an ambient pull-request environment', () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_REF: 'develop',
      GITHUB_WORKFLOW_REF: PR_CI_REF,
    };
    delete env.ROOTLCO_RECORDS_MODE;
    delete env.GITHUB_STEP_SUMMARY;
    for (const gate of ['check-p1-27-closing-values.mjs', 'check-p1-27-doc-counts.mjs']) {
      const run = spawnSync(process.execPath, [join(ROOT, 'scripts/ci', gate), '--mode', 'bogus'], {
        cwd: ROOT,
        env,
        encoding: 'utf8',
      });
      expect(run.status, `${gate} accepted an unknown mode`).toBe(2);
      const plain = spawnSync(process.execPath, [join(ROOT, 'scripts/ci', gate)], {
        cwd: ROOT,
        env,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      expect(plain.stdout, `${gate} read the ambient environment`).toMatch(
        /^records mode: strict — no mode was requested/m
      );
    }
  });
});

/* ======================================================================== */

describe("main's path is the gate it was at bd6b9179", () => {
  it('declaredJobsFor(full) IS DECLARED_JOBS, and equals the bd6b9179 declaration', async () => {
    expect(declaredJobsFor('full')).toBe(DECLARED_JOBS);
    const old = await importAt<{ DECLARED_JOBS: Job[] }>(
      BASELINE,
      'scripts/ci/evaluate-ci-gate.mjs'
    );
    expect(DECLARED_JOBS).toEqual(old.DECLARED_JOBS);
    for (const job of DECLARED_JOBS as Job[]) {
      expect(acceptableResults(job)).toEqual(
        job.alwaysRequired || job.securityEligibility
          ? new Set(['success'])
          : new Set(['success', 'skipped'])
      );
    }
  });

  it('CATEGORY_RULES and classifyPath are byte-identical to bd6b9179', async () => {
    const segment = (source: string): string =>
      source.slice(
        source.indexOf('export const CATEGORY_RULES'),
        source.indexOf('/**\n * Full classification.')
      );
    const before = segment(git('show', `${BASELINE}:scripts/ci/classify-changes.mjs`));
    const now = segment(readRepo('scripts/ci/classify-changes.mjs'));
    expect(before.length).toBeGreaterThan(1000);
    expect(now).toBe(before);

    // And over the whole tree at bd6b9179 as a path corpus, by behaviour.
    const old = await importAt<{
      classifyPath: (p: string) => string;
      classify: (files: string[]) => { jobs: Record<string, Decision> };
    }>(BASELINE, 'scripts/ci/classify-changes.mjs', ['scripts/lib/repository-paths.mjs']);
    const corpus = git('ls-tree', '-r', '--name-only', BASELINE).split('\n').filter(Boolean);
    expect(corpus.length).toBeGreaterThan(1000);
    for (const path of corpus) expect(classifyPath(path), path).toBe(old.classifyPath(path));
    expect(CATEGORY_RULES.length).toBeGreaterThan(5);

    // classify() without an event is today's classification, job for job.
    const diffs = [
      ['docs/a.md'],
      ['apps/web/src/app/page.tsx'],
      ['supabase/migrations/1.sql'],
      ['.github/workflows/pr-ci.yml'],
      ['.github/ci-baselines/schema-baseline.json'],
      ['tests/ci/x.test.ts', 'docs/b.md'],
      ['middleware.ts'],
      [],
    ];
    for (const files of diffs) {
      expect(classify(files).jobs, JSON.stringify(files)).toEqual(old.classify(files).jobs);
      expect(classify(files, PR_MAIN).jobs, JSON.stringify(files)).toEqual(
        old.classify(files).jobs
      );
      expect((classify(files, PR_MAIN) as Classification).profile).toBe('full');
    }
  });

  it('every relaxing expression in pr-ci.yml reduces to the full value for a pull request into main', () => {
    const pr = readRepo('.github/workflows/pr-ci.yml');
    const jobs = new Map(topLevelJobs(pr).map((j) => [j.id, j]));
    const context = (baseRef: string, outputs: Record<string, string> = {}) => ({
      'github.event_name': 'pull_request',
      'github.event.pull_request.base.ref': baseRef,
      'github.event.pull_request.head.repo.full_name': 'Ezzaldeen-Albitar/RootLco',
      'github.repository': 'Ezzaldeen-Albitar/RootLco',
      ...Object.fromEntries(
        Object.entries(outputs).map(([k, v]) => [`needs.change-detection.outputs.${k}`, v])
      ),
    });
    // Outputs that would relax everything, were the base ever consulted wrongly.
    const relaxing = {
      'clean-room-profile': 'development',
      'run-database-block': 'false',
      'run-container-block': 'false',
      'records-mode': 'checkpoint-deferred',
      'run-web-quality': 'false',
      'run-authenticated-browser': 'false',
    };
    const input = (job: string, key: string): string => {
      const line = new RegExp(`^ {6}${key}:\\s*(.+)$`, 'm').exec(jobs.get(job)?.body ?? '')?.[1];
      expect(line, `${job}.${key}`).toBeDefined();
      return unwrap(line as string);
    };
    const condition = (job: string): string => {
      const body = jobs.get(job)?.body ?? '';
      const folded = /^ {4}if: >-\n((?: {6}.+\n)+)/m.exec(body)?.[1];
      const inline = /^ {4}if:\s*(?!>-)(.+)$/m.exec(body)?.[1];
      const text = folded ? folded.replace(/\s*\n\s*/g, ' ') : inline;
      expect(text, `${job} has no if:`).toBeDefined();
      return unwrap(text as string);
    };

    const main = context('main', relaxing);
    expect(evaluateExpression(input('hosted-clean-room', 'profile'), main)).toBe('full');
    expect(evaluateExpression(input('hosted-clean-room', 'run-database-block'), main)).toBe('true');
    expect(evaluateExpression(input('hosted-clean-room', 'run-container-block'), main)).toBe(
      'true'
    );
    expect(evaluateExpression(input('hosted-clean-room', 'records-mode'), main)).toBe('strict');
    expect(evaluateExpression(condition('web-quality'), main)).toBe(true);
    expect(evaluateExpression(condition('authenticated-browser'), main)).toBe(true);
    const name = unwrap(jobs.get('ci-gate')?.name ?? '');
    expect(evaluateExpression(name, main)).toBe('ci-gate');

    // And for develop the same expressions DO consult change detection.
    const dev = context('develop', relaxing);
    expect(evaluateExpression(input('hosted-clean-room', 'profile'), dev)).toBe('development');
    expect(evaluateExpression(input('hosted-clean-room', 'records-mode'), dev)).toBe(
      'checkpoint-deferred'
    );
    expect(evaluateExpression(condition('web-quality'), dev)).toBe(false);
    expect(evaluateExpression(condition('authenticated-browser'), dev)).toBe(false);
    expect(evaluateExpression(name, dev)).toBe('ci-gate (development)');
    // A missing output never relaxes: it falls back to the full value.
    const empty = context('develop');
    expect(evaluateExpression(input('hosted-clean-room', 'profile'), empty)).toBe('full');
    expect(evaluateExpression(input('hosted-clean-room', 'records-mode'), empty)).toBe('strict');
    expect(evaluateExpression(input('hosted-clean-room', 'run-database-block'), empty)).toBe(
      'true'
    );
    // A fork into main is still refused privileged execution, as before.
    expect(
      evaluateExpression(condition('authenticated-browser'), {
        ...main,
        'github.event.pull_request.head.repo.full_name': 'someone/fork',
      })
    ).toBe(false);
  });

  it('pr-ci.yml no longer offers workflow_dispatch, and cancels superseded runs per pull request', () => {
    const pr = readRepo('.github/workflows/pr-ci.yml');
    const on = pr.slice(pr.indexOf('\non:'), pr.indexOf('\nconcurrency:'));
    expect(on).not.toMatch(/workflow_dispatch/);
    expect(on).toMatch(/pull_request:\n\s+branches: \[develop, main\]/);
    // Planner decision 9: keyed on the pull-request number, cancel-in-progress,
    // and identical for a pull request into main to what it was at bd6b9179.
    const concurrency = (source: string) =>
      /\nconcurrency:\n {2}group: (.+)\n {2}cancel-in-progress: (.+)\n/.exec(source)?.slice(1);
    expect(concurrency(pr)).toEqual([
      'pr-ci-${{ github.event.pull_request.number || github.ref }}',
      'true',
    ]);
    expect(concurrency(pr)).toEqual(
      concurrency(git('show', `${BASELINE}:.github/workflows/pr-ci.yml`))
    );
  });

  it('the full clean room is a superset of bd6b9179, step for step, including every if:', () => {
    const steps = (source: string) => stepsOf(topLevelJobs(source)[0]?.body ?? '');
    const before = steps(git('show', `${BASELINE}:.github/workflows/_reusable-clean-room.yml`));
    const now = steps(readRepo('.github/workflows/_reusable-clean-room.yml'));
    expect(before.length).toBeGreaterThan(15);
    const full = {
      'inputs.profile': 'full',
      'inputs.run-database-block': 'false',
      'inputs.run-container-block': 'false',
      'inputs.expected-sha': 'x',
    };
    for (const step of before) {
      const match = now.find((s) => s.name === step.name);
      expect(match, `the clean room lost the step "${step.name}"`).toBeDefined();
      expect(match?.run, `the step "${step.name}" now runs something else`).toBe(step.run);
      if (step.if === null) {
        // A step that always ran must still run under the full profile —
        // whatever the block inputs say.
        if (match?.if) {
          expect(evaluateExpression(unwrap(match.if), full), step.name).toBe(true);
        }
      } else {
        expect(match?.if, `the step "${step.name}" changed its condition`).toBe(step.if);
      }
    }
    const added = now.filter((s) => !before.some((b) => b.name === s.name));
    const runsUnderFull = added.filter(
      (s) => s.if === null || evaluateExpression(unwrap(s.if), full) === true
    );
    expect(runsUnderFull.map((s) => s.name).sort()).toEqual([
      'Domain classification validators',
      'The clean-room profile is one this workflow knows',
    ]);
    expect(runsUnderFull.find((s) => s.name === 'Domain classification validators')?.run).toBe(
      'npm run verify:classifications'
    );
    // The only development-only step does not run under the full profile.
    const devOnly = added.filter((s) => !runsUnderFull.includes(s));
    expect(devOnly.map((s) => s.name)).toEqual(['The development-profile aggregate leaves']);
  });

  it('ci.yml runs on pull requests into main and pushes to main only, with its jobs unchanged', () => {
    const ci = readRepo('.github/workflows/ci.yml');
    const on = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(on).toMatch(/pull_request:\n\s+branches: \[main\]/);
    expect(on).toMatch(/push:\n\s+branches: \[main\]/);
    expect(on).not.toMatch(/workflow_dispatch|schedule|develop/);
    const names = (source: string) => topLevelJobs(source).map((j) => [j.id, j.name]);
    expect(names(ci)).toEqual(names(git('show', `${BASELINE}:.github/workflows/ci.yml`)));
    const body = (source: string) => source.slice(source.indexOf('\njobs:'));
    expect(body(ci)).toBe(body(git('show', `${BASELINE}:.github/workflows/ci.yml`)));
  });

  it('protected verification keeps push to main, and pins every non-main dispatch', () => {
    const source = readRepo('.github/workflows/protected-develop-verification.yml');
    const on = source.slice(source.indexOf('\non:'), source.indexOf('\nconcurrency:'));
    expect(on).toMatch(/push:\n\s+branches: \[main\]/);
    expect(on).toMatch(/checkpoint-id:/);
    expect(source).toContain(
      "require-pin: ${{ github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main' }}"
    );
    expect(source).toContain(
      'group: protected-${{ github.workflow }}-${{ inputs.candidate-sha || github.ref }}'
    );
    expect(source).toContain('cancel-in-progress: false');
    const gate = topLevelJobs(source).find((j) => j.id === 'protected-gate');
    const first = stepsOf(gate?.body ?? '')[0];
    expect(first?.name).toBe('A dispatch is pinned to the commit it names');
    expect(first?.run).toMatch(/"\$\{CANDIDATE_SHA\}" != "\$\{RUN_SHA\}"/);
    // The records request is deferred ONLY on the dispatch path.
    const room = topLevelJobs(source).find((j) => j.id === 'hosted-clean-room')?.body ?? '';
    const records = unwrap(/records-mode:\s*(.+)$/m.exec(room)?.[1] ?? '');
    expect(evaluateExpression(records, { 'github.event_name': 'push' })).toBe('strict');
    expect(evaluateExpression(records, { 'github.event_name': 'workflow_dispatch' })).toBe(
      'checkpoint-deferred'
    );
    expect(room).toMatch(/profile: full\n/);
  });
});

/* ======================================================================== */

describe('the development profile never lets a change skip what it needs', () => {
  const dev = (files: string[]) => classify(files, PR_DEVELOP) as Classification;
  const all = [...ALWAYS_REQUIRED, ...DEVELOPMENT_CONDITIONAL_JOBS].sort();

  it('escalates every classifier, gate, workflow, dependency and build-configuration change', () => {
    for (const path of [
      '.github/workflows/pr-ci.yml',
      '.github/workflows/_reusable-clean-room.yml',
      '.github/actions/setup-project/action.yml',
      'scripts/ci/classify-changes.mjs',
      'scripts/ci/evaluate-ci-gate.mjs',
      'scripts/lib/development-profile.mjs',
      'tests/ci/ci-gate.test.ts',
      'package.json',
      'package-lock.json',
      'apps/web/package.json',
      'apps/api/package.json',
      'tsconfig.json',
      'apps/web/next.config.ts',
      'vitest.config.ts',
      'apps/web/playwright.config.ts',
      'Dockerfile',
      'docker-compose.yml',
      'supabase/config.toml',
      '.github/ci-baselines/idempotency-exceptions.json',
      '.github/CODEOWNERS-new',
      'some-root-file.cfg',
    ]) {
      const c = dev([path]);
      expect(c.escalated, path).toBe(true);
      expect(required(c), path).toEqual(all);
      expect(c.cleanRoomProfile, path).toBe('full');
    }
    expect(dev([]).escalated, 'an empty diff').toBe(true);
    expect(isEscalationPath('scripts/ci/anything-new.mjs')).toBe(true);
    expect(ESCALATION_PATHS).toContain('scripts/lib/**');
  });

  it('keeps the stricter of the head and base answers, so a head cannot unclassify itself', () => {
    // A head copy whose trigger for authenticated-browser was deleted…
    const weakened = dev(['apps/web/src/features/billing/a.tsx']);
    weakened.jobs['authenticated-browser'] = { required: false, reason: 'tampered' };
    const base = dev(['apps/web/src/features/billing/a.tsx']);
    const kept = keepStricter(weakened, base) as Classification;
    expect(kept.jobs['authenticated-browser']?.required).toBe(true);
    // …and a base copy that cannot be compared resolves to everything.
    const unavailable = keepStricter(dev(['docs/a.md']), null, {
      baseAvailable: false,
      baseNote: 'no base copy',
    }) as Classification;
    expect(required(unavailable)).toEqual(all);
    expect(unavailable.cleanRoomProfile).toBe('full');
    expect(unavailable.escalated).toBe(true);
    // …and judges the run records STRICT: a head that cannot be compared must
    // not defer its own record drift, even when its own answer says to.
    expect(unavailable.recordsMode).toBe('strict');
    const tamperedHead = dev(['docs/phase-1/phase-1-27/evidence/local-run-ledger.json']);
    tamperedHead.recordsMode = 'checkpoint-deferred';
    for (const kept2 of [
      keepStricter(tamperedHead, null, { baseAvailable: false }),
      keepStricter(tamperedHead, { jobs: {} }),
    ] as Classification[]) {
      expect(kept2.recordsMode).toBe('strict');
      expect((kept2 as Classification & { recordsOnly?: boolean }).recordsOnly).toBe(false);
    }
    // A base that predates the policy is not comparable either.
    const legacy = keepStricter(dev(['docs/a.md']), { jobs: {} }) as Classification;
    expect(required(legacy)).toEqual(all);
  });

  it('runs the database jobs, the serial block and the browser tier for a migration', () => {
    const c = dev(['supabase/migrations/20261006000000_x.sql']);
    for (const job of [
      'database-migration-replay',
      'database-security',
      'integration-tests',
      'authenticated-browser',
      'web-quality',
    ]) {
      expect(c.jobs[job]?.required, job).toBe(true);
    }
    expect(c.runDatabaseBlock).toBe(true);
    expect(dev(['supabase/seed.sql']).jobs['web-quality']?.required).toBe(true);
    expect(dev(['tests/backend/x.test.ts']).runDatabaseBlock).toBe(true);
    expect(dev(['apps/api/src/modules/crm/data/x.ts']).runDatabaseBlock).toBe(true);
  });

  it('runs the API jobs, both web jobs, for any API source change', () => {
    const c = dev(['apps/api/src/modules/billing/application/x.ts']);
    for (const job of [
      'integration-tests',
      'database-security',
      'code-security',
      'web-quality',
      'authenticated-browser',
    ]) {
      expect(c.jobs[job]?.required, job).toBe(true);
    }
  });

  it('exempts only styles and translations from the browser tier — pinned', () => {
    expect([...AUTHENTICATED_BROWSER_ALLOW_LIST]).toEqual([
      '**/*.scss',
      '**/*.css',
      'apps/web/src/i18n/messages/**',
    ]);
    expect(dev(['apps/web/src/styles/tokens.scss']).jobs['authenticated-browser']?.required).toBe(
      false
    );
    expect(
      dev(['apps/web/src/i18n/messages/en.json']).jobs['authenticated-browser']?.required
    ).toBe(false);
    expect(dev(['apps/web/src/styles/tokens.scss']).jobs['web-quality']?.required).toBe(true);
    expect(dev(['apps/web/src/config/navigation.ts']).jobs['authenticated-browser']?.required).toBe(
      true
    );
  });

  it('routes each ci-baseline to the job that consumes it', () => {
    const route = (name: string) => required(dev([`.github/ci-baselines/${name}`]));
    expect(route('schema-baseline.json')).toEqual(
      expect.arrayContaining(['database-migration-replay', 'database-security', 'web-quality'])
    );
    expect(dev(['.github/ci-baselines/schema-baseline.json']).runDatabaseBlock).toBe(true);
    expect(route('container-baseline.json')).toContain('container-security');
    expect(route('build-size-baseline.json')).toContain('application-build');
    expect(route('codeql-baseline.json')).toContain('code-security');
    expect(route('coverage-baseline.backend.json')).toContain('integration-tests');
    for (const name of readdirSync(join(ROOT, '.github/ci-baselines'))) {
      const c = dev([`.github/ci-baselines/${name}`]);
      // Mapped or escalated — never silently ignored.
      expect(c.escalated || c.jobs['web-quality']?.required, name).toBe(true);
    }
  });

  it('runs only the always-run set for documentation no test reads', () => {
    const c = dev(['docs/user-manual/chapter.md']);
    expect(required(c)).toEqual([...ALWAYS_REQUIRED].sort());
    expect(c.cleanRoomProfile).toBe('development');
    expect(c.recordsMode).toBe('checkpoint-deferred');
  });

  it('judges a records pull request STRICT', () => {
    const c = dev(['docs/phase-1/phase-1-27/evidence/local-run-ledger.json']);
    expect(c.recordsMode).toBe('strict');
    expect(c.jobs['web-quality']?.required).toBe(true);
  });

  it('maps every money glob to a path that exists', () => {
    for (const glob of [...MONEY_API_GLOBS, ...MONEY_WEB_GLOBS]) {
      expect(
        tracked.some((p) => matchesAny(p, [glob])),
        `${glob} matches no tracked file`
      ).toBe(true);
    }
  });

  it('maps every authenticated spec to a trigger, and every mapped glob triggers the browser tier', () => {
    const specs = readdirSync(join(ROOT, 'apps/web/tests/e2e/authenticated')).filter(
      (n) => n.endsWith('.spec.ts') || n === 'auth.setup.ts'
    );
    expect(specs.length).toBeGreaterThan(10);
    expect(Object.keys(AUTH_E2E_SPEC_MAP).sort()).toEqual([...specs].sort());
    const globs = [...AUTH_E2E_BASE, ...Object.values(AUTH_E2E_SPEC_MAP).flat()];
    for (const glob of globs) {
      const hit = tracked.find(
        (p) => matchesAny(p, [glob]) && !/\.(s?css)$/.test(p) && !p.includes('/i18n/messages/')
      );
      expect(hit, `${glob} matches no tracked file`).toBeDefined();
      expect(dev([hit as string]).jobs['authenticated-browser']?.required, `${glob}: ${hit}`).toBe(
        true
      );
    }
  });

  it('covers every repository-root read the web tier makes', () => {
    /*
     * The web tier reads files OUTSIDE apps/web (migrations, the operation
     * register, phase evidence, gate scripts). A change to one of those must
     * run web-quality, or the web tier's verdict on it is skipped. This scans
     * the web tests and server modules for root reads and requires each to be a
     * web-quality trigger or an escalation path.
     */
    const files = tracked.filter(
      (p) =>
        (p.startsWith('apps/web/tests/') && /\.(ts|tsx)$/.test(p)) ||
        (p.startsWith('apps/web/src/') && /\.server\.ts$/.test(p))
    );
    expect(files.length).toBeGreaterThan(50);
    const ROOT_NAMES = new Set([
      'REPO',
      'REPO_ROOT',
      'REPOSITORY_ROOT',
      'repositoryRoot',
      'repoRoot',
    ]);
    const reads = new Map<string, string>();
    for (const file of files) {
      const source = readRepo(file);
      // `join(REPO, 'supabase', 'migrations')`, `join(process.cwd(), '..', '..', 'docs')`:
      // a call rooted at the repository, by name or by climbing out of apps/web.
      for (const call of source.matchAll(/(?:join|resolve)\(((?:[^()]|\([^()]*\))*)\)/g)) {
        const args: string[] = [];
        let depth = 0;
        let current = '';
        for (const ch of call[1] ?? '') {
          if (ch === '(') depth += 1;
          if (ch === ')') depth -= 1;
          if (ch === ',' && depth === 0) {
            args.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        args.push(current.trim());
        const literal = (a: string) => /^'([^']*)'$/.exec(a)?.[1];
        const rest = args.slice(1);
        let climbs = 0;
        while (literal(rest[climbs] ?? '') === '..') climbs += 1;
        const rooted = ROOT_NAMES.has(args[0] ?? '') || climbs >= 2;
        if (!rooted) continue;
        const segments: string[] = [];
        for (const a of rest.slice(climbs)) {
          const value = literal(a);
          if (value === undefined) break;
          segments.push(value);
        }
        if (segments.length === 0) continue;
        reads.set(segments.join('/'), file);
      }
      // `'docs/phase-1/…'` written as one literal.
      for (const m of source.matchAll(
        /['`]((?:supabase|docs|scripts|\.github|apps\/api)\/[^'`\s$]+)['`]/g
      )) {
        reads.set(m[1] ?? '', file);
      }
    }
    const uncovered: string[] = [];
    for (const [path, file] of reads) {
      if (path.startsWith('apps/web')) continue;
      if (path.startsWith('apps/') && !path.startsWith('apps/api')) continue;
      if (path === 'apps') continue;
      if (path.startsWith('node_modules') || path.startsWith('.local')) continue;
      // A glob quoted in prose is not a read.
      if (path.includes('*')) continue;
      const isDirectory = !path.split('/').pop()?.includes('.');
      const probe = isDirectory ? `${path}/x` : path;
      // A directory used as a base (`join(REPO, 'apps', 'api')`, then a subpath
      // in a later call) is covered when a trigger lies under it; the full
      // subpath is checked where it is written.
      const baseOfTrigger =
        isDirectory && WEB_QUALITY_TRIGGERS.some((glob) => glob.startsWith(`${path}/`));
      if (!matchesAny(probe, WEB_QUALITY_TRIGGERS) && !isEscalationPath(probe) && !baseOfTrigger) {
        uncovered.push(`${path} (read by ${file})`);
      }
    }
    expect(reads.size, 'the scan found no root read at all').toBeGreaterThan(10);
    expect(uncovered, uncovered.join('\n')).toEqual([]);
  });

  it('runs the job that exercises every repository script a database, backend or browser run reaches', () => {
    /*
     * The suites that need a database read repository scripts: tests/backend
     * imports the platform operator scripts and the tenant backfills, tests/db
     * spawns the classification guards, and the authenticated-browser job runs
     * the owner-acceptance setup, which imports the development configuration.
     * A change to one of those scripts must run the job that exercises it, or
     * the only test of it is deferred to the checkpoint. This derives the
     * scripts each job reaches — imports, spawned paths and npm entry points,
     * transitively — and requires the development profile to run that job.
     */
    const dbEntries = tracked.filter(
      (p) =>
        ((p.startsWith('tests/backend/') || p.startsWith('tests/db/')) &&
          /\.(ts|mts|mjs)$/.test(p)) ||
        /^vitest\.config\.(backend|db|db-fixture)\.ts$/.test(p)
    );
    const browserWorkflow = readRepo('.github/workflows/_reusable-authenticated-browser.yml');
    const browserEntries = [
      ...tracked.filter((p) => p.startsWith('apps/web/tests/e2e/') && /\.(ts|mts|mjs)$/.test(p)),
      ...npmEntryScripts(browserWorkflow),
      ...[...browserWorkflow.matchAll(/(?:\.\/)?(scripts\/[\w./-]+\.(?:mjs|cjs|js))/g)].map(
        (m) => m[1] as string
      ),
    ];
    const dbScripts = scriptClosure(dbEntries);
    const browserScripts = scriptClosure(browserEntries);

    // The derivation must find what the defect it exists for was about.
    for (const known of [
      'scripts/platform/genesis-platform-operator.mjs',
      'scripts/platform/backfill-tenant-administrator-bundle.mjs',
      'scripts/dev/owner-acceptance/export-fixture-setup.mjs',
    ]) {
      expect(dbScripts.has(known), `${known} is reached by the database suites`).toBe(true);
    }
    for (const known of [
      'scripts/dev/owner-acceptance/create-owner-account.mjs',
      'scripts/dev/dev-config.mjs',
    ]) {
      expect(browserScripts.has(known), `${known} is reached by the browser job`).toBe(true);
    }

    const uncovered: string[] = [];
    for (const [script, via] of dbScripts) {
      if (dev([script]).runDatabaseBlock !== true) {
        uncovered.push(`${script} (reached from ${via}) does not run the serial database block`);
      }
    }
    for (const [script, via] of browserScripts) {
      if (dev([script]).jobs['authenticated-browser']?.required !== true) {
        uncovered.push(`${script} (reached from ${via}) does not run authenticated-browser`);
      }
    }
    expect(uncovered, uncovered.join('\n')).toEqual([]);

    // The probe from the review: a platform permission script into develop.
    const probe = dev(['scripts/platform/grant-platform-authority.mjs']);
    expect(probe.runDatabaseBlock).toBe(true);
    expect(probe.jobs['authenticated-browser']?.required).toBe(true);
  });

  it('runs each conditional job when a repository script its own workflow runs changes', () => {
    /*
     * The derivation above starts from the suites. This one starts from the
     * JOBS: for every conditional job it reads the reusable workflow pr-ci.yml
     * calls, keeps the steps that job's `task` input selects, and derives the
     * repository scripts those steps reach — npm entry points and literal
     * `scripts/...` paths, transitively. A non-escalation script reached that
     * way must make that job required under the development profile, or a pull
     * request into develop that edits it never runs it before the checkpoint
     * (TDP-2026-10 fix round 2: the P1-23 and P1-24 mutation matrices run only
     * in integration-tests).
     */
    // Every exemption from the closure is proven to be the data entry it names.
    for (const { script, namedBy, proof } of NAMED_AS_DATA) {
      expect(proof(), `${namedBy} names ${script} only as data`).toBe(true);
    }
    const callers = topLevelJobs(readRepo('.github/workflows/pr-ci.yml'));
    const reachedBy = new Map<string, Map<string, string>>();
    const uncovered: string[] = [];
    for (const job of DEVELOPMENT_CONDITIONAL_JOBS) {
      const caller = callers.find((candidate) => candidate.id === job);
      expect(caller, `${job} is a job of pr-ci.yml`).toBeDefined();
      const body = caller?.body ?? '';
      const uses = /^ {4}uses:\s*\.\/(\.github\/workflows\/[\w.-]+\.yml)\s*$/m.exec(body)?.[1];
      expect(uses, `${job} calls a reusable workflow`).toBeDefined();
      const task = /^ {6}task:\s*([\w-]+)\s*$/m.exec(body)?.[1] ?? null;
      const text = stepsSelectedBy(readRepo(uses as string), task);
      const entries = [
        ...npmEntryScripts(text),
        ...[...text.matchAll(/(?:\.\/)?(scripts\/[\w./-]+\.(?:mjs|cjs|js))/g)].map(
          (m) => m[1] as string
        ),
      ];
      const reached = scriptClosure(entries);
      reachedBy.set(job, reached);
      for (const [script, via] of reached) {
        if (isEscalationPath(script)) continue;
        if (dev([script]).jobs[job]?.required !== true) {
          uncovered.push(`${script} (reached from ${via}) does not run ${job}`);
        }
      }
    }

    // The derivation must find what the defect it exists for was about.
    for (const known of [
      'scripts/p1-23-mutation-matrix.mjs',
      'scripts/p1-24-mutation-matrix.mjs',
    ]) {
      expect(reachedBy.get('integration-tests')?.has(known), `${known} is reached`).toBe(true);
    }
    expect(uncovered, uncovered.join('\n')).toEqual([]);

    // The probe from the review: a permissions validator alone, into develop.
    for (const matrix of [
      'scripts/p1-23-mutation-matrix.mjs',
      'scripts/p1-24-mutation-matrix.mjs',
    ]) {
      expect(dev([matrix]).jobs['integration-tests']?.required, matrix).toBe(true);
    }
  });
});

/**
 * The text of the steps a reusable workflow runs for one `task` input: every
 * step of every job, minus a step whose `if:` keys on `inputs.task` without
 * naming this task. Comment lines are dropped, so a command named only in a
 * comment is not a reference. With no task, every step is kept.
 */
function stepsSelectedBy(workflow: string, task: string | null): string {
  const kept: string[] = [];
  for (const job of topLevelJobs(workflow)) {
    for (const chunk of job.body.split(/\n(?= {6}- )/)) {
      const condition = /^ {8}if:\s*(.+?)\s*$/m.exec(chunk)?.[1] ?? '';
      if (
        task !== null &&
        condition.includes('inputs.task') &&
        !condition.includes(`inputs.task == '${task}'`)
      ) {
        continue;
      }
      kept.push(
        chunk
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('#'))
          .join('\n')
      );
    }
  }
  return kept.join('\n');
}

/**
 * The `node <script>` targets of every `npm run <name>` a workflow invokes,
 * following one `npm run` inside a package script to the next.
 */
function npmEntryScripts(workflow: string): string[] {
  const scripts = (JSON.parse(readRepo('package.json')) as { scripts: Record<string, string> })
    .scripts;
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [...workflow.matchAll(/npm run (?:--silent )?([\w:.-]+)/g)].map(
    (m) => m[1] as string
  );
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const command = scripts[name];
    if (command === undefined) continue;
    for (const m of command.matchAll(/\bnode (scripts\/[\w./-]+\.(?:mjs|cjs|js))/g)) {
      out.push(m[1] as string);
    }
    for (const m of command.matchAll(/npm run (?:--silent )?([\w:.-]+)/g)) {
      queue.push(m[1] as string);
    }
  }
  return out;
}

/**
 * The closure below follows a string literal that IS a scripts path, because a
 * spawned CLI is named that way. Two files name scripts as DATA and run none of
 * them: the history scanner, as the `file:` of an allowed historical finding,
 * and this policy's own trigger table. Each pair is pinned here with a proof
 * that the naming file holds that path exactly once, as that data entry; the
 * job derivation test asserts every proof, so an exemption cannot outlive its entry
 * or hide a real spawn. Only the pinned pair is not followed — any other
 * reference to the same script still is.
 */
const NAMED_AS_DATA: ReadonlyArray<{ script: string; namedBy: string; proof: () => boolean }> = [
  ...['scripts/check-tracked-secrets.mjs', 'scripts/dev/owner-acceptance/context.mjs'].map(
    (script) => ({
      script,
      namedBy: 'scripts/ci/scan-history.mjs',
      proof: () => {
        const source = readRepo('scripts/ci/scan-history.mjs');
        return source.split(`'${script}'`).length === 2 && source.includes(`file: '${script}',`);
      },
    })
  ),
  ...INTEGRATION_TESTS_TRIGGERS.map((script) => ({
    script,
    namedBy: 'scripts/lib/development-profile.mjs',
    proof: () => readRepo('scripts/lib/development-profile.mjs').split(`'${script}'`).length === 2,
  })),
];

/**
 * Every tracked `scripts/**` file reachable from `entries`, mapped to the
 * entry it was first reached from. Followed: static and dynamic imports and
 * `require` with a relative specifier, `join`/`resolve` calls whose literal
 * segments spell a `scripts/` path, and a string literal that IS a `scripts/`
 * path (a spawned CLI). Parsed as TypeScript, so a path in a comment is not a
 * reference. Only files under `tests/` and `scripts/` are followed onward.
 */
function scriptClosure(entries: string[]): Map<string, string> {
  const trackedSet = new Set(tracked);
  const found = new Map<string, string>();
  const visited = new Set<string>();
  const queue = entries.map((entry) => ({ file: entry, via: entry }));
  const normalise = (path: string): string => {
    const parts: string[] = [];
    for (const part of path.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.' && part !== '') parts.push(part);
    }
    return parts.join('/');
  };
  const asScriptPath = (text: string): string | undefined => {
    const m = /^(?:\.{1,2}\/)*(scripts\/[\w./-]+\.(?:mjs|cjs|js|ts))$/.exec(text);
    return m ? normalise(m[1] as string) : undefined;
  };
  while (queue.length > 0) {
    const { file, via } = queue.shift() as { file: string; via: string };
    if (visited.has(file) || !trackedSet.has(file)) continue;
    visited.add(file);
    if (file.startsWith('scripts/') && !found.has(file)) found.set(file, via);
    if (!file.startsWith('scripts/') && !file.startsWith('tests/') && file !== via) continue;
    const references: string[] = [];
    const sourceFile = ts.createSourceFile(
      file,
      readRepo(file),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.ts') || file.endsWith('.mts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
    );
    const relative = (specifier: string) => {
      if (specifier.startsWith('.'))
        references.push(normalise(`${posix.dirname(file)}/${specifier}`));
    };
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        relative(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const first = node.arguments[0];
        const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
        if ((isImport || isRequire) && first && ts.isStringLiteralLike(first)) {
          relative(first.text);
        }
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : '';
        if (name === 'join' || name === 'resolve') {
          const segments = node.arguments
            .filter((a): a is ts.StringLiteral => ts.isStringLiteralLike(a))
            .map((a) => a.text)
            .filter((s) => s !== '..' && s !== '.');
          const at = segments.indexOf('scripts');
          if (at !== -1) {
            const joined = asScriptPath(segments.slice(at).join('/'));
            if (joined) references.push(joined);
          }
        }
      } else if (ts.isStringLiteralLike(node)) {
        const path = asScriptPath(node.text);
        if (path) references.push(path);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    for (const reference of references) {
      for (const candidate of [reference, `${reference}.ts`, `${reference}.mjs`]) {
        if (NAMED_AS_DATA.some((d) => d.script === candidate && d.namedBy === file)) break;
        if (trackedSet.has(candidate)) {
          queue.push({ file: candidate, via });
          break;
        }
      }
    }
  }
  return found;
}

/* ======================================================================== */

describe('the gate under each profile — evaluator fixtures (a) to (i)', () => {
  const needs = (overrides: Record<string, string> = {}) =>
    Object.fromEntries(
      (DECLARED_JOBS as Job[]).map((j) => [j.id, { result: overrides[j.id] ?? 'success' }])
    );
  const fullRoom = {
    'clean-room-profile': {
      profile: 'full',
      recordsMode: 'strict',
      runDatabaseBlock: true,
      runContainerBlock: true,
    },
  };
  const both = (files: string[]) =>
    keepStricter(classify(files, PR_DEVELOP), classify(files, PR_DEVELOP)) as Classification;
  const devRoom = (c: Classification) => ({
    'clean-room-profile': {
      profile: c.cleanRoomProfile,
      recordsMode: c.recordsMode,
      runDatabaseBlock: c.runDatabaseBlock,
      runContainerBlock: c.runContainerBlock,
    },
  });
  const skippedUnlessRequired = (c: Classification) =>
    needs(
      Object.fromEntries(
        Object.entries(c.jobs)
          .filter(([, d]) => !d.required)
          .map(([id]) => [id, 'skipped'])
      )
    );

  it('(a) base main, every job succeeded: Go, full profile, check run ci-gate', () => {
    const r = evaluate(
      needs(),
      classify(['docs/a.md'], PR_MAIN),
      {},
      {
        trustedContext: true,
        ...PR_MAIN,
        evidence: fullRoom,
      }
    );
    expect(r.decision).toBe('Go');
    expect(r.profile).toBe('full');
    expect(r.checkRunName).toBe('ci-gate');
  });

  it('(b) base main, web-quality skipped even with a classification saying it is not required: No-Go', () => {
    const c = classify(['docs/a.md'], PR_MAIN) as Classification;
    c.jobs['web-quality'] = { required: false, reason: 'claimed' };
    const r = evaluate(
      needs({ 'web-quality': 'skipped' }),
      c,
      {},
      {
        trustedContext: true,
        ...PR_MAIN,
        evidence: fullRoom,
      }
    );
    expect(r.decision).toBe('No-Go');
  });

  it('(c) base main with a development clean-room record: No-Go', () => {
    const r = evaluate(
      needs(),
      classify(['docs/a.md'], PR_MAIN),
      {},
      {
        trustedContext: true,
        ...PR_MAIN,
        evidence: { 'clean-room-profile': { profile: 'development', recordsMode: 'strict' } },
      }
    );
    expect(r.decision).toBe('No-Go');
    const deferredOnMain = evaluate(
      needs(),
      classify(['docs/a.md'], PR_MAIN),
      {},
      {
        trustedContext: true,
        ...PR_MAIN,
        evidence: { 'clean-room-profile': { profile: 'full', recordsMode: 'checkpoint-deferred' } },
      }
    );
    expect(deferredOnMain.decision).toBe('No-Go');
    const silent = evaluate(
      needs(),
      classify(['docs/a.md'], PR_MAIN),
      {},
      {
        trustedContext: true,
        ...PR_MAIN,
        evidence: {},
      }
    );
    expect(silent.decision, 'a clean room that recorded no profile').toBe('No-Go');
  });

  it('(d) a missing event or base is the full profile', () => {
    for (const context of [{}, { event: 'pull_request' }, { baseRef: 'develop' }]) {
      const r = evaluate(
        needs(),
        classify(['docs/a.md']),
        {},
        { trustedContext: true, ...context }
      );
      expect(r.profile).toBe('full');
      expect(r.checkRunName).toBe(DEVELOPMENT_GATE_NAME);
      // A development classification cannot justify anything under full.
      const devClass = both(['docs/a.md']);
      const rr = evaluate(
        skippedUnlessRequired(devClass),
        devClass,
        {},
        {
          trustedContext: true,
          ...context,
        }
      );
      expect(rr.decision).toBe('No-Go');
    }
  });

  it('(e) base develop with a missing or mismatched base/head record: No-Go', () => {
    const c = both(['docs/a.md']);
    const missingBase = JSON.parse(JSON.stringify(c)) as Classification & {
      decisions?: { base?: unknown };
    };
    delete missingBase.decisions?.base;
    expect(
      evaluate(
        skippedUnlessRequired(c),
        missingBase,
        {},
        {
          trustedContext: true,
          ...PR_DEVELOP,
          evidence: devRoom(c),
        }
      ).decision
    ).toBe('No-Go');
    const mismatched = JSON.parse(JSON.stringify(c)) as Classification & {
      decisions: { base: { jobs: Record<string, boolean> } };
    };
    mismatched.decisions.base.jobs['web-quality'] = true;
    expect(
      evaluate(
        skippedUnlessRequired(c),
        mismatched,
        {},
        {
          trustedContext: true,
          ...PR_DEVELOP,
          evidence: devRoom(c),
        }
      ).decision
    ).toBe('No-Go');
    const noClassification = evaluate(
      needs(),
      null,
      {},
      {
        trustedContext: true,
        ...PR_DEVELOP,
        evidence: fullRoom,
      }
    );
    expect(noClassification.decision).toBe('No-Go');
    // A base copy that could not be compared: STRICT records is Go, a head
    // that deferred its own records anyway is No-Go.
    const unavailable = keepStricter(classify(['docs/a.md'], PR_DEVELOP), null, {
      baseAvailable: false,
    }) as Classification;
    const context = { trustedContext: true, ...PR_DEVELOP, evidence: fullRoom };
    expect(evaluate(needs(), unavailable, {}, context).decision).toBe('Go');
    expect(
      evaluate(needs(), { ...unavailable, recordsMode: 'checkpoint-deferred' }, {}, context)
        .decision
    ).toBe('No-Go');
  });

  it('(f) base develop, browser tier skipped, trusted, both copies not required: Go with EXPECTED_SKIP', () => {
    const c = both(['docs/user-manual/a.md']);
    const r = evaluate(
      skippedUnlessRequired(c),
      c,
      {},
      {
        trustedContext: true,
        ...PR_DEVELOP,
        evidence: devRoom(c),
      }
    );
    expect(r.decision).toBe('Go');
    expect(r.checkRunName).toBe('ci-gate (development)');
    expect(r.jobs.find((j: { id: string }) => j.id === 'authenticated-browser')?.state).toBe(
      STATE.EXPECTED_SKIP
    );
    expect(r.policy?.reviewDate).toBe(TDP_REVIEW_DATE);
  });

  it('(g) base develop, a fork whose change requires the browser tier: No-Go', () => {
    const c = both(['apps/web/src/features/crm/a.tsx']);
    const r = evaluate(
      needs({ 'authenticated-browser': 'skipped' }),
      c,
      {},
      {
        trustedContext: false,
        ...PR_DEVELOP,
        evidence: devRoom(c),
      }
    );
    expect(r.decision).toBe('No-Go');
    expect(r.failures.join(' ')).toMatch(/maintainer must push the branch/);
  });

  it('(h) the protected gate on a push to main is unchanged', () => {
    const synthetic = {
      files: [],
      categories: [],
      documentationOnly: false,
      jobs: Object.fromEntries(
        (DECLARED_JOBS as Job[]).map((j) => [j.id, { required: true, reason: 'protected' }])
      ),
    };
    const go = evaluate(
      needs(),
      synthetic,
      {},
      {
        trustedContext: true,
        event: 'push',
        evidence: fullRoom,
      }
    );
    expect(go.decision).toBe('Go');
    expect(go.profile).toBe('full');
    for (const job of DECLARED_JOBS as Job[]) {
      if (job.id === 'change-detection') continue;
      const r = evaluate(
        needs({ [job.id]: 'skipped' }),
        synthetic,
        {},
        {
          trustedContext: true,
          event: 'push',
          evidence: fullRoom,
        }
      );
      expect(r.decision, `${job.id} skipped on a push to main`).toBe('No-Go');
    }
  });

  it('(i) a dispatch whose run commit is not the named candidate: No-Go', () => {
    const r = evaluate(
      needs(),
      { files: [], categories: [], documentationOnly: false, jobs: {} },
      { expectedSha: 'a'.repeat(40), actualSha: 'b'.repeat(40) },
      {
        trustedContext: true,
        event: 'workflow_dispatch',
        evidence: { 'clean-room-profile': { profile: 'full', recordsMode: 'checkpoint-deferred' } },
      }
    );
    expect(r.decision).toBe('No-Go');
    expect(r.failures.join(' ')).toMatch(/exact-SHA disagreement/);
  });

  it('prints the review date, and warns once it has passed', () => {
    const c = both(['docs/user-manual/a.md']);
    const late = evaluate(
      skippedUnlessRequired(c),
      c,
      {},
      {
        trustedContext: true,
        ...PR_DEVELOP,
        evidence: devRoom(c),
        now: new Date('2026-11-06T00:00:00Z'),
      }
    );
    expect(late.decision, 'the review date never fails a gate').toBe('Go');
    expect(late.policy?.overdue).toBe(true);
    expect(toMarkdown(late, c)).toMatch(/review date has passed/);
    const early = evaluate(
      skippedUnlessRequired(c),
      c,
      {},
      {
        trustedContext: true,
        ...PR_DEVELOP,
        evidence: devRoom(c),
        now: new Date('2026-10-06T00:00:00Z'),
      }
    );
    expect(early.policy?.overdue).toBe(false);
    expect(toMarkdown(early, c)).toMatch(/Review due by \*\*2026-11-05\*\*/);
  });
});

/* ======================================================================== */

describe('replaying the classifier over the merged pull requests #481 to #512', () => {
  it('classifies each one under the development profile and publishes the mix', () => {
    const merges = git('log', '--first-parent', '--merges', '--format=%H %s', BASELINE, '-30')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, ...rest] = line.split(' ');
        return { sha: sha as string, pr: /#(\d+)/.exec(rest.join(' '))?.[1] ?? '?' };
      });
    expect(merges).toHaveLength(30);
    expect(merges.at(-1)?.pr).toBe('481');
    expect(merges[0]?.pr).toBe('512');
    const mix = { escalated: 0, development: 0, browser: 0, webQuality: 0, docsOnly: 0 };
    for (const { sha, pr } of merges) {
      const files = git('diff', '--name-only', `${sha}^1`, `${sha}^2`).split('\n').filter(Boolean);
      const c = keepStricter(
        classify(files, PR_DEVELOP),
        classify(files, PR_DEVELOP)
      ) as Classification;
      for (const job of ALWAYS_REQUIRED) expect(c.jobs[job]?.required, `#${pr} ${job}`).toBe(true);
      if (files.some((f) => f.startsWith('.github/workflows/'))) {
        expect(c.escalated, `#${pr} touched a workflow`).toBe(true);
      }
      if (c.escalated) mix.escalated += 1;
      else mix.development += 1;
      if (c.jobs['authenticated-browser']?.required) mix.browser += 1;
      if (c.jobs['web-quality']?.required) mix.webQuality += 1;
      if (required(c).length === ALWAYS_REQUIRED.length) mix.docsOnly += 1;
    }
    expect(mix.escalated + mix.development).toBe(30);
    // Published, not asserted: the measured mix replaces the design's estimate.
    console.log(`TDP-2026-10 classifier replay over #481–#512: ${JSON.stringify(mix)}`);
  });
});

describe('the shared setup action caches npm only in a job that installs', () => {
  /*
   * TDP-2026-10 fix round 2. setup-node v7 caches npm on its own whenever
   * package.json names npm as its package manager and `package-manager-cache`
   * is left at its default, even with `cache` empty. A job that does not
   * install then saves an empty entry under the installing jobs' key, and every
   * installing job restores it as an exact hit and downloads everything again.
   * Both inputs are evaluated here for an installing and a non-installing job.
   */
  const action = readRepo('.github/actions/setup-project/action.yml');
  const step = action
    .split(/\n(?= {4}- )/)
    .find((chunk) => /^ {4}- name: Set up Node\s*$/m.test(chunk));
  const input = (name: string): string | undefined =>
    new RegExp(String.raw`^ {8}${name}:\s*(.+?)\s*$`, 'm').exec(step ?? '')?.[1];
  const evaluateFor = (install: 'true' | 'false', name: string): ExpressionValue => {
    const raw = input(name);
    if (raw === undefined) return null;
    return /^\$\{\{/.test(raw)
      ? evaluateExpression(unwrap(raw), { 'inputs.install': install })
      : raw;
  };

  it('finds the step, and package.json is what turns automatic caching on', () => {
    expect(step, 'the Set up Node step of setup-project').toBeDefined();
    expect(step).toContain('uses: actions/setup-node@');
    const manifest = JSON.parse(readRepo('package.json')) as { packageManager?: string };
    expect(manifest.packageManager ?? '').toMatch(/^npm@/);
  });

  it('a job that does not install neither names npm nor lets setup-node cache on its own', () => {
    expect(evaluateFor('false', 'cache')).toBe('');
    expect(evaluateFor('false', 'package-manager-cache')).toBe(false);
  });

  it('a job that installs caches npm under the versioned key', () => {
    expect(evaluateFor('true', 'cache')).toBe('npm');
    expect(evaluateFor('true', 'package-manager-cache')).toBe(true);
    expect(step).toContain('.github/actions/setup-project/npm-cache.version');
  });
});
