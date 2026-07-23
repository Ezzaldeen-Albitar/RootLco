/**
 * PUT /api/v1/message-templates/{templateId}/active-version (P1-15).
 *
 * Points a template at an approved version, or clears the pointer with `null`.
 * PUT because the active version is a single-valued sub-resource being replaced.
 *
 * `guard_template_active_version()` re-reads the version `FOR UPDATE` and
 * refuses anything not `approved`; that lock order (version first) is also what
 * stops activation and retirement from deadlocking against each other.
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
const Body = z.object({ versionId: z.string().uuid().nullable() }).strict();

export const TEMPLATE_ACTIVATION_OPERATION = defineOperation({
  id: 'shared.template-activation-set',
  module: 'shared-services',
  method: 'PUT',
  path: '/message-templates/{templateId}/active-version',
  summary: 'Set or clear the active version of a tenant message template.',
  permissions: ['org.settings.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.template.updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PUT(
  request: Request,
  route: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    TEMPLATE_ACTIVATION_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const input = await parseJsonBody(raw, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      await sharedServicesModule().templates.setActiveVersion(
        db,
        params.templateId,
        expectedVersion,
        input.versionId
      );
      return {
        body: { templateId: params.templateId, activeVersionId: input.versionId },
        recordVersion: expectedVersion + 1,
      };
    },
    { params }
  );
}
