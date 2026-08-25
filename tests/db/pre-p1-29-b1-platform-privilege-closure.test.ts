/**
 * PRE-P1-29 Wave B, slice B1 — platform database foundation, proven by execution.
 *
 * ## Why this suite exists
 *
 * The Wave B control-plane design was reviewed three times. Each round found
 * fewer defects — 3 HIGH, then 1, then 1 — and every single one belonged to ONE
 * class: a privilege the runtime path genuinely needs that the design had not
 * enumerated, because it reasoned at the entry point rather than along the whole
 * `SECURITY INVOKER` call chain.
 *
 *   B1  the audit writer's three helpers
 *   B2  the resolver's own read of `iam.user_accounts`
 *   B3  a `FOR UPDATE` policy whose `USING` was reused as its check
 *   4   `org.change_tenant_status`'s `SELECT ... FOR UPDATE`
 *   5   its SECOND write, left to a policy the first write makes false
 *
 * Document review was demonstrably not converging on the sixth. So the gate
 * moved here: this suite executes each sanctioned path AS the role, end to end,
 * and a sixth instance duly appeared the moment it ran — see B1-UG-001 below.
 *
 * ## The two directions
 *
 * `scripts/ci/rls-matrix.mjs` short-circuits on `if (!granted)` at :236-237, so
 * it answers "is any PRESENT privilege too broad?" and is structurally blind to
 * "is any REQUIRED privilege missing?". Both directions are asserted here:
 * §"required privileges are present" walks the closure, §"the role is narrow"
 * walks the prohibitions, and §"mutations" proves each assertion can fail.
 *
 * Nothing in this file runs on the admin connection. `postgres` carries
 * BYPASSRLS locally and is superuser in CI, so anything it does is not evidence
 * about a policy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  ensureTestLogins,
  expectSqlState,
  platformPool,
  runtimePool,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const SYSTEM = '00000000-0000-4000-8000-000000000001';

/**
 * Asserts a statement is refused, without poisoning the transaction.
 *
 * A refused statement leaves PostgreSQL in an aborted transaction, so a second
 * assertion in the same block answers 25P02 — "current transaction is aborted"
 * — rather than its own SQLSTATE. That reads as a passing refusal while
 * measuring nothing, which is the vacuous-proof shape this whole slice exists
 * to avoid. Each expectation gets its own savepoint.
 */
async function refused(
  db: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  label: string,
  sql: string,
  values: unknown[],
  ...codes: string[]
): Promise<void> {
  await db.query('SAVEPOINT probe');
  try {
    await db.query(sql, values);
    throw new Error(`${label}: expected ${codes.join(' or ')} but the statement succeeded`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    await db.query('ROLLBACK TO SAVEPOINT probe');
    if (!code || !codes.includes(code)) {
      throw new Error(
        `${label}: expected ${codes.join(' or ')} but got ${code ?? '(none)'} — ${(err as Error).message}`
      );
    }
  }
}

/** The 17 RootLco business schemas. The local Supabase stack also carries
 *  auth/storage/realtime/vault objects the CI plain-postgres container does
 *  not, so any structural assertion has to name its population or it measures
 *  the developer's stack rather than the product. */
const ROOTLCO_SCHEMAS = [
  'org',
  'iam',
  'shared',
  'crm',
  'veh',
  'apt',
  'rec',
  'wo',
  'tech',
  'dia',
  'qms',
  'svc',
  'quo',
  'inv',
  'sal',
  'wty',
  'rpt',
];

/** Deterministic B1 fixtures. Every code matches `^[a-z][a-z0-9_]{1,62}$`. */
const OPERATOR = 'f1000000-0000-4000-8000-00000000000f';
const OPERATOR_HOME = 'f1000000-0000-4000-8000-0000000000a0';
const PLAIN_USER = 'f1000000-0000-4000-8000-00000000000e';
const REVOKED_OPERATOR = 'f1000000-0000-4000-8000-00000000000d';
/** Holds platform.organization.read and nothing else. H3 has no meaning without it. */
const READER = 'f1000000-0000-4000-8000-00000000000c';
const HOME_CODE = 'b1_operator_home';

const PROVISION = 'platform.organization.provision';
const READ = 'platform.organization.read';
const LIFECYCLE = 'platform.organization.lifecycle';

let admin: Pool;
let platform: Pool;
let runtime: Pool;

/** A provisioning spec the canonical function accepts. */
function spec(code: string) {
  return {
    tenant: { code, display_name: `B1 ${code}`, locale: 'en', timezone: 'UTC' },
    company: {
      code: `${code}_co`,
      legal_name: `B1 ${code} Company`,
      registration_number: `${code}-1`,
      base_currency: 'JOD',
    },
    branch: { code: 'main', name: 'Main', city: 'Amman', country_code: 'JO', timezone: 'UTC' },
  };
}

/**
 * Establishes a recoverable Owner for a tenant inside its bootstrap window.
 *
 * Activation now REQUIRES this: org.guard_tenant_status_transition refuses
 * provisioning -> active unless org.tenant_has_recoverable_owner is true, so a
 * tenant cannot go live with nobody able to administer it. Every test that
 * activates a tenant has to do the thing a real bootstrap does first, which is
 * the point of the invariant.
 */
async function establishOwner(pool: Pool, operator: string, tenantId: string): Promise<string> {
  return withCommittedTx(pool, { userId: operator, tenantId }, async (db) => {
    const account = await db.query<{ id: string }>(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,'local',$2,$3,'Owner','active',$4) RETURNING id`,
      [
        tenantId,
        'owner-' + tenantId.slice(0, 8),
        'owner-' + tenantId.slice(0, 8) + '@example.invalid',
        operator,
      ]
    );
    const role = await db.query<{ id: string }>(
      `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
       VALUES ($1,'company_owner','Company Owner',$2) RETURNING id`,
      [tenantId, operator]
    );
    // The role has to CONFER something. Readiness resolves iam.role.manage and
    // iam.grant.manage through the role-permission mapping with the same
    // allow/deny arithmetic iam.has_permission uses, so an empty role is an
    // owner who can administer nothing.
    await db.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, p.id, 'allow', $3
         FROM iam.permissions p
        WHERE p.permission_code IN ('iam.role.manage', 'iam.grant.manage', 'iam.user.manage')`,
      [tenantId, role.rows[0]!.id, operator]
    );
    await db.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted','active',$4,$4)`,
      [tenantId, account.rows[0]!.id, role.rows[0]!.id, operator]
    );
    return account.rows[0]!.id;
  });
}

/** Removes every tenant this suite creates, children first. */
async function dropB1Tenants(): Promise<void> {
  // LIKE 'b1\\_%' with the underscore ESCAPED. Unescaped, '_' is a
  // single-character wildcard, so 'b1_%' also matches every b1t_… and b1m_…
  // tenant — this suite was deleting the other two suites' fixtures out from
  // under them whenever they ran in the same process.
  const scope = `(SELECT id FROM org.tenants WHERE tenant_code LIKE 'b1\\_%')`;
  await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key LIKE 'b1-%'`);
  // ONE transaction, because tg_role_grants_require_scope is DEFERRED: it checks
  // at COMMIT that every scoped ACTIVE grant still has at least one scope row.
  // Deleting iam.grant_scopes in its own autocommitted statement therefore fails
  // on any scoped grant the suite created — the scopes are gone and the grant is
  // still there. Inside one transaction both disappear before the check runs.
  const conn = await admin.connect();
  try {
    await conn.query('BEGIN');
    for (const table of [
      'iam.grant_scopes',
      'iam.role_grants',
      'iam.role_permissions',
      'iam.roles',
      'iam.audit_integrity_links',
      'iam.audit_record_details',
      'iam.audit_records',
      'iam.user_status_history',
    ]) {
      await conn.query(`DELETE FROM ${table} WHERE tenant_id IN ${scope}`);
    }
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }
  await admin.query(
    `DELETE FROM iam.platform_grants
      WHERE user_account_id IN (SELECT id FROM iam.user_accounts WHERE tenant_id IN ${scope})`
  );
  await admin.query(`DELETE FROM iam.user_accounts WHERE tenant_id IN ${scope}`);
  for (const table of [
    'shared.number_sequences',
    'org.tenant_feature_overrides',
    'org.branch_settings',
    'org.company_settings',
    'org.branches',
    'org.legal_companies',
    'org.tenant_subscriptions',
    'org.tenant_status_history',
  ]) {
    await admin.query(`DELETE FROM ${table} WHERE tenant_id IN ${scope}`);
  }
  // The SAME escape as the child scope above. This line was the other half of
  // that bug and the comment at :183 claimed both halves were fixed — the child
  // deletes were scoped with 'b1\\_%' while the tenants themselves were still
  // deleted with the unescaped form, so this suite went on removing the other
  // two suites' tenant rows against 152 RESTRICT foreign keys.
  await admin.query(`DELETE FROM org.tenants WHERE tenant_code LIKE 'b1\\_%'`);
}

/** Provisions a tenant through the sanctioned platform path and commits it. */
async function provisionCommitted(code: string, key: string): Promise<string> {
  return withCommittedTx(platform, { userId: OPERATOR }, async (db) => {
    const r = await db.query<{ out: { tenant_id: string } }>(
      'SELECT org.provision_organization($1::jsonb, $2) AS out',
      [JSON.stringify(spec(code)), key]
    );
    return r.rows[0]!.out.tenant_id;
  });
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  platform = platformPool();
  runtime = runtimePool();

  await dropB1Tenants();
  await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = ANY($1::uuid[])`, [
    [OPERATOR, PLAIN_USER, REVOKED_OPERATOR, READER],
  ]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])`, [
    [OPERATOR, PLAIN_USER, REVOKED_OPERATOR, READER],
  ]);
  await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [OPERATOR_HOME]);

  // The operator authenticates as an ORDINARY account. Platform authority is
  // the relation, never the account — which is the whole point of §5 of the
  // design and the reason no parallel identity system exists.
  await admin.query(
  // 'provisioning', then an owner, then activation — the order the product uses.
  // A tenant may not ARRIVE at 'active' without a recoverable administrator, by
  // INSERT or by UPDATE, and the operator's home tenant is not exempt just
  // because it exists to hold an account.
    `INSERT INTO org.tenants (id, tenant_code, display_name, default_locale, default_timezone, status, created_by)
     VALUES ($1,$2,'B1 operator home','en','UTC','provisioning',$3)`,
    [OPERATOR_HOME, HOME_CODE, SYSTEM]
  );
  for (const [id, subject, name] of [
    [OPERATOR, 'b1-operator', 'B1 Operator'],
    [PLAIN_USER, 'b1-plain', 'B1 Plain User'],
    [REVOKED_OPERATOR, 'b1-revoked', 'B1 Revoked Operator'],
    [READER, 'b1-reader', 'B1 Read-Only Operator'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,'local',$3,$4,$5,'active',$6)`,
      [id, OPERATOR_HOME, subject, `${subject}@example.invalid`, name, SYSTEM]
    );
  }
  for (const code of [PROVISION, READ, LIFECYCLE]) {
    await admin.query(
      `INSERT INTO iam.platform_grants (user_account_id, permission_code, granted_by, created_by)
       VALUES ($1,$2,$3,$3)`,
      [OPERATOR, code, SYSTEM]
    );
  }
  // A read-only platform principal. platform.organization.read is catalogued
  // medium risk and is the weakest authority the control plane issues; H3 is
  // the proof that it cannot write.
  await admin.query(
    `INSERT INTO iam.platform_grants (user_account_id, permission_code, granted_by, created_by)
     VALUES ($1,$2,$3,$3)`,
    [READER, READ, SYSTEM]
  );

  // A revoked holder, to prove the resolver reads status and not mere presence.
  await admin.query(
    `INSERT INTO iam.platform_grants
       (user_account_id, permission_code, status, revoked_at, revoked_by, revoke_reason, granted_by, created_by)
     VALUES ($1,$2,'revoked', now(), $3, 'b1 fixture', $3, $3)`,
    [REVOKED_OPERATOR, PROVISION, SYSTEM]
  );

  // The operator's own account becomes its home tenant's administrator, so the
  // home tenant can go live at all. Ordinary tenant authority — platform
  // authority is still the separate relation, which is the whole point of it.
  const homeRole = await admin.query<{ id: string }>(
    `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
     VALUES ($1,'fx_home_owner','Home owner',$2) RETURNING id`,
    [OPERATOR_HOME, SYSTEM]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p
      WHERE p.permission_code IN ('iam.role.manage', 'iam.grant.manage', 'iam.user.manage')`,
    [OPERATOR_HOME, homeRole.rows[0]!.id, SYSTEM]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted','active',$4,$4)`,
    [OPERATOR_HOME, OPERATOR, homeRole.rows[0]!.id, SYSTEM]
  );
  await admin.query(`UPDATE org.tenants SET status = 'active' WHERE id = $1`, [OPERATOR_HOME]);
});

afterAll(async () => {
  await dropB1Tenants();
  await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = ANY($1::uuid[])`, [
    [OPERATOR, PLAIN_USER, REVOKED_OPERATOR, READER],
  ]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])`, [
    [OPERATOR, PLAIN_USER, REVOKED_OPERATOR, READER],
  ]);
  await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [OPERATOR_HOME]);
  await Promise.all([platform.end(), runtime.end(), admin.end()]);
});

// ---------------------------------------------------------------------------
describe('the platform role is what it claims to be', () => {
  it('has no login, no superuser and no RLS bypass', async () => {
    const r = await admin.query<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_platform'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false });
  });

  it('owns no schema and no table', async () => {
    const schemas = await admin.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
        WHERE r.rolname = 'app_platform'`
    );
    expect(schemas.rows).toEqual([]);
    const tables = await admin.query<{ relname: string }>(
      `SELECT relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
        WHERE r.rolname = 'app_platform'`
    );
    expect(tables.rows).toEqual([]);
  });

  it('is not a member of app_runtime — the delegation backstop depends on it', async () => {
    // iam.grant_delegation_within_authority returns true unconditionally for a
    // non-member (20260727090000:108-110). Membership would silently change
    // that function's behaviour for every caller.
    const r = await admin.query<{ member: boolean }>(
      `SELECT pg_has_role('app_platform', 'app_runtime', 'MEMBER') AS member`
    );
    expect(r.rows[0]!.member).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('PATH 0 — the platform authority resolver', () => {
  it('answers true for a live grant and false for an unknown code', async () => {
    await withRolledBackTx(platform, { userId: OPERATOR }, async (db) => {
      const r = await db.query<{ provision: boolean; read: boolean; unknown: boolean }>(
        `SELECT iam.has_platform_authority($1) AS provision,
                iam.has_platform_authority($2) AS read,
                iam.has_platform_authority('nope.not.a.code') AS unknown`,
        [PROVISION, READ]
      );
      expect(r.rows[0]).toEqual({ provision: true, read: true, unknown: false });
    });
  });

  it('answers false for an ordinary tenant user holding no platform grant', async () => {
    await withRolledBackTx(platform, { userId: PLAIN_USER }, async (db) => {
      const r = await db.query<{ v: boolean }>(`SELECT iam.has_platform_authority($1) AS v`, [
        PROVISION,
      ]);
      expect(r.rows[0]!.v).toBe(false);
    });
  });

  it('answers false once the grant is revoked', async () => {
    await withRolledBackTx(platform, { userId: REVOKED_OPERATOR }, async (db) => {
      const r = await db.query<{ v: boolean }>(`SELECT iam.has_platform_authority($1) AS v`, [
        PROVISION,
      ]);
      expect(r.rows[0]!.v).toBe(false);
    });
  });

  it('answers false when the account itself is disabled', async () => {
    // ck_user_accounts_status admits invited | active | locked | archived.
    await admin.query(`UPDATE iam.user_accounts SET status = 'locked' WHERE id = $1`, [OPERATOR]);
    try {
      await withRolledBackTx(platform, { userId: OPERATOR }, async (db) => {
        const r = await db.query<{ v: boolean }>(`SELECT iam.has_platform_authority($1) AS v`, [
          PROVISION,
        ]);
        expect(r.rows[0]!.v).toBe(false);
      });
    } finally {
      await admin.query(`UPDATE iam.user_accounts SET status = 'active' WHERE id = $1`, [OPERATOR]);
    }
  });

  it('answers false with no acting principal at all', async () => {
    await withRolledBackTx(platform, {}, async (db) => {
      const r = await db.query<{ v: boolean }>(`SELECT iam.has_platform_authority($1) AS v`, [
        PROVISION,
      ]);
      expect(r.rows[0]!.v).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
describe('PATH 2 — provisioning through the canonical function', () => {
  it('creates the full organisation as app_platform and records replay', async () => {
    const tenantId = await provisionCommitted('b1_provision', 'b1-provision-key');

    // The canonical contract, read back on the admin connection because these
    // are assertions about WHAT WAS WRITTEN, not about who may read it.
    const counts = await admin.query<{ what: string; n: string }>(
      `SELECT 'tenant' AS what, count(*)::text AS n FROM org.tenants WHERE id = $1
       UNION ALL SELECT 'history', count(*)::text FROM org.tenant_status_history WHERE tenant_id = $1
       UNION ALL SELECT 'company', count(*)::text FROM org.legal_companies WHERE tenant_id = $1
       UNION ALL SELECT 'branch',  count(*)::text FROM org.branches WHERE tenant_id = $1
       UNION ALL SELECT 'replay',  count(*)::text FROM shared.idempotency_keys
                  WHERE tenant_id IS NULL AND idempotency_key = 'b1-provision-key'`,
      [tenantId]
    );
    const byWhat = Object.fromEntries(counts.rows.map((r) => [r.what, Number(r.n)]));
    expect(byWhat).toMatchObject({ tenant: 1, history: 1, company: 1, branch: 1, replay: 1 });

    const status = await admin.query<{ status: string }>(
      `SELECT status FROM org.tenants WHERE id = $1`,
      [tenantId]
    );
    // The bootstrap window is OPEN, and provisioning did not close it.
    expect(status.rows[0]!.status).toBe('provisioning');
  });

  it('replays on the same key and fingerprint without creating a second organisation', async () => {
    const before = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM org.tenants WHERE tenant_code = 'b1_provision'`
    );
    const replayed = await withRolledBackTx(platform, { userId: OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1_provision')), 'b1-provision-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    const after = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM org.tenants WHERE tenant_code = 'b1_provision'`
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(replayed).toBeTruthy();
  });

  it('refuses the same key with a different request', async () => {
    await withRolledBackTx(platform, { userId: OPERATOR }, async (db) => {
      await expectSqlState(
        db.query('SELECT org.provision_organization($1::jsonb, $2)', [
          JSON.stringify(spec('b1_different')),
          'b1-provision-key',
        ]),
        '23000'
      );
    });
  });

  it('leaves nothing behind when the transaction fails after provisioning', async () => {
    const key = 'b1-rollback-key';
    await expect(
      withCommittedTx(platform, { userId: OPERATOR }, async (db) => {
        await db.query('SELECT org.provision_organization($1::jsonb, $2)', [
          JSON.stringify(spec('b1_rollback')),
          key,
        ]);
        throw new Error('forced failure after provisioning');
      })
    ).rejects.toThrow('forced failure');

    const left = await admin.query<{ tenants: string; keys: string }>(
      `SELECT (SELECT count(*)::text FROM org.tenants WHERE tenant_code = 'b1_rollback') AS tenants,
              (SELECT count(*)::text FROM shared.idempotency_keys WHERE idempotency_key = $1) AS keys`,
      [key]
    );
    // No half-provisioned tenant, and the replay row rolled back with it, so a
    // corrected retry starts clean rather than colliding.
    expect(left.rows[0]).toEqual({ tenants: '0', keys: '0' });
  });

  it('refuses provisioning to a caller with no platform authority', async () => {
    await withRolledBackTx(platform, { userId: PLAIN_USER }, async (db) => {
      await expectSqlState(
        db.query('SELECT org.provision_organization($1::jsonb, $2)', [
          JSON.stringify(spec('b1_denied')),
          'b1-denied-key',
        ]),
        '42501'
      );
    });
  });

  it('refuses provisioning to app_runtime entirely', async () => {
    await withRolledBackTx(runtime, { tenantId: OPERATOR_HOME, userId: OPERATOR }, async (db) => {
      await expectSqlState(
        db.query('SELECT org.provision_organization($1::jsonb, $2)', [
          JSON.stringify(spec('b1_runtime')),
          'b1-runtime-key',
        ]),
        '42501'
      );
    });
  });
});

// ---------------------------------------------------------------------------
describe('PATH 3 — the full tenant lifecycle chain', () => {
  it('commits all three statements of org.change_tenant_status in one transaction', async () => {
    const tenantId = await provisionCommitted('b1_lifecycle', 'b1-lifecycle-key');
    // Activation requires a recoverable Owner — see establishOwner above.
    await establishOwner(platform, OPERATOR, tenantId);

    await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1, 'active', 'b1 activation')`, [tenantId]);
    });

    // Statement 1 (SELECT ... FOR UPDATE) and 2 (UPDATE) — finding 4.
    const t = await admin.query<{ status: string }>(
      `SELECT status FROM org.tenants WHERE id = $1`,
      [tenantId]
    );
    expect(t.rows[0]!.status).toBe('active');

    // Statement 3 (INSERT history) — finding 5. Exactly one row, and its
    // content is asserted rather than its existence.
    const h = await admin.query<{
      from_state: string;
      to_state: string;
      reason: string;
      actor_id: string;
      occurred_at: string;
    }>(
      `SELECT from_state, to_state, reason, actor_id, occurred_at
         FROM org.tenant_status_history
        WHERE tenant_id = $1 AND to_state = 'active'`,
      [tenantId]
    );
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]!.from_state).toBe('provisioning');
    expect(h.rows[0]!.to_state).toBe('active');
    expect(h.rows[0]!.reason).toBe('b1 activation');
    expect(h.rows[0]!.actor_id).toBe(OPERATOR);
    expect(h.rows[0]!.occurred_at).toBeTruthy();
  });

  it('refuses a lifecycle transition to a caller holding no lifecycle authority', async () => {
    const tenantId = await provisionCommitted('b1_nolifecycle', 'b1-nolifecycle-key');
    await withRolledBackTx(platform, { userId: PLAIN_USER, tenantId }, async (db) => {
      await expectSqlState(
        db.query(`SELECT org.change_tenant_status($1, 'active', 'denied')`, [tenantId]),
        '42501',
        'P0002'
      );
    });
  });
});

// ---------------------------------------------------------------------------
describe('the transition backstop holds for every writer', () => {
  it('refuses a direct illegal transition, and refuses a return to provisioning', async () => {
    const tenantId = await provisionCommitted('b1_backstop', 'b1-backstop-key');
    await establishOwner(platform, OPERATOR, tenantId);
    await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1, 'active', 'b1 activate')`, [tenantId]);
    });

    // Refused — and WHICH layer refuses it is worth recording, because the
    // design has the order backwards. A BEFORE UPDATE trigger runs before the
    // row-level WITH CHECK is evaluated, so in practice the trigger answers
    // first (23514) and the policy never gets the chance (42501). Both are
    // real; the design calls the policy the first line of defence and the
    // trigger the backstop, and execution shows the reverse. Either SQLSTATE
    // is a refusal, and the test accepts both rather than pinning an ordering
    // PostgreSQL decides.
    await withRolledBackTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      await refused(
        db,
        'direct return to provisioning as app_platform',
        `UPDATE org.tenants SET status = 'provisioning' WHERE id = $1`,
        [tenantId],
        '23514',
        '42501'
      );
    });

    // ...and the TRIGGER refuses transitions the destination list admits but the
    // graph does not. This is the half a destination whitelist cannot cover, and
    // it is asserted on the admin connection precisely because that connection
    // bypasses RLS — so only the trigger can be what refuses it.
    await admin.query(`UPDATE org.tenants SET status = 'closed' WHERE id = $1`, [tenantId]);
    await expectSqlState(
      admin.query(`UPDATE org.tenants SET status = 'active' WHERE id = $1`, [tenantId]),
      '23514'
    );
    await expectSqlState(
      admin.query(`UPDATE org.tenants SET status = 'provisioning' WHERE id = $1`, [tenantId]),
      '23514'
    );
  });

  it('does not fire when the status is unchanged', async () => {
    // app_runtime holds a column-scoped UPDATE on three settings columns
    // (20260726090000:174). A lifecycle backstop that refused those would be a
    // regression, so the trigger's IS DISTINCT FROM guard is load-bearing.
    await expect(
      admin.query(`UPDATE org.tenants SET display_name = 'B1 renamed' WHERE id = $1`, [
        OPERATOR_HOME,
      ])
    ).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('PATH 4 — the audit chain', () => {
  it('appends an event as app_platform through the whole helper chain', async () => {
    const tenantId = await provisionCommitted('b1_audit', 'b1-audit-key');
    const recordId = await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.organization.provisioned','tenant',$1,
                                   NULL,NULL,NULL,'b1',$3::jsonb) AS id`,
        [tenantId, OPERATOR, JSON.stringify([{ field: 'status', new: 'provisioning' }])]
      );
      return r.rows[0]!.id;
    });
    expect(recordId).toBeTruthy();

    const written = await admin.query<{ actor_id: string; action: string; details: string }>(
      `SELECT r.actor_id, r.action,
              (SELECT count(*)::text FROM iam.audit_record_details d WHERE d.audit_record_id = r.id) AS details
         FROM iam.audit_records r WHERE r.id = $1`,
      [recordId]
    );
    // The session supplies its OWN id and the row is accepted.
    //
    // iam.audit_append still writes its p_actor argument verbatim
    // (20260725090000:199-204) and never consults the session — so the WRITER
    // does not bind the actor. The row-level policy does, and the forgery case
    // in the next test is what proves it. An earlier version of this test passed
    // the same id as both argument and session, so it could not have told the
    // difference either way.
    expect(written.rows[0]!.actor_id).toBe(OPERATOR);
    expect(written.rows[0]!.details).toBe('1');

    const chain = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_integrity_links WHERE audit_record_id = $1`,
      [recordId]
    );
    expect(chain.rows[0]!.n).toBe('1');
  });

  it('refuses an actor the session is not — forgery is a row-level refusal', async () => {
    /*
     * The provenance question, answered in the database rather than deferred.
     *
     * ins_audit_records_platform carries actor_id = iam.current_user_id(), so a
     * platform session can only ever record ITSELF as the actor. app_platform
     * deliberately KEEPS its EXECUTE on iam.audit_append — the containment is
     * the finished row, not the entry point, so calling the writer directly
     * gains an attacker nothing.
     *
     * A wrapper function was the obvious alternative and does not work in this
     * repository: it would have to be SECURITY INVOKER like everything else, so
     * revoking EXECUTE on the generic writer to force callers through it would
     * revoke it from the wrapper's own body too.
     */
    const tenantId = await provisionCommitted('b1_audit_forge', 'b1-audit-forge-key');

    // A different, real, active account in the same tenant — so the refusal is
    // about provenance and not about the id being unusable.
    const otherId = await admin.query<{ id: string }>(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,'local','b1-forge-target','forge@example.invalid','Forge Target','active',$2)
       RETURNING id`,
      [tenantId, SYSTEM]
    );

    await withRolledBackTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      await refused(
        db,
        'audit actor forgery',
        `SELECT iam.audit_append($1,$2,'user','platform.forged','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb)`,
        [tenantId, otherId.rows[0]!.id],
        '42501'
      );
      // The control: the same call with the session's own id is accepted, so
      // the refusal above is the actor term and nothing else about the call.
      const ok = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.honest','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
        [tenantId, OPERATOR]
      );
      expect(ok.rows[0]!.id).toBeTruthy();
    });

    // Nothing forged survived the rollback, and nothing forged was ever written.
    const forged = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = 'platform.forged'`
    );
    expect(forged.rows[0]!.n).toBe('0');
  });

  it('refuses the append once platform authority is revoked', async () => {
    // The second conjunct of the same policy. The operator is unchanged and the
    // tenant is unchanged; only the authority has gone.
    const tenantId = await provisionCommitted('b1_audit_revoked', 'b1-audit-revoked-key');
    await admin.query(
      `UPDATE iam.platform_grants SET status = 'revoked', revoked_at = now(), revoked_by = $2
        WHERE user_account_id = $1`,
      [OPERATOR, SYSTEM]
    );
    try {
      await withRolledBackTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
        await refused(
          db,
          'audit append with no authority',
          `SELECT iam.audit_append($1,$2,'user','platform.unauthorised','tenant',$1,
                                   NULL,NULL,NULL,'b1','[]'::jsonb)`,
          [tenantId, OPERATOR],
          '42501'
        );
      });
    } finally {
      await admin.query(
        `UPDATE iam.platform_grants SET status = 'active', revoked_at = NULL, revoked_by = NULL
          WHERE user_account_id = $1`,
        [OPERATOR]
      );
    }
    // Restored, so the refusal above was the revocation and not a latent break.
    await withRolledBackTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const ok = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.restored','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
        [tenantId, OPERATOR]
      );
      expect(ok.rows[0]!.id).toBeTruthy();
    });
  });

  it('leaves ordinary app_runtime audit semantics exactly as they were', async () => {
    // The new policy is TO app_platform, so it must not touch the tenant-side
    // writer. app_runtime's audit INSERT policies are asserted here by their
    // definitions rather than by exercising them, because what has to be shown
    // is the ABSENCE of a change: no actor term was added to any of them.
    const runtime = await admin.query<{ policyname: string; withcheck: string | null }>(
      `SELECT policyname, with_check AS withcheck FROM pg_policies
        WHERE schemaname = 'iam' AND tablename = 'audit_records'
          AND 'app_runtime' = ANY (roles) AND cmd = 'INSERT'
        ORDER BY policyname`
    );
    expect(runtime.rows.length).toBeGreaterThan(0);
    for (const row of runtime.rows) {
      expect(row.withcheck ?? '').not.toContain('current_user_id');
      expect(row.withcheck ?? '').not.toContain('platform');
    }

    // And the platform policy is scoped to app_platform alone.
    // pg_policies.roles is name[], which node-pg has no array parser for and
    // hands back as the literal '{app_platform}'. Joined in SQL so the assertion
    // compares a value and not a serialisation.
    const mine = await admin.query<{ roles: string; withcheck: string | null }>(
      `SELECT array_to_string(roles, ',') AS roles, with_check AS withcheck FROM pg_policies
        WHERE schemaname = 'iam' AND tablename = 'audit_records'
          AND policyname = 'ins_audit_records_platform'`
    );
    expect(mine.rows[0]!.roles).toBe('app_platform');
    expect(mine.rows[0]!.withcheck ?? '').toContain('current_user_id');
  });

  it('cannot amend or delete a committed audit event, nor read one back', async () => {
    const tenantId = await provisionCommitted('b1_audit_immutable', 'b1-audit-immutable-key');
    const recordId = await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.organization.provisioned','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
        [tenantId, OPERATOR]
      );
      return r.rows[0]!.id;
    });

    await withRolledBackTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      // No UPDATE or DELETE privilege exists on any audit table for any role,
      // so these fail at the privilege layer, before any policy is consulted.
      await refused(
        db,
        'audit UPDATE',
        `UPDATE iam.audit_records SET action = 'rewritten' WHERE id = $1`,
        [recordId],
        '42501'
      );
      await refused(
        db,
        'audit DELETE',
        `DELETE FROM iam.audit_records WHERE id = $1`,
        [recordId],
        '42501'
      );
      // And a COMMITTED record is invisible: the writer-scoped read admits only
      // a record with no chain link, which after commit is never any row.
      const seen = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM iam.audit_records WHERE id = $1`,
        [recordId]
      );
      expect(seen.rows[0]!.n).toBe('0');
    });
  });
});

// ---------------------------------------------------------------------------
describe('PATH 5 — initial Owner bootstrap, and B1-UG-001', () => {
  /**
   * B1-UG-001 — found by execution, invisible to three rounds of review.
   *
   *   RED    INSERT INTO iam.user_accounts (...) RETURNING id   -> 42501
   *          INSERT INTO iam.user_accounts (...)                -> PASS
   *
   *   Cause  RETURNING is evaluated against the SELECT policy. The platform
   *          read admitted only the operator's own row, so the bootstrap could
   *          create an Owner account and never learn its id — which it needs to
   *          grant that Owner a role.
   *
   *   Repair window-scoped FOR SELECT policies on the four bootstrap identity
   *          tables, permissive, closing with the window.
   *
   * The regression test is the RETURNING form below. It failed before the
   * repair and passes after it, and the plain-INSERT control beside it is what
   * makes the pair diagnostic rather than merely green.
   */
  it('creates the Owner account and can read back its id (B1-UG-001)', async () => {
    const tenantId = await provisionCommitted('b1_bootstrap', 'b1-bootstrap-key');
    await withRolledBackTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const plain = await db.query(
        `INSERT INTO iam.user_accounts
           (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
         VALUES ($1,'local','b1-owner-plain','plain@example.invalid','Plain','active',$2)`,
        [tenantId, OPERATOR]
      );
      expect(plain.rowCount).toBe(1);

      const returning = await db.query<{ id: string }>(
        `INSERT INTO iam.user_accounts
           (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
         VALUES ($1,'local','b1-owner','owner@example.invalid','B1 Owner','active',$2)
         RETURNING id`,
        [tenantId, OPERATOR]
      );
      expect(returning.rows[0]!.id).toBeTruthy();
    });
  });

  it('establishes the Owner role and grant inside the window', async () => {
    const tenantId = await provisionCommitted('b1_bootstrap_full', 'b1-bootstrap-full-key');
    const result = await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const account = await db.query<{ id: string }>(
        `INSERT INTO iam.user_accounts
           (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
         VALUES ($1,'local','b1-full-owner','full@example.invalid','B1 Full Owner','active',$2)
         RETURNING id`,
        [tenantId, OPERATOR]
      );
      const role = await db.query<{ id: string }>(
        `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
         VALUES ($1,'company_owner','Company Owner',$2) RETURNING id`,
        [tenantId, OPERATOR]
      );
      return { accountId: account.rows[0]!.id, roleId: role.rows[0]!.id };
    });
    expect(result.accountId).toBeTruthy();
    expect(result.roleId).toBeTruthy();
  });

  it('refuses the bootstrap write once the window has closed', async () => {
    const tenantId = await provisionCommitted('b1_window', 'b1-window-key');
    await establishOwner(platform, OPERATOR, tenantId);
    await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1, 'active', 'b1 close the window')`, [
        tenantId,
      ]);
    });
    await withRolledBackTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      await expectSqlState(
        db.query(
          `INSERT INTO iam.user_accounts
             (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
           VALUES ($1,'local','b1-late','late@example.invalid','Late','active',$2)`,
          [tenantId, OPERATOR]
        ),
        '42501'
      );
    });
  });

  it('refuses the bootstrap write to app_runtime and to a tenant actor', async () => {
    const tenantId = await provisionCommitted('b1_bootstrap_deny', 'b1-bootstrap-deny-key');
    await withRolledBackTx(runtime, { tenantId, userId: OPERATOR }, async (db) => {
      await expectSqlState(
        db.query(
          `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
           VALUES ($1,'sneaky','Sneaky',$2)`,
          [tenantId, OPERATOR]
        ),
        '42501'
      );
    });
    await withRolledBackTx(platform, { userId: PLAIN_USER, tenantId }, async (db) => {
      await expectSqlState(
        db.query(
          `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
           VALUES ($1,'sneaky','Sneaky',$2)`,
          [tenantId, PLAIN_USER]
        ),
        '42501'
      );
    });
  });
});

// ---------------------------------------------------------------------------
describe('the platform authority relation cannot be self-granted', () => {
  it('gives app_platform no write path of any kind', async () => {
    await withRolledBackTx(platform, { userId: OPERATOR }, async (db) => {
      for (const [label, statement] of [
        [
          'self-grant INSERT',
          `INSERT INTO iam.platform_grants (user_account_id, permission_code, granted_by, created_by)
           VALUES ('${PLAIN_USER}', '${PROVISION}', '${OPERATOR}', '${OPERATOR}')`,
        ],
        [
          'self-grant UPDATE',
          `UPDATE iam.platform_grants SET status = 'revoked' WHERE user_account_id = '${OPERATOR}'`,
        ],
        [
          'self-grant DELETE',
          `DELETE FROM iam.platform_grants WHERE user_account_id = '${OPERATOR}'`,
        ],
      ] as const) {
        await refused(db, label, statement, [], '42501');
      }
    });
  });

  it('gives app_runtime no access to the relation at all', async () => {
    await withRolledBackTx(runtime, { tenantId: OPERATOR_HOME, userId: OPERATOR }, async (db) => {
      await expectSqlState(db.query(`SELECT * FROM iam.platform_grants`), '42501');
    });
  });

  it('refuses a non-platform permission code by constraint', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO iam.platform_grants (user_account_id, permission_code, granted_by, created_by)
         VALUES ($1,'org.tenant.read',$2,$2)`,
        [PLAIN_USER, SYSTEM]
      ),
      '23514'
    );
  });

  it('refuses a duplicate active assignment', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO iam.platform_grants (user_account_id, permission_code, granted_by, created_by)
         VALUES ($1,$2,$3,$3)`,
        [OPERATOR, PROVISION, SYSTEM]
      ),
      '23505'
    );
  });

  it('lets a platform session read only its own authority rows', async () => {
    await withRolledBackTx(platform, { userId: REVOKED_OPERATOR }, async (db) => {
      const r = await db.query<{ user_account_id: string }>(
        `SELECT user_account_id FROM iam.platform_grants`
      );
      expect(r.rows.every((row) => row.user_account_id === REVOKED_OPERATOR)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
describe('the scope helpers do not widen a platform request', () => {
  it('cannot even ask what narrowing it carries', async () => {
    /*
     * C9 is the most dangerous assumption of the wave: an absent TENANT denies,
     * but an absent narrowing list WIDENS. The control plane's answer to it is
     * not a careful use of the helpers — it is that the helpers are out of
     * reach, and that no policy of its own would consult them anyway. Both
     * halves are asserted, because either alone is weaker than it looks.
     */
    await withRolledBackTx(platform, { userId: OPERATOR }, async (db) => {
      for (const fn of ['iam.allowed_company_ids()', 'iam.allowed_branch_ids()']) {
        await refused(db, 'platform call of ' + fn, `SELECT ${fn}`, [], '42501');
      }
      // The CONTEXT readers are a different matter and are granted: every policy
      // in this slice calls them. An absent tenant denies, so they are safe.
      const r = await db.query<{ t: string | null; u: string | null }>(
        `SELECT iam.current_tenant_id() AS t, iam.current_user_id() AS u`
      );
      expect(r.rows[0]!.t).toBeNull();
      expect(r.rows[0]!.u).toBe(OPERATOR);
    });

    const consulting = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policies
        WHERE 'app_platform' = ANY (roles)
          AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%allowed_%_ids%'`
    );
    expect(consulting.rows[0]!.n).toBe('0');
  });

  it('the asymmetry it is protected from is real, and still there for the runtime', async () => {
    // Asserted at source rather than by executing as app_platform, which can no
    // longer call these at all. The behaviour is unchanged for the roles that do
    // use them — this slice narrowed the platform role, it did not touch C9.
    const src = await admin.query<{ name: string; def: string }>(
      `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'iam'
          AND p.proname IN ('allowed_company_ids','allowed_branch_ids')
        ORDER BY 1`
    );
    expect(src.rows.map((r) => r.name)).toEqual(['allowed_branch_ids', 'allowed_company_ids']);
    for (const row of src.rows) {
      // NULL means "not narrowed", which is the widening direction. The empty
      // string is folded into the same answer.
      expect(row.def).toContain('NULL');
      expect(row.def).toContain("''");
    }

    // The runtime still gets the documented answers, empty string included.
    await withRolledBackTx(runtime, { userId: OPERATOR, tenantId: OPERATOR_HOME }, async (db) => {
      await db.query(`SELECT set_config('app.company_ids','',true)`);
      await db.query(`SELECT set_config('app.branch_ids','',true)`);
      const r = await db.query<{ c: string[] | null; b: string[] | null }>(
        `SELECT iam.allowed_company_ids() AS c, iam.allowed_branch_ids() AS b`
      );
      expect(r.rows[0]!.c).toBeNull();
      expect(r.rows[0]!.b).toBeNull();
    });
  });

  it('sees no business rows with a platform context and both scopes absent', async () => {
    // Helper return values are not the proof. Actual row visibility is.
    //
    // The table names are asserted to EXIST first, and that check is not
    // ceremony: app_platform holds no USAGE on any business schema, so
    // PostgreSQL refuses at the schema before it ever resolves the relation and
    // a misspelt table answers 42501 exactly like a real one. Two of the six
    // names here were wrong for that reason — crm.customers and inv.stock_items
    // do not exist — and the assertion passed anyway until an unrelated
    // over-grant mutation tried to GRANT on one of them.
    const BUSINESS_TABLES = [
      'crm.business_partners',
      'veh.vehicles',
      'apt.appointments',
      'wo.work_orders',
      'inv.stock_balances',
      'sal.invoices',
    ];
    for (const table of BUSINESS_TABLES) {
      const real = await admin.query<{ ok: boolean }>(
        `SELECT to_regclass($1) IS NOT NULL AS ok`,
        [table]
      );
      expect(real.rows[0]!.ok, `${table} must exist, or the denial below is vacuous`).toBe(true);
    }

    await withRolledBackTx(platform, { userId: OPERATOR }, async (db) => {
      for (const table of BUSINESS_TABLES) {
        // Denied at the privilege layer: the role holds no grant at all here, so
        // there is no policy for an absent scope to widen.
        await refused(
          db,
          `platform read of ${table}`,
          `SELECT count(*) FROM ${table}`,
          [],
          '42501'
        );
      }
    });
  });
});

// ---------------------------------------------------------------------------
describe('the role is narrow — the over-grant direction', () => {
  it('holds no EFFECTIVE privilege on any tenant business schema', async () => {
    /*
     * Effective, not named. information_schema.table_privileges lists what was
     * granted to a NAMED grantee, so it is blind to anything the role reaches
     * through PUBLIC or through membership — and this file has already been
     * caught making a false claim on exactly that basis about UPDATE and DELETE.
     * A single PUBLIC grant on a business table would slip past the old query in
     * silence, which is the one thing this assertion exists to prevent.
     *
     * has_table_privilege resolves all three routes, and schema USAGE is checked
     * separately because without it the table privileges are unreachable anyway
     * — and its absence is the cleaner statement of "no reach".
     */
    const BUSINESS = ['crm','veh','apt','rec','wo','tech','dia','qms','svc','quo','inv','sal','wty','rpt'];

    const usage = await admin.query<{ schema: string }>(
      `SELECT n.nspname AS schema FROM pg_namespace n
        WHERE n.nspname = ANY($1) AND has_schema_privilege('app_platform', n.oid, 'USAGE')
        ORDER BY 1`,
      [BUSINESS]
    );
    expect(usage.rows, 'no USAGE on any business schema').toEqual([]);

    const reach = await admin.query<{ rel: string; priv: string }>(
      `SELECT c.relnamespace::regnamespace || '.' || c.relname AS rel, p.priv
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
                            ('REFERENCES'),('TRIGGER')) AS p(priv)
        WHERE c.relkind IN ('r','p','v','m','f')
          AND n.nspname = ANY($1)
          AND has_table_privilege('app_platform', c.oid, p.priv)
        ORDER BY 1, 2`,
      [BUSINESS]
    );
    expect(reach.rows, 'no effective table privilege on any business relation').toEqual([]);

    // And the same question of the columns, since a column grant is invisible to
    // has_table_privilege.
    const columns = await admin.query<{ rel: string; col: string }>(
      `SELECT c.relnamespace::regnamespace || '.' || c.relname AS rel, att.attname AS col
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0
        WHERE n.nspname = ANY($1)
          AND (has_column_privilege('app_platform', c.oid, att.attname, 'SELECT')
            OR has_column_privilege('app_platform', c.oid, att.attname, 'INSERT')
            OR has_column_privilege('app_platform', c.oid, att.attname, 'UPDATE'))
        ORDER BY 1, 2`,
      [BUSINESS]
    );
    expect(columns.rows, 'no effective column privilege either').toEqual([]);
  });

  it('holds no EFFECTIVE DELETE or UPDATE in any RootLco schema, bar the status column', async () => {
    /*
     * This test used to ask information_schema.table_privileges, and the answer
     * it gave was wrong in a way that mattered.
     *
     * information_schema lists privileges granted to a NAMED grantee. It cannot
     * see a privilege the role holds through PUBLIC, and app_platform does hold
     * some: pg_net grants all eight table privileges on net.http_request_queue
     * and net._http_response to PUBLIC. So the old query returned no rows and
     * this file certified "no DELETE anywhere" while app_platform could in fact
     * DELETE from two tables. A gate that measures NAMED grants cannot make a
     * claim about EFFECTIVE authority.
     *
     * has_table_privilege resolves PUBLIC, membership and column grants — it
     * answers the question the sentence above actually asks.
     */
    const effective = await admin.query<{ rel: string; priv: string }>(
      `SELECT c.relnamespace::regnamespace || '.' || c.relname AS rel, p.priv
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN (VALUES ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
        WHERE c.relkind IN ('r','p','v','m','f')
          AND n.nspname = ANY($1)
          AND has_table_privilege('app_platform', c.oid, p.priv)
        ORDER BY 1, 2`,
      [ROOTLCO_SCHEMAS]
    );
    expect(
      effective.rows,
      'no table-level UPDATE, DELETE or TRUNCATE anywhere in the product schemas'
    ).toEqual([]);

    // The single column-scoped UPDATE, asked the same effective way.
    const columnUpdates = await admin.query<{ rel: string; col: string }>(
      `SELECT c.relnamespace::regnamespace || '.' || c.relname AS rel, att.attname AS col
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0
        WHERE n.nspname = ANY($1)
          AND has_column_privilege('app_platform', c.oid, att.attname, 'UPDATE')
        ORDER BY 1, 2`,
      [ROOTLCO_SCHEMAS]
    );
    expect(columnUpdates.rows).toEqual([{ rel: 'org.tenants', col: 'status' }]);
  });

  it('RECORDED ESCALATION: the pg_net PUBLIC grant is a path to superuser trigger execution', async () => {
    /*
     * A concrete consequence of B1-PGNET-BLOCKER, beyond "can make an outbound
     * request", demonstrated by execution during the final refuter and pinned
     * here so its ingredients are monitored.
     *
     * The chain: net._http_response is written by a superuser-owned background
     * worker, PUBLIC holds TRIGGER on it (pg_net), and PUBLIC holds TEMPORARY on
     * the database — so app_platform can create a function in pg_temp and attach
     * it as a BEFORE INSERT trigger on that table. When the worker inserts a
     * response, the trigger body runs in the worker's superuser context. That is
     * a path from inherited pg_net authority into arbitrary superuser execution,
     * and from there into every tenant's data and into iam.platform_grants.
     *
     * Both DDL steps were confirmed permitted for app_platform against this exact
     * candidate. This test does NOT re-create them — a trigger attached to a
     * vendor table cannot be dropped by a non-owner, so exercising it would
     * permanently dirty the database. It asserts the INGREDIENTS instead, so the
     * day the pg_net owner-remediation removes TRIGGER (or the database's
     * PUBLIC TEMPORARY grant is revoked) this test flips and records the closure.
     *
     * Why B1 does not fix it in a migration:
     *   - TRIGGER on net._http_response is a PUBLIC grant owned by supabase_admin
     *     — the same wall as the rest of B1-PGNET-BLOCKER. The migration role
     *     cannot revoke it, and there is no per-role revoke of a PUBLIC grant.
     *   - TEMPORARY on the database IS revocable by the owner (postgres), but
     *     only from PUBLIC, which strips it from 17 roles including anon,
     *     authenticated and service_role. That blast radius cannot be validated
     *     against the hosted PostgREST/auth/storage stack from here, and "no
     *     broad grants / do not break Supabase blindly" forbids shipping it
     *     unvalidated. It is recorded as a defense-in-depth option in the
     *     hardening runbook, not shipped.
     */
    const present = await admin.query<{ ok: boolean }>(
      `SELECT to_regnamespace('net') IS NOT NULL AS ok`
    );
    if (!present.rows[0]!.ok) {
      expect(present.rows[0]!.ok).toBe(false); // no net schema in CI; nothing to pin
      return;
    }

    // Ingredient 1: app_platform can host a function nowhere but pg_temp.
    const createSchemas = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_namespace nsp
        WHERE nsp.nspname NOT LIKE 'pg\\_%'
          AND has_schema_privilege('app_platform', nsp.oid, 'CREATE')`
    );
    expect(createSchemas.rows[0]!.n, 'app_platform must hold CREATE on no ordinary schema').toBe('0');

    // Ingredient 2: TEMPORARY on the database, held via PUBLIC.
    const temp = await admin.query<{ ok: boolean }>(
      `SELECT has_database_privilege('app_platform', current_database(), 'TEMPORARY') AS ok`
    );

    // Ingredient 3: TRIGGER on the superuser-written response table, via pg_net PUBLIC.
    const trig = await admin.query<{ ok: boolean }>(
      `SELECT has_table_privilege('app_platform', 'net._http_response', 'TRIGGER') AS ok`
    );

    // While BOTH hold, the chain is open. This is the monitored exposure: when
    // either is withdrawn the assertion below changes and the escalation closes.
    const chainOpen = temp.rows[0]!.ok && trig.rows[0]!.ok;
    expect(
      chainOpen,
      'B1-PGNET-BLOCKER: pg_net TRIGGER + database TEMPORARY leave the superuser-trigger chain OPEN'
    ).toBe(true);
  });

  it('RECORDED EXPOSURE: what app_platform inherits from pg_net, and cannot be given up', async () => {
    /*
     * B1-PGNET-BLOCKER, made executable so it is monitored rather than merely
     * written down.
     *
     * pg_net grants PUBLIC every table privilege on two RLS-disabled, unlogged
     * tables, USAGE/SELECT/UPDATE on their sequence, and EXECUTE on ten of its
     * twelve functions — net.http_delete among them, which Supabase's own
     * grant_pg_net_access hardening revokes for http_get and http_post and
     * forgets here. Any role can therefore queue a request that a superuser-owned
     * in-server client issues from the database container, and read the response
     * headers and body back.
     *
     * app_platform inherits it because PUBLIC does, exactly as app_runtime,
     * app_worker and app_readonly already did. B1 did not create or widen this;
     * it made it visible. And B1 cannot close it: every net object is owned by
     * supabase_admin, the migration role is not a member of it and holds no
     * grant option, so a REVOKE from a repository migration emits
     * "no privileges could be revoked" and COMMITS GREEN — a migration that
     * changes nothing while every gate reports success. PostgreSQL also permits
     * no per-role revoke of a PUBLIC grant.
     *
     * So this test does not assert containment. It pins the exposure, so the day
     * a platform image changes it — in either direction — this fails and says so.
     */
    const present = await admin.query<{ ok: boolean }>(
      `SELECT to_regnamespace('net') IS NOT NULL AS ok`
    );
    if (!present.rows[0]!.ok) {
      // CI runs a bare postgres image with no pg_net at all. Nothing to pin.
      expect(present.rows[0]!.ok).toBe(false);
      return;
    }

    // The two wrappers Supabase DID harden must stay hardened.
    const wrappers = await admin.query<{ name: string; secdef: boolean; pub: boolean }>(
      `SELECT p.proname AS name, p.prosecdef AS secdef,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS pub
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'net' AND p.proname IN ('http_get','http_post')
        ORDER BY 1`
    );
    expect(wrappers.rows.map((r) => r.name)).toEqual(['http_get', 'http_post']);
    for (const w of wrappers.rows) {
      expect(w.secdef, w.name + ' must stay SECURITY DEFINER').toBe(true);
      expect(w.pub, w.name + ' must not be granted to PUBLIC').toBe(false);
      const reachable = await admin.query<{ ok: boolean }>(
        `SELECT has_function_privilege('app_platform', p.oid, 'EXECUTE') AS ok
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'net' AND p.proname = $1`,
        [w.name]
      );
      expect(reachable.rows[0]!.ok, 'app_platform must not reach net.' + w.name).toBe(false);
    }

    // And the exposure that IS there, pinned exactly as measured.
    const exposure = await admin.query<{ rel: string; priv: string }>(
      `SELECT c.relname AS rel, a.privilege_type AS priv
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
              aclexplode(c.relacl) a
        WHERE n.nspname = 'net' AND a.grantee = 0
        ORDER BY 1, 2`
    );
    const byRelation = new Map<string, string[]>();
    for (const row of exposure.rows) {
      byRelation.set(row.rel, [...(byRelation.get(row.rel) ?? []), row.priv]);
    }
    expect([...byRelation.keys()].sort()).toEqual([
      '_http_response',
      'http_request_queue',
      'http_request_queue_id_seq',
    ]);
    expect(byRelation.get('http_request_queue')).toEqual([
      'DELETE',
      'INSERT',
      'MAINTAIN',
      'REFERENCES',
      'SELECT',
      'TRIGGER',
      'TRUNCATE',
      'UPDATE',
    ]);
  });

  it('introduces no SECURITY DEFINER function in any RootLco schema', async () => {
    // Scoped to the product's own schemas, deliberately. The unscoped query the
    // CI replay gate runs (migration-replay-checks.mjs:218) returns 0 against a
    // plain-postgres container and 6 against a developer Supabase stack — net,
    // pgbouncer, supabase_functions and vault — so an unscoped assertion here
    // would fail locally for a reason that has nothing to do with this slice.
    const r = await admin.query<{ nspname: string; proname: string }>(
      `SELECT n.nspname, p.proname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname = ANY($1)
        ORDER BY 1,2`,
      [ROOTLCO_SCHEMAS]
    );
    expect(r.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('H3 — writing audit needs WRITE-level platform authority', () => {
  /*
   * The audit write gate used to be iam.holds_any_platform_authority(), true for
   * ANY active platform grant. For a platform session app.tenant_id is a
   * SELECTOR rather than a narrowing — the session sets it — so the tenant term
   * contributes no containment on this surface and the authority conjunct was
   * the entire gate. A read-only operator could therefore append a chain-valid,
   * self-authored record to any tenant it named, permanently, since no role
   * holds UPDATE or DELETE on any audit table.
   */
  it('a read-only platform principal is refused the audit append', async () => {
    const tenantId = await provisionCommitted('b1_h3_read', 'b1-h3-read-key');
    await withRolledBackTx(platform, { userId: READER, tenantId }, async (db) => {
      await refused(
        db,
        'audit append by a read-only operator',
        `SELECT iam.audit_append($1,$2,'user','platform.read.attempt','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb)`,
        [tenantId, READER],
        '42501'
      );
    });
  });

  it('a read-only principal is refused the audit CHILD tables directly', async () => {
    /*
     * The write gate is on all three audit tables, and iam.audit_append is not
     * the only way to reach them — app_platform holds INSERT on each. So the
     * refusal has to be proved against the tables themselves, not only against
     * the writer that normally uses them. §11: a read-only platform authority
     * must not append an audit record, a detail, or a chain link.
     */
    const tenantId = await provisionCommitted('b1_h3_children', 'b1-h3-children-key');

    // A real parent, authored by the OPERATOR, so the only thing standing
    // between READER and these rows is its own authority level.
    const parent = await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.h3.parent','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
        [tenantId, OPERATOR]
      );
      return r.rows[0]!.id;
    });

    await withRolledBackTx(platform, { userId: READER, tenantId }, async (db) => {
      await refused(
        db,
        'read-only direct audit_records INSERT',
        `INSERT INTO iam.audit_records
           (tenant_id, seq, actor_id, actor_kind, action, entity_type, entity_id)
         VALUES ($1, 1, $2, 'user', 'platform.h3.forged', 'tenant', $1)`,
        [tenantId, READER],
        '42501'
      );
      await refused(
        db,
        'read-only direct audit_record_details INSERT',
        `INSERT INTO iam.audit_record_details
           (tenant_id, audit_record_id, field_name, old_value_masked, new_value_masked,
            value_classification)
         VALUES ($1,$2,'status','a','b','none')`,
        [tenantId, parent],
        '42501'
      );
      await refused(
        db,
        'read-only direct audit_integrity_links INSERT',
        `INSERT INTO iam.audit_integrity_links
           (tenant_id, audit_record_id, seq, prev_hash, record_hash)
         VALUES ($1,$2,1, decode(repeat('00',32),'hex'), decode(repeat('00',32),'hex'))`,
        [tenantId, parent],
        '42501'
      );
    });
  });

  it('but the same principal keeps the read its authority is for', async () => {
    // The positive control. Without it the refusal above could be a broken
    // fixture rather than a bounded authority.
    const tenantId = await provisionCommitted('b1_h3_readok', 'b1-h3-readok-key');
    const seen = await withRolledBackTx(platform, { userId: READER, tenantId }, async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM org.tenants WHERE id = $1`,
        [tenantId]
      );
      return r.rows[0]!.n;
    });
    expect(seen).toBe('1');
  });

  it('a provision principal and a lifecycle principal may both append', async () => {
    // Both write authorities are accepted, so the gate is a disjunction of the
    // two write codes and not an accident that happens to admit one of them.
    const tenantId = await provisionCommitted('b1_h3_write', 'b1-h3-write-key');
    for (const code of [PROVISION, LIFECYCLE]) {
      await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = $1`, [
        REVOKED_OPERATOR,
      ]);
      await admin.query(
        `INSERT INTO iam.platform_grants (user_account_id, permission_code, granted_by, created_by)
         VALUES ($1,$2,$3,$3)`,
        [REVOKED_OPERATOR, code, SYSTEM]
      );
      const id = await withRolledBackTx(
        platform,
        { userId: REVOKED_OPERATOR, tenantId },
        async (db) => {
          const r = await db.query<{ id: string }>(
            `SELECT iam.audit_append($1,$2,'user','platform.write.attempt','tenant',$1,
                                     NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
            [tenantId, REVOKED_OPERATOR]
          );
          return r.rows[0]!.id;
        }
      );
      expect(id, code + ' must be able to append').toBeTruthy();
    }
    // Put the fixture back the way the rest of the file expects it.
    await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = $1`, [
      REVOKED_OPERATOR,
    ]);
    await admin.query(
      `INSERT INTO iam.platform_grants
         (user_account_id, permission_code, status, revoked_at, revoked_by, revoke_reason, granted_by, created_by)
       VALUES ($1,$2,'revoked', now(), $3, 'b1 fixture', $3, $3)`,
      [REVOKED_OPERATOR, PROVISION, SYSTEM]
    );
  });
});

// ---------------------------------------------------------------------------
describe('H4 — an audit detail must belong to a record this session authored', () => {
  /*
   * The child policies were bound only by tenant and authority, and a
   * foreign-key check bypasses row-level security — so field-change rows could
   * be attached to a COMMITTED record authored by a tenant employee and would
   * then render under that employee's name. The parent EXISTS term is the actor
   * binding reaching the table the actor column is not on.
   */
  async function employeeRecord(tenantId: string, actor: string): Promise<string> {
    // Written on the admin connection so it is somebody else's record, already
    // committed and already chained — exactly the shape the policy must refuse.
    const r = await admin.query<{ id: string }>(
      `SELECT iam.audit_append($1,$2,'user','tenant.employee.event','tenant',$1,
                               NULL,NULL,NULL,'fixture','[]'::jsonb) AS id`,
      [tenantId, actor]
    );
    return r.rows[0]!.id;
  }

  it('accepts a detail on the operator own, unchained record', async () => {
    const tenantId = await provisionCommitted('b1_h4_own', 'b1-h4-own-key');
    const written = await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.h4.own','tenant',$1,
                                 NULL,NULL,NULL,'b1',$3::jsonb) AS id`,
        [tenantId, OPERATOR, JSON.stringify([{ field: 'status', new: 'provisioning' }])]
      );
      return r.rows[0]!.id;
    });
    const details = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_record_details WHERE audit_record_id = $1`,
      [written]
    );
    expect(details.rows[0]!.n).toBe('1');
  });

  it('refuses a detail attached to a tenant employee record', async () => {
    const tenantId = await provisionCommitted('b1_h4_other', 'b1-h4-other-key');
    const employee = await admin.query<{ id: string }>(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,'local','b1-h4-emp','h4emp@example.invalid','H4 Employee','active',$2)
       RETURNING id`,
      [tenantId, SYSTEM]
    );
    const theirs = await employeeRecord(tenantId, employee.rows[0]!.id);

    await withRolledBackTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      await refused(
        db,
        'detail on an employee record',
        `INSERT INTO iam.audit_record_details
           (tenant_id, audit_record_id, field_name, old_value_masked, new_value_masked,
            value_classification)
         VALUES ($1,$2,'status','active','closed','none')`,
        [tenantId, theirs],
        '42501'
      );
    });

    const untouched = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_record_details WHERE audit_record_id = $1`,
      [theirs]
    );
    expect(untouched.rows[0]!.n).toBe('0');
  });

  it('refuses a detail attached to an already-chained record of its own', async () => {
    // Ordering matters as much as ownership: once the record is chained its
    // canonical hash is fixed, so a later detail would make the chain disagree
    // with the row it covers.
    const tenantId = await provisionCommitted('b1_h4_chained', 'b1-h4-chained-key');
    const mine = await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.h4.chained','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
        [tenantId, OPERATOR]
      );
      return r.rows[0]!.id;
    });
    const chained = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_integrity_links WHERE audit_record_id = $1`,
      [mine]
    );
    expect(chained.rows[0]!.n).toBe('1');

    await withRolledBackTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      await refused(
        db,
        'detail on an already-chained record',
        `INSERT INTO iam.audit_record_details
           (tenant_id, audit_record_id, field_name, old_value_masked, new_value_masked,
            value_classification)
         VALUES ($1,$2,'status','a','b','none')`,
        [tenantId, mine],
        '42501'
      );
    });
  });

  it('refuses a detail whose parent lives in another tenant', async () => {
    const home = await provisionCommitted('b1_h4_home', 'b1-h4-home-key');
    const away = await provisionCommitted('b1_h4_away', 'b1-h4-away-key');
    const parentAway = await withCommittedTx(platform, { userId: OPERATOR, tenantId: away }, async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.h4.away','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
        [away, OPERATOR]
      );
      return r.rows[0]!.id;
    });

    await withRolledBackTx(platform, { userId: OPERATOR, tenantId: home }, async (db) => {
      await refused(
        db,
        'cross-tenant detail parent',
        `INSERT INTO iam.audit_record_details
           (tenant_id, audit_record_id, field_name, old_value_masked, new_value_masked,
            value_classification)
         VALUES ($1,$2,'status','a','b','none')`,
        [home, parentAway],
        '42501'
      );
    });
  });
});

// ---------------------------------------------------------------------------
describe('H5 — the audit chain sequence is not caller-controlled', () => {
  /*
   * seq is bigint with no default, no identity and no trigger, and its only
   * CHECK is that it is positive. iam.audit_append computes the next link as
   * COALESCE(max(seq),0)+1, so ONE planted row carrying max(bigint) makes every
   * future append for that tenant fail 22003 — permanently, for app_runtime as
   * well, with no DELETE privilege anywhere to undo it. The policy now requires
   * seq to equal the value the canonical writer would itself compute, which
   * makes the planted row unrepresentable rather than merely discouraged.
   */
  async function plant(tenantId: string, seq: string): Promise<string> {
    const parent = await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.h5.parent','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
        [tenantId, OPERATOR]
      );
      return r.rows[0]!.id;
    });
    let code = '(none)';
    await withRolledBackTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      await db.query('SAVEPOINT s');
      try {
        await db.query(
          `INSERT INTO iam.audit_integrity_links
             (tenant_id, audit_record_id, seq, prev_hash, record_hash)
           VALUES ($1,$2,$3::bigint, decode(repeat('00',32),'hex'), decode(repeat('00',32),'hex'))`,
          [tenantId, parent, seq]
        );
      } catch (err) {
        code = (err as { code?: string }).code ?? '(none)';
      }
      await db.query('ROLLBACK TO SAVEPOINT s');
    });
    return code;
  }

  it('refuses every sequence except the one the writer would compute', async () => {
    const tenantId = await provisionCommitted('b1_h5_seq', 'b1-h5-seq-key');
    // The parent append already consumed the next value, so the current max is
    // known and every candidate below is a real, specific wrong answer.
    for (const [label, seq] of [
      ['max(bigint)', '9223372036854775807'],
      ['a huge but legal bigint', '4611686018427387904'],
      ['next + 1', '99'],
      ['a value already used', '1'],
    ] as const) {
      expect(await plant(tenantId, seq), label + ' must be refused').toBe('42501');
    }
  });

  it('leaves the tenant able to append afterwards', async () => {
    /*
     * The DOS test, and it was vacuous until this rewrite.
     *
     * It used to call plant(), which performs the INSERT inside
     * withRolledBackTx AND additionally issues an explicit ROLLBACK TO SAVEPOINT.
     * A planted row could not have survived either way, so the subsequent append
     * would have succeeded even with the seq pin removed entirely — the test
     * proved the rollback worked, not the policy.
     *
     * The attempt must COMMIT for the question to mean anything. If the policy
     * refuses, nothing commits and the append below succeeds because the chain is
     * intact. If the policy ever stops refusing, the poison row commits, and
     * iam.audit_append's COALESCE(max(seq),0)+1 overflows with 22003 — which is
     * the failure this test exists to catch.
     */
    const tenantId = await provisionCommitted('b1_h5_after', 'b1-h5-after-key');

    const parent = await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.h5.dos.parent','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
        [tenantId, OPERATOR]
      );
      return r.rows[0]!.id;
    });

    let committed = '(none)';
    try {
      await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
        await db.query(
          `INSERT INTO iam.audit_integrity_links
             (tenant_id, audit_record_id, seq, prev_hash, record_hash)
           VALUES ($1,$2,9223372036854775807,
                   decode(repeat('00',32),'hex'), decode(repeat('00',32),'hex'))`,
          [tenantId, parent]
        );
      });
    } catch (err) {
      committed = (err as { code?: string }).code ?? '(none)';
    }
    expect(committed, 'the poison row must be refused, not merely rolled back').toBe('42501');

    // Nothing survived, checked directly rather than inferred from the refusal.
    const planted = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_integrity_links
        WHERE tenant_id = $1 AND seq > 1000`,
      [tenantId]
    );
    expect(planted.rows[0]!.n).toBe('0');
    const id = await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.h5.after','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
        [tenantId, OPERATOR]
      );
      return r.rows[0]!.id;
    });
    expect(id).toBeTruthy();
    const maxSeq = await admin.query<{ m: string }>(
      `SELECT max(seq)::text AS m FROM iam.audit_integrity_links WHERE tenant_id = $1`,
      [tenantId]
    );
    expect(Number(maxSeq.rows[0]!.m)).toBeLessThan(100);
  });

  it('refuses a link whose parent is in another tenant', async () => {
    const home = await provisionCommitted('b1_h5_home', 'b1-h5-home-key');
    const away = await provisionCommitted('b1_h5_away', 'b1-h5-away-key');
    const parentAway = await withCommittedTx(platform, { userId: OPERATOR, tenantId: away }, async (db) => {
      const r = await db.query<{ id: string }>(
        `SELECT iam.audit_append($1,$2,'user','platform.h5.away','tenant',$1,
                                 NULL,NULL,NULL,'b1','[]'::jsonb) AS id`,
        [away, OPERATOR]
      );
      return r.rows[0]!.id;
    });
    await withRolledBackTx(platform, { userId: OPERATOR, tenantId: home }, async (db) => {
      await refused(
        db,
        'cross-tenant chain link',
        `INSERT INTO iam.audit_integrity_links
           (tenant_id, audit_record_id, seq, prev_hash, record_hash)
         VALUES ($1,$2,1, decode(repeat('00',32),'hex'), decode(repeat('00',32),'hex'))`,
        [home, parentAway],
        '42501'
      );
    });
  });
});
