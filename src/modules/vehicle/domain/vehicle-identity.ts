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
 */

/** Vehicles score against each other on these signals; weights sum to 1.0. */
export const VEHICLE_MATCH_SIGNALS = Object.freeze({
  /** Same normalized VIN fragment (a typo'd or partial VIN, since exact-equal
   * live VINs are impossible under the active-VIN unique index). */
  vin_fragment: 0.6,
  /** Shared active or historical plate (normalized). */
  shared_plate: 0.3,
  /** Same make + model + model year. */
  make_model_year: 0.2,
} as const);

export type VehicleMatchSignal = keyof typeof VEHICLE_MATCH_SIGNALS;

/** At/above this a pair is worth a human's attention; below it is noise. */
export const CANDIDATE_THRESHOLD = 0.3;

export interface VehicleMatchSignalHit {
  readonly signal: VehicleMatchSignal;
  readonly weight: number;
}

/** Longest approval reference accepted for a merge. */
export const MAX_APPROVAL_REF = 120;

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

/** Deterministic score in [0,1]: the summed weights of the signals that fired,
 * clamped so an over-weighted signal set can never exceed 1. */
export function scorePair(hits: readonly VehicleMatchSignalHit[]): number {
  const total = hits.reduce((sum, hit) => sum + hit.weight, 0);
  return Math.min(1, Number(total.toFixed(4)));
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
