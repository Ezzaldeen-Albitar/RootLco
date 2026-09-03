/**
 * POST /api/v1/message-templates (P1-15).
 *
 * Creates a **tenant** template. Platform templates are shared defaults and are
 * not creatable or mutable from here: the INSERT policy pins `scope = 'tenant'`
 * and `tenant_id = iam.current_tenant_id()`, so the database refuses even if
 * this route did not.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody } from '@/server/http/validation';
import { sharedServicesModule } from '@/modules/shared-services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Body = z
  .object({
    templateCode: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    name: z.string().min(1).max(200),
    /** Only what `ck_message_templates_channel` allows. */
    channel: z.enum(['email', 'in_app']),
    purpose: z.enum(['transactional', 'marketing', 'system']),
    localeCode: z.string().min(2).max(10),
    description: z.string().min(1).max(1000).nullable().optional(),
  })
  .strict();

export const TEMPLATE_CREATE_OPERATION = defineOperation({
  id: 'shared.template-create',
  successStatus: 201,
  module: 'shared-services',
  method: 'POST',
  path: '/message-templates',
  summary: 'Create a tenant message template.',
  permissions: ['org.settings.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'shared.template.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TEMPLATE_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await sharedServicesModule().templates.createTemplate(
        db,
        await parseJsonBody(raw, Body)
      ),
    }),
    { body }
  );
}
