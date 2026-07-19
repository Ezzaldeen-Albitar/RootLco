/**
 * Phase 1-6 CRM — Wave 5 security hardening (P1-06-SEC-002/004).
 *
 * Regression guards for three MEDIUM findings from the independent Wave 5
 * review: a partner cannot be INSERTED already blocked or already merged (block
 * and merge are only ever UPDATEs), and crm.jsonb_no_raw_value_keys rejects
 * raw-value keys at ANY nesting depth, case-insensitively.
 *
 * Test-reference: TC-CRM-001.
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
  USER_A,
} from './helpers';

const SURVIVOR = 'a7000000-0000-4000-8000-000000000001';
const DUP_A = 'a7000000-0000-4000-8000-000000000002';
const DUP_B = 'a7000000-0000-4000-8000-000000000003';

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
     VALUES ($1, $4, 'individual', 'Survivor', $5), ($2, $4, 'individual', 'Dup A', $5), ($3, $4, 'individual', 'Dup B', $5)`,
    [SURVIVOR, DUP_A, DUP_B, TENANT_A, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('INSERT-path guards (P1-06-SEC-004)', () => {
  it('a partner cannot be created already blocked', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, lifecycle_status, created_by)
           VALUES ($1, 'individual', 'X', 'blocked', $2)`,
          [TENANT_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('a partner cannot be created already merged (with a redirect)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, lifecycle_status, merged_into_id, created_by)
           VALUES ($1, 'individual', 'X', 'merged', $2, $3)`,
          [TENANT_A, SURVIVOR, USER_A]
        ),
        '23514'
      );
    });
  });

  it('still allows a normal active partner insert', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, lifecycle_status, created_by)
         VALUES ($1, 'individual', 'OK', 'active', $2)`,
        [TENANT_A, USER_A]
      );
      expect(res.rowCount).toBe(1);
    });
  });
});

describe('jsonb raw-value containment recurses and is case-insensitive (P1-06-SEC-004)', () => {
  it('rejects a nested raw-value key in match_basis', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.duplicate_candidates (tenant_id, partner_id_a, partner_id_b, match_score, match_basis, created_by)
           VALUES ($1, $2, $3, 0.9, '[{"field":"x","details":{"national_id":"1"}}]'::jsonb, $4)`,
          [TENANT_A, DUP_A, DUP_B, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects a case-variant raw-value key in merge_summary', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_merges (tenant_id, source_partner_id, survivor_partner_id, merge_summary, approval_ref)
           VALUES ($1, $2, $3, '{"Raw_Value":"secret"}'::jsonb, 'AP-1')`,
          [TENANT_A, DUP_A, SURVIVOR]
        ),
        '23514'
      );
    });
  });

  it('accepts a safe counts-only merge summary', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const res = await tx.query(
        `INSERT INTO crm.partner_merges (tenant_id, source_partner_id, survivor_partner_id, merge_summary, approval_ref)
         VALUES ($1, $2, $3, '{"moved_identifiers_count":3,"moved_roles_count":1}'::jsonb, 'AP-1')`,
        [TENANT_A, DUP_A, SURVIVOR]
      );
      expect(res.rowCount).toBe(1);
    });
  });
});
