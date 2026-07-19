/**
 * Phase 1-8 reception party roles + visit-reason links (P1-08-DB-007/008).
 *
 * Proves the typed role taxonomy, one-active-role-per-partner uniqueness with
 * dated history, cross-tenant partner denial, governed visit-reason linkage with
 * archived-reason rejection, duplicate-link rejection, orphan denial, and RLS.
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
  TENANT_B,
  USER_A,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';

const V_A = 'a1000000-0000-4000-8000-0000000af001';
const P_A = 'a1000000-0000-4000-8000-0000000af0c1';
const P_A2 = 'a1000000-0000-4000-8000-0000000af0c2';
const P_B = 'b1000000-0000-4000-8000-0000000af0cb';
const VR = 'a1000000-0000-4000-8000-0000000af0d1'; // active platform visit reason
const VR_ARCH = 'a1000000-0000-4000-8000-0000000af0d2'; // archived (inactive) reason
const ctxA = { tenantId: TENANT_A, userId: USER_A };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

type Q = { query: Client['query'] };

const newVisit = async (c: Q): Promise<string> => {
  const wi = (
    await c.query(
      `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, vehicle_id, created_by)
       VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${V_A}','${USER_A}') RETURNING id`
    )
  ).rows[0].id;
  return (
    await c.query(
      `INSERT INTO rec.reception_visits
         (tenant_id, company_id, branch_id, walk_in_id, vehicle_id, receiving_employee_id, created_by)
       VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${wi}','${V_A}','${USER_A}','${USER_A}')
       RETURNING id`
    )
  ).rows[0].id;
};

const insRole = (visit: string, partner: string, role: string) =>
  `INSERT INTO rec.reception_party_roles
     (tenant_id, company_id, branch_id, reception_visit_id, partner_id, relationship_role, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${partner}','${role}','${USER_A}')
   RETURNING id`;

const insLink = (visit: string, reason: string) =>
  `INSERT INTO rec.visit_reason_links
     (tenant_id, company_id, branch_id, reception_visit_id, visit_reason_id, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${reason}','${USER_A}')
   RETURNING id`;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
     VALUES ($1,$2,'RECPRVIN01','ice','active',$3)`,
    [V_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by) VALUES
       ($1,$4,'individual','Requester A',$5),($2,$4,'individual','Owner A',$5),($3,$6,'individual','B party',$5)`,
    [P_A, P_A2, P_B, TENANT_A, USER_A, TENANT_B]
  );
  await admin.query(
    `INSERT INTO rec.visit_reasons (id, scope, tenant_id, code, name, created_by) VALUES
       ($1,'platform',NULL,'fx_vr_service','Service',$3),($2,'platform',NULL,'fx_vr_arch','Archived',$3)`,
    [VR, VR_ARCH, USER_A]
  );
  await admin.query(`UPDATE rec.visit_reasons SET status='inactive' WHERE id=$1`, [VR_ARCH]);
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('rec.reception_party_roles', () => {
  it('accepts distinct roles, rejects a duplicate active role, and allows re-add after dating out', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const v = await newVisit(c);
      expect((await c.query(insRole(v, P_A, 'service_requester'))).rows).toHaveLength(1);
      // same partner, a different role is fine
      expect((await c.query(insRole(v, P_A, 'vehicle_owner'))).rows).toHaveLength(1);
      // duplicate active identical role collides
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insRole(v, P_A, 'service_requester')), '23505');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      // date out the active service_requester, then re-adding is allowed
      // (now() is constant within a tx, so use a strictly-later bound)
      await c.query(
        `UPDATE rec.reception_party_roles SET valid_to = valid_from + interval '1 minute'
         WHERE reception_visit_id='${v}' AND partner_id='${P_A}' AND relationship_role='service_requester'`
      );
      expect((await c.query(insRole(v, P_A, 'service_requester'))).rows).toHaveLength(1);
    });
  });

  it('rejects an unknown role value and a cross-tenant partner', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const v = await newVisit(c);
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insRole(v, P_A, 'not_a_role')), '23514');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(insRole(v, P_B, 'payer')), '23503'); // P_B is tenant B
    });
  });
});

describe('rec.visit_reason_links', () => {
  it('links an active reason, rejects an archived one, and rejects a duplicate active link', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const v = await newVisit(c);
      expect((await c.query(insLink(v, VR))).rows).toHaveLength(1);
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insLink(v, VR_ARCH)), '23514'); // archived reason
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(insLink(v, VR)), '23505'); // duplicate active link
    });
  });

  it('rejects a link to an orphan visit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(insLink('a1000000-0000-4000-8000-0000000af0ee', VR)), '23503');
    });
  });
});

describe('rec — party roles / reason links isolation', () => {
  it('denies app_readonly writes', async () => {
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(
        c.query(insRole('a1000000-0000-4000-8000-0000000af0ee', P_A, 'payer')),
        '42501'
      );
    });
  });
});
