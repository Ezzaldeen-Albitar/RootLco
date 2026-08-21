import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  AUTHORIZED_ACTIONS,
  EV_KINDS,
  SCOPED_ROLE,
  VEHICLE_RELATIONSHIP_ROLES,
  canHaveEvProfile,
  scopeState,
  suggestedEvKind,
  validateScope,
  type VehicleRelationship,
} from '@/features/vehicles/relations-contract';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import { VEHICLE_PERMISSIONS } from '@/features/crm/permissions';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * EV profile (`FE-024`) and vehicle-customer relationships (`FE-025`).
 *
 * Two claims carry this wave, and both are about not saying something false:
 * a 404 on the EV profile is the ordinary state of a petrol car, and a null
 * authorization scope means "this role cannot carry one" for six roles in seven.
 */

const client = { get: vi.fn(), send: vi.fn() };
const authorizedClient = vi.fn(async () => client as unknown);
vi.mock('@/lib/api/server-client', () => ({ authorizedClient: () => authorizedClient() }));

const { readEvProfile } = await import('@/features/vehicles/relations-api');

const RELATIONSHIP: VehicleRelationship = {
  id: 'r1',
  partnerId: 'p1',
  partnerName: 'Layla Haddad',
  partnerNumber: 'C-000482',
  partnerType: 'individual',
  relationshipRole: 'owner',
  validFrom: '2026-01-01',
  validTo: null,
  active: true,
  allowedActions: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  client.get.mockReset();
  client.send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('the five operations and their three permissions', () => {
  it('resolves each one', () => {
    expect(resolveOperation('GET', '/api/v1/vehicles/v1/ev-profile')?.operationId).toBe(
      'veh.vehicle-ev-profile-read'
    );
    expect(resolveOperation('POST', '/api/v1/vehicles/v1/ev-profile')?.operationId).toBe(
      'veh.vehicle-ev-profile-set'
    );
    expect(resolveOperation('GET', '/api/v1/vehicles/v1/relationships')?.operationId).toBe(
      'veh.vehicle-relationship-list'
    );
    expect(resolveOperation('POST', '/api/v1/vehicles/v1/authorized-parties')?.operationId).toBe(
      'veh.vehicle-authorized-party-add'
    );
    expect(
      resolveOperation('POST', '/api/v1/vehicles/v1/authorized-parties/r1/retirement')?.operationId
    ).toBe('veh.vehicle-authorized-party-retire');
  });

  it('requires a key on all three writes and none of the reads', () => {
    expect(requiresIdempotencyKey('POST', '/api/v1/vehicles/v1/ev-profile')).toBe(true);
    expect(requiresIdempotencyKey('POST', '/api/v1/vehicles/v1/authorized-parties')).toBe(true);
    expect(
      requiresIdempotencyKey('POST', '/api/v1/vehicles/v1/authorized-parties/r1/retirement')
    ).toBe(true);
    expect(requiresIdempotencyKey('GET', '/api/v1/vehicles/v1/ev-profile')).toBe(false);
    expect(requiresIdempotencyKey('GET', '/api/v1/vehicles/v1/relationships')).toBe(false);
  });

  it('separates relationship management from vehicle management', () => {
    // Adding an authorized party is `relationship.manage`; editing the vehicle
    // is `vehicle.manage`. Gating both on one code would hand every editor the
    // ability to authorize people against a vehicle.
    expect(VEHICLE_PERMISSIONS.relationshipManage).toBe('veh.vehicle.relationship.manage');
    expect(VEHICLE_PERMISSIONS.relationshipManage).not.toBe(VEHICLE_PERMISSIONS.vehicleManage);
  });
});

describe('a 404 on the EV profile is not an error', () => {
  it('reports "none" rather than a failure', async () => {
    client.get.mockResolvedValue({ ok: false, kind: 'not-found', correlationId: 'c' });
    // Every ICE vehicle in the tenant produces this. Treating it as an error
    // would put a red panel on the majority of vehicle profiles.
    expect(await readEvProfile('v1')).toEqual({ status: 'none' });
  });

  it('still reports a real failure as a failure', async () => {
    // A read that could not run is NOT "this vehicle has no battery".
    for (const kind of ['forbidden', 'server', 'timeout', 'rate-limited']) {
      client.get.mockResolvedValue({ ok: false, kind, correlationId: 'c' });
      const state = await readEvProfile('v1');
      expect(state.status, kind).not.toBe('none');
      expect(state.status, kind).not.toBe('ok');
    }
  });

  it('passes a real profile through, capacity still a string', async () => {
    client.get.mockResolvedValue({
      ok: true,
      data: {
        evKind: 'bev',
        usableCapacityKwh: '77.400',
        chargePortType: 'CCS2',
        highVoltageWarning: true,
      },
      correlationId: 'c',
    });
    const state = await readEvProfile('v1');
    expect(state).toMatchObject({ status: 'ok' });
    if (state.status === 'ok') {
      // `numeric` as text. Rendering it through a float would drop the trailing
      // zeros the workshop deliberately recorded.
      expect(state.profile.usableCapacityKwh).toBe('77.400');
      expect(typeof state.profile.usableCapacityKwh).toBe('string');
    }
  });
});

describe('an EV profile only applies to some vehicles', () => {
  it('accepts ev, hybrid and phev and refuses ice', () => {
    expect(canHaveEvProfile('ev')).toBe(true);
    expect(canHaveEvProfile('hybrid')).toBe(true);
    expect(canHaveEvProfile('phev')).toBe(true);
    expect(canHaveEvProfile('ice')).toBe(false);
    expect(canHaveEvProfile('other')).toBe(false);
  });

  it('maps the vehicle category `ev` to the EV kind `bev`', () => {
    // Two vocabularies, different words for the same thing. A form that sent
    // `'ev'` as an `evKind` would be rejected by an enum that never had it.
    expect(suggestedEvKind('ev')).toBe('bev');
    expect(EV_KINDS).not.toContain('ev');
    expect(suggestedEvKind('hybrid')).toBe('hybrid');
    expect(suggestedEvKind('phev')).toBe('phev');
    expect(suggestedEvKind('ice')).toBeNull();
  });

  it('has exactly the three kinds the constraint admits', () => {
    expect([...EV_KINDS]).toEqual(['bev', 'hybrid', 'phev']);
  });
});

describe('a null authorization scope means "not applicable", not "no permissions"', () => {
  it('reports not-applicable for every role but authorized_person', () => {
    // Six roles out of seven. Rendering this as "no permissions granted" would
    // describe an owner, a driver and a payer as restricted.
    for (const role of VEHICLE_RELATIONSHIP_ROLES.filter((r) => r !== SCOPED_ROLE)) {
      const state = scopeState({ ...RELATIONSHIP, relationshipRole: role });
      expect(state.kind, role).toBe('not-applicable');
      expect(state.kind, role).not.toBe('none-granted');
    }
  });

  it('reports the granted actions for an authorized person', () => {
    const state = scopeState({
      ...RELATIONSHIP,
      relationshipRole: SCOPED_ROLE,
      allowedActions: ['approve_quotation', 'receive_invoices'],
    });
    expect(state).toEqual({
      kind: 'granted',
      actions: ['approve_quotation', 'receive_invoices'],
    });
  });

  it('flags an authorized person with no scope as unexpected, not as ordinary', () => {
    // The constraint forbids an empty scope on this role, so seeing one means
    // the data is not what the schema promises — a different fact from a role
    // that simply cannot carry one.
    expect(scopeState({ ...RELATIONSHIP, relationshipRole: SCOPED_ROLE }).kind).toBe(
      'none-granted'
    );
  });
});

describe('an authorization scope is validated the way the constraint is', () => {
  it('refuses an empty scope', () => {
    expect(validateScope([])).toBe('empty');
  });

  it('refuses duplicates', () => {
    expect(validateScope(['approve_quotation', 'approve_quotation'])).toBe('duplicate');
  });

  it('refuses an action outside the six', () => {
    // Nothing here grants ownership or any escalated authority, and a UI that
    // offered a seventh would send a value `veh.valid_authorization_scope`
    // rejects.
    expect(validateScope(['transfer_ownership'])).toBe('unknown');
    expect(validateScope(['approve_quotation', 'become_owner'])).toBe('unknown');
  });

  it('accepts a valid subset', () => {
    expect(validateScope(['approve_quotation'])).toBe('ok');
    expect(validateScope([...AUTHORIZED_ACTIONS])).toBe('ok');
  });

  it('has exactly the six actions the constraint admits', () => {
    expect([...AUTHORIZED_ACTIONS]).toEqual([
      'approve_quotation',
      'approve_additional_work',
      'receive_vehicle',
      'receive_reports',
      'receive_invoices',
      'communicate_about_service',
    ]);
  });
});

describe('every vocabulary is translated in both locales', () => {
  it('covers roles, actions and EV kinds', () => {
    const required = [
      ...VEHICLE_RELATIONSHIP_ROLES.map((v) => `vehicles.role.${v}`),
      ...AUTHORIZED_ACTIONS.map((v) => `vehicles.action.${v}`),
      ...EV_KINDS.map((v) => `vehicles.evKind.${v}`),
    ];
    const missing = required.filter((k) => !(k in en) || !(k in ar));
    expect(missing).toEqual([]);
  });
});
