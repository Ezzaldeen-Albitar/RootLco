'use client';

import { withPage } from './table-state';
import type { ServerTable } from './use-server-table';
import { canPage, hasFurtherPage, readCompleteness } from './read-completeness';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * Previous/Next over a cursor-paginated list that is NOT a `DataTable`.
 *
 * `DataTable` has a pager, and every screen built on it can already reach page
 * two. The pickers cannot: a radio list of a customer's vehicles, a step's
 * read-back, a refusal list filtered out of a union — each one renders
 * `table.response.rows` directly and stops there. So each one held exactly one
 * page and had no control that could ask for another, which is what turned a
 * page boundary into "that vehicle is not in this customer's list".
 *
 * Rendered only when there is somewhere to go — page two exists, or the operator
 * is already past page one. A pager that is always visible and always disabled
 * is noise on the common path, and this control sits inside forms.
 *
 * No page COUNT and no "of N": these operations publish `hasMore` and no total,
 * for the reason `table-state.ts` states at length, and printing a denominator
 * nobody sent is the same class of invention this whole change exists to remove.
 */
export function CursorPager<Row>({
  messages,
  table,
  label,
}: {
  readonly messages: Messages;
  readonly table: ServerTable<Row>;
  /** The accessible name of this pager — several may sit on one screen. */
  readonly label: string;
}) {
  const page = table.request.page;
  const hasMore = table.response?.hasMore;
  if (!canPage(page, table.status, hasMore)) return null;

  // Neither direction is offered while the page in hand is not a read page:
  // paging off an unreadable page would send a cursor nothing established.
  const settled = readCompleteness(table.status, hasMore, page);
  // The END of the walk is a different question from the coverage of the set:
  // page five of five is `truncated` as a claim and still has no page six.
  const atEnd = !hasFurtherPage(table.status, hasMore);

  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={page <= 1 || settled === 'pending'}
        onClick={() => table.setRequest(withPage(table.request, page - 1))}
        className="rounded-md border border-border px-3 py-1.5 text-caption text-text-primary disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {translate(messages, 'table.previousPage')}
      </button>
      {/* `aria-live` so the page number is announced after a move: focus stays
          on the button, and the only thing that changed is elsewhere. */}
      <span aria-live="polite" className="text-caption text-text-secondary">
        {page}
      </span>
      <button
        type="button"
        disabled={atEnd}
        onClick={() => table.setRequest(withPage(table.request, page + 1))}
        className="rounded-md border border-border px-3 py-1.5 text-caption text-text-primary disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {translate(messages, 'table.nextPage')}
      </button>
    </nav>
  );
}
