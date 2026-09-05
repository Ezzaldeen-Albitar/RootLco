/**
 * GET /api/v1/work-orders/{workOrderId}/quotations (Phase 1-30 A2, seam S-07).
 *
 * The quotations raised against one work order, newest first.
 *
 * ## Why the collection hangs off the work order
 *
 * `quo.quotations.work_order_id` is NOT NULL and immutable, so a quotation
 * cannot exist without a work order and cannot be moved to another one. The
 * parent is therefore the authority for scope, and this path names it. A
 * top-level `GET /quotations?workOrderId=…` would name no parent, which makes
 * the declared `scope: 'branch'` inert — `requiresScopedEvaluation` returns
 * false for an empty target whatever the declaration says (P1-18-A-01) — and the
 * only narrowing left would be `app.branch_ids`, the permission-blind union of
 * every active grant.
 *
 * `QuotationService.listForWorkOrder` resolves the parent through
 * `requireWorkOrder` before it reads a single quotation, so the company and
 * branch authorized are the ones stored on the row, never a pair a client chose.
 *
 * ## Empty is not the same as hidden
 *
 * A visible work order nobody has quoted answers an empty page. A work order the
 * caller may not see is refused with `ERR-RES-001` before any quotation is read.
 * Collapsing those would let a caller enumerate work orders in branches they
 * cannot see by reading which ids answer "no quotations" instead of "not found".
 *
 * ## No money crosses here
 *
 * The list carries headers only. Amounts live on the revision, which
 * `GET /quotations/{quotationId}` returns as `numeric(18,4)` decimal strings —
 * this route neither renders nor recomputes them, so there is nothing here for a
 * JSON number to round.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { quotationModule } from '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });

/**
 * Pagination only, and `.strict()`.
 *
 * No status filter is offered. A work order holds a handful of quotations and
 * the caller can read `status` off each header; a filter would add a branch, a
 * denial case and a coverage obligation for a set the client can narrow itself.
 * `.strict()` makes an unknown parameter an `ERR-VAL-001` (422) rather than a
 * silently ignored one — a caller that misspells a filter must be told, not
 * handed the unfiltered list and left to believe it was applied.
 */
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const WORK_ORDER_QUOTATION_LIST_OPERATION = defineOperation({
  id: 'quo.quotation-list',
  module: 'quotation',
  method: 'GET',
  path: '/work-orders/{workOrderId}/quotations',
  summary: 'List the quotations raised against a work order, newest first.',
  // The same code the sibling read of these rows declares (`quo.quotation-detail`).
  permissions: ['quo.quotation.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  // Both schemas run INSIDE the pipeline, so a malformed id or cursor is rendered
  // as the shared problem document rather than escaping the route as a 500.
  const raw = await route.params;
  const rawQuery = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    WORK_ORDER_QUOTATION_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(Query, rawQuery, 'query');
      return {
        body: await quotationModule().quotations.listForWorkOrder(
          db,
          params.workOrderId,
          { cursor: query.cursor, limit: query.limit },
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
