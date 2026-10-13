'use client';

import { Fragment, isValidElement, useEffect, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import {
  DataGrid,
  useGridApiRef,
  type GridColDef,
  type GridColumnVisibilityModel,
  type GridLocaleText,
  type GridRenderCellParams,
  type GridSortModel,
  type GridValidRowModel,
} from '@mui/x-data-grid';
import { hasFurtherPage } from '@/components/data-table/read-completeness';
import {
  PAGE_SIZES,
  isNarrowed,
  withPage,
  withPageSize,
  withoutAllFilters,
  withoutFilter,
  type FilterDefinition,
  type SortState,
  type TableRequest,
} from '@/components/data-table/table-state';
import type { ServerTable } from '@/components/data-table/use-server-table';
import {
  MuiEmptyState,
  MuiErrorState,
  MuiExpiredState,
  MuiNoResultsState,
  MuiNotFoundState,
  MuiRefusedState,
  MuiUnavailableState,
} from '@/components/states/MuiStates';
import { pageLabel } from '@/components/ui-foundation/mui-locale';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { writingDirectionOf } from '@/lib/text/writing-direction';
import { LAYOUT_PX, SPACE_PX } from '@/styles/tokens/generated/tokens';

/**
 * The operational grid — the MUI X Community data grid behind the product's
 * list contract (ADR-022 PR1). The ONE place the grid is rendered with props a
 * caller supplies (`validate:web-boundary`, `GRID_WRAPPER_PATHS`).
 *
 * It is `DataTable`'s behaviour on a different renderer, so a screen moves by
 * changing what it renders and nothing about how it reads.
 *
 * ## It renders; it never fetches, sorts, filters or pages an array
 *
 * The grid is driven by a `ServerTable` — what `useServerTable` returns, or a
 * search's `useSearchRequest(...).table` — and nothing else. Pagination, sorting
 * and filtering are all `'server'`: the grid is handed ONE page and shows it.
 * A control is offered only when the source honours it (`ServerTable.honours`):
 * a search's loaders take a cursor and nothing else, so over a search there is
 * no rows-per-page choice and no sortable header — never a control that does
 * nothing.
 * Sorting a header changes the REQUEST (back to page one, the cursor stack
 * dropped); the quick filter, the column filter panel and the column menu are
 * off, because a filter the grid applied to the rows in hand would be a
 * client-side filter wearing the clothes of a search. So everything that makes
 * the hook correct — `settleRead`'s ceiling, the dropped superseded reply, the
 * page and cursor reset on a `loadKey` or working-context version change, the
 * aborted signal — stays intact: the grid holds no state of its own about what
 * was read.
 *
 * ## Paging walks the existing cursor stack
 *
 * The list operations return `{ items, nextCursor, hasMore }` and NO count
 * (P1-26-F-001). The grid is told so: `rowCount={-1}` (unknown) and
 * `hasNextPage` from the page itself. Previous and Next are this wrapper's own
 * controls, below the grid, and each asks for `request.page ± 1` — the hook
 * spends the cursor that opened that page. There is no page jump and no offset:
 * a cursor for page seven does not exist until page six has been read. Next is
 * offered only when the page in hand was READ and says more exists
 * (`hasFurtherPage`), never while a page is loading.
 *
 * The grid's own footer is hidden. With an unknown count it derives a "total"
 * the moment it meets a page with no successor, and its default label prints
 * it; the label here is "Page N" and nothing else. The derived count is also
 * reset whenever more pages exist, so the grid's internal page arithmetic
 * never clamps a page the operator walked to.
 *
 * ## Texts are MERGED with the theme's, never replaced
 *
 * A `localeText` prop REPLACES the theme's grid texts wholesale (measured in
 * `@mui/x-data-grid` 9.14: `getThemeProps` merges only slots), which would drop
 * every catalogue text back to the library's English. `mergeGridLocaleText`
 * spreads the theme's texts first and this grid's page label last.
 *
 * ## Columns are the caller's, and permission-aware by construction
 *
 * A column is rendered because the caller passed it. A caller that may not see
 * a field does not pass the column AND does not request the field: a hidden
 * column whose data still arrives in the page has already sent that data to the
 * browser. So there is no "hide this column" prop for permissions, and the
 * column menu that would let an operator hide one is off.
 *
 * ## Narrow viewports: columns step aside, the grid stays a grid
 *
 * A column may declare `hideBelow` a breakpoint; under it the column is not
 * drawn, and every other column scrolls horizontally inside the grid. That is
 * a presentation choice about data the operator IS allowed to see, so a column
 * marked this way must be one whose content is also on the record the row
 * links to. It was chosen over a card layout because it keeps ONE structure —
 * one grid, one set of roles, one keyboard model — rather than a second
 * rendering whose states, focus and names would all have to be kept in step.
 *
 * ## States: one is never drawn as another
 *
 * A refusal is rendered INSTEAD of the grid, never over it (rows painted under
 * an overlay have already reached the browser). An outage and a fault offer a
 * retry and the correlation reference; an ended session offers the way back to
 * signing in and no retry; "nothing exists yet", "your filters excluded
 * everything" and "this search matched nothing" are different sentences — the
 * last whenever the source reports criteria outside the request
 * (`ServerTable.narrowed`), as a search does (P1-27-FE-002). Loading keeps the header and draws
 * skeleton rows the height of a real row. A caller whose list has more to say
 * about a refusal, an outage or a fault than the shared sentence passes its own
 * (`stateDescriptions`, since the sales and finance slice): the heading, the
 * retry rule and the reference stay the shared ones, so one state is still
 * never drawn as another.
 *
 * ## Keyboard
 *
 * The grid's own model: one tab stop, arrow keys between cells, the row actions
 * reachable as the content of their cell. Actions are real links and buttons
 * with names — `about` is appended to the name for assistive technology, so ten
 * rows of "Open" are ten different controls to a screen reader.
 */

/** A column, in `DataTable`'s shape. */
export interface OperationalColumn<Row> {
  readonly id: string;
  readonly headerKey: string;
  /** Offered as a SERVER sort. Off unless stated. */
  readonly sortable?: boolean;
  /** Aligns to the logical end, with tabular figures. */
  readonly numeric?: boolean;
  readonly cell: (row: Row) => ReactNode;
  /** Relative width. One unless stated. */
  readonly flex?: number;
  /**
   * The longest line a cell of this column draws, in characters, where it must
   * be read whole: a moment, a sentence. The column is never laid out narrower
   * than that (`columnMinWidth`), and the grid scrolls sideways instead of
   * cutting the text off. Unstated, the column keeps the floor every column has.
   */
  readonly minChars?: number;
  /** Not drawn below this breakpoint — see "Narrow viewports". */
  readonly hideBelow?: 'sm' | 'md' | 'lg';
}

/** What a row offers. Always a real link or button, always with a name. */
export type RowAction =
  | {
      readonly kind: 'link';
      readonly label: string;
      readonly href: string;
      /** What it acts on, announced after the label — a reference, a name. */
      readonly about?: string | undefined;
    }
  | {
      readonly kind: 'button';
      readonly label: string;
      readonly onClick: () => void;
      readonly about?: string | undefined;
      readonly disabled?: boolean | undefined;
      /**
       * A CHOICE among the rows: `true` on the row that is chosen, `false` on
       * the others, and the button is a toggle (`aria-pressed`) — so which row
       * is chosen is announced with the button, not only drawn beside it.
       * Absent for an ordinary action, which is not a toggle at all.
       */
      readonly pressed?: boolean | undefined;
    };

export interface OperationalGridProps<Row> {
  readonly messages: Messages;
  /** Only so an ended session can offer the sign-in link in the operator's language. */
  readonly locale?: Locale | undefined;
  /** The grid's accessible name. */
  readonly label: string;
  readonly columns: readonly OperationalColumn<Row>[];
  readonly rowId: (row: Row) => string;
  /** The read, from `useServerTable` or `useSearchRequest(...).table`. */
  readonly table: ServerTable<Row>;
  readonly filterDefinitions?: readonly FilterDefinition[];
  readonly density?: 'comfortable' | 'compact';
  readonly rowActions?: ((row: Row) => readonly RowAction[]) | undefined;
  /** The caller renders its own zero-row state — see `DataTable`'s `suppressEmptyState`. */
  readonly suppressEmptyState?: boolean | undefined;
  /**
   * The screen's own sentence under a failure's shared heading — "you may not
   * see the credit notes of this branch; that also needs permission to see
   * amounts" rather than the general refusal. Only the refused, unavailable and
   * error states take one, as `MuiStates` does; unset, the shared sentence.
   */
  readonly stateDescriptions?:
    | {
        readonly denied?: keyof Messages | undefined;
        readonly unavailable?: keyof Messages | undefined;
        readonly error?: keyof Messages | undefined;
      }
    | undefined;
  /**
   * The read is NOT paged: it answers the whole set at once (a technician's own
   * queue — the operation discards `limit` and returns no cursor). Then no
   * pager is drawn at all — no page label, no Previous, no Next, no page size —
   * because each would be a control that does nothing. Off unless stated; a
   * paged read must never pass it, or its second page would be unreachable.
   */
  readonly unpaged?: boolean | undefined;
  readonly testId?: string | undefined;
}

/** The reserved field of the row-actions column. No caller column may use it. */
export const ROW_ACTIONS_FIELD = 'rowActions';

/*
 * The row-actions column is as wide as its longest row of labels, so no label
 * wraps — in English or in Arabic (Browser QA part 7, row 4.3: "Open the work
 * order" broke over four lines in a 58 px column).
 *
 * A label is never measured in the DOM: the grid decides its column widths
 * before the cells exist, and a width that changed after the first paint would
 * move every other column under the operator's eye. It is estimated from token
 * values instead — `space-2` per character, which is wider than the average
 * glyph of a 14 px label in either script — plus each button's own padding, the
 * gap between buttons and the cell's padding. An over-estimate costs a little
 * space; an under-estimate would wrap, so the estimate errs wide.
 */
const ACTION_CHARACTER_PX = SPACE_PX['2'];
const ACTION_BUTTON_PADDING_PX = SPACE_PX['4'];
const ACTION_BUTTON_MIN_PX = SPACE_PX['16'];
const ACTION_GAP_PX = SPACE_PX['1'];
const ACTION_CELL_PADDING_PX = SPACE_PX['5'];

/**
 * The narrowest the row-actions column may be for these rows' labels: the widest
 * row, never below the floor every other column keeps. Exported so the width is
 * tested on the function as well as on the render.
 */
export function rowActionsMinWidth(labelRows: readonly (readonly string[])[]): number {
  let widest = 0;
  for (const labels of labelRows) {
    let width = ACTION_CELL_PADDING_PX + ACTION_GAP_PX * Math.max(0, labels.length - 1);
    for (const label of labels) {
      width += Math.max(
        ACTION_BUTTON_MIN_PX,
        label.length * ACTION_CHARACTER_PX + ACTION_BUTTON_PADDING_PX
      );
    }
    widest = Math.max(widest, width);
  }
  return Math.max(SPACE_PX['24'], widest);
}

/**
 * The narrowest a column may be for a line of `characters` characters: the same
 * estimate the row-actions column uses — `space-2` per character, which is
 * wider than the average glyph of a 14 px line in either script, plus the
 * cell's padding — and never below the floor. Exported so the width is tested
 * on the function as well as on the render.
 */
export function columnMinWidth(characters: number): number {
  return Math.max(
    SPACE_PX['24'],
    Math.ceil(characters) * ACTION_CHARACTER_PX + ACTION_CELL_PADDING_PX
  );
}

/**
 * The text a line draws, when it can be read off what the caller passed: a
 * string or a number, and whatever sits inside plain elements around them
 * (`<bdi>`, `<code>`, a fragment). `null` when part of the line is a component,
 * whose text is not known until it renders — a formatted moment, a chip.
 * Exported so the rule is tested on the function as well as on the render.
 */
export function lineText(node: ReactNode): string | null {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'bigint') return String(node);
  if (Array.isArray(node)) {
    let text = '';
    for (const child of node as readonly ReactNode[]) {
      const part = lineText(child);
      if (part === null) return null;
      text += part;
    }
    return text;
  }
  if (!isValidElement(node)) return null;
  if (typeof node.type !== 'string' && node.type !== Fragment) return null;
  return lineText((node.props as { readonly children?: ReactNode }).children);
}

/*
 * One line, never wrapped and never taller than its own line height.
 *
 * Cut at the SIDE only (`overflow-x-clip`), with an ellipsis where it is cut.
 * `truncate` would do the same with `overflow: hidden`, which also clips above
 * and below the line box: at the caption's compact line height that can shave
 * the marks under an Arabic letter, and a line cut at the bottom is the defect
 * this cell exists to prevent.
 */
const LINE_CLASS = 'min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap';

function GridLine({
  line,
  className,
  title,
  children,
}: {
  readonly line: 'primary' | 'secondary';
  readonly className: string;
  readonly title: string | undefined;
  readonly children: ReactNode;
}) {
  const whole = (title ?? lineText(children))?.trim() ?? '';
  return (
    <span
      className={`${LINE_CLASS} ${className}`}
      data-grid-line={line}
      // The line's own direction, so that a cut line keeps its beginning. A
      // line whose text is not known here follows the page, as before.
      dir={writingDirectionOf(whole)}
      title={whole.length > 0 ? whole : undefined}
    >
      {children}
    </span>
  );
}

/**
 * A cell of two stacked lines that both fit in a row.
 *
 * A row of this grid has one fixed height, and a cell gives its text a line as
 * tall as the row so that one line sits in the middle of it. Two stacked lines
 * therefore only fit when EACH has a compact line height of its own: a first
 * line left to inherit the cell's takes the whole row, and the second is cut
 * off below it with no sign that it was ever there. So each line carries its
 * own type size — the table's for the first, the caption's for the second —
 * and the pair is centred in the row as a single line would be.
 *
 * `secondary` may be absent (`null`, `undefined`, `false`): the cell is then
 * its first line alone, at the same size.
 *
 * ## A line longer than its column says so (P1-32-PRE-OD-UXQ, Q-2)
 *
 * A row holds two lines and no more, so a line is never wrapped. One longer
 * than its column used to be cut at the cell's edge with nothing to show for
 * it, and in the Arabic interface a reason written in Latin letters lost its
 * BEGINNING. Each line now:
 *
 *   - ends in an ellipsis where it is cut;
 *   - is laid out in the direction of its OWN text (`writingDirectionOf`), so
 *     what is cut is its end, whatever the page's direction;
 *   - carries its whole text as its `title` — what the grid's own cells do for
 *     a value they draw themselves, and what the header's branch select does.
 *     The whole text is also still in the document for assistive technology:
 *     the ellipsis is drawn, nothing is removed.
 *
 * The text is read off what was passed (`lineText`). A line built from a
 * component — a formatted moment — has no text to read here: it still ends in
 * an ellipsis, follows the page's direction and has no title unless the caller
 * supplies one (`primaryTitle`, `secondaryTitle`).
 *
 * That a line is in fact cut, and where, is laid out by the browser: a DOM test
 * holds the classes, the direction and the title, and nothing about widths.
 */
export function TwoLineCell({
  primary,
  secondary,
  primaryTitle,
  secondaryTitle,
  testId,
}: {
  readonly primary: ReactNode;
  readonly secondary?: ReactNode;
  /** The first line's whole text, when it cannot be read off `primary`. */
  readonly primaryTitle?: string | undefined;
  /** The second line's whole text, when it cannot be read off `secondary`. */
  readonly secondaryTitle?: string | undefined;
  readonly testId?: string | undefined;
}) {
  const second = secondary === null || secondary === undefined || secondary === false;
  return (
    <span
      className="flex h-full min-w-0 flex-col justify-center"
      data-grid-cell="two-line"
      data-testid={testId}
    >
      <GridLine line="primary" className="text-table-cell" title={primaryTitle}>
        {primary}
      </GridLine>
      {second ? null : (
        <GridLine line="secondary" className="text-caption text-text-muted" title={secondaryTitle}>
          {secondary}
        </GridLine>
      )}
    </span>
  );
}

/**
 * The grid texts: the theme's, then this grid's. Exported so the "merged,
 * never replaced" rule is tested on the function as well as on the render.
 */
export function mergeGridLocaleText(
  themeText: Partial<GridLocaleText> | undefined,
  overrides: Partial<GridLocaleText>
): Partial<GridLocaleText> {
  return { ...themeText, ...overrides };
}

/** The request after a header sort, or null when the sort did not change. */
export function sortRequestFrom(request: TableRequest, model: GridSortModel): TableRequest | null {
  const first = model[0];
  const sort: SortState | null =
    first && (first.sort === 'asc' || first.sort === 'desc')
      ? { columnId: first.field, direction: first.sort }
      : null;
  const same =
    sort === null
      ? request.sort === null
      : request.sort !== null &&
        request.sort.columnId === sort.columnId &&
        request.sort.direction === sort.direction;
  if (same) return null;
  // A new ordering is a new set: page one, and `useCursorPages` drops the stack.
  return { ...request, sort, page: 1 };
}

/** Nothing: the zero-row states are drawn below the grid, in the product's words. */
function NoRowsOverlay() {
  return null;
}

function RowActionsCell({
  actions,
  tabIndex,
}: {
  readonly actions: readonly RowAction[];
  readonly tabIndex: 0 | -1;
}) {
  return (
    // No wrap, of the row or of a label: the column is sized to hold the row
    // whole (`rowActionsMinWidth`).
    <div className="flex flex-nowrap items-center justify-end gap-1 whitespace-nowrap">
      {actions.map((action) => {
        const name = (
          <>
            {action.label}
            {action.about ? <span className="sr-only"> {action.about}</span> : null}
          </>
        );
        return action.kind === 'link' ? (
          <Button
            key={`${action.kind}:${action.label}`}
            component={Link}
            href={action.href}
            size="small"
            tabIndex={tabIndex}
          >
            {name}
          </Button>
        ) : (
          <Button
            key={`${action.kind}:${action.label}`}
            type="button"
            size="small"
            tabIndex={tabIndex}
            disabled={action.disabled}
            aria-pressed={action.pressed}
            variant={action.pressed === true ? 'contained' : 'text'}
            onClick={action.onClick}
          >
            {name}
          </Button>
        );
      })}
    </div>
  );
}

export function OperationalGrid<Row>({
  messages,
  locale,
  label,
  columns,
  rowId,
  table,
  filterDefinitions = [],
  density = 'comfortable',
  rowActions,
  suppressEmptyState = false,
  unpaged = false,
  stateDescriptions,
  testId = 'operational-grid',
}: OperationalGridProps<Row>) {
  const theme = useTheme();
  const apiRef = useGridApiRef();
  const belowSm = useMediaQuery(theme.breakpoints.down('sm'));
  const belowMd = useMediaQuery(theme.breakpoints.down('md'));
  const belowLg = useMediaQuery(theme.breakpoints.down('lg'));

  const { request, response, status, correlationId } = table;
  const honoursSort = table.honours?.sort !== false;
  const honoursPageSize = table.honours?.pageSize !== false;
  const loading = status === 'loading';
  const hasMore = response?.hasMore;
  // Only a page that was READ may say what lies beyond it. While a page loads
  // nothing is said, rather than "no next page".
  const settledHasNext: boolean | undefined =
    status === 'idle' && response !== null ? hasMore === true : undefined;

  /*
   * The grid derives a row count from a page with no successor and keeps it.
   * Left there, a later walk past that page — new criteria, a new branch — is
   * clamped by the grid's own page arithmetic. Whenever the set is not known to
   * end here, the count goes back to unknown.
   */
  useEffect(() => {
    if (settledHasNext !== false) apiRef.current?.setRowCount(-1);
  }, [apiRef, settledHasNext, request.page]);

  const rows = useMemo(() => response?.rows ?? [], [response]);

  const gridColumns = useMemo<GridColDef<GridValidRowModel>[]>(() => {
    const mapped: GridColDef<GridValidRowModel>[] = columns.map((column) => ({
      field: column.id,
      headerName: translateDynamic(messages, column.headerKey),
      sortable: honoursSort && column.sortable === true,
      filterable: false,
      hideable: false,
      disableColumnMenu: true,
      flex: column.flex ?? 1,
      minWidth: column.minChars === undefined ? SPACE_PX['24'] : columnMinWidth(column.minChars),
      align: column.numeric ? 'right' : 'left',
      headerAlign: column.numeric ? 'right' : 'left',
      ...(column.numeric ? { cellClassName: 'tabular-nums' } : {}),
      renderCell: (params: GridRenderCellParams<GridValidRowModel>) =>
        column.cell(params.row as Row),
    }));
    if (rowActions) {
      mapped.push({
        field: ROW_ACTIONS_FIELD,
        headerName: translate(messages, 'table.rowActions'),
        sortable: false,
        filterable: false,
        hideable: false,
        disableColumnMenu: true,
        flex: 1,
        minWidth: rowActionsMinWidth(
          rows.map((row) => rowActions(row as Row).map((action) => action.label))
        ),
        align: 'right',
        headerAlign: 'right',
        renderHeader: () => (
          <span className="sr-only">{translate(messages, 'table.rowActions')}</span>
        ),
        renderCell: (params: GridRenderCellParams<GridValidRowModel>) => (
          <RowActionsCell actions={rowActions(params.row as Row)} tabIndex={params.tabIndex} />
        ),
      });
    }
    return mapped;
  }, [columns, messages, rowActions, honoursSort, rows]);

  const columnVisibilityModel = useMemo<GridColumnVisibilityModel>(() => {
    const model: GridColumnVisibilityModel = {};
    for (const column of columns) {
      const hidden =
        (column.hideBelow === 'sm' && belowSm) ||
        (column.hideBelow === 'md' && belowMd) ||
        (column.hideBelow === 'lg' && belowLg);
      if (hidden) model[column.id] = false;
    }
    return model;
  }, [columns, belowSm, belowMd, belowLg]);

  const localeText = useMemo(
    () =>
      mergeGridLocaleText(theme.components?.MuiDataGrid?.defaultProps?.localeText, {
        paginationDisplayedRows: () =>
          pageLabel(translate(messages, 'mui.pagination.page'), request.page - 1),
      }),
    [theme, messages, request.page]
  );

  const sortModel = useMemo<GridSortModel>(
    () => (request.sort ? [{ field: request.sort.columnId, sort: request.sort.direction }] : []),
    [request.sort]
  );

  if (status === 'denied') {
    return (
      <MuiRefusedState
        messages={messages}
        correlationId={correlationId}
        descriptionKey={stateDescriptions?.denied}
      />
    );
  }
  if (status === 'unavailable') {
    return (
      <MuiUnavailableState
        messages={messages}
        onRetry={table.refresh}
        correlationId={correlationId}
        descriptionKey={stateDescriptions?.unavailable}
      />
    );
  }
  if (status === 'expired') {
    return <MuiExpiredState messages={messages} locale={locale} />;
  }
  if (status === 'not-found') {
    return <MuiNotFoundState messages={messages} />;
  }
  if (status === 'error') {
    return (
      <MuiErrorState
        messages={messages}
        onRetry={table.refresh}
        correlationId={correlationId}
        descriptionKey={stateDescriptions?.error}
      />
    );
  }

  const rowHeight =
    density === 'compact' ? LAYOUT_PX['table-row-height-compact'] : LAYOUT_PX['table-row-height'];
  const clear = () => table.setRequest(withoutAllFilters(request));

  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid={testId}>
      {request.filters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-supporting text-text-muted">
            {translate(messages, 'table.filters')}
          </span>
          {request.filters.map((filter) => {
            const definition = filterDefinitions.find((candidate) => candidate.key === filter.key);
            const option = definition?.options.find(
              (candidate) => candidate.value === filter.value
            );
            // A filter this grid was not told about is named generically: its
            // key and value are wire vocabulary, never words for an operator.
            const chipLabel = definition
              ? `${translateDynamic(messages, definition.labelKey)}: ${
                  option ? translateDynamic(messages, option.labelKey) : filter.value
                }`
              : translate(messages, 'table.filterApplied');
            return (
              <Chip
                key={`${filter.key}:${filter.value}`}
                variant="outlined"
                size="small"
                onClick={() => table.setRequest(withoutFilter(request, filter))}
                label={
                  <>
                    {chipLabel} <span aria-hidden="true">&times;</span>
                    <span className="sr-only">{translate(messages, 'table.removeFilter')}</span>
                  </>
                }
              />
            );
          })}
          <Button type="button" size="small" onClick={clear}>
            {translate(messages, 'table.clearFilters')}
          </Button>
        </div>
      ) : null}

      <div aria-busy={loading || undefined} className="min-w-0">
        <DataGrid
          apiRef={apiRef}
          aria-label={label}
          rows={rows as readonly GridValidRowModel[]}
          columns={gridColumns}
          getRowId={(row) => rowId(row as Row)}
          paginationMode="server"
          sortingMode="server"
          filterMode="server"
          rowCount={-1}
          paginationMeta={settledHasNext === undefined ? {} : { hasNextPage: settledHasNext }}
          paginationModel={{ page: request.page - 1, pageSize: request.pageSize }}
          pageSizeOptions={[...PAGE_SIZES]}
          sortModel={sortModel}
          onSortModelChange={(model) => {
            const next = sortRequestFrom(request, model);
            if (next !== null) table.setRequest(next);
          }}
          columnVisibilityModel={columnVisibilityModel}
          localeText={localeText}
          loading={loading}
          slots={{ noRowsOverlay: NoRowsOverlay }}
          slotProps={{
            loadingOverlay: { variant: 'skeleton', noRowsVariant: 'skeleton' },
          }}
          rowHeight={rowHeight}
          columnHeaderHeight={LAYOUT_PX['table-row-height']}
          autoHeight
          disableVirtualization
          disableColumnMenu
          disableColumnFilter
          disableColumnSelector
          disableDensitySelector
          disableRowSelectionOnClick
          hideFooter
        />
      </div>

      {status === 'idle' && rows.length === 0 && !suppressEmptyState ? (
        table.narrowed === true && !isNarrowed(request) ? (
          // The criteria live outside the request, so "Clear all filters"
          // would clear nothing: the sentence names the search and stops.
          <MuiNoResultsState messages={messages} reason="search" />
        ) : isNarrowed(request) ? (
          <MuiNoResultsState
            messages={messages}
            action={
              <Button type="button" size="small" variant="outlined" onClick={clear}>
                {translate(messages, 'table.clearFilters')}
              </Button>
            }
          />
        ) : (
          <MuiEmptyState messages={messages} />
        )
      ) : null}

      {unpaged ? null : (
        <nav
          aria-label={translate(messages, 'table.pagination')}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          {/* `aria-live` so the page is announced after a move: focus stays on
            the button, and the only thing that changed is here. Never a
            count and never "of N" — nothing publishes one. */}
          <p
            aria-live="polite"
            className="text-supporting text-text-secondary"
            data-testid={`${testId}-page`}
          >
            {pageLabel(translate(messages, 'mui.pagination.page'), request.page - 1)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {honoursPageSize ? (
              <TextField
                select
                size="small"
                fullWidth={false}
                label={translate(messages, 'table.rowsPerPage')}
                value={String(request.pageSize)}
                onChange={(event) =>
                  table.setRequest(withPageSize(request, Number.parseInt(event.target.value, 10)))
                }
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </TextField>
            ) : null}
            <Button
              type="button"
              variant="outlined"
              size="small"
              disabled={request.page <= 1}
              onClick={() => table.setRequest(withPage(request, request.page - 1))}
            >
              {translate(messages, 'table.previousPage')}
            </Button>
            <Button
              type="button"
              variant="outlined"
              size="small"
              disabled={!hasFurtherPage(status, hasMore)}
              onClick={() => table.setRequest(withPage(request, request.page + 1))}
            >
              {translate(messages, 'table.nextPage')}
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
