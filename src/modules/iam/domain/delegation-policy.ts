/**
 * Delegation, escalation, and scope-containment rules (P1-14, BR-IAM-001).
 *
 * ## Why these rules exist twice
 *
 * The database already refuses most of what this file refuses.
 * `ins_role_permissions_delegable` and `ins_role_grants_delegable` (DBCR-P1-14-001)
 * put the delegation rule in RLS, so an administrator cannot map a permission
 * they do not hold, and cannot grant a role conferring one. `ck_role_grants_no_self_grant`
 * refuses a self-grant outright.
 *
 * That is the last line of defence and it stays the authority. These rules are
 * the *first* line, and they exist for reasons that are not "belt and braces":
 *
 *  - a policy denial on INSERT is a bare `42501` with no field path, which is a
 *    terrible answer to give an administrator who mistyped one permission code;
 *  - a policy denial on UPDATE/DELETE affects **zero rows and raises nothing**,
 *    so a service that does not check first would report success for a write
 *    that did not happen;
 *  - two of the rules below — last-administrator protection and scope
 *    containment across the company/branch hierarchy — cannot be expressed
 *    cheaply in a policy at all, because they require counting across the tenant.
 *
 * Where a rule exists in both places, the database wins and a regression test
 * asserts the database still refuses it independently. Nothing here is permitted
 * to be the *only* control over an escalation.
 */
import { DomainService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';

export interface GrantFacts {
  /** The administrator performing the action. */
  readonly actorUserId: string;
  /** Permission codes the actor currently holds, as measured in the database. */
  readonly actorPermissions: ReadonlySet<string>;
  /** True when the actor holds a tenant-wide (unrestricted) grant. */
  readonly actorUnrestricted: boolean;
  /** Companies the actor may act in. Empty when unrestricted. */
  readonly actorCompanyIds: ReadonlySet<string>;
  /** Branches the actor may act in. Empty when unrestricted. */
  readonly actorBranchIds: ReadonlySet<string>;
}

export interface ScopeRequest {
  readonly scopeType: 'company' | 'branch' | 'department';
  readonly companyId: string;
  readonly branchId?: string | null;
  readonly departmentId?: string | null;
}

export class DelegationPolicy extends DomainService {
  protected readonly module = 'iam';

  /**
   * Refuses a self-grant.
   *
   * `ck_role_grants_no_self_grant` refuses it too. Checking here turns a
   * constraint violation into a cataloged 403 with an honest message, and covers
   * the revoke direction the CHECK does not.
   */
  assertNotSelf(facts: GrantFacts, targetUserId: string, action: string): void {
    if (facts.actorUserId === targetUserId) {
      throw new AppFailure('ERR-IAM-001', {
        message: `An administrator may not ${action} their own access`,
      });
    }
  }

  /**
   * Refuses delegating a permission the actor does not hold.
   *
   * `deny` mappings are exempt, and deliberately so: refusing to let an
   * administrator *remove* access they do not personally hold would be a safety
   * regression dressed as a safety control. The database policy makes the same
   * exemption, for the same reason.
   */
  assertDelegable(
    facts: GrantFacts,
    permissionCodes: readonly string[],
    effect: 'allow' | 'deny'
  ): void {
    if (effect === 'deny') return;
    const withheld = permissionCodes.filter((code) => !facts.actorPermissions.has(code));
    if (withheld.length > 0) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'An administrator may not delegate a permission they do not hold',
        // Safe to return: these are the codes the caller just submitted, and
        // permission codes are documented API metadata. No resource is named.
        safeDetails: { requiredPermissions: withheld },
      });
    }
  }

  /**
   * Refuses a scope the actor does not hold.
   *
   * An unrestricted actor holds the whole tenant and narrows to nothing, which
   * is why `actorCompanyIds` being empty means "everything" for them and
   * "nothing" for everyone else. Getting that backwards is how a scoped
   * administrator silently becomes tenant-wide.
   */
  assertScopeWithinAuthority(facts: GrantFacts, scope: ScopeRequest): void {
    if (facts.actorUnrestricted) return;

    if (!facts.actorCompanyIds.has(scope.companyId)) {
      // Uniform denial: never states whether the company exists.
      throw new AppFailure('ERR-IAM-001', {
        message: 'Requested company is outside the administrator granted scope',
      });
    }
    if (
      scope.branchId &&
      facts.actorBranchIds.size > 0 &&
      !facts.actorBranchIds.has(scope.branchId)
    ) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'Requested branch is outside the administrator granted scope',
      });
    }
  }

  /**
   * Refuses a scope whose parts do not belong together.
   *
   * The foreign keys enforce this too — `fk_grant_scopes_branch` is composite on
   * `(tenant_id, company_id, branch_id)` — but a 23503 is an unreadable answer,
   * and the shape CHECK is easier to satisfy accidentally than to satisfy
   * correctly.
   */
  assertScopeShape(scope: ScopeRequest): void {
    const violation = (rule: string): never => {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Scope shape is not valid for its type',
        safeDetails: { violations: [{ path: 'body.scopeType', rule }] },
      });
    };
    if (scope.scopeType === 'company' && (scope.branchId || scope.departmentId)) {
      violation('company_scope_takes_no_branch');
    }
    if (scope.scopeType === 'branch' && (!scope.branchId || scope.departmentId)) {
      violation('branch_scope_requires_branch_only');
    }
    if (scope.scopeType === 'department' && (!scope.branchId || !scope.departmentId)) {
      violation('department_scope_requires_branch_and_department');
    }
  }

  /**
   * Refuses an edit to a platform-owned role.
   *
   * `ins_roles_admin`, `upd_roles_admin`, and both `role_permissions` policies
   * already exclude `is_system` roles. This produces the readable refusal.
   */
  assertNotSystemRole(isSystem: boolean): void {
    if (isSystem) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'System roles are platform contract and cannot be modified',
      });
    }
  }

  /**
   * Protects the last holder of a permission.
   *
   * Not expressible as a policy: it requires counting active grants conferring a
   * permission across the tenant, which a per-row `WITH CHECK` cannot do
   * affordably or correctly under concurrency. It is therefore an application
   * rule, stated as such, and the count is read `FOR UPDATE` inside the same
   * transaction as the revoke so two concurrent revocations cannot both see two
   * remaining administrators and both proceed.
   *
   * @param remainingHolders holders that would still hold the permission after
   *   the change, counted inside the command's own transaction.
   */
  assertNotLastHolder(remainingHolders: number, permissionCode: string): void {
    if (remainingHolders <= 0) {
      throw new AppFailure('ERR-IAM-001', {
        message:
          `This change would leave the tenant with nobody holding "${permissionCode}", ` +
          'which would make the tenant unadministrable.',
      });
    }
  }
}
