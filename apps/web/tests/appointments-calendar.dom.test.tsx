import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { AppointmentListEntry } from '@/features/appointments/appointments-contract';

/**
 * The branch calendar, in a DOM (`P1-28-FE-001`, `TC-P1-28-APT-001`).
 *
 * The behavioural claims source-scanning cannot make: that mounting issues no
 * request, that the calendar refuses to read until a branch is NAMED (there is
 * no "my branch" default anywhere in the platform), that an inverted range is
 * refused beside the field rather than relayed as a server refusal, and that
 * the failure states render as themselves — a denial never as an empty
 * calendar, a rate limit never as a fault.
 *
 * The Server Action is mocked at the module boundary; the adapter's own
 * request shape is pinned by `appointments-contract.test.ts`.
 */

const listAppointments = vi.fn();

vi.mock('@/features/appointments/api', () => ({
  listAppointments: (...args: unknown[]) => listAppointments(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { AppointmentCalendarScreen } =
  await import('@/features/appointments/components/AppointmentCalendarScreen');

const ROW: AppointmentListEntry = {
  id: 'a1b2c3d4-0000-4000-8000-00000000000a',
  displayNumber: 'APT-0007',
  lifecycleStatus: 'requested',
  vehicleId: 'a1b2c3d4-0000-4000-8000-00000000000b',
  vehicleDisplayNumber: 'V-0100',
  requesterPartnerId: 'a1b2c3d4-0000-4000-8000-00000000000c',
  requesterDisplayName: 'Nadia Khoury',
  appointmentTypeId: 'a1b2c3d4-0000-4000-8000-00000000000d',
  appointmentTypeName: 'Periodic service',
  requestedFrom: '2026-08-20T09:00:00+03:00',
  requestedTo: '2026-08-20T10:00:00+03:00',
  confirmedFrom: null,
  confirmedTo: null,
  recordVersion: 1,
};

function page(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    rows: [ROW],
    nextCursor: null,
    hasMore: false,
    correlationId: 'fixed-correlation-id',
    ...overrides,
  };
}

beforeEach(() => {
  listAppointments.mockReset();
  push.mockReset();
  refresh.mockReset();
  listAppointments.mockResolvedValue(page());
});

function renderScreen({
  companyIds = ['11111111-1111-4111-8111-111111111111'],
  branchIds = ['22222222-2222-4222-8222-222222222222'],
  canManage = false,
} = {}) {
  return renderLtr(
    <AppointmentCalendarScreen
      locale="en"
      messages={en}
      companyIds={companyIds}
      branchIds={branchIds}
      canManage={canManage}
    />
  );
}

async function submitTarget(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    screen.getByLabelText(new RegExp(en['admin.scope.companyId'])),
    '11111111-1111-4111-8111-111111111111'
  );
  await user.selectOptions(
    screen.getByLabelText(new RegExp(en['admin.scope.branchId'])),
    '22222222-2222-4222-8222-222222222222'
  );
  await user.click(screen.getByRole('button', { name: en['appointments.calendar.show'] }));
}

describe('before the operator has named a branch', () => {
  it('calls the backend zero times and explains itself', () => {
    renderScreen();
    // The decisive assertion: the list REQUIRES the branch pair, so a read
    // issued before the operator names one could only ever be refused.
    expect(listAppointments).not.toHaveBeenCalled();
    expect(screen.getByText(en['appointments.calendar.idleTitle'])).toBeInTheDocument();
  });

  it('refuses to submit without the pair, naming each missing half', async () => {
    const user = userEvent.setup();
    renderScreen({ companyIds: [], branchIds: [] });
    await user.click(screen.getByRole('button', { name: en['appointments.calendar.show'] }));
    expect(listAppointments).not.toHaveBeenCalled();
    // Unrestricted scope renders typed entry; both halves are still required.
    expect(screen.getAllByText(en['field.required'])).toHaveLength(2);
  });

  it('refuses an inverted range beside the field, without a request', async () => {
    const user = userEvent.setup();
    renderScreen();
    const from = screen.getByLabelText(en['appointments.calendar.fromDay']);
    const to = screen.getByLabelText(en['appointments.calendar.toDay']);
    // Later than `to` by a full month — inverted whichever timezone runs this.
    // `fireEvent.change` because a date control takes a value, not keystrokes.
    fireEvent.change(from, { target: { value: '2026-09-20' } });
    fireEvent.change(to, { target: { value: '2026-08-20' } });
    await submitTarget(user);
    expect(listAppointments).not.toHaveBeenCalled();
    expect(screen.getByText(en['appointments.calendar.rangeInverted'])).toBeInTheDocument();
  });
});

describe('reading the calendar', () => {
  it('sends the named branch as the target and the days as offset-bearing bounds', async () => {
    const user = userEvent.setup();
    renderScreen();
    await submitTarget(user);

    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));
    const [target, criteria] = listAppointments.mock.calls[0] as [
      { companyId: string; branchId: string },
      { from?: string; to?: string; status?: string },
    ];
    expect(target).toEqual({
      companyId: '11111111-1111-4111-8111-111111111111',
      branchId: '22222222-2222-4222-8222-222222222222',
    });
    // The instants carry an explicit UTC offset and full seconds — the list
    // schema refuses anything less — and they bound the chosen LOCAL days.
    const OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;
    expect(criteria.from).toMatch(/T00:00:00/);
    expect(criteria.from).toMatch(OFFSET);
    expect(criteria.to).toMatch(/T23:59:59/);
    expect(criteria.to).toMatch(OFFSET);
    expect(criteria.status).toBeUndefined();
  });

  it('passes the chosen state filter through', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.selectOptions(
      screen.getByLabelText(en['appointments.calendar.statusFilter']),
      'confirmed'
    );
    await submitTarget(user);
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));
    const [, criteria] = listAppointments.mock.calls[0] as [unknown, { status?: string }];
    expect(criteria.status).toBe('confirmed');
  });

  it('renders the row an operator acts from', async () => {
    const user = userEvent.setup();
    renderScreen();
    await submitTarget(user);

    expect(await screen.findByText('APT-0007')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /APT-0007/ });
    expect(within(row).getByText('Nadia Khoury')).toBeInTheDocument();
    expect(within(row).getByText(en['appointments.status.requested'])).toBeInTheDocument();
    // No confirmed window yet — said as a fact, never as a blank.
    expect(within(row).getByText(en['appointments.window.notConfirmed'])).toBeInTheDocument();
    expect(within(row).getByText('Periodic service')).toBeInTheDocument();
  });

  it('opens an appointment from its row', async () => {
    const user = userEvent.setup();
    renderScreen();
    await submitTarget(user);
    await user.click(await screen.findByRole('button', { name: en['appointments.calendar.open'] }));
    expect(push).toHaveBeenCalledWith(`/en/appointments/${ROW.id}`);
  });

  it('offers booking only to a holder of the manage permission', () => {
    renderScreen({ canManage: true });
    expect(screen.getByRole('link', { name: en['appointments.book.title'] })).toBeInTheDocument();
  });

  it('offers no booking without it', () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole('link', { name: en['appointments.book.title'] })).toBeNull();
  });
});

describe('honest states', () => {
  it('renders a denial instead of an empty calendar', async () => {
    listAppointments.mockResolvedValue(page({ status: 'denied', rows: [] }));
    const user = userEvent.setup();
    renderScreen();
    await submitTarget(user);
    expect(await screen.findByText(en['state.denied.title'])).toBeInTheDocument();
  });

  it('reports a rate limit as retryable unavailability, with the reference', async () => {
    listAppointments.mockResolvedValue(page({ status: 'unavailable', rows: [] }));
    const user = userEvent.setup();
    renderScreen();
    await submitTarget(user);
    expect(await screen.findByText(en['state.unavailable.title'])).toBeInTheDocument();
    expect(screen.getByText('fixed-correlation-id')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en['state.retry'] })).toBeInTheDocument();
  });

  it('tells an ended session to sign in again, with no useless retry', async () => {
    listAppointments.mockResolvedValue(page({ status: 'expired', rows: [] }));
    const user = userEvent.setup();
    renderScreen();
    await submitTarget(user);
    expect(await screen.findByText(en['state.expired.title'])).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en['state.retry'] })).toBeNull();
  });

  it('says a zero-row range is about the RANGE, not the branch', async () => {
    listAppointments.mockResolvedValue(page({ rows: [] }));
    const user = userEvent.setup();
    renderScreen();
    await submitTarget(user);
    expect(await screen.findByText(en['appointments.calendar.noneInRange'])).toBeInTheDocument();
    // The table's own generic empty state must NOT also render.
    expect(screen.queryByText(en['state.empty.title'])).toBeNull();
  });

  it('never invents a total for the uncounted list', async () => {
    listAppointments.mockResolvedValue(page({ hasMore: true, nextCursor: 'c2' }));
    const user = userEvent.setup();
    renderScreen();
    await submitTarget(user);
    await screen.findByText('APT-0007');
    // Uncounted mode: no "of N", and Next is offered because the server said
    // more exists — the truncation is honest in both directions.
    expect(screen.queryByText(en['table.of'])).toBeNull();
    expect(screen.getByRole('button', { name: en['table.nextPage'] })).toBeEnabled();
  });
});

describe('both directions', () => {
  it('renders in Arabic, right to left', async () => {
    const user = userEvent.setup();
    renderRtl(
      <AppointmentCalendarScreen
        locale="ar"
        messages={ar}
        companyIds={['11111111-1111-4111-8111-111111111111']}
        branchIds={['22222222-2222-4222-8222-222222222222']}
        canManage={false}
      />
    );
    expect(screen.getByText(ar['appointments.calendar.idleTitle'])).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText(new RegExp(ar['admin.scope.companyId'])),
      '11111111-1111-4111-8111-111111111111'
    );
    await user.selectOptions(
      screen.getByLabelText(new RegExp(ar['admin.scope.branchId'])),
      '22222222-2222-4222-8222-222222222222'
    );
    await user.click(screen.getByRole('button', { name: ar['appointments.calendar.show'] }));
    expect(await screen.findByText('APT-0007')).toBeInTheDocument();
  });
});
