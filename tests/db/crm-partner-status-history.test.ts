/**
 * Phase 1-6 CRM — crm.partner_status_history (P1-06-DB-006, P1-06-QA-005).
 *
 * Proves the append-only, server-stamped attributable record: actor_id and
 * occurred_at are stamped from session context (a caller cannot forge them),
 * no-op transitions are rejected, states are validated per kind, and
 * UPDATE/DELETE are denied (42501).
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
  USER_B,
} from './helpers';

const PARTNER_A = 'a6500000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'b6500000-0000-4000-8000-0000000000b1';

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
     VALUES ($1, $3, 'individual', 'History Partner A', $4),
            ($2, $5, 'individual', 'History Partner B', $4)`,
    [PARTNER_A, PARTNER_B, TENANT_A, USER_A, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('append-only status history (P1-06-DB-006)', () => {
  it('records a lifecycle transition and server-stamps actor_id + occurred_at', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.partner_status_history (tenant_id, partner_id, status_kind, from_state, to_state, reason, actor_id)
         VALUES ($1, $2, 'lifecycle', 'active', 'blocked', 'fraud review', $3)`,
        [TENANT_A, PARTNER_A, USER_B] // caller-supplied actor_id must be ignored
      );
      const { rows } = await tx.query(
        `SELECT actor_id, occurred_at FROM crm.partner_status_history WHERE partner_id = $1`,
        [PARTNER_A]
      );
      // Stamped to the SESSION user, not the caller-supplied USER_B.
      expect(rows[0].actor_id).toBe(USER_A);
      expect(rows[0].occurred_at).toBeInstanceOf(Date);
    });
  });

  it('requires an actor in the session context (stamp RAISEs when absent)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_status_history (tenant_id, partner_id, status_kind, to_state, reason)
           VALUES ($1, $2, 'commercial', 'watch', 'risk')`,
          [TENANT_A, PARTNER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects a no-op transition (from_state = to_state)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_status_history (tenant_id, partner_id, status_kind, from_state, to_state, reason)
           VALUES ($1, $2, 'lifecycle', 'active', 'active', 'noop')`,
          [TENANT_A, PARTNER_A]
        ),
        '23514'
      );
    });
  });

  it('rejects a state that is invalid for its kind', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      // 'normal' is a commercial state, not a lifecycle state.
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_status_history (tenant_id, partner_id, status_kind, to_state, reason)
           VALUES ($1, $2, 'lifecycle', 'normal', 'wrong kind')`,
          [TENANT_A, PARTNER_A]
        ),
        '23514'
      );
    });
  });

  it('requires a non-blank reason', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_status_history (tenant_id, partner_id, status_kind, to_state, reason)
           VALUES ($1, $2, 'commercial', 'hold', '   ')`,
          [TENANT_A, PARTNER_A]
        ),
        '23514'
      );
    });
  });
});

describe('append-only enforcement and isolation', () => {
  it('denies UPDATE and DELETE to the runtime role (42501)', async () => {
    // Seed one committed row via the runtime login (its context feeds the stamp).
    await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.partner_status_history (id, tenant_id, partner_id, status_kind, to_state, reason)
         VALUES ($1, $2, $3, 'lifecycle', 'active', 'onboarded')`,
        ['a6510000-0000-4000-8000-000000000001', TENANT_A, PARTNER_A]
      );
    });
    // Separate transactions: a failed statement poisons its transaction.
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`UPDATE crm.partner_status_history SET reason = 'x' WHERE partner_id = $1`, [
          PARTNER_A,
        ]),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.partner_status_history WHERE partner_id = $1`, [PARTNER_A]),
        '42501'
      );
    });
    await admin.query(`DELETE FROM crm.partner_status_history WHERE partner_id = $1`, [PARTNER_A]);
  });

  it('rejects history for a partner in another tenant (composite FK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_status_history (tenant_id, partner_id, status_kind, to_state, reason)
           VALUES ($1, $2, 'lifecycle', 'active', 'x')`,
          [TENANT_A, PARTNER_B]
        ),
        '23503'
      );
    });
  });
});
