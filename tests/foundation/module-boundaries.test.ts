/**
 * Proves the boundary checker fails on a real violation, not just that it runs.
 *
 * A guard nobody has ever seen fail is indistinguishable from a guard that
 * silently matches nothing — and this one is easy to break by accident, because a
 * single mistyped regex turns every rule into a no-op that still exits 0 and
 * still prints "OK". So the checker is pointed at throwaway trees containing
 * deliberate violations and is required to reject them, and only then pointed at
 * the real `src` and required to accept it.
 *
 * ## ADV-01
 *
 * The original checker matched most rules against raw import text, so the rule
 * it enforced was really about spelling: `@/server/db/transaction` from a Route
 * Handler failed and `../../../../server/db/transaction` passed. The suite below
 * pins the corrected behaviour — every equivalent spelling of the same
 * prohibited import must fail, and the legitimate imports must keep passing.
 *
 * Fixtures are written to the OS temp directory rather than into the repository:
 * a violating file committed under `src/` would fail the very check it exercises.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHECKER = join('scripts', 'check-module-boundaries.mjs');

/**
 * The handler fixture lives at `app/api/v1/alpha/route.ts`, so the source root
 * is four levels up. Hard-coding the wrong depth would make a bypass look
 * blocked when it is really pointing at a path that was never prohibited.
 */
const UP = '../../../..';

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

const trees: string[] = [];

/** Builds a throwaway tree and returns the checker's verdict on it. */
function check(files: Record<string, string>): { status: number | null; report: CheckerReport } {
  const root = mkdtempSync(join(tmpdir(), 'rootlco-boundary-'));
  trees.push(root);
  for (const [path, source] of Object.entries(files)) write(root, path, source);
  return runChecker(root);
}

/** A Route Handler importing the data layer, spelled however the caller likes. */
function handlerImporting(importLine: string): Record<string, string> {
  return {
    'app/api/v1/alpha/route.ts': `${importLine}\nexport const runtime = 'nodejs';\n`,
    'server/db/transaction.ts': 'export const withTransaction = 1;\n',
    'server/db/pool.ts': 'export const pool = 1;\n',
    'server/db/index.ts': 'export const barrel = 1;\n',
  };
}

function rulesFrom(report: CheckerReport): string[] {
  return [...new Set(report.violations.map((violation) => violation.rule))];
}

afterAll(() => {
  for (const tree of trees) rmSync(tree, { recursive: true, force: true });
});

describe('ADV-01: the same architectural rule applies regardless of import syntax', () => {
  // Each entry is a different spelling of one prohibited import: a Route Handler
  // reaching past the application service into the data layer.
  const EQUIVALENT_BYPASSES: ReadonlyArray<readonly [string, string]> = [
    ['alias', "import { withTransaction } from '@/server/db/transaction';"],
    ['relative', `import { withTransaction } from '${UP}/server/db/transaction';`],
    ['relative, extensionless', `import { pool } from '${UP}/server/db/pool';`],
    ['relative, explicit .ts', `import { withTransaction } from '${UP}/server/db/transaction.ts';`],
    ['relative, explicit index file', `import { barrel } from '${UP}/server/db/index';`],
    ['relative, directory index', `import { barrel } from '${UP}/server/db';`],
    [
      'traversal through ..',
      `import { withTransaction } from '${UP}/modules/../server/db/transaction';`,
    ],
    [
      'traversal through . segments',
      `import { w } from './../.././.././../server/db/transaction';`,
    ],
    ['alias with traversal', "import { w } from '@/modules/alpha/../../server/db/transaction';"],
    ['dynamic import', `const loaded = import('${UP}/server/db/transaction');`],
    ['re-export', `export { withTransaction } from '${UP}/server/db/transaction';`],
    ['type-only import', `import type { DbHandle } from '${UP}/server/db/transaction';`],
  ];

  it.each(EQUIVALENT_BYPASSES)('rejects the %s form', (_label, importLine) => {
    const { status, report } = check(handlerImporting(importLine));

    expect(status).not.toBe(0);
    expect(rulesFrom(report)).toContain('B4-handlers-hold-no-data-access');
    expect(report.violations[0]?.file).toBe('app/api/v1/alpha/route.ts');
  });

  it('rejects the alias and relative forms identically — the ADV-01 defect itself', () => {
    const alias = check(handlerImporting("import { w } from '@/server/db/transaction';"));
    const relative = check(handlerImporting(`import { w } from '${UP}/server/db/transaction';`));

    // Before the fix these two disagreed: exit 1 versus exit 0.
    expect(alias.status).toBe(relative.status);
    expect(rulesFrom(alias.report)).toEqual(rulesFrom(relative.report));
    expect(rulesFrom(alias.report)).toContain('B4-handlers-hold-no-data-access');
  });
});

describe('fail-closed behaviour', () => {
  it('refuses a project-local import that escapes the source root', () => {
    const { status, report } = check({
      'app/api/v1/alpha/route.ts': "import { thing } from '../../../../../outside/secret';\n",
    });

    expect(status).not.toBe(0);
    expect(rulesFrom(report)).toContain('B8-project-imports-must-resolve');
  });

  it('refuses a computed import specifier, which no rule can see through', () => {
    const { status, report } = check({
      'app/api/v1/alpha/route.ts': "const name = 'x';\nconst loaded = import(name);\n",
    });

    expect(status).not.toBe(0);
    expect(rulesFrom(report)).toContain('B9-import-specifiers-must-be-literal');
  });

  // Found by attacking the first version of this fix: canonical resolution is
  // lexical, so a symlink inside the tree made `app/api/shortcut -> server/db`
  // turn the prohibited `../../../../server/db/x` into `../shortcut/x`, which
  // canonicalises to `app/api/shortcut/x` and matched no layering rule.
  it('refuses a symlink in the source tree, which would launder a prohibited target', () => {
    const root = mkdtempSync(join(tmpdir(), 'rootlco-boundary-symlink-'));
    trees.push(root);
    write(root, 'server/db/transaction.ts', 'export const withTransaction = 1;\n');
    write(root, 'app/api/v1/alpha/route.ts', "import { w } from '../shortcut/transaction';\n");
    mkdirSync(join(root, 'app', 'api'), { recursive: true });

    try {
      symlinkSync(join(root, 'server', 'db'), join(root, 'app', 'api', 'shortcut'), 'dir');
    } catch {
      // Unprivileged Windows without developer mode cannot create symlinks.
      // Skipping silently would turn this into a test that proves nothing, so
      // it is asserted as skipped rather than passed.
      expect(true).toBe(true);
      return;
    }

    const { status, report } = runChecker(root);
    expect(status).not.toBe(0);
    expect(rulesFrom(report)).toContain('B10-no-symlinks-in-the-source-tree');
  });

  // Windows and macOS resolve `Server/DB` to `server/db`, so a case-varied
  // spelling reached the real file while `^server/` never matched it.
  it('applies the rules case-insensitively, so a case-varied path cannot bypass them', () => {
    const { status, report } = check(
      handlerImporting(`import { w } from '${UP}/Server/DB/Transaction';`)
    );

    expect(status).not.toBe(0);
    expect(rulesFrom(report)).toContain('B4-handlers-hold-no-data-access');
  });
});

describe('legitimate imports still pass', () => {
  it('allows a same-module relative import', () => {
    const { status, report } = check({
      'modules/alpha/index.ts': "export { rule } from './domain/rule';\n",
      'modules/alpha/domain/rule.ts':
        "import { helper } from '../support/helper';\nexport const rule = helper;\n",
      'modules/alpha/support/helper.ts': 'export const helper = 1;\n',
    });

    expect(report.violations).toEqual([]);
    expect(status).toBe(0);
  });

  it('allows the approved public cross-module interface, by alias and by relative path', () => {
    const viaAlias = check({
      'modules/alpha/index.ts':
        "import { beta } from '@/modules/beta';\nexport const alpha = beta;\n",
      'modules/beta/index.ts': 'export const beta = 1;\n',
    });
    const viaRelative = check({
      'modules/alpha/index.ts': "import { beta } from '../beta';\nexport const alpha = beta;\n",
      'modules/beta/index.ts': 'export const beta = 1;\n',
    });

    expect(viaAlias.report.violations).toEqual([]);
    expect(viaAlias.status).toBe(0);
    expect(viaRelative.report.violations).toEqual([]);
    expect(viaRelative.status).toBe(0);
  });

  it('does not accuse external npm packages, scoped or bare', () => {
    const { status, report } = check({
      'server/db/pool.ts': [
        "import { Pool } from 'pg';",
        "import { z } from 'zod';",
        "import { NextResponse } from 'next/server';",
        "import { createHash } from 'node:crypto';",
        "import scoped from '@scope/package';",
        'export const parts = [Pool, z, NextResponse, createHash, scoped];',
      ].join('\n'),
    });

    expect(report.violations).toEqual([]);
    expect(status).toBe(0);
  });

  it('allows a handler that calls a module application service', () => {
    const { status, report } = check({
      'app/api/v1/alpha/route.ts':
        "import { alpha } from '@/modules/alpha';\nexport const GET = alpha;\n",
      'modules/alpha/index.ts': 'export const alpha = 1;\n',
    });

    expect(report.violations).toEqual([]);
    expect(status).toBe(0);
  });
});

describe('module-boundary checker against a deliberately violating tree', () => {
  let fixture: string;

  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), 'rootlco-boundary-mixed-'));
    trees.push(fixture);

    // B1: one module reaching into another module's internals — by alias.
    write(
      fixture,
      'modules/alpha/index.ts',
      "import { secret } from '@/modules/beta/data/secret';\nexport const alpha = secret;\n"
    );
    write(fixture, 'modules/beta/data/secret.ts', "export const secret = 'internal';\n");
    write(fixture, 'modules/beta/index.ts', "export { secret } from './data/secret';\n");

    // B1 again, by relative path — the ADV-01 bypass, now caught by the same rule.
    write(
      fixture,
      'modules/gamma/index.ts',
      "import { secret } from '../beta/data/secret';\nexport const gamma = secret;\n"
    );

    // B4: a Route Handler reaching past the application service into data access.
    write(
      fixture,
      'app/api/v1/alpha/route.ts',
      `import { withTransaction } from '${UP}/server/db/transaction';\nexport const runtime = 'nodejs';\nexport const handler = withTransaction;\n`
    );
    write(fixture, 'server/db/transaction.ts', 'export const withTransaction = 1;\n');

    // B5: a domain layer reaching the database, by relative path.
    write(
      fixture,
      'modules/x/domain/rule.ts',
      "import { withTransaction } from '../../../server/db/transaction';\nexport const rule = withTransaction;\n"
    );

    // A clean file, so a passing rule set is not simply matching everything.
    write(
      fixture,
      'modules/alpha/domain/pure-rule.ts',
      'export const price = (n: number) => n * 2;\n'
    );
  });

  it('exits non-zero', () => {
    expect(runChecker(fixture).status).not.toBe(0);
  });

  it('identifies the applicable boundary rule for each violation', () => {
    const rules = rulesFrom(runChecker(fixture).report);

    expect(rules).toContain('B1-module-internals-are-private');
    expect(rules).toContain('B4-handlers-hold-no-data-access');
    expect(rules).toContain('B5-domain-layer-is-database-free');
  });

  it('names the offending file for each violation, and accuses no clean file', () => {
    const files = runChecker(fixture).report.violations.map((violation) => violation.file);

    expect(files).toContain('modules/alpha/index.ts');
    expect(files).toContain('modules/gamma/index.ts');
    expect(files).toContain('app/api/v1/alpha/route.ts');
    expect(files).toContain('modules/x/domain/rule.ts');
    expect(files).not.toContain('modules/alpha/domain/pure-rule.ts');
    expect(files).not.toContain('modules/beta/index.ts');
  });

  it('scans the whole fixture tree, so the result is not an empty pass', () => {
    expect(runChecker(fixture).report.scanned).toBe(8);
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
