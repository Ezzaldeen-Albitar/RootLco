import { describe, expect, it } from 'vitest';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import { VEHICLE_PERMISSIONS } from '@/features/crm/permissions';
import {
  EMPTY_CRITERIA,
  MODEL_YEAR_MAX,
  MODEL_YEAR_MIN,
  POWERTRAIN_CATEGORIES,
  VEHICLE_LIFECYCLE_STATUSES,
  WORKSHOP_STATUSES,
  CRITERIA_KEYS,
  isEmptyCriteria,
  normalizeCriteria,
  normalizeVinForDisplay,
  validateVehicleCreate,
} from '@/features/vehicles/contract';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * Vehicle search (`FE-017`) and creation (`FE-018`) contract.
 *
 * The things worth pinning are the ones a reasonable developer would get wrong
 * by analogy with CRM: search filters here are EXACT rather than prefix, the
 * creation response carries no duplicate advisory, and make/model/trim coherence
 * is enforced by the database rather than merely suggested by the UI.
 */

const VEHICLES = '/api/v1/vehicles';

describe('the operations resolve and carry the right idempotency requirement', () => {
  it('resolves search and create to distinct operations on one path', () => {
    expect(resolveOperation('GET', VEHICLES)?.operationId).toBe('veh.vehicle-search');
    expect(resolveOperation('POST', VEHICLES)?.operationId).toBe('veh.vehicle-create');
  });

  it('requires an idempotency key on create and not on search', () => {
    // `veh.vehicle-create` is `idempotent: true`; search is a GET. Asserting
    // both directions proves the resolver discriminates rather than answering
    // yes to everything on this path.
    expect(requiresIdempotencyKey('POST', VEHICLES)).toBe(true);
    expect(requiresIdempotencyKey('GET', VEHICLES)).toBe(false);
  });

  it('resolves the five catalogue reads and requires no key for any of them', () => {
    const catalogue = [
      ['/api/v1/vehicle-catalogue/makes', 'veh.catalogue-make-list'],
      ['/api/v1/vehicle-catalogue/makes/m1/models', 'veh.catalogue-model-list'],
      ['/api/v1/vehicle-catalogue/models/x1/trims', 'veh.catalogue-trim-list'],
      ['/api/v1/vehicle-catalogue/body-types', 'veh.catalogue-body-type-list'],
      ['/api/v1/vehicle-catalogue/powertrain-types', 'veh.catalogue-powertrain-type-list'],
    ] as const;

    for (const [path, id] of catalogue) {
      expect(resolveOperation('GET', path)?.operationId, path).toBe(id);
      expect(requiresIdempotencyKey('GET', path), path).toBe(false);
    }
  });

  it('does not confuse the make list with the models nested under it', () => {
    // Literal segments must outrank parameter segments, or
    // `/vehicle-catalogue/makes` would resolve against the `{makeId}` template.
    expect(resolveOperation('GET', '/api/v1/vehicle-catalogue/makes')?.operationId).toBe(
      'veh.catalogue-make-list'
    );
    expect(resolveOperation('GET', '/api/v1/vehicle-catalogue/makes/abc/models')?.operationId).toBe(
      'veh.catalogue-model-list'
    );
  });
});

describe('search and create are different capabilities', () => {
  it('reads with veh.vehicle.read and writes with veh.vehicle.manage', () => {
    // One read code fans out to five write codes across the vehicle domain, so
    // rendering a Create control from read access would be wrong here and on
    // every sub-resource.
    expect(VEHICLE_PERMISSIONS.vehicleRead).toBe('veh.vehicle.read');
    expect(VEHICLE_PERMISSIONS.vehicleManage).toBe('veh.vehicle.manage');
    expect(VEHICLE_PERMISSIONS.vehicleRead).not.toBe(VEHICLE_PERMISSIONS.vehicleManage);
  });
});

describe('criteria are sent as the strict schema expects', () => {
  it('treats untouched criteria as no search at all', () => {
    expect(isEmptyCriteria(EMPTY_CRITERIA)).toBe(true);
    expect(isEmptyCriteria({ ...EMPTY_CRITERIA, vin: '   ' })).toBe(true);
    expect(isEmptyCriteria({ ...EMPTY_CRITERIA, vin: '1HG' })).toBe(false);
  });

  it('OMITS an empty criterion rather than sending an empty string', () => {
    // `z.string().min(1)` makes `?vin=` a 422 for the whole request, and a
    // whitespace value passes validation then deliberately matches nothing.
    // Omitting the key is the only correct "no filter".
    const sent = normalizeCriteria({ ...EMPTY_CRITERIA, vin: ' 1HG ', plate: '   ' });
    expect(sent).toEqual({ vin: '1HG' });
    expect(Object.keys(sent)).not.toContain('plate');
    expect(Object.values(sent)).not.toContain('');
  });

  it('sends only the five contract keys, whatever the object actually carries', () => {
    // TypeScript is erased at runtime. `normalizeCriteria` used to iterate
    // `Object.entries(criteria)` and write each key into an object literal,
    // which CodeQL flagged as `js/remote-property-injection` (high) on PR #198.
    // It reads a fixed list now — which also matters against the `.strict()`
    // route schema, where ONE unrecognised key is a 422 for the whole search
    // rather than a dropped filter.
    const smuggled = {
      ...EMPTY_CRITERIA,
      vin: '1HG',
      // Not in the contract. Reaching the API, it would 422 the operator's
      // entire search.
      sort: 'createdAt',
      tenantId: 'not-yours',
    } as never;
    expect(normalizeCriteria(smuggled)).toEqual({ vin: '1HG' });
  });

  it('writes into a null-prototype object, so a __proto__ key has nowhere to go', () => {
    const hostile = { ...EMPTY_CRITERIA, vin: 'X', __proto__: { polluted: true } } as never;
    const sent = normalizeCriteria(hostile);
    expect(Object.getPrototypeOf(sent)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('names exactly the five keys the strict schema accepts', () => {
    expect([...CRITERIA_KEYS].sort()).toEqual([
      'lifecycleStatus',
      'plate',
      'powertrainCategory',
      'vehicleNumber',
      'vin',
    ]);
  });

  it('never produces a sort, page or total parameter', () => {
    const sent = normalizeCriteria({ ...EMPTY_CRITERIA, vin: 'X', plate: 'Y' });
    for (const forbidden of ['sort', 'page', 'total', 'offset', 'order']) {
      expect(Object.keys(sent)).not.toContain(forbidden);
    }
  });

  it('carries exactly the five criteria the query schema names', () => {
    // A sixth key would be a 422 for the whole request under `.strict()`.
    expect(Object.keys(EMPTY_CRITERIA).sort()).toEqual([
      'lifecycleStatus',
      'plate',
      'powertrainCategory',
      'vehicleNumber',
      'vin',
    ]);
  });
});

describe('VIN normalisation mirrors veh.normalize_vin', () => {
  it('upper-cases and strips every non-alphanumeric character', () => {
    expect(normalizeVinForDisplay('1hgcm8-2633a0043 52')).toBe('1HGCM82633A004352');
    expect(normalizeVinForDisplay('  wba.3a5#c5 ')).toBe('WBA3A5C5');
  });

  it('PRESERVES I, O and Q', () => {
    // The platform does not apply the ISO-3779 exclusion. Dropping them would
    // make the client search for a different VIN than the operator typed, and
    // the frozen SQL function keeps them.
    expect(normalizeVinForDisplay('IOQ123')).toBe('IOQ123');
  });

  it('yields an empty string for input with no alphanumerics', () => {
    // Which the backend treats as supplied-but-blank: it matches nothing rather
    // than dropping the filter.
    expect(normalizeVinForDisplay('%%%')).toBe('');
    expect(normalizeVinForDisplay('   ')).toBe('');
  });
});

describe('creation validation matches the route schema', () => {
  it('accepts a completely empty form', () => {
    // Every field is optional — a vehicle may be registered as a bare draft.
    expect(validateVehicleCreate({})).toEqual({});
  });

  it('rejects a non-integer model year before it becomes an opaque 422', () => {
    expect(validateVehicleCreate({ modelYear: '2019.5' }).modelYear).toBe('field.notAnInteger');
    expect(validateVehicleCreate({ modelYear: 'twenty' }).modelYear).toBe('field.notAnInteger');
  });

  it('enforces the model-year bounds the CHECK constraint sets', () => {
    expect(validateVehicleCreate({ modelYear: String(MODEL_YEAR_MIN - 1) }).modelYear).toBe(
      'vehicles.create.yearOutOfRange'
    );
    expect(validateVehicleCreate({ modelYear: String(MODEL_YEAR_MAX + 1) }).modelYear).toBe(
      'vehicles.create.yearOutOfRange'
    );
    expect(validateVehicleCreate({ modelYear: String(MODEL_YEAR_MIN) }).modelYear).toBeUndefined();
    expect(validateVehicleCreate({ modelYear: String(MODEL_YEAR_MAX) }).modelYear).toBeUndefined();
  });

  it('refuses a model without its make and a trim without its model', () => {
    // The DATABASE enforces make/model/trim coherence — a check violation
    // becomes `422 incoherent_reference`, which an operator cannot diagnose.
    // Caught here so the complaint appears beside the field.
    expect(validateVehicleCreate({ modelId: 'm1' }).modelId).toBe('vehicles.create.modelNeedsMake');
    expect(validateVehicleCreate({ trimId: 't1', makeId: 'k1' }).trimId).toBe(
      'vehicles.create.trimNeedsModel'
    );
  });

  it('accepts a coherent make/model/trim chain', () => {
    expect(validateVehicleCreate({ makeId: 'k1', modelId: 'm1', trimId: 't1' })).toEqual({});
  });

  it('rejects a powertrain category outside the CHECK vocabulary', () => {
    expect(validateVehicleCreate({ powertrainCategory: 'diesel' }).powertrainCategory).toBe(
      'field.required'
    );
    expect(
      validateVehicleCreate({ powertrainCategory: 'phev' }).powertrainCategory
    ).toBeUndefined();
  });
});

describe('vocabularies match the CHECK constraints and are fully translated', () => {
  it('has exactly the five lifecycle statuses', () => {
    expect([...VEHICLE_LIFECYCLE_STATUSES]).toEqual([
      'draft',
      'active',
      'inactive',
      'merged',
      'scrapped',
    ]);
  });

  it('has exactly the five powertrain categories', () => {
    expect([...POWERTRAIN_CATEGORIES]).toEqual(['ice', 'ev', 'hybrid', 'phev', 'other']);
  });

  it('has exactly the four workshop statuses', () => {
    expect([...WORKSHOP_STATUSES]).toEqual([
      'none',
      'in_workshop',
      'awaiting_parts',
      'ready_for_delivery',
    ]);
  });

  it('has an English and an Arabic label for every admitted value', () => {
    // Enumerated from the constraints rather than from en.json, so a key missing
    // from BOTH locales still fails.
    const required = [
      ...VEHICLE_LIFECYCLE_STATUSES.map((v) => `vehicles.lifecycle.${v}`),
      ...POWERTRAIN_CATEGORIES.map((v) => `vehicles.powertrain.${v}`),
      ...WORKSHOP_STATUSES.map((v) => `vehicles.workshop.${v}`),
    ];
    const missing = required.filter((k) => !(k in en) || !(k in ar));
    expect(missing).toEqual([]);
  });
});
