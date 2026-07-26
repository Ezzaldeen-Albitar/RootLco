/**
 * Work-order transitions and closure eligibility (Phase 1-19, P1-19-BE-003…005).
 *
 * Creation is deliberately absent: reception's conversion (P1-18-BE-019) opens the
 * work-order shell and leaves `kind`, `state`, `parts_forward_state` and
 * `opened_at` to their frozen defaults precisely so this phase owns what happens
 * next. Re-implementing an insert here would give the platform two creation paths
 * and only one of them would be the one the reception visit lock and
 * `uq_work_orders_ordinary_origin` were designed around.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { pageRequest, type Page } from '@/server/db/pagination';
import { qualityModule } from '@/modules/quality';
import {
  JOB_HISTORY_ORDER,
  WORK_ORDER_HISTORY_ORDER,
  WORK_ORDER_LIST_ORDER,
  type BlockerHit,
  type JobRow,
  type StatusHistoryRow,
  type WorkOrderListFilter,
  type WorkOrderRepository,
  type WorkOrderRow,
} from '../data/work-order-repository';
import type { WorkOrderCatalogService } from './work-order-catalog-service';
import {
  CLOSURE_BLOCKER_REGISTRY,
  DEFERRED_CLOSURE_BLOCKERS,
  type ClosureBlockerCode,
} from '../domain/work-order';

export interface ClosureBlocker {
  readonly code: ClosureBlockerCode;
  readonly message: string;
  readonly enforcedBy: string;
}

export interface ClosureEligibility {
  readonly workOrderId: string;
  readonly state: string;
  readonly eligible: boolean;
  /** Every unmet blocker, in registry order — never only the first. */
  readonly blockers: readonly ClosureBlocker[];
  /**
   * True when the current state is already terminal, in which case the guard
   * short-circuits and B1–B6 are not evaluated at all.
   */
  readonly alreadyTerminal: boolean;
  /** Conditions the protected schema cannot yet express. Never silently "clear". */
  readonly deferred: {
    readonly owner: string;
    readonly conditions: readonly string[];
    readonly reason: string;
  };
}

/**
 * The work-order projection every read returns.
 *
 * `createdBy` is deliberately absent. It answers "which member of staff opened
 * this", which a board or a list has no need for, and the history view is where
 * it belongs — beside the actors of the transitions it can be compared against.
 */
export interface WorkOrderSummary {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly receptionVisitId: string;
  readonly vehicleId: string;
  readonly kind: string;
  readonly state: string;
  readonly partsForwardState: string;
  readonly displayNumber: string | null;
  readonly openedAt: string;
  readonly recordVersion: number;
}

/**
 * A job as projected to a caller.
 *
 * Company and branch are read on `JobRow` because the scope check needs them, and
 * dropped here because the parent work order already carries them — repeating a
 * scope on every child row invites a client to treat one of the copies as the
 * authority.
 */
export interface JobView {
  readonly id: string;
  readonly workOrderId: string;
  readonly title: string;
  readonly jobType: string | null;
  readonly state: string;
  readonly requiresDiagnostic: boolean;
  readonly recordVersion: number;
}

/**
 * The page a caller asked for, before the cursor is decoded.
 *
 * Routes hand over the raw query values and this module decodes them, so the
 * ordering contract a cursor is validated against stays with the query that issued
 * it — and a handler never imports the pagination primitives directly, which the
 * module-boundary rule forbids.
 */
export interface PageInput {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/** What a state-change command accepts. */
export interface TransitionInput {
  readonly toState: string;
  readonly reason?: string | undefined;
  readonly expectedVersion: number;
}

/** What a state-change command returns. */
export interface TransitionResult {
  readonly state: string;
  readonly recordVersion: number;
}

/** One edge the work order can currently take, resolved from the live catalog. */
export interface ReachableState {
  readonly code: string;
  readonly requiresReason: boolean;
  readonly isTerminal: boolean;
  readonly isCancellation: boolean;
}

/**
 * The aggregate one work order presents.
 *
 * Assembled in a fixed number of round trips regardless of how many jobs exist —
 * one work-order read, one job read, one catalog read — so the detail endpoint
 * cannot become an N+1. Assignments, approvals, diagnostics, QC and rework
 * references join this projection in Waves 5–8, as each becomes writable through
 * a real path; including an always-empty block for them now would publish a
 * contract nothing can populate.
 */
export interface WorkOrderDetail {
  readonly workOrder: WorkOrderSummary;
  readonly jobs: readonly JobView[];
  readonly nextStates: readonly ReachableState[];
}

/** One append-only ledger entry. */
export interface WorkOrderHistoryEntry {
  readonly id: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly reason: string | null;
  readonly occurredAt: string;
  readonly actorId: string | null;
}

/**
 * The status ledger plus the genesis facts the ledger cannot hold.
 *
 * `wo.emit_work_order_status_history` fires AFTER UPDATE only, so the insert that
 * opens a work order emits no row and the ledger's oldest entry is the FIRST
 * transition, not the opening. Rather than backfill a genesis row — which
 * `shared.stamp_status_history` would stamp with `now()`, recording a time the
 * order did not open at — the opening is reported as its own block, derived from
 * columns that do hold it.
 */
export interface WorkOrderHistoryView {
  readonly workOrderId: string;
  readonly origin: {
    readonly openedAt: string;
    readonly openedBy: string | null;
    /**
     * The state the order opened in: the oldest ledger entry's `fromState`, or the
     * current state when the ledger is empty (nothing has moved it yet).
     */
    readonly initialState: string;
  };
  readonly transitions: Page<WorkOrderHistoryEntry>;
}

/** A job's ledger plus the genesis fact the ledger cannot hold. */
export interface JobHistoryView {
  readonly jobId: string;
  readonly workOrderId: string;
  readonly origin: { readonly initialState: string };
  readonly transitions: Page<WorkOrderHistoryEntry>;
}

const toSummary = (row: WorkOrderRow): WorkOrderSummary => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  receptionVisitId: row.receptionVisitId,
  vehicleId: row.vehicleId,
  kind: row.kind,
  state: row.state,
  partsForwardState: row.partsForwardState,
  displayNumber: row.displayNumber,
  openedAt: row.openedAt.toISOString(),
  recordVersion: row.recordVersion,
});

const toJobView = (row: JobRow): JobView => ({
  id: row.id,
  workOrderId: row.workOrderId,
  title: row.title,
  jobType: row.jobType,
  state: row.state,
  requiresDiagnostic: row.requiresDiagnostic,
  recordVersion: row.recordVersion,
});

const toHistoryEntry = (row: StatusHistoryRow): WorkOrderHistoryEntry => ({
  id: row.id,
  fromState: row.fromState,
  toState: row.toState,
  reason: row.reason,
  occurredAt: row.occurredAt.toISOString(),
  actorId: row.actorId,
});

export class WorkOrderService extends ApplicationService {
  protected readonly module = 'work-order';

  constructor(
    private readonly repository: WorkOrderRepository,
    private readonly catalog: WorkOrderCatalogService
  ) {
    super();
  }

  /**
   * The work order, or a uniform 404 that does not distinguish absent from
   * out-of-scope.
   *
   * Named `requireWorkOrder` rather than the bare verb: the module-boundary
   * checker reads a call to the CommonJS loader as an import specifier, so a
   * method with that name produced four false B9 violations. Even naming it in a
   * comment trips the same rule, which is why this sentence talks around it.
   */
  async requireWorkOrder(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<WorkOrderRow> {
    const row = await this.repository.findWorkOrder(db, workOrderId);
    if (row === null) {
      throw new AppFailure('ERR-RES-001', { message: `Work order ${workOrderId} is not visible` });
    }
    // Deferred scoped authorization against the ROW's own company and branch.
    // P1-18-A-01: `scope: 'branch'` is inert without a target, because
    // `requiresScopedEvaluation` returns false on an empty one regardless of the
    // declared scope — the check would fall through to scope-blind
    // `iam.has_permission`, and RLS cannot contain that because `app.branch_ids`
    // is the permission-blind union of every active grant.
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: row.companyId, branchId: row.branchId });
    }
    return row;
  }

  /** Live jobs on a work order. */
  async jobs(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<readonly JobView[]> {
    await this.requireWorkOrder(db, workOrderId, authorizeScope);
    return (await this.repository.jobsFor(db, workOrderId)).map(toJobView);
  }

  /**
   * One keyset page of the branch work-order board.
   *
   * Company and branch are REQUIRED, and that is an authorization decision rather
   * than an ergonomic one: the route passes the same pair as the operation's
   * `authorizationTarget`, so the permission is evaluated by
   * `iam.has_permission_in_scope` against the branch actually read. Without them
   * the check would degrade to scope-blind `iam.has_permission` behind an
   * `app.branch_ids` that unions every grant the caller holds (P1-18-A-01), and
   * the board would show a branch the caller has no work-order permission in.
   */
  async list(
    db: DbHandle,
    filter: WorkOrderListFilter,
    page: PageInput
  ): Promise<Page<WorkOrderSummary>> {
    // The ordering contract and the cursor decode live behind this surface, not in
    // the route: a handler that imported `@/server/db/pagination` would be reaching
    // into the data layer past its module (boundary rule B4).
    const rows = await this.repository.listWorkOrders(
      db,
      filter,
      pageRequest(WORK_ORDER_LIST_ORDER, page)
    );
    return { ...rows, items: rows.items.map(toSummary) };
  }

  /** The work order, its live jobs, and the edges it can currently take. */
  async detail(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<WorkOrderDetail> {
    const workOrder = await this.requireWorkOrder(db, workOrderId, authorizeScope);
    const [jobs, states, edges] = await Promise.all([
      this.repository.jobsFor(db, workOrderId),
      this.catalog.workOrderStates(db),
      this.catalog.workOrderTransitions(db),
    ]);
    const byCode = new Map(states.map((state) => [state.code, state]));
    const current = byCode.get(workOrder.state);
    // A terminal state has no outbound edge whatever the graph says — the guard
    // freezes it (BR-WO-002) — so reporting one would advertise a move that is
    // guaranteed to fail.
    const nextStates: ReachableState[] =
      current?.isTerminal === true
        ? []
        : edges
            .filter((edge) => edge.fromState === workOrder.state)
            .flatMap((edge) => {
              const target = byCode.get(edge.toState);
              if (target === undefined) return [];
              return [
                {
                  code: target.code,
                  // Either source of the requirement makes a reason mandatory,
                  // exactly as `wo.guard_work_order_transition` computes it.
                  requiresReason: edge.requiresReason || target.reasonRequired,
                  isTerminal: target.isTerminal,
                  isCancellation: target.isCancellation,
                },
              ];
            });
    return { workOrder: toSummary(workOrder), jobs: jobs.map(toJobView), nextStates };
  }

  /** Append-only transition history, paginated, with the genesis block. */
  async history(
    db: DbHandle,
    workOrderId: string,
    page: PageInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<WorkOrderHistoryView> {
    const workOrder = await this.requireWorkOrder(db, workOrderId, authorizeScope);
    const [transitions, initial] = await Promise.all([
      this.repository.historyPage(db, workOrderId, pageRequest(WORK_ORDER_HISTORY_ORDER, page)),
      this.repository.initialState(db, workOrderId),
    ]);
    return {
      workOrderId,
      origin: {
        openedAt: workOrder.openedAt.toISOString(),
        openedBy: workOrder.createdBy,
        initialState: initial ?? workOrder.state,
      },
      transitions: { ...transitions, items: transitions.items.map(toHistoryEntry) },
    };
  }

  /**
   * Adds a job to a work order.
   *
   * The initial state is resolved from the job-state catalog rather than
   * hardcoded: `wo.jobs.state` has only a format CHECK, so the vocabulary lives
   * entirely in `wo.job_states` and a tenant may shadow it. A caller-supplied
   * state is validated against that catalog; when none is given, the lowest
   * non-terminal state with no assignment requirement is used, which is the only
   * state a job can legitimately start in.
   *
   * `wo.guard_job_refs` still owns the parent preconditions — it locks the work
   * order and refuses a terminal parent or a state whose `allows_jobs` is false.
   * The check below is the readable refusal, not the enforcement.
   */
  async createJob(
    db: DbHandle,
    workOrderId: string,
    input: {
      readonly title: string;
      readonly jobType?: string | undefined;
      readonly state?: string | undefined;
      readonly requiresDiagnostic?: boolean | undefined;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<JobView> {
    const workOrder = await this.requireWorkOrder(db, workOrderId, authorizeScope);
    const workOrderStates = await this.catalog.workOrderStates(db);
    const parent = workOrderStates.find((state) => state.code === workOrder.state);
    if (parent === undefined || parent.isTerminal || !parent.allowsJobs) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Work order state "${workOrder.state}" does not accept jobs`,
      });
    }

    const jobStates = await this.catalog.jobStates(db);
    const initial =
      input.state === undefined
        ? jobStates.find((state) => !state.isTerminal && !state.assignmentRequired)
        : jobStates.find((state) => state.code === input.state);
    if (initial === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message:
          input.state === undefined
            ? 'No job state is configured that a job may start in'
            : `Job state "${input.state}" is not an active state`,
        safeDetails: { violations: [{ path: 'body.state', rule: 'unknown_state' }] },
      });
    }
    if (initial.isTerminal) {
      throw new AppFailure('ERR-VAL-001', {
        message: `A job may not be created in terminal state "${initial.code}"`,
        safeDetails: { violations: [{ path: 'body.state', rule: 'terminal_state' }] },
      });
    }

    // The check above reads the parent WITHOUT a lock, so it is a readable refusal
    // and not the enforcement point. `wo.guard_job_refs` locks the parent
    // `FOR UPDATE` inside the INSERT, which is what makes a job insert serialise
    // against a concurrent close — and it means the parent can legitimately have
    // become terminal, or stopped allowing jobs, between that read and this write.
    // Its refusal arrives as a bare `check_violation`; mapping it here is the
    // difference between a 409 the caller can act on and a 500.
    let job: JobRow;
    try {
      job = await this.repository.createJob(db, {
        workOrderId,
        companyId: workOrder.companyId,
        branchId: workOrder.branchId,
        title: input.title,
        jobType: input.jobType ?? null,
        state: initial.code,
        requiresDiagnostic: input.requiresDiagnostic ?? false,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-TRN-001', {
          message: `Work order ${workOrderId} no longer accepts jobs`,
          cause: error,
        });
      }
      throw error;
    }

    // Audited, not published: the approved catalog reserves `job.assigned` and
    // `job.state-changed` and nothing for job creation, and inventing an
    // unregistered event type would fail `buildEventEnvelope` anyway.
    await appendAudit(db, {
      action: 'wo.job.created',
      entityType: 'wo.job',
      entityId: job.id,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      details: [
        { field: 'work_order_id', classification: 'internal', value: workOrderId },
        { field: 'title', classification: 'internal', value: job.title },
        { field: 'state', classification: 'public', value: job.state },
        {
          field: 'requires_diagnostic',
          classification: 'public',
          value: String(job.requiresDiagnostic),
        },
      ],
    });
    return toJobView(job);
  }

  /**
   * Updates a job's descriptive fields under optimistic concurrency.
   *
   * `state` is not accepted. A job moves through `wo.job_transitions` and nowhere
   * else; accepting it here would give the platform a second path that skips the
   * graph. Wave 5 adds the transition command.
   */
  async updateJob(
    db: DbHandle,
    jobId: string,
    input: {
      readonly title: string;
      readonly jobType?: string | undefined;
      readonly requiresDiagnostic?: boolean | undefined;
      readonly expectedVersion: number;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<JobView> {
    const locked = await this.repository.lockJob(db, jobId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', { message: `Job ${jobId} is not visible` });
    }
    // `PATCH /jobs/{jobId}` is addressed by job id alone, so the pre-handler check
    // had no company or branch to evaluate and `scope: 'branch'` was inert
    // (P1-18-A-01). Scoped against the LOCKED row's own scope, which
    // `fk_jobs_work_order` guarantees equals the parent work order's.
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: locked.companyId, branchId: locked.branchId });
    }
    if (locked.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Job ${jobId} was modified by another request`,
      });
    }
    const applied = await this.repository.updateJob(db, jobId, {
      title: input.title,
      jobType: input.jobType ?? null,
      requiresDiagnostic: input.requiresDiagnostic ?? locked.requiresDiagnostic,
      expectedVersion: input.expectedVersion,
    });
    if (!applied) {
      throw new AppFailure('ERR-CON-001', {
        message: `Job ${jobId} was modified by another request`,
      });
    }
    const updated: JobRow = {
      ...locked,
      title: input.title,
      jobType: input.jobType ?? null,
      requiresDiagnostic: input.requiresDiagnostic ?? locked.requiresDiagnostic,
      recordVersion: input.expectedVersion + 1,
    };

    // Only the columns that actually moved. An audit entry claiming a field
    // changed when it did not is as misleading as a missing one, and the
    // `previousValue`/`value` pair is what an auditor reads to reconstruct the row.
    const details = [
      ...(updated.title === locked.title
        ? []
        : [
            {
              field: 'title',
              classification: 'internal' as const,
              previousValue: locked.title,
              value: updated.title,
            },
          ]),
      ...(updated.jobType === locked.jobType
        ? []
        : [
            {
              field: 'job_type',
              classification: 'internal' as const,
              previousValue: locked.jobType,
              value: updated.jobType,
            },
          ]),
      ...(updated.requiresDiagnostic === locked.requiresDiagnostic
        ? []
        : [
            {
              field: 'requires_diagnostic',
              classification: 'public' as const,
              previousValue: String(locked.requiresDiagnostic),
              value: String(updated.requiresDiagnostic),
            },
          ]),
    ];
    await appendAudit(db, {
      action: 'wo.job.updated',
      entityType: 'wo.job',
      entityId: jobId,
      companyId: locked.companyId,
      branchId: locked.branchId,
      details,
    });
    return toJobView(updated);
  }

  /**
   * Moves a job along the graph in `wo.job_transitions`.
   *
   * The graph is read, never mirrored, for the same reason the work-order graph is:
   * `ck_jobs_state_format` checks only the FORMAT, so the vocabulary is entirely
   * `wo.job_states` and a tenant may shadow it.
   *
   * `wo.guard_job_transition` is the authority and enforces three things this
   * service reports readably: the terminal freeze, edge validity with the reason
   * requirement taken from BOTH the edge and the target state, and — added when
   * `wo.job_assignments` was introduced — that a target whose
   * `assignment_required` is true needs an ACTIVE assignment on the job. That last
   * one is why a bare `check_violation` from the write is mapped rather than left
   * to surface as a 500: it is reachable with a perfectly valid edge and reason.
   */
  async transitionJob(
    db: DbHandle,
    jobId: string,
    input: TransitionInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<TransitionResult> {
    const locked = await this.repository.lockJob(db, jobId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', { message: `Job ${jobId} is not visible` });
    }
    // Scoped against the LOCKED row: `/jobs/{jobId}` names no branch, so the
    // pre-handler check had nothing to narrow by (P1-18-A-01).
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: locked.companyId, branchId: locked.branchId });
    }
    if (locked.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Job ${jobId} was modified by another request`,
      });
    }

    await this.catalog.resolveJobTransition(db, locked.state, input.toState, input.reason);

    let applied: boolean;
    try {
      applied = await this.repository.applyJobState(
        db,
        jobId,
        input.toState,
        input.reason ?? null,
        input.expectedVersion
      );
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // Reachable with a valid edge and a valid reason: the assignment
        // precondition, or a parent that moved under us. `ERR-TECH-001` is the
        // registered code for "not eligible for this assignment", which is exactly
        // what an unassigned job entering `assigned` is.
        throw new AppFailure('ERR-TECH-001', {
          message: `Job ${jobId} may not enter "${input.toState}" yet`,
          cause: error,
          safeDetails: {
            violations: [{ path: 'body.toState', rule: 'assignment_precondition' }],
          },
        });
      }
      throw error;
    }
    if (!applied) {
      throw new AppFailure('ERR-CON-001', {
        message: `Job ${jobId} was modified by another request`,
      });
    }
    const recordVersion = input.expectedVersion + 1;

    await appendAudit(db, {
      action: 'wo.job.state_changed',
      entityType: 'wo.job',
      entityId: jobId,
      companyId: locked.companyId,
      branchId: locked.branchId,
      details: [
        {
          field: 'state',
          classification: 'public',
          previousValue: locked.state,
          value: input.toState,
        },
        ...(input.reason === undefined
          ? []
          : [{ field: 'reason', classification: 'internal' as const, value: input.reason }]),
      ],
    });

    await publishEvent(db, {
      eventType: 'job.state-changed',
      aggregateId: jobId,
      aggregateVersion: recordVersion,
      // Owner `wo`, not `tech`: the job row is a `wo` row written by this module,
      // and `buildEventEnvelope` refuses a producer whose leading segment differs
      // from the catalog owner.
      producer: 'wo.work-order-service',
      companyId: locked.companyId,
      branchId: locked.branchId,
      payload: {
        jobId,
        workOrderId: locked.workOrderId,
        fromState: locked.state,
        toState: input.toState,
      },
      eventKey: `job.state-changed:${jobId}:${recordVersion}`,
    });

    return { state: input.toState, recordVersion };
  }

  /** A job's append-only status ledger, paginated, with its genesis block. */
  async jobHistory(
    db: DbHandle,
    jobId: string,
    page: PageInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<JobHistoryView> {
    const job = await this.repository.findJob(db, jobId);
    if (job === null) {
      throw new AppFailure('ERR-RES-001', { message: `Job ${jobId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: job.companyId, branchId: job.branchId });
    }
    const [transitions, initial] = await Promise.all([
      this.repository.jobHistoryPage(db, jobId, pageRequest(JOB_HISTORY_ORDER, page)),
      this.repository.jobInitialState(db, jobId),
    ]);
    return {
      jobId,
      workOrderId: job.workOrderId,
      // Same shape and same reason as the work-order history: the emitter is AFTER
      // UPDATE only, so a job's creation writes no ledger row.
      origin: { initialState: initial ?? job.state },
      transitions: { ...transitions, items: transitions.items.map(toHistoryEntry) },
    };
  }

  /**
   * Evaluates every closure condition and reports all of them.
   *
   * This is a REPORTER. `wo.guard_work_order_closure` remains the enforcement
   * point and runs inside the same statement as the state change; nothing here
   * may be used to conclude that closure will succeed. What it buys is that a
   * caller learns all six facts in one request instead of discovering one per
   * rejected attempt, because the guard raises on the first and aborts.
   *
   * Two gating facts are reproduced faithfully rather than assumed away:
   *
   *  - the guard evaluates B1–B6 only when the TARGET state is terminal, so an
   *    order that is already terminal has nothing left to block;
   *  - a cancellation target bypasses B1–B6 entirely. That is why `blockersFor`
   *    below is never consulted for a cancellation transition.
   */
  async closureEligibility(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<ClosureEligibility> {
    const workOrder = await this.requireWorkOrder(db, workOrderId, authorizeScope);
    const states = await this.catalog.workOrderStates(db);
    const current = states.find((state) => state.code === workOrder.state);
    const alreadyTerminal = current?.isTerminal ?? false;

    const blockers = alreadyTerminal ? [] : await this.blockersFor(db, workOrderId);
    return {
      workOrderId,
      state: workOrder.state,
      eligible: blockers.length === 0,
      blockers,
      alreadyTerminal,
      deferred: {
        owner: DEFERRED_CLOSURE_BLOCKERS.owner,
        conditions: DEFERRED_CLOSURE_BLOCKERS.conditions,
        reason: DEFERRED_CLOSURE_BLOCKERS.reason,
      },
    };
  }

  /**
   * The unmet blockers, assembled from two sources.
   *
   * B1–B4 come from this module's own repository; B5 and B6 come from `quality`
   * through its public surface, because they read `qms` tables `work-order` may
   * not touch. The two halves of B5 collapse into one code here because the guard
   * gives them one label — the split is preserved in `QualityGateStatus` for the
   * caller who needs to know which half bit.
   */
  private async blockersFor(db: DbHandle, workOrderId: string): Promise<readonly ClosureBlocker[]> {
    const structural: readonly BlockerHit[] = await this.repository.structuralBlockers(
      db,
      workOrderId
    );
    const quality = await qualityModule().gate.evaluate(db, workOrderId);

    const codes = new Set<ClosureBlockerCode>(structural.map((hit) => hit.code));
    if (quality.failedWithoutPass || quality.mandatoryPassMissing) codes.add('B5');
    if (quality.unsignedSafetyCriticalRework) codes.add('B6');

    // Registry order, not discovery order: a caller comparing two responses should
    // not see the same set of blockers in a different sequence.
    return CLOSURE_BLOCKER_REGISTRY.filter((blocker) => codes.has(blocker.code)).map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      enforcedBy: blocker.enforcedBy,
    }));
  }

  /**
   * Moves a work order along the configured graph.
   *
   * Order of operations matters and is deliberate:
   *
   *  1. lock the row, so a concurrent transition serialises behind us;
   *  2. resolve the edge from the CATALOG, which also validates the reason
   *     requirement against both the edge and the target state;
   *  3. if the target is terminal and not a cancellation, report closure blockers
   *     BEFORE attempting the write — so the caller gets all of them, rather than
   *     the guard's first one as an opaque `23514`;
   *  4. write under the caller's `record_version`.
   *
   * Step 3 does not replace the guard. The guard still runs on the UPDATE, inside
   * the same statement, and is what actually refuses closure — including in the
   * window between this read and that write.
   */
  async transition(
    db: DbHandle,
    workOrderId: string,
    input: TransitionInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<TransitionResult> {
    return this.move(db, workOrderId, input, 'transition', authorizeScope);
  }

  /**
   * Closes a work order — the same move, behind a second permission.
   *
   * Closure is a separate command because it is a separate authority. A service
   * advisor who may park an order `awaiting_parts` must not thereby be able to end
   * the workshop's liability for the vehicle, and permissions are a conjunction:
   * declaring both `wo.work_order.transition` and `wo.work_order.close` on ONE
   * operation would demand the closing authority for every ordinary move, while
   * declaring only the first would leave the seeded `wo.work_order.close` code
   * enforced nowhere.
   *
   * It is NOT an alternate write path. Both commands funnel into `move()`, so the
   * closure-eligibility service, the B1–B6 pre-report, the record-version
   * predicate and `wo.guard_work_order_closure` itself apply identically — the
   * only difference is which permission was required to get here and which audit
   * action and event the move emits.
   */
  async close(
    db: DbHandle,
    workOrderId: string,
    input: TransitionInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<TransitionResult> {
    return this.move(db, workOrderId, input, 'closure', authorizeScope);
  }

  /**
   * The one write path for a work-order state change.
   *
   * `via` is the command the caller came through, and it is checked against what
   * the target state actually IS rather than trusted: a terminal
   * non-cancellation target is reachable only through `close`, and everything else
   * only through `transition`. Without that check the closure permission would be
   * bypassable by asking the transition endpoint for `closed`, which is precisely
   * the "alternate closure path" the split exists to prevent. Cancellation stays
   * on `transition` even though it is terminal, because `wo.guard_work_order_closure`
   * exempts a cancellation target from B1–B6 — cancelling is abandoning the work,
   * not certifying it complete.
   */
  private async move(
    db: DbHandle,
    workOrderId: string,
    input: TransitionInput,
    via: 'transition' | 'closure',
    authorizeScope?: ScopeAuthorizer
  ): Promise<TransitionResult> {
    const locked = await this.repository.lockWorkOrder(db, workOrderId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', { message: `Work order ${workOrderId} is not visible` });
    }
    // Scoped against the LOCKED row, after the lock and before any decision, so
    // the branch authorized is the branch actually written.
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: locked.companyId, branchId: locked.branchId });
    }
    if (locked.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Work order ${workOrderId} was modified by another request`,
      });
    }

    await this.catalog.resolveWorkOrderTransition(db, locked.state, input.toState, input.reason);

    const states = await this.catalog.workOrderStates(db);
    const target = states.find((state) => state.code === input.toState);
    // "Closing" means terminal AND not a cancellation, which is exactly the gate
    // `wo.guard_work_order_closure` applies to B1–B6. It also selects the audit
    // action and the event, so the three cannot disagree about what happened.
    const closing = target?.isTerminal === true && target.isCancellation === false;
    if (closing && via !== 'closure') {
      throw new AppFailure('ERR-VAL-001', {
        message: `"${input.toState}" is a closing state; use the closure command`,
        safeDetails: {
          violations: [{ path: 'body.toState', rule: 'closure_requires_closure_operation' }],
        },
      });
    }
    if (!closing && via === 'closure') {
      throw new AppFailure('ERR-VAL-001', {
        message: `"${input.toState}" is not a closing state; use the transition command`,
        safeDetails: {
          violations: [{ path: 'body.toState', rule: 'not_a_closing_state' }],
        },
      });
    }
    if (closing) {
      const blockers = await this.blockersFor(db, workOrderId);
      if (blockers.length > 0) {
        throw new AppFailure('ERR-WO-001', {
          message: `Closure blocked: ${blockers.map((blocker) => blocker.code).join(', ')}`,
          safeDetails: {
            violations: blockers.map((blocker) => ({
              path: `closure.${blocker.code}`,
              rule: 'closure_blocked',
            })),
          },
        });
      }
    }

    const applied = await this.repository.applyState(
      db,
      workOrderId,
      input.toState,
      input.reason ?? null,
      input.expectedVersion
    );
    if (!applied) {
      throw new AppFailure('ERR-CON-001', {
        message: `Work order ${workOrderId} was modified by another request`,
      });
    }
    const recordVersion = input.expectedVersion + 1;

    // Audit and event are written INSIDE the caller's transaction, beside the
    // state change and the trigger-emitted ledger row. Exactly one of each per
    // transition: closure gets its own action and its own event rather than a
    // second row alongside the generic ones, so a consumer counting state changes
    // and a consumer waiting for closure both read an unambiguous stream.
    await appendAudit(db, {
      action: closing ? 'wo.work_order.closed' : 'wo.work_order.state_changed',
      entityType: 'wo.work_order',
      entityId: workOrderId,
      companyId: locked.companyId,
      branchId: locked.branchId,
      details: [
        {
          field: 'state',
          classification: 'public',
          previousValue: locked.state,
          value: input.toState,
        },
        // The reason is free text a service advisor typed about a customer's
        // vehicle, so it is `internal` rather than `public`.
        ...(input.reason === undefined
          ? []
          : [{ field: 'reason', classification: 'internal' as const, value: input.reason }]),
      ],
    });

    await publishEvent(db, {
      eventType: closing ? 'work-order.closed' : 'work-order.state-changed',
      aggregateId: workOrderId,
      aggregateVersion: recordVersion,
      producer: 'wo.work-order-service',
      companyId: locked.companyId,
      branchId: locked.branchId,
      // States and the display number only. A consumer that needs the vehicle, the
      // customer or the jobs reads them under its own authorization — an event is
      // a notification that something happened, not a bypass of the read model.
      payload: {
        workOrderId,
        fromState: locked.state,
        toState: input.toState,
        kind: locked.kind,
        displayNumber: locked.displayNumber,
      },
      // Closure can happen at most once — the target is terminal and the guard
      // freezes a terminal row — so the key needs no version. A generic state
      // change repeats, so its key carries the version it produced, which is what
      // makes an idempotent replay of the same transition collide rather than
      // publish twice.
      eventKey: closing
        ? `work-order.closed:${workOrderId}`
        : `work-order.state-changed:${workOrderId}:${recordVersion}`,
    });

    return { state: input.toState, recordVersion };
  }
}
