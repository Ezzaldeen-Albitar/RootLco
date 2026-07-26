/**
 * Diagnostic reports, their entries, completion and review (Phase 1-19, P1-19-BE-009…012).
 *
 * ## A report pins a version, and that is what makes it readable years later
 *
 * `dia.guard_diagnostic_report_refs` refuses any report that does not pin a
 * **published** template version, and `dia.guard_template_item_frozen` refuses every
 * change to a published version's items — including a soft-delete. So the questions a
 * report was asked can never change after the fact. Everything here reads the
 * REPORT's `template_version_id` rather than the template's current version, so a
 * template that has since moved on cannot alter what an old report owes or means.
 *
 * ## Two rules the database does NOT enforce, stated as application rules
 *
 * 1. **Entries against a finished report.** `dia.report_item_results`,
 *    `dia.measurements`, `dia.dtc_records`, `dia.findings` and
 *    `dia.diagnostic_evidence` all reference the report by foreign key and none of
 *    them consults its status. A completed report would silently accept new
 *    results — changing what it says after it was completed and reviewed, which is
 *    the entire reason completion means anything. `assertRecordable` is that rule.
 * 2. **Reviewer separation.** `dia.stamp_review()` makes attribution unforgeable, but
 *    nothing stops the report's own author being the actor.
 *    `dia.diagnostic_reports.created_by` is the only comparison the schema offers,
 *    and `assertReviewerSeparation` is that rule, with its limits written down.
 *
 * ## Revision numbering rests on an advisory lock ALONE
 *
 * `revision_number` carries only `CHECK (> 0)`; there is no unique index behind it
 * anywhere. See `nextRevisionNumber` in the repository and accepted item
 * `P1-19-A-02`. Nothing here claims guaranteed monotonicity.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { pageRequest, type Page } from '@/server/db/pagination';
import { workOrderModule } from '@/modules/work-order';
import { sharedServicesModule } from '@/modules/shared-services';
import {
  REPORT_HISTORY_ORDER,
  type DiagnosticEvidenceRow,
  type DiagnosticReportRow,
  type DiagnosticReviewRow,
  type DiagnosticsRepository,
  type DtcRow,
  type FindingRow,
  type ItemResultRow,
  type MeasurementRow,
  type RecommendationRow,
  type ReportHistoryRow,
  type TemplateItemRow,
} from '../data/diagnostics-repository';
import {
  REPORT_TRANSITIONS,
  asValidationRule,
  assertCompletable,
  assertNotApplicableReason,
  assertRecordable,
  assertReportTransition,
  assertResultShape,
  assertReviewerSeparation,
  assertVersionInstantiable,
  type DtcStatus,
  type FindingDisposition,
  type FindingSeverity,
  type OutstandingItem,
  type RecommendationPriority,
  type ReportStatus,
  type ReviewResult,
  type TemplateVersionStatus,
} from '../domain/diagnostics';

/** The page a caller asked for, before the cursor is decoded. */
export interface PageInput {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/** A diagnostic report as projected to a caller. */
export interface DiagnosticReportView {
  readonly id: string;
  readonly workOrderId: string;
  readonly jobId: string;
  readonly templateVersionId: string;
  readonly diagnosticTypeId: string;
  readonly status: string;
  readonly revisionNumber: number;
  readonly summary: string | null;
  readonly createdAt: string;
  readonly recordVersion: number;
}

/**
 * The aggregate one report presents.
 *
 * `outstandingMandatory` is included rather than given its own endpoint: it is the
 * same list the completion refusal returns, and a technician filling a report in
 * wants to know before attempting rather than after being refused.
 */
export interface DiagnosticReportDetail {
  readonly report: DiagnosticReportView;
  readonly items: readonly ItemResultRow[];
  readonly measurements: readonly MeasurementRow[];
  readonly dtcs: readonly DtcRow[];
  readonly findings: readonly FindingRow[];
  readonly recommendations: readonly RecommendationRow[];
  readonly evidence: readonly EvidenceView[];
  readonly reviews: readonly ReviewView[];
  readonly outstandingMandatory: readonly OutstandingItem[];
  readonly nextStatuses: readonly string[];
}

export interface EvidenceView {
  readonly id: string;
  readonly documentVersionId: string;
  readonly evidenceType: string;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface ReviewView {
  readonly id: string;
  readonly reviewResult: string;
  readonly notes: string | null;
  readonly reviewerId: string;
  readonly reviewedAt: string;
}

export interface ReportHistoryEntry {
  readonly id: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly reason: string | null;
  readonly occurredAt: string;
  readonly actorId: string | null;
}

/** A report's ledger plus the genesis facts the ledger cannot hold. */
export interface ReportHistoryView {
  readonly diagnosticReportId: string;
  readonly origin: {
    readonly createdAt: string;
    readonly createdBy: string;
    readonly initialStatus: string;
  };
  readonly transitions: Page<ReportHistoryEntry>;
}

/** Version states a document may be in and still be bound as diagnostic evidence. */
const EVIDENCE_REFUSED_STATES: readonly string[] = Object.freeze(['rejected', 'quarantined']);

const toReportView = (row: DiagnosticReportRow): DiagnosticReportView => ({
  id: row.id,
  workOrderId: row.workOrderId,
  jobId: row.jobId,
  templateVersionId: row.templateVersionId,
  diagnosticTypeId: row.diagnosticTypeId,
  status: row.status,
  revisionNumber: row.revisionNumber,
  summary: row.summary,
  createdAt: row.createdAt.toISOString(),
  recordVersion: row.recordVersion,
});

const toEvidenceView = (row: DiagnosticEvidenceRow): EvidenceView => ({
  id: row.id,
  documentVersionId: row.documentVersionId,
  evidenceType: row.evidenceType,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
});

const toReviewView = (row: DiagnosticReviewRow): ReviewView => ({
  id: row.id,
  reviewResult: row.reviewResult,
  notes: row.notes,
  reviewerId: row.reviewerId,
  reviewedAt: row.reviewedAt.toISOString(),
});

const toHistoryEntry = (row: ReportHistoryRow): ReportHistoryEntry => ({
  id: row.id,
  fromState: row.fromState,
  toState: row.toState,
  reason: row.reason,
  occurredAt: row.occurredAt.toISOString(),
  actorId: row.actorId,
});

export class DiagnosticReportService extends ApplicationService {
  protected readonly module = 'diagnostics';

  constructor(private readonly repository: DiagnosticsRepository) {
    super();
  }

  /**
   * Creates a report on a job, pinning an exact published template version.
   *
   * The job's scope comes from the `work-order` module's public surface, because
   * `dia.diagnostic_reports` carries `work_order_id`, `company_id` and `branch_id`
   * and this module may not read `wo.jobs` to find them (ADR-001 rule 3).
   *
   * The diagnostic TYPE is derived from the template rather than accepted, so a
   * report's type can never disagree with the template it pins — the column is NOT
   * NULL and foreign-keyed but nothing makes the two agree.
   */
  async create(
    db: DbHandle,
    jobId: string,
    input: { readonly templateVersionId: string },
    authorizeScope?: ScopeAuthorizer
  ): Promise<DiagnosticReportView> {
    const job = await workOrderModule().workOrders.jobScope(db, jobId);
    if (job === null) {
      throw new AppFailure('ERR-RES-001', { message: `Job ${jobId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: job.companyId, branchId: job.branchId });
    }
    // Neither is a schema rule: `dia.guard_diagnostic_report_refs` checks the job
    // belongs to the work order and the version is published, and says nothing about
    // either state. Starting a diagnostic on finished work would record an
    // observation about a vehicle that has already left.
    if (job.workOrderIsTerminal) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Work order state "${job.workOrderState}" does not accept new diagnostics`,
      });
    }
    if (job.jobIsTerminal) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Job state "${job.jobState}" does not accept new diagnostics`,
      });
    }

    const version = await this.repository.templateVersion(db, input.templateVersionId);
    if (version === null) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'No instantiable template version with that id is visible',
        safeDetails: { violations: [{ path: 'body.templateVersionId', rule: 'not_found' }] },
      });
    }
    // The readable refusal in front of the guard, and it distinguishes `draft` from
    // `retired` — the guard raises one `check_violation` for both.
    assertVersionInstantiable(version.status as TemplateVersionStatus);

    const revisionNumber = await this.repository.nextRevisionNumber(db, jobId);
    let report: DiagnosticReportRow;
    try {
      report = await this.repository.createReport(db, {
        companyId: job.companyId,
        branchId: job.branchId,
        workOrderId: job.workOrderId,
        jobId,
        templateVersionId: version.id,
        diagnosticTypeId: version.diagnosticTypeId,
        revisionNumber,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // `dia.guard_diagnostic_report_refs` refused it. Reachable in the window
        // between the pre-checks above and this insert — a version retired, or the
        // job moved — so it is mapped rather than surfaced as a 500.
        throw new AppFailure('ERR-TRN-001', {
          message: 'The job or the pinned template version no longer permits a report',
          cause: error,
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'dia.diagnostic.created',
      entityType: 'dia.diagnostic_report',
      entityId: report.id,
      companyId: job.companyId,
      branchId: job.branchId,
      details: [
        { field: 'job_id', classification: 'internal', value: jobId },
        { field: 'work_order_id', classification: 'internal', value: job.workOrderId },
        // The pinned version, because it is the fact that makes the report
        // reproducible and the one an auditor needs to read it years later.
        { field: 'template_version_id', classification: 'internal', value: version.id },
        {
          field: 'revision_number',
          classification: 'public',
          value: String(report.revisionNumber),
        },
      ],
    });

    return toReportView(report);
  }

  /** Every live report on a job, newest revision first. */
  async forJob(
    db: DbHandle,
    jobId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<readonly DiagnosticReportView[]> {
    const job = await workOrderModule().workOrders.jobScope(db, jobId);
    if (job === null) {
      throw new AppFailure('ERR-RES-001', { message: `Job ${jobId} is not visible` });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: job.companyId, branchId: job.branchId });
    }
    return (await this.repository.reportsForJob(db, jobId)).map(toReportView);
  }

  /** The report and everything recorded on it. */
  async detail(
    db: DbHandle,
    reportId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<DiagnosticReportDetail> {
    const report = await this.requireReport(db, reportId, authorizeScope);
    const [items, measurements, dtcs, findings, recommendations, evidence, reviews, outstanding] =
      await Promise.all([
        this.repository.itemResultsFor(db, reportId),
        this.repository.measurementsFor(db, reportId),
        this.repository.dtcsFor(db, reportId),
        this.repository.findingsFor(db, reportId),
        this.repository.recommendationsFor(db, reportId),
        this.repository.evidenceFor(db, reportId),
        this.repository.reviewsFor(db, reportId),
        this.repository.outstandingMandatoryItems(db, reportId),
      ]);
    return {
      report: toReportView(report),
      items,
      measurements,
      dtcs,
      findings,
      recommendations,
      evidence: evidence.map(toEvidenceView),
      reviews: reviews.map(toReviewView),
      outstandingMandatory: outstanding,
      nextStatuses: [...this.reachable(report.status)],
    };
  }

  /** Append-only status history, paginated, with the genesis block. */
  async history(
    db: DbHandle,
    reportId: string,
    page: PageInput,
    authorizeScope?: ScopeAuthorizer
  ): Promise<ReportHistoryView> {
    const report = await this.requireReport(db, reportId, authorizeScope);
    const [transitions, initial] = await Promise.all([
      this.repository.historyPage(db, reportId, pageRequest(REPORT_HISTORY_ORDER, page)),
      this.repository.initialStatus(db, reportId),
    ]);
    return {
      diagnosticReportId: reportId,
      origin: {
        createdAt: report.createdAt.toISOString(),
        createdBy: report.createdBy,
        // The status the report was created in: the oldest ledger entry's origin, or
        // the current status while nothing has moved it. `dia.emit_diagnostic_report_status_history`
        // is AFTER UPDATE only, so creation writes no ledger row.
        initialStatus: initial ?? report.status,
      },
      transitions: { ...transitions, items: transitions.items.map(toHistoryEntry) },
    };
  }

  /**
   * Moves a report along the fixed lifecycle — but never to `completed`.
   *
   * Completion is its own command behind its own permission, exactly as work-order
   * closure is: `dia.diagnostic.record` is what a technician needs to fill a report
   * in, and `dia.diagnostic.complete` is the authority to declare it finished and
   * frozen. Asking this endpoint for `completed` is refused rather than accepted, or
   * the second permission would be bypassable by choosing the other URL.
   */
  async transition(
    db: DbHandle,
    reportId: string,
    input: {
      readonly toStatus: ReportStatus;
      readonly reason?: string | undefined;
      readonly expectedVersion: number;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<DiagnosticReportView> {
    if (input.toStatus === 'completed') {
      throw new AppFailure('ERR-VAL-001', {
        message: '"completed" is reached through the completion command',
        safeDetails: {
          violations: [{ path: 'body.toStatus', rule: 'completion_requires_completion_operation' }],
        },
      });
    }
    return this.move(db, reportId, input.toStatus, input.reason ?? null, input.expectedVersion, {
      ...(authorizeScope === undefined ? {} : { authorizeScope }),
    });
  }

  /**
   * Completes a report, reporting EVERY outstanding mandatory item at once.
   *
   * `dia.guard_diagnostic_report_transition` is the enforcement and runs inside the
   * same statement as the write — it re-counts unanswered mandatory items and aborts.
   * What this adds is the list: the guard can only say "not yet", and a technician
   * told "not yet" without being told which of forty items is missing has been told
   * nothing.
   */
  async complete(
    db: DbHandle,
    reportId: string,
    input: { readonly summary?: string | undefined; readonly expectedVersion: number },
    authorizeScope?: ScopeAuthorizer
  ): Promise<DiagnosticReportView> {
    return this.move(db, reportId, 'completed', null, input.expectedVersion, {
      ...(authorizeScope === undefined ? {} : { authorizeScope }),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
    });
  }

  /** The one write path for a report status change. */
  private async move(
    db: DbHandle,
    reportId: string,
    toStatus: ReportStatus,
    reason: string | null,
    expectedVersion: number,
    options: {
      readonly authorizeScope?: ScopeAuthorizer;
      readonly summary?: string;
    }
  ): Promise<DiagnosticReportView> {
    const locked = await this.repository.lockReport(db, reportId);
    if (locked === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Diagnostic report ${reportId} is not visible`,
      });
    }
    if (options.authorizeScope !== undefined) {
      await options.authorizeScope({ companyId: locked.companyId, branchId: locked.branchId });
    }
    if (locked.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Diagnostic report ${reportId} was modified by another request`,
      });
    }
    // The same parent rule as the entry surface, and it belongs on this path most of
    // all: `completed` is the status closure blocker B4 reads. Completing a report onto
    // an already-closed order would write the fact that satisfies B4 after the gate
    // that consults it has already run. Cancellation is refused for the same reason —
    // both are status changes on work the vehicle has left behind.
    await this.assertParentAcceptsWork(db, locked);
    assertReportTransition(locked.status, toStatus);

    let version = expectedVersion;
    if (options.summary !== undefined) {
      // Written BEFORE the status change, in the same transaction, so a completed
      // report is never briefly complete without the summary that explains it. The
      // update bumps `record_version`, which is why the status write that follows
      // sends the bumped one.
      const wrote = await this.repository.applyReportSummary(
        db,
        reportId,
        options.summary,
        version
      );
      if (!wrote) {
        throw new AppFailure('ERR-CON-001', {
          message: `Diagnostic report ${reportId} was modified by another request`,
        });
      }
      version += 1;
    }

    if (toStatus === 'completed') {
      // The pre-report. `dia.guard_diagnostic_report_transition` still runs on the
      // UPDATE below and is what actually refuses completion, including in the window
      // between this read and that write.
      assertCompletable(await this.repository.outstandingMandatoryItems(db, reportId));
    }

    let applied: boolean;
    try {
      applied = await this.repository.applyReportStatus(db, reportId, toStatus, reason, version);
    } catch (error) {
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        // The guard refused it: an item was answered and then withdrawn between the
        // pre-report and the write, or the graph moved under us. `ERR-DIA-001` is the
        // registered code for exactly the completion case.
        throw new AppFailure(toStatus === 'completed' ? 'ERR-DIA-001' : 'ERR-TRN-001', {
          message: `Diagnostic report ${reportId} may not become "${toStatus}"`,
          cause: error,
        });
      }
      throw error;
    }
    if (!applied) {
      throw new AppFailure('ERR-CON-001', {
        message: `Diagnostic report ${reportId} was modified by another request`,
      });
    }
    const recordVersion = version + 1;

    await appendAudit(db, {
      action:
        toStatus === 'completed' ? 'dia.diagnostic.completed' : 'dia.diagnostic.state_changed',
      entityType: 'dia.diagnostic_report',
      entityId: reportId,
      companyId: locked.companyId,
      branchId: locked.branchId,
      details: [
        {
          field: 'status',
          classification: 'public',
          previousValue: locked.status,
          value: toStatus,
        },
        ...(reason === null
          ? []
          : [{ field: 'reason', classification: 'internal' as const, value: reason }]),
      ],
    });

    if (toStatus === 'completed') {
      await publishEvent(db, {
        eventType: 'diagnostic-report.completed',
        aggregateId: reportId,
        aggregateVersion: recordVersion,
        producer: 'dia.diagnostic-report-service',
        companyId: locked.companyId,
        branchId: locked.branchId,
        // Identity and provenance only. A consumer that needs the findings reads them
        // under its own authorization; an event is a notification, not a read model.
        payload: {
          diagnosticReportId: reportId,
          workOrderId: locked.workOrderId,
          jobId: locked.jobId,
          revisionNumber: locked.revisionNumber,
        },
        // Completion happens at most once — `completed` is terminal in the fixed
        // lifecycle — so the key needs no version.
        eventKey: `diagnostic-report.completed:${reportId}`,
      });
    }

    return toReportView({
      ...locked,
      status: toStatus,
      summary: options.summary ?? locked.summary,
      recordVersion,
    });
  }

  /**
   * Records or replaces the answer to one template item.
   *
   * The item must belong to the report's PINNED version.
   * `fk_report_item_results_item` is `(tenant_id, template_item_id)` and names no
   * version, so an item from a different template — or from a newer version of the
   * same one — satisfies it. The read that refuses it goes through the report.
   */
  async recordItemResult(
    db: DbHandle,
    reportId: string,
    templateItemId: string,
    input: {
      readonly resultValue?: string | undefined;
      readonly notApplicableReason?: string | undefined;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<ItemResultRow> {
    const report = await this.lockRecordableReport(db, reportId, authorizeScope);
    const item = await this.repository.pinnedItem(db, reportId, templateItemId);
    if (item === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Item ${templateItemId} is not part of this report's pinned template version`,
      });
    }

    let resultValue: string | null = null;
    let notApplicableReason: string | null = null;
    if (input.resultValue !== undefined && input.resultValue.trim().length > 0) {
      resultValue = input.resultValue.trim();
      assertResultShape(item.responseType, resultValue, asValidationRule(item.validationRule));
    } else {
      // `ck_report_item_results_answered` demands one or the other, and a mandatory
      // item skipped without a documented reason is exactly what the completion gate
      // exists to prevent — so the reason is required rather than defaulted.
      notApplicableReason = assertNotApplicableReason(input.notApplicableReason);
    }

    const written = await this.repository.writeItemResult(db, {
      reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      templateItemId,
      resultValue,
      notApplicableReason,
    });

    await appendAudit(db, {
      action: 'dia.diagnostic.entry_recorded',
      entityType: 'dia.diagnostic_report',
      entityId: reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      details: [
        { field: 'entry_kind', classification: 'public', value: 'item_result' },
        { field: 'item_code', classification: 'public', value: written.itemCode },
        // A reading about a customer's vehicle, so `internal`. The value itself is
        // recorded because a diagnostic result IS the finding of record, and an audit
        // trail that omitted it could not show what a report said when it was signed.
        ...(written.resultValue === null
          ? [
              {
                field: 'not_applicable_reason',
                classification: 'internal' as const,
                value: written.notApplicableReason ?? '',
              },
            ]
          : [
              {
                field: 'result_value',
                classification: 'internal' as const,
                value: written.resultValue,
              },
            ]),
      ],
    });
    return written;
  }

  /**
   * Records one numeric reading against the report.
   *
   * The unit must match the pinned item's when one is named, and the item must be
   * `numeric`: `ck_template_items_unit` makes a numeric item's unit mandatory, so a
   * reading in different units against that item is a reading that means nothing, and
   * a reading against a `boolean` item is incoherent. Neither is a schema rule.
   *
   * `within_range` is computed in the DATABASE against the item's configured range —
   * see the repository — and an out-of-range reading is RECORDED, never refused. A
   * diagnostic exists to record what is wrong with a vehicle.
   */
  async recordMeasurement(
    db: DbHandle,
    reportId: string,
    input: {
      readonly templateItemId?: string | undefined;
      readonly label: string;
      readonly measuredValue: string;
      readonly unit: string;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<MeasurementRow> {
    const report = await this.lockRecordableReport(db, reportId, authorizeScope);
    let item: TemplateItemRow | null = null;
    if (input.templateItemId !== undefined) {
      item = await this.repository.pinnedItem(db, reportId, input.templateItemId);
      if (item === null) {
        throw new AppFailure('ERR-RES-001', {
          message: `Item ${input.templateItemId} is not part of this report's pinned template version`,
        });
      }
      if (item.responseType !== 'numeric') {
        throw new AppFailure('ERR-VAL-001', {
          message: `Item "${item.itemCode}" is a "${item.responseType}" item and takes no measurement`,
          safeDetails: {
            violations: [{ path: 'body.templateItemId', rule: 'not_a_numeric_item' }],
          },
        });
      }
      if (item.unit !== null && item.unit !== input.unit) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Item "${item.itemCode}" is measured in "${item.unit}"`,
          safeDetails: { violations: [{ path: 'body.unit', rule: 'unit_mismatch' }] },
        });
      }
    }

    const measurement = await this.repository.recordMeasurement(db, {
      reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      templateItemId: input.templateItemId ?? null,
      label: input.label,
      measuredValue: input.measuredValue,
      unit: input.unit,
    });

    await appendAudit(db, {
      action: 'dia.diagnostic.entry_recorded',
      entityType: 'dia.diagnostic_report',
      entityId: reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      details: [
        { field: 'entry_kind', classification: 'public', value: 'measurement' },
        { field: 'label', classification: 'internal', value: measurement.label },
        { field: 'measured_value', classification: 'internal', value: measurement.measuredValue },
        { field: 'unit', classification: 'public', value: measurement.unit },
        // Recorded as the three-valued fact it is: `null` means no range was
        // configured, and flattening it to `false` would claim a check that never ran.
        {
          field: 'within_range',
          classification: 'public',
          value: measurement.withinRange === null ? 'unknown' : String(measurement.withinRange),
        },
      ],
    });
    return measurement;
  }

  /** Records one diagnostic trouble code. */
  async recordDtc(
    db: DbHandle,
    reportId: string,
    input: {
      readonly code: string;
      readonly description?: string | undefined;
      readonly dtcStatus?: DtcStatus | undefined;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<DtcRow> {
    const report = await this.lockRecordableReport(db, reportId, authorizeScope);
    const dtc = await this.repository.recordDtc(db, {
      reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      code: input.code,
      description: input.description ?? null,
      // `active` is the column default and the honest reading of a code a technician
      // has just pulled off the vehicle.
      dtcStatus: input.dtcStatus ?? 'active',
    });

    await appendAudit(db, {
      action: 'dia.diagnostic.entry_recorded',
      entityType: 'dia.diagnostic_report',
      entityId: reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      details: [
        { field: 'entry_kind', classification: 'public', value: 'dtc' },
        // An OBD-II code is a manufacturer-defined fault identifier, not customer
        // data, so it is `public` in the classification sense.
        { field: 'code', classification: 'public', value: dtc.code },
        { field: 'dtc_status', classification: 'public', value: dtc.dtcStatus },
      ],
    });
    return dtc;
  }

  /** Records one finding. */
  async recordFinding(
    db: DbHandle,
    reportId: string,
    input: {
      readonly templateItemId?: string | undefined;
      readonly severity: FindingSeverity;
      readonly disposition: FindingDisposition;
      readonly description: string;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<FindingRow> {
    const report = await this.lockRecordableReport(db, reportId, authorizeScope);
    if (input.templateItemId !== undefined) {
      const item = await this.repository.pinnedItem(db, reportId, input.templateItemId);
      if (item === null) {
        throw new AppFailure('ERR-RES-001', {
          message: `Item ${input.templateItemId} is not part of this report's pinned template version`,
        });
      }
    }

    const finding = await this.repository.recordFinding(db, {
      reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      templateItemId: input.templateItemId ?? null,
      severity: input.severity,
      disposition: input.disposition,
      description: input.description,
    });

    await appendAudit(db, {
      action: 'dia.diagnostic.entry_recorded',
      entityType: 'dia.diagnostic_report',
      entityId: reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      details: [
        { field: 'entry_kind', classification: 'public', value: 'finding' },
        { field: 'severity', classification: 'public', value: finding.severity },
        { field: 'disposition', classification: 'public', value: finding.disposition },
        { field: 'finding_id', classification: 'internal', value: finding.id },
      ],
    });
    return finding;
  }

  /**
   * Binds one exact document version to the report as evidence.
   *
   * Identical contract to `wo.customer_approval_evidence`: append-only, an exact
   * VERSION rather than a document, no storage key anywhere, and `accepted` is not
   * required because P1-15 documented acceptance as unreachable while no application
   * role may write `shared.file_scan_results`. A rejected or quarantined version IS
   * refused.
   */
  async recordEvidence(
    db: DbHandle,
    reportId: string,
    input: {
      readonly documentVersionId: string;
      readonly evidenceType: string;
      readonly note?: string | undefined;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<EvidenceView> {
    const report = await this.lockRecordableReport(db, reportId, authorizeScope);
    const state = await sharedServicesModule().attachments.scanState(db, input.documentVersionId);
    if (EVIDENCE_REFUSED_STATES.includes(state.status)) {
      throw new AppFailure('ERR-DOC-001', {
        message: `Document version is "${state.status}" and may not be used as diagnostic evidence`,
      });
    }

    let evidence: DiagnosticEvidenceRow;
    try {
      evidence = await this.repository.recordEvidence(db, {
        reportId,
        companyId: report.companyId,
        branchId: report.branchId,
        documentVersionId: input.documentVersionId,
        evidenceType: input.evidenceType,
        note: input.note ?? null,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-RES-001', {
          message: `Document version ${input.documentVersionId} is not visible in this scope`,
          cause: error,
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'dia.diagnostic.entry_recorded',
      entityType: 'dia.diagnostic_report',
      entityId: reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      details: [
        { field: 'entry_kind', classification: 'public', value: 'evidence' },
        { field: 'evidence_type', classification: 'public', value: evidence.evidenceType },
        {
          field: 'document_version_id',
          classification: 'internal',
          value: evidence.documentVersionId,
        },
      ],
    });
    return toEvidenceView(evidence);
  }

  /**
   * Records one recommendation.
   *
   * ## The finding link the brief asks for does not exist
   *
   * `dia.recommendations` carries ONLY `diagnostic_report_id`. There is no
   * `finding_id` column anywhere in the schema, so a recommendation cannot be linked
   * to the finding that prompted it, and inventing one would be this phase changing a
   * frozen schema. Recorded as a reconciliation.
   *
   * The provenance chain the schema DOES support runs the other way and is already
   * built: `wo.additional_work_requests.originating_finding_id` links additional work
   * to a FINDING, and Wave 6 resolves it through this module's `findingOrigin`.
   */
  async recordRecommendation(
    db: DbHandle,
    reportId: string,
    input: {
      readonly recommendation: string;
      readonly priority?: RecommendationPriority | undefined;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<RecommendationRow> {
    const report = await this.lockRecordableReport(db, reportId, authorizeScope);
    const recommendation = await this.repository.recordRecommendation(db, {
      reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      recommendation: input.recommendation,
      priority: input.priority ?? 'medium',
    });

    await appendAudit(db, {
      action: 'dia.diagnostic.entry_recorded',
      entityType: 'dia.diagnostic_report',
      entityId: reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      details: [
        { field: 'entry_kind', classification: 'public', value: 'recommendation' },
        { field: 'priority', classification: 'public', value: recommendation.priority },
        {
          field: 'recommendation_id',
          classification: 'internal',
          value: recommendation.id,
        },
      ],
    });
    return recommendation;
  }

  /**
   * Records a review of a COMPLETED report.
   *
   * Only a completed report may be reviewed: reviewing a draft would sign off work
   * still being entered, and the report could then change under the review. Nothing
   * in the schema says so — `dia.diagnostic_reviews` references the report and never
   * reads its status — so this is an application rule.
   *
   * Reviewer separation is enforced against `created_by`; see
   * `assertReviewerSeparation` for what that does and does not catch. Attribution is
   * the database's: `dia.stamp_review()` overwrites `reviewer_id` with
   * `iam.current_user_id()` on every insert, so a review can never name someone else.
   */
  async review(
    db: DbHandle,
    reportId: string,
    input: {
      readonly reviewResult: ReviewResult;
      readonly notes?: string | undefined;
    },
    authorizeScope?: ScopeAuthorizer
  ): Promise<ReviewView> {
    const report = await this.repository.lockReport(db, reportId);
    if (report === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Diagnostic report ${reportId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: report.companyId, branchId: report.branchId });
    }
    if (report.status !== 'completed') {
      throw new AppFailure('ERR-TRN-001', {
        message: `A diagnostic report is reviewed once completed; this one is "${report.status}"`,
      });
    }
    assertReviewerSeparation(report.createdBy, this.contextOf(db).principal.userId);

    const review = await this.repository.recordReview(db, {
      reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      reviewResult: input.reviewResult,
      notes: input.notes ?? null,
    });

    await appendAudit(db, {
      action: 'dia.diagnostic.reviewed',
      entityType: 'dia.diagnostic_report',
      entityId: reportId,
      companyId: report.companyId,
      branchId: report.branchId,
      details: [
        { field: 'review_result', classification: 'public', value: review.reviewResult },
        // The reviewer as the DATABASE stamped it, not as the request claimed it —
        // the two cannot differ, and recording the stamped value is what makes that
        // visible in the trail.
        { field: 'reviewer_id', classification: 'internal', value: review.reviewerId },
      ],
    });
    return toReviewView(review);
  }

  // -------------------------------------------------------------------------

  /** The report, scoped against its own company and branch. */
  private async requireReport(
    db: DbHandle,
    reportId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<DiagnosticReportRow> {
    const report = await this.repository.findReport(db, reportId);
    if (report === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Diagnostic report ${reportId} is not visible`,
      });
    }
    // `/inspections/{id}` names no branch, so the pre-handler check has nothing to
    // narrow by and `scope: 'branch'` would be inert (P1-18-A-01).
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: report.companyId, branchId: report.branchId });
    }
    return report;
  }

  /**
   * The LOCKED report, refused when it no longer accepts entries.
   *
   * The lock matters: without it a completion could commit between this status read
   * and the entry insert, and the entry would land on a report that says it is
   * finished. `assertRecordable` is checked under the lock for that reason, not
   * merely before the write.
   *
   * ## The parent's state is checked here too, and was not
   *
   * `create` refuses a terminal work order and a terminal job, but nothing re-checked
   * it afterwards — so a report left `in_progress` when its work order closed went on
   * accepting measurements, DTCs, findings, evidence and recommendations, and could
   * still be COMPLETED, indefinitely after the vehicle was released.
   *
   * That is reachable without any race. B4 requires a completed report only for a
   * `requires_diagnostic` job, so an order carrying an `in_progress` report on an
   * ordinary job closes cleanly through the real gate — and the report stayed open for
   * writing. A diagnostic is a dated observation about a vehicle; recording one after
   * the vehicle has gone makes the report say something it cannot know.
   *
   * The parent is resolved through the `work-order` module's public `jobScope`, because
   * `diagnostics` may not read `wo.work_orders` (ADR-001 rule 3), and that read is
   * NOT locked — `jobScope` does not lock, and adding a cross-module lock primitive to
   * satisfy a refusal would leak locking semantics across a boundary the phase keeps
   * closed. The residual window is recorded as `P1-19-A-06`: a closure committing
   * between this check and the entry insert would still admit the entry. The window is
   * narrow, the outcome is a late entry rather than a wrong closure decision, and
   * closing it needs either a database guard (a migration) or a cross-module lock.
   */
  private async lockRecordableReport(
    db: DbHandle,
    reportId: string,
    authorizeScope?: ScopeAuthorizer
  ): Promise<DiagnosticReportRow> {
    const report = await this.repository.lockReport(db, reportId);
    if (report === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Diagnostic report ${reportId} is not visible`,
      });
    }
    if (authorizeScope !== undefined) {
      await authorizeScope({ companyId: report.companyId, branchId: report.branchId });
    }
    assertRecordable(report.status);
    await this.assertParentAcceptsWork(db, report);
    return report;
  }

  /**
   * Refuses when the report's work order has reached a terminal state.
   *
   * Separate from `lockRecordableReport` because completion needs the same rule and
   * takes its own lock — a report may not be completed onto a released vehicle either,
   * and completion is the one entry-surface act that changes what B4 sees.
   */
  private async assertParentAcceptsWork(db: DbHandle, report: DiagnosticReportRow): Promise<void> {
    const job = await workOrderModule().workOrders.jobScope(db, report.jobId);
    if (job === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Job ${report.jobId} is not visible`,
      });
    }
    if (job.workOrderIsTerminal) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Work order state "${job.workOrderState}" does not accept diagnostic changes`,
      });
    }
  }

  /**
   * The statuses a report may currently move to.
   *
   * Read from the mirrored graph rather than restated at the call site, so the
   * reconciliation test that pins `REPORT_TRANSITIONS` against the deployed
   * `dia.guard_diagnostic_report_transition` pins this projection too.
   */
  private reachable(status: string): readonly string[] {
    return REPORT_TRANSITIONS[status] ?? [];
  }
}
