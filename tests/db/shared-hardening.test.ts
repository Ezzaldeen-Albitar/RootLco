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

const MODULE_SCHEMAS = ['crm', 'iam', 'org', 'shared', 'veh'];
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

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

  it('gives runtime and readonly zero effective privilege on the exact worker-boundary tables', async () => {
    const roles = ['app_runtime', 'app_readonly'];
    const tables = [
      'shared.idempotency_keys',
      'shared.event_outbox',
      'shared.processed_events',
      'shared.error_records',
    ];
    const violations: string[] = [];

    for (const role of roles) {
      for (const table of tables) {
        for (const privilege of TABLE_PRIVILEGES) {
          const { rows } = await admin.query(`SELECT has_table_privilege($1, $2, $3) AS allowed`, [
            role,
            table,
            privilege,
          ]);
          if (rows[0].allowed) violations.push(`${role} ${privilege} ${table}`);
        }
      }
    }

    expect(violations, `Unexpected worker-boundary privileges: ${violations.join(', ')}`).toEqual(
      []
    );
  });

  it('keeps approved IAM audit reads while denying every app-role mutation', async () => {
    const roles = ['app_runtime', 'app_readonly'];
    const tables = [
      'iam.audit_records',
      'iam.audit_record_details',
      'iam.audit_integrity_links',
      'iam.security_events',
    ];

    for (const role of roles) {
      for (const table of tables) {
        const { rows } = await admin.query(
          `SELECT has_table_privilege($1, $2, 'SELECT') AS can_select,
                  has_table_privilege($1, $2, 'INSERT') AS can_insert,
                  has_table_privilege($1, $2, 'UPDATE') AS can_update,
                  has_table_privilege($1, $2, 'DELETE') AS can_delete`,
          [role, table]
        );
        expect(rows[0], `${role} privilege contract for ${table}`).toEqual({
          can_select: true,
          can_insert: false,
          can_update: false,
          can_delete: false,
        });
      }
    }
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
        'shared.error_records INSERT',
        'shared.error_records SELECT',
        'shared.error_records UPDATE',
        'shared.event_outbox INSERT',
        'shared.event_outbox SELECT',
        'shared.event_outbox UPDATE',
        'shared.processed_events INSERT',
        'shared.processed_events SELECT',
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
  it('has exactly the five module schemas and no Phase 1-7 veh tables', async () => {
    const schemas = await admin.query(
      `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[]) ORDER BY 1`,
      [MODULE_SCHEMAS]
    );
    expect(schemas.rows.map((r) => r.nspname)).toEqual(MODULE_SCHEMAS);

    // crm (Phase 1-6) tables now exist by design; the Phase 1-7 veh schema must
    // still be an empty namespace (no Vehicle tables until Phase 1-7 starts).
    const futureTables = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq
       FROM information_schema.tables
       WHERE table_schema = 'veh' AND table_type = 'BASE TABLE'
       ORDER BY 1`
    );
    expect(futureTables.rows).toEqual([]);
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
