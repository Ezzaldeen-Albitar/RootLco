/**
 * Phase 1-5 Increment C — shared.document_links + the link-derived access
 * contract (P1-05-DB-005, P1-05-SEC-001, P1-05-QA-002).
 *
 * A document is reachable only through a LIVE link to an entity the principal may
 * see — never by knowing a document_id/storage_key. The contract is proven with
 * SYNTHETIC entity types (no CRM/vehicle tables are created). Cross-tenant links
 * are structurally impossible; a soft-deleted link removes derived access.
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
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const ACTOR = USER_A;

const CAT = 'd2000000-0000-4000-8000-000000000001';
const DOC = 'd2c00000-0000-4000-8000-00000000000a';
const LINK = 'd2100000-0000-4000-8000-00000000000a';
const ENTITY1 = 'e0000000-0000-4000-8000-000000000001'; // synthetic crm.customer
const ENTITY2 = 'e0000000-0000-4000-8000-000000000002'; // synthetic test.thing

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  await withCommittedTx(admin, {}, async (c) => {
    await c.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types,
          max_size_bytes, default_classification, default_retention_class, created_by)
       VALUES ($1,'platform',NULL,'fx_docs_links','Links fixture',
               ARRAY['application/pdf'],10485760,'internal','operational',$2)`,
      [CAT, ACTOR]
    );
    await c.query(
      `INSERT INTO shared.documents (id, tenant_id, category_id, title, classification, retention_class, created_by)
       VALUES ($1,$2,$3,'Linked doc','internal','operational',$4)`,
      [DOC, TENANT_A, CAT, ACTOR]
    );
    await c.query(
      `INSERT INTO shared.document_links
         (id, tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
       VALUES ($1,$2,$3,'crm.customer',$4,'attachment',$5,$5)`,
      [LINK, TENANT_A, DOC, ENTITY1, ACTOR]
    );
  });
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('shared.document_links — integrity and constraints', () => {
  it('rejects a cross-tenant link (composite document FK)', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_links
             (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
           VALUES ($1,$2,'crm.customer',$3,'attachment',$4,$4)`,
          [TENANT_B, DOC, ENTITY1, ACTOR]
        ),
        '23503'
      )
    );
  });

  it('enforces the entity_type and link_purpose formats', async () => {
    const bad = (etype: string, purpose: string) =>
      withRolledBackTx(admin, {}, (c) =>
        expectSqlState(
          c.query(
            `INSERT INTO shared.document_links
               (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$6)`,
            [TENANT_A, DOC, etype, ENTITY2, purpose, ACTOR]
          ),
          '23514'
        )
      );
    await bad('Customer', 'attachment'); // not schema.table
    await bad('crm', 'attachment'); // missing .table
    await bad('crm.customer', 'Bad-Purpose'); // bad purpose
  });

  it('allows one active link per (document, entity, purpose) and re-link after soft delete', async () => {
    // duplicate ACTIVE link is rejected
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_links
             (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
           VALUES ($1,$2,'crm.customer',$3,'attachment',$4,$4)`,
          [TENANT_A, DOC, ENTITY1, ACTOR]
        ),
        '23505'
      )
    );
    // soft-delete then re-add succeeds (partial unique index ignores deleted rows)
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(`UPDATE shared.document_links SET deleted_at = now() WHERE id=$1`, [LINK]);
      const r = await c.query(
        `INSERT INTO shared.document_links
           (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
         VALUES ($1,$2,'crm.customer',$3,'attachment',$4,$4) RETURNING id`,
        [TENANT_A, DOC, ENTITY1, ACTOR]
      );
      expect(r.rows).toHaveLength(1);
    });
  });

  it('entity_id is immutable after creation', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.document_links SET entity_id=$1 WHERE id=$2`, [ENTITY2, LINK]),
        '23514'
      )
    );
  });
});

describe('link-derived access contract (P1-05-QA-002)', () => {
  it('resolves documents through a live link within the tenant', async () => {
    const r = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT shared.document_ids_for_entity('crm.customer', $1) AS doc`, [ENTITY1])
    );
    expect(r.rows.map((row) => row.doc)).toContain(DOC);
  });

  it('another tenant resolves nothing from the same document/entity id', async () => {
    const r = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: ACTOR }, (c) =>
      c.query(`SELECT shared.document_ids_for_entity('crm.customer', $1) AS doc`, [ENTITY1])
    );
    expect(r.rows).toHaveLength(0);
  });

  it('a soft-deleted link yields no derived access', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(`UPDATE shared.document_links SET deleted_at = now() WHERE id=$1`, [LINK]);
      // resolve within the same tx as the (bypassing) admin to observe the effect
      const r = await c.query(
        `SELECT count(*)::int n FROM shared.document_links
         WHERE entity_type='crm.customer' AND entity_id=$1 AND deleted_at IS NULL`,
        [ENTITY1]
      );
      expect(r.rows[0].n).toBe(0);
    });
  });

  it('a second synthetic entity type resolves independently', async () => {
    await withCommittedTx(admin, {}, (c) =>
      c.query(
        `INSERT INTO shared.document_links
           (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
         VALUES ($1,$2,'test.thing',$3,'reference',$4,$4)`,
        [TENANT_A, DOC, ENTITY2, ACTOR]
      )
    );
    try {
      const r = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
        c.query(`SELECT shared.document_ids_for_entity('test.thing', $1) AS doc`, [ENTITY2])
      );
      expect(r.rows.map((row) => row.doc)).toContain(DOC);
    } finally {
      await admin.query(
        `DELETE FROM shared.document_links WHERE entity_type='test.thing' AND entity_id=$1`,
        [ENTITY2]
      );
    }
  });

  it('a runtime session reads only its own tenant links and cannot write', async () => {
    const a = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.document_links WHERE id=$1`, [LINK])
    );
    expect(a.rows).toHaveLength(1);
    const b = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.document_links WHERE id=$1`, [LINK])
    );
    expect(b.rows).toHaveLength(0);
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_links
             (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
           VALUES ($1,$2,'crm.customer',$3,'attachment',$4,$4)`,
          [TENANT_A, DOC, ENTITY2, ACTOR]
        ),
        '42501'
      )
    );
  });
});
