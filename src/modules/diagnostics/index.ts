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

export type {
  DiagnosticReportRow,
  FindingOrigin,
  TemplateItemRow,
  TemplateVersionRow,
} from './data/diagnostics-repository';

export {
  DTC_STATUSES,
  DiagnosticsRuleError,
  FINDING_DISPOSITIONS,
  FINDING_SEVERITIES,
  MAX_NOT_APPLICABLE_REASON,
  MAX_SUMMARY,
  RECOMMENDATION_PRIORITIES,
  REPORT_STATUSES,
  RESPONSE_TYPES,
  REVIEW_RESULTS,
  TEMPLATE_VERSION_STATUSES,
  assertCompletable,
  assertNotApplicableReason,
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
} from './domain/diagnostics';

/** Composition root: constructs the module's services once per process. */
export const diagnosticsModule = composeModule({
  module: 'diagnostics',
  create: () => ({
    completion: new DiagnosticsCompletionService(new DiagnosticsRepository()),
  }),
});
