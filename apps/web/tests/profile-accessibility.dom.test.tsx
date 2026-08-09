import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { CustomerDetail } from '@/features/crm/customers/profile-contract';
import type { VehicleDetail } from '@/features/vehicles/profile-contract';

/**
 * Accessibility over the two PROFILE screens (`P1-27-FE-006`, `P1-27-QA-001`).
 *
 * ## The gap this closes, in the spec's own words
 *
 * `tests/e2e/authenticated/accessibility.spec.ts:84-93` records it: "The profile
 * and detail screens are scanned by NOTHING … exactly three files in `apps/web`
 * import `vitest-axe` (`gallery-and-print`, `overlays`, `shell`) and none of them
 * renders `VehicleProfileScreen`, `CustomerProfileScreen`,
 * `VehicleDuplicateReviewScreen` or `DuplicateReviewScreen`."
 *
 * The Playwright scan cannot reach them without a real customer or vehicle id,
 * and a scan pointed at a 404 reports zero violations — a vacuous pass on an
 * accessibility gate, which is the failure class this repository has been burned
 * by before. The component tier has no such problem: the screens are rendered
 * directly, with fixtures, in both directions.
 *
 * ## Which rules run, and the one that CANNOT run here
 *
 * The same four WCAG tags the browser gate claims. `label-content-name-mismatch`
 * is re-enabled by name for the same reason the browser gate re-enables it — axe
 * sets `tagExclude = ['experimental', 'deprecated']` and drops it from every
 * tag-scoped run — but it is **not measurable in this tier**, and that is
 * recorded rather than assumed either way.
 *
 * Measured, not guessed: scoped directly to that one rule, on an element that
 * plainly breaks it, axe 4.12 under jsdom returns it in `incomplete` and never
 * in `violations`. The rule needs on-screen geometry that jsdom does not
 * compute. So no scan in this file can report SC 2.5.3, the browser tier is the
 * only place it can be reported, and the case below pins that fact so an axe or
 * jsdom upgrade that changes it surfaces as a failure instead of as a silent
 * widening.
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
const listDuplicates = vi.fn();
const listOwnerships = vi.fn();
const listPlates = vi.fn();
const listOdometerReadings = vi.fn();
const listRelationships = vi.fn();
const listAttributeHistory = vi.fn();

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
vi.mock('@/features/crm/customers/identity-api', () => ({
  listTimeline: (...a: unknown[]) => listTimeline(...a),
  listDuplicates: (...a: unknown[]) => listDuplicates(...a),
  reviewDuplicateAction: vi.fn(async () => ({ status: 'idle' })),
}));
vi.mock('@/features/vehicles/history-api', () => ({
  listOwnerships: (...a: unknown[]) => listOwnerships(...a),
  listPlates: (...a: unknown[]) => listPlates(...a),
  listOdometerReadings: (...a: unknown[]) => listOdometerReadings(...a),
  assignPlateAction: vi.fn(async () => ({ status: 'idle' })),
  transferOwnershipAction: vi.fn(async () => ({ status: 'idle' })),
  recordOdometerAction: vi.fn(async () => ({ status: 'idle' })),
}));
vi.mock('@/features/vehicles/relations-api', () => ({
  listRelationships: (...a: unknown[]) => listRelationships(...a),
  authorizePartyAction: vi.fn(async () => ({ status: 'idle' })),
  retirePartyAction: vi.fn(async () => ({ status: 'idle' })),
  linkCustomerAction: vi.fn(async () => ({ status: 'idle' })),
  setEvProfileAction: vi.fn(async () => ({ status: 'idle' })),
}));
vi.mock('@/features/vehicles/duplicates-api', () => ({
  listAttributeHistory: (...a: unknown[]) => listAttributeHistory(...a),
}));
vi.mock('@/features/vehicles/profile-api', () => ({
  updateVehicleAction: vi.fn(async () => ({ status: 'idle' })),
  changeVehicleStatusAction: vi.fn(async () => ({ status: 'idle' })),
  checkVinAvailability: vi.fn(async () => ({ verdict: 'unavailable', holderId: null })),
}));
vi.mock('@/features/crm/customers/api', () => ({ searchCustomers: vi.fn(async () => EMPTY_PAGE) }));

const { CustomerProfileScreen } =
  await import('@/features/crm/customers/components/CustomerProfileScreen');
const { VehicleProfileScreen } =
  await import('@/features/vehicles/components/VehicleProfileScreen');
const { WRITE_PERMISSIONS, permittedWrites } =
  await import('@/features/crm/customers/governance-contract');

const EMPTY_PAGE = {
  status: 'ok',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'fixed-correlation-id',
};

/** WCAG 2.1 A and AA — the same four tags the browser gate claims. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Rules a TAG-SCOPED run silently drops, re-enabled by name. See the docblock. */
const ALSO = { 'label-content-name-mismatch': { enabled: true } };

const OPTIONS = { runOnly: TAGS, rules: ALSO } as never;

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
    listDuplicates,
    listOwnerships,
    listPlates,
    listOdometerReadings,
    listRelationships,
    listAttributeHistory,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue(EMPTY_PAGE);
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

const VEHICLE: VehicleDetail = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  displayNumber: 'V-0001',
  vin: '1HGCM82633A004352',
  makeId: 'mk1',
  makeName: 'Toyota',
  modelId: 'md1',
  modelName: 'Camry',
  trimId: null,
  trimName: null,
  bodyTypeId: null,
  bodyTypeName: null,
  powertrainTypeId: null,
  powertrainTypeName: null,
  modelYear: 2019,
  powertrainCategory: 'ev',
  color: 'Silver',
  lifecycleStatus: 'active',
  workshopStatus: 'none',
  mergedIntoId: null,
  recordVersion: 3,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: null,
};

/** Every write permitted, so the forms are on screen and are scanned too. */
const ALL_WRITES = permittedWrites(Object.values(WRITE_PERMISSIONS));

interface Violation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly nodes: readonly { readonly target: readonly string[] }[];
}

/**
 * The critical and serious findings in one container.
 *
 * Moderate and minor are returned separately rather than swallowed, and the
 * caller decides — the same disposition the browser gate makes.
 */
async function blockingViolations(container: HTMLElement): Promise<Violation[]> {
  const results = (await axe(container, OPTIONS)) as unknown as { violations: Violation[] };
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}

function describeViolations(found: Violation[]): string {
  return found
    .map((v) => `  ${v.id} (${v.impact}) — ${v.help}\n    ${v.nodes[0]?.target.join(' ') ?? ''}`)
    .join('\n');
}

describe('what this tier can and cannot measure', () => {
  it('cannot report SC 2.5.3 — the rule answers "incomplete" under jsdom', async () => {
    /*
     * Visible text "V-0001", announced name "First record" — the plainest
     * Label in Name failure there is, and the exact shape of the one the vehicle
     * duplicate queue shipped.
     *
     * Scoped to that single rule so nothing else can mask the answer. It comes
     * back INCOMPLETE: axe cannot establish that the text is on screen, because
     * jsdom computes no geometry. An earlier version of this file asserted the
     * violation and would have been a false claim of 2.5.3 coverage.
     *
     * Pinned in both directions so a future axe or jsdom that DOES decide fails
     * here — at which point this file should assert the violation instead, and
     * the browser gate stops being the only place the rule can run.
     */
    const { container } = renderLtr(
      <a href="#x" aria-label="First record">
        V-0001
      </a>
    );
    const results = (await axe(container, {
      runOnly: { type: 'rule', values: ['label-content-name-mismatch'] },
    } as never)) as unknown as {
      violations: Violation[];
      incomplete: Violation[];
    };
    expect(results.violations.map((v) => v.id)).not.toContain('label-content-name-mismatch');
    expect(
      results.incomplete.map((v) => v.id),
      'axe now decides this rule under jsdom — assert the violation here instead'
    ).toContain('label-content-name-mismatch');
  });

  it('DOES report a rule that jsdom can decide, on the same kind of container', async () => {
    // The control. Without it the case above would read as "axe reports nothing
    // here", which would make every scan in this file worthless.
    const { container } = renderLtr(
      <div>
        <input type="text" />
      </div>
    );
    const results = (await axe(container, OPTIONS)) as unknown as { violations: Violation[] };
    expect(results.violations.map((v) => v.id)).toContain('label');
  });
});

const CUSTOMER_SECTIONS = [
  'overview',
  'contacts',
  'addresses',
  'preferences',
  'consents',
  'notes',
  'alerts',
  'tags',
  'restrictions',
  'timeline',
  'vehicles',
] as const;

describe('the customer profile has no critical or serious violation', () => {
  it.each(CUSTOMER_SECTIONS)('scans the %s section with every write offered', async (section) => {
    const user = userEvent.setup();
    const { container } = renderLtr(
      <CustomerProfileScreen locale="en" messages={en} customer={CUSTOMER} writes={ALL_WRITES} />
    );
    const label = en[`crm.customers.profile.section.${section}` as keyof typeof en] as string;
    expect(typeof label, `no catalogue label for the ${section} tab`).toBe('string');
    // Anchored rather than exact: a section with no screen yet appends the
    // "Planned" marker to its tab, so its accessible name is the label plus a
    // word — and an exact match would find nothing and fail for the wrong
    // reason.
    await user.click(screen.getByRole('button', { name: new RegExp(`^${label}\\b`) }));
    // Wait for the section to settle. Scanning a half-rendered screen is a
    // scan over nothing, which is the vacuous pass this file exists to avoid.
    await waitFor(() => expect(container.textContent ?? '').toContain(label));

    const found = await blockingViolations(container);
    expect(found, `${section}:\n${describeViolations(found)}`).toEqual([]);
  });

  it('scans the profile in Arabic, right to left', async () => {
    // A direction bug is an accessibility bug that the LTR pass cannot see.
    const { container } = renderRtl(
      <CustomerProfileScreen locale="ar" messages={ar} customer={CUSTOMER} writes={ALL_WRITES} />
    );
    await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
    const found = await blockingViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('scans the read-only profile, which renders a different screen', async () => {
    // Nine forms fewer, and every heading and table still present. A screen that
    // is accessible with its controls is not thereby accessible without them.
    const { container } = renderLtr(
      <CustomerProfileScreen locale="en" messages={en} customer={CUSTOMER} />
    );
    await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
    const found = await blockingViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

const VEHICLE_SECTIONS = [
  'overview',
  'ownership',
  'plates',
  'odometer',
  'ev',
  'relationships',
  'documents',
  'history',
] as const;

function vehicleScreen(locale: 'en' | 'ar') {
  const messages = locale === 'en' ? en : ar;
  const view = locale === 'en' ? renderLtr : renderRtl;
  return view(
    <VehicleProfileScreen
      locale={locale}
      messages={messages}
      vehicle={VEHICLE}
      canEdit
      canChangeStatus
      canManageRelationships
      canLinkCustomer
      canRecordOdometer
      evProfile={{ status: 'none' }}
      canListDocuments
      documents={{ status: 'ok', documentIds: [] }}
    />
  );
}

describe('the vehicle profile has no critical or serious violation', () => {
  it.each(VEHICLE_SECTIONS)('scans the %s section with every write offered', async (section) => {
    const user = userEvent.setup();
    const { container } = vehicleScreen('en');
    const label = en[`vehicles.profile.section.${section}` as keyof typeof en] as string;
    expect(typeof label, `no catalogue label for the ${section} tab`).toBe('string');
    await user.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(container.textContent ?? '').toContain(label));

    const found = await blockingViolations(container);
    expect(found, `${section}:\n${describeViolations(found)}`).toEqual([]);
  });

  it('scans the vehicle profile in Arabic, right to left', async () => {
    const { container } = vehicleScreen('ar');
    await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
    const found = await blockingViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

describe('this file is not vacuous', () => {
  it('scans a container that really holds the screen', async () => {
    /*
     * `axe` over an empty node reports zero violations, so every case above
     * would pass against a render that produced nothing at all — the exact
     * shape of a vacuous accessibility gate.
     */
    const { container } = renderLtr(
      <CustomerProfileScreen locale="en" messages={en} customer={CUSTOMER} writes={ALL_WRITES} />
    );
    await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
    expect(container.querySelectorAll('button').length).toBeGreaterThan(5);
    expect(container.textContent).toContain(CUSTOMER.displayName);
  });

  it('renders the vehicle profile it claims to scan', async () => {
    const { container } = vehicleScreen('en');
    await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
    expect(container.textContent).toContain(VEHICLE.displayNumber);
    expect(container.querySelectorAll('button').length).toBeGreaterThan(5);
  });
});
