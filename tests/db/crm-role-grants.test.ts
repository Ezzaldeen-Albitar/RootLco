/**
 * Phase 1-6 CRM — application-role grant surface (P1-06-DB-023, P1-06-QA-006).
 *
 * Behavioral coverage for the two non-runtime archetypes on crm tables, so a
 * grant drift (app_readonly gaining a write, or app_worker gaining any crm
 * access) is caught: app_readonly may only read (tenant-scoped) and every write
 * is denied; app_worker has NO crm grant at all, so even a SELECT is denied.
 * The request-path role app_runtime is exercised throughout the other suites.
 *
 * Test-reference: TC-RLS-001, TC-CRM-001.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  readonlyPool,
  workerPool,
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

let admin: Pool;
let readonly: Pool;
let worker: Pool;

beforeAll(async () => {
  admin = adminPool();
  readonly = readonlyPool();
  worker = workerPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1, $3, 'individual', 'RO Partner A', $4), ($2, $5, 'individual', 'RO Partner B', $4)`,
    [PARTNER_A, PARTNER_B, TENANT_A, USER_A, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await readonly.end();
  await worker.end();
  await admin.end();
});

describe('app_readonly — read-only, tenant-scoped (P1-06-DB-023)', () => {
  it('reads its own tenant rows and zero rows of another tenant', async () => {
    await withRolledBackTx(readonly, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const own = await tx.query(`SELECT count(*)::int AS n FROM crm.business_partners`);
      expect(own.rows[0].n).toBeGreaterThan(0);
      const other = await tx.query(
        `SELECT count(*)::int AS n FROM crm.business_partners WHERE tenant_id = $1`,
        [TENANT_B]
      );
      expect(other.rows[0].n, 'app_readonly must not see another tenant').toBe(0);
    });
  });

  it('cannot INSERT, UPDATE, or DELETE a crm table (no write grant -> 42501)', async () => {
    await withRolledBackTx(readonly, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
           VALUES ($1, 'individual', 'RO write', $2)`,
          [TENANT_A, USER_A]
        ),
        '42501'
      );
    });
    await withRolledBackTx(readonly, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`UPDATE crm.business_partners SET display_name = 'x' WHERE id = $1`, [PARTNER_A]),
        '42501'
      );
    });
    await withRolledBackTx(readonly, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.business_partners WHERE id = $1`, [PARTNER_A]),
        '42501'
      );
    });
  });
});

describe('app_worker — no crm access at all (P1-06-DB-023)', () => {
  it('cannot even SELECT a crm table (no grant -> 42501)', async () => {
    await withRolledBackTx(worker, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(tx.query(`SELECT 1 FROM crm.business_partners LIMIT 1`), '42501');
    });
  });

  it('cannot write a crm table, including append-only history (no grant -> 42501)', async () => {
    await withRolledBackTx(worker, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
           VALUES ($1, 'individual', 'W write', $2)`,
          [TENANT_A, USER_A]
        ),
        '42501'
      );
    });
    await withRolledBackTx(worker, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`SELECT 1 FROM crm.partner_status_history LIMIT 1`),
        '42501'
      );
    });
  });
});
