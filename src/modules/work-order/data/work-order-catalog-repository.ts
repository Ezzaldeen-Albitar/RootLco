/**
 * Work-order and job state/transition catalog reads (Phase 1-19, P1-19-BE-001).
 *
 * The only place the transition graph is read. Every later wave asks this
 * repository what an edge permits; none of them mirrors the graph.
 *
 * ## Platform rows and tenant overrides resolve the way the guards resolve them
 *
 * `wo.work_order_states`, `wo.job_states` and both `*_transitions` tables carry a
 * `scope` of `platform` or `tenant`. `wo.guard_work_order_transition` and
 * `wo.guard_job_transition` select with
 * `(scope = 'platform' OR tenant_id = <row tenant>)` and
 * `ORDER BY (scope = 'tenant') DESC LIMIT 1`, so a tenant row shadows the platform
 * row of the same code. These queries repeat that predicate and that ordering
 * exactly. If they diverged, the API would report a graph the database does not
 * enforce — which is the failure this module exists to avoid.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface WorkOrderStateRow {
  readonly code: string;
  readonly name: string;
  readonly isTerminal: boolean;
  readonly isClosed: boolean;
  readonly isCancellation: boolean;
  readonly reasonRequired: boolean;
  readonly allowsJobs: boolean;
  readonly allowsLabor: boolean;
  readonly allowsAdditionalWork: boolean;
  readonly requiresQc: boolean;
  readonly isReopenable: boolean;
}

export interface JobStateRow {
  readonly code: string;
  readonly name: string;
  readonly isTerminal: boolean;
  readonly reasonRequired: boolean;
  readonly assignmentRequired: boolean;
  readonly laborAllowed: boolean;
  readonly closureEligible: boolean;
}

export interface TransitionRow {
  readonly fromState: string;
  readonly toState: string;
  readonly requiresReason: boolean;
}

export class WorkOrderCatalogRepository extends Repository {
  protected readonly module = 'work-order';

  /** Every active work-order state visible to the caller's tenant. */
  async workOrderStates(db: DbHandle): Promise<readonly WorkOrderStateRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      code: string;
      name: string;
      is_terminal: boolean;
      is_closed: boolean;
      is_cancellation: boolean;
      reason_required: boolean;
      allows_jobs: boolean;
      allows_labor: boolean;
      allows_additional_work: boolean;
      requires_qc: boolean;
      is_reopenable: boolean;
    }>(
      db,
      `SELECT * FROM (
                SELECT DISTINCT ON (code) code, name, is_terminal, is_closed, is_cancellation, reason_required,
                       allows_jobs, allows_labor, allows_additional_work, requires_qc, is_reopenable, status
                  FROM wo.work_order_states
                 WHERE (scope = 'platform' OR tenant_id = $1)
                   AND deleted_at IS NULL
                 ORDER BY code, (scope = 'tenant') DESC
              ) resolved
        WHERE status = 'active'
        ORDER BY code`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      code: row.code,
      name: row.name,
      isTerminal: row.is_terminal,
      isClosed: row.is_closed,
      isCancellation: row.is_cancellation,
      reasonRequired: row.reason_required,
      allowsJobs: row.allows_jobs,
      allowsLabor: row.allows_labor,
      allowsAdditionalWork: row.allows_additional_work,
      requiresQc: row.requires_qc,
      isReopenable: row.is_reopenable,
    }));
  }

  /** Every active job state visible to the caller's tenant. */
  async jobStates(db: DbHandle): Promise<readonly JobStateRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      code: string;
      name: string;
      is_terminal: boolean;
      reason_required: boolean;
      assignment_required: boolean;
      labor_allowed: boolean;
      closure_eligible: boolean;
    }>(
      db,
      `SELECT * FROM (
                SELECT DISTINCT ON (code) code, name, is_terminal, reason_required, assignment_required,
                       labor_allowed, closure_eligible, status
                  FROM wo.job_states
                 WHERE (scope = 'platform' OR tenant_id = $1)
                   AND deleted_at IS NULL
                 ORDER BY code, (scope = 'tenant') DESC
              ) resolved
        WHERE status = 'active'
        ORDER BY code`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      code: row.code,
      name: row.name,
      isTerminal: row.is_terminal,
      reasonRequired: row.reason_required,
      assignmentRequired: row.assignment_required,
      laborAllowed: row.labor_allowed,
      closureEligible: row.closure_eligible,
    }));
  }

  /**
   * The single work-order edge `from → to`, or null when the graph has none.
   *
   * Null is the answer for "this transition does not exist", which the service
   * turns into `ERR-TRN-001`. It is never an error here — the catalog is being
   * asked a question, not asserting a rule.
   */
  async workOrderTransition(
    db: DbHandle,
    fromState: string,
    toState: string
  ): Promise<TransitionRow | null> {
    return this.transition(db, 'wo.work_order_transitions', fromState, toState);
  }

  /** The single job edge `from → to`, or null when the graph has none. */
  async jobTransition(
    db: DbHandle,
    fromState: string,
    toState: string
  ): Promise<TransitionRow | null> {
    return this.transition(db, 'wo.job_transitions', fromState, toState);
  }

  /** Every active work-order edge, for the state-machine reference and tests. */
  async workOrderTransitions(db: DbHandle): Promise<readonly TransitionRow[]> {
    return this.transitions(db, 'wo.work_order_transitions');
  }

  /** Every active job edge, for the state-machine reference and tests. */
  async jobTransitions(db: DbHandle): Promise<readonly TransitionRow[]> {
    return this.transitions(db, 'wo.job_transitions');
  }

  /**
   * Shared edge lookup.
   *
   * `relation` is closed: it is only ever one of the two literals passed by the
   * four methods above, never anything derived from a request. The interpolation
   * is therefore not a caller-reachable surface. It is written this way rather
   * than duplicated because the two tables are column-identical and two copies
   * would be two places to get the tenant-override predicate wrong.
   */
  private async transition(
    db: DbHandle,
    relation: 'wo.work_order_transitions' | 'wo.job_transitions',
    fromState: string,
    toState: string
  ): Promise<TransitionRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      from_state: string;
      to_state: string;
      requires_reason: boolean;
    }>(
      db,
      `SELECT from_state, to_state, requires_reason
         FROM ${relation}
        WHERE (scope = 'platform' OR tenant_id = $1)
          AND from_state = $2 AND to_state = $3
          AND is_active AND deleted_at IS NULL
        ORDER BY (scope = 'tenant') DESC
        LIMIT 1`,
      [context.principal.tenantId, fromState, toState]
    );
    const row = result.rows[0];
    return row
      ? { fromState: row.from_state, toState: row.to_state, requiresReason: row.requires_reason }
      : null;
  }

  /** Shared full-graph read. `relation` is closed exactly as in `transition`. */
  private async transitions(
    db: DbHandle,
    relation: 'wo.work_order_transitions' | 'wo.job_transitions'
  ): Promise<readonly TransitionRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      from_state: string;
      to_state: string;
      requires_reason: boolean;
    }>(
      db,
      `SELECT DISTINCT ON (from_state, to_state) from_state, to_state, requires_reason
         FROM ${relation}
        WHERE (scope = 'platform' OR tenant_id = $1)
          AND is_active AND deleted_at IS NULL
        ORDER BY from_state, to_state, (scope = 'tenant') DESC`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      fromState: row.from_state,
      toState: row.to_state,
      requiresReason: row.requires_reason,
    }));
  }
}
