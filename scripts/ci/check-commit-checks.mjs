#!/usr/bin/env node
/**
 * Enumerates EVERY check-run on a commit, not just the Actions workflow runs.
 *
 * This exists because of AR-52. The previous initiative reported five
 * consecutive heads as "PR CI 14/14 green" while a `CodeQL` check produced by
 * GitHub Advanced Security sat **red** on every one of them. The report was not
 * careless — it was reading `/actions/runs`, which lists workflow runs and
 * their conclusions. The GHAS check belongs to no workflow run, so that endpoint
 * never mentions it. The commit carried 19 checks; the run listed 14 jobs.
 *
 * The only endpoint that sees everything is `/commits/{sha}/check-runs`.
 *
 * This does not run inside the pipeline it judges — a run cannot enumerate the
 * checks of the commit it is still producing. It is a pre-merge instrument, run
 * against the exact head with an authenticated token.
 *
 * NO TOKEN IS EVER PRINTED. It is read from GH_TOKEN/GITHUB_TOKEN and used only
 * as an Authorization header.
 *
 * Exit codes: 0 every check succeeded · 1 something is red, pending or
 * cancelled · 2 the check could not be performed.
 *
 * Usage:
 *   node scripts/ci/check-commit-checks.mjs --repo owner/name --sha <full-sha> \
 *     [--json out.json] [--markdown out.md] [--require CodeQL --require ci-gate]
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Conclusions that are acceptable for a check that ran. */
export const ACCEPTABLE = Object.freeze(['success', 'skipped', 'neutral']);

/**
 * Bounds a string that arrived over HTTP before it is written to a report.
 *
 * Check names, titles and app slugs come from the GitHub API, and this script's
 * output is a build artifact a human reads and a later job may parse. CodeQL
 * flagged the write as `js/http-to-file-access` on this gate's very first run —
 * the gate catching a finding in the gate — and it was right to: nothing bounded
 * the length, and a control character or an ANSI escape in a check name would
 * have gone straight into a Markdown table and a terminal.
 *
 * Not a claim that GitHub is hostile. It is that a report should be a report
 * whatever the API returns, and "the source is trusted" is the reasoning this
 * repository has already been wrong about twice.
 */
export function safeText(value, max = 200) {
  if (value === null || value === undefined) return '';
  const text = String(value)
    // Control characters, including the ESC that starts an ANSI sequence.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    // BACKSLASH FIRST, then pipe. The other order is the defect CodeQL
    // reported as `js/incomplete-sanitization` the first time this function
    // ran: escaping `|` as `\|` without escaping `\` first means the input
    // `\|` becomes `\\|`, which Markdown renders as a literal backslash
    // followed by a LIVE cell separator — so the escaper hands back exactly
    // what it was added to prevent. An escaper that runs in the wrong order
    // is worse than none, because it looks handled.
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Classifies the complete check-run list.
 *
 * `skipped` and `neutral` are acceptable; `null` (still running) is NOT, because
 * a merge decision taken while a check is in flight is a decision taken without
 * it.
 */
/**
 * @param {any[]} checkRuns  the `check_runs` array from /commits/{sha}/check-runs
 * @param {{ required?: string[] }} [options]
 * @returns {{ ok: boolean, failures: string[], warnings: string[],
 *             checks: Array<{name: string, status: string, conclusion: string|null,
 *                            app: string|null, title: string|null, url: string|null}>,
 *             nonActions?: any[] }}
 */
export function evaluate(checkRuns, { required = [] } = {}) {
  const failures = [];
  const warnings = [];

  if (!Array.isArray(checkRuns)) {
    return { ok: false, failures: ['the check-run list was not an array'], warnings, checks: [] };
  }
  if (checkRuns.length === 0) {
    return {
      ok: false,
      failures: [
        'the commit carries ZERO check-runs. Nothing has judged it, which is not the same as nothing objecting.',
      ],
      warnings,
      checks: [],
    };
  }

  const checks = checkRuns
    .map((run) => ({
      name: safeText(run.name, 200),
      status: safeText(run.status, 40),
      conclusion:
        run.conclusion === null || run.conclusion === undefined
          ? null
          : safeText(run.conclusion, 40),
      app: run.app?.slug === undefined ? null : safeText(run.app?.slug, 100),
      title: run.output?.title === undefined ? null : safeText(run.output?.title, 300),
      url: safeText(run.html_url, 500),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const check of checks) {
    if (check.status !== 'completed') {
      failures.push(
        `check \`${check.name}\` is ${check.status}, not completed. A merge taken now is taken without it.`
      );
      continue;
    }
    if (!ACCEPTABLE.includes(check.conclusion ?? '')) {
      failures.push(
        `check \`${check.name}\` concluded \`${check.conclusion}\`` +
          (check.title ? ` — ${check.title}` : '') +
          (check.app ? ` (produced by ${check.app})` : '')
      );
    }
  }

  // A required check that is ABSENT is the CSA-06 shape: it never ran, so it
  // never objected, and nothing says so.
  for (const name of required) {
    if (!checks.some((check) => check.name === name)) {
      failures.push(
        `required check \`${name}\` is absent from the commit entirely. ` +
          'A check that never ran cannot have passed.'
      );
    }
  }

  // The whole point of this script: prove more than the Actions runs were seen.
  const nonActions = checks.filter((check) => check.app && check.app !== 'github-actions');
  if (nonActions.length === 0) {
    warnings.push(
      'every check on this commit came from GitHub Actions. That may be correct, but AR-52 was a ' +
        'check from another app — so this is reported rather than assumed.'
    );
  }

  return { ok: failures.length === 0, failures, warnings, checks, nonActions };
}

export function toMarkdown(result, sha) {
  const lines = [`### Commit check-runs — \`${(sha ?? '').slice(0, 7)}\``, ''];
  lines.push(`Enumerated **${result.checks.length}** check-run(s) on the commit.`);
  lines.push('');
  lines.push('| Conclusion | Check | Produced by |');
  lines.push('| --- | --- | --- |');
  for (const check of result.checks) {
    lines.push(`| ${check.conclusion ?? check.status} | \`${check.name}\` | ${check.app ?? '—'} |`);
  }
  lines.push('');
  if (result.failures.length > 0) {
    lines.push('**Failures**', '');
    for (const failure of result.failures) lines.push(`- ❌ ${failure}`);
    lines.push('');
  }
  for (const warning of result.warnings) lines.push(`> ⚠️ ${warning}`);
  if (result.warnings.length > 0) lines.push('');
  lines.push(
    `Checks from apps other than GitHub Actions: **${result.nonActions?.length ?? 0}** — ` +
      'these are exactly the ones a workflow-run listing cannot see.'
  );
  lines.push('');
  lines.push(`**Commit checks: ${result.ok ? 'Go' : 'No-Go'}**`);
  return lines.join('\n');
}

async function main(argv) {
  const values = (name) =>
    argv.reduce((out, arg, index) => (arg === name ? [...out, argv[index + 1]] : out), []);
  const one = (name) => values(name)[0];

  const repo = one('--repo');
  const sha = one('--sha');
  if (!repo || !sha) {
    console.error('usage: check-commit-checks.mjs --repo owner/name --sha <full-sha>');
    process.exit(2);
  }

  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(
      'no GH_TOKEN/GITHUB_TOKEN. The check-run list needs an authenticated read; refusing to ' +
        'report a verdict this gate cannot support.'
    );
    process.exit(2);
  }

  // PAGINATE. A single `per_page=100` request silently truncates at 100, and a
  // truncated listing is precisely the failure this script exists to prevent:
  // the missing page would look exactly like a commit with nothing else
  // watching it. The commit this was written against already carried 19 checks.
  const checkRuns = [];
  let expectedTotal = null;
  try {
    for (let page = 1; page <= 20; page += 1) {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
      if (!response.ok) {
        // Print enough sanitized context to diagnose, never the token.
        const body = await response.text();
        console.error(
          `check-run listing failed on page ${page}: HTTP ${response.status} ${response.statusText} — ${body.slice(0, 300)}`
        );
        process.exit(2);
      }
      const payload = await response.json();
      const batch = payload.check_runs ?? [];
      if (page === 1) expectedTotal = payload.total_count ?? null;
      checkRuns.push(...batch);
      if (batch.length < 100) break;
    }
  } catch (error) {
    console.error(`check-run listing could not be fetched: ${error.message}`);
    process.exit(2);
  }

  // The API tells us how many there are. If we did not collect that many, the
  // listing is incomplete and no verdict from it is trustworthy.
  if (typeof expectedTotal === 'number' && checkRuns.length !== expectedTotal) {
    console.error(
      `check-run listing is incomplete: the API reports ${expectedTotal} check(s) and ` +
        `${checkRuns.length} were collected. Refusing to judge a partial list.`
    );
    process.exit(2);
  }

  const result = evaluate(checkRuns, { required: values('--require') });
  const markdown = toMarkdown(result, sha);

  const jsonOut = one('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ sha, ...result }, null, 2)}\n`);
  const mdOut = one('--markdown');
  if (mdOut) writeFileSync(mdOut, `${markdown}\n`);
  console.log(markdown);

  for (const failure of result.failures) console.log(`::error::${failure}`);
  // `exitCode` rather than `exit()`: calling exit() while a fetch keep-alive
  // handle is still closing trips a libuv assertion on Windows and prints an
  // alarming line after a perfectly good verdict.
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
