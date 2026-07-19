/**
 * Phase 1-8 reception complaints + vehicle contents (P1-08-DB-009/016).
 *
 * Proves the restricted-payload split: SAFE metadata is readable in-scope, while
 * the narrative (complaint_text) and item detail (item_description/declared_value)
 * require iam.sensitive.view on read AND write, are hidden from users without it,
 * corrections are linked, and RLS/readonly hold.
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
  withCommittedTx,
  expectSqlState,
  TENANT_A,
  USER_A,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';

const V_A = 'a1000000-0000-4000-8000-0000000b2001';
const V_S = 'a1000000-0000-4000-8000-0000000b2002'; // for the committed-visibility test
const P_A = 'a1000000-0000-4000-8000-0000000b20c1';
const ROLE_ID = 'a1000000-0000-4000-8000-0000000b20a1';
const GRANT_ID = 'a1000000-0000-4000-8000-0000000b20a2';
const SENSITIVE_USER = 'a1000000-0000-4000-8000-0000000b20a3';
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxS = { tenantId: TENANT_A, userId: SENSITIVE_USER };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;
type Q = { query: Client['query'] };

async function seedSensitiveViewer(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.permissions (id, permission_code, domain, description, risk_level, created_by)
     VALUES (gen_random_uuid(), 'iam.sensitive.view', 'iam', 'View sensitive data', 'high', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'rec_sensitive_viewer', 'Rec sensitive viewer', $3) ON CONFLICT (id) DO NOTHING`,
    [ROLE_ID, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'supabase','rec-sensitive','rec-sensitive@example.test','Rec sensitive user','active',$3)
     ON CONFLICT (id) DO NOTHING`,
    [SENSITIVE_USER, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1,$2,id,'allow',$3 FROM iam.permissions WHERE permission_code='iam.sensitive.view'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_ID, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, granted_by, created_by)
     VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (id) DO NOTHING`,
    [GRANT_ID, TENANT_A, SENSITIVE_USER, ROLE_ID, USER_A]
  );
}

const newVisit = async (c: Q, vehicle = V_A): Promise<string> => {
  const wi = (
    await c.query(
      `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, vehicle_id, created_by)
       VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${vehicle}','${USER_A}') RETURNING id`
    )
  ).rows[0].id;
  return (
    await c.query(
      `INSERT INTO rec.reception_visits
         (tenant_id, company_id, branch_id, walk_in_id, vehicle_id, receiving_employee_id, created_by)
       VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${wi}','${vehicle}','${USER_A}','${USER_A}') RETURNING id`
    )
  ).rows[0].id;
};

const insComplaint = async (
  c: Q,
  visit: string,
  correctionOf: string | null = null
): Promise<string> =>
  (
    await c.query(
      `INSERT INTO rec.complaints
         (tenant_id, company_id, branch_id, reception_visit_id, reported_by_partner_id, category, severity, correction_of, created_by)
       VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${P_A}','mechanical','high',
         ${correctionOf ? `'${correctionOf}'` : 'NULL'},'${USER_A}') RETURNING id`
    )
  ).rows[0].id;

const insDetail = (complaint: string) =>
  `INSERT INTO rec.complaint_details
     (tenant_id, company_id, branch_id, complaint_id, complaint_text, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${complaint}','Grinding noise on left turns','${USER_A}')`;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedSensitiveViewer();
  runtime = runtimePool();
  readonly = readonlyPool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by) VALUES
       ($1,$3,'RECCMPVIN1','ice','active',$4),($2,$3,'RECCMPVIN2','ice','active',$4)`,
    [V_A, V_S, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1,$2,'individual','Complainant',$3)`,
    [P_A, TENANT_A, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('rec.complaints + rec.complaint_details — restricted payload', () => {
  it('records metadata freely but gates the narrative on iam.sensitive.view', async () => {
    // No sensitive.view: metadata OK, detail INSERT denied.
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      const complaint = await insComplaint(c, visit);
      await expectSqlState(c.query(insDetail(complaint)), '42501');
    });
    // With sensitive.view: detail INSERT + read succeed.
    await withRolledBackTx(runtime, ctxS, async (c) => {
      const visit = await newVisit(c);
      const complaint = await insComplaint(c, visit);
      await c.query(insDetail(complaint));
      const n = await c.query(
        `SELECT count(*)::int n FROM rec.complaint_details WHERE complaint_id='${complaint}'`
      );
      expect(n.rows[0].n).toBe(1);
    });
  });

  it('hides a committed narrative from a user without the permission', async () => {
    let complaint = '';
    try {
      await withCommittedTx(runtime, ctxS, async (c) => {
        const visit = await newVisit(c, V_S);
        complaint = await insComplaint(c, visit);
        await c.query(insDetail(complaint));
      });
      await withRolledBackTx(runtime, ctxA, async (c) => {
        const n = await c.query(
          `SELECT count(*)::int n FROM rec.complaint_details WHERE complaint_id='${complaint}'`
        );
        expect(n.rows[0].n).toBe(0); // hidden without sensitive.view
      });
      await withRolledBackTx(runtime, ctxS, async (c) => {
        const n = await c.query(
          `SELECT count(*)::int n FROM rec.complaint_details WHERE complaint_id='${complaint}'`
        );
        expect(n.rows[0].n).toBe(1); // visible with sensitive.view
      });
    } finally {
      await admin.query(`DELETE FROM rec.complaint_details WHERE complaint_id = $1`, [complaint]);
      await admin.query(`DELETE FROM rec.complaints WHERE id = $1`, [complaint]);
      await admin.query(`DELETE FROM rec.reception_visits WHERE tenant_id=$1 AND vehicle_id=$2`, [
        TENANT_A,
        V_S,
      ]);
      await admin.query(`DELETE FROM rec.walk_in_references WHERE tenant_id=$1 AND vehicle_id=$2`, [
        TENANT_A,
        V_S,
      ]);
    }
  });

  it('links a correction and rejects self-correction', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      const original = await insComplaint(c, visit);
      const correction = await insComplaint(c, visit, original);
      expect(correction).toBeTruthy();
      await expectSqlState(
        c.query(`UPDATE rec.complaints SET correction_of=id WHERE id='${original}'`),
        '23514'
      );
    });
  });
});

describe('rec.vehicle_contents + rec.vehicle_content_details — restricted payload', () => {
  const insContent = async (c: Q, visit: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO rec.vehicle_contents
           (tenant_id, company_id, branch_id, reception_visit_id, quantity, location, created_by)
         VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}',1,'glovebox','${USER_A}') RETURNING id`
      )
    ).rows[0].id;
  const insContentDetail = (content: string, value: string | null) =>
    `INSERT INTO rec.vehicle_content_details
       (tenant_id, company_id, branch_id, content_id, item_description, declared_value, declared_currency, created_by)
     VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${content}','Gold watch',${value ?? 'NULL'},
       ${value ? "'USD'" : 'NULL'},'${USER_A}')`;

  it('gates the item detail and declared value on iam.sensitive.view', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      const content = await insContent(c, visit);
      await expectSqlState(c.query(insContentDetail(content, '500.00')), '42501');
    });
    await withRolledBackTx(runtime, ctxS, async (c) => {
      const visit = await newVisit(c);
      const content = await insContent(c, visit);
      // declared_value is optional (P1-OD-018): NULL is accepted...
      expect((await c.query(insContentDetail(content, null) + ' RETURNING id')).rows).toHaveLength(
        1
      );
    });
  });

  it('denies app_readonly writes to the restricted detail', async () => {
    await withRolledBackTx(readonly, ctxS, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO rec.vehicle_content_details
             (tenant_id, company_id, branch_id, content_id, item_description, created_by)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','a1000000-0000-4000-8000-0000000b20ee','x','${USER_A}')`
        ),
        '42501'
      );
    });
  });
});
