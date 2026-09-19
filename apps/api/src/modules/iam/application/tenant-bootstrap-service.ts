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
import type { IdentityRepository } from '../data/identity-repository';
import type { TenantBootstrapRepository } from '../data/tenant-bootstrap-repository';
import type { CredentialPolicy } from '../domain/credential-policy';
import type { IdentityProvider } from '../provider/identity-provider';
import { toAppFailureFromProvider } from '../provider/provider-errors';
import { removeIdentityCreatedHere } from './identity-compensation';
import { throwCapacityFailure } from './capacity-failure';
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

/**
 * What the console asks for when an organisation needs an administrator.
 *
 * `additionalAdministrator` is the explicit acknowledgement that the
 * organisation already has one: the operation refuses by default, because
 * silently adding a second administrator to a live organisation is how an
 * account nobody asked for comes to exist. `reason` travels with it into the
 * audit record; it is required when the flag is set and refused otherwise.
 */
export interface AdministratorSetupInput {
  readonly email: string;
  readonly displayName: string;
  readonly additionalAdministrator: boolean;
  readonly reason?: string | undefined;
  readonly redirectTo?: string | undefined;
}

/** What an administrator setup or a re-invitation established. */
export interface AdministratorSetupResult {
  /**
   * `established` — an administrator account was written and granted the
   * tenant_administrator role. `reinvited` — nothing was written and the
   * provider issued a fresh link for an invitation already outstanding.
   */
  readonly outcome: 'established' | 'reinvited';
  /** The account established, or null for a re-invitation. */
  readonly accountId: string | null;
  /** The role granted, or null for a re-invitation. */
  readonly tenantAdministratorRoleId: string | null;
  /** Whether the role had to be created because the organisation held none. */
  readonly roleEstablished: boolean;
  /** Active administrators the organisation held BEFORE this act. */
  readonly administratorsBefore: number;
}

export class TenantBootstrapService {
  constructor(
    private readonly bootstrap: TenantBootstrapRepository,
    private readonly identities: IdentityRepository,
    private readonly provider: IdentityProvider,
    private readonly credentialPolicy: CredentialPolicy
  ) {}

  async bootstrapFirstOwner(
    db: PlatformTargetHandle,
    input: FirstOwnerInput
  ): Promise<FirstOwnerBootstrap> {
    // The provider is one directory for the whole platform, and this service
    // reads, binds and invites identities in it exactly as an invitation does.
    // Taking the same lower-cased address lock before the first identity read
    // serializes a first-owner setup with every invitation of that address, in
    // any tenant, so neither can act on a read the other is about to overturn —
    // above all, a refused invitation cannot remove an identity this bootstrap
    // has just bound. As in `iam.invitation-create`, it is taken before the
    // per-tenant user capacity lock the account INSERT below takes.
    await this.identities.lockInvitationAddress(db, input.email);

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

  /**
   * Gives a LIVE organisation an administrator, from the Platform Owner Console.
   *
   * The provisioning bootstrap above cannot serve this. It runs inside the
   * window of a tenant the same transaction created, and the case this method
   * exists for is the opposite one: an organisation that is already running and
   * has no administrator who can sign in — because the first owner never
   * accepted their link, because the account was archived, or because the
   * organisation predates the bootstrap entirely. Until now the only way out was
   * a manual database write.
   *
   * What it REUSES rather than restates:
   *
   *  - the invitation address lock, taken before the first identity read, so a
   *    console setup and a tenant-side invitation of the same address cannot act
   *    on a reading the other is about to overturn;
   *  - the identity rules of the first-owner bootstrap — an address bound to a
   *    LIVE organisation elsewhere is a conflict, a binding to an organisation
   *    that no longer exists is re-bound;
   *  - the refusal recovery of `iam.invitation-create`: an identity this request
   *    created is removed again when the account INSERT is refused, so a spent
   *    seat ceiling does not leave an orphan behind that blocks the retry;
   *  - the seat ceiling itself, which is `tg_user_accounts_capacity` on the
   *    table and is mapped, never pre-checked.
   *
   * What it adds is the ADMINISTRATOR question, which the provisioning path
   * never has to ask because a tenant being born has nobody: an organisation
   * that already has an active administrator is refused unless the operator says
   * explicitly that a second one is wanted, and says why.
   */
  async establishAdministrator(
    db: PlatformTargetHandle,
    input: AdministratorSetupInput
  ): Promise<AdministratorSetupResult> {
    const administratorsBefore = await this.bootstrap.activeAdministratorCount(
      db,
      TENANT_ADMINISTRATOR_ROLE.code
    );
    if (administratorsBefore > 0 && !input.additionalAdministrator) {
      throw new AppFailure('ERR-TRN-001', {
        message:
          'This organisation already has an active administrator; ask for an additional one explicitly, with a reason',
      });
    }

    await this.identities.lockInvitationAddress(db, input.email);

    const identity = await this.establishAdministratorIdentity(db, input);

    let accountId: string;
    try {
      accountId = await this.bootstrap.insertActiveAccount(db, {
        identityProvider: this.provider.name,
        providerSubject: identity.subject,
        email: input.email,
        displayName: input.displayName,
      });
    } catch (error) {
      // Never on a unique violation: that refusal is itself the proof that a
      // live account already references the address or the subject, so the
      // identity is bound to somebody and is not this request's to remove.
      const referenced = isSqlState(error, SQLSTATE.uniqueViolation);
      if (identity.createdHere && !referenced) {
        await removeIdentityCreatedHere(
          this.provider,
          db,
          identity.subject,
          'platform.organization-administrator-invite'
        );
      }
      if (referenced) {
        throw new AppFailure('ERR-RES-002', {
          message: 'An account already exists for that address in this organisation',
        });
      }
      // The seat ceiling. tg_user_accounts_capacity counts and refuses under one
      // per-tenant advisory lock, so the refusal is the authority and this is the
      // mapping that gives it a name the console can render.
      throwCapacityFailure(error);
    }

    await this.bootstrap.insertActivationHistory(db, {
      userId: accountId,
      reason: 'administrator established from the platform console',
    });

    const existingRoleId = await this.bootstrap.findRoleIdByCode(
      db,
      TENANT_ADMINISTRATOR_ROLE.code
    );
    const roleEstablished = existingRoleId === null;
    const tenantAdministratorRoleId =
      existingRoleId ?? (await this.establishRole(db, accountId, TENANT_ADMINISTRATOR_ROLE));
    if (existingRoleId !== null) {
      await this.bootstrap.insertUnrestrictedGrant(db, {
        userId: accountId,
        roleId: existingRoleId,
      });
    }

    // Read back through the policy set rather than assumed from the write:
    // exactly one unrestricted grant, no more and no fewer. Any other count
    // means a write was admitted that this service did not make, or one it made
    // was not.
    const granted = await this.bootstrap.grantedRoleCount(db, accountId);
    if (granted !== 1) {
      throw new AppFailure('ERR-SYS-001', {
        message: `Administrator setup left ${granted} active grant(s); expected exactly 1`,
      });
    }

    return {
      outcome: 'established',
      accountId,
      tenantAdministratorRoleId,
      roleEstablished,
      administratorsBefore,
    };
  }

  /**
   * Issues a fresh invitation link for an address this organisation has already
   * invited and which has not been accepted.
   *
   * Nothing is written: the account, if there is one, is exactly as it was, and
   * the provider re-issues the link against the SAME subject. The three
   * refusals are the readings that make the act meaningful — an address the
   * provider does not know, one bound to another organisation, and one whose
   * invitation was already accepted or whose identity was disabled. The first
   * two answer identically, because telling an operator that an address belongs
   * to a different organisation would be answering a question about somebody
   * else's tenant.
   */
  async reinviteAdministrator(
    db: PlatformTargetHandle,
    input: { readonly email: string; readonly redirectTo?: string | undefined }
  ): Promise<AdministratorSetupResult> {
    const administratorsBefore = await this.bootstrap.activeAdministratorCount(
      db,
      TENANT_ADMINISTRATOR_ROLE.code
    );
    await this.identities.lockInvitationAddress(db, input.email);

    const redirectTo = this.credentialPolicy.resolveRedirect(
      input.redirectTo,
      backendConfig().AUTH_REDIRECT_ALLOWLIST
    );
    try {
      const known = await this.provider.findByEmail(input.email);
      if (known === null || known.tenantId !== db.targetTenantId) {
        throw new AppFailure('ERR-RES-001', {
          message: 'No outstanding invitation for that address in this organisation',
        });
      }
      if (known.disabled) {
        throw new AppFailure('ERR-TRN-001', {
          message: 'The identity for that address is disabled and cannot be invited again',
        });
      }
      if (known.confirmed) {
        throw new AppFailure('ERR-TRN-001', {
          message: 'That invitation has already been accepted; there is nothing to send again',
        });
      }
      await this.provider.invite({
        email: input.email,
        tenantId: db.targetTenantId,
        redirectTo,
      });
    } catch (error) {
      if (error instanceof AppFailure) throw error;
      toAppFailureFromProvider(error);
    }

    return {
      outcome: 'reinvited',
      accountId: null,
      tenantAdministratorRoleId: null,
      roleEstablished: false,
      administratorsBefore,
    };
  }

  /**
   * The identity half of an administrator setup on a LIVE organisation.
   *
   * The same three readings the first-owner bootstrap makes, plus a disabled
   * identity — which provisioning never meets, because a tenant being born has
   * no cancelled invitations behind it — and the `createdHere` flag the refusal
   * recovery needs. A confirmed identity already bound here is left alone: it
   * has a credential, and re-inviting it would throw at the provider.
   */
  private async establishAdministratorIdentity(
    db: PlatformTargetHandle,
    input: AdministratorSetupInput
  ): Promise<{ readonly subject: string; readonly createdHere: boolean }> {
    const redirectTo = this.credentialPolicy.resolveRedirect(
      input.redirectTo,
      backendConfig().AUTH_REDIRECT_ALLOWLIST
    );
    const tenantId = db.targetTenantId;
    try {
      const existing = await this.provider.findByEmail(input.email);
      if (existing) {
        if (existing.disabled) {
          throw new AppFailure('ERR-RES-002', {
            message: 'The identity for that address is disabled and may not be reused',
          });
        }
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
        if (!existing.confirmed) {
          await this.provider.invite({ email: input.email, tenantId, redirectTo });
        }
        return { subject: existing.subject, createdHere: false };
      }
      const invited = await this.provider.invite({ email: input.email, tenantId, redirectTo });
      return { subject: invited.subject, createdHere: true };
    } catch (error) {
      if (error instanceof AppFailure) throw error;
      toAppFailureFromProvider(error);
    }
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
