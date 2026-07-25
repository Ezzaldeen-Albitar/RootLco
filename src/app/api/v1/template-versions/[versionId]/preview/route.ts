/**
 * POST /api/v1/template-versions/{versionId}/preview (P1-15).
 *
 * Renders a version with caller-supplied sample values and sends nothing.
 *
 * It discloses nothing new: the caller already holds `org.settings.manage` and
 * can read the template body directly. What it adds is the only way to see what
 * escaping does to authored markup *before* approving a version that customers
 * will receive.
 *
 * Audit class `none` on purpose — a preview changes nothing, and recording every
 * keystroke of template authoring would bury the approval that matters.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ versionId: schemas.uuid });
const Body = z.object({ variables: z.record(z.string(), z.string()).default({}) }).strict();

export const TEMPLATE_VERSION_PREVIEW_OPERATION = defineOperation({
  id: 'shared.template-version-preview',
  module: 'shared-services',
  method: 'POST',
  path: '/template-versions/{versionId}/preview',
  summary: 'Render a template version with sample values. Sends nothing.',
  permissions: ['org.settings.manage'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ versionId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TEMPLATE_VERSION_PREVIEW_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      return {
        body: await sharedServicesModule().templates.previewVersion(
          db,
          params.versionId,
          input.variables
        ),
      };
    },
    { params, body }
  );
}
