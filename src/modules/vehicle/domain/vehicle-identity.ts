/**
 * Vehicle identity — duplicate detection and merge domain (Phase 1-17,
 * FR-VEH-003, P1-17-BE-004). Pure decisions only; no database, no request.
 *
 * ## No path from a score to a merge
 *
 * Scanning produces candidates, a person reviews them, and a merge is a third,
 * separately-permissioned operation that requires an approval reference. The
 * machine decides none of the three, because a merge is irreversible in practice:
 * the source becomes a frozen redirect to the survivor and no later regret
 * un-merges two vehicles' histories.
 *
 * ## The scan is conservative, deterministic, and explainable
 *
 * The frozen `veh` schema already forbids two live vehicles from sharing an active
 * VIN or an active plate, so the naive "same VIN / same plate" signals can never
 * fire between live vehicles. The scan therefore scores only *strong* corroborated
 * signals, and never records a candidate on a weak signal alone:
 *
 *  - **near-VIN** (weight 70): the two normalised VINs differ by exactly one
 *    character substitution or one adjacent transposition — a plausible typing
 *    error, not a coincidence.
 *  - **plate-history** (weight 60): one vehicle currently holds a normalised plate
 *    the other previously held — a plate that moved between two records that may be
 *    the same vehicle.
 *  - **make/model/year** (weight 20): exact agreement on all three, used only to
 *    *support* a strong signal — it is deliberately never scored on its own, because
 *    thousands of legitimate vehicles share a make, model, and year.
 *
 * A candidate is recorded only when the summed score reaches the threshold (80) and
 * at least one strong signal fired. So a lone near-VIN (70) or a lone plate move
 * (60) is not enough — it needs make/model/year support (→90, →80) or the other
 * strong signal. The score and its basis are frozen at detection.
 */

/** Signal weights on a 0–100 scale (stored as a [0,1] `match_score`). */
export const VEHICLE_MATCH_WEIGHTS = Object.freeze({
  near_vin: 70,
  plate_history: 60,
  make_model_year: 20,
} as const);

/** A pair at or above this summed score is worth a human's attention. */
export const CANDIDATE_THRESHOLD = 80;

/** Longest approval reference accepted for a merge. */
export const MAX_APPROVAL_REF = 120;

/** A review decision. Only `dismissed` is recordable — `merged` is set by the
 * merge operation, never by a reviewer, so a pair cannot be marked reconciled
 * without a merge actually happening. */
export const DUPLICATE_DECISIONS = ['dismissed'] as const;
export type DuplicateDecision = (typeof DUPLICATE_DECISIONS)[number];

/** Review-reason bounds. A substantive reason is mandatory: a dismissal is a
 * judgement someone may later have to explain. */
export const MIN_REASON = 3;
export const MAX_REASON = 500;

export class VehicleIdentityError extends Error {
  public override readonly name = 'VehicleIdentityError';
  constructor(
    message: string,
    readonly path: string,
    readonly rule: string
  ) {
    super(message);
  }
}

/**
 * True when `a` and `b` are the same length and differ by exactly one character
 * substitution OR one adjacent transposition — a restricted edit distance of one.
 * Equal strings are not "near" (that is an exact collision, which the database
 * already forbids between live vehicles). A blank input is never near anything.
 */
export function isNearVin(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  if (a === b) return false;
  if (a.length !== b.length) return false;
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      diffs.push(i);
      if (diffs.length > 2) return false;
    }
  }
  if (diffs.length === 1) return true; // one substitution
  if (diffs.length === 2) {
    const i = diffs[0] as number;
    const j = diffs[1] as number;
    // Adjacent positions whose characters are swapped.
    return j === i + 1 && a[i] === b[j] && a[j] === b[i];
  }
  return false;
}

/** The signals that fired between a target vehicle and one comparison vehicle. */
export interface VehicleComparison {
  readonly nearVin: boolean;
  readonly plateCross: boolean;
  readonly makeModelYear: boolean;
}

/** One element of the frozen `match_basis` array (see `veh.valid_match_basis`). */
export interface MatchBasisElement {
  readonly basis: string;
  readonly classification: string;
  readonly weight: number;
}

export interface ScoredComparison {
  /** Summed score in [0,1] (the 0–100 weights divided by 100, clamped to 1). */
  readonly score: number;
  readonly basis: readonly MatchBasisElement[];
  /** At least one strong signal (near-VIN or plate move) fired. */
  readonly strong: boolean;
  /** The pair is worth recording: at threshold and strongly signalled. */
  readonly isCandidate: boolean;
}

/**
 * Turns the fired signals into a frozen score and `match_basis`. VIN and plate
 * evidence is classified `restricted` (it cannot be downgraded, per
 * `veh.valid_match_basis`); make/model/year support is `internal`.
 */
export function scoreComparison(comparison: VehicleComparison): ScoredComparison {
  const basis: MatchBasisElement[] = [];
  let total = 0;
  if (comparison.nearVin) {
    total += VEHICLE_MATCH_WEIGHTS.near_vin;
    basis.push({ basis: 'vin_collision', classification: 'restricted', weight: 0.7 });
  }
  if (comparison.plateCross) {
    total += VEHICLE_MATCH_WEIGHTS.plate_history;
    basis.push({ basis: 'plate_collision', classification: 'restricted', weight: 0.6 });
  }
  if (comparison.makeModelYear) {
    total += VEHICLE_MATCH_WEIGHTS.make_model_year;
    basis.push({ basis: 'make_model_year_similarity', classification: 'internal', weight: 0.2 });
  }
  const strong = comparison.nearVin || comparison.plateCross;
  return {
    score: Math.min(1, Number((total / 100).toFixed(4))),
    basis,
    strong,
    isCandidate: strong && total >= CANDIDATE_THRESHOLD,
  };
}

/** Orders a pair so `a < b`, matching `veh.duplicate_candidates.ck_*_order`. */
export function orderPair(x: string, y: string): { a: string; b: string } {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

/** A merge target must differ from its source. Everything else the database
 * guards (live, same-tenant, not-already-merged survivor). */
export function assertMergeable(sourceId: string, survivorId: string): void {
  if (sourceId === survivorId) {
    throw new VehicleIdentityError(
      'A vehicle cannot be merged into itself',
      'body.survivorId',
      'self_merge'
    );
  }
}
