import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';

/**
 * `P1-27-SEC-001` / `P1-27-SEC-003` — the permission wire, proved END TO END.
 *
 * ## The gap this file closes
 *
 * Three things existed and none of them was this.
 *
 *   - `write-permission-gating.dom.test.tsx` renders `CustomerProfileScreen`
 *     with a `writes` prop it constructs itself. It proves the SCREEN honours a
 *     map. It never runs the route, so it cannot see where the map comes from.
 *   - `route-permission-binding.test.ts` invokes the VEHICLE route and reads the
 *     props off the returned element tree. Real route, but only vehicles, and
 *     no rendering — a prop that is `true` is not the same claim as a control an
 *     operator can see.
 *   - `p1-27-security.test.ts` reads routes as TEXT. Text cannot see a value.
 *
 * The customer profile route's ENTIRE write-permission binding is one
 * expression:
 *
 *   `writes={permittedWrites(session.permissions)}`
 *   — `src/app/[locale]/(dashboard)/crm/customers/[customerId]/page.tsx:130`
 *
 * Nine write surfaces hang off it. Before this file, replacing that expression
 * with a map of nine `true`s broke no test in the suite. That is the defect
 * `SEC-001` describes one level up: two proven halves and an unproven wire.
 *
 * ## What is asserted here
 *
 * The REAL route module is invoked with a synthesised session, and the element
 * tree it returns is RENDERED. Every assertion is therefore about a control an
 * operator can or cannot see, reached through the same code path production
 * uses: session → `permittedWrites` → screen → section → form.
 *
 * Every surface is asserted in BOTH directions:
 *
 *   granted — the session holds the read code and exactly this write code;
 *   denied  — the session holds the read code and EVERY OTHER distinct write
 *             code in the domain, and not this one.
 *
 * The denied direction is the load-bearing one. A session holding "everything
 * except this" fails against a hard-coded `true`, against a map of all-`true`,
 * and against a copy-pasted wrong constant — the three shapes this phase has
 * actually shipped. A test that only checked the granted direction would pass
 * against `writes={permittedWrites(ALL_PERMISSIONS)}`.
 *
 * Each case names its capability in its own title, so a failure says which
 * capability broke rather than which line number did.
 *
 * ## Not a security boundary, and this file does not pretend otherwise
 *
 * The Backend authorizes every request; hiding a control is courtesy. The last
 * describe here pins the one thing the web tier CAN be held to about server-side
 * denial, and says plainly what it cannot.
 */

/* ------------------------------------------------------------------ *
 * Session and shared stubs
 * ------------------------------------------------------------------ */

let PERMISSIONS: readonly string[] = [];

vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'operator@test.local' }),
}));

// `notFound()` throws in Next. A stub that returned would let a route continue
// past a locale rejection and render a screen this file would then measure.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const okPage = {
  status: 'ok' as const,
  rows: [] as unknown[],
  nextCursor: null,
  hasMore: false,
  correlationId: 'cid-list',
};
const listStub = async () => okPage;

/* ------------------------------------------------------------------ *
 * The customer profile route
 * ------------------------------------------------------------------ */

const CUSTOMER = {
  id: '2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f',
  displayNumber: 'C-0001',
  displayName: 'Nadia Khoury',
  partyType: 'individual',
  lifecycleStatus: 'active',
  commercialStatus: 'normal',
  recordVersion: 3,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: null,
  givenName: 'Nadia',
  familyName: 'Khoury',
  preferredLocale: 'ar',
  legalName: null,
  tradeName: null,
};

/** What `readCustomer` answers. Mutable, so the denial paths are reachable. */
let CUSTOMER_READ: Record<string, unknown> = {
  status: 'ok',
  data: CUSTOMER,
  correlationId: 'cid-read',
};

vi.mock('@/features/crm/customers/profile-api', () => ({
  readCustomer: async () => CUSTOMER_READ,
  listContacts: listStub,
  listAddresses: listStub,
  listPreferences: listStub,
  listConsents: listStub,
  listNotes: listStub,
  listAlerts: listStub,
  listTags: listStub,
  listRestrictions: listStub,
}));

vi.mock('@/features/crm/customers/identity-api', () => ({
  listTimeline: listStub,
  listDuplicates: listStub,
  reviewDuplicateAction: vi.fn(),
}));

/* ------------------------------------------------------------------ *
 * The vehicle profile route
 * ------------------------------------------------------------------ */

const VEHICLE = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  displayNumber: 'V-0001',
  vin: '1HGCM82633A004352',
  // Both ids present, so `labelFor` reaches `kind: 'value'` and the header
  // title is the assembled "Toyota Camry" rather than the display number — which
  // would otherwise appear twice on screen and make `findByText` ambiguous.
  makeId: 'a1b2c3d4-0000-4000-8000-0000000000aa',
  makeName: 'Toyota',
  modelId: 'a1b2c3d4-0000-4000-8000-0000000000bb',
  modelName: 'Camry',
  trimId: null,
  trimName: null,
  bodyTypeId: null,
  bodyTypeName: null,
  powertrainTypeId: null,
  powertrainTypeName: null,
  modelYear: 2019,
  // `ev`, so the electric-drive save is applicable and its gate is measurable.
  powertrainCategory: 'ev',
  color: null,
  // NOT merged and NOT scrapped: `frozen`/`terminal` would withhold controls for
  // a lifecycle reason, and this file is about the permission reason.
  lifecycleStatus: 'active',
  workshopStatus: 'none',
  mergedIntoId: null,
  recordVersion: 1,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: null,
};

vi.mock('@/features/vehicles/profile-api', () => ({
  readVehicle: async () => ({ status: 'ok', data: VEHICLE, correlationId: 'cid-veh' }),
  updateVehicleAction: vi.fn(),
  changeVehicleStatusAction: vi.fn(),
  checkVinAvailability: async () => ({ status: 'unknown' }),
}));

vi.mock('@/features/vehicles/relations-api', () => ({
  readEvProfile: async () => ({ status: 'none' }),
  listRelationships: listStub,
  setEvProfileAction: vi.fn(),
  linkCustomerAction: vi.fn(),
  authorizePartyAction: vi.fn(),
  retirePartyAction: vi.fn(),
}));

vi.mock('@/features/vehicles/history-api', () => ({
  listOwnerships: listStub,
  listPlates: listStub,
  listOdometerReadings: listStub,
  assignPlateAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
  recordOdometerAction: vi.fn(),
}));

vi.mock('@/features/vehicles/duplicates-api', () => ({
  listVehicleDuplicates: listStub,
  listAttributeHistory: listStub,
  reviewVehicleDuplicateAction: vi.fn(),
}));

vi.mock('@/features/vehicles/documents-api', () => ({
  listVehicleDocuments: async () => ({ status: 'ok', vehicleId: VEHICLE.id, documentIds: [] }),
}));

// The customer selector inside the vehicle link form searches the directory.
// Unmocked it reaches the authorized client and `cookies()` outside a request.
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: listStub,
}));

/* ------------------------------------------------------------------ *
 * Real modules, imported after the mocks are registered
 * ------------------------------------------------------------------ */

const { CRM_PERMISSIONS, VEHICLE_PERMISSIONS } = await import('@/features/crm/permissions');
const { WRITE_PERMISSIONS } = await import('@/features/crm/customers/governance-contract');
const { DOCUMENT_LIST_PERMISSION } = await import('@/features/vehicles/documents-contract');

const CustomerProfilePage = (
  await import('@/app/[locale]/(dashboard)/crm/customers/[customerId]/page')
).default;
const VehicleProfilePage = (await import('@/app/[locale]/(dashboard)/vehicles/[vehicleId]/page'))
  .default;

beforeEach(() => {
  PERMISSIONS = [];
  CUSTOMER_READ = { status: 'ok', data: CUSTOMER, correlationId: 'cid-read' };
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * A control, identified by ROLE and accessible name rather than by raw text.
 *
 * `textContent.includes(marker)` is not safe here and the vehicle screen proves
 * it: `vehicles.relationships.linkRoleHint` quotes the string "Authorise a
 * customer" inside its own sentence, so a text sweep would report the authorise
 * form present whenever the link form rendered. An accessible-name query cannot
 * confuse a paragraph with a button.
 */
interface Control {
  readonly role: 'button' | 'heading';
  readonly name: string;
}

function found({ role, name }: Control): number {
  return screen.queryAllByRole(role, { name }).length;
}

/** Renders a route's returned tree, exactly as the framework would. */
async function renderRoute(
  page: (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>,
  params: Record<string, string>,
  permissions: readonly string[]
) {
  PERMISSIONS = [...permissions];
  const tree = await page({ params: Promise.resolve(params) });
  return renderLtr(tree as React.ReactElement);
}

/**
 * Opens a section and waits for it to have finished loading.
 *
 * The wait is the anti-vacuity guard. Every table-backed section fetches in an
 * effect, so asserting "the form is absent" the instant after a click would pass
 * on a section that has not rendered anything yet — indistinguishable from a
 * working gate, and the exact way half a suite can pass for the wrong reason.
 */
async function openSection(
  container: HTMLElement,
  tabLabel: string | null,
  settle: { table: true } | { text: string }
) {
  if (tabLabel !== null) {
    await userEvent.setup().click(screen.getByRole('button', { name: tabLabel }));
  }
  if ('table' in settle) {
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
  } else {
    await screen.findByText(settle.text);
  }
}

/* ------------------------------------------------------------------ *
 * The customer profile route — nine write surfaces
 * ------------------------------------------------------------------ */

/**
 * Every controlled write surface reached through `CustomerProfileScreen`,
 * enumerated from the screen itself rather than from the contract.
 *
 * Eight are section forms (`CustomerProfileScreen.tsx:215-271`, one `canWrite`
 * each); the ninth is the lifecycle status form in the header
 * (`:170`, `canManageStatus`). Nine surfaces, five distinct capabilities.
 */
const CUSTOMER_SURFACES = [
  {
    id: 'contact',
    tab: en['crm.customers.profile.section.contacts'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['crm.customers.contacts.add'] } as Control,
    permission: WRITE_PERMISSIONS.contact,
  },
  {
    id: 'address',
    tab: en['crm.customers.profile.section.addresses'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['crm.customers.addresses.add'] } as Control,
    permission: WRITE_PERMISSIONS.address,
  },
  {
    id: 'preference',
    tab: en['crm.customers.profile.section.preferences'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['crm.customers.preferences.set'] } as Control,
    permission: WRITE_PERMISSIONS.preference,
  },
  {
    id: 'consent',
    tab: en['crm.customers.profile.section.consents'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['crm.customers.consents.record'] } as Control,
    permission: WRITE_PERMISSIONS.consent,
  },
  {
    id: 'note',
    tab: en['crm.customers.profile.section.notes'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['crm.customers.notes.add'] } as Control,
    permission: WRITE_PERMISSIONS.note,
  },
  {
    id: 'alert',
    tab: en['crm.customers.profile.section.alerts'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['crm.customers.alerts.raise'] } as Control,
    permission: WRITE_PERMISSIONS.alert,
  },
  {
    id: 'tag',
    tab: en['crm.customers.profile.section.tags'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['crm.customers.tags.assign'] } as Control,
    permission: WRITE_PERMISSIONS.tag,
  },
  {
    id: 'restriction',
    tab: en['crm.customers.profile.section.restrictions'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['crm.customers.restrictions.impose'] } as Control,
    permission: WRITE_PERMISSIONS.restriction,
  },
  {
    // The header form. No tab to click; it renders with the profile itself, so
    // the customer's own name is what proves the page got that far.
    id: 'status',
    tab: null,
    settle: { text: CUSTOMER.displayName } as const,
    control: { role: 'button', name: en['crm.customers.status.change'] } as Control,
    permission: WRITE_PERMISSIONS.status,
  },
] as const;

/** The five distinct customer write codes, derived — never listed twice. */
const CUSTOMER_WRITE_CODES = [...new Set(Object.values(WRITE_PERMISSIONS))];

async function renderCustomer(permissions: readonly string[]) {
  return renderRoute(
    CustomerProfilePage as never,
    { locale: 'en', customerId: CUSTOMER.id },
    permissions
  );
}

describe('the customer profile ROUTE binds each write surface to its own permission', () => {
  it('enumerates all nine surfaces and finds five distinct capabilities behind them', () => {
    // If the screen grows a tenth `canWrite` and this table does not, the count
    // here is what says so. `WriteKind` is exhaustive in the contract, so a
    // surface cannot be added without a permission — but it CAN be added
    // without a proof, and that is what this asserts.
    expect(CUSTOMER_SURFACES).toHaveLength(9);
    expect(Object.keys(WRITE_PERMISSIONS)).toHaveLength(9);
    expect(CUSTOMER_SURFACES.map((s) => s.id).sort()).toEqual(
      Object.keys(WRITE_PERMISSIONS).sort()
    );
    // Five, not nine. If these ever collapsed to one code, every "denied"
    // case below would be testing an empty permission set and proving nothing.
    expect(CUSTOMER_WRITE_CODES).toHaveLength(5);
  });

  for (const surface of CUSTOMER_SURFACES) {
    it(`offers the ${surface.id} write to a session holding ${surface.permission}`, async () => {
      const { container } = await renderCustomer([
        CRM_PERMISSIONS.customerRead,
        surface.permission,
      ]);
      await openSection(container, surface.tab, surface.settle);
      expect(
        found(surface.control),
        `the ${surface.id} write was withheld from a holder of ${surface.permission}`
      ).toBeGreaterThan(0);
    });

    it(`withholds the ${surface.id} write from a session holding every code EXCEPT ${surface.permission}`, async () => {
      // Everything but the one that governs this surface. This is the direction
      // that fails against a hard-coded `true`, against a map of all-`true`, and
      // against a wrong-but-sibling constant.
      const others = CUSTOMER_WRITE_CODES.filter((code) => code !== surface.permission);
      expect(others.length, 'the negative session must be non-trivial').toBe(4);

      const { container } = await renderCustomer([CRM_PERMISSIONS.customerRead, ...others]);
      await openSection(container, surface.tab, surface.settle);
      expect(
        found(surface.control),
        `the ${surface.id} write was offered without ${surface.permission}`
      ).toBe(0);
    });
  }

  it('offers nothing at all to a session holding only the read code', async () => {
    // The literal defect: an operator with `crm.customer.read` was shown nine
    // controls, every one of which answered 403 after they had typed.
    const { container } = await renderCustomer([CRM_PERMISSIONS.customerRead]);
    await openSection(container, null, { text: CUSTOMER.displayName });
    for (const surface of CUSTOMER_SURFACES) {
      if (surface.tab === null) {
        expect(found(surface.control), surface.id).toBe(0);
        continue;
      }
      await openSection(container, surface.tab, surface.settle);
      expect(found(surface.control), `${surface.id} was offered to a reader`).toBe(0);
    }
  });

  it('renders no profile at all without the read code', async () => {
    const { container } = await renderCustomer([
      // Every write code and no read code. A screen that rendered here would be
      // gating the writes and not the page.
      ...CUSTOMER_WRITE_CODES,
    ]);
    expect(await screen.findByText(en['state.denied.title'])).toBeTruthy();
    expect(container.textContent ?? '').not.toContain(CUSTOMER.displayName);
    for (const surface of CUSTOMER_SURFACES) {
      expect(found(surface.control), surface.id).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The vehicle profile route
 * ------------------------------------------------------------------ */

const VEHICLE_SURFACES = [
  {
    id: 'edit-details',
    tab: null,
    settle: { text: 'Toyota Camry' } as const,
    control: { role: 'heading', name: en['vehicles.profile.editHeading'] } as Control,
    permission: VEHICLE_PERMISSIONS.vehicleManage,
  },
  {
    id: 'change-status',
    tab: null,
    settle: { text: 'Toyota Camry' } as const,
    control: { role: 'heading', name: en['vehicles.profile.statusHeading'] } as Control,
    permission: VEHICLE_PERMISSIONS.statusManage,
  },
  {
    id: 'transfer-ownership',
    tab: en['vehicles.profile.section.ownership'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['vehicles.ownership.transfer'] } as Control,
    permission: VEHICLE_PERMISSIONS.relationshipManage,
  },
  {
    id: 'assign-plate',
    tab: en['vehicles.profile.section.plates'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['vehicles.plate.assign'] } as Control,
    permission: VEHICLE_PERMISSIONS.vehicleManage,
  },
  {
    id: 'record-odometer',
    tab: en['vehicles.profile.section.odometer'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['vehicles.odometer.record'] } as Control,
    permission: VEHICLE_PERMISSIONS.odometerRecord,
  },
  {
    id: 'save-ev-profile',
    tab: en['vehicles.profile.section.ev'],
    settle: { text: en['vehicles.ev.notRecordedYet'] } as const,
    control: { role: 'button', name: en['vehicles.ev.record'] } as Control,
    permission: VEHICLE_PERMISSIONS.vehicleManage,
  },
  {
    id: 'authorize-party',
    tab: en['vehicles.profile.section.relationships'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['vehicles.relationships.authorize'] } as Control,
    permission: VEHICLE_PERMISSIONS.relationshipManage,
  },
  {
    // A CRM capability on a vehicle screen, held independently of every vehicle
    // one — which is exactly why conflating it with `veh.vehicle.manage` would
    // be invisible in a test that only ever grants "all vehicle permissions".
    id: 'link-customer',
    tab: en['vehicles.profile.section.relationships'],
    settle: { table: true } as const,
    control: { role: 'button', name: en['vehicles.relationships.link'] } as Control,
    permission: CRM_PERMISSIONS.vehicleManage,
  },
] as const;

/** Every code the vehicle route consults, read gate excluded. */
const VEHICLE_WRITE_CODES = [
  VEHICLE_PERMISSIONS.vehicleManage,
  VEHICLE_PERMISSIONS.statusManage,
  VEHICLE_PERMISSIONS.relationshipManage,
  VEHICLE_PERMISSIONS.odometerRecord,
  CRM_PERMISSIONS.vehicleManage,
  DOCUMENT_LIST_PERMISSION,
];

async function renderVehicle(permissions: readonly string[]) {
  return renderRoute(
    VehicleProfilePage as never,
    { locale: 'en', vehicleId: VEHICLE.id },
    permissions
  );
}

describe('the vehicle profile ROUTE binds each write surface to its own permission', () => {
  it('found six distinct codes to pair against', () => {
    // Two of these live in different modules (`crm.` and `shared.`). If any two
    // collapsed to the same string every pairing below would pass vacuously.
    expect(new Set(VEHICLE_WRITE_CODES).size).toBe(VEHICLE_WRITE_CODES.length);
    expect(VEHICLE_WRITE_CODES).toHaveLength(6);
  });

  for (const surface of VEHICLE_SURFACES) {
    it(`offers ${surface.id} to a session holding ${surface.permission}`, async () => {
      const { container } = await renderVehicle([
        VEHICLE_PERMISSIONS.vehicleRead,
        surface.permission,
      ]);
      await openSection(container, surface.tab, surface.settle);
      expect(
        found(surface.control),
        `${surface.id} was withheld from a holder of ${surface.permission}`
      ).toBeGreaterThan(0);
    });

    it(`withholds ${surface.id} from a session holding every code EXCEPT ${surface.permission}`, async () => {
      const others = VEHICLE_WRITE_CODES.filter((code) => code !== surface.permission);
      expect(others.length, 'the negative session must be non-trivial').toBe(5);

      const { container } = await renderVehicle([VEHICLE_PERMISSIONS.vehicleRead, ...others]);
      await openSection(container, surface.tab, surface.settle);
      expect(
        found(surface.control),
        `${surface.id} was offered without ${surface.permission}`
      ).toBe(0);
    });
  }

  it('gates the documents list on a MANAGE code from another module, both ways', async () => {
    // Inverted relative to every other vehicle sub-resource: a read is gated by
    // `shared.document.manage`. The negative session holds every vehicle code.
    const denied = await renderVehicle([
      VEHICLE_PERMISSIONS.vehicleRead,
      ...VEHICLE_WRITE_CODES.filter((code) => code !== DOCUMENT_LIST_PERMISSION),
    ]);
    await openSection(denied.container, en['vehicles.profile.section.documents'], {
      text: en['vehicles.documents.needsOtherPermission'],
    });
    expect(denied.container.textContent ?? '').not.toContain(en['vehicles.documents.none']);
    denied.unmount();

    const allowed = await renderVehicle([
      VEHICLE_PERMISSIONS.vehicleRead,
      DOCUMENT_LIST_PERMISSION,
    ]);
    await openSection(allowed.container, en['vehicles.profile.section.documents'], {
      text: en['vehicles.documents.none'],
    });
    expect(allowed.container.textContent ?? '').not.toContain(
      en['vehicles.documents.needsOtherPermission']
    );
  });

  it('renders no vehicle at all without the read code', async () => {
    const { container } = await renderVehicle([...VEHICLE_WRITE_CODES]);
    expect(await screen.findByText(en['state.denied.title'])).toBeTruthy();
    expect(container.textContent ?? '').not.toContain(VEHICLE.vin);
  });
});

/* ------------------------------------------------------------------ *
 * Scope denial
 * ------------------------------------------------------------------ */

describe('a server-side denial reaching the route', () => {
  /*
   * ## What is reachable, and what is NOT
   *
   * A resolved-scope denial — "your session resolves to branch A and this
   * customer belongs to branch B" — is decided by the Backend. It is NOT
   * reachable as a distinct outcome from the web tier, and this file will not
   * invent one.
   *
   * Two reasons, both structural:
   *
   *   1. The client sends no scope. `p1-27-security.test.ts` pins that no CRM or
   *      vehicle module names `tenantId`, `companyId` or `branchId`, and
   *      `query()` THROWS if one is passed. So the web tier has nothing to
   *      assert a scope with and nothing to get wrong about one.
   *   2. The outcomes are deliberately indistinguishable on arrival. A denial
   *      arrives as `status: 'denied'` whatever its cause, and a customer in
   *      another tenant answers `ERR-RES-001` — the same 404 as absent,
   *      soft-deleted and merged-away — precisely so the endpoint is not an
   *      existence oracle (`page.tsx:24-31`).
   *
   * So the honest claim is not "a scope denial renders X". It is: whatever the
   * Backend refuses, the route renders a denial INSTEAD of the screen, and no
   * write surface survives it. That is asserted below, for both refusal shapes.
   */

  it('renders a denial and no write surface when the backend refuses the read', async () => {
    CUSTOMER_READ = { status: 'denied', correlationId: 'cid-denied' };
    // A session holding every write code, so nothing here is withheld for a
    // client-side reason. Only the server's answer is doing the work.
    const { container } = await renderCustomer([
      CRM_PERMISSIONS.customerRead,
      ...CUSTOMER_WRITE_CODES,
    ]);

    expect(await screen.findByText(en['state.denied.title'])).toBeTruthy();
    // The reference is carried out of the denial, or the operator has nothing
    // to quote when they report it.
    expect(container.textContent ?? '').toContain('cid-denied');
    expect(container.textContent ?? '').not.toContain(CUSTOMER.displayName);
    for (const surface of CUSTOMER_SURFACES) {
      expect(found(surface.control), surface.id).toBe(0);
    }
  });

  it('renders not-found — never a hint of which of the four causes it was', async () => {
    CUSTOMER_READ = { status: 'not-found', correlationId: 'cid-nf' };
    const { container } = await renderCustomer([
      CRM_PERMISSIONS.customerRead,
      ...CUSTOMER_WRITE_CODES,
    ]);

    const text = container.textContent ?? '';
    expect(await screen.findByText(en['state.notFound.title'])).toBeTruthy();
    // A cross-tenant record answers the same 404 as an absent one. If the copy
    // ever started speculating, the existence oracle is back.
    for (const leak of ['tenant', 'deleted', 'merged', 'another']) {
      expect(text.toLowerCase(), `the not-found state hints at "${leak}"`).not.toContain(leak);
    }
    for (const surface of CUSTOMER_SURFACES) {
      expect(found(surface.control), surface.id).toBe(0);
    }
  });

  it('leaves the section navigation out of a denial entirely', async () => {
    // Not cosmetic. A tab strip on a denial tells the operator the shape of the
    // record they were refused.
    CUSTOMER_READ = { status: 'denied', correlationId: 'cid-denied' };
    const { container } = await renderCustomer([CRM_PERMISSIONS.customerRead]);
    await screen.findByText(en['state.denied.title']);
    const nav = within(container).queryByRole('navigation', {
      name: en['crm.customers.profile.sections'],
    });
    expect(nav).toBeNull();
  });
});
