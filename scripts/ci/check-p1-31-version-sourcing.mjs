#!/usr/bin/env node
/**
 * P1-31 record-version sourcing (`P1-31-QA-004`).
 *
 * ## The sentence this exists to put something behind
 *
 * *Every version-guarded write sources its `recordVersion` from a READ or from
 * the immediately prior command response, never a cached guess across
 * user-visible staleness.* The P1-28 gate next door enforces exactly that for
 * the `apt.*` / `rec.*` surface. P1-31 publishes eleven version-guarded
 * operations of its own, and until this file that sentence had nothing behind it
 * for any of them: a screen sending `version + 1` satisfies every adapter test in
 * the suite, because the adapter forwards whatever number it is handed.
 *
 * ## Why a SIBLING, and what is borrowed rather than copied
 *
 * The P1-28 gate's `guardedOperations` hard-filters `^(apt|rec)\.`, and its
 * adapter-count equality is a statement about that contract's own coverage.
 * Widening either would change a gate P1-28's closure rests on — the same reason
 * `check-p1-31-write-shape.mjs` is a sibling of the P1-29 parity gate rather than
 * a widening of it, and that file is the precedent for what follows: the
 * judgement is IMPORTED, never re-implemented.
 *
 * Borrowed from `check-p1-28-version-sourcing.mjs`: the comment-stripper, the
 * declaration / cached-name / parameter-name readers that make up a file's
 * context, `classifyVersionExpression`, the scope reader `enclosingFunctionAt`
 * and the renewal rule `renewsAfter`. A second reader is how the brace-counting
 * scanners drifted, and the P1-28 suite pins the borrowed behaviour.
 *
 * What is this gate's own is the SCOPE, the path resolution that binds a send to
 * an operation, the structural-guard reader described below, the retry rule, and
 * the pending lifecycle.
 *
 * ## The scope is eleven operations, frozen AND checked
 *
 * A namespace regular expression cannot express it: P1-30 already owns the whole
 * of `sal.` and `wty.`, and four of the eleven are `org.` and `rpt.`. So the
 * eleven are named — and then ASSERTED against the published contract. Every one
 * must carry `#/components/parameters/IfMatch` in `docs/api/openapi.v1.json`, and
 * the intersection must be the whole list. An id that stops being guarded, or
 * stops existing, is a violation rather than a quiet shrink; that is the failure
 * mode a hand-written list trades for, and it is checked rather than trusted.
 *
 * Deliberately NOT scoped by `P1_31_OPERATION_IDS` from the access gate. That
 * list answers a different question — which operations a P1-31 SCREEN consumes —
 * and it carried three of these eleven when this gate was written (`f6f0015b`)
 * and four after the DO-001 completeness pass added `sal.delivery-complete`.
 * Scoping a version gate by it would therefore have excluded eight guarded writes,
 * and would still exclude seven. The intersection is PINNED in the suite rather
 * than described here, so the two lists cannot drift apart in silence.
 *
 * ## A send is bound to an operation by its RESOLVED PATH, not by a docblock
 *
 * Every `.send(METHOD, PATH, body, { ifMatch })` in `apps/web/src` is found, its
 * path expression resolved against the module's own path helpers, and matched to
 * the published contract by `METHOD /route/with/{parameters}/collapsed`. A
 * docblock naming an operation id proves nothing — this repository has shipped
 * docblocks stating rules the code did not implement — and a path scan that
 * cannot follow `deliveryPath(id, '/completion')` manufactures the debt it exists
 * to police.
 *
 * It fails CLOSED, and the direction is precise: a versioned send whose path this
 * gate cannot resolve is a violation when its resource root is one of the eleven
 * operations' roots, and out of subject when it provably is not. `POST
 * /api/v1/receptions/…` cannot be a P1-31 operation, because no operation in
 * scope is addressed under `receptions`. That is a proof, not an allow-list, so
 * it cannot go stale.
 *
 * ## The structural guard the P1-28 walk cannot see
 *
 * `completeDelivery(input: CompleteDeliveryInput)` carries its version as an
 * interface FIELD rather than as a parameter named `ifMatch`. The P1-28 adapter
 * walk looks for `ifMatch` in the parameter LIST, so this adapter — the one that
 * releases a vehicle — is invisible to it, and so is every caller handing it a
 * number it invented.
 *
 * So the adapter is derived from the send instead of from the signature: the
 * function enclosing an in-scope versioned send IS the adapter, and how the
 * version reaches it is read off the expression it sends.
 *
 *   - `ifMatch` — an identifier the adapter binds as a parameter. POSITIONAL:
 *     the caller's argument at that index is the version.
 *   - `input.ifMatch` — a field of a parameter. STRUCTURAL: the caller's object
 *     literal at that index must carry an `ifMatch` property, and that property's
 *     initialiser is the version.
 *   - anything else the classifier accepts — `reread.data.recordVersion` — is
 *     INTERNAL. The adapter sourced it itself and owes no caller anything.
 *
 * Adapters are held by FILE and name, never by name alone: two trees may export
 * the same adapter name, and a bare-name map would judge one's callers against the
 * other's signature while answering the second's "no consumer" check with the
 * first's callers. Where one name really does have two adapters behind it and they
 * take their version in different places, no caller of either can be attributed —
 * this gate does not resolve imports — and that is reported rather than guessed.
 *
 * ## The one caller shape this gate does NOT own
 *
 * A POSITIONAL adapter called with fewer arguments than its version position is
 * skipped. That covers a re-export and a partial application, and the remaining
 * case — the version argument omitted altogether — is a missing REQUIRED parameter
 * that `npm run typecheck:web` refuses before this gate runs. It is stated here
 * because a silent skip and a delegated check look identical from the outside. A
 * STRUCTURAL adapter handed an object with no `ifMatch` property is NOT delegated
 * and is a violation here, because a property is the half a widened type can lose.
 *
 * ## The retry rule
 *
 * An adapter may send one operation twice: the completion does, because a
 * conflict after a checklist result or a signature is ordinary. The second send
 * must then carry a version the SERVER stated — a re-read or a response — never
 * the same value the caller supplied, which is a guaranteed second 409 dressed up
 * as a retry. So within one adapter, every send after the first to the same
 * operation must classify as `response`.
 *
 * ## PENDING is a state, not an allow-list
 *
 * Seven of the eleven have no consumer anywhere in `apps/web`. Writing an adapter
 * for them would manufacture the declared-but-never-wired shape this repository
 * has shipped repeatedly, so each is declared in `PENDING_CONSUMERS` with its
 * reason. The lifecycle binds in both directions: an entry naming an operation
 * that is not in scope is stale, an in-scope operation with neither a consumer
 * nor an entry is a violation, and an entry whose operation acquires a consumer
 * turns this gate RED until it is deleted in that same change.
 *
 * ## Anti-vacuity
 *
 * A checker that examines nothing passes everything. These fail the run: no files
 * scanned, no versioned send found anywhere, no send in scope, no operation
 * actually compared, and an adapter that demands a version from its callers and
 * has none.
 *
 * Usage:  node scripts/ci/check-p1-31-version-sourcing.mjs [--json]
 * Exit:   0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { REPOSITORY_ROOT } from '../lib/repository-paths.mjs';
import { callsToNode, declaredFunctionsOf, parseModule } from '../lib/typescript-source.mjs';
import {
  cachedNames,
  classifyVersionExpression,
  declarations,
  enclosingFunctionAt,
  parameterNames,
  renewsAfter,
  stripComments,
} from './check-p1-28-version-sourcing.mjs';

const ROOT = REPOSITORY_ROOT;
const OPENAPI = join(ROOT, 'docs', 'api', 'openapi.v1.json');
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');

const IF_MATCH_REF = '#/components/parameters/IfMatch';
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'dist']);
const SOURCE = /\.(ts|tsx)$/;
const IS_TEST = /\.(test|spec)\.[jt]sx?$/;
const VERSION_PREFIX = '/api/v1';

/**
 * The eleven version-guarded operations P1-31 published.
 *
 * Frozen because no namespace expresses the set, and CHECKED against the
 * published contract by `scopeOf` because a frozen list that can rot is a list
 * that has stopped owning anything.
 */
export const P1_31_GUARDED_OPERATIONS = Object.freeze([
  // The delivery completion — the command that releases a vehicle.
  'sal.delivery-complete',
  // The three checklist-template writes the configuration surface will reach.
  'sal.delivery-checklist-template-rename',
  'sal.delivery-checklist-template-status-set',
  'sal.delivery-checklist-template-item-update',
  // The plan and coverage administration commands FE-008 built.
  'wty.warranty-policy-rename',
  'wty.warranty-policy-status-set',
  'wty.warranty-coverage-status-set',
  // The three report-configuration writes P-13 published.
  'rpt.report-configuration-update',
  'rpt.report-configuration-status-set',
  'rpt.report-configuration-version-publish',
  // The employee-register transition P-17 published.
  'org.employee-status-set',
]);

/** How many operations the scope holds. A silent shrink of the list is a red. */
export const EXPECTED_IN_SCOPE = 11;

/**
 * In-scope operations with no consumer in `apps/web`, each with the reason.
 *
 * See the module note: an entry cannot outlive its reason, and the moment a
 * consumer appears this gate reports the entry STALE rather than honouring it.
 */
export const PENDING_CONSUMERS = Object.freeze({
  'sal.delivery-checklist-template-rename':
    'PENDING: no screen or adapter in apps/web sends this write — the checklist-template configuration surface does not exist; the phase that builds it owes the version discipline',
  'sal.delivery-checklist-template-status-set':
    'PENDING: no screen or adapter in apps/web sends this write — the checklist-template configuration surface does not exist; the phase that builds it owes the version discipline',
  'sal.delivery-checklist-template-item-update':
    'PENDING: no screen or adapter in apps/web sends this write — the checklist-template configuration surface does not exist; the phase that builds it owes the version discipline',
  'rpt.report-configuration-update':
    'PENDING: no screen or adapter in apps/web sends this write — the report-configuration screen does not exist (CC-37(b) declares the same absence for its request mirror)',
  'rpt.report-configuration-status-set':
    'PENDING: no screen or adapter in apps/web sends this write — the report-configuration screen does not exist (CC-37(b) declares the same absence for its request mirror)',
  'rpt.report-configuration-version-publish':
    'PENDING: no screen or adapter in apps/web sends this write — the report-configuration screen does not exist (CC-37(b) declares the same absence for its request mirror)',
  'org.employee-status-set':
    'PENDING: no screen or adapter in apps/web sends this write — nothing in P1-31 administers the employee roster, which is why the access gate deliberately does not claim this operation either',
});

function fail(message) {
  console.error(message);
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * The contract
 * ------------------------------------------------------------------ */

/** `METHOD /route` with every path parameter collapsed to `:p`. */
function routeKey(method, route) {
  return `${method.toUpperCase()} ${route.replace(/\{[^}]*\}/g, ':p')}`;
}

/** Every published operation, as `METHOD /route` → id, and the guarded id set. */
export function readContract(document) {
  const byRoute = new Map();
  const guarded = new Set();
  for (const [route, methods] of Object.entries(document?.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      const id = operation?.operationId;
      if (typeof id !== 'string') continue;
      byRoute.set(routeKey(method, route), { id, route });
      const refs = (operation.parameters ?? []).map((parameter) => parameter?.$ref);
      if (refs.includes(IF_MATCH_REF)) guarded.add(id);
    }
  }
  return { byRoute, guarded };
}

/**
 * The scope, checked rather than trusted.
 *
 * Returns the in-scope ids, the resource roots they are addressed under, and
 * every reason the frozen list disagrees with the published contract.
 */
export function scopeOf(contract, frozen = P1_31_GUARDED_OPERATIONS) {
  const violations = [];
  const inScope = new Set();
  const roots = new Set();

  for (const id of frozen) {
    if (inScope.has(id)) {
      violations.push(`${id} is named twice in the P1-31 scope`);
      continue;
    }
    inScope.add(id);
    if (!contract.guarded.has(id)) {
      violations.push(
        `${id} is named as a version-guarded P1-31 operation, but the published contract does ` +
          'not guard it with If-Match. A scope entry that no longer describes the contract has ' +
          'stopped owning anything.'
      );
      continue;
    }
    const entry = [...contract.byRoute.values()].find((one) => one.id === id);
    const segments = String(entry?.route ?? '')
      .split('/')
      .filter((part) => part && part !== 'api' && part !== 'v1' && !part.startsWith('{'));
    if (segments.length === 0) {
      violations.push(`${id} has no resource root in its published route`);
      continue;
    }
    roots.add(segments[0]);
  }

  if (inScope.size !== EXPECTED_IN_SCOPE) {
    violations.push(
      `the P1-31 version-guarded scope holds ${inScope.size} operation(s) and this gate is ` +
        `written for ${EXPECTED_IN_SCOPE}. A scope that changed size changed what this gate ` +
        'proves; move the number in the same change and say why.'
    );
  }

  return { inScope, roots, violations };
}

/* ------------------------------------------------------------------ *
 * The tree
 * ------------------------------------------------------------------ */

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

/** The web sources this gate reads, as `[repositoryPath, content]`. */
export function repositorySources() {
  return walk(WEB_SRC).map((file) => [
    relative(ROOT, file).split(sep).join('/'),
    readFileSync(file, 'utf8'),
  ]);
}

/* ------------------------------------------------------------------ *
 * Path resolution
 * ------------------------------------------------------------------ */

/** A function whose whole body is one expression, as `{ params, body }`. */
function singleExpressionBody(node) {
  if (!node.body) return null;
  if (!ts.isBlock(node.body)) return node.body;
  const statements = node.body.statements;
  if (statements.length !== 1) return null;
  const only = statements[0];
  return ts.isReturnStatement(only) && only.expression ? only.expression : null;
}

/**
 * The path helpers a module declares, by SHAPE rather than by name.
 *
 * Both shapes this tree writes: a `function` declaration and an arrow constant,
 * either of which returns a single expression. Deliberately not a list of known
 * helper names — the P1-27 gate hard-coded two and a third was invisible to it.
 */
export function pathHelpersOf(sourceFile) {
  const helpers = new Map();
  const remember = (name, node) => {
    const body = singleExpressionBody(node);
    if (body === null) return;
    helpers.set(name, {
      parameters: node.parameters.map((parameter) => ({
        name: ts.isIdentifier(parameter.name) ? parameter.name.text : '',
        initializer: parameter.initializer ?? null,
      })),
      body,
    });
  };
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) remember(node.name.text, node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      remember(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return helpers;
}

/**
 * The path an expression spells, with every computed part collapsed to `:p`, or
 * `null` when this gate cannot say.
 *
 * `null` is the honest answer and the caller treats it as one: a path that cannot
 * be resolved is a violation wherever it could be an operation in scope.
 */
export function resolvePath(node, helpers, bindings = new Map(), depth = 0) {
  if (!node || depth > 8) return null;
  if (ts.isParenthesizedExpression(node)) {
    return resolvePath(node.expression, helpers, bindings, depth + 1);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let path = node.head.text;
    for (const span of node.templateSpans) {
      path += resolvePath(span.expression, helpers, bindings, depth + 1) ?? ':p';
      path += span.literal.text;
    }
    return path;
  }
  // `path + query({...})` — the query string is not part of the operation.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return resolvePath(node.left, helpers, bindings, depth + 1);
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const helper = helpers.get(node.expression.text);
    if (!helper) return null;
    const bound = new Map();
    helper.parameters.forEach((parameter, index) => {
      const argument = node.arguments[index] ?? parameter.initializer;
      bound.set(
        parameter.name,
        argument ? resolvePath(argument, helpers, bindings, depth + 1) : null
      );
    });
    return resolvePath(helper.body, helpers, bound, depth + 1);
  }
  if (ts.isIdentifier(node) && bindings.has(node.text)) return bindings.get(node.text);
  return null;
}

/** The resource root of a resolved path, or `null`. */
export function resourceRootOf(path) {
  if (typeof path !== 'string') return null;
  const bare = path.split(/[?#]/)[0];
  if (!bare.startsWith(`${VERSION_PREFIX}/`)) return null;
  const [first] = bare.slice(VERSION_PREFIX.length + 1).split('/');
  return first === undefined || first === '' ? null : first;
}

/* ------------------------------------------------------------------ *
 * The sends
 * ------------------------------------------------------------------ */

/** The `ifMatch` value one options-object argument carries, as text, or `null`. */
function versionOptionOf(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'ifMatch') {
      return 'ifMatch';
    }
    if (ts.isPropertyAssignment(property) && property.name.getText() === 'ifMatch') {
      return property.initializer.getText();
    }
  }
  return null;
}

/**
 * Every `x.send(METHOD, PATH, body, { ifMatch })` in a module.
 *
 * The transport is the only thing in this application that can attach an
 * `If-Match`, and it does so from that one option — see `lib/api/client.ts`. So
 * the version-carrying request is exactly this shape, and reading it off the call
 * rather than off an adapter signature is what makes the structural guard
 * visible.
 */
export function versionedSendsIn(sourceFile) {
  const helpers = pathHelpersOf(sourceFile);
  const found = [];
  const misplaced = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'send'
    ) {
      /*
       * The options object is argument THREE, and that is a fact about the
       * transport rather than a convenience: `apps/web/src/lib/api/client.ts`
       * declares `send<T>(method, path, body?, options = {})` and `options.ifMatch`
       * is the only value in this application that becomes an `If-Match` header.
       * A fifth argument would not be read and a version in any earlier position
       * would not be sent.
       *
       * The index is therefore kept — a structural search for "the object literal
       * carrying the field" would accept a version in the BODY, which is a request
       * that silently carries no header at all. What is added is the pair of
       * refusals that make the index safe rather than merely conventional: a
       * version option anywhere but position three is reported, and so is a call
       * with more arguments than the signature has parameters. Either would
       * otherwise be INVISIBLE here, and the `no versioned send at all` floor only
       * fires when every send in the tree is missed.
       */
      if (node.arguments.length > 4) {
        misplaced.push({
          node,
          why:
            `is called with ${node.arguments.length} arguments; the transport's send takes four ` +
            '(method, path, body, options). An argument past the fourth is read by nothing, so a ' +
            'version in it is a header that was never sent.',
        });
      }
      for (const [index, argument] of node.arguments.entries()) {
        if (index === 3) continue;
        if (versionOptionOf(argument) !== null) {
          misplaced.push({
            node,
            why:
              `carries an \`ifMatch\` at argument ${index + 1}. The transport reads it only from ` +
              'the options object at argument 4, so this request is version-guarded in appearance ' +
              'and unguarded on the wire.',
          });
        }
      }

      const version = versionOptionOf(node.arguments[3]);
      if (version !== null) {
        const methodNode = node.arguments[0];
        const method =
          methodNode &&
          (ts.isStringLiteral(methodNode) || ts.isNoSubstitutionTemplateLiteral(methodNode))
            ? methodNode.text.toUpperCase()
            : null;
        const path = resolvePath(node.arguments[1], helpers);
        found.push({ node, method, path, version });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  found.misplaced = misplaced;
  return found;
}

/* ------------------------------------------------------------------ *
 * The judgement
 * ------------------------------------------------------------------ */

const MEMBER = /^([A-Za-z_$][\w$]*)(?:\??\.[A-Za-z_$][\w$]*)+$/;

/**
 * Where a version came from, with the structural passthrough added.
 *
 * The borrowed classifier accepts a `.recordVersion` member access and an
 * identifier bound by a parameter, and refuses every other member access — so
 * `input.ifMatch`, which is a structural adapter forwarding the version its
 * CALLER supplied, reads as "not a recordVersion the server stated" and a correct
 * file turns red. The passthrough is admitted here, and only here: the root must
 * be a name the file binds as a parameter, and the caller's own object literal is
 * then judged at the call site under the full rule. Everything else is the P1-28
 * judgement unchanged.
 */
export function classifyP1_31Version(expression, context) {
  const trimmed = String(expression ?? '').trim();
  const member = MEMBER.exec(trimmed);
  if (member !== null && trimmed.split('.').pop() === 'ifMatch') {
    if (context.parameters.has(member[1])) return { ok: true, kind: 'supplied' };
    return {
      ok: false,
      reason:
        `"${trimmed}" forwards an ifMatch field of "${member[1]}", which this file binds as ` +
        'neither a parameter nor anything else this gate can trace. Where the version came from ' +
        'cannot be established, and this gate fails closed.',
    };
  }
  return classifyVersionExpression(trimmed, context);
}

/** A file's context for the classifier, over comment-stripped source. */
function contextOf(content) {
  const text = stripComments(content);
  return {
    declarations: declarations(text),
    cached: cachedNames(text),
    parameters: parameterNames(text),
  };
}

/** The nearest NAMED function-like ancestor of a node, described, or `null`. */
function adapterAt(sourceFile, fileDeclarations, node) {
  return enclosingFunctionAt(sourceFile, fileDeclarations, node);
}

/**
 * How a version reaches the adapter that sends it.
 *
 * `positional` when the adapter binds it as a parameter, `structural` when it is
 * a field of one, `internal` when the adapter sourced it itself.
 */
export function versionEntryOf(expression, parameters) {
  const trimmed = String(expression ?? '').trim();
  const index = parameters.findIndex((parameter) => parameter.names.includes(trimmed));
  if (index !== -1) return { kind: 'positional', index };
  const member = MEMBER.exec(trimmed);
  if (member !== null && trimmed.split('.').pop() === 'ifMatch') {
    const at = parameters.findIndex((parameter) => parameter.names.includes(member[1]));
    if (at !== -1) return { kind: 'structural', index: at, field: 'ifMatch' };
  }
  return { kind: 'internal', index: -1 };
}

/** The names each parameter of a function-like node binds, positionally. */
function parameterBindings(node) {
  return node.parameters.map((parameter) => ({
    names: ts.isIdentifier(parameter.name)
      ? [parameter.name.text]
      : (parameter.name
          .getText()
          .match(/[A-Za-z_$][\w$]*/g)
          ?.slice(0) ?? []),
  }));
}

/** The version one call site hands a positional or structural adapter, or `null`. */
function callSiteVersion(call, entry) {
  const argument = call.arguments[entry.index];
  if (argument === undefined) return null;
  if (entry.kind === 'positional') return argument.getText();
  if (!ts.isObjectLiteralExpression(argument)) return null;
  for (const property of argument.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === entry.field) {
      return property.name.text;
    }
    if (ts.isPropertyAssignment(property) && property.name.getText() === entry.field) {
      return property.initializer.getText();
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/**
 * The whole check, as a function — importable by the suite beside it without
 * running the check or calling `process.exit`. Every input is injectable;
 * nothing is injected in production.
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

  const sources = injected.sources ?? repositorySources();
  const contract = readContract(document);
  const scope = scopeOf(contract, injected.frozen ?? P1_31_GUARDED_OPERATIONS);
  const pending = injected.pending ?? PENDING_CONSUMERS;
  const violations = [...scope.violations];

  /* --- every versioned send in the tree --------------------------------- */

  const unparsed = [];
  const inScopeSends = [];
  const parsed = new Map();
  let versionedSends = 0;
  let outsideSubject = 0;

  for (const [path, content] of sources) {
    if (!/\.send\s*[<(]/.test(stripComments(content))) continue;
    const sourceFile = parseModule(content);
    if (sourceFile === null) {
      unparsed.push(path);
      continue;
    }
    parsed.set(path, sourceFile);

    const sends = versionedSendsIn(sourceFile);
    for (const { why } of sends.misplaced ?? []) {
      violations.push(`${path}: a request to the transport ${why}`);
    }
    for (const send of sends) {
      versionedSends += 1;
      const key =
        send.method === null || send.path === null
          ? null
          : routeKey(send.method, send.path.split(/[?#]/)[0]);
      const operation = key === null ? undefined : contract.byRoute.get(key);
      if (operation !== undefined && scope.inScope.has(operation.id)) {
        inScopeSends.push({ ...send, file: path, content, id: operation.id });
        continue;
      }
      if (operation !== undefined) {
        outsideSubject += 1;
        continue;
      }
      const root = resourceRootOf(send.path);
      if (root !== null && !scope.roots.has(root)) {
        // Provably somebody else's: no operation in scope is addressed under
        // this resource root, so the send cannot be one of the eleven.
        outsideSubject += 1;
        continue;
      }
      violations.push(
        `${path}: a version-guarded request is sent to a path this gate cannot resolve ` +
          `(${send.method ?? 'an unresolved method'} ${send.path ?? 'an unresolved path'}), and ` +
          'its resource root is one an operation in scope is addressed under. An unattributable ' +
          'guarded send could be any of them, so this gate fails closed.'
      );
    }
  }

  /* --- the adapter that sends, and the callers that supply -------------- */

  const adapters = new Map();
  const sites = [];
  const consumed = new Set();
  const sentPerAdapter = new Map();

  for (const send of inScopeSends) {
    consumed.add(send.id);
    const sourceFile = parsed.get(send.file);
    const fileDeclarations = declaredFunctionsOf(sourceFile);
    const context = contextOf(send.content);
    const verdict = classifyP1_31Version(send.version, context);
    const described = adapterAt(sourceFile, fileDeclarations, send.node);

    if (!verdict.ok) {
      violations.push(
        `${send.file}: ${send.id} is sent an If-Match this gate refuses — ${verdict.reason}`
      );
    }

    if (described === null) {
      violations.push(
        `${send.file}: ${send.id} is sent from no named function, so this gate can establish ` +
          'neither where its version came from nor who supplies it.'
      );
      continue;
    }

    // The retry rule: a second send of one operation from one adapter must carry
    // a version the SERVER stated, never the value the caller supplied again.
    const seen = `${send.file}::${described.name}::${send.id}`;
    const already = sentPerAdapter.get(seen) ?? 0;
    sentPerAdapter.set(seen, already + 1);
    if (already > 0 && verdict.ok && verdict.kind !== 'response') {
      violations.push(
        `${send.file}: ${described.name} sends ${send.id} again with "${send.version}" — the same ` +
          'version the first attempt was refused for. A retry after a conflict must quote a ' +
          'version the server stated, from a re-read or a response, or it is a second 409 by ' +
          'construction.'
      );
    }

    /*
     * Resolved by name WITHIN the file, and the ambiguity is refused rather than
     * resolved by source order.
     *
     * `enclosingFunctionAt` returns a NAME, not the node, so the node has to be
     * found again — and two functions of one name in one module (an inner helper
     * shadowing an export, a declaration beside an arrow constant) both answer to
     * it. Taking the first match reads the parameter list of a function that may
     * not be the one that sent the request, which decides where the version enters
     * and therefore which caller argument is judged. A wrong answer here is worse
     * than none.
     */
    const matches = [...fileDeclarations.entries()].filter(
      ([, described_]) => described_.name === described.name
    );
    if (matches.length > 1) {
      violations.push(
        `${send.file}: ${matches.length} functions in this module are named ${described.name}, and ` +
          `${send.id} is sent from one of them. This gate resolves the sending adapter by name ` +
          'within the file, so it cannot tell which parameter list to read — and reading the wrong ' +
          'one decides where the version enters and which caller argument is judged.'
      );
      continue;
    }
    const node = matches[0];
    const entry =
      node === undefined
        ? { kind: 'internal', index: -1 }
        : versionEntryOf(send.version, parameterBindings(node[0]));

    sites.push({
      file: send.file,
      operation: send.id,
      adapter: described.name,
      version: send.version.trim(),
      ok: verdict.ok,
      entry: entry.kind,
      ...(verdict.ok ? { kind: verdict.kind } : { reason: verdict.reason }),
    });

    if (entry.kind !== 'internal' && verdict.ok) {
      /*
       * Keyed by FILE and name, not by name.
       *
       * Two feature trees may export a `completeDelivery` apiece — the tree is
       * organised by feature and nothing forbids the repetition — and a map keyed
       * by the bare name silently keeps whichever was walked first. The second
       * adapter then vanishes from this gate: its callers are judged against the
       * OTHER adapter's version position, which is a verdict about a function they
       * do not call, and its own "an adapter with no consumer" check is answered
       * by somebody else's callers. Both directions are wrong quietly.
       */
      const key = `${send.file}::${described.name}`;
      if (!adapters.has(key)) {
        adapters.set(key, { key, name: described.name, file: send.file, entry, callers: 0 });
      }
    }
  }

  /* --- the call sites --------------------------------------------------- */

  /*
   * Grouped back by NAME for the search, because a call site names a function and
   * this gate does not resolve imports. Where one name has two adapters behind it,
   * see the disagreement rule below: agreement is judged, disagreement is refused.
   */
  const byName = new Map();
  for (const adapter of adapters.values()) {
    const group = byName.get(adapter.name) ?? [];
    group.push(adapter);
    byName.set(adapter.name, group);
  }
  const sameShape = (a, b) =>
    a.entry.kind === b.entry.kind &&
    a.entry.index === b.entry.index &&
    a.entry.field === b.entry.field;
  for (const [name, group] of byName) {
    if (group.length > 1 && !group.every((one) => sameShape(one, group[0]))) {
      violations.push(
        `${group.map((one) => one.file).join(' and ')}: both export a guarded adapter named ` +
          `${name}, and they take their version in different places. A call site names a function ` +
          'and this gate does not resolve imports, so no caller of either can be attributed. ' +
          'Judging one against the other would be a verdict about a function it does not call.'
      );
    }
  }

  const names = new Set(byName.keys());
  for (const [path, content] of sources) {
    if (names.size === 0) continue;
    const text = stripComments(content);
    if (![...names].some((name) => new RegExp(`\\b${name}\\s*\\(`).test(text))) continue;
    let sourceFile = parsed.get(path);
    if (sourceFile === undefined) {
      sourceFile = parseModule(content);
      if (sourceFile === null) {
        unparsed.push(path);
        continue;
      }
      parsed.set(path, sourceFile);
    }
    const fileDeclarations = declaredFunctionsOf(sourceFile);
    const context = contextOf(content);

    for (const name of names) {
      const group = byName.get(name);
      // A name whose adapters disagree about where the version sits is reported
      // above and judged here for nobody: an attribution this gate cannot make is
      // refused rather than guessed.
      if (group.length > 1 && !group.every((one) => sameShape(one, group[0]))) continue;
      const adapter = group[0];
      for (const call of callsToNode(sourceFile, name)) {
        /*
         * The adapter's own module holds its declaration, not a call to it, so a
         * hit here is a real caller. A call with fewer arguments than the version
         * position is NOT judged, and that is a stated limit rather than an
         * oversight: it is a re-export or a partial application, and the one
         * remaining shape — a positional adapter called with the version argument
         * omitted altogether — is a missing REQUIRED parameter, which
         * `npm run typecheck:web` refuses before this gate is reached. A structural
         * adapter handed an object without the field is a different case and IS
         * judged, immediately below, because a missing optional-looking property is
         * the shape a type can be widened into.
         */
        if (call.arguments.length <= adapter.entry.index) continue;
        for (const one of group) one.callers += 1;

        const supplied = callSiteVersion(call, adapter.entry);
        if (supplied === null) {
          violations.push(
            `${path}: ${name} is called without the version it demands at argument ` +
              `${adapter.entry.index + 1}${
                adapter.entry.kind === 'structural' ? ` (field \`${adapter.entry.field}\`)` : ''
              }. The backend answers 428 ERR-CON-002 without the header, so a caller that supplies ` +
              'no version is a guard the adapter believes in and the request does not carry.'
          );
          continue;
        }

        const verdict = classifyP1_31Version(supplied, context);
        if (!verdict.ok) {
          violations.push(
            `${path}: ${name} is handed an If-Match this gate refuses — ${verdict.reason}`
          );
          continue;
        }

        const enclosing = enclosingFunctionAt(sourceFile, fileDeclarations, call);
        if (enclosing === null) {
          violations.push(
            `${path}: ${name} is called from no named function, so this gate cannot establish ` +
              'that the outcome is handed onward and the version renewed.'
          );
          continue;
        }
        if (!renewsAfter(content, call.getStart(), enclosing.end, enclosing.binds)) {
          violations.push(
            `${path}: ${enclosing.name} sends ${name} and never hands the outcome onward. After a ` +
              'guarded command the record has moved; a component that neither calls one of its ' +
              'own callbacks nor re-reads is holding a version it can no longer renew.'
          );
        }
      }
    }
  }

  /* --- the pending lifecycle -------------------------------------------- */

  for (const [id, reason] of Object.entries(pending)) {
    if (!scope.inScope.has(id)) {
      violations.push(
        `PENDING_CONSUMERS names \`${id}\`, which is not a version-guarded P1-31 operation — ` +
          'stale entry'
      );
      continue;
    }
    if (consumed.has(id)) {
      violations.push(
        `${id}: the PENDING_CONSUMERS entry is STALE — a consumer now sends this write, so the ` +
          'entry must be deleted in the same change that added it. A declared absence that ' +
          'outlives its reason is a hole this gate discloses and does not close.'
      );
    }
    if (!String(reason).startsWith('PENDING: ')) {
      violations.push(`${id}: the PENDING_CONSUMERS entry does not state a reason`);
    }
  }
  for (const id of scope.inScope) {
    if (consumed.has(id) || Object.hasOwn(pending, id)) continue;
    violations.push(
      `${id} is version guarded, no consumer in apps/web sends it, and it is not declared in ` +
        'PENDING_CONSUMERS. Being unreachable must be a declared state, never a silence.'
    );
  }

  /* --- anti-vacuity ------------------------------------------------------ */

  if (sources.length === 0) violations.push('no files were scanned');
  for (const path of unparsed) {
    violations.push(
      `${path}: this gate could not parse the module, so its guarded sends were not examined. ` +
        'That is the check failing to run, not a clean run.'
    );
  }
  if (versionedSends === 0) {
    violations.push(
      'no version-carrying request was found anywhere in apps/web/src — the send walk examined ' +
        'nothing'
    );
  }
  if (inScopeSends.length === 0) {
    violations.push(
      'no in-scope version-guarded send was found. Either every P1-31 guarded command is ' +
        'unreachable, or this gate stopped binding sends to operations — both are failures.'
    );
  }
  if (consumed.size === 0) {
    violations.push(
      'every operation in scope is declared pending — a gate that compared no operation against ' +
        'the sourcing rule proves nothing about it'
    );
  }
  for (const adapter of adapters.values()) {
    if (adapter.callers === 0) {
      violations.push(
        `${adapter.file}: ${adapter.name} demands a version from its callers and has none. An ` +
          'adapter with no production consumer looks wired and is not.'
      );
    }
  }

  return {
    inScope: [...scope.inScope].sort(),
    consumed: [...consumed].sort(),
    pending: Object.keys(pending).sort(),
    guardedByContract: contract.guarded.size,
    versionedSends,
    inScopeSends: inScopeSends.length,
    outsideSubject,
    adapters: [...adapters.values()],
    sites,
    violations,
  };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function main() {
  const report = run();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const callers = report.adapters.reduce((total, one) => total + one.callers, 0);
    console.log(
      `P1-31 version sourcing: ${report.inScope.length} guarded operation(s) in scope of ` +
        `${report.guardedByContract} the contract guards, ${report.consumed.length} with a ` +
        `consumer, ${report.pending.length} pending one, ${report.inScopeSends} in-scope send(s), ` +
        `${callers} adapter call site(s), ${report.outsideSubject} versioned send(s) outside the ` +
        'subject.'
    );
    if (report.violations.length === 0) {
      console.log(
        'OK: every version-guarded P1-31 command sources its If-Match from a read or a command ' +
          'response, and renews it after a conflict.'
      );
    } else {
      console.error(`\n${report.violations.length} violation(s):`);
      for (const violation of report.violations) console.error(`  ${violation}`);
    }
  }
  process.exit(report.violations.length === 0 ? 0 : 1);
}

// Entry-point check, not a filename check — a Windows drive letter makes a
// hand-built `file://` URL wrong, and a gate that only runs under one exact
// spelling of its own path is a gate a test cannot copy or wrap.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
