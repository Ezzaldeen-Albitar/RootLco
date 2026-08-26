/**
 * Job assignment, unassignment and reassignment (Phase 1-19, P1-19-BE-013…015).
 *
 * ## Why this lives in `work-order` and eligibility lives in `technician`
 *
 * `wo.job_assignments` is a `wo` row, so the write belongs here. Whether a given
 * technician MAY take it is decided entirely from `tech` rows — held skills and
 * levels, certification validity, availability intervals, profile status — so that
 * decision belongs to the `technician` module and is reached through its public
 * surface. Splitting them this way is what keeps this module from reading `tech.`
 * tables directly, which ADR-001 rule 3 prohibits.
 *
 * ## Assignment is temporal, not a column
 *
 * There is no `job.technician_id`. An assignment is a row with `valid_from` and a
 * nullable `valid_to`; ending one stamps `valid_to` and a MANDATORY reason
 * (`ck_job_assignments_end_reason`), and the row survives. The set of rows for a job
 * IS its assignment history, and no code path deletes one — which is what makes
 * "who was on this job in March" answerable at all.
 *
 * `uq_job_assignments_active_primary` — a PARTIAL unique index — is the invariant
 * that at most one PRIMARY assignment is live per job. `assist` is deliberately
 * unconstrained: a job may carry several helpers.
 *
 * ## The requirement is supplied, not stored, and that is a schema fact
 *
 * The protected schema has NO per-job required-skill or required-certification
 * storage — no `wo.job_required_skills`, nothing on `wo.jobs`. So the requirement
 * can only come from the assigner at assignment time, is evaluated against it, and
 * cannot be re-checked later. Inventing a table to hold it would be this phase
 * changing a frozen schema; recording the gap is the honest alternative.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { technicianModule } from '@/modules/technician';
import type {
  AssignmentRow,
  TechnicianQueueRow,
  WorkOrderRepository,
} from '../data/work-order-repository';
import type { WorkOrderCatalogService } from './work-order-catalog-service';
import { ASSIGNMENT_ROLES, type AssignmentRole } from '../domain/work-order';

/** An assignment as projected to a caller. */
export interface AssignmentView {
  readonly id: string;
  readonly jobId: string;
  readonly technicianProfileId: string;
  readonly assignmentRole: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly reason: string | null;
  readonly recordVersion: number;
}

/** One row of a technician's live queue, as projected to a caller. */
export interface QueueEntry {
  readonly assignmentId: string;
  readonly jobId: string;
  readonly workOrderId: string;
  readonly assignmentRole: string;
  readonly validFrom: string;
  readonly jobTitle: string;
  readonly jobState: string;
  readonly workOrderState: string;
  readonly displayNumber: string | null;
}

/**
 * What the assigner states about the work.
 *
 * `window` is REQUIRED rather than defaulted, and that is deliberate: availability
 * is a real eligibility criterion, and there is no honest default window. Defaulting
 * to an instant would make `coveredByUnion` answer false for every technician (it
 * refuses a zero-length window by contract), and defaulting to an arbitrary duration
 * would invent a schedule the assigner did not state.
 */
export interface AssignInput {
  readonly technicianProfileId: string;
  readonly assignmentRole?: AssignmentRole | undefined;
  readonly requiredSkills?: readonly { skillCode: string; minimumRank: number }[] | undefined;
  readonly requiredCertificationCodes?: readonly string[] | undefined;
  readonly window: { readonly from: Date; readonly to: Date };
}

const toView = (row: AssignmentRow): AssignmentView => ({
  id: row.id,
  jobId: row.jobId,
  technicianProfileId: row.technicianProfileId,
  assignmentRole: row.assignmentRole,
  validFrom: row.validFrom.toISOString(),
  validTo: row.validTo === null ? null : row.validTo.toISOString(),
  reason: row.reason,
  recordVersion: row.recordVersion,
});

const toQueueEntry = (row: TechnicianQueueRow): QueueEntry => ({
  assignmentId: row.assignmentId,
  jobId: row.jobId,
  workOrderId: row.workOrderId,
  assignmentRole: row.assignmentRole,
  validFrom: row.validFrom.toISOString(),
  jobTitle: row.jobTitle,
  jobState: row.jobState,
  workOrderState: row.workOrderState,
  displayNumber: row.displayNumber,
});

/**
 * The wire shape of `wo.job-reassignment` (PRE-P1-29-BR-08b).
 *
 * Named here rather than in the frontend mirror, and that is the whole point of
 * `BR-08b`: naming it on the far side would create a type with no counterpart in
 * `apps/api`, which is exactly the drift a mirror exists to prevent and which
 * nothing would catch.
 *
 * `ended` is nullable because a first assignment ends nothing — a handover
 * closes a predecessor, an initial assignment does not have one.
 */
export interface JobReassignmentResult {
  readonly ended: AssignmentView | null;
  readonly opened: AssignmentView;
}

/**
 * The wire shape of `tech.technician-queue` (PRE-P1-29-BR-08b).
 *
 * **The strongest case for naming these backend-side.** This envelope existed
 * only inside the route handler — the service returns a bare `QueueEntry[]` — so
 * even a type-checker pointed at the service layer would never have found it. A
 * frontend type would have been its only definition anywhere.
 *
 * It lives in the work-order module although the operation is registered under
 * `technician`, because `QueueEntry` does: declaring it beside the operation id
 * would have forced a `technician -> work-order` import that does not exist.
 */
export interface TechnicianQueueResult {
  readonly technicianProfileId: string;
  readonly items: readonly QueueEntry[];
}

export class JobAssignmentService extends ApplicationService {
  protected readonly module = 'work-order';

  constructor(
    private readonly repository: WorkOrderRepository,
    private readonly catalog: WorkOrderCatalogService
  ) {
    super();
  }

  /** Assigns a technician to a job, refusing with every ineligibility reason. */
  async assign(
    db: DbHandle,
    jobId: string,
    input: AssignInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<AssignmentView> {
    const job = await this.lockAssignableJob(db, jobId, authorizeScope);
    const role = input.assignmentRole ?? 'primary';

    // Eligibility BEFORE the write, and complete: the assigner learns every reason
    // at once rather than one per rejected attempt. The scope in the requirement is
    // the JOB's, so a technician profile in another branch is ineligible by
    // construction and never by a lookup the caller controls.
    await technicianModule().eligibility.assertOrThrow(
      db,
      input.technicianProfileId,
      {
        skills: input.requiredSkills ?? [],
        certificationCodes: input.requiredCertificationCodes ?? [],
        from: input.window.from,
        to: input.window.to,
        companyId: job.companyId,
        branchId: job.branchId,
      },
      new Date()
    );

    if (role === 'primary') {
      // Read before write for a readable refusal; the partial unique index is the
      // enforcement and the catch below is what a lost race lands on.
      const existing = await this.repository.lockActivePrimaryAssignment(db, jobId);
      if (existing !== null) {
        throw new AppFailure('ERR-RES-002', {
          message: `Job ${jobId} already has an active primary assignment`,
          safeDetails: {
            violations: [{ path: 'body.assignmentRole', rule: 'primary_already_assigned' }],
          },
        });
      }
    }

    let opened: AssignmentRow;
    try {
      opened = await this.repository.openAssignment(db, {
        jobId,
        companyId: job.companyId,
        branchId: job.branchId,
        technicianProfileId: input.technicianProfileId,
        assignmentRole: role,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        // Two assigners raced for the same job. The index decided; this is the
        // loser, and it is a conflict rather than a 500.
        throw new AppFailure('ERR-RES-002', {
          message: `Job ${jobId} already has an active primary assignment`,
          cause: error,
          safeDetails: {
            violations: [{ path: 'body.assignmentRole', rule: 'primary_already_assigned' }],
          },
        });
      }
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        // The composite FK to `tech.technician_profiles` carries the scope key, so a
        // profile outside the job's company and branch cannot be referenced at all.
        // Eligibility already refuses that case; this is the database backstop.
        throw new AppFailure('ERR-RES-001', {
          message: `Technician ${input.technicianProfileId} is not visible in this scope`,
          cause: error,
        });
      }
      throw error;
    }

    await this.auditAssigned(db, job, opened);
    await this.publishAssigned(db, job, opened);
    return toView(opened);
  }

  /**
   * Ends an assignment.
   *
   * The reason is mandatory in the schema as well as here, and `valid_to` is
   * server-stamped: a caller-chosen end time could be pushed before `valid_from`
   * (which `ck_job_assignments_window` would refuse) or used to rewrite when a
   * technician actually came off the work.
   */
  async end(
    db: DbHandle,
    assignmentId: string,
    input: { readonly reason: string; readonly expectedVersion: number },
    authorizeScope?: ScopeAuthorizer
  ): Promise<AssignmentView> {
    const locked = await this.repository.lockAssignment(db, assignmentId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', { message: `Assignment ${assignmentId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: locked.companyId, branchId: locked.branchId });
    }
    if (locked.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Assignment ${assignmentId} was modified by another request`,
      });
    }
    if (locked.validTo !== null) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Assignment ${assignmentId} is already ended`,
      });
    }

    const closed = await this.repository.closeAssignment(
      db,
      assignmentId,
      input.reason,
      input.expectedVersion
    );
    if (closed === null) {
      throw new AppFailure('ERR-CON-001', {
        message: `Assignment ${assignmentId} was modified by another request`,
      });
    }
    await this.auditEnded(db, locked, input.reason);
    // The row the UPDATE returned, with no fallback. `valid_to` is `now()` and
    // `record_version` has just been bumped by the touch trigger; both are values only
    // the database knows, and an earlier revision reconstructed them from the pre-close
    // row plus the Node clock when the read-back happened to miss.
    return toView(closed);
  }

  /**
   * Hands a job from its current primary to another technician, atomically.
   *
   * One transaction, two audit records and one event: a handover recorded in halves
   * would leave a window where the job appears unassigned, and the ended assignment
   * and the new one would be separately deniable.
   */
  async reassign(
    db: DbHandle,
    jobId: string,
    input: AssignInput & { readonly reason: string },
    authorizeScope?: ScopeAuthorizer
  ): Promise<JobReassignmentResult> {
    const job = await this.lockAssignableJob(db, jobId, authorizeScope);
    const current = await this.repository.lockActivePrimaryAssignment(db, jobId);

    let ended: AssignmentView | null = null;
    if (current !== null) {
      if (current.technicianProfileId === input.technicianProfileId) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'The named technician already holds this assignment',
          safeDetails: {
            violations: [{ path: 'body.technicianProfileId', rule: 'already_assigned' }],
          },
        });
      }
      const closed = await this.repository.closeAssignment(
        db,
        current.id,
        input.reason,
        current.recordVersion
      );
      if (closed === null) {
        throw new AppFailure('ERR-CON-001', {
          message: `Assignment ${current.id} was modified by another request`,
        });
      }
      await this.auditEnded(db, current, input.reason);
      // The database-stamped row, not `{ ...current, validTo: new Date() }`. The
      // reassignment response reported a `validTo` from the Node process clock and the
      // pre-close `recordVersion`, so a client that echoed either back was refused.
      ended = toView(closed);
    }

    await technicianModule().eligibility.assertOrThrow(
      db,
      input.technicianProfileId,
      {
        skills: input.requiredSkills ?? [],
        certificationCodes: input.requiredCertificationCodes ?? [],
        from: input.window.from,
        to: input.window.to,
        companyId: job.companyId,
        branchId: job.branchId,
      },
      new Date()
    );

    const opened = await this.repository.openAssignment(db, {
      jobId,
      companyId: job.companyId,
      branchId: job.branchId,
      technicianProfileId: input.technicianProfileId,
      assignmentRole: 'primary',
    });
    await this.auditAssigned(db, job, opened);
    await this.publishAssigned(db, job, opened);
    return { ended, opened: toView(opened) };
  }

  /** The full, append-only assignment history of one job. */
  async assignments(
    db: DbHandle,
    jobId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<readonly AssignmentView[]> {
    const job = await this.repository.findJob(db, jobId);
    if (job === null) {
      throw new AppFailure('ERR-RES-001', { message: `Job ${jobId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: job.companyId, branchId: job.branchId });
    }
    return (await this.repository.assignmentsFor(db, jobId)).map(toView);
  }

  /**
   * One technician's live queue.
   *
   * The technician profile is resolved through the `technician` module first, so an
   * id outside the caller's scope answers 404 before any `wo` row is read — the
   * queue must not become a way to enumerate assignments by guessing profile ids.
   */
  async queue(
    db: DbHandle,
    technicianProfileId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<readonly QueueEntry[]> {
    const profile = await technicianModule().eligibility.profile(db, technicianProfileId);
    if (profile === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Technician ${technicianProfileId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: profile.companyId, branchId: profile.branchId });
    }
    return (await this.repository.queueFor(db, technicianProfileId)).map(toQueueEntry);
  }

  /**
   * Locks the job and refuses one that may not receive an assignment.
   *
   * A terminal job and a terminal parent are both refused: assigning a technician to
   * finished work would put a live row on an aggregate the guards have frozen, and
   * `wo.guard_job_transition` would then never let that job move again.
   */
  private async lockAssignableJob(
    db: DbHandle,
    jobId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<{ readonly companyId: string; readonly branchId: string }> {
    const locked = await this.repository.lockJob(db, jobId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', { message: `Job ${jobId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: locked.companyId, branchId: locked.branchId });
    }
    const jobStates = await this.catalog.jobStates(db);
    const state = jobStates.find((candidate) => candidate.code === locked.state);
    if (state === undefined || state.isTerminal) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Job state "${locked.state}" does not accept an assignment`,
      });
    }
    const workOrder = await this.repository.findWorkOrder(db, locked.workOrderId);
    const workOrderStates = await this.catalog.workOrderStates(db);
    const parent = workOrderStates.find((candidate) => candidate.code === workOrder?.state);
    if (parent === undefined || parent.isTerminal) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Work order state "${workOrder?.state ?? 'unknown'}" does not accept assignments`,
      });
    }
    return { companyId: locked.companyId, branchId: locked.branchId };
  }

  private async auditAssigned(
    db: DbHandle,
    job: { readonly companyId: string; readonly branchId: string },
    opened: AssignmentRow
  ): Promise<void> {
    await appendAudit(db, {
      action: 'wo.job.assigned',
      entityType: 'wo.job_assignment',
      entityId: opened.id,
      companyId: job.companyId,
      branchId: job.branchId,
      details: [
        { field: 'job_id', classification: 'internal', value: opened.jobId },
        // The technician profile id identifies a member of staff, so it is
        // `internal` rather than `public` — the same treatment the vehicle and
        // customer identifiers get elsewhere.
        {
          field: 'technician_profile_id',
          classification: 'internal',
          value: opened.technicianProfileId,
        },
        { field: 'assignment_role', classification: 'public', value: opened.assignmentRole },
      ],
    });
  }

  private async auditEnded(db: DbHandle, row: AssignmentRow, reason: string): Promise<void> {
    await appendAudit(db, {
      action: 'wo.job.assignment_ended',
      entityType: 'wo.job_assignment',
      entityId: row.id,
      companyId: row.companyId,
      branchId: row.branchId,
      details: [
        { field: 'job_id', classification: 'internal', value: row.jobId },
        {
          field: 'technician_profile_id',
          classification: 'internal',
          value: row.technicianProfileId,
        },
        { field: 'reason', classification: 'internal', value: reason },
      ],
    });
  }

  private async publishAssigned(
    db: DbHandle,
    job: { readonly companyId: string; readonly branchId: string },
    opened: AssignmentRow
  ): Promise<void> {
    await publishEvent(db, {
      eventType: 'job.assigned',
      // The aggregate is the JOB, not the assignment row: the catalog declares
      // `aggregateType: 'wo.job'`, and a consumer reacting to "this job now has a
      // technician" keys on the job.
      aggregateId: opened.jobId,
      aggregateVersion: 1,
      producer: 'wo.job-assignment-service',
      companyId: job.companyId,
      branchId: job.branchId,
      payload: {
        jobId: opened.jobId,
        assignmentId: opened.id,
        assignmentRole: opened.assignmentRole,
      },
      // Keyed by the ASSIGNMENT id, not the job: a job is legitimately assigned
      // more than once over its life, and keying by the job would make the second
      // handover collide with the first.
      eventKey: `job.assigned:${opened.id}`,
    });
  }
}

/** Re-exported so a route can validate the role without importing the domain file. */
export { ASSIGNMENT_ROLES };
