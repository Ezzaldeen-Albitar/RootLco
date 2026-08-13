#!/usr/bin/env node
/**
 * P1-28 record-version sourcing (QA-004).
 *
 * ## The defect this exists to catch
 *
 * Seven `apt.*` / `rec.*` commands are version guarded: the backend refuses them
 * without `If-Match` (428 `ERR-CON-002`) and refuses a stale one (409
 * `ERR-CON-001`). The canonical plan states the discipline in one sentence —
 * *every version-guarded write sources its `recordVersion` from a READ or from
 * the immediately prior command response, never a cached guess across
 * user-visible staleness* — and until this gate that sentence had nothing behind
 * it. A screen that sent `version + 1` would satisfy every adapter test in the
 * suite, because the adapter forwards whatever number it is handed.
 *
 * `sent + 1` is not a conservative guess, it is wrong half the time:
 * `rec.reception-approve` applies ONE edge from `inspecting` and TWO from
 * `opened` in a single transaction, so the answer is `sent + 1` or `sent + 2`
 * depending on a state the screen does not control. Only the response, or a
 * re-read, is right in both cases.
 *
 * ## What is derived, and from where
 *
 * Nothing here is a list of operations or adapters.
 *
 *   - The GUARDED OPERATIONS come from the published contract
 *     (`docs/api/openapi.v1.json`): every `apt.*` / `rec.*` operation whose
 *     parameters include `#/components/parameters/IfMatch`.
 *   - The GUARDED ADAPTERS come from the tree: every function exported by a
 *     `'use server'` module of the two feature trees whose parameter list
 *     declares `ifMatch`. Their count must EQUAL the guarded-operation count —
 *     an operation the contract guards with no adapter demanding a version, or
 *     an adapter demanding one for an operation that is not guarded, is a
 *     disagreement worth failing on.
 *   - The CALL SITES come from walking `apps/web/src` for calls to those
 *     adapters by name.
 *
 * ## How an `If-Match` argument is judged
 *
 * The argument at the adapter's own `ifMatch` position is traced back through
 * the same file's `const` / `let` declarations, and every leaf must be one of
 * two things:
 *
 *   - a `.recordVersion` member access — the version as the SERVER stated it,
 *     from a detail read or from a command's own response; or
 *   - an identifier bound by a function parameter — a version handed in from
 *     outside, which in this codebase is the shell's read.
 *
 * A conditional is traced through its BRANCHES only: `fresher ? changed.recordVersion
 * : detail.recordVersion` is the "read, or the immediately prior response,
 * whichever is newer" rule written out, and its predicate is not a version.
 *
 * Everything else fails, and fails closed:
 *
 *   - `COMPUTED` — an arithmetic operator or a numeric literal reached the
 *     expression. This is the `sent + 1` defect.
 *   - `CACHED` — the leaf is a bare `useState` value. A number the client holds
 *     and only ever sets from a write response is precisely "a cached guess
 *     across user-visible staleness"; reading `.recordVersion` off the stored
 *     RESPONSE is the allowed form, and it is a member access, not a bare one.
 *   - `UNTRACEABLE` — anything this rule cannot classify. A gate that guessed
 *     would be worse than no gate.
 *
 * ## The renewal rule
 *
 * A component that sends a guarded command and keeps its own counsel afterwards
 * can never learn that the record moved. So the function enclosing a guarded
 * call must, after it, either call one of its OWN parameters — handing the
 * outcome to the shell that owns the read — or call something in the refresh
 * family (`refresh`, `reload`, `revalidate`, `router.refresh`). A `setState`
 * declared inside the component does not count: writing the answer into local
 * state is what caching the version looks like.
 *
 * ## Anti-vacuity
 *
 * A checker that examines nothing passes everything. These fail the run: no
 * files scanned, no guarded operations derived, no guarded adapters found, no
 * call site found anywhere.
 *
 * Usage:  node scripts/ci/check-p1-28-version-sourcing.mjs [--json]
 * Exit:   0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REPOSITORY_ROOT } from '../lib/repository-paths.mjs';

const ROOT = REPOSITORY_ROOT;
const jsonOutput = process.argv.includes('--json');

const OPENAPI = join(ROOT, 'docs', 'api', 'openapi.v1.json');
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');

/** The trees whose `'use server'` modules hold the guarded adapters. */
const ADAPTER_ROOTS = Object.freeze([
  join('apps', 'web', 'src', 'features', 'appointments'),
  join('apps', 'web', 'src', 'features', 'receptions'),
]);

const IF_MATCH_REF = '#/components/parameters/IfMatch';

/** Names a re-read may hide behind, beyond a parameter of the enclosing function. */
export const RENEWAL_NAMES = Object.freeze(['refresh', 'reload', 'revalidate']);

const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'dist']);
const SOURCE = /\.(ts|tsx)$/;
const IS_TEST = /\.(test|spec)\.[jt]sx?$/;

function fail(message) {
  console.error(message);
  process.exit(2);
}

/** Source with comments removed. `https://` is not a comment start. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/** Every non-test source file under `dir`. A symlink is REFUSED. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    fail(`Cannot read ${dir}: ${error.message}`);
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (lstatSync(full).isSymbolicLink()) {
      fail(
        `${full} is a symbolic link. This gate refuses to walk symlinks: following one can leave ` +
          'the tree it claims to cover, or recurse without end when it points at an ancestor.'
      );
    }
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(entry) && !IS_TEST.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The argument (or parameter) list starting at `open` — the `(` — split on
 * top-level commas. `null` when the list is unterminated.
 */
export function argumentsAt(text, open) {
  let depth = 0;
  let quote = null;
  let start = open + 1;
  const parts = [];
  for (let i = open; i < text.length; i += 1) {
    const character = text[i];
    if (quote !== null) {
      if (character === '\\') i += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      depth += 1;
      continue;
    }
    if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth === 0) {
        parts.push(text.slice(start, i));
        return parts;
      }
      continue;
    }
    if (character === ',' && depth === 1) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The contract: which operations are version guarded
 * ------------------------------------------------------------------ */

/**
 * Every `apt.*` / `rec.*` operation the published document guards with
 * `If-Match`, as `{ id, method, path }`.
 */
export function guardedOperations(document) {
  const found = [];
  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      const id = operation?.operationId;
      if (typeof id !== 'string' || !/^(apt|rec)\./.test(id)) continue;
      const refs = (operation.parameters ?? []).map((parameter) => parameter?.$ref);
      if (!refs.includes(IF_MATCH_REF)) continue;
      found.push({ id, method: method.toUpperCase(), path });
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ *
 * The tree: which adapters demand a version
 * ------------------------------------------------------------------ */

/** Exported function declarations, in source order, as `{ index, name, open }`. */
export function exportedFunctions(text) {
  const declaration = /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const found = [];
  let match;
  while ((match = declaration.exec(text)) !== null) {
    found.push({ index: match.index, name: match[1], open: match.index + match[0].length - 1 });
  }
  return found;
}

/** Every function declaration — exported or not — as `{ index, name, open }`. */
function allFunctions(text) {
  const declaration =
    /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const found = [];
  let match;
  while ((match = declaration.exec(text)) !== null) {
    found.push({ index: match.index, name: match[1], open: match.index + match[0].length - 1 });
  }
  return found;
}

/** The leading identifier of one parameter part, or `''`. */
function parameterName(part) {
  const named = /^\s*([A-Za-z_$][\w$]*)/.exec(part);
  return named ? named[1] : '';
}

/**
 * The names one parameter part BINDS.
 *
 * A destructuring pattern binds its keys: `{ locale, messages, recordVersion }:
 * { readonly recordVersion: number }` binds three names, and the ANNOTATION that
 * follows binds none — reading identifiers out of the annotation too would let a
 * type name vouch for a value that was never a parameter.
 */
export function boundNames(part) {
  const trimmed = part.trimStart();
  if (!trimmed.startsWith('{')) {
    const name = parameterName(part);
    return name === '' ? [] : [name];
  }
  let depth = 0;
  let end = -1;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '{') depth += 1;
    else if (trimmed[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  const pattern = trimmed.slice(1, end);
  return [...pattern.matchAll(/([A-Za-z_$][\w$]*)\s*(?=[,}:=]|$)/g)]
    .map((m) => m[1])
    .filter((name, index, all) => all.indexOf(name) === index);
}

/**
 * Every guarded adapter one module exports, as
 * `{ name, index, position, required, used }`.
 *
 * `position` is the index of the `ifMatch` parameter, read from the adapter's
 * own signature rather than assumed — a call site's version argument is only
 * findable once its position is known, and assuming "the second one" would be a
 * guess that silently reads the wrong argument the day a signature changes.
 */
export function guardedAdaptersIn(source) {
  const text = stripComments(source);
  const found = [];
  for (const declaration of exportedFunctions(text)) {
    const parts = argumentsAt(text, declaration.open);
    if (parts === null) continue;
    const position = parts.findIndex((part) => parameterName(part) === 'ifMatch');
    if (position === -1) continue;

    // Required means required: no `?`, no default. A defaulted version is the
    // "invent a number" defect with a type annotation in front of it.
    const part = parts[position];
    const required = /^\s*ifMatch\s*:\s*number\s*$/.test(part);

    /*
     * And the body must actually USE it. A parameter accepted and dropped is a
     * guard the caller believes in and the request does not carry.
     *
     * The region ends at the next function OF ANY KIND, not the next EXPORTED
     * one, and the difference is the whole value of this check on the two
     * adapters it matters most for. `closeReceptionWithoutWork` and
     * `refuseReception` are one-line delegations to `closeVisit`, a module-local
     * helper that sits between them and the next export. Bounded at the next
     * export, each of their regions swallowed the whole of `closeVisit` — whose
     * body mentions `ifMatch` — so both would have read as "uses it" with the
     * parameter deleted from the delegation entirely, which is exactly the
     * defect: a guarded command sent with no `If-Match` at all.
     */
    const bodyStart = text.indexOf(')', declaration.open);
    const next = allFunctions(text).find((one) => one.index > declaration.index);
    const body = text.slice(bodyStart, next ? next.index : text.length);
    const used = /\bifMatch\b/.test(body);

    found.push({ name: declaration.name, index: declaration.index, position, required, used });
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * The call site: where the version came from
 * ------------------------------------------------------------------ */

/** `const x = …` / `let x = …` declarations in one file, as name → initializer. */
export function declarations(text) {
  const found = new Map();
  const pattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=\s*/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index + match[0].length;
    let depth = 0;
    let quote = null;
    let end = text.length;
    for (let i = start; i < text.length; i += 1) {
      const character = text[i];
      if (quote !== null) {
        if (character === '\\') i += 1;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character;
        continue;
      }
      if ('([{'.includes(character)) depth += 1;
      else if (')]}'.includes(character)) {
        if (depth === 0) {
          end = i;
          break;
        }
        depth -= 1;
      } else if (character === ';' && depth === 0) {
        end = i;
        break;
      }
    }
    // First declaration wins: a name redeclared in a narrower scope is a
    // different binding, and taking the later one would let an inner shadow
    // vouch for an outer use.
    if (!found.has(match[1])) found.set(match[1], text.slice(start, end).trim());
  }
  return found;
}

/** Names bound by `const [a, b] = useState(…)` — values the CLIENT holds. */
export function cachedNames(text) {
  const found = new Set();
  const pattern = /\b(?:const|let)\s*\[([^\]]*)\]\s*=\s*(useState|useRef|useReducer)\b/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    for (const name of match[1].split(',')) {
      const trimmed = name.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) found.add(trimmed);
    }
  }
  return found;
}

/** Every name any function in the file binds as a parameter. */
export function parameterNames(text) {
  const found = new Set();
  for (const declaration of allFunctions(text)) {
    const parts = argumentsAt(text, declaration.open);
    if (parts === null) continue;
    for (const part of parts) for (const name of boundNames(part)) found.add(name);
  }
  // Arrow functions too — a version can reach a callback's parameter.
  const arrow = /\(([^()]*)\)\s*(?::[^=>\n]*)?=>/g;
  let match;
  while ((match = arrow.exec(text)) !== null) {
    for (const part of match[1].split(',')) for (const name of boundNames(part)) found.add(name);
  }
  return found;
}

/** The top-level `?`/`:` of a conditional expression, or `null`. */
function conditionalSplit(expression) {
  let depth = 0;
  let quote = null;
  let question = -1;
  for (let i = 0; i < expression.length; i += 1) {
    const character = expression[i];
    if (quote !== null) {
      if (character === '\\') i += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
    else if (depth === 0 && character === '?') {
      // `??` is nullish coalescing, not a conditional.
      if (expression[i + 1] === '?' || expression[i - 1] === '?') continue;
      if (question === -1) question = i;
    } else if (depth === 0 && character === ':' && question !== -1) {
      return { question, colon: i };
    }
  }
  return null;
}

const ARITHMETIC = /[+\-*/%]|\b(?:Number|parseInt|parseFloat)\s*\(/;
const NUMERIC = /(?:^|[^\w$.])\d/;
const MEMBER = /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Where an `If-Match` argument came from.
 *
 * Returns `{ ok: true, kind }` for an accepted source, or
 * `{ ok: false, reason }`. `kind` is `'response'` for a server-stated
 * `.recordVersion` and `'supplied'` for a parameter the caller was handed.
 */
export function classifyVersionExpression(expression, context, depth = 0) {
  const trimmed = String(expression ?? '').trim();
  if (trimmed === '') return { ok: false, reason: 'the argument is empty' };
  if (depth > 6) return { ok: false, reason: `"${trimmed}" could not be traced within six steps` };

  // Parenthesised, and conditional-through-its-branches. The predicate of a
  // conditional is not a version: `fresher ? changed.recordVersion :
  // detail.recordVersion` states the rule this gate enforces.
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return classifyVersionExpression(trimmed.slice(1, -1), context, depth + 1);
  }
  const split = conditionalSplit(trimmed);
  if (split !== null) {
    const whenTrue = classifyVersionExpression(
      trimmed.slice(split.question + 1, split.colon),
      context,
      depth + 1
    );
    if (!whenTrue.ok) return whenTrue;
    const whenFalse = classifyVersionExpression(trimmed.slice(split.colon + 1), context, depth + 1);
    if (!whenFalse.ok) return whenFalse;
    return { ok: true, kind: 'response' };
  }

  if (ARITHMETIC.test(trimmed) || NUMERIC.test(trimmed)) {
    return {
      ok: false,
      reason:
        `"${trimmed}" computes a version. Approve applies ONE edge from inspecting and TWO ` +
        'from opened in a single transaction, so sent + 1 is wrong half the time and sent + 2 ' +
        'the other half. Send the version a read or a command response stated.',
    };
  }

  if (MEMBER.test(trimmed)) {
    const leaf = trimmed.split('.').pop();
    if (leaf === 'recordVersion') return { ok: true, kind: 'response' };
    return {
      ok: false,
      reason: `"${trimmed}" is not a recordVersion the server stated`,
    };
  }

  if (IDENTIFIER.test(trimmed)) {
    if (context.cached.has(trimmed)) {
      return {
        ok: false,
        reason:
          `"${trimmed}" is a value this component holds in its own state. That is a cached ` +
          'guess across user-visible staleness; read .recordVersion off the response or the ' +
          'detail read instead.',
      };
    }
    const initializer = context.declarations.get(trimmed);
    if (initializer !== undefined) {
      return classifyVersionExpression(initializer, context, depth + 1);
    }
    if (context.parameters.has(trimmed)) return { ok: true, kind: 'supplied' };
    return {
      ok: false,
      reason:
        `"${trimmed}" is bound by nothing this file declares or receives, so where the version ` +
        'came from cannot be established. This gate fails closed.',
    };
  }

  return { ok: false, reason: `"${trimmed}" is not a version this gate can trace` };
}

/**
 * The function declaration enclosing `index`, with the names it binds and the
 * region it covers.
 */
function enclosingFunction(text, index) {
  const functions = allFunctions(text);
  let nearest = null;
  let next = null;
  for (const candidate of functions) {
    if (candidate.index <= index) nearest = candidate;
    else if (next === null) next = candidate;
  }
  if (nearest === null) return null;
  const parts = argumentsAt(text, nearest.open) ?? [];
  const binds = new Set();
  for (const part of parts) for (const name of boundNames(part)) binds.add(name);
  return { name: nearest.name, binds, end: next ? next.index : text.length };
}

/**
 * Every call to one of `names`, as `{ name, index, args }`.
 *
 * The DECLARATION of an adapter matches the same `name(` shape as a call to it,
 * and its "argument" at the version position is the parameter `ifMatch: number`
 * — which is not a version and would be reported as untraceable in every module
 * that declares one. So a match preceded by the `function` keyword is a
 * declaration and is skipped.
 */
export function callsTo(text, names) {
  if (names.size === 0) return [];
  const escaped = [...names].map((name) => name.replace(/[$]/g, '\\$&'));
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\s*\\(`, 'g');
  const found = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (/\bfunction\s+$/.test(text.slice(Math.max(0, match.index - 40), match.index))) continue;
    const args = argumentsAt(text, match.index + match[0].length - 1);
    if (args === null) continue;
    found.push({ name: match[1], index: match.index, args });
  }
  return found;
}

/**
 * Whether the outcome leaves the component after a guarded call.
 *
 * A component that commands and then keeps its own counsel can never learn that
 * the record moved. Calling one of its OWN parameters hands the outcome to
 * whatever owns the read; calling something in the refresh family re-reads
 * directly. A `setState` declared inside the component is neither, which is the
 * point — writing the answer into local state is what caching the version looks
 * like.
 */
export function renewsAfter(text, from, to, binds) {
  const region = text.slice(from, to);
  const call = /\b([A-Za-z_$][\w$]*)\s*(?:\.([A-Za-z_$][\w$]*))?\s*\(/g;
  let match;
  while ((match = call.exec(region)) !== null) {
    const [, head, member] = match;
    if (member && RENEWAL_NAMES.includes(member)) return true;
    if (!member && RENEWAL_NAMES.includes(head)) return true;
    if (!member && binds.has(head)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/**
 * The whole check, as a function — importable by the mutation suite beside it
 * without running the check or calling `process.exit`. Every input is
 * injectable; nothing is injected in production.
 */
export function run(injected = {}) {
  let document = injected.document;
  if (!document) {
    try {
      document = JSON.parse(readFileSync(OPENAPI, 'utf8'));
    } catch (error) {
      fail(`Cannot read the published contract: ${error.message}`);
    }
  }

  const sources =
    injected.sources ??
    walk(WEB_SRC).map((file) => [
      relative(ROOT, file).split(sep).join('/'),
      readFileSync(file, 'utf8'),
    ]);

  const adapterRoots = (injected.adapterRoots ?? ADAPTER_ROOTS).map((one) =>
    one.split(sep).join('/')
  );

  const guarded = guardedOperations(document);
  const violations = [];

  /* --- the adapters ---------------------------------------------------- */

  const adapters = new Map();
  for (const [path, content] of sources) {
    if (!adapterRoots.some((root) => path.startsWith(root))) continue;
    if (!/^\s*['"]use server['"]/.test(content)) continue;
    for (const adapter of guardedAdaptersIn(content)) {
      adapters.set(adapter.name, { ...adapter, file: path });
    }
  }

  for (const adapter of adapters.values()) {
    if (!adapter.required) {
      violations.push(
        `${adapter.file}: ${adapter.name} declares ifMatch as optional or defaulted. The ` +
          'backend answers 428 ERR-CON-002 without the header, so a default is a version the ' +
          'application invented — declare it `ifMatch: number`.'
      );
    }
    if (!adapter.used) {
      violations.push(
        `${adapter.file}: ${adapter.name} takes ifMatch and never uses it. A guard the caller ` +
          'believes in and the request does not carry is worse than no guard.'
      );
    }
  }

  /* --- the call sites -------------------------------------------------- */

  const names = new Set(adapters.keys());
  const sites = [];

  for (const [path, content] of sources) {
    const text = stripComments(content);
    if (!new RegExp(`\\b(?:${[...names].join('|')})\\b`).test(text) || names.size === 0) continue;

    const context = {
      declarations: declarations(text),
      cached: cachedNames(text),
      parameters: parameterNames(text),
    };

    for (const call of callsTo(text, names)) {
      const adapter = adapters.get(call.name);
      // A call with fewer arguments than the version position cannot be sending
      // one — a re-export or a partial application, neither of which is a
      // command. `callsTo` has already excluded the declaration itself.
      if (call.args.length <= adapter.position) continue;

      const argument = call.args[adapter.position];
      const verdict = classifyVersionExpression(argument, context);
      const enclosing = enclosingFunction(text, call.index);
      const site = {
        file: path,
        adapter: call.name,
        argument: argument.trim(),
        enclosing: enclosing?.name ?? null,
        ok: verdict.ok,
        ...(verdict.ok ? { kind: verdict.kind } : { reason: verdict.reason }),
      };

      if (!verdict.ok) {
        violations.push(
          `${path}: ${call.name} is sent an If-Match this gate refuses — ${verdict.reason}`
        );
      } else if (enclosing === null) {
        // Fails closed. There is no scope whose callbacks could carry the
        // outcome away, so the renewal question cannot even be asked.
        site.renews = false;
        violations.push(
          `${path}: ${call.name} is sent from no named function, so this gate cannot establish ` +
            'that the outcome is handed onward and the version renewed.'
        );
      } else {
        const renews = renewsAfter(text, call.index, enclosing.end, enclosing.binds);
        site.renews = renews;
        if (!renews) {
          violations.push(
            `${path}: ${enclosing.name} sends ${call.name} and never hands the outcome onward. ` +
              'After a guarded command the record has moved; a component that neither calls one ' +
              'of its own callbacks nor re-reads is holding a version it can no longer renew.'
          );
        }
      }

      sites.push(site);
    }
  }

  /* --- anti-vacuity ---------------------------------------------------- */

  if (sources.length === 0) violations.push('no files were scanned');
  if (guarded.length === 0) {
    violations.push('no version-guarded apt/rec operation was derived from the published contract');
  }
  if (adapters.size === 0) {
    violations.push('no guarded adapter was found — the adapter walk examined nothing');
  }
  if (sites.length === 0) {
    violations.push(
      'no guarded call site was found anywhere in apps/web/src. Either every version-guarded ' +
        'command is unreachable, or this gate stopped seeing call sites — both are failures.'
    );
  }
  if (adapters.size !== guarded.length) {
    violations.push(
      `the contract guards ${guarded.length} apt/rec operations and the tree exports ` +
        `${adapters.size} adapters that demand a version. A guarded operation with no adapter ` +
        'cannot be invoked safely, and an adapter demanding a version for an unguarded ' +
        'operation sends a header nothing reads.'
    );
  }

  return { guarded, adapters: [...adapters.values()], sites, violations };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

// Executed only when invoked as a script, never on import.
if (process.argv[1] && process.argv[1].endsWith('check-p1-28-version-sourcing.mjs')) {
  const report = run();
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `P1-28 version sourcing: ${report.guarded.length} guarded operation(s), ` +
        `${report.adapters.length} adapter(s), ${report.sites.length} guarded call site(s).`
    );
    if (report.violations.length === 0) {
      console.log(
        'OK: every version-guarded command sources its If-Match from a read or a command response.'
      );
    } else {
      console.error(`\n${report.violations.length} violation(s):`);
      for (const violation of report.violations) console.error(`  ${violation}`);
    }
  }
  process.exit(report.violations.length === 0 ? 0 : 1);
}
