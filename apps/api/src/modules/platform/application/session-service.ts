/**
 * The platform operator's own session (P1-32-PRE-021).
 *
 * ## Why this exists at all
 *
 * `GET /auth/session` cannot answer for a platform operator. It declares
 * `iam.user.read`, a TENANT permission resolved by `iam.has_permission`, which
 * returns false unless the acting principal holds an active account with a role
 * in the current tenant. The genesis operator holds NO tenant role by
 * construction — `scripts/platform/genesis-platform-operator.mjs` writes an
 * account and platform grants and deliberately writes no `iam.role_grants` row —
 * so the canonical session endpoint answers 403 to the one principal the console
 * is built for. Measured, not assumed.
 *
 * So the console needs its own session read, declaring a `platform.` permission
 * so that `authorization.ts` takes the platform-authority branch.
 *
 * ## What it does NOT return, and why
 *
 * The operator's EMAIL and DISPLAY NAME are absent, and their absence is a
 * privilege fact rather than an oversight.
 *
 * `app_platform`'s SELECT on `iam.user_accounts` is COLUMN-SCOPED to
 * (id, tenant_id, status, deleted_at). The console also counts accounts per
 * organisation, which needs rows of every tenant — granted by
 * `sel_user_accounts_platform_census`. PostgreSQL column privileges are
 * table-wide while policies are row-wide, and the two cannot be combined: adding
 * `email` and `display_name` to the grant so the operator could read its OWN
 * name would, by the same grant, make every organisation's account addresses
 * readable from the control plane. That is precisely the disclosure the census
 * policy is written to prevent, so the identity columns stay out of the grant
 * and out of this response.
 *
 * Everything returned is already held by the caller — its own identifier, its
 * own home tenant, its own authority codes — so the response discloses nothing
 * a successful request had not already proved.
 */
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { PlatformRepository } from '../data/platform-repository';

/** What `platform.session-read` publishes. */
export interface PlatformSessionView {
  readonly userId: string;
  readonly homeTenantId: string;
  /**
   * The caller's own unrevoked platform authority codes, sorted.
   *
   * Read from `iam.platform_grants` under `sel_platform_grants_own`, which
   * admits the operator's own rows and nobody else's — so this cannot be used to
   * enumerate another operator's authority.
   */
  readonly platformPermissions: readonly string[];
}

export class PlatformSessionService {
  constructor(private readonly repository: PlatformRepository) {}

  async describe(db: DbHandle): Promise<PlatformSessionView> {
    const session = await this.repository.readSession(db);
    if (!session) {
      // The request authenticated but the database will not confirm the
      // principal. Fail closed rather than describing a session the session
      // GUCs do not actually carry.
      throw new AppFailure('ERR-CTX-001', {
        message: 'Resolved principal is not visible under the platform session context',
      });
    }
    return {
      userId: session.userId,
      homeTenantId: session.homeTenantId,
      platformPermissions: session.platformPermissions,
    };
  }
}
