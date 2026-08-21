/**
 * Phase 1-8 reception custody / authorization / status + atomic check-in
 * (P1-08-DB-017..022).
 *
 * Proves the atomic accept_check_in primitive (visit + service-requester role +
 * custody acceptance + opened status, one transaction), the custody chain
 * (accepted -> in_workshop -> released; no release-before-accept; no duplicate
 * accept), authorization authority + activation preconditions for authorized,
 * conversion without a work order, append-only denial, signature version binding,
 * and RLS.
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

const V_A = 'a1000000-0000-4000-8000-0000000b3001';
const SR = 'a1000000-0000-4000-8000-0000000b30c1'; // service requester
const AP = 'a1000000-0000-4000-8000-0000000b30c2'; // approving party
const CAT = 'a1000000-0000-4000-8000-0000000b30d0';
const DOC = 'a1000000-0000-4000-8000-0000000b30d1';
const VER = 'a1000000-0000-4000-8000-0000000b30e1';
const DOC2 = 'a1000000-0000-4000-8000-0000000b30d2';
const VER_OTHER = 'a1000000-0000-4000-8000-0000000b30e2';
const RR = 'a1000000-0000-4000-8000-0000000b30f1'; // active refusal reason
const SHA = "decode('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex')";
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_A };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;
type Q = { query: Client['query'] };

// Creates a walk-in then calls the atomic accept_check_in; returns the visit id.
const checkIn = async (c: Q, serviceRequester: string | null = SR): Promise<string> => {
  const wi = (
    await c.query(
      `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, vehicle_id, created_by)
       VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${V_A}','${USER_A}') RETURNING id`
    )
  ).rows[0].id;
  const r = await c.query(
    `SELECT rec.accept_check_in($1,$2,$3,NULL,$4,$5,$6,NULL,NULL,NULL,NULL) AS id`,
    [COMPANY_A1, BRANCH_A1, V_A, wi, USER_A, serviceRequester]
  );
  return r.rows[0].id;
};

const addRole = (visit: string, partner: string, role: string) =>
  `INSERT INTO rec.reception_party_roles
     (tenant_id, company_id, branch_id, reception_visit_id, partner_id, relationship_role, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','${partner}','${role}','${USER_A}')`;

const insAuth = (visit: string, partner: string, decision = 'approved') =>
  `INSERT INTO rec.authorizations
     (tenant_id, company_id, branch_id, reception_visit_id, authorizing_role, partner_id, decision, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','approving_party','${partner}','${decision}','${USER_A}')`;

const insCustody = (visit: string, from: string | null, to: string) =>
  `INSERT INTO rec.custody_history
     (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state, actor_id)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}',${from ? `'${from}'` : 'NULL'},'${to}','${USER_A}')`;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
     VALUES ($1,$2,'RECW5VIN01','ice','active',$3)`,
    [V_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by) VALUES
       ($1,$3,'individual','Service Requester',$4),($2,$3,'individual','Approver',$4)`,
    [SR, AP, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO rec.refusal_reasons (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_rr_declined','Declined',$2)`,
    [RR, USER_A]
  );
  await withCommittedTx(admin, {}, async (c) => {
    await c.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
          default_classification, default_retention_class, created_by)
       VALUES ($1,'platform',NULL,'fx_rec_sig','Sig fixture',ARRAY['application/pdf'],10485760,
               'internal','operational',$2)`,
      [CAT, USER_A]
    );
    await c.query(
      `INSERT INTO shared.documents (id, tenant_id, category_id, title, classification, retention_class, created_by)
       VALUES ($1,$3,$2,'Sig A','internal','operational',$4),($5,$3,$2,'Sig B','internal','operational',$4)`,
      [DOC, CAT, TENANT_A, USER_A, DOC2]
    );
    await c.query(
      `INSERT INTO shared.document_versions
         (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes, sha256, uploaded_by, created_by)
       VALUES ($1,$3,$4,1,'t/1/sig/a','application/pdf',1024,${SHA},$5,$5),
              ($2,$3,$6,1,'t/1/sig/b','application/pdf',1024,${SHA},$5,$5)`,
      [VER, VER_OTHER, TENANT_A, DOC, USER_A, DOC2]
    );
  });
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('rec.accept_check_in — atomic primitive', () => {
  it('creates the visit, service-requester role, custody acceptance, and opened status in one tx', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c);
      const role = await c.query(
        `SELECT count(*)::int n FROM rec.reception_party_roles
         WHERE reception_visit_id='${visit}' AND relationship_role='service_requester' AND valid_to IS NULL`
      );
      const custody = await c.query(
        `SELECT to_state FROM rec.custody_history WHERE reception_visit_id='${visit}'`
      );
      const status = await c.query(
        `SELECT to_state FROM rec.reception_status_history WHERE reception_visit_id='${visit}'`
      );
      expect(role.rows[0].n).toBe(1);
      expect(custody.rows.map((r) => r.to_state)).toEqual(['accepted']);
      expect(status.rows.map((r) => r.to_state)).toEqual(['opened']);
    });
  });

  it('refuses to check in without a service requester', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(checkIn(c, null), '23514');
    });
  });
});

describe('rec.custody_history — chain integrity', () => {
  it('follows accepted -> in_workshop -> released and freezes after release', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c); // custody already accepted
      await c.query(insCustody(visit, 'accepted', 'in_workshop'));
      await c.query(insCustody(visit, 'in_workshop', 'released'));
      await expectSqlState(c.query(insCustody(visit, 'released', 'in_workshop')), '23514');
    });
  });

  it('rejects release-before-accept and duplicate acceptance', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // a visit created directly (not via primitive) has no custody yet
      const wi = (
        await c.query(
          `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, vehicle_id, created_by)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${V_A}','${USER_A}') RETURNING id`
        )
      ).rows[0].id;
      const visit = (
        await c.query(
          `INSERT INTO rec.reception_visits
             (tenant_id, company_id, branch_id, walk_in_id, vehicle_id, receiving_employee_id, created_by)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${wi}','${V_A}','${USER_A}','${USER_A}') RETURNING id`
        )
      ).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insCustody(visit, null, 'released')), '23514'); // release before accept
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await c.query(insCustody(visit, null, 'accepted'));
      // duplicate accept: the transition guard (23514) fires before the
      // uq_custody_history_accepted unique (23505, the concurrency backstop).
      await expectSqlState(c.query(insCustody(visit, null, 'accepted')), '23514', '23505');
    });
  });
});

describe('rec.authorizations + reception authorized transition', () => {
  it('requires active authority and gates the authorized transition on an approved authorization', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c);
      // AP holds no role yet -> authorization rejected
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insAuth(visit, AP)), '23514');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await c.query(addRole(visit, AP, 'approving_party'));
      // move to inspecting, then authorized without an approval -> rejected
      await c.query(
        `UPDATE rec.reception_visits SET reception_status='inspecting' WHERE id='${visit}'`
      );
      await c.query('SAVEPOINT s2');
      await expectSqlState(
        c.query(
          `UPDATE rec.reception_visits SET reception_status='authorized' WHERE id='${visit}'`
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s2');
      // record the approval, then authorize + convert (no work order created)
      await c.query(insAuth(visit, AP));
      await c.query(
        `UPDATE rec.reception_visits SET reception_status='authorized' WHERE id='${visit}'`
      );
      await c.query(
        `UPDATE rec.reception_visits SET reception_status='converted' WHERE id='${visit}'`
      );
      const status = await c.query(
        `SELECT to_state FROM rec.reception_status_history WHERE reception_visit_id='${visit}' ORDER BY seq`
      );
      expect(status.rows.map((r) => r.to_state)).toEqual([
        'opened',
        'inspecting',
        'authorized',
        'converted',
      ]);
    });
  });
});

describe('rec — append-only + signatures + isolation', () => {
  it('denies UPDATE/DELETE on append-only ledgers', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c);
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          `UPDATE rec.custody_history SET to_state='released' WHERE reception_visit_id='${visit}'`
        ),
        '42501'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(`DELETE FROM rec.reception_status_history WHERE reception_visit_id='${visit}'`),
        '42501'
      );
    });
  });

  it('binds a signature to an exact version and rejects a mismatched one', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c);
      const sig = (doc: string, ver: string) =>
        `INSERT INTO rec.signatures
           (tenant_id, company_id, branch_id, reception_visit_id, signer_role, signer_partner_id,
            signature_document_id, signature_document_version_id, capture_method, purpose, created_by)
         VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','service_requester','${SR}',
           '${doc}','${ver}','drawn','custody_acceptance','${USER_A}')`;
      expect((await c.query(sig(DOC, VER) + ' RETURNING id')).rows).toHaveLength(1);
      /*
       * VER_OTHER belongs to DOC2, and the pair is refused — but since P1-18 the
       * refusal can arrive from either of two guards, so both codes are accepted.
       *
       * `rec.guard_signature_version` (Phase 1-8) raises 23514: the version does
       * not belong to the named document. `rec.guard_signature_evidence` (P1-18,
       * additive) runs BEFORE INSERT on the same table and rejects the pair as
       * not visible first, which surfaces as 23503. Same invariant, two owners,
       * and which one speaks first is an ordering detail this test should not
       * pin — what it must pin is that a mismatched pair never lands.
       *
       * The Phase 1-8 guard is NOT superseded, and the assertion below proves it
       * still has an owner rather than assuming it: it is a stated Owner
       * constraint that P1-18 leaves it untouched, and a guard that stopped being
       * attached would otherwise be invisible from here now that this fixture no
       * longer reaches it.
       */
      await expectSqlState(c.query(sig(DOC, VER_OTHER)), '23514', '23503');
    });

    const stillWired = await admin.query<{ tgname: string }>(
      `SELECT t.tgname FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND n.nspname = 'rec' AND c.relname = 'signatures'
          AND p.proname = 'guard_signature_version'`
    );
    expect(
      stillWired.rows,
      'rec.guard_signature_version must remain attached to rec.signatures'
    ).toHaveLength(1);
  });

  it('rejects an archived refusal reason and isolates tenants; denies readonly writes', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visit = await checkIn(c);
      await admin.query(`UPDATE rec.refusal_reasons SET status='inactive' WHERE id=$1`, [RR]);
      try {
        await expectSqlState(
          c.query(
            `INSERT INTO rec.refusals
               (tenant_id, company_id, branch_id, reception_visit_id, refusal_type, refusal_reason_id, created_by)
             VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${visit}','signature','${RR}','${USER_A}')`
          ),
          '23514'
        );
      } finally {
        await admin.query(`UPDATE rec.refusal_reasons SET status='active' WHERE id=$1`, [RR]);
      }
    });
    await withRolledBackTx(runtime, ctxB, async (c) => {
      const n = await c.query(`SELECT count(*)::int n FROM rec.custody_history`);
      expect(n.rows[0].n).toBe(0);
    });
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(
        c.query(insCustody('a1000000-0000-4000-8000-0000000b30ee', null, 'accepted')),
        '42501'
      );
    });
  });
});
