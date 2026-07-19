/**
 * Phase 1-6 CRM — crm.business_partners party master (P1-06-DB-001, P1-06-QA-001).
 *
 * Proves FR-CRM-001 (partner exists independently of any role), the lifecycle /
 * commercial status CHECKs, tenant-scoped display-number uniqueness, the
 * lossless merge-redirect integrity guard (no self-merge, no cross-tenant
 * survivor, no redirect into a merged survivor = no cycle, frozen-once-merged),
 * and tenant isolation asserted through the NON-owner runtime login.
 *
 * Test-reference: TC-CRM-001, TC-RLS-001. Provisioning runs on the admin pool;
 * every isolation/denial assertion runs on rootlco_test_runtime (app_runtime).
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

// Deterministic partner ids: tenant A -> a6..., tenant B -> b6... (phase 1-6).
const PARTNER_A_IND = 'a6000000-0000-4000-8000-000000000001';
const PARTNER_A_ORG = 'a6000000-0000-4000-8000-000000000002';
const PARTNER_B_IND = 'b6000000-0000-4000-8000-000000000001';

let admin: Pool;
let runtime: Pool;

async function insertPartner(
  tx: { query: Pool['query'] },
  id: string,
  partyType: 'individual' | 'organization',
  displayName: string,
  displayNumber: string | null = null
) {
  return tx.query(
    `INSERT INTO crm.business_partners
       (id, tenant_id, party_type, display_name, display_number, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, TENANT_A, partyType, displayName, displayNumber, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  // Committed fixtures for isolation tests: two partners in A, one in B.
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, display_number, created_by)
     VALUES
       ($1, $4, 'individual',   'Fixture Individual A', 'BP-A-0001', $6),
       ($2, $4, 'organization', 'Fixture Company A',    'BP-A-0002', $6),
       ($3, $5, 'individual',   'Fixture Individual B', 'BP-B-0001', $6)`,
    [PARTNER_A_IND, PARTNER_A_ORG, PARTNER_B_IND, TENANT_A, TENANT_B, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('party master creation and constraints (FR-CRM-001)', () => {
  it('creates an individual and an organization partner via the runtime login', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertPartner(tx, 'a6000000-0000-4000-8000-0000000000f1', 'individual', 'New Person');
      await insertPartner(
        tx,
        'a6000000-0000-4000-8000-0000000000f2',
        'organization',
        'New Company'
      );
      const { rows } = await tx.query(
        `SELECT lifecycle_status, commercial_status FROM crm.business_partners
          WHERE id = 'a6000000-0000-4000-8000-0000000000f1'`
      );
      expect(rows[0]).toEqual({ lifecycle_status: 'prospect', commercial_status: 'normal' });
    });
  });

  it('rejects an invalid party_type', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
           VALUES ($1, 'company', 'X', $2)`,
          [TENANT_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects an invalid lifecycle_status', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, lifecycle_status, created_by)
           VALUES ($1, 'individual', 'X', 'archived', $2)`,
          [TENANT_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects an invalid commercial_status', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, commercial_status, created_by)
           VALUES ($1, 'individual', 'X', 'frozen', $2)`,
          [TENANT_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects a blank display_name', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
           VALUES ($1, 'individual', '   ', $2)`,
          [TENANT_A, USER_A]
        ),
        '23514'
      );
    });
  });

  it('enforces tenant-scoped display-number uniqueness among live rows, freed by soft delete', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      // Soft delete frees the number for reuse (do this first — no failing
      // statement, so the transaction stays healthy).
      await insertPartner(
        tx,
        'a6000000-0000-4000-8000-0000000000d1',
        'individual',
        'Dup1',
        'DUP-1'
      );
      await tx.query(
        `UPDATE crm.business_partners SET deleted_at = now(), deleted_by = $2 WHERE id = $1`,
        ['a6000000-0000-4000-8000-0000000000d1', USER_A]
      );
      await insertPartner(
        tx,
        'a6000000-0000-4000-8000-0000000000d3',
        'individual',
        'Dup3',
        'DUP-1'
      );
      // Now d3 is the live 'DUP-1'; a second live row with the same number in
      // the same tenant is rejected (last statement — it aborts the tx, which
      // then rolls back).
      await expectSqlState(
        insertPartner(tx, 'a6000000-0000-4000-8000-0000000000d2', 'individual', 'Dup2', 'DUP-1'),
        '23505'
      );
    });
  });
});

describe('merge-redirect integrity (BR-CRM-001, FR-CRM-003)', () => {
  it('rejects merged status without a redirect and a redirect without merged status (coherence)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertPartner(tx, 'a6000000-0000-4000-8000-0000000000c1', 'individual', 'Coh');
      await expectSqlState(
        tx.query(
          `UPDATE crm.business_partners SET lifecycle_status = 'merged' WHERE id = 'a6000000-0000-4000-8000-0000000000c1'`
        ),
        '23514'
      );
    });
  });

  it('rejects a self-redirect', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertPartner(tx, 'a6000000-0000-4000-8000-0000000000c2', 'individual', 'Self');
      await expectSqlState(
        tx.query(
          `UPDATE crm.business_partners
              SET lifecycle_status = 'merged', merged_into_id = 'a6000000-0000-4000-8000-0000000000c2'
            WHERE id = 'a6000000-0000-4000-8000-0000000000c2'`
        ),
        '23514'
      );
    });
  });

  it('merges a source into a live survivor and then freezes the merged source', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertPartner(tx, 'a6000000-0000-4000-8000-00000000e001', 'individual', 'Source');
      await insertPartner(tx, 'a6000000-0000-4000-8000-00000000e002', 'organization', 'Survivor');
      await tx.query(
        `UPDATE crm.business_partners
            SET lifecycle_status = 'merged', merged_into_id = 'a6000000-0000-4000-8000-00000000e002'
          WHERE id = 'a6000000-0000-4000-8000-00000000e001'`
      );
      // Frozen: any further update to the merged source is rejected.
      await expectSqlState(
        tx.query(
          `UPDATE crm.business_partners SET display_name = 'x' WHERE id = 'a6000000-0000-4000-8000-00000000e001'`
        ),
        '23514'
      );
    });
  });

  it('rejects a redirect into an already-merged survivor (no cycle / chain-into-merged)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertPartner(tx, 'a6000000-0000-4000-8000-00000000e011', 'individual', 'S2');
      await insertPartner(tx, 'a6000000-0000-4000-8000-00000000e012', 'individual', 'V2');
      await insertPartner(tx, 'a6000000-0000-4000-8000-00000000e013', 'individual', 'W2');
      await tx.query(
        `UPDATE crm.business_partners SET lifecycle_status='merged', merged_into_id='a6000000-0000-4000-8000-00000000e012' WHERE id='a6000000-0000-4000-8000-00000000e011'`
      );
      // s2 is now merged; pointing w2 at s2 (a merged survivor) must fail.
      await expectSqlState(
        tx.query(
          `UPDATE crm.business_partners SET lifecycle_status='merged', merged_into_id='a6000000-0000-4000-8000-00000000e011' WHERE id='a6000000-0000-4000-8000-00000000e013'`
        ),
        '23514'
      );
    });
  });

  it('rejects a cross-tenant survivor (composite self-FK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await insertPartner(tx, 'a6000000-0000-4000-8000-00000000e021', 'individual', 'X1');
      // PARTNER_B_IND belongs to tenant B; (TENANT_A, PARTNER_B_IND) is not a row -> 23503.
      await expectSqlState(
        tx.query(
          `UPDATE crm.business_partners SET lifecycle_status='merged', merged_into_id=$1 WHERE id='a6000000-0000-4000-8000-00000000e021'`,
          [PARTNER_B_IND]
        ),
        '23503'
      );
    });
  });
});

describe('tenant isolation and grants (TC-RLS-001)', () => {
  it('tenant A cannot read tenant B partners even when addressing them directly', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.business_partners WHERE tenant_id = $1`,
        [TENANT_B]
      );
      expect(rows[0].n).toBe(0);
      const own = await tx.query(`SELECT count(*)::int AS n FROM crm.business_partners`);
      expect(own.rows[0].n).toBe(2); // the two committed tenant-A fixtures
    });
  });

  it('tenant A cannot insert a row into tenant B (WITH CHECK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
           VALUES ($1, 'individual', 'Sneaky', $2)`,
          [TENANT_B, USER_A]
        ),
        '42501'
      );
    });
  });

  it('the runtime role cannot DELETE a partner (soft delete only)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.business_partners WHERE id = $1`, [PARTNER_A_IND]),
        '42501'
      );
    });
  });
});

describe('immutability', () => {
  it('rejects changing party_type after creation', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`UPDATE crm.business_partners SET party_type = 'organization' WHERE id = $1`, [
          PARTNER_A_IND,
        ]),
        '23514'
      );
    });
  });
});
