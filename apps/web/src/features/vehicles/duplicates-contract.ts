/**
 * Vehicle duplicate review (`FE-028`) and vehicle timeline (`FE-029`).
 *
 * | operation                        | method | path                                   | permission                     |
 * | -------------------------------- | ------ | -------------------------------------- | ------------------------------ |
 * | `veh.vehicle-duplicate-list`     | GET    | `/vehicle-duplicates`                  | `veh.vehicle.duplicate.review` |
 * | `veh.vehicle-duplicate-review`   | POST   | `/vehicle-duplicates/{candidateId}/review` | `veh.vehicle.duplicate.review` |
 * | `veh.vehicle-history`            | GET    | `/vehicles/{id}/history`               | `veh.vehicle.read`             |
 *
 * ## `FE-028`: no merge affordance, and `veh.vehicle-duplicate-scan` is NOT called
 *
 * Two separate refusals, for two separate reasons.
 *
 * **Merge is blocked by `P1-OD-017`**, an open Owner decision. The canonical
 * plan requires the affordance to be *absent* rather than disabled, because a
 * disabled button says "this exists and you lack permission" — a different and
 * false statement. Same rule as `FE-016`; the CRM screen learned it the hard way.
 *
 * **`veh.vehicle-duplicate-scan` reads like a query and is a privileged audited
 * WRITE.** It creates candidate rows, emits an audit record and is throttled at
 * 30/min. Opening the review queue must never fire it: a screen that "refreshed"
 * by scanning would write audit history every time somebody looked.
 *
 * ## `FE-029`: this is an attribute-change ledger, not a unified timeline
 *
 * `veh.vehicle-history` reads `veh.vehicle_attribute_history` — **field-level
 * changes to the vehicle master and nothing else**. CRM has `crm.timeline_events`
 * populated by triggers across the domain; the vehicle schema has **no
 * equivalent table**, which P1-17's own remediation record states plainly.
 *
 * So this screen does not claim to be a vehicle timeline. It presents what the
 * operation actually is, and names the other histories — ownership, plates,
 * odometer, relationships — as the separate sections they are, each with its own
 * operation and its own tab. Aggregating them here would invent a single event
 * stream the platform does not have and would silently disagree with each
 * section's own list.
 *
 * ## `oldValue` and `newValue` are BOTH nullable
 *
 * A creation has no old value; a clearing has no new one. A diff row that
 * assumed either would render "null → X" or throw.
 */

import { formatPercent, type ConfidenceBands } from '@/lib/duplicates/score';

/** `veh.duplicate_candidates.status`. */
export const VEHICLE_DUPLICATE_STATUSES = ['open', 'dismissed', 'merged'] as const;
export type VehicleDuplicateStatus = (typeof VEHICLE_DUPLICATE_STATUSES)[number];

/**
 * What a reviewer may decide: dismissal, and nothing else.
 *
 * `merged` is a status a candidate REACHES through `veh.vehicle-merge`, not a
 * decision this endpoint accepts.
 */
export const VEHICLE_DUPLICATE_DECISIONS = ['dismissed'] as const;

export const MIN_REVIEW_REASON = 10;
export const MAX_REVIEW_REASON = 500;

export interface VehicleDuplicateCandidate {
  readonly id: string;
  readonly vehicleIdA: string;
  /**
   * The A-side vehicle's reference, as the operation publishes it.
   *
   * Nullable because the repository reaches it through a `LEFT JOIN`, so a
   * merged-away or deleted side yields nothing. This field was MISSING from this
   * type while `veh.vehicle-duplicate-list` had been publishing it since #194,
   * so TypeScript could not flag the screen for labelling each side "First
   * record" / "Second record" instead of naming it (`P1-27-FE-028`).
   */
  readonly displayNumberA: string | null;
  readonly vehicleIdB: string;
  readonly displayNumberB: string | null;
  /** `numeric` as a STRING. Never `parseFloat`, never compared as a number. */
  readonly matchScore: string;
  /** `jsonb`, guaranteed free of raw identifier values by `veh.valid_match_basis`. */
  readonly matchBasis: unknown;
  readonly status: string;
  readonly detectedAt: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
}

/** One field-level change from `veh.vehicle_attribute_history`. */
export interface VehicleHistoryEntry {
  readonly id: string;
  readonly fieldCode: string;
  /** Null when the field was previously unset — a creation, not an edit. */
  readonly oldValue: string | null;
  /** Null when the field was cleared. */
  readonly newValue: string | null;
  readonly occurredAt: string;
  /**
   * Carried, never rendered. Kept because the operation publishes it and
   * dropping a published field from the type would hide it from a future
   * consumer that legitimately needs one — a correlation, not a label.
   */
  readonly actorId: string;
  /**
   * Who made the change, or `null` when this caller may not be told
   * (`P1-27-INT-026`).
   *
   * Optional on the WIRE and required in intent. The operation gained this field
   * in the P1-14 identity-directory remediation; until that reaches the
   * environment a screen is talking to, the key is simply absent — which reads
   * here as `undefined` and renders exactly the same safe sentence as `null`.
   * That is the whole reason the fallback is a phrase rather than the id: it is
   * correct before the Backend lands and after it.
   *
   * `null` means "not resolvable by you", not "nobody". The read withholds the
   * name from a caller without `iam.user.read` rather than publishing a
   * tenant-wide staff directory to anyone who can open a vehicle.
   */
  readonly actorName?: string | null;
}

/** Only an open candidate can still be decided. Fails closed on anything else. */
export function isActionable(candidate: VehicleDuplicateCandidate): boolean {
  return candidate.status === 'open';
}

/**
 * How a change should be read, given that both values are nullable.
 *
 * Four shapes rather than one "old → new" template, because three of them read
 * as nonsense through that template.
 */
export type ChangeShape = 'set' | 'cleared' | 'changed' | 'empty';

export function changeShape(entry: VehicleHistoryEntry): ChangeShape {
  const had = entry.oldValue !== null && entry.oldValue !== '';
  const has = entry.newValue !== null && entry.newValue !== '';
  if (!had && has) return 'set';
  if (had && !has) return 'cleared';
  if (had && has) return 'changed';
  // Both null. The ledger recorded a change that carries no values — possible
  // for a field whose value is not audit-safe. Saying "null → null" would be
  // worse than saying a change happened without detail.
  return 'empty';
}

/*
 * `validateReviewReason` is gone from this file (`P1-27-FE-016` / `FE-028`).
 *
 * It mirrored the zod `.min(..., 'field.tooShort')` in this domain's own review
 * adapter and had no production caller — the same defect `P1-27-FE-013` removed
 * from the governance contracts, in the two files that sweep did not reach. Its
 * only consumers were tests, so the coverage credited to the one decision these
 * tasks may ship while `P1-OD-017` is open was proving an unreachable copy.
 *
 * The real validation runs in the adapter's schema and is driven end to end by
 * `apps/web/tests/duplicate-review-writes.test.ts`.
 */

/**
 * Formats a `numeric` match score without parsing it.
 *
 * Identical reasoning and identical implementation to the CRM one: the value
 * arrives as a string because it need not fit a double, and this number decides
 * whether two real vehicle records get combined. Returns `null` for any shape it
 * does not recognise, so an unexpected value is shown raw rather than rendered
 * as a confident wrong number.
 */
export function formatMatchScore(score: string): string | null {
  return formatPercent(score);
}

/**
 * Where "strong", "possible" and "needs review" fall for a VEHICLE pair.
 *
 * Higher than the customer bands, because this detector is deliberately harder
 * to satisfy. From `apps/api/src/modules/vehicle/domain/vehicle-identity.ts`:
 *
 *   - near-VIN 70 · plate movement 60 · make/model/year 20, on a 0–100 scale
 *   - the threshold is 80 AND at least one strong signal must have fired, so a
 *     lone near-VIN (70) is not enough and make/model/year alone (20) can never
 *     record anything
 *
 * So the lowest score that can exist here is 80 — plate movement plus
 * make/model/year — and every recorded candidate already carries strong
 * evidence. **90%** is near-VIN plus make/model/year, or both strong signals
 * together; that is the band worth calling strong. Nothing can land below 80, so
 * "needs review" is unreachable in practice and is kept only so an unexpected
 * stored value is not silently promoted to "possible".
 */
export const VEHICLE_CONFIDENCE_BANDS: ConfidenceBands = Object.freeze({
  strong: 90,
  possible: 80,
});

/**
 * The two vehicles in a candidate pair, as a stable ordered pair.
 *
 * The mirror of `pairMembers` in the customer contract, and it exists for the
 * same reason: both call sites — the queue row and the decision panel — must
 * read the pair the same way, or one of them will drift into showing an ordinal
 * where the other shows a reference.
 *
 * A/B is the order the detector recorded and carries no meaning. Neither is "the
 * duplicate", and presenting one as the original and the other as the copy would
 * invent a fact and nudge a reviewer toward retiring the wrong record.
 */
export function vehiclePairMembers(
  candidate: VehicleDuplicateCandidate
): readonly [{ id: string; number: string | null }, { id: string; number: string | null }] {
  return [
    { id: candidate.vehicleIdA, number: candidate.displayNumberA },
    { id: candidate.vehicleIdB, number: candidate.displayNumberB },
  ];
}
