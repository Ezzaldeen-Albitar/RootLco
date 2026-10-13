import { expect } from 'vitest';

/**
 * The two-line cell that says `text`, with both of its lines on a line height
 * of their own (P1-32-PRE-OD-INVH, P1-32-PRE-OD-UXQ).
 *
 * A grid row has one fixed height, and a cell gives its text a line as tall as
 * the row. Two stacked lines fit only when EACH carries a compact line height:
 * a first line left to inherit the cell's takes the whole row and the second is
 * cut off below it. jsdom lays nothing out, so what a DOM test can hold is the
 * utilities that set the two line heights — `text-table-cell` on the first
 * line, `text-caption` on the second. That they then fit is seen only in a
 * browser.
 *
 * The cell is looked for by what one of its lines says rather than by an
 * element, because the same words are often on the row a second time — in the
 * name of the row's action, for a screen reader.
 */
export function expectTwoLinesOnTheirOwnLineHeight(
  container: HTMLElement,
  text: string
): HTMLElement {
  const cells = [...container.querySelectorAll<HTMLElement>('[data-grid-cell="two-line"]')].filter(
    (candidate) => [...candidate.children].some((line) => (line.textContent ?? '').includes(text))
  );
  expect(cells, `no two-line cell says "${text}"`).toHaveLength(1);
  const cell = cells[0] as HTMLElement;
  const lines = [...cell.children];
  expect(lines, `the cell that says "${text}" does not have two lines`).toHaveLength(2);
  expect(lines[0]).toHaveAttribute('data-grid-line', 'primary');
  expect(lines[0]).toHaveClass('text-table-cell');
  expect(lines[1]).toHaveAttribute('data-grid-line', 'secondary');
  expect(lines[1]).toHaveClass('text-caption');
  return cell;
}
