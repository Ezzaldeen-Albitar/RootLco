/**
 * Diagnostic report domain rules (Phase 1-19, P1-19-BE-001).
 *
 * Pure: no database access, no I/O.
 *
 * Every vocabulary below was read from `pg_constraint`, not from a specification.
 *
 * ## The completion gate is the reason this module exists
 *
 * `dia.guard_diagnostic_report_transition` refuses a move to `completed` while a
 * mandatory item of the pinned template version has no result. That guard is the
 * authority. What this layer adds is the *list* — which items are outstanding —
 * because the guard can only say "not yet", and a technician who is told "not yet"
 * without being told which of forty items is missing has been told nothing.
 */
import { AppFailure } from '@/server/errors/app-failure';

/** Frozen `ck_diagnostic_reports_status` vocabulary. */
export const REPORT_STATUSES = ['draft', 'in_progress', 'completed', 'cancelled'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Frozen `ck_template_versions_status` vocabulary. */
export const TEMPLATE_VERSION_STATUSES = ['draft', 'published', 'retired'] as const;
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];

/** Frozen `ck_template_items_response_type` vocabulary. */
export const RESPONSE_TYPES = ['numeric', 'text', 'boolean', 'select'] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

/** Frozen `ck_findings_severity` vocabulary, least to most severe. */
export const FINDING_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** Frozen `ck_findings_disposition` vocabulary. */
export const FINDING_DISPOSITIONS = [
  'monitor',
  'repair_recommended',
  'repair_required',
  'no_action',
] as const;
export type FindingDisposition = (typeof FINDING_DISPOSITIONS)[number];

/** Frozen `ck_dtc_records_status` vocabulary. */
export const DTC_STATUSES = ['active', 'pending', 'stored', 'cleared'] as const;
export type DtcStatus = (typeof DTC_STATUSES)[number];

/** Frozen `ck_recommendations_priority` vocabulary. */
export const RECOMMENDATION_PRIORITIES = ['low', 'medium', 'high'] as const;
export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number];

/** Frozen `ck_diagnostic_reviews_result` vocabulary. */
export const REVIEW_RESULTS = ['approved', 'rejected', 'needs_rework'] as const;
export type ReviewResult = (typeof REVIEW_RESULTS)[number];

export const MAX_SUMMARY = 4000;
export const MAX_NOT_APPLICABLE_REASON = 500;

/**
 * A mandatory item that has neither a result nor a documented not-applicable
 * reason. Returned in full so completion reports every gap at once.
 */
export interface OutstandingItem {
  readonly itemCode: string;
  readonly prompt: string;
  readonly responseType: ResponseType;
}

/** Raised for a rule this layer can decide without the database. */
export class DiagnosticsRuleError extends Error {
  public override readonly name = 'DiagnosticsRuleError';
}

/**
 * Refuses completion while mandatory items are outstanding.
 *
 * `ERR-DIA-001` rather than `ERR-VAL-001`: the completion request is well-formed,
 * and what blocks it is the accumulated state of the report — a conflict, not a
 * malformed input.
 */
export function assertCompletable(outstanding: readonly OutstandingItem[]): void {
  if (outstanding.length === 0) return;
  throw new AppFailure('ERR-DIA-001', {
    message:
      `${outstanding.length} mandatory item(s) unresolved: ` +
      outstanding.map((item) => item.itemCode).join(', '),
  });
}

/**
 * Refuses a not-applicable reason that is absent or empty.
 *
 * A mandatory item may be skipped, but never silently: the schema keeps the item
 * row, and the only honest way to close it without a value is an explicit reason
 * that a reviewer can read later.
 */
export function assertNotApplicableReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    throw new AppFailure('ERR-VAL-001', {
      message: 'A mandatory item skipped as not applicable requires a reason',
      safeDetails: { violations: [{ path: 'body.notApplicableReason', rule: 'required' }] },
    });
  }
  if (trimmed.length > MAX_NOT_APPLICABLE_REASON) {
    throw new AppFailure('ERR-VAL-001', {
      message: `A not-applicable reason may not exceed ${MAX_NOT_APPLICABLE_REASON} characters`,
      safeDetails: { violations: [{ path: 'body.notApplicableReason', rule: 'max_length' }] },
    });
  }
  return trimmed;
}

/**
 * Refuses a report instantiated from a template version that is not published.
 *
 * `dia.guard_template_version_publish` and `dia.guard_template_item_frozen` keep a
 * published version's items immutable, which is what makes a completed report
 * reproducible years later. Instantiating a `draft` version would pin a shape that
 * can still change underneath the report; instantiating a `retired` one would
 * start new work against a version the workshop has withdrawn.
 */
export function assertVersionInstantiable(status: TemplateVersionStatus): void {
  if (status === 'published') return;
  throw new AppFailure('ERR-VAL-001', {
    message: `A diagnostic report may only be instantiated from a published template version (got "${status}")`,
    safeDetails: { violations: [{ path: 'body.templateVersionId', rule: 'not_published' }] },
  });
}

/** Is this severity at least as severe as the threshold? */
export function severityAtLeast(severity: FindingSeverity, threshold: FindingSeverity): boolean {
  return FINDING_SEVERITIES.indexOf(severity) >= FINDING_SEVERITIES.indexOf(threshold);
}
