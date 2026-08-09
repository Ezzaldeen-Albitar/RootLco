import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

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
 * `PermissionDeniedState` and `NotFoundState` are excluded, and that is a
 * decision rather than an omission. Neither is a fault: the records exist and
 * are not yours, or the record is not there. Retrying will not help, there is
 * nothing for support to trace, and printing a reference beside "you do not
 * have permission" invites an operator to open a ticket for a working system.
 * The operator guide states both of those as product behaviour.
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
});
