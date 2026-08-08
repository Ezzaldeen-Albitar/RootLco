/**
 * Phase 1-18 — custody release frees the one-visit-per-Vehicle index
 * (DBCR-P1-18-001, migration 20260731090000, finding P1-27-INT-013).
 *
 * The defect: `uq_reception_visits_open_vehicle` tested `reception_status` alone,
 * and `converted` — the state the SUCCESSFUL path ends in, and a terminal state
 * with no outgoing edge — was inside its predicate. So the normal completion of a
 * reception permanently forbade that Vehicle from ever being received again.
 * Every returning customer was a permanent 23505, with no operational escape.
 *
 * The first test below is the regression: it fails on the old predicate and is
 * the whole reason this migration exists. Everything after it exists because the
 * dangerous half of a fix like this is what it might quietly permit — a Vehicle
 * physically in the workshop must STILL be refused, and the marker that releases
 * the index must be evidence of a real handover rather than something request
 * code can assert.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  USER_A,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';

const SR = 'a1000000-0000-4000-8000-0000000b4001'; // service requester
// Every test needs its own Vehicle: the index under test is (tenant, vehicle),
// so two tests sharing one would interfere through the very thing being measured.
const VEHICLE_NUMBERS = [1, 2, 3, 4, 5, 6, 7];
const vehicle = (n: number): string =>
  `a1000000-0000-4000-8000-0000000b41${String(n).padStart(2, '0')}`;
const ctxA = { tenantId: TENANT_A, userId: USER_A };

let admin: Pool;
let runtime: Pool;
type Q = { query: Client['query'] };

/** Creates a walk-in then calls the atomic primitive the reception route uses. */
const checkIn = async (c: Q, vehicleId: string): Promise<string> => {
  const wi = (
    await c.query(
      `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, created_by)
       VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${USER_A}') RETURNING id`
    )
  ).rows[0].id;
  const r = await c.query(`SELECT rec.accept_check_in($1,$2,$3,NULL,$4,$5,$6) AS id`, [
    COMPANY_A1,
    BRANCH_A1,
    vehicleId,
    wi,
    USER_A,
    SR,
  ]);
  return r.rows[0].id;
};

const setStatus = (c: Q, visit: string, status: string) =>
  c.query(`UPDATE rec.reception_visits SET reception_status=$2 WHERE id=$1`, [visit, status]);

/** Walks a visit down the successful path to `converted`, as the product does. */
const convert = async (c: Q, visit: string): Promise<void> => {
  await setStatus(c, visit, 'inspecting');
  await c.query(
    `INSERT INTO rec.authorizations
       (tenant_id, company_id, branch_id, reception_visit_id, authorizing_role, partner_id, decision, created_by)
     VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','service_requester','${SR}','approved','${USER_A}')`
  );
  await setStatus(c, visit, 'authorized');
  await setStatus(c, visit, 'converted');
};

/** What sal.complete_delivery writes when the Vehicle is handed back. */
const releaseCustody = (c: Q, visit: string) =>
  c.query(
    `INSERT INTO rec.custody_history
       (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state, actor_id)
     VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','accepted','released','${USER_A}')`
  );

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1,$2,'individual','Service Requester',$3)`,
    [SR, TENANT_A, USER_A]
  );
  for (const n of VEHICLE_NUMBERS) {
    await admin.query(
      `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$2,$3,'ice','active',$4)`,
      [vehicle(n), TENANT_A, `RECREL0VIN0${n}`, USER_A]
    );
  }
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('P1-27-INT-013 — a returning customer', () => {
  it('receives the same Vehicle again once custody has been released', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const first = await checkIn(c, vehicle(1));
      await convert(c, first); // the normal, successful path: it becomes a work order
      await releaseCustody(c, first); // the Vehicle is handed back to the customer

      // On the old predicate this line raised 23505 on uq_reception_visits_open_vehicle,
      // for the rest of the tenant's life.
      const second = await checkIn(c, vehicle(1));
      expect(second).toEqual(expect.any(String));
      expect(second).not.toEqual(first);
    });
  });

  it('stamps custody_released_at on the visit from the ledger row', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c, vehicle(2));
      const before = await c.query(
        `SELECT custody_released_at FROM rec.reception_visits WHERE id='${visit}'`
      );
      expect(before.rows[0].custody_released_at).toBeNull();

      await releaseCustody(c, visit);
      const after = await c.query(
        `SELECT v.custody_released_at, h.occurred_at
           FROM rec.reception_visits v
           JOIN rec.custody_history h
             ON h.reception_visit_id = v.id AND h.to_state = 'released'
          WHERE v.id='${visit}'`
      );
      expect(after.rows[0].custody_released_at).not.toBeNull();
      expect(after.rows[0].custody_released_at).toEqual(after.rows[0].occurred_at);
    });
  });
});

describe('the invariant the index actually exists for', () => {
  it('still refuses a second check-in while a visit is open', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await checkIn(c, vehicle(3));
      await expectSqlState(checkIn(c, vehicle(3)), '23505');
    });
  });

  it('still refuses a second check-in while the Vehicle is under an open work order', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c, vehicle(4));
      await convert(c, visit); // converted, but custody NOT released — it is in the workshop
      await expectSqlState(checkIn(c, vehicle(4)), '23505');
    });
  });

  it('still allows a later visit after closed_without_work, as it always did', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c, vehicle(5));
      await setStatus(c, visit, 'closed_without_work');
      await expect(checkIn(c, vehicle(5))).resolves.toEqual(expect.any(String));
    });
  });

  it('still allows a later visit after refused, as it always did', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c, vehicle(6));
      await setStatus(c, visit, 'refused');
      await expect(checkIn(c, vehicle(6))).resolves.toEqual(expect.any(String));
    });
  });
});

describe('the marker is evidence, not an assertion', () => {
  it('refuses to release a visit that has no custody release recorded', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c, vehicle(7));
      await expectSqlState(
        c.query(`UPDATE rec.reception_visits SET custody_released_at=now() WHERE id='${visit}'`),
        '23514'
      );
    });
  });

  it('refuses to clear a recorded custody release', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c, vehicle(1));
      await releaseCustody(c, visit);
      await expectSqlState(
        c.query(`UPDATE rec.reception_visits SET custody_released_at=NULL WHERE id='${visit}'`),
        '23514'
      );
    });
  });

  it('refuses to move a recorded custody release to a different time', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c, vehicle(2));
      await releaseCustody(c, visit);
      await expectSqlState(
        c.query(
          `UPDATE rec.reception_visits SET custody_released_at=now() + interval '1 day' WHERE id='${visit}'`
        ),
        '23514'
      );
    });
  });

  it('refuses to create a visit that is already released', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const wi = (
        await c.query(
          `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, created_by)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${USER_A}') RETURNING id`
        )
      ).rows[0].id;
      await expectSqlState(
        c.query(
          `INSERT INTO rec.reception_visits
             (tenant_id, company_id, branch_id, vehicle_id, walk_in_id, receiving_employee_id,
              reception_status, custody_released_at, created_by)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${vehicle(3)}','${wi}','${USER_A}',
                   'opened', now(), '${USER_A}')`
        ),
        '23514'
      );
    });
  });
});

describe('the index itself', () => {
  it('tests custody rather than reception status alone', async () => {
    const { rows } = await admin.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='rec' AND indexname='uq_reception_visits_open_vehicle'`
    );
    expect(rows).toHaveLength(1);
    const def: string = rows[0].indexdef;
    // The status list is unchanged — `converted` still blocks while the Vehicle
    // is held — and the custody term is what makes it releasable.
    expect(def).toContain('custody_released_at IS NULL');
    expect(def).toContain("'converted'");
    expect(def).toContain('deleted_at IS NULL');
  });
});
