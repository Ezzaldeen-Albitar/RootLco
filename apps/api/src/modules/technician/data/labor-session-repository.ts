/**
 * Labour-session reads and writes (Phase 1-19, P1-19-BE-017…019).
 *
 * ## Timestamps are the database's, never the caller's
 *
 * `started_at` defaults to `now()` and `ended_at` is stamped with `now()`; neither is
 * accepted from a request. A client-supplied clock would let a technician's recorded
 * hours be written after the fact, and `tech.guard_labor_session` enforces a
 * backdating window precisely because that matters. The ONE place an explicit window
 * is legal is a correction, and it goes through `tech.correct_labor_session` — which
 * soft-deletes the original and inserts a linked replacement, so the amendment is
 * visible rather than an edit.
 *
 * ## `ended_at` is write-once and the overlap rule is an EXCLUDE
 *
 * `tech.guard_labor_session` refuses any change to a non-null `ended_at`, and
 * `ex_labor_sessions_overlap` — a PARTIAL gist EXCLUDE over
 * `tstzrange(started_at, COALESCE(ended_at, 'infinity'))` — makes both "no overlapping
 * sessions" and "at most one open session per technician" one invariant, because an
 * infinite range always overlaps another infinite one. It arrives as `23P01`.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPage,
  buildPageWithCursors,
  keysetFragment,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';
import { cursorTimestamp } from '@/server/db/pagination';
import { halfOpenLocalDayRange } from '@/server/db/period';
import {
  timelineWindowSql,
  type TimelineSourceRow,
  type TimelineWindow,
} from '@/server/db/timeline';

export interface LaborSessionRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly technicianProfileId: string;
  readonly jobId: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly source: string;
  readonly correctionOfId: string | null;
  readonly recordVersion: number;
}

/** Ordering contract for a job's labour log. Newest start first, id tie-break. */
export const LABOR_SESSION_ORDER = Object.freeze({
  key: 'tech.labor_sessions:started_at_desc',
  direction: 'desc' as const,
});

/**
 * Ordering contract for the labour REPORT. Newest start first, id tie-break.
 *
 * Deliberately NOT `LABOR_SESSION_ORDER`, although the two sort the same table on
 * the same column in the same direction. The difference is the SELECTION: the
 * per-job log answers for ONE job and carries every session on it, running and
 * retired alike, while the report answers for a BRANCH over a calendar period and
 * carries only the contributing ones. A cursor is a position in a selection, so one
 * minted by the job's log names a row this report may never return, and the keyset
 * predicate would then answer with a page that silently begins in the wrong place
 * instead of refusing.
 *
 * The key therefore names the REPORT rather than the table, which is the same
 * property `inv.stock_movements:occurred_at_desc` and
 * `sal.invoice_payment_summary:document_date_desc` carry on the sibling slices: a
 * cursor issued for the other read is refused with `ERR-PAG-001` rather than
 * reinterpreted against a different set of rows.
 */
export const LABOR_REPORT_ORDER = Object.freeze({
  key: 'tech.technician_labor_time:started_at_desc',
  direction: 'desc' as const,
});

/**
 * The period a labour report covers, in the reporting branch's own timezone.
 *
 * The three period fields are the shape `halfOpenLocalDayRange` consumes, and the
 * calendar days are DAYS rather than instants for the reason D-17 gives: a caller
 * who sent an instant would carry an offset of their own choosing, which would
 * silently override the zone the period is supposed to be expressed in.
 */
export interface LaborReportFilter {
  readonly companyId: string;
  readonly branchId: string;
  /** Inclusive first day, `YYYY-MM-DD`, in `timezoneName`. */
  readonly from: string;
  /** EXCLUSIVE day, `YYYY-MM-DD` — the day after the last one reported. */
  readonly toExclusive: string;
  /** An `org.branches.timezone_name` value. Bound as a parameter, never inlined. */
  readonly timezoneName: string;
}

/** One CONTRIBUTING session, with its duration already computed in SQL. */
export interface LaborReportRow {
  readonly id: string;
  readonly technicianProfileId: string;
  /** `tech.technician_profiles.user_id` — the only id a display name resolves from. */
  readonly technicianUserId: string;
  readonly jobId: string;
  readonly startedAt: Date;
  /** WHOLE seconds as an integer string. Never a float, never a JSON number. */
  readonly durationSeconds: string;
  readonly source: string;
}

/** One technician's total over the WHOLE selection, not over a page. */
export interface TechnicianLaborTotalRow {
  readonly technicianProfileId: string;
  readonly technicianUserId: string;
  readonly durationSeconds: string;
}

/** The aggregate and the page it accompanies, from one call. */
export interface LaborReportRows {
  readonly totals: readonly TechnicianLaborTotalRow[];
  readonly page: Page<LaborReportRow>;
}

interface SessionColumns {
  id: string;
  company_id: string;
  branch_id: string;
  technician_profile_id: string;
  job_id: string;
  started_at: Date;
  ended_at: Date | null;
  source: string;
  correction_of_id: string | null;
  record_version: number;
}

const SESSION_COLUMNS = `id, company_id, branch_id, technician_profile_id, job_id,
          started_at, ended_at, source, correction_of_id, record_version`;

const toRow = (row: SessionColumns): LaborSessionRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  technicianProfileId: row.technician_profile_id,
  jobId: row.job_id,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  source: row.source,
  correctionOfId: row.correction_of_id,
  recordVersion: row.record_version,
});

export class LaborSessionRepository extends Repository {
  protected readonly module = 'technician';

  /**
   * Which of these jobs currently have an OPEN labour session (PRE-P1-29-BR-06).
   *
   * A PORT, existing so the work-order job board can render its
   * `hasOpenLaborSession` column without reading `tech.` itself. The module
   * boundary gate refuses a sibling schema in another module’s SQL, and its
   * allow-list is deliberately capped at the two closure predicates the database
   * guard ITSELF joins across — a board convenience column is not one of those,
   * so the honest answer is this method rather than a third exception.
   *
   * BATCHED: one statement for a whole page, because a per-row lookup would make
   * the board an N+1.
   *
   * Reports a FACT and promises no invariant. `tech.labor_sessions` has no
   * one-open-session-per-job constraint (`INS-40`), so two technicians genuinely
   * can hold a session on one job; a caller may WARN about that and must not
   * claim it is prevented.
   */
  async jobsWithOpenSession(db: DbHandle, jobIds: readonly string[]): Promise<readonly string[]> {
    if (jobIds.length === 0) return [];
    const context = this.assertContext(db);
    const result = await this.run<{ job_id: string }>(
      db,
      `SELECT DISTINCT job_id
         FROM tech.labor_sessions
        WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])
          AND ended_at IS NULL AND deleted_at IS NULL`,
      [context.principal.tenantId, [...jobIds]]
    );
    return result.rows.map((row) => row.job_id);
  }

  /**
   * This module's events for the unified work-order timeline (P1-29 `W6`,
   * `INT-043`) — a PORT, as `jobsWithOpenSession` is.
   *
   * Addressed by JOB IDS, because the work-order module knows which jobs an
   * order has and this module may not read `wo.jobs` (ADR-001). A session is
   * two events: `labor_session` at `started_at` and, once stopped,
   * `labor_session_ended` at `ended_at`. Corrections appear as their own
   * sessions; the original is soft-deleted and excluded. `reference` is the
   * technician profile — staff data, which is why the caller must hold
   * `tech.technician.read` before asking.
   */
  async timelineEventsForJobs(
    db: DbHandle,
    jobIds: readonly string[],
    window: TimelineWindow
  ): Promise<readonly TimelineSourceRow[]> {
    if (jobIds.length === 0) return [];
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, [...jobIds]];
    const w = timelineWindowSql(window, 't.occurred_at', 't.kind', 't.id', values.length + 1);
    const result = await this.run<{
      kind: string;
      id: string;
      job_id: string | null;
      actor_id: string | null;
      occurred_at: string;
      from_state: string | null;
      to_state: string | null;
      note: string | null;
      reference: string | null;
      detail: string | null;
      sort_value: string;
    }>(
      db,
      `SELECT t.kind, t.id, t.job_id, t.actor_id, t.occurred_at::text AS occurred_at,
              t.from_state, t.to_state, t.note, t.reference, t.detail,
              ${cursorTimestamp('t.occurred_at')} AS sort_value
         FROM (
           SELECT u.*
             FROM (
               SELECT 'labor_session' AS kind, s.id, s.job_id, s.created_by AS actor_id,
                      s.started_at AS occurred_at, NULL::text AS from_state, NULL::text AS to_state,
                      NULL::text AS note, s.technician_profile_id::text AS reference, s.source AS detail
                 FROM tech.labor_sessions s
                WHERE s.tenant_id = $1 AND s.job_id = ANY($2::uuid[]) AND s.deleted_at IS NULL
               UNION ALL
               SELECT 'labor_session_ended', s.id, s.job_id, s.updated_by, s.ended_at, NULL::text,
                      NULL::text, NULL::text, s.technician_profile_id::text, s.source
                 FROM tech.labor_sessions s
                WHERE s.tenant_id = $1 AND s.job_id = ANY($2::uuid[]) AND s.deleted_at IS NULL
                  AND s.ended_at IS NOT NULL
             ) u
         ) t
        WHERE TRUE ${w.predicate}
        ${w.order}
        ${w.limitClause}`,
      [...values, ...w.values]
    );
    return result.rows.map((row) => ({
      kind: row.kind as TimelineSourceRow['kind'],
      id: row.id,
      jobId: row.job_id,
      actorId: row.actor_id,
      occurredAt: row.occurred_at,
      fromState: row.from_state,
      toState: row.to_state,
      note: row.note,
      reference: row.reference,
      detail: row.detail,
      sortValue: row.sort_value,
    }));
  }

  /**
   * Opens a session. `started_at` is the column default, so it is `now()`.
   *
   * `source` is `manual` because a request IS a manual entry; `timer` is reserved
   * for a device-driven producer that does not exist in this phase, and `correction`
   * may only be written by `tech.correct_labor_session`.
   */
  async open(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly technicianProfileId: string;
      readonly jobId: string;
    }
  ): Promise<LaborSessionRow> {
    const context = this.assertContext(db);
    const result = await this.run<SessionColumns>(
      db,
      `INSERT INTO tech.labor_sessions
         (tenant_id, company_id, branch_id, technician_profile_id, job_id, source, created_by)
       VALUES ($1, $2, $3, $4, $5, 'manual', $6)
       RETURNING ${SESSION_COLUMNS}`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.technicianProfileId,
        input.jobId,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('labour session insert returned no row');
    return toRow(row);
  }

  /** Locks one session, or null when absent or out of scope. */
  async lock(db: DbHandle, sessionId: string): Promise<LaborSessionRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<SessionColumns>(
      db,
      `SELECT ${SESSION_COLUMNS}
         FROM tech.labor_sessions
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, sessionId]
    );
    const row = result.rows[0];
    return row ? toRow(row) : null;
  }

  /**
   * Closes an open session, stamping `ended_at` with the server clock.
   *
   * The `ended_at IS NULL` predicate is not belt-and-braces: `ended_at` is write-once
   * in the guard, so an already-closed session must be refused here rather than
   * reaching the trigger as an attempted rewrite.
   */
  async close(db: DbHandle, sessionId: string, expectedVersion: number): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE tech.labor_sessions
          SET ended_at = now(), updated_by = $3
        WHERE tenant_id = $1 AND id = $2 AND record_version = $4
          AND ended_at IS NULL AND deleted_at IS NULL`,
      [context.principal.tenantId, sessionId, context.principal.userId, expectedVersion]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** One keyset page of a job's labour log, newest start first. */
  async pageForJob(db: DbHandle, jobId: string, page: PageRequest): Promise<Page<LaborSessionRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, jobId];
    const keyset = keysetFragment(
      page,
      { sort: 'started_at', id: 'id' },
      LABOR_SESSION_ORDER,
      values.length + 1
    );
    const result = await this.run<SessionColumns>(
      db,
      `SELECT ${SESSION_COLUMNS}
         FROM tech.labor_sessions
        WHERE tenant_id = $1 AND job_id = $2 AND deleted_at IS NULL
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows = result.rows.map(toRow);
    return buildPage(rows, page, LABOR_SESSION_ORDER, (row) => ({
      sortValue: row.startedAt.toISOString(),
      id: row.id,
    }));
  }

  /**
   * The branch's CONTRIBUTING labour sessions in a calendar period, plus each
   * technician's total over the whole selection (P1-31 P-11, engine slice 2).
   *
   * ## The three rules that decide which rows contribute, and why they are here
   *
   * `ended_at IS NOT NULL` — an OPEN session has no duration. Treating one as
   * running to `now()` would make the same report over the same closed period
   * return a different total every time it is run, which is the property that
   * makes a report untrustworthy rather than merely wrong.
   *
   * `deleted_at IS NULL` — a corrected session is soft-deleted and REPLACED by a
   * linked row carrying `correction_of_id` (`tech.correct_labor_session`).
   * Counting both would double-count every correction. The replacement is counted
   * once, on its own amended window, and it is visible as a correction because
   * `source` travels with it.
   *
   * There is no third predicate for a cancelled state, because there is no
   * cancelled state: `tech.labor_sessions` has no status column at all
   * (`supabase/migrations/20260722099000_tech_labor_sessions.sql`). The report
   * says so rather than showing an empty bucket that reads as a real zero.
   *
   * ## Two statements, and why the totals are not derived from the page
   *
   * The same rule `WorkOrderRepository.statusSummary` states: counting the page
   * would answer for at most `limit` rows and call it the branch's total, which is
   * the P1-28 round-two defect. The aggregate runs over the SAME predicate without
   * the keyset window. The predicate is written once, as `scope` below, because a
   * second copy is how an aggregate and its rows come to answer for different
   * selections.
   *
   * ## The duration is computed in SQL, in WHOLE SECONDS, as text
   *
   * `extract(epoch from (ended_at - started_at))` is exact seconds of an interval;
   * `::bigint` makes it a whole number and `::text` keeps it one all the way to
   * the wire. No float is constructed at any point, and the TOTAL is the sum of
   * the very same per-row expression — so a reader who adds the durations on a
   * page and compares them with the group can never find a rounding disagreement,
   * which `sum()` over an unrounded value would eventually produce.
   *
   * The client never subtracts two timestamps: D-4 requires the calculation to be
   * the server's, and two browsers in two zones must not produce two totals.
   *
   * ## The profile join, and why it does not filter `deleted_at`
   *
   * The join exists only to carry `user_id` out, because that is the only id a
   * display name resolves from and this module holds no names of its own. It is an
   * INNER join and cannot drop a row: `fk_labor_sessions_technician` is composite
   * and `ON DELETE RESTRICT`. It deliberately does NOT require a live profile — a
   * retired technician's recorded hours still happened, and excluding them would
   * quietly reduce a branch's total.
   */
  async laborReport(
    db: DbHandle,
    filter: LaborReportFilter,
    page: PageRequest
  ): Promise<LaborReportRows> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.from,
      filter.toExclusive,
      filter.timezoneName,
    ];
    // One predicate, written once and used by both statements.
    const scope = `FROM tech.labor_sessions s
         JOIN tech.technician_profiles p
           ON p.tenant_id = s.tenant_id AND p.company_id = s.company_id
          AND p.branch_id = s.branch_id AND p.id = s.technician_profile_id
        WHERE s.tenant_id = $1 AND s.company_id = $2 AND s.branch_id = $3
          AND s.ended_at IS NOT NULL AND s.deleted_at IS NULL
          AND ${halfOpenLocalDayRange('s.started_at', 4, 5, 6)}`;
    const duration = `extract(epoch FROM (s.ended_at - s.started_at))::bigint`;

    const totals = await this.run<{
      technician_profile_id: string;
      user_id: string;
      duration_seconds: string;
    }>(
      db,
      `SELECT s.technician_profile_id, p.user_id, sum(${duration})::text AS duration_seconds
         ${scope}
        GROUP BY s.technician_profile_id, p.user_id
        ORDER BY s.technician_profile_id`,
      values
    );

    const keyset = keysetFragment(
      page,
      { sort: 's.started_at', id: 's.id' },
      LABOR_REPORT_ORDER,
      values.length + 1
    );
    const rows = await this.run<{
      id: string;
      technician_profile_id: string;
      user_id: string;
      job_id: string;
      started_at: Date;
      source: string;
      duration_seconds: string;
      sort_value: string;
    }>(
      db,
      `SELECT s.id, s.technician_profile_id, p.user_id, s.job_id, s.started_at, s.source,
              (${duration})::text AS duration_seconds,
              ${cursorTimestamp('s.started_at')} AS sort_value
         ${scope}
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );

    return {
      totals: totals.rows.map((row) => ({
        technicianProfileId: row.technician_profile_id,
        technicianUserId: row.user_id,
        durationSeconds: row.duration_seconds,
      })),
      // `buildPageWithCursors` rather than `buildPage`, because the cursor value
      // is NOT the published timestamp. `pg` decodes `timestamptz` into a JS
      // `Date`, which holds milliseconds while PostgreSQL stores microseconds, and
      // a cursor minted from `.toISOString()` silently SKIPS every row sharing the
      // boundary row's millisecond at a higher microsecond (`P1-27-INT-006`). The
      // `sort_value` column above is the microsecond-precision string.
      page: buildPageWithCursors(
        rows.rows.map((row) => ({
          item: {
            id: row.id,
            technicianProfileId: row.technician_profile_id,
            technicianUserId: row.user_id,
            jobId: row.job_id,
            startedAt: row.started_at,
            durationSeconds: row.duration_seconds,
            source: row.source,
          },
          sortValue: row.sort_value,
          id: row.id,
        })),
        page,
        LABOR_REPORT_ORDER
      ),
    };
  }

  /**
   * Corrects a session through the protected function.
   *
   * Deliberately NOT an UPDATE. `tech.correct_labor_session` soft-deletes the
   * original and inserts a linked replacement carrying `correction_of_id`, in one
   * statement — so the amended hours and the hours they replaced both survive, and
   * the soft delete is what frees the partial EXCLUDE range for the new window.
   * Reimplementing that here would give the platform a second correction path that
   * could disagree with the audited one.
   */
  async correct(
    db: DbHandle,
    input: {
      readonly originalId: string;
      readonly startedAt: Date;
      readonly endedAt: Date;
      readonly reason: string;
    }
  ): Promise<string> {
    const result = await this.run<{ id: string }>(
      db,
      `SELECT tech.correct_labor_session($1::uuid, $2::timestamptz, $3::timestamptz, $4::text) AS id`,
      [input.originalId, input.startedAt, input.endedAt, input.reason]
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error('tech.correct_labor_session returned no id');
    return id;
  }
}
