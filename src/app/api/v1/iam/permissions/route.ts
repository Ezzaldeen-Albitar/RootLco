/**
 * GET /api/v1/iam/permissions (P1-14).
 *
 * The platform permission catalog. It is global reference data with an
 * unconditional SELECT policy — the same codes exist for every tenant — so there
 * is no tenant predicate and none is missing. Reading it discloses which
 * capabilities the platform defines, which is documented API metadata, not a
 * secret; it does not disclose who holds them.
 *
 * `iam.role.read` rather than a lower permission: the catalog is only useful to
 * someone administering roles, and gating it there keeps the surface tight.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PERMISSION_LIST_OPERATION = defineOperation({
  id: 'iam.permission-list',
  module: 'iam',
  method: 'GET',
  path: '/iam/permissions',
  summary: 'List the platform permission catalog.',
  permissions: ['iam.role.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(PERMISSION_LIST_OPERATION, request, async ({ db }) => ({
    body: { items: await iamModule().access.listPermissions(db) },
  }));
}
