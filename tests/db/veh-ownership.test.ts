/**
 * Phase 1-7 Plate / Ownership / Relationships / Evidence (P1-07-DB-010..013) and
 * the crown-jewel ownership-transfer visibility proof (SEC-001, FR-VEH-004,
 * BR-VEH-002).
 *
 * Executable proof that Vehicle history follows the Vehicle while a prior owner's
 * CRM-private data is NOT duplicated into veh and stays behind CRM's own RLS: a
 * new owner (a tenant user without iam.sensitive.view) can read ownership history
 * (opaque partner_id only) but cannot resolve the prior owner's restricted CRM
 * data, and no veh column or resolver exposes prior-owner PII.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';

const V = 'f0000000-0000-4000-8000-0000000c5001';
const V2 = 'f0000000-0000-4000-8000-0000000c5002';
const V_B = 'f0000000-0000-4000-8000-0000000c500b';
const P1 = 'f0000000-0000-4000-8000-0000000c5a01'; // prior owner
const P2 = 'f0000000-0000-4000-8000-0000000c5a02'; // new owner
const P_B = 'f0000000-0000-4000-8000-0000000c5a0b'; // tenant-B partner
const ctxA = { tenantId: TENANT_A, userId: USER_A };

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();

  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, lifecycle_status, created_by) VALUES
       ($1,$4,'OWNVIN001','active',$6),
       ($2,$4,'OWNVIN002','active',$6),
       ($3,$5,'OWNVINB01','active',$7)`,
    [V, V2, V_B, TENANT_A, TENANT_B, USER_A, USER_B]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by) VALUES
       ($1,$4,'individual','Prior Owner',$6),
       ($2,$4,'individual','New Owner',$6),
       ($3,$5,'individual','Tenant B Partner',$7)`,
    [P1, P2, P_B, TENANT_A, TENANT_B, USER_A, USER_B]
  );
  // P1 (prior owner) has a RESTRICTED CRM identifier (national id) — the thing a
  // new owner must never be able to resolve.
  await admin.query(
    `INSERT INTO crm.partner_identifiers
       (tenant_id, partner_id, identifier_type, normalized_value, raw_value, classification, created_by)
     VALUES ($1,$2,'national_id','990000001','990000001','restricted',$3)`,
    [TENANT_A, P1, USER_A]
  );
  // Ownership transfer P1 -> P2 (registered owner).
  await admin.query(
    `INSERT INTO veh.ownership_history (tenant_id, vehicle_id, partner_id, ownership_kind, valid_from, valid_to, created_by) VALUES
       ($1,$2,$3,'registered_owner','2020-01-01','2023-01-01',$5),
       ($1,$2,$4,'registered_owner','2023-01-01',NULL,$5)`,
    [TENANT_A, V, P1, P2, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('veh.plate_history — intervals + cross-vehicle plate uniqueness', () => {
  const insPlate = (vehicle: string, plate: string, from: string, to: string | null) =>
    `INSERT INTO veh.plate_history (tenant_id, vehicle_id, country_code, plate_raw, valid_from, valid_to, created_by)
     VALUES ('${TENANT_A}','${vehicle}','JO','${plate}','${from}',${to ? `'${to}'` : 'NULL'},'${USER_A}') RETURNING id`;

  it('rejects two plates on one vehicle at once, allows historical reuse', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insPlate(V, 'ABC-123', '2020-01-01', '2022-01-01'));
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insPlate(V, 'XYZ-999', '2021-01-01', null)), '23P01');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      const reuse = await c.query(insPlate(V, 'ABC-123', '2022-01-01', null));
      expect(reuse.rows).toHaveLength(1);
    });
  });

  it('rejects the same active plate on two different vehicles (incl. future-dated)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insPlate(V, 'DUP-777', '2020-01-01', null));
      // Same plate, a different same-tenant vehicle, a FUTURE interval that still
      // overlaps the open one -> rejected by the cross-vehicle active-plate EXCLUDE.
      await expectSqlState(c.query(insPlate(V2, 'DUP-777', '2025-01-01', null)), '23P01');
    });
  });
});

describe('veh.ownership_history — kind matrix + resolver', () => {
  const insOwn = (partner: string, kind: string, from: string, to: string | null) =>
    `INSERT INTO veh.ownership_history (tenant_id, vehicle_id, partner_id, ownership_kind, valid_from, valid_to, created_by)
     VALUES ('${TENANT_A}','${V}','${partner}','${kind}','${from}',${to ? `'${to}'` : 'NULL'},'${USER_A}') RETURNING id`;

  it('rejects a second overlapping registered owner but allows a beneficial owner', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // Committed fixture already has a registered owner from 2023-01-01 (open).
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insOwn(P1, 'registered_owner', '2024-01-01', null)), '23P01');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      const ben = await c.query(insOwn(P1, 'beneficial', '2024-01-01', null));
      expect(ben.rows).toHaveLength(1);
    });
  });

  it('resolves the current registered owner as a partner uuid', async () => {
    const owner = await withRolledBackTx(runtime, ctxA, (c) =>
      c.query(`SELECT veh.owner_at($1, current_date) AS p`, [V])
    );
    expect(owner.rows[0].p).toBe(P2);
  });

  it('forbids DELETE (mutable-temporal, not destructible)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(
        c.query(`DELETE FROM veh.ownership_history WHERE vehicle_id=$1`, [V]),
        '42501'
      );
    });
  });
});

describe('veh.vehicle_relationships — roles + authorized-person scope', () => {
  const insRel = (role: string, scope: string | null, grantedBy = true) =>
    `INSERT INTO veh.vehicle_relationships
       (tenant_id, vehicle_id, partner_id, relationship_role, valid_from, authorization_scope, granted_by, created_by)
     VALUES ('${TENANT_A}','${V}','${P2}','${role}','2023-01-01',${scope ? `'${scope}'::jsonb` : 'NULL'},${
       grantedBy ? `'${USER_A}'` : 'NULL'
     },'${USER_A}') RETURNING id`;

  const validScope =
    '{"schema_version":1,"allowed_actions":["approve_quotation","receive_vehicle"]}';

  it('accepts an authorized_person with a valid scope', async () => {
    const res = await withRolledBackTx(runtime, ctxA, (c) =>
      c.query(insRel('authorized_person', validScope))
    );
    expect(res.rows).toHaveLength(1);
  });

  it('rejects a scope on a non-authorized role', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(insRel('driver', validScope)), '23514');
    });
  });

  it('rejects a scope with no granted_by', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(insRel('authorized_person', validScope, false)), '23514');
    });
  });

  it('rejects an unknown or duplicated action in the scope', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          insRel('authorized_person', '{"schema_version":1,"allowed_actions":["hotwire_it"]}')
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(
          insRel(
            'authorized_person',
            '{"schema_version":1,"allowed_actions":["receive_vehicle","receive_vehicle"]}'
          )
        ),
        '23514'
      );
    });
  });

  it('freezes authorization_scope after grant (change = new interval)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insRel('authorized_person', validScope))).rows[0].id;
      await expectSqlState(
        c.query(
          `UPDATE veh.vehicle_relationships SET authorization_scope='{"schema_version":1,"allowed_actions":["receive_invoices"]}'::jsonb WHERE id=$1`,
          [id]
        ),
        '23514'
      );
    });
  });
});

describe('veh.relationship_evidence — append-only, same-tenant document', () => {
  it('append-only (UPDATE/DELETE denied) and stamped', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const rel = (
        await c.query(
          `INSERT INTO veh.vehicle_relationships (tenant_id, vehicle_id, partner_id, relationship_role, valid_from, created_by)
           VALUES ($1,$2,$3,'user','2023-01-01',$4) RETURNING id`,
          [TENANT_A, V, P2, USER_A]
        )
      ).rows[0].id;
      const ev = await c.query(
        `INSERT INTO veh.relationship_evidence (tenant_id, relationship_id, evidence_kind)
         VALUES ($1,$2,'authorization_letter') RETURNING id, actor_id`,
        [TENANT_A, rel]
      );
      expect(ev.rows[0].actor_id).toBe(USER_A);
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE veh.relationship_evidence SET evidence_kind='x' WHERE id=$1`, [
          ev.rows[0].id,
        ]),
        '42501'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(`DELETE FROM veh.relationship_evidence WHERE id=$1`, [ev.rows[0].id]),
        '42501'
      );
    });
  });
});

describe('CROWN JEWEL — ownership-transfer visibility (SEC-001 / FR-VEH-004)', () => {
  it('veh stores NO prior-owner PII columns (structural non-duplication)', async () => {
    const { rows } = await admin.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='veh'
         AND (column_name ~ 'contact|address|national_id|date_of_birth|dob|credit|consent|phone|email')`
    );
    expect(rows).toEqual([]);
  });

  it('owner_at returns a uuid and no veh function reads a CRM PII table', async () => {
    const leaky = await admin.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='veh'
         AND p.prosrc ~ 'crm\\.(partner_identifiers|partner_sensitive_attributes|contact_points|addresses|customer_credit_profiles|consent_history)'`
    );
    expect(leaky.rows).toEqual([]);
  });

  it('a new owner can read ownership history (partner_id only) but NOT the prior owner’s restricted CRM data', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // Vehicle ownership history is visible (opaque partner ids).
      const hist = await c.query(
        `SELECT partner_id FROM veh.ownership_history WHERE vehicle_id=$1 ORDER BY valid_from`,
        [V]
      );
      expect(hist.rows.map((r) => r.partner_id)).toEqual([P1, P2]);
      // But the prior owner's RESTRICTED CRM identifier stays gated (no sensitive.view).
      const restricted = await c.query(
        `SELECT id FROM crm.partner_identifiers WHERE partner_id=$1 AND classification='restricted'`,
        [P1]
      );
      expect(restricted.rows).toEqual([]);
    });
  });

  it('a cross-tenant user sees none of the vehicle’s ownership history', async () => {
    const res = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_B }, (c) =>
      c.query(`SELECT id FROM veh.ownership_history WHERE vehicle_id=$1`, [V])
    );
    expect(res.rows).toEqual([]);
  });
});
