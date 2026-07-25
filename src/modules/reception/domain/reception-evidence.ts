/**
 * Pre-service condition-evidence rules (Phase 1-18, P1-18-BE-011…P1-18-BE-017).
 *
 * Pure. Every vocabulary below is copied from a frozen Phase 1-8 CHECK
 * constraint so an invalid value is a 422 with a named field rather than a
 * database error string leaking a constraint name to the caller.
 *
 * What this layer deliberately does NOT model, because the schema does not and
 * inventing it would be asserting facts nobody established:
 *
 *  - who caused a damage mark, or when it happened;
 *  - any insurance, liability, or fraud judgement;
 *  - any repair cost;
 *  - any diagnosis. A complaint is what the customer reported. An inspection
 *    finding is what staff observed. They are separate tables for that reason
 *    and this module never promotes one into the other.
 */

/** Frozen `ck_complaints_category` / `ck_complaints_severity`. */
export const COMPLAINT_CATEGORIES = [
  'mechanical',
  'electrical',
  'body',
  'noise',
  'performance',
  'other',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export const COMPLAINT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ComplaintSeverity = (typeof COMPLAINT_SEVERITIES)[number];

/** Frozen `ck_condition_items_category` / `ck_condition_items_severity`. */
export const FINDING_CATEGORIES = [
  'scratch',
  'dent',
  'crack',
  'wear',
  'missing_part',
  'malfunction',
  'other',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export const FINDING_SEVERITIES = ['minor', 'moderate', 'major', 'critical'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** Frozen `ck_damage_marks_type`. */
export const DAMAGE_MARK_TYPES = [
  'scratch',
  'dent',
  'crack',
  'chip',
  'rust',
  'missing',
  'other',
] as const;
export type DamageMarkType = (typeof DAMAGE_MARK_TYPES)[number];

/** Frozen `ck_leak_observations_severity` shares the finding vocabulary. */
export const LEAK_SEVERITIES = FINDING_SEVERITIES;

/** Frozen `ck_leak_observations_type`. */
export const LEAK_TYPES = [
  'oil',
  'coolant',
  'fuel',
  'brake_fluid',
  'transmission',
  'water',
  'other',
] as const;
export type LeakType = (typeof LEAK_TYPES)[number];

/**
 * Frozen `ck_warning_light_observations_state`. A lamp is recorded as observed —
 * on, flashing, or intermittent — and nothing is inferred from it. Which fault a
 * lamp indicates is diagnosis, which belongs to a later phase and to a
 * technician, not to intake.
 */
export const WARNING_LIGHT_STATES = ['on', 'flashing', 'intermittent'] as const;
export type WarningLightState = (typeof WARNING_LIGHT_STATES)[number];

/**
 * Frozen `ck_damage_maps_type`. A closed vocabulary, not free text: a damage map
 * is bound to an exact immutable document version, and the map type is what tells
 * a reader which template those coordinates are relative to.
 */
export const DAMAGE_MAP_TYPES = ['exterior', 'interior', 'undercarriage', 'other'] as const;
export type DamageMapType = (typeof DAMAGE_MAP_TYPES)[number];

/** Frozen `ck_signatures_role`, `_capture`, `_purpose`. */
export const SIGNER_ROLES = [
  'service_requester',
  'vehicle_owner',
  'authorized_receiver',
  'payer',
  'approving_party',
  'receiving_employee',
  'other',
] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];
export const SIGNATURE_CAPTURE_METHODS = ['drawn', 'typed', 'uploaded', 'biometric'] as const;
export type SignatureCaptureMethod = (typeof SIGNATURE_CAPTURE_METHODS)[number];
export const SIGNATURE_PURPOSES = [
  'reception_acknowledgement',
  'custody_acceptance',
  'authorization',
  'refusal_witness',
  'condition_agreement',
  'other',
] as const;
export type SignaturePurpose = (typeof SIGNATURE_PURPOSES)[number];

/** Frozen `ck_refusals_type`. */
export const REFUSAL_TYPES = [
  'inspection_item',
  'signature',
  'intake_step',
  'authorization',
  'other',
] as const;
export type RefusalType = (typeof REFUSAL_TYPES)[number];

/**
 * The evidence kinds a single `condition-evidence` command accepts. Canonical
 * Field 23 allocates ONE endpoint for pre-service condition evidence, so the
 * command is a discriminated union rather than six endpoints. Signature and
 * refusal are deliberately NOT members: they record what a party personally
 * acknowledged or declined, carry their own high-risk permission, and must never
 * be reachable by a caller who only holds evidence-capture authority.
 */
export const EVIDENCE_KINDS = [
  'complaint',
  'inspection',
  'condition_item',
  'damage_map',
  'damage_mark',
  'contents',
  'warning_light',
  'leak',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const MAX_NOTE = 2000;
export const MAX_ZONE = 64;
export const MAX_LOCATION = 120;
export const MAX_MAP_TYPE = 40;
export const MAX_ITEM_DESCRIPTION = 500;
export const MAX_COMPLAINT_TEXT = 4000;
export const MIN_COORD = 0;
export const MAX_COORD = 1;

/**
 * Upper bounds taken from the COLUMN, because the frozen CHECKs supply only a
 * lower one — `ck_vehicle_contents_quantity` is `quantity > 0` and
 * `ck_vehicle_content_details_value_nonneg` is `declared_value >= 0`. Without
 * these the value that stops the write is `rec.vehicle_contents.quantity`'s
 * `integer` and `rec.vehicle_content_details.declared_value`'s `numeric(14, 2)`,
 * and PostgreSQL reports that as `22003`, which nothing maps — so a caller
 * sending a large number gets a 500 and an exception-monitor incident instead of
 * a named field. `evSocPercent` and the damage-mark coordinates are already
 * bounded on both sides for the same reason; these two were the omissions.
 */
export const MAX_CONTENT_QUANTITY = 2_147_483_647;
export const MAX_DECLARED_VALUE = 999_999_999_999.99;

export class EvidenceRuleError extends Error {
  public override readonly name = 'EvidenceRuleError';
}

/** Mirrors the frozen `ck_damage_marks_coord_x` / `_coord_y` range. */
export function assertCoordinate(value: number, field: string): void {
  if (!Number.isFinite(value) || value < MIN_COORD || value > MAX_COORD) {
    throw new EvidenceRuleError(
      `${field} must be a fraction of the map between ${MIN_COORD} and ${MAX_COORD}`
    );
  }
}

/**
 * Several frozen CHECKs forbid a blank-but-present text (`btrim(x) <> ''`).
 * Returning the trimmed value keeps the stored form and the validated form the
 * same string — a check that validates one value and stores another is how a
 * blank slips past.
 */
export function requireNonBlank(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new EvidenceRuleError(`${field} must not be blank`);
  }
  if (trimmed.length > max) {
    throw new EvidenceRuleError(`${field} must be at most ${max} characters`);
  }
  return trimmed;
}

export function optionalNonBlank(
  value: string | null | undefined,
  field: string,
  max: number
): string | null {
  if (value === undefined || value === null) return null;
  return requireNonBlank(value, field, max);
}

/** Mirrors `ck_vehicle_contents_quantity`, plus the `integer` column's ceiling. */
export function assertQuantity(value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_CONTENT_QUANTITY) {
    throw new EvidenceRuleError(
      `quantity must be a whole number between 1 and ${MAX_CONTENT_QUANTITY}`
    );
  }
}

/** Mirrors `ck_vehicle_content_details_value_nonneg`, plus `numeric(14, 2)`. */
export function assertDeclaredValue(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > MAX_DECLARED_VALUE) {
    throw new EvidenceRuleError(`declaredValue must be between 0 and ${MAX_DECLARED_VALUE}`);
  }
}
