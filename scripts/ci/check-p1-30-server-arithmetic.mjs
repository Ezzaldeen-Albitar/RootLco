#!/usr/bin/env node
/**
 * `P1-30 RENDERS SERVER ARITHMETIC ONLY` — the closure condition of P1-30, as a gate.
 *
 * No P1-30 screen computes a price, a total, a tax, a discount or a balance
 * (docs/phase-1/phase-1-30/canonical-plan.md §3). A resolved price is
 * `svc.price-resolve`'s; a quotation's totals are the revision's captured
 * figures; an outstanding balance is `sal.invoice-outstanding-read`'s. Money
 * crosses the API as a canonical decimal STRING and is rendered as one — the
 * rule `apps/web/src/lib/money.ts` states at its head: no `Number()`, no
 * `parseFloat`, no unary `+`, no `* / + -`, no `toFixed`; comparison on the
 * digits; `Intl.NumberFormat` exactly once, in `formatMoney`. A screen that
 * adds two lines on the client has shipped a second source of truth, and the
 * phase is not complete while one exists.
 *
 * ## It PARSES, because a scanner reading prose as code is a recorded class
 *
 * `check-exact-money.mjs` guards the API's money trees with six regexes and a
 * hand-written comment stripper, and the stripper exists because the honest
 * way to document why `Number()` is absent is to write `Number()` in a
 * comment. `scripts/lib/typescript-source.mjs` records the class this
 * repository has met seven times — a scanner reading prose as code — and the
 * cure it settled on: ask the parser. So this gate never looks at raw text.
 * `parseModule` yields a `ts.SourceFile` and every rule below is stated over
 * nodes: a `+` inside a string is not a BinaryExpression; a docblock quoting
 * the rule contains no CallExpression; `revision.grandTotal * 2` is refused
 * whatever whitespace or line breaks surround it. A file the parser refuses is
 * a violation rather than a skip — fail closed, stated once.
 *
 * ## What it refuses
 *
 * Inside a P1-30 area — the six feature trees and the six dashboard route
 * segments in `P1_30_AREAS` — every construct that turns a money-named value
 * (`MONEY_IDENTIFIER`: `amount`, `price`, `total`, `tax`, `discount`,
 * `balance`, …) into a number or into a figure the client computed:
 *
 *   - `Number(x)`, `parseFloat(x)`, `parseInt(x)`, `BigInt(x)`, `Math.*(x)`,
 *     `x.toFixed()`, `x.toPrecision()` when an argument or the receiver names
 *     money;
 *   - unary `+x`, `-x`, `++x`, `x--` on a money value;
 *   - `*`, `/`, `%`, `-`, `**` and every compound assignment with money on
 *     either side;
 *   - `+` with money on either side — UNLESS one operand is a string literal
 *     or a template literal, or a `+` chain that already holds one.
 *     `'Total: ' + total` is display, not addition: JavaScript concatenates
 *     the moment one operand is a string, so the canonical string survives
 *     untouched, and `'Total: ' + subtotal + tax` concatenates left to right
 *     for the same reason. `subtotal + tax` carries no such guarantee and is
 *     exactly the client-side total the closure condition forbids.
 *     `formatMoney({ amount }, locale) + suffix` is refused too — not because
 *     it is arithmetic but because the gate cannot tell, and a template
 *     literal costs nothing;
 *   - `new Intl.NumberFormat(…)` and `.toLocaleString(…)` anywhere in an
 *     area: formatting happens once, in `formatMoney`, outside the areas.
 *
 * Comparisons are not flagged — two canonical strings compare exactly, and
 * `compareMoney` exists for ordering. `.length` is a count, whatever it counts.
 * The functions `apps/web/src/lib/money.ts` exports (`SANCTIONED_CALLS`) are
 * the sanctioned path and take money arguments by design; the test pins the
 * list to the module's real export surface so neither can drift.
 *
 * ## `--min-files` defaults to 0, and A0 is why
 *
 * There is no P1-30 screen yet. A0 is the preflight, and this gate is armed
 * before the first screen lands so that the screen meets a rule that predates
 * it rather than a rule shaped around it — the reason `check-p1-29-access.mjs`
 * shipped over an empty set. A run over zero files proves nothing, and P1-29
 * learned that a gate examining zero pages prints the most reassuring line in
 * the log. So every run prints the file count and the areas it found, an
 * empty run says out loud that it is empty, and `--min-files <n>` turns that
 * vacuity into a red. The default stays 0 so A0 can wire the gate into
 * `verify:policies` today without failing on a tree that holds nothing to
 * examine; the phase's completion condition raises it once the screens exist.
 * Its teeth are proved by `tests/ci/p1-30-server-arithmetic.test.ts`, which
 * plants money arithmetic in every refused shape and requires a red.
 *
 *     node scripts/ci/check-p1-30-server-arithmetic.mjs
 *     node scripts/ci/check-p1-30-server-arithmetic.mjs --app-root <dir> --min-files <n>
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

import { parseModule } from '../lib/typescript-source.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..', '..');
const slash = (p) => p.split(sep).join('/');

/** Where the web source lives; `--app-root` overrides it for the red-proof. */
export const DEFAULT_APP_ROOT = join(ROOT, 'apps', 'web', 'src');

const DASHBOARD = 'app/[locale]/(dashboard)';

/**
 * The P1-30 areas, as path fragments under the app root.
 *
 * Hand-listed, unlike `check-p1-29-access.mjs`, which derives its segments from
 * the operation register so that a coverage rule GROWS with its phase. This
 * rule's reach is the plan's execution matrix (W1–W7) spelled in the two
 * conventions `apps/web/src` already follows — a feature tree per area and a
 * dashboard route segment per screen — and a hand-frozen list is right for a
 * rule whose reach the test pins by name. A new area is one line here and a
 * red in `tests/ci/p1-30-server-arithmetic.test.ts` until the test agrees.
 */
export const P1_30_AREAS = Object.freeze([
  'features/services',
  'features/pricing',
  'features/quotations',
  'features/inventory',
  'features/billing',
  'features/payments',
  `${DASHBOARD}/services`,
  `${DASHBOARD}/pricing`,
  `${DASHBOARD}/quotations`,
  `${DASHBOARD}/inventory`,
  `${DASHBOARD}/invoices`,
  `${DASHBOARD}/payments`,
]);

/**
 * A name that carries money. Case-insensitive and by SUBSTRING, so
 * `grandTotal`, `unit_price`, `TAX_RATE` and `outstandingBalance` all count.
 * The substring reading over-reaches (`network` holds `net`); that is the
 * direction that fails safe, and a red names its witness so it costs one
 * rename rather than a hunt.
 */
export const MONEY_IDENTIFIER =
  /(amount|price|total|subtotal|tax|discount|balance|cost|allocated|remaining|outstanding|valuation|net|gross|unitprice|linetotal|grandtotal)/i;

/**
 * The sanctioned path: every function `apps/web/src/lib/money.ts` exports.
 * They take money arguments by design and are never a violation to call.
 * `tests/ci/p1-30-server-arithmetic.test.ts` pins this list to the module's
 * real export surface, so a function added there is added here or the test
 * says so.
 */
export const SANCTIONED_CALLS = Object.freeze([
  'parseMoneyInput',
  'isCanonicalMoney',
  'toCanonicalMoney',
  'compareMoney',
  'isZeroMoney',
  'isNegativeMoney',
  'formatMoney',
  'trimTrailingZeros',
]);

/** Global coercions. `Number.parseFloat` and `Number.parseInt`, their aliases, are refused too. */
export const FORBIDDEN_GLOBAL_CALLS = Object.freeze(['Number', 'parseFloat', 'parseInt', 'BigInt']);

/** Member calls that format a double, which is to say they need one first. */
export const FORBIDDEN_MEMBER_CALLS = Object.freeze(['toFixed', 'toPrecision']);

const SOURCE = /\.tsx?$/;
const SKIPPED = /\.(test\.tsx?|d\.ts)$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && SOURCE.test(entry.name) && !SKIPPED.test(entry.name)) out.push(p);
  }
  return out;
}

/** The P1-30 area a path (relative to the app root) sits in, or null. */
export function areaOf(relPath) {
  const p = `/${slash(relPath)}`;
  return P1_30_AREAS.find((area) => p.includes(`/${area}/`)) ?? null;
}

/** Every examined file under an app root, with the area that claims it. */
export function p1_30FilesUnder(appRoot) {
  return walk(appRoot)
    .map((file) => ({ file, area: areaOf(relative(appRoot, file)) }))
    .filter((entry) => entry.area !== null)
    .sort((a, b) => (slash(a.file) < slash(b.file) ? -1 : 1));
}

const unwrap = (node) => {
  let n = node;
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  return n;
};

/**
 * An operand that makes `+` concatenation: a string or template literal, or a
 * `+` chain that already holds one. `'Total: ' + subtotal + tax` parses as
 * `('Total: ' + subtotal) + tax`, and the left half is text before the outer
 * `+` runs.
 */
function isStringish(node) {
  const n = unwrap(node);
  if (
    ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n) ||
    ts.isTemplateExpression(n)
  ) {
    return true;
  }
  return (
    ts.isBinaryExpression(n) &&
    n.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    (isStringish(n.left) || isStringish(n.right))
  );
}

/**
 * The first money-named identifier inside a node, or null.
 *
 * Identifiers wherever the parser puts them — an expression, the name half of
 * `revision.grandTotal`, a property key in `{ amount: x }`, a `#private`, or
 * the literal in `row['unitPrice']`. A `.length` access is a count of whatever
 * it is the length of, so the walk does not enter it.
 */
export function moneyWitness(node) {
  let witness = null;
  const visit = (n) => {
    if (witness !== null) return;
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'length') return;
    if ((ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) && MONEY_IDENTIFIER.test(n.text)) {
      witness = n.text;
      return;
    }
    if (
      ts.isElementAccessExpression(n) &&
      ts.isStringLiteralLike(n.argumentExpression) &&
      MONEY_IDENTIFIER.test(n.argumentExpression.text)
    ) {
      witness = n.argumentExpression.text;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return witness;
}

const firstWitness = (nodes) => {
  for (const n of nodes) {
    const w = moneyWitness(n);
    if (w !== null) return w;
  }
  return null;
};

const CLOSURE = 'P1-30 RENDERS SERVER ARITHMETIC ONLY';

/*
 * The messages name the CONSEQUENCE rather than the rule, as check-exact-money
 * does: a developer who hits one needs to know what would break.
 */
const coerced = (what, witness) =>
  `\`${what}\` over a money value (\`${witness}\`): a canonical decimal string that has been ` +
  "through a double is no longer the server's figure — render the string, never coerce it";

const computed = (op, witness) =>
  `\`${op}\` over a money value (\`${witness}\`): ${CLOSURE} — a figure computed on the client ` +
  'is a second source of truth; the server resolves prices, totals, taxes and balances';

const concatenated = (witness) =>
  `\`+\` over a money value (\`${witness}\`) with no string literal on either side: this is ` +
  'addition, not display — put the figure in a template literal if it is text, and let the ' +
  'server add if it is money';

const formatted = (what) =>
  `\`${what}\` inside a P1-30 area: money is formatted exactly once, by formatMoney in ` +
  'apps/web/src/lib/money.ts, and never re-formatted by a screen';

const UNPARSED =
  'does not parse as TypeScript under TS or TSX — refused rather than guessed at (fail closed)';

const ARITHMETIC = new Set([
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
]);

const SIGNS = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);

function judgeCall(node, report) {
  const callee = unwrap(node.expression);

  if (ts.isIdentifier(callee)) {
    if (SANCTIONED_CALLS.includes(callee.text)) return;
    if (!FORBIDDEN_GLOBAL_CALLS.includes(callee.text)) return;
    const witness = firstWitness(node.arguments);
    if (witness !== null) report(node, coerced(`${callee.text}(…)`, witness));
    return;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    const member = callee.name.text;
    const head = unwrap(callee.expression);
    const headName = ts.isIdentifier(head) ? head.text : null;
    if (
      headName === 'Math' ||
      (headName === 'Number' && ['parseFloat', 'parseInt'].includes(member))
    ) {
      const witness = firstWitness(node.arguments);
      if (witness !== null) report(node, coerced(`${headName}.${member}(…)`, witness));
      return;
    }
    if (headName === 'Intl' && member === 'NumberFormat') {
      report(node, formatted('Intl.NumberFormat(…)'));
      return;
    }
    if (member === 'toLocaleString') {
      report(node, formatted('.toLocaleString(…)'));
      return;
    }
    if (FORBIDDEN_MEMBER_CALLS.includes(member)) {
      const witness = moneyWitness(callee.expression) ?? firstWitness(node.arguments);
      if (witness !== null) report(node, coerced(`.${member}(…)`, witness));
    }
    return;
  }

  // `Math['round'](x)` — the computed spelling of the same call.
  if (ts.isElementAccessExpression(callee)) {
    const head = unwrap(callee.expression);
    if (ts.isIdentifier(head) && head.text === 'Math') {
      const witness = firstWitness(node.arguments);
      if (witness !== null) report(node, coerced('Math[…](…)', witness));
    }
  }
}

function judgeNew(node, report) {
  const callee = unwrap(node.expression);
  if (!ts.isPropertyAccessExpression(callee)) return;
  const head = unwrap(callee.expression);
  if (ts.isIdentifier(head) && head.text === 'Intl' && callee.name.text === 'NumberFormat') {
    report(node, formatted('new Intl.NumberFormat(…)'));
  }
}

function judgeUnary(node, report) {
  if (!SIGNS.has(node.operator)) return;
  const witness = moneyWitness(node.operand);
  if (witness !== null) report(node, computed(`unary ${ts.tokenToString(node.operator)}`, witness));
}

function judgeBinary(node, report) {
  const kind = node.operatorToken.kind;
  if (!ARITHMETIC.has(kind) && kind !== ts.SyntaxKind.PlusToken) return;
  const witness = moneyWitness(node.left) ?? moneyWitness(node.right);
  if (witness === null) return;
  if (ARITHMETIC.has(kind)) {
    report(node, computed(ts.tokenToString(kind), witness));
    return;
  }
  if (isStringish(node.left) || isStringish(node.right)) return;
  report(node, concatenated(witness));
}

/**
 * Every violation in one module, as `{ line, col, message }`, 1-based.
 * A source the parser refuses is one violation, at 1:1.
 */
export function judgeSource(source) {
  const file = parseModule(source);
  if (file === null) return [{ line: 1, col: 1, message: UNPARSED }];

  const violations = [];
  const report = (node, message) => {
    const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
    violations.push({ line: line + 1, col: character + 1, message });
  };
  const visit = (node) => {
    if (ts.isCallExpression(node)) judgeCall(node, report);
    else if (ts.isNewExpression(node)) judgeNew(node, report);
    else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      judgeUnary(node, report);
    } else if (ts.isBinaryExpression(node)) judgeBinary(node, report);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Repository-relative when the file is in the repository; app-root-relative otherwise. */
const labelOf = (file, appRoot) => slash(relative(isInside(ROOT, file) ? ROOT : appRoot, file));

function argumentOf(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`::error::${flag} needs a value`);
    process.exit(1);
  }
  return value;
}

function main() {
  const appRoot = resolve(argumentOf('--app-root') ?? DEFAULT_APP_ROOT);
  const minRaw = argumentOf('--min-files') ?? '0';
  if (!/^\d+$/.test(minRaw)) {
    console.error(`::error::--min-files must be a non-negative integer, got \`${minRaw}\``);
    process.exit(1);
  }
  const minFiles = Number(minRaw); // a file count, not an amount

  const entries = p1_30FilesUnder(appRoot);
  const violations = [];
  for (const { file } of entries) {
    const label = labelOf(file, appRoot);
    for (const v of judgeSource(readFileSync(file, 'utf8'))) {
      violations.push(`${label}:${v.line}:${v.col} ${v.message}`);
    }
  }

  const perArea = new Map(P1_30_AREAS.map((area) => [area, 0]));
  for (const { area } of entries) perArea.set(area, perArea.get(area) + 1);
  const populated = [...perArea].filter(([, count]) => count > 0);
  const empty = [...perArea].filter(([, count]) => count === 0).map(([area]) => area);
  const where = isInside(ROOT, appRoot) ? slash(relative(ROOT, appRoot)) : slash(appRoot);

  console.log(
    `P1-30 server arithmetic: ${entries.length} file(s) examined across ${populated.length} ` +
      `P1-30 area(s) of ${P1_30_AREAS.length} listed, under ${where}.`
  );
  for (const [area, count] of populated) console.log(`  ${area}: ${count} file(s)`);
  if (empty.length > 0) {
    console.log(`  ${empty.length} area(s) hold no file yet: ${empty.join(', ')}`);
  }
  if (entries.length === 0) {
    // Said out loud. A silent pass over an empty set is indistinguishable from a
    // pass over a checked one, and only one of those means anything.
    console.log(
      '  ZERO files exist yet — this run proves nothing about any screen. The rule is ARMED so ' +
        'that the first P1-30 screen meets a rule that predates it; its teeth are proved by ' +
        'tests/ci/p1-30-server-arithmetic.test.ts, which plants money arithmetic in every ' +
        'refused shape and requires a red.'
    );
  }
  if (entries.length < minFiles) {
    violations.push(
      `P1-30 server arithmetic ran VACUOUSLY: ${entries.length} file(s) examined where ` +
        `--min-files ${minFiles} requires at least ${minFiles} — a gate that examines nothing ` +
        'proves nothing'
    );
  }

  if (violations.length > 0) {
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
