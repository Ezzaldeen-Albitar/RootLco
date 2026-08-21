import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DOCUMENT_CATEGORY_LIST_OPERATION = defineOperation({
  id: 'shared.document-category-list',
  module: 'shared-services',
  method: 'GET',
  path: '/attachments/categories',
  summary: 'List governed document categories visible to the tenant.',
  permissions: ['shared.document.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'reference',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(DOCUMENT_CATEGORY_LIST_OPERATION, request, async ({ db }) => ({
    body: { items: await sharedServicesModule().attachments.listCategories(db) },
  }));
}
