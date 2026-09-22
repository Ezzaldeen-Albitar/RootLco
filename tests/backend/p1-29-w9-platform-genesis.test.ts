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
 * ## The additions (P1-32-PRE-OD-OPERATOR), in this file rather than a new one
 *
 * `scripts/platform/add-platform-operator.mjs` closes the gap between genesis,
 * which is one-time, and `grant-platform-authority.mjs`, which refuses an
 * account holding no grant: before it there was no supported way to add a
 * SECOND operator at all. It is the only one of the three writers of
 * `iam.platform_grants` that can MINT an operator, so what matters is what it
 * refuses, and its refusals need exactly the precondition this suite already
 * builds — a first operator, established by genesis, in a database of this
 * suite's own.
 *
 *   A1  the first operator adds a second, and the trail names the GRANTOR
 *       rather than the catalogue actor
 *   A2  an operator cannot pass on a code they do not hold
 *   A3  a grantor cannot add themselves
 *   A4  an address already seated in the home tenant is refused, pointing at
 *       grant-platform-authority.mjs
 *   A5  an account in some ORGANISATION cannot act as grantor, however it
 *       signs in
 *   A6  an identity resolving to no account cannot act as grantor
 *   A7  genesis is STILL one-time once a second operator exists
 *
 * ## The revocations (P1-32-PRE-OD-UX), in this file for the same reason
 *
 * `scripts/platform/revoke-platform-operator.mjs` is the counterpart: until it
 * existed, `iam.platform_grants` could only ever grow, and removing an operator
 * meant editing the record by hand. It needs the same precondition — several
 * operators, one of them established by genesis — so its cases run here too:
 *
 *   R1  a rehearsed (`--dry-run`) revocation writes nothing
 *   R2  the FIRST owner is refused, identified by the `platform.operator.genesis`
 *       record rather than by any address
 *   R3  a real revocation takes every code, ends the recorded sessions, leaves
 *       the rows and the account in place, and is recorded
 *   R4  the LAST holder of platform authority is refused, self-revocation
 *       included
 *   R5  two CONCURRENT revocations of the last two holders cannot both commit —
 *       the guard `REVOCATION_LOCK_SQL` exists for, driven on two connections
 *
 * The `admin` pool carries three connections, which is what makes R5 a real
 * race rather than two sequential calls dressed up as one.
 *
 * R3 measures the refusal that follows by calling `iam.has_platform_authority`
 * on the control-plane login — the exact predicate
 * `apps/api/src/server/auth/authorization.ts` calls for every `platform.` code
 * and the one that becomes `ERR-IAM-001`. No HTTP server is started here, so the
 * 403 is asserted one layer below the status line rather than claimed.
 *
 * They are `it`s in this suite rather than a file of their own because a new
 * file under `tests/backend` moves a count a sealed P1-27 record states
 * (`scripts/ci/check-p1-27-doc-counts.mjs` counts that directory), and because
 * they run against the operator G1 established. The refusals themselves are
 * pure functions driven exhaustively in
 * `tests/ci/platform-grant-base-entitlement.test.ts`; what is proved HERE is the
 * transaction. No identity provider is reached: `runAddOperator` takes the
 * subject the grantor's sign-in proved as an argument, and asks for the
 * grantee's identity through a callback this suite answers itself.
 *
 * That callback counts its calls, which is how A2, A5 and A6 assert the order
 * the real script depends on: a refused run must not have asked for the
 * grantee's identity at all, because asking means inviting an address the run
 * is about to reject.
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
  strayPoolErrors,
  loginPoolFor,
} from './isolated-database';
import {
  PLATFORM_AUTHORITY_CODES,
  PLATFORM_BASE_AUTHORITY_CODE,
  readGenesisInput,
  runGenesis,
} from '../../scripts/platform/genesis-platform-operator.mjs';
import {
  readAddOperatorInput,
  runAddOperator,
} from '../../scripts/platform/add-platform-operator.mjs';
import {
  readRevokeOperatorInput,
  runRevokeOperator,
} from '../../scripts/platform/revoke-platform-operator.mjs';

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

/** The addresses and identities the A-cases use, all derived from this run. */
const SECOND = `second_op_${RUN}@fixture.test`;
const THIRD = `third_op_${RUN}@fixture.test`;
/** The two operators R5 races against each other, established by R5 itself. */
const FOURTH = `fourth_op_${RUN}@fixture.test`;
const FIFTH = `fifth_op_${RUN}@fixture.test`;
const ORGANISATION = `addoporg_${RUN}`;
/** The second operator, established by A1 and used as a grantor by A2. */
let secondAccountId: string;

function addInput(email: string, grantorEmail: string, codes?: readonly string[]) {
  return readAddOperatorInput(
    {
      ROOTLCO_ENV: 'local-acceptance',
      ADD_OPERATOR_EMAIL: email,
      ADD_OPERATOR_DISPLAY_NAME: 'Another operator',
      ADD_OPERATOR_GRANTOR_EMAIL: grantorEmail,
      ADD_OPERATOR_IDENTITY_PROVIDER: 'test_harness',
      ADD_OPERATOR_HOME_TENANT_CODE: HOME,
      NODE_ENV: 'test',
    },
    codes === undefined ? ['--confirm', email] : ['--confirm', email, '--codes', codes.join(',')]
  );
}

/**
 * How many times a run has asked for the grantee's provider identity. In the
 * real script that call is the invitation, so the count is the observable form
 * of "the provider is reached only after every refusal has passed".
 */
let identityRequests = 0;

/** The reason every revocation in the R-cases states. Non-blank by constraint. */
const REVOKE_REASON = 'operator left the platform team';

function revokeInput(email: string, revokerEmail: string, dryRun = false) {
  return readRevokeOperatorInput(
    {
      ROOTLCO_ENV: 'local-acceptance',
      REVOKE_OPERATOR_EMAIL: email,
      REVOKE_OPERATOR_REASON: REVOKE_REASON,
      REVOKE_OPERATOR_GRANTOR_EMAIL: revokerEmail,
      REVOKE_OPERATOR_IDENTITY_PROVIDER: 'test_harness',
      REVOKE_OPERATOR_HOME_TENANT_CODE: HOME,
      NODE_ENV: 'test',
    },
    dryRun ? ['--confirm', email, '--dry-run'] : ['--confirm', email]
  );
}

/** Runs one revocation on its own connection, so a rollback cannot leak. */
async function revoke(
  request: ReturnType<typeof revokeInput>,
  provenSubject: string
): Promise<Awaited<ReturnType<typeof runRevokeOperator>>> {
  const client = await admin.connect();
  try {
    return await runRevokeOperator(client, request, provenSubject);
  } finally {
    client.release();
  }
}

/**
 * True when the acting principal would pass the platform authority gate.
 *
 * This is the exact predicate `evaluatePermissions` calls for every `platform.`
 * code (`apps/api/src/server/auth/authorization.ts`), on the control-plane
 * login the application deploys with. A false answer is what
 * `requirePermissions` turns into `ERR-IAM-001`, the console's 403 — so this is
 * the refusal itself rather than a proxy for it, measured one layer below the
 * HTTP status.
 */
async function platformReadAllowed(accountId: string): Promise<boolean> {
  const client = await platform.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [accountId]);
    const answer = await client.query<{ allowed: boolean }>(
      'SELECT iam.has_platform_authority($1) AS allowed',
      [PLATFORM_BASE_AUTHORITY_CODE]
    );
    return answer.rows[0]?.allowed === true;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** A live session row for an operator, so a revocation has one to end. */
async function seatSession(tenantId: string, accountId: string, ref: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_sessions (tenant_id, user_id, session_ref, created_by)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, accountId, ref, SYSTEM_ACTOR]
  );
}

/** Every unrevoked platform code an account holds, sorted. */
async function heldCodes(accountId: string): Promise<string[]> {
  const rows = await admin.query<{ permission_code: string }>(
    `SELECT permission_code FROM iam.platform_grants
      WHERE account_id = $1 AND revoked_at IS NULL ORDER BY 1`,
    [accountId]
  );
  return rows.rows.map((row) => row.permission_code);
}

/** Runs one addition on its own connection, so a rollback cannot leak. */
async function add(
  request: ReturnType<typeof addInput>,
  granteeSubject: string,
  provenSubject: string
): Promise<Awaited<ReturnType<typeof runAddOperator>>> {
  const client = await admin.connect();
  try {
    return await runAddOperator(
      client,
      request,
      async () => {
        identityRequests += 1;
        return { subject: granteeSubject, created: false };
      },
      provenSubject
    );
  } finally {
    client.release();
  }
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
    // A pool that emitted an error with no query in flight would otherwise
    // have crashed the process after every test passed; here it fails the
    // suite by name instead. Empty is the only acceptable answer.
    expect(strayPoolErrors().map((error) => error.message)).toEqual([]);
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
    // Every code in the ONE exported list and nothing else (P1-32-PRE-020 raised
    // it from three to nine). The query sorts, so the expectation is sorted too.
    expect(grants.rows.map((g) => g.permission_code)).toEqual([...PLATFORM_AUTHORITY_CODES].sort());
    expect(grants.rows).toHaveLength(9);
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
    ).toMatchObject({ rowCount: PLATFORM_AUTHORITY_CODES.length });
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
    ).toMatchObject({ rowCount: PLATFORM_AUTHORITY_CODES.length });
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

  it('A1 the first operator adds a second, and the trail names the grantor', async () => {
    // The base code ALONE, deliberately, so A2 can then prove that an operator
    // cannot pass on what they do not hold.
    const added = await add(
      addInput(SECOND, EMAIL, [PLATFORM_BASE_AUTHORITY_CODE]),
      `sub_second_${RUN}`,
      `sub_${RUN}`
    );
    expect(added).toMatchObject({
      outcome: 'added',
      homeTenantId: established.homeTenantId,
      grantorAccountId: established.operatorAccountId,
    });
    secondAccountId = added.operatorAccountId;
    expect(secondAccountId).not.toBe(established.operatorAccountId);

    const grants = await admin.query<{ permission_code: string; granted_by: string }>(
      `SELECT permission_code, granted_by FROM iam.platform_grants
        WHERE account_id = $1 AND revoked_at IS NULL ORDER BY 1`,
      [secondAccountId]
    );
    expect(grants.rows.map((row) => row.permission_code)).toEqual([PLATFORM_BASE_AUTHORITY_CODE]);
    // Attributed to the GRANTOR, not to the catalogue actor genesis uses.
    expect(grants.rows.map((row) => row.granted_by)).toEqual([established.operatorAccountId]);
    expect(grants.rows[0]?.granted_by).not.toBe(SYSTEM_ACTOR);

    const account = await admin.query<{ status: string; tenant_id: string; email: string }>(
      'SELECT status, tenant_id, email FROM iam.user_accounts WHERE id = $1',
      [secondAccountId]
    );
    expect(account.rows[0]).toMatchObject({
      status: 'active',
      tenant_id: established.homeTenantId,
      email: SECOND,
    });
    // Zero tenant roles: an operator holds authority, never a seat in a business.
    expect(
      await admin.query('SELECT 1 FROM iam.role_grants WHERE user_id = $1', [secondAccountId])
    ).toMatchObject({ rowCount: 0 });

    const audit = await admin.query<{ actor_id: string; entity_id: string; fields: string[] }>(
      `SELECT r.actor_id, r.entity_id, array_agg(d.field_name ORDER BY d.field_name) AS fields
         FROM iam.audit_records r
         JOIN iam.audit_record_details d ON d.audit_record_id = r.id
        WHERE r.id = $1 AND r.action = 'platform.operator.authority_granted'
        GROUP BY r.actor_id, r.entity_id`,
      [added.auditRecordId]
    );
    expect(audit.rows[0]).toEqual({
      actor_id: established.operatorAccountId,
      entity_id: secondAccountId,
      fields: [
        'environment',
        'granted_by',
        'home_tenant_id',
        'identity_provider',
        'platform_grants',
      ],
    });
  });

  it('A2 an operator cannot grant a code they do not themselves hold', async () => {
    const asked = identityRequests;
    await expect(
      add(
        addInput(THIRD, SECOND, [PLATFORM_BASE_AUTHORITY_CODE, 'platform.audit.read']),
        `sub_third_${RUN}`,
        `sub_second_${RUN}`
      )
    ).rejects.toMatchObject({
      exitCode: 4,
      message: expect.stringContaining('platform.audit.read'),
    });
    // The transaction rolled back: no account carries that address.
    expect(
      await admin.query('SELECT 1 FROM iam.user_accounts WHERE lower(email) = $1', [THIRD])
    ).toMatchObject({ rowCount: 0 });
    // And the refused run never asked for the grantee's identity — in the real
    // script that request is an invitation to the address just rejected.
    expect(identityRequests).toBe(asked);

    // The same grantor, requesting only what they hold, is admitted — so the
    // refusal above is about the code, not about the grantor.
    expect(
      await add(
        addInput(THIRD, SECOND, [PLATFORM_BASE_AUTHORITY_CODE]),
        `sub_third_${RUN}`,
        `sub_second_${RUN}`
      )
    ).toMatchObject({
      outcome: 'added',
      grantorAccountId: secondAccountId,
      homeTenantId: established.homeTenantId,
    });
    // Exactly one request, from the run that was admitted: the counter is not
    // stuck, so the case above is a real difference and not a dead assertion.
    expect(identityRequests).toBe(asked + 1);
  });

  it('A3 a grantor cannot add themselves, and A4 an address already at home is refused', async () => {
    // Refused while the input is read, before a connection is opened at all.
    expect(() => addInput(EMAIL, EMAIL)).toThrowError(/same address/);
    // And refused again inside the transaction, for a caller that built the
    // input some other way: the rule does not live only in the argument parser.
    const bypass = addInput(THIRD, EMAIL);
    bypass.operator.email = EMAIL;
    await expect(add(bypass, `sub_${RUN}`, `sub_${RUN}`)).rejects.toMatchObject({
      exitCode: 4,
      message: expect.stringContaining('same address'),
    });
    await expect(
      add(addInput(SECOND, EMAIL), `sub_second_${RUN}_again`, `sub_${RUN}`)
    ).rejects.toMatchObject({
      exitCode: 4,
      message: expect.stringContaining('grant-platform-authority.mjs'),
    });
    // Exactly one account with that address, holding exactly what A1 gave it.
    expect(
      await admin.query('SELECT 1 FROM iam.user_accounts WHERE lower(email) = $1', [SECOND])
    ).toMatchObject({ rowCount: 1 });
    expect(
      await admin.query(
        'SELECT 1 FROM iam.platform_grants WHERE account_id = $1 AND revoked_at IS NULL',
        [secondAccountId]
      )
    ).toMatchObject({ rowCount: 1 });
  });

  it("A5 an organisation's own account cannot act as grantor, and A6 nor can an unknown identity", async () => {
    // A real organisation, provisioned through the sanctioned function, with an
    // account in it that signs in exactly the way an operator would. Both writes
    // need an actor in the session context — the status-history trigger refuses
    // without one — and `set_config(..., true)` is transaction-local, so this
    // runs on one client inside one transaction.
    const administratorAddress = `administrator_${RUN}@fixture.test`;
    const asked = identityRequests;
    const fixture = await admin.connect();
    let administratorId: string;
    try {
      await fixture.query('BEGIN');
      await fixture.query("SELECT set_config('app.user_id', $1, true)", [SYSTEM_ACTOR]);
      const provisioned = await fixture.query<{ result: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS result',
        [
          JSON.stringify({
            actor_id: SYSTEM_ACTOR,
            tenant: {
              code: ORGANISATION,
              display_name: 'An organisation',
              locale: 'en',
              timezone: 'UTC',
            },
            company: { code: ORGANISATION, legal_name: 'An organisation', base_currency: 'USD' },
            branch: { code: 'main', name: 'Main', timezone: 'UTC' },
          }),
          `addop-fixture:${ORGANISATION}`,
        ]
      );
      const organisationTenantId = provisioned.rows[0]?.result.tenant_id as string;
      await fixture.query("SELECT set_config('app.tenant_id', $1, true)", [organisationTenantId]);
      const inserted = await fixture.query<{ id: string }>(
        `INSERT INTO iam.user_accounts
           (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
         VALUES ($1, 'test_harness', $2, $3, 'An administrator', 'active', $4)
         RETURNING id`,
        [organisationTenantId, `sub_admin_${RUN}`, administratorAddress, SYSTEM_ACTOR]
      );
      administratorId = inserted.rows[0]?.id as string;
      await fixture.query('COMMIT');
    } catch (error) {
      await fixture.query('ROLLBACK');
      throw error;
    } finally {
      fixture.release();
    }

    await expect(
      add(
        addInput(`escalated_${RUN}@fixture.test`, administratorAddress),
        `sub_escalated_${RUN}`,
        `sub_admin_${RUN}`
      )
    ).rejects.toMatchObject({ exitCode: 4, message: expect.stringContaining(ORGANISATION) });
    // The account exists and is active — what refused it is where it lives and
    // what it holds, not whether it was found.
    expect(
      await admin.query("SELECT 1 FROM iam.user_accounts WHERE id = $1 AND status = 'active'", [
        administratorId,
      ])
    ).toMatchObject({ rowCount: 1 });
    expect(
      await admin.query('SELECT 1 FROM iam.user_accounts WHERE lower(email) = $1', [
        `escalated_${RUN}@fixture.test`,
      ])
    ).toMatchObject({ rowCount: 0 });

    // A6 — an identity that resolves to no account at all.
    await expect(
      add(
        addInput(`nobody_${RUN}@fixture.test`, `ghost_${RUN}@fixture.test`),
        `sub_nobody_${RUN}`,
        `sub_ghost_${RUN}`
      )
    ).rejects.toMatchObject({
      exitCode: 4,
      message: expect.stringContaining('genesis-platform-operator.mjs'),
    });
    // Neither refusal reached for the grantee's identity: a run with no
    // provable grantor invites nobody.
    expect(identityRequests).toBe(asked);
  });

  it('A7 genesis is still one-time once a second operator exists', async () => {
    const client = await admin.connect();
    try {
      await expect(
        runGenesis(
          client,
          input({
            GENESIS_OPERATOR_EMAIL: `fourth_${RUN}@fixture.test`,
            GENESIS_HOME_TENANT_CODE: `${HOME}e`,
          }),
          { subject: `sub_fourth_${RUN}`, created: false }
        )
      ).rejects.toMatchObject({ exitCode: 4, message: expect.stringContaining('one-time') });
    } finally {
      client.release();
    }
    // Three holders now, and the first still holds the whole catalogue list.
    const holders = await admin.query<{ n: number }>(
      'SELECT count(DISTINCT account_id)::int AS n FROM iam.platform_grants WHERE revoked_at IS NULL'
    );
    expect(holders.rows[0]?.n).toBe(3);
    expect(
      await admin.query(
        'SELECT 1 FROM iam.platform_grants WHERE account_id = $1 AND revoked_at IS NULL',
        [established.operatorAccountId]
      )
    ).toMatchObject({ rowCount: PLATFORM_AUTHORITY_CODES.length });
  });

  it('R1 a rehearsed revocation changes nothing at all', async () => {
    await seatSession(established.homeTenantId, secondAccountId, `sess_second_${RUN}`);
    const rehearsal = await revoke(revokeInput(SECOND, EMAIL, true), `sub_${RUN}`);
    expect(rehearsal).toMatchObject({
      outcome: 'dry-run',
      operatorAccountId: secondAccountId,
      revokerAccountId: established.operatorAccountId,
      revokedGrants: [PLATFORM_BASE_AUTHORITY_CODE],
      sessionsEnded: 1,
      remainingOperators: 2,
    });
    // Every write the rehearsal reported is still absent: the grant, the
    // session and the audit record it would have appended.
    expect(await heldCodes(secondAccountId)).toEqual([PLATFORM_BASE_AUTHORITY_CODE]);
    expect(
      await admin.query(
        'SELECT 1 FROM iam.user_sessions WHERE user_id = $1 AND revoked_at IS NULL',
        [secondAccountId]
      )
    ).toMatchObject({ rowCount: 1 });
    expect(
      await admin.query('SELECT 1 FROM iam.audit_records WHERE id = $1', [rehearsal.auditRecordId])
    ).toMatchObject({ rowCount: 0 });
    // And the operator it rehearsed against can still open the console.
    expect(await platformReadAllowed(secondAccountId)).toBe(true);
  });

  it('R2 the first owner is refused, named by the genesis record rather than by an address', async () => {
    await expect(revoke(revokeInput(EMAIL, SECOND), `sub_second_${RUN}`)).rejects.toMatchObject({
      exitCode: 4,
      message: expect.stringContaining('platform.operator.genesis'),
    });
    // Refused for WHAT THE ACCOUNT IS, not for want of a revoker: the same
    // revoker succeeds against a different operator in R3.
    expect(await heldCodes(established.operatorAccountId)).toEqual(
      [...PLATFORM_AUTHORITY_CODES].sort()
    );
    expect(await platformReadAllowed(established.operatorAccountId)).toBe(true);
  });

  it('R3 a real revocation takes the authority, ends the sessions, and is recorded', async () => {
    const revoked = await revoke(revokeInput(SECOND, EMAIL), `sub_${RUN}`);
    expect(revoked).toMatchObject({
      outcome: 'revoked',
      operatorAccountId: secondAccountId,
      homeTenantId: established.homeTenantId,
      revokerAccountId: established.operatorAccountId,
      revokedGrants: [PLATFORM_BASE_AUTHORITY_CODE],
      sessionsEnded: 1,
      remainingOperators: 2,
    });

    // The next platform read is refused. This is the predicate
    // `evaluatePermissions` calls for every `platform.` code and the one
    // `requirePermissions` turns into ERR-IAM-001 — the console's 403.
    expect(await platformReadAllowed(secondAccountId)).toBe(false);
    expect(await heldCodes(secondAccountId)).toEqual([]);

    // Nothing was deleted. The grant row survives, carrying who took it away.
    const rows = await admin.query<{ permission_code: string; revoked_by: string }>(
      `SELECT permission_code, revoked_by FROM iam.platform_grants
        WHERE account_id = $1 AND revoked_at IS NOT NULL ORDER BY 1`,
      [secondAccountId]
    );
    expect(rows.rows).toEqual([
      { permission_code: PLATFORM_BASE_AUTHORITY_CODE, revoked_by: established.operatorAccountId },
    ]);
    // And so does the account itself, active and seated where it was.
    expect(
      await admin.query<{ status: string; tenant_id: string }>(
        'SELECT status, tenant_id FROM iam.user_accounts WHERE id = $1',
        [secondAccountId]
      )
    ).toMatchObject({
      rows: [{ status: 'active', tenant_id: established.homeTenantId }],
    });

    const session = await admin.query<{ revoked: boolean; revoke_reason: string }>(
      `SELECT revoked_at IS NOT NULL AS revoked, revoke_reason FROM iam.user_sessions
        WHERE user_id = $1`,
      [secondAccountId]
    );
    expect(session.rows).toEqual([{ revoked: true, revoke_reason: REVOKE_REASON }]);

    const audit = await admin.query<{ actor_id: string; entity_id: string; fields: string[] }>(
      `SELECT r.actor_id, r.entity_id, array_agg(d.field_name ORDER BY d.field_name) AS fields
         FROM iam.audit_records r
         JOIN iam.audit_record_details d ON d.audit_record_id = r.id
        WHERE r.id = $1 AND r.action = 'platform.operator.authority_revoked'
        GROUP BY r.actor_id, r.entity_id`,
      [revoked.auditRecordId]
    );
    expect(audit.rows[0]).toEqual({
      actor_id: established.operatorAccountId,
      entity_id: secondAccountId,
      fields: [
        'environment',
        'home_tenant_id',
        'identity_provider',
        'platform_grants',
        'reason',
        'revoked_by',
        'sessions_ended',
      ],
    });

    // Revoking the same account again has nothing to take, and says so rather
    // than writing a second record.
    await expect(revoke(revokeInput(SECOND, EMAIL), `sub_${RUN}`)).rejects.toMatchObject({
      exitCode: 4,
      message: expect.stringContaining('nothing to revoke'),
    });
  });

  it('R4 the last holder of platform authority cannot be revoked, not even by themselves', async () => {
    // Fixture surgery, stated as such: the script itself refuses to revoke the
    // first owner (R2), so the one-holder state this rule exists for cannot be
    // reached through the script and is written here by hand, on this suite's
    // own database.
    await admin.query(
      `UPDATE iam.platform_grants
          SET revoked_at = now(), revoked_by = $2
        WHERE account_id = $1 AND revoked_at IS NULL`,
      [established.operatorAccountId, SYSTEM_ACTOR]
    );
    const holders = await admin.query<{ n: number }>(
      'SELECT count(DISTINCT account_id)::int AS n FROM iam.platform_grants WHERE revoked_at IS NULL'
    );
    expect(holders.rows[0]?.n).toBe(1);

    const thirdAccount = await admin.query<{ id: string }>(
      'SELECT id FROM iam.user_accounts WHERE lower(email) = $1',
      [THIRD]
    );
    const thirdAccountId = thirdAccount.rows[0]?.id as string;
    await seatSession(established.homeTenantId, thirdAccountId, `sess_third_${RUN}`);

    await expect(revoke(revokeInput(THIRD, THIRD), `sub_third_${RUN}`)).rejects.toMatchObject({
      exitCode: 4,
      message: expect.stringContaining('last holder of platform authority'),
    });
    // Refused before anything was written: the grant, the session and the
    // console access are all exactly as they were.
    expect(await heldCodes(thirdAccountId)).toEqual([PLATFORM_BASE_AUTHORITY_CODE]);
    expect(
      await admin.query(
        'SELECT 1 FROM iam.user_sessions WHERE user_id = $1 AND revoked_at IS NULL',
        [thirdAccountId]
      )
    ).toMatchObject({ rowCount: 1 });
    expect(await platformReadAllowed(thirdAccountId)).toBe(true);
    expect(
      await admin.query(
        "SELECT 1 FROM iam.audit_records WHERE action = 'platform.operator.authority_revoked' AND entity_id = $1",
        [thirdAccountId]
      )
    ).toMatchObject({ rowCount: 0 });
  });

  /**
   * The last-holder rule is a READ followed by a WRITE, and without
   * serialization that is not a rule at all: under READ COMMITTED two runs
   * revoking the last two holders each read "one other holder remains", each
   * pass, and both commit — leaving a platform with no operator, which is the
   * one state nothing in this repository recovers from. The in-transaction
   * re-assertion does not close it either: both transactions count the same
   * pre-commit snapshot.
   *
   * So this case drives the two runs CONCURRENTLY, on two connections, through
   * the real script, and asserts the outcome is one commit and one refusal
   * rather than two commits. Which run wins is not asserted — that is a race and
   * naming a winner would be a flake — but the SHAPE is deterministic because
   * `REVOCATION_LOCK_SQL` serializes them: the second run reads the first one's
   * committed outcome and is refused BY THE PRE-WRITE RULE, before it has
   * touched a row.
   *
   * That last part is what the case actually pins, and it is worth saying
   * exactly. Measured with the lock removed on 2026-09-22, the two runs did not
   * both commit on this machine: the loser was caught by the in-transaction
   * re-assertion instead, because its verification query happened to run after
   * the winner committed. That is luck, not a guard — the re-assertion counts a
   * READ COMMITTED snapshot, so a different interleaving admits both — and it
   * also means the loser had already written its UPDATEs before anything stopped
   * it. Asserting the refusal MESSAGE, not merely that one run failed, is
   * therefore the whole point: with the lock the refusal is the deterministic
   * pre-write one, and without it this case fails.
   *
   * Both runs are self-revocations, which is what makes the surviving refusal
   * the LAST-HOLDER one rather than the revoker one: each run's revoker is its
   * own target, so the loser still holds authority when it is refused.
   */
  it('R5 two concurrent revocations of the last two holders cannot both commit', async () => {
    // Two more operators, established through the sanctioned path by the holder
    // R4 left in place, so this case builds its own precondition.
    const third = await admin.query<{ id: string }>(
      'SELECT id FROM iam.user_accounts WHERE lower(email) = $1',
      [THIRD]
    );
    const thirdAccountId = third.rows[0]?.id as string;
    await add(
      addInput(FOURTH, THIRD, [PLATFORM_BASE_AUTHORITY_CODE]),
      `sub_fourth_${RUN}`,
      `sub_third_${RUN}`
    );
    await add(
      addInput(FIFTH, THIRD, [PLATFORM_BASE_AUTHORITY_CODE]),
      `sub_fifth_${RUN}`,
      `sub_third_${RUN}`
    );
    // Now exactly two holders are left to race: the third operator steps down
    // first, through the script, leaving the two this case established.
    await revoke(revokeInput(THIRD, FOURTH), `sub_fourth_${RUN}`);
    expect(await heldCodes(thirdAccountId)).toEqual([]);
    const before = await admin.query<{ n: number }>(
      'SELECT count(DISTINCT account_id)::int AS n FROM iam.platform_grants WHERE revoked_at IS NULL'
    );
    expect(before.rows[0]?.n).toBe(2);

    const settled = await Promise.allSettled([
      revoke(revokeInput(FOURTH, FOURTH), `sub_fourth_${RUN}`),
      revoke(revokeInput(FIFTH, FIFTH), `sub_fifth_${RUN}`),
    ]);
    const kept = settled.filter((outcome) => outcome.status === 'fulfilled');
    const refused = settled.filter((outcome) => outcome.status === 'rejected');
    expect(kept).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
      exitCode: 4,
      message: expect.stringContaining('last holder of platform authority'),
    });

    // The whole point: somebody still holds platform authority.
    const after = await admin.query<{ n: number }>(
      'SELECT count(DISTINCT account_id)::int AS n FROM iam.platform_grants WHERE revoked_at IS NULL'
    );
    expect(after.rows[0]?.n).toBe(1);

    // And the survivor cannot step down either — the sequential form of the
    // same rule, so the concurrent result above is not a lucky ordering.
    const survivor = await admin.query<{ email: string }>(
      `SELECT DISTINCT lower(a.email) AS email
         FROM iam.platform_grants g
         JOIN iam.user_accounts a ON a.id = g.account_id
        WHERE g.revoked_at IS NULL`
    );
    const address = survivor.rows[0]?.email as string;
    const subject = address === FOURTH ? `sub_fourth_${RUN}` : `sub_fifth_${RUN}`;
    await expect(revoke(revokeInput(address, address), subject)).rejects.toMatchObject({
      exitCode: 4,
      message: expect.stringContaining('last holder of platform authority'),
    });
    expect(
      (
        await admin.query<{ n: number }>(
          'SELECT count(DISTINCT account_id)::int AS n FROM iam.platform_grants WHERE revoked_at IS NULL'
        )
      ).rows[0]?.n
    ).toBe(1);
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
