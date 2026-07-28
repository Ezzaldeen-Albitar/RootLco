/**
 * Inventory domain vocabulary and exact quantity (Phase 1-21, P1-21-BE-015,
 * P1-21-QA-001).
 *
 * Pure unit tests: no database, no fixtures. What they protect is the boundary
 * between what a caller may send and what `numeric(12,3)` can hold, plus the
 * movement/reference matrix that `inv.guard_stock_movement_provenance` enforces.
 *
 * The quantity cases are deliberately adversarial about *representation* rather
 * than about size. A value that survives `Number()` and looks correct in a log can
 * still be a different number from the one the caller typed, and inventory counts
 * at the third decimal place — so the tests assert exact string round trips, not
 * approximate equality.
 */
import { describe, expect, it } from 'vitest';
import {
  CUSTODY_STATES,
  DAMAGE_DISPOSITIONS,
  DIRECTIONS,
  EXTERNAL_PURCHASE_STATES,
  ITEM_LIFECYCLE_STATES,
  ITEM_TYPES,
  InventoryRuleError,
  LOCATION_TYPES,
  MOVEMENT_REFERENCE_MATRIX,
  MOVEMENT_TYPES,
  OPENING_BATCH_STATES,
  QUANTITY_MAX,
  QUANTITY_MIN,
  Quantity,
  REFERENCE_KINDS,
  RESERVATION_STATES,
  assertLegalMovementReference,
  assertQuarantineDestination,
  assertReservationMatchesIssue,
  assertWorkOrderAcceptsParts,
  isLegalMovementReference,
} from '@/modules/inventory';

describe('inventory vocabularies mirror the frozen inv CHECK constraints', () => {
  it('fixes every vocabulary exactly, with no invented value', () => {
    // Transcribed from ck_stock_movements_type / _reference_kind / _direction and
    // the sibling status CHECKs. The database suite asserts these same arrays
    // against the live catalog, so a drift fails there; here the point is that
    // nothing extra has been added — particularly `transfer`, which P1-10 dropped.
    expect([...MOVEMENT_TYPES]).toEqual(['opening', 'issue', 'return', 'damage', 'adjustment']);
    expect([...REFERENCE_KINDS]).toEqual([
      'opening_line',
      'part_issue',
      'part_return',
      'damage',
      'adjustment',
    ]);
    expect([...DIRECTIONS]).toEqual(['in', 'out']);
    expect([...RESERVATION_STATES]).toEqual(['active', 'released', 'consumed', 'expired']);
    expect([...LOCATION_TYPES]).toEqual(['warehouse', 'storage', 'quarantine']);
    expect([...ITEM_TYPES]).toEqual(['part', 'material', 'consumable', 'fluid', 'kit']);
    expect([...ITEM_LIFECYCLE_STATES]).toEqual(['active', 'archived']);
    expect([...OPENING_BATCH_STATES]).toEqual(['draft', 'approved']);
    expect([...DAMAGE_DISPOSITIONS]).toEqual(['quarantined', 'scrapped', 'returned_to_supplier']);
    expect([...CUSTODY_STATES]).toEqual(['received', 'in_use', 'returned', 'consumed']);
    expect([...EXTERNAL_PURCHASE_STATES]).toEqual(['recorded', 'linked', 'cancelled']);
  });

  it('has no movement kind for a transfer, a customer-supplied part, or a purchase', () => {
    // These three absences are load-bearing. A `transfer` kind would let stock move
    // between locations with no primitive behind it; a `customer_supplied` or
    // `external_purchase` kind would let either record inflate company stock.
    expect(MOVEMENT_TYPES).not.toContain('transfer');
    expect(REFERENCE_KINDS).not.toContain('transfer');
    expect(REFERENCE_KINDS).not.toContain('customer_supplied');
    expect(REFERENCE_KINDS).not.toContain('external_purchase');
    expect(LOCATION_TYPES).not.toContain('transit');
  });
});

describe('the movement/reference matrix (P1-21-BE-015)', () => {
  it('accepts exactly the seven legal triples and nothing else', () => {
    expect(MOVEMENT_REFERENCE_MATRIX).toHaveLength(7);
    // Every legal triple is accepted.
    for (const row of MOVEMENT_REFERENCE_MATRIX) {
      expect(isLegalMovementReference(row.movementType, row.referenceKind, row.direction)).toBe(
        true
      );
    }
    // And the WHOLE cartesian product outside the matrix is refused. Walking the
    // product rather than listing a few negatives is what makes this a matrix test:
    // a new vocabulary value cannot be added without either appearing in the matrix
    // or failing here.
    let refused = 0;
    for (const movementType of MOVEMENT_TYPES) {
      for (const referenceKind of REFERENCE_KINDS) {
        for (const direction of DIRECTIONS) {
          const legal = MOVEMENT_REFERENCE_MATRIX.some(
            (r) =>
              r.movementType === movementType &&
              r.referenceKind === referenceKind &&
              r.direction === direction
          );
          if (legal) continue;
          refused += 1;
          expect(isLegalMovementReference(movementType, referenceKind, direction)).toBe(false);
          expect(() =>
            assertLegalMovementReference(movementType, referenceKind, direction)
          ).toThrow(InventoryRuleError);
        }
      }
    }
    // 5 types x 5 kinds x 2 directions = 50 combinations, 7 of which are legal.
    expect(refused).toBe(43);
  });

  it('refuses a movement type that does not exist at all', () => {
    expect(isLegalMovementReference('transfer', 'part_issue', 'out')).toBe(false);
    expect(isLegalMovementReference('issue', 'external_purchase', 'out')).toBe(false);
  });
});

describe('Quantity is exact at the third decimal', () => {
  it('round-trips values IEEE-754 cannot represent', () => {
    // 0.001 and 0.1 + 0.2 are the canonical float failures. The assertion is on the
    // exact string, because a tolerance-based check would pass for a wrong value.
    expect(Quantity.parse('0.001').toString()).toBe('0.001');
    expect(Quantity.parse('0.1').plus(Quantity.parse('0.2')).toString()).toBe('0.300');
    expect(Quantity.parse('1.005').toString()).toBe('1.005');
    // The same sum in floating point is not 0.3, which is the whole point.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('normalises to the column scale without changing the value', () => {
    expect(Quantity.parse('5').toString()).toBe('5.000');
    expect(Quantity.parse('5.5').toString()).toBe('5.500');
    expect(Quantity.parse(QUANTITY_MAX).toString()).toBe('999999999.999');
    expect(Quantity.parse(QUANTITY_MIN).toString()).toBe('0.001');
  });

  it('adds and subtracts exactly', () => {
    const a = Quantity.parse('10.500');
    const b = Quantity.parse('3.750');
    expect(a.plus(b).toString()).toBe('14.250');
    expect(a.minus(b).toString()).toBe('6.750');
    expect(a.isGreaterThan(b)).toBe(true);
    expect(b.isGreaterThan(a)).toBe(false);
    expect(Quantity.parse('2.000').equals(Quantity.parse('2'))).toBe(true);
  });

  it('refuses every malformed representation rather than coercing it', () => {
    // Scientific notation is the dangerous one: PostgreSQL would accept `1e3` for a
    // numeric and store 1000, so a caller who typed it by accident would silently
    // book a thousand units.
    for (const bad of [
      '1e3',
      '1E3',
      '+5',
      'NaN',
      'Infinity',
      '-Infinity',
      '',
      '   ',
      'five',
      '5.0001', // scale 4 — beyond numeric(12,3)
      '1234567890', // 10 integer digits — beyond numeric(12,3)
      '0x10',
      '5,000',
      '5.',
      '.5',
      '1_000',
    ]) {
      expect(() => Quantity.parse(bad), `should refuse ${JSON.stringify(bad)}`).toThrow(
        InventoryRuleError
      );
    }
  });

  it('refuses a number, so a lossy value cannot enter through the type system', () => {
    // @ts-expect-error deliberately passing the wrong type — this is the guard.
    expect(() => Quantity.parse(5)).toThrow(InventoryRuleError);
    // @ts-expect-error same, on the database-facing constructor.
    expect(() => Quantity.fromDatabase(5)).toThrow(InventoryRuleError);
    expect(() => Quantity.fromDatabase(null)).toThrow(InventoryRuleError);
    // `pg` returns numeric as a string, and that is what must be accepted.
    expect(Quantity.fromDatabase('7.250').toString()).toBe('7.250');
  });

  it('refuses zero and negatives, because every inv quantity CHECK is "> 0"', () => {
    expect(() => Quantity.parse('0').assertPostable()).toThrow(InventoryRuleError);
    expect(() => Quantity.parse('0.000').assertPostable()).toThrow(InventoryRuleError);
    expect(() => Quantity.parse('-1').assertPostable()).toThrow(InventoryRuleError);
    expect(() => Quantity.parse('-0.001').assertPostable()).toThrow(InventoryRuleError);
    // The smallest legal value is accepted, so the boundary is exact rather than
    // conservative.
    expect(Quantity.parse(QUANTITY_MIN).assertPostable().toString()).toBe('0.001');
  });

  it('refuses an overflow at the column boundary, not one digit later', () => {
    expect(Quantity.parse(QUANTITY_MAX).assertPostable().toString()).toBe(QUANTITY_MAX);
    // One thousandth more has ten integer digits once carried, so the literal is
    // already refused by the parser.
    expect(() => Quantity.parse('1000000000.000')).toThrow(InventoryRuleError);
  });

  it('exposes no toNumber(), so the lossy path is not the convenient one', () => {
    const q = Quantity.parse('1.005') as unknown as Record<string, unknown>;
    expect(q['toNumber']).toBeUndefined();
    expect(q['valueOf']).toBe(Object.prototype.valueOf);
    // JSON serialization keeps the exact string rather than emitting a float.
    expect(JSON.stringify({ q: Quantity.parse('0.001') })).toBe('{"q":"0.001"}');
  });
});

describe('work-order lifecycle rule (closes P1-21-D-02)', () => {
  const base = { code: 'in_progress', isClosed: false, isTerminal: false, allowsJobs: true };

  it('accepts a work order that is open and allows work', () => {
    expect(() => assertWorkOrderAcceptsParts(base)).not.toThrow();
  });

  it('refuses a draft work order, which the protected function accepts', () => {
    // inv.issue_part selects wo.work_orders.state and never reads the variable, so
    // a draft work order takes an issue. This is the rule that closes it.
    expect(() =>
      assertWorkOrderAcceptsParts({ ...base, code: 'draft', allowsJobs: false })
    ).toThrow(InventoryRuleError);
  });

  it('refuses closed, terminal, and cancelled work orders', () => {
    expect(() => assertWorkOrderAcceptsParts({ ...base, isClosed: true })).toThrow(
      InventoryRuleError
    );
    expect(() => assertWorkOrderAcceptsParts({ ...base, isTerminal: true })).toThrow(
      InventoryRuleError
    );
    // A closed work order is refused even if it still nominally allows jobs, so the
    // rule does not depend on the flags being mutually consistent.
    expect(() =>
      assertWorkOrderAcceptsParts({ ...base, isClosed: true, allowsJobs: true })
    ).toThrow(InventoryRuleError);
  });
});

describe('reservation/issue coherence (closes P1-21-D-03)', () => {
  const issue = { itemId: 'item-1', locationId: 'loc-1', workOrderId: 'wo-1' };
  const reservation = {
    id: 'res-1',
    itemId: 'item-1',
    locationId: 'loc-1',
    workOrderId: 'wo-1',
    status: 'active',
  };

  it('accepts a reservation that matches the issue', () => {
    expect(() => assertReservationMatchesIssue(reservation, issue)).not.toThrow();
  });

  it('accepts a reservation with no work order, which is a legal shape', () => {
    // work_order_id is nullable, so a floor reservation not yet tied to a job is
    // legitimate and must not be refused.
    expect(() =>
      assertReservationMatchesIssue({ ...reservation, workOrderId: null }, issue)
    ).not.toThrow();
  });

  it('refuses a reservation for a different item — the reproduced defect', () => {
    // The live probe issued item A citing item B's reservation and SUCCEEDED,
    // releasing reserved quantity on an unrelated cell.
    expect(() =>
      assertReservationMatchesIssue({ ...reservation, itemId: 'item-2' }, issue)
    ).toThrow(InventoryRuleError);
  });

  it('refuses a different location and a different work order', () => {
    expect(() =>
      assertReservationMatchesIssue({ ...reservation, locationId: 'loc-2' }, issue)
    ).toThrow(InventoryRuleError);
    expect(() =>
      assertReservationMatchesIssue({ ...reservation, workOrderId: 'wo-2' }, issue)
    ).toThrow(InventoryRuleError);
  });

  it('refuses every non-active reservation', () => {
    for (const status of ['released', 'consumed', 'expired']) {
      expect(() => assertReservationMatchesIssue({ ...reservation, status }, issue)).toThrow(
        InventoryRuleError
      );
    }
  });
});

describe('damage destination rule (P1-21-BE-008)', () => {
  const sellable = { id: 'loc-1', locationType: 'warehouse' };
  const quarantine = { id: 'loc-q', locationType: 'quarantine' };

  it('accepts a move from sellable stock into quarantine', () => {
    expect(() => assertQuarantineDestination(sellable, quarantine)).not.toThrow();
  });

  it('refuses a destination that is not quarantine, even though the CHECK allows it', () => {
    // ck_damaged_stock_locations only requires the two ids to differ, so moving a
    // "damaged" unit into another sellable location satisfies the constraint and
    // leaves the unit available. That is the availability inflation being prevented.
    expect(() =>
      assertQuarantineDestination(sellable, { id: 'loc-2', locationType: 'warehouse' })
    ).toThrow(InventoryRuleError);
    expect(() =>
      assertQuarantineDestination(sellable, { id: 'loc-3', locationType: 'storage' })
    ).toThrow(InventoryRuleError);
  });

  it('refuses damaging stock that is already in quarantine, and a same-location move', () => {
    expect(() => assertQuarantineDestination(quarantine, { ...quarantine, id: 'loc-q2' })).toThrow(
      InventoryRuleError
    );
    expect(() => assertQuarantineDestination(sellable, { ...quarantine, id: sellable.id })).toThrow(
      InventoryRuleError
    );
  });
});
