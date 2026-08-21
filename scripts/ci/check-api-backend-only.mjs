#!/usr/bin/env node
/**
 * API-backend-only gate.
 *
 * `apps/api` is the Backend. It serves HTTP and nothing else. This gate makes
 * that permanent: it fails the build if Frontend material appears in the API
 * workspace — a page, a stylesheet, a client component, a browser global, a
 * React hook, an import of the web workspace, or a tracked build artefact.
 *
 * ## `apps/api/src/app/api/**` is CORRECT and is never flagged
 *
 * The repeated word is not a defect. `apps/api` is the workspace; `src/app/api`
 * is the Next.js Route Handler namespace that publishes `/api/**`. Route
 * handlers are the whole point of the workspace and are explicitly allowed.
 *
 * ## Two design rules, both bought with real defects
 *
 *   1. **Every expectation is COUNTED.** A scan that matches zero files fails
 *      rather than passing quietly — the same anti-vacuity rule PR #161 paid
 *      for, when a documented check named a directory that did not exist and
 *      therefore could never fail.
 *   2. **Comments and string literals are stripped before scanning for code
 *      constructs.** This is not fastidiousness; it is the difference between a
 *      gate that works and one that gets switched off. The API legitimately
 *      contains `input.window.from` (a job-assignment time window) and audit
 *      codes like `shared.document.upload_authorized`. A naive `document.` or
 *      `window.` search flags dozens of correct lines, and a gate that cries
 *      wolf is a gate somebody deletes.
 *
 * The gate is a pure function of the tracked-file list plus a reader, so
 * `tests/ci/api-backend-only.test.ts` proves it fails on each violation without
 * touching the working tree.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The API workspace. */
export const API = 'apps/api';

/** Route Handlers: the workspace's entire reason to exist. Never flagged. */
export const ROUTE_HANDLER = /^apps\/api\/src\/app\/api\/.+\/route\.ts$/;

/**
 * Framework files permitted at the API app root, with the reason each is here.
 *
 * EMPTY by decision, and that is evidence rather than an omission: the Phase 1-1
 * scaffold (`layout.tsx`, `page.tsx`, `page.module.scss`) was removed and
 * `npm run build:api` was re-run and exited 0, emitting 196 `/api/**` routes and
 * zero page routes. Next.js 16.2.12 therefore does NOT require a root layout for
 * a Route-Handler-only application. If a future Next version does, add the file
 * here with the build output that proves it — never because a scaffold made one.
 */
export const ALLOWED_APP_FILES = [];

/** Path prefixes under apps/api that must match nothing — Frontend tiers. */
export const FORBIDDEN_PREFIXES = [
  `${API}/src/components/`, //  UI components belong to apps/web
  `${API}/src/features/`, //    feature UI modules belong to apps/web
  `${API}/src/hooks/`, //       React hooks are a client concern
  `${API}/src/providers/`, //   React context providers
  `${API}/src/store/`, //       client state stores
  `${API}/src/theme/`, //       theming is a Frontend concern
  `${API}/src/styles/`, //      stylesheets belong to apps/web
  `${API}/src/i18n/`, //        translation catalogues belong to apps/web
  `${API}/src/app/(`, //        UI route groups, e.g. (dashboard)/ or (auth)/
  `${API}/src/pages/`, //       a second, pages-router route tree
  `${API}/pages/`,
  `${API}/.next/`, //           generated output must never be tracked
  `${API}/node_modules/`,
  `${API}/coverage/`,
  `${API}/test-results/`,
  `${API}/playwright-report/`,
];

/** Individual files that must not exist in the API workspace. */
export const FORBIDDEN_FILES = [
  `${API}/package-lock.json`, //   one root lockfile
  `${API}/tailwind.config.ts`, //  a UI framework config has no business here
  `${API}/tailwind.config.js`,
  `${API}/postcss.config.mjs`,
  `${API}/.stylelintrc.json`, //   no stylesheets to lint
];

/** Filename patterns that are Frontend by construction, anywhere under apps/api. */
export const FORBIDDEN_FILE_PATTERNS = [
  { id: 'react-page', pattern: /\/page\.(tsx|jsx|js)$/, why: 'a rendered page is Frontend' },
  { id: 'react-template', pattern: /\/template\.(tsx|jsx)$/, why: 'a route template is Frontend' },
  { id: 'react-loading', pattern: /\/loading\.(tsx|jsx)$/, why: 'a loading UI is Frontend' },
  { id: 'react-error-ui', pattern: /\/error\.(tsx|jsx)$/, why: 'an error UI is Frontend' },
  { id: 'react-not-found', pattern: /\/not-found\.(tsx|jsx)$/, why: 'a not-found UI is Frontend' },
  { id: 'react-layout', pattern: /\/layout\.(tsx|jsx)$/, why: 'a layout is Frontend chrome' },
  { id: 'stylesheet', pattern: /\.(css|scss|sass|less)$/, why: 'the API renders nothing to style' },
  { id: 'css-module', pattern: /\.module\.(css|scss)$/, why: 'a CSS Module is Frontend styling' },
  { id: 'tsbuildinfo', pattern: /\.tsbuildinfo$/, why: 'a generated build cache' },
];

/**
 * Code constructs forbidden in API source.
 *
 * Each rule declares the `scope` it is scanned in, and getting this wrong is
 * not theoretical: the first draft scanned everything against fully-stripped
 * source, which deletes string literals — and an import specifier IS a string
 * literal. All five import rules silently matched nothing. The mutation tests
 * in `tests/ci/api-backend-only.test.ts` caught it before it shipped, which is
 * the entire reason they exist.
 *
 *   `imports` — comments removed, strings KEPT. For rules that must see a
 *               module specifier or a directive prologue.
 *   `code`    — comments AND strings removed. For bare-identifier rules, so a
 *               browser word inside prose or a string cannot be an accusation.
 */
export const CODE_RULES = [
  {
    id: 'use-client',
    scope: 'imports',
    pattern: /^\s*['"]use client['"]/m,
    why: "carries the 'use client' directive; the API ships no client bundle",
  },
  {
    id: 'web-workspace-import',
    scope: 'imports',
    pattern: /from\s*['"](?:[^'"]*apps\/web\/|[^'"]*\/web\/src\/|@rootlco\/web)/,
    why: 'imports the web workspace; the API must not depend on the Frontend',
  },
  {
    id: 'stylesheet-import',
    scope: 'imports',
    pattern:
      /(?:import\s[^;\n]*['"][^'"]*\.(?:css|scss|sass|less)['"]|^\s*@use\s|^\s*@tailwind\s)/m,
    why: 'imports a stylesheet',
  },
  {
    id: 'react-client-hook',
    scope: 'code',
    pattern:
      /\b(?:useState|useEffect|useLayoutEffect|useRef|useContext|useReducer|useSyncExternalStore)\s*\(/,
    why: 'uses a React client hook',
  },
  {
    id: 'react-dom-import',
    scope: 'imports',
    pattern:
      /from\s*['"](?:react-dom|next\/link|next\/image|next\/font\/[^'"]*|next\/navigation)['"]/,
    why: 'imports a React DOM or Next client module',
  },
  {
    id: 'ui-framework',
    scope: 'imports',
    pattern:
      /from\s*['"](?:tailwindcss|@radix-ui\/[^'"]*|@shadcn\/[^'"]*|clsx|class-variance-authority|framer-motion|@emotion\/[^'"]*|styled-components)['"]/,
    why: 'imports a UI framework',
  },
  {
    scope: 'code',
    // Browser STORAGE only. `window`, `document` and `navigator` are handled by
    // `no-restricted-globals` in apps/api/eslint.config.mjs instead, because
    // deciding whether `document` is the DOM or a local variable needs scope
    // analysis: this workspace legitimately contains `const document = …` (an
    // attachment record) and `input.window.from` (a job-assignment time window).
    // The first draft of this rule flagged four lines, all of them correct code.
    // `localStorage`/`sessionStorage` have no domain meaning here — currently 0
    // occurrences — so a text match on them cannot be a false accusation.
    id: 'browser-storage',
    pattern: /\b(?:localStorage|sessionStorage)\s*[.[]/,
    why: 'reads browser storage; the API has no browser',
  },
];

/**
 * ESLint config integrity.
 *
 * The scope-aware half of the browser-global rule lives in ESLint. A gate that
 * silently depends on another mechanism is one deletion away from being
 * decorative, so this asserts the restriction is still declared.
 */
export const ESLINT_CONFIG = `${API}/eslint.config.mjs`;
export const REQUIRED_RESTRICTED_GLOBALS = [
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
];

/** Source files the code rules apply to. */
const isApiSource = (p) =>
  p.startsWith(`${API}/src/`) && /\.(ts|tsx|mts|cts)$/.test(p) && !/\.d\.ts$/.test(p);

/**
 * Removes comments and string/template literals so a code scan sees code.
 *
 * Deliberately simple and deliberately conservative: it can blank slightly more
 * than a parser would, and blanking too much can only cause a MISSED violation,
 * never a false accusation. Given the alternative is a gate nobody trusts, that
 * is the right direction to be wrong in — and the mutation tests pin the
 * constructs that must still be caught.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripNonCode(source) {
  return strip(source, true);
}

/** Removes comments only, preserving string literals so import specifiers survive. */
export function stripComments(source) {
  return strip(source, false);
}

/**
 * @param {string} source
 * @param {boolean} alsoStrings
 * @returns {string}
 */
function strip(source, alsoStrings) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < n && source[i] !== '\n') i += 1;
    } else if (two === '/*') {
      i += 2;
      while (i < n && source.slice(i, i + 2) !== '*/') i += 1;
      i += 2;
    } else if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      const quote = source[i];
      const start = i;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += alsoStrings ? '""' : source.slice(start, i);
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

/**
 * Evaluate the API workspace against a tracked-file list.
 *
 * @param {readonly string[]} files
 * @param {(path: string) => string | null} [read]
 * @returns {{ failures: string[], counts: Record<string, number> }}
 */
export function evaluate(files, read = () => null) {
  /** @type {string[]} */
  const failures = [];
  /** @type {Record<string, number>} */
  const counts = {};

  const apiFiles = files.filter((f) => f.startsWith(`${API}/`));
  counts['apps/api tracked files'] = apiFiles.length;

  // Anti-vacuity. Every rule below is scoped to apps/api; if the workspace
  // itself is not in the file list, every rule silently passes and the gate
  // reports success having examined nothing.
  if (apiFiles.length === 0) {
    failures.push('apps/api has no tracked files — the scan examined nothing, which is not a pass');
    return { failures, counts };
  }

  const routeHandlers = apiFiles.filter((f) => ROUTE_HANDLER.test(f));
  counts['route handlers'] = routeHandlers.length;
  if (routeHandlers.length === 0) {
    failures.push('no Route Handlers found under apps/api/src/app/api — the API serves nothing');
  }

  // Every file under the app tree must be a Route Handler or an explicitly
  // allowed framework file. This is the rule that keeps pages out.
  const appTree = apiFiles.filter((f) => f.startsWith(`${API}/src/app/`));
  counts['app tree files'] = appTree.length;
  for (const f of appTree) {
    if (ROUTE_HANDLER.test(f)) continue;
    if (ALLOWED_APP_FILES.includes(f)) continue;
    failures.push(
      `non-route file in the API app tree: ${f} — only Route Handlers and documented framework files belong there`
    );
  }

  for (const prefix of FORBIDDEN_PREFIXES) {
    const hits = apiFiles.filter((f) => f.startsWith(prefix));
    if (hits.length > 0)
      failures.push(`forbidden Frontend path tracked: ${prefix} (${hits.length}, e.g. ${hits[0]})`);
  }

  for (const file of FORBIDDEN_FILES) {
    if (files.includes(file)) failures.push(`forbidden file tracked: ${file}`);
  }

  for (const rule of FORBIDDEN_FILE_PATTERNS) {
    for (const f of apiFiles) {
      if (rule.pattern.test(f)) failures.push(`${rule.id}: ${f} — ${rule.why}`);
    }
  }

  const scanned = apiFiles.filter(isApiSource);
  counts['source files scanned'] = scanned.length;
  if (scanned.length === 0) {
    failures.push(
      'no API source files matched the code scan — the scan roots no longer fit the tree'
    );
  }

  for (const f of scanned) {
    const raw = read(f);
    if (raw === null) continue;
    const views = { code: stripNonCode(raw), imports: stripComments(raw) };
    for (const rule of CODE_RULES) {
      const view = views[rule.scope];
      if (view === undefined) throw new Error(`rule ${rule.id} has an unknown scope`);
      if (rule.pattern.test(view)) failures.push(`${rule.id}: ${f} ${rule.why}`);
    }
  }

  // The scope-aware half of the browser-global rule must still be declared.
  const eslintConfig = files.includes(ESLINT_CONFIG) ? read(ESLINT_CONFIG) : null;
  if (eslintConfig === null) {
    failures.push(`${ESLINT_CONFIG} is missing — the API workspace has no lint policy`);
  } else {
    const declared = REQUIRED_RESTRICTED_GLOBALS.filter((g) =>
      new RegExp(`name:\\s*'${g}'`).test(eslintConfig)
    );
    counts['restricted globals declared'] = declared.length;
    for (const g of REQUIRED_RESTRICTED_GLOBALS) {
      if (!declared.includes(g))
        failures.push(
          `no-restricted-globals no longer declares '${g}' in ${ESLINT_CONFIG} — ` +
            'the scope-aware half of the browser-global rule has been removed'
        );
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

  console.log(
    `API backend-only: ${counts['route handlers'] ?? 0} route handler(s), ` +
      `${counts['source files scanned'] ?? 0} source file(s) scanned, ${failures.length} failure(s).`
  );

  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\napps/api is the Backend. Frontend material belongs in apps/web. The canonical ' +
        'rule and the evidence behind it are in ' +
        'docs/phase-1/phase-1-26/preflight/api-file-ownership-after.md.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
