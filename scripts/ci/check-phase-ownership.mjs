#!/usr/bin/env node
/**
 * Phase changed-file ownership gate.
 *
 * A phase declares which parts of the repository it is allowed to touch, and
 * this proves the branch honoured that declaration. It exists because the
 * expensive failure mode is not a broken build — it is a Backend or Database
 * change riding inside a Frontend phase, where nobody reviews it as Backend and
 * no Backend gate is triggered by it.
 *
 * ## Profiles
 *
 * `p1-26-frontend` is the one P1-26 will run under: a Frontend phase may change
 * `apps/web`, its own tests, its documentation and the repository tooling it
 * needs — and must change no API source, no Supabase, and no migration.
 *
 * `api-boundary` is the profile of the pre-P1-26 remediation itself, which is
 * the mirror image: it may change API and tooling, and must not change web
 * runtime source. Declaring it lets THIS branch run the gate against itself,
 * so the mechanism is proven by use before the phase that depends on it starts,
 * rather than being a check that has never once executed.
 *
 * ## Every changed file must classify
 *
 * An unclassified file is a failure, not a shrug. The point of the gate is that
 * somebody decided where each change belongs; a file nobody predicted is
 * exactly the one worth looking at.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Ordered classification rules. FIRST match wins, so the specific
 * `apps/api/src/app/api/**` case is stated before the general `apps/api/**`.
 */
export const CLASSIFIERS = [
  { bucket: 'web', test: (p) => p.startsWith('apps/web/') },
  { bucket: 'apiSource', test: (p) => p.startsWith('apps/api/src/') },
  { bucket: 'apiConfig', test: (p) => p.startsWith('apps/api/') },
  { bucket: 'migrations', test: (p) => p.startsWith('supabase/migrations/') },
  { bucket: 'supabase', test: (p) => p.startsWith('supabase/') },
  { bucket: 'docs', test: (p) => p.startsWith('docs/') || /^[A-Z]+\.md$/.test(p) },
  { bucket: 'tooling', test: (p) => p.startsWith('scripts/') || p.startsWith('.github/') },
  { bucket: 'tests', test: (p) => p.startsWith('tests/') },
  {
    bucket: 'rootConfig',
    test: (p) =>
      !p.includes('/') ||
      p.startsWith('.vscode/') ||
      p === 'Dockerfile' ||
      p === 'docker-compose.yml',
  },
];

/** What each profile permits. Anything not listed is forbidden. */
export const PROFILES = {
  'p1-26-frontend': {
    why: 'P1-26 is a Frontend phase',
    allowed: ['web', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      apiSource:
        'a Frontend phase must not change API source — route it through a Backend remediation',
      apiConfig: 'a Frontend phase must not change API workspace configuration',
      migrations: 'a Frontend phase must not change a migration',
      supabase: 'a Frontend phase must not change the database',
    },
  },
  'api-boundary': {
    why: 'the pre-P1-26 API file-boundary remediation',
    allowed: ['apiSource', 'apiConfig', 'docs', 'tooling', 'tests', 'rootConfig', 'web'],
    forbidden: {
      migrations: 'the boundary remediation must not change a migration',
      supabase: 'the boundary remediation must not change the database',
    },
  },
};

/**
 * @param {string} path
 * @returns {string} bucket name, or 'unclassified'
 */
export function classify(path) {
  for (const rule of CLASSIFIERS) if (rule.test(path)) return rule.bucket;
  return 'unclassified';
}

/**
 * @param {readonly string[]} changed changed files vs the phase base
 * @param {string} profileName
 * @returns {{ failures: string[], counts: Record<string, number> }}
 */
export function evaluate(changed, profileName) {
  /** @type {string[]} */
  const failures = [];
  /** @type {Record<string, number>} */
  const counts = {};

  const profile = PROFILES[profileName];
  if (!profile) {
    return { failures: [`unknown ownership profile: ${profileName}`], counts };
  }

  for (const bucket of Object.keys(PROFILES[profileName].forbidden)) counts[bucket] = 0;
  for (const bucket of profile.allowed) counts[bucket] = 0;
  counts.unclassified = 0;
  counts.changed = changed.length;

  // Anti-vacuity. Every rule below iterates the changed set, so an empty set
  // passes every rule having judged nothing — indistinguishable from a diff
  // that silently produced no output because the base ref was wrong. A phase
  // branch under review always has changes; zero means the measurement failed,
  // not that the branch is clean.
  if (changed.length === 0) {
    failures.push(
      'no changed files were found against the base — a phase branch under review always has ' +
        'changes, so this is a broken comparison rather than a clean result'
    );
    return { failures, counts };
  }

  for (const path of changed) {
    const bucket = classify(path);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    if (bucket === 'unclassified') {
      failures.push(`unclassified changed file: ${path} — decide where it belongs`);
      continue;
    }
    const forbidden = profile.forbidden[bucket];
    if (forbidden) failures.push(`${bucket}: ${path} — ${forbidden}`);
  }

  return { failures, counts };
}

function main() {
  const profileName = process.argv[2] ?? 'p1-26-frontend';
  const base = process.argv[3] ?? 'origin/develop';

  let changed = [];
  try {
    changed = execFileSync(
      'git',
      ['diff', '--name-only', '-M', '--diff-filter=ACMRD', `${base}...HEAD`],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (error) {
    console.error(
      `could not diff against ${base}: ${error instanceof Error ? error.message : error}`
    );
    process.exit(2);
  }

  const { failures, counts } = evaluate(changed, profileName);
  const profile = PROFILES[profileName];

  console.log(
    `Phase ownership [${profileName}${profile ? ` — ${profile.why}` : ''}] vs ${base}: ` +
      `${counts.changed ?? 0} changed file(s), ${failures.length} violation(s).`
  );
  const shown = Object.entries(counts)
    .filter(([k, v]) => k !== 'changed' && v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ');
  if (shown) console.log(`  ${shown}`);

  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nA phase changes what it declared it would change. A Backend or Database ' +
        'change riding inside another phase is reviewed by nobody and gated by nothing.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
