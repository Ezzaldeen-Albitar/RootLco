#!/usr/bin/env node
/**
 * Every count a P1-27 document states about the repository must be derivable,
 * and every load-bearing sentence in the two guides must be checkable.
 *
 * ## The family this closes
 *
 * Round five found thirteen separate stale numbers in the phase records, and
 * they are one defect: **a count written by hand that nothing recomputes.**
 *
 *   E-02  a section's prose disagreeing with its own heading four lines above
 *   E-03  a case count pinned by nothing while the file count beside it is pinned
 *   E-04  two headings stating file counts the tables beneath them do not list
 *   E-05  stale totals left by a fix that corrected the sentence above them
 *   E-06  eight of fifteen documentation line counts wrong, under a row
 *         asserting "26 of 26 exact"
 *   E-07  "15 tracked" phase documents against a tree holding far more
 *   E-08  one directory stated as 31 in two places and 33 in a third
 *   E-09  a database test-file count off by one
 *   E-10  superseded command output presented as current
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
 * ## Why a number is DERIVED rather than corrected
 *
 * `check-p1-27-frontend.mjs` owns a file count that four documents quoted. It is
 * about to walk one more tree, and every document that hand-copied `43` will be
 * wrong on the commit that lands it. So no document states that number; each
 * states a marker, and this gate substitutes the tree's answer for it.
 *
 * ## What is derived, and the honesty of "cases"
 *
 * File, line, tracked-file, table-row and command-coverage counts are exact.
 *
 * A CASE count is derived by counting `it(` / `test(` call sites in the
 * comment-stripped source, which is what these documents have always meant by
 * "cases". It is derived only when a static count can be RIGHT:
 *
 *   - a file using `it.each` is excluded — the table's row count is a runtime
 *     fact and a call site is not it;
 *   - a file that generates cases inside a loop or an iteration callback is
 *     excluded for the same reason. `route-permission-binding.test.ts` declares
 *     three call sites and runs seven, and the previous revision of this gate
 *     would have certified "3" as derived truth.
 *
 * That second exclusion exists because it was found, not anticipated: the static
 * and runtime counts of all sixty-six web test files were compared, and two
 * disagreed. A gate that is right for most files and quietly wrong for a few is
 * worse than one that says which files it covers.
 *
 * ## The comment stripper is the part most likely to be wrong
 *
 * The previous revision used two regular expressions. `apps/**` inside a string
 * literal opens `/*` to them, so everything from that string to the next `*​/`
 * was blanked — which is how `p1-27-guidance-reconciliation.test.ts` derived as
 * nine cases while running ten. This phase has now shipped that same class of
 * defect seven times: a text scanner that cannot tell code from prose about
 * code. The stripper below is a scanner with modes, not a regular expression,
 * and it leaves string, template and regular-expression literals intact.
 *
 * Usage:  node scripts/ci/check-p1-27-doc-counts.mjs [--json out.json]
 * Exit:   0 clean · 1 a document disagrees with the tree · 2 IO error.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SCAN_ROOTS, RULES, assertNotSymlink } from './check-p1-27-frontend.mjs';
import {
  REGISTER,
  readScripts,
  readWorkflowInvocations,
  evaluate as evaluateCommandCoverage,
} from './check-command-coverage.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const native = (root, p) => join(root, p.split(posix.sep).join(sep));

export const PHASE_DIR = 'docs/phase-1/phase-1-27';
export const PRODUCT_DIR = 'docs/product';
export const MATRIX_PATH = `${PHASE_DIR}/task-matrix.json`;
export const REGISTER_PATH = `${PHASE_DIR}/adversarial-round-five.md`;
export const DECISIONS_PATH = `${PHASE_DIR}/open-decisions.md`;

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

/** A `/` here begins a regular expression, not a division. */
const REGEX_PRECEDER = /[([{,;:=!&|?+\-*%~^<>]$/;
const REGEX_KEYWORD =
  /\b(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;

/**
 * Blanks comments while preserving every byte position and line break.
 *
 * Positions are preserved because a count is not the only consumer: a line
 * number reported against stripped source must still point at the real line.
 * Round five found the opposite convention shipped — a stripper that replaced
 * newlines with spaces, so a control on line 370 was reported at 322.
 */
export function stripComments(source, { literals = 'keep' } = {}) {
  const out = [];
  let i = 0;
  const n = source.length;
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  /*
   * `tail` is the last few emitted characters, kept incrementally.
   *
   * The first version asked `out.replace(/\s+$/, '')` at every `/`, which is a
   * scan of the whole accumulated output per slash — quadratic, and it took the
   * gate to three and a half seconds against a five-second test timeout. The
   * only thing the question needs is the last token, so only the last token is
   * kept.
   */
  let tail = '';
  const significant = () => tail.replace(/\s+$/, '');
  const push = (text) => {
    out.push(text);
    tail = (tail + text).slice(-48);
  };
  /**
   * A literal is emitted verbatim by default and hollowed out for counting.
   *
   * `policy-and-linters.test.ts` is a linter's test, so it carries `'it('` and
   * `` `it${SKIP}(` `` as FIXTURE DATA. Twelve of its eighty-two apparent call
   * sites are strings, which is why its static count was twelve above the
   * seventy it runs. The opening delimiter is kept so the surrounding code still
   * parses the same way; everything inside it becomes blanks.
   */
  const emit = (text) => (literals === 'blank' ? text.slice(0, 1) + blank(text.slice(1)) : text);

  /** Only these characters can start a comment or a literal. */
  const INTERESTING = /['"`/]/g;

  while (i < n) {
    INTERESTING.lastIndex = i;
    const at = INTERESTING.exec(source);
    if (!at) {
      push(source.slice(i));
      break;
    }
    if (at.index > i) push(source.slice(i, at.index));
    i = at.index;

    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      let j = i;
      while (j < n && source[j] !== '\n') j += 1;
      push(' '.repeat(j - i));
      i = j;
      continue;
    }

    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      push(blank(source.slice(i, j)));
      i = j;
      continue;
    }

    if (c === '"' || c === "'") {
      const j = endOfQuoted(source, i, c);
      push(emit(source.slice(i, j)));
      i = j;
      continue;
    }

    if (c === '`') {
      const j = consumeTemplate(source, i);
      push(emit(source.slice(i, j)));
      i = j;
      continue;
    }

    const before = significant();
    if (before === '' || REGEX_PRECEDER.test(before) || REGEX_KEYWORD.test(before)) {
      const j = endOfRegex(source, i);
      if (j > i) {
        push(emit(source.slice(i, j)));
        i = j;
        continue;
      }
    }

    push(c);
    i += 1;
  }
  return out.join('');
}

/** Index just past a `'`/`"` literal opened at `start`. */
function endOfQuoted(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote || c === '\n') return i + 1;
    i += 1;
  }
  return source.length;
}

/**
 * Index just past a template literal, INCLUDING its `${…}` expressions.
 *
 * The expressions are returned verbatim rather than blanked, so a case declared
 * inside one is still visible to the counter. Nothing in this repository does
 * that today; a scanner that silently could not see it would be the same defect
 * as the one above.
 */
function consumeTemplate(source, start) {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') return i + 1;
    if (c === '$' && source[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        const d = source[i];
        if (d === '{') depth += 1;
        else if (d === '}') depth -= 1;
        else if (d === '`') i = consumeTemplate(source, i) - 1;
        else if (d === '"' || d === "'") i = endOfQuoted(source, i, d) - 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return source.length;
}

/** Index just past a regular-expression literal, or `start` when it is not one. */
function endOfRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === '\n') return start;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      i += 1;
      while (i < source.length && /[a-z]/.test(source[i])) i += 1;
      return i;
    }
    i += 1;
  }
  return start;
}

/** A block header that makes the cases inside it a runtime quantity. */
const ITERATION = /\b(?:for|while)\s*\(|\.\s*(?:forEach|map|flatMap|filter|reduce)\s*\(/;

/**
 * Case count for one test file, or `null` when it cannot be derived honestly.
 *
 * `null` removes the file from the checked set instead of asserting a number
 * that is wrong. Two things make a static count wrong, and both are refused:
 * `it.each`, whose row count is data; and a case declared inside a loop or an
 * iteration callback, whose multiplicity is the length of whatever it iterates.
 */
export function caseCount(source) {
  const code = stripComments(source, { literals: 'blank' });
  if (/\b(it|test)\s*\.\s*each\b/.test(code)) return null;
  return countCases(code);
}

/**
 * `it(`/`test(` call sites that are NOT inside a loop or iteration callback.
 * Returns `null` the moment one is, because then no static number is right.
 *
 * Blocks are tracked because nesting is what decides the answer. A block with no
 * statement inside it was not a block at all — it was a destructuring pattern in
 * the header being accumulated, `for (const { prop } of CASES) {` — so its outer
 * header is restored on close, which is what lets the loop body below it be
 * recognised as a loop body.
 */
function countCases(code) {
  let count = 0;
  const stack = [];
  let header = '';

  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];

    if (c === '{') {
      const dynamic = ITERATION.test(header) || (stack.at(-1)?.dynamic ?? false);
      stack.push({ header, dynamic, hadStatement: false });
      header = '';
      continue;
    }
    if (c === '}') {
      const frame = stack.pop();
      header = frame && !frame.hadStatement ? `${frame.header} ` : '';
      continue;
    }
    if (c === ';') {
      const frame = stack.at(-1);
      if (frame) frame.hadStatement = true;
      header = '';
      continue;
    }

    header += c;

    if (c === '(') {
      const call = /(?:^|[^.\w])(it|test)\s*\($/.exec(header);
      if (call) {
        if (stack.at(-1)?.dynamic) return null;
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Every file under `dir` that `predicate` accepts. A symlink is REFUSED.
 *
 * `QA005-12` closed this in the two evidence walkers and this one was missed,
 * while the docblock in `build-p1-27-evidence-manifest.mjs` said "every walker in
 * this phase now applies the same policy". It did not, and the omission is the
 * dangerous half: `Dirent.isDirectory()` is FALSE for a directory symlink or a
 * Windows junction, so the recursion did not descend into it, and then
 * `predicate(full)` rejected `some-junction` because it does not end in `.md` —
 * so the tree beyond it contributed nothing to any derived count and no line of
 * output said so. Every number this gate holds documents to would have been
 * measured over a smaller tree than the reader believes, which is precisely the
 * defect family this gate exists to close.
 *
 * The guard sits after the `node_modules`/dotfile skip, not before it: those two
 * names are excluded by policy whatever they are, and a linked `node_modules` is
 * an ordinary package-manager layout rather than a signal. Anything this gate
 * actually reads must be a real file in a real directory.
 */
export function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    assertNotSymlink(entry, full);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Derivation
 * ------------------------------------------------------------------ */

/**
 * The ownership gate's own file count, from the gate's own scan roots.
 *
 * `SCAN_ROOTS` is imported rather than restated, so the day a third tree is
 * added every document that carries this marker follows it. The one coupling
 * left is the extension list and the skipped directories, which are private to
 * that module; they are mirrored here and named as the coupling they are.
 */
const GATE_EXTENSIONS = /\.(ts|tsx)$/;
const GATE_SKIP = new Set(['node_modules', '.next', 'coverage']);

function gateFiles(root) {
  const out = [];
  const descend = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (GATE_SKIP.has(entry.name)) continue;
      // Same policy as `walk` above and as the two evidence walkers: a link is
      // invisible to `isDirectory()`, so walking past it scans nothing quietly.
      assertNotSymlink(entry, join(dir, entry.name));
      if (entry.isDirectory()) {
        descend(join(dir, entry.name));
      } else if (GATE_EXTENSIONS.test(entry.name)) out.push(join(dir, entry.name));
    }
  };
  for (const scanRoot of SCAN_ROOTS) descend(join(root, scanRoot));
  return out;
}

/** Repository-relative paths git is tracking under `dir`. */
function trackedFiles(root, dir) {
  const out = execFileSync('git', ['ls-files', '-z', '--', dir], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

/** `wc -l` semantics: the number of lines, not the number of split parts. */
function lineCount(text) {
  const parts = text.split('\n');
  return text.endsWith('\n') ? parts.length - 1 : parts.length;
}

/** Every count this gate can derive from the tree, by the name a document uses. */
export function deriveCounts(root = ROOT) {
  const isTest = (p) => /\.test\.tsx?$/.test(p);
  const any = () => true;

  const counts = {
    'scripts/ci': walk(join(root, 'scripts', 'ci'), (p) => p.endsWith('.mjs')).length,
    'tests/ci': walk(join(root, 'tests', 'ci'), isTest).length,
    'tests/db': walk(join(root, 'tests', 'db'), isTest).length,
    'tests/db:all': walk(join(root, 'tests', 'db'), any).length,
    'tests/backend': walk(join(root, 'tests', 'backend'), isTest).length,
    'tests/backend:all': walk(join(root, 'tests', 'backend'), any).length,
    'apps/web/tests': walk(join(root, 'apps', 'web', 'tests'), isTest).length,
    'apps/web/scripts': walk(join(root, 'apps', 'web', 'scripts'), (p) => p.endsWith('.mjs'))
      .length,
    'supabase/migrations': walk(join(root, 'supabase', 'migrations'), (p) => p.endsWith('.sql'))
      .length,
    'apps/web/src/features/crm': walk(
      join(root, 'apps', 'web', 'src', 'features', 'crm'),
      GATE_EXTENSIONS.test.bind(GATE_EXTENSIONS)
    ).length,
    'apps/web/src/features/vehicles': walk(
      join(root, 'apps', 'web', 'src', 'features', 'vehicles'),
      GATE_EXTENSIONS.test.bind(GATE_EXTENSIONS)
    ).length,
    'p1-27-frontend-gate': gateFiles(root).length,
    'p1-27-frontend-gate:trees': SCAN_ROOTS.length,
    'p1-27-frontend-gate:rules': RULES.length,
  };

  /** Per-file case counts, keyed by basename, for the tiers documents cite. */
  const cases = {};
  for (const dir of [join(root, 'apps', 'web', 'tests'), join(root, 'tests', 'ci')]) {
    for (const file of walk(dir, isTest)) {
      const n = caseCount(readFileSync(file, 'utf8'));
      if (n !== null) cases[file.split(sep).pop()] = n;
    }
  }

  /** Line counts, keyed by repository-relative path — basenames collide. */
  const lines = {};
  for (const dir of [PHASE_DIR, PRODUCT_DIR]) {
    for (const file of walk(native(root, dir), (p) => /\.(md|json)$/.test(p))) {
      const relative = file
        .slice(root.length + 1)
        .split(sep)
        .join(posix.sep);
      lines[relative] = lineCount(readFileSync(file, 'utf8'));
    }
  }

  /** Tracked-file counts. "Tracked" is the claim these documents make. */
  const tracked = {};
  for (const dir of [PHASE_DIR, PRODUCT_DIR]) {
    const files = trackedFiles(root, dir);
    tracked[dir] = files.length;
    tracked[`${dir}:md`] = files.filter((p) => p.endsWith('.md')).length;
  }

  /** Command coverage, from the register that owns the question. */
  const rows = evaluateCommandCoverage({
    scripts: readScripts(),
    workflowInvocations: readWorkflowInvocations(),
    register: REGISTER,
  }).rows;
  const required = rows.filter((r) => r.tier === 'required');
  const commands = {
    registered: rows.length,
    required: required.length,
    reachable: required.filter((r) => r.aggregate).length,
    'hosted-ci': required.filter((r) => r.hostedCi).length,
  };

  /**
   * The catalogue record's own shape, so its prose cannot restate it wrongly.
   *
   * `test-catalogue-traceability.md` §3 stated "16 distinct test files" and "109
   * quoted case titles" as prose beside a table it deliberately does not repeat.
   * Both were correct when written and both are properties of the JSON beside
   * them, so a rebinding changes them and nothing said so. They are derived now.
   */
  const catalogue = {};
  {
    const path = native(root, CATALOGUE_PATH);
    if (existsSync(path)) {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      const files = new Set();
      let titles = 0;
      for (const entry of Object.values(record.cases ?? {})) {
        for (const proof of entry.provenBy ?? []) {
          files.add(proof.file);
          titles += (proof.cases ?? []).length;
        }
      }
      catalogue.ids = Object.keys(record.cases ?? {}).length;
      catalogue.files = files.size;
      catalogue.titles = titles;
      catalogue.weak = (record.weakCitations?.entries ?? []).length;
      /*
       * The eighteen-path matrix's own shape. Three waves in a row restated it as
       * prose — "11/4/3", then "12/4/2", then "13/3/2" — and each restatement was
       * true for exactly as long as it took the next wave to move a row.
       */
      for (const [status, name] of [
        ['PROVEN', 'pathProven'],
        ['PARTIAL', 'pathPartial'],
        ['ABSENT', 'pathAbsent'],
      ]) {
        catalogue[name] = (record.pathMatrix ?? []).filter((row) => row.status === status).length;
      }
    }
  }

  /**
   * The evidence manifest's own file count.
   *
   * `evidence/change-log.md` said the digest covers "all 29 `.md`/`.json` files
   * in the phase directory" against a manifest holding 36 — a sentence its own
   * successors falsified while nothing read either number. Deriving it means the
   * next document that grows the phase tree fails here instead of ageing.
   */
  const manifest = {};
  {
    const path = native(root, `${PHASE_DIR}/evidence/evidence-manifest.json`);
    if (existsSync(path)) {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof record.fileCount === 'number') manifest.fileCount = record.fileCount;
    }
  }

  /**
   * The task matrix's own totals, so a document cannot restate them and age.
   *
   * `evidence/change-log.md` closed two consecutive waves on the sentence "The
   * matrix is 40 PASS / 2 PARTIAL / 0 FAIL", written in the present tense. Two
   * commits later `P1-27-OD-007` moved `DOC-001` to `PASS` and the sentence was
   * false, in the file whose whole job is to be current. The terminal table of
   * that document had already learned this and points at `task-matrix.json`
   * rather than repeating a figure; the wave entries above it had not.
   */
  const matrix = {};
  {
    const path = native(root, MATRIX_PATH);
    if (existsSync(path)) {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      for (const [key, value] of Object.entries(record.totals ?? {})) matrix[key] = value;
      for (const [key, value] of Object.entries(record.protectedReproof ?? {})) {
        matrix[key] = value;
      }
      if (typeof record.taskCount === 'number') matrix.taskCount = record.taskCount;
    }
  }

  return {
    counts,
    cases,
    lines,
    tracked,
    commands,
    catalogue,
    manifest,
    matrix,
    round5: deriveRoundFive(root).counts,
  };
}

/* ------------------------------------------------------------------ *
 * Guidance claims — `DOC-002`
 * ------------------------------------------------------------------ */

/**
 * A guide sentence is proved against the executable thing it describes.
 *
 * `DOC-002` is a conjunction — "operator / developer guidance **and** change-log
 * update" — and only the change-log half was ever derived. The guidance half is
 * carried by `apps/web/tests/p1-27-guidance-reconciliation.test.ts`, which is a
 * real gate and runs under `verify:web`; the claims below are the ones that
 * suite could not make, because each needs something outside the web workspace:
 *
 *   - the Arabic catalogue, which that suite never opens (`D-01`);
 *   - the ownership gate's real scan roots, which are wider than the roots that
 *     suite walks, so a `'use server'` file just outside them sat outside a
 *     partition the guide calls exhaustive (`D-02`).
 *
 * Each claim is opted into by the document with `<!-- checked: NAME -->`, and an
 * unknown NAME is a failure rather than a silent pass.
 */
export const GUIDE_CLAIMS = {
  'operator-guide/search-budget': (root, source) => {
    const policies = readFileSync(native(root, 'apps/api/src/server/http/rate-limit.ts'), 'utf8');
    const found = /'expensive-read':\s*\{[^}]*?limit:\s*(\d+),[^}]*?windowMs:\s*([\d_]+)/s.exec(
      policies
    );
    if (!found) return ['the `expensive-read` policy is no longer findable'];
    const limit = Number(found[1]);
    const windowMs = Number(found[2].replace(/_/g, ''));
    const problems = [];
    if (windowMs !== 60_000) problems.push(`the search window is ${windowMs}ms, not a minute`);
    const route = readFileSync(native(root, 'apps/api/src/app/api/v1/customers/route.ts'), 'utf8');
    if (!route.includes("rateLimitPolicy: 'expensive-read'")) {
      problems.push('customer search no longer binds the `expensive-read` policy');
    }
    const words = { 30: 'thirty', 60: 'sixty', 120: 'a hundred and twenty' };
    const phrase = `${words[limit] ?? String(limit)} searches the system allows each minute`;
    if (!source.includes(phrase)) problems.push(`the guide does not say "${phrase}"`);
    return problems;
  },

  'operator-guide/failure-states': (root, source) => {
    /*
     * `D-01`. The guide says its failure wording is "quoted from the product".
     * The web suite proves that against `en.json` only, so a row could be
     * English-only truth while the Arabic operator saw something else. Both
     * catalogues are read here, and the states are derived from the type that
     * defines them rather than listed.
     */
    const readOperation = readFileSync(
      native(root, 'apps/web/src/lib/api/read-operation.ts'),
      'utf8'
    );
    const union = /export type ReadFailureStatus =\s*([^;]+);/.exec(readOperation);
    if (!union) return ['`ReadFailureStatus` is no longer findable'];
    const states = [...union[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    const KEY = {
      denied: 'state.denied.title',
      unavailable: 'state.unavailable.title',
      expired: 'state.expired.title',
      error: 'state.error.title',
      'not-found': 'state.notFound.title',
    };
    const problems = [];
    const unmapped = states.filter((s) => !(s in KEY));
    if (unmapped.length > 0) problems.push(`no catalogue key for ${unmapped.join(', ')}`);

    const catalogues = {};
    for (const locale of ['en', 'ar']) {
      catalogues[locale] = JSON.parse(
        readFileSync(native(root, `apps/web/src/i18n/messages/${locale}.json`), 'utf8')
      );
    }
    for (const state of states) {
      const key = KEY[state];
      if (!key) continue;
      for (const locale of ['en', 'ar']) {
        if (typeof catalogues[locale][key] !== 'string') {
          problems.push(`${key} is missing from ${locale}.json`);
        }
      }
      const english = catalogues.en[key];
      if (typeof english === 'string' && !source.includes(english)) {
        problems.push(`the guide does not quote ${key} ("${english}")`);
      }
    }
    for (const locale of ['en', 'ar']) {
      const shown = states.map((s) => catalogues[locale][KEY[s]]).filter(Boolean);
      if (new Set(shown).size !== shown.length) {
        problems.push(`two failure states read identically in ${locale}.json`);
      }
    }
    const words = { 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' };
    const sentence = `${words[states.length] ?? states.length} different things can go wrong`;
    if (!source.includes(sentence)) problems.push(`the guide does not say "${sentence}"`);
    return problems;
  },

  'operator-guide/absent-capabilities': (root, source) => {
    /*
     * Three "not available" promises to an operator, each backed by a rule in
     * the ownership gate rather than by a sentence. If a rule is ever dropped
     * the promise stops being enforced, and the guide must stop making it.
     */
    const ids = RULES.map((rule) => rule.id);
    const REQUIRED = {
      'no-merge-caller': '**You cannot combine two customer records.**',
      'no-upload-path': '**Not available.**',
      'no-invented-total': '**No screen shows you a total row count.**',
    };
    const problems = [];
    for (const [id, promise] of Object.entries(REQUIRED)) {
      if (!ids.includes(id)) problems.push(`the gate no longer carries the rule \`${id}\``);
      else if (!source.includes(promise)) problems.push(`the guide no longer promises: ${promise}`);
    }
    return problems;
  },

  'developer-guide/enforced-rules': (root, source) => {
    const ids = RULES.map((rule) => rule.id);
    const WORDING = {
      'no-merge-caller': 'a merge caller of any shape',
      'no-duplicate-scan-on-a-queue': 'a duplicate-scan call from anywhere',
      'no-client-asserted-scope': 'a client-asserted',
      'no-invented-total': 'a total computed from `rows.length`',
      'no-upload-path': 'any upload path',
      'no-export-surface': 'any export surface',
      'no-invented-media-limit': 'any invented media limit',
      'no-console-output': 'any `console.*`',
    };
    const problems = [];
    for (const id of ids) {
      if (!(id in WORDING)) problems.push(`gate rule \`${id}\` has no sentence in the guide`);
      else if (!source.includes(WORDING[id])) problems.push(`\`${id}\` is not described`);
    }
    for (const id of Object.keys(WORDING)) {
      if (!ids.includes(id)) problems.push(`the guide describes \`${id}\`, which the gate lost`);
    }
    const list =
      /`npm run validate:p1-27-frontend` fails the build on:\n\n((?:- .*\n| {2}.*\n)+)/.exec(
        source
      );
    if (!list) return [...problems, 'the enforced-rules list is not findable'];
    const listed = list[1].split('\n').filter((line) => line.startsWith('- ')).length;
    if (listed !== ids.length) {
      problems.push(`the guide lists ${listed} enforced rules; the gate carries ${ids.length}`);
    }
    return problems;
  },

  'developer-guide/use-server-partition': (root, source) => {
    /*
     * `D-02`. The guide called the two filename patterns exhaustive over "either
     * tree", and the check behind it walked `features/crm/customers` — one level
     * below the tree the ownership gate owns. `features/crm/permissions.ts` sits
     * outside it, so the partition was true by accident rather than by check.
     *
     * The roots come from the gate itself, so the day a third tree is added this
     * claim covers it without an edit.
     */
    const problems = [];
    const serverFiles = [];
    for (const file of gateFiles(root)) {
      const text = readFileSync(file, 'utf8');
      if (/^['"]use server['"]/.test(text.trim())) {
        serverFiles.push(
          file
            .slice(join(root, 'apps', 'web', 'src').length + 1)
            .split(sep)
            .join(posix.sep)
        );
      }
    }
    if (serverFiles.length < 13) {
      problems.push(
        `only ${serverFiles.length} adapters carry 'use server'; the trees must ship at least 13`
      );
    }
    const unmatched = serverFiles.filter(
      (p) => !(p.endsWith('api.ts') || p.endsWith('actions.ts'))
    );
    if (unmatched.length > 0) {
      problems.push(`the guide accounts for no 'use server' file at ${unmatched.join(', ')}`);
    }
    const stray = serverFiles.filter(
      (p) => p.endsWith('actions.ts') && !p.startsWith('features/crm/customers/')
    );
    if (stray.length > 0) {
      problems.push(`the guide scopes *actions.ts to the CRM tree; found ${stray.join(', ')}`);
    }
    for (const phrase of [
      '`features/{crm/customers,vehicles}/*api.ts`',
      '`features/crm/customers/*actions.ts`',
    ]) {
      if (!source.includes(phrase)) problems.push(`the guide no longer states ${phrase}`);
    }
    return problems;
  },
};

/* ------------------------------------------------------------------ *
 * Document checking
 * ------------------------------------------------------------------ */

/** Any `derived:` marker at all — so a malformed one is caught, not skipped. */
const ANY_DERIVED = /<!--\s*derived:([\s\S]*?)-->/g;
/* A digit is legal inside a kind — `round5` is one. An unknown kind still fails. */
const WELL_FORMED = /^\s*([a-z][a-z0-9]*)\s+(\S+)\s*=\s*(\d+)\s*$/;
const ANY_CHECKED = /<!--\s*checked:([\s\S]*?)-->/g;

const TABLE_KINDS = {
  files: 'counts',
  cases: 'cases',
  lines: 'lines',
  tracked: 'tracked',
  commands: 'commands',
  catalogue: 'catalogue',
  manifest: 'manifest',
  matrix: 'matrix',
  round5: 'round5',
};

/**
 * Data rows of the markdown table that follows `from` in `source`.
 *
 * `rows` is the one kind that is document-local: it exists because a heading and
 * the table under it drifted apart — the heading said twenty files and the table
 * listed eighteen — and no repository fact can catch that. Pinning both to the
 * tree makes the two agree by construction.
 */
function tableRowsAfter(source, from) {
  const lines = source.slice(from).split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i + 1 >= lines.length) return null;
  if (!lines[i].trim().startsWith('|')) return null;
  if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) return null;
  let rows = 0;
  for (let j = i + 2; j < lines.length; j += 1) {
    if (!lines[j].trim().startsWith('|')) break;
    rows += 1;
  }
  return rows;
}

/**
 * Where the `lines` column of a named manifest table resolves its paths.
 *
 * Two tables in `deliverable-manifest.md` list a document and the number of
 * lines it holds, one row per file. Both are named by the `rows` marker already
 * sitting above them, so `linecolumn` reuses the name rather than inventing a
 * second vocabulary for the same two tables.
 */
const LINE_COLUMN_ROOTS = {
  'phase-documentation': `${PHASE_DIR}/`,
  'product-documentation': 'docs/product/',
};

/**
 * Every stale cell in the `lines` column of the table following `from`.
 *
 * ## Why this kind exists
 *
 * `rows phase-documentation = 36` pinned the NUMBER OF ROWS in that table and
 * nothing about their contents, so a column of thirty-six line counts sat one
 * cell away from a checked number, checked by nothing. Measured when this was
 * written: **16 of the 36 phase rows disagreed with the tree**, several by more
 * than a hundred lines (`open-decisions.md` stated 837 against 978,
 * `evidence/change-log.md` 344 against 483), while the product table's 13 rows
 * were all exact. That is `E-06` returning — "eight of fifteen documentation
 * line counts wrong" — in the one document that indexes every other one.
 *
 * A number beside a checked number, itself unchecked, is worse than an absent
 * one: the checked neighbour lends it credibility it has not earned.
 *
 * ## Where the number comes from
 *
 * `derived.lines` — the SAME table the `lines` kind reads, built once for every
 * `.md` and `.json` under both documentation trees. Re-reading the forty-nine
 * files here would have been the obvious spelling and it was the wrong one twice
 * over: it would add a second, independently-computed answer to a question this
 * gate already answers (so the two could disagree), and it measurably cost ~200 ms
 * on a ~950 ms gate whose enclosing case has a 5-second timeout that `H-18`
 * records as already flaking under load.
 */
function staleLineCells(source, from, base, lines, seen = { rows: 0 }) {
  /*
   * Blank lines and further markers are skipped, and `rows` deliberately is NOT
   * given the same latitude. `rows` counts the table immediately below it and
   * must keep doing so; this marker has to sit ABOVE that one, because putting
   * anything between `rows` and its table breaks it. So the two markers stack,
   * `linecolumn` first, and only this one walks past a comment to find the table.
   */
  const ahead = source.slice(from).split('\n');
  let i = 0;
  while (i < ahead.length && (ahead[i].trim() === '' || ahead[i].trim().startsWith('<!--'))) i += 1;
  const rest = ahead.slice(i).join('\n');
  const stale = [];
  const end = rest.search(/\n[^|\n]/);
  const table = end === -1 ? rest : rest.slice(0, end);
  for (const row of table.matchAll(/^\|\s*`([^`]+)`[^|]*\|\s*(\d+)\s*\|/gm)) {
    seen.rows += 1;
    const relative = `${base}${row[1]}`;
    const actual = lines[relative];
    if (actual === undefined) {
      stale.push(`${relative} is listed and this gate cannot derive its line count`);
      continue;
    }
    if (actual !== Number(row[2])) {
      stale.push(`${relative} states ${row[2]} lines; the tree holds ${actual}`);
    }
  }
  return stale;
}

/**
 * A document may state a count for a named thing only if it matches the tree.
 *
 * The claim syntax is deliberate and narrow: `<!-- derived: KIND NAME = N -->`.
 * A gate that tried to parse every bolded number out of prose would either miss
 * the ones written differently or fire on unrelated figures — both of which this
 * phase has already shipped. An explicit marker means the document opts a number
 * IN, and the gate is exact about the ones it owns.
 *
 * **An unrecognised marker fails.** The previous revision matched only the three
 * kinds it knew, so `<!-- derived: rows x = 3 -->` was not a wrong claim, it was
 * no claim at all — a document could opt a number in, misspell the kind, and be
 * unchecked in a way indistinguishable from being checked.
 */
export function checkDocument(relative, source, derived, root = ROOT) {
  const problems = [];

  for (const m of source.matchAll(ANY_DERIVED)) {
    const parsed = WELL_FORMED.exec(m[1]);
    if (!parsed) {
      problems.push(
        `${relative}: malformed derived marker \`${m[0].trim()}\` — ` +
          'the shape is `<!-- derived: KIND NAME = N -->`.'
      );
      continue;
    }
    const [, kind, name, stated] = parsed;

    if (kind === 'rows') {
      const actual = tableRowsAfter(source, m.index + m[0].length);
      if (actual === null) {
        problems.push(`${relative}: \`rows ${name}\` is not immediately followed by a table.`);
      } else if (Number(stated) !== actual) {
        problems.push(`${relative}: states rows ${name} = ${stated}; the table has ${actual}.`);
      }
      continue;
    }

    if (kind === 'linecolumn') {
      const base = LINE_COLUMN_ROOTS[name];
      if (base === undefined) {
        problems.push(
          `${relative}: \`linecolumn ${name}\` names no table — ` +
            `this gate knows ${Object.keys(LINE_COLUMN_ROOTS).join(', ')}.`
        );
        continue;
      }
      /*
       * ANTI-VACUITY. `= 0` is the passing value, so a rule that found no table
       * at all would agree with it perfectly — the shape this repository has now
       * recorded in four scanners. A marker that inspected nothing fails.
       */
      const seen = { rows: 0 };
      const stale = staleLineCells(source, m.index + m[0].length, base, derived.lines, seen);
      if (seen.rows === 0) {
        problems.push(
          `${relative}: \`linecolumn ${name}\` inspected no row — ` +
            'the marker must sit above a table whose first column is a backticked path ' +
            'and whose second is a line count.'
        );
        continue;
      }
      if (stale.length !== Number(stated)) {
        problems.push(
          `${relative}: states linecolumn ${name} = ${stated}; ` +
            `${stale.length} cell(s) disagree with the tree — ${stale.join('; ')}`
        );
      }
      continue;
    }

    const tableName = TABLE_KINDS[kind];
    if (!tableName) {
      problems.push(
        `${relative}: unknown derived kind \`${kind}\` — ` +
          `this gate derives ${[...Object.keys(TABLE_KINDS), 'rows', 'linecolumn'].join(', ')}.`
      );
      continue;
    }

    const actual = derived[tableName][name];
    if (actual === undefined) {
      problems.push(
        `${relative}: claims ${kind} for \`${name}\`, which this gate cannot derive. ` +
          (kind === 'cases'
            ? 'A file whose cases are generated at runtime is deliberately excluded — cite it without a derived marker.'
            : 'Check the name.')
      );
      continue;
    }
    if (Number(stated) !== actual) {
      problems.push(`${relative}: states ${kind} ${name} = ${stated}; the tree holds ${actual}.`);
    }
  }

  for (const m of source.matchAll(ANY_CHECKED)) {
    const name = m[1].trim();
    const claim = GUIDE_CLAIMS[name];
    if (!claim) {
      problems.push(
        `${relative}: unknown checked claim \`${name}\` — ` +
          `this gate proves ${Object.keys(GUIDE_CLAIMS).join(', ')}.`
      );
      continue;
    }
    for (const problem of claim(root, source)) problems.push(`${relative}: ${problem}`);
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * The test catalogue — `DOC-001`
 * ------------------------------------------------------------------ */

export const CATALOGUE_PATH = `${PHASE_DIR}/evidence/test-catalogue-traceability.json`;

/**
 * Every `TC-P1-27-###` the canonical plan declares must resolve to real tests.
 *
 * Twenty-nine ids were declared across three documents and **none of them
 * appeared in a single executable file** — a repository-wide search returned
 * nothing. The plan says each "will expand into the required path matrix", a
 * future tense that was never discharged, so the ids are real canonical
 * requirements with no binding.
 *
 * Twenty-nine empty test files would have made the search succeed and proved
 * nothing. The binding is data instead: one record per id, naming the executable
 * tests that already prove it and the paths that are genuinely uncovered. This
 * checks that the record is complete, that every file it names exists, and that
 * every case title it quotes is present in a test — so a renamed case breaks the
 * record rather than quietly hollowing it out.
 */
export function checkCatalogue(root = ROOT) {
  const problems = [];
  const cataloguePath = native(root, CATALOGUE_PATH);
  if (!existsSync(cataloguePath)) return [`${CATALOGUE_PATH} does not exist`];

  const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
  const plan = readFileSync(native(root, `${PHASE_DIR}/canonical-plan.md`), 'utf8');

  const declared = [...plan.matchAll(/`(TC-P1-27-[A-Z]+-\d+)`/g)]
    .map((m) => m[1])
    .filter((id, i, all) => all.indexOf(id) === i)
    .sort();
  if (declared.length === 0) {
    return ['the canonical plan declares no `TC-P1-27-*` id — this check would be vacuous'];
  }

  const recorded = Object.keys(catalogue.cases ?? {}).sort();
  for (const id of declared) {
    if (!recorded.includes(id)) problems.push(`${id} is declared in the plan and has no record`);
  }
  for (const id of recorded) {
    if (!declared.includes(id)) problems.push(`${id} is recorded and the plan declares no such id`);
  }
  if (catalogue.declared !== declared.length) {
    problems.push(
      `the record states declared = ${catalogue.declared}; the plan declares ${declared.length}`
    );
  }

  /*
   * COMMENTS ARE STRIPPED, and that is not a refinement.
   *
   * This matched a quoted title against the RAW source, so a title mentioned in
   * a comment counted as a case. Measured at `26eab7e`, one citation was
   * satisfied that way and by nothing else: `TC-P1-27-CRM-014` quoted "rejects a
   * value outside the vocabulary" against `crm-governance-writes.test.ts:217`,
   * where the only occurrence is a comment recording that the case MOVED — and
   * the case it moved to had been renamed, so the title existed in no test in
   * the repository. A record whose whole purpose is to stop a citation
   * hollowing out was reading prose as code, which is the same defect this
   * phase has now recorded in four separate scanners.
   *
   * `literals: 'keep'` is required, not incidental: the titles being matched
   * ARE string literals, so blanking them would make every citation fail.
   */
  const sources = new Map();
  const readTest = (relative) => {
    if (sources.has(relative)) return sources.get(relative);
    const path = native(root, relative);
    const text = existsSync(path) ? stripComments(readFileSync(path, 'utf8')) : null;
    sources.set(relative, text);
    return text;
  };

  /**
   * A citation's titles, checked against the file and against each other.
   *
   * The duplicate check is `A42-10` repeating: an evidence cell named four cases
   * of which two were the identical string, and the file held three. A repeated
   * title inflates a count while resolving perfectly.
   */
  const checkTitles = (where, proof, text) => {
    const seen = new Set();
    for (const title of proof.cases ?? []) {
      if (seen.has(title)) {
        problems.push(`${where} quotes "${title}" twice for ${proof.file} — that is not two cases`);
        continue;
      }
      seen.add(title);
      if (!text.includes(title)) {
        problems.push(`${where} quotes "${title}", which is in no case of ${proof.file}`);
      }
    }
  };

  let covered = 0;
  let uncovered = 0;
  for (const [id, entry] of Object.entries(catalogue.cases ?? {})) {
    const proofs = entry.provenBy ?? [];
    if (proofs.length === 0) {
      uncovered += 1;
      if (!String(entry.gap ?? '').trim()) {
        problems.push(`${id} names no proof and states no gap — an unstated gap is a lie`);
      }
      continue;
    }
    covered += 1;
    for (const proof of proofs) {
      const text = readTest(proof.file);
      if (text === null) {
        problems.push(`${id} cites ${proof.file}, which does not exist`);
        continue;
      }
      checkTitles(id, proof, text);
    }
  }
  if (catalogue.covered !== covered) {
    problems.push(`the record states covered = ${catalogue.covered}; its rows hold ${covered}`);
  }
  if (catalogue.uncovered !== uncovered) {
    problems.push(
      `the record states uncovered = ${catalogue.uncovered}; its rows hold ${uncovered}`
    );
  }

  /*
   * The plan does not merely allocate an id; it says each "will expand into the
   * required path matrix" and then names the eighteen paths. An id that resolves
   * to one case is bound, not discharged, and the difference is the whole reason
   * this record exists. The path list is read out of the plan rather than
   * restated, so the two cannot drift.
   */
  const declaredPaths = paths(plan);
  if (declaredPaths.length === 0) {
    problems.push('the canonical plan names no required path — the matrix check would be vacuous');
  }
  const matrix = catalogue.pathMatrix ?? [];
  const named = matrix.map((row) => row.path);
  for (const path of declaredPaths) {
    if (!named.includes(path)) problems.push(`the plan requires the "${path}" path; it has no row`);
  }
  for (const path of named) {
    if (!declaredPaths.includes(path)) {
      problems.push(`the record holds a "${path}" row; the plan requires no such path`);
    }
  }
  const STATUS = ['PROVEN', 'PARTIAL', 'ABSENT'];
  for (const row of matrix) {
    if (!STATUS.includes(row.status)) {
      problems.push(
        `"${row.path}" has status ${row.status}, which is not one of ${STATUS.join('/')}`
      );
    }
    if (row.status !== 'PROVEN' && !String(row.reason ?? '').trim()) {
      problems.push(`"${row.path}" is ${row.status} and states no reason`);
    }
    for (const proof of row.provenBy ?? []) {
      const text = readTest(proof.file);
      if (text === null) {
        problems.push(`"${row.path}" cites ${proof.file}, which does not exist`);
        continue;
      }
      checkTitles(`"${row.path}"`, proof, text);
    }
  }
  if (catalogue.matrixDischarged !== false) {
    problems.push(
      'matrixDischarged must stay false until every path is PROVEN for every id — ' +
        'no record in this repository establishes that'
    );
  }

  /*
   * `weakCitations` — the block that stops "29 resolve" being read as "29
   * proved".
   *
   * A spot check of five ids found two whose only cited case asserted that two
   * CONSTANTS differ. Both resolve, both are executable, and neither reaches the
   * screen the id names. Recording that is only worth anything if the record
   * itself is held to the same standard the rows are: the weak case must still
   * exist in the file it names, the weakness must be stated, and the case that
   * now carries the obligation must resolve too. Otherwise the block becomes the
   * one place in this record where a citation is unchecked.
   */
  const weak = catalogue.weakCitations;
  if (weak !== undefined) {
    const entries = weak.entries ?? [];
    if (entries.length === 0) {
      problems.push('weakCitations is present and lists no entry — remove it or fill it');
    }
    for (const [index, entry] of entries.entries()) {
      const where = `weakCitations[${index}]`;
      if (!recorded.includes(entry.id)) {
        problems.push(`${where} names ${entry.id}, which this record does not carry`);
      }
      if (!String(entry.weakness ?? '').trim()) {
        problems.push(`${where} (${entry.id}) states no weakness — an unstated one is decoration`);
      }
      const cited = [
        { file: entry.file, cases: entry.case ? [entry.case] : [] },
        { file: entry.strengthenedBy?.file, cases: entry.strengthenedBy?.cases ?? [] },
      ];
      if (!entry.strengthenedBy?.file) {
        problems.push(`${where} (${entry.id}) names no case that carries the obligation instead`);
      }
      for (const proof of cited) {
        if (!proof.file) continue;
        const text = readTest(proof.file);
        if (text === null) {
          problems.push(`${where} cites ${proof.file}, which does not exist`);
          continue;
        }
        for (const title of proof.cases) {
          if (!text.includes(title)) {
            problems.push(`${where} quotes "${title}", which is in no case of ${proof.file}`);
          }
        }
      }
    }
  }

  return problems;
}

/** The eighteen required paths, read out of the canonical plan's own sentence. */
function paths(plan) {
  const found = /required path matrix \(([^)]+)\)/.exec(plan);
  if (!found) return [];
  return found[1]
    .split(',')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * The round-five register — actionable, sealed and dispositioned
 * ------------------------------------------------------------------ */

/**
 * The closure condition this phase carried was a logical impossibility.
 *
 * It read, in effect, "no finding may be open when the phase closes" — while the
 * register itself says that ten `QA005-*` rows, `A-05` and six `B-*` rows are
 * **attacks on the evidence-page guards, which `QA-005` seals last and against
 * the closing candidate**. Re-judging those now would measure a head the phase
 * does not close on, so they cannot be closed before `QA-005` runs; and `QA-005`
 * cannot run until the closing candidate exists. A condition that can never be
 * satisfied is not a gate, it is a sentence.
 *
 * The distinction the register already draws in prose is made executable here.
 * Every unresolved row carries an explicit class, and the class decides which
 * question it answers:
 *
 *   `ACTIONABLE`     — closable now, on some branch of this wave. These are the
 *                      findings the phase is actually blocked on.
 *   `SEALED`         — closable only against the closing candidate, because the
 *                      thing it measures is the record of that candidate. It may
 *                      remain `OPEN`, and it may NOT be marked `FIXED` before
 *                      `QA-005` executes — see `checkRoundFive` below.
 *   `DISPOSITIONED`  — true, and disposed of by a recorded decision that names an
 *                      owner and a review date. `A42-13` is the case that forced
 *                      this class to exist: `QA-004`'s concurrency conjunct is
 *                      genuinely contradicted by `P1-27-INT-009`, the finding
 *                      HOLDS, and `P1-27-OD-005` decides it as last-writer-wins
 *                      with six executable checks that fail the day a Backend
 *                      phase closes the gap. The register's status vocabulary has
 *                      no verdict for "true, and disposed of by decision", and
 *                      inventing one to move a total is the arithmetic this phase
 *                      keeps punishing. So the STATUS stays `PARTIAL` and the
 *                      CLASS records the disposition — two orthogonal facts,
 *                      neither pretending to be the other.
 *
 * The class is not derived from the id. `QA005-10` is an `EVIDENCE`-area row
 * beginning `QA005-` and it is `FIXED`: it was a stale field in an evidence
 * record, closable without a candidate. A prefix rule and an area rule are both
 * refuted by that one row, which is why the classification is enumerated.
 */
const CLASSES = ['ACTIONABLE', 'SEALED', 'DISPOSITIONED'];
const REGISTER_STATUSES = ['FIXED', 'OPEN', 'PARTIAL', 'REFUTED'];

/** `| \`id\` | area | severity | status | finding |` — the register's one row shape. */
const REGISTER_ROW = /^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)\|\s*$/gm;

/** `| \`id\` | CLASS | why |` — three columns, so it cannot match a register row. */
const CLASS_ROW = /^\|\s*`([^`]+)`\s*\|\s*([A-Z]+)\s*\|([^|]*)\|\s*$/gm;

/** `ROUND5_NAME = N` in the declared block. */
function declaredNumber(source, name) {
  const found = new RegExp(`ROUND5_${name}\\s*=\\s*(\\d+)`).exec(source);
  return found ? Number(found[1]) : null;
}

export function readRegisterRows(source) {
  REGISTER_ROW.lastIndex = 0;
  return [...source.matchAll(REGISTER_ROW)]
    .map((m) => ({
      id: (m[1] ?? '').trim(),
      area: (m[2] ?? '').trim(),
      severity: (m[3] ?? '').trim(),
      status: (m[4] ?? '').trim(),
    }))
    .filter((row) => REGISTER_STATUSES.includes(row.status));
}

export function readClassRows(source) {
  CLASS_ROW.lastIndex = 0;
  return [...source.matchAll(CLASS_ROW)]
    .map((m) => ({
      id: (m[1] ?? '').trim(),
      klass: (m[2] ?? '').trim(),
      why: (m[3] ?? '').trim(),
    }))
    .filter((row) => CLASSES.includes(row.klass));
}

/**
 * Has `QA-005` executed? Read from the matrix, not from a sentence.
 *
 * `QA-005` is the task that records the clean-room and hosted-CI measurement of
 * the closing candidate. Its matrix verdict is the only fact in the repository
 * that says whether that measurement has been taken, so it is what the sealed
 * rule turns on — and it is regenerated by `validate:p1-27-matrix` from
 * `task-matrix-verdicts.json`, so it cannot be asserted here.
 */
function qa005Executed(root) {
  const path = native(root, MATRIX_PATH);
  if (!existsSync(path)) return null;
  const record = JSON.parse(readFileSync(path, 'utf8'));
  const task = (record.tasks ?? []).find((t) => t.TASK_ID === 'QA-005');
  if (!task) return null;
  return task.FINAL_VERDICT === 'PASS';
}

/** Every `P1-27-OD-###` entry whose own status begins "Decided". */
function decidedEntries(root) {
  const path = native(root, DECISIONS_PATH);
  if (!existsSync(path)) return new Set();
  const source = readFileSync(path, 'utf8');
  const decided = new Set();
  for (const m of source.matchAll(/^## `(P1-27-OD-\d+)`[\s\S]*?\*\*Status:\*\*\s*\*\*([^*]+)/gm)) {
    if (/^\s*Decided/.test(m[2])) decided.add(m[1]);
  }
  return decided;
}

/** The counts, classified. `null` values mean the register could not be read. */
export function deriveRoundFive(root = ROOT) {
  const path = native(root, REGISTER_PATH);
  if (!existsSync(path)) return { counts: {}, rows: [], classified: new Map(), source: '' };
  const source = readFileSync(path, 'utf8');
  const rows = readRegisterRows(source);
  const classified = new Map();
  for (const row of readClassRows(source)) classified.set(row.id, row);

  const status = (name) => rows.filter((r) => r.status === name).length;
  const inClass = (name, statusName) =>
    rows.filter((r) => r.status === statusName && classified.get(r.id)?.klass === name).length;

  const counts = {
    TOTAL: rows.length,
    FIXED: status('FIXED'),
    OPEN: status('OPEN'),
    PARTIAL: status('PARTIAL'),
    REFUTED: status('REFUTED'),
    ACTIONABLE_OPEN: inClass('ACTIONABLE', 'OPEN'),
    ACTIONABLE_PARTIAL: inClass('ACTIONABLE', 'PARTIAL'),
    SEALED_OPEN: inClass('SEALED', 'OPEN'),
    SEALED_PARTIAL: inClass('SEALED', 'PARTIAL'),
    DISPOSITIONED_OPEN: inClass('DISPOSITIONED', 'OPEN'),
    DISPOSITIONED_PARTIAL: inClass('DISPOSITIONED', 'PARTIAL'),
  };
  const executed = qa005Executed(root);
  counts.CLOSURE_BLOCKERS = executed
    ? counts.OPEN + counts.PARTIAL
    : counts.ACTIONABLE_OPEN + counts.ACTIONABLE_PARTIAL;

  return { counts, rows, classified, source, executed };
}

/** The state word the register must declare, derived from the same rows. */
function closureState(counts, executed) {
  if (executed) return counts.CLOSURE_BLOCKERS === 0 ? 'CLEAR' : 'BLOCKED';
  return counts.CLOSURE_BLOCKERS === 0 ? 'SEALED-ONLY' : 'BLOCKED';
}

/**
 * The rules that make the distinction a gate rather than a paragraph.
 *
 * BEFORE `QA-005` executes: `ACTIONABLE_OPEN` and `ACTIONABLE_PARTIAL` must
 * reach 0 for the phase to be eligible to close, sealed findings may remain
 * `OPEN`, and a sealed finding may NOT be marked `FIXED` — closing it would be a
 * measurement of a head the phase does not close on, which is the defect
 * `QA-005` exists to report.
 *
 * AFTER `QA-005` executes: everything must be 0, sealed included. That half is a
 * hard failure here rather than a state, because at that point there is nothing
 * left for a later pass to inherit.
 */
export function checkRoundFive(root = ROOT) {
  const problems = [];
  const { counts, rows, classified, source, executed } = deriveRoundFive(root);

  if (rows.length === 0) return [`${REGISTER_PATH}: no register row matched the canonical shape`];
  if (rows.length < 50) {
    problems.push(
      `${REGISTER_PATH}: only ${rows.length} rows parsed — the register holds far more, ` +
        'so every count below would be taken over a fragment'
    );
  }
  if (executed === null) {
    return [
      ...problems,
      `${MATRIX_PATH}: QA-005 has no row, so whether the sealed set may close is underivable`,
    ];
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const pending = rows.filter((row) => row.status === 'OPEN' || row.status === 'PARTIAL');

  /*
   * ANTI-VACUITY. Every count below is a filter over `classified`, and an empty
   * classification table satisfies "0 actionable open" perfectly — the shape this
   * repository has now recorded in five scanners.
   */
  if (classified.size === 0) {
    problems.push(
      `${REGISTER_PATH}: no finding carries a class — ` +
        'the classification table must give every OPEN and PARTIAL row one of ' +
        `${CLASSES.join(', ')}`
    );
  }

  for (const row of pending) {
    if (!classified.has(row.id)) {
      problems.push(
        `${REGISTER_PATH}: \`${row.id}\` is ${row.status} and carries no class — ` +
          'an unclassified finding cannot be counted as actionable or as sealed'
      );
    }
  }

  const decided = decidedEntries(root);
  for (const [id, entry] of classified) {
    const row = byId.get(id);
    if (!row) {
      problems.push(`${REGISTER_PATH}: \`${id}\` is classified and is no register row`);
      continue;
    }
    if (row.status === 'REFUTED') {
      problems.push(
        `${REGISTER_PATH}: \`${id}\` is REFUTED and classified ${entry.klass} — ` +
          'a finding that does not hold is not pending'
      );
      continue;
    }
    if (row.status === 'FIXED' && entry.klass === 'SEALED' && !executed) {
      problems.push(
        `${REGISTER_PATH}: \`${id}\` is SEALED and marked FIXED while QA-005 has not executed — ` +
          'a sealed finding is judged against the closing candidate, and no such measurement exists'
      );
      continue;
    }
    if (row.status === 'FIXED' && entry.klass !== 'SEALED') {
      problems.push(
        `${REGISTER_PATH}: \`${id}\` is FIXED and classified ${entry.klass} — ` +
          'only a sealed finding keeps a class once it closes'
      );
      continue;
    }
    if (entry.klass === 'DISPOSITIONED') {
      const named = [...entry.why.matchAll(/(P1-27-OD-\d+)/g)].map((m) => m[1]);
      if (named.length === 0) {
        problems.push(
          `${REGISTER_PATH}: \`${id}\` is DISPOSITIONED and names no \`P1-27-OD-###\` — ` +
            'a disposition with no decision behind it is a status invented to move a total'
        );
        continue;
      }
      for (const od of named) {
        if (!decided.has(od)) {
          problems.push(
            `${REGISTER_PATH}: \`${id}\` is DISPOSITIONED by \`${od}\`, ` +
              `which ${DECISIONS_PATH} does not record with a **Decided** status`
          );
        }
      }
    }
  }

  if (executed && counts.CLOSURE_BLOCKERS !== 0) {
    problems.push(
      `${REGISTER_PATH}: QA-005 has executed and ${counts.CLOSURE_BLOCKERS} finding(s) remain ` +
        'OPEN or PARTIAL — after the closing measurement the sealed set is no longer sealed'
    );
  }

  const DECLARED = [
    'TOTAL',
    'FIXED',
    'OPEN',
    'PARTIAL',
    'REFUTED',
    'ACTIONABLE_OPEN',
    'ACTIONABLE_PARTIAL',
    'SEALED_OPEN',
    'DISPOSITIONED_PARTIAL',
    'CLOSURE_BLOCKERS',
  ];
  for (const name of DECLARED) {
    const stated = declaredNumber(source, name);
    if (stated === null) {
      problems.push(`${REGISTER_PATH}: the register declares no ROUND5_${name}`);
      continue;
    }
    if (stated !== counts[name]) {
      problems.push(
        `${REGISTER_PATH}: states ROUND5_${name} = ${stated}; the rows hold ${counts[name]}`
      );
    }
  }

  const state = closureState(counts, executed);
  const statedState = /ROUND5_CLOSURE_STATE\s*=\s*([A-Z-]+)/.exec(source);
  if (!statedState) {
    problems.push(`${REGISTER_PATH}: the register declares no ROUND5_CLOSURE_STATE`);
  } else if (statedState[1] !== state) {
    problems.push(
      `${REGISTER_PATH}: states ROUND5_CLOSURE_STATE = ${statedState[1]}; ` +
        `the rows and the QA-005 verdict hold ${state}`
    );
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * Ratification — a decision may not claim an act the Owner has not made
 * ------------------------------------------------------------------ */

/**
 * No phase document may call a decision "ratified" while its own entry asks for
 * ratification.
 *
 * Four cells across three documents described `P1-27-OD-005` and `P1-27-OD-006`
 * as "a ratified decision" and "a ratified disposition". Both entries state
 * their own type as **"engineering decision, ratification requested"**, and
 * `open-decisions.md` opens by saying these are calls "the Owner should ratify".
 * No ratification is recorded anywhere in this repository, and the phase stands
 * at `OWNER ACCEPTANCE: FAIL` — so four documents asserted an Owner act that did
 * not happen, in a phase that has already been closed once on unverified claims.
 *
 * The ban is derived, not fixed: an entry whose status records a ratification
 * leaves the unratified set and the word becomes legal for it. Negated forms are
 * allowed, because "not ratified" is the true sentence.
 */
export function checkRatificationClaims(root = ROOT) {
  const problems = [];
  const path = native(root, DECISIONS_PATH);
  if (!existsSync(path)) return [`${DECISIONS_PATH} does not exist`];
  const decisions = readFileSync(path, 'utf8');

  const unratified = new Set();
  for (const m of decisions.matchAll(
    /^## `(P1-27-OD-\d+)`[\s\S]*?\*\*Status:\*\*\s*\*\*([^*]+)/gm
  )) {
    if (!/ratified/i.test(m[2])) unratified.add(m[1]);
  }
  if (unratified.size === 0) {
    return [`${DECISIONS_PATH}: no \`P1-27-OD-###\` entry parsed — this ban would inspect nothing`];
  }

  const NEGATED = /(?:not|never|no|un)\s*$/i;
  for (const file of walk(native(root, PHASE_DIR), (p) => /\.(md|json)$/.test(p))) {
    const relative = file
      .slice(root.length + 1)
      .split(sep)
      .join(posix.sep);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/\bratified\b/g)) {
      const before = source.slice(Math.max(0, m.index - 24), m.index);
      if (NEGATED.test(before)) continue;
      const context = source.slice(Math.max(0, m.index - 90), m.index + 90).replace(/\s+/g, ' ');
      problems.push(
        `${relative}: calls a decision "ratified" while ` +
          `${[...unratified].join(', ')} record ratification as requested and not granted — "…${context}…"`
      );
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function evaluate(root = ROOT) {
  const derived = deriveCounts(root);
  const problems = [];
  let claims = 0;
  const docs = walk(native(root, PHASE_DIR), (p) => p.endsWith('.md'));
  for (const file of docs) {
    const relative = file
      .slice(root.length + 1)
      .split(sep)
      .join(posix.sep);
    const source = readFileSync(file, 'utf8');
    claims += (source.match(/<!--\s*(?:derived|checked):/g) ?? []).length;
    problems.push(...checkDocument(relative, source, derived, root));
  }
  problems.push(...checkCatalogue(root).map((p) => `${CATALOGUE_PATH}: ${p}`));
  problems.push(...checkRoundFive(root));
  problems.push(...checkRatificationClaims(root));
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
