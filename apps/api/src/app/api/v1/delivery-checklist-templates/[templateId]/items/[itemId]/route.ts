/**
 * PATCH / DELETE /api/v1/delivery-checklist-templates/{templateId}/items/{itemId}
 * (Phase 1-31, prerequisite P-9).
 *
 * Edits one checklist item, or withdraws it.
 *
 * ## `If-Match` carries the ITEM's version, never the template's
 *
 * The path names two rows and each carries its own `record_version`; sending the
 * template's version here is the mistake this paragraph exists to prevent. The item's
 * current version comes from `GET /delivery-checklist-templates/{templateId}`, which
 * publishes it on every item, and from the create response's ETag.
 *
 * ## `itemCode` cannot be edited
 *
 * `sal.delivery_checklist_results.template_item_id` points at this row by id, so
 * re-coding it would silently re-label every outcome ever recorded against it.
 * Withdraw the item and add the code you meant: the unique index is partial on
 * `deleted_at IS NULL`, so the withdrawn code returns to the template.
 *
 * ## Withdrawal is a soft delete, and it is the only way to stop an item gating
 *
 * There is no DELETE grant and no DELETE policy on this table for any application
 * role, and `fk_delivery_checklist_results_item` is `ON DELETE RESTRICT`, so the
 * verb performs an UPDATE that sets `deleted_at` — the `tech.technician-skill-withdraw`
 * precedent. `sal.complete_delivery` filters mandatory items on exactly that column,
 * so withdrawing is what an operator does when a mandatory item is blocking handovers
 * it should not. Deactivating the parent TEMPLATE does not have that effect; see the
 * status route.
 *
 * Every outcome already recorded against the item stays readable:
 * `sal.delivery-checklist-result-list` joins the item without a `deleted_at`
 * predicate, deliberately.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_ITEM_LABEL, MAX_SORT_ORDER, MIN_SORT_ORDER, deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid, itemId: schemas.uuid }).strict();

/**
 * Patch body — every field optional, at least one required.
 *
 * An omitted field is left alone rather than reset: the repository applies the patch
 * with `COALESCE`, so a request carrying only `label` cannot silently turn a mandatory
 * item optional. An EMPTY body is refused rather than treated as a no-op that still
 * burns a record version.
 */
export const ItemUpdateBody = z
  .object({
    label: z.string().trim().min(1).max(MAX_ITEM_LABEL).optional(),
    isMandatory: z.boolean().optional(),
    sortOrder: z.number().int().min(MIN_SORT_ORDER).max(MAX_SORT_ORDER).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.label !== undefined || value.isMandatory !== undefined || value.sortOrder !== undefined,
    { message: 'at least one of label, isMandatory or sortOrder is required' }
  );

export const CHECKLIST_TEMPLATE_ITEM_UPDATE_OPERATION = defineOperation({
  id: 'sal.delivery-checklist-template-item-update',
  module: 'delivery',
  method: 'PATCH',
  path: '/delivery-checklist-templates/{templateId}/items/{itemId}',
  summary: 'Edit the label, mandatory flag or order of one checklist item.',
  permissions: ['sal.delivery.manage'],
  // `company`, re-authorized by the service against the parent template's own
  // company. Company-wide authority, because turning an item mandatory here blocks
  // the handover of every vehicle in every branch of that company.
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'sal.delivery_checklist_template.item_updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ templateId: string; itemId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    CHECKLIST_TEMPLATE_ITEM_UPDATE_OPERATION,
    request,
    async ({ db, request: req, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, ItemUpdateBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const updated = await deliveryModule().checklistTemplates.updateItem(
        db,
        params.templateId,
        params.itemId,
        expectedVersion,
        input,
        authorizeScope
      );
      return { body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw, body }
  );
}

export const CHECKLIST_TEMPLATE_ITEM_REMOVE_OPERATION = defineOperation({
  id: 'sal.delivery-checklist-template-item-remove',
  module: 'delivery',
  method: 'DELETE',
  path: '/delivery-checklist-templates/{templateId}/items/{itemId}',
  summary: 'Withdraw one checklist item. Soft delete: recorded outcomes stay readable.',
  permissions: ['sal.delivery.manage'],
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'sal.delivery_checklist_template.item_removed',
  // NOT version-guarded, following `tech.technician-skill-withdraw`: the withdrawal
  // has one possible outcome whatever the item's label or order happen to be, a
  // second attempt finds the row already withdrawn and answers the uniform
  // `ERR-RES-001`, and there is no concurrent edit a version could protect against.
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function DELETE(
  request: Request,
  route: { params: Promise<{ templateId: string; itemId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    CHECKLIST_TEMPLATE_ITEM_REMOVE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await deliveryModule().checklistTemplates.removeItem(
          db,
          params.templateId,
          params.itemId,
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
