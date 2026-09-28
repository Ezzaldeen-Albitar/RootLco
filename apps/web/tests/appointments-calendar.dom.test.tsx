import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
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
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import {
  addDays,
  dayIn,
  endOfDayBound,
  formatInZone,
  rangeOfDays,
  zoneLabelAt,
} from '@/lib/branch-time';
import type { AppointmentListEntry } from '@/features/appointments/appointments-contract';

/**
 * The branch calendar, in a DOM (`P1-28-FE-001`, `TC-P1-28-APT-001`, rebuilt
 * under the Owner directive `P1-32-PRE-OD-UX` and moved onto the Material UI
 * wrappers, ADR-022).
 *
 * ## What this suite has to prove
 *
 * The screen reads on arrival, and the read is BOUNDED to one day of the
 * working branch measured on that branch's own clock. The calendar keeps its
 * two views (today, the next seven days) and its chosen days, now the
 * toolbar's date range: refused on the box to fix with the cursor moved there
 * and the typed days kept, sent on the branch's clock once applied. A denial
 * is never drawn as an empty calendar, a throttle is "unavailable" with a
 * retry, no total is invented and Next spends the server's cursor, the times
 * are drawn on the branch's clock, and a branch changed in the header
 * re-targets the board instead of leaving one branch's work under another
 * branch's name.
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

const { AppointmentCalendarScreen } =
  await import('@/features/appointments/components/AppointmentCalendarScreen');

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

/** The product's Material provider, as the locale layout mounts it. */
function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

function renderScreen({ canManage = false, canCheckIn = false, snapshot = branchSnapshot() } = {}) {
  return renderLtr(
    withMui(
      inBranch(
        <AppointmentCalendarScreen
          locale="en"
          messages={en}
          canManage={canManage}
          canCheckIn={canCheckIn}
        />,
        { snapshot }
      )
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

/** A calendar view chip, by its words. */
function viewChip(key: string, catalogue: Record<string, string> = EN): HTMLElement {
  const group = screen.getByRole('group', {
    name: catalogue['appointments.calendar.periodLabel'] as string,
  });
  return within(group).getByRole('button', { name: catalogue[key] as string });
}

/** Types a day into one of the date boxes, one part at a time. */
async function typeDay(user: ReturnType<typeof userEvent.setup>, label: string, digits: string) {
  const group = screen.getByRole('group', { name: new RegExp(`^${label}`) });
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard(digits);
  return group;
}

const summary = () => screen.getByTestId('appointment-calendar-toolbar-summary');

describe('the calendar reads on arrival, bounded to the branch day', () => {
  it('issues exactly one read on first paint, for today in the branch timezone', async () => {
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));
    const { scope, filters } = lastCall();
    expect(scope).toEqual({ companyId: COMPANY, branchId: BRANCH });
    expect(filters).toEqual(todayWindow());
    // The last instant of the branch's day, to the microsecond, with its offset.
    expect(filters['to']).toBe(endOfDayBound(ZONE, dayIn(ZONE)));
  });

  it('says which period it is showing, and on whose clock', async () => {
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalled());
    expect(summary()).toHaveTextContent(EN['appointments.calendar.period.today'] as string);
    expect(summary()).toHaveTextContent(ZONE);
    expect(viewChip('appointments.calendar.period.today')).toHaveAttribute('aria-pressed', 'true');
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

    await user.click(viewChip('appointments.calendar.period.next7'));
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(2));
    const today = dayIn(ZONE);
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, today, addDays(today, 6)));
    expect(viewChip('appointments.calendar.period.next7')).toHaveAttribute('aria-pressed', 'true');
    expect(summary()).toHaveTextContent(EN['appointments.calendar.period.next7'] as string);
  });

  it('refuses an inverted range at the field, keeps what was typed and issues no request', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));
    listAppointments.mockClear();

    const from = await typeDay(user, EN['appointments.calendar.fromDay'] as string, '20092026');
    const to = await typeDay(user, EN['appointments.calendar.toDay'] as string, '20082026');
    const apply = screen.getByRole('button', {
      name: EN['appointments.calendar.applyPeriod'] as string,
    });
    await user.click(apply);

    // On the box to fix, in words, with the cursor moved into it — the control
    // itself is marked, which is what assistive technology announces.
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(from).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('alert')).toHaveTextContent(EN['filters.period.inverted'] as string);
    await waitFor(() => expect(to.contains(document.activeElement)).toBe(true));
    // What was typed stays where it was typed.
    expect(from).toHaveTextContent('2026');
    expect(from).toHaveTextContent('20');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(listAppointments).not.toHaveBeenCalled();
  });

  it('refuses a missing first day on the From box', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));
    await typeDay(user, EN['appointments.calendar.toDay'] as string, '01092026');
    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.applyPeriod'] as string })
    );
    const from = screen.getByRole('group', {
      name: new RegExp(`^${EN['appointments.calendar.fromDay'] as string}`),
    });
    expect(from).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(EN['filters.period.incomplete'] as string);
    await waitFor(() => expect(from.contains(document.activeElement)).toBe(true));
  });

  it('clears the complaint when the operator corrects the date', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalled());

    await typeDay(user, EN['appointments.calendar.fromDay'] as string, '20092026');
    const to = await typeDay(user, EN['appointments.calendar.toDay'] as string, '20082026');
    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.applyPeriod'] as string })
    );
    await waitFor(() => expect(to).toHaveAttribute('aria-invalid', 'true'));

    await typeDay(user, EN['appointments.calendar.toDay'] as string, '22092026');
    await waitFor(() => expect(to).not.toHaveAttribute('aria-invalid'));
    expect(screen.queryByText(EN['filters.period.inverted'] as string)).toBeNull();
  });

  it('reads the chosen days once they are applied, and Clear puts the calendar back on today', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await typeDay(user, EN['appointments.calendar.fromDay'] as string, '01092026');
    await typeDay(user, EN['appointments.calendar.toDay'] as string, '03092026');
    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.applyPeriod'] as string })
    );
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(2));
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, '2026-09-01', '2026-09-03'));
    // Chosen days are in force, so neither view is pressed.
    expect(viewChip('appointments.calendar.period.today')).toHaveAttribute('aria-pressed', 'false');
    expect(viewChip('appointments.calendar.period.next7')).toHaveAttribute('aria-pressed', 'false');

    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.clearDays'] as string })
    );
    await waitFor(() => expect(lastCall().filters).toEqual(todayWindow()));
    expect(viewChip('appointments.calendar.period.today')).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts the chosen days away when a view is chosen', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));
    await typeDay(user, EN['appointments.calendar.fromDay'] as string, '01092026');
    await typeDay(user, EN['appointments.calendar.toDay'] as string, '03092026');
    await user.click(
      screen.getByRole('button', { name: EN['appointments.calendar.applyPeriod'] as string })
    );
    await waitFor(() =>
      expect(lastCall().filters).toEqual(rangeOfDays(ZONE, '2026-09-01', '2026-09-03'))
    );

    await user.click(viewChip('appointments.calendar.period.today'));
    await waitFor(() => expect(lastCall().filters).toEqual(todayWindow()));
    const from = screen.getByRole('group', {
      name: new RegExp(`^${EN['appointments.calendar.fromDay'] as string}`),
    });
    expect(from).not.toHaveTextContent('2026');
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
      screen.getByRole('searchbox', { name: EN['appointments.calendar.searchLabel'] as string }),
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

    const box = screen.getByRole('searchbox', {
      name: EN['appointments.calendar.searchLabel'] as string,
    });
    await user.type(box, 'A');
    expect(
      await screen.findByText(EN['appointments.calendar.searchTooShort'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await new Promise((resolve) => setTimeout(resolve, 350));
    for (const call of listAppointments.mock.calls) {
      expect((call[1] as Record<string, unknown>)['q']).toBeUndefined();
    }
  });

  it('accepts digits typed on an Arabic keyboard, sends them as typed and echoes them in Latin', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.type(
      screen.getByRole('searchbox', { name: EN['appointments.calendar.searchLabel'] as string }),
      '١٢٣'
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(lastCall().filters['q']).toBe('١٢٣'));
    expect(screen.getByTestId('appointment-calendar-toolbar')).toHaveTextContent('123');
  });
});

describe('the row an operator acts from', () => {
  it('renders the appointment in the words of the people involved', async () => {
    renderScreen();
    const grid = await screen.findByRole('grid', {
      name: EN['appointments.calendar.caption'] as string,
    });
    expect(within(grid).getByText('APT-0007', { selector: 'code' })).toBeInTheDocument();
    expect(within(grid).getByText('Nadia Khoury')).toBeInTheDocument();
    expect(
      within(grid).getByText(EN['appointments.status.requested'] as string)
    ).toBeInTheDocument();
    // No confirmed window yet — said as a fact, never as a blank.
    expect(
      within(grid).getByText(EN['appointments.window.notConfirmed'] as string)
    ).toBeInTheDocument();
    expect(within(grid).getByText('Periodic service')).toBeInTheDocument();
    // One branch: no branch column, and no identifier anywhere.
    expect(within(grid).queryByText(TEST_BRANCH.name)).toBeNull();
    expect(grid.textContent).not.toContain(ROW.requesterPartnerId);
  });

  it('draws the times on the branch clock, not the reader clock', async () => {
    const east = { ...TEST_BRANCH, timezone: 'Asia/Tokyo' };
    renderScreen({ snapshot: branchSnapshot([east]) });
    const grid = await screen.findByRole('grid', {
      name: EN['appointments.calendar.caption'] as string,
    });
    // 09:00 at +03:00 is 15:00 in Tokyo; the Riyadh wall clock is not shown.
    expect(
      within(grid).getByText(formatInZone(ROW.requestedFrom, 'en-GB', 'Asia/Tokyo'))
    ).toBeInTheDocument();
    expect(
      within(grid).queryByText(formatInZone(ROW.requestedFrom, 'en-GB', 'Asia/Riyadh'))
    ).toBeNull();
    expect(summary()).toHaveTextContent('Asia/Tokyo');
  });

  it('opens an appointment from its row, by a link named with its number', async () => {
    renderScreen();
    const open = await screen.findByRole('link', {
      name: `${EN['appointments.calendar.open'] as string} APT-0007`,
    });
    expect(open).toHaveAttribute('href', `/en/appointments/${ROW.id}`);
  });

  it('offers booking only to a holder of the manage permission', async () => {
    renderScreen({ canManage: true });
    expect(
      await screen.findByRole('link', { name: EN['appointments.book.title'] as string })
    ).toHaveAttribute('href', '/en/appointments/new');
  });

  it('offers no booking without it', async () => {
    renderScreen({ canManage: false });
    await waitFor(() => expect(listAppointments).toHaveBeenCalled());
    expect(
      screen.queryByRole('link', { name: EN['appointments.book.title'] as string })
    ).toBeNull();
  });
});

describe('honest states', () => {
  it('renders a denial instead of an empty calendar', async () => {
    listAppointments.mockResolvedValue(page({ status: 'denied', rows: [] }));
    renderScreen();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeInTheDocument();
    expect(screen.queryByText(EN['state.noResults.title'] as string)).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('reports a rate limit or an outage as retryable unavailability, with the reference', async () => {
    listAppointments.mockResolvedValue(page({ status: 'unavailable', rows: [] }));
    const user = userEvent.setup();
    renderScreen();
    expect(await screen.findByText(EN['state.unavailable.title'] as string)).toBeInTheDocument();
    expect(screen.getByText('fixed-correlation-id', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(EN['state.noResults.title'] as string)).toBeNull();

    // Trying again reads again, and an answer replaces the notice.
    listAppointments.mockResolvedValue(page());
    await user.click(screen.getByRole('button', { name: EN['state.retry'] as string }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('tells an ended session to sign in again, with no useless retry', async () => {
    listAppointments.mockResolvedValue(page({ status: 'expired', rows: [] }));
    renderScreen();
    expect(await screen.findByText(EN['state.expired.title'] as string)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('states no matches only after an answer, about the period, with nothing to clear on today', async () => {
    listAppointments.mockResolvedValue(page({ rows: [] }));
    renderScreen();
    expect(await screen.findByText(EN['state.noResults.title'] as string)).toBeInTheDocument();
    // Today with nothing narrowing it: Clear would change nothing.
    expect(
      screen.queryByRole('button', { name: EN['appointments.calendar.clearFilters'] as string })
    ).toBeNull();
  });

  it('states no matches only after an answer, and offers a way back to the whole day', async () => {
    listAppointments.mockResolvedValue(page({ rows: [] }));
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(EN['state.noResults.title'] as string);
    await user.selectOptions(
      screen.getByLabelText(EN['appointments.calendar.statusFilter'] as string, { exact: false }),
      'confirmed'
    );
    await waitFor(() => expect(lastCall().filters['status']).toBe('confirmed'));
    const clear = await screen.findByRole('button', {
      name: EN['appointments.calendar.clearFilters'] as string,
    });
    await user.click(clear);
    await waitFor(() => expect(lastCall().filters).toEqual(todayWindow()));
  });

  it('never invents a total, and Next spends the server cursor', async () => {
    listAppointments.mockResolvedValue(page({ hasMore: true, nextCursor: 'c2' }));
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('APT-0007', { selector: 'code' });
    // No "of N", and Next is offered because the server said more exists.
    expect(screen.queryByText(EN['table.of'] as string)).toBeNull();
    const next = screen.getByRole('button', { name: EN['table.nextPage'] as string });
    expect(next).toBeEnabled();

    listAppointments.mockResolvedValue(
      page({ rows: [{ ...ROW, id: 'second-page', displayNumber: 'APT-0099' }] })
    );
    await user.click(next);
    await waitFor(() => expect(lastCall().cursor).toBe('c2'));
    expect(await screen.findByText('APT-0099', { selector: 'code' })).toBeInTheDocument();
    expect(lastCall().filters).toEqual(todayWindow());
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
    await screen.findByText('APT-1', { selector: 'code' });

    const links = screen.getAllByRole('link', {
      name: new RegExp(`^${EN['appointments.calendar.checkIn'] as string}`),
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(`${EN['appointments.calendar.checkIn'] as string} APT-1`);
    expect(links[0]).toHaveAttribute('href', '/en/receptions/check-in');
  });

  it('withdraws Check in from an operator who cannot open a visit', async () => {
    listAppointments.mockResolvedValue(page({ rows: [{ ...ROW, lifecycleStatus: 'confirmed' }] }));
    renderScreen({ canCheckIn: false });
    await screen.findByText('APT-0007', { selector: 'code' });
    expect(
      screen.queryByRole('link', {
        name: new RegExp(`^${EN['appointments.calendar.checkIn'] as string}`),
      })
    ).toBeNull();
    // The row is still openable; only the arrival affordance is withdrawn.
    expect(
      screen.getByRole('link', { name: `${EN['appointments.calendar.open'] as string} APT-0007` })
    ).toBeVisible();
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
      withMui(
        inBranch(
          <AppointmentCalendarScreen
            locale="ar"
            messages={ar}
            canManage={false}
            canCheckIn={false}
          />,
          { locale: 'ar' }
        ),
        'ar'
      )
    );
    expect(await screen.findByText('APT-0007', { selector: 'code' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    // The branch is named, in Arabic, by the context rather than picked here.
    expect(screen.getByTestId('appointment-branch-target')).toHaveTextContent(TEST_BRANCH.name);
    expect(viewChip('appointments.calendar.period.today', AR)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      screen.getByRole('group', {
        name: new RegExp(`^${AR['appointments.calendar.fromDay'] as string}`),
      })
    ).toBeInTheDocument();
    expect(summary()).toHaveTextContent(AR['appointments.calendar.period.today'] as string);
  });
});

describe('a branch changed in the header re-targets the calendar', () => {
  it('reads the NEW branch and drops the previous branch rows', async () => {
    const user = userEvent.setup();
    renderLtr(
      withMui(
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
      )
    );

    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() => expect(listAppointments).toHaveBeenCalled());
    expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: TEST_BRANCH.id });
    expect(await screen.findByText('APT-0007', { selector: 'code' })).toBeInTheDocument();

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
    expect(await screen.findByText('APT-0008', { selector: 'code' })).toBeInTheDocument();
    expect(screen.queryByText('APT-0007', { selector: 'code' })).toBeNull();
  });

  it('reads every branch of the company, and names the branch and clock of each row, on all my branches', async () => {
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
      withMui(
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
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));

    // The company travels; the branch is deliberately left unnamed, which is
    // what asks the platform for every branch this operator may read.
    await waitFor(() => expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: null }));
    // A page that can span branches has to say which branch each row is from.
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByText(OTHER_BRANCH.name)).toBeVisible();
    // Each time names its clock, because several branches have no single one.
    expect(within(grid).getByTestId('appointment-window-clock')).toHaveTextContent(
      zoneLabelAt(ROW.requestedFrom, 'en-GB', OTHER_BRANCH.timezone)
    );
    // And the summary names the clock the day was counted on.
    expect(summary()).toHaveTextContent(TEST_BRANCH.name);
  });
});
