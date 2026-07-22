/**
 * GET /api/v1/auth/session (P1-14).
 *
 * Reports the caller's own resolved identity, scope, and effective permissions.
 * Reaching it at all is the answer to "is my session still valid": the pipeline
 * has already verified the token, resolved the account, checked that the session
 * row is neither revoked nor idle-expired, and evaluated authorization.
 *
 * Everything returned was resolved server-side for this request from the
 * database, so it discloses nothing the caller does not already hold. It exists
 * so a client can render itself without guessing — and guessing is what leads a
 * client to send a request it is not entitled to make.
 *
 * `cacheCategory: 'never'` and the pipeline's `Cache-Control: no-store, private`
 * are both deliberate: a cached permission list is a stale permission list, and
 * a revoked grant must stop working immediately.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const SESSION_OPERATION = defineOperation({
  id: 'iam.auth-session',
  module: 'iam',
  method: 'GET',
  path: '/auth/session',
  summary: 'Describe the current session, its resolved scope, and its permissions.',
  permissions: ['iam.user.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(SESSION_OPERATION, request, async ({ db }) => ({
    body: await iamModule().authentication.describeSession(db),
  }));
}
