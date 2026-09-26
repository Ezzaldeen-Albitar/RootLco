import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OperationalGrid,
  mergeGridLocaleText,
  sortRequestFrom,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest } from '@/lib/api/use-search-request';
import { forgetRememberedBranch } from './support/branch-switch';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';

/**
 * The operational grid (ADR-022 PR1): `DataTable`'s contract on the MUI X
 * Community data grid.
 *
 * Every case drives the grid through the REAL read hooks — `useServerTable`, or
 * a search's `useSearchRequest(...).table` — with a loader that records what it
 * was asked. So what is proved is the whole path an operator's click takes: the
 * grid changes the request, the hook spends the cursor, the loader is asked for
 * exactly that, and the answer lands in the grid or is dropped.
 */

const en = getMessages('en');
const ar = getMessages('ar');

interface Doc {
  readonly id: string;
  readonly reference: string;
  readonly note: string;
}

const doc = (n: number): Doc => ({
  id: `doc-${n}`,
  reference: `DOC-${String(n).padStart(4, '0')}`,
  note: `Note ${n}`,
});

function ok(rows: readonly Doc[], nextCursor: string | null): ServerPage<Doc> {
  return { status: 'ok', rows, nextCursor, hasMore: nextCursor !== null, correlationId: 'corr-1' };
}

function failed(status: ServerPage<Doc>['status']): ServerPage<Doc> {
  return { status, rows: [], nextCursor: null, hasMore: false, correlationId: 'corr-9' };
}

const COLUMNS: readonly OperationalColumn<Doc>[] = [
  { id: 'reference', headerKey: 'column.reference', sortable: true, cell: (row) => row.reference },
  { id: 'note', headerKey: 'column.description', cell: (row) => row.note, hideBelow: 'md' },
];

const OPEN_ACTION = (row: Doc): readonly RowAction[] => [
  { kind: 'link', label: 'Open', href: `/docs/${row.id}`, about: row.reference },
];

type Loader = (request: TableRequest, cursor: string | null) => Promise<ServerPage<Doc>>;

function Harness({
  load,
  locale = 'en',
  loadKey,
  initial,
  rowActions,
  suppressEmptyState,
  columns = COLUMNS,
}: {
  readonly load: Loader;
  readonly locale?: Locale;
  readonly loadKey?: string;
  readonly initial?: TableRequest;
  readonly rowActions?: (row: Doc) => readonly RowAction[];
  readonly suppressEmptyState?: boolean;
  readonly columns?: readonly OperationalColumn<Doc>[];
}) {
  const table = useServerTable(load, {
    initial: initial ?? { ...INITIAL_REQUEST, pageSize: 10 },
    ...(loadKey === undefined ? {} : { loadKey }),
  });
  return (
    <OperationalGrid
      messages={getMessages(locale)}
      locale={locale}
      label="Documents"
      columns={columns}
      rowId={(row) => row.id}
      table={table}
      filterDefinitions={[
        {
          key: 'status',
          labelKey: 'column.status',
          options: [{ value: 'open', labelKey: 'fixture.statusOpen' }],
        },
      ]}
      rowActions={rowActions}
      suppressEmptyState={suppressEmptyState}
    />
  );
}

function mount(ui: ReactElement, locale: Locale = 'en') {
  const messages = getMessages(locale);
  const renderIn = locale === 'ar' ? renderRtl : renderLtr;
  return renderIn(
    <UiFoundationProvider locale={locale} text={muiTextOf(messages)}>
      {ui}
    </UiFoundationProvider>
  );
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Every declaration the emitted styles give a grid class, joined. */
function declaredFor(className: string): string {
  const sheet = [...document.head.querySelectorAll<HTMLStyleElement>('style[data-emotion]')]
    .map((style) => style.textContent ?? '')
    .join('\n');
  const rule = new RegExp(`\\.${className}\\{([^}]*)\\}`, 'g');
  return [...sheet.matchAll(rule)].map((match) => match[1]).join(';');
}

const pageLabel = () => screen.getByTestId('operational-grid-page');
const next = () => screen.getByRole('button', { name: en['table.nextPage'] });
const previous = () => screen.getByRole('button', { name: en['table.previousPage'] });

afterEach(() => {
  vi.restoreAllMocks();
  for (const style of document.head.querySelectorAll('style')) style.remove();
});

describe('server paging walks the cursor stack', () => {
  it('reads page one with no cursor and shows its rows as grid cells', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1), doc(2)], 'c-2'));
    mount(<Harness load={load} />);

    expect(await screen.findByRole('gridcell', { name: 'DOC-0001' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Documents' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[1]).toBeNull();
    expect(load.mock.calls[0]?.[0]).toMatchObject({ page: 1, pageSize: 10 });
    expect(pageLabel()).toHaveTextContent('Page 1');
  });

  it('Next spends the cursor page one returned; Previous spends the one that opened page one', async () => {
    const load = vi
      .fn<Loader>()
      .mockResolvedValueOnce(ok([doc(1)], 'c-2'))
      .mockResolvedValueOnce(ok([doc(11)], 'c-3'))
      .mockResolvedValueOnce(ok([doc(1)], 'c-2'));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });

    await user.click(next());
    expect(await screen.findByRole('gridcell', { name: 'DOC-0011' })).toBeInTheDocument();
    expect(load.mock.calls[1]?.[0]).toMatchObject({ page: 2 });
    expect(load.mock.calls[1]?.[1]).toBe('c-2');
    expect(pageLabel()).toHaveTextContent('Page 2');
    expect(screen.queryByRole('gridcell', { name: 'DOC-0001' })).toBeNull();

    await user.click(previous());
    expect(await screen.findByRole('gridcell', { name: 'DOC-0001' })).toBeInTheDocument();
    expect(load.mock.calls[2]?.[0]).toMatchObject({ page: 1 });
    expect(load.mock.calls[2]?.[1]).toBeNull();
    expect(pageLabel()).toHaveTextContent('Page 1');
  });

  it('offers Next only when the page READ says more exist — never while loading, never at the end', async () => {
    const second = deferred<ServerPage<Doc>>();
    const load = vi
      .fn<Loader>()
      .mockResolvedValueOnce(ok([doc(1)], 'c-2'))
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    expect(next()).toBeEnabled();
    expect(previous()).toBeDisabled();

    await user.click(next());
    // In flight: no cursor for page three exists yet, so there is no Next.
    expect(next()).toBeDisabled();
    second.resolve(ok([doc(11)], null));
    await screen.findByRole('gridcell', { name: 'DOC-0011' });
    // The server says the set ends here.
    expect(next()).toBeDisabled();
    expect(previous()).toBeEnabled();
  });

  it('a header sort changes the REQUEST, restarts at page one and spends no old cursor', async () => {
    const load = vi
      .fn<Loader>()
      .mockResolvedValueOnce(ok([doc(1)], 'c-2'))
      .mockResolvedValueOnce(ok([doc(11)], 'c-3'))
      .mockResolvedValue(ok([doc(5)], 'c-x'));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    await user.click(next());
    await screen.findByRole('gridcell', { name: 'DOC-0011' });

    const header = screen.getByRole('columnheader', { name: /Reference/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await user.click(header);

    await screen.findByRole('gridcell', { name: 'DOC-0005' });
    const asked = load.mock.calls.at(-1);
    expect(asked?.[0]).toMatchObject({
      page: 1,
      sort: { columnId: 'reference', direction: 'asc' },
    });
    expect(asked?.[1]).toBeNull();
    expect(pageLabel()).toHaveTextContent('Page 1');
    expect(screen.getByRole('columnheader', { name: /Reference/ })).toHaveAttribute(
      'aria-sort',
      'ascending'
    );
  });

  it('offers no sort on a column that did not ask for one', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1)], null));
    mount(<Harness load={load} />);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    const description = screen.getByRole('columnheader', { name: en['column.description'] });
    expect(within(description).queryByRole('button')).toBeNull();
  });

  it('maps a sort model onto the request, and ignores one that changes nothing', () => {
    const request: TableRequest = { ...INITIAL_REQUEST, page: 4 };
    expect(sortRequestFrom(request, [{ field: 'reference', sort: 'desc' }])).toMatchObject({
      page: 1,
      sort: { columnId: 'reference', direction: 'desc' },
    });
    expect(sortRequestFrom(request, [])).toBeNull();
    const sorted: TableRequest = { ...request, sort: { columnId: 'reference', direction: 'asc' } };
    expect(sortRequestFrom(sorted, [{ field: 'reference', sort: 'asc' }])).toBeNull();
    expect(sortRequestFrom(sorted, [])).toMatchObject({ sort: null, page: 1 });
  });

  it('a new page size is a new set: page one, no cursor', async () => {
    const load = vi
      .fn<Loader>()
      .mockResolvedValueOnce(ok([doc(1)], 'c-2'))
      .mockResolvedValueOnce(ok([doc(11)], 'c-3'))
      .mockResolvedValue(ok([doc(1), doc(2)], null));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    await user.click(next());
    await screen.findByRole('gridcell', { name: 'DOC-0011' });

    await user.selectOptions(screen.getByLabelText(en['table.rowsPerPage']), '25');
    await screen.findByRole('gridcell', { name: 'DOC-0002' });
    expect(load.mock.calls.at(-1)?.[0]).toMatchObject({ page: 1, pageSize: 25 });
    expect(load.mock.calls.at(-1)?.[1]).toBeNull();
    // The sizes are the product's, all within the MIT edition's limit of 100.
    const sizes = within(screen.getByLabelText(en['table.rowsPerPage']))
      .getAllByRole('option')
      .map((option) => Number((option as HTMLOptionElement).value));
    expect(sizes).toEqual([10, 25, 50, 100]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
  });
});

describe('no total, anywhere', () => {
  it('labels the last page by its number and never prints a count, a range or "of"', async () => {
    const load = vi
      .fn<Loader>()
      .mockResolvedValueOnce(ok([doc(1), doc(2)], 'c-2'))
      .mockResolvedValueOnce(ok([doc(11), doc(12), doc(13)], null));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    await user.click(next());
    await screen.findByRole('gridcell', { name: 'DOC-0013' });

    const region = screen.getByTestId('operational-grid');
    expect(pageLabel()).toHaveTextContent(/^Page 2$/);
    // The page size is ten and this second page holds three rows, so the only
    // "total" the grid could derive is 10 + 3 = 13 — it counts page one as a
    // full page of ten, though that page held two. Neither it nor a range nor
    // a size claim is printed.
    const nav = screen.getByRole('navigation', { name: en['table.pagination'] });
    expect(nav.textContent).not.toMatch(/13|\bof\b|–|more than/);
    expect(region.textContent).not.toMatch(/\bof\b|–|more than/);
    expect(region.querySelector('.MuiDataGrid-footerContainer')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /export|print|csv/i })).toEqual([]);
  });

  it('FALSIFICATION: the library default on the same last page DOES print a derived total', () => {
    // A bare grid with the library's own footer and texts (an empty
    // `localeText` replaces the theme's): the assertion above is able to fail,
    // because this is what it would have seen.
    mount(
      <DataGrid
        aria-label="Bare"
        localeText={{}}
        rows={[doc(11), doc(12), doc(13)]}
        columns={[{ field: 'reference' }]}
        paginationMode="server"
        rowCount={-1}
        paginationMeta={{ hasNextPage: false }}
        paginationModel={{ page: 1, pageSize: 10 }}
        pageSizeOptions={[10]}
        disableVirtualization
      />
    );
    const footer = document.querySelector('.MuiDataGrid-footerContainer');
    // "11–20 of more than 20": a range and a claim about the size of the set.
    expect(footer?.textContent ?? '').toMatch(/–/);
    expect(footer?.textContent ?? '').toMatch(/\bof\b|more than/);
  });

  it('walks past a page it once saw as the end after the criteria change', async () => {
    // The grid keeps a count it derived from a last page; this proves the
    // wrapper's reset: page three of a NEW set is reachable and read.
    const load = vi
      .fn<Loader>()
      .mockResolvedValueOnce(ok([doc(1)], null))
      .mockResolvedValueOnce(ok([doc(21)], 'n-2'))
      .mockResolvedValueOnce(ok([doc(22)], 'n-3'))
      .mockResolvedValueOnce(ok([doc(23)], null));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    expect(next()).toBeDisabled();

    await user.click(screen.getByRole('columnheader', { name: /Reference/ }));
    await screen.findByRole('gridcell', { name: 'DOC-0021' });
    await user.click(next());
    await screen.findByRole('gridcell', { name: 'DOC-0022' });
    await user.click(next());
    await screen.findByRole('gridcell', { name: 'DOC-0023' });
    expect(load.mock.calls.at(-1)?.[1]).toBe('n-3');
    expect(pageLabel()).toHaveTextContent('Page 3');
  });
});

describe('every state reads as itself', () => {
  it('a refusal replaces the grid: no rows, no grid, no retry', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(failed('denied'));
    mount(<Harness load={load} />);
    const refusal = await screen.findByTestId('state-refused');
    expect(refusal).toHaveTextContent(en['state.denied.title']);
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('button', { name: en['state.retry'] })).toBeNull();
    expect(refusal).toHaveTextContent('corr-9');
  });

  it('an outage offers a retry that reads again, and the reference', async () => {
    const load = vi
      .fn<Loader>()
      .mockResolvedValueOnce(failed('unavailable'))
      .mockResolvedValue(ok([doc(1)], null));
    const user = userEvent.setup();
    mount(<Harness load={load} />);
    const state = await screen.findByTestId('state-unavailable');
    expect(state).toHaveTextContent(en['state.unavailable.title']);
    expect(state).toHaveTextContent('corr-9');
    await user.click(within(state).getByRole('button', { name: en['state.retry'] }));
    expect(await screen.findByRole('gridcell', { name: 'DOC-0001' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a fault offers a retry; an ended session offers only the way back to signing in', async () => {
    const faulty = vi.fn<Loader>().mockResolvedValue(failed('error'));
    const { unmount } = mount(<Harness load={faulty} />);
    const fault = await screen.findByTestId('state-error');
    expect(within(fault).getByRole('button', { name: en['state.retry'] })).toBeInTheDocument();
    unmount();

    const expired = vi.fn<Loader>().mockResolvedValue(failed('expired'));
    mount(<Harness load={expired} />);
    const ended = await screen.findByTestId('state-expired');
    expect(within(ended).queryByRole('button', { name: en['state.retry'] })).toBeNull();
    expect(within(ended).getByRole('link', { name: en['auth.backToLogin'] })).toHaveAttribute(
      'href',
      '/en/login'
    );
  });

  it('a missing record reads as not found', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(failed('not-found'));
    mount(<Harness load={load} />);
    expect(await screen.findByTestId('state-not-found')).toHaveTextContent(
      en['state.notFound.title']
    );
  });

  it('loading keeps the header and is busy; the zero-row states come only from an answer', async () => {
    const first = deferred<ServerPage<Doc>>();
    const load = vi.fn<Loader>().mockReturnValueOnce(first.promise);
    mount(<Harness load={load} />);
    expect(screen.getByRole('columnheader', { name: /Reference/ })).toBeInTheDocument();
    expect(screen.getByRole('grid').closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId('state-empty')).toBeNull();

    first.resolve(ok([], null));
    const empty = await screen.findByTestId('state-empty');
    expect(empty).toHaveTextContent(en['state.empty.title']);
    expect(screen.getByRole('grid').closest('[aria-busy="true"]')).toBeNull();
  });

  it('a narrowed set that matched nothing says so, with a way back', async () => {
    const load = vi
      .fn<Loader>()
      .mockResolvedValueOnce(ok([], null))
      .mockResolvedValue(ok([doc(1)], null));
    const user = userEvent.setup();
    mount(
      <Harness
        load={load}
        initial={{ ...INITIAL_REQUEST, pageSize: 10, filters: [{ key: 'status', value: 'open' }] }}
      />
    );
    const none = await screen.findByTestId('state-no-results');
    expect(none).toHaveTextContent(en['state.noResults.title']);
    await user.click(within(none).getByRole('button', { name: en['table.clearFilters'] }));
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    expect(load.mock.calls.at(-1)?.[0]).toMatchObject({ filters: [], page: 1 });
  });

  it('draws no zero-row state for a caller that renders its own', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(ok([], null));
    mount(<Harness load={load} suppressEmptyState />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('grid').closest('[aria-busy]')).toBeNull());
    expect(screen.queryByTestId('state-empty')).toBeNull();
    expect(screen.queryByTestId('state-no-results')).toBeNull();
  });

  it('removes one filter from its chip', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1)], null));
    const user = userEvent.setup();
    mount(
      <Harness
        load={load}
        initial={{ ...INITIAL_REQUEST, pageSize: 10, filters: [{ key: 'status', value: 'open' }] }}
      />
    );
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    await user.click(screen.getByRole('button', { name: /Remove this filter/ }));
    await waitFor(() => expect(load.mock.calls.at(-1)?.[0]).toMatchObject({ filters: [] }));
  });
});

describe('a working-context switch isolates the read', () => {
  function VersionedHarness({ load }: { readonly load: Loader }) {
    const context = useWorkingContext();
    return <Harness load={load} loadKey={String(context.version)} />;
  }

  afterEach(() => forgetRememberedBranch());

  it('drops the previous branch reply, and reads page one of the new branch with no cursor', async () => {
    const late = deferred<ServerPage<Doc>>();
    const load = vi
      .fn<Loader>()
      // Before a branch is chosen (version 0), and again once it is (version 1).
      .mockResolvedValueOnce(ok([doc(1)], 'c-2'))
      .mockResolvedValueOnce(ok([doc(1)], 'c-2'))
      .mockReturnValueOnce(late.promise)
      .mockResolvedValue(ok([doc(31)], null));
    const user = userEvent.setup();
    mount(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <VersionedHarness load={load} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    await user.click(next());
    await waitFor(() => expect(load.mock.calls.at(-1)?.[1]).toBe('c-2'));

    // Page two of the old branch is still out when the branch changes.
    await user.click(screen.getByRole('button', { name: 'use second' }));
    await screen.findByRole('gridcell', { name: 'DOC-0031' });
    expect(load.mock.calls.at(-1)?.[0]).toMatchObject({ page: 1 });
    expect(load.mock.calls.at(-1)?.[1]).toBeNull();

    late.resolve(ok([doc(12)], 'c-3'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('gridcell', { name: 'DOC-0012' })).toBeNull();
    expect(screen.getByRole('gridcell', { name: 'DOC-0031' })).toBeInTheDocument();
    expect(pageLabel()).toHaveTextContent('Page 1');
  });

  function SearchHarness({
    load,
  }: {
    readonly load: (
      term: string,
      cursor: string | null,
      signal: AbortSignal
    ) => Promise<ReadState<CursorPage<Doc>>>;
  }) {
    const context = useWorkingContext();
    const search = useSearchRequest<Doc, string>({
      criteria: context.selection === null ? null : 'all',
      load,
      version: context.version,
      debounceMs: 0,
    });
    return (
      <OperationalGrid
        messages={en}
        label="Documents"
        columns={COLUMNS}
        rowId={(row) => row.id}
        table={search.table}
      />
    );
  }

  it('aborts the search in flight on a switch and never draws its answer', async () => {
    const signals: AbortSignal[] = [];
    const late = deferred<ReadState<CursorPage<Doc>>>();
    const load = vi
      .fn()
      .mockImplementationOnce(async () => ({
        status: 'ok',
        data: { items: [doc(1)], nextCursor: null, hasMore: false },
        correlationId: null,
      }))
      .mockImplementationOnce((_term: string, _cursor: string | null, signal: AbortSignal) => {
        signals.push(signal);
        return late.promise;
      })
      .mockImplementation(async () => ({
        status: 'ok',
        data: { items: [doc(41)], nextCursor: null, hasMore: false },
        correlationId: null,
      }));
    const user = userEvent.setup();
    mount(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <BranchSwitch to="all" label="use all" />
          <SearchHarness load={load} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    await user.click(screen.getByRole('button', { name: 'use second' }));
    await waitFor(() => expect(signals).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'use all' }));

    await screen.findByRole('gridcell', { name: 'DOC-0041' });
    expect(signals[0]?.aborted).toBe(true);
    late.resolve({
      status: 'ok',
      data: { items: [doc(99)], nextCursor: null, hasMore: false },
      correlationId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('gridcell', { name: 'DOC-0099' })).toBeNull();
  });
});

type SearchLoader = (
  term: string,
  cursor: string | null,
  signal: AbortSignal
) => Promise<ReadState<CursorPage<Doc>>>;

function found(
  items: readonly Doc[],
  nextCursor: string | null = null
): ReadState<CursorPage<Doc>> {
  return {
    status: 'ok',
    data: { items, nextCursor, hasMore: nextCursor !== null },
    correlationId: 'corr-1',
  };
}

function TermHarness({
  load,
  term,
  narrows,
}: {
  readonly load: SearchLoader;
  readonly term: string;
  readonly narrows?: (criteria: string) => boolean;
}) {
  const search = useSearchRequest<Doc, string>({
    criteria: term,
    load,
    debounceMs: 0,
    ...(narrows ? { narrows } : {}),
  });
  return (
    <OperationalGrid
      messages={en}
      label="Documents"
      columns={COLUMNS}
      rowId={(row) => row.id}
      table={search.table}
    />
  );
}

describe('a search source: only the controls it honours, and its own "no matches"', () => {
  it('offers no rows-per-page choice and no header sort over a search, and a click reads nothing', async () => {
    const load = vi.fn<SearchLoader>().mockResolvedValue(found([doc(1)], 'c-2'));
    const user = userEvent.setup();
    const { unmount } = mount(<TermHarness load={load} term="DOC" />);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });

    expect(screen.queryByLabelText(en['table.rowsPerPage'])).toBeNull();
    const header = screen.getByRole('columnheader', { name: /Reference/ });
    expect(within(header).queryByRole('button')).toBeNull();
    await user.click(header);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('columnheader', { name: /Reference/ })).not.toHaveAttribute(
      'aria-sort',
      'ascending'
    );
    // Paging IS honoured: Next still spends the cursor page one returned.
    await user.click(next());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load.mock.calls[1]?.[1]).toBe('c-2');
    unmount();

    // FALSIFICATION: the same columns over `useServerTable`, which honours
    // both, DO offer the choice and the sort — the absence above is the source's.
    const table = vi.fn<Loader>().mockResolvedValue(ok([doc(1)], null));
    mount(<Harness load={table} />);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    expect(screen.getByLabelText(en['table.rowsPerPage'])).toBeInTheDocument();
    expect(
      within(screen.getByRole('columnheader', { name: /Reference/ })).queryAllByRole('button')
        .length
    ).toBeGreaterThan(0);
  });

  it('a search that matched nothing says so for the search, never "nothing here yet"', async () => {
    const load = vi.fn<SearchLoader>().mockResolvedValue(found([]));
    mount(<TermHarness load={load} term="zz" />);
    const none = await screen.findByTestId('state-no-results');
    expect(none).toHaveTextContent(en['state.noSearchMatches.title']);
    expect(none).toHaveTextContent(en['state.noSearchMatches.description']);
    expect(screen.queryByTestId('state-empty')).toBeNull();
    expect(screen.getByTestId('operational-grid')).not.toHaveTextContent(en['state.empty.title']);
    // Its criteria are not the request's, so there is no filter to clear.
    expect(screen.queryByRole('button', { name: en['table.clearFilters'] })).toBeNull();
  });

  it('FALSIFICATION: criteria the caller says do not narrow read as an empty set', async () => {
    const load = vi.fn<SearchLoader>().mockResolvedValue(found([]));
    mount(<TermHarness load={load} term="scope" narrows={() => false} />);
    const empty = await screen.findByTestId('state-empty');
    expect(empty).toHaveTextContent(en['state.empty.title']);
    expect(screen.queryByTestId('state-no-results')).toBeNull();
  });

  it('names a filter it was not told about generically, never by its key or value', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1)], null));
    mount(
      <Harness
        load={load}
        initial={{
          ...INITIAL_REQUEST,
          pageSize: 10,
          filters: [
            { key: 'status', value: 'open' },
            { key: 'internalBucket', value: 'bucket-7' },
          ],
        }}
      />
    );
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    const region = screen.getByTestId('operational-grid');
    expect(region).toHaveTextContent(en['table.filterApplied']);
    expect(region.textContent).not.toMatch(/internalBucket|bucket-7/);
    // The filter it WAS told about keeps its own name.
    expect(region).toHaveTextContent(en['column.status']);
  });
});

describe('texts, direction and keyboard', () => {
  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('merges its page label with the theme texts (%s)', async (locale, messages) => {
    const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1)], 'c-2'));
    mount(<Harness load={load} locale={locale} />, locale);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    // A theme text the wrapper does not set: present only if the texts merged.
    expect(
      screen.getAllByRole('button', { name: messages['mui.grid.columnSortLabel'] }).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole('columnheader', { name: new RegExp(messages['column.reference']) })
    ).toBeInTheDocument();
    expect(pageLabel()).toHaveTextContent(messages['mui.pagination.page'].replace('{page}', '1'));
    expect(
      screen.getByRole('navigation', { name: messages['table.pagination'] })
    ).toBeInTheDocument();
  });

  it('FALSIFICATION: a grid handed only its own text loses the theme text', () => {
    // What "replaced, not merged" looks like: the Arabic sort label is gone and
    // the library's English is back. The merged case above cannot pass this way.
    mount(
      <DataGrid
        aria-label="Bare"
        rows={[doc(1)]}
        columns={[{ field: 'reference', headerName: 'Reference', sortable: true }]}
        localeText={{ paginationDisplayedRows: () => 'x' }}
        disableVirtualization
      />,
      'ar'
    );
    expect(screen.queryAllByRole('button', { name: ar['mui.grid.columnSortLabel'] })).toEqual([]);
    expect(screen.getAllByRole('button', { name: 'Sort' }).length).toBeGreaterThan(0);
  });

  it('merges theme texts first and its own last', () => {
    const merged = mergeGridLocaleText(
      { noRowsLabel: 'theme', columnHeaderSortIconLabel: 'sort' },
      { noRowsLabel: 'own' }
    );
    expect(merged).toEqual({ noRowsLabel: 'own', columnHeaderSortIconLabel: 'sort' });
    expect(mergeGridLocaleText(undefined, { noRowsLabel: 'own' })).toEqual({ noRowsLabel: 'own' });
  });

  it('renders right to left in Arabic, with Arabic headers and the right-to-left styles', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1)], null));
    mount(<Harness load={load} locale="ar" />, 'ar');
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      screen.getByRole('columnheader', { name: new RegExp(ar['column.reference']) })
    ).toBeInTheDocument();
    const rtlStyles = [...document.head.querySelectorAll<HTMLStyleElement>('style[data-emotion]')]
      .filter((style) => (style.dataset.emotion ?? '').startsWith('muirtl'))
      .map((style) => style.textContent ?? '')
      .join('\n');
    expect(rtlStyles.length).toBeGreaterThan(0);
  });

  it('is one tab stop, moves by arrow keys, and reaches a named row action', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1), doc(2)], null));
    const user = userEvent.setup();
    mount(
      <>
        <button type="button">before</button>
        <Harness load={load} rowActions={OPEN_ACTION} />
      </>
    );
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    screen.getByRole('button', { name: 'before' }).focus();

    await user.tab();
    expect(document.activeElement).toHaveAttribute('role', 'columnheader');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAttribute('role', 'gridcell');
    expect(document.activeElement).toHaveTextContent('DOC-0001');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName('Open DOC-0001');
    expect(document.activeElement?.tagName).toBe('A');
    expect(document.activeElement).toHaveAttribute('href', '/docs/doc-1');
  });

  it('reaches a SECOND action in the same cell by Tab, and runs it from the keyboard', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1), doc(2)], null));
    const release = vi.fn();
    const user = userEvent.setup();
    mount(
      <>
        <button type="button">before</button>
        <Harness
          load={load}
          rowActions={(row) => [
            ...OPEN_ACTION(row),
            {
              kind: 'button',
              label: 'Release',
              onClick: () => release(row.id),
              about: row.reference,
            },
          ]}
        />
      </>
    );
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    screen.getByRole('button', { name: 'before' }).focus();
    await user.tab();
    await user.keyboard('{ArrowDown}{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName('Open DOC-0001');

    await user.tab();
    expect(document.activeElement).toHaveAccessibleName('Release DOC-0001');
    expect(document.activeElement?.tagName).toBe('BUTTON');
    await user.keyboard('{Enter}');
    expect(release).toHaveBeenCalledWith('doc-1');
  });

  it('renders a page of one hundred rows and walks it end to end by keyboard', async () => {
    const hundred = Array.from({ length: 100 }, (_, index) => doc(index + 1));
    const load = vi.fn<Loader>().mockResolvedValue(ok(hundred, null));
    const user = userEvent.setup();
    const started = performance.now();
    mount(
      <>
        <button type="button">before</button>
        <Harness load={load} initial={{ ...INITIAL_REQUEST, pageSize: 100 }} />
      </>
    );
    await screen.findByRole('gridcell', { name: 'DOC-0100' });
    // A smoke bound, deliberately loose: it catches a render gone
    // pathological, never a slow machine.
    expect(performance.now() - started).toBeLessThan(20_000);
    // The header row and every one of the hundred.
    expect(screen.getAllByRole('row')).toHaveLength(101);

    screen.getByRole('button', { name: 'before' }).focus();
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveTextContent('DOC-0001');
    await user.keyboard('{Control>}{End}{/Control}');
    expect(document.activeElement).toHaveAttribute('role', 'gridcell');
    expect(document.activeElement?.closest('[role="row"]')).toHaveTextContent('DOC-0100');
    await user.keyboard('{Control>}{Home}{/Control}');
    expect(document.activeElement).toHaveTextContent('DOC-0001');
  });

  it.each([
    ['en', 'right', 'left'],
    ['ar', 'left', 'right'],
  ] as const)(
    'aligns a numeric column to the logical end and text to the start (%s)',
    async (locale, endSide, startSide) => {
      const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1)], null));
      mount(
        <Harness
          load={load}
          locale={locale}
          columns={[
            { id: 'reference', headerKey: 'column.reference', cell: (row) => row.reference },
            { id: 'amount', headerKey: 'column.amount', numeric: true, cell: () => '12.50' },
          ]}
        />,
        locale
      );
      const amount = await screen.findByRole('gridcell', { name: '12.50' });
      const reference = screen.getByRole('gridcell', { name: 'DOC-0001' });
      // The column declares the END: the cell carries the grid's end class and
      // tabular figures, the text column the start class.
      expect(amount).toHaveClass('MuiDataGrid-cell--textRight', 'tabular-nums');
      expect(reference).toHaveClass('MuiDataGrid-cell--textLeft');
      // The styles the page actually has (jsdom does not cascade them, so they
      // are read from the emitted sheet). Under Arabic the physical sides swap,
      // so the end is on the LEFT; the flex end stays the logical end.
      const end = declaredFor('MuiDataGrid-cell--textRight');
      const start = declaredFor('MuiDataGrid-cell--textLeft');
      expect(end).toContain(`text-align:${endSide}`);
      expect(end).toContain('justify-content:flex-end');
      expect(end).not.toContain(`text-align:${startSide}`);
      expect(start).toContain(`text-align:${startSide}`);
      expect(start).toContain('justify-content:flex-start');
      expect(start).not.toContain(`text-align:${endSide}`);
    }
  );

  it('names every row action by what it acts on, and a button action runs', async () => {
    const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1), doc(2)], null));
    const release = vi.fn();
    const user = userEvent.setup();
    mount(
      <Harness
        load={load}
        rowActions={(row) => [
          ...OPEN_ACTION(row),
          {
            kind: 'button',
            label: 'Release',
            onClick: () => release(row.id),
            about: row.reference,
          },
        ]}
      />
    );
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    expect(screen.getByRole('link', { name: 'Open DOC-0001' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open DOC-0002' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Release DOC-0002' }));
    expect(release).toHaveBeenCalledWith('doc-2');
    expect(screen.getByRole('columnheader', { name: en['table.rowActions'] })).toBeInTheDocument();
  });

  it('steps a column aside below its breakpoint and keeps every other one', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          // Below `md` (and so below `lg`), but not below `sm`.
          matches: /max-width:\s*(767\.95|1023\.95)px/.test(query),
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList
    );
    const load = vi.fn<Loader>().mockResolvedValue(ok([doc(1)], null));
    mount(<Harness load={load} />);
    await screen.findByRole('gridcell', { name: 'DOC-0001' });
    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: en['column.description'] })).toBeNull()
    );
    expect(screen.getByRole('columnheader', { name: /Reference/ })).toBeInTheDocument();
    expect(screen.queryByText('Note 1')).toBeNull();
  });
});
