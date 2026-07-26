/**
 * `diagnostics` module — public surface (Phase 1-19).
 *
 * The ONLY legal import path for this module (ADR-001): the boundary checker and
 * the ESLint rule both reject `@/modules/diagnostics/<anything>`. It exports
 * behaviour (composed services) and types/contract constants — never repositories,
 * pools, or SQL.
 *
 * ## What this module owns
 *
 * The `dia` schema: inspection templates, their versions and items, diagnostic
 * reports and their status history, item results, measurements, DTC records,
 * findings, evidence, recommendations and reviews. No other module reads or writes
 * a `dia.` table.
 *
 * The work-order module's closure blocker B4 needs to know whether a job's
 * diagnostic report is completed. It asks through this surface rather than
 * querying `dia.diagnostic_reports`, which is why `DiagnosticsCompletionService`
 * exists as a boundary rather than a convenience.
 *
 * Phase 1-19 delivers this module across waves: Wave 3 establishes the boundary,
 * the vocabulary and the template/completion reads; Wave 7 adds the entry,
 * completion and review behaviour.
 */
import { composeModule } from '@/server/layering';
import { DiagnosticsRepository } from './data/diagnostics-repository';
import { DiagnosticsCompletionService } from './application/diagnostics-completion-service';
import { DiagnosticReportService } from './application/diagnostic-report-service';

export type {
  DiagnosticEvidenceRow,
  DiagnosticReportRow,
  DiagnosticReviewRow,
  DtcRow,
  FindingOrigin,
  FindingRow,
  ItemResultRow,
  MeasurementRow,
  RecommendationRow,
  ReportHistoryRow,
  TemplateItemRow,
  TemplateVersionRow,
} from './data/diagnostics-repository';

export type {
  DiagnosticReportDetail,
  DiagnosticReportView,
  EvidenceView,
  PageInput,
  ReportHistoryEntry,
  ReportHistoryView,
  ReviewView,
} from './application/diagnostic-report-service';

export {
  DTC_CODE,
  DTC_STATUSES,
  DECIMAL_VALUE,
  DiagnosticsRuleError,
  FINDING_DISPOSITIONS,
  FINDING_SEVERITIES,
  MAX_DTC_DESCRIPTION,
  MAX_EVIDENCE_NOTE,
  MAX_EVIDENCE_TYPE,
  MAX_FINDING_DESCRIPTION,
  MAX_MEASUREMENT_LABEL,
  MAX_MEASUREMENT_UNIT,
  MAX_NOT_APPLICABLE_REASON,
  MAX_RECOMMENDATION,
  MAX_RESULT_VALUE,
  MAX_REVIEW_NOTES,
  MAX_SUMMARY,
  RECOMMENDATION_PRIORITIES,
  RECORDABLE_REPORT_STATUSES,
  REPORT_STATUSES,
  REPORT_TRANSITIONS,
  RESPONSE_TYPES,
  REVIEW_RESULTS,
  TEMPLATE_VERSION_STATUSES,
  asValidationRule,
  assertCompletable,
  assertNotApplicableReason,
  assertRecordable,
  assertReportTransition,
  assertResultShape,
  assertReviewerSeparation,
  assertVersionInstantiable,
  severityAtLeast,
  type DtcStatus,
  type FindingDisposition,
  type FindingSeverity,
  type OutstandingItem,
  type RecommendationPriority,
  type ReportStatus,
  type ResponseType,
  type ReviewResult,
  type TemplateVersionStatus,
  type ValidationRule,
} from './domain/diagnostics';

/** Composition root: constructs the module's services once per process. */
export const diagnosticsModule = composeModule({
  module: 'diagnostics',
  create: () => {
    const repository = new DiagnosticsRepository();
    return {
      completion: new DiagnosticsCompletionService(repository),
      reports: new DiagnosticReportService(repository),
    };
  },
});
