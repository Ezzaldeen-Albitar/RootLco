/**
 * Vehicle ownership (`FE-021`), plate history (`FE-022`) and odometer history
 * (`FE-023`).
 *
 * | operation                          | method | path                              | permission                    |
 * | ---------------------------------- | ------ | --------------------------------- | ----------------------------- |
 * | `veh.vehicle-ownership-history`    | GET    | `/vehicles/{id}/ownerships`       | `veh.vehicle.read`            |
 * | `veh.vehicle-ownership-transfer`   | POST   | `/vehicles/{id}/ownerships`       | `veh.vehicle.relationship.manage` |
 * | `veh.vehicle-plate-history`        | GET    | `/vehicles/{id}/plates`           | `veh.vehicle.read`            |
 * | `veh.vehicle-plate-assign`         | POST   | `/vehicles/{id}/plates`           | `veh.vehicle.manage`          |
 * | `veh.vehicle-odometer-history`     | GET    | `/vehicles/{id}/odometer-readings`| `veh.vehicle.read`            |
 * | `veh.vehicle-odometer-record`      | POST   | `/vehicles/{id}/odometer-readings`| `veh.vehicle.odometer.record` |
 *
 * All three writes are `idempotent: true` and `auditClass: privileged`, and all
 * three sit behind **different** permissions from each other and from the read.
 *
 * ## Three traps, and they are the substance of this wave
 *
 * **1. `date` is not a timestamp.** `valid_from` and `valid_to` are PostgreSQL
 * `date` columns read as `::text`, so they arrive as `"2026-08-04"`. Passing
 * that to `new Date()` parses it as UTC **midnight** and renders the previous
 * day anywhere west of Greenwich. Writing one back with
 * `.toISOString().slice(0, 10)` shifts it the other way for anyone east of it.
 * These values are therefore never converted in either direction — they are
 * strings the whole way through.
 *
 * **2. `numeric` is a string, and it stays one.** `value` and `value_km` are
 * `numeric`, cast `::text` by the repository precisely because they need not fit
 * a double. Any arithmetic here — a delta between readings, a unit conversion, a
 * `parseFloat` for display — reintroduces the loss the string exists to avoid.
 *
 * **3. `active` means "not yet closed", NOT "in effect today".** It is computed
 * as `valid_to IS NULL`, so a plate assigned with a future `valid_from` reports
 * `active: true` before it is in force. A screen that labelled it "current"
 * would be wrong for exactly the interval that matters.
 */

/** `veh.ownership_history.ownership_kind`. */
export const OWNERSHIP_KINDS = ['registered_owner', 'beneficial', 'fleet'] as const;
export type OwnershipKind = (typeof OWNERSHIP_KINDS)[number];

/** `veh.odometer_readings.unit`. */
export const ODOMETER_UNITS = ['km', 'mi'] as const;
export type OdometerUnit = (typeof ODOMETER_UNITS)[number];

/** Non-correction capture methods. A correction carries `'correction'`. */
export const ODOMETER_CAPTURE_METHODS = ['reception', 'delivery', 'manual'] as const;

/** `veh.odometer_readings.correction_reason` — a closed, approved vocabulary. */
export const ODOMETER_ANOMALY_REASONS = [
  'lower_than_prior',
  'possible_rollover',
  'meter_replacement',
  'data_entry_correction',
] as const;

/** `ck_plate_history_country`: an ISO-style 2–3 letter code, upper-case. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2,3}$/;

export interface PlateHistoryEntry {
  readonly id: string;
  readonly countryCode: string;
  /** The NORMALISED plate, not what anyone typed. */
  readonly plate: string;
  /** A `date`, as `"YYYY-MM-DD"`. Never parsed. */
  readonly validFrom: string;
  readonly validTo: string | null;
  /** `valid_to IS NULL` — "not closed", not "in force today". */
  readonly active: boolean;
  readonly createdAt: string;
}

export interface OwnershipHistoryEntry {
  readonly id: string;
  readonly partnerId: string;
  readonly ownershipKind: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface OdometerReadingEntry {
  readonly id: string;
  /** `numeric` as a STRING. Never a number, never arithmetic. */
  readonly value: string;
  readonly unit: string;
  /**
   * The canonical kilometre value — and it is **nullable**, which is the trap.
   * The comparable column is the one that may be absent, while the incomparable
   * `value`/`unit` pair is always present.
   */
  readonly valueKm: string | null;
  readonly observedAt: string;
  readonly captureMethod: string;
  readonly anomalyFlag: boolean;
  readonly correctionOf: string | null;
  readonly correctionReason: string | null;
}

/**
 * Whether a dated interval is in force on a given day.
 *
 * Pure string comparison. ISO `YYYY-MM-DD` sorts lexicographically in the same
 * order it sorts chronologically, so `<=` on strings is exactly `<=` on dates —
 * with none of the timezone shifting a `Date` round-trip introduces.
 *
 * This is what `active` is **not**. `active` is `valid_to IS NULL`; this is
 * "started, and not yet ended".
 */
export function isInForceOn(
  interval: { readonly validFrom: string; readonly validTo: string | null },
  today: string
): boolean {
  if (interval.validFrom > today) return false;
  if (interval.validTo !== null && interval.validTo <= today) return false;
  return true;
}

/** Today as `YYYY-MM-DD` in the operator's own timezone, not UTC. */
export function localToday(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  // Built from LOCAL parts. `toISOString().slice(0, 10)` would give the UTC day,
  // which is yesterday for anyone east of Greenwich late in the evening — and
  // "is this plate in force today" would answer for the wrong day.
  return `${year}-${month}-${day}`;
}

/**
 * How an interval should be described, given what `active` actually means.
 *
 * Four states, because three of them are routinely collapsed into "current" and
 * each collapse is a different lie:
 *
 * - `in-force`  — started, not ended. The only one that means "now".
 * - `scheduled` — `active` is true but `validFrom` is in the future.
 * - `ended`     — `validTo` has passed.
 * - `unknown`   — the dates do not parse as ISO days, so nothing is claimed.
 */
export type IntervalState = 'in-force' | 'scheduled' | 'ended' | 'unknown';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function intervalState(
  interval: {
    readonly validFrom: string;
    readonly validTo: string | null;
    readonly active: boolean;
  },
  today: string
): IntervalState {
  if (!ISO_DAY.test(interval.validFrom)) return 'unknown';
  if (interval.validTo !== null && !ISO_DAY.test(interval.validTo)) return 'unknown';

  if (interval.validFrom > today) {
    // `active` is true here — the row is open-ended — and it is NOT in force.
    return 'scheduled';
  }
  if (interval.validTo !== null && interval.validTo <= today) return 'ended';
  return 'in-force';
}

/**
 * The odometer value to display, with its unit, and never converted.
 *
 * `value` and `unit` together are the reading as it was taken. `valueKm` is the
 * comparable form and is **nullable**, so a screen that ranked or diffed
 * readings on it would silently skip the rows where it is absent.
 *
 * Nothing here converts miles to kilometres. The database computes `value_km`
 * as a generated column; a second conversion in the client would be a second
 * authority that disagrees at the rounding.
 */
export function odometerDisplay(reading: OdometerReadingEntry): {
  readonly primary: string;
  readonly canonical: string | null;
} {
  return {
    primary: `${reading.value} ${reading.unit}`,
    // Shown alongside, never instead of, and never computed here.
    canonical: reading.valueKm === null ? null : `${reading.valueKm} km`,
  };
}

/** A correction is a reading ABOUT another reading, and reads differently. */
export function isCorrection(reading: OdometerReadingEntry): boolean {
  return reading.correctionOf !== null || reading.captureMethod === 'correction';
}
