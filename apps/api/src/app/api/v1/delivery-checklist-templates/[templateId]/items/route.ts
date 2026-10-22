/**
 * POST /api/v1/delivery-checklist-templates/{templateId}/items (Phase 1-31, P-9).
 *
 * Adds one item to an existing checklist template.
 *
 * The template's create route accepts its items in the same body, so this exists for
 * the later addition rather than for the first authoring: a checklist grows when a
 * workshop decides one more thing must be checked before a vehicle leaves.
 *
 * ## A mandatory item is a company-wide gate, and the route says so
 *
 * `sal.complete_delivery` counts mandatory items by `(tenant, company)` across ALL
 * templates — `sal.delivery_records` carries no template reference — so
 * `isMandatory: true` here blocks every handover in that company until each delivery
 * records a `passed` or `waived` outcome for this item. It defaults to `false`, and
 * the authority required is company-wide for exactly this reason.
 *
 * There is no read on this path: the items are returned WITH their template by
 * `GET /delivery-checklist-templates/{templateId}`, in checklist order, because the
 * order is the checklist and a separate paged read would cut it in half.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  CHECKLIST_CODE,
  MAX_ITEM_LABEL,
  MAX_SORT_ORDER,
  MIN_SORT_ORDER,
  deliveryModule,
} from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid }).strict();

export const ItemCreateBody = z
  .object({
    itemCode: z.string().regex(CHECKLIST_CODE, 'itemCode must match ^[a-z][a-z0-9_]{1,62}$'),
    label: z.string().trim().min(1).max(MAX_ITEM_LABEL),
    isMandatory: z.boolean().optional(),
    sortOrder: z.number().int().min(MIN_SORT_ORDER).max(MAX_SORT_ORDER).optional(),
  })
  .strict();

export const CHECKLIST_TEMPLATE_ITEM_CREATE_OPERATION = defineOperation({
  id: 'sal.delivery-checklist-template-item-create',
  successStatus: 201,
  module: 'delivery',
  method: 'POST',
  path: '/delivery-checklist-templates/{templateId}/items',
  summary: 'Add one item to a delivery checklist template.',
  permissions: ['sal.delivery.manage'],
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'sal.delivery_checklist_template.item_added',
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
    CHECKLIST_TEMPLATE_ITEM_CREATE_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, ItemCreateBody);
      const created = await deliveryModule().checklistTemplates.createItem(
        db,
        params.templateId,
        input,
        authorizeScope
      );
      // The ETag is the ITEM's version, which is the value its own PATCH expects in
      // `If-Match` — deliberately not the template's, which is a different counter on
      // a different row and is what the two template commands expect.
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { params: raw, body }
  );
}
