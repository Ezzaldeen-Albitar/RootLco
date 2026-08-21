import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const Params = z.object({ versionId: z.string().uuid() });

export const DOCUMENT_VERSION_READ_OPERATION = defineOperation({
  id: 'shared.document-version-read',
  module: 'shared-services',
  method: 'GET',
  path: '/attachments/versions/{versionId}',
  summary: 'Read one immutable document version and its scan lifecycle.',
  permissions: ['shared.document.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  context: { params: Promise<Record<string, string>> }
): Promise<Response> {
  const { versionId } = parseOrFail(Params, await context.params, 'params');
  return handleOperation(DOCUMENT_VERSION_READ_OPERATION, request, async ({ db }) => ({
    body: await sharedServicesModule().attachments.readVersion(db, versionId),
  }));
}
