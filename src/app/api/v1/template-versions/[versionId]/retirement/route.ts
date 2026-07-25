/**
 * POST /api/v1/template-versions/{versionId}/retirement (P1-15).
 *
 * Retires an approved version so it can no longer become active. The lifecycle
 * guard refuses while a template still points at it — deactivate first — which
 * is what stops a retirement from silently disarming a live template.
 *
 * Retirement is not deletion: the row and its content stay, because messages
 * already sent reference it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ versionId: schemas.uuid });

export const TEMPLATE_VERSION_RETIRE_OPERATION = defineOperation({
  id: 'shared.template-version-retire',
  module: 'shared-services',
  method: 'POST',
  path: '/template-versions/{versionId}/retirement',
  summary: 'Retire an approved template version.',
  permissions: ['org.settings.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.template.version_retired',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ versionId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    TEMPLATE_VERSION_RETIRE_OPERATION,
    request,
    async ({ db, expectedVersion }) => {
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      await sharedServicesModule().templates.retireVersion(db, params.versionId, expectedVersion);
      return {
        body: { versionId: params.versionId, status: 'retired' },
        recordVersion: expectedVersion + 1,
      };
    },
    { params }
  );
}
