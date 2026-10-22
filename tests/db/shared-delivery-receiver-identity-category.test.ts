/**
 * P1-31 Owner decision D-18 — the approved optional identity-evidence document
 * category.
 *
 * The decision approves a category for the receiver's identity evidence at a
 * delivery handover, filed under the EXISTING scoped file-access rules, and
 * forbids filing that evidence under an unrelated category. The category is a
 * platform row in `supabase/seeds/05_shared_reference.sql`; this suite proves the
 * row is there with the identity purpose, that it is not a reception category,
 * and that it inherits the access posture every other category has rather than
 * carrying one of its own.
 *
 * Isolation assertions run as the non-owner runtime login under FORCE RLS. The
 * admin connection only provisions the one fixture document and reads the seeded
 * row back; it bypasses RLS, so nothing it does is access evidence.
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
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const CATEGORY_CODE = 'delivery_receiver_identity';
const ACTOR = USER_A;
/** One fixture document in tenant A, filed under the seeded category. */
const DOC_A = 'dc310000-0000-4000-8000-0000000000d1';

interface CategoryRow {
  readonly id: string;
  readonly scope: string;
  readonly tenant_id: string | null;
  readonly name: string;
  readonly business_link_purpose: string;
  readonly default_classification: string;
  readonly default_retention_class: string;
  readonly allowed_content_types: readonly string[];
  readonly max_size_bytes: string;
  readonly device_capture_timestamp_required: boolean;
  readonly status: string;
  readonly deleted_at: Date | null;
}

let admin: Pool;
let runtime: Pool;
let category: CategoryRow;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  const seeded = await admin.query<CategoryRow>(
    `SELECT id, scope, tenant_id, name, business_link_purpose, default_classification,
            default_retention_class, allowed_content_types, max_size_bytes::text,
            device_capture_timestamp_required, status, deleted_at
       FROM shared.document_categories
      WHERE category_code = $1 AND scope = 'platform' AND deleted_at IS NULL`,
    [CATEGORY_CODE]
  );
  const row = seeded.rows[0];
  if (row === undefined) {
    throw new Error(`the ${CATEGORY_CODE} platform category is absent: seed 05 was not applied`);
  }
  category = row;

  await withCommittedTx(admin, {}, async (c) => {
    await c.query(
      `INSERT INTO shared.documents
         (id, tenant_id, company_id, branch_id, category_id, title, classification,
          retention_class, created_by)
       VALUES ($1,$2,$3,$4,$5,'P1-31 identity evidence fixture',$6,$7,$8)`,
      [
        DOC_A,
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        category.id,
        category.default_classification,
        category.default_retention_class,
        ACTOR,
      ]
    );
  });
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('the D-18 identity-evidence category', () => {
  it('exists once as an active platform row with the identity purpose', async () => {
    expect(category.scope).toBe('platform');
    expect(category.tenant_id).toBeNull();
    expect(category.status).toBe('active');
    expect(category.deleted_at).toBeNull();
    expect(category.business_link_purpose).toBe('identity_document');
    // The restricted posture, the evidence-audit class, the ceiling and the media
    // are those of the existing identity-purpose row, so no posture is invented here.
    expect(category.default_classification).toBe('restricted');
    expect(category.default_retention_class).toBe('evidence-audit');
    expect(category.max_size_bytes).toBe('10485760');
    expect([...category.allowed_content_types].sort()).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(category.device_capture_timestamp_required).toBe(true);

    const count = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM shared.document_categories
        WHERE category_code = $1 AND deleted_at IS NULL`,
      [CATEGORY_CODE]
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('is its own category, not a reception category reused', async () => {
    expect(CATEGORY_CODE.startsWith('reception_')).toBe(false);
    // The reception identity-purpose row is still there and is a different row, so
    // the new category neither replaced nor renamed it.
    const reception = await admin.query<{ id: string }>(
      `SELECT id FROM shared.document_categories
        WHERE scope = 'platform' AND category_code = 'reception_vin' AND deleted_at IS NULL`
    );
    expect(reception.rows).toHaveLength(1);
    expect(reception.rows[0]?.id).not.toBe(category.id);
  });

  it('is readable by every tenant, like every platform category', async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      const visible = await withRolledBackTx(runtime, { tenantId, userId: ACTOR }, (c) =>
        c.query(`SELECT id FROM shared.document_categories WHERE category_code = $1`, [
          CATEGORY_CODE,
        ])
      );
      expect(visible.rows.map((r) => r.id)).toEqual([category.id]);
    }
  });

  it('cannot be created, changed or removed by the runtime role', async () => {
    const context = { tenantId: TENANT_A, userId: ACTOR };
    await withRolledBackTx(runtime, context, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.document_categories SET status = 'disabled' WHERE id = $1`, [
          category.id,
        ]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, context, (c) =>
      expectSqlState(
        c.query(`DELETE FROM shared.document_categories WHERE id = $1`, [category.id]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, context, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_categories
             (scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
              default_classification, default_retention_class, created_by,
              business_link_purpose)
           VALUES ('tenant',$1,'fx_identity_copy','x',ARRAY['image/png'],1,'public',
                   'temporary',$2,'identity_document')`,
          [TENANT_A, ACTOR]
        ),
        '42501'
      )
    );
  });

  it('grants no exemption from the scoped document-insert rule', async () => {
    // `ins_documents_scoped` requires `shared.document.manage` in the document's own
    // company and branch. A session holding no grant at all is refused filing under
    // this category exactly as it would be under any other.
    const stranger = '7e310000-0000-4000-8000-0000000000e1';
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: stranger }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, company_id, branch_id, category_id, title, classification,
              retention_class, created_by)
           VALUES ($1,$2,$3,$4,'refused identity evidence','restricted','evidence-audit',$5)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, category.id, stranger]
        ),
        '42501'
      )
    );
  });

  it('a document filed under it is isolated to its own tenant', async () => {
    const own = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT id, category_id FROM shared.documents WHERE id = $1`, [DOC_A])
    );
    expect(own.rows).toEqual([{ id: DOC_A, category_id: category.id }]);

    const foreign = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.documents WHERE id = $1`, [DOC_A])
    );
    expect(foreign.rows).toHaveLength(0);
  });
});
