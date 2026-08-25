/**
 * POST /api/v1/inspection-templates/{templateId}/versions (PRE-P1-29-BR-04).
 *
 * Creates the next version of a template. It is always `draft`.
 *
 * ## `versionNumber` is server-assigned, and the body refuses to accept one
 *
 * `ck_template_versions_number` guards the VALUE (`> 0`) and says nothing about
 * the sequence, so a client-chosen number is a collision waiting to happen and a
 * re-labelling of published history waiting to be argued about. The body is
 * `.strict()` and carries no `versionNumber`, so sending one is a 422 rather than
 * a value that quietly wins.
 *
 * ## `copyFromVersionId` exists so the correct path is the easy one
 *
 * Because `tg_template_items_frozen` is `BEFORE INSERT OR UPDATE`, a published
 * version's item set is closed — appends included. So "change a published
 * inspection" is necessarily: new version, author items, publish, retire the old
 * one. Re-typing forty items to change one is the failure mode that makes people
 * avoid versioning altogether and edit in place instead, which is exactly what
 * the freeze exists to prevent. The copy is a small addition that removes the
 * incentive.
 *
 * The source must belong to the SAME template — copying across templates would
 * silently fork one library's content into another, and is a 422.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { diagnosticsModule } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid });

export const TemplateVersionCreateBody = z
  .object({ copyFromVersionId: schemas.uuid.optional() })
  .strict();

export const TEMPLATE_VERSION_CREATE_OPERATION = defineOperation({
  id: 'dia.template-version-create',
  module: 'diagnostics',
  method: 'POST',
  path: '/inspection-templates/{templateId}/versions',
  summary: 'Create the next draft version of an inspection template.',
  permissions: ['dia.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'dia.template_version.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TEMPLATE_VERSION_CREATE_OPERATION,
    request,
    async ({ db, request: req }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, TemplateVersionCreateBody);
      const created = await diagnosticsModule().templates.createVersion(
        db,
        params.templateId,
        input
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { params: raw, body }
  );
}
