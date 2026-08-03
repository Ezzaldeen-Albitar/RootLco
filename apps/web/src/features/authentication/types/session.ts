import type { PermissionCode } from '@/config/navigation';

/**
 * The session exactly as `GET /api/v1/auth/session` publishes it.
 *
 * Every field is **server-resolved for this request**. Nothing here was
 * supplied by the browser, and nothing here may be edited by it: the type
 * exists so a screen can render itself without guessing, not so a client can
 * decide what it is allowed to do.
 *
 * `companyIds` and `branchIds` are the resolved scope. An **empty** array means
 * unrestricted within the tenant — not "no access". That distinction is easy to
 * invert and expensive when inverted, so it is stated here and asserted in
 * `apps/web/tests/session.test.ts`.
 */
export interface SessionSummary {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
  readonly permissions: readonly PermissionCode[];
}

/** Why a protected render could not proceed. Drives the sign-in redirect. */
export type SessionProblem =
  /** No session cookie at all — the ordinary "not signed in" case. */
  | 'signed-out'
  /** A cookie existed and the backend rejected the TOKEN. The cookie is cleared. */
  | 'expired'
  /**
   * The token is valid and the account may not read its own session — it does
   * not hold `iam.user.read`. The cookie is **kept**: it is a permissions
   * problem for an administrator, not an expired credential, and clearing it
   * produced an unbreakable sign-in loop (`P1-26-F-022`).
   */
  | 'forbidden'
  /** The backend could not be reached, or answered with something unusable. */
  | 'unavailable';

export type SessionState =
  | { readonly ok: true; readonly session: SessionSummary }
  | { readonly ok: false; readonly problem: SessionProblem; readonly correlationId: string | null };

/**
 * Whether the resolved scope is unrestricted within the tenant.
 *
 * The backend's own delegation policy uses exactly this test
 * (`actorUnrestricted` in `delegation-policy.ts`), so the interface's idea of
 * "unrestricted" and the server's cannot drift apart.
 */
export function isUnrestrictedScope(session: SessionSummary): boolean {
  return session.companyIds.length === 0 && session.branchIds.length === 0;
}
