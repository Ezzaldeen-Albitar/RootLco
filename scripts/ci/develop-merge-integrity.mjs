#!/usr/bin/env node
/**
 * Develop merge integrity (TDP-2026-10), run by `.github/workflows/develop-merge-integrity.yml`
 * on every push to `develop`.
 *
 * A merge into `develop` passes only when ALL of these hold for the pushed
 * commit M:
 *
 *   1. M is a merge (two parents) — nothing reached `develop` except through a
 *      pull request;
 *   2. tree(M) == tree(M^2) — the merge introduced nothing the pull-request
 *      head did not carry;
 *   3. M^2, the TESTED CANDIDATE, carries a successful `ci-gate (development)`
 *      check run from GitHub Actions, latest attempt, produced by
 *      `.github/workflows/pr-ci.yml`;
 *   4. M^2, the APPROVED HEAD, carries a successful `independent-review` commit
 *      status — set by the PR's single landing owner on the head they approved,
 *      immediately before merging (`scripts/ci/landing-guard.mjs`). A status on
 *      any other commit, a missing status, or one that is not `success` fails;
 *   5. exactly one pull request names M as its `merge_commit_sha`, it was based
 *      on `develop`, and its recorded head is M^2. Only that pull request is
 *      cited: the commit-to-pulls listing also returns every OPEN pull request
 *      that happens to contain the commit (the standing promotion pull request
 *      among them), and none of those is the one that merged.
 *
 * It proves PROVENANCE, not quality: success prints "merged, full checkpoint
 * verification pending". `independent-review` is checked here and in no
 * ruleset — the rulesets are unchanged by this check.
 *
 * Self-contained on purpose (no repository imports): the workflow checks out
 * `scripts/ci` only. The GitHub API reader is injected, so every refusal is
 * exercised by `tests/ci/develop-merge-integrity.test.ts` without a network.
 *
 * Usage (the workflow): REPOSITORY, MERGE_SHA and GH_TOKEN in the environment.
 * Exit codes: 0 pass · 1 integrity failure · 2 configuration or API error.
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const GATE_NAME = 'ci-gate (development)';
export const GATE_WORKFLOW = '.github/workflows/pr-ci.yml';
/** GitHub Actions' app id. A check run with the gate's name from any other app is not the gate. */
export const ACTIONS_APP_ID = 15368;
export const REVIEW_CONTEXT = 'independent-review';
export const DEVELOP = 'develop';

const SHA = /^[0-9a-f]{40}$/;

/**
 * @typedef {(path: string, query?: Record<string, string | number>) => Promise<any>} ApiReader
 */

/**
 * @param {{ repository: string, mergeSha: string, api: ApiReader }} input
 * @returns {Promise<{ ok: boolean, failures: string[], facts: Record<string, string | number | null> }>}
 */
export async function checkMergeIntegrity({ repository, mergeSha, api }) {
  /** @type {string[]} */
  const failures = [];
  /** @type {Record<string, string | number | null>} */
  const facts = {
    merge: mergeSha,
    head: null,
    tree: null,
    gateRun: null,
    review: null,
    pullRequest: null,
  };
  const done = () => ({ ok: failures.length === 0, failures, facts });

  if (!SHA.test(mergeSha)) {
    failures.push(`'${mergeSha}' is not a 40-character commit SHA.`);
    return done();
  }

  // 1 + 2: a merge whose tree is its pull-request head's tree.
  const commit = await api(`repos/${repository}/commits/${mergeSha}`);
  const parents = Array.isArray(commit?.parents) ? commit.parents : [];
  if (parents.length !== 2) {
    failures.push(
      `${mergeSha} has ${parents.length} parent(s). Only a merge commit of a pull request may reach develop.`
    );
    return done();
  }
  const headSha = String(parents[1]?.sha ?? '');
  facts.head = headSha;
  if (!SHA.test(headSha)) {
    failures.push(`the second parent of ${mergeSha} is not a commit SHA.`);
    return done();
  }
  const mergeTree = String(commit?.commit?.tree?.sha ?? '');
  const head = await api(`repos/${repository}/commits/${headSha}`);
  const headTree = String(head?.commit?.tree?.sha ?? '');
  facts.tree = mergeTree;
  if (!SHA.test(mergeTree) || mergeTree !== headTree) {
    failures.push(
      `tree(${mergeSha}) = ${mergeTree || 'unknown'} but tree(${headSha}) = ${headTree || 'unknown'}: ` +
        'develop now holds a tree no PR gate proved and nobody approved. Keep the branch up to date ' +
        'with develop before merging.'
    );
  }

  // 3: the tested candidate — the gate check run on exactly M^2.
  const runs = await api(`repos/${repository}/commits/${headSha}/check-runs`, {
    check_name: GATE_NAME,
    filter: 'latest',
    per_page: 100,
  });
  const gateRuns = (Array.isArray(runs?.check_runs) ? runs.check_runs : [])
    .filter((run) => String(run?.app?.id) === String(ACTIONS_APP_ID) && run?.head_sha === headSha)
    .sort((a, b) => String(a?.completed_at ?? '').localeCompare(String(b?.completed_at ?? '')));
  const gate = gateRuns.at(-1);
  if (!gate) {
    failures.push(`${headSha} carries no '${GATE_NAME}' check run from GitHub Actions.`);
  } else if (gate.conclusion !== 'success') {
    failures.push(
      `the latest '${GATE_NAME}' check run on ${headSha} concluded '${gate.conclusion}', not success.`
    );
  } else {
    const suite = gate?.check_suite?.id;
    const listing = await api(`repos/${repository}/actions/runs`, {
      check_suite_id: String(suite),
    });
    const run = Array.isArray(listing?.workflow_runs) ? listing.workflow_runs[0] : undefined;
    if (!run || run.path !== GATE_WORKFLOW) {
      failures.push(
        `the '${GATE_NAME}' check run on ${headSha} came from '${run?.path ?? 'no workflow run'}', ` +
          `not ${GATE_WORKFLOW}.`
      );
    } else {
      facts.gateRun = run.id ?? null;
    }
  }

  // 4: the approved head — the landing owner's status on exactly M^2.
  const combined = await api(`repos/${repository}/commits/${headSha}/status`, { per_page: 100 });
  if (combined?.sha !== headSha) {
    failures.push(
      `the commit-status read for ${headSha} answered for '${combined?.sha ?? 'nothing'}', so the ` +
        `'${REVIEW_CONTEXT}' status on the merged head is not established.`
    );
  } else {
    const statuses = Array.isArray(combined?.statuses) ? combined.statuses : [];
    const review = statuses.find((status) => status?.context === REVIEW_CONTEXT);
    if (!review) {
      failures.push(
        `${headSha} carries no '${REVIEW_CONTEXT}' status. The landing owner sets it on the approved ` +
          'head immediately before merging; a status on any other commit does not count.'
      );
    } else if (review.state !== 'success') {
      failures.push(
        `the '${REVIEW_CONTEXT}' status on ${headSha} is '${review.state}', not success.`
      );
    } else {
      facts.review = review.description ?? 'success';
    }
  }

  // 5: the one pull request this merge belongs to.
  const pulls = await api(`repos/${repository}/commits/${mergeSha}/pulls`, { per_page: 100 });
  const merged = (Array.isArray(pulls) ? pulls : []).filter(
    (pull) => pull?.merge_commit_sha === mergeSha
  );
  if (merged.length !== 1) {
    failures.push(
      `${merged.length} pull request(s) name ${mergeSha} as their merge commit; exactly one must.`
    );
  } else {
    const [pull] = merged;
    facts.pullRequest = pull.number ?? null;
    if (pull?.base?.ref !== DEVELOP) {
      failures.push(
        `pull request #${pull.number} was based on '${pull?.base?.ref}', not ${DEVELOP}.`
      );
    }
    if (pull?.head?.sha !== headSha) {
      failures.push(
        `pull request #${pull.number} records head ${pull?.head?.sha ?? 'unknown'}, but the merge's ` +
          `second parent is ${headSha}.`
      );
    }
  }

  return done();
}

/** A GitHub REST reader over `fetch`. The token is sent, never printed. */
export function githubApi(token, base = 'https://api.github.com') {
  return async (path, query = {}) => {
    const url = new URL(`${base}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
    return response.json();
  };
}

async function main() {
  const repository = process.env.REPOSITORY ?? '';
  const mergeSha = process.env.MERGE_SHA ?? '';
  const token = process.env.GH_TOKEN ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || token === '') {
    console.error('::error::REPOSITORY and GH_TOKEN are required.');
    process.exit(2);
  }
  let verdict;
  try {
    verdict = await checkMergeIntegrity({ repository, mergeSha, api: githubApi(token) });
  } catch (error) {
    console.error(`::error::the integrity check could not read GitHub: ${error.message}`);
    process.exit(2);
  }
  const { facts } = verdict;
  console.log(
    `merge ${facts.merge}\nhead  ${facts.head ?? 'unknown'}\ntree  ${facts.tree ?? 'unknown'}`
  );
  for (const failure of verdict.failures) console.error(`::error::${failure}`);
  if (verdict.ok) {
    console.log(
      `merged, full checkpoint verification pending (pull request #${facts.pullRequest}, ` +
        `PR CI run ${facts.gateRun}, ${REVIEW_CONTEXT}: ${facts.review})`
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = [
      '### Develop merge integrity (TDP-2026-10)',
      '',
      verdict.ok
        ? '**merged, full checkpoint verification pending**'
        : `**FAILED** — ${verdict.failures.length} finding(s)`,
      '',
      '| Item | Value |',
      '| --- | --- |',
      `| Merge commit | \`${facts.merge}\` |`,
      `| Pull-request head (tested and approved) | \`${facts.head ?? 'unknown'}\` |`,
      `| Merge tree | \`${facts.tree ?? 'unknown'}\` |`,
      `| Gate check run | \`${GATE_NAME}\`: ${facts.gateRun ? `success, PR CI run ${facts.gateRun}` : 'not established'} |`,
      `| \`${REVIEW_CONTEXT}\` | ${facts.review ?? 'not established'} |`,
      `| Pull request | ${facts.pullRequest ? `#${facts.pullRequest}` : 'not established'} |`,
      ...verdict.failures.map((failure) => `\n- ${failure}`),
      '',
    ];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${rows.join('\n')}\n`, 'utf8');
  }
  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(2);
  });
}
