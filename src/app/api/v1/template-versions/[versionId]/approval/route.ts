/**
 * POST /api/v1/template-versions/{versionId}/approval (P1-15).
 *
 * Approves a draft. The approver is taken from the session, never from the
 * request: `ck_template_versions_approval_pairing` requires `approved_by`, and a
 * caller who could name the approver could produce an approval record that
 * blames someone else.
 *
 * Audit class `approval` rather than `privileged` — this is the act that makes
 * content sendable to customers, and it belongs in the approval trail.
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

export const TEMPLATE_VERSION_APPROVE_OPERATION = defineOperation({
  id: 'shared.template-version-approve',
  module: 'shared-services',
  method: 'POST',
  path: '/template-versions/{versionId}/approval',
  summary: 'Approve a draft template version. Approved content is immutable.',
  permissions: ['org.settings.manage'],
  scope: 'tenant',
  auditClass: 'approval',
  auditAction: 'shared.template.version_approved',
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
    TEMPLATE_VERSION_APPROVE_OPERATION,
    request,
    async ({ db, expectedVersion }) => {
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      await sharedServicesModule().templates.approveVersion(db, params.versionId, expectedVersion);
      return {
        body: { versionId: params.versionId, status: 'approved' },
        recordVersion: expectedVersion + 1,
      };
    },
    { params }
  );
}
