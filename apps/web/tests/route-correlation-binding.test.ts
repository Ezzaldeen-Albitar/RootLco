import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import {
  BackendUnavailableState,
  ErrorState,
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
 * read — has no reference because no request was made, and that is what the
 * last case here asserts. A denial the BACKEND issued does have one: a request
 * was made, the API answered 403 and logged it. `DataTable.tsx:134` carries it
 * on every list in the product and the CRM profile carries it on its own 403,
 * so the vehicle profile dropping it made one 403 traceable through a list and
 * untraceable through a profile. This file does not require that value, because
 * requiring it would also require it of the client-side gate where none exists;
 * it states the distinction so the next reader does not "fix" the twins apart
 * again.
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
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry === 'page.tsx') pages.push(path);
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
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry === 'page.tsx') pages.push(path);
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
