/**
 * Diagnostic completion readiness (Phase 1-19, P1-19-BE-001).
 *
 * Two callers, deliberately different in kind:
 *
 *  - Wave 7's completion command calls `assertCompletable` before moving a report
 *    to `completed`, so the caller gets every outstanding item at once instead of
 *    one per attempt.
 *  - Wave 4's closure-eligibility endpoint calls `isCompletedFor` through this
 *    module's public surface to answer blocker B4, because `work-order` may not
 *    read `dia.` tables.
 *
 * Neither enforces. `dia.guard_diagnostic_report_transition` remains the authority
 * for completion, and `wo.guard_work_order_closure` for closure.
 */
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { DiagnosticsRepository, TemplateItemRow } from '../data/diagnostics-repository';
import {
  assertCompletable,
  assertVersionInstantiable,
  type OutstandingItem,
  type TemplateVersionStatus,
} from '../domain/diagnostics';

export class DiagnosticsCompletionService {
  constructor(private readonly repository: DiagnosticsRepository) {}

  /** Every item of a pinned template version, in presentation order. */
  async templateItems(db: DbHandle, versionId: string): Promise<readonly TemplateItemRow[]> {
    return this.repository.templateItems(db, versionId);
  }

  /**
   * Confirms a template version may be instantiated, returning it.
   *
   * Refuses a `draft` version (its items can still change, which would make the
   * report irreproducible) and a `retired` one (the workshop has withdrawn it).
   */
  async requireInstantiableVersion(
    db: DbHandle,
    versionId: string
  ): Promise<{ readonly id: string; readonly versionNumber: number }> {
    const version = await this.repository.templateVersion(db, versionId);
    if (version === null) {
      // Absent and out-of-scope are one answer, and neither is disclosed: the
      // caller learns only that this is not a version they may instantiate. The
      // refusal is raised directly rather than by passing a fake status into
      // `assertVersionInstantiable`, which would have made the message claim the
      // version is a draft when it may not exist at all.
      throw new AppFailure('ERR-VAL-001', {
        message: 'No instantiable template version with that id is visible',
        safeDetails: { violations: [{ path: 'body.templateVersionId', rule: 'not_found' }] },
      });
    }
    assertVersionInstantiable(version.status as TemplateVersionStatus);
    return { id: version.id, versionNumber: version.versionNumber };
  }

  /** Mandatory items still owing a result or a not-applicable reason. */
  async outstanding(db: DbHandle, reportId: string): Promise<readonly OutstandingItem[]> {
    return this.repository.outstandingMandatoryItems(db, reportId);
  }

  /** Refuses completion with `ERR-DIA-001` while any mandatory item is outstanding. */
  async assertCompletable(db: DbHandle, reportId: string): Promise<void> {
    assertCompletable(await this.repository.outstandingMandatoryItems(db, reportId));
  }
}
