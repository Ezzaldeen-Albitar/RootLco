import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import { permittedWrites, WRITE_PERMISSIONS } from '@/features/crm/customers/governance-contract';
import type { CustomerDetail } from '@/features/crm/customers/profile-contract';
import { formatDateTime, intlLocale } from '@/lib/format';

/**
 * The customer timeline names a person, or says it cannot (`P1-27-FE-015`).
 *
 * ## The defect
 *
 * The "Recorded by" column rendered `row.actorId` — a raw uuid — directly:
 *
 *     cell: (row) => row.actorId ?? <span>System</span>
 *
 * That is the identical defect `P1-27-INT-026` fixed on the vehicle attribute
 * ledger, where the same column printed the same kind of identifier under the
 * same kind of heading. The remediation was scoped to the finding that raised it
 * rather than to the property it established, so the customer timeline — same
 * shape, same header, same backend publishing an id and no name — was never
 * swept.
 *
 * ## Why nothing caught it
 *
 * No test has ever rendered a timeline ROW. Every DOM suite that touches this
 * screen stubs `listTimeline` to an empty page, and the FE-015 tests assert a
 * constant and two JSON key sets. A column whose cell function is never invoked
 * cannot be observed, so it could print anything.
 *
 * ## Three states, kept apart
 *
 * `actorId == null` is a SYSTEM event and stays its own phrase — "the system
 * expired this consent" is not "somebody withdrew it", and collapsing them would
 * lose a real distinction. An actor WITH a name is named. An actor WITHOUT one
 * gets a phrase, because `undefined` (the API predates the identity surface) and
 * `null` (this caller may not be told) are both answers, and neither is a
 * licence to print the identifier.
 */

const listTimeline = vi.fn();
const okPage = { status: 'ok', rows: [], nextCursor: null, hasMore: false, correlationId: 'cid' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/crm/customers/x',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/features/crm/customers/identity-api', () => ({
  listTimeline: (...a: unknown[]) => listTimeline(...a),
  listDuplicates: async () => okPage,
  reviewDuplicateAction: vi.fn(),
}));

vi.mock('@/features/crm/customers/profile-api', () => ({
  readCustomer: vi.fn(),
  listContacts: async () => okPage,
  listAddresses: async () => okPage,
  listPreferences: async () => okPage,
  listConsents: async () => okPage,
  listNotes: async () => okPage,
  listAlerts: async () => okPage,
  listTags: async () => okPage,
  listRestrictions: async () => okPage,
}));

const { CustomerProfileScreen } =
  await import('@/features/crm/customers/components/CustomerProfileScreen');

const ACTOR_UUID = '9f1c2d3e-4b5a-6789-0abc-def012345678';

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

function row(overrides: Record<string, unknown>) {
  return {
    id: 't1',
    eventType: 'customer.note_added',
    title: 'A note was added.',
    occurredAt: '2026-08-05T09:00:00.000Z',
    actorId: null,
    ...overrides,
  };
}

beforeEach(() => {
  listTimeline.mockReset();
  listTimeline.mockResolvedValue(okPage);
});

/** Renders the profile and opens the timeline, which is the only way to see the cell. */
async function openTimeline(locale: 'en' | 'ar' = 'en') {
  const messages = locale === 'en' ? en : ar;
  const view = locale === 'en' ? renderLtr : renderRtl;
  const user = userEvent.setup();
  const result = view(
    <CustomerProfileScreen
      locale={locale}
      messages={messages}
      customer={CUSTOMER}
      writes={permittedWrites([WRITE_PERMISSIONS.note])}
    />
  );
  await user.click(
    screen.getByRole('button', {
      name: messages['crm.customers.profile.section.timeline'],
    })
  );
  await waitFor(() => expect(result.container.querySelector('table')).not.toBeNull());
  return result;
}

describe('the timeline never prints an actor identifier', () => {
  it('names the person when the API publishes a name', async () => {
    listTimeline.mockResolvedValue({
      ...okPage,
      rows: [row({ actorId: ACTOR_UUID, actorName: 'Rami Haddad' })],
    });
    const { container } = await openTimeline();
    expect(await screen.findByText('Rami Haddad')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ACTOR_UUID);
  });

  it('says so rather than printing the uuid when no name is published', async () => {
    // `actorName` ABSENT — an API that predates the identity surface. This is
    // the exact row that used to render the uuid.
    listTimeline.mockResolvedValue({ ...okPage, rows: [row({ actorId: ACTOR_UUID })] });
    const { container } = await openTimeline();
    expect(
      await screen.findByText(en['crm.customers.timeline.actorUnavailable'])
    ).toBeInTheDocument();
    expect(container.textContent ?? '', 'a uuid reached the screen').not.toContain(ACTOR_UUID);
  });

  it('says so when the name is withheld from this caller', async () => {
    // `actorName: null` — resolution ran and this caller may not be told. A
    // different fact from the case above, and the same rule.
    listTimeline.mockResolvedValue({
      ...okPage,
      rows: [row({ actorId: ACTOR_UUID, actorName: null })],
    });
    const { container } = await openTimeline();
    expect(
      await screen.findByText(en['crm.customers.timeline.actorUnavailable'])
    ).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ACTOR_UUID);
  });

  it('treats an empty name as no name, not as a person called nothing', async () => {
    listTimeline.mockResolvedValue({
      ...okPage,
      rows: [row({ actorId: ACTOR_UUID, actorName: '   ' })],
    });
    const { container } = await openTimeline();
    expect(
      await screen.findByText(en['crm.customers.timeline.actorUnavailable'])
    ).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ACTOR_UUID);
  });

  it('keeps SYSTEM distinct from an actor whose name is unavailable', async () => {
    // The distinction the old code got right and which must survive: an event
    // with no actor at all is not an event whose actor cannot be named.
    listTimeline.mockResolvedValue({
      ...okPage,
      rows: [
        row({ id: 't1', actorId: null }),
        row({ id: 't2', actorId: ACTOR_UUID, actorName: null }),
      ],
    });
    const { container } = await openTimeline();
    expect(await screen.findByText(en['crm.customers.timeline.system'])).toBeInTheDocument();
    expect(screen.getByText(en['crm.customers.timeline.actorUnavailable'])).toBeInTheDocument();
    expect(en['crm.customers.timeline.system']).not.toBe(
      en['crm.customers.timeline.actorUnavailable']
    );
    expect(container.textContent ?? '').not.toContain(ACTOR_UUID);
  });

  it('prints no uuid-shaped string anywhere in the timeline', async () => {
    // Broader than the actor column: the row id and the event type are also
    // identifiers, and a table that leaked either would fail the same rule.
    listTimeline.mockResolvedValue({
      ...okPage,
      rows: [row({ actorId: ACTOR_UUID, actorName: 'Rami Haddad' })],
    });
    const { container } = await openTimeline();
    await screen.findByText('Rami Haddad');
    expect(container.textContent ?? '').not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
  });

  it('says it in Arabic too', async () => {
    listTimeline.mockResolvedValue({ ...okPage, rows: [row({ actorId: ACTOR_UUID })] });
    const { container } = await openTimeline('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      await screen.findByText(ar['crm.customers.timeline.actorUnavailable'])
    ).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(ACTOR_UUID);
  });
});

describe('this file is not vacuous', () => {
  it('really rendered rows, which no previous test did', async () => {
    // Every other suite stubs `listTimeline` to an empty page, so the cell
    // function is never invoked and the column could print anything. If this
    // assertion fails the rest of the file proves nothing.
    listTimeline.mockResolvedValue({
      ...okPage,
      rows: [row({ actorId: ACTOR_UUID, actorName: 'Rami Haddad' })],
    });
    const { container } = await openTimeline();
    await screen.findByText('Rami Haddad');
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(listTimeline).toHaveBeenCalled();
  });

  it('asserted a RENDERED instant, which no test in this workspace previously did', async () => {
    // Before `FE-030` the string `Intl.DateTimeFormat` did not appear anywhere
    // under `apps/web/tests`, and no case asserted a formatted date at all. Seven
    // sites could therefore print in any convention they liked. This renders the
    // real cell through the real screen and reads the text off the DOM.
    const occurredAt = '2026-03-04T09:14:00.000Z';
    listTimeline.mockResolvedValue({
      ...okPage,
      rows: [row({ occurredAt, actorId: ACTOR_UUID, actorName: 'Rami Haddad' })],
    });
    const { container } = await openTimeline();
    await screen.findByText('Rami Haddad');

    const cell = container.querySelector(`time[datetime="${occurredAt}"]`);
    expect(cell, 'the timeline printed no machine-readable instant').not.toBeNull();
    const rendered = cell?.textContent ?? '';

    // What the product formats in.
    expect(rendered).toBe(formatDateTime(occurredAt, 'en'));

    // What it must NOT format in. `en` and `en-GB` differ in field order AND in
    // clock, so this holds in every timezone the suite might run in — which
    // matters, because nothing pins `TZ` for this project.
    const bare = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(occurredAt));
    expect(intlLocale('en')).toBe('en-GB');
    expect(bare, 'the defect and the fix cannot be told apart — this test proves nothing').not.toBe(
      formatDateTime(occurredAt, 'en')
    );
    expect(rendered, 'the timeline printed US convention').not.toBe(bare);

    // Stated structurally as well as by comparison, so the case still describes
    // the requirement if the helper itself is ever changed: day before month,
    // 24-hour clock, no meridiem.
    expect(rendered).toMatch(/^\d{1,2} [A-Za-z]{3,} \d{4}, \d{2}:\d{2}$/);
    expect(rendered).not.toMatch(/\b[AP]M\b/);
  });

  it('renders the Arabic timeline through the same mapping', async () => {
    // The Arabic half of this defect does NOT reproduce — bare `'ar'` already
    // resolves to Latin digits, so it printed correctly by luck. Asserted anyway,
    // because the luck is a CLDR datum and not a decision: if a future ICU makes
    // plain `ar` use Eastern Arabic numerals, this fails here rather than on a
    // Jordanian invoice.
    const occurredAt = '2026-03-04T09:14:00.000Z';
    listTimeline.mockResolvedValue({ ...okPage, rows: [row({ occurredAt })] });
    const { container } = await openTimeline('ar');
    const rendered = container.querySelector(`time[datetime="${occurredAt}"]`)?.textContent ?? '';
    expect(rendered).toBe(formatDateTime(occurredAt, 'ar'));
    expect(intlLocale('ar')).toBe('ar-JO-u-nu-latn');
    // Latin digits, not ٠١٢٣.
    expect(rendered).toMatch(/\d/);
    expect(rendered).not.toMatch(/[٠-٩]/);
  });

  it('asserts against a phrase that exists in both catalogues and differs between them', () => {
    const key = 'crm.customers.timeline.actorUnavailable';
    expect(Object.keys(en)).toContain(key);
    expect(Object.keys(ar)).toContain(key);
    expect((en as Record<string, string>)[key]).not.toBe((ar as Record<string, string>)[key]);
    // Parity with the vehicle ledger, which set the rule.
    expect((en as Record<string, string>)[key]).toBe(en['vehicles.history.actorUnavailable']);
  });
});
