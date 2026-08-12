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

import type { PartyIdentity } from '@/components/party/PartyLabel';

/** `veh.ownership_history.ownership_kind`. */
export const OWNERSHIP_KINDS = ['registered_owner', 'beneficial', 'fleet'] as const;
export type OwnershipKind = (typeof OWNERSHIP_KINDS)[number];

/** `veh.odometer_readings.unit`. */
export const ODOMETER_UNITS = ['km', 'mi'] as const;
export type OdometerUnit = (typeof ODOMETER_UNITS)[number];

/** Non-correction capture methods. A correction carries `'correction'`. */
export const ODOMETER_CAPTURE_METHODS = ['reception', 'delivery', 'manual'] as const;

/**
 * `veh.odometer_readings.correction_reason` — a closed, approved vocabulary.
 *
 * The platform's own list (`vehicle-odometer.ts:28-34`) carries a FIFTH member,
 * `'unknown'`, and the route accepts it. It is deliberately not offered here:
 * "unknown" is what a reason is when nobody recorded one, not something an
 * operator with the vehicle in front of them should be invited to choose, and
 * `data_entry_correction` covers the honest "I typed it wrong" case.
 *
 * Being exact about the consequence, because the first version of this docblock
 * was not: this list is BOTH the offer and the rule. `history-api.ts:290` builds
 * `z.enum(ODOMETER_ANOMALY_REASONS)` from it, so the adapter refuses
 * `'unknown'` — a value the route would accept. That is the one place this
 * client is deliberately stricter than the server, and it is reachable only by
 * calling the adapter directly, since the form offers no such choice. It is a
 * narrower vocabulary for WRITING; the read side still renders `'unknown'` in
 * words when a reading arrives carrying it, so nothing displayed is lost.
 */
export const ODOMETER_ANOMALY_REASONS = [
  'lower_than_prior',
  'possible_rollover',
  'meter_replacement',
  'data_entry_correction',
] as const;
export type OdometerAnomalyReason = (typeof ODOMETER_ANOMALY_REASONS)[number];

/** `ck_plate_history_country`: an ISO-style 2–3 letter code, upper-case. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2,3}$/;

/**
 * Length ceilings, mirroring the route schemas so a form can bound its input.
 *
 * These are the values the server enforces, restated — not a second authority. A
 * client bound that disagreed with the server would refuse a value the server
 * would have accepted, with no error the operator could act on, so the ceiling is
 * copied exactly and never tightened.
 */
export const MAX_PLATE_RAW = 32;
export const MAX_ODOMETER_VALUE = 9_999_999_999;
/** `MAX_TRANSFER_REASON` in `veh/domain/vehicle-registration.ts`. */
export const MAX_TRANSFER_REASON = 500;

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

/**
 * One ownership interval.
 *
 * `partnerId` is carried because a write needs it; it is **never rendered**. The
 * operation resolves the party through the CRM module and publishes the three
 * `partner*` display fields alongside it (`P1-27-INT-025`), all of them required
 * and nullable — `null` meaning "this caller cannot see that party", which
 * `PartyLabel` states in words.
 */
export interface OwnershipHistoryEntry extends PartyIdentity {
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

/** A prior reading, offered as something an operator can recognise. */
export interface CorrectionChoice {
  /** `veh.odometer_readings.id` — submitted, never rendered. */
  readonly value: string;
  /** What the operator reads: the reading, its unit, and when it was taken. */
  readonly label: string;
}

/**
 * The readings a correction may point at, turned into human choices.
 *
 * ## Why the id never reaches the screen
 *
 * `correctionOf` is a uuid. A text box for one would be a control no workshop
 * employee could use — the same conclusion `TransferOwnershipForm` reached about
 * `partnerId`, and the reason `veh.vehicle-ownership-transfer` stayed unwired
 * for the whole of P1-27. So the value is carried and the LABEL is what is
 * shown: "120000 km — 4 March 2026, 09:30".
 *
 * ## Derived from THIS vehicle's readings, and from nothing else
 *
 * The rows come from the odometer history already on screen, which is
 * `veh.vehicle-odometer-history` for this vehicle id. A reading belonging to
 * another vehicle is therefore not in the set and cannot be chosen; the server
 * refuses one anyway with a foreign-key violation mapped to
 * `body.correctionOf` / `unknown_reference`, and this is the reason an operator
 * never has to meet that refusal.
 *
 * ## What it does NOT filter
 *
 * Not by time, and not by whether the row is itself a correction. The server's
 * rule is "earlier or equal", checked in the database against the value being
 * written — which is not known until the form is submitted. Pre-filtering here
 * would be a client bound that disagrees with the server and hides a reading the
 * server would have accepted; `form.violation.not_earlier` states that refusal
 * instead, against the field that produced it.
 *
 * `formatObservedAt` is injected rather than imported so this stays a pure
 * function of its inputs: the caller owns the locale.
 */
export function correctionChoices(
  readings: readonly OdometerReadingEntry[],
  formatObservedAt: (observedAt: string) => string
): readonly CorrectionChoice[] {
  return readings.map((reading) => ({
    value: reading.id,
    // The value keeps its own unit and is never converted — the same rule the
    // table follows one component away.
    label: `${odometerDisplay(reading).primary} — ${formatObservedAt(reading.observedAt)}`,
  }));
}
