import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { flattenNavigation } from '@/config/navigation';
import {
  ROUTE_BRANCH_SCOPES,
  UNION_OPERATIONS,
  routeBranchScopeFor,
  routeScopeDeclarationFor,
  validateRouteScopes,
  type RouteScopeDeclaration,
} from '@/config/route-branch-scope';
import { PUBLISHED_OPERATIONS } from '@/lib/api/idempotent-operations';

/**
 * The route-level branch scope, held against the facts it is about
 * (Owner directive; Browser QA part 7, rows 1b.4 and 1b.5).
 *
 * `config/route-branch-scope.ts` decides, per workspace route, whether the
 * header offers "All my branches". A table like that is only as good as its
 * agreement with three things it cannot vouch for itself, so each is read here
 * from its own source:
 *
 *   - **the filesystem** — every workspace page has exactly one declaration,
 *     and no declaration names a page that does not exist;
 *   - **the published contract** — every operation a declaration names is one
 *     the API publishes, with the method it publishes;
 *   - **the API route modules** — the union set is exactly the operations whose
 *     `defineOperation({...})` literal declares `branchNarrowing:
 *     'authorized-union'`, found by PARSING each route file with the TypeScript
 *     compiler, not by matching text: a comment mentioning the value, or a
 *     computed declaration, is not a declaration.
 *
 * Each rule is also shown refusing a table that breaks it, so none of them can
 * pass by checking nothing.
 */

const WEB_ROOT = process.cwd();
const WORKSPACE_ROUTES = join(WEB_ROOT, 'src', 'app', '[locale]', '(dashboard)');
const DESIGN_ROUTES = join(WEB_ROOT, 'src', 'app', '[locale]', '(design)');
const API_ROUTES = join(WEB_ROOT, '..', 'api', 'src', 'app');

/** Every `page.tsx` under a route group, as the pattern the table spells it. */
function pagePatterns(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'page.tsx') {
        const rel = relative(root, dirname(path)).split(/[\\/]/).filter(Boolean);
        out.push(`/${rel.join('/')}`);
      }
    }
  };
  walk(root);
  return out.sort();
}

/** What a table and a set of pages disagree about, in both directions. */
function parity(
  pages: readonly string[],
  declarations: readonly RouteScopeDeclaration[]
): { readonly undeclared: string[]; readonly orphaned: string[] } {
  const declared = new Set(declarations.map((entry) => entry.pattern));
  const onDisk = new Set(pages);
  return {
    undeclared: pages.filter((page) => !declared.has(page)),
    orphaned: [...declared].filter((pattern) => !onDisk.has(pattern)),
  };
}

/** Every `route.ts` under the API app tree. */
function apiRouteFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'route.ts') out.push(path);
    }
  };
  walk(API_ROUTES);
  return out;
}

interface ParsedOperation {
  readonly id: string;
  readonly union: boolean;
}

/**
 * The `defineOperation({...})` literals in one module, read from its syntax
 * tree. `id` and `branchNarrowing` count only as string-literal properties of
 * the object literal passed to the call — exactly the form the backend's own
 * gates require, so anything else is not a declaration this rule may credit.
 */
function operationsDeclaredIn(fileName: string, source: string): ParsedOperation[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: ParsedOperation[] = [];
  const literalProperty = (object: ts.ObjectLiteralExpression, name: string): string | null => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name;
      const keyText = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null;
      if (keyText !== name) continue;
      return ts.isStringLiteral(property.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(property.initializer)
        ? property.initializer.text
        : null;
    }
    return null;
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineOperation'
    ) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isObjectLiteralExpression(argument)) {
        const id = literalProperty(argument, 'id');
        if (id !== null) {
          found.push({
            id,
            union: literalProperty(argument, 'branchNarrowing') === 'authorized-union',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const PUBLISHED = new Map(PUBLISHED_OPERATIONS.map((entry) => [entry.operationId, entry.method]));
const UNION = new Set(UNION_OPERATIONS);

describe('every workspace route declares its branch scope exactly once', () => {
  const pages = pagePatterns(WORKSPACE_ROUTES);

  it('reads the route tree, so the comparison below is not vacuous', () => {
    expect(pages.length).toBeGreaterThan(60);
    expect(pages).toContain('/receptions/check-in');
    expect(pages).toContain('/work-orders');
  });

  it('has a declaration for every page and a page for every declaration', () => {
    expect(parity(pages, ROUTE_BRANCH_SCOPES)).toEqual({ undeclared: [], orphaned: [] });
  });

  it('refuses a table that forgot a page, and one that names a page that does not exist', () => {
    const forgot = ROUTE_BRANCH_SCOPES.filter((entry) => entry.pattern !== '/attention');
    expect(parity(pages, forgot).undeclared).toEqual(['/attention']);
    const invented = [
      ...ROUTE_BRANCH_SCOPES,
      { pattern: '/no-such-screen', scope: 'union', operations: [], why: 'x' },
    ] satisfies RouteScopeDeclaration[];
    expect(parity(pages, invented).orphaned).toEqual(['/no-such-screen']);
  });

  it('resolves every available navigation entry to a declaration', () => {
    const unresolved = flattenNavigation()
      .filter((item) => item.status === 'available')
      // The component gallery lives in the `(design)` group, whose shell carries
      // no working context at all; asserted below rather than skipped silently.
      .filter((item) => item.href !== '/gallery')
      .filter((item) => routeScopeDeclarationFor(item.href) === null)
      .map((item) => item.href);
    expect(unresolved).toEqual([]);
    expect(existsSync(join(DESIGN_ROUTES, 'gallery', 'page.tsx'))).toBe(true);
    expect(existsSync(join(WORKSPACE_ROUTES, 'gallery'))).toBe(false);
  });
});

describe('the declarations agree with the published contract', () => {
  it('passes its own rules against the contract and the union set', () => {
    expect(validateRouteScopes(ROUTE_BRANCH_SCOPES, UNION, PUBLISHED)).toEqual([]);
  });

  it('offers "All my branches" on the union boards only (QA 1b.5)', () => {
    const union = ROUTE_BRANCH_SCOPES.filter((entry) => entry.scope === 'union')
      .map((entry) => entry.pattern)
      .sort();
    expect(union).toEqual(['/', '/appointments', '/receptions', '/warranty', '/work-orders']);
    // The write screens QA found offering it, named so a regression is loud.
    for (const write of [
      '/receptions/check-in',
      '/inventory/adjustments',
      '/inventory/opening-stock',
      '/appointments/new',
      '/invoices',
      '/payments',
      '/quotations',
    ]) {
      expect(routeBranchScopeFor(write), write).toBe('concrete');
    }
    // The handover queue reads `sal.delivery-readiness-list`, which declares no
    // union — so it is concrete although `sal.delivery-list` is a union read.
    expect(routeBranchScopeFor('/delivery')).toBe('concrete');
  });

  it('refuses a union route that names a read the server does not answer for the set', () => {
    const table: RouteScopeDeclaration[] = [
      {
        pattern: '/delivery',
        scope: 'union',
        operations: ['sal.delivery-readiness-list'],
        why: 'x',
      },
    ];
    expect(validateRouteScopes(table, UNION, PUBLISHED)).toEqual([
      {
        pattern: '/delivery',
        problem:
          'is declared union but sal.delivery-readiness-list is not an authorized-union read',
      },
    ]);
  });

  it('refuses a union route that names a write, even one sharing a union read path', () => {
    const table: RouteScopeDeclaration[] = [
      { pattern: '/x', scope: 'union', operations: ['rec.reception-create'], why: 'x' },
    ];
    expect(validateRouteScopes(table, UNION, PUBLISHED).map((f) => f.problem)).toEqual([
      'is declared union but rec.reception-create is not an authorized-union read',
    ]);
    // And a union member the contract publishes as anything but a read.
    const lying = new Map(PUBLISHED);
    lying.set('rec.reception-list', 'POST');
    const listed: RouteScopeDeclaration[] = [
      { pattern: '/x', scope: 'union', operations: ['rec.reception-list'], why: 'x' },
    ];
    expect(validateRouteScopes(listed, UNION, lying).map((f) => f.problem)).toEqual([
      'is declared union but rec.reception-list is not a read',
    ]);
  });

  it('refuses unknown operations, empty postures, stray operations and duplicates', () => {
    const table: RouteScopeDeclaration[] = [
      { pattern: '/a', scope: 'concrete', operations: ['inv.no-such-operation'], why: 'x' },
      { pattern: '/b', scope: 'concrete', operations: [], why: 'x' },
      { pattern: '/c', scope: 'none', operations: ['rec.reception-create'], why: 'x' },
      { pattern: '/d', scope: 'union', operations: [], why: 'x' },
      { pattern: '/d', scope: 'none', operations: [], why: ' ' },
    ];
    expect(validateRouteScopes(table, UNION, PUBLISHED)).toEqual([
      { pattern: '/a', problem: 'names inv.no-such-operation, which is not published' },
      { pattern: '/b', problem: 'is declared concrete but names no operation' },
      { pattern: '/c', problem: 'is declared none but names working-branch operations' },
      { pattern: '/d', problem: 'is declared union but names no operation' },
      { pattern: '/d', problem: 'declared more than once' },
      { pattern: '/d', problem: 'no reason given' },
    ]);
  });
});

describe('the union set is exactly what the API route modules declare', () => {
  const declared = apiRouteFiles().flatMap((file) =>
    operationsDeclaredIn(file, readFileSync(file, 'utf8'))
  );

  it('parses the API route tree, so the comparison is not vacuous', () => {
    expect(statSync(API_ROUTES).isDirectory()).toBe(true);
    expect(declared.length).toBeGreaterThan(400);
    expect(declared.map((entry) => entry.id)).toContain('rec.reception-create');
  });

  it('matches the declarations in both directions', () => {
    const fromApi = declared
      .filter((entry) => entry.union)
      .map((entry) => entry.id)
      .sort();
    expect([...UNION_OPERATIONS].sort()).toEqual(fromApi);
  });

  it('credits only a literal declaration inside the defineOperation object', () => {
    const source = `
      // branchNarrowing: 'authorized-union' — a comment is not a declaration.
      const NARROWING = 'authorized-union';
      export const A = defineOperation({ id: 'x.literal', branchNarrowing: 'authorized-union' });
      export const B = defineOperation({ id: 'x.computed', branchNarrowing: NARROWING });
      export const C = defineOperation({ id: 'x.plain', method: 'GET' });
      const D = { id: 'x.not-a-call', branchNarrowing: 'authorized-union' };
    `;
    expect(operationsDeclaredIn('probe.ts', source)).toEqual([
      { id: 'x.literal', union: true },
      { id: 'x.computed', union: false },
      { id: 'x.plain', union: false },
    ]);
  });
});

describe('an address resolves to one posture', () => {
  it('strips the locale, ignores the query and prefers a literal segment', () => {
    expect(routeBranchScopeFor('/en/work-orders')).toBe('union');
    expect(routeBranchScopeFor('/ar/work-orders?view=all')).toBe('union');
    expect(routeBranchScopeFor('/en/receptions/check-in')).toBe('concrete');
    expect(routeScopeDeclarationFor('/en/vehicles/new')?.pattern).toBe('/vehicles/new');
    expect(routeScopeDeclarationFor('/en/vehicles/abc')?.pattern).toBe('/vehicles/[vehicleId]');
    expect(routeScopeDeclarationFor('/en/work-orders/quality')?.pattern).toBe(
      '/work-orders/quality'
    );
    expect(routeBranchScopeFor('/en')).toBe('union');
    expect(routeBranchScopeFor('/en/administration/users')).toBe('none');
  });

  it('treats an address it does not know as concrete, never as a union', () => {
    expect(routeBranchScopeFor('/en/no-such-screen')).toBe('concrete');
    expect(routeBranchScopeFor('/en/work-orders/a/b/c/d')).toBe('concrete');
  });
});
