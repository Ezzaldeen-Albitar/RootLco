import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

/** The acknowledgement route, read as SOURCE — a spy cannot see an absent call. */
const ACKNOWLEDGEMENT_PAGE = join(
  process.cwd(),
  'src/app/[locale]/(dashboard)/receptions/check-in/[receptionId]/acknowledgement/page.tsx'
);

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
  receivingEmployeeDisplayName: 'Rana Odeh',
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

const readUserIdentity = vi.fn();

vi.mock('@/features/receptions/support-api', () => ({
  readUserIdentity: (...args: unknown[]) => readUserIdentity(...args),
  // The rest of the module, present because the wizard route's import closure
  // reaches it through the step registry. None of them is called here.
  readCustomerSummary: vi.fn(),
  readVehicleSummary: vi.fn(),
  listVehicleRelationshipEntries: vi.fn(),
  listReceivingEmployeeCandidates: vi.fn(),
  listConfirmedAppointments: vi.fn(),
}));

const { RECEPTION_PERMISSIONS } = await import('@/features/receptions/receptions-contract');
const { USER_DIRECTORY_PERMISSION } = await import('@/features/receptions/people/user-directory');
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
  // `iam.user.read`, which the inspection read-back resolves ACTOR names
  // through. Present so a case that removes it removes something. The
  // receiving employee no longer needs it — its name is a snapshot on the
  // visit — so this is the phase’s only remaining consumer.
  USER_DIRECTORY_PERMISSION,
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
  readUserIdentity.mockReset();
  readReception.mockResolvedValue({ status: 'ok', data: DETAIL, correlationId: 'cid' });
  listPartyRoles.mockResolvedValue(page);
  listAuthorizations.mockResolvedValue(page);
  listConditionEvidence.mockResolvedValue(page);
  readUserIdentity.mockResolvedValue({
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

  it('asks the user directory NOTHING about the receiving employee', async () => {
    /*
     * Four cases became one, because the platform went from four outcomes to
     * none. Both routes used to resolve `receivingEmployeeId` through
     * `iam.user-detail` and hand the wizard shell and the acknowledgement sheet
     * a name — or one of three reasons there was not one.
     *
     * `DBCR-P1-18-002` put `receivingEmployeeDisplayName` on the visit, written
     * at insert and immutable after, so the name arrives with `rec.reception-detail`.
     * The read is not merely redundant: it answered with the account name TODAY,
     * so a rename would have reprinted a past handover under a different
     * person’s name on the copy a customer signed.
     *
     * Asserted as an ABSENCE on both routes, with the capability granted, so a
     * commit that reinstates the lookup fails here rather than passing quietly.
     */
    PERMISSIONS = [RECEPTION_PERMISSIONS.read, USER_DIRECTORY_PERMISSION];

    const wizard = await WizardPage({ params });
    expect(readUserIdentity).not.toHaveBeenCalled();
    expect(findProps(wizard, 'receivingEmployee')).toBeNull();

    const sheet = await AcknowledgementPage({
      params: Promise.resolve({ locale: 'en', receptionId: DETAIL.id }),
    });
    expect(readUserIdentity).not.toHaveBeenCalled();
    expect(findProps(sheet, 'receivingEmployee')).toBeNull();

    // What DOES travel is the snapshot, on the detail both surfaces receive.
    expect(DETAIL.receivingEmployeeDisplayName.trim()).not.toBe('');
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

  it('makes NO directory read at all, on any input', async () => {
    /*
     * This case was titled "does not spend the directory read on a visit that
     * does not exist", which describes a conditional efficiency property of a
     * read that was REMOVED. It granted the directory permission, forced a
     * not-found, and asserted the resolver was not called — an assertion that
     * cannot fail, because the page holds no call to it under any input. A
     * reviewer checking that the removal really happened read a green case whose
     * title says the read exists and behaves well.
     *
     * What replaced it is the property that is actually true and actually
     * falsifiable: the acknowledgement prints the immutable
     * `receivingEmployeeDisplayName` snapshot taken when custody was accepted,
     * so no directory read is issued — for a visit that exists, for one that does
     * not, and with the directory permission granted or withheld.
     */
    for (const permissions of [
      [RECEPTION_PERMISSIONS.read],
      [RECEPTION_PERMISSIONS.read, USER_DIRECTORY_PERMISSION],
    ]) {
      for (const detail of [null, { status: 'not-found' as const, correlationId: 'cid-404' }]) {
        vi.clearAllMocks();
        PERMISSIONS = permissions;
        if (detail !== null) readReception.mockResolvedValue(detail);
        await AcknowledgementPage({ params });
        expect(
          readUserIdentity,
          `permissions=${permissions.join(',')} detail=${detail?.status ?? 'ok'}`
        ).not.toHaveBeenCalled();
      }
    }

    /*
     * …and the source carries no call to make, so this is a property of the page
     * rather than of four fixtures. A mock that is never called and a function
     * that is never referenced look identical from a spy; only one of them is a
     * guarantee.
     */
    const page = readFileSync(ACKNOWLEDGEMENT_PAGE, 'utf8');
    expect(page).not.toContain('readUserIdentity');
    expect(page).toContain('receivingEmployeeDisplayName');
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
