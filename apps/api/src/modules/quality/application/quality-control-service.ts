/**
 * Quality-control execution (Phase 1-19, P1-19-BE-017).
 *
 * ## A failed check is never edited into a pass
 *
 * `qms.guard_qc_finalize()` stamps `checker_id` and `finalized_at` from the session on
 * the `pending → passed|failed` edge and then FREEZES all three, so a finalized record
 * cannot be re-judged by anyone. A re-check is therefore a NEW record — the schema has
 * no unique index on `(work_order_id)` precisely so that is possible — and the failed
 * one stays in the ledger, attributable to whoever performed it.
 *
 * Closure blocker B5 reads the SET of records rather than a current one, which is why
 * the shape works: a later pass clears B5a while the failure remains on the record.
 *
 * ## Finalization is a separate permission, and the split is real
 *
 * `qms.quality_control.record` (medium) is what a technician needs to tick checks off;
 * `qms.quality_control.finalize` (high) is the authority to declare the vehicle
 * passed. Declaring work fit to release is a different act from observing it, and the
 * seeded catalog rates them differently for that reason.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import type { TimelineSourceRow, TimelineWindow } from '@/server/db/timeline';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { workOrderModule } from '@/modules/work-order';
import type {
  QcCheckResultRow,
  QcCheckRow,
  QualityControlRecordRow,
  QualityRepository,
} from '../data/quality-repository';
import { assertNotFinalized, type QcCheckResult, type QcOverallResult } from '../domain/quality';

/** A quality-control record as projected to a caller. */
export interface QcRecordView {
  readonly id: string;
  readonly workOrderId: string;
  readonly overallResult: string;
  readonly checkerId: string | null;
  readonly finalizedAt: string | null;
  readonly recordVersion: number;
}

/** A record with its per-check outcomes and the configured check catalog. */
export interface QcRecordDetail {
  readonly record: QcRecordView;
  readonly results: readonly QcCheckResultRow[];
  /**
   * Mandatory checks the record has no result for.
   *
   * Reported rather than enforced. `wo.guard_work_order_closure`'s B5b asks only
   * whether a PASSED record exists when any mandatory check is configured — it never
   * looks at per-check results — so refusing finalization on an unticked mandatory
   * check would be this layer inventing a rule the closure gate does not apply. What
   * it can honestly do is tell the checker what they have not looked at.
   */
  readonly unresolvedMandatory: readonly QcCheckRow[];
}

const toRecordView = (row: QualityControlRecordRow): QcRecordView => ({
  id: row.id,
  workOrderId: row.workOrderId,
  overallResult: row.overallResult,
  checkerId: row.checkerId,
  finalizedAt: row.finalizedAt === null ? null : row.finalizedAt.toISOString(),
  recordVersion: row.recordVersion,
});

export class QualityControlService extends ApplicationService {
  protected readonly module = 'quality';

  constructor(private readonly repository: QualityRepository) {
    super();
  }

  /**
   * The QC status events of one work order for the unified timeline
   * (P1-29 `W6`). A PORT: the work-order timeline has authorised the order and
   * checked `qms.quality_control.read` before asking.
   */
  async timelineEvents(
    db: DbHandle,
    workOrderId: string,
    window: TimelineWindow
  ): Promise<readonly TimelineSourceRow[]> {
    return this.repository.timelineEventsForWorkOrder(db, workOrderId, window);
  }

  /**
   * Opens a pending quality-control record on a work order.
   *
   * A terminal work order is refused: quality control certifies work before release,
   * and a record opened afterwards could never affect the closure it was supposed to
   * gate. The database does not check this — `qms.quality_control_records` references
   * the order and never reads its state — so it is an application rule.
   */
  async open(
    db: DbHandle,
    workOrderId: string,
    input: { readonly notes?: string | undefined },
    authorizeScope?: ScopeAuthorizer
  ): Promise<QcRecordView> {
    const workOrder = await workOrderModule().workOrders.requireWorkOrder(
      db,
      workOrderId,
      authorizeScope
    );
    const states = await workOrderModule().workOrderCatalog.workOrderStates(db);
    const state = states.find((candidate) => candidate.code === workOrder.state);
    if (state === undefined || state.isTerminal) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Work order state "${workOrder.state}" does not accept quality control`,
      });
    }

    const record = await this.repository.openQcRecord(db, {
      workOrderId,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      notes: input.notes ?? null,
    });

    await appendAudit(db, {
      action: 'qms.quality_control.opened',
      entityType: 'qms.quality_control_record',
      entityId: record.id,
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
      details: [{ field: 'work_order_id', classification: 'internal', value: workOrderId }],
    });
    return toRecordView(record);
  }

  /** Every quality-control record on a work order, oldest first. */
  async forWorkOrder(
    db: DbHandle,
    workOrderId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<readonly QcRecordView[]> {
    await workOrderModule().workOrders.requireWorkOrder(db, workOrderId, authorizeScope);
    return (await this.repository.qcRecordsFor(db, workOrderId)).map(toRecordView);
  }

  /** One record with its check outcomes and what is still unticked. */
  async detail(
    db: DbHandle,
    recordId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<QcRecordDetail> {
    const record = await this.requireRecord(db, recordId, authorizeScope);
    const [results, checks] = await Promise.all([
      this.repository.checkResultsFor(db, recordId),
      this.repository.qcChecks(db),
    ]);
    const answered = new Set(results.map((row) => row.qcCheckId));
    return {
      record: toRecordView(record),
      results,
      unresolvedMandatory: checks.filter((check) => check.isMandatory && !answered.has(check.id)),
    };
  }

  /**
   * Records or replaces one check outcome.
   *
   * Refused once the record is finalized, which the database enforces for the RECORD
   * (`qms.guard_qc_finalize`) but not for its children: `qms.qc_check_results`
   * references the record and never reads its `overall_result`, so a finalized record
   * would silently accept new outcomes and change what it says after it was signed.
   * The record is LOCKED first, so a finalization cannot commit between the status
   * read and this write.
   */
  async recordCheck(
    db: DbHandle,
    recordId: string,
    qcCheckId: string,
    input: { readonly result: QcCheckResult; readonly note?: string | undefined },
    authorizeScope?: ScopeAuthorizer
  ): Promise<QcCheckResultRow> {
    const record = await this.repository.lockQcRecord(db, recordId);
    if (record === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Quality-control record ${recordId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: record.companyId, branchId: record.branchId });
    }
    assertNotFinalized(record.overallResult as QcOverallResult);

    // The check must be one the tenant can see. `fk_qc_check_results_check` references
    // `qms.qc_checks (id)` with NO tenant column, so a tenant-scoped check belonging to
    // ANOTHER tenant satisfies it — the catalog read is the only thing that refuses it.
    const checks = await this.repository.qcChecks(db);
    if (!checks.some((check) => check.id === qcCheckId)) {
      throw new AppFailure('ERR-RES-001', {
        message: `Quality check ${qcCheckId} is not in this tenant's active catalog`,
      });
    }

    const written = await this.repository.writeCheckResult(db, {
      recordId,
      companyId: record.companyId,
      branchId: record.branchId,
      qcCheckId,
      result: input.result,
      note: input.note ?? null,
    });

    await appendAudit(db, {
      action: 'qms.quality_control.check_recorded',
      entityType: 'qms.quality_control_record',
      entityId: recordId,
      companyId: record.companyId,
      branchId: record.branchId,
      details: [
        { field: 'check_code', classification: 'public', value: written.checkCode },
        { field: 'result', classification: 'public', value: written.result },
      ],
    });
    return written;
  }

  /**
   * Finalizes the record as passed or failed.
   *
   * `checker_id` and `finalized_at` are the database's: `qms.guard_qc_finalize()`
   * stamps both from `iam.current_user_id()` and `now()`, so the checker cannot be
   * claimed and the time cannot be back-dated. Neither is accepted here.
   *
   * A second finalization is refused before the guard sees it, and the guard refuses
   * it too — the pre-check exists to make the refusal readable, not to replace it.
   */
  async finalize(
    db: DbHandle,
    recordId: string,
    input: {
      readonly overallResult: Exclude<QcOverallResult, 'pending'>;
      readonly notes?: string | undefined;
      readonly expectedVersion: number;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<QcRecordView> {
    const record = await this.repository.lockQcRecord(db, recordId);
    if (record === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Quality-control record ${recordId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: record.companyId, branchId: record.branchId });
    }
    if (record.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Quality-control record ${recordId} was modified by another request`,
      });
    }
    assertNotFinalized(record.overallResult as QcOverallResult);

    const applied = await this.repository.finalizeQcRecord(
      db,
      recordId,
      input.overallResult,
      input.notes ?? null,
      input.expectedVersion
    );
    if (!applied) {
      throw new AppFailure('ERR-CON-001', {
        message: `Quality-control record ${recordId} was modified by another request`,
      });
    }
    const recordVersion = input.expectedVersion + 1;

    await appendAudit(db, {
      action: 'qms.quality_control.finalized',
      entityType: 'qms.quality_control_record',
      entityId: recordId,
      companyId: record.companyId,
      branchId: record.branchId,
      details: [
        {
          field: 'overall_result',
          classification: 'public',
          previousValue: record.overallResult,
          value: input.overallResult,
        },
        { field: 'work_order_id', classification: 'internal', value: record.workOrderId },
      ],
    });

    await publishEvent(db, {
      eventType: 'quality-control.finalized',
      aggregateId: recordId,
      aggregateVersion: recordVersion,
      producer: 'qms.quality-control-service',
      companyId: record.companyId,
      branchId: record.branchId,
      payload: {
        qualityControlRecordId: recordId,
        workOrderId: record.workOrderId,
        overallResult: input.overallResult,
      },
      // Finalization happens at most once per record — the guard freezes the result —
      // so the key needs no version.
      eventKey: `quality-control.finalized:${recordId}`,
    });

    // The checker and the time are read BACK rather than reconstructed: the database
    // stamped them, so the row is the only honest source.
    const after = await this.repository.findQcRecord(db, recordId);
    return toRecordView(after ?? { ...record, overallResult: input.overallResult, recordVersion });
  }

  /** The record, scoped against its own company and branch. */
  private async requireRecord(
    db: DbHandle,
    recordId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<QualityControlRecordRow> {
    const record = await this.repository.findQcRecord(db, recordId);
    if (record === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Quality-control record ${recordId} is not visible`,
      });
    }
    // `/quality-controls/{recordId}` names no branch, so the pre-handler check has
    // nothing to narrow by and `scope: 'branch'` would be inert (P1-18-A-01).
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: record.companyId, branchId: record.branchId });
    }
    return record;
  }
}
