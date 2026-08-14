import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { IntakeCatalogueResult } from '@/features/appointments/catalogue-api';

/**
 * The booking form, in a DOM (`P1-28-FE-002`, `TC-P1-28-APT-002`).
 *
 * What must be true and cannot be proven by source-scanning: that an EMPTY
 * appointment-type catalogue renders as "not configured" and blocks booking
 * without pretending anything failed; that the vehicle choices are the CHOSEN
 * customer's own vehicles and appear only after that choice; that the
 * requested window leaves this screen carrying explicit UTC offsets; and that
 * an inverted window never becomes a request.
 */

const createAppointment = vi.fn();
vi.mock('@/features/appointments/api', () => ({
  createAppointment: (...args: unknown[]) => createAppointment(...args),
}));

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const listCustomerVehicles = vi.fn();
vi.mock('@/lib/customers/vehicles', () => ({
  listCustomerVehicles: (...args: unknown[]) => listCustomerVehicles(...args),
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

function renderScreen({ types = TYPES, channels = CHANNELS } = {}) {
  return renderLtr(
    <AppointmentBookingScreen
      locale="en"
      messages={en}
      companyIds={['11111111-1111-4111-8111-111111111111']}
      branchIds={['22222222-2222-4222-8222-222222222222']}
      types={types}
      channels={channels}
    />
  );
}

async function chooseCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(en['crm.customers.column.name']), 'Nadia');
  await user.click(screen.getByRole('button', { name: en['customerSelector.search'] }));
  await user.click(await screen.findByRole('button', { name: /Nadia Khoury/ }));
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    screen.getByLabelText(new RegExp(en['admin.scope.companyId'])),
    '11111111-1111-4111-8111-111111111111'
  );
  await user.selectOptions(
    screen.getByLabelText(new RegExp(en['admin.scope.branchId'])),
    '22222222-2222-4222-8222-222222222222'
  );
  await chooseCustomer(user);
  // The customer's vehicles appear only after the choice; pick the one.
  await user.click(await screen.findByRole('button', { name: /V-0100/ }));
  await user.selectOptions(
    screen.getByLabelText(new RegExp(en['appointments.book.type'])),
    TYPES.options[0]!.id
  );
  fireEvent.change(screen.getByLabelText(new RegExp(en['appointments.window.from'])), {
    target: { value: '2026-08-21T09:00' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(en['appointments.window.to'])), {
    target: { value: '2026-08-21T10:00' },
  });
}

describe('the empty catalogue is a fact, not a failure', () => {
  it('says no types are configured, and blocks booking honestly', () => {
    renderScreen({ types: EMPTY_CATALOGUE });
    expect(screen.getByText(en['appointments.book.noTypes'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en['appointments.book.submit'] })).toBeDisabled();
    // Nothing failed, so nothing claims to have failed.
    expect(screen.queryByText(en['state.error.title'])).toBeNull();
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
    expect(screen.getByRole('button', { name: en['appointments.book.submit'] })).toBeEnabled();
  });

  it('admits a truncated catalogue walk instead of presenting it as complete', () => {
    renderScreen({ types: { ...TYPES, truncated: true } });
    expect(screen.getByText(en['appointments.book.catalogueTruncated'])).toBeInTheDocument();
  });
});

describe('the vehicle belongs to the chosen customer', () => {
  it('lists no vehicles until a customer is chosen', () => {
    renderScreen();
    expect(listCustomerVehicles).not.toHaveBeenCalled();
    expect(screen.getByText(en['appointments.book.vehicleAfterCustomer'])).toBeInTheDocument();
  });

  it("reads THAT customer's vehicles once chosen", async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);
    await waitFor(() => expect(listCustomerVehicles).toHaveBeenCalled());
    expect(listCustomerVehicles.mock.calls[0]![0]).toBe(CUSTOMER_HIT.id);
    expect(await screen.findByRole('button', { name: /V-0100/ })).toBeInTheDocument();
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
});

describe('booking', () => {
  it('refuses an incomplete form locally, without a request', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: en['appointments.book.submit'] }));
    expect(await screen.findByText(en['appointments.book.requesterRequired'])).toBeInTheDocument();
    expect(screen.getByText(en['appointments.book.vehicleRequired'])).toBeInTheDocument();
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it('refuses a window that ends before it starts', async () => {
    const user = userEvent.setup();
    renderScreen();
    await fillForm(user);
    fireEvent.change(screen.getByLabelText(new RegExp(en['appointments.window.to'])), {
      target: { value: '2026-08-21T08:00' },
    });
    await user.click(screen.getByRole('button', { name: en['appointments.book.submit'] }));
    expect(await screen.findByText(en['field.windowEndsBeforeStart'])).toBeInTheDocument();
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
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: en['appointments.book.submit'] }));

    await waitFor(() => expect(createAppointment).toHaveBeenCalledTimes(1));
    const [input] = createAppointment.mock.calls[0] as [Record<string, unknown>];
    expect(input).toMatchObject({
      companyId: '11111111-1111-4111-8111-111111111111',
      branchId: '22222222-2222-4222-8222-222222222222',
      requesterPartnerId: CUSTOMER_HIT.id,
      vehicleId: VEHICLE_ENTRY.vehicleId,
      appointmentTypeId: TYPES.options[0]!.id,
      // No channel chosen: sent as an explicit absence, never as ''.
      sourceChannelId: null,
    });
    expect(input['requestedFrom']).toMatch(/^2026-08-21T09:00:00(?:Z|[+-]\d{2}:\d{2})$/);
    expect(input['requestedTo']).toMatch(/^2026-08-21T10:00:00(?:Z|[+-]\d{2}:\d{2})$/);

    // Booking opens the appointment it just made.
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/en/appointments/a1b2c3d4-0000-4000-8000-0000000000aa')
    );
  });

  it('renders a backend refusal beside the window as a whole', async () => {
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
    await user.click(screen.getByRole('button', { name: en['appointments.book.submit'] }));
    expect(await screen.findByText(en['form.violation.invalid_format'])).toBeInTheDocument();
  });
});

describe('both directions', () => {
  it('renders in Arabic, right to left', () => {
    renderRtl(
      <AppointmentBookingScreen
        locale="ar"
        messages={ar}
        companyIds={['11111111-1111-4111-8111-111111111111']}
        branchIds={['22222222-2222-4222-8222-222222222222']}
        types={TYPES}
        channels={CHANNELS}
      />
    );
    expect(screen.getByText(ar['appointments.book.vehicleAfterCustomer'])).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: ar['appointments.book.submit'] })
    ).toBeInTheDocument();
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
    // The read is cursor-paginated at ten. Rendering the rows and stopping made
    // an eleventh linked vehicle unselectable, with nothing on screen saying so.
    listCustomerVehicles.mockResolvedValue(pageOf([VEHICLE_ENTRY], true));
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);

    expect(await screen.findByTestId('booking-vehicles-truncated')).toHaveTextContent(
      en['appointments.book.vehiclesTruncated']
    );
  });

  it('reaches the vehicle on the next page and books against it', async () => {
    listCustomerVehicles.mockResolvedValue(pageOf([VEHICLE_ENTRY], true));
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);
    await screen.findByTestId('booking-vehicles-truncated');

    const pager = screen.getByRole('navigation', {
      name: en['appointments.book.vehiclePagerLabel'],
    });
    listCustomerVehicles.mockResolvedValue(pageOf([ELEVENTH]));
    await user.click(within(pager).getByRole('button', { name: en['table.nextPage'] }));

    // The row that could not be selected at all before is now selectable.
    await user.click(await screen.findByRole('button', { name: /V-0111/ }));
    await waitFor(() => expect(screen.getByTestId('vehicle-picker')).toHaveTextContent('V-0111'));
    expect(
      within(screen.getByTestId('vehicle-picker')).getByRole('button', {
        name: en['appointments.book.vehicleChange'],
      })
    ).toBeInTheDocument();
  });

  it('does not call the garage empty when the read stopped at a page boundary', async () => {
    // A truncated page holding no rows is not "no vehicles are linked to this
    // customer" — that is a claim about the SET.
    listCustomerVehicles.mockResolvedValue(pageOf([], true));
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);

    const empty = await screen.findByTestId('booking-vehicles-empty');
    expect(empty).toHaveTextContent(en['appointments.book.vehiclesTruncated']);
    expect(empty).not.toHaveTextContent(en['appointments.book.noVehicles']);
  });

  it('offers no pager and no notice when the read covered the set', async () => {
    listCustomerVehicles.mockResolvedValue(pageOf([VEHICLE_ENTRY]));
    const user = userEvent.setup();
    renderScreen();
    await chooseCustomer(user);
    await screen.findByRole('button', { name: /V-0100/ });

    expect(screen.queryByTestId('booking-vehicles-truncated')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: en['appointments.book.vehiclePagerLabel'] })
    ).not.toBeInTheDocument();
  });

  it('renders the truncation sentence in Arabic, not as a key', async () => {
    listCustomerVehicles.mockResolvedValue(pageOf([VEHICLE_ENTRY], true));
    const user = userEvent.setup();
    renderRtl(
      <AppointmentBookingScreen
        locale="ar"
        messages={ar}
        companyIds={['11111111-1111-4111-8111-111111111111']}
        branchIds={['22222222-2222-4222-8222-222222222222']}
        types={TYPES}
        channels={CHANNELS}
      />
    );
    await user.type(screen.getByLabelText(ar['crm.customers.column.name']), 'Nadia');
    await user.click(screen.getByRole('button', { name: ar['customerSelector.search'] }));
    await user.click(await screen.findByRole('button', { name: /Nadia Khoury/ }));

    expect(await screen.findByTestId('booking-vehicles-truncated')).toHaveTextContent(
      ar['appointments.book.vehiclesTruncated']
    );
  });
});
