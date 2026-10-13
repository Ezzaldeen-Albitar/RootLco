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

const {
  OperationalGrid,
  ROW_ACTIONS_FIELD,
  TwoLineCell,
  columnMinWidth,
  lineText,
  rowActionsMinWidth,
} = await import('@/components/data/OperationalGrid');

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

/**
 * A cell of two stacked lines (P1-32-PRE-OD-INVH). A row has one fixed height
 * and a cell gives its text a line as tall as the row, so the second of two
 * lines is cut off unless EACH carries a compact line height of its own. What
 * is held is that both lines carry the utility that sets one; that they then
 * fit in the row is something only a browser can show.
 */
describe('a cell of two lines gives each line a line height of its own', () => {
  it('draws the first line at the table size and the second at the caption size, centred in the row', () => {
    renderLtr(<TwoLineCell testId="cell" primary="Paid twice" secondary="8 Oct 2026, 12:00" />);
    const cell = screen.getByTestId('cell');
    expect(cell).toHaveAttribute('data-grid-cell', 'two-line');
    expect(cell).toHaveClass('flex', 'h-full', 'flex-col', 'justify-center');
    const [first, second] = [...cell.children] as [HTMLElement, HTMLElement];
    expect(cell.children).toHaveLength(2);
    expect(first).toHaveClass('text-table-cell');
    expect(first).toHaveAttribute('data-grid-line', 'primary');
    expect(first.textContent).toBe('Paid twice');
    expect(second).toHaveClass('text-caption', 'text-text-muted');
    expect(second).toHaveAttribute('data-grid-line', 'secondary');
    expect(second.textContent).toBe('8 Oct 2026, 12:00');
    // No title on the cell: each line carries its own (see below).
    expect(cell).not.toHaveAttribute('title');
  });

  it.each([null, undefined, false] as const)(
    'with no second line (%s) it is its first line alone, at the same size',
    (secondary) => {
      renderLtr(<TwoLineCell testId="cell" primary="Pending" secondary={secondary} />);
      const cell = screen.getByTestId('cell');
      expect(cell.children).toHaveLength(1);
      expect(cell.children[0]).toHaveClass('text-table-cell');
      expect(cell.textContent).toBe('Pending');
    }
  );

  it('keeps what it is given inside each line: elements, not only text', () => {
    renderLtr(
      <TwoLineCell testId="cell" primary={<bdi>سبب</bdi>} secondary={<code dir="ltr">pr-1</code>} />
    );
    const cell = screen.getByTestId('cell');
    expect(cell.querySelector('[data-grid-line="primary"] bdi')?.textContent).toBe('سبب');
    expect(cell.querySelector('[data-grid-line="secondary"] code')?.textContent).toBe('pr-1');
  });
});

/**
 * A line longer than its column (P1-32-PRE-OD-UXQ, Q-2). A row holds two lines
 * and no more, so a line is never wrapped; one longer than its column was cut
 * at the cell's edge with nothing to show for it, and in the Arabic interface a
 * reason written in Latin letters lost its BEGINNING.
 *
 * What is held here is what a DOM test can see: the utilities that cut a line
 * at the side and draw the ellipsis, the direction each line is laid out in,
 * and the whole text as the line's title. That a line is in fact cut, and
 * where, is laid out by a browser and is seen only there.
 */
describe('a line of a two-line cell that is longer than its column', () => {
  const CUT_AT_THE_SIDE = ['min-w-0', 'overflow-x-clip', 'text-ellipsis', 'whitespace-nowrap'];
  const LATIN =
    'FQA-1015 ar: refund q2 of the 4.000 owed, for the branch-midnight payout check (QA)';
  const ARABIC = 'أعاد المشتري شفرة مساحة تالفة بعد أسبوع من الشراء وطلب استرداد ثمنها كاملا';
  const linesOf = (testId: string) => [...screen.getByTestId(testId).children] as HTMLElement[];
  const BOTH = [
    ['en', renderLtr],
    ['ar', renderRtl],
  ] as const;

  it.each(BOTH)(
    'in %s: each line is cut at the side with an ellipsis, and never above or below',
    (_locale, render) => {
      render(
        <>
          <TwoLineCell testId="two" primary={LATIN} secondary={ARABIC} />
          <TwoLineCell testId="one" primary={LATIN} />
        </>
      );
      // The cell may be narrower than its text: without this it could not be.
      expect(screen.getByTestId('two')).toHaveClass('min-w-0');
      const lines = [...linesOf('two'), ...linesOf('one')];
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        expect(line).toHaveClass(...CUT_AT_THE_SIDE);
        // `overflow: hidden` clips above and below the line box as well, which
        // at the caption's line height shaves the marks under a letter.
        expect(line).not.toHaveClass('truncate');
        expect(line).not.toHaveClass('overflow-hidden');
      }
      // Each still has the line height of its own that makes two fit in a row.
      expect(linesOf('two')[0]).toHaveClass('text-table-cell');
      expect(linesOf('two')[1]).toHaveClass('text-caption', 'text-text-muted');
    }
  );

  it.each(BOTH)(
    'in %s: a line is laid out in the direction of its own text, so it keeps its beginning',
    (_locale, render) => {
      render(
        <>
          <TwoLineCell testId="plain" primary={LATIN} secondary={ARABIC} />
          <TwoLineCell
            testId="wrapped"
            primary={<bdi>{ARABIC}</bdi>}
            secondary={
              <code className="font-mono" dir="ltr">
                {LATIN}
              </code>
            }
          />
          <TwoLineCell testId="figures" primary="000028" secondary="12.345 · 2026" />
        </>
      );
      const [latin, arabic] = linesOf('plain') as [HTMLElement, HTMLElement];
      expect(latin).toHaveAttribute('dir', 'ltr');
      expect(arabic).toHaveAttribute('dir', 'rtl');
      // Read through the element the caller wrapped the text in: `dir="auto"`
      // does not look inside a `<bdi>`, and would lay an Arabic line out left
      // to right.
      const [wrappedArabic, wrappedLatin] = linesOf('wrapped') as [HTMLElement, HTMLElement];
      expect(wrappedArabic).toHaveAttribute('dir', 'rtl');
      expect(wrappedLatin).toHaveAttribute('dir', 'ltr');
      for (const line of [...linesOf('plain'), ...linesOf('wrapped')]) {
        expect(line).not.toHaveAttribute('dir', 'auto');
      }
      // Figures and punctuation have no direction of their own: the page's.
      for (const line of linesOf('figures')) expect(line).not.toHaveAttribute('dir');
    }
  );

  it('carries its whole text as its title, and keeps all of it in the document', () => {
    renderLtr(
      <TwoLineCell
        testId="cell"
        primary={<bdi>{LATIN}</bdi>}
        secondary={
          <>
            {'Raised by you'}
            {' · '}
            <code dir="ltr">pr-1</code>
          </>
        }
      />
    );
    const [first, second] = linesOf('cell') as [HTMLElement, HTMLElement];
    expect(first).toHaveAttribute('title', LATIN);
    expect(second).toHaveAttribute('title', 'Raised by you · pr-1');
    // The ellipsis is drawn; nothing is taken out of the text.
    expect(first.textContent).toBe(LATIN);
    expect(second.textContent).toBe('Raised by you · pr-1');
  });

  it('a line built from a component has no title and follows the page, unless the caller says its text', () => {
    function Moment() {
      return <time dateTime="2026-10-08T09:00:00Z">8 Oct 2026, 12:00</time>;
    }
    const { rerender } = renderLtr(
      <TwoLineCell
        testId="cell"
        primary={<Moment />}
        secondary={
          <>
            <Moment />
            {' · by you'}
          </>
        }
      />
    );
    for (const line of linesOf('cell')) {
      expect(line).not.toHaveAttribute('title');
      expect(line).not.toHaveAttribute('dir');
      // Still cut at the side with an ellipsis: that needs no text.
      expect(line).toHaveClass(...CUT_AT_THE_SIDE);
    }
    rerender(
      <TwoLineCell
        testId="cell"
        primary={<Moment />}
        primaryTitle="8 Oct 2026, 12:00"
        secondary={<Moment />}
        secondaryTitle={ARABIC}
      />
    );
    const [first, second] = linesOf('cell') as [HTMLElement, HTMLElement];
    expect(first).toHaveAttribute('title', '8 Oct 2026, 12:00');
    expect(first).toHaveAttribute('dir', 'ltr');
    expect(second).toHaveAttribute('title', ARABIC);
    expect(second).toHaveAttribute('dir', 'rtl');
  });

  it('a line with nothing in it has no title', () => {
    renderLtr(<TwoLineCell testId="cell" primary="" secondary="  " />);
    for (const line of linesOf('cell')) expect(line).not.toHaveAttribute('title');
  });
});

describe('the text a line draws is read off what was passed', () => {
  function Component() {
    return <span>drawn later</span>;
  }

  it('reads text, numbers and what plain elements and fragments hold', () => {
    expect(lineText('Paid twice')).toBe('Paid twice');
    expect(lineText(12)).toBe('12');
    expect(lineText(<bdi>سبب</bdi>)).toBe('سبب');
    expect(
      lineText(
        <>
          {'a'}
          {[' · ', <code key="c">b</code>]}
          {3}
        </>
      )
    ).toBe('a · b3');
  });

  it('reads nothing where nothing is drawn', () => {
    for (const nothing of [null, undefined, false, true] as const) {
      expect(lineText(nothing)).toBe('');
    }
    expect(lineText(<span />)).toBe('');
  });

  it('does not guess at what a component will draw, alone or among text', () => {
    expect(lineText(<Component />)).toBeNull();
    expect(
      lineText(
        <>
          {'by you · '}
          <Component />
        </>
      )
    ).toBeNull();
    expect(lineText(<bdi>{[<Component key="c" />]}</bdi>)).toBeNull();
  });
});
