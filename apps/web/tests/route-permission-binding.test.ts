import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

/**
 * The JOINT between a session's permissions and a screen's write props
 * (`P1-27-SEC-003`).
 *
 * ## Why this file exists
 *
 * The phase proved both halves of this gate and never the wire between them.
 *
 *   - the COMPONENT half: `write-permission-gating.dom.test.tsx` asserts both
 *     directions per surface, given a `canX` prop;
 *   - the PERMISSION half: `vehicle-contract.test.ts` pins the permission
 *     constants' string values.
 *
 * What actually decides the security property is the handful of
 * `canEdit={holds(session.permissions, …)}` lines that connect them, and those
 * live in `src/app/**` — the one tree the phase's own gate does not scan
 * (`check-p1-27-frontend.mjs`), and a tree its tests read only as TEXT.
 *
 * `R4`: this sentence used to end "…for an import-ordering rule", which is
 * false and unflattering to the wrong people. `p1-27-security.test.ts` reads
 * every phase route as text for two SECURITY rules — that `holds(` appears
 * before the first `await read|list|search`, and that each route failure state
 * carries a correlation reference. Both are real and neither is import
 * ordering. What no source sweep can do is see the VALUE a prop is bound to,
 * which is the gap this file fills; the original sentence overstated that gap
 * by understating the sweeps.
 *
 * That is this phase's recurring shape one level up. It is not "a docblock
 * stating a rule the code does not implement"; it is two proven halves and an
 * unproven wire. `WRITE_PERMISSIONS` once had exactly one reference — its own
 * declaration — while ten write forms rendered for any reader; the fix wired it,
 * and the proof still stopped at the component boundary.
 *
 * ## How it is asserted
 *
 * The route module is INVOKED with a synthesised session and its returned
 * element tree is walked for the screen's props. No DOM render, so no client
 * component machinery is involved and nothing here depends on how the screen
 * chooses to draw.
 *
 * A pairing, never a single direction: each capability is asserted true when the
 * session holds exactly that permission and false when the session holds every
 * OTHER permission. A one-directional test passes against `canEdit={true}`.
 */

let PERMISSIONS: string[] = [];

vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'operator@test.local' }),
}));

const VEHICLE = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  displayNumber: 'V-0001',
  vin: '1HGCM82633A004352',
  makeId: null,
  makeName: null,
  modelId: null,
  modelName: null,
  trimId: null,
  trimName: null,
  bodyTypeId: null,
  bodyTypeName: null,
  powertrainTypeId: null,
  powertrainTypeName: null,
  modelYear: 2019,
  powertrainCategory: 'ev',
  color: null,
  lifecycleStatus: 'active',
  workshopStatus: 'none',
  mergedIntoId: null,
  recordVersion: 1,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: null,
};

vi.mock('@/features/vehicles/profile-api', () => ({
  readVehicle: async () => ({ status: 'ok', data: VEHICLE, correlationId: 'cid' }),
}));
vi.mock('@/features/vehicles/relations-api', () => ({
  readEvProfile: async () => ({ status: 'none' }),
}));
vi.mock('@/features/vehicles/documents-api', () => ({
  listVehicleDocuments: async () => ({ status: 'ok', documentIds: [] }),
}));

const { VEHICLE_PERMISSIONS, CRM_PERMISSIONS } = await import('@/features/crm/permissions');
const { DOCUMENT_LIST_PERMISSION } = await import('@/features/vehicles/documents-contract');
const VehiclePage = (await import('@/app/[locale]/(dashboard)/vehicles/[vehicleId]/page')).default;

/** Every permission the vehicle profile route consults. */
const ALL = [
  VEHICLE_PERMISSIONS.vehicleRead,
  VEHICLE_PERMISSIONS.vehicleManage,
  VEHICLE_PERMISSIONS.statusManage,
  VEHICLE_PERMISSIONS.relationshipManage,
  VEHICLE_PERMISSIONS.odometerRecord,
  CRM_PERMISSIONS.vehicleManage,
];

/** Walks a returned element tree for the first node carrying `vehicle`. */
function findScreenProps(node: unknown): Record<string, unknown> | null {
  if (node === null || typeof node !== 'object') return null;
  const element = node as ReactElement<Record<string, unknown>>;
  const props = element.props;
  if (props && typeof props === 'object' && 'vehicle' in props) {
    return props as Record<string, unknown>;
  }
  if (!props || typeof props !== 'object') return null;
  const children = (props as { children?: unknown }).children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findScreenProps(child);
    if (found) return found;
  }
  return null;
}

async function propsFor(permissions: readonly string[]): Promise<Record<string, unknown>> {
  PERMISSIONS = [...permissions];
  const tree = await VehiclePage({
    params: Promise.resolve({ locale: 'en', vehicleId: VEHICLE.id }),
  });
  const props = findScreenProps(tree);
  expect(props, 'the route did not render the profile screen').not.toBeNull();
  return props as Record<string, unknown>;
}

beforeEach(() => {
  PERMISSIONS = [];
});

describe('the vehicle profile route grants each capability from its OWN permission', () => {
  const CASES: readonly { prop: string; permission: string }[] = [
    { prop: 'canEdit', permission: VEHICLE_PERMISSIONS.vehicleManage },
    { prop: 'canChangeStatus', permission: VEHICLE_PERMISSIONS.statusManage },
    { prop: 'canManageRelationships', permission: VEHICLE_PERMISSIONS.relationshipManage },
    { prop: 'canRecordOdometer', permission: VEHICLE_PERMISSIONS.odometerRecord },
    // A CRM capability, held independently of every vehicle one.
    { prop: 'canLinkCustomer', permission: CRM_PERMISSIONS.vehicleManage },
  ];

  it('found distinct permissions to test with', () => {
    // If two constants ever collapsed to the same string, every pairing below
    // would pass while proving nothing.
    expect(new Set(ALL).size).toBe(ALL.length);
  });

  for (const { prop, permission } of CASES) {
    it(`grants ${prop} for ${permission} and for nothing else`, async () => {
      const granted = await propsFor([VEHICLE_PERMISSIONS.vehicleRead, permission]);
      expect(granted[prop], `${prop} was withheld from a holder of ${permission}`).toBe(true);

      // Every OTHER permission, and not this one. This is the direction that
      // catches a hard-coded `true` and a copy-pasted wrong constant at once —
      // the defect that left ten write forms rendering for any reader.
      const others = ALL.filter((p) => p !== permission);
      const denied = await propsFor(others);
      expect(denied[prop], `${prop} was granted without ${permission}`).toBe(false);
    });
  }

  it('reads the documents list only for a holder of the document capability', async () => {
    // Inverted relative to every other vehicle sub-resource: a MANAGE capability
    // from a different module gates a READ. A denied operator must not spend an
    // `expensive-read` slot discovering they cannot see it.
    const denied = await propsFor([VEHICLE_PERMISSIONS.vehicleRead]);
    expect(denied['canListDocuments']).toBe(false);
    expect(denied['documents']).toMatchObject({ status: 'denied' });

    /*
     * `R2` — the POSITIVE half, which this file's docblock promised for every
     * capability and this one capability never had.
     *
     * It had exactly one assertion, the negative one, against a session holding
     * only `veh.vehicle.read`. `holds` is exact membership, so that session
     * yields false for every code; nothing anywhere in the file ever made
     * `canListDocuments` true. The negative direction alone is satisfied by
     * `canListDocuments={false}` hard-coded, which is the defect the pairing
     * rule exists to catch — asserted for five capabilities and skipped for the
     * sixth, in a file whose entire subject is that a single direction proves
     * nothing.
     */
    const allowed = await propsFor([VEHICLE_PERMISSIONS.vehicleRead, DOCUMENT_LIST_PERMISSION]);
    expect(
      allowed['canListDocuments'],
      'no session in this file ever made canListDocuments true'
    ).toBe(true);
  });
});
