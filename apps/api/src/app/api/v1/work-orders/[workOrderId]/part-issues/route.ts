/**
 * GET /api/v1/work-orders/{workOrderId}/part-issues (Phase 1-30 A2, seam S-15).
 *
 * The parts issued to one work order, with how much of each has come back.
 *
 * ## Why the parent path, and not `GET /stock-issues?workOrderId=...`
 *
 * Because a filter is not an authorization target. `requiresScopedEvaluation`
 * returns false on an EMPTY target regardless of the declared scope, so a
 * top-level collection narrowed only by a query parameter would carry
 * `scope: 'branch'` and still be evaluated scope-blind (P1-18-A-01) - leaving
 * `app.branch_ids`, the permission-blind union of every active grant, as the only
 * narrowing on a per-work-order stock history. Naming the parent in the path
 * makes the work-order ROW the thing that is authorized, and the service resolves
 * it through `@/modules/work-order` before it reads a single issue.
 *
 * The existing `POST /stock-issues` writes these rows and stays where it is: the
 * write already derives its scope from the work order it names in the body.
 *
 * ## Empty is not the same as hidden
 *
 * A visible work order with no parts issued answers an empty page. A work order
 * the caller may not see is `ERR-RES-001` before any issue row is touched, so an
 * empty page cannot stand in for a refusal.
 *
 * ## Quantities
 *
 * `quantity` and `returnedQty` are `numeric(12,3)` and cross as decimal STRINGS.
 * The outstanding amount is NOT published: netting them would be a subtraction of
 * two exact decimals in IEEE-754, and `inv.guard_part_return_ceiling` is the
 * authority on whether a return exceeds its issue. Both exact operands are given
 * instead.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const WORK_ORDER_PART_ISSUE_LIST_OPERATION = defineOperation({
  id: 'inv.work-order-part-issue-list',
  module: 'inventory',
  method: 'GET',
  path: '/work-orders/{workOrderId}/part-issues',
  summary: 'List the parts issued to a work order, with the quantity returned so far.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const rawQuery = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    WORK_ORDER_PART_ISSUE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(Query, rawQuery, 'query');
      return {
        body: await inventoryModule().reads.listPartIssuesForWorkOrder(
          db,
          params.workOrderId,
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
