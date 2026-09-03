/**
 * PATCH /api/v1/template-versions/{versionId} (P1-15).
 *
 * Revises **draft** content. Approved content is immutable —
 * `guard_template_version_lifecycle()` refuses a content change once the version
 * leaves `draft`, and it must: a message already sent from an approved version
 * would otherwise stop matching the version it claims to have come from.
 *
 * Versions live at their own top-level path rather than under the template. The
 * route registry maps `{param}` to `[param]` on disk, so a static `versions`
 * segment beside a `[templateId]` segment would put a static and a dynamic
 * sibling at the same level — legal in Next.js, but an ambiguity worth not
 * having.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ versionId: schemas.uuid });
export const Body = z
  .object({
    subject: z.string().min(1).max(500).nullable().optional(),
    body: z.string().min(1).max(100_000),
  })
  .strict();

export const TEMPLATE_VERSION_REVISE_OPERATION = defineOperation({
  id: 'shared.template-version-revise',
  module: 'shared-services',
  method: 'PATCH',
  path: '/template-versions/{versionId}',
  summary: 'Revise the content of a draft template version.',
  permissions: ['org.settings.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.template.version_created',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ versionId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    TEMPLATE_VERSION_REVISE_OPERATION,
    request,
    async ({ db, request: raw, expectedVersion }) => {
      const input = await parseJsonBody(raw, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      await sharedServicesModule().templates.reviseDraft(db, params.versionId, expectedVersion, {
        subject: input.subject ?? null,
        body: input.body,
      });
      return { body: { versionId: params.versionId }, recordVersion: expectedVersion + 1 };
    },
    { params }
  );
}
