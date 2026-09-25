import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS } from '@/lib/use-debounced-value';
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
 * Plus the property that keeps it usable at all, which CHANGED under the Owner
 * directive (`P1-32-PRE-OD-UX`) and is now the stronger of the two.
 *
 * It used to search only on an explicit action, because a request per CHARACTER
 * would spend `GET /api/v1/customers` — `expensive-read`, 30 requests per 60
 * seconds — in under three seconds of typing. It now searches as the operator
 * types, through `useSearchRequest`: one request per PAUSE, with every
 * superseded answer discarded. That is FEWER requests than the type-press-read-
 * correct-press loop it replaces, and the cases below hold the part that
 * matters — nothing on mount, nothing per keystroke, and one request for one
 * settled term.
 */

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const { CustomerSelector } = await import('@/components/party/CustomerSelector');
const { CustomerPicker } = await import('@/components/party/CustomerPicker');
type ChosenCustomer = Parameters<typeof CustomerPicker>[0]['value'];
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

  it('searches once, on the explicit action', async () => {
    renderLtr(<Harness />);
    await searchFor('Layla');
    await waitFor(() => expect(searchCustomerDirectory).toHaveBeenCalledTimes(1));
  });
});

/**
 * The debounce contract, on a clock the test owns.
 *
 * ## Why these three do not use the wall clock
 *
 * They used to. `await user.type(...)` of a twelve-character name was followed
 * by "no request has been made yet", and that assertion was a race against the
 * 300 ms the debounce waits: `userEvent` yields to the event loop between
 * keystrokes, so typing takes REAL time. Measured in this environment with this
 * file running alone on an idle machine, those twelve keystrokes took 265 ms —
 * a 35 ms margin. Under the full DOM tier, with workers competing for the same
 * cores, they cross 300 ms, the debounce fires mid-word, and the case fails;
 * run alone it passes every time. That is the whole of the order dependence,
 * and it lived in the test rather than in the component. A longer sleep cannot
 * fix it, because the failure is a timer firing EARLY.
 *
 * ## Why `fireEvent` and not `userEvent` here
 *
 * `userEvent` routes every interaction through the testing library async
 * wrapper, which drains the microtask queue with a `setTimeout(0)` it only
 * advances when a JEST clock is installed. Under Vitest fake timers there is no
 * such clock, so that drain never resolves and each case hangs to the suite
 * timeout — a worse failure than the race, and one that looks like a product
 * hang. `fireEvent` is synchronous and act-wrapped, which is exactly what these
 * three need: the events land with NO time between them, which is what "typed
 * rapidly" means, and the clock moves only where a line below says so.
 *
 * Only the four timer functions the debounce is built on are faked. Faking the
 * rest takes `setImmediate` with it, which the same drain also reaches for.
 */
describe('the debounce spends one request per pause, and none before one', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Move the clock, and let everything it started finish. */
  async function settle(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /** One change event per character, with nothing between them. */
  function typeRapidly(field: HTMLElement, text: string) {
    for (let cut = 1; cut <= text.length; cut += 1) {
      fireEvent.change(field, { target: { value: text.slice(0, cut) } });
    }
  }

  it('sends nothing while twelve characters are typed, then exactly one', async () => {
    renderLtr(<Harness />);
    typeRapidly(screen.getByLabelText(en['crm.customers.column.name']), 'Layla Haddad');
    // Twelve keystrokes. A request per character would have spent 12 of the 30
    // this operation allows in sixty seconds.
    expect(searchCustomerDirectory).not.toHaveBeenCalled();

    await settle(SEARCH_DEBOUNCE_MS);
    expect(searchCustomerDirectory).toHaveBeenCalledTimes(1);
    expect(searchCustomerDirectory.mock.calls[0]?.[2]).toEqual({ name: 'Layla Haddad' });

    // Still one, three intervals later: a debounce that re-fired on an
    // unchanged term would spend the allowance on a question already answered.
    await settle(SEARCH_DEBOUNCE_MS * 3);
    expect(searchCustomerDirectory).toHaveBeenCalledTimes(1);
  });

  it('refuses a one-character free-text term before spending a request', async () => {
    renderLtr(<Harness />);
    fireEvent.change(screen.getByLabelText(en['customerSelector.q']), { target: { value: 'L' } });
    expect(screen.getByText(en['crm.customers.search.qTooShort'])).toBeInTheDocument();
    // The minimum is the backend own rule and it is read BEFORE the timer, so
    // running the clock on changes nothing: there was never anything to ask.
    await settle(SEARCH_DEBOUNCE_MS * 2);
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
  });

  it('refuses to search on nothing at all', async () => {
    renderLtr(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: en['customerSelector.search'] }));
    // An empty search asks the backend for "everything" and spends a slot to
    // say something nobody asked. The clock is run on, so the debounce cannot
    // be hiding one that lands later.
    await settle(SEARCH_DEBOUNCE_MS * 2);
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
    expect(screen.getByText(en['customerSelector.idle'])).toBeInTheDocument();
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
    // The list collapsed with the choice: the criteria that produced it are
    // gone, so there is nothing left for a stray second click to replace.
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

/*
 * CustomerPicker — the one-box chooser the finance screens use (Owner
 * directive, `P1-32-PRE-OD-UX`). It spends the same directory adapter as the
 * selector above, so it is proved here beside it: found by name, chosen by
 * name, never a reference; permission-aware; and the caller's refusal sits on
 * the control that fixes it.
 */
function PickerHarness({
  canSearch = true,
  error,
  describedBy,
}: {
  readonly canSearch?: boolean;
  readonly error?: string;
  readonly describedBy?: string;
}) {
  const [value, setValue] = useState<ChosenCustomer>(null);
  return (
    <>
      <CustomerPicker
        messages={en}
        locale="en"
        label="Paying customer"
        value={value}
        onChange={setValue}
        canSearch={canSearch}
        error={error}
        unavailableId="picker-unavailable"
        describedBy={describedBy}
      />
      <output data-testid="picker-value">{value?.id ?? ''}</output>
    </>
  );
}

describe('CustomerPicker', () => {
  it('asks the directory with the typed words and names the customer it chose', async () => {
    searchCustomerDirectory.mockResolvedValue(page([HIT]));
    const user = userEvent.setup();
    renderLtr(<PickerHarness />);
    await user.type(screen.getByLabelText(/^Paying customer/), 'Layla');
    await user.click(await screen.findByRole('button', { name: /Layla Haddad/ }));
    expect(searchCustomerDirectory.mock.calls.at(-1)?.[2]).toEqual({ q: 'Layla' });
    expect(screen.getByTestId('customer-picker-chosen')).toHaveTextContent(
      'Layla Haddad — C-000482'
    );
    // The reference is what the caller receives, and it is never shown.
    expect(screen.getByTestId('picker-value')).toHaveTextContent(CUSTOMER_UUID);
    expect(screen.getByTestId('customer-picker')).not.toHaveTextContent(CUSTOMER_UUID);
  });

  it('says a single character is too short and sends nothing', async () => {
    const user = userEvent.setup();
    renderLtr(<PickerHarness />);
    await user.type(screen.getByLabelText(/^Paying customer/), 'L');
    expect(await screen.findByText(en['customerPicker.tooShort'])).toBeVisible();
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
  });

  it('without the customer read offers no box and names the reason by id', () => {
    renderLtr(<PickerHarness canSearch={false} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(document.getElementById('picker-unavailable')).toHaveTextContent(
      en['customerPicker.notPermitted']
    );
  });

  it('puts the caller’s refusal on the box', () => {
    renderLtr(<PickerHarness error="Choose the paying customer." />);
    expect(screen.getByLabelText(/^Paying customer/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Choose the paying customer.')).toBeVisible();
  });

  it('gives the refused box the red edge and the caller’s description (browser QA row 6.6)', () => {
    renderLtr(
      <>
        <p id="picker-note">Only customers of this branch are offered.</p>
        <PickerHarness error="Choose the paying customer." describedBy="picker-note" />
      </>
    );
    const box = screen.getByLabelText(/^Paying customer/);
    expect(box).toHaveClass('border-error');
    expect(box).not.toHaveClass('border-border');
    expect(box).toHaveAccessibleDescription(
      expect.stringContaining('Only customers of this branch are offered.')
    );
    expect(box).toHaveAccessibleDescription(expect.stringContaining('Choose the paying customer.'));
  });

  it('keeps the cursor after a choice, on the control that changes it (browser QA row 10.4)', async () => {
    searchCustomerDirectory.mockResolvedValue(page([HIT]));
    const user = userEvent.setup();
    renderLtr(<PickerHarness />);
    await user.type(screen.getByLabelText(/^Paying customer/), 'Layla');
    await user.click(await screen.findByRole('button', { name: /Layla Haddad/ }));

    const change = screen.getByRole('button', { name: en['customerSelector.change'] });
    await waitFor(() => expect(change).toHaveFocus());
    // Announced with what was chosen, not as a bare "change" control.
    expect(change).toHaveAccessibleDescription(expect.stringContaining('Layla Haddad'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('marks the change control, not the chosen name, when the choice itself is refused', async () => {
    searchCustomerDirectory.mockResolvedValue(page([HIT]));
    const user = userEvent.setup();
    const { rerender } = renderLtr(<PickerHarness />);
    await user.type(screen.getByLabelText(/^Paying customer/), 'Layla');
    await user.click(await screen.findByRole('button', { name: /Layla Haddad/ }));
    rerender(<PickerHarness error="This customer cannot pay this invoice." />);

    const change = screen.getByRole('button', { name: en['customerSelector.change'] });
    expect(change).toHaveAttribute('aria-invalid', 'true');
    expect(change).toHaveClass('border-error');
    expect(change).toHaveAccessibleDescription(
      expect.stringContaining('This customer cannot pay this invoice.')
    );
  });
});
