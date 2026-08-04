'use client';

import { useMemo, type ReactNode } from 'react';
import {
  EmptyState,
  ErrorState,
  NoResultsState,
  PermissionDeniedState,
  SkeletonRows,
} from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import {
  PAGE_SIZES,
  isNarrowed,
  pageCount,
  withPage,
  withPageSize,
  withToggledSort,
  withoutAllFilters,
  withoutFilter,
  type FilterDefinition,
  type TableRequest,
  type TableResponse,
} from './table-state';

/**
 * The shared operational table.
 *
 * The highest-traffic surface in the product: an operator looks at one of these
 * for most of a shift. Every decision below is aimed at that — no layout shift
 * when a page loads, a sticky header so the columns never leave, a density
 * setting, and controls that are reachable and legible without a mouse.
 *
 * It renders. It does not fetch, sort, filter or paginate — those are the
 * caller's, and ultimately the server's. See `table-state.ts`.
 */

export type TableStatus = 'idle' | 'loading' | 'error' | 'denied';

export interface Column<Row> {
  readonly id: string;
  readonly headerKey: string;
  readonly sortable?: boolean;
  /** Right-aligns numerics in LTR and left-aligns them in RTL — logical `end`. */
  readonly numeric?: boolean;
  readonly cell: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  readonly messages: Messages;
  readonly columns: readonly Column<Row>[];
  readonly rowId: (row: Row) => string;
  readonly request: TableRequest;
  readonly response: TableResponse<Row> | null;
  readonly status: TableStatus;
  readonly filterDefinitions?: readonly FilterDefinition[];
  readonly onRequestChange: (next: TableRequest) => void;
  readonly onRetry?: (() => void) | undefined;
  readonly correlationId?: string | undefined;
  readonly density?: 'comfortable' | 'compact';
  readonly hiddenColumnIds?: readonly string[];
  readonly rowActions?: ((row: Row) => ReactNode) | undefined;
  readonly caption?: string | undefined;
}

export function DataTable<Row>({
  messages,
  columns,
  rowId,
  request,
  response,
  status,
  filterDefinitions = [],
  onRequestChange,
  onRetry,
  correlationId,
  density = 'comfortable',
  hiddenColumnIds = [],
  rowActions,
  caption,
}: DataTableProps<Row>) {
  const visibleColumns = useMemo(
    () => columns.filter((column) => !hiddenColumnIds.includes(column.id)),
    [columns, hiddenColumnIds]
  );

  if (status === 'denied') {
    // Rendered INSTEAD of the table, never over it. A denied table that paints
    // its rows first and covers them with an overlay has already sent the data
    // to the browser.
    return <PermissionDeniedState messages={messages} correlationId={correlationId} />;
  }

  if (status === 'error') {
    return (
      <ErrorState
        messages={messages}
        correlationId={correlationId}
        action={
          onRetry ? (
            <button type="button" onClick={onRetry} className={BUTTON_PRIMARY}>
              {translate(messages, 'state.retry')}
            </button>
          ) : undefined
        }
      />
    );
  }

  const rows = response?.rows ?? [];
  // Three states, and only one of them has a number to print. `?? 0` would
  // turn "the server publishes no count" into "there are none" — a different and
  // much more confident claim — and `response ? … : 0` did the same thing while
  // LOADING, so every cursor-paginated table flashed "Showing 0–0 of 0" and
  // "1 / 1" before its first page arrived (finding P1-26-F-024). No response and
  // no published count are both "do not print a total".
  const total = response ? response.total : null;
  const pages = pageCount(total, request.pageSize);
  const hasMore = response?.hasMore ?? false;
  const rowHeight = density === 'compact' ? 'h-9' : 'h-11';

  return (
    <div className="flex flex-col gap-3">
      <FilterChips
        messages={messages}
        request={request}
        definitions={filterDefinitions}
        onRequestChange={onRequestChange}
      />

      {/*
        The scroll container, not the table, owns the overflow. A table that is
        itself `overflow-x: auto` cannot have a sticky header, and on a 1024px
        screen an operational table always has more columns than width.

        It is also bounded VERTICALLY (`P1-26-F-064`). Without a bound the rows
        push the page taller and taller: at the maximum page size of 100 that is
        already several screens of scrolling with the filters and the pager left
        far above and below. `max-h` keeps the pager reachable and makes the
        sticky header do its job — a header that is sticky inside a container
        that never scrolls has nothing to stick to.

        `70dvh` rather than a pixel figure so it holds on a laptop and on a
        large desktop alike, and the value is capped rather than fixed so a
        five-row table is still five rows tall.
      */}
      <div className="max-h-[70dvh] overflow-auto rounded-xl border border-border-subtle bg-surface shadow-xs">
        <table className="w-full border-collapse text-table-cell">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="sticky top-0 z-sticky border-b border-table-border bg-table-header">
            <tr>
              {visibleColumns.map((column) => (
                <HeaderCell
                  key={column.id}
                  messages={messages}
                  column={column}
                  request={request}
                  onRequestChange={onRequestChange}
                />
              ))}
              {rowActions ? (
                <th scope="col" className="w-px px-3 py-2">
                  <span className="sr-only">{translate(messages, 'table.rowActions')}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody aria-busy={status === 'loading'}>
            {status === 'loading' ? (
              <tr>
                <td colSpan={visibleColumns.length + (rowActions ? 1 : 0)} className="p-3">
                  {/*
                    Skeleton rows are the same height as real rows, so the table
                    does not resize when the data arrives. That is the whole
                    point — a skeleton of a different size causes the layout
                    shift it was meant to prevent.
                  */}
                  <SkeletonRows rows={Math.min(request.pageSize, 8)} />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowId(row)}
                  className={`${rowHeight} border-t border-border-subtle transition-colors duration-fast ease-standard hover:bg-table-row-hover`}
                >
                  {visibleColumns.map((column) => (
                    <td
                      key={column.id}
                      className={`px-3 ${column.numeric ? 'text-end tabular-nums' : 'text-start'}`}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {rowActions ? <td className="px-3 text-end">{rowActions(row)}</td> : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {status === 'idle' && rows.length === 0 ? (
        // "No records exist" and "your filters excluded everything" are
        // different problems with different next steps, so they are different
        // states rather than one message that has to cover both.
        isNarrowed(request) ? (
          <NoResultsState
            messages={messages}
            onClearFilters={
              <button
                type="button"
                onClick={() => onRequestChange(withoutAllFilters(request))}
                className={BUTTON_SECONDARY}
              >
                {translate(messages, 'table.clearFilters')}
              </button>
            }
          />
        ) : (
          <EmptyState messages={messages} />
        )
      ) : null}

      <Pagination
        messages={messages}
        request={request}
        total={total}
        pages={pages}
        hasMore={hasMore}
        rowsOnPage={rows.length}
        onRequestChange={onRequestChange}
      />
    </div>
  );
}

const BUTTON_PRIMARY =
  'rounded-md bg-primary px-4 py-2 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover';
const BUTTON_SECONDARY =
  'rounded-md border border-border bg-surface px-3 py-1.5 text-button text-text-secondary transition-colors duration-fast ease-standard hover:bg-surface-subtle hover:text-text-primary';

function HeaderCell<Row>({
  messages,
  column,
  request,
  onRequestChange,
}: {
  readonly messages: Messages;
  readonly column: Column<Row>;
  readonly request: TableRequest;
  readonly onRequestChange: (next: TableRequest) => void;
}) {
  const sorted = request.sort?.columnId === column.id ? request.sort.direction : null;
  const label = translate(messages, column.headerKey as keyof Messages);

  if (!column.sortable) {
    return (
      <th
        scope="col"
        className={`px-3 py-2 text-table-header font-semibold uppercase tracking-wide text-table-header-text ${
          column.numeric ? 'text-end' : 'text-start'
        }`}
      >
        {label}
      </th>
    );
  }

  return (
    <th
      scope="col"
      // `aria-sort` on the HEADER is what a screen reader reads to announce the
      // sort. An arrow glyph alone conveys it to sighted users only, and a
      // `title` is not announced at all.
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
      className={`px-3 py-2 text-table-header font-semibold uppercase tracking-wide text-table-header-text ${
        column.numeric ? 'text-end' : 'text-start'
      }`}
    >
      <button
        type="button"
        onClick={() => onRequestChange(withToggledSort(request, column.id))}
        className="inline-flex items-center gap-1 rounded-sm hover:text-text-primary"
      >
        {label}
        <span aria-hidden="true" className={sorted ? 'text-primary' : 'text-text-disabled'}>
          {sorted === 'desc' ? '↓' : '↑'}
        </span>
        {/*
          The name says what pressing it WILL do, not what is currently true —
          `aria-sort` above already carries the current state, and announcing it
          twice makes the button's purpose ambiguous.
        */}
        <span className="sr-only">
          {translate(
            messages,
            sorted === 'asc'
              ? 'table.sortDescending'
              : sorted === 'desc'
                ? 'table.sortNone'
                : 'table.sortAscending'
          )}
        </span>
      </button>
    </th>
  );
}

function FilterChips({
  messages,
  request,
  definitions,
  onRequestChange,
}: {
  readonly messages: Messages;
  readonly request: TableRequest;
  readonly definitions: readonly FilterDefinition[];
  readonly onRequestChange: (next: TableRequest) => void;
}) {
  if (request.filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-supporting text-text-muted">
        {translate(messages, 'table.filters')}
      </span>
      {request.filters.map((filter) => {
        const definition = definitions.find((candidate) => candidate.key === filter.key);
        const option = definition?.options.find((candidate) => candidate.value === filter.value);
        const label = definition
          ? `${translate(messages, definition.labelKey as keyof Messages)}: ${
              option ? translate(messages, option.labelKey as keyof Messages) : filter.value
            }`
          : `${filter.key}: ${filter.value}`;
        return (
          <button
            key={`${filter.key}:${filter.value}`}
            type="button"
            onClick={() => onRequestChange(withoutFilter(request, filter))}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-subtle px-3 py-1 text-caption text-text-secondary transition-colors duration-fast ease-standard hover:bg-surface"
          >
            {label}
            <span aria-hidden="true">&times;</span>
            <span className="sr-only">{translate(messages, 'table.removeFilter')}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onRequestChange(withoutAllFilters(request))}
        className="text-caption text-primary underline-offset-2 hover:underline"
      >
        {translate(messages, 'table.clearFilters')}
      </button>
    </div>
  );
}

/**
 * Pagination, in two modes.
 *
 * **Counted** (`total` is a number): the full control — a range, a page count,
 * First, Previous, Next, Last.
 *
 * **Uncounted** (`total` is `null`, every cursor-paginated backend list): the
 * page number, Previous, and Next gated on the server's own `hasMore`. First and
 * Last are absent, not disabled — a disabled Last implies there is a last page
 * the interface could reach if only the button worked, and there is not.
 */
function Pagination({
  messages,
  request,
  total,
  pages,
  hasMore,
  rowsOnPage,
  onRequestChange,
}: {
  readonly messages: Messages;
  readonly request: TableRequest;
  readonly total: number | null;
  readonly pages: number | null;
  readonly hasMore: boolean;
  readonly rowsOnPage: number;
  readonly onRequestChange: (next: TableRequest) => void;
}) {
  const counted = total !== null && pages !== null;
  const first = total === null || total === 0 ? 0 : (request.page - 1) * request.pageSize + 1;
  const last = total === null ? 0 : Math.min(request.page * request.pageSize, total);
  const atEnd = counted ? request.page >= (pages as number) : !hasMore;

  return (
    <nav
      aria-label={translate(messages, 'table.pagination')}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      {/*
        `aria-live` so the range is ANNOUNCED after a page change. Without it a
        screen-reader user presses Next and hears nothing: focus stays on the
        button and the numbers that changed are elsewhere in the document.
      */}
      <p aria-live="polite" className="text-supporting text-text-secondary">
        {counted ? (
          <>
            {translate(messages, 'table.showing')} {first}–{last} {translate(messages, 'table.of')}{' '}
            {total}
          </>
        ) : (
          // No "of N". Announcing a count the server never sent would be an
          // invention, and this line is read aloud on every page change.
          <>
            {translate(messages, 'table.showing')} {rowsOnPage}
          </>
        )}
      </p>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-supporting text-text-secondary">
          {translate(messages, 'table.rowsPerPage')}
          <select
            value={request.pageSize}
            onChange={(event) => onRequestChange(withPageSize(request, Number(event.target.value)))}
            className="rounded-md border border-border bg-surface px-2 py-1 text-supporting"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        {counted ? (
          <PageButton
            messages={messages}
            labelKey="table.firstPage"
            glyph="«"
            disabled={request.page <= 1}
            onClick={() => onRequestChange(withPage(request, 1))}
          />
        ) : null}
        <PageButton
          messages={messages}
          labelKey="table.previousPage"
          glyph="‹"
          disabled={request.page <= 1}
          onClick={() => onRequestChange(withPage(request, request.page - 1))}
        />
        <span className="text-supporting text-text-secondary">
          {counted ? `${request.page} / ${pages}` : request.page}
        </span>
        <PageButton
          messages={messages}
          labelKey="table.nextPage"
          glyph="›"
          disabled={atEnd}
          onClick={() => onRequestChange(withPage(request, request.page + 1))}
        />
        {counted ? (
          <PageButton
            messages={messages}
            labelKey="table.lastPage"
            glyph="»"
            disabled={atEnd}
            onClick={() => onRequestChange(withPage(request, pages as number))}
          />
        ) : null}
      </div>
    </nav>
  );
}

function PageButton({
  messages,
  labelKey,
  glyph,
  disabled,
  onClick,
}: {
  readonly messages: Messages;
  readonly labelKey: string;
  readonly glyph: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // The accessible name is words, not the glyph. "«" is announced as
      // "left-pointing double angle quotation mark", which is both wrong and
      // direction-dependent — the glyph mirrors under RTL and the name must not.
      aria-label={translate(messages, labelKey as keyof Messages)}
      className="rounded-md border border-border bg-surface px-2 py-1 text-text-secondary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-disabled rtl:-scale-x-100"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
