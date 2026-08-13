import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

/**
 * The JOINT between a session's permissions and the reception routes' props
 * (`P1-28-SEC-001`, the `P1-27-SEC-003` pattern applied to Waves F/G).
 *
 * The component tests prove both directions of every capability GIVEN the
 * capability; the contract test pins the permission strings. What decides the
 * security property is the handful of `holds(session.permissions, …)` lines in
 * `src/app/**` that connect them — the tree the declared-but-never-wired class
 * historically hid in, and the one `WRITE_PERMISSIONS` sat unwired inside for a
 * whole phase.
 *
 * Each route module is INVOKED with a synthesised session and its returned
 * element tree walked for the screen's props; no DOM render, so nothing depends
 * on how the screens draw.
 *
 * A pairing, never a single direction: each capability is asserted true when the
 * session holds exactly that permission, and false when it holds every OTHER
 * one — the direction that catches a hard-coded `true` and a copy-pasted wrong
 * constant at once.
 */

let PERMISSIONS: string[] = [];

vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    userId: 'u',
    tenantId: 't',
    email: 'operator@test.local',
    displayName: 'Operator',
    companyIds: ['11111111-1111-4111-8111-111111111111'],
    branchIds: ['22222222-2222-4222-8222-222222222222'],
    permissions: PERMISSIONS,
  }),
}));

const DETAIL = {
  id: 'a1b2c3d4-0000-4000-8000-00000000000a',
  displayNumber: 'R-0001',
  receptionStatus: 'opened',
  origin: 'walk_in',
  appointmentId: null,
  walkInId: 'a1b2c3d4-0000-4000-8000-00000000000b',
  companyId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
  vehicleId: 'a1b2c3d4-0000-4000-8000-00000000000c',
  vehicleDisplayNumber: 'V-9',
  odometerReadingId: null,
  fuelLevelId: null,
  fuelLevelName: null,
  evSocPercent: null,
  receivingEmployeeId: 'a1b2c3d4-0000-4000-8000-00000000000d',
  custodyAcceptedAt: '2026-08-13T07:00:00.000Z',
  custodyReleasedAt: null,
  recordVersion: 3,
  createdAt: '2026-08-13T07:00:00.000Z',
  updatedAt: null,
};

const readReception = vi.fn();
const listPartyRoles = vi.fn();
const listAuthorizations = vi.fn();
const listConditionEvidence = vi.fn();

vi.mock('@/features/receptions/api', () => ({
  readReception: (...args: unknown[]) => readReception(...args),
  listPartyRoles: (...args: unknown[]) => listPartyRoles(...args),
  listAuthorizations: (...args: unknown[]) => listAuthorizations(...args),
  listConditionEvidence: (...args: unknown[]) => listConditionEvidence(...args),
}));

const readReceivingEmployeeIdentity = vi.fn();

vi.mock('@/features/receptions/support-api', () => ({
  readReceivingEmployeeIdentity: (...args: unknown[]) => readReceivingEmployeeIdentity(...args),
  // The rest of the module, present because the wizard route's import closure
  // reaches it through the step registry. None of them is called here.
  readCustomerSummary: vi.fn(),
  readVehicleSummary: vi.fn(),
  listVehicleRelationshipEntries: vi.fn(),
  listReceivingEmployeeCandidates: vi.fn(),
  listConfirmedAppointments: vi.fn(),
}));

const { RECEPTION_PERMISSIONS } = await import('@/features/receptions/receptions-contract');
const { STAFF_DIRECTORY_PERMISSION } = await import('@/features/receptions/staff-directory');
const { WORK_ORDER_READ_PERMISSION } = await import('@/features/receptions/work-order-contract');
const { CRM_PERMISSIONS, VEHICLE_PERMISSIONS } = await import('@/features/crm/permissions');

const QueuePage = (await import('@/app/[locale]/(dashboard)/receptions/page')).default;
const WizardPage = (
  await import('@/app/[locale]/(dashboard)/receptions/check-in/[receptionId]/page')
).default;
const AcknowledgementPage = (
  await import('@/app/[locale]/(dashboard)/receptions/check-in/[receptionId]/acknowledgement/page')
).default;

const ALL = [
  RECEPTION_PERMISSIONS.read,
  RECEPTION_PERMISSIONS.manage,
  RECEPTION_PERMISSIONS.partyManage,
  RECEPTION_PERMISSIONS.authorizationVerify,
  RECEPTION_PERMISSIONS.approve,
  RECEPTION_PERMISSIONS.convert,
  RECEPTION_PERMISSIONS.close,
  CRM_PERMISSIONS.customerRead,
  VEHICLE_PERMISSIONS.vehicleRead,
  WORK_ORDER_READ_PERMISSION,
  // The staff directory (`iam.user.read`), which the receiving-employee name
  // resolves through. Present so a case that removes it removes something.
  STAFF_DIRECTORY_PERMISSION,
];

/** Walks a returned element tree for the first node carrying `marker`. */
function findProps(node: unknown, marker: string): Record<string, unknown> | null {
  if (node === null || typeof node !== 'object') return null;
  const element = node as ReactElement<Record<string, unknown>>;
  const props = element.props;
  if (props && typeof props === 'object' && marker in props) {
    return props as Record<string, unknown>;
  }
  if (!props || typeof props !== 'object') return null;
  const children = (props as { children?: unknown }).children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findProps(child, marker);
    if (found) return found;
  }
  return null;
}

const page = {
  status: 'ok' as const,
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: null,
};

beforeEach(() => {
  PERMISSIONS = [];
  readReception.mockReset();
  listPartyRoles.mockReset();
  listAuthorizations.mockReset();
  listConditionEvidence.mockReset();
  readReceivingEmployeeIdentity.mockReset();
  readReception.mockResolvedValue({ status: 'ok', data: DETAIL, correlationId: 'cid' });
  listPartyRoles.mockResolvedValue(page);
  listAuthorizations.mockResolvedValue(page);
  listConditionEvidence.mockResolvedValue(page);
  readReceivingEmployeeIdentity.mockResolvedValue({
    status: 'ok',
    data: { id: DETAIL.receivingEmployeeId, displayName: 'Rana Odeh' },
    correlationId: 'cid-user',
  });
});

describe('the queue route', () => {
  it('renders the board only for a holder of the read permission', async () => {
    PERMISSIONS = [RECEPTION_PERMISSIONS.read];
    const granted = await QueuePage({ params: Promise.resolve({ locale: 'en' }) });
    expect(findProps(granted, 'companyIds')).not.toBeNull();

    PERMISSIONS = ALL.filter((p) => p !== RECEPTION_PERMISSIONS.read);
    const denied = await QueuePage({ params: Promise.resolve({ locale: 'en' }) });
    expect(findProps(denied, 'companyIds')).toBeNull();
  });

  it('grants the check-in offer from the manage permission and nothing else', async () => {
    PERMISSIONS = [RECEPTION_PERMISSIONS.read, RECEPTION_PERMISSIONS.manage];
    const granted = await QueuePage({ params: Promise.resolve({ locale: 'en' }) });
    expect(findProps(granted, 'companyIds')?.['canCreate']).toBe(true);

    PERMISSIONS = ALL.filter((p) => p !== RECEPTION_PERMISSIONS.manage);
    const denied = await QueuePage({ params: Promise.resolve({ locale: 'en' }) });
    expect(findProps(denied, 'companyIds')?.['canCreate']).toBe(false);
  });

  it("passes the session's own resolved scope as the target options", async () => {
    PERMISSIONS = [RECEPTION_PERMISSIONS.read];
    const tree = await QueuePage({ params: Promise.resolve({ locale: 'en' }) });
    const props = findProps(tree, 'companyIds');
    expect(props?.['companyIds']).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(props?.['branchIds']).toEqual(['22222222-2222-4222-8222-222222222222']);
  });
});

describe('the wizard route resolves every write capability', () => {
  const params = Promise.resolve({ locale: 'en', receptionId: DETAIL.id });

  it('reads nothing before the route-level gate', async () => {
    PERMISSIONS = ALL.filter((p) => p !== RECEPTION_PERMISSIONS.read);
    const denied = await WizardPage({ params });
    expect(findProps(denied, 'capabilities')).toBeNull();
    expect(readReception).not.toHaveBeenCalled();
  });

  for (const { field, permission } of [
    { field: 'manageParties', permission: RECEPTION_PERMISSIONS.partyManage },
    { field: 'verifyAuthorizations', permission: RECEPTION_PERMISSIONS.authorizationVerify },
    { field: 'approveReceptions', permission: RECEPTION_PERMISSIONS.approve },
    { field: 'convertReceptions', permission: RECEPTION_PERMISSIONS.convert },
    { field: 'closeReceptions', permission: RECEPTION_PERMISSIONS.close },
    { field: 'readCustomers', permission: CRM_PERMISSIONS.customerRead },
    { field: 'readVehicles', permission: VEHICLE_PERMISSIONS.vehicleRead },
    { field: 'readWorkOrders', permission: WORK_ORDER_READ_PERMISSION },
  ]) {
    it(`grants ${field} for ${permission} and for nothing else`, async () => {
      PERMISSIONS = [RECEPTION_PERMISSIONS.read, permission];
      const granted = await WizardPage({ params });
      const capabilities = findProps(granted, 'capabilities')?.['capabilities'] as Record<
        string,
        boolean
      >;
      expect(capabilities[field], `${field} with ${permission}`).toBe(true);

      PERMISSIONS = ALL.filter((p) => p !== permission);
      const denied = await WizardPage({ params });
      const withoutIt = findProps(denied, 'capabilities')?.['capabilities'] as Record<
        string,
        boolean
      >;
      expect(withoutIt[field], `${field} without ${permission}`).toBe(false);
    });
  }

  it('found distinct permissions to test with', () => {
    // If two constants ever collapsed to one string, every pairing above would
    // pass while proving nothing.
    expect(new Set(ALL).size).toBe(ALL.length);
  });

  it('resolves the receiving employee to a NAME, and asks about the stored identifier', async () => {
    /*
     * `canonical-plan.md` §7: "The UI shows names, never UUIDs." The shell used
     * to render `detail.receivingEmployeeId` in a `<code>` element, so the
     * sentence was false in the one place it was about.
     *
     * The identifier asked about is the visit's own, not the operator's — a
     * route that resolved the SIGNED-IN user would render a plausible name for
     * the wrong person on every visit somebody else received.
     */
    PERMISSIONS = [RECEPTION_PERMISSIONS.read, STAFF_DIRECTORY_PERMISSION];
    const tree = await WizardPage({ params });
    expect(readReceivingEmployeeIdentity).toHaveBeenCalledWith(DETAIL.receivingEmployeeId);
    expect(findProps(tree, 'receivingEmployee')?.['receivingEmployee']).toEqual({
      status: 'named',
      displayName: 'Rana Odeh',
    });
  });

  it('spends no request on the directory it may not read, and says so instead', async () => {
    // The gate is decided here, before the request, like every other capability
    // this route resolves: a caller without the code would be spending a request
    // to be refused, and the screen's answer is the same either way.
    PERMISSIONS = ALL.filter((p) => p !== STAFF_DIRECTORY_PERMISSION);
    const tree = await WizardPage({ params });
    expect(readReceivingEmployeeIdentity).not.toHaveBeenCalled();
    expect(findProps(tree, 'receivingEmployee')?.['receivingEmployee']).toEqual({
      status: 'denied',
    });
  });

  it('states a dangling identifier as one, rather than passing it down to be printed', async () => {
    // `receiving_employee_id` carries no foreign key (G-EMP), so a 404 here is a
    // state the database permits and not a fault.
    PERMISSIONS = [RECEPTION_PERMISSIONS.read, STAFF_DIRECTORY_PERMISSION];
    readReceivingEmployeeIdentity.mockResolvedValue({
      status: 'not-found',
      correlationId: 'cid-404',
    });
    const tree = await WizardPage({ params });
    expect(findProps(tree, 'receivingEmployee')?.['receivingEmployee']).toEqual({
      status: 'unresolved',
    });
  });

  it('closes BOTH terminal exits with one permission, as the backend does', () => {
    // `close-without-work` and `refuse` register the same code. Two capability
    // fields would be a second, drifting copy of one backend rule.
    expect(RECEPTION_PERMISSIONS.close).toBe('rec.reception.close');
  });
});

describe('the acknowledgement route', () => {
  const params = Promise.resolve({ locale: 'en', receptionId: DETAIL.id });

  it('is a read: one permission, and no write capability is resolved', async () => {
    PERMISSIONS = ALL.filter((p) => p !== RECEPTION_PERMISSIONS.read);
    const denied = await AcknowledgementPage({ params });
    expect(findProps(denied, 'sections')).toBeNull();
    expect(readReception).not.toHaveBeenCalled();

    PERMISSIONS = [RECEPTION_PERMISSIONS.read];
    const granted = await AcknowledgementPage({ params });
    expect(findProps(granted, 'sections')).not.toBeNull();
  });

  it('reads the three sections on the server, so the first paint is the sheet', async () => {
    PERMISSIONS = [RECEPTION_PERMISSIONS.read];
    await AcknowledgementPage({ params });
    expect(listPartyRoles).toHaveBeenCalledTimes(1);
    expect(listAuthorizations).toHaveBeenCalledTimes(1);
    expect(listConditionEvidence).toHaveBeenCalledTimes(1);
    // Active roles only — an ended role is history, not who handed the vehicle over.
    expect(listPartyRoles.mock.calls[0]?.[1]).toBe('active');
  });

  it('prints the receiving employee by name, and reads nothing when it may not', async () => {
    /*
     * The same rule as the wizard, on the document that matters more: this
     * sheet is the copy a customer signs and takes away, and it used to print
     * the stored identifier on it.
     */
    PERMISSIONS = [RECEPTION_PERMISSIONS.read, STAFF_DIRECTORY_PERMISSION];
    const granted = await AcknowledgementPage({ params });
    expect(readReceivingEmployeeIdentity).toHaveBeenCalledWith(DETAIL.receivingEmployeeId);
    expect(findProps(granted, 'receivingEmployee')?.['receivingEmployee']).toEqual({
      status: 'named',
      displayName: 'Rana Odeh',
    });

    readReceivingEmployeeIdentity.mockClear();
    PERMISSIONS = [RECEPTION_PERMISSIONS.read];
    const withoutDirectory = await AcknowledgementPage({ params });
    expect(readReceivingEmployeeIdentity).not.toHaveBeenCalled();
    expect(findProps(withoutDirectory, 'receivingEmployee')?.['receivingEmployee']).toEqual({
      status: 'denied',
    });
  });

  it('does not spend the directory read on a visit that does not exist', async () => {
    PERMISSIONS = [RECEPTION_PERMISSIONS.read, STAFF_DIRECTORY_PERMISSION];
    readReception.mockResolvedValue({ status: 'not-found', correlationId: 'cid-404' });
    await AcknowledgementPage({ params });
    expect(readReceivingEmployeeIdentity).not.toHaveBeenCalled();
  });

  it('carries the backend correlation reference on a backend denial', async () => {
    PERMISSIONS = [RECEPTION_PERMISSIONS.read];
    readReception.mockResolvedValue({ status: 'denied', correlationId: 'cid-403' });
    const tree = await AcknowledgementPage({ params });
    // The route-level gate was passed and the BACKEND answered the denial, so
    // there is a log line to quote and the state carries it.
    expect(findProps(tree, 'correlationId')?.['correlationId']).toBe('cid-403');
  });

  it('states a missing visit without printing a half-empty sheet', async () => {
    PERMISSIONS = [RECEPTION_PERMISSIONS.read];
    readReception.mockResolvedValue({ status: 'not-found', correlationId: 'cid-404' });
    const tree = await AcknowledgementPage({ params });
    expect(findProps(tree, 'sections')).toBeNull();
    // The section reads are not spent on a visit that does not exist.
    expect(listPartyRoles).not.toHaveBeenCalled();
  });

  it('still prints the sheet when ONE section read fails, and hands the document its FAILURE', async () => {
    /*
     * `F1`. A handover document refused because one of four lists was
     * unavailable is a worse answer than a sheet with a missing section — but
     * the sheet must know the section is missing rather than empty.
     *
     * This assertion used to be `expect(sections.evidence).toEqual([])`, which
     * pinned exactly the defect: the route passed the rows alone, so a failed
     * read reached the document as an empty list and printed as *no evidence is
     * recorded on this visit* — an absence nobody observed, on a document a
     * customer signs. The status and the correlation reference now travel with
     * the rows, and `AcknowledgementDocument` prints the difference.
     */
    PERMISSIONS = [RECEPTION_PERMISSIONS.read];
    listConditionEvidence.mockResolvedValue({
      status: 'error',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'cid-500',
    });
    const tree = await AcknowledgementPage({ params });
    const sections = findProps(tree, 'sections')?.['sections'] as Record<
      string,
      {
        readonly status: string;
        readonly rows: readonly unknown[];
        readonly correlationId: unknown;
      }
    >;

    // The sheet is still printed.
    expect(sections).not.toBeUndefined();
    expect(sections['evidence']?.status).toBe('error');
    expect(sections['evidence']?.rows).toEqual([]);
    expect(sections['evidence']?.correlationId).toBe('cid-500');

    // The sections that DID answer are unaffected: one failed read does not
    // turn the whole sheet into a failure.
    expect(sections['parties']?.status).toBe('ok');
    expect(sections['authorizations']?.status).toBe('ok');
  });
});
