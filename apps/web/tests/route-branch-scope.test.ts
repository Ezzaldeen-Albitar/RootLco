import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { flattenNavigation } from '@/config/navigation';
import {
  ROUTE_BRANCH_SCOPES,
  UNION_OPERATIONS,
  routeBranchScopeFor,
  routeScopeDeclarationFor,
  validateRouteScopes,
  type OperationFacts,
  type RouteScopeDeclaration,
} from '@/config/route-branch-scope';
import { PUBLISHED_OPERATIONS } from '@/lib/api/idempotent-operations';
import {
  RouteReachability,
  operationsDeclaredIn,
  parseApiOperations,
  type RouteReach,
} from './support/route-reachability';

/**
 * The route-level branch scope, held against the facts it is about
 * (Owner directive; Browser QA part 7, rows 1b.4 and 1b.5; PR #467 review).
 *
 * `config/route-branch-scope.ts` decides, per workspace route, whether the
 * header offers "All my branches". Each thing it cannot vouch for itself is read
 * here from its own source:
 *
 *   - **the filesystem** — every workspace page has exactly one declaration;
 *   - **the API route modules** — the operations, their methods, scopes and
 *     branch narrowing, parsed from each `defineOperation({...})` literal with
 *     the TypeScript compiler;
 *   - **the page source** — what each route can actually call, DERIVED by
 *     `support/route-reachability.ts`: the page's symbols walked through the
 *     module graph, each `/api/v1/…` literal followed to the call that sends it,
 *     and matched to one operation. A union route's declared operations must
 *     equal that derived set; no endpoint on a union route may go unresolved.
 *   - **the route checklist** — its scope table must say what the table says.
 *
 * Each rule is also shown refusing an input that breaks it.
 */

const WEB_ROOT = process.cwd();
const WEB_SOURCE = join(WEB_ROOT, 'src');
const WORKSPACE_ROUTES = join(WEB_SOURCE, 'app', '[locale]', '(dashboard)');
const DESIGN_ROUTES = join(WEB_SOURCE, 'app', '[locale]', '(design)');
const API_ROUTES = join(WEB_ROOT, '..', 'api', 'src', 'app');
const CHECKLIST = join(
  WEB_ROOT,
  '..',
  '..',
  'docs',
  'product',
  'owner-directive-2026-09-16',
  'route-checklist.md'
);

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

const API_OPERATIONS = parseApiOperations(API_ROUTES);
const FACTS = new Map<string, OperationFacts>(
  API_OPERATIONS.map((operation) => [operation.id, operation])
);

function pageFile(root: string, pattern: string): string {
  return join(
    root,
    'app',
    '[locale]',
    '(dashboard)',
    ...pattern.split('/').filter(Boolean),
    'page.tsx'
  );
}

/**
 * What a union route may reach: only reads, every one either tenant-wide or an
 * `authorized-union` read, and nothing the walk could not resolve. Shared by the
 * real routes and the fixtures below, so the refusal is the same code.
 */
function unionProblems(reach: RouteReach): string[] {
  const problems: string[] = [];
  for (const endpoint of reach.endpoints) {
    const where = `${endpoint.method ?? '?'} ${endpoint.template ?? '?'} at ${relative(WEB_ROOT, endpoint.at)}`;
    if (endpoint.operation === null) {
      problems.push(`unresolved (${endpoint.problem}): ${where}`);
      continue;
    }
    const { id, method, scope, union } = endpoint.operation;
    if (method !== 'GET') problems.push(`reaches the write ${id}: ${where}`);
    else if (!union && scope !== 'tenant') {
      problems.push(`reaches ${id}, narrowed to a ${scope} and not an authorized-union read`);
    }
  }
  return problems;
}

function derivedIds(reach: RouteReach): string[] {
  const ids = new Set<string>();
  for (const endpoint of reach.endpoints) if (endpoint.operation) ids.add(endpoint.operation.id);
  return [...ids].sort();
}

const reaches = (symbols: ReadonlySet<string>, file: string, name: string) =>
  [...symbols].some((key) => key.replace(/\\/g, '/').endsWith(`${file}#${name}`));

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
    const invented: RouteScopeDeclaration[] = [
      ...ROUTE_BRANCH_SCOPES,
      { pattern: '/no-such-screen', scope: 'none', why: 'x' },
    ];
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

describe('the declarations agree with the published operations', () => {
  it('passes its own rules against the operations the API declares', () => {
    expect(validateRouteScopes(ROUTE_BRANCH_SCOPES, FACTS)).toEqual([]);
  });

  it('offers "All my branches" on the union boards only (QA 1b.5)', () => {
    const union = ROUTE_BRANCH_SCOPES.filter((entry) => entry.scope === 'union')
      .map((entry) => entry.pattern)
      .sort();
    expect(union).toEqual(['/', '/appointments', '/receptions', '/warranty', '/work-orders']);
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

  it('refuses a union route naming a branch-narrowed read, a write, or nothing it may', () => {
    const table: RouteScopeDeclaration[] = [
      { pattern: '/a', scope: 'union', operations: ['sal.delivery-readiness-list'], why: 'x' },
      {
        pattern: '/b',
        scope: 'union',
        operations: ['rec.reception-list', 'rec.reception-create'],
        why: 'x',
      },
      { pattern: '/c', scope: 'union', operations: ['iam.auth-session'], why: 'x' },
    ];
    expect(validateRouteScopes(table, FACTS)).toEqual([
      {
        pattern: '/a',
        problem:
          'is declared union but sal.delivery-readiness-list is narrowed to a branch and is not an authorized-union read',
      },
      { pattern: '/a', problem: 'is declared union but reaches no authorized-union read' },
      { pattern: '/b', problem: 'is declared union but rec.reception-create is not a read' },
      { pattern: '/c', problem: 'is declared union but reaches no authorized-union read' },
    ]);
  });

  it('refuses unknown operations, stray operations, empty unions and duplicates', () => {
    const table: RouteScopeDeclaration[] = [
      {
        pattern: '/a',
        scope: 'union',
        operations: ['inv.no-such-operation', 'rec.reception-list'],
        why: 'x',
      },
      { pattern: '/b', scope: 'concrete', operations: ['rec.reception-create'], why: 'x' },
      { pattern: '/c', scope: 'union', operations: [], why: 'x' },
      { pattern: '/c', scope: 'none', why: ' ' },
    ];
    expect(validateRouteScopes(table, FACTS)).toEqual([
      { pattern: '/a', problem: 'names inv.no-such-operation, which is not published' },
      { pattern: '/b', problem: 'is declared concrete but names operations' },
      { pattern: '/c', problem: 'is declared union but names no operation' },
      { pattern: '/c', problem: 'declared more than once' },
      { pattern: '/c', problem: 'no reason given' },
    ]);
  });
});

describe('the union set is exactly what the API route modules declare', () => {
  it('parses the API route tree, so the comparison is not vacuous', () => {
    expect(API_OPERATIONS.length).toBeGreaterThan(400);
    expect(API_OPERATIONS.map((entry) => entry.id)).toContain('rec.reception-create');
    // The web mirror of the contract and the parsed routes name the same operations.
    const published = new Set(PUBLISHED_OPERATIONS.map((entry) => entry.operationId));
    expect(API_OPERATIONS.filter((entry) => !published.has(entry.id)).map((e) => e.id)).toEqual([]);
  });

  it('matches the declarations in both directions', () => {
    const fromApi = API_OPERATIONS.filter((entry) => entry.union)
      .map((entry) => entry.id)
      .sort();
    expect([...UNION_OPERATIONS].sort()).toEqual(fromApi);
  });

  it('credits only a literal declaration inside the defineOperation object', () => {
    const source = `
      // branchNarrowing: 'authorized-union' — a comment is not a declaration.
      const NARROWING = 'authorized-union';
      export const A = defineOperation({ id: 'x.literal', method: 'GET', path: '/x', scope: 'branch', branchNarrowing: 'authorized-union' });
      export const B = defineOperation({ id: 'x.computed', method: 'GET', path: '/y', scope: 'branch', branchNarrowing: NARROWING });
      const D = { id: 'x.not-a-call', branchNarrowing: 'authorized-union' };
    `;
    expect(operationsDeclaredIn('probe.ts', source).map((o) => [o.id, o.union])).toEqual([
      ['x.literal', true],
      ['x.computed', false],
    ]);
  });
});

describe('what each route can call is derived from its source (PR #467 review)', () => {
  const walker = new RouteReachability(WEB_SOURCE, API_OPERATIONS);
  const derived = new Map(
    ROUTE_BRANCH_SCOPES.map((entry) => [
      entry.pattern,
      walker.reach(pageFile(WEB_SOURCE, entry.pattern)),
    ])
  );

  it('derives the calls the union boards are known to make', () => {
    expect(derivedIds(derived.get('/work-orders') as RouteReach)).toContain('wo.work-order-list');
    expect(derivedIds(derived.get('/invoices') as RouteReach)).toContain('sal.invoice-create');
    // The job picker's read is reached from the invoice desk — the read the
    // first table left out.
    expect(derivedIds(derived.get('/invoices') as RouteReach)).toContain('wo.work-order-list');
  });

  it.each(
    ROUTE_BRANCH_SCOPES.filter((entry) => entry.scope === 'union').map((e) => [e.pattern, e])
  )(
    'the union route %s reaches only union or tenant-wide reads, all of them resolved and declared',
    (_pattern, entry) => {
      const reach = derived.get(entry.pattern) as RouteReach;
      expect(unionProblems(reach)).toEqual([]);
      expect([...(entry.operations ?? [])].sort()).toEqual(derivedIds(reach));
    }
  );

  it.each(
    ROUTE_BRANCH_SCOPES.filter((entry) => entry.scope === 'concrete').map((e) => [e.pattern, e])
  )(
    'the concrete route %s reaches a branch- or company-scoped operation and reads the working branch',
    (_pattern, entry) => {
      const reach = derived.get(entry.pattern) as RouteReach;
      const scoped = reach.endpoints.filter(
        (endpoint) => endpoint.operation !== null && endpoint.operation.scope !== 'tenant'
      );
      expect(scoped.length).toBeGreaterThan(0);
      expect(
        reaches(
          reach.symbols,
          'features/working-context/use-branch-target.ts',
          'useBranchTarget'
        ) ||
          reaches(
            reach.symbols,
            'features/reports/components/use-working-report-scope.ts',
            'useWorkingReportScope'
          )
      ).toBe(true);
    }
  );

  it.each(ROUTE_BRANCH_SCOPES.filter((entry) => entry.scope === 'none').map((e) => [e.pattern, e]))(
    'the route %s, declared none, never reads the working branch as a target',
    (_pattern, entry) => {
      const reach = derived.get(entry.pattern) as RouteReach;
      expect(
        reaches(reach.symbols, 'features/working-context/use-branch-target.ts', 'useBranchTarget')
      ).toBe(false);
    }
  );
});

describe('the derivation refuses what it cannot vouch for', () => {
  const root = mkdtempSync(join(tmpdir(), 'route-scope-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const write = (rel: string, text: string) => {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  };
  const page = (name: string, adapter: string) => {
    write(
      `app/[locale]/(dashboard)/${name}/page.tsx`,
      `import { load } from '@/features/${name}/api';\nexport default async function Page() {\n  await load();\n  return null;\n}\n`
    );
    write(`features/${name}/api.ts`, adapter);
    return new RouteReachability(root, API_OPERATIONS).reach(pageFile(root, `/${name}`));
  };
  const CLIENT = `declare const client: { get(path: string): Promise<unknown>; send(method: string, path: string, body: unknown): Promise<unknown> };\n`;

  it('accepts a page whose only call is a union read (the positive control)', () => {
    const reach = page(
      'board',
      `${CLIENT}export async function load() {\n  return client.get('/api/v1/work-orders' + '?q=x');\n}\nexport async function unused() {\n  return client.send('POST', '/api/v1/receptions', {});\n}\n`
    );
    expect(unionProblems(reach)).toEqual([]);
    expect(derivedIds(reach)).toEqual(['wo.work-order-list']);
  });

  it('refuses a union page that reaches a one-branch read', () => {
    const reach = page(
      'handover',
      `${CLIENT}const PATH = '/api/v1/delivery-readiness';\nexport async function load() {\n  return client.get(PATH);\n}\n`
    );
    expect(unionProblems(reach)).toEqual([
      'reaches sal.delivery-readiness-list, narrowed to a branch and not an authorized-union read',
    ]);
  });

  it('refuses a union page that reaches a write through a wrapper and a path builder', () => {
    const reach = page(
      'limits',
      `${CLIENT}async function send(method: string, path: string) {\n  return client.send(method, path, {});\n}\nconst limitPath = (id: string, suffix = '') => \`/api/v1/iam/approval-limits/\${id}\${suffix}\`;\nexport async function load() {\n  return send('PATCH', limitPath('a'));\n}\n`
    );
    expect(derivedIds(reach)).toEqual(['iam.approval-limit-end']);
    expect(unionProblems(reach)).toHaveLength(1);
    expect(unionProblems(reach)[0]).toMatch(/^reaches the write iam\.approval-limit-end/);
  });

  it('refuses a union page with an endpoint it cannot resolve', () => {
    const reach = page(
      'mystery',
      `import { somewhere } from 'an-outside-package';\nexport async function load() {\n  return somewhere('/api/v1/work-orders');\n}\n`
    );
    const problems = unionProblems(reach);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^unresolved \(method is not a literal\): \? \/api\/v1\/work-orders/
    );
  });

  it('refuses a union page whose path matches no published operation', () => {
    const reach = page(
      'invented',
      `${CLIENT}export async function load() {\n  return client.get('/api/v1/no-such-resource');\n}\n`
    );
    expect(unionProblems(reach)).toEqual([
      expect.stringMatching(
        /^unresolved \(matches no published operation\): GET \/api\/v1\/no-such-resource/
      ),
    ]);
  });
});

describe('the route checklist states the table', () => {
  it('lists every route with the scope and reason the table gives it, and nothing else', () => {
    const text = readFileSync(CHECKLIST, 'utf8');
    const start = text.indexOf('### Scope per route');
    expect(start).toBeGreaterThan(-1);
    const section = text.slice(start, text.indexOf('\n### ', start + 1));
    const rows = section
      .split('\n')
      .map((line) =>
        /^\|\s*`([^`]+)`\s*\|\s*(union|concrete|none)\s*\|\s*(.+?)\s*\|\s*$/.exec(line)
      )
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => [match[1], match[2], match[3]]);
    const expected = [...ROUTE_BRANCH_SCOPES]
      .map((entry) => [entry.pattern, entry.scope, entry.why])
      .sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
    expect(rows.sort((a, b) => (a[0] as string).localeCompare(b[0] as string))).toEqual(expected);
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
