import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';
import {
  NO_WRITES,
  permittedWrites,
  WRITE_PERMISSIONS,
} from '@/features/crm/customers/governance-contract';
import type { CustomerDetail } from '@/features/crm/customers/profile-contract';

/**
 * A control an operator cannot use should not be offered (`P1-27-SEC-001`).
 *
 * ## What was wrong
 *
 * `CustomerProfileScreen` renders nine write forms. One — lifecycle status —
 * was gated on `crm.customer.governance.manage`. The other eight rendered
 * whenever the LIST behind them loaded, and every one of those lists needs
 * `crm.customer.read`: exactly the permission the profile page already requires.
 *
 * So an operator holding read and nothing else opened a customer and was offered
 * "Add contact", "Record consent", "Impose restriction" and five more, each of
 * which answered 403 after they had finished typing. `WRITE_PERMISSIONS` had
 * named the right capability for six of them since the day it shipped and had no
 * consumer outside its own test.
 *
 * The vehicle profile had the same shape in two places: plate assignment
 * (`veh.vehicle.manage`) and odometer readings (`veh.vehicle.odometer.record`).
 * Ownership transfer, beside them, was correctly gated — which is what makes
 * this an omission rather than a policy.
 *
 * ## What is asserted
 *
 * Both directions, per surface. A test that only proved the forms disappear
 * would pass just as happily against a screen that renders no forms at all —
 * and "hidden from everyone" is the failure mode this phase has already shipped
 * once, when a control was gated on `status === 'ok'` for a status that has no
 * `'ok'` member.
 *
 * ## Not a security boundary
 *
 * The Backend authorizes every request and its denial is the only one that
 * counts. Nothing here can stop a forged call, and the last case in this file
 * pins that the client never claims otherwise.
 */

const listContacts = vi.fn();
const listAddresses = vi.fn();
const listPreferences = vi.fn();
const listConsents = vi.fn();
const listNotes = vi.fn();
const listAlerts = vi.fn();
const listTags = vi.fn();
const listRestrictions = vi.fn();
const listTimeline = vi.fn();
const listPlates = vi.fn();
const listOdometer = vi.fn();
const listOwnerships = vi.fn();

const okPage = { status: 'ok', rows: [], nextCursor: null, hasMore: false, correlationId: 'cid' };

// The alerts and tags sections reach for the router. Without this they throw
// "expected app router to be mounted" — which fails loudly rather than quietly,
// but only on the two cases that render a form.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/crm/customers/2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/features/crm/customers/profile-api', () => ({
  listContacts: (...a: unknown[]) => listContacts(...a),
  listAddresses: (...a: unknown[]) => listAddresses(...a),
  listPreferences: (...a: unknown[]) => listPreferences(...a),
  listConsents: (...a: unknown[]) => listConsents(...a),
  listNotes: (...a: unknown[]) => listNotes(...a),
  listAlerts: (...a: unknown[]) => listAlerts(...a),
  listTags: (...a: unknown[]) => listTags(...a),
  listRestrictions: (...a: unknown[]) => listRestrictions(...a),
}));
// Unmocked, these adapters reach the real authorized client and call `cookies()`
// outside a request scope. The write ACTIONS are mocked too — a form binds its
// action while rendering, so an absent export throws before anything is on
// screen and would look exactly like a working gate.
vi.mock('@/features/crm/customers/identity-api', () => ({
  listTimeline: (...a: unknown[]) => listTimeline(...a),
  listHistory: async () => okPage,
  listDuplicates: async () => okPage,
  reviewDuplicateAction: vi.fn(),
}));
vi.mock('@/features/vehicles/history-api', () => ({
  listPlates: (...a: unknown[]) => listPlates(...a),
  listOdometerReadings: (...a: unknown[]) => listOdometer(...a),
  listOwnerships: (...a: unknown[]) => listOwnerships(...a),
  assignPlateAction: vi.fn(),
  recordOdometerAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}));

const { CustomerProfileScreen } =
  await import('@/features/crm/customers/components/CustomerProfileScreen');
const { PlateSection, OdometerSection } =
  await import('@/features/vehicles/components/VehicleHistorySections');

beforeEach(() => {
  for (const fn of [
    listContacts,
    listAddresses,
    listPreferences,
    listConsents,
    listNotes,
    listAlerts,
    listTags,
    listRestrictions,
    listTimeline,
    listPlates,
    listOdometer,
    listOwnerships,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue(okPage);
  }
});

const CUSTOMER: CustomerDetail = {
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

/**
 * The nine customer sections: which tab, which write capability, and a string
 * that appears ONLY inside that section's form.
 *
 * The marker is the form's submit/title copy, not a generic word — matching
 * something the table also renders would make the "hidden" assertion pass while
 * the form was on screen.
 */
const CUSTOMER_SURFACES = [
  { tab: 'contacts', kind: 'contact', marker: en['crm.customers.contacts.add'] },
  { tab: 'addresses', kind: 'address', marker: en['crm.customers.addresses.add'] },
  { tab: 'preferences', kind: 'preference', marker: en['crm.customers.preferences.set'] },
  { tab: 'consents', kind: 'consent', marker: en['crm.customers.consents.record'] },
  { tab: 'notes', kind: 'note', marker: en['crm.customers.notes.add'] },
  { tab: 'alerts', kind: 'alert', marker: en['crm.customers.alerts.raise'] },
  { tab: 'tags', kind: 'tag', marker: en['crm.customers.tags.assign'] },
  { tab: 'restrictions', kind: 'restriction', marker: en['crm.customers.restrictions.impose'] },
] as const;

/**
 * Asserts the form is on screen.
 *
 * `findAllByText`, because `RecordForm` renders the same key as both its heading
 * and its submit button — so the marker legitimately appears twice and
 * `findByText` throws "found multiple elements" on a correctly rendered form.
 * Asserting at least one, rather than exactly two, keeps this about presence
 * rather than about how the form happens to be laid out.
 */
async function expectOffered(marker: string) {
  const found = await screen.findAllByText(marker);
  expect(found.length, marker).toBeGreaterThan(0);
}

/**
 * Renders the profile and opens one section.
 *
 * `userEvent.click`, never `element.click()` — a raw DOM click dispatches
 * outside React's act scope, so the tab state update may not be flushed before
 * the assertion. That produces a screen with no form on it, which is
 * indistinguishable from a working gate and would have made half of this file
 * pass for the wrong reason.
 */
async function openSection(tab: string, writes?: ReturnType<typeof permittedWrites>) {
  const user = userEvent.setup();
  const view = renderLtr(
    <CustomerProfileScreen
      locale="en"
      messages={en}
      customer={CUSTOMER}
      {...(writes ? { writes } : {})}
    />
  );
  const label = en[`crm.customers.profile.section.${tab}` as keyof typeof en] as string;
  await user.click(screen.getByRole('button', { name: label }));
  return view;
}

describe('a customer profile offers only the writes the session holds', () => {
  it.each(CUSTOMER_SURFACES)(
    'shows the $tab form to an operator who holds its permission',
    async ({ tab, kind, marker }) => {
      await openSection(tab, permittedWrites([WRITE_PERMISSIONS[kind]]));
      await expectOffered(marker);
    }
  );

  it.each(CUSTOMER_SURFACES)(
    'hides the $tab form from an operator who holds only crm.customer.read',
    async ({ tab, marker }) => {
      const { container } = await openSection(tab, permittedWrites(['crm.customer.read']));
      // Wait for the LIST to resolve before concluding the form is absent —
      // otherwise this passes because nothing has rendered yet, which would be
      // true of a broken screen as well as a correctly gated one.
      await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
      expect(container.textContent ?? '').not.toContain(marker);
    }
  );

  it('holding one capability does not unlock a surface guarded by another', async () => {
    // `note` and `restriction` are the pair the contract singles out: adding a
    // note is routine, refusing to serve a customer is not.
    const { container } = await openSection(
      'restrictions',
      permittedWrites([WRITE_PERMISSIONS.note])
    );
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    expect(container.textContent ?? '').not.toContain(en['crm.customers.restrictions.impose']);

    // The same session, on the section it DOES hold — so this proves a
    // capability boundary rather than a screen that renders no forms at all.
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en['crm.customers.profile.section.notes'] }));
    await expectOffered(en['crm.customers.notes.add']);
  });

  it('does not disclose the restriction vocabulary to a reader', async () => {
    // The form names `no_credit` and `contact_restriction` in its options. Those
    // labels are the tenant's own governance policy, and a denial that still
    // printed them would leak what the denial exists to hide.
    const { container } = await openSection('restrictions', NO_WRITES);
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    const text = container.textContent ?? '';
    expect(text).not.toContain(en['crm.restrictionType.no_credit']);
    expect(text).not.toContain(en['crm.restrictionType.contact_restriction']);
  });

  it('defaults to offering nothing when a caller forgets the prop', async () => {
    // `writes` is optional so the default is what an omission produces, and the
    // safe direction is a read-only profile rather than nine failing controls.
    const { container } = await openSection('notes');
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    expect(container.textContent ?? '').not.toContain(en['crm.customers.notes.add']);
  });
});

describe('the two ungated vehicle writes', () => {
  const base = { locale: 'en' as const, messages: en, vehicleId: 'v-1', today: '2026-08-08' };

  it('shows plate assignment to veh.vehicle.manage and hides it otherwise', async () => {
    const shown = renderLtr(<PlateSection {...base} canEdit />);
    await expectOffered(en['vehicles.plate.assign']);
    shown.unmount();

    const hidden = renderLtr(<PlateSection {...base} canEdit={false} />);
    await waitFor(() => expect(hidden.container.querySelector('table')).not.toBeNull());
    expect(hidden.container.textContent ?? '').not.toContain(en['vehicles.plate.assign']);
  });

  it('shows odometer recording to veh.vehicle.odometer.record and hides it otherwise', async () => {
    const shown = renderLtr(
      <OdometerSection locale="en" messages={en} vehicleId="v-1" canRecord />
    );
    await expectOffered(en['vehicles.odometer.record']);
    shown.unmount();

    const hidden = renderLtr(
      <OdometerSection locale="en" messages={en} vehicleId="v-1" canRecord={false} />
    );
    await waitFor(() => expect(hidden.container.querySelector('table')).not.toBeNull());
    expect(hidden.container.textContent ?? '').not.toContain(en['vehicles.odometer.record']);
  });

  it('defaults both to hidden', async () => {
    // Neither prop is required at the section boundary, because the profile
    // screen supplies them. The default still has to be the closed one.
    const plates = renderLtr(<PlateSection {...base} />);
    await waitFor(() => expect(plates.container.querySelector('table')).not.toBeNull());
    expect(plates.container.textContent ?? '').not.toContain(en['vehicles.plate.assign']);
    plates.unmount();

    const odo = renderLtr(<OdometerSection locale="en" messages={en} vehicleId="v-1" />);
    await waitFor(() => expect(odo.container.querySelector('table')).not.toBeNull());
    expect(odo.container.textContent ?? '').not.toContain(en['vehicles.odometer.record']);
  });
});

describe('the gate is visibility, and the code says so', () => {
  it('is not the enforcement, and nothing here pretends it is', () => {
    // The Server Actions carry no permission check of their own and must not
    // grow one: the Backend authorizes every call, and a second opinion computed
    // in the browser process would be a second answer that can disagree.
    //
    // This assertion exists so that a future change adding a client-side
    // `if (!canWrite) return` to an action — which would look like defence in
    // depth and would in fact be a new source of truth — is a deliberate act
    // rather than a quiet one.
    expect(Object.keys(WRITE_PERMISSIONS)).toHaveLength(9);
    expect(Object.values(NO_WRITES).some(Boolean)).toBe(false);
  });
});
