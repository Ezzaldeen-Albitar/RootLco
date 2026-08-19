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
 * (`rec.reception-close-without-work`, `rec.reception-refuse`), and PR #227
 * added the 21 intake-catalogue management writes. The derived set is 43
 * today — counted from the register by this gate on every run, which is why the
 * figure is stated here at all: a number in prose is a claim, and this one said
 * 35 while the derivation answered 43 and the gate’s own test pinned 43. The
 * derivation, not the prose, is the authority. An operation in
 * the register and not in the manifest is UNWIRED and fails.
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
 * function that REACHES it, and that name must be mentioned by another
 * production module (comments stripped, so a docblock naming an adapter is not
 * evidence anybody calls it). A site inside no function at all — a top-level
 * statement — is counted as it always was, because there is no export whose
 * consumption could be asked about.
 *
 * Reaches, not encloses, and the distance between the two is a blind spot this
 * gate shipped with. Attribution used to read "the last `export function`
 * declared before the site index", which is a guess wearing a rule's clothes.
 * `features/receptions/api.ts` exports two terminal closes that both delegate
 * to ONE internal `closeVisit` helper declared AFTER both of them, so both of
 * the paths that helper sends were credited to whichever export happened to be
 * declared last. Deleting every consumer of the OTHER export changed nothing
 * the gate reported — its `REACHABLE` claim stayed green while nobody could
 * invoke it, INT-113 blessed by the gate built to catch it — and deleting the
 * consumers of the last-declared one instead turned BOTH closes red, one of
 * them falsely, against an operation its screen demonstrably wires.
 *
 * So a site inside an INTERNAL function is credited to every exported function
 * that can reach it, by following the calls rather than the declaration order:
 * each caller of the helper is resolved to its own owner, and a caller that is
 * itself internal is resolved onwards through ITS callers. A name already being
 * resolved is not followed a second time, so a cycle terminates instead of
 * recurring.
 *
 * The delegation carries values as well as control, and both matter here:
 * `closeReceptionWithoutWork` passes `'/close-without-work'` where
 * `refuseReception` passes `'/refuse'`. A string literal supplied at the call
 * BINDS that parameter for that owner, so each export is credited with the path
 * its own delegation builds rather than with the union of everything the helper
 * can send — which is what makes orphaning either one of them visible. A
 * parameter the delegation does not pin keeps the type-level enumeration
 * described above, and that is the conservative direction: more candidate paths
 * for an owner, never fewer.
 *
 * An internal helper NOTHING calls reaches no export at all, and its site is
 * credited to the helper's own name. No import can bring an unexported name
 * into another module, so nothing outside the file has cause to write it, the
 * consumption question answers no, and the site drops.
 *
 * ## What the fail-closed guarantee is, stated as narrowly as it is proved
 *
 * A site is attributed to an export only when it falls INSIDE that export’s
 * body — containment, not "the last declaration above it". Three outcomes,
 * and each is exercised by a mutation in
 * `tests/ci/p1-28-write-reachability.test.ts`:
 *
 *   - inside a `function` declaration (the only adapter shape this repository
 *     writes: a census of `apps/web/src` finds zero arrow-const and zero
 *     function-expression adapters, and all 43 production sites resolve to
 *     one). Attribution is the reaching export, followed through internal
 *     helpers. Orphan its consumer and the claim turns RED.
 *   - at brace depth zero — a genuine top-level statement, which runs on
 *     import. Counted, as it always has been.
 *   - inside anything else, an arrow const or an object method among them.
 *     Attributed to NOTHING and dropped, so the claim behind it turns RED.
 *
 * The third is a deliberate false POSITIVE and is written down as one: the
 * gate refuses such a shape whether or not it is really consumed, because it
 * cannot tell. It is the direction a reachability gate should fail, and it is
 * cheap only because the census above says no such adapter exists today.
 *
 * What this paragraph does NOT claim: that every declaration form is
 * understood. It claims that a form which is not understood cannot pass a
 * `REACHABLE` claim silently — which is the property the old rule stated
 * here and did not have.
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
 * `DELIBERATELY_ABSENT` a `decisionRef` that RESOLVES — an absence with nothing
 * recorded behind it is indistinguishable from an omission, which is what this
 * gate is for.
 *
 * ## A `decisionRef` must name a decision that exists
 *
 * `DELIBERATELY_ABSENT` is the sideways exit from the allow-list: it is the one
 * classification the ratchet does not constrain, so it is the one an author
 * under pressure reaches for. The first version of this gate checked only that
 * the reference was a non-empty string, and an adversarial refuter walked a
 * fabricated `decisionRef: 'FAKE-DECISION-999'` straight through it — which
 * makes the whole route worthless, because a made-up reference reads exactly
 * like an approved one.
 *
 * So the reference is RESOLVED. `recordedDecisions` reads §7 of
 * `docs/phase-1/phase-1-28/canonical-plan.md` and returns the identifier of
 * every decision recorded there — the backticked id that opens a `###` heading
 * inside that section, and nothing else. A `decisionRef` outside that set is a
 * violation naming what it could not find. The section is the source rather
 * than a list in this file for the same reason the operation list is derived:
 * a list here would be a second authority to keep in step, and it is precisely
 * the step nobody takes.
 *
 * Failing to READ the plan, or finding no §7 at all, is exit 2 — the check
 * could not run — never a pass. An empty §7 is not a licence to classify
 * anything absent.
 *
 * Usage:  node scripts/ci/check-p1-28-write-reachability.mjs [--json]
 * Exit:   0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import {
  argumentText,
  callsToNode,
  declaredFunctionsOf,
  enclosingFunctionNode,
  isTopLevelExecutable,
  literalPathOf,
  parseModule,
  writeMethodOf,
} from '../lib/typescript-source.mjs';
import { REPOSITORY_ROOT } from '../lib/repository-paths.mjs';

const ROOT = REPOSITORY_ROOT;
const jsonOutput = process.argv.includes('--json');

const REGISTER = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json');
const MANIFEST = join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'write-reachability.json');
const PLAN = join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'canonical-plan.md');
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');

/** The plan section that records this phase's decisions. */
export const DECISIONS_SECTION = /^##\s*7\.\s/;

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

/**
 * Every decision identifier recorded in §7 of the canonical plan.
 *
 * A decision is a `###` heading INSIDE that section whose first token is a
 * backticked identifier — `` ### `P1-28-OD-001` — who administers … `` yields
 * `P1-28-OD-001`. Headings identified only by topic ("Warning-light catalogue
 * population") are real decisions and are deliberately NOT returned: they carry
 * no identifier, so nothing can reference them, and inventing one here would
 * put a name in the gate that the document does not use.
 *
 * The shape is `ABC-123`-ish and anchored — at least two dash-separated
 * segments of capitals and digits — so a heading that merely opens with a
 * backticked FILE or FIELD name cannot pass itself off as a decision.
 *
 * Returns `null` when the section is absent, which the caller treats as
 * "the check could not run" rather than as "no decisions exist".
 */
export function recordedDecisions(planMarkdown) {
  const lines = String(planMarkdown).split(/\r?\n/);
  const start = lines.findIndex((line) => DECISIONS_SECTION.test(line));
  if (start === -1) return null;

  const ids = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s/.test(line)) break; // the next top-level section ends §7
    const heading = /^###\s+`([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)`/.exec(line);
    if (heading && !ids.includes(heading[1])) ids.push(heading[1]);
  }
  return ids;
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

/**
 * Every named `function` declaration in a file, in source order.
 *
 * Both halves of a record are load-bearing. `exported` is the name `run` can
 * ask a consumption question about; the INTERNAL declarations are what a call
 * site hides inside, and following those is the whole of the attribution below.
 * The parameter texts travel with the record because two separate rules read
 * them — the literal-union enumeration, and the delegation binding.
 *
 * A generic header (`function readVisitPage<T>(…)`) is admitted by taking the
 * first `(` after the name, so type parameters are stepped over rather than
 * parsed. A function EXPRESSION assigned to a `const` is deliberately not a
 * declaration here: every adapter and server action in this tree is declared
 * with `function`, and a second shape nothing exercises would be a rule this
 * gate could not prove it implements.
 */
/** The literal-union parameters of the function a node sits inside. */
function enclosingUnions(declarations, node) {
  const enclosing = enclosingFunctionNode(node);
  const described = enclosing === null ? null : declarations.get(enclosing);
  return described === null || described === undefined
    ? new Map()
    : literalUnionParameters(described.parameters);
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
 *
 * `alternatives` is what an identifier in the argument list may stand for,
 * name → values, and it has two sources that answer two different questions.
 * The enclosing function's literal-union types say what the helper CAN be asked
 * to build; a delegation binding says what one particular exported caller DOES
 * ask it to build, and the caller of this function lets that override, so an
 * export is credited with its own path rather than with every path its shared
 * helper can send.
 */
function resolveHelperCall(helper, args, alternatives) {
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
      const candidates = identifier ? alternatives.get(identifier[1]) : undefined;
      extend(candidates ?? [':p']);
    }
  }
  return paths;
}

/**
 * Every call to `name(` in a file, as `{ index, open }` — where the call starts
 * and where its argument list opens.
 *
 * The DECLARATION is skipped, because `function closeVisit(` matches the shape
 * of a call to `closeVisit` exactly, and a helper that appeared to call itself
 * would be a cycle invented by the scanner rather than written by anybody.
 */
/**
 * The names a parameter list declares, POSITIONALLY — or `null` when it cannot
 * be read, which is a refusal rather than a best effort.
 *
 * `argumentsAt` splits on top-level commas and tracks `()`, `[]` and `{}` but
 * not angle brackets, so a parameter typed `Record<string, number>` splits in
 * two and every position after it shifts by one. Binding by position over a
 * shifted list would credit an export with a path its delegation never builds —
 * precisely the false REACHABLE this attribution exists to remove — so a list
 * carrying any entry that is not a plain `name`, `name: type` or `name = value`
 * is refused WHOLE and the call falls back to the type-level enumeration.
 * Destructured and rest parameters are refused for the same reason: neither has
 * a name a call site's argument can be bound to by position.
 */
function parameterNames(parameterTexts) {
  const names = [];
  for (const part of parameterTexts) {
    if (part.trim() === '') continue;
    const declaration = /^\s*([A-Za-z_$][\w$]*)\s*\??\s*(?::|=|$)/.exec(part);
    if (!declaration) return null;
    names.push(declaration[1]);
  }
  return names;
}

/**
 * What one call pins of a callee's parameters, as name → string value.
 *
 * A string literal at the call site binds that parameter outright. An
 * identifier binds it only when the CALLER's own parameter of that name is
 * itself already bound — which is how a value survives two hops of delegation
 * without this becoming a dataflow analysis. Anything else binds nothing and
 * leaves the parameter to the type-level enumeration, which reports more
 * candidate paths rather than fewer.
 */
function boundParameters(callee, args, callerBindings) {
  const bindings = new Map();
  const names = parameterNames(callee.parameters);
  if (names === null) return bindings;

  names.forEach((name, position) => {
    const supplied = args[position];
    if (supplied === undefined) return;
    const value = literalValue(supplied);
    if (value !== null) {
      bindings.set(name, value);
      return;
    }
    const identifier = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(supplied);
    const inherited = identifier ? callerBindings.get(identifier[1]) : undefined;
    if (inherited !== undefined) bindings.set(name, inherited);
  });
  return bindings;
}

/**
 * Every exported function that reaches `fn`, with what the route to it binds.
 *
 * The three terminating cases first. A site in no function at all belongs to
 * nobody, and is counted unconditionally because there is no export whose
 * consumption could be asked about. A site in an EXPORTED function belongs to
 * that export, with nothing bound — its parameters are supplied by callers this
 * gate does not follow, which is exactly what the literal-union enumeration is
 * for. And a name already on the current path is not followed again, so mutual
 * recursion ends rather than recurring.
 *
 * Otherwise the function is internal and the question moves to its callers:
 * every call to it in the same module is resolved to ITS owner, and the
 * arguments of that call bind the internal function’s parameters for that owner
 * alone. An internal helper nobody calls returns an EMPTY list, which the caller
 * of this function turns into the fail-closed attribution — see
 * `mutationCallSites`.
 *
 * Callers are found by ASKING THE PARSER for call expressions naming the
 * function, not by a look-behind on the identifier. The look-behind had to
 * special-case `function f(` to avoid counting a declaration as a call to
 * itself; a `CallExpression` is not a declaration, so the special case is gone
 * with the class of near-misses it stood for.
 */
function attributionsOf(sourceFile, declarations, fn, seen) {
  if (fn === null) return [{ owner: null, bindings: new Map() }];
  if (fn.exported) return [{ owner: fn.name, bindings: new Map() }];
  if (fn.name === null || seen.has(fn.name)) return [];

  const path = new Set(seen).add(fn.name);
  const reached = [];
  for (const call of callsToNode(sourceFile, fn.name)) {
    const args = call.arguments.map((argument) => argumentText(argument));
    const callerNode = enclosingFunctionNode(call);
    const caller = callerNode === null ? null : (declarations.get(callerNode) ?? null);
    for (const attribution of attributionsOf(sourceFile, declarations, caller, path)) {
      reached.push({
        owner: attribution.owner,
        bindings: boundParameters(fn, args, attribution.bindings),
      });
    }
  }
  return reached;
}
/**
 * Every mutation call site in one file, as `{ method, path, owner }`.
 *
 * ## The rule, unchanged
 *
 * A site is an API path — an inline literal, or a call to one of the file’s own
 * path helpers — with the write-method literal standing as the argument
 * IMMEDIATELY before it. Every call shape this codebase uses provides that
 * adjacency: `client.send('POST', path, …)` and the CRM-style
 * `write(previous, parse, 'POST', path, …)` both pass the method as the argument
 * directly before the path (the parse closure sits BEFORE the method, so it
 * never intervenes). A path with no adjacent write marker is a READ and is
 * ignored — which is what keeps a list GET from vouching for the POST that
 * shares its route, and what keeps a read from BORROWING the method of an
 * unrelated write elsewhere in the file.
 *
 * ## …and what "immediately before" now means
 *
 * Argument `i` and argument `i + 1` of the same call. It used to mean "the last
 * two hundred characters of text before the path end with a method literal, a
 * comma and whitespace", which is an approximation of that and was the second
 * approximation in a row here: the one before it was a two-thousand-character
 * proximity window that let a read borrow an unrelated write’s method. Both are
 * describing argument positions from the outside. The parser hands them over.
 *
 * `owner` is the exported function that REACHES the site, or `null` for a
 * top-level statement. `run` uses it to ask whether anything consumes that
 * export; see the file docblock for why an unconsumed adapter is not reach, and
 * for why one site inside a delegated-to helper yields one entry PER reaching
 * export, each carrying the path that export’s own arguments build.
 */
export function mutationCallSites(source) {
  const helpers = pathHelpers(stripComments(source));
  const sourceFile = parseModule(source);
  // A file the parser refuses yields nothing, so every claim over it goes red.
  if (sourceFile === null) return [];

  const declarations = declaredFunctionsOf(sourceFile);
  const sites = [];

  /*
   * Who a site is asked about, and what its route there pins. Exactly one entry
   * for a site at the top level or inside an export; one per reaching export
   * for a site inside an internal helper; and the helper’s OWN name when
   * nothing reaches it — so the site is still counted by the scanner, still
   * asked about, and then dropped, rather than disappearing from the tally that
   * proves the scanner works at all.
   */
  const attributionsAt = (node) => {
    const enclosingNode = enclosingFunctionNode(node);
    if (enclosingNode === null) {
      /*
       * No function contains this site, and there are two very different
       * reasons for that. A top-level STATEMENT runs when the module is
       * imported, and that is the documented case this gate has always counted.
       * Anything else in module scope — a class property initializer, say — is
       * not executed on import, so it is marked unattributable and consumption
       * refuses it rather than crediting it to a neighbour.
       */
      return [{ owner: null, bindings: new Map(), attributable: isTopLevelExecutable(node) }];
    }
    const enclosing = declarations.get(enclosingNode) ?? null;
    /*
     * A function-like node the namer could not name — an inline callback, an
     * arrow inside an object literal — has no export whose consumption could be
     * asked about. Refused rather than credited to its own enclosing scope.
     */
    if (enclosing === null || enclosing.name === null) {
      return [{ owner: null, bindings: new Map(), attributable: false }];
    }
    const reached = attributionsOf(sourceFile, declarations, enclosing, new Set());
    return reached.length > 0
      ? reached.map((one) => ({ ...one, attributable: true }))
      : [{ owner: enclosing.name, bindings: new Map(), attributable: true }];
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const args = node.arguments;
      for (let i = 0; i + 1 < args.length; i += 1) {
        const method = writeMethodOf(args[i]);
        if (method === null) continue;
        const target = args[i + 1];

        // An inline path literal, template or not.
        const literal = literalPathOf(target);
        if (literal !== null && literal.startsWith('/api/v1/')) {
          for (const { owner, attributable } of attributionsAt(target)) {
            sites.push({ method, path: literal, owner, attributable });
          }
          continue;
        }

        // …or a call to one of this file’s own path helpers.
        if (
          ts.isCallExpression(target) &&
          ts.isIdentifier(target.expression) &&
          helpers.has(target.expression.text)
        ) {
          const helperArgs = target.arguments.map((argument) => argumentText(argument));
          const unions = enclosingUnions(declarations, target);
          for (const { owner, bindings, attributable } of attributionsAt(target)) {
            // A value the delegation pins beats the type-level enumeration: the
            // union says which paths the helper CAN send, the binding says which
            // one THIS owner asks it to.
            const values = new Map(unions);
            for (const [name, value] of bindings) values.set(name, [value]);
            for (const path of resolveHelperCall(
              helpers.get(target.expression.text),
              helperArgs,
              values
            )) {
              sites.push({ method, path, owner, attributable });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

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
        `${relative(ROOT, PLAN).split(sep).join('/')} has no section 7. That section is where ` +
          'this gate resolves every DELIBERATELY_ABSENT decisionRef, so its absence means the ' +
          'check cannot run — it does not mean there is nothing to resolve against.'
      );
    }
  }

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
   * a function is not a call to it.
   *
   * A site attributed to NOTHING is refused. This read "kept as it always was;
   * there is no export whose consumption could be asked about" — a sentence
   * about a top-level statement that had quietly become the escape hatch for
   * every construct the scanner cannot read: once attribution required
   * containment, an orphaned arrow-const or object method landed here and was
   * counted as consumed, so the containment fix alone still passed a write
   * nobody can reach.
   *
   * Refusing it is safe AND meaningful, which was measured rather than
   * assumed: all 43 production write sites resolve to an enclosing exported
   * function, so nothing real depends on the old branch, and anything that
   * lands here in future is by definition a shape this gate cannot vouch for.
   * Fail closed is the direction the docblock promises.
   */
  const code = new Map(scanned.map(([path, content]) => [path, stripComments(content)]));
  const consumption = new Map();
  const consumed = (owner, file) => {
    // A genuine top-level statement runs on import; the unreadable-construct
    // case never reaches here, having been dropped as unattributable above.
    if (owner === null) return true;
    const key = `${file}\u0000${owner}`;
    if (!consumption.has(key)) {
      const named = new RegExp(`\\b${owner}\\b`);
      consumption.set(
        key,
        [...code].some(([path, content]) => path !== file && named.test(content))
      );
    }
    return consumption.get(key);
  };

  const sites = found.filter(
    (site) => site.attributable !== false && consumed(site.owner, site.file)
  );

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
      const reference = String(decisionRef ?? '').trim();
      if (!reference) {
        violations.push(
          `${operation.id} is DELIBERATELY_ABSENT with no decisionRef; an absence without an ` +
            'approved decision is an omission'
        );
      } else if (!decisions.includes(reference)) {
        violations.push(
          `${operation.id} is DELIBERATELY_ABSENT against "${reference}", which names no decision ` +
            'recorded in the canonical plan §7. A reference nothing resolves reads exactly like ' +
            `an approved one, which is why it is refused. Recorded there: ${
              decisions.length === 0 ? '(none)' : decisions.join(', ')
            }.`
        );
      }
      if (!String(reason ?? '').trim()) {
        violations.push(
          `${operation.id} is DELIBERATELY_ABSENT with no reason; the decision says why the ` +
            'surface is withheld, the reason says which operation this is and what it would have ' +
            'administered'
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
    // The decision identifiers §7 records, so a run can be read without
    // re-deriving them and a drifted plan is visible in the JSON output.
    decisions,
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
        `${report.sites} of them consumed, ` +
        `${report.decisions.length} decision(s) recorded in the plan §7.`
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
