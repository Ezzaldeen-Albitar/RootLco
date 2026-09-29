import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

/**
 * The route-level wires of the appointment enablement (Owner decision 2026-09-29):
 * the appointment setup page's gate and the booking page's `canSetUpCatalogue`.
 *
 * ## Why this file exists
 *
 * Both halves were proven and the wire between them was not — the P1-27-SEC-003
 * shape. `appointment-setup.dom.test.tsx` mounts the setup SCREEN directly and
 * `appointments-booking.dom.test.tsx` hands the booking screen its
 * `canSetUpCatalogue` prop, so neither can see the page that decides them. And
 * `check-p1-28-access` rule 1 (gate before read) is blind to the setup page: the
 * page reads nothing on the server — the screen reads through client-side server
 * actions — so deleting the whole gate block left that gate at zero violations.
 * This file is the only thing that fails when either wire is removed.
 *
 * ## How it is asserted
 *
 * The route module is INVOKED with a synthesised session and its returned element
 * tree is walked. No DOM render, so no client machinery runs.
 *
 * A PAIRING, never a single direction: granted with exactly the codes that must
 * grant it, withheld with every OTHER code the administration and appointment
 * surfaces know about. A one-directional test passes against `canX={true}` and
 * against a page with no gate at all.
 */

let SESSION_PERMISSIONS: string[] = [];

vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    userId: 'ba9f2f2e-0000-4000-8000-000000000011',
    tenantId: 'ba9f2f2e-0000-4000-8000-0000000000fe',
    email: 'setup.probe@test.local',
    displayName: 'Setup probe',
    companyIds: [],
    branchIds: [],
    permissions: SESSION_PERMISSIONS,
  }),
}));

const EMPTY_CATALOGUE = { status: 'ok', options: [], truncated: false, correlationId: 'cid' };
const EMPTY_MANAGED = {
  status: 'ok',
  data: { items: [], nextCursor: null, hasMore: false },
  correlationId: null,
};
const intakeReads = vi.fn(async () => EMPTY_CATALOGUE);
const managedReads = vi.fn(async () => EMPTY_MANAGED);
const writes = vi.fn(async () => ({ status: 'success', messageKey: 'action.done', attempt: 1 }));

vi.mock('@/features/appointments/catalogue-api', () => ({
  listAppointmentTypes: () => intakeReads(),
  listSourceChannels: () => intakeReads(),
  listCancellationReasons: () => intakeReads(),
  listManagedAppointmentTypes: () => managedReads(),
  listManagedSourceChannels: () => managedReads(),
  listManagedCancellationReasons: () => managedReads(),
  createAppointmentType: () => writes(),
  createSourceChannel: () => writes(),
  createCancellationReason: () => writes(),
  renameAppointmentType: () => writes(),
  renameSourceChannel: () => writes(),
  renameCancellationReason: () => writes(),
  setAppointmentTypeStatus: () => writes(),
  setSourceChannelStatus: () => writes(),
  setCancellationReasonStatus: () => writes(),
}));

const { PermissionDeniedState } = await import('@/components/states/States');
const { AppointmentSetupScreen } =
  await import('@/features/appointments/components/AppointmentSetupScreen');
const { AppointmentBookingScreen } =
  await import('@/features/appointments/components/AppointmentBookingScreen');
const { PERMISSIONS } = await import('@/features/administration/shared/permissions');
const { APPOINTMENT_PERMISSIONS } = await import('@/features/appointments/appointments-contract');

const AppointmentSetupPage = (
  await import('@/app/[locale]/(dashboard)/administration/appointment-setup/page')
).default;
const AppointmentBookingPage = (await import('@/app/[locale]/(dashboard)/appointments/new/page'))
  .default;

/**
 * Every code the two surfaces know about, derived from their own constant records
 * so a code added to either is in the "every OTHER code" direction automatically.
 * The literal extras are the neighbouring codes a copy-paste would most plausibly
 * reach for.
 */
const ALL_CODES = [
  ...new Set<string>([
    ...Object.values(PERMISSIONS),
    ...Object.values(APPOINTMENT_PERMISSIONS),
    'rec.catalogue.manage',
    'rec.reception.read',
    'rec.reception.manage',
    'org.settings.manage',
  ]),
];

const CATALOGUE_MANAGE = 'apt.catalogue.manage';
const APPOINTMENT_MANAGE = 'apt.appointment.manage';

type Props = Record<string, unknown>;

/** Whether the tree contains an element of `component`, and its props if so. */
function findElement(node: unknown, component: unknown): Props | null {
  if (node === null || node === undefined || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, component);
      if (found) return found;
    }
    return null;
  }
  const element = node as ReactElement<Props>;
  if (element.type === component) return (element.props ?? {}) as Props;
  const props = element.props;
  if (!props || typeof props !== 'object') return null;
  return findElement((props as { children?: unknown }).children, component);
}

const LOCALE = Promise.resolve({ locale: 'en' });

async function setupTree(permissions: readonly string[]): Promise<unknown> {
  SESSION_PERMISSIONS = [...permissions];
  return AppointmentSetupPage({ params: LOCALE });
}

async function bookingProps(permissions: readonly string[]): Promise<Props> {
  SESSION_PERMISSIONS = [...permissions];
  const tree = await AppointmentBookingPage({ params: LOCALE });
  const props = findElement(tree, AppointmentBookingScreen);
  expect(props, 'the booking page did not render its screen').not.toBeNull();
  return props as Props;
}

beforeEach(() => {
  SESSION_PERMISSIONS = [];
  intakeReads.mockClear();
  managedReads.mockClear();
  writes.mockClear();
});

describe('the fixtures can tell the codes apart', () => {
  it('knows both codes under test and enough others to make "every other" mean something', () => {
    expect(ALL_CODES).toContain(CATALOGUE_MANAGE);
    expect(ALL_CODES).toContain(APPOINTMENT_MANAGE);
    expect(PERMISSIONS.appointmentCatalogueManage).toBe(CATALOGUE_MANAGE);
    expect(APPOINTMENT_PERMISSIONS.catalogueManage).toBe(CATALOGUE_MANAGE);
    expect(APPOINTMENT_PERMISSIONS.manage).toBe(APPOINTMENT_MANAGE);
    expect(ALL_CODES.filter((code) => code !== CATALOGUE_MANAGE).length).toBeGreaterThan(20);
  });
});

describe('the appointment setup page is gated on apt.catalogue.manage', () => {
  it('renders the denial INSTEAD of the screen for a session holding every other code', async () => {
    const tree = await setupTree(ALL_CODES.filter((code) => code !== CATALOGUE_MANAGE));
    expect(findElement(tree, PermissionDeniedState), 'no denial was rendered').not.toBeNull();
    expect(
      findElement(tree, AppointmentSetupScreen),
      'the setup screen rendered for a session without apt.catalogue.manage'
    ).toBeNull();
    expect(managedReads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it('renders the denial for a session holding nothing', async () => {
    const tree = await setupTree([]);
    expect(findElement(tree, PermissionDeniedState)).not.toBeNull();
    expect(findElement(tree, AppointmentSetupScreen)).toBeNull();
  });

  it('renders the screen, and no denial, for a session holding only apt.catalogue.manage', async () => {
    const tree = await setupTree([CATALOGUE_MANAGE]);
    const screen = findElement(tree, AppointmentSetupScreen);
    expect(screen, 'the setup screen was withheld from a holder of the code').not.toBeNull();
    expect(screen?.['locale']).toBe('en');
    expect(findElement(tree, PermissionDeniedState)).toBeNull();
  });
});

describe('the booking page offers the way to setup only to a holder of apt.catalogue.manage', () => {
  it('grants canSetUpCatalogue for exactly apt.appointment.manage + apt.catalogue.manage', async () => {
    const granted = await bookingProps([APPOINTMENT_MANAGE, CATALOGUE_MANAGE]);
    expect(granted['canSetUpCatalogue']).toBe(true);
  });

  it('withholds canSetUpCatalogue from a session holding every other code', async () => {
    const denied = await bookingProps(ALL_CODES.filter((code) => code !== CATALOGUE_MANAGE));
    expect(denied['canSetUpCatalogue'], 'granted without apt.catalogue.manage').toBe(false);
  });

  it('withholds canSetUpCatalogue from a session holding only the booking gate', async () => {
    const denied = await bookingProps([APPOINTMENT_MANAGE]);
    expect(denied['canSetUpCatalogue']).toBe(false);
  });
});
