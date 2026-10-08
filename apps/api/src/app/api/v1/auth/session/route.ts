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
 *
 * ## An authenticated self-read, not a directory read (P1-32-PRE-OD-FRX)
 *
 * It used to declare `iam.user.read`, the code that opens the tenant's user
 * directory. Every dashboard page reads this before it renders, so a role that
 * legitimately lacks that code — the seeded technician and cashier roles, a
 * quotations-only role — was refused its own session and could not open the
 * product at all. It now registers as `selfRead`: the pipeline still requires an
 * authenticated, resolved, non-revoked session (no session is a 401), and the
 * body is the caller's own identity, scope and permissions and nothing about
 * anybody else. A principal holding no role at all is answered with its own
 * facts and an empty permission list. Other people's names stay behind
 * `iam.user-detail`, which keeps `iam.user.read`.
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
  selfRead: true,
  selfReadReason:
    'Answers the authenticated caller its own identity, resolved scope and permissions, and ' +
    'nothing about any other account; every product page reads it before it renders.',
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
