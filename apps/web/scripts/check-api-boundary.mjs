/**
 * The web application's boundary with everything it must not touch.
 *
 * Four rules, each of which has a failure mode that is invisible in review:
 *
 *   1. **No `fetch` outside the API layer.** A component that calls `fetch`
 *      directly bypasses the correlation ID, the timeout, the problem-details
 *      mapping and the no-retry-on-mutation rule — and it does so while looking
 *      completely ordinary.
 *   2. **No import of `apps/api` source.** The web application consumes the
 *      published HTTP contract. Importing a server module would compile, would
 *      work in `next dev`, and would fail at runtime in the browser or, worse,
 *      succeed on the server and leak server-only code into a client bundle.
 *   3. **No import of `supabase` or database code.** The web tier has no
 *      database credentials and must never acquire the habit of expecting any.
 *   4. **No `dangerouslySetInnerHTML`.** Not without a reviewed sanitiser and an
 *      approved use case, and there is neither in P1-25.
 *
 * Usage: node scripts/check-api-boundary.mjs [--json]
 * Exit codes: 0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

const ROOT = process.cwd();

/** Only these may perform network I/O. */
export const NETWORK_OWNERS = [join('src', 'lib', 'api')];

/**
 * The one file allowed to reach a host that is NOT the API, and why.
 *
 * ## What it does
 *
 * `putObject` in the attachments adapter sends the captured bytes to an object
 * store, at a URL the API minted and handed back. That is the whole of it: one
 * `PUT`, to an address this tree did not choose, with no credential of ours on
 * it and `redirect: 'error'` so it cannot be bounced somewhere else.
 *
 * ## Why the API client is the WRONG instrument for it
 *
 * `src/lib/api` exists to talk to OUR API. It attaches the session, the
 * correlation id and the problem-details mapping — every one of which is a
 * reason the rule above exists, and every one of which would be wrong here:
 * sending the session bearer to a presigned store URL hands our credential to
 * somebody else's host, and a store answers bytes rather than problem details.
 * Routing this through the client would satisfy the gate and weaken the
 * product, which is the shape of allowance this repository refuses to make
 * silently.
 *
 * ## Why the file rather than the function
 *
 * The rule scans files, so a file is the smallest thing it can name. What keeps
 * the allowance from widening is a TEST, not this comment:
 * `apps/web/tests/attachments-contract.test.ts` asserts that this file holds
 * exactly ONE `fetch(`, that it is inside `putObject`, and that its URL comes
 * from the authorization rather than from anything this tree composes. A second
 * call here turns that red.
 */
export const STORE_UPLOAD_OWNER = join('src', 'features', 'attachments', 'api.ts');

/**
 * Every module specifier the file imports, however it spells the import.
 *
 * ## Why this is parsed rather than matched
 *
 * The import rules below used to read `from\s+['"]…apps/api/…['"]`, and that
 * sentence is wrong in four independent ways at once. A file could reach API
 * server source through ALL of these while the gate reported zero violations:
 *
 *     import { x } from '@rootlco/api';              // the workspace spelling
 *     await import('@rootlco/api/src/server/db');    // dynamic, package
 *     await import('../../../api/src/server/db');    // dynamic, relative
 *     import { x } from '../../../api/src/server/db' // static, relative
 *
 * The last two never contain the literal `apps/api/`, and the first two are not
 * `from` clauses at all. `@rootlco/api` is a workspace package symlinked into the
 * root `node_modules`, so it RESOLVES from here whether or not `apps/web` declares
 * a dependency on it — the spelling the rule could not see is the one that needs
 * no setup to use.
 *
 * A specifier is a thing the language has a node for. Asking the parser for it is
 * not an approximation of the answer; a regex over source text is.
 */
export function moduleSpecifiers(source) {
  const file = ts.createSourceFile('probe.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  const visit = (node) => {
    // `import … from 'x'` and `export … from 'x'`
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    }
    // `import 'x'` type-only and side-effect forms are the same node above.
    // `await import('x')` and `require('x')`
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const dynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(callee) && callee.text === 'require';
      const first = node.arguments[0];
      if ((dynamic || required) && first && ts.isStringLiteral(first)) out.push(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** A specifier resolved to a repository-relative path, or null if it is a package. */
function resolveSpecifier(relPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const fromDir = posix.dirname(posix.join('apps/web', relPath.split(sep).join('/')));
  return posix.normalize(posix.join(fromDir, specifier));
}

export const RULES = [
  {
    id: 'direct-fetch',
    pattern: /\bfetch\s*\(/,
    what: 'calls fetch() directly instead of using the API client',
    allow: NETWORK_OWNERS,
    /*
     * Exactly one file, named rather than pattern-matched: an allowance shaped
     * like a directory grows by somebody putting a file in it.
     */
    allowFiles: [STORE_UPLOAD_OWNER],
  },
  {
    id: 'api-source-import',
    what: 'imports API server source',
    allow: [],
    specifier: (spec, resolved) =>
      spec === '@rootlco/api' ||
      spec.startsWith('@rootlco/api/') ||
      (resolved !== null && resolved.startsWith('apps/api/')),
  },
  {
    id: 'supabase-import',
    what: 'imports Supabase or database code',
    allow: [],
    specifier: (spec, resolved) =>
      spec === '@supabase/supabase-js' ||
      spec.startsWith('@supabase/') ||
      (resolved !== null && resolved.startsWith('supabase/')),
  },
  {
    id: 'server-only-import',
    what: 'imports a server-only Node module',
    allow: [],
    // Both spellings of every one of them: `node:fs` and `fs` are the same
    // module, and a rule that names only the prefixed form forbids a habit
    // rather than a capability.
    specifier: (spec) =>
      /^(?:node:)?(?:fs|child_process|net|dns|tls|cluster|worker_threads)(?:\/|$)/.test(spec) ||
      spec === 'pg' ||
      spec.startsWith('pg/'),
  },
  {
    id: 'unsafe-html',
    pattern: /dangerouslySetInnerHTML/,
    what: 'uses dangerouslySetInnerHTML without a reviewed sanitiser',
    allow: [],
  },
];

const EXTENSIONS = /\.(ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'scripts', 'tests']);

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

function allowed(relPath, allow, allowFiles = []) {
  const normalised = relPath.split('/').join(sep);
  if (allowFiles.some((file) => normalised === file)) return true;
  return allow.some((dir) => normalised.startsWith(dir + sep));
}

export function inspect(relPath, source) {
  const body = stripComments(source);
  const specifiers = moduleSpecifiers(source);
  const findings = [];
  for (const rule of RULES) {
    if (allowed(relPath, rule.allow, rule.allowFiles ?? [])) continue;
    const hit = rule.specifier
      ? specifiers.some((spec) => rule.specifier(spec, resolveSpecifier(relPath, spec)))
      : rule.pattern.test(body);
    if (hit) findings.push({ path: relPath, rule: rule.id, what: rule.what });
  }
  return findings;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (EXTENSIONS.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function main() {
  const files = [];
  for (const root of ['src']) {
    try {
      files.push(...walk(join(ROOT, root)));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`IO error: ${error.message}`);
        process.exit(2);
      }
    }
  }

  if (files.length === 0) {
    // An empty file set would report clean over nothing at all.
    console.error('::error::no source files found — this check would pass vacuously');
    process.exit(2);
  }

  const findings = files.flatMap((file) => {
    const rel = relative(ROOT, file).split(sep).join('/');
    return inspect(rel, readFileSync(file, 'utf8'));
  });

  if (files.length === 0) {
    console.error('API boundary: scanned 0 files — the scan roots no longer match the tree.');
    process.exit(1);
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ inspected: files.length, findings }, null, 2));
  } else {
    console.log(
      `API boundary: ${files.length} file(s) inspected, ${findings.length} violation(s).`
    );
  }

  if (findings.length > 0) {
    for (const finding of findings) console.error(`  ${finding.path}: ${finding.what}`);
    console.error(
      '\nNetwork access belongs to src/lib/api. The web tier consumes the published HTTP contract ' +
        'and holds no database credential.'
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
