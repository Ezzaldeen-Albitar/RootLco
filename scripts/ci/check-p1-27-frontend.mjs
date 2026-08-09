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
 *   2. **No duplicate-scan caller anywhere in these trees.** `crm.duplicate-scan`
 *      and `veh.vehicle-duplicate-scan` read like queries and are privileged
 *      audited **writes** — they create candidate rows, emit audit records and
 *      are throttled at 30/min. Neither has a call site in this phase: the
 *      creation-time duplicate warning arrives on the create RESPONSE as
 *      `possibleDuplicates`, and no scan is involved. A queue that "refreshed"
 *      by scanning would write audit history every time somebody looked at it.
 *      This header used to say the creation form calls the CRM one once, which
 *      was the justification for an allow-list entry the rule below records as
 *      never having been true.
 *   3. **No client-asserted scope.** Tenant, company and branch are resolved
 *      server-side from the session on every operation this platform publishes.
 *      ASSERTING a scope and DISPLAYING one are different acts, and the rule
 *      means only the first — see `assertedScopes()` below.
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

/**
 * THREE trees, because the canonical plan names three.
 *
 * `canonical-plan.md` §9 states where Frontend work lives:
 * `apps/web/src/features/crm/**`, `apps/web/src/features/vehicles/**` **and**
 * `apps/web/src/app/[locale]/(dashboard)/**`. This constant listed two of them
 * and the docblock above it said "the two feature trees this phase owns" — a
 * declaration contradicting the plan, in the gate whose whole purpose is to
 * enforce the plan.
 *
 * Measured at the head that carried the omission: 43 files scanned, 26
 * unscanned — 38% of the canonical Frontend surface, including
 * `crm/customers/[customerId]/page.tsx`, the file `SEC-001` and `SEC-003` are
 * about. Six rules reported clean over a tree they had never opened.
 *
 * `ROOT_SOURCES` records which document each root comes from, so a root cannot
 * be dropped without contradicting a citation. `tests/ci/p1-27-frontend-gate.test.ts`
 * re-derives the list from that document and fails if any of the three is
 * removed again.
 */
export const SCAN_ROOTS = [
  join('apps', 'web', 'src', 'features', 'crm'),
  join('apps', 'web', 'src', 'features', 'vehicles'),
  join('apps', 'web', 'src', 'app', '[locale]', '(dashboard)'),
];

/** Where the authority for `SCAN_ROOTS` is written down. */
export const ROOT_AUTHORITY = 'docs/phase-1/phase-1-27/canonical-plan.md';

/**
 * The scope names this platform resolves server-side and the client must never
 * assert. Exported so the rule and its tests read one list.
 */
export const SCOPE_NAMES = Object.freeze([
  'tenantId',
  'companyId',
  'branchId',
  'tenant_id',
  'company_id',
  'branch_id',
]);

const SCOPE_SOURCE = `\\b(?:${SCOPE_NAMES.join('|')})\\b`;
/** Global, for the positional scan. Stateful — never share it with `.test()`. */
const SCOPE_SCAN = new RegExp(SCOPE_SOURCE, 'g');
/** Non-global, for the rule's `pattern` field. `.test()` on a `g` regex is stateful. */
const SCOPE_PATTERN = new RegExp(SCOPE_SOURCE);

/**
 * Every index that sits inside a string or template literal, at any nesting.
 *
 * The interpolation of a template is CODE, but for this rule it counts as
 * literal all the same: a scope value interpolated into a template is being
 * built into a URL, a query string or a body, which is the act the rule forbids.
 * So the mask covers the whole span from the opening quote to the closing one.
 *
 * Comments are stripped before this runs, so an apostrophe in prose cannot open
 * a phantom string.
 */
export function literalMask(source) {
  const inside = new Array(source.length).fill(false);
  /** @type {{kind: 'literal'|'code', quote?: string, depth: number}[]} */
  const stack = [];
  let i = 0;
  while (i < source.length) {
    const top = stack[stack.length - 1];
    const ch = source[i];
    if (!top || top.kind === 'code') {
      if (ch === "'" || ch === '"' || ch === '`') {
        stack.push({ kind: 'literal', quote: ch, depth: 0 });
        inside[i] = true;
        i += 1;
        continue;
      }
      if (top && ch === '{') {
        top.depth += 1;
        i += 1;
        continue;
      }
      if (top && ch === '}') {
        if (top.depth === 0) {
          stack.pop();
          inside[i] = true;
          i += 1;
          continue;
        }
        top.depth -= 1;
        i += 1;
        continue;
      }
      // Inside a template interpolation every character still belongs to the
      // template as far as this rule is concerned.
      if (top) inside[i] = true;
      i += 1;
      continue;
    }
    inside[i] = true;
    if (ch === '\\') {
      if (i + 1 < source.length) inside[i + 1] = true;
      i += 2;
      continue;
    }
    if (top.quote === '`' && ch === '$' && source[i + 1] === '{') {
      inside[i + 1] = true;
      stack.push({ kind: 'code', depth: 0 });
      i += 2;
      continue;
    }
    if (ch === top.quote) {
      stack.pop();
      i += 1;
      continue;
    }
    i += 1;
  }
  return inside;
}

/**
 * Scope names the source ASSERTS, as opposed to ones it merely DISPLAYS.
 *
 * ## Why the distinction has to exist
 *
 * Adding the dashboard tree made the previous form of this rule — any
 * occurrence of a scope name, anywhere — fire on
 * `apps/web/src/app/[locale]/(dashboard)/profile/page.tsx`:
 *
 *     value={session.tenantId}
 *
 * That is the profile screen showing the operator which tenant they are signed
 * in to. The value came FROM the server, in the session the server resolved; it
 * is read and rendered and goes nowhere near a request. Failing it would have
 * meant deleting a legitimate screen element to satisfy a rule about something
 * else — and the obvious alternative, an allow-list entry for that file, is how
 * this gate lost a rule before (see `no-duplicate-scan-on-a-queue` below).
 *
 * ## The line the rule actually draws
 *
 * The rule means: **never place a scope into a request.** So a scope name may
 * appear in exactly one position — as a property READ off an object, outside any
 * string or template:
 *
 *     session.tenantId        // display: reading what the server resolved
 *     account?.company_id     // display
 *
 * Every other position is an assertion, because every other position is a way of
 * putting the value somewhere:
 *
 *     { tenantId: x }                    // a body or query property
 *     query({ tenantId, cursor })        // a shorthand property
 *     `/api/v1/x?tenant_id=${id}`        // a query string
 *     params.set('branchId', id)         // a query parameter
 *     `${tenantId}`                      // interpolated into a path
 *
 * The default is therefore ASSERTION and the exemption is narrow, which is the
 * right way round for a gate: a construct nobody anticipated fails rather than
 * passes.
 *
 * @returns {{name: string, index: number, why: string}[]}
 */
export function assertedScopes(source) {
  const inside = literalMask(source);
  const found = [];
  SCOPE_SCAN.lastIndex = 0;
  let match;
  while ((match = SCOPE_SCAN.exec(source)) !== null) {
    const index = match.index;
    if (inside[index]) {
      found.push({
        name: match[0],
        index,
        why: 'built into a string, template, URL or query',
      });
      continue;
    }
    // A property read: the character before it, ignoring whitespace, is the
    // member operator. `?.` ends in `.` too, so one test covers both.
    const before = source.slice(0, index).replace(/\s+$/, '');
    if (before.endsWith('.')) continue;
    found.push({ name: match[0], index, why: 'placed into a value rather than read from one' });
  }
  return found;
}

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
    /*
     * NO exemption, and the one that stood here was a live hole.
     *
     * It named `creation-actions.ts` and said "the CRM creation form calls
     * `crm.duplicate-scan` ONCE on explicit intent". That was never true: the
     * file contains no such call, and `crm-customer-create.dom.test.tsx` asserts
     * its absence deliberately. The creation-time duplicate warning arrives on
     * the create RESPONSE as `possibleDuplicates` — no scan is involved.
     *
     * `evaluate()` skips allow-listed files entirely and only fails a rule that
     * inspected zero files overall, so an unused entry is never reported. It cost
     * nothing today and would have cost everything tomorrow: a privileged audited
     * write added to that file would have passed the gate that exists to stop it.
     *
     * Both scans are `DELIBERATELY_ABSENT` in `canonical-write-reachability.json`
     * and neither has a legitimate call site in this phase, so the list is empty.
     */
    allow: [],
  },
  {
    id: 'no-client-asserted-scope',
    /*
     * POSITIONAL, not a bare name match.
     *
     * The rule is "never assert a scope to the API", and the previous pattern
     * read "never mention one". Those differ on exactly one construct that this
     * phase actually ships — a profile screen displaying the tenant the server
     * resolved — and the difference only became visible when the third canonical
     * tree was added to `SCAN_ROOTS`. `assertedScopes()` carries the reasoning
     * and the boundary; the pattern is kept beside it so a reader can see which
     * names are in scope without following the function.
     */
    pattern: SCOPE_PATTERN,
    detect: (source) => assertedScopes(source).length > 0,
    what: 'asserts a scope to the API; scope is resolved server-side (displaying session scope is fine)',
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
    /*
     * ANY console method, not the five obvious ones.
     *
     * This was a `log|info|debug|warn|error` allow-list while the developer
     * guide described it as "any `console.*`" — so `console.table(customer)`,
     * `console.trace()` and `console.dir(vehicle)` all passed a rule whose whole
     * point is that server state must not reach stdout or a browser. `table` and
     * `dir` are the two that print an object most legibly, which makes them the
     * ones a developer reaches for when debugging exactly the data this rule
     * exists to keep out of logs.
     *
     * Widened rather than narrowing the sentence, because the sentence was right
     * about the intent (`G-04`).
     */
    pattern: /console\.[A-Za-z]\w*\s*\(/,
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
 * Does this rule fire on this source?
 *
 * A rule may carry a `detect` function instead of relying on its `pattern`.
 * `no-client-asserted-scope` needs one because the question it asks is
 * positional — see `assertedScopes()`.
 */
export function fires(rule, source) {
  return rule.detect ? rule.detect(source) === true : rule.pattern.test(source);
}

/**
 * A directory symlink is REFUSED, not followed and not silently skipped.
 *
 * `Dirent.isDirectory()` is FALSE for a symlink that points at a directory —
 * `readdir` does not stat through the link — so `if (entry.isDirectory())` walks
 * past it, and the extension test then rejects it as a file. The tree beyond it
 * is never read and nothing says so. Five walkers in this phase shared that
 * blind spot (`QA005-12`).
 *
 * Following it instead would be worse: a link can point outside the tree or at
 * an ancestor, and a gate that scans an unbounded set is a gate that hangs.
 *
 * So the policy is to fail closed and name the path. A symlink inside a scanned
 * tree is a deliberate act; whoever made it can decide what the gate should do
 * about it, which is a conversation rather than a silent omission.
 */
export function assertNotSymlink(entry, path) {
  if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
    throw new Error(
      `${path} is a symbolic link. This gate refuses to walk symlinks: a link is invisible to ` +
        '`isDirectory()`, so following the tree past it would silently scan nothing. Remove the ' +
        'link, or decide the policy deliberately.'
    );
  }
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
      if (fires(rule, stripComments(file.source))) {
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
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path, out);
    } else {
      // Checked on the non-directory branch, which is exactly where a directory
      // symlink lands: `isDirectory()` is false for it.
      assertNotSymlink(entry, path);
      if (EXTENSIONS.test(entry.name)) out.push(path);
    }
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
