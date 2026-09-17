/**
 * P1-32 preparatory slice 3a — material demand control and truthful transfer
 * receipts, the database half (P1-32-PRE-120…123).
 *
 * Every rule the Owner set for this slice is a database property here, and every
 * case asserts the SIDE EFFECT — the row, the status, the committed quantity, the
 * balance — rather than an exit status alone:
 *
 *  1. a draw needs an APPROVED requirement; a missing specification or a missing
 *     unit conversion is an actionable `approval_required` state, never a silent
 *     allowance;
 *  2. one quantity is counted once as it moves request -> reservation -> issue, a
 *     restockable return gives it back, a closed request releases its remainder, and
 *     two concurrent requests cannot both pass the ceiling;
 *  3. an exception is a finite quantity with a reason, decided by a different
 *     person, and records the resulting allowance;
 *  4. a unit conversion is an exact factor, item-specific across dimensions, never
 *     inverted and never rounded;
 *  5. a vehicle specification resolves only when confirmed, never as zero;
 *  and a transfer receipt records what arrived: the remainder stays in transit
 *  until a further receipt, a return to origin, or a second-person write-off.
 *
 * Cases run inside rolled-back transactions on the runtime role, except the race,
 * which needs committed fixtures and separate connections; `cleanFixtures` unwinds
 * it through `deleteTenantCascade`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  runtimeClient,
  setContext,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  withCommittedTx,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
  USER_B,
} from './helpers';
import { seedP109Base, makeAuthorizedVisit, newWorkOrder } from './p1-09-helpers';
import { seedLocations, seedStock, expectFail, OTHER_ACTOR } from './p1-10-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_B };

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP109Base(admin);
}, 120_000);

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

const one = async <T>(c: Q, sql: string, params: unknown[] = []): Promise<T> =>
  (await c.query(sql, params)).rows[0] as T;

const text = async (c: Q, sql: string, params: unknown[] = []): Promise<string | null> =>
  ((await c.query(sql, params)).rows[0] as { v: string | null }).v;

const asUser = (c: Q, userId: string) =>
  c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

/** Runs `sql` expecting SQLSTATE `code` AND a message matching `pattern`. */
async function expectRefusal(
  c: Q,
  code: string,
  pattern: RegExp,
  sql: string,
  params: unknown[] = []
): Promise<void> {
  await c.query('SAVEPOINT sp_refusal');
  let err: { code?: string; message?: string } | undefined;
  try {
    await c.query(sql, params);
  } catch (e) {
    err = e as { code?: string; message?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT sp_refusal');
  if (!err) throw new Error(`expected ${code} ${String(pattern)} but the statement succeeded`);
  expect(`${err.code}: ${err.message}`).toMatch(new RegExp(`^${code}: .*${pattern.source}`));
}

/** A tenant unit of measure. */
const unit = (c: Q, code: string, dimension: string): Promise<string> =>
  one<{ id: string }>(
    c,
    `INSERT INTO inv.units_of_measure (scope, tenant_id, code, name, dimension, created_by)
     VALUES ('tenant',$1,$2,$3,$4,$5) RETURNING id`,
    [TENANT_A, code, `Unit ${code}`, dimension, USER_A]
  ).then((r) => r.id);

/** An item family and an item stocked in `uom`. */
async function item(
  c: Q,
  tag: string,
  uom: string,
  category?: string
): Promise<{ item: string; category: string }> {
  const cat =
    category ??
    (
      await one<{ id: string }>(
        c,
        `INSERT INTO inv.item_categories (tenant_id, code, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
        [TENANT_A, `mdc_${tag}`, `Family ${tag}`, USER_A]
      )
    ).id;
  const id = (
    await one<{ id: string }>(
      c,
      `INSERT INTO inv.item_master (tenant_id, item_category_id, sku, name, uom_id, item_type, created_by)
       VALUES ($1,$2,$3,$4,$5,'fluid',$6) RETURNING id`,
      [TENANT_A, cat, `MDC_${tag}`, `Item ${tag}`, uom, USER_A]
    )
  ).id;
  return { item: id, category: cat };
}

/** A vehicle of a tenant make/model/year, an authorized visit, a work order and one service line. */
async function workshop(
  c: Q,
  tag: string,
  year: number | null = 2020
): Promise<{ make: string; model: string; wo: string; line: string }> {
  const make = (
    await one<{ id: string }>(
      c,
      `INSERT INTO veh.makes (scope, tenant_id, code, name, created_by) VALUES ('tenant',$1,$2,$3,$4) RETURNING id`,
      [TENANT_A, `mk_${tag}`, `Make ${tag}`, USER_A]
    )
  ).id;
  const model = (
    await one<{ id: string }>(
      c,
      `INSERT INTO veh.models (scope, tenant_id, make_id, code, name, created_by) VALUES ('tenant',$1,$2,$3,$4,$5) RETURNING id`,
      [TENANT_A, make, `md_${tag}`, `Model ${tag}`, USER_A]
    )
  ).id;
  const vehicle = (
    await one<{ id: string }>(
      c,
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, make_id, model_id, model_year, powertrain_category, lifecycle_status, created_by)
       VALUES ($1, upper(rpad('MDC' || $2, 17, '0')), $3, $4, $5, 'ice', 'active', $6) RETURNING id`,
      [TENANT_A, tag, make, model, year, USER_A]
    )
  ).id;
  const visit = await makeAuthorizedVisit(c, vehicle);
  const wo = await newWorkOrder(c, visit, { vehicle });
  const line = (
    await one<{ id: string }>(
      c,
      `INSERT INTO wo.work_order_service_lines (tenant_id, company_id, branch_id, work_order_id, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, wo, `Oil service ${tag}`, USER_A]
    )
  ).id;
  return { make, model, wo, line };
}

/** Proposes an ENTERED requirement as USER_A and approves it as OTHER_ACTOR. */
async function approvedRequirement(
  c: Q,
  line: string,
  target: { item?: string; category?: string },
  allowance: string,
  uom: string
): Promise<string> {
  const id = (
    await one<{ id: string }>(
      c,
      `SELECT inv.propose_material_requirement($1,$2,$3,$4::numeric,$5,'Service manual table 4') AS id`,
      [line, target.item ?? null, target.category ?? null, allowance, uom]
    )
  ).id;
  await asUser(c, OTHER_ACTOR);
  await c.query(`SELECT inv.approve_material_requirement($1)`, [id]);
  await asUser(c, USER_A);
  return id;
}

/** The committed/remaining pair of a requirement at quantity scale. */
const usage = (c: Q, requirement: string) =>
  one<{
    open: string;
    reserved: string;
    issued: string;
    returned: string;
    committed: string;
    remaining: string;
    effective: string;
  }>(
    c,
    `SELECT open_request_quantity::numeric(12,3)::text AS open,
            reserved_quantity::numeric(12,3)::text AS reserved,
            issued_quantity::numeric(12,3)::text AS issued,
            returned_quantity::numeric(12,3)::text AS returned,
            committed_quantity::numeric(12,3)::text AS committed,
            remaining_quantity::numeric(12,3)::text AS remaining,
            effective_allowance::numeric(12,3)::text AS effective
       FROM inv.material_requirement_usage($1,$2)`,
    [TENANT_A, requirement]
  );

const onHand = (c: Q, itemId: string, location: string): Promise<string | null> =>
  text(
    c,
    `SELECT COALESCE((SELECT on_hand_qty FROM inv.stock_balances WHERE item_id = $1 AND location_id = $2), 0)::numeric(12,3)::text AS v`,
    [itemId, location]
  );

const ledger = (c: Q, itemId: string, location: string): Promise<string | null> =>
  text(
    c,
    `SELECT COALESCE(SUM(signed_qty), 0)::numeric(12,3)::text AS v FROM inv.stock_movements WHERE item_id = $1 AND location_id = $2`,
    [itemId, location]
  );

// ---------------------------------------------------------------------------
// Rule 4 — exact unit conversions
// ---------------------------------------------------------------------------
describe('inv.item_unit_conversions — exact factors, one direction, never rounded', () => {
  it('converts a pack of one item to litres exactly and refuses what no row states', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const pack = await unit(c, 'mdc_pack1', 'count');
      const litre = await unit(c, 'mdc_litre1', 'volume');
      const { item: oil } = await item(c, 'conv1', pack);
      const conv = (
        await one<{ id: string }>(
          c,
          `SELECT inv.set_item_unit_conversion($1,$2,$3,0.946,'Pack label') AS id`,
          [oil, pack, litre]
        )
      ).id;
      expect(
        await text(c, `SELECT inv.convert_item_quantity($1,$2,3,$3,$4)::text AS v`, [
          TENANT_A,
          oil,
          pack,
          litre,
        ])
      ).toBe('2.838');
      // No implied reverse: litres back to packs is a row nobody stated.
      expect(
        await text(c, `SELECT inv.unit_conversion_factor($1,$2,$3,$4)::text AS v`, [
          TENANT_A,
          oil,
          litre,
          pack,
        ])
      ).toBeNull();
      // Same unit is exactly one.
      expect(
        await text(c, `SELECT inv.unit_conversion_factor($1,$2,$3,$3)::text AS v`, [
          TENANT_A,
          oil,
          pack,
        ])
      ).toBe('1');

      // A factor whose product is not representable at three decimals is refused,
      // not rounded.
      await c.query(`SELECT inv.set_item_unit_conversion($1,$2,$3,0.3333,'Bottle label')`, [
        oil,
        pack,
        litre,
      ]);
      expect(
        await text(c, `SELECT inv.convert_item_quantity($1,$2,1,$3,$4)::text AS v`, [
          TENANT_A,
          oil,
          pack,
          litre,
        ])
      ).toBeNull();
      // Setting a new factor retired the old row rather than editing it.
      expect(
        await text(c, `SELECT status AS v FROM inv.item_unit_conversions WHERE id = $1`, [conv])
      ).toBe('retired');

      // A tenant-wide row may not cross dimensions; the reverse of a live row is refused.
      await expectRefusal(
        c,
        '23514',
        /crosses dimensions/,
        `SELECT inv.set_item_unit_conversion(NULL,$1,$2,0.946,'Guess')`,
        [pack, litre]
      );
      await expectRefusal(
        c,
        '23514',
        /reverse conversion is already live/,
        `SELECT inv.set_item_unit_conversion($1,$2,$3,3,'Inverse')`,
        [oil, litre, pack]
      );
      await expectFail(c, '23514', `SELECT inv.set_item_unit_conversion($1,$2,$3,0,'Zero')`, [
        oil,
        pack,
        litre,
      ]);
      await expectFail(c, '23514', `SELECT inv.set_item_unit_conversion($1,$2,$3,1.5,' ')`, [
        oil,
        pack,
        litre,
      ]);
      // A live factor is immutable: a change is a new row.
      await expectFail(
        c,
        '23514',
        `UPDATE inv.item_unit_conversions SET factor = 2 WHERE item_id = $1 AND status = 'active'`,
        [oil]
      );
      // The column is exact numeric, never a float.
      expect(
        await text(
          c,
          `SELECT data_type || ':' || numeric_precision || ',' || numeric_scale AS v
             FROM information_schema.columns
            WHERE table_schema = 'inv' AND table_name = 'item_unit_conversions' AND column_name = 'factor'`
        )
      ).toBe('numeric:24,12');
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — attributable vehicle specifications
// ---------------------------------------------------------------------------
describe('inv.vehicle_fluid_specifications — confirmed, sourced, never zero', () => {
  it('resolves only a confirmed specification, most specific first, and refuses a zero or unsourced capacity', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const litre = await unit(c, 'mdc_litre2', 'volume');
      const { make, model } = await workshop(c, 'spec1');
      const resolve = (year: number | null) =>
        c.query(
          `SELECT capacity::text AS capacity, source_reference
             FROM inv.resolve_vehicle_fluid_specification($1,$2,$3,$4,NULL,'engine_oil_change',NULL)`,
          [TENANT_A, make, model, year]
        );

      const makeWide = (
        await one<{ id: string }>(
          c,
          `SELECT inv.record_vehicle_fluid_specification($1,NULL,2015,2025,NULL,'engine_oil_change',NULL,5.200,$2,'Make bulletin 12') AS id`,
          [make, litre]
        )
      ).id;
      // Recorded is not confirmed: nothing resolves yet.
      expect((await resolve(2020)).rows).toEqual([]);
      await c.query(`SELECT inv.confirm_vehicle_fluid_specification($1)`, [makeWide]);
      expect((await resolve(2020)).rows).toEqual([
        { capacity: '5.200', source_reference: 'Make bulletin 12' },
      ]);

      const modelSpecific = (
        await one<{ id: string }>(
          c,
          `SELECT inv.record_vehicle_fluid_specification($1,$2,2018,2022,NULL,'engine_oil_change',NULL,4.500,$3,'Owner manual p.212') AS id`,
          [make, model, litre]
        )
      ).id;
      await c.query(`SELECT inv.confirm_vehicle_fluid_specification($1)`, [modelSpecific]);
      expect((await resolve(2020)).rows).toEqual([
        { capacity: '4.500', source_reference: 'Owner manual p.212' },
      ]);
      // Outside the model's year range the make-wide row answers; a vehicle with no
      // recorded year matches only a row that bounds no year — here, none.
      expect((await resolve(2024)).rows[0]?.capacity).toBe('5.200');
      expect((await resolve(null)).rows).toEqual([]);

      // Never zero, never unsourced.
      await expectRefusal(
        c,
        '23514',
        /known positive capacity/,
        `SELECT inv.record_vehicle_fluid_specification($1,NULL,NULL,NULL,NULL,'engine_oil_change',NULL,0,$2,'Guess')`,
        [make, litre]
      );
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.vehicle_fluid_specifications (tenant_id, make_id, service_condition, capacity, uom_id, source_reference, created_by)
         VALUES ($1,$2,'engine_oil_change',4,$3,'  ',$4)`,
        [TENANT_A, make, litre, USER_A]
      );
      // A specification cannot be born confirmed, and two confirmed rows with one
      // signature cannot overlap in model year.
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.vehicle_fluid_specifications (tenant_id, make_id, service_condition, capacity, uom_id, source_reference, status, confirmed_by, confirmed_at, created_by)
         VALUES ($1,$2,'engine_oil_change',4,$3,'Label','confirmed',$4,now(),$4)`,
        [TENANT_A, make, litre, USER_A]
      );
      const overlap = (
        await one<{ id: string }>(
          c,
          `SELECT inv.record_vehicle_fluid_specification($1,$2,2021,2023,NULL,'engine_oil_change',NULL,4.700,$3,'Other table') AS id`,
          [make, model, litre]
        )
      ).id;
      await expectFail(c, '23P01', `SELECT inv.confirm_vehicle_fluid_specification($1)`, [overlap]);
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 1 — a draw needs an approved requirement; missing facts are a state
// ---------------------------------------------------------------------------
describe('inv.material_requirements — approval required is a state, never an allowance', () => {
  it('stores a missing specification as approval_required, refuses every draw on it, and resolves once confirmed', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const litre = await unit(c, 'mdc_litre3', 'volume');
      const { item: oil } = await item(c, 'spec_path', litre);
      const { make, model, line } = await workshop(c, 'spec_path');

      const requirement = (
        await one<{ id: string }>(
          c,
          `SELECT inv.derive_material_requirement($1,$2,NULL,'engine_oil_change',NULL) AS id`,
          [line, oil]
        )
      ).id;
      expect(
        await one(
          c,
          `SELECT status, approval_required_reason AS reason, allowance_quantity AS allowance, uom_id
             FROM inv.material_requirements WHERE id = $1`,
          [requirement]
        )
      ).toEqual({
        status: 'approval_required',
        reason: 'missing_specification',
        allowance: null,
        uom_id: null,
      });

      // Nothing about "no specification" allows a draw — not the approver, not a request.
      await asUser(c, OTHER_ACTOR);
      await expectRefusal(
        c,
        '23514',
        /material_approval_required: missing_specification/,
        `SELECT inv.approve_material_requirement($1)`,
        [requirement]
      );
      await asUser(c, USER_A);
      await expectRefusal(
        c,
        '23514',
        /material_approval_required/,
        `SELECT inv.create_material_request($1,$2,1)`,
        [requirement, oil]
      );
      expect(
        await text(
          c,
          `SELECT count(*)::text AS v FROM inv.material_requests WHERE requirement_id = $1`,
          [requirement]
        )
      ).toBe('0');
      // Re-checking before the fact exists changes nothing.
      expect(await text(c, `SELECT inv.recheck_material_requirement($1) AS v`, [requirement])).toBe(
        'approval_required'
      );

      // The fact arrives: a confirmed specification with its source.
      const spec = (
        await one<{ id: string }>(
          c,
          `SELECT inv.record_vehicle_fluid_specification($1,$2,NULL,NULL,NULL,'engine_oil_change',NULL,4.300,$3,'Owner manual p.88') AS id`,
          [make, model, litre]
        )
      ).id;
      await c.query(`SELECT inv.confirm_vehicle_fluid_specification($1)`, [spec]);
      expect(await text(c, `SELECT inv.recheck_material_requirement($1) AS v`, [requirement])).toBe(
        'pending_approval'
      );
      expect(
        await one(
          c,
          `SELECT specification_id, allowance_quantity::text AS allowance, source_reference
             FROM inv.material_requirements WHERE id = $1`,
          [requirement]
        )
      ).toEqual({
        specification_id: spec,
        allowance: '4.300',
        source_reference: 'Owner manual p.88',
      });
      await asUser(c, OTHER_ACTOR);
      await c.query(`SELECT inv.approve_material_requirement($1)`, [requirement]);
      await asUser(c, USER_A);
      await c.query(`SELECT inv.create_material_request($1,$2,4.3)`, [requirement, oil]);
      expect((await usage(c, requirement)).remaining).toBe('0.000');
    });
  });

  it('stores a missing unit conversion as approval_required and refuses approval until the conversion exists', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const pack = await unit(c, 'mdc_pack4', 'count');
      const litre = await unit(c, 'mdc_litre4', 'volume');
      const { item: oil } = await item(c, 'unit_path', pack);
      const { line } = await workshop(c, 'unit_path');

      const requirement = (
        await one<{ id: string }>(
          c,
          `SELECT inv.propose_material_requirement($1,$2,NULL,4.5,$3,'Service manual table 4') AS id`,
          [line, oil, litre]
        )
      ).id;
      expect(
        await one(
          c,
          `SELECT status, approval_required_reason AS reason, allowance_quantity::text AS allowance
             FROM inv.material_requirements WHERE id = $1`,
          [requirement]
        )
      ).toEqual({
        status: 'approval_required',
        reason: 'missing_unit_conversion',
        allowance: '4.500',
      });
      // A raw status flip past the missing conversion is refused by the guard too.
      await expectRefusal(
        c,
        '23514',
        /cannot become approved/,
        `UPDATE inv.material_requirements SET status = 'approved', approval_required_reason = NULL,
                approved_by = $2, approved_at = now() WHERE id = $1`,
        [requirement, OTHER_ACTOR]
      );

      await c.query(`SELECT inv.set_item_unit_conversion($1,$2,$3,0.946,'Pack label')`, [
        oil,
        pack,
        litre,
      ]);
      expect(await text(c, `SELECT inv.recheck_material_requirement($1) AS v`, [requirement])).toBe(
        'pending_approval'
      );
      await asUser(c, OTHER_ACTOR);
      await c.query(`SELECT inv.approve_material_requirement($1)`, [requirement]);
      await asUser(c, USER_A);

      // Four packs are 3.784 litres; a fifth would be 4.730 > 4.500.
      await c.query(`SELECT inv.create_material_request($1,$2,4)`, [requirement, oil]);
      expect(await usage(c, requirement)).toMatchObject({ committed: '3.784', remaining: '0.716' });
      await expectRefusal(
        c,
        '23514',
        /material_allowance_exceeded/,
        `SELECT inv.create_material_request($1,$2,1)`,
        [requirement, oil]
      );

      // Once the conversion is retired, a further draw is approval-required again.
      await c.query(
        `SELECT inv.retire_item_unit_conversion(id) FROM inv.item_unit_conversions WHERE item_id = $1 AND status = 'active'`,
        [oil]
      );
      await expectRefusal(
        c,
        '23514',
        /material_approval_required: missing_unit_conversion/,
        `SELECT inv.create_material_request($1,$2,0.5)`,
        [requirement, oil]
      );
    });
  });

  it('accepts an entered basis with its source, and refuses duplicate demand on one service line', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const litre = await unit(c, 'mdc_litre5', 'volume');
      const { item: oil, category } = await item(c, 'dup', litre);
      const { line } = await workshop(c, 'dup');

      const fromSpec = (
        await one<{ id: string }>(
          c,
          `SELECT inv.derive_material_requirement($1,$2,NULL,'gearbox_oil_change',NULL) AS id`,
          [line, oil]
        )
      ).id;
      await expectFail(c, '23514', `SELECT inv.supply_material_requirement_basis($1,2.1,$2,'  ')`, [
        fromSpec,
        litre,
      ]);
      expect(
        await text(
          c,
          `SELECT inv.supply_material_requirement_basis($1,2.1,$2,'Gearbox plate reading') AS v`,
          [fromSpec, litre]
        )
      ).toBe('pending_approval');
      expect(
        await one(
          c,
          `SELECT basis, allowance_quantity::text AS allowance FROM inv.material_requirements WHERE id = $1`,
          [fromSpec]
        )
      ).toEqual({ basis: 'entered', allowance: '2.100' });
      // An entered requirement needs a known allowance.
      await expectFail(
        c,
        '23514',
        `SELECT inv.propose_material_requirement($1,NULL,$2,NULL,$3,'Manual')`,
        [line, category, litre]
      );

      // A second active requirement for the same item on the same line, and a family
      // requirement beside an item requirement of that family, are both refused.
      await expectFail(
        c,
        '23505',
        `SELECT inv.propose_material_requirement($1,$2,NULL,1,$3,'Manual')`,
        [line, oil, litre]
      );
      await expectRefusal(
        c,
        '23514',
        /material_duplicate_demand/,
        `SELECT inv.propose_material_requirement($1,NULL,$2,1,$3,'Manual')`,
        [line, category, litre]
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — finite exceptions, separation of duties
// ---------------------------------------------------------------------------
describe('separation of duties — requirements and exceptions', () => {
  it('refuses the requester as approver and records a finite resulting allowance', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const litre = await unit(c, 'mdc_litre6', 'volume');
      const { item: oil } = await item(c, 'sod', litre);
      const { line } = await workshop(c, 'sod');

      const requirement = (
        await one<{ id: string }>(
          c,
          `SELECT inv.propose_material_requirement($1,$2,NULL,4,$3,'Manual') AS id`,
          [line, oil, litre]
        )
      ).id;
      await expectRefusal(
        c,
        '23514',
        /material_separation_of_duties/,
        `SELECT inv.approve_material_requirement($1)`,
        [requirement]
      );
      // The CHECK binds even a raw write that bypasses the function.
      await expectFail(
        c,
        '23514',
        `UPDATE inv.material_requirements SET status = 'approved', approved_by = requested_by, approved_at = now() WHERE id = $1`,
        [requirement]
      );
      await asUser(c, OTHER_ACTOR);
      await c.query(`SELECT inv.approve_material_requirement($1)`, [requirement]);
      await asUser(c, USER_A);
      await c.query(`SELECT inv.create_material_request($1,$2,4)`, [requirement, oil]);
      await expectRefusal(
        c,
        '23514',
        /material_allowance_exceeded/,
        `SELECT inv.create_material_request($1,$2,0.5)`,
        [requirement, oil]
      );

      // An exception needs a reason and a positive finite quantity.
      await expectFail(c, '23514', `SELECT inv.request_material_exception($1,0.5,' ')`, [
        requirement,
      ]);
      await expectFail(c, '23514', `SELECT inv.request_material_exception($1,0,'Leak found')`, [
        requirement,
      ]);
      const exception = (
        await one<{ id: string }>(
          c,
          `SELECT inv.request_material_exception($1,0.5,'Oil cooler line drained as well') AS id`,
          [requirement]
        )
      ).id;
      // Pending adds nothing.
      await expectFail(c, '23514', `SELECT inv.create_material_request($1,$2,0.5)`, [
        requirement,
        oil,
      ]);
      await expectRefusal(
        c,
        '23514',
        /material_separation_of_duties/,
        `SELECT inv.decide_material_exception($1,true,NULL)`,
        [exception]
      );
      await expectFail(
        c,
        '23514',
        `UPDATE inv.material_requirement_exceptions
            SET status = 'approved', decided_by = requested_by, decided_at = now(), resulting_allowance = 4.5
          WHERE id = $1`,
        [exception]
      );
      await asUser(c, OTHER_ACTOR);
      expect(
        await text(
          c,
          `SELECT inv.decide_material_exception($1,true,'Seen on the lift')::text AS v`,
          [exception]
        )
      ).toBe('4.500');
      await asUser(c, USER_A);
      expect(
        await one(
          c,
          `SELECT status, decided_by, resulting_allowance::text AS resulting
             FROM inv.material_requirement_exceptions WHERE id = $1`,
          [exception]
        )
      ).toEqual({ status: 'approved', decided_by: OTHER_ACTOR, resulting: '4.500' });
      await c.query(`SELECT inv.create_material_request($1,$2,0.5)`, [requirement, oil]);
      expect(await usage(c, requirement)).toMatchObject({
        effective: '4.500',
        committed: '4.500',
        remaining: '0.000',
      });
      // Finite: nothing beyond the resulting allowance.
      await expectFail(c, '23514', `SELECT inv.create_material_request($1,$2,0.001)`, [
        requirement,
        oil,
      ]);
    });
  });

  it('refuses an exception on a requirement that is not approved', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const litre = await unit(c, 'mdc_litre7', 'volume');
      const { item: oil } = await item(c, 'sod2', litre);
      const { line } = await workshop(c, 'sod2');
      const requirement = (
        await one<{ id: string }>(
          c,
          `SELECT inv.propose_material_requirement($1,$2,NULL,4,$3,'Manual') AS id`,
          [line, oil, litre]
        )
      ).id;
      await expectRefusal(
        c,
        '23514',
        /material_approval_required/,
        `SELECT inv.request_material_exception($1,1,'More needed')`,
        [requirement]
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — one quantity counted once, request -> reservation -> issue -> return
// ---------------------------------------------------------------------------
describe('inv.material_requirement_usage — no double counting across states', () => {
  it('counts a unit once as it moves, gives back a restockable return, and releases a closed remainder', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const litre = await unit(c, 'mdc_litre8', 'volume');
      const { item: oil } = await item(c, 'flow', litre);
      const { line } = await workshop(c, 'flow');
      const { warehouse, quarantine } = await seedLocations(c, 'mdc_flow');
      await seedStock(c, oil, warehouse, 20, 'mdc_flow');
      const requirement = await approvedRequirement(c, line, { item: oil }, '5', litre);

      const requestA = (
        await one<{ id: string }>(c, `SELECT inv.create_material_request($1,$2,4) AS id`, [
          requirement,
          oil,
        ])
      ).id;
      expect(await usage(c, requirement)).toMatchObject({
        open: '4.000',
        reserved: '0.000',
        issued: '0.000',
        committed: '4.000',
      });

      const reservation = (
        await one<{ id: string }>(c, `SELECT inv.reserve_material_request($1,$2,3) AS id`, [
          requestA,
          warehouse,
        ])
      ).id;
      expect(await usage(c, requirement)).toMatchObject({
        open: '1.000',
        reserved: '3.000',
        issued: '0.000',
        committed: '4.000',
      });

      const issue = (
        await one<{ id: string }>(c, `SELECT inv.issue_material_request($1,$2,3,$3) AS id`, [
          requestA,
          warehouse,
          reservation,
        ])
      ).id;
      expect(await usage(c, requirement)).toMatchObject({
        open: '1.000',
        reserved: '0.000',
        issued: '3.000',
        committed: '4.000',
      });
      expect(await onHand(c, oil, warehouse)).toBe('17.000');

      // The request is its own ceiling: 3 issued + 2 more would pass its 4.
      await expectRefusal(
        c,
        '23514',
        /material_request_exceeded/,
        `SELECT inv.issue_material_request($1,$2,2,NULL)`,
        [requestA, warehouse]
      );
      // The requirement is the ceiling across requests: 4 committed + 2 > 5.
      await expectFail(c, '23514', `SELECT inv.create_material_request($1,$2,2)`, [
        requirement,
        oil,
      ]);
      const requestB = (
        await one<{ id: string }>(c, `SELECT inv.create_material_request($1,$2,1) AS id`, [
          requirement,
          oil,
        ])
      ).id;
      expect((await usage(c, requirement)).committed).toBe('5.000');

      // A restockable return gives the quantity back; a damaged one does not.
      await c.query(`SELECT inv.return_part($1,2,'Wrong grade opened',NULL)`, [issue]);
      expect(await usage(c, requirement)).toMatchObject({ returned: '2.000', committed: '3.000' });
      await c.query(
        `SELECT inv.receive_sales_return('part_issue',$1,1,'damaged',$2,$3,'Spilled',NULL,NULL)`,
        [issue, warehouse, quarantine]
      );
      expect(await usage(c, requirement)).toMatchObject({ returned: '2.000', committed: '3.000' });

      // Closing request A releases its unfulfilled remainder of 1, by an act.
      await c.query(`SELECT inv.finish_material_request($1,'closed',NULL)`, [requestA]);
      expect(await usage(c, requirement)).toMatchObject({
        open: '1.000', // request B
        issued: '3.000',
        returned: '2.000',
        committed: '2.000',
        remaining: '3.000',
      });
      // A closed request takes no further fulfillment, and one that issued stock is
      // closed rather than cancelled.
      await expectFail(c, '23514', `SELECT inv.issue_material_request($1,$2,1,NULL)`, [
        requestA,
        warehouse,
      ]);

      // Cancelling request B (a reservation, no issue) releases the reservation
      // explicitly, and its quantity stops counting.
      const reservationB = (
        await one<{ id: string }>(c, `SELECT inv.reserve_material_request($1,$2,1) AS id`, [
          requestB,
          warehouse,
        ])
      ).id;
      await expectFail(c, '23514', `SELECT inv.finish_material_request($1,'cancelled',' ')`, [
        requestB,
      ]);
      await c.query(`SELECT inv.finish_material_request($1,'cancelled','Job re-scoped')`, [
        requestB,
      ]);
      expect(
        await text(c, `SELECT status AS v FROM inv.stock_reservations WHERE id = $1`, [
          reservationB,
        ])
      ).toBe('released');
      expect((await usage(c, requirement)).committed).toBe('1.000');
      for (const location of [warehouse, quarantine]) {
        expect(await onHand(c, oil, location)).toBe(await ledger(c, oil, location));
      }
    });
  });

  it('refuses a fulfillment link for another item, and a reservation already linked elsewhere', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const litre = await unit(c, 'mdc_litre9', 'volume');
      const { item: oil, category } = await item(c, 'links', litre);
      const { item: otherOil } = await item(c, 'links_b', litre, category);
      const { line, wo } = await workshop(c, 'links');
      const { warehouse } = await seedLocations(c, 'mdc_links');
      await seedStock(c, oil, warehouse, 10, 'mdc_links');
      await seedStock(c, otherOil, warehouse, 10, 'mdc_links_b');
      const requirement = await approvedRequirement(c, line, { category }, '6', litre);
      const request = (
        await one<{ id: string }>(c, `SELECT inv.create_material_request($1,$2,2) AS id`, [
          requirement,
          oil,
        ])
      ).id;
      // An item outside the family is not covered.
      const { item: stranger } = await item(c, 'links_c', litre);
      await expectRefusal(
        c,
        '23514',
        /material_item_not_covered/,
        `SELECT inv.create_material_request($1,$2,1)`,
        [requirement, stranger]
      );
      // A reservation of another item cannot be linked to this request.
      const foreignReservation = (
        await one<{ id: string }>(c, `SELECT inv.reserve_stock($1,$2,1,$3) AS id`, [
          otherOil,
          warehouse,
          wo,
        ])
      ).id;
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.material_request_fulfillments (tenant_id, company_id, branch_id, material_request_id, fulfillment_kind, reservation_id, created_by)
         VALUES ($1,$2,$3,$4,'reservation',$5,$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, request, foreignReservation, USER_A]
      );
      // The link table is append-only for the runtime role.
      await expectFail(c, '42501', `DELETE FROM inv.material_request_fulfillments`);
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — the ceiling under concurrency
// ---------------------------------------------------------------------------

/** Runs `sql` in its own transaction on a fresh connection; returns 'ok' or the SQLSTATE. */
async function race(sql: string, params: unknown[]): Promise<string> {
  const client = runtimeClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctxA);
    await client.query(sql, params);
    await client.query('COMMIT');
    return 'ok';
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is closed below either way */
    }
    return (e as { code?: string }).code ?? 'error';
  } finally {
    await client.end();
  }
}

describe('the material ceiling under concurrency', () => {
  it('lets exactly one of two concurrent requests take the last of the allowance (x3)', async () => {
    for (let rep = 0; rep < 3; rep++) {
      const { requirement, oil } = await withCommittedTx(runtime, ctxA, async (c) => {
        const litre = await unit(c, `mdc_race_l${rep}`, 'volume');
        const created = await item(c, `race${rep}`, litre);
        const { line } = await workshop(c, `race${rep}`);
        const id = await approvedRequirement(c, line, { item: created.item }, '5', litre);
        return { requirement: id, oil: created.item };
      });
      const results = await Promise.all([
        race(`SELECT inv.create_material_request($1,$2,3)`, [requirement, oil]),
        race(`SELECT inv.create_material_request($1,$2,3)`, [requirement, oil]),
      ]);
      expect(results.filter((r) => r === 'ok').length, `rep ${rep}: exactly one winner`).toBe(1);
      expect(results.filter((r) => r === '23514').length, `rep ${rep}: loser is 23514`).toBe(1);
      const committed = await withRolledBackTx(runtime, ctxA, (c) => usage(c, requirement));
      expect(committed.committed, `rep ${rep}: one request counted`).toBe('3.000');
    }
  });
});

// ---------------------------------------------------------------------------
// Receiving correction — a short delivery is recorded as short
// ---------------------------------------------------------------------------
describe('stock transfers — a receipt records what arrived', () => {
  async function dispatched(c: Q, tag: string, qty: number) {
    const litre = await unit(c, `mdc_tr_${tag}`, 'volume');
    const { item: part } = await item(c, `tr_${tag}`, litre);
    const { warehouse } = await seedLocations(c, `mdc_tr_${tag}`);
    const storage = (
      await one<{ id: string }>(
        c,
        `INSERT INTO inv.stock_locations (tenant_id, company_id, branch_id, location_code, name, location_type, parent_location_id, created_by)
         VALUES ($1,$2,$3,$4,$5,'storage',$6,$7) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, `st_mdc_${tag}`, `Storage ${tag}`, warehouse, USER_A]
      )
    ).id;
    await seedStock(c, part, warehouse, 10, `mdc_tr_${tag}`);
    const transfer = (
      await one<{ id: string }>(
        c,
        `SELECT inv.dispatch_transfer($1,$2,$3,$4,NULL,NULL,NULL) AS id`,
        [part, warehouse, storage, qty]
      )
    ).id;
    const transit = (
      await one<{ id: string }>(
        c,
        `SELECT transit_location_id AS id FROM inv.stock_transfers WHERE id = $1`,
        [transfer]
      )
    ).id;
    return { part, warehouse, storage, transfer, transit };
  }

  const state = (c: Q, transfer: string) =>
    one<{ status: string; received: string | null; resolved: string; outstanding: string }>(
      c,
      `SELECT status, received_quantity::text AS received, resolved_quantity::text AS resolved,
              outstanding_quantity::text AS outstanding
         FROM inv.stock_transfers WHERE id = $1`,
      [transfer]
    );

  it('receives three of five, keeps two in transit, and completes on a further receipt', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const t = await dispatched(c, 'short', 5);
      await c.query(`SELECT inv.receive_transfer($1,3,NULL)`, [t.transfer]);
      expect(await state(c, t.transfer)).toEqual({
        status: 'partially_received',
        received: '3.000',
        resolved: '0.000',
        outstanding: '2.000',
      });
      // Only what arrived is on the destination shelf; the rest is still in transit.
      expect(await onHand(c, t.part, t.storage)).toBe('3.000');
      expect(await onHand(c, t.part, t.transit)).toBe('2.000');
      expect(await onHand(c, t.part, t.warehouse)).toBe('5.000');

      // The receipt movements cite the settlement row, not the transfer.
      const settlement = (
        await one<{ id: string }>(
          c,
          `SELECT id FROM inv.stock_transfer_settlements WHERE transfer_id = $1 AND settlement_kind = 'receipt'`,
          [t.transfer]
        )
      ).id;
      expect(
        await text(
          c,
          `SELECT string_agg(direction || '@' || (location_id = $2)::text, ',' ORDER BY seq) AS v
             FROM inv.stock_movements WHERE reference_kind = 'transfer_receipt' AND reference_id = $1`,
          [settlement, t.storage]
        )
      ).toBe('out@false,in@true');

      // No more than is in transit may be received, and a partly settled transfer is
      // no longer cancellable as a whole.
      await expectRefusal(
        c,
        '23514',
        /transfer_quantity_exceeded/,
        `SELECT inv.receive_transfer($1,3,NULL)`,
        [t.transfer]
      );
      await expectFail(c, '23514', `SELECT inv.cancel_transfer($1,'Changed mind',NULL)`, [
        t.transfer,
      ]);
      // A whole-transfer settlement movement citing the transfer is refused once parts exist.
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.stock_movements
           (tenant_id, company_id, branch_id, item_id, location_id, movement_type, direction,
            quantity, reference_kind, reference_id, occurred_at, actor_id, created_by)
         VALUES ($1,$2,$3,$4,$5,'transfer','in',5,'transfer_receipt',$6,now(),$7,$7)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, t.part, t.storage, t.transfer, USER_A]
      );

      await c.query(`SELECT inv.receive_transfer($1,2,NULL)`, [t.transfer]);
      expect(await state(c, t.transfer)).toEqual({
        status: 'received',
        received: '5.000',
        resolved: '0.000',
        outstanding: '0.000',
      });
      for (const location of [t.warehouse, t.transit, t.storage]) {
        expect(await onHand(c, t.part, location)).toBe(await ledger(c, t.part, location));
      }
    });
  });

  it('settles a shortfall by a return to origin and a second-person write-off', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const t = await dispatched(c, 'settle', 5);
      await c.query(`SELECT inv.receive_transfer($1,2,NULL)`, [t.transfer]);

      await expectFail(c, '23514', `SELECT inv.return_transfer_remainder($1,1,' ',NULL,NULL)`, [
        t.transfer,
      ]);
      await c.query(
        `SELECT inv.return_transfer_remainder($1,1,'Carton left at origin dock',NULL,NULL)`,
        [t.transfer]
      );
      expect(await onHand(c, t.part, t.warehouse)).toBe('6.000');
      expect(await state(c, t.transfer)).toMatchObject({
        status: 'partially_received',
        resolved: '1.000',
        outstanding: '2.000',
      });

      const writeOff = (
        await one<{ id: string }>(
          c,
          `SELECT inv.request_transfer_write_off($1,2,'Lost in transit, carrier report 118',NULL,NULL) AS id`,
          [t.transfer]
        )
      ).id;
      // Pending: nothing moved, but the two units are claimed.
      expect(await onHand(c, t.part, t.transit)).toBe('2.000');
      await expectRefusal(
        c,
        '23514',
        /transfer_settlement_exceeded/,
        `SELECT inv.receive_transfer($1,1,NULL)`,
        [t.transfer]
      );
      await expectRefusal(
        c,
        '23514',
        /maker<>checker/,
        `SELECT inv.decide_transfer_write_off($1,true)`,
        [writeOff]
      );
      await expectFail(
        c,
        '23514',
        `UPDATE inv.stock_transfer_settlements SET status = 'posted', approved_by = requested_by, approved_at = now() WHERE id = $1`,
        [writeOff]
      );
      // A write-off leaves transit and lands nowhere, even when forged.
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.stock_movements
           (tenant_id, company_id, branch_id, item_id, location_id, movement_type, direction,
            quantity, reference_kind, reference_id, occurred_at, actor_id, created_by)
         VALUES ($1,$2,$3,$4,$5,'transfer','in',2,'transfer_receipt',$6,now(),$7,$7)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, t.part, t.storage, writeOff, USER_A]
      );

      await asUser(c, OTHER_ACTOR);
      await c.query(`SELECT inv.decide_transfer_write_off($1,true)`, [writeOff]);
      await asUser(c, USER_A);
      expect(await state(c, t.transfer)).toEqual({
        status: 'settled',
        received: '2.000',
        resolved: '3.000',
        outstanding: '0.000',
      });
      expect(await onHand(c, t.part, t.transit)).toBe('0.000');
      expect(await onHand(c, t.part, t.storage)).toBe('2.000');
      await expectFail(c, '23514', `SELECT inv.receive_transfer($1,1,NULL)`, [t.transfer]);
      for (const location of [t.warehouse, t.transit, t.storage]) {
        expect(await onHand(c, t.part, location)).toBe(await ledger(c, t.part, location));
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation — every new table
// ---------------------------------------------------------------------------
describe('tenant isolation of the slice-3a tables', () => {
  const TABLES = [
    'inv.item_unit_conversions',
    'inv.vehicle_fluid_specifications',
    'inv.material_requirements',
    'inv.material_requirement_exceptions',
    'inv.material_requests',
    'inv.material_request_fulfillments',
    'inv.stock_transfer_settlements',
  ];

  it('hides tenant A rows from tenant B and refuses a tenant-B write claiming tenant A', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const pack = await unit(c, 'mdc_iso_p', 'count');
      const litre = await unit(c, 'mdc_iso_l', 'volume');
      const { item: oil } = await item(c, 'iso', pack);
      await c.query(`SELECT inv.set_item_unit_conversion($1,$2,$3,1,'Label')`, [oil, pack, litre]);
      const { make, line } = await workshop(c, 'iso');
      await c.query(
        `SELECT inv.record_vehicle_fluid_specification($1,NULL,NULL,NULL,NULL,'engine_oil_change',NULL,4,$2,'Manual')`,
        [make, litre]
      );
      const { warehouse } = await seedLocations(c, 'mdc_iso');
      await seedStock(c, oil, warehouse, 10, 'mdc_iso');
      const requirement = await approvedRequirement(c, line, { item: oil }, '5', litre);
      await c.query(`SELECT inv.request_material_exception($1,1,'More needed')`, [requirement]);
      const request = (
        await one<{ id: string }>(c, `SELECT inv.create_material_request($1,$2,2) AS id`, [
          requirement,
          oil,
        ])
      ).id;
      await c.query(`SELECT inv.reserve_material_request($1,$2,1)`, [request, warehouse]);
      const storage = (
        await one<{ id: string }>(
          c,
          `INSERT INTO inv.stock_locations (tenant_id, company_id, branch_id, location_code, name, location_type, parent_location_id, created_by)
           VALUES ($1,$2,$3,'st_mdc_iso','Storage iso','storage',$4,$5) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, warehouse, USER_A]
        )
      ).id;
      const transfer = (
        await one<{ id: string }>(
          c,
          `SELECT inv.dispatch_transfer($1,$2,$3,2,NULL,NULL,NULL) AS id`,
          [oil, warehouse, storage]
        )
      ).id;
      await c.query(`SELECT inv.receive_transfer($1,1,NULL)`, [transfer]);

      for (const table of TABLES) {
        expect(
          Number(await text(c, `SELECT count(*)::text AS v FROM ${table}`)),
          `${table} holds a tenant-A row`
        ).toBeGreaterThan(0);
      }

      await setContext(c, ctxB);
      for (const table of TABLES) {
        expect(await text(c, `SELECT count(*)::text AS v FROM ${table}`), `${table} leaked`).toBe(
          '0'
        );
        await expectFail(
          c,
          ['42501', '23502', '23503', '23514'],
          `INSERT INTO ${table} (tenant_id) VALUES ($1)`,
          [TENANT_A]
        );
      }
      // And a well-formed row claiming tenant A — two platform units every tenant can
      // see, so no guard refuses it first — is refused by the policy itself.
      await expectFail(
        c,
        '42501',
        `INSERT INTO inv.item_unit_conversions (tenant_id, from_uom_id, to_uom_id, factor, source_reference, created_by)
         SELECT $1, ml.id, l.id, 0.001, 'Spoof', $2
           FROM inv.units_of_measure ml, inv.units_of_measure l
          WHERE ml.scope = 'platform' AND ml.code = 'millilitre' AND l.scope = 'platform' AND l.code = 'litre'`,
        [TENANT_A, USER_B]
      );
    });
  });
});
