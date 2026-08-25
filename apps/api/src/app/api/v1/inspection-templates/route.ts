/**
 * GET / POST /api/v1/inspection-templates (PRE-P1-29-BR-04).
 *
 * ## Authoring what an inspection ASKS is not recording against one
 *
 * `POST` costs `dia.catalogue.manage`; `GET` costs `dia.diagnostic.read`. The
 * split is the point. A published template version becomes the immutable
 * structure of every inspection recorded against it, so the authority to freeze
 * that structure is separated from the authority to fill one in — a technician
 * holding `dia.diagnostic.record` gains nothing here.
 *
 * The code is minted rather than reused, following the rule the permission seed
 * states at `:309-311` and applies twice already (`apt.catalogue.manage`,
 * `rec.catalogue.manage`): one code per schema, named for the surface rather than
 * the artefact. That is why there is no `dia.template.*` code.
 *
 * ## Tenant-scoped, because the row layer is
 *
 * `dia.inspection_templates` carries no `company_id` and no `branch_id`, so its
 * RLS policies are pure `tenant_id = iam.current_tenant_id()`. Declaring `branch`
 * would be a claim the row layer cannot support.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { diagnosticsModule, MAX_TEMPLATE_NAME, TEMPLATE_STATUSES } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `code` mirrors `ck_inspection_templates_code_format` exactly, so a bad code is
 * a 422 naming the field rather than a `23514` the caller has to decode.
 */
export const InspectionTemplateCreateBody = z
  .object({
    code: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,62}$/, 'code must match ^[a-z][a-z0-9_]{1,62}$'),
    name: z.string().trim().min(1).max(MAX_TEMPLATE_NAME),
    diagnosticTypeId: schemas.uuid,
  })
  .strict();

export const InspectionTemplateListQuery = z
  .object({
    status: z.enum(TEMPLATE_STATUSES).optional(),
    diagnosticTypeId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const TEMPLATE_CREATE_OPERATION = defineOperation({
  id: 'dia.template-create',
  module: 'diagnostics',
  method: 'POST',
  path: '/inspection-templates',
  summary: 'Create an inspection template in the caller tenant library.',
  permissions: ['dia.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'dia.inspection_template.created',
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
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, InspectionTemplateCreateBody);
      const created = await diagnosticsModule().templates.createTemplate(db, input);
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}

export const TEMPLATE_LIST_OPERATION = defineOperation({
  id: 'dia.template-list',
  module: 'diagnostics',
  method: 'GET',
  path: '/inspection-templates',
  summary: 'List the inspection templates of the caller tenant, newest first.',
  permissions: ['dia.diagnostic.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(TEMPLATE_LIST_OPERATION, request, async ({ db, request: raw }) => {
    const query = parseOrFail(
      InspectionTemplateListQuery,
      searchParamsToObject(new URL(raw.url).searchParams),
      'query'
    );
    return {
      body: await diagnosticsModule().templates.listTemplates(
        db,
        { status: query.status, diagnosticTypeId: query.diagnosticTypeId },
        { cursor: query.cursor, limit: query.limit }
      ),
    };
  });
}
