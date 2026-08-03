#!/usr/bin/env node
/**
 * P1-26 Frontend quality gate.
 *
 * The ownership, topology, API-boundary and generated-artefact gates already
 * cover *where* files live. This covers what P1-26 specifically must not do, and
 * every rule below exists because breaking it would be invisible in review:
 *
 *   1. **No token in browser storage.** `localStorage`, `sessionStorage`,
 *      IndexedDB and a persisted store are all readable by any script in the
 *      document. The session is a `httpOnly` cookie precisely so a cross-site
 *      scripting defect cannot read it; a single `localStorage.setItem` puts it
 *      back within reach and nothing fails.
 *   2. **No floating-point money.** `parseFloat`, `toFixed` and `Number()` on an
 *      amount each round silently, and the rounded value looks exactly like the
 *      right one.
 *   3. **No redirect parameter in the authentication flow.** An open redirect on
 *      the page that completes a credential change is the highest-value one in
 *      any application: the visitor arrived from an email and is primed to trust
 *      whatever it shows them next.
 *   4. **One session-cookie authority.** The attributes that make the cookie
 *      unreadable live in one file. A second `cookies().set` of the session
 *      elsewhere is a second set of attributes to get wrong.
 *   5. **Every `'use server'` module exports only async functions.** Turbopack
 *      rejects the whole module otherwise, and reports it as "the module has no
 *      exports at all" — which sends the reader to the importer rather than to
 *      the cause.
 *
 * ## Two properties this gate is built around
 *
 * **Comments are stripped before scanning.** The first version of the money rule
 * flagged the file that documents why `parseFloat` is never called. A scanner
 * that reads prose accuses the explanation of a rule of breaking it, and the
 * obvious "fix" is to delete the explanation.
 *
 * **A rule that matches nothing fails.** Every rule declares the files it
 * expects to inspect. A scan root that no longer matches the tree reports clean
 * over nothing, which reads as evidence and is blindness. PR #161 exists.
 *
 * Usage: node scripts/ci/check-p1-26-frontend.mjs [--json]
 * Exit: 0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WEB_SRC = join('apps', 'web', 'src');

/** The single file permitted to write or clear the session cookie. */
export const SESSION_COOKIE_AUTHORITY = 'apps/web/src/lib/api/session-cookie.ts';

/** The only directory permitted to perform network I/O. */
export const NETWORK_OWNER = 'apps/web/src/lib/api/';

export const RULES = [
  {
    id: 'browser-storage',
    pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/,
    what: 'reaches for browser storage; a session or token there is readable by any script',
    // `usePersistedFlag` is the reviewed exception: one boolean naming no
    // customer, tenant, route or permission. It is named, not pattern-matched.
    allow: ['apps/web/src/lib/use-persisted-flag.ts'],
  },
  {
    id: 'float-money',
    pattern: /parseFloat\s*\(|\.toFixed\s*\(/,
    what: 'performs floating-point arithmetic where a canonical decimal string belongs',
    // `money.ts` isolates the ONE place a canonical amount becomes a number, for
    // display only, and says so.
    allow: ['apps/web/src/lib/money.ts'],
  },
  {
    id: 'auth-redirect-parameter',
    pattern: /\b(?:returnTo|redirectTo|next_url|redirect_uri)\b/,
    what: 'accepts a redirect destination in the authentication flow',
    scope: 'apps/web/src/features/authentication/',
    allow: [],
  },
  {
    id: 'session-cookie-authority',
    pattern: /rootlco\.session/,
    what: 'names the session cookie outside its single authority',
    allow: [SESSION_COOKIE_AUTHORITY],
  },
  {
    id: 'unsafe-html',
    pattern: /dangerouslySetInnerHTML/,
    what: 'renders unsanitised HTML',
    allow: [],
  },
];

const EXTENSIONS = /\.(ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage']);

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/**
 * Whether a `'use server'` module exports anything that is not an async
 * function.
 *
 * Deliberately conservative: it looks for `export const`, `export let`,
 * `export var`, `export function` (without `async`) and `export class`.
 * `export type`, `export interface` and `export async function` are erased or
 * legal. A false positive here is a build error caught early; a false negative
 * is a build error caught late, by someone else.
 */
export function serverModuleViolations(source) {
  const body = stripComments(source);
  if (!/^\s*['"]use server['"]/m.test(body)) return [];
  const found = [];
  const patterns = [
    [/export\s+const\s+([A-Za-z0-9_$]+)/g, 'const'],
    [/export\s+let\s+([A-Za-z0-9_$]+)/g, 'let'],
    [/export\s+var\s+([A-Za-z0-9_$]+)/g, 'var'],
    [/export\s+class\s+([A-Za-z0-9_$]+)/g, 'class'],
    [/export\s+function\s+([A-Za-z0-9_$]+)/g, 'sync function'],
  ];
  for (const [pattern, kind] of patterns) {
    for (const match of body.matchAll(pattern)) found.push(`${kind} ${match[1]}`);
  }
  return found;
}

function allowed(relPath, allow) {
  return allow.some((entry) => relPath === entry || relPath.startsWith(entry));
}

/**
 * @param {ReadonlyArray<{path: string, source: string}>} files
 * @returns {{failures: string[], counts: Record<string, number>}}
 */
export function evaluate(files) {
  const failures = [];
  const counts = { files: files.length, serverModules: 0 };

  if (files.length === 0) {
    return {
      failures: ['no files were inspected — the scan root no longer matches the tree'],
      counts,
    };
  }

  for (const rule of RULES) {
    let inspected = 0;
    for (const file of files) {
      if (rule.scope && !file.path.startsWith(rule.scope)) continue;
      if (allowed(file.path, rule.allow)) continue;
      inspected += 1;
      if (rule.pattern.test(stripComments(file.source))) {
        failures.push(`${rule.id}: ${file.path} ${rule.what}`);
      }
    }
    counts[rule.id] = inspected;
    // Anti-vacuity per rule. A scoped rule whose scope has moved inspects zero
    // files and passes having judged nothing.
    if (inspected === 0) {
      failures.push(`${rule.id}: inspected 0 files — this rule is measuring nothing`);
    }
  }

  for (const file of files) {
    const violations = serverModuleViolations(file.source);
    if (/^\s*['"]use server['"]/m.test(stripComments(file.source))) counts.serverModules += 1;
    for (const violation of violations) {
      failures.push(
        `use-server-exports: ${file.path} exports ${violation}; ` +
          "a 'use server' module may export only async functions"
      );
    }
  }

  if (counts.serverModules === 0) {
    failures.push("use-server-exports: found no 'use server' module — the rule is vacuous");
  }

  return { failures, counts };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (EXTENSIONS.test(entry.name)) out.push(join(dir, entry.name));
  }
  return out;
}

function main() {
  const root = process.cwd();
  const src = join(root, WEB_SRC);
  let paths = [];
  try {
    if (!statSync(src).isDirectory()) throw new Error('not a directory');
    paths = walk(src);
  } catch (error) {
    console.error(`P1-26 gate could not read ${WEB_SRC}: ${String(error)}`);
    process.exit(2);
  }

  const files = paths.map((path) => ({
    path: relative(root, path).split(sep).join('/'),
    source: readFileSync(path, 'utf8'),
  }));

  const { failures, counts } = evaluate(files);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ counts, failures }, null, 2));
  } else {
    console.log(
      `P1-26 frontend gate: ${counts.files} file(s), ` +
        `${counts.serverModules} server module(s), ${failures.length} failure(s).`
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
