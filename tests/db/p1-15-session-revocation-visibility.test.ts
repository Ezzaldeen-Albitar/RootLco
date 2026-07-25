/**
 * Session revocation depends on READ visibility, not only on write authority
 * (P1-15-SR-006).
 *
 * ===========================================================================
 * WHAT THIS SUITE EXISTS TO PIN
 * ===========================================================================
 * `iam.user_sessions` carries four policies, and the split between them is the
 * whole finding:
 *
 *   sel_user_sessions_own    SELECT  user_id = iam.current_user_id()
 *   sel_user_sessions_admin  SELECT  iam.has_permission('iam.session.view_all')
 *   upd_user_sessions_self   UPDATE  user_id = iam.current_user_id() AND revoked_at IS NULL
 *   upd_user_sessions_admin  UPDATE  iam.has_permission('iam.user.manage') AND revoked_at IS NULL
 *
 * Revocation is `UPDATE iam.user_sessions SET revoked_at = now() WHERE tenant_id = $1
 * AND user_id = $2 AND revoked_at IS NULL`. That `WHERE` reads columns of the
 * relation, so PostgreSQL applies the **SELECT** policies in addition to the
 * UPDATE policy. A caller holding `iam.user.manage` and **not**
 * `iam.session.view_all` therefore matched no rows: the UPDATE policy naming
 * their permission was never reached, the statement affected zero rows, and the
 * request answered `200 {"revoked": 0}` — with a `security`-class audit record
 * and a `session.revoked` event — while the session it was called to kill
 * stayed live.
 *
 * A security control that reports success and does nothing is worse than one
 * that fails, because nothing surfaces it.
 *
 * ===========================================================================
 * WHY THE FIX IS AT THE OPERATION AND NOT IN THE DATABASE
 * ===========================================================================
 * `iam.user-session-revoke-all` and `iam.user-status-change` now declare
 * **both** permissions, so a caller who cannot read the rows is refused 403 at
 * the gate, before any audit record or event exists. The alternative — a new
 * SELECT policy gated on `iam.user.manage` — is a database change, and a
 * database change belongs to a controlled change request rather than to a
 * feature branch. P1-15 adds no migration.
 *
 * The tests below prove the database behaviour that makes the declaration
 * necessary, so a future reader can see that the second permission is load
 * bearing rather than defensive clutter. If someone later removes it because it
 * "looks redundant", the first test here fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  USER_A,
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  runtimePool,
  withRolledBackTx,
} from './helpers';
import {
  USER_SESSION_REVOKE_OPERATION,
  USER_SESSION_LIST_OPERATION,
} from '@/app/api/v1/iam/users/[userId]/sessions/route';
import { USER_STATUS_OPERATION } from '@/app/api/v1/iam/users/[userId]/status/route';

/** Actor holding `iam.user.manage` and NOT `iam.session.view_all`. */
const U_MANAGE_ONLY = 'd6000000-0000-4000-8000-000000000001';
/** Actor holding both permissions — the configuration the fixtures assumed. */
const U_BOTH = 'd6000000-0000-4000-8000-000000000002';
/** The target whose session is to be revoked. */
const U_TARGET = 'd6000000-0000-4000-8000-000000000003';

const ROLE_MANAGE_ONLY = 'd6100000-0000-4000-8000-000000000001';
const ROLE_BOTH = 'd6100000-0000-4000-8000-000000000002';

const SESSION_REF = 'fx_p15_sr006_session';

let admin: Pool;
let runtime: Pool;
let sessionId: string;

const revokeStatement = `UPDATE iam.user_sessions
     SET revoked_at = now(), revoke_reason = 'P1-15-SR-006 probe'
   WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $4, 'test_harness', 'fx_p15_sr006_manage', 'fx-p15-sr006-manage@example.test',
             'SR-006 manage only', 'active', $5),
            ($2, $4, 'test_harness', 'fx_p15_sr006_both',   'fx-p15-sr006-both@example.test',
             'SR-006 both',        'active', $5),
            ($3, $4, 'test_harness', 'fx_p15_sr006_target', 'fx-p15-sr006-target@example.test',
             'SR-006 target',      'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [U_MANAGE_ONLY, U_BOTH, U_TARGET, TENANT_A, USER_A]
  );

  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $3, 'fx_p15_sr006_manage', 'SR-006 manage only', $4),
            ($2, $3, 'fx_p15_sr006_both',   'SR-006 both',        $4)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_MANAGE_ONLY, ROLE_BOTH, TENANT_A, USER_A]
  );

  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = 'iam.user.manage'
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_MANAGE_ONLY, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions
      WHERE permission_code = ANY(ARRAY['iam.user.manage', 'iam.session.view_all'])
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_BOTH, USER_A]
  );

  await admin.query('DELETE FROM iam.role_grants WHERE user_id = ANY($1::uuid[])', [
    [U_MANAGE_ONLY, U_BOTH],
  ]);
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', 'active', $6, $6),
            ($1, $4, $5, 'unrestricted', 'active', $6, $6)`,
    [TENANT_A, U_MANAGE_ONLY, ROLE_MANAGE_ONLY, U_BOTH, ROLE_BOTH, USER_A]
  );
}, 120_000);

beforeAll(async () => {
  runtime = runtimePool(4);
});

afterAll(async () => {
  await runtime.end();
  await cleanFixtures(admin);
  await admin.end();
});

/** A live session for the target, re-created before each probe. */
async function freshSession(): Promise<string> {
  await admin.query('DELETE FROM iam.user_sessions WHERE user_id = $1', [U_TARGET]);
  const id = randomUUID();
  await admin.query(
    `INSERT INTO iam.user_sessions
       (id, tenant_id, user_id, session_ref, issued_at, expires_at, created_by)
     VALUES ($1, $2, $3, $4, now(), now() + interval '1 hour', $3)`,
    [id, TENANT_A, U_TARGET, `${SESSION_REF}_${id.slice(0, 8)}`]
  );
  return id;
}

const isRevoked = async (id: string): Promise<boolean> => {
  const result = await admin.query<{ revoked: boolean }>(
    'SELECT revoked_at IS NOT NULL AS revoked FROM iam.user_sessions WHERE id = $1',
    [id]
  );
  return result.rows[0]?.revoked === true;
};

describe('P1-15-SR-006 / the database behaviour that makes the second permission load bearing', () => {
  it('a caller with iam.user.manage but NOT iam.session.view_all revokes ZERO rows', async () => {
    sessionId = await freshSession();

    const affected = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: U_MANAGE_ONLY },
      async (client) => {
        const result = await client.query(revokeStatement, [TENANT_A, U_TARGET]);
        return result.rowCount ?? 0;
      }
    );

    // No error is raised. The statement simply matches nothing, which is exactly
    // why the application could report success while doing nothing.
    expect(affected).toBe(0);
    expect(await isRevoked(sessionId)).toBe(false);
  });

  it('the same caller cannot SELECT the row either — which is the cause, not a symptom', async () => {
    sessionId = await freshSession();

    const visible = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: U_MANAGE_ONLY },
      async (client) => {
        const result = await client.query(
          'SELECT id FROM iam.user_sessions WHERE tenant_id = $1 AND user_id = $2',
          [TENANT_A, U_TARGET]
        );
        return result.rowCount ?? 0;
      }
    );

    expect(visible).toBe(0);
  });

  it('a caller holding BOTH permissions revokes the session', async () => {
    sessionId = await freshSession();

    const affected = await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: U_BOTH },
      async (client) => {
        const result = await client.query(revokeStatement, [TENANT_A, U_TARGET]);
        return result.rowCount ?? 0;
      }
    );

    expect(affected).toBe(1);
  });

  it('the UPDATE policy alone names only iam.user.manage — the gap is between the two', async () => {
    const policies = await admin.query<{ policyname: string; cmd: string; qual: string | null }>(
      `SELECT policyname, cmd, qual
         FROM pg_policies
        WHERE schemaname = 'iam' AND tablename = 'user_sessions'
        ORDER BY cmd, policyname`
    );
    const byName = new Map(policies.rows.map((row) => [row.policyname, row]));

    expect(byName.get('upd_user_sessions_admin')?.qual).toContain('iam.user.manage');
    expect(byName.get('upd_user_sessions_admin')?.qual).not.toContain('iam.session.view_all');
    expect(byName.get('sel_user_sessions_admin')?.qual).toContain('iam.session.view_all');
  });
});

describe('P1-15-SR-006 / the operations that perform revocation declare both permissions', () => {
  it('iam.user-session-revoke-all requires the read permission it depends on', () => {
    expect([...USER_SESSION_REVOKE_OPERATION.permissions].sort()).toEqual([
      'iam.session.view_all',
      'iam.user.manage',
    ]);
  });

  it('iam.user-status-change requires it too, because losing active revokes sessions', () => {
    expect([...USER_STATUS_OPERATION.permissions].sort()).toEqual([
      'iam.session.view_all',
      'iam.user.manage',
    ]);
  });

  it('listing sessions was already correct and is unchanged', () => {
    expect([...USER_SESSION_LIST_OPERATION.permissions]).toEqual(['iam.session.view_all']);
  });
});
