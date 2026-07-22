/**
 * User administration (P1-14): listing, detail, profile update, status changes,
 * administrative session revocation.
 *
 * ## Mass assignment is prevented by shape, not by filtering
 *
 * `updateProfile()` takes exactly two optional fields. There is no
 * "apply the request body to the row" path anywhere in this file, so a caller
 * cannot smuggle `status`, `tenant_id`, `identity_provider`, or `record_version`
 * into an update by adding a key — the parameter type has no place to put them,
 * and the SQL names only the two columns. The database agrees independently:
 * `app_runtime` holds `UPDATE (email, display_name, status, mfa_required,
 * deleted_at)` and nothing else, and `org.guard_immutable_columns` freezes the
 * identity columns on top of that.
 *
 * ## Status changes go through the database function
 *
 * `iam.change_user_status` validates the transition graph and writes the history
 * row in the same statement, with `actor_id` overwritten by
 * `iam.stamp_user_status_history` to the current principal. Doing it here in two
 * statements would let a partial failure leave a state change with no history,
 * and would let the caller name an actor.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page, type PageRequest } from '@/server/db/pagination';
import { assertVersionMatched } from '@/server/db/concurrency';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { IdentityRepository, USER_ORDERING, type AccountRow } from '../data/identity-repository';
import { AuthorizationRepository } from '../data/authorization-repository';
import { IdentityPolicy, type AccountState } from '../domain/identity-policy';
import { DelegationPolicy } from '../domain/delegation-policy';
import type { IdentityProvider } from '../provider/identity-provider';

/** What a user record looks like on the wire. */
export interface UserView {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: AccountState;
  readonly mfaRequired: boolean;
  readonly createdAt: string;
  readonly recordVersion: number;
}

export interface UserDetailView extends UserView {
  readonly grants: readonly {
    readonly id: string;
    readonly roleId: string;
    readonly scopeMode: string;
    readonly status: string;
    readonly validFrom: string;
    readonly validTo: string | null;
  }[];
}

/**
 * Fields deliberately absent from every view above: `identity_provider`,
 * `provider_subject`, `deleted_at`, `created_by`, `updated_by`. The provider
 * subject in particular is an identifier at the authentication provider; it is
 * not a credential, but publishing it to every reader of a user list would widen
 * the blast radius of a compromise for no operational benefit.
 */
function toUserView(account: AccountRow): UserView {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    status: account.status,
    mfaRequired: account.mfaRequired,
    createdAt: account.createdAt,
    recordVersion: account.recordVersion,
  };
}

export class UserAdministrationService extends ApplicationService {
  protected readonly module = 'iam';

  constructor(
    private readonly provider: IdentityProvider,
    private readonly identities: IdentityRepository,
    private readonly authorization: AuthorizationRepository,
    private readonly identityPolicy: IdentityPolicy,
    private readonly delegationPolicy: DelegationPolicy
  ) {
    super();
  }

  /**
   * Takes the raw page inputs rather than a built `PageRequest`.
   *
   * That keeps cursor decoding — which is data-layer work — out of the Route
   * Handler, where the module-boundary rule (B4) correctly forbids it. The
   * handler validates `cursor` and `limit` as strings and hands them over; the
   * ordering contract they belong to is this service's business, not the
   * handler's.
   */
  async list(
    db: DbHandle,
    page: { cursor?: string | undefined; limit?: number | undefined },
    filters: { status?: string | undefined; search?: string | undefined }
  ): Promise<Page<UserView>> {
    const request: PageRequest = pageRequest(USER_ORDERING, page);
    const result = await this.identities.listAccounts(db, request, filters);
    return { ...result, items: result.items.map(toUserView) };
  }

  async detail(db: DbHandle, userId: string): Promise<UserDetailView> {
    const account = await this.requireAccount(db, userId);
    const grants = await this.authorization.listGrantsForUser(db, userId);
    return {
      ...toUserView(account),
      grants: grants.map((grant) => ({
        id: grant.id,
        roleId: grant.roleId,
        scopeMode: grant.scopeMode,
        status: grant.status,
        validFrom: grant.validFrom,
        validTo: grant.validTo,
      })),
    };
  }

  /** Updates the two mutable profile fields under an optimistic-concurrency guard. */
  async updateProfile(
    db: DbHandle,
    userId: string,
    expectedVersion: number,
    changes: { displayName?: string | undefined; mfaRequired?: boolean | undefined }
  ): Promise<UserView> {
    const before = await this.requireAccount(db, userId);
    if (changes.displayName === undefined && changes.mfaRequired === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'No updatable field was supplied',
        safeDetails: { violations: [{ path: 'body', rule: 'empty_update' }] },
      });
    }

    const affected = await this.identities.updateProfile(db, userId, expectedVersion, {
      ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
      ...(changes.mfaRequired !== undefined ? { mfaRequired: changes.mfaRequired } : {}),
    });
    // Zero rows is a stale version, an out-of-scope row, or a policy refusal —
    // all answered identically, because distinguishing them leaks existence.
    assertVersionMatched(affected);

    await appendAudit(db, {
      action: 'iam.user.updated',
      entityType: 'iam.user_account',
      entityId: userId,
      details: [
        ...(changes.displayName !== undefined
          ? [
              {
                field: 'display_name',
                classification: 'internal' as const,
                previousValue: before.displayName,
                value: changes.displayName,
              },
            ]
          : []),
        ...(changes.mfaRequired !== undefined
          ? [
              {
                field: 'mfa_required',
                classification: 'internal' as const,
                previousValue: String(before.mfaRequired),
                value: String(changes.mfaRequired),
              },
            ]
          : []),
      ],
    });

    const after = await this.identities.findById(db, userId);
    return toUserView(after ?? before);
  }

  /**
   * Moves an account between lifecycle states.
   *
   * Two application rules layer on top of the database's transition graph:
   *
   *  - an administrator may not change their **own** status, because locking or
   *    archiving yourself is either an accident or an attempt to escape a
   *    revocation, and neither is a workflow;
   *  - archiving or locking the last holder of a permission is refused, so a
   *    tenant cannot be left with nobody able to administer it.
   */
  async changeStatus(
    db: DbHandle,
    userId: string,
    toState: AccountState,
    reason: string
  ): Promise<UserView> {
    const context = this.contextOf(db);
    const account = await this.requireAccount(db, userId);
    const checked = this.identityPolicy.assertReason(reason);
    this.identityPolicy.assertTransition(account.status, toState);

    const facts = await this.delegationFacts(db);
    this.delegationPolicy.assertNotSelf(facts, userId, 'change');

    // Losing `active` removes every permission (`iam.has_permission` requires an
    // active account), so both `locked` and `archived` must respect last-holder
    // protection. Counting happens `FOR UPDATE` inside this transaction.
    if (account.status === 'active' && toState !== 'active') {
      const remaining = await this.authorization.countOtherHoldersOf(db, 'iam.user.manage', userId);
      this.delegationPolicy.assertNotLastHolder(remaining, 'iam.user.manage');
    }

    await this.identities.changeStatus(db, userId, toState, checked);

    // Losing `active` also means every live session must go. Without this a
    // locked account keeps working until its tokens expire, which is precisely
    // the "revocation takes effect immediately" requirement.
    let revokedSessions = 0;
    if (toState !== 'active') {
      revokedSessions = await this.identities.revokeAllSessionsFor(
        db,
        userId,
        `Account moved to ${toState}.`
      );
      await this.revokeProviderSessions(db, account);
    }

    const action =
      toState === 'active'
        ? 'iam.user.unlocked'
        : toState === 'locked'
          ? 'iam.user.locked'
          : 'iam.user.archived';

    await appendAudit(db, {
      action,
      entityType: 'iam.user_account',
      entityId: userId,
      details: [
        {
          field: 'status',
          classification: 'public',
          previousValue: account.status,
          value: toState,
        },
        { field: 'reason', classification: 'internal', value: checked },
        { field: 'sessions_revoked', classification: 'internal', value: String(revokedSessions) },
      ],
    });

    await publishEvent(db, {
      eventType: 'user.status.changed',
      aggregateId: userId,
      aggregateVersion: account.recordVersion + 1,
      producer: 'iam.user-administration-service',
      payload: { userId, from: account.status, to: toState },
      eventKey: `user.status.changed:${userId}:${toState}:${context.correlationId}`,
    });

    const after = await this.identities.findById(db, userId);
    return toUserView(after ?? account);
  }

  /** Lists a user's sessions. Requires `iam.session.view_all` at the operation. */
  async listSessions(db: DbHandle, userId: string) {
    await this.requireAccount(db, userId);
    return this.identities.listSessions(db, userId, 100);
  }

  /**
   * Revokes every live session of a user.
   *
   * Revocation is terminal in the database (`revoked_at IS NULL` in both UPDATE
   * policies' `USING`), so this cannot be undone and a revoked session cannot be
   * resurrected — which is why it is audited as a security-class action.
   */
  async revokeAllSessions(db: DbHandle, userId: string, reason: string): Promise<number> {
    const account = await this.requireAccount(db, userId);
    const checked = this.identityPolicy.assertReason(reason);

    const revoked = await this.identities.revokeAllSessionsFor(db, userId, checked);
    await this.revokeProviderSessions(db, account);

    await appendAudit(db, {
      action: 'iam.session.revoked_all',
      entityType: 'iam.user_account',
      entityId: userId,
      details: [
        { field: 'sessions_revoked', classification: 'internal', value: String(revoked) },
        { field: 'reason', classification: 'internal', value: checked },
      ],
    });

    await publishEvent(db, {
      eventType: 'session.revoked',
      aggregateId: userId,
      aggregateVersion: 1,
      producer: 'iam.user-administration-service',
      payload: { userId, revokedCount: revoked, scope: 'all' },
      eventKey: `session.revoked:${userId}:${db.context.correlationId}`,
    });

    return revoked;
  }

  /**
   * Best-effort provider-side revocation.
   *
   * The RootLco session rows are already revoked at this point, and context
   * resolution refuses a revoked session — so the caller is locked out of this
   * application regardless. Failing the command because the provider was
   * unreachable would roll back a correct local revocation, which is strictly
   * worse. The failure is recorded, not swallowed silently.
   */
  private async revokeProviderSessions(db: DbHandle, account: AccountRow): Promise<void> {
    try {
      await this.provider.revokeAllSessions(account.providerSubject);
    } catch {
      await appendAudit(db, {
        action: 'iam.session.revoked_all',
        entityType: 'iam.user_account',
        entityId: account.id,
        details: [
          {
            field: 'provider_revocation',
            classification: 'internal',
            value: 'failed; local sessions were revoked',
          },
        ],
      });
    }
  }

  private async requireAccount(db: DbHandle, userId: string): Promise<AccountRow> {
    const account = await this.identities.findById(db, userId);
    if (!account || account.deletedAt) {
      throw new AppFailure('ERR-RES-001', { message: 'User not found in this tenant' });
    }
    return account;
  }

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
