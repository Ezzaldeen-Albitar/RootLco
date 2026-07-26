/**
 * Quality and rework gate evaluation (Phase 1-19, P1-19-BE-001).
 *
 * Answers closure blockers B5 and B6 for `work-order`, which may not read `qms.`
 * tables itself. Wave 8 adds the QC and rework write behaviour on top.
 *
 * Nothing here enforces closure. `wo.guard_work_order_closure` is the authority;
 * this reports what it would find, and reports both halves of B5 separately
 * because "quality control failed" and "a mandatory check never ran" are different
 * facts with different remedies.
 */
import type { DbHandle } from '@/server/db/transaction';
import type { QcCheckRow, QualityRepository, ReworkLinkRow } from '../data/quality-repository';

export interface QualityGateStatus {
  /** B5a: a failed record exists and no passing record supersedes it. */
  readonly failedWithoutPass: boolean;
  /** B5b: a mandatory check is configured and no passing record exists. */
  readonly mandatoryPassMissing: boolean;
  /** B6: safety-critical rework on this order lacks independent sign-off. */
  readonly unsignedSafetyCriticalRework: boolean;
}

export class QualityGateService {
  constructor(private readonly repository: QualityRepository) {}

  /** Active QC checks for the caller's tenant. */
  async checks(db: DbHandle): Promise<readonly QcCheckRow[]> {
    return this.repository.qcChecks(db);
  }

  /** Rework links whose rework side is this work order. */
  async reworkLinks(db: DbHandle, workOrderId: string): Promise<readonly ReworkLinkRow[]> {
    return this.repository.reworkLinksForReworkOrder(db, workOrderId);
  }

  /**
   * Evaluates B5 and B6 for one work order.
   *
   * The B5 halves mirror the guard's own two `IF EXISTS` blocks. Note that a
   * passing record clears BOTH halves — the guard treats any `passed` record as
   * superseding an earlier `failed` one, which is what makes a re-check the
   * correct remedy for a failure rather than an edit to the failed record.
   */
  async evaluate(db: DbHandle, workOrderId: string): Promise<QualityGateStatus> {
    const records = await this.repository.recordsFor(db, workOrderId);
    const hasPass = records.some((row) => row.overallResult === 'passed');
    const hasFail = records.some((row) => row.overallResult === 'failed');
    const mandatoryConfigured = await this.repository.mandatoryChecksExist(db);
    const links = await this.repository.reworkLinksForReworkOrder(db, workOrderId);

    return {
      failedWithoutPass: hasFail && !hasPass,
      mandatoryPassMissing: mandatoryConfigured && !hasPass,
      unsignedSafetyCriticalRework: links.some(
        (link) => link.isSafetyCritical && link.independentSignOffBy === null
      ),
    };
  }
}
