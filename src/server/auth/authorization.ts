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

    if (result.rows[0]?.allowed !== true) failed.push(code);
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
