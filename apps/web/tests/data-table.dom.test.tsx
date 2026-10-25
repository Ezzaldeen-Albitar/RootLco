import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SearchBox } from '@/components/search/SearchBox';
import { SearchStates } from '@/components/search/SearchStates';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import {
  INITIAL_REQUEST,
  type TableRequest,
  type TableResponse,
} from '@/components/data-table/table-state';
import { DEFAULT_READ_RETRIES, DEFAULT_TIMEOUT_MS, MAX_READ_RETRIES } from '@/lib/api/client';
import * as readBudget from '@/lib/api/read-budget';
import { clientReadTimeoutMs } from '@/lib/api/read-budget';
import {
  CLIENT_READ_QUEUE_MARGIN_MS,
  CLIENT_READ_TIMEOUT_MS,
  SERVER_READ_WORST_CASE_MS,
  settleRead,
  useSearchRequest,
} from '@/lib/api/use-search-request';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/lib/use-debounced-value';
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

function TableHarness({
  load,
  serverReads,
}: {
  readonly load: (request: TableRequest, cursor: string | null) => Promise<ServerPage<Found>>;
  readonly serverReads?: number;
}) {
  const table = useServerTable<Found>(load, serverReads === undefined ? {} : { serverReads });
  return <p data-testid="table-status">{table.status}</p>;
}

function SearchHarness({
  term,
  load,
  version = 0,
  serverReads,
}: {
  readonly term: string;
  readonly load: (
    criteria: { q: string },
    cursor: string | null,
    signal: AbortSignal
  ) => Promise<unknown>;
  readonly version?: number;
  readonly serverReads?: number;
}) {
  const settled = useDebouncedValue(term, 20);
  const outcome = useSearchRequest<Found, { q: string }>({
    criteria: settled.length >= 2 ? { q: settled } : null,
    load: load as never,
    version,
    ...(serverReads === undefined ? {} : { serverReads }),
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

  it('re-issues a submit of the same term after the read FAILED, which is what a retry is', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(failure('unavailable'))
      .mockResolvedValue(okPage([{ id: 'r-same' }]));
    const user = userEvent.setup();
    renderLtr(<SearchHarness term="same" load={load} />);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('unavailable'));
    expect(load).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'ask now' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('r-same'));
  });

  it('sends NOTHING on a submit while page one of the same term is in flight, and ONE read once answered', async () => {
    /*
     * Checkpoint browser QA: the term settled and was read, and Enter then read
     * it again 50 ms later — every search spent two requests of the board's
     * `expensive-read` budget and drew 429s in pairs. Only the in-flight read
     * answers a submit: once it has answered, a submit is the refresh the
     * boards have no other control for, and asks exactly once.
     */
    const gate: { release: ((value: unknown) => void) | null } = { release: null };
    const load = vi.fn(async (criteria: { q: string }) => {
      await new Promise((resolve) => {
        gate.release = resolve;
      });
      return okPage([{ id: `r-${criteria.q}` }]);
    });
    const user = userEvent.setup();
    renderLtr(<SearchHarness term="same" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // In flight: the submit is answered by the read already out.
    await user.click(screen.getByRole('button', { name: 'ask now' }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(load).toHaveBeenCalledTimes(1);
    gate.release?.(null);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('ready'));
    // Answered: the submit asks again, once.
    await user.click(screen.getByRole('button', { name: 'ask now' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load.mock.calls[1]?.[0]).toEqual({ q: 'same' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(load).toHaveBeenCalledTimes(2);
    gate.release?.(null);
  });

  it('asks for the NEW criteria only after a submission — never the submitted ones again', async () => {
    /*
     * Checkpoint browser QA: after a branch switch (a submission) the reception
     * board re-read today's window when Yesterday was chosen, then read
     * yesterday's. Leaving a submitted term must not re-read it while the new
     * one settles.
     */
    const load = vi.fn(async (criteria: { q: string }) => okPage([{ id: `r-${criteria.q}` }]));
    const user = userEvent.setup();
    const { rerender } = renderLtr(<SearchHarness term="first" load={load} />);
    await user.click(screen.getByRole('button', { name: 'ask now' }));
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('r-first'));
    const before = load.mock.calls.length;

    rerender(<SearchHarness term="second" load={load} />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('r-second'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(load.mock.calls.slice(before).map((call) => call[0])).toEqual([{ q: 'second' }]);
  });

  it('keeps a submission after a branch switch to ONE read of the new criteria', async () => {
    const load = vi.fn(async (criteria: { q: string }) => okPage([{ id: `r-${criteria.q}` }]));
    const { rerender } = renderLtr(<SearchHarness term="same" load={load} version={0} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    rerender(<SearchHarness term="same" load={load} version={1} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    rerender(<SearchHarness term="other" load={load} version={1} />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('r-other'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(load.mock.calls.slice(2).map((call) => call[0])).toEqual([{ q: 'other' }]);
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

      // Still waiting at the server's own worst case: a read the server may
      // still be retrying is not abandoned over an answer about to arrive.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SERVER_READ_WORST_CASE_MS);
      });
      expect(screen.getByTestId('phase')).toHaveTextContent('loading');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS - SERVER_READ_WORST_CASE_MS);
      });
      await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('unavailable'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets the client ceiling above the server path and its queueing, never below it', () => {
    // Derived from the server client's own constants: every read there makes
    // at most MAX_READ_RETRIES + 1 attempts of DEFAULT_TIMEOUT_MS each.
    expect(SERVER_READ_WORST_CASE_MS).toBe(DEFAULT_TIMEOUT_MS * (MAX_READ_RETRIES + 1));
    expect(SERVER_READ_WORST_CASE_MS).toBeGreaterThanOrEqual(
      DEFAULT_TIMEOUT_MS * (DEFAULT_READ_RETRIES + 1)
    );
    // The queueing allowance is one more per-attempt timeout, and the ceiling
    // is exactly the two added — no hand-picked figure beside them.
    expect(CLIENT_READ_QUEUE_MARGIN_MS).toBe(DEFAULT_TIMEOUT_MS);
    expect(CLIENT_READ_TIMEOUT_MS).toBe(SERVER_READ_WORST_CASE_MS + CLIENT_READ_QUEUE_MARGIN_MS);
    expect(CLIENT_READ_TIMEOUT_MS).toBeGreaterThan(SERVER_READ_WORST_CASE_MS);
  });

  it('settles a rejected read at once, with no timer left behind (network and 503 alike)', async () => {
    // The ceiling is a safety net, not how a failure is noticed. Time does not
    // move in this case at all: a rejection must settle on its own, and the
    // ceiling timer it armed must be cleared rather than left to fire later.
    vi.useFakeTimers();
    try {
      const failed = { status: 'unavailable' } as const;
      for (const reason of [
        new TypeError('Failed to fetch'),
        new Error('An unexpected response was received from the server.'),
      ]) {
        await expect(settleRead(() => Promise.reject(reason), failed)).resolves.toBe(failed);
        expect(vi.getTimerCount()).toBe(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds a silent read until exactly the derived ceiling, and not one millisecond less', async () => {
    vi.useFakeTimers();
    try {
      const failed = { status: 'unavailable' } as const;
      let settled = false;
      const pending = settleRead(() => new Promise<never>(() => undefined), failed).then(
        (value) => {
          settled = true;
          return value;
        }
      );
      await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe(failed);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows NO outage when a branch switch abandons the read in flight', async () => {
    /*
     * Abandoning a read settles it with the failure value — and that value
     * must never reach the screen. The switch is the operator moving on, not
     * the service failing: every phase painted between the switch and the new
     * answer is recorded, and "unavailable" is not among them. Two defences
     * hold it — the continuation refuses an aborted or superseded read, and the
     * answer is filed under the key it was asked for, which the new version no
     * longer matches — and this case pins the outcome, not either one alone.
     */
    let release: (value: unknown) => void = () => undefined;
    const load = vi.fn(() =>
      load.mock.calls.length === 1
        ? new Promise<never>(() => undefined)
        : new Promise((resolve) => {
            release = resolve;
          })
    );
    const { rerender } = renderLtr(<SearchHarness term="same" load={load} version={0} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    const painted: string[] = [];
    const phase = screen.getByTestId('phase');
    const observer = new MutationObserver(() => painted.push(phase.textContent ?? ''));
    observer.observe(phase, { childList: true, characterData: true, subtree: true });
    try {
      rerender(<SearchHarness term="same" load={load} version={1} />);
      await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
      // Give the abandoned read every chance to commit its failure value.
      await act(async () => {
        await Promise.resolve();
      });
      expect(phase).toHaveTextContent('loading');

      await act(async () => {
        release(okPage([{ id: 'switched' }]));
      });
      await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('switched'));
      expect(painted).not.toContain('unavailable');
    } finally {
      observer.disconnect();
    }
  });

  it('applies the SAME ceiling to a server table: rejection at once, silence only after the bound', async () => {
    const rejected = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const first = renderLtr(<TableHarness load={rejected} />);
    await waitFor(() =>
      expect(screen.getByTestId('table-status')).toHaveTextContent('unavailable')
    );
    first.unmount();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const silent = vi.fn(() => new Promise<never>(() => undefined));
      renderLtr(<TableHarness load={silent} />);
      await waitFor(() => expect(silent).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('table-status')).toHaveTextContent('loading');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SERVER_READ_WORST_CASE_MS);
      });
      expect(screen.getByTestId('table-status')).toHaveTextContent('loading');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS - SERVER_READ_WORST_CASE_MS);
      });
      await waitFor(() =>
        expect(screen.getByTestId('table-status')).toHaveTextContent('unavailable')
      );
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

  it('sizes the ceiling by the loader’s sequential reads: one read keeps 60 s, two get two worst cases', () => {
    // One read: the server's worst case plus the queueing margin — 60 s today.
    expect(clientReadTimeoutMs()).toBe(CLIENT_READ_TIMEOUT_MS);
    expect(clientReadTimeoutMs(1)).toBe(CLIENT_READ_TIMEOUT_MS);
    expect(CLIENT_READ_TIMEOUT_MS).toBe(60_000);
    // Two reads in sequence: the server may spend its whole worst case on EACH,
    // and the margin for waiting in the queue is added once, before either.
    expect(clientReadTimeoutMs(2)).toBe(
      2 * SERVER_READ_WORST_CASE_MS + CLIENT_READ_QUEUE_MARGIN_MS
    );
    expect(clientReadTimeoutMs(2)).toBeGreaterThan(
      CLIENT_READ_TIMEOUT_MS + CLIENT_READ_QUEUE_MARGIN_MS
    );
    // A mistyped count can only leave the single-read ceiling in place.
    for (const odd of [0, -1, 1.5, Number.NaN]) {
      expect(clientReadTimeoutMs(odd)).toBe(CLIENT_READ_TIMEOUT_MS);
    }
  });

  it('holds a TWO-read loader past the single-read ceiling, until exactly two worst cases and the margin', async () => {
    vi.useFakeTimers();
    try {
      const failed = { status: 'unavailable' } as const;
      let settled = false;
      const pending = settleRead(() => new Promise<never>(() => undefined), failed, {
        serverReads: 2,
      }).then((value) => {
        settled = true;
        return value;
      });
      // Past the ceiling a one-read loader gets: the second read may still be running.
      await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(
        2 * SERVER_READ_WORST_CASE_MS + CLIENT_READ_QUEUE_MARGIN_MS - CLIENT_READ_TIMEOUT_MS - 1
      );
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe(failed);
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries a two-read count through the server table and the search alike', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const silentTable = vi.fn(() => new Promise<never>(() => undefined));
      const table = renderLtr(<TableHarness load={silentTable} serverReads={2} />);
      await waitFor(() => expect(silentTable).toHaveBeenCalledTimes(1));
      // Two whole server worst cases — well past the one-read ceiling — and
      // still waiting.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * SERVER_READ_WORST_CASE_MS);
      });
      expect(screen.getByTestId('table-status')).toHaveTextContent('loading');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLIENT_READ_QUEUE_MARGIN_MS);
      });
      await waitFor(() =>
        expect(screen.getByTestId('table-status')).toHaveTextContent('unavailable')
      );
      table.unmount();

      const silentSearch = vi.fn(() => new Promise<never>(() => undefined));
      renderLtr(<SearchHarness term="twice" load={silentSearch} serverReads={2} />);
      await waitFor(() => expect(silentSearch).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * SERVER_READ_WORST_CASE_MS);
      });
      expect(screen.getByTestId('phase')).toHaveTextContent('loading');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLIENT_READ_QUEUE_MARGIN_MS);
      });
      await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('unavailable'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the browser hook off the server API client: the budget is its own import-free module', () => {
    const source = (file: string) => readFileSync(join(process.cwd(), 'src', file), 'utf8');
    const hook = source('lib/api/use-search-request.ts');
    // The client carries the English catalogue and the operation table; the
    // hook needs a handful of numbers from it and nothing else.
    expect(hook).not.toMatch(/from\s+['"](?:\.\/client|@\/lib\/api\/client)['"]/);
    expect(hook).toMatch(/from\s+['"]\.\/read-budget['"]/);
    expect(source('lib/api/read-budget.ts')).not.toMatch(/^\s*import\s/m);
    // One set of figures: the client's re-exports ARE the budget's.
    expect(readBudget.DEFAULT_TIMEOUT_MS).toBe(DEFAULT_TIMEOUT_MS);
    expect(readBudget.DEFAULT_READ_RETRIES).toBe(DEFAULT_READ_RETRIES);
    expect(readBudget.MAX_READ_RETRIES).toBe(MAX_READ_RETRIES);
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
      '/en/login?reason=expired'
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

describe('a search across a branch switch', () => {
  /**
   * The settled key belongs to the branch it was typed under.
   *
   * The invoice desk's "a reply still in flight when the branch changes is
   * dropped" once counted two reads where it expects one. The second read was
   * the hook's: with the term emptied by the switch there was no submission to
   * stand on, so the hook fell back to the debounced key — which for the length
   * of the debounce still named the term and the branch just left — asked for
   * it again under the new version, and showed its answer under the new branch.
   * It happened only when the switch came after the term had settled, which is
   * why the case passed whenever the suite was quicker than the debounce.
   *
   * Time is faked, so every instant below is chosen rather than hoped for, and
   * the debounce is the product's own 300 ms. A read is recorded with the
   * instant it was sent, its term, and the branch it would be sent FOR — the
   * criteria's where the scope travels in the criteria (`WorkOrderPicker` and
   * the boards), the loader's where it is bound to the loader (`EntityPicker`
   * and `SearchPicker` callers).
   */
  interface Asked {
    readonly q: string;
    readonly branch?: string;
  }

  interface Sent {
    readonly at: number;
    readonly q: string;
    readonly scope: string;
    readonly signal: AbortSignal;
    answered: boolean;
    readonly answer: (value: unknown) => void;
  }

  function SwitchHarness({
    term,
    branch,
    version,
    carries,
    sent,
    startedAt,
  }: {
    readonly term: string;
    readonly branch: string;
    readonly version: number;
    /** Whether the branch travels in the criteria or is bound to the loader. */
    readonly carries: boolean;
    readonly sent: Sent[];
    readonly startedAt: number;
  }) {
    const criteria: Asked | null =
      term.length >= 2 ? { q: term, ...(carries ? { branch } : {}) } : null;
    const search = useSearchRequest<Found, Asked>({
      criteria,
      version,
      load: ((asked: Asked, _cursor: string | null, signal: AbortSignal) =>
        new Promise((resolve) => {
          sent.push({
            at: Date.now() - startedAt,
            q: asked.q,
            scope: asked.branch ?? branch,
            signal,
            answered: false,
            answer: resolve,
          });
        })) as never,
    });
    return (
      <div>
        <p data-testid="heading">{branch}</p>
        <p data-testid="phase">{search.phase}</p>
        <p data-testid="rows">{search.rows.map((row) => row.id).join(',')}</p>
        <button type="button" onClick={search.submit}>
          ask now
        </button>
      </div>
    );
  }

  interface Stage {
    /** Every read sent so far, as `<ms> <term>@<branch>`. */
    readonly reads: () => readonly string[];
    readonly sent: readonly Sent[];
    /** The branch heading, the phase and the rows on screen, as one string. */
    readonly shown: () => string;
    /** One render: the term in the box, the branch in hand, its version. */
    readonly show: (term: string, branch: string, version: number) => void;
    readonly submit: () => void;
    readonly wait: (ms: number) => Promise<void>;
    /** Answers every read still open with rows named for what it asked. */
    readonly answerAll: () => Promise<void>;
  }

  async function staged(
    carries: boolean,
    run: (stage: Stage) => Promise<void>,
    /** The version the screen opens under; the provider counts on from it. */
    opensAt = 0
  ) {
    vi.useFakeTimers();
    try {
      const sent: Sent[] = [];
      const startedAt = Date.now();
      const host = (term: string, branch: string, version: number) => (
        <SwitchHarness
          term={term}
          branch={branch}
          version={version}
          carries={carries}
          sent={sent}
          startedAt={startedAt}
        />
      );
      const view = renderLtr(host('', 'A', opensAt));
      // One millisecond to an `act`, so a render a timer causes is committed at
      // the instant the timer fired and a read is stamped with the millisecond
      // it was sent in. A single `act` over the whole wait would commit only at
      // its end and stamp every read with the end of the wait.
      const tick = (ms: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      const wait = async (ms: number) => {
        // Zero still flushes what is already due: an answer, a pending render.
        if (ms === 0) await tick(0);
        for (let passed = 0; passed < ms; passed += 1) await tick(1);
      };
      await run({
        sent,
        reads: () => sent.map((read) => `${read.at} ${read.q}@${read.scope}`),
        shown: () =>
          [
            screen.getByTestId('heading').textContent,
            screen.getByTestId('phase').textContent,
            screen.getByTestId('rows').textContent,
          ].join(':'),
        show: (term, branch, version) => view.rerender(host(term, branch, version)),
        submit: () => {
          fireEvent.click(screen.getByRole('button', { name: 'ask now' }));
        },
        wait,
        answerAll: async () => {
          for (const read of sent) {
            if (read.answered) continue;
            read.answered = true;
            read.answer(okPage([{ id: `${read.scope}/${read.q}` }]));
          }
          await wait(0);
        },
      });
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  }

  /** The instants after a switch at which the screen and the reads are checked. */
  const AFTER_THE_SWITCH = [0, 100, SEARCH_DEBOUNCE_MS - 1, SEARCH_DEBOUNCE_MS + 1, 1000] as const;

  /** How long after the last keystroke the branch is switched. */
  const SWITCHED_AFTER = [0, 100, 299, 301, 600] as const;

  it('is run against the debounce the product ships', () => {
    // The instants above are written as numbers so the timeline reads as one;
    // this is what ties them to the interval they straddle.
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
  });

  it.each(SWITCHED_AFTER)(
    'a submitted term, the branch switched %i ms after the last keystroke: the one read is for the branch left, its reply is dropped, and nothing more is asked',
    async (after) => {
      await staged(true, async (stage) => {
        for (const term of ['L', 'La', 'Lay', 'Layl', 'Layla']) stage.show(term, 'A', 0);
        stage.submit();
        await stage.wait(after);
        expect(stage.reads()).toEqual(['0 Layla@A']);
        expect(stage.shown()).toBe('A:loading:');

        // The picker empties its term in the render the version moves in.
        stage.show('', 'B', 1);
        let elapsed = 0;
        for (const instant of AFTER_THE_SWITCH) {
          await stage.wait(instant - elapsed);
          elapsed = instant;
          // The reply for the branch left arrives now, and so would any other.
          await stage.answerAll();
          expect(stage.reads(), `reads ${instant} ms after the switch`).toEqual(['0 Layla@A']);
          expect(stage.shown(), `shown ${instant} ms after the switch`).toBe('B:idle:');
        }
        expect(stage.sent[0]?.signal.aborted).toBe(true);
      });
    }
  );

  it.each(SWITCHED_AFTER)(
    'a typed term, the branch switched %i ms after the last keystroke: no read for it is sent after the switch, and its answer is not shown under the new branch',
    async (after) => {
      await staged(true, async (stage) => {
        for (const term of ['L', 'La', 'Lay', 'Layl', 'Layla']) stage.show(term, 'A', 0);
        await stage.wait(after);
        // Sent only once the pause has passed; before it, nothing was asked.
        const settled = after >= SEARCH_DEBOUNCE_MS;
        const before = settled ? ['300 Layla@A'] : [];
        expect(stage.reads()).toEqual(before);
        await stage.answerAll();
        expect(stage.shown()).toBe(settled ? 'A:ready:A/Layla' : 'A:idle:');

        stage.show('', 'B', 1);
        let elapsed = 0;
        for (const instant of AFTER_THE_SWITCH) {
          await stage.wait(instant - elapsed);
          elapsed = instant;
          await stage.answerAll();
          expect(stage.reads(), `reads ${instant} ms after the switch`).toEqual(before);
          expect(stage.shown(), `shown ${instant} ms after the switch`).toBe('B:idle:');
        }
      });
    }
  );

  it('a board that keeps its criteria reads the new branch at once, and a filter changed 100 ms later never re-reads the branch left', async () => {
    await staged(true, async (stage) => {
      stage.show('Layla', 'A', 0);
      await stage.wait(600);
      await stage.answerAll();
      expect(stage.reads()).toEqual(['300 Layla@A']);
      expect(stage.shown()).toBe('A:ready:A/Layla');

      // The switch is a submission of the same criteria for the new branch.
      stage.show('Layla', 'B', 1);
      await stage.answerAll();
      expect(stage.reads()).toEqual(['300 Layla@A', '600 Layla@B']);
      expect(stage.shown()).toBe('B:ready:B/Layla');

      // A filter moves before the new branch's key has settled. The settled
      // key in hand is still the left branch's, and it must not be asked.
      await stage.wait(100);
      stage.show('Omar', 'B', 1);
      await stage.answerAll();
      expect(stage.reads()).toEqual(['300 Layla@A', '600 Layla@B']);
      expect(stage.shown()).toBe('B:ready:B/Layla');
      await stage.wait(SEARCH_DEBOUNCE_MS - 1);
      await stage.answerAll();
      expect(stage.reads()).toEqual(['300 Layla@A', '600 Layla@B']);
      expect(stage.shown()).toBe('B:ready:B/Layla');

      // The new filter's own pause, and then its own read — the only one.
      await stage.wait(1);
      expect(stage.reads()).toEqual(['300 Layla@A', '600 Layla@B', '1000 Omar@B']);
      await stage.answerAll();
      expect(stage.shown()).toBe('B:ready:B/Omar');
      await stage.wait(1000);
      expect(stage.reads()).toHaveLength(3);
    });
  });

  it('the same term typed again under the new branch is a new question: it waits its own pause and is read for the new branch', async () => {
    // The scope is bound to the loader here, so the key is the same characters
    // under both branches — the settled entry must still be told apart.
    await staged(false, async (stage) => {
      stage.show('Layla', 'A', 0);
      await stage.wait(600);
      await stage.answerAll();
      expect(stage.reads()).toEqual(['300 Layla@A']);
      expect(stage.shown()).toBe('A:ready:A/Layla');

      stage.show('', 'B', 1);
      await stage.wait(100);
      await stage.answerAll();
      expect(stage.reads()).toEqual(['300 Layla@A']);
      expect(stage.shown()).toBe('B:idle:');

      stage.show('Layla', 'B', 1);
      await stage.wait(SEARCH_DEBOUNCE_MS - 1);
      await stage.answerAll();
      expect(stage.reads()).toEqual(['300 Layla@A']);
      expect(stage.shown()).toBe('B:idle:');

      await stage.wait(1);
      expect(stage.reads()).toEqual(['300 Layla@A', '1000 Layla@B']);
      await stage.answerAll();
      expect(stage.shown()).toBe('B:ready:B/Layla');
    });
  });

  it('leaves ordinary typing where it was: one read at the pause, at once on a submit, and the superseded read abandoned', async () => {
    await staged(true, async (stage) => {
      for (const term of ['L', 'La', 'Lay']) stage.show(term, 'A', 0);
      await stage.wait(100);
      stage.show('Layl', 'A', 0);
      await stage.wait(100);
      stage.show('Layla', 'A', 0);
      await stage.wait(SEARCH_DEBOUNCE_MS - 1);
      expect(stage.reads()).toEqual([]);
      await stage.wait(1);
      expect(stage.reads()).toEqual(['500 Layla@A']);
      await stage.answerAll();
      expect(stage.shown()).toBe('A:ready:A/Layla');

      // Typing on keeps the settled answer on screen until the next pause.
      await stage.wait(100);
      stage.show('Laylax', 'A', 0);
      await stage.wait(SEARCH_DEBOUNCE_MS - 1);
      expect(stage.reads()).toEqual(['500 Layla@A']);
      expect(stage.shown()).toBe('A:ready:A/Layla');
      await stage.wait(1);
      expect(stage.reads()).toEqual(['500 Layla@A', '900 Laylax@A']);
      expect(stage.shown()).toBe('A:loading:');

      // A submit of a new term asks at once and abandons the read in flight.
      await stage.wait(50);
      stage.show('Omar', 'A', 0);
      stage.submit();
      await stage.wait(0);
      expect(stage.reads()).toEqual(['500 Layla@A', '900 Laylax@A', '950 Omar@A']);
      expect(stage.sent[1]?.signal.aborted).toBe(true);
      await stage.answerAll();
      expect(stage.shown()).toBe('A:ready:A/Omar');

      // The pause that follows a submission finds it already answered.
      await stage.wait(1000);
      expect(stage.reads()).toHaveLength(3);
      expect(stage.shown()).toBe('A:ready:A/Omar');
    });
  });

  it.each([
    ['in the criteria', true],
    ['bound to the loader', false],
  ] as const)(
    'A, then B, then A again, the scope %s: the term settled on the first visit is asked after neither switch, and typing it again is a new question',
    async (_where, carries) => {
      // The version is the provider's counter — 1, 2, 3 — and never the branch.
      // The second visit to A is version 3, so the entry settled under version 1
      // is not current again, although the branch and the characters are.
      await staged(
        carries,
        async (stage) => {
          stage.show('Layla', 'A', 1);
          await stage.wait(600);
          await stage.answerAll();
          expect(stage.reads()).toEqual(['300 Layla@A']);
          expect(stage.shown()).toBe('A:ready:A/Layla');

          // To B: the picker empties its term in the render the version moves in.
          stage.show('', 'B', 2);
          await stage.answerAll();
          expect(stage.reads()).toEqual(['300 Layla@A']);
          expect(stage.shown()).toBe('B:idle:');

          // Back to A while the entry settled on the first visit is still in hand.
          await stage.wait(100);
          stage.show('', 'A', 3);
          await stage.answerAll();
          expect(stage.reads()).toEqual(['300 Layla@A']);
          expect(stage.shown()).toBe('A:idle:');

          // The same term, typed again 50 ms later: its own pause, then one read.
          await stage.wait(50);
          stage.show('Layla', 'A', 3);
          await stage.answerAll();
          expect(stage.reads()).toEqual(['300 Layla@A']);
          expect(stage.shown()).toBe('A:idle:');
          await stage.wait(SEARCH_DEBOUNCE_MS - 1);
          await stage.answerAll();
          expect(stage.reads()).toEqual(['300 Layla@A']);
          expect(stage.shown()).toBe('A:idle:');
          await stage.wait(1);
          expect(stage.reads()).toEqual(['300 Layla@A', '1050 Layla@A']);
          await stage.answerAll();
          expect(stage.shown()).toBe('A:ready:A/Layla');
          await stage.wait(1000);
          expect(stage.reads()).toHaveLength(2);
        },
        1
      );
    }
  );

  it.each([
    ['in the criteria', true],
    ['bound to the loader', false],
  ] as const)(
    'typed, switched and typed again inside the pause, the scope %s: the shorter term that had settled earlier is not read under the new branch',
    async (_where, carries) => {
      /*
       * The screens that keep their criteria through a switch — the boards, and
       * the service catalogue, whose scope is the loader's. Counter sales binds
       * its scope to the loader too, but this sequence cannot reach it: it
       * remounts its search on a branch switch (`CounterSalesScreen` keys
       * `BranchCounter` on the company and branch), so nothing typed before
       * the switch is still in hand after it.
       * "La" settles and is answered; "Lay" is typed; the branch is switched
       * before "Lay" settles; "Layl" is typed before the switch has settled.
       * The only settled entry in hand is still "La", from the branch left.
       */
      await staged(carries, async (stage) => {
        stage.show('La', 'A', 0);
        await stage.wait(400);
        await stage.answerAll();
        expect(stage.reads()).toEqual(['300 La@A']);
        expect(stage.shown()).toBe('A:ready:A/La');

        stage.show('Lay', 'A', 0);
        await stage.wait(100);
        expect(stage.reads()).toEqual(['300 La@A']);

        // The switch is a submission of what is in the box now.
        stage.show('Lay', 'B', 1);
        await stage.answerAll();
        expect(stage.reads()).toEqual(['300 La@A', '500 Lay@B']);
        expect(stage.shown()).toBe('B:ready:B/Lay');

        // Typed on 100 ms later. "La" must not be asked of the new branch, and
        // the answer in hand stays the new branch's own.
        await stage.wait(100);
        stage.show('Layl', 'B', 1);
        await stage.answerAll();
        expect(stage.reads()).toEqual(['300 La@A', '500 Lay@B']);
        expect(stage.shown()).toBe('B:ready:B/Lay');
        await stage.wait(SEARCH_DEBOUNCE_MS - 1);
        await stage.answerAll();
        expect(stage.reads()).toEqual(['300 La@A', '500 Lay@B']);
        expect(stage.shown()).toBe('B:ready:B/Lay');

        await stage.wait(1);
        expect(stage.reads()).toEqual(['300 La@A', '500 Lay@B', '900 Layl@B']);
        await stage.answerAll();
        expect(stage.shown()).toBe('B:ready:B/Layl');
        await stage.wait(1000);
        expect(stage.reads()).toHaveLength(3);
      });
    }
  );

  it.each([0, 100, 299] as const)(
    'a shorter term had settled, the rest was typed, and the branch switched %i ms after the last keystroke: the settled term is not asked again',
    async (after) => {
      // The first table's quick rows found nothing to fall back to only because
      // nothing had settled. Here "La" has, and the pause for "Layla" has not
      // run out when the picker empties its term on the switch.
      await staged(true, async (stage) => {
        stage.show('La', 'A', 0);
        await stage.wait(400);
        await stage.answerAll();
        expect(stage.reads()).toEqual(['300 La@A']);
        expect(stage.shown()).toBe('A:ready:A/La');

        for (const term of ['Lay', 'Layl', 'Layla']) stage.show(term, 'A', 0);
        await stage.wait(after);
        expect(stage.reads()).toEqual(['300 La@A']);
        expect(stage.shown()).toBe('A:ready:A/La');

        stage.show('', 'B', 1);
        let elapsed = 0;
        for (const instant of AFTER_THE_SWITCH) {
          await stage.wait(instant - elapsed);
          elapsed = instant;
          await stage.answerAll();
          expect(stage.reads(), `reads ${instant} ms after the switch`).toEqual(['300 La@A']);
          expect(stage.shown(), `shown ${instant} ms after the switch`).toBe('B:idle:');
        }
      });
    }
  );
});

describe('a list filter that comes back to the day it had settled on', () => {
  /**
   * A key the hook wants is always read.
   *
   * The hook keeps the criteria behind each key in a map of eight and drops the
   * oldest. The key it asks for while the operator is still changing a filter
   * is the SETTLED one, which can be many changes old; the read effect used to
   * return when the map no longer held it — no read, no state — with the
   * request name already spent. Coming back to that same settled key then
   * changed nothing the effect watches, so nothing was ever sent: "Loading" for
   * good, and a submit answered by a read "already in flight" that did not
   * exist (`P1-32-PRE-OD-LFD`; on the site, the service catalogue's day filter
   * retyped three times without a pause, ending on the day it began with).
   *
   * The shape below is that screen's: criteria that are never null — no day is
   * the whole list — a submission of the whole list in hand from the change of
   * working context every screen sees as it loads, one day settled, and then
   * more than eight other days without a pause.
   */
  interface Filter {
    readonly day?: string;
  }

  interface Sent {
    readonly at: number;
    readonly day: string;
    answered: boolean;
    readonly answer: (value: unknown) => void;
  }

  function FilterHarness({
    day,
    version,
    sent,
    startedAt,
  }: {
    readonly day: string;
    readonly version: number;
    readonly sent: Sent[];
    readonly startedAt: number;
  }) {
    const criteria: Filter = day === '' ? {} : { day };
    const search = useSearchRequest<Found, Filter>({
      criteria,
      version,
      load: ((asked: Filter) =>
        new Promise((resolve) => {
          sent.push({
            at: Date.now() - startedAt,
            day: asked.day ?? 'whole list',
            answered: false,
            answer: resolve,
          });
        })) as never,
    });
    return (
      <div>
        <p data-testid="filter">{day === '' ? 'no day' : day}</p>
        <p data-testid="phase">{search.phase}</p>
        <p data-testid="rows">{search.rows.map((row) => row.id).join(',')}</p>
        <button type="button" onClick={search.submit}>
          ask now
        </button>
      </div>
    );
  }

  interface Stage {
    /** Every read sent so far: the day it asked for, or "whole list". */
    readonly reads: () => readonly string[];
    /** What the filter shows, the phase, and the day the rows on screen were read for. */
    readonly shown: () => string;
    readonly show: (day: string, version: number) => void;
    readonly submit: () => void;
    readonly wait: (ms: number) => Promise<void>;
    readonly answerAll: () => Promise<void>;
  }

  async function staged(run: (stage: Stage) => Promise<void>) {
    vi.useFakeTimers();
    try {
      const sent: Sent[] = [];
      const startedAt = Date.now();
      const host = (day: string, version: number) => (
        <FilterHarness day={day} version={version} sent={sent} startedAt={startedAt} />
      );
      const view = renderLtr(host('', 0));
      const tick = (ms: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      // One millisecond to an `act`, as in the block above, so a read is sent
      // in the millisecond its timer fired.
      const wait = async (ms: number) => {
        if (ms === 0) await tick(0);
        for (let passed = 0; passed < ms; passed += 1) await tick(1);
      };
      await run({
        reads: () => sent.map((read) => read.day),
        shown: () =>
          [
            screen.getByTestId('filter').textContent,
            screen.getByTestId('phase').textContent,
            screen.getByTestId('rows').textContent,
          ].join(':'),
        show: (day, version) => view.rerender(host(day, version)),
        submit: () => {
          fireEvent.click(screen.getByRole('button', { name: 'ask now' }));
        },
        wait,
        answerAll: async () => {
          for (const read of sent) {
            if (read.answered) continue;
            read.answered = true;
            read.answer(okPage([{ id: read.day }]));
          }
          await wait(0);
        },
      });
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  }

  /** Nine whole days a retyped date passes through — one more than the map keeps. */
  const PASSED_THROUGH = [
    '2028-03-15',
    '2028-01-15',
    '2028-11-15',
    '0202-11-15',
    '2026-11-15',
    '2026-11-01',
    '2026-01-01',
    '0202-01-01',
    '2027-01-01',
  ] as const;

  /** The screen as it stands once loaded: the whole list submitted, then one day settled. */
  async function loadedOnADay(stage: Stage): Promise<void> {
    await stage.answerAll();
    // The change of working context: a submission of the criteria in hand.
    stage.show('', 1);
    await stage.answerAll();
    stage.show('2028-03-01', 1);
    await stage.wait(SEARCH_DEBOUNCE_MS);
    await stage.answerAll();
    expect(stage.reads()).toEqual(['whole list', 'whole list', '2028-03-01']);
    expect(stage.shown()).toBe('2028-03-01:ready:2028-03-01');
  }

  it.each([0, 50, 150, 299])(
    'nine days passed through %i ms apart, the day dropped once, and back on the settled day: it is read and shown',
    async (gap) => {
      await staged(async (stage) => {
        await loadedOnADay(stage);

        // No pause long enough to settle: the settled day stays the one asked,
        // and nothing is sent.
        for (const day of PASSED_THROUGH) {
          await stage.wait(gap);
          stage.show(day, 1);
        }
        await stage.answerAll();
        expect(stage.reads()).toHaveLength(3);
        expect(stage.shown()).toBe('2027-01-01:ready:2028-03-01');

        // The day is dropped for a moment: the whole list is the submitted
        // criteria, so it is read at once.
        await stage.wait(gap);
        stage.show('', 1);
        await stage.answerAll();
        expect(stage.reads()).toEqual(['whole list', 'whole list', '2028-03-01', 'whole list']);
        expect(stage.shown()).toBe('no day:ready:whole list');

        // On to another day, then back to the day that had settled. The hook is
        // asking for the settled day again from the first of these; that read
        // must go out although the map dropped the day eight keys ago.
        await stage.wait(gap);
        stage.show('0202-03-01', 1);
        await stage.wait(gap);
        stage.show('2028-03-01', 1);
        await stage.answerAll();
        expect(stage.reads()).toEqual([
          'whole list',
          'whole list',
          '2028-03-01',
          'whole list',
          '2028-03-01',
        ]);
        expect(stage.shown()).toBe('2028-03-01:ready:2028-03-01');

        // Nothing more is owed: the day shown is the day applied.
        await stage.wait(3000);
        await stage.answerAll();
        expect(stage.reads()).toHaveLength(5);
        expect(stage.shown()).toBe('2028-03-01:ready:2028-03-01');

        // And a submit is a refresh of that day, not a press that sends nothing.
        stage.submit();
        await stage.answerAll();
        expect(stage.reads().slice(5)).toEqual(['2028-03-01']);
        expect(stage.shown()).toBe('2028-03-01:ready:2028-03-01');
      });
    }
  );

  it('the same entries 301 ms apart: each day settles and is read, and the last read is the day shown', async () => {
    await staged(async (stage) => {
      await loadedOnADay(stage);
      for (const day of [...PASSED_THROUGH, '', '0202-03-01', '2028-03-01']) {
        await stage.wait(SEARCH_DEBOUNCE_MS + 1);
        await stage.answerAll();
        stage.show(day, 1);
      }
      await stage.wait(3000);
      await stage.answerAll();
      expect(stage.reads().slice(3)).toEqual([
        ...PASSED_THROUGH,
        'whole list',
        '0202-03-01',
        '2028-03-01',
      ]);
      expect(stage.shown()).toBe('2028-03-01:ready:2028-03-01');
    });
  });
});
