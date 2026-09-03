/**
 * The First-Owner bootstrap — the second half of `platform.organization-provision`
 * (PRE-P1-29 Wave B §6.3, P1-29 W9).
 *
 * Establishes the first human principal of a tenant the same transaction has
 * just created, while that tenant is still `provisioning`: one account, two
 * roles, their fixed permission mappings, and an unrestricted grant of each
 * role to the account. Runs inside the platform-on-target window
 * (`withPlatformTarget`), as `app_platform`, under the shipped §6.3 policies —
 * this service re-implements none of them.
 *
 * ## Two roles, separately auditable (Owner decisions 2 and 3, 2026-09-02)
 *
 *  - `first_owner` — the narrow bootstrap IAM authority the frozen B7 contract
 *    defines: exactly `iam.user.manage`, `iam.role.manage`, `iam.grant.manage`.
 *    Not a business super-role, never widened here.
 *  - `tenant_administrator` — the tenant's ordinary administration role, with
 *    the explicit finite set derived from the executable repository (session
 *    reachability, IAM administration, the P1-29 acceptance journey, the
 *    persona codes it must be able to delegate, and the organisation reads
 *    those routes require). Held by the same initial human, as its own grant.
 *
 * Both sets are SERVER-OWNED constants (`bootstrap-roles.ts`). The request
 * carries identity and profile inputs only; there is no field through which a
 * caller could name a role code or a permission, and the route's `.strict()`
 * schema refuses one at the boundary. The delegation rule of the runtime —
 * an actor maps or grants only what it holds — is untouched: after the window
 * closes the Owner administers the tenant under it, and the administrator's
 * set is what makes the acceptance personas delegable at all.
 *
 * ## Order, and why a failure anywhere discards the tenant
 *
 * identity → account → status history → roles → mappings → grants → invariant
 * check. Every write is on the provisioning transaction; the service throws on
 * the first refusal and the caller's transaction rolls back, tenant included.
 * There is no committed state "tenant without a usable administrator".
 *
 * The provider identity is the one external side effect. It is established
 * the way `iam.invitation-create` establishes one — through the configured
 * provider's invite, which binds the identity to the target tenant and lets
 * the Owner set their own credential through the provider's link — and an
 * identity that already exists for the address is reused rather than
 * duplicated, so a retry after a rolled-back attempt converges. No credential
 * enters or leaves through this service.
 */
import { AppFailure } from '@/server/errors/app-failure';
import type { PlatformTargetHandle } from '@/server/db/transaction';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import { backendConfig } from '@/server/config/backend-config';
import type { TenantBootstrapRepository } from '../data/tenant-bootstrap-repository';
import type { CredentialPolicy } from '../domain/credential-policy';
import type { IdentityProvider } from '../provider/identity-provider';
import { toAppFailureFromProvider } from '../provider/provider-errors';
import {
  type BootstrapRoleDefinition,
  FIRST_OWNER_ROLE,
  TENANT_ADMINISTRATOR_ROLE,
} from '../domain/bootstrap-roles';

/** Identity and profile inputs only. Nothing here names authority. */
export interface FirstOwnerInput {
  readonly email: string;
  readonly displayName: string;
  /** Absolute destination the invitation link returns to; allow-listed, defaults as invitations do. */
  readonly redirectTo?: string;
}

/** What the bootstrap established — identifiers only, for the audit record and the response. */
export interface FirstOwnerBootstrap {
  readonly ownerAccountId: string;
  readonly firstOwnerRoleId: string;
  readonly tenantAdministratorRoleId: string;
}

export class TenantBootstrapService {
  constructor(
    private readonly bootstrap: TenantBootstrapRepository,
    private readonly provider: IdentityProvider,
    private readonly credentialPolicy: CredentialPolicy
  ) {}

  async bootstrapFirstOwner(
    db: PlatformTargetHandle,
    input: FirstOwnerInput
  ): Promise<FirstOwnerBootstrap> {
    const identity = await this.establishIdentity(db, db.targetTenantId, input);

    let ownerAccountId: string;
    try {
      ownerAccountId = await this.bootstrap.insertActiveAccount(db, {
        identityProvider: this.provider.name,
        providerSubject: identity.subject,
        email: input.email,
        displayName: input.displayName,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-RES-002', {
          message: 'An account already exists for that identity',
        });
      }
      throw error;
    }
    await this.bootstrap.insertActivationHistory(db, {
      userId: ownerAccountId,
      reason: 'first owner bootstrap at provisioning',
    });

    const firstOwnerRoleId = await this.establishRole(db, ownerAccountId, FIRST_OWNER_ROLE);
    const tenantAdministratorRoleId = await this.establishRole(
      db,
      ownerAccountId,
      TENANT_ADMINISTRATOR_ROLE
    );

    // The invariant the window must leave behind, read back through the policy
    // set rather than assumed from the writes: exactly the two unrestricted
    // grants, no more and no fewer. Any other count means a write was admitted
    // that this service did not make, or one it made was not.
    const granted = await this.bootstrap.grantedRoleCount(db, ownerAccountId);
    if (granted !== 2) {
      throw new AppFailure('ERR-SYS-001', {
        message: `First-owner bootstrap left ${granted} active grant(s); expected exactly 2`,
      });
    }

    return { ownerAccountId, firstOwnerRoleId, tenantAdministratorRoleId };
  }

  private async establishIdentity(
    db: PlatformTargetHandle,
    tenantId: string,
    input: FirstOwnerInput
  ): Promise<{ readonly subject: string }> {
    const redirectTo = this.credentialPolicy.resolveRedirect(
      input.redirectTo,
      backendConfig().AUTH_REDIRECT_ALLOWLIST
    );
    try {
      const existing = await this.provider.findByEmail(input.email);
      if (existing) {
        // The provider binds an identity to ONE tenant, and sign-in resolves
        // the tenant from that binding. An address bound to a LIVE
        // organization elsewhere would yield an account this tenant's Owner
        // could never reach — the provisioning would answer 201 and leave an
        // organization nobody can enter. Measured during the W9 acceptance
        // run. It is a conflict, stated as one, and the transaction unwinds
        // the tenant with it.
        //
        // A binding to an organization that does not exist is a different
        // thing: a provisioning that unwound after the invitation went out
        // leaves exactly that, and the same request must then succeed. The
        // identity is re-bound to the organization being created; if this
        // transaction unwinds too, the binding is stale again and the next
        // attempt reads it the same way.
        if (existing.tenantId !== null && existing.tenantId !== tenantId) {
          if (await this.bootstrap.tenantExists(db, existing.tenantId)) {
            throw new AppFailure('ERR-RES-002', {
              message:
                'An identity already exists for that address and belongs to another organization',
            });
          }
        }
        if (existing.tenantId !== tenantId) {
          await this.provider.bindTenant(existing.subject, tenantId);
        }
        return { subject: existing.subject };
      }
      const invited = await this.provider.invite({ email: input.email, tenantId, redirectTo });
      return { subject: invited.subject };
    } catch (error) {
      toAppFailureFromProvider(error);
    }
  }

  /** One role: inserted, mapped to its fixed codes, granted unrestricted to the Owner. */
  private async establishRole(
    db: PlatformTargetHandle,
    ownerAccountId: string,
    definition: BootstrapRoleDefinition
  ): Promise<string> {
    const roleId = await this.bootstrap.insertRole(db, {
      roleCode: definition.code,
      name: definition.name,
      description: definition.description,
    });
    const ids = await this.bootstrap.permissionIdsByCode(db, definition.permissionCodes);
    const missing = definition.permissionCodes.filter((code) => !ids.has(code));
    if (missing.length > 0) {
      throw new AppFailure('ERR-SYS-001', {
        message: `The permission catalogue lacks ${missing.length} code(s) the ${definition.code} role requires: ${missing.join(', ')}`,
      });
    }
    for (const code of definition.permissionCodes) {
      await this.bootstrap.insertRolePermission(db, {
        roleId,
        permissionId: ids.get(code) as string,
      });
    }
    await this.bootstrap.insertUnrestrictedGrant(db, { userId: ownerAccountId, roleId });
    return roleId;
  }
}
