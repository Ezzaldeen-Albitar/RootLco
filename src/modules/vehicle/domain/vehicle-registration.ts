/**
 * Vehicle registration — plate history and ownership transfer domain (Phase 1-17,
 * P1-17-BE-006, P1-17-BE-007, P1-17-BE-016). Pure decisions only; no database, no
 * request. The temporal invariants (no overlapping active plate, one registered
 * owner at a time, an interval closed once) live in the frozen `veh` schema; this
 * file validates and normalises the request the service hands the repository.
 */

/** Ownership kinds `veh.ownership_history.ck_ownership_history_kind` permits. */
export const OWNERSHIP_KINDS = ['registered_owner', 'beneficial', 'fleet'] as const;
export type OwnershipKind = (typeof OWNERSHIP_KINDS)[number];

/** `veh.plate_history.ck_plate_history_country`: an ISO-style 2–3 letter code. */
export const COUNTRY_CODE = /^[A-Z]{2,3}$/;
export const MAX_PLATE_RAW = 32;
export const MAX_TRANSFER_REASON = 500;

/**
 * Newest-first ordering for the two history reads, tie-broken by row id so the
 * order is total and two records sharing a `created_at` cannot straddle a page
 * edge. Each key is stable, so a cursor issued here can never be replayed against
 * a different ordering. It is deliberately *not* index-aligned: the only index on
 * either table is `(tenant_id, vehicle_id, valid_from)`, so PostgreSQL sorts the
 * one vehicle's rows itself — affordable because a vehicle accumulates a handful
 * of plates and owners over its life, never a page-deep list.
 */
export const PLATE_HISTORY_ORDERING = {
  key: 'veh.plate_history:created_at_desc',
  direction: 'desc',
} as const;
export const OWNERSHIP_HISTORY_ORDERING = {
  key: 'veh.ownership_history:created_at_desc',
  direction: 'desc',
} as const;

export interface PlateAssignInput {
  readonly countryCode: string;
  readonly plateRaw: string;
  /** ISO date (YYYY-MM-DD) the new plate takes effect; defaults to today. */
  readonly effectiveDate?: string | null | undefined;
}

export interface OwnershipTransferInput {
  readonly partnerId: string;
  readonly ownershipKind?: OwnershipKind | undefined;
  readonly effectiveDate?: string | null | undefined;
  readonly transferReason?: string | null | undefined;
}

export interface PlateAssignPlan {
  readonly countryCode: string;
  readonly plateRaw: string;
  readonly effectiveDate: string | null;
}

export interface OwnershipTransferPlan {
  readonly partnerId: string;
  readonly ownershipKind: OwnershipKind;
  readonly effectiveDate: string | null;
  readonly transferReason: string | null;
}

export class VehicleRegistrationError extends Error {
  public override readonly name = 'VehicleRegistrationError';
  constructor(
    message: string,
    readonly path: string,
    readonly rule: string
  ) {
    super(message);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value: string | null | undefined, path: string): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))) {
    throw new VehicleRegistrationError(
      `${path} must be an ISO date (YYYY-MM-DD)`,
      path,
      'bad_date'
    );
  }
  return trimmed;
}

export function toPlateAssignPlan(input: PlateAssignInput): PlateAssignPlan {
  const countryCode = input.countryCode.trim().toUpperCase();
  if (!COUNTRY_CODE.test(countryCode)) {
    throw new VehicleRegistrationError(
      'body.countryCode must be a 2–3 letter country code',
      'body.countryCode',
      'bad_country'
    );
  }
  const plateRaw = input.plateRaw.trim();
  if (plateRaw === '' || plateRaw.length > MAX_PLATE_RAW) {
    throw new VehicleRegistrationError(
      `body.plateRaw must be 1–${MAX_PLATE_RAW} non-blank characters`,
      'body.plateRaw',
      'bad_plate'
    );
  }
  return {
    countryCode,
    plateRaw,
    effectiveDate: normalizeDate(input.effectiveDate, 'body.effectiveDate'),
  };
}

export function toOwnershipTransferPlan(input: OwnershipTransferInput): OwnershipTransferPlan {
  const ownershipKind = input.ownershipKind ?? 'registered_owner';
  if (!OWNERSHIP_KINDS.includes(ownershipKind)) {
    throw new VehicleRegistrationError(
      'body.ownershipKind is not a known ownership kind',
      'body.ownershipKind',
      'bad_kind'
    );
  }
  const reason =
    input.transferReason === null || input.transferReason === undefined
      ? null
      : input.transferReason.trim();
  if (reason !== null && (reason === '' || reason.length > MAX_TRANSFER_REASON)) {
    throw new VehicleRegistrationError(
      `body.transferReason must be 1–${MAX_TRANSFER_REASON} non-blank characters`,
      'body.transferReason',
      'bad_reason'
    );
  }
  return {
    partnerId: input.partnerId,
    ownershipKind,
    effectiveDate: normalizeDate(input.effectiveDate, 'body.effectiveDate'),
    transferReason: reason,
  };
}
