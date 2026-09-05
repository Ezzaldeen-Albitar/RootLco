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
 *     `'use server'` module of every DERIVED feature root whose parameter list
 *     declares `ifMatch`. Every one of them is held to the rules below —
 *     `ifMatch` required, `ifMatch` used, the argument traceable, the version
 *     renewed afterwards.
 *
 *     Their count must equal the number of guarded operations this application
 *     is expected to reach, and that equality is taken over the adapters this
 *     contract can ACCOUNT FOR. The walk is the whole web tree, deliberately,
 *     and since P1-29 `W3` that tree also holds versioned adapters for `wo`
 *     operations — real, correct, and outside an apt/rec contract's subject.
 *     They are declared by name in `OUT_OF_SUBJECT_ADAPTERS`, never by a path
 *     rule that would admit the next one silently. Within the subject, an
 *     operation the contract guards with no adapter demanding a version, or an
 *     adapter demanding one for an operation that is not guarded, is still a
 *     disagreement worth failing on.
 *   - The EXPECTED set is the guarded set minus any operation recorded
 *     `DELIBERATELY_ABSENT` in `docs/phase-1/phase-1-28/write-reachability.json`
 *     against a `decisionRef` the canonical plan §7 records. That is the whole
 *     exclusion mechanism, it is checked here rather than trusted, and an
 *     unresolvable reference is reported as a violation instead of honoured —
 *     see `expectedAdapterOperations`.
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
import {
  callsToNode,
  declaredFunctionsOf,
  enclosingFunctionNode,
  parseModule,
} from '../lib/typescript-source.mjs';
import { recordedDecisions } from './check-p1-28-write-reachability.mjs';

const ROOT = REPOSITORY_ROOT;
const jsonOutput = process.argv.includes('--json');

const OPENAPI = join(ROOT, 'docs', 'api', 'openapi.v1.json');
const MANIFEST = join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'write-reachability.json');
const PLAN = join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'canonical-plan.md');
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');

const WEB_SRC_RELATIVE = join('apps', 'web', 'src');

/**
 * The trees whose `'use server'` modules hold the guarded adapters — DERIVED.
 *
 * This was a hand-written pair, `appointments` and `receptions`, and the omission
 * it produced was not theoretical: `features/attachments` holds the document
 * adapters this phase’s whole evidence chain runs through, and the walk never
 * opened it. That matters most for the rule at the bottom of this file — "no
 * guarded adapter was found" — which exists to stop the gate reporting a clean
 * sweep of nothing. A hand-listed root set makes that anti-vacuity check answer
 * for the trees somebody remembered, so the sweep can be clean, non-empty, and
 * still blind to a whole feature.
 *
 * ## …and the derivation that replaced it was blind to a whole TREE
 *
 * It enumerated the children of `apps/web/src/features` — which is a derivation
 * of the feature roots, not of the roots. Two `'use server'` modules live under
 * `apps/web/src/lib`, so a defective guarded adapter written in either of them
 * was never opened by this gate, and the anti-vacuity check went on reporting a
 * clean non-empty sweep. Replacing a hand-written list with a derivation of the
 * wrong thing keeps the failure and removes the evidence of it.
 *
 * The roots are now the immediate children of `apps/web/src` — the whole web
 * source tree, one root per subtree, plus the tree itself so a module sitting
 * directly in `src/` is covered. A tree added tomorrow is scanned on the day it
 * appears.
 *
 * The root set is no longer TRUSTED either: `run` checks that every
 * `'use server'` module in the sources falls inside one, so a filter that starts
 * excluding real adapters turns the gate red instead of quietly narrowing it.
 */
export function adapterRootsFromRepository() {
  let entries;
  try {
    entries = readdirSync(WEB_SRC, { withFileTypes: true });
  } catch (error) {
    fail(`Cannot enumerate the web source roots at ${WEB_SRC_RELATIVE}: ${error.message}`);
  }
  const roots = entries
    .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
    .map((entry) => join(WEB_SRC_RELATIVE, entry.name));
  // Fail closed. An empty derivation would scan nothing and satisfy every rule
  // below having examined nothing — the exact shape this replaced, twice.
  if (roots.length === 0) fail(`No source root was derived under ${WEB_SRC_RELATIVE}.`);
  // …and the tree itself, so a module at `src/actions.ts` is not outside every root.
  return Object.freeze([...roots, WEB_SRC_RELATIVE]);
}
/**
 * Whether a module opts into the Server Action contract.
 *
 * Read off COMMENT-STRIPPED source, and that is the whole point. The test was
 * `/^\s*['\"]use server['\"]/` against the raw file, so a module written in
 * this repository's own house style — a docblock, then the directive — did not
 * look like a Server Action module at all and the adapter walk skipped it
 * entirely. A guarded adapter inside such a file could declare `ifMatch`
 * optional or defaulted, the exact defect this gate exists for, and the gate
 * reported zero violations.
 *
 * Worse than a miss: the adapter-count equality below then judges a set that
 * is missing the adapter, so the anti-vacuity rule is satisfied by a sweep
 * that never opened the file.
 *
 * Stripping first also removes the other half — a directive QUOTED inside a
 * docblock no longer makes an ordinary module look like a server one, which is
 * the prose-read-as-code failure this repository has hit repeatedly.
 */
export function declaresUseServer(content) {
  return /^\s*(['"])use server\1\s*;?/.test(stripComments(content));
}
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

/**
 * The guarded operations this application is EXPECTED to carry an adapter for.
 *
 * The adapter-equality below is a real check and stays one: a guarded operation
 * with no adapter cannot be invoked safely. But PR #227 published an
 * intake-catalogue ADMINISTRATION surface — fourteen of whose operations are
 * version guarded — that this product deliberately reaches from nowhere: no
 * canonical P1-28 task binds a catalogue-administration screen, and who
 * administers those catalogues and through which surface is an open Owner
 * decision. Demanding an adapter for them would force the phase to build a
 * screenless adapter surface, which is the exact shape Wave A learned not to
 * ship.
 *
 * So an operation may be excluded, and ONLY on evidence that is not this file's
 * own opinion: it must be classified `DELIBERATELY_ABSENT` in the SEC-004
 * manifest against a `decisionRef` the canonical plan §7 records as a decision.
 * Both halves are required and both are checked here rather than taken on trust
 * from the gate next door — a manifest edited alone would otherwise quietly
 * shrink this gate's subject, which is precisely the loosening these gates
 * exist to refuse. A classification with an unresolvable reference is reported
 * as a violation instead of an exclusion.
 */
/**
 * Guarded adapters that exist, are correct, and are NOT this gate's business.
 *
 * Keyed by exported adapter name, each with the operation it serves. Every one
 * is still held to the rules that apply to any guarded adapter — `ifMatch` must
 * be required and must be used — and is excluded only from the count equality,
 * which is a statement about the apt/rec contract's own coverage.
 *
 * Named rather than derived from a path on purpose. A rule such as "ignore
 * anything under features/work-orders" would admit every future versioned
 * adapter without a word; a name has to be added deliberately, and the rot check
 * at the call site removes it the moment its adapter stops existing.
 */
export const OUT_OF_SUBJECT_ADAPTERS = Object.freeze({
  transitionWorkOrder: 'wo.work-order-transition — P1-29 W3, not an apt/rec operation',
  updateJob: 'wo.job-update — P1-29 W3, not an apt/rec operation',
  stopLaborSession: 'tech.labor-session-stop — P1-29 W4, not an apt/rec operation',
  correctLaborSession: 'tech.labor-session-correct — P1-29 W4, not an apt/rec operation',
  updateTemplate: 'dia.template-update — P1-29 W7, not an apt/rec operation',
  transitionReport: 'dia.diagnostic-transition — P1-29 W7, not an apt/rec operation',
  completeReport: 'dia.diagnostic-complete — P1-29 W7, not an apt/rec operation',
  setVersionStatus: 'dia.template-version-status-set — P1-29 W7, not an apt/rec operation',
  finalizeQcRecord: 'qms.qc-record-finalize — P1-29 W8, not an apt/rec operation',
  signOffRework: 'qms.rework-sign-off — P1-29 W8, not an apt/rec operation',
  recordAdditionalWorkApproval: 'wo.additional-work-approval — P1-29 W8, not an apt/rec operation',
  closeWorkOrder: 'wo.work-order-closure — P1-29 W8, not an apt/rec operation',
  updateService: 'svc.service-update — P1-30 W1, not an apt/rec operation',
  publishServiceVersion: 'svc.service-version-publish — P1-30 W1, not an apt/rec operation',
  // P1-30 W2: both guard the PRICE LIST's record version, sourced from the detail read.
  createPriceListVersion: 'svc.price-list-version-create — P1-30 W2, not an apt/rec operation',
  publishPriceListVersion: 'svc.price-list-version-publish — P1-30 W2, not an apt/rec operation',
});

export function expectedAdapterOperations(guarded, manifest, decisions) {
  const classified = manifest?.operations ?? {};
  const expected = [];
  const withheld = [];
  const violations = [];

  for (const operation of guarded) {
    const entry = classified[operation.id];
    if (entry?.classification !== 'DELIBERATELY_ABSENT') {
      expected.push(operation);
      continue;
    }
    const reference = String(entry.decisionRef ?? '').trim();
    if (!reference || !decisions.includes(reference)) {
      violations.push(
        `${operation.id} is DELIBERATELY_ABSENT against "${reference || '(nothing)'}", which the ` +
          'canonical plan §7 does not record as a decision. An unresolvable reference cannot ' +
          'excuse a guarded operation from needing an adapter.'
      );
      expected.push(operation);
      continue;
    }
    withheld.push({ id: operation.id, decisionRef: reference });
  }

  // Anti-vacuity: if everything were withheld this gate would measure nothing,
  // and the equality below would hold against zero.
  if (guarded.length > 0 && expected.length === 0) {
    violations.push(
      'every version-guarded operation is recorded as deliberately absent; a gate whose subject ' +
        'is empty proves nothing about version sourcing'
    );
  }

  return { expected, withheld, violations };
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
 * The function a call site is INSIDE, with the names it binds and where it ends.
 *
 * ## What this replaced
 *
 * "The last `function` declaration whose index precedes the call, ending at the
 * next declaration or at the end of the file." Two failures in one line.
 *
 * It was PROXIMITY, not containment — the identical defect that was removed
 * from the sibling reachability gate in the same wave and left standing here.
 * An arrow-function component is invisible to a `function`-keyword scan, so a
 * guarded call inside one was credited to whatever declaration happened to sit
 * above it. And because the region ran to the NEXT declaration rather than to
 * the end of the real body, `renewsAfter` scanned forward past the component’s
 * own closing brace: an unrelated neighbour’s `refresh()` then satisfied the
 * renewal rule for a component that renews nothing.
 *
 * Both are the same mistake — describing a scope from outside it — and the
 * parser describes it from inside. `end` is now the end of the function’s own
 * body, so the renewal search cannot leave it.
 */
function enclosingFunctionAt(sourceFile, declarations, node) {
  /*
   * The nearest NAMED function-like ancestor, not simply the nearest one.
   *
   * Every guarded command in this tree is sent from inside an inline callback —
   * `action={async () => { … }}`, an `onClick`, a `startTransition` body. A
   * callback has no name and no export, but it is lexically INSIDE the component
   * that defines it, shares its bindings, and returns into its body. The scope
   * whose renewal is in question is that component.
   *
   * This is where this gate and the write-reachability gate legitimately
   * differ, and the difference is the question rather than the mechanism. That
   * gate asks whether an EXPORT is consumed, so a site with no nameable owner
   * has no question to answer and fails closed. This one asks whether a SCOPE
   * hands its outcome onward, and an anonymous callback is part of the scope
   * that wrote it.
   */
  let enclosing = enclosingFunctionNode(node);
  let described = enclosing === null ? undefined : declarations.get(enclosing);
  while (enclosing !== null && (described === undefined || described.name === null)) {
    enclosing = enclosingFunctionNode(enclosing);
    described = enclosing === null ? undefined : declarations.get(enclosing);
  }
  if (enclosing === null || described === undefined || described.name === null) return null;

  /*
   * The bindings are the LEXICAL SCOPE, not one function’s parameter list.
   *
   * `settle` is a prop of the component and is called from inside `submit`, an
   * arrow const nested in it. Reading only the innermost named function’s own
   * parameters finds nothing bound and reports a component that hands its
   * outcome to a callback as one that keeps its own counsel — which is how a
   * correct file turns red. Every function-like ancestor contributes what it
   * binds, because all of it is in scope at the call.
   */
  const binds = new Set();
  for (
    let scope = enclosingFunctionNode(node) === null ? null : enclosingFunctionNode(node);
    scope !== null;
    scope = enclosingFunctionNode(scope)
  ) {
    for (const parameter of scope.parameters) {
      for (const name of boundNames(parameter.getText())) binds.add(name);
    }
  }

  return {
    name: described.name,
    binds,
    // The body’s own extent. A renewal outside it belongs to somebody else.
    end: enclosing.body ? enclosing.body.getEnd() : enclosing.getEnd(),
  };
}
/**
 * Every call to one of `names`, as `{ name, node, args }`.
 *
 * The DECLARATION of an adapter matched the same `name(` shape as a call to it,
 * and its "argument" at the version position was the parameter `ifMatch: number`
 * — not a version, and reported as untraceable in every module that declares
 * one. So the text scan had to special-case a preceding `function` keyword. A
 * `CallExpression` is not a declaration, so the special case is gone along with
 * the class of near-misses it stood for.
 */
export function callsTo(sourceFile, names) {
  if (sourceFile === null || names.size === 0) return [];
  const found = [];
  for (const name of names) {
    for (const call of callsToNode(sourceFile, name)) {
      found.push({
        name,
        node: call,
        args: call.arguments.map((argument) => argument.getText()),
      });
    }
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
  /*
   * `to` is the end of the enclosing function’s OWN body, supplied by the
   * parser. It used to be the index of the next `function` declaration, which
   * is a different place: for every shape without the `function` keyword it
   * lay past the component’s closing brace, so an unrelated neighbour’s
   * `refresh()` satisfied the renewal rule for a component that renews
   * nothing.
   */
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

  const adapterRoots = (injected.adapterRoots ?? adapterRootsFromRepository()).map((one) =>
    one.split(sep).join('/')
  );

  let manifest = injected.manifest;
  if (!manifest) {
    try {
      manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    } catch (error) {
      fail(`Cannot read the reachability manifest: ${error.message}`);
    }
  }

  let decisions = injected.decisions;
  if (!decisions) {
    let plan;
    try {
      plan = readFileSync(PLAN, 'utf8');
    } catch (error) {
      fail(`Cannot read the canonical plan to resolve decision references: ${error.message}`);
    }
    decisions = recordedDecisions(plan);
    if (decisions === null) {
      fail(
        'The canonical plan has no section 7, so no decision reference can be resolved. That is ' +
          'the check failing to run, not a clean run.'
      );
    }
  }

  const guarded = guardedOperations(document);
  const subject = expectedAdapterOperations(guarded, manifest, decisions);
  const violations = [...subject.violations];

  /* --- the adapters ---------------------------------------------------- */

  const adapters = new Map();
  /*
   * The root filter is CHECKED, not trusted. Its whole job is to say which
   * trees hold adapters, and both times it has been wrong it was wrong
   * silently: the sweep stayed clean and non-empty while a tree full of
   * `'use server'` modules went unopened. A module the filter excludes is
   * therefore reported rather than skipped.
   */
  const excludedServerModules = [];
  for (const [path, content] of sources) {
    if (!declaresUseServer(content)) continue;
    if (!adapterRoots.some((root) => path.startsWith(root))) {
      excludedServerModules.push(path);
      continue;
    }
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

  const unparsed = [];
  for (const [path, content] of sources) {
    const text = stripComments(content);
    if (names.size === 0 || !new RegExp(`\\b(?:${[...names].join('|')})\\b`).test(text)) continue;

    const context = {
      declarations: declarations(text),
      cached: cachedNames(text),
      parameters: parameterNames(text),
    };

    /*
     * Parsed ONCE per file. A file the parser refuses yields no call sites at
     * all, which would be a silent narrowing — so it is recorded and reported
     * rather than skipped.
     */
    const sourceFile = parseModule(content);
    if (sourceFile === null) {
      unparsed.push(path);
      continue;
    }
    const fileDeclarations = declaredFunctionsOf(sourceFile);

    for (const call of callsTo(sourceFile, names)) {
      const adapter = adapters.get(call.name);
      // A call with fewer arguments than the version position cannot be sending
      // one — a re-export or a partial application, neither of which is a
      // command. `callsTo` has already excluded the declaration itself.
      if (call.args.length <= adapter.position) continue;

      const argument = call.args[adapter.position];
      const verdict = classifyVersionExpression(argument, context);
      const enclosing = enclosingFunctionAt(sourceFile, fileDeclarations, call.node);
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
        const renews = renewsAfter(content, call.node.getStart(), enclosing.end, enclosing.binds);
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
  for (const path of excludedServerModules) {
    violations.push(
      `${path}: a 'use server' module outside every derived adapter root, so this gate never ` +
        'opened it. The root derivation is narrower than the tree it claims to cover.'
    );
  }
  for (const path of unparsed) {
    violations.push(
      `${path}: this gate could not parse the module, so its guarded call sites were not ` +
        'examined. That is the check failing to run, not a clean run.'
    );
  }
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
  /*
   * The count equality is over the adapters this gate's contract can ACCOUNT FOR.
   *
   * Its subject is the version-guarded apt/rec surface, and the adapter walk is
   * deliberately the whole of `apps/web/src` — fail-closed, because a narrower
   * walk has twice been silently wrong. Those two facts were compatible for
   * exactly as long as every versioned adapter in the tree belonged to apt/rec.
   *
   * P1-29 `W3` ended that: `transitionWorkOrder` and `updateJob` demand a version
   * for `wo.work-order-transition` and `wo.job-update`, which ARE version-guarded
   * operations — just not ones this contract governs. Counting them here reported
   * "an adapter demanding a version for an unguarded operation", which is the
   * opposite of what they are.
   *
   * They are therefore DECLARED rather than absorbed. A path rule would have let
   * every future versioned adapter in silently; a named list cannot, and the rot
   * check below refuses a name that no longer exists — so this cannot outlive its
   * reason the way a satisfied exception does.
   */
  const accountedFor = [...adapters.keys()].filter((name) => !(name in OUT_OF_SUBJECT_ADAPTERS));
  // The rot check is about the REAL tree. A synthetic tree built by a test holds
  // none of these adapters by design, and reporting them missing there would
  // make every fixture fail for a fact about a repository it is not describing.
  if (injected.sources === undefined) {
    for (const name of Object.keys(OUT_OF_SUBJECT_ADAPTERS)) {
      if (!adapters.has(name)) {
        violations.push(
          `${name} is declared out of this gate's subject but no such guarded adapter exists. A ` +
            'declaration that outlives its subject is how an exclusion becomes a hole.'
        );
      }
    }
  }
  if (accountedFor.length !== subject.expected.length) {
    violations.push(
      `the contract guards ${guarded.length} apt/rec operations, ${subject.withheld.length} of ` +
        `them recorded as deliberately absent, leaving ${subject.expected.length} this ` +
        `application must reach — and the tree exports ${accountedFor.length} adapters that ` +
        'demand a version and belong to this subject. A guarded operation with no adapter cannot ' +
        'be invoked safely, and an adapter demanding a version for an unguarded operation sends ' +
        'a header nothing reads.'
    );
  }

  return {
    guarded,
    expected: subject.expected,
    withheld: subject.withheld,
    adapters: [...adapters.values()],
    accountedFor,
    sites,
    violations,
  };
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
        `${report.withheld.length} deliberately absent, ${report.expected.length} this ` +
        `application must reach, ${report.adapters.length} adapter(s), ` +
        `${report.sites.length} guarded call site(s).`
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
