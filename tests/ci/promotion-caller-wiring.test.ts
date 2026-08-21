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

describe('the seal knows a promotion adds nothing, so it can fabricate nothing', () => {
  /*
   * The fourth gate with the same blind spot, and the last one this promotion
   * found.
   *
   * `fabricatedSuccessors` asks which recorded ids fall outside
   * `git log <head> --not <candidate> <base>`. That is a real question while a
   * phase branch is ahead of its base. When the head under test IS the resolved
   * base — which is what a promotion of `develop` looks like — the range is
   * EMPTY by construction and every recorded id falls outside it. Reported as
   * fabrication it reads as "this package invented its own history", when the
   * opposite happened: the branch merged and its successors became the base.
   */
  const git = (args: readonly string[]): string | null => {
    try {
      return execFileSync('git', args as string[], { cwd: ROOT, encoding: 'utf8' });
    } catch {
      return null;
    }
  };
  const candidateFile = JSON.parse(
    readFileSync(
      join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'evidence', 'closure-candidate.json'),
      'utf8'
    )
  ) as Record<string, unknown>;

  it('reports no fabrication when the head IS the base, and still does when it is not', () => {
    const tip = String(git(['rev-parse', 'origin/develop']) ?? '').trim();
    expect(tip, 'origin/develop does not resolve, so this case measures nothing').toMatch(
      /^[0-9a-f]{40}$/
    );

    // PROMOTION: a checkout whose head has no parents to unwrap, so the head
    // under test resolves to the base itself.
    const asPromotion = (args: readonly string[]): string | null =>
      args[0] === 'rev-list' && args[1] === '--parents' ? `${tip}\n` : git(args);
    const promotion = repositoryBinding(candidateFile as never, asPromotion) as unknown as {
      promotionEmptyRange: boolean;
      fabricatedSuccessors: string[];
      commits: unknown[];
    };
    expect(promotion.promotionEmptyRange, 'the promotion context was not recognised').toBe(true);
    expect(promotion.commits, 'a promotion should add nothing').toHaveLength(0);
    expect(
      promotion.fabricatedSuccessors,
      'a promotion reported its own merged history as fabricated'
    ).toEqual([]);

    // ORDINARY: the real checkout, where the head is ahead of its base. The rule
    // must still bite — a recorded id outside the range is a fabrication.
    const ordinary = repositoryBinding(candidateFile as never, git) as unknown as {
      promotionEmptyRange: boolean;
    };
    expect(ordinary.promotionEmptyRange, 'an ordinary branch claimed the promotion exemption').toBe(
      false
    );

    const invented = JSON.parse(JSON.stringify(candidateFile)) as {
      successors: { commit: string }[];
    };
    invented.successors = [{ commit: 'f'.repeat(40) }];
    const caught = repositoryBinding(invented as never, git) as unknown as {
      fabricatedSuccessors: string[];
    };
    expect(
      caught.fabricatedSuccessors,
      'an invented successor was accepted on an ordinary branch'
    ).toContain('f'.repeat(40));
  });
});
