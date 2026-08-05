#!/usr/bin/env node
/**
 * P1-27 CRM and Vehicle Frontend quality gate — `P1-27-DO-001`.
 *
 * P1-26's gate covers what any Frontend must not do. This covers what **this
 * phase decided**, and every rule below encodes a decision that a test can be
 * deleted around but a gate cannot:
 *
 *   1. **No merge caller.** `P1-OD-017` — duplicate and merge rules — is an open
 *      Owner decision. Wave 6 shipped a working merge form anyway, and it passed
 *      review, typecheck, lint and 669 tests. The canonical plan requires the
 *      affordance to be *absent*, not disabled: a disabled button asserts the
 *      capability exists and this operator lacks permission, which is a
 *      different and false statement.
 *   2. **No duplicate-scan caller on a review screen.** `crm.duplicate-scan` and
 *      `veh.vehicle-duplicate-scan` read like queries and are privileged audited
 *      **writes** — they create candidate rows, emit audit records and are
 *      throttled at 30/min. The creation form calls the CRM one once, on
 *      explicit intent. A queue that "refreshed" by scanning would write audit
 *      history every time somebody looked at it.
 *   3. **No client-asserted scope.** Tenant, company and branch are resolved
 *      server-side from the session on every operation this platform publishes.
 *   4. **No invented total.** Every list operation returns
 *      `{ items, nextCursor, hasMore }` and no count. A `total` computed in the
 *      client is right on page one and wrong from page two, invisibly.
 *   5. **No upload path.** There is no vehicle media operation at all;
 *      `P1-OD-025` must decide types, limits and storage first.
 *   6. **No console output.** A `console.log` in a Server Action prints server
 *      state into a log nobody is reading; in a client component it prints it
 *      into the browser.
 *
 * ## Three properties this gate is built around
 *
 * **Comments are stripped before scanning.** Every rule above names an operation
 * that this phase deliberately does not call, and the reason it does not call it
 * is written in a docblock naming that operation. A scanner that reads prose
 * accuses the explanation of breaking the rule, and the obvious "fix" is to
 * delete the only durable record of the decision. `apps/web/tests/p1-27-security.test.ts`
 * hit exactly this on its first run.
 *
 * **The stripper is proven, not assumed.** A stripper that removed too much
 * would make every rule pass on an empty string, and all six would report clean
 * while measuring nothing. `selfTest()` runs on every invocation: the forbidden
 * names in a comment must vanish, and the same names in a string literal and a
 * URL must survive.
 *
 * **A rule that matches nothing fails.** Every rule declares the tree it expects
 * to inspect. A scan root that no longer matches reports clean over nothing,
 * which reads as evidence and is blindness.
 *
 * Usage: node scripts/ci/check-p1-27-frontend.mjs [--json]
 * Exit: 0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The two feature trees this phase owns. */
export const SCAN_ROOTS = [
  join('apps', 'web', 'src', 'features', 'crm'),
  join('apps', 'web', 'src', 'features', 'vehicles'),
];

export const RULES = [
  {
    id: 'no-merge-caller',
    pattern: /customer-merge|vehicle-merge|['"`][^'"`]*\/merge['"`]|merge[A-Z]\w*Action/,
    what: 'calls or exposes a merge operation while P1-OD-017 is an open Owner decision',
    allow: [],
  },
  {
    id: 'no-duplicate-scan-on-a-queue',
    pattern: /duplicate-scan|scanDuplicates/,
    what: 'fires a privileged audited duplicate scan from a review surface',
    // The CRM creation form calls `crm.duplicate-scan` ONCE on explicit intent,
    // which is the operation's legitimate use. Named, not pattern-matched.
    allow: ['apps/web/src/features/crm/customers/creation-actions.ts'],
  },
  {
    id: 'no-client-asserted-scope',
    pattern: /\b(?:tenantId|companyId|branchId|tenant_id|company_id|branch_id)\b/,
    what: 'names a scope the client must never assert; scope is resolved server-side',
    allow: [],
  },
  {
    id: 'no-invented-total',
    pattern: /\btotal\s*[:=]\s*(?:rows|items|\w+\.length)/,
    what: 'computes a row total the operation does not publish',
    allow: [],
  },
  {
    id: 'no-upload-path',
    pattern: /new FormData\(\)|multipart\/form-data|type="file"/,
    what: 'builds an upload path; there is no vehicle media operation and P1-OD-025 is open',
    allow: [],
  },
  {
    id: 'no-console-output',
    pattern: /console\.(?:log|info|debug|warn|error)\s*\(/,
    what: 'writes to the console; server state belongs in the structured logger, not stdout',
    allow: [],
  },
];

const EXTENSIONS = /\.(ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage']);

/**
 * Source with comments removed.
 *
 * `//` is only a comment start when it is not preceded by `:`, so `https://`
 * inside a string literal is not truncated — which would hide a real match on
 * the rest of that line.
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/**
 * Proves the stripper both removes prose and preserves code.
 *
 * Runs on every invocation rather than only under test, because a stripper that
 * silently over-matched would make this entire gate report clean over empty
 * strings — the exact failure mode the anti-vacuity rules below exist to catch,
 * arriving through the one path they cannot see.
 */
export function selfTest() {
  // The fourth case proves a `//` preceded by `:` is not treated as a comment
  // start. It asserts on the TAIL (`/keep-me`) rather than on the whole URL: an
  // `includes()` of a full URL is `js/incomplete-url-substring-sanitization`,
  // which CodeQL raised as HIGH against this very function on PR #198. The rule
  // is right in general — a substring check on a URL is a broken host check —
  // and the property under test never needed the host anyway. What matters is
  // that the characters AFTER the `//` survived, which is exactly what the tail
  // shows and what a truncation at `https:` would destroy.
  const sample = [
    '// customer-merge named in a line comment',
    '/** vehicle-merge named in a docblock */',
    "const path = '/merge';",
    "const doc = 'https://example.test/keep-me';",
  ].join('\n');
  const stripped = stripComments(sample);
  const problems = [];
  if (stripped.includes('customer-merge')) problems.push('line comments survive stripping');
  if (stripped.includes('vehicle-merge')) problems.push('docblocks survive stripping');
  if (!stripped.includes("'/merge'")) problems.push('string literals are destroyed by stripping');
  if (!stripped.includes('/keep-me')) problems.push('a URL is truncated at its own //');
  return problems;
}

function allowed(relPath, allow) {
  return allow.some((entry) => relPath === entry || relPath.startsWith(entry));
}

/**
 * @param {ReadonlyArray<{path: string, source: string}>} files
 * @returns {{failures: string[], counts: Record<string, number>}}
 */
export function evaluate(files) {
  const failures = selfTest().map((problem) => `strip-comments: ${problem}`);
  const counts = { files: files.length };

  if (files.length === 0) {
    failures.push('no files were inspected — the scan root no longer matches the tree');
    return { failures, counts };
  }

  for (const rule of RULES) {
    let inspected = 0;
    for (const file of files) {
      if (allowed(file.path, rule.allow)) continue;
      inspected += 1;
      if (rule.pattern.test(stripComments(file.source))) {
        failures.push(`${rule.id}: ${file.path} ${rule.what}`);
      }
    }
    counts[rule.id] = inspected;
    if (inspected === 0) {
      failures.push(`${rule.id}: inspected 0 files — this rule is measuring nothing`);
    }
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
  const paths = [];
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(root, scanRoot);
    try {
      if (!statSync(dir).isDirectory()) throw new Error('not a directory');
      walk(dir, paths);
    } catch (error) {
      console.error(`P1-27 gate could not read ${scanRoot}: ${String(error)}`);
      process.exit(2);
    }
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
      `P1-27 frontend gate: ${counts.files} file(s) across ${SCAN_ROOTS.length} tree(s), ` +
        `${failures.length} failure(s).`
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
