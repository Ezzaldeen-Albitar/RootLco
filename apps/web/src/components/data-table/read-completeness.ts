import type { TableStatus } from './DataTable';

/**
 * Whether a paged read is entitled to make a NEGATIVE claim.
 *
 * ## The defect this exists to make impossible
 *
 * Every cursor-paginated read publishes `hasMore`, and a screen that drops it
 * has only two states left — rows, or no rows — so the second one gets rendered
 * as an established absence. "No active link between this requester and this
 * vehicle is recorded" printed after reading twenty-five of a customer's
 * twenty-six vehicles is not a cautious statement, it is a false one, and it is
 * false in exactly the case the operator most needs it to be right.
 *
 * A FAILED read is worse, because `ServerPage` reports `hasMore: false` on every
 * failure branch (`lib/customers/vehicles.ts:21`, and every adapter built on the
 * same `EMPTY`). So "nothing came back" and "there is nothing" are the same two
 * fields unless something separates them. `AcknowledgementDocument.tsx` already
 * says this in words — "A failed read reports `hasMore: false`, which is not a
 * claim that there is no more" — and this module is that sentence made
 * mechanical, so a screen cannot forget it.
 *
 * ## Three answers, never two
 *
 *   - `complete` — the read finished and covered the set. An absence found here
 *     IS a fact and may be stated as one.
 *   - `truncated` — the read finished and the server says more exists. Nothing
 *     is established about what was not read.
 *   - `unreadable` — the read did not answer (denied, expired, rate-limited,
 *     unavailable, error). Nothing is established at all.
 *
 * `pending` is the fourth value and is not one of the three: it is the read
 * still being in flight, which every screen already renders as a loading state.
 */
export type ReadCompleteness = 'pending' | 'complete' | 'truncated' | 'unreadable';

/**
 * The completeness of one `useServerTable` page.
 *
 * `hasMore` is read from the RESPONSE, never from the status: `useServerTable`
 * returns `response: null` for every non-`ok` page, so a caller passing
 * `table.response?.hasMore` hands `undefined` through on precisely the branch
 * where trusting `false` would be the bug.
 */
export function readCompleteness(
  status: TableStatus,
  hasMore: boolean | undefined
): ReadCompleteness {
  if (status === 'loading') return 'pending';
  if (status !== 'idle') return 'unreadable';
  return hasMore === true ? 'truncated' : 'complete';
}

/**
 * Whether a row matching a predicate is in the set — as one of five answers.
 *
 * `present` is decided by the rows themselves and therefore survives truncation:
 * finding the row is positive proof whatever else was not read. Every other
 * answer defers to `readCompleteness`, so an absence is only ever called
 * `absent` when the read that failed to find it covered the whole set.
 */
export type MembershipVerdict =
  'present' | 'absent' | 'unknown-truncated' | 'unknown-unreadable' | 'pending';

export function membershipVerdict<Row>(
  status: TableStatus,
  response: { readonly rows: readonly Row[]; readonly hasMore?: boolean } | null,
  matches: (row: Row) => boolean
): MembershipVerdict {
  if (response !== null && response.rows.some(matches)) return 'present';
  switch (readCompleteness(status, response?.hasMore)) {
    case 'pending':
      return 'pending';
    case 'unreadable':
      return 'unknown-unreadable';
    case 'truncated':
      return 'unknown-truncated';
    default:
      return 'absent';
  }
}

/**
 * Whether an operator can still reach rows this page does not hold.
 *
 * A notice that says "more exists" and offers no way to see it tells an operator
 * their answer is somewhere they cannot go. Every surface that renders a
 * truncation notice therefore also renders `CursorPager`, and this predicate is
 * what both of them agree on.
 */
export function canPage(page: number, status: TableStatus, hasMore: boolean | undefined): boolean {
  return page > 1 || readCompleteness(status, hasMore) === 'truncated';
}
