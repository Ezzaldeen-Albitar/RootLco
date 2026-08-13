import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

/**
 * The JOINT between a session's permissions and an appointment/reception
 * screen's capability props — `P1-28-SEC-001`.
 *
 * ## Why this file exists
 *
 * P1-27 proved both halves of this and never the wire between them:
 * `write-permission-gating.dom.test.tsx` asserted a component's behaviour GIVEN
 * a `canX` prop, and `vehicle-contract.test.ts` pinned the permission constants'
 * string values. What actually decides the property is the handful of
 * `canEdit={holds(session.permissions, …)}` lines in `src/app/**` — and
 * `WRITE_PERMISSIONS` once had exactly one reference, its own declaration, while
 * ten write forms rendered for any reader.
 *
 * `route-permission-binding.test.ts` fills that gap for the vehicle profile.
 * This is its P1-28 twin, over EVERY route the phase ships, because the wizard
 * alone resolves twelve capabilities in one object literal and a single
 * copy-pasted constant there withdraws or grants a control silently.
 *
 * "Every route" is meant literally and was not: this file covered six of the
 * eight, and the two it omitted — the booking form and the acknowledgement
 * document — were the two that resolve no capability prop at all, so the claim
 * read as true for as long as nobody counted the pages. Both are here now. They
 * contribute no capability pairing, because there is none to make; what they
 * contribute is the gate direction, and the booking form contributes the one
 * case the reader sweep was missing entirely — a screen a read-only operator
 * must NOT reach.
 *
 * ## How it is asserted
 *
 * The route module is INVOKED with a synthesised session and its returned
 * element tree is walked for the screen's props. No DOM render, so no client
 * component machinery runs and nothing here depends on how a screen draws.
 *
 * A PAIRING, never a single direction: each capability is asserted true when the
 * session holds exactly that permission and false when the session holds every
 * OTHER permission this phase knows about. A one-directional test passes against
 * `canEdit={true}`, which is the defect that shipped ten open write forms.
 */

const ALL_PERMISSIONS = [
  'apt.appointment.read',
  'apt.appointment.manage',
  'apt.appointment.lifecycle.manage',
  'rec.reception.read',
  'rec.reception.manage',
  'rec.reception.party.manage',
  'rec.reception.authorization.verify',
  'rec.reception.evidence.manage',
  'rec.reception.signature.manage',
  'rec.reception.approve',
  'rec.reception.convert',
  'rec.reception.close',
  'iam.sensitive.view',
  'iam.user.read',
  'crm.customer.read',
  'crm.customer.create',
  'crm.customer.vehicle.manage',
  'veh.vehicle.read',
  'veh.vehicle.manage',
  'veh.vehicle.odometer.record',
  'wo.work_order.read',
] as const;

let PERMISSIONS: string[] = [];

vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    userId: 'ba9f2f2e-0000-4000-8000-000000000001',
    tenantId: 'ba9f2f2e-0000-4000-8000-0000000000ff',
    email: 'front.desk@test.local',
    displayName: 'Front Desk',
    companyIds: [],
    branchIds: [],
    permissions: PERMISSIONS,
  }),
}));

/* --- the reads each route performs, replaced ------------------------------ */

const APPOINTMENT_DETAIL = {
  id: 'aa000000-0000-4000-8000-000000000001',
  displayNumber: 'A-0001',
  lifecycleStatus: 'confirmed',
  companyId: 'c1',
  branchId: 'b1',
  vehicleId: 'v1',
  vehicleDisplayNumber: 'V-1',
  requesterPartnerId: 'p1',
  requesterDisplayName: 'A requester',
  appointmentTypeId: 't1',
  appointmentTypeName: 'A type',
  sourceChannelId: null,
  sourceChannelName: null,
  requestedFrom: '2026-08-14T08:00:00.000Z',
  requestedTo: '2026-08-14T09:00:00.000Z',
  confirmedFrom: '2026-08-14T08:00:00.000Z',
  confirmedTo: '2026-08-14T09:00:00.000Z',
  cancellationReasonId: null,
  cancellationReasonName: null,
  cancelledAt: null,
  noShowRecordedAt: null,
  recordVersion: 2,
  createdAt: '2026-08-13T08:00:00.000Z',
  updatedAt: null,
};

const RECEPTION_DETAIL = {
  id: 'bb000000-0000-4000-8000-000000000001',
  displayNumber: 'R-0001',
  receptionStatus: 'opened',
  origin: 'walk_in',
  appointmentId: null,
  walkInId: 'w1',
  companyId: 'c1',
  branchId: 'b1',
  vehicleId: 'v1',
  vehicleDisplayNumber: 'V-1',
  odometerReadingId: null,
  fuelLevelId: null,
  fuelLevelName: null,
  evSocPercent: null,
  receivingEmployeeId: 'u1',
  custodyAcceptedAt: '2026-08-13T08:00:00.000Z',
  custodyReleasedAt: null,
  recordVersion: 1,
  createdAt: '2026-08-13T08:00:00.000Z',
  updatedAt: null,
};

const appointmentRead = vi.fn();
const receptionRead = vi.fn();

vi.mock('@/features/appointments/api', () => ({
  readAppointment: (...args: unknown[]) => appointmentRead(...args),
}));
const EMPTY_CATALOGUE = {
  status: 'ok',
  options: [],
  truncated: false,
  correlationId: 'cid',
};
vi.mock('@/features/appointments/catalogue-api', () => ({
  listCancellationReasons: async () => EMPTY_CATALOGUE,
  listAppointmentTypes: async () => EMPTY_CATALOGUE,
  listSourceChannels: async () => EMPTY_CATALOGUE,
}));
const EMPTY_PAGE = { status: 'ok', rows: [], hasMore: false, correlationId: 'cid' };
vi.mock('@/features/receptions/api', () => ({
  readReception: (...args: unknown[]) => receptionRead(...args),
  listPartyRoles: async () => EMPTY_PAGE,
  listAuthorizations: async () => EMPTY_PAGE,
  listConditionEvidence: async () => EMPTY_PAGE,
}));
vi.mock('@/features/receptions/catalogue-api', () => ({
  listFuelLevels: async () => ({
    status: 'ok',
    options: [],
    truncated: false,
    correlationId: 'cid',
  }),
}));
vi.mock('@/features/receptions/support-api', () => ({
  readCustomerSummary: async () => ({ status: 'not-found', correlationId: null }),
  // The receiving employee's name (G-EMP). `not-found` rather than a name, so
  // no case here can pass on an identity this suite never set up — what it is
  // about is the permission binding, and `p1-28-reception-routes.test.ts` owns
  // the three outcomes.
  readReceivingEmployeeIdentity: async () => ({ status: 'not-found', correlationId: null }),
}));

const { NotFoundState, PermissionDeniedState } = await import('@/components/states/States');

const AppointmentsPage = (await import('@/app/[locale]/(dashboard)/appointments/page')).default;
const AppointmentDetailPage = (
  await import('@/app/[locale]/(dashboard)/appointments/[appointmentId]/page')
).default;
const WalkInPage = (await import('@/app/[locale]/(dashboard)/reception/walk-in/page')).default;
const QueuePage = (await import('@/app/[locale]/(dashboard)/receptions/page')).default;
const CheckInStartPage = (await import('@/app/[locale]/(dashboard)/receptions/check-in/page'))
  .default;
const CheckInWizardPage = (
  await import('@/app/[locale]/(dashboard)/receptions/check-in/[receptionId]/page')
).default;
const AppointmentBookingPage = (await import('@/app/[locale]/(dashboard)/appointments/new/page'))
  .default;
const AcknowledgementPage = (
  await import('@/app/[locale]/(dashboard)/receptions/check-in/[receptionId]/acknowledgement/page')
).default;

/* --- walking the returned tree -------------------------------------------- */

type Props = Record<string, unknown>;

/** The first node whose props carry `marker`, anywhere in the returned tree. */
function findProps(node: unknown, marker: string): Props | null {
  if (node === null || node === undefined || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps(child, marker);
      if (found) return found;
    }
    return null;
  }
  const element = node as ReactElement<Props>;
  const props = element.props;
  if (props && typeof props === 'object') {
    if (marker in props) return props as Props;
    const found = findProps((props as { children?: unknown }).children, marker);
    if (found) return found;
  }
  return null;
}

/** Whether the tree renders a particular state component. */
function rendersComponent(node: unknown, component: unknown): boolean {
  if (node === null || node === undefined || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((child) => rendersComponent(child, component));
  const element = node as ReactElement<Props>;
  if (element.type === component) return true;
  const props = element.props;
  if (!props || typeof props !== 'object') return false;
  return rendersComponent((props as { children?: unknown }).children, component);
}

const LOCALE = Promise.resolve({ locale: 'en' });
const SEARCH = Promise.resolve({});

interface RouteCase {
  readonly name: string;
  /** The permission that decides whether the screen renders at all. */
  readonly gate: string;
  /** A props marker unique to the screen this route mounts. */
  readonly marker: string;
  readonly invoke: () => Promise<unknown>;
  /** `prop → the ONE permission that must grant it`. */
  readonly capabilities: Readonly<Record<string, string>>;
  /** Read the capability record out of the screen props (the wizard nests one). */
  readonly read?: (props: Props) => Props;
}

const ROUTES: readonly RouteCase[] = [
  {
    name: 'the branch calendar',
    gate: 'apt.appointment.read',
    marker: 'canCheckIn',
    invoke: () => AppointmentsPage({ params: LOCALE }),
    capabilities: {
      canManage: 'apt.appointment.manage',
      // The day queue's arrival affordance leads to `rec.reception-create`, so
      // it is gated on THAT operation's code and on no appointment code.
      canCheckIn: 'rec.reception.manage',
    },
  },
  {
    name: 'the appointment detail',
    gate: 'apt.appointment.read',
    marker: 'canEndLifecycle',
    invoke: () =>
      AppointmentDetailPage({
        params: Promise.resolve({ locale: 'en', appointmentId: APPOINTMENT_DETAIL.id }),
      }),
    capabilities: {
      canManage: 'apt.appointment.manage',
      // ENDING an appointment is a different authority from arranging one.
      canEndLifecycle: 'apt.appointment.lifecycle.manage',
    },
  },
  {
    name: 'the walk-in intake',
    gate: 'crm.customer.read',
    marker: 'canCreateCustomer',
    invoke: () => WalkInPage({ params: LOCALE }),
    capabilities: {
      canCreateCustomer: 'crm.customer.create',
      canSearchVehicles: 'veh.vehicle.read',
      canCreateVehicle: 'veh.vehicle.manage',
      canLinkVehicle: 'crm.customer.vehicle.manage',
    },
  },
  {
    name: 'the reception queue',
    gate: 'rec.reception.read',
    marker: 'canCreate',
    invoke: () => QueuePage({ params: LOCALE }),
    capabilities: { canCreate: 'rec.reception.manage' },
  },
  {
    name: 'the check-in start screen',
    gate: 'rec.reception.read',
    marker: 'canPickEmployee',
    invoke: () => CheckInStartPage({ params: LOCALE, searchParams: SEARCH }),
    capabilities: {
      canCreate: 'rec.reception.manage',
      canListAppointments: 'apt.appointment.read',
      // The staff-directory overload, wired to its own code and to no other.
      canPickEmployee: 'iam.user.read',
      canSearchCustomers: 'crm.customer.read',
    },
  },
  {
    name: 'the check-in wizard',
    gate: 'rec.reception.read',
    marker: 'capabilities',
    invoke: () =>
      CheckInWizardPage({
        params: Promise.resolve({ locale: 'en', receptionId: RECEPTION_DETAIL.id }),
      }),
    read: (props) => props['capabilities'] as Props,
    capabilities: {
      manageParties: 'rec.reception.party.manage',
      verifyAuthorizations: 'rec.reception.authorization.verify',
      readCustomers: 'crm.customer.read',
      readVehicles: 'veh.vehicle.read',
      manageEvidence: 'rec.reception.evidence.manage',
      // `P1-28-SEC-002` — WF-27's second permission, from a DIFFERENT module.
      viewSensitiveNarratives: 'iam.sensitive.view',
      manageSignatures: 'rec.reception.signature.manage',
      recordOdometer: 'veh.vehicle.odometer.record',
      approveReceptions: 'rec.reception.approve',
      convertReceptions: 'rec.reception.convert',
      closeReceptions: 'rec.reception.close',
      readWorkOrders: 'wo.work_order.read',
    },
  },
  {
    /*
     * A WRITE screen: its gate is `apt.appointment.manage`, the code
     * `apt.appointment-create` registers, and it resolves no capability prop
     * because there is no second authority on it to resolve. That is exactly why
     * it was missing, and exactly what makes it worth having — it is the only
     * route here a read-only operator must not reach at all, so the reader sweep
     * below had no negative case until it arrived.
     */
    name: 'the booking form',
    gate: 'apt.appointment.manage',
    marker: 'channels',
    invoke: () => AppointmentBookingPage({ params: LOCALE }),
    capabilities: {},
  },
  {
    /*
     * A READ screen with one code and no capability: the acknowledgement writes
     * nothing, it is the visit record laid out for print. The gate direction is
     * the whole of its permission behaviour, and it is asserted like any other.
     */
    name: 'the acknowledgement document',
    gate: 'rec.reception.read',
    marker: 'sections',
    invoke: () =>
      AcknowledgementPage({
        params: Promise.resolve({ locale: 'en', receptionId: RECEPTION_DETAIL.id }),
      }),
    capabilities: {},
  },
];

async function propsFor(route: RouteCase, permissions: readonly string[]): Promise<Props> {
  PERMISSIONS = [...permissions];
  const tree = await route.invoke();
  const props = findProps(tree, route.marker);
  expect(props, `${route.name} did not render its screen`).not.toBeNull();
  return route.read ? route.read(props as Props) : (props as Props);
}

beforeEach(() => {
  PERMISSIONS = [];
  appointmentRead.mockResolvedValue({
    status: 'ok',
    data: APPOINTMENT_DETAIL,
    correlationId: 'cid',
  });
  receptionRead.mockResolvedValue({ status: 'ok', data: RECEPTION_DETAIL, correlationId: 'cid' });
});

describe('P1-28-SEC-001 — every capability comes from its OWN permission', () => {
  it('has distinct constants to test with', () => {
    // If two codes ever collapsed to one string, every pairing below would pass
    // while proving nothing.
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    // And every capability under test names a code this file knows about, or
    // the "every OTHER permission" direction is quietly incomplete.
    for (const route of ROUTES) {
      for (const code of Object.values(route.capabilities)) {
        expect(ALL_PERMISSIONS, `${code} is not in ALL_PERMISSIONS`).toContain(code);
      }
    }
    // Anti-vacuity: the eight routes together decide twenty-five capabilities,
    // and six of them decide at least one. Both halves are stated, so adding a
    // capability-free route can never weaken the first number.
    const total = ROUTES.reduce((sum, route) => sum + Object.keys(route.capabilities).length, 0);
    expect(total).toBe(25);
    expect(ROUTES.length).toBe(8);
    expect(ROUTES.filter((route) => Object.keys(route.capabilities).length > 0)).toHaveLength(6);
  });

  for (const route of ROUTES) {
    describe(route.name, () => {
      for (const [prop, permission] of Object.entries(route.capabilities)) {
        it(`grants ${prop} for ${permission} and for nothing else`, async () => {
          const granted = await propsFor(route, [route.gate, permission]);
          expect(granted[prop], `${prop} was withheld from a holder of ${permission}`).toBe(true);

          // Every OTHER permission, and not this one. This is the direction that
          // catches a hard-coded `true` and a copy-pasted wrong constant at once.
          const others = ALL_PERMISSIONS.filter((code) => code !== permission);
          const denied = await propsFor(route, [route.gate, ...others]);
          expect(denied[prop], `${prop} was granted without ${permission}`).toBe(false);
        });
      }

      it('renders the denial INSTEAD of the screen without its own read code', async () => {
        // Every permission except the gate: the page must not render at all.
        PERMISSIONS = ALL_PERMISSIONS.filter((code) => code !== route.gate);
        const tree = await route.invoke();
        expect(
          findProps(tree, route.marker),
          'the screen rendered for a denied operator'
        ).toBeNull();
        expect(rendersComponent(tree, PermissionDeniedState)).toBe(true);
      });
    });
  }
});

describe('P1-28-SEC-001 — the reader-only negative control', () => {
  /**
   * A principal that can READ both domains and write nothing.
   *
   * The point is not that everything is denied — "everything is denied"
   * evidences the denial state and evidences nothing about whether a read-only
   * operator can USE the product. This session reaches every screen and finds no
   * write affordance on any of them, which is the distinction worth looking at
   * and the one an operator would actually notice.
   */
  const READER = [
    'apt.appointment.read',
    'rec.reception.read',
    'crm.customer.read',
    'veh.vehicle.read',
    'iam.user.read',
  ];

  for (const route of ROUTES.filter((entry) => Object.keys(entry.capabilities).length > 0)) {
    it(`${route.name} renders for a reader and offers no write`, async () => {
      const props = await propsFor(route, READER);

      for (const [prop, permission] of Object.entries(route.capabilities)) {
        const expected = READER.includes(permission);
        expect(props[prop], `${prop} (${permission}) for a read-only principal`).toBe(expected);
      }

      // And at least one capability really was withheld, so the case is not
      // satisfied by a route whose every capability happens to be a read.
      const withheld = Object.entries(route.capabilities).filter(
        ([, permission]) => !READER.includes(permission)
      );
      expect(withheld.length, `${route.name} withheld nothing from a reader`).toBeGreaterThan(0);
    });
  }

  it('reaches every READ screen, and is refused every write-gated one', async () => {
    /*
     * Both directions over all eight routes, decided by the gate rather than by
     * a list: a route whose gate is a code this reader holds must render, and a
     * route whose gate is not must render the denial instead. The booking form
     * is the only route on the second side today, and it is the reason this
     * sweep is stated as a partition rather than as "a reader reaches
     * everything" — which was true only because the one screen it is false for
     * was absent from `ROUTES`.
     */
    const reachable = ROUTES.filter((route) => READER.includes(route.gate));
    const refused = ROUTES.filter((route) => !READER.includes(route.gate));
    expect(reachable.length + refused.length).toBe(8);
    expect(refused.map((route) => route.name)).toEqual(['the booking form']);

    for (const route of reachable) {
      PERMISSIONS = [...READER];
      const tree = await route.invoke();
      expect(rendersComponent(tree, PermissionDeniedState), route.name).toBe(false);
      expect(findProps(tree, route.marker), route.name).not.toBeNull();
    }
    for (const route of refused) {
      PERMISSIONS = [...READER];
      const tree = await route.invoke();
      expect(rendersComponent(tree, PermissionDeniedState), route.name).toBe(true);
      expect(findProps(tree, route.marker), route.name).toBeNull();
    }
  });
});

describe('P1-28-SEC-001 — the cross-tenant negative control this tier can actually run', () => {
  /**
   * ## What is provable here, and what is not
   *
   * A unit tier cannot prove that tenant A fails to read tenant B: the client
   * never names a tenant, so there is no request this file could construct that
   * would BE a cross-tenant read. `apps/web/tests/e2e/authenticated/isolation.spec.ts`
   * is the tier that proves the refusal, against two real tenants.
   *
   * What IS this tier's to prove is the half that lives in the interface: the
   * platform answers a cross-tenant identifier with `ERR-RES-001` — a 404 that
   * deliberately hides whether the record exists — and the screen must render
   * that as "not found", identically to a genuinely missing id. A route that
   * distinguished the two would turn a deliberate non-disclosure into an
   * existence oracle: try ids, and the ones that answer differently are real.
   */
  it('renders a cross-tenant appointment identically to a missing one', async () => {
    PERMISSIONS = [...ALL_PERMISSIONS];
    appointmentRead.mockResolvedValue({ status: 'not-found', correlationId: 'cid' });
    const tree = await AppointmentDetailPage({
      params: Promise.resolve({ locale: 'en', appointmentId: APPOINTMENT_DETAIL.id }),
    });
    expect(rendersComponent(tree, NotFoundState)).toBe(true);
    // Not a permission denial, and not the screen with empty data.
    expect(rendersComponent(tree, PermissionDeniedState)).toBe(false);
    expect(findProps(tree, 'canEndLifecycle')).toBeNull();
  });

  it('renders a cross-tenant reception identically to a missing one', async () => {
    PERMISSIONS = [...ALL_PERMISSIONS];
    receptionRead.mockResolvedValue({ status: 'not-found', correlationId: 'cid' });
    const tree = await CheckInWizardPage({
      params: Promise.resolve({ locale: 'en', receptionId: RECEPTION_DETAIL.id }),
    });
    expect(rendersComponent(tree, NotFoundState)).toBe(true);
    expect(findProps(tree, 'capabilities')).toBeNull();
  });

  it('discriminates: a REFUSED read is a denial, not a not-found', async () => {
    // Without this, "not found" above is equally consistent with a route that
    // renders NotFoundState for every failure — which would make the
    // indistinguishability claim vacuous.
    PERMISSIONS = [...ALL_PERMISSIONS];
    receptionRead.mockResolvedValue({ status: 'denied', correlationId: 'cid-denied' });
    const tree = await CheckInWizardPage({
      params: Promise.resolve({ locale: 'en', receptionId: RECEPTION_DETAIL.id }),
    });
    expect(rendersComponent(tree, PermissionDeniedState)).toBe(true);
    expect(rendersComponent(tree, NotFoundState)).toBe(false);
  });
});
