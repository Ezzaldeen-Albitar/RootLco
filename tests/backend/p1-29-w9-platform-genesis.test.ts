/**
 * P1-29 W9 — the platform operator genesis, proved on real PostgreSQL
 * (Owner decision 1 of 2026-09-02).
 *
 * `scripts/platform/genesis-platform-operator.mjs` is the one sanctioned way a
 * first platform operator comes to exist. It is driven here as a module on the
 * admin connection — the same privileged connection an operator would use —
 * and its properties are asserted rather than described:
 *
 *   G1  no platform operator exists → the controlled genesis succeeds
 *   G2  one already exists → a second genesis is refused; the same address is a no-op
 *   G3  an application role cannot perform the genesis writes
 *   G4  the result is auditable: an audit record and secret-free evidence
 *   G5  no long-lived bypass is left behind: the privilege graph is unchanged
 *   G6  a partially established operator (grants gone, account and tenant kept) is completed, not re-created
 *   G7  the SHARED database is untouched: an unrelated operator's grant survives
 *       the whole lifecycle, including this suite's own cleanup
 *
 * ## Where it runs, and why that changed
 *
 * G1's precondition is "a platform with no operator". This suite once obtained
 * it with `DELETE FROM iam.platform_grants`, unqualified, on the SHARED local
 * database — which is not a fixture cleanup but a revocation of the real
 * platform operator's authority. Measured 2026-09-06 on the Owner acceptance
 * stack after one full `test:backend` run: every control-plane route
 * answered 403 ERR-IAM-001 until the genesis CLI was re-run by hand.
 *
 * So the suite now builds its OWN database — every migration replayed from
 * empty, then the declared seeds, exactly as CI builds its container — runs
 * the genesis there, and drops it afterwards. The shared database is opened
 * only to create and drop that database, and to hold the G7 sentinel. Nothing
 * here deletes a row it did not write.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool, ensureBackendFixtures, ensureTestLogins, TENANT_A } from './helpers';
import { PLATFORM_LOGIN, RUNTIME_LOGIN } from '../db/helpers';
import {
  ISOLATED_PREFIX,
  adminPoolFor,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  dropStaleIsolatedDatabases,
  loginPoolFor,
} from './isolated-database';
import { readGenesisInput, runGenesis } from '../../scripts/platform/genesis-platform-operator.mjs';

const RUN = Math.random().toString(36).slice(2, 8);
const EMAIL = `operator_${RUN}@fixture.test`;
const HOME = `w9genesis_${RUN}`;
/** This run's own database. Created in beforeAll, dropped in afterAll and on setup failure. */
const ISOLATED = `${ISOLATED_PREFIX}genesis_${RUN}`;
/** Deliberately weak, deliberately fake, local test databases only (see tests/db/helpers.ts). */
const TEST_LOGIN_PASSWORD = 'rootlco-local-test-only';

/**
 * The G7 sentinel: an operator on the SHARED database that this suite did not
 * establish and must not disturb. A test-owned account in TENANT_A with one
 * platform grant, written before the isolated database exists and read back
 * after it is gone. Deterministic id, so a crashed run's leftover is removed by
 * the next run's setup rather than accumulating.
 */
const SENTINEL_ACCOUNT = 'd9900000-0000-4000-8000-0000000000ee';
const SENTINEL_SUBJECT = 'fx_w9_genesis_sentinel';
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';

/** The SHARED database: create/drop of the isolated one, and the sentinel. Nothing else. */
let cluster: Pool;
/** The isolated database, as the admin login. Every genesis assertion reads here. */
let admin: Pool;
let runtime: Pool;
let platform: Pool;
let sentinelBefore: string;

function input(overrides: Record<string, string> = {}) {
  return readGenesisInput(
    {
      ROOTLCO_ENV: 'local-acceptance',
      GENESIS_OPERATOR_EMAIL: EMAIL,
      GENESIS_OPERATOR_DISPLAY_NAME: 'Platform Operator',
      GENESIS_IDENTITY_PROVIDER: 'test_harness',
      GENESIS_PROVIDER_SUBJECT: `sub_${RUN}`,
      GENESIS_HOME_TENANT_CODE: HOME,
      ...overrides,
      // The repository's ProcessEnv augmentation requires NODE_ENV; the CLI
      // never reads it. Stated rather than cast around.
      NODE_ENV: 'test',
    },
    ['--confirm', overrides.GENESIS_OPERATOR_EMAIL ?? EMAIL]
  );
}

async function privilegeGraph(): Promise<string> {
  const { rows } = await admin.query<{ line: string }>(
    `SELECT string_agg(line, E'\\n' ORDER BY line) AS line FROM (
       SELECT 'policy:' || schemaname || '.' || tablename || '.' || policyname || ':' || array_to_string(roles, ',') AS line FROM pg_policies
       UNION ALL
       SELECT 'grant:' || table_schema || '.' || table_name || ':' || grantee || ':' || privilege_type
         FROM information_schema.role_table_grants WHERE grantee LIKE 'app_%'
       UNION ALL
       SELECT 'colgrant:' || table_schema || '.' || table_name || '.' || column_name || ':' || grantee || ':' || privilege_type
         FROM information_schema.column_privileges WHERE grantee LIKE 'app_%'
       UNION ALL
       SELECT 'member:' || r.rolname || '<-' || m.rolname
         FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member
        WHERE r.rolname LIKE 'app_%'
     ) g`
  );
  return rows[0]?.line ?? '';
}

async function sharedGrantFingerprint(): Promise<string> {
  const { rows } = await cluster.query<{ line: string }>(
    `SELECT coalesce(string_agg(account_id || ':' || permission_code || ':' || coalesce(revoked_at::text, 'live'), ',' ORDER BY account_id, permission_code), '') AS line
       FROM iam.platform_grants`
  );
  return rows[0]?.line ?? '';
}

async function removeSentinel(): Promise<void> {
  await cluster.query('DELETE FROM iam.platform_grants WHERE account_id = $1', [SENTINEL_ACCOUNT]);
  await cluster.query('DELETE FROM iam.user_status_history WHERE user_id = $1', [SENTINEL_ACCOUNT]);
  await cluster.query('DELETE FROM iam.user_accounts WHERE id = $1', [SENTINEL_ACCOUNT]);
}

beforeAll(async () => {
  cluster = adminPool();
  // Cluster-level: login roles are shared by every database on the server.
  await ensureTestLogins(cluster);
  // TENANT_A, the fixture tenant the sentinel account lives in. Idempotent, test-owned,
  // and the same call every sibling suite makes on the shared database.
  await ensureBackendFixtures(cluster);
  // A previous run that crashed could not reach its own afterAll.
  await dropStaleIsolatedDatabases(cluster);

  // The G7 sentinel on the SHARED database, before anything else happens.
  await removeSentinel();
  await cluster.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, 'test_harness', $3, $4, 'Genesis sentinel', 'active', $5)`,
    [SENTINEL_ACCOUNT, TENANT_A, SENTINEL_SUBJECT, `${SENTINEL_SUBJECT}@fixture.test`, SYSTEM_ACTOR]
  );
  await cluster.query(
    `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
     VALUES ($1, 'platform.organization.read', $2, $2)`,
    [SENTINEL_ACCOUNT, SYSTEM_ACTOR]
  );
  sentinelBefore = await sharedGrantFingerprint();

  // The isolated database. If building it fails, drop what was made and fail
  // the suite here — never fall back to the shared database.
  try {
    await createIsolatedDatabase(cluster, ISOLATED);
  } catch (error) {
    await dropIsolatedDatabase(cluster, ISOLATED);
    throw error;
  }
  admin = adminPoolFor(ISOLATED, 3);
  runtime = loginPoolFor(RUNTIME_LOGIN, TEST_LOGIN_PASSWORD, ISOLATED, 2);
  platform = loginPoolFor(PLATFORM_LOGIN, TEST_LOGIN_PASSWORD, ISOLATED, 2);
  // G1's precondition — a platform with no operator — is now a PROPERTY of a
  // database replayed from empty, not the result of deleting anybody's grants.
}, 300_000);

/**
 * Ends the isolated pools and drops the isolated database — once. G7 calls it
 * to prove the cleanup path against the sentinel; afterAll calls it again for
 * the ordinary path and for any run that never reached G7. A pool ended twice
 * throws, so the second call must be a no-op rather than a repeat.
 */
let tornDown = false;
async function teardownIsolated(): Promise<void> {
  if (tornDown) return;
  tornDown = true;
  // Order matters: the pools must close before the database can be dropped.
  await runtime?.end();
  await platform?.end();
  await admin?.end();
  await dropIsolatedDatabase(cluster, ISOLATED);
}

afterAll(async () => {
  try {
    await teardownIsolated();
  } finally {
    // The sentinel is test-owned and always removed, whatever happened above.
    await removeSentinel();
    await cluster.end();
  }
}, 120_000);

describe('W9 — platform operator genesis', () => {
  let graphBefore: string;
  let established: Awaited<ReturnType<typeof runGenesis>>;

  it('refuses outside the two named environments, without the confirmation, and with a malformed input', () => {
    expect(() => input({ ROOTLCO_ENV: 'production' })).toThrow(/ROOTLCO_ENV/);
    expect(() =>
      readGenesisInput(
        { NODE_ENV: 'test', ROOTLCO_ENV: 'local-acceptance', GENESIS_OPERATOR_EMAIL: EMAIL },
        ['--confirm', 'someone@else.test']
      )
    ).toThrow(/--confirm/);
    expect(() => input({ GENESIS_OPERATOR_EMAIL: 'not-an-address' })).toThrow(/address/);
    expect(() =>
      input({
        GENESIS_PLATFORM_LOGIN_ROLE: 'rootlco_platform',
        GENESIS_PLATFORM_LOGIN_PASSWORD: 'short',
      })
    ).toThrow(/16/);
  });

  it('G1 with no platform operator, the controlled genesis establishes one — in one transaction', async () => {
    graphBefore = await privilegeGraph();
    expect(
      await admin.query('SELECT 1 FROM iam.platform_grants WHERE revoked_at IS NULL')
    ).toMatchObject({ rowCount: 0 });

    const client = await admin.connect();
    try {
      established = await runGenesis(client, input(), { subject: `sub_${RUN}`, created: false });
    } finally {
      client.release();
    }
    expect(established.outcome).toBe('established');
    const grants = await admin.query<{ permission_code: string; granted_by: string }>(
      'SELECT permission_code, granted_by FROM iam.platform_grants WHERE account_id = $1 AND revoked_at IS NULL ORDER BY 1',
      [established.operatorAccountId]
    );
    expect(grants.rows.map((g) => g.permission_code)).toEqual([
      'platform.organization.lifecycle',
      'platform.organization.provision',
      'platform.organization.read',
    ]);
    expect(grants.rows.every((g) => g.granted_by !== established.operatorAccountId)).toBe(true);
    const account = await admin.query<{ status: string; tenant_id: string; email: string }>(
      'SELECT status, tenant_id, email FROM iam.user_accounts WHERE id = $1',
      [established.operatorAccountId]
    );
    expect(account.rows[0]).toMatchObject({
      status: 'active',
      tenant_id: established.homeTenantId,
      email: EMAIL,
    });
    const home = await admin.query<{ status: string; tenant_code: string }>(
      'SELECT status, tenant_code FROM org.tenants WHERE id = $1',
      [established.homeTenantId]
    );
    expect(home.rows[0]).toEqual({ status: 'active', tenant_code: HOME });
    // The operator can act as a platform holder on the control-plane pool.
    const asOperator = await platform.connect();
    try {
      await asOperator.query('BEGIN');
      await asOperator.query("SELECT set_config('app.user_id', $1, true)", [
        established.operatorAccountId,
      ]);
      const held = await asOperator.query<{ held: boolean }>(
        "SELECT iam.has_platform_authority('platform.organization.provision') AS held"
      );
      expect(held.rows[0]?.held).toBe(true);
    } finally {
      await asOperator.query('ROLLBACK');
      asOperator.release();
    }
  });

  it('G2 a second genesis for another address is refused; the same address is a no-op', async () => {
    const client = await admin.connect();
    try {
      await expect(
        runGenesis(
          client,
          input({
            GENESIS_OPERATOR_EMAIL: `second_${RUN}@fixture.test`,
            GENESIS_HOME_TENANT_CODE: `${HOME}b`,
          }),
          {
            subject: `sub2_${RUN}`,
            created: false,
          }
        )
      ).rejects.toMatchObject({ exitCode: 4 });
      const again = await runGenesis(client, input(), { subject: `sub_${RUN}`, created: false });
      expect(again).toMatchObject({
        outcome: 'already-established',
        operatorAccountId: established.operatorAccountId,
        homeTenantId: established.homeTenantId,
      });
    } finally {
      client.release();
    }
    expect(
      await admin.query('SELECT 1 FROM org.tenants WHERE tenant_code = $1', [`${HOME}b`])
    ).toMatchObject({ rowCount: 0 });
    expect(
      await admin.query('SELECT 1 FROM iam.platform_grants WHERE revoked_at IS NULL')
    ).toMatchObject({ rowCount: 3 });
  });

  it('G6 a partially established operator is completed, not re-created, and never for another address', async () => {
    // What an environment reset leaves: the home tenant and the account
    // survive, the grants and the provisioning function's replay memory do
    // not. Measured on the local acceptance stack (P1-29 W9), where this very
    // suite's cleanup produced that state for the real operator.
    await admin.query('DELETE FROM iam.platform_grants WHERE account_id = $1', [
      established.operatorAccountId,
    ]);
    await admin.query(
      "DELETE FROM shared.idempotency_keys WHERE operation = 'org_provisioning' AND idempotency_key = $1",
      [`platform-genesis:${EMAIL}`]
    );
    const auditBefore = await admin.query(
      "SELECT count(*)::int AS n FROM iam.audit_records WHERE action = 'platform.operator.genesis' AND entity_id = $1",
      [established.operatorAccountId]
    );
    const client = await admin.connect();
    try {
      const completed = await runGenesis(client, input(), {
        subject: `sub_${RUN}`,
        created: false,
      });
      expect(completed).toMatchObject({
        outcome: 'completed',
        operatorAccountId: established.operatorAccountId,
        homeTenantId: established.homeTenantId,
      });
      expect([...(completed.completedGrants ?? [])].sort()).toEqual([...completed.grants].sort());
      // Idempotent again, and the same tenant — no second home tenant.
      const again = await runGenesis(client, input(), { subject: `sub_${RUN}`, created: false });
      expect(again).toMatchObject({
        outcome: 'already-established',
        operatorAccountId: established.operatorAccountId,
        homeTenantId: established.homeTenantId,
      });
      // Still one-time for anyone else.
      await expect(
        runGenesis(
          client,
          input({
            GENESIS_OPERATOR_EMAIL: `third_${RUN}@fixture.test`,
            GENESIS_HOME_TENANT_CODE: `${HOME}c`,
          }),
          { subject: `sub3_${RUN}`, created: false }
        )
      ).rejects.toMatchObject({ exitCode: 4 });
    } finally {
      client.release();
    }
    expect(
      await admin.query(
        'SELECT 1 FROM iam.platform_grants WHERE revoked_at IS NULL AND account_id = $1',
        [established.operatorAccountId]
      )
    ).toMatchObject({ rowCount: 3 });
    expect(
      await admin.query('SELECT count(*)::int AS n FROM org.tenants WHERE tenant_code LIKE $1', [
        `${HOME}%`,
      ])
    ).toMatchObject({ rows: [{ n: 1 }] });
    const auditAfter = await admin.query(
      "SELECT count(*)::int AS n FROM iam.audit_records WHERE action = 'platform.operator.genesis' AND entity_id = $1",
      [established.operatorAccountId]
    );
    expect(auditAfter.rows[0].n).toBe(auditBefore.rows[0].n + 1);
  });

  it('G3 neither the runtime nor the platform application role can perform the genesis writes', async () => {
    for (const pool of [runtime, platform]) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.user_id', $1, true)", [
          established.operatorAccountId,
        ]);
        await expect(
          client.query(
            `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
             VALUES ($1, 'platform.organization.read', $2, $2)`,
            [established.operatorAccountId, '00000000-0000-4000-8000-000000000001']
          )
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
  });

  it('G4 the genesis is auditable, and the evidence carries no secret', async () => {
    const audit = await admin.query<{ actor_kind: string; entity_id: string; fields: string[] }>(
      `SELECT r.actor_kind, r.entity_id, array_agg(d.field_name ORDER BY d.field_name) AS fields
         FROM iam.audit_records r
         JOIN iam.audit_record_details d ON d.audit_record_id = r.id
        WHERE r.id = $1 AND r.action = 'platform.operator.genesis'
        GROUP BY r.actor_kind, r.entity_id`,
      [established.auditRecordId]
    );
    expect(audit.rows[0]).toEqual({
      actor_kind: 'system',
      entity_id: established.operatorAccountId,
      fields: ['email', 'environment', 'home_tenant_id', 'identity_provider', 'platform_grants'],
    });
    const serialized = JSON.stringify({ input: input(), result: established });
    for (const secret of ['password', 'postgres', 'service_role', 'token']) {
      // The DB password is the only secret-shaped value in the input object,
      // and it is the harness default; what is asserted is that the RESULT the
      // evidence file is built from carries none of them.
      expect(JSON.stringify(established).toLowerCase()).not.toContain(secret);
    }
    expect(serialized.length).toBeGreaterThan(0);
  });

  it('G5 the privilege graph is exactly what it was: rows were written, privileges were not', async () => {
    expect(await privilegeGraph()).toBe(graphBefore);
  });

  it('G7 the shared database is untouched: an unrelated operator grant survives the whole lifecycle', async () => {
    // Read on the SHARED database, after every genesis run above. Before the
    // isolation this suite deleted every platform grant on the server in its
    // beforeAll, so this assertion would have failed on the first line.
    const live = await cluster.query<{ permission_code: string }>(
      'SELECT permission_code FROM iam.platform_grants WHERE account_id = $1 AND revoked_at IS NULL',
      [SENTINEL_ACCOUNT]
    );
    expect(live.rows.map((r) => r.permission_code)).toEqual(['platform.organization.read']);
    expect(await sharedGrantFingerprint()).toBe(sentinelBefore);
    // And the genesis really happened somewhere else: the operator this suite
    // established does not exist on the shared database at all.
    const leaked = await cluster.query('SELECT 1 FROM org.tenants WHERE tenant_code = $1', [HOME]);
    expect(leaked.rowCount).toBe(0);
    // Failure cleanup, proved rather than promised: dropping the isolated database
    // now — the same call afterAll makes — leaves the sentinel exactly as it was.
    await teardownIsolated();
    expect(await sharedGrantFingerprint()).toBe(sentinelBefore);
    const gone = await cluster.query('SELECT 1 FROM pg_database WHERE datname = $1', [ISOLATED]);
    expect(gone.rowCount).toBe(0);
  });
});
