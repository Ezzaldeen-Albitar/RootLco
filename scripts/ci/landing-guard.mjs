#!/usr/bin/env node
/**
 * The landing guard: the one step a pull request's landing owner runs before
 * merging into `develop`.
 *
 * ## Why
 *
 * Owner instruction 2026-10-06: one explicit landing owner per pull request,
 * and an assigned-PR / approved-head check before any merge. Two workers
 * acting on one pull request, or one worker merging a head nobody reviewed,
 * is the failure this prevents.
 *
 * ## What it does
 *
 *   node scripts/ci/landing-guard.mjs --pr <number> --approved-head <40-hex sha> [--mark-reviewed]
 *
 * It REFUSES (exit 1) unless the pull request is open, not a draft, based on
 * `develop`, and its current head is exactly the approved head. With
 * `--mark-reviewed` it then sets the `independent-review` commit status to
 * `success` on that head, and re-reads the pull request to prove the head did
 * not move while it did so. The landing owner then merges at once, pinned to the
 * same head:
 *
 *   gh pr merge <number> --merge --match-head-commit <approved head>
 *
 * `.github/workflows/develop-merge-integrity.yml` fails any merge into `develop`
 * whose second parent lacks that status, so a merge that skipped this step, or
 * merged a head other than the one marked, is reported rather than absorbed.
 * The status is in no ruleset (the rulesets are unchanged by this step).
 *
 * ## Why repository tooling, not orchestration tooling
 *
 * The status this sets is read by a workflow in this repository; the setter
 * and the reader share one context name and must be reviewed, versioned and
 * tested together, by the same gate. Orchestration tooling lives outside the
 * repository, where no pull request reviews it and no test runs it. Any
 * landing owner — a person or a worker — can run this from a checkout.
 *
 * GH_TOKEN must hold a token allowed to read pull requests and write commit
 * statuses. It is sent to the GitHub API and never printed.
 *
 * Exit codes: 0 guard passed (and status set, when asked) · 1 refused · 2 usage or API error.
 */
import { pathToFileURL } from 'node:url';

export const REVIEW_CONTEXT = 'independent-review';
export const DEVELOP = 'develop';
const SHA = /^[0-9a-f]{40}$/;

export class LandingRefused extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'LandingRefused';
  }
}

/**
 * @param {string[]} argv
 * @returns {{ pr: number, approvedHead: string, markReviewed: boolean, repository: string }}
 */
export function parseArguments(argv, env = process.env) {
  const options = { pr: NaN, approvedHead: '', markReviewed: false, repository: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const take = () => {
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      index += 1;
      return value;
    };
    if (flag === '--pr') options.pr = /^\d+$/.test(take()) ? Number(value) : NaN;
    else if (flag === '--approved-head') options.approvedHead = take().toLowerCase();
    else if (flag === '--repo') options.repository = take();
    else if (flag === '--mark-reviewed') options.markReviewed = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!options.repository)
    options.repository = env.GITHUB_REPOSITORY ?? 'Ezzaldeen-Albitar/RootLco';
  if (!Number.isInteger(options.pr) || options.pr < 1) throw new Error('--pr <number> is required');
  if (!SHA.test(options.approvedHead)) {
    throw new Error('--approved-head must be the full 40-character head SHA that was approved');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository)) throw new Error('--repo must be owner/name');
  return options;
}

/**
 * The refusal rules, on a pull-request object as the REST API returns it.
 *
 * @param {any} pull
 * @param {{ pr: number, approvedHead: string }} expected
 * @returns {string[]} every reason to refuse; empty means the guard passes
 */
export function landingRefusals(pull, { pr, approvedHead }) {
  const reasons = [];
  if (pull?.number !== pr) reasons.push(`the API answered for #${pull?.number}, not #${pr}`);
  if (pull?.state !== 'open' || pull?.merged === true) {
    reasons.push(`#${pr} is ${pull?.merged ? 'already merged' : `'${pull?.state}'`}, not open`);
  }
  if (pull?.draft === true) reasons.push(`#${pr} is a draft`);
  if (pull?.base?.ref !== DEVELOP) {
    reasons.push(`#${pr} is based on '${pull?.base?.ref}', not ${DEVELOP}`);
  }
  if (pull?.head?.sha !== approvedHead) {
    reasons.push(
      `#${pr} head is ${pull?.head?.sha ?? 'unknown'}, not the approved head ${approvedHead}; ` +
        'a head nobody approved is not merged'
    );
  }
  return reasons;
}

/**
 * @param {{ pr: number, approvedHead: string, markReviewed: boolean, repository: string }} options
 * @param {(method: string, path: string, body?: unknown) => Promise<any>} api
 * @returns {Promise<{ statusSet: boolean }>}
 */
export async function runLandingGuard(options, api) {
  const { repository, pr, approvedHead } = options;
  const path = `repos/${repository}/pulls/${pr}`;
  const before = landingRefusals(await api('GET', path), options);
  if (before.length > 0) throw new LandingRefused(before.join('; '));
  if (!options.markReviewed) return { statusSet: false };

  await api('POST', `repos/${repository}/statuses/${approvedHead}`, {
    state: 'success',
    context: REVIEW_CONTEXT,
    description: `Landing owner approved head ${approvedHead.slice(0, 12)} of #${pr}`,
  });

  // The head may have moved between the read and the write. The status then
  // sits on a commit that will not be merged, which the integrity check
  // ignores — but the landing owner must not go on to merge.
  const after = landingRefusals(await api('GET', path), options);
  if (after.length > 0) {
    throw new LandingRefused(
      `the pull request changed while it was being marked: ${after.join('; ')}`
    );
  }
  return { statusSet: true };
}

/** A GitHub REST client over `fetch`. The token is sent, never printed. */
export function githubApi(token, base = 'https://api.github.com') {
  return async (method, path, body) => {
    const response = await fetch(`${base}/${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}`);
    return response.json();
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`landing guard: ${error.message}`);
    process.exit(2);
  }
  const token = process.env.GH_TOKEN ?? '';
  if (token === '') {
    console.error('landing guard: GH_TOKEN is required');
    process.exit(2);
  }
  try {
    const { statusSet } = await runLandingGuard(options, githubApi(token));
    console.log(
      `landing guard: #${options.pr} is open, based on ${DEVELOP}, at the approved head ${options.approvedHead}` +
        (statusSet ? `; '${REVIEW_CONTEXT}' set to success on it` : ' (no status set)')
    );
  } catch (error) {
    if (error instanceof LandingRefused) {
      console.error(`landing guard REFUSED: ${error.message}`);
      process.exit(1);
    }
    console.error(`landing guard: ${error.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
