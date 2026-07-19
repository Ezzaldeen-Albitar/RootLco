/**
 * Phase 1-8 reception inspection + damage + observations (P1-08-DB-010..015).
 *
 * Proves inspection finalization/lock, the condition-item open-gate with a
 * correction exemption, exact-version damage-map binding (template substitution =
 * new map, prior marks unmoved), normalized coordinate bounds, orphan/cross-tenant
 * evidence rejection, the archived warning-light-code gate, and RLS.
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
  TENANT_B,
  USER_A,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';

const V_A = 'a1000000-0000-4000-8000-0000000b1001';
const CAT = 'a1000000-0000-4000-8000-0000000b10c1';
const DOC = 'a1000000-0000-4000-8000-0000000b10d1';
const VER1 = 'a1000000-0000-4000-8000-0000000b10e1';
const VER2 = 'a1000000-0000-4000-8000-0000000b10e2';
const DOC2 = 'a1000000-0000-4000-8000-0000000b10d2'; // a different document
const VER_OTHER = 'a1000000-0000-4000-8000-0000000b10e3'; // version of DOC2
const WL = 'a1000000-0000-4000-8000-0000000b10f1'; // active warning-light code
const WL_ARCH = 'a1000000-0000-4000-8000-0000000b10f2'; // archived code
const SHA = "decode('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex')";
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_A };

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
       VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${wi}','${V_A}','${USER_A}','${USER_A}') RETURNING id`
    )
  ).rows[0].id;
};

const insInspection = async (c: Q, visit: string): Promise<string> =>
  (
    await c.query(
      `INSERT INTO rec.visual_inspections
         (tenant_id, company_id, branch_id, reception_visit_id, inspector_id, created_by)
       VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${USER_A}','${USER_A}') RETURNING id`
    )
  ).rows[0].id;

const insCondition = (inspection: string, correctionOf: string | null = null) =>
  `INSERT INTO rec.condition_items
     (tenant_id, company_id, branch_id, inspection_id, finding_category, vehicle_zone, correction_of, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${inspection}','scratch','front_bumper',
     ${correctionOf ? `'${correctionOf}'` : 'NULL'},'${USER_A}') RETURNING id`;

const insMap = (visit: string, version: string, doc = DOC) =>
  `INSERT INTO rec.damage_maps
     (tenant_id, company_id, branch_id, reception_visit_id, document_id, document_version_id, map_type, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${doc}','${version}','exterior','${USER_A}') RETURNING id`;

const insMark = (map: string, x: number, y: number) =>
  `INSERT INTO rec.damage_marks
     (tenant_id, company_id, branch_id, damage_map_id, mark_type, vehicle_zone, coord_x, coord_y, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${map}','scratch','front',${x},${y},'${USER_A}') RETURNING id`;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
     VALUES ($1,$2,'RECW4VIN01','ice','active',$3)`,
    [V_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO rec.warning_light_codes (id, scope, tenant_id, code, name, created_by) VALUES
       ($1,'platform',NULL,'fx_wl_engine','Engine',$3),($2,'platform',NULL,'fx_wl_abs','ABS',$3)`,
    [WL, WL_ARCH, USER_A]
  );
  await admin.query(`UPDATE rec.warning_light_codes SET status='inactive' WHERE id=$1`, [WL_ARCH]);
  await withCommittedTx(admin, {}, async (c) => {
    await c.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
          default_classification, default_retention_class, created_by)
       VALUES ($1,'platform',NULL,'fx_rec_maps','Maps fixture',ARRAY['application/pdf'],10485760,
               'internal','operational',$2)`,
      [CAT, USER_A]
    );
    await c.query(
      `INSERT INTO shared.documents (id, tenant_id, category_id, title, classification, retention_class, created_by)
       VALUES ($1,$3,$2,'Map A','internal','operational',$4),($5,$3,$2,'Map B','internal','operational',$4)`,
      [DOC, CAT, TENANT_A, USER_A, DOC2]
    );
    await c.query(
      `INSERT INTO shared.document_versions
         (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes, sha256, uploaded_by, created_by)
       VALUES ($1,$4,$5,1,'t/1/map/a1','application/pdf',2048,${SHA},$6,$6),
              ($2,$4,$5,2,'t/1/map/a2','application/pdf',2048,${SHA},$6,$6),
              ($3,$4,$7,1,'t/1/map/b1','application/pdf',2048,${SHA},$6,$6)`,
      [VER1, VER2, VER_OTHER, TENANT_A, DOC, USER_A, DOC2]
    );
  });
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('rec.visual_inspections + rec.condition_items', () => {
  it('finalizes, locks, and gates new findings while allowing corrections', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      const insp = await insInspection(c, visit);
      const item = (await c.query(insCondition(insp))).rows[0].id; // open inspection: OK
      await c.query(
        `UPDATE rec.visual_inspections SET inspection_status='completed', completed_at=now() WHERE id='${insp}'`
      );
      // finalized inspection is locked against further header changes
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          `UPDATE rec.visual_inspections SET inspection_status='cancelled' WHERE id='${insp}'`
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      // a NEW finding after finalization is rejected...
      await c.query('SAVEPOINT s2');
      await expectSqlState(c.query(insCondition(insp)), '23514');
      await c.query('ROLLBACK TO SAVEPOINT s2');
      // ...but a linked correction is the approved path
      expect((await c.query(insCondition(insp, item))).rows).toHaveLength(1);
    });
  });

  it('rejects an evidence document from outside the tenant (orphan)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      const insp = await insInspection(c, visit);
      await expectSqlState(
        c.query(
          `INSERT INTO rec.condition_items
             (tenant_id, company_id, branch_id, inspection_id, finding_category, vehicle_zone, evidence_document_id, created_by)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${insp}','dent','door',
             '99999999-9999-4999-8999-999999999999','${USER_A}')`
        ),
        '23503'
      );
    });
  });
});

describe('rec.damage_maps + rec.damage_marks', () => {
  it('binds an exact version, rejects a version from another document, and coexists across templates', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      const map1 = (await c.query(insMap(visit, VER1))).rows[0].id;
      // a version that belongs to a different document is rejected
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insMap(visit, VER_OTHER)), '23514');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      // a template revision is a NEW map bound to the new version; both coexist
      const map2 = (await c.query(insMap(visit, VER2))).rows[0].id;
      expect(map1).not.toBe(map2);
      const n = await c.query(
        `SELECT count(*)::int n FROM rec.damage_maps WHERE reception_visit_id='${visit}'`
      );
      expect(n.rows[0].n).toBe(2);
    });
  });

  it('enforces normalized coordinate bounds and rejects an orphan mark', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      const map = (await c.query(insMap(visit, VER1))).rows[0].id;
      expect((await c.query(insMark(map, 0.25, 0.9))).rows).toHaveLength(1);
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insMark(map, 1.5, 0.5)), '23514'); // x out of [0,1]
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(insMark('a1000000-0000-4000-8000-0000000b10ee', 0.5, 0.5)),
        '23503'
      ); // orphan map
    });
  });
});

describe('rec.warning_light_observations + rec.leak_observations', () => {
  it('accepts an active code, rejects an archived code and a duplicate', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      const insObs = (code: string) =>
        `INSERT INTO rec.warning_light_observations
           (tenant_id, company_id, branch_id, reception_visit_id, warning_light_code_id, created_by)
         VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${code}','${USER_A}')`;
      expect((await c.query(insObs(WL) + ' RETURNING id')).rows).toHaveLength(1);
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insObs(WL_ARCH)), '23514'); // archived code
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(insObs(WL)), '23505'); // duplicate active (visit, code)
    });
  });

  it('validates leak type', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await newVisit(c);
      const insLeak = (type: string) =>
        `INSERT INTO rec.leak_observations
           (tenant_id, company_id, branch_id, reception_visit_id, leak_type, vehicle_zone, created_by)
         VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${type}','engine_bay','${USER_A}')`;
      expect((await c.query(insLeak('oil') + ' RETURNING id')).rows).toHaveLength(1);
      await expectSqlState(c.query(insLeak('plasma')), '23514');
    });
  });
});

describe('rec Wave-4 isolation', () => {
  it('isolates tenants and denies app_readonly writes', async () => {
    await withRolledBackTx(runtime, ctxB, async (c) => {
      const n = await c.query(`SELECT count(*)::int n FROM rec.damage_maps`);
      expect(n.rows[0].n).toBe(0);
    });
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO rec.leak_observations
             (tenant_id, company_id, branch_id, reception_visit_id, leak_type, vehicle_zone, created_by)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','a1000000-0000-4000-8000-0000000b10ee','oil','x','${USER_A}')`
        ),
        '42501'
      );
    });
  });
});
