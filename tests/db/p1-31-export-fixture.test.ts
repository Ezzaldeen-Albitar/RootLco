/**
 * The privileged export-fixture writer, executed against a real PostgreSQL.
 *
 * `scripts/dev/owner-acceptance/export-fixture-setup.mjs` installs a scoped, expiring role on
 * one named acceptance principal from a privileged connection. Until this file existed, every
 * assertion about it came from a stub: `tests/ci/p1-31-export-fixture-refusals.test.ts` drives
 * the whole refusal matrix without a database, which proves the guards and proves nothing
 * whatever about the SQL. A statement that has never run is not a statement that works, and a
 * deferred constraint in particular cannot be observed by any test that does not open a
 * transaction.
 *
 * ## What is substituted, and it is exactly one thing
 *
 * `installExportFixture` takes its target guard as `options.assertTarget`, defaulting to the
 * real `assertLocalTarget`. The command line has no flag, no argument and no environment
 * variable that substitutes it, so nothing an operator can type relaxes the loopback check;
 * the parameter exists for an in-process caller, and this file is that caller. The substitute
 * returns `{ host, port, database }` MEASURED from the connection this file actually uses —
 * `current_database()` for the name — and carries no credential of any kind.
 *
 * Nothing else is substituted. Real here: every statement, `BEGIN`/`COMMIT`/`ROLLBACK`, the
 * confirmation token, the derived principal address and role code, the attempt bound, the
 * operator-authority lookup against `iam.platform_grants`, all four freshness predicates, the
 * duplicate-fixture and catalogue checks, the connection-privilege precondition, the shared
 * advisory-lock lease, the exclusive evidence reservation and its finalization on the real
 * filesystem, `iam.audit_append` with its hash chain, the three deferred constraint triggers,
 * and `iam.has_permission_in_scope` — which is consulted on a NOBYPASSRLS `app_runtime`
 * connection, never on the privileged one that wrote the rows.
 *
 * What this file does NOT prove is the loopback guard itself, because that is the one thing it
 * replaces; that guard is exercised by the database-free file named above, which manipulates
 * the environment the real guard reads.
 *
 * ## The database this runs against
 *
 * A DISPOSABLE database in the local cluster, named by `DB_NAME`, built by
 * `scripts/db/apply-migrations.mjs` plus the seven files of `supabase/seeds/` in numeric order.
 * The proofs of record were taken against `rootlco_p131_fixture_20260914` on 127.0.0.1:54322.
 * It is NOT the shared local acceptance database: `beforeAll` refuses to run when
 * `current_database()` is `postgres`, because this file installs privileged grants and writing
 * them into the acceptance environment would contaminate a run in progress. Cleanup is by the
 * identifiers each case created, through `deleteTenantCascade`, and never by a name prefix.
 *
 * ## The runner, which is NOT the shared database tier
 *
 * That refusal and the shared tier are incompatible by construction: `tests/db/helpers.ts`
 * falls back to `postgres`, and every hosted database job supplies that name at job level. So
 * this file is EXCLUDED from `vitest.config.db.ts` by name and carries its own configuration,
 * `vitest.config.db-fixture.ts`, reached by
 *
 *     npm run test:db-fixture
 *
 * with `DB_NAME` pointing at the disposable database. The consequence is stated rather than
 * hidden: NO hosted job runs this file, because no hosted job has a disposable database to
 * give it. It is an explicit operator proof, registered `environment` in
 * `scripts/ci/check-command-coverage.mjs`, and the closing acceptance procedure names both the
 * command and the database so it is taken deliberately. The alternative — relaxing the refusal
 * into a skip so the file could ride the shared tier — would put a privileged writer one
 * environment variable away from the acceptance database and report the near miss as green.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acquireDatabaseLease } from '../../scripts/lib/database-lease.mjs';
import { SYSTEM_ACTOR } from '../../scripts/dev/owner-acceptance/context.mjs';
// The consumer's own contract module, so a document produced by a REAL run is held to the shape
// the out-of-repository companion reads rather than to a shape restated here.
import { validateExportFixtureResult } from '../../scripts/dev/owner-acceptance/export-fixture-result-contract.mjs';
import {
  EXPORT_FIXTURE_PERMISSIONS,
  MAX_FIXTURE_ATTEMPT,
  exitCodeFor,
  fixturePrincipalAddress,
  fixtureRoleCode,
  installExportFixture,
  readFixtureInput,
} from '../../scripts/dev/owner-acceptance/export-fixture-setup.mjs';
import {
  adminPool,
  deleteTenantCascade,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  withRolledBackTx,
} from './helpers';

/** The permission code the export contract is gated on. A code, not an operation identifier. */
const EXPORT_CODE = 'rpt.export';

/** The two values the environment contributes. Neither is a credential. */
const HOST = process.env.DB_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DB_PORT ?? 54_322);

/** The runtime login `ensureTestLogins` creates: NOSUPERUSER, NOBYPASSRLS, member of app_runtime. */
const RUNTIME_ROLE = 'rootlco_test_runtime';

interface Principal {
  readonly attempt: number;
  readonly id: string;
  readonly email: string;
}

interface World {
  readonly stamp: string;
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly siblingBranchId: string;
  readonly operatorId: string;
  readonly operatorEmail: string;
  readonly principals: readonly Principal[];
}

interface Counts {
  readonly roles: number;
  readonly permissions: number;
  readonly grants: number;
  readonly scopes: number;
  readonly audits: number;
  readonly details: number;
}

interface Refusal {
  readonly code: number;
  readonly message: string;
}

let admin: Pool;
/** A SECOND admin pool, so a connection destroyed after an install never disturbs cleanup. */
let writer: Pool;
let runtime: Pool;
let target: { readonly host: string; readonly port: number; readonly database: string } | undefined;
let evidenceRoot: string;
const createdTenants: string[] = [];

/** The substituted guard — and the ONLY substitution in this file. */
function assertTarget(): {
  readonly host: string;
  readonly port: number;
  readonly database: string;
} {
  if (target === undefined) throw new Error('the database target has not been measured yet');
  return target;
}

/** A fresh evidence path per call, so no case inherits another's reservation. */
function evidencePath(label: string): string {
  return join(evidenceRoot, `${label}-${randomUUID()}.json`);
}

beforeAll(async () => {
  admin = adminPool();
  writer = adminPool();
  runtime = runtimePool();
  const answered = await admin.query('SELECT current_database() AS database');
  const database = String(answered.rows[0].database);
  if (database === 'postgres') {
    throw new Error(
      'REFUSING TO RUN: this file installs privileged role grants and must never be pointed at ' +
        'the shared local acceptance database. Create a disposable database, apply the ' +
        'migrations and the seven seed files to it, and set DB_NAME to that database.'
    );
  }
  target = { host: HOST, port: PORT, database };
  await ensureTestLogins(admin);
  evidenceRoot = mkdtempSync(join(tmpdir(), 'p131-fixture-db-'));
});

afterAll(async () => {
  await deleteTenantCascade(admin, createdTenants);
  if (evidenceRoot !== undefined) rmSync(evidenceRoot, { recursive: true, force: true });
  await runtime.end();
  await writer.end();
  await admin.end();
});

/**
 * One organisation the writer would accept, provisioned as admin.
 *
 * Admin-provisioned fixtures are never evidence of anything by themselves — they are the world
 * the writer is then asked to act on. `tenantAgeHours` and `accountAgeHours` exist so the two
 * freshness predicates can be failed one at a time, which is what the writer's four separate
 * statements claim to make distinguishable.
 */
async function makeWorld(
  options: {
    readonly authority?: boolean;
    readonly tenantAgeHours?: number;
    readonly accountAgeHours?: number;
    readonly attempts?: number;
  } = {}
): Promise<World> {
  const authority = options.authority ?? true;
  const tenantAgeHours = options.tenantAgeHours ?? 0;
  const accountAgeHours = options.accountAgeHours ?? 0;
  const attempts = options.attempts ?? 1;

  const stamp = randomUUID().replaceAll('-', '').slice(0, 12);
  const tenantId = randomUUID();
  const tenantCode = `p31_journey_a_${stamp}`;
  const companyId = randomUUID();
  const branchId = randomUUID();
  const siblingBranchId = randomUUID();
  const operatorId = randomUUID();
  const operatorEmail = `p31.operator.${stamp}@rootlco.local`;
  createdTenants.push(tenantId);

  await admin.query(
    `INSERT INTO org.tenants
       (id, tenant_code, display_name, status, default_locale, default_timezone, created_by,
        created_at)
     VALUES ($1, $2, 'P1-31 export fixture proof', 'active', 'en', 'Asia/Amman', $3,
             now() - make_interval(hours => $4))`,
    [tenantId, tenantCode, SYSTEM_ACTOR, tenantAgeHours]
  );
  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, status, created_by)
     VALUES ($1, $2, 'main', 'Export fixture proof company', 'JOD', 'active', $3)`,
    [companyId, tenantId, SYSTEM_ACTOR]
  );
  for (const [id, code] of [
    [branchId, 'granted'],
    [siblingBranchId, 'sibling'],
  ]) {
    await admin.query(
      `INSERT INTO org.branches
         (id, tenant_id, company_id, branch_code, name, timezone_name, status, created_by)
       VALUES ($1, $2, $3, $4, 'Export fixture proof branch', 'Asia/Amman', 'active', $5)`,
      [id, tenantId, companyId, code, SYSTEM_ACTOR]
    );
  }

  const principals: Principal[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    principals.push({
      attempt,
      id: randomUUID(),
      email: fixturePrincipalAddress(stamp, attempt) as string,
    });
  }
  for (const account of [
    ...principals.map((principal) => ({ id: principal.id, email: principal.email })),
    { id: operatorId, email: operatorEmail },
  ]) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status,
          created_by, created_at)
       VALUES ($1, $2, 'test_harness', $3, $4, 'Export fixture proof identity', 'active',
               $5, now() - make_interval(hours => $6))`,
      [account.id, tenantId, account.id, account.email, SYSTEM_ACTOR, accountAgeHours]
    );
  }
  if (authority) {
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, 'platform.organization.provision', $2, $2)`,
      [operatorId, SYSTEM_ACTOR]
    );
  }

  return {
    stamp,
    tenantId,
    tenantCode,
    companyId,
    branchId,
    siblingBranchId,
    operatorId,
    operatorEmail,
    principals,
  };
}

/**
 * The writer's own input, built by the writer's own parser.
 *
 * `readFixtureInput` is not bypassed: the address and the role code are DERIVED there from the
 * stamp and the attempt, so a case that changes an identifier changes what was supplied and not
 * what the tool decided to install for.
 */
function inputFor(
  world: World,
  options: {
    readonly attempt?: number;
    readonly dryRun?: boolean;
    readonly evidence?: string;
    readonly tenantId?: string;
    readonly userId?: string;
    readonly companyId?: string;
    readonly branchId?: string;
    readonly operatorEmail?: string;
  } = {}
): unknown {
  const attempt = options.attempt ?? 1;
  const principal = world.principals.find((candidate) => candidate.attempt === attempt);
  if (principal === undefined) {
    throw new Error(`the world carries no principal for attempt ${String(attempt)}`);
  }
  const operator = options.operatorEmail ?? world.operatorEmail;
  const argv = [
    '--confirm',
    operator,
    '--stamp',
    world.stamp,
    '--tenant',
    options.tenantId ?? world.tenantId,
    '--principal',
    principal.email,
    '--user',
    options.userId ?? principal.id,
    '--company',
    options.companyId ?? world.companyId,
    '--branch',
    options.branchId ?? world.branchId,
    '--attempt',
    String(attempt),
    '--evidence',
    options.evidence ?? evidencePath('run'),
  ];
  if (options.dryRun === true) argv.push('--dry-run');
  return readFixtureInput(
    {
      ROOTLCO_ENV: 'local-acceptance',
      ROOTLCO_ACCEPTANCE_CONFIRM: 'p1-31',
      EXPORT_FIXTURE_OPERATOR_EMAIL: operator,
    },
    argv
  );
}

/** The real writer, on a privileged connection, with only the target guard substituted. */
async function install(input: unknown): Promise<Record<string, unknown>> {
  const client = await writer.connect();
  try {
    return (await installExportFixture(client, input, { assertTarget })) as Record<string, unknown>;
  } finally {
    // Destroy rather than return to the pool: the advisory lease is session-scoped, so a
    // discarded connection cannot carry one into the next case even if a release failed.
    client.release(true);
  }
}

/** The refusal and its exit code, read through the same function the command exits with. */
async function refusalOf(input: unknown): Promise<Refusal> {
  try {
    await install(input);
  } catch (error) {
    return {
      code: exitCodeFor(error) as number,
      message: String((error as Error).message),
    };
  }
  throw new Error('the writer was expected to refuse and installed instead');
}

async function counts(tenantId: string): Promise<Counts> {
  const answered = await admin.query(
    `SELECT
       (SELECT count(*)::int FROM iam.roles            WHERE tenant_id = $1) AS roles,
       (SELECT count(*)::int FROM iam.role_permissions WHERE tenant_id = $1) AS permissions,
       (SELECT count(*)::int FROM iam.role_grants      WHERE tenant_id = $1) AS grants,
       (SELECT count(*)::int FROM iam.grant_scopes     WHERE tenant_id = $1) AS scopes,
       (SELECT count(*)::int FROM iam.audit_records    WHERE tenant_id = $1) AS audits,
       (SELECT count(*)::int FROM iam.audit_record_details WHERE tenant_id = $1) AS details`,
    [tenantId]
  );
  const row = answered.rows[0];
  return {
    roles: row.roles as number,
    permissions: row.permissions as number,
    grants: row.grants as number,
    scopes: row.scopes as number,
    audits: row.audits as number,
    details: row.details as number,
  };
}

const NOTHING: Counts = {
  roles: 0,
  permissions: 0,
  grants: 0,
  scopes: 0,
  audits: 0,
  details: 0,
};

/**
 * The REAL resolver, asked on a NOBYPASSRLS `app_runtime` connection.
 *
 * Deliberately not the privileged connection that wrote the rows: a resolver consulted as a
 * superuser answers about a session that does not exist in the product.
 */
async function resolvesExport(world: World, userId: string, branchId: string): Promise<boolean> {
  return withRolledBackTx(runtime, { tenantId: world.tenantId, userId }, async (client) => {
    const answered = await client.query(
      'SELECT iam.has_permission_in_scope($1, $2::uuid, $3::uuid, NULL) AS allowed',
      [EXPORT_CODE, world.companyId, branchId]
    );
    return answered.rows[0].allowed === true;
  });
}

function readEvidence(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('the export fixture writer, against a real database', () => {
  it('runs every statement and leaves nothing behind on a dry run', async () => {
    const world = await makeWorld();
    const path = evidencePath('dry-run');
    expect(await counts(world.tenantId)).toEqual(NOTHING);

    const result = await install(inputFor(world, { dryRun: true, evidence: path }));

    expect(result.outcome).toBe('dry-run');
    // The rehearsal's value is entirely in this statement having run before the rollback:
    // ROLLBACK never fires a deferred constraint, so a rehearsal without it proves nothing
    // about the scope rows. `command` is the tag PostgreSQL itself answered, and the measured
    // tag for `SET CONSTRAINTS ALL IMMEDIATE` is the bare `SET` — not the fuller string a hand
    // written double would guess. This assertion is why the stub in the database-free file
    // carries the measured tag rather than an invented one.
    expect(result.deferredConstraintsForced).toBe(true);
    const forced = result.deferredConstraints as Record<string, unknown>;
    expect(forced.statement).toBe('SET CONSTRAINTS ALL IMMEDIATE');
    expect(forced.command).toBe('SET');
    expect((result.connectionRole as Record<string, unknown>).privileged).toBe(true);
    expect((result.dbTarget as Record<string, unknown>).database).toBe(assertTarget().database);
    expect(result.approvalRef).toBeNull();

    expect(await counts(world.tenantId)).toEqual(NOTHING);

    const evidence = readEvidence(path);
    expect(evidence.status).toBe('dry-run');
    expect(validateExportFixtureResult(evidence.result).missing).toEqual([]);
  });

  it('commits one role, nine mappings, one branch-scoped grant and one chained audit record', async () => {
    const world = await makeWorld();
    const path = evidencePath('applied');

    const result = await install(inputFor(world, { evidence: path }));

    expect(result.outcome).toBe('applied');
    expect(result.roleCode).toBe(fixtureRoleCode(world.stamp, 1));
    expect(await counts(world.tenantId)).toEqual({
      roles: 1,
      permissions: EXPORT_FIXTURE_PERMISSIONS.length,
      grants: 1,
      scopes: 1,
      audits: 1,
      details: 9,
    });

    const mapped = await admin.query(
      `SELECT p.permission_code AS code, rp.effect
         FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.tenant_id = $1 AND rp.role_id = $2
        ORDER BY p.permission_code`,
      [world.tenantId, result.roleId]
    );
    expect(mapped.rows.map((row: { code: string }) => row.code)).toEqual(
      [...(EXPORT_FIXTURE_PERMISSIONS as string[])].sort()
    );
    expect(mapped.rows.every((row: { effect: string }) => row.effect === 'allow')).toBe(true);

    const grant = await admin.query(
      `SELECT g.scope_mode, g.status, g.approval_ref, g.granted_by, g.revoked_at,
              extract(epoch FROM g.valid_to - g.valid_from)::int AS seconds,
              s.scope_type, s.company_id, s.branch_id, s.department_id
         FROM iam.role_grants g
         JOIN iam.grant_scopes s ON s.tenant_id = g.tenant_id AND s.grant_id = g.id
        WHERE g.id = $1`,
      [result.grantId]
    );
    expect(grant.rowCount).toBe(1);
    expect(grant.rows[0]).toMatchObject({
      scope_mode: 'scoped',
      status: 'active',
      approval_ref: null,
      granted_by: SYSTEM_ACTOR,
      revoked_at: null,
      seconds: 7200,
      scope_type: 'branch',
      company_id: world.companyId,
      branch_id: world.branchId,
      department_id: null,
    });

    const audit = await admin.query(
      `SELECT action, entity_type, entity_id, actor_id, actor_kind, company_id, branch_id, seq
         FROM iam.audit_records WHERE tenant_id = $1`,
      [world.tenantId]
    );
    expect(audit.rows[0]).toMatchObject({
      action: 'iam.grant.issued',
      entity_type: 'iam.role_grant',
      entity_id: result.grantId,
      actor_id: SYSTEM_ACTOR,
      actor_kind: 'system',
      company_id: world.companyId,
      branch_id: world.branchId,
      seq: '1',
    });

    const details = await admin.query(
      `SELECT field_name, new_value_masked AS value, value_classification AS class
         FROM iam.audit_record_details WHERE tenant_id = $1 ORDER BY field_name`,
      [world.tenantId]
    );
    const byField = new Map(
      details.rows.map((row: { field_name: string; value: string; class: string }) => [
        row.field_name,
        row,
      ])
    );
    expect(byField.get('attempt')).toMatchObject({ value: '1', class: 'public' });
    expect(byField.get('scope')).toMatchObject({ value: 'branch', class: 'public' });
    expect(byField.get('role_code')).toMatchObject({ value: fixtureRoleCode(world.stamp, 1) });
    expect(byField.get('permission_codes_granted')).toMatchObject({
      value: [...(EXPORT_FIXTURE_PERMISSIONS as string[])].sort().join(','),
    });
    expect(byField.get('grantee_account_id')).toMatchObject({ class: 'internal' });
    expect(byField.get('operator_account_id')).toMatchObject({
      value: world.operatorId,
      class: 'internal',
    });

    // The audit subsystem's own chain verification, not a re-implementation of it here: a row
    // appended outside `iam.audit_append` would show up as an orphan record.
    const chain = await admin.query('SELECT iam.audit_verify_chain($1) AS state', [world.tenantId]);
    expect(chain.rows[0].state).toMatchObject({ ok: true, verified_through: 1 });

    const evidence = readEvidence(path);
    expect(evidence.status).toBe('applied');
    expect(validateExportFixtureResult(evidence.result).missing).toEqual([]);
  });

  it('resolves the granted branch and refuses a sibling branch and an elapsed grant', async () => {
    const world = await makeWorld();
    const principal = world.principals[0];
    if (principal === undefined) throw new Error('the world carries no principal');

    const result = await install(inputFor(world));

    // The scope is what binds: same company, two branches, one grant.
    expect(await resolvesExport(world, principal.id, world.branchId)).toBe(true);
    expect(await resolvesExport(world, world.operatorId, world.branchId)).toBe(false);
    expect(await resolvesExport(world, principal.id, world.siblingBranchId)).toBe(false);

    // The grant's own window is shortened deliberately. This is NOT a claim that two hours
    // elapsed; it is the resolver being asked about a grant whose valid_to has passed.
    await admin.query(
      `UPDATE iam.role_grants SET valid_to = valid_from + interval '1 millisecond' WHERE id = $1`,
      [result.grantId]
    );
    expect(await resolvesExport(world, principal.id, world.branchId)).toBe(false);
  });

  it('fires the deferred scope constraint at the forced statement, not at the commit', async () => {
    /*
     * The writer's claim under test is the ORDERING, not the scope row it always writes: `SET
     * CONSTRAINTS ALL IMMEDIATE` runs after the last write and before either ending, so the
     * deferred triggers are answered a statement earlier than the commit would have answered
     * them. That is only checkable with a negative, and the writer has no seam that would omit
     * its own scope row, so the two halves below issue the writer's statements by hand — the
     * same inserts, on the same kind of connection, with the scope row left out.
     *
     * Half one: the violation arrives AT the forced statement and the transaction is still
     * open afterwards, which is why the following statement is refused as aborted (25P02)
     * rather than as no transaction at all. Half two is the control: without the forced
     * statement the identical writes survive to `COMMIT` and the commit is what fails, which
     * is what makes the constraint genuinely deferred and half one a real reordering.
     *
     * ## The falsifiability control, and what this suite does and does not carry
     *
     * That the negative BREAKS when the scope row is added back was taken once by hand, in a
     * scratch copy of this file that was never committed, and it is NOT carried by the suite.
     * Saying so is the honest reading: this case proves the ordering and the source of the
     * refusal, and the statement "it would pass with the scope row" rests on a measurement no
     * reader of this repository can re-take from what is here. Adding it as a committed case
     * would mean committing a scoped grant and its scope row by hand for no other purpose, and
     * that is a change to be taken with the database in front of the author rather than
     * written blind.
     */
    const world = await makeWorld();
    const principal = world.principals[0];
    if (principal === undefined) throw new Error('the world carries no principal');
    const client = await writer.connect();

    /**
     * The refusal, identified by more than its SQLSTATE.
     *
     * `23514` is `check_violation` in general: any CHECK over any row this hand-issued
     * transaction writes would answer it, and `expectSqlState` returns the code and discards
     * the error — so asserting the code alone would be satisfied by an unrelated violation
     * raised in the same transaction, which is not what this case claims to have observed.
     *
     * The two TRIGGER names — `tg_role_grants_require_scope` and
     * `tg_grant_scopes_require_scope`
     * (`supabase/migrations/20260718092000_iam_role_grants_and_scopes.sql:205-215`) — are not
     * carried by the error: `RAISE EXCEPTION … USING ERRCODE` leaves the `constraint` field
     * unset, and PostgreSQL does not name the firing trigger in a PL/pgSQL error. What it does
     * carry is the FUNCTION both of those triggers execute — `iam.enforce_scoped_grant_has_scope`,
     * in the PL/pgSQL context line — and that function's own message, which names the offending
     * grant. Both are asserted, so the refusal is pinned to this constraint and to this row.
     */
    const expectScopeRefusal = async (
      promise: Promise<unknown>,
      grantId: string
    ): Promise<void> => {
      try {
        await promise;
      } catch (thrown) {
        const error = thrown as { code?: string; message?: string; where?: string };
        expect(error.code).toBe('23514');
        expect(error.message).toBe(`scoped active grant ${grantId} must have at least one scope`);
        expect(
          error.where ?? '(no PL/pgSQL context)',
          'a check violation was raised, but not by the deferred scope trigger'
        ).toContain('enforce_scoped_grant_has_scope');
        return;
      }
      throw new Error('the statement succeeded: the deferred scope constraint did not fire at all');
    };

    const scopelessGrant = async (roleCode: string): Promise<string> => {
      const roleId = randomUUID();
      const grantId = randomUUID();
      await client.query("SELECT set_config('app.user_id', $1, true)", [SYSTEM_ACTOR]);
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [world.tenantId]);
      await client.query(
        `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
         VALUES ($1, $2, $3, 'Export fixture proof negative', $4)`,
        [roleId, world.tenantId, roleCode, SYSTEM_ACTOR]
      );
      await client.query(
        `INSERT INTO iam.role_grants
           (id, tenant_id, user_id, role_id, scope_mode, valid_to, granted_by, created_by)
         VALUES ($1, $2, $3, $4, 'scoped', now() + interval '2 hours', $5, $5)`,
        [grantId, world.tenantId, principal.id, roleId, SYSTEM_ACTOR]
      );
      return grantId;
    };

    try {
      await client.query('BEGIN');
      const forced = await scopelessGrant(`${fixtureRoleCode(world.stamp, 2)}_negative`);
      // The insert itself is accepted: the constraint is DEFERRED, so nothing has complained yet.
      const open = await client.query('SELECT count(*)::int AS grants FROM iam.role_grants');
      expect(open.rows[0].grants).toBeGreaterThan(0);

      await expectScopeRefusal(client.query('SET CONSTRAINTS ALL IMMEDIATE'), forced);
      // Still inside the transaction, now aborted — the failure was not at a commit.
      await expectSqlState(client.query('SELECT 1'), '25P02');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      const committed = await scopelessGrant(`${fixtureRoleCode(world.stamp, 3)}_negative`);
      await expectScopeRefusal(client.query('COMMIT'), committed);
    } finally {
      try {
        await client.query('ROLLBACK');
      } catch {
        // A failed COMMIT already ended the transaction; the connection is discarded anyway.
      }
      client.release(true);
    }

    expect(await counts(world.tenantId)).toEqual(NOTHING);
  });

  it('refuses a connection that is neither superuser nor BYPASSRLS, and writes nothing', async () => {
    const world = await makeWorld();
    const path = evidencePath('unprivileged');
    const client = await runtime.connect();
    let refusal: Refusal | undefined;
    try {
      await installExportFixture(client, inputFor(world, { evidence: path }), { assertTarget });
    } catch (error) {
      refusal = { code: exitCodeFor(error) as number, message: String((error as Error).message) };
    } finally {
      client.release(true);
    }

    expect(refusal?.code).toBe(10);
    expect(refusal?.message).toContain(RUNTIME_ROLE);
    expect(await counts(world.tenantId)).toEqual(NOTHING);
    // The precondition runs BEFORE the reservation, so there is no residue to clear.
    expect(existsSync(path)).toBe(false);
  });

  it('refuses a contended lease before it reserves anything or writes anything', async () => {
    const world = await makeWorld();
    const path = evidencePath('lease');
    const held = await admin.connect();
    let refusal: Refusal;
    try {
      await acquireDatabaseLease(held, 'p1-31 export fixture database proof');
      refusal = await refusalOf(inputFor(world, { evidence: path }));
    } finally {
      await held.query('SELECT pg_advisory_unlock_all()');
      held.release(true);
    }

    expect(refusal.code).toBe(9);
    expect(await counts(world.tenantId)).toEqual(NOTHING);
    // A refusal before the reservation leaves NO file, so the same attempt number is re-runnable.
    expect(existsSync(path)).toBe(false);
  });

  it('refuses an evidence path another attempt owns, before any database mutation', async () => {
    const world = await makeWorld();
    const path = evidencePath('taken');
    writeFileSync(path, '{"owner":"an earlier attempt"}\n', { encoding: 'utf8' });

    const refusal = await refusalOf(inputFor(world, { evidence: path }));

    expect(refusal.code).toBe(8);
    expect(await counts(world.tenantId)).toEqual(NOTHING);
    // The earlier attempt's record is left exactly as it was — the reservation is `wx`.
    expect(readFileSync(path, 'utf8')).toBe('{"owner":"an earlier attempt"}\n');
  });

  it('refuses a duplicate live fixture and finalizes its reserved record as refused', async () => {
    const world = await makeWorld();
    await install(inputFor(world));
    const after = await counts(world.tenantId);

    const path = evidencePath('duplicate');
    const refusal = await refusalOf(inputFor(world, { evidence: path }));

    expect(refusal.code).toBe(6);
    // Nothing further: no second role, no second grant, no second audit record.
    expect(await counts(world.tenantId)).toEqual(after);

    // This refusal is raised INSIDE the transaction, which is after the reservation, so the
    // file exists and says what happened instead of sitting at `pending`.
    const evidence = readEvidence(path);
    expect(evidence.status).toBe('refused');
    expect(evidence.result).toBeNull();
    expect(evidence.refusal).toMatchObject({ exitCode: 6, kind: 'FixtureRefused' });
  });

  it('refuses an operator who holds no platform authority, and writes nothing', async () => {
    const world = await makeWorld({ authority: false });
    const refusal = await refusalOf(inputFor(world));

    expect(refusal.code).toBe(4);
    expect(refusal.message).toContain('platform.organization.provision');
    expect(await counts(world.tenantId)).toEqual(NOTHING);
  });

  it('refuses a stale organisation and a stale account separately, and writes nothing', async () => {
    const staleTenant = await makeWorld({ tenantAgeHours: 3 });
    const staleAccount = await makeWorld({ accountAgeHours: 3 });

    const tenantRefusal = await refusalOf(inputFor(staleTenant));
    const accountRefusal = await refusalOf(inputFor(staleAccount));

    expect(tenantRefusal.code).toBe(3);
    expect(accountRefusal.code).toBe(3);
    // Same exit code, different sentence — which is the whole reason the writer asks in four
    // statements instead of one.
    expect(tenantRefusal.message).toContain(staleTenant.tenantCode);
    expect(tenantRefusal.message).toContain('no organisation');
    const stalePrincipal = staleAccount.principals[0];
    if (stalePrincipal === undefined) throw new Error('the world carries no principal');
    expect(accountRefusal.message).toContain(stalePrincipal.email);
    expect(accountRefusal.message).not.toContain('no organisation');

    expect(await counts(staleTenant.tenantId)).toEqual(NOTHING);
    expect(await counts(staleAccount.tenantId)).toEqual(NOTHING);
  });

  it('refuses another organisation, account, company or branch instead of granting from the identifiers', async () => {
    const world = await makeWorld();
    const other = await makeWorld();
    const otherPrincipal = other.principals[0];
    if (otherPrincipal === undefined) throw new Error('the world carries no principal');

    for (const supplied of [
      { tenantId: other.tenantId },
      { userId: otherPrincipal.id },
      { companyId: other.companyId },
      { branchId: other.branchId },
    ]) {
      expect((await refusalOf(inputFor(world, supplied))).code).toBe(3);
    }

    expect(await counts(world.tenantId)).toEqual(NOTHING);
    expect(await counts(other.tenantId)).toEqual(NOTHING);
  });

  it('installs attempts one to three under distinct principals and role codes, and refuses a fourth', async () => {
    const world = await makeWorld({ attempts: MAX_FIXTURE_ATTEMPT as number });

    const installed: Record<string, unknown>[] = [];
    for (let attempt = 1; attempt <= (MAX_FIXTURE_ATTEMPT as number); attempt += 1) {
      installed.push(await install(inputFor(world, { attempt })));
    }

    expect(installed.map((result) => result.attempt)).toEqual([1, 2, 3]);
    expect(installed.map((result) => result.attemptBound)).toEqual([3, 3, 3]);
    expect(new Set(installed.map((result) => result.roleId)).size).toBe(3);
    expect(installed.map((result) => result.roleCode)).toEqual([
      fixtureRoleCode(world.stamp, 1),
      fixtureRoleCode(world.stamp, 2),
      fixtureRoleCode(world.stamp, 3),
    ]);
    expect(installed.map((result) => result.principal)).toEqual([
      fixturePrincipalAddress(world.stamp, 1),
      fixturePrincipalAddress(world.stamp, 2),
      fixturePrincipalAddress(world.stamp, 3),
    ]);
    expect(await counts(world.tenantId)).toEqual({
      roles: 3,
      permissions: EXPORT_FIXTURE_PERMISSIONS.length * 3,
      grants: 3,
      scopes: 3,
      audits: 3,
      details: 27,
    });

    // The fourth is refused by the parser, before anything connects, with its own exit code.
    const beyond = (MAX_FIXTURE_ATTEMPT as number) + 1;
    let code: number | undefined;
    try {
      readFixtureInput(
        {
          ROOTLCO_ENV: 'local-acceptance',
          ROOTLCO_ACCEPTANCE_CONFIRM: 'p1-31',
          EXPORT_FIXTURE_OPERATOR_EMAIL: world.operatorEmail,
        },
        [
          '--confirm',
          world.operatorEmail,
          '--stamp',
          world.stamp,
          '--tenant',
          world.tenantId,
          '--principal',
          fixturePrincipalAddress(world.stamp, beyond) as string,
          '--user',
          randomUUID(),
          '--company',
          world.companyId,
          '--branch',
          world.branchId,
          '--attempt',
          String(beyond),
        ]
      );
    } catch (error) {
      code = exitCodeFor(error) as number;
    }
    expect(code).toBe(7);
    expect((await counts(world.tenantId)).grants).toBe(3);
  });
});
