/**
 * Phase 1-6 CRM — crm.communication_log / crm.timeline_events
 * (P1-06-DB-018/019). Communication records + the append-only timeline written
 * in the SAME transaction as its source change (emit triggers), one event per
 * source change, PII-safe titles, and append-only enforcement.
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
  withCommittedTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';

const PARTNER_A = 'a6d00000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'b6d00000-0000-4000-8000-0000000000b1';

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
     VALUES ($1, $3, 'individual', 'CT Partner A', $4), ($2, $5, 'individual', 'CT Partner B', $4)`,
    [PARTNER_A, PARTNER_B, TENANT_A, USER_A, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

async function logComm(
  tx: { query: Pool['query'] },
  direction: string,
  channel: string,
  partnerId = PARTNER_A
) {
  return tx.query(
    `INSERT INTO crm.communication_log (tenant_id, partner_id, direction, channel, subject, logged_by, created_by)
     VALUES ($1, $2, $3, $4, 'hello', $5, $5)`,
    [TENANT_A, partnerId, direction, channel, USER_A]
  );
}

describe('communication log (P1-06-DB-018)', () => {
  it('records inbound and outbound entries and rejects a bogus outbound-message link', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await logComm(tx, 'inbound', 'phone');
      await logComm(tx, 'outbound', 'email');
      // a non-existent outbound message in this tenant is a FK violation
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.communication_log (tenant_id, partner_id, direction, channel, outbound_message_id, logged_by, created_by)
           VALUES ($1, $2, 'outbound', 'email', gen_random_uuid(), $3, $3)`,
          [TENANT_A, PARTNER_A, USER_A]
        ),
        '23503'
      );
    });
  });

  it('rejects an invalid direction and a cross-tenant partner', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(logComm(tx, 'sideways', 'phone'), '23514');
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(logComm(tx, 'inbound', 'phone', PARTNER_B), '23503');
    });
  });
});

describe('timeline events (P1-06-DB-019)', () => {
  it('writes exactly one PII-safe timeline row in the same transaction as a status change', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.partner_status_history (tenant_id, partner_id, status_kind, from_state, to_state, reason)
         VALUES ($1, $2, 'lifecycle', 'prospect', 'active', 'won')`,
        [TENANT_A, PARTNER_A]
      );
      const { rows } = await tx.query(
        `SELECT event_type, title FROM crm.timeline_events WHERE partner_id = $1`,
        [PARTNER_A]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].event_type).toBe('lifecycle_changed');
      expect(rows[0].title).toContain('prospect');
    });
  });

  it('rolls the timeline row back when the source change rolls back', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.partner_status_history (tenant_id, partner_id, status_kind, to_state, reason)
         VALUES ($1, $2, 'commercial', 'watch', 'risk')`,
        [TENANT_A, PARTNER_A]
      );
    });
    // Fresh transaction: nothing persisted.
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM crm.timeline_events WHERE partner_id = $1`,
        [PARTNER_A]
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('emits a communication_logged event from the communication log', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await logComm(tx, 'outbound', 'email');
      const { rows } = await tx.query(
        `SELECT event_type FROM crm.timeline_events WHERE partner_id = $1`,
        [PARTNER_A]
      );
      expect(rows.map((r) => r.event_type)).toEqual(['communication_logged']);
    });
  });

  it('is append-only (UPDATE and DELETE denied)', async () => {
    await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await logComm(tx, 'inbound', 'phone'); // emits a committed timeline row
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`UPDATE crm.timeline_events SET title = 'x' WHERE partner_id = $1`, [PARTNER_A]),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.timeline_events WHERE partner_id = $1`, [PARTNER_A]),
        '42501'
      );
    });
    await admin.query(`DELETE FROM crm.timeline_events WHERE partner_id = $1`, [PARTNER_A]);
    await admin.query(`DELETE FROM crm.communication_log WHERE partner_id = $1`, [PARTNER_A]);
  });

  it('server-stamps attribution: a direct insert cannot forge actor_id or backdate occurred_at', async () => {
    // The direct-INSERT path exists (SECURITY DEFINER is forbidden, so writes
    // cannot be locked to the emit trigger). The BEFORE INSERT stamp trigger
    // therefore forces actor_id := current user and occurred_at := now(), so a
    // caller cannot forge attribution or backdate the event.
    const FORGED_ACTOR = '00000000-0000-4000-8000-0000000000ff';
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.timeline_events (tenant_id, partner_id, event_type, title, occurred_at, actor_id)
         VALUES ($1, $2, 'communication_logged', 'forge attempt', TIMESTAMPTZ '2000-01-01T00:00:00Z', $3)`,
        [TENANT_A, PARTNER_A, FORGED_ACTOR]
      );
      const { rows } = await tx.query(
        `SELECT actor_id, occurred_at FROM crm.timeline_events
          WHERE tenant_id = $1 AND partner_id = $2 AND title = 'forge attempt'`,
        [TENANT_A, PARTNER_A]
      );
      expect(rows[0].actor_id, 'actor_id must be stamped to the session user').toBe(USER_A);
      expect(
        new Date(rows[0].occurred_at).getUTCFullYear(),
        'occurred_at must be stamped to now(), not the backdated value'
      ).toBeGreaterThan(2000);
    });
  });
});
