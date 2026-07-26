/**
 * Diagnostic template and report reads (Phase 1-19, P1-19-BE-001).
 *
 * The only place `dia` SQL is written. Wave 7 adds the entry and completion
 * writes on top of these reads.
 *
 * The completion gate is the interesting read: `outstandingMandatoryItems` asks
 * the same question `dia.guard_diagnostic_report_transition` asks, but returns the
 * rows instead of raising on the first one. Both consult the SAME pinned
 * `template_version_id` on the report — never the template's current version —
 * which is what makes a completed report reproducible after the template moves on.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { buildPage, keysetFragment, type Page, type PageRequest } from '@/server/db/pagination';
import type { OutstandingItem, ResponseType } from '../domain/diagnostics';

export interface TemplateVersionRow {
  readonly id: string;
  readonly templateId: string;
  readonly versionNumber: number;
  readonly status: string;
  readonly publishedAt: Date | null;
  /** Joined from the template, so a report's type cannot disagree with what it pins. */
  readonly diagnosticTypeId: string;
}

export interface TemplateItemRow {
  readonly id: string;
  readonly itemCode: string;
  readonly prompt: string;
  readonly responseType: ResponseType;
  readonly unit: string | null;
  readonly isMandatory: boolean;
  /** `jsonb`. pg-types parses OID 3802 with JSON.parse, so this is never a string. */
  readonly validationRule: unknown;
  readonly sequence: number;
}

export interface DiagnosticReportRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly jobId: string;
  readonly templateVersionId: string;
  readonly diagnosticTypeId: string;
  readonly status: string;
  readonly revisionNumber: number;
  readonly recordVersion: number;
  /**
   * Who created the report. Read because reviewer separation compares against it —
   * `dia.diagnostic_reviews` has no constraint that could, and this column is the
   * only authorship the schema records at report level.
   */
  readonly createdBy: string;
  readonly summary: string | null;
  readonly createdAt: Date;
}

/** One answer to a template item: a value, or a documented not-applicable reason. */
export interface ItemResultRow {
  readonly id: string;
  readonly templateItemId: string;
  readonly itemCode: string;
  readonly resultValue: string | null;
  readonly notApplicableReason: string | null;
  readonly recordVersion: number;
}

/**
 * One numeric reading.
 *
 * `measuredValue` is a STRING because the column is bare `numeric` — no precision,
 * no scale — and IEEE-754 cannot represent every value it holds.
 *
 * `withinRange` is NULL when the item carried no configured range, never `false`:
 * `false` would assert an out-of-spec reading that nobody checked.
 */
export interface MeasurementRow {
  readonly id: string;
  readonly templateItemId: string | null;
  readonly label: string;
  readonly measuredValue: string;
  readonly unit: string;
  readonly withinRange: boolean | null;
  readonly recordVersion: number;
}

export interface DtcRow {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
  readonly dtcStatus: string;
  readonly recordVersion: number;
}

export interface FindingRow {
  readonly id: string;
  readonly templateItemId: string | null;
  readonly severity: string;
  readonly disposition: string;
  readonly description: string;
  readonly recordVersion: number;
}

export interface DiagnosticEvidenceRow {
  readonly id: string;
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface RecommendationRow {
  readonly id: string;
  readonly recommendation: string;
  readonly priority: string;
  readonly recordVersion: number;
}

/** One append-only review. `reviewerId` and `reviewedAt` are server-stamped. */
export interface DiagnosticReviewRow {
  readonly id: string;
  readonly reviewResult: string;
  readonly notes: string | null;
  readonly reviewerId: string;
  readonly reviewedAt: Date;
}

export interface ReportHistoryRow {
  readonly id: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly reason: string | null;
  readonly occurredAt: Date;
  readonly actorId: string | null;
}

/** Ordering contract for a report's status ledger. Newest transition first. */
export const REPORT_HISTORY_ORDER = Object.freeze({
  key: 'dia.diagnostic_report_status_history:occurred_at_desc',
  direction: 'desc' as const,
});

interface ReportColumns {
  id: string;
  company_id: string;
  branch_id: string;
  work_order_id: string;
  job_id: string;
  template_version_id: string;
  diagnostic_type_id: string;
  status: string;
  revision_number: number;
  record_version: number;
  created_by: string;
  summary: string | null;
  created_at: Date;
}

/** Projection shared by every report read, and by the insert's RETURNING. */
const REPORT_COLUMNS = `id, company_id, branch_id, work_order_id, job_id, template_version_id,
          diagnostic_type_id, status, revision_number, record_version, created_by, summary,
          created_at`;

const toReportRow = (row: ReportColumns): DiagnosticReportRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  workOrderId: row.work_order_id,
  jobId: row.job_id,
  templateVersionId: row.template_version_id,
  diagnosticTypeId: row.diagnostic_type_id,
  status: row.status,
  revisionNumber: row.revision_number,
  recordVersion: row.record_version,
  createdBy: row.created_by,
  summary: row.summary,
  createdAt: row.created_at,
});

/**
 * Where a diagnostic finding came from, resolved through its report.
 *
 * `dia.findings` carries no work-order column — it points at a report, and
 * `dia.diagnostic_reports.work_order_id` and `.job_id` are both NOT NULL — so this
 * is a join, not a projection, and it is exact rather than approximate.
 */
export interface FindingOrigin {
  readonly findingId: string;
  readonly diagnosticReportId: string;
  readonly workOrderId: string;
  readonly jobId: string;
  readonly companyId: string;
  readonly branchId: string;
}

export class DiagnosticsRepository extends Repository {
  protected readonly module = 'diagnostics';

  /**
   * Resolves one finding to the work order and job it was discovered on.
   *
   * Exists because `wo.additional_work_requests.originating_finding_id` has NO
   * foreign key — the Phase 1-9 comment calls it an opaque soft link — so the only
   * thing that can refuse a finding belonging to another work order is a read, and
   * that read must happen in the module that owns `dia`. Returns null for absent and
   * out-of-scope alike; the caller decides what to disclose.
   */
  async findingOrigin(db: DbHandle, findingId: string): Promise<FindingOrigin | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      diagnostic_report_id: string;
      work_order_id: string;
      job_id: string;
      company_id: string;
      branch_id: string;
    }>(
      db,
      `SELECT f.id, f.diagnostic_report_id, r.work_order_id, r.job_id,
              f.company_id, f.branch_id
         FROM dia.findings f
         JOIN dia.diagnostic_reports r
           ON r.tenant_id = f.tenant_id AND r.company_id = f.company_id
          AND r.branch_id = f.branch_id AND r.id = f.diagnostic_report_id
        WHERE f.tenant_id = $1 AND f.id = $2
          AND f.deleted_at IS NULL AND r.deleted_at IS NULL`,
      [context.principal.tenantId, findingId]
    );
    const row = result.rows[0];
    return row
      ? {
          findingId: row.id,
          diagnosticReportId: row.diagnostic_report_id,
          workOrderId: row.work_order_id,
          jobId: row.job_id,
          companyId: row.company_id,
          branchId: row.branch_id,
        }
      : null;
  }

  /** A template version by id, or null when absent or out of scope. */
  async templateVersion(db: DbHandle, versionId: string): Promise<TemplateVersionRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_id: string;
      version_number: number;
      diagnostic_type_id: string;
      status: string;
      published_at: Date | null;
    }>(
      db,
      // The diagnostic type is joined from the TEMPLATE rather than taken from the
      // caller, so a report's type can never disagree with the template it pins.
      // `dia.diagnostic_reports.diagnostic_type_id` is NOT NULL and foreign-keyed,
      // but nothing makes it agree with the template's — accepting it from a request
      // body would have made that a caller's choice.
      `SELECT v.id, v.template_id, v.version_number, v.status, v.published_at,
              t.diagnostic_type_id
         FROM dia.template_versions v
         JOIN dia.inspection_templates t
           ON t.tenant_id = v.tenant_id AND t.id = v.template_id AND t.deleted_at IS NULL
        WHERE v.tenant_id = $1 AND v.id = $2 AND v.deleted_at IS NULL`,
      [context.principal.tenantId, versionId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          templateId: row.template_id,
          versionNumber: row.version_number,
          status: row.status,
          publishedAt: row.published_at,
          diagnosticTypeId: row.diagnostic_type_id,
        }
      : null;
  }

  /** Every item of a pinned template version, in presentation order. */
  async templateItems(db: DbHandle, versionId: string): Promise<readonly TemplateItemRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      item_code: string;
      prompt: string;
      response_type: string;
      unit: string | null;
      is_mandatory: boolean;
      validation_rule: unknown;
      sequence: number;
    }>(
      db,
      `SELECT id, item_code, prompt, response_type, unit, is_mandatory, validation_rule, sequence
         FROM dia.template_items
        WHERE tenant_id = $1 AND template_version_id = $2 AND deleted_at IS NULL
        ORDER BY sequence, item_code`,
      [context.principal.tenantId, versionId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      itemCode: row.item_code,
      prompt: row.prompt,
      responseType: row.response_type as ResponseType,
      unit: row.unit,
      isMandatory: row.is_mandatory,
      validationRule: row.validation_rule,
      sequence: row.sequence,
    }));
  }

  /** Locks a diagnostic report and returns it, or null when absent/out of scope. */
  async lockReport(db: DbHandle, reportId: string): Promise<DiagnosticReportRow | null> {
    return this.readReport(db, reportId, true);
  }

  /** Reads a report without locking, for query paths. */
  async findReport(db: DbHandle, reportId: string): Promise<DiagnosticReportRow | null> {
    return this.readReport(db, reportId, false);
  }

  private async readReport(
    db: DbHandle,
    reportId: string,
    lock: boolean
  ): Promise<DiagnosticReportRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<ReportColumns>(
      db,
      `SELECT ${REPORT_COLUMNS}
         FROM dia.diagnostic_reports
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        ${lock ? 'FOR UPDATE' : ''}`,
      [context.principal.tenantId, reportId]
    );
    const row = result.rows[0];
    return row ? toReportRow(row) : null;
  }

  /**
   * The next revision number for a job's reports.
   *
   * ## The advisory lock is the ONLY protection, and that is the honest statement
   *
   * `dia.diagnostic_reports.revision_number` carries only `CHECK (> 0)`. There is no
   * unique index on `(job_id, revision_number)` anywhere in the schema, so two
   * concurrent creations would both compute `max + 1` and BOTH be accepted.
   *
   * `pg_advisory_xact_lock` is the platform's established answer to this shape —
   * `shared-services/data/document-repository.ts` uses exactly it for document
   * version numbers — and it needs no table privilege, is scoped to this
   * transaction, and is released by COMMIT or ROLLBACK. But that file can add
   * "the advisory lock makes a collision rare, and the constraint makes one
   * impossible", and this one cannot: there is no constraint behind it. Recorded as
   * accepted item `P1-19-A-02`; a partial unique index would close it and no
   * migration is authorised in this phase.
   *
   * Soft-deleted reports are INCLUDED in the maximum deliberately. A revision number
   * that was once issued must not be re-issued, or two reports in the ledger would
   * claim to be the same revision of the same job.
   */
  async nextRevisionNumber(db: DbHandle, jobId: string): Promise<number> {
    const context = this.assertContext(db);
    await this.run(
      db,
      `SELECT pg_advisory_xact_lock(
                hashtextextended('dia.diagnostic_reports:' || $1::text || ':' || $2::text, 0))`,
      [context.principal.tenantId, jobId]
    );
    const result = await this.run<{ next: string }>(
      db,
      `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next
         FROM dia.diagnostic_reports
        WHERE tenant_id = $1 AND job_id = $2`,
      [context.principal.tenantId, jobId]
    );
    return Number(result.rows[0]?.next ?? 1);
  }

  /**
   * Creates a diagnostic report pinning an exact template version.
   *
   * `dia.guard_diagnostic_report_refs` owns the two preconditions and is the
   * authority: the job must belong to the work order, and the pinned version must be
   * `published`. Both raise `check_violation`, so the service pre-checks them to
   * produce two distinguishable refusals rather than one opaque 409.
   */
  async createReport(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly workOrderId: string;
      readonly jobId: string;
      readonly templateVersionId: string;
      readonly diagnosticTypeId: string;
      readonly revisionNumber: number;
    }
  ): Promise<DiagnosticReportRow> {
    const context = this.assertContext(db);
    const result = await this.run<ReportColumns>(
      db,
      `INSERT INTO dia.diagnostic_reports
         (tenant_id, company_id, branch_id, work_order_id, job_id, template_version_id,
          diagnostic_type_id, revision_number, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${REPORT_COLUMNS}`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.workOrderId,
        input.jobId,
        input.templateVersionId,
        input.diagnosticTypeId,
        input.revisionNumber,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('diagnostic report insert returned no row');
    return toReportRow(row);
  }

  /**
   * Moves a report's status under the caller's record version.
   *
   * Same GUC contract as the `wo` graphs: `dia.emit_diagnostic_report_status_history`
   * reads `NULLIF(btrim(current_setting('app.status_reason', true)), '')` and copies
   * it into the ledger row, so a reason that is validated in TypeScript but never
   * published here would leave every ledger reason NULL.
   *
   * `dia.guard_diagnostic_report_transition` re-checks the edge AND the completion
   * gate inside this same statement, which is what makes the pre-report a report
   * rather than the enforcement.
   */
  async applyReportStatus(
    db: DbHandle,
    reportId: string,
    toStatus: string,
    reason: string | null,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    await this.run(db, 'SELECT set_config($1, $2, true)', ['app.status_reason', reason ?? '']);
    const result = await this.run(
      db,
      `UPDATE dia.diagnostic_reports
          SET status = $3, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $5 AND deleted_at IS NULL`,
      [context.principal.tenantId, reportId, toStatus, context.principal.userId, expectedVersion]
    );
    await this.run(db, 'SELECT set_config($1, $2, true)', ['app.status_reason', '']);
    return (result.rowCount ?? 0) === 1;
  }

  /** Writes the report's own free-text summary, under the caller's version. */
  async applyReportSummary(
    db: DbHandle,
    reportId: string,
    summary: string | null,
    expectedVersion: number
  ): Promise<boolean> {
    const context = this.assertContext(db);
    const result = await this.run(
      db,
      `UPDATE dia.diagnostic_reports
          SET summary = $3, updated_by = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $5 AND deleted_at IS NULL`,
      [context.principal.tenantId, reportId, summary, context.principal.userId, expectedVersion]
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** Every live report on one job, newest revision first. */
  async reportsForJob(db: DbHandle, jobId: string): Promise<readonly DiagnosticReportRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<ReportColumns>(
      db,
      `SELECT ${REPORT_COLUMNS}
         FROM dia.diagnostic_reports
        WHERE tenant_id = $1 AND job_id = $2 AND deleted_at IS NULL
        ORDER BY revision_number DESC, id DESC`,
      [context.principal.tenantId, jobId]
    );
    return result.rows.map(toReportRow);
  }

  /** One keyset page of a report's append-only status ledger, newest first. */
  async historyPage(
    db: DbHandle,
    reportId: string,
    page: PageRequest
  ): Promise<Page<ReportHistoryRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [context.principal.tenantId, reportId];
    const keyset = keysetFragment(
      page,
      { sort: 'occurred_at', id: 'id' },
      REPORT_HISTORY_ORDER,
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
         FROM dia.diagnostic_report_status_history
        WHERE tenant_id = $1 AND diagnostic_report_id = $2
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows: ReportHistoryRow[] = result.rows.map((row) => ({
      id: row.id,
      fromState: row.from_state,
      toState: row.to_state,
      reason: row.reason,
      occurredAt: row.occurred_at,
      actorId: row.actor_id,
    }));
    return buildPage(rows, page, REPORT_HISTORY_ORDER, (row) => ({
      sortValue: row.occurredAt.toISOString(),
      id: row.id,
    }));
  }

  /**
   * The oldest ledger entry's origin status, or null while the ledger is empty.
   *
   * Same shape and same reason as the work-order and job histories:
   * `dia.emit_diagnostic_report_status_history` is AFTER UPDATE only, so creating a
   * report emits nothing, and `shared.stamp_status_history` forces
   * `occurred_at := now()` — a backfilled genesis row would carry a time the report
   * was not created at.
   */
  async initialStatus(db: DbHandle, reportId: string): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ from_state: string | null }>(
      db,
      `SELECT from_state FROM dia.diagnostic_report_status_history
        WHERE tenant_id = $1 AND diagnostic_report_id = $2
        ORDER BY occurred_at, seq LIMIT 1`,
      [context.principal.tenantId, reportId]
    );
    return result.rows[0]?.from_state ?? null;
  }

  /** One template item of the report's PINNED version, by id, or null. */
  async pinnedItem(
    db: DbHandle,
    reportId: string,
    templateItemId: string
  ): Promise<TemplateItemRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      item_code: string;
      prompt: string;
      response_type: string;
      unit: string | null;
      is_mandatory: boolean;
      validation_rule: unknown;
      sequence: number;
    }>(
      db,
      // Joined through the REPORT's pinned version, so an item belonging to another
      // template — or to a newer version of the same one — is not visible here. The
      // foreign key alone would accept it: `fk_report_item_results_item` is
      // `(tenant_id, template_item_id)` and names no version.
      `SELECT ti.id, ti.item_code, ti.prompt, ti.response_type, ti.unit, ti.is_mandatory,
              ti.validation_rule, ti.sequence
         FROM dia.diagnostic_reports r
         JOIN dia.template_items ti
           ON ti.tenant_id = r.tenant_id AND ti.template_version_id = r.template_version_id
          AND ti.deleted_at IS NULL
        WHERE r.tenant_id = $1 AND r.id = $2 AND r.deleted_at IS NULL AND ti.id = $3`,
      [context.principal.tenantId, reportId, templateItemId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          itemCode: row.item_code,
          prompt: row.prompt,
          responseType: row.response_type as ResponseType,
          unit: row.unit,
          isMandatory: row.is_mandatory,
          validationRule: row.validation_rule,
          sequence: row.sequence,
        }
      : null;
  }

  /**
   * Records or replaces the answer to one template item.
   *
   * `uq_report_item_results_report_item` is a PARTIAL unique index over live rows, so
   * the conflict target is inferred by column list AND predicate. Replacement is
   * legitimate while the report is still recordable — a technician correcting a
   * mistyped reading should not need a new report — and the service refuses it once
   * the report is completed, which the database does not.
   */
  async writeItemResult(
    db: DbHandle,
    input: {
      readonly reportId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly templateItemId: string;
      readonly resultValue: string | null;
      readonly notApplicableReason: string | null;
    }
  ): Promise<ItemResultRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_item_id: string;
      item_code: string;
      result_value: string | null;
      not_applicable_reason: string | null;
      record_version: number;
    }>(
      db,
      `WITH upserted AS (
         INSERT INTO dia.report_item_results
           (tenant_id, company_id, branch_id, diagnostic_report_id, template_item_id,
            result_value, not_applicable_reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, company_id, branch_id, diagnostic_report_id, template_item_id)
           WHERE deleted_at IS NULL
         DO UPDATE SET result_value = $6, not_applicable_reason = $7, updated_by = $8
         RETURNING id, template_item_id, result_value, not_applicable_reason, record_version
       )
       SELECT u.id, u.template_item_id, ti.item_code, u.result_value,
              u.not_applicable_reason, u.record_version
         FROM upserted u
         JOIN dia.template_items ti ON ti.tenant_id = $1 AND ti.id = u.template_item_id`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.reportId,
        input.templateItemId,
        input.resultValue,
        input.notApplicableReason,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('item result write returned no row');
    return {
      id: row.id,
      templateItemId: row.template_item_id,
      itemCode: row.item_code,
      resultValue: row.result_value,
      notApplicableReason: row.not_applicable_reason,
      recordVersion: row.record_version,
    };
  }

  /** Every live result on a report, in the pinned version's presentation order. */
  async itemResultsFor(db: DbHandle, reportId: string): Promise<readonly ItemResultRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_item_id: string;
      item_code: string;
      result_value: string | null;
      not_applicable_reason: string | null;
      record_version: number;
    }>(
      db,
      `SELECT rr.id, rr.template_item_id, ti.item_code, rr.result_value,
              rr.not_applicable_reason, rr.record_version
         FROM dia.report_item_results rr
         JOIN dia.template_items ti ON ti.tenant_id = rr.tenant_id AND ti.id = rr.template_item_id
        WHERE rr.tenant_id = $1 AND rr.diagnostic_report_id = $2 AND rr.deleted_at IS NULL
        ORDER BY ti.sequence, ti.item_code`,
      [context.principal.tenantId, reportId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      templateItemId: row.template_item_id,
      itemCode: row.item_code,
      resultValue: row.result_value,
      notApplicableReason: row.not_applicable_reason,
      recordVersion: row.record_version,
    }));
  }

  /**
   * Records one numeric reading, computing `within_range` IN THE DATABASE.
   *
   * The comparison happens in SQL as `numeric`, never in JavaScript, because
   * `measured_value` is bare `numeric` and IEEE-754 cannot represent every value it
   * holds — a bound of `0.1` compared in a double would misjudge readings the column
   * stores exactly. The bounds come from the pinned item's `validation_rule` jsonb,
   * read with `->>` and cast, so a JSON number and a decimal string both work.
   *
   * `within_range` stays NULL when the item names no range, or when no item is named
   * at all. `false` would assert an out-of-spec reading that nobody checked.
   *
   * An out-of-range reading is RECORDED, not refused. A diagnostic exists to record
   * what is wrong with a vehicle; refusing the observation would make the worst cases
   * unreportable.
   */
  async recordMeasurement(
    db: DbHandle,
    input: {
      readonly reportId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly templateItemId: string | null;
      readonly label: string;
      readonly measuredValue: string;
      readonly unit: string;
    }
  ): Promise<MeasurementRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_item_id: string | null;
      label: string;
      measured_value: string;
      unit: string;
      within_range: boolean | null;
      record_version: number;
    }>(
      db,
      `INSERT INTO dia.measurements
         (tenant_id, company_id, branch_id, diagnostic_report_id, template_item_id,
          label, measured_value, unit, within_range, created_by)
       SELECT $1, $2, $3, $4, $5, $6, $7::numeric, $8,
              CASE
                WHEN ti.id IS NULL THEN NULL
                WHEN (ti.validation_rule ? 'min') OR (ti.validation_rule ? 'max') THEN
                  ($7::numeric >= COALESCE((ti.validation_rule ->> 'min')::numeric, '-Infinity'::numeric))
                  AND ($7::numeric <= COALESCE((ti.validation_rule ->> 'max')::numeric, 'Infinity'::numeric))
                ELSE NULL
              END,
              $9
         FROM (SELECT 1) AS anchor
         LEFT JOIN dia.template_items ti
           ON ti.tenant_id = $1 AND ti.id = $5 AND ti.deleted_at IS NULL
       RETURNING id, template_item_id, label, measured_value::text AS measured_value, unit,
                 within_range, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.reportId,
        input.templateItemId,
        input.label,
        input.measuredValue,
        input.unit,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('measurement insert returned no row');
    return {
      id: row.id,
      templateItemId: row.template_item_id,
      label: row.label,
      measuredValue: row.measured_value,
      unit: row.unit,
      withinRange: row.within_range,
      recordVersion: row.record_version,
    };
  }

  /** Every live measurement on a report, oldest first. */
  async measurementsFor(db: DbHandle, reportId: string): Promise<readonly MeasurementRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_item_id: string | null;
      label: string;
      measured_value: string;
      unit: string;
      within_range: boolean | null;
      record_version: number;
    }>(
      db,
      `SELECT id, template_item_id, label, measured_value::text AS measured_value, unit,
              within_range, record_version
         FROM dia.measurements
        WHERE tenant_id = $1 AND diagnostic_report_id = $2 AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [context.principal.tenantId, reportId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      templateItemId: row.template_item_id,
      label: row.label,
      measuredValue: row.measured_value,
      unit: row.unit,
      withinRange: row.within_range,
      recordVersion: row.record_version,
    }));
  }

  /** Records one diagnostic trouble code. */
  async recordDtc(
    db: DbHandle,
    input: {
      readonly reportId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly code: string;
      readonly description: string | null;
      readonly dtcStatus: string;
    }
  ): Promise<DtcRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      code: string;
      description: string | null;
      dtc_status: string;
      record_version: number;
    }>(
      db,
      `INSERT INTO dia.dtc_records
         (tenant_id, company_id, branch_id, diagnostic_report_id, code, description,
          dtc_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, code, description, dtc_status, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.reportId,
        input.code,
        input.description,
        input.dtcStatus,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('dtc insert returned no row');
    return {
      id: row.id,
      code: row.code,
      description: row.description,
      dtcStatus: row.dtc_status,
      recordVersion: row.record_version,
    };
  }

  /** Every live DTC on a report, oldest first. */
  async dtcsFor(db: DbHandle, reportId: string): Promise<readonly DtcRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      code: string;
      description: string | null;
      dtc_status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, code, description, dtc_status, record_version
         FROM dia.dtc_records
        WHERE tenant_id = $1 AND diagnostic_report_id = $2 AND deleted_at IS NULL
        ORDER BY created_at, id`,
      [context.principal.tenantId, reportId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      description: row.description,
      dtcStatus: row.dtc_status,
      recordVersion: row.record_version,
    }));
  }

  /** Records one finding. */
  async recordFinding(
    db: DbHandle,
    input: {
      readonly reportId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly templateItemId: string | null;
      readonly severity: string;
      readonly disposition: string;
      readonly description: string;
    }
  ): Promise<FindingRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_item_id: string | null;
      severity: string;
      disposition: string;
      description: string;
      record_version: number;
    }>(
      db,
      `INSERT INTO dia.findings
         (tenant_id, company_id, branch_id, diagnostic_report_id, template_item_id,
          severity, disposition, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, template_item_id, severity, disposition, description, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.reportId,
        input.templateItemId,
        input.severity,
        input.disposition,
        input.description,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('finding insert returned no row');
    return {
      id: row.id,
      templateItemId: row.template_item_id,
      severity: row.severity,
      disposition: row.disposition,
      description: row.description,
      recordVersion: row.record_version,
    };
  }

  /** Every live finding on a report, most severe first. */
  async findingsFor(db: DbHandle, reportId: string): Promise<readonly FindingRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_item_id: string | null;
      severity: string;
      disposition: string;
      description: string;
      record_version: number;
    }>(
      db,
      // Ordered by severity rank rather than alphabetically, because 'critical' sorts
      // before 'info' by accident and after it by meaning. The CASE mirrors
      // FINDING_SEVERITIES, and the reconciliation test pins the vocabulary.
      `SELECT id, template_item_id, severity, disposition, description, record_version
         FROM dia.findings
        WHERE tenant_id = $1 AND diagnostic_report_id = $2 AND deleted_at IS NULL
        ORDER BY CASE severity
                   WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
                   WHEN 'low' THEN 3 WHEN 'info' THEN 4 ELSE 5 END,
                 created_at, id`,
      [context.principal.tenantId, reportId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      templateItemId: row.template_item_id,
      severity: row.severity,
      disposition: row.disposition,
      description: row.description,
      recordVersion: row.record_version,
    }));
  }

  /**
   * Binds one exact document version to a report as evidence.
   *
   * `dia.diagnostic_evidence` is append-only — `app_runtime` holds SELECT and INSERT
   * and nothing else — and the FK is `(tenant_id, document_version_id)`, so an
   * unknown or foreign-tenant version is `23503`. No storage key appears in the
   * table, in this method, or in the route that reaches it. Identical contract to
   * `wo.customer_approval_evidence`.
   */
  async recordEvidence(
    db: DbHandle,
    input: {
      readonly reportId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly documentVersionId: string;
      readonly evidenceType: string;
      readonly note: string | null;
    }
  ): Promise<DiagnosticEvidenceRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      document_version_id: string;
      evidence_type: string;
      note: string | null;
      created_at: Date;
    }>(
      db,
      `INSERT INTO dia.diagnostic_evidence
         (tenant_id, company_id, branch_id, diagnostic_report_id, document_version_id,
          evidence_type, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, document_version_id, evidence_type, note, created_at`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.reportId,
        input.documentVersionId,
        input.evidenceType,
        input.note,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('diagnostic evidence insert returned no row');
    return {
      id: row.id,
      documentVersionId: row.document_version_id,
      evidenceType: row.evidence_type,
      note: row.note,
      createdAt: row.created_at,
    };
  }

  /** Every evidence row bound to a report, oldest first. */
  async evidenceFor(db: DbHandle, reportId: string): Promise<readonly DiagnosticEvidenceRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      document_version_id: string;
      evidence_type: string;
      note: string | null;
      created_at: Date;
    }>(
      db,
      `SELECT id, document_version_id, evidence_type, note, created_at
         FROM dia.diagnostic_evidence
        WHERE tenant_id = $1 AND diagnostic_report_id = $2
        ORDER BY created_at, id`,
      [context.principal.tenantId, reportId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      documentVersionId: row.document_version_id,
      evidenceType: row.evidence_type,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  /**
   * Records one recommendation.
   *
   * `dia.recommendations` carries ONLY `diagnostic_report_id` — there is no
   * `finding_id` column anywhere in the schema — so a recommendation cannot be
   * linked to the finding that prompted it. Recorded as a reconciliation rather than
   * worked around: the provenance chain the schema DOES support is
   * finding → additional work, through
   * `wo.additional_work_requests.originating_finding_id`.
   */
  async recordRecommendation(
    db: DbHandle,
    input: {
      readonly reportId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly recommendation: string;
      readonly priority: string;
    }
  ): Promise<RecommendationRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      recommendation: string;
      priority: string;
      record_version: number;
    }>(
      db,
      `INSERT INTO dia.recommendations
         (tenant_id, company_id, branch_id, diagnostic_report_id, recommendation, priority, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, recommendation, priority, record_version`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.reportId,
        input.recommendation,
        input.priority,
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('recommendation insert returned no row');
    return {
      id: row.id,
      recommendation: row.recommendation,
      priority: row.priority,
      recordVersion: row.record_version,
    };
  }

  /** Every live recommendation on a report, highest priority first. */
  async recommendationsFor(db: DbHandle, reportId: string): Promise<readonly RecommendationRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      recommendation: string;
      priority: string;
      record_version: number;
    }>(
      db,
      `SELECT id, recommendation, priority, record_version
         FROM dia.recommendations
        WHERE tenant_id = $1 AND diagnostic_report_id = $2 AND deleted_at IS NULL
        ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
                 created_at, id`,
      [context.principal.tenantId, reportId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      recommendation: row.recommendation,
      priority: row.priority,
      recordVersion: row.record_version,
    }));
  }

  /**
   * Records one review.
   *
   * `reviewer_id` and `reviewed_at` are NOT sent: `dia.stamp_review()` overwrites
   * both on every insert from `iam.current_user_id()` and `now()`, and raises when
   * the session carries no actor. Sending them would be sending values the database
   * discards, which reads as though the caller chose them.
   */
  async recordReview(
    db: DbHandle,
    input: {
      readonly reportId: string;
      readonly companyId: string;
      readonly branchId: string;
      readonly reviewResult: string;
      readonly notes: string | null;
    }
  ): Promise<DiagnosticReviewRow> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      review_result: string;
      notes: string | null;
      reviewer_id: string;
      reviewed_at: Date;
    }>(
      db,
      `INSERT INTO dia.diagnostic_reviews
         (tenant_id, company_id, branch_id, diagnostic_report_id, review_result, notes, reviewer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, review_result, notes, reviewer_id, reviewed_at`,
      [
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.reportId,
        input.reviewResult,
        input.notes,
        // Sent only because the column is NOT NULL and the BEFORE trigger runs after
        // the value is supplied; the trigger overwrites it with the session actor, so
        // this can never be a caller-chosen identity.
        context.principal.userId,
      ]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('diagnostic review insert returned no row');
    return {
      id: row.id,
      reviewResult: row.review_result,
      notes: row.notes,
      reviewerId: row.reviewer_id,
      reviewedAt: row.reviewed_at,
    };
  }

  /** Every review of a report, newest first. Append-only, so this IS the history. */
  async reviewsFor(db: DbHandle, reportId: string): Promise<readonly DiagnosticReviewRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      review_result: string;
      notes: string | null;
      reviewer_id: string;
      reviewed_at: Date;
    }>(
      db,
      `SELECT id, review_result, notes, reviewer_id, reviewed_at
         FROM dia.diagnostic_reviews
        WHERE tenant_id = $1 AND diagnostic_report_id = $2
        ORDER BY reviewed_at DESC, id DESC`,
      [context.principal.tenantId, reportId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      reviewResult: row.review_result,
      notes: row.notes,
      reviewerId: row.reviewer_id,
      reviewedAt: row.reviewed_at,
    }));
  }

  /** The resolved diagnostic-type id for a code, tenant rows shadowing platform. */
  async diagnosticTypeByCode(db: DbHandle, code: string): Promise<string | null> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string }>(
      db,
      `SELECT * FROM (
                SELECT DISTINCT ON (code) id, code, status
                  FROM dia.diagnostic_types
                 WHERE (scope = 'platform' OR tenant_id = $1)
                   AND deleted_at IS NULL
                 ORDER BY code, (scope = 'tenant') DESC
              ) resolved
        WHERE status = 'active' AND code = $2`,
      [context.principal.tenantId, code]
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Mandatory items of the report's pinned version that have no result row.
   *
   * `dia.report_item_results` is the results ledger. An item counts as resolved
   * when a result row exists for it — the not-applicable case is a result row
   * carrying its reason, not an absent row, which is why a single `NOT EXISTS`
   * answers both.
   *
   * The join goes through the REPORT's `template_version_id`, so a template that
   * has since published a new version cannot change what this report owes.
   */
  async outstandingMandatoryItems(
    db: DbHandle,
    reportId: string
  ): Promise<readonly OutstandingItem[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      item_code: string;
      prompt: string;
      response_type: string;
    }>(
      db,
      `SELECT ti.item_code, ti.prompt, ti.response_type
         FROM dia.diagnostic_reports r
         JOIN dia.template_items ti
           ON ti.tenant_id = r.tenant_id
          AND ti.template_version_id = r.template_version_id
          AND ti.deleted_at IS NULL
        WHERE r.tenant_id = $1 AND r.id = $2 AND r.deleted_at IS NULL
          AND ti.is_mandatory
          AND NOT EXISTS (
            SELECT 1 FROM dia.report_item_results rr
             WHERE rr.tenant_id = r.tenant_id
               AND rr.diagnostic_report_id = r.id
               AND rr.template_item_id = ti.id
               AND rr.deleted_at IS NULL)
        ORDER BY ti.sequence, ti.item_code`,
      [context.principal.tenantId, reportId]
    );
    return result.rows.map((row) => ({
      itemCode: row.item_code,
      prompt: row.prompt,
      responseType: row.response_type as ResponseType,
    }));
  }
}
