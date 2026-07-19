/**
 * Phase 1-6 CRM — crm.partner_identifiers (P1-06-DB-004, P1-06-QA-002).
 *
 * Proves normalized per-type uniqueness (soft-delete aware), one-primary-per
 * (partner, type), same-partner/same-tenant FK integrity, and the C1
 * writable-classification hardening: type<->classification coupling blocks
 * mislabel-on-insert; classification/identifier_type immutability blocks
 * downgrade-on-update; the row-level iam.sensitive.view gate hides restricted
 * values from an unprivileged session (and the gated UPDATE policy stops such a
 * session from touching a restricted row at all).
 *
 * Test-reference: TC-CRM-001, TC-RLS-001, TC-DB-001.
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

const PARTNER_A = 'a6000000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'b6000000-0000-4000-8000-0000000000b1';
const PERMISSION_ID = 'a6100000-0000-4000-8000-000000000001';
const ROLE_ID = 'a6100000-0000-4000-8000-000000000002';
const GRANT_ID = 'a6100000-0000-4000-8000-000000000003';
const SENSITIVE_USER = 'a6100000-0000-4000-8000-000000000004';
// Committed identifier fixtures for the visibility tests.
const IDENT_PHONE = 'a6200000-0000-4000-8000-000000000001';
const IDENT_NATID = 'a6200000-0000-4000-8000-000000000002';

let admin: Pool;
let runtime: Pool;

async function seedIamSensitiveViewer(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.permissions (id, permission_code, domain, description, risk_level, created_by)
     VALUES ($1, 'iam.sensitive.view', 'iam', 'View sensitive data', 'high', $2)
     ON CONFLICT (permission_code) DO NOTHING`,
    [PERMISSION_ID, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'crm_sensitive_viewer', 'CRM sensitive viewer', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_ID, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, 'supabase', 'crm-sensitive', 'crm-sensitive@example.test',
             'CRM sensitive user', 'active', $3)
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

async function insertIdent(
  tx: { query: Pool['query'] },
  id: string,
  type: string,
  normalized: string,
  classification: string,
  isPrimary = false
) {
  return tx.query(
    `INSERT INTO crm.partner_identifiers
       (id, tenant_id, partner_id, identifier_type, normalized_value, classification, is_primary, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, TENANT_A, PARTNER_A, type, normalized, classification, isPrimary, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedIamSensitiveViewer();

  // Committed partner fixtures: one live partner per tenant.
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1, $3, 'individual', 'Ident Partner A', $5),
            ($2, $4, 'individual', 'Ident Partner B', $5)`,
    [PARTNER_A, PARTNER_B, TENANT_A, TENANT_B, USER_A]
  );
  // Committed identifiers on PARTNER_A: an internal phone and a restricted national id.
  await admin.query(
    `INSERT INTO crm.partner_identifiers
       (id, tenant_id, partner_id, identifier_type, normalized_value, classification, is_primary, created_by)
     VALUES
       ($1, $3, $4, 'phone',       '962790000000', 'internal',   true, $5),
       ($2, $3, $4, 'national_id', 'NID-RESTRICTED-1', 'restricted', true, $5)`,
    [IDENT_PHONE, IDENT_NATID, TENANT_A, PARTNER_A, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('identifier creation, typing, and coupling (P1-06-DB-004)', () => {
  it('creates each identifier type with the correct classification', async () => {
    // Use the sensitive-view user so restricted rows are counted too.
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: SENSITIVE_USER }, async (tx) => {
      await insertIdent(
        tx,
        'a6200000-0000-4000-8000-0000000000e1',
        'email',
        'a@b.test',
        'internal'
      );
      await insertIdent(
        tx,
        'a6200000-0000-4000-8000-0000000000e2',
        'registration',
        'REG-1',
        'restricted'
      );
      await insertIdent(tx, 'a6200000-0000-4000-8000-0000000000e3', 'other', 'OTHER-1', 'internal');
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.partner_identifiers WHERE partner_id = $1`,
        [PARTNER_A]
      );
      // 2 committed (phone + national_id) + 3 new; all visible with sensitive.view.
      expect(rows[0].n).toBe(5);
    });
  });

  it('rejects a sensitive type labelled internal (coupling)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        insertIdent(tx, 'a6200000-0000-4000-8000-0000000000f1', 'national_id', 'NID-2', 'internal'),
        '23514'
      );
    });
  });

  it('rejects a contact type labelled restricted (coupling)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        insertIdent(
          tx,
          'a6200000-0000-4000-8000-0000000000f2',
          'phone',
          '962791111111',
          'restricted'
        ),
        '23514'
      );
    });
  });

  it('accepts a tax identifier as restricted and rejects it as internal (coupling)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertIdent(tx, 'a6200000-0000-4000-8000-00000000fa01', 'tax', 'TAX-1', 'restricted');
      await expectSqlState(
        insertIdent(tx, 'a6200000-0000-4000-8000-00000000fa02', 'tax', 'TAX-2', 'internal'),
        '23514'
      );
    });
  });

  it('enforces per-type normalized uniqueness among live rows, freed by soft delete', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertIdent(
        tx,
        'a6200000-0000-4000-8000-0000000000d1',
        'email',
        'dup@x.test',
        'internal'
      );
      await tx.query(
        `UPDATE crm.partner_identifiers SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
        ['a6200000-0000-4000-8000-0000000000d1', USER_A]
      );
      await insertIdent(
        tx,
        'a6200000-0000-4000-8000-0000000000d2',
        'email',
        'dup@x.test',
        'internal'
      );
      // A second live row with the same (type, normalized) is rejected (last).
      await expectSqlState(
        insertIdent(tx, 'a6200000-0000-4000-8000-0000000000d3', 'email', 'dup@x.test', 'internal'),
        '23505'
      );
    });
  });

  it('allows at most one live primary per (partner, type)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertIdent(
        tx,
        'a6200000-0000-4000-8000-00000000eeb1',
        'email',
        'p1@x.test',
        'internal',
        true
      );
      await expectSqlState(
        insertIdent(
          tx,
          'a6200000-0000-4000-8000-00000000eeb2',
          'email',
          'p2@x.test',
          'internal',
          true
        ),
        '23505'
      );
    });
  });

  it('rejects an identifier attached to a partner in another tenant (composite FK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_identifiers
             (tenant_id, partner_id, identifier_type, normalized_value, classification, created_by)
           VALUES ($1, $2, 'email', 'x@y.test', 'internal', $3)`,
          [TENANT_A, PARTNER_B, USER_A]
        ),
        '23503'
      );
    });
  });
});

describe('sensitive-data gate (C1) and immutability', () => {
  it('hides a restricted identifier from a same-tenant session without iam.sensitive.view', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT identifier_type FROM crm.partner_identifiers WHERE partner_id = $1 ORDER BY identifier_type`,
        [PARTNER_A]
      );
      // Only the internal phone is visible; the restricted national_id is gated out.
      expect(rows.map((r) => r.identifier_type)).toEqual(['phone']);
    });
  });

  it('shows the restricted identifier to a same-tenant session WITH iam.sensitive.view', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: SENSITIVE_USER }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT identifier_type FROM crm.partner_identifiers WHERE partner_id = $1 ORDER BY identifier_type`,
        [PARTNER_A]
      );
      expect(rows.map((r) => r.identifier_type)).toEqual(['national_id', 'phone']);
    });
  });

  it('an unprivileged session cannot update (or downgrade) a restricted row — it is not visible to UPDATE', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const res = await tx.query(
        `UPDATE crm.partner_identifiers SET raw_value = 'tampered' WHERE id = $1`,
        [IDENT_NATID]
      );
      expect(res.rowCount).toBe(0); // gated out by the UPDATE policy USING clause
    });
  });

  it('rejects changing classification or identifier_type after creation (immutability)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: SENSITIVE_USER }, async (tx) => {
      await expectSqlState(
        tx.query(`UPDATE crm.partner_identifiers SET classification = 'internal' WHERE id = $1`, [
          IDENT_NATID,
        ]),
        '23514'
      );
    });
  });
});

describe('tenant isolation and grants', () => {
  it('tenant A cannot read tenant B identifiers', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.partner_identifiers WHERE tenant_id = $1`,
        [TENANT_B]
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('the runtime role cannot DELETE an identifier (soft delete only)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: SENSITIVE_USER }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.partner_identifiers WHERE id = $1`, [IDENT_PHONE]),
        '42501'
      );
    });
  });
});
