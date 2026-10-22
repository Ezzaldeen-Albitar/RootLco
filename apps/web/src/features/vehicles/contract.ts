/**
 * Vehicle search (`FE-017`) and creation (`FE-018`).
 *
 * Read out of `apps/api/src/app/api/v1/vehicles/route.ts`, the domain constants
 * it imports, and `vehicle-write-service.ts`. The published OpenAPI document
 * confirms the operation ids, permissions, audit classes and rate-limit
 * policies, but **not** the request shapes — it publishes no `requestBody` for
 * any of the 152 mutation operations (`P1-27-INT-004`).
 *
 * | operation                | method | path        | permission           |
 * | ------------------------ | ------ | ----------- | -------------------- |
 * | `veh.vehicle-search`     | GET    | `/vehicles` | `veh.vehicle.read`   |
 * | `veh.vehicle-create`     | POST   | `/vehicles` | `veh.vehicle.manage` |
 *
 * Search is `expensive-read` (30/min per user) and `auditClass: none`. Create is
 * `standard-command`, **`idempotent: true`**, and `auditClass: privileged`.
 *
 * ## Which filters are exact (widened in P1-32)
 *
 * - `vin` matches the **generated, normalised** VIN exactly.
 * - `plate` matches **any plate the vehicle has carried**, normalised on the SQL
 *   side. A hit that matched a plate carries `plateMatch`; `active: false` means
 *   it matched an earlier plate, which the screen must say.
 * - `vehicleNumber` is `display_number = $n`, exact.
 * - `make` and `model` are folded **contains** matches over the catalogue names,
 *   two characters at least.
 * - `q` is one box: make, model, vehicle number, part of a VIN or part of any
 *   plate, two characters at least.
 *
 * Combined with the 30/min rate limit, a search-per-keystroke would 429 within
 * seconds, so every surface searches on an explicit action.
 *
 * ## Search terms never reach the browser address bar
 *
 * `P1-27-SEC-002`: a VIN or a plate in a URL is in history and proxy logs, so the
 * criteria live in screen state and travel only to the API.
 *
 * ## There is no sort parameter and no total
 *
 * The query schema is `.strict()`: any unknown parameter — a `sort`, a `page`, a
 * cache-buster, a stale filter key — is a 422 for the whole request, not a
 * silently ignored extra. Ordering is fixed at `(created_at DESC, id DESC)`.
 */

/** `veh.vehicles.lifecycle_status` — `text` with a CHECK, not an enum. */
export const VEHICLE_LIFECYCLE_STATUSES = [
  'draft',
  'active',
  'inactive',
  'merged',
  'scrapped',
] as const;
export type VehicleLifecycleStatus = (typeof VEHICLE_LIFECYCLE_STATUSES)[number];

/** `veh.vehicles.powertrain_category`. NOT the same thing as a powertrain TYPE. */
export const POWERTRAIN_CATEGORIES = ['ice', 'ev', 'hybrid', 'phev', 'other'] as const;
export type PowertrainCategory = (typeof POWERTRAIN_CATEGORIES)[number];

/** `veh.vehicles.workshop_status`. Published by search; no P1-27 write sets it. */
export const WORKSHOP_STATUSES = [
  'none',
  'in_workshop',
  'awaiting_parts',
  'ready_for_delivery',
] as const;
export type WorkshopStatus = (typeof WORKSHOP_STATUSES)[number];

export const MAX_VIN_FRAGMENT = 64;
export const MAX_PLATE_FRAGMENT = 32;
export const MAX_VEHICLE_NUMBER = 64;
/** `MAX_VEHICLE_TEXT_FRAGMENT` in the domain: make, model and the free-text box. */
export const MAX_VEHICLE_TEXT = 80;
/** `MIN_VEHICLE_FRAGMENT` in the domain: make, model and the free-text box. */
export const MIN_VEHICLE_TEXT = 2;
export const MAX_VIN_INPUT = 64;
export const MAX_COLOR = 40;
export const MAX_DISPLAY_NUMBER = 40;
export const MODEL_YEAR_MIN = 1900;
export const MODEL_YEAR_MAX = 2100;

/**
 * The safe master projection, exactly as `VehicleSearchHit` declares it.
 *
 * **Make and model names since P1-32.** `makeName` and `modelName` are resolved
 * by the backend. A screen may still fall back to the catalogue for a hit whose
 * name is missing while its id is present.
 *
 * **No chassis or engine number, for anyone.** Those are `restricted` and live
 * in `veh.vehicle_identifiers`, which this contract never touches. The owner's
 * name is the one projection that depends on the caller: it is null without
 * `crm.customer.read`.
 */
export interface VehicleSearchHit {
  readonly id: string;
  readonly displayNumber: string | null;
  /** `vin_normalized`, not what anyone typed. Nullable — a VIN is optional. */
  readonly vin: string | null;
  readonly makeId: string | null;
  readonly modelId: string | null;
  /** `integer`. A real JS number, not a decimal string. */
  readonly modelYear: number | null;
  readonly powertrainCategory: PowertrainCategory;
  readonly lifecycleStatus: VehicleLifecycleStatus;
  readonly workshopStatus: WorkshopStatus;
  readonly createdAt: string;
  /**
   * The surviving vehicle when this one was merged away. Added by
   * `P1-27-INT-008`.
   *
   * Search **returns** merged vehicles — `lifecycle_status = 'merged'` is not
   * excluded — and every write against one answers 409 `ERR-RES-002`. Before
   * this field existed a merged row was indistinguishable from a live one until
   * an operator tried to edit it.
   */
  readonly mergedIntoId: string | null;
  /** Catalogue make name (P1-32). Null when no make is recorded. */
  readonly makeName: string | null;
  /** Catalogue model name (P1-32). Null when no model is recorded. */
  readonly modelName: string | null;
  /** The plate the vehicle carries now (P1-32). */
  readonly activePlate: string | null;
  /** Present only when a plate criterion matched (P1-32). */
  readonly plateMatch: VehiclePlateMatch | null;
  /**
   * The current owner's name (P1-32). Null when there is none, or when the
   * caller does not also hold `crm.customer.read`.
   */
  readonly customerDisplayName: string | null;
}

/** Which plate a plate search matched, and whether it is still the current one. */
export interface VehiclePlateMatch {
  readonly plate: string;
  readonly active: boolean;
  readonly validFrom: string;
  readonly validTo: string | null;
}

/** The criteria the `.strict()` query schema accepts, and nothing else. */
export interface VehicleSearchCriteria {
  readonly q: string;
  readonly vin: string;
  readonly plate: string;
  readonly vehicleNumber: string;
  readonly make: string;
  readonly model: string;
  readonly lifecycleStatus: string;
  readonly powertrainCategory: string;
}

export const EMPTY_CRITERIA: VehicleSearchCriteria = {
  q: '',
  vin: '',
  plate: '',
  vehicleNumber: '',
  make: '',
  model: '',
  lifecycleStatus: '',
  powertrainCategory: '',
};

/** The criteria the backend refuses below `MIN_VEHICLE_TEXT` characters. */
const MIN_LENGTH_KEYS = ['q', 'make', 'model'] as const;

/** True when a free-text, make or model value is too short for the backend. */
export function hasTooShortCriteria(criteria: VehicleSearchCriteria): boolean {
  return MIN_LENGTH_KEYS.some((key) => {
    const length = (criteria[key] ?? '').trim().length;
    return length > 0 && length < MIN_VEHICLE_TEXT;
  });
}

/**
 * The criteria keys, as a runtime value rather than only as a type.
 *
 * TypeScript is erased at runtime, so `Object.entries(criteria)` iterates
 * whatever the object actually carries — which CodeQL flagged as
 * `js/remote-property-injection` (high) on PR #198, and it was right to. The
 * type says five keys; nothing enforced it, and `__proto__` in that loop writes
 * somewhere nobody intended.
 *
 * Iterating this list instead of the object is also **more correct against the
 * contract**, which is the better reason to do it. The route schema is
 * `.strict()`: one unrecognised key is a 422 for the *whole* search, not a
 * dropped filter. Reading from a fixed list means an unexpected key cannot reach
 * the API at all, rather than reaching it and failing the operator's search.
 */
export const CRITERIA_KEYS = Object.freeze(
  Object.keys(EMPTY_CRITERIA) as readonly (keyof VehicleSearchCriteria)[]
);

/**
 * Whether the operator has actually asked for anything.
 *
 * An all-empty search would be a full-table scan against an `expensive-read`
 * budget, so the adapter refuses it. The screen also does not mount its results
 * until submission, which makes "no request before intent" structural rather
 * than a guard two files away.
 */
export function isEmptyCriteria(criteria: VehicleSearchCriteria): boolean {
  // Over `CRITERIA_KEYS`, not `Object.values`. An extra key on the object would
  // otherwise make an empty search look non-empty and issue the full-table scan
  // this function exists to refuse.
  return CRITERIA_KEYS.every((key) => (criteria[key] ?? '').trim().length === 0);
}

/**
 * Trims every criterion and drops the empty ones.
 *
 * Dropping matters more here than it looks. `z.string().min(1)` means `?vin=`
 * is a **422 for the whole request**, while `?vin=%20` passes validation and
 * then deliberately matches nothing — the backend keeps a supplied-but-blank
 * value rather than dropping the filter, so `display_number = ''` and
 * `plate_normalized = normalize_plate('')` are unsatisfiable by construction.
 *
 * A form that posted its untouched inputs would therefore either 422 or return
 * a confidently empty page. Omitting the key is the only correct "no filter".
 */
export function normalizeCriteria(criteria: VehicleSearchCriteria): Record<string, string> {
  // `Object.create(null)` and a fixed key list. The previous version iterated
  // `Object.entries(criteria)` and wrote each key into an object literal, which
  // CodeQL flagged as `js/remote-property-injection` (high) on PR #198 — a key
  // reaching this loop from anywhere but the fixed keys writes somewhere nobody
  // intended, and a null-prototype target has nowhere dangerous to write.
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of CRITERIA_KEYS) {
    const trimmed = (criteria[key] ?? '').trim();
    if (trimmed.length > 0) out[key] = trimmed;
  }
  return out;
}

/**
 * Normalises a VIN the way `veh.normalize_vin` does.
 *
 * Mirrors the frozen SQL function: upper-case, then strip everything outside
 * `[A-Z0-9]`. `I`, `O` and `Q` are **preserved** — the platform does not apply
 * the ISO-3779 exclusion, and silently dropping them here would make the client
 * search for a different VIN than the operator typed.
 *
 * Used for DISPLAY feedback only — the raw value is what gets sent, and the
 * backend normalises authoritatively. Doing it in two places that disagree is
 * how a search box and a database end up looking at different vehicles.
 */
export function normalizeVinForDisplay(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * What `POST /vehicles` accepts. **Every field is optional.**
 *
 * A vehicle can be registered as a bare draft and completed later, which is a
 * deliberate contract decision rather than a lax schema: a vehicle often arrives
 * at a workshop before anyone has its papers.
 *
 * `lifecycleStatus` is **not settable**. Creation always lands `draft`.
 */
export interface VehicleCreateInput {
  readonly vin?: string;
  readonly makeId?: string;
  readonly modelId?: string;
  readonly trimId?: string;
  readonly bodyTypeId?: string;
  readonly powertrainTypeId?: string;
  readonly modelYear?: number;
  readonly powertrainCategory?: PowertrainCategory;
  readonly color?: string;
  readonly displayNumber?: string;
}

/**
 * What creation returns.
 *
 * **There is no `possibleDuplicates` here.** CRM customer creation publishes an
 * advisory duplicate list; vehicle creation does not, and `veh.duplicate-scan`
 * is a separate privileged write that must never be fired to populate a screen.
 * So the vehicle creation result states what was created and links to the
 * review queue — it does not invent a warning the contract does not produce.
 *
 * `hasVin` rather than the VIN itself: a VIN is `internal`-classified, and the
 * response deliberately reports its presence instead of echoing it.
 */
export interface CreatedVehicle {
  readonly vehicleId: string;
  readonly lifecycleStatus: 'draft';
  readonly powertrainCategory: string;
  readonly hasVin: boolean;
}

export type FieldErrors = Readonly<Record<string, string>>;

/**
 * Validates the creation form against the route's Zod schema.
 *
 * Every bound below is the schema's. The three server-side failure modes this
 * cannot pre-empt — and must therefore surface honestly — are:
 *
 * - a duplicate VIN, which is **409 `ERR-RES-002`**,
 * - a catalogue id the tenant cannot see, 422 `unknown_reference`,
 * - an incoherent make/model/trim combination, 422 `incoherent_reference`.
 *
 * The third is why the catalogue selectors are dependent rather than free: the
 * database enforces coherence, so offering every model regardless of make would
 * produce a 422 the operator could not diagnose.
 */
export function validateVehicleCreate(values: Record<string, string>): FieldErrors {
  const errors: Record<string, string> = {};

  const vin = (values.vin ?? '').trim();
  if (vin.length > MAX_VIN_INPUT) errors.vin = 'field.tooLong';

  const color = (values.color ?? '').trim();
  if (color.length > MAX_COLOR) errors.color = 'field.tooLong';

  const displayNumber = (values.displayNumber ?? '').trim();
  if (displayNumber.length > MAX_DISPLAY_NUMBER) errors.displayNumber = 'field.tooLong';

  const year = (values.modelYear ?? '').trim();
  if (year.length > 0) {
    // `z.number().int()`. A non-integer is a 422 the operator cannot read, so it
    // is caught here where the field is.
    if (!/^\d+$/.test(year)) errors.modelYear = 'field.notAnInteger';
    else {
      const parsed = Number(year);
      if (parsed < MODEL_YEAR_MIN || parsed > MODEL_YEAR_MAX) {
        errors.modelYear = 'vehicles.create.yearOutOfRange';
      }
    }
  }

  const category = (values.powertrainCategory ?? '').trim();
  if (category.length > 0 && !POWERTRAIN_CATEGORIES.includes(category as PowertrainCategory)) {
    errors.powertrainCategory = 'field.required';
  }

  // A model without its make, or a trim without its model, is an incoherent
  // reference the database rejects. Caught here so the operator sees it beside
  // the field rather than as an opaque 422.
  if ((values.modelId ?? '').trim().length > 0 && (values.makeId ?? '').trim().length === 0) {
    errors.modelId = 'vehicles.create.modelNeedsMake';
  }
  if ((values.trimId ?? '').trim().length > 0 && (values.modelId ?? '').trim().length === 0) {
    errors.trimId = 'vehicles.create.trimNeedsModel';
  }

  return errors;
}
