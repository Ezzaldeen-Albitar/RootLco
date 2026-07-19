/**
 * Phase 1-6 CRM — crm.customer_segments / partner_segment_assignments
 * (P1-06-DB-007). Segment code uniqueness (soft-delete aware), same-tenant
 * segment/partner FKs, dated assignments with overlap exclusion, point-in-time
 * active-assignment resolution, and tenant isolation.
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

const PARTNER_A = 'a6600000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'b6600000-0000-4000-8000-0000000000b1';
const SEGMENT_A = 'a6610000-0000-4000-8000-0000000000a1';
const SEGMENT_B = 'b6610000-0000-4000-8000-0000000000b1';

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
     VALUES ($1, $3, 'individual', 'Seg Partner A', $4), ($2, $5, 'individual', 'Seg Partner B', $4)`,
    [PARTNER_A, PARTNER_B, TENANT_A, USER_A, TENANT_B]
  );
  await admin.query(
    `INSERT INTO crm.customer_segments (id, tenant_id, segment_code, name, created_by)
     VALUES ($1, $3, 'vip', 'VIP', $4), ($2, $5, 'vip', 'VIP', $4)`,
    [SEGMENT_A, SEGMENT_B, TENANT_A, USER_A, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

async function assign(
  tx: { query: Pool['query'] },
  validFrom: string,
  validTo: string | null,
  segmentId = SEGMENT_A,
  partnerId = PARTNER_A
) {
  return tx.query(
    `INSERT INTO crm.partner_segment_assignments
       (tenant_id, partner_id, segment_id, assigned_by, valid_from, valid_to, created_by)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $4)`,
    [TENANT_A, partnerId, segmentId, USER_A, validFrom, validTo]
  );
}

describe('customer segments (P1-06-DB-007)', () => {
  it('enforces tenant-scoped code uniqueness among live rows, freed by soft delete', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.customer_segments (id, tenant_id, segment_code, name, created_by)
         VALUES ($1, $2, 'gold', 'Gold', $3)`,
        ['a6610000-0000-4000-8000-0000000000d1', TENANT_A, USER_A]
      );
      await tx.query(
        `UPDATE crm.customer_segments SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
        ['a6610000-0000-4000-8000-0000000000d1', USER_A]
      );
      await tx.query(
        `INSERT INTO crm.customer_segments (id, tenant_id, segment_code, name, created_by)
         VALUES ($1, $2, 'gold', 'Gold 2', $3)`,
        ['a6610000-0000-4000-8000-0000000000d2', TENANT_A, USER_A]
      );
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.customer_segments (id, tenant_id, segment_code, name, created_by)
           VALUES ($1, $2, 'gold', 'Gold 3', $3)`,
          ['a6610000-0000-4000-8000-0000000000d3', TENANT_A, USER_A]
        ),
        '23505'
      );
    });
  });

  it('rejects an invalid segment code format', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.customer_segments (tenant_id, segment_code, name, created_by)
           VALUES ($1, 'VIP Gold', 'x', $2)`,
          [TENANT_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('tenant A cannot read tenant B segments', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.customer_segments WHERE tenant_id = $1`,
        [TENANT_B]
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('dated segment assignments (P1-06-DB-007)', () => {
  it('assigns a partner to a same-tenant segment and resolves active-at-time', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await assign(tx, '2026-01-01', '2026-06-01');
      await assign(tx, '2026-07-01', null);
      const at = await tx.query(
        `SELECT count(*)::int AS n FROM crm.partner_segment_assignments
          WHERE partner_id = $1 AND valid_from <= DATE '2026-03-01'
            AND (valid_to IS NULL OR valid_to > DATE '2026-03-01')`,
        [PARTNER_A]
      );
      expect(at.rows[0].n).toBe(1);
    });
  });

  it('rejects overlapping assignments of the same segment (EXCLUDE)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await assign(tx, '2026-01-01', '2026-06-01');
      await expectSqlState(assign(tx, '2026-05-01', '2026-08-01'), '23P01');
    });
  });

  it('rejects valid_to <= valid_from and a missing valid_from', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(assign(tx, '2026-06-01', '2026-01-01'), '23514');
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_segment_assignments (tenant_id, partner_id, segment_id, assigned_by, created_by)
           VALUES ($1, $2, $3, $4, $4)`,
          [TENANT_A, PARTNER_A, SEGMENT_A, USER_A]
        ),
        '23502'
      );
    });
  });

  it('rejects assigning a segment from another tenant (composite FK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(assign(tx, '2026-01-01', null, SEGMENT_B), '23503');
    });
  });

  it('denies DELETE to the runtime role', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.customer_segments WHERE id = $1`, [SEGMENT_A]),
        '42501'
      );
    });
  });
});
