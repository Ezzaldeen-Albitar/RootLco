import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  TEST_COMPANY,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';
import { addDays, dayIn, rangeOfDays } from '@/lib/branch-time';
import type { AppointmentListEntry } from '@/features/appointments/appointments-contract';

/**
 * The branch calendar, in a DOM (`P1-28-FE-001`, `TC-P1-28-APT-001`, rebuilt
 * under the Owner directive `P1-32-PRE-OD-UX`).
 *
 * ## What changed, and what this suite now has to prove
 *
 * The calendar used to wait behind a "Show calendar" button, and the first
 * claim this file made was that mounting issued NO request. That property has
 * been replaced — deliberately — by a stronger one: the screen reads on
 * arrival, and the read is BOUNDED to one day of the working branch measured on
 * that branch's own clock. What the old suite protected and still applies is
 * kept: a denial is never drawn as an empty calendar, no total is invented, an
 * inverted range is refused beside the field rather than relayed from the
 * server, and a branch changed in the header re-targets the board instead of
 * leaving one branch's work under another branch's name.
 *
 * The Server Action is mocked at the module boundary; the adapter's own request
 * shape is pinned by `appointments-contract.test.ts` and its scope door by
 * `security.test.ts`.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const listAppointments = vi.fn();

vi.mock('@/features/appointments/api', () => ({
  listAppointments: (...args: unknown[]) => listAppointments(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { AppointmentCalendarScreen } = await import(
  '@/features/appointments/components/AppointmentCalendarScreen'
);

const COMPANY = TEST_COMPANY.id;
const BRANCH = TEST_BRANCH.id;
const ZONE = TEST_BRANCH.timezone;

const ROW: AppointmentListEntry = {
  id: 'a1b2c3d4-0000-4000-8000-00000000000a',
  displayNumber: 'APT-0007',
  lifecycleStatus: 'requested',
  branchId: BRANCH,
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
  vi.clearAllMocks();
  // The working branch is REMEMBERED in browser storage. Left behind, one
  // case's choice becomes the next case's starting selection.
  window.localStorage.clear();
  listAppointments.mockResolvedValue(page());
});

function renderScreen({ canManage = false, canCheckIn = false, snapshot = branchSnapshot() } = {}) {
  return renderLtr(
    inBranch(
      <AppointmentCalendarScreen
        locale="en"
        messages={en}
        canManage={canManage}
        canCheckIn={canCheckIn}
      />,
      { snapshot }
    )
  );
}

/** The scope, filters and cursor of the most recent call. */
function lastCall(): {
  scope: Record<string, unknown>;
  filters: Record<string, unknown>;
  cursor: unknown;
} {
  const call = listAppointments.mock.calls.at(-1) as [
    Record<string, unknown>,
    Record<string, unknown>,
    unknown,
    unknown,
  ];
  return { scope: call[0], filters: call[1], cursor: call[3] };
}

/** Today's window on the branch's clock — the screen's default. */
function todayWindow(zone = ZONE) {
  const today = dayIn(zone);
  return rangeOfDays(zone, today, today);
}

describe('the calendar reads on arrival, bounded to the branch day', () => {
  it('issues exactly one read on first paint, for today in the branch timezone', async () => {
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));
    const { scope, filters } = lastCall();
    expect(scope).toEqual({ companyId: COMPANY, branchId: BRANCH });
    expect(filters).toEqual(todayWindow());
  });

  it('says which period it is showing', async () => {
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalled());
    expect(screen.getByTestId('appointment-period-label')).toHaveTextContent(
      EN['appointments.calendar.period.today'] as string
    );
  });

  it('asks nothing at all while no branch is chosen, and says which control answers', async () => {
    const second = { ...TEST_BRANCH, id: '77777777-7777-4777-8777-777777777777', name: 'Second' };
    renderScreen({ snapshot: branchSnapshot([TEST_BRANCH, second]) });
    expect(screen.getByTestId('appointment-calendar-blocked')).toHaveTextContent(
      EN['workingContext.chooseFirst'] as string
    );
    // Waited out rather than asserted synchronously, so a debounce cannot hide
    // a request that was made after the assertion.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(listAppointments).not.toHaveBeenCalled();
  });
});

describe('the period control', () => {
  it('reads seven days INCLUDING today for the next 7 days', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.period.next7'] as string })
    );
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(2));
    const today = dayIn(ZONE);
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, today, addDays(today, 6)));
  });

  it('refuses an inverted custom range at the field, and issues no request for it', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));
    listAppointments.mockClear();

    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.period.custom'] as string })
    );
    const from = screen.getByLabelText(EN['appointments.calendar.fromDay'] as string, {
      exact: false,
    });
    const to = screen.getByLabelText(EN['appointments.calendar.toDay'] as string, { exact: false });
    await user.type(from, '2026-09-20');
    await user.type(to, '2026-08-20');
    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.applyPeriod'] as string })
    );

    expect(await screen.findByText(EN['appointments.calendar.rangeInverted'] as string)).toBeVisible();
    // The control itself is marked, not only a sentence beside it — that is what
    // assistive technology announces and what focus-first-invalid finds.
    expect(to).toHaveAttribute('aria-invalid', 'true');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(listAppointments).not.toHaveBeenCalled();
  });

  it('clears the complaint when the operator corrects the date', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalled());

    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.period.custom'] as string })
    );
    const from = screen.getByLabelText(EN['appointments.calendar.fromDay'] as string, {
      exact: false,
    });
    const to = screen.getByLabelText(EN['appointments.calendar.toDay'] as string, { exact: false });
    await user.type(from, '2026-09-20');
    await user.type(to, '2026-08-20');
    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.applyPeriod'] as string })
    );
    await screen.findByText(EN['appointments.calendar.rangeInverted'] as string);

    await user.clear(to);
    await user.type(to, '2026-09-22');
    expect(screen.queryByText(EN['appointments.calendar.rangeInverted'] as string)).toBeNull();
  });

  it('reads the chosen days once they are applied', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.period.custom'] as string })
    );
    await user.type(
      screen.getByLabelText(EN['appointments.calendar.fromDay'] as string, { exact: false }),
      '2026-09-01'
    );
    await user.type(
      screen.getByLabelText(EN['appointments.calendar.toDay'] as string, { exact: false }),
      '2026-09-03'
    );
    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.applyPeriod'] as string })
    );
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(2));
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, '2026-09-01', '2026-09-03'));
  });
});

describe('the filters the operation publishes, and no others', () => {
  it('sends the chosen state beside the period, and spends a fresh cursor', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.selectOptions(
      screen.getByLabelText(EN['appointments.calendar.statusFilter'] as string, { exact: false }),
      'confirmed'
    );
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(2));
    expect(lastCall().filters).toEqual({ status: 'confirmed', ...todayWindow() });
    // A filter change starts the ordering again; a cursor issued against the
    // previous one names a window of a set that no longer exists.
    expect(lastCall().cursor).toBeNull();
  });

  it('sends a settled search term as typed, beside the period', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.type(
      screen.getByLabelText(EN['appointments.calendar.searchLabel'] as string),
      'ABC-12'
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(lastCall().filters['q']).toBe('ABC-12'));
    expect(lastCall().filters).toEqual({ q: 'ABC-12', ...todayWindow() });
  });

  it('refuses a one-character term at the box and never sends it', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(EN['appointments.calendar.searchLabel'] as string), 'A');
    expect(
      await screen.findByText(EN['appointments.calendar.searchTooShort'] as string)
    ).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 350));
    for (const call of listAppointments.mock.calls) {
      expect((call[1] as Record<string, unknown>)['q']).toBeUndefined();
    }
  });

  it('accepts digits typed on an Arabic keyboard and sends them as typed', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.type(
      screen.getByLabelText(EN['appointments.calendar.searchLabel'] as string),
      '١٢٣'
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(lastCall().filters['q']).toBe('١٢٣'));
  });
});

describe('the row an operator acts from', () => {
  it('renders the appointment in the words of the people involved', async () => {
    renderScreen();
    expect(await screen.findByText('APT-0007')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /APT-0007/ });
    expect(within(row).getByText('Nadia Khoury')).toBeInTheDocument();
    expect(within(row).getByText(EN['appointments.status.requested'] as string)).toBeInTheDocument();
    // No confirmed window yet — said as a fact, never as a blank.
    expect(
      within(row).getByText(EN['appointments.window.notConfirmed'] as string)
    ).toBeInTheDocument();
    expect(within(row).getByText('Periodic service')).toBeInTheDocument();
  });

  it('opens an appointment from its row', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: EN['appointments.calendar.open'] as string }));
    expect(push).toHaveBeenCalledWith(`/en/appointments/${ROW.id}`);
  });

  it('offers booking only to a holder of the manage permission', async () => {
    renderScreen({ canManage: true });
    expect(
      await screen.findByRole('link', { name: EN['appointments.book.title'] as string })
    ).toBeInTheDocument();
  });

  it('offers no booking without it', async () => {
    renderScreen({ canManage: false });
    await waitFor(() => expect(listAppointments).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: EN['appointments.book.title'] as string })).toBeNull();
  });
});

describe('honest states', () => {
  it('renders a denial instead of an empty calendar', async () => {
    listAppointments.mockResolvedValue(page({ status: 'denied', rows: [] }));
    renderScreen();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeInTheDocument();
    expect(screen.queryByText(EN['state.noResults.title'] as string)).toBeNull();
  });

  it('reports a rate limit as retryable unavailability, with the reference', async () => {
    listAppointments.mockResolvedValue(page({ status: 'unavailable', rows: [] }));
    renderScreen();
    expect(await screen.findByText(EN['state.unavailable.title'] as string)).toBeInTheDocument();
    expect(screen.getByText('fixed-correlation-id', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN['state.retry'] as string })).toBeInTheDocument();
  });

  it('tells an ended session to sign in again, with no useless retry', async () => {
    listAppointments.mockResolvedValue(page({ status: 'expired', rows: [] }));
    renderScreen();
    expect(await screen.findByText(EN['state.expired.title'] as string)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('states no matches only after an answer, and offers a way back to the whole day', async () => {
    listAppointments.mockResolvedValue(page({ rows: [] }));
    renderScreen();
    expect(await screen.findByText(EN['state.noResults.title'] as string)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: EN['appointments.calendar.clearFilters'] as string })
    ).toBeVisible();
  });

  it('never invents a total for the uncounted list', async () => {
    listAppointments.mockResolvedValue(page({ hasMore: true, nextCursor: 'c2' }));
    renderScreen();
    await screen.findByText('APT-0007');
    // Uncounted mode: no "of N", and Next is offered because the server said
    // more exists — the truncation is honest in both directions.
    expect(screen.queryByText(EN['table.of'] as string)).toBeNull();
    expect(screen.getByRole('button', { name: EN['table.nextPage'] as string })).toBeEnabled();
  });

  it('renders an unnumbered appointment as unnumbered, never as its identifier', async () => {
    listAppointments.mockResolvedValue(page({ rows: [{ ...ROW, displayNumber: null }] }));
    const { container } = renderScreen();
    expect(
      await screen.findByText(EN['appointments.column.noReference'] as string)
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain(ROW.id);
  });
});

/**
 * The day queue half.
 *
 * Check in appears on `confirmed` rows and on no other, because
 * `rec.reception-create` answers 409 `ERR-TRN-001` for every other lifecycle
 * status. Offering it anywhere else would be offering a refusal.
 */
describe('the day queue', () => {
  it('offers Check in on a confirmed row and on no other status', async () => {
    listAppointments.mockResolvedValue(
      page({
        rows: [
          { ...ROW, id: 'row-confirmed', displayNumber: 'APT-1', lifecycleStatus: 'confirmed' },
          { ...ROW, id: 'row-requested', displayNumber: 'APT-2', lifecycleStatus: 'requested' },
          { ...ROW, id: 'row-cancelled', displayNumber: 'APT-3', lifecycleStatus: 'cancelled' },
        ],
      })
    );
    renderScreen({ canCheckIn: true });
    await screen.findByText('APT-1');

    const links = screen.getAllByRole('link', {
      name: EN['appointments.calendar.checkIn'] as string,
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/en/receptions/check-in');
  });

  it('withdraws Check in from an operator who cannot open a visit', async () => {
    listAppointments.mockResolvedValue(page({ rows: [{ ...ROW, lifecycleStatus: 'confirmed' }] }));
    renderScreen({ canCheckIn: false });
    await screen.findByText('APT-0007');
    expect(
      screen.queryByRole('link', { name: EN['appointments.calendar.checkIn'] as string })
    ).toBeNull();
    // The row is still openable; only the arrival affordance is withdrawn.
    expect(screen.getByRole('button', { name: EN['appointments.calendar.open'] as string })).toBeVisible();
  });

  it('says "Check in", never "Confirm" — there is no confirm operation', () => {
    // Confirmation is a side effect of rescheduling. A control that claimed to
    // confirm would name an operation this contract does not publish.
    expect(EN['appointments.calendar.checkIn']).toBe('Check in');
    const confirming = Object.entries(EN).filter(
      ([key, value]) => key.startsWith('appointments.') && /^confirm$/i.test(String(value).trim())
    );
    expect(confirming.map(([key]) => key)).toEqual([]);
  });
});

describe('both directions', () => {
  it('renders in Arabic, right to left, and reads on arrival there too', async () => {
    renderRtl(
      inBranch(
        <AppointmentCalendarScreen
          locale="ar"
          messages={ar}
          canManage={false}
          canCheckIn={false}
        />,
        { locale: 'ar' }
      )
    );
    expect(await screen.findByText('APT-0007')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    // The branch is named, in Arabic, by the context rather than picked here.
    expect(screen.getByTestId('appointment-branch-target')).toHaveTextContent(TEST_BRANCH.name);
    expect(
      screen.getByRole('button', { name: AR['appointments.calendar.period.today'] as string })
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('a branch changed in the header re-targets the calendar', () => {
  it('reads the NEW branch and drops the previous branch rows', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <AppointmentCalendarScreen
            locale="en"
            messages={en}
            canManage={false}
            canCheckIn={false}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );

    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() => expect(listAppointments).toHaveBeenCalled());
    expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: TEST_BRANCH.id });
    expect(await screen.findByText('APT-0007')).toBeInTheDocument();

    listAppointments.mockClear();
    listAppointments.mockResolvedValue(
      page({
        rows: [
          {
            ...ROW,
            id: 'other-appointment',
            branchId: OTHER_BRANCH.id,
            displayNumber: 'APT-0008',
          },
        ],
      })
    );
    await user.click(screen.getByRole('button', { name: 'use second' }));

    await waitFor(() =>
      expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: OTHER_BRANCH.id })
    );
    expect(await screen.findByText('APT-0008')).toBeInTheDocument();
    expect(screen.queryByText('APT-0007')).toBeNull();
  });

  it('reads every branch of the company, and names the branch of each row, on all my branches', async () => {
    const user = userEvent.setup();
    listAppointments.mockResolvedValue(
      page({
        rows: [
          {
            ...ROW,
            id: 'wide-appointment',
            branchId: OTHER_BRANCH.id,
            displayNumber: 'APT-0009',
          },
        ],
      })
    );
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to="all" label="use all" />
          <AppointmentCalendarScreen
            locale="en"
            messages={en}
            canManage={false}
            canCheckIn={false}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));

    // The company travels; the branch is deliberately left unnamed, which is
    // what asks the platform for every branch this operator may read.
    await waitFor(() => expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: null }));
    // A page that can span branches has to say which branch each row is from.
    expect(await screen.findByText(OTHER_BRANCH.name)).toBeVisible();
    // And the period label names the clock the day was counted on, because
    // several branches have no single one.
    expect(screen.getByTestId('appointment-period-label')).toHaveTextContent(TEST_BRANCH.name);
  });
});
