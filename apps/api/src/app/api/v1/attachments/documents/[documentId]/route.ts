/**
 * GET /api/v1/attachments/documents/{documentId} (P1-23).
 *
 * Document metadata. The storage key is deliberately not projected — it is a
 * locator that travels outside RLS, and a download goes through the P1-15
 * download-authorization operation, which issues a short-lived signed URL.
 */
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DOCUMENT_READ_OPERATION = defineOperation({
  id: 'shared.document-read',
  module: 'shared-services',
  method: 'GET',
  path: '/attachments/documents/{documentId}',
  summary: 'Read the metadata of one document.',
  permissions: ['shared.document.read'],
  scope: 'tenant',
  auditClass: 'none',
  // Was the unregistered `'standard-read'`, which made every request to this
  // operation an unhandled 500 (`P1-27-INT-113`). `expensive-read` keys on
  // operation+tenant+user, so one operator cannot monopolise document metadata
  // reads for a tenant.
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> }
): Promise<Response> {
  const { documentId } = await context.params;
  return handleOperation(DOCUMENT_READ_OPERATION, request, async ({ db }) => {
    const id = parseOrFail(schemas.uuid, documentId, 'path.documentId');
    return { body: await sharedServicesModule().documentReads.read(db, id) };
  });
}
