/**
 * Work-order and job state-graph reads (Phase 1-19, P1-19-BE-001).
 *
 * The one place later waves ask "may this edge be taken, and does it need a
 * reason". Waves 4 and 5 call `resolveWorkOrderTransition` / `resolveJobTransition`
 * before touching a row; nothing restates the graph.
 *
 * This service does not enforce. `wo.guard_work_order_transition` and
 * `wo.guard_job_transition` are the enforcement point and run inside the same
 * statement as the write, so a graph edit committed between this read and that
 * write is caught by the database, not missed by us. What this service buys is a
 * precise 409 with the caller's own vocabulary instead of a raw `23514`.
 */
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type {
  JobStateRow,
  TransitionRow,
  WorkOrderCatalogRepository,
  WorkOrderStateRow,
} from '../data/work-order-catalog-repository';
import { assertTransitionReason } from '../domain/work-order';

export class WorkOrderCatalogService {
  constructor(private readonly repository: WorkOrderCatalogRepository) {}

  /** Every active work-order state for the caller's tenant. */
  async workOrderStates(db: DbHandle): Promise<readonly WorkOrderStateRow[]> {
    return this.repository.workOrderStates(db);
  }

  /** Every active job state for the caller's tenant. */
  async jobStates(db: DbHandle): Promise<readonly JobStateRow[]> {
    return this.repository.jobStates(db);
  }

  /** The full active work-order graph, for the state-machine reference. */
  async workOrderTransitions(db: DbHandle): Promise<readonly TransitionRow[]> {
    return this.repository.workOrderTransitions(db);
  }

  /** The full active job graph, for the state-machine reference. */
  async jobTransitions(db: DbHandle): Promise<readonly TransitionRow[]> {
    return this.repository.jobTransitions(db);
  }

  /**
   * Resolves a work-order edge and validates its reason requirement.
   *
   * Refuses with `ERR-TRN-001` when the graph has no such edge — including the
   * self-edge case, where the aggregate is already in the target state. That is
   * the existing platform code for exactly this fact; P1-19 does not mint a
   * per-module duplicate of it.
   */
  async resolveWorkOrderTransition(
    db: DbHandle,
    fromState: string,
    toState: string,
    reason: string | undefined
  ): Promise<TransitionRow> {
    const edge = await this.repository.workOrderTransition(db, fromState, toState);
    return this.resolve(edge, 'work order', fromState, toState, reason);
  }

  /** Resolves a job edge and validates its reason requirement. */
  async resolveJobTransition(
    db: DbHandle,
    fromState: string,
    toState: string,
    reason: string | undefined
  ): Promise<TransitionRow> {
    const edge = await this.repository.jobTransition(db, fromState, toState);
    return this.resolve(edge, 'job', fromState, toState, reason);
  }

  private resolve(
    edge: TransitionRow | null,
    subject: string,
    fromState: string,
    toState: string,
    reason: string | undefined
  ): TransitionRow {
    if (edge === null) {
      // The state pair goes in `message`, which is log-only and never reaches the
      // caller — the response carries the catalog title alone. `SafeDetails` is a
      // closed platform shape and widening it to carry states would change the
      // response contract of every error in the system, which is not this module's
      // decision to make.
      throw new AppFailure('ERR-TRN-001', {
        message: `This ${subject} cannot move from "${fromState}" to "${toState}"`,
      });
    }
    assertTransitionReason(edge.requiresReason, reason);
    return edge;
  }
}
