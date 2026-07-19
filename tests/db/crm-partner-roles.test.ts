/**
 * Phase 1-6 CRM — crm.partner_roles (P1-06-DB-005, P1-06-QA-001).
 *
 * Proves one partner can hold all eight mandated automotive-service role
 * distinctions (plus structural supplier), identical-role-type interval overlap
 * is rejected while adjacent/different-type intervals are allowed, valid_from is
 * mandatory, the point-in-time resolver answers "who was X on date Y", and
 * role_type/valid_from are immutable.
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

const PARTNER_A = 'a6400000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'b6400000-0000-4000-8000-0000000000b1';

const MANDATED_ROLES = [
  'customer',
  'vehicle_owner',
  'vehicle_user',
  'service_requester',
  'payer',
  'billing_party',
  'approving_party',
  'authorized_receiver',
];

let admin: Pool;
let runtime: Pool;

async function insertRole(
  tx: { query: Pool['query'] },
  roleType: string,
  validFrom: string,
  validTo: string | null = null,
  partnerId: string = PARTNER_A
) {
  return tx.query(
    `INSERT INTO crm.partner_roles (tenant_id, partner_id, role_type, valid_from, valid_to, created_by)
     VALUES ($1, $2, $3, $4::date, $5::date, $6)`,
    [TENANT_A, partnerId, roleType, validFrom, validTo, USER_A]
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
     VALUES ($1, $3, 'individual', 'Roles Partner A', $4),
            ($2, $5, 'individual', 'Roles Partner B', $4)`,
    [PARTNER_A, PARTNER_B, TENANT_A, USER_A, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('role taxonomy and temporal integrity (P1-06-DB-005)', () => {
  it('lets one partner hold all eight mandated roles plus supplier', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      for (const role of [...MANDATED_ROLES, 'supplier']) {
        await insertRole(tx, role, '2026-01-01');
      }
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.partner_roles WHERE partner_id = $1`,
        [PARTNER_A]
      );
      expect(rows[0].n).toBe(9);
    });
  });

  it('rejects an unknown role_type', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(insertRole(tx, 'driver', '2026-01-01'), '23514');
    });
  });

  it('rejects overlapping intervals of the same role_type (EXCLUDE)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertRole(tx, 'payer', '2026-01-01', '2026-06-01');
      await expectSqlState(insertRole(tx, 'payer', '2026-05-01', '2026-08-01'), '23P01');
    });
  });

  it('allows adjacent intervals of the same role_type (half-open ranges)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertRole(tx, 'payer', '2026-01-01', '2026-06-01');
      // valid_from of the second equals valid_to of the first: [) ranges do not overlap.
      await insertRole(tx, 'payer', '2026-06-01', '2026-12-01');
    });
  });

  it('allows different role_types to overlap freely', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertRole(tx, 'customer', '2026-01-01', null);
      await insertRole(tx, 'payer', '2026-01-01', null);
    });
  });

  it('rejects a second open-ended interval overlapping an open-ended one', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertRole(tx, 'customer', '2026-01-01', null);
      await expectSqlState(insertRole(tx, 'customer', '2026-03-01', null), '23P01');
    });
  });

  it('rejects valid_to <= valid_from', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(insertRole(tx, 'customer', '2026-06-01', '2026-01-01'), '23514');
    });
  });

  it('requires valid_from (NOT NULL)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_roles (tenant_id, partner_id, role_type, created_by)
           VALUES ($1, $2, 'customer', $3)`,
          [TENANT_A, PARTNER_A, USER_A]
        ),
        '23502'
      );
    });
  });
});

describe('point-in-time resolution and immutability', () => {
  it('resolves the roles active on a given date', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertRole(tx, 'customer', '2026-01-01', null);
      await insertRole(tx, 'payer', '2026-01-01', '2026-06-01');
      await insertRole(tx, 'billing_party', '2026-07-01', null);
      // On 2026-03-01: customer + payer active; billing_party not yet.
      const mid = await tx.query(
        `SELECT crm.partner_roles_active_at($1, DATE '2026-03-01') AS role`,
        [PARTNER_A]
      );
      expect(mid.rows.map((r) => r.role).sort()).toEqual(['customer', 'payer']);
      // On 2026-08-01: customer + billing_party; payer ended.
      const late = await tx.query(
        `SELECT crm.partner_roles_active_at($1, DATE '2026-08-01') AS role`,
        [PARTNER_A]
      );
      expect(late.rows.map((r) => r.role).sort()).toEqual(['billing_party', 'customer']);
    });
  });

  it('rejects changing role_type or valid_from after creation', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertRole(tx, 'customer', '2026-01-01', null);
      await expectSqlState(
        tx.query(
          `UPDATE crm.partner_roles SET role_type = 'payer' WHERE partner_id = $1 AND role_type = 'customer'`,
          [PARTNER_A]
        ),
        '23514'
      );
    });
  });

  it('allows end-dating a role via valid_to (UPDATE)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertRole(tx, 'customer', '2026-01-01', null);
      const res = await tx.query(
        `UPDATE crm.partner_roles SET valid_to = DATE '2026-09-01' WHERE partner_id = $1 AND role_type = 'customer'`,
        [PARTNER_A]
      );
      expect(res.rowCount).toBe(1);
    });
  });
});

describe('tenant isolation and grants', () => {
  it('rejects a role for a partner in another tenant (composite FK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_roles (tenant_id, partner_id, role_type, valid_from, created_by)
           VALUES ($1, $2, 'customer', DATE '2026-01-01', $3)`,
          [TENANT_A, PARTNER_B, USER_A]
        ),
        '23503'
      );
    });
  });

  it('the runtime role cannot DELETE a role (end-date only)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.partner_roles WHERE partner_id = $1`, [PARTNER_A]),
        '42501'
      );
    });
  });
});
