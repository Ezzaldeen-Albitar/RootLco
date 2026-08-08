/**
 * Identity, session, and login-audit data access (P1-14).
 *
 * Every statement here carries an explicit tenant predicate **in addition to**
 * RLS. RLS is the guarantee; the predicate is the intent, and the two disagreeing
 * is a bug worth failing on rather than a redundancy worth removing.
 *
 * Two column-level facts from the protected schema shape this file, and both
 * were read from the live catalog rather than assumed:
 *
 *  - `app_runtime` holds `UPDATE (email, display_name, status, mfa_required,
 *    deleted_at)` on `iam.user_accounts` and nothing else. Attempting to update
 *    `identity_provider` or `provider_subject` is refused at the **privilege**
 *    layer with `42501`, before the immutability trigger runs. The update
 *    statements below therefore name only grantable columns; a wider statement
 *    would fail even for a correctly authorized administrator.
 *  - `shared.touch_row_metadata()` increments `record_version` on every UPDATE,
 *    so the optimistic-concurrency predicate is written but the increment is not.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { Page, PageRequest, OrderingContract } from '@/server/db/pagination';
import { buildPage, keysetFragment } from '@/server/db/pagination';

export interface AccountRow {
  readonly id: string;
  readonly tenantId: string;
  readonly identityProvider: string;
  readonly providerSubject: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: 'invited' | 'active' | 'locked' | 'archived';
  readonly mfaRequired: boolean;
  readonly deletedAt: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
}

export interface SessionRow {
  readonly id: string;
  readonly userId: string;
  readonly sessionRef: string;
  readonly issuedAt: string;
  readonly lastSeenAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly revokeReason: string | null;
}

interface AccountRecord {
  id: string;
  tenant_id: string;
  identity_provider: string;
  provider_subject: string;
  email: string;
  display_name: string;
  status: AccountRow['status'];
  mfa_required: boolean;
  deleted_at: string | null;
  record_version: number;
  created_at: string;
}

function toAccount(record: AccountRecord): AccountRow {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    identityProvider: record.identity_provider,
    providerSubject: record.provider_subject,
    email: record.email,
    displayName: record.display_name,
    status: record.status,
    mfaRequired: record.mfa_required,
    deletedAt: record.deleted_at,
    recordVersion: record.record_version,
    createdAt: record.created_at,
  };
}

const ACCOUNT_COLUMNS = `id, tenant_id, identity_provider, provider_subject, email, display_name,
                         status, mfa_required, deleted_at, record_version, created_at`;

/** Ordering contract for the user list. Total order via the id tie-breaker. */
export const USER_ORDERING: OrderingContract = Object.freeze({
  key: 'iam.user_accounts:created_at_desc',
  direction: 'desc',
});

/**
 * The minimum a ledger needs to name the person who did something
 * (`P1-27-INT-026`, `VHM-13`).
 *
 * `display_name` and nothing else. Deliberately NOT `AccountRow`: that carries
 * `email`, `provider_subject`, `status` and `mfa_required`, and a history screen
 * that wanted a name would have been handed a tenant-wide address book.
 */
export interface UserDisplayIdentity {
  readonly id: string;
  readonly displayName: string;
}

export class IdentityRepository extends Repository {
  protected readonly module = 'iam';

  /**
   * Display names for a set of user ids.
   *
   * ## Two columns, one statement, one tenant
   *
   * The projection is `id, display_name`. `iam.user_accounts.display_name` is
   * NOT NULL with a not-blank CHECK, so a resolved id always yields a usable
   * name. No password material, no provider subject, no session data, no email:
   * none is selected, and the database refuses the rest independently at the
   * privilege layer.
   *
   * `iam.user_employee_links` is a SEPARATE, temporally-valid table. A user id
   * is not an employee id, and resolving through the link would answer "which
   * employee record is current" rather than "who did this" — going wrong for
   * exactly the historical rows a ledger exists to preserve.
   *
   * A soft-deleted account still resolves. The alternative is that every record
   * written by somebody who has since left becomes anonymous, which is the
   * opposite of what an audit trail is for.
   */
  async findDisplayIdentities(
    db: DbHandle,
    userIds: readonly string[]
  ): Promise<ReadonlyMap<string, UserDisplayIdentity>> {
    const unique = [...new Set(userIds)];
    // No ids means no statement. Sending an empty array would be a round trip
    // that can only return nothing.
    if (unique.length === 0) return new Map();

    const result = await this.run<{ id: string; display_name: string }>(
      db,
      `SELECT id, display_name
         FROM iam.user_accounts
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [db.context.principal.tenantId, unique]
    );

    return new Map(
      result.rows.map((row) => [row.id, { id: row.id, displayName: row.display_name }])
    );
  }

  /**
   * Whether this caller may be told a user's name at all.
   *
   * `iam.user-detail` is guarded by `iam.user.read`. The reads that hold actor
   * ids are guarded by their own domain permission, so resolving for everybody
   * would publish a tenant-wide staff directory to anyone who can open a
   * vehicle. Checking the capability means this surface can only ever tell a
   * caller something they were already entitled to ask for one id at a time.
   */
  async mayReadUsers(db: DbHandle): Promise<boolean> {
    const result = await this.run<{ allowed: boolean }>(
      db,
      `SELECT iam.has_permission('iam.user.read') AS allowed`
    );
    return result.rows[0]?.allowed === true;
  }

  /** Reads an account by its provider identity within the context tenant. */
  async findByProviderSubject(
    db: DbHandle,
    identityProvider: string,
    providerSubject: string
  ): Promise<AccountRow | null> {
    const record = await this.runOne<AccountRecord>(
      db,
      `SELECT ${ACCOUNT_COLUMNS}
         FROM iam.user_accounts
        WHERE tenant_id = $1 AND identity_provider = $2 AND provider_subject = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      [db.context.principal.tenantId, identityProvider, providerSubject]
    );
    return record ? toAccount(record) : null;
  }

  /**
   * Reads an account by address. `citext` makes the comparison case-insensitive
   * in the database, which is where the uniqueness index lives — lower-casing in
   * TypeScript instead would disagree with the index for non-ASCII addresses.
   */
  async findByEmail(
    db: DbHandle,
    identityProvider: string,
    email: string
  ): Promise<AccountRow | null> {
    const record = await this.runOne<AccountRecord>(
      db,
      // `email` is a `citext` column, so `email = $3` (a text parameter) is
      // already case-insensitive: the comparison uses the column's citext type.
      // An explicit `$3::citext` cast is NOT used because the `citext` *type name*
      // lives in the `extensions` schema, which is deliberately absent from the
      // app_runtime search_path (and app_runtime holds no USAGE there) — so a
      // name cast raises "type citext does not exist" at runtime. See P1-14-R-008.
      `SELECT ${ACCOUNT_COLUMNS}
         FROM iam.user_accounts
        WHERE tenant_id = $1 AND identity_provider = $2 AND email = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      [db.context.principal.tenantId, identityProvider, email]
    );
    return record ? toAccount(record) : null;
  }

  async findById(db: DbHandle, userId: string): Promise<AccountRow | null> {
    const record = await this.runOne<AccountRecord>(
      db,
      `SELECT ${ACCOUNT_COLUMNS}
         FROM iam.user_accounts
        WHERE tenant_id = $1 AND id = $2
        LIMIT 1`,
      [db.context.principal.tenantId, userId]
    );
    return record ? toAccount(record) : null;
  }

  /**
   * Creates an invited account.
   *
   * `status` is written explicitly rather than left to the column default, so
   * the invariant "an invitation creates an *invited* account" is visible at the
   * call site instead of two files away.
   */
  async insertAccount(
    db: DbHandle,
    input: {
      identityProvider: string;
      providerSubject: string;
      email: string;
      displayName: string;
      mfaRequired: boolean;
    }
  ): Promise<AccountRow> {
    const record = await this.runOne<AccountRecord>(
      db,
      // `$4` (text) is assignment-cast into the `citext` email column by the
      // column's own type; no explicit `::citext` name cast is used, because the
      // type name is not on the app_runtime search_path (P1-14-R-008).
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name,
          status, mfa_required, created_by)
       VALUES ($1, $2, $3, $4, $5, 'invited', $6, $7)
       RETURNING ${ACCOUNT_COLUMNS}`,
      [
        db.context.principal.tenantId,
        input.identityProvider,
        input.providerSubject,
        input.email,
        input.displayName,
        input.mfaRequired,
        db.context.principal.userId,
      ]
    );
    return toAccount(record as AccountRecord);
  }

  /**
   * Updates the grantable profile columns under an optimistic-concurrency guard.
   *
   * Returns the row count so the caller can convert 0 into `ERR-CON-001`. Zero
   * means "stale version, out of scope, or refused by policy" and the three are
   * deliberately indistinguishable — the policy denial affects zero rows and
   * raises nothing, so an "expect an error" check here would silently pass
   * against no policy at all.
   */
  async updateProfile(
    db: DbHandle,
    userId: string,
    expectedVersion: number,
    changes: { displayName?: string; mfaRequired?: boolean }
  ): Promise<number> {
    // `updated_by` is trigger-stamped (shared.touch_row_metadata →
    // iam.current_user_id()); app_runtime holds column UPDATE on (email,
    // display_name, status, mfa_required, deleted_at) only, so naming `updated_by`
    // in the SET list is refused with 42501 before any row is touched. The R-007
    // sweep fixed the session methods but missed this one — see P1-14-R-010.
    const result = await this.run(
      db,
      `UPDATE iam.user_accounts
          SET display_name = COALESCE($4, display_name),
              mfa_required = COALESCE($5, mfa_required)
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3
          AND deleted_at IS NULL`,
      [
        db.context.principal.tenantId,
        userId,
        expectedVersion,
        changes.displayName ?? null,
        changes.mfaRequired ?? null,
      ]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Moves an account through the lifecycle graph.
   *
   * Delegates to `iam.change_user_status`, which validates the transition and
   * writes the history row in the same statement. Re-implementing either half
   * here would create a second lifecycle authority, and the history row would no
   * longer be atomic with the state change.
   */
  async changeStatus(db: DbHandle, userId: string, toState: string, reason: string): Promise<void> {
    await this.run(db, 'SELECT iam.change_user_status($1, $2, $3, $4)', [
      userId,
      toState,
      reason,
      db.context.correlationId,
    ]);
  }

  /** Cursor page of accounts in the tenant, newest first. */
  async listAccounts(
    db: DbHandle,
    request: PageRequest,
    filters: { status?: string | undefined; search?: string | undefined }
  ): Promise<Page<AccountRow>> {
    const values: unknown[] = [db.context.principal.tenantId];
    let predicate = 'WHERE tenant_id = $1 AND deleted_at IS NULL';

    if (filters.status) {
      values.push(filters.status);
      predicate += ` AND status = $${values.length}`;
    }
    if (filters.search) {
      values.push(`%${filters.search}%`);
      // Bound parameter, never interpolation. `citext` handles the case-folding
      // for the address; `display_name` is folded explicitly.
      predicate += ` AND (email::text ILIKE $${values.length} OR display_name ILIKE $${values.length})`;
    }

    const keyset = keysetFragment(
      request,
      { sort: 'created_at', id: 'id' },
      USER_ORDERING,
      values.length + 1
    );
    values.push(...keyset.values);

    const result = await this.run<AccountRecord>(
      db,
      `SELECT ${ACCOUNT_COLUMNS}
         FROM iam.user_accounts
        ${predicate} ${keyset.predicate}
        ${keyset.order} ${keyset.limitClause}`,
      values
    );

    return buildPage(result.rows.map(toAccount), request, USER_ORDERING, (row) => ({
      sortValue: row.createdAt,
      id: row.id,
    }));
  }

  // ---- Sessions ----------------------------------------------------------

  /**
   * Records a session the provider just issued.
   *
   * `session_ref` is the provider's own session identifier, so the row and the
   * bearer token refer to the same session and revoking one revokes the other's
   * effect. Inventing a reference here would leave the token unrevocable.
   *
   * `ON CONFLICT (session_ref) DO NOTHING` makes re-login with an unchanged
   * provider session idempotent rather than a unique violation.
   */
  async insertSession(
    db: DbHandle,
    input: {
      /**
       * The authenticated account the session belongs to. This is the resolved
       * account id, NOT `db.context.principal.userId`: login runs under a
       * bootstrap context whose principal is the *tenant* (there is no user yet
       * when the transaction opens), and sets `app.user_id` to the account only
       * after resolving it. Keying the session on the context principal wrote the
       * tenant id into `user_id`, which `ins_user_sessions_self`
       * (user_id = iam.current_user_id()) then rejected — login could never open a
       * session. See P1-14-R-009.
       */
      userId: string;
      sessionRef: string;
      expiresAt: Date | null;
      ipHash: string | null;
      userAgentHash: string | null;
    }
  ): Promise<void> {
    await this.run(
      db,
      `INSERT INTO iam.user_sessions
         (tenant_id, user_id, session_ref, expires_at, ip_hash, user_agent_hash,
          last_seen_at, correlation_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $2)
       ON CONFLICT (session_ref) DO NOTHING`,
      [
        db.context.principal.tenantId,
        input.userId,
        input.sessionRef,
        input.expiresAt,
        input.ipHash,
        input.userAgentHash,
        db.context.correlationId,
      ]
    );
  }

  /**
   * Revokes one session. Returns the number of rows affected.
   *
   * `revoked_at IS NULL` in the predicate matches the policy's own `USING`
   * clause: revocation is terminal, so revoking twice affects zero rows and the
   * caller treats that as success rather than as an error — logout must be
   * idempotent.
   */
  async revokeSessionByRef(db: DbHandle, sessionRef: string, reason: string): Promise<number> {
    // `updated_by` is set by the tg_user_sessions_touch_metadata trigger
    // (shared.touch_row_metadata → iam.current_user_id()); the runtime role holds
    // no column privilege on `updated_by`, so setting it explicitly here would be
    // refused. See P1-14-R-007.
    const result = await this.run(
      db,
      `UPDATE iam.user_sessions
          SET revoked_at = now(), revoke_reason = $3
        WHERE tenant_id = $1 AND session_ref = $2 AND revoked_at IS NULL`,
      [db.context.principal.tenantId, sessionRef, reason]
    );
    return result.rowCount ?? 0;
  }

  /** Revokes every live session of a user. Privileged; requires `iam.user.manage`. */
  async revokeAllSessionsFor(db: DbHandle, userId: string, reason: string): Promise<number> {
    // `updated_by` is trigger-stamped; see revokeSessionByRef and P1-14-R-007.
    const result = await this.run(
      db,
      `UPDATE iam.user_sessions
          SET revoked_at = now(), revoke_reason = $3
        WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [db.context.principal.tenantId, userId, reason]
    );
    return result.rowCount ?? 0;
  }

  async listSessions(db: DbHandle, userId: string, limit: number): Promise<readonly SessionRow[]> {
    const result = await this.run<{
      id: string;
      user_id: string;
      session_ref: string;
      issued_at: string;
      last_seen_at: string | null;
      expires_at: string | null;
      revoked_at: string | null;
      revoke_reason: string | null;
    }>(
      db,
      `SELECT id, user_id, session_ref, issued_at, last_seen_at, expires_at,
              revoked_at, revoke_reason
         FROM iam.user_sessions
        WHERE tenant_id = $1 AND user_id = $2
        ORDER BY issued_at DESC, id DESC
        LIMIT $3`,
      [db.context.principal.tenantId, userId, limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      // The reference is a provider session id. It is returned to an
      // administrator who already holds `iam.session.view_all`, and it is not a
      // credential: possessing it grants nothing without the bearer token.
      sessionRef: row.session_ref,
      issuedAt: row.issued_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      revokeReason: row.revoke_reason,
    }));
  }

  // ---- Login audit -------------------------------------------------------

  /**
   * Appends a login-audit row for the **current principal**.
   *
   * `occurred_at` is server-stamped by `iam.stamp_login_audit`, so a caller
   * cannot backdate authentication history. `ins_login_audit_self` restricts the
   * row to the current user, except for the administrative `lockout` arm.
   */
  async appendLoginAudit(
    db: DbHandle,
    input: {
      userId: string;
      eventType: 'success' | 'failure' | 'lockout' | 'logout';
      ipHash: string | null;
      userAgentHash: string | null;
      detail: string | null;
    }
  ): Promise<void> {
    await this.run(
      db,
      `INSERT INTO iam.login_audit
         (tenant_id, user_id, event_type, ip_hash, user_agent_hash, detail, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        db.context.principal.tenantId,
        input.userId,
        input.eventType,
        input.ipHash,
        input.userAgentHash,
        input.detail,
        db.context.correlationId,
      ]
    );
  }

  /**
   * Counts consecutive recent failures for an account, using the **database's**
   * clock.
   *
   * "Consecutive" is expressed as "since the last success", which is what gives
   * the reset-on-success semantics without a second counter column to keep in
   * step. The window bound stops an old, long-abandoned burst from counting
   * forever.
   */
  async countRecentFailures(db: DbHandle, userId: string, windowMinutes: number): Promise<number> {
    const record = await this.runOne<{ failures: number }>(
      db,
      `SELECT count(*)::int AS failures
         FROM iam.login_audit
        WHERE tenant_id = $1
          AND user_id   = $2
          AND event_type = 'failure'
          AND occurred_at >= now() - make_interval(mins => $3::int)
          AND occurred_at > COALESCE(
                (SELECT max(s.occurred_at)
                   FROM iam.login_audit s
                  WHERE s.tenant_id = $1 AND s.user_id = $2 AND s.event_type = 'success'),
                '-infinity'::timestamptz)`,
      [db.context.principal.tenantId, userId, windowMinutes]
    );
    return record?.failures ?? 0;
  }
}
