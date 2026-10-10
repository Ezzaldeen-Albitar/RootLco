/**
 * /api/v1/returnable-quantities — how much of a source may still come back
 * (P1-32-PRE-116).
 *
 * The question the counter asks before it accepts anything, and the one
 * `inv.part_returns` could never answer: a part issue and a counter-sale line both
 * put a quantity into someone's hands, and a return is bounded by what is left of
 * it. The reply states all three figures — what left, what has already come back,
 * and the remainder — because a bare remainder cannot be reconciled by the person
 * holding the part.
 *
 * ## It counts BOTH return tables
 *
 * `inv.returned_quantity` sums `inv.sales_returns` and, for a part-issue source,
 * the legacy `inv.part_returns` rows that `POST /stock-returns` still writes. A
 * remainder that ignored the old path would invite a return the ceiling then
 * refuses.
 *
 * ## Advisory, and honest about it
 *
 * No lock is taken. The binding ceiling is re-checked under the source row lock
 * when the return is received, so two counters reading the same remainder still
 * produce one winner. This read is what a person is shown, not what the invariant
 * rests on.
 *
 * ## Scope
 *
 * The query names a source, not a branch, so the concrete authorization target is
 * resolved by the service from the source's own company and branch — a caller
 * cannot learn what a branch it holds no authority in has sold.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { SALES_RETURN_SOURCE_KINDS, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    sourceKind: z.enum(SALES_RETURN_SOURCE_KINDS),
    sourceId: schemas.uuid,
  })
  .strict();

export const RETURNABLE_QUANTITY_READ_OPERATION = defineOperation({
  id: 'inv.returnable-quantity-read',
  module: 'inventory',
  method: 'GET',
  path: '/returnable-quantities',
  summary: 'Read how much of a part issue or a counter-sale line may still be returned.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    RETURNABLE_QUANTITY_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await inventoryModule().salesReturns.readReturnable(
          db,
          query.sourceKind,
          query.sourceId,
          authorizeScope
        ),
      };
    },
    {}
  );
}
