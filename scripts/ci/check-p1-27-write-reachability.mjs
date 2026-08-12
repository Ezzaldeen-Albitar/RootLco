#!/usr/bin/env node
/**
 * Canonical P1-27 mutation reachability (D1 closure gate).
 *
 * ## The defect this exists to catch
 *
 * A registered operation is not a delivered feature. Ten canonical P1-27 writes
 * shipped with a route, a permission, an audit class, an idempotency entry, a
 * generated OpenAPI path and an operation-register row — and no screen from
 * which anybody could invoke them. A registration plate could be entered
 * nowhere; a vehicle could not change owner; a customer's status was displayed
 * and could not be changed. Every automated tier was green throughout, because
 * every tier asked "is the operation correct" and none asked "can a person reach
 * it".
 *
 * This gate asks the second question, and refuses four ways of dodging it.
 *
 * ## The operation list is DERIVED, never written down here
 *
 * It comes from the P1-24 operation register: every `crm.*` / `veh.*` operation
 * whose method is not GET. A hand-maintained list would omit a newly added
 * operation silently, which is the same class of defect one level up. An
 * operation in the register and not in the manifest is UNCLASSIFIED and fails.
 *
 * ## What counts as a production call site
 *
 * A *mutation* call site: an API path literal that an HTTP write method stands
 * IMMEDIATELY before, or that the vehicle write helper's argument list
 * CONTAINS. Matching a bare path is not enough, because a read and a write
 * share one path in several places — `veh.vehicle-ev-profile-set` (POST) and
 * `-read` (GET) live in the same file on the same path, so a path-only check
 * would report the write reachable after its call site was deleted.
 *
 * Nor is *proximity* enough. The first version accepted any write marker
 * within a 2000-character look-behind, which let a read BORROW the method of an
 * unrelated write earlier in the same file; the live tree carried exactly that
 * shape — the VIN-uniqueness probe in `features/vehicles/profile-api.ts` is a
 * `client.get`, and it was credited with the `PATCH` of the status write forty
 * lines above it. Three `DELETE` calls were mis-reported as `POST` the same
 * way, the scan having walked straight past their own adjacent `'DELETE'`
 * literal to find a POST further back. `mutationCallSites` below carries the
 * adjacency and containment rules that refuse all four.
 *
 * These do NOT count, and are excluded structurally rather than by naming
 * convention:
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
 * A checker that scans nothing passes everything. Five conditions fail the run
 * outright: no files scanned, no operations derived, no mutation call sites
 * found at all, a malformed classification, and a duplicate manifest entry.
 * `DELIBERATELY_ABSENT` and `DECISION_NEUTRAL_UNAVAILABLE` additionally require
 * a non-empty `decisionRef` — an absence without an approved decision behind it
 * is indistinguishable from an omission, which is what this gate is for.
 *
 * Usage:  node scripts/ci/check-p1-27-write-reachability.mjs [--json]
 * Exit:   0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REPOSITORY_ROOT } from '../lib/repository-paths.mjs';

const ROOT = REPOSITORY_ROOT;
const jsonOutput = process.argv.includes('--json');

const REGISTER = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json');
const MANIFEST = join(ROOT, 'docs', 'phase-1', 'phase-1-27', 'canonical-write-reachability.json');
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');

export const CLASSIFICATIONS = Object.freeze([
  'REACHABLE',
  'DELIBERATELY_ABSENT',
  'DECISION_NEUTRAL_UNAVAILABLE',
  'BLOCKED',
]);

/** Needs an approved decision reference before an absence is a decision. */
const NEEDS_DECISION = Object.freeze(['DELIBERATELY_ABSENT', 'DECISION_NEUTRAL_UNAVAILABLE']);

/**
 * Files that mention an operation without anybody being able to invoke it.
 *
 * Named, not pattern-matched: `idempotent-operations.ts` is generated from the
 * contract and lists every idempotent operation whether or not a screen calls
 * one, so treating it as evidence would make this gate assert that a manifest
 * exists — which was already true throughout the defect.
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
 * Collapses TypeScript interpolation in a source file so path templates become
 * comparable. Expands the two helpers that build a base, so a call site written
 * as `` `${base(customerId)}/contacts` `` compares equal to the registered
 * `/customers/{customerId}/contacts` once that has been through
 * `normaliseRoutePath`.
 *
 * ## It must NOT touch bare braces
 *
 * The first version also replaced `{…}` here, to fold the register's
 * `{vehicleId}` placeholders with one function. Applied to a whole source file
 * that rule collapses every object literal and function body — including the
 * `writeVehicle(previous, () => { … }, path, key)` closure — which erased the
 * `writeVehicle(` marker the look-behind depends on and reported three
 * demonstrably-called operations as unreachable. Two different normalisations,
 * two functions.
 */
export function normaliseSourcePaths(text) {
  return text
    .replace(/\$\{\s*base\([^)]*\)\s*\}/g, '/api/v1/customers/:p')
    .replace(/\$\{\s*vehicleBase\([^)]*\)\s*\}/g, '/api/v1/vehicles/:p')
    .replace(/\$\{[^}]*\}/g, ':p');
}

/** `/customers/{customerId}/contacts` → `/customers/:p/contacts`. */
export function normaliseRoutePath(route) {
  return route.replace(/\{[^}]*\}/g, ':p');
}

/**
 * Every non-test source file under `dir`. A symlink is REFUSED (`QA005-12`).
 *
 * This walker did not share the blind spot the other three had, because
 * `statSync` follows a link — so it FOLLOWED one rather than skipping it, and
 * that is its own defect: a link pointing at an ancestor makes this recurse until
 * the stack ends, and a link pointing outside `apps/web/src` makes the gate
 * classify mutations in files that are not in the tree it claims to cover.
 *
 * `lstatSync` asks about the link itself rather than its target, so the refusal
 * happens before either can occur. That makes the policy uniform across all four
 * P1-27 walkers, which is what the docblock in
 * `build-p1-27-evidence-manifest.mjs` has been claiming.
 */
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

/**
 * The identifier of the call whose argument list encloses `index`, or `null`.
 *
 * Adjacency cannot decide the vehicle helper. `writeVehicle(previous, parse,
 * path, key)` puts the parse CLOSURE between the marker and the path, so
 * `writeVehicle(` is never the token directly before the literal. Containment
 * decides it instead: the path must sit inside the argument list that
 * `writeVehicle(` opened, which a read placed anywhere after that call does
 * not.
 *
 * Scanned backward with one depth counter — a closing bracket deepens, its
 * opener unwinds, and the first `(` to unwind past zero opened the call this
 * literal is an argument of. A `{` or `[` reaching zero first means the literal
 * sits in an object or array rather than an argument list, and resolves to
 * nothing.
 *
 * Interpolations are already gone by the time this runs (`normaliseSourcePaths`
 * folds every `${…}` to `:p`), so a template literal cannot unbalance the
 * count.
 */
export function enclosingCallee(text, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char === ')' || char === '}' || char === ']') {
      depth += 1;
    } else if (char === '{' || char === '[') {
      if (depth === 0) return null;
      depth -= 1;
    } else if (char === '(') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      // A generic argument list (`client.get<{ … }>(`) leaves `>` here rather
      // than an identifier, and resolves to nothing — which is correct: the
      // helper is never called with one.
      return /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(Math.max(0, i - 100), i))?.[1] ?? null;
    }
  }
  return null;
}

/**
 * Every mutation call site in one file, as `{ method, path }`.
 *
 * Found by locating each API path literal and asking one of two questions of
 * the text around it, never "is a write marker somewhere nearby":
 *
 *   - ADJACENCY, for the two shapes that pass a method — `client.send('POST',
 *     path, …)` and the CRM `write(previous, parse, 'POST', path, …)` helper.
 *     Both put the method in the argument DIRECTLY before the path (the parse
 *     closure sits before the method, so it never intervenes), so the literal
 *     must end the text immediately preceding the path, save for the argument
 *     comma and whitespace.
 *   - CONTAINMENT, for `writeVehicle(previous, parse, path, key)`, which takes
 *     no method because it is always POST and whose closure stands between the
 *     marker and the path. `enclosingCallee` above supplies the rule.
 *
 * A path meeting neither is a READ and is ignored. That is what keeps
 * `veh.vehicle-ev-profile-read` from vouching for `-set`, and what keeps a read
 * from BORROWING the method of an unrelated write elsewhere in the same file —
 * the defect the 2000-character look-behind had, whose live instances and
 * regression fixtures are named in `tests/foundation/p1-27-write-reachability.test.ts`.
 */
export function mutationCallSites(source) {
  const text = normaliseSourcePaths(stripComments(source));
  const sites = [];
  const pathPattern = /['"`](\/api\/v1\/[^'"`\s]*)['"`]/g;

  let match;
  while ((match = pathPattern.exec(text)) !== null) {
    // The slice is only as long as a method literal plus formatting needs; the
    // `$` anchor, not the length, is what carries the rule.
    const window = text.slice(Math.max(0, match.index - 200), match.index);
    const method = /['"](POST|PUT|PATCH)['"]\s*,\s*$/.exec(window);
    if (method) {
      sites.push({ method: method[1], path: match[1] });
      continue;
    }

    if (enclosingCallee(text, match.index) === 'writeVehicle') {
      sites.push({ method: 'POST', path: match[1] });
    }
  }
  return sites;
}

/**
 * The whole check, as a function.
 *
 * Not top-level, so the module can be IMPORTED by a test without running the
 * check and calling `process.exit`. `check-p1-27-frontend.mjs` exports its
 * internals for the same reason: a gate nobody can unit-test is a gate whose
 * own logic is never verified, and the mutation suite beside this file needs to
 * drive `mutationCallSites` and `run` directly.
 */
export function run(injected = {}) {
  // --- inputs ------------------------------------------------------------------
  //
  // Injectable so the mutation suite can drive the judgement with synthetic
  // register/manifest/source triples. Nothing is injected in production: the
  // defaults read the real register, the real manifest and the real tree.

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

  const canonical = (register.operations ?? [])
    .filter((op) => /^(crm|veh)\./.test(op.id) && op.method !== 'GET')
    .sort((a, b) => a.id.localeCompare(b.id));

  const classified = manifest.operations ?? {};

  // --- scan --------------------------------------------------------------------

  // `sources` is `[path, content]` pairs. Injected by the mutation suite; read
  // from the real tree otherwise.
  const sources =
    injected.sources ??
    walk(WEB_SRC).map((file) => [
      relative(ROOT, file).split(sep).join('/'),
      readFileSync(file, 'utf8'),
    ]);

  const scanned = sources.filter(
    ([path]) => !NOT_A_CALL_SITE.some((excluded) => path.endsWith(excluded.split(sep).join('/')))
  );

  const sites = [];
  for (const [path, content] of scanned) {
    for (const site of mutationCallSites(content)) sites.push({ ...site, file: path });
  }

  /**
   * The register field is `route`, and it ALREADY carries the `/api/v1` prefix.
   *
   * Read from a live entry rather than assumed: prefixing it again produced 23
   * false "no call site" violations against code that demonstrably calls every one
   * of them, which is the failure mode where a gate is believed and the product is
   * blamed.
   */
  function callSiteFor(operation) {
    const wanted = normaliseRoutePath(operation.route);
    return sites.find((site) => site.path === wanted && site.method === operation.method) ?? null;
  }

  // --- judge -------------------------------------------------------------------

  const violations = [];
  const results = [];

  // Anti-vacuity. Each of these makes every assertion below meaningless.
  if (scanned.length === 0) violations.push('no files were scanned');
  if (canonical.length === 0)
    violations.push('no canonical operations were derived from the register');
  if (sites.length === 0)
    violations.push('no mutation call site was found anywhere in apps/web/src');

  const seen = new Set();
  for (const id of Object.keys(classified)) {
    if (seen.has(id)) violations.push(`duplicate manifest entry: ${id}`);
    seen.add(id);
    if (!canonical.some((op) => op.id === id)) {
      violations.push(`manifest classifies "${id}", which is not a canonical P1-27 mutation`);
    }
  }

  for (const operation of canonical) {
    const entry = classified[operation.id];

    if (!entry) {
      violations.push(`UNCLASSIFIED: ${operation.id} (${operation.method} ${operation.path})`);
      results.push({ id: operation.id, classification: 'UNCLASSIFIED' });
      continue;
    }

    const { classification, decisionRef } = entry;

    if (!CLASSIFICATIONS.includes(classification)) {
      violations.push(`malformed classification "${classification}" for ${operation.id}`);
      results.push({ id: operation.id, classification: 'MALFORMED' });
      continue;
    }

    if (NEEDS_DECISION.includes(classification) && !String(decisionRef ?? '').trim()) {
      violations.push(
        `${operation.id} is ${classification} with no decisionRef; an absence without an approved decision is an omission`
      );
    }

    const site = callSiteFor(operation);

    if (classification === 'REACHABLE' && !site) {
      violations.push(
        `${operation.id} is REACHABLE but no production call site sends ${operation.method} ${operation.route}`
      );
    }

    if (classification !== 'REACHABLE' && site) {
      violations.push(
        `${operation.id} is ${classification} but IS called from ${site.file}; the classification and the code disagree`
      );
    }

    if (classification === 'BLOCKED') {
      violations.push(`${operation.id} is BLOCKED; final P1-27 acceptance requires BLOCKED=0`);
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

  return { counts, results, violations, scanned: scanned.length, sites: sites.length, canonical };
}

// Executed only when invoked as a script, never on import.
if (process.argv[1] && process.argv[1].endsWith('check-p1-27-write-reachability.mjs')) {
  const report = run();
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `P1-27 write reachability: ${report.canonical.length} canonical mutation(s), ` +
        `${report.scanned} production file(s), ${report.sites} mutation call site(s).`
    );
    for (const key of [...CLASSIFICATIONS, 'UNCLASSIFIED', 'MALFORMED']) {
      if (report.counts[key]) console.log(`  ${key} = ${report.counts[key]}`);
    }
    if (report.violations.length === 0) {
      console.log(
        'OK: every canonical P1-27 mutation is classified and its classification matches the code.'
      );
    } else {
      console.error(`\n${report.violations.length} violation(s):`);
      for (const violation of report.violations) console.error(`  ${violation}`);
    }
  }
  process.exit(report.violations.length === 0 ? 0 : 1);
}
