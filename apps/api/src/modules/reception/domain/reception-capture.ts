/**
 * Reception capture contract — vocabularies and bounds (Owner decisions FE-012,
 * FE-018, FE-019).
 *
 * This module owns the words and the limits; it owns no command shapes and no
 * SQL. Every value here has a counterpart CHECK in
 * `20260815100000_rec_reception_evidence_contracts.sql`, and the mapping from a
 * capture requirement to the document category that may satisfy it is stated
 * once, here and in `rec.guard_reception_evidence_binding()`. The database is
 * the authority; this copy exists so a wrong category is a named 422 instead of
 * a CHECK violation surfacing as an incoherent-reference error.
 *
 * Where the two could drift, `tests/db/rec-evidence-contracts.test.ts` reads the
 * constraint out of `pg_constraint` and compares.
 */

/** Capture requirements a reception visit can be asked to evidence. */
export const CAPTURE_REQUIREMENTS = [
  'exterior',
  'dashboard_odometer',
  'ev_soc',
  'warning_lamp',
  'vin',
  'damage',
] as const;
export type CaptureRequirement = (typeof CAPTURE_REQUIREMENTS)[number];

/**
 * The policy vocabulary is the capture set PLUS refusal supporting media.
 *
 * Refusal media is a policy subject but never an evidence binding: a refusal
 * carries its own document columns on `rec.refusals`, and
 * `ck_reception_evidence_binding_requirement` deliberately excludes it.
 */
export const CAPTURE_POLICY_REQUIREMENTS = [
  ...CAPTURE_REQUIREMENTS,
  'refusal_supporting_evidence',
] as const;
export type CapturePolicyRequirement = (typeof CAPTURE_POLICY_REQUIREMENTS)[number];

/** Refusal kinds a policy rule may narrow to. Mirrors `ck_refusals_type`. */
export const CAPTURE_POLICY_REFUSAL_TYPES = [
  'inspection_item',
  'signature',
  'intake_step',
  'authorization',
  'other',
] as const;
export type CapturePolicyRefusalType = (typeof CAPTURE_POLICY_REFUSAL_TYPES)[number];

/** Whether a rule applies to the whole tenant or to one branch. */
export const CAPTURE_POLICY_SCOPES = ['tenant', 'branch'] as const;
export type CapturePolicyScope = (typeof CAPTURE_POLICY_SCOPES)[number];

/**
 * Which document category may satisfy which requirement.
 *
 * `satisfies` rather than an annotation, so the keys stay a literal union and a
 * requirement added above without a category here is a compile error rather
 * than a silently unmapped value (`P1-27-INT-113`).
 */
export const CAPTURE_CATEGORY_BY_REQUIREMENT = Object.freeze({
  exterior: 'reception_exterior',
  dashboard_odometer: 'reception_dashboard',
  ev_soc: 'reception_dashboard',
  warning_lamp: 'reception_dashboard',
  vin: 'reception_vin',
  damage: 'reception_damage',
  refusal_supporting_evidence: 'reception_refusal_evidence',
} as const satisfies Record<CapturePolicyRequirement, string>);

/** The category a managed damage-map template revision must be published under. */
export const DAMAGE_MAP_TEMPLATE_CATEGORY = 'reception_damage_map_template';

/** The entity type a template document links to. Mirrors `LINKABLE_ENTITY_TYPES`. */
export const DAMAGE_MAP_TEMPLATE_ENTITY_TYPE = 'rec.damage_map_templates';

export interface BaselineCaptureRule {
  readonly requirementCode: CapturePolicyRequirement;
  readonly minCount: number;
  readonly deviceCapturedAtRequired: boolean;
}

/**
 * What a branch is expected to capture when it has configured nothing.
 *
 * This is a READ-MODEL default, not a seed: no row is written for it, and
 * `rec.capture_policy_rules` ships empty like every other business table. A
 * tenant that configures nothing therefore sees a stated expectation and is
 * blocked by none of it — `refusal_supporting_evidence` is `0` here for exactly
 * the reason FE-019 gives, and the database default is the ABSENCE of a rule
 * rather than this row.
 */
export const BASELINE_CAPTURE_RULES: readonly BaselineCaptureRule[] = Object.freeze([
  { requirementCode: 'exterior', minCount: 7, deviceCapturedAtRequired: true },
  { requirementCode: 'dashboard_odometer', minCount: 1, deviceCapturedAtRequired: true },
  { requirementCode: 'ev_soc', minCount: 1, deviceCapturedAtRequired: true },
  { requirementCode: 'warning_lamp', minCount: 1, deviceCapturedAtRequired: true },
  { requirementCode: 'vin', minCount: 1, deviceCapturedAtRequired: true },
  { requirementCode: 'damage', minCount: 1, deviceCapturedAtRequired: true },
  { requirementCode: 'refusal_supporting_evidence', minCount: 0, deviceCapturedAtRequired: true },
]);

/** Damage-map geometry kinds. Mirrors `ck_damage_map_templates_type`. */
export const DAMAGE_MAP_TYPES = ['exterior', 'interior', 'undercarriage', 'other'] as const;
export type DamageMapTemplateType = (typeof DAMAGE_MAP_TYPES)[number];

/** Lifecycle of a template slot and of one of its revisions. */
export const DAMAGE_MAP_TEMPLATE_STATUSES = ['active', 'retired'] as const;
export type DamageMapTemplateStatus = (typeof DAMAGE_MAP_TEMPLATE_STATUSES)[number];

/**
 * Legibility of one captured VIN plate.
 *
 * `unreadable` exists only for `vin`, because a VIN plate that cannot be read is
 * itself the finding. `ck_reception_evidence_binding_quality` enforces that.
 */
export const CAPTURE_QUALITY_STATUSES = ['readable', 'unreadable'] as const;
export type CaptureQualityStatus = (typeof CAPTURE_QUALITY_STATUSES)[number];

/** Signature lifecycle events. Mirrors `ck_signature_event_type`. */
export const SIGNATURE_EVENT_TYPES = ['finalized', 'repudiated'] as const;
export type SignatureEventType = (typeof SIGNATURE_EVENT_TYPES)[number];

/** What a signature read-back reports. Derived, never stored. */
export const SIGNATURE_STATUSES = ['draft', 'finalized', 'repudiated'] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

/*
 * `EVIDENCE_USABLE_VERSION_STATES` and `EVIDENCE_FINAL_VERSION_STATE` stood
 * here, and are gone.
 *
 * ## Nothing consumed them, and the docblock above them was wrong three times
 *
 * Repository-wide the two names occurred in exactly two places: this
 * declaration, and the re-export in this module's barrel. No route validated
 * against them, no service compared to them, no test named them. That is the
 * shape this repository has now removed four times — `crm/customers/
 * identity-api.ts` (`P1-27-QA-002`), `listVisitReasons` and
 * `conditionEvidenceKinds` (`P1-28-F9`), and the attachments version read-back
 * in the same wave as this one: a declaration that READS as a rule while
 * nothing enforces it.
 *
 * Here the prose made that actively misleading rather than merely inert, and
 * each of its three claims is refutable against a file in this repository:
 *
 *   - it said `ck_document_versions_status` "admits exactly these four" over an
 *     array holding TWO members. Migration 121
 *     (`20260815090000_shared_reception_evidence_foundation.sql`) rewrote that
 *     constraint, and it admits FIVE — `pending`, `scanning`, `accepted`,
 *     `quarantined`, `rejected`. The sentence disagreed with the constraint, and
 *     with the array beneath it, in different directions at once;
 *   - it said "there is no `scanning` state". There is. The same migration adds
 *     the member and the `scanning_at` column, `shared.begin_document_scan`
 *     writes it, and the product ships copy for it — `DOCUMENT_VERSION_STATUSES`
 *     in `apps/web/src/features/attachments/attachments-contract.ts` carries all
 *     five, and `isSettled` exists precisely to tell a stalled `pending` from a
 *     version still moving through it;
 *   - it named `shared.document_scan_results`, which is not a relation this
 *     database has. The append-only verdict history is
 *     `shared.file_scan_results` (`20260718101000`).
 *
 * ## Why nothing replaces them
 *
 * This module owns the words the ROUTES validate against, and a document
 * version state is not one of them — it belongs to `shared`, and no route here
 * can check it without first reading a version it was not given. Which states
 * may be bound and which may be finalized is decided inside the write, where
 * the decision cannot be skipped: `rec.guard_reception_evidence_binding`
 * refuses a binding whose version is not `pending` or `accepted` and refuses a
 * finalization of anything other than `accepted`, and
 * `rec.guard_signature_evidence` and `rec.guard_signature_event` do the same for
 * a signature. A second copy checked by nobody could only ever drift away from
 * that, which is exactly what it had already done.
 */

export const MAX_CAPTURE_COUNT = 20;
export const MAX_CAPTURE_OVERRIDE_REASON = 1000;
export const MAX_REPUDIATION_REASON = 1000;
/** Same bound as `MAX_MAP_TYPE`: both are short descriptors of one map. */
export const MAX_TEMPLATE_PERSPECTIVE = 64;
