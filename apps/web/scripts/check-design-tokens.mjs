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
 * A STYLE POSITION is an `sx` or `css` attribute, a `GlobalStyles` `styles`, an
 * `sx` value, each `styleOverrides` slot, every argument of `createTheme()`,
 * `extendTheme()`, `css()`, `keyframes()` and `styled(X)()`, and — inside a
 * style object — a spread and the value of a selector, at-rule, keyframe or
 * computed key (`'&:hover': HOVER`). A reference there (`sx={cardSx}`,
 * `styles.card`, `styled('div')(base)`, `cond ? a : b`, an array, a function
 * and the objects it returns) is followed to its same-file declaration BY
 * SCOPE — the nearest `const` or function declaration; a parameter or inner
 * declaration shadows an outer one — and read there. A reference that cannot
 * be followed — an import, a parameter, a `let`, a call result — is itself a
 * finding (`style-object-unresolved`), except in the exact allow-list
 * `STYLE_FORWARDING_PATHS`, whose shared wrappers forward the `sx` their
 * callers wrote and checked.
 *
 * Two references are token sources, not findings: a member of the theme a
 * style callback receives (`sx={(theme) => ({ ...theme.typography.body2 })}`,
 * `styled('div')(({ theme }) => …)`), and the value of a CSS-property key
 * (`fontSize: FONT_SIZE_PX.body`). The latter is read as that property's value
 * when it is a same-file `const` (`const W = 320; … width: W` is refused), and
 * otherwise taken as a token without being read.
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

/**
 * Files that may pass a style object through by reference.
 *
 * A shared wrapper forwards the `sx` its caller gave it (`sx={sx}`), and that
 * object is written — and checked — where the caller wrote it. Anywhere else a
 * reference the gate cannot follow is a finding (below). The operational grid
 * entries are reserved for the ADR-022 PR1 wrapper; `check-api-boundary.mjs`
 * reserves the same two for the one place the data grid may be spread.
 *
 * An exact allow-list: an entry ending in `/` admits that directory, any other
 * entry admits that one file. A bare prefix would admit a sibling that merely
 * shares the name (`OperationalGridAnything.tsx`).
 */
export const STYLE_FORWARDING_PATHS = [
  'src/components/ui-foundation/',
  'src/components/data/OperationalGrid.tsx',
  'src/components/data/OperationalGrid/',
];

export function forwardsStyles(relPath) {
  const normalised = relPath.split(sep).join('/');
  return STYLE_FORWARDING_PATHS.some((entry) =>
    entry.endsWith('/') ? normalised.startsWith(entry) : normalised === entry
  );
}

/** Parentheses, `as`, `satisfies` and `!` change a type, never the object. */
function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Scope-aware name resolution
// ---------------------------------------------------------------------------

const isFunctionLike = (node) =>
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

/** A node that opens a scope a `const`, `let`, parameter or declaration lives in. */
const isScope = (node) =>
  ts.isSourceFile(node) ||
  ts.isBlock(node) ||
  ts.isModuleBlock(node) ||
  ts.isCaseBlock(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isCatchClause(node) ||
  isFunctionLike(node);

function nearest(node, test) {
  for (let current = node; current; current = current.parent) {
    if (test(current)) return current;
  }
  return undefined;
}

/** Every name a binding introduces, with the property path from its root. */
function bindingNames(name, path = [], out = []) {
  if (ts.isIdentifier(name)) {
    out.push({ name: name.text, path });
    return out;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    let key = null;
    if (ts.isObjectBindingPattern(name) && !element.dotDotDotToken) {
      const property = element.propertyName ?? element.name;
      if (ts.isIdentifier(property) || ts.isStringLiteral(property)) key = property.text;
    }
    bindingNames(element.name, [...path, key], out);
  }
  return out;
}

/**
 * Every binding in the file, by the scope that holds it.
 *
 * A reference resolves to the NEAREST enclosing declaration of its name — a
 * parameter or an inner `const` shadows an outer one — so two functions that
 * each declare `styles` never lend each other their objects.
 */
function bindingScopes(file) {
  const scopes = new Map();
  const declare = (scope, name, binding) => {
    if (!scope) return;
    const table = scopes.get(scope) ?? new Map();
    // A name declared twice in one scope is not one object: refuse to guess.
    table.set(name, table.has(name) ? { kind: 'other' } : binding);
    scopes.set(scope, table);
  };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
      const flags = node.parent.flags;
      const blockScoped = (flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) !== 0;
      const scope = blockScoped
        ? nearest(node.parent.parent, isScope)
        : nearest(node.parent.parent, (n) => ts.isSourceFile(n) || isFunctionLike(n));
      const isConst =
        (flags & ts.NodeFlags.Const) !== 0 && ts.isIdentifier(node.name) && node.initializer;
      for (const { name } of bindingNames(node.name)) {
        declare(
          scope,
          name,
          isConst ? { kind: 'const', initializer: node.initializer } : { kind: 'other' }
        );
      }
    } else if (ts.isVariableDeclaration(node) && ts.isCatchClause(node.parent)) {
      for (const { name } of bindingNames(node.name)) declare(node.parent, name, { kind: 'other' });
    } else if (ts.isParameter(node) && isFunctionLike(node.parent)) {
      const index = node.parent.parameters.indexOf(node);
      for (const { name, path } of bindingNames(node.name)) {
        declare(node.parent, name, { kind: 'parameter', fn: node.parent, index, path });
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      declare(nearest(node.parent, isScope), node.name.text, { kind: 'function', node });
    } else if (ts.isFunctionExpression(node) && node.name) {
      declare(node, node.name.text, { kind: 'function', node });
    } else if (
      (ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      declare(nearest(node.parent, isScope), node.name.text, { kind: 'other' });
    } else if (
      (ts.isImportClause(node) ||
        ts.isImportSpecifier(node) ||
        ts.isNamespaceImport(node) ||
        ts.isImportEqualsDeclaration(node)) &&
      node.name
    ) {
      declare(file, node.name.text, { kind: 'import' });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return scopes;
}

function resolveBinding(identifier, scopes) {
  for (let current = identifier.parent; current; current = current.parent) {
    const binding = scopes.get(current)?.get(identifier.text);
    if (binding) return binding;
  }
  return { kind: 'unbound' };
}

function addRoot(context, node) {
  if (context.rootSet.has(node)) return;
  context.rootSet.add(node);
  context.roots.push(node);
}

const isEmptyValue = (node) =>
  node.kind === ts.SyntaxKind.NullKeyword ||
  node.kind === ts.SyntaxKind.TrueKeyword ||
  node.kind === ts.SyntaxKind.FalseKeyword ||
  (ts.isIdentifier(node) && node.text === 'undefined');

const isStyleFunction = (node) =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);

/** The expressions a function returns, not counting a nested function's. */
function returnedExpressions(fn) {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out = [];
  const visit = (node) => {
    if (isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return out;
}

/** The text of a member name: `a.b`, `a['b']`, `a[0]`. */
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const argument = unwrap(node.argumentExpression);
  if (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) return argument.text;
  return null;
}

/** `props.theme.typography` → base `props`, members `['theme', 'typography']`. */
function accessChain(node) {
  const members = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    members.unshift(memberName(current));
    current = unwrap(current.expression);
  }
  return { base: current, members };
}

/**
 * Whether a reference names the Material theme a style callback was given.
 *
 * An `sx` (or `GlobalStyles`) callback receives the theme as its first
 * argument; a `styled()` or `styleOverrides` callback receives props that
 * carry it as `theme`. A member of that theme — `theme.typography.body2`,
 * `theme.mixins.toolbar` — is a token source, not an unresolved object.
 */
function isThemeReference(node, context) {
  const { base, members } = accessChain(node);
  if (!ts.isIdentifier(base)) return false;
  const binding = resolveBinding(base, context.scopes);
  if (binding.kind !== 'parameter' || binding.index !== 0) return false;
  const mode = context.styleFunctions.get(binding.fn);
  if (mode === 'theme') return true;
  if (mode !== 'props') return false;
  if (binding.path.length > 0) return binding.path[0] === 'theme';
  return members[0] === 'theme';
}

/** The object literals an expression resolves to, and whether that is all of them. */
function objectsOf(expression, context, acc = { objects: [], complete: true }, seen = new Set()) {
  const node = unwrap(expression);
  if (seen.has(node)) return acc;
  seen.add(node);
  if (ts.isObjectLiteralExpression(node)) {
    acc.objects.push(node);
  } else if (ts.isIdentifier(node)) {
    const binding = resolveBinding(node, context.scopes);
    if (binding.kind === 'const') objectsOf(binding.initializer, context, acc, seen);
    else acc.complete = false;
  } else if (ts.isConditionalExpression(node)) {
    objectsOf(node.whenTrue, context, acc, seen);
    objectsOf(node.whenFalse, context, acc, seen);
  } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const members = memberTargets(node, context);
    if (!members.complete) acc.complete = false;
    for (const target of members.targets) objectsOf(target, context, acc, seen);
  } else {
    acc.complete = false;
  }
  return acc;
}

/** What `a.b` names, in the object literals `a` resolves to. */
function memberTargets(node, context) {
  const name = memberName(node);
  if (name === null) return { targets: [], complete: false };
  const { objects, complete } = objectsOf(node.expression, context);
  const out = { targets: [], complete };
  const collected = new Set();
  const collect = (object) => {
    if (collected.has(object)) return;
    collected.add(object);
    for (const property of object.properties) {
      if (ts.isPropertyAssignment(property)) {
        const key = property.name;
        const text =
          ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key)
            ? key.text
            : ts.isComputedPropertyName(key) && ts.isStringLiteralLike(key.expression)
              ? key.expression.text
              : null;
        if (text === null) out.complete = false;
        else if (text === name) out.targets.push(property.initializer);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        if (property.name.text === name) out.targets.push(property.name);
      } else if (ts.isSpreadAssignment(property)) {
        // A member may come from what is spread: follow it, and refuse to
        // call the lookup complete over a spread it cannot read.
        const inner = objectsOf(property.expression, context);
        if (!inner.complete) out.complete = false;
        for (const object of inner.objects) collect(object);
      }
    }
  };
  for (const object of objects) collect(object);
  return out;
}

/**
 * Follows a reference to the style object it names, in the same file.
 *
 * `sx={cardSx}` with `const cardSx = { … }` resolves to that literal, and so
 * do `styles.card`, a conditional's branches, `cond && {…}`, the members of an
 * `sx` array and the object a same-file function returns. Names resolve by
 * scope: the nearest `const` wins, and a parameter shadows an outer `const`.
 *
 * `how.strict` marks a STYLE-OBJECT position (an `sx` value, a style call's
 * argument, a spread, a selector key): what cannot be followed there — an
 * import, a parameter, a call — is pushed to `unresolved`, because the gate
 * never reports clean over an object it did not read. Under a CSS-property
 * key the value is a scalar: it is read when it resolves in the file and
 * otherwise taken as a token (`fontSize: FONT_SIZE_PX.body`).
 */
function resolveStyle(expression, context, how) {
  const node = unwrap(expression);
  // A node is followed once per way of reading it: a const named both as a
  // scalar and in a style position must be read strictly the second time.
  const tag = how.strict ? 'strict' : `scalar:${how.key ?? ''}`;
  const tags = context.seen.get(node) ?? new Set();
  if (tags.has(tag)) return;
  tags.add(tag);
  context.seen.set(node, tags);
  if (isEmptyValue(node)) return;
  const miss = () => {
    if (how.strict) context.unresolved.push(node);
  };
  if (ts.isObjectLiteralExpression(node)) {
    addRoot(context, node);
    if (how.slots) {
      // `styleOverrides: { root: …, label: … }`: every slot is a style object,
      // and a slot callback receives props that carry the theme.
      for (const property of node.properties) {
        const slot = { strict: true, mode: 'props' };
        if (ts.isPropertyAssignment(property)) resolveStyle(property.initializer, context, slot);
        else if (ts.isShorthandPropertyAssignment(property)) {
          resolveStyle(property.name, context, slot);
        } else if (ts.isSpreadAssignment(property)) {
          resolveStyle(property.expression, context, { ...slot, slots: true });
        }
      }
    }
    return;
  }
  if (isStyleFunction(node)) {
    // `sx={(theme) => ({ … })}`: the returned object is read where it is written.
    addRoot(context, node);
    if (!context.styleFunctions.has(node)) context.styleFunctions.set(node, how.mode);
    for (const returned of returnedExpressions(node)) {
      resolveStyle(returned, context, { strict: how.strict, mode: how.mode, key: how.key });
    }
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      resolveStyle(ts.isSpreadElement(element) ? element.expression : element, context, how);
    }
    return;
  }
  if (ts.isConditionalExpression(node)) {
    resolveStyle(node.whenTrue, context, how);
    resolveStyle(node.whenFalse, context, how);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      resolveStyle(node.right, context, how);
      return;
    }
    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      resolveStyle(node.left, context, how);
      resolveStyle(node.right, context, how);
      return;
    }
  }
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
    // A CSS string: in a style position it is a style (`styled('div')('…')`),
    // under a property key it is that property's value.
    if (how.strict) addRoot(context, node);
    else context.scalars.push({ node, key: how.key ?? null });
    return;
  }
  if (numericValue(node) !== null) {
    if (how.strict) miss();
    else context.scalars.push({ node, key: how.key ?? null });
    return;
  }
  if (ts.isIdentifier(node)) {
    const binding = resolveBinding(node, context.scopes);
    if (binding.kind === 'const') {
      resolveStyle(binding.initializer, context, how);
      return;
    }
    if (binding.kind === 'function') {
      resolveStyle(binding.node, context, how);
      return;
    }
    if (isThemeReference(node, context)) return;
    miss();
    return;
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    if (isThemeReference(node, context)) return;
    const { targets, complete } = memberTargets(node, context);
    for (const target of targets) resolveStyle(target, context, how);
    if (targets.length === 0 || !complete) miss();
    return;
  }
  miss();
}

/**
 * Keys whose value is itself a style object: a selector (`'&:hover'`,
 * `'& .MuiChip-root'`), an at-rule (`'@media …'`), a keyframe stop (`'50%'`)
 * or a computed key (`[theme.breakpoints.up('md')]`). Any other key is a CSS
 * property, and its value a scalar.
 */
const SELECTOR_KEY = /^[&@:.#[>+~*]|[\s,&]|%$/;

function isNestedStyleKey(property) {
  const name = property.name;
  if (ts.isComputedPropertyName(name)) {
    return ts.isStringLiteralLike(name.expression) ? SELECTOR_KEY.test(name.expression.text) : true;
  }
  return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && SELECTOR_KEY.test(name.text);
}

/**
 * A style position. An `sx`, `GlobalStyles` or style-call callback receives the
 * theme; a `styled()` or `styleOverrides` callback receives props carrying it.
 */
const STRICT_THEME = { strict: true, mode: 'theme' };
const STRICT_PROPS = { strict: true, mode: 'props' };

/**
 * The expressions a style-object walk starts from, the references in a style
 * position it could not follow, and the scalar values it resolved.
 *
 * Exported so `check-tailwind-theme.mjs` reads "a style object" by the same
 * definition: a CSS keyword inside one (`boxSizing: 'border-box'`) is not a
 * Tailwind class.
 */
export function styleObjectRoots(file) {
  const context = {
    scopes: bindingScopes(file),
    styleFunctions: new Map(),
    roots: [],
    unresolved: [],
    scalars: [],
    rootSet: new Set(),
    seen: new Map(),
  };
  const { roots, unresolved, scalars } = context;
  const follow = (expression, how) => resolveStyle(expression, context, how);
  const followArguments = (args, how) => {
    for (const argument of args) {
      follow(ts.isSpreadElement(argument) ? argument.expression : argument, how);
    }
  };
  // Every style position must resolve: an `sx`/`css` attribute, a
  // `GlobalStyles` `styles`, an `sx` or `styleOverrides` value, the arguments
  // of `createTheme()`/`extendTheme()`/`css()`/`keyframes()` and `styled(X)()`.
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
      const name = node.name.getText(file);
      const element = node.parent?.parent;
      const tag =
        element && (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))
          ? element.tagName.getText(file)
          : '';
      if (STYLE_OBJECT_ATTRIBUTES.has(name) && node.initializer.expression) {
        follow(node.initializer.expression, STRICT_THEME);
      } else if (name === 'styles' && /GlobalStyles$/.test(tag) && node.initializer.expression) {
        follow(node.initializer.expression, STRICT_THEME);
      }
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      STYLE_OBJECT_KEYS.has(propertyKey(node) ?? '')
    ) {
      const value = ts.isPropertyAssignment(node) ? node.initializer : node.name;
      if (propertyKey(node) === 'styleOverrides') follow(value, { ...STRICT_PROPS, slots: true });
      else follow(value, STRICT_THEME);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let name = null;
      if (ts.isIdentifier(callee)) name = callee.text;
      else if (ts.isPropertyAccessExpression(callee)) name = callee.name.text;
      // `createTheme({...})`, `css({...})`
      if (name && STYLE_OBJECT_CALLS.has(name)) followArguments(node.arguments, STRICT_THEME);
      // `styled(X)({...})` and `styled('div', options)(({ theme }) => ({...}))`
      if (
        ts.isCallExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'styled'
      ) {
        followArguments(node.arguments, STRICT_PROPS);
      }
    }
    // styled.div`…`, styled(X)`…`, css`…`
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag.getText(file);
      if (/^(?:styled\b|css$|keyframes$)/.test(tag)) addRoot(context, node.template);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  // Inside a style object: a spread is a style object, and so is the value of
  // a selector key (`'&:hover': HOVER`) — both must resolve. The value of a
  // CSS-property key is a scalar: read when it resolves in the file, otherwise
  // a token. The work list grows as references resolve.
  for (let index = 0; index < roots.length; index += 1) {
    const inner = (node) => {
      if (ts.isSpreadAssignment(node)) {
        follow(node.expression, STRICT_THEME);
      } else if (ts.isPropertyAssignment(node)) {
        const value = unwrap(node.initializer);
        if (isNestedStyleKey(node)) {
          // A literal object here is already part of this root.
          if (!ts.isObjectLiteralExpression(value)) follow(value, STRICT_THEME);
        } else if (
          ts.isIdentifier(value) ||
          ts.isPropertyAccessExpression(value) ||
          ts.isElementAccessExpression(value) ||
          isStyleFunction(value)
        ) {
          follow(value, { strict: false, mode: 'theme', key: propertyKey(node) });
        }
      } else if (ts.isShorthandPropertyAssignment(node)) {
        follow(node.name, { strict: false, mode: 'theme', key: propertyKey(node) });
      }
      ts.forEachChild(node, inner);
    };
    ts.forEachChild(roots[index], inner);
  }
  return { roots, unresolved, scalars };
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

  /** A physical left/right value, or a raw number where Material reads px or ms. */
  const checkValue = (node, key, value) => {
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
  };
  /** A raw length or duration in a string or template. */
  const checkText = (node) => {
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
        checkValue(node, key, value);
      }
    }
    checkText(node);
    ts.forEachChild(node, visit);
  };
  const { roots, unresolved, scalars } = styleObjectRoots(file);
  for (const root of roots) visit(root);
  // A same-file const named as a property's value is read as that value:
  // `const W = 320; … { width: W }` is `width: 320`.
  for (const { node, key } of scalars) {
    if (key) checkValue(node, key, node);
    checkText(node);
  }
  if (!forwardsStyles(relPath)) {
    for (const node of unresolved) {
      report(
        node,
        'style-object-unresolved',
        `a style object passed by a reference this file does not define ("${node.getText(file)}"); ` +
          'write it in this file, or pass it through a shared wrapper (ADR-022)'
      );
    }
  }
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
