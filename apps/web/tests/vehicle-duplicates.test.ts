import { describe, expect, it } from 'vitest';
import {
  MIN_REVIEW_REASON,
  VEHICLE_DUPLICATE_DECISIONS,
  VEHICLE_DUPLICATE_STATUSES,
  changeShape,
  formatMatchScore,
  isActionable,
  type VehicleDuplicateCandidate,
  type VehicleHistoryEntry,
} from '@/features/vehicles/duplicates-contract';
import { DOCUMENT_LIST_PERMISSION } from '@/features/vehicles/documents-contract';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import { flattenNavigation } from '@/config/navigation';

/**
 * Vehicle documents/media (`FE-026`, `FE-027`), duplicate review (`FE-028`) and
 * attribute history (`FE-029`).
 *
 * Most of what these tasks needed was a refusal: no merge affordance, no
 * duplicate scan from a screen, no invented media policy, no pretence that the
 * attribute ledger is a unified timeline.
 */

const CANDIDATE: VehicleDuplicateCandidate = {
  id: 'c1',
  vehicleIdA: 'v1',
  // Published by the operation since #194 and omitted from the contract type
  // until `P1-27-FE-028`, which is why this fixture inherited the omission.
  displayNumberA: 'V-0001',
  vehicleIdB: 'v2',
  displayNumberB: 'V-0002',
  matchScore: '0.930',
  matchBasis: { signals: [{ signal: 'vin_collision', weight: 1 }] },
  status: 'open',
  detectedAt: '2026-08-04T10:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
};

const CHANGE: VehicleHistoryEntry = {
  id: 'h1',
  fieldCode: 'color',
  oldValue: 'Silver',
  newValue: 'Blue',
  occurredAt: '2026-08-04T10:00:00.000Z',
  actorId: 'u1',
};

describe('the operations this wave calls, and the two it deliberately does not', () => {
  it('resolves the duplicate list, the review and the history', () => {
    expect(resolveOperation('GET', '/api/v1/vehicle-duplicates')?.operationId).toBe(
      'veh.vehicle-duplicate-list'
    );
    expect(resolveOperation('POST', '/api/v1/vehicle-duplicates/c1/review')?.operationId).toBe(
      'veh.vehicle-duplicate-review'
    );
    expect(resolveOperation('GET', '/api/v1/vehicles/v1/history')?.operationId).toBe(
      'veh.vehicle-history'
    );
  });

  it('never exports a duplicate-scan caller', async () => {
    // `veh.vehicle-duplicate-scan` reads like a query and is a privileged
    // audited WRITE that creates rows, throttled at 30/min. A screen that
    // "refreshed" by scanning would write audit history every time somebody
    // looked at the queue.
    const api = await import('@/features/vehicles/duplicates-api');
    expect(Object.keys(api).some((k) => /scan/i.test(k))).toBe(false);
  });

  it('never exports a vehicle-merge caller', async () => {
    // `P1-OD-017` is open. Same rule as FE-016, which shipped a merge form by
    // mistake and had it removed.
    const api = await import('@/features/vehicles/duplicates-api');
    expect(Object.keys(api).some((k) => /merge/i.test(k))).toBe(false);
  });

  it('requires an idempotency key on the review and not on the reads', () => {
    expect(requiresIdempotencyKey('POST', '/api/v1/vehicle-duplicates/c1/review')).toBe(true);
    expect(requiresIdempotencyKey('GET', '/api/v1/vehicle-duplicates')).toBe(false);
    expect(requiresIdempotencyKey('GET', '/api/v1/vehicles/v1/history')).toBe(false);
  });
});

describe('review accepts exactly one decision', () => {
  it('offers dismissal only', () => {
    expect([...VEHICLE_DUPLICATE_DECISIONS]).toEqual(['dismissed']);
    expect([...VEHICLE_DUPLICATE_STATUSES]).toEqual(['open', 'dismissed', 'merged']);
  });

  it('treats only an open candidate as decidable, and fails closed otherwise', () => {
    expect(isActionable(CANDIDATE)).toBe(true);
    expect(isActionable({ ...CANDIDATE, status: 'dismissed' })).toBe(false);
    expect(isActionable({ ...CANDIDATE, status: 'merged' })).toBe(false);
    // An unknown status must not unlock a control that changes a record.
    expect(isActionable({ ...CANDIDATE, status: 'under_appeal' })).toBe(false);
  });

  it('states the same reason floor the write enforces', () => {
    // "requires a substantive reason" moved to `duplicate-review-writes.test.ts`,
    // where it drives `reviewVehicleDuplicateAction`'s own schema. It used to
    // call `validateReviewReason`, a mirror with no production caller — the twin
    // of the CRM one, and the same defect as `P1-27-FE-013`.
    //
    // The BOUND stays here: the screen reads it for the field's `minLength`, and
    // a floor that drifted from the schema's would let an operator type a reason
    // the form accepts and the write rejects.
    expect(MIN_REVIEW_REASON).toBe(10);
  });
});

describe('the match score is never parsed as a float', () => {
  it('rounds a half-boundary decimally, where a float rounds down', () => {
    // `0.145 * 100` is 14.499999999999998 in IEEE-754.
    expect(formatMatchScore('0.145')).toBe('15%');
    expect(formatMatchScore('0.285')).toBe('29%');
  });

  it('refuses junk that parseFloat would happily read', () => {
    expect(formatMatchScore('0.9; DROP TABLE x')).toBeNull();
    expect(formatMatchScore('0x10')).toBeNull();
    expect(formatMatchScore('1e-1')).toBeNull();
  });

  it('refuses an out-of-range value a float would round into range', () => {
    expect(formatMatchScore('1.0000000000000000001')).toBeNull();
  });

  it('carries a precision no float can hold', () => {
    expect(formatMatchScore('0.93000000000000000000001')).toBe('93%');
  });
});

describe('an attribute change has four shapes, not one', () => {
  it('distinguishes set, cleared, changed and empty', () => {
    // "old → new" reads as nonsense for three of these. A creation has no old
    // value; a clearing has no new one; and the ledger can record a change that
    // carries neither.
    expect(changeShape({ ...CHANGE, oldValue: null })).toBe('set');
    expect(changeShape({ ...CHANGE, newValue: null })).toBe('cleared');
    expect(changeShape(CHANGE)).toBe('changed');
    expect(changeShape({ ...CHANGE, oldValue: null, newValue: null })).toBe('empty');
  });

  it('treats an empty string the same as null', () => {
    // The column is nullable and the ledger also stores empty strings; both mean
    // "no value" to a reader.
    expect(changeShape({ ...CHANGE, oldValue: '' })).toBe('set');
    expect(changeShape({ ...CHANGE, newValue: '' })).toBe('cleared');
  });

  it('never produces a literal "null" for a reader to see', () => {
    for (const shape of [
      changeShape({ ...CHANGE, oldValue: null }),
      changeShape({ ...CHANGE, newValue: null }),
      changeShape({ ...CHANGE, oldValue: null, newValue: null }),
    ]) {
      expect(shape).not.toContain('null');
    }
  });
});

describe('both duplicate queues are reachable, and each behind its own code', () => {
  // Both screens existed with no route into them: nothing in the sidebar, and no
  // link from the customer or vehicle list. A page an operator cannot navigate
  // to is not delivered, and Owner acceptance would have found it by failing to
  // find it.
  const entries = flattenNavigation();

  it.each([
    ['customer-duplicates', '/crm/customer-duplicates', 'crm.customer.duplicate.review'],
    ['vehicle-duplicates', '/vehicles/duplicates', 'veh.vehicle.duplicate.review'],
  ])('links %s at %s behind %s', (key, href, permission) => {
    const entry = entries.find((e) => e.key === key);
    expect(entry, `${key} is not in the sidebar`).toBeDefined();
    expect(entry?.href).toBe(href);
    // NOT the module read code. Deciding whether two records are the same thing
    // is a separate capability from being allowed to look at one.
    expect(entry?.permission).toBe(permission);
    expect(entry?.status).toBe('available');
  });

  it('never gates a duplicate queue on the merge permission', () => {
    // `*.merge` gates nothing in this phase. If it ever gated the queue, an
    // operator entitled to dismiss false pairs would lose work they may do.
    for (const entry of entries) {
      expect(entry.permission).not.toBe('crm.customer.merge');
      expect(entry.permission).not.toBe('veh.vehicle.merge');
    }
  });
});

describe('documents and media say what the platform actually has', () => {
  it('gates the document list on shared.document.manage, not veh.vehicle.read', () => {
    // Inverted relative to every other vehicle sub-resource: a *manage*
    // capability from a *different* module. An operator who can see the whole
    // vehicle may be unable to see its documents, and vice versa.
    expect(DOCUMENT_LIST_PERMISSION).toBe('shared.document.manage');
    expect(DOCUMENT_LIST_PERMISSION).not.toBe('veh.vehicle.read');
  });

  /*
   * A case reading "records media as blocked on the open decision" stood here,
   * asserting `MEDIA_STATUS === 'blocked-on-p1-od-025'`. The decision it named
   * is RESOLVED and the constant is gone — it had no production consumer once
   * the screen stopped printing its companion identifier at operators. What the
   * case was really claiming is that this build has no vehicle media capability,
   * which the next one measures against the module itself rather than against a
   * string describing it.
   */

  it('exposes no upload helper of any kind', async () => {
    const api = await import('@/features/vehicles/documents-api');
    expect(Object.keys(api).some((k) => /upload|media|attach/i.test(k))).toBe(false);
  });
});
