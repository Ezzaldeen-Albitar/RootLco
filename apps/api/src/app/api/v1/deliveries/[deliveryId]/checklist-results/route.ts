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
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { CHECKLIST_OUTCOMES, MAX_REASON, deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ deliveryId: schemas.uuid }).strict();
const PageQuery = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

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

/**
 * GET — the checklist results recorded against a delivery (Phase 1-31,
 * prerequisite P-4).
 *
 * ## The gaps were readable; the results were not
 *
 * `.../eligibility` publishes a bounded sample of mandatory items with NO satisfying
 * result — the gap set, capped at 20, with `missingCount` computed and then dropped
 * before the wire (**P1-27-INT-088**). That is the complement of what a delivery
 * document needs. The POST above returns the one result it created, and nothing read
 * the recorded set back.
 *
 * **This is not a pure publication, and that is stated rather than implied.**
 * `findChecklistResult` is addressed by `(delivery, templateItemId)` and exists to
 * answer "was this ONE item already recorded" for the write path. Publishing it as it
 * stands would hand a screen a read it cannot address, because the checklist TEMPLATE
 * has no HTTP surface at all (**PPD-12**, prerequisite P-9) so no caller can discover
 * a `template_item_id` to put in a path. The set read is the smallest read that makes
 * recorded results reachable. It reuses `toChecklistResult` — one wire contract for
 * this row, widened by the two joined template columns, not a second one.
 *
 * `itemCode` and `label` are joined from `sal.delivery_checklist_template_items`
 * through `fk_delivery_checklist_results_item` (`ON DELETE RESTRICT`, so the join is
 * total). `itemCode` is already on the POST response, so publishing it here is
 * contract PARITY; `label` is already published on the eligibility gap rows. Without
 * them a result is an opaque pair of uuids while the template has no surface.
 *
 * ## What this does NOT do
 *
 * It does not close P1-27-INT-088. The gap side — mandatory-only, capped at 20,
 * `missingCount` dropped — is untouched by this slice and remains exactly as
 * recorded, as does the company-scoped rather than template-scoped gap scan.
 *
 * ## `deleted_at` IS filtered here
 *
 * Unlike `findChecklistResult`, which must see a soft-deleted row because
 * `uq_delivery_checklist_results_item` is non-partial and that row still occupies the
 * slot. This read answers "what has been recorded", and a withdrawn result is not a
 * recorded one.
 *
 * ## Paging
 *
 * Keyset, newest first. The set is bounded per delivery by that same unique index —
 * at most one row per template item — but the template itself is unbounded, so the
 * bound is a number this module does not control. The cursor sorts on `created_at`,
 * which the response does not carry, minted by `cursorTimestamp()` at microsecond
 * precision (`P1-27-INT-006`).
 */
export const DELIVERY_CHECKLIST_RESULT_LIST_OPERATION = defineOperation({
  id: 'sal.delivery-checklist-result-list',
  module: 'delivery',
  method: 'GET',
  path: '/deliveries/{deliveryId}/checklist-results',
  summary: 'List the checklist results recorded against a delivery, newest first.',
  permissions: ['sal.delivery.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ deliveryId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const rawQuery = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    DELIVERY_CHECKLIST_RESULT_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(PageQuery, rawQuery, 'query');
      return {
        body: await deliveryModule().reads.readChecklistResults(
          db,
          params.deliveryId,
          { cursor: query.cursor, limit: query.limit },
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
