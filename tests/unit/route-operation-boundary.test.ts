import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { API_ROUTES_V1_ROOT, REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import { pathScopeTarget } from '@api/server/http/validation';

/**
 * Nothing a route handler does before `handleOperation` may throw (DX-4, finance
 * QA fixes E).
 *
 * `handleOperation` is the one place a failure becomes a problem document with a
 * correlation id, a metric and a structured log line. Work a handler does BEFORE
 * it calls `handleOperation` runs outside that boundary, so a throw there reaches
 * the framework as an unhandled error. That is how
 * `POST /receptions/{receptionId}/convert-to-work-order` answered a malformed
 * identifier with HTTP 500, no correlation id and an unstructured `AppFailure` in
 * the server log: `parseOrFail(Params, await route.params, 'path')` sat above the
 * call. One hundred handlers carried the same shape, and they now parse inside
 * the operation, where the same failure is a 422 `ERR-VAL-001`.
 *
 * This reads every route module under `apps/api/src/app/api/v1` as a TypeScript
 * syntax tree — never as text — and holds the shape that keeps it fixed:
 *
 *  - every exported HTTP method handler ends in `return handleOperation(...)`;
 *  - every statement before that call is a declaration whose initializer is one
 *    of the three reads that cannot throw: the framework's route parameters
 *    (`await route.params`), the body read guarded by its own `.catch`
 *    (`await request.clone().json().catch(...)`), and the query copied by
 *    `searchParamsToObject(new URL(request.url).searchParams)`, which is written
 *    not to throw for exactly this reason;
 *  - the route options handed to `handleOperation` call nothing but the two
 *    target readers that return "no target" instead of throwing
 *    (`scopeTargetOption`, `pathScopeTarget`).
 *
 * A parse, a module call or anything else above the operation is reported with
 * its file, handler and line.
 */

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const SAFE_OPTION_CALLS = new Set(['scopeTargetOption', 'pathScopeTarget']);

/** `await <anything>.params` — the framework's route parameters. */
function isRouteParams(node: ts.Expression): boolean {
  return (
    ts.isAwaitExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'params' &&
    ts.isIdentifier(node.expression.expression)
  );
}

/** `await request.clone().json().catch(...)` — a body read that cannot reject. */
function isGuardedBodyRead(node: ts.Expression): boolean {
  if (!ts.isAwaitExpression(node)) return false;
  const caught = node.expression;
  if (!ts.isCallExpression(caught) || !ts.isPropertyAccessExpression(caught.expression)) {
    return false;
  }
  if (caught.expression.name.text !== 'catch' || caught.arguments.length !== 1) return false;
  const json = caught.expression.expression;
  if (!ts.isCallExpression(json) || !ts.isPropertyAccessExpression(json.expression)) return false;
  if (json.expression.name.text !== 'json' || json.arguments.length !== 0) return false;
  const clone = json.expression.expression;
  return (
    ts.isCallExpression(clone) &&
    ts.isPropertyAccessExpression(clone.expression) &&
    clone.expression.name.text === 'clone' &&
    clone.arguments.length === 0 &&
    ts.isIdentifier(clone.expression.expression)
  );
}

/** `searchParamsToObject(new URL(<id>.url).searchParams)` — documented never to throw. */
function isQueryCopy(node: ts.Expression): boolean {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return false;
  if (node.expression.text !== 'searchParamsToObject' || node.arguments.length !== 1) return false;
  const arg = node.arguments[0] as ts.Expression;
  if (!ts.isPropertyAccessExpression(arg) || arg.name.text !== 'searchParams') return false;
  const url = arg.expression;
  return (
    ts.isNewExpression(url) &&
    ts.isIdentifier(url.expression) &&
    url.expression.text === 'URL' &&
    url.arguments?.length === 1 &&
    ts.isPropertyAccessExpression(url.arguments[0] as ts.Expression) &&
    (url.arguments[0] as ts.PropertyAccessExpression).name.text === 'url'
  );
}

function isSafePreRead(statement: ts.Statement): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  return statement.declarationList.declarations.every(
    (declaration) =>
      declaration.initializer !== undefined &&
      (isRouteParams(declaration.initializer) ||
        isGuardedBodyRead(declaration.initializer) ||
        isQueryCopy(declaration.initializer))
  );
}

/** Every call and `new` inside a node, by the name it is called through. */
function callsIn(node: ts.Node): { readonly name: string; readonly node: ts.Node }[] {
  const found: { name: string; node: ts.Node }[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      found.push({ name: current.expression.getText(), node: current });
    }
    if (ts.isAwaitExpression(current)) found.push({ name: 'await', node: current });
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

interface Handler {
  readonly name: string;
  readonly body: ts.ConciseBody;
}

function exportedHandlers(source: ts.SourceFile): Handler[] {
  const out: Handler[] = [];
  const exported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      METHODS.has(statement.name.text) &&
      exported(statement) &&
      statement.body
    ) {
      out.push({ name: statement.name.text, body: statement.body });
    }
    if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !METHODS.has(declaration.name.text)) continue;
        const init = declaration.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          out.push({ name: declaration.name.text, body: init.body });
        } else {
          // A handler that is not a function literal cannot be read; say so.
          out.push({ name: declaration.name.text, body: ts.factory.createBlock([]) });
        }
      }
    }
  }
  return out;
}

/**
 * Every place in one route module where work runs outside the handled operation.
 * Exported to the cases below only, so the rule is tested on a known-bad module
 * as well as on the tree.
 */
function violationsIn(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const where = (node: ts.Node): string =>
    `${fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const out: string[] = [];
  for (const handler of exportedHandlers(source)) {
    if (!ts.isBlock(handler.body) || handler.body.statements.length === 0) {
      out.push(`${fileName} ${handler.name}: not a block that returns handleOperation(...)`);
      continue;
    }
    const statements = handler.body.statements;
    const last = statements[statements.length - 1] as ts.Statement;
    const call =
      ts.isReturnStatement(last) && last.expression && ts.isCallExpression(last.expression)
        ? last.expression
        : null;
    if (
      call === null ||
      !ts.isIdentifier(call.expression) ||
      call.expression.text !== 'handleOperation'
    ) {
      out.push(`${where(last)} ${handler.name}: does not end in return handleOperation(...)`);
      continue;
    }
    for (const statement of statements.slice(0, -1)) {
      if (!isSafePreRead(statement)) {
        out.push(
          `${where(statement)} ${handler.name}: runs before the operation — ${statement
            .getText(source)
            .replace(/\s+/g, ' ')
            .slice(0, 100)}`
        );
      }
    }
    const [, , , options] = call.arguments;
    if (options !== undefined) {
      for (const found of callsIn(options)) {
        if (!SAFE_OPTION_CALLS.has(found.name)) {
          out.push(
            `${where(found.node)} ${handler.name}: the route options call ${found.name} before the operation`
          );
        }
      }
    }
  }
  return out;
}

function routeModules(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...routeModules(path));
    else if (entry.name === 'route.ts') out.push(path);
  }
  return out;
}

/** The convert route exactly as it was before the fix: the parse above the call. */
const PARSED_OUTSIDE = `
export async function POST(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEPTION_CONVERT_OPERATION,
    request,
    async ({ db }) => ({ body: await convert(db, params.receptionId) }),
    { params, body }
  );
}
`;

/** The same route as it is now: the raw parameters above, the parse inside. */
const PARSED_INSIDE = `
export async function POST(
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEPTION_CONVERT_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      return { body: await convert(db, params.receptionId) };
    },
    { params: raw, body, authorizationTarget: pathScopeTarget(raw, 'branchId') }
  );
}
`;

describe('every v1 route does its throwing work inside the handled operation', () => {
  const modules = routeModules(API_ROUTES_V1_ROOT);

  it('finds the route tree it is meant to read', () => {
    // An empty or moved tree would make the next case pass vacuously.
    expect(modules.length).toBeGreaterThan(300);
  });

  it('reads no route that parses, calls a module or throws before handleOperation', () => {
    const violations = modules.flatMap((file) =>
      violationsIn(relative(REPOSITORY_ROOT, file).replace(/\\/g, '/'), readFileSync(file, 'utf8'))
    );
    expect(violations).toEqual([]);
  });

  it('refuses the shape that answered a malformed id with 500', () => {
    const found = violationsIn('convert/route.ts', PARSED_OUTSIDE);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('runs before the operation');
    expect(found[0]).toContain('parseOrFail');
  });

  it('accepts the shape every route now has', () => {
    expect(violationsIn('convert/route.ts', PARSED_INSIDE)).toEqual([]);
  });

  it('refuses an unguarded body read and a throwing call in the route options', () => {
    const unguarded = PARSED_INSIDE.replace('.catch(() => null)', '');
    expect(violationsIn('a/route.ts', unguarded)).toHaveLength(1);
    const option = PARSED_INSIDE.replace(
      "pathScopeTarget(raw, 'branchId')",
      "{ branchId: parseOrFail(Params, raw, 'path').branchId }"
    );
    expect(violationsIn('b/route.ts', option)).toEqual([
      expect.stringContaining('the route options call parseOrFail'),
    ]);
  });
});

describe('pathScopeTarget builds a target without throwing', () => {
  const COMPANY = '11111111-1111-4111-8111-111111111111';

  it('names a well-formed identifier as the target', () => {
    expect(pathScopeTarget({ companyId: COMPANY }, 'companyId')).toEqual({ companyId: COMPANY });
    expect(pathScopeTarget({ branchId: COMPANY }, 'branchId')).toEqual({ branchId: COMPANY });
  });

  it('names no target for a missing or malformed identifier, so the parse inside refuses it', () => {
    expect(pathScopeTarget({ companyId: 'undefined' }, 'companyId')).toEqual({});
    expect(pathScopeTarget({}, 'branchId')).toEqual({});
    expect(pathScopeTarget(null, 'companyId')).toEqual({});
    // The other key is never read in place of the one asked for.
    expect(pathScopeTarget({ branchId: COMPANY }, 'companyId')).toEqual({});
  });
});
