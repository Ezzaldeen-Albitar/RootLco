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
 *
 * ## No query parameter is accepted (P1-32-PRE-OD-FRXR)
 *
 * The read names no target, so it takes no parameter at all. It used to ignore
 * whatever query string arrived, which let `?userId=`, `?companyId=` or
 * `?branchId=` look as though another user, company or branch could be
 * substituted even though the answer stayed the caller's own. An empty
 * `.strict()` schema now refuses any parameter with the standard validation
 * error before anything is read, so no request can appear to ask about somebody
 * else and no answer is given to one that tries.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, searchParamsToObject } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Deliberately empty and `.strict()`: any parameter is refused, never ignored. */
const Query = z.object({}).strict();

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
  return handleOperation(SESSION_OPERATION, request, async ({ db, request: raw }) => {
    parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query');
    return { body: await iamModule().authentication.describeSession(db) };
  });
}
