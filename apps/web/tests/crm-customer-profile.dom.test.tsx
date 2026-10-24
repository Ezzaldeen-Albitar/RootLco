import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import {
  addressLines,
  type Address,
  type CustomerDetail,
} from '@/features/crm/customers/profile-contract';

/**
 * The customer profile, contacts and addresses (`FE-006`, `FE-007`, `FE-008`).
 *
 * The claims worth pinning are the ones about honesty rather than mechanics:
 * that an unbuilt section says so instead of vanishing, that a null country code
 * does not crash the address formatter, that no uuid is presented as a customer
 * reference, and that a denied section does not blank the rest of the profile.
 */

const listContacts = vi.fn();
const listAddresses = vi.fn();

const emptyPage = async () => ({
  status: 'ok',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'fixed-correlation-id',
});

vi.mock('@/features/crm/customers/profile-api', () => ({
  listContacts: (...args: unknown[]) => listContacts(...args),
  listAddresses: (...args: unknown[]) => listAddresses(...args),
  readCustomer: vi.fn(),
  // The other six exist so this file's mock stays a superset of what the screen
  // imports. A mock that is missing an export does not fail where it is used —
  // it throws asynchronously inside a different test file's run, which is how
  // the Wave 5 sections first surfaced here as an unrelated unhandled rejection.
  listPreferences: emptyPage,
  listConsents: emptyPage,
  listNotes: async () => ({ ...(await emptyPage()), includesRestricted: true }),
  listAlerts: emptyPage,
  listTags: emptyPage,
  listRestrictions: emptyPage,
}));

// Wave 6 moved the timeline into the screen, and its adapter lives in a
// DIFFERENT module. Without this mock `listTimeline` reaches the real
// `authorizedClient`, which calls `cookies()` outside a request scope and throws
// asynchronously into whichever test happened to be running.
vi.mock('@/features/crm/customers/identity-api', () => ({
  listTimeline: emptyPage,
  listDuplicates: emptyPage,
  reviewDuplicateAction: vi.fn(),
}));

const { CustomerProfileScreen } =
  await import('@/features/crm/customers/components/CustomerProfileScreen');

const INDIVIDUAL: CustomerDetail = {
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

const COMPANY: CustomerDetail = {
  ...INDIVIDUAL,
  id: 'company-id',
  displayName: 'Cedar Motors',
  partyType: 'organization',
  givenName: null,
  familyName: null,
  preferredLocale: null,
  legalName: 'Cedar Motors LLC',
  tradeName: 'Cedar',
};

function page(rows: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    rows,
    nextCursor: null,
    hasMore: false,
    correlationId: 'fixed-correlation-id',
    ...overrides,
  };
}

beforeEach(() => {
  listContacts.mockReset();
  listAddresses.mockReset();
  listContacts.mockResolvedValue(page([]));
  listAddresses.mockResolvedValue(page([]));
});

describe('the address formatter', () => {
  const base: Address = {
    id: 'a1',
    addressType: 'billing',
    line1: '12 Cedar Street',
    line2: null,
    line3: null,
    city: 'Amman',
    region: null,
    postalCode: '11181',
    countryCode: 'JO',
    isPrimary: true,
    status: 'active',
    createdAt: '2026-08-04T10:00:00.000Z',
  };

  it('survives a NULL country code', () => {
    // `crm.addresses.country_code` is nullable and the POST accepts it as
    // optional, so null rows are ordinary. Typing it `string` and calling
    // `.toUpperCase()` compiled and threw at runtime — that was P1-27-INT-006.
    expect(() => addressLines({ ...base, countryCode: null })).not.toThrow();
    expect(addressLines({ ...base, countryCode: null })).not.toContain('null');
  });

  it('drops empty parts rather than leaving blank lines', () => {
    expect(addressLines({ ...base, line2: null, line3: null, region: null })).toEqual([
      '12 Cedar Street',
      'Amman',
      '11181',
      'JO',
    ]);
  });

  it('passes the country code through as stored, without upper-casing it', () => {
    // Upper-casing would be a presentational guess about a column the backend
    // does not normalise.
    expect(addressLines({ ...base, countryCode: 'jo' })).toContain('jo');
  });

  it('includes line3, which the column carries and the POST cannot set', () => {
    expect(addressLines({ ...base, line3: 'Building B' })).toContain('Building B');
  });
});

describe('the profile header', () => {
  it('shows the name and the customer reference', () => {
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    expect(screen.getByRole('heading', { name: 'Nadia Khoury' })).toBeInTheDocument();
    expect(screen.getByText('C-0001')).toBeInTheDocument();
  });

  it('never shows the uuid where a reference belongs', () => {
    // An internal identifier in the reference slot reads to an operator as the
    // customer's number.
    renderLtr(
      <CustomerProfileScreen
        locale="en"
        messages={en}
        customer={{ ...INDIVIDUAL, displayNumber: null }}
      />
    );
    expect(screen.queryByText(INDIVIDUAL.id)).toBeNull();
    expect(screen.getByText(en['crm.customers.create.noNumberYet'])).toBeInTheDocument();
  });

  it('translates the status rather than printing the enum', () => {
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    expect(screen.getByText(en['crm.lifecycle.active'])).toBeInTheDocument();
    expect(screen.getByText(en['crm.commercial.normal'])).toBeInTheDocument();
  });
});

describe('the overview shows the fields the party type actually carries', () => {
  it('shows individual fields for an individual', () => {
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    expect(screen.getByText('Nadia')).toBeInTheDocument();
    expect(screen.getByText('Khoury')).toBeInTheDocument();
    // The company fields are null on an individual; rendering them would add
    // empty rows to every profile.
    expect(screen.queryByText(en['crm.customers.create.legalName'])).toBeNull();
  });

  it('shows company fields for an organization', () => {
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={COMPANY} />);
    expect(screen.getByText('Cedar Motors LLC')).toBeInTheDocument();
    expect(screen.queryByText(en['crm.customers.create.givenName'])).toBeNull();
  });

  it('says "not recorded" rather than rendering an empty cell', () => {
    renderLtr(
      <CustomerProfileScreen
        locale="en"
        messages={en}
        customer={{ ...INDIVIDUAL, preferredLocale: null }}
      />
    );
    expect(screen.getByText(en['crm.customers.profile.notRecorded'])).toBeInTheDocument();
  });
});

describe('unbuilt sections are visible and honest', () => {
  it('lists every section, marking the unbuilt ones as planned', () => {
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    const nav = screen.getByRole('navigation', { name: en['crm.customers.profile.sections'] });
    // All eleven, not only the three that work — an operator who cannot see
    // "Consents" cannot tell "not built" from "hidden from me".
    expect(within(nav).getAllByRole('button')).toHaveLength(11);
    expect(within(nav).getAllByText(en['nav.planned']).length).toBeGreaterThan(0);
  });

  it('explains rather than showing an empty panel', async () => {
    const user = userEvent.setup();
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    // `Vehicles`, and this is the THIRD section this assertion has pointed at:
    // Consents (built by Wave 5), then Timeline (built by Wave 6). Each time the
    // failure was the registry working — a section moved from planned to built
    // and the test said so. `Vehicles` is `FE-025` and cannot be built until the
    // Vehicle waves land, since it links to screens that do not exist yet.
    await user.click(screen.getByRole('button', { name: /Vehicles/ }));
    expect(screen.getByText(en['crm.customers.profile.sectionPending'])).toBeInTheDocument();
  });

  it('does not show the pending notice for a section that IS built', async () => {
    const user = userEvent.setup();
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    await user.click(screen.getByRole('button', { name: /Consents/ }));
    // The inverse of the assertion above. Without it, a screen that marked
    // everything planned would satisfy the test this replaced.
    expect(screen.queryByText(en['crm.customers.profile.sectionPending'])).toBeNull();
  });
});

describe('contacts', () => {
  it('shows the value the operator typed, not the normalised lookup key', async () => {
    listContacts.mockResolvedValue(
      page([
        {
          id: 'c1',
          channel: 'email',
          rawValue: 'Layla.Haddad@Example.TEST',
          normalizedValue: 'layla.haddad@example.test',
          label: 'work',
          isPrimary: true,
          status: 'active',
          verifiedAt: null,
          createdAt: '2026-08-04T10:00:00.000Z',
        },
      ])
    );
    const user = userEvent.setup();
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    await user.click(screen.getByRole('button', { name: /Contacts/ }));
    expect(await screen.findByText('Layla.Haddad@Example.TEST')).toBeInTheDocument();
    expect(screen.queryByText('layla.haddad@example.test')).toBeNull();
  });

  it('falls back to the normalised value when only that was kept', async () => {
    listContacts.mockResolvedValue(
      page([
        {
          id: 'c2',
          channel: 'mobile',
          rawValue: null,
          normalizedValue: '+962795551234',
          label: null,
          isPrimary: false,
          status: 'active',
          verifiedAt: null,
          createdAt: '2026-08-04T10:00:00.000Z',
        },
      ])
    );
    const user = userEvent.setup();
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    await user.click(screen.getByRole('button', { name: /Contacts/ }));
    expect(await screen.findByText('+962795551234')).toBeInTheDocument();
  });

  it('states that removed channels are not listed', async () => {
    const user = userEvent.setup();
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    await user.click(screen.getByRole('button', { name: /Contacts/ }));
    // The backend excludes soft-deleted rows. Saying so stops an operator
    // concluding a number they removed is still on file somewhere.
    expect(
      await screen.findByText(en['crm.customers.contacts.softDeleteNote'])
    ).toBeInTheDocument();
  });

  it('renders a denial instead of an empty list', async () => {
    listContacts.mockResolvedValue(page([], { status: 'denied' }));
    const user = userEvent.setup();
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    await user.click(screen.getByRole('button', { name: /Contacts/ }));
    expect(await screen.findByText(en['state.denied.title'])).toBeInTheDocument();
  });
});

describe('addresses', () => {
  it('renders a formatted address with a null country code', async () => {
    listAddresses.mockResolvedValue(
      page([
        {
          id: 'a1',
          addressType: 'billing',
          line1: '12 Cedar Street',
          line2: null,
          line3: null,
          city: 'Amman',
          region: null,
          postalCode: null,
          countryCode: null,
          isPrimary: true,
          status: 'active',
          createdAt: '2026-08-04T10:00:00.000Z',
        },
      ])
    );
    const user = userEvent.setup();
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    await user.click(screen.getByRole('button', { name: /Addresses/ }));
    expect(await screen.findByText(/12 Cedar Street/)).toBeInTheDocument();
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it('shows the correlation reference when the section fails', async () => {
    listAddresses.mockResolvedValue(page([], { status: 'error' }));
    const user = userEvent.setup();
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    await user.click(screen.getByRole('button', { name: /Addresses/ }));
    expect(await screen.findByText('fixed-correlation-id')).toBeInTheDocument();
  });
});

describe('one denied section does not blank the profile', () => {
  it('keeps the header and the other sections reachable', async () => {
    listContacts.mockResolvedValue(page([], { status: 'denied' }));
    const user = userEvent.setup();
    renderLtr(<CustomerProfileScreen locale="en" messages={en} customer={INDIVIDUAL} />);
    await user.click(screen.getByRole('button', { name: /Contacts/ }));
    await screen.findByText(en['state.denied.title']);
    // The whole reason each section reads independently.
    expect(screen.getByRole('heading', { name: 'Nadia Khoury' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Addresses/ })).toBeInTheDocument();
  });
});

describe('Arabic', () => {
  it('renders the profile right to left', () => {
    renderRtl(<CustomerProfileScreen locale="ar" messages={ar} customer={INDIVIDUAL} />);
    expect(screen.getByText(ar['crm.lifecycle.active'])).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: ar['crm.customers.profile.sections'] })
    ).toBeInTheDocument();
  });
});

/*
 * P1-32-PRE-OD-CRM2A — the section buttons, the work-order link and the name
 * moved onto Material UI. Appended here, and the modules it needs are loaded
 * below rather than at the top, so no line above moves: `:109-151` is a range
 * the P1-27 matrix cites.
 */
const { BOTH_DIRECTIONS } = await import('./render');
const { UiFoundationProvider } = await import('@/components/ui-foundation/UiFoundationProvider');
const { muiTextOf } = await import('@/components/ui-foundation/mui-text');

const SECTION_ORDER = [
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

function sectionButtons(messages: typeof en): HTMLButtonElement[] {
  const nav = screen.getByRole('navigation', { name: messages['crm.customers.profile.sections'] });
  return [...nav.querySelectorAll('button')];
}

function current(buttons: readonly HTMLButtonElement[]): string[] {
  return buttons
    .filter((button) => button.getAttribute('aria-current') === 'page')
    .map((button) => button.textContent ?? '');
}

describe('the section buttons stay native buttons on Material UI', () => {
  it.each(BOTH_DIRECTIONS)(
    'keeps the structure and moves aria-current on click, Enter and Space in %s',
    async (locale, renderIn) => {
      const messages = locale === 'en' ? en : ar;
      const label = (name: (typeof SECTION_ORDER)[number]) =>
        messages[`crm.customers.profile.section.${name}`];
      const user = userEvent.setup();
      renderIn(<CustomerProfileScreen locale={locale} messages={messages} customer={INDIVIDUAL} />);

      const buttons = sectionButtons(messages);
      expect(buttons).toHaveLength(SECTION_ORDER.length);
      const byName = (name: (typeof SECTION_ORDER)[number]): HTMLButtonElement => {
        const button = buttons[SECTION_ORDER.indexOf(name)];
        if (button === undefined) throw new Error(`no ${name} button`);
        return button;
      };
      for (const name of SECTION_ORDER) {
        const button = byName(name);
        expect(button.tagName).toBe('BUTTON');
        expect(button.getAttribute('type')).toBe('button');
        expect(button.parentElement?.tagName).toBe('LI');
        expect(button.parentElement?.parentElement?.tagName).toBe('UL');
        expect(button.textContent?.startsWith(label(name))).toBe(true);
      }

      expect(current(buttons)).toEqual([label('overview')]);

      await user.click(byName('contacts'));
      expect(current(buttons)).toEqual([label('contacts')]);
      expect(byName('overview').hasAttribute('aria-current')).toBe(false);

      byName('addresses').focus();
      await user.keyboard('{Enter}');
      expect(current(buttons)).toEqual([label('addresses')]);

      byName('notes').focus();
      await user.keyboard(' ');
      expect(current(buttons)).toEqual([label('notes')]);

      if (locale === 'ar') {
        const planned = buttons.filter((button) =>
          (button.textContent ?? '').includes(ar['nav.planned'])
        );
        expect(planned).toHaveLength(1);
        expect(planned[0]).toBe(byName('vehicles'));
      }
    }
  );
});

describe('Material UI under the foundation provider', () => {
  it.each(BOTH_DIRECTIONS)(
    'renders the buttons, the link and the name from the %s cache',
    (locale, renderIn) => {
      const messages = locale === 'en' ? en : ar;
      renderIn(
        <UiFoundationProvider locale={locale} text={muiTextOf(messages)}>
          <CustomerProfileScreen
            locale={locale}
            messages={messages}
            customer={INDIVIDUAL}
            canStartWorkOrder
          />
        </UiFoundationProvider>
      );

      const buttons = sectionButtons(messages);
      expect(buttons).toHaveLength(SECTION_ORDER.length);
      for (const button of buttons) expect(button).toHaveClass('MuiButton-root');

      const link = screen.getByTestId('customer-new-work-order');
      expect(link.tagName).toBe('A');
      expect(link).toHaveClass('MuiButton-root');
      expect(link.getAttribute('href')).toBe(
        `/${locale}/crm/customers/${INDIVIDUAL.id}/work-order/new`
      );
      expect(link.hasAttribute('role')).toBe(false);

      const name = screen.getByRole('heading', { name: INDIVIDUAL.displayName });
      expect(name.tagName).toBe('H2');
      expect(name).toHaveClass('MuiTypography-root');

      const emotion = [...buttons, link, name]
        .flatMap((element) => [...element.classList])
        .filter((className) => /^mui(?:rtl)?-/.test(className));
      expect(emotion.length).toBeGreaterThan(0);
      for (const className of emotion) {
        if (locale === 'ar') expect(className).toMatch(/^muirtl-/);
        else expect(className).not.toMatch(/^muirtl-/);
      }
    }
  );
});
