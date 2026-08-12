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
 * A *mutation* call site: an `/api/v1/...` path literal preceded by an HTTP
 * write-method literal (`'POST'` — the whole apt/rec surface — or
 * `'PUT'`/`'PATCH'`). Matching a bare path is not enough: reads and writes
 * share paths (`rec.reception-authorization` POST and `-list` GET live on one
 * route), so a path-only check would report a write reachable after its call
 * site was deleted.
 *
 * The P1-27 gate additionally recognises `writeVehicle(...)`, a method-less
 * helper. No apt/rec equivalent exists yet. If the contract layer introduces
 * one, its call sites are INVISIBLE to this gate until it is taught here —
 * which fails closed: the `REACHABLE` classification goes red and whoever
 * flips it extends the gate. The same holds for a base-building path helper:
 * only inline `/api/v1/...` template literals are normalised.
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

/**
 * Every mutation call site in one file, as `{ method, path }`.
 *
 * Found by locating each API path literal and looking BACKWARD for the nearest
 * write-method literal. The direction matters: the method precedes the path in
 * every call shape this codebase uses — `client.send('POST', path, …)` and the
 * CRM-style `write(previous, parse, 'POST', path, …)` helper both carry the
 * method as a string literal before the path. A path with no write marker
 * behind it is a READ and is ignored, which is what keeps a list GET from
 * vouching for the POST that shares its route.
 */
export function mutationCallSites(source) {
  const text = normaliseSourcePaths(stripComments(source));
  const sites = [];
  const pathPattern = /['"`](\/api\/v1\/[^'"`\s]*)['"`]/g;

  let match;
  while ((match = pathPattern.exec(text)) !== null) {
    // Bounded look-behind: long enough to clear a parse closure passed to a
    // write helper, short enough not to borrow a method from another call.
    const window = text.slice(Math.max(0, match.index - 2000), match.index);
    const method = /.*['"](POST|PUT|PATCH)['"]/s.exec(window);
    if (!method) continue;

    sites.push({ method: method[1], path: match[1] });
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

  const sites = [];
  for (const [path, content] of scanned) {
    for (const site of mutationCallSites(content)) sites.push({ ...site, file: path });
  }

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
  if (sites.length === 0)
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

  return { counts, results, violations, scanned: scanned.length, sites: sites.length, canonical };
}

// Executed only when invoked as a script, never on import.
if (process.argv[1] && process.argv[1].endsWith('check-p1-28-write-reachability.mjs')) {
  const report = run();
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `P1-28 write reachability: ${report.canonical.length} canonical write(s), ` +
        `${report.scanned} production file(s), ${report.sites} mutation call site(s).`
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
