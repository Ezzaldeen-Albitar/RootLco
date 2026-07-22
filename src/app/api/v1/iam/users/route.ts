/**
 * GET /api/v1/iam/users (P1-14).
 *
 * Cursor-paginated, tenant-scoped, deterministically ordered by
 * `(created_at DESC, id DESC)` — the tie-breaker is what stops two accounts
 * created in the same millisecond from straddling a page edge and being shown
 * twice or never.
 *
 * Page size is clamped to the foundation's `MAX_PAGE_SIZE`, so pagination
 * scraping is bounded by the same limit as every other list in the platform.
 * The response omits `identity_provider` and `provider_subject`; see
 * `UserAdministrationService` for why.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({
  cursor: schemas.cursor.optional(),
  limit: schemas.limit.optional(),
  status: z.enum(['invited', 'active', 'locked', 'archived']).optional(),
  /** Substring match on address or display name. Bound as a parameter, never interpolated. */
  search: z.string().min(1).max(120).optional(),
});

export const USER_LIST_OPERATION = defineOperation({
  id: 'iam.user-list',
  module: 'iam',
  method: 'GET',
  path: '/iam/users',
  summary: 'List users in the caller tenant.',
  permissions: ['iam.user.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(USER_LIST_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
    // The cursor is handed over unopened: decoding it is data-layer work, and a
    // handler that decodes one is a handler that knows the ordering contract.
    return {
      body: await iamModule().users.list(
        db,
        { cursor: query.cursor, limit: query.limit },
        {
          status: query.status,
          search: query.search,
        }
      ),
    };
  });
}
