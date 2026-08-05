import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ISO_VIN_LENGTH,
  MAX_VIN_LENGTH,
  isFrozen,
  isNonStandardLength,
  labelFor,
  validateVinFormat,
  type VehicleDetail,
} from '@/features/vehicles/profile-contract';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import { VEHICLE_PERMISSIONS } from '@/features/crm/permissions';

/**
 * Vehicle profile (`FE-019`) and VIN validation (`FE-020`).
 *
 * The claims worth pinning are the ones about honesty: that a merged vehicle is
 * shown and shown as frozen, that a missing catalogue label distinguishes "not
 * recorded" from "not visible to you", and that a VIN check which could not run
 * never reads as a clean result.
 */

const client = { get: vi.fn(), send: vi.fn() };
const authorizedClient = vi.fn(async () => client as unknown);
vi.mock('@/lib/api/server-client', () => ({ authorizedClient: () => authorizedClient() }));

const { checkVinAvailability, updateVehicleAction } =
  await import('@/features/vehicles/profile-api');

const VEHICLE: VehicleDetail = {
  id: 'v1',
  displayNumber: 'VEH-1',
  vin: '1HGCM82633A004352',
  makeId: 'mk1',
  makeName: 'Toyota',
  modelId: 'md1',
  modelName: 'Camry',
  trimId: null,
  trimName: null,
  bodyTypeId: 'bt1',
  bodyTypeName: null,
  powertrainTypeId: null,
  powertrainTypeName: null,
  modelYear: 2019,
  powertrainCategory: 'ice',
  color: 'Silver',
  lifecycleStatus: 'active',
  workshopStatus: 'none',
  mergedIntoId: null,
  recordVersion: 3,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: null,
};

beforeEach(() => {
  client.get.mockReset();
  client.send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('the two vehicle writes are separate capabilities', () => {
  it('resolves both PATCH operations', () => {
    expect(resolveOperation('PATCH', '/api/v1/vehicles/v1')?.operationId).toBe(
      'veh.vehicle-update'
    );
    expect(resolveOperation('PATCH', '/api/v1/vehicles/v1/status')?.operationId).toBe(
      'veh.vehicle-status-change'
    );
  });

  it('requires an idempotency key on both', () => {
    // `P1-27-INT-003` — these are two of the nine non-POST idempotent
    // operations that answered 400 before authorization on every attempt.
    expect(requiresIdempotencyKey('PATCH', '/api/v1/vehicles/v1')).toBe(true);
    expect(requiresIdempotencyKey('PATCH', '/api/v1/vehicles/v1/status')).toBe(true);
  });

  it('gates editing and status changes on different permissions', () => {
    expect(VEHICLE_PERMISSIONS.vehicleManage).toBe('veh.vehicle.manage');
    expect(VEHICLE_PERMISSIONS.statusManage).toBe('veh.vehicle.status.manage');
    expect(VEHICLE_PERMISSIONS.vehicleManage).not.toBe(VEHICLE_PERMISSIONS.statusManage);
  });
});

describe('a merged vehicle is frozen, not missing', () => {
  it('treats a vehicle with mergedIntoId as frozen', () => {
    expect(isFrozen(VEHICLE)).toBe(false);
    expect(isFrozen({ ...VEHICLE, mergedIntoId: 'v2' })).toBe(true);
  });

  it('treats lifecycleStatus merged as frozen even without mergedIntoId', () => {
    // Belt and braces: either signal alone means every write answers 409.
    expect(isFrozen({ ...VEHICLE, lifecycleStatus: 'merged' })).toBe(true);
  });
});

describe('a missing catalogue label says WHICH kind of missing', () => {
  it('reports an unset reference as unset', () => {
    expect(labelFor(null, null)).toEqual({ kind: 'unset' });
  });

  it('reports a present id with no name as UNAVAILABLE, not unset', () => {
    // These are different facts. The catalogue reads are RLS-filtered, so a row
    // belonging to another tenant resolves to null exactly as an unset
    // reference does — and an operator must not read "not recorded" for a make
    // that is simply invisible to them.
    expect(labelFor('bt1', null)).toEqual({ kind: 'unavailable' });
    expect(labelFor('bt1', '   ')).toEqual({ kind: 'unavailable' });
  });

  it('reports a resolved label as a value', () => {
    expect(labelFor('mk1', 'Toyota')).toEqual({ kind: 'value', name: 'Toyota' });
  });

  it('never yields the id as the label', () => {
    for (const state of [labelFor(null, null), labelFor('mk1', null)]) {
      expect(JSON.stringify(state)).not.toContain('mk1');
    }
  });
});

describe('VIN format validation stays within what the platform enforces', () => {
  it('accepts a 17-character VIN', () => {
    expect(validateVinFormat('1HGCM82633A004352')).toBe('ok');
  });

  it('ACCEPTS a VIN that is not 17 characters', () => {
    // `veh.vehicles.vin_raw` is `text` with a length bound and no format CHECK.
    // Refusing a short VIN here would refuse older, imported and non-road
    // vehicles the database is happy to store.
    expect(validateVinFormat('ABC123')).toBe('ok');
    expect(validateVinFormat('X')).toBe('ok');
  });

  it('accepts I, O and Q, which normalize_vin preserves', () => {
    expect(validateVinFormat('IOQIOQIOQIOQIOQIO')).toBe('ok');
  });

  it('rejects a value with no alphanumeric character at all', () => {
    // It would normalise to the empty string and be stored as a VIN that
    // matches nothing.
    expect(validateVinFormat('---')).toBe('no-alphanumeric');
    expect(validateVinFormat('   ')).toBe('empty');
  });

  it('rejects a value past the column bound', () => {
    expect(validateVinFormat('A'.repeat(MAX_VIN_LENGTH + 1))).toBe('too-long');
    expect(validateVinFormat('A'.repeat(MAX_VIN_LENGTH))).toBe('ok');
  });

  it('flags a non-standard length as an observation only', () => {
    expect(isNonStandardLength('ABC123')).toBe(true);
    expect(isNonStandardLength('A'.repeat(ISO_VIN_LENGTH))).toBe(false);
    // And it is genuinely advisory — the same value still validates.
    expect(validateVinFormat('ABC123')).toBe('ok');
  });
});

describe('a VIN check that could not run is NOT "available"', () => {
  it('reports duplicate when another vehicle holds the VIN', async () => {
    client.get.mockResolvedValue({
      ok: true,
      data: { items: [{ id: 'other' }] },
      correlationId: 'c',
    });
    expect(await checkVinAvailability('ABC', 'v1')).toEqual({
      verdict: 'duplicate',
      holderId: 'other',
    });
  });

  it('does not treat the vehicle being edited as its own duplicate', async () => {
    client.get.mockResolvedValue({ ok: true, data: { items: [{ id: 'v1' }] }, correlationId: 'c' });
    expect((await checkVinAvailability('ABC', 'v1')).verdict).toBe('available');
  });

  it('reports UNAVAILABLE on a transport failure, never available', async () => {
    // The whole point. A timeout must not present a VIN that is in fact taken
    // as free to use.
    for (const kind of ['timeout', 'server', 'network', 'rate-limited', 'forbidden']) {
      client.get.mockResolvedValue({ ok: false, kind, correlationId: 'c' });
      const result = await checkVinAvailability('ABC', null);
      expect(result.verdict, kind).toBe('unavailable');
      expect(result.verdict, kind).not.toBe('available');
    }
  });

  it('reports unavailable when the session has expired', async () => {
    authorizedClient.mockResolvedValue(null);
    expect((await checkVinAvailability('ABC', null)).verdict).toBe('unavailable');
    expect(client.get).not.toHaveBeenCalled();
  });

  it('asks the same normalised question the unique index answers', async () => {
    client.get.mockResolvedValue({ ok: true, data: { items: [] }, correlationId: 'c' });
    await checkVinAvailability('1hg-cm8 2633', null);
    const [path] = client.get.mock.calls[0] as [string];
    // Sent through `veh.vehicle-search`, which compares against the generated
    // `vin_normalized` — the same column whose unique index produces the 409.
    expect(path).toContain('/api/v1/vehicles?vin=');
    expect(path).toContain('limit=2');
  });
});

describe('the edit sends only what changed', () => {
  it('sends nothing at all when nothing changed', async () => {
    const result = await updateVehicleAction('v1', {}, { status: 'idle' });
    expect(client.send).not.toHaveBeenCalled();
    expect(result.status).toBe('idle');
  });

  it('sends an explicit null to CLEAR a field', async () => {
    // Absent leaves the column untouched; null clears it. They are different
    // requests, and collapsing them would wipe untouched fields.
    client.send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });
    await updateVehicleAction('v1', { color: null }, { status: 'idle' });
    const [, , body] = client.send.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(body).toEqual({ color: null });
    expect('color' in body).toBe(true);
  });

  it('does NOT send an If-Match header argument', async () => {
    client.send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });
    await updateVehicleAction('v1', { color: 'Red' }, { status: 'idle' });
    // No vehicle operation is `versionGuarded`, so the header is ignored at
    // best and a 428 at worst. Three arguments, no options object.
    expect(client.send.mock.calls[0]).toHaveLength(3);
  });

  it('PATCHes the vehicle itself, not the status sub-resource', async () => {
    client.send.mockResolvedValue({ ok: true, data: {}, correlationId: 'c' });
    await updateVehicleAction('v1', { color: 'Red' }, { status: 'idle' });
    const [method, path] = client.send.mock.calls[0] as [string, string];
    expect(method).toBe('PATCH');
    expect(path).toBe('/api/v1/vehicles/v1');
    expect(path).not.toContain('/status');
  });
});
