#!/usr/bin/env node
/**
 * Change classification for the PR gate (CSA-12).
 *
 * Reads a newline-delimited list of changed paths and answers two questions:
 *
 *   1. Which CATEGORIES of the repository did this pull request touch?
 *   2. Which heavy jobs are therefore REQUIRED to run?
 *
 * Why this is a job and not a workflow `paths:` filter: a required status check
 * that never runs stays **Pending** forever and blocks the merge with no failure
 * to diagnose (CSA-06). The workflow must always run; the *jobs inside it* decide.
 *
 * The output is deliberately explicit about skips. `ci-gate` refuses to accept a
 * skipped job unless this file says that job was not required — so a skip is a
 * recorded decision with a reason, never an absence of evidence.
 *
 * Dependency-free (node: builtins only): it runs before `npm ci`.
 *
 * Usage:
 *   node scripts/ci/classify-changes.mjs --files changed.txt [--json out.json] [--markdown out.md]
 *   git diff --name-only base...head | node scripts/ci/classify-changes.mjs
 *
 * Exit codes: 0 always (classification is not a gate). IO errors exit 2.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Ordered category rules. First match wins, so put the specific patterns first.
 * `test` is a predicate over a repository-relative POSIX path.
 */
export const CATEGORY_RULES = [
  { category: 'workflows', test: (p) => p.startsWith('.github/') },
  // BEFORE `frontend`. `src/app/api/**` is the HTTP surface of the backend, not
  // a page: an authorization-bearing route handler classified as `frontend`
  // would skip `database-security`, which is the job that runs the RLS matrix —
  // exactly the H6 class from P1-21.
  { category: 'backend', test: (p) => p.startsWith('src/app/api/') },
  { category: 'dependencies', test: (p) => p === 'package.json' || p === 'package-lock.json' },
  {
    category: 'docker',
    test: (p) =>
      p === 'Dockerfile' || p === '.dockerignore' || /^docker-compose[.\w-]*\.ya?ml$/.test(p),
  },
  { category: 'database', test: (p) => p.startsWith('supabase/') || p.startsWith('scripts/db/') },
  {
    category: 'openapi',
    test: (p) => p.startsWith('docs/api/') || p.startsWith('src/server/openapi/'),
  },
  {
    category: 'tests',
    test: (p) => p.startsWith('tests/') || /^vitest\.config[.\w-]*\.ts$/.test(p),
  },
  { category: 'ciScripts', test: (p) => p.startsWith('scripts/ci/') },
  { category: 'scripts', test: (p) => p.startsWith('scripts/') },
  {
    category: 'frontend',
    test: (p) => p.startsWith('src/app/') || p.startsWith('src/styles/') || p.endsWith('.scss'),
  },
  { category: 'backend', test: (p) => p.startsWith('src/modules/') || p.startsWith('src/server/') },
  { category: 'appSource', test: (p) => p.startsWith('src/') },
  {
    category: 'config',
    test: (p) =>
      /^(tsconfig|next\.config|eslint\.config|\.prettierrc|\.stylelintrc|\.editorconfig|\.gitattributes)/.test(
        p
      ),
  },
  { category: 'docs', test: (p) => p.startsWith('docs/') || p.endsWith('.md') },
];

export const ALL_CATEGORIES = [...new Set(CATEGORY_RULES.map((r) => r.category)), 'other'];

/**
 * Jobs that ALWAYS run, whatever changed.
 *
 * `hosted-clean-room` is on this list deliberately. It is the single
 * exact-SHA proof the acceptance criteria depend on, and a documentation-only
 * gate pull request is REQUIRED to demonstrate it (initiative §46). A clean room
 * that can be skipped is not a clean room.
 */
export const ALWAYS_REQUIRED = [
  'static-quality',
  'unit-tests-coverage',
  'dependency-security',
  'secret-scan',
  'hosted-clean-room',
];

/**
 * Heavy jobs and the categories that make each one necessary.
 * A job whose trigger set is disjoint from the touched categories is skipped,
 * WITH a recorded reason.
 */
export const CONDITIONAL_JOBS = {
  'application-build': [
    'appSource',
    'frontend',
    'backend',
    'openapi',
    'dependencies',
    'config',
    'docker',
    'workflows',
  ],
  'database-migration-replay': ['database', 'dependencies', 'workflows', 'scripts', 'ciScripts'],
  'database-security': [
    'database',
    'appSource',
    'backend',
    'tests',
    'dependencies',
    'workflows',
    'scripts',
  ],
  'integration-tests': [
    'appSource',
    'backend',
    'frontend',
    'openapi',
    'tests',
    'database',
    'dependencies',
    'workflows',
    'config',
  ],
  'code-security': [
    'appSource',
    'backend',
    'frontend',
    'openapi',
    'tests',
    'scripts',
    'ciScripts',
    'dependencies',
    'workflows',
    'config',
  ],
  'container-security': [
    'docker',
    'dependencies',
    'appSource',
    'backend',
    'frontend',
    'config',
    'workflows',
  ],
};

/** Splits raw text into clean repository-relative paths. */
export function parseFileList(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\\/g, '/'));
}

/** Classifies one path. Returns the first matching category, or `other`. */
export function classifyPath(filePath) {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(filePath)) return rule.category;
  }
  return 'other';
}

/**
 * Full classification.
 *
 * @param {string[]} files repository-relative POSIX paths
 * @returns {{files: string[], counts: Record<string, number>, categories: string[],
 *            documentationOnly: boolean, jobs: Record<string, {required: boolean, reason: string}>}}
 */
export function classify(files) {
  const counts = Object.create(null);
  const byCategory = Object.create(null);
  for (const file of files) {
    const category = classifyPath(file);
    counts[category] = (counts[category] ?? 0) + 1;
    (byCategory[category] ??= []).push(file);
  }
  const categories = Object.keys(counts).sort();

  // "Documentation only" is a strict claim: EVERY touched file is docs. An empty
  // change set is NOT documentation-only — an empty diff is anomalous and must
  // not unlock skips.
  const documentationOnly = files.length > 0 && categories.length === 1 && categories[0] === 'docs';

  const jobs = Object.create(null);
  for (const job of ALWAYS_REQUIRED) {
    jobs[job] = { required: true, reason: 'always required' };
  }
  for (const [job, triggers] of Object.entries(CONDITIONAL_JOBS)) {
    const hits = triggers.filter((t) => counts[t] > 0);
    if (files.length === 0) {
      // Fail SAFE, not fast: an empty or unreadable diff means we do not know
      // what changed, so every job runs.
      jobs[job] = {
        required: true,
        reason: 'empty change set — cannot prove a skip is safe, running everything',
      };
    } else if (counts.other > 0) {
      // A path that matches no rule is a path nobody classified. Skipping on
      // that basis would mean a new root-level `middleware.ts`, `.npmrc`, or
      // config file silently disables six jobs including CodeQL. The same
      // fail-safe as an empty diff, for the same reason.
      jobs[job] = {
        required: true,
        reason: `unclassified path touched (${byCategory.other.slice(0, 3).join(', ')}${
          byCategory.other.length > 3 ? ', …' : ''
        }) — cannot prove a skip is safe`,
      };
    } else if (hits.length > 0) {
      jobs[job] = { required: true, reason: `touched: ${hits.join(', ')}` };
    } else {
      jobs[job] = { required: false, reason: `no change in ${triggers.join(', ')}` };
    }
  }

  return { files, counts, categories, documentationOnly, byCategory, jobs };
}

/** Human-readable summary generated FROM the machine-readable result. */
export function toMarkdown(result) {
  const lines = [];
  lines.push('### Change detection');
  lines.push('');
  lines.push(`- Files changed: **${result.files.length}**`);
  lines.push(
    `- Categories: ${result.categories.length ? result.categories.map((c) => `\`${c}\``).join(', ') : '_none_'}`
  );
  lines.push(`- Documentation only: **${result.documentationOnly ? 'yes' : 'no'}**`);
  lines.push('');
  lines.push('| Job | Decision | Reason |');
  lines.push('| --- | --- | --- |');
  for (const [job, decision] of Object.entries(result.jobs).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    lines.push(`| \`${job}\` | ${decision.required ? 'run' : 'skip'} | ${decision.reason} |`);
  }
  return lines.join('\n');
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const filesArg = arg('--files');
  let raw;
  try {
    raw = filesArg ? readFileSync(filesArg, 'utf8') : readStdin();
  } catch (error) {
    console.error(`cannot read change list: ${error.message}`);
    process.exit(2);
  }

  const result = classify(parseFileList(raw));

  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${toMarkdown(result)}\n`);

  // GitHub Actions outputs: one boolean per conditional job plus the summary flags.
  const outputs = [
    `documentation-only=${result.documentationOnly}`,
    `categories=${result.categories.join(',')}`,
    `file-count=${result.files.length}`,
  ];
  for (const [job, decision] of Object.entries(result.jobs)) {
    outputs.push(`run-${job}=${decision.required}`);
  }
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`, { flag: 'a' });
  }
  for (const line of outputs) console.log(line);
  if (!jsonOut && !mdOut) console.log(toMarkdown(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
