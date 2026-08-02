#!/usr/bin/env node
/**
 * Generated-artefact gate.
 *
 * Build output, dependency trees, coverage reports and browser traces are
 * REPRODUCED from source. Committing one is not merely untidy: it embeds
 * absolute developer paths and per-run timings, so the clean room regenerates
 * it and fails on the shape of its own output. P1-25 paid for this exactly once
 * (`P1-25-F-025`: `apps/web/playwright-report.json` was tracked because
 * `.gitignore` carried the directory `playwright-report/` but not the file).
 *
 * The web topology gate already forbids these under `apps/web`, and the
 * API-backend-only gate under `apps/api`. This one is repository-wide, so a new
 * workspace or a root-level artefact cannot slip between them.
 *
 * It also checks the ignore rules themselves. A path that is untracked today
 * only because nobody happened to run the tool is one `git add -A` away from
 * being tracked tomorrow — which is precisely how P1-25-F-025 happened.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Path segments that are always generated, wherever they appear. */
export const GENERATED_SEGMENTS = [
  'node_modules',
  '.next',
  '.turbo',
  'coverage',
  'test-results',
  'playwright-report',
];

/** Filename patterns that are always generated. */
export const GENERATED_FILE_PATTERNS = [
  { id: 'tsbuildinfo', pattern: /\.tsbuildinfo$/ },
  { id: 'playwright-report-json', pattern: /(^|\/)playwright-report\.json$/ },
  { id: 'vitest-report-json', pattern: /(^|\/)vitest-[a-z]+\.json$/ },
  { id: 'trace', pattern: /\.(?:trace\.zip|webm)$/ },
  { id: 'build-log', pattern: /(^|\/)(?:npm-debug|yarn-error)\.log$/ },
];

/**
 * Ignore rules that must be present in .gitignore, each with the literal lines
 * that satisfy it.
 *
 * Directory rules accept the trailing-slash form, which is the idiomatic and
 * strictly-better spelling for something that is always a directory. File rules
 * accept ONLY the file form: a directory pattern does not cover a file of the
 * same stem, and believing that it did is the whole of P1-25-F-025 —
 * `playwright-report/` was present, `playwright-report.json` was committed.
 */
export const REQUIRED_IGNORES = [
  { id: 'node_modules', accepts: ['node_modules', 'node_modules/', '/node_modules/'] },
  { id: '.next', accepts: ['.next', '.next/', '/.next/'] },
  { id: 'tsbuildinfo', accepts: ['*.tsbuildinfo', '**/*.tsbuildinfo'] },
  { id: 'web playwright report FILE', accepts: ['/apps/web/playwright-report.json'] },
  { id: 'web vitest report FILE', accepts: ['/apps/web/vitest-web.json'] },
  { id: 'web test-results dir', accepts: ['/apps/web/test-results/', 'apps/web/test-results/'] },
  {
    id: 'web playwright-report dir',
    accepts: ['/apps/web/playwright-report/', 'apps/web/playwright-report/'],
  },
];

/** Exactly one lockfile, at the repository root. */
export const LOCKFILE = 'package-lock.json';

/**
 * @param {readonly string[]} files tracked files, repository-relative
 * @param {string | null} gitignore contents of the root .gitignore
 * @returns {{ failures: string[], counts: Record<string, number> }}
 */
export function evaluate(files, gitignore) {
  /** @type {string[]} */
  const failures = [];
  /** @type {Record<string, number>} */
  const counts = { 'tracked files': files.length };

  if (files.length === 0) {
    failures.push(
      'the tracked-file list is empty — the scan examined nothing, which is not a pass'
    );
    return { failures, counts };
  }

  let generated = 0;
  for (const f of files) {
    const segments = f.split('/');
    for (const seg of GENERATED_SEGMENTS) {
      if (segments.includes(seg)) {
        failures.push(`generated path tracked: ${f} (contains "${seg}")`);
        generated += 1;
      }
    }
    for (const rule of GENERATED_FILE_PATTERNS) {
      if (rule.pattern.test(f)) {
        failures.push(`generated file tracked: ${f} (${rule.id})`);
        generated += 1;
      }
    }
  }
  counts['generated tracked'] = generated;

  const lockfiles = files.filter((f) => f.endsWith(LOCKFILE));
  counts['lockfiles'] = lockfiles.length;
  if (!lockfiles.includes(LOCKFILE)) {
    failures.push('the root package-lock.json is not tracked — the workspace has no lockfile');
  }
  for (const f of lockfiles) {
    if (f !== LOCKFILE)
      failures.push(`nested lockfile tracked: ${f} — the root lockfile is the one authority`);
  }

  if (gitignore === null) {
    failures.push('.gitignore is missing — nothing prevents a generated artefact from being added');
  } else {
    const lines = gitignore
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    let present = 0;
    for (const rule of REQUIRED_IGNORES) {
      if (rule.accepts.some((form) => lines.includes(form))) present += 1;
      else
        failures.push(
          `.gitignore no longer ignores ${rule.id} (expected one of: ${rule.accepts.join(', ')})`
        );
    }
    counts['ignore rules present'] = present;
  }

  return { failures, counts };
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z', '--', '.'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);

  let gitignore = null;
  try {
    gitignore = readFileSync('.gitignore', 'utf8');
  } catch {
    gitignore = null;
  }

  const { failures, counts } = evaluate(files, gitignore);

  console.log(
    `Generated artefacts: ${counts['tracked files']} tracked file(s), ` +
      `${counts['lockfiles'] ?? 0} lockfile(s), ${counts['ignore rules present'] ?? 0}/` +
      `${REQUIRED_IGNORES.length} ignore rule(s) present, ${failures.length} failure(s).`
  );

  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nGenerated output is reproduced from source and must never be committed. ' +
        'A tracked run report makes the clean room fail on the shape of its own output.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
