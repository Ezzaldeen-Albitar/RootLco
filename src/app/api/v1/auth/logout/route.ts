/**
 * POST /api/v1/auth/logout (P1-14).
 *
 * **Current session only.** Ending every session of an account is a privileged,
 * audited action and lives at `DELETE /api/v1/iam/users/{userId}/sessions`,
 * because "log me out everywhere" and "log that person out everywhere" are the
 * same capability and only one of them should be reachable without a permission.
 *
 * Idempotent: revoking an already-revoked session affects zero rows — the policy
 * `USING` clause excludes it — and that is treated as success. A logout that
 * failed on the second call would invite a retry loop against an endpoint the
 * caller has no way to satisfy.
 *
 * Authenticated rather than public, so the session being ended is the session
 * that authenticated. `iam.user.read` is the least meaningful permission any
 * active principal holds; requiring it keeps the operation inside the
 * "every operation declares a permission" rule without inventing a permission
 * code that exists only to be declared.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const LOGOUT_OPERATION = defineOperation({
  id: 'iam.auth-logout',
  module: 'iam',
  method: 'POST',
  path: '/auth/logout',
  summary: 'End the current session.',
  permissions: ['iam.user.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  return handleOperation(LOGOUT_OPERATION, request, async ({ db, request: raw }) => {
    // The pipeline already verified this header to get here; reading it again is
    // how the service learns which provider session to end.
    const token = (raw.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    await iamModule().authentication.logout(db, token);
    return { body: { status: 'signed-out' } };
  });
}
