/**
 * Phase 1-6 CRM — crm.customer_alerts / crm.customer_credit_profiles
 * (P1-06-DB-013/014, P1-06-QA-005). Alert types/severity, active lookup,
 * acknowledgement coherence; credit one-per-partner, NUMERIC precision, and the
 * approved-requires-attribution CHECK.
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

const PARTNER_A = 'a6a00000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'b6a00000-0000-4000-8000-0000000000b1';
const PARTNER_A2 = 'a6a00000-0000-4000-8000-0000000000a2';

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
     VALUES ($1, $4, 'individual', 'AC Partner A', $5),
            ($2, $6, 'individual', 'AC Partner B', $5),
            ($3, $4, 'individual', 'AC Partner A2', $5)`,
    [PARTNER_A, PARTNER_B, PARTNER_A2, TENANT_A, USER_A, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('customer alerts (P1-06-DB-013)', () => {
  it('creates alerts and finds active ones by index', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.customer_alerts (tenant_id, partner_id, alert_type, severity, message, effective_from, created_by)
         VALUES ($1, $2, 'financial', 'warning', 'overdue', DATE '2026-01-01', $3),
                ($1, $2, 'safety', 'critical', 'hazard', DATE '2026-01-01', $3)`,
        [TENANT_A, PARTNER_A, USER_A]
      );
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.customer_alerts
          WHERE partner_id = $1 AND active AND effective_to IS NULL`,
        [PARTNER_A]
      );
      expect(rows[0].n).toBe(2);
    });
  });

  it('rejects an incoherent acknowledgement (actor without timestamp)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.customer_alerts
             (tenant_id, partner_id, alert_type, severity, message, effective_from, acknowledged_by, created_by)
           VALUES ($1, $2, 'operational', 'info', 'x', DATE '2026-01-01', $3, $3)`,
          [TENANT_A, PARTNER_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects an invalid severity and denies DELETE', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.customer_alerts (tenant_id, partner_id, alert_type, severity, message, effective_from, created_by)
           VALUES ($1, $2, 'other', 'fatal', 'x', DATE '2026-01-01', $3)`,
          [TENANT_A, PARTNER_A, USER_A]
        ),
        '23514'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.customer_alerts WHERE partner_id = $1`, [PARTNER_A]),
        '42501'
      );
    });
  });
});

describe('customer credit profiles (P1-06-DB-014)', () => {
  it('stores one profile per partner with NUMERIC(18,4) precision', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.customer_credit_profiles (tenant_id, partner_id, credit_limit, currency_code, status, created_by)
         VALUES ($1, $2, 12345.6789, 'JOD', 'requested', $3)`,
        [TENANT_A, PARTNER_A, USER_A]
      );
      const { rows } = await tx.query(
        `SELECT credit_limit::text AS l FROM crm.customer_credit_profiles WHERE partner_id = $1`,
        [PARTNER_A]
      );
      expect(rows[0].l).toBe('12345.6789');
      // second profile for the same partner is rejected
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.customer_credit_profiles (tenant_id, partner_id, status, created_by)
           VALUES ($1, $2, 'none', $3)`,
          [TENANT_A, PARTNER_A, USER_A]
        ),
        '23505'
      );
    });
  });

  it('rejects approved status without approver attribution', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.customer_credit_profiles (tenant_id, partner_id, status, created_by)
           VALUES ($1, $2, 'approved', $3)`,
          [TENANT_A, PARTNER_A2, USER_A]
        ),
        '23514'
      );
    });
  });

  it('accepts approved status with approver + approval_ref', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO crm.customer_credit_profiles
           (tenant_id, partner_id, status, approved_by, approval_ref, created_by)
         VALUES ($1, $2, 'approved', $3, 'CR-APPROVAL-1', $3)`,
        [TENANT_A, PARTNER_A2, USER_A]
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it('rejects a credit profile for a partner in another tenant', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.customer_credit_profiles (tenant_id, partner_id, status, created_by)
           VALUES ($1, $2, 'none', $3)`,
          [TENANT_A, PARTNER_B, USER_A]
        ),
        '23503'
      );
    });
  });
});
