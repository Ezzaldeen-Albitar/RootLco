/**
 * The First-Owner bootstrap's own writes (PRE-P1-29 Wave B §6.3, P1-29 W9).
 *
 * Every statement here runs on the PLATFORM connection as `app_platform`, inside the
 * platform-on-target window `withPlatformTarget` opens: `app.tenant_id` is the
 * tenant the same transaction has just created, and the handle names it too.
 * What admits each row is the shipped §6.3 policy on its table — three terms,
 * none of which this code re-implements.
 *
 * Why these writes do not reuse the runtime repositories, and why none of them
 * says `RETURNING`:
 *
 *  - `app_platform` holds INSERT on the five bootstrap tables and SELECT on
 *    `iam.role_grants` only (plus a column-scoped self-read on accounts). A
 *    `RETURNING` clause is a read of the written row, evaluated under the
 *    SELECT policy; measured live, `INSERT … RETURNING id` into
 *    `iam.user_accounts` is refused as a policy violation and into `iam.roles`
 *    as a missing privilege, while the same INSERT without it is admitted.
 *    The runtime repositories return the rows they write, which is right for
 *    `app_runtime` and impossible here. Identifiers are therefore generated
 *    by the caller and written, never read back;
 *  - the account is inserted `active`, never `invited`: an invited account
 *    resolves zero permissions, and the point of the bootstrap is a tenant its
 *    Owner can enter. `IdentityRepository.insertAccount` writes `'invited'` as
 *    a visible invariant of the invitation path, and that invariant stands;
 *  - the status-history row is written explicitly (`NULL -> active`) because
 *    `iam.change_user_status` is a transition function that refuses a row
 *    already in its target state.
 *
 * The catalogue read is the one privilege this slice added to `app_platform`
 * (20260902130000): two columns, under an authority-predicated policy, because
 * `iam.role_permissions.permission_id` is a surrogate key.
 */
import { randomUUID } from 'node:crypto';
import { Repository } from '@/server/db/repository';
import type { PlatformTargetHandle } from '@/server/db/transaction';

export class TenantBootstrapRepository extends Repository {
  protected readonly module = 'iam';

  /** The Owner's account, inserted active, attributed to the acting operator. */
  async insertActiveAccount(
    db: PlatformTargetHandle,
    input: {
      readonly identityProvider: string;
      readonly providerSubject: string;
      readonly email: string;
      readonly displayName: string;
    }
  ): Promise<string> {
    const id = randomUUID();
    await this.run(
      db,
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
      [
        id,
        db.targetTenantId,
        input.identityProvider,
        input.providerSubject,
        input.email,
        input.displayName,
        db.context.principal.userId,
      ]
    );
    return id;
  }

  /** The account's first status row: nothing -> active, in the operator's name. */
  async insertActivationHistory(
    db: PlatformTargetHandle,
    input: { readonly userId: string; readonly reason: string }
  ): Promise<void> {
    await this.run(
      db,
      `INSERT INTO iam.user_status_history
         (tenant_id, user_id, from_state, to_state, reason, actor_id, correlation_id)
       VALUES ($1, $2, NULL, 'active', $3, $4, $5)`,
      [
        db.targetTenantId,
        input.userId,
        input.reason,
        db.context.principal.userId,
        db.context.correlationId,
      ]
    );
  }

  /** An ordinary, editable role (`is_system = false` — the §6.3 policy admits nothing else). */
  async insertRole(
    db: PlatformTargetHandle,
    input: { readonly roleCode: string; readonly name: string; readonly description: string }
  ): Promise<string> {
    const id = randomUUID();
    await this.run(
      db,
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, description, is_system, created_by)
       VALUES ($1, $2, $3, $4, $5, false, $6)`,
      [
        id,
        db.targetTenantId,
        input.roleCode,
        input.name,
        input.description,
        db.context.principal.userId,
      ]
    );
    return id;
  }

  /** One `allow` mapping. */
  async insertRolePermission(
    db: PlatformTargetHandle,
    input: { readonly roleId: string; readonly permissionId: string }
  ): Promise<void> {
    await this.run(
      db,
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       VALUES ($1, $2, $3, 'allow', $4)`,
      [db.targetTenantId, input.roleId, input.permissionId, db.context.principal.userId]
    );
  }

  /** An unrestricted, active grant, issued by the operator (never by the account itself). */
  async insertUnrestrictedGrant(
    db: PlatformTargetHandle,
    input: { readonly userId: string; readonly roleId: string }
  ): Promise<string> {
    const id = randomUUID();
    await this.run(
      db,
      `INSERT INTO iam.role_grants
         (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1, $2, $3, $4, 'unrestricted', 'active', $5, $5)`,
      [id, db.targetTenantId, input.userId, input.roleId, db.context.principal.userId]
    );
    return id;
  }

  /**
   * Resolves permission codes to catalogue rows. Returns only what exists; the
   * service compares the count and refuses the bootstrap on any gap, because a
   * role mapped to fewer codes than its definition states is a silent
   * narrowing nobody asked for.
   */
  async permissionIdsByCode(
    db: PlatformTargetHandle,
    codes: readonly string[]
  ): Promise<ReadonlyMap<string, string>> {
    const rows = await this.run<{ id: string; permission_code: string }>(
      db,
      `SELECT id, permission_code
         FROM iam.permissions
        WHERE permission_code = ANY($1::text[])`,
      [codes]
    );
    return new Map(rows.rows.map((r) => [r.permission_code, r.id]));
  }

  /**
   * Whether an organization exists at all — asked about the tenant an Owner
   * address is already bound to at the provider. Read under the platform SELECT
   * policy on `org.tenants`, which is predicated on the operator's authority
   * and not on the window's tenant, so a row of another organization is
   * visible here for exactly this question.
   */
  async tenantExists(db: PlatformTargetHandle, tenantId: string): Promise<boolean> {
    const row = await this.runOne<{ found: boolean }>(
      db,
      'SELECT true AS found FROM org.tenants WHERE id = $1',
      [tenantId]
    );
    return row !== null && row !== undefined;
  }

  /**
   * What the window wrote for one account, read back through the SELECT the
   * §6.3 policy set admits on `iam.role_grants` — the same rows the deferred
   * scope trigger reads.
   */
  async grantedRoleCount(db: PlatformTargetHandle, userId: string): Promise<number> {
    const row = await this.runOne<{ n: number }>(
      db,
      `SELECT count(*)::int AS n
         FROM iam.role_grants
        WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' AND scope_mode = 'unrestricted'`,
      [db.targetTenantId, userId]
    );
    return (row as { n: number }).n;
  }
}
