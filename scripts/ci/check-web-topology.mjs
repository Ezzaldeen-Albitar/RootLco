#!/usr/bin/env node
/**
 * Web topology gate.
 *
 * P1-25's remediation moved the App Router from `apps/web/app/` to
 * `apps/web/src/app/` and the CSP middleware to Next 16's `src/proxy.ts`
 * convention. This gate makes that topology permanent: it fails the build if
 * the router grows a second root, if a deprecated `middleware` file reappears
 * beside `proxy.ts`, if a nested lockfile or a generated artefact gets
 * tracked, or if a second brand/token authority is created.
 *
 * Two design rules, both bought with real defects:
 *
 *   1. **Every expectation is counted.** A check that matches zero files fails
 *      unless zero is explicitly the expectation. PR #161 exists because a
 *      documented check named `apps/web/src/app/` when no such directory
 *      existed — it could never fail, and it read as evidence anyway.
 *   2. **The gate is a pure function of the tracked-file list plus a reader**,
 *      so the mutation tests in `tests/ci/web-topology.test.ts` can prove it
 *      fails on each violation without touching the working tree.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const WEB = 'apps/web';

/** Directories that must exist (≥1 tracked file) — the canonical topology. */
export const REQUIRED_PREFIXES = [
  `${WEB}/src/app/`,
  `${WEB}/src/components/`,
  `${WEB}/src/config/`,
  `${WEB}/src/i18n/`,
  `${WEB}/src/lib/`,
  `${WEB}/src/styles/tokens/`,
  `${WEB}/src/styles/themes/`,
  `${WEB}/public/`,
  `${WEB}/tests/`,
  `${WEB}/tests/e2e/`,
];

/** Files that must exist, exactly once, at exactly this path. */
export const REQUIRED_FILES = [
  `${WEB}/src/proxy.ts`,
  `${WEB}/src/config/brand.ts`,
  `${WEB}/src/styles/tokens/_colors.scss`,
  `${WEB}/next.config.ts`,
  `${WEB}/package.json`,
  `${WEB}/tsconfig.json`,
];

/** Prefixes that must match NOTHING — competing roots and stale conventions. */
export const FORBIDDEN_PREFIXES = [
  `${WEB}/app/`, //           the pre-remediation router root
  `${WEB}/src/pages/`, //     a second (pages-router) route tree
  `${WEB}/pages/`,
  `${WEB}/components/`, //    root-level source tiers outside src/
  `${WEB}/lib/`,
  `${WEB}/styles/`,
  `${WEB}/features/`,
  `${WEB}/e2e/`, //           suites live under tests/e2e now
  `${WEB}/.next/`, //         generated output must never be tracked
  `${WEB}/node_modules/`,
  `${WEB}/playwright-report/`,
  `${WEB}/test-results/`,
  'web/', //                  the pre-workspace root
];

/** Individual files that must not exist. */
export const FORBIDDEN_FILES = [
  `${WEB}/middleware.ts`, //      deprecated name; coexisting with proxy.ts is a Next build error
  `${WEB}/src/middleware.ts`,
  `${WEB}/proxy.ts`, //           the proxy belongs at src level, one location only
  `${WEB}/package-lock.json`, //  one root lockfile
  'apps/api/package-lock.json',
  `${WEB}/playwright-report.json`,
  `${WEB}/vitest-web.json`,
];

/** Content rules over web runtime source. The reader returns null for unreadable files. */
export const CONTENT_RULES = [
  {
    id: 'api-source-import',
    // The web tier consumes the published HTTP contract, never API source.
    pattern: /from\s+['"](?:[^'"]*apps\/api\/|@rootlco\/api)/,
    why: 'imports API server source; the web tier consumes the HTTP contract only',
  },
  {
    id: 'supabase-import',
    pattern: /from\s+['"]@supabase\//,
    why: 'imports a Supabase client; the web tier holds no database credential',
  },
];

const isRuntimeSource = (p) =>
  p.startsWith(`${WEB}/src/`) && /\.(ts|tsx)$/.test(p) && !/\.test\.|\.spec\./.test(p);

/**
 * Evaluate the topology against a tracked-file list.
 * Returns { failures, counts } — counts carries the matched-file number for
 * every REQUIRED prefix so the evidence can show the checks were not vacuous.
 */
/**
 * @param {readonly string[]} files
 * @param {(path: string) => string | null} [read]
 */
export function evaluate(files, read = () => null) {
  /** @type {string[]} */
  const failures = [];
  /** @type {Record<string, number>} */
  const counts = {};

  for (const prefix of REQUIRED_PREFIXES) {
    const n = files.filter((f) => f.startsWith(prefix)).length;
    counts[prefix] = n;
    if (n === 0) failures.push(`required directory has no tracked file: ${prefix}`);
  }

  for (const file of REQUIRED_FILES) {
    const n = files.filter((f) => f === file).length;
    counts[file] = n;
    if (n !== 1) failures.push(`required file missing: ${file}`);
  }

  for (const prefix of FORBIDDEN_PREFIXES) {
    const hits = files.filter((f) => f.startsWith(prefix));
    if (hits.length > 0)
      failures.push(`forbidden path tracked: ${prefix} (${hits.length} file(s), e.g. ${hits[0]})`);
  }

  for (const file of FORBIDDEN_FILES) {
    if (files.includes(file)) failures.push(`forbidden file tracked: ${file}`);
  }

  // One brand authority: `export const brand` defined exactly once.
  const brandDefs = files.filter((f) => {
    if (!isRuntimeSource(f)) return false;
    const s = read(f);
    return s !== null && /export const brand\b/.test(s);
  });
  counts['brand authority'] = brandDefs.length;
  if (brandDefs.length !== 1)
    failures.push(
      `expected exactly 1 brand authority, found ${brandDefs.length}: ${brandDefs.join(', ')}`
    );

  // One primitive-colour authority under the token layer.
  const colourFiles = files.filter(
    (f) => f.startsWith(`${WEB}/src/styles/`) && f.endsWith('_colors.scss')
  );
  counts['colour authority'] = colourFiles.length;
  if (colourFiles.length !== 1)
    failures.push(
      `expected exactly 1 colour token file, found ${colourFiles.length}: ${colourFiles.join(', ')}`
    );

  for (const rule of CONTENT_RULES) {
    for (const f of files.filter(isRuntimeSource)) {
      const s = read(f);
      if (s !== null && rule.pattern.test(s)) failures.push(`${rule.id}: ${f} ${rule.why}`);
    }
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

  const read = (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  };

  const { failures, counts } = evaluate(files, read);

  const requiredMatches = Object.entries(counts)
    .filter(([k]) => k.startsWith(WEB))
    .reduce((a, [, v]) => a + v, 0);
  console.log(
    `Web topology: ${Object.keys(counts).length} expectations, ` +
      `${requiredMatches} matched file(s) across required paths, ${failures.length} failure(s).`
  );

  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nThe canonical web topology is recorded in ' +
        'docs/phase-1/phase-1-25/remediation/web-topology-after.md. ' +
        'Change the topology and this gate in the same commit, or not at all.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
