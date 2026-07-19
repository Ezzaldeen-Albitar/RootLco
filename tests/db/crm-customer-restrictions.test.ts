/**
 * Phase 1-6 CRM — crm.customer_restrictions (P1-06-DB-008, P1-06-QA-005).
 * Restriction types, mandatory reason, active/open lookup, end-date (lift)
 * semantics, immutable identity/reason, same-tenant FK, and DELETE denial.
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

const PARTNER_A = 'a6700000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'b6700000-0000-4000-8000-0000000000b1';

let admin: Pool;
let runtime: Pool;

async function impose(
  tx: { query: Pool['query'] },
  type: string,
  from: string,
  to: string | null = null,
  partnerId = PARTNER_A
) {
  return tx.query(
    `INSERT INTO crm.customer_restrictions
       (tenant_id, partner_id, restriction_type, reason, imposed_by, effective_from, effective_to, created_by)
     VALUES ($1, $2, $3, 'risk', $4, $5::date, $6::date, $4)`,
    [TENANT_A, partnerId, type, USER_A, from, to]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1, $3, 'individual', 'Restr Partner A', $4), ($2, $5, 'individual', 'Restr Partner B', $4)`,
    [PARTNER_A, PARTNER_B, TENANT_A, USER_A, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('customer restrictions (P1-06-DB-008)', () => {
  it('accepts every restriction type', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      for (const t of ['no_credit', 'prepay_only', 'no_service', 'contact_restriction', 'other']) {
        await impose(tx, t, '2026-01-01');
      }
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.customer_restrictions WHERE partner_id = $1`,
        [PARTNER_A]
      );
      expect(rows[0].n).toBe(5);
    });
  });

  it('rejects an unknown type and a blank reason', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(impose(tx, 'banned', '2026-01-01'), '23514');
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.customer_restrictions
             (tenant_id, partner_id, restriction_type, reason, imposed_by, effective_from, created_by)
           VALUES ($1, $2, 'no_credit', '  ', $3, DATE '2026-01-01', $3)`,
          [TENANT_A, PARTNER_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('lifts a restriction by end-dating it, and open-restriction lookup reflects it', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await impose(tx, 'no_credit', '2026-01-01', null);
      const open1 = await tx.query(
        `SELECT count(*)::int AS n FROM crm.customer_restrictions
          WHERE partner_id = $1 AND effective_to IS NULL`,
        [PARTNER_A]
      );
      expect(open1.rows[0].n).toBe(1);
      const res = await tx.query(
        `UPDATE crm.customer_restrictions SET effective_to = DATE '2026-09-01'
          WHERE partner_id = $1 AND restriction_type = 'no_credit'`,
        [PARTNER_A]
      );
      expect(res.rowCount).toBe(1);
      const open2 = await tx.query(
        `SELECT count(*)::int AS n FROM crm.customer_restrictions
          WHERE partner_id = $1 AND effective_to IS NULL`,
        [PARTNER_A]
      );
      expect(open2.rows[0].n).toBe(0);
    });
  });

  it('rejects an invalid effective interval', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(impose(tx, 'no_service', '2026-06-01', '2026-01-01'), '23514');
    });
  });

  it('rejects changing the reason after creation (immutable)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await impose(tx, 'no_credit', '2026-01-01');
      await expectSqlState(
        tx.query(`UPDATE crm.customer_restrictions SET reason = 'changed' WHERE partner_id = $1`, [
          PARTNER_A,
        ]),
        '23514'
      );
    });
  });

  it('rejects a restriction for a partner in another tenant (composite FK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(impose(tx, 'no_credit', '2026-01-01', null, PARTNER_B), '23503');
    });
  });

  it('denies DELETE to the runtime role', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.customer_restrictions WHERE partner_id = $1`, [PARTNER_A]),
        '42501'
      );
    });
  });
});
