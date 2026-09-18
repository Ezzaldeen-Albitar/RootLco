/**
 * GET /api/v1/platform/organizations/{tenantId} (P1-32-PRE-022).
 *
 * Everything the Platform Owner Console shows about ONE organisation: the
 * tenant root, its companies and branches, account counts by state, every
 * subscription assignment, the subscription trail, the lifecycle trail, and
 * usage against the active plan's capacity limits.
 *
 * Counts only for accounts. `app_platform`'s SELECT on `iam.user_accounts` is
 * column-scoped to (id, tenant_id, status, deleted_at), so this operation could
 * not publish a person's name or address even if its handler asked for one.
 *
 * An unknown or invisible tenant answers `404 ERR-RES-001`, never an empty
 * document: "no companies" is a real state for a tenant still provisioning and
 * must not be mistaken for "no such tenant".
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ tenantId: schemas.uuid }).strict();

export const ORGANIZATION_DETAIL_OPERATION = defineOperation({
  id: 'platform.organization-detail',
  module: 'platform',
  method: 'GET',
  path: '/platform/organizations/{tenantId}',
  summary:
    'Read one organization with its structure, account counts, subscriptions, history and capacity usage.',
  permissions: ['platform.organization.read'],
  scope: 'tenant',
  auditClass: 'none',
  answersNotFound: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ tenantId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    ORGANIZATION_DETAIL_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      return { body: await platformModule().organizations.detail(db, params.tenantId) };
    },
    { params: raw }
  );
}
