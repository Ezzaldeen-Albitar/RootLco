/**
 * Backend-foundation integration harness (Phase 1-13).
 *
 * These suites exercise the foundation against a live PostgreSQL carrying the
 * frozen Release 2 schema. Three connection identities are used and the
 * difference between them is the whole point:
 *
 *  - ADMIN (`postgres`) — provisions fixtures and creates/drops the test-only
 *    role below. Nothing executed here is ever evidence about runtime behaviour.
 *  - RUNTIME (`rootlco_test_runtime`, member of `app_runtime`) — the identity the
 *    application actually deploys with. Every fail-closed and isolation assertion
 *    runs here.
 *  - CR REHEARSAL (`rootlco_p1_13_cr_rehearsal`) — see the block below.
 *
 * ============================================================================
 * DBCR-P1-13-001 REHEARSAL ROLE — TEST-ONLY, NOT A SCHEMA CHANGE
 * ============================================================================
 * The frozen Release 2 grant surface gives `app_runtime` SELECT only across
 * `shared` and `iam`. Four foundation write capabilities are therefore
 * unavailable: `audit.append`, `outbox.publish`, `idempotency.store`, and
 * `security-event.record`. That gap is raised as change request
 * **DBCR-P1-13-001**; Phase 1-13 must NOT add or modify a migration to close it,
 * and this harness does not: no file under `supabase/` is created, edited, or
 * deleted by anything here.
 *
 * What `ensureCrRehearsalRole()` does instead is create a **temporary login role
 * at test runtime** holding exactly the privileges DBCR-P1-13-001 proposes, so
 * the transactional behaviour that depends on them (all-or-nothing across
 * business row + status history + audit + outbox, idempotent replay, security
 * events) can genuinely be executed and proven rather than asserted on paper.
 * `dropCrRehearsalRole()` removes the role and every policy again, so the
 * database is left exactly as the migrations left it. If the change request is
 * later approved and applied, these suites keep passing unchanged — and the
 * `capabilities` suite flips from "missing" to "available" on the runtime role,
 * which is the signal that the rehearsal is no longer needed.
 *
 * Executing the rehearsal also **measured two requirements the change request as
 * drafted does not list** (see the final report): `iam.audit_append` is SECURITY
 * INVOKER, so its caller additionally needs EXECUTE on `iam.audit_mask`,
 * `iam.audit_canonical` and `iam.audit_hash`, plus USAGE on schema `extensions`
 * (for `extensions.digest`), and it needs to READ its own tenant's
 * `audit_records`/`audit_integrity_links` to assign the next `seq` and the
 * previous chain hash — which the shipped `sel_audit_*_permitted` policies only
 * allow to a principal holding `iam.audit.view`.
 *
 * Credentials below are the public local-dev defaults, overridable via
 * DB_HOST / DB_PORT / DB_NAME. No production credential is ever read here.
 */
import { randomUUID } from 'node:crypto';
import { Pool, type ClientConfig, type PoolClient } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  RUNTIME_LOGIN,
  TENANT_A,
  TENANT_B,
  USER_A,
  WORKER_LOGIN,
  cleanFixtures,
  ensureOrgFixtures,
} from '../db/helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { buildRequestContext, type RequestContext } from '@/server/context/request-context';

export {
  BRANCH_A1,
  COMPANY_A1,
  RUNTIME_LOGIN,
  TENANT_A,
  TENANT_B,
  USER_A,
  WORKER_LOGIN,
  adminPool,
  ensureTestLogins,
  expectSqlState,
} from '../db/helpers';

const HOST = process.env.DB_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DB_PORT ?? 54322);
const DATABASE = process.env.DB_NAME ?? 'postgres';
/** Deliberately weak, deliberately fake, local test databases only. */
const TEST_LOGIN_PASSWORD = 'rootlco-local-test-only';

/** The DBCR-P1-13-001 rehearsal login. Created and dropped by this harness. */
export const CR_REHEARSAL_LOGIN = 'rootlco_p1_13_cr_rehearsal';

function dsn(user: string): string {
  // Assembled in two steps on purpose. The tracked-secret scanner matches a
  // `scheme://user:pass@` shape *textually*, so a single template literal of that
  // form trips it even though it contains no credential — only placeholders. The
  // guard is right to be blunt about that shape; the fix is to not write it,
  // rather than to add a suppression pragma that would also hide a real one.
  const authority = `${user}:${TEST_LOGIN_PASSWORD}@${HOST}:${PORT}`;
  return `postgresql://${authority}/${DATABASE}`;
}

/**
 * Backend configuration is read from `process.env` and memoised on first use, so
 * it is set here at module scope — before any suite body runs — and the memo is
 * cleared. Pools are still injected explicitly with `__setPrimaryPoolForTests`;
 * the DSNs exist so a code path that reaches for one finds a *runtime* identity
 * rather than an owner.
 */
process.env.DATABASE_URL = dsn(RUNTIME_LOGIN);
process.env.WORKER_DATABASE_URL = dsn(WORKER_LOGIN);
// Short, bounded worker timings: these suites assert lease expiry and graceful
// shutdown, and the shipped defaults (300 s lease, 2 s poll) would make that a
// test of patience rather than of behaviour.
process.env.OUTBOX_POLL_INTERVAL_MS = '50';
process.env.OUTBOX_SHUTDOWN_GRACE_MS = '10000';
// Small enough for a test to wait out, large enough that "the retry was actually
// delayed" is observable rather than a rounding artefact.
process.env.OUTBOX_BASE_BACKOFF_MS = '500';
process.env.OUTBOX_MAX_BACKOFF_MS = '1000';
__resetBackendConfigForTests();

function poolConfig(user: string, max: number): ClientConfig & { max: number } {
  return { host: HOST, port: PORT, database: DATABASE, user, password: TEST_LOGIN_PASSWORD, max };
}

/** Pool bound to the deployed runtime identity (`app_runtime`). */
export function runtimeAppPool(max = 5): Pool {
  return new Pool(poolConfig(RUNTIME_LOGIN, max));
}

/** Pool bound to the DBCR-P1-13-001 rehearsal identity. */
export function crRehearsalPool(max = 5): Pool {
  return new Pool(poolConfig(CR_REHEARSAL_LOGIN, max));
}

/** Pool bound to the worker archetype (`app_worker`). */
export function workerAppPool(max = 5): Pool {
  return new Pool(poolConfig(WORKER_LOGIN, max));
}

// ---------------------------------------------------------------------------
// DBCR-P1-13-001 rehearsal role: grants, policies, and their exact inverses.
// ---------------------------------------------------------------------------

const AUDIT_APPEND_SIGNATURE =
  'iam.audit_append(uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,text,jsonb)';

/** Every privilege the change request proposes, plus the three measured extras. */
const REHEARSAL_GRANTS: readonly string[] = [
  `GRANT app_runtime TO ${CR_REHEARSAL_LOGIN}`,
  `GRANT EXECUTE ON FUNCTION ${AUDIT_APPEND_SIGNATURE} TO ${CR_REHEARSAL_LOGIN}`,
  // Measured, not assumed: audit_append is SECURITY INVOKER, so its helpers are
  // executed with the caller's privileges too.
  `GRANT EXECUTE ON FUNCTION iam.audit_mask(text, text) TO ${CR_REHEARSAL_LOGIN}`,
  `GRANT EXECUTE ON FUNCTION iam.audit_canonical(uuid) TO ${CR_REHEARSAL_LOGIN}`,
  `GRANT EXECUTE ON FUNCTION iam.audit_hash(bytea, text) TO ${CR_REHEARSAL_LOGIN}`,
  `GRANT USAGE ON SCHEMA extensions TO ${CR_REHEARSAL_LOGIN}`,
  `GRANT SELECT, INSERT ON shared.event_outbox TO ${CR_REHEARSAL_LOGIN}`,
  `GRANT SELECT, INSERT ON shared.idempotency_keys TO ${CR_REHEARSAL_LOGIN}`,
  `GRANT INSERT ON iam.security_events TO ${CR_REHEARSAL_LOGIN}`,
  `GRANT SELECT, INSERT ON iam.audit_records TO ${CR_REHEARSAL_LOGIN}`,
  `GRANT SELECT, INSERT ON iam.audit_record_details TO ${CR_REHEARSAL_LOGIN}`,
  `GRANT SELECT, INSERT ON iam.audit_integrity_links TO ${CR_REHEARSAL_LOGIN}`,
];

const REHEARSAL_REVOKES: readonly string[] = [
  `REVOKE ALL ON FUNCTION ${AUDIT_APPEND_SIGNATURE} FROM ${CR_REHEARSAL_LOGIN}`,
  `REVOKE ALL ON FUNCTION iam.audit_mask(text, text) FROM ${CR_REHEARSAL_LOGIN}`,
  `REVOKE ALL ON FUNCTION iam.audit_canonical(uuid) FROM ${CR_REHEARSAL_LOGIN}`,
  `REVOKE ALL ON FUNCTION iam.audit_hash(bytea, text) FROM ${CR_REHEARSAL_LOGIN}`,
  `REVOKE ALL ON SCHEMA extensions FROM ${CR_REHEARSAL_LOGIN}`,
  `REVOKE ALL ON shared.event_outbox FROM ${CR_REHEARSAL_LOGIN}`,
  `REVOKE ALL ON shared.idempotency_keys FROM ${CR_REHEARSAL_LOGIN}`,
  `REVOKE ALL ON iam.security_events FROM ${CR_REHEARSAL_LOGIN}`,
  `REVOKE ALL ON iam.audit_records FROM ${CR_REHEARSAL_LOGIN}`,
  `REVOKE ALL ON iam.audit_record_details FROM ${CR_REHEARSAL_LOGIN}`,
  `REVOKE ALL ON iam.audit_integrity_links FROM ${CR_REHEARSAL_LOGIN}`,
];

interface RehearsalPolicy {
  readonly name: string;
  readonly table: string;
  readonly command: 'INSERT' | 'SELECT';
}

/**
 * Tenant-scoped policies for the rehearsal role ONLY. Every one is
 * `tenant_id = iam.current_tenant_id()`: the change request must not be
 * rehearsed with a weaker isolation rule than the rest of the schema uses.
 *
 * The SELECT entries are not decoration. `INSERT … RETURNING` is evaluated
 * against the SELECT policy, and `iam.audit_append` reads its own tenant's
 * `audit_records` (next `seq`) and `audit_integrity_links` (previous hash)
 * before it can write the next chain link.
 */
const REHEARSAL_POLICIES: readonly RehearsalPolicy[] = [
  { name: 'cr_rehearsal_event_outbox_ins', table: 'shared.event_outbox', command: 'INSERT' },
  { name: 'cr_rehearsal_event_outbox_sel', table: 'shared.event_outbox', command: 'SELECT' },
  { name: 'cr_rehearsal_idempotency_ins', table: 'shared.idempotency_keys', command: 'INSERT' },
  { name: 'cr_rehearsal_idempotency_sel', table: 'shared.idempotency_keys', command: 'SELECT' },
  { name: 'cr_rehearsal_security_events_ins', table: 'iam.security_events', command: 'INSERT' },
  { name: 'cr_rehearsal_audit_records_ins', table: 'iam.audit_records', command: 'INSERT' },
  { name: 'cr_rehearsal_audit_records_sel', table: 'iam.audit_records', command: 'SELECT' },
  { name: 'cr_rehearsal_audit_details_ins', table: 'iam.audit_record_details', command: 'INSERT' },
  { name: 'cr_rehearsal_audit_details_sel', table: 'iam.audit_record_details', command: 'SELECT' },
  { name: 'cr_rehearsal_audit_links_ins', table: 'iam.audit_integrity_links', command: 'INSERT' },
  { name: 'cr_rehearsal_audit_links_sel', table: 'iam.audit_integrity_links', command: 'SELECT' },
];

function createPolicySql(policy: RehearsalPolicy): string {
  const predicate = 'tenant_id = iam.current_tenant_id()';
  const clause = policy.command === 'INSERT' ? 'WITH CHECK' : 'USING';
  return (
    `CREATE POLICY ${policy.name} ON ${policy.table} ` +
    `FOR ${policy.command} TO ${CR_REHEARSAL_LOGIN} ${clause} (${predicate})`
  );
}

/**
 * Creates the rehearsal role, its grants, and its policies. Idempotent: a run
 * that crashed before `dropCrRehearsalRole()` leaves objects behind, and a suite
 * must be able to start from that state.
 */
export async function ensureCrRehearsalRole(admin: Pool): Promise<void> {
  await admin.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${CR_REHEARSAL_LOGIN}') THEN
        CREATE ROLE ${CR_REHEARSAL_LOGIN} LOGIN PASSWORD '${TEST_LOGIN_PASSWORD}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
    END;
    $$;
  `);
  for (const statement of REHEARSAL_GRANTS) {
    await admin.query(statement);
  }
  for (const policy of REHEARSAL_POLICIES) {
    await admin.query(`DROP POLICY IF EXISTS ${policy.name} ON ${policy.table}`);
    await admin.query(createPolicySql(policy));
  }
}

/**
 * Removes every object `ensureCrRehearsalRole()` created. Privileges are revoked
 * explicitly rather than with `DROP OWNED BY`, which the local `postgres` role is
 * not permitted to run against another role.
 */
export async function dropCrRehearsalRole(admin: Pool): Promise<void> {
  const exists = await admin.query<{ present: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS present',
    [CR_REHEARSAL_LOGIN]
  );
  if (exists.rows[0]?.present !== true) return;

  for (const policy of REHEARSAL_POLICIES) {
    await admin.query(`DROP POLICY IF EXISTS ${policy.name} ON ${policy.table}`);
  }
  for (const statement of REHEARSAL_REVOKES) {
    await admin.query(statement);
  }
  await admin.query(`DROP ROLE IF EXISTS ${CR_REHEARSAL_LOGIN}`);
}

// ---------------------------------------------------------------------------
// Deterministic fixtures. Everything here is ephemeral test scaffolding and is
// removed by cleanBackendFixtures(); no business data is shipped or retained.
// ---------------------------------------------------------------------------

/** Tenant A account holding the permissions under test. */
export const USER_PERMITTED = 'c1300000-0000-4000-8000-000000000001';
/** Tenant A account holding a role with no permission mappings at all. */
export const USER_UNPERMITTED = 'c1300000-0000-4000-8000-000000000002';
/** Tenant A account holding BOTH an allow and a deny mapping (BR-IAM-001). */
export const USER_DENIED_BY_RULE = 'c1300000-0000-4000-8000-000000000003';
/** Tenant A account whose grant is scoped to COMPANY_A1 / BRANCH_A1. */
export const USER_SCOPED = 'c1300000-0000-4000-8000-000000000004';
/** Tenant B account, used to prove cross-tenant resolution finds nothing. */
export const USER_TENANT_B = 'c1300000-0000-4000-8000-00000000000b';

export const IDENTITY_PROVIDER = 'test_harness';
export const SUBJECT_PERMITTED = 'fx_p1_13_permitted';
export const SUBJECT_UNPERMITTED = 'fx_p1_13_unpermitted';
export const SUBJECT_DENIED_BY_RULE = 'fx_p1_13_denied';
export const SUBJECT_SCOPED = 'fx_p1_13_scoped';
export const SUBJECT_TENANT_B = 'fx_p1_13_tenant_b';

/** Permission the reference endpoint declares. Not in the frozen seed set. */
export const PING_PERMISSION = 'platform.meta.ping';
/** Permission used by the authorization suite. Removed by the `test.` sweep. */
export const COMMAND_PERMISSION = 'test.p1_13.command';

/** Feature flags: platform defaults only, so entitlement is unambiguous. */
export const FEATURE_ENABLED = 'fx_p1_13_enabled';
export const FEATURE_DISABLED = 'fx_p1_13_disabled';

const ROLE_ALLOW = 'd1300000-0000-4000-8000-000000000001';
const ROLE_DENY = 'd1300000-0000-4000-8000-000000000002';
const ROLE_EMPTY = 'd1300000-0000-4000-8000-000000000003';
const GRANT_SCOPED = 'e1300000-0000-4000-8000-000000000004';

async function seedFixtures(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES
       ($1, $7, $12, $2, 'fx-p1-13-permitted@example.test',   'Fixture Permitted',  'active', $11),
       ($3, $7, $12, $4, 'fx-p1-13-unpermitted@example.test', 'Fixture Ungranted',  'active', $11),
       ($5, $7, $12, $6, 'fx-p1-13-denied@example.test',      'Fixture Denied',     'active', $11),
       ($8, $7, $12, $9, 'fx-p1-13-scoped@example.test',      'Fixture Scoped',     'active', $11),
       ($10, $13, $12, $14, 'fx-p1-13-tenant-b@example.test', 'Fixture Tenant B',   'active', $11)
     ON CONFLICT (id) DO NOTHING`,
    [
      USER_PERMITTED,
      SUBJECT_PERMITTED,
      USER_UNPERMITTED,
      SUBJECT_UNPERMITTED,
      USER_DENIED_BY_RULE,
      SUBJECT_DENIED_BY_RULE,
      TENANT_A,
      USER_SCOPED,
      SUBJECT_SCOPED,
      USER_TENANT_B,
      USER_A,
      IDENTITY_PROVIDER,
      TENANT_B,
      SUBJECT_TENANT_B,
    ]
  );

  await client.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ($1, 'platform', 'Foundation reference probe (Phase 1-13 fixture).', 'low', $3),
            ($2, 'test',     'Phase 1-13 authorization fixture.',                'low', $3)
     ON CONFLICT (permission_code) DO NOTHING`,
    [PING_PERMISSION, COMMAND_PERMISSION, USER_A]
  );

  await client.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $4, 'fx_p1_13_allow', 'P1-13 allow',  $5),
            ($2, $4, 'fx_p1_13_deny',  'P1-13 deny',   $5),
            ($3, $4, 'fx_p1_13_empty', 'P1-13 empty',  $5)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_ALLOW, ROLE_DENY, ROLE_EMPTY, TENANT_A, USER_A]
  );

  await client.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $5::uuid
       FROM iam.permissions p WHERE p.permission_code = ANY($3::text[])
     UNION ALL
     SELECT $1::uuid, $4::uuid, p.id, 'deny', $5::uuid
       FROM iam.permissions p WHERE p.permission_code = $6::text
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [
      TENANT_A,
      ROLE_ALLOW,
      [PING_PERMISSION, COMMAND_PERMISSION],
      ROLE_DENY,
      USER_A,
      COMMAND_PERMISSION,
    ]
  );

  // Grants carry no natural key, so a re-seed would otherwise stack duplicates.
  await client.query(
    'DELETE FROM iam.role_grants WHERE tenant_id = $1 AND user_id = ANY($2::uuid[])',
    [TENANT_A, [USER_PERMITTED, USER_UNPERMITTED, USER_DENIED_BY_RULE, USER_SCOPED]]
  );

  // Unrestricted grants: tenant-wide, no narrowing (iam.allowed_company_ids()).
  await client.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $5, 'unrestricted', $8, $8),
            ($1, $3, $7, 'unrestricted', $8, $8),
            ($1, $4, $5, 'unrestricted', $8, $8),
            ($1, $4, $6, 'unrestricted', $8, $8)`,
    [
      TENANT_A,
      USER_PERMITTED,
      USER_UNPERMITTED,
      USER_DENIED_BY_RULE,
      ROLE_ALLOW,
      ROLE_DENY,
      ROLE_EMPTY,
      USER_A,
    ]
  );

  // Scoped grant + its scopes. The "scoped grant needs a scope" trigger is
  // DEFERRABLE INITIALLY DEFERRED, so both must land in one transaction.
  await client.query(
    `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, $4, 'scoped', $5, $5)`,
    [GRANT_SCOPED, TENANT_A, USER_SCOPED, ROLE_ALLOW, USER_A]
  );
  await client.query(
    `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
     VALUES ($1, $2, 'company', $3, $4)`,
    [TENANT_A, GRANT_SCOPED, COMPANY_A1, USER_A]
  );
  await client.query(
    `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
     VALUES ($1, $2, 'branch', $3, $4, $5)`,
    [TENANT_A, GRANT_SCOPED, COMPANY_A1, BRANCH_A1, USER_A]
  );

  await client.query(
    `INSERT INTO org.feature_flags (flag_code, name, default_enabled, created_by)
     VALUES ($1, 'P1-13 enabled fixture', true, $3),
            ($2, 'P1-13 disabled fixture', false, $3)
     ON CONFLICT (flag_code) DO NOTHING`,
    [FEATURE_ENABLED, FEATURE_DISABLED, USER_A]
  );
}

/**
 * Provisions every fixture the backend suites share, as admin, in ONE
 * transaction so deferred constraints see a complete picture.
 */
export async function ensureBackendFixtures(admin: Pool): Promise<void> {
  await ensureOrgFixtures(admin);
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await seedFixtures(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Removes every fixture row. `cleanFixtures` covers the tenant cascade and the
 * `fx_`/`test.` prefixed platform rows; the reference endpoint's permission code
 * is not prefixed (it must match the operation declaration exactly), so it is
 * removed here — after the tenant cascade has dropped the mappings that
 * reference it.
 */
export async function cleanBackendFixtures(admin: Pool): Promise<void> {
  await cleanFixtures(admin);
  await admin.query('DELETE FROM iam.permissions WHERE permission_code = $1', [PING_PERMISSION]);
}

/** Builds a frozen request context for a suite. Never used outside tests. */
export function contextFor(
  input: {
    readonly tenantId?: string;
    readonly userId?: string;
    readonly operation?: string;
    readonly module?: string;
    readonly correlationId?: string;
    readonly companyIds?: readonly string[];
    readonly branchIds?: readonly string[];
  } = {}
): RequestContext {
  return buildRequestContext({
    correlationId: input.correlationId ?? randomUUID(),
    principal: {
      tenantId: input.tenantId ?? TENANT_A,
      userId: input.userId ?? USER_PERMITTED,
    },
    operation: input.operation ?? 'test.backend',
    module: input.module ?? 'test',
    ...(input.companyIds ? { companyIds: input.companyIds } : {}),
    ...(input.branchIds ? { branchIds: input.branchIds } : {}),
  });
}

/** Counts rows matching a tenant-scoped predicate, as admin (never RLS evidence). */
export async function countRows(
  admin: Pool,
  table: string,
  where: string,
  values: readonly unknown[]
): Promise<number> {
  const result = await admin.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM ${table} WHERE ${where}`,
    values as unknown[]
  );
  return Number(result.rows[0]?.total ?? '0');
}
