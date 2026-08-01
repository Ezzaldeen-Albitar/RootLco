#!/usr/bin/env node
/**
 * Exact-money audit (P1-22-SEC-002).
 *
 * PostgreSQL `numeric(18,4)` holds values IEEE-754 cannot represent. A single
 * `Number()`, `parseFloat`, `Math.round` or `toFixed` anywhere on a money path
 * turns an exact amount into an approximation, and the loss is silent,
 * unrepeatable, and invisible in a passing test — the wrong value is still a
 * number, and it is still close.
 *
 * So this is a STRUCTURAL gate rather than a review convention. It refuses the
 * forbidden constructs in the financial source tree by name, and it refuses the
 * subtler ones too: a JSON `number` schema for an amount (which loses the value
 * before any code runs), a unary plus (the shortest possible coercion), and
 * arithmetic applied directly to a money-named identifier.
 *
 * ## Why it scans a NAMED tree rather than all of `src`
 *
 * `Number()` is correct in a hundred places — a row count, a page limit, a
 * retry budget. A gate that banned it everywhere would be turned off within a
 * week, and a gate that is off proves nothing. The scope is the modules and
 * route trees that carry money, listed below, plus the shared money primitives.
 *
 * Widening it later is a one-line change; the list is the reviewable part.
 *
 * ## The one thing this gate cannot see
 *
 * It reads text, so it cannot prove an amount was not approximated INSIDE
 * PostgreSQL — a `::float8` cast in SQL would pass here. That is covered
 * separately: the money columns are `numeric` and their CHECK constraints
 * validate the database's own arithmetic, `pg` returns `numeric` as a string,
 * and no `setTypeParser` override exists. The residual is named rather than
 * implied.
 *
 * Usage: node scripts/ci/check-exact-money.mjs [--json]
 * Exit codes: 0 clean · 1 a forbidden construct was found · 2 IO error.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_SRC_PATH } from '../lib/repository-paths.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const toPosix = (p) => p.split(sep).join('/');

/**
 * The financial surface. Every path that carries an amount, a currency, or a
 * balance — and nothing else, so the gate stays enforceable.
 */
export const MONEY_TREES = Object.freeze([
  `${API_SRC_PATH}/modules/billing`,
  `${API_SRC_PATH}/modules/payments`,
  `${API_SRC_PATH}/modules/delivery`,
  `${API_SRC_PATH}/modules/warranty`,
  `${API_SRC_PATH}/modules/pricing/domain`,
  `${API_SRC_PATH}/app/api/v1/invoices`,
  `${API_SRC_PATH}/app/api/v1/payments`,
  `${API_SRC_PATH}/app/api/v1/payment-methods`,
  `${API_SRC_PATH}/app/api/v1/credit-notes`,
  `${API_SRC_PATH}/app/api/v1/deliveries`,
  `${API_SRC_PATH}/app/api/v1/warranties`,
  `${API_SRC_PATH}/app/api/v1/work-orders/[workOrderId]/invoice-preview`,
]);

/**
 * Each rule is a regex plus why the construct is forbidden.
 *
 * The messages name the CONSEQUENCE rather than the rule, because a developer
 * who hits one needs to know what would break, not that a list exists.
 */
export const RULES = Object.freeze([
  {
    id: 'MONEY-01',
    pattern: /\bNumber\s*\(/,
    why: 'Number() on a numeric(18,4) loses the fourth decimal place for values a double cannot represent. Compare Decimals, or let PostgreSQL do the arithmetic.',
  },
  {
    id: 'MONEY-02',
    pattern: /\bparse(Float|Int)\s*\(/,
    why: 'parseFloat/parseInt approximate, and parseInt additionally truncates at the decimal point — a 100.9500 amount becomes 100.',
  },
  {
    id: 'MONEY-03',
    pattern: /\bMath\.(round|floor|ceil|abs|trunc)\s*\(/,
    why: 'Math.* operates on doubles, so it approximates before it rounds. Rounding is PostgreSQL round(x, 4), inside the same expression the CHECK constraint validates.',
  },
  {
    id: 'MONEY-04',
    pattern: /\.toFixed\s*\(/,
    why: 'toFixed formats a double and is not a decimal operation. Decimal.toString() already renders the exact fixed-scale form.',
  },
  {
    id: 'MONEY-05',
    pattern: /z\.number\s*\(\)|z\.coerce\.number/,
    why: 'A JSON number schema loses the amount before any code runs, because JSON.parse has already produced a double. Money crosses the boundary as a decimal STRING plus an explicit currency.',
  },
  {
    id: 'MONEY-06',
    // A unary plus in expression position: preceded by `(`, `=`, `,`, `[`, `:`
    // or a return, and followed immediately by an identifier.
    pattern: /(?:[(=,[:]|\breturn)\s*\+\s*[A-Za-z_$]/,
    why: 'Unary plus is the shortest possible numeric coercion and is easy to miss in review. It is banned outright on this surface.',
  },
]);

/** Files worth scanning. */
const isSource = (file) => /\.(ts|tsx|mts)$/.test(file);

/**
 * Strips comments so PROSE ABOUT a forbidden construct does not trip the gate.
 *
 * This matters more than it sounds: the honest way to document why `Number()` is
 * not used is to write `Number()` in a comment, and a gate that punished that
 * would push the explanation out of the code. The four P1-22 modules currently
 * mention `Number(` exactly four times, every one of them in a comment saying
 * why it is absent — so without this the gate would report four violations that
 * are the opposite of violations.
 *
 * A single-pass scanner rather than a regex, for the reason recorded in
 * `check-operation-test-coverage.mjs`: a naive `//`-to-end-of-line rule
 * corrupts `'http://…'` and would delete real code.
 */
export function stripComments(source) {
  let out = '';
  let i = 0;
  let prev = '';
  const n = source.length;
  const canPrecedeRegex = (c) => c === '' || '([{,;:=!?&|+-*%~^<>'.includes(c) || c === '\n';

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      prev = quote;
      continue;
    }
    if (c === '/' && canPrecedeRegex(prev)) {
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === '/') {
          i += 1;
          break;
        }
        i += 1;
      }
      prev = '/';
      continue;
    }

    out += c;
    if (!/\s/.test(c)) prev = c;
    else if (c === '\n') prev = '\n';
    i += 1;
  }
  return out;
}

/** Every source file under `tree`, recursively. */
function collect(tree) {
  const abs = join(ROOT, tree);
  if (!existsSync(abs)) return null;
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isSource(entry.name)) files.push(full);
    }
  };
  if (statSync(abs).isDirectory()) walk(abs);
  else files.push(abs);
  return files;
}

/** Pure evaluator, so a fixture can drive it. */
export function audit({ trees, readFile, listFiles }) {
  const findings = [];
  const missing = [];
  let scanned = 0;

  for (const tree of trees) {
    const files = listFiles(tree);
    if (files === null) {
      // A named tree that does not exist is a FAILURE, not a skip. Renaming a
      // module would otherwise silently remove it from the audit and the gate
      // would report clean over a surface it never read.
      missing.push(tree);
      continue;
    }
    for (const file of files) {
      const text = readFile(file);
      if (text === null) continue;
      scanned += 1;
      const visible = stripComments(text);
      const lines = visible.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        for (const rule of RULES) {
          if (rule.pattern.test(line)) {
            findings.push({
              rule: rule.id,
              file,
              line: index + 1,
              text: line.trim().slice(0, 160),
              why: rule.why,
            });
          }
        }
      }
    }
  }

  return { findings, missing, scanned };
}

function runCli() {
  const jsonOutput = process.argv.includes('--json');
  const result = audit({
    trees: MONEY_TREES,
    listFiles: (tree) => {
      const files = collect(tree);
      return files === null ? null : files.map((f) => toPosix(relative(ROOT, f)));
    },
    readFile: (rel) => {
      try {
        return readFileSync(join(ROOT, rel), 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
  });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Exact-money audit: ${result.scanned} file(s) across ${MONEY_TREES.length} declared tree(s)`
    );
    console.log(`Rules: ${RULES.map((r) => r.id).join(', ')}`);
    if (result.scanned === 0) {
      console.error('refusing to report clean over an empty scan');
      process.exit(2);
    }
    for (const tree of result.missing) {
      console.error(`  [MISSING TREE] ${tree} is declared in MONEY_TREES but does not exist`);
    }
    for (const f of result.findings) {
      console.error(`  [${f.rule}] ${f.file}:${f.line}  ${f.text}`);
      console.error(`             ${f.why}`);
    }
    if (result.findings.length === 0 && result.missing.length === 0) {
      console.log('OK: no forbidden numeric construct on the financial surface');
    }
  }

  process.exit(result.findings.length === 0 && result.missing.length === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli();
}
