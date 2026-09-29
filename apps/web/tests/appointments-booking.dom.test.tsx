import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  BranchSwitch,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import type { IntakeCatalogueResult } from '@/features/appointments/catalogue-api';

/**
 * The booking form, in a DOM (`P1-28-FE-002`, `TC-P1-28-APT-002`), on the
 * Material UI wrappers (ADR-022).
 *
 * What must be true and cannot be proven by source-scanning: that an EMPTY
 * appointment-type catalogue renders as "not configured" and blocks booking
 * without pretending anything failed; that the customer is found on the server
 * by the term as typed and chosen by name; that the vehicle choices are the
 * CHOSEN customer's own vehicles, walked with the server's cursor; that the
 * requested window is typed on the BRANCH's clock and leaves this screen
 * carrying that branch's offset; that every refusal marks its field, takes the
 * cursor and is withdrawn on correction; and that the form's work is guarded.
 */

const createAppointment = vi.fn();
vi.mock('@/features/appointments/api', () => ({
  createAppointment: (...args: unknown[]) => createAppointment(...args),
}));

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory-read', () => ({
  searchCustomerDirectoryCancellable: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const listCustomerVehicles = vi.fn();
vi.mock('@/lib/customers/vehicles-read', () => ({
  listCustomerVehiclesCancellable: (...args: unknown[]) => listCustomerVehicles(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { AppointmentBookingScreen } =
  await import('@/features/appointments/components/AppointmentBookingScreen');

const CUSTOMER_HIT = {
  id: 'c1b2c3d4-0000-4000-8000-000000000001',
  displayNumber: 'C-0001',
  displayName: 'Nadia Khoury',
  partyType: 'individual',
  lifecycleStatus: 'active',
};

const VEHICLE_ENTRY = {
  id: 'd1b2c3d4-0000-4000-8000-000000000001',
  vehicleId: 'd1b2c3d4-0000-4000-8000-000000000002',
  relationshipRole: 'owner',
  validFrom: '2026-01-01',
  validTo: null,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  vehicleDisplayNumber: 'V-0100',
  vin: '1HGCM82633A004352',
  makeId: null,
  modelId: null,
  modelYear: 2021,
  color: null,
  vehicleLifecycleStatus: 'active',
};

const VEHICLE_LABEL = 'V-0100 · 1HGCM82633A004352 · 2021';

const TYPES: IntakeCatalogueResult = {
  status: 'ok',
  options: [
    {
      id: 'e1b2c3d4-0000-4000-8000-000000000001',
      scope: 'platform',
      code: 'SRV',
      name: 'Periodic service',
    },
  ],
  truncated: false,
  correlationId: null,
};

const CHANNELS: IntakeCatalogueResult = {
  status: 'ok',
  options: [
    {
      id: 'f1b2c3d4-0000-4000-8000-000000000001',
      scope: 'tenant',
      code: 'PHONE',
      name: 'Phone call',
    },
  ],
  truncated: false,
  correlationId: null,
};

const EMPTY_CATALOGUE: IntakeCatalogueResult = {
  status: 'ok',
  options: [],
  truncated: false,
  correlationId: null,
};

beforeEach(() => {
  createAppointment.mockReset();
  searchCustomerDirectory.mockReset();
  listCustomerVehicles.mockReset();
  push.mockReset();
  refresh.mockReset();
  window.localStorage.clear();
  searchCustomerDirectory.mockResolvedValue({
    status: 'ok',
    rows: [CUSTOMER_HIT],
    nextCursor: null,
    hasMore: false,
    correlationId: null,
  });
  listCustomerVehicles.mockResolvedValue({
    status: 'ok',
    rows: [VEHICLE_ENTRY],
    nextCursor: null,
    hasMore: false,
    correlationId: null,
  });
});

/** The product's Material provider, as the locale layout mounts it. */
function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

function renderScreen({ types = TYPES, channels = CHANNELS, canSetUpCatalogue = false } = {}) {
  // The branch is the working context's named selection, chosen in the header,
  // not a pair of controls on the booking form.
  return renderLtr(
    withMui(
      inBranch(
        <AppointmentBookingScreen
          locale="en"
          messages={en}
          types={types}
          channels={channels}
          canSetUpCatalogue={canSetUpCatalogue}
        />
      )
    )
  );
}

const customerBox = (catalogue: Record<string, string> = en) =>
  screen.getByRole('combobox', { name: catalogue['appointments.book.requester'] as string });

async function chooseCustomer(
  user: ReturnType<typeof userEvent.setup>,
  catalogue: Record<string, string> = en
) {
  await user.type(customerBox(catalogue), 'Nadia');
  await user.click(await screen.findByRole('option', { name: 'Nadia Khoury — C-0001' }));
}

const chooseVehicle = async (user: ReturnType<typeof userEvent.setup>, label = VEHICLE_LABEL) =>
  user.click(
    await screen.findByRole('button', { name: `${en['appointments.book.vehicleChoose']} ${label}` })
  );

/** Types a moment, part by part, in the order English writes it: day, month, year, hour, minute. */
async function typeMoment(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  digits: string
): Promise<HTMLElement> {
  const group = screen.getByRole('group', { name: new RegExp(`^${label}`) });
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard(digits);
  return group;
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await chooseCustomer(user);
  // The customer's vehicles appear only after the choice; pick the one.
  await chooseVehicle(user);
  await user.selectOptions(
    screen.getByLabelText(new RegExp(en['appointments.book.type'])),
    TYPES.options[0]!.id
  );
  await typeMoment(user, en['appointments.window.from'], '210820260900');
  await typeMoment(user, en['appointments.window.to'], '210820261000');
}

const submit = () => screen.getByRole('button', { name: en['appointments.book.submit'] });

describe('the empty catalogue is a fact, not a failure', () => {
  it('says no types are configured, and blocks booking honestly', () => {
    renderScreen({ types: EMPTY_CATALOGUE });
    expect(screen.getByText(en['appointments.book.noTypes'])).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    // Nothing failed, so nothing claims to have failed.
    expect(screen.queryByText(en['state.error.title'])).toBeNull();
  });

  it('offers no way to the setup screen to an operator who may not set it up', () => {
    renderScreen({ types: EMPTY_CATALOGUE });
    expect(screen.queryByTestId('booking-type-setup-link')).toBeNull();
    expect(screen.queryByText(en['appointments.book.noTypesSetUp'])).toBeNull();
  });

  it('tells a holder of appointment setup to set types up first, and links the setup screen (Owner decision 2026-09-29)', () => {
    renderScreen({ types: EMPTY_CATALOGUE, canSetUpCatalogue: true });
    expect(screen.getByText(en['appointments.book.noTypesSetUp'])).toBeInTheDocument();
    const link = screen.getByRole('link', { name: en['appointments.book.openSetup'] });
    expect(link).toHaveAttribute('href', '/en/administration/appointment-setup');
    // Still blocked, still not a failure: the catalogue is empty, not broken.
    expect(submit()).toBeDisabled();
    expect(screen.queryByText(en['state.error.title'])).toBeNull();
  });

  it("shows the organisation's own active types, and no setup link, once a type exists", () => {
    renderScreen({ canSetUpCatalogue: true });
    expect(screen.queryByTestId('booking-type-setup-link')).toBeNull();
    const select = screen.getByLabelText(new RegExp(en['appointments.book.type']));
    for (const option of TYPES.options) {
      expect(within(select).getByRole('option', { name: option.name })).toBeInTheDocument();
    }
  });

  it('says it in Arabic, right to left, with the link', () => {
    renderRtl(
      withMui(
        inBranch(
          <AppointmentBookingScreen
            locale="ar"
            messages={ar}
            types={EMPTY_CATALOGUE}
            channels={CHANNELS}
            canSetUpCatalogue
          />
        ),
        'ar'
      )
    );
    expect(screen.getByText(ar['appointments.book.noTypesSetUp'])).toBeInTheDocument();
    expect(screen.getByRole('link', { name: ar['appointments.book.openSetup'] })).toHaveAttribute(
      'href',
      '/ar/administration/appointment-setup'
    );
  });

  it('says a FAILED type read is unavailable, with the reference', () => {
    renderScreen({
      types: { status: 'unavailable', options: [], truncated: false, correlationId: 'cid-types' },
    });
    expect(screen.getByText(en['appointments.book.catalogueUnavailable'])).toBeInTheDocument();
    expect(screen.getByText('cid-types')).toBeInTheDocument();
  });

  it('records the absence of channels without blocking the booking', () => {
    renderScreen({ channels: EMPTY_CATALOGUE });
    expect(screen.getByText(en['appointments.book.noChannels'])).toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });

  it('admits a truncated catalogue walk instead of presenting it as complete', () => {
    renderScreen({ types: { ...TYPES, truncated: true } });
    expect(screen.getByText(en['appointments.book.catalogueTruncated'])).toBeInTheDocument();
  });
});

describe('the customer is found on the server and chosen by name', () => {
  it('asks the server with the term as typed, Arabic-Indic digits included', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(customerBox(), '٠٧٩٥');
    await waitFor(() => expect(searchCustomerDirectory).toHaveBeenCalled());
    const criteria = searchCustomerDirectory.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(criteria).toEqual({ q: '٠٧٩٥' });
  });

  it('holds the chosen customer by name, never by identifier', async () => {
    const user = userEvent.setup();
    const { container } = renderScreen();
    await chooseCustomer(user);
    expect(customerBox()).toHaveValue('Nadia Khoury — C-0001');
    expect(container.textContent).not.toContain(CUSTOMER_HIT.id);
  });

  it('says a refused customer search is a refusal, never "no matches"', async () => {
    searchCustomerDirectory.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'cid-denied',
    });
    const user = userEvent.setup();
    renderScreen();
    await user.type(customerBox(), 'Nadia');
    expect(await screen.findByText(en['state.denied.title'])).toBeInTheDocument();
    expect(screen.queryByText(en['state.noSearchMatches.title'])).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('the vehicle belongs to the chosen customer', () => {
  it('lists no vehicles until a customer is chosen', () => {
    renderScreen();
    expect(listCustomerVehicles).not.toHaveBeenCalled();
    expect(screen.getByText(en['appointments.book.vehicleAfterCustomer'])).toBeInTheDocument();
  });

  it("reads THAT customer's vehicles once chosen, and names each by its plate", async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);
    await waitFor(() => expect(listCustomerVehicles).toHaveBeenCalled());
    expect(listCustomerVehicles.mock.calls[0]![0]).toBe(CUSTOMER_HIT.id);
    const grid = await screen.findByRole('grid', { name: en['appointments.book.vehicleList'] });
    expect(
      within(grid).getByText(VEHICLE_LABEL, { selector: 'span[dir="ltr"]' })
    ).toBeInTheDocument();
    expect(grid.textContent).not.toContain(VEHICLE_ENTRY.vehicleId);

    await chooseVehicle(user);
    expect(screen.getByTestId('vehicle-picker')).toHaveTextContent(VEHICLE_LABEL);
    expect(
      screen.getByRole('button', { name: en['appointments.book.vehicleChange'] })
    ).toBeInTheDocument();
  });

  it('marks a vehicle whose link has ended', async () => {
    listCustomerVehicles.mockResolvedValue({
      status: 'ok',
      rows: [{ ...VEHICLE_ENTRY, active: false }],
      nextCursor: null,
      hasMore: false,
      correlationId: null,
    });
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);
    const grid = await screen.findByRole('grid', { name: en['appointments.book.vehicleList'] });
    expect(within(grid).getByText(en['appointments.book.vehicleFormerLink'])).toBeInTheDocument();
  });

  it('states plainly when the customer has no linked vehicle', async () => {
    listCustomerVehicles.mockResolvedValue({
      status: 'ok',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: null,
    });
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);
    expect(await screen.findByText(en['appointments.book.noVehicles'])).toBeInTheDocument();
  });

  it('says a refused vehicle read is a refusal and an outage is unavailable, with a retry', async () => {
    listCustomerVehicles.mockResolvedValue({
      status: 'unavailable',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'cid-veh',
    });
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);
    expect(await screen.findByText(en['state.unavailable.title'])).toBeInTheDocument();
    expect(screen.queryByText(en['appointments.book.noVehicles'])).toBeNull();
    listCustomerVehicles.mockResolvedValue({
      status: 'ok',
      rows: [VEHICLE_ENTRY],
      nextCursor: null,
      hasMore: false,
      correlationId: null,
    });
    await user.click(screen.getByRole('button', { name: en['state.retry'] }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });
});

describe('booking', () => {
  it('refuses an incomplete form locally, on each field, with the cursor on the first', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(submit());
    expect(await screen.findByText(en['appointments.book.requesterRequired'])).toBeInTheDocument();
    expect(screen.getByText(en['appointments.book.vehicleRequired'])).toBeInTheDocument();
    expect(createAppointment).not.toHaveBeenCalled();

    // The customer box is marked and takes the cursor: it is the first to fix.
    expect(customerBox()).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(document.activeElement).toBe(customerBox()));
    // Every other refused field is marked too, each beside itself.
    expect(screen.getByLabelText(new RegExp(en['appointments.book.type']))).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(
      screen.getByRole('group', { name: new RegExp(`^${en['appointments.window.from']}`) })
    ).toHaveAttribute('aria-invalid', 'true');
  });

  it('withdraws a complaint as soon as its field is corrected, keeping the others', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(submit());
    const type = screen.getByLabelText(new RegExp(en['appointments.book.type']));
    await waitFor(() => expect(type).toHaveAttribute('aria-invalid', 'true'));

    await user.selectOptions(type, TYPES.options[0]!.id);
    expect(type).not.toHaveAttribute('aria-invalid');
    // Untouched fields keep theirs.
    expect(screen.getByText(en['appointments.book.requesterRequired'])).toBeInTheDocument();
  });

  it('refuses a moment typed only in part, with the cursor on the part still to type', async () => {
    const user = userEvent.setup();
    renderScreen();
    await fillForm(user);
    // The end is emptied and half typed again: day and month only.
    const to = screen.getByRole('group', { name: new RegExp(`^${en['appointments.window.to']}`) });
    await user.click(within(to).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    await user.keyboard('2108');
    await user.click(submit());

    await waitFor(() => expect(to).toHaveAttribute('aria-invalid', 'true'));
    expect(createAppointment).not.toHaveBeenCalled();
    const year = within(to).getByRole('spinbutton', { name: en['mui.pickers.year'] });
    await waitFor(() => expect(document.activeElement).toBe(year));
    await user.keyboard('20261000');
    await waitFor(() => expect(to).not.toHaveAttribute('aria-invalid'));
  });

  it('refuses a window that ends before it starts, on the end', async () => {
    const user = userEvent.setup();
    renderScreen();
    await fillForm(user);
    const to = screen.getByRole('group', { name: new RegExp(`^${en['appointments.window.to']}`) });
    await user.click(within(to).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('210820260800');
    await user.click(submit());
    expect(await screen.findByText(en['field.windowEndsBeforeStart'])).toBeInTheDocument();
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it('sends exactly what the operator chose, with offset-bearing instants', async () => {
    createAppointment.mockResolvedValue({
      status: 'success',
      attempt: 1,
      correlationId: 'cid',
      created: {
        appointmentId: 'a1b2c3d4-0000-4000-8000-0000000000aa',
        displayNumber: null,
        lifecycleStatus: 'requested',
        recordVersion: 1,
      },
    });
    const user = userEvent.setup();
    renderScreen();
    // The clock is named where the times are entered.
    expect(screen.getByTestId('appointment-window-zone')).toHaveTextContent(TEST_BRANCH.timezone);
    await fillForm(user);
    await user.click(submit());

    await waitFor(() => expect(createAppointment).toHaveBeenCalledTimes(1));
    const [input] = createAppointment.mock.calls[0] as [Record<string, unknown>];
    expect(input).toEqual({
      companyId: '11111111-1111-4111-8111-111111111111',
      branchId: '22222222-2222-4222-8222-222222222222',
      requesterPartnerId: CUSTOMER_HIT.id,
      vehicleId: VEHICLE_ENTRY.vehicleId,
      appointmentTypeId: TYPES.options[0]!.id,
      // No channel chosen: sent as an explicit absence, never as ''.
      sourceChannelId: null,
      // Asia/Riyadh, UTC+3 all year: the wall clock typed, with the branch's offset.
      requestedFrom: '2026-08-21T09:00:00+03:00',
      requestedTo: '2026-08-21T10:00:00+03:00',
    });

    // Booking opens the appointment it just made.
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/en/appointments/a1b2c3d4-0000-4000-8000-0000000000aa')
    );
  });

  it('types the window on the branch clock wherever the branch is', async () => {
    createAppointment.mockResolvedValue({ status: 'invalid', attempt: 1, fieldErrors: {} });
    const user = userEvent.setup();
    renderLtr(
      withMui(
        inBranch(
          <AppointmentBookingScreen locale="en" messages={en} types={TYPES} channels={CHANNELS} />,
          { snapshot: branchSnapshot([{ ...TEST_BRANCH, timezone: 'Asia/Tokyo' }]) }
        )
      )
    );
    await fillForm(user);
    await user.click(submit());
    await waitFor(() => expect(createAppointment).toHaveBeenCalledTimes(1));
    const [input] = createAppointment.mock.calls[0] as [Record<string, unknown>];
    expect(input['requestedFrom']).toBe('2026-08-21T09:00:00+09:00');
  });

  it('renders a backend refusal beside the window as a whole, keeping the entries', async () => {
    // The backend reports window violations against `requestedFrom` even when
    // the end is the offending half, so the sentence lands under the PAIR.
    createAppointment.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.formError',
      fieldErrors: { requestedFrom: 'form.violation.invalid_format' },
      correlationId: 'cid-422',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderScreen();
    await fillForm(user);
    await user.click(submit());
    expect(await screen.findByText(en['form.violation.invalid_format'])).toBeInTheDocument();
    // What was entered is still there.
    expect(customerBox()).toHaveValue('Nadia Khoury — C-0001');
    expect(screen.getByLabelText(new RegExp(en['appointments.book.type']))).toHaveValue(
      TYPES.options[0]!.id
    );
    expect(
      screen.getByRole('group', { name: new RegExp(`^${en['appointments.window.from']}`) })
    ).toHaveTextContent('2026');
  });
});

describe('a booking whose answer never arrives', () => {
  it('says so, keeps every entry, frees the button, and leaves nothing unhandled', async () => {
    // The Server Action's promise REJECTS (the connection dropped). The button
    // used to stay "Working…" for ever and the rejection went unhandled.
    createAppointment.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderScreen();
    await fillForm(user);
    await user.click(submit());

    expect(await screen.findByText(en['state.unavailable.message'])).toBeVisible();
    expect(submit()).toBeEnabled();
    expect(submit()).toHaveTextContent(en['appointments.book.submit']);
    expect(customerBox()).toHaveValue('Nadia Khoury — C-0001');
    expect(push).not.toHaveBeenCalled();

    // And the operator can simply try again.
    createAppointment.mockResolvedValue({ status: 'invalid', attempt: 2, fieldErrors: {} });
    await user.click(submit());
    await waitFor(() => expect(createAppointment).toHaveBeenCalledTimes(2));
  });
});

describe('both directions', () => {
  it('renders in Arabic, right to left', () => {
    renderRtl(
      withMui(
        inBranch(
          <AppointmentBookingScreen locale="ar" messages={ar} types={TYPES} channels={CHANNELS} />,
          { locale: 'ar' }
        ),
        'ar'
      )
    );
    expect(screen.getByText(ar['appointments.book.vehicleAfterCustomer'])).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: ar['appointments.book.submit'] })
    ).toBeInTheDocument();
    expect(customerBox(ar)).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: new RegExp(`^${ar['appointments.window.from']}`) })
    ).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('books an afternoon window typed in Arabic on the branch clock (DEF-01)', async () => {
    // Arabic writes the morning/afternoon part first, then the time, then the
    // day. The afternoon word was read back as the morning and every afternoon
    // time was refused as empty, so no request was sent.
    createAppointment.mockResolvedValue({ status: 'invalid', attempt: 1, fieldErrors: {} });
    const user = userEvent.setup();
    renderRtl(
      withMui(
        inBranch(
          <AppointmentBookingScreen locale="ar" messages={ar} types={TYPES} channels={CHANNELS} />,
          { locale: 'ar', snapshot: branchSnapshot([{ ...TEST_BRANCH, timezone: 'Asia/Amman' }]) }
        ),
        'ar'
      )
    );
    await chooseCustomer(user, ar);
    await user.click(
      await screen.findByRole('button', {
        name: `${ar['appointments.book.vehicleChoose']} ${VEHICLE_LABEL}`,
      })
    );
    await user.selectOptions(
      screen.getByLabelText(new RegExp(ar['appointments.book.type'])),
      TYPES.options[0]!.id
    );
    await typeMoment(user, ar['appointments.window.from'], 'م030021082026');
    await typeMoment(user, ar['appointments.window.to'], 'م040021082026');
    await user.click(screen.getByRole('button', { name: ar['appointments.book.submit'] }));

    await waitFor(() => expect(createAppointment).toHaveBeenCalledTimes(1));
    const [input] = createAppointment.mock.calls[0] as [Record<string, unknown>];
    // Asia/Amman, UTC+3 all year: 03:00 and 04:00 in the afternoon.
    expect(input['requestedFrom']).toBe('2026-08-21T15:00:00+03:00');
    expect(input['requestedTo']).toBe('2026-08-21T16:00:00+03:00');
    expect(screen.queryByText(ar['form.required'])).toBeNull();
  });
});

describe('F1 — one page of ten was every vehicle this picker could offer', () => {
  const ELEVENTH = {
    ...VEHICLE_ENTRY,
    id: 'link-11',
    vehicleId: '99999999-9999-4999-8999-999999999999',
    vehicleDisplayNumber: 'V-0111',
  };

  function pageOf(rows: readonly unknown[], hasMore = false) {
    return {
      status: 'ok' as const,
      rows,
      nextCursor: hasMore ? 'cursor-2' : null,
      hasMore,
      correlationId: null,
    };
  }

  it('does not present one page as the customer whole list', async () => {
    listCustomerVehicles.mockResolvedValue(pageOf([VEHICLE_ENTRY], true));
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);

    expect(await screen.findByTestId('booking-vehicles-truncated')).toHaveTextContent(
      en['appointments.book.vehiclesTruncated']
    );
  });

  it('reaches the vehicle on the next page with the server cursor, and books against it', async () => {
    listCustomerVehicles.mockResolvedValue(pageOf([VEHICLE_ENTRY], true));
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);
    await screen.findByTestId('booking-vehicles-truncated');

    listCustomerVehicles.mockResolvedValue(pageOf([ELEVENTH]));
    await user.click(screen.getByRole('button', { name: en['table.nextPage'] }));
    await waitFor(() => expect(listCustomerVehicles.mock.calls.at(-1)?.[2]).toBe('cursor-2'));

    // The row that could not be selected at all before is now selectable.
    await chooseVehicle(user, 'V-0111 · 1HGCM82633A004352 · 2021');
    await waitFor(() => expect(screen.getByTestId('vehicle-picker')).toHaveTextContent('V-0111'));
    expect(
      within(screen.getByTestId('vehicle-picker')).getByRole('button', {
        name: en['appointments.book.vehicleChange'],
      })
    ).toBeInTheDocument();
  });

  it('does not call the garage empty when the read stopped at a page boundary', async () => {
    listCustomerVehicles.mockResolvedValue(pageOf([], true));
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);

    const empty = await screen.findByTestId('booking-vehicles-empty');
    expect(empty).toHaveTextContent(en['appointments.book.vehiclesTruncated']);
    expect(empty).not.toHaveTextContent(en['appointments.book.noVehicles']);
  });

  it('offers no further page and no notice when the read covered the set', async () => {
    listCustomerVehicles.mockResolvedValue(pageOf([VEHICLE_ENTRY]));
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);
    await screen.findByRole('grid', { name: en['appointments.book.vehicleList'] });

    expect(screen.queryByTestId('booking-vehicles-truncated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: en['table.nextPage'] })).toBeDisabled();
  });

  it('renders the truncation sentence in Arabic, not as a key', async () => {
    listCustomerVehicles.mockResolvedValue(pageOf([VEHICLE_ENTRY], true));
    const user = userEvent.setup();
    renderRtl(
      withMui(
        inBranch(
          <AppointmentBookingScreen locale="ar" messages={ar} types={TYPES} channels={CHANNELS} />,
          { locale: 'ar' }
        ),
        'ar'
      )
    );
    await chooseCustomer(user, ar);

    expect(await screen.findByTestId('booking-vehicles-truncated')).toHaveTextContent(
      ar['appointments.book.vehiclesTruncated']
    );
  });
});

describe('a booking cannot be addressed to "all my branches"', () => {
  it('refuses the submit, refuses a moment on no single clock, and says which control answers', async () => {
    // `POST /appointments` names both halves of the pair as mandatory. Picking
    // one on the operator behalf would book a vehicle into a workshop nobody
    // named.
    const user = userEvent.setup();
    const second = { ...TEST_BRANCH, id: '88888888-8888-4888-8888-888888888888', name: 'Second' };
    renderLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to="all" label="use all" />
            <AppointmentBookingScreen locale="en" messages={en} types={TYPES} channels={CHANNELS} />
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, second]) }
        )
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));

    expect(
      await screen.findByRole('button', { name: en['appointments.book.submit'] })
    ).toBeDisabled();
    expect(screen.getByTestId('submit-needs-branch')).toHaveTextContent(
      en['workingContext.needsOneBranch']
    );
    // No clock the typed time could honestly mean: the pickers are not drawn,
    // and the window says which control answers.
    expect(
      screen.queryByRole('group', { name: new RegExp(`^${en['appointments.window.from']}`) })
    ).toBeNull();
    expect(screen.getByTestId('appointment-window-refused')).toHaveTextContent(
      en['workingContext.needsOneBranch']
    );
  });
});

describe('a branch whose clock is not published takes no moment', () => {
  it('says the time zone is not known, draws no picker and keeps the submit unavailable', () => {
    renderLtr(
      withMui(
        inBranch(
          <AppointmentBookingScreen locale="en" messages={en} types={TYPES} channels={CHANNELS} />,
          { snapshot: branchSnapshot([{ ...TEST_BRANCH, timezone: '' }]) }
        )
      )
    );
    expect(screen.getByTestId('appointment-window-refused')).toHaveTextContent(
      en['dateField.zoneUnknown']
    );
    expect(
      screen.queryByRole('group', { name: new RegExp(`^${en['appointments.window.from']}`) })
    ).toBeNull();
    expect(submit()).toBeDisabled();
  });
});

describe('the booking is unsaved work until it is stored', () => {
  /*
   * The form follows the header for its branch, but the customer, the vehicle,
   * the type and the window are its own. Kept across a confirmed discard, they
   * would book the previous branch's appointment into the next one.
   */
  const second = { ...TEST_BRANCH, id: '88888888-8888-4888-8888-888888888888', name: 'Second' };

  function renderInTwo() {
    return renderLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to={TEST_BRANCH.id} label="first" />
            <BranchSwitch to={second.id} label="second" />
            <AppointmentBookingScreen locale="en" messages={en} types={TYPES} channels={CHANNELS} />
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, second]) }
        )
      )
    );
  }

  const type = () =>
    screen.getByLabelText(new RegExp(en['appointments.book.type'])) as HTMLSelectElement;

  it('keeps every entry when the operator stays', async () => {
    const user = userEvent.setup();
    renderInTwo();
    await user.click(screen.getByRole('button', { name: 'first' }));
    await fillForm(user);

    await user.click(screen.getByRole('button', { name: 'second' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: en['overlay.cancel'] }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    expect(type().value).toBe(TYPES.options[0]!.id);
    expect(customerBox()).toHaveValue('Nadia Khoury — C-0001');
    expect(screen.getByTestId('vehicle-picker')).toHaveTextContent('V-0100');
    window.localStorage.clear();
  });

  it('empties the customer, the vehicle, the type and the window once the operator confirms', async () => {
    const user = userEvent.setup();
    renderInTwo();
    await user.click(screen.getByRole('button', { name: 'first' }));
    await fillForm(user);
    expect(type().value).toBe(TYPES.options[0]!.id);

    await user.click(screen.getByRole('button', { name: 'second' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: en['workingContext.discard.confirm'] })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await waitFor(() => expect(type().value).toBe(''));
    expect(customerBox()).toHaveValue('');
    expect(
      screen.getByRole('group', { name: new RegExp(`^${en['appointments.window.from']}`) })
    ).not.toHaveTextContent('2026');
    expect(screen.getByText(en['appointments.book.vehicleAfterCustomer'])).toBeVisible();
    // Nothing is left to lose, so the next switch asks nothing.
    await user.click(screen.getByRole('button', { name: 'first' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(createAppointment).not.toHaveBeenCalled();
    window.localStorage.clear();
  });

  it('asks nothing of an untouched form', async () => {
    const user = userEvent.setup();
    renderInTwo();
    await user.click(screen.getByRole('button', { name: 'first' }));
    await user.click(screen.getByRole('button', { name: 'second' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    window.localStorage.clear();
  });
});
