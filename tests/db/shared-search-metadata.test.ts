/**
 * Phase 1-5 Increment J — tenant-scoped search projections
 * (P1-05-DB-016, P1-05-QA-006 partial).
 *
 * Admin creates projection and IAM fixtures. Every visibility and write-denial
 * assertion runs through the non-owner runtime login under transaction-local
 * tenant/user context.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  withRolledBackTx,
} from './helpers';

const PERMISSION_ID = 'e9000000-0000-4000-8000-000000000001';
const ROLE_ID = 'd9000000-0000-4000-8000-000000000001';
const GRANT_ID = 'c9000000-0000-4000-8000-000000000001';
const USER_WITH_PERMISSION = 'a9000000-0000-4000-8000-000000000001';
const USER_WITHOUT_PERMISSION = 'a9000000-0000-4000-8000-000000000002';
const ENTITY_A = 'a9000000-0000-4000-8000-000000000101';
const ENTITY_B = 'b9000000-0000-4000-8000-000000000101';
const RESTRICTED_ENTITY = 'a9000000-0000-4000-8000-000000000102';

let admin: Pool;
let runtime: Pool;

async function seedSensitivePermissionFixture(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.permissions
       (id, permission_code, domain, description, risk_level, created_by)
     VALUES ($1, 'iam.sensitive.view', 'iam', 'View sensitive fixture rows', 'high', $2)
     ON CONFLICT (permission_code) DO NOTHING`,
    [PERMISSION_ID, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'sensitive_viewer', 'Sensitive viewer fixture', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_ID, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES
       ($1, $3, 'supabase', 'search-sensitive-user', 'search-sensitive@example.test',
        'Search sensitive user', 'active', $4),
       ($2, $3, 'supabase', 'search-ordinary-user', 'search-ordinary@example.test',
        'Search ordinary user', 'active', $4)
     ON CONFLICT (id) DO NOTHING`,
    [USER_WITH_PERMISSION, USER_WITHOUT_PERMISSION, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions
       (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3
       FROM iam.permissions
      WHERE permission_code = 'iam.sensitive.view'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_ID, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (id, tenant_id, user_id, role_id, granted_by, created_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (id) DO NOTHING`,
    [GRANT_ID, TENANT_A, USER_WITH_PERMISSION, ROLE_ID, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedSensitivePermissionFixture();

  await admin.query(
    `INSERT INTO shared.search_metadata
       (tenant_id, entity_type, entity_id, field_code, locale_code,
        normalized_value, classification, source_updated_at, created_by)
     VALUES
       ($1, 'crm.customers', $2, 'display_name', 'en',
        'premium brake service customer', 'public', now(), $6),
       ($3, 'crm.customers', $4, 'display_name', 'en',
        'tenant b private customer', 'internal', now(), $6),
       ($1, 'crm.customers', $5, 'private_note', NULL,
        'restricted search phrase', 'restricted', now(), $6)`,
    [TENANT_A, ENTITY_A, TENANT_B, ENTITY_B, RESTRICTED_ENTITY, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.query(`DELETE FROM iam.permissions WHERE permission_code = 'iam.sensitive.view'`);
  await runtime.end();
  await admin.end();
});

describe('shared.search_metadata — identity, upsert, and scope integrity', () => {
  it('uses the locale-inclusive identity as an explicit ON CONFLICT upsert target', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const entity = crypto.randomUUID();
      const sql = `INSERT INTO shared.search_metadata
        (tenant_id, entity_type, entity_id, field_code, locale_code,
         normalized_value, classification, source_updated_at, created_by)
        VALUES ($1, 'crm.vehicles', $2, 'search_label', 'en', $3, 'internal', now(), $4)
        ON CONFLICT (tenant_id, entity_type, entity_id, field_code, locale_code)
        DO UPDATE SET normalized_value = EXCLUDED.normalized_value,
                      source_updated_at = EXCLUDED.source_updated_at
        RETURNING id, normalized_value, record_version`;
      const first = await c.query(sql, [TENANT_A, entity, 'first normalized value', USER_A]);
      const second = await c.query(sql, [TENANT_A, entity, 'updated normalized value', USER_A]);
      expect(second.rows[0].id).toBe(first.rows[0].id);
      expect(second.rows[0].normalized_value).toBe('updated normalized value');
      expect(second.rows[0].record_version).toBe(2);
    });
  });

  it('rejects a duplicate non-null-locale identity with 23505', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const entity = crypto.randomUUID();
      const sql = `INSERT INTO shared.search_metadata
        (tenant_id, entity_type, entity_id, field_code, locale_code,
         normalized_value, source_updated_at, created_by)
        VALUES ($1, 'crm.vehicles', $2, 'search_label', 'en', $3, now(), $4)`;
      await c.query(sql, [TENANT_A, entity, 'one', USER_A]);
      await expectSqlState(c.query(sql, [TENANT_A, entity, 'two', USER_A]), '23505');
    });
  });

  it('treats two NULL locales as identical through NULLS NOT DISTINCT', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const entity = crypto.randomUUID();
      const sql = `INSERT INTO shared.search_metadata
        (tenant_id, entity_type, entity_id, field_code, locale_code,
         normalized_value, source_updated_at, created_by)
        VALUES ($1, 'crm.vehicles', $2, 'search_label', NULL, $3, now(), $4)`;
      await c.query(sql, [TENANT_A, entity, 'one', USER_A]);
      await expectSqlState(c.query(sql, [TENANT_A, entity, 'two', USER_A]), '23505');
    });
  });

  it('rejects a company from another tenant with 23503', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.search_metadata
          (tenant_id, company_id, entity_type, entity_id, field_code,
           normalized_value, source_updated_at, created_by)
         VALUES ($1, $2, 'crm.customers', gen_random_uuid(), 'display_name',
                 'cross tenant company', now(), $3)`,
        [TENANT_B, COMPANY_A1, USER_A]
      ),
      '23503'
    );
  });

  it('rejects an unregistered locale with 23503', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.search_metadata
          (tenant_id, entity_type, entity_id, field_code, locale_code,
           normalized_value, source_updated_at, created_by)
         VALUES ($1, 'crm.customers', gen_random_uuid(), 'display_name', 'zz-invalid',
                 'invalid locale', now(), $2)`,
        [TENANT_A, USER_A]
      ),
      '23503'
    );
  });
});

describe('shared.search_metadata — trigram projection lookup', () => {
  it('supports functional trigram and ILIKE matching', async () => {
    const trigram = await admin.query(
      `SELECT entity_id FROM shared.search_metadata
       WHERE normalized_value OPERATOR(extensions.%) $1`,
      ['premium brake service']
    );
    expect(trigram.rows.map((r) => r.entity_id)).toContain(ENTITY_A);

    const ilike = await admin.query(
      `SELECT entity_id FROM shared.search_metadata WHERE normalized_value ILIKE $1`,
      ['%brake service%']
    );
    expect(ilike.rows.map((r) => r.entity_id)).toContain(ENTITY_A);
  });

  it('registers the schema-qualified GIN trigram index', async () => {
    const { rows } = await admin.query(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname='shared'
         AND tablename='search_metadata'
         AND indexname='ix_search_metadata_normalized_value_trgm'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('USING gin');
    expect(rows[0].indexdef).toContain('gin_trgm_ops');
  });
});

describe('shared.search_metadata — RLS and sensitive-read gate', () => {
  it('isolates tenant A and B rows under runtime context', async () => {
    const a = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_WITHOUT_PERMISSION },
      (c) => c.query(`SELECT entity_id FROM shared.search_metadata ORDER BY entity_id`)
    );
    expect(a.rows.map((r) => r.entity_id)).toEqual([ENTITY_A]);

    const b = await withRolledBackTx(runtime, { tenantId: TENANT_B }, (c) =>
      c.query(`SELECT entity_id FROM shared.search_metadata ORDER BY entity_id`)
    );
    expect(b.rows.map((r) => r.entity_id)).toEqual([ENTITY_B]);
  });

  it('hides a restricted same-tenant row without iam.sensitive.view', async () => {
    const result = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_WITHOUT_PERMISSION },
      (c) =>
        c.query(`SELECT id FROM shared.search_metadata WHERE entity_id=$1`, [RESTRICTED_ENTITY])
    );
    expect(result.rows).toEqual([]);
  });

  it('shows the same restricted row with iam.sensitive.view', async () => {
    const result = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_WITH_PERMISSION },
      (c) =>
        c.query(`SELECT id FROM shared.search_metadata WHERE entity_id=$1`, [RESTRICTED_ENTITY])
    );
    expect(result.rows).toHaveLength(1);
  });

  it('denies runtime writes with 42501', async () => {
    await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_WITH_PERMISSION },
      async (c) => {
        await expectSqlState(
          c.query(
            `INSERT INTO shared.search_metadata
              (tenant_id, entity_type, entity_id, field_code, normalized_value,
               source_updated_at, created_by)
             VALUES ($1, 'crm.customers', gen_random_uuid(), 'display_name',
                     'runtime write', now(), $2)`,
            [TENANT_A, USER_WITH_PERMISSION]
          ),
          '42501'
        );
      }
    );
  });
});
