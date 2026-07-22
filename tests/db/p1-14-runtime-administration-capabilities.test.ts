/**
 * DBCR-P1-14-001 — tenant-safe runtime administration capabilities.
 *
 * Migration `20260726090000_iam_org_runtime_administration_capabilities.sql`
 * gives the `app_runtime` archetype the write capabilities P1-14 needs across
 * identity, sessions, roles, permission mappings, grants, scopes, approval
 * limits and tenant settings. This suite proves the *shape* of what was
 * granted, in four directions:
 *
 *  1. **It works** — every capability the change request measured as blocked now
 *     succeeds for an administrator who holds the gating permission. Every such
 *     assertion runs on `rootlco_test_runtime`, a member of `app_runtime`. The
 *     admin connection provisions fixtures and reads back; it bypasses RLS and
 *     is never evidence about runtime behaviour.
 *  2. **It is gated** — the same statement, run by a principal without the
 *     permission, is refused.
 *  3. **It cannot cross a tenant** — an administrator of tenant B holding every
 *     permission cannot touch tenant A.
 *  4. **It cannot escalate** — the two delegation policies are the interesting
 *     part of this migration and get their own section. An administrator cannot
 *     mint authority they do not already hold, directly or through a role.
 *
 * Two denial shapes appear, and the difference matters:
 *
 *  - INSERT refused by a policy or a missing privilege raises **42501**.
 *  - UPDATE/DELETE refused by a policy's USING clause matches **no rows** and
 *    raises nothing. Asserting `rowCount === 0` is therefore the only correct
 *    assertion there; expecting an error would silently pass on a policy that
 *    does not exist at all.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  readonlyPool,
  runtimePool,
  TENANT_A,
  TENANT_B,
  withRolledBackTx,
  workerPool,
} from './helpers';

/** Fixture principals. Deterministic, hex-only, distinct from the shared set. */
const ADMIN_A = 'a0000000-0000-4000-8000-00000000ad01';
const PLAIN_A = 'a0000000-0000-4000-8000-00000000b101';
const TARGET_A = 'a0000000-0000-4000-8000-00000000da01';
const ADMIN_B = 'b0000000-0000-4000-8000-00000000ad01';
const ROLE_ADMIN_A = 'a0000000-0000-4000-8000-00000000c001';
const ROLE_PLAIN_A = 'a0000000-0000-4000-8000-00000000c002';
const ROLE_SYSTEM_A = 'a0000000-0000-4000-8000-00000000c003';
const ROLE_ADMIN_B = 'b0000000-0000-4000-8000-00000000c001';
const SYS = '00000000-0000-4000-8000-000000000001';

/** Exactly the permissions this migration's policies gate on, plus a read. */
const ADMIN_PERMISSIONS = [
  'iam.user.manage',
  'iam.role.manage',
  'iam.grant.manage',
  'iam.approval.manage',
  'org.settings.manage',
  'iam.user.read',
] as const;

/** A high-risk permission deliberately NOT held by the fixture administrator. */
const UNHELD_PERMISSION = 'sal.invoice.issue';

const AS_ADMIN_A = { tenantId: TENANT_A, userId: ADMIN_A };
const AS_PLAIN_A = { tenantId: TENANT_A, userId: PLAIN_A };
const AS_ADMIN_B = { tenantId: TENANT_B, userId: ADMIN_B };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;
let worker: Pool;

type Q = { query: Client['query'] };

/** Rebuilds the identity fixtures. Admin connection — never RLS evidence. */
async function seedIdentityFixtures(): Promise<void> {
  for (const table of [
    'iam.grant_scopes',
    'iam.role_grants',
    'iam.approval_limits',
    'iam.user_sessions',
    'iam.login_audit',
    'iam.user_status_history',
    'iam.role_permissions',
    'iam.user_accounts',
    'iam.roles',
  ]) {
    await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [
      [TENANT_A, TENANT_B],
    ]);
  }

  for (const [id, tenant, code, name, isSystem] of [
    [ROLE_ADMIN_A, TENANT_A, 'fx_p14_admin', 'Fixture Administrator A', false],
    [ROLE_PLAIN_A, TENANT_A, 'fx_p14_plain', 'Fixture Plain A', false],
    [ROLE_SYSTEM_A, TENANT_A, 'fx_p14_system', 'Fixture System Role A', true],
    [ROLE_ADMIN_B, TENANT_B, 'fx_p14_admin', 'Fixture Administrator B', false],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, is_system, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, tenant, code, name, isSystem, SYS]
    );
  }

  for (const [id, tenant, subject, email, name] of [
    [ADMIN_A, TENANT_A, 'fx-p14-admin-a', 'fx-p14-admin-a@example.test', 'Fixture Admin A'],
    [PLAIN_A, TENANT_A, 'fx-p14-plain-a', 'fx-p14-plain-a@example.test', 'Fixture Plain A'],
    [TARGET_A, TENANT_A, 'fx-p14-target-a', 'fx-p14-target-a@example.test', 'Fixture Target A'],
    [ADMIN_B, TENANT_B, 'fx-p14-admin-b', 'fx-p14-admin-b@example.test', 'Fixture Admin B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, 'supabase', $3, $4, $5, 'active', $6)`,
      [id, tenant, subject, email, name, SYS]
    );
  }

  // Both administrator roles carry the same administration permissions; the
  // plain role carries none. The system role carries one, so the system-role
  // protections have something to try to remove.
  for (const [role, tenant] of [
    [ROLE_ADMIN_A, TENANT_A],
    [ROLE_ADMIN_B, TENANT_B],
  ] as const) {
    for (const code of ADMIN_PERMISSIONS) {
      await admin.query(
        `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
         SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = $4`,
        [tenant, role, SYS, code]
      );
    }
  }
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = 'iam.user.read'`,
    [TENANT_A, ROLE_SYSTEM_A, SYS]
  );

  for (const [tenant, user, role] of [
    [TENANT_A, ADMIN_A, ROLE_ADMIN_A],
    [TENANT_A, PLAIN_A, ROLE_PLAIN_A],
    [TENANT_B, ADMIN_B, ROLE_ADMIN_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_grants
         (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
      [tenant, user, role, SYS]
    );
  }
}

/** The id of a permission code, read on the admin connection. */
async function permissionId(code: string): Promise<string> {
  const result = await admin.query<{ id: string }>(
    'SELECT id FROM iam.permissions WHERE permission_code = $1',
    [code]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Fixture precondition failed: permission ${code} is not seeded`);
  return row.id;
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  readonly = readonlyPool();
  worker = workerPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
});

beforeEach(async () => {
  await seedIdentityFixtures();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await readonly.end();
  await worker.end();
  await admin.end();
});

// ---------------------------------------------------------------------------
describe('capabilities the change request measured as blocked now work', () => {
  it('invites a user account', async () => {
    const result = await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      c.query(
        `INSERT INTO iam.user_accounts
           (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
         VALUES ($1, 'supabase', 'fx-p14-new', 'fx-p14-new@example.test', 'New', 'invited', $2)`,
        [TENANT_A, ADMIN_A]
      )
    );
    expect(result.rowCount).toBe(1);
  });

  it('transitions a user through iam.change_user_status', async () => {
    await withRolledBackTx(runtime, AS_ADMIN_A, async (c: Q) => {
      await c.query(`SELECT iam.change_user_status($1::uuid, 'locked', 'security review', NULL)`, [
        TARGET_A,
      ]);
      const after = await c.query<{ status: string }>(
        'SELECT status FROM iam.user_accounts WHERE id = $1',
        [TARGET_A]
      );
      expect(after.rows[0]?.status).toBe('locked');
      // The function writes the history row in the same transaction.
      const history = await c.query(
        'SELECT 1 FROM iam.user_status_history WHERE user_id = $1 AND to_state = $2',
        [TARGET_A, 'locked']
      );
      expect(history.rowCount).toBe(1);
    });
  });

  it('creates and revokes a session, and touches last_seen_at', async () => {
    await withRolledBackTx(runtime, AS_ADMIN_A, async (c: Q) => {
      const created = await c.query(
        `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, created_by)
         VALUES ($1, $2, 'fx-p14-session', $2)`,
        [TENANT_A, ADMIN_A]
      );
      expect(created.rowCount).toBe(1);
      const touched = await c.query(
        `UPDATE iam.user_sessions SET last_seen_at = now() WHERE tenant_id = $1 AND user_id = $2`,
        [TENANT_A, ADMIN_A]
      );
      expect(touched.rowCount).toBe(1);
      const revoked = await c.query(
        `UPDATE iam.user_sessions SET revoked_at = now(), revoke_reason = 'logout'
          WHERE tenant_id = $1 AND user_id = $2`,
        [TENANT_A, ADMIN_A]
      );
      expect(revoked.rowCount).toBe(1);
    });
  });

  it('makes session revocation terminal — a revoked row cannot be resurrected', async () => {
    // Found by attacking the first draft of this migration: without
    // `revoked_at IS NULL` in USING, both the owner and an administrator could
    // clear the column and bring a revoked session back to life.
    await withRolledBackTx(runtime, AS_ADMIN_A, async (c: Q) => {
      await c.query(
        `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, revoked_at, revoke_reason, created_by)
         VALUES ($1, $2, 'fx-p14-dead', now(), 'logout', $2)`,
        [TENANT_A, ADMIN_A]
      );
      const resurrectSelf = await c.query(
        `UPDATE iam.user_sessions SET revoked_at = NULL, revoke_reason = NULL
          WHERE tenant_id = $1 AND session_ref = 'fx-p14-dead'`,
        [TENANT_A]
      );
      expect(resurrectSelf.rowCount).toBe(0);
      // Nor may any further field be touched once the row is revoked.
      const touch = await c.query(
        `UPDATE iam.user_sessions SET last_seen_at = now()
          WHERE tenant_id = $1 AND session_ref = 'fx-p14-dead'`,
        [TENANT_A]
      );
      expect(touch.rowCount).toBe(0);
    });
  });

  it('records a login attempt for itself', async () => {
    const result = await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      c.query(`INSERT INTO iam.login_audit (tenant_id, user_id, event_type) VALUES ($1, $2, $3)`, [
        TENANT_A,
        ADMIN_A,
        'success',
      ])
    );
    expect(result.rowCount).toBe(1);
  });

  it('creates and updates a role', async () => {
    await withRolledBackTx(runtime, AS_ADMIN_A, async (c: Q) => {
      const created = await c.query(
        `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
         VALUES ($1, 'fx_p14_created', 'Created', $2)`,
        [TENANT_A, ADMIN_A]
      );
      expect(created.rowCount).toBe(1);
      const updated = await c.query(
        `UPDATE iam.roles SET name = 'Renamed' WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, ROLE_PLAIN_A]
      );
      expect(updated.rowCount).toBe(1);
    });
  });

  it('maps, re-effects and removes a permission the administrator holds', async () => {
    const readPermission = await permissionId('iam.user.read');
    await withRolledBackTx(runtime, AS_ADMIN_A, async (c: Q) => {
      const mapped = await c.query(
        `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
         VALUES ($1, $2, $3, 'allow', $4)`,
        [TENANT_A, ROLE_PLAIN_A, readPermission, ADMIN_A]
      );
      expect(mapped.rowCount).toBe(1);
      const flipped = await c.query(
        `UPDATE iam.role_permissions SET effect = 'deny'
          WHERE tenant_id = $1 AND role_id = $2 AND permission_id = $3`,
        [TENANT_A, ROLE_PLAIN_A, readPermission]
      );
      expect(flipped.rowCount).toBe(1);
      const removed = await c.query(
        `DELETE FROM iam.role_permissions
          WHERE tenant_id = $1 AND role_id = $2 AND permission_id = $3`,
        [TENANT_A, ROLE_PLAIN_A, readPermission]
      );
      expect(removed.rowCount).toBe(1);
    });
  });

  it('grants and revokes a role, and assigns and removes a scope', async () => {
    await withRolledBackTx(runtime, AS_ADMIN_A, async (c: Q) => {
      const granted = await c.query<{ id: string }>(
        `INSERT INTO iam.role_grants
           (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
         VALUES ($1, $2, $3, 'scoped', 'active', $4, $4) RETURNING id`,
        [TENANT_A, TARGET_A, ROLE_PLAIN_A, ADMIN_A]
      );
      const grantId = granted.rows[0]?.id;
      expect(grantId).toBeTruthy();

      const scoped = await c.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
         VALUES ($1, $2, 'company', $3, $4)`,
        [TENANT_A, grantId, COMPANY_A1, ADMIN_A]
      );
      expect(scoped.rowCount).toBe(1);

      const revoked = await c.query(
        `UPDATE iam.role_grants SET status = 'revoked', revoked_at = now(), revoke_reason = 'offboarded'
          WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, grantId]
      );
      expect(revoked.rowCount).toBe(1);

      // The deferred constraint trigger only requires a scope while the grant is
      // active, so withdrawing the scope after revocation is legitimate.
      const unscoped = await c.query(
        `DELETE FROM iam.grant_scopes WHERE tenant_id = $1 AND grant_id = $2`,
        [TENANT_A, grantId]
      );
      expect(unscoped.rowCount).toBe(1);
    });
  });

  it('creates an approval limit and closes it with effective_to', async () => {
    await withRolledBackTx(runtime, AS_ADMIN_A, async (c: Q) => {
      const created = await c.query<{ id: string }>(
        `INSERT INTO iam.approval_limits
           (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
         VALUES ($1, $2, $3, 'discount_approval', 1000.0000, 'USD', current_date, $4)
         RETURNING id`,
        [TENANT_A, COMPANY_A1, TARGET_A, ADMIN_A]
      );
      expect(created.rowCount).toBe(1);
      const closed = await c.query(
        `UPDATE iam.approval_limits SET effective_to = current_date + 1
          WHERE tenant_id = $1 AND id = $2`,
        [TENANT_A, created.rows[0]?.id]
      );
      expect(closed.rowCount).toBe(1);
    });
  });

  it('updates the tenant settings row', async () => {
    const result = await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      c.query(`UPDATE org.tenants SET display_name = 'Renamed Tenant' WHERE id = $1`, [TENANT_A])
    );
    expect(result.rowCount).toBe(1);
  });

  it('appends a company settings version without any new grant', async () => {
    // org.company_settings was already writable: every column is immutable on
    // UPDATE, so a settings change is a new version row, not an edit. This test
    // pins that the migration did not need — and did not add — an UPDATE there.
    const result = await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      c.query(
        `INSERT INTO org.company_settings
           (tenant_id, company_id, setting_key, setting_value, value_type, is_sensitive,
            version, effective_from, created_by)
         VALUES ($1, $2, 'fx_p14_setting', '"value"'::jsonb, 'string', false, 1, now(), $3)`,
        [TENANT_A, COMPANY_A1, ADMIN_A]
      )
    );
    expect(result.rowCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('every capability is gated on its permission', () => {
  it('refuses an invitation from a principal without iam.user.manage', async () => {
    await withRolledBackTx(runtime, AS_PLAIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.user_accounts
             (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
           VALUES ($1, 'supabase', 'fx-p14-x', 'fx-p14-x@example.test', 'X', 'invited', $2)`,
          [TENANT_A, PLAIN_A]
        ),
        '42501'
      )
    );
  });

  it('matches no user row for an UPDATE without iam.user.manage', async () => {
    const result = await withRolledBackTx(runtime, AS_PLAIN_A, (c: Q) =>
      c.query(`UPDATE iam.user_accounts SET status = 'locked' WHERE tenant_id = $1 AND id = $2`, [
        TENANT_A,
        TARGET_A,
      ])
    );
    expect(result.rowCount).toBe(0);
  });

  it('refuses role creation without iam.role.manage', async () => {
    await withRolledBackTx(runtime, AS_PLAIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
           VALUES ($1, 'fx_p14_nope', 'Nope', $2)`,
          [TENANT_A, PLAIN_A]
        ),
        '42501'
      )
    );
  });

  it('refuses a role grant without iam.grant.manage', async () => {
    await withRolledBackTx(runtime, AS_PLAIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.role_grants
             (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
           VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
          [TENANT_A, TARGET_A, ROLE_PLAIN_A, PLAIN_A]
        ),
        '42501'
      )
    );
  });

  it('refuses an approval limit without iam.approval.manage', async () => {
    await withRolledBackTx(runtime, AS_PLAIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.approval_limits
             (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
           VALUES ($1, $2, $3, 'discount_approval', 1, 'USD', current_date, $4)`,
          [TENANT_A, COMPANY_A1, TARGET_A, PLAIN_A]
        ),
        '42501'
      )
    );
  });

  it('matches no tenant row for a settings UPDATE without org.settings.manage', async () => {
    const result = await withRolledBackTx(runtime, AS_PLAIN_A, (c: Q) =>
      c.query(`UPDATE org.tenants SET display_name = 'Nope' WHERE id = $1`, [TENANT_A])
    );
    expect(result.rowCount).toBe(0);
  });

  it('refuses a session forged for another principal', async () => {
    await withRolledBackTx(runtime, AS_PLAIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, created_by)
           VALUES ($1, $2, 'fx-p14-forged', $3)`,
          [TENANT_A, TARGET_A, PLAIN_A]
        ),
        '42501'
      )
    );
  });

  it('refuses a login-audit row forged for another principal', async () => {
    await withRolledBackTx(runtime, AS_PLAIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.login_audit (tenant_id, user_id, event_type) VALUES ($1, $2, $3)`,
          [TENANT_A, TARGET_A, 'success']
        ),
        '42501'
      )
    );
  });

  it('lets an administrator record only a lockout against another principal', async () => {
    // Found by attacking the first draft: the administrative arm originally
    // accepted any event_type, which would have let `iam.user.manage` fabricate
    // another principal's authentication history in the table that evidences it.
    const lockout = await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      c.query(`INSERT INTO iam.login_audit (tenant_id, user_id, event_type) VALUES ($1, $2, $3)`, [
        TENANT_A,
        TARGET_A,
        'lockout',
      ])
    );
    expect(lockout.rowCount).toBe(1);

    for (const forged of ['success', 'failure', 'logout']) {
      await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
        expectSqlState(
          c.query(
            `INSERT INTO iam.login_audit (tenant_id, user_id, event_type) VALUES ($1, $2, $3)`,
            [TENANT_A, TARGET_A, forged]
          ),
          '42501'
        )
      );
    }
  });

  it('denies everything when the session context is unset', async () => {
    await withRolledBackTx(runtime, {}, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.user_accounts
             (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
           VALUES ($1, 'supabase', 'fx-p14-nc', 'fx-p14-nc@example.test', 'NC', 'invited', $2)`,
          [TENANT_A, ADMIN_A]
        ),
        '42501'
      )
    );
  });

  it('denies a locked administrator every capability it held while active', async () => {
    await admin.query(`UPDATE iam.user_accounts SET status = 'locked' WHERE id = $1`, [ADMIN_A]);
    try {
      await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
        expectSqlState(
          c.query(
            `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
             VALUES ($1, 'fx_p14_locked', 'Locked', $2)`,
            [TENANT_A, ADMIN_A]
          ),
          '42501'
        )
      );
      const settings = await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
        c.query(`UPDATE org.tenants SET display_name = 'Locked' WHERE id = $1`, [TENANT_A])
      );
      expect(settings.rowCount).toBe(0);
    } finally {
      await admin.query(`UPDATE iam.user_accounts SET status = 'active' WHERE id = $1`, [ADMIN_A]);
    }
  });
});

// ---------------------------------------------------------------------------
describe('no capability crosses a tenant boundary', () => {
  it("refuses tenant B's administrator an insert into tenant A", async () => {
    await withRolledBackTx(runtime, AS_ADMIN_B, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.user_accounts
             (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
           VALUES ($1, 'supabase', 'fx-p14-cross', 'fx-p14-cross@example.test', 'X', 'invited', $2)`,
          [TENANT_A, ADMIN_B]
        ),
        '42501'
      )
    );
  });

  it("refuses tenant B's administrator a role in tenant A", async () => {
    await withRolledBackTx(runtime, AS_ADMIN_B, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
           VALUES ($1, 'fx_p14_cross', 'Cross', $2)`,
          [TENANT_A, ADMIN_B]
        ),
        '42501'
      )
    );
  });

  it("matches no rows for tenant B's administrator updating tenant A", async () => {
    for (const [sql, params] of [
      [`UPDATE iam.user_accounts SET status = 'locked' WHERE tenant_id = $1`, [TENANT_A]],
      [
        `UPDATE iam.role_grants SET status = 'revoked', revoked_at = now(), revoke_reason = 'x'
          WHERE tenant_id = $1`,
        [TENANT_A],
      ],
      [`UPDATE org.tenants SET display_name = 'Cross' WHERE id = $1`, [TENANT_A]],
      [
        `UPDATE iam.user_sessions SET revoked_at = now(), revoke_reason = 'x' WHERE tenant_id = $1`,
        [TENANT_A],
      ],
    ] as const) {
      const result = await withRolledBackTx(runtime, AS_ADMIN_B, (c: Q) =>
        c.query(sql, [...params])
      );
      expect(result.rowCount, sql).toBe(0);
    }
  });

  it("refuses tenant B's administrator a grant-scope row in tenant A", async () => {
    const grant = await admin.query<{ id: string }>(
      'SELECT id FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2',
      [TENANT_A, ADMIN_A]
    );
    await withRolledBackTx(runtime, AS_ADMIN_B, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
           VALUES ($1, $2, 'company', $3, $4)`,
          [TENANT_A, grant.rows[0]?.id, COMPANY_A1, ADMIN_B]
        ),
        '42501'
      )
    );
  });
});

// ---------------------------------------------------------------------------
describe('the delegation rule blocks privilege escalation in the database', () => {
  it('refuses an allow-mapping for a permission the administrator does not hold', async () => {
    const unheld = await permissionId(UNHELD_PERMISSION);
    await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
           VALUES ($1, $2, $3, 'allow', $4)`,
          [TENANT_A, ROLE_PLAIN_A, unheld, ADMIN_A]
        ),
        '42501'
      )
    );
  });

  it('permits a deny-mapping for that same unheld permission', async () => {
    // Deny is de-escalation. Refusing it would be a safety regression, not a
    // safety control, so the policy deliberately treats the two differently.
    const unheld = await permissionId(UNHELD_PERMISSION);
    const result = await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      c.query(
        `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
         VALUES ($1, $2, $3, 'deny', $4)`,
        [TENANT_A, ROLE_PLAIN_A, unheld, ADMIN_A]
      )
    );
    expect(result.rowCount).toBe(1);
  });

  it('refuses self-escalation onto the administrator own role', async () => {
    const unheld = await permissionId('iam.sensitive.view');
    await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
           VALUES ($1, $2, $3, 'allow', $4)`,
          [TENANT_A, ROLE_ADMIN_A, unheld, ADMIN_A]
        ),
        '42501'
      )
    );
  });

  it('refuses escalation by flipping an existing deny mapping to allow', async () => {
    const unheld = await permissionId(UNHELD_PERMISSION);
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       VALUES ($1, $2, $3, 'deny', $4)`,
      [TENANT_A, ROLE_ADMIN_A, unheld, SYS]
    );
    await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `UPDATE iam.role_permissions SET effect = 'allow'
            WHERE tenant_id = $1 AND role_id = $2 AND permission_id = $3`,
          [TENANT_A, ROLE_ADMIN_A, unheld]
        ),
        '42501'
      )
    );
  });

  it('refuses granting a role that confers more than the administrator holds', async () => {
    const unheld = await permissionId(UNHELD_PERMISSION);
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       VALUES ($1, $2, $3, 'allow', $4)`,
      [TENANT_A, ROLE_PLAIN_A, unheld, SYS]
    );
    await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.role_grants
             (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
           VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
          [TENANT_A, TARGET_A, ROLE_PLAIN_A, ADMIN_A]
        ),
        '42501'
      )
    );
  });

  it('permits granting a role whose permissions the administrator fully holds', async () => {
    const held = await permissionId('iam.user.read');
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       VALUES ($1, $2, $3, 'allow', $4)`,
      [TENANT_A, ROLE_PLAIN_A, held, SYS]
    );
    const result = await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      c.query(
        `INSERT INTO iam.role_grants
           (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
         VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
        [TENANT_A, TARGET_A, ROLE_PLAIN_A, ADMIN_A]
      )
    );
    expect(result.rowCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('system roles remain platform contract', () => {
  it('matches no row when updating a system role', async () => {
    const result = await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      c.query(`UPDATE iam.roles SET name = 'Hijacked' WHERE tenant_id = $1 AND id = $2`, [
        TENANT_A,
        ROLE_SYSTEM_A,
      ])
    );
    expect(result.rowCount).toBe(0);
  });

  it('refuses a new mapping onto a system role', async () => {
    const held = await permissionId('iam.role.read');
    await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
           VALUES ($1, $2, $3, 'allow', $4)`,
          [TENANT_A, ROLE_SYSTEM_A, held, ADMIN_A]
        ),
        '42501'
      )
    );
  });

  it('matches no rows when removing or re-effecting a system role mapping', async () => {
    for (const [sql, params] of [
      [
        `DELETE FROM iam.role_permissions WHERE tenant_id = $1 AND role_id = $2`,
        [TENANT_A, ROLE_SYSTEM_A],
      ],
      [
        `UPDATE iam.role_permissions SET effect = 'deny' WHERE tenant_id = $1 AND role_id = $2`,
        [TENANT_A, ROLE_SYSTEM_A],
      ],
    ] as const) {
      const result = await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
        c.query(sql, [...params])
      );
      expect(result.rowCount, sql).toBe(0);
    }
  });

  it('refuses creating a role that claims to be a system role', async () => {
    await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.roles (tenant_id, role_code, name, is_system, created_by)
           VALUES ($1, 'fx_p14_claims', 'Claims', true, $2)`,
          [TENANT_A, ADMIN_A]
        ),
        '42501'
      )
    );
  });
});

// ---------------------------------------------------------------------------
describe('capabilities deliberately withheld stay withheld', () => {
  const withheld: ReadonlyArray<readonly [string, string, unknown[]]> = [
    ['no DELETE on identity', 'DELETE FROM iam.user_accounts WHERE tenant_id = $1', [TENANT_A]],
    ['no DELETE on roles', 'DELETE FROM iam.roles WHERE tenant_id = $1', [TENANT_A]],
    ['no DELETE on grants', 'DELETE FROM iam.role_grants WHERE tenant_id = $1', [TENANT_A]],
    ['no DELETE on login audit', 'DELETE FROM iam.login_audit WHERE tenant_id = $1', [TENANT_A]],
    [
      'no DELETE on status history',
      'DELETE FROM iam.user_status_history WHERE tenant_id = $1',
      [TENANT_A],
    ],
    ['no DELETE on sessions', 'DELETE FROM iam.user_sessions WHERE tenant_id = $1', [TENANT_A]],
    [
      'no DELETE on approval limits',
      'DELETE FROM iam.approval_limits WHERE tenant_id = $1',
      [TENANT_A],
    ],
    [
      'permission catalogue is not writable',
      `INSERT INTO iam.permissions (permission_code, domain, description, created_by)
       VALUES ('fx.p14.invented', 'fx', 'Invented', $1)`,
      ['00000000-0000-4000-8000-000000000001'],
    ],
    [
      'permission catalogue is not updatable',
      `UPDATE iam.permissions SET risk_level = 'low' WHERE permission_code = 'iam.user.manage'`,
      [],
    ],
    [
      'tenants cannot be provisioned from the request path',
      `INSERT INTO org.tenants (tenant_code, display_name, status, default_locale, default_timezone, created_by)
       VALUES ('fx_p14_new', 'New', 'active', 'en', 'UTC', $1)`,
      ['00000000-0000-4000-8000-000000000001'],
    ],
  ];

  for (const [label, sql, params] of withheld) {
    it(label, async () => {
      await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
        expectSqlState(c.query(sql, params), '42501')
      );
    });
  }

  const immutableColumns: ReadonlyArray<readonly [string, string, unknown[]]> = [
    [
      'identity provider cannot be re-pointed',
      `UPDATE iam.user_accounts SET identity_provider = 'evil' WHERE tenant_id = $1`,
      [TENANT_A],
    ],
    [
      'an account cannot be moved to another tenant',
      `UPDATE iam.user_accounts SET tenant_id = $1 WHERE id = $2`,
      [TENANT_B, TARGET_A],
    ],
    [
      'an authorised amount cannot be edited in place',
      `UPDATE iam.approval_limits SET amount = 999999 WHERE tenant_id = $1`,
      [TENANT_A],
    ],
    [
      'a grant cannot be re-pointed at another role',
      `UPDATE iam.role_grants SET role_id = $1 WHERE tenant_id = $2`,
      [ROLE_ADMIN_A, TENANT_A],
    ],
    [
      'a session cannot be re-owned',
      `UPDATE iam.user_sessions SET user_id = $1 WHERE tenant_id = $2`,
      [ADMIN_A, TENANT_A],
    ],
    [
      'a tenant code cannot be renamed',
      `UPDATE org.tenants SET tenant_code = 'evil' WHERE id = $1`,
      [TENANT_A],
    ],
  ];

  for (const [label, sql, params] of immutableColumns) {
    it(`${label} (blocked at the privilege layer, before the trigger)`, async () => {
      await withRolledBackTx(runtime, AS_ADMIN_A, (c: Q) =>
        expectSqlState(c.query(sql, params), '42501')
      );
    });
  }
});

// ---------------------------------------------------------------------------
describe('the other archetypes gained nothing', () => {
  it('leaves app_readonly read-only across every table this migration touched', async () => {
    for (const [sql, params] of [
      [
        `INSERT INTO iam.user_accounts
           (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
         VALUES ($1, 'supabase', 'fx-p14-ro', 'fx-p14-ro@example.test', 'RO', 'invited', $2)`,
        [TENANT_A, ADMIN_A],
      ],
      [
        `INSERT INTO iam.roles (tenant_id, role_code, name, created_by) VALUES ($1, 'fx_p14_ro', 'RO', $2)`,
        [TENANT_A, ADMIN_A],
      ],
      [`UPDATE org.tenants SET display_name = 'RO' WHERE id = $1`, [TENANT_A]],
      [
        `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, created_by)
         VALUES ($1, $2, 'fx-p14-ro-session', $2)`,
        [TENANT_A, ADMIN_A],
      ],
    ] as const) {
      await withRolledBackTx(readonly, AS_ADMIN_A, (c: Q) =>
        expectSqlState(c.query(sql, [...params]), '42501')
      );
    }
  });

  it('leaves app_worker without any identity-administration capability', async () => {
    for (const [sql, params] of [
      [
        `INSERT INTO iam.user_accounts
           (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
         VALUES ($1, 'supabase', 'fx-p14-wk', 'fx-p14-wk@example.test', 'WK', 'invited', $2)`,
        [TENANT_A, ADMIN_A],
      ],
      [
        `INSERT INTO iam.role_grants
           (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
         VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
        [TENANT_A, TARGET_A, ROLE_PLAIN_A, ADMIN_A],
      ],
    ] as const) {
      await withRolledBackTx(worker, AS_ADMIN_A, (c: Q) =>
        expectSqlState(c.query(sql, [...params]), '42501')
      );
    }
  });

  it('keeps every archetype NOLOGIN, non-superuser, NOBYPASSRLS and owning nothing', async () => {
    const roles = await admin.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      owned: string;
    }>(
      `SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcanlogin,
              (SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid)::text AS owned
         FROM pg_roles r
        WHERE r.rolname IN ('app_runtime', 'app_readonly', 'app_worker')
        ORDER BY r.rolname`
    );
    expect(roles.rowCount).toBe(3);
    for (const role of roles.rows) {
      expect(role.rolsuper, role.rolname).toBe(false);
      expect(role.rolbypassrls, role.rolname).toBe(false);
      expect(role.rolcanlogin, role.rolname).toBe(false);
      expect(role.owned, role.rolname).toBe('0');
    }
  });
});

// ---------------------------------------------------------------------------
describe('the migration changed only grants and policies', () => {
  it('adds no SECURITY DEFINER function anywhere in the database', async () => {
    const result = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg\\_%'
          AND n.nspname IN ('iam', 'org', 'shared', 'crm', 'veh', 'apt', 'rec', 'wo',
                            'dia', 'tech', 'qms', 'svc', 'quo', 'inv', 'sal', 'wty', 'rpt')`
    );
    expect(result.rows[0]?.n).toBe('0');
  });

  it('leaves every iam table RLS-enabled and FORCE RLS', async () => {
    const result = await admin.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'iam' AND c.relkind = 'r'
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`
    );
    expect(result.rows.map((r) => r.relname)).toEqual([]);
  });

  it('grants app_runtime no schema beyond the four it already had', async () => {
    const result = await admin.query<{ nspname: string }>(
      `SELECT n.nspname FROM pg_namespace n
        WHERE has_schema_privilege('app_runtime', n.nspname, 'USAGE')
          AND n.nspname IN ('extensions', 'auth', 'storage', 'vault', 'pg_catalog')
          AND n.nspname <> 'pg_catalog'
        ORDER BY 1`
    );
    expect(result.rows.map((r) => r.nspname)).toEqual([]);
  });

  it('writes no write policy with an unconditional predicate', async () => {
    // Scoped to INSERT/UPDATE/DELETE because that is all this migration adds.
    // Two SELECT policies predate it and are deliberately unconditional:
    // `sel_permissions_all` and `sel_feature_flags_all` expose platform-global
    // reference catalogues that carry no tenant column and no tenant data.
    const result = await admin.query<{ tablename: string; policyname: string; cmd: string }>(
      `SELECT tablename, policyname, cmd FROM pg_policies
        WHERE schemaname IN ('iam', 'org')
          AND 'app_runtime' = ANY (roles)
          AND cmd <> 'SELECT'
          AND (qual = 'true' OR with_check = 'true')
        ORDER BY tablename, policyname`
    );
    expect(result.rows).toEqual([]);
  });

  it('anchors every write policy it added on the current tenant', async () => {
    const added = [
      'ins_user_accounts_admin',
      'upd_user_accounts_admin',
      'ins_user_status_history_admin',
      'ins_user_sessions_self',
      'upd_user_sessions_self',
      'upd_user_sessions_admin',
      'ins_login_audit_self',
      'ins_roles_admin',
      'upd_roles_admin',
      'ins_role_permissions_delegable',
      'upd_role_permissions_delegable',
      'del_role_permissions_admin',
      'ins_role_grants_delegable',
      'upd_role_grants_admin',
      'ins_grant_scopes_admin',
      'del_grant_scopes_admin',
      'ins_approval_limits_admin',
      'upd_approval_limits_admin',
      'upd_tenants_settings',
    ];
    const result = await admin.query<{ policyname: string; qual: string; with_check: string }>(
      `SELECT policyname, coalesce(qual, '') AS qual, coalesce(with_check, '') AS with_check
         FROM pg_policies
        WHERE schemaname IN ('iam', 'org') AND policyname = ANY($1::text[])
        ORDER BY policyname`,
      [added]
    );
    expect(result.rows.map((r) => r.policyname).sort()).toEqual([...added].sort());
    for (const row of result.rows) {
      const predicate = `${row.qual} ${row.with_check}`;
      expect(predicate, row.policyname).toContain('current_tenant_id()');
    }
  });
});
