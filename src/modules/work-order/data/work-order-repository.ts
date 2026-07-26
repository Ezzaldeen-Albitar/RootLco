/**
 * Work-order and job reads and writes (Phase 1-19, P1-19-BE-002…005).
 *
 * ## Creation is NOT here, and that is a boundary decision already taken
 *
 * `wo.work_orders` rows are inserted by the reception module's conversion
 * (P1-18-BE-019), not by this repository. That module writes exactly six columns
 * plus the display number and leaves `kind`, `state`, `parts_forward_state` and
 * `opened_at` to their frozen defaults, with a comment saying why: choosing them
 * "would be this module deciding how work is organised — which is Phase 1-19's
 * contract, not reception's".
 *
 * So the boundary is: **reception opens the shell, P1-19 owns everything after.**
 * Duplicating an insert here would give the platform two ways to create a work
 * order, and the second one would not be the one `uq_work_orders_ordinary_origin`
 * and the reception visit lock were designed around. Wave 4 therefore reads what
 * conversion created and drives it from there.
 *
 * ## Closure blockers are evaluated as SIX independent predicates
 *
 * `wo.guard_work_order_closure` is the authority and raises on the FIRST blocker
 * it hits. The queries below re-ask each of its six conditions separately so the
 * eligibility endpoint can report every unmet one. Each predicate is transcribed
 * from the guard body rather than reinvented, and
 * `tests/db/p1-19-closure-blocker-reconciliation.test.ts` pins the code set
 * against the deployed function so the two cannot drift apart silently.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface WorkOrderRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly receptionVisitId: string;
  readonly vehicleId: string;
  readonly kind: string;
  readonly state: string;
  readonly partsForwardState: string;
  readonly displayNumber: string | null;
  readonly openedAt: Date;
  readonly recordVersion: number;
}

export interface JobRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly title: string;
  readonly jobType: string | null;
  readonly state: string;
  readonly requiresDiagnostic: boolean;
  readonly recordVersion: number;
}

export interface StatusHistoryRow {
  readonly fromState: string | null;
  readonly toState: string;
  readonly reason: string | null;
  readonly occurredAt: Date;
  readonly actorId: string | null;
}

/** One unmet closure condition, keyed by the guard's own label. */
export interface BlockerHit {
  readonly code: 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6';
}

export class WorkOrderRepository extends Repository {
  protected readonly module = 'work-order';

  /**
   * Locks a work order and returns it, or null when absent or out of scope.
   *
   * The lock is taken before any state is read, so a concurrent transition
   * serialises behind us rather than racing the guard.
   */
  async lockWorkOrder(db: DbHandle, workOrderId: string): Promise<WorkOrderRow | null> {
    return this.readWorkOrder(db, workOrderId, true);
  }

  /** Reads a work order without locking, for query paths. */
  async findWorkOrder(db: DbHandle, workOrderId: string): Promise<WorkOrderRow | null> {
    return this.readWorkOrder(db, workOrderId, false);
  }

  private async readWorkOrder(
    db: DbHandle,
    workOrderId: string,
    lock: boolean
  ): Promise<WorkOrderRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      company_id: string;
      branch_id: string;
      reception_visit_id: string;
      vehicle_id: string;
      kind: string;
      state: string;
      parts_forward_state: string;
      display_number: string | null;
      opened_at: Date;
      record_version: number;
    }>(
      db,
      `SELECT id, company_id, branch_id, reception_visit_id, vehicle_id, kind, state,
              parts_forward_state, display_number, opened_at, record_version
         FROM wo.work_orders
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        ${lock ? 'FOR UPDATE' : ''}`,
      [context.principal.tenantId, workOrderId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          branchId: row.branch_id,
          receptionVisitId: row.reception_visit_id,
          vehicleId: row.vehicle_id,
          kind: row.kind,
          state: row.state,
          partsForwardState: row.parts_forward_state,
          displayNumber: row.display_number,
          openedAt: row.opened_at,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * Applies a state change under the caller's held lock and record version.
   *
   * The `record_version` predicate is the optimistic-concurrency check: zero rows
   * changed means someone else moved the row between the caller's read and this
   * write, which the service turns into `ERR-CON-001`. `shared.touch_row_metadata`
   * bumps the version, and the AFTER trigger writes the append-only history row —
   * neither is done here, because doing it by hand would give the platform two
   * ways to advance a version that could disagree.
   */
  async applyState(
    db: DbHandle,
    workOrderId: string,
    toState: string,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE wo.work_orders
          SET state = $3, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $5 AND deleted_at IS NULL`,
      [context.principal.tenantId, workOrderId, toState, context.principal.userId, expectedVersion]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** Append-only transition history for one work order, oldest first. */
  async history(db: DbHandle, workOrderId: string): Promise<readonly StatusHistoryRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      from_state: string | null;
      to_state: string;
      reason: string | null;
      occurred_at: Date;
      actor_id: string | null;
    }>(
      db,
      `SELECT from_state, to_state, reason, occurred_at, actor_id
         FROM wo.work_order_status_history
        WHERE tenant_id = $1 AND work_order_id = $2
        ORDER BY occurred_at, seq`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map((row) => ({
      fromState: row.from_state,
      toState: row.to_state,
      reason: row.reason,
      occurredAt: row.occurred_at,
      actorId: row.actor_id,
    }));
  }

  /** Live jobs on one work order, in creation order. */
  async jobsFor(db: DbHandle, workOrderId: string): Promise<readonly JobRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      work_order_id: string;
      title: string;
      job_type: string | null;
      state: string;
      requires_diagnostic: boolean;
      record_version: number;
    }>(
      db,
      `SELECT id, work_order_id, title, job_type, state, requires_diagnostic, record_version
         FROM wo.jobs
        WHERE tenant_id = $1 AND work_order_id = $2 AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      workOrderId: row.work_order_id,
      title: row.title,
      jobType: row.job_type,
      state: row.state,
      requiresDiagnostic: row.requires_diagnostic,
      recordVersion: row.record_version,
    }));
  }

  /**
   * Creates a job on a work order.
   *
   * The initial state is supplied by the caller, which has already resolved the
   * job-state catalog to validate it. `wo.guard_job_refs` locks the parent work
   * order and refuses a terminal parent or one whose state does not allow jobs, so
   * neither check is re-implemented here — the lock it takes is also what makes a
   * job insert serialise against a concurrent close rather than race it.
   */
  async createJob(
    db: DbHandle,
    input: {
      readonly workOrderId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly title: string;
      readonly jobType: string | null;
      readonly state: string;
      readonly requiresDiagnostic: boolean;
    }
  ): Promise<JobRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      work_order_id: string;
      title: string;
      job_type: string | null;
      state: string;
      requires_diagnostic: boolean;
      record_version: number;
    }>(
      db,
      `INSERT INTO wo.jobs
         (tenant_id, company_id, branch_id, work_order_id, title, job_type, state,
          requires_diagnostic, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, work_order_id, title, job_type, state, requires_diagnostic, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.title,
        input.jobType,
        input.state,
        input.requiresDiagnostic,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('job insert returned no row');
    return {
      id: row.id,
      workOrderId: row.work_order_id,
      title: row.title,
      jobType: row.job_type,
      state: row.state,
      requiresDiagnostic: row.requires_diagnostic,
      recordVersion: row.record_version,
    };
  }

  /** Locks one job and returns it, or null when absent or out of scope. */
  async lockJob(db: DbHandle, jobId: string): Promise<JobRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      work_order_id: string;
      title: string;
      job_type: string | null;
      state: string;
      requires_diagnostic: boolean;
      record_version: number;
    }>(
      db,
      `SELECT id, work_order_id, title, job_type, state, requires_diagnostic, record_version
         FROM wo.jobs
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, jobId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          workOrderId: row.work_order_id,
          title: row.title,
          jobType: row.job_type,
          state: row.state,
          requiresDiagnostic: row.requires_diagnostic,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * Updates a job's mutable descriptive fields under the caller's version.
   *
   * `state` is deliberately NOT settable here. Moving a job is a transition and
   * belongs to `wo.guard_job_transition`; letting an update path also write the
   * state column would be a second way to move a job that skips the graph
   * entirely — which is exactly the shortcut the module-foundation guard exists
   * to prevent.
   */
  async updateJob(
    db: DbHandle,
    jobId: string,
    input: {
      readonly title: string;
      readonly jobType: string | null;
      readonly requiresDiagnostic: boolean;
      readonly expectedVersion: number;
    }
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE wo.jobs
          SET title = $3, job_type = $4, requires_diagnostic = $5, updated_by = $6
        WHERE tenant_id = $1 AND id = $2 AND record_version = $7 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        jobId,
        input.title,
        input.jobType,
        input.requiresDiagnostic,
        context.principal.userId,
        input.expectedVersion,
      ]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * The unmet closure blockers among B1, B2, B3 and B4.
   *
   * B5 and B6 are answered by the `quality` module through its public surface,
   * because they read `qms` tables this module may not touch. One round trip
   * evaluates all four rather than four round trips, and `false` for a blocker
   * means the guard would not raise it — never that it was not checked.
   *
   * Each branch is transcribed from `wo.guard_work_order_closure`:
   *
   *  - B1 a live job whose state is not terminal in the resolved state catalog;
   *  - B2 a labor session on one of this order's jobs with `ended_at IS NULL`;
   *  - B3 a REQUIRED additional-work request still `pending`, or `approved` and
   *       `unfulfilled`;
   *  - B4 a `requires_diagnostic` job with no `completed` diagnostic report.
   *
   * B2 and B4 read `tech.` and `dia.` respectively — the guard does the same, and
   * these are read-only closure predicates rather than that domain's behaviour,
   * so they stay with the blocker they answer. The module-boundary guard records
   * them explicitly rather than leaving them to be discovered.
   */
  async structuralBlockers(db: DbHandle, workOrderId: string): Promise<readonly BlockerHit[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      b1: boolean;
      b2: boolean;
      b3: boolean;
      b4: boolean;
    }>(
      db,
      `WITH wo_row AS (
         SELECT id, tenant_id, company_id, branch_id
           FROM wo.work_orders
          WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       )
       SELECT
         EXISTS (
           SELECT 1 FROM wo.jobs j, wo_row w
            WHERE j.tenant_id = w.tenant_id AND j.company_id = w.company_id
              AND j.branch_id = w.branch_id AND j.work_order_id = w.id
              AND j.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM wo.job_states js
                 WHERE js.code = j.state
                   AND (js.scope = 'platform' OR js.tenant_id = w.tenant_id)
                   AND js.deleted_at IS NULL AND js.is_terminal)
         ) AS b1,
         EXISTS (
           SELECT 1 FROM tech.labor_sessions ls
             JOIN wo.jobs j ON j.tenant_id = ls.tenant_id AND j.company_id = ls.company_id
                           AND j.branch_id = ls.branch_id AND j.id = ls.job_id,
                wo_row w
            WHERE ls.tenant_id = w.tenant_id AND j.work_order_id = w.id
              AND ls.ended_at IS NULL AND ls.deleted_at IS NULL
         ) AS b2,
         EXISTS (
           SELECT 1 FROM wo.additional_work_requests r, wo_row w
            WHERE r.tenant_id = w.tenant_id AND r.company_id = w.company_id
              AND r.branch_id = w.branch_id AND r.work_order_id = w.id
              AND r.is_required AND r.deleted_at IS NULL
              AND (r.state = 'pending'
                   OR (r.state = 'approved' AND r.fulfillment_state = 'unfulfilled'))
         ) AS b3,
         EXISTS (
           SELECT 1 FROM wo.jobs j, wo_row w
            WHERE j.tenant_id = w.tenant_id AND j.company_id = w.company_id
              AND j.branch_id = w.branch_id AND j.work_order_id = w.id
              AND j.requires_diagnostic AND j.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM dia.diagnostic_reports d
                 WHERE d.tenant_id = j.tenant_id AND d.company_id = j.company_id
                   AND d.branch_id = j.branch_id AND d.job_id = j.id
                   AND d.status = 'completed' AND d.deleted_at IS NULL)
         ) AS b4`,
      [context.principal.tenantId, workOrderId]
    );
    const row = result.rows[0];
    if (row === undefined) return [];
    const hits: BlockerHit[] = [];
    if (row.b1) hits.push({ code: 'B1' });
    if (row.b2) hits.push({ code: 'B2' });
    if (row.b3) hits.push({ code: 'B3' });
    if (row.b4) hits.push({ code: 'B4' });
    return hits;
  }
}
