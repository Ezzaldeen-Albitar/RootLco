/**
 * Branch-scoped job board and work log — the read layer (PRE-P1-29-BR-06).
 *
 * ## What was missing
 *
 * `apps/api/src/app/api/v1/jobs/` contained exactly one directory, `[jobId]`,
 * exporting `PATCH` only. There was **no job list at any scope** and **no
 * single-job read** (`INS-03`, `INS-13`, `DEP-B4`, `DEP-B5`): every job screen
 * was reached and refreshed through its parent work order, which is workable for
 * a detail pane opened from a board and impossible for one opened from a queue.
 * A supervisor's board was unbuildable.
 *
 * **Iterating the work-order list is not the alternative.** `DEP-B5`'s disposition
 * says so: every one of those calls is registered `expensive-read`, and a client
 * loop over pages would be wrong under paging besides.
 *
 * ## The scope pair is REQUIRED, and RLS cannot compensate
 *
 * These are collection reads, so `scope: 'branch'` is **inert without a target**:
 * there is no row whose branch the pre-handler could evaluate. RLS does not close
 * the gap either, because `app.branch_ids` is the permission-BLIND union of every
 * active grant (`P1-18-A-01`) — a caller holding `wo.work_order.read` in branch X
 * and any grant at all in branch Y would otherwise read Y's board.
 *
 * So `companyId` and `branchId` are required by the schema, and the route hands
 * them to `scopeTargetOption` so the permission is evaluated against the branch
 * actually asked for. This is `T-02`, and it applies here with full force.
 *
 * ## `pendingRequiredAdditionalWork` exists to prevent a predictable 409
 *
 * `ERR-WO-002` refuses a job's move into a `labor_allowed` state while a
 * **required** additional-work request **originating from that job** is still
 * `pending`. All three qualifications matter and each changes the UI. The
 * predicate is computed once, server-side, per row — so a board can disable
 * start/resume with a reason instead of letting the operator discover a 409 for a
 * rule that was entirely predictable from data the screen already had.
 *
 * ## `hasOpenLaborSession` is a WARNING, never a guarantee
 *
 * `tech.labor_sessions` has no one-open-session-per-job constraint (`INS-40`), so
 * two technicians genuinely can open a session on the same job. This flag lets a
 * board say so. It does **not** prevent the second session and nothing here
 * should be read as claiming it does.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPage,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';

/** Newest first, matching every other operational board in the platform. */
export const JOB_BOARD_ORDER: OrderingContract = Object.freeze({
  key: 'wo.jobs:created_at_desc',
  direction: 'desc',
});

export const WORK_LOG_ORDER: OrderingContract = Object.freeze({
  key: 'wo.job_work_logs:logged_at_desc',
  direction: 'desc',
});

export interface JobBoardRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly title: string;
  readonly jobType: string | null;
  readonly state: string;
  readonly requiresDiagnostic: boolean;
  readonly recordVersion: number;
  readonly workOrderDisplayNumber: string | null;
  readonly workOrderState: string;
  /** The `ERR-WO-002` predicate, computed rather than discovered as a 409. */
  readonly pendingRequiredAdditionalWork: boolean;
  readonly openAssignmentCount: number;
  /** A warning. The platform does not prevent a second session (`INS-40`). */
  readonly hasOpenLaborSession: boolean;
}

/**
 * One bound piece of job evidence (PRE-P1-29-BR-07).
 *
 * NO storage key, NO URL, NO checksum and NO bytes — deliberately (`T-09`). A
 * `documentVersionId` is a REFERENCE the attachments module resolves under its
 * own authorization; putting a storage URL here would make evidence readable by
 * reference and route around that check entirely.
 */
export interface JobEvidenceRow {
  readonly id: string;
  readonly jobId: string;
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

/** A work order's evidence, carrying the title of the job it evidences. */
export interface WorkOrderEvidenceRow extends JobEvidenceRow {
  readonly jobTitle: string;
}

export interface WorkLogEntryRow {
  readonly id: string;
  readonly jobId: string;
  readonly entry: string;
  readonly loggedAt: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

interface JobBoardColumns {
  id: string;
  work_order_id: string;
  title: string;
  job_type: string | null;
  state: string;
  requires_diagnostic: boolean;
  record_version: number;
  wo_display_number: string | null;
  wo_state: string;
  pending_required_additional_work: boolean;
  open_assignment_count: string;
  has_open_labor_session: boolean;
  created_at_cursor: string;
}

const toJobBoardRow = (row: JobBoardColumns): JobBoardRow => ({
  id: row.id,
  workOrderId: row.work_order_id,
  title: row.title,
  jobType: row.job_type,
  state: row.state,
  requiresDiagnostic: row.requires_diagnostic,
  recordVersion: row.record_version,
  workOrderDisplayNumber: row.wo_display_number,
  workOrderState: row.wo_state,
  pendingRequiredAdditionalWork: row.pending_required_additional_work,
  openAssignmentCount: Number(row.open_assignment_count),
  hasOpenLaborSession: row.has_open_labor_session,
});

export class JobBoardRepository extends Repository {
  protected readonly module = 'work-order';

  /**
   * The branch job board, keyset-paged.
   *
   * `state` is matched as an OPAQUE lower-snake code and an unknown one yields an
   * EMPTY PAGE rather than a 422 — `wo.job_states` is tenant-extensible, so a code
   * this process has never seen may be perfectly valid for the caller's tenant.
   * Refusing it would make the endpoint disagree with the catalogue it is paired
   * with.
   *
   * The three derived columns are scalar sub-selects rather than joins: a job may
   * have several assignments and several sessions, and a join would multiply the
   * job row by each.
   */
  async pageJobs(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly state?: string | undefined;
      readonly workOrderId?: string | undefined;
      readonly technicianProfileId?: string | undefined;
    },
    page: PageRequest
  ): Promise<Page<JobBoardRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.state ?? null,
      filter.workOrderId ?? null,
      filter.technicianProfileId ?? null,
    ];
    const keyset = keysetFragment(
      page,
      { sort: 'j.created_at', id: 'j.id' },
      JOB_BOARD_ORDER,
      values.length + 1
    );
    const result = await this.run<JobBoardColumns>(
      db,
      `SELECT j.id, j.work_order_id, j.title, j.job_type, j.state,
              j.requires_diagnostic, j.record_version,
              ${cursorTimestamp('j.created_at')} AS created_at_cursor,
              w.display_number AS wo_display_number,
              w.state          AS wo_state,
              EXISTS (
                SELECT 1 FROM wo.additional_work_requests a
                 WHERE a.tenant_id = j.tenant_id
                   AND a.company_id = j.company_id AND a.branch_id = j.branch_id
                   AND a.originating_job_id = j.id
                   AND a.is_required AND a.state = 'pending'
                   AND a.deleted_at IS NULL
              ) AS pending_required_additional_work,
              (SELECT count(*) FROM wo.job_assignments s
                WHERE s.tenant_id = j.tenant_id
                  AND s.company_id = j.company_id AND s.branch_id = j.branch_id
                  AND s.job_id = j.id AND s.valid_to IS NULL
                  AND s.deleted_at IS NULL)::text AS open_assignment_count,
              false AS has_open_labor_session
         FROM wo.jobs j
         JOIN wo.work_orders w
           ON w.tenant_id = j.tenant_id AND w.company_id = j.company_id
          AND w.branch_id = j.branch_id AND w.id = j.work_order_id
        WHERE j.tenant_id = $1 AND j.company_id = $2 AND j.branch_id = $3
          AND j.deleted_at IS NULL
          AND ($4::text IS NULL OR j.state = $4)
          AND ($5::uuid IS NULL OR j.work_order_id = $5)
          -- Applied IN SQL, before the keyset window. Post-filtering a fetched
          -- page yields short pages and a hasMore that lies — the P1-28 round-two
          -- defect. EXISTS, because one technician may hold several assignment
          -- rows on one job and a join would duplicate the job.
          AND ($6::uuid IS NULL OR EXISTS (
                SELECT 1 FROM wo.job_assignments s
                 WHERE s.tenant_id = j.tenant_id
                   AND s.company_id = j.company_id AND s.branch_id = j.branch_id
                   AND s.job_id = j.id
                   AND s.technician_profile_id = $6
                   AND s.valid_to IS NULL AND s.deleted_at IS NULL))
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows = result.rows.map((row) => ({
      ...toJobBoardRow(row),
      cursor: row.created_at_cursor,
    }));
    return buildPage(rows, page, JOB_BOARD_ORDER, (row) => ({
      sortValue: row.cursor,
      id: row.id,
    }));
  }

  /** One job with its board context, resolved under RLS. Out of scope is absent. */
  async findJobWithContext(db: DbHandle, jobId: string): Promise<JobBoardRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<JobBoardColumns>(
      db,
      `SELECT j.id, j.work_order_id, j.title, j.job_type, j.state,
              j.requires_diagnostic, j.record_version,
              ${cursorTimestamp('j.created_at')} AS created_at_cursor,
              w.display_number AS wo_display_number,
              w.state          AS wo_state,
              EXISTS (
                SELECT 1 FROM wo.additional_work_requests a
                 WHERE a.tenant_id = j.tenant_id
                   AND a.company_id = j.company_id AND a.branch_id = j.branch_id
                   AND a.originating_job_id = j.id
                   AND a.is_required AND a.state = 'pending'
                   AND a.deleted_at IS NULL
              ) AS pending_required_additional_work,
              (SELECT count(*) FROM wo.job_assignments s
                WHERE s.tenant_id = j.tenant_id
                  AND s.company_id = j.company_id AND s.branch_id = j.branch_id
                  AND s.job_id = j.id AND s.valid_to IS NULL
                  AND s.deleted_at IS NULL)::text AS open_assignment_count,
              false AS has_open_labor_session
         FROM wo.jobs j
         JOIN wo.work_orders w
           ON w.tenant_id = j.tenant_id AND w.company_id = j.company_id
          AND w.branch_id = j.branch_id AND w.id = j.work_order_id
        WHERE j.tenant_id = $1 AND j.id = $2 AND j.deleted_at IS NULL`,
      [context.principal.tenantId, jobId]
    );
    const row = result.rows[0];
    return row === undefined ? null : toJobBoardRow(row);
  }

  /** The scope of one job, for the authorization check that precedes the read. */
  async jobScope(
    db: DbHandle,
    jobId: string
  ): Promise<{ readonly companyId: string; readonly branchId: string } | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ company_id: string; branch_id: string }>(
      db,
      `SELECT company_id, branch_id FROM wo.jobs
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, jobId]
    );
    const row = result.rows[0];
    return row === undefined ? null : { companyId: row.company_id, branchId: row.branch_id };
  }

  /**
   * The OPEN assignments of one job.
   *
   * Reached only through the `tech.technician.read` gate in the service (`T-05`),
   * because every row here names a member of staff. `valid_to IS NULL` is the
   * open predicate — `wo.job_assignments` is dated exactly as the reception party
   * roles are, so a reassignment closes a row rather than editing it.
   */
  async openAssignmentsFor(
    db: DbHandle,
    jobId: string
  ): Promise<
    readonly {
      readonly id: string;
      readonly technicianProfileId: string;
      readonly assignmentRole: string;
      readonly validFrom: string;
    }[]
  > {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      technician_profile_id: string;
      assignment_role: string;
      valid_from: string;
    }>(
      db,
      `SELECT id, technician_profile_id, assignment_role,
              valid_from::text AS valid_from
         FROM wo.job_assignments
        WHERE tenant_id = $1 AND job_id = $2
          AND valid_to IS NULL AND deleted_at IS NULL
        ORDER BY valid_from ASC, id ASC`,
      [context.principal.tenantId, jobId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      technicianProfileId: row.technician_profile_id,
      assignmentRole: row.assignment_role,
      validFrom: row.valid_from,
    }));
  }

  /**
   * Appends one work-log entry.
   *
   * `created_by` is stamped from the resolved principal and is never accepted
   * from the body — a log whose author the author chooses is not evidence.
   * `company_id`/`branch_id` come from the JOB row, never from the request, so a
   * caller cannot file an entry into a branch it merely named.
   */
  async insertWorkLog(
    db: DbHandle,
    input: {
      readonly jobId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly entry: string;
      readonly loggedAt: Date | null;
    }
  ): Promise<WorkLogEntryRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      job_id: string;
      entry: string;
      logged_at: string;
      created_at: string;
      created_by: string;
    }>(
      db,
      `INSERT INTO wo.job_work_logs
         (tenant_id, company_id, branch_id, job_id, entry, logged_at, created_by)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7)
       RETURNING id, job_id, entry, logged_at::text AS logged_at,
                 created_at::text AS created_at, created_by`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.jobId,
        input.entry,
        input.loggedAt === null ? null : input.loggedAt.toISOString(),
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('job work log insert returned no row');
    return {
      id: row.id,
      jobId: row.job_id,
      entry: row.entry,
      loggedAt: row.logged_at,
      createdAt: row.created_at,
      createdBy: row.created_by,
    };
  }

  /** One job's work log, newest first, keyset-paged. */
  async pageWorkLogs(
    db: DbHandle,
    jobId: string,
    page: PageRequest
  ): Promise<Page<WorkLogEntryRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, jobId];
    const keyset = keysetFragment(
      page,
      { sort: 'logged_at', id: 'id' },
      WORK_LOG_ORDER,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      job_id: string;
      entry: string;
      logged_at: string;
      created_at: string;
      created_by: string;
      logged_at_cursor: string;
    }>(
      db,
      `SELECT id, job_id, entry, logged_at::text AS logged_at,
              created_at::text AS created_at, created_by,
              ${cursorTimestamp('logged_at')} AS logged_at_cursor
         FROM wo.job_work_logs
        WHERE tenant_id = $1 AND job_id = $2
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows = result.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      entry: row.entry,
      loggedAt: row.logged_at,
      createdAt: row.created_at,
      createdBy: row.created_by,
      cursor: row.logged_at_cursor,
    }));
    return buildPage(rows, page, WORK_LOG_ORDER, (row) => ({
      sortValue: row.cursor,
      id: row.id,
    }));
  }

  /** The job's `created_at`, so a `loggedAt` before the job existed is refused. */
  async jobCreatedAt(db: DbHandle, jobId: string): Promise<Date | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ created_at: Date }>(
      db,
      `SELECT created_at FROM wo.jobs
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, jobId]
    );
    return result.rows[0]?.created_at ?? null;
  }

  // ---------------------------------------------------------------------------
  // Job evidence (BR-07)
  // ---------------------------------------------------------------------------

  /**
   * Binds one document version to one job.
   *
   * `company_id`/`branch_id` come from the JOB row and `created_by` from the
   * resolved principal — never from the request. A caller cannot file evidence
   * into a branch it merely named, and cannot attribute it to somebody else.
   *
   * Append-only: no update and no delete here, and none at the grant layer
   * either, so a mis-attached photograph is permanent.
   */
  async insertJobEvidence(
    db: DbHandle,
    input: {
      readonly jobId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly documentVersionId: string;
      readonly evidenceType: string;
      readonly note: string | null;
    }
  ): Promise<JobEvidenceRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      job_id: string;
      document_version_id: string;
      evidence_type: string;
      note: string | null;
      created_at: string;
      created_by: string;
    }>(
      db,
      `INSERT INTO wo.job_evidence
         (tenant_id, company_id, branch_id, job_id, document_version_id,
          evidence_type, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, job_id, document_version_id, evidence_type, note,
                 created_at::text AS created_at, created_by`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.jobId,
        input.documentVersionId,
        input.evidenceType,
        input.note,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('job evidence insert returned no row');
    return {
      id: row.id,
      jobId: row.job_id,
      documentVersionId: row.document_version_id,
      evidenceType: row.evidence_type,
      note: row.note,
      createdAt: row.created_at,
      createdBy: row.created_by,
    };
  }

  /** One job's evidence, oldest first. Unpaged, matching the diagnostic list. */
  async evidenceForJob(db: DbHandle, jobId: string): Promise<readonly JobEvidenceRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      job_id: string;
      document_version_id: string;
      evidence_type: string;
      note: string | null;
      created_at: string;
      created_by: string;
    }>(
      db,
      `SELECT id, job_id, document_version_id, evidence_type, note,
              created_at::text AS created_at, created_by
         FROM wo.job_evidence
        WHERE tenant_id = $1 AND job_id = $2
        ORDER BY created_at ASC, id ASC`,
      [context.principal.tenantId, jobId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      documentVersionId: row.document_version_id,
      evidenceType: row.evidence_type,
      note: row.note,
      createdAt: row.created_at,
      createdBy: row.created_by,
    }));
  }

  /**
   * A work order's evidence across ALL its jobs, in one statement.
   *
   * The join is what makes a work-order gallery possible without one call per
   * job. `jobTitle` travels with each row because a gallery that shows six
   * photographs and cannot say which piece of work each evidences is not much
   * of a gallery.
   */
  async evidenceForWorkOrder(
    db: DbHandle,
    workOrderId: string
  ): Promise<readonly WorkOrderEvidenceRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      job_id: string;
      document_version_id: string;
      evidence_type: string;
      note: string | null;
      created_at: string;
      created_by: string;
      job_title: string;
    }>(
      db,
      `SELECT e.id, e.job_id, e.document_version_id, e.evidence_type, e.note,
              e.created_at::text AS created_at, e.created_by, j.title AS job_title
         FROM wo.job_evidence e
         JOIN wo.jobs j
           ON j.tenant_id = e.tenant_id AND j.company_id = e.company_id
          AND j.branch_id = e.branch_id AND j.id = e.job_id
        WHERE e.tenant_id = $1 AND j.work_order_id = $2 AND j.deleted_at IS NULL
        ORDER BY e.created_at ASC, e.id ASC`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      documentVersionId: row.document_version_id,
      evidenceType: row.evidence_type,
      note: row.note,
      createdAt: row.created_at,
      createdBy: row.created_by,
      jobTitle: row.job_title,
    }));
  }

  /** The scope of one work order, for the check that precedes the read. */
  async workOrderScope(
    db: DbHandle,
    workOrderId: string
  ): Promise<{ readonly companyId: string; readonly branchId: string } | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ company_id: string; branch_id: string }>(
      db,
      `SELECT company_id, branch_id FROM wo.work_orders
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, workOrderId]
    );
    const row = result.rows[0];
    return row === undefined ? null : { companyId: row.company_id, branchId: row.branch_id };
  }
}
