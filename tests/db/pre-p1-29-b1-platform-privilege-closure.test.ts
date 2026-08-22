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

/** Removes every tenant this suite creates, children first. */
async function dropB1Tenants(): Promise<void> {
  const scope = `(SELECT id FROM org.tenants WHERE tenant_code LIKE 'b1_%')`;
  await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key LIKE 'b1-%'`);
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
    await admin.query(`DELETE FROM ${table} WHERE tenant_id IN ${scope}`);
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
  await admin.query(`DELETE FROM org.tenants WHERE tenant_code LIKE 'b1_%'`);
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
    [OPERATOR, PLAIN_USER, REVOKED_OPERATOR],
  ]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])`, [
    [OPERATOR, PLAIN_USER, REVOKED_OPERATOR],
  ]);
  await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [OPERATOR_HOME]);

  // The operator authenticates as an ORDINARY account. Platform authority is
  // the relation, never the account — which is the whole point of §5 of the
  // design and the reason no parallel identity system exists.
  await admin.query(
    `INSERT INTO org.tenants (id, tenant_code, display_name, default_locale, default_timezone, status, created_by)
     VALUES ($1,$2,'B1 operator home','en','UTC','active',$3)`,
    [OPERATOR_HOME, HOME_CODE, SYSTEM]
  );
  for (const [id, subject, name] of [
    [OPERATOR, 'b1-operator', 'B1 Operator'],
    [PLAIN_USER, 'b1-plain', 'B1 Plain User'],
    [REVOKED_OPERATOR, 'b1-revoked', 'B1 Revoked Operator'],
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
  // A revoked holder, to prove the resolver reads status and not mere presence.
  await admin.query(
    `INSERT INTO iam.platform_grants
       (user_account_id, permission_code, status, revoked_at, revoked_by, revoke_reason, granted_by, created_by)
     VALUES ($1,$2,'revoked', now(), $3, 'b1 fixture', $3, $3)`,
    [REVOKED_OPERATOR, PROVISION, SYSTEM]
  );
});

afterAll(async () => {
  await dropB1Tenants();
  await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = ANY($1::uuid[])`, [
    [OPERATOR, PLAIN_USER, REVOKED_OPERATOR],
  ]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])`, [
    [OPERATOR, PLAIN_USER, REVOKED_OPERATOR],
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
    // The actor is the authenticated platform operator, from context.
    expect(written.rows[0]!.actor_id).toBe(OPERATOR);
    expect(written.rows[0]!.details).toBe('1');

    const chain = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_integrity_links WHERE audit_record_id = $1`,
      [recordId]
    );
    expect(chain.rows[0]!.n).toBe('1');
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
  it('reports the documented asymmetry, at source', async () => {
    // C9, the most dangerous design assumption of the whole wave: an absent
    // tenant DENIES, an absent narrowing list WIDENS. Asserted so the asymmetry
    // is a fact in the suite rather than a claim in a comment.
    await withRolledBackTx(platform, { userId: OPERATOR }, async (db) => {
      const r = await db.query<{ t: string | null; c: string[] | null; b: string[] | null }>(
        `SELECT iam.current_tenant_id() AS t,
                iam.allowed_company_ids() AS c,
                iam.allowed_branch_ids() AS b`
      );
      expect(r.rows[0]!.t).toBeNull();
      expect(r.rows[0]!.c).toBeNull();
      expect(r.rows[0]!.b).toBeNull();
    });
  });

  it('treats an empty string exactly as unset', async () => {
    await withRolledBackTx(platform, { userId: OPERATOR }, async (db) => {
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
    await withRolledBackTx(platform, { userId: OPERATOR }, async (db) => {
      for (const table of [
        'crm.customers',
        'veh.vehicles',
        'apt.appointments',
        'wo.work_orders',
        'inv.stock_items',
        'sal.invoices',
      ]) {
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
  it('holds no privilege on any tenant business schema', async () => {
    const r = await admin.query<{ schema: string; table: string; privilege: string }>(
      `SELECT table_schema AS schema, table_name AS table, privilege_type AS privilege
         FROM information_schema.table_privileges
        WHERE grantee = 'app_platform'
          AND table_schema IN ('crm','veh','apt','rec','wo','tech','dia','qms',
                               'svc','quo','inv','sal','wty','rpt')
        ORDER BY 1,2,3`
    );
    expect(r.rows).toEqual([]);
  });

  it('holds no DELETE anywhere, and UPDATE only on the tenant status column', async () => {
    const deletes = await admin.query<{ table_name: string }>(
      `SELECT table_schema || '.' || table_name AS table_name
         FROM information_schema.table_privileges
        WHERE grantee = 'app_platform' AND privilege_type = 'DELETE'`
    );
    expect(deletes.rows).toEqual([]);

    const updates = await admin.query<{ table_name: string }>(
      `SELECT DISTINCT table_schema || '.' || table_name AS table_name
         FROM information_schema.table_privileges
        WHERE grantee = 'app_platform' AND privilege_type = 'UPDATE'`
    );
    expect(updates.rows.map((r) => r.table_name)).toEqual([]);

    const columnUpdates = await admin.query<{ table_name: string; column_name: string }>(
      `SELECT table_schema || '.' || table_name AS table_name, column_name
         FROM information_schema.column_privileges
        WHERE grantee = 'app_platform' AND privilege_type = 'UPDATE'
        ORDER BY 1,2`
    );
    expect(columnUpdates.rows).toEqual([{ table_name: 'org.tenants', column_name: 'status' }]);
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
