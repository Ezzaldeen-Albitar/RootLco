/**
 * Job board, QC queue and work log — application service (PRE-P1-29-BR-06).
 *
 * ## The rule that decides `assignments`, and why it is OMITTED not empty
 *
 * `T-05`: assignment and labour reads require `tech.technician.read`, **not**
 * `wo.work_order.read`, because both name a member of staff. Folding them into a
 * work-order-read response would quietly undo a control the Backend set
 * deliberately.
 *
 * So `wo.job-detail` omits the key entirely for a caller without that code. It is
 * `undefined`, not `[]`, and the difference is the whole point: an empty array
 * asserts *this job has no assignments*, which is a claim about the data. An
 * absent key says *this response does not answer that question*, which is the
 * truth. A UI that renders "unassigned" from an empty array handed to it by an
 * authorization rule would be displaying a fabrication.
 *
 * ## Pause and resume are NOT here, and that is a decision
 *
 * `INS-26` records both as compositions of two calls, and the directive asks this
 * slice to cover them. **The answer is that no pause endpoint should be built**,
 * and the reasoning belongs in the code because "add a pause endpoint" is the
 * obvious move:
 *
 *  - it would have to stop the labour session AND transition the job, in one
 *    transaction, across two aggregates with two different permissions
 *    (`tech.labor.record` and `wo.job.transition`). Composing them server-side
 *    either COLLAPSES the two permissions into one — a silent widening — or
 *    refuses when the caller holds one and not the other, which is what the
 *    two-call form already does, more legibly;
 *  - the ordering is not symmetric and not guessable: **start** transitions
 *    first (a session against a `planned` job is refused, `labor_allowed` false),
 *    **pause** stops the session first (transitioning to `paused` with a session
 *    open is refused for the same reason, and closure blocker B2 would then bite
 *    with no obvious cause);
 *  - `ERR-WO-002` refuses *resume* and not *pause*, so a single pause/resume pair
 *    would have to explain an error that applies in one direction only.
 *
 * What this slice ships instead is the data that lets a UI get the composition
 * right without guessing: the published job graph with `laborAllowed` per state,
 * and `pendingRequiredAdditionalWork` per board row.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import { pageRequest, type Page } from '@/server/db/pagination';
import {
  JOB_BOARD_ORDER,
  QC_BRANCH_ORDER,
  WORK_LOG_ORDER,
  type JobBoardRepository,
  type JobBoardRow,
  type QcRecordRow,
  type WorkLogEntryRow,
} from '../data/job-board-repository';
import type { WorkOrderCatalogService } from './work-order-catalog-service';
import type { ReachableState } from './work-order-service';

/** `qms.quality_control_records.overall_result` — a CLOSED vocabulary. */
export const QC_OVERALL_RESULTS = ['pending', 'passed', 'failed'] as const;
export type QcOverallResult = (typeof QC_OVERALL_RESULTS)[number];

/**
 * The shape a tenant-extensible state code must take.
 *
 * Mirrors `ck_jobs_state_format`. Deliberately NOT an enum: `wo.job_states` is
 * tenant-extensible, so a code this process has never seen may be perfectly valid
 * for the caller's tenant. An unknown code yields an empty page, never a 422.
 */
export const STATE_CODE_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

export const MAX_WORK_LOG_ENTRY = 4000;

export interface PageInput {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface JobAssignmentView {
  readonly id: string;
  readonly technicianProfileId: string;
  readonly assignmentRole: string;
  readonly validFrom: string;
}

/**
 * `assignments` is optional BY CONTRACT, not by accident — see the header.
 * `nextStates` is computed from the catalogue, never from a constant, so a
 * tenant that configured its own graph gets its own answer.
 */
export interface JobDetail {
  readonly job: JobBoardRow;
  readonly nextStates: readonly ReachableState[];
  readonly assignments?: readonly JobAssignmentView[];
}

export class JobBoardService extends ApplicationService {
  protected readonly module = 'work-order';

  constructor(
    private readonly board: JobBoardRepository,
    private readonly catalogue: WorkOrderCatalogService
  ) {
    super();
  }

  /**
   * The company/branch a job belongs to, or null when it is not visible.
   *
   * Exposed so a route can ask the `tech.technician.read` question against the
   * JOB's own scope (`T-05`) before deciding whether the detail response may
   * carry staff data. Returning null rather than throwing keeps the "is it
   * absent or merely out of scope" decision in one place — `jobDetail` — so the
   * two cannot answer differently.
   */
  async scopeOf(
    db: DbHandle,
    jobId: string
  ): Promise<{ readonly companyId: string; readonly branchId: string } | null> {
    return this.board.jobScope(db, jobId);
  }

  /** The branch job board. The scope pair is authorized by the route (`T-02`). */
  async listJobs(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly state?: string | undefined;
      readonly workOrderId?: string | undefined;
      readonly technicianProfileId?: string | undefined;
    },
    page: PageInput
  ): Promise<Page<JobBoardRow>> {
    return this.board.pageJobs(db, filter, pageRequest(JOB_BOARD_ORDER, page));
  }

  /**
   * One job, its board context, its reachable edges, and — only for a caller
   * holding `tech.technician.read` — its open assignments.
   *
   * The scope is resolved from the JOB ROW and re-authorized before anything is
   * returned, so a caller outside the branch gets a 404 that does not disclose
   * whether the job exists (`P1-18-A-01`: the route's `scope: 'branch'` has no
   * target to evaluate when the request names only an id).
   */
  async jobDetail(
    db: DbHandle,
    jobId: string,
    options: {
      readonly authorizeScope?: ScopeAuthorizer;
      readonly mayReadStaff: boolean;
    }
  ): Promise<JobDetail> {
    const scope = await this.board.jobScope(db, jobId);
    if (scope === null) {
      throw new AppFailure('ERR-RES-001', { message: 'Job was not found' });
    }
    if (options.authorizeScope !== undefined) {
      await options.authorizeScope({ companyId: scope.companyId, branchId: scope.branchId });
    }
    const job = await this.board.findJobWithContext(db, jobId);
    if (job === null) {
      throw new AppFailure('ERR-RES-001', { message: 'Job was not found' });
    }

    // From the catalogue, not a constant — the same way wo.work-order-detail
    // computes the work order's edges. A tenant graph must answer for itself.
    const edges = await this.catalogue.jobTransitions(db);
    const states = await this.catalogue.jobStates(db);
    const nextStates: readonly ReachableState[] = edges
      .filter((edge) => edge.fromState === job.state)
      .map((edge) => {
        const target = states.find((state) => state.code === edge.toState);
        return {
          code: edge.toState,
          requiresReason: edge.requiresReason,
          isTerminal: target?.isTerminal ?? false,
          isCancellation: false,
        };
      });

    if (!options.mayReadStaff) {
      // OMITTED, not empty. An empty array would assert "no assignments", which
      // is a claim about the data rather than about this caller's authority.
      return { job, nextStates };
    }
    return { job, nextStates, assignments: await this.openAssignments(db, jobId) };
  }

  private async openAssignments(
    db: DbHandle,
    jobId: string
  ): Promise<readonly JobAssignmentView[]> {
    return this.board.openAssignmentsFor(db, jobId);
  }

  /** The branch QC queue. `overallResult` is a closed enum, unlike job state. */
  async listQcRecords(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly overallResult?: QcOverallResult | undefined;
    },
    page: PageInput
  ): Promise<Page<QcRecordRow>> {
    return this.board.pageQcRecords(db, filter, pageRequest(QC_BRANCH_ORDER, page));
  }

  /**
   * Appends a work-log entry.
   *
   * **No state compatibility check, deliberately.** A work log may be recorded in
   * any job state including a terminal one: a technician writing up finished work
   * is the normal case, and refusing it would make the log unusable exactly when
   * it matters most.
   *
   * `loggedAt` is bounded on both sides — not in the future, not before the job
   * existed — because it is a CLAIM about when, and a claim about a time the job
   * did not exist is not a claim this platform should store.
   */
  async recordWorkLog(
    db: DbHandle,
    jobId: string,
    input: { readonly entry: string; readonly loggedAt?: string | undefined },
    authorizeScope?: ScopeAuthorizer
  ): Promise<WorkLogEntryRow> {
    const scope = await this.board.jobScope(db, jobId);
    if (scope === null) {
      throw new AppFailure('ERR-RES-001', { message: 'Job was not found' });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: scope.companyId, branchId: scope.branchId });
    }

    const loggedAt = this.resolveLoggedAt(input.loggedAt);
    if (loggedAt !== null) {
      const jobCreatedAt = await this.board.jobCreatedAt(db, jobId);
      if (jobCreatedAt !== null && loggedAt.getTime() < jobCreatedAt.getTime()) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'loggedAt may not precede the job it describes',
          safeDetails: { violations: [{ path: 'body.loggedAt', rule: 'before_job_created' }] },
        });
      }
    }

    let recorded: WorkLogEntryRow;
    try {
      recorded = await this.board.insertWorkLog(db, {
        jobId,
        companyId: scope.companyId,
        branchId: scope.branchId,
        entry: input.entry,
        loggedAt,
      });
    } catch (error) {
      throw this.mapWorkLogFailure(error);
    }

    await appendAudit(db, {
      action: 'wo.job.work_log_recorded',
      entityType: 'wo.job',
      entityId: jobId,
      companyId: scope.companyId,
      branchId: scope.branchId,
      details: [
        { field: 'work_log_id', classification: 'internal', value: recorded.id },
        { field: 'logged_at', classification: 'public', value: recorded.loggedAt },
        // The entry is the technician's own words about the vehicle in front of
        // them, so it is recorded INTERNAL rather than public.
        { field: 'entry_length', classification: 'internal', value: String(input.entry.length) },
      ],
    });

    return recorded;
  }

  /** One job's work log. Scope-checked exactly as the write is. */
  async listWorkLogs(
    db: DbHandle,
    jobId: string,
    page: PageInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<Page<WorkLogEntryRow>> {
    const scope = await this.board.jobScope(db, jobId);
    if (scope === null) {
      throw new AppFailure('ERR-RES-001', { message: 'Job was not found' });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: scope.companyId, branchId: scope.branchId });
    }
    return this.board.pageWorkLogs(db, jobId, pageRequest(WORK_LOG_ORDER, page));
  }

  /** An ISO instant that is not in the future, or a named 422. */
  private resolveLoggedAt(value: string | undefined): Date | null {
    if (value === undefined) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'loggedAt must be an ISO-8601 instant',
        safeDetails: { violations: [{ path: 'body.loggedAt', rule: 'invalid_format' }] },
      });
    }
    if (parsed.getTime() > Date.now()) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'loggedAt may not be in the future',
        safeDetails: { violations: [{ path: 'body.loggedAt', rule: 'future_instant' }] },
      });
    }
    return parsed;
  }

  private mapWorkLogFailure(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
      return new AppFailure('ERR-IAM-001', {
        message: 'This job is outside the scope your access grants',
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      // The composite FK's "not this branch's job" branch, which must read as a
      // missing resource rather than as a hint that the job exists elsewhere.
      return new AppFailure('ERR-RES-001', { message: 'Job was not found' });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      return new AppFailure('ERR-VAL-001', {
        message: 'A work-log entry may not be blank',
        safeDetails: { violations: [{ path: 'body.entry', rule: 'blank' }] },
      });
    }
    return error;
  }
}
