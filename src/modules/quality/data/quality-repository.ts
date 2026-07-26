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
  readonly overallResult: string;
  readonly checkerId: string | null;
  readonly finalizedAt: Date | null;
  readonly recordVersion: number;
}

export interface ReworkLinkRow {
  readonly id: string;
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

export class QualityRepository extends Repository {
  protected readonly module = 'quality';

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
    const result = await this.run<{
      id: string;
      work_order_id: string;
      overall_result: string;
      checker_id: string | null;
      finalized_at: Date | null;
      record_version: number;
    }>(
      db,
      `SELECT id, work_order_id, overall_result, checker_id, finalized_at, record_version
         FROM qms.quality_control_records
        WHERE tenant_id = $1 AND work_order_id = $2 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      workOrderId: row.work_order_id,
      overallResult: row.overall_result,
      checkerId: row.checker_id,
      finalizedAt: row.finalized_at,
      recordVersion: row.record_version,
    }));
  }

  /** Rework links whose REWORK side is this work order — the side B6 examines. */
  async reworkLinksForReworkOrder(
    db: DbHandle,
    workOrderId: string
  ): Promise<readonly ReworkLinkRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
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
    }>(
      db,
      `SELECT id, original_work_order_id, rework_work_order_id, root_cause, corrective_action,
              responsibility, lead_technician_id, is_safety_critical, independent_sign_off_by,
              sign_off_at, record_version
         FROM qms.rework_links
        WHERE tenant_id = $1 AND rework_work_order_id = $2 AND deleted_at IS NULL
        ORDER BY created_at`,
      [context.principal.tenantId, workOrderId]
    );
    return result.rows.map((row) => ({
      id: row.id,
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
    }));
  }
}
