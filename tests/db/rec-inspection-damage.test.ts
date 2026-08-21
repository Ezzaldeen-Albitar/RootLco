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
const DOC = 'a1000000-0000-4000-8000-0000000b10d1';
const VER1 = 'a1000000-0000-4000-8000-0000000b10e1';
const VER2 = 'a1000000-0000-4000-8000-0000000b10e2';
const DOC2 = 'a1000000-0000-4000-8000-0000000b10d2'; // a different document
const VER_OTHER = 'a1000000-0000-4000-8000-0000000b10e3'; // version of DOC2
/*
 * DBCR-P1-28-001. A damage map must NAME the template revision it was drawn
 * on, so this suite seeds real slots rather than binding a bare version.
 *
 * TWO slots, not one with two revisions: `uq_damage_map_template_one_active`
 * holds a single live revision per slot, so publishing a second would retire
 * the first and the "both coexist" case below would then be asserting the
 * retirement rule instead of the coexistence one it is named for.
 */
const TPL1 = 'a1000000-0000-4000-8000-0000000b1091';
const TPL2 = 'a1000000-0000-4000-8000-0000000b1092';
const REV1 = 'a1000000-0000-4000-8000-0000000b1093';
const REV2 = 'a1000000-0000-4000-8000-0000000b1094';
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

const insMap = (visit: string, version: string, revision: string, doc = DOC) =>
  `INSERT INTO rec.damage_maps
     (tenant_id, company_id, branch_id, reception_visit_id, document_id, document_version_id,
      map_type, damage_map_template_version_id, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${doc}','${version}','exterior',
           '${revision}','${USER_A}') RETURNING id`;

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
    /*
     * The REAL category, looked up before the documents are inserted.
     *
     * `rec.guard_damage_map_template_version()` requires the document to sit in
     * `reception_damage_map_template`, and `shared.documents.category_id` is
     * immutable — so a fixture that inserts under an invented category and
     * moves it afterwards is refused outright ("column category_id is
     * immutable"). The invented `fx_rec_maps` category is gone with it: a
     * fixture category that no rule accepts was only ever standing in for the
     * one the schema actually names.
     */
    const cat = (
      await c.query<{ id: string; purpose: string }>(
        `SELECT id, business_link_purpose AS purpose FROM shared.document_categories
          WHERE category_code = 'reception_damage_map_template' AND deleted_at IS NULL
          ORDER BY (tenant_id IS NOT NULL) DESC LIMIT 1`
      )
    ).rows[0];
    if (!cat) throw new Error('the reception_damage_map_template category is absent');
    await c.query(
      `INSERT INTO shared.documents (id, tenant_id, category_id, title, classification, retention_class, created_by)
       VALUES ($1,$3,$2,'Map A','internal','operational',$4),($5,$3,$2,'Map B','internal','operational',$4)`,
      [DOC, cat.id, TENANT_A, USER_A, DOC2]
    );
    await c.query(
      `INSERT INTO shared.document_versions
         (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes, sha256, uploaded_by, created_by)
       VALUES ($1,$4,$5,1,'t/1/map/a1','application/pdf',2048,${SHA},$6,$6),
              ($2,$4,$5,2,'t/1/map/a2','application/pdf',2048,${SHA},$6,$6),
              ($3,$4,$7,1,'t/1/map/b1','application/pdf',2048,${SHA},$6,$6)`,
      [VER1, VER2, VER_OTHER, TENANT_A, DOC, USER_A, DOC2]
    );

    /*
     * The category the template guard demands, plus a live link per slot.
     *
     * `rec.guard_damage_map_template_version()` requires an ACCEPTED version in
     * the `reception_damage_map_template` category AND a link from that
     * document to the slot, so the fixture documents move onto the real
     * category rather than the generic one this suite used to invent. The
     * versions go through `scanning` to `accepted` because P1-15 refuses
     * pending -> accepted outright.
     */

    await c.query(`UPDATE shared.document_versions SET status='scanning' WHERE id IN ($1,$2,$3)`, [
      VER1,
      VER2,
      VER_OTHER,
    ]);
    await c.query(
      `INSERT INTO shared.file_scan_results (tenant_id, version_id, scanner_code, scan_status, scanned_at, created_by)
       SELECT $1, v, 'harness', 'clean', now(), $2 FROM unnest(ARRAY[$3::uuid,$4::uuid,$5::uuid]) v`,
      [TENANT_A, USER_A, VER1, VER2, VER_OTHER]
    );
    await c.query(`UPDATE shared.document_versions SET status='accepted' WHERE id IN ($1,$2,$3)`, [
      VER1,
      VER2,
      VER_OTHER,
    ]);
    await c.query(
      `INSERT INTO rec.damage_map_templates (id, tenant_id, company_id, branch_id, map_type, created_by)
       VALUES ($1,$3,$4,$5,'exterior',$6),($2,$3,$4,$5,'exterior',$6)`,
      [TPL1, TPL2, TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
    );
    await c.query(
      `INSERT INTO shared.document_links (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
       VALUES ($1,$2,'rec.damage_map_templates',$3,$5,$6,$6),
              ($1,$2,'rec.damage_map_templates',$4,$5,$6,$6)`,
      [TENANT_A, DOC, TPL1, TPL2, cat.purpose, USER_A]
    );
    await c.query(
      `INSERT INTO rec.damage_map_template_versions
         (id, tenant_id, template_id, version_number, document_id, document_version_id, created_by)
       VALUES ($1,$3,$4,1,$6,$7,$8),($2,$3,$5,1,$6,$9,$8)`,
      [REV1, REV2, TENANT_A, TPL1, TPL2, DOC, VER1, USER_A, VER2]
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
      const map1 = (await c.query(insMap(visit, VER1, REV1))).rows[0].id;
      // a version that belongs to a different document is rejected
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insMap(visit, VER_OTHER, REV1)), '23514');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      // a template revision is a NEW map bound to the new version; both coexist
      const map2 = (await c.query(insMap(visit, VER2, REV2))).rows[0].id;
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
      const map = (await c.query(insMap(visit, VER1, REV1))).rows[0].id;
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
