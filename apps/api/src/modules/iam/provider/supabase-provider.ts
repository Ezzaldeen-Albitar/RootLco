/**
 * Supabase Auth adapter (P1-14, ADR-019).
 *
 * The one file in the codebase that knows Supabase Auth exists. Everything above
 * it speaks `IdentityProvider`, so replacing the provider is a change here plus
 * its tests — which is the reversibility ADR-019 bought by rejecting a direct
 * SDK dependency in application services.
 *
 * ## Two clients, deliberately
 *
 * - **The anon client** performs sign-in and the password-reset *request*. These
 *   are the operations an end user is entitled to trigger, and running them under
 *   the anon key means the provider applies its own rate limiting and abuse
 *   controls to them.
 * - **The service-role client** performs administrative operations: invite, look
 *   up by subject, confirm, disable, revoke-all. The service-role key bypasses
 *   RLS in PostgreSQL, so it is read through `serverEnv()` (which throws in a
 *   browser), it is never placed in a client bundle, and it never appears in a
 *   log, metric label, audit record, or problem document.
 *
 * ## Token verification is local
 *
 * `verifyToken` does not call the provider. It verifies the signature against
 * the configured secret with the strict verifier in `token-verifier.ts`. A
 * network call per request would make authentication as available as the
 * provider and as slow as a round trip, for no additional guarantee: revocation
 * is enforced against `iam.user_sessions`, not against the provider.
 *
 * ## Errors
 *
 * Every provider error is translated into a `ProviderFailure` with a reason and
 * a message written here. The provider's own message is never forwarded: it
 * distinguishes "user not found" from "invalid password", which is precisely the
 * distinction the login endpoint exists to hide.
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import {
  ProviderFailure,
  type IdentityProvider,
  type InviteRequest,
  type PasswordResetRequest,
  type ProviderIdentity,
  type ProviderSession,
  type VerifiedToken,
} from './identity-provider';
import { verifyBearerToken } from './token-verifier';

export interface SupabaseProviderOptions {
  readonly url: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
  readonly jwtSecret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly algorithms: readonly string[];
  readonly clockSkewSeconds: number;
  /** Value written to `iam.user_accounts.identity_provider`. */
  readonly providerName: string;
}

/**
 * How many identities a directory lookup will consider.
 *
 * A bound, stated rather than hidden. `filter` is a substring match, so an
 * address that happens to be a substring of many others could in principle push
 * the exact match past this page — in which case the lookup returns null and the
 * attempt is recorded as unattributable, never as a different account. Failing
 * to attribute is the safe direction; attributing to the wrong identity is not.
 */
const DIRECTORY_PAGE_SIZE = 200;

/** Anything the SDK throws or returns as `{ error }`, narrowed safely. */
interface SupabaseErrorish {
  readonly status?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
}

function statusOf(error: unknown): number | null {
  const value = (error as SupabaseErrorish | null)?.status;
  return typeof value === 'number' ? value : null;
}

/**
 * Maps a provider error onto a RootLco reason.
 *
 * Status-driven rather than message-driven: provider messages are not a stable
 * contract and change between releases, whereas the status classes do not.
 */
function translate(error: unknown, fallback: ProviderFailure): ProviderFailure {
  const status = statusOf(error);
  if (status === 401 || status === 400) {
    return new ProviderFailure('invalid-credentials', 'Credentials did not verify.');
  }
  if (status === 403) {
    return new ProviderFailure('identity-unavailable', 'The provider refused this identity.');
  }
  if (status === 409 || status === 422) {
    return new ProviderFailure('identity-conflict', 'The identity conflicts with an existing one.');
  }
  if (status !== null && status >= 500) {
    return new ProviderFailure(
      'provider-unavailable',
      'The identity provider returned a fault.',
      true
    );
  }
  return fallback;
}

function unavailable(cause: unknown): ProviderFailure {
  const status = statusOf(cause);
  if (status !== null)
    return translate(cause, new ProviderFailure('provider-rejected', 'Rejected.'));
  return new ProviderFailure('provider-unavailable', 'The identity provider is unreachable.', true);
}

export class SupabaseIdentityProvider implements IdentityProvider {
  readonly name: string;
  readonly supportsDisable = true;

  private readonly anon: SupabaseClient;
  private readonly admin: SupabaseClient;

  constructor(private readonly options: SupabaseProviderOptions) {
    this.name = options.providerName;
    // `persistSession: false` on both: this process serves many principals and
    // must never hold one caller's session on a shared client.
    const shared = { auth: { persistSession: false, autoRefreshToken: false } };
    this.anon = createClient(options.url, options.anonKey, shared);
    this.admin = createClient(options.url, options.serviceRoleKey, shared);
  }

  private identityOf(user: User): ProviderIdentity {
    const metadata = (user.app_metadata ?? {}) as Record<string, unknown>;
    return {
      subject: user.id,
      email: user.email ?? '',
      // GoTrue records confirmation on `email_confirmed_at` / `confirmed_at`.
      confirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at),
      // `banned_until` in the future is GoTrue's disable mechanism.
      disabled: this.isBanned(user),
      tenantId: typeof metadata.tenant_id === 'string' ? metadata.tenant_id : null,
    };
  }

  private isBanned(user: User): boolean {
    const until = (user as unknown as { banned_until?: unknown }).banned_until;
    if (typeof until !== 'string') return false;
    const parsed = Date.parse(until);
    return Number.isFinite(parsed) && parsed > Date.now();
  }

  async authenticate(email: string, password: string): Promise<ProviderSession> {
    let result;
    try {
      result = await this.anon.auth.signInWithPassword({ email, password });
    } catch (cause) {
      throw unavailable(cause);
    }
    if (result.error || !result.data.session || !result.data.user) {
      throw translate(
        result.error,
        new ProviderFailure('invalid-credentials', 'Credentials did not verify.')
      );
    }

    const { session, user } = result.data;
    const identity = this.identityOf(user);
    if (identity.disabled) {
      // Uniform with a bad password: the caller must not learn that the address
      // exists and is merely suspended.
      throw new ProviderFailure('invalid-credentials', 'Credentials did not verify.');
    }

    // `expires_at` is epoch seconds; `expires_in` is a duration. Prefer the
    // absolute value and fall back rather than assuming either is present.
    const expiresAt = session.expires_at
      ? new Date(session.expires_at * 1000)
      : new Date(Date.now() + (session.expires_in ?? 3600) * 1000);

    // The session reference is read from the token rather than invented, so it
    // matches what `verifyToken` will later report for the same session.
    const sessionRef =
      this.sessionRefOf(session.access_token) ?? `${user.id}:${expiresAt.getTime()}`;

    return {
      subject: user.id,
      email: identity.email,
      accessToken: session.access_token,
      refreshToken: session.refresh_token ?? null,
      expiresAt,
      sessionRef,
      tenantId: identity.tenantId,
    };
  }

  /** Reads `session_id` out of an already-issued token without verifying it. */
  private sessionRefOf(accessToken: string): string | null {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        session_id?: unknown;
      };
      return typeof decoded.session_id === 'string' ? decoded.session_id : null;
    } catch {
      return null;
    }
  }

  async verifyToken(token: string): Promise<VerifiedToken> {
    return verifyBearerToken(token, {
      secret: this.options.jwtSecret,
      issuer: this.options.issuer,
      audience: this.options.audience,
      algorithms: this.options.algorithms,
      clockSkewSeconds: this.options.clockSkewSeconds,
    });
  }

  async refreshSession(refreshToken: string): Promise<ProviderSession> {
    let result;
    try {
      result = await this.anon.auth.refreshSession({ refresh_token: refreshToken });
    } catch (cause) {
      throw unavailable(cause);
    }
    if (result.error || !result.data.session || !result.data.user) {
      throw translate(
        result.error,
        new ProviderFailure('invalid-token', 'Refresh token is not valid.')
      );
    }
    const { session, user } = result.data;
    const identity = this.identityOf(user);
    const expiresAt = session.expires_at
      ? new Date(session.expires_at * 1000)
      : new Date(Date.now() + (session.expires_in ?? 3600) * 1000);
    return {
      subject: user.id,
      email: identity.email,
      accessToken: session.access_token,
      refreshToken: session.refresh_token ?? null,
      expiresAt,
      sessionRef: this.sessionRefOf(session.access_token) ?? `${user.id}:${expiresAt.getTime()}`,
      tenantId: identity.tenantId,
    };
  }

  async revokeSession(accessToken: string): Promise<void> {
    // A scoped client carrying only this access token, so the sign-out applies
    // to that session and cannot reach another caller's.
    const scoped = createClient(this.options.url, this.options.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    try {
      // Logout must be idempotent: an already-invalid token is not an error.
      await scoped.auth.signOut({ scope: 'local' });
    } catch (cause) {
      throw unavailable(cause);
    }
  }

  async revokeAllSessions(subject: string): Promise<void> {
    try {
      const { error } = await this.admin.auth.admin.signOut(subject, 'global');
      if (error && statusOf(error) !== 404) {
        throw translate(error, new ProviderFailure('provider-rejected', 'Sign-out was refused.'));
      }
    } catch (cause) {
      if (cause instanceof ProviderFailure) throw cause;
      throw unavailable(cause);
    }
  }

  async requestPasswordReset(request: PasswordResetRequest): Promise<void> {
    try {
      const { error } = await this.anon.auth.resetPasswordForEmail(request.email, {
        redirectTo: request.redirectTo,
      });
      // An unknown address is NOT an error here, and must not become one: the
      // endpoint above answers identically either way.
      if (error && statusOf(error) !== 404 && statusOf(error) !== 400) {
        throw translate(error, new ProviderFailure('provider-rejected', 'Reset was refused.'));
      }
    } catch (cause) {
      if (cause instanceof ProviderFailure) throw cause;
      throw unavailable(cause);
    }
  }

  async completePasswordReset(
    recoveryToken: string,
    newPassword: string
  ): Promise<ProviderIdentity> {
    let verified;
    try {
      // The provider owns the token: it verifies, consumes, and time-bounds it.
      verified = await this.anon.auth.verifyOtp({ token_hash: recoveryToken, type: 'recovery' });
    } catch (cause) {
      throw unavailable(cause);
    }
    if (verified.error || !verified.data.session || !verified.data.user) {
      throw translate(
        verified.error,
        new ProviderFailure('invalid-token', 'Recovery token is not valid.')
      );
    }

    const scoped = createClient(this.options.url, this.options.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${verified.data.session.access_token}` } },
    });
    let updated;
    try {
      updated = await scoped.auth.updateUser({ password: newPassword });
    } catch (cause) {
      throw unavailable(cause);
    }
    if (updated.error || !updated.data.user) {
      throw translate(
        updated.error,
        new ProviderFailure('provider-rejected', 'The new password was refused.')
      );
    }

    // Every other session of this identity is revoked, so a stolen session that
    // predates the reset does not survive it.
    await this.revokeAllSessions(updated.data.user.id);
    return this.identityOf(updated.data.user);
  }

  async invite(request: InviteRequest): Promise<ProviderIdentity> {
    let result;
    try {
      result = await this.admin.auth.admin.inviteUserByEmail(request.email, {
        redirectTo: request.redirectTo,
        // Written by the service role. The end user cannot modify app_metadata,
        // which is what makes it usable as an identity lookup key (ADR-019 §3).
        data: {},
      });
    } catch (cause) {
      throw unavailable(cause);
    }
    if (result.error || !result.data.user) {
      throw translate(
        result.error,
        new ProviderFailure('identity-conflict', 'The identity could not be created.')
      );
    }

    // The tenant binding is written in a second, admin-only call rather than in
    // `data` above, which GoTrue routes to user_metadata — a field the end user
    // can edit. app_metadata is service-role only.
    let bound;
    try {
      bound = await this.admin.auth.admin.updateUserById(result.data.user.id, {
        app_metadata: { tenant_id: request.tenantId },
      });
    } catch (cause) {
      throw unavailable(cause);
    }
    if (bound.error || !bound.data.user) {
      throw translate(
        bound.error,
        new ProviderFailure('provider-rejected', 'The tenant binding could not be written.')
      );
    }
    return this.identityOf(bound.data.user);
  }

  /**
   * Capability 12 — look an identity up by address.
   *
   * Goes to the GoTrue admin endpoint rather than through `auth.admin.listUsers`,
   * because the SDK exposes only `page` and `perPage`: an SDK implementation
   * would have to page through **every** identity in the project and match
   * client-side, which is O(all users) on a path that runs on failed logins.
   *
   * GoTrue's `filter` is a **substring** match, not an equality test — measured,
   * not assumed: filtering by `crm.local` returns every address containing it.
   * So the filter is used only to narrow server-side, and the decision is made
   * here by exact, case-insensitive comparison. A substring filter that matched
   * many identities can therefore never return the wrong one; at worst it returns
   * none, and the caller treats that exactly as "unattributable".
   *
   * The address is written through `URL`/`searchParams`, so it is escaped as a
   * query *value* and cannot reach the host or the path.
   */
  async findByEmail(email: string): Promise<ProviderIdentity | null> {
    const endpoint = new URL('/auth/v1/admin/users', this.options.url);
    endpoint.searchParams.set('filter', email);
    endpoint.searchParams.set('per_page', String(DIRECTORY_PAGE_SIZE));

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          apikey: this.options.serviceRoleKey,
          Authorization: `Bearer ${this.options.serviceRoleKey}`,
        },
      });
    } catch (cause) {
      throw unavailable(cause);
    }
    if (!response.ok) {
      if (response.status === 404) return null;
      throw translate(
        { status: response.status },
        new ProviderFailure('provider-rejected', 'Directory lookup was refused.')
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderFailure('provider-unavailable', 'Directory returned an unreadable body.');
    }

    const users = (payload as { users?: unknown }).users;
    if (!Array.isArray(users)) return null;

    const wanted = email.trim().toLowerCase();
    const exact = users.find(
      (candidate): candidate is User =>
        typeof (candidate as User)?.email === 'string' &&
        (candidate as User).email!.trim().toLowerCase() === wanted
    );
    return exact ? this.identityOf(exact) : null;
  }

  async findBySubject(subject: string): Promise<ProviderIdentity | null> {
    let result;
    try {
      result = await this.admin.auth.admin.getUserById(subject);
    } catch (cause) {
      throw unavailable(cause);
    }
    if (result.error) {
      if (statusOf(result.error) === 404) return null;
      throw translate(
        result.error,
        new ProviderFailure('provider-rejected', 'Lookup was refused.')
      );
    }
    return result.data.user ? this.identityOf(result.data.user) : null;
  }

  async confirmIdentity(subject: string): Promise<ProviderIdentity> {
    let result;
    try {
      result = await this.admin.auth.admin.updateUserById(subject, { email_confirm: true });
    } catch (cause) {
      throw unavailable(cause);
    }
    if (result.error || !result.data.user) {
      throw translate(
        result.error,
        new ProviderFailure('identity-unavailable', 'The identity could not be confirmed.')
      );
    }
    return this.identityOf(result.data.user);
  }

  async setDisabled(subject: string, disabled: boolean): Promise<ProviderIdentity> {
    let result;
    try {
      result = await this.admin.auth.admin.updateUserById(subject, {
        // GoTrue expresses "disabled" as a ban duration. `none` lifts it.
        ban_duration: disabled ? '876000h' : 'none',
      });
    } catch (cause) {
      throw unavailable(cause);
    }
    if (result.error || !result.data.user) {
      throw translate(
        result.error,
        new ProviderFailure('identity-unavailable', 'The identity could not be updated.')
      );
    }
    if (disabled) await this.revokeAllSessions(subject);
    return this.identityOf(result.data.user);
  }
}
