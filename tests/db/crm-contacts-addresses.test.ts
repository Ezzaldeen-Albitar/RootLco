/**
 * Phase 1-6 CRM — crm.contact_points / crm.addresses (P1-06-DB-009/010).
 * One-active-primary invariant (partial unique), soft-delete reuse, country
 * format, same-tenant FKs, tenant isolation, and DELETE denial.
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

const PARTNER_A = 'a6800000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'b6800000-0000-4000-8000-0000000000b1';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1, $3, 'individual', 'CA Partner A', $4), ($2, $5, 'individual', 'CA Partner B', $4)`,
    [PARTNER_A, PARTNER_B, TENANT_A, USER_A, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

async function contact(
  tx: { query: Pool['query'] },
  id: string,
  channel: string,
  value: string,
  isPrimary: boolean,
  partnerId = PARTNER_A
) {
  return tx.query(
    `INSERT INTO crm.contact_points (id, tenant_id, partner_id, channel, normalized_value, is_primary, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, TENANT_A, partnerId, channel, value, isPrimary, USER_A]
  );
}

describe('contact points (P1-06-DB-009)', () => {
  it('allows at most one active primary per channel; soft delete frees the slot', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await contact(tx, 'a6810000-0000-4000-8000-000000000001', 'phone', '111', true);
      await contact(tx, 'a6810000-0000-4000-8000-000000000002', 'phone', '222', false); // non-primary OK
      // soft-delete the primary, then a new primary is allowed
      await tx.query(
        `UPDATE crm.contact_points SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
        ['a6810000-0000-4000-8000-000000000001', USER_A]
      );
      await contact(tx, 'a6810000-0000-4000-8000-000000000003', 'phone', '333', true);
      // a second live primary is rejected (last statement)
      await expectSqlState(
        contact(tx, 'a6810000-0000-4000-8000-000000000004', 'phone', '444', true),
        '23505'
      );
    });
  });

  it('rejects a contact for a partner in another tenant', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        contact(tx, 'a6810000-0000-4000-8000-0000000000b1', 'email', 'x@y.z', false, PARTNER_B),
        '23503'
      );
    });
  });

  it('tenant A cannot read tenant B contacts and cannot DELETE', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.contact_points WHERE tenant_id = $1`,
        [TENANT_B]
      );
      expect(rows[0].n).toBe(0);
      await expectSqlState(
        tx.query(`DELETE FROM crm.contact_points WHERE tenant_id = $1`, [TENANT_A]),
        '42501'
      );
    });
  });
});

async function address(
  tx: { query: Pool['query'] },
  id: string,
  type: string,
  country: string | null,
  isPrimary: boolean,
  partnerId = PARTNER_A
) {
  return tx.query(
    `INSERT INTO crm.addresses (id, tenant_id, partner_id, address_type, line1, country_code, is_primary, created_by)
     VALUES ($1, $2, $3, $4, '1 Main St', $5, $6, $7)`,
    [id, TENANT_A, partnerId, type, country, isPrimary, USER_A]
  );
}

describe('addresses (P1-06-DB-010)', () => {
  it('allows at most one active primary per type', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await address(tx, 'a6820000-0000-4000-8000-000000000001', 'billing', 'JO', true);
      await address(tx, 'a6820000-0000-4000-8000-000000000002', 'service', 'JO', true); // different type OK
      await expectSqlState(
        address(tx, 'a6820000-0000-4000-8000-000000000003', 'billing', 'JO', true),
        '23505'
      );
    });
  });

  it('rejects an invalid country code format', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        address(tx, 'a6820000-0000-4000-8000-0000000000c1', 'billing', 'Jordan', false),
        '23514'
      );
    });
  });

  it('rejects an address for a partner in another tenant', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        address(tx, 'a6820000-0000-4000-8000-0000000000b1', 'billing', 'JO', false, PARTNER_B),
        '23503'
      );
    });
  });
});
