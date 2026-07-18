/**
 * Phase 1-5 Increment A — shared.document_categories / shared.documents
 * (P1-05-DB-001, P1-05-DB-002).
 *
 * Governed document METADATA only (no file bytes). Covers: dual-scope category
 * visibility (platform default vs tenant override), the scope-consistency CHECK,
 * the platform-or-same-tenant category guard on documents, composite tenant FKs,
 * immutability, tenant isolation under FORCE RLS, and the SELECT-only runtime
 * grant. Isolation assertions run as the non-owner runtime login.
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
  COMPANY_A1,
  BRANCH_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const ACTOR = USER_A;

// Deterministic fixture ids (committed in beforeAll, removed in afterAll).
const CAT_PLATFORM = 'd0000000-0000-4000-8000-000000000001';
const CAT_TENANT_A = 'd0000000-0000-4000-8000-0000000000a1';
const CAT_TENANT_B = 'd0000000-0000-4000-8000-0000000000b1';
const DOC_A = 'dc000000-0000-4000-8000-00000000000a';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  // A platform category (readable by every tenant) and one tenant category each
  // for A and B; plus one document in tenant A referencing the platform category.
  await withCommittedTx(admin, {}, async (c) => {
    await c.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types,
          max_size_bytes, default_classification, default_retention_class, created_by)
       VALUES ($1,'platform',NULL,'fx_docs_platform','Platform default',
               ARRAY['application/pdf'],10485760,'internal','operational',$2)`,
      [CAT_PLATFORM, ACTOR]
    );
    await c.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types,
          max_size_bytes, default_classification, default_retention_class, created_by)
       VALUES ($1,'tenant',$2,'contracts','Tenant A contracts',
               ARRAY['application/pdf'],10485760,'restricted','evidence-audit',$3)`,
      [CAT_TENANT_A, TENANT_A, ACTOR]
    );
    await c.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types,
          max_size_bytes, default_classification, default_retention_class, created_by)
       VALUES ($1,'tenant',$2,'contracts','Tenant B contracts',
               ARRAY['application/pdf'],10485760,'restricted','evidence-audit',$3)`,
      [CAT_TENANT_B, TENANT_B, ACTOR]
    );
    await c.query(
      `INSERT INTO shared.documents
         (id, tenant_id, company_id, branch_id, category_id, title, classification, retention_class, created_by)
       VALUES ($1,$2,$3,$4,$5,'Fixture document A','internal','operational',$6)`,
      [DOC_A, TENANT_A, COMPANY_A1, BRANCH_A1, CAT_PLATFORM, ACTOR]
    );
  });
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('shared.document_categories — dual-scope policy envelope', () => {
  it('legal-hold default lives on documents; category defaults are recorded', async () => {
    const { rows } = await admin.query(
      `SELECT scope, tenant_id, status FROM shared.document_categories WHERE id=$1`,
      [CAT_PLATFORM]
    );
    expect(rows[0]).toEqual({ scope: 'platform', tenant_id: null, status: 'active' });
  });

  it('rejects a platform row that carries a tenant_id (scope-consistency CHECK)', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_categories
             (scope, tenant_id, category_code, name, allowed_content_types,
              max_size_bytes, default_classification, default_retention_class, created_by)
           VALUES ('platform',$1,'fx_bad','x',ARRAY['application/pdf'],1,'internal','operational',$2)`,
          [TENANT_A, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('rejects a tenant row with a NULL tenant_id (scope-consistency CHECK)', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_categories
             (scope, tenant_id, category_code, name, allowed_content_types,
              max_size_bytes, default_classification, default_retention_class, created_by)
           VALUES ('tenant',NULL,'bad','x',ARRAY['application/pdf'],1,'internal','operational',$1)`,
          [ACTOR]
        ),
        '23514'
      )
    );
  });

  it('rejects an invalid category_code, empty content types, and a non-positive size', async () => {
    const bad = async (cols: string, vals: unknown[]) =>
      withRolledBackTx(admin, {}, (c) =>
        expectSqlState(
          c.query(
            `INSERT INTO shared.document_categories
               (scope, tenant_id, category_code, name, allowed_content_types,
                max_size_bytes, default_classification, default_retention_class, created_by)
             VALUES ${cols}`,
            vals
          ),
          '23514'
        )
      );
    await bad(
      `('platform',NULL,'Bad-Code','x',ARRAY['application/pdf'],1,'internal','operational',$1)`,
      [ACTOR]
    ); // uppercase/hyphen
    await bad(`('platform',NULL,'fx_empty','x',ARRAY[]::text[],1,'internal','operational',$1)`, [
      ACTOR,
    ]); // no content types
    await bad(`('platform',NULL,'fx_blank','x',ARRAY['']::text[],1,'internal','operational',$1)`, [
      ACTOR,
    ]); // blank content type
    await bad(
      `('platform',NULL,'fx_size','x',ARRAY['application/pdf'],0,'internal','operational',$1)`,
      [ACTOR]
    ); // zero size
  });

  it('enforces platform-code uniqueness and per-tenant code uniqueness', async () => {
    // Duplicate platform code (a fixture platform row already uses fx_docs_platform).
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_categories
             (scope, tenant_id, category_code, name, allowed_content_types,
              max_size_bytes, default_classification, default_retention_class, created_by)
           VALUES ('platform',NULL,'fx_docs_platform','dup',ARRAY['application/pdf'],1,'internal','operational',$1)`,
          [ACTOR]
        ),
        '23505'
      )
    );
    // The same code 'contracts' exists for both tenants A and B — that is allowed.
    const both = await admin.query(
      `SELECT tenant_id FROM shared.document_categories WHERE category_code='contracts' ORDER BY tenant_id`
    );
    expect(both.rows).toHaveLength(2);
  });

  it('code, scope and tenant_id are immutable after creation', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.document_categories SET category_code='fx_renamed' WHERE id=$1`, [
          CAT_PLATFORM,
        ]),
        '23514'
      )
    );
  });

  it('a runtime session sees platform + own-tenant categories only', async () => {
    const a = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.document_categories ORDER BY id`)
    );
    const idsA = a.rows.map((r) => r.id);
    expect(idsA).toContain(CAT_PLATFORM);
    expect(idsA).toContain(CAT_TENANT_A);
    expect(idsA).not.toContain(CAT_TENANT_B);

    const b = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.document_categories WHERE id=$1`, [CAT_TENANT_A])
    );
    expect(b.rows).toHaveLength(0);
  });

  it('runtime cannot write categories (SELECT-only grant)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_categories
             (scope, tenant_id, category_code, name, allowed_content_types,
              max_size_bytes, default_classification, default_retention_class, created_by)
           VALUES ('tenant',$1,'nope','x',ARRAY['application/pdf'],1,'internal','operational',$2)`,
          [TENANT_A, ACTOR]
        ),
        '42501'
      )
    );
  });
});

describe('shared.documents — governed metadata, tenant-isolated', () => {
  it('accepts a document referencing a platform category (fixture) with defaults', async () => {
    const { rows } = await admin.query(
      `SELECT legal_hold, status, record_version FROM shared.documents WHERE id=$1`,
      [DOC_A]
    );
    expect(rows[0]).toEqual({ legal_hold: false, status: 'pending', record_version: 1 });
  });

  it('accepts a document referencing a same-tenant category', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const r = await c.query(
        `INSERT INTO shared.documents (tenant_id, category_id, title, classification, retention_class, created_by)
         VALUES ($1,$2,'same-tenant cat','internal','operational',$3) RETURNING id`,
        [TENANT_A, CAT_TENANT_A, ACTOR]
      );
      expect(r.rows).toHaveLength(1);
    });
  });

  it("rejects a document referencing another tenant's category (scope guard)", async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.documents (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1,$2,'cross-tenant cat','internal','operational',$3)`,
          [TENANT_A, CAT_TENANT_B, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('rejects a document referencing a non-existent category (guard FK)', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.documents (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1,$2,'ghost cat','internal','operational',$3)`,
          [TENANT_A, '00000000-0000-4000-8000-0000000000ee', ACTOR]
        ),
        '23503'
      )
    );
  });

  it('rejects a company that belongs to another tenant (composite FK)', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.documents (tenant_id, company_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1,$2,$3,'wrong company','internal','operational',$4)`,
          [TENANT_B, COMPANY_A1, CAT_PLATFORM, ACTOR]
        ),
        '23503'
      )
    );
  });

  it('rejects an invalid classification and an invalid status', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.documents (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1,$2,'bad class','ultra','operational',$3)`,
          [TENANT_A, CAT_PLATFORM, ACTOR]
        ),
        '23514'
      )
    );
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.documents (tenant_id, category_id, title, classification, status, retention_class, created_by)
           VALUES ($1,$2,'bad status','internal','deleted','operational',$3)`,
          [TENANT_A, CAT_PLATFORM, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('tenant_id and category_id are immutable after creation', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.documents SET category_id=$1 WHERE id=$2`, [CAT_TENANT_A, DOC_A]),
        '23514'
      )
    );
  });

  it('a runtime session reads only its own tenant documents and cannot write', async () => {
    const a = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.documents WHERE id=$1`, [DOC_A])
    );
    expect(a.rows).toHaveLength(1);
    const b = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.documents WHERE id=$1`, [DOC_A])
    );
    expect(b.rows).toHaveLength(0);
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.documents (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1,$2,'nope','internal','operational',$3)`,
          [TENANT_A, CAT_PLATFORM, ACTOR]
        ),
        '42501'
      )
    );
  });
});
