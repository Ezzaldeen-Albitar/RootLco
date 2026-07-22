/**
 * Phase 1-4 Increment E — iam.login_audit / iam.user_sessions
 * (P1-04-DB-012..013).
 *
 * No credential, token, plaintext IP, or plaintext user-agent is stored. Login
 * audit is append-only and server-stamped; a user reads only their own login
 * history and their own sessions. Isolation runs as the non-owner runtime login.
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
  USER_A,
  withRolledBackTx,
} from './helpers';

const ACC_A = 'a0600000-0000-4000-8000-000000000001';
const ACC_A2 = 'a0600000-0000-4000-8000-000000000002';
const ACTOR = USER_A;
const CORR = 'cccccccc-0000-4000-8000-000000000006';

let admin: Pool;
let runtime: Pool;

async function seed(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$3,'supabase','sess_a','sa@example.com','Sess A','active',$4),
            ($2,$3,'supabase','sess_a2','sa2@example.com','Sess A2','active',$4)
     ON CONFLICT (id) DO NOTHING`,
    [ACC_A, ACC_A2, TENANT_A, ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.login_audit (tenant_id, user_id, event_type, ip_hash, user_agent_hash, correlation_id)
     VALUES ($1,$2,'success','h_ip','h_ua',$4),
            ($1,$3,'success','h_ip','h_ua',$4),
            (NULL,NULL,'failure','h_ip','h_ua',$4)`,
    [TENANT_A, ACC_A, ACC_A2, CORR]
  );
  await admin.query(
    `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, created_by)
     VALUES ($1,$2,'sess-a-1',$4), ($1,$3,'sess-a-2',$4)`,
    [TENANT_A, ACC_A, ACC_A2, ACTOR]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seed();
});

afterAll(async () => {
  await admin.query(`DELETE FROM iam.login_audit WHERE correlation_id = $1`, [CORR]); // null-tenant rows
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('iam — no credential / plaintext-network columns anywhere', () => {
  it('no iam table stores a password, token, secret, or plaintext IP/user-agent', async () => {
    const creds = await admin.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='iam'
         AND column_name ~* '(password|passwd|secret|refresh|mfa_secret|token)'`
    );
    expect(creds.rows).toEqual([]);
    const plaintext = await admin.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='iam' AND column_name IN ('ip_address','user_agent','ip','useragent')`
    );
    expect(plaintext.rows).toEqual([]);
  });
});

describe('iam.login_audit — append-only, server-stamped, own-history', () => {
  it('server-stamps occurred_at (backdating is ignored)', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      const r = await c.query(
        `INSERT INTO iam.login_audit (tenant_id, user_id, event_type, occurred_at)
         VALUES ($1,$2,'success','2000-01-01') RETURNING occurred_at`,
        [TENANT_A, ACC_A]
      );
      expect(new Date(r.rows[0].occurred_at).getFullYear()).toBeGreaterThan(2020);
    });
  });

  it('a non-failure event requires a known user; failure may be anonymous', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.login_audit (tenant_id, user_id, event_type) VALUES ($1,NULL,'success')`,
          [TENANT_A]
        ),
        '23514'
      )
    );
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      const r = await c.query(
        `INSERT INTO iam.login_audit (tenant_id, user_id, event_type) VALUES (NULL,NULL,'failure') RETURNING id`
      );
      expect(r.rows).toHaveLength(1);
    });
  });

  it('a known user implies a known tenant', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.login_audit (tenant_id, user_id, event_type) VALUES (NULL,$1,'success')`,
          [ACC_A]
        ),
        '23514'
      )
    );
  });

  it('a user reads only their own login events; anonymous failures are visible to none', async () => {
    const own = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACC_A }, (c) =>
      c.query(`SELECT user_id FROM iam.login_audit`)
    );
    expect(own.rows.every((r) => r.user_id === ACC_A)).toBe(true);
    expect(own.rows.length).toBeGreaterThanOrEqual(1);
    const anon = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACC_A }, (c) =>
      c.query(`SELECT id FROM iam.login_audit WHERE user_id IS NULL`)
    );
    expect(anon.rows).toHaveLength(0);
  });

  it('runtime appends its OWN login audit but never another principal history', async () => {
    // DBCR-P1-14-001 granted INSERT so the authentication path can record its own
    // attempt. `ins_login_audit_self` scopes it to `user_id = current_user_id()`,
    // or an administrator holding `iam.user.manage` for a lockout recorded against
    // somebody else. ACC_A holds no grant, so it may write only its own row.
    const ctx = { tenantId: TENANT_A, userId: ACC_A };
    const own = await withRolledBackTx(runtime, ctx, (c) =>
      c.query(
        `INSERT INTO iam.login_audit (tenant_id, user_id, event_type) VALUES ($1,$2,'success')`,
        [TENANT_A, ACC_A]
      )
    );
    expect(own.rowCount).toBe(1);

    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.login_audit (tenant_id, user_id, event_type) VALUES ($1,$2,'success')`,
          [TENANT_A, ACC_A2]
        ),
        '42501'
      )
    );
  });

  it('login audit stays append-only: no UPDATE and no DELETE were granted', async () => {
    const ctx = { tenantId: TENANT_A, userId: ACC_A };
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.login_audit SET detail='x' WHERE user_id=$1`, [ACC_A]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(c.query(`DELETE FROM iam.login_audit WHERE user_id=$1`, [ACC_A]), '42501')
    );
  });
});

describe('iam.user_sessions — own sessions only, opaque ref, no tokens', () => {
  it('session_ref is unique', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, created_by) VALUES ($1,$2,'sess-a-1',$3)`,
          [TENANT_A, ACC_A, ACTOR]
        ),
        '23505'
      )
    );
  });

  it('a user sees only their own sessions (not another user in the same tenant)', async () => {
    const rows = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACC_A }, (c) =>
      c.query(`SELECT session_ref FROM iam.user_sessions ORDER BY 1`)
    );
    expect(rows.rows.map((r) => r.session_ref)).toEqual(['sess-a-1']);
  });

  it('session_ref and identity are immutable', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      const r = await c.query(
        `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, created_by) VALUES ($1,$2,'sess-imm',$3) RETURNING id`,
        [TENANT_A, ACC_A, ACTOR]
      );
      await expectSqlState(
        c.query(`UPDATE iam.user_sessions SET session_ref='moved' WHERE id=$1`, [r.rows[0].id]),
        '23514'
      );
    });
  });

  it('runtime issues a session for ITSELF but never for another principal', async () => {
    // DBCR-P1-14-001 granted INSERT so the login path can record the session it
    // just issued. `ins_user_sessions_self` scopes it to the resolved principal,
    // which is why it needs no permission: requiring one would break login for
    // ordinary users, and whoever held it could forge somebody else's session.
    const own = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACC_A }, (c) =>
      c.query(
        `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, created_by) VALUES ($1,$2,'sess-self-1',$2)`,
        [TENANT_A, ACC_A]
      )
    );
    expect(own.rowCount).toBe(1);

    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACC_A }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, created_by) VALUES ($1,$2,'sess-forged',$3)`,
          [TENANT_A, ACC_A2, ACTOR]
        ),
        '42501'
      )
    );
  });

  it('runtime holds no privilege to re-own a session or forge its issue time', async () => {
    const attempts: ReadonlyArray<readonly [string, unknown[]]> = [
      [`UPDATE iam.user_sessions SET user_id = $2 WHERE tenant_id = $1`, [TENANT_A, ACC_A2]],
      [`UPDATE iam.user_sessions SET session_ref = 'swapped' WHERE tenant_id = $1`, [TENANT_A]],
      [`UPDATE iam.user_sessions SET issued_at = now() WHERE tenant_id = $1`, [TENANT_A]],
    ];
    for (const [sql, params] of attempts) {
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACC_A }, (c) =>
        expectSqlState(c.query(sql, params), '42501')
      );
    }
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACC_A }, (c) =>
      expectSqlState(
        c.query(`DELETE FROM iam.user_sessions WHERE tenant_id = $1`, [TENANT_A]),
        '42501'
      )
    );
  });
});
