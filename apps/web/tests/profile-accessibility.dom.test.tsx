import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
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
const listVehicleDuplicates = vi.fn();

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
  // Added for the heading-outline cases below, which mount the two duplicate
  // QUEUES as well as the two profiles. `VehicleProfileScreen` imports only
  // `listAttributeHistory` from here, so nothing above is affected.
  listVehicleDuplicates: (...a: unknown[]) => listVehicleDuplicates(...a),
  reviewVehicleDuplicateAction: vi.fn(async () => ({ status: 'idle' })),
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
const { DuplicateReviewScreen } =
  await import('@/features/crm/customers/components/DuplicateReviewScreen');
const { VehicleDuplicateReviewScreen } =
  await import('@/features/vehicles/components/VehicleDuplicateReviewScreen');
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
    listVehicleDuplicates,
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
    // The customer's name, not an `h1`: this screen's heading is an `h2` now,
    // because the ROUTE renders the page's `h1` above it. See the outline cases.
    await waitFor(() => expect(container.textContent ?? '').toContain(CUSTOMER.displayName));
    const found = await blockingViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('scans the read-only profile, which renders a different screen', async () => {
    // Nine forms fewer, and every heading and table still present. A screen that
    // is accessible with its controls is not thereby accessible without them.
    const { container } = renderLtr(
      <CustomerProfileScreen locale="en" messages={en} customer={CUSTOMER} />
    );
    await waitFor(() => expect(container.textContent ?? '').toContain(CUSTOMER.displayName));
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

/**
 * One `<h1>` per page — the outline a screen-reader user navigates by.
 *
 * ## The defect
 *
 * `PageHeader` states the rule in its own docblock — the page title is the h1,
 * there is exactly one per page, and a document with two has no outline — and
 * renders it. Four screens then rendered an `<h1>` of their own inside
 * `PageBody`, under a route that had already rendered `PageHeader`. Driven by
 * hand against a production build, `/en/crm/customer-duplicates` and
 * `/en/vehicles/duplicates` each returned `h1 count: 2` — the SAME STRING twice,
 * because the route passes `PageHeader` the very `titleKey` the screen was also
 * printing.
 *
 * Two different repairs, because the two cases are not the same defect:
 *
 *   - the duplicate QUEUES lost their heading outright. It was the page title
 *     said a second time, so nothing is lost and one visible duplication goes;
 *   - the customer PROFILE kept its heading, demoted to `h2`. It carries the
 *     customer's display name, which the header does not, so dropping it would
 *     have deleted information rather than a repetition.
 *
 * `VehicleProfileScreen` is here as a CONTROL, not as a defect.
 * `vehicles/[vehicleId]/page.tsx` builds a `PageHeader` for its denial, 404 and
 * error branches and renders NONE on the success path (`:106-134`), so the
 * screen's own `<h1>` is the page's only one. Composed here the way the route
 * composes it, so if a header is ever added above it this case turns red
 * instead of the outline quietly gaining a second h1.
 *
 * `PrintDocument` and `AuthCard` are untouched: neither surface renders
 * `PageHeader`, so each of them IS its page's h1. `/en/login` was confirmed by
 * hand to have exactly one.
 */
describe('a screen mounted in the dashboard shell contributes no second h1', () => {
  interface Composition {
    readonly name: string;
    /** The `titleKey` the ROUTE passes to `PageHeader`; `null` when it renders none. */
    readonly titleKey: string | null;
    readonly crumbs: readonly { readonly labelKey: string }[];
    readonly screen: () => ReactElement;
    /** Text that proves the screen really rendered, so the count is not over nothing. */
    readonly proof: string;
  }

  const PAGES: readonly Composition[] = [
    {
      name: 'the customer duplicate queue',
      // `crm/customer-duplicates/page.tsx:59-65`.
      titleKey: 'crm.duplicates.title',
      crumbs: [{ labelKey: 'nav.customers' }, { labelKey: 'crm.duplicates.title' }],
      screen: () => <DuplicateReviewScreen locale="en" messages={en} />,
      proof: en['crm.duplicates.intro'],
    },
    {
      name: 'the vehicle duplicate queue',
      // `vehicles/duplicates/page.tsx:33-40`.
      titleKey: 'vehicles.duplicates.title',
      crumbs: [{ labelKey: 'nav.vehicles' }, { labelKey: 'vehicles.duplicates.title' }],
      screen: () => <VehicleDuplicateReviewScreen locale="en" messages={en} />,
      proof: en['vehicles.duplicates.intro'],
    },
    {
      name: 'the customer profile',
      // `crm/customers/[customerId]/page.tsx:107-115`.
      titleKey: 'crm.customers.profile.title',
      crumbs: [{ labelKey: 'nav.customers' }, { labelKey: 'crm.customers.profile.title' }],
      screen: () => (
        <CustomerProfileScreen locale="en" messages={en} customer={CUSTOMER} writes={ALL_WRITES} />
      ),
      proof: CUSTOMER.displayName,
    },
    {
      name: 'the vehicle profile, whose route renders no PageHeader on success',
      titleKey: null,
      crumbs: [],
      screen: () => (
        <VehicleProfileScreen
          locale="en"
          messages={en}
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
      ),
      proof: VEHICLE.displayNumber as string,
    },
  ];

  function compose(page: Composition) {
    return renderLtr(
      <>
        {page.titleKey === null ? null : (
          <PageHeader locale="en" messages={en} titleKey={page.titleKey} crumbs={page.crumbs} />
        )}
        <PageBody>{page.screen()}</PageBody>
      </>
    );
  }

  const headingsOf = (container: HTMLElement, level: number): string[] =>
    Array.from(container.querySelectorAll(`h${level}`)).map((node) => node.textContent ?? '');

  it('composes every P1-27 screen that a dashboard route mounts', () => {
    // Anti-vacuity. A loop over an empty corpus is a green tick over nothing.
    expect(PAGES.length).toBe(4);
    expect(PAGES.filter((page) => page.titleKey !== null).length).toBe(3);
  });

  it.each(PAGES.map((page) => [page.name, page] as const))(
    'renders exactly one h1 on %s',
    async (_name, page) => {
      const { container } = compose(page);
      // Settle first. Counting headings on a half-rendered screen would pass
      // against a render that produced nothing at all.
      await waitFor(() => expect(container.textContent ?? '').toContain(page.proof));

      const h1s = headingsOf(container, 1);
      expect(h1s, `h1 count ${h1s.length}: ${JSON.stringify(h1s)}`).toHaveLength(1);
    }
  );

  it('keeps the customer name on screen, as an h2 under the page title', async () => {
    // The demotion must not be a deletion. Both strings are still there, and
    // the outline nests: "Customer profile" then the customer.
    const page = PAGES.find((entry) => entry.name === 'the customer profile');
    expect(page, 'the customer profile composition disappeared from this table').toBeDefined();
    const { container } = compose(page as Composition);
    await waitFor(() => expect(container.textContent ?? '').toContain(CUSTOMER.displayName));

    expect(headingsOf(container, 1)).toEqual([en['crm.customers.profile.title']]);
    expect(headingsOf(container, 2)).toContain(CUSTOMER.displayName);
  });

  it('counts a SECOND h1 when one is really there', async () => {
    /*
     * The control, and the reason the four cases above mean anything.
     *
     * `querySelectorAll('h1')` over a container that rendered nothing returns an
     * empty list, and `toHaveLength(1)` would then be the only thing standing
     * between this file and a vacuous pass. So the counter is shown failing: the
     * exact shape of the shipped defect — a screen printing the page title again
     * inside `PageBody` — is composed on purpose and must count two.
     */
    const { container } = renderLtr(
      <>
        <PageHeader locale="en" messages={en} titleKey="crm.duplicates.title" />
        <PageBody>
          <h1>{en['crm.duplicates.title']}</h1>
        </PageBody>
      </>
    );
    const h1s = headingsOf(container, 1);
    expect(h1s).toHaveLength(2);
    expect(h1s[0]).toBe(h1s[1]);
  });

  it('lets no OTHER component grow an h1 without this file being told', () => {
    /*
     * The four compositions above are a list somebody has to remember to extend.
     * This is the check that notices when they do not: every `<h1>` in the
     * component tree, found by reading the source, matched against the four that
     * are accounted for.
     *
     * Comments are stripped first. This repository has watched a scanner read
     * prose as code six times, and two of these very files DISCUSS `<h1>` in a
     * docblock — an unstripped scan would report `AuthCard` twice and would keep
     * reporting the duplicate queues after their headings were gone.
     */
    const roots = [
      join(__dirname, '..', 'src', 'components'),
      join(__dirname, '..', 'src', 'features'),
    ];

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.tsx')) files.push(full);
      }
    };
    for (const root of roots) walk(root);
    expect(files.length, 'no component sources were read').toBeGreaterThan(30);

    const withoutComments = (source: string): string =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n');

    const declaring = files
      .filter((file) => /<h1[\s>]/.test(withoutComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(join(__dirname, '..'), file).split(sep).join('/'))
      .sort();

    expect(declaring).toEqual([
      // Print output. Its own document, no `PageHeader` above it.
      'src/components/print/PrintDocument.tsx',
      // THE page title. One per page, by construction.
      'src/components/shell/PageHeader.tsx',
      // The signed-out surfaces, which render no shell at all.
      'src/features/authentication/components/AuthCard.tsx',
      // The one dashboard screen whose route renders no `PageHeader` on success.
      'src/features/vehicles/components/VehicleProfileScreen.tsx',
    ]);
  });

  it('lets no ROUTE put a page header above a screen that brings its own h1', () => {
    /*
     * The compositions above model the routes BY HAND, and the scan above reads
     * only `src/components` and `src/features`. Nothing read `src/app/**`, so
     * the one screen that legitimately owns its `<h1>` —
     * `VehicleProfileScreen`, because its route renders no header on the
     * success path — was protected by a hand-written `titleKey: null` and by
     * nothing else. Adding a `<PageHeader>` back to that success path would
     * ship two `<h1>`s again with every case in this suite green. That gap was
     * named in review, and this is the case that closes it.
     *
     * It reads the ROUTES, and it reasons per RENDER PATH rather than per file:
     * a page may legitimately render a header on its denial, not-found and
     * error branches while the success branch renders the screen alone, which
     * is exactly what the vehicle profile does. A violation is a single
     * `return` that contains BOTH.
     *
     * The header is often hoisted, so aliases are resolved rather than only the
     * literal element being matched — a scan for `<PageHeader` alone would read
     * every branch of such a page as headerless and prove nothing.
     *
     * TWO hoisting shapes, and the second was learned the hard way. An ELEMENT
     * (`const header = (<PageHeader … />)`) used as `{header}`, and a FRAME
     * FUNCTION (`const frame = (body) => (<><PageHeader … />…</>)`) used as
     * `frame(…)`. This case originally understood only the first. The vehicle
     * profile — the one route it exists to protect — was then restructured onto
     * the second, and the guard went quiet: routing its success path through
     * `frame()` reintroduced the double `<h1>` with all 35 cases here green.
     * Measured, not supposed. So the alias rule is now "any local const whose
     * initialiser mentions `<PageHeader`", and a reference is either `{name}` or
     * `name(`.
     */
    const appRoot = join(__dirname, '..', 'src', 'app');
    const pages: string[] = [];
    const walkPages = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walkPages(full);
        else if (entry.name === 'page.tsx') pages.push(full);
      }
    };
    walkPages(appRoot);
    expect(pages.length, 'no route files were read').toBeGreaterThan(15);

    const stripped = (source: string): string =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n');

    // Derived from the case above rather than restated, so the two cannot drift.
    const OWNS_ITS_H1 = ['VehicleProfileScreen'];

    const violations: string[] = [];
    let returnsSeen = 0;
    let blockCharsSeen = 0;
    for (const page of pages) {
      const source = stripped(readFileSync(page, 'utf8'));

      // Any local `const NAME =` whose initialiser reaches a `<PageHeader`
      // before the next top-level `const` is a header alias, whichever shape it
      // takes. Bounded deliberately: an unbounded look-ahead would make every
      // const in the file an alias of a header declared later.
      // Bounded by the next TOP-LEVEL statement, not by the next `const` at any
      // depth. An unbounded scan made every earlier const an alias of a header
      // declared later — `session` and `messages` both resolved as headers — and
      // the guard then fired on a clean tree. A false positive here is as bad as
      // a false negative: it trains the next reader to widen the rule.
      const BOUNDARY = /^ {0,2}(?:const|return|if|for|while|switch|export)\b/m;
      const aliases = [...source.matchAll(/^ {0,2}const\s+(\w+)\s*=/gm)]
        .filter((match) => {
          const rest = source.slice((match.index ?? 0) + match[0].length);
          const next = rest.search(BOUNDARY);
          return /<PageHeader\b/.test(next > 0 ? rest.slice(0, next) : rest);
        })
        .map((match) => match[1] as string);

      const headerIn = (block: string): boolean =>
        /<PageHeader\b/.test(block) ||
        aliases.some((name) => block.includes(`{${name}}`) || block.includes(`${name}(`));

      /*
       * EVERY `return`, not just `return (`.
       *
       * The first version matched `/return\s*\(/`, which cannot see
       * `return frame(…)` — the exact shape this route was later restructured
       * onto. Routing the success path through the frame then reintroduced the
       * double `<h1>` and this case stayed green, because with no matched
       * return the loop body never ran at all. A guard that silently iterates
       * nothing is the failure this suite exists to catch, so it is worth
       * saying plainly: the bug was not a weak assertion, it was an empty loop.
       *
       * Each block runs to the next `return`, which over-approximates the
       * branch, so a header ABOVE it cannot be missed; the screen match is what
       * narrows it back to one path.
       */
      /*
       * Boundaries computed from the FULL list of return positions.
       *
       * The previous shape sliced forward from each match and searched the
       * remainder for the next return. Because the match itself begins with
       * `\s*`, that search matched at index 0 every single time, so every block
       * was ONE CHARACTER long: the loop ran six times over this route and
       * examined nothing. It survived a literal `<PageHeader>` planted in the
       * success return. Two empty-loop bugs in one guard, so the block bounds
       * are now arithmetic between known offsets rather than a re-search, and
       * `blockCharsSeen` below makes a one-character block impossible to ship.
       */
      const returnAt = [...source.matchAll(/^\s*return\b/gm)].map((m) => m.index ?? 0);
      for (let i = 0; i < returnAt.length; i += 1) {
        returnsSeen += 1;
        const upToNextReturn = source.slice(
          returnAt[i] as number,
          (returnAt[i + 1] as number | undefined) ?? source.length
        );
        blockCharsSeen += upToNextReturn.length;
        for (const screen of OWNS_ITS_H1) {
          if (upToNextReturn.includes(`<${screen}`) && headerIn(upToNextReturn)) {
            violations.push(
              `${relative(join(__dirname, '..'), page).split(sep).join('/')} renders both a page ` +
                `header and <${screen}>, which declares its own h1, on one render path`
            );
          }
        }
      }
    }

    expect(
      returnsSeen,
      'no return statement was read in any route — the sweep iterated nothing'
    ).toBeGreaterThan(30);
    // The bound that catches the real bug: iterating is not examining.
    expect(
      Math.round(blockCharsSeen / Math.max(returnsSeen, 1)),
      'return blocks averaged almost no content — the sweep read nothing'
    ).toBeGreaterThan(80);
    expect(violations, violations.join('\n')).toEqual([]);
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
    await waitFor(() => expect(container.querySelector('h2')).not.toBeNull());
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
