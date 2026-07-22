/**
 * Invitation and activation (P1-14).
 *
 * ## There is no invitation table, and that is the design
 *
 * The protected schema has no `iam.invitations`. It does not need one, because
 * the invitation *token* — its single use, its lifetime, the mail that carries
 * it — belongs to the provider (ADR-019), and the invitation *state* is already
 * expressible: `iam.user_accounts.status` defaults to `invited`, and
 * `iam.change_user_status` allows exactly `invited → active | archived`. Adding
 * a table to hold a token RootLco does not mint would be inventing schema for an
 * application convenience, which the phase's database rule forbids.
 *
 * So the three operations map onto the schema as it stands:
 *
 *   invite   → provider identity + an `invited` account (+ optional grants)
 *   cancel   → `invited → archived`, and the provider identity is disabled
 *   activate → `invited → active`, **only after the provider confirms the
 *              identity accepted its invitation**
 *
 * ## Why activation is administrative
 *
 * Every write to `iam.user_accounts` and `iam.user_status_history` is gated on
 * `iam.user.manage`, and `iam.has_permission` returns false for an account that
 * is not `active` — so an invited user cannot activate itself, and no request
 * path exists that would let it. This is not a gap being worked around: it is
 * the schema's deliberate position that lifecycle transitions have an
 * accountable administrative actor, reinforced by `iam.stamp_user_status_history`
 * overwriting `actor_id` with `iam.current_user_id()`.
 *
 * Acceptance is therefore not a rubber stamp. `activate()` asks the provider
 * whether the identity is confirmed and **refuses** if it is not, so the
 * invitee's action is a verified precondition of the administrator's.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { backendConfig } from '@/server/config/backend-config';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import { log } from '@/server/observability/logger';
import { IdentityRepository, type AccountRow } from '../data/identity-repository';
import { AuthorizationRepository } from '../data/authorization-repository';
import { IdentityPolicy } from '../domain/identity-policy';
import { CredentialPolicy } from '../domain/credential-policy';
import { DelegationPolicy } from '../domain/delegation-policy';
import type { IdentityProvider } from '../provider/identity-provider';
import { ProviderFailure } from '../provider/identity-provider';
import { toAppFailureFromProvider } from '../provider/provider-errors';

export interface InviteInput {
  readonly email: string;
  readonly displayName: string;
  readonly mfaRequired?: boolean | undefined;
  readonly redirectTo?: string | undefined;
  /** Roles to grant on acceptance. Bounded by the inviter's own authority. */
  readonly roleIds?: readonly string[] | undefined;
}

export interface InvitedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: string;
  readonly recordVersion: number;
}

function toInvited(account: AccountRow): InvitedUser {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    status: account.status,
    recordVersion: account.recordVersion,
  };
}

export class InvitationService extends ApplicationService {
  protected readonly module = 'iam';

  constructor(
    private readonly provider: IdentityProvider,
    private readonly identities: IdentityRepository,
    private readonly authorization: AuthorizationRepository,
    private readonly identityPolicy: IdentityPolicy,
    private readonly credentialPolicy: CredentialPolicy,
    private readonly delegationPolicy: DelegationPolicy
  ) {
    super();
  }

  /**
   * Invites a user into the caller's tenant.
   *
   * The tenant is taken from the resolved context and never from the request:
   * an inviter cannot invite into a tenant they do not belong to, because no
   * field of the request can express one.
   */
  async invite(db: DbHandle, input: InviteInput): Promise<InvitedUser> {
    const context = this.contextOf(db);
    const config = backendConfig();
    const redirectTo = this.credentialPolicy.resolveRedirect(
      input.redirectTo,
      config.AUTH_REDIRECT_ALLOWLIST
    );

    // Delegation is checked before the provider is touched, so a refused
    // invitation leaves no orphan identity behind.
    const roleIds = input.roleIds ?? [];
    if (roleIds.length > 0) {
      const facts = await this.delegationFacts(db);
      for (const roleId of roleIds) {
        const role = await this.authorization.findRoleById(db, roleId);
        if (!role || role.deletedAt) {
          throw new AppFailure('ERR-RES-001', { message: 'Role not found in this tenant' });
        }
        this.delegationPolicy.assertNotSystemRole(role.isSystem);
        const codes = await this.authorization.allowCodesOfRole(db, roleId);
        this.delegationPolicy.assertDelegable(facts, codes, 'allow');
      }
    }

    const existing = await this.identities.findByEmail(db, this.provider.name, input.email);
    if (existing) {
      // Deterministic duplicate behaviour: an address already known in this
      // tenant is a conflict, not a silent re-invite. Re-inviting would issue a
      // second live token for the same identity.
      throw new AppFailure('ERR-RES-002', {
        message: 'An account already exists for that address in this tenant',
      });
    }

    let identity;
    try {
      identity = await this.provider.invite({
        email: input.email,
        tenantId: context.principal.tenantId,
        redirectTo,
      });
    } catch (error) {
      toAppFailureFromProvider(error);
    }

    let account: AccountRow;
    try {
      account = await this.identities.insertAccount(db, {
        identityProvider: this.provider.name,
        providerSubject: identity.subject,
        email: input.email,
        displayName: input.displayName,
        mfaRequired: input.mfaRequired ?? false,
      });
    } catch (error) {
      // `uq_user_accounts_tenant_email_active` or the global provider-identity
      // index. A concurrent invite won; the caller's did not happen.
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-RES-002', {
          message: 'An account already exists for that address in this tenant',
        });
      }
      throw error;
    }

    for (const roleId of roleIds) {
      await this.authorization.insertGrant(db, {
        userId: account.id,
        roleId,
        scopeMode: 'unrestricted',
        validTo: null,
        approvalRef: null,
      });
    }

    await appendAudit(db, {
      action: 'iam.user.invited',
      entityType: 'iam.user_account',
      entityId: account.id,
      details: [
        // The address is `restricted`, so `iam.audit_mask` replaces it with a
        // fixed marker in the stored detail row. The audit record still proves
        // *that* an invitation happened and to which account id.
        { field: 'email', classification: 'restricted', value: input.email },
        { field: 'display_name', classification: 'internal', value: input.displayName },
        { field: 'status', classification: 'public', value: 'invited' },
      ],
    });

    await publishEvent(db, {
      eventType: 'user.invited',
      aggregateId: account.id,
      aggregateVersion: 1,
      producer: 'iam.invitation-service',
      // No address, no token, no link: the payload carries identifiers only
      // (event-catalog §4.3). The outbox is drained by an all-tenant worker.
      payload: { userId: account.id, tenantId: account.tenantId, roleCount: roleIds.length },
      eventKey: `user.invited:${account.id}`,
    });

    // The invitation mail is sent by the provider, which owns the token that
    // makes it useful. RootLco's own `NotificationService` is deliberately NOT
    // called: its contract requires `templateVersionId` — an approved, immutable
    // row in `shared.template_versions` — and no such template exists. Passing a
    // fabricated identifier to satisfy the type would be exactly the kind of
    // invented business data the no-fake-data policy forbids, and calling a
    // contract-only stub in order to swallow its `ERR-STB-001` would be theatre.
    // When Phase 1-15/1-23 delivers templates, the hook belongs here.

    return toInvited(account);
  }

  /**
   * Cancels an outstanding invitation.
   *
   * `invited → archived` is a legal transition and `archived` is terminal, so a
   * cancelled invitation can never be revived — a new invitation is a new
   * account. The provider identity is disabled so the outstanding link cannot be
   * used to sign in to an identity with no application account.
   */
  async cancel(db: DbHandle, userId: string, reason: string): Promise<void> {
    const account = await this.requireAccount(db, userId);
    if (account.status !== 'invited') {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Only an outstanding invitation can be cancelled',
        safeDetails: { violations: [{ path: 'path.userId', rule: 'not_invited' }] },
      });
    }
    const checked = this.identityPolicy.assertReason(reason);
    this.identityPolicy.assertTransition('invited', 'archived');

    await this.identities.changeStatus(db, userId, 'archived', checked);

    if (this.provider.supportsDisable) {
      try {
        await this.provider.setDisabled(account.providerSubject, true);
      } catch (error) {
        // The application account is already archived, which is what removes
        // every permission. Report the provider failure rather than rolling back
        // a correct local state change.
        log.warn('Provider identity could not be disabled after cancelling an invitation', {
          module: 'iam',
          operation: 'iam.invitation.cancel',
          correlationId: db.context.correlationId,
          tenantRef: db.context.principal.tenantId,
          actorRef: db.context.principal.userId,
          result: 'failure',
          context: { reason: error instanceof ProviderFailure ? error.reason : 'unknown' },
        });
      }
    }

    await appendAudit(db, {
      action: 'iam.user.invitation_cancelled',
      entityType: 'iam.user_account',
      entityId: userId,
      details: [
        { field: 'status', classification: 'public', previousValue: 'invited', value: 'archived' },
        { field: 'reason', classification: 'internal', value: checked },
      ],
    });

    await publishEvent(db, {
      eventType: 'user.status.changed',
      aggregateId: userId,
      aggregateVersion: account.recordVersion + 1,
      producer: 'iam.invitation-service',
      payload: { userId, from: 'invited', to: 'archived' },
      eventKey: `user.status.changed:${userId}:archived:${db.context.correlationId}`,
    });
  }

  /**
   * Activates an invited account after verifying acceptance with the provider.
   *
   * The provider check is the whole point of this method: it is what makes the
   * invitee's acceptance a real precondition rather than an assumption. An
   * unconfirmed identity is refused, so an administrator cannot activate an
   * account whose invitation was never accepted — which would otherwise create a
   * live account nobody has ever authenticated as.
   */
  async activate(db: DbHandle, userId: string, reason: string): Promise<InvitedUser> {
    const account = await this.requireAccount(db, userId);
    const checked = this.identityPolicy.assertReason(reason);
    this.identityPolicy.assertTransition(account.status, 'active');

    let identity;
    try {
      identity = await this.provider.findBySubject(account.providerSubject);
    } catch (error) {
      toAppFailureFromProvider(error);
    }
    if (!identity) {
      throw new AppFailure('ERR-RES-001', {
        message: 'The provider identity for this account no longer exists',
      });
    }
    if (!identity.confirmed) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The invitation has not been accepted with the identity provider yet',
        safeDetails: { violations: [{ path: 'path.userId', rule: 'invitation_not_accepted' }] },
      });
    }
    if (identity.disabled) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The provider identity is disabled and cannot be activated',
        safeDetails: { violations: [{ path: 'path.userId', rule: 'identity_disabled' }] },
      });
    }

    await this.identities.changeStatus(db, userId, 'active', checked);

    await appendAudit(db, {
      action: 'iam.user.activated',
      entityType: 'iam.user_account',
      entityId: userId,
      details: [
        {
          field: 'status',
          classification: 'public',
          previousValue: account.status,
          value: 'active',
        },
        { field: 'reason', classification: 'internal', value: checked },
      ],
    });

    await publishEvent(db, {
      eventType: 'user.status.changed',
      aggregateId: userId,
      aggregateVersion: account.recordVersion + 1,
      producer: 'iam.invitation-service',
      payload: { userId, from: account.status, to: 'active' },
      eventKey: `user.status.changed:${userId}:active:${db.context.correlationId}`,
    });

    const refreshed = await this.identities.findById(db, userId);
    return toInvited(refreshed ?? account);
  }

  private async requireAccount(db: DbHandle, userId: string): Promise<AccountRow> {
    const account = await this.identities.findById(db, userId);
    if (!account || account.deletedAt) {
      // Indistinguishable from "exists in another tenant" by design.
      throw new AppFailure('ERR-RES-001', { message: 'User not found in this tenant' });
    }
    return account;
  }

  /** Reads the caller's own delegable authority, measured in the database. */
  private async delegationFacts(db: DbHandle) {
    const context = this.contextOf(db);
    return {
      actorUserId: context.principal.userId,
      actorPermissions: await this.authorization.effectivePermissionsOfCaller(db),
      actorUnrestricted: context.companyIds.length === 0 && context.branchIds.length === 0,
      actorCompanyIds: new Set(context.companyIds),
      actorBranchIds: new Set(context.branchIds),
    };
  }
}
