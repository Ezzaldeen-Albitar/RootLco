/**
 * Phase 1-6 CRM — partner display-number allocation (P1-06-DB-020, P1-06-QA-007).
 *
 * The 'partner' sequence is per-tenant onboarding configuration in
 * shared.number_sequences (admin/provisioning path — never seeded, never a
 * custom allocator). Allocation rides shared.next_display_number('partner') as
 * the runtime role. This suite proves concurrency-safe uniqueness, per-tenant
 * separation, and that an allocated number satisfies the business_partners
 * tenant-scoped display-number uniqueness constraint.
 *
 * Test-reference: TC-CON-001.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withCommittedTx,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';

let admin: Pool;
let runtime: Pool;

async function provisionPartnerSequence(tenantId: string) {
  await admin.query(
    `INSERT INTO shared.number_sequences (tenant_id, sequence_code, prefix_template, pad_width, created_by)
     VALUES ($1, 'partner', 'BP-', 6, $2)
     ON CONFLICT ON CONSTRAINT uq_number_sequences_scope DO NOTHING`,
    [tenantId, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool(12);
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await provisionPartnerSequence(TENANT_A);
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('partner display numbers (P1-06-DB-020)', () => {
  it('allocates a formatted display number via the shared allocator', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT display_number, sequence_value FROM shared.next_display_number('partner')`
      );
      expect(rows[0].display_number).toMatch(/^BP-\d{6}$/);
      expect(Number(rows[0].sequence_value)).toBeGreaterThan(0);
    });
  });

  it('yields unique display numbers under concurrent allocation', async () => {
    const N = 10;
    const clients = await Promise.all(Array.from({ length: N }, () => runtime.connect()));
    try {
      const results = await Promise.all(
        clients.map(async (c) => {
          await c.query('BEGIN');
          await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
          await c.query(`SELECT set_config('app.user_id', $1, true)`, [USER_A]);
          const r = await c.query(
            `SELECT display_number FROM shared.next_display_number('partner')`
          );
          await c.query('COMMIT');
          return r.rows[0].display_number as string;
        })
      );
      expect(new Set(results).size).toBe(N); // all distinct — no duplicates
    } finally {
      clients.forEach((c) => c.release());
    }
  });

  it('keeps sequences separate per tenant and requires a provisioned sequence', async () => {
    // Tenant B has no 'partner' sequence provisioned -> allocation fails (P0002).
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`SELECT display_number FROM shared.next_display_number('partner')`),
        'P0002'
      );
    });
  });

  it('an allocated number satisfies the business_partners uniqueness constraint', async () => {
    let allocated = '';
    await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const r = await tx.query(`SELECT display_number FROM shared.next_display_number('partner')`);
      allocated = r.rows[0].display_number;
      await tx.query(
        `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, display_number, created_by)
         VALUES (gen_random_uuid(), $1, 'individual', 'Numbered', $2, $3)`,
        [TENANT_A, allocated, USER_A]
      );
    });
    // A second live partner with the same display number is rejected.
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, display_number, created_by)
           VALUES (gen_random_uuid(), $1, 'individual', 'Dup', $2, $3)`,
          [TENANT_A, allocated, USER_A]
        ),
        '23505'
      );
    });
    await admin.query(
      `DELETE FROM crm.business_partners WHERE tenant_id = $1 AND display_number = $2`,
      [TENANT_A, allocated]
    );
  });
});
