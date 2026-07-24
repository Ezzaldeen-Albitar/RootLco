/**
 * Vehicle create / update — domain contract (Phase 1-17, FR-VEH-001, P1-17-BE-003).
 *
 * Pure decision-making: what a caller may set on the vehicle master and how each
 * field is normalised before it reaches SQL. No database, no request — the
 * repository turns the plan into an INSERT or a version-guarded UPDATE, and the
 * frozen `veh.vehicles` guards (catalog coherence, active-VIN uniqueness, the
 * merged-freeze) enforce the invariants this file cannot see.
 *
 * ## Two deliberate boundaries
 *
 * 1. **VIN is stored raw; the database generates the normalised form.**
 *    `veh.vehicles.vin_normalized` is `GENERATED ALWAYS AS veh.normalize_vin(vin_raw)`,
 *    so this contract carries `vinRaw` only. Setting `vin_normalized` is impossible
 *    and uniqueness is decided on the generated column, never on anything a caller
 *    supplies.
 * 2. **Lifecycle, workshop, and merge state are not writable here.** Creating always
 *    lands a `draft`; activation, workshop moves, and merges are their own
 *    operations with their own permissions, append-only histories, and events. A
 *    generic master edit that could also flip lifecycle would let one permission
 *    stand in for three.
 */

import { POWERTRAIN_CATEGORIES, type PowertrainCategory } from './vehicle-search';

/** Longest raw VIN accepted at the edge. A VIN is 17 chars; the slack absorbs
 * separators and legacy formatting that `veh.normalize_vin` strips. */
export const MAX_VIN_INPUT = 64;
/** Longest free-text colour and display number. Both are non-blank when present. */
export const MAX_COLOR = 40;
export const MAX_DISPLAY_NUMBER = 40;
/** `veh.vehicles.ck_vehicles_model_year` bounds. */
export const MODEL_YEAR_MIN = 1900;
export const MODEL_YEAR_MAX = 2100;

/**
 * The master columns a caller may set through create/update, each paired with its
 * physical column. The repository interpolates only column names drawn from this
 * frozen set, so a partial update can never name an arbitrary column.
 */
export const VEHICLE_WRITABLE_COLUMNS = Object.freeze({
  vin: 'vin_raw',
  makeId: 'make_id',
  modelId: 'model_id',
  trimId: 'trim_id',
  bodyTypeId: 'body_type_id',
  powertrainTypeId: 'powertrain_type_id',
  modelYear: 'model_year',
  powertrainCategory: 'powertrain_category',
  color: 'color',
  displayNumber: 'display_number',
} as const);

export type VehicleWritableField = keyof typeof VEHICLE_WRITABLE_COLUMNS;

/** The physical columns the repository is allowed to write. */
export const VEHICLE_WRITABLE_PHYSICAL_COLUMNS: ReadonlySet<string> = new Set(
  Object.values(VEHICLE_WRITABLE_COLUMNS)
);

/** Raw (edge-validated) create input. Every descriptive field is optional. */
export interface VehicleCreateInput {
  readonly vin?: string | null | undefined;
  readonly makeId?: string | null | undefined;
  readonly modelId?: string | null | undefined;
  readonly trimId?: string | null | undefined;
  readonly bodyTypeId?: string | null | undefined;
  readonly powertrainTypeId?: string | null | undefined;
  readonly modelYear?: number | null | undefined;
  readonly powertrainCategory?: PowertrainCategory | undefined;
  readonly color?: string | null | undefined;
  readonly displayNumber?: string | null | undefined;
}

/** Raw (edge-validated) update input. The same fields, all patch-optional. */
export type VehicleUpdateInput = VehicleCreateInput;

/** A fully-normalised create plan handed to the repository. */
export interface VehicleCreatePlan {
  readonly vinRaw: string | null;
  readonly makeId: string | null;
  readonly modelId: string | null;
  readonly trimId: string | null;
  readonly bodyTypeId: string | null;
  readonly powertrainTypeId: string | null;
  readonly modelYear: number | null;
  readonly powertrainCategory: PowertrainCategory;
  readonly color: string | null;
  readonly displayNumber: string | null;
}

/** One normalised column write. `column` is always a frozen physical name. */
export interface VehicleColumnChange {
  readonly column: string;
  readonly value: string | number | null;
}

/** A normalised update plan: the exact set of columns the caller asked to change. */
export interface VehicleUpdatePlan {
  readonly changes: readonly VehicleColumnChange[];
}

export class VehicleWriteError extends Error {
  public override readonly name = 'VehicleWriteError';
  constructor(
    message: string,
    readonly path: string,
    readonly rule: string
  ) {
    super(message);
  }
}

/** `''`/whitespace → null; otherwise the trimmed value. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function checkLength(value: string | null, max: number, path: string): void {
  if (value !== null && value.length > max) {
    throw new VehicleWriteError(`${path} exceeds ${max} characters`, path, 'too_long');
  }
}

function normalizeModelYear(value: number | null | undefined, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < MODEL_YEAR_MIN || value > MODEL_YEAR_MAX) {
    throw new VehicleWriteError(
      `${path} must be an integer between ${MODEL_YEAR_MIN} and ${MODEL_YEAR_MAX}`,
      path,
      'out_of_range'
    );
  }
  return value;
}

function normalizeCategory(
  value: PowertrainCategory | undefined,
  fallback: PowertrainCategory
): PowertrainCategory {
  if (value === undefined) return fallback;
  if (!POWERTRAIN_CATEGORIES.includes(value)) {
    throw new VehicleWriteError(
      'body.powertrainCategory is not a known powertrain category',
      'body.powertrainCategory',
      'unknown_enum'
    );
  }
  return value;
}

/**
 * Builds a create plan. Strings are trimmed and blanks become null so an empty
 * form field is "unset", never a blank the `ck_*_not_blank` guards would reject
 * with a raw constraint error. `powertrainCategory` defaults to `ice` — the same
 * default the column carries — so the value the caller sees written is explicit.
 */
export function toVehicleCreatePlan(input: VehicleCreateInput): VehicleCreatePlan {
  const vinRaw = blankToNull(input.vin);
  checkLength(vinRaw, MAX_VIN_INPUT, 'body.vin');
  const color = blankToNull(input.color);
  checkLength(color, MAX_COLOR, 'body.color');
  const displayNumber = blankToNull(input.displayNumber);
  checkLength(displayNumber, MAX_DISPLAY_NUMBER, 'body.displayNumber');

  return {
    vinRaw,
    makeId: input.makeId ?? null,
    modelId: input.modelId ?? null,
    trimId: input.trimId ?? null,
    bodyTypeId: input.bodyTypeId ?? null,
    powertrainTypeId: input.powertrainTypeId ?? null,
    modelYear: normalizeModelYear(input.modelYear, 'body.modelYear'),
    powertrainCategory: normalizeCategory(input.powertrainCategory, 'ice'),
    color,
    displayNumber,
  };
}

/**
 * Builds an update plan from the fields actually present on the request. A key
 * that is absent is left untouched; a key set to `null` clears the column (except
 * `powertrainCategory`, which is `NOT NULL` and may only be re-set). An update
 * that names no writable field is a caller error, not a silent no-op.
 */
export function toVehicleUpdatePlan(input: VehicleUpdateInput): VehicleUpdatePlan {
  const changes: VehicleColumnChange[] = [];
  const present = (field: VehicleWritableField): boolean =>
    Object.prototype.hasOwnProperty.call(input, field);
  const push = (field: VehicleWritableField, value: string | number | null): void => {
    changes.push({ column: VEHICLE_WRITABLE_COLUMNS[field], value });
  };

  if (present('vin')) {
    const vinRaw = blankToNull(input.vin);
    checkLength(vinRaw, MAX_VIN_INPUT, 'body.vin');
    push('vin', vinRaw);
  }
  for (const field of ['makeId', 'modelId', 'trimId', 'bodyTypeId', 'powertrainTypeId'] as const) {
    if (present(field)) push(field, input[field] ?? null);
  }
  if (present('modelYear'))
    push('modelYear', normalizeModelYear(input.modelYear, 'body.modelYear'));
  if (present('powertrainCategory')) {
    if (input.powertrainCategory === undefined) {
      throw new VehicleWriteError(
        'body.powertrainCategory cannot be cleared',
        'body.powertrainCategory',
        'not_nullable'
      );
    }
    push('powertrainCategory', normalizeCategory(input.powertrainCategory, 'ice'));
  }
  if (present('color')) {
    const color = blankToNull(input.color);
    checkLength(color, MAX_COLOR, 'body.color');
    push('color', color);
  }
  if (present('displayNumber')) {
    const displayNumber = blankToNull(input.displayNumber);
    checkLength(displayNumber, MAX_DISPLAY_NUMBER, 'body.displayNumber');
    push('displayNumber', displayNumber);
  }

  if (changes.length === 0) {
    throw new VehicleWriteError(
      'An update must change at least one field',
      'body',
      'no_writable_field'
    );
  }
  return { changes };
}
