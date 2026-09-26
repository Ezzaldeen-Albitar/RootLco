import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  TEST_COMPANY,
  branchSnapshot,
  inBranch,
  renderLtr,
} from './render';

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
 */

const EN = en as Record<string, string>;
const COMPANY = TEST_COMPANY.id;

interface Sent {
  readonly url: string;
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
          sent.push({ url, signal, answer, fail });
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
    await waitFor(() => expect(latest().url).toContain(`branchId=${TEST_BRANCH.id}`));
    const left = latest();
    expect(left.url).toMatch(/^\/reads\/receptions\?/);
    expect(left.signal.aborted).toBe(false);
    abort.mockClear();

    await user.click(screen.getByRole('button', { name: 'use second' }));
    await waitFor(() => expect(latest().url).toContain(`branchId=${OTHER_BRANCH.id}`));

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
    expect(await screen.findByText('R-0002')).toBeVisible();
  });

  it('never renders the left branch’s answer, even from a transport that ignores the abort', async () => {
    stubNetwork({ honoursAbort: false });
    const user = userEvent.setup();
    renderBoard();

    await user.click(screen.getByRole('button', { name: 'use main' }));
    await waitFor(() => expect(latest().url).toContain(`branchId=${TEST_BRANCH.id}`));
    const left = latest();
    await user.click(screen.getByRole('button', { name: 'use second' }));
    await waitFor(() => expect(latest().url).toContain(`branchId=${OTHER_BRANCH.id}`));
    const current = latest();

    // The stale answer arrives AFTER the switch — and is ignored.
    left.answer(json(page([receptionRow({ displayNumber: 'R-STALE' })])));
    current.answer(
      json(page([receptionRow({ branchId: OTHER_BRANCH.id, displayNumber: 'R-0002' })]))
    );
    expect(await screen.findByText('R-0002')).toBeVisible();
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
    await waitFor(() => expect(latest().url).toContain('q=Kha&'));
    const typedPast = latest();

    await user.type(box, 'l');
    await waitFor(() => expect(latest().url).toContain('q=Khal'));

    expect(typedPast.signal.aborted).toBe(true);
    expect(latest().signal.aborted).toBe(false);
    expect(sent.filter((request) => !request.signal.aborted)).toHaveLength(1);
  });
});

describe('the overview figures, on a period change', () => {
  it('aborts the read for the period left behind', async () => {
    stubNetwork();
    const user = userEvent.setup();
    renderLtr(inBranch(<DashboardScreen locale="en" messages={en} />));

    await waitFor(() => expect(latest().url).toContain('period=today'));
    const left = latest();
    expect(left.url).toMatch(/^\/reads\/dashboard-summary\?/);
    expect(left.url).toContain(`companyId=${COMPANY}`);

    await user.click(
      screen.getByRole('button', { name: EN['dashboard.period.yesterday'] as string })
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
