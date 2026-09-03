/**
 * /api/v1/deliveries/{deliveryId}/checklist-results — record one handover checklist
 * outcome (P1-22-BE-016).
 *
 * `ck_delivery_checklist_results_waiver` makes the waiver rule a biconditional:
 * `(outcome = 'waived') = (waiver_reason IS NOT NULL)`. So a waiver with no reason and a
 * reason attached to a pass are BOTH refused, and the second half is the one a caller
 * would not expect — hence the explicit refusal rather than a silently-dropped field.
 *
 * `sal.complete_delivery` refuses completion while any mandatory item lacks a `passed` or
 * `waived` result, and it evaluates that over items scoped to the delivery's **company**
 * rather than to any one template. That is worth knowing here: adding a mandatory item to
 * any active template in the company immediately blocks every in-flight delivery that has
 * no result for it.
 *
 * `uq_delivery_checklist_results_item` permits one result per item per delivery, so a
 * re-record is `23505` and the service refuses it rather than overwriting — an overwrite
 * would silently erase a `failed` outcome that a completion gate had already read.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { CHECKLIST_OUTCOMES, MAX_REASON, deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ deliveryId: schemas.uuid }).strict();

export const RecordBody = z
  .object({
    templateItemId: schemas.uuid,
    // Borrowed from the domain so the schema and the CHECK constraint cannot drift.
    outcome: z.enum(CHECKLIST_OUTCOMES),
    waiverReason: z.string().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const DELIVERY_CHECKLIST_RECORD_OPERATION = defineOperation({
  id: 'sal.delivery-checklist-record',
  successStatus: 201,
  module: 'delivery',
  method: 'POST',
  path: '/deliveries/{deliveryId}/checklist-results',
  summary: 'Record one handover checklist item as passed, failed or waived.',
  permissions: ['sal.delivery.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'sal.delivery.checklist_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ deliveryId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DELIVERY_CHECKLIST_RECORD_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(RecordBody, body, 'body');
      const result = await deliveryModule().deliveries.recordChecklistResult(
        db,
        params.deliveryId,
        {
          templateItemId: parsed.templateItemId,
          outcome: parsed.outcome,
          ...(parsed.waiverReason === undefined ? {} : { waiverReason: parsed.waiverReason }),
        },
        authorizeScope
      );
      return { status: 201, body: result };
    },
    { params: raw, body }
  );
}
