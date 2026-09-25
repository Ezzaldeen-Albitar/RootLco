#!/usr/bin/env node
/**
 * Emits the Sass design tokens as a TypeScript module.
 *
 * ## Why this exists
 *
 * ADR-013 and ADR-020 make Sass the ONE source of every design value, emitted
 * as CSS custom properties. ADR-022 adds Material UI, and a Material theme
 * needs a handful of those values as JavaScript NUMBERS rather than as
 * `var(--…)` references: breakpoints (a media query cannot read a custom
 * property), the border-radius base, z-index layers, transition durations
 * (React transition timeouts are milliseconds) and the grid row heights.
 *
 * Copying them by hand would create the second source of truth ADR-020 exists
 * to prevent. So they are GENERATED: this script compiles the real token entry
 * point (`src/styles/tokens/_index.scss`, the same file the application's
 * stylesheet uses) plus the breakpoint map, reads the custom properties the
 * compiler emitted, and writes `src/styles/tokens/generated/tokens.ts`.
 *
 * ## The drift check
 *
 * `--check` writes nothing and exits 1 when the committed module differs from
 * what the Sass maps produce today. `tests/design-tokens-generated.test.ts`
 * runs the same comparison in the web test tier, so an edit to a `.scss` token
 * that is not followed by a regeneration fails CI rather than drifting.
 *
 * Usage (from apps/web):
 *   node scripts/generate-design-tokens.mjs          write the module
 *   node scripts/generate-design-tokens.mjs --check  fail on drift
 *
 * Exit: 0 written or in step · 1 drift · 2 the generator could not run.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import * as sass from 'sass';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_DIR = join(WEB_ROOT, 'src', 'styles', 'tokens');
export const OUTPUT_PATH = join(TOKENS_DIR, 'generated', 'tokens.ts');

/**
 * The compiled input. `index` is the application's own emit point, so the
 * names and values here are exactly the ones the running stylesheet carries;
 * breakpoints are not emitted by it (media queries cannot use custom
 * properties), so they are emitted here into a throwaway rule.
 */
const SOURCE = `
@use 'sass:meta';
@use 'index';
@use 'breakpoints';

rootlco-generated-breakpoints {
  @each $name, $value in breakpoints.$scale {
    --breakpoint-#{$name}: #{meta.inspect($value)};
  }
}
`;

/** Reads the declarations of the first top-level block opened by `selector`. */
export function declarationsOf(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`the compiled tokens carry no "${selector}" block`);
  const end = css.indexOf('\n}', start);
  if (end === -1) throw new Error(`the "${selector}" block is not closed`);
  const out = new Map();
  for (const line of css.slice(start, end).split('\n').slice(1)) {
    const match = /^\s*--([a-z0-9-]+):\s*(.+);\s*$/.exec(line);
    if (!match) {
      if (line.trim() === '') continue;
      throw new Error(`unreadable declaration in "${selector}": ${line.trim()}`);
    }
    out.set(match[1], match[2].trim());
  }
  if (out.size === 0) throw new Error(`the "${selector}" block declares nothing`);
  return out;
}

/** `16px` → 16, `80ms` → 80, `400` → 400. Anything else is refused. */
export function numberOf(name, value, unit) {
  const pattern =
    unit === '' ? /^(-?\d+(?:\.\d+)?)$/ : new RegExp(`^(-?\\d+(?:\\.\\d+)?)(?:${unit})?$`);
  const match = pattern.exec(value);
  if (!match)
    throw new Error(`--${name}: expected a number${unit ? ` in ${unit}` : ''}, got "${value}"`);
  return Number(match[1]);
}

function group(declarations, prefix) {
  const out = {};
  for (const [name, value] of declarations) {
    if (name.startsWith(`${prefix}-`)) out[name.slice(prefix.length + 1)] = value;
  }
  if (Object.keys(out).length === 0) throw new Error(`no --${prefix}-* token was emitted`);
  return out;
}

function numbers(declarations, prefix, unit) {
  return Object.fromEntries(
    Object.entries(group(declarations, prefix)).map(([key, value]) => [
      key,
      numberOf(`${prefix}-${key}`, value, unit),
    ])
  );
}

function literal(value) {
  return JSON.stringify(value, null, 2).replace(/"/g, "'");
}

/** The module text, formatted exactly as the repository's Prettier would. */
export async function render() {
  const { css } = sass.compileString(SOURCE, {
    loadPaths: [TOKENS_DIR],
    style: 'expanded',
  });
  const root = declarationsOf(css, ':root');
  const breakpoints = declarationsOf(css, 'rootlco-generated-breakpoints');

  // Colours are keyed by their full custom-property name. A bare key such as
  // `text-muted` reads as a Tailwind colour utility to `validate:web-theme`,
  // which scans every source file; `--color-text-muted` cannot, and it names
  // the one thing the value is: the custom property the stylesheet emits.
  const colours = Object.fromEntries(
    Object.entries(group(root, 'color')).map(([key, value]) => [`--color-${key}`, value])
  );

  const sections = [
    ['COLOR', 'Colour tokens, keyed by custom property, as the compiler emitted them.', colours],
    ['SPACE_PX', 'Spacing scale (`--space-*`) in pixels.', numbers(root, 'space', 'px')],
    ['RADIUS_PX', 'Radii (`--radius-*`) in pixels.', numbers(root, 'radius', 'px')],
    ['FONT_SIZE_PX', 'Type sizes (`--font-size-*`) in pixels.', numbers(root, 'font-size', 'px')],
    [
      'LINE_HEIGHT_PX',
      'Line heights (`--line-height-*`) in pixels.',
      numbers(root, 'line-height', 'px'),
    ],
    ['FONT_WEIGHT', 'Font weights (`--font-weight-*`).', numbers(root, 'font-weight', '')],
    ['LAYOUT_PX', 'Layout measures (`--layout-*`) in pixels.', numbers(root, 'layout', 'px')],
    ['Z_INDEX', 'Stacking layers (`--z-*`).', numbers(root, 'z', '')],
    ['DURATION_MS', 'Durations (`--duration-*`) in milliseconds.', numbers(root, 'duration', 'ms')],
    ['EASING', 'Easing curves (`--ease-*`).', group(root, 'ease')],
    ['BREAKPOINT_PX', 'Breakpoints in pixels.', numbers(breakpoints, 'breakpoint', 'px')],
    ['FONT_FAMILY', 'Font stacks (`--font-family-*`).', group(root, 'font-family')],
  ];

  const body = sections
    .map(
      ([name, doc, value]) => `/** ${doc} */\nexport const ${name} = ${literal(value)} as const;\n`
    )
    .join('\n');

  const text =
    '/*\n' +
    ' * GENERATED by apps/web/scripts/generate-design-tokens.mjs from src/styles/tokens/*.scss.\n' +
    ' * Do not edit: change the Sass token, then run `node scripts/generate-design-tokens.mjs`\n' +
    ' * from apps/web. tests/design-tokens-generated.test.ts fails when this file drifts.\n' +
    ' */\n\n' +
    body;

  const options = (await prettier.resolveConfig(OUTPUT_PATH)) ?? {};
  return prettier.format(text, { ...options, filepath: OUTPUT_PATH });
}

async function main() {
  let expected;
  try {
    expected = await render();
  } catch (error) {
    console.error(`design-token generation could not run: ${String(error)}`);
    return 2;
  }

  if (process.argv.includes('--check')) {
    let actual = '';
    try {
      actual = readFileSync(OUTPUT_PATH, 'utf8');
    } catch {
      actual = '';
    }
    if (actual !== expected) {
      console.error(
        `${OUTPUT_PATH} is out of step with the Sass tokens. ` +
          'Run `node scripts/generate-design-tokens.mjs` from apps/web and commit the result.'
      );
      return 1;
    }
    console.log('Generated design tokens are in step with the Sass maps.');
    return 0;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, expected, 'utf8');
  console.log(`Wrote ${OUTPUT_PATH}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
