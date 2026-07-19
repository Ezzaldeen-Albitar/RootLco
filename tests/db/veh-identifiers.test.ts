/**
 * Phase 1-7 Vehicle identifiers + missing-VIN activation contract (P1-07-DB-003).
 *
 * Proves the type<->classification coupling, restricted-row sensitive gate (write
 * denied without iam.sensitive.view), classification immutability, active-value
 * and single-primary uniqueness, and the missing-VIN activation contract: a draft
 * with neither VIN nor identifier cannot become active, an alternate identifier
 * enables activation, and retiring the last identity from an active VIN-less
 * vehicle is rejected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  readonlyPool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  USER_A,
} from './helpers';

const V_BASE = 'f0000000-0000-4000-8000-0000000c2a01';

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();

  // A committed active vehicle (has a VIN, so it satisfies activation).
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, lifecycle_status, created_by)
     VALUES ($1, $2, 'BASEVIN001', 'active', $3)`,
    [V_BASE, TENANT_A, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

const insId = (vehicle: string, type: string, value: string, cls: string, primary = false) =>
  `INSERT INTO veh.vehicle_identifiers
     (tenant_id, vehicle_id, identifier_type, raw_value, normalized_value, classification, is_primary, created_by)
   VALUES ('${TENANT_A}', '${vehicle}', '${type}', '${value}', '${value}', '${cls}', ${primary}, '${USER_A}')`;

describe('veh.vehicle_identifiers — classification coupling and gate', () => {
  it('rejects an engine_no classified as internal', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(c.query(insId(V_BASE, 'engine_no', 'ENG1', 'internal')), '23514');
    });
  });

  it('rejects a chassis classified as internal', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(c.query(insId(V_BASE, 'chassis', 'CH1', 'internal')), '23514');
    });
  });

  it('denies inserting a restricted identifier without iam.sensitive.view', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(c.query(insId(V_BASE, 'engine_no', 'ENG2', 'restricted')), '42501');
    });
  });

  it('allows an internal alternate identifier (fleet_no)', async () => {
    const res = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(insId(V_BASE, 'fleet_no', 'FL2', 'internal') + ' RETURNING id')
    );
    expect(res.rows).toHaveLength(1);
  });
});

describe('veh.vehicle_identifiers — uniqueness and immutability', () => {
  it('rejects a duplicate active value of the same type in a tenant', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(insId(V_BASE, 'fleet_no', 'DUPVAL', 'internal'));
      await expectSqlState(c.query(insId(V_BASE, 'fleet_no', 'DUPVAL', 'internal')), '23505');
    });
  });

  it('rejects two primary identifiers of the same type on one vehicle', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(insId(V_BASE, 'fleet_no', 'PRIM1', 'internal', true));
      await expectSqlState(c.query(insId(V_BASE, 'fleet_no', 'PRIM2', 'internal', true)), '23505');
    });
  });

  it('classification/type are immutable', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const id = (await c.query(insId(V_BASE, 'fleet_no', 'IMM1', 'internal') + ' RETURNING id'))
        .rows[0].id;
      await expectSqlState(
        c.query(`UPDATE veh.vehicle_identifiers SET identifier_type='other' WHERE id=$1`, [id]),
        '23514'
      );
    });
  });

  it('a read-only session cannot INSERT', async () => {
    await withRolledBackTx(readonly, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(c.query(insId(V_BASE, 'fleet_no', 'RO1', 'internal')), '42501');
    });
  });
});

describe('veh.vehicle_identifiers — missing-VIN activation contract', () => {
  const newDraft = async (c: { query: Client['query'] }): Promise<string> =>
    (
      await c.query(
        `INSERT INTO veh.vehicles (tenant_id, created_by) VALUES ($1,$2) RETURNING id`,
        [TENANT_A, USER_A]
      )
    ).rows[0].id;

  it('cannot activate a draft with neither VIN nor identifier', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const v = await newDraft(c);
      await expectSqlState(
        c.query(`UPDATE veh.vehicles SET lifecycle_status='active' WHERE id=$1`, [v]),
        '23514'
      );
    });
  });

  it('cannot INSERT an active VIN-less vehicle directly', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.vehicles (tenant_id, lifecycle_status, created_by) VALUES ($1,'active',$2)`,
          [TENANT_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('can activate a draft once an alternate identifier is present', async () => {
    const res = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_A },
      async (c) => {
        const v = await newDraft(c);
        await c.query(insId(v, 'fleet_no', 'ACTFL', 'internal'));
        return c.query(
          `UPDATE veh.vehicles SET lifecycle_status='active' WHERE id=$1 RETURNING lifecycle_status`,
          [v]
        );
      }
    );
    expect(res.rows[0].lifecycle_status).toBe('active');
  });

  it('cannot retire the last identity from an active VIN-less vehicle', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const v = await newDraft(c);
      const idRow = await c.query(insId(v, 'fleet_no', 'LASTID', 'internal') + ' RETURNING id');
      const idId = idRow.rows[0].id;
      await c.query(`UPDATE veh.vehicles SET lifecycle_status='active' WHERE id=$1`, [v]);
      await expectSqlState(
        c.query(`UPDATE veh.vehicle_identifiers SET deleted_at=now() WHERE id=$1`, [idId]),
        '23514'
      );
    });
  });
});
