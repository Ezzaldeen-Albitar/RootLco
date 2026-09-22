import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * CRM customer search, in a DOM (`P1-27-FE-001`, `P1-27-FE-002`).
 *
 * The behavioural claims that source-scanning cannot make: that typing issues no
 * request, that Enter submits, that a rate-limited response reads as "try again
 * shortly" rather than "something broke", and that a slow first response cannot
 * overwrite a fast second one.
 *
 * The Server Action is mocked at the module boundary, because a component test
 * cannot call a `'use server'` module — and because what is under test is the
 * screen's decision about WHEN to call it, not the call itself. The adapter's
 * own request shape is asserted in `crm-customer-search.test.ts`.
 */

const searchCustomers = vi.fn();

vi.mock('@/features/crm/customers/api', () => ({
  searchCustomers: (...args: unknown[]) => searchCustomers(...args),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { CustomerSearchScreen } =
  await import('@/features/crm/customers/components/CustomerSearchScreen');

const HIT = {
  id: '2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f',
  displayNumber: 'C-0001',
  displayName: 'Nadia Khoury',
  partyType: 'individual' as const,
  lifecycleStatus: 'active' as const,
  createdAt: '2026-08-04T10:00:00.000Z',
  primaryPhone: '*******4567',
  phoneMasked: true,
  vehicleCount: 2,
};

function page(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    rows: [HIT],
    nextCursor: null,
    hasMore: false,
    correlationId: 'fixed-correlation-id',
    ...overrides,
  };
}

beforeEach(() => {
  searchCustomers.mockReset();
  push.mockReset();
  searchCustomers.mockResolvedValue(page());
});

function renderScreen(canCreate = false) {
  return renderLtr(<CustomerSearchScreen locale="en" messages={en} canCreate={canCreate} />);
}

describe('before the operator has asked for anything', () => {
  it('calls the backend zero times and explains how to search', async () => {
    renderScreen();
    // The decisive assertion of this whole screen. An unasked query is a wasted
    // request against a 30-per-minute budget, and "here is everything" is not
    // what a search screen should say before it has been used.
    expect(searchCustomers).not.toHaveBeenCalled();
    expect(screen.getByText(en['crm.customers.search.idleTitle'])).toBeInTheDocument();
  });

  it('issues no request while the operator types', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Nadia Khoury');
    // Twelve keystrokes. Search-as-you-type would have spent 12 of 30 requests.
    expect(searchCustomers).not.toHaveBeenCalled();
  });
});

describe('submitting', () => {
  it('searches when the button is pressed', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Nadia');
    await user.click(screen.getByRole('button', { name: en['crm.customers.search.submit'] }));

    await waitFor(() => expect(searchCustomers).toHaveBeenCalledTimes(1));
    const [, , criteria] = searchCustomers.mock.calls[0] as [unknown, unknown, { q?: string }];
    expect(criteria.q).toBe('Nadia');
  });

  it('searches when Enter is pressed in a field', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Nadia{Enter}');
    await waitFor(() => expect(searchCustomers).toHaveBeenCalledTimes(1));
  });

  it('renders the result row', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Nadia{Enter}');
    expect(await screen.findByText('Nadia Khoury')).toBeInTheDocument();
    expect(screen.getByText('C-0001')).toBeInTheDocument();

    // Scoped to the ROW. "Individual" is also an <option> in the type filter, so
    // an unscoped query finds two elements and the assertion would have been
    // satisfied by the dropdown whether or not the cell rendered at all.
    const row = screen.getByRole('row', { name: /Nadia Khoury/ });
    expect(within(row).getByText(en['crm.partyType.individual'])).toBeInTheDocument();
    expect(within(row).getByText(en['crm.lifecycle.active'])).toBeInTheDocument();
  });

  it('does not search on an empty form', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: en['crm.customers.search.submit'] }));
    // The adapter short-circuits an empty criteria set, but the screen must not
    // even reach the state where it looks searched.
    expect(screen.getByText(en['crm.customers.search.idleTitle'])).toBeInTheDocument();
  });
});

describe('states', () => {
  it('reports a rate limit as unavailable, not as a fault', async () => {
    // A 429 is "try again shortly", not "something broke". Telling an operator
    // the system failed when they merely searched too fast sends them to
    // support for nothing.
    searchCustomers.mockResolvedValue(page({ status: 'unavailable', rows: [] }));
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Nadia{Enter}');
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('renders a denial instead of an empty list', async () => {
    // An empty list reads as "there is nothing here". The truth is "you may not
    // see it", and those are different facts.
    searchCustomers.mockResolvedValue(page({ status: 'denied', rows: [] }));
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Nadia{Enter}');
    expect(await screen.findByText(en['state.denied.title'])).toBeInTheDocument();
  });

  it('shows the correlation reference on a failure', async () => {
    searchCustomers.mockResolvedValue(page({ status: 'error', rows: [] }));
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Nadia{Enter}');
    expect(await screen.findByText('fixed-correlation-id')).toBeInTheDocument();
  });

  it('offers creation only after an empty result and only with permission', async () => {
    searchCustomers.mockResolvedValue(page({ rows: [] }));
    const user = userEvent.setup();
    renderScreen(true);
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Zzz{Enter}');
    expect(
      await screen.findByText(en['crm.customers.search.createIndividual'])
    ).toBeInTheDocument();
  });

  it('offers no creation without permission', async () => {
    searchCustomers.mockResolvedValue(page({ rows: [] }));
    const user = userEvent.setup();
    renderScreen(false);
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Zzz{Enter}');
    await waitFor(() => expect(searchCustomers).toHaveBeenCalled());
    expect(screen.queryByText(en['crm.customers.search.createIndividual'])).toBeNull();
  });
});

describe('friendly search (P1-32)', () => {
  it('keeps the precise filters behind "More filters" and sends them when used', async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.queryByLabelText(en['crm.customers.search.phone'])).toBeNull();

    const toggle = screen.getByRole('button', { name: en['crm.customers.search.moreFilters'] });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(
      screen.getByRole('button', { name: en['crm.customers.search.fewerFilters'] })
    ).toHaveAttribute('aria-expanded', 'true');

    await user.type(screen.getByLabelText(en['crm.customers.search.name']), 'Nad');
    await user.type(screen.getByLabelText(en['crm.customers.search.reference']), 'C-0001');
    await user.type(screen.getByLabelText(en['crm.customers.search.phone']), '1234567{Enter}');

    await waitFor(() => expect(searchCustomers).toHaveBeenCalledTimes(1));
    const [, , criteria] = searchCustomers.mock.calls[0] as [unknown, unknown, unknown];
    expect(criteria).toEqual({ name: 'Nad', customerNumber: 'C-0001', phone: '1234567' });
  });

  it('shows phone, vehicle count and a partly-hidden hint on a masked phone', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), '4567{Enter}');
    const row = await screen.findByRole('row', { name: /Nadia Khoury/ });
    expect(within(row).getByText('*******4567')).toBeInTheDocument();
    expect(within(row).getByText(en['crm.customers.search.phonePartlyHidden'])).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
    // A direct link to the profile, keyed by id.
    expect(
      within(row).getByRole('link', { name: en['crm.customers.search.open'] })
    ).toHaveAttribute('href', `/en/crm/customers/${HIT.id}`);
  });

  it('does not show the hint when the phone is shown whole', async () => {
    searchCustomers.mockResolvedValue(
      page({ rows: [{ ...HIT, primaryPhone: '0791234567', phoneMasked: false }] })
    );
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Nadia{Enter}');
    expect(await screen.findByText('0791234567')).toBeInTheDocument();
    expect(screen.queryByText(en['crm.customers.search.phonePartlyHidden'])).toBeNull();
  });

  it('refuses a one-character search box and says why, without a request', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'N{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      en['crm.customers.search.qTooShort']
    );
    expect(searchCustomers).not.toHaveBeenCalled();
  });

  it('echoes Arabic-Indic digits for reading and sends what was typed', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), '٤٥٦٧');
    expect(screen.getByTestId('digits-echo')).toHaveTextContent('4567');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(searchCustomers).toHaveBeenCalledTimes(1));
    const [, , criteria] = searchCustomers.mock.calls[0] as [unknown, unknown, { q?: string }];
    expect(criteria.q).toBe('٤٥٦٧');
  });

  it('states the empty result with a next step', async () => {
    searchCustomers.mockResolvedValue(page({ rows: [] }));
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Zzz{Enter}');
    expect(await screen.findByText(en['crm.customers.search.noMatch'])).toBeInTheDocument();
    expect(en['crm.customers.search.noMatch']).toContain('last digits of the phone');
  });
});

describe('a stale response cannot replace a newer one', () => {
  it('shows the second search, not the first that resolved late', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    searchCustomers
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce(
        page({ rows: [{ ...HIT, id: 'second', displayName: 'Second Result' }] })
      );

    const user = userEvent.setup();
    renderScreen();
    const field = screen.getByLabelText(en['crm.customers.search.q']);

    await user.type(field, 'First{Enter}');
    await user.clear(field);
    await user.type(field, 'Second{Enter}');

    expect(await screen.findByText('Second Result')).toBeInTheDocument();

    // Now let the FIRST request land. Without the per-run cancellation flag in
    // `useServerTable` it would overwrite the newer page with the older one.
    resolveFirst?.(page({ rows: [{ ...HIT, id: 'first', displayName: 'First Result' }] }));
    await waitFor(() => expect(screen.getByText('Second Result')).toBeInTheDocument());
    expect(screen.queryByText('First Result')).toBeNull();
  });
});

describe('both directions', () => {
  it('renders in Arabic, right to left', async () => {
    const user = userEvent.setup();
    renderRtl(<CustomerSearchScreen locale="ar" messages={ar} canCreate={false} />);
    expect(screen.getByText(ar['crm.customers.search.idleTitle'])).toBeInTheDocument();
    await user.type(screen.getByLabelText(ar['crm.customers.search.q']), 'نادية{Enter}');
    expect(await screen.findByText('Nadia Khoury')).toBeInTheDocument();
  });
});

describe('paging the search, end to end', () => {
  /**
   * The screen changed hooks in P1-32 — `useServerTable` out, `useSearchRequest`
   * in — and the one thing that had to survive unchanged is the walk: the pager
   * spends the cursor the previous page returned, and a new question starts at
   * page one with no cursor at all.
   */
  it('spends the cursor page one returned when the operator asks for the next page', async () => {
    const user = userEvent.setup();
    searchCustomers.mockImplementation(async (_request: unknown, cursor: string | null) =>
      cursor === null
        ? page({ nextCursor: 'cursor-2', hasMore: true })
        : page({ rows: [{ ...HIT, id: 'second-page-row', displayName: 'Omar Haddad' }] })
    );
    renderScreen();
    await user.type(screen.getByLabelText(en['crm.customers.search.q']), 'Nadia{Enter}');
    await waitFor(() => expect(searchCustomers).toHaveBeenCalledTimes(1));
    expect(searchCustomers.mock.calls[0]?.[1]).toBeNull();

    await user.click(screen.getByRole('button', { name: en['table.nextPage'] }));
    await waitFor(() => expect(searchCustomers).toHaveBeenCalledTimes(2));
    expect(searchCustomers.mock.calls[1]?.[1]).toBe('cursor-2');
    expect(await screen.findByText('Omar Haddad')).toBeInTheDocument();
  });

  it('starts a NEW question at page one, with no cursor', async () => {
    // A cursor is issued against an ordering contract. Spending page two of the
    // previous search on a new one returns a window of a set that no longer
    // exists, and the rows look entirely plausible.
    const user = userEvent.setup();
    searchCustomers.mockImplementation(async (_request: unknown, cursor: string | null) =>
      cursor === null ? page({ nextCursor: 'cursor-2', hasMore: true }) : page()
    );
    renderScreen();
    const box = screen.getByLabelText(en['crm.customers.search.q']);
    await user.type(box, 'Nadia{Enter}');
    await waitFor(() => expect(searchCustomers).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: en['table.nextPage'] }));
    await waitFor(() => expect(searchCustomers).toHaveBeenCalledTimes(2));

    searchCustomers.mockClear();
    await user.clear(box);
    await user.type(box, 'Omar{Enter}');
    await waitFor(() => expect(searchCustomers).toHaveBeenCalled());
    expect(searchCustomers.mock.calls[0]?.[1]).toBeNull();
    expect(searchCustomers.mock.calls[0]?.[2]).toEqual({ q: 'Omar' });
  });
});
