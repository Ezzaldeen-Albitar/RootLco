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

/**
 * Re-authorizes the running operation against a scope discovered at run time.
 *
 * Lives here rather than beside the HTTP handler so a module can depend on it
 * without importing `@/server/http`: the ten id-addressed P1-18 commands need it
 * in their APPLICATION layer, once the row is locked (P1-18-A-01).
 */
export type ScopeAuthorizer = (target: AuthorizationTarget) => Promise<void>;

export interface AuthorizationDecision {
  readonly allowed: boolean;
  /** Codes that evaluated false. Safe to return: they are public API metadata. */
  readonly failedPermissions: readonly string[];
}

export interface EvaluationOptions {
  /**
   * Evaluate against grant scope whenever the target names one, regardless of
   * the operation's declared scope. Set by the deferred path only.
   */
  readonly forceScoped?: boolean;
}

function requiresScopedEvaluation(scope: ScopeRequirement, target: AuthorizationTarget): boolean {
  if (scope === 'tenant') return false;
  return target.companyId !== undefined || target.branchId !== undefined;
}

/**
 * Evaluates every declared permission code. Returns a decision rather than
 * throwing, so callers can log or audit before converting it to a response.
 *
 * Scope resolution belongs entirely to `iam.has_permission_in_scope`, and a
 * previous revision of this file was wrong to add a second one beside it.
 *
 * That revision added a `grantCoversBranch` check on the belief that a
 * branch-scoped grant necessarily carries a separate `company` scope row, which
 * would have let a grant for (company C, branch B1) satisfy a request naming
 * branch B2 inside C. It does not. `ck_grant_scopes_shape` lets a `branch` row
 * carry its own `company_id` on the SAME row, and the SQL function matches a
 * company only when `scope_type = 'company'` — so a grant scoped only to
 * (C, B1) already does NOT satisfy a request naming B2. Naming the
 * `authorizationTarget` was sufficient by itself. The exploit that appeared to
 * prove otherwise came from a TEST FIXTURE that inserted an extra
 * `company`-type row, which by the platform's own contract makes that grant
 * company-wide, so admitting B2 was correct behaviour rather than a defect.
 *
 * The removed check therefore closed nothing and cost something: it redefined
 * company and department scope in TypeScript for the two operations that pass a
 * company+branch target, and refused legitimate company-scoped operators on
 * them. Scope semantics stay in one place, which is what this file's header
 * argues for.
 */
export async function evaluatePermissions(
  db: DbHandle,
  operation: RegisteredOperation,
  target: AuthorizationTarget = {},
  options: EvaluationOptions = {}
): Promise<AuthorizationDecision> {
  if (operation.public) return { allowed: true, failedPermissions: [] };

  // `forceScoped` says "a caller discovered this scope and named it", which is
  // a stronger statement than the declaration makes. It only ever ADDS scope to
  // the decision: with no company and no branch there is still nothing to
  // narrow by, so the expression below cannot turn a scoped evaluation into a
  // scope-blind one.
  const scoped = options.forceScoped
    ? target.companyId !== undefined || target.branchId !== undefined
    : requiresScopedEvaluation(operation.scope, target);
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
  target: AuthorizationTarget = {},
  options: EvaluationOptions = {}
): Promise<void> {
  const decision = await evaluatePermissions(db, operation, target, options);
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

/**
 * Enforces authorization against a scope discovered INSIDE the transaction,
 * failing closed when the caller names no scope to narrow by.
 *
 * This is the entry point behind `HandlerInput.authorizeScope`, and it exists
 * as its own function because the pre-handler check and the deferred check have
 * genuinely different contracts. The pre-handler check runs before anything is
 * read, so an operation addressed by a resource id has no company or branch to
 * name yet and an empty target is CORRECT there. The deferred check is the
 * opposite: its whole reason to exist is that the scope is now known, so an
 * empty target means the choke point failed to supply it.
 *
 * That distinction has to be enforced rather than documented.
 * `requiresScopedEvaluation` returns false for an empty target WHATEVER the
 * declared scope is, so a deferred authorizer handed `{}` would silently
 * evaluate scope-blind `iam.has_permission` and answer yes — which is
 * P1-18-A-01 exactly, reached a second time through the very API added to close
 * it. A narrowing operation that arrives here with neither a company nor a
 * branch has a defect at its choke point, and the safe answer to "I cannot tell
 * which scope this is" is no, not yes.
 *
 * Deliberately NOT folded into `requirePermissions`: that would break the
 * pre-handler call for every one of the ten operations this remediation is
 * about, since an empty target is exactly what they legitimately pass there.
 */
export async function requireScopedPermissions(
  db: DbHandle,
  operation: RegisteredOperation,
  target: AuthorizationTarget
): Promise<void> {
  // Deliberately NOT `operation.scope !== 'tenant'`. Reaching this function at
  // all means a choke point has discovered the resource's scope and is asking
  // to be judged against it, whatever the declaration happens to say. Keying
  // the guard on the declared scope would exempt any operation that omitted
  // `scope` — `defineOperation` defaults it to `'tenant'` — so a future
  // id-addressed command that forgot one line would call this with a real
  // target, fall through `requiresScopedEvaluation`'s tenant short-circuit,
  // and be decided by scope-blind `iam.has_permission`. That is P1-18-A-01
  // restored by an omission, and it would look completely correct at the call
  // site. The public exemption stays: a public operation has no principal to
  // narrow.
  if (!operation.public && target.companyId === undefined && target.branchId === undefined) {
    const context: RequestContext = db.context;
    metrics().increment(METRICS.errorCount, { code: 'ERR-IAM-001', operation: operation.id });
    log.warn('Authorization denied', {
      ...contextLogFields(context),
      result: 'denied',
      errorCode: 'ERR-IAM-001',
      context: { reason: 'deferred-scope-target-missing', declaredScope: operation.scope },
    });

    throw new AppFailure('ERR-IAM-001', {
      message:
        `Denied ${operation.id}: deferred scoped authorization requires the ` +
        `resource's own company or branch, and neither was supplied`,
      safeDetails: { requiredPermissions: operation.permissions },
    });
  }

  // `forceScoped`, for the same reason the guard above ignores the declared
  // scope: a target was supplied, so the decision must consult grant scope even
  // if the declaration says `tenant`. Without this a tenant-scoped operation
  // could hand over a real company and branch and still be answered by
  // `iam.has_permission`, which reads no scope at all.
  return requirePermissions(db, operation, target, { forceScoped: true });
}
