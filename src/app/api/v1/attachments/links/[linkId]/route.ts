/**
 * DELETE /api/v1/attachments/links/{linkId} (P1-15).
 *
 * Withdraws a link. The row is not deleted — `app_runtime` holds no DELETE on
 * `shared.document_links`, and it should not: the fact that a document *was*
 * attached to an entity is itself evidence. Only `deleted_at` is grantable, so
 * withdrawal is a soft close and the history survives.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ linkId: z.string().uuid() });

export const ATTACHMENT_LINK_WITHDRAW_OPERATION = defineOperation({
  id: 'shared.attachment-link-withdraw',
  module: 'shared-services',
  method: 'DELETE',
  path: '/attachments/links/{linkId}',
  summary: 'Withdraw a document link. The row is retained with a withdrawal stamp.',
  permissions: ['shared.document.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.document.unlinked',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function DELETE(
  request: Request,
  context: { params: Promise<Record<string, string>> }
): Promise<Response> {
  const params = parseOrFail(Params, await context.params, 'params');
  return handleOperation(
    ATTACHMENT_LINK_WITHDRAW_OPERATION,
    request,
    async ({ db }) => ({
      body: await sharedServicesModule().attachments.unlink(db, params.linkId),
    }),
    { params }
  );
}
