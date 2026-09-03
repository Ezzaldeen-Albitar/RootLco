/**
 * GET / PATCH /api/v1/inspection-templates/{templateId} (PRE-P1-29-BR-04).
 *
 * ## The detail read carries the versions, and their item counts
 *
 * Versions are not paged — a template has few — and each one reports `itemCount`
 * so a caller can tell an empty draft from an authored one without a second read.
 * That is the exact fact which decides whether publishing will be accepted, so
 * making the client discover it by trying would be designing in a failed request.
 *
 * ## `code` is not updatable, and that is a decision rather than an omission
 *
 * A template code is an identifier tenants build on. Changing it once versions
 * exist would silently re-label published history, so the body offers `name` and
 * `status` only. `.strict()` turns an attempt into a 422 instead of a silent
 * no-op.
 *
 * ## The known limitation, stated where it is true
 *
 * `name` is last-write-wins with attribution and no history table, so a rename
 * DOES silently re-label this template's published versions in every future read.
 * The freeze protects the QUESTIONS a report was asked, not the label on the
 * template that asked them. Recorded rather than fixed: fixing it means a history
 * table, which is a separate slice.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { diagnosticsModule, MAX_TEMPLATE_NAME, TEMPLATE_STATUSES } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid });

export const InspectionTemplateUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(MAX_TEMPLATE_NAME).optional(),
    status: z.enum(TEMPLATE_STATUSES).optional(),
  })
  .strict();

export const TEMPLATE_DETAIL_OPERATION = defineOperation({
  id: 'dia.template-detail',
  module: 'diagnostics',
  method: 'GET',
  path: '/inspection-templates/{templateId}',
  summary: 'Read one inspection template with every version it owns.',
  permissions: ['dia.diagnostic.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    TEMPLATE_DETAIL_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      return { body: await diagnosticsModule().templates.templateDetail(db, params.templateId) };
    },
    { params: raw }
  );
}

export const TEMPLATE_UPDATE_OPERATION = defineOperation({
  id: 'dia.template-update',
  module: 'diagnostics',
  method: 'PATCH',
  path: '/inspection-templates/{templateId}',
  summary: 'Rename an inspection template or move it between active and inactive.',
  permissions: ['dia.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'dia.inspection_template.updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TEMPLATE_UPDATE_OPERATION,
    request,
    async ({ db, request: req, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, InspectionTemplateUpdateBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const updated = await diagnosticsModule().templates.updateTemplate(
        db,
        params.templateId,
        input,
        expectedVersion
      );
      return { body: updated, recordVersion: updated.template.recordVersion };
    },
    { params: raw, body }
  );
}
