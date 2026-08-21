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

describe('a merge that adds nothing is the parent it adds nothing to', () => {
  /*
   * Two merges in this repository carry one parent's tree byte for byte, and the
   * seal read both of them wrong. Neither was found by reading code.
   *
   * The PROMOTION was found in hosted CI, and the first fix for it was wrong. It
   * assumed the promotion checkout was `develop`'s tip measured against
   * `develop` and exempted "head IS base". That shape never occurs —
   * `actions/checkout` takes the merge ref, whose parents are the protected
   * branch and `develop`. Measured against the real ref the exemption changed
   * nothing: 4 fabricated and 24 unnamed, exactly as before. It was SIMULATED
   * instead of reproduced, and a simulation of the wrong shape passes as
   * convincingly as a fix does.
   *
   * The SYNC was found by asking what would happen next. `main` is protected
   * with strict required status checks, so `develop` cannot be promoted until it
   * contains `main` — and with the base branch moved to that merge, the
   * protected reproof reported 61 in range and 18 unnamed executable successors
   * on a package that had changed by nothing.
   *
   * So these cases build the objects Git builds, run the real seal over them,
   * and assert the invariant both fixes rest on: A MERGE THAT ADDS NO CONTENT
   * DOES NOT CHANGE WHAT THE SEAL SAYS. Not "it passes" — it AGREES, on the head
   * under test, on the subtrahend and on the range.
   *
   * The protected side is a SYNTHETIC divergent line, rooted at the candidate's
   * own parent. Anchoring to a real branch — or to a merge base between two of
   * them — couples these cases to where those branches stand: the moment a
   * promotion lands, `main` carries the candidate, the merge base becomes
   * `develop`, and every precondition here reads as a failure of the seal rather
   * than as history moving on. See `protectedLine` below, which learned that the
   * hard way on the promotion these cases exist to protect.
   */

  /*
   * Memoised, because these cases take several full bindings over a range of
   * real commits and every one of those is a Git subprocess. Uncached the file
   * runs for tens of seconds, and longer under a parallel suite — which is how a
   * correct test becomes a timeout with no assertion behind it.
   *
   * Safe to cache because every query reads immutable objects: a commit's
   * parents, a revision's tree, an ancestry relation. The one command that
   * WRITES, `commit-tree`, is content-addressed over the tree and parents asked
   * for, so returning the first answer returns the same merge.
   */
  const ANSWERS = new Map<string, string | null>();
  const GIT = (args: readonly string[]): string | null => {
    const key = args.join(' ');
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
  const rev = (spec: string): string => String(GIT(['rev-parse', '--verify', spec]) ?? '').trim();
  const treeOf = (spec: string): string =>
    String(GIT(['rev-parse', `${spec}^{tree}`]) ?? '').trim();
  const commit = (tree: string, parents: string[], why: string): string =>
    String(
      GIT(['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', why]) ?? ''
    ).trim();
  const carries = (commitish: string, sha: string): boolean =>
    GIT(['merge-base', '--is-ancestor', sha, commitish]) !== null;

  const CANDIDATE = JSON.parse(
    readFileSync(
      join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'evidence', 'closure-candidate.json'),
      'utf8'
    )
  ) as { candidate: { FINAL_CODE_SHA: string } };
  const CANDIDATE_SHA = CANDIDATE.candidate.FINAL_CODE_SHA;

  /**
   * A `git` that answers `HEAD` as `head` and the base branch as `base`, and
   * every other question for real. Both must move together: a merge that lands
   * on the base branch IS the base branch afterwards, and a case that moves only
   * `HEAD` measures a state no checkout is ever in. Getting that wrong is what
   * hid the sync merge for a full cycle.
   */
  const world =
    (head: string, base: string) =>
    (args: readonly string[]): string | null => {
      if (args[0] === 'rev-list' && args.includes('--parents') && args.at(-1) === 'HEAD') {
        return GIT(['rev-list', '--parents', '-n', '1', head]);
      }
      if (
        args[0] === 'rev-parse' &&
        args.includes('--verify') &&
        String(args.at(-1)).includes('origin/develop')
      ) {
        return `${base}\n`;
      }
      return GIT(args);
    };

  type Binding = {
    /*
     * `phaseHead`, and the name matters: an earlier revision of this type called
     * it `head`, which no binding carries, so every assertion on it compared
     * undefined with undefined and could not fail. Caught by a case that expected
     * a specific commit rather than agreement.
     */
    phaseHead: string | null;
    mergeRefBaseSide?: string | null;
    mergeAddsNothingTo?: string | null;
    commits: unknown[];
    fabricatedSuccessors: string[];
    unrecordedExecutable: string[];
    declinedUnwrap: string | null;
    topologyUnknown: string | null;
  };
  const bindingIn = (head: string, base: string): Binding =>
    repositoryBinding(CANDIDATE as never, world(head, base)) as unknown as Binding;

  /** Every shape in a promotion cycle must give the base branch's own answer. */
  const agreesWith = (label: string, actual: Binding, expected: Binding): void => {
    expect(actual.topologyUnknown, `${label}: the Git world became unknown`).toBeNull();
    expect(actual.declinedUnwrap, `${label}: the unwrap was declined`).toBeNull();
    expect(actual.phaseHead, `${label}: the head under test moved`).toBe(expected.phaseHead);
    expect(actual.mergeRefBaseSide, `${label}: the subtrahend moved`).toBe(
      expected.mergeRefBaseSide
    );
    expect(actual.commits.length, `${label}: the successor count changed`).toBe(
      expected.commits.length
    );
    /*
     * Compared with the base branch's own answer rather than with an empty
     * list, because these two are properties of WHERE THE BRANCH STANDS, not of
     * the merge. A branch ahead of its base names successors the base does not
     * carry yet, and asserting zero here would make these cases fail on every
     * branch that has work in flight — while proving nothing extra, since the
     * question asked is whether a content-free merge CHANGES the answer.
     */
    expect(actual.fabricatedSuccessors, `${label}: the fabricated set changed`).toEqual(
      expected.fabricatedSuccessors
    );
    expect(actual.unrecordedExecutable, `${label}: the unnamed set changed`).toEqual(
      expected.unrecordedExecutable
    );
  };

  /**
   * A protected line that diverges from the base branch and never carries the
   * candidate.
   *
   * Rooted at the CANDIDATE'S OWN PARENT, and that is the whole design. A commit
   * cannot contain its own descendant, so this root cannot carry the candidate —
   * ever, on any branch, at any point in a promotion cycle.
   *
   * The first revision rooted it at `merge-base(origin/main, origin/develop)`
   * specifically to avoid naming `origin/main`, and the docblock above says why.
   * It was still coupled: once a promotion lands, `develop` is contained in
   * `main` and that merge base IS `develop` — which carries the candidate. The
   * protected-main reproof went red on the promotion these cases exist to
   * protect, with "the synthetic protected line carries the candidate".
   *
   * Avoiding a branch NAME was never the point. Not depending on where any
   * branch stands is.
   */
  const protectedLine = (): string => {
    const base = String(GIT(['rev-parse', `${CANDIDATE_SHA}^`]) ?? '').trim();
    expect(
      base,
      'the candidate has no parent to root a divergent line at, so nothing here is measurable'
    ).toMatch(/^[0-9a-f]{40}$/);
    const line = commit(treeOf(base), [base], 'a divergent protected line');
    expect(line).toMatch(/^[0-9a-f]{40}$/);
    expect(carries(line, CANDIDATE_SHA), 'the synthetic protected line carries the candidate').toBe(
      false
    );
    expect(
      carries('origin/develop', line),
      'the synthetic protected line is contained in the base branch, so it does not diverge'
    ).toBe(false);
    return line;
  };

  it('agrees with the base branch on the promotion, the sync, and the promotion of the sync', () => {
    const develop = rev('origin/develop');
    expect(develop, 'origin/develop does not resolve, so this measures nothing').toMatch(
      /^[0-9a-f]{40}$/
    );
    expect(carries(develop, CANDIDATE_SHA), 'the base branch does not carry the candidate').toBe(
      true
    );
    const other = protectedLine();

    const onDevelop = bindingIn(develop, develop);
    expect(
      onDevelop.commits.length,
      'the base branch has no successors, so these cases would pass on any package'
    ).toBeGreaterThan(0);

    // What GitHub writes for refs/pull/N/merge: the head branch's tree, base
    // parent first, head branch second.
    const promotion = commit(treeOf(develop), [other, develop], 'promotion preview');
    agreesWith('the promotion preview', bindingIn(promotion, develop), onDevelop);

    // What `git merge <protected>` writes on the base branch, and what the base
    // branch IS from then on. Required before a promotion, because the protected
    // branch demands its head be up to date.
    const sync = commit(treeOf(develop), [develop, other], 'sync the protected branch in');
    agreesWith('the base branch after the sync', bindingIn(sync, sync), onDevelop);

    // The sync's own pull request, and then the promotion of the synced branch —
    // two content-free merges deep in each direction.
    const syncPreview = commit(treeOf(develop), [develop, sync], 'the sync pull request');
    agreesWith('the sync pull request', bindingIn(syncPreview, develop), onDevelop);

    const promotionOfSync = commit(treeOf(sync), [other, sync], 'promotion preview');
    agreesWith('the promotion of the synced branch', bindingIn(promotionOfSync, sync), onDevelop);
  }, 180_000);

  it('keeps the base as it STOOD when a sync merge sits between the head and it', () => {
    /*
     * The case that made the surviving base side a CHOICE rather than a default.
     *
     * A branch whose last commit is a sync merge, landed on the base branch,
     * gives three nested merges: the landing merge names the base as it stood,
     * the sync merge in between names the protected branch, and the commit
     * beneath names nothing. Taking the innermost side subtracts the PROTECTED
     * branch and every commit since the candidate reads as an unnamed successor;
     * taking the outermost blindly is wrong in the promotion, where the
     * innermost is the right one.
     *
     * Neither depth rule works, and the fact that does is which side lies on the
     * base branch's own first-parent line — because that is what merging into a
     * protected branch does to it, while a protected branch merged INTO the base
     * only ever arrives as a second parent.
     */
    const develop = rev('origin/develop');
    const other = protectedLine();

    // A branch that ends in a sync merge, exactly like the one this test file
    // is being committed on.
    const work = commit(treeOf(develop), [develop], 'work on top of the base');
    const syncLast = commit(treeOf(work), [work, other], 'sync the protected branch in, last');
    // ...and that branch landing on the base branch.
    const landed = commit(treeOf(syncLast), [develop, syncLast], 'Merge pull request');

    const onBranch = bindingIn(syncLast, develop);
    const onBase = bindingIn(landed, landed);

    expect(onBranch.topologyUnknown, 'the branch made the Git world unknown').toBeNull();
    expect(onBase.topologyUnknown, 'the landing made the Git world unknown').toBeNull();
    expect(onBranch.phaseHead, 'the head under test is not the work beneath the sync').toBe(work);
    expect(onBase.phaseHead, 'landing on the base moved the head under test').toBe(work);
    expect(
      onBase.mergeRefBaseSide,
      'the protected branch was taken as the base as it stood'
    ).not.toBe(other);
    expect(onBase.commits.length, 'the range is empty, so this would pass on any package').toBe(1);
    expect(
      onBase.commits.length,
      'landing the branch changed how much it is held to have added'
    ).toBe(onBranch.commits.length);
  }, 180_000);

  it('names the parent it read, so a reader can see the merge was unwrapped', () => {
    const develop = rev('origin/develop');
    const promotion = commit(treeOf(develop), [protectedLine(), develop], 'promotion preview');
    expect(
      bindingIn(promotion, develop).mergeAddsNothingTo,
      'the merge was unwrapped without saying so'
    ).toBe(develop);
  }, 120_000);

  it('refuses the same shape when the merge does NOT carry a parent tree', () => {
    /*
     * Tree identity is what makes reading the parent safe: a checkout identical
     * in content can smuggle nothing in through its other parent. Take the
     * identity away and the rule must not fire — this is the case that keeps it
     * a measurement rather than an exemption.
     */
    const develop = rev('origin/develop');
    const other = protectedLine();
    expect(
      treeOf(other),
      "the protected line's tree equals the base branch's, so this cannot break the identity"
    ).not.toBe(treeOf(develop));

    const impostor = commit(treeOf(other), [other, develop], 'not content-free');
    expect(
      bindingIn(impostor, develop).mergeAddsNothingTo,
      'a merge that changes content was read as its parent'
    ).toBeNull();
  }, 120_000);
});
