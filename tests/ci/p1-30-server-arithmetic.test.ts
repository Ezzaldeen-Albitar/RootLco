/**
 * The red-proof for `check-p1-30-server-arithmetic.mjs` (P1-30 A0).
 *
 * The gate examines ZERO files today, because P1-30 has no screens yet. A pass
 * over an empty set is worth nothing, so its teeth are proved here: money
 * arithmetic is PLANTED under a scratch app root in each shape the closure
 * condition refuses — `P1-30 RENDERS SERVER ARITHMETIC ONLY` — and the gate is
 * required to go red on every one, with a file, a line and a column.
 *
 * ## What the cases pin
 *
 *   - the rule is stated over the AST, so a comment quoting `subtotal + tax`
 *     and a string holding `total * 2` are not violations, and a file the
 *     parser refuses IS one;
 *   - `+` beside a string literal is display and passes, while `subtotal + tax`
 *     is a client-side total and fails;
 *   - the sanctioned path — every function `apps/web/src/lib/money.ts`
 *     exports — takes money arguments without tripping the gate, and the
 *     constant that names it is pinned to the module's real export surface;
 *   - files outside every P1-30 area, test files and declaration files are not
 *     examined, and the gate says how many files it did examine;
 *   - `--min-files` turns an empty run into a red, and the default of 0 does
 *     not — so A0 can wire the gate in before the first screen lands.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import {
  FORBIDDEN_GLOBAL_CALLS,
  FORBIDDEN_MEMBER_CALLS,
  MONEY_IDENTIFIER,
  P1_30_AREAS,
  SANCTIONED_CALLS,
  areaOf,
  judgeSource,
} from '../../scripts/ci/check-p1-30-server-arithmetic.mjs';
import { hasExportModifier, parseModule } from '../../scripts/lib/typescript-source.mjs';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts', 'ci', 'check-p1-30-server-arithmetic.mjs');
const MONEY_MODULE = join(ROOT, 'apps', 'web', 'src', 'lib', 'money.ts');

let scratch = '';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'p130-arith-'));
});
afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

function run(appRoot: string, ...extra: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [GATE, '--app-root', appRoot, ...extra], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Plant one source file at `area/file` under a fresh app root. */
function plant(name: string, area: string, file: string, source: string): string {
  const appRoot = join(scratch, name);
  const dir = join(appRoot, ...area.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), source);
  return appRoot;
}

/** Rows joined with LF, so a case can say which LINE it expects a red on. */
const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

const QUOTATIONS = 'features/quotations';
const INVOICES = 'app/[locale]/(dashboard)/invoices';

/**
 * A clean quotation screen: every sanctioned function called with money, a
 * comparison, a `.length`, a template literal and a literal-prefixed `+`. None
 * of it is arithmetic.
 */
const CLEAN = lines(
  'import {',
  '  compareMoney,',
  '  formatMoney,',
  '  isCanonicalMoney,',
  '  isNegativeMoney,',
  '  isZeroMoney,',
  '  parseMoneyInput,',
  '  toCanonicalMoney,',
  '  trimTrailingZeros,',
  "} from '@/lib/money';",
  '',
  'export function QuotationTotals({ revision, previous, locale }) {',
  '  const currency = revision.currency;',
  '  const grew = compareMoney(revision.grandTotal, previous.grandTotal) > 0;',
  '  const unchanged = revision.grandTotal === previous.grandTotal;',
  '  const lastDiscount = revision.discounts.length - 1;',
  '  const rows = revision.lines.map((line) => `${line.description}: ${line.lineTotal} ${currency}`);',
  '  const typed = parseMoneyInput(revision.discountTotal);',
  "  const compact = typed.ok ? trimTrailingZeros(toCanonicalMoney(revision.discountTotal)) : '';",
  "  const heading = 'Total: ' + revision.grandTotal;",
  '  return (',
  '    <section>',
  '      <h2>{heading}</h2>',
  '      <p>{formatMoney({ amount: revision.grandTotal, currency }, locale)}</p>',
  "      <p>{grew ? 'up' : unchanged ? 'same' : 'down'}</p>",
  "      <p>{isZeroMoney(revision.discountTotal) ? 'no discount' : compact}</p>",
  "      <p>{isNegativeMoney(revision.balance) ? 'credit' : 'due'}</p>",
  '      <p>{isCanonicalMoney(revision.taxTotal) ? rows[lastDiscount] : null}</p>',
  '    </section>',
  '  );',
  '}'
);

describe('the armed rule has teeth before any screen exists', () => {
  it('a clean quotation screen passes, and the run says it examined one file', () => {
    const { code, out } = run(plant('clean', QUOTATIONS, 'quotation-totals.tsx', CLEAN));
    expect(out).toMatch(/1 file\(s\) examined across 1 P1-30 area\(s\)/);
    expect(out).toMatch(/features\/quotations: 1 file\(s\)/);
    expect(out).toMatch(/0 violation\(s\)\./);
    expect(code).toBe(0);
  });

  it('`Number(revision.grandTotal)` is refused, with file, line and column', () => {
    const app = plant(
      'number',
      QUOTATIONS,
      'coerce.ts',
      lines(
        'export function toNumber(revision: { grandTotal: string }) {',
        '  return Number(revision.grandTotal);',
        '}'
      )
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(
      /::error::features\/quotations\/coerce\.ts:2:10 `Number\(…\)` over a money value \(`grandTotal`\)/
    );
    expect(out).toMatch(/1 violation\(s\)\./);
  });

  it('`subtotal + tax` is refused — it is the client-side total the phase forbids', () => {
    const app = plant(
      'addition',
      'features/pricing',
      'sum.ts',
      lines(
        'export function sum(subtotal: string, tax: string) {',
        '  const total = subtotal + tax;',
        '  return total;',
        '}'
      )
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(
      /::error::features\/pricing\/sum\.ts:2:17 `\+` over a money value \(`subtotal`\) with no string literal on either side/
    );
  });

  it("`'Total: ' + total` is allowed — a string operand makes `+` display, not addition", () => {
    const app = plant(
      'label',
      'features/pricing',
      'label.ts',
      lines('export function label(total: string) {', "  return 'Total: ' + total;", '}')
    );
    const { code, out } = run(app);
    expect(out).toMatch(/1 file\(s\) examined/);
    expect(out).toMatch(/0 violation\(s\)\./);
    expect(code).toBe(0);
  });

  it('`price * quantity` is refused', () => {
    const app = plant(
      'multiply',
      'features/services',
      'line.ts',
      'export const lineTotal = (price: string, quantity: number) => price * quantity;\n'
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/line\.ts:1:63 `\*` over a money value \(`price`\)/);
  });

  it('`amount.toFixed(2)` and `Math.round(balance)` are refused', () => {
    const fixed = run(
      plant(
        'to-fixed',
        'features/billing',
        'fixed.ts',
        'export const shown = (amount: string) => amount.toFixed(2);\n'
      )
    );
    expect(fixed.code).not.toBe(0);
    expect(fixed.out).toMatch(/fixed\.ts:1:42 `\.toFixed\(…\)` over a money value \(`amount`\)/);

    const rounded = run(
      plant(
        'math-round',
        'features/payments',
        'round.ts',
        'export const rounded = (balance: number) => Math.round(balance);\n'
      )
    );
    expect(rounded.code).not.toBe(0);
    expect(rounded.out).toMatch(
      /round\.ts:1:45 `Math\.round\(…\)` over a money value \(`balance`\)/
    );
  });

  it('`new Intl.NumberFormat(locale).format(x)` in an area is refused — formatting lives in lib/money', () => {
    const app = plant(
      'intl',
      'features/inventory',
      'format.ts',
      lines(
        'export function shown(locale: string, x: number) {',
        '  return new Intl.NumberFormat(locale).format(x);',
        '}'
      )
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(
      /format\.ts:2:10 `new Intl\.NumberFormat\(…\)` inside a P1-30 area: money is formatted exactly once, by formatMoney/
    );
  });

  it('a P1-30 ROUTE PAGE is examined too, and `balance - paid` on it is refused', () => {
    const app = plant(
      'route',
      INVOICES,
      'page.tsx',
      lines(
        'export default async function Page({ params }) {',
        '  const invoice = await readInvoice(await params);',
        '  const due = invoice.balance - invoice.paid;',
        '  return <Screen due={due} />;',
        '}'
      )
    );
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(/app\/\[locale\]\/\(dashboard\)\/invoices: 1 file\(s\)/);
    expect(out).toMatch(/invoices\/page\.tsx:3:15 `-` over a money value \(`balance`\)/);
  });

  it('a file outside every P1-30 area is not this gate’s business', () => {
    const app = plant(
      'foreign',
      'features/receptions',
      'total.ts',
      'export const n = (total: string) => Number(total);\n'
    );
    writeFileSync(join(app, 'features', 'receptions', 'money.ts'), 'export const x = total * 2;\n');
    const { code, out } = run(app);
    expect(code).toBe(0);
    expect(out).toMatch(/0 file\(s\) examined across 0 P1-30 area\(s\)/);
  });

  it('a test file and a declaration file under an area are skipped', () => {
    const app = plant(
      'skipped',
      'features/pricing',
      'price.test.ts',
      "it('x', () => { expect(Number(price)).toBe(1); });\n"
    );
    writeFileSync(
      join(app, 'features', 'pricing', 'price.d.ts'),
      'declare function resolvePrice(price: string): number;\n'
    );
    const { code, out } = run(app);
    expect(code).toBe(0);
    expect(out).toMatch(/0 file\(s\) examined/);
  });

  it('a file that does not parse is refused rather than skipped (fail closed)', () => {
    const app = plant('broken', QUOTATIONS, 'broken.ts', 'export const total = ;\n');
    const { code, out } = run(app);
    expect(code).not.toBe(0);
    expect(out).toMatch(
      /::error::features\/quotations\/broken\.ts:1:1 does not parse as TypeScript/
    );
  });

  it('every listed area is examined: one violation planted in each yields one red each', () => {
    const appRoot = join(scratch, 'all-areas');
    for (const area of P1_30_AREAS) {
      const dir = join(appRoot, ...area.split('/'));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'figure.ts'), 'export const total = subtotal + tax;\n');
    }
    const { code, out } = run(appRoot);
    expect(code).not.toBe(0);
    expect(out).toMatch(
      new RegExp(
        `${P1_30_AREAS.length} file\\(s\\) examined across ${P1_30_AREAS.length} P1-30 area\\(s\\)`
      )
    );
    expect(out).toMatch(new RegExp(`${P1_30_AREAS.length} violation\\(s\\)\\.`));
    for (const area of P1_30_AREAS) {
      expect(out, `${area} must be examined`).toContain(`${area}/figure.ts:1:22`);
    }
  });
});

describe('the rule, stated over the AST rather than over text', () => {
  const refused: [string, RegExp][] = [
    ['const n = Number(revision.grandTotal);', /`Number\(…\)` over a money value \(`grandTotal`\)/],
    [
      'const n = parseFloat(line.unitPrice);',
      /`parseFloat\(…\)` over a money value \(`unitPrice`\)/,
    ],
    ['const n = parseInt(amount, 10);', /`parseInt\(…\)` over a money value \(`amount`\)/],
    ['const n = BigInt(balance);', /`BigInt\(…\)` over a money value \(`balance`\)/],
    ['const n = Number.parseFloat(balance);', /`Number\.parseFloat\(…\)`/],
    ['const n = Math.round(balance);', /`Math\.round\(…\)` over a money value \(`balance`\)/],
    ['const n = Math.max(...items.map((i) => i.remaining));', /`Math\.max\(…\)`.*`remaining`/],
    ["const n = Math['floor'](outstanding);", /`Math\[…\]\(…\)`.*`outstanding`/],
    ['const s = amount.toFixed(2);', /`\.toFixed\(…\)` over a money value \(`amount`\)/],
    ['const s = x.toPrecision(taxRate);', /`\.toPrecision\(…\)` over a money value \(`taxRate`\)/],
    ['const t = subtotal + tax;', /`\+` over a money value \(`subtotal`\) with no string literal/],
    // Not arithmetic — but the gate cannot tell, and a template literal costs nothing.
    [
      'const t = formatMoney({ amount: total, currency }, locale) + suffix;',
      /`\+` over a money value \(`amount`\) with no string literal/,
    ],
    ['const t = price * quantity;', /`\*` over a money value \(`price`\)/],
    ['const t = total / 2;', /`\/` over a money value \(`total`\)/],
    ['const t = balance - paid;', /`-` over a money value \(`balance`\)/],
    ['const t = amount % 2;', /`%` over a money value \(`amount`\)/],
    ['const t = amount ** 2;', /`\*\*` over a money value \(`amount`\)/],
    ['running += line.lineTotal;', /`\+=` over a money value \(`lineTotal`\)/],
    ['total -= 1;', /`-=` over a money value \(`total`\)/],
    ['const n = -amount;', /`unary -` over a money value \(`amount`\)/],
    ['const n = +revision.total;', /`unary \+` over a money value \(`total`\)/],
    ['balance++;', /`unary \+\+` over a money value \(`balance`\)/],
    ["const n = row['grandTotal'] * 2;", /`\*` over a money value \(`grandTotal`\)/],
    [
      'const f = new Intl.NumberFormat(locale).format(x);',
      /`new Intl\.NumberFormat\(…\)` inside a P1-30 area/,
    ],
    [
      'const f = Intl.NumberFormat(locale).format(x);',
      /`Intl\.NumberFormat\(…\)` inside a P1-30 area/,
    ],
    ['const s = amount.toLocaleString(locale);', /`\.toLocaleString\(…\)` inside a P1-30 area/],
    ['export const total = ;', /does not parse as TypeScript under TS or TSX/],
  ];

  it.each(refused)('%s is refused', (source, pattern) => {
    const found = judgeSource(source);
    expect(found.length, source).toBeGreaterThan(0);
    expect(found.map((v: { message: string }) => v.message).join('\n')).toMatch(pattern);
  });

  const allowed: string[] = [
    "const label = 'Total: ' + total;",
    'const label = `${line.lineTotal} ${currency}`;',
    "const label = 'Total: ' + subtotal + tax;",
    "const label = ('Total: ') + grandTotal;",
    'const same = a.grandTotal === b.grandTotal;',
    'const less = a.balance < b.balance;',
    'const last = discounts.length - 1;',
    'const n = Number(page);',
    'const q = quantity * 2;',
    'const i = index - 1;',
    'const ok = compareMoney(a.total, b.total) > 0;',
    'const s = formatMoney({ amount: revision.grandTotal, currency }, locale);',
    'const c = toCanonicalMoney(input.amount);',
    'const z = isZeroMoney(line.discount) || isNegativeMoney(line.balance);',
    'const t = trimTrailingZeros(price);',
    'const v = parseMoneyInput(raw).ok && isCanonicalMoney(raw);',
    'const negative = !isNegativeMoney(amount);',
    '// const wrong = subtotal + tax; Number(total); amount.toFixed(2)',
    '/** the rule: no `subtotal + tax`, no `Number(total)`, no `Math.round(balance)` */ export const x = 1;',
    "const prose = 'total * 2 and Number(price) and new Intl.NumberFormat(locale)';",
    'const prose = `${label}: total * 2`;',
  ];

  it.each(allowed)('%s is allowed', (source) => {
    expect(judgeSource(source), source).toEqual([]);
  });

  it('`Number()` over a NON-money name is not this gate’s business, so the rule stays enforceable', () => {
    // check-exact-money.mjs says why: a gate that bans Number() everywhere is
    // turned off within a week, and a gate that is off proves nothing.
    expect(
      judgeSource('const limit = Number(searchParams.limit); const n = parseInt(page, 10);')
    ).toEqual([]);
  });
});

describe('the constants the rule is made of', () => {
  it('names the six feature trees and the six dashboard segments, by name', () => {
    expect([...P1_30_AREAS]).toEqual([
      'features/services',
      'features/pricing',
      'features/quotations',
      'features/inventory',
      'features/billing',
      'features/payments',
      'app/[locale]/(dashboard)/services',
      'app/[locale]/(dashboard)/pricing',
      'app/[locale]/(dashboard)/quotations',
      'app/[locale]/(dashboard)/inventory',
      'app/[locale]/(dashboard)/invoices',
      'app/[locale]/(dashboard)/payments',
    ]);
  });

  it('claims a path by area and leaves the money module itself outside', () => {
    expect(areaOf('features/quotations/quotation-detail.tsx')).toBe('features/quotations');
    expect(areaOf('app/[locale]/(dashboard)/invoices/[invoiceId]/page.tsx')).toBe(
      'app/[locale]/(dashboard)/invoices'
    );
    expect(areaOf('features/receptions/reception-detail.tsx')).toBeNull();
    // The one sanctioned `Intl.NumberFormat` lives here, and the gate must
    // never reach it — that is what "outside the areas" means.
    expect(areaOf('lib/money.ts')).toBeNull();
    expect(areaOf('app/[locale]/(dashboard)/receptions/page.tsx')).toBeNull();
  });

  it('the money vocabulary matches each word in any casing, and none of the innocent ones', () => {
    for (const word of [
      'amount',
      'price',
      'total',
      'subtotal',
      'tax',
      'discount',
      'balance',
      'cost',
      'allocated',
      'remaining',
      'outstanding',
      'valuation',
      'net',
      'gross',
      'unitPrice',
      'lineTotal',
      'grandTotal',
      'TAX_RATE',
      'outstandingBalance',
      'unit_price',
    ]) {
      expect(MONEY_IDENTIFIER.test(word), `${word} must read as money`).toBe(true);
    }
    for (const word of [
      'quantity',
      'currency',
      'locale',
      'id',
      'description',
      'length',
      'page',
      'seq',
    ]) {
      expect(MONEY_IDENTIFIER.test(word), `${word} must NOT read as money`).toBe(false);
    }
  });

  it('the sanctioned calls are exactly the functions apps/web/src/lib/money.ts exports', () => {
    // Pinned to the real module rather than restated: a function added to the
    // sanctioned path is added here or this case says so, and a name here that
    // the module no longer exports is a sanction for nothing.
    const file = parseModule(readFileSync(MONEY_MODULE, 'utf8'));
    expect(file, 'lib/money.ts must parse').not.toBeNull();
    const exported = (file as ts.SourceFile).statements
      .filter(
        (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && hasExportModifier(s)
      )
      .map((s) => s.name?.text ?? '')
      .sort();
    expect([...SANCTIONED_CALLS].sort()).toEqual(exported);
  });

  it('the forbidden vocabulary and the sanctioned one do not overlap', () => {
    for (const name of [...FORBIDDEN_GLOBAL_CALLS, ...FORBIDDEN_MEMBER_CALLS]) {
      expect(SANCTIONED_CALLS, `${name} cannot be both`).not.toContain(name);
    }
    expect(FORBIDDEN_GLOBAL_CALLS).toEqual(['Number', 'parseFloat', 'parseInt', 'BigInt']);
    expect(FORBIDDEN_MEMBER_CALLS).toEqual(['toFixed', 'toPrecision']);
  });
});

describe('the empty set is reported, never passed off as proof', () => {
  it('says out loud that a zero-file run proves nothing, and passes by default', () => {
    const empty = join(scratch, 'empty');
    mkdirSync(join(empty, 'features', 'receptions'), { recursive: true });
    const { code, out } = run(empty);
    expect(code).toBe(0);
    expect(out).toMatch(/0 file\(s\) examined across 0 P1-30 area\(s\)/);
    expect(out).toMatch(/ZERO files exist yet — this run proves nothing about any screen/);
    expect(out).toMatch(/ARMED/);
  });

  it('`--min-files 1` turns the same run into a red for vacuity', () => {
    const empty = join(scratch, 'empty-min');
    mkdirSync(empty, { recursive: true });
    const { code, out } = run(empty, '--min-files', '1');
    expect(code).not.toBe(0);
    expect(out).toMatch(
      /::error::P1-30 server arithmetic ran VACUOUSLY: 0 file\(s\) examined where --min-files 1 requires at least 1/
    );
  });

  it('`--min-files` refuses a value that is not a count', () => {
    const { code, out } = run(join(scratch, 'empty-min'), '--min-files', 'one');
    expect(code).not.toBe(0);
    expect(out).toMatch(/--min-files must be a non-negative integer/);
  });

  it('the REAL tree passes today, and the run states how many files it examined', () => {
    // Deliberately NOT pinned to zero: W1 will land the first P1-30 screen and
    // this case must keep describing the live tree rather than a fixture the
    // repository moved past — the P1-29 sibling had to be repointed for that.
    const { code, out } = run(join(ROOT, 'apps', 'web', 'src'));
    expect(code).toBe(0);
    expect(out).toMatch(
      /P1-30 server arithmetic: \d+ file\(s\) examined across \d+ P1-30 area\(s\)/
    );
    expect(out).toMatch(/0 violation\(s\)\./);
  });
});
