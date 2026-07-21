/**
 * Proves the boundary checker fails on a real violation, not just that it runs.
 *
 * A guard nobody has ever seen fail is indistinguishable from a guard that
 * silently matches nothing — and this one is easy to break by accident, because a
 * single mistyped regex turns every rule into a no-op that still exits 0 and
 * still prints "OK". So the checker is pointed at a throwaway tree containing
 * deliberate violations and is required to reject it, and only then pointed at
 * the real `src` and required to accept it.
 *
 * The fixture is written to the OS temp directory rather than into the
 * repository: a violating file committed under `src/` would fail the very check
 * it is meant to exercise.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHECKER = join('scripts', 'check-module-boundaries.mjs');

interface Violation {
  readonly rule: string;
  readonly file: string;
  readonly message: string;
}

interface CheckerReport {
  readonly scanned: number;
  readonly violations: readonly Violation[];
}

function runChecker(scanDir?: string): { status: number | null; report: CheckerReport } {
  const args = [CHECKER, '--json'];
  if (scanDir !== undefined) args.push('--scan-dir', scanDir);

  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.error) throw result.error;
  return { status: result.status, report: JSON.parse(result.stdout) as CheckerReport };
}

function write(root: string, relativePath: string, source: string): void {
  const target = join(root, ...relativePath.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, source, 'utf8');
}

let fixture: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'rootlco-boundary-'));

  // B1: one module reaching into another module's internals.
  write(
    fixture,
    'modules/alpha/index.ts',
    "import { secret } from '@/modules/beta/data/secret';\nexport const alpha = secret;\n"
  );
  write(fixture, 'modules/beta/data/secret.ts', "export const secret = 'internal';\n");
  write(fixture, 'modules/beta/index.ts', "export { secret } from './data/secret';\n");

  // B4: a Route Handler reaching past the application service into data access.
  write(
    fixture,
    'app/api/v1/alpha/route.ts',
    "import { withTransaction } from '@/server/db/transaction';\nexport const runtime = 'nodejs';\nexport const handler = withTransaction;\n"
  );

  // B5: a domain layer reaching the database.
  write(
    fixture,
    'modules/x/domain/rule.ts',
    "import { withTransaction } from '@/server/db/transaction';\nexport const rule = withTransaction;\n"
  );

  // A clean file, so a passing rule set is not simply matching everything.
  write(
    fixture,
    'modules/alpha/domain/pure-rule.ts',
    'export const price = (n: number) => n * 2;\n'
  );
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('module-boundary checker against a deliberately violating tree', () => {
  it('exits non-zero', () => {
    expect(runChecker(fixture).status).not.toBe(0);
  });

  it('reports the deep-import, handler-data-access, and domain-database violations', () => {
    const { report } = runChecker(fixture);
    const rules = new Set(report.violations.map((violation) => violation.rule));

    expect(report.violations.length).toBeGreaterThan(0);
    expect([...rules].some((rule) => rule.startsWith('B1'))).toBe(true);
    expect([...rules].some((rule) => rule.startsWith('B4'))).toBe(true);
    expect([...rules].some((rule) => rule.startsWith('B5'))).toBe(true);
  });

  it('names the offending file for each violation', () => {
    const { report } = runChecker(fixture);
    const files = report.violations.map((violation) => violation.file);

    expect(files).toContain('modules/alpha/index.ts');
    expect(files).toContain('app/api/v1/alpha/route.ts');
    expect(files).toContain('modules/x/domain/rule.ts');
    // The clean file is not accused of anything.
    expect(files).not.toContain('modules/alpha/domain/pure-rule.ts');
  });

  it('scans the whole fixture tree, so the result is not an empty pass', () => {
    expect(runChecker(fixture).report.scanned).toBe(6);
  });
});

describe('module-boundary checker against the real source tree', () => {
  it('exits zero with no violations', () => {
    const { status, report } = runChecker();
    expect(report.violations).toEqual([]);
    expect(status).toBe(0);
    expect(report.scanned).toBeGreaterThan(0);
  });
});
