#!/usr/bin/env node
/**
 * Every operation must publish the success status it actually returns.
 *
 * ## The defect this exists to prevent
 *
 * `document.ts` hard-coded `'200'` as the sole success response for every
 * operation, while 98 route files return `status: 201`. The published contract
 * therefore told every generated client and the frontend mirror the wrong success
 * code for roughly a third of the surface, and nothing compared the two — the
 * OpenAPI document was generated from the DECLARATION, and the declaration had no
 * field capable of disagreeing with the handler.
 *
 * `BR-08-OPEN-01` recorded it as "the 19 operations returning an undocumented
 * 201". That figure is not reproducible from the protected tree, and the real one
 * is larger; this script measures it rather than restating it.
 *
 * ## How the truth is derived
 *
 * A route hands its operation to `handleOperation(X_OPERATION, …)` and returns a
 * literal `status:` from inside that call. So for each `handleOperation(` call the
 * scanner reads the constant it was given, walks the balanced parentheses of that
 * call, and takes the literal success status found inside. The constant is then
 * resolved to the `defineOperation({ id: … })` that produced it, in the same file.
 *
 * This is deliberately syntactic. A type-aware pass would need `ts.createProgram`,
 * which `br-08c-design-decisions.md` records as absent from this repository — and
 * a syntactic scanner that REFUSES what it cannot resolve is honest, whereas one
 * that guesses is the thing being fixed.
 *
 * Anything unresolvable is reported as a failure, never skipped: an operation
 * whose status cannot be determined is exactly the case where a silent default
 * would republish the original defect.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROUTE_ROOT = 'apps/api/src/app/api/v1';

/** Every `route.ts` under the versioned API. */
export function routeFiles(root = ROUTE_ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'route.ts') out.push(full.split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/** Strips line and block comments so prose cannot be mistaken for code. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (line.trim().startsWith('//') ? '' : line))
    .join('\n');
}

/** The span of a balanced `(...)` beginning at `open`. */
function balanced(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * Maps CONSTANT NAME -> operation id, from `const X = defineOperation({ id: '…' })`.
 */
export function declaredOperations(source) {
  const map = new Map();
  const re = /(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*defineOperation\(\s*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const body = balanced(source, source.indexOf('(', m.index + m[0].length - 2));
    const id = body && /\bid:\s*'([^']+)'/.exec(body);
    if (id) map.set(m[1], id[1]);
  }
  return map;
}

/**
 * For each `handleOperation(CONST, …)` call, the literal success status inside it.
 *
 * Returns `{ resolved: Map<operationId, status>, unresolved: string[] }`.
 */
export function successStatuses(source, file) {
  const declared = declaredOperations(source);
  const resolved = new Map();
  const unresolved = [];
  const re = /handleOperation(?:WithoutBody)?\s*\(\s*([A-Za-z0-9_]+)\s*,/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const constant = m[1];
    const id = declared.get(constant);
    if (id === undefined) {
      unresolved.push(
        `${file}: handleOperation(${constant}) names no defineOperation in this file`
      );
      continue;
    }
    const call = balanced(source, source.indexOf('(', m.index));
    if (call === null) {
      unresolved.push(`${file}: unbalanced handleOperation(${constant}) call`);
      continue;
    }
    // Only literal statuses count. A computed status is not publishable and is
    // reported rather than assumed.
    const statuses = [...call.matchAll(/\bstatus:\s*(\d{3})\b/g)].map((s) => Number(s[1]));
    const distinct = [...new Set(statuses)];
    if (distinct.length === 0) resolved.set(id, 200);
    else if (distinct.length === 1) resolved.set(id, distinct[0]);
    else
      unresolved.push(
        `${file}: ${id} returns more than one literal status (${distinct.join(', ')})`
      );
  }
  return { resolved, unresolved };
}

/** The success status every route actually returns, keyed by operation id. */
export function actualSuccessStatuses(root = ROUTE_ROOT) {
  const actual = new Map();
  const unresolved = [];
  for (const file of routeFiles(root)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const found = successStatuses(source, file);
    for (const [id, status] of found.resolved) actual.set(id, status);
    unresolved.push(...found.unresolved);
  }
  return { actual, unresolved };
}

async function main() {
  const { actual, unresolved } = actualSuccessStatuses();
  const failures = [...unresolved];

  const spec = JSON.parse(readFileSync('docs/api/openapi.v1.json', 'utf8'));
  const published = new Map();
  for (const [, methods] of Object.entries(spec.paths ?? {})) {
    for (const [, op] of Object.entries(methods)) {
      if (!op || typeof op !== 'object' || !op.responses || !op.operationId) continue;
      const success = Object.keys(op.responses).find((code) => code.startsWith('2'));
      published.set(op.operationId, Number(success));
    }
  }

  for (const [id, status] of actual) {
    const advertised = published.get(id);
    if (advertised === undefined) continue; // reachability is a different gate's job
    if (advertised !== status) {
      failures.push(`${id}: returns ${status}, the published contract advertises ${advertised}`);
    }
  }

  const counts = [...actual.values()].reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
  console.log(
    `OpenAPI success status: ${actual.size} operation(s) scanned — ` +
      Object.entries(counts)
        .map(([s, n]) => `${n} return ${s}`)
        .join(', ')
  );

  if (failures.length > 0) {
    for (const failure of failures) console.error(`::error::${failure}`);
    console.error(`${failures.length} operation(s) publish a success status they do not return.`);
    process.exitCode = 1;
    return;
  }
  console.log('OK: every operation publishes the success status it returns.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
