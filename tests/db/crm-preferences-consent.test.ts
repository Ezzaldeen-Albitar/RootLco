/**
 * Phase 1-6 CRM — crm.communication_preferences / crm.consent_history
 * (P1-06-DB-011/012, P1-06-SEC-003, P1-06-QA-004).
 *
 * Proves preferences are unique per (partner, channel, purpose) and NEVER grant
 * consent; consent is append-only and server-attributed; current_consent
 * resolves the latest effective state deterministically; a future-dated grant
 * cannot defeat a current withdrawal; and channel/purpose/kind are separate.
 *
 * Test-reference: TC-CRM-001, TC-NTF-001, TC-RLS-001.
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

const PARTNER_A = 'a6900000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'b6900000-0000-4000-8000-0000000000b1';
const CONTACT_A = 'a6910000-0000-4000-8000-0000000000a1';
const CONTACT_OTHER = 'a6910000-0000-4000-8000-0000000000a2';
const PARTNER_A2 = 'a6900000-0000-4000-8000-0000000000a2';

let admin: Pool;
let runtime: Pool;

// Insert a consent row with effective_at at (now() + offsetSeconds).
async function consent(
  tx: { query: Pool['query'] },
  kind: string,
  channel: string,
  purpose: string,
  status: string,
  offsetSeconds: number
) {
  return tx.query(
    `INSERT INTO crm.consent_history
       (tenant_id, partner_id, consent_kind, channel, purpose, status, effective_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)`,
    [TENANT_A, PARTNER_A, kind, channel, purpose, status, String(offsetSeconds)]
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
     VALUES ($1, $4, 'individual', 'PC Partner A', $5),
            ($2, $6, 'individual', 'PC Partner B', $5),
            ($3, $4, 'individual', 'PC Partner A2', $5)`,
    [PARTNER_A, PARTNER_B, PARTNER_A2, TENANT_A, USER_A, TENANT_B]
  );
  await admin.query(
    `INSERT INTO crm.contact_points (id, tenant_id, partner_id, channel, normalized_value, created_by)
     VALUES ($1, $3, $4, 'email', 'a@x.test', $5), ($2, $3, $6, 'email', 'other@x.test', $5)`,
    [CONTACT_A, CONTACT_OTHER, TENANT_A, PARTNER_A, USER_A, PARTNER_A2]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('communication preferences (P1-06-DB-011)', () => {
  it('is unique per (partner, channel, purpose) and does NOT grant consent', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.communication_preferences (tenant_id, partner_id, channel, purpose, preferred, created_by)
         VALUES ($1, $2, 'email', 'marketing', true, $3)`,
        [TENANT_A, PARTNER_A, USER_A]
      );
      // A preferred=true marketing preference must NOT create a consent row.
      const c = await tx.query(
        `SELECT crm.current_consent($1, 'marketing', 'email', 'marketing') AS status`,
        [PARTNER_A]
      );
      expect(c.rows[0].status).toBeNull();
      // Duplicate (partner, channel, purpose) is rejected.
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.communication_preferences (tenant_id, partner_id, channel, purpose, preferred, created_by)
           VALUES ($1, $2, 'email', 'marketing', false, $3)`,
          [TENANT_A, PARTNER_A, USER_A]
        ),
        '23505'
      );
    });
  });
});

describe('consent history (P1-06-DB-012, SEC-003)', () => {
  it('resolves the latest effective state and server-stamps the actor', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await consent(tx, 'marketing', 'email', 'marketing', 'granted', -3600);
      await consent(tx, 'marketing', 'email', 'marketing', 'withdrawn', -60);
      const c = await tx.query(
        `SELECT crm.current_consent($1, 'marketing', 'email', 'marketing') AS status`,
        [PARTNER_A]
      );
      expect(c.rows[0].status).toBe('withdrawn');
      const r = await tx.query(
        `SELECT recorded_by FROM crm.consent_history WHERE partner_id = $1 ORDER BY effective_at DESC LIMIT 1`,
        [PARTNER_A]
      );
      expect(r.rows[0].recorded_by).toBe(USER_A);
    });
  });

  it('rejects a future-dated consent so it cannot defeat a current withdrawal', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await consent(tx, 'marketing', 'email', 'marketing', 'withdrawn', -60);
      // A future-dated grant is rejected outright.
      await expectSqlState(
        consent(tx, 'marketing', 'email', 'marketing', 'granted', 86400),
        '23514'
      );
    });
  });

  it('separates channel, purpose, and kind', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await consent(tx, 'marketing', 'email', 'marketing', 'granted', -60);
      const emailMkt = await tx.query(
        `SELECT crm.current_consent($1, 'marketing', 'email', 'marketing') AS s`,
        [PARTNER_A]
      );
      const phoneMkt = await tx.query(
        `SELECT crm.current_consent($1, 'marketing', 'phone', 'marketing') AS s`,
        [PARTNER_A]
      );
      const emailPrivacy = await tx.query(
        `SELECT crm.current_consent($1, 'privacy', 'email', 'marketing') AS s`,
        [PARTNER_A]
      );
      expect(emailMkt.rows[0].s).toBe('granted');
      expect(phoneMkt.rows[0].s).toBeNull();
      expect(emailPrivacy.rows[0].s).toBeNull();
    });
  });

  it('links a same-partner contact point but rejects a cross-partner one', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.consent_history
           (tenant_id, partner_id, consent_kind, contact_point_id, channel, purpose, status, effective_at)
         VALUES ($1, $2, 'marketing', $3, 'email', 'marketing', 'granted', now())`,
        [TENANT_A, PARTNER_A, CONTACT_A]
      );
      // A contact point of a different partner is not reachable.
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.consent_history
             (tenant_id, partner_id, consent_kind, contact_point_id, channel, purpose, status, effective_at)
           VALUES ($1, $2, 'marketing', $3, 'email', 'marketing', 'granted', now())`,
          [TENANT_A, PARTNER_A, CONTACT_OTHER]
        ),
        '23503'
      );
    });
  });

  it('is append-only (UPDATE and DELETE denied)', async () => {
    await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await tx.query(
        `INSERT INTO crm.consent_history (id, tenant_id, partner_id, consent_kind, channel, purpose, status, effective_at)
         VALUES ($1, $2, $3, 'privacy', 'email', 'transactional', 'granted', now())`,
        ['a6920000-0000-4000-8000-000000000001', TENANT_A, PARTNER_A]
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`UPDATE crm.consent_history SET status = 'withdrawn' WHERE partner_id = $1`, [
          PARTNER_A,
        ]),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(`DELETE FROM crm.consent_history WHERE partner_id = $1`, [PARTNER_A]),
        '42501'
      );
    });
    await admin.query(`DELETE FROM crm.consent_history WHERE partner_id = $1`, [PARTNER_A]);
  });

  it('requires an actor in the session context', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.consent_history (tenant_id, partner_id, consent_kind, channel, purpose, status, effective_at)
           VALUES ($1, $2, 'marketing', 'email', 'marketing', 'granted', now())`,
          [TENANT_A, PARTNER_A]
        ),
        '23514'
      );
    });
  });
});
