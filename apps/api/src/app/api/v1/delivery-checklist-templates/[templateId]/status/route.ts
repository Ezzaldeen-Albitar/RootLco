/**
 * POST /api/v1/delivery-checklist-templates/{templateId}/status (Phase 1-31, P-9).
 *
 * Retires (`inactive`) or restores (`active`) one checklist template.
 *
 * ## There is no delete, and there cannot be
 *
 * Neither `sal.delivery_checklist_templates` nor its item table carries a DELETE
 * grant or a DELETE policy for any application role, so a hard removal is refused by
 * the database however it is asked for. That is the property that matters here:
 * recorded handover results point at ITEMS by id and `fk_delivery_checklist_results_item`
 * is `ON DELETE RESTRICT`, so a template that could vanish would break every delivery
 * document referencing what it asked.
 *
 * ## Why it restores as well as retires
 *
 * `uq_delivery_checklist_templates_code` is `(tenant_id, company_id, template_code)
 * WHERE deleted_at IS NULL`. The predicate names `deleted_at` and says nothing about
 * `status`, so an inactive template still holds its code and re-adding that code is a
 * `23505`. A retire-only command would burn the code for the company permanently —
 * the `apt.catalogue-source-channel-status-set` precedent, for the same reason.
 *
 * ## What deactivation does NOT do
 *
 * It does not stop the template's mandatory items gating a handover.
 * `sal.complete_delivery` counts mandatory items by `(tenant, company)`, filtered on
 * the ITEM's `deleted_at`, and never joins the parent template — so an inactive
 * template with a mandatory item still blocks every delivery in that company. That is
 * the deployed behaviour of a protected function; correcting it is a migration and is
 * recorded as a finding in `docs/phase-1/phase-1-31/delivery-checklist-template-seam.md`
 * rather than mirrored here, because a mirror that "improved" on the primitive would
 * report a delivery eligible that the primitive then refuses. To stop an item gating,
 * withdraw the ITEM.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { CHECKLIST_TEMPLATE_STATUSES, deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid }).strict();
export const StatusBody = z.object({ status: z.enum(CHECKLIST_TEMPLATE_STATUSES) }).strict();

export const CHECKLIST_TEMPLATE_STATUS_OPERATION = defineOperation({
  id: 'sal.delivery-checklist-template-status-set',
  module: 'delivery',
  method: 'POST',
  path: '/delivery-checklist-templates/{templateId}/status',
  summary: 'Retire or restore one delivery checklist template.',
  permissions: ['sal.delivery.manage'],
  // `company`, re-authorized by the service against the row's own company
  // (P1-18-A-01: a declared scope is inert without a target).
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'sal.delivery_checklist_template.status_changed',
  // Both guards, as `apt.catalogue-source-channel-status-set` declares them: the
  // version makes the transition decide against the state the caller actually read,
  // and the key makes a retried request return the first answer instead of a version
  // conflict the client cannot distinguish from a real one.
  idempotent: true,
  versionGuarded: true,
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
    CHECKLIST_TEMPLATE_STATUS_OPERATION,
    request,
    async ({ db, request: req, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, StatusBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await deliveryModule().checklistTemplates.setTemplateStatus(
        db,
        params.templateId,
        expectedVersion,
        input.status,
        authorizeScope
      );
      return { body: changed, recordVersion: changed.recordVersion };
    },
    { params: raw, body }
  );
}
