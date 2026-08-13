import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ROUTE_ID_PLACEHOLDER, safeRoute, templateRoute } from '@/lib/observability/client-log';

/**
 * `P1-28-DO-002` — every failure an operator can SEE on the appointment and
 * reception surface carries the one thing support can trace, and nothing that
 * leaves the browser carries a record identifier.
 *
 * ## Why this file exists at all, and what it is the ONLY governance of
 *
 * `route-correlation-binding.test.ts` proves a related property for P1-27, and
 * this docblock used to summarise it as "its corpus is `src/app/**` — every
 * `page.tsx`, including this phase's eight. So the ROUTE half of the apt/rec
 * surface was already governed." Read against that file, the second sentence is
 * false, and it is false in the direction that makes deleting a cover look free.
 *
 * What that file really does, sweep by sweep:
 *
 *   - Its `PermissionDeniedState` classifier runs over every `page.tsx` under
 *     `src/app`, unfiltered. That half of the apt/rec route surface IS governed
 *     twice, and this file's own denial cases agree with it by construction.
 *   - Its RECOVERABLE-failure sweep — the one that requires `<ErrorState>` and
 *     `<BackendUnavailableState>` to carry the reference — filters the page list
 *     to `/(crm|vehicles)/` first (`the scoped surface stays the surface`). The
 *     eight appointment and reception pages are walked and then discarded.
 *
 * So for the property this file is chiefly about — a recoverable failure
 * reaching the operator with something to quote — **this file is the only
 * governance of the apt/rec ROUTE half, not merely of the screens.** Nothing
 * else in the repository would fail if an appointment page dropped its
 * reference.
 *
 * The screen half was never governed at all. This phase renders almost all of
 * its failures from client components under `src/features/appointments` and
 * `src/features/receptions` — thirteen wizard steps, two queues, a booking form,
 * a walk-in intake — and a sweep scoped to `src/app` cannot see one of them. A
 * reception step that rendered `<ErrorState messages={messages} />` after a
 * failed evidence write would have left the operator with "something went wrong"
 * and nothing to quote, with every tier green.
 *
 * ## The rule, and where each half of it comes from
 *
 * The platform convention is not "print the reference everywhere". It is
 * decided per state, and `DataTable` is where it is written in code:
 *
 *   - `denied` (from the backend), `unavailable` and `error` CARRY it — a
 *     request was made, the API logged it, and the operator is about to phone
 *     somebody about it.
 *   - `expired` and `not-found` do NOT. Neither is a fault; a reference beside
 *     "your session ended" invites a support ticket for a working system.
 *   - A denial decided IN THE CLIENT — the permission gate a page runs before
 *     its first read — carries nothing either, because no request was made and
 *     whatever it printed would appear in no server log.
 *
 * Both directions are asserted. A missing reference on a backend failure is the
 * defect; an invented one on a client gate is a different defect that reads
 * exactly like diligence.
 *
 * ## Structural, never textual
 *
 * Classification runs over the TypeScript AST. This repository has watched a
 * scanner read prose as code seven times, and this very file quotes
 * `<ErrorState messages={messages} />` in its own docblock — a text scan would
 * count that sentence as a violation. A comment is not JSX, so the parser
 * cannot see it.
 */

const SRC = join(process.cwd(), 'src');
const REPO = join(process.cwd(), '..', '..');

/**
 * The trees this rule reads — DERIVED from `canonical-plan.md` §9.
 *
 * ## Why this is no longer three route directories written by hand
 *
 * It was `features/appointments`, `features/receptions`, and then
 * `(dashboard)/appointments`, `(dashboard)/receptions`, `(dashboard)/reception`
 * — the three route segments, named one at a time. §9 does not name route
 * segments. It names three PATHS, and the third is the whole `(dashboard)`
 * group:
 *
 *   > Frontend work lives in `apps/web/src/features/appointments/**`,
 *   > `apps/web/src/features/receptions/**` and
 *   > `apps/web/src/app/[locale]/(dashboard)/**`.
 *
 * The difference is not cosmetic. Everything else in the group — the layout, the
 * navigation shell, the error boundary that catches a crash inside a wizard
 * step, and every page a P1-28 screen links to — was outside every root this
 * file had, so a failure state rendered there was governed by nothing. That is
 * the same shape as the `SCAN_ROOTS` omission `check-p1-27-frontend.mjs` records
 * in its own docblock, one file later, and it was not latent: closing it found a
 * shipped `ErrorState` with no reference on it.
 *
 * Reading the sentence rather than transcribing it means a fourth path cannot be
 * forgotten the way the second one was.
 */
export function planRoots(): readonly string[] {
  const plan = readFileSync(
    join(REPO, 'docs', 'phase-1', 'phase-1-28', 'canonical-plan.md'),
    'utf8'
  );
  const section = plan.slice(plan.indexOf('## 9. Ownership boundary'), plan.indexOf('## 10.'));
  const sentence = section.slice(section.indexOf('Frontend work lives in'));
  const paths = [...sentence.matchAll(/`(apps\/web\/src\/[^`]*?)\/\*\*`/g)].map(
    (match) => match[1]
  );
  return [...new Set(paths)] as readonly string[];
}

const PLAN_ROOTS = planRoots();
const CORPUS_ROOTS = PLAN_ROOTS.map((root) => join(process.cwd(), '..', '..', ...root.split('/')));

/** Repository-relative, POSIX-separated. `join` yields `\` on Windows, and a
 *  pattern written with `/` then selects nothing there — `P1-27-SEC-004`. */
function posix(path: string): string {
  return path.split(sep).join('/');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(entry.name)) out.push(path);
  }
  return out;
}

const CORPUS = CORPUS_ROOTS.flatMap((root) => walk(root)).map((path) => ({
  file: posix(path).split('/src/')[1] as string,
  text: readFileSync(path, 'utf8'),
}));

/* ------------------------------------------------------------------ *
 * The classifier
 * ------------------------------------------------------------------ */

/** The five states these screens can render, and what each owes. */
const CARRIES = ['ErrorState', 'BackendUnavailableState'] as const;
const CARRIES_NOTHING = ['SessionExpiredState', 'NotFoundState'] as const;
const CONDITIONAL = 'PermissionDeniedState';

type DenialKind = 'backend' | 'client-gate' | 'unclassified';

interface Site {
  readonly file: string;
  readonly line: number;
  readonly tag: string;
  readonly kind: DenialKind;
  readonly carriesReference: boolean;
}

/**
 * Does this element hand `correlationId` on?
 *
 * TWO shapes, because the codebase legitimately uses both. A plain attribute
 * (`correlationId={result.correlationId ?? undefined}`) is what the routes
 * write; a conditional spread (`{...(correlationId ? { correlationId } : {})}`)
 * is what a component with `exactOptionalPropertyTypes` writes, and reading
 * only the first would have reported eleven correct components as violations.
 * The spread is inspected as an AST subtree, so a comment mentioning the name
 * inside it is still invisible.
 */
function passesReference(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  source: ts.SourceFile
): boolean {
  return node.attributes.properties.some((property) => {
    if (ts.isJsxAttribute(property)) {
      return property.name.getText(source) === 'correlationId';
    }
    const mentions = (child: ts.Node): boolean => {
      if (ts.isIdentifier(child) && child.text === 'correlationId') return true;
      return ts.forEachChild(child, mentions) ?? false;
    };
    return mentions(property.expression);
  });
}

/**
 * Every state element in one source, classified by the branch that DECIDED it.
 *
 * `backend` — the nearest enclosing condition compares a `status` to `'denied'`,
 * or names a local bound to such a comparison. A request was made and refused.
 *
 * `client-gate` — the condition calls `holds(...)`, reads a `capabilities.*`
 * flag, or names a `can…`/`has…`/`is…` binding. Decided before anything was
 * asked.
 *
 * Both an `if` statement and a conditional EXPRESSION are searched: the wizard
 * steps branch with `?:` inside JSX and a classifier that only understood `if`
 * would have filed every one of them `unclassified`, which is the state that
 * invites somebody to relax the rule rather than teach it to read.
 */
function sitesIn(fileName: string, text: string): readonly Site[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const found: Site[] = [];

  const readsDeniedStatus = (node: ts.Node): boolean => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      const sides = [node.left, node.right];
      const named = sides
        .map((side) =>
          ts.isPropertyAccessExpression(side)
            ? side.name.text
            : ts.isIdentifier(side)
              ? side.text
              : null
        )
        .filter((name): name is string => name !== null);
      const literals = sides.filter(ts.isStringLiteralLike).map((side) => side.text);
      if (named.includes('status') && literals.includes('denied')) return true;
    }
    return ts.forEachChild(node, readsDeniedStatus) ?? false;
  };

  const CAPABILITY_NAME = /^(can|has|is|may)[A-Z]/;
  const readsCapability = (node: ts.Node): boolean => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'holds'
    ) {
      return true;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'capabilities'
    ) {
      return true;
    }
    if (ts.isIdentifier(node) && CAPABILITY_NAME.test(node.text)) return true;
    return ts.forEachChild(node, readsCapability) ?? false;
  };

  /** Local names bound to either test, so a hoisted gate still reads as one. */
  const aliasesFor = (test: (node: ts.Node) => boolean): ReadonlySet<string> => {
    const names = new Set<string>();
    const collect = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        test(node.initializer)
      ) {
        names.add(node.name.text);
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
    return names;
  };

  const statusAliases = aliasesFor(readsDeniedStatus);
  const gateAliases = aliasesFor(readsCapability);
  const mentions = (node: ts.Node, names: ReadonlySet<string>): boolean => {
    if (ts.isIdentifier(node) && names.has(node.text)) return true;
    return ts.forEachChild(node, (child) => mentions(child, names)) ?? false;
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const governed: readonly string[] = [...CARRIES, ...CARRIES_NOTHING, CONDITIONAL];
      if (governed.includes(tag)) {
        let ancestor: ts.Node | undefined = node.parent;
        let condition: ts.Expression | undefined;
        while (ancestor) {
          if (ts.isIfStatement(ancestor)) {
            condition = ancestor.expression;
            break;
          }
          if (ts.isConditionalExpression(ancestor)) {
            condition = ancestor.condition;
            break;
          }
          ancestor = ancestor.parent;
        }
        const backend = condition
          ? readsDeniedStatus(condition) || mentions(condition, statusAliases)
          : false;
        const gate = condition
          ? readsCapability(condition) || mentions(condition, gateAliases)
          : false;
        found.push({
          file: fileName,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          tag,
          // Both or neither is `unclassified` on purpose: a branch that reads as
          // each is not one this rule may guess about.
          kind: backend === gate ? 'unclassified' : backend ? 'backend' : 'client-gate',
          carriesReference: passesReference(node, source),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const SITES = CORPUS.flatMap((entry) => sitesIn(entry.file, entry.text));
const at = (site: Site) => `${site.file}:${site.line}`;

/* ------------------------------------------------------------------ *
 * The sweep
 * ------------------------------------------------------------------ */

describe('the apt/rec failure surface is really being read', () => {
  it('takes its roots from the plan sentence, and reads all three of them', () => {
    /*
     * The derivation, held to its authority. §9 names three paths and this
     * reads three; if the sentence is reworded so that a path stops being
     * matched, the count moves and this fails rather than the sweep quietly
     * narrowing — which is exactly how the third root came to be three route
     * segments instead of the whole `(dashboard)` group.
     */
    expect(PLAN_ROOTS).toEqual([
      'apps/web/src/features/appointments',
      'apps/web/src/features/receptions',
      'apps/web/src/app/[locale]/(dashboard)',
    ]);
    // Floors, not equalities. A screen added tomorrow must fail for BREAKING
    // the rule, never for having been added — an equality pin is what stops a
    // sweep checking things.
    expect(CORPUS.length, 'the P1-28 corpus is empty').toBeGreaterThanOrEqual(55);
    for (const tree of ['features/appointments/', 'features/receptions/', '(dashboard)/']) {
      expect(
        CORPUS.some((entry) => entry.file.includes(tree)),
        `no file was collected from ${tree}`
      ).toBe(true);
    }
  });

  it('reaches the parts of the (dashboard) group the three segments excluded', () => {
    /*
     * The measurement that makes the widening real rather than cosmetic. Rooted
     * at three route segments the corpus was 36 files; rooted at the group the
     * plan actually names it is 62, and the twenty-six that arrived include the
     * layout, the error boundary and every page a P1-28 screen links to. A file
     * outside every root is governed by nothing, whatever the rule says.
     */
    const files = CORPUS.map((entry) => entry.file);
    for (const outside of [
      'app/[locale]/(dashboard)/error.tsx',
      'app/[locale]/(dashboard)/layout.tsx',
      'app/[locale]/(dashboard)/not-found.tsx',
      'app/[locale]/(dashboard)/page.tsx',
    ]) {
      expect(files, `${outside} is collected by no root`).toContain(outside);
    }
  });

  it('finds every governed state, with each kind actually represented', () => {
    expect(SITES.length, 'no failure state was found anywhere').toBeGreaterThanOrEqual(40);
    for (const tag of [...CARRIES, ...CARRIES_NOTHING, CONDITIONAL]) {
      expect(
        SITES.some((site) => site.tag === tag),
        `<${tag}> is rendered nowhere in the P1-28 surface — the classifier stopped seeing it`
      ).toBe(true);
    }
  });
});

describe('a recoverable failure reaches the operator with its reference', () => {
  it('carries it on every ErrorState and BackendUnavailableState', () => {
    const untraceable = SITES.filter(
      (site) => (CARRIES as readonly string[]).includes(site.tag) && !site.carriesReference
    ).map(at);
    expect(
      untraceable,
      'these render a recoverable failure without its reference, so an operator has nothing to ' +
        `quote and support has nothing to search: ${untraceable.join(', ')}`
    ).toEqual([]);
  });

  it('carries it on a backend denial, and never on a client-side gate', () => {
    const denials = SITES.filter((site) => site.tag === CONDITIONAL);
    expect(denials.length).toBeGreaterThanOrEqual(10);

    const unclassified = denials.filter((site) => site.kind === 'unclassified').map(at);
    expect(
      unclassified,
      'a denial is decided by neither a capability nor a read outcome, so no rule here applies ' +
        `to it: ${unclassified.join(', ')}`
    ).toEqual([]);

    const backend = denials.filter((site) => site.kind === 'backend');
    const gate = denials.filter((site) => site.kind === 'client-gate');
    expect(backend.length, 'no backend 403 branch was recognised').toBeGreaterThanOrEqual(3);
    expect(gate.length, 'no client-side gate was recognised').toBeGreaterThanOrEqual(6);

    expect(
      backend.filter((site) => !site.carriesReference).map(at),
      'the API logged this refusal and the screen prints nothing an operator can quote'
    ).toEqual([]);
    expect(
      gate.filter((site) => site.carriesReference).map(at),
      'this denial was decided before any request, so whatever it prints is in no server log'
    ).toEqual([]);
  });

  it('prints nothing on an ended session or a missing record', () => {
    /*
     * The other direction, and the one that is broken by diligence. Neither is
     * a fault: retrying will not help, and a reference beside "your session
     * ended" sends an operator to support about a system that is working.
     */
    const invented = SITES.filter(
      (site) => (CARRIES_NOTHING as readonly string[]).includes(site.tag) && site.carriesReference
    ).map(at);
    expect(invented, `these invent a reference for a non-fault: ${invented.join(', ')}`).toEqual(
      []
    );
  });
});

describe('the classifier itself, proved against sources built by hand', () => {
  it('tells the four verdicts apart and cannot be fooled by prose', () => {
    const sites = sitesIn(
      'fixture.tsx',
      [
        'export function Step({ capabilities, status, correlationId }) {',
        '  const canOpen = holds(session.permissions, X);',
        '  if (!canOpen) return <PermissionDeniedState messages={m} />;',
        "  if (status === 'denied') {",
        '    return <PermissionDeniedState messages={m} {...(correlationId ? { correlationId } : {})} />;',
        '  }',
        '  return !capabilities.readVehicles ? (',
        '    <PermissionDeniedState messages={m} />',
        '  ) : somethingElse ? (',
        '    <PermissionDeniedState messages={m} />',
        '  ) : null;',
        '  /* A docblock may quote <PermissionDeniedState correlationId={x} /> freely. */',
        '  // and so may a line comment: <ErrorState />',
        '}',
      ].join('\n')
    );

    expect(sites.map((site) => site.kind)).toEqual([
      'client-gate',
      'backend',
      'client-gate',
      'unclassified',
    ]);
    expect(sites.map((site) => site.carriesReference)).toEqual([false, true, false, false]);
    // Four, not six: the parser is what makes the two comment lines invisible.
    expect(sites, 'a comment was read as a rendered state').toHaveLength(4);
  });

  it('reads a conditional spread as passing the reference, and an unrelated one as not', () => {
    const sites = sitesIn(
      'spread.tsx',
      [
        "if (status === 'denied') {",
        '  return <ErrorState messages={m} {...(correlationId ? { correlationId } : {})} />;',
        '}',
        "if (other === 'denied') {",
        '  return <ErrorState messages={m} {...rest} />;',
        '}',
      ].join('\n')
    );
    expect(sites.map((site) => site.carriesReference)).toEqual([true, false]);
  });
});

describe('nothing that leaves the browser names a reception or an appointment', () => {
  /**
   * The monitoring half. `report` sends `route` to a configured sink, and the
   * P1-28 surface is the first in the product whose deep routes are ALL record
   * identifiers: a visit id, an appointment id. Untemplated, a stream of
   * `/receptions/check-in/3f2a…/acknowledgement failed at 09:14` is a record of
   * which vehicle was in the workshop and when — and it is also ten thousand
   * routes seen once each, which is a list rather than a signal.
   */
  const REAL_ROUTES = [
    '/en/appointments/9f1c4d2e-7b3a-4c58-9e21-0a6d8f4b1c33',
    '/ar/receptions/check-in/3f2a91b0-64c7-4d1e-8a55-2b90fe71c4d6',
    '/en/receptions/check-in/3f2a91b0-64c7-4d1e-8a55-2b90fe71c4d6/acknowledgement',
  ];

  it('templates every record identifier out of a P1-28 route', () => {
    for (const route of REAL_ROUTES) {
      const templated = templateRoute(route);
      expect(templated, `${route} kept a record identifier`).not.toMatch(
        /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}/
      );
      expect(templated).toContain(ROUTE_ID_PLACEHOLDER);
      // And it still names something: a template that collapsed to `/:id/:id`
      // would be private and useless at the same time.
      expect(
        templated.split('/').filter((s) => s && s !== ROUTE_ID_PLACEHOLDER).length
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the walk-in hand-off parameters out of the reported route', () => {
    // The walk-in seam carries the chosen customer and vehicle to the wizard in
    // the query string, which is exactly the place `safeRoute` exists for.
    const href =
      '/en/receptions/check-in?customerId=9f1c4d2e-7b3a-4c58-9e21-0a6d8f4b1c33&vehicleId=3f2a91b0-64c7-4d1e-8a55-2b90fe71c4d6';
    expect(safeRoute(href)).toBe('/en/receptions/check-in');
    expect(safeRoute(href)).not.toContain('customerId');
  });

  it('is falsifiable — an untemplated route really does keep the identifier', () => {
    // Without this the three cases above pass against a `templateRoute` that
    // replaced everything, and against one that replaced nothing but was never
    // compared with the raw form.
    expect(REAL_ROUTES[0]).toMatch(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}/);
    expect(templateRoute('/en/receptions')).toBe('/en/receptions');
  });
});

describe('every P1-28 screen sits under the boundary that reports a render failure', () => {
  it('places all eight pages inside the (dashboard) group that owns error.tsx', () => {
    /*
     * A crash inside a wizard step is not a handled failure and reaches no
     * adapter of its own. `(dashboard)/error.tsx` is what catches it, reports
     * the digest and the templated route through `report`, and shows the digest
     * as the reference. That only holds while every P1-28 route is inside that
     * group — a page moved one directory up loses the boundary silently.
     */
    const pages = CORPUS.filter((entry) => entry.file.endsWith('page.tsx')).map(
      (entry) => entry.file
    );
    expect(pages.length, 'no P1-28 page was collected').toBeGreaterThanOrEqual(8);
    for (const page of pages) {
      expect(page, `${page} is outside the (dashboard) route group`).toContain('(dashboard)/');
    }
    const boundary = readFileSync(join(SRC, 'app', '[locale]', '(dashboard)', 'error.tsx'), 'utf8');
    expect(boundary).toContain("from '@/lib/observability/client-log'");
    expect(boundary).toContain('report({');
  });
});
