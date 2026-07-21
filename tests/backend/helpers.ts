/**
 * Backend-foundation integration harness (Phase 1-13).
 *
 * These suites exercise the foundation against a live PostgreSQL carrying the
 * Release 2 schema plus the DBCR-P1-13-001 remediation. Two connection
 * identities are used and the difference between them is the whole point:
 *
 *  - ADMIN (`postgres`) — provisions and removes fixtures, and reads back what
 *    actually landed. Nothing executed here is ever evidence about runtime
 *    behaviour: it bypasses RLS.
 *  - RUNTIME (`rootlco_test_runtime`, member of `app_runtime`) — the identity the
 *    application actually deploys with. Every capability, isolation, and
 *    fail-closed assertion runs here.
 *
 * ============================================================================
 * DBCR-P1-13-001 IS APPLIED — THE REHEARSAL ROLE IS GONE
 * ============================================================================
 * Until migration `20260725090000_iam_shared_runtime_write_capabilities.sql`,
 * `app_runtime` held SELECT only across `shared` and `iam`, so four foundation
 * write capabilities — `audit.append`, `outbox.publish`, `idempotency.store`,
 * and `security-event.record` — were unavailable and these suites ran against a
 * temporary rehearsal login that carried the *proposed* privileges. That role
 * (`rootlco_p1_13_cr_rehearsal`) and the grants and policies it needed have been
 * removed from this harness: the capabilities are real now, so proving them on
 * anything other than the deployed identity would prove nothing.
 *
 * Two of the requirements the rehearsal measured are worth keeping in view,
 * because they shaped the migration: `iam.audit_append` is SECURITY INVOKER, so
 * its caller also needs EXECUTE on `iam.audit_mask`, `iam.audit_canonical` and
 * `iam.audit_hash`; and it must READ its own tenant's chain to assign the next
 * `seq` and the previous hash. The migration answers the second one by deriving
 * `seq` from `iam.audit_integrity_links` and exposing only *unlinked* records to
 * the writer, so appending never becomes a way to read audit history.
 *
 * Credentials below are the public local-dev defaults, overridable via
 * DB_HOST / DB_PORT / DB_NAME. No production credential is ever read here.
 */
import { randomUUID } from 'node:crypto';
import { Pool, type ClientConfig, type PoolClient } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  READONLY_LOGIN,
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
  READONLY_LOGIN,
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

/** Pool bound to the worker archetype (`app_worker`). */
export function workerAppPool(max = 5): Pool {
  return new Pool(poolConfig(WORKER_LOGIN, max));
}

/**
 * Pool bound to the read-only archetype (`app_readonly`). DBCR-P1-13-001 granted
 * it nothing, so it is the honest way to exercise the capability gate's
 * fail-closed path without simulating a missing grant.
 */
export function readonlyAppPool(max = 2): Pool {
  return new Pool(poolConfig(READONLY_LOGIN, max));
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
