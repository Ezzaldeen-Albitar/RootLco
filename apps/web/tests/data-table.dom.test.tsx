import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchBox } from '@/components/search/SearchBox';
import { SearchStates } from '@/components/search/SearchStates';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import {
  INITIAL_REQUEST,
  type TableRequest,
  type TableResponse,
} from '@/components/data-table/table-state';
import { CLIENT_READ_TIMEOUT_MS, settleRead, useSearchRequest } from '@/lib/api/use-search-request';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';

/**
 * The cursor-pagination mode of the shared table — `P1-26-F-001`.
 *
 * Every P1-26 list operation returns `{items, nextCursor, hasMore}` and **no
 * count**. The P1-25 table required a numeric total, and the two ways to satisfy
 * that type were to fork the table or to fabricate a total. A fabricated total
 * produces a pager that is correct on page one and lies from page two onward,
 * and the lie is invisible in review because the type is satisfied.
 *
 * These tests are what stop it coming back.
 */

interface Row {
  readonly id: string;
  readonly name: string;
}

const COLUMNS: readonly Column<Row>[] = [
  { id: 'name', headerKey: 'column.description', cell: (row) => row.name },
];

const ROWS: readonly Row[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
];

function renderTable(
  response: TableResponse<Row> | null,
  overrides: {
    readonly status?: 'idle' | 'loading' | 'error' | 'denied';
    readonly request?: TableRequest;
    readonly onRequestChange?: (next: TableRequest) => void;
    readonly correlationId?: string;
  } = {}
) {
  return renderLtr(
    <DataTable<Row>
      messages={en}
      columns={COLUMNS}
      rowId={(row) => row.id}
      request={overrides.request ?? INITIAL_REQUEST}
      response={response}
      status={overrides.status ?? 'idle'}
      onRequestChange={overrides.onRequestChange ?? (() => undefined)}
      caption="Rows"
      correlationId={overrides.correlationId}
    />
  );
}

const pager = () => screen.getByRole('navigation', { name: 'Pagination' });

describe('the counted mode is unchanged', () => {
  it('prints the range, the page count, and every page control', () => {
    renderTable({ rows: ROWS, total: 51, page: 1, pageSize: 25 });
    const nav = pager();
    expect(nav).toHaveTextContent('Showing 1–25 of 51');
    expect(nav).toHaveTextContent('1 / 3');
    expect(within(nav).getByRole('button', { name: 'First page' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Last page' })).toBeInTheDocument();
  });
});

describe('the uncounted (cursor) mode', () => {
  const uncounted: TableResponse<Row> = {
    rows: ROWS,
    total: null,
    page: 1,
    pageSize: 25,
    hasMore: true,
  };

  it('prints NO total — the server did not send one', () => {
    renderTable(uncounted);
    const nav = pager();
    expect(nav).toHaveTextContent('Showing 2');
    // The decisive assertion. Any "of N" here is a number nobody sent.
    expect(nav.textContent).not.toMatch(/\bof\b/);
  });

  it('hides First and Last rather than disabling them', () => {
    // A disabled Last implies there IS a last page the interface could reach if
    // only the button worked. There is not: the end of a cursor set is not
    // knowable without walking it.
    renderTable(uncounted);
    const nav = pager();
    expect(within(nav).queryByRole('button', { name: 'First page' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Last page' })).toBeNull();
  });

  it('enables Next only while the server says there is more', async () => {
    const user = userEvent.setup();
    const onRequestChange = vi.fn();
    const { unmount } = renderTable(uncounted, { onRequestChange });
    const next = within(pager()).getByRole('button', { name: 'Next page' });
    expect(next).toBeEnabled();
    await user.click(next);
    expect(onRequestChange).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    unmount();

    renderTable({ ...uncounted, hasMore: false });
    expect(within(pager()).getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('disables Previous on the first page', () => {
    renderTable(uncounted);
    expect(within(pager()).getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });
});

describe('while loading', () => {
  it('prints no total at all — not a fabricated zero', () => {
    // P1-26-F-024: `response ? response.total : 0` put the table in counted mode
    // before its first page arrived, so every cursor-paginated screen flashed
    // "Showing 0–0 of 0" and "1 / 1". A number shown while loading is a claim
    // about a set nobody has read yet.
    renderTable(null, { status: 'loading' });
    const nav = pager();
    expect(nav.textContent).not.toMatch(/\bof\b/);
    expect(nav.textContent).not.toContain('0–0');
    expect(nav.textContent).not.toContain('1 / 1');
  });

  it('marks the body busy so the state is announced, not just drawn', () => {
    renderTable(null, { status: 'loading' });
    expect(screen.getByRole('table').querySelector('tbody')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('a denial replaces the table', () => {
  it('renders no table at all, so no row ever reaches the browser', () => {
    renderTable({ rows: ROWS, total: 2, page: 1, pageSize: 25 }, { status: 'denied' });
    // Not "hidden" and not "covered" — absent.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('You do not have access')).toBeInTheDocument();
  });

  it('carries the reference the backend logged, because support cannot find the refusal without it', () => {
    /*
     * This is the highest-traffic denial surface in the product — every CRM and
     * every Vehicle list renders its refusal here, not in a route file.
     *
     * `route-correlation-binding.test.ts` proves the rule for the two routes
     * that read on the server, and its corpus is `src/app/**`, so it cannot see
     * this component at all. A review measured the consequence: deleting
     * `correlationId` from the denial branch of `DataTable` left the whole web
     * tier — 70 files, 1866 tests — green. One assertion in a route suite and a
     * shared component doing the same job unguarded is the shape this phase has
     * hit repeatedly.
     *
     * A distinctive token, so a component inventing its own could not satisfy it.
     */
    renderTable(
      { rows: ROWS, total: 2, page: 1, pageSize: 25 },
      { status: 'denied', correlationId: 'corr-table-4c8d' }
    );
    expect(screen.getByText('You do not have access')).toBeInTheDocument();
    expect(
      screen.getByText(/corr-table-4c8d/),
      'the denied list reached the operator without the reference the API logged'
    ).toBeInTheDocument();
  });
});

/* ====================================================================== *
 * The search primitives — one box, a settled term, and one live request
 * ====================================================================== */

/**
 * What these cases defend.
 *
 * The two search surfaces this product already had each documented "there is no
 * debounce, because a debounce is still a request per pause" and sent one
 * request per SUBMIT instead — uncancelled, unbounded, and racing itself the
 * moment an operator corrected a spelling. The correction is that a debounced,
 * aborted stream sends FEWER requests than submit-per-attempt, and the three
 * things that have to be true for that to be safe are asserted here: the term
 * settles, the previous request is abandoned, and a late answer cannot win.
 */
function okPage<T>(
  items: readonly T[],
  correlationId = 'corr-search',
  nextCursor: string | null = null
) {
  return {
    status: 'ok' as const,
    data: { items, nextCursor, hasMore: nextCursor !== null },
    correlationId,
  };
}

function failure(status: 'denied' | 'unavailable' | 'expired' | 'error' | 'not-found') {
  return { status, correlationId: 'corr-fail' };
}

interface Found {
  readonly id: string;
}

function SearchHarness({
  term,
  load,
  version = 0,
}: {
  readonly term: string;
  readonly load: (
    criteria: { q: string },
    cursor: string | null,
    signal: AbortSignal
  ) => Promise<unknown>;
  readonly version?: number;
}) {
  const settled = useDebouncedValue(term, 20);
  const outcome = useSearchRequest<Found, { q: string }>({
    criteria: settled.length >= 2 ? { q: settled } : null,
    load: load as never,
    version,
    // Short, so a case is not a second long. The INTERVAL is not what these
    // cases are about — the settling, the abandoning and the ordering are.
    debounceMs: 20,
  });
  return (
    <div>
      <p data-testid="phase">{outcome.phase}</p>
      <p data-testid="rows">{outcome.rows.map((row) => row.id).join(',')}</p>
      <p data-testid="error">{outcome.error ?? ''}</p>
      <p data-testid="paged">{outcome.page === null ? 'none' : String(outcome.page.hasMore)}</p>
      <p data-testid="page">{outcome.pageNumber}</p>
      <p data-testid="more">{String(outcome.hasMore)}</p>
      <button type="button" onClick={outcome.submit}>
        ask now
      </button>
      <button type="button" onClick={outcome.next}>
        next page
      </button>
      <button type="button" onClick={outcome.previous}>
        previous page
      </button>
    </div>
  );
}

describe('a search box', () => {
  function box(over: Record<string, unknown> = {}) {
    return renderLtr(
      <SearchBox
        messages={en}
        label="Find a record"
        value={(over['value'] as string) ?? ''}
        onChange={(over['onChange'] as (next: string) => void) ?? vi.fn()}
        {...over}
      />
    );
  }

  it('is one labelled control, with the page own example shown beside it', () => {
    box({ example: 'For example 4 digits, or part of a name', placeholder: 'Name or number' });
    const input = screen.getByLabelText('Find a record');
    expect(input).toHaveAttribute('placeholder', 'Name or number');
    // The example is a described-by line, not placeholder text: placeholder
    // text disappears exactly when the operator wants to check the format.
    expect(input).toHaveAccessibleDescription('For example 4 digits, or part of a name');
  });

  it('summons no digits-only keypad, because the box also takes a name', () => {
    box();
    expect(screen.getByLabelText('Find a record')).toHaveAttribute('inputMode', 'text');
  });

  it('accepts Arabic-Indic digits without rewriting them', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    box({ onChange });
    await user.type(screen.getByLabelText('Find a record'), '٤');
    // What is typed is what is reported. The backend folds digits when it
    // matches; a control that corrected them would be a second authority.
    expect(onChange).toHaveBeenCalledWith('٤');
  });

  it('submits on Enter and prevents the surrounding form from submitting instead', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const outerSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    renderLtr(
      <form onSubmit={outerSubmit}>
        <SearchBox
          messages={en}
          label="Find a record"
          value="abc"
          onChange={vi.fn()}
          onSubmit={onSubmit}
        />
      </form>
    );
    await user.type(screen.getByLabelText('Find a record'), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(outerSubmit).not.toHaveBeenCalled();
  });

  it('clears on Escape and from the clear control', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    box({ value: 'abc', onChange });
    await user.type(screen.getByLabelText('Find a record'), '{Escape}');
    expect(onChange).toHaveBeenCalledWith('');

    onChange.mockClear();
    await user.click(screen.getByRole('button', { name: en['search.clear'] }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('offers no clear control when there is nothing to clear', () => {
    box({ value: '' });
    expect(screen.queryByRole('button', { name: en['search.clear'] })).toBeNull();
  });
});

describe('a search request', () => {
  it('asks for NOTHING until the criteria say something', async () => {
    const load = vi.fn();
    renderLtr(<SearchHarness term="a" load={load} />);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('idle'));
    expect(load).not.toHaveBeenCalled();
  });

  it('settles the term, so typing is ONE request rather than one per character', async () => {
    const load = vi.fn(async (criteria: { q: string }) => okPage([{ id: `r-${criteria.q}` }]));
    // Starts EMPTY, as the real box does, so nothing has been asked yet.
    const { rerender } = renderLtr(<SearchHarness term="" load={load} />);
    for (const term of ['K', 'Kh', 'Kha', 'Khal', 'Khali', 'Khalid']) {
      rerender(<SearchHarness term={term} load={load} />);
    }
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    // Six keystrokes, one request — this is the claim the corrected reasoning
    // rests on, and the number is what makes it checkable. Submit-per-attempt
    // spends one request per correction instead, with none of them cancelled.
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0]).toEqual({ q: 'Khalid' });
  });

  it('ABANDONS the previous request and never lets a late answer win', async () => {
    const seen: AbortSignal[] = [];
    // A holder rather than a bare `let`: TypeScript narrows a variable assigned
    // only inside a callback to `never` at the later call site, and the point
    // of this case is that the call happens LATE.
    const gate: { release: ((value: unknown) => void) | null } = { release: null };
    const load = vi.fn(
      async (criteria: { q: string }, _cursor: string | null, signal: AbortSignal) => {
        seen.push(signal);
        if (criteria.q === 'slow') {
          await new Promise((resolve) => {
            gate.release = resolve;
          });
          return okPage([{ id: 'stale' }]);
        }
        return okPage([{ id: 'fresh' }]);
      }
    );

    const { rerender } = renderLtr(<SearchHarness term="slow" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    rerender(<SearchHarness term="fast" load={load} />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('fresh'));

    // The first request's signal is aborted, which is what a loader that does
    // reach a real fetch would act on.
    expect(seen[0]?.aborted).toBe(true);
    // And the slow answer, released AFTER the fast one landed, is dropped
    // rather than overwriting it. Without the sequence guard this is the
    // failure an operator sees as results for a term they already replaced.
    gate.release?.(null);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId('rows')).toHaveTextContent('fresh');
  });

  it('re-asks when the working branch changes, even though the term did not', async () => {
    const load = vi.fn(async () => okPage([{ id: 'r1' }]));
    const { rerender } = renderLtr(<SearchHarness term="same" load={load} version={0} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    rerender(<SearchHarness term="same" load={load} version={1} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('asks AT ONCE when the operator submits, without waiting for the term to settle', async () => {
    /*
     * Enter and the Search control are statements of intent. Making somebody
     * who has already decided wait out a timer is the interface being slower
     * than the person using it — and the debounce was applied to the explicit
     * path as well as the typed one.
     *
     * The debounce here is 20 ms; the assertion runs before any timer could
     * have fired, so a hook that still waited would fail it.
     */
    const load = vi.fn(async (criteria: { q: string }) => okPage([{ id: `r-${criteria.q}` }]));
    renderLtr(<SearchHarness term="now" load={load} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'ask now' }));
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(load.mock.calls[0]?.[0]).toEqual({ q: 'now' });
  });

  it('re-issues on a SECOND submit of the same term, which is what a retry is', async () => {
    const load = vi.fn(async (criteria: { q: string }) => okPage([{ id: `r-${criteria.q}` }]));
    const user = userEvent.setup();
    renderLtr(<SearchHarness term="same" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'ask now' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('files rows under the criteria it ACTUALLY fetched, not the settled name', async () => {
    /*
     * While the debounce lags, the key being fetched is the settled one and the
     * criteria object is already newer. Reading the current criteria at issue
     * time fetched one thing and filed the answer under the name of another —
     * so the rows appeared the moment the debounce caught up, as if they had
     * been read for the newer term.
     */
    const load = vi.fn(async (criteria: { q: string }) => okPage([{ id: `for-${criteria.q}` }]));
    const { rerender } = renderLtr(<SearchHarness term="" load={load} />);
    rerender(<SearchHarness term="ab" load={load} />);
    rerender(<SearchHarness term="abc" load={load} />);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0]).toEqual({ q: 'abc' });
    expect(screen.getByTestId('rows')).toHaveTextContent('for-abc');
  });

  it('reports "no matches" ONLY from a completed read', async () => {
    const load = vi.fn(async () => okPage([]));
    renderLtr(<SearchHarness term="none" load={load} />);
    // It is loading first, and loading is never rendered as an absence.
    expect(screen.getByTestId('phase')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('empty'));
  });

  it('keeps a refusal, an ended session, an outage and a fault apart', async () => {
    // The collapse this prevents: rendering "no matches" over a permission
    // failure tells an operator a record does not exist when the truth is that
    // they may not look at it.
    //
    // An ended session is its OWN phase since the Owner directive. It used to be
    // a `failed` carrying `state.expired.message`, which every renderer had to
    // recognise by comparing an error KEY — one did and the rest showed
    // "Something went wrong" over a retry that could not work.
    for (const [status, phase, key] of [
      ['denied', 'refused', 'state.denied.title'],
      ['unavailable', 'unavailable', 'state.unavailable.title'],
      ['expired', 'expired', 'state.expired.message'],
      ['error', 'failed', 'state.error.title'],
      ['not-found', 'failed', 'state.notFound.title'],
    ] as const) {
      const load = vi.fn(async () => failure(status));
      const view = renderLtr(<SearchHarness term={`q-${status}`} load={load} />);
      await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent(phase));
      expect(screen.getByTestId('error')).toHaveTextContent(key);
      view.unmount();
    }
  });
});

describe('a search that fails never stays "Loading" (browser QA part 7, rows 2.6 and 1c.1b)', () => {
  /*
   * The reads behind every search are Server Action calls. When that call
   * fails — the connection drops, or the web tier answers 503 — it REJECTS
   * rather than resolving a failure state, and the hook used to await it with
   * nothing to catch the rejection: no answer was ever held, so the phase was
   * derived as `loading` for good. QA watched three screens read "Loading"
   * twelve seconds after the read had failed, with no sentence and no retry.
   */
  it('settles a read that fails at the NETWORK as an outage, not as Loading', async () => {
    const load = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderLtr(<SearchHarness term="network" load={load} />);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('unavailable'));
    expect(screen.getByTestId('error')).toHaveTextContent('state.unavailable.title');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('settles a web-tier 503 as an outage, and a retry asks again and recovers', async () => {
    // What the Server Action client throws for a response that is not a
    // Server Action answer — a 503 from a proxy in front of the web tier.
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('An unexpected response was received from the server.'))
      .mockResolvedValue(okPage([{ id: 'recovered' }]));
    const user = userEvent.setup();
    renderLtr(<SearchHarness term="outage" load={load} />);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('unavailable'));

    await user.click(screen.getByRole('button', { name: 'ask now' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    expect(screen.getByTestId('rows')).toHaveTextContent('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps a fault the service ANSWERED apart from one that never arrived', async () => {
    // A resolved `error` is the service saying something broke — a fault with
    // a reference. Only a read with no readable answer is an outage.
    const load = vi.fn(async () => failure('error'));
    renderLtr(<SearchHarness term="fault" load={load} />);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('failed'));
    expect(screen.getByTestId('error')).toHaveTextContent('state.error.title');
  });

  it('gives up on a read that never answers at the client ceiling, as an outage', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const load = vi.fn(() => new Promise<never>(() => undefined));
      renderLtr(<SearchHarness term="hangs" load={load} />);
      await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('phase')).toHaveTextContent('loading');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS);
      });
      await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('unavailable'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('abandons the read in flight on a branch switch and asks for the new branch at once', async () => {
    /*
     * Row 1c.1b: a switch must not leave the new branch's read waiting on the
     * old one. The old read here NEVER answers; the new branch's read is still
     * issued, its answer rendered, and the old read's signal is aborted — the
     * signal is what `settleRead` stops waiting on, and what a loader that
     * reaches a real `fetch` passes on.
     */
    const seen: AbortSignal[] = [];
    const load = vi.fn((_criteria: { q: string }, _cursor: string | null, signal: AbortSignal) => {
      seen.push(signal);
      return seen.length === 1
        ? new Promise<never>(() => undefined)
        : Promise.resolve(okPage([{ id: 'new-branch' }]));
    });
    const { rerender } = renderLtr(<SearchHarness term="same" load={load} version={0} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(seen[0]?.aborted).toBe(false);

    rerender(<SearchHarness term="same" load={load} version={1} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(seen[0]?.aborted).toBe(true);
    expect(seen[1]?.aborted).toBe(false);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('new-branch'));
  });

  it('settleRead: its own answer, or the failure — for a rejection, a timeout and an abort', async () => {
    type Answer = { readonly status: 'ok' | 'unavailable' };
    const failed: Answer = { status: 'unavailable' };
    const answered: Answer = { status: 'ok' };
    await expect(settleRead(async () => answered, failed)).resolves.toBe(answered);
    await expect(
      settleRead(() => Promise.reject(new TypeError('Failed to fetch')), failed)
    ).resolves.toBe(failed);
    await expect(
      settleRead(() => new Promise<never>(() => undefined), failed, { timeoutMs: 10 })
    ).resolves.toBe(failed);

    const controller = new AbortController();
    const pending = settleRead(() => new Promise<never>(() => undefined), failed, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toBe(failed);
  });
});

describe('the states a search can be in', () => {
  it('renders each non-ready phase as its own answer, and the ready one as nothing', () => {
    const cases = [
      ['loading', en['state.loading']],
      ['empty', en['state.noResults.title']],
      ['unavailable', en['state.unavailable.title']],
      ['refused', en['state.denied.title']],
      ['expired', en['state.expired.title']],
      ['failed', en['state.error.title']],
    ] as const;
    for (const [phase, text] of cases) {
      const view = renderLtr(<SearchStates messages={en} phase={phase} />);
      expect(screen.getByText(text as string), phase).toBeInTheDocument();
      view.unmount();
    }
    const ready = renderLtr(<SearchStates messages={en} phase="ready" />);
    expect(ready.container).toBeEmptyDOMElement();
  });

  it('offers the way back to signing in when the session has ended, and no retry', () => {
    // Re-issuing the same request with the same dead session fails identically,
    // so the only control offered is the one that can change the answer. The
    // locale is what keeps the link in the operator's own language; without one
    // the sentence still stands and the link is simply not offered.
    const expired = renderLtr(<SearchStates messages={en} locale="en" phase="expired" />);
    expect(screen.getByText(en['state.expired.title'] as string)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en['auth.backToLogin'] as string })).toHaveAttribute(
      'href',
      '/en/login'
    );
    expect(screen.queryByRole('button')).toBeNull();
    expired.unmount();

    const anonymous = renderLtr(<SearchStates messages={en} phase="expired" />);
    expect(screen.getByText(en['state.expired.title'] as string)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    anonymous.unmount();
  });

  it('offers a retry on an outage and NONE on a refusal', () => {
    const retry = <button type="button">Try again</button>;
    const outage = renderLtr(
      <SearchStates messages={en} phase="unavailable" retry={retry} correlationId="corr-1" />
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText(/corr-1/)).toBeInTheDocument();
    outage.unmount();

    // A refusal is the same refusal on the same session, so the button would
    // be an invitation that cannot be accepted.
    renderLtr(<SearchStates messages={en} phase="refused" retry={retry} correlationId="corr-2" />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows the page own idle line before anything has been asked', () => {
    renderLtr(
      <SearchStates messages={en} phase="idle" idle={<p>Type a name or a number to begin</p>} />
    );
    expect(screen.getByText('Type a name or a number to begin')).toBeInTheDocument();
    // Not an empty state: nothing has been asked, so there is nothing absent.
    expect(screen.queryByText(en['state.noResults.title'])).toBeNull();
  });
});

describe('a search that pages', () => {
  /**
   * The cursor is the backend's, and the walk is the operator's.
   *
   * These operations publish `{ items, nextCursor, hasMore }` and no count, so
   * page two is reachable only by spending the cursor page one returned — and
   * the cursor is issued against an ordering contract. Change the criteria, the
   * branch, or submit again, and every held cursor is for a set that no longer
   * exists. The three cases below are exactly those three resets.
   */
  function pagedLoader() {
    return vi.fn(async (criteria: { q: string }, cursor: string | null) => {
      if (cursor === null) return okPage([{ id: `${criteria.q}-p1` }], 'corr-1', 'cursor-2');
      return okPage([{ id: `${criteria.q}-p2` }], 'corr-2');
    });
  }

  it('sends the CURSOR page one returned when the operator goes forward', async () => {
    const user = userEvent.setup();
    const load = pagedLoader();
    renderLtr(<SearchHarness term="abc" load={load} />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('abc-p1'));
    expect(screen.getByTestId('page')).toHaveTextContent('1');
    expect(screen.getByTestId('more')).toHaveTextContent('true');

    await user.click(screen.getByRole('button', { name: 'next page' }));
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('abc-p2'));
    expect(load.mock.calls[1]?.[1]).toBe('cursor-2');
    expect(screen.getByTestId('page')).toHaveTextContent('2');
    // No further page, and the honest signal for it is the server's own.
    expect(screen.getByTestId('more')).toHaveTextContent('false');
  });

  it('goes BACK with the cursor that opened the page, not by walking from the start', async () => {
    const user = userEvent.setup();
    const load = pagedLoader();
    renderLtr(<SearchHarness term="abc" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'next page' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'previous page' }));
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('1'));
    // One request, with page one's own cursor — not a re-walk.
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls[2]?.[1]).toBeNull();
  });

  it('RESTARTS at page one when the criteria change after page two', async () => {
    /*
     * The failure this closes: a cursor issued for one set spent against
     * another returns a window of rows that look entirely plausible. The stack
     * and the page number must move together — `use-server-table.ts` records
     * what happens when only one of them does.
     */
    const user = userEvent.setup();
    const load = pagedLoader();
    const { rerender } = renderLtr(<SearchHarness term="abc" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'next page' }));
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('2'));

    load.mockClear();
    rerender(<SearchHarness term="xyz" load={load} />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('xyz-p1'));
    expect(screen.getByTestId('page')).toHaveTextContent('1');
    expect(load.mock.calls[0]?.[1]).toBeNull();
  });

  it('RESTARTS at page one when the working branch changes', async () => {
    const user = userEvent.setup();
    const load = pagedLoader();
    const { rerender } = renderLtr(<SearchHarness term="abc" load={load} version={0} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'next page' }));
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('2'));

    load.mockClear();
    rerender(<SearchHarness term="abc" load={load} version={1} />);
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('1'));
    // The branch changed, so page two of the previous branch is not a page of
    // this one, and its cursor names nothing here.
    expect(load.mock.calls[0]?.[1]).toBeNull();
  });

  it('RESTARTS at page one on an explicit submission', async () => {
    const user = userEvent.setup();
    const load = pagedLoader();
    renderLtr(<SearchHarness term="abc" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'next page' }));
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('2'));

    load.mockClear();
    await user.click(screen.getByRole('button', { name: 'ask now' }));
    await waitFor(() => expect(screen.getByTestId('page')).toHaveTextContent('1'));
    expect(load.mock.calls[0]?.[1]).toBeNull();
  });
});
