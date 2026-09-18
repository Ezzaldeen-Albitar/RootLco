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

/*
 * P1-32-PRE-069 — the Platform Owner Console routes. The platform session and
 * every console read are replaced so each route can be invoked with a chosen
 * set of platform authority codes and the reads it attempted can be counted.
 */
let PLATFORM_CODES: string[] = [];
const platformReads = vi.hoisted(() => ({
  readStatistics: vi.fn(),
  readOrganization: vi.fn(),
  listPlans: vi.fn(),
  listCharges: vi.fn(),
  listOrganizationChoices: vi.fn(),
}));
vi.mock('@/features/platform/api/session', () => ({
  requirePlatformSession: async () => ({
    userId: 'p-1',
    homeTenantId: 'h-1',
    platformPermissions: PLATFORM_CODES,
  }),
}));
vi.mock('@/features/platform/api', () => ({
  readStatistics: (...args: unknown[]) => platformReads.readStatistics(...args),
  readOrganization: (...args: unknown[]) => platformReads.readOrganization(...args),
  listPlans: (...args: unknown[]) => platformReads.listPlans(...args),
  listCharges: (...args: unknown[]) => platformReads.listCharges(...args),
  listOrganizationChoices: (...args: unknown[]) => platformReads.listOrganizationChoices(...args),
  // The paged helper the two browser-callable reads in `actions.ts` use. Those
  // two are Server Actions a client table calls after render, so no route below
  // reaches them; the export is stood in for so the actions module still loads.
  readPage: vi.fn(),
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

// --- P1-32-PRE-069: the Platform Owner Console routes ------------------------

type ConsoleRoute = (args: {
  params: Promise<Record<string, string>>;
  searchParams?: Promise<Record<string, string>>;
}) => Promise<unknown>;

const { PLATFORM_PERMISSIONS: P } = await import('@/features/platform/permissions');
const { PermissionDeniedState } = await import('@/components/states/States');
const ALL_PLATFORM_CODES: readonly string[] = Object.values(P);
const CONSOLE_TENANT = '11111111-1111-4111-8111-111111111111';
const CONSOLE_ORGANIZATION = {
  id: CONSOLE_TENANT,
  tenantCode: 'test_org',
  displayName: 'Test Organisation',
  status: 'active',
  defaultLocale: 'en',
  defaultTimezone: 'UTC',
  createdAt: '2026-09-01T00:00:00.000Z',
  companies: [],
  branches: [],
  userCountsByStatus: [],
  subscriptions: [],
  subscriptionEvents: [],
  statusHistory: [],
  capacity: {
    companies: { used: 0, limit: null },
    branches: { used: 0, limit: null },
    users: { used: 0, limit: null },
  },
};

const consoleRoutes = {
  overview: (await import('@/app/[locale]/(platform)/platform/page'))
    .default as unknown as ConsoleRoute,
  organizations: (await import('@/app/[locale]/(platform)/platform/organizations/page'))
    .default as unknown as ConsoleRoute,
  provision: (await import('@/app/[locale]/(platform)/platform/organizations/new/page'))
    .default as unknown as ConsoleRoute,
  detail: (await import('@/app/[locale]/(platform)/platform/organizations/[tenantId]/page'))
    .default as unknown as ConsoleRoute,
  plans: (await import('@/app/[locale]/(platform)/platform/plans/page'))
    .default as unknown as ConsoleRoute,
  audit: (await import('@/app/[locale]/(platform)/platform/audit/page'))
    .default as unknown as ConsoleRoute,
};

function rendersType(node: unknown, type: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.type === type) return true;
  const children = element.props?.children;
  return (Array.isArray(children) ? children : [children]).some((child) =>
    rendersType(child, type)
  );
}

function propsCarrying(node: unknown, prop: string): Record<string, unknown> | null {
  if (node === null || typeof node !== 'object') return null;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props || typeof props !== 'object') return null;
  if (prop in props) return props;
  const children = props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = propsCarrying(child, prop);
    if (found) return found;
  }
  return null;
}

function invokeConsole(route: ConsoleRoute, codes: readonly string[]) {
  PLATFORM_CODES = [...codes];
  return route({
    params: Promise.resolve({ locale: 'en', tenantId: CONSOLE_TENANT }),
    searchParams: Promise.resolve({}),
  });
}

describe('the Platform Owner Console routes decide on their own platform code before reading', () => {
  beforeEach(() => {
    for (const read of Object.values(platformReads)) read.mockReset();
    platformReads.readStatistics.mockResolvedValue({ status: 'error', correlationId: 'c' });
    platformReads.readOrganization.mockResolvedValue({
      status: 'ok',
      data: CONSOLE_ORGANIZATION,
      correlationId: 'c',
    });
    platformReads.listPlans.mockResolvedValue({
      status: 'ok',
      data: { items: [] },
      correlationId: 'c',
    });
    platformReads.listCharges.mockResolvedValue({
      status: 'ok',
      data: { items: [], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    platformReads.listOrganizationChoices.mockResolvedValue([]);
  });

  const GATES = [
    { name: 'overview', route: 'overview', code: P.statisticsRead, read: 'readStatistics' },
    { name: 'organisation list', route: 'organizations', code: P.organizationRead, read: null },
    { name: 'provisioning', route: 'provision', code: P.organizationProvision, read: 'listPlans' },
    {
      name: 'organisation detail',
      route: 'detail',
      code: P.organizationRead,
      read: 'readOrganization',
    },
    { name: 'plan catalogue', route: 'plans', code: P.subscriptionManage, read: 'listPlans' },
    { name: 'audit', route: 'audit', code: P.auditRead, read: 'listOrganizationChoices' },
  ] as const;

  it('found distinct platform codes to test with', () => {
    // Nine with platform.organization.manage, which the console gained when it
    // learned to add a company, open a branch and establish an administrator
    // inside an organisation that is already running.
    expect(new Set(ALL_PLATFORM_CODES).size).toBe(9);
  });

  for (const gate of GATES) {
    it(`${gate.name}: denies without ${gate.code} and reads nothing`, async () => {
      const tree = await invokeConsole(
        consoleRoutes[gate.route],
        ALL_PLATFORM_CODES.filter((code) => code !== gate.code)
      );
      expect(rendersType(tree, PermissionDeniedState)).toBe(true);
      for (const read of Object.values(platformReads)) expect(read).not.toHaveBeenCalled();
    });

    it(`${gate.name}: renders for a holder of ${gate.code}`, async () => {
      const tree = await invokeConsole(consoleRoutes[gate.route], ALL_PLATFORM_CODES);
      expect(rendersType(tree, PermissionDeniedState)).toBe(false);
      if (gate.read) expect(platformReads[gate.read]).toHaveBeenCalled();
    });
  }

  const PAIRS = [
    {
      route: 'organizations',
      prop: 'canProvision',
      code: P.organizationProvision,
      base: [P.organizationRead],
    },
    {
      route: 'provision',
      prop: 'canActivate',
      code: P.organizationLifecycle,
      base: [P.organizationProvision],
    },
  ] as const;

  for (const pair of PAIRS) {
    it(`${pair.route}: grants ${pair.prop} for ${pair.code} and for nothing else`, async () => {
      const granted = propsCarrying(
        await invokeConsole(consoleRoutes[pair.route], [...pair.base, pair.code]),
        pair.prop
      );
      expect(granted?.[pair.prop]).toBe(true);
      const denied = propsCarrying(
        await invokeConsole(
          consoleRoutes[pair.route],
          ALL_PLATFORM_CODES.filter((code) => code !== pair.code)
        ),
        pair.prop
      );
      expect(denied?.[pair.prop]).toBe(false);
    });
  }

  const DETAIL = [
    { capability: 'canChangeLifecycle', code: P.organizationLifecycle },
    { capability: 'canManageSubscription', code: P.subscriptionManage },
    { capability: 'canReadBilling', code: P.billingRead },
    { capability: 'canManageBilling', code: P.billingManage },
    { capability: 'canReadAudit', code: P.auditRead },
  ] as const;

  for (const entry of DETAIL) {
    it(`organisation detail: grants ${entry.capability} for ${entry.code} and for nothing else`, async () => {
      const granted = propsCarrying(
        await invokeConsole(consoleRoutes.detail, [P.organizationRead, entry.code]),
        'capabilities'
      );
      expect((granted?.capabilities as Record<string, boolean>)[entry.capability]).toBe(true);
      const denied = propsCarrying(
        await invokeConsole(
          consoleRoutes.detail,
          ALL_PLATFORM_CODES.filter((code) => code !== entry.code)
        ),
        'capabilities'
      );
      expect((denied?.capabilities as Record<string, boolean>)[entry.capability]).toBe(false);
    });
  }

  it('organisation detail: reads plans and charges only for their holders', async () => {
    await invokeConsole(consoleRoutes.detail, [P.organizationRead]);
    expect(platformReads.listPlans).not.toHaveBeenCalled();
    expect(platformReads.listCharges).not.toHaveBeenCalled();
    await invokeConsole(consoleRoutes.detail, [
      P.organizationRead,
      P.subscriptionManage,
      P.billingRead,
    ]);
    expect(platformReads.listPlans).toHaveBeenCalledTimes(1);
    expect(platformReads.listCharges).toHaveBeenCalledWith(CONSOLE_TENANT);
  });
});

// --- organisation administration (P1-32 preparation) --------------------------

vi.mock('@/features/administration/organization/api', () => ({
  readTenant: async () => ({ status: 'ok', data: null, correlationId: 'cid' }),
  readCapacity: async () => ({ status: 'ok', data: null, correlationId: 'cid' }),
  listCompanies: async () => ({ status: 'ok', data: [], correlationId: 'cid' }),
  listBranches: async () => ({ status: 'ok', data: [], correlationId: 'cid' }),
  readCurrencyChoices: async () => [],
  readBranchStatus: async () => ({ status: 'ok', data: null, correlationId: 'cid' }),
  readSettings: async () => ({ status: 'ok', data: [], correlationId: 'cid' }),
}));
vi.mock('@/features/administration/departments/api', () => ({
  listDepartments: async () => ({ status: 'ok', data: [], correlationId: 'cid' }),
  readDepartmentNames: async () => ({}),
}));
vi.mock('@/features/administration/employees/api', () => ({
  listEmployees: async () => ({ status: 'ok', data: { items: [] }, correlationId: 'cid' }),
  listLoginAccounts: async () => [],
}));
vi.mock('@/features/administration/users/api', () => ({
  readUserAccess: async () => ({
    status: 'ok',
    user: { id: 'u', email: 'e', displayName: 'd', status: 'active' },
    grants: [],
    roles: [],
    correlationId: 'cid',
  }),
  listGrantableRoles: async () => [],
  listUsers: async () => ({ status: 'ok', rows: [], nextCursor: null, hasMore: false }),
  readUser: async () => ({ status: 'ok' }),
}));

const { PERMISSIONS: ADMIN } = await import('@/features/administration/shared/permissions');
type AnyPage = (args: { params: Promise<Record<string, string>> }) => Promise<unknown>;
const OrganizationPage = (
  await import('@/app/[locale]/(dashboard)/administration/organization/page')
).default as unknown as AnyPage;
const DepartmentsPage = (await import('@/app/[locale]/(dashboard)/administration/departments/page'))
  .default as unknown as AnyPage;
const EmployeesPage = (await import('@/app/[locale]/(dashboard)/administration/employees/page'))
  .default as unknown as AnyPage;
const UserAccessPage = (
  await import('@/app/[locale]/(dashboard)/administration/users/[userId]/page')
).default as unknown as AnyPage;

/**
 * Walks an element tree for the first node whose props carry `marker`. A render
 * function child (`ReadBoundary`) is called with the data of an `ok` state, the
 * way the boundary itself would call it.
 */
function findPropsWith(node: unknown, marker: string): Record<string, unknown> | null {
  if (node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findPropsWith(child, marker);
      if (found) return found;
    }
    return null;
  }
  const props = (node as ReactElement<Record<string, unknown>>).props;
  if (!props || typeof props !== 'object') return null;
  if (marker in props) return props;
  const children = (props as { children?: unknown }).children;
  if (typeof children === 'function') {
    const state = (props as { state?: { status?: string; data?: unknown } }).state;
    return state?.status === 'ok'
      ? findPropsWith((children as (data: unknown) => unknown)(state.data), marker)
      : null;
  }
  return findPropsWith(children, marker);
}

async function screenProps(
  page: AnyPage,
  params: Record<string, string>,
  permissions: readonly string[],
  marker: string
): Promise<Record<string, unknown> | null> {
  PERMISSIONS = [...permissions];
  return findPropsWith(
    await page({ params: Promise.resolve({ locale: 'en', ...params }) }),
    marker
  );
}

describe('organisation administration routes grant each control from its OWN permission', () => {
  const USER_ID = 'a1b2c3d4-0000-4000-8000-0000000000aa';
  const CASES: readonly {
    readonly name: string;
    readonly page: AnyPage;
    readonly params: Record<string, string>;
    readonly base: readonly string[];
    readonly prop: string;
    readonly permission: string;
    readonly others: readonly string[];
  }[] = [
    {
      name: 'organization, Add company and company status',
      page: OrganizationPage,
      params: {},
      base: [ADMIN.tenantRead, ADMIN.companyRead, ADMIN.branchRead],
      prop: 'canManageCompanies',
      permission: ADMIN.companyManage,
      others: [ADMIN.branchManage, ADMIN.settingsManage],
    },
    {
      name: 'organization, Add branch',
      page: OrganizationPage,
      params: {},
      base: [ADMIN.tenantRead, ADMIN.companyRead, ADMIN.branchRead],
      prop: 'canManageBranches',
      permission: ADMIN.branchManage,
      others: [ADMIN.companyManage, ADMIN.settingsManage],
    },
    {
      name: 'organization, branch status',
      page: OrganizationPage,
      params: {},
      base: [ADMIN.tenantRead, ADMIN.companyRead, ADMIN.branchRead],
      prop: 'canChangeBranchStatus',
      permission: ADMIN.settingsManage,
      others: [ADMIN.companyManage, ADMIN.branchManage],
    },
    {
      name: 'departments',
      page: DepartmentsPage,
      params: {},
      base: [ADMIN.departmentRead, ADMIN.branchRead],
      prop: 'canManage',
      permission: ADMIN.departmentManage,
      others: [ADMIN.employeeManage, ADMIN.companyManage, ADMIN.branchManage],
    },
    {
      name: 'employees',
      page: EmployeesPage,
      params: {},
      base: [ADMIN.employeeRead, ADMIN.branchRead],
      prop: 'canManage',
      permission: ADMIN.employeeManage,
      others: [ADMIN.departmentManage, ADMIN.companyManage, ADMIN.branchManage],
    },
    {
      name: 'user access',
      page: UserAccessPage,
      params: { userId: USER_ID },
      base: [ADMIN.userRead, ADMIN.roleRead],
      prop: 'canManageGrants',
      permission: ADMIN.grantManage,
      others: [ADMIN.userManage, ADMIN.roleManage],
    },
  ];

  for (const entry of CASES) {
    it(`${entry.name}: ${entry.prop} for ${entry.permission} and for nothing else`, async () => {
      const granted = await screenProps(
        entry.page,
        entry.params,
        [...entry.base, entry.permission],
        entry.prop
      );
      expect(granted, 'the route did not render its screen').not.toBeNull();
      expect(granted?.[entry.prop]).toBe(true);

      const denied = await screenProps(
        entry.page,
        entry.params,
        [...entry.base, ...entry.others],
        entry.prop
      );
      expect(denied, 'the route did not render its screen').not.toBeNull();
      expect(denied?.[entry.prop]).toBe(false);
    });
  }

  it('renders the denial instead of the screen without the read permission', async () => {
    const writesOnly = [ADMIN.departmentManage, ADMIN.employeeManage, ADMIN.grantManage];
    const routes: readonly (readonly [AnyPage, Record<string, string>, string])[] = [
      [DepartmentsPage, {}, 'canManage'],
      [EmployeesPage, {}, 'canManage'],
      [UserAccessPage, { userId: USER_ID }, 'canManageGrants'],
    ];
    for (const [page, params, marker] of routes) {
      expect(await screenProps(page, params, writesOnly, marker)).toBeNull();
    }
  });
});
