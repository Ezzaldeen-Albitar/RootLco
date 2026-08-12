import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';

/**
 * The JOINT between a session's permissions and the appointment routes'
 * props (`P1-28-SEC-001`, the P1-27-SEC-003 pattern applied to this phase).
 *
 * The component tests prove both directions of every `canX` prop GIVEN the
 * prop; the contract test pins the permission strings. What decides the
 * security property is the handful of `holds(session.permissions, …)` lines
 * in `src/app/**` that connect them — the tree the declared-but-never-wired
 * class historically hid in. Each route module is INVOKED with a synthesised
 * session and its returned element tree walked for the screen's props; no DOM
 * render, so nothing depends on how the screens draw.
 *
 * A pairing, never a single direction: each capability is asserted true when
 * the session holds exactly that permission and false when it holds every
 * OTHER one — the direction that catches a hard-coded `true` and a
 * copy-pasted wrong constant at once.
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
  displayNumber: 'APT-0007',
  lifecycleStatus: 'requested',
  companyId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
  vehicleId: 'a1b2c3d4-0000-4000-8000-00000000000b',
  vehicleDisplayNumber: null,
  requesterPartnerId: 'a1b2c3d4-0000-4000-8000-00000000000c',
  requesterDisplayName: null,
  appointmentTypeId: 'a1b2c3d4-0000-4000-8000-00000000000d',
  appointmentTypeName: null,
  sourceChannelId: null,
  sourceChannelName: null,
  requestedFrom: '2026-08-20T09:00:00+03:00',
  requestedTo: '2026-08-20T10:00:00+03:00',
  confirmedFrom: null,
  confirmedTo: null,
  cancellationReasonId: null,
  cancellationReasonName: null,
  cancelledAt: null,
  noShowRecordedAt: null,
  recordVersion: 1,
  createdAt: '2026-08-10T08:00:00+03:00',
  updatedAt: null,
};

const readAppointment = vi.fn();
vi.mock('@/features/appointments/api', () => ({
  readAppointment: (...args: unknown[]) => readAppointment(...args),
}));

const listAppointmentTypes = vi.fn();
const listSourceChannels = vi.fn();
const listCancellationReasons = vi.fn();
vi.mock('@/features/appointments/catalogue-api', () => ({
  listAppointmentTypes: (...args: unknown[]) => listAppointmentTypes(...args),
  listSourceChannels: (...args: unknown[]) => listSourceChannels(...args),
  listCancellationReasons: (...args: unknown[]) => listCancellationReasons(...args),
}));

const { APPOINTMENT_PERMISSIONS } = await import('@/features/appointments/appointments-contract');
const CalendarPage = (await import('@/app/[locale]/(dashboard)/appointments/page')).default;
const BookingPage = (await import('@/app/[locale]/(dashboard)/appointments/new/page')).default;
const DetailPage = (await import('@/app/[locale]/(dashboard)/appointments/[appointmentId]/page'))
  .default;

const ALL = [
  APPOINTMENT_PERMISSIONS.read,
  APPOINTMENT_PERMISSIONS.manage,
  APPOINTMENT_PERMISSIONS.lifecycleManage,
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

beforeEach(() => {
  PERMISSIONS = [];
  readAppointment.mockReset();
  listAppointmentTypes.mockReset();
  listSourceChannels.mockReset();
  listCancellationReasons.mockReset();
  readAppointment.mockResolvedValue({ status: 'ok', data: DETAIL, correlationId: 'cid' });
  const catalogue = { status: 'ok', options: [], truncated: false, correlationId: null };
  listAppointmentTypes.mockResolvedValue(catalogue);
  listSourceChannels.mockResolvedValue(catalogue);
  listCancellationReasons.mockResolvedValue(catalogue);
});

describe('the calendar route', () => {
  it('renders the screen only for a holder of the read permission', async () => {
    PERMISSIONS = [APPOINTMENT_PERMISSIONS.read];
    const granted = await CalendarPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(findProps(granted, 'companyIds')).not.toBeNull();

    PERMISSIONS = ALL.filter((p) => p !== APPOINTMENT_PERMISSIONS.read);
    const denied = await CalendarPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(findProps(denied, 'companyIds')).toBeNull();
  });

  it('grants the booking offer from the manage permission and nothing else', async () => {
    PERMISSIONS = [APPOINTMENT_PERMISSIONS.read, APPOINTMENT_PERMISSIONS.manage];
    const granted = await CalendarPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(findProps(granted, 'companyIds')?.['canManage']).toBe(true);

    PERMISSIONS = ALL.filter((p) => p !== APPOINTMENT_PERMISSIONS.manage);
    const denied = await CalendarPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(findProps(denied, 'companyIds')?.['canManage']).toBe(false);
  });

  it("passes the session's own resolved scope as the target options", async () => {
    PERMISSIONS = [APPOINTMENT_PERMISSIONS.read];
    const tree = await CalendarPage({ params: Promise.resolve({ locale: 'en' }) });
    const props = findProps(tree, 'companyIds');
    expect(props?.['companyIds']).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(props?.['branchIds']).toEqual(['22222222-2222-4222-8222-222222222222']);
  });
});

describe('the booking route', () => {
  it('gates on manage and reads the catalogues only past the gate', async () => {
    PERMISSIONS = ALL.filter((p) => p !== APPOINTMENT_PERMISSIONS.manage);
    const denied = await BookingPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(findProps(denied, 'types')).toBeNull();
    // A denied operator costs nothing: the gate is checked BEFORE the reads.
    expect(listAppointmentTypes).not.toHaveBeenCalled();
    expect(listSourceChannels).not.toHaveBeenCalled();

    PERMISSIONS = [APPOINTMENT_PERMISSIONS.manage];
    const granted = await BookingPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(findProps(granted, 'types')).not.toBeNull();
    expect(listAppointmentTypes).toHaveBeenCalledTimes(1);
    expect(listSourceChannels).toHaveBeenCalledTimes(1);
  });
});

describe('the detail route', () => {
  const params = Promise.resolve({ locale: 'en', appointmentId: DETAIL.id });

  it('renders the screen only for a holder of the read permission, before any request', async () => {
    PERMISSIONS = ALL.filter((p) => p !== APPOINTMENT_PERMISSIONS.read);
    const denied = await DetailPage({ params });
    expect(findProps(denied, 'detail')).toBeNull();
    expect(readAppointment).not.toHaveBeenCalled();

    PERMISSIONS = [APPOINTMENT_PERMISSIONS.read];
    const granted = await DetailPage({ params });
    expect(findProps(granted, 'detail')).not.toBeNull();
  });

  for (const { prop, permission } of [
    { prop: 'canManage', permission: APPOINTMENT_PERMISSIONS.manage },
    { prop: 'canEndLifecycle', permission: APPOINTMENT_PERMISSIONS.lifecycleManage },
  ]) {
    it(`grants ${prop} for ${permission} and for nothing else`, async () => {
      PERMISSIONS = [APPOINTMENT_PERMISSIONS.read, permission];
      const granted = await DetailPage({ params });
      expect(findProps(granted, 'detail')?.[prop]).toBe(true);

      PERMISSIONS = ALL.filter((p) => p !== permission);
      const denied = await DetailPage({ params });
      expect(findProps(denied, 'detail')?.[prop]).toBe(false);
    });
  }

  it('reads the cancellation reasons only for a holder of the lifecycle permission', async () => {
    PERMISSIONS = [APPOINTMENT_PERMISSIONS.read];
    const withoutIt = await DetailPage({ params });
    expect(findProps(withoutIt, 'detail')?.['cancellationReasons']).toBeNull();
    expect(listCancellationReasons).not.toHaveBeenCalled();

    PERMISSIONS = [APPOINTMENT_PERMISSIONS.read, APPOINTMENT_PERMISSIONS.lifecycleManage];
    const withIt = await DetailPage({ params });
    expect(findProps(withIt, 'detail')?.['cancellationReasons']).not.toBeNull();
    expect(listCancellationReasons).toHaveBeenCalledTimes(1);
  });

  it('carries the backend correlation reference on a backend denial', async () => {
    PERMISSIONS = [APPOINTMENT_PERMISSIONS.read];
    readAppointment.mockResolvedValue({ status: 'denied', correlationId: 'cid-403' });
    const tree = await DetailPage({ params });
    // The route-level gate above was passed and the BACKEND answered the
    // denial, so there is a log line to quote and the state carries it.
    const denial = findProps(tree, 'correlationId');
    expect(denial?.['correlationId']).toBe('cid-403');
  });

  it('found distinct permissions to test with', () => {
    // If two constants ever collapsed to one string, every pairing above
    // would pass while proving nothing.
    expect(new Set(ALL).size).toBe(ALL.length);
  });
});
