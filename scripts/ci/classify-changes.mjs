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
 * TDP-2026-10 (temporary, Owner-approved 2026-10-05). A pull request INTO
 * `develop` is classified under the `development` profile: the category rules
 * below are unchanged and byte-identical, and an OVERLAY matched on raw paths
 * decides which specialist jobs, which clean-room profile and which records
 * mode the pull request needs. Every other event is `full` and is classified
 * exactly as before. The PR gate also runs the BASE branch's copy of this file
 * and keeps the stricter answer (`--base-classification`).
 *
 * Usage:
 *   node scripts/ci/classify-changes.mjs --files changed.txt [--json out.json] [--markdown out.md]
 *     [--event pull_request --base-ref develop] [--base-classification base.json]
 *   git diff --name-only base...head | node scripts/ci/classify-changes.mjs
 *
 * Exit codes: 0 always (classification is not a gate). IO errors exit 2.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { API_SRC_PATH, API_ROUTES_PATH, WEB_PATH } from '../lib/repository-paths.mjs';
import {
  API_SOURCE_JOBS,
  BASELINE_CONSUMERS,
  DATABASE_JOBS,
  INTEGRATION_TESTS_TRIGGERS,
  MONEY_WEB_GLOBS,
  MONEY_WEB_JOBS,
  RECORDS_FILE_ALLOW_LIST,
  RUN_LEDGER_PATH,
  SERIAL_BLOCK_TRIGGERS,
  TDP_ID,
  WEB_QUALITY_TRIGGERS,
  baseIsComparable,
  decideGateProfile,
  decisionSummary,
  isEscalationPath,
  matchesAny,
  requiresAuthenticatedBrowser,
} from '../lib/development-profile.mjs';

/**
 * Ordered category rules. First match wins, so put the specific patterns first.
 * `test` is a predicate over a repository-relative POSIX path.
 */
export const CATEGORY_RULES = [
  { category: 'workflows', test: (p) => p.startsWith('.github/') },
  // BEFORE `frontend`. The API application's `src/app/api/**` is the HTTP
  // surface of the backend, not a page: an authorization-bearing route handler
  // classified as `frontend` would skip `database-security`, which is the job
  // that runs the RLS matrix — exactly the H6 class from P1-21.
  { category: 'backend', test: (p) => p.startsWith(`${API_ROUTES_PATH}/`) },
  // The web application is frontend in its entirety, including its own scripts
  // and tests, so it is matched before the repository-wide `scripts/` rule.
  { category: 'frontend', test: (p) => p.startsWith(`${WEB_PATH}/`) },
  { category: 'dependencies', test: (p) => p === 'package.json' || p === 'package-lock.json' },
  {
    category: 'docker',
    test: (p) =>
      p === 'Dockerfile' || p === '.dockerignore' || /^docker-compose[.\w-]*\.ya?ml$/.test(p),
  },
  { category: 'database', test: (p) => p.startsWith('supabase/') || p.startsWith('scripts/db/') },
  {
    category: 'openapi',
    test: (p) => p.startsWith('docs/api/') || p.startsWith(`${API_SRC_PATH}/server/openapi/`),
  },
  {
    category: 'tests',
    test: (p) => p.startsWith('tests/') || /^vitest\.config[.\w-]*\.ts$/.test(p),
  },
  { category: 'ciScripts', test: (p) => p.startsWith('scripts/ci/') },
  { category: 'scripts', test: (p) => p.startsWith('scripts/') },
  {
    category: 'frontend',
    test: (p) =>
      p.startsWith(`${API_SRC_PATH}/app/`) ||
      p.startsWith(`${API_SRC_PATH}/styles/`) ||
      p.endsWith('.scss'),
  },
  {
    category: 'backend',
    test: (p) =>
      p.startsWith(`${API_SRC_PATH}/modules/`) || p.startsWith(`${API_SRC_PATH}/server/`),
  },
  { category: 'appSource', test: (p) => p.startsWith(`${API_SRC_PATH}/`) },
  {
    category: 'config',
    test: (p) =>
      /^(tsconfig|next\.config|eslint\.config|\.prettierrc|\.stylelintrc|\.editorconfig|\.gitattributes)/.test(
        p
      ),
  },
  // BEFORE `docs`, and after `openapi` has carved out `docs/api/`. The `docs`
  // rule below is extension-blind: it reads every path under `docs/` as prose.
  // Pull request #409 changed only `docs/user-manual/tools/build-pdf.mjs` — an
  // executable Node script — and was classified documentation-only, so the
  // `code-security` umbrella was SKIPPED on the pull request and CodeQL first
  // saw that file on the merge commit, where a finding is no longer reviewable
  // before merge. An executable under `docs/` is tooling for analysis purposes,
  // whatever directory it sits in.
  //
  // Deliberately NOT the existing `scripts` category: `scripts` also triggers
  // `database-migration-replay` and `database-security`, which a PDF-builder
  // edit has no reason to run. This category triggers `code-security` and
  // nothing else — the narrowest correction that closes the gap. Genuinely
  // non-executable documentation keeps its documentation-only treatment.
  {
    category: 'docsTooling',
    test: (p) =>
      p.startsWith('docs/') && /\.(mjs|cjs|js|ts|tsx|mts|cts|py|ps1|sh|bat|cmd)$/i.test(p),
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
    // An executable under `docs/` is analysed like any other executable. It is
    // on THIS list and on no other: a documentation tool builds nothing, runs
    // no migration and reaches no database. See the `docsTooling` rule above.
    'docsTooling',
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
 * Without options — and for every event that is not a pull request into
 * `develop` — this is the classification `main` has always had: the same jobs
 * object, the same reasons. The `development` profile is an overlay on top of
 * it (`classifyDevelopment` below), never a change to it.
 *
 * @param {string[]} files repository-relative POSIX paths
 * @param {{event?: string, baseRef?: string}} [options]
 * @returns {{files: string[], counts: Record<string, number>, categories: string[],
 *            documentationOnly: boolean, jobs: Record<string, {required: boolean, reason: string}>}}
 */
export function classify(files, options = {}) {
  const full = classifyFull(files);
  const profile = decideGateProfile(options);
  if (profile !== 'development') {
    return {
      ...full,
      profile: 'full',
      escalated: false,
      cleanRoomProfile: 'full',
      runDatabaseBlock: true,
      runContainerBlock: true,
      recordsMode: 'strict',
      recordsOnly: isRecordsOnly(files),
    };
  }
  return classifyDevelopment(files, full);
}

/** The classification `main` has always used. Unchanged. */
function classifyFull(files) {
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

/** Whether every changed path is a checkpoint records file (computed, never asserted). */
export function isRecordsOnly(files) {
  return files.length > 0 && files.every((file) => matchesAny(file, RECORDS_FILE_ALLOW_LIST));
}

/** The jobs the development profile decides. ALWAYS_REQUIRED is outside this list. */
export const DEVELOPMENT_CONDITIONAL_JOBS = Object.freeze([
  ...Object.keys(CONDITIONAL_JOBS),
  'web-quality',
  'authenticated-browser',
]);

/**
 * TDP-2026-10: the development-profile overlay for a pull request into develop.
 *
 * ESCALATION first: an empty diff, an unclassified path, a workflow, an action,
 * a gate script, a dependency manifest, a build or test configuration, or an
 * unmapped `.github` path makes EVERY job required and the clean room full.
 *
 * Otherwise a job is required when the category table above already requires it
 * for a non-`.github` path (so the development profile never runs LESS than
 * `main` would for those paths), when a `.github/ci-baselines/<file>` names it as
 * a consumer, or when a specialist trigger in `scripts/lib/development-profile.mjs`
 * fires. Only `web-quality`, `authenticated-browser` and the clean room's
 * profile and serial blocks are new decisions; the rest is the table above.
 */
export function classifyDevelopment(files, full = classifyFull(files)) {
  const escalations = [];
  if (files.length === 0) escalations.push('empty change set');
  for (const file of files) {
    if (isEscalationPath(file)) {
      escalations.push(`${file} is an escalation path`);
    } else if (file.startsWith('.github/ci-baselines/')) {
      const name = file.slice('.github/ci-baselines/'.length);
      if (!Object.hasOwn(BASELINE_CONSUMERS, name)) {
        escalations.push(`${file} is a baseline with no mapped consumer`);
      }
    } else if (file.startsWith('.github/')) {
      escalations.push(`${file} is an unmapped .github path`);
    } else if (classifyPath(file) === 'other') {
      escalations.push(`${file} is an unclassified path`);
    }
  }

  const base = {
    ...full,
    profile: 'development',
    policy: TDP_ID,
    recordsMode: files.includes(RUN_LEDGER_PATH) ? 'strict' : 'checkpoint-deferred',
    recordsOnly: isRecordsOnly(files),
  };

  const jobs = Object.create(null);
  for (const job of ALWAYS_REQUIRED) jobs[job] = { required: true, reason: 'always required' };

  if (escalations.length > 0) {
    const why = `escalated to the full set — ${escalations.slice(0, 3).join('; ')}${
      escalations.length > 3 ? '; …' : ''
    }`;
    for (const job of DEVELOPMENT_CONDITIONAL_JOBS) jobs[job] = { required: true, reason: why };
    return {
      ...base,
      jobs,
      escalated: true,
      escalationReasons: escalations,
      cleanRoomProfile: 'full',
      runDatabaseBlock: true,
      runContainerBlock: true,
    };
  }

  const reasons = Object.create(null);
  const need = (job, why) => {
    (reasons[job] ??= new Set()).add(why);
  };
  let databaseBlock = false;
  for (const file of files) {
    if (file.startsWith('.github/ci-baselines/')) {
      const name = file.slice('.github/ci-baselines/'.length);
      const consumer = BASELINE_CONSUMERS[name];
      // Every mapped baseline is a validation input: the unit tier (always run)
      // and the web tier read them.
      need('web-quality', `validation input ${name}`);
      for (const job of consumer.jobs) need(job, `baseline ${name}`);
      if (consumer.databaseBlock) databaseBlock = true;
      continue;
    }
    const category = classifyPath(file);
    for (const [job, triggers] of Object.entries(CONDITIONAL_JOBS)) {
      if (triggers.includes(category)) need(job, `touched: ${category}`);
    }
    if (matchesAny(file, WEB_QUALITY_TRIGGERS)) need('web-quality', 'web-quality trigger');
    if (requiresAuthenticatedBrowser(file)) {
      need('authenticated-browser', 'authenticated-browser trigger');
    }
    if (matchesAny(file, SERIAL_BLOCK_TRIGGERS)) databaseBlock = true;
    if (matchesAny(file, INTEGRATION_TESTS_TRIGGERS)) {
      need('integration-tests', 'integration-tests trigger');
    }
    if (file.startsWith(`${API_SRC_PATH}/`)) {
      for (const job of API_SOURCE_JOBS) need(job, 'API source');
    }
    if (file.startsWith('supabase/')) {
      for (const job of DATABASE_JOBS) need(job, 'migrations, seeds or RLS');
    }
    if (matchesAny(file, MONEY_WEB_GLOBS)) {
      for (const job of MONEY_WEB_JOBS) need(job, 'money screens');
    }
  }

  for (const job of DEVELOPMENT_CONDITIONAL_JOBS) {
    const why = reasons[job];
    jobs[job] = why
      ? { required: true, reason: [...why].sort().join(', ') }
      : { required: false, reason: 'no development-profile trigger touched' };
  }

  return {
    ...base,
    jobs,
    escalated: false,
    escalationReasons: [],
    cleanRoomProfile: 'development',
    runDatabaseBlock: databaseBlock,
    runContainerBlock: jobs['container-security'].required,
  };
}

/**
 * Keeps the STRICTER of the head's and the base's decisions.
 *
 * The head's copy of this classifier is code the pull request may have edited,
 * so it is never trusted alone: the base branch's copy classifies the same diff
 * and every job, block and profile takes the stricter answer. A base copy that
 * is missing, that failed, or that predates the development profile cannot be
 * compared, and that resolves to the FULL set and STRICT run records rather
 * than to the head's answer.
 *
 * Both decisions are recorded in the result, and `ci-gate` checks they are
 * present and that this result really is their union.
 */
export function keepStricter(head, base, { baseAvailable = true, baseNote = '' } = {}) {
  const headDecision = decisionSummary(head);
  if (head.profile !== 'development') {
    // A full-profile run is already the strictest classification there is.
    return { ...head, decisions: { head: headDecision, base: decisionSummary(base) } };
  }
  const comparable = baseAvailable && baseIsComparable(base);
  const jobs = Object.create(null);
  if (!comparable) {
    const why =
      `escalated to the full set — the base branch classification is unavailable` +
      `${baseNote ? ` (${baseNote})` : ''}, so the head's answer is not trusted alone`;
    for (const [job, decision] of Object.entries(head.jobs)) {
      jobs[job] = decision.required ? decision : { required: true, reason: why };
    }
    return {
      ...head,
      jobs,
      escalated: true,
      escalationReasons: [...(head.escalationReasons ?? []), why],
      cleanRoomProfile: 'full',
      runDatabaseBlock: true,
      runContainerBlock: true,
      // Fail closed. The base copy has no records mode to vote with, and the
      // head's answer is the one thing this branch refuses to trust alone — a
      // head that edited its own classifier could defer its own record drift.
      recordsMode: 'strict',
      // Nor can the head alone certify that it is a records-only change.
      recordsOnly: false,
      decisions: {
        head: headDecision,
        base: { available: false, note: baseNote || 'not comparable' },
      },
    };
  }
  const allJobs = new Set([...Object.keys(head.jobs), ...Object.keys(base.jobs)]);
  for (const job of allJobs) {
    const h = head.jobs[job];
    const b = base.jobs[job];
    const required = Boolean(h?.required) || Boolean(b?.required) || !h || !b;
    const reason =
      h?.required || !b
        ? (h?.reason ?? 'required by the base classification')
        : b?.required
          ? `required by the base classification (${b.reason})`
          : !h
            ? 'the head classification made no decision'
            : h.reason;
    jobs[job] = { required, reason };
  }
  const stricterRoom =
    head.cleanRoomProfile === 'full' || base.cleanRoomProfile === 'full' ? 'full' : 'development';
  return {
    ...head,
    jobs,
    escalated: Boolean(head.escalated) || Boolean(base.escalated) || head.profile !== base.profile,
    cleanRoomProfile: head.profile !== base.profile ? 'full' : stricterRoom,
    runDatabaseBlock: Boolean(head.runDatabaseBlock) || Boolean(base.runDatabaseBlock),
    runContainerBlock: Boolean(head.runContainerBlock) || Boolean(base.runContainerBlock),
    recordsMode:
      head.recordsMode === 'strict' || base.recordsMode === 'strict'
        ? 'strict'
        : 'checkpoint-deferred',
    recordsOnly: Boolean(head.recordsOnly) && Boolean(base.recordsOnly),
    decisions: { head: headDecision, base: { available: true, ...decisionSummary(base) } },
  };
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
  if (result.profile === 'development') {
    lines.push(
      `- Profile: **development** (${result.policy ?? 'TDP-2026-10'}, temporary) — clean room ` +
        `**${result.cleanRoomProfile}**, serial database block **${result.runDatabaseBlock ? 'yes' : 'no'}**, ` +
        `container block **${result.runContainerBlock ? 'yes' : 'no'}**, records **${result.recordsMode}**`
    );
    if (result.escalated) {
      lines.push(
        `- Escalated to the full set: ${(result.escalationReasons ?? []).slice(0, 5).join('; ')}`
      );
    }
    if (result.decisions) {
      lines.push(
        `- Base-branch classification: **${result.decisions.base?.available === false ? 'unavailable — escalated to full' : 'compared; the stricter answer is kept'}**`
      );
    }
  } else if (result.profile === 'full') {
    lines.push('- Profile: **full**');
  }
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

/** A base classification that cannot be read is treated as absent, never as permissive. */
function readBaseClassification(path) {
  try {
    return path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
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

  const files = parseFileList(raw);
  const head = classify(files, { event: arg('--event'), baseRef: arg('--base-ref') });
  const result = argv.includes('--base-classification')
    ? keepStricter(head, readBaseClassification(arg('--base-classification')), {
        baseAvailable: existsSync(arg('--base-classification') ?? ''),
        baseNote: existsSync(arg('--base-classification') ?? '')
          ? ''
          : 'the base copy of the classifier could not be run',
      })
    : head;

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
  outputs.push(
    `profile=${result.profile}`,
    `clean-room-profile=${result.cleanRoomProfile}`,
    `run-database-block=${result.runDatabaseBlock}`,
    `run-container-block=${result.runContainerBlock}`,
    `records-mode=${result.recordsMode}`,
    `records-only=${result.recordsOnly}`
  );
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`, { flag: 'a' });
  }
  for (const line of outputs) console.log(line);
  if (!jsonOut && !mdOut) console.log(toMarkdown(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
