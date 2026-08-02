/**
 * GET /api/v1/exports/resources (P1-15).
 *
 * Lists what is exportable and which fields each resource offers. It is
 * catalogue metadata — the same frozen registry the authorization path reads —
 * so it discloses no tenant data and returns the same answer for every caller
 * who holds `rpt.export`.
 *
 * Sensitive fields appear in the list. That is deliberate: a caller needs to
 * know a field exists in order to request the permission for it, and the
 * *values* remain unreachable without `iam.sensitive.view`.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const EXPORT_CATALOGUE_OPERATION = defineOperation({
  id: 'shared.export-catalogue',
  module: 'shared-services',
  method: 'GET',
  path: '/exports/resources',
  summary: 'List the resources and fields this deployment can export.',
  permissions: ['rpt.export'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(EXPORT_CATALOGUE_OPERATION, request, async () => ({
    body: { resources: sharedServicesModule().exports.catalogue() },
  }));
}
