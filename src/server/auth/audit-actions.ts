/**
 * Controlled audit-action catalog (P1-14; closes Phase 1-14 finding PC-3).
 *
 * Before this file, `OperationDeclaration.auditAction` was a free-form string
 * validated only for presence. `defineOperation()` refused an audited operation
 * with *no* action code, but accepted any spelling of one — so two operations
 * could record the same fact under `iam.role.granted` and `iam.grant.created`,
 * and an audit query written against either would silently miss half the
 * evidence. An audit trail nobody can query completely is not an audit trail.
 *
 * The catalog fixes three things per action and makes them checkable:
 *
 *  - the **code**, which is what lands in `iam.audit_records.action`;
 *  - the **audit class** it belongs to, so a declaration cannot file a security
 *    action under `privileged` and quietly change how it is triaged;
 *  - the **entity type** the action is about, so `entity_type` is consistent
 *    across every producer of the same fact.
 *
 * Enforcement is in two places on purpose. `defineOperation()` rejects an
 * unregistered or mis-classified action at module load, which surfaces in tests
 * and in the build. `scripts/check-authorization-coverage.mjs` re-checks the same
 * thing by reading the source, so an operation that is never imported by a test
 * still fails CI.
 *
 * ## Codes are permanent
 *
 * An audit action code is written into an append-only, hash-chained table. It can
 * never be renamed, because renaming it would orphan every historical record and
 * the chain cannot be rewritten. Retire a code by removing its producer and
 * leaving the entry here marked retired; never reuse it for a different fact.
 */
import type { AuditClass } from './operation-registry';

export interface AuditActionDefinition {
  /** Value written to `iam.audit_records.action`. Permanent once shipped. */
  readonly code: string;
  /** Class the producing operation must declare. Mismatch is a registration error. */
  readonly class: Exclude<AuditClass, 'none'>;
  /** Value written to `iam.audit_records.entity_type` by the producer. */
  readonly entityType: string;
  /** What happened, in the past tense. One sentence. */
  readonly description: string;
}

/**
 * Every audit action the platform may record.
 *
 * Ordered by entity, then by lifecycle. Phase 1-14 registers the identity,
 * authorization, and organization-settings actions; later phases append their
 * own rather than inventing codes at the call site.
 */
export const AUDIT_ACTIONS: readonly AuditActionDefinition[] = Object.freeze([
  // ---- Identity lifecycle -------------------------------------------------
  {
    code: 'iam.user.invited',
    class: 'privileged',
    entityType: 'iam.user_account',
    description: 'An administrator invited a new user and created the invited account.',
  },
  {
    code: 'iam.user.invitation_cancelled',
    class: 'privileged',
    entityType: 'iam.user_account',
    description: 'An administrator cancelled an outstanding invitation before it was accepted.',
  },
  {
    code: 'iam.user.activated',
    class: 'security',
    entityType: 'iam.user_account',
    description:
      'An administrator activated an account after the provider confirmed the identity accepted its invitation.',
  },
  {
    code: 'iam.user.locked',
    class: 'security',
    entityType: 'iam.user_account',
    description: 'An account was locked, administratively or by the failed-login policy.',
  },
  {
    code: 'iam.user.unlocked',
    class: 'security',
    entityType: 'iam.user_account',
    description: 'An administrator returned a locked account to active.',
  },
  {
    code: 'iam.user.archived',
    class: 'security',
    entityType: 'iam.user_account',
    description: 'An account was archived; the state is terminal and removes every permission.',
  },
  {
    code: 'iam.user.updated',
    class: 'privileged',
    entityType: 'iam.user_account',
    description: 'An administrator changed an account profile field.',
  },

  // ---- Sessions -----------------------------------------------------------
  {
    code: 'iam.session.revoked',
    class: 'security',
    entityType: 'iam.user_session',
    description: 'A single session was revoked; revocation is terminal.',
  },
  {
    code: 'iam.session.revoked_all',
    class: 'security',
    entityType: 'iam.user_account',
    description: 'Every active session of an account was revoked in one privileged action.',
  },

  // ---- Credentials --------------------------------------------------------
  {
    code: 'iam.password.reset_requested',
    class: 'security',
    entityType: 'iam.user_account',
    description:
      'A password reset was requested for an account. Recorded only where an authenticated administrator requested it; the unauthenticated path has no context and records a security event instead.',
  },

  // ---- Roles and permission mappings -------------------------------------
  {
    code: 'iam.role.created',
    class: 'privileged',
    entityType: 'iam.role',
    description: 'A tenant role was created.',
  },
  {
    code: 'iam.role.updated',
    class: 'privileged',
    entityType: 'iam.role',
    description: 'A tenant role name or description was changed.',
  },
  {
    code: 'iam.role.archived',
    class: 'privileged',
    entityType: 'iam.role',
    description: 'A tenant role was archived and can no longer be granted.',
  },
  {
    code: 'iam.role.permission_added',
    class: 'privileged',
    entityType: 'iam.role_permission',
    description: 'A permission mapping was added to a role, with an allow or deny effect.',
  },
  {
    code: 'iam.role.permission_changed',
    class: 'privileged',
    entityType: 'iam.role_permission',
    description: "An existing permission mapping's effect was changed between allow and deny.",
  },
  {
    code: 'iam.role.permission_removed',
    class: 'privileged',
    entityType: 'iam.role_permission',
    description: 'A permission mapping was removed from a role.',
  },

  // ---- Grants and scope ---------------------------------------------------
  {
    code: 'iam.grant.issued',
    class: 'privileged',
    entityType: 'iam.role_grant',
    description: 'A role was granted to a user, optionally scoped to companies or branches.',
  },
  {
    code: 'iam.grant.revoked',
    class: 'security',
    entityType: 'iam.role_grant',
    description: 'A role grant was revoked and takes effect on the next authorization check.',
  },
  {
    code: 'iam.grant.scope_added',
    class: 'privileged',
    entityType: 'iam.grant_scope',
    description: 'A company, branch, or department scope was added to a scoped grant.',
  },
  {
    code: 'iam.grant.scope_removed',
    class: 'privileged',
    entityType: 'iam.grant_scope',
    description: 'A scope was removed from a scoped grant.',
  },

  // ---- Approval limits ----------------------------------------------------
  {
    code: 'iam.approval_limit.created',
    class: 'approval',
    entityType: 'iam.approval_limit',
    description: 'An approval limit was created for a role or a user within a company.',
  },
  {
    code: 'iam.approval_limit.ended',
    class: 'approval',
    entityType: 'iam.approval_limit',
    description: 'An approval limit was given an end date, closing its effective window.',
  },

  // ---- Audit access -------------------------------------------------------
  {
    code: 'iam.audit.viewed',
    class: 'security',
    entityType: 'iam.audit_record',
    description: 'A privileged read of the audit trail was performed.',
  },

  // ---- Organization settings ---------------------------------------------
  {
    code: 'org.tenant.settings_updated',
    class: 'privileged',
    entityType: 'org.tenant',
    description: 'Tenant display name, default locale, or default timezone was changed.',
  },
  {
    code: 'org.company.settings_updated',
    class: 'privileged',
    entityType: 'org.company_setting',
    description: 'A company setting was written as a new immutable version row.',
  },
  {
    code: 'org.branch.settings_updated',
    class: 'privileged',
    entityType: 'org.branch_setting',
    description: 'A branch setting was written as a new immutable version row.',
  },
]);

const BY_CODE: ReadonlyMap<string, AuditActionDefinition> = new Map(
  AUDIT_ACTIONS.map((action) => [action.code, action])
);

/** Registered definition, or `undefined` for an unknown code. */
export function findAuditAction(code: string): AuditActionDefinition | undefined {
  return BY_CODE.get(code);
}

export class AuditActionError extends Error {
  public override readonly name = 'AuditActionError';
}

/**
 * Registered definition, or a thrown error naming the offending code.
 *
 * Used by producers that need the entity type, so `entity_type` comes from the
 * catalog rather than from a literal repeated at every call site.
 */
export function requireAuditAction(code: string): AuditActionDefinition {
  const action = BY_CODE.get(code);
  if (!action) {
    throw new AuditActionError(
      `Audit action "${code}" is not registered in the audit-action catalog ` +
        '(src/server/auth/audit-actions.ts). Register it before recording it.'
    );
  }
  return action;
}

/**
 * Validates a declaration's action against the catalog.
 *
 * Called from `defineOperation()`. Returns an error message rather than throwing
 * so the registry can compose it with its own message prefix.
 */
export function auditActionViolation(
  operationId: string,
  auditClass: AuditClass,
  auditAction: string | undefined
): string | null {
  if (auditClass === 'none') return null;
  if (!auditAction) return null; // The registry reports the missing-action case itself.

  const action = BY_CODE.get(auditAction);
  if (!action) {
    return (
      `Operation "${operationId}" declares audit action "${auditAction}", which is not in the ` +
      'audit-action catalog (src/server/auth/audit-actions.ts). Register it there first.'
    );
  }
  if (action.class !== auditClass) {
    return (
      `Operation "${operationId}" declares audit class "${auditClass}" for action ` +
      `"${auditAction}", but the catalog classifies that action as "${action.class}".`
    );
  }
  return null;
}
