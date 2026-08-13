#!/usr/bin/env node
/**
 * P1-28 write reachability (SEC-004).
 *
 * ## The defect this exists to catch
 *
 * INT-113, P1-27's dominant defect class: an operation shipped with a route, a
 * permission, an audit class, an idempotency entry, an OpenAPI path and a
 * register row — and no screen from which anybody could invoke it, while every
 * automated tier stayed green. `check-p1-27-write-reachability.mjs` is the
 * authority for the crm/veh writes ONLY; the apt/rec writes this phase consumes
 * had no reachability authority at all. This gate is that authority, built on
 * DAY ONE of the phase rather than after the defect recurred.
 *
 * ## The operation list is DERIVED, never written down here
 *
 * It comes from the P1-24 operation register: every `apt.*` / `rec.*` operation
 * whose method is not GET. The canonical plan's §4 says "12 POST commands";
 * remediation R5 (PR #220) then added the two terminal closes
 * (`rec.reception-close-without-work`, `rec.reception-refuse`), so the derived
 * set is 14 today — and the derivation, not the prose, is the authority. An
 * operation in the register and not in the manifest is UNWIRED and fails.
 *
 * ## The allow-list, and why it only shrinks
 *
 * On day one NO apt/rec write has a screen — the contract layer has not been
 * built — and that is a legitimate state for a phase that has not started its
 * frontend waves, not a defect. So the manifest may classify an operation
 * `NOT_YET_WIRED`, with a REQUIRED reason naming the plan task that will wire
 * it. What must never happen silently is the P1-27 ending: the phase closes and
 * an entry is still there.
 *
 * The ratchet makes the list monotone. `DAY_ONE_NOT_YET_WIRED` below is the
 * frozen high-water mark: a `NOT_YET_WIRED` entry whose id is not in it fails.
 * An id can therefore LEAVE the allow-list — the wave that builds its screen
 * flips the classification to `REACHABLE`, and this gate forces that flip
 * because an allow-listed operation that IS called is a violation — but no id
 * can ENTER it. A write registered after day one can never be parked: it ships
 * `REACHABLE` in the same change, or carries an approved
 * `DELIBERATELY_ABSENT` decision. Do NOT append to the frozen list; that is
 * the one edit this gate exists to refuse, and
 * `tests/ci/p1-28-write-reachability.test.ts` pins it.
 *
 * ## What counts as a production call site
 *
 * A *mutation* call site: an `/api/v1/...` path literal whose IMMEDIATELY
 * preceding argument is an HTTP write-method literal (`'POST'` — the whole
 * apt/rec surface — or `'PUT'`/`'PATCH'`), with nothing but a comma and
 * whitespace between the two. Matching a bare path is not enough: reads and
 * writes share paths (`rec.reception-authorization` POST and `-list` GET live
 * on one route), so a path-only check would report a write reachable after its
 * call site was deleted. And a method literal merely NEARBY is not enough
 * either: the first version of this matcher accepted any write-method literal
 * within a 2000-character look-behind window, and a `client.get(...)` READ
 * sitting after a genuine write in the same file borrowed that write's method
 * and was reported as a mutation site — a false REACHABLE that would survive
 * the real call site's deletion. The live tree contained exactly that shape
 * (`features/vehicles/profile-api.ts`: the VIN-uniqueness probe read, 40 lines
 * below a PATCH). Adjacency is what every real call shape in this codebase
 * provides — `client.send('POST', path, …)` and the CRM-style
 * `write(previous, parse, 'POST', path, …)` both pass the method as the
 * argument directly before the path — so adjacency is what is required.
 *
 * A path may also be built by a PATH HELPER rather than written inline. The
 * reception adapters send `client.send('POST', visitPath(id, '/party-roles'), …)`,
 * and an inline-literal scanner sees no path there at all — which is how two
 * demonstrably wired writes sat allow-listed with a reason blaming the scanner.
 * `pathHelpers` resolves them, by SHAPE and not by name: a function whose whole
 * body is `return` of one template literal beginning `/api/v1/`. Its
 * interpolations are read against its own parameter list — a bare `${param}` is
 * a slot the call site fills, anything else (`${encodeURIComponent(id)}`) is an
 * opaque value and normalises to `:p` — so `visitPath(id, '/party-roles')`
 * resolves to `/api/v1/receptions/:p/party-roles` while `visitPath(id, tail)`
 * with an UNTYPED variable tail resolves to `/api/v1/receptions/:p/:p` and
 * matches nothing. A helper this rule cannot read stays invisible, which fails
 * closed: the `REACHABLE` claim goes red and whoever flips it extends this gate.
 *
 * Waves F/G are the first flip that had to. `closeVisit` in the reception
 * adapter forwards a `tail` typed `'/close-without-work' | '/refuse'` into
 * `visitPath`, and both commands were wired by the summary screen while this
 * gate could see neither. So a slot filled by an identifier whose ENCLOSING
 * function types it as a union of STRING LITERALS is expanded into one candidate
 * path per member. That is enumeration, not guessing: the type has already
 * listed what the call can be, and a value outside the union is a compile error,
 * so no path appears that the code cannot build. Everything else is unchanged —
 * an untyped variable, a `string`, and a union with one non-literal member all
 * stay `:p` — and `tests/ci/p1-28-write-reachability.test.ts` holds both halves.
 *
 * ## A call site nobody can reach is not reachability
 *
 * An adapter that sends a write is not a screen that invokes it — and this
 * phase proved the difference the hard way. Wave A landed the whole reception
 * adapter surface AHEAD of the screens, so seven `rec.*` writes acquired a
 * genuine `client.send('POST', …)` call site while only two of them could be
 * reached by an operator. Counting the adapter alone would have flipped all
 * seven to `REACHABLE` and emptied the allow-list of everything it exists to
 * hold: INT-113 blessed by the gate built to catch it.
 *
 * So a call site must be CONSUMED. Each one is attributed to the exported
 * function that encloses it, and that name must be mentioned by another
 * production module (comments stripped, so a docblock naming an adapter is not
 * evidence anybody calls it). A site inside no exported function — a top-level
 * statement — is counted as it always was, because there is no export whose
 * consumption could be asked about. The attribution is textual: a site inside an
 * INTERNAL helper is credited to the exported function declared above it, which
 * is right for this codebase's flat adapter modules and is conservative
 * elsewhere — an unconsumed attribution drops the site, so a wrong guess turns a
 * `REACHABLE` claim red rather than passing one silently.
 *
 * These do NOT count, excluded structurally rather than by naming convention:
 *
 *   - anything under `tests/` or matching `*.test.*` / `*.spec.*`
 *   - comments and docblocks (stripped before matching)
 *   - `lib/api/idempotent-operations.ts`, a GENERATED manifest that lists every
 *     idempotent operation whether or not anything calls it
 *   - `lib/api/operation-contract.ts`, which documents the call convention
 *   - documentation and translation catalogues (only `.ts`/`.tsx` are scanned)
 *
 * ## Anti-vacuity
 *
 * A checker that scans nothing passes everything. These conditions fail the
 * run outright: no files scanned, no operations derived, no mutation call site
 * found anywhere in the tree (the crm/veh call sites prove the scanner works
 * even while the apt/rec count is legitimately zero), and a malformed
 * classification. `NOT_YET_WIRED` requires a non-empty `reason` and
 * `DELIBERATELY_ABSENT` a non-empty `decisionRef` — an absence with nothing
 * recorded behind it is indistinguishable from an omission, which is what this
 * gate is for.
 *
 * Usage:  node scripts/ci/check-p1-28-write-reachability.mjs [--json]
 * Exit:   0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REPOSITORY_ROOT } from '../lib/repository-paths.mjs';

const ROOT = REPOSITORY_ROOT;
const jsonOutput = process.argv.includes('--json');

const REGISTER = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json');
const MANIFEST = join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'write-reachability.json');
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');

export const CLASSIFICATIONS = Object.freeze(['REACHABLE', 'NOT_YET_WIRED', 'DELIBERATELY_ABSENT']);

/**
 * The frozen day-one high-water mark of the allow-list — the ratchet.
 *
 * Recorded 2026-08-13 at the head of the P1-28 feature branch, where the
 * frontend tree contains no apt/rec call site at all: every canonical write
 * derived from the register on that day, and nothing else, ever. Ids LEAVE
 * this state as waves land; none may enter it. This list is deliberately NOT
 * derived from the register at run time — a derived high-water mark would rise
 * with every newly registered write, which is a ratchet that loosens itself.
 */
export const DAY_ONE_NOT_YET_WIRED = Object.freeze([
  'apt.appointment-cancel',
  'apt.appointment-create',
  'apt.appointment-no-show',
  'apt.appointment-reschedule',
  'rec.reception-approve',
  'rec.reception-authorization',
  'rec.reception-close-without-work',
  'rec.reception-condition-evidence',
  'rec.reception-convert-to-work-order',
  'rec.reception-create',
  'rec.reception-party-role',
  'rec.reception-refusal',
  'rec.reception-refuse',
  'rec.reception-signature',
]);

/**
 * Files that mention an operation without anybody being able to invoke it.
 * Named, not pattern-matched — see the P1-27 gate for the history.
 */
const NOT_A_CALL_SITE = Object.freeze([
  join('lib', 'api', 'idempotent-operations.ts'),
  join('lib', 'api', 'operation-contract.ts'),
]);

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

/**
 * Collapses TypeScript interpolation so inline path templates become
 * comparable: `` `/api/v1/receptions/${encodeURIComponent(id)}/approve` ``
 * compares equal to the registered `/receptions/{receptionId}/approve` once
 * that has been through `normaliseRoutePath`. Bare braces are deliberately NOT
 * touched — collapsing `{…}` across a whole source file erases closures and
 * with them the markers the look-behind depends on (the P1-27 gate shipped
 * that bug and three demonstrably-called operations went "unreachable").
 */
export function normaliseSourcePaths(text) {
  return text.replace(/\$\{[^}]*\}/g, ':p');
}

/** `/receptions/{receptionId}/approve` → `/receptions/:p/approve`. */
export function normaliseRoutePath(route) {
  return route.replace(/\{[^}]*\}/g, ':p');
}

/** Every non-test source file under `dir`. A symlink is REFUSED (QA005-12). */
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
          'the tree it claims to cover, or recurse without end when it points at an ancestor. ' +
          'Remove the link, or decide the policy deliberately.'
      );
    }
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, out);
    } else if (SOURCE.test(entry) && !IS_TEST.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** A parameter list, as names and their string defaults. `x = ''` → `''`. */
function helperParameters(list) {
  return list
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const name = /^([A-Za-z_$][\w$]*)/.exec(part);
      const fallback = /=\s*(['"])((?:(?!\1).)*)\1\s*$/.exec(part);
      return { name: name ? name[1] : '', default: fallback ? fallback[2] : null };
    })
    .filter((param) => param.name !== '');
}

/**
 * The path helpers a file declares, by SHAPE rather than by name.
 *
 * A helper qualifies when its whole body is `return` of a single template
 * literal that begins with the API prefix. The template is split into literal
 * text and interpolations, and each interpolation is read against the helper's
 * own parameters: `${tail}` names one and becomes a slot the call site fills;
 * `${encodeURIComponent(receptionId)}` names none and is an opaque value, which
 * is exactly what `:p` means everywhere else in this gate.
 *
 * Deliberately not a list of known helper names — the P1-27 gate hard-codes two
 * (`base`, `vehicleBase`) and a third helper would be invisible to it.
 */
export function pathHelpers(strippedSource) {
  const helpers = new Map();
  const declaration =
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?::\s*string\s*)?\{\s*return\s+`([^`]*)`\s*;?\s*\}/g;

  let match;
  while ((match = declaration.exec(strippedSource)) !== null) {
    const [, name, list, template] = match;
    if (!template.startsWith('/api/v1/')) continue;

    const params = helperParameters(list);
    const segments = [];
    let cursor = 0;
    const interpolation = /\$\{([^}]*)\}/g;
    let hole;
    while ((hole = interpolation.exec(template)) !== null) {
      segments.push({ kind: 'literal', text: template.slice(cursor, hole.index) });
      const slot = params.findIndex((param) => param.name === hole[1].trim());
      segments.push(slot === -1 ? { kind: 'opaque' } : { kind: 'slot', index: slot });
      cursor = hole.index + hole[0].length;
    }
    segments.push({ kind: 'literal', text: template.slice(cursor) });
    helpers.set(name, { params, segments });
  }
  return helpers;
}

/** The argument list starting at `open` (the `(`), split on top-level commas. */
function argumentsAt(text, open) {
  let depth = 0;
  let quote = null;
  let start = open + 1;
  const args = [];
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
        args.push(text.slice(start, i));
        return args;
      }
      continue;
    }
    if (character === ',' && depth === 1) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

/** A bare string literal's value, or `null` for anything a call site computes. */
function literalValue(argument) {
  const trimmed = argument.trim();
  const literal = /^(['"`])((?:(?!\1)[^\\])*)\1$/.exec(trimmed);
  return literal ? literal[2] : null;
}

/**
 * Parameters whose TYPE is a union of string literals, as name → alternatives.
 *
 * `tail: '/close-without-work' | '/refuse'` names two paths and no others. A
 * value like that is not unknown — the type system has already enumerated it —
 * so collapsing it to `:p` throws away a fact the source states outright. A
 * parameter typed anything else (`string`, a named type, a union with a
 * non-literal member) yields nothing and stays opaque, which is the failing-
 * closed behaviour the rest of this gate relies on.
 */
export function literalUnionParameters(parameterTexts) {
  const unions = new Map();
  for (const part of parameterTexts) {
    const declaration = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/.exec(part);
    if (!declaration) continue;
    const alternatives = declaration[2].split('|').map((piece) => piece.trim());
    if (alternatives.length < 2) continue;
    const values = [];
    for (const alternative of alternatives) {
      const literal = /^(['"])((?:(?!\1)[^\\])*)\1$/.exec(alternative);
      if (!literal) {
        values.length = 0;
        break;
      }
      values.push(literal[2]);
    }
    if (values.length > 0) unions.set(declaration[1], values);
  }
  return unions;
}

/** The literal-union parameters of the nearest `function` header before `index`. */
function enclosingLiteralUnions(text, index) {
  const declaration = /\bfunction\s+[A-Za-z_$][\w$]*\s*\(/g;
  let nearest = null;
  let match;
  while ((match = declaration.exec(text)) !== null) {
    if (match.index > index) break;
    nearest = match;
  }
  if (nearest === null) return new Map();
  const parameters = argumentsAt(text, nearest.index + nearest[0].length - 1);
  return parameters === null ? new Map() : literalUnionParameters(parameters);
}

/**
 * Every path a helper call can build, with everything unknown collapsed to `:p`.
 *
 * An ARRAY rather than one string, because one call site can spell out more than
 * one path. `closeVisit(receptionId, tail, …)` in the reception adapter forwards
 * a `tail` typed `'/close-without-work' | '/refuse'`: the function sends exactly
 * two routes and the type says which two, so reporting `:p` for it would leave
 * two demonstrably wired commands invisible to this gate — and this gate's own
 * rule is that an invisible write cannot be claimed REACHABLE. Enumerating what
 * the type enumerates is not guessing; a path the code cannot build never
 * appears, because a value outside the union is a compile error.
 *
 * A parameter typed `string`, or absent, is still unknown and still `:p`.
 */
function resolveHelperCall(helper, args, unions) {
  let paths = [''];
  const extend = (candidates) => {
    const next = [];
    for (const prefix of paths) for (const candidate of candidates) next.push(prefix + candidate);
    paths = next;
  };

  for (const segment of helper.segments) {
    if (segment.kind === 'literal') {
      extend([segment.text]);
    } else if (segment.kind === 'opaque') {
      extend([':p']);
    } else {
      const supplied = args[segment.index];
      if (supplied === undefined) {
        extend([helper.params[segment.index]?.default ?? ':p']);
        continue;
      }
      const value = literalValue(supplied);
      if (value !== null) {
        extend([value]);
        continue;
      }
      const identifier = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(supplied);
      const union = identifier ? unions.get(identifier[1]) : undefined;
      extend(union ?? [':p']);
    }
  }
  return paths;
}

/** Exported function declarations, in source order, as `{ index, name }`. */
function exportedFunctions(text) {
  const declaration =
    /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/g;
  const found = [];
  let match;
  while ((match = declaration.exec(text)) !== null) {
    found.push({ index: match.index, name: match[1] });
  }
  return found;
}

/**
 * Every mutation call site in one file, as `{ method, path, owner }`.
 *
 * Found by locating each API path — an inline literal, or a call to one of the
 * file's own path helpers — and requiring the write-method literal to stand as
 * the argument IMMEDIATELY before it: only a comma and whitespace may separate
 * the two. Every call shape this codebase uses provides that adjacency:
 * `client.send('POST', path, …)` and the CRM-style
 * `write(previous, parse, 'POST', path, …)` helper both pass the method as the
 * argument directly before the path (the parse closure sits BEFORE the method,
 * so it never intervenes). A path with no adjacent write marker is a READ and
 * is ignored — which is what keeps a list GET from vouching for the POST that
 * shares its route, and what keeps a read from BORROWING the method of an
 * unrelated write elsewhere in the file: the previous any-marker-within-2000-
 * characters window did exactly that to `client.get(...)` calls placed after a
 * genuine write, and `tests/ci/p1-28-write-reachability.test.ts` holds the
 * borrowed-read fixture that refuses the regression.
 *
 * `owner` is the exported function the site sits inside, or `null` for a
 * top-level statement. `run` uses it to ask whether anything consumes that
 * export; see the file docblock for why an unconsumed adapter is not reach.
 */
export function mutationCallSites(source) {
  const stripped = stripComments(source);
  const helpers = pathHelpers(stripped);
  const text = normaliseSourcePaths(stripped);
  const owners = exportedFunctions(text);
  const sites = [];

  const ownerAt = (index) => {
    let owner = null;
    for (const candidate of owners) {
      if (candidate.index > index) break;
      owner = candidate.name;
    }
    return owner;
  };

  // Adjacency, not proximity: the method literal must end the text directly
  // before the path, save for the argument comma and whitespace. The slice is
  // only as long as a method literal plus formatting needs; the `$` anchor is
  // what carries the rule.
  const adjacentMethod = (index) => {
    const window = text.slice(Math.max(0, index - 200), index);
    const method = /['"](POST|PUT|PATCH)['"]\s*,\s*$/.exec(window);
    return method ? method[1] : null;
  };

  const pathPattern = /['"`](\/api\/v1\/[^'"`\s]*)['"`]/g;
  let match;
  while ((match = pathPattern.exec(text)) !== null) {
    const method = adjacentMethod(match.index);
    if (method) sites.push({ method, path: match[1], owner: ownerAt(match.index) });
  }

  if (helpers.size > 0) {
    const names = [...helpers.keys()].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const helperCall = new RegExp(`\\b(${names.join('|')})\\s*\\(`, 'g');
    let call;
    while ((call = helperCall.exec(text)) !== null) {
      const method = adjacentMethod(call.index);
      if (!method) continue;
      const args = argumentsAt(text, call.index + call[0].length - 1);
      if (args === null) continue;
      const unions = enclosingLiteralUnions(text, call.index);
      for (const path of resolveHelperCall(helpers.get(call[1]), args, unions)) {
        sites.push({ method, path, owner: ownerAt(call.index) });
      }
    }
  }

  return sites;
}

/**
 * The whole check, as a function — importable by the mutation suite beside it
 * without running the check or calling `process.exit`. Every input is
 * injectable so the suite can drive the judgement with synthetic
 * register/manifest/source/high-water quadruples; nothing is injected in
 * production, where the defaults read the real register, the real manifest,
 * the real tree and the frozen day-one list.
 */
export function run(injected = {}) {
  let register = injected.register;
  let manifest = injected.manifest;
  if (!register) {
    try {
      register = JSON.parse(readFileSync(REGISTER, 'utf8'));
    } catch (error) {
      fail(`Cannot read the operation register: ${error.message}`);
    }
  }
  if (!manifest) {
    try {
      manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    } catch (error) {
      fail(`Cannot read the reachability manifest: ${error.message}`);
    }
  }
  const highWater = injected.highWater ?? DAY_ONE_NOT_YET_WIRED;

  const canonical = (register.operations ?? [])
    .filter((op) => /^(apt|rec)\./.test(op.id) && op.method !== 'GET')
    .sort((a, b) => a.id.localeCompare(b.id));

  const classified = manifest.operations ?? {};

  // --- scan --------------------------------------------------------------------

  const sources =
    injected.sources ??
    walk(WEB_SRC).map((file) => [
      relative(ROOT, file).split(sep).join('/'),
      readFileSync(file, 'utf8'),
    ]);

  const scanned = sources.filter(
    ([path]) => !NOT_A_CALL_SITE.some((excluded) => path.endsWith(excluded.split(sep).join('/')))
  );

  const found = [];
  for (const [path, content] of scanned) {
    for (const site of mutationCallSites(content)) found.push({ ...site, file: path });
  }

  /*
   * Consumption. A site is evidence only if something outside its own module
   * names the export that holds it — an adapter nobody imports is a write
   * nobody can invoke, which is INT-113 itself. Comments are stripped first:
   * this repository's docblocks name adapters constantly, and a sentence about
   * a function is not a call to it. A site with no enclosing export is kept as
   * it always was; there is no export whose consumption could be asked about.
   */
  const code = new Map(scanned.map(([path, content]) => [path, stripComments(content)]));
  const consumption = new Map();
  const consumed = (owner, file) => {
    if (owner === null) return true;
    const key = `${file} ${owner}`;
    if (!consumption.has(key)) {
      const named = new RegExp(`\\b${owner}\\b`);
      consumption.set(
        key,
        [...code].some(([path, content]) => path !== file && named.test(content))
      );
    }
    return consumption.get(key);
  };

  const sites = found.filter((site) => consumed(site.owner, site.file));

  // The register's `route` field ALREADY carries the `/api/v1` prefix — read
  // from a live entry, not assumed (the P1-27 gate double-prefixed it once and
  // produced 23 false violations against demonstrably-called operations).
  function callSiteFor(operation) {
    const wanted = normaliseRoutePath(operation.route);
    return sites.find((site) => site.path === wanted && site.method === operation.method) ?? null;
  }

  // --- judge -------------------------------------------------------------------

  const violations = [];
  const results = [];

  // Anti-vacuity. Each of these makes every assertion below meaningless. The
  // "no mutation call site" condition is judged over the WHOLE tree: the
  // crm/veh call sites prove the scanner sees real mutations even while the
  // apt/rec count is legitimately zero.
  if (scanned.length === 0) violations.push('no files were scanned');
  if (canonical.length === 0)
    violations.push('no canonical operations were derived from the register');
  if (found.length === 0)
    violations.push('no mutation call site was found anywhere in apps/web/src');

  for (const id of Object.keys(classified)) {
    if (!canonical.some((op) => op.id === id)) {
      violations.push(`manifest classifies "${id}", which is not a canonical P1-28 write`);
    }
  }

  for (const operation of canonical) {
    const entry = classified[operation.id];

    if (!entry) {
      violations.push(
        `UNWIRED: ${operation.id} (${operation.method} ${operation.route}) — a registered write ` +
          'that no screen reaches and no allow-list entry records. This is INT-113 recurring: ' +
          'wire it, or classify it NOT_YET_WIRED with a reason.'
      );
      results.push({ id: operation.id, classification: 'UNWIRED' });
      continue;
    }

    const { classification, decisionRef, reason } = entry;

    if (!CLASSIFICATIONS.includes(classification)) {
      violations.push(`malformed classification "${classification}" for ${operation.id}`);
      results.push({ id: operation.id, classification: 'MALFORMED' });
      continue;
    }

    const site = callSiteFor(operation);

    if (classification === 'REACHABLE' && !site) {
      violations.push(
        `${operation.id} is REACHABLE but no production call site sends ${operation.method} ${operation.route}`
      );
    }

    if (classification === 'NOT_YET_WIRED') {
      if (!String(reason ?? '').trim()) {
        violations.push(
          `${operation.id} is NOT_YET_WIRED with no reason; an allow-list entry that explains ` +
            'nothing is indistinguishable from an omission'
        );
      }
      if (!highWater.includes(operation.id)) {
        violations.push(
          `${operation.id} is NOT_YET_WIRED but is not on the frozen day-one allow-list — ` +
            'the ratchet only shrinks. A write registered after day one ships REACHABLE in the ' +
            'same change, or carries an approved DELIBERATELY_ABSENT decision.'
        );
      }
      if (site) {
        violations.push(
          `${operation.id} is NOT_YET_WIRED but IS called from ${site.file}; flip it to ` +
            'REACHABLE and shrink the allow-list in the same change'
        );
      }
    }

    if (classification === 'DELIBERATELY_ABSENT') {
      if (!String(decisionRef ?? '').trim()) {
        violations.push(
          `${operation.id} is DELIBERATELY_ABSENT with no decisionRef; an absence without an ` +
            'approved decision is an omission'
        );
      }
      if (site) {
        violations.push(
          `${operation.id} is DELIBERATELY_ABSENT but IS called from ${site.file}; the ` +
            'classification and the code disagree'
        );
      }
    }

    results.push({
      id: operation.id,
      classification,
      ...(site ? { callSite: site.file } : {}),
      ...(decisionRef ? { decisionRef } : {}),
    });
  }

  const counts = results.reduce((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});

  return {
    counts,
    results,
    violations,
    scanned: scanned.length,
    sites: sites.length,
    // Before the consumption filter — what the SCANNER saw. Reported separately
    // so "the scanner works" and "somebody can reach it" stay distinguishable.
    found: found.length,
    canonical,
  };
}

// Executed only when invoked as a script, never on import.
if (process.argv[1] && process.argv[1].endsWith('check-p1-28-write-reachability.mjs')) {
  const report = run();
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `P1-28 write reachability: ${report.canonical.length} canonical write(s), ` +
        `${report.scanned} production file(s), ${report.found} mutation call site(s), ` +
        `${report.sites} of them consumed.`
    );
    for (const key of [...CLASSIFICATIONS, 'UNWIRED', 'MALFORMED']) {
      if (report.counts[key]) console.log(`  ${key} = ${report.counts[key]}`);
    }
    if (report.violations.length === 0) {
      console.log(
        'OK: every canonical P1-28 write is reachable, allow-listed with a reason, or deliberately absent.'
      );
    } else {
      console.error(`\n${report.violations.length} violation(s):`);
      for (const violation of report.violations) console.error(`  ${violation}`);
    }
  }
  process.exit(report.violations.length === 0 ? 0 : 1);
}
