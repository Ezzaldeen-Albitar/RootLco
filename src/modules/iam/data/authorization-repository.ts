/**
 * Role, permission-mapping, grant, scope, and approval-limit data access (P1-14).
 *
 * Column-level grants from the protected schema decide the shape of every
 * statement here, and they were read from the live catalog:
 *
 *   iam.roles             UPDATE (name, description, deleted_at)
 *   iam.role_permissions  UPDATE (effect)              + INSERT, DELETE
 *   iam.role_grants       UPDATE (status, valid_to, revoked_at, revoke_reason)
 *   iam.grant_scopes      INSERT, DELETE               — no UPDATE at all
 *   iam.approval_limits   UPDATE (effective_to)
 *
 * A statement naming any other column is refused at the privilege layer with
 * `42501`, before the immutability triggers run — so the narrow column lists
 * below are the contract, not a style preference. Re-pointing a grant at a
 * different user, changing an approved amount, or promoting a role to
 * `is_system` are all impossible by construction rather than by review.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { OrderingContract, Page, PageRequest } from '@/server/db/pagination';
import { buildPage, keysetFragment } from '@/server/db/pagination';

export interface RoleRow {
  readonly id: string;
  readonly roleCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly deletedAt: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
}

export interface RolePermissionRow {
  readonly id: string;
  readonly roleId: string;
  readonly permissionId: string;
  readonly permissionCode: string;
  readonly effect: 'allow' | 'deny';
  readonly recordVersion: number;
}

export interface GrantRow {
  readonly id: string;
  readonly userId: string;
  readonly roleId: string;
  readonly scopeMode: 'unrestricted' | 'scoped';
  readonly status: 'active' | 'revoked';
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly grantedBy: string;
  readonly revokedAt: string | null;
  readonly recordVersion: number;
}

export interface ScopeRow {
  readonly id: string;
  readonly grantId: string;
  readonly scopeType: 'company' | 'branch' | 'department';
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly departmentId: string | null;
}

export interface ApprovalLimitRow {
  readonly id: string;
  readonly companyId: string;
  readonly roleId: string | null;
  readonly userId: string | null;
  readonly limitType: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordVersion: number;
}

export const ROLE_ORDERING: OrderingContract = Object.freeze({
  key: 'iam.roles:created_at_desc',
  direction: 'desc',
});

export class AuthorizationRepository extends Repository {
  protected readonly module = 'iam';

  // ---- Permission catalog ------------------------------------------------

  /**
   * The permission catalog is platform-global reference data with an
   * unconditional SELECT policy, so no tenant predicate applies to it — and that
   * is correct: the same permission codes exist for every tenant.
   */
  async listPermissions(
    db: DbHandle
  ): Promise<
    readonly { id: string; code: string; domain: string; riskLevel: string; description: string }[]
  > {
    const result = await this.run<{
      id: string;
      permission_code: string;
      domain: string;
      risk_level: string;
      description: string;
    }>(
      db,
      `SELECT id, permission_code, domain, risk_level, description
         FROM iam.permissions
        ORDER BY domain, permission_code`
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.permission_code,
      domain: row.domain,
      riskLevel: row.risk_level,
      description: row.description,
    }));
  }

  async findPermissionByCode(
    db: DbHandle,
    code: string
  ): Promise<{ id: string; code: string } | null> {
    const row = await this.runOne<{ id: string; permission_code: string }>(
      db,
      'SELECT id, permission_code FROM iam.permissions WHERE permission_code = $1',
      [code]
    );
    return row ? { id: row.id, code: row.permission_code } : null;
  }

  /**
   * Permission codes the current principal holds, measured by asking the
   * database function rather than by reconstructing deny precedence here.
   *
   * `iam.has_permission` is the authority: it applies deny precedence, grant
   * validity windows, and the account-must-be-active rule. Re-deriving those in
   * TypeScript would create a second answer that could disagree.
   */
  async effectivePermissionsOfCaller(db: DbHandle): Promise<ReadonlySet<string>> {
    const result = await this.run<{ permission_code: string }>(
      db,
      `SELECT p.permission_code
         FROM iam.permissions p
        WHERE iam.has_permission(p.permission_code)`
    );
    return new Set(result.rows.map((row) => row.permission_code));
  }

  /**
   * The scopes the CALLER themselves hold, at full granularity, from their own
   * active grants. This is the authoritative input to scope containment
   * (P1-14 grant-scope remediation): unlike the flattened company/branch sets in
   * the request context, it preserves whether the caller holds a whole company
   * or only a branch within it. `iam.current_user_id()` is the server-set actor;
   * no client value is trusted. RLS (`sel_role_grants_tenant` /
   * `sel_grant_scopes_tenant`) keeps this within the caller's tenant.
   */
  async heldScopesOfCaller(db: DbHandle): Promise<
    ReadonlyArray<{
      scopeType: 'company' | 'branch' | 'department';
      companyId: string;
      branchId: string | null;
      departmentId: string | null;
    }>
  > {
    const result = await this.run<{
      scope_type: 'company' | 'branch' | 'department';
      company_id: string;
      branch_id: string | null;
      department_id: string | null;
    }>(
      db,
      `SELECT DISTINCT s.scope_type, s.company_id, s.branch_id, s.department_id
         FROM iam.role_grants g
         JOIN iam.grant_scopes s
           ON s.tenant_id = g.tenant_id AND s.grant_id = g.id
        WHERE g.user_id = iam.current_user_id()
          AND g.status = 'active'
          AND g.valid_from <= now()
          AND (g.valid_to IS NULL OR g.valid_to > now())`
    );
    return result.rows.map((row) => ({
      scopeType: row.scope_type,
      companyId: row.company_id,
      branchId: row.branch_id,
      departmentId: row.department_id,
    }));
  }

  // ---- Roles -------------------------------------------------------------

  async findRoleById(db: DbHandle, roleId: string): Promise<RoleRow | null> {
    const row = await this.runOne<{
      id: string;
      role_code: string;
      name: string;
      description: string | null;
      is_system: boolean;
      deleted_at: string | null;
      record_version: number;
      created_at: string;
    }>(
      db,
      `SELECT id, role_code, name, description, is_system, deleted_at, record_version, created_at
         FROM iam.roles
        WHERE tenant_id = $1 AND id = $2`,
      [db.context.principal.tenantId, roleId]
    );
    return row
      ? {
          id: row.id,
          roleCode: row.role_code,
          name: row.name,
          description: row.description,
          isSystem: row.is_system,
          deletedAt: row.deleted_at,
          recordVersion: row.record_version,
          createdAt: row.created_at,
        }
      : null;
  }

  async insertRole(
    db: DbHandle,
    input: { roleCode: string; name: string; description: string | null }
  ): Promise<RoleRow> {
    const row = await this.runOne<{
      id: string;
      role_code: string;
      name: string;
      description: string | null;
      is_system: boolean;
      deleted_at: string | null;
      record_version: number;
      created_at: string;
    }>(
      db,
      `INSERT INTO iam.roles (tenant_id, role_code, name, description, is_system, created_by)
       VALUES ($1, $2, $3, $4, false, $5)
       RETURNING id, role_code, name, description, is_system, deleted_at, record_version, created_at`,
      [
        db.context.principal.tenantId,
        input.roleCode,
        input.name,
        input.description,
        db.context.principal.userId,
      ]
    );
    const created = row as NonNullable<typeof row>;
    return {
      id: created.id,
      roleCode: created.role_code,
      name: created.name,
      description: created.description,
      isSystem: created.is_system,
      deletedAt: created.deleted_at,
      recordVersion: created.record_version,
      createdAt: created.created_at,
    };
  }

  async updateRole(
    db: DbHandle,
    roleId: string,
    expectedVersion: number,
    changes: { name?: string; description?: string | null; archive?: boolean }
  ): Promise<number> {
    // `updated_by` (and record_version) are trigger-stamped by
    // shared.touch_row_metadata → iam.current_user_id(); the runtime role holds
    // column UPDATE on (name, description, deleted_at) only, so naming `updated_by`
    // in the SET list is refused with 42501 before any row is touched. The R-007
    // fix removed the explicit set from role_permissions/role_grants/approval_limits
    // /user_sessions but missed this method — see P1-14-R-010.
    const result = await this.run(
      db,
      `UPDATE iam.roles
          SET name        = COALESCE($4, name),
              description = CASE WHEN $5::boolean THEN $6 ELSE description END,
              deleted_at  = CASE WHEN $7::boolean THEN now() ELSE deleted_at END
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3`,
      [
        db.context.principal.tenantId,
        roleId,
        expectedVersion,
        changes.name ?? null,
        changes.description !== undefined,
        changes.description ?? null,
        changes.archive === true,
      ]
    );
    return result.rowCount ?? 0;
  }

  async listRoles(db: DbHandle, request: PageRequest): Promise<Page<RoleRow>> {
    const values: unknown[] = [db.context.principal.tenantId];
    const keyset = keysetFragment(request, { sort: 'created_at', id: 'id' }, ROLE_ORDERING, 2);
    values.push(...keyset.values);

    const result = await this.run<{
      id: string;
      role_code: string;
      name: string;
      description: string | null;
      is_system: boolean;
      deleted_at: string | null;
      record_version: number;
      created_at: string;
    }>(
      db,
      `SELECT id, role_code, name, description, is_system, deleted_at, record_version, created_at
         FROM iam.roles
        WHERE tenant_id = $1 ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      values
    );

    const rows: RoleRow[] = result.rows.map((row) => ({
      id: row.id,
      roleCode: row.role_code,
      name: row.name,
      description: row.description,
      isSystem: row.is_system,
      deletedAt: row.deleted_at,
      recordVersion: row.record_version,
      createdAt: row.created_at,
    }));
    return buildPage(rows, request, ROLE_ORDERING, (row) => ({
      sortValue: row.createdAt,
      id: row.id,
    }));
  }

  // ---- Permission mappings ----------------------------------------------

  async listRolePermissions(db: DbHandle, roleId: string): Promise<readonly RolePermissionRow[]> {
    const result = await this.run<{
      id: string;
      role_id: string;
      permission_id: string;
      permission_code: string;
      effect: 'allow' | 'deny';
      record_version: number;
    }>(
      db,
      `SELECT rp.id, rp.role_id, rp.permission_id, p.permission_code, rp.effect, rp.record_version
         FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.tenant_id = $1 AND rp.role_id = $2
        ORDER BY p.permission_code`,
      [db.context.principal.tenantId, roleId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      roleId: row.role_id,
      permissionId: row.permission_id,
      permissionCode: row.permission_code,
      effect: row.effect,
      recordVersion: row.record_version,
    }));
  }

  async insertRolePermission(
    db: DbHandle,
    input: { roleId: string; permissionId: string; effect: 'allow' | 'deny' }
  ): Promise<string> {
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        db.context.principal.tenantId,
        input.roleId,
        input.permissionId,
        input.effect,
        db.context.principal.userId,
      ]
    );
    return (row as { id: string }).id;
  }

  async updateRolePermissionEffect(
    db: DbHandle,
    mappingId: string,
    expectedVersion: number,
    effect: 'allow' | 'deny'
  ): Promise<number> {
    // `updated_by` (and record_version) are trigger-stamped; the runtime role has
    // column UPDATE on `effect` only, so setting `updated_by` here is refused. See
    // P1-14-R-007.
    const result = await this.run(
      db,
      `UPDATE iam.role_permissions
          SET effect = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3`,
      [db.context.principal.tenantId, mappingId, expectedVersion, effect]
    );
    return result.rowCount ?? 0;
  }

  async deleteRolePermission(db: DbHandle, mappingId: string): Promise<number> {
    const result = await this.run(
      db,
      'DELETE FROM iam.role_permissions WHERE tenant_id = $1 AND id = $2',
      [db.context.principal.tenantId, mappingId]
    );
    return result.rowCount ?? 0;
  }

  /** Allow-permission codes a role confers. Used for the delegation pre-check. */
  async allowCodesOfRole(db: DbHandle, roleId: string): Promise<readonly string[]> {
    const result = await this.run<{ permission_code: string }>(
      db,
      `SELECT p.permission_code
         FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.tenant_id = $1 AND rp.role_id = $2 AND rp.effect = 'allow'
        ORDER BY p.permission_code`,
      [db.context.principal.tenantId, roleId]
    );
    return result.rows.map((row) => row.permission_code);
  }

  // ---- Grants ------------------------------------------------------------

  async findGrantById(db: DbHandle, grantId: string): Promise<GrantRow | null> {
    const row = await this.runOne<{
      id: string;
      user_id: string;
      role_id: string;
      scope_mode: 'unrestricted' | 'scoped';
      status: 'active' | 'revoked';
      valid_from: string;
      valid_to: string | null;
      granted_by: string;
      revoked_at: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, user_id, role_id, scope_mode, status, valid_from, valid_to,
              granted_by, revoked_at, record_version
         FROM iam.role_grants
        WHERE tenant_id = $1 AND id = $2`,
      [db.context.principal.tenantId, grantId]
    );
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          roleId: row.role_id,
          scopeMode: row.scope_mode,
          status: row.status,
          validFrom: row.valid_from,
          validTo: row.valid_to,
          grantedBy: row.granted_by,
          revokedAt: row.revoked_at,
          recordVersion: row.record_version,
        }
      : null;
  }

  async insertGrant(
    db: DbHandle,
    input: {
      userId: string;
      roleId: string;
      scopeMode: 'unrestricted' | 'scoped';
      validTo: string | null;
      approvalRef: string | null;
    }
  ): Promise<string> {
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO iam.role_grants
         (tenant_id, user_id, role_id, scope_mode, status, valid_to, granted_by,
          approval_ref, created_by)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $6)
       RETURNING id`,
      [
        db.context.principal.tenantId,
        input.userId,
        input.roleId,
        input.scopeMode,
        input.validTo,
        db.context.principal.userId,
        input.approvalRef,
      ]
    );
    return (row as { id: string }).id;
  }

  /**
   * Revokes a grant. `status` and `revoked_at` move together because
   * `ck_role_grants_revoke_consistency` requires exactly that, and
   * `ck_role_grants_revoke_reason` requires a non-blank reason with them.
   */
  async revokeGrant(
    db: DbHandle,
    grantId: string,
    expectedVersion: number,
    reason: string
  ): Promise<number> {
    const result = await this.run(
      db,
      // `updated_by` is trigger-stamped (column not granted to the runtime role);
      // see P1-14-R-007.
      `UPDATE iam.role_grants
          SET status = 'revoked', revoked_at = now(), revoke_reason = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND status = 'active'`,
      [db.context.principal.tenantId, grantId, expectedVersion, reason]
    );
    return result.rowCount ?? 0;
  }

  async listGrantsForUser(db: DbHandle, userId: string): Promise<readonly GrantRow[]> {
    const result = await this.run<{
      id: string;
      user_id: string;
      role_id: string;
      scope_mode: 'unrestricted' | 'scoped';
      status: 'active' | 'revoked';
      valid_from: string;
      valid_to: string | null;
      granted_by: string;
      revoked_at: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, user_id, role_id, scope_mode, status, valid_from, valid_to,
              granted_by, revoked_at, record_version
         FROM iam.role_grants
        WHERE tenant_id = $1 AND user_id = $2
        ORDER BY valid_from DESC, id DESC
        LIMIT 200`,
      [db.context.principal.tenantId, userId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      roleId: row.role_id,
      scopeMode: row.scope_mode,
      status: row.status,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      grantedBy: row.granted_by,
      revokedAt: row.revoked_at,
      recordVersion: row.record_version,
    }));
  }

  /**
   * Counts principals other than `excludingUserId` who would still hold
   * `permissionCode` through an active grant.
   *
   * This is a **read** of who holds a permission, and it must count every holder
   * the caller can see under the tenant-wide `sel_role_grants_tenant` SELECT
   * policy — regardless of whether the caller may *administer* those grants.
   *
   * It deliberately does NOT use `FOR UPDATE OF g` (P1-14-R-011). Under RLS a
   * locking read also has to satisfy the target table's UPDATE policy, and
   * `upd_role_grants_admin` requires `iam.grant.manage`. The last-holder guard is
   * called from `changeUserStatus`, whose caller holds `iam.user.manage` but not
   * necessarily `iam.grant.manage` — so `FOR UPDATE` silently dropped every other
   * holder's grant row, the guard under-counted to zero, and a legitimate lock or
   * archive was refused with a false "this would leave the tenant unadministrable".
   * A row lock the caller is not entitled to take cannot be part of a *read*.
   *
   * The last-administrator rule is defence-in-depth for an availability invariant
   * (a tenant stays administrable; ADR-008 lets an owner/operator restore it), not
   * a security boundary, so the vanishing-small concurrent-double-revocation window
   * a snapshot read leaves open is an acceptable trade for a guard that actually
   * counts. Both callers run the count inside the same transaction as their write,
   * so each decides on a consistent snapshot.
   */
  async countOtherHoldersOf(
    db: DbHandle,
    permissionCode: string,
    excludingUserId: string
  ): Promise<number> {
    const row = await this.runOne<{ holders: number }>(
      db,
      `SELECT count(DISTINCT g.user_id)::int AS holders
         FROM iam.role_grants g
         JOIN iam.role_permissions rp
           ON rp.tenant_id = g.tenant_id AND rp.role_id = g.role_id AND rp.effect = 'allow'
         JOIN iam.permissions p ON p.id = rp.permission_id
         JOIN iam.user_accounts u ON u.tenant_id = g.tenant_id AND u.id = g.user_id
        WHERE g.tenant_id = $1
          AND p.permission_code = $2
          AND g.user_id <> $3
          AND g.status = 'active'
          AND g.valid_from <= now()
          AND (g.valid_to IS NULL OR g.valid_to > now())
          AND u.status = 'active'
          AND u.deleted_at IS NULL`,
      [db.context.principal.tenantId, permissionCode, excludingUserId]
    );
    return row?.holders ?? 0;
  }

  // ---- Grant scopes ------------------------------------------------------

  async listScopes(db: DbHandle, grantId: string): Promise<readonly ScopeRow[]> {
    const result = await this.run<{
      id: string;
      grant_id: string;
      scope_type: 'company' | 'branch' | 'department';
      company_id: string | null;
      branch_id: string | null;
      department_id: string | null;
    }>(
      db,
      `SELECT id, grant_id, scope_type, company_id, branch_id, department_id
         FROM iam.grant_scopes
        WHERE tenant_id = $1 AND grant_id = $2
        ORDER BY scope_type, company_id, branch_id, department_id, id`,
      [db.context.principal.tenantId, grantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      grantId: row.grant_id,
      scopeType: row.scope_type,
      companyId: row.company_id,
      branchId: row.branch_id,
      departmentId: row.department_id,
    }));
  }

  async insertScope(
    db: DbHandle,
    input: {
      grantId: string;
      scopeType: 'company' | 'branch' | 'department';
      companyId: string;
      branchId: string | null;
      departmentId: string | null;
    }
  ): Promise<string> {
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO iam.grant_scopes
         (tenant_id, grant_id, scope_type, company_id, branch_id, department_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        db.context.principal.tenantId,
        input.grantId,
        input.scopeType,
        input.companyId,
        input.branchId,
        input.departmentId,
        db.context.principal.userId,
      ]
    );
    return (row as { id: string }).id;
  }

  /**
   * Removes a scope row.
   *
   * `tg_grant_scopes_require_scope` is a DEFERRABLE INITIALLY DEFERRED
   * constraint trigger, so removing the last scope of a `scoped` grant fails at
   * COMMIT, not here. That is the database's design and it is correct — the
   * caller may legitimately delete one scope and add another in the same
   * transaction — but it means the failure surfaces late, which the service
   * documents rather than works around.
   */
  async deleteScope(db: DbHandle, scopeId: string): Promise<number> {
    const result = await this.run(
      db,
      'DELETE FROM iam.grant_scopes WHERE tenant_id = $1 AND id = $2',
      [db.context.principal.tenantId, scopeId]
    );
    return result.rowCount ?? 0;
  }

  // ---- Approval limits ---------------------------------------------------

  async insertApprovalLimit(
    db: DbHandle,
    input: {
      companyId: string;
      roleId: string | null;
      userId: string | null;
      limitType: string;
      amount: string;
      currencyCode: string;
      effectiveFrom: string;
      effectiveTo: string | null;
    }
  ): Promise<string> {
    const row = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO iam.approval_limits
         (tenant_id, company_id, role_id, user_id, limit_type, amount, currency_code,
          effective_from, effective_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8::date, $9::date, $10)
       RETURNING id`,
      [
        db.context.principal.tenantId,
        input.companyId,
        input.roleId,
        input.userId,
        input.limitType,
        // Bound as a string all the way down: parsing to a JS number here would
        // round the value before PostgreSQL ever sees it.
        input.amount,
        input.currencyCode,
        input.effectiveFrom,
        input.effectiveTo,
        db.context.principal.userId,
      ]
    );
    return (row as { id: string }).id;
  }

  /** The only mutable column is `effective_to`; everything else is immutable. */
  async endApprovalLimit(
    db: DbHandle,
    limitId: string,
    expectedVersion: number,
    effectiveTo: string
  ): Promise<number> {
    // `updated_by` is trigger-stamped; the runtime role has column UPDATE on
    // `effective_to` only, so setting it here is refused. See P1-14-R-007.
    const result = await this.run(
      db,
      `UPDATE iam.approval_limits
          SET effective_to = $4::date
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3`,
      [db.context.principal.tenantId, limitId, expectedVersion, effectiveTo]
    );
    return result.rowCount ?? 0;
  }

  async listApprovalLimits(
    db: DbHandle,
    filters: { companyId?: string | undefined; userId?: string | undefined },
    limit: number
  ): Promise<readonly ApprovalLimitRow[]> {
    const values: unknown[] = [db.context.principal.tenantId];
    let predicate = 'WHERE tenant_id = $1';
    if (filters.companyId) {
      values.push(filters.companyId);
      predicate += ` AND company_id = $${values.length}`;
    }
    if (filters.userId) {
      values.push(filters.userId);
      predicate += ` AND user_id = $${values.length}`;
    }
    values.push(limit);

    const result = await this.run<{
      id: string;
      company_id: string;
      role_id: string | null;
      user_id: string | null;
      limit_type: string;
      amount: string;
      currency_code: string;
      effective_from: string;
      effective_to: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, company_id, role_id, user_id, limit_type, amount::text AS amount,
              currency_code, effective_from::text AS effective_from,
              effective_to::text AS effective_to, record_version
         FROM iam.approval_limits
        ${predicate}
        ORDER BY effective_from DESC, id DESC
        LIMIT $${values.length}`,
      values
    );
    return result.rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      roleId: row.role_id,
      userId: row.user_id,
      limitType: row.limit_type,
      // `::text` in the query, not `Number()` here: `numeric` crosses the driver
      // boundary as a string and must stay one.
      amount: row.amount,
      currencyCode: row.currency_code,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      recordVersion: row.record_version,
    }));
  }

  async findApprovalLimitById(db: DbHandle, limitId: string): Promise<ApprovalLimitRow | null> {
    const row = await this.runOne<{
      id: string;
      company_id: string;
      role_id: string | null;
      user_id: string | null;
      limit_type: string;
      amount: string;
      currency_code: string;
      effective_from: string;
      effective_to: string | null;
      record_version: number;
    }>(
      db,
      `SELECT id, company_id, role_id, user_id, limit_type, amount::text AS amount,
              currency_code, effective_from::text AS effective_from,
              effective_to::text AS effective_to, record_version
         FROM iam.approval_limits
        WHERE tenant_id = $1 AND id = $2`,
      [db.context.principal.tenantId, limitId]
    );
    return row
      ? {
          id: row.id,
          companyId: row.company_id,
          roleId: row.role_id,
          userId: row.user_id,
          limitType: row.limit_type,
          amount: row.amount,
          currencyCode: row.currency_code,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          recordVersion: row.record_version,
        }
      : null;
  }
}
