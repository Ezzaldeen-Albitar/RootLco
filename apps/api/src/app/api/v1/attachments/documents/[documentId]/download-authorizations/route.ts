/**
 * POST /api/v1/attachments/documents/{documentId}/download-authorizations (P1-15).
 *
 * Issues a short-lived signed download URL for an **accepted** version. POST
 * rather than GET because it is a command with a durable side effect — a
 * security-class audit record — and because a URL that hands out a capability
 * must never be cacheable or replayable from a browser's history.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ documentId: z.string().uuid() });
const Body = z.object({ versionId: z.string().uuid().nullable().optional() }).strict();

export const ATTACHMENT_DOWNLOAD_AUTHORIZE_OPERATION = defineOperation({
  id: 'shared.attachment-download-authorize',
  module: 'shared-services',
  method: 'POST',
  path: '/attachments/documents/{documentId}/download-authorizations',
  summary: 'Issue a short-lived signed download URL for an accepted version.',
  permissions: ['shared.document.read'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'shared.document.download_authorized',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  context: { params: Promise<Record<string, string>> }
): Promise<Response> {
  const params = parseOrFail(Params, await context.params, 'params');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ATTACHMENT_DOWNLOAD_AUTHORIZE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      const grant = await sharedServicesModule().attachments.requestDownload(db, {
        documentId: params.documentId,
        versionId: input.versionId ?? null,
      });
      return { body: { url: grant.url, expiresAt: grant.expiresAt.toISOString() } };
    },
    { params, body }
  );
}
