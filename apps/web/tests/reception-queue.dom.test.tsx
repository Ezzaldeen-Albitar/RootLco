import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
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
import { z } from 'zod';
import {
  addDays,
  dayIn,
  endOfDay,
  endOfDayBound,
  rangeOfDays,
  startOfDay,
} from '@/lib/branch-time';

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
 * ## On the Material UI wrappers (ADR-022)
 *
 * The board renders `FilterToolbar`, `OperationalGrid` and `MuiSearchStates`,
 * so the cases find it by role and by label: the period is a named group of
 * pressed buttons, the chosen days are two date groups, the rows are a `grid`,
 * and each row action is a link whose name starts with its label and ends with
 * the visit number (read only by assistive technology). Every case mounts the
 * board inside the product's Material provider, exactly as the locale layout
 * does, so the date pickers and the Arabic texts are the real ones.
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
vi.mock('@/features/receptions/reception-list-read', () => ({
  listReceptionsCancellable: (...args: unknown[]) => listReceptions(...args),
}));

/**
 * The session the ROUTE resolves, so the address cases at the end of this file
 * can invoke it. The screen cases render the board directly and never see it.
 */
let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    permissions: PERMISSIONS,
    email: 'operator@test.local',
    companyIds: [],
    branchIds: [],
  }),
}));

/** The props one element in a route's returned tree carries. */
function propsCarrying(node: unknown, prop: string): Record<string, unknown> | null {
  if (node === null || typeof node !== 'object') return null;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props && typeof props === 'object' && prop in props) return props;
  const children = props?.['children'];
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = propsCarrying(child, prop);
    if (found) return found;
  }
  return null;
}

const { ReceptionQueueScreen, boardClock } =
  await import('@/features/receptions/components/ReceptionQueueScreen');
const ReceptionQueuePage = (await import('@/app/[locale]/(dashboard)/receptions/page'))
  .default as (args: {
  params: Promise<Record<string, string>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<unknown>;

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
    customer: { id: 'partner-1', displayName: 'A recorded customer' },
    plate: 'ABC-1234',
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

/** The product's Material provider, as the locale layout mounts it. */
function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

function renderQueue(over: Record<string, unknown> = {}, snapshot = branchSnapshot()) {
  return renderLtr(
    withMui(
      inBranch(<ReceptionQueueScreen locale="en" messages={en} canCreate {...over} />, {
        snapshot,
      })
    )
  );
}

/** The board's summary line: the period in words and the clock it is counted on. */
function summary(): HTMLElement {
  return screen.getByTestId('reception-queue-toolbar-summary');
}

/** A period preset, by the words on it. */
function preset(kind: 'today' | 'yesterday' | 'last7' | 'beforeToday' | 'custom'): HTMLElement {
  return screen.getByRole('button', { name: EN[`filters.period.${kind}`] as string });
}

/** Types a day into one of the two chosen-day boxes, one section at a time. */
async function typeDay(user: ReturnType<typeof userEvent.setup>, label: string, digits: string) {
  const group = screen.getByRole('group', { name: new RegExp(`^${label}`) });
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard(digits);
  return group;
}

/** A row action, by the label it starts with (the visit number follows, unseen). */
function rowLink(key: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(`^${EN[key] as string}`) });
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

  it('says which period it is showing, and on which clock (QA 3.1)', async () => {
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    expect(summary()).toHaveTextContent(EN['receptions.queue.period.today'] as string);
    // The board states its zone itself, as the work-order board and the
    // dashboard do — a reader on another clock is not left to assume theirs.
    expect(summary()).toHaveTextContent(`Days and times follow the clock in ${ZONE}.`);
  });

  it('renders the rows it was answered with', async () => {
    renderQueue();
    expect(await screen.findByText('R-0001', { selector: 'code' })).toBeVisible();
    expect(screen.getByText(EN['receptions.queue.custodyHeld'] as string)).toBeVisible();
  });

  it('asks nothing at all while no branch is chosen, and says which control answers', async () => {
    const second = { ...TEST_BRANCH, id: '55555555-5555-4555-8555-555555555555', name: 'Second' };
    renderQueue({}, branchSnapshot([TEST_BRANCH, second]));
    expect(screen.getByTestId('requires-concrete-branch')).toHaveTextContent(
      EN['workingContext.chooseBranchHere'] as string
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

    await user.click(preset('yesterday'));
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(2));
    const yesterday = addDays(dayIn(ZONE), -1);
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, yesterday, yesterday));
  });

  it('reads seven days INCLUDING today for "last 7 days"', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.click(preset('last7'));
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(2));
    const today = dayIn(ZONE);
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, addDays(today, -6), today));
  });

  it('ends "before today" at the LAST instant of yesterday, not the first of today', async () => {
    /*
     * The API compares `custody_accepted_at <= to`, closed on both ends. Sending
     * the start of today satisfies that comparison, so a car received at
     * midnight — or any row the database stamped exactly on the boundary —
     * appeared on a board headed "before today". One millisecond, one wrong row,
     * and no way for the operator to tell.
     */
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.click(preset('beforeToday'));
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(2));

    const yesterday = addDays(dayIn(ZONE), -1);
    expect(lastCall().filters).toEqual({ to: endOfDayBound(ZONE, yesterday) });
    // The boundary itself, stated: the last MICROSECOND of yesterday on the
    // branch's clock (the database keeps microseconds), which a millisecond
    // clock reads as one millisecond before today begins.
    expect(lastCall().filters['to']).toBe(`${yesterday}T23:59:59.999999+03:00`);
    expect(new Date(lastCall().filters['to'] as string).getTime()).toBe(
      startOfDay(ZONE, dayIn(ZONE)).getTime() - 1
    );
    // A lower bound would be a beginning nobody named.
    expect(lastCall().filters['from']).toBeUndefined();
  });

  it('refuses an inverted custom range at the field, and issues no request for it', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));
    listReceptions.mockClear();

    await user.click(preset('custom'));
    await typeDay(user, EN['filters.period.from'] as string, '10092026');
    const to = await typeDay(user, EN['filters.period.to'] as string, '01092026');
    await user.click(screen.getByRole('button', { name: EN['filters.period.apply'] as string }));

    expect(await screen.findByText(EN['filters.period.inverted'] as string)).toBeVisible();
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

    await user.click(preset('custom'));
    await typeDay(user, EN['filters.period.from'] as string, '10092026');
    await typeDay(user, EN['filters.period.to'] as string, '01092026');
    await user.click(screen.getByRole('button', { name: EN['filters.period.apply'] as string }));
    await screen.findByText(EN['filters.period.inverted'] as string);

    await typeDay(user, EN['filters.period.to'] as string, '12092026');
    await waitFor(() =>
      expect(screen.queryByText(EN['filters.period.inverted'] as string)).toBeNull()
    );
  });

  it('reads the chosen days once they are applied', async () => {
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.click(preset('custom'));
    // Nothing is asked for until the two days are applied, and the toolbar says
    // the list still covers the period in force.
    expect(screen.getByRole('status')).toHaveTextContent(
      (EN['filters.period.notApplied'] as string).replace(
        '{period}',
        EN['filters.period.today'] as string
      )
    );
    await typeDay(user, EN['filters.period.from'] as string, '01092026');
    await typeDay(user, EN['filters.period.to'] as string, '03092026');
    expect(listReceptions).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: EN['filters.period.apply'] as string }));
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(2));
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, '2026-09-01', '2026-09-03'));
    // The summary names the two days on the branch clock, not the preset.
    expect(summary()).not.toHaveTextContent(EN['receptions.queue.period.today'] as string);
  });
});

describe('the status control is grouped from the graph, not from a list', () => {
  it('offers every frozen status exactly once, split into two named groups', async () => {
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    const select = screen.getByLabelText(EN['receptions.queue.statusFilter'] as string, {
      exact: false,
    });
    // The two whole-group answers sit above the codes and are asserted by their
    // own case; this one is about the six codes the frozen graph defines.
    const values = within(select)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== '' && !value.startsWith('group:'));
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

describe('what is still with us from before today is ONE button', () => {
  it('sends the open GROUP with an upper bound, in one request', async () => {
    /*
     * It was two controls used together, because `status` took one code at a
     * time and the set of unfinished statuses could not be sent. `statusGroup`
     * is that set, so the question is one request again.
     */
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole('button', { name: EN['receptions.queue.olderUnfinished'] as string })
    );
    const yesterday = addDays(dayIn(ZONE), -1);
    await waitFor(() =>
      expect(lastCall().filters).toEqual({
        statusGroup: 'open',
        to: endOfDayBound(ZONE, yesterday),
      })
    );
  });

  it('never sends a status code beside a status group', async () => {
    /*
     * The route answers 422 `status_and_group_exclusive` rather than
     * intersecting them. One control holds either answer, so the pair is not a
     * state the screen can be in.
     */
    const user = userEvent.setup();
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));

    const select = screen.getByLabelText(EN['receptions.queue.statusFilter'] as string, {
      exact: false,
    });
    await user.selectOptions(select, 'group:finished');
    await waitFor(() => expect(lastCall().filters['statusGroup']).toBe('finished'));
    await user.selectOptions(select, 'authorized');
    await waitFor(() => expect(lastCall().filters['status']).toBe('authorized'));

    for (const call of listReceptions.mock.calls) {
      const filters = call[1] as Record<string, unknown>;
      expect(
        filters['status'] !== undefined && filters['statusGroup'] !== undefined,
        'a code and a group travelled together'
      ).toBe(false);
    }
  });

  it('offers both whole groups above the six codes, from the graph', async () => {
    renderQueue();
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    const select = screen.getByLabelText(EN['receptions.queue.statusFilter'] as string, {
      exact: false,
    });
    const values = within(select)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== '');
    expect(values.slice(0, 2)).toEqual(['group:open', 'group:finished']);
    expect([...values.slice(2)].sort()).toEqual([...RECEPTION_STATUSES].sort());
  });
});

describe('the customer and the plate', () => {
  it('names the customer and shows the plate the car carries today', async () => {
    renderQueue();
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByText('A recorded customer')).toBeVisible();
    expect(within(grid).getByText('ABC-1234')).toBeVisible();
  });

  it('tells three absences apart rather than rendering one blank', async () => {
    listReceptions.mockResolvedValue(
      page([
        row({ id: 'a', displayNumber: 'R-1', customer: null, plate: null }),
        row({
          id: 'b',
          displayNumber: 'R-2',
          customer: { id: 'partner-2', displayName: null },
          plate: 'XYZ-9',
        }),
      ])
    );
    const { container } = renderQueue();
    // A visit that names no service requester yet — permitted by the platform.
    expect(
      await screen.findByText(EN['receptions.queue.column.noCustomer'] as string)
    ).toBeVisible();
    // A visit that HAS one, read by somebody who may not see who. Said in
    // words, never as the identifier.
    expect(screen.getByText(EN['receptions.queue.column.customerHidden'] as string)).toBeVisible();
    expect(container.textContent ?? '').not.toContain('partner-2');
    // A registered vehicle carrying no plate.
    expect(screen.getByText(EN['receptions.queue.column.noPlate'] as string)).toBeVisible();
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
  it('renders an ENDED SESSION as itself, with the way back and no Try-again', async () => {
    listReceptions.mockResolvedValue({
      status: 'expired',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: null,
    });
    renderQueue();
    expect(await screen.findByText(EN['state.expired.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['state.error.title'] as string)).toBeNull();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
    expect(screen.getByRole('link', { name: EN['auth.backToLogin'] as string })).toHaveAttribute(
      'href',
      '/en/login'
    );
  });

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

  it('says what narrowed an empty board: the period and status, or the term', async () => {
    const user = userEvent.setup();
    listReceptions.mockResolvedValue(page([]));
    renderQueue();
    // No term: the period (and any status) narrowed it, and the sentence says
    // a filter can be cleared.
    expect(await screen.findByText(EN['state.noResults.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['state.noSearchMatches.title'] as string)).toBeNull();

    await user.type(screen.getByLabelText(EN['receptions.queue.searchLabel'] as string), 'zz');
    await user.keyboard('{Enter}');
    // A term: the search matched nothing, said as such.
    expect(await screen.findByText(EN['state.noSearchMatches.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['state.noResults.title'] as string)).toBeNull();
  });

  it('never reads a withheld search as an empty board (QA 2.8)', async () => {
    /*
     * The reception read matches a term on a customer's name and phone only for
     * a caller who may read customers. The front desk searched a phone number
     * and was told "No records match the current filters" — a withheld detail
     * reading as "nothing exists". An account that cannot search those details
     * is told so, and told what it can search by instead.
     */
    const user = userEvent.setup();
    listReceptions.mockResolvedValue(page([]));
    renderQueue({ searchesCustomers: false });
    await screen.findByText(EN['state.noResults.title'] as string);

    await user.type(
      screen.getByLabelText(EN['receptions.queue.searchLabel'] as string),
      '0797001122'
    );
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText(EN['state.noSearchMatchesLimited.title'] as string)
    ).toBeVisible();
    expect(
      screen.getByText(EN['state.noSearchMatchesLimited.description'] as string)
    ).toBeVisible();
    expect(screen.queryByText(EN['state.noResults.title'] as string)).toBeNull();
    expect(screen.queryByText(EN['state.noSearchMatches.title'] as string)).toBeNull();
    // The term still travelled as typed: the narrowing is the server's.
    expect(lastCall().filters['q']).toBe('0797001122');
  });

  it('offers the way back for a PERIOD that matched nothing, with no term typed', async () => {
    /*
     * The offer used to be made only for a searchable term, which left the
     * commonest empty board of all with no way out: a period or a status that
     * happens to match nothing today is not something the operator typed, and
     * undoing it by hand means remembering which of four controls they moved.
     * Clear is offered whenever pressing it would change the question.
     */
    const user = userEvent.setup();
    listReceptions.mockResolvedValue(page([]));
    renderQueue();
    expect(await screen.findByText(EN['state.noResults.title'] as string)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: EN['receptions.queue.clearFilters'] as string })
    ).toBeNull();

    await user.click(preset('yesterday'));
    const clear = await screen.findByRole('button', {
      name: EN['receptions.queue.clearFilters'] as string,
    });
    expect(clear).toBeVisible();

    // And pressing it really does put every control back, so the offer is not
    // a button that says the board is already clear.
    await user.click(clear);
    await waitFor(() => expect(preset('today')).toHaveAttribute('aria-pressed', 'true'));
    expect(
      screen.queryByRole('button', { name: EN['receptions.queue.clearFilters'] as string })
    ).toBeNull();
  });

  it('names the period buttons as one group rather than five loose toggles', () => {
    /*
     * Without the role a screen reader announces five unrelated toggles, so the
     * operator hears "Today, pressed" with nothing saying today WHAT.
     */
    renderQueue();
    const group = screen.getByRole('group', {
      name: EN['filters.period.legend'] as string,
    });
    for (const kind of ['today', 'yesterday', 'last7', 'beforeToday', 'custom']) {
      expect(
        within(group).getByRole('button', {
          name: EN[`filters.period.${kind}`] as string,
        })
      ).toBeVisible();
    }
  });

  it('offers the way back while the box holds only spaces', async () => {
    // A term of spaces is not searched for, but it is text the operator can see
    // in the box — and a board with no Clear leaves them to find it by hand.
    const user = userEvent.setup();
    listReceptions.mockResolvedValue(page([]));
    renderQueue();
    expect(await screen.findByText(EN['state.noResults.title'] as string)).toBeVisible();
    const box = screen.getByLabelText(EN['receptions.queue.searchLabel'] as string);

    await user.type(box, '   ');
    const clear = await screen.findByRole('button', {
      name: EN['receptions.queue.clearFilters'] as string,
    });
    await user.click(clear);
    await waitFor(() => expect(box).toHaveValue(''));
    expect(
      screen.queryByRole('button', { name: EN['receptions.queue.clearFilters'] as string })
    ).toBeNull();
  });

  it('invents no total, and offers Next only while the server says more exists', async () => {
    renderQueue();
    await screen.findByText('R-0001', { selector: 'code' });
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
    await screen.findByRole('grid');
    const link = rowLink('receptions.queue.continueCheckIn');
    expect(link).toHaveAttribute('href', '/en/receptions/check-in/rv-1');
    // Ten rows of the same label are ten different controls to a screen reader.
    expect(link).toHaveAccessibleName(`${EN['receptions.queue.continueCheckIn'] as string} R-0001`);
  });

  it('offers to open the record once the visit is finished', async () => {
    listReceptions.mockResolvedValue(page([row({ receptionStatus: 'converted' })]));
    renderQueue();
    await screen.findByRole('grid');
    const link = rowLink('receptions.queue.open');
    expect(link).toHaveAttribute('href', '/en/receptions/check-in/rv-1');
    expect(
      screen.queryByRole('link', {
        name: new RegExp(`^${EN['receptions.queue.continueCheckIn'] as string}`),
      })
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
    const grid = await screen.findByRole('grid');
    const next = rowLink('receptions.queue.continueCheckIn');
    expect(next).toHaveAttribute('href', '/en/receptions/check-in/rv-1');
    // Nothing on the board commits anything: every row action is a link.
    expect(within(grid).queryAllByRole('button')).toEqual([]);
  });

  it('links every row to its acknowledgement', async () => {
    renderQueue();
    await screen.findByRole('grid');
    expect(rowLink('receptions.queue.acknowledgement')).toHaveAttribute(
      'href',
      '/en/receptions/check-in/rv-1/acknowledgement'
    );
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
      withMui(
        inBranch(
          <>
            <BranchSwitch to={TEST_BRANCH.id} label="use main" />
            <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
            <ReceptionQueueScreen locale="en" messages={en} canCreate />
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
        )
      )
    );

    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: TEST_BRANCH.id });
    expect(await screen.findByText('R-0001', { selector: 'code' })).toBeVisible();

    listReceptions.mockClear();
    listReceptions.mockResolvedValue(
      page([row({ branchId: OTHER_BRANCH.id, displayNumber: 'R-0002' })])
    );
    await user.click(screen.getByRole('button', { name: 'use second' }));

    await waitFor(() =>
      expect(lastCall().scope).toEqual({ companyId: COMPANY, branchId: OTHER_BRANCH.id })
    );
    expect(await screen.findByText('R-0002', { selector: 'code' })).toBeVisible();
    expect(screen.queryByText('R-0001')).toBeNull();
  });

  it('issues NO read for the branch it just left', async () => {
    /*
     * The criteria are derived from the working context during render, so they
     * are the new branch's the moment the header moves. The key the hook
     * FETCHED was the DEBOUNCED one and `version` was not debounced, so the
     * request that went out carried the previous branch's criteria at the new
     * version — one whole read for the branch the operator had just left,
     * rendered under the new branch's heading until the debounce caught up.
     *
     * Asserted over every call, not the last: a superseded read still happened.
     */
    const user = userEvent.setup();
    renderLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to={TEST_BRANCH.id} label="use main" />
            <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
            <ReceptionQueueScreen locale="en" messages={en} canCreate />
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
        )
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());

    listReceptions.mockClear();
    await user.click(screen.getByRole('button', { name: 'use second' }));
    await waitFor(() => expect(listReceptions).toHaveBeenCalled());
    // Waited past the debounce, so a late read for the old branch would have
    // landed by now.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const branches = listReceptions.mock.calls.map(
      (call) => (call[0] as { branchId: string | null }).branchId
    );
    expect(branches).not.toContain(TEST_BRANCH.id);
    expect(branches).toContain(OTHER_BRANCH.id);
  });

  it('reads every branch of the company, and names the branch of each row, on all my branches', async () => {
    const user = userEvent.setup();
    listReceptions.mockResolvedValue(
      page([row({ branchId: OTHER_BRANCH.id, displayNumber: 'R-0003' })])
    );
    renderLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to="all" label="use all" />
            <ReceptionQueueScreen locale="en" messages={en} canCreate />
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
    expect(await screen.findByText(OTHER_BRANCH.name)).toBeVisible();
    // And the summary names the branch whose clock the day was counted on,
    // because several branches have no single one — and the zone itself.
    expect(summary()).toHaveTextContent(
      `${EN['receptions.queue.periodZoneOfFirstBranch'] as string} ${TEST_BRANCH.name}`
    );
    expect(summary()).toHaveTextContent(
      `Days and times follow the clock in ${TEST_BRANCH.timezone}.`
    );
    // The union is named as such where the branch is stated.
    expect(screen.getByTestId('working-branch-field-all')).toHaveTextContent(
      `${EN['workingContext.allBranches'] as string} · ${TEST_COMPANY.name}`
    );
  });

  it('draws the branch column only while the board spans branches', async () => {
    const user = userEvent.setup();
    const header = () =>
      screen.queryByRole('columnheader', {
        name: EN['receptions.queue.column.branch'] as string,
      });
    renderLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to={TEST_BRANCH.id} label="use main" />
            <BranchSwitch to="all" label="use all" />
            <ReceptionQueueScreen locale="en" messages={en} canCreate />
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
        )
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await screen.findByRole('grid');
    // One branch: every row is that branch's, so the column is not there at all.
    expect(header()).toBeNull();
    expect(screen.queryByText(TEST_BRANCH.name, { selector: '[role="gridcell"] *' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'use all' }));
    await waitFor(() => expect(header()).not.toBeNull());
  });

  it('asks nothing, and says why, when all my branches span two companies', async () => {
    const user = userEvent.setup();
    const elsewhere = { ...OTHER_BRANCH, companyId: '99999999-9999-4999-8999-999999999999' };
    renderLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to="all" label="use all" />
            <ReceptionQueueScreen locale="en" messages={en} canCreate />
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, elsewhere]) }
        )
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));
    expect(await screen.findByTestId('reception-queue-spans-companies')).toHaveTextContent(
      EN['workingContext.spansCompanies'] as string
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(listReceptions).not.toHaveBeenCalled();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('renders a branch it cannot name as an absence, never as an empty cell', async () => {
    // The directory no longer publishes it — revoked between the read and the
    // render. An empty cell reads as a rendering fault.
    const user = userEvent.setup();
    listReceptions.mockResolvedValue(
      page([row({ branchId: '99999999-9999-4999-8999-999999999999' })])
    );
    renderLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to="all" label="use all" />
            <ReceptionQueueScreen locale="en" messages={en} canCreate />
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
        )
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));
    const grid = await screen.findByRole('grid');
    expect(within(grid).getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('both directions', () => {
  it('renders in Arabic, right to left, and reads on arrival there too', async () => {
    renderRtl(
      withMui(
        inBranch(<ReceptionQueueScreen locale="ar" messages={ar} canCreate />, { locale: 'ar' }),
        'ar'
      )
    );
    expect(await screen.findByText(AR['receptions.queue.custodyHeld'] as string)).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      screen.getByRole('button', { name: AR['filters.period.today'] as string })
    ).toHaveAttribute('aria-pressed', 'true');
    // The summary line, the grid and the row actions speak Arabic too.
    expect(screen.getByTestId('reception-queue-toolbar-summary')).toHaveTextContent(
      (AR['receptions.queue.zoneNote'] as string).replace('{zone}', ZONE)
    );
    expect(
      screen.getByRole('grid', { name: AR['receptions.queue.caption'] as string })
    ).toBeVisible();
    expect(
      screen.getByRole('link', {
        name: new RegExp(`^${AR['receptions.queue.continueCheckIn'] as string}`),
      })
    ).toBeVisible();
    expect(screen.getByLabelText(AR['receptions.queue.searchLabel'] as string)).toBeVisible();
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

  it('sends the last instant to the microsecond, on the branch clock with its offset', () => {
    // PostgreSQL keeps timestamptz to the microsecond and the boards compare
    // `<= to`: a bound at .999 milliseconds would leave out a row stamped in
    // the last 999 microseconds of the day.
    expect(endOfDayBound('Asia/Riyadh', '2026-09-22')).toBe('2026-09-22T23:59:59.999999+03:00');
    expect(rangeOfDays('Asia/Riyadh', '2026-09-22', '2026-09-22')).toStrictEqual({
      from: '2026-09-21T21:00:00.000Z',
      to: '2026-09-22T23:59:59.999999+03:00',
    });
    // The offset is the one in force at the END of the day: after the spring
    // change in London, and back on UTC+0 after the autumn one.
    expect(endOfDayBound('Europe/London', '2026-03-29')).toBe('2026-03-29T23:59:59.999999+01:00');
    expect(endOfDayBound('Europe/London', '2026-10-25')).toBe('2026-10-25T23:59:59.999999+00:00');
    expect(endOfDayBound('America/New_York', '2026-01-15')).toBe(
      '2026-01-15T23:59:59.999999-05:00'
    );
    // The same instant as the millisecond bound, to the millisecond.
    expect(Date.parse(endOfDayBound('Europe/London', '2026-03-29'))).toBe(
      endOfDay('Europe/London', '2026-03-29').getTime()
    );
  });

  it('writes a bound the routes accept: their validator takes six fractional digits', () => {
    // The receptions, appointments and work-orders routes validate `from`/`to`
    // (and `openedTo`, `completedTo`) with exactly this schema.
    const routeInstant = z.string().datetime({ offset: true });
    for (const bound of [
      endOfDayBound('Asia/Riyadh', '2026-09-22'),
      endOfDayBound('America/New_York', '2026-03-08'),
      rangeOfDays('Europe/London', '2026-10-25', '2026-10-25').to,
    ]) {
      expect(routeInstant.safeParse(bound).success, bound).toBe(true);
    }
  });

  it('reads the calendar day a zone is on at an instant, and the two can disagree', () => {
    /*
     * The instant is chosen in JANUARY on purpose. In September London is on
     * summer time (UTC+1) and 23:30 UTC is already the next day there too, so
     * that instant proves nothing about the zone being read — it would pass
     * against a helper that ignored the zone entirely and returned the UTC day.
     *
     * At 2026-01-15T22:30Z London is on UTC+0 and still on the 15th, while
     * Riyadh is on UTC+3 and already on the 16th. That is exactly the
     * disagreement a board reading the browser's clock gets wrong.
     */
    const evening = new Date('2026-01-15T22:30:00.000Z');
    expect(dayIn('Asia/Riyadh', evening)).toBe('2026-01-16');
    expect(dayIn('Europe/London', evening)).toBe('2026-01-15');
    // And the other way at the start of a day: 21:30Z is already tomorrow in
    // Riyadh whatever the season.
    const summerEvening = new Date('2026-09-22T21:30:00.000Z');
    expect(dayIn('Asia/Riyadh', summerEvening)).toBe('2026-09-23');
    expect(dayIn('Europe/London', summerEvening)).toBe('2026-09-22');
  });

  it('moves whole calendar days, not fixed spans of milliseconds', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

/* -------------------------------------------------------------------------- *
 * Arriving from a figure counted over a period (Owner directive,
 * `P1-32-PRE-OD-UX`)
 *
 * The dashboard counts visits over a period and links here. A link that landed
 * on "today" whatever the figure covered would answer a different question from
 * the one the reader clicked, so the period travels — and is checked on arrival,
 * because an address is written by anybody.
 * -------------------------------------------------------------------------- */

describe('the reception board opens on the period the address names', () => {
  beforeEach(() => {
    PERMISSIONS = ['rec.reception.read'];
  });

  /** The props the ROUTE hands the board, for one address. */
  async function routeProps(query: Record<string, string | string[]>) {
    const tree = await ReceptionQueuePage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(query),
    });
    const props = propsCarrying(tree, 'initialPeriod');
    expect(props, 'the route did not render the board').not.toBeNull();
    return props as Record<string, unknown>;
  }

  it('passes a declared period through', async () => {
    expect((await routeProps({ period: 'last7' }))['initialPeriod']).toEqual({
      kind: 'last7',
      from: '',
      to: '',
    });
  });

  it('passes a chosen range through with both its days', async () => {
    expect(
      (await routeProps({ period: 'custom', from: '2026-09-01', to: '2026-09-10' }))[
        'initialPeriod'
      ]
    ).toEqual({ kind: 'custom', from: '2026-09-01', to: '2026-09-10' });
  });

  it('drops a period it does not declare', async () => {
    for (const period of ['last30', 'Today', 'week']) {
      expect((await routeProps({ period }))['initialPeriod']).toBeUndefined();
    }
  });

  it('drops a chosen range that is inverted, incomplete or not a calendar day', async () => {
    const bad: readonly Record<string, string>[] = [
      { period: 'custom', from: '2026-09-10', to: '2026-09-01' },
      { period: 'custom', from: '2026-09-01' },
      { period: 'custom', to: '2026-09-01' },
      { period: 'custom', from: 'yesterday', to: 'today' },
      { period: 'custom', from: '2026-9-1', to: '2026-9-10' },
      { period: 'custom' },
    ];
    for (const query of bad) {
      expect((await routeProps(query))['initialPeriod'], JSON.stringify(query)).toBeUndefined();
    }
  });

  it('reads one value from a repeated parameter rather than a list', async () => {
    expect((await routeProps({ period: ['yesterday', 'last7'] }))['initialPeriod']).toEqual({
      kind: 'yesterday',
      from: '',
      to: '',
    });
  });

  it('reads the arriving period on first paint, not today', async () => {
    const today = dayIn(ZONE);
    renderQueue({ initialPeriod: { kind: 'last7', from: '', to: '' } });
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, addDays(today, -6), today));
  });

  it('reads an arriving range, and shows its two days in the form', async () => {
    renderQueue({ initialPeriod: { kind: 'custom', from: '2026-09-01', to: '2026-09-10' } });
    await waitFor(() => expect(listReceptions).toHaveBeenCalledTimes(1));
    expect(lastCall().filters).toEqual(rangeOfDays(ZONE, '2026-09-01', '2026-09-10'));
    // The boxes agree with the list. An empty pair would invite the reader to
    // "apply" a period they never asked for.
    const shown = (label: string) =>
      (
        screen
          .getByRole('group', { name: new RegExp(`^${label}`) })
          .parentElement?.querySelector('input') as HTMLInputElement
      ).value;
    expect(shown(EN['filters.period.from'] as string)).toBe('01/09/2026');
    expect(shown(EN['filters.period.to'] as string)).toBe('10/09/2026');
    // And nothing says the list is out of step with them.
    expect(screen.queryByText(EN['filters.period.notAppliedCustom'] as string)).toBeNull();
  });
});

describe('the clock the board counts its days on', () => {
  const branches = [
    { id: TEST_BRANCH.id, name: TEST_BRANCH.name, timezone: 'Asia/Riyadh' },
    { id: OTHER_BRANCH.id, name: OTHER_BRANCH.name, timezone: 'Europe/London' },
  ];

  it('is the working branch\u2019s own zone on one branch, with no branch named', () => {
    expect(
      boardClock(
        { kind: 'ready', target: { companyId: COMPANY, branchId: OTHER_BRANCH.id } },
        branches
      )
    ).toEqual({ zone: 'Europe/London', spansBranches: false, zoneBranchName: null });
  });

  it('is the FIRST branch\u2019s zone under all my branches, and names that branch', () => {
    expect(boardClock({ kind: 'all' }, branches)).toEqual({
      zone: 'Asia/Riyadh',
      spansBranches: true,
      zoneBranchName: TEST_BRANCH.name,
    });
  });

  it('falls back to UTC when no zone is published, and says so rather than guessing', () => {
    // All my branches with an empty directory, and a working branch the
    // directory no longer lists: neither has a zone to count on.
    expect(boardClock({ kind: 'all' }, [])).toEqual({
      zone: 'UTC',
      spansBranches: true,
      zoneBranchName: null,
    });
    expect(
      boardClock(
        { kind: 'ready', target: { companyId: COMPANY, branchId: 'no-longer-listed' } },
        branches
      ).zone
    ).toBe('UTC');
  });
});
