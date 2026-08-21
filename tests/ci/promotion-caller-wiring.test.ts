/**
 * The coverage jobs must be TOLD which branch they are running for.
 *
 * A promotion is not an edit, so the touched-file coverage floor does not apply
 * to a pull request whose head is a protected branch. The reusable workflow
 * decides that from `head-branch` — and for one full CI cycle it decided it
 * from an empty string, because `web-quality` and `unit-tests-coverage` passed
 * `base-ref` and forgot `head-branch`. The clause was present, correct, and
 * inert: 921 commits of already-reviewed work were held to a per-edit floor and
 * every log line about promotions sat there unexecuted.
 *
 * That is the same failure the comment above `base-ref` in `pr-ci.yml`
 * describes, pointing the other way: there a missing input DISABLED the floor
 * silently, here it ENABLED it where it does not belong. One fault — a gate
 * whose behaviour depends on an input the caller forgot — and reading the YAML
 * is exactly how it was missed the first time, because the YAML looked fine.
 *
 * So these cases do not read for the presence of a line. They resolve the
 * caller's expressions against a real pull-request payload and assert the VALUE
 * the step would receive.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';

import { repositoryBinding } from '../../scripts/ci/build-p1-28-evidence-manifest.mjs';
import { decideOwnershipRun } from '../../scripts/ci/check-phase-ownership.mjs';

const ROOT = join(__dirname, '..', '..');
const PR_CI = readFileSync(join(ROOT, '.github', 'workflows', 'pr-ci.yml'), 'utf8');
const PROTECTED_CI = readFileSync(
  join(ROOT, '.github', 'workflows', 'protected-develop-verification.yml'),
  'utf8'
);
const RULES = JSON.parse(
  readFileSync(join(ROOT, '.github', 'ci-baselines', 'phase-ownership-profiles.json'), 'utf8')
).rules as { branchPrefix?: string; profile?: string }[];

/** The jobs whose coverage floor the promotion clause governs. */
const COVERAGE_TASKS = ['web-quality', 'unit-coverage'] as const;

/**
 * The `with:` block of the job that requests a given task, as a map of input to
 * the literal expression the caller writes.
 */
function callerInputs(workflow: string, task: string): Record<string, string> {
  const at = workflow.indexOf(`task: ${task}\n`);
  if (at === -1) return {};
  // The block runs from the task line to the next line that is not indented
  // further than the `with:` entries — i.e. the next key at job level.
  const rest = workflow.slice(at);
  const end = rest.search(/\n {0,4}\S/);
  const block = end === -1 ? rest : rest.slice(0, end);
  const inputs: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^\s{6}([a-z-]+):\s*(.+?)\s*$/.exec(line);
    if (m) inputs[m[1]!] = m[2]!;
  }
  return inputs;
}

/** Resolve a GitHub expression against a pull-request payload. */
function resolve(expression: string, event: { head: string; base: string }): string {
  return expression
    .replace(/\$\{\{\s*github\.event\.pull_request\.head\.ref\s*\}\}/g, event.head)
    .replace(/\$\{\{\s*github\.event\.pull_request\.base\.ref\s*\}\}/g, event.base)
    .trim();
}

/** The clause the changed-files step applies, mirrored from the workflow. */
const isPromotion = (headBranch: string): boolean =>
  headBranch === 'main' || headBranch === 'develop';

describe('the coverage callers forward the branch the promotion clause reads', () => {
  it.each(COVERAGE_TASKS)('%s passes both head-branch and base-ref', (task) => {
    const inputs = callerInputs(PR_CI, task);
    expect(Object.keys(inputs), `no caller requests task ${task}`).not.toHaveLength(0);
    expect(
      inputs['base-ref'],
      `${task} passes no base-ref, so the floor would inspect nothing`
    ).toBeDefined();
    expect(
      inputs['head-branch'],
      `${task} passes no head-branch, so the promotion clause reads an empty string and a promotion is judged as an edit`
    ).toBeDefined();
  });

  it.each(COVERAGE_TASKS)('%s resolves a develop → main promotion to the real branches', (task) => {
    const inputs = callerInputs(PR_CI, task);
    const event = { head: 'develop', base: 'main' };

    expect(resolve(inputs['head-branch'] ?? '', event), `${task} head-branch`).toBe('develop');
    expect(resolve(inputs['base-ref'] ?? '', event), `${task} base-ref`).toBe('main');
    expect(
      isPromotion(resolve(inputs['head-branch'] ?? '', event)),
      `${task} would not classify develop → main as a promotion`
    ).toBe(true);
  });

  it.each(COVERAGE_TASKS)('%s does NOT classify an ordinary feature PR as a promotion', (task) => {
    const inputs = callerInputs(PR_CI, task);
    for (const head of ['p1-28/closure-record', 'feature/pre-p1-29-admin', 'fix/anything']) {
      const resolved = resolve(inputs['head-branch'] ?? '', { head, base: 'develop' });
      expect(resolved, `${task} lost the feature branch`).toBe(head);
      expect(isPromotion(resolved), `${head} was treated as a promotion`).toBe(false);
    }
  });

  it('leaves the protected-push callers passing neither, which is a different case', () => {
    /*
     * On a protected push there is no pull request, so there is no base to diff
     * against and no head branch to classify. The changed-file list is empty and
     * the floor reports that it inspected nothing. Passing a head-branch there
     * would invent a promotion out of an ordinary push.
     */
    for (const task of COVERAGE_TASKS) {
      const inputs = callerInputs(PROTECTED_CI, task);
      expect(Object.keys(inputs), `no protected caller requests ${task}`).not.toHaveLength(0);
      expect(
        inputs['head-branch'],
        `the protected ${task} caller invents a head branch`
      ).toBeUndefined();
      expect(inputs['base-ref'], `the protected ${task} caller invents a base`).toBeUndefined();
    }
  });
});

describe('ownership classifies the same promotion the same way', () => {
  it('declares a skip for develop → main, and still refuses an unmapped branch', () => {
    const promotion = decideOwnershipRun({
      headBranch: 'develop',
      baseRef: 'main',
      eventName: 'pull_request',
      rules: RULES,
    }) as { action: string; checked: boolean };
    expect(promotion.action).toBe('declared-skip');
    expect(promotion.checked, 'a promotion reported ownership as CHECKED').toBe(false);

    const unmapped = decideOwnershipRun({
      headBranch: 'nobody/mapped-this',
      baseRef: 'develop',
      eventName: 'pull_request',
      rules: RULES,
    }) as { action: string };
    expect(unmapped.action, 'an unmapped branch was waved through').toBe('refuse');

    const feature = decideOwnershipRun({
      headBranch: 'p1-28/closure-record',
      baseRef: 'develop',
      eventName: 'pull_request',
      rules: RULES,
    }) as { action: string; checked: boolean };
    expect(feature.action, 'an ordinary feature PR stopped being checked').toBe('check');
    expect(feature.checked).toBe(true);
  });
});

describe('the seal reads a promotion as the branch it promotes', () => {
  /*
   * The fourth gate with the same blind spot — and the one that taught the
   * sharpest lesson, because the first fix for it was wrong.
   *
   * That fix assumed the promotion checkout was `develop`'s tip with `develop`
   * as its base, so it exempted the case "head IS base". That shape never
   * occurs. `actions/checkout` takes the pull request's MERGE REF, whose parents
   * are `main` and `develop` — and the exemption, measured against the real ref,
   * changed nothing at all. The shape was simulated instead of reproduced, and a
   * simulation of the wrong shape passes just as convincingly as a fix does.
   *
   * So these cases build the object GitHub builds — `develop`'s tree, parented
   * on `main` and `develop` — and run the real seal over it. What they assert is
   * the invariant the fix rests on: PROMOTING A BRANCH DOES NOT CHANGE WHAT THE
   * SEAL SAYS ABOUT IT. Before the fix the same sealed package reported 10
   * successors, 0 fabricated and 0 unnamed on `develop`, and 28 / 4 / 24 on the
   * promotion of `develop` — a contradiction no package state could satisfy.
   */
  /*
   * Memoised, because these cases take two full bindings over a range of real
   * commits and every one of those is a Git subprocess. Uncached the pair runs
   * for about thirteen seconds on its own and longer under a full parallel
   * suite, which is how a correct test becomes a timeout nobody can read: the
   * run reports a failure with no assertion behind it.
   *
   * Safe to cache because every query here reads immutable objects — a commit's
   * parents, a revision's tree, an ancestry relation. The one command that
   * WRITES, `commit-tree`, is content-addressed over the tree and parents that
   * were asked for, so returning the first answer returns the same merge.
   */
  const ANSWERS = new Map<string, string | null>();
  const ROOT_GIT = (args: readonly string[]): string | null => {
    const key = args.join(' ');
    if (ANSWERS.has(key)) return ANSWERS.get(key) ?? null;
    let answer: string | null;
    try {
      answer = execFileSync('git', args as string[], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'seal',
          GIT_AUTHOR_EMAIL: 'seal@localhost',
          GIT_COMMITTER_NAME: 'seal',
          GIT_COMMITTER_EMAIL: 'seal@localhost',
        },
      });
    } catch {
      answer = null;
    }
    ANSWERS.set(key, answer);
    return answer;
  };
  const rev = (spec: string): string | null => {
    const id = String(ROOT_GIT(['rev-parse', '--verify', '--quiet', spec]) ?? '').trim();
    return /^[0-9a-f]{40}$/.test(id) ? id : null;
  };
  const treeOf = (spec: string): string =>
    String(ROOT_GIT(['rev-parse', `${spec}^{tree}`]) ?? '').trim();
  const CANDIDATE = JSON.parse(
    readFileSync(
      join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'evidence', 'closure-candidate.json'),
      'utf8'
    )
  ) as Record<string, unknown>;

  /** A `git` that answers `HEAD` as `at`, and every other question for real. */
  const checkedOutAt =
    (at: string) =>
    (args: readonly string[]): string | null =>
      args[0] === 'rev-list' && args.includes('--parents') && args.at(-1) === 'HEAD'
        ? ROOT_GIT(['rev-list', '--parents', '-n', '1', at])
        : ROOT_GIT(args);

  type Binding = {
    head: string | null;
    mergeRefBaseSide?: string | null;
    promotionOfBaseTip?: string | null;
    commits: unknown[];
    fabricatedSuccessors: string[];
    unrecordedExecutable: string[];
    declinedUnwrap: string | null;
  };
  const bindingAt = (at: string): Binding =>
    repositoryBinding(CANDIDATE as never, checkedOutAt(at)) as unknown as Binding;

  it('answers a develop to main promotion exactly as it answers develop', () => {
    const develop = rev('origin/develop');
    const main = rev('origin/main');
    expect(
      develop,
      'origin/develop does not resolve, so this case measures nothing'
    ).not.toBeNull();
    expect(main, 'origin/main does not resolve, so this case measures nothing').not.toBeNull();
    expect(
      ROOT_GIT(['merge-base', '--is-ancestor', String(main), String(develop)]),
      'main is now an ancestor of develop, so this no longer builds a promotion'
    ).toBeNull();

    // The object GitHub writes for refs/pull/N/merge: the head branch's tree,
    // parented on the base branch first and the head branch second.
    const mergeRef = String(
      ROOT_GIT([
        'commit-tree',
        treeOf(String(develop)),
        '-p',
        String(main),
        '-p',
        String(develop),
        '-m',
        'promotion preview',
      ]) ?? ''
    ).trim();
    expect(mergeRef, 'the promotion merge object could not be built').toMatch(/^[0-9a-f]{40}$/);

    const onDevelop = bindingAt(String(develop));
    const onPromotion = bindingAt(mergeRef);

    expect(
      onPromotion.declinedUnwrap,
      'the promotion was declined as an unrelated merge'
    ).toBeNull();
    expect(onPromotion.promotionOfBaseTip, 'the promotion was not recognised as one').toBe(develop);

    // The invariant. Not "the promotion passes" — the promotion AGREES.
    expect(onPromotion.head, 'a promotion moved the head under test').toBe(onDevelop.head);
    expect(onPromotion.mergeRefBaseSide, 'a promotion moved the subtrahend').toBe(
      onDevelop.mergeRefBaseSide
    );
    expect(onPromotion.commits.length, 'a promotion changed the successor count').toBe(
      onDevelop.commits.length
    );
    expect(
      onPromotion.commits.length,
      'the range is empty, so this case would pass on any package'
    ).toBeGreaterThan(0);
    expect(onPromotion.fabricatedSuccessors, 'a promotion invented fabricated successors').toEqual(
      []
    );
    expect(onPromotion.unrecordedExecutable, 'a promotion invented unnamed successors').toEqual([]);
  }, 120_000);

  it('refuses the same shape when the merge does NOT carry the branch tree', () => {
    /*
     * Tree identity is what makes reading the base tip safe: a checkout
     * identical in content to that tip can smuggle nothing in through its other
     * parent. Take the identity away and the recognition must not fire — this is
     * the case that keeps the rule a measurement rather than an exemption.
     */
    const develop = String(rev('origin/develop'));
    const main = String(rev('origin/main'));
    const foreignTree = treeOf(main);
    expect(
      foreignTree,
      "main's tree equals develop's, so this case cannot break the identity"
    ).not.toBe(treeOf(develop));

    const impostor = String(
      ROOT_GIT(['commit-tree', foreignTree, '-p', main, '-p', develop, '-m', 'not a promotion']) ??
        ''
    ).trim();
    expect(impostor).toMatch(/^[0-9a-f]{40}$/);

    expect(
      bindingAt(impostor).promotionOfBaseTip,
      'a merge that changes content was accepted as a promotion'
    ).toBeNull();
  }, 120_000);
});
