import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { GridColDef, GridValidRowModel } from '@mui/x-data-grid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import type { ServerTable } from '@/components/data-table/use-server-table';
import { getMessages } from '@/i18n/get-messages';
import { SPACE_PX } from '@/styles/tokens/generated/tokens';
import { renderLtr, renderRtl } from './render';

/**
 * The width the operational grid HANDS its row-actions column (Browser QA part
 * 7, row 4.3).
 *
 * jsdom lays nothing out — its `ResizeObserver` is a stub that never reports a
 * size — so the grid draws every column at zero and a rendered width proves
 * nothing. What can be proved is the column definition itself: the data grid is
 * replaced here by a recorder that keeps the columns it was given and draws each
 * row's action cell, so the case asserts the `minWidth` the real grid would lay
 * out, for the labels actually on the page, in English and in Arabic.
 */

let handed: readonly GridColDef<GridValidRowModel>[] = [];

vi.mock('@mui/x-data-grid', async (original) => ({
  ...(await original<typeof import('@mui/x-data-grid')>()),
  DataGrid: (props: {
    readonly columns: readonly GridColDef<GridValidRowModel>[];
    readonly rows: readonly GridValidRowModel[];
  }) => {
    handed = props.columns;
    return (
      <div role="grid">
        {props.rows.map((row, index) => (
          <div role="row" key={index}>
            {props.columns.map((column) => (
              <div role="gridcell" key={column.field}>
                {column.renderCell?.({ row, tabIndex: -1 } as never) as ReactNode}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  },
}));

const { OperationalGrid, ROW_ACTIONS_FIELD, columnMinWidth, rowActionsMinWidth } =
  await import('@/components/data/OperationalGrid');

interface Visit {
  readonly id: string;
  readonly reference: string;
  readonly finished: boolean;
}

function table(rows: readonly Visit[]): ServerTable<Visit> {
  return {
    request: INITIAL_REQUEST,
    setRequest: () => undefined,
    response: { rows, total: null, page: 1, pageSize: INITIAL_REQUEST.pageSize, hasMore: false },
    status: 'idle',
    correlationId: undefined,
    refresh: () => undefined,
  };
}

const ROWS: readonly Visit[] = [
  { id: 'v-1', reference: 'R-1', finished: false },
  { id: 'v-2', reference: 'R-2', finished: true },
];

describe('the row-actions column is handed a width its labels fit in', () => {
  it.each([
    ['en', renderLtr],
    ['ar', renderRtl],
  ] as const)('in %s', (locale, render) => {
    const messages = getMessages(locale);
    const labelsOf = (visit: Visit) => [
      visit.finished
        ? messages['receptions.queue.open']
        : messages['receptions.queue.continueCheckIn'],
      messages['receptions.queue.acknowledgement'],
    ];
    render(
      <OperationalGrid<Visit>
        messages={messages}
        locale={locale}
        label="Visits"
        columns={[{ id: 'reference', headerKey: 'column.reference', cell: (row) => row.reference }]}
        rowId={(row) => row.id}
        table={table(ROWS)}
        rowActions={(row) =>
          labelsOf(row).map((label) => ({ kind: 'link' as const, label, href: `/v/${row.id}` }))
        }
      />
    );
    const actions = handed.find((column) => column.field === ROW_ACTIONS_FIELD);
    expect(actions, 'the grid was handed no row-actions column').toBeDefined();
    // Exactly the estimate for the labels on THIS page, whose widest row decides.
    expect(actions?.minWidth).toBe(rowActionsMinWidth(ROWS.map(labelsOf)));
    // Never the bare floor the defect was drawn at.
    expect(actions?.minWidth ?? 0).toBeGreaterThan(SPACE_PX['24']);
    // Every label on the page fits its share: characters at `space-2` each.
    for (const label of ROWS.flatMap(labelsOf)) {
      expect(actions?.minWidth ?? 0).toBeGreaterThan(label.length * SPACE_PX['2']);
    }
    // The other columns keep the floor they had.
    expect(handed.find((column) => column.field === 'reference')?.minWidth).toBe(SPACE_PX['24']);
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('keeps the floor when the page holds no row', () => {
    const messages = getMessages('en');
    renderLtr(
      <OperationalGrid<Visit>
        messages={messages}
        label="Visits"
        columns={[{ id: 'reference', headerKey: 'column.reference', cell: (row) => row.reference }]}
        rowId={(row) => row.id}
        table={table([])}
        rowActions={(row) => [{ kind: 'link', label: 'Open', href: `/v/${row.id}` }]}
        suppressEmptyState
      />
    );
    expect(handed.find((column) => column.field === ROW_ACTIONS_FIELD)?.minWidth).toBe(
      SPACE_PX['24']
    );
  });
});

/**
 * A column that must be read whole says how long its longest line is
 * (`minChars`), and is handed a width that line fits in by the same estimate
 * the row-actions column uses (P1-32-PRE-OD-INVH: a moment in a 96 px column
 * was cut off after its first words). As above, what is proved is the width the
 * grid is HANDED; the width a browser draws is not something jsdom can show.
 */
describe('a column is handed a width its longest line fits in', () => {
  it('estimates a line at space-2 a character plus the cell padding, never below the floor', () => {
    expect(columnMinWidth(0)).toBe(SPACE_PX['24']);
    expect(columnMinWidth(5)).toBe(SPACE_PX['24']);
    expect(columnMinWidth(23)).toBe(23 * SPACE_PX['2'] + SPACE_PX['5']);
    expect(columnMinWidth(30.2)).toBe(31 * SPACE_PX['2'] + SPACE_PX['5']);
    // A longer line is never handed a narrower column.
    for (let characters = 1; characters < 60; characters += 1) {
      expect(columnMinWidth(characters + 1)).toBeGreaterThanOrEqual(columnMinWidth(characters));
      expect(columnMinWidth(characters)).toBeGreaterThanOrEqual(characters * SPACE_PX['2']);
    }
  });

  it('hands the column that asks for one its own floor, and leaves the others theirs', () => {
    const moment = '9 Oct 2026, 19:20 GMT+3';
    renderLtr(
      <OperationalGrid<Visit>
        messages={getMessages('en')}
        label="Visits"
        columns={[
          { id: 'reference', headerKey: 'column.reference', cell: (row) => row.reference },
          {
            id: 'when',
            headerKey: 'column.reference',
            minChars: moment.length,
            cell: () => moment,
          },
        ]}
        rowId={(row) => row.id}
        table={table(ROWS)}
      />
    );
    const when = handed.find((column) => column.field === 'when');
    expect(when?.minWidth).toBe(columnMinWidth(moment.length));
    expect(when?.minWidth ?? 0).toBeGreaterThan(moment.length * SPACE_PX['2']);
    expect(when?.minWidth ?? 0).toBeGreaterThan(SPACE_PX['24']);
    // It still shares the remaining width as before.
    expect(when?.flex).toBe(1);
    expect(handed.find((column) => column.field === 'reference')?.minWidth).toBe(SPACE_PX['24']);
  });
});
