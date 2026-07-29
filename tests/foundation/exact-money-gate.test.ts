/**
 * Negative fixture for the exact-money gate (P1-22-SEC-002).
 *
 * The gate's whole purpose is to FAIL when a forbidden numeric construct reaches the
 * financial surface. A gate that cannot be shown to fail is indistinguishable from one
 * that always passes — and this one guards a loss that is silent, unrepeatable, and
 * invisible in a passing test, because an approximated amount is still a number and it
 * is still close.
 *
 * So every rule is driven with synthetic source through the pure `audit()` evaluator,
 * and the two behaviours that could quietly hollow the gate out are pinned as well:
 *
 *   1. **Comments are stripped before matching.** The honest way to document why
 *      `Number()` is not used is to write `Number()` in a comment, and a gate that
 *      punished that would push the explanation out of the code. The four P1-22 modules
 *      mention `Number(` exactly four times and every one is a comment saying why it is
 *      absent, so without the strip the gate would report four violations that are the
 *      opposite of violations.
 *   2. **A declared tree that does not exist is a FAILURE, not a skip.** Renaming a
 *      module would otherwise silently remove it from the audit while the gate reported
 *      clean over a surface it never read — which is the shape of every vacuous gate this
 *      repository has had to remediate.
 *
 * It also runs the gate against the REAL financial tree, so a future edit that
 * introduces a coercion fails here as well as in CI.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { MONEY_TREES, RULES, audit, stripComments } from '../../scripts/ci/check-exact-money.mjs';

const ROOT = process.cwd();
const toPosix = (p: string): string => p.split(sep).join('/');

/** Drives the evaluator over one synthetic file. */
const run = (source: string) =>
  audit({
    trees: ['synthetic'],
    listFiles: () => ['synthetic/money.ts'],
    readFile: (file: string) => (file === 'synthetic/money.ts' ? source : null),
  });

describe('exact-money gate — every rule fires on real source', () => {
  it('has the six rules the phase declares, each with a reason a developer can act on', () => {
    expect(RULES.map((rule: { id: string }) => rule.id)).toEqual([
      'MONEY-01',
      'MONEY-02',
      'MONEY-03',
      'MONEY-04',
      'MONEY-05',
      'MONEY-06',
    ]);
    for (const rule of RULES as readonly { id: string; why: string }[]) {
      // The message must say what would BREAK, not merely that a rule exists — a
      // developer who trips one needs to know the consequence.
      expect(rule.why.length, rule.id).toBeGreaterThan(40);
    }
  });

  it('MONEY-01 catches Number() on an amount', () => {
    const { findings } = run('const gross = Number(row.gross_total);');
    expect(findings.map((f: { rule: string }) => f.rule)).toContain('MONEY-01');
  });

  it('MONEY-02 catches parseFloat and parseInt', () => {
    expect(run('const a = parseFloat(row.amount);').findings[0]?.rule).toBe('MONEY-02');
    // parseInt is worse than parseFloat: it truncates at the point, so 100.9500 becomes 100.
    expect(run('const a = parseInt(row.amount, 10);').findings[0]?.rule).toBe('MONEY-02');
  });

  it('MONEY-03 catches every Math.* rounding form', () => {
    for (const call of ['Math.round(x)', 'Math.floor(x)', 'Math.ceil(x)', 'Math.trunc(x)']) {
      expect(run(`const a = ${call};`).findings[0]?.rule, call).toBe('MONEY-03');
    }
  });

  it('MONEY-04 catches toFixed', () => {
    expect(run('const a = total.toFixed(2);').findings[0]?.rule).toBe('MONEY-04');
  });

  it('MONEY-05 catches a JSON number schema, which loses the value before any code runs', () => {
    expect(run('const S = z.object({ amount: z.number() });').findings[0]?.rule).toBe('MONEY-05');
    expect(run('const S = z.coerce.number();').findings[0]?.rule).toBe('MONEY-05');
  });

  it('MONEY-06 catches a unary plus, the shortest possible coercion', () => {
    expect(run('const a = +row.amount;').findings[0]?.rule).toBe('MONEY-06');
    expect(run('return +total;').findings[0]?.rule).toBe('MONEY-06');
  });

  it('does NOT mistake ordinary addition for a unary plus', () => {
    // `a + b` is not a coercion, and a gate that flagged it would be turned off. The
    // rule requires the `+` to sit in expression position, after `(`, `=`, `,`, `[`,
    // `:` or `return`.
    expect(run('const label = prefix + suffix;').findings).toEqual([]);
    expect(run("const s = 'a' + 'b';").findings).toEqual([]);
  });
});

describe('exact-money gate — prose about a forbidden construct is not a violation', () => {
  it('ignores Number() inside a line comment', () => {
    expect(run('// never use Number() here\nconst a = 1;').findings).toEqual([]);
  });

  it('ignores Number() inside a block comment', () => {
    expect(run('/* Number(x) would lose the fourth decimal */\nconst a = 1;').findings).toEqual([]);
  });

  it('ignores Number() inside JSDoc, which is where the explanation belongs', () => {
    const source =
      '/**\n * `amount > 0`, decided by Decimal. Never by Number().\n */\nconst a = 1;';
    expect(run(source).findings).toEqual([]);
  });

  it('does not corrupt a URL while stripping, which would delete real code', () => {
    const source = "const R = 'http://localhost/api/v1/payments';";
    expect(stripComments(source)).toBe(source);
  });

  it('still catches a violation on the same line as a trailing comment', () => {
    // The strip must remove the comment WITHOUT swallowing the code before it.
    const { findings } = run('const a = Number(x); // wrong, and the gate must say so');
    expect(findings.map((f: { rule: string }) => f.rule)).toContain('MONEY-01');
  });
});

describe('exact-money gate — a surface it cannot read is never reported clean', () => {
  it('FAILS when a declared tree does not exist', () => {
    const result = audit({
      trees: ['src/modules/billing-renamed'],
      listFiles: () => null,
      readFile: () => null,
    });
    expect(result.missing).toEqual(['src/modules/billing-renamed']);
  });

  it('reports zero files scanned when every tree is missing, so the CLI can refuse', () => {
    const result = audit({ trees: ['nowhere'], listFiles: () => null, readFile: () => null });
    expect(result.scanned).toBe(0);
  });
});

describe('exact-money gate — the real financial surface', () => {
  /** The same file walk the CLI performs, so this test reads what CI reads. */
  const listFiles = (tree: string): string[] | null => {
    const abs = join(ROOT, tree);
    if (!existsSync(abs)) return null;
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name)) files.push(full);
      }
    };
    if (statSync(abs).isDirectory()) walk(abs);
    else files.push(abs);
    return files.map((f) => toPosix(relative(ROOT, f)));
  };

  const readFile = (rel: string): string | null => {
    const abs = join(ROOT, rel);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };

  it('every declared money tree exists', () => {
    const result = audit({ trees: MONEY_TREES, listFiles, readFile });
    expect(result.missing).toEqual([]);
  });

  it('scans a surface large enough for the result to mean something', () => {
    const result = audit({ trees: MONEY_TREES, listFiles, readFile });
    // Not an exact pin — the tree grows. But a collapse to a handful of files would
    // mean the walk broke, and a clean result over four files is not evidence.
    expect(result.scanned).toBeGreaterThan(30);
  });

  it('finds no forbidden numeric construct on the financial surface', () => {
    const result = audit({ trees: MONEY_TREES, listFiles, readFile });
    expect(result.findings).toEqual([]);
  });
});
