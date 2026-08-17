#!/usr/bin/env node
/**
 * A `'use server'` module exports async functions and NOTHING else.
 *
 * ## The defect this exists for, which cost a working screen
 *
 * `features/attachments/api.ts` carried `export { EMPTY_CATEGORIES }` — a
 * `readonly DocumentCategory[] = []` that nothing imported. Next refuses such a
 * module at evaluation:
 *
 *     A "use server" file can only export async functions, found object.
 *
 * The refusal happens while the SERVER CHUNK is being instantiated, so it does
 * not fail only the module that broke the rule: it takes down every Server
 * Action bundled beside it. The observed casualty was
 * `listWarningLightCodes()`, in a different feature, which does not import the
 * offending file at all. It rejected before it could reach the API, on a screen
 * whose catalogue was correctly configured, and the browser tier reported it as
 * a form that never appeared.
 *
 * ## Why a gate and not a lint rule we hope somebody enables
 *
 * `next dev` NEVER SHOWS THIS. It evaluates lazily, per route, so the module is
 * only instantiated where something imports it, and the broken export sat in the
 * tree through a full green local battery, a green unit tier and a green web
 * tier. It appeared the first time the acceptance environment was built the way
 * the product actually ships. A defect that only a production build reveals must
 * be caught by something that runs on every change, not by the next person who
 * happens to run one.
 *
 * ## What counts as an export here
 *
 * TYPES ARE FINE and are not exports at runtime: `export type`,
 * `export interface` and a type-only member of an `export { … }` list are all
 * erased before Next sees the module. Everything else must be an
 * `export async function`. A `export const doThing = async () => {}` is refused
 * deliberately even though Next tolerates it — this repository's Server Actions
 * are declarations, and a rule with one spelling is a rule that can be checked.
 *
 * Usage: node scripts/ci/check-use-server-exports.mjs [--json]
 * Exit: 0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

/** Every tree that may contain a `'use server'` module. */
export const SCAN_ROOTS = [join('apps', 'web', 'src'), join('apps', 'api', 'src')];

const SKIP_DIRS = new Set(['node_modules', '.next', '.next-dev', 'dist', 'coverage']);

/** Comments stripped, so a docblock quoting the rule is not accused of breaking it. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** True when the file opts into the Server Action contract. */
export function declaresUseServer(source) {
  return /^\s*(['"])use server\1\s*;?/.test(stripComments(source));
}

/**
 * The exports a `'use server'` module may not have.
 *
 * Returns one message per offending export. A file with none is compliant, and
 * `check()` is a pure function of (path, source) so the test can hand it sources
 * that do not exist on disk — the anti-vacuity idiom this repository uses
 * everywhere, and the reason a passing sweep means something.
 */
export function offendingExports(path, source) {
  if (!declaresUseServer(source)) return [];
  const code = stripComments(source);
  const problems = [];

  // `export const x = …`, `export let`, `export var`, `export class`.
  for (const match of code.matchAll(/^export\s+(const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) {
    problems.push(
      `${path}: exports ${match[1]} ${match[2]} — a 'use server' file may export only async functions`
    );
  }

  // `export function foo` without `async`.
  for (const match of code.matchAll(/^export\s+(?:default\s+)?function\s+([A-Za-z0-9_$]+)/gm)) {
    problems.push(
      `${path}: exports a NON-ASYNC function ${match[1]} — every export must be an async function`
    );
  }

  /*
   * `export { … }` lists. A `type` member is erased, so only value members
   * count; a list of nothing but types is legal and must not be reported.
   */
  for (const match of code.matchAll(/^export\s*\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"])?\s*;?/gm)) {
    const values = (match[1] ?? '')
      .split(',')
      .map((member) => member.trim())
      .filter((member) => member.length > 0 && !/^type\s/.test(member));
    for (const member of values) {
      problems.push(
        `${path}: re-exports ${member} — a 'use server' file may export only async functions, ` +
          'and a value in an export list is exactly the shape that broke the server chunk'
      );
    }
  }

  return problems;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) out.push(path);
  }
  return out;
}

export function run() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    const absolute = join(ROOT, root);
    try {
      if (statSync(absolute).isDirectory()) walk(absolute, files);
    } catch {
      /* a tree that does not exist is reported by the anti-vacuity check below */
    }
  }

  const sources = files.map((absolute) => ({
    path: relative(ROOT, absolute).split(sep).join('/'),
    source: readFileSync(absolute, 'utf8'),
  }));
  const serverModules = sources.filter(({ source }) => declaresUseServer(source));
  const problems = serverModules.flatMap(({ path, source }) => offendingExports(path, source));

  return { scanned: sources.length, serverModules: serverModules.length, problems };
}

function main() {
  const result = run();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  }

  /*
   * A sweep that opened nothing would report clean while measuring nothing —
   * the failure mode this repository has caught more than once. Both halves are
   * asserted: files were read, and some of them really are Server Action
   * modules.
   */
  if (result.scanned === 0 || result.serverModules === 0) {
    console.error(
      `Fail closed: scanned ${result.scanned} file(s) and found ${result.serverModules} ` +
        "'use server' module(s). This check cannot be trusted over nothing."
    );
    process.exit(2);
  }

  console.log(
    `'use server' exports: ${result.serverModules} module(s) across ${result.scanned} ` +
      `source file(s), ${result.problems.length} violation(s).`
  );

  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(`  ${problem}`);
    console.error(
      "\nA 'use server' file may export async functions and nothing else. Next refuses the " +
        'module at evaluation and takes down every Server Action in the same server chunk — ' +
        'including ones in other features that never imported it. `next dev` does not show ' +
        'this; a production build does. Move the value to a module without the directive.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
