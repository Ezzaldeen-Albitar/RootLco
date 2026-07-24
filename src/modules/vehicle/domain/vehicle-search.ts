/**
 * Vehicle search — domain contract (Phase 1-17, FR-VEH-001, NFR-PRV-001).
 *
 * Pure decision-making only: this file decides *what* a vehicle search is allowed
 * to filter on and *how* the result is ordered. It touches no database (the
 * boundary checker forbids `domain/` from importing `@/server/db`) and no request.
 * The application service passes it already-validated, already-VIN-normalized
 * values; the repository turns the contract into SQL.
 *
 * Privacy posture (NFR-PRV-001): the searchable surface is a closed allow-list —
 * the vehicle's own display number (a non-sensitive business key), an exact
 * normalized VIN, an exact normalized active plate, and two controlled
 * discriminators (lifecycle status and powertrain category). Restricted
 * identifiers (chassis / engine number, which live in `veh.vehicle_identifiers`
 * and are classified `restricted`) are never a search input and are never
 * projected by this contract; a caller that needs them uses a separate operation
 * gated by `iam.sensitive.view`.
 */

/** The lifecycle vocabulary `veh.vehicles.lifecycle_status` permits. */
export const VEHICLE_LIFECYCLE_STATUSES = [
  'draft',
  'active',
  'inactive',
  'merged',
  'scrapped',
] as const;
export type VehicleLifecycleStatus = (typeof VEHICLE_LIFECYCLE_STATUSES)[number];

/** The powertrain classes `veh.vehicles.powertrain_category` permits. */
export const POWERTRAIN_CATEGORIES = ['ice', 'ev', 'hybrid', 'phev', 'other'] as const;
export type PowertrainCategory = (typeof POWERTRAIN_CATEGORIES)[number];

/** The workshop-axis vocabulary `veh.vehicles.workshop_status` permits. */
export const WORKSHOP_STATUSES = [
  'none',
  'in_workshop',
  'awaiting_parts',
  'ready_for_delivery',
] as const;
export type WorkshopStatus = (typeof WORKSHOP_STATUSES)[number];

/**
 * Deterministic, index-aligned ordering: newest first, id as the tie-breaker so
 * two vehicles created in the same instant cannot straddle a page edge. Bound to
 * a stable contract key so a cursor issued here can never be replayed against a
 * different ordering.
 */
export const VEHICLE_SEARCH_ORDERING = {
  key: 'veh.vehicles:created_at_desc',
  direction: 'desc',
} as const;

/**
 * The maximum length of a free-text VIN or plate fragment accepted at the edge.
 * Longer inputs are a payload, not a query, and are rejected by the route's Zod
 * schema; kept here too so the domain bound is testable without the HTTP layer.
 */
export const MAX_VIN_FRAGMENT = 64;
export const MAX_PLATE_FRAGMENT = 32;

/** A validated, already-normalised search request handed to the repository. */
export interface VehicleSearchFilter {
  /**
   * Exact normalised VIN (via the shared `normalizeVin`, which mirrors
   * `veh.normalize_vin`), or null. `hasVin` distinguishes "no VIN filter" from
   * "a VIN was supplied but normalised to nothing" — the latter must match no row
   * rather than silently drop the filter.
   */
  readonly vinNormalized: string | null;
  readonly hasVin: boolean;
  /**
   * Raw plate fragment, or null. Normalised on the SQL side with
   * `veh.normalize_plate($x)` so the query fragment and the stored
   * `plate_normalized` are compared under the same frozen rule.
   */
  readonly plateRaw: string | null;
  /** Exact vehicle display number, or null. */
  readonly vehicleNumber: string | null;
  readonly lifecycleStatus: VehicleLifecycleStatus | null;
  readonly powertrainCategory: PowertrainCategory | null;
}

/** A safe, non-restricted projection of a matched vehicle. */
export interface VehicleSearchHit {
  readonly id: string;
  readonly displayNumber: string | null;
  /** The master VIN (classification `internal`), or null when unset. */
  readonly vin: string | null;
  readonly makeId: string | null;
  readonly modelId: string | null;
  readonly modelYear: number | null;
  readonly powertrainCategory: PowertrainCategory;
  readonly lifecycleStatus: VehicleLifecycleStatus;
  readonly workshopStatus: WorkshopStatus;
  readonly createdAt: string;
}

/** Raw (edge-validated) inputs before domain normalisation. */
export interface VehicleSearchInput {
  readonly vin?: string | undefined;
  readonly plate?: string | undefined;
  readonly vehicleNumber?: string | undefined;
  readonly lifecycleStatus?: VehicleLifecycleStatus | undefined;
  readonly powertrainCategory?: PowertrainCategory | undefined;
}

/**
 * Turns edge-validated input plus the already-computed normalised VIN into the
 * closed filter contract. The VIN is normalised by the application service via the
 * shared `normalizeVin` (there is no second VIN normalizer); a supplied VIN that
 * normalises to null still sets `hasVin` so the repository matches no row.
 */
export function toVehicleSearchFilter(
  input: VehicleSearchInput,
  vinNormalized: string | null
): VehicleSearchFilter {
  const hasVin = input.vin !== undefined && input.vin.trim() !== '';
  const plate = input.plate?.trim() ? input.plate.trim() : null;
  return {
    vinNormalized: hasVin ? vinNormalized : null,
    hasVin,
    plateRaw: plate,
    vehicleNumber: input.vehicleNumber?.trim() ? input.vehicleNumber.trim() : null,
    lifecycleStatus: input.lifecycleStatus ?? null,
    powertrainCategory: input.powertrainCategory ?? null,
  };
}
