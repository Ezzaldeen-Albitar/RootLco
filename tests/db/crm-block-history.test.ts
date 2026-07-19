/**
 * Phase 1-6 CRM — crm.customer_block_history + block/lifecycle coherence
 * (P1-06-DB-015, P1-06-QA-005). Append-only, server-attributed block/unblock
 * history and the atomic primitive: a partner cannot become (or leave) 'blocked'
 * without a matching latest block-history row written first in the same tx.
 *
 * Test-reference: TC-CRM-001, TC-AUD-001, TC-RLS-001.
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
  withCommittedTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';

const PARTNER_A = 'a6b00000-0000-4000-8000-0000000000a1';
const SURVIVOR = 'a6b00000-0000-4000-8000-0000000000a2';
const PARTNER_B = 'b6b00000-0000-4000-8000-0000000000b1';

let admin: Pool;
let runtime: Pool;

async function blockRow(tx: { query: Pool['query'] }, action: string, partnerId = PARTNER_A) {
  return tx.query(
    `INSERT INTO crm.customer_block_history (tenant_id, partner_id, action, reason)
     VALUES ($1, $2, $3, 'policy')`,
    [TENANT_A, partnerId, action]
  );
}
async function setLifecycle(tx: { query: Pool['query'] }, status: string, partnerId = PARTNER_A) {
  return tx.query(`UPDATE crm.business_partners SET lifecycle_status = $2 WHERE id = $1`, [
    partnerId,
    status,
  ]);
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
     VALUES ($1, $4, 'individual', 'Blk Partner A', 'active', $5),
            ($2, $4, 'individual', 'Blk Survivor', 'active', $5),
            ($3, $6, 'individual', 'Blk Partner B', 'active', $5)`,
    [PARTNER_A, SURVIVOR, PARTNER_B, TENANT_A, USER_A, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('block/unblock coherence (P1-06-DB-015)', () => {
  it('blocks a partner when a matching block-history row is written first', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await blockRow(tx, 'blocked');
      const res = await setLifecycle(tx, 'blocked');
      expect(res.rowCount).toBe(1);
    });
  });

  it('rejects blocking a partner with no block-history row', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(setLifecycle(tx, 'blocked'), '23514');
    });
  });

  it('unblocks only when a matching unblock-history row is written first', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await blockRow(tx, 'blocked');
      await setLifecycle(tx, 'blocked');
      // unblock without a matching row is rejected
      await expectSqlState(setLifecycle(tx, 'active'), '23514');
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await blockRow(tx, 'blocked');
      await setLifecycle(tx, 'blocked');
      await blockRow(tx, 'unblocked');
      const res = await setLifecycle(tx, 'active');
      expect(res.rowCount).toBe(1);
    });
  });

  it('exempts a blocked -> merged transition from the unblock requirement', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await blockRow(tx, 'blocked');
      await setLifecycle(tx, 'blocked');
      // merging the blocked partner into a live survivor needs no unblock row
      const res = await tx.query(
        `UPDATE crm.business_partners SET lifecycle_status = 'merged', merged_into_id = $2 WHERE id = $1`,
        [PARTNER_A, SURVIVOR]
      );
      expect(res.rowCount).toBe(1);
    });
  });
});

describe('append-only history and attribution', () => {
  it('server-stamps the actor and rejects a blank reason', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await blockRow(tx, 'blocked');
      const r = await tx.query(
        `SELECT actor_id FROM crm.customer_block_history WHERE partner_id = $1`,
        [PARTNER_A]
      );
      expect(r.rows[0].actor_id).toBe(USER_A);
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.customer_block_history (tenant_id, partner_id, action, reason)
           VALUES ($1, $2, 'blocked', '  ')`,
          [TENANT_A, PARTNER_A]
        ),
        '23514'
      );
    });
  });

  it('denies UPDATE and DELETE on block history', async () => {
    await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.customer_block_history (id, tenant_id, partner_id, action, reason)
         VALUES ($1, $2, $3, 'blocked', 'seed')`,
        ['a6b10000-0000-4000-8000-000000000001', TENANT_A, PARTNER_A]
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`UPDATE crm.customer_block_history SET reason = 'x' WHERE partner_id = $1`, [
          PARTNER_A,
        ]),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.customer_block_history WHERE partner_id = $1`, [PARTNER_A]),
        '42501'
      );
    });
    await admin.query(`DELETE FROM crm.customer_block_history WHERE partner_id = $1`, [PARTNER_A]);
  });
});
