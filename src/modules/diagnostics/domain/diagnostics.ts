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
 * Application bounds on the free-text `dia` columns.
 *
 * Every one of these is unbounded `text` with only a not-blank CHECK, so these are
 * this layer's limits and not mirrors of the schema — stated here so the bound a
 * caller is refused on is the one the module documents.
 */
export const MAX_RESULT_VALUE = 1000;
export const MAX_MEASUREMENT_LABEL = 200;
export const MAX_MEASUREMENT_UNIT = 32;
export const MAX_FINDING_DESCRIPTION = 2000;
export const MAX_DTC_DESCRIPTION = 500;
export const MAX_RECOMMENDATION = 2000;
export const MAX_REVIEW_NOTES = 2000;
export const MAX_EVIDENCE_TYPE = 64;
export const MAX_EVIDENCE_NOTE = 500;

/**
 * `ck_dtc_records_code_format`, verbatim: `^[PBCU][0-9][0-9A-F]{3}$`.
 *
 * Upper case only, and the hex digits are the LAST THREE characters — the second
 * character is decimal, not hex. So `P0300` is valid and `p0300`, `P0G00` and
 * `PA300` are not. Mirrored here so a malformed code is a 422 naming the field
 * rather than a `23514` from the insert.
 */
export const DTC_CODE = /^[PBCU][0-9][0-9A-F]{3}$/;

/**
 * The decimal shape `dia.measurements.measured_value` accepts across the boundary.
 *
 * The column is bare `numeric` — no precision, no scale, no range — so a value
 * crosses as a STRING and is compared in the database, never in IEEE-754. The bound
 * on digits is this layer's: an unbounded numeric literal is a storage and
 * rendering hazard, and no workshop reading needs 1000 digits.
 */
export const DECIMAL_VALUE = /^-?\d{1,15}(\.\d{1,6})?$/;

/**
 * The report lifecycle, mirrored from `dia.guard_diagnostic_report_transition`.
 *
 * ## Why mirroring is correct HERE and wrong in `work-order`
 *
 * The work-order and job graphs live in `wo.work_order_transitions` and
 * `wo.job_transitions` — tenant-overridable catalog TABLES — so the `work-order`
 * module reads them and deliberately keeps no copy: a copy would refuse a tenant's
 * own edge and drift the moment one was added.
 *
 * This graph is different. It is a fixed PL/pgSQL `IF` chain inside
 * `dia.guard_diagnostic_report_transition`, with no catalog table and no tenant
 * override. It is code, and code can be mirrored — which is what every module
 * before P1-19 did with its own trigger-enforced graph.
 * `tests/db/p1-19-diagnostic-graph-reconciliation.test.ts` pins this object
 * against the DEPLOYED function body, so an edit to the trigger that this does not
 * follow fails the build rather than silently making the API lie.
 */
export const REPORT_TRANSITIONS: Readonly<Record<string, readonly ReportStatus[]>> = Object.freeze({
  draft: Object.freeze(['in_progress', 'cancelled'] as const),
  in_progress: Object.freeze(['completed', 'cancelled'] as const),
  completed: Object.freeze([] as const),
  cancelled: Object.freeze([] as const),
});

/** Report statuses that still accept entries — results, measurements, DTCs, findings. */
export const RECORDABLE_REPORT_STATUSES: readonly ReportStatus[] = Object.freeze([
  'draft',
  'in_progress',
]);

/**
 * The `dia.template_items.validation_rule` contract, defined by THIS phase.
 *
 * The column is nullable `jsonb` with no CHECK and no seeded row anywhere, so its
 * shape is not a schema fact — it is a decision, and it is written down here rather
 * than implied by the code that reads it. Every key is optional:
 *
 * - `min` / `max` bound a `numeric` item's reading. Accepted as a JSON number OR a
 *   decimal string, and always compared **in the database** as `numeric`, because
 *   the column is unbounded `numeric` and IEEE-754 cannot represent every value it
 *   holds.
 * - `options` closes a `select` item's answer set.
 *
 * A rule with none of these keys is treated as no rule at all: `within_range` stays
 * NULL, because `false` would assert an out-of-spec reading that nobody checked.
 */
export interface ValidationRule {
  readonly min?: number | string;
  readonly max?: number | string;
  readonly options?: readonly string[];
}

/** Reads a `validation_rule` jsonb value as a rule, or null when it holds none. */
export function asValidationRule(value: unknown): ValidationRule | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const rule = value as Record<string, unknown>;
  const min = rule['min'];
  const max = rule['max'];
  const options = rule['options'];
  const result: {
    min?: number | string;
    max?: number | string;
    options?: readonly string[];
  } = {};
  if (typeof min === 'number' || typeof min === 'string') result.min = min;
  if (typeof max === 'number' || typeof max === 'string') result.max = max;
  if (Array.isArray(options) && options.every((entry) => typeof entry === 'string')) {
    result.options = options as readonly string[];
  }
  return result.min === undefined && result.max === undefined && result.options === undefined
    ? null
    : result;
}

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
    // Item codes go in `violations` because `message` never reaches the caller.
    // The header above argues that a technician told 'not yet' without knowing
    // which of forty items is missing has been told nothing; an earlier version of
    // this function then built exactly that error. The item code is the template's
    // own identifier, which the caller is already reading to fill the report in.
    safeDetails: {
      violations: outstanding.map((item) => ({
        path: `items.${item.itemCode}`,
        rule: 'mandatory_item_unresolved',
      })),
    },
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

/**
 * Refuses a report movement the fixed lifecycle does not allow.
 *
 * `ERR-TRN-001`, whose registered meaning is "the target is registered for this
 * aggregate but the aggregate is not in a state the transition may start from —
 * including the case where it is already in the target state". A second completion
 * and a `completed → in_progress` reopening are both exactly that.
 */
export function assertReportTransition(fromStatus: string, toStatus: ReportStatus): void {
  const allowed = REPORT_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `A diagnostic report in "${fromStatus}" may not become "${toStatus}"`,
    });
  }
}

/**
 * Refuses an entry against a report that is no longer recordable.
 *
 * The database does NOT enforce this: `dia.report_item_results`, `dia.measurements`,
 * `dia.dtc_records`, `dia.findings` and `dia.diagnostic_evidence` all reference the
 * report by foreign key and none of them consults its status. So a completed
 * report would silently accept new results, changing what a "completed" report says
 * after the fact and after it was reviewed — which is the whole reason completion
 * means anything. This is an application rule, and it is stated as one.
 */
export function assertRecordable(status: string): void {
  if (RECORDABLE_REPORT_STATUSES.includes(status as ReportStatus)) return;
  throw new AppFailure('ERR-TRN-001', {
    message: `A diagnostic report that is "${status}" no longer accepts entries`,
  });
}

/**
 * Refuses a review by the person who authored the report.
 *
 * ## This is an application rule, and the schema cannot express it
 *
 * `dia.stamp_review()` makes attribution unforgeable — it overwrites `reviewer_id`
 * with `iam.current_user_id()` on every insert and raises without an actor — but
 * nothing in the schema stops the report's own author being that actor.
 * `dia.diagnostic_reports.created_by` is the only comparison available, and no
 * constraint references it.
 *
 * So separation is enforced here, against that column, and the honest limits are
 * worth stating: it compares the report's CREATOR, not everyone who recorded an
 * entry on it, because the schema records no per-entry authorship the review could
 * be checked against beyond each row's own `created_by`. A reviewer who recorded
 * some of the results but did not create the report is not caught.
 */
export function assertReviewerSeparation(reportCreatedBy: string, reviewerId: string): void {
  if (reportCreatedBy !== reviewerId) return;
  throw new AppFailure('ERR-QMS-001', {
    message: 'A diagnostic report may not be reviewed by the person who created it',
    safeDetails: { violations: [{ path: 'reviewer', rule: 'self_review' }] },
  });
}

/**
 * Refuses a result whose value does not fit the item it answers.
 *
 * The database checks only that a result row carries a value OR a not-applicable
 * reason. It does not check the value against the item's `response_type`, so a
 * `boolean` item would accept "maybe" and a `select` item any string at all.
 *
 * ## An item RESULT carries no range verdict at all, and that is a schema fact
 *
 * Numeric bounds are not checked here — and, unlike a MEASUREMENT, they are not
 * checked in the database either. `dia.report_item_results.result_value` is `text`
 * with one CHECK (`ck_report_item_results_answered`) and two triggers, neither of
 * which reads `dia.template_items.validation_rule`; the table has no `within_range`
 * column to record a verdict in. `dia.measurements` does, which is why the same
 * number entered there against the same item IS flagged.
 *
 * That asymmetry is the frozen schema's, not a choice this module made, and it is
 * written down rather than papered over: an earlier draft of this comment claimed
 * the database compared item results against `min`/`max`, which was false in three
 * places at once. Refusing an out-of-range answer instead would contradict the rule
 * the rest of the module follows — an out-of-spec observation is RECORDED, because a
 * diagnostic exists to record what is wrong — and storing a verdict would need a
 * column no migration in this phase may add.
 *
 * What this function checks is SHAPE, and for `select` the closed option set — both
 * of which are exact in TypeScript.
 */
export function assertResultShape(
  responseType: ResponseType,
  value: string,
  rule: ValidationRule | null
): void {
  const violation = (rulename: string): never => {
    throw new AppFailure('ERR-VAL-001', {
      message: `Value does not fit a "${responseType}" item`,
      safeDetails: { violations: [{ path: 'body.resultValue', rule: rulename }] },
    });
  };
  if (responseType === 'numeric' && !DECIMAL_VALUE.test(value)) violation('not_a_decimal');
  if (responseType === 'boolean' && value !== 'true' && value !== 'false') {
    violation('not_a_boolean');
  }
  if (responseType === 'select') {
    const options = rule?.options;
    // No option set configured means the item is a free-text selection as far as
    // this phase can tell. Refusing every value would make such an item unanswerable
    // and would make its mandatory completion gate impossible to clear.
    if (options !== undefined && !options.includes(value)) violation('not_an_option');
  }
}
