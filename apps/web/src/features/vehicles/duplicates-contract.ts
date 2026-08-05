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
  readonly vehicleIdB: string;
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
  readonly actorId: string;
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

export function validateReviewReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return 'field.required';
  if (trimmed.length < MIN_REVIEW_REASON) return 'field.tooShort';
  if (trimmed.length > MAX_REVIEW_REASON) return 'field.tooLong';
  return null;
}

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
  const match = /^(\d+)(?:\.(\d*))?$/.exec(score.trim());
  if (!match) return null;

  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (whole !== '0' && whole !== '1') return null;
  if (whole === '1' && /[1-9]/.test(fraction)) return null;
  if (whole === '1') return '100%';

  const digits = (fraction + '000').slice(0, 3);
  const tens = Number(digits.slice(0, 2));
  const roundUp = Number(digits[2]) >= 5;
  return `${Math.min(100, tens + (roundUp ? 1 : 0))}%`;
}
