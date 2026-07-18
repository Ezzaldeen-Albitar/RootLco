/**
 * Phase 1-5 Increment D — retention, legal hold, and controlled archival
 * (P1-05-DB-006, P1-05-SEC-002, P1-05-QA-005).
 *
 * Legal hold always wins; active links and un-elapsed retention block disposition;
 * archival is a controlled transition audited in the SAME transaction, so an audit
 * failure (invalid actor_kind) rolls the archival back. No physical deletion.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  withRolledBackTx,
} from './helpers';

const ACTOR = USER_A;
const SYS = '00000000-0000-4000-8000-000000000001';

const CAT = 'd3000000-0000-4000-8000-000000000001';
const DOC_ELIG = 'd3c00000-0000-4000-8000-00000000000e';
const DOC_HOLD = 'd3c00000-0000-4000-8000-00000000000a';
const DOC_FIN = 'd3c00000-0000-4000-8000-00000000000f';
const DOC_YOUNG = 'd3c00000-0000-4000-8000-00000000000c';
const ENTITY = 'e3000000-0000-4000-8000-000000000001';

let admin: Pool;
let runtime: Pool;

const newDoc = (id: string, retention: string) =>
  admin.query(
    `INSERT INTO shared.documents (id, tenant_id, category_id, title, classification, retention_class, created_by)
     VALUES ($1,$2,$3,'doc','internal',$4,$5) ON CONFLICT (id) DO NOTHING`,
    [id, TENANT_A, CAT, retention, ACTOR]
  );

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  await admin.query(
    `INSERT INTO shared.retention_classes (class_code, description, min_retention_days, allows_deletion, created_by)
     VALUES
       ('operational','Operational working data',0,true,$1),
       ('evidence-audit','Evidence and audit',3650,true,$1),
       ('immutable-financial-history','Issued financial documents',NULL,false,$1)
     ON CONFLICT (class_code) DO NOTHING`,
    [SYS]
  );
  await admin.query(
    `INSERT INTO shared.document_categories
       (id, scope, tenant_id, category_code, name, allowed_content_types,
        max_size_bytes, default_classification, default_retention_class, created_by)
     VALUES ($1,'platform',NULL,'fx_docs_retention','Retention fixture',
             ARRAY['application/pdf'],10485760,'internal','operational',$2)
     ON CONFLICT (id) DO NOTHING`,
    [CAT, ACTOR]
  );
  await newDoc(DOC_ELIG, 'operational');
  await newDoc(DOC_FIN, 'immutable-financial-history');
  await newDoc(DOC_YOUNG, 'evidence-audit');
  await admin.query(
    `INSERT INTO shared.documents (id, tenant_id, category_id, title, classification, retention_class, legal_hold, created_by)
     VALUES ($1,$2,$3,'held','internal','operational',true,$4) ON CONFLICT (id) DO NOTHING`,
    [DOC_HOLD, TENANT_A, CAT, ACTOR]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

const eligibility = (tenant: string, doc: string) =>
  admin
    .query(`SELECT shared.document_deletion_eligibility($1,$2) AS e`, [tenant, doc])
    .then((r) => r.rows[0].e);

describe('shared.document_deletion_eligibility — deterministic gates', () => {
  it('an operational document past retention with no hold/link is eligible', async () => {
    expect(await eligibility(TENANT_A, DOC_ELIG)).toBe('eligible');
  });

  it('the legal_hold flag always wins', async () => {
    expect(await eligibility(TENANT_A, DOC_HOLD)).toBe('legal_hold');
  });

  it('a class that forbids deletion is never eligible', async () => {
    expect(await eligibility(TENANT_A, DOC_FIN)).toBe('class_no_delete');
  });

  it('un-elapsed retention blocks eligibility', async () => {
    expect(await eligibility(TENANT_A, DOC_YOUNG)).toBe('retention_not_elapsed');
  });

  it('an active link blocks eligibility', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(
        `INSERT INTO shared.document_links
           (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
         VALUES ($1,$2,'crm.customer',$3,'attachment',$4,$4)`,
        [TENANT_A, DOC_ELIG, ENTITY, ACTOR]
      );
      const e = await c.query(`SELECT shared.document_deletion_eligibility($1,$2) AS e`, [
        TENANT_A,
        DOC_ELIG,
      ]);
      expect(e.rows[0].e).toBe('active_links');
    });
  });

  it('an active legal-hold record blocks eligibility', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(
        `INSERT INTO shared.legal_holds (tenant_id, document_id, reason, placed_by, created_by)
         VALUES ($1,$2,'litigation',$3,$3)`,
        [TENANT_A, DOC_ELIG, ACTOR]
      );
      const e = await c.query(`SELECT shared.document_deletion_eligibility($1,$2) AS e`, [
        TENANT_A,
        DOC_ELIG,
      ]);
      expect(e.rows[0].e).toBe('legal_hold');
    });
  });

  it('another tenant sees the document as not_found', async () => {
    expect(await eligibility(TENANT_B, DOC_ELIG)).toBe('not_found');
  });
});

describe('shared.legal_holds — one active hold, release pairing, immutability', () => {
  it('permits one active hold per document; a second active hold is rejected', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(
        `INSERT INTO shared.legal_holds (tenant_id, document_id, reason, placed_by, created_by)
         VALUES ($1,$2,'h1',$3,$3)`,
        [TENANT_A, DOC_ELIG, ACTOR]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO shared.legal_holds (tenant_id, document_id, reason, placed_by, created_by)
           VALUES ($1,$2,'h2',$3,$3)`,
          [TENANT_A, DOC_ELIG, ACTOR]
        ),
        '23505'
      );
    });
  });

  it('requires released_by and released_at together', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.legal_holds (tenant_id, document_id, reason, placed_by, released_at, created_by)
           VALUES ($1,$2,'x',$3, now(), $3)`,
          [TENANT_A, DOC_ELIG, ACTOR]
        ),
        '23514'
      )
    );
  });
});

describe('shared.archive_document — audited, atomic, legal-hold-blocked', () => {
  it('refuses a held or not-yet-eligible document', async () => {
    await expectSqlState(
      admin.query(`SELECT shared.archive_document($1,$2,$3,'x')`, [TENANT_A, DOC_HOLD, ACTOR]),
      '23514'
    );
    await expectSqlState(
      admin.query(`SELECT shared.archive_document($1,$2,$3,'x')`, [TENANT_A, DOC_YOUNG, ACTOR]),
      '23514'
    );
  });

  it('archives an eligible document AND writes one audit record in the same tx', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const r = await c.query(`SELECT shared.archive_document($1,$2,$3,'disposal') AS audit`, [
        TENANT_A,
        DOC_ELIG,
        ACTOR,
      ]);
      expect(r.rows[0].audit).not.toBeNull();
      const doc = await c.query(`SELECT status, archived_at FROM shared.documents WHERE id=$1`, [
        DOC_ELIG,
      ]);
      expect(doc.rows[0].status).toBe('archived');
      expect(doc.rows[0].archived_at).not.toBeNull();
      const aud = await c.query(
        `SELECT count(*)::int n FROM iam.audit_records
         WHERE tenant_id=$1 AND action='shared.document.archive' AND entity_id=$2`,
        [TENANT_A, DOC_ELIG]
      );
      expect(aud.rows[0].n).toBe(1);
      // a second archival in the same tx is rejected as already_archived
      await expectSqlState(
        c.query(`SELECT shared.archive_document($1,$2,$3,'again')`, [TENANT_A, DOC_ELIG, ACTOR]),
        '23514'
      );
    });
  });

  it('rolls the archival back if the audit write fails (invalid actor_kind)', async () => {
    // Autocommit: the failing statement rolls back on its own; the committed doc is unchanged.
    await expectSqlState(
      admin.query(`SELECT shared.archive_document($1,$2,$3,'x','robot')`, [
        TENANT_A,
        DOC_ELIG,
        ACTOR,
      ]),
      '23514'
    );
    const doc = await admin.query(`SELECT status FROM shared.documents WHERE id=$1`, [DOC_ELIG]);
    expect(doc.rows[0].status).toBe('pending'); // archival was rolled back with the failed audit
    const aud = await admin.query(
      `SELECT count(*)::int n FROM iam.audit_records
       WHERE tenant_id=$1 AND action='shared.document.archive' AND entity_id=$2`,
      [TENANT_A, DOC_ELIG]
    );
    expect(aud.rows[0].n).toBe(0); // and no audit record persisted
  });
});

describe('retention role posture', () => {
  it('runtime can read eligibility and holds within its tenant but cannot write or archive', async () => {
    const e = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT shared.document_deletion_eligibility($1,$2) AS e`, [TENANT_A, DOC_ELIG])
    );
    expect(e.rows[0].e).toBe('eligible');
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.legal_holds (tenant_id, document_id, reason, placed_by, created_by)
           VALUES ($1,$2,'x',$3,$3)`,
          [TENANT_A, DOC_ELIG, ACTOR]
        ),
        '42501'
      )
    );
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`SELECT shared.archive_document($1,$2,$3,'x')`, [TENANT_A, DOC_ELIG, ACTOR]),
        '42501'
      )
    );
  });

  it('retention_classes are readable by runtime and class_code is immutable', async () => {
    const r = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT count(*)::int n FROM shared.retention_classes`)
    );
    expect(r.rows[0].n).toBeGreaterThanOrEqual(3);
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `UPDATE shared.retention_classes SET class_code='temporary' WHERE class_code='operational'`
        ),
        '23514'
      )
    );
  });
});
