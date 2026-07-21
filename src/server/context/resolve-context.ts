/**
 * Server-side scope resolution (P1-13-BE-004, P1-13-SEC-002, FR-IAM-002).
 *
 * The rule this file exists to enforce: **client-supplied scope never reaches
 * `set_config`.** A request may *mention* a company or branch — as a filter, as
 * a path parameter — but that value is treated as a claim to be checked against
 * the resolved scope, never as the scope itself. `resolveRequestScope()` reads
 * the caller's actual grants from `iam.role_grants` / `iam.grant_scopes` and
 * returns them; `narrowScope()` intersects a requested narrowing with what the
 * caller actually holds and rejects anything outside it.
 *
 * Resolution runs in its own short read-only transaction with only
 * `app.tenant_id` set, because that is all `sel_user_accounts_tenant` needs. The
 * claimed tenant is therefore a *lookup key*: the account row must exist inside
 * it with the session's provider subject, active and not deleted. A session that
 * claims another tenant finds nothing and is denied.
 *
 * `scope_mode = 'unrestricted'` on any active grant means tenant-wide: the
 * caller gets no company/branch narrowing, matching `iam.allowed_company_ids()`
 * semantics where an unset list means "tenant scope".
 */
import { AppFailure } from '../errors/app-failure';
import type { PrincipalClaims } from './principal';
import type { DbHandle } from '../db/transaction';
import { withReadOnlyTransaction } from '../db/transaction';
import { buildRequestContext, type RequestContext } from './request-context';

/** The scope a principal actually holds, as measured in the database. */
export interface ResolvedScope {
  readonly userId: string;
  readonly tenantId: string;
  /** Empty when the caller holds an unrestricted grant (tenant-wide). */
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
  /** True when at least one active grant is `unrestricted`. */
  readonly unrestricted: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reads the account and its granted scope. Requires a handle whose context
 * carries the claimed tenant.
 */
export async function resolveScopeFor(
  db: DbHandle,
  claims: PrincipalClaims
): Promise<ResolvedScope | null> {
  const account = await db.query<{ id: string; tenant_id: string }>(
    `SELECT id, tenant_id
       FROM iam.user_accounts
      WHERE identity_provider = $1
        AND provider_subject  = $2
        AND status            = 'active'
        AND deleted_at IS NULL
      LIMIT 1`,
    [claims.identityProvider, claims.providerSubject]
  );
  const row = account.rows[0];
  if (!row) return null;

  const scopes = await db.query<{
    unrestricted: boolean;
    company_ids: string[] | null;
    branch_ids: string[] | null;
  }>(
    `SELECT
        bool_or(g.scope_mode = 'unrestricted')                     AS unrestricted,
        array_remove(array_agg(DISTINCT s.company_id), NULL)       AS company_ids,
        array_remove(array_agg(DISTINCT s.branch_id), NULL)        AS branch_ids
       FROM iam.role_grants g
       LEFT JOIN iam.grant_scopes s
              ON s.tenant_id = g.tenant_id AND s.grant_id = g.id
      WHERE g.user_id  = $1
        AND g.status   = 'active'
        AND g.valid_from <= now()
        AND (g.valid_to IS NULL OR g.valid_to > now())`,
    [row.id]
  );

  const aggregate = scopes.rows[0];
  const unrestricted = aggregate?.unrestricted === true;

  return {
    userId: row.id,
    tenantId: row.tenant_id,
    // An unrestricted grant means no narrowing at all — passing the scoped
    // companies as well would silently *narrow* a tenant-wide operator.
    companyIds: unrestricted ? [] : (aggregate?.company_ids ?? []),
    branchIds: unrestricted ? [] : (aggregate?.branch_ids ?? []),
    unrestricted,
  };
}

/**
 * Intersects a requested narrowing with the caller's actual scope.
 *
 * Rejects — rather than silently drops — a requested company or branch the
 * caller does not hold. Silently dropping would turn "show me branch X" into
 * "show me everything", which is the wrong direction to fail.
 */
export function narrowScope(
  resolved: ResolvedScope,
  requested: { companyIds?: readonly string[]; branchIds?: readonly string[] } = {}
): { companyIds: readonly string[]; branchIds: readonly string[] } {
  const check = (
    values: readonly string[] | undefined,
    held: readonly string[],
    field: string
  ): readonly string[] => {
    if (!values || values.length === 0) return held;
    for (const value of values) {
      if (!UUID.test(value)) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Requested ${field} is not a UUID`,
          safeDetails: { violations: [{ path: field, rule: 'invalid_format' }] },
        });
      }
      // Unrestricted callers hold everything in the tenant, so `held` being
      // empty means "no narrowing", not "nothing allowed".
      if (!resolved.unrestricted && !held.includes(value)) {
        // Uniform denial: never reveals whether the id exists.
        throw new AppFailure('ERR-IAM-001', {
          message: `Requested ${field} outside the caller's granted scope`,
        });
      }
    }
    return values;
  };

  return {
    companyIds: check(requested.companyIds, resolved.companyIds, 'companyIds'),
    branchIds: check(requested.branchIds, resolved.branchIds, 'branchIds'),
  };
}

export interface ResolveContextInput {
  readonly claims: PrincipalClaims;
  readonly correlationId: string;
  readonly causationId?: string | null;
  readonly operation: string;
  readonly module: string;
  /** Narrowing the caller asked for. Checked against granted scope, never trusted. */
  readonly requestedScope?: { companyIds?: readonly string[]; branchIds?: readonly string[] };
}

/**
 * Resolves a full request context, or throws `ERR-IAM-002` when the session's
 * identity has no active account in the claimed tenant.
 */
export async function resolveRequestContext(input: ResolveContextInput): Promise<RequestContext> {
  if (!UUID.test(input.claims.tenantId)) {
    // A malformed tenant claim is an authentication failure, not a validation
    // error: it never came from a request field the caller may correct.
    throw new AppFailure('ERR-IAM-002', { message: 'Session tenant claim is not a UUID' });
  }

  // Bootstrap context: tenant only. `iam.current_user_id()` stays NULL, which the
  // account-lookup policy does not need, and which cannot satisfy any policy that
  // does — so this transaction can read nothing a user-scoped policy protects.
  const bootstrap = buildRequestContext({
    correlationId: input.correlationId,
    principal: { userId: input.claims.tenantId, tenantId: input.claims.tenantId },
    operation: `${input.operation}#resolve`,
    module: input.module,
  });

  const resolved = await withReadOnlyTransaction(bootstrap, async (db) => {
    // Re-set user_id to empty: the bootstrap context above carries the tenant id
    // in the user slot purely to satisfy the UUID contract of the builder, and it
    // must not be mistaken for an authenticated user by any policy.
    await db.query("SELECT set_config('app.user_id', '', true)");
    return resolveScopeFor(db, input.claims);
  });

  if (!resolved) {
    throw new AppFailure('ERR-IAM-002', {
      message: 'No active account for the session identity in the claimed tenant',
    });
  }

  const narrowed = narrowScope(resolved, input.requestedScope);

  return buildRequestContext({
    correlationId: input.correlationId,
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
    principal: { userId: resolved.userId, tenantId: resolved.tenantId },
    companyIds: narrowed.companyIds,
    branchIds: narrowed.branchIds,
    operation: input.operation,
    module: input.module,
  });
}
