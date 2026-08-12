import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * Choosing a customer by name (`P1-27-FE-021`, `P1-27-FE-025`).
 *
 * Ownership transfer and party authorization both want a `partnerId`, and for
 * the whole of P1-27 neither had a call site — because the only control anyone
 * could have built from the contract alone is a uuid text box, which no workshop
 * employee can use. This suite is about the two properties that make the
 * selector an answer to that rather than a restatement of it:
 *
 *   1. the operator sees and chooses a NAME, and
 *   2. the uuid is submitted and never rendered.
 *
 * Plus the property that keeps it usable at all: it does not search while
 * somebody is typing. `GET /api/v1/customers` is `expensive-read` at 30 requests
 * per 60 seconds, and a search-as-you-type chooser spends that budget in under
 * three seconds and then rate-limits the operator out of the form.
 */

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const { CustomerSelector } = await import('@/components/party/CustomerSelector');
type SelectedCustomer = Parameters<typeof CustomerSelector>[0]['value'];

const CUSTOMER_UUID = '9f8e7d6c-5b4a-4392-8172-0e02b2c3d479';

const HIT = {
  id: CUSTOMER_UUID,
  displayNumber: 'C-000482',
  displayName: 'Layla Haddad',
  partyType: 'individual',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const COMPANY = {
  id: '11112222-3333-4444-8555-666677778888',
  displayNumber: 'C-000900',
  displayName: 'Al-Rashid Transport Co.',
  partyType: 'organization',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
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

/** A harness that holds the selection, the way a real form does. */
function Harness({
  locale = 'en',
  messages = en,
}: {
  readonly locale?: Locale;
  readonly messages?: Messages;
}) {
  const [value, setValue] = useState<SelectedCustomer | null>(null);
  return (
    <CustomerSelector
      locale={locale}
      messages={messages}
      name="partnerId"
      labelKey="vehicles.ownership.newOwner"
      value={value}
      onChange={setValue}
    />
  );
}

beforeEach(() => {
  searchCustomerDirectory.mockReset();
  searchCustomerDirectory.mockResolvedValue(page([HIT]));
});

async function searchFor(name: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(en['crm.customers.column.name']), name);
  await user.click(screen.getByRole('button', { name: en['customerSelector.search'] }));
  return user;
}

describe('the selector asks nothing until it is asked', () => {
  it('calls the backend zero times on mount', () => {
    renderLtr(<Harness />);
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
    expect(screen.getByText(en['customerSelector.idle'])).toBeInTheDocument();
  });

  it('issues no request while the operator types a name', async () => {
    const user = userEvent.setup();
    renderLtr(<Harness />);
    await user.type(screen.getByLabelText(en['crm.customers.column.name']), 'Layla Haddad');
    // Twelve keystrokes. Search-as-you-type would have spent 12 of 30.
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
  });

  it('refuses to search on nothing at all', async () => {
    const user = userEvent.setup();
    renderLtr(<Harness />);
    await user.click(screen.getByRole('button', { name: en['customerSelector.search'] }));
    // An empty search asks the backend for "everything" and spends a slot to
    // say something nobody asked.
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
  });

  it('searches once, on the explicit action', async () => {
    renderLtr(<Harness />);
    await searchFor('Layla');
    await waitFor(() => expect(searchCustomerDirectory).toHaveBeenCalledTimes(1));
  });
});

describe('the operator chooses a name and the form carries an id', () => {
  it('lists a match by name, reference and type', async () => {
    renderLtr(<Harness />);
    await searchFor('Layla');
    expect(await screen.findByText('Layla Haddad')).toBeInTheDocument();
    expect(screen.getByText('C-000482')).toBeInTheDocument();
    // Scoped to the option. "Individual" is also an `<option>` of the type
    // filter, so an unscoped `getByText` matches two elements and fails for a
    // reason that has nothing to do with the result.
    const option = await screen.findByTestId('party-label');
    expect(within(option).getByText(en['crm.partyType.individual'])).toBeInTheDocument();
  });

  it('never renders the identifier, in the list or after choosing', async () => {
    const { container } = renderLtr(<Harness />);
    const user = await searchFor('Layla');
    await screen.findByText('Layla Haddad');
    expect(container.textContent ?? '').not.toContain(CUSTOMER_UUID);

    await user.click(screen.getByRole('button', { name: /Layla Haddad/ }));
    await screen.findByRole('button', { name: en['customerSelector.change'] });
    // The whole point: the id is in the form, not on the screen.
    expect(container.textContent ?? '').not.toContain(CUSTOMER_UUID);
  });

  it('submits the identifier through a hidden input', async () => {
    renderLtr(<Harness />);
    const user = await searchFor('Layla');
    await screen.findByText('Layla Haddad');
    await user.click(screen.getByRole('button', { name: /Layla Haddad/ }));

    const hidden = await screen.findByTestId('customer-selector-value');
    expect(hidden).toHaveAttribute('type', 'hidden');
    expect(hidden).toHaveAttribute('name', 'partnerId');
    expect(hidden).toHaveValue(CUSTOMER_UUID);
  });

  it('lets the operator change their mind', async () => {
    renderLtr(<Harness />);
    const user = await searchFor('Layla');
    await screen.findByText('Layla Haddad');
    await user.click(screen.getByRole('button', { name: /Layla Haddad/ }));
    await user.click(screen.getByRole('button', { name: en['customerSelector.change'] }));

    expect(screen.queryByTestId('customer-selector-value')).not.toBeInTheDocument();
    expect(screen.getByText(en['customerSelector.idle'])).toBeInTheDocument();
  });

  it('shows a company by name too', async () => {
    searchCustomerDirectory.mockResolvedValue(page([COMPANY]));
    renderLtr(<Harness />);
    await searchFor('Rashid');
    expect(await screen.findByText('Al-Rashid Transport Co.')).toBeInTheDocument();
    const option = await screen.findByTestId('party-label');
    expect(within(option).getByText(en['crm.partyType.organization'])).toBeInTheDocument();
  });
});

describe('every failure reads as itself', () => {
  it('renders a denial as a denial, not as an empty result', async () => {
    searchCustomerDirectory.mockResolvedValue(page([], { status: 'denied' }));
    renderLtr(<Harness />);
    await searchFor('Layla');
    // "No customers found" would say the record does not exist when the truth
    // is that this operator may not see it.
    expect(await screen.findByText(en['state.denied.title'])).toBeInTheDocument();
  });

  it('reads a rate limit as "try again shortly" and offers Retry', async () => {
    searchCustomerDirectory.mockResolvedValue(page([], { status: 'unavailable' }));
    renderLtr(<Harness />);
    await searchFor('Layla');
    expect(await screen.findByText(en['state.unavailable.title'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en['state.retry'] })).toBeInTheDocument();
    expect(screen.queryByText(en['state.error.title'])).not.toBeInTheDocument();
  });

  it('offers no Retry on an expired session, because retrying cannot work', async () => {
    searchCustomerDirectory.mockResolvedValue(page([], { status: 'expired' }));
    renderLtr(<Harness />);
    await searchFor('Layla');
    expect(await screen.findByText(en['state.expired.title'])).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en['state.retry'] })).not.toBeInTheDocument();
  });

  it('says "no results" when the search genuinely matched nothing', async () => {
    searchCustomerDirectory.mockResolvedValue(page([]));
    renderLtr(<Harness />);
    await searchFor('Nobody');
    expect(await screen.findByText(en['state.noResults.title'])).toBeInTheDocument();
  });
});

describe('it publishes no count and no sorting', () => {
  it('offers Previous/Next and no range when more pages exist', async () => {
    searchCustomerDirectory.mockResolvedValue(page([HIT], { hasMore: true }));
    const { container } = renderLtr(<Harness />);
    await searchFor('Layla');
    await screen.findByText('Layla Haddad');

    expect(screen.getByRole('button', { name: en['table.nextPage'] })).toBeInTheDocument();
    // The operation publishes `{ items, nextCursor, hasMore }` and no count, so
    // any "1–10 of 240" here would be invented.
    expect(container.textContent ?? '').not.toMatch(/\bof\s+\d+/i);
  });

  it('offers no column ordering, because the operation accepts no sort', async () => {
    renderLtr(<Harness />);
    await searchFor('Layla');
    await screen.findByText('Layla Haddad');
    for (const element of screen.getAllByRole('button')) {
      expect(element.textContent ?? '').not.toMatch(/sort/i);
    }
  });
});

describe('it can be embedded in a form without hijacking it', () => {
  it('renders no nested form element', async () => {
    // A nested `<form>` is invalid HTML: the browser drops the inner one and its
    // submit handler with it. This component is always rendered inside the
    // caller's form.
    const { container } = renderLtr(<Harness />);
    await searchFor('Layla');
    await screen.findByText('Layla Haddad');
    expect(container.querySelector('form')).toBeNull();
  });

  it('has no submit button anywhere', async () => {
    const { container } = renderLtr(<Harness />);
    await searchFor('Layla');
    await screen.findByText('Layla Haddad');
    // A bare `<button>` inside a form defaults to `submit`. Every control here
    // must be `type="button"`, or choosing a customer submits the transfer.
    for (const button of container.querySelectorAll('button')) {
      expect(button.getAttribute('type')).toBe('button');
    }
  });

  it('turns Enter in the name box into a search, not a submit', async () => {
    const user = userEvent.setup();
    renderLtr(<Harness />);
    await user.type(screen.getByLabelText(en['crm.customers.column.name']), 'Layla{Enter}');
    // Without the interception the OUTER form submits with no customer chosen.
    await waitFor(() => expect(searchCustomerDirectory).toHaveBeenCalledTimes(1));
  });
});

describe('the same selector in Arabic', () => {
  it('renders right-to-left and keeps the reference LTR', async () => {
    const user = userEvent.setup();
    renderRtl(<Harness locale="ar" messages={ar} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(ar['customerSelector.idle'])).toBeInTheDocument();

    await user.type(screen.getByLabelText(ar['crm.customers.column.name']), 'ليلى');
    await user.click(screen.getByRole('button', { name: ar['customerSelector.search'] }));

    expect(await screen.findByText('Layla Haddad')).toBeInTheDocument();
    // `C-000482` is latin inside an Arabic row and reorders without it.
    expect(screen.getByText('C-000482').closest('[dir="ltr"]')).not.toBeNull();
  });
});

describe('this file is not vacuous', () => {
  it('asserts against catalogue entries that really exist', () => {
    for (const key of [
      'customerSelector.search',
      'customerSelector.idle',
      'customerSelector.change',
      'customerSelector.hint',
      'customerSelector.anyType',
    ]) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
    }
  });

  it('uses a fixture id long enough that "absent" means something', () => {
    expect(CUSTOMER_UUID).toMatch(/^[0-9a-f-]{36}$/);
  });
});
