/**
 * Phase 1-3 — organizational scope FKs on shared.number_sequences
 * (P1-03-DB-016). The allocator behaviour itself remains pinned by the
 * Phase 1-2 suite; these tests prove the NEW structural scope only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  BRANCH_A1,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';

let admin: Pool;
let companyB1: string;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  const b = await admin.query(
    `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, 'company_b1', 'Fixture Company B1', 'USD', $2) RETURNING id`,
    [TENANT_B, USER_B]
  );
  companyB1 = b.rows[0].id;
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
});

describe('shared.number_sequences — organizational scope is structural now', () => {
  it('a sequence for a NON-EXISTENT tenant is rejected (23503)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.number_sequences (tenant_id, sequence_code, created_by)
         VALUES ('99999999-9999-4999-8999-999999999999', 'ghost_seq', $1)`,
        [USER_A]
      ),
      '23503'
    );
  });

  it("a sequence naming another tenant's company is rejected (composite FK → 23503)", async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO shared.number_sequences (tenant_id, company_id, sequence_code, created_by)
         VALUES ($1, $2, 'stolen_scope', $3)`,
        [TENANT_A, companyB1, USER_A]
      ),
      '23503'
    );
  });

  it('tenant-wide (NULL company/branch) and fully-scoped sequences both remain legal', async () => {
    const wide = await admin.query(
      `INSERT INTO shared.number_sequences (tenant_id, sequence_code, created_by)
       VALUES ($1, 'org_wide_seq', $2) RETURNING id`,
      [TENANT_A, USER_A]
    );
    const scoped = await admin.query(
      `INSERT INTO shared.number_sequences (tenant_id, company_id, branch_id, sequence_code, created_by)
       VALUES ($1, $2, $3, 'org_branch_seq', $4) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
    );
    expect(wide.rows).toHaveLength(1);
    expect(scoped.rows).toHaveLength(1);
    await admin.query('DELETE FROM shared.number_sequences WHERE id IN ($1, $2)', [
      wide.rows[0].id,
      scoped.rows[0].id,
    ]);
  });

  it('a referenced tenant cannot be deleted while sequences exist (RESTRICT → 23503)', async () => {
    const seq = await admin.query(
      `INSERT INTO shared.number_sequences (tenant_id, sequence_code, created_by)
       VALUES ($1, 'anchor_seq', $2) RETURNING id`,
      [TENANT_A, USER_A]
    );
    try {
      await expectSqlState(
        admin.query('DELETE FROM org.tenants WHERE id = $1', [TENANT_A]),
        '23503'
      );
    } finally {
      await admin.query('DELETE FROM shared.number_sequences WHERE id = $1', [seq.rows[0].id]);
    }
  });
});
