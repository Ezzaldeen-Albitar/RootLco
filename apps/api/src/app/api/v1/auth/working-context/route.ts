/**
 * GET /api/v1/auth/working-context (Owner directive, P1-32-PRE-OD-UX).
 *
 * The companies and branches the caller may act in, by name.
 *
 * ## Why this is not the administration reach read
 *
 * `org.company-list` and `org.branch-list` answer the same shape and are guarded by
 * `org.company.read` / `org.branch.read` — the codes that let an ADMINISTRATOR
 * maintain the organisation. Every branch-scoped screen in the product has to know
 * which branch it is showing before it can ask for anything, and the people using
 * those screens hold no administration code at all. Routing the product's own
 * navigation through an administration permission would push a tenant towards
 * granting it, which is the opposite of what that permission is for.
 *
 * So this operation is an authenticated self-read (P1-32-PRE-OD-FRX), like the
 * session read beside it, and returns strictly the caller's own reach. Nothing here
 * is a fact the caller does not already hold: the narrowing is
 * `sel_legal_companies_tenant` and `sel_branches_scope` reading the caller's own
 * resolved grants, and a principal holding no active grant is answered with two
 * empty arrays. It used to carry `iam.user.read`, the code the session read carried,
 * and so refused every role without the user-directory code the shell it feeds; it
 * declares no code now, and an unauthenticated request is still a 401.
 *
 * `companySettingsReadableIds` names which of those companies' settings the caller
 * may read, answered by the same two checks `iam.company-settings-read` enforces,
 * so a screen can leave out a read that would only be refused. It is still the
 * caller's own authority and nothing more.
 *
 * `scope: 'tenant'`, and there is no company or branch parameter: the request names
 * no target, because naming one is the very thing the caller cannot yet do. Any
 * query parameter at all — `companyId`, `branchId`, `userId` or an unknown name —
 * is refused with the standard validation error by an empty `.strict()` schema
 * before anything is read (P1-32-PRE-OD-FRXR); it used to be ignored, which let a
 * request look as though it could substitute another company or branch.
 *
 * `auditClass: 'none'` matches the session read beside it: a caller reading its own
 * scope writes no audit trail, and the two reads are the same act of a client
 * rendering itself.
 *
 * `cacheCategory: 'never'`, for the reason the session read gives — a cached reach
 * is a stale reach, and a revoked grant must stop working immediately.
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

export const WORKING_CONTEXT_OPERATION = defineOperation({
  id: 'iam.working-context-read',
  module: 'iam',
  method: 'GET',
  path: '/auth/working-context',
  summary: 'List the companies and branches the acting user may work in.',
  selfRead: true,
  selfReadReason:
    'Answers the authenticated caller the companies and branches its own grants reach, and ' +
    'nothing about any other account; the product shell reads it before it renders.',
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(WORKING_CONTEXT_OPERATION, request, async ({ db, request: raw }) => {
    parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query');
    return { body: await iamModule().workingContext.describe(db) };
  });
}
