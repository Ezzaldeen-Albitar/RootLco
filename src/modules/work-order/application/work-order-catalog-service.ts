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
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import type {
  JobStateRow,
  TransitionRow,
  WorkOrderCatalogRepository,
  WorkOrderStateRow,
} from '../data/work-order-catalog-repository';
import { assertTransitionReason } from '../domain/work-order';

export class WorkOrderCatalogService extends ApplicationService {
  protected readonly module = 'work-order';

  constructor(private readonly repository: WorkOrderCatalogRepository) {
    super();
  }

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
    const states = await this.repository.workOrderStates(db);
    return this.resolve(
      await this.repository.workOrderTransition(db, fromState, toState),
      'work order',
      fromState,
      toState,
      reason,
      states.find((state) => state.code === fromState)?.isTerminal ?? false,
      states.find((state) => state.code === toState)?.reasonRequired ?? false
    );
  }

  /** Resolves a job edge and validates its reason requirement. */
  async resolveJobTransition(
    db: DbHandle,
    fromState: string,
    toState: string,
    reason: string | undefined
  ): Promise<TransitionRow> {
    const states = await this.repository.jobStates(db);
    return this.resolve(
      await this.repository.jobTransition(db, fromState, toState),
      'job',
      fromState,
      toState,
      reason,
      states.find((state) => state.code === fromState)?.isTerminal ?? false,
      states.find((state) => state.code === toState)?.reasonRequired ?? false
    );
  }

  /**
   * Shared resolution.
   *
   * `targetReasonRequired` is not an afterthought: `wo.guard_work_order_transition`
   * demands a reason when `(v_edge_reason OR v_target_reason)` — the EDGE's flag OR
   * the TARGET STATE's `reason_required`. An earlier version consulted the edge
   * alone. The platform graph happens to have no edge where the target requires a
   * reason and the edge does not, so it was latent — but tenant overrides are the
   * entire reason this module reads the catalog instead of mirroring it, and there
   * is no foreign key from `wo.work_order_transitions.to_state` to
   * `wo.work_order_states.code`, so a tenant can seed exactly that combination.
   *
   * `fromIsTerminal` likewise mirrors the guard's BR-WO-002 refusal. Reporting an
   * edge OUT of a terminal state as permitted is the specific failure this module
   * exists to avoid: the API would describe a graph the database refuses.
   */
  private resolve(
    edge: TransitionRow | null,
    subject: string,
    fromState: string,
    toState: string,
    reason: string | undefined,
    fromIsTerminal: boolean,
    targetReasonRequired: boolean
  ): TransitionRow {
    if (fromIsTerminal) {
      throw new AppFailure('ERR-TRN-001', {
        message: `This ${subject} is in terminal state "${fromState}"; no transition is permitted`,
      });
    }
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
    assertTransitionReason(edge.requiresReason || targetReasonRequired, reason);
    return edge;
  }
}
