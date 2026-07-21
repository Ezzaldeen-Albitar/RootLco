/**
 * Phase 1-4 Increment I — permission-gated audit reads, security-admin viewing,
 * and structural hardening (P1-04-DB-023/024, SEC-001..003).
 *
 * Audit reads and privileged session/login viewing require an explicit
 * permission (resolved by iam.has_permission); without it a session sees zero
 * rows. Structural assertions confirm the safe posture. Isolation runs as the
 * non-owner runtime login.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  withRolledBackTx,
} from './helpers';

const R_AUD = 'd2000000-0000-4000-8000-000000000001';
const R_SEC = 'd2000000-0000-4000-8000-000000000002';
const U_AUD = 'a8000000-0000-4000-8000-000000000001';
const U_SEC = 'a8000000-0000-4000-8000-000000000002';
const U_PLAIN = 'a8000000-0000-4000-8000-000000000003';
const U_OTHER = 'a8000000-0000-4000-8000-000000000004';
const GRANTER = USER_A;

let admin: Pool;
let runtime: Pool;

async function seed(): Promise<void> {
  // Real catalog permission codes (idempotent — Increment J seeds them too).
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, created_by) VALUES
       ('iam.audit.view','iam','view audit',$1),
       ('iam.session.view_all','iam','view all sessions',$1),
       ('iam.login.view_all','iam','view all login history',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [GRANTER]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$3,'auditor','Auditor',$4), ($2,$3,'secadmin','Sec Admin',$4)
     ON CONFLICT (id) DO NOTHING`,
    [R_AUD, R_SEC, TENANT_A, GRANTER]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p WHERE p.permission_code='iam.audit.view'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, R_AUD, GRANTER]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p WHERE p.permission_code IN ('iam.session.view_all','iam.login.view_all')
     ON CONFLICT DO NOTHING`,
    [TENANT_A, R_SEC, GRANTER]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$5,'supabase','ha1','ha1@x.com','U Aud','active',$6),
            ($2,$5,'supabase','ha2','ha2@x.com','U Sec','active',$6),
            ($3,$5,'supabase','ha3','ha3@x.com','U Plain','active',$6),
            ($4,$5,'supabase','ha4','ha4@x.com','U Other','active',$6)
     ON CONFLICT (id) DO NOTHING`,
    [U_AUD, U_SEC, U_PLAIN, U_OTHER, TENANT_A, GRANTER]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, granted_by, created_by)
     VALUES ($1,$2,$4,$6,$6), ($1,$3,$5,$6,$6)`,
    [TENANT_A, U_AUD, U_SEC, R_AUD, R_SEC, GRANTER]
  );
  await admin.query(
    `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, created_by)
     VALUES ($1,$2,'hard-sess-other',$4), ($1,$3,'hard-sess-sec',$4)`,
    [TENANT_A, U_OTHER, U_SEC, GRANTER]
  );
  await admin.query(`SELECT iam.audit_append($1,$2,'user','create','iam.test')`, [
    TENANT_A,
    GRANTER,
  ]);
  // The second record carries a detail row, so the permission gate on
  // iam.audit_record_details has something to gate.
  await admin.query(
    `SELECT iam.audit_append($1,$2,'user','update','iam.test',NULL,NULL,NULL,NULL,NULL,$3::jsonb)`,
    [
      TENANT_A,
      GRANTER,
      JSON.stringify([{ field: 'status', old: 'draft', new: 'active', class: 'internal' }]),
    ]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seed();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('permission-gated audit reads', () => {
  it('a user with iam.audit.view reads tenant audit rows', async () => {
    const r = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: U_AUD }, (c) =>
      c.query(`SELECT count(*)::int AS n FROM iam.audit_records`)
    );
    expect(r.rows[0].n).toBeGreaterThanOrEqual(2);
  });
  it('a user without the permission reads zero audit rows', async () => {
    const r = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: U_PLAIN }, (c) =>
      c.query(`SELECT count(*)::int AS n FROM iam.audit_records`)
    );
    expect(r.rows[0].n).toBe(0);
  });
  it('audit details are gated the same way', async () => {
    const withPerm = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: U_AUD }, (c) =>
      c.query(`SELECT count(*)::int AS n FROM iam.audit_record_details`)
    );
    expect(withPerm.rows[0].n).toBeGreaterThanOrEqual(1);
    const without = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: U_PLAIN }, (c) =>
      c.query(`SELECT count(*)::int AS n FROM iam.audit_record_details`)
    );
    expect(without.rows[0].n).toBe(0);
  });

  it('exposes the integrity chain to any tenant session, and it carries no audit content', async () => {
    // A DELIBERATE and bounded exception, introduced by DBCR-P1-13-001. To
    // extend the chain, `iam.audit_append` must read its own tenant's highest
    // seq and last record_hash — so sel_audit_integrity_links_chain is
    // tenant-scoped rather than permission-gated. What that exposes is the
    // whole point of the exception: a counter, an opaque record id, and two
    // SHA-256 digests. No action, actor, entity, or field value lives here, and
    // reading the records and details those hashes cover still requires
    // iam.audit.view (asserted above).
    const without = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: U_PLAIN }, (c) =>
      c.query(`SELECT count(*)::int AS n FROM iam.audit_integrity_links`)
    );
    expect(without.rows[0].n).toBeGreaterThanOrEqual(2);

    const columns = await admin.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='iam' AND table_name='audit_integrity_links'
        ORDER BY 1`
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual([
      'audit_record_id',
      'id',
      'prev_hash',
      'record_hash',
      'seq',
      'tenant_id',
    ]);

    // And it is still scoped: another tenant's chain stays invisible.
    const otherTenant = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_B, userId: U_PLAIN },
      (c) => c.query(`SELECT count(*)::int AS n FROM iam.audit_integrity_links`)
    );
    expect(otherTenant.rows[0].n).toBe(0);
  });
});

describe('privileged session/login viewing (own-row + admin policy)', () => {
  it('a security admin sees all tenant sessions; a plain user sees only their own', async () => {
    const admin_view = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: U_SEC }, (c) =>
      c.query(`SELECT session_ref FROM iam.user_sessions ORDER BY 1`)
    );
    expect(admin_view.rows.map((r) => r.session_ref)).toEqual(['hard-sess-other', 'hard-sess-sec']);
    const other_view = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: U_OTHER },
      (c) => c.query(`SELECT session_ref FROM iam.user_sessions ORDER BY 1`)
    );
    expect(other_view.rows.map((r) => r.session_ref)).toEqual(['hard-sess-other']); // own only
  });
});

describe('structural security posture (P1-04-SEC-001..003)', () => {
  it('no iam routine is SECURITY DEFINER', async () => {
    const { rows } = await admin.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='iam' AND p.prosecdef`
    );
    expect(rows).toEqual([]);
  });

  it('no application role holds UPDATE or DELETE on any iam audit/history table', async () => {
    const { rows } = await admin.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema='iam'
         AND table_name IN ('audit_records','audit_record_details','audit_integrity_links',
                            'security_events','login_audit','user_status_history')
         AND grantee IN ('app_runtime','app_readonly')
         AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')`
    );
    expect(rows).toEqual([]);
  });

  it('grants INSERT on the audit tables to app_runtime alone, and to no history table', async () => {
    // DBCR-P1-13-001: the request path appends its own evidence, so INSERT is
    // now expected on exactly the four audit surfaces — and nowhere else. The
    // history tables stay trigger-written, and app_readonly stays read-only.
    const { rows } = await admin.query(
      `SELECT grantee, table_name FROM information_schema.role_table_grants
       WHERE table_schema='iam'
         AND table_name IN ('audit_records','audit_record_details','audit_integrity_links',
                            'security_events','login_audit','user_status_history')
         AND grantee IN ('app_runtime','app_readonly')
         AND privilege_type = 'INSERT'
       ORDER BY grantee, table_name`
    );
    expect(rows).toEqual([
      { grantee: 'app_runtime', table_name: 'audit_integrity_links' },
      { grantee: 'app_runtime', table_name: 'audit_record_details' },
      { grantee: 'app_runtime', table_name: 'audit_records' },
      { grantee: 'app_runtime', table_name: 'security_events' },
    ]);
  });

  it('runtime cannot inject a role_permission mapping (no INSERT grant)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: U_AUD }, async (c) => {
      const p = await c.query(
        `SELECT id FROM iam.permissions WHERE permission_code='iam.audit.view'`
      );
      await expect(
        c.query(
          `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
           VALUES ($1,$2,$3,'allow',$4)`,
          [TENANT_A, R_AUD, p.rows[0].id, USER_A]
        )
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
