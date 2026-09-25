#!/usr/bin/env node
/**
 * Design-token isolation gate.
 *
 * ADR-020 claims "Sass owns every design value; Tailwind holds references, never
 * values". That claim degrades the first time somebody writes `bg-[#0f172a]` or
 * `transition: 200ms` in a component — quietly, and in a way review misses
 * because the result looks right.
 *
 * This makes the claim enforceable. A raw design literal outside the approved
 * token files fails the build.
 *
 * Approved to hold raw values:
 *   - src/styles/tokens/**   the token source (including the GENERATED
 *                            `tokens/generated/tokens.ts`, ADR-022)
 *   - src/styles/themes/**   theme remaps
 *
 * ## Style OBJECTS (ADR-022)
 *
 * Material UI adds a second way to write a design value: a JavaScript object —
 * an `sx` prop, a `styled()` call, a theme's `createTheme()` options and its
 * `styleOverrides`. The line rules below see a hex colour there, but they were
 * blind (measured) to `sx={{ transition: 'opacity 200ms' }}`, a numeric
 * `fontSize: 13` or `transitionDuration: 200`; and Stylelint, which enforces
 * ADR-013's logical properties, reads `.scss` only, so `sx={{ marginLeft: 1 }}`
 * was unchecked as well.
 *
 * `inspectStyleObjects` closes both, on the TypeScript syntax tree rather than
 * on text, so a string in a comment or a key that merely resembles a property
 * cannot be mistaken for one. Inside a style object it refuses:
 *
 *   - a raw length or duration in a string (`'12px'`, `'1.5rem'`, `'200ms'`);
 *   - a raw number where Material reads pixels or milliseconds (`fontSize`,
 *     `letterSpacing`, border and outline widths, offsets, `zIndex`, the grid's
 *     row heights, every transition duration; and a size above 1, because
 *     Material reads 0–1 as a fraction of the container);
 *   - a PHYSICAL property or value (`marginLeft`, `pr`, `left`, `borderRight…`,
 *     `textAlign: 'left'`, `float: 'right'`); write the logical one.
 *
 * Zero is never a finding. Values come from `var(--…)` or from the generated
 * token module, exactly as in the Sass and Tailwind layers.
 *
 * Exit: 0 clean · 1 a violation · 2 the check could not run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

const ROOT = process.cwd();

/** Directories permitted to contain raw design values. */
export const TOKEN_ROOTS = [join('src', 'styles', 'tokens'), join('src', 'styles', 'themes')];

/** What counts as a raw design value. */
export const RULES = [
  { id: 'hex-colour', pattern: /#[0-9a-fA-F]{3,8}\b/, what: 'a hex colour' },
  { id: 'rgb-colour', pattern: /\brgba?\s*\(/, what: 'an rgb()/rgba() colour' },
  { id: 'hsl-colour', pattern: /\bhsla?\s*\(/, what: 'an hsl()/hsla() colour' },
  { id: 'oklch-colour', pattern: /\boklch\s*\(/, what: 'an oklch() colour' },
  { id: 'raw-duration', pattern: /:\s*\d+m?s\b/, what: 'a raw transition duration' },
  {
    id: 'arbitrary-tailwind',
    pattern: /\b(?:bg|text|border|shadow|rounded|duration|ease)-\[/,
    what: 'a Tailwind arbitrary value',
  },
];

const EXTENSIONS = /\.(scss|css|ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'scripts']);

export function isTokenFile(relPath) {
  const normalised = relPath.split('/').join(sep);
  return TOKEN_ROOTS.some((root) => normalised.startsWith(root + sep));
}

/** Strips comments so prose about a hex colour is not itself a violation. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
}

export function inspect(relPath, source) {
  if (isTokenFile(relPath)) return [];
  const body = stripComments(source);
  const findings = [];
  for (const line of body.split(/\r?\n/).entries()) {
    const [index, text] = line;
    for (const rule of RULES) {
      if (rule.pattern.test(text)) {
        findings.push({ path: relPath, line: index + 1, rule: rule.id, what: rule.what });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Style objects (ADR-022)
// ---------------------------------------------------------------------------

/** Calls whose arguments are style or theme objects. */
export const STYLE_OBJECT_CALLS = new Set(['createTheme', 'extendTheme', 'css', 'keyframes']);

/** JSX attributes whose value is a style object. */
export const STYLE_OBJECT_ATTRIBUTES = new Set(['sx', 'css']);

/** Object keys whose value is a style object wherever they appear. */
export const STYLE_OBJECT_KEYS = new Set(['styleOverrides', 'sx']);

/**
 * Physical properties, as style-object keys, with the logical replacement.
 * The Material shorthands are included: `ml` is `marginLeft`.
 */
export const PHYSICAL_PROPERTIES = new Map([
  ['marginLeft', 'marginInlineStart'],
  ['marginRight', 'marginInlineEnd'],
  ['paddingLeft', 'paddingInlineStart'],
  ['paddingRight', 'paddingInlineEnd'],
  ['ml', 'marginInlineStart'],
  ['mr', 'marginInlineEnd'],
  ['pl', 'paddingInlineStart'],
  ['pr', 'paddingInlineEnd'],
  ['left', 'insetInlineStart'],
  ['right', 'insetInlineEnd'],
  ['borderLeft', 'borderInlineStart'],
  ['borderRight', 'borderInlineEnd'],
  ['borderLeftWidth', 'borderInlineStartWidth'],
  ['borderRightWidth', 'borderInlineEndWidth'],
  ['borderLeftColor', 'borderInlineStartColor'],
  ['borderRightColor', 'borderInlineEndColor'],
  ['borderLeftStyle', 'borderInlineStartStyle'],
  ['borderRightStyle', 'borderInlineEndStyle'],
  ['borderTopLeftRadius', 'borderStartStartRadius'],
  ['borderTopRightRadius', 'borderStartEndRadius'],
  ['borderBottomLeftRadius', 'borderEndStartRadius'],
  ['borderBottomRightRadius', 'borderEndEndRadius'],
  ['scrollMarginLeft', 'scrollMarginInlineStart'],
  ['scrollMarginRight', 'scrollMarginInlineEnd'],
  ['scrollPaddingLeft', 'scrollPaddingInlineStart'],
  ['scrollPaddingRight', 'scrollPaddingInlineEnd'],
]);

/** Properties whose `left`/`right` VALUE is physical. */
export const PHYSICAL_VALUE_PROPERTIES = new Set(['textAlign', 'float', 'clear']);

/** Keys Material reads as pixels (or as a raw layer/weight) when given a number. */
export const PIXEL_NUMBER_KEYS = new Set([
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'borderWidth',
  'borderTopWidth',
  'borderBottomWidth',
  'borderInlineStartWidth',
  'borderInlineEndWidth',
  'borderBlockStartWidth',
  'borderBlockEndWidth',
  'outlineWidth',
  'outlineOffset',
  'top',
  'bottom',
  'inset',
  'insetBlockStart',
  'insetBlockEnd',
  'insetInlineStart',
  'insetInlineEnd',
  'zIndex',
  'rowHeight',
  'columnHeaderHeight',
  'headerHeight',
]);

/** Keys Material reads as milliseconds. */
export const DURATION_NUMBER_KEYS = new Set([
  'transitionDuration',
  'transitionDelay',
  'animationDuration',
  'animationDelay',
  'duration',
  'shortest',
  'shorter',
  'short',
  'standard',
  'complex',
  'enteringScreen',
  'leavingScreen',
]);

/** Sizes: Material reads 0–1 as a fraction of the container and above 1 as pixels. */
export const SIZE_NUMBER_KEYS = new Set([
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'flexBasis',
  'blockSize',
  'inlineSize',
  'minBlockSize',
  'maxBlockSize',
  'minInlineSize',
  'maxInlineSize',
]);

/** A raw length or duration inside a string. Zero is filtered out below. */
const RAW_UNIT = /(?<![\w.#-])(\d*\.?\d+)(px|rem|em|ms|s)\b/g;

/** `margin-left` → `marginLeft`, so both spellings are one key. */
function camel(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function propertyKey(node) {
  const name = node.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return camel(name.text);
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return camel(name.expression.text);
  }
  return null;
}

function numericValue(node) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  return null;
}

/** Every text fragment of a string or template literal, for the raw-unit scan. */
function textFragments(node) {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  }
  return [];
}

function rawUnits(text) {
  return [...text.matchAll(RAW_UNIT)]
    .filter((match) => Number(match[1]) !== 0)
    .map((match) => ({ value: match[0], unit: match[2] }));
}

/** The expressions a style-object walk starts from. */
function styleRoots(file) {
  const roots = [];
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
      const name = node.name.getText(file);
      const element = node.parent?.parent;
      const tag =
        element && (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))
          ? element.tagName.getText(file)
          : '';
      const styleAttribute =
        STYLE_OBJECT_ATTRIBUTES.has(name) || (name === 'styles' && /GlobalStyles$/.test(tag));
      if (styleAttribute && node.initializer.expression) roots.push(node.initializer.expression);
    }
    if (ts.isPropertyAssignment(node) && STYLE_OBJECT_KEYS.has(propertyKey(node) ?? '')) {
      roots.push(node.initializer);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let name = null;
      if (ts.isIdentifier(callee)) name = callee.text;
      else if (ts.isPropertyAccessExpression(callee)) name = callee.name.text;
      // `createTheme({...})`, `css({...})`
      if (name && STYLE_OBJECT_CALLS.has(name)) roots.push(...node.arguments);
      // `styled(X)({...})` and `styled('div', options)(({ theme }) => ({...}))`
      if (
        ts.isCallExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'styled'
      ) {
        roots.push(...node.arguments);
      }
    }
    // styled.div`…`, styled(X)`…`, css`…`
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag.getText(file);
      if (/^(?:styled\b|css$|keyframes$)/.test(tag)) roots.push(node.template);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return roots;
}

/**
 * Findings inside style objects, read from the syntax tree.
 *
 * A file the parser cannot read is itself a finding: a gate that skipped it
 * would report clean over the one file it never opened.
 */
export function inspectStyleObjects(relPath, source) {
  if (isTokenFile(relPath)) return [];
  const kind = relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, kind);
  if ((file.parseDiagnostics ?? []).length > 0) {
    return [
      {
        path: relPath,
        line: 1,
        rule: 'style-object-unparseable',
        what: 'a source file the style-object check could not parse',
      },
    ];
  }

  const findings = [];
  const seen = new Set();
  const report = (node, rule, what) => {
    const start = node.getStart(file);
    const key = `${start}:${rule}:${what}`;
    if (seen.has(key)) return;
    seen.add(key);
    const line = file.getLineAndCharacterOfPosition(start).line + 1;
    findings.push({ path: relPath, line, rule, what });
  };

  const visit = (node) => {
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const key = propertyKey(node);
      if (key && PHYSICAL_PROPERTIES.has(key)) {
        report(
          node,
          'style-object-physical-property',
          `the physical property "${key}" in a style object (use "${PHYSICAL_PROPERTIES.get(key)}", ADR-013)`
        );
      }
      if (key && ts.isPropertyAssignment(node)) {
        const value = node.initializer;
        const text = ts.isStringLiteralLike(value) ? value.text : null;
        if (PHYSICAL_VALUE_PROPERTIES.has(key) && (text === 'left' || text === 'right')) {
          report(
            node,
            'style-object-physical-property',
            `the physical value "${key}: ${text}" in a style object (use start or end, ADR-013)`
          );
        }
        const number = numericValue(value);
        if (number !== null && number !== 0) {
          if (DURATION_NUMBER_KEYS.has(key)) {
            report(node, 'style-object-raw-duration', `a raw duration "${key}: ${number}"`);
          } else if (PIXEL_NUMBER_KEYS.has(key)) {
            report(node, 'style-object-raw-length', `a raw number "${key}: ${number}"`);
          } else if (SIZE_NUMBER_KEYS.has(key) && Math.abs(number) > 1) {
            report(node, 'style-object-raw-length', `a raw size "${key}: ${number}"`);
          }
        }
      }
    }
    for (const text of textFragments(node)) {
      for (const raw of rawUnits(text)) {
        const duration = raw.unit === 'ms' || raw.unit === 's';
        report(
          node,
          duration ? 'style-object-raw-duration' : 'style-object-raw-length',
          `a raw value "${raw.value}" in a style object`
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const root of styleRoots(file)) visit(root);
  return findings;
}

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

function main() {
  const roots = ['src'].map((d) => join(ROOT, d));
  const files = roots.flatMap((d) => {
    try {
      return walk(d);
    } catch {
      return [];
    }
  });

  // A check that examined nothing is not a clean result — the failure mode this
  // repository keeps finding.
  if (files.length === 0) {
    console.error(
      '::error::design-token check inspected ZERO files. That is not clean, it is blind.'
    );
    process.exit(2);
  }

  const findings = files.flatMap((file) => {
    const rel = relative(ROOT, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');
    return /\.tsx?$/.test(rel)
      ? [...inspect(rel, source), ...inspectStyleObjects(rel, source)]
      : inspect(rel, source);
  });

  for (const f of findings) {
    console.error(
      `::error file=${f.path},line=${f.line}::${f.what} outside the token layer. ` +
        'Design values live in src/styles/tokens/** and are consumed as var(--…). ADR-020, ADR-022.'
    );
  }

  console.log(
    `Design tokens: ${files.length} file(s) inspected, ${findings.length} raw value(s) outside the token layer.`
  );
  if (files.length === 0) {
    console.error('Design tokens: scanned 0 files — the scan roots no longer match the tree.');
    process.exit(1);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
