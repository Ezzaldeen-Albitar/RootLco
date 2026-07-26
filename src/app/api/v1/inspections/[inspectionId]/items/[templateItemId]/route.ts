/**
 * PUT /api/v1/inspections/{inspectionId}/items/{templateItemId} (Phase 1-19, P1-19-BE-010).
 *
 * Records or replaces the answer to one template item.
 *
 * `PUT` rather than `POST` because the answer is 1:1 with the item —
 * `uq_report_item_results_report_item` is a partial unique index over live rows — and
 * a technician correcting a mistyped reading should not need a new report. Replacement
 * is refused once the report is no longer recordable, which the database does not
 * enforce: `dia.report_item_results` references the report by foreign key and never
 * consults its status, so a completed report would silently accept new answers and
 * change what it says after it was signed.
 *
 * ## The item must belong to the report's PINNED version
 *
 * `fk_report_item_results_item` is `(tenant_id, template_item_id)` and names no
 * version, so an item from a different template — or from a NEWER version of the same
 * template — satisfies it. Only a read through the report refuses that, and without it
 * a report could be answered with questions it was never asked.
 *
 * ## A value, or a documented reason — never neither
 *
 * `ck_report_item_results_answered` demands one of the two. A mandatory item may be
 * skipped, but the completion gate counts a not-applicable REASON as an answer and an
 * absent row as nothing, so skipping is always on the record.
 *
 * The value's shape is checked against the item's `response_type`, which the database
 * does not do: a `boolean` item would otherwise accept "maybe" and a `select` item any
 * string at all. Numeric BOUNDS are deliberately not checked here — a numeric answer
 * is bounded against `validation_rule` in the database as `numeric`, because a
 * JavaScript comparison would round values the column stores exactly.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  MAX_NOT_APPLICABLE_REASON,
  MAX_RESULT_VALUE,
  diagnosticsModule,
} from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid, templateItemId: schemas.uuid });

const Body = z
  .object({
    resultValue: z.string().trim().min(1).max(MAX_RESULT_VALUE).optional(),
    notApplicableReason: z.string().trim().min(1).max(MAX_NOT_APPLICABLE_REASON).optional(),
  })
  .strict();

export const DIAGNOSTIC_ITEM_RESULT_OPERATION = defineOperation({
  id: 'dia.diagnostic-item-result',
  module: 'diagnostics',
  method: 'PUT',
  path: '/inspections/{inspectionId}/items/{templateItemId}',
  summary: 'Answer one template item, or document why it does not apply.',
  permissions: ['dia.diagnostic.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'dia.diagnostic.entry_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PUT(
  request: Request,
  route: { params: Promise<{ inspectionId: string; templateItemId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DIAGNOSTIC_ITEM_RESULT_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const result = await diagnosticsModule().reports.recordItemResult(
        db,
        params.inspectionId,
        params.templateItemId,
        { resultValue: parsed.resultValue, notApplicableReason: parsed.notApplicableReason },
        authorizeScope
      );
      return { status: 200, body: result, recordVersion: result.recordVersion };
    },
    { params: raw, body }
  );
}
