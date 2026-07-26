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
import type { OutstandingItem, ResponseType } from '../domain/diagnostics';

export interface TemplateVersionRow {
  readonly id: string;
  readonly templateId: string;
  readonly versionNumber: number;
  readonly status: string;
  readonly publishedAt: Date | null;
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
}

export class DiagnosticsRepository extends Repository {
  protected readonly module = 'diagnostics';

  /** A template version by id, or null when absent or out of scope. */
  async templateVersion(db: DbHandle, versionId: string): Promise<TemplateVersionRow | null> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      template_id: string;
      version_number: number;
      status: string;
      published_at: Date | null;
    }>(
      db,
      `SELECT id, template_id, version_number, status, published_at
         FROM dia.template_versions
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
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
    const context = this.assertContext(db);
    const result = await this.run<{
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
    }>(
      db,
      `SELECT id, company_id, branch_id, work_order_id, job_id, template_version_id,
              diagnostic_type_id, status, revision_number, record_version
         FROM dia.diagnostic_reports
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [context.principal.tenantId, reportId]
    );
    const row = result.rows[0];
    return row
      ? {
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
        }
      : null;
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
