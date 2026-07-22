/**
 * POST /api/v1/auth/logout (P1-14).
 *
 * **Current session only.** Ending every session of an account is a privileged,
 * audited action and lives at `DELETE /api/v1/iam/users/{userId}/sessions` —
 * "log me out everywhere" and "log that person out everywhere" are the same
 * capability, and only one of them should be reachable without a permission.
 *
 * ## Why this is `public` rather than permission-gated (finding P1-14-R-001)
 *
 * The first version declared `iam.user.read`. That was wrong, and the way it was
 * wrong is worth recording: a principal holding no administrative grant — a
 * technician with `org.branch.read` and nothing else — could sign **in** and then
 * could not sign **out**, because the logout endpoint denied them. Being unable
 * to end your own session is a security problem, not a usability one.
 *
 * `public` here does not mean unauthenticated. It means the **token is the
 * authority**, which is the correct authority for this operation: the service
 * verifies the bearer token, takes the tenant and subject from the verified
 * claims, resolves the account, and revokes the session whose reference that
 * token carries. A caller can therefore end exactly one session — the one they
 * are holding — and no other, in no other tenant.
 *
 * Idempotent by construction. An unusable token identifies no session and the
 * request still succeeds; revoking an already-revoked session affects zero rows,
 * because the policy `USING` clause excludes it, and that is treated as success.
 * A logout that failed on the second call would invite a retry loop against an
 * endpoint the caller has no way to satisfy.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { resolveClientAddress } from '@/server/http/trusted-proxy';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const LOGOUT_OPERATION = defineOperation({
  id: 'iam.auth-logout',
  module: 'iam',
  method: 'POST',
  path: '/auth/logout',
  summary: 'End the session the presented bearer token belongs to.',
  public: true,
  publicReason:
    'The bearer token is the authority: it identifies exactly the one session being ended, and ' +
    'no other. Requiring a permission would leave a principal holding no administrative grant ' +
    'able to sign in and unable to sign out.',
  auditClass: 'none',
  rateLimitPolicy: 'auth-adjacent',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  return handleOperation(LOGOUT_OPERATION, request, async ({ request: raw, correlationId }) => {
    const token = (raw.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const client = resolveClientAddress({ headers: raw.headers });
    await iamModule().authentication.logout(token, {
      correlationId,
      clientIp: client.ip,
      userAgent: raw.headers.get('user-agent'),
    });
    // The same answer whether a session was ended or the token was already dead.
    return { body: { status: 'signed-out' } };
  });
}
