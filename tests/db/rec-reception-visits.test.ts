/**
 * Phase 1-8 Vehicle-Reception visit master + walk-in origin (P1-08-DB-004/005).
 *
 * Proves exactly-one-origin (appointment XOR walk-in), one-visit-per-origin,
 * appointment/Vehicle coherence, odometer same-Vehicle, SOC/fuel validation, the
 * one-open-visit invariant with closed-then-new reuse, the reception state
 * machine, cross-tenant denial, and RLS isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import type { Pool } from 'pg';
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
  TENANT_B,
  USER_A,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';

const V_A = 'a1000000-0000-4000-8000-0000000ae001';
const V_A2 = 'a1000000-0000-4000-8000-0000000ae002';
const V_B = 'b1000000-0000-4000-8000-0000000ae00b';
const P_A = 'a1000000-0000-4000-8000-0000000ae0c1';
const TYPE = 'a1000000-0000-4000-8000-0000000ae0d1';
const CHAN = 'a1000000-0000-4000-8000-0000000ae0d2';
const FUEL = 'a1000000-0000-4000-8000-0000000ae0d4';
const APPT = 'a1000000-0000-4000-8000-0000000ae0e1';
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_A };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

type Q = { query: Client['query'] };

const insWalkIn = async (
  c: Q,
  vehicle: string | null = null,
  tenant = TENANT_A,
  branch = BRANCH_A1
) =>
  (
    await c.query(
      `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, vehicle_id, created_by)
       VALUES ('${tenant}','${COMPANY_A1}','${branch}',${vehicle ? `'${vehicle}'` : 'NULL'},'${USER_A}')
       RETURNING id`
    )
  ).rows[0].id as string;

const insOdo = async (c: Q, vehicle: string) =>
  (
    await c.query(
      `INSERT INTO veh.odometer_readings (tenant_id, vehicle_id, value, unit, capture_method)
       VALUES ('${TENANT_A}','${vehicle}',15000,'km','reception') RETURNING id`
    )
  ).rows[0].id as string;

const insVisit = (o: {
  appointment?: string | null;
  walkIn?: string | null;
  vehicle?: string;
  odo?: string | null;
  fuel?: string | null;
  soc?: number | null;
  status?: string;
  tenant?: string;
  branch?: string;
}) => {
  const appt = o.appointment ? `'${o.appointment}'` : 'NULL';
  const wi = o.walkIn ? `'${o.walkIn}'` : 'NULL';
  const odo = o.odo ? `'${o.odo}'` : 'NULL';
  const fuel = o.fuel === undefined ? 'NULL' : o.fuel ? `'${o.fuel}'` : 'NULL';
  const soc = o.soc === undefined || o.soc === null ? 'NULL' : `${o.soc}`;
  return `INSERT INTO rec.reception_visits
    (tenant_id, company_id, branch_id, appointment_id, walk_in_id, vehicle_id, odometer_reading_id,
     fuel_level_id, ev_soc_percent, receiving_employee_id, reception_status, created_by)
   VALUES ('${o.tenant ?? TENANT_A}','${COMPANY_A1}','${o.branch ?? BRANCH_A1}',${appt},${wi},
     '${o.vehicle ?? V_A}',${odo},${fuel},${soc},'${USER_A}','${o.status ?? 'opened'}','${USER_A}')
   RETURNING id`;
};

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by) VALUES
       ($1,$4,'RECVIN0001','ice','active',$6),($2,$4,'RECVIN0002','ice','active',$6),($3,$5,'RECVINB001','ice','active',$6)`,
    [V_A, V_A2, V_B, TENANT_A, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1,$2,'individual','Rec Requester',$3)`,
    [P_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.appointment_types (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_rec_type','General',$2)`,
    [TYPE, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.source_channels (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_rec_chan','Phone',$2)`,
    [CHAN, USER_A]
  );
  await admin.query(
    `INSERT INTO rec.fuel_levels (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_fuel_half','Half',$2)`,
    [FUEL, USER_A]
  );
  // Appointment origin for V_A in branch A1.
  await admin.query(
    `INSERT INTO apt.appointments
       (id, tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, appointment_type_id,
        source_channel_id, requested_from, requested_to, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'2026-11-01T09:00:00Z','2026-11-01T10:00:00Z',$9)`,
    [APPT, TENANT_A, COMPANY_A1, BRANCH_A1, V_A, P_A, TYPE, CHAN, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('rec.reception_visits — origin', () => {
  it('accepts an appointment-origin check-in', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      expect((await c.query(insVisit({ appointment: APPT, vehicle: V_A }))).rows).toHaveLength(1);
    });
  });

  it('accepts a walk-in-origin check-in', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const wi = await insWalkIn(c, V_A);
      expect((await c.query(insVisit({ walkIn: wi, vehicle: V_A }))).rows).toHaveLength(1);
    });
  });

  it('rejects dual origin and missing origin (XOR)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const wi = await insWalkIn(c, V_A);
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(insVisit({ appointment: APPT, walkIn: wi, vehicle: V_A })),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(insVisit({ vehicle: V_A })), '23514'); // neither origin
    });
  });

  it('rejects a second visit for the same appointment (origin reuse)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insVisit({ appointment: APPT, vehicle: V_A }));
      await expectSqlState(c.query(insVisit({ appointment: APPT, vehicle: V_A })), '23505');
    });
  });

  it('rejects a visit whose Vehicle does not match the appointment Vehicle', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(insVisit({ appointment: APPT, vehicle: V_A2 })), '23514');
    });
  });
});

describe('rec.reception_visits — capture validation', () => {
  it('accepts an odometer reading of the same Vehicle but rejects a mismatched one', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const odoA = await insOdo(c, V_A);
      const wi = await insWalkIn(c, V_A);
      expect((await c.query(insVisit({ walkIn: wi, vehicle: V_A, odo: odoA }))).rows).toHaveLength(
        1
      );
      // the same reading against a DIFFERENT Vehicle violates the composite FK
      const wi2 = await insWalkIn(c, V_A2);
      await expectSqlState(c.query(insVisit({ walkIn: wi2, vehicle: V_A2, odo: odoA })), '23503');
    });
  });

  it('rejects an out-of-range SOC and an invisible fuel code', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const wi = await insWalkIn(c, V_A);
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insVisit({ walkIn: wi, vehicle: V_A, soc: 150 })), '23514');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(
          insVisit({ walkIn: wi, vehicle: V_A, fuel: '99999999-9999-4999-8999-999999999999' })
        ),
        '23503'
      );
    });
  });

  it('accepts a valid fuel level and SOC', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const wi = await insWalkIn(c, V_A);
      expect(
        (await c.query(insVisit({ walkIn: wi, vehicle: V_A, fuel: FUEL, soc: 80 }))).rows
      ).toHaveLength(1);
    });
  });
});

describe('rec.reception_visits — one open visit', () => {
  it('rejects a second OPEN visit for the same Vehicle but allows one after the first closes', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const wi1 = await insWalkIn(c, V_A);
      const v1 = (await c.query(insVisit({ walkIn: wi1, vehicle: V_A }))).rows[0].id;
      const wi2 = await insWalkIn(c, V_A);
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insVisit({ walkIn: wi2, vehicle: V_A })), '23505'); // already open
      await c.query('ROLLBACK TO SAVEPOINT s1');
      // close the first, then a new open visit is allowed
      await c.query(
        `UPDATE rec.reception_visits SET reception_status='closed_without_work' WHERE id='${v1}'`
      );
      expect((await c.query(insVisit({ walkIn: wi2, vehicle: V_A }))).rows).toHaveLength(1);
    });
  });
});

describe('rec.reception_visits — state machine', () => {
  it('allows opened -> inspecting -> closed_without_work and freezes terminals', async () => {
    // The authorized/converted path needs the activation contract (service
    // requester + approved authorization) and is covered in the custody suite;
    // here we exercise a terminal path that needs no authorization.
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const wi = await insWalkIn(c, V_A);
      const id = (await c.query(insVisit({ walkIn: wi, vehicle: V_A }))).rows[0].id;
      for (const s of ['inspecting', 'closed_without_work']) {
        expect(
          (
            await c.query(
              `UPDATE rec.reception_visits SET reception_status='${s}' WHERE id='${id}'`
            )
          ).rowCount
        ).toBe(1);
      }
      await expectSqlState(
        c.query(`UPDATE rec.reception_visits SET reception_status='inspecting' WHERE id='${id}'`),
        '23514'
      ); // closed_without_work is terminal
    });
  });

  it('rejects an illegal skip (opened -> authorized)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const wi = await insWalkIn(c, V_A);
      const id = (await c.query(insVisit({ walkIn: wi, vehicle: V_A }))).rows[0].id;
      await expectSqlState(
        c.query(`UPDATE rec.reception_visits SET reception_status='authorized' WHERE id='${id}'`),
        '23514'
      );
    });
  });
});

describe('rec.reception_visits — isolation', () => {
  it('rejects a cross-tenant Vehicle and isolates tenants; denies app_readonly writes', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const wi = await insWalkIn(c, null);
      await expectSqlState(c.query(insVisit({ walkIn: wi, vehicle: V_B })), '23503'); // V_B is tenant B
    });
    await withRolledBackTx(runtime, ctxB, async (c) => {
      const n = await c.query(`SELECT count(*)::int n FROM rec.reception_visits`);
      expect(n.rows[0].n).toBe(0);
    });
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, created_by)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${USER_A}')`
        ),
        '42501'
      );
    });
  });
});
