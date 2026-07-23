/**
 * DBCR-P1-15-001 — tenant-safe shared-services runtime write capabilities.
 *
 * Migration `20260728090000_shared_services_runtime_write_capabilities.sql` gives
 * `app_runtime` the narrow synchronous writes P1-15 needs (document metadata,
 * pre-acceptance versions and links, notification enqueue, tenant template
 * administration) and gives `app_worker` the asynchronous surface it previously
 * had no privilege for at all (dispatch lifecycle, provider delivery evidence,
 * search projection).
 *
 * This suite proves the shape of that boundary in five directions:
 *
 *  1. **It works** — each granted capability succeeds for a principal holding the
 *     gating permission, executed on a real non-owner login.
 *  2. **It is gated** — the same statement without the permission is refused.
 *  3. **It cannot cross a tenant.**
 *  4. **It cannot be forged** — request code cannot manufacture a delivery
 *     result, a provider attempt, a search projection, or a scan verdict.
 *  5. **The withheld stay withheld** — the generic status tables, file scan
 *     results, and the worker-owned relations remain unwritable by the request
 *     role after the migration.
 *
 * Two denial shapes appear and the difference matters:
 *  - a missing privilege or a failed INSERT policy raises **42501**;
 *  - an UPDATE refused by a policy's USING clause matches no rows and raises
 *    nothing, so `rowCount === 0` is the only correct assertion there.
 *
 * The admin connection provisions fixtures and reads back. It carries BYPASSRLS
 * and is never evidence about runtime behaviour.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  readonlyPool,
  runtimePool,
  TENANT_A,
  TENANT_B,
  withRolledBackTx,
  workerPool,
} from './helpers';

const SYS = '00000000-0000-4000-8000-000000000001';

/** Fixture principals, distinct from every other suite's set. */
const DOC_ADMIN_A = 'a0000000-0000-4000-8000-0000000f1501';
const PLAIN_A = 'a0000000-0000-4000-8000-0000000f1502';
const DOC_ADMIN_B = 'b0000000-0000-4000-8000-0000000f1501';
const ROLE_DOC_A = 'a0000000-0000-4000-8000-0000000f15c1';
const ROLE_PLAIN_A = 'a0000000-0000-4000-8000-0000000f15c2';
const ROLE_DOC_B = 'b0000000-0000-4000-8000-0000000f15c1';

/** Fixture data owned by the admin connection. */
const CATEGORY_A = 'a0000000-0000-4000-8000-0000000f15d1';
const CATEGORY_B = 'b0000000-0000-4000-8000-0000000f15d1';
const DOC_A = 'a0000000-0000-4000-8000-0000000f15e1';
const DOC_B = 'b0000000-0000-4000-8000-0000000f15e1';
const TEMPLATE_PLATFORM = '00000000-0000-4000-8000-0000000f15f1';
const TPLVER_PLATFORM = '00000000-0000-4000-8000-0000000f15f2';
const TPLVER_PLATFORM_DRAFT = '00000000-0000-4000-8000-0000000f15f3';

/** Exactly the permissions this migration's policies gate on. */
const SHARED_PERMISSIONS = [
  'shared.document.manage',
  'shared.notification.send',
  'org.settings.manage',
] as const;

const AS_DOC_ADMIN_A = { tenantId: TENANT_A, userId: DOC_ADMIN_A, companyIds: [COMPANY_A1] };
const AS_PLAIN_A = { tenantId: TENANT_A, userId: PLAIN_A, companyIds: [COMPANY_A1] };
const AS_DOC_ADMIN_B = { tenantId: TENANT_B, userId: DOC_ADMIN_B };
const NO_CONTEXT = {};

let admin: Pool;
let runtime: Pool;
let readonly: Pool;
let worker: Pool;

type Q = { query: Client['query'] };

/** Rebuilds the shared-services fixtures. Admin connection — never RLS evidence. */
async function seedSharedFixtures(): Promise<void> {
  // The active-version pointer must be cleared before any version row can go:
  // fk_message_templates_active_version is ON DELETE RESTRICT by design.
  await admin.query(
    `UPDATE shared.message_templates SET active_version_id = NULL
      WHERE tenant_id = ANY($1::uuid[]) OR id = $2`,
    [[TENANT_A, TENANT_B], TEMPLATE_PLATFORM]
  );
  for (const table of [
    'shared.document_links',
    'shared.file_scan_results',
    'shared.document_versions',
    'shared.documents',
    'shared.document_categories',
    'shared.delivery_attempts',
    'shared.outbound_messages',
    'shared.template_versions',
    'shared.message_templates',
    'shared.search_metadata',
    'iam.role_grants',
    'iam.role_permissions',
    'iam.user_accounts',
    'iam.roles',
  ]) {
    await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [
      [TENANT_A, TENANT_B],
    ]);
  }
  await admin.query(`DELETE FROM shared.template_versions WHERE id = ANY($1::uuid[])`, [
    [TPLVER_PLATFORM, TPLVER_PLATFORM_DRAFT],
  ]);
  await admin.query(`DELETE FROM shared.message_templates WHERE id = $1`, [TEMPLATE_PLATFORM]);

  for (const [id, tenant, code, name] of [
    [ROLE_DOC_A, TENANT_A, 'fx_p15_doc', 'Fixture Shared-Services Role A'],
    [ROLE_PLAIN_A, TENANT_A, 'fx_p15_plain', 'Fixture Plain Role A'],
    [ROLE_DOC_B, TENANT_B, 'fx_p15_doc', 'Fixture Shared-Services Role B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, is_system, created_by)
       VALUES ($1, $2, $3, $4, false, $5)`,
      [id, tenant, code, name, SYS]
    );
  }

  for (const [id, tenant, subject, email, name] of [
    [DOC_ADMIN_A, TENANT_A, 'fx-p15-doc-a', 'fx-p15-doc-a@example.test', 'Fixture Doc Admin A'],
    [PLAIN_A, TENANT_A, 'fx-p15-plain-a', 'fx-p15-plain-a@example.test', 'Fixture Plain A'],
    [DOC_ADMIN_B, TENANT_B, 'fx-p15-doc-b', 'fx-p15-doc-b@example.test', 'Fixture Doc Admin B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, 'supabase', $3, $4, $5, 'active', $6)`,
      [id, tenant, subject, email, name, SYS]
    );
  }

  // Both shared-services roles carry the same permissions; the plain role none.
  for (const [role, tenant] of [
    [ROLE_DOC_A, TENANT_A],
    [ROLE_DOC_B, TENANT_B],
  ] as const) {
    for (const code of SHARED_PERMISSIONS) {
      await admin.query(
        `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
         SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = $4`,
        [tenant, role, SYS, code]
      );
    }
  }

  for (const [tenant, user, role] of [
    [TENANT_A, DOC_ADMIN_A, ROLE_DOC_A],
    [TENANT_A, PLAIN_A, ROLE_PLAIN_A],
    [TENANT_B, DOC_ADMIN_B, ROLE_DOC_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_grants
         (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
      [tenant, user, role, SYS]
    );
  }

  // Document categories are configuration, provisioned administratively.
  for (const [id, tenant] of [
    [CATEGORY_A, TENANT_A],
    [CATEGORY_B, TENANT_B],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
          default_classification, default_retention_class, created_by)
       VALUES ($1, 'tenant', $2, 'fx_p15_cat', 'Fixture Category',
               ARRAY['application/pdf']::text[], 1048576, 'internal', 'operational', $3)`,
      [id, tenant, SYS]
    );
  }

  // Pre-existing documents the runtime did NOT create, used as UPDATE targets.
  for (const [id, tenant, category] of [
    [DOC_A, TENANT_A, CATEGORY_A],
    [DOC_B, TENANT_B, CATEGORY_B],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.documents
         (id, tenant_id, company_id, branch_id, category_id, title, classification,
          retention_class, created_by)
       VALUES ($1, $2, NULL, NULL, $3, 'Fixture Document', 'internal', 'operational', $4)`,
      [id, tenant, category, SYS]
    );
  }

  // A PLATFORM template + approved version: tenant runtime must never mutate it,
  // and it is the only legal target for a cross-scope enqueue attempt.
  await admin.query(
    `INSERT INTO shared.message_templates
       (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, status, created_by)
     VALUES ($1, 'platform', NULL, 'fx_p15_platform', 'Fixture Platform Template',
             'email', 'transactional', 'en', 'active', $2)`,
    [TEMPLATE_PLATFORM, SYS]
  );
  // The lifecycle guard requires a version to be born an unstamped draft, so the
  // fixture creates it as a draft and then transitions it — exactly as any
  // legitimate writer must.
  await admin.query(
    `INSERT INTO shared.template_versions
       (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
     VALUES ($1, NULL, $2, 1, 'Fixture subject', 'Fixture body',
             decode(repeat('ab', 32), 'hex'), $3)`,
    [TPLVER_PLATFORM, TEMPLATE_PLATFORM, SYS]
  );
  await admin.query(
    `UPDATE shared.template_versions SET status = 'approved', approved_by = $2 WHERE id = $1`,
    [TPLVER_PLATFORM, SYS]
  );
  await admin.query(`UPDATE shared.message_templates SET active_version_id = $2 WHERE id = $1`, [
    TEMPLATE_PLATFORM,
    TPLVER_PLATFORM,
  ]);

  // A platform version left in DRAFT. The lifecycle guard permits draft content to
  // change, so this row isolates the POLICY layer: if tenant runtime can mutate it,
  // the lock policy is a write path. It must not be able to.
  await admin.query(
    `INSERT INTO shared.template_versions
       (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
     VALUES ($1, NULL, $2, 2, 'Draft subject', 'Draft body',
             decode(repeat('cd', 32), 'hex'), $3)`,
    [TPLVER_PLATFORM_DRAFT, TEMPLATE_PLATFORM, SYS]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  worker = workerPool();
});

afterAll(async () => {
  await admin.query(`UPDATE shared.message_templates SET active_version_id = NULL WHERE id = $1`, [
    TEMPLATE_PLATFORM,
  ]);
  await cleanFixtures(admin);
  await admin.query(`DELETE FROM shared.template_versions WHERE id = ANY($1::uuid[])`, [
    [TPLVER_PLATFORM, TPLVER_PLATFORM_DRAFT],
  ]);
  await admin.query(`DELETE FROM shared.message_templates WHERE id = $1`, [TEMPLATE_PLATFORM]);
  await Promise.all([runtime.end(), readonly.end(), worker.end()]);
  await admin.end();
});

beforeEach(async () => {
  await seedSharedFixtures();
});

// ---------------------------------------------------------------------------

describe('P1-15 / global security posture', () => {
  it('the repository declares exactly 119 migrations, with 118 and 119 last', () => {
    // Counted from the repository, not from `supabase_migrations.schema_migrations`:
    // that bookkeeping table is created by the Supabase CLI and does not exist in
    // CI, where the database is built by `npm run db:apply-migrations` against a
    // plain postgres image. The *applied* effect of migration 117 is proven by the
    // grant and policy inventory assertions below, which read the live catalog.
    //
    // 118 is DBCR-P1-15-002, the post-merge remediation for P1-15-SR-014. It
    // replaces two function bodies and adds no relation, grant or policy, so
    // every inventory assertion in this file is unchanged by it — which is the
    // point of asserting the count here rather than trusting the file list.
    // 119 is DBCR-P1-16-001, which grants app_runtime a CRM-customer-scoped write
    // surface on shared.notes; its two added policies are asserted below.
    const dir = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(files).toHaveLength(119);
    expect(files.at(-2)).toBe('20260729090000_shared_number_sequence_period_hardening.sql');
    expect(files.at(-1)).toBe('20260730090000_crm_customer_notes_write_capability.sql');
  });

  it('every relation touched by migration 117 keeps ENABLE and FORCE RLS', async () => {
    const { rows } = await admin.query<{ relname: string; e: boolean; f: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS e, c.relforcerowsecurity AS f
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'shared'
          AND c.relname = ANY($1::text[])`,
      [
        [
          'documents',
          'document_versions',
          'document_links',
          'outbound_messages',
          'delivery_attempts',
          'message_templates',
          'template_versions',
          'search_metadata',
        ],
      ]
    );
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(r.e, `${r.relname} ENABLE RLS`).toBe(true);
      expect(r.f, `${r.relname} FORCE RLS`).toBe(true);
    }
  });

  it('no application role is superuser, has BYPASSRLS, or can log in', async () => {
    const { rows } = await admin.query<{ rolname: string; s: boolean; b: boolean; l: boolean }>(
      `SELECT rolname, rolsuper AS s, rolbypassrls AS b, rolcanlogin AS l
         FROM pg_roles WHERE rolname IN ('app_runtime','app_worker','app_readonly')`
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.s, `${r.rolname} superuser`).toBe(false);
      expect(r.b, `${r.rolname} bypassrls`).toBe(false);
      expect(r.l, `${r.rolname} login`).toBe(false);
    }
  });

  it('application roles own no relation, schema, or function', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT (
         (SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
           WHERE r.rolname IN ('app_runtime','app_worker','app_readonly'))
       + (SELECT count(*) FROM pg_namespace ns JOIN pg_roles r ON r.oid = ns.nspowner
           WHERE r.rolname IN ('app_runtime','app_worker','app_readonly'))
       + (SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
           WHERE r.rolname IN ('app_runtime','app_worker','app_readonly'))
       )::text AS n`
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('migration 117 introduced no SECURITY DEFINER routine anywhere', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('iam','org','shared','crm','veh','apt','rec','wo','dia','tech',
                            'qms','svc','quo','inv','sal','wty','rpt')
          AND p.prosecdef`
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('app_readonly holds no privilege other than SELECT anywhere in shared', async () => {
    const { rows } = await admin.query<{ privilege_type: string }>(
      `SELECT DISTINCT privilege_type FROM information_schema.table_privileges
        WHERE table_schema = 'shared' AND grantee = 'app_readonly'`
    );
    expect(rows.map((r) => r.privilege_type).sort()).toEqual(['SELECT']);
  });

  it('no TRUNCATE, REFERENCES or TRIGGER privilege exists for any application role', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.table_privileges
        WHERE grantee IN ('app_runtime','app_worker','app_readonly')
          AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER')`
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('both new permission codes exist exactly once and the catalog totals 46', async () => {
    const { rows } = await admin.query<{ permission_code: string; n: string }>(
      `SELECT permission_code, count(*)::text AS n FROM iam.permissions
        WHERE permission_code IN ('shared.document.manage','shared.notification.send')
        GROUP BY permission_code ORDER BY permission_code`
    );
    expect(rows).toEqual([
      { permission_code: 'shared.document.manage', n: '1' },
      { permission_code: 'shared.notification.send', n: '1' },
    ]);
    // 45 platform permissions through DBCR-P1-15-001; DBCR-P1-16-001 adds the
    // first crm code, crm.customer.note.write, taking the catalog to 46.
    const total = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.permissions`
    );
    expect(Number(total.rows[0]?.n)).toBe(46);
  });

  it('the exact write-policy inventory of the whole shared schema is unchanged apart from migrations 117 and 119', async () => {
    const { rows } = await admin.query<{ polname: string }>(
      `SELECT p.polname FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'shared' AND p.polcmd <> 'r'
        ORDER BY p.polname`
    );
    expect(rows.map((r) => r.polname)).toEqual([
      // --- added by migration 117 ---
      'ins_document_links_scoped',
      'ins_document_versions_scoped',
      'ins_documents_scoped',
      // --- pre-existing (Phase 1-5 / DBCR-P1-13-001) ---
      'ins_event_outbox_producer',
      'ins_idempotency_keys_tenant',
      // --- added by migration 117 ---
      'ins_message_templates_tenant',
      // --- added by migration 119 (DBCR-P1-16-001) ---
      'ins_notes_crm_customer',
      // --- added by migration 117 ---
      'ins_outbound_messages_enqueue',
      'ins_template_versions_tenant',
      'lck_template_versions_reference',
      'upd_document_links_unlink',
      'upd_document_versions_reject',
      'upd_message_templates_tenant',
      // --- added by migration 119 (DBCR-P1-16-001) ---
      'upd_notes_crm_customer',
      // --- pre-existing ---
      'upd_number_sequences_tenant',
      // --- added by migration 117 ---
      'upd_template_versions_tenant',
      'wkr_delivery_attempts_all',
      // --- pre-existing ---
      'wkr_error_records_all',
      'wkr_event_outbox_all',
      // --- added by migration 117 ---
      'wkr_outbound_messages_dispatch',
      // --- pre-existing ---
      'wkr_processed_events_all',
      // --- added by migration 117 ---
      'wkr_search_metadata_all',
    ]);
  });

  it('no app_runtime or app_readonly write policy uses a bare true predicate', async () => {
    const { rows } = await admin.query<{ polname: string }>(
      `SELECT p.polname FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'shared' AND p.polcmd <> 'r'
          AND EXISTS (SELECT 1 FROM pg_roles r
                       WHERE r.oid = ANY(p.polroles)
                         AND r.rolname IN ('app_runtime','app_readonly'))
          AND (pg_get_expr(p.polqual, p.polrelid) = 'true'
            OR pg_get_expr(p.polwithcheck, p.polrelid) = 'true')`
    );
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 / documents — request runtime', () => {
  it('an authorized principal creates document metadata', async () => {
    const inserted = await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      const r = await c.query(
        `INSERT INTO shared.documents
           (tenant_id, category_id, title, classification, retention_class, created_by)
         VALUES ($1, $2, 'Runtime created', 'internal', 'operational', $3) RETURNING id`,
        [TENANT_A, CATEGORY_A, DOC_ADMIN_A]
      );
      return r.rowCount;
    });
    expect(inserted).toBe(1);
  });

  it('a principal without shared.document.manage is refused', async () => {
    await withRolledBackTx(runtime, AS_PLAIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1, $2, 'Denied', 'internal', 'operational', $3)`,
          [TENANT_A, CATEGORY_A, PLAIN_A]
        ),
        '42501'
      );
    });
  });

  it('a tenant-B administrator cannot create a document in tenant A', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_B, async (c: Q) => {
      // Two independent controls refuse this. `guard_document_category_scope`
      // runs BEFORE INSERT and cannot see tenant A's category through tenant B's
      // RLS view, so it raises 23503 first; the ins_documents_scoped policy would
      // refuse with 42501 immediately after. Either shape is a correct denial.
      await expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1, $2, 'Cross tenant', 'internal', 'operational', $3)`,
          [TENANT_A, CATEGORY_A, DOC_ADMIN_B]
        ),
        '42501',
        '23503'
      );
    });
  });

  it('authorship cannot be forged — created_by must be the acting user', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1, $2, 'Forged author', 'internal', 'operational', $3)`,
          [TENANT_A, CATEGORY_A, PLAIN_A]
        ),
        '42501'
      );
    });
  });

  it('with no session context at all, the insert is refused', async () => {
    await withRolledBackTx(runtime, NO_CONTEXT, async (c: Q) => {
      // With no tenant context `iam.current_tenant_id()` is NULL, so the category
      // is invisible to the BEFORE-INSERT scope guard (23503) and the policy
      // comparison matches nothing (42501). Both are default-deny.
      await expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, category_id, title, classification, retention_class, created_by)
           VALUES ($1, $2, 'No context', 'internal', 'operational', $3)`,
          [TENANT_A, CATEGORY_A, DOC_ADMIN_A]
        ),
        '42501',
        '23503'
      );
    });
  });

  it('the request role holds no UPDATE privilege on documents at all', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.column_privileges
        WHERE table_schema = 'shared' AND table_name = 'documents'
          AND grantee = 'app_runtime' AND privilege_type = 'UPDATE'`
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('the request role cannot DELETE a document', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(c.query(`DELETE FROM shared.documents WHERE id = $1`, [DOC_A]), '42501');
    });
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 / document versions and the file-scan trust boundary', () => {
  it('a pre-acceptance version is created in the pending state', async () => {
    const status = await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      const r = await c.query<{ status: string }>(
        `INSERT INTO shared.document_versions
           (tenant_id, document_id, version_number, storage_key, content_type,
            size_bytes, sha256, uploaded_by, created_by)
         VALUES ($1, $2, 1, 'tenant-a/fx/1', 'application/pdf', 1024, decode(repeat('bb', 32), 'hex'), $3, $3)
         RETURNING status`,
        [TENANT_A, DOC_A, DOC_ADMIN_A]
      );
      return r.rows[0]?.status;
    });
    expect(status).toBe('pending');
  });

  it('a version cannot be attached to another tenant document', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.document_versions
             (tenant_id, document_id, version_number, storage_key, content_type,
              size_bytes, sha256, uploaded_by, created_by)
           VALUES ($1, $2, 1, 'x/1', 'application/pdf', 10, decode(repeat('cb', 32), 'hex'), $3, $3)`,
          [TENANT_A, DOC_B, DOC_ADMIN_A]
        ),
        '42501',
        '23503'
      );
    });
  });

  it('NO role may write shared.file_scan_results — the verdict cannot be manufactured', async () => {
    for (const [pool, ctx] of [
      [runtime, AS_DOC_ADMIN_A],
      [worker, {}],
      [readonly, AS_DOC_ADMIN_A],
    ] as const) {
      await withRolledBackTx(pool as Pool, ctx, async (c: Q) => {
        await expectSqlState(
          c.query(
            `INSERT INTO shared.file_scan_results
               (tenant_id, version_id, scan_status, scanner_code, created_by)
             VALUES ($1, gen_random_uuid(), 'clean', 'fake', $2)`,
            [TENANT_A, DOC_ADMIN_A]
          ),
          '42501'
        );
      });
    }
  });

  it('no application role holds any privilege on shared.file_scan_results beyond SELECT', async () => {
    const { rows } = await admin.query<{ privilege_type: string }>(
      `SELECT DISTINCT privilege_type FROM information_schema.table_privileges
        WHERE table_schema = 'shared' AND table_name = 'file_scan_results'
          AND grantee IN ('app_runtime','app_worker','app_readonly')`
    );
    expect(rows.map((r) => r.privilege_type).sort()).toEqual(['SELECT']);
  });

  it('acceptance is refused because no clean scan exists — the scanner gate holds', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      const v = await c.query<{ id: string }>(
        `INSERT INTO shared.document_versions
           (tenant_id, document_id, version_number, storage_key, content_type,
            size_bytes, sha256, uploaded_by, created_by)
         VALUES ($1, $2, 1, 'tenant-a/fx/2', 'application/pdf', 10, decode(repeat('db', 32), 'hex'), $3, $3)
         RETURNING id`,
        [TENANT_A, DOC_A, DOC_ADMIN_A]
      );
      // guard_document_version_transition fires before the policy is reached and
      // refuses outright: there is no scanner in this phase, so no clean verdict
      // can exist, so no version can be accepted.
      await expectSqlState(
        c.query(`UPDATE shared.document_versions SET status = 'accepted' WHERE id = $1`, [
          v.rows[0]?.id,
        ]),
        '23514',
        'P0001'
      );
    });
  });

  it('the request role may move a pending version to rejected', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      const v = await c.query<{ id: string }>(
        `INSERT INTO shared.document_versions
           (tenant_id, document_id, version_number, storage_key, content_type,
            size_bytes, sha256, uploaded_by, created_by)
         VALUES ($1, $2, 1, 'tenant-a/fx/3', 'application/pdf', 10, decode(repeat('db', 32), 'hex'), $3, $3)
         RETURNING id`,
        [TENANT_A, DOC_A, DOC_ADMIN_A]
      );
      const rejected = await c.query(
        `UPDATE shared.document_versions SET status = 'rejected' WHERE id = $1`,
        [v.rows[0]?.id]
      );
      expect(rejected.rowCount).toBe(1);
    });
  });

  it('guard_document_version_transition is still installed and unmodified', async () => {
    const { rows } = await admin.query<{ tgname: string }>(
      `SELECT t.tgname FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'shared' AND c.relname = 'document_versions'
          AND NOT t.tgisinternal AND t.tgname = 'tg_document_versions_guard_transition'`
    );
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 / notification enqueue and the delivery boundary', () => {
  it('an authorized principal enqueues a message in the pending state', async () => {
    const status = await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      const r = await c.query<{ status: string }>(
        `INSERT INTO shared.outbound_messages
           (tenant_id, template_version_id, channel, purpose, recipient_digest,
            body_sha256, dedupe_key, created_by)
         VALUES ($1, $2, 'email', 'transactional', decode(repeat('eb', 32), 'hex'), decode(repeat('fb', 32), 'hex'),
                 'fx-p15-dedupe-1', $3)
         RETURNING status`,
        [TENANT_A, TPLVER_PLATFORM, DOC_ADMIN_A]
      );
      return r.rows[0]?.status;
    });
    expect(status).toBe('pending');
  });

  it('a principal without shared.notification.send is refused', async () => {
    await withRolledBackTx(runtime, AS_PLAIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.outbound_messages
             (tenant_id, template_version_id, channel, purpose, recipient_digest,
              body_sha256, dedupe_key, created_by)
           VALUES ($1, $2, 'email', 'transactional', decode(repeat('eb', 32), 'hex'), decode(repeat('fb', 32), 'hex'),
                   'fx-p15-dedupe-2', $3)`,
          [TENANT_A, TPLVER_PLATFORM, PLAIN_A]
        ),
        '42501'
      );
    });
  });

  it('the request role cannot forge a delivered status — no UPDATE privilege exists', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.column_privileges
        WHERE table_schema = 'shared' AND table_name = 'outbound_messages'
          AND grantee = 'app_runtime' AND privilege_type = 'UPDATE'`
    );
    expect(Number(rows[0]?.n)).toBe(0);

    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(`UPDATE shared.outbound_messages SET status = 'delivered' WHERE tenant_id = $1`, [
          TENANT_A,
        ]),
        '42501'
      );
    });
  });

  it('the request role cannot write provider delivery evidence', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status, created_by)
           VALUES ($1, gen_random_uuid(), 1, 'forged_provider', 'delivered', $2)`,
          [TENANT_A, DOC_ADMIN_A]
        ),
        '42501'
      );
    });
  });

  it('the worker records a delivery attempt and advances the message lifecycle', async () => {
    // The message is committed by the admin fixture so the worker has a target.
    const messageId = 'a0000000-0000-4000-8000-0000000f15a1';
    await admin.query(
      `INSERT INTO shared.outbound_messages
         (id, tenant_id, template_version_id, channel, purpose, recipient_digest,
          body_sha256, dedupe_key, created_by)
       VALUES ($1, $2, $3, 'email', 'transactional', decode(repeat('eb', 32), 'hex'), decode(repeat('fb', 32), 'hex'),
               'fx-p15-worker', $4)`,
      [messageId, TENANT_A, TPLVER_PLATFORM, SYS]
    );
    try {
      await withRolledBackTx(worker, {}, async (c: Q) => {
        const attempt = await c.query(
          `INSERT INTO shared.delivery_attempts
             (tenant_id, message_id, attempt_number, provider_code, status, created_by)
           VALUES ($1, $2, 1, 'fake_provider', 'started', $3)`,
          [TENANT_A, messageId, SYS]
        );
        expect(attempt.rowCount).toBe(1);

        const moved = await c.query(
          `UPDATE shared.outbound_messages SET status = 'queued' WHERE id = $1`,
          [messageId]
        );
        expect(moved.rowCount).toBe(1);
      });
    } finally {
      await admin.query(`DELETE FROM shared.outbound_messages WHERE id = $1`, [messageId]);
    }
  });

  it('delivery attempts are append-only — the worker holds no UPDATE or DELETE', async () => {
    // The INSERT grant is column-scoped, so it appears in column_privileges and
    // deliberately NOT as a table-level privilege. Both are asserted.
    const cols = await admin.query<{ privilege_type: string }>(
      `SELECT DISTINCT privilege_type FROM information_schema.column_privileges
        WHERE table_schema = 'shared' AND table_name = 'delivery_attempts'
          AND grantee = 'app_worker'`
    );
    expect(cols.rows.map((r) => r.privilege_type).sort()).toEqual(['INSERT', 'SELECT']);

    const tbl = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.table_privileges
        WHERE table_schema = 'shared' AND table_name = 'delivery_attempts'
          AND privilege_type IN ('UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
          AND grantee IN ('app_runtime','app_worker','app_readonly')`
    );
    expect(Number(tbl.rows[0]?.n)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 / tenant template administration', () => {
  it('an authorized principal creates a tenant-scoped template', async () => {
    const inserted = await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      const r = await c.query(
        `INSERT INTO shared.message_templates
           (scope, tenant_id, template_code, name, channel, purpose, locale_code, created_by)
         VALUES ('tenant', $1, 'fx_p15_tenant_tpl', 'Tenant Template', 'email',
                 'transactional', 'en', $2)`,
        [TENANT_A, DOC_ADMIN_A]
      );
      return r.rowCount;
    });
    expect(inserted).toBe(1);
  });

  it('tenant runtime cannot create a PLATFORM-scoped template', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.message_templates
             (scope, tenant_id, template_code, name, channel, purpose, locale_code, created_by)
           VALUES ('platform', NULL, 'fx_p15_forged_platform', 'Forged', 'email',
                   'transactional', 'en', $1)`,
          [DOC_ADMIN_A]
        ),
        '42501'
      );
    });
  });

  it('tenant runtime cannot mutate the existing platform template', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      const r = await c.query(
        `UPDATE shared.message_templates SET name = 'Hijacked' WHERE id = $1`,
        [TEMPLATE_PLATFORM]
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it('a principal without org.settings.manage cannot create a template', async () => {
    await withRolledBackTx(runtime, AS_PLAIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.message_templates
             (scope, tenant_id, template_code, name, channel, purpose, locale_code, created_by)
           VALUES ('tenant', $1, 'fx_p15_denied_tpl', 'Denied', 'email',
                   'transactional', 'en', $2)`,
          [TENANT_A, PLAIN_A]
        ),
        '42501'
      );
    });
  });

  it('tenant runtime cannot insert a platform (null-tenant) template version', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.template_versions
             (tenant_id, template_id, version_number, subject, body, content_hash, created_by)
           VALUES (NULL, $1, 2, 's', 'b', decode(repeat('ab', 32), 'hex'), $2)`,
          [TEMPLATE_PLATFORM, DOC_ADMIN_A]
        ),
        '42501'
      );
    });
  });

  // Adversarial regression for finding P1-15-R-001. lck_template_versions_reference
  // deliberately admits a platform row into the USING clause so the enqueue guard's
  // FOR SHARE lock can resolve it. This proves that widening cannot be turned into
  // a write: the policy's WITH CHECK is false, the only other check demands
  // tenant ownership, and tenant_id is not grantable on UPDATE.
  it('an approved platform version is immutable — the lifecycle guard refuses', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(`UPDATE shared.template_versions SET subject = 'hijacked' WHERE id = $1`, [
          TPLVER_PLATFORM,
        ]),
        '23514',
        'P0001'
      );
    });
  });

  it('the lock policy cannot be used to mutate a DRAFT platform version', async () => {
    // The lifecycle guard permits draft content to change, so the only thing
    // standing between tenant runtime and this row is the policy layer — and it
    // refuses explicitly. lck_template_versions_reference admits the row into
    // USING (that is its whole purpose: the enqueue guard must be able to take a
    // FOR SHARE lock on it), but contributes WITH CHECK false, and the only other
    // check demands tenant ownership this row cannot have. The write therefore
    // fails the row-level security check outright rather than silently matching
    // nothing, which is the stronger of the two denial shapes.
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(`UPDATE shared.template_versions SET subject = 'hijacked' WHERE id = $1`, [
          TPLVER_PLATFORM_DRAFT,
        ]),
        '42501'
      );
    });
    const after = await admin.query<{ subject: string }>(
      `SELECT subject FROM shared.template_versions WHERE id = $1`,
      [TPLVER_PLATFORM_DRAFT]
    );
    expect(after.rows[0]?.subject).toBe('Draft subject');
  });

  it('a platform template version cannot be re-tenanted into the caller tenant', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      // tenant_id is absent from the UPDATE column grant, so this is refused at
      // the privilege layer before any policy is consulted.
      await expectSqlState(
        c.query(`UPDATE shared.template_versions SET tenant_id = $2 WHERE id = $1`, [
          TPLVER_PLATFORM,
          TENANT_A,
        ]),
        '42501'
      );
    });
  });

  it('scope and tenant_id are not updatable — a tenant row cannot be promoted', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE table_schema = 'shared' AND table_name = 'message_templates'
          AND grantee = 'app_runtime' AND privilege_type = 'UPDATE'
        ORDER BY column_name`
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'active_version_id',
      'deleted_at',
      'description',
      'name',
      'status',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 / search projection is worker-owned', () => {
  it('the worker creates a projection row', async () => {
    const inserted = await withRolledBackTx(worker, {}, async (c: Q) => {
      const r = await c.query(
        `INSERT INTO shared.search_metadata
           (tenant_id, entity_type, entity_id, field_code, locale_code,
            normalized_value, classification, source_updated_at, created_by)
         VALUES ($1, 'fx.entity', gen_random_uuid(), 'name', 'en',
                 'normalized value', 'internal', now(), $2)`,
        [TENANT_A, SYS]
      );
      return r.rowCount;
    });
    expect(inserted).toBe(1);
  });

  it('the request role cannot insert a projection', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.search_metadata
             (tenant_id, entity_type, entity_id, field_code, locale_code,
              normalized_value, classification, source_updated_at, created_by)
           VALUES ($1, 'fx.other', gen_random_uuid(), 'f', 'en', 'v', 'internal', now(), $2)`,
          [TENANT_A, DOC_ADMIN_A]
        ),
        '42501'
      );
    });
  });

  it('the request role cannot update a projection', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(`UPDATE shared.search_metadata SET normalized_value = 'x'`),
        '42501'
      );
    });
  });

  it('identity columns are excluded from the worker UPDATE grant', async () => {
    const { rows } = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE table_schema = 'shared' AND table_name = 'search_metadata'
          AND grantee = 'app_worker' AND privilege_type = 'UPDATE'
        ORDER BY column_name`
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'classification',
      'normalized_value',
      'source_updated_at',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('P1-15 / deliberately withheld relations stay withheld', () => {
  it('the request role still cannot write shared.status_history', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.status_history
             (tenant_id, entity_type, entity_id, from_state, to_state, reason, actor_id)
           VALUES ($1, 'work_order', gen_random_uuid(), 'open', 'completed', 'forged', $2)`,
          [TENANT_A, DOC_ADMIN_A]
        ),
        '42501'
      );
    });
  });

  it('the request role still cannot write shared.status_evidence', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.status_evidence
             (tenant_id, status_history_id, evidence_type, evidence_ref, created_by)
           VALUES ($1, gen_random_uuid(), 'doc', 'ref', $2)`,
          [TENANT_A, DOC_ADMIN_A]
        ),
        '42501'
      );
    });
  });

  it('the worker also cannot write the generic status tables', async () => {
    await withRolledBackTx(worker, {}, async (c: Q) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.status_history
             (tenant_id, entity_type, entity_id, from_state, to_state, reason, actor_id)
           VALUES ($1, 'x', gen_random_uuid(), 'a', 'b', 'r', $2)`,
          [TENANT_A, SYS]
        ),
        '42501'
      );
    });
  });

  it('no application role holds any write privilege on either status table', async () => {
    const { rows } = await admin.query<{ privilege_type: string }>(
      `SELECT DISTINCT privilege_type FROM information_schema.table_privileges
        WHERE table_schema = 'shared'
          AND table_name IN ('status_history','status_evidence')
          AND grantee IN ('app_runtime','app_worker','app_readonly')`
    );
    expect(rows.map((r) => r.privilege_type).sort()).toEqual(['SELECT']);
  });

  it('the worker-owned error and processed-event contracts are unchanged', async () => {
    const { rows } = await admin.query<{ table_name: string; privs: string }>(
      `SELECT table_name, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'shared'
          AND table_name IN ('error_records','processed_events')
          AND grantee = 'app_worker'
        GROUP BY table_name ORDER BY table_name`
    );
    expect(rows).toEqual([
      { table_name: 'error_records', privs: 'INSERT,SELECT,UPDATE' },
      { table_name: 'processed_events', privs: 'INSERT,SELECT' },
    ]);
  });

  it('the request role still cannot write error records', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(c.query(`INSERT INTO shared.error_records DEFAULT VALUES`), '42501');
    });
  });

  it('the request role still cannot write processed events', async () => {
    await withRolledBackTx(runtime, AS_DOC_ADMIN_A, async (c: Q) => {
      await expectSqlState(c.query(`INSERT INTO shared.processed_events DEFAULT VALUES`), '42501');
    });
  });

  it('app_readonly cannot write any shared-services relation', async () => {
    for (const table of [
      'documents',
      'document_versions',
      'document_links',
      'outbound_messages',
      'message_templates',
      'template_versions',
      'search_metadata',
    ]) {
      await withRolledBackTx(readonly, AS_DOC_ADMIN_A, async (c: Q) => {
        await expectSqlState(c.query(`INSERT INTO shared.${table} DEFAULT VALUES`), '42501');
      });
    }
  });
});
