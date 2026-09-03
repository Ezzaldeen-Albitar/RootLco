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

/**
 * Roster field bounds (BR-03). Each mirrors a CHECK on tech.technician_profiles:
 * the columns are text with a not-blank constraint and no length limit in the
 * schema, so the API is the narrower authority and says so here rather than in a
 * route, where two routes would drift.
 */
export const MAX_TRADE = 64;
export const MAX_EMPLOYMENT_REF = 64;
export const MAX_CERTIFICATE_NUMBER = 128;

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

/** The UTC calendar day of an instant, as `YYYY-MM-DD`. */
export function utcCalendarDay(at: Date): string {
  return at.toISOString().slice(0, 10);
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
 *
 * ## Why this takes a string and not a Date
 *
 * An earlier version took the driver's `Date` and read it with `getUTCDate()`.
 * That was wrong everywhere east of Greenwich, and this repository's own machine
 * proves it: `pg-types` routes OID 1082 through `postgres-date`, which builds
 * `new Date(year, month - 1, day)` — **local** midnight, deliberately. At UTC+3,
 * `DATE '2026-07-26'` becomes `2026-07-25T21:00:00Z`, `getUTCDate()` returns 25,
 * and a certification valid through the 26th was refused on the 26th. Exactly the
 * failure the docblock above promised could not happen.
 *
 * The repository now selects `to_char(expires_on, 'YYYY-MM-DD')`, so a calendar
 * date crosses the boundary as the calendar date it is, with no instant to
 * misread. ISO-8601 dates compare correctly as strings, so no arithmetic is
 * needed either.
 *
 * The work instant's day is taken in **UTC**, which is a stated assumption rather
 * than a silent one: no tenant timezone is plumbed to this layer yet. For a
 * workshop east of UTC this is at worst generous by the offset, late in the local
 * evening of the expiry day — the same direction as the inclusive contract.
 */
export function certificationIsValidOn(
  expiresOn: string | null,
  status: CertificationStatus,
  at: Date
): boolean {
  // A withdrawn or lapsed credential never qualifies, whatever the date says. The
  // status column records an administrative decision that can precede the printed
  // expiry — a body may revoke or lapse a credential early — so it is checked
  // first and for BOTH branches. An earlier version consulted it only when
  // `expiresOn` was null, which let a row marked `expired` with a future date pass.
  if (status !== 'active') return false;
  if (expiresOn === null) return true;
  return utcCalendarDay(at) <= expiresOn;
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

export interface Interval {
  readonly from: Date;
  readonly to: Date;
}

/**
 * Is the window covered by the UNION of the given intervals?
 *
 * A single-row check is not enough, and the schema is what makes that so:
 * `ex_technician_availability_overlap` excludes on `tstzrange(from, to)` with
 * `&&`, and half-open ranges `[08:00,12:00)` and `[12:00,17:00)` do not overlap.
 * A split shift is therefore two perfectly legal rows, and asking whether any
 * ONE of them spans 09:00–13:00 answers no for a technician who is available for
 * every minute of it.
 *
 * So the intervals are sorted and walked, extending a running cursor across
 * touching or overlapping rows and stopping at the first real gap. Touching
 * counts as contiguous — `to === from` leaves no uncovered instant between them.
 */
export function coveredByUnion(
  intervals: readonly Interval[],
  windowFrom: Date,
  windowTo: Date
): boolean {
  if (windowTo.getTime() <= windowFrom.getTime()) return false;
  const sorted = [...intervals].sort((a, b) => a.from.getTime() - b.from.getTime());
  let cursor = windowFrom.getTime();
  for (const interval of sorted) {
    if (cursor >= windowTo.getTime()) return true;
    // A row starting after the cursor leaves a gap; because the list is sorted,
    // no later row can fill it either.
    if (interval.from.getTime() > cursor) return false;
    cursor = Math.max(cursor, interval.to.getTime());
  }
  return cursor >= windowTo.getTime();
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
    // The reasons go in `violations`, not only in `message`. `message` is log-only —
    // `problemFor` never reads it — so an earlier version of this function promised
    // 'a precise 422 with the reasons named' and delivered a bare title. `violations`
    // is the caller-visible half of the closed SafeDetails shape and its `rule` is
    // documented as a stable machine code, which is exactly what an ineligibility
    // reason is. Without this the complete-rather-than-short-circuit design bought
    // nothing: the caller still learned one fact per request.
    safeDetails: {
      violations: findings.map((finding) => ({
        path:
          finding.subject === undefined
            ? 'body.technicianProfileId'
            : `requirement.${finding.subject}`,
        rule: finding.reason,
      })),
    },
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
