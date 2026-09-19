/**
 * The half-open calendar period, resolved in a named timezone (P1-31 P-11, D-17).
 *
 * ## Why this is a helper and not a copy in each repository
 *
 * The Owner's decision D-17 is one sentence — every report period is half-open,
 * `[from, to)`, expressed in the selected branch's timezone and converted
 * consistently before it reaches a server query
 * (`docs/phase-1/phase-1-31/owner-decisions-2026-09-10.md` § 4). "Consistently"
 * is the load-bearing word: two repositories that each write the predicate from
 * memory will eventually disagree about one microsecond or one day boundary, and
 * the disagreement shows up as two reports over the same period that do not add
 * up. So the predicate is written ONCE, here, and every dataset that buckets by a
 * calendar day composes it.
 *
 * The expression below is the one `WorkOrderRepository.statusSummary` already ran
 * before this file existed, moved rather than redesigned — engine slice 1's suite
 * is what proves the move changed nothing.
 *
 * ## What the SQL means, term by term
 *
 * `$from::date` is a calendar day, which is not an instant. `::timestamp` reads it
 * as local midnight without yet saying local to WHERE, and `AT TIME ZONE $tz`
 * answers that, producing the `timestamptz` that is midnight in the named zone. So
 * "opened on the 3rd" means the 3rd where the workshop is, not where the server
 * is.
 *
 * `>= from` and `< to` rather than `BETWEEN`: a closed upper bound over a DAY
 * either swallows the next day's first instant or drops the last one's final
 * microsecond, and both are wrong in a way that only ever surfaces as a total
 * that does not add up. `to` is therefore the first day EXCLUDED — the day after
 * the last one reported — and every caller's API says so.
 *
 * ## Identifiers are code-controlled; the zone is a bind parameter
 *
 * `column` is interpolated, so it must never carry caller input — every call site
 * passes a literal written in source, exactly as `keysetFragment` requires of its
 * own column names. The ZONE is never interpolated: it arrives as `$tz`, and the
 * only column that feeds it (`org.branches.timezone_name`) is constrained by
 * `fk_branches_timezone_name` to a `shared.timezones` row.
 *
 * This file holds no I/O and opens no connection. It builds a string.
 */

/**
 * The period, as an already-validated input.
 *
 * `toExclusive` is named rather than `to` because the name is the contract: a
 * reader who sees `to` assumes the last day reported, and that assumption is the
 * off-by-one this whole helper exists to prevent.
 */
export interface LocalDayPeriod {
  /** First day included, `YYYY-MM-DD`. */
  readonly from: string;
  /** First day EXCLUDED — the day after the last one reported, `YYYY-MM-DD`. */
  readonly toExclusive: string;
  /** An IANA zone name, e.g. the branch's `org.branches.timezone_name`. */
  readonly timezoneName: string;
}

/**
 * The `[from, to)` predicate for one `timestamptz` column in one named zone.
 *
 * The three indexes are the 1-based positions of `from`, `toExclusive` and the
 * zone name in the caller's own parameter array; the caller appends nothing and
 * reorders nothing, so the values and the fragment cannot drift apart.
 *
 * Returns a bare predicate with no leading `AND`, so a caller composes it into
 * whatever scope clause it already has.
 */
export function halfOpenLocalDayRange(
  column: string,
  fromIndex: number,
  toExclusiveIndex: number,
  timezoneIndex: number
): string {
  return (
    `${column} >= (($${fromIndex}::date)::timestamp AT TIME ZONE $${timezoneIndex})\n` +
    `          AND ${column} <  (($${toExclusiveIndex}::date)::timestamp AT TIME ZONE $${timezoneIndex})`
  );
}
