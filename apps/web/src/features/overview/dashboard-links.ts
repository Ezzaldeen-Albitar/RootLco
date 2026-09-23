import type { Locale } from '@/i18n/config';
import {
  WORK_ORDER_BOARD_DEFAULT_VIEW,
  WORK_ORDER_STATE_CODE_PATTERN,
  type WorkOrderBoardView,
} from '@/features/work-orders/work-orders-contract';
import {
  ATTENTION_BRANCH_PARAM,
  isAttentionBranchParam,
} from '@/features/attention/attention-contract';
import type { DashboardSummaryCriteria } from './overview-contract';

/**
 * Where a figure on the dashboard takes the reader.
 *
 * ## A figure nobody can open is a poster
 *
 * Every count here is a count of rows that exist on another screen, and the
 * reader's next question is always the same one: *which* rows. So each card
 * carries the address of the list it counted, narrowed the same way the count
 * was — and the narrowing travels as a VIEW NAME or a STATE CODE, never as
 * anything an operator typed.
 *
 * The Owner rule this obeys: a link offered as "the list" must lead to a list
 * that counts EXACTLY the figure's set — same predicate, same period, same
 * branch scope. Where no such list exists the link is worded as a related
 * destination instead (`attentionAreaLink`), or the figure is not a link.
 *
 * ## What may travel in an address, and why only this
 *
 * `components/data-table/table-state.ts` states the rule this module obeys: an
 * address may carry WHICH filter is applied and never the VALUE somebody typed,
 * because a URL is written to history, to access logs and to the `Referer`
 * header of every outbound request. A view name is drawn from a list of nine
 * this repository declares; a state code is drawn from the workshop's own
 * vocabulary and is checked against the operation's own pattern before it is
 * believed; a period name is one of four; a branch is an identifier the reader's
 * own working context already holds. None of them is free text, none of them
 * names a person, a vehicle or an amount, and none of them is in
 * `FORBIDDEN_URL_KEYS`.
 *
 * The two boards read these back through their own validators. A name neither
 * side recognises is DROPPED rather than sent, so a hand-edited address opens
 * the default board instead of asking the backend something it will refuse.
 */

/** The address of the work-order board, at one of its nine views. */
export function workOrdersViewLink(locale: Locale, view: WorkOrderBoardView): string {
  // The board's own default is expressed by saying nothing. An address that
  // carries the default is an address that has to be kept in step with it, and
  // this one cannot drift.
  return view === WORK_ORDER_BOARD_DEFAULT_VIEW
    ? `/${locale}/work-orders`
    : `/${locale}/work-orders?view=${encodeURIComponent(view)}`;
}

/**
 * The address of the work-order board, filtered to ONE state of the workshop's
 * own vocabulary.
 *
 * Returns the unfiltered board for a code that does not match the operation's
 * pattern. A code that cannot be sent is not a link worth making: it would be
 * answered 422 on arrival, far from the bar that was clicked.
 */
export function workOrdersStateLink(locale: Locale, code: string): string {
  return WORK_ORDER_STATE_CODE_PATTERN.test(code)
    ? `/${locale}/work-orders?state=${encodeURIComponent(code)}`
    : `/${locale}/work-orders`;
}

/**
 * The address of the reception board over the SAME period the figure counted.
 *
 * The two days of a chosen period travel with it. They are calendar days the
 * reader picked for a report — not a name, a plate or an amount — and without
 * them "the period you were looking at" cannot be carried across at all.
 */
export function receptionsPeriodLink(locale: Locale, criteria: DashboardSummaryCriteria): string {
  if (criteria.period !== 'custom') return `/${locale}/receptions?period=${criteria.period}`;
  if (criteria.from === undefined || criteria.to === undefined) return `/${locale}/receptions`;
  const query = new URLSearchParams({
    period: 'custom',
    from: criteria.from,
    to: criteria.to,
  });
  return `/${locale}/receptions?${query.toString()}`;
}

/**
 * The Attention area, where a stock or allowance warning is acted on.
 *
 * With a branch, the page opens with that branch already chosen — the branch the
 * figure was counted for. Without one, or with a value that is not an
 * identifier, it opens with the choice left to the reader.
 *
 * NOT "the list" behind the low-stock figure, and no caller may word it as
 * one. The figure counts distinct ITEMS; the page lists FINDINGS — one per
 * applicable reorder level, so one item may appear more than once — and caps
 * its list. It is where those items are dealt with, which is what the link
 * text says.
 */
export function attentionAreaLink(locale: Locale, branchId: string | null = null): string {
  return isAttentionBranchParam(branchId)
    ? `/${locale}/attention?${ATTENTION_BRANCH_PARAM}=${encodeURIComponent(branchId)}`
    : `/${locale}/attention`;
}
