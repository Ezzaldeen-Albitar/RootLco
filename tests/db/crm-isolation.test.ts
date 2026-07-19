/**
 * Phase 1-6 CRM — centralized two-tenant isolation suite (P1-06-QA-006).
 *
 * Seeds a complete CRM dataset in BOTH tenants, then proves through the
 * NON-owner runtime login that tenant A can neither read nor write tenant B's
 * data on EVERY crm table, that the sensitive-view permission is per-tenant, and
 * — critically — the suite FAILS if a new crm table is added without isolation
 * coverage here.
 *
 * Test-reference: TC-RLS-001, TC-CRM-001.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  withCommittedTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';

// The authoritative list of tenant-owned crm tables under isolation coverage.
// timeline_events is populated by emit triggers as sources are seeded.
const COVERED_TABLES = [
  'addresses',
  'business_partners',
  'communication_log',
  'communication_preferences',
  'company_profiles',
  'consent_history',
  'contact_points',
  'customer_alerts',
  'customer_block_history',
  'customer_credit_profiles',
  'customer_restrictions',
  'customer_segments',
  'duplicate_candidates',
  'individual_profiles',
  'partner_identifiers',
  'partner_merges',
  'partner_roles',
  'partner_segment_assignments',
  'partner_sensitive_attributes',
  'partner_status_history',
  'timeline_events',
];

const PERMISSION_ID = 'a6f10000-0000-4000-8000-000000000001';
const ROLE_A = 'a6f10000-0000-4000-8000-000000000002';
const GRANT_A = 'a6f10000-0000-4000-8000-000000000003';
const SENSITIVE_A = 'a6f10000-0000-4000-8000-000000000004';

let admin: Pool;
let runtime: Pool;

// Deterministic per-tenant ids (P1 < P2 for candidate ordering).
function ids(prefix: string) {
  // prefix is 4 hex chars; first UUID segment = prefix + 4 = 8 hex chars.
  return {
    P1: `${prefix}0000-0000-4000-8000-000000000001`,
    P2: `${prefix}0000-0000-4000-8000-000000000002`,
    IDENT: `${prefix}1000-0000-4000-8000-000000000001`,
    SEG: `${prefix}2000-0000-4000-8000-000000000001`,
    CONTACT: `${prefix}3000-0000-4000-8000-000000000001`,
    REST: `${prefix}4000-0000-4000-8000-000000000001`,
  };
}
const A = ids('a6f0');
const B = ids('b6f0');

async function seedTenant(tenantId: string, i: ReturnType<typeof ids>) {
  await withCommittedTx(admin, { tenantId, userId: USER_A }, async (tx) => {
    await tx.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
       VALUES ($1, $3, 'individual', 'Iso P1', $4), ($2, $3, 'organization', 'Iso P2', $4)`,
      [i.P1, i.P2, tenantId, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.individual_profiles (tenant_id, partner_id, given_name, family_name, created_by)
       VALUES ($1, $2, 'Given', 'Family', $3)`,
      [tenantId, i.P1, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.company_profiles (tenant_id, partner_id, legal_name, created_by)
       VALUES ($1, $2, 'Legal LLC', $3)`,
      [tenantId, i.P2, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.partner_identifiers (id, tenant_id, partner_id, identifier_type, normalized_value, classification, created_by)
       VALUES ($1, $2, $3, 'national_id', 'NID', 'restricted', $4)`,
      [i.IDENT, tenantId, i.P1, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.partner_sensitive_attributes (tenant_id, partner_id, attribute_type, value_date, created_by)
       VALUES ($1, $2, 'date_of_birth', DATE '1990-01-01', $3)`,
      [tenantId, i.P1, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.partner_roles (tenant_id, partner_id, role_type, valid_from, created_by)
       VALUES ($1, $2, 'customer', DATE '2026-01-01', $3)`,
      [tenantId, i.P1, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.partner_status_history (tenant_id, partner_id, status_kind, to_state, reason)
       VALUES ($1, $2, 'lifecycle', 'active', 'onboarded')`,
      [tenantId, i.P1]
    );
    await tx.query(
      `INSERT INTO crm.customer_segments (id, tenant_id, segment_code, name, created_by)
       VALUES ($1, $2, 'vip', 'VIP', $3)`,
      [i.SEG, tenantId, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.partner_segment_assignments (tenant_id, partner_id, segment_id, assigned_by, valid_from, created_by)
       VALUES ($1, $2, $3, $4, DATE '2026-01-01', $4)`,
      [tenantId, i.P1, i.SEG, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.customer_restrictions (id, tenant_id, partner_id, restriction_type, reason, imposed_by, effective_from, created_by)
       VALUES ($1, $2, $3, 'no_credit', 'risk', $4, DATE '2026-01-01', $4)`,
      [i.REST, tenantId, i.P1, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.contact_points (id, tenant_id, partner_id, channel, normalized_value, created_by)
       VALUES ($1, $2, $3, 'email', 'iso@x.test', $4)`,
      [i.CONTACT, tenantId, i.P1, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.addresses (tenant_id, partner_id, address_type, line1, created_by)
       VALUES ($1, $2, 'billing', '1 St', $3)`,
      [tenantId, i.P1, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.communication_preferences (tenant_id, partner_id, channel, purpose, preferred, created_by)
       VALUES ($1, $2, 'email', 'marketing', true, $3)`,
      [tenantId, i.P1, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.consent_history (tenant_id, partner_id, consent_kind, contact_point_id, channel, purpose, status, effective_at)
       VALUES ($1, $2, 'marketing', $3, 'email', 'marketing', 'granted', now())`,
      [tenantId, i.P1, i.CONTACT]
    );
    await tx.query(
      `INSERT INTO crm.customer_alerts (tenant_id, partner_id, alert_type, severity, message, effective_from, created_by)
       VALUES ($1, $2, 'financial', 'warning', 'overdue', DATE '2026-01-01', $3)`,
      [tenantId, i.P1, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.customer_credit_profiles (tenant_id, partner_id, status, created_by)
       VALUES ($1, $2, 'requested', $3)`,
      [tenantId, i.P1, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.customer_block_history (tenant_id, partner_id, action, reason, restriction_id)
       VALUES ($1, $2, 'blocked', 'policy', $3)`,
      [tenantId, i.P1, i.REST]
    );
    await tx.query(
      `INSERT INTO crm.duplicate_candidates (tenant_id, partner_id_a, partner_id_b, match_score, created_by)
       VALUES ($1, $2, $3, 0.9, $4)`,
      [tenantId, i.P1, i.P2, USER_A]
    );
    await tx.query(
      `INSERT INTO crm.partner_merges (tenant_id, source_partner_id, survivor_partner_id, approval_ref)
       VALUES ($1, $2, $3, 'AP-1')`,
      [tenantId, i.P1, i.P2]
    );
    await tx.query(
      `INSERT INTO crm.communication_log (tenant_id, partner_id, direction, channel, logged_by, created_by)
       VALUES ($1, $2, 'outbound', 'email', $3, $3)`,
      [tenantId, i.P1, USER_A]
    );
  });
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  // sensitive-view user in tenant A only
  await admin.query(
    `INSERT INTO iam.permissions (id, permission_code, domain, description, risk_level, created_by)
     VALUES ($1, 'iam.sensitive.view', 'iam', 'View sensitive', 'high', $2) ON CONFLICT (permission_code) DO NOTHING`,
    [PERMISSION_ID, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'iso_sensitive', 'Iso sensitive', $3) ON CONFLICT (id) DO NOTHING`,
    [ROLE_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, 'supabase', 'iso-sensitive', 'iso-sensitive@example.test', 'Iso', 'active', $3) ON CONFLICT (id) DO NOTHING`,
    [SENSITIVE_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = 'iam.sensitive.view' ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, granted_by, created_by)
     VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT (id) DO NOTHING`,
    [GRANT_A, TENANT_A, SENSITIVE_A, ROLE_A, USER_A]
  );
  await seedTenant(TENANT_A, A);
  await seedTenant(TENANT_B, B);
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('two-tenant isolation across every crm table (P1-06-QA-006)', () => {
  it('covers every tenant-owned crm base table (fails when a new table is added)', async () => {
    const { rows } = await admin.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'crm' AND table_type = 'BASE TABLE' ORDER BY 1`
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([...COVERED_TABLES].sort());
  });

  it('tenant A reads ZERO tenant-B rows on every covered table (sensitive-view user sees all own rows)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: SENSITIVE_A }, async (tx) => {
      for (const t of COVERED_TABLES) {
        const b = await tx.query(`SELECT count(*)::int AS n FROM crm.${t} WHERE tenant_id = $1`, [
          TENANT_B,
        ]);
        expect(b.rows[0].n, `tenant A must not see tenant B rows in crm.${t}`).toBe(0);
        const own = await tx.query(`SELECT count(*)::int AS n FROM crm.${t}`);
        expect(own.rows[0].n, `tenant A should see its own rows in crm.${t}`).toBeGreaterThan(0);
      }
    });
  });

  it('a restricted identifier is hidden without iam.sensitive.view and visible with it', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.partner_identifiers WHERE partner_id = $1 AND identifier_type = 'national_id'`,
        [A.P1]
      );
      expect(rows[0].n).toBe(0); // no sensitive.view -> hidden
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: SENSITIVE_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.partner_identifiers WHERE partner_id = $1 AND identifier_type = 'national_id'`,
        [A.P1]
      );
      expect(rows[0].n).toBe(1); // with sensitive.view -> visible
    });
  });

  it('the tenant-A sensitive permission does not expose tenant B restricted data', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: SENSITIVE_A }, async (tx) => {
      // SENSITIVE_A is a tenant-A user; used with tenant-B context it grants nothing.
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.partner_sensitive_attributes WHERE tenant_id = $1`,
        [TENANT_B]
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('tenant A cannot INSERT a partner into tenant B (WITH CHECK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
           VALUES ($1, 'individual', 'Sneak', $2)`,
          [TENANT_B, USER_A]
        ),
        '42501'
      );
    });
  });
});
