#!/usr/bin/env node
/**
 * Every colour utility the source uses must resolve to a theme entry.
 *
 * ## The defect this exists for
 *
 * Tailwind emits CSS only for utilities it recognises. `bg-brand-primary` is not
 * an error, not a warning, and not a build failure — it is simply a class name
 * with no rule behind it. The element renders with no background, the page still
 * loads, every test that asserts on `className` still passes, and nothing
 * anywhere says a word.
 *
 * Found at Owner acceptance of P1-27: `brand-primary`, `on-brand`,
 * `status-danger`, `status-success`, `status-warning`, `link` and `paper` were
 * used in fourteen components and defined in none. In practice that meant every
 * primary button on the CRM and Vehicle screens had no fill, every error message
 * was not red, every success message was not green, and the printed document had
 * no page colour. Fifty-one utilities across fourteen files.
 *
 * The names were plausible — which is the whole problem. `text-status-danger`
 * reads like the right thing to write, and review cannot tell it apart from
 * `text-error` without opening the Tailwind theme.
 *
 * ## How this checks
 *
 * The theme is the authority: whatever `tailwind.config.ts` registers under
 * `theme.extend.colors` is legal, plus Tailwind's own palette names that survive
 * `extend`. Anything else in a colour position is a finding.
 *
 * It parses the config as text rather than importing it, so the check runs
 * without a bundler and cannot be defeated by a config that fails to load.
 *
 * Exit: 0 clean · 1 an unresolvable utility · 2 the check could not run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.cwd();

/** Utility prefixes whose value position is a colour. */
export const COLOUR_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'divide',
  'outline',
  'decoration',
  'from',
  'via',
  'to',
  'caret',
  'accent',
  'placeholder',
];

/**
 * Names that share a prefix with a colour utility but are not colours.
 *
 * `text-body` is a font size, `border-b` is a width, `outline-none` is a style.
 * Listing them explicitly is deliberate: a heuristic ("looks like a size") would
 * eventually swallow a real colour name and turn this gate back into decoration.
 */
export const NON_COLOUR = {
  text: new Set([
    'display',
    'page-title',
    'section-title',
    'body',
    'body-large',
    'supporting',
    'label',
    'caption',
    'table-header',
    'table-cell',
    'button',
    'xs',
    'sm',
    'base',
    'lg',
    'xl',
    '2xl',
    '3xl',
    '4xl',
    '5xl',
    'left',
    'right',
    'center',
    'justify',
    'start',
    'end',
    'wrap',
    'nowrap',
    'ellipsis',
    'clip',
    'balance',
    'pretty',
  ]),
  border: new Set([
    'solid',
    'dashed',
    'dotted',
    'double',
    'hidden',
    'none',
    'collapse',
    'separate',
    'spacing',
  ]),
  ring: new Set(['offset', 'inset', 'none']),
  outline: new Set(['none', 'dashed', 'dotted', 'double', 'hidden', 'offset']),
  decoration: new Set([
    'none',
    'underline',
    'overline',
    'solid',
    'dashed',
    'dotted',
    'wavy',
    'from-font',
    'auto',
    'slice',
    'clone',
  ]),
  divide: new Set(['solid', 'dashed', 'dotted', 'double', 'none', 'reverse']),
  bg: new Set([
    'none',
    'cover',
    'contain',
    'auto',
    'fixed',
    'local',
    'scroll',
    'center',
    'bottom',
    'top',
    'repeat',
    'clip',
    'origin',
    'blend',
    'gradient',
  ]),
  placeholder: new Set(['opacity']),
  stroke: new Set(['none']),
  fill: new Set(['none']),
  from: new Set([]),
  via: new Set([]),
  to: new Set([]),
  caret: new Set([]),
  accent: new Set(['auto']),
};

/** Tailwind's built-in palette, which `extend` does not remove. */
export const BUILT_IN = new Set([
  'transparent',
  'current',
  'currentcolor',
  'inherit',
  'black',
  'white',
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
]);

/** The colour names `tailwind.config.ts` registers. */
export function themeColours(configSource) {
  const start = configSource.indexOf('colors: {');
  if (start === -1) return null;
  // Balanced-brace scan from the opening brace of the colours object.
  let depth = 0;
  let end = -1;
  for (let i = configSource.indexOf('{', start); i < configSource.length; i += 1) {
    const ch = configSource[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const block = configSource.slice(start, end);
  return new Set([...block.matchAll(/^\s*'?([A-Za-z][A-Za-z0-9-]*)'?\s*:/gm)].map((m) => m[1]));
}

/**
 * A utility reference found in source.
 *
 * Variants (`hover:`, `lg:`, `focus-visible:`) and opacity modifiers (`/15`) are
 * stripped, because neither changes which theme entry has to exist.
 *
 * The leading `(?<![-/\w])` is not tidiness. `\b` matches inside a hyphenated
 * word, so without it `convert-to-work-order` — a real route template in
 * `idempotent-operations.ts` — reads as the utility `to-work-order`, and
 * "right-to-left" in a comment reads as `to-left`. Both were reported on the
 * first run of this gate. A class name never follows a hyphen or a slash.
 */
const UTILITY = new RegExp(
  `(?<![-/\\w])(?:[a-z-]+:)*(${COLOUR_PREFIXES.join('|')})-([a-z][a-z0-9-]*)(?:/\\d+)?\\b`,
  'g'
);

/**
 * Removes comments before scanning.
 *
 * This phase has now written four absence sweeps that matched their own
 * explanatory prose, so the rule is written down: a text scanner cannot tell
 * code from a sentence about code, and it must be given only the code.
 *
 * `(^|\s)//` rather than `//`, so a `https://` inside a string survives.
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** A width utility such as `border-b-2` or `divide-x-4`, not a colour. */
const EDGE_WIDTH = /^[tblrsexy](-\d+)?$/;

export function inspect(relPath, source, known) {
  const findings = [];
  for (const [index, line] of stripComments(source).split(/\r?\n/).entries()) {
    for (const match of line.matchAll(UTILITY)) {
      const prefix = match[1];
      const name = match[2];
      if (!prefix || !name) continue;
      if (NON_COLOUR[prefix]?.has(name)) continue;
      if ((prefix === 'border' || prefix === 'divide') && EDGE_WIDTH.test(name)) continue;
      // A bare numeric width such as `border-2` never reaches here (the pattern
      // requires a leading letter), and an arbitrary value `bg-[#fff]` is the
      // design-token gate's job, not this one.
      if (known.has(name) || BUILT_IN.has(name)) continue;
      findings.push({ path: relPath, line: index + 1, utility: `${prefix}-${name}` });
    }
  }
  return findings;
}

const EXTENSIONS = /\.tsx?$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (EXTENSIONS.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Proves the check can still fail.
 *
 * A gate that has stopped matching anything reports a clean tree exactly like a
 * gate that is working. This runs the real `inspect` over a deliberate violation
 * and over a legal line, and refuses to report success if either verdict is
 * wrong — the same positive control the other P1-27 absence sweeps carry.
 */
export function selfTest() {
  const known = new Set(['primary', 'error']);

  const bad = inspect('x.tsx', '<p className="text-status-danger" />', known);
  if (bad.length !== 1 || bad[0]?.utility !== 'text-status-danger') {
    return 'self-test: an unresolvable utility was not detected';
  }

  const good = inspect(
    'x.tsx',
    '<p className="text-error hover:bg-primary/15 text-body border-b-2 border-error" />',
    known
  );
  if (good.length !== 0) {
    return `self-test: a legal line was rejected (${good.map((f) => f.utility).join(', ')})`;
  }

  // The two false-positive classes the first run of this gate produced.
  const prose = inspect('x.tsx', '// a decimal amount reads left-to-right in Arabic\n', known);
  if (prose.length !== 0) {
    return `self-test: a comment was scanned (${prose.map((f) => f.utility).join(', ')})`;
  }
  const route = inspect('x.tsx', "  template: '/receptions/{id}/convert-to-work-order',", known);
  if (route.length !== 0) {
    return `self-test: a route template was read as a class (${route.map((f) => f.utility).join(', ')})`;
  }

  return null;
}

function main() {
  const failure = selfTest();
  if (failure) {
    console.error(failure);
    return 2;
  }

  let configSource;
  try {
    configSource = readFileSync(join(ROOT, 'tailwind.config.ts'), 'utf8');
  } catch {
    console.error('tailwind.config.ts could not be read');
    return 2;
  }

  const known = themeColours(configSource);
  if (!known || known.size === 0) {
    console.error('no theme colours were found in tailwind.config.ts');
    return 2;
  }

  const files = walk(join(ROOT, 'src'));
  const findings = files.flatMap((file) =>
    inspect(
      file
        .slice(ROOT.length + 1)
        .split('\\')
        .join('/'),
      readFileSync(file, 'utf8'),
      known
    )
  );

  if (findings.length > 0) {
    console.error('Tailwind colour utilities that resolve to nothing:\n');
    for (const finding of findings) {
      console.error(`  ${finding.path}:${finding.line}  ${finding.utility}`);
    }
    console.error(
      `\n${findings.length} unresolvable utility reference(s). Each emits NO CSS.` +
        '\nAdd the colour to theme.extend.colors in tailwind.config.ts, or use a name that exists.'
    );
    return 1;
  }

  console.log(
    `Tailwind theme: ${files.length} file(s) checked, ${known.size} colour(s) registered, 0 unresolvable.`
  );
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main());
}

export const __filename_for_tests = fileURLToPath(import.meta.url);
