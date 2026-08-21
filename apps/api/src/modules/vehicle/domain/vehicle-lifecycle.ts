/**
 * Vehicle EV profile and lifecycle/workshop status — domain contract (Phase 1-17,
 * P1-17-BE-008, P1-17-BE-009).
 *
 * Pure decision-making: what an EV profile may carry, and which status transitions
 * a live vehicle is allowed to make. No database, no request — the repository turns
 * a plan into SQL and the frozen `veh` guards enforce the invariants this file
 * cannot see (the EV-profile/powertrain coupling, the activation-needs-identity
 * rule, and the merged-freeze).
 *
 * ## Two deliberate boundaries
 *
 * 1. **No invented battery-health arithmetic.** The EV profile stores only what the
 *    caller supplies — the electric kind, an optional usable capacity, a charge-port
 *    label, and the high-voltage-warning flag. State-of-health is battery telemetry
 *    (`veh.battery_readings`), not a derived field this contract computes.
 * 2. **Status transitions are an explicit allow-list, and `merged` is never a
 *    target.** A vehicle is merged only through the merge operation (its own
 *    permission, its own append-only redirect); letting a generic status change set
 *    `merged` would forge a merge with no survivor. `scrapped` is terminal.
 */

import {
  VEHICLE_LIFECYCLE_STATUSES,
  WORKSHOP_STATUSES,
  type PowertrainCategory,
  type VehicleLifecycleStatus,
  type WorkshopStatus,
} from './vehicle-search';

/** The electric kinds `veh.vehicle_ev_profiles.ev_kind` permits. */
export const EV_KINDS = ['bev', 'hybrid', 'phev'] as const;
export type EvKind = (typeof EV_KINDS)[number];

/**
 * The powertrain category each EV kind requires on the vehicle master. The frozen
 * `veh.guard_ev_profile_powertrain` enforces exactly this mapping (bev → ev, else
 * identity); kept here so the domain and the database agree without a round-trip.
 */
export const EV_KIND_REQUIRED_CATEGORY: Readonly<Record<EvKind, PowertrainCategory>> =
  Object.freeze({
    bev: 'ev',
    hybrid: 'hybrid',
    phev: 'phev',
  });

/** Longest charge-port label. `numeric(7,2)` bounds the usable capacity. */
export const MAX_CHARGE_PORT = 40;
export const MAX_USABLE_CAPACITY_KWH = 99_999.99;

/**
 * The approved lifecycle transitions. The database is permissive (it enforces only
 * merged-coherence, terminal-workshop coherence, and activation-needs-identity), so
 * the allowed state graph lives here. `merged` and `scrapped` are terminal; `merged`
 * is unreachable through the status operation entirely.
 */
export const LIFECYCLE_TRANSITIONS: Readonly<
  Record<VehicleLifecycleStatus, readonly VehicleLifecycleStatus[]>
> = Object.freeze({
  draft: ['active', 'scrapped'],
  active: ['inactive', 'scrapped'],
  inactive: ['active', 'scrapped'],
  merged: [],
  scrapped: [],
});

/** The approved workshop-axis transitions (a coarse operational indicator). */
export const WORKSHOP_TRANSITIONS: Readonly<Record<WorkshopStatus, readonly WorkshopStatus[]>> =
  Object.freeze({
    none: ['in_workshop'],
    in_workshop: ['awaiting_parts', 'ready_for_delivery', 'none'],
    awaiting_parts: ['in_workshop', 'ready_for_delivery', 'none'],
    ready_for_delivery: ['in_workshop', 'none'],
  });

/** A lifecycle state in which the vehicle must not be operationally in a workshop
 * (mirrors `veh.vehicles.ck_vehicles_terminal_workshop`). */
const TERMINAL_LIFECYCLE: ReadonlySet<VehicleLifecycleStatus> = new Set(['merged', 'scrapped']);

export class VehicleLifecycleError extends Error {
  public override readonly name = 'VehicleLifecycleError';
  constructor(
    message: string,
    readonly path: string,
    readonly rule: string
  ) {
    super(message);
  }
}

// ---- EV profile -------------------------------------------------------------

export interface EvProfileInput {
  readonly evKind?: EvKind | undefined;
  readonly usableCapacityKwh?: number | null | undefined;
  readonly chargePortType?: string | null | undefined;
  readonly highVoltageWarning?: boolean | undefined;
}

export interface EvProfilePlan {
  readonly evKind: EvKind;
  readonly requiredCategory: PowertrainCategory;
  readonly usableCapacityKwh: number | null;
  readonly chargePortType: string | null;
  readonly highVoltageWarning: boolean;
}

function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Builds an EV-profile plan. The electric kind is required and fixes the powertrain
 * category the vehicle must already carry (the database is the authority; this only
 * mirrors it). Capacity is optional, non-negative, and rounded to the stored
 * `numeric(7,2)`; the high-voltage warning defaults to on because an EV is a
 * high-voltage system unless a technician says otherwise.
 */
export function toEvProfilePlan(input: EvProfileInput): EvProfilePlan {
  if (input.evKind === undefined || !EV_KINDS.includes(input.evKind)) {
    throw new VehicleLifecycleError(
      'body.evKind must be one of bev, hybrid, phev',
      'body.evKind',
      'unknown_enum'
    );
  }
  const evKind = input.evKind;

  let usableCapacityKwh: number | null = null;
  if (input.usableCapacityKwh !== null && input.usableCapacityKwh !== undefined) {
    const value = input.usableCapacityKwh;
    if (!Number.isFinite(value) || value < 0 || value > MAX_USABLE_CAPACITY_KWH) {
      throw new VehicleLifecycleError(
        `body.usableCapacityKwh must be between 0 and ${MAX_USABLE_CAPACITY_KWH}`,
        'body.usableCapacityKwh',
        'out_of_range'
      );
    }
    usableCapacityKwh = Math.round(value * 100) / 100;
  }

  const chargePortType = blankToNull(input.chargePortType);
  if (chargePortType !== null && chargePortType.length > MAX_CHARGE_PORT) {
    throw new VehicleLifecycleError(
      `body.chargePortType exceeds ${MAX_CHARGE_PORT} characters`,
      'body.chargePortType',
      'too_long'
    );
  }

  return {
    evKind,
    requiredCategory: EV_KIND_REQUIRED_CATEGORY[evKind],
    usableCapacityKwh,
    chargePortType,
    highVoltageWarning: input.highVoltageWarning ?? true,
  };
}

// ---- Status change ----------------------------------------------------------

export interface StatusChangeInput {
  readonly lifecycleStatus?: VehicleLifecycleStatus | undefined;
  readonly workshopStatus?: WorkshopStatus | undefined;
}

export interface StatusColumnChange {
  readonly column: 'lifecycle_status' | 'workshop_status';
  readonly value: string;
}

export interface StatusChangePlan {
  readonly changes: readonly StatusColumnChange[];
  /** The axes this request moves, for the audit record. */
  readonly changedAxes: readonly ('lifecycle' | 'workshop')[];
  readonly resultingLifecycle: VehicleLifecycleStatus;
  readonly resultingWorkshop: WorkshopStatus;
}

export interface VehicleStatusState {
  readonly lifecycleStatus: VehicleLifecycleStatus;
  readonly workshopStatus: WorkshopStatus;
}

/**
 * Validates a requested lifecycle/workshop change against the live state. Each
 * requested axis must be a known value, must actually move (no-op is a caller
 * error, not a silent success), and must be an approved transition from the current
 * value. `merged` can never be a lifecycle target. The resulting combined state is
 * checked against the terminal-workshop rule so a clean 422 is returned instead of
 * a raw constraint error when a caller tries to scrap a vehicle still in a workshop.
 */
export function toStatusChangePlan(
  current: VehicleStatusState,
  input: StatusChangeInput
): StatusChangePlan {
  const changes: StatusColumnChange[] = [];
  const changedAxes: ('lifecycle' | 'workshop')[] = [];
  let resultingLifecycle = current.lifecycleStatus;
  let resultingWorkshop = current.workshopStatus;

  if (input.lifecycleStatus !== undefined) {
    const target = input.lifecycleStatus;
    if (!VEHICLE_LIFECYCLE_STATUSES.includes(target)) {
      throw new VehicleLifecycleError(
        'body.lifecycleStatus is not a known lifecycle status',
        'body.lifecycleStatus',
        'unknown_enum'
      );
    }
    if (target === 'merged') {
      throw new VehicleLifecycleError(
        'A vehicle is merged only through the merge operation, never a status change',
        'body.lifecycleStatus',
        'not_settable'
      );
    }
    if (target === current.lifecycleStatus) {
      throw new VehicleLifecycleError(
        'body.lifecycleStatus is already the current value',
        'body.lifecycleStatus',
        'no_change'
      );
    }
    if (!LIFECYCLE_TRANSITIONS[current.lifecycleStatus].includes(target)) {
      throw new VehicleLifecycleError(
        `A ${current.lifecycleStatus} vehicle cannot transition to ${target}`,
        'body.lifecycleStatus',
        'invalid_transition'
      );
    }
    changes.push({ column: 'lifecycle_status', value: target });
    changedAxes.push('lifecycle');
    resultingLifecycle = target;
  }

  if (input.workshopStatus !== undefined) {
    const target = input.workshopStatus;
    if (!WORKSHOP_STATUSES.includes(target)) {
      throw new VehicleLifecycleError(
        'body.workshopStatus is not a known workshop status',
        'body.workshopStatus',
        'unknown_enum'
      );
    }
    if (target === current.workshopStatus) {
      throw new VehicleLifecycleError(
        'body.workshopStatus is already the current value',
        'body.workshopStatus',
        'no_change'
      );
    }
    if (!WORKSHOP_TRANSITIONS[current.workshopStatus].includes(target)) {
      throw new VehicleLifecycleError(
        `A ${current.workshopStatus} vehicle cannot transition to ${target}`,
        'body.workshopStatus',
        'invalid_transition'
      );
    }
    changes.push({ column: 'workshop_status', value: target });
    changedAxes.push('workshop');
    resultingWorkshop = target;
  }

  if (changes.length === 0) {
    throw new VehicleLifecycleError(
      'A status change must move at least one of lifecycle or workshop',
      'body',
      'no_writable_field'
    );
  }

  if (TERMINAL_LIFECYCLE.has(resultingLifecycle) && resultingWorkshop !== 'none') {
    throw new VehicleLifecycleError(
      `A ${resultingLifecycle} vehicle cannot be in a workshop; set workshop to none first`,
      'body.workshopStatus',
      'terminal_workshop'
    );
  }

  return { changes, changedAxes, resultingLifecycle, resultingWorkshop };
}
