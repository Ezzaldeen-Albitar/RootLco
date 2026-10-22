/**
 * `scripts/ci/develop-merge-integrity.mjs` against an in-memory GitHub.
 *
 * Fixtures named by the Owner instruction of 2026-10-06: a matching
 * `independent-review` status, a missing one, one on another SHA, and a tree
 * mismatch — plus the gate check run and the pull-request attribution, which
 * must cite only the pull request whose merge commit is the pushed commit.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIONS_APP_ID,
  GATE_NAME,
  GATE_WORKFLOW,
  REVIEW_CONTEXT,
  checkMergeIntegrity,
} from '../../scripts/ci/develop-merge-integrity.mjs';

const REPO = 'owner/repo';
const sha = (digit: string) => digit.repeat(40);
const MERGE = sha('a');
const BASE = sha('b');
const HEAD = sha('c');
const OTHER = sha('d');
const TREE = sha('e');

interface World {
  mergeParents: string[];
  mergeTree: string;
  headTree: string;
  checkRuns: Record<string, unknown[]>;
  workflowPath: string;
  statuses: Record<string, Array<{ context: string; state: string; description?: string }>>;
  pulls: unknown[];
}

function world(overrides: Partial<World> = {}): World {
  return {
    mergeParents: [BASE, HEAD],
    mergeTree: TREE,
    headTree: TREE,
    checkRuns: {
      [HEAD]: [
        {
          app: { id: ACTIONS_APP_ID },
          head_sha: HEAD,
          conclusion: 'success',
          completed_at: '2026-10-06T10:00:00Z',
          check_suite: { id: 77 },
        },
      ],
    },
    workflowPath: GATE_WORKFLOW,
    statuses: {
      [HEAD]: [{ context: REVIEW_CONTEXT, state: 'success', description: 'approved' }],
    },
    pulls: [
      // The standing promotion pull request also contains the commit. It is not the one that merged.
      { number: 503, merge_commit_sha: OTHER, base: { ref: 'main' }, head: { sha: MERGE } },
      { number: 600, merge_commit_sha: MERGE, base: { ref: 'develop' }, head: { sha: HEAD } },
    ],
    ...overrides,
  };
}

function apiFor(state: World) {
  return async (path: string, query: Record<string, string | number> = {}) => {
    const [, , , kind, ref, tail] = path.split('/');
    if (kind === 'commits' && tail === undefined) {
      if (ref === MERGE) {
        return {
          parents: state.mergeParents.map((parent) => ({ sha: parent })),
          commit: { tree: { sha: state.mergeTree } },
        };
      }
      return { parents: [], commit: { tree: { sha: state.headTree } } };
    }
    if (kind === 'commits' && tail === 'check-runs') {
      expect(query.check_name).toBe(GATE_NAME);
      return { check_runs: state.checkRuns[ref ?? ''] ?? [] };
    }
    if (kind === 'commits' && tail === 'status') {
      return { sha: ref, statuses: state.statuses[ref ?? ''] ?? [] };
    }
    if (kind === 'commits' && tail === 'pulls') return state.pulls;
    if (kind === 'actions') return { workflow_runs: [{ id: 4242, path: state.workflowPath }] };
    throw new Error(`unexpected API path ${path}`);
  };
}

const run = (state: World) =>
  checkMergeIntegrity({ repository: REPO, mergeSha: MERGE, api: apiFor(state) });

describe('develop merge integrity', () => {
  it('passes a merge whose head is the tested candidate and the approved head', async () => {
    const verdict = await run(world());
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.facts).toMatchObject({ head: HEAD, gateRun: 4242, review: 'approved' });
  });

  it('cites only the pull request whose merge commit is the pushed commit, never #503', async () => {
    const verdict = await run(world());
    expect(verdict.facts.pullRequest).toBe(600);
  });

  it('fails when the head carries no independent-review status', async () => {
    const verdict = await run(world({ statuses: {} }));
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/carries no 'independent-review' status/);
  });

  it('fails when the independent-review status is on another SHA', async () => {
    const verdict = await run(
      world({ statuses: { [OTHER]: [{ context: REVIEW_CONTEXT, state: 'success' }] } })
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/carries no 'independent-review' status/);
  });

  it('fails when the status read answers for a different commit', async () => {
    const api = apiFor(world());
    const verdict = await checkMergeIntegrity({
      repository: REPO,
      mergeSha: MERGE,
      api: async (path, query) => {
        const answer = await api(path, query);
        return path.endsWith('/status') ? { ...answer, sha: OTHER } : answer;
      },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/answered for/);
  });

  it('fails when the independent-review status is not success', async () => {
    const verdict = await run(
      world({ statuses: { [HEAD]: [{ context: REVIEW_CONTEXT, state: 'pending' }] } })
    );
    expect(verdict.failures.join('\n')).toMatch(/is 'pending', not success/);
  });

  it('fails on a tree mismatch', async () => {
    const verdict = await run(world({ headTree: OTHER }));
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/develop now holds a tree no PR gate proved/);
  });

  it('fails a commit that is not a merge', async () => {
    const verdict = await run(world({ mergeParents: [BASE] }));
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.join('\n')).toMatch(/has 1 parent/);
  });

  it('fails when the gate check run is missing, failed, foreign, or from another workflow', async () => {
    const missing = await run(world({ checkRuns: {} }));
    expect(missing.failures.join('\n')).toMatch(/carries no 'ci-gate \(development\)' check run/);

    const failed = await run(
      world({
        checkRuns: {
          [HEAD]: [
            {
              app: { id: ACTIONS_APP_ID },
              head_sha: HEAD,
              conclusion: 'failure',
              completed_at: '2026-10-06T10:00:00Z',
              check_suite: { id: 77 },
            },
          ],
        },
      })
    );
    expect(failed.failures.join('\n')).toMatch(/concluded 'failure'/);

    const foreign = await run(
      world({
        checkRuns: {
          [HEAD]: [
            { app: { id: 1 }, head_sha: HEAD, conclusion: 'success', check_suite: { id: 1 } },
          ],
        },
      })
    );
    expect(foreign.failures.join('\n')).toMatch(/no 'ci-gate \(development\)' check run/);

    const elsewhere = await run(world({ workflowPath: '.github/workflows/other.yml' }));
    expect(elsewhere.failures.join('\n')).toMatch(/came from '\.github\/workflows\/other\.yml'/);
  });

  it('fails when no pull request, or a pull request with another head, merged the commit', async () => {
    const none = await run(world({ pulls: [] }));
    expect(none.failures.join('\n')).toMatch(/0 pull request\(s\) name/);

    const moved = await run(
      world({
        pulls: [
          { number: 600, merge_commit_sha: MERGE, base: { ref: 'develop' }, head: { sha: OTHER } },
        ],
      })
    );
    expect(moved.failures.join('\n')).toMatch(/records head .* but the merge's second parent/);

    const wrongBase = await run(
      world({
        pulls: [
          { number: 600, merge_commit_sha: MERGE, base: { ref: 'main' }, head: { sha: HEAD } },
        ],
      })
    );
    expect(wrongBase.failures.join('\n')).toMatch(/based on 'main', not develop/);
  });
});
