/**
 * Phase 1-5 Increment L — shared-services hardening evidence
 * (P1-05-DB-019/020, P1-05-SEC-001..005).
 *
 * Proves the exact routine, role, schema, RLS, and fix-forward integrity
 * boundaries after all 32 migrations have been applied.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  TENANT_A,
  USER_A,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const CATEGORY = 'df000000-0000-4000-8000-000000000001';
const DOCUMENT = 'df000000-0000-4000-8000-000000000002';
const COMPANY_A2 = 'af000000-0000-4000-8000-000000000002';
const BRANCH_A2 = 'af100000-0000-4000-8000-000000000002';

const MODULE_SCHEMAS = ['apt', 'crm', 'iam', 'org', 'rec', 'shared', 'veh'];
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
/** Every table privilege PostgreSQL can grant, so nothing hides outside the four. */
const ALL_TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
];

let admin: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  await withCommittedTx(admin, {}, async (c) => {
    await c.query(
      `INSERT INTO org.legal_companies
         (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
       VALUES ($1,$2,'company_a2','Fixture Company A2','USD',$3)`,
      [COMPANY_A2, TENANT_A, USER_A]
    );
    await c.query(
      `INSERT INTO org.branches
         (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
       VALUES ($1,$2,$3,'branch_a2','Fixture Branch A2','UTC',$4)`,
      [BRANCH_A2, TENANT_A, COMPANY_A2, USER_A]
    );
    await c.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types,
          max_size_bytes, default_classification, default_retention_class, created_by)
       VALUES ($1,'platform',NULL,'fx_hardening','Hardening fixture',
               ARRAY['application/pdf'],1048576,'internal','operational',$2)`,
      [CATEGORY, USER_A]
    );
    await c.query(
      `INSERT INTO shared.documents
         (id, tenant_id, category_id, title, classification, retention_class, created_by)
       VALUES ($1,$2,$3,'Hardening base document','internal','operational',$4)`,
      [DOCUMENT, TENANT_A, CATEGORY, USER_A]
    );
  });
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
});

describe('module security posture', () => {
  it('keeps every module routine SECURITY INVOKER with an explicit empty search_path', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || p.proname ||
                '(' || pg_get_function_identity_arguments(p.oid) || ')' AS routine,
              p.prosecdef,
              p.proconfig
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = ANY($1::text[])
         AND (
           p.prosecdef
           OR NOT EXISTS (
             SELECT 1
             FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
             WHERE cfg IN ('search_path=', 'search_path=""')
           )
         )
       ORDER BY 1`,
      [MODULE_SCHEMAS]
    );
    const violations = rows.map(
      (r) => `${r.routine}: prosecdef=${r.prosecdef}, proconfig=${JSON.stringify(r.proconfig)}`
    );
    expect(violations, `Unsafe module routines:\n${violations.join('\n')}`).toEqual([]);
  });

  /**
   * The four foundation surfaces after DBCR-P1-13-001. `app_runtime` gained an
   * append path and nothing else; `app_readonly` gained nothing at all. This is
   * an EXACT map — a privilege that appears here and not in the migration, or
   * vice versa, fails the test.
   */
  const FOUNDATION_SURFACE: Readonly<Record<string, Readonly<Record<string, string[]>>>> = {
    app_runtime: {
      'shared.idempotency_keys': ['INSERT', 'SELECT'],
      'shared.event_outbox': ['INSERT', 'SELECT'],
      'shared.processed_events': [],
      'shared.error_records': [],
      'iam.audit_records': ['INSERT', 'SELECT'],
      'iam.audit_record_details': ['INSERT', 'SELECT'],
      'iam.audit_integrity_links': ['INSERT', 'SELECT'],
      'iam.security_events': ['INSERT', 'SELECT'],
    },
    app_readonly: {
      'shared.idempotency_keys': [],
      'shared.event_outbox': [],
      'shared.processed_events': [],
      'shared.error_records': [],
      'iam.audit_records': ['SELECT'],
      'iam.audit_record_details': ['SELECT'],
      'iam.audit_integrity_links': ['SELECT'],
      'iam.security_events': ['SELECT'],
    },
  };

  it('gives runtime and readonly EXACTLY the approved foundation privilege surface', async () => {
    for (const [role, tables] of Object.entries(FOUNDATION_SURFACE)) {
      for (const [table, expected] of Object.entries(tables)) {
        const held: string[] = [];
        for (const privilege of ALL_TABLE_PRIVILEGES) {
          const { rows } = await admin.query(`SELECT has_table_privilege($1, $2, $3) AS allowed`, [
            role,
            table,
            privilege,
          ]);
          if (rows[0].allowed) held.push(privilege);
        }
        expect(held.sort(), `${role} privilege surface on ${table}`).toEqual([...expected].sort());
      }
    }
  });

  it('never lets an application role mutate or remove audit, outbox, or idempotency rows', async () => {
    // Append-only is the security property: the runtime may add evidence, and
    // may never edit or erase it. TRUNCATE would erase a whole table at once, so
    // it is checked alongside UPDATE and DELETE rather than assumed absent.
    const roles = ['app_runtime', 'app_readonly'];
    const tables = [
      'iam.audit_records',
      'iam.audit_record_details',
      'iam.audit_integrity_links',
      'iam.security_events',
      'shared.event_outbox',
      'shared.idempotency_keys',
    ];
    const violations: string[] = [];

    for (const role of roles) {
      for (const table of tables) {
        for (const privilege of ['UPDATE', 'DELETE', 'TRUNCATE']) {
          const { rows } = await admin.query(`SELECT has_table_privilege($1, $2, $3) AS allowed`, [
            role,
            table,
            privilege,
          ]);
          if (rows[0].allowed) violations.push(`${role} ${privilege} ${table}`);
        }
      }
    }

    expect(violations, `Mutable audit/queue surface: ${violations.join(', ')}`).toEqual([]);
  });

  it('gives app_runtime exactly the approved iam/shared function surface', async () => {
    // DBCR-P1-13-001 added the four audit-append routines. It deliberately did
    // NOT add iam.audit_verify_chain (a forensic routine) or any outbox worker
    // routine — producing an event and draining the queue stay separate powers.
    //
    // DBCR-P1-14-001 added exactly one more: iam.change_user_status, the
    // validated account-lifecycle transition. It is SECURITY INVOKER, so the
    // EXECUTE grant confers nothing by itself — the caller still needs the
    // underlying table privileges and must still satisfy every policy.
    // iam.audit_verify_chain remains withheld.
    //
    // The P1-14 grant-scope remediation (migration 20260727090000) added one more:
    // iam.grant_delegation_within_authority, the SECURITY-INVOKER predicate the
    // deferred scope-containment constraint trigger calls. Its trigger-body
    // companion iam.enforce_grant_delegation_within_authority is NOT granted (a
    // constraint trigger fires without the caller holding EXECUTE on its function).
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || p.proname AS routine
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('iam', 'shared')
         AND has_function_privilege('app_runtime', p.oid, 'EXECUTE')
       ORDER BY 1`
    );
    expect(rows.map((r) => r.routine)).toEqual([
      'iam.allowed_branch_ids',
      'iam.allowed_company_ids',
      'iam.audit_append',
      'iam.audit_canonical',
      'iam.audit_hash',
      'iam.audit_mask',
      'iam.change_user_status',
      'iam.current_branch_ids',
      'iam.current_company_ids',
      'iam.current_tenant_id',
      'iam.current_user_id',
      'iam.grant_delegation_within_authority',
      'iam.has_permission',
      'iam.has_permission_in_scope',
      'shared.document_deletion_eligibility',
      'shared.document_ids_for_entity',
      'shared.missing_translations',
      'shared.next_display_number',
      'shared.resolve_setting',
    ]);
  });

  it('grants no application role USAGE on schema extensions', async () => {
    // iam.audit_hash uses pg_catalog.sha256 precisely so the SECURITY INVOKER
    // append chain needs no cross-schema grant. USAGE on `extensions` would also
    // expose extensions.pg_stat_statements, which pgcrypto grants to PUBLIC.
    const { rows } = await admin.query(
      `SELECT r.rolname, has_schema_privilege(r.rolname, 'extensions', 'USAGE') AS usage
         FROM pg_roles r
        WHERE r.rolname IN ('app_runtime', 'app_readonly', 'app_worker')
        ORDER BY 1`
    );
    expect(rows).toEqual([
      { rolname: 'app_readonly', usage: false },
      { rolname: 'app_runtime', usage: false },
      { rolname: 'app_worker', usage: false },
    ]);
  });

  it('gives app_worker exactly the approved table privilege surface', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || c.relname AS table_name, v.privilege
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest($1::text[]) AS v(privilege)
       WHERE n.nspname = ANY($2::text[])
         AND c.relkind IN ('r', 'p')
         AND has_table_privilege('app_worker', c.oid, v.privilege)
       ORDER BY 1, 2`,
      [TABLE_PRIVILEGES, MODULE_SCHEMAS]
    );
    const effective = rows.map((r) => `${r.table_name} ${r.privilege}`);
    expect(effective).toEqual(
      [
        // DBCR-P1-15-001 (migration 117) added the asynchronous dispatch and
        // projection surface. The INSERT/UPDATE grants there are column-scoped,
        // so only the table-level privileges they imply appear here.
        'shared.delivery_attempts SELECT',
        'shared.error_records INSERT',
        'shared.error_records SELECT',
        'shared.error_records UPDATE',
        'shared.event_outbox INSERT',
        'shared.event_outbox SELECT',
        'shared.event_outbox UPDATE',
        'shared.outbound_messages SELECT',
        'shared.processed_events INSERT',
        'shared.processed_events SELECT',
        'shared.search_metadata DELETE',
        'shared.search_metadata SELECT',
      ].sort()
    );
  });

  it('gives app_worker exactly the approved module-function surface', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || p.proname AS routine
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = ANY($1::text[])
         AND has_function_privilege('app_worker', p.oid, 'EXECUTE')
       ORDER BY 1`,
      [MODULE_SCHEMAS]
    );
    expect(rows.map((r) => r.routine)).toEqual([
      'iam.current_user_id',
      'shared.claim_outbox_events',
      'shared.complete_outbox_event',
      'shared.fail_outbox_event',
    ]);
  });
});

describe('phase and RLS boundaries', () => {
  it('has exactly the five module schemas', async () => {
    const schemas = await admin.query(
      `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[]) ORDER BY 1`,
      [MODULE_SCHEMAS]
    );
    expect(schemas.rows.map((r) => r.nspname)).toEqual(MODULE_SCHEMAS);

    // Phase 1-7 has started: the veh schema now holds Vehicle-domain tables. The
    // exact per-schema table inventory is guarded by tests/db/foundation.test.ts
    // (ALLOWED_TABLES); a future-phase table (e.g. Phase 1-8 reception) that
    // slips into veh would fail there. No forward-empty-schema guard remains.
  });

  it('enables and forces RLS on every module-schema table', async () => {
    const { rows } = await admin.query(
      `SELECT n.nspname || '.' || c.relname AS fq,
              c.relrowsecurity,
              c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p')
       ORDER BY 1`,
      [MODULE_SCHEMAS]
    );
    const violations = rows
      .filter((r) => !r.relrowsecurity || !r.relforcerowsecurity)
      .map((r) => `${r.fq}: enabled=${r.relrowsecurity}, forced=${r.relforcerowsecurity}`);
    expect(violations, `RLS violations: ${violations.join('; ')}`).toEqual([]);
  });
});

describe('fix-forward initial state and branch integrity', () => {
  it('rejects a direct archived document INSERT', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, category_id, title, classification, retention_class,
              status, archived_at, created_by)
           VALUES ($1,$2,'Bypass archive','internal','operational','archived',now(),$3)`,
          [TENANT_A, CATEGORY, USER_A]
        ),
        '23514'
      )
    );
  });

  it('rejects a direct accepted document-version INSERT even with its stamp', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.document_versions
             (tenant_id, document_id, version_number, storage_key, content_type,
              size_bytes, sha256, uploaded_by, status, accepted_at, created_by)
           VALUES ($1,$2,1,'tenant/hardening/object_1','application/pdf',1024,
                   decode(repeat('00', 32), 'hex'),$3,'accepted',now(),$3)`,
          [TENANT_A, DOCUMENT, USER_A]
        ),
        '23514'
      )
    );
  });

  it('rejects a same-tenant branch that belongs to a different company', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.documents
             (tenant_id, company_id, branch_id, category_id, title,
              classification, retention_class, created_by)
           VALUES ($1,$2,$3,$4,'Cross-company branch','internal','operational',$5)`,
          [TENANT_A, COMPANY_A1, BRANCH_A2, CATEGORY, USER_A]
        ),
        '23503'
      )
    );
  });
});
