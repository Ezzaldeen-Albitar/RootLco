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
 *   - any read of `PGPORT` or `DB_PORT` outside the resolver, the named,
 *     guarded exceptions and the named plain readers below;
 *   - in the resolver and the plain readers, a read that carries a fallback:
 *     `??`, `||`, `??=`, `||=` or a conditional applied to the read, to a
 *     conversion or method call of it (`Number(…) || 54322`), or to a variable
 *     it was stored in, or a destructuring default;
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

/**
 * Files that read either variable WITHOUT choosing a port: they save it and put it back
 * around cases that drive a guarded script through its environment. Any other file outside
 * the resolver and the guarded exceptions may not read either variable at all, so a new
 * script cannot bring a default back in a shape this parser does not recognise. The list
 * may only shrink, and each entry must still read a variable without a fallback.
 */
const PLAIN_READERS: Readonly<Record<string, string>> = {
  'tests/ci/p1-31-export-fixture-refusals.test.ts':
    'saves DB_PORT before cases that drive the guarded owner-acceptance harness through the environment, and restores it after',
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

/**
 * Climbs from a value through every expression that contains it — a conversion such as
 * `Number(…)`, `parseInt(…)` or unary `+`, a method call such as `.trim()`, a template —
 * and reports whether any of them is the left operand of `??`, `||`, `??=`, `||=` or the
 * condition of a conditional. It stops at a statement, a declaration, a function boundary or
 * the right-hand side of an assignment, and returns the outermost expression it reached.
 */
function climb(node: ts.Node): { readonly top: ts.Node; readonly fallback: boolean } {
  let child = node;
  let parent = child.parent;
  while (parent) {
    if (
      ts.isBinaryExpression(parent) &&
      parent.left === child &&
      FALLBACK_OPERATORS.has(parent.operatorToken.kind)
    ) {
      return { top: parent, fallback: true };
    }
    if (ts.isConditionalExpression(parent) && parent.condition === child) {
      return { top: parent, fallback: true };
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === child &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      break;
    }
    if (ts.isFunctionLike(parent) || !(ts.isExpression(parent) || ts.isTemplateSpan(parent))) {
      break;
    }
    child = parent;
    parent = child.parent;
  }
  return { top: child, fallback: false };
}

/** The name a value is stored under: `const p = <value>` or `p = <value>`. */
function aliasOf(top: ts.Node): ts.Identifier | undefined {
  const parent = top.parent;
  if (!parent) return undefined;
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === top &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.right === top &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    const target = parent.left;
    if (ts.isIdentifier(target)) return target;
  }
  return undefined;
}

/** Every identifier in the file that reads `name` as a value (not a property name, not a declaration). */
function referencesTo(file: ts.SourceFile, name: string, declared: ts.Identifier): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && node !== declared) {
      const parent = node.parent;
      const isName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
        (ts.isParameter(parent) && parent.name === node);
      if (!isName) found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * Whether a read carries a fallback: directly, through a conversion or method call, or through
 * a variable it is stored in (followed two assignments deep). Names are matched without regard
 * to scope, which can only report more, never less.
 */
function carriesFallback(node: ts.Node, alias?: ts.Identifier, depth = 0): boolean {
  const file = node.getSourceFile();
  const followAlias = (name: ts.Identifier | undefined): boolean =>
    !!name &&
    depth < 2 &&
    referencesTo(file, name.text, name).some((reference) =>
      carriesFallback(reference, undefined, depth + 1)
    );
  if (alias) return followAlias(alias);
  const { top, fallback } = climb(node);
  return fallback || followAlias(aliasOf(top));
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
      if (name && PORT_VARIABLES.has(name)) {
        const local = ts.isIdentifier(node.name) ? node.name : undefined;
        record(node, name, node.initializer !== undefined || carriesFallback(node, local));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return reads;
}

/** What the rules below refuse in one file. */
function offences(path: string, file: ts.SourceFile): string[] {
  if (path in GUARDED_EXCEPTIONS) return [];
  const reads = portReads(file);
  if (path === RESOLVER || path in PLAIN_READERS) {
    return reads
      .filter((read) => read.fallback)
      .map((read) => `${path}:${read.line} reads ${read.name} with a default`);
  }
  return reads.map(
    (read) =>
      `${path}:${read.line} reads ${read.name}; only ${RESOLVER} may (use resolveDatabaseTarget)`
  );
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
      // A read wrapped in a conversion, then defaulted: the usual JavaScript numeric default.
      'const port = Number(process.env.DB_PORT) || 54322;',
      'const port = parseInt(process.env.PGPORT, 10) || 54322;',
      'const port = +process.env.DB_PORT || 54322;',
      "const port = process.env.DB_PORT?.trim() || '54322';",
      'const port = Number(process.env.PGPORT) ? Number(process.env.PGPORT) : 54322;',
      // A read through an alias, then defaulted.
      'const p = process.env.DB_PORT; const port = p ?? 54322;',
      'const p = process.env.DB_PORT; const port = Number(p) || 54322;',
      'let p; p = process.env.PGPORT; const port = p || 54322;',
      'const { DB_PORT: p } = process.env; const port = Number(p) || 54322;',
      'const { PGPORT } = process.env; const port = PGPORT ?? 54322;',
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
      "const original = process.env.DB_PORT; restore(['DB_PORT', original]);",
      'const same = process.env.DB_PORT === process.env.PGPORT;',
    ]) {
      expect(
        reads(source).some((read) => read.fallback),
        source
      ).toBe(false);
    }
  });
});

describe('the file rule can fail', () => {
  const judge = (path: string, source: string) => {
    const file = parseModule(source);
    if (!file) throw new Error('fixture did not parse');
    return offences(path, file);
  };

  it('refuses any read in a file that is not the resolver, an exception or a plain reader', () => {
    expect(
      judge('scripts/db/new-tool.mjs', 'const port = Number(process.env.DB_PORT);')
    ).toHaveLength(1);
    expect(judge('scripts/db/new-tool.mjs', 'const { PGPORT } = process.env;')).toHaveLength(1);
  });

  it('refuses a default in a plain reader, directly or through an alias', () => {
    const reader = 'tests/ci/p1-31-export-fixture-refusals.test.ts';
    expect(reader in PLAIN_READERS).toBe(true);
    for (const source of [
      'const x = Number(process.env.DB_PORT) || 54322;',
      'const p = process.env.DB_PORT; const port = p ?? 54322;',
    ]) {
      expect(judge(reader, source), source).toHaveLength(1);
    }
    expect(judge(reader, 'const original = process.env.DB_PORT;')).toEqual([]);
  });
});

describe('no database port is chosen by default', () => {
  it('found the files it is about', () => {
    // A scan that matched nothing would pass every rule below having judged nothing.
    expect(MENTIONING.length).toBeGreaterThan(RESOLVED_CONSUMERS.length);
    expect(MENTIONING).toContain(RESOLVER);
  });

  it('reads PGPORT / DB_PORT only in the resolver, the guarded exceptions and the plain readers', () => {
    expect(MENTIONING.flatMap((path) => offences(path, parsed(path)))).toEqual([]);
  });

  it.each(Object.keys(PLAIN_READERS))('%s still reads a variable, without a fallback', (path) => {
    const reads = portReads(parsed(path));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((read) => read.fallback)).toEqual([]);
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
