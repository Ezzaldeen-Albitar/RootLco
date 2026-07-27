/**
 * Role, permission-mapping, grant, scope, and approval-limit administration
 * (P1-14, BR-IAM-001).
 *
 * This is the escalation surface of the whole platform, so every method below is
 * written on the assumption that its caller is hostile and already holds
 * administrative permissions. The controls that follow from that:
 *
 *  - **Delegation is bounded twice.** `DelegationPolicy` refuses first, for a
 *    readable answer; `ins_role_permissions_delegable` and
 *    `ins_role_grants_delegable` refuse again in RLS, so a defect in this file
 *    cannot produce an escalation. The database refusal is asserted independently
 *    by the P1-14 capability suite.
 *  - **Self-service is refused.** An administrator may not grant to, revoke from,
 *    or set an approval limit for themselves. `ck_role_grants_no_self_grant`
 *    agrees on the grant direction; the others are application rules and are
 *    stated as such.
 *  - **Deny is never blocked.** Adding a `deny` mapping, revoking a grant, and
 *    ending an approval limit are all *reductions* in access, and requiring the
 *    actor to hold the permission they are taking away would be a safety
 *    regression wearing a safety control's clothes.
 *  - **Every mutation is versioned, audited, and — where it changes effective
 *    access — published after commit.**
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page, type PageRequest } from '@/server/db/pagination';
import { assertVersionMatched } from '@/server/db/concurrency';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, sqlState, SQLSTATE } from '@/server/db/repository';
import {
  AuthorizationRepository,
  ROLE_ORDERING,
  type ApprovalLimitRow,
  type GrantRow,
  type RoleRow,
} from '../data/authorization-repository';
import { IdentityRepository } from '../data/identity-repository';
import { OrganizationRepository } from '../data/organization-repository';
import { DelegationPolicy, type GrantFacts, type ScopeRequest } from '../domain/delegation-policy';
import { CredentialPolicy } from '../domain/credential-policy';
import { IdentityPolicy } from '../domain/identity-policy';

/** SQLSTATE for an EXCLUDE-constraint violation (overlapping effective windows). */
const EXCLUSION_VIOLATION = '23P01';

/** The exact incoming scope shape a caller may submit for a grant. */
interface IncomingScope {
  scopeType: 'company' | 'branch' | 'department';
  companyId: string;
  branchId?: string | null | undefined;
  departmentId?: string | null | undefined;
}

/** Normalises an incoming scope into the exact shape the domain policy takes. */
function toScopeRequest(scope: IncomingScope): ScopeRequest {
  return {
    scopeType: scope.scopeType,
    companyId: scope.companyId,
    branchId: scope.branchId ?? null,
    departmentId: scope.departmentId ?? null,
  };
}

/**
 * Normalises the requested scope list before any containment decision:
 * coerces `null`/`undefined` sub-fields to `null` and removes exact duplicates
 * (same type + company + branch + department). Deduplication is deterministic
 * and happens *before* validation so a caller cannot smuggle an unvalidated
 * scope past the loop by repeating an allowed one, and so a duplicate can never
 * become a second `iam.grant_scopes` row (which would otherwise trip
 * `uq_grant_scopes_row`). An empty or omitted list normalises to `[]`, which the
 * caller interprets as an explicit unrestricted request — never as "skip
 * validation".
 */
function normalizeScopes(scopes: readonly IncomingScope[] | null | undefined): ScopeRequest[] {
  const seen = new Set<string>();
  const out: ScopeRequest[] = [];
  for (const scope of scopes ?? []) {
    const request = toScopeRequest(scope);
    const key = `${request.scopeType}|${request.companyId}|${request.branchId ?? ''}|${request.departmentId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(request);
  }
  return out;
}

export class AccessAdministrationService extends ApplicationService {
  protected readonly module = 'iam';

  constructor(
    private readonly authorization: AuthorizationRepository,
    private readonly identities: IdentityRepository,
    private readonly organization: OrganizationRepository,
    private readonly delegationPolicy: DelegationPolicy,
    private readonly credentialPolicy: CredentialPolicy,
    private readonly identityPolicy: IdentityPolicy
  ) {
    super();
  }

  // ---- Permission catalog ------------------------------------------------

  async listPermissions(db: DbHandle) {
    return this.authorization.listPermissions(db);
  }

  // ---- Roles -------------------------------------------------------------

  /** Raw page inputs, for the same boundary reason as the user list. */
  async listRoles(
    db: DbHandle,
    page: { cursor?: string | undefined; limit?: number | undefined }
  ): Promise<Page<RoleRow>> {
    const request: PageRequest = pageRequest(ROLE_ORDERING, page);
    return this.authorization.listRoles(db, request);
  }

  async createRole(
    db: DbHandle,
    input: { roleCode: string; name: string; description?: string | undefined }
  ): Promise<RoleRow> {
    let role: RoleRow;
    try {
      role = await this.authorization.insertRole(db, {
        roleCode: input.roleCode,
        name: input.name,
        description: input.description ?? null,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        // `uq_roles_tenant_code_active` — the code is taken by a live role.
        throw new AppFailure('ERR-RES-002', {
          message: 'A role with that code already exists in this tenant',
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'iam.role.created',
      entityType: 'iam.role',
      entityId: role.id,
      details: [
        { field: 'role_code', classification: 'public', value: role.roleCode },
        { field: 'name', classification: 'public', value: role.name },
      ],
    });
    return role;
  }

  async updateRole(
    db: DbHandle,
    roleId: string,
    expectedVersion: number,
    changes: {
      name?: string | undefined;
      description?: string | null | undefined;
      archive?: boolean | undefined;
    }
  ): Promise<RoleRow> {
    const role = await this.requireRole(db, roleId);
    // `is_system` roles are platform contract. The policies exclude them too.
    this.delegationPolicy.assertNotSystemRole(role.isSystem);

    const affected = await this.authorization.updateRole(db, roleId, expectedVersion, {
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
      ...(changes.archive !== undefined ? { archive: changes.archive } : {}),
    });
    assertVersionMatched(affected);

    await appendAudit(db, {
      action: changes.archive === true ? 'iam.role.archived' : 'iam.role.updated',
      entityType: 'iam.role',
      entityId: roleId,
      details: [
        ...(changes.name !== undefined
          ? [
              {
                field: 'name',
                classification: 'public' as const,
                previousValue: role.name,
                value: changes.name,
              },
            ]
          : []),
        ...(changes.archive === true
          ? [{ field: 'deleted_at', classification: 'public' as const, value: 'archived' }]
          : []),
      ],
    });

    const after = await this.authorization.findRoleById(db, roleId);
    return after ?? role;
  }

  // ---- Permission mappings ----------------------------------------------

  async listRolePermissions(db: DbHandle, roleId: string) {
    await this.requireRole(db, roleId);
    return this.authorization.listRolePermissions(db, roleId);
  }

  /**
   * Adds a permission mapping to a role.
   *
   * The delegation check is the escalation control: without it, an administrator
   * holding only `iam.role.manage` could map `sal.reversal.approve` onto a role
   * and grant that role to themselves. The database refuses the same thing
   * independently.
   */
  async addRolePermission(
    db: DbHandle,
    roleId: string,
    input: { permissionCode: string; effect: 'allow' | 'deny' }
  ): Promise<{ id: string }> {
    const role = await this.requireRole(db, roleId);
    this.delegationPolicy.assertNotSystemRole(role.isSystem);

    const permission = await this.authorization.findPermissionByCode(db, input.permissionCode);
    if (!permission) {
      throw new AppFailure('ERR-RES-001', { message: 'Unknown permission code' });
    }

    const facts = await this.delegationFacts(db);
    this.delegationPolicy.assertDelegable(facts, [input.permissionCode], input.effect);

    let id: string;
    try {
      id = await this.authorization.insertRolePermission(db, {
        roleId,
        permissionId: permission.id,
        effect: input.effect,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-RES-002', {
          message: 'That permission is already mapped to this role',
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'iam.role.permission_added',
      entityType: 'iam.role_permission',
      entityId: id,
      details: [
        { field: 'role_id', classification: 'internal', value: roleId },
        { field: 'permission_code', classification: 'public', value: input.permissionCode },
        { field: 'effect', classification: 'public', value: input.effect },
      ],
    });
    return { id };
  }

  async changeRolePermissionEffect(
    db: DbHandle,
    roleId: string,
    mappingId: string,
    expectedVersion: number,
    effect: 'allow' | 'deny'
  ): Promise<void> {
    const role = await this.requireRole(db, roleId);
    this.delegationPolicy.assertNotSystemRole(role.isSystem);

    const mappings = await this.authorization.listRolePermissions(db, roleId);
    const mapping = mappings.find((entry) => entry.id === mappingId);
    if (!mapping)
      throw new AppFailure('ERR-RES-001', { message: 'Mapping not found on this role' });

    const facts = await this.delegationFacts(db);
    this.delegationPolicy.assertDelegable(facts, [mapping.permissionCode], effect);

    const affected = await this.authorization.updateRolePermissionEffect(
      db,
      mappingId,
      expectedVersion,
      effect
    );
    assertVersionMatched(affected);

    await appendAudit(db, {
      action: 'iam.role.permission_changed',
      entityType: 'iam.role_permission',
      entityId: mappingId,
      details: [
        { field: 'permission_code', classification: 'public', value: mapping.permissionCode },
        {
          field: 'effect',
          classification: 'public',
          previousValue: mapping.effect,
          value: effect,
        },
      ],
    });
  }

  /**
   * Removes a permission mapping.
   *
   * No delegation check: removing access is a reduction, and requiring the actor
   * to hold what they are removing would leave a permission nobody can withdraw.
   * Last-holder protection still applies when the mapping is an `allow` on
   * `iam.user.manage`-class permissions — a tenant must remain administrable.
   */
  async removeRolePermission(db: DbHandle, roleId: string, mappingId: string): Promise<void> {
    const role = await this.requireRole(db, roleId);
    this.delegationPolicy.assertNotSystemRole(role.isSystem);

    const mappings = await this.authorization.listRolePermissions(db, roleId);
    const mapping = mappings.find((entry) => entry.id === mappingId);
    if (!mapping)
      throw new AppFailure('ERR-RES-001', { message: 'Mapping not found on this role' });

    const affected = await this.authorization.deleteRolePermission(db, mappingId);
    if (affected === 0) {
      // The DELETE policy refused, or the row vanished. Same answer either way.
      throw new AppFailure('ERR-RES-001', { message: 'Mapping not found on this role' });
    }

    await appendAudit(db, {
      action: 'iam.role.permission_removed',
      entityType: 'iam.role_permission',
      entityId: mappingId,
      details: [
        { field: 'role_id', classification: 'internal', value: roleId },
        { field: 'permission_code', classification: 'public', value: mapping.permissionCode },
        { field: 'effect', classification: 'public', previousValue: mapping.effect, value: null },
      ],
    });
  }

  // ---- Grants ------------------------------------------------------------

  async listGrantsForUser(db: DbHandle, userId: string): Promise<readonly GrantRow[]> {
    return this.authorization.listGrantsForUser(db, userId);
  }

  /**
   * Grants a role to a user.
   *
   * `scopeMode: 'scoped'` requires at least one scope row, enforced by the
   * DEFERRABLE constraint trigger `tg_role_grants_require_scope` at COMMIT — so
   * the scopes are written in the same transaction, immediately below.
   */
  async issueGrant(
    db: DbHandle,
    input: {
      userId: string;
      roleId: string;
      validTo?: string | null | undefined;
      approvalRef?: string | null | undefined;
      scopes?:
        | readonly {
            scopeType: 'company' | 'branch' | 'department';
            companyId: string;
            branchId?: string | null | undefined;
            departmentId?: string | null | undefined;
          }[]
        | undefined;
    }
  ): Promise<{ id: string }> {
    const facts = await this.delegationFacts(db);
    this.delegationPolicy.assertNotSelf(facts, input.userId, 'grant');

    const target = await this.identities.findById(db, input.userId);
    if (!target || target.deletedAt) {
      throw new AppFailure('ERR-RES-001', { message: 'User not found in this tenant' });
    }
    const role = await this.requireRole(db, input.roleId);
    if (role.deletedAt) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'An archived role cannot be granted',
        safeDetails: { violations: [{ path: 'body.roleId', rule: 'role_archived' }] },
      });
    }

    // Escalation through role composition: the actor must already hold every
    // allow-permission the role confers, or granting it hands out more than they
    // have. The database policy checks exactly this too.
    const codes = await this.authorization.allowCodesOfRole(db, input.roleId);
    this.delegationPolicy.assertDelegable(facts, codes, 'allow');

    // Scope containment (P1-14 confirmed-High remediation). An empty/omitted/null
    // scope list is an explicit request for an UNRESTRICTED (tenant-wide) grant,
    // not "nothing to validate" — so it takes the unrestricted authority path,
    // which only a tenant-wide administrator passes. A non-empty list is
    // validated scope-by-scope after normalisation (duplicates removed), and any
    // single invalid scope throws, which rolls the whole transaction back so no
    // partial grant commits. The database backstop enforces the identical rule.
    const scopes = normalizeScopes(input.scopes);
    const scopeMode = scopes.length > 0 ? 'scoped' : 'unrestricted';
    if (scopeMode === 'unrestricted') {
      this.delegationPolicy.assertUnrestrictedDelegationAllowed(facts);
    } else {
      for (const request of scopes) {
        this.delegationPolicy.assertScopeShape(request);
        this.delegationPolicy.assertScopeWithinAuthority(facts, request);
        await this.assertScopeBelongsTogether(db, request);
      }
    }

    const grantId = await this.authorization.insertGrant(db, {
      userId: input.userId,
      roleId: input.roleId,
      scopeMode,
      validTo: input.validTo ?? null,
      approvalRef: input.approvalRef ?? null,
    });

    for (const request of scopes) {
      await this.authorization.insertScope(db, {
        grantId,
        scopeType: request.scopeType,
        companyId: request.companyId,
        branchId: request.branchId ?? null,
        departmentId: request.departmentId ?? null,
      });
    }

    await appendAudit(db, {
      action: 'iam.grant.issued',
      entityType: 'iam.role_grant',
      entityId: grantId,
      details: [
        { field: 'user_id', classification: 'internal', value: input.userId },
        { field: 'role_code', classification: 'public', value: role.roleCode },
        { field: 'scope_mode', classification: 'public', value: scopeMode },
        { field: 'scope_count', classification: 'internal', value: String(scopes.length) },
      ],
    });

    // Published inside the transaction, so the event exists if and only if the
    // grant committed (BR-INT-001). Consumers see it only after commit.
    await publishEvent(db, {
      eventType: 'access.grant.changed',
      aggregateId: grantId,
      aggregateVersion: 1,
      producer: 'iam.access-administration-service',
      payload: {
        grantId,
        userId: input.userId,
        roleId: input.roleId,
        change: 'issued',
        scopeMode,
      },
      eventKey: `access.grant.changed:${grantId}:issued`,
    });

    return { id: grantId };
  }

  /**
   * Revokes a grant. Effective immediately: `resolveScopeFor()` and
   * `iam.has_permission` both read `status = 'active'` on every request, so
   * nothing cached keeps it alive.
   */
  async revokeGrant(
    db: DbHandle,
    grantId: string,
    expectedVersion: number,
    reason: string
  ): Promise<void> {
    const grant = await this.authorization.findGrantById(db, grantId);
    if (!grant) throw new AppFailure('ERR-RES-001', { message: 'Grant not found in this tenant' });

    const checked = this.identityPolicy.assertReason(reason);
    const facts = await this.delegationFacts(db);
    this.delegationPolicy.assertNotSelf(facts, grant.userId, 'revoke');

    // Last-holder protection: if this grant is the only remaining source of a
    // critical permission for the tenant, refuse. Counted `FOR UPDATE`.
    const codes = await this.authorization.allowCodesOfRole(db, grant.roleId);
    for (const code of ['iam.user.manage', 'iam.grant.manage', 'iam.role.manage']) {
      if (!codes.includes(code)) continue;
      const remaining = await this.authorization.countOtherHoldersOf(db, code, grant.userId);
      this.delegationPolicy.assertNotLastHolder(remaining, code);
    }

    const affected = await this.authorization.revokeGrant(db, grantId, expectedVersion, checked);
    assertVersionMatched(affected);

    await appendAudit(db, {
      action: 'iam.grant.revoked',
      entityType: 'iam.role_grant',
      entityId: grantId,
      details: [
        { field: 'user_id', classification: 'internal', value: grant.userId },
        { field: 'status', classification: 'public', previousValue: 'active', value: 'revoked' },
        { field: 'reason', classification: 'internal', value: checked },
      ],
    });

    await publishEvent(db, {
      eventType: 'access.grant.changed',
      aggregateId: grantId,
      aggregateVersion: grant.recordVersion + 1,
      producer: 'iam.access-administration-service',
      payload: { grantId, userId: grant.userId, roleId: grant.roleId, change: 'revoked' },
      eventKey: `access.grant.changed:${grantId}:revoked`,
    });
  }

  // ---- Grant scopes ------------------------------------------------------

  async listScopes(db: DbHandle, grantId: string) {
    const grant = await this.authorization.findGrantById(db, grantId);
    if (!grant) throw new AppFailure('ERR-RES-001', { message: 'Grant not found in this tenant' });
    return this.authorization.listScopes(db, grantId);
  }

  async addScope(
    db: DbHandle,
    grantId: string,
    scope: {
      scopeType: 'company' | 'branch' | 'department';
      companyId: string;
      branchId?: string | null | undefined;
      departmentId?: string | null | undefined;
    }
  ): Promise<{ id: string }> {
    const grant = await this.authorization.findGrantById(db, grantId);
    if (!grant) throw new AppFailure('ERR-RES-001', { message: 'Grant not found in this tenant' });
    if (grant.status !== 'active') {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A revoked grant cannot be re-scoped',
        safeDetails: { violations: [{ path: 'path.grantId', rule: 'grant_revoked' }] },
      });
    }

    const facts = await this.delegationFacts(db);
    this.delegationPolicy.assertNotSelf(facts, grant.userId, 'scope');
    const request = toScopeRequest(scope);
    this.delegationPolicy.assertScopeShape(request);
    this.delegationPolicy.assertScopeWithinAuthority(facts, request);
    await this.assertScopeBelongsTogether(db, scope);

    let id: string;
    try {
      id = await this.authorization.insertScope(db, {
        grantId,
        scopeType: scope.scopeType,
        companyId: scope.companyId,
        branchId: scope.branchId ?? null,
        departmentId: scope.departmentId ?? null,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-RES-002', { message: 'That scope is already on this grant' });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'iam.grant.scope_added',
      entityType: 'iam.grant_scope',
      entityId: id,
      details: [
        { field: 'grant_id', classification: 'internal', value: grantId },
        { field: 'scope_type', classification: 'public', value: scope.scopeType },
        { field: 'company_id', classification: 'internal', value: scope.companyId },
      ],
    });

    await publishEvent(db, {
      eventType: 'access.grant.changed',
      aggregateId: grantId,
      aggregateVersion: grant.recordVersion + 1,
      producer: 'iam.access-administration-service',
      payload: { grantId, userId: grant.userId, change: 'scope-added', scopeId: id },
      eventKey: `access.grant.changed:${grantId}:scope-added:${id}`,
    });

    return { id };
  }

  /**
   * Removes a scope.
   *
   * `tg_grant_scopes_require_scope` is DEFERRABLE INITIALLY DEFERRED, so removing
   * the last scope of a `scoped` grant fails at COMMIT rather than here. That is
   * the database's deliberate design — it lets a caller swap scopes in one
   * transaction — and it means the caller sees the refusal as a failed request
   * with nothing committed, which is correct, just later than usual.
   */
  async removeScope(db: DbHandle, grantId: string, scopeId: string): Promise<void> {
    const grant = await this.authorization.findGrantById(db, grantId);
    if (!grant) throw new AppFailure('ERR-RES-001', { message: 'Grant not found in this tenant' });

    const facts = await this.delegationFacts(db);
    this.delegationPolicy.assertNotSelf(facts, grant.userId, 'scope');

    const affected = await this.authorization.deleteScope(db, scopeId);
    if (affected === 0) {
      throw new AppFailure('ERR-RES-001', { message: 'Scope not found on this grant' });
    }

    await appendAudit(db, {
      action: 'iam.grant.scope_removed',
      entityType: 'iam.grant_scope',
      entityId: scopeId,
      details: [{ field: 'grant_id', classification: 'internal', value: grantId }],
    });

    await publishEvent(db, {
      eventType: 'access.grant.changed',
      aggregateId: grantId,
      aggregateVersion: grant.recordVersion + 1,
      producer: 'iam.access-administration-service',
      payload: { grantId, userId: grant.userId, change: 'scope-removed', scopeId },
      eventKey: `access.grant.changed:${grantId}:scope-removed:${scopeId}`,
    });
  }

  // ---- Approval limits ---------------------------------------------------

  async listApprovalLimits(
    db: DbHandle,
    filters: { companyId?: string | undefined; userId?: string | undefined }
  ): Promise<readonly ApprovalLimitRow[]> {
    return this.authorization.listApprovalLimits(db, filters, 200);
  }

  /**
   * The caller's own effective approval ceiling (P1-20-BE-006).
   *
   * Exposed on this module's public surface so `@/modules/pricing` can ask
   * whether an actor may authorize a discount without reading `iam` tables
   * itself. It answers only about the CALLER — there is no parameter for whose
   * ceiling to read, so it cannot be turned into a probe for another user's
   * authority.
   *
   * Deliberately carries no permission check of its own: it discloses nothing the
   * caller does not already have, and the *authorization decision* built on it
   * belongs to the pricing module, which knows what is being authorized.
   */
  async callerApprovalCeiling(
    db: DbHandle,
    companyId: string,
    limitType: string,
    asOf: string
  ): Promise<{ amount: string; currencyCode: string } | null> {
    return this.authorization.callerApprovalCeiling(db, companyId, limitType, asOf);
  }

  /**
   * Creates an approval limit for a role or a user within a company.
   *
   * `ck_approval_limits_one_subject` requires exactly one of `role_id`/`user_id`,
   * and the two EXCLUDE constraints refuse overlapping effective windows for the
   * same subject and limit type — which is what stops "raise my own ceiling by
   * adding a second, higher, overlapping limit".
   */
  async createApprovalLimit(
    db: DbHandle,
    input: {
      companyId: string;
      roleId?: string | null | undefined;
      userId?: string | null | undefined;
      limitType: string;
      amount: string;
      currency: string;
      effectiveFrom: string;
      effectiveTo?: string | null | undefined;
    }
  ): Promise<{ id: string }> {
    const facts = await this.delegationFacts(db);
    const subjects = [input.roleId, input.userId].filter((value) => value != null);
    if (subjects.length !== 1) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Exactly one of roleId or userId must be supplied',
        safeDetails: { violations: [{ path: 'body', rule: 'one_subject_required' }] },
      });
    }
    if (input.userId) {
      // Self-approval escalation: an administrator raising their own ceiling.
      this.delegationPolicy.assertNotSelf(facts, input.userId, 'set an approval limit for');
    }

    this.credentialPolicy.assertApprovalAmount(input.amount, input.currency);
    this.credentialPolicy.assertEffectiveWindow(input.effectiveFrom, input.effectiveTo ?? null);
    this.delegationPolicy.assertScopeWithinAuthority(facts, {
      scopeType: 'company',
      companyId: input.companyId,
    });
    if (!(await this.organization.companyExists(db, input.companyId))) {
      throw new AppFailure('ERR-RES-001', { message: 'Company not found in this tenant' });
    }

    let id: string;
    try {
      id = await this.authorization.insertApprovalLimit(db, {
        companyId: input.companyId,
        roleId: input.roleId ?? null,
        userId: input.userId ?? null,
        limitType: input.limitType,
        amount: input.amount,
        currencyCode: input.currency,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      });
    } catch (error) {
      if (sqlState(error) === EXCLUSION_VIOLATION) {
        throw new AppFailure('ERR-RES-002', {
          message: 'An approval limit for that subject and type already covers this period',
        });
      }
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-RES-001', {
          message: 'The company, role, user, or currency was not found',
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'iam.approval_limit.created',
      entityType: 'iam.approval_limit',
      entityId: id,
      details: [
        { field: 'company_id', classification: 'internal', value: input.companyId },
        { field: 'limit_type', classification: 'public', value: input.limitType },
        // The amount is a business control value, not a secret; it is recorded
        // exactly so an auditor can see what ceiling was set.
        { field: 'amount', classification: 'internal', value: input.amount },
        { field: 'currency_code', classification: 'public', value: input.currency },
      ],
    });
    return { id };
  }

  /** Closes an approval limit's window. `effective_to` is the only mutable column. */
  async endApprovalLimit(
    db: DbHandle,
    limitId: string,
    expectedVersion: number,
    effectiveTo: string
  ): Promise<void> {
    const limit = await this.authorization.findApprovalLimitById(db, limitId);
    if (!limit) throw new AppFailure('ERR-RES-001', { message: 'Approval limit not found' });
    this.credentialPolicy.assertEffectiveWindow(limit.effectiveFrom, effectiveTo);

    const affected = await this.authorization.endApprovalLimit(
      db,
      limitId,
      expectedVersion,
      effectiveTo
    );
    assertVersionMatched(affected);

    await appendAudit(db, {
      action: 'iam.approval_limit.ended',
      entityType: 'iam.approval_limit',
      entityId: limitId,
      details: [
        {
          field: 'effective_to',
          classification: 'public',
          previousValue: limit.effectiveTo,
          value: effectiveTo,
        },
      ],
    });
  }

  // ---- Helpers -----------------------------------------------------------

  /**
   * Verifies the parts of a scope belong together, by reading the hierarchy
   * rather than trusting the request.
   *
   * The composite foreign keys enforce it as well; this produces the readable
   * refusal and, importantly, refuses a branch that belongs to a *different*
   * company in the same tenant — which is a containment error the caller could
   * otherwise make silently.
   */
  private async assertScopeBelongsTogether(
    db: DbHandle,
    scope: { companyId: string; branchId?: string | null | undefined }
  ): Promise<void> {
    if (!(await this.organization.companyExists(db, scope.companyId))) {
      throw new AppFailure('ERR-RES-001', { message: 'Company not found in this tenant' });
    }
    if (!scope.branchId) return;
    const owner = await this.organization.companyOfBranch(db, scope.branchId);
    if (owner === null) {
      throw new AppFailure('ERR-RES-001', { message: 'Branch not found in this tenant' });
    }
    if (owner !== scope.companyId) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The branch does not belong to the supplied company',
        safeDetails: { violations: [{ path: 'body.branchId', rule: 'branch_company_mismatch' }] },
      });
    }
  }

  private async requireRole(db: DbHandle, roleId: string): Promise<RoleRow> {
    const role = await this.authorization.findRoleById(db, roleId);
    if (!role) throw new AppFailure('ERR-RES-001', { message: 'Role not found in this tenant' });
    return role;
  }

  private async delegationFacts(db: DbHandle): Promise<GrantFacts> {
    const context = this.contextOf(db);
    return {
      actorUserId: context.principal.userId,
      actorPermissions: await this.authorization.effectivePermissionsOfCaller(db),
      actorUnrestricted: context.companyIds.length === 0 && context.branchIds.length === 0,
      actorCompanyIds: new Set(context.companyIds),
      actorBranchIds: new Set(context.branchIds),
      actorScopes: await this.authorization.heldScopesOfCaller(db),
    };
  }
}
