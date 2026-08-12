import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import {
  BackendUnavailableState,
  ErrorState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';

/**
 * Every recoverable failure a P1-27 route can render carries its reference
 * (`P1-27-SEC-004`).
 *
 * ## Why a source sweep was the wrong instrument
 *
 * `p1-27-security.test.ts` asserts that each adapter's source mentions
 * `correlationId`. That is real — it is what keeps the value flowing out of the
 * transport layer — but it cannot see the last step, which is where `SEC-004`
 * actually failed: the CRM profile route READ the reference correctly, held it
 * in `result.correlationId`, and then rendered
 * `<BackendUnavailableState messages={messages} />` without passing it. Every
 * source sweep stayed green, because the word was in the file.
 *
 * A word being present in a file is not the same as a value reaching a screen.
 * So this file INVOKES each route and walks the returned element tree for the
 * node that actually renders, then reads the prop off it.
 *
 * ## Which states are in scope, and which deliberately are not
 *
 * Only RECOVERABLE backend failures. The reference exists so an operator can
 * quote it to support after being told to try again — it is the difference
 * between a report support can trace and "it broke this morning".
 *
 * `PermissionDeniedState` and `NotFoundState` are outside the REQUIREMENT, and
 * that is a decision rather than an omission. Neither is a fault: the records
 * exist and are not yours, or the record is not there. Retrying will not help,
 * and a reference printed beside "you do not have permission" invites an
 * operator to open a ticket for a working system. The operator guide states
 * both of those as product behaviour.
 *
 * Outside the requirement is not the same as forbidden, and the line falls
 * between two different denials rather than around the component. A denial
 * decided IN THE CLIENT — the permission gate every route runs before its first
 * read — has no reference because no request was made. A denial the BACKEND
 * issued does have one: a request was made, the API answered 403 and logged it.
 * `DataTable` carries it on every list in the product — named without a line
 * number because this cited `:134` while the branch sat at `:135`, and guarded
 * now by `data-table.dom.test.tsx` rather than by this file, whose corpus is
 * `src/app/**` and cannot see a shared component at all — and both profile
 * routes carry it on their own 403, so a route dropping it would make one 403
 * traceable through a list and untraceable through a profile.
 *
 * That distinction USED to be stated here and asserted in one direction only —
 * the client gate was required to carry nothing, and the backend branch was
 * required to carry anything at all by nothing whatsoever. Removing
 * `correlationId` from the vehicle profile's 403 left the entire web tier green.
 * The paragraph was true and it was not a test, which is this phase's dominant
 * defect class written about itself. Both directions are now measured, per
 * BRANCH rather than per component, in "a denial the backend issued is
 * traceable" below.
 *
 * Six of the eight P1-27 routes render only `PermissionDeniedState` — they do no
 * failable server-side read, deferring their reads to a client table — so the
 * two asserted here are the whole recoverable surface.
 *
 * That last sentence is DERIVED, not asserted: the final case walks the route
 * tree and fails if any page renders a recoverable state this file does not
 * invoke. It was a bare claim in this docblock first, which is precisely the
 * defect class the phase keeps producing — a document stating a rule the code
 * does not implement — so it was made checkable instead of reworded.
 */

let PERMISSIONS: string[] = [];
const readCustomer = vi.fn();
const readVehicle = vi.fn();

vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'operator@test.local' }),
}));

vi.mock('@/features/crm/customers/profile-api', () => ({
  readCustomer: (...a: unknown[]) => readCustomer(...a),
}));
vi.mock('@/features/vehicles/profile-api', () => ({
  readVehicle: (...a: unknown[]) => readVehicle(...a),
}));
vi.mock('@/features/vehicles/relations-api', () => ({
  readEvProfile: async () => ({ status: 'none' }),
}));
vi.mock('@/features/vehicles/documents-api', () => ({
  listVehicleDocuments: async () => ({ status: 'ok', documentIds: [] }),
}));

const { CRM_PERMISSIONS, VEHICLE_PERMISSIONS } = await import('@/features/crm/permissions');
const CustomerPage = (await import('@/app/[locale]/(dashboard)/crm/customers/[customerId]/page'))
  .default;
const VehiclePage = (await import('@/app/[locale]/(dashboard)/vehicles/[vehicleId]/page')).default;

/** The reference the transport produced. Distinct per route, so a hard-coded
 *  string in a component could not satisfy both. */
const CRM_REFERENCE = 'corr-crm-7f3a';
const VEHICLE_REFERENCE = 'corr-veh-91b2';

/**
 * Walks a rendered tree for the first node carrying a `correlationId` prop.
 *
 * Returns the prop's value, `null` when a node was found without one, and
 * `undefined` when no failure state is in the tree at all. Those three are kept
 * apart deliberately: "rendered the state and dropped the reference" is the
 * defect, and "rendered no state" is a broken test rather than a passing one.
 */
function findCorrelation(node: unknown): string | null | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findCorrelation(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const element = node as ReactElement<Record<string, unknown>>;
  const props = element.props;
  if (props && typeof props === 'object') {
    // A state component is recognised by taking `messages` and no children —
    // not by name, so a rename cannot silently drop it out of the sweep.
    if ('correlationId' in props) {
      const value = props['correlationId'];
      return typeof value === 'string' ? value : null;
    }
    if ('children' in props) return findCorrelation(props['children']);
  }
  return undefined;
}

/**
 * Whether a rendered tree contains a given component, by IDENTITY.
 *
 * Not by name: a renamed export, or a second component that happens to be
 * called `SessionExpiredState`, would satisfy a string comparison while the
 * operator saw something else entirely. The imported binding is the thing the
 * route must render.
 */
function rendersState(node: unknown, component: unknown): boolean {
  if (node === null || node === undefined || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((child) => rendersState(child, component));
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === component) return true;
  const props = element.props;
  if (props && typeof props === 'object' && 'children' in props) {
    return rendersState(props['children'], component);
  }
  return false;
}

/** Every JSX tag a file RENDERS, read with the TypeScript parser. */
function jsxTagsIn(file: string): ReadonlySet<string> {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const tags = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      tags.add(node.tagName.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return tags;
}

/**
 * Which denial a `<PermissionDeniedState>` belongs to, and whether it carries
 * the reference.
 *
 * `client-gate` is decided in this process before any request is made;
 * `backend` is a 403 the API issued and logged. `unclassified` is neither, and
 * it FAILS rather than being skipped — a third shape of denial arriving with no
 * rule attached is the case a "check the ones we recognise" sweep would wave
 * through.
 */
type DenialKind = 'backend' | 'client-gate' | 'unclassified';

interface DenialSite {
  readonly file: string;
  readonly line: number;
  readonly kind: DenialKind;
  readonly carriesReference: boolean;
}

/**
 * Every `<PermissionDeniedState>` in a source, classified by the branch that
 * DECIDED it.
 *
 * Classification is structural, over the AST of the nearest enclosing `if`
 * condition — a `===` against a `.status` property with the literal `'denied'`
 * is a backend outcome; a call to `holds` is the client-side gate. Not text: a
 * condition's `getText()` would drag in any comment written inside it, and this
 * repository has watched a scanner read prose as code six times. The parser also
 * cannot see the `<PermissionDeniedState correlationId={…} />` this very file
 * quotes in its docblocks, because a comment is not JSX.
 *
 * Both tests resolve local ALIASES, for the reason the `h1` route guard resolves
 * `const header = (<PageHeader …/>)`: system settings hoists its two gates
 * (`const canReadCompany = holds(…)`) and branches on
 * `!canReadCompany && !canReadBranch`, so a test that only recognised a literal
 * call would have filed the most permission-dense page in the product as
 * "unclassified" — and whoever met that would have relaxed the rule rather than
 * taught it to read.
 */
function denialSitesIn(fileName: string, text: string): readonly DenialSite[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const sites: DenialSite[] = [];

  /** `result.status === 'denied'` — a request was made and the API refused it. */
  const readsDeniedStatus = (node: ts.Node): boolean => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      const sides = [node.left, node.right];
      const properties = sides.filter(ts.isPropertyAccessExpression).map((side) => side.name.text);
      const literals = sides.filter(ts.isStringLiteralLike).map((side) => side.text);
      if (properties.includes('status') && literals.includes('denied')) return true;
    }
    return ts.forEachChild(node, readsDeniedStatus) ?? false;
  };

  /** `holds(session.permissions, …)` — refused here, before anything was asked. */
  const callsHolds = (node: ts.Node): boolean => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'holds'
    ) {
      return true;
    }
    return ts.forEachChild(node, callsHolds) ?? false;
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

  const gateAliases = aliasesFor(callsHolds);
  const statusAliases = aliasesFor(readsDeniedStatus);

  const mentions = (node: ts.Node, names: ReadonlySet<string>): boolean => {
    if (ts.isIdentifier(node) && names.has(node.text)) return true;
    return ts.forEachChild(node, (child) => mentions(child, names)) ?? false;
  };

  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === 'PermissionDeniedState'
    ) {
      const carriesReference = node.attributes.properties.some(
        (property) =>
          ts.isJsxAttribute(property) && property.name.getText(source) === 'correlationId'
      );
      let ancestor: ts.Node | undefined = node.parent;
      let condition: ts.Expression | undefined;
      while (ancestor) {
        if (ts.isIfStatement(ancestor)) {
          condition = ancestor.expression;
          break;
        }
        ancestor = ancestor.parent;
      }
      const backend = condition
        ? readsDeniedStatus(condition) || mentions(condition, statusAliases)
        : false;
      const gate = condition ? callsHolds(condition) || mentions(condition, gateAliases) : false;
      // Both or neither is `unclassified` on purpose: a branch that reads as
      // each is not one this rule may guess about.
      const kind: DenialKind =
        backend === gate ? 'unclassified' : backend ? 'backend' : 'client-gate';
      sites.push({
        file: fileName,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        kind,
        carriesReference,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/** Every `page.tsx` under `src/app`, repository-path and text. */
function routeSources(): readonly { readonly file: string; readonly text: string }[] {
  const root = join(process.cwd(), 'src', 'app');
  const out: { file: string; text: string }[] = [];
  /*
   * `withFileTypes`, so the directory decision comes from the entry the
   * directory read already returned rather than from a second `statSync` on the
   * path. The two-call shape is a check-then-use window — CodeQL reported it
   * HIGH as `js/file-system-race` against a ceiling of 0 — and the window is
   * real even here: a path can stop being a directory between the stat and the
   * read. Every sibling sweep in this repository already reads entries this way.
   */
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'page.tsx') {
        out.push({
          file: path.replace(/\\/g, '/').split('/src/app/')[1] as string,
          text: readFileSync(path, 'utf8'),
        });
      }
    }
  };
  walk(root);
  return out;
}

beforeEach(() => {
  readCustomer.mockReset();
  readVehicle.mockReset();
});

describe('a recoverable backend failure reaches the operator with its reference', () => {
  it('CRM customer profile — the surface SEC-004 was reported against', async () => {
    /*
     * The exact regression. This route rendered `BackendUnavailableState` with
     * `messages` alone: the operator was told to try again and given nothing to
     * quote, on the one state that has no other content to identify it.
     */
    PERMISSIONS = [CRM_PERMISSIONS.customerRead];
    readCustomer.mockResolvedValue({ status: 'unavailable', correlationId: CRM_REFERENCE });

    const tree = await CustomerPage({
      params: Promise.resolve({ locale: 'en', customerId: 'c-1' }),
    } as never);

    expect(
      findCorrelation(tree),
      'the failure state rendered without the reference support needs'
    ).toBe(CRM_REFERENCE);
  });

  it('vehicle profile — the same property on the other tree', async () => {
    PERMISSIONS = [VEHICLE_PERMISSIONS.vehicleRead];
    readVehicle.mockResolvedValue({ status: 'error', correlationId: VEHICLE_REFERENCE });

    const tree = await VehiclePage({
      params: Promise.resolve({ locale: 'en', vehicleId: 'v-1' }),
    } as never);

    expect(findCorrelation(tree)).toBe(VEHICLE_REFERENCE);
  });

  it('passes the reference through rather than inventing one', async () => {
    /*
     * Both routes above would pass against a component that generated its own
     * id. The values differ per route and are asserted exactly, and here the
     * transport supplies none: the prop must then be absent rather than a
     * fabricated string an operator would quote to support in vain.
     */
    PERMISSIONS = [CRM_PERMISSIONS.customerRead];
    readCustomer.mockResolvedValue({ status: 'unavailable', correlationId: null });

    const tree = await CustomerPage({
      params: Promise.resolve({ locale: 'en', customerId: 'c-1' }),
    } as never);

    const found = findCorrelation(tree);
    expect(found, 'a reference was invented for a response that carried none').not.toBe(
      CRM_REFERENCE
    );
    expect([null, undefined]).toContain(found);
  });
});

describe('a denial is not a fault, and carries no reference', () => {
  it('says so rather than offering support a ticket for a working system', async () => {
    /*
     * The opposite direction, and the reason the sweep is scoped rather than
     * universal. A permission denial is not a fault: the records exist and are
     * not this operator's to see, retrying cannot help, and support has nothing
     * to trace. Asserting a reference everywhere would have forced one here.
     */
    PERMISSIONS = [];
    readCustomer.mockResolvedValue({ status: 'ok', data: {}, correlationId: CRM_REFERENCE });

    const tree = await CustomerPage({
      params: Promise.resolve({ locale: 'en', customerId: 'c-1' }),
    } as never);

    expect(findCorrelation(tree)).toBeUndefined();
    // And the read never happened — the route refuses before it asks.
    expect(readCustomer, 'a denied caller still reached the backend').not.toHaveBeenCalled();
  });
});

/**
 * A denial the BACKEND issued is traceable; a denial the CLIENT decided is not.
 *
 * ## The gap this closes
 *
 * `PermissionDeniedState` is outside the recoverable-failure requirement above,
 * and that is correct — but "outside the requirement" was read as "measured by
 * nothing". Both profile routes pass `correlationId={result.correlationId ??
 * undefined}` on their 403 branch, and an adversarial pass deleted that prop
 * from the vehicle profile and ran the ENTIRE web tier: every case passed. The
 * one 403 an operator can reach through a profile had become the one 403 support
 * cannot find in the log, and nothing in this repository objected.
 *
 * ## Why BOTH a real invocation and a source rule, when the brief allows either
 *
 * They fail for different reasons and neither subsumes the other.
 *
 * The INVOCATION is the discriminating half. It drives the real route
 * composition — the same import, the same `readVehicle`, the same branch order —
 * and asserts the exact reference the transport produced arrives at the screen.
 * A source rule cannot do that: `correlationId={'x'}`, or a component that
 * generates its own id, satisfies "the attribute is present" while an operator
 * quotes a number support has never seen. Each route's reference is distinct and
 * asserted exactly, so one hard-coded string cannot satisfy both.
 *
 * The SOURCE rule is the general half. Invocation proves the two routes that
 * exist; it says nothing about the third, which is written next month by copying
 * one of these two and inherits the defect with every case here still green —
 * exactly how the duplicate-`h1` defect survived its own fix in this phase. So
 * the corpus is `src/app/**` and every `<PermissionDeniedState>` in it is
 * classified by the branch that decided it, structurally, from the AST.
 *
 * ## Why the rule is per BRANCH and not per component
 *
 * Fourteen of the sixteen denial sites this sweep classifies are the
 * client-side gate, where no request was made and no reference exists. (Sixteen
 * is what the corpus holds; twenty-one such sites exist across `src/**`, and the
 * difference is the roots this sweep walks — see the scope note below.) A rule
 * reading "this component always carries a reference" would demand one from all
 * fourteen, and
 * the only way to satisfy it is to invent a token an operator would quote to
 * support in vain. So the two denials are told apart by their deciding
 * condition, and each gets the direction it deserves.
 */
describe('a denial the backend issued is traceable', () => {
  it('vehicle profile — the 403 an adversarial pass silently untraced', async () => {
    PERMISSIONS = [VEHICLE_PERMISSIONS.vehicleRead];
    readVehicle.mockResolvedValue({ status: 'denied', correlationId: VEHICLE_REFERENCE });

    const tree = await VehiclePage({
      params: Promise.resolve({ locale: 'en', vehicleId: 'v-1' }),
    } as never);

    // Two INDEPENDENT walks of the same tree: one finds the denial state, the
    // other finds the reference. Deliberately not localised to a single node —
    // this asserts that the route rendered a denial AND carried the reference,
    // not that the reference hangs off that particular element. A review proved
    // the point by passing this case with the prop on <PageHeader>, so the
    // weaker claim is the one written here.
    expect(
      rendersState(tree, PermissionDeniedState),
      'the backend 403 did not render as a permission denial'
    ).toBe(true);
    expect(
      findCorrelation(tree),
      '[locale]/(dashboard)/vehicles/[vehicleId]/page.tsx: the backend 403 reached the operator ' +
        'without the reference the API logged — support cannot find this refusal'
    ).toBe(VEHICLE_REFERENCE);
  });

  it('CRM customer profile — the twin, with its own distinct reference', async () => {
    PERMISSIONS = [CRM_PERMISSIONS.customerRead];
    readCustomer.mockResolvedValue({ status: 'denied', correlationId: CRM_REFERENCE });

    const tree = await CustomerPage({
      params: Promise.resolve({ locale: 'en', customerId: 'c-1' }),
    } as never);

    expect(rendersState(tree, PermissionDeniedState)).toBe(true);
    expect(
      findCorrelation(tree),
      '[locale]/(dashboard)/crm/customers/[customerId]/page.tsx: the backend 403 reached the ' +
        'operator without the reference the API logged'
    ).toBe(CRM_REFERENCE);
  });

  it('vehicle profile — the CLIENT gate on the same route carries nothing', async () => {
    /*
     * The other direction, on the SAME route, so the pair cannot be satisfied by
     * a component that always prints a reference. The gate runs before the read:
     * nothing was asked, so there is nothing to quote.
     */
    PERMISSIONS = [];

    const tree = await VehiclePage({
      params: Promise.resolve({ locale: 'en', vehicleId: 'v-1' }),
    } as never);

    expect(rendersState(tree, PermissionDeniedState)).toBe(true);
    expect(
      findCorrelation(tree),
      'the client-side gate invented a reference for a request that was never made'
    ).toBeUndefined();
    expect(readVehicle, 'a denied caller still reached the backend').not.toHaveBeenCalled();
  });

  it('invents nothing when the backend 403 itself carried no reference', async () => {
    /*
     * The third state. A 403 whose response had no reference must render the
     * denial with no reference — not with a fabricated one, and not by falling
     * out of the branch.
     */
    PERMISSIONS = [VEHICLE_PERMISSIONS.vehicleRead];
    readVehicle.mockResolvedValue({ status: 'denied', correlationId: null });

    const tree = await VehiclePage({
      params: Promise.resolve({ locale: 'en', vehicleId: 'v-1' }),
    } as never);

    expect(rendersState(tree, PermissionDeniedState)).toBe(true);
    const found = findCorrelation(tree);
    expect(found, 'a reference was invented for a 403 that carried none').not.toBe(
      VEHICLE_REFERENCE
    );
    expect([null, undefined]).toContain(found);
  });

  it('holds for every denial in the route tree, derived rather than listed', () => {
    const sites = routeSources().flatMap((route) => denialSitesIn(route.file, route.text));

    /*
     * Anti-vacuity first. A classifier that stopped matching returns an empty
     * corpus, and a sweep over an empty corpus is green over any amount of the
     * defect. Floors, not equalities: a route added tomorrow must fail for
     * BREAKING the rule, never for having been added — a hand-written list is
     * what stops checking things.
     */
    expect(
      sites.length,
      'no <PermissionDeniedState> was found in src/app/** at all'
    ).toBeGreaterThanOrEqual(14);
    const backend = sites.filter((site) => site.kind === 'backend');
    const gate = sites.filter((site) => site.kind === 'client-gate');
    expect(backend.length, 'no backend 403 branch was recognised').toBeGreaterThanOrEqual(2);
    expect(gate.length, 'no client-side gate was recognised').toBeGreaterThanOrEqual(10);

    /*
     * The two routes that read on the server, named because they are the pair
     * the invocation cases above drive. If the classifier ever stops seeing one
     * of them, this says which.
     *
     * CONTAINMENT, not equality. An equality pin here would fail the day someone
     * adds a THIRD server-reading route that carries its reference correctly —
     * punishing correct code for existing, inside a case whose own name is
     * 'derived rather than listed'. The rule that governs a new route is the
     * sweep below, which requires every backend branch to carry the reference;
     * this only guarantees the two the invocation cases pin are still seen.
     */
    const recognised = backend.map((site) => site.file);
    for (const known of [
      '[locale]/(dashboard)/crm/customers/[customerId]/page.tsx',
      '[locale]/(dashboard)/vehicles/[vehicleId]/page.tsx',
    ]) {
      expect(recognised, `the classifier stopped recognising ${known}`).toContain(known);
    }

    const unclassified = sites
      .filter((site) => site.kind === 'unclassified')
      .map((site) => `${site.file}:${site.line}`);
    expect(
      unclassified,
      'a denial is decided by neither a permission gate nor a read outcome, so no rule below ' +
        `applies to it: ${unclassified.join(', ')}`
    ).toEqual([]);

    const untraceable = backend
      .filter((site) => !site.carriesReference)
      .map((site) => `${site.file}:${site.line}`);
    expect(
      untraceable,
      'these render a BACKEND 403 without its reference — the API logged the refusal and the ' +
        `operator has nothing to quote: ${untraceable.join(', ')}`
    ).toEqual([]);

    const invented = gate
      .filter((site) => site.carriesReference)
      .map((site) => `${site.file}:${site.line}`);
    expect(
      invented,
      'these carry a reference on a denial decided BEFORE any request, so whatever they print ' +
        `cannot be in any server log: ${invented.join(', ')}`
    ).toEqual([]);
  });

  it('really classifies denials by branch, and cannot be fooled by prose', () => {
    /*
     * The sweep above is only as good as `denialSitesIn`. All three verdicts are
     * stated here against sources built by hand, in one file, so a classifier
     * that collapsed to a single answer fails here and names itself rather than
     * turning the sweep green.
     */
    const sites = denialSitesIn(
      'fixture.tsx',
      [
        'export function Page() {',
        '  const canRead = holds(session.permissions, X);',
        '  if (!holds(session.permissions, X)) {',
        '    return <PermissionDeniedState messages={messages} />;',
        '  }',
        "  if (result.status === 'denied') {",
        '    return <PermissionDeniedState messages={messages} correlationId={result.correlationId} />;',
        '  }',
        // The hoisted form system settings actually uses.
        '  if (!canRead) {',
        '    return <PermissionDeniedState messages={messages} />;',
        '  }',
        '  if (somethingElse) {',
        '    return <PermissionDeniedState messages={messages} />;',
        '  }',
        '  /* A docblock may quote <PermissionDeniedState correlationId={x} /> freely. */',
        '  // and so may a line comment: <PermissionDeniedState />',
        '  return null;',
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
    // The parser is what makes the comment lines invisible; a text scan would
    // have read six sites here, two of them from prose.
    expect(sites, 'a comment was read as a rendered denial').toHaveLength(4);
  });
});

describe('the scoped surface stays the surface', () => {
  it('finds no P1-27 route rendering a recoverable failure this file does not invoke', () => {
    /*
     * The sentence at the head of this file — "the two asserted here are the
     * whole recoverable surface" — was written before anything checked it. Two
     * routes carry a recoverable state today; a third that starts reading
     * server-side would inherit exactly the `SEC-004` defect and no case here
     * would notice, which is how this phase's dominant defect class gets in.
     *
     * So the claim is derived rather than asserted: the route tree is walked and
     * every page rendering a recoverable state must be one of the two invoked
     * above. Adding a third fails here, naming it.
     */
    const routes = join(process.cwd(), 'src', 'app');
    const pages: string[] = [];
    const walk = (dir: string) => {
      // Entry-typed, for the same reason as `routeSources` above: a stat after
      // a readdir is a check-then-use window CodeQL reports as
      // `js/file-system-race`.
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name === 'page.tsx') pages.push(path);
      }
    };
    walk(routes);

    const phasePages = pages.filter((p) => /[\\/](crm|vehicles)[\\/]/.test(p));
    expect(phasePages.length, 'the route tree must be findable').toBeGreaterThanOrEqual(8);

    // The two states that mean "a fault happened, try again" — the only ones a
    // reference is useful for. A denial and a not-found are neither.
    const recoverable = phasePages.filter((p) =>
      /<(ErrorState|BackendUnavailableState)\b/.test(readFileSync(p, 'utf8'))
    );
    const named = recoverable.map((p) => p.replace(/\\/g, '/').split('/src/app/')[1]).sort();

    expect(named, 'a P1-27 route renders a recoverable failure this file never invokes').toEqual([
      '[locale]/(dashboard)/crm/customers/[customerId]/page.tsx',
      '[locale]/(dashboard)/vehicles/[vehicleId]/page.tsx',
    ]);
  });
});

/**
 * An ended session is told to the operator as an ended session.
 *
 * ## The defect
 *
 * The vehicle profile branched on `not-found`, `denied` and `ok`, and let
 * everything else fall into `ErrorState`. `expired` is reachable on both ways
 * `readOperation` can produce it — `authorizedClient()` returning nothing
 * (`read-operation.ts:54`) and `STATUS_BY_KIND.unauthenticated` — so an operator
 * whose session had simply ended was told the service had failed. They retry
 * against a dead session, or they phone support about a system that is working.
 *
 * The CRM twin renders `SessionExpiredState` for it, and `DataTable` renders it
 * for every list on every screen. The vehicle profile was the single outlier
 * among the pages that read on the server, which the last case here derives
 * rather than assumes.
 *
 * ## Scope, stated rather than implied
 *
 * The P1-27 task matrix has no `EXPIRED_STATE` field. This is a product
 * inconsistency between two twins — not a canonical requirement being violated —
 * and it is asserted here at the strength it deserves: a page that turns a read
 * outcome into the whole screen must be able to say "your session ended",
 * because that outcome is one the read can return.
 */
describe('an ended session reads as an ended session, not as a server fault', () => {
  it('vehicle profile — the outlier', async () => {
    PERMISSIONS = [VEHICLE_PERMISSIONS.vehicleRead];
    readVehicle.mockResolvedValue({ status: 'expired', correlationId: null });

    const tree = await VehiclePage({
      params: Promise.resolve({ locale: 'en', vehicleId: 'v-1' }),
    } as never);

    expect(
      rendersState(tree, SessionExpiredState),
      'an ended session did not reach the operator as an ended session'
    ).toBe(true);
    expect(rendersState(tree, ErrorState), 'an ended session was reported as a fault').toBe(false);
  });

  it('CRM customer profile — the twin this was measured against', async () => {
    PERMISSIONS = [CRM_PERMISSIONS.customerRead];
    readCustomer.mockResolvedValue({ status: 'expired', correlationId: null });

    const tree = await CustomerPage({
      params: Promise.resolve({ locale: 'en', customerId: 'c-1' }),
    } as never);

    expect(rendersState(tree, SessionExpiredState)).toBe(true);
    expect(rendersState(tree, BackendUnavailableState)).toBe(false);
  });

  it('every page that turns a read outcome into the screen can say the session ended', () => {
    /*
     * Derived, not hand-listed.
     *
     * A written list of routes is what let the duplicate-`h1` defect survive its
     * own fix in this phase: the fix was correct and the list did not name the
     * file that still had it. So the corpus is the route tree, and membership is
     * decided by what a page RENDERS — a page that maps a read outcome onto a
     * whole-screen state (`NotFoundState`, `ErrorState`,
     * `BackendUnavailableState`) has taken responsibility for that read's
     * outcomes, and `expired` is one of them.
     *
     * The tags are read with the TypeScript parser rather than matched with a
     * regular expression. Every scanner in this phase that read source as text
     * eventually read prose in a docblock as code; the parser cannot, and it
     * also will not confuse `<ErrorState` in a comment with one that renders.
     *
     * `error.tsx` and `not-found.tsx` are excluded by the `page.tsx` filter and
     * belong outside it: they are Next.js boundaries for a thrown error and an
     * unmatched URL, not a mapping of a read this page performed.
     */
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name === 'page.tsx') pages.push(path);
      }
    };
    walk(join(process.cwd(), 'src', 'app'));
    expect(pages.length, 'the route tree must be findable').toBeGreaterThan(20);

    const OUTCOME_STATES = ['NotFoundState', 'ErrorState', 'BackendUnavailableState'];
    const readingPages = pages.filter((page) => {
      const tags = jsxTagsIn(page);
      return OUTCOME_STATES.some((state) => tags.has(state));
    });

    /*
     * Anti-vacuity, and the pair that reproduced this named on purpose: if a
     * rename empties this corpus the sweep must fail rather than pass.
     *
     * A floor and a membership check, NOT an equality. Pinning the exact set
     * would mean a third page that starts reading on the server fails here for
     * having been added rather than for the defect — and whoever hit that would
     * append it to the list and move on, which is precisely how a hand-written
     * list stops checking anything. Everything in the corpus is required to
     * handle `expired` below, whatever its size.
     */
    const named = readingPages.map((p) => p.replace(/\\/g, '/').split('/src/app/')[1]).sort();
    expect(
      named.length,
      'no page maps a read outcome onto the screen — the reader broke'
    ).toBeGreaterThanOrEqual(2);
    expect(named).toContain('[locale]/(dashboard)/crm/customers/[customerId]/page.tsx');
    expect(named).toContain('[locale]/(dashboard)/vehicles/[vehicleId]/page.tsx');

    const missing = readingPages
      .filter((page) => !jsxTagsIn(page).has('SessionExpiredState'))
      .map((p) => p.replace(/\\/g, '/').split('/src/app/')[1]);
    expect(missing, `no expired branch: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('this file is not vacuous', () => {
  it('really invoked routes that really rendered a failure state', async () => {
    /*
     * Every case above uses `findCorrelation`, which returns `undefined` both
     * for "no state rendered" and for a tree it failed to walk. A typo in the
     * mock path would make the denial case pass for the wrong reason, so the
     * positive direction is restated here against a tree built by hand — if the
     * walker stopped working, this fails first and names the walker.
     */
    expect(findCorrelation({ props: { correlationId: 'x' } })).toBe('x');
    expect(findCorrelation({ props: { children: { props: { correlationId: 'y' } } } })).toBe('y');
    expect(findCorrelation({ props: { children: [{ props: { correlationId: 'z' } }] } })).toBe('z');
    expect(findCorrelation({ props: { messages: {} } })).toBeUndefined();
    expect(findCorrelation({ props: { correlationId: undefined } })).toBeNull();
  });

  it('really tells one state component from another', () => {
    /*
     * `rendersState` compares by component IDENTITY, and a walker that always
     * returned `false` would make every "not a fault" assertion above pass. Both
     * directions are stated here against trees built by hand.
     */
    expect(rendersState({ type: SessionExpiredState, props: {} }, SessionExpiredState)).toBe(true);
    expect(rendersState({ type: ErrorState, props: {} }, SessionExpiredState)).toBe(false);
    expect(
      rendersState(
        { props: { children: [{ type: SessionExpiredState, props: {} }] } },
        SessionExpiredState
      )
    ).toBe(true);
    expect(rendersState(null, SessionExpiredState)).toBe(false);
  });

  it('really reads JSX tags out of a route rather than matching text', () => {
    // The vehicle profile names `SessionExpiredState` in an import, in a
    // docblock and in a rendered element. Only the last of those is a branch,
    // and a text match cannot tell them apart.
    const vehicle = join(
      process.cwd(),
      'src',
      'app',
      '[locale]',
      '(dashboard)',
      'vehicles',
      '[vehicleId]',
      'page.tsx'
    );
    const tags = jsxTagsIn(vehicle);
    expect(tags.has('SessionExpiredState')).toBe(true);
    expect(tags.has('PageBody')).toBe(true);
    // Named nowhere in that file, in any form.
    expect(tags.has('BackendUnavailableState')).toBe(false);
  });
});
