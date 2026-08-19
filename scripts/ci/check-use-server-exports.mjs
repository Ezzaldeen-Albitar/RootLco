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
 * The exports a `'use server'` module may have — a WHITELIST.
 *
 * This was written as a blacklist of four shapes (`export const|let|var|class`,
 * a non-async `export function`, and value members of an `export { … }` list)
 * while the rule above it was stated as a whitelist. The gap was not
 * theoretical: `export default { … }` and `export enum Status { … }` are both
 * plain runtime objects — literally the "found object" refusal this gate
 * quotes — and both passed, as did `export * from`, which re-exports every value
 * another module has.
 *
 * So the question asked of each export is now "is this one of the two things
 * that are allowed?" rather than "is this one of the four things I remembered
 * to forbid". The two allowed things are:
 *
 *   - an ASYNC FUNCTION DECLARATION, named or default. This is the contract.
 *   - a TYPE-ONLY export — `export type`, `export interface`, or an export list
 *     whose every member is `type`-qualified. TypeScript erases these before
 *     Next sees the module, so they are not exports at runtime at all.
 *
 * Everything else is reported, including shapes nobody has written yet. That
 * is the point of the inversion: a blacklist is only ever as complete as the
 * last defect somebody remembered.
 *
 * `offendingExports` is a pure function of (path, source) so the test can hand
 * it sources that do not exist on disk — the anti-vacuity idiom this
 * repository uses everywhere, and the reason a passing sweep means something.
 */
export function offendingExports(path, source) {
  if (!declaresUseServer(source)) return [];
  const code = stripComments(source);
  const problems = [];

  for (const match of code.matchAll(/^export\b/gm)) {
    const rest = code.slice(match.index ?? 0);

    // ALLOWED: an async function declaration, named or default.
    if (/^export\s+(?:default\s+)?async\s+function\b/.test(rest)) continue;

    // ALLOWED: a type or interface declaration — erased before runtime.
    if (/^export\s+(?:declare\s+)?(?:type|interface)\b/.test(rest)) continue;

    /*
     * An export LIST is allowed only when every member is type-qualified. A
     * single value member is exactly the shape that broke the server chunk.
     */
    const list = /^export\s*\{([^}]*)\}/.exec(rest);
    if (list) {
      const values = (list[1] ?? '')
        .split(',')
        .map((member) => member.trim())
        .filter((member) => member.length > 0 && !/^type\s/.test(member));
      for (const member of values) {
        problems.push(
          `${path}: re-exports ${member} — a 'use server' file may export only async ` +
            'functions, and a value in an export list is exactly the shape that broke the ' +
            'server chunk'
        );
      }
      continue;
    }

    /*
     * Everything else. Reported with the head of the statement so the message
     * names the thing a reader has to go and look at, whatever shape it is.
     */
    const line = rest.slice(0, rest.indexOf('\n') === -1 ? rest.length : rest.indexOf('\n'));
    problems.push(
      `${path}: ${line.trim().slice(0, 90)} — a 'use server' file may export only async ` +
        'functions and types'
    );
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
