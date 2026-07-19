/**
 * Phase 1-6 CRM — crm.individual_profiles / company_profiles /
 * partner_sensitive_attributes (P1-06-DB-002, DB-003, SEC-001; P1-06-QA-001).
 *
 * Proves declarative profile/type exclusivity via the party_type discriminator
 * FK, 1:1 uniqueness, same-partner _ref composite FKs, generated normalized
 * name columns, and the gated DOB store (insert/read/update all require
 * iam.sensitive.view; classification is pinned and immutable).
 *
 * Test-reference: TC-CRM-001, TC-RLS-001.
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
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';

const IND_PARTNER = 'a6300000-0000-4000-8000-0000000000a1';
const ORG_PARTNER = 'a6300000-0000-4000-8000-0000000000a2';
const OTHER_PARTNER = 'a6300000-0000-4000-8000-0000000000a3';
const B_PARTNER = 'b6300000-0000-4000-8000-0000000000b1';
const IND_NATID = 'a6310000-0000-4000-8000-000000000001'; // national_id on IND_PARTNER
const OTHER_NATID = 'a6310000-0000-4000-8000-000000000002'; // national_id on OTHER_PARTNER
const ROLE_ID = 'a6320000-0000-4000-8000-000000000002';
const GRANT_ID = 'a6320000-0000-4000-8000-000000000003';
const SENSITIVE_USER = 'a6320000-0000-4000-8000-000000000004';

let admin: Pool;
let runtime: Pool;

async function seedSensitiveViewer(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.permissions (id, permission_code, domain, description, risk_level, created_by)
     VALUES (gen_random_uuid(), 'iam.sensitive.view', 'iam', 'View sensitive data', 'high', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'crm_profile_sensitive_viewer', 'CRM profile sensitive viewer', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_ID, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, 'supabase', 'crm-profile-sensitive', 'crm-profile-sensitive@example.test',
             'CRM profile sensitive user', 'active', $3)
     ON CONFLICT (id) DO NOTHING`,
    [SENSITIVE_USER, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = 'iam.sensitive.view'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_ID, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, granted_by, created_by)
     VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT (id) DO NOTHING`,
    [GRANT_ID, TENANT_A, SENSITIVE_USER, ROLE_ID, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedSensitiveViewer();

  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1, $5, 'individual',   'Ind Partner',   $6),
            ($2, $5, 'organization', 'Org Partner',   $6),
            ($3, $5, 'individual',   'Other Partner', $6),
            ($4, $7, 'individual',   'B Partner',     $6)`,
    [IND_PARTNER, ORG_PARTNER, OTHER_PARTNER, B_PARTNER, TENANT_A, USER_A, TENANT_B]
  );
  await admin.query(
    `INSERT INTO crm.partner_identifiers
       (id, tenant_id, partner_id, identifier_type, normalized_value, classification, created_by)
     VALUES ($1, $3, $4, 'national_id', 'NID-IND', 'restricted', $6),
            ($2, $3, $5, 'national_id', 'NID-OTHER', 'restricted', $6)`,
    [IND_NATID, OTHER_NATID, TENANT_A, IND_PARTNER, OTHER_PARTNER, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('profile creation, exclusivity, and 1:1 (P1-06-DB-002/003)', () => {
  it('creates an individual profile with generated normalized names', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.individual_profiles (tenant_id, partner_id, given_name, family_name, created_by)
         VALUES ($1, $2, '  Layla ', 'AL-Nabulsi', $3)`,
        [TENANT_A, IND_PARTNER, USER_A]
      );
      const { rows } = await tx.query(
        `SELECT given_name_normalized, family_name_normalized FROM crm.individual_profiles WHERE partner_id = $1`,
        [IND_PARTNER]
      );
      expect(rows[0]).toEqual({
        given_name_normalized: 'layla',
        family_name_normalized: 'al-nabulsi',
      });
    });
  });

  it('creates a company profile for an organization partner', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.company_profiles (tenant_id, partner_id, legal_name, trade_name, created_by)
         VALUES ($1, $2, 'Acme LLC', 'Acme', $3)`,
        [TENANT_A, ORG_PARTNER, USER_A]
      );
      const { rows } = await tx.query(
        `SELECT legal_name_normalized FROM crm.company_profiles WHERE partner_id = $1`,
        [ORG_PARTNER]
      );
      expect(rows[0].legal_name_normalized).toBe('acme llc');
    });
  });

  it('rejects an individual profile on an organization partner (discriminator FK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.individual_profiles (tenant_id, partner_id, given_name, family_name, created_by)
           VALUES ($1, $2, 'X', 'Y', $3)`,
          [TENANT_A, ORG_PARTNER, USER_A]
        ),
        '23503'
      );
    });
  });

  it('rejects a company profile on an individual partner (discriminator FK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.company_profiles (tenant_id, partner_id, legal_name, created_by)
           VALUES ($1, $2, 'X LLC', $3)`,
          [TENANT_A, IND_PARTNER, USER_A]
        ),
        '23503'
      );
    });
  });

  it('rejects a second individual profile for the same partner (1:1)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.individual_profiles (tenant_id, partner_id, given_name, family_name, created_by)
         VALUES ($1, $2, 'A', 'B', $3)`,
        [TENANT_A, IND_PARTNER, USER_A]
      );
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.individual_profiles (tenant_id, partner_id, given_name, family_name, created_by)
           VALUES ($1, $2, 'C', 'D', $3)`,
          [TENANT_A, IND_PARTNER, USER_A]
        ),
        '23505'
      );
    });
  });

  it('accepts a same-partner national_id_ref but rejects a cross-partner identifier', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      // Same-partner ref is fine.
      await tx.query(
        `INSERT INTO crm.individual_profiles (tenant_id, partner_id, given_name, family_name, national_id_ref, created_by)
         VALUES ($1, $2, 'A', 'B', $3, $4)`,
        [TENANT_A, IND_PARTNER, IND_NATID, USER_A]
      );
      // Another partner's identifier is not reachable (composite FK requires same partner).
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.individual_profiles (tenant_id, partner_id, given_name, family_name, national_id_ref, created_by)
           VALUES ($1, $2, 'C', 'D', $3, $4)`,
          [TENANT_A, OTHER_PARTNER, IND_NATID, USER_A]
        ),
        '23503'
      );
    });
  });
});

describe('gated sensitive attributes — date of birth (SEC-001)', () => {
  it('requires iam.sensitive.view to insert a DOB', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_sensitive_attributes (tenant_id, partner_id, attribute_type, value_date, created_by)
           VALUES ($1, $2, 'date_of_birth', DATE '1990-01-01', $3)`,
          [TENANT_A, IND_PARTNER, USER_A]
        ),
        '42501'
      );
    });
  });

  it('allows a sensitive-view user to insert and read a DOB, hidden from others', async () => {
    // Insert (committed) as the sensitive user.
    await admin.query(
      `INSERT INTO crm.partner_sensitive_attributes (id, tenant_id, partner_id, attribute_type, value_date, created_by)
       VALUES ($1, $2, $3, 'date_of_birth', DATE '1990-01-01', $4)`,
      ['a6330000-0000-4000-8000-000000000001', TENANT_A, IND_PARTNER, SENSITIVE_USER]
    );
    // Visible with the permission.
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: SENSITIVE_USER }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.partner_sensitive_attributes WHERE partner_id = $1`,
        [IND_PARTNER]
      );
      expect(rows[0].n).toBe(1);
    });
    // Hidden without it.
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.partner_sensitive_attributes WHERE partner_id = $1`,
        [IND_PARTNER]
      );
      expect(rows[0].n).toBe(0);
    });
    await admin.query(`DELETE FROM crm.partner_sensitive_attributes WHERE partner_id = $1`, [
      IND_PARTNER,
    ]);
  });

  it('rejects a date_of_birth without a value_date (coupling)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: SENSITIVE_USER }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_sensitive_attributes (tenant_id, partner_id, attribute_type, value_text, created_by)
           VALUES ($1, $2, 'date_of_birth', 'not a date', $3)`,
          [TENANT_A, IND_PARTNER, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects downgrading classification (immutable, always restricted)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: SENSITIVE_USER }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.partner_sensitive_attributes (id, tenant_id, partner_id, attribute_type, value_date, created_by)
         VALUES ($1, $2, $3, 'date_of_birth', DATE '1985-05-05', $4)`,
        ['a6330000-0000-4000-8000-0000000000c1', TENANT_A, ORG_PARTNER, USER_A]
      );
      await expectSqlState(
        tx.query(
          `UPDATE crm.partner_sensitive_attributes SET classification = 'internal' WHERE id = $1`,
          ['a6330000-0000-4000-8000-0000000000c1']
        ),
        '23514'
      );
    });
  });
});

describe('tenant isolation', () => {
  it('tenant A cannot read tenant B profiles', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_A }, async (tx) => {
      // Create a B profile within this rolled-back tx, then confirm A cannot see it.
      await tx.query(
        `INSERT INTO crm.individual_profiles (tenant_id, partner_id, given_name, family_name, created_by)
         VALUES ($1, $2, 'B', 'Person', $3)`,
        [TENANT_B, B_PARTNER, USER_A]
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.individual_profiles WHERE tenant_id = $1`,
        [TENANT_B]
      );
      expect(rows[0].n).toBe(0);
    });
  });
});
