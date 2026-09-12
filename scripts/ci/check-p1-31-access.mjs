#!/usr/bin/env node
/**
 * `gate-before-read` for P1-31 route pages.
 *
 * A P1-31 screen must deny and RETURN on a permission before it awaits anything
 * that costs a request. A page that reads first and denies second has already
 * fetched the data it then declines to show; the backend would refuse the
 * request, but the request was made, and a screen that leans on that is one
 * backend regression away from leaking.
 *
 * ## Why a third file and not a widened second one
 *
 * The P1-29 gate derives its segments from the `wo|dia|qms|tech` operations and
 * the P1-30 gate from the `svc|quo|inv|sal|wty` ones. Both are what a closed
 * phase's closure rests on, so widening either changes a gate somebody else's
 * evidence depends on. This is a sibling with its own derivation, and it reuses
 * the JUDGEMENT — `judgePage`, and through it the P1-28 gate's
 * `denyAndReturnGate` — so the shapes an adversarial review of the first P1-29
 * version found (a negated check that falls through, a docblock quoting the
 * rule, `await Promise.all([...])` reads, a `holds` that only computes a
 * capability) cannot silently regress here.
 *
 * ## The derivation is an ALLOW-LIST of ids, not a namespace
 *
 * This is the one structural difference from its two siblings, and it is forced:
 * P1-30 already owns the whole `sal.` and `wty.` namespaces, so a namespace
 * regular expression here would either claim P1-30's operations or claim
 * nothing. What P1-31 owns is a specific set of operations that P1-31 published,
 * named below. Each is looked up in the operation register and its route's
 * RESOURCE ROOT is taken — `/api/v1/deliveries/{deliveryId}/eligibility` gives
 * `deliveries` — for the reason the P1-29 gate records: every segment would pull
 * in `eligibility`, `signatures`, `status-history` and a dozen more, and a rule
 * that reaches outside its lane produces violations nobody in that lane can act
 * on.
 *
 * An id named here that the register does not carry is a VIOLATION, not a
 * silently skipped row. An allow-list that can quietly go stale is an allow-list
 * that stops owning anything, which is the failure mode this shape trades for.
 *
 * ## The dashboard areas are named as well as derived
 *
 * `P1_31_AREAS` names the route segments P1-31's screens live under. It is not
 * redundant with the derivation: the href already committed in navigation is the
 * SINGULAR `/delivery`, while every delivery operation is addressed under the
 * plural `deliveries`, so a page under `(dashboard)/delivery/**` matches no
 * derived root and would escape a purely derived rule. That is exactly how the
 * first P1-31 screen would have escaped the P1-30 gate.
 *
 * ## It must find pages
 *
 * Its siblings shipped over an empty set and said so out loud. This one ships
 * BESIDE the first P1-31 screen, so a run over the repository that examines zero
 * pages means the derivation stopped matching, not that the phase has not
 * started. That is a red.
 *
 * The floor is a NUMBER rather than a hidden rule: it defaults to one over the
 * repository's own app root and to zero when `--app-root` points somewhere else,
 * because a run over a scratch directory is a test of the judgement rather than
 * a measurement of the phase. `--min-pages` states it explicitly, which is what
 * lets the floor itself be proved rather than asserted.
 *
 * Usage: node scripts/ci/check-p1-31-access.mjs [--app-root <dir>] [--min-pages <n>]
 * Exit: 0 clean · 1 a violation · 2 IO.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { judgePage } from './check-p1-29-access.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..', '..');
const slash = (p) => p.split(sep).join('/');

const REGISTER = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json');

/**
 * The operations P1-31 published, by id.
 *
 * The delivery read seam (P-2 through P-5), the readiness queue the FE-001
 * screen consumes, and the warranty list the phase's chapter declares. An
 * operation added by a later P1-31 task belongs here in the same change that
 * adds it — that is one line, and it is the line that makes the new screen's
 * segment owned.
 */
export const P1_31_OPERATION_IDS = Object.freeze([
  'sal.delivery-read',
  'sal.delivery-eligibility-read',
  'sal.delivery-receiver-read',
  'sal.delivery-signature-list',
  'sal.delivery-checklist-result-list',
  'sal.delivery-status-history',
  'sal.work-order-delivery-read',
  'sal.delivery-readiness-list',
  'wty.warranty-list',
  // FE-008 added the warranty record screen and its issue surface. The detail read
  // shares the `warranties` resource root the list already contributes, and the
  // generation is addressed under `deliveries`, so neither widens the segment set —
  // they are named because the rule is an allow-list of OPERATIONS, and an operation
  // a P1-31 screen calls that is absent here is one this gate does not own.
  'wty.warranty-detail',
  'wty.warranty-generate',
  // The two policy READS P-10 published. The list feeds the plan picker on the issue
  // surface — its own route docblock names that picker as the reason it exists — and
  // the single-policy read is named beside it because they share one resource root:
  // owning `warranty-policies` is what makes a future policy screen meet this rule on
  // the day it lands, exactly as `reports` is named below before it has a page.
  // These two DO widen the segment set, unlike the two above.
  'wty.warranty-policy-list',
  'wty.warranty-policy-read',
  // The three reporting operations the FE-011 … FE-014 screens consume. Their
  // resource root is `reports`, which `P1_31_AREAS` already names — so these
  // entries widen nothing about the segments and everything about the CLAIM:
  // this gate's docblock requires an operation to be listed in the same change
  // that first consumes it, and an id that stops existing must be a violation
  // rather than a quiet shrink.
  'rpt.report-catalogue',
  'rpt.report-read',
  'rpt.report-run',
]);

/**
 * The dashboard route segments P1-31's screens live under.
 *
 * `delivery` is singular and deliberately so — it is the href already committed
 * in navigation. `warranty` was named before its screens existed and now carries
 * them, which is the point of naming an area early: FE-008's two pages met a rule
 * that predated them. `reports` was named on the same grounds and now HAS pages
 * too: the FE-011 … FE-014 catalogue and report screens. Its resource root is also
 * `reports`, so the derived and the named halves agree on that segment — which is
 * why adding the three reporting operations moved the page count and not the
 * segment count.
 */
export const P1_31_AREAS = Object.freeze(['delivery', 'warranty', 'reports']);

/** The route segments P1-31 owns: the derived resource roots plus the named areas. */
export function ownedSegments(registerPath = REGISTER) {
  const { segments } = deriveSegments(registerPath);
  return segments;
}

/**
 * The derivation, with the reasons it could not be trusted alongside it.
 *
 * Returned together rather than thrown, so `main` can report every problem at
 * once and a test can assert on either half.
 */
export function deriveSegments(registerPath = REGISTER) {
  const problems = [];
  const segments = new Set();

  if (!existsSync(registerPath)) {
    problems.push(`the operation register is missing at ${slash(relative(ROOT, registerPath))}`);
    return { segments: [], problems };
  }

  const raw = JSON.parse(readFileSync(registerPath, 'utf8'));
  const operations = Array.isArray(raw) ? raw : (raw.operations ?? []);
  const byId = new Map(operations.map((op) => [op.id, op]));

  for (const id of P1_31_OPERATION_IDS) {
    const operation = byId.get(id);
    if (operation === undefined) {
      // Stale allow-list. Skipping it quietly would shrink this gate's reach
      // without any diff saying so.
      problems.push(`${id} is named as a P1-31 operation but the register does not carry it`);
      continue;
    }
    const parts = String(operation.route ?? '')
      .split('/')
      .filter((p) => p && p !== 'api' && p !== 'v1' && !p.startsWith('{'));
    if (parts.length === 0) {
      problems.push(`${id} has no resource root in its route`);
      continue;
    }
    segments.add(parts[0]);
  }

  for (const area of P1_31_AREAS) segments.add(area);

  return { segments: [...segments].sort(), problems };
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

/** Every P1-31 route page under an app root. */
export function p1_31PagesUnder(appRoot, segments = ownedSegments()) {
  return walk(appRoot).filter((p) => {
    const rel = slash(p);
    return segments.some((seg) => rel.includes(`/${seg}/`));
  });
}

function main() {
  const i = process.argv.indexOf('--app-root');
  const overridden = i !== -1;
  const appRoot = overridden ? process.argv[i + 1] : join(ROOT, 'apps', 'web', 'src', 'app');
  const m = process.argv.indexOf('--min-pages');
  const minPages = m === -1 ? (overridden ? 0 : 1) : Number(process.argv[m + 1]);

  const { segments, problems } = deriveSegments();
  const violations = [...problems];

  if (segments.length === 0) {
    violations.push(
      'the P1-31 segment derivation is EMPTY — a gate that owns no segments examines no pages ' +
        'and passes everything'
    );
  }

  const pages = p1_31PagesUnder(appRoot, segments);
  for (const page of pages) {
    const why = judgePage(readFileSync(page, 'utf8'));
    if (why) violations.push(`gate-before-read: ${slash(relative(ROOT, page))} ${why}`);
  }

  console.log(
    `P1-31 gate-before-read: ${pages.length} route page(s) examined across ` +
      `${segments.length} owned segment(s) (${segments.join(', ')}).`
  );

  if (pages.length < minPages) {
    // Unlike its two siblings, this gate ships beside a screen. Falling under
    // the floor over the repository's own app root means the derivation stopped
    // matching, and a pass over an empty set would report that as health.
    violations.push(
      `FEWER than ${minPages} P1-31 route page(s) were found under the application root — this ` +
        'gate ships beside a screen, so an examination under the floor is a broken derivation ' +
        'rather than an unstarted phase'
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
