/**
 * A timeline window, and the merge that pages several ledgers as one
 * (P1-29 `W6`, `INT-043`).
 *
 * ## The problem this solves, and why it is not a SQL UNION
 *
 * A work order's history lives in several append-only ledgers owned by FOUR
 * modules: the work order's and its jobs' status ledgers, assignments, the
 * work log, evidence and blockers in `wo`; labour sessions in `tech`;
 * report status in `dia`; QC status in `qms`. One `UNION ALL` across them
 * would be the shortest code and is exactly what ADR-001 forbids — a module
 * reads only its own schema, and the module-boundary gate's allow-list is
 * capped at the two closure predicates the database guard itself joins across.
 *
 * So each module answers the same QUESTION over its own tables — "your events
 * for this work order, older than this point, at most N" — and the merge
 * happens here, in memory, with correct keyset semantics: every source returns
 * its own top `limit + 1` below the cursor, and the union's top `limit + 1`
 * is contained in the union of those. Nothing is skipped, nothing duplicates.
 *
 * ## The order is `(occurred_at, kind, id)`, and the cursor says so
 *
 * The shared cursor contract keeps its tie-breaker a UUID (`P1-15-SR-013`),
 * and one row can legitimately be two events — an assignment is `assignment`
 * at `valid_from` and `assignment_ended` at `valid_to`. So the KIND is part of
 * the order and travels in the cursor's position value, beside the timestamp:
 * `v` is `<microsecond timestamp>|<kind>` and `i` is the row id. The predicate
 * is a three-way row comparison, which is what makes the order total.
 * `occurred_at` travels as the database's own microsecond text
 * (`cursorTimestamp`), never as a JS `Date` (`P1-27-INT-006`).
 */

/** The event kinds a work-order timeline may carry. CLOSED. */
export const TIMELINE_KINDS = [
  'work_order_status',
  'job_status',
  'assignment',
  'assignment_ended',
  'labor_session',
  'labor_session_ended',
  'work_log',
  'evidence',
  'blocker_raised',
  'blocker_resolved',
  'diagnostic_status',
  'qc_status',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/** "Older than this point, at most this many." `before === null` is the first page. */
export interface TimelineWindow {
  readonly before: {
    readonly occurredAt: string;
    readonly kind: string;
    readonly id: string;
  } | null;
  readonly limit: number;
}

/**
 * One event as a SOURCE reports it — the published entry plus the exact
 * `sortValue` the next page's predicate compares against.
 */
export interface TimelineSourceRow {
  readonly kind: TimelineKind;
  readonly id: string;
  readonly jobId: string | null;
  readonly actorId: string | null;
  /** ISO text, as the database renders it. */
  readonly occurredAt: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  /** A reason, an entry, a note — the human text the event carries, if any. */
  readonly note: string | null;
  /** The id the event points at: a technician profile, a document version, a report, a QC record, a raise. */
  readonly reference: string | null;
  /** A closed-vocabulary qualifier: assignment role, session source, evidence type. */
  readonly detail: string | null;
  /** `cursorTimestamp(occurred_at)` — microsecond text, for the cursor. */
  readonly sortValue: string;
}

const POSITION_SEPARATOR = '|';

/** The cursor's position value: the microsecond timestamp and the kind, together. */
export function encodeTimelinePosition(sortValue: string, kind: string): string {
  return `${sortValue}${POSITION_SEPARATOR}${kind}`;
}

/**
 * The window a cursor's position names, or null for a value that is not one.
 *
 * A kind outside the closed vocabulary is refused rather than compared: the
 * predicate would still be well-formed, but a page "older than a kind that
 * does not exist" is not a page anyone was issued.
 */
export function decodeTimelinePosition(
  value: string
): { readonly occurredAt: string; readonly kind: TimelineKind } | null {
  const at = value.lastIndexOf(POSITION_SEPARATOR);
  if (at <= 0) return null;
  const occurredAt = value.slice(0, at);
  const kind = value.slice(at + 1);
  if (!(TIMELINE_KINDS as readonly string[]).includes(kind)) return null;
  return { occurredAt, kind: kind as TimelineKind };
}

/**
 * The SQL a source appends to select its window, plus the values.
 *
 * The three column expressions are code-controlled identifiers of the source's
 * own (sub)query; every source projects `kind` and `sort_value` as
 * `cursorTimestamp(occurred_at)` so the merge can read them uniformly. Returns
 * an empty predicate for the first page. The limit is `window.limit + 1`: the
 * sentinel row every source over-fetches so the merged page can say `hasMore`
 * without a second query.
 */
export function timelineWindowSql(
  window: TimelineWindow,
  occurredAtColumn: string,
  kindColumn: string,
  idColumn: string,
  nextParamIndex: number
): {
  readonly predicate: string;
  readonly order: string;
  readonly limitClause: string;
  readonly values: readonly unknown[];
} {
  const values: unknown[] = [];
  let predicate = '';
  let index = nextParamIndex;
  if (window.before !== null) {
    predicate =
      `AND (${occurredAtColumn}, ${kindColumn}, ${idColumn}) < ` +
      `($${index}::timestamptz, $${index + 1}, $${index + 2}::uuid)`;
    values.push(window.before.occurredAt, window.before.kind, window.before.id);
    index += 3;
  }
  values.push(window.limit + 1);
  return {
    predicate,
    order: `ORDER BY ${occurredAtColumn} DESC, ${kindColumn} DESC, ${idColumn} DESC`,
    limitClause: `LIMIT $${index}`,
    values,
  };
}

/**
 * Merge several sources' windows into one page, newest first.
 *
 * Each source is already sorted `(occurred_at DESC, kind DESC, id DESC)` and
 * holds at most `limit + 1` rows. The merged order is the same total order.
 * Returns `limit + 1` rows at most; the caller trims the sentinel and mints the
 * cursor from the last kept row.
 */
export function mergeTimelineWindows(
  sources: readonly (readonly TimelineSourceRow[])[],
  limit: number
): readonly TimelineSourceRow[] {
  const all = sources.flat();
  all.sort((a, b) => {
    if (a.sortValue !== b.sortValue) return a.sortValue < b.sortValue ? 1 : -1;
    if (a.kind !== b.kind) return a.kind < b.kind ? 1 : -1;
    if (a.id !== b.id) return a.id < b.id ? 1 : -1;
    return 0;
  });
  return all.slice(0, limit + 1);
}
