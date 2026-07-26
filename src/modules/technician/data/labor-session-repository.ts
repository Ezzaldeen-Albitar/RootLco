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
import { buildPage, keysetFragment, type Page, type PageRequest } from '@/server/db/pagination';

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
