import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
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

/*
 * The work-order board reads its state catalogue through a Server Action; only
 * that is stood in for. Its board read and its figures still go through the
 * real `browserRead` to the stubbed network below.
 */
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderCatalogue: vi.fn(async () => ({
    status: 'ok',
    data: { workOrderStates: [] },
    correlationId: null,
  })),
}));

/**
 * Cancellable reads, from the screen's side (P1-32-PRE-OD-READ).
 *
 * Nothing below mocks a read adapter. The screens and hooks run their real
 * loaders, which reach the real `browserRead`, and only the network is stood in
 * for: `fetch` is a stub that records each request's signal and answers when a
 * case says so. That is what lets a case tell the two guarantees apart:
 *
 *   - **ignored** — a superseded answer is not rendered (the hooks always did
 *     this, through a sequence number and an aborted-controller check);
 *   - **cancelled** — the superseded REQUEST's signal is aborted, so the
 *     browser closes it and the route aborts the API call behind it. Under a
 *     Server Action this was impossible; it is what the move bought.
 *
 * And "no queueing": each case issues the new request while the old one is
 * still unanswered. A Server Action would have waited for the first to settle.
 *
 * The board carries search text, so it is a POST whose parameters are a JSON
 * body and whose address is the bare route — the Owner's rule that search terms
 * never go in the URL. Its cases read the parameters from the BODY and assert
 * the address carries none. The overview figures and a customer's vehicles
 * carry identifiers only and stay a GET with a query.
 */

const EN = en as Record<string, string>;
const COMPANY = TEST_COMPANY.id;

interface Sent {
  readonly url: string;
  readonly method: string;
  /** The parameters a POST carried in its JSON body; empty for a GET. */
  readonly body: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly answer: (response: Response) => void;
  readonly fail: (error: unknown) => void;
}

let sent: Sent[] = [];

/**
 * `fetch`, standing in for the network. `honoursAbort: false` is a transport
 * that keeps going after an abort and answers late anyway — the case where only
 * the IGNORING guard stands between a stale answer and the screen.
 */
function stubNetwork({ honoursAbort = true } = {}) {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((answer, fail) => {
          const signal = init.signal as AbortSignal;
          const body =
            typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, string>) : {};
          sent.push({ url, method: init.method ?? 'GET', body, signal, answer, fail });
          if (honoursAbort) {
            signal.addEventListener('abort', () =>
              fail(new DOMException('The operation was aborted.', 'AbortError'))
            );
          }
        })
    )
  );
}

function latest(): Sent {
  const last = sent.at(-1);
  if (!last) throw new Error('no request was sent');
  return last;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-net' },
  });
}

function receptionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'rv-1',
    branchId: TEST_BRANCH.id,
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

function page(rows: readonly unknown[]) {
  return { status: 'ok', rows, nextCursor: null, hasMore: false, correlationId: 'corr-page' };
}

const { ReceptionQueueScreen } =
  await import('@/features/receptions/components/ReceptionQueueScreen');
const { WorkOrderQueueScreen } =
  await import('@/features/work-orders/components/WorkOrderQueueScreen');
const { DashboardScreen } = await import('@/features/overview/components/DashboardScreen');
const { useSearchRequest, CLIENT_READ_TIMEOUT_MS } = await import('@/lib/api/use-search-request');
const { useServerTable } = await import('@/components/data-table/use-server-table');
const { INITIAL_REQUEST } = await import('@/components/data-table/table-state');
const { listReceptionsCancellable } = await import('@/features/receptions/reception-list-read');
const { listCustomerVehiclesCancellable } = await import('@/lib/customers/vehicles-read');

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderBoard() {
  return renderLtr(
    inBranch(
      <>
        <BranchSwitch to={TEST_BRANCH.id} label="use main" />
        <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
        <ReceptionQueueScreen locale="en" messages={en} canCreate />
      </>,
      { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
    )
  );
}

describe('the reception board, on a rapid branch switch', () => {
  it('aborts the request for the branch it left and sends the new one at once', async () => {
    stubNetwork();
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() => expect(latest().body.branchId).toBe(TEST_BRANCH.id));
    const left = latest();
    // A POST to the bare route: the parameters are in the body, none in the address.
    expect(left.method).toBe('POST');
    expect(left.url).toBe('/reads/receptions');
    expect(left.signal.aborted).toBe(false);
    abort.mockClear();

    await user.click(screen.getByRole('button', { name: 'use second' }));
    await waitFor(() => expect(latest().body.branchId).toBe(OTHER_BRANCH.id));

    // CANCELLED, not only ignored: the request for the branch left behind is
    // aborted, and the controller that owned it said so.
    expect(left.signal.aborted).toBe(true);
    expect(abort).toHaveBeenCalled();
    // No queueing: the new request went out while the old one never answered.
    const current = latest();
    expect(current.signal.aborted).toBe(false);
    // Every earlier request is aborted; only the current one is live.
    expect(sent.filter((request) => !request.signal.aborted)).toEqual([current]);

    current.answer(
      json(page([receptionRow({ branchId: OTHER_BRANCH.id, displayNumber: 'R-0002' })]))
    );
    expect(await screen.findByText('R-0002', { selector: 'code' })).toBeVisible();
  });

  it('never renders the left branch’s answer, even from a transport that ignores the abort', async () => {
    stubNetwork({ honoursAbort: false });
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() => expect(latest().body.branchId).toBe(TEST_BRANCH.id));
    const left = latest();
    await user.click(screen.getByRole('button', { name: 'use second' }));
    await waitFor(() => expect(latest().body.branchId).toBe(OTHER_BRANCH.id));
    const current = latest();

    // The stale answer arrives AFTER the switch — and is ignored.
    left.answer(json(page([receptionRow({ displayNumber: 'R-STALE' })])));
    current.answer(
      json(page([receptionRow({ branchId: OTHER_BRANCH.id, displayNumber: 'R-0002' })]))
    );
    expect(await screen.findByText('R-0002', { selector: 'code' })).toBeVisible();
    expect(screen.queryByText('R-STALE')).toBeNull();
    expect(left.signal.aborted).toBe(true);
  });
});

describe('the reception board, on rapid typing', () => {
  it('aborts the search for a term typed past and asks for the new one', async () => {
    stubNetwork();
    const user = userEvent.setup();
    renderLtr(inBranch(<ReceptionQueueScreen locale="en" messages={en} canCreate />));
    const box = screen.getByLabelText(EN['receptions.queue.searchLabel'] as string);

    await user.type(box, 'Kha');
    await waitFor(() => expect(latest().body.q).toBe('Kha'));
    const typedPast = latest();
    // The term travels in the body; the address holds the route and nothing else.
    expect(typedPast.url).toBe('/reads/receptions');
    expect(typedPast.url).not.toContain('Kha');

    await user.type(box, 'l');
    await waitFor(() => expect(latest().body.q).toBe('Khal'));
    expect(sent.every((request) => !request.url.includes('?'))).toBe(true);

    expect(typedPast.signal.aborted).toBe(true);
    expect(latest().signal.aborted).toBe(false);
    expect(sent.filter((request) => !request.signal.aborted)).toHaveLength(1);
  });
});

/*
 * Browser QA part 7, row 2.6: under a 503 and under a failed request the board
 * was "still loading 12 s later", with no alert and no retry. Over the route the
 * answer is a state of its own — unavailable, with a retry that asks again.
 */
describe('the reception board, when the read cannot be answered', () => {
  it('shows unavailable, with a retry, when the route answers 503', async () => {
    stubNetwork();
    const user = userEvent.setup();
    renderLtr(inBranch(<ReceptionQueueScreen locale="en" messages={en} canCreate />));
    await waitFor(() => expect(sent).toHaveLength(1));

    latest().answer(json({ status: 'unavailable' }, 503));
    expect(await screen.findByText(EN['state.unavailable.title'] as string)).toBeVisible();
    // Not a loading state that never ends, and not "no matches".
    expect(screen.queryByText(EN['state.loading'] as string)).toBeNull();
    expect(screen.queryByText(EN['state.noResults.title'] as string)).toBeNull();

    await user.click(screen.getByRole('button', { name: EN['state.retry'] as string }));
    await waitFor(() => expect(sent).toHaveLength(2));
    latest().answer(json(page([receptionRow()])));
    expect(await screen.findByText('R-0001', { selector: 'code' })).toBeVisible();
  });

  it('shows unavailable, with a retry, when the request fails on the network', async () => {
    stubNetwork();
    renderLtr(inBranch(<ReceptionQueueScreen locale="en" messages={en} canCreate />));
    await waitFor(() => expect(sent).toHaveLength(1));

    latest().fail(new TypeError('Failed to fetch'));
    expect(await screen.findByText(EN['state.unavailable.title'] as string)).toBeVisible();
    expect(screen.getByRole('button', { name: EN['state.retry'] as string })).toBeVisible();
  });
});

describe('the overview figures, on a period change', () => {
  it('aborts the read for the period left behind', async () => {
    stubNetwork();
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={en} />));

    await waitFor(() => expect(latest().url).toContain('period=today'));
    const left = latest();
    // Identifiers and a period, nothing typed: this family stays a GET.
    expect(left.method).toBe('GET');
    expect(left.url).toMatch(/^\/reads\/dashboard-summary\?/);
    expect(left.url).toContain(`companyId=${COMPANY}`);

    await user.click(
      screen.getByRole('button', { name: EN['filters.period.yesterday'] as string })
    );
    await waitFor(() => expect(latest().url).toContain('period=yesterday'));

    expect(left.signal.aborted).toBe(true);
    expect(latest().signal.aborted).toBe(false);
  });
});

describe('a paged table, when what it lists changes', () => {
  it('aborts the page for the customer left behind (useServerTable)', async () => {
    stubNetwork();
    const first = '66666666-6666-4666-8666-666666666666';
    const second = '88888888-8888-4888-8888-888888888888';
    const { rerender } = renderHook(
      ({ customerId }: { customerId: string }) =>
        useServerTable(
          (request, cursor, signal) =>
            listCustomerVehiclesCancellable(customerId, request, cursor, signal),
          { loadKey: customerId }
        ),
      { initialProps: { customerId: first } }
    );
    await waitFor(() => expect(latest().url).toContain(`customerId=${first}`));
    const left = latest();

    rerender({ customerId: second });
    await waitFor(() => expect(latest().url).toContain(`customerId=${second}`));
    expect(left.signal.aborted).toBe(true);
    expect(latest().signal.aborted).toBe(false);
  });
});

describe('a slow or failing network still ends in a state with a way on', () => {
  const scope = { companyId: COMPANY, branchId: TEST_BRANCH.id };

  function search() {
    return renderHook(() =>
      useSearchRequest<unknown, { readonly q: string }>({
        criteria: { q: 'Kha' },
        load: async (asked, cursor, signal) => {
          const result = await listReceptionsCancellable(
            scope,
            asked,
            INITIAL_REQUEST,
            cursor,
            signal
          );
          return result.status === 'ok'
            ? {
                status: 'ok',
                data: {
                  items: result.rows,
                  nextCursor: result.nextCursor,
                  hasMore: result.hasMore,
                },
                correlationId: result.correlationId,
              }
            : { status: result.status, correlationId: result.correlationId };
        },
      })
    );
  }

  it('reads a dropped connection as unavailable, and Retry sends again', async () => {
    stubNetwork();
    const { result } = search();
    await waitFor(() => expect(sent).toHaveLength(1));
    latest().fail(new TypeError('Failed to fetch'));
    await waitFor(() => expect(result.current.phase).toBe('unavailable'));
    expect(result.current.error).toBe('state.unavailable.title');

    act(() => result.current.submit());
    await waitFor(() => expect(sent).toHaveLength(2));
    latest().answer(json(page([receptionRow()])));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
  });

  it('reads a web tier answering 503 as unavailable, not as an empty board', async () => {
    stubNetwork();
    const { result } = search();
    await waitFor(() => expect(sent).toHaveLength(1));
    latest().answer(new Response('Service Unavailable', { status: 503 }));
    await waitFor(() => expect(result.current.phase).toBe('unavailable'));
    expect(result.current.rows).toEqual([]);
  });

  it('keeps an API refusal a refusal, through the route', async () => {
    stubNetwork();
    const { result } = search();
    await waitFor(() => expect(sent).toHaveLength(1));
    latest().answer(
      json({ status: 'denied', rows: [], nextCursor: null, hasMore: false, correlationId: 'c9' })
    );
    await waitFor(() => expect(result.current.phase).toBe('refused'));
    expect(result.current.correlationId).toBe('c9');
  });

  it('gives up at the read ceiling, says unavailable, and cancels the request', async () => {
    vi.useFakeTimers();
    stubNetwork();
    const { result } = search();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sent).toHaveLength(1);
    const slow = latest();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS - 1);
    });
    expect(result.current.phase).toBe('loading');
    expect(slow.signal.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.phase).toBe('unavailable');
    expect(slow.signal.aborted).toBe(true);
  });
});

/*
 * Checkpoint browser QA: clicking Yesterday on the reception board after the
 * branch was chosen sent today's window AGAIN before yesterday's. A branch
 * choice is a submission, and leaving a submission re-read the criteria being
 * left while the new ones settled. One choice is one read.
 */
describe('the reception board, on a period choice after a branch switch', () => {
  it('sends exactly one read — yesterday’s — and never today’s window again', async () => {
    stubNetwork();
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() => expect(latest().body.branchId).toBe(TEST_BRANCH.id));
    latest().answer(json(page([receptionRow()])));
    expect(await screen.findByText('R-0001', { selector: 'code' })).toBeVisible();
    const today = latest().body;
    const before = sent.length;

    await user.click(
      screen.getByRole('button', { name: EN['filters.period.yesterday'] as string })
    );
    await waitFor(() => expect(sent.length).toBe(before + 1));
    // Past the pause, and nothing more goes out.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(sent.length).toBe(before + 1);
    const yesterday = latest().body;
    expect(yesterday.branchId).toBe(TEST_BRANCH.id);
    expect(yesterday).not.toEqual(today);
  });
});

/*
 * Checkpoint browser QA: a search on the work-order board drew 429s in pairs
 * 50 ms apart. The term settled and was read, and Enter then asked for the
 * same term again. Enter on a read still in flight sends nothing; once it has
 * settled Enter asks again, as the retry after a failure and as the refresh
 * after an answer.
 */
describe('a board search asks once per term, Enter included', () => {
  async function typedAndSettled(user: ReturnType<typeof userEvent.setup>) {
    renderLtr(inBranch(<ReceptionQueueScreen locale="en" messages={en} canCreate />));
    const box = screen.getByLabelText(EN['receptions.queue.searchLabel'] as string);
    await user.type(box, 'Khal');
    await waitFor(() => expect(latest().body.q).toBe('Khal'));
    return box;
  }

  it('sends nothing on Enter while the settled read is still in flight', async () => {
    stubNetwork();
    const user = userEvent.setup();
    await typedAndSettled(user);
    const count = sent.length;
    await user.keyboard('{Enter}');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(sent.length).toBe(count);
    expect(latest().signal.aborted).toBe(false);
  });

  it('sends exactly one new read on Enter once the board shows an answer — the refresh', async () => {
    // Nothing polls and the board has no other refresh control, so Search on an
    // answered read is how an operator looks for new arrivals.
    stubNetwork();
    const user = userEvent.setup();
    await typedAndSettled(user);
    latest().answer(json(page([receptionRow()])));
    expect(await screen.findByText('R-0001', { selector: 'code' })).toBeVisible();
    const count = sent.length;
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sent.length).toBe(count + 1));
    expect(latest().body.q).toBe('Khal');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(sent.length).toBe(count + 1);
  });

  it('asks again on Enter after the read failed — that is the retry', async () => {
    stubNetwork();
    const user = userEvent.setup();
    await typedAndSettled(user);
    latest().answer(json({ status: 'unavailable' }, 503));
    expect(await screen.findByText(EN['state.unavailable.title'] as string)).toBeVisible();
    const count = sent.length;
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sent.length).toBe(count + 1));
    expect(latest().body.q).toBe('Khal');
  });
});

/*
 * Checkpoint browser QA: under the limiter the API answers 429, which the read
 * route carries as an `unavailable` envelope (200) — and a web tier that is
 * itself throttled answers a bare 429. Both must read as "busy, try again",
 * never as an empty list that looks like "no matches".
 */
const THROTTLED_ENVELOPE = {
  status: 'unavailable',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-429',
};

type Catalogue = Record<string, string>;

function expectBusyNotEmpty(catalogue: Catalogue) {
  expect(screen.getByRole('button', { name: catalogue['state.retry'] as string })).toBeVisible();
  expect(screen.queryByText(catalogue['state.noResults.title'] as string)).toBeNull();
  expect(screen.queryByText(catalogue['state.empty.title'] as string)).toBeNull();
  expect(screen.queryByText(catalogue['state.loading'] as string)).toBeNull();
}

describe('a throttled board read says busy, never empty (en and ar)', () => {
  const AR = ar as Catalogue;
  const cases = [
    ['en', EN, renderLtr],
    ['ar', AR, renderRtl],
  ] as const;

  for (const [locale, catalogue, render] of cases) {
    const messages = locale === 'ar' ? ar : en;

    it(`reception board: the API's 429, carried by the route (${locale})`, async () => {
      stubNetwork();
      render(
        inBranch(<ReceptionQueueScreen locale={locale} messages={messages} canCreate />, {
          locale,
        })
      );
      await waitFor(() => expect(sent).toHaveLength(1));
      latest().answer(json(THROTTLED_ENVELOPE));
      expect(await screen.findByText(catalogue['state.unavailable.title'] as string)).toBeVisible();
      expectBusyNotEmpty(catalogue);
    });

    it(`reception board: a bare 429 from the web tier (${locale})`, async () => {
      stubNetwork();
      render(
        inBranch(<ReceptionQueueScreen locale={locale} messages={messages} canCreate />, {
          locale,
        })
      );
      await waitFor(() => expect(sent).toHaveLength(1));
      latest().answer(new Response('Too Many Requests', { status: 429 }));
      expect(await screen.findByText(catalogue['state.unavailable.title'] as string)).toBeVisible();
      expectBusyNotEmpty(catalogue);
    });

    it(`work-order board: the API's 429 and a bare 429 (${locale})`, async () => {
      stubNetwork();
      const user = userEvent.setup();
      render(
        <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
          {inBranch(<WorkOrderQueueScreen locale={locale} messages={messages} />, { locale })}
        </UiFoundationProvider>
      );
      const board = () => sent.filter((request) => request.url === '/reads/work-orders');
      await waitFor(() => expect(board()).toHaveLength(1));
      board()[0]?.answer(json(THROTTLED_ENVELOPE));
      expect(await screen.findByText(catalogue['state.unavailable.title'] as string)).toBeVisible();
      expectBusyNotEmpty(catalogue);

      await user.click(screen.getByRole('button', { name: catalogue['state.retry'] as string }));
      await waitFor(() => expect(board()).toHaveLength(2));
      board()[1]?.answer(new Response('Too Many Requests', { status: 429 }));
      expect(await screen.findByText(catalogue['state.unavailable.title'] as string)).toBeVisible();
      expectBusyNotEmpty(catalogue);
    });

    it(`overview figures: a bare 429 from the web tier (${locale})`, async () => {
      stubNetwork();
      render(inBranch(<DashboardScreen locale={locale} messages={messages} />, { locale }));
      await waitFor(() => expect(latest().url).toContain('/reads/dashboard-summary'));
      latest().answer(new Response('Too Many Requests', { status: 429 }));
      expect(await screen.findByText(catalogue['state.unavailable.title'] as string)).toBeVisible();
      expectBusyNotEmpty(catalogue);
    });
  }
});
