#!/usr/bin/env node
/**
 * `gate-before-read` for P1-30 route pages.
 *
 * Every P1-30 screen must prove PC-1 — authorized sees, unauthorized is refused,
 * cross-tenant is invisible (canonical plan §5.3) — and the first half of that
 * is a property of the route PAGE: it must deny and RETURN on a permission
 * before it awaits anything that costs a request. A page that reads first and
 * denies second has already fetched the data it then declines to show.
 *
 * ## A sibling of `check-p1-29-access.mjs`, not a widening of it
 *
 * The P1-29 gate derives its segments from the `wo|dia|qms|tech` operations and
 * is what P1-29's closure rests on. Widening its regex would change a gate a
 * closed phase depends on, so this is a separate file with its own derivation,
 * and it reuses the JUDGEMENT — `judgePage`, and through it the P1-28 gate's
 * `denyAndReturnGate` — so the shapes the adversarial review of the first
 * P1-29 version found (a negated check that falls through, a docblock quoting
 * the rule, `await Promise.all([...])` reads, a `holds` that only computes a
 * capability) cannot silently regress here.
 *
 * ## The segments are DERIVED, and some belong to P1-29 too
 *
 * The register is walked for every `svc|quo|inv|sal|wty` operation and the
 * RESOURCE ROOT of its route is taken. Several P1-30 reads are parent-addressed
 * under `/work-orders/{id}/…` (quotations, the invoice, part issues), so
 * `work-orders` is among the derived roots and this gate examines P1-29's
 * work-order pages as well. That is harmless — those pages are gated and pass —
 * and it is the direction that fails safe: a P1-30 screen nested under a
 * P1-29 root is still a P1-30 screen.
 *
 * ## Armed before the first screen exists
 *
 * At the time this ships, zero P1-30 route pages exist and the run says so out
 * loud. Its teeth are proved by `tests/ci/p1-30-access-gate.test.ts`, which
 * plants pages in each refused shape and requires a red — the same reason the
 * P1-29 gate shipped over an empty set: a gate written after the screens land
 * ratifies them.
 *
 * Usage: node scripts/ci/check-p1-30-access.mjs [--app-root <dir>]
 * Exit: 0 clean · 1 a violation · 2 IO.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { judgePage } from './check-p1-29-access.mjs';
import { P1_30_AREAS } from './check-p1-30-server-arithmetic.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..', '..');
const slash = (p) => p.split(sep).join('/');

const REGISTER = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json');

/** The P1-30 id namespaces: services and pricing, quotations, inventory, billing and payments, warranty. */
export const P1_30_ID = /^(svc|quo|inv|sal|wty)\./;

/**
 * The route segments P1-30 owns, derived from the operation register.
 *
 * Only the RESOURCE ROOT of each route is taken —
 * `/api/v1/price-lists/{priceListId}/versions` -> `price-lists` — for the
 * reason the P1-29 gate records: every segment would pull in `versions`,
 * `rules`, `publication` and a dozen more, and a rule that reaches outside its
 * lane produces violations nobody in that lane can act on.
 *
 * Anti-vacuity: an empty derivation is refused by `main`. A gate that owns no
 * segments examines no pages and passes everything.
 */
export function ownedSegments(registerPath = REGISTER) {
  if (!existsSync(registerPath)) return [];
  const raw = JSON.parse(readFileSync(registerPath, 'utf8'));
  const operations = Array.isArray(raw) ? raw : (raw.operations ?? []);
  const segments = new Set();
  for (const op of operations) {
    if (!P1_30_ID.test(op.id ?? '')) continue;
    const parts = String(op.route ?? '')
      .split('/')
      .filter((p) => p && p !== 'api' && p !== 'v1' && !p.startsWith('{'));
    if (parts.length > 0) segments.add(parts[0]);
  }
  // The route segments the server-arithmetic gate pre-names (`pricing`,
  // `quotations`, ...) are owned too: a screen may sit under a segment that is
  // not any operation's first path part — `/pricing` renders `price-lists` and
  // `prices` — and a page outside this derivation would escape the
  // gate-before-read check while sitting squarely inside the phase.
  for (const area of P1_30_AREAS) {
    const match = /^app\/\[locale\]\/\(dashboard\)\/([^/]+)$/.exec(area);
    if (match) segments.add(match[1]);
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

/** Every P1-30 route page under an app root. */
export function p1_30PagesUnder(appRoot, segments = ownedSegments()) {
  return walk(appRoot).filter((p) => {
    const rel = slash(p);
    return segments.some((seg) => rel.includes(`/${seg}/`));
  });
}

function main() {
  const i = process.argv.indexOf('--app-root');
  const appRoot = i === -1 ? join(ROOT, 'apps', 'web', 'src', 'app') : process.argv[i + 1];
  const segments = ownedSegments();
  const violations = [];
  if (segments.length === 0) {
    violations.push(
      'the P1-30 segment derivation is EMPTY — a gate that owns no segments examines no pages ' +
        'and passes everything'
    );
  }
  const pages = p1_30PagesUnder(appRoot, segments);
  for (const page of pages) {
    const why = judgePage(readFileSync(page, 'utf8'));
    if (why) violations.push(`gate-before-read: ${slash(relative(ROOT, page))} ${why}`);
  }
  console.log(
    `P1-30 gate-before-read: ${pages.length} route page(s) examined across ` +
      `${segments.length} owned segment(s) derived from the operation register.`
  );
  if (pages.length === 0) {
    // Said out loud. A silent pass over an empty set is indistinguishable from a
    // pass over a checked one, and only one of those means anything.
    console.log(
      '  ZERO pages exist yet — this run proves nothing about any screen. The rule is ARMED so ' +
        'that the first P1-30 screen meets a rule that predates it; its teeth are proved by ' +
        'tests/ci/p1-30-access-gate.test.ts, which plants ungated pages and requires a red.'
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
