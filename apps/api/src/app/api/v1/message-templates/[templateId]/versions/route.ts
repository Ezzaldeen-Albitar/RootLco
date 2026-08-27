/**
 * POST /api/v1/message-templates/{templateId}/versions (P1-15).
 *
 * Creates the next draft version. A version is always born a draft
 * (`guard_template_version_lifecycle`), so this route cannot create an approved
 * one and does not offer the option.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid });
export const Body = z
  .object({
    subject: z.string().min(1).max(500).nullable().optional(),
    body: z.string().min(1).max(100_000),
  })
  .strict();

export const TEMPLATE_VERSION_CREATE_OPERATION = defineOperation({
  id: 'shared.template-version-create',
  module: 'shared-services',
  method: 'POST',
  path: '/message-templates/{templateId}/versions',
  summary: 'Create the next draft version of a tenant message template.',
  permissions: ['org.settings.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.template.version_created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TEMPLATE_VERSION_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      return {
        status: 201,
        body: await sharedServicesModule().templates.createVersion(db, params.templateId, {
          subject: input.subject ?? null,
          body: input.body,
        }),
      };
    },
    { params, body }
  );
}
