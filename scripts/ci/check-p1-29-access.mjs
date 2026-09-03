#!/usr/bin/env node
/**
 * `gate-before-read` for P1-29 route pages (`PRE-P1-29-BR-08c`).
 *
 * Every P1-29 route page must DENY AND RETURN on a permission BEFORE its first
 * awaited read. The denial renders instead of the screen, so an operator who may
 * not see a thing never spends a request discovering that.
 *
 * ## It IMPORTS the P1-28 rule rather than restating it
 *
 * The first version of this gate wrote its own three regexes. An adversarial
 * review took it apart in four ways, and every one of them was a FALSE NEGATIVE —
 * a page that should have been refused and was not:
 *
 *   - `/if\s*\(\s*!\s*holds\s*\(/` matched the CONDITION and never looked at the
 *     consequent, so a negated check that falls through instead of returning
 *     passed. `check-p1-28-access.mjs:344` had already solved this and says why:
 *     "a negated condition that falls through renders the screen it was written
 *     to stop".
 *   - it searched the RAW source, so a docblock quoting the rule armed the gate
 *     for a page that had none.
 *   - its read detector required `await` + a bare identifier, so
 *     `await Promise.all([listJobs(), listTechnicians()])` and
 *     `await api.listTechnicians()` were invisible — and `Promise.all` is the
 *     shipped read shape in this repository.
 *   - its hand-written segment list missed seven P1-29 resources outright, so
 *     an ungated page under `additional-work/` was not a violation; it was not
 *     even a page, and the run printed the reassuring ZERO-pages banner.
 *
 * The sibling rule still stands — `check-p1-28-access.mjs` is what P1-28's seal
 * rests on and is BYTE-UNCHANGED — but "sibling" forbids MODIFYING it, not
 * reusing it. `denyAndReturnGate`, `firstAwaitedRead` and `stripComments` are
 * exported, mutation-proved, and already know every shape listed above. Importing
 * them is strictly better than a second, weaker implementation of the same rule.
 *
 * ## It is armed BEFORE the screens exist, and that is the point
 *
 * There are zero P1-29 route pages today. A gate written after the screens land
 * does not check them — it ratifies them, because whatever shape they were built
 * in becomes the shape it accepts. The contract says so: _"Extend the rule to
 * P1-29's routes, in the first frontend slice, not the last."_
 *
 * A pass over an empty set proves nothing, so every run prints the page count and
 * says so out loud, and `tests/ci/p1-29-access-gate.test.ts` plants pages in each
 * refused shape and requires a red.
 *
 *     node scripts/ci/check-p1-29-access.mjs
 *     node scripts/ci/check-p1-29-access.mjs --app-root <dir>   # for the red-proof
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { denyAndReturnGate } from './check-p1-28-access.mjs';
import { stripComments } from './check-p1-28-write-reachability.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..', '..');
const slash = (p) => p.split(sep).join('/');

const REGISTER = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json');
const P1_29_ID = /^(wo|dia|qms|tech)\./;

/**
 * The route segments P1-29 owns, DERIVED from the operation register.
 *
 * The first version hand-wrote seven and missed seven more — `additional-work`,
 * `inspection-templates`, `rework-links`, `labor-sessions`, `assignments`,
 * `reopen-attempts`, `template-versions` — while listing `diagnostics`, which
 * maps to no P1-29 route at all (the resource is `inspections`). Every miss was
 * an ungated screen this gate would not have looked at.
 *
 * Deriving inverts the failure mode. A hand-frozen list is right for a MIRROR,
 * where a silently growing list would grow the thing being checked; it is wrong
 * for a coverage rule, where a silently growing list grows the rule's REACH. A
 * new P1-29 operation now extends this gate automatically, which is the direction
 * that fails safe.
 *
 * Anti-vacuity: an empty derivation is refused. A gate that owns no segments
 * examines no pages and passes everything.
 */
export function ownedSegments(registerPath = REGISTER) {
  if (!existsSync(registerPath)) return [];
  const raw = JSON.parse(readFileSync(registerPath, 'utf8'));
  const operations = Array.isArray(raw) ? raw : (raw.operations ?? []);
  const segments = new Set();
  for (const op of operations) {
    if (!P1_29_ID.test(op.id ?? '')) continue;
    // Only the RESOURCE ROOT: `/api/v1/work-orders/{workOrderId}/jobs` -> work-orders.
    //
    // Taking every segment instead pulls in `status`, `detail`, `me`, `end`,
    // `items`, `versions` and a dozen more, which would make this gate judge
    // other phases' screens — `/receptions/.../status/` is not P1-29's business,
    // and a rule that reaches outside its lane is how a gate starts producing
    // violations nobody in that lane can act on. A page nested under a P1-29 root
    // still matches, because the root is in its path.
    const parts = String(op.route ?? '')
      .split('/')
      .filter((p) => p && p !== 'api' && p !== 'v1' && !p.startsWith('{'));
    if (parts.length > 0) segments.add(parts[0]);
  }
  return [...segments].sort();
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && entry.name === 'page.tsx') out.push(p);
  }
  return out;
}

/** Every P1-29 route page under an app root. */
export function p1_29PagesUnder(appRoot, segments = ownedSegments()) {
  return walk(appRoot).filter((p) => {
    const rel = slash(p);
    return segments.some((seg) => rel.includes(`/${seg}/`));
  });
}

/**
 * The first awaited call that costs a request.
 *
 * Deliberately broader than a bare identifier: `await Promise.all([...])` and
 * `await api.listX()` are reads, and the first version could see neither. Awaits
 * of things that are not reads — the App Router's own `params`/`searchParams`,
 * and the session the gate itself needs — are excluded by name.
 */
const AWAITED_READ =
  /await\s+(?!params\b|searchParams\b|requireSession\b|props\b)[A-Za-z_$][\w$]*\s*[.(]/;

/**
 * Does this page deny-and-return on a permission before its first awaited read?
 *
 * Comments are stripped first, so prose describing the rule cannot satisfy it.
 */
export function judgePage(source) {
  const text = stripComments(source);
  const gate = denyAndReturnGate(text);
  if (gate === -1) {
    return /holds\s*\(/.test(text)
      ? 'consults a permission but never denies and RETURNS on one'
      : 'consults no permission at all';
  }
  const read = text.search(AWAITED_READ);
  if (read !== -1 && read < gate) return 'reads before it denies on a permission';
  return null;
}

function main() {
  const i = process.argv.indexOf('--app-root');
  const appRoot = i === -1 ? join(ROOT, 'apps', 'web', 'src', 'app') : process.argv[i + 1];

  const segments = ownedSegments();
  const violations = [];
  if (segments.length === 0) {
    violations.push(
      'the P1-29 segment derivation is EMPTY — a gate that owns no segments examines no pages ' +
        'and passes everything'
    );
  }

  const pages = p1_29PagesUnder(appRoot, segments);
  for (const page of pages) {
    const why = judgePage(readFileSync(page, 'utf8'));
    if (why) violations.push(`gate-before-read: ${slash(relative(ROOT, page))} ${why}`);
  }

  console.log(
    `P1-29 gate-before-read: ${pages.length} route page(s) examined across ` +
      `${segments.length} owned segment(s) derived from the operation register.`
  );
  if (pages.length === 0) {
    // Said out loud. A silent pass over an empty set is indistinguishable from a
    // pass over a checked one, and only one of those means anything.
    console.log(
      '  ZERO pages exist yet — this run proves nothing about any screen. The rule is ARMED so ' +
        'that the first P1-29 screen meets a rule that predates it; its teeth are proved by ' +
        'tests/ci/p1-29-access-gate.test.ts, which plants ungated pages and requires a red.'
    );
  }

  if (violations.length) {
    for (const v of violations) console.error(`::error::${v}`);
    console.error(`  ${violations.length} violation(s).`);
    process.exit(1);
  }
  console.log('  0 violation(s).');
}

// Entry-point check, not a filename check — a Windows drive letter makes a
// hand-built `file://` URL wrong, and a gate that only runs under one exact
// spelling of its own path is a gate a test cannot copy or wrap.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
