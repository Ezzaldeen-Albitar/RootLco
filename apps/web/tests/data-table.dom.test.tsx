import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import {
  INITIAL_REQUEST,
  type TableRequest,
  type TableResponse,
} from '@/components/data-table/table-state';
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
