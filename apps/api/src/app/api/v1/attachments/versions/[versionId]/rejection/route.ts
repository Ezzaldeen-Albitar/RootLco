/**
 * POST /api/v1/attachments/versions/{versionId}/rejection (P1-15).
 *
 * The only version transition the request runtime holds: `pending → rejected`
 * (`upd_document_versions_reject`). Acceptance is not available in this phase
 * and is not offered here.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ versionId: z.string().uuid() });
export const Body = z.object({ reason: z.string().min(1).max(500) }).strict();

export const ATTACHMENT_VERSION_REJECT_OPERATION = defineOperation({
  id: 'shared.attachment-version-reject',
  module: 'shared-services',
  method: 'POST',
  path: '/attachments/versions/{versionId}/rejection',
  summary: 'Reject a pending document version. The state is terminal.',
  permissions: ['shared.document.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.document.version_rejected',
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
    ATTACHMENT_VERSION_REJECT_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      return {
        body: await sharedServicesModule().attachments.rejectVersion(
          db,
          params.versionId,
          input.reason
        ),
      };
    },
    { params, body }
  );
}
