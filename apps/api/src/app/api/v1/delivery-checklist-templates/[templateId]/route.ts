/**
 * GET / PATCH /api/v1/delivery-checklist-templates/{templateId} (Phase 1-31, P-9).
 *
 * `GET` returns one template WITH its live items, in checklist order. `PATCH` renames
 * it under `If-Match`.
 *
 * ## The items are not paged, and the order is the point
 *
 * `dia.template-version-item-list` states the rule this follows: the order IS the
 * checklist, so a page boundary would cut a checklist in half. The set is bounded by
 * authoring, and the ordering is `(sort_order, item_code)` — `sort_order` is not
 * unique, so the code breaks the tie and two reads answer in the same order.
 *
 * Withdrawn items are excluded. A result recorded against an item that was later
 * withdrawn is still readable through `sal.delivery-checklist-result-list`, whose
 * join deliberately carries no `deleted_at` predicate on the item.
 *
 * ## Absent and invisible answer the same thing
 *
 * `findTemplate` returns null for both and the service turns both into one
 * `ERR-RES-001`, decided before anything else, so this read is not an existence
 * oracle for a template in a company the caller cannot see.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_TEMPLATE_NAME, deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid }).strict();

export const CHECKLIST_TEMPLATE_READ_OPERATION = defineOperation({
  id: 'sal.delivery-checklist-template-read',
  module: 'delivery',
  method: 'GET',
  path: '/delivery-checklist-templates/{templateId}',
  summary: 'Read one delivery checklist template with its items, in checklist order.',
  permissions: ['sal.delivery.view'],
  // `tenant`, for the reason the collection read states: the table has a company and
  // no branch, and a company target would deny the checklist to the branch-scoped
  // delivery officer who performs the handover. RLS narrows by
  // `iam.allowed_company_ids()`.
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
    CHECKLIST_TEMPLATE_READ_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const detail = await deliveryModule().checklistTemplates.readTemplate(db, params.templateId);
      // Published as the ETag as well as in the body: the rename and the status
      // command are version-guarded and `parseIfMatch` accepts only an exact
      // positive integer, so a caller needs a current version to act at all.
      return { body: detail, recordVersion: detail.template.recordVersion };
    },
    { params: raw }
  );
}

/**
 * Rename body — the label and nothing else.
 *
 * `templateCode` is absent: a re-coded template is a different configuration wearing
 * the old one's identity, and an operator reading a historical audit record would
 * have no way to know the code moved. `status` is absent because retiring a checklist
 * is its own command, so the authority to fix a typo is not the authority to withdraw
 * a checklist from every branch of a company. `companyId` is absent because
 * `tg_delivery_checklist_templates_immutable` freezes it.
 */
export const RenameBody = z
  .object({ name: z.string().trim().min(1).max(MAX_TEMPLATE_NAME) })
  .strict();

export const CHECKLIST_TEMPLATE_RENAME_OPERATION = defineOperation({
  id: 'sal.delivery-checklist-template-rename',
  module: 'delivery',
  method: 'PATCH',
  path: '/delivery-checklist-templates/{templateId}',
  summary: 'Rename one delivery checklist template.',
  permissions: ['sal.delivery.manage'],
  // `company`, re-authorized by the service against the row's OWN company once it is
  // read — a declared scope is inert without a target (P1-18-A-01). Company-wide
  // authority, because the checklist this names gates every branch of that company.
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'sal.delivery_checklist_template.renamed',
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
    CHECKLIST_TEMPLATE_RENAME_OPERATION,
    request,
    async ({ db, request: req, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, RenameBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      // The version is the TEMPLATE's own, which is what both this route's GET and
      // the create response publish as their ETag. An ITEM carries a separate
      // counter and is guarded on its own path.
      const updated = await deliveryModule().checklistTemplates.renameTemplate(
        db,
        params.templateId,
        expectedVersion,
        input.name,
        authorizeScope
      );
      return { body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw, body }
  );
}
