/**
 * No script or test helper chooses a database port by default.
 *
 * On 2026-10-06 `scripts/db/phase-upgrade-matrix.mjs` reached the acceptance
 * database twice because it read `PGPORT ?? 54322` while the operator had set
 * only `DB_PORT`. The fix is one resolver, `scripts/lib/db-target.mjs`; this
 * file is what keeps it the only one.
 *
 * It PARSES every tracked JavaScript and TypeScript file that mentions either
 * variable — the text search only chooses which files to parse — and refuses:
 *
 *   - a read of `PGPORT` or `DB_PORT` that carries a fallback (`??`, `||`, a
 *     conditional, or a destructuring default), anywhere except the resolver
 *     and the named, guarded exceptions below;
 *   - any read of either variable at all in the consumers this change moved
 *     onto the resolver, and any of those consumers that stops importing it;
 *   - an exception that no longer needs to be one, or no longer carries the
 *     `ROOTLCO_ENV` guard that justified it.
 *
 * A file the parser rejects is a failure, not a pass: a check that cannot read
 * a file has not checked it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseModule } from '../../scripts/lib/typescript-source.mjs';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';

const PORT_VARIABLES = new Set(['PGPORT', 'DB_PORT']);
const RESOLVER = 'scripts/lib/db-target.mjs';

/** The consumers routed through the resolver. Each must import it and read neither variable. */
const RESOLVED_CONSUMERS = [
  'scripts/db/phase-upgrade-matrix.mjs',
  'scripts/db/perf-baseline.mjs',
  'scripts/db/backfill-template-approval-witnesses.mjs',
  'scripts/ci/migration-replay-checks.mjs',
  'tests/db/helpers.ts',
  'tests/backend/helpers.ts',
  'tests/backend/isolated-database.ts',
  'tests/db/p1-31-export-fixture.test.ts',
  'scripts/db/apply-migrations.mjs',
  'scripts/db/validate-seed-state.mjs',
  'scripts/ci/backup-restore-drill.mjs',
  'scripts/db/schema-inventory.mjs',
  'scripts/db/structural-review.mjs',
  'scripts/db/baseline-manifest.mjs',
  'scripts/check-aptrec-classification.mjs',
  'scripts/check-crm-classification.mjs',
  'scripts/check-sal-wty-rpt-classification.mjs',
  'scripts/check-svc-quo-inv-classification.mjs',
  'scripts/check-veh-classification.mjs',
  'scripts/check-wo-tech-dia-qms-classification.mjs',
  'scripts/ci/rls-matrix.mjs',
  'scripts/platform/entitlement-inventory.mjs',
] as const;

/**
 * Operator scripts that target the acceptance stack ON PURPOSE, each behind its
 * own `ROOTLCO_ENV` refusal and an explicit confirmation. They are the
 * documented exceptions in `docs/database/migration-standard.md section 16`, not an allow-list for
 * convenience: the list may only shrink, and each entry must still need it.
 */
const GUARDED_EXCEPTIONS: Readonly<Record<string, string>> = {
  'scripts/db/provision-organization.mjs':
    'tenant provisioning; refuses unless ROOTLCO_ENV names a pilot environment and --confirm repeats the tenant code',
  'scripts/dev/owner-acceptance/context.mjs':
    'the owner-acceptance harness; assertLocalTarget refuses anything but ROOTLCO_ENV=local-acceptance on loopback 54322',
  'scripts/platform/add-platform-operator.mjs':
    'platform operator administration; ROOTLCO_ENV guard plus --confirm',
  'scripts/platform/backfill-delivering-employee-identity.mjs':
    'a guarded platform backfill; ROOTLCO_ENV guard plus --confirm',
  'scripts/platform/backfill-tenant-administrator-bundle.mjs':
    'a guarded platform backfill; ROOTLCO_ENV guard plus --confirm',
  'scripts/platform/genesis-platform-operator.mjs':
    'one-time platform genesis; ROOTLCO_ENV guard plus --confirm',
  'scripts/platform/grant-platform-authority.mjs':
    'platform authority grant; ROOTLCO_ENV guard plus --confirm',
  'scripts/platform/revoke-platform-operator.mjs':
    'platform operator revocation; ROOTLCO_ENV guard plus --confirm',
};

const CODE_FILE = /\.(?:[cm]?js|[cm]?ts|tsx)$/;

interface PortRead {
  readonly name: string;
  readonly line: number;
  readonly fallback: boolean;
}

function unwrap(node: ts.Node): ts.Node {
  let current = node;
  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent))
  ) {
    current = current.parent;
  }
  return current;
}

const FALLBACK_OPERATORS = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
]);

function isAssignmentTarget(node: ts.Node): boolean {
  const outer = unwrap(node);
  const parent = outer.parent;
  return (
    !!parent &&
    ts.isBinaryExpression(parent) &&
    parent.left === outer &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

function carriesFallback(node: ts.Node): boolean {
  const outer = unwrap(node);
  const parent = outer.parent;
  if (!parent) return false;
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === outer &&
    FALLBACK_OPERATORS.has(parent.operatorToken.kind)
  ) {
    return true;
  }
  return ts.isConditionalExpression(parent) && parent.condition === outer;
}

function bindingName(element: ts.BindingElement): string | undefined {
  const key = element.propertyName ?? element.name;
  if (ts.isIdentifier(key) || ts.isStringLiteral(key)) return key.text;
  return undefined;
}

/** Every read of PGPORT / DB_PORT in a parsed file, with whether it carries a default. */
function portReads(file: ts.SourceFile): PortRead[] {
  const reads: PortRead[] = [];
  const record = (node: ts.Node, name: string, fallback: boolean) =>
    reads.push({
      name,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      fallback,
    });

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && PORT_VARIABLES.has(node.name.text)) {
      if (!isAssignmentTarget(node)) record(node, node.name.text, carriesFallback(node));
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      PORT_VARIABLES.has(node.argumentExpression.text)
    ) {
      if (!isAssignmentTarget(node)) {
        record(node, node.argumentExpression.text, carriesFallback(node));
      }
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const name = bindingName(node);
      if (name && PORT_VARIABLES.has(name)) record(node, name, node.initializer !== undefined);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return reads;
}

function readsVariable(file: ts.SourceFile, variable: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAccessExpression(node) && node.name.text === variable) found = true;
    else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === variable
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function importsResolver(file: ts.SourceFile): boolean {
  return file.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /(?:^|\/)(?:lib\/db-target\.mjs|database-target)$/.test(statement.moduleSpecifier.text)
  );
}

function parsed(path: string): ts.SourceFile {
  const file = parseModule(readFileSync(join(REPOSITORY_ROOT, path), 'utf8'));
  if (!file) throw new Error(`${path} could not be parsed, so it could not be checked`);
  return file;
}

const TRACKED: string[] = execFileSync('git', ['ls-files'], {
  cwd: REPOSITORY_ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter((path) => CODE_FILE.test(path));

/** Files that mention either variable at all — the only ones worth parsing. */
const MENTIONING = TRACKED.filter((path) => {
  const text = readFileSync(join(REPOSITORY_ROOT, path), 'utf8');
  return text.includes('PGPORT') || text.includes('DB_PORT');
});

describe('the detector can fail', () => {
  const reads = (source: string) => {
    const file = parseModule(source);
    if (!file) throw new Error('fixture did not parse');
    return portReads(file);
  };

  it('flags every fallback shape', () => {
    for (const source of [
      'const port = Number(process.env.PGPORT ?? 54322);',
      "const port = process.env.DB_PORT || '54322';",
      "const port = (process.env['DB_PORT'] as string) ?? '54322';",
      'const port = env.DB_PORT ?? 54322;',
      'const port = process.env.PGPORT ? Number(process.env.PGPORT) : 54322;',
      'const { DB_PORT = 54322 } = process.env;',
      "const { PGPORT: port = '54322' } = process.env;",
    ]) {
      expect(
        reads(source).some((read) => read.fallback),
        source
      ).toBe(true);
    }
  });

  it('does not flag a plain read, a write, or a string', () => {
    for (const source of [
      'const port = Number(process.env.DB_PORT);',
      "process.env.DB_PORT = '55441';",
      "const text = 'process.env.PGPORT ?? 54322';",
      "const child = { ...process.env, PGPORT: '55441' };",
    ]) {
      expect(
        reads(source).some((read) => read.fallback),
        source
      ).toBe(false);
    }
  });
});

describe('no database port is chosen by default', () => {
  it('found the files it is about', () => {
    // A scan that matched nothing would pass every rule below having judged nothing.
    expect(MENTIONING.length).toBeGreaterThan(RESOLVED_CONSUMERS.length);
    expect(MENTIONING).toContain(RESOLVER);
  });

  it('reads PGPORT / DB_PORT with a fallback only in the resolver and the guarded exceptions', () => {
    const offenders: string[] = [];
    for (const path of MENTIONING) {
      if (path === RESOLVER || path in GUARDED_EXCEPTIONS) continue;
      for (const read of portReads(parsed(path))) {
        if (read.fallback) offenders.push(`${path}:${read.line} reads ${read.name} with a default`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the resolver itself carries no fallback', () => {
    expect(portReads(parsed(RESOLVER)).filter((read) => read.fallback)).toEqual([]);
  });

  it.each(RESOLVED_CONSUMERS)('%s imports the resolver and reads neither variable', (path) => {
    const file = parsed(path);
    expect(importsResolver(file)).toBe(true);
    expect(portReads(file)).toEqual([]);
  });

  it.each(Object.keys(GUARDED_EXCEPTIONS))(
    '%s is still a guarded exception that needs to be one',
    (path) => {
      const file = parsed(path);
      expect(readsVariable(file, 'ROOTLCO_ENV')).toBe(true);
      expect(portReads(file).some((read) => read.fallback)).toBe(true);
    }
  );
});
