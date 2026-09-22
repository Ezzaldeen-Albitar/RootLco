import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
  RECEPTION_STATUSES,
  TERMINAL_RECEPTION_STATUSES,
  UNFINISHED_RECEPTION_STATUSES,
} from '@/features/receptions/receptions-contract';
import { addDays, dayIn, endOfDay, rangeOfDays, startOfDay } from '@/lib/branch-time';

/**
 * The reception desk's board (`P1-28-FE-001`, rebuilt under the Owner directive
 * `P1-32-PRE-OD-UX`).
 *
 * ## What changed, and what the suite now has to prove
 *
 * The board used to wait behind a "Show the queue" button and this file's first
 * assertion was that it read NOTHING on mount. That property has been replaced,
 * deliberately, by a stronger one: it reads immediately and the read is BOUNDED
 * to one day of the working branch. So the cases below hold the new promise —
 * a request on arrival, with today's window measured on the branch's own clock —
 * and everything the old suite protected that still applies: no invented total,
 * a refusal that reads as a refusal, and a branch changed in the header
 * re-targeting the board rather than leaving one branch's work under another
 * branch's name.
 *
 * ## The day boundary is tested on its own, with explicit instants
 *
 * Asserting the window against `rangeOfDays` alone would pass if both the screen
 * and the helper were wrong in the same way. The last block pins the helper to
 * hand-computed instants in two named zones, so the screen's assertions rest on
 * something independently established.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const listReceptions = vi.fn();
vi.mock('@/features/receptions/api', () => ({
  listReceptions: (...args: unknown[]) => listReceptions(...args),
}));

const { ReceptionQueueScreen } =
  await import('@/features/receptions/components/ReceptionQueueScreen');

const COMPANY = TEST_COMPANY.id;
const BRANCH = TEST_BRANCH.id;
const ZONE = TEST_BRANCH.timezone;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'rv-1',
    branchId: BRANCH,
    displayNumber: 'R-0001',
    receptionStatus: 'opened',
    origin: 'walk_in',
    vehicleId: 'veh-9',
    vehicleDisplayNumber: 'V-9',
    custodyAcceptedAt: '2026-08-13T07:00:00.000Z',
    custodyReleasedAt: null,
    recordVersion: 3,
    ...over,
  };
}

function page(rows: readonly unknown[], over: Record<string, unknown> = {}) {
  return {
    status: 'ok' as const,
    rows,
    nextCursor: over['hasMore'] ? 'c1' : null,
    hasMore: false,
    correlationId: 'corr',
    ...over,
  };
}

function renderQueue(over: Record<string, unknown> = {}, snapshot = branchSnapshot()) {
  return renderLtr(
    inBranch(<ReceptionQueueScreen locale="en" messages={en} canCreate {...over} />, { snapshot })
  );
}

/** The scope and filters of the most recent call. */
function lastCall(): { scope: Record<string, unknown>; filters: Record<string, unknown> } {
  const call = listReceptions.mock.calls.at(-1) as [
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  return { scope: call[0], filters: call[1] };
}

/** Today's window on the branch's clock — the screen's default. */
function todayWindow(zone = ZONE) {
  const today = dayIn(zone);
  return rangeOfDays(zone, today, today);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The working branch is REMEMBERED in browser storage, keyed by workspace and
  // account. Left behind, one case's choice becomes the next case's starting
  // selection — which is the right product behaviour and the wrong test
  // isolation.
  window.localStorage.clear();
  listReceptions.mockResolvedValue(page([row()]));
});

describe('the board reads on arrival, bounded to the branch day', () => {
  it('issues exactly one read on first paint, for today in the branch timezone', async () => {
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));
    const { scope, filters } = lastCall();
    expect(scope).toEqual({ companyId: COMPANY, branchId: BRANCH });
    expect(filters).toEqual(todayWindow());
  });

  it('says which period it is showing', async () => {
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    expect(screen.getByTestId('reception-period-label')).toHaveTextContent(
      EN['receptions.queue.period.today'] as string
    );
  });

  it('renders the rows it was answered with', async () => {
    renderQueue();
    expect(await screen.findByText('R-0001')).toBeVisible();
    expect(screen.getByText(EN['receptions.queue.custodyHeld'] as string)).toBeVisible();
  });

  it('asks nothing at all while no branch is chosen, and says which control answers', async () => {
    const second = { ...TEST_BRANCH, id: '55555555-5555-4555-8555-555555555555', name: 'Second' };
    renderQueue({}, branchSnapshot([TEST_BRANCH, second]));
    expect(screen.getByTestId('requires-concrete-branch')).toHaveTextContent(
      EN['workingContext.chooseFirst'] as string
    );
    // Nothing is addressed, so nothing may be read. Waited out rather than
    // asserted synchronously, so a debounce cannot hide a request.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(listReceptions).not.toHaveBeenCalled();
  });
});

describe('the period control', () => {
  it('reads yesterday when yesterday is chosen', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole('button', { name: EN['receptions.queue.period.yesterday'] as string })
    );
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(2));
    const yesterday = addDays(dayIn(ZONE), -1);
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, yesterday, yesterday));
  });

  it('reads seven days INCLUDING today for "last 7 days"', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole('button', { name: EN['receptions.queue.period.last7'] as string })
    );
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(2));
    const today = dayIn(ZONE);
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, addDays(today, -6), today));
  });

  it('sends only an upper bound for "before today", so the oldest visits are not hidden', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole('button', { name: EN['receptions.queue.period.beforeToday'] as string })
    );
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(2));
    expect(lastCall().filters).toEqual({ to: startOfDay(ZONE, dayIn(ZONE)).toISOString() });
    // A lower bound would be a beginning nobody named.
    expect(lastCall().filters['from']).toBeUndefined();
  });

  it('refuses an inverted custom range at the field, and issues no request for it', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));
    listReceptions.mockClear();

    await user.click(
      screen.getByRole('button', { name: EN['receptions.queue.period.custom'] as string })
    );
    const from = screen.getByLabelText(EN['receptions.queue.fromDay'] as string, { exact: false });
    const to = screen.getByLabelText(EN['receptions.queue.toDay'] as string, { exact: false });
    await user.type(from, '2026-09-10');
    await user.type(to, '2026-09-01');
    await user.click(
      screen.getByRole('button', { name: EN['receptions.queue.applyPeriod'] as string })
    );

    expect(await screen.findByText(EN['receptions.queue.invertedRange'] as string)).toBeVisible();
    // The control itself is marked, not only a sentence beside it — that is what
    // assistive technology announces and what focus-first-invalid finds.
    expect(to).toHaveAttribute('aria-invalid', 'true');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(listReceptions).not.toHaveBeenCalled();
  });

  it('clears the complaint when the operator corrects the date, without a second submission', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());

    await user.click(
      screen.getByRole('button', { name: EN['receptions.queue.period.custom'] as string })
    );
    const from = screen.getByLabelText(EN['receptions.queue.fromDay'] as string, { exact: false });
    const to = screen.getByLabelText(EN['receptions.queue.toDay'] as string, { exact: false });
    await user.type(from, '2026-09-10');
    await user.type(to, '2026-09-01');
    await user.click(
      screen.getByRole('button', { name: EN['receptions.queue.applyPeriod'] as string })
    );
    await screen.findByText(EN['receptions.queue.invertedRange'] as string);

    await user.clear(to);
    await user.type(to, '2026-09-12');
    expect(screen.queryByText(EN['receptions.queue.invertedRange'] as string)).toBeNull();
  });

  it('reads the chosen days once they are applied', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole('button', { name: EN['receptions.queue.period.custom'] as string })
    );
    await user.type(
      screen.getByLabelText(EN['receptions.queue.fromDay'] as string, { exact: false }),
      '2026-09-01'
    );
    await user.type(
      screen.getByLabelText(EN['receptions.queue.toDay'] as string, { exact: false }),
      '2026-09-03'
    );
    await user.click(
      screen.getByRole('button', { name: EN['receptions.queue.applyPeriod'] as string })
    );
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(2));
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, '2026-09-01', '2026-09-03'));
  });
});

describe('the status control is grouped from the graph, not from a list', () => {
  it('offers every frozen status exactly once, split into two named groups', async () => {
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    const select = screen.getByLabelText(EN['receptions.queue.statusFilter'] as string, {
      exact: false,
    });
    const values = within(select)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== '');
    expect([...values].sort()).toEqual([...RECEPTION_STATUSES].sort());

    const groups = within(select).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('label'))).toEqual([
      EN['receptions.queue.statusGroupOpen'],
      EN['receptions.queue.statusGroupFinished'],
    ]);
    expect(
      within(groups[0] as HTMLElement)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value)
    ).toEqual([...UNFINISHED_RECEPTION_STATUSES]);
    expect(
      within(groups[1] as HTMLElement)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value)
    ).toEqual([...TERMINAL_RECEPTION_STATUSES]);
  });

  it('sends the chosen status beside the period, and resets to page one', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.selectOptions(
      screen.getByLabelText(EN['receptions.queue.statusFilter'] as string, { exact: false }),
      'authorized'
    );
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(2));
    expect(lastCall().filters).toEqual({ status: 'authorized', ...todayWindow() });
    // A filter change spends a fresh cursor, never the one the previous
    // ordering issued.
    expect(listReceptions.mock.calls.at(-1)?.[3]).toBeNull();
  });
});

describe('the one search box', () => {
  it('sends a settled term as typed, beside the period', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(EN['receptions.queue.searchLabel'] as string), 'ABC-12');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(lastCall().filters['q']).toBe('ABC-12'));
    expect(lastCall().filters).toEqual({ q: 'ABC-12', ...todayWindow() });
  });

  it('refuses a one-character term at the box and does not send it', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(EN['receptions.queue.searchLabel'] as string), 'A');
    expect(await screen.findByText(EN['receptions.queue.searchTooShort'] as string)).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 350));
    for (const call of listReceptions.mock.calls) {
      expect((call[1] as Record<string, unknown>)['q']).toBeUndefined();
    }
  });

  it('accepts digits typed on an Arabic keyboard and sends them as typed', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(EN['receptions.queue.searchLabel'] as string), '١٢٣');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(lastCall().filters['q']).toBe('١٢٣'));
  });
});

describe('every non-answer reads as itself', () => {
  it('renders a refusal as a refusal, never as an empty board', async () => {
    listReceptions.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-403',
    });
    renderQueue();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['state.noResults.title'] as string)).toBeNull();
  });

  it('offers a retry and the reference on an outage', async () => {
    listReceptions.mockResolvedValue({
      status: 'unavailable',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-429',
    });
    renderQueue();
    expect(await screen.findByText(EN['state.unavailable.title'] as string)).toBeVisible();
    expect(screen.getByText('corr-429', { exact: false })).toBeVisible();
    expect(screen.getByRole('button', { name: EN['state.retry'] as string })).toBeVisible();
  });

  it('states no matches only after an answer, and offers a way back only after a search', async () => {
    const user = userEvent.setup();
    listReceptions.mockResolvedValue(page([]));
    renderQueue();
    expect(await screen.findByText(EN['state.noResults.title'] as string)).toBeVisible();
    // Nothing was searched for, so there is no over-narrow term to clear.
    expect(
      screen.queryByRole('button', { name: EN['receptions.queue.clearFilters'] as string })
    ).toBeNull();

    await user.type(screen.getByLabelText(EN['receptions.queue.searchLabel'] as string), 'zz');
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('button', { name: EN['receptions.queue.clearFilters'] as string })
    ).toBeVisible();
  });

  it('invents no total, and offers Next only while the server says more exists', async () => {
    renderQueue();
    await screen.findByText('R-0001');
    expect(screen.getByRole('button', { name: EN['table.nextPage'] as string })).toBeDisabled();
    expect(screen.getByText(EN['receptions.queue.orderingNote'] as string)).toBeVisible();
  });

  it('renders an unnumbered visit as unnumbered, never as its identifier', async () => {
    listReceptions.mockResolvedValue(page([row({ displayNumber: null })]));
    const { container } = renderQueue();
    expect(
      await screen.findByText(EN['receptions.queue.column.noReference'] as string)
    ).toBeVisible();
    expect(container.textContent).not.toContain('rv-1');
  });
});

describe('the next action names what can be done where it lands', () => {
  it('offers to continue the check-in while the visit can still move', async () => {
    renderQueue();
    const link = await screen.findByRole('link', {
      name: EN['receptions.queue.continueCheckIn'] as string,
    });
    expect(link).toHaveAttribute('href', '/en/receptions/check-in/rv-1');
  });

  it('offers to open the record once the visit is finished', async () => {
    listReceptions.mockResolvedValue(page([row({ receptionStatus: 'converted' })]));
    renderQueue();
    const link = await screen.findByRole('link', { name: EN['receptions.queue.open'] as string });
    expect(link).toHaveAttribute('href', '/en/receptions/check-in/rv-1');
    expect(
      screen.queryByRole('link', { name: EN['receptions.queue.continueCheckIn'] as string })
    ).toBeNull();
  });

  it('leads to the visit rather than closing from the board', async () => {
    /*
     * QA-004, and the claim outlived the control that carried it.
     *
     * It used to be asserted on a link labelled "Open the visit to end it",
     * which the terminal-exit affordance rendered per row. That affordance is
     * gone with the Show button, and the rule it stood for is not: a board
     * row's `recordVersion` is a snapshot of whenever the page was fetched, and
     * committing an `If-Match` write against it would answer 409 for any
     * operator who left the board open. So the next action NAVIGATES — to the
     * visit, whose own read supplies the version the guarded command needs —
     * and no reception write is reachable from this board at all.
     */
    listReceptions.mockResolvedValue(page([row({ receptionStatus: 'authorized' })]));
    renderQueue();
    const next = await screen.findByRole('link', {
      name: EN['receptions.queue.continueCheckIn'] as string,
    });
    expect(next).toHaveAttribute('href', '/en/receptions/check-in/rv-1');
    // Nothing on the board commits anything: every row action is a link.
    const table = screen.getByRole('table');
    expect(within(table).queryAllByRole('button')).toEqual([]);
  });

  it('links every row to its acknowledgement', async () => {
    renderQueue();
    expect(
      await screen.findByRole('link', { name: EN['receptions.queue.acknowledgement'] as string })
    ).toHaveAttribute('href', '/en/receptions/check-in/rv-1/acknowledgement');
  });

  it('offers the walk-in desk only to somebody who may open it', async () => {
    renderQueue({ canReachIntake: true });
    expect(
      await screen.findByRole('link', { name: EN['receptions.queue.newCustomer'] as string })
    ).toHaveAttribute('href', '/en/reception/walk-in');

    renderQueue({ canReachIntake: false });
    expect(
      screen.getAllByRole('link', { name: EN['receptions.queue.newCustomer'] as string }).length
    ).toBe(1);
  });

  it('offers the check-in link only to an operator who may open a visit', async () => {
    renderQueue({ canCreate: false });
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    expect(
      screen.queryByRole('link', { name: EN['receptions.queue.checkInVehicle'] as string })
    ).toBeNull();
  });
});

describe('a branch changed in the header re-targets the board', () => {
  it('reads the NEW branch at once and drops the previous branch rows', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <ReceptionQueueScreen locale="en" messages={en} canCreate />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );

    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: TEST_BRANCH.id });
    expect(await screen.findByText('R-0001')).toBeVisible();

    listReceptions.mockClear();
    listReceptions.mockResolvedValue(
      page([row({ branchId: OTHER_BRANCH.id, displayNumber: 'R-0002' })])
    );
    await user.click(screen.getByRole('button', { name: 'use second' }));

    await waitFor(() =>
      expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: OTHER_BRANCH.id })
    );
    expect(await screen.findByText('R-0002')).toBeVisible();
    expect(screen.queryByText('R-0001')).toBeNull();
  });

  it('reads every branch of the company, and names the branch of each row, on all my branches', async () => {
    const user = userEvent.setup();
    listReceptions.mockResolvedValue(
      page([row({ branchId: OTHER_BRANCH.id, displayNumber: 'R-0003' })])
    );
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to="all" label="use all" />
          <ReceptionQueueScreen locale="en" messages={en} canCreate />
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
    expect(screen.getByTestId('reception-period-label')).toHaveTextContent(TEST_BRANCH.name);
  });
});

describe('both directions', () => {
  it('renders in Arabic, right to left, and reads on arrival there too', async () => {
    renderRtl(
      inBranch(<ReceptionQueueScreen locale="ar" messages={ar} canCreate />, { locale: 'ar' })
    );
    expect(await screen.findByText(AR['receptions.queue.custodyHeld'] as string)).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      screen.getByRole('button', { name: AR['receptions.queue.period.today'] as string })
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

/**
 * The day boundary, pinned to instants computed by hand.
 *
 * Asia/Riyadh is UTC+3 with no daylight saving, so its midnight is 21:00 UTC the
 * previous day, always. Europe/Amman moved to permanent UTC+3 in 2022, so it
 * agrees — which is why the second zone is Europe/London, whose offset CHANGES:
 * the whole point of the two-pass correction in `startOfDay` is a day whose
 * midnight offset differs from the offset at the guessed instant.
 */
describe('the day the board asks about is the day at the branch', () => {
  it('puts midnight in Asia/Riyadh three hours before midnight in UTC', () => {
    expect(startOfDay('Asia/Riyadh', '2026-09-22').toISOString()).toBe('2026-09-21T21:00:00.000Z');
    expect(endOfDay('Asia/Riyadh', '2026-09-22').toISOString()).toBe('2026-09-22T20:59:59.999Z');
  });

  it('follows a summer-time offset rather than assuming a fixed one', () => {
    // British Summer Time: UTC+1 in September, UTC+0 in January.
    expect(startOfDay('Europe/London', '2026-09-22').toISOString()).toBe(
      '2026-09-21T23:00:00.000Z'
    );
    expect(startOfDay('Europe/London', '2026-01-15').toISOString()).toBe(
      '2026-01-15T00:00:00.000Z'
    );
  });

  it('crosses the spring transition without losing or inventing an hour', () => {
    // 2026-03-29 is the day the United Kingdom springs forward at 01:00 UTC, so
    // midnight that morning is still UTC+0 and the day is 23 hours long.
    expect(startOfDay('Europe/London', '2026-03-29').toISOString()).toBe(
      '2026-03-29T00:00:00.000Z'
    );
    expect(endOfDay('Europe/London', '2026-03-29').toISOString()).toBe('2026-03-29T22:59:59.999Z');
  });

  it('reads the calendar day a zone is on at an instant', () => {
    // 23:30 UTC is already the next day in Riyadh and still the same day in
    // London — the exact disagreement a browser-clock board would get wrong.
    const instant = new Date('2026-09-22T23:30:00.000Z');
    expect(dayIn('Asia/Riyadh', instant)).toBe('2026-09-23');
    expect(dayIn('Europe/London', instant)).toBe('2026-09-23');
    const morning = new Date('2026-09-22T00:30:00.000Z');
    expect(dayIn('Asia/Riyadh', morning)).toBe('2026-09-22');
    expect(dayIn('Europe/London', morning)).toBe('2026-09-22');
  });

  it('moves whole calendar days, not fixed spans of milliseconds', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});
