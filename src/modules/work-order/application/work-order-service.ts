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
import { qualityModule } from '@/modules/quality';
import type {
  BlockerHit,
  JobRow,
  StatusHistoryRow,
  WorkOrderRepository,
  WorkOrderRow,
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
  ): Promise<readonly JobRow[]> {
    await this.requireWorkOrder(db, workOrderId, authorizeScope);
    return this.repository.jobsFor(db, workOrderId);
  }

  /** Append-only transition history. */
  async history(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<readonly StatusHistoryRow[]> {
    await this.requireWorkOrder(db, workOrderId, authorizeScope);
    return this.repository.history(db, workOrderId);
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
  ): Promise<JobRow> {
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

    return this.repository.createJob(db, {
      workOrderId,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      title: input.title,
      jobType: input.jobType ?? null,
      state: initial.code,
      requiresDiagnostic: input.requiresDiagnostic ?? false,
    });
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
    }
  ): Promise<JobRow> {
    const locked = await this.repository.lockJob(db, jobId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', { message: `Job ${jobId} is not visible` });
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
    return {
      ...locked,
      title: input.title,
      jobType: input.jobType ?? null,
      requiresDiagnostic: input.requiresDiagnostic ?? locked.requiresDiagnostic,
      recordVersion: input.expectedVersion + 1,
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
    input: {
      readonly toState: string;
      readonly reason?: string | undefined;
      readonly expectedVersion: number;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<{ readonly state: string; readonly recordVersion: number }> {
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
    if (target?.isTerminal === true && target.isCancellation === false) {
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
      input.expectedVersion
    );
    if (!applied) {
      throw new AppFailure('ERR-CON-001', {
        message: `Work order ${workOrderId} was modified by another request`,
      });
    }
    return { state: input.toState, recordVersion: input.expectedVersion + 1 };
  }
}
