/**
 * POST /api/v1/attachments/documents/{documentId}/links (P1-15).
 *
 * Links a document to a business entity. A live link is what makes a document
 * *reachable* from that entity — knowing a document id or a storage key never
 * is (`docs/phase-1/phase-1-5/document-access-and-file-security.md`).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ documentId: z.string().uuid() });
export const Body = z
  .object({
    entityType: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
    entityId: z.string().uuid(),
    linkPurpose: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  })
  .strict();

export const ATTACHMENT_LINK_CREATE_OPERATION = defineOperation({
  id: 'shared.attachment-link-create',
  successStatus: 201,
  module: 'shared-services',
  method: 'POST',
  path: '/attachments/documents/{documentId}/links',
  summary: 'Link a document to a business entity.',
  permissions: ['shared.document.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.document.linked',
  idempotent: true,
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
    ATTACHMENT_LINK_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      return {
        status: 201,
        body: await sharedServicesModule().attachments.link(db, {
          documentId: params.documentId,
          entityType: input.entityType,
          entityId: input.entityId,
          linkPurpose: input.linkPurpose,
        }),
      };
    },
    { params, body }
  );
}
