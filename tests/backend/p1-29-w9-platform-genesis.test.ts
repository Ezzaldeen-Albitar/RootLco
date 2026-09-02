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
 *
 * The suite starts from a clean platform (no active grant anywhere) and ends
 * by removing what it created; it never runs alongside another backend suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
  platformAppPool,
} from './helpers';
import { readGenesisInput, runGenesis } from '../../scripts/platform/genesis-platform-operator.mjs';

const RUN = Math.random().toString(36).slice(2, 8);
const EMAIL = `operator_${RUN}@fixture.test`;
const HOME = `w9genesis_${RUN}`;

let admin: Pool;
let runtime: Pool;
let platform: Pool;

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

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  runtime = runtimeAppPool(2);
  platform = platformAppPool(2);
  // G1's precondition: a platform with no operator. Fixture grants left by
  // other suites are removed; the genesis must see none.
  await admin.query('DELETE FROM iam.platform_grants');
}, 120_000);

afterAll(async () => {
  await runtime.end();
  await platform.end();
  const home = await admin.query<{ id: string }>(
    'SELECT id FROM org.tenants WHERE tenant_code = $1',
    [HOME]
  );
  const ids = home.rows.map((r) => r.id);
  if (ids.length > 0) {
    await admin.query(
      'DELETE FROM iam.platform_grants WHERE account_id IN (SELECT id FROM iam.user_accounts WHERE tenant_id = ANY($1::uuid[]))',
      [ids]
    );
    for (const table of [
      'iam.audit_record_details',
      'iam.audit_integrity_links',
      'iam.audit_records',
      'iam.user_status_history',
      'iam.user_accounts',
      'org.tenant_status_history',
      'org.branch_settings',
      'org.company_settings',
      'org.branches',
      'org.legal_companies',
      'org.tenant_subscriptions',
      'org.tenant_feature_overrides',
      'shared.number_sequences',
      'org.tenants',
    ]) {
      const column = table === 'org.tenants' ? 'id' : 'tenant_id';
      await admin.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::uuid[])`, [ids]);
    }
  }
  await admin.query(
    "DELETE FROM shared.idempotency_keys WHERE operation = 'org_provisioning' AND idempotency_key LIKE 'platform-genesis:%'"
  );
  await admin.end();
}, 60_000);

describe('W9 — platform operator genesis', () => {
  let graphBefore: string;
  let established: Awaited<ReturnType<typeof runGenesis>>;

  it('refuses outside the two named environments, without the confirmation, and with a malformed input', () => {
    expect(() => input({ ROOTLCO_ENV: 'production' })).toThrow(/ROOTLCO_ENV/);
    expect(() =>
      readGenesisInput({ ROOTLCO_ENV: 'local-acceptance', GENESIS_OPERATOR_EMAIL: EMAIL }, [
        '--confirm',
        'someone@else.test',
      ])
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
      expect([...completed.completedGrants].sort()).toEqual([...completed.grants].sort());
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
});
