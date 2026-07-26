/**
 * Quality control, closure and rework domain rules (Phase 1-19, P1-19-BE-001).
 *
 * Pure: no database access, no I/O.
 *
 * Every vocabulary below was read from `pg_constraint`, not from a specification.
 *
 * ## Two invariants this module exists to keep honest
 *
 * 1. **A closed work order is never reopened** (BR-WO-002). `qms.attempt_reopen`
 *    records the attempt in `qms.reopen_attempts` and never mutates the order.
 *    There is no code path here that sets a state backwards.
 * 2. **Safety-critical rework needs a second pair of eyes** (BR-QMS-001).
 *    `qms.guard_rework_signoff` refuses a sign-off by the person who did the work;
 *    `assertIndependentSignOff` refuses it earlier, with a readable reason.
 */
import { AppFailure } from '@/server/errors/app-failure';

/** Frozen `ck_quality_control_records_result` vocabulary. */
export const QC_OVERALL_RESULTS = ['pending', 'passed', 'failed'] as const;
export type QcOverallResult = (typeof QC_OVERALL_RESULTS)[number];

/** Frozen `ck_qc_check_results_result` vocabulary — `na`, not `not_applicable`. */
export const QC_CHECK_RESULTS = ['pass', 'fail', 'na'] as const;
export type QcCheckResult = (typeof QC_CHECK_RESULTS)[number];

/** Frozen `ck_qc_checks_status` / `ck_qc_checks_scope` companions. */
export const QC_CHECK_STATUSES = ['active', 'inactive'] as const;
export type QcCheckStatus = (typeof QC_CHECK_STATUSES)[number];

export const MAX_ROOT_CAUSE = 2000;
export const MAX_CORRECTIVE_ACTION = 2000;
export const MAX_REOPEN_REASON = 1000;
export const MAX_QC_NOTE = 2000;

/**
 * A finalized QC record is frozen.
 *
 * `ck_quality_control_records_finalized` pins the coupling: `pending` implies no
 * `finalized_at` and no `checker_id`; `passed` or `failed` implies both are set.
 * `qms.guard_qc_finalize` then prevents a finalized record changing. So a failed
 * check is never edited into a pass — a re-check is a NEW record, attributable to
 * whoever performed it, and the failed one stays in the ledger.
 */
export function assertNotFinalized(overallResult: QcOverallResult): void {
  if (overallResult === 'pending') return;
  throw new AppFailure('ERR-QMS-001', {
    message: `A finalized quality-control record cannot be changed (result "${overallResult}"); record a new check instead`,
  });
}

/**
 * Independent sign-off for safety-critical rework (BR-QMS-001).
 *
 * The person signing off must not be the lead technician who performed the work.
 * `qms.guard_rework_signoff` enforces this; refusing here first means the caller
 * gets `ERR-QMS-001` with a reason rather than a bare `23514`.
 *
 * Non-safety-critical rework has no independence requirement, and imposing one
 * would block routine corrections in a single-technician branch.
 */
export function assertIndependentSignOff(
  isSafetyCritical: boolean,
  leadTechnicianId: string | null,
  signOffBy: string | null
): void {
  if (!isSafetyCritical) return;
  if (signOffBy === null) {
    throw new AppFailure('ERR-QMS-001', {
      message: 'Safety-critical rework requires an independent sign-off',
    });
  }
  if (leadTechnicianId !== null && leadTechnicianId === signOffBy) {
    throw new AppFailure('ERR-QMS-001', {
      message: 'Safety-critical rework cannot be signed off by the technician who performed it',
    });
  }
}

/**
 * Refuses a reopen attempt.
 *
 * This function never succeeds — that is the point. BR-WO-002 admits no reopen,
 * so the only correct outcome is a refusal, and the only record of the attempt is
 * the row `qms.attempt_reopen` writes. Corrective work goes through a linked
 * rework work order instead, which preserves the closed order intact.
 */
export function refuseReopen(workOrderId: string): never {
  throw new AppFailure('ERR-QMS-001', {
    message: `Work order ${workOrderId} is closed and cannot be reopened (BR-WO-002); create a linked rework work order instead`,
  });
}

/** Refuses a reason that is absent or empty, for the reasons QMS records demand. */
export function assertReason(reason: string | undefined, path: string, max: number): string {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    throw new AppFailure('ERR-VAL-001', {
      message: `${path} is required`,
      safeDetails: { violations: [{ path, rule: 'required' }] },
    });
  }
  if (trimmed.length > max) {
    throw new AppFailure('ERR-VAL-001', {
      message: `${path} may not exceed ${max} characters`,
      safeDetails: { violations: [{ path, rule: 'max_length' }] },
    });
  }
  return trimmed;
}

/** Raised for a rule this layer can decide without the database. */
export class QualityRuleError extends Error {
  public override readonly name = 'QualityRuleError';
}
