/**
 * Quality-control and rework reads (Phase 1-19, P1-19-BE-001).
 *
 * The only place `qms` SQL is written. Wave 8 adds the QC, rework and reopen
 * writes on top of these reads.
 *
 * `mandatoryChecksExist` and `recordsFor` between them answer the closure guard's
 * B5, which is really two conditions — a failed record with no pass, and a
 * configured mandatory check with no pass. They are read separately because the
 * eligibility endpoint has to be able to say which of the two bites; the pass/fail
 * folding itself happens in `QualityGateService.evaluate`, not here, because a
 * repository should return rows rather than verdicts.
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
import {
  timelineWindowSql,
  type TimelineSourceRow,
  type TimelineWindow,
} from '@/server/db/timeline';

/** Newest first, matching every other operational queue in the platform. */
export const QC_BRANCH_ORDER: OrderingContract = Object.freeze({
  key: 'qms.quality_control_records:created_at_desc',
  direction: 'desc',
});

/** One QC record as the branch queue renders it (PRE-P1-29-BR-06). */
export interface QcRecordRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly overallResult: string;
  readonly checkerId: string | null;
  readonly finalizedAt: string | null;
  readonly recordVersion: number;
}

/** A vocabulary row (P1-29-W8): the check plus its scope, status and version. */
export interface QcCheckVocabularyRow extends QcCheckRow {
  readonly scope: 'platform' | 'tenant';
  readonly status: string;
  readonly recordVersion: number;
}

export interface QcCheckRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isMandatory: boolean;
  readonly isSafetyCritical: boolean;
}

export interface QualityControlRecordRow {
  readonly id: string;
  readonly workOrderId: string;
  /**
   * The record's own scope columns.
   *
   * Carried on the row because `/quality-controls/{recordId}` names no branch: without
   * them the deferred scope authorization would have nothing to narrow by, and
   * `scope: 'branch'` degrades to a scope-blind check on an empty target
   * (P1-18-A-01). The composite foreign key pins them to the parent work order's, so
   * reading them off the record is exact.
   */
  readonly companyId: string;
  readonly branchId: string;
  readonly overallResult: string;
  readonly checkerId: string | null;
  readonly finalizedAt: Date | null;
  readonly recordVersion: number;
}

export interface ReworkLinkRow {
  readonly id: string;
  /** Same reason as above: `/rework-links/{id}` names no branch. */
  readonly companyId: string;
  readonly branchId: string;
  readonly originalWorkOrderId: string;
  readonly reworkWorkOrderId: string;
  readonly rootCause: string;
  readonly correctiveAction: string;
  readonly responsibility: string | null;
  readonly leadTechnicianId: string | null;
  readonly isSafetyCritical: boolean;
  readonly independentSignOffBy: string | null;
  readonly signOffAt: Date | null;
  readonly recordVersion: number;
}

/** One per-check outcome inside a quality-control record. */
export interface QcCheckResultRow {
  readonly id: string;
  readonly qcCheckId: string;
  readonly checkCode: string;
  readonly result: string;
  readonly note: string | null;
  readonly recordVersion: number;
}

/**
 * The RESTRICTED cost-of-quality figure, 1:1 with a rework link.
 *
 * `rework_cost` is a STRING because the column is `numeric(14,4)` and IEEE-754
 * cannot represent every value it holds — the same rule money and quantities follow.
 * The whole table is gated on `iam.sensitive.view` by all three of its policies, so
 * it is a separate authorized surface exactly as
 * `wo.additional_work_request_details` is.
 */
export interface ReworkCostRow {
  readonly id: string;
  readonly reworkLinkId: string;
  readonly reworkCost: string;
  readonly costCurrency: string;
  readonly classification: string;
  readonly recordVersion: number;
}

/** One recorded — and always rejected — attempt to reopen a closed work order. */
export interface ReopenAttemptRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly reason: string;
  readonly outcome: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
}

interface QcRecordColumns {
  id: string;
  work_order_id: string;
  company_id: string;
  branch_id: string;
  overall_result: string;
  checker_id: string | null;
  finalized_at: Date | null;
  record_version: number;
}

/** Projection shared by every QC record read, and by the insert's RETURNING. */
const QC_RECORD_COLUMNS = `id, work_order_id, company_id, branch_id, overall_result,
          checker_id, finalized_at, record_version`;

const toQcRecordRow = (row: QcRecordColumns): QualityControlRecordRow => ({
  id: row.id,
  workOrderId: row.work_order_id,
  companyId: row.company_id,
  branchId: row.branch_id,
  overallResult: row.overall_result,
  checkerId: row.checker_id,
  finalizedAt: row.finalized_at,
  recordVersion: row.record_version,
});

interface ReworkColumns {
  id: string;
  company_id: string;
  branch_id: string;
  original_work_order_id: string;
  rework_work_order_id: string;
  root_cause: string;
  corrective_action: string;
  responsibility: string | null;
  lead_technician_id: string | null;
  is_safety_critical: boolean;
  independent_sign_off_by: string | null;
  sign_off_at: Date | null;
  record_version: number;
}

const REWORK_COLUMNS = `id, company_id, branch_id, original_work_order_id, rework_work_order_id,
          root_cause, corrective_action, responsibility, lead_technician_id,
          is_safety_critical, independent_sign_off_by, sign_off_at, record_version`;

const toReworkRow = (row: ReworkColumns): ReworkLinkRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  originalWorkOrderId: row.original_work_order_id,
  reworkWorkOrderId: row.rework_work_order_id,
  rootCause: row.root_cause,
  correctiveAction: row.corrective_action,
  responsibility: row.responsibility,
  leadTechnicianId: row.lead_technician_id,
  isSafetyCritical: row.is_safety_critical,
  independentSignOffBy: row.independent_sign_off_by,
  signOffAt: row.sign_off_at,
  recordVersion: row.record_version,
});

export class QualityRepository extends Repository {
  protected readonly module = 'quality';

  /**
   * This module's events for the unified work-order timeline (P1-29 `W6`,
   * `INT-043`) — a PORT for the work-order module. `qms.quality_control_records`
   * carries `work_order_id`, so no `wo.` table is read (ADR-001). `reference`
   * is the QC record id.
   */
  async timelineEventsForWorkOrder(
    db: DbHandle,
    workOrderId: string,
    window: TimelineWindow
  ): Promise<readonly TimelineSourceRow[]> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, workOrderId];
    const w = timelineWindowSql(window, 't.occurred_at', 't.kind', 't.id', values.length + 1);
    const result = await this.run<{
      kind: string;
      id: string;
      job_id: string | null;
      actor_id: string | null;
      occurred_at: string;
      from_state: string | null;
      to_state: string | null;
      note: string | null;
      reference: string | null;
      detail: string | null;
      sort_value: string;
    }>(
      db,
      `SELECT t.kind, t.id, t.job_id, t.actor_id, t.occurred_at::text AS occurred_at,
              t.from_state, t.to_state, t.note, t.reference, t.detail,
              ${cursorTimestamp('t.occurred_at')} AS sort_value
         FROM (
           SELECT h.id, NULL::uuid AS job_id, h.actor_id, h.occurred_at, h.from_state, h.to_state,
                  h.reason AS note, q.id::text AS reference, NULL::text AS detail, 'qc_status' AS kind
             FROM qms.qc_status_history h
             JOIN qms.quality_control_records q
               ON q.tenant_id = h.tenant_id AND q.company_id = h.company_id
              AND q.branch_id = h.branch_id AND q.id = h.quality_control_record_id
            WHERE h.tenant_id = $1 AND q.work_order_id = $2 AND q.deleted_at IS NULL
         ) t
        WHERE TRUE ${w.predicate}
        ${w.order}
        ${w.limitClause}`,
      [...values, ...w.values]
    );
    return result.rows.map((row) => ({
      kind: row.kind as TimelineSourceRow['kind'],
      id: row.id,
      jobId: row.job_id,
      actorId: row.actor_id,
      occurredAt: row.occurred_at,
      fromState: row.from_state,
      toState: row.to_state,
      note: row.note,
      reference: row.reference,
      detail: row.detail,
      sortValue: row.sort_value,
    }));
  }

  /**
   * The branch QC queue, keyset-paged (PRE-P1-29-BR-06, `INS-13`, `DEP-B4`).
   *
   * Thirteen `qms` operations shipped and every one read QC records PER WORK
   * ORDER, so a QC supervisor could inspect a record they already had the id of
   * and could not see the queue they were meant to work through.
   *
   * It lives HERE rather than in the work-order module because `qms` is this
   * module’s schema — the module-boundary gate refuses a sibling schema in
   * another module’s SQL, and the operation is declared `module: 'quality'`
   * precisely because this is where it belongs.
   *
   * `overall_result` IS a closed vocabulary — `qms.qc_status_history`
   * CHECK-constrains the same three literals — which is why the route declares an
   * enum for it while the job board’s tenant-extensible `state` gets a format
   * check and an empty page.
   */
  async pageQcRecords(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly overallResult?: string | undefined;
    },
    page: PageRequest
  ): Promise<Page<QcRecordRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.overallResult ?? null,
    ];
    const keyset = keysetFragment(
      page,
      { sort: 'created_at', id: 'id' },
      QC_BRANCH_ORDER,
      values.length + 1
    );
    const result = await this.run<{
      id: string;
      work_order_id: string;
      overall_result: string;
      checker_id: string | null;
      finalized_at: string | null;
      record_version: number;
      created_at_cursor: string;
    }>(
      db,
      `SELECT id, work_order_id, overall_result, checker_id,
              finalized_at::text AS finalized_at, record_version,
              ${cursorTimestamp('created_at')} AS created_at_cursor
         FROM qms.quality_control_records
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND deleted_at IS NULL
          AND ($4::text IS NULL OR overall_result = $4)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows = result.rows.map((row) => ({
      id: row.id,
      workOrderId: row.work_order_id,
      overallResult: row.overall_result,
      checkerId: row.checker_id,
      finalizedAt: row.finalized_at,
      recordVersion: row.record_version,
      cursor: row.created_at_cursor,
    }));
    return buildPage(rows, page, QC_BRANCH_ORDER, (row) => ({ sortValue: row.cursor, id: row.id }));
  }

  /**
   * The check vocabulary the tenant resolves, BOTH statuses (P1-29-W8).
   *
   * The same resolution `qcChecks` applies — tenant row shadows platform row by
   * code — without the active-only filter: a record written against a retired
   * check still needs its name, and each row says which status it carries.
   * Whether a check may be ANSWERED stays with `qcChecks` on the write path.
   */
  async qcCheckVocabulary(db: DbHandle): Promise<readonly QcCheckVocabularyRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      scope: 'platform' | 'tenant';
      code: string;
      name: string;
      is_mandatory: boolean;
      is_safety_critical: boolean;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT * FROM (
                SELECT DISTINCT ON (code) id, scope, code, name, is_mandatory, is_safety_critical,
                       status, record_version
                  FROM qms.qc_checks
                 WHERE (scope = 'platform' OR tenant_id = $1)
                   AND deleted_at IS NULL
                 ORDER BY code, (scope = 'tenant') DESC
              ) resolved
        ORDER BY code`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      code: row.code,
      name: row.name,
      isMandatory: row.is_mandatory,
      isSafetyCritical: row.is_safety_critical,
      status: row.status,
      recordVersion: row.record_version,
    }));
  }

  /** Active QC checks visible to the tenant, tenant rows shadowing platform. */
  async qcChecks(db: DbHandle): Promise<readonly QcCheckRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      code: string;
      name: string;
      is_mandatory: boolean;
      is_safety_critical: boolean;
    }>(
      db,
      `SELECT * FROM (
                SELECT DISTINCT ON (code) id, code, name, is_mandatory, is_safety_critical, status
                  FROM qms.qc_checks
                 WHERE (scope = 'platform' OR tenant_id = $1)
                   AND deleted_at IS NULL
                 ORDER BY code, (scope = 'tenant') DESC
              ) resolved
        WHERE status = 'active'
        ORDER BY code`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      isMandatory: row.is_mandatory,
      isSafetyCritical: row.is_safety_critical,
    }));
  }

  /**
   * Does any mandatory QC check apply to this tenant?
   *
   * Mirrors the B5b predicate exactly, including that it is tenant-wide rather
   * than per work order: a check configured mandatory applies to every order.
   *
   * Note the deliberate asymmetry with `qcChecks()` above, which resolves tenant
   * shadowing. This one does NOT, because the guard does not: B5b is a flat
   * `EXISTS` over the union of platform and tenant rows. So a tenant that shadows
   * an active mandatory platform check with an inactive tenant row will see the
   * check listed as non-mandatory by `qcChecks()` while closure is still blocked.
   * That is the database's behaviour, faithfully reported rather than smoothed
   * over — smoothing it would make this method disagree with what actually runs.
   */
  async mandatoryChecksExist(db: DbHandle): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run<{ present: boolean }>(
      db,
      `SELECT EXISTS (
                SELECT 1 FROM qms.qc_checks
                 WHERE is_mandatory AND status = 'active'
                   AND (scope = 'platform' OR tenant_id = $1)
                   AND deleted_at IS NULL) AS present`,
      [context.principal.tenantId]
    );
    return result.rows[0]?.present ?? false;
  }

  /** QC records for one work order, newest first. */
  async recordsFor(db: DbHandle, workOrderId: string): Promise<readonly QualityControlRecordRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<QcRecordColumns>(
      db,
      `SELECT ${QC_RECORD_COLUMNS}
         FROM qms.quality_control_records
        WHERE tenant_id = $1 AND work_order_id = $2 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map(toQcRecordRow);
  }

  /** Rework links whose REWORK side is this work order — the side B6 examines. */
  async reworkLinksForReworkOrder(
    db: DbHandle,
    workOrderId: string
  ): Promise<readonly ReworkLinkRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<ReworkColumns>(
      db,
      `SELECT ${REWORK_COLUMNS}
         FROM qms.rework_links
        WHERE tenant_id = $1 AND rework_work_order_id = $2 AND deleted_at IS NULL
        ORDER BY created_at`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map(toReworkRow);
  }

  /**
   * Opens a PENDING quality-control record on a work order.
   *
   * There is no unique index on `(work_order_id)`, and that is deliberate in the
   * schema: a re-check after a failure is a NEW record, attributable to whoever
   * performed it, and the failed one stays in the ledger. B5 reads the SET of
   * records rather than a single current one.
   *
   * `checker_id` and `finalized_at` are NOT sent —
   * `ck_quality_control_records_finalized` requires both to be NULL while `pending`,
   * and `qms.guard_qc_finalize` stamps them from the session at finalization.
   */
  async openQcRecord(
    db: DbHandle,
    input: {
      readonly workOrderId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly notes: string | null;
    }
  ): Promise<QualityControlRecordRow> {
    const context = this.assertContext(db);
    const result = await this.run<QcRecordColumns>(
      db,
      `INSERT INTO qms.quality_control_records
         (tenant_id, company_id, branch_id, work_order_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${QC_RECORD_COLUMNS}`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.notes,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('quality-control record insert returned no row');
    return toQcRecordRow(row);
  }

  /** Locks one QC record, or null when absent or out of scope. */
  async lockQcRecord(db: DbHandle, recordId: string): Promise<QualityControlRecordRow | null> {
    return this.readQcRecord(db, recordId, true);
  }

  /** Reads one QC record without locking, for query paths. */
  async findQcRecord(db: DbHandle, recordId: string): Promise<QualityControlRecordRow | null> {
    return this.readQcRecord(db, recordId, false);
  }

  private async readQcRecord(
    db: DbHandle,
    recordId: string,
    lock: boolean
  ): Promise<QualityControlRecordRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<QcRecordColumns>(
      db,
      `SELECT ${QC_RECORD_COLUMNS}
         FROM qms.quality_control_records
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        ${lock ? 'FOR UPDATE' : ''}`,
      [context.principal.tenantId, recordId]
    );
    const row = result.rows[0];
    return row ? toQcRecordRow(row) : null;
  }

  /** Every live quality-control record on a work order, oldest first. */
  async qcRecordsFor(
    db: DbHandle,
    workOrderId: string
  ): Promise<readonly QualityControlRecordRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<QcRecordColumns>(
      db,
      `SELECT ${QC_RECORD_COLUMNS}
         FROM qms.quality_control_records
        WHERE tenant_id = $1 AND work_order_id = $2 AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map(toQcRecordRow);
  }

  /**
   * Finalizes a record as passed or failed under the caller's record version.
   *
   * `checker_id` and `finalized_at` are NOT sent: `qms.guard_qc_finalize()` stamps
   * both from `iam.current_user_id()` and `now()` on the `pending → passed|failed`
   * edge and then FREEZES all three, so a finalized record can never be re-judged.
   * Sending them would be sending values the database discards.
   */
  async finalizeQcRecord(
    db: DbHandle,
    recordId: string,
    overallResult: string,
    notes: string | null,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE qms.quality_control_records
          SET overall_result = $3, notes = COALESCE($4, notes), updated_by = $5
        WHERE tenant_id = $1 AND id = $2 AND record_version = $6 AND deleted_at IS NULL`,
      [
        context.principal.tenantId,
        recordId,
        overallResult,
        notes,
        context.principal.userId,
        expectedVersion,
      ]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * Records or replaces one check outcome inside a record.
   *
   * `uq_qc_check_results_record_check` is a PARTIAL unique index over live rows, so
   * the conflict target is inferred by column list AND predicate. Replacement is
   * legitimate while the record is still `pending` — a checker correcting a mis-click
   * should not need a new record — and the service refuses it once finalized, which
   * `qms.guard_qc_finalize` enforces for the RECORD but not for its children.
   */
  async writeCheckResult(
    db: DbHandle,
    input: {
      readonly recordId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly qcCheckId: string;
      readonly result: string;
      readonly note: string | null;
    }
  ): Promise<QcCheckResultRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      qc_check_id: string;
      check_code: string;
      result: string;
      note: string | null;
      record_version: number;
    }>(
      db,
      `WITH upserted AS (
         INSERT INTO qms.qc_check_results
           (tenant_id, company_id, branch_id, quality_control_record_id, qc_check_id,
            result, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, company_id, branch_id, quality_control_record_id, qc_check_id)
           WHERE deleted_at IS NULL
         DO UPDATE SET result = $6, note = $7, updated_by = $8
         RETURNING id, qc_check_id, result, note, record_version
       )
       SELECT u.id, u.qc_check_id, c.code AS check_code, u.result, u.note, u.record_version
         FROM upserted u
         JOIN qms.qc_checks c ON c.id = u.qc_check_id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.recordId,
        input.qcCheckId,
        input.result,
        input.note,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('qc check result write returned no row');
    return {
      id: row.id,
      qcCheckId: row.qc_check_id,
      checkCode: row.check_code,
      result: row.result,
      note: row.note,
      recordVersion: row.record_version,
    };
  }

  /** Every live check outcome inside a record, by check code. */
  async checkResultsFor(db: DbHandle, recordId: string): Promise<readonly QcCheckResultRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      qc_check_id: string;
      check_code: string;
      result: string;
      note: string | null;
      record_version: number;
    }>(
      db,
      `SELECT r.id, r.qc_check_id, c.code AS check_code, r.result, r.note, r.record_version
         FROM qms.qc_check_results r
         JOIN qms.qc_checks c ON c.id = r.qc_check_id
        WHERE r.tenant_id = $1 AND r.quality_control_record_id = $2 AND r.deleted_at IS NULL
        ORDER BY c.code`,
      [context.principal.tenantId, recordId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      qcCheckId: row.qc_check_id,
      checkCode: row.check_code,
      result: row.result,
      note: row.note,
      recordVersion: row.record_version,
    }));
  }

  /**
   * The sanctioned reopen path: record the rejection, never mutate.
   *
   * `qms.attempt_reopen` is `SECURITY INVOKER`, granted to `app_runtime`, and is the
   * ONLY way a `qms.reopen_attempts` row is written. It raises `no_data_found` when
   * the order is not visible and `check_violation` when it is not closed; both are
   * mapped by the service. `outcome` is CHECK-fixed to `'rejected'`, so the
   * vocabulary has exactly one value — there is no success to record.
   */
  async attemptReopen(db: DbHandle, workOrderId: string, reason: string): Promise<string> {
    const result = await this.run<{ id: string }>(
      db,
      `SELECT qms.attempt_reopen($1::uuid, $2::text) AS id`,
      [workOrderId, reason]
    );
    const id = result.rows[0]?.id;
    if (id === undefined || id === null) throw new Error('attempt_reopen returned no id');
    return id;
  }

  /** Every recorded reopen attempt on a work order, newest first. */
  async reopenAttemptsFor(db: DbHandle, workOrderId: string): Promise<readonly ReopenAttemptRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      work_order_id: string;
      reason: string;
      outcome: string;
      requested_by: string;
      requested_at: Date;
    }>(
      db,
      `SELECT id, work_order_id, reason, outcome, requested_by, requested_at
         FROM qms.reopen_attempts
        WHERE tenant_id = $1 AND work_order_id = $2
        ORDER BY requested_at DESC, id DESC`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      workOrderId: row.work_order_id,
      reason: row.reason,
      outcome: row.outcome,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
    }));
  }

  /**
   * Links a rework work order to the closed original it corrects.
   *
   * `qms.guard_rework_link_coherence` owns the three preconditions and is the
   * authority: the original must be CLOSED, the rework order must have
   * `kind = 'rework'`, and both must share the original's reception visit. All three
   * raise `check_violation`, so the service pre-checks what it can in order to
   * produce distinguishable refusals.
   */
  async createReworkLink(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly originalWorkOrderId: string;
      readonly reworkWorkOrderId: string;
      readonly rootCause: string;
      readonly correctiveAction: string;
      readonly responsibility: string | null;
      readonly leadTechnicianId: string | null;
      readonly isSafetyCritical: boolean;
    }
  ): Promise<ReworkLinkRow> {
    const context = this.assertContext(db);
    const result = await this.run<ReworkColumns>(
      db,
      `INSERT INTO qms.rework_links
         (tenant_id, company_id, branch_id, original_work_order_id, rework_work_order_id,
          root_cause, corrective_action, responsibility, lead_technician_id,
          is_safety_critical, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${REWORK_COLUMNS}`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.originalWorkOrderId,
        input.reworkWorkOrderId,
        input.rootCause,
        input.correctiveAction,
        input.responsibility,
        input.leadTechnicianId,
        input.isSafetyCritical,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('rework link insert returned no row');
    return toReworkRow(row);
  }

  /** Locks one rework link, or null when absent or out of scope. */
  async lockReworkLink(db: DbHandle, linkId: string): Promise<ReworkLinkRow | null> {
    return this.readReworkLink(db, linkId, true);
  }

  /** Reads one rework link without locking. */
  async findReworkLink(db: DbHandle, linkId: string): Promise<ReworkLinkRow | null> {
    return this.readReworkLink(db, linkId, false);
  }

  private async readReworkLink(
    db: DbHandle,
    linkId: string,
    lock: boolean
  ): Promise<ReworkLinkRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<ReworkColumns>(
      db,
      `SELECT ${REWORK_COLUMNS}
         FROM qms.rework_links
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        ${lock ? 'FOR UPDATE' : ''}`,
      [context.principal.tenantId, linkId]
    );
    const row = result.rows[0];
    return row ? toReworkRow(row) : null;
  }

  /** Every rework link whose ORIGINAL is this work order, oldest first. */
  async reworkLinksForOriginal(
    db: DbHandle,
    workOrderId: string
  ): Promise<readonly ReworkLinkRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<ReworkColumns>(
      db,
      `SELECT ${REWORK_COLUMNS}
         FROM qms.rework_links
        WHERE tenant_id = $1 AND original_work_order_id = $2 AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map(toReworkRow);
  }

  /**
   * Records the independent sign-off under the caller's record version.
   *
   * `sign_off_at` is NOT sent: `qms.guard_rework_signoff` stamps it when the sign-off
   * first appears and refuses any later change to `independent_sign_off_by`, so a
   * signature is write-once. The separation itself is
   * `ck_rework_links_signoff_distinct` — a CHECK, not a trigger — and
   * `lead_technician_id` is frozen by `org.guard_immutable_columns`, so the lead
   * cannot be swapped afterwards to make a signature legal.
   */
  async signOffRework(
    db: DbHandle,
    linkId: string,
    signOffBy: string,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE qms.rework_links
          SET independent_sign_off_by = $3, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $5 AND deleted_at IS NULL`,
      [context.principal.tenantId, linkId, signOffBy, context.principal.userId, expectedVersion]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /**
   * Writes the RESTRICTED cost-of-quality figure, creating or replacing it.
   *
   * Same shape and same reason as `wo.additional_work_request_details`: all three
   * policies additionally require `iam.has_permission('iam.sensitive.view')`, so a
   * caller without it is refused by the database as `42501` and by the operation's
   * declared permissions before that. `uq_rework_link_details_link` is a PARTIAL
   * unique index, so the conflict target is inferred by column list AND predicate.
   */
  async writeReworkCost(
    db: DbHandle,
    input: {
      readonly linkId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly reworkCost: string;
      readonly costCurrency: string;
    }
  ): Promise<ReworkCostRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      rework_link_id: string;
      rework_cost: string;
      cost_currency: string;
      classification: string;
      record_version: number;
    }>(
      db,
      `INSERT INTO qms.rework_link_details
         (tenant_id, company_id, branch_id, rework_link_id, rework_cost, cost_currency, created_by)
       VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)
       ON CONFLICT (tenant_id, company_id, branch_id, rework_link_id)
         WHERE deleted_at IS NULL
       DO UPDATE SET rework_cost = $5::numeric, cost_currency = $6, updated_by = $7
       RETURNING id, rework_link_id, rework_cost::text AS rework_cost, cost_currency,
                 classification, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.linkId,
        input.reworkCost,
        input.costCurrency,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('rework cost write returned no row');
    return {
      id: row.id,
      reworkLinkId: row.rework_link_id,
      reworkCost: row.rework_cost,
      costCurrency: row.cost_currency,
      classification: row.classification,
      recordVersion: row.record_version,
    };
  }

  /**
   * The restricted cost, or null.
   *
   * Null covers "no cost was recorded" and "you do not hold `iam.sensitive.view`"
   * alike, because the SELECT policy hides the row rather than erroring. The
   * operation that reaches this declares the permission, so a caller who gets here
   * holds it and null genuinely means no cost was recorded.
   */
  async reworkCostFor(db: DbHandle, linkId: string): Promise<ReworkCostRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      rework_link_id: string;
      rework_cost: string;
      cost_currency: string;
      classification: string;
      record_version: number;
    }>(
      db,
      `SELECT id, rework_link_id, rework_cost::text AS rework_cost, cost_currency,
              classification, record_version
         FROM qms.rework_link_details
        WHERE tenant_id = $1 AND rework_link_id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, linkId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          reworkLinkId: row.rework_link_id,
          reworkCost: row.rework_cost,
          costCurrency: row.cost_currency,
          classification: row.classification,
          recordVersion: row.record_version,
        }
      : null;
  }
}
