/**
 * /api/v1/stock-movements — the immutable movement ledger (P1-21-BE-011).
 *
 * Read-only by construction: `inv.stock_movements` is granted SELECT + INSERT only
 * to `app_runtime`, so there is no UPDATE or DELETE route to write here. A
 * correction is a new movement, never an edit, which is why this file exposes `GET`
 * and nothing else.
 *
 * Ordered by `seq` descending. `seq` is `GENERATED ALWAYS AS IDENTITY`, so it is a
 * strict total order that `occurred_at` is not: damage posts two rows inside one
 * transaction and they share `now()` to the microsecond, so a timestamp cursor
 * would skip or repeat rows across a page boundary.
 *
 * ## Why reading this is audited
 *
 * The ledger is the complete record of what a branch holds and consumes. An
 * unlogged bulk read of it is exactly the reconnaissance an audit trail exists to
 * catch, so `auditClass: 'privileged'` and the service records the filter — never
 * the rows, because copying stock levels into the audit table would duplicate the
 * very data the audit is protecting.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { MOVEMENT_TYPES, REFERENCE_KINDS, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

const Query = z
  .object({
    // REQUIRED, and they are the authorizationTarget. They were optional, and
    // omitting them skipped `authorizeScope` entirely — leaving RLS, whose
    // `app.branch_ids` is the permission-blind union of every grant (P1-18-A-01), as
    // the only narrowing on the complete record of what a branch holds and consumes.
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    itemId: schemas.uuid.optional(),
    locationId: schemas.uuid.optional(),
    workOrderId: schemas.uuid.optional(),
    movementType: z.enum(MOVEMENT_TYPES).optional(),
    referenceKind: z.enum(REFERENCE_KINDS).optional(),
    // Full instants, not dates: `occurred_at` is `timestamptz`, and accepting a bare
    // date would silently mean midnight in whatever zone the server happened to be.
    occurredFrom: z.string().regex(ISO_INSTANT, 'must be an ISO-8601 instant').optional(),
    occurredTo: z.string().regex(ISO_INSTANT, 'must be an ISO-8601 instant').optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const STOCK_MOVEMENT_LIST_OPERATION = defineOperation({
  id: 'inv.stock-movement-list',
  module: 'inventory',
  method: 'GET',
  path: '/stock-movements',
  summary: 'List the immutable stock movement ledger, correlated by business reference.',
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.movement_history.read',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    STOCK_MOVEMENT_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await inventoryModule().reads.listMovements(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
            ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
            ...(query.workOrderId === undefined ? {} : { workOrderId: query.workOrderId }),
            ...(query.movementType === undefined ? {} : { movementType: query.movementType }),
            ...(query.referenceKind === undefined ? {} : { referenceKind: query.referenceKind }),
            ...(query.occurredFrom === undefined ? {} : { occurredFrom: query.occurredFrom }),
            ...(query.occurredTo === undefined ? {} : { occurredTo: query.occurredTo }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    scopeTargetOption(raw)
  );
}
