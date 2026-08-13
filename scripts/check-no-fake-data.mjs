#!/usr/bin/env node
/**
 * No-fake-data guard (RootLco permanent data policy).
 *
 * The product must ship and start with NO fabricated business data. This static
 * guard scans tracked files for indicators of demo/mock/sample/fake/fabricated
 * business records that would be shipped or auto-inserted by the application.
 *
 * It is deliberately PRECISE (phrases, not bare words) so it never rejects
 * legitimate test code, policy prose, or migration comments that explain the
 * prohibition. Ephemeral automated-test data lives under tests/ and is allowed;
 * documentation may discuss the rule freely.
 *
 * The companion DB check (tests/db/no-fake-data.test.ts) proves the migration
 * layer creates zero business rows. Fails closed: an unreadable tracked file is
 * skipped only for binary content, never to hide a match.
 *
 * Dependency-free (node: builtins only) — no `npm ci` needed to run it.
 *
 * ## Prose is not code
 *
 * The patterns are matched against a file's CODE: comments are blanked first.
 *
 * They were not, and the omission cost the project seven false positives — the
 * seventh being an authenticated browser spec whose comment explained why the
 * test deliberately refuses to seed a catalogue row. The sentence that stated
 * the policy tripped the gate that enforces it, and it was worked around by
 * rewording the prose rather than by fixing the gate, which leaves the next
 * sentence to be written free to trip it again.
 *
 * Blanking does not weaken the guard, because a comment cannot ship a row: a
 * commented-out INSERT inserts nothing, and a sentence about fabricated data
 * fabricates none. What a comment CAN do is describe the prohibition, which is
 * why the phrases appear most in the files that honour it.
 *
 * Blanking preserves every line break, so a reported line number still points at
 * the real line, and it is chosen per FILE TYPE:
 *
 *   - `.ts .tsx .js .jsx .mjs .cjs .mts .cts` and `.css .scss` — line comments
 *     (a double slash to end of line) and block comments (slash-star to
 *     star-slash). A JSX comment is a block comment inside braces, so it goes
 *     with them.
 *   - `.html .htm .md .mdx .svg` — markup comments (angle-bang-dash-dash to
 *     dash-dash-angle).
 *   - EVERYTHING ELSE — `.sql`, `.yml`, `.json`, `.toml`, `.sh` — is scanned
 *     exactly as before, comments included. Those are the formats in which a
 *     fabricated row can actually ship, and their comment grammars (`--`, `#`)
 *     cannot be removed without a dialect-accurate parser: a `--` inside a SQL
 *     string literal or a `#` inside a YAML scalar is data, and a stripper that
 *     got that wrong would blank the row instead of the prose. Narrowing this
 *     guard where the risk is real is not worth a tidier comment; if a `#`
 *     comment ever trips it, that is the moment to write the parser, not to
 *     widen the allow-list.
 *
 * Blanking is STRING-AWARE. A phrase cannot be smuggled past the gate inside a
 * literal that merely begins with a comment marker — `'x // fake customers'` is
 * code, and still fails. `tests/ci/no-fake-data-gate.test.ts` holds both halves:
 * the phrase in a comment passes, the same phrase in a string literal, an
 * identifier and a seeded object still fails.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fabricated-business-data indicators. Each targets a noun phrase, not a bare
// word, so "sample" in "sample rate" or "mock" in a test helper name is ignored.
export const PATTERNS = [
  { name: 'Faker library', re: /\bfaker\b/i },
  {
    name: 'demo mode / demo data',
    re: /\bdemo[\s_-]?(mode|data|content|records?|seed|tenant|customers?)\b/i,
  },
  {
    name: 'fabricated business record',
    re: /\b(sample|mock|fake|fictional|fictitious|dummy)\s+(customers?|vehicles?|companies|company|tenants?|invoices?|work[\s_-]?orders?|employees?|suppliers?|partners?|users?|documents?|messages?|records?|business\s+data)\b/i,
  },
  {
    name: 'shipped mock API',
    re: /\bmock(ed)?\s+(api|apis|response|responses|repositor(y|ies)|endpoints?)\b/i,
  },
];

// EXACT paths / path-prefixes where these indicators are legitimate. Widening
// this list is a visible, reviewable act.
export const ALLOW = [
  'docs/', // policy + governance prose (this rule is discussed here)
  'tests/', // ephemeral, rolled-back / cleaned automated-test data
  'scripts/check-scope-exclusions.mjs', // sibling guard prose
  'supabase/seed.sql', // binding prohibitory seed prose
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  '.github/pull_request_template.md',
  'supabase/config.toml', // seed sql_paths filenames only
];

// This guard's own source necessarily contains the phrases it hunts (pattern
// definitions, error text), so it must never scan itself. The path is derived
// from the running module at runtime — structural self-exclusion, not a
// configuration literal that another guard could mistake for repository content.
export const SELF = relative(process.cwd(), fileURLToPath(import.meta.url)).replaceAll('\\', '/');

/* ==========================================================================
 * Comments
 * ========================================================================== */

/** Comment grammars, by extension. A file matching none is scanned verbatim. */
const SLASH_STAR = /\.(?:jsx?|mjs|cjs|tsx?|mts|cts|s?css|sass)$/i;
const ANGLE_BANG = /\.(?:html?|md|mdx|svg)$/i;

/** Same length, same line breaks — only the characters go. */
const blank = (text) => text.replace(/[^\n]/g, ' ');

/**
 * A `/` here opens a regular expression rather than dividing.
 *
 * Taken from `scripts/ci/check-p1-27-doc-counts.mjs`, the most careful stripper
 * in this repository. Misreading a regex costs nothing here — its body is
 * emitted verbatim and therefore still scanned — but reading a DIVISION as one
 * would swallow the code up to the next slash, so the test is the conservative
 * one: only after a token that cannot end an expression.
 */
const REGEX_PRECEDER = /[([{,;:=!&|?+\-*%~^<>]$/;
const REGEX_KEYWORD =
  /\b(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;

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

/** Index just past a template literal, including its `${…}` expressions. */
function endOfTemplate(source, start) {
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
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') depth -= 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return source.length;
}

/** Index just past a regex literal opened at `start`, or `start` if it is not one. */
function endOfRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n') return start; // a regex cannot span a line: it was a division
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i + 1;
    i += 1;
  }
  return start;
}

/**
 * Blanks `//` and slash-star comments, leaving strings, templates and regexes
 * exactly as they were.
 *
 * String awareness is the half that keeps the gate able to FAIL. Without it the
 * marker inside `const label = 'x // fake customers'` would blank the rest of a
 * real line of code, and hiding a fabricated record behind a slash would become
 * a one-character evasion.
 *
 * An UNTERMINATED block comment is not treated as a comment at all: the file is
 * already unparseable, and scanning it is the fail-closed reading — the other
 * one blanks everything to the end of the file.
 */
function stripSlashComments(source) {
  const out = [];
  const n = source.length;
  let i = 0;
  // The last few emitted characters, kept incrementally: asking the whole
  // accumulated output for its tail at every slash is quadratic.
  let tail = '';
  const push = (text) => {
    out.push(text);
    tail = (tail + text).slice(-48);
  };

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

    // `https://` is not a comment start. The check is the immediately preceding
    // character, as every sibling guard in this repository spells it: a URL
    // inside a string is already protected by the string arm above, but an
    // UNQUOTED one is legal in `url(https://…)` in a stylesheet, and blanking
    // the rest of that line would hide whatever followed it.
    if (c === '/' && next === '/' && source[i - 1] !== ':') {
      let j = i;
      while (j < n && source[j] !== '\n') j += 1;
      push(' '.repeat(j - i));
      i = j;
      continue;
    }

    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) {
        push(source.slice(i));
        break;
      }
      push(blank(source.slice(i, end + 2)));
      i = end + 2;
      continue;
    }

    if (c === '"' || c === "'") {
      const j = endOfQuoted(source, i, c);
      push(source.slice(i, j));
      i = j;
      continue;
    }

    if (c === '`') {
      const j = endOfTemplate(source, i);
      push(source.slice(i, j));
      i = j;
      continue;
    }

    const before = tail.replace(/\s+$/, '');
    if (before === '' || REGEX_PRECEDER.test(before) || REGEX_KEYWORD.test(before)) {
      const j = endOfRegex(source, i);
      if (j > i) {
        push(source.slice(i, j));
        i = j;
        continue;
      }
    }

    push(c);
    i += 1;
  }
  return out.join('');
}

/** Blanks markup comments. Unterminated is scanned, for the reason above. */
function stripMarkupComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, blank);
}

/**
 * A file's CODE: the same text, with the comments its type defines blanked out.
 *
 * Every byte position and line break survives, so `file:line` still locates the
 * match. A type with no grammar here is returned untouched — see the file
 * docblock for why `.sql` and `.yml` are deliberately among them.
 */
export function stripComments(source, path) {
  if (SLASH_STAR.test(path)) return stripSlashComments(source);
  if (ANGLE_BANG.test(path)) return stripMarkupComments(source);
  return source;
}

/* ==========================================================================
 * Scanning
 * ========================================================================== */

/** Whether the allow-list covers this path. */
export function allowed(file) {
  return ALLOW.some((a) => file === a || file.startsWith(a));
}

/**
 * Every indicator in one file, as `{ file, line, pattern }`.
 *
 * Line-oriented, as it has always been: a phrase split across a line break is
 * not a phrase.
 */
export function scanFile(file, source) {
  const found = [];
  const lines = stripComments(source, file).split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(line)) found.push({ file, line: i + 1, pattern: p.name });
    }
  });
  return found;
}

/**
 * The whole check, over `[path, source]` pairs — importable by the suite beside
 * it without running git or calling `process.exit`.
 */
export function scan(sources) {
  const violations = [];
  for (const [file, source] of sources) {
    if (file === SELF) continue; // structural self-exclusion (see above)
    if (allowed(file)) continue;
    violations.push(...scanFile(file, source));
  }
  return violations;
}

/** Tracked files, paired with their text. Binary/unreadable content is dropped. */
function trackedSources() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const sources = [];
  for (const file of files) {
    try {
      sources.push([file, readFileSync(file, 'utf8')]);
    } catch {
      continue; // binary/unreadable-as-text: patterns target text
    }
  }
  return { count: files.length, sources };
}

function main() {
  const { count, sources } = trackedSources();

  // Anti-vacuity: a scan of nothing passes everything. `git ls-files` answering
  // empty means the check did not run, not that the repository is clean.
  if (count === 0) {
    console.error(
      'FAIL no-fake-data: no tracked files were listed. This check cannot run here, and a scan of nothing is not a pass.'
    );
    process.exit(2);
  }

  const violations = scan(sources);
  if (violations.length) {
    console.error(
      `FAIL no-fake-data: ${violations.length} fabricated-business-data indicator(s) outside the allow-list:`
    );
    for (const v of violations) console.error(`  - ${v.file}:${v.line} [${v.pattern}]`);
    console.error(
      'The application ships and starts with NO fake/demo/mock/sample business data. Use ephemeral test data (tests/) or approved structural reference only. See docs/database/no-fake-data-standard.md.'
    );
    process.exit(1);
  }
  console.log(`OK no-fake-data: no fabricated-business-data indicators (${count} tracked files)`);
  process.exit(0);
}

// Executed only when invoked as a script, never on import.
if (process.argv[1] && process.argv[1].endsWith('check-no-fake-data.mjs')) main();
