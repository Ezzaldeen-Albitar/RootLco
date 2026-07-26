/**
 * Technician eligibility and labor domain rules (Phase 1-19, P1-19-BE-001).
 *
 * Pure: no database access, no I/O.
 *
 * Eligibility is decided from rows the `tech` schema owns — skills, skill levels,
 * certifications and availability intervals — so the *data* always comes from the
 * repository. What lives here is the arithmetic and the boundary semantics, which
 * are where eligibility bugs actually hide: whether an expiry on the boundary day
 * counts, whether a rank comparison is inclusive, whether a half-open interval
 * includes its end.
 *
 * Every vocabulary below was read from `pg_constraint`, not from a specification.
 */
import { AppFailure } from '@/server/errors/app-failure';

/** Frozen `ck_technician_certifications_status` vocabulary. */
export const CERTIFICATION_STATUSES = ['active', 'expired', 'revoked'] as const;
export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];

/** Frozen `ck_technician_availability_kind` vocabulary. */
export const AVAILABILITY_KINDS = ['available', 'unavailable'] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];

/** Frozen `ck_skills_status` / `ck_skill_levels_status` / `ck_certifications_status`. */
export const CATALOG_STATUSES = ['active', 'inactive'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/** Frozen `ck_labor_sessions_source` vocabulary. Owned here: tech.labor_sessions is this module's table. */
export const LABOR_SOURCES = ['manual', 'timer', 'correction'] as const;
export type LaborSource = (typeof LABOR_SOURCES)[number];

export const MAX_UNAVAILABILITY_REASON = 500;

/** Why a technician was refused. One code per independent reason. */
export const INELIGIBILITY_REASONS = [
  'profile-inactive',
  'profile-out-of-scope',
  'skill-missing',
  'skill-level-insufficient',
  'certification-missing',
  'certification-expired',
  'certification-revoked',
  'availability-missing',
  'availability-blocked',
] as const;
export type IneligibilityReason = (typeof INELIGIBILITY_REASONS)[number];

export interface EligibilityFinding {
  readonly reason: IneligibilityReason;
  /** Catalog code of the skill or certification at fault, when one applies. */
  readonly subject?: string;
}

/**
 * Certification expiry, decided on the boundary rather than around it.
 *
 * `expires_on` is a DATE and the contract is **inclusive**: a certification that
 * expires on the day work is performed is still valid that day. Treating it as
 * exclusive would refuse a technician who is, in every real sense, certified —
 * and the off-by-one would only ever surface on the one day it matters.
 *
 * `expires_on IS NULL` means the certification does not expire.
 */
export function certificationIsValidOn(
  expiresOn: Date | null,
  status: CertificationStatus,
  at: Date
): boolean {
  if (status === 'revoked') return false;
  if (expiresOn === null) return status === 'active';
  // Compare calendar days, not instants: a DATE has no time-of-day, and comparing
  // it against a timestamp would make validity depend on the hour of the request.
  const expiryDay = Date.UTC(
    expiresOn.getUTCFullYear(),
    expiresOn.getUTCMonth(),
    expiresOn.getUTCDate()
  );
  const workDay = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  return workDay <= expiryDay;
}

/**
 * Skill sufficiency: the held rank must be at least the required rank.
 *
 * `tech.skill_levels.rank` is an integer where higher means more senior. The
 * comparison is inclusive — holding exactly the required level qualifies.
 */
export function skillLevelSatisfies(heldRank: number, requiredRank: number): boolean {
  return heldRank >= requiredRank;
}

/**
 * Does an availability interval cover the whole requested window?
 *
 * `tech.technician_availability` stores `available_from` / `available_to` as
 * timestamps and the interval is treated as **half-open**, `[from, to)`, matching
 * how the `EXCLUDE` constraint on `tech.labor_sessions` reasons about overlap. A
 * window that ends exactly when availability ends is therefore covered; one that
 * starts exactly when availability ends is not.
 */
export function intervalCovers(
  availableFrom: Date,
  availableTo: Date,
  windowFrom: Date,
  windowTo: Date
): boolean {
  return (
    availableFrom.getTime() <= windowFrom.getTime() && windowTo.getTime() <= availableTo.getTime()
  );
}

/** Do two half-open intervals overlap? Used for `unavailable` blocks. */
export function intervalsOverlap(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date): boolean {
  return aFrom.getTime() < bTo.getTime() && bFrom.getTime() < aTo.getTime();
}

/** Raised for a rule this layer can decide without the database. */
export class TechnicianRuleError extends Error {
  public override readonly name = 'TechnicianRuleError';
}

/**
 * Refuses an assignment whose eligibility findings are non-empty.
 *
 * Every finding is reported, not merely the first: an assigner who learns only
 * that a skill is missing, fixes it, and then learns the certification expired has
 * been made to discover one fact per round trip. The reasons are safe to disclose
 * — they name the caller's own request and the catalog codes it referenced, both
 * of which the caller already supplied or is authorized to read.
 */
export function assertEligible(findings: readonly EligibilityFinding[]): void {
  if (findings.length === 0) return;
  throw new AppFailure('ERR-TECH-001', {
    message: `Technician is ineligible: ${findings.map((f) => f.reason).join(', ')}`,
  });
}

/**
 * Refuses a labor window whose end precedes its start.
 *
 * The database's `EXCLUDE` constraint rejects a malformed range too, but it does
 * so as a `23P01` that reads like a conflict with another session rather than
 * like the malformed input it is.
 */
export function assertLaborWindow(startedAt: Date, endedAt: Date | null): void {
  if (endedAt !== null && endedAt.getTime() <= startedAt.getTime()) {
    throw new AppFailure('ERR-VAL-001', {
      message: 'A labor session must end after it starts',
      safeDetails: { violations: [{ path: 'body.endedAt', rule: 'after_start' }] },
    });
  }
}
