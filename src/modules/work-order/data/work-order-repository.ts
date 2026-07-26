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
import { buildPage, keysetFragment, type Page, type PageRequest } from '@/server/db/pagination';

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
  /**
   * Who opened the work order — in practice the actor of reception's conversion.
   *
   * Read here rather than derived, because the transition ledger cannot answer it:
   * `wo.emit_work_order_status_history` fires AFTER UPDATE only, so the row that
   * opens a work order emits nothing. The service projects this ONLY into the
   * history view's origin block, beside the transitions' own `actorId`, and never
   * into the list or detail projections.
   */
  readonly createdBy: string | null;
  readonly recordVersion: number;
}

/** Ordering contract for the work-order list. Newest opened first, id tie-break. */
export const WORK_ORDER_LIST_ORDER = Object.freeze({
  key: 'wo.work_orders:opened_at_desc',
  direction: 'desc' as const,
});

/** Ordering contract for the status ledger. Newest transition first, id tie-break. */
export const WORK_ORDER_HISTORY_ORDER = Object.freeze({
  key: 'wo.work_order_status_history:occurred_at_desc',
  direction: 'desc' as const,
});

/** Ordering contract for a job's status ledger. Newest transition first. */
export const JOB_HISTORY_ORDER = Object.freeze({
  key: 'wo.job_status_history:occurred_at_desc',
  direction: 'desc' as const,
});

/** Server-side filter for the branch work-order board. */
export interface WorkOrderListFilter {
  readonly companyId: string;
  readonly branchId: string;
  readonly state?: string | undefined;
  readonly kind?: string | undefined;
  /** Inclusive lower bound on `opened_at`. */
  readonly openedFrom?: Date | undefined;
  /** Inclusive upper bound on `opened_at`. */
  readonly openedTo?: Date | undefined;
}

export interface JobRow {
  readonly id: string;
  readonly workOrderId: string;
  /**
   * The job's own scope columns.
   *
   * Carried on the row rather than looked up later because `PATCH /jobs/{jobId}`
   * is addressed by job id alone: without them the deferred scope authorization
   * would have nothing to name, and `scope: 'branch'` degrades to a scope-blind
   * check on an empty target (P1-18-A-01). `fk_jobs_work_order` is the composite
   * key `(tenant, company, branch, work_order_id)`, so these always equal the
   * parent work order's — reading them off the job is exact, not an approximation.
   */
  readonly companyId: string;
  readonly branchId: string;
  readonly title: string;
  readonly jobType: string | null;
  readonly state: string;
  readonly requiresDiagnostic: boolean;
  readonly recordVersion: number;
}

export interface StatusHistoryRow {
  readonly id: string;
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

/**
 * One temporal job assignment. `validTo === null` means it is the live one.
 *
 * `wo.job_assignments` is append-then-close: ending an assignment stamps `valid_to`
 * and a mandatory reason, and the row survives. The set of rows for a job IS its
 * assignment history, which is why nothing here deletes.
 */
export interface AssignmentRow {
  readonly id: string;
  readonly jobId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly technicianProfileId: string;
  readonly assignmentRole: string;
  readonly validFrom: Date;
  readonly validTo: Date | null;
  readonly reason: string | null;
  readonly recordVersion: number;
}

/** One row of a technician's live queue. */
export interface TechnicianQueueRow {
  readonly assignmentId: string;
  readonly jobId: string;
  readonly workOrderId: string;
  readonly assignmentRole: string;
  readonly validFrom: Date;
  readonly jobTitle: string;
  readonly jobState: string;
  readonly workOrderState: string;
  readonly displayNumber: string | null;
}

/**
 * One service line or one required part.
 *
 * `quantity` is a STRING, not a number: the column is `numeric(12,3)` and IEEE-754
 * cannot represent every value it can hold, so it crosses this boundary losslessly
 * the way `schemas.money` does.
 *
 * `reference` is `service_ref` or `item_ref`, and each is a REAL foreign key to its
 * Phase 1-10 catalog — `svc.services (tenant_id, id)` and
 * `inv.item_master (tenant_id, id)` — added by migration 20260723097000. The Phase
 * 1-9 table comments still call them opaque forward references with no foreign key,
 * which was true when those tables were created and is no longer.
 */
export interface LineRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly jobId: string | null;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string;
  readonly reference: string | null;
  readonly recordVersion: number;
}

interface LineColumns {
  id: string;
  work_order_id: string;
  job_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  reference: string | null;
  record_version: number;
}

const toLineRow = (row: LineColumns): LineRow => ({
  id: row.id,
  workOrderId: row.work_order_id,
  jobId: row.job_id,
  description: row.description,
  quantity: row.quantity,
  unit: row.unit,
  reference: row.reference,
  recordVersion: row.record_version,
});

/**
 * One additional-work request — extra work discovered mid-repair.
 *
 * `originatingFindingId` is an opaque soft link to `dia.findings` with NO foreign
 * key, so it can be recorded here and cannot be validated until Wave 7 exists.
 * `originatingJobId` is the opposite: `fk_additional_work_requests_job` is the
 * composite scope key, which pins the job to the same branch and NOT to the same
 * work order — a job under a different order in the same branch satisfies it, so the
 * ownership check is the service's.
 *
 * `isRequired` is IMMUTABLE after insert (`tg_additional_work_requests_immutable`),
 * which is what makes B3 non-evadable: a required request cannot be quietly demoted
 * to optional to unblock a closure.
 */
export interface AdditionalWorkRequestRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly originatingJobId: string | null;
  readonly originatingFindingId: string | null;
  readonly summary: string;
  readonly state: string;
  readonly fulfillmentState: string;
  readonly isRequired: boolean;
  readonly createdAt: Date;
  readonly recordVersion: number;
}

/**
 * The RESTRICTED customer-facing description, 1:1 with a request.
 *
 * A separate row and a separate projection because the whole TABLE is gated:
 * `sel/ins/upd_additional_work_request_details_gated` each additionally require
 * `iam.has_permission('iam.sensitive.view')`, so for a caller without it the row
 * does not exist for reading OR writing. Folding it into the request projection
 * would make an ordinary service advisor's request read silently return nothing.
 */
export interface AdditionalWorkDetailRow {
  readonly id: string;
  readonly additionalWorkRequestId: string;
  readonly description: string;
  readonly classification: string;
  readonly recordVersion: number;
}

/**
 * One immutable customer decision.
 *
 * `tg_customer_approvals_immutable` freezes `decision`, `channel`, `presentedScope`,
 * `quotationRevisionRef`, `decidedAt` and `decidingPartyRoleId`, and no application
 * role holds DELETE — so a recorded decision can be neither edited nor erased.
 */
export interface CustomerApprovalRow {
  readonly id: string;
  readonly additionalWorkRequestId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly decidingPartyRoleId: string;
  readonly decision: string;
  readonly channel: string;
  readonly presentedScope: string;
  readonly quotationRevisionRef: string | null;
  readonly decidedAt: Date;
  readonly recordVersion: number;
}

/** One append-only evidence row binding an EXACT immutable document version. */
export interface ApprovalEvidenceRow {
  readonly id: string;
  readonly customerApprovalId: string;
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note: string | null;
  readonly createdAt: Date;
}

interface RequestColumns {
  id: string;
  work_order_id: string;
  company_id: string;
  branch_id: string;
  originating_job_id: string | null;
  originating_finding_id: string | null;
  summary: string;
  state: string;
  fulfillment_state: string;
  is_required: boolean;
  created_at: Date;
  record_version: number;
}

/** Projection shared by every request read, and by the insert's RETURNING. */
const REQUEST_COLUMNS = `id, work_order_id, company_id, branch_id, originating_job_id,
          originating_finding_id, summary, state, fulfillment_state, is_required,
          created_at, record_version`;

const toRequestRow = (row: RequestColumns): AdditionalWorkRequestRow => ({
  id: row.id,
  workOrderId: row.work_order_id,
  companyId: row.company_id,
  branchId: row.branch_id,
  originatingJobId: row.originating_job_id,
  originatingFindingId: row.originating_finding_id,
  summary: row.summary,
  state: row.state,
  fulfillmentState: row.fulfillment_state,
  isRequired: row.is_required,
  createdAt: row.created_at,
  recordVersion: row.record_version,
});

interface ApprovalColumns {
  id: string;
  additional_work_request_id: string;
  company_id: string;
  branch_id: string;
  deciding_party_role_id: string;
  decision: string;
  channel: string;
  presented_scope: string;
  quotation_revision_ref: string | null;
  decided_at: Date;
  record_version: number;
}

const APPROVAL_COLUMNS = `id, additional_work_request_id, company_id, branch_id,
          deciding_party_role_id, decision, channel, presented_scope,
          quotation_revision_ref, decided_at, record_version`;

const toApprovalRow = (row: ApprovalColumns): CustomerApprovalRow => ({
  id: row.id,
  additionalWorkRequestId: row.additional_work_request_id,
  companyId: row.company_id,
  branchId: row.branch_id,
  decidingPartyRoleId: row.deciding_party_role_id,
  decision: row.decision,
  channel: row.channel,
  presentedScope: row.presented_scope,
  quotationRevisionRef: row.quotation_revision_ref,
  decidedAt: row.decided_at,
  recordVersion: row.record_version,
});

interface AssignmentColumns {
  id: string;
  job_id: string;
  company_id: string;
  branch_id: string;
  technician_profile_id: string;
  assignment_role: string;
  valid_from: Date;
  valid_to: Date | null;
  reason: string | null;
  record_version: number;
}

const ASSIGNMENT_COLUMNS = `id, job_id, company_id, branch_id, technician_profile_id,
          assignment_role, valid_from, valid_to, reason, record_version`;

const toAssignmentRow = (row: AssignmentColumns): AssignmentRow => ({
  id: row.id,
  jobId: row.job_id,
  companyId: row.company_id,
  branchId: row.branch_id,
  technicianProfileId: row.technician_profile_id,
  assignmentRole: row.assignment_role,
  validFrom: row.valid_from,
  validTo: row.valid_to,
  reason: row.reason,
  recordVersion: row.record_version,
});

/** The column shape every job read projects. One place, so the three cannot drift. */
interface JobColumns {
  id: string;
  work_order_id: string;
  company_id: string;
  branch_id: string;
  title: string;
  job_type: string | null;
  state: string;
  requires_diagnostic: boolean;
  record_version: number;
}

/** Projection list shared by every job read, and by the insert's RETURNING. */
const JOB_COLUMNS = `id, work_order_id, company_id, branch_id, title, job_type, state,
          requires_diagnostic, record_version`;

const toJobRow = (row: JobColumns): JobRow => ({
  id: row.id,
  workOrderId: row.work_order_id,
  companyId: row.company_id,
  branchId: row.branch_id,
  title: row.title,
  jobType: row.job_type,
  state: row.state,
  requiresDiagnostic: row.requires_diagnostic,
  recordVersion: row.record_version,
});

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
      created_by: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, company_id, branch_id, reception_visit_id, vehicle_id, kind, state,
              parts_forward_state, display_number, opened_at, created_by, record_version
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
          createdBy: row.created_by,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * One keyset page of the branch's work orders, newest opened first.
   *
   * Company and branch are REQUIRED filter columns rather than optional
   * conveniences. RLS narrows a list to `app.branch_ids`, which is the
   * permission-blind union of every active grant — so a caller holding
   * `wo.work_order.read` in one branch and any grant at all in another would see
   * the second branch's board if the query did not name a scope. Naming it here
   * is what lets the route pass the same pair as the `authorizationTarget`, so the
   * permission is evaluated by `iam.has_permission_in_scope` against the branch
   * actually being read (P1-18-A-01).
   *
   * `state` and `kind` are compared as opaque catalog codes; neither is matched
   * against a TypeScript vocabulary, because `wo.work_order_states` is
   * tenant-extensible and an unknown code must return an empty page rather than a
   * validation error about a state the tenant may legitimately have defined.
   */
  async listWorkOrders(
    db: DbHandle,
    filter: WorkOrderListFilter,
    page: PageRequest
  ): Promise<Page<WorkOrderRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.state ?? null,
      filter.kind ?? null,
      filter.openedFrom ?? null,
      filter.openedTo ?? null,
    ];
    const keyset = keysetFragment(
      page,
      { sort: 'opened_at', id: 'id' },
      WORK_ORDER_LIST_ORDER,
      values.length + 1
    );
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
      created_by: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, company_id, branch_id, reception_visit_id, vehicle_id, kind, state,
              parts_forward_state, display_number, opened_at, created_by, record_version
         FROM wo.work_orders
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND deleted_at IS NULL
          AND ($4::text IS NULL OR state = $4)
          AND ($5::text IS NULL OR kind = $5)
          AND ($6::timestamptz IS NULL OR opened_at >= $6)
          AND ($7::timestamptz IS NULL OR opened_at <= $7)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows: WorkOrderRow[] = result.rows.map((row) => ({
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
      createdBy: row.created_by,
      recordVersion: row.record_version,
    }));
    return buildPage(rows, page, WORK_ORDER_LIST_ORDER, (row) => ({
      sortValue: row.openedAt.toISOString(),
      id: row.id,
    }));
  }

  /**
   * Opens a REWORK work order against the same reception visit as a closed original.
   *
   * ## Why an insert exists here at all, when Wave 4 said there is only one
   *
   * Wave 4's boundary decision was about the ORDINARY path: reception's conversion
   * opens the shell because that order originates from an authorized visit, and a
   * second ordinary insert would not be the one the reception lock and
   * `uq_work_orders_ordinary_origin` were designed around. A REWORK order originates
   * from a CLOSED work order, which reception cannot observe and has no reason to,
   * and `wo.work_orders.kind = 'rework'` exists for exactly this.
   *
   * Two schema facts show it was designed for rather than tolerated:
   * `wo.guard_work_order_refs` precondition 3 admits a `converted` visit, and
   * `uq_work_orders_ordinary_origin` is PARTIAL on `kind = 'ordinary'` — so a second
   * order against an already-converted visit is legal precisely when it is a rework.
   * Without this method `qms.rework_links` is unreachable and closure blocker B6 can
   * never fire, because nothing in the platform can produce its subject.
   *
   * The vehicle and the reception visit are COPIED from the original rather than
   * accepted: `guard_work_order_refs` requires the vehicle to match the visit's, and
   * `qms.guard_rework_link_coherence` requires the two orders to share the visit, so
   * a caller-supplied pair could only ever agree or be refused.
   */
  async openRework(
    db: DbHandle,
    input: {
      readonly originalWorkOrderId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly receptionVisitId: string;
      readonly vehicleId: string;
      readonly displayNumber: string;
    }
  ): Promise<WorkOrderRow> {
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
      created_by: string | null;
      record_version: number;
    }>(
      db,
      // `state`, `parts_forward_state` and `opened_at` are left to their frozen
      // defaults, exactly as reception's conversion leaves them — choosing them here
      // would be this method deciding how the rework is organised, which is the
      // transition graph's business and not the opening's.
      `INSERT INTO wo.work_orders
         (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, kind,
          display_number, created_by)
       VALUES ($1, $2, $3, $4, $5, 'rework', $6, $7)
       RETURNING id, company_id, branch_id, reception_visit_id, vehicle_id, kind, state,
                 parts_forward_state, display_number, opened_at, created_by, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.receptionVisitId,
        input.vehicleId,
        input.displayNumber,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('rework work order insert returned no row');
    return {
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
      createdBy: row.created_by,
      recordVersion: row.record_version,
    };
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
   *
   * ## The reason travels through a GUC, not a column
   *
   * `wo.work_orders` has no reason column. Both triggers read
   * `NULLIF(btrim(current_setting('app.status_reason', true)), '')`:
   * `wo.guard_work_order_transition` raises `check_violation` when the edge or the
   * target state requires a reason and the GUC is unset, and
   * `wo.emit_work_order_status_history` copies it into the ledger row. So a reason
   * that is validated in TypeScript but never published here would fail the guard
   * as a bare `23514` on every reason-required edge, and every history row would
   * carry `reason = NULL`.
   *
   * It is set transaction-locally (`set_config(..., true)`) and cleared right
   * after, so a second state change later in the same request cannot inherit the
   * first one's reason. No clear is attempted on the failure path: a raising
   * statement aborts the surrounding transaction, so nothing it set can survive.
   */
  async applyState(
    db: DbHandle,
    workOrderId: string,
    toState: string,
    reason: string | null,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    await this.run(db, 'SELECT set_config($1, $2, true)', ['app.status_reason', reason ?? '']);
    const result = await this.run(
      db,
      `UPDATE wo.work_orders
          SET state = $3, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $5 AND deleted_at IS NULL`,
      [context.principal.tenantId, workOrderId, toState, context.principal.userId, expectedVersion]
    );
    await this.run(db, 'SELECT set_config($1, $2, true)', ['app.status_reason', '']);
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * One keyset page of the append-only transition ledger, newest first.
   *
   * Paginated rather than returned whole: the ledger grows without bound for a
   * long-running order, and an endpoint that returns all of it is the unbounded
   * response the pagination contract exists to prevent.
   *
   * The tie-break is `id`, not `seq`, even though `ix_work_order_status_history_wo`
   * is `(…, occurred_at DESC, seq DESC)`. `decodeCursor` requires a UUID
   * tie-breaker platform-wide (P1-15-SR-013), and a bigint there would surface a
   * malformed cursor as a raw `22P02` 500 instead of `ERR-PAG-001`. The index's
   * `occurred_at DESC` prefix is still used for the seek; only the tie inside one
   * timestamp is resolved outside it, and `(occurred_at, id)` is still a total
   * order, which is what makes the page stable.
   */
  async historyPage(
    db: DbHandle,
    workOrderId: string,
    page: PageRequest
  ): Promise<Page<StatusHistoryRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, workOrderId];
    const keyset = keysetFragment(
      page,
      { sort: 'occurred_at', id: 'id' },
      WORK_ORDER_HISTORY_ORDER,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      from_state: string | null;
      to_state: string;
      reason: string | null;
      occurred_at: Date;
      actor_id: string | null;
    }>(
      db,
      `SELECT id, from_state, to_state, reason, occurred_at, actor_id
         FROM wo.work_order_status_history
        WHERE tenant_id = $1 AND work_order_id = $2
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows: StatusHistoryRow[] = result.rows.map((row) => ({
      id: row.id,
      fromState: row.from_state,
      toState: row.to_state,
      reason: row.reason,
      occurredAt: row.occurred_at,
      actorId: row.actor_id,
    }));
    return buildPage(rows, page, WORK_ORDER_HISTORY_ORDER, (row) => ({
      sortValue: row.occurredAt.toISOString(),
      id: row.id,
    }));
  }

  /**
   * The earliest ledger row's `from_state`, or null when the ledger is empty.
   *
   * This is how the history view reports the state a work order OPENED in without
   * fabricating a genesis row. `wo.emit_work_order_status_history` is AFTER UPDATE
   * only, so the insert that opens an order emits nothing, and
   * `shared.stamp_status_history` forces `occurred_at := now()` — a backfilled
   * genesis row would therefore carry a timestamp that is not when the order
   * opened. Deriving it from the oldest transition's origin is exact.
   */
  async initialState(db: DbHandle, workOrderId: string): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ from_state: string | null }>(
      db,
      `SELECT from_state
         FROM wo.work_order_status_history
        WHERE tenant_id = $1 AND work_order_id = $2
        ORDER BY occurred_at, seq
        LIMIT 1`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows[0]?.from_state ?? null;
  }

  /** Live jobs on one work order, in creation order. */
  async jobsFor(db: DbHandle, workOrderId: string): Promise<readonly JobRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<JobColumns>(
      db,
      `SELECT ${JOB_COLUMNS}
         FROM wo.jobs
        WHERE tenant_id = $1 AND work_order_id = $2 AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map(toJobRow);
  }

  /**
   * Every live job on a set of work orders, in one round trip.
   *
   * This exists so the aggregate-detail projection over a page of work orders is
   * one query rather than one per order. The caller groups by `workOrderId`.
   */
  async jobsForMany(
    db: DbHandle,
    workOrderIds: readonly string[]
  ): Promise<ReadonlyMap<string, readonly JobRow[]>> {
    const grouped = new Map<string, JobRow[]>();
    if (workOrderIds.length === 0) return grouped;
    const context = this.assertContext(db);
    const result = await this.run<JobColumns>(
      db,
      `SELECT ${JOB_COLUMNS}
         FROM wo.jobs
        WHERE tenant_id = $1 AND work_order_id = ANY($2::uuid[]) AND deleted_at IS NULL
        ORDER BY work_order_id, created_at, id`,
      [context.principal.tenantId, [...workOrderIds]]
    );
    for (const row of result.rows) {
      const job = toJobRow(row);
      const bucket = grouped.get(job.workOrderId);
      if (bucket) bucket.push(job);
      else grouped.set(job.workOrderId, [job]);
    }
    return grouped;
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
    const result = await this.run<JobColumns>(
      db,
      `INSERT INTO wo.jobs
         (tenant_id, company_id, branch_id, work_order_id, title, job_type, state,
          requires_diagnostic, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${JOB_COLUMNS}`,
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
    return toJobRow(row);
  }

  /** Locks one job and returns it, or null when absent or out of scope. */
  async lockJob(db: DbHandle, jobId: string): Promise<JobRow | null> {
    return this.readJob(db, jobId, true);
  }

  /** Reads one job without locking, for query paths. */
  async findJob(db: DbHandle, jobId: string): Promise<JobRow | null> {
    return this.readJob(db, jobId, false);
  }

  private async readJob(db: DbHandle, jobId: string, lock: boolean): Promise<JobRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<JobColumns>(
      db,
      `SELECT ${JOB_COLUMNS}
         FROM wo.jobs
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        ${lock ? 'FOR UPDATE' : ''}`,
      [context.principal.tenantId, jobId]
    );
    const row = result.rows[0];
    return row ? toJobRow(row) : null;
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
   * Moves a job under the caller's held lock and record version.
   *
   * Same GUC contract as `applyState`: `wo.guard_job_transition` reads
   * `app.status_reason` for the reason requirement — which the assignments
   * migration REPLACED the guard to extend, adding the precondition that an
   * `assignment_required` target needs an active `wo.job_assignments` row — and
   * `wo.emit_job_status_history` copies the same GUC into the ledger.
   */
  async applyJobState(
    db: DbHandle,
    jobId: string,
    toState: string,
    reason: string | null,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    await this.run(db, 'SELECT set_config($1, $2, true)', ['app.status_reason', reason ?? '']);
    const result = await this.run(
      db,
      `UPDATE wo.jobs
          SET state = $3, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $5 AND deleted_at IS NULL`,
      [context.principal.tenantId, jobId, toState, context.principal.userId, expectedVersion]
    );
    await this.run(db, 'SELECT set_config($1, $2, true)', ['app.status_reason', '']);
    return (result.rowCount ?? 0) === 1;
  }

  /** One keyset page of a job's append-only status ledger, newest first. */
  async jobHistoryPage(
    db: DbHandle,
    jobId: string,
    page: PageRequest
  ): Promise<Page<StatusHistoryRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, jobId];
    const keyset = keysetFragment(
      page,
      { sort: 'occurred_at', id: 'id' },
      JOB_HISTORY_ORDER,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      from_state: string | null;
      to_state: string;
      reason: string | null;
      occurred_at: Date;
      actor_id: string | null;
    }>(
      db,
      `SELECT id, from_state, to_state, reason, occurred_at, actor_id
         FROM wo.job_status_history
        WHERE tenant_id = $1 AND job_id = $2
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows: StatusHistoryRow[] = result.rows.map((row) => ({
      id: row.id,
      fromState: row.from_state,
      toState: row.to_state,
      reason: row.reason,
      occurredAt: row.occurred_at,
      actorId: row.actor_id,
    }));
    return buildPage(rows, page, JOB_HISTORY_ORDER, (row) => ({
      sortValue: row.occurredAt.toISOString(),
      id: row.id,
    }));
  }

  /** The oldest ledger entry's origin state for a job, or null while it is empty. */
  async jobInitialState(db: DbHandle, jobId: string): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ from_state: string | null }>(
      db,
      `SELECT from_state FROM wo.job_status_history
        WHERE tenant_id = $1 AND job_id = $2
        ORDER BY occurred_at, seq LIMIT 1`,
      [context.principal.tenantId, jobId]
    );
    return result.rows[0]?.from_state ?? null;
  }

  /**
   * Records one service line or one required part.
   *
   * Both tables have the same shape and the same catalog-reference discipline, so
   * one method serves both rather than two that would drift. The table name and the
   * reference column are code-controlled literals, never caller input.
   *
   * `service_ref` and `item_ref` are REAL foreign keys — `fk_work_order_service_lines_service`
   * to `svc.services (tenant_id, id)` and `fk_required_parts_item` to
   * `inv.item_master (tenant_id, id)`, both added by migration 20260723097000 once
   * the Phase 1-10 catalogs existed. An unknown reference therefore arrives as
   * `23503` and the service maps it; it is not the unconstrained forward pointer the
   * original Phase 1-9 table comments describe.
   */
  async recordLine(
    db: DbHandle,
    kind: 'service' | 'part',
    input: {
      readonly workOrderId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly jobId: string | null;
      readonly description: string;
      readonly quantity: string;
      readonly unit: string;
      readonly reference: string | null;
    }
  ): Promise<LineRow> {
    const context = this.assertContext(db);
    const table = kind === 'service' ? 'wo.work_order_service_lines' : 'wo.required_parts';
    const refColumn = kind === 'service' ? 'service_ref' : 'item_ref';
    const result = await this.run<LineColumns>(
      db,
      `INSERT INTO ${table}
         (tenant_id, company_id, branch_id, work_order_id, job_id, description,
          quantity, unit, ${refColumn}, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10)
       RETURNING id, work_order_id, job_id, description, quantity::text AS quantity, unit,
                 ${refColumn} AS reference, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.jobId,
        input.description,
        input.quantity,
        input.unit,
        input.reference,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`${kind} line insert returned no row`);
    return toLineRow(row);
  }

  /** Every live service line or required part on a work order, oldest first. */
  async linesFor(
    db: DbHandle,
    kind: 'service' | 'part',
    workOrderId: string
  ): Promise<readonly LineRow[]> {
    const context = this.assertContext(db);
    const table = kind === 'service' ? 'wo.work_order_service_lines' : 'wo.required_parts';
    const refColumn = kind === 'service' ? 'service_ref' : 'item_ref';
    const result = await this.run<LineColumns>(
      db,
      `SELECT id, work_order_id, job_id, description, quantity::text AS quantity, unit,
              ${refColumn} AS reference, record_version
         FROM ${table}
        WHERE tenant_id = $1 AND work_order_id = $2 AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map(toLineRow);
  }

  /** Raises an additional-work request against a work order. */
  async createRequest(
    db: DbHandle,
    input: {
      readonly workOrderId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly originatingJobId: string | null;
      readonly originatingFindingId: string | null;
      readonly summary: string;
      readonly isRequired: boolean;
    }
  ): Promise<AdditionalWorkRequestRow> {
    const context = this.assertContext(db);
    const result = await this.run<RequestColumns>(
      db,
      `INSERT INTO wo.additional_work_requests
         (tenant_id, company_id, branch_id, work_order_id, originating_job_id,
          originating_finding_id, summary, is_required, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${REQUEST_COLUMNS}`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.originatingJobId,
        input.originatingFindingId,
        input.summary,
        input.isRequired,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('additional-work request insert returned no row');
    return toRequestRow(row);
  }

  /** Locks one request by id, so a decision serialises against a withdrawal. */
  async lockRequest(db: DbHandle, requestId: string): Promise<AdditionalWorkRequestRow | null> {
    return this.readRequest(db, requestId, true);
  }

  /** Reads one request without locking, for query paths. */
  async findRequest(db: DbHandle, requestId: string): Promise<AdditionalWorkRequestRow | null> {
    return this.readRequest(db, requestId, false);
  }

  private async readRequest(
    db: DbHandle,
    requestId: string,
    lock: boolean
  ): Promise<AdditionalWorkRequestRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<RequestColumns>(
      db,
      `SELECT ${REQUEST_COLUMNS}
         FROM wo.additional_work_requests
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        ${lock ? 'FOR UPDATE' : ''}`,
      [context.principal.tenantId, requestId]
    );
    const row = result.rows[0];
    return row ? toRequestRow(row) : null;
  }

  /** Every live additional-work request on a work order, oldest first. */
  async requestsFor(
    db: DbHandle,
    workOrderId: string
  ): Promise<readonly AdditionalWorkRequestRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<RequestColumns>(
      db,
      `SELECT ${REQUEST_COLUMNS}
         FROM wo.additional_work_requests
        WHERE tenant_id = $1 AND work_order_id = $2 AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map(toRequestRow);
  }

  /**
   * Moves a request's state under the caller's record version.
   *
   * `wo.guard_additional_work_state` fires BEFORE UPDATE OF state and refuses
   * `approved` unless an `approved` `wo.customer_approvals` row already exists for
   * this request. That is the forgery-resistance control and the reason the approval
   * INSERT must precede this call inside one transaction: doing them in the other
   * order raises `check_violation`, and doing them in two requests would leave a
   * window where a decision exists and the request does not reflect it.
   */
  async applyRequestState(
    db: DbHandle,
    requestId: string,
    toState: string,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE wo.additional_work_requests
          SET state = $3, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $5 AND deleted_at IS NULL`,
      [context.principal.tenantId, requestId, toState, context.principal.userId, expectedVersion]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** Records that approved additional work was carried out, or waived. */
  async applyRequestFulfillment(
    db: DbHandle,
    requestId: string,
    fulfillmentState: string,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE wo.additional_work_requests
          SET fulfillment_state = $3, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $5 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        requestId,
        fulfillmentState,
        context.principal.userId,
        expectedVersion,
      ]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * Writes the RESTRICTED customer-facing description, creating or replacing it.
   *
   * One statement rather than a read followed by a branch, because the read would
   * be gated by the same policy as the write and would therefore be unable to
   * distinguish "no detail" from "no permission". `uq_additional_work_request_details_request`
   * is a PARTIAL UNIQUE INDEX rather than a constraint, so the conflict target must
   * be inferred by column list AND predicate — `ON CONFLICT ON CONSTRAINT` cannot
   * name an index and would fail at parse time.
   *
   * A caller lacking `iam.sensitive.view` is refused by the INSERT policy as
   * `42501`, not by anything here: the gate is the database's, and the operation's
   * declared permission is the readable refusal in front of it.
   */
  async writeDetail(
    db: DbHandle,
    input: {
      readonly requestId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly description: string;
    }
  ): Promise<AdditionalWorkDetailRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      additional_work_request_id: string;
      description: string;
      classification: string;
      record_version: number;
    }>(
      db,
      `INSERT INTO wo.additional_work_request_details
         (tenant_id, company_id, branch_id, additional_work_request_id, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, company_id, branch_id, additional_work_request_id)
         WHERE deleted_at IS NULL
       DO UPDATE SET description = $5, updated_by = $6
       RETURNING id, additional_work_request_id, description, classification, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.requestId,
        input.description,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('additional-work detail write returned no row');
    return {
      id: row.id,
      additionalWorkRequestId: row.additional_work_request_id,
      description: row.description,
      classification: row.classification,
      recordVersion: row.record_version,
    };
  }

  /**
   * The RESTRICTED description, or null.
   *
   * Null means "not visible to you", which covers both "no detail was written" and
   * "you do not hold `iam.sensitive.view`" — the SELECT policy makes them the same
   * answer at this layer, and the service does not pretend otherwise.
   */
  async detailFor(db: DbHandle, requestId: string): Promise<AdditionalWorkDetailRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      additional_work_request_id: string;
      description: string;
      classification: string;
      record_version: number;
    }>(
      db,
      `SELECT id, additional_work_request_id, description, classification, record_version
         FROM wo.additional_work_request_details
        WHERE tenant_id = $1 AND additional_work_request_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, requestId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          additionalWorkRequestId: row.additional_work_request_id,
          description: row.description,
          classification: row.classification,
          recordVersion: row.record_version,
        }
      : null;
  }

  /**
   * Records the immutable customer decision.
   *
   * `decided_at` is server-stamped by the column default rather than accepted: a
   * caller-chosen decision time could be moved before the request existed or after
   * the work was done, and the column is frozen by the immutability trigger so it
   * could never be corrected afterwards.
   *
   * Two database refusals reach the service from here and mean different things:
   * `23505` on `uq_customer_approvals_active` is a second decision on one request,
   * and `23514`/`23503` from `wo.guard_customer_approval_coherence` is a deciding
   * party who does not belong to the work order's reception visit.
   */
  async recordApproval(
    db: DbHandle,
    input: {
      readonly requestId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly decidingPartyRoleId: string;
      readonly decision: string;
      readonly channel: string;
      readonly presentedScope: string;
    }
  ): Promise<CustomerApprovalRow> {
    const context = this.assertContext(db);
    const result = await this.run<ApprovalColumns>(
      db,
      `INSERT INTO wo.customer_approvals
         (tenant_id, company_id, branch_id, additional_work_request_id,
          deciding_party_role_id, decision, channel, presented_scope, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${APPROVAL_COLUMNS}`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.requestId,
        input.decidingPartyRoleId,
        input.decision,
        input.channel,
        input.presentedScope,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('customer approval insert returned no row');
    return toApprovalRow(row);
  }

  /** The live decision on one request, or null while it is undecided. */
  async approvalFor(db: DbHandle, requestId: string): Promise<CustomerApprovalRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<ApprovalColumns>(
      db,
      `SELECT ${APPROVAL_COLUMNS}
         FROM wo.customer_approvals
        WHERE tenant_id = $1 AND additional_work_request_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, requestId]
    );
    const row = result.rows[0];
    return row ? toApprovalRow(row) : null;
  }

  /**
   * Binds one exact document version to an approval as evidence.
   *
   * `wo.customer_approval_evidence` is append-only — `app_runtime` holds SELECT and
   * INSERT and nothing else, so there is no substitution and no erasure. The FK is
   * `(tenant_id, document_version_id)` to `shared.document_versions`, so an unknown
   * or foreign-tenant version is `23503`; no storage key appears in the table, in
   * this method, or in the route that reaches it.
   */
  async recordApprovalEvidence(
    db: DbHandle,
    input: {
      readonly approvalId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly documentVersionId: string;
      readonly evidenceType: string;
      readonly note: string | null;
    }
  ): Promise<ApprovalEvidenceRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      customer_approval_id: string;
      document_version_id: string;
      evidence_type: string;
      note: string | null;
      created_at: Date;
    }>(
      db,
      `INSERT INTO wo.customer_approval_evidence
         (tenant_id, company_id, branch_id, customer_approval_id, document_version_id,
          evidence_type, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, customer_approval_id, document_version_id, evidence_type, note, created_at`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.approvalId,
        input.documentVersionId,
        input.evidenceType,
        input.note,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('approval evidence insert returned no row');
    return {
      id: row.id,
      customerApprovalId: row.customer_approval_id,
      documentVersionId: row.document_version_id,
      evidenceType: row.evidence_type,
      note: row.note,
      createdAt: row.created_at,
    };
  }

  /** Every evidence row bound to one approval, oldest first. */
  async evidenceFor(db: DbHandle, approvalId: string): Promise<readonly ApprovalEvidenceRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      customer_approval_id: string;
      document_version_id: string;
      evidence_type: string;
      note: string | null;
      created_at: Date;
    }>(
      db,
      `SELECT id, customer_approval_id, document_version_id, evidence_type, note, created_at
         FROM wo.customer_approval_evidence
        WHERE tenant_id = $1 AND customer_approval_id = $2
        ORDER BY created_at, id`,
      [context.principal.tenantId, approvalId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      customerApprovalId: row.customer_approval_id,
      documentVersionId: row.document_version_id,
      evidenceType: row.evidence_type,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  /**
   * REQUIRED additional-work requests originating from one job that are still
   * awaiting a customer decision.
   *
   * The predicate is B3's FIRST limb only — `is_required AND state = 'pending'` —
   * and the omission of the second is the load-bearing part. B3 also blocks closure
   * on `approved` + `unfulfilled`, but that describes work the customer HAS
   * authorised and the workshop has not yet done: blocking execution on it would
   * make the job unable to enter a labour state, so the approved work could never be
   * carried out and the request could never become fulfilled. The gate would
   * deadlock the very case it exists to serve.
   *
   * Scoped to `originating_job_id`, so a request raised from a different job, from no
   * job at all, or against a different work order does not gate this job. Those
   * still block CLOSURE through B3, which is a different question asked at a
   * different time.
   */
  async pendingRequiredRequestsForJob(
    db: DbHandle,
    jobId: string
  ): Promise<readonly { readonly id: string; readonly summary: string }[]> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string; summary: string }>(
      db,
      `SELECT id, summary
         FROM wo.additional_work_requests
        WHERE tenant_id = $1 AND originating_job_id = $2
          AND is_required AND state = 'pending' AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [context.principal.tenantId, jobId]
    );
    return result.rows.map((row) => ({ id: row.id, summary: row.summary }));
  }

  /**
   * Opens an assignment. The row set IS the history — nothing is ever deleted.
   *
   * `uq_job_assignments_active_primary` is a PARTIAL unique index over
   * `(tenant, company, branch, job_id) WHERE assignment_role = 'primary' AND
   * valid_to IS NULL AND deleted_at IS NULL`, so a second active primary arrives as
   * `23505` and the service maps it rather than letting it surface as a 500. An
   * `assist` assignment is deliberately unconstrained: a job may have several.
   */
  async openAssignment(
    db: DbHandle,
    input: {
      readonly jobId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly technicianProfileId: string;
      readonly assignmentRole: string;
    }
  ): Promise<AssignmentRow> {
    const context = this.assertContext(db);
    const result = await this.run<AssignmentColumns>(
      db,
      `INSERT INTO wo.job_assignments
         (tenant_id, company_id, branch_id, job_id, technician_profile_id, assignment_role, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${ASSIGNMENT_COLUMNS}`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.jobId,
        input.technicianProfileId,
        input.assignmentRole,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('assignment insert returned no row');
    return toAssignmentRow(row);
  }

  /** Locks the active PRIMARY assignment of a job, if it has one. */
  async lockActivePrimaryAssignment(db: DbHandle, jobId: string): Promise<AssignmentRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<AssignmentColumns>(
      db,
      `SELECT ${ASSIGNMENT_COLUMNS}
         FROM wo.job_assignments
        WHERE tenant_id = $1 AND job_id = $2 AND assignment_role = 'primary'
          AND valid_to IS NULL AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, jobId]
    );
    const row = result.rows[0];
    return row ? toAssignmentRow(row) : null;
  }

  /** Locks one assignment by id. */
  async lockAssignment(db: DbHandle, assignmentId: string): Promise<AssignmentRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<AssignmentColumns>(
      db,
      `SELECT ${ASSIGNMENT_COLUMNS}
         FROM wo.job_assignments
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, assignmentId]
    );
    const row = result.rows[0];
    return row ? toAssignmentRow(row) : null;
  }

  /**
   * Closes an assignment by stamping `valid_to` and its reason.
   *
   * The reason is not optional in the schema either:
   * `ck_job_assignments_end_reason` refuses an end without one, because removing a
   * technician from work is accountable. `valid_to` is server-stamped with `now()`
   * rather than accepted from the caller — a caller-chosen end time could be made
   * to precede `valid_from` or to rewrite history.
   */
  async closeAssignment(
    db: DbHandle,
    assignmentId: string,
    reason: string,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE wo.job_assignments
          SET valid_to = now(), reason = $3, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $5
          AND valid_to IS NULL AND deleted_at IS NULL`,
      [context.principal.tenantId, assignmentId, reason, context.principal.userId, expectedVersion]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** Every assignment a job has ever had, newest interval first. */
  async assignmentsFor(db: DbHandle, jobId: string): Promise<readonly AssignmentRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<AssignmentColumns>(
      db,
      `SELECT ${ASSIGNMENT_COLUMNS}
         FROM wo.job_assignments
        WHERE tenant_id = $1 AND job_id = $2 AND deleted_at IS NULL
        ORDER BY valid_from DESC, id DESC`,
      [context.principal.tenantId, jobId]
    );
    return result.rows.map(toAssignmentRow);
  }

  /**
   * The active assignments of one technician — their queue.
   *
   * Joined to the job and its work order so the queue answers "what am I on"
   * without a second round trip per row.
   */
  async queueFor(
    db: DbHandle,
    technicianProfileId: string
  ): Promise<readonly TechnicianQueueRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      assignment_id: string;
      job_id: string;
      work_order_id: string;
      assignment_role: string;
      valid_from: Date;
      job_title: string;
      job_state: string;
      work_order_state: string;
      display_number: string | null;
    }>(
      db,
      `SELECT a.id AS assignment_id, a.job_id, j.work_order_id, a.assignment_role, a.valid_from,
              j.title AS job_title, j.state AS job_state,
              w.state AS work_order_state, w.display_number
         FROM wo.job_assignments a
         JOIN wo.jobs j ON j.tenant_id = a.tenant_id AND j.company_id = a.company_id
                       AND j.branch_id = a.branch_id AND j.id = a.job_id
         JOIN wo.work_orders w ON w.tenant_id = j.tenant_id AND w.company_id = j.company_id
                              AND w.branch_id = j.branch_id AND w.id = j.work_order_id
        WHERE a.tenant_id = $1 AND a.technician_profile_id = $2
          AND a.valid_to IS NULL AND a.deleted_at IS NULL
          AND j.deleted_at IS NULL AND w.deleted_at IS NULL
        ORDER BY a.valid_from DESC, a.id DESC`,
      [context.principal.tenantId, technicianProfileId]
    );
    return result.rows.map((row) => ({
      assignmentId: row.assignment_id,
      jobId: row.job_id,
      workOrderId: row.work_order_id,
      assignmentRole: row.assignment_role,
      validFrom: row.valid_from,
      jobTitle: row.job_title,
      jobState: row.job_state,
      workOrderState: row.work_order_state,
      displayNumber: row.display_number,
    }));
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
