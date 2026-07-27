/**
 * Service-catalog vocabulary (Phase 1-20, P1-20-BE-001…003).
 *
 * Every constant here is transcribed from a CHECK constraint on the frozen `svc`
 * schema, so the application refuses a bad value with a readable message instead
 * of surfacing a `check_violation` from four layers down. The transcription is
 * asserted against the live catalog in the database suite — a constant that
 * drifts from its constraint fails the build rather than rotting quietly.
 */

export class ServiceCatalogRuleError extends Error {
  public override readonly name = 'ServiceCatalogRuleError';
}

/** `ck_services_lifecycle`. `archived` is terminal — `svc.guard_service_lifecycle`. */
export const SERVICE_LIFECYCLE_STATES = Object.freeze(['active', 'archived'] as const);
export type ServiceLifecycleState = (typeof SERVICE_LIFECYCLE_STATES)[number];

/** `ck_service_versions_status`. */
export const SERVICE_VERSION_STATES = Object.freeze(['draft', 'published', 'archived'] as const);
export type ServiceVersionState = (typeof SERVICE_VERSION_STATES)[number];

/** `ck_service_categories_status`, `ck_branch_service_availability_status`, … */
export const ACTIVATION_STATES = Object.freeze(['active', 'inactive'] as const);
export type ActivationState = (typeof ACTIVATION_STATES)[number];

/**
 * `ck_services_code_format` / `ck_price_lists_code_format` / `ck_discount_rules_code_format`.
 * Mixed case is permitted for these external-facing codes.
 */
export const EXTERNAL_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;

/**
 * `ck_service_categories_code_format` and `customer_class` everywhere.
 * Lower snake only — these are internal identifiers, not printed codes.
 */
export const INTERNAL_CODE = /^[a-z][a-z0-9_]{1,62}$/;

/** Column widths, so a caller gets a 422 rather than a driver truncation error. */
export const MAX_NAME = 200;
export const MAX_DESCRIPTION = 2000;
export const MAX_NOTES = 2000;

/**
 * `ck_standard_labor_times_minutes` — strictly positive, `numeric(10,2)`.
 *
 * The unit is **minutes**, not hours. Stated here because it is the single most
 * likely place for a caller to be wrong by a factor of sixty, and the column name
 * is the only other place that says so.
 */
export const LABOR_TIME_UNIT = 'minutes';

/**
 * Effective-dating rule shared by `service_versions` and `price_list_versions`.
 *
 * `ck_*_range` is `effective_to IS NULL OR effective_to > effective_from`, and the
 * gist EXCLUDE uses `daterange(effective_from, effective_to, '[)')` — so the range
 * is **half-open**: a version effective `[2026-01-01, 2026-02-01)` does not cover
 * 1 February. Restated in code because an inclusive reading produces an off-by-one
 * that only shows up on the boundary day.
 */
export function assertEffectiveRange(from: string, to: string | undefined): void {
  if (to !== undefined && to <= from) {
    throw new ServiceCatalogRuleError(
      `effectiveTo (${to}) must be strictly after effectiveFrom (${from}); the range is half-open`
    );
  }
}

/**
 * A published version may not be edited.
 *
 * `svc.guard_service_version_freeze` and `svc.guard_price_list_version_freeze`
 * enforce it; this mirror exists so the application can refuse with
 * `ERR-TRN-001` and name the state, rather than letting the trigger raise.
 */
export function assertVersionEditable(status: string, what: string): void {
  if (status !== 'draft') {
    throw new ServiceCatalogRuleError(
      `${what} is ${status} and frozen; only a draft may be edited`
    );
  }
}
