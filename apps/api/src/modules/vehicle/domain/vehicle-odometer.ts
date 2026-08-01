/**
 * Vehicle odometer — entry and anomaly domain (Phase 1-17, P1-17-BE-010,
 * P1-17-BE-011). Pure decisions only; no database, no request.
 *
 * ## Two modes, one append-only table
 *
 * A **normal** reading (reception / delivery / manual) records the odometer going
 * forward. The frozen `guard_odometer_reading` refuses a normal reading below the
 * current effective value — that is the anomaly *detection*: a lower reading is not
 * silently stored, and the original is preserved.
 *
 * A **correction** is the anomaly *disposition*. It references the reading it
 * corrects, carries a deterministic reason, and is flagged as an anomaly. It may
 * lower the value (a replaced meter, a rollover, a typo). It never edits or deletes
 * the original — the history stays intact and the effective odometer simply ignores
 * a superseded reading. The reason names a factual category only; this makes no
 * fraud or tampering conclusion.
 */

export const ODOMETER_UNITS = ['km', 'mi'] as const;
export type OdometerUnit = (typeof ODOMETER_UNITS)[number];

/** Non-correction capture methods (`veh.odometer_readings.ck_*_capture`). */
export const ODOMETER_CAPTURE_METHODS = ['reception', 'delivery', 'manual'] as const;
export type OdometerCaptureMethod = (typeof ODOMETER_CAPTURE_METHODS)[number];

/** Deterministic, approved anomaly categories carried in `correction_reason`. */
export const ODOMETER_ANOMALY_REASONS = [
  'lower_than_prior',
  'possible_rollover',
  'meter_replacement',
  'data_entry_correction',
  'unknown',
] as const;
export type OdometerAnomalyReason = (typeof ODOMETER_ANOMALY_REASONS)[number];

/** numeric(12,1): a nonnegative value with at most one decimal place, bounded so a
 * fat-fingered value cannot overflow the column. */
export const MAX_ODOMETER_VALUE = 9_999_999_999;

export const ODOMETER_ORDERING = {
  key: 'veh.odometer_readings:observed_desc',
  direction: 'desc',
} as const;

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

export interface OdometerReadingInput {
  readonly value: number;
  readonly unit: OdometerUnit;
  readonly observedAt: string;
  readonly captureMethod?: OdometerCaptureMethod | undefined;
  /** Present only for a correction disposition. */
  readonly correctionOf?: string | null | undefined;
  readonly correctionReason?: OdometerAnomalyReason | null | undefined;
}

export interface OdometerReadingPlan {
  readonly value: number;
  readonly unit: OdometerUnit;
  readonly observedAt: string;
  readonly captureMethod: OdometerCaptureMethod | 'correction';
  readonly correctionOf: string | null;
  readonly correctionReason: OdometerAnomalyReason | null;
  readonly anomalyFlag: boolean;
}

export class VehicleOdometerError extends Error {
  public override readonly name = 'VehicleOdometerError';
  constructor(
    message: string,
    readonly path: string,
    readonly rule: string
  ) {
    super(message);
  }
}

function normalizeValue(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_ODOMETER_VALUE) {
    throw new VehicleOdometerError(
      `body.value must be between 0 and ${MAX_ODOMETER_VALUE}`,
      'body.value',
      'out_of_range'
    );
  }
  // numeric(12,1): keep one decimal place, deterministically.
  return Math.round(value * 10) / 10;
}

function normalizeObservedAt(value: string): string {
  const trimmed = value.trim();
  if (!ISO_DATETIME.test(trimmed) || Number.isNaN(Date.parse(trimmed))) {
    throw new VehicleOdometerError(
      'body.observedAt must be an ISO 8601 timestamp',
      'body.observedAt',
      'bad_timestamp'
    );
  }
  return trimmed;
}

/**
 * Builds a reading plan. A correction requires both a corrected-reading reference
 * and a reason and is always flagged as an anomaly (the caller never sets the
 * flag); a normal reading forbids both, matching
 * `ck_odometer_readings_correction_meta`/`_ref`.
 */
export function toOdometerReadingPlan(input: OdometerReadingInput): OdometerReadingPlan {
  const value = normalizeValue(input.value);
  const observedAt = normalizeObservedAt(input.observedAt);
  const isCorrection =
    input.correctionOf !== undefined && input.correctionOf !== null && input.correctionOf !== '';

  if (isCorrection) {
    if (input.correctionReason === undefined || input.correctionReason === null) {
      throw new VehicleOdometerError(
        'body.correctionReason is required for a correction',
        'body.correctionReason',
        'required'
      );
    }
    if (!ODOMETER_ANOMALY_REASONS.includes(input.correctionReason)) {
      throw new VehicleOdometerError(
        'body.correctionReason is not a known anomaly reason',
        'body.correctionReason',
        'unknown_reason'
      );
    }
    return {
      value,
      unit: input.unit,
      observedAt,
      captureMethod: 'correction',
      correctionOf: input.correctionOf as string,
      correctionReason: input.correctionReason,
      anomalyFlag: true,
    };
  }

  if (input.correctionReason !== undefined && input.correctionReason !== null) {
    throw new VehicleOdometerError(
      'body.correctionReason is only allowed with a correctionOf reference',
      'body.correctionReason',
      'unexpected'
    );
  }
  return {
    value,
    unit: input.unit,
    observedAt,
    captureMethod: input.captureMethod ?? 'manual',
    correctionOf: null,
    correctionReason: null,
    anomalyFlag: false,
  };
}
