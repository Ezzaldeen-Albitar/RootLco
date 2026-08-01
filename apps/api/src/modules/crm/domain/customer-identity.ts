/**
 * CRM duplicate detection, merge, and vehicle linkage — domain contract
 * (Phase 1-16, FR-CRM-003, FR-VEH-003, P1-16-BE-013…018).
 *
 * ## Duplicate scoring is deterministic and explainable
 *
 * The score is computed from a fixed, weighted set of comparisons over data the
 * tenant already holds. There is no model, no training set, and no hidden
 * state: the same two customers always score the same, and `match_basis`
 * records *which* comparisons fired. That matters because a human has to act on
 * the result — "these look like the same person" is only actionable if you can
 * see why the system thinks so, and only defensible if it did not change its
 * mind between two runs.
 *
 * Nothing here decides anything. Scoring produces candidates; a person reviews
 * them; a merge is a separate, separately-permissioned operation. There is no
 * path from "high score" to "records combined" that does not pass through a
 * human.
 */

/** Values `ck_duplicate_candidates_status` accepts. */
export const DUPLICATE_STATUSES = ['open', 'dismissed', 'merged'] as const;
export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];

/** Decisions a reviewer may record. `merged` is set by the merge, not here. */
export const DUPLICATE_DECISIONS = ['dismissed'] as const;
export type DuplicateDecision = (typeof DUPLICATE_DECISIONS)[number];

/** `ck_vehicle_relationships_role`. */
export const VEHICLE_RELATIONSHIP_ROLES = [
  'owner',
  'user',
  'driver',
  'fleet_operator',
  'payer',
  'authorized_person',
  'service_requester',
] as const;
export type VehicleRelationshipRole = (typeof VEHICLE_RELATIONSHIP_ROLES)[number];

/** Timeline `event_type` values, from `ck_timeline_events_type`. */
export const TIMELINE_EVENT_TYPES = [
  'lifecycle_changed',
  'commercial_changed',
  'consent_changed',
  'blocked',
  'unblocked',
  'alert_raised',
  'merged',
  'communication_logged',
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

/**
 * Weighted signals the scorer compares.
 *
 * Weights sum to 1 so the score lands in `[0, 1]` and satisfies
 * `ck_duplicate_candidates_score` without clamping — a clamp would hide a
 * weighting mistake instead of surfacing it.
 */
export const MATCH_SIGNALS = Object.freeze({
  normalized_name: 0.5,
  contact_value: 0.35,
  address_line: 0.15,
});

/** The score below which a pair is not worth a human's attention. */
export const CANDIDATE_THRESHOLD = 0.5;

export interface MatchSignalHit {
  readonly signal: keyof typeof MATCH_SIGNALS;
  readonly weight: number;
}

export class CustomerIdentityError extends Error {
  constructor(
    readonly path: string,
    readonly rule: string,
    message: string
  ) {
    super(message);
    this.name = 'CustomerIdentityError';
  }
}

/**
 * Scores one pair from the signals that fired.
 *
 * Rounded to four decimals to match `numeric(5,4)` exactly, so the value stored
 * is the value computed — a silently truncated score would make the stored
 * evidence disagree with the rule that produced it.
 */
export function scorePair(hits: readonly MatchSignalHit[]): number {
  const total = hits.reduce((sum, hit) => sum + hit.weight, 0);
  return Math.round(Math.min(total, 1) * 10_000) / 10_000;
}

/**
 * Orders a pair to satisfy `ck_duplicate_candidates_order` (`a < b`).
 *
 * The constraint exists so one pair cannot be recorded twice under two
 * orderings; normalising here means the caller never has to think about it and
 * cannot accidentally create the mirror-image duplicate of a duplicate.
 */
export function orderPair(x: string, y: string): { a: string; b: string } {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

/**
 * Validates a merge request before any row is touched.
 *
 * Same-record merge and cross-tenant merge are refused here as well as by the
 * database, because a caller deserves an explained refusal rather than a
 * constraint violation — and because the merge is destructive enough that two
 * independent checks are worth the duplication.
 */
export function assertMergeable(sourceId: string, survivorId: string): void {
  if (sourceId === survivorId) {
    throw new CustomerIdentityError(
      'body.survivorId',
      'same_record_merge',
      'A customer cannot be merged into itself'
    );
  }
}
