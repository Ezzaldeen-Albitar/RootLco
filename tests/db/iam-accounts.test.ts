/**
 * Phase 1-4 Increment A — iam.user_accounts / user_profiles /
 * user_employee_links / user_status_history (P1-04-DB-001..004,
 * P1-04-QA-011 archived/lifecycle, P1-04-SEC credential-absence).
 *
 * Every isolation assertion runs as the NON-OWNER runtime login. The admin
 * connection provisions fixtures and exercises platform-only functions; it is
 * never RLS evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  withRolledBackTx,
} from './helpers';

const ACC_A1 = 'a0100000-0000-4000-8000-000000000001'; // tenant A, status invited
const ACC_A2 = 'a0100000-0000-4000-8000-000000000002'; // tenant A, status active
const ACC_B1 = 'b0100000-0000-4000-8000-000000000001'; // tenant B, status active
const ACTOR = USER_A;
const OTHER = 'c0000000-0000-4000-8000-0000000000ff';

let admin: Pool;
let runtime: Pool;

async function seedAccounts(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES
       ($1, $4, 'supabase', 'sub_a1', 'a1@example.com', 'User A1', 'invited', $6),
       ($2, $4, 'supabase', 'sub_a2', 'a2@example.com', 'User A2', 'active',  $6),
       ($3, $5, 'supabase', 'sub_b1', 'b1@example.com', 'User B1', 'active',  $6)
     ON CONFLICT (id) DO NOTHING`,
    [ACC_A1, ACC_A2, ACC_B1, TENANT_A, TENANT_B, ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.user_profiles (user_id, tenant_id, full_name, created_by)
     VALUES ($1, $2, 'Profile A1', $3) ON CONFLICT (user_id) DO NOTHING`,
    [ACC_A1, TENANT_A, ACTOR]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedAccounts();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('iam.user_accounts — tenant isolation and read scope', () => {
  it('a runtime session reads only its own tenant accounts', async () => {
    const rows = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query('SELECT id, tenant_id FROM iam.user_accounts ORDER BY provider_subject')
    );
    const ids = rows.rows.map((r) => r.id);
    expect(ids).toContain(ACC_A1);
    expect(ids).toContain(ACC_A2);
    expect(ids).not.toContain(ACC_B1);
  });

  it('a tenant A session cannot see tenant B accounts even by explicit id', async () => {
    const rows = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query('SELECT id FROM iam.user_accounts WHERE id = $1', [ACC_B1])
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('no context means no rows (default deny)', async () => {
    const rows = await withRolledBackTx(runtime, {}, (c) =>
      c.query('SELECT id FROM iam.user_accounts')
    );
    expect(rows.rows).toHaveLength(0);
  });
});

describe('iam.user_accounts — writes are platform-only', () => {
  it('runtime cannot INSERT an account (no grant)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.user_accounts (tenant_id, identity_provider, provider_subject, email, display_name, created_by)
           VALUES ($1, 'supabase', 'sub_x', 'x@example.com', 'X', $2)`,
          [TENANT_A, ACTOR]
        ),
        '42501'
      )
    );
  });

  it('runtime cannot UPDATE or DELETE an account (no grant)', async () => {
    const ctx = { tenantId: TENANT_A, userId: ACTOR };
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.user_accounts SET display_name = 'hacked' WHERE id = $1`, [ACC_A1]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(c.query(`DELETE FROM iam.user_accounts WHERE id = $1`, [ACC_A1]), '42501')
    );
  });

  it('identity columns are immutable (even to admin)', async () => {
    // Each denial in its OWN transaction: a raised error aborts the tx.
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.user_accounts SET identity_provider = 'other' WHERE id = $1`, [ACC_A1]),
        '23514'
      )
    );
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.user_accounts SET provider_subject = 'moved' WHERE id = $1`, [ACC_A1]),
        '23514'
      )
    );
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.user_accounts SET tenant_id = $2 WHERE id = $1`, [ACC_A1, TENANT_B]),
        '23514'
      )
    );
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.user_accounts SET created_by = $2 WHERE id = $1`, [ACC_A1, OTHER]),
        '23514'
      )
    );
  });

  it('stores NO credential-shaped column on any iam.user_* table', async () => {
    const { rows } = await admin.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'iam' AND table_name LIKE 'user_%'
         AND column_name ~* '(password|passwd|secret|token|credential|refresh|otp|mfa_secret|pin|hash)'`
    );
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
  });
});

describe('iam.user_accounts — active uniqueness', () => {
  it('rejects a second active account with the same email in the same tenant', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.user_accounts (tenant_id, identity_provider, provider_subject, email, display_name, created_by)
           VALUES ($1, 'supabase', 'sub_dup', 'a1@example.com', 'Dup', $2)`,
          [TENANT_A, ACTOR]
        ),
        '23505'
      )
    );
  });

  it('allows the same email in a different tenant', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      const r = await c.query(
        `INSERT INTO iam.user_accounts (tenant_id, identity_provider, provider_subject, email, display_name, created_by)
         VALUES ($1, 'supabase', 'sub_bnew', 'a1@example.com', 'Cross', $2) RETURNING id`,
        [TENANT_B, ACTOR]
      );
      expect(r.rows).toHaveLength(1);
    });
  });

  it('allows reusing an email once the prior account is soft-deleted', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      await c.query(`UPDATE iam.user_accounts SET deleted_at = now() WHERE id = $1`, [ACC_A2]);
      const r = await c.query(
        `INSERT INTO iam.user_accounts (tenant_id, identity_provider, provider_subject, email, display_name, created_by)
         VALUES ($1, 'supabase', 'sub_reuse', 'a2@example.com', 'Reuse', $2) RETURNING id`,
        [TENANT_A, ACTOR]
      );
      expect(r.rows).toHaveLength(1);
    });
  });
});

describe('iam.user_profiles — one per user, tenant-scoped', () => {
  it('rejects a second profile for the same user', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`INSERT INTO iam.user_profiles (user_id, tenant_id, created_by) VALUES ($1,$2,$3)`, [
          ACC_A1,
          TENANT_A,
          ACTOR,
        ]),
        '23505'
      )
    );
  });

  it('rejects a profile whose tenant does not match the account (cross-tenant FK)', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`INSERT INTO iam.user_profiles (user_id, tenant_id, created_by) VALUES ($1,$2,$3)`, [
          ACC_A2,
          TENANT_B,
          ACTOR,
        ]),
        '23503'
      )
    );
  });
});

describe('iam.user_employee_links — overlap-free intervals', () => {
  it('rejects two overlapping employment intervals for the same user', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      await c.query(
        `INSERT INTO iam.user_employee_links (tenant_id, user_id, employee_ref, valid_from, valid_to, created_by)
         VALUES ($1,$2,'EMP-1','2026-01-01','2026-06-01',$3)`,
        [TENANT_A, ACC_A1, ACTOR]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO iam.user_employee_links (tenant_id, user_id, employee_ref, valid_from, valid_to, created_by)
           VALUES ($1,$2,'EMP-2','2026-03-01','2026-09-01',$3)`,
          [TENANT_A, ACC_A1, ACTOR]
        ),
        '23P01'
      );
    });
  });
});

describe('iam.change_user_status — atomic, attributed, append-only', () => {
  it('a valid transition updates status and writes server-attributed history', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      await c.query(`SELECT iam.change_user_status($1,'active','onboarding complete')`, [ACC_A1]);
      const acc = await c.query(`SELECT status FROM iam.user_accounts WHERE id = $1`, [ACC_A1]);
      expect(acc.rows[0].status).toBe('active');
      const hist = await c.query(
        `SELECT from_state, to_state, actor_id FROM iam.user_status_history
         WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
        [ACC_A1]
      );
      expect(hist.rows[0]).toMatchObject({ from_state: 'invited', to_state: 'active', actor_id: ACTOR });
    });
  });

  it('rejects an invalid transition (invited -> locked)', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(c.query(`SELECT iam.change_user_status($1,'locked','x')`, [ACC_A1]), '23514')
    );
  });

  it('requires an actor in the session context', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(c.query(`SELECT iam.change_user_status($1,'active','x')`, [ACC_A1]), '23514')
    );
  });
});

describe('iam.user_status_history — forgery-proof, append-only', () => {
  it('the stamp trigger overwrites a forged actor with the session actor', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      const r = await c.query(
        `INSERT INTO iam.user_status_history (tenant_id, user_id, from_state, to_state, reason, actor_id)
         VALUES ($1,$2,'invited','active','forge', $3) RETURNING actor_id`,
        [TENANT_A, ACC_A1, OTHER]
      );
      expect(r.rows[0].actor_id).toBe(ACTOR); // forged OTHER overwritten to session actor
    });
  });

  it('an insert with no session actor is rejected', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.user_status_history (tenant_id, user_id, from_state, to_state, reason, actor_id)
           VALUES ($1,$2,'invited','active','x',$3)`,
          [TENANT_A, ACC_A1, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('runtime cannot append, update, or delete history', async () => {
    const ctx = { tenantId: TENANT_A, userId: ACTOR };
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.user_status_history (tenant_id, user_id, to_state, reason, actor_id)
           VALUES ($1,$2,'active','x',$3)`,
          [TENANT_A, ACC_A1, ACTOR]
        ),
        '42501'
      )
    );
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.user_status_history SET reason = 'x' WHERE user_id = $1`, [ACC_A1]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(`DELETE FROM iam.user_status_history WHERE user_id = $1`, [ACC_A1]),
        '42501'
      )
    );
  });
});
