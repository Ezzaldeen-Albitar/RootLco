/**
 * PATCH /api/v1/message-templates/{templateId} (P1-15).
 *
 * Changes the grantable columns only. `template_code`, `channel`, and
 * `locale_code` are absent from the body *and* frozen by
 * `org.guard_immutable_columns` — they are the template's identity, and a
 * template that could change its own channel would silently change what every
 * message sent from it means.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid });
export const Body = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(1000).nullable().optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict();

export const TEMPLATE_UPDATE_OPERATION = defineOperation({
  id: 'shared.template-update',
  module: 'shared-services',
  method: 'PATCH',
  path: '/message-templates/{templateId}',
  summary: 'Rename, re-describe, or disable a tenant message template.',
  permissions: ['org.settings.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.template.updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    TEMPLATE_UPDATE_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const body = await parseJsonBody(raw, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      await sharedServicesModule().templates.updateTemplate(
        db,
        params.templateId,
        expectedVersion,
        body
      );
      return { body: { templateId: params.templateId }, recordVersion: expectedVersion + 1 };
    },
    { params }
  );
}
