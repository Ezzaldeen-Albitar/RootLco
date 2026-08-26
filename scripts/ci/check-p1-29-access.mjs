#!/usr/bin/env node
/**
 * `gate-before-read` for P1-29 route pages (`PRE-P1-29-BR-08c`).
 *
 * Every P1-29 route page must DENY AND RETURN on a permission BEFORE its first
 * awaited read. The denial renders instead of the screen, so an operator who may
 * not see a thing never spends a request discovering that.
 *
 * ## It is armed BEFORE the screens exist, and that is the entire point
 *
 * There are **zero** P1-29 route pages today. A gate written after the screens
 * land does not check them — it ratifies them, because whatever shape they were
 * built in becomes the shape the gate is tuned to accept. The contract says so
 * directly: _"Extend the rule to P1-29's routes, in the first frontend slice, not
 * the last."_ So the rule is armed now, against an empty set, and the first P1-29
 * screen has to satisfy a rule that predates it.
 *
 * ## A gate over an empty set is a vacuous gate, so this one says so out loud
 *
 * Passing silently over nothing is the false-green shape this repository has
 * produced before. Every run therefore prints the page count it examined, and
 * `tests/ci/p1-29-access-gate.test.ts` plants an ungated page and requires this
 * gate to go red on it — the pass over zero pages proves nothing on its own and
 * is not offered as proof.
 *
 * ## Why a SIBLING rather than a wider `check-p1-28-access.mjs`
 *
 * That gate is what P1-28's seal rests on. Widening it to reach P1-29 would change
 * a gate a sealed phase depends on, for the benefit of a phase that has not
 * shipped a screen yet. It stays byte-identical; this file is separate.
 *
 *     node scripts/ci/check-p1-29-access.mjs
 *     node scripts/ci/check-p1-29-access.mjs --app-root <dir>   # for the red-proof
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..', '..');
const slash = (p) => p.split(sep).join('/');

/**
 * The route segments P1-29 owns.
 *
 * Named rather than derived, for the same reason `MIRROR_FILES` is: a derived
 * list is a list that grows silently, and the point of this gate is that a NEW
 * screen meets an OLD rule.
 */
export const P1_29_SEGMENTS = Object.freeze([
  'work-orders',
  'jobs',
  'technicians',
  'inspections',
  'diagnostics',
  'quality-controls',
  'rework',
]);

/** `holds(...)` used as a deny gate, not as a capability for a control. */
const DENY_GATE = /if\s*\(\s*!\s*holds\s*\(/;
/** The first read that costs a request. `params`/`searchParams` are not reads. */
const AWAITED_READ = /await\s+(?!params\b|searchParams\b|requireSession\b)[A-Za-z_$][\w$]*\s*\(/;

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
export function p1_29PagesUnder(appRoot) {
  return walk(appRoot).filter((p) => {
    const rel = slash(p);
    return P1_29_SEGMENTS.some((seg) => rel.includes(`/${seg}/`));
  });
}

/**
 * Does this page deny-and-return on a permission before its first awaited read?
 *
 * Both halves are POSITIONAL, and the P1-28 gate records that both were once
 * measured wrongly — each error pointing the same way, toward reporting clean.
 * So the gate looks for `if (!holds(` specifically: a route page is full of the
 * other kind of `holds`, the sort that computes a capability for a control and
 * denies nothing, and keying on the first `holds` of any kind would let a page
 * whose real gate stands after its first read measure as clean.
 */
export function judgePage(source) {
  const gate = source.search(DENY_GATE);
  if (gate === -1) {
    return /holds\s*\(/.test(source)
      ? 'consults a permission but never denies and returns on one'
      : 'consults no permission at all';
  }
  const read = source.search(AWAITED_READ);
  if (read !== -1 && read < gate) return 'reads before it denies on a permission';
  return null;
}

function main() {
  const i = process.argv.indexOf('--app-root');
  const appRoot = i === -1 ? join(ROOT, 'apps', 'web', 'src', 'app') : process.argv[i + 1];

  const pages = p1_29PagesUnder(appRoot);
  const violations = [];
  for (const page of pages) {
    const why = judgePage(readFileSync(page, 'utf8'));
    if (why) violations.push(`gate-before-read: ${slash(relative(ROOT, page))} ${why}`);
  }

  console.log(
    `P1-29 gate-before-read: ${pages.length} route page(s) examined across ` +
      `${P1_29_SEGMENTS.length} owned segment(s).`
  );
  if (pages.length === 0) {
    // Said out loud. A silent pass over an empty set is indistinguishable from a
    // pass over a checked one, and only one of those means anything.
    console.log(
      '  ZERO pages exist yet — this run proves nothing about any screen. The rule is ARMED so ' +
        'that the first P1-29 screen meets a rule that predates it; its teeth are proved by ' +
        'tests/ci/p1-29-access-gate.test.ts, which plants an ungated page and requires a red.'
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
