/**
 * Authorization middleware (P1-13-BE-005, BR-IAM-001).
 *
 * Authorization is evaluated **in the database**, by `iam.has_permission` and
 * `iam.has_permission_in_scope`, inside the same transaction and under the same
 * session context that the handler will use. That is deliberate:
 *
 *  - the permission model, deny precedence, grant validity windows and scope
 *    matching already live there and were gated in Phase 1-4;
 *  - re-implementing them in TypeScript would create a second source of truth
 *    that drifts, and the drift would be silent until it was a breach;
 *  - evaluating inside the request transaction means the decision and the work
 *    see the same snapshot — a grant revoked mid-request cannot be half-applied.
 *
 * **Deny precedence** is a property of the database functions (any `deny`
 * mapping in an active granted role wins). This layer does not soften it: all
 * declared permission codes must return true, and an unset context returns false
 * rather than raising, so the failure mode is denial.
 *
 * The denial response is uniform (`ERR-IAM-001`, 403) and never states whether
 * the target exists — resource-existence leakage through error codes is a
 * standard enumeration vector.
 */
import { AppFailure } from '../errors/app-failure';
import type { DbHandle } from '../db/transaction';
import type { RequestContext } from '../context/request-context';
import { contextLogFields } from '../context/request-context';
import { log } from '../observability/logger';
import { metrics, METRICS } from '../observability/metrics';
import type { RegisteredOperation, ScopeRequirement } from './operation-registry';

/** Target the permission is evaluated against, when narrower than the tenant. */
export interface AuthorizationTarget {
  readonly companyId?: string;
  readonly branchId?: string;
  readonly departmentId?: string;
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  /** Codes that evaluated false. Safe to return: they are public API metadata. */
  readonly failedPermissions: readonly string[];
}

function requiresScopedEvaluation(scope: ScopeRequirement, target: AuthorizationTarget): boolean {
  if (scope === 'tenant') return false;
  return target.companyId !== undefined || target.branchId !== undefined;
}

/**
 * When a BRANCH is named, the grant carrying the permission must cover that
 * branch — not merely its company.
 *
 * `iam.has_permission_in_scope` matches `company OR branch OR department`, and
 * `ck_grant_scopes_shape` requires a branch scope row to also carry its company.
 * A grant scoped to (company C, branch B1) therefore carries a company row for C
 * and satisfies a request naming branch B2 inside C. Combined with
 * `resolve-context.ts` publishing `app.branch_ids` as the UNION of every grant —
 * which is all the RLS scope policies consult — a caller holding a capable grant
 * in one branch and any grant at all in a second could write in the second.
 * P1-18's reception commands made that directly reachable: they take
 * `companyId`/`branchId` from the request body.
 *
 * This check is additive and only ever tightens: it runs after
 * `has_permission_in_scope` has already allowed, so global deny precedence is
 * unchanged, and an unrestricted grant still passes. Correcting the SQL function
 * itself would be a migration, which this phase may not add; correcting it here
 * needs none.
 */
async function grantCoversBranch(db: DbHandle, code: string, branchId: string): Promise<boolean> {
  const result = await db.query<{ covered: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM iam.role_grants g
         JOIN iam.role_permissions rp
           ON rp.tenant_id = g.tenant_id AND rp.role_id = g.role_id AND rp.effect = 'allow'
         JOIN iam.permissions p
           ON p.id = rp.permission_id AND p.permission_code = $1
        WHERE g.tenant_id = iam.current_tenant_id()
          AND g.user_id = iam.current_user_id()
          AND g.status = 'active'
          AND g.valid_from <= now()
          AND (g.valid_to IS NULL OR g.valid_to > now())
          AND (
            g.scope_mode = 'unrestricted'
            OR EXISTS (
              SELECT 1 FROM iam.grant_scopes s
               WHERE s.tenant_id = g.tenant_id AND s.grant_id = g.id
                 AND s.scope_type = 'branch' AND s.branch_id = $2::uuid
            )
          )
     ) AS covered`,
    [code, branchId]
  );
  return result.rows[0]?.covered === true;
}

/**
 * Evaluates every declared permission code. Returns a decision rather than
 * throwing, so callers can log or audit before converting it to a response.
 */
export async function evaluatePermissions(
  db: DbHandle,
  operation: RegisteredOperation,
  target: AuthorizationTarget = {}
): Promise<AuthorizationDecision> {
  if (operation.public) return { allowed: true, failedPermissions: [] };

  const scoped = requiresScopedEvaluation(operation.scope, target);
  const failed: string[] = [];

  for (const code of operation.permissions) {
    const result = scoped
      ? await db.query<{ allowed: boolean }>(
          'SELECT iam.has_permission_in_scope($1, $2, $3, $4) AS allowed',
          [code, target.companyId ?? null, target.branchId ?? null, target.departmentId ?? null]
        )
      : await db.query<{ allowed: boolean }>('SELECT iam.has_permission($1) AS allowed', [code]);

    if (result.rows[0]?.allowed !== true) {
      failed.push(code);
      continue;
    }
    if (target.branchId !== undefined && !(await grantCoversBranch(db, code, target.branchId))) {
      failed.push(code);
    }
  }

  return { allowed: failed.length === 0, failedPermissions: failed };
}

/**
 * Enforces authorization, throwing the uniform denial on failure.
 *
 * A denial is a security-event candidate: it is logged at warn with the
 * correlation ID and counted. Persisting it to `iam.security_events` requires a
 * write privilege the runtime role does not currently hold — see
 * `security-events.ts` and DBCR-P1-13-001.
 */
export async function requirePermissions(
  db: DbHandle,
  operation: RegisteredOperation,
  target: AuthorizationTarget = {}
): Promise<void> {
  const decision = await evaluatePermissions(db, operation, target);
  if (decision.allowed) return;

  const context: RequestContext = db.context;
  metrics().increment(METRICS.errorCount, { code: 'ERR-IAM-001', operation: operation.id });
  log.warn('Authorization denied', {
    ...contextLogFields(context),
    result: 'denied',
    errorCode: 'ERR-IAM-001',
    context: { failedPermissions: decision.failedPermissions },
  });

  throw new AppFailure('ERR-IAM-001', {
    message: `Denied ${operation.id}: missing ${decision.failedPermissions.join(', ')}`,
    // The required codes are safe to disclose — they are documented API metadata,
    // and telling a caller which permission they lack is a usability win with no
    // information gain for an attacker. The *resource* is never mentioned.
    safeDetails: { requiredPermissions: operation.permissions },
  });
}
