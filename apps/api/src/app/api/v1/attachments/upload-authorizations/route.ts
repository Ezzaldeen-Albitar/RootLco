/**
 * POST /api/v1/attachments/upload-authorizations (P1-15).
 *
 * Creates document metadata, reserves a server-built storage key, and returns a
 * short-lived signed upload URL. A noun path rather than `attachments:authorize-upload`:
 * the operation registry's `PATH_PATTERN` rejects a colon outright, and an
 * authorization is a resource worth naming.
 *
 * Idempotent by declaration — the key covers a command that both creates a row
 * and hands out a capability, so a retried request must not mint a second one.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Body = z
  .object({
    /** `shared.document_categories.category_code`, `^[a-z][a-z0-9_]{1,62}$`. */
    categoryCode: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    /** Must be an allow-listed `schema.table`; the service checks the list. */
    entityType: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
    entityId: z.string().uuid(),
    /** Sanitised server-side before storage; never used to build a path. */
    fileName: z.string().min(1).max(400),
    contentType: z.string().regex(/^[a-z0-9]+\/[a-z0-9][a-z0-9.+-]*$/),
    byteSize: z.number().int().positive(),
  })
  .strict();

export const ATTACHMENT_UPLOAD_AUTHORIZE_OPERATION = defineOperation({
  id: 'shared.attachment-upload-authorize',
  module: 'shared-services',
  method: 'POST',
  path: '/attachments/upload-authorizations',
  summary: 'Create document metadata and issue a short-lived signed upload URL.',
  permissions: ['shared.document.manage'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'shared.document.upload_authorized',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ATTACHMENT_UPLOAD_AUTHORIZE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      const authorization = await sharedServicesModule().attachments.authorizeUploadDetailed(
        db,
        input
      );
      return {
        status: 201,
        body: {
          documentId: authorization.documentId,
          uploadToken: authorization.uploadToken,
          uploadUrl: authorization.uploadUrl,
          method: authorization.method,
          contentType: authorization.contentType,
          maxBytes: authorization.maxBytes,
          expiresAt: authorization.expiresAt.toISOString(),
        },
      };
    },
    { body }
  );
}
