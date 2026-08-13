#!/usr/bin/env node
/**
 * P1-28 access gate — least privilege, resolved scope and scope hygiene
 * (`P1-28-SEC-001`, `P1-28-SEC-003`).
 *
 * ## The question this answers, and how it differs from SEC-004's
 *
 * `check-p1-28-write-reachability.mjs` asks **can anybody invoke this
 * operation**. This asks the two questions that come after it: **does the
 * screen require exactly the permission its operations require, and no more**,
 * and **does anything in these trees put a scope into a request**. They are
 * different judgements over the same tree, so this is a separate gate rather
 * than a rule bolted onto one whose subject is reachability; what they share —
 * the path-helper resolver, the comment stripper, the path normalisers — is
 * IMPORTED from that gate, so there is one authority for the hard part.
 *
 * ## Why a gate and not a test
 *
 * `WRITE_PERMISSIONS` once had exactly one reference — its own declaration —
 * while ten P1-27 write forms rendered for any reader, and every automated tier
 * was green. What decides a permission property is the handful of
 * `holds(session.permissions, CODE)` lines in `src/app/**`, and a test that
 * asserts them can be deleted in the same commit as the code it guards.
 *
 * ## The six rules
 *
 *   1. **`gate-before-read`** — every P1-28 route page DENIES AND RETURNS on a
 *      permission BEFORE its first awaited read. The denial renders instead of
 *      the screen, so a denied operator never spends a request discovering it.
 *      P1-27's security suite asserts this shape for CRM and Vehicle routes
 *      only: its sweep filters `PHASE_ROUTES` to `/(crm|vehicles)/`, so every
 *      appointment and reception route was structurally outside it.
 *
 *      Both halves of the measurement are positional and both were once wrong,
 *      which is worth stating because each error pointed the same way — toward
 *      reporting clean. The gate's position was `indexOf('holds(')`, the first
 *      `holds` OF ANY KIND, and a route page is full of the other kind
 *      (`canManage={holds(…)}` computes a capability for a control and returns
 *      nothing); a route whose deny gate stood after its first read would still
 *      have measured clean, answered for by a line this rule is not about. The
 *      read's position was the prefix `await (read|list|search)[A-Z]`, which
 *      matched `await searchParams` — a Next.js prop, not a read — and missed
 *      `await Promise.all([listAppointmentTypes(), …])`, which is how two of
 *      these eight routes read. So the gate is now found by SHAPE (a negated
 *      `holds` whose branch returns) and the read by the CALLEE'S ORIGIN (an
 *      imported function whose module issues an API call), at any depth inside
 *      the awaited expression.
 *   2. **`code-published`** — every permission code these trees consult is a
 *      code some published operation registers, read from the P1-24 operation
 *      register. A typo, an invented code and a plausible-but-wrong constant
 *      all fail here, and all three fail toward showing MORE than intended.
 *   3. **`contract-covers-domain`** — the other direction: every permission any
 *      published `apt.*`/`rec.*` operation registers appears in this phase's
 *      contract permission maps. A backend code the interface never learned
 *      about is a screen that will deny for a reason nobody wrote down.
 *   4. **`least-privilege`** — per route, the codes it consults are a SUBSET of
 *      the codes required by the operations reachable from it. "Reachable"
 *      means: called from the route's own import closure, or from the closure
 *      of a route it directly links to — a navigation affordance is correctly
 *      gated on the permission of the operation it leads to, and gating it on
 *      anything else would either dead-end the operator in a denial or hide a
 *      path they may take. ONE link level, deliberately: the transitive closure
 *      of the dashboard's links is very nearly every route, which would make
 *      this rule true by construction and prove nothing.
 *   5. **`no-scope-in-a-url`** — the half of P1-27's `no-client-asserted-scope`
 *      whose premise survives in these trees. `rec.reception-create` takes
 *      `companyId` and `branchId` as REQUIRED BODY fields and both list reads
 *      as a mandatory query pair (`P1-18-A-01`), so the flat rule's premise —
 *      "scope is resolved server-side" — is false here and the P1-27 gate
 *      narrows itself out of these trees by a rule-level `roots` distinction.
 *      What remains true is narrower and still worth enforcing: the pair is a
 *      resource selector that travels through ONE named door
 *      (`branchTargetQuery`), so no scope name may be built into a URL or a
 *      query-string literal anywhere here, and `tenantId` — a selector on no
 *      operation anywhere — may not appear at all.
 *   6. **`route-owns-the-gate`** — no file inside the P1-28 FEATURE trees calls
 *      `holds(…)`. `features/receptions/check-in/wizard.ts` states this as a
 *      fact ("The route is the single place `holds(...)` is called") and
 *      nothing enforced it, so rules 2 and 4 — which read route pages — were
 *      complete only for as long as that sentence stayed true by habit. A
 *      permission consulted in a feature module is one no route-scoped rule can
 *      see, which is the shape of every defect this gate exists for.
 *
 * Rule 5 is a NARROWING of a narrowing, not an exemption: it applies to every
 * file in these trees, present and future, and nothing is listed by name. The
 * repository's own gate suite refuses `allow` entries for exactly this reason.
 *
 * ## What each rule is rooted at, and why they differ
 *
 * Rules 1, 2 and 4 are route-rooted; rule 6 is tree-rooted; rules 2 and 4 ALSO
 * read every file of a route's import closure that lies inside the P1-28 trees,
 * so a code consulted one module below a page is judged by the same two rules
 * as one consulted in it.
 *
 * That left `components/**` and `lib/**` under no root at all, while every one
 * of these eight routes imports between 24 and 34 files from there. Rule 5's
 * URL clause is therefore extended to each route's WHOLE import closure — the
 * clause whose premise ("a scope name may not be built into a URL") holds for
 * any file a P1-28 screen loads. Its tenant clause is NOT extended, and that is
 * a judgement rather than an oversight: `tenantId` is a legitimate SESSION
 * claim in `features/authentication/**` and `lib/api/session-cookie.ts` — the
 * tenant a session belongs to, resolved server-side, never a selector a client
 * asserts — so the never-name-it clause stays where its premise is true, which
 * is the trees P1-28 owns and where no such claim exists.
 *
 * ## Anti-vacuity
 *
 * A checker that resolves nothing passes everything. Each of these fails the
 * run outright: no route pages found, no permission constants resolved, no API
 * call site found anywhere in the scanned trees, a route whose import closure
 * is smaller than the file itself, no route on which an awaited read could be
 * recognised at all (rule 1's read half, dead), and a `holds()` argument this
 * gate cannot resolve to a literal code (fail closed — an unresolvable
 * expression is not a permission this gate has checked).
 *
 * Usage: node scripts/ci/check-p1-28-access.mjs [--json]
 * Exit:  0 clean · 1 a violation · 2 the check could not run.
 */
import { existsSync, readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { REPOSITORY_ROOT } from '../lib/repository-paths.mjs';
import { literalMask, SCOPE_NAMES } from './check-p1-27-frontend.mjs';
import {
  literalUnionParameters,
  normaliseRoutePath,
  normaliseSourcePaths,
  pathHelpers,
  stripComments,
} from './check-p1-28-write-reachability.mjs';

const ROOT = REPOSITORY_ROOT;
const jsonOutput = process.argv.includes('--json');

const REGISTER = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json');
const COMPOSED = join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'composed-permissions.json');
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');
const DASHBOARD = join(WEB_SRC, 'app', '[locale]', '(dashboard)');

/**
 * The feature trees P1-28 owns, quoted from `canonical-plan.md` §9.
 *
 * §9 is the only authority that names a path, and it names exactly these two
 * plus the whole `(dashboard)` tree: "Frontend work lives in
 * `apps/web/src/features/appointments/**`, `apps/web/src/features/receptions/**`
 * and `apps/web/src/app/[locale]/(dashboard)/**`."
 */
export const FEATURE_TREES = Object.freeze([
  join('apps', 'web', 'src', 'features', 'appointments'),
  join('apps', 'web', 'src', 'features', 'receptions'),
]);

const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'dist']);
const SOURCE = /\.(ts|tsx)$/;
const IS_TEST = /\.(test|spec)\.[jt]sx?$/;

function fail(message) {
  console.error(message);
  process.exit(2);
}

/** Every non-test source file under `dir`, POSIX-spelled, repository-relative. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (lstatSync(full).isSymbolicLink()) {
      fail(`${full} is a symbolic link; this gate refuses to walk one.`);
    }
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(entry) && !IS_TEST.test(entry)) out.push(full);
  }
  return out;
}

export function posix(path) {
  return path.split(sep).join('/');
}

/* ------------------------------------------------------------------ *
 * Permission constants — `APPOINTMENT_PERMISSIONS.read` → the code
 * ------------------------------------------------------------------ */

/** A permission code's shape: `domain.subject[.qualifier].verb`. */
const CODE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/**
 * Every `Object.property` and bare identifier this repository binds to a
 * permission code, derived from the source rather than listed.
 *
 * Two declaration shapes carry them, and both are read:
 *
 *     export const RECEPTION_PERMISSIONS = { read: 'rec.reception.read', … };
 *     export const WORK_ORDER_READ_PERMISSION = 'wo.work_order.read';
 *
 * A hand-written table here would be a third statement of the same fact, and
 * this repository has been bitten three times by a hand-written list that could
 * only fail when one of ITS entries went missing.
 */
export function permissionConstants(files) {
  const byMember = new Map();
  const byName = new Map();

  for (const [, source] of files) {
    const text = stripComments(source);

    const objectDeclaration =
      /\bexport\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*\{([\s\S]*?)\}\s*as\s+const/g;
    let match;
    while ((match = objectDeclaration.exec(text)) !== null) {
      const [, name, body] = match;
      const entry = /([A-Za-z_$][\w$]*)\s*:\s*(['"])((?:(?!\2).)*)\2/g;
      let field;
      while ((field = entry.exec(body)) !== null) {
        if (CODE.test(field[3])) byMember.set(`${name}.${field[1]}`, field[3]);
      }
    }

    const scalar =
      /\bexport\s+const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*string\s*)?=\s*(['"])((?:(?!\2).)*)\2/g;
    while ((match = scalar.exec(text)) !== null) {
      if (CODE.test(match[3])) byName.set(match[1], match[3]);
    }
  }

  return { byMember, byName };
}

/**
 * The permission codes one source consults through `holds(…)`.
 *
 * Returns `{ codes, unresolved }`. An argument this gate cannot reduce to a
 * literal is reported rather than skipped: a permission check nobody can read
 * is a permission check nobody has verified, and silently passing over it is
 * how a rule reports clean over the one line that decides the property.
 */
export function consultedPermissions(source, constants) {
  const text = stripComments(source);
  const codes = new Set();
  const unresolved = [];
  /*
   * Import aliases, resolved rather than skipped. The check-in start screen
   * imports the Administration permission map as
   * `import { PERMISSIONS as ADMIN_PERMISSIONS }` and consults
   * `ADMIN_PERMISSIONS.userRead` — the `iam.user.read` overload the
   * receiving-employee picker needs. A gate that could not read that line would
   * be blind to the single most over-broad code on the P1-28 surface.
   */
  const aliases = new Map();
  const named = /\bimport\s*(?:type\s+)?\{([^}]*)\}\s*from/g;
  let clause;
  while ((clause = named.exec(text)) !== null) {
    for (const part of clause[1].split(',')) {
      const alias = /^\s*([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(part);
      if (alias) aliases.set(alias[2], alias[1]);
    }
  }
  const canonicalName = (name) => aliases.get(name) ?? name;

  const call = /\bholds\s*\(/g;
  let match;
  while ((match = call.exec(text)) !== null) {
    const parsed = splitArguments(text, match.index + match[0].length - 1);
    if (parsed === null || parsed.args.length < 2) continue;
    const argument = parsed.args[1].trim();

    const literal = /^(['"])((?:(?!\1).)*)\1$/.exec(argument);
    if (literal) {
      codes.add(literal[2]);
      continue;
    }
    const member = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(argument);
    const key = member ? `${canonicalName(member[1])}.${member[2]}` : canonicalName(argument);
    if (constants.byMember.has(key)) {
      codes.add(constants.byMember.get(key));
      continue;
    }
    if (constants.byName.has(key)) {
      codes.add(constants.byName.get(key));
      continue;
    }
    unresolved.push(argument);
  }

  return { codes: [...codes].sort(), unresolved };
}

/* ------------------------------------------------------------------ *
 * Rule 1 — where the DENY gate stands, and what counts as a read
 * ------------------------------------------------------------------ */

/**
 * The index of the bracket closing the one that opens at `open`, or `null`.
 *
 * Quote- and template-aware, so a brace inside a string or a JSX attribute
 * value does not move the depth. Returns `null` when the source does not
 * balance, and every caller treats that as "not recognised" rather than as
 * "fine" — a shape this gate cannot parse is not a shape it has checked.
 */
function balancedEnd(text, open) {
  if (!'([{'.includes(text[open])) return null;
  let depth = 0;
  let quote = null;
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
    if ('([{'.includes(character)) {
      depth += 1;
      continue;
    }
    if (')]}'.includes(character)) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

/**
 * The index of the permission gate that DENIES AND RETURNS, or `-1`.
 *
 * ## Why not `indexOf('holds(')`
 *
 * That measured the first `holds` of any kind. A route page is full of the
 * other kind — `canManage={holds(session.permissions, …)}` computes a
 * capability for a control and returns nothing — and the check-in wizard passes
 * THIRTEEN of them down in one object literal. A page whose deny gate stood
 * after its first read would still have measured clean, because a capability
 * expression higher up the file answered for a rule it is not about.
 *
 * A gate qualifies on two conditions, and both matter. The condition must
 * NEGATE a `holds(…)`: `if (holds(…)) { … }` guards the happy path and denies
 * nobody. And the consequent must RETURN: a negated condition that falls
 * through renders the screen it was written to stop.
 */
export function denyAndReturnGate(text) {
  const conditionals = /\bif\s*\(/g;
  let match;
  while ((match = conditionals.exec(text)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = balancedEnd(text, open);
    if (close === null) continue;
    if (!/![\s(]*holds\s*\(/.test(text.slice(open + 1, close))) continue;

    let cursor = close + 1;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    let consequent;
    if (text[cursor] === '{') {
      const end = balancedEnd(text, cursor);
      if (end === null) continue;
      consequent = text.slice(cursor, end + 1);
    } else {
      const end = text.indexOf(';', cursor);
      consequent = text.slice(cursor, end === -1 ? text.length : end + 1);
    }
    if (/\breturn\b/.test(consequent)) return match.index;
  }
  return -1;
}

/**
 * The identifiers the deny gate's own condition reads.
 *
 * Member names are dropped first, so `session.permissions` contributes
 * `session` and not `permissions` — a value bound to a name that merely happens
 * to match a property of the gate's subject is not the gate's precondition.
 */
export function gateInputs(text, gateIndex) {
  if (gateIndex < 0) return new Set();
  const open = text.indexOf('(', gateIndex);
  const close = open === -1 ? null : balancedEnd(text, open);
  if (close === null) return new Set();
  const condition = text.slice(open + 1, close).replace(/\.\s*[A-Za-z_$][\w$]*/g, '');
  return new Set(condition.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

/** A name that reads something, by the convention this codebase uses. */
const READS_BY_NAME = /^(?:read|list|search|fetch|load|get)[A-Z]/;

/** A module that talks to the platform API in its own body. */
const ISSUES_A_REQUEST = /['"`]\/api\/v1\//;

/**
 * The imported callees of one file that fetch, resolved by the callee's ORIGIN.
 *
 * ## Why the origin and not the spelling
 *
 * The prefix regex this replaces (`await (read|list|search)[A-Z]`) judged a
 * call by how it was written at the call site, which is wrong in both
 * directions at once. It matched `await searchParams` — a Next.js prop, not a
 * read, and present on two of these routes — and it could not see
 * `await Promise.all([listAppointmentTypes(), listSourceChannels()])`, which is
 * how the booking screen reads its two catalogues and how the acknowledgement
 * screen reads its three collections. Half these routes read through a shape it
 * was structurally unable to recognise.
 *
 * A name qualifies here only if it is IMPORTED, its module resolves inside
 * `apps/web/src`, that module issues an API request of its own, and the local
 * binding reads as a read. `searchParams` satisfies none of them; every read
 * these eight routes actually perform satisfies all four.
 */
export function importedReadCallees(file, source, read) {
  const text = stripComments(source);
  const names = new Set();
  const clauses = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])((?:(?!\2).)+)\2/g;
  let match;
  while ((match = clauses.exec(text)) !== null) {
    const origin = resolveSpecifier(file, match[3]);
    if (origin === null) continue;
    const originSource = read(origin);
    if (originSource === null || !ISSUES_A_REQUEST.test(stripComments(originSource))) continue;
    for (const part of match[1].split(',')) {
      const binding = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(
        part
      );
      if (binding === null) continue;
      const local = binding[2] ?? binding[1];
      if (READS_BY_NAME.test(local)) names.add(local);
    }
  }
  return names;
}

/** Where the statement containing `from` ends: the next top-level `;` or `)`. */
function statementEnd(text, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < text.length; i += 1) {
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
    if ('([{'.includes(character)) {
      depth += 1;
      continue;
    }
    if (')]}'.includes(character)) {
      if (depth === 0) return i;
      depth -= 1;
      continue;
    }
    if (character === ';' && depth === 0) return i;
  }
  return text.length;
}

/**
 * The index of the first `await` whose expression calls one of `callees`.
 *
 * The whole awaited expression is searched, at any bracket depth, so a call
 * inside `Promise.all([…])` counts exactly as much as a bare one — which is the
 * point: two of these routes read only that way.
 *
 * `gateReads` is the set of identifiers the deny gate's own condition consults,
 * and an awaited read BOUND to one of them is skipped. That is not an
 * exemption for a named function: it is the observation that a gate reading
 * `session.permissions` cannot possibly precede whatever produced `session`.
 * Stating it structurally means `const session = await readSession()` is
 * treated the same as `await requireSession(locale)`, rather than one of them
 * passing by an accident of spelling.
 */
export function firstAwaitedRead(text, callees, gateReads = new Set()) {
  if (callees.size === 0) return -1;
  const alternatives = [...callees].map((name) => name.replace(/[$]/g, '\\$&')).join('|');
  const calls = new RegExp(`\\b(?:${alternatives})\\s*\\(`);
  const awaits = /\bawait\b/g;
  let match;
  while ((match = awaits.exec(text)) !== null) {
    const expression = text.slice(match.index, statementEnd(text, match.index));
    if (!calls.test(expression)) continue;
    const before = text.slice(Math.max(0, match.index - 200), match.index);
    const binding = /(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*=\s*$/.exec(
      before
    );
    const bound = binding === null ? [] : (binding[1].match(/[A-Za-z_$][\w$]*/g) ?? []);
    if (bound.some((name) => gateReads.has(name))) continue;
    return match.index;
  }
  return -1;
}

/* ------------------------------------------------------------------ *
 * API call sites — path AND method, for reads as well as writes
 * ------------------------------------------------------------------ */

/**
 * A parenthesised argument list, split on top-level commas.
 *
 * Ten lines rather than an import, and deliberately so: SEC-004's gate is the
 * frozen authority for write REACHABILITY and this one asks a different
 * question, so the reachability gate is cited and not edited. What is genuinely
 * hard — resolving a path built by a helper — is imported from it
 * (`pathHelpers`), which is where a second authority would actually hurt.
 */
function splitArguments(text, open) {
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
    if ('([{'.includes(character)) {
      depth += 1;
      continue;
    }
    if (')]}'.includes(character)) {
      depth -= 1;
      if (depth === 0) {
        args.push(text.slice(start, i));
        return { args, end: i };
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

/**
 * Functions that send a write on a path handed to them — resolved by SHAPE.
 *
 * `writeVehicle(previous, parse, path, successKey)` issues
 * `client.send('POST', path, …)` INSIDE itself, so its call sites carry no
 * method literal at all and the adjacency rule reads every one of them as a
 * read. Nine P1-27 vehicle writes are built that way, one of which — the
 * odometer reading — is the operation a P1-28 wizard step invokes and the
 * reason `veh.vehicle.odometer.record` is on that route.
 *
 * A wrapper qualifies when its body sends a write method on one of its own
 * PARAMETERS. Named by nobody: a tenth wrapper is recognised the day it is
 * written, and a function that merely mentions `'POST'` is not one.
 */
export function writeWrappers(sources) {
  const wrappers = new Map();
  const declaration =
    /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g;
  for (const [, source] of sources) {
    const text = stripComments(source);
    let match;
    while ((match = declaration.exec(text)) !== null) {
      const parsed = splitArguments(text, match.index + match[0].length - 1);
      if (parsed === null) continue;
      const names = parsed.args
        .map((part) => /^\s*([A-Za-z_$][\w$]*)/.exec(part))
        .filter(Boolean)
        .map((found) => found[1]);
      // The body: from the parameter list to the next declaration, which is
      // enough for these one-call wrappers and never reaches past a sibling.
      const body = text.slice(parsed.end, parsed.end + 1200);
      const send =
        /\.send\s*(?:<[^>]*>)?\s*\(\s*['"](POST|PUT|PATCH)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(
          body
        );
      if (send && names.includes(send[2])) wrappers.set(match[1], send[1]);
    }
  }
  return wrappers;
}

/** Literal-union parameters of the nearest `function` header before `index`. */
function enclosingUnions(text, index) {
  const declaration = /\bfunction\s+[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*\(/g;
  let nearest = null;
  let match;
  while ((match = declaration.exec(text)) !== null) {
    if (match.index > index) break;
    nearest = match;
  }
  if (nearest === null) return new Map();
  const parsed = splitArguments(text, nearest.index + nearest[0].length - 1);
  return parsed === null ? new Map() : literalUnionParameters(parsed.args);
}

/** The literal template text that continues after a `${helper(…)}` hole. */
function templateTail(text, closeIndex) {
  if (text[closeIndex + 1] !== '}') return '';
  const rest = text.slice(closeIndex + 2);
  const tail = /^([A-Za-z0-9\-_/]*)/.exec(rest);
  return tail ? tail[1] : '';
}

/**
 * Every API call site in one source, as `{ method, path }`.
 *
 * The method is POST/PUT/PATCH when a write-method literal stands as the
 * argument IMMEDIATELY before the path — the adjacency rule SEC-004's gate
 * established — or when the path is an argument to a write WRAPPER; and GET
 * otherwise, which is what every read shape here is (`client.get(path)`,
 * `readOperation(path)`).
 *
 * Reads matter to THIS gate in a way they do not to SEC-004's: a screen's
 * required permission set is mostly read codes, and a gate that saw only
 * mutations would compute an empty requirement for every read-only route and
 * then report its perfectly correct read gate as surplus privilege.
 *
 * `helpers` is GLOBAL rather than per-file, unlike SEC-004's: `vehicleBase` is
 * declared in `features/vehicles/write-support.ts` and called from three other
 * modules, so a per-file map sees none of those call sites.
 */
export function apiCallSites(source, helpers = new Map(), wrappers = new Map()) {
  const stripped = stripComments(source);
  const sites = [];

  const methodAt = (text, index, ranges) => {
    const window = text.slice(Math.max(0, index - 200), index);
    const adjacent = /['"](POST|PUT|PATCH)['"]\s*,\s*$/.exec(window);
    if (adjacent) return adjacent[1];
    const range = ranges.find((entry) => index > entry.start && index < entry.end);
    return range ? range.method : 'GET';
  };

  /** The argument spans of every write-wrapper call in this file. */
  const wrapperRanges = [];
  if (wrappers.size > 0) {
    const names = [...wrappers.keys()].map((name) => name.replace(/[$]/g, '\\$&'));
    const wrapperCall = new RegExp(`\\b(${names.join('|')})\\s*(?:<[^>]*>)?\\s*\\(`, 'g');
    let call;
    while ((call = wrapperCall.exec(stripped)) !== null) {
      const parsed = splitArguments(stripped, call.index + call[0].length - 1);
      if (parsed === null) continue;
      wrapperRanges.push({
        start: call.index,
        end: parsed.end,
        method: wrappers.get(call[1]),
      });
    }
  }

  // Helper-built paths, resolved on the STRIPPED source: the interpolation
  // normaliser would erase `${vehicleBase(id)}` before it could be read.
  if (helpers.size > 0) {
    const names = [...helpers.keys()].map((name) => name.replace(/[$]/g, '\\$&'));
    const helperCall = new RegExp(`\\b(${names.join('|')})\\s*\\(`, 'g');
    let call;
    while ((call = helperCall.exec(stripped)) !== null) {
      const parsed = splitArguments(stripped, call.index + call[0].length - 1);
      if (parsed === null) continue;
      const helper = helpers.get(call[1]);
      const unions = enclosingUnions(stripped, call.index);
      const tail = templateTail(stripped, parsed.end);
      const method = methodAt(stripped, call.index, wrapperRanges);
      for (const path of resolveHelper(helper, parsed.args, unions)) {
        sites.push({ method, path: `${path}${tail}` });
      }
    }
  }

  // Inline literals, on the normalised source so an interpolated identifier
  // compares equal to a registered `{param}` segment.
  const text = normaliseSourcePaths(stripped);
  const pathPattern = /['"`](\/api\/v1\/[^'"`\s]*)['"`]/g;
  let match;
  while ((match = pathPattern.exec(text)) !== null) {
    sites.push({ method: methodAt(text, match.index, wrapperRanges), path: match[1] });
  }

  return sites;
}

/** Every path one helper call can build. More than one only for a union tail. */
function resolveHelper(helper, args, unions) {
  let paths = [''];
  const extend = (candidates) => {
    const next = [];
    for (const prefix of paths) for (const candidate of candidates) next.push(prefix + candidate);
    paths = next;
  };

  for (const segment of helper.segments) {
    if (segment.kind === 'literal') {
      extend([segment.text]);
      continue;
    }
    if (segment.kind === 'opaque') {
      extend([':p']);
      continue;
    }
    const supplied = args[segment.index];
    if (supplied === undefined) {
      extend([helper.params[segment.index]?.default ?? ':p']);
      continue;
    }
    const literal = /^\s*(['"`])((?:(?!\1)[^\\])*)\1\s*$/.exec(supplied);
    if (literal) {
      extend([literal[2]]);
      continue;
    }
    const identifier = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(supplied);
    const union = identifier ? unions.get(identifier[1]) : undefined;
    extend(union ?? [':p']);
  }
  return paths;
}

/* ------------------------------------------------------------------ *
 * Import closure
 * ------------------------------------------------------------------ */

/** Where an import specifier resolves inside `apps/web/src`, or `null`. */
export function resolveSpecifier(fromFile, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = join(WEB_SRC, ...specifier.slice(2).split('/'));
  else if (specifier.startsWith('.')) base = join(dirname(fromFile), ...specifier.split('/'));
  else return null;

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    base,
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every module specifier a source imports from. */
export function importSpecifiers(source) {
  const text = stripComments(source);
  const found = new Set();
  const pattern = /\bfrom\s*(['"])((?:(?!\1).)+)\1|\bimport\s*\(\s*(['"])((?:(?!\3).)+)\3/g;
  let match;
  while ((match = pattern.exec(text)) !== null) found.add(match[2] ?? match[4]);
  return [...found];
}

/** The transitive set of `apps/web/src` files reachable from `entry`. */
export function importClosure(entry, read) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    const source = read(file);
    if (source === null) continue;
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved === null || seen.has(resolved)) continue;
      seen.add(resolved);
      queue.push(resolved);
    }
  }
  return [...seen];
}

/* ------------------------------------------------------------------ *
 * Route links — `/${locale}/receptions/check-in` → its page file
 * ------------------------------------------------------------------ */

/**
 * The dashboard routes one source navigates to, as page-file paths.
 *
 * A locale-prefixed application path is the one link shape these screens use
 * (`href={`/${locale}/appointments/new`}`, `router.push(…)`), so the leading
 * interpolation is the marker. A dynamic segment matches a `[param]`
 * directory, which is how `/${locale}/appointments/${row.id}` finds
 * `appointments/[appointmentId]/page.tsx`.
 */
export function linkedRoutes(source, segments = routeSegments()) {
  const text = normaliseSourcePaths(stripComments(source));
  const found = new Set();
  const pattern = /['"`]\/:p\/([A-Za-z0-9\-_/:]*)['"`]/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const parts = match[1].split('/').filter((part) => part !== '');
    if (parts.length === 0 || !segments.includes(parts[0])) continue;
    const page = resolvePageForPath(parts);
    if (page !== null) found.add(page);
  }
  return [...found];
}

/** `['appointments', ':p']` → the page file that serves it, or `null`. */
function resolvePageForPath(segments) {
  let directory = DASHBOARD;
  for (const segment of segments) {
    const literal = join(directory, segment);
    if (segment !== ':p' && existsSync(literal) && statSync(literal).isDirectory()) {
      directory = literal;
      continue;
    }
    const dynamic = readdirSync(directory).find(
      (entry) =>
        entry.startsWith('[') &&
        entry.endsWith(']') &&
        statSync(join(directory, entry)).isDirectory()
    );
    if (dynamic === undefined) return null;
    directory = join(directory, dynamic);
  }
  const page = join(directory, 'page.tsx');
  return existsSync(page) ? page : null;
}

/* ------------------------------------------------------------------ *
 * Rule 5 — a scope name built into a URL
 * ------------------------------------------------------------------ */

/**
 * Scope names these trees place into a URL or a query-string literal.
 *
 * The literal mask is P1-27's, imported rather than restated. What is narrowed
 * is WHICH literals count: `found['companyId'] = 'field.required'` is a form
 * error keyed by a control name and is not a request, while `'?companyId='` or
 * `` `/api/v1/appointments?branchId=${id}` `` is the act this rule forbids. So a
 * literal qualifies only when it also carries a query assignment or the API
 * prefix. `tenantId` is judged separately and everywhere, because it is a
 * published selector on no operation in the platform.
 */
export function scopeInUrl(source) {
  const text = stripComments(source);
  const inside = literalMask(text);
  const found = [];

  const bounds = (index) => {
    let start = index;
    let end = index;
    while (start > 0 && inside[start - 1]) start -= 1;
    while (end < text.length - 1 && inside[end + 1]) end += 1;
    return text.slice(start, end + 1);
  };

  const scan = new RegExp(`\\b(?:${SCOPE_NAMES.join('|')})\\b`, 'g');
  let match;
  while ((match = scan.exec(text)) !== null) {
    const name = match[0];
    if (name === 'tenantId' || name === 'tenant_id') {
      found.push({ name, why: 'a tenant is a selector on no operation and must never be named' });
      continue;
    }
    if (!inside[match.index]) continue;
    const literal = bounds(match.index);
    if (/[?&][^'"`\s]*=|\/api\//.test(literal)) {
      found.push({ name, why: 'built into a URL or query string' });
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * Composed permissions — what the DATABASE demands beyond the operation
 * ------------------------------------------------------------------ */

/**
 * The composition record, with every citation OPENED and checked.
 *
 * Returns `{ byOperation, violations }`. A row survives only if the migration it
 * names really contains the policy it names, and that policy statement really
 * ends up asking `iam.has_permission('<permission>')`. A record nobody re-reads
 * is a place to park a permission; a record the gate re-reads is evidence.
 *
 * The policy statement is bounded at the next `CREATE POLICY` or the next
 * `GRANT`, so a permission mentioned by a NEIGHBOURING policy cannot vouch for
 * this one — which is the whole failure mode of a substring search over a
 * migration that declares three policies on the same table.
 */
export function composedPermissions(manifest, readMigration) {
  const byOperation = new Map();
  const violations = [];

  for (const row of manifest.composed ?? []) {
    const { permission, operation: operationId, policies } = row;
    if (!permission || !operationId || !Array.isArray(policies) || policies.length === 0) {
      violations.push(
        `composed-permission: a row is missing its permission, its operation or its policies`
      );
      continue;
    }
    if (!String(row.why ?? '').trim()) {
      violations.push(`composed-permission: ${permission} on ${operationId} explains nothing`);
      continue;
    }

    let verified = 0;
    for (const citation of policies) {
      const source = readMigration(citation.migration);
      if (source === null) {
        violations.push(
          `composed-permission: ${permission} cites ${citation.migration}, which cannot be read`
        );
        continue;
      }
      const start = source.indexOf(`CREATE POLICY ${citation.policy}`);
      if (start === -1) {
        violations.push(
          `composed-permission: ${citation.migration} declares no policy named ${citation.policy}`
        );
        continue;
      }
      const rest = source.slice(start + 1);
      const nextPolicy = rest.indexOf('CREATE POLICY');
      const nextGrant = rest.indexOf('GRANT ');
      const bounds = [nextPolicy, nextGrant].filter((index) => index !== -1);
      const statement = rest.slice(0, bounds.length > 0 ? Math.min(...bounds) : undefined);
      if (!statement.includes(`iam.has_permission('${permission}')`)) {
        violations.push(
          `composed-permission: ${citation.policy} no longer demands ${permission}; the ` +
            'composition this record claims has stopped being true'
        );
        continue;
      }
      verified += 1;
    }

    if (verified > 0) {
      const codes = byOperation.get(operationId) ?? new Set();
      codes.add(permission);
      byOperation.set(operationId, codes);
    }
  }

  return { byOperation, violations };
}

/* ------------------------------------------------------------------ *
 * The check
 * ------------------------------------------------------------------ */

export function run(injected = {}) {
  let register = injected.register;
  if (!register) {
    try {
      register = JSON.parse(readFileSync(REGISTER, 'utf8'));
    } catch (error) {
      fail(`Cannot read the operation register: ${error.message}`);
    }
  }

  let manifest = injected.composed;
  if (!manifest) {
    try {
      manifest = JSON.parse(readFileSync(COMPOSED, 'utf8'));
    } catch (error) {
      fail(`Cannot read the composed-permission record: ${error.message}`);
    }
  }
  const readMigration =
    injected.readMigration ??
    ((relative) => {
      try {
        return readFileSync(join(ROOT, ...relative.split('/')), 'utf8');
      } catch {
        return null;
      }
    });
  const composition = composedPermissions(manifest, readMigration);

  const operations = register.operations ?? [];
  /** Every permission code any published operation registers. */
  const published = new Set(operations.flatMap((op) => op.permissions ?? []));
  /*
   * Every code a composition record adds is ALSO a published code — the
   * database asks `iam.has_permission`, which reads the same catalogue — so it
   * counts for rule 2 as well. Recorded here rather than special-cased there.
   */
  for (const codes of composition.byOperation.values()) {
    for (const code of codes) published.add(code);
  }
  /** `GET /api/v1/appointments/:p` → the codes that operation requires. */
  const byRoute = new Map();
  for (const op of operations) {
    const key = `${op.method} ${normaliseRoutePath(op.route)}`;
    const codes = byRoute.get(key) ?? new Set();
    for (const code of op.permissions ?? []) codes.add(code);
    // WF-27 and its kind: what the DATABASE demands beyond what the route
    // registers. Without this the least-privilege rule reports a screen's
    // correctly-resolved second permission as surplus privilege.
    for (const code of composition.byOperation.get(op.id) ?? []) codes.add(code);
    byRoute.set(key, codes);
  }

  const sources = injected.sources ?? collectSources();
  const read = (file) => sources.get(file) ?? null;

  const routes = injected.routes ?? phaseRoutes(read);
  const segments = routeSegments(read);
  const inFeatureTree = (file) =>
    FEATURE_TREES.some((tree) => posix(file).includes(`/${posix(tree)}/`));
  const treeFiles = [...sources.keys()].filter(inFeatureTree);

  const entries = [...sources.entries()];
  const constants = permissionConstants(entries);
  /*
   * The path helpers and write wrappers are GLOBAL, gathered once across the
   * whole tree. `vehicleBase` is declared in `features/vehicles/write-support.ts`
   * and called from three other modules; a per-file map — which is what SEC-004's
   * gate needs, because a write it cannot see fails closed there — would see none
   * of those call sites and would silently under-compute every requirement here.
   */
  const helpers = new Map();
  for (const [, source] of entries) {
    for (const [name, helper] of pathHelpers(stripComments(source))) helpers.set(name, helper);
  }
  const wrappers = writeWrappers(entries);
  const sitesOf = new Map(
    entries.map(([file, source]) => [file, apiCallSites(source, helpers, wrappers)])
  );

  const violations = [...composition.violations];
  const report = [];

  // --- anti-vacuity ------------------------------------------------------
  if (composition.byOperation.size === 0) {
    violations.push(
      'no composed permission survived its citation check; WF-27 is a fact about this platform ' +
        'and a record that verifies nothing would make the least-privilege rule wrong'
    );
  }
  if (routes.length < 8) {
    violations.push(
      `only ${routes.length} P1-28 route page(s) were derived from the (dashboard) tree; this ` +
        'gate learns nothing from a tree it cannot see'
    );
  }
  if (segments.length < 3) {
    violations.push(
      `only ${segments.length} route segment(s) were derived; the eight shipped pages sit under ` +
        'three, and a shorter list means the derivation collapsed'
    );
  }
  if (constants.byMember.size + constants.byName.size < 10) {
    violations.push('fewer than ten permission constants were resolved; the derivation is broken');
  }
  if (treeFiles.length < 20) {
    violations.push(`only ${treeFiles.length} file(s) were collected from the P1-28 feature trees`);
  }

  const everySite = [...sitesOf.values()].flat();
  if (everySite.length === 0) {
    violations.push('no API call site was found anywhere in apps/web/src');
  }
  if (wrappers.size === 0) {
    violations.push(
      'no write wrapper was recognised; every wrapped write would be read as a GET and every ' +
        'write permission would look like surplus privilege'
    );
  }

  // --- rule 3: the contract maps cover the whole apt/rec surface ----------
  const contractCodes = new Set([...constants.byMember.values(), ...constants.byName.values()]);
  for (const operation of operations) {
    if (!/^(apt|rec)\./.test(operation.id)) continue;
    for (const code of operation.permissions ?? []) {
      if (!contractCodes.has(code)) {
        violations.push(
          `contract-covers-domain: ${operation.id} registers ${code} and no P1-28 contract ` +
            'permission map names it — a backend code the interface never learned about'
        );
      }
    }
  }

  // --- rules 1, 2 and 4, per route ---------------------------------------
  /** Every file any P1-28 route loads — rule 5's extended root (see §roots). */
  const closureUnion = new Set();
  /** Routes on which an awaited read was recognised at all — anti-vacuity. */
  let routesThatRead = 0;

  for (const file of routes) {
    const relativePath = posix(relative(ROOT, file));
    const source = read(file);
    if (source === null) {
      violations.push(`${relativePath} could not be read`);
      continue;
    }

    // 1 — the gate that DENIES AND RETURNS stands before the first awaited read.
    const stripped = stripComments(source);
    const gate = denyAndReturnGate(stripped);
    const callees = importedReadCallees(file, source, read);
    const firstRead = firstAwaitedRead(stripped, callees, gateInputs(stripped, gate));
    if (firstRead > -1) routesThatRead += 1;
    if (gate === -1) {
      violations.push(
        stripped.includes('holds(')
          ? `gate-before-read: ${relativePath} consults a permission but never denies and ` +
              'returns on one — a capability computed for a control renders the screen anyway'
          : `gate-before-read: ${relativePath} consults no permission at all`
      );
    } else if (firstRead > -1 && gate > firstRead) {
      violations.push(`gate-before-read: ${relativePath} reads before it checks a permission`);
    }

    // 4 (part) — the closure, computed here because rules 2 and 4 both read it.
    const own = importClosure(file, read);
    for (const near of own) closureUnion.add(near);

    /*
     * The codes this ROUTE decides, which is the page plus every file of its own
     * closure that lies inside the P1-28 trees. Rule 6 says there are none of
     * the latter today; this union is what makes rules 2 and 4 complete if that
     * ever stops being true, rather than silently narrowing to the page.
     */
    const consulting = [file, ...own.filter((near) => near !== file && inFeatureTree(near))];
    const codeSet = new Set();
    for (const near of consulting) {
      const { codes: found, unresolved } = consultedPermissions(read(near) ?? '', constants);
      for (const code of found) codeSet.add(code);
      for (const expression of unresolved) {
        violations.push(
          `gate-before-read: ${posix(relative(ROOT, near))} checks holds(…, ${expression}), ` +
            'which this gate cannot resolve to a literal code — an unreadable permission check ' +
            'is an unverified one'
        );
      }
    }
    const codes = [...codeSet].sort();

    // 2 — every consulted code is published by some operation.
    for (const code of codes) {
      if (!published.has(code)) {
        violations.push(
          `code-published: ${relativePath} consults "${code}", which no published operation ` +
            'registers'
        );
      }
    }

    // 4 — least privilege, over the route's own closure plus one link level.
    const linked = new Set();
    for (const near of own) {
      for (const target of linkedRoutes(read(near) ?? '', segments)) linked.add(target);
    }
    linked.delete(file);
    const reachable = new Set(own);
    for (const target of linked)
      for (const near of importClosure(target, read)) reachable.add(near);

    if (own.length < 5) {
      violations.push(
        `least-privilege: the import closure of ${relativePath} is ${own.length} file(s); a ` +
          'closure that small means resolution failed and the subset below proves nothing'
      );
    }

    const required = new Set();
    for (const near of reachable) {
      for (const site of sitesOf.get(near) ?? []) {
        for (const code of byRoute.get(`${site.method} ${site.path}`) ?? []) required.add(code);
      }
    }

    const surplus = codes.filter((code) => !required.has(code));
    if (surplus.length > 0) {
      violations.push(
        `least-privilege: ${relativePath} consults [${surplus.join(', ')}] which no operation ` +
          `reachable from it requires (${own.length} file(s) in its own closure, ` +
          `${linked.size} linked route(s))`
      );
    }

    report.push({
      route: relativePath,
      consulted: codes,
      required: [...required].sort(),
      closure: own.length,
      reads: firstRead > -1,
      linkedRoutes: [...linked].map((path) => posix(relative(ROOT, path))).sort(),
    });
  }

  if (routes.length > 0 && routesThatRead < 4) {
    violations.push(
      `an awaited read was recognised on ${routesThatRead} of ${routes.length} route(s); five of ` +
        'these pages read on the server, so rule 1 has stopped being able to see the thing it ' +
        'orders against the gate'
    );
  }

  // --- rule 6: the route is the single place a permission is consulted -----
  for (const file of treeFiles) {
    const text = stripComments(read(file) ?? '');
    if (/\bholds\s*\(/.test(text) && !/\bfunction\s+holds\s*\(/.test(text)) {
      violations.push(
        `route-owns-the-gate: ${posix(relative(ROOT, file))} calls holds(…); a permission ` +
          'consulted below the route is one no route-rooted rule can see, and ' +
          'features/receptions/check-in/wizard.ts states that the route is the single place ' +
          'holds(…) is called'
      );
    }
  }

  // --- rule 5: no scope in a URL ------------------------------------------
  //
  // Both clauses over the trees P1-28 owns and its route pages; the URL clause
  // alone over the rest of every route's import closure, which is what brings
  // `components/**` and `lib/**` under a root at all. The tenant clause stops at
  // the phase boundary on purpose — see the §roots note in this file's header.
  const routeSet = new Set(routes);
  const owned = new Set([...treeFiles, ...routeSet]);
  for (const file of owned) {
    for (const offence of scopeInUrl(read(file) ?? '')) {
      violations.push(
        `no-scope-in-a-url: ${posix(relative(ROOT, file))} names ${offence.name} — ${offence.why}`
      );
    }
  }
  for (const file of closureUnion) {
    if (owned.has(file)) continue;
    for (const offence of scopeInUrl(read(file) ?? '')) {
      if (offence.why !== 'built into a URL or query string') continue;
      violations.push(
        `no-scope-in-a-url: ${posix(relative(ROOT, file))} names ${offence.name} — ${offence.why}` +
          ' — and a P1-28 route loads it'
      );
    }
  }

  return {
    routes: report,
    scanned: sources.size,
    treeFiles: treeFiles.length,
    closureFiles: closureUnion.size,
    segments: [...segments],
    constants: constants.byMember.size + constants.byName.size,
    violations,
  };
}

/**
 * Every production source under `apps/web/src`, as an absolute-path map.
 *
 * Exported so the mutation suite can take the REAL tree, plant one violation in
 * one file and run the whole judgement over it. Synthesising a tree instead
 * would satisfy none of the anti-vacuity conditions and would prove that a rule
 * fires on a fixture rather than on this repository.
 */
export function collectSources() {
  return new Map(walk(WEB_SRC).map((file) => [file, readFileSync(file, 'utf8')]));
}

/**
 * The P1-28 route pages, DERIVED: every `page.tsx` in the `(dashboard)` tree
 * whose import closure reaches one of the feature trees §9 names.
 *
 * ## Why this is not a list of segments
 *
 * It was: `['appointments', 'reception', 'receptions']`, over a docblock citing
 * `canonical-plan.md` §9 — which names no route segment at all. §9 names three
 * PATHS, and the third is the whole `(dashboard)` tree; the segments were a
 * hand-written reading of the shipped router that no document backed. A gate
 * whose subject is "did anybody ship a screen outside every rule" cannot take
 * the set of screens from a hand-written list, because the screen somebody
 * forgets to add is exactly the one the list omits.
 *
 * So the plan's two feature paths — which it really does name, verbatim — plus
 * the router decide it. Of the thirty pages in the `(dashboard)` tree, eight
 * load `features/appointments` or `features/receptions`, and those eight are
 * this phase's surface. A ninth appears here the day it is written, with no
 * edit to this file.
 */
export function phaseRoutes(read = defaultRead) {
  const found = [];
  for (const file of walk(DASHBOARD)) {
    if (!file.endsWith(`${sep}page.tsx`)) continue;
    const closure = importClosure(file, read);
    const owned = closure.some((near) =>
      FEATURE_TREES.some((tree) => posix(near).includes(`/${posix(tree)}/`))
    );
    if (owned) found.push(file);
  }
  return found.sort();
}

/** Reads a file straight off disk, for callers with no source map to hand. */
function defaultRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The first path segment of each derived route — `appointments`, `reception`,
 * `receptions` today.
 *
 * Used only to decide whether a link leads INTO this phase. Derived from
 * `phaseRoutes`, so the two can never disagree about what P1-28 owns.
 */
export function routeSegments(read = defaultRead) {
  const segments = new Set();
  for (const file of phaseRoutes(read)) {
    const parts = posix(relative(DASHBOARD, file)).split('/');
    if (parts.length > 0 && parts[0] !== '') segments.add(parts[0]);
  }
  return [...segments].sort();
}

// Executed only when invoked as a script, never on import.
if (process.argv[1] && process.argv[1].endsWith('check-p1-28-access.mjs')) {
  const result = run();
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `P1-28 access gate: ${result.routes.length} route(s) under [${result.segments.join(', ')}], ` +
        `${result.treeFiles} feature file(s), ${result.closureFiles} file(s) in their import ` +
        `closures, ${result.constants} permission constant(s), ${result.scanned} file(s) scanned.`
    );
    for (const route of result.routes) {
      console.log(`  ${route.route}`);
      console.log(`    consults [${route.consulted.join(', ') || '—'}]`);
    }
    if (result.violations.length === 0) {
      console.log(
        'OK: every P1-28 screen gates before it reads, consults only published codes, requires ' +
          'no more than its operations require, and asserts no scope in a URL.'
      );
    } else {
      console.error(`\n${result.violations.length} violation(s):`);
      for (const violation of result.violations) console.error(`  ${violation}`);
    }
  }
  process.exit(result.violations.length === 0 ? 0 : 1);
}
