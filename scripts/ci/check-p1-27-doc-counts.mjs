#!/usr/bin/env node
/**
 * Every count a P1-27 document states about the repository must be derivable.
 *
 * ## The family this closes
 *
 * Round five found thirteen separate stale numbers in the phase records, and
 * they are one defect: **a count written by hand that nothing recomputes.**
 *
 *   E-03  a case count pinned by nothing while the file count beside it is pinned
 *   E-04  two headings stating file counts the tables beneath them do not list
 *   E-05  two stale totals left by a fix that corrected the sentence above them
 *   E-06  eight of fifteen documentation line counts wrong, under a row
 *         asserting "26 of 26 exact"
 *   E-07  "15 tracked" phase documents against a tree holding 30
 *   E-08  one directory stated as 31 in two places and 33 in a third
 *   E-09  a database test-file count off by one
 *   E-11  three of four "measured" case counts wrong, in the row that exists to
 *         correct a stale register
 *   E-12  one gate reported with two different measured outputs in one document
 *   G-07  four case counts stated twice, disagreeing with themselves
 *   G-08  one suite cited as 28 cases in one document and 26 in another
 *
 * Fixing thirteen numbers by hand produces thirteen numbers that will be wrong
 * again. The only durable fix is to make the repository the authority and let a
 * gate refuse any statement that disagrees with it.
 *
 * ## What is derived, and the honesty of "cases"
 *
 * File counts and line counts are exact. A CASE count is derived by counting
 * `it(` / `test(` call sites in the comment-stripped source — which is what
 * these documents have always meant by "cases", and is stated here rather than
 * implied. It does not expand `it.each`, so a file using `.each` is EXCLUDED
 * from the derived set rather than reported wrongly: a number that is right for
 * most files and quietly wrong for a few is worse than one that says which files
 * it covers.
 *
 * Usage:  node scripts/ci/check-p1-27-doc-counts.mjs [--json out.json]
 * Exit:   0 clean · 1 a document disagrees with the tree · 2 IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const native = (p) => join(ROOT, p.split(posix.sep).join(sep));

export const PHASE_DIR = 'docs/phase-1/phase-1-27';

/** Blanks comments while preserving line structure. */
export function stripComments(source) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

/**
 * Case count for one test file, or `null` when it cannot be derived honestly.
 *
 * `it.each` expands at runtime into as many cases as its table has rows, and a
 * static count cannot know that. Returning `null` removes the file from the
 * checked set instead of asserting a number that is wrong.
 */
export function caseCount(source) {
  const code = stripComments(source);
  if (/\b(it|test)\s*\.\s*each\b/.test(code)) return null;
  return (code.match(/(?:^|[^.\w])(?:it|test)\s*\(/g) ?? []).length;
}

/** Every count this gate can derive from the tree, by the name a document uses. */
export function deriveCounts(root = ROOT) {
  const isTest = (p) => /\.test\.tsx?$/.test(p);
  const counts = {
    'scripts/ci': walk(join(root, 'scripts', 'ci'), (p) => p.endsWith('.mjs')).length,
    'tests/ci': walk(join(root, 'tests', 'ci'), isTest).length,
    'tests/db': walk(join(root, 'tests', 'db'), isTest).length,
    'tests/backend': walk(join(root, 'tests', 'backend'), isTest).length,
    'apps/web/tests': walk(join(root, 'apps', 'web', 'tests'), isTest).length,
    'apps/web/scripts': walk(join(root, 'apps', 'web', 'scripts'), (p) => p.endsWith('.mjs'))
      .length,
    'supabase/migrations': walk(join(root, 'supabase', 'migrations'), (p) => p.endsWith('.sql'))
      .length,
  };

  /** Per-file case counts for the web tier, keyed by basename. */
  const cases = {};
  for (const file of walk(join(root, 'apps', 'web', 'tests'), isTest)) {
    const n = caseCount(readFileSync(file, 'utf8'));
    if (n !== null) cases[file.split(sep).pop()] = n;
  }
  for (const file of walk(join(root, 'tests', 'ci'), isTest)) {
    const n = caseCount(readFileSync(file, 'utf8'));
    if (n !== null) cases[file.split(sep).pop()] = n;
  }

  /** Line counts for the phase's own documents, keyed by basename. */
  const lines = {};
  for (const file of walk(native(PHASE_DIR), (p) => p.endsWith('.md'))) {
    lines[file.split(sep).pop()] = readFileSync(file, 'utf8').split('\n').length;
  }

  return { counts, cases, lines };
}

/**
 * A document may state a count for a named thing only if it matches the tree.
 *
 * The claim syntax is deliberate and narrow: `<!-- derived: KIND NAME = N -->`.
 * A gate that tried to parse every bolded number out of prose would either miss
 * the ones written differently or fire on unrelated figures — both of which this
 * phase has already shipped. An explicit marker means the document opts a number
 * IN, and the gate is exact about the ones it owns.
 */
export function checkDocument(relative, source, derived) {
  const problems = [];
  for (const m of source.matchAll(
    /<!--\s*derived:\s*(files|cases|lines)\s+(\S+)\s*=\s*(\d+)\s*-->/g
  )) {
    const [, kind, name, stated] = m;
    const table =
      kind === 'files' ? derived.counts : kind === 'cases' ? derived.cases : derived.lines;
    const actual = table[name];
    if (actual === undefined) {
      problems.push(
        `${relative}: claims ${kind} for \`${name}\`, which this gate cannot derive. ` +
          (kind === 'cases'
            ? 'A file using `it.each` is deliberately excluded — cite it without a derived marker.'
            : 'Check the name.')
      );
      continue;
    }
    if (Number(stated) !== actual) {
      problems.push(`${relative}: states ${kind} ${name} = ${stated}; the tree holds ${actual}.`);
    }
  }
  return problems;
}

export function evaluate(root = ROOT) {
  const derived = deriveCounts(root);
  const problems = [];
  let claims = 0;
  const docs = walk(native(PHASE_DIR), (p) => p.endsWith('.md'));
  for (const file of docs) {
    const relative = file
      .slice(root.length + 1)
      .split(sep)
      .join(posix.sep);
    const source = readFileSync(file, 'utf8');
    claims += (source.match(/<!--\s*derived:/g) ?? []).length;
    problems.push(...checkDocument(relative, source, derived));
  }
  return { ok: problems.length === 0, problems, claims, documents: docs.length, derived };
}

function main(argv) {
  let result;
  try {
    result = evaluate(ROOT);
  } catch (error) {
    process.stderr.write(`::error::cannot derive P1-27 document counts: ${error.message}\n`);
    return 2;
  }
  const jsonOut = argv[argv.indexOf('--json') + 1];
  if (argv.includes('--json') && jsonOut) {
    writeJson(jsonOut, result);
  }
  for (const problem of result.problems) process.stderr.write(`::error::${problem}\n`);
  process.stdout.write(
    `P1-27 document counts: ${result.claims} derived claim(s) across ${result.documents} document(s), ` +
      `${result.problems.length} disagreement(s).\n`
  );
  return result.ok ? 0 : 1;
}

function writeJson(path, result) {
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
