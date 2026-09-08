/**
 * GET /api/v1/deliveries/{deliveryId}/status-history (Phase 1-31, prerequisite P-5).
 *
 * The append-only delivery transition ledger, newest first.
 *
 * ## Finding P1-27-INT-089
 *
 * `sal.delivery_status_history` is written on every transition — `ready`,
 * `receiver_verified`, `signed`, `delivered`, `exception` — and, before this route,
 * was read by NOTHING anywhere in `apps/api/src`. The only method that had ever
 * touched the table was `appendStatusHistory`. So unlike the other four P1-31
 * delivery reads there was no existing query to publish, and this one's repository
 * query and row mapper are new. That is recorded rather than glossed.
 *
 * ## The ledger is the record, not a reconstruction
 *
 * The table holds SELECT and INSERT grants only — no UPDATE, no DELETE, for any
 * application role — and `shared.stamp_status_history` is a BEFORE INSERT trigger
 * that sets `actor_id` and `occurred_at` from the session context. A transition
 * cannot be back-dated or re-attributed after the fact, and `actor_id NOT NULL`
 * fails loudly rather than recording an unattributed row.
 *
 * ## No synthesised `origin` block, unlike the work-order and job ledgers
 *
 * Those two are written by AFTER UPDATE triggers, so the insert that CREATES the row
 * emits no ledger entry and their readers must publish a separate `origin.initialState`.
 * `sal.delivery_records` has **no** history trigger: every advance appends its own
 * row carrying its `from_status`, and `sal.complete_delivery` writes the `delivered`
 * row itself. The oldest entry here is therefore already the origin, and inventing an
 * `origin` block would publish a second, unsourced claim about the same fact.
 *
 * ## Paging
 *
 * Keyset, newest first, under `STATUS_HISTORY_ORDER`. The set grows by one row per
 * transition with no ceiling in the DDL, and
 * `ix_delivery_status_history_delivery (tenant, company, branch, delivery, occurred_at DESC, seq DESC)`
 * leads on exactly the predicate and ordering used. The cursor's sort value is minted
 * by `cursorTimestamp()` in SQL at microsecond precision, because the transitions of
 * one request share `now()` to the microsecond and a millisecond-truncated cursor
 * would silently SKIP them (`P1-27-INT-006`).
 *
 * ## Permission and scope
 *
 * `sal.delivery.view`, uniform across this read seam. `sel_delivery_status_history_scope`
 * carries no permission term of its own — it is a tenant/company/branch predicate — so
 * the application gate is the only one, and it is the code that gates the sibling
 * receiver and signature rows this ledger's transitions are caused by. The delivery is
 * read first, so `ERR-RES-001` is decided before any scope decision and the branch
 * target is the row's own.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ deliveryId: schemas.uuid }).strict();
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const DELIVERY_STATUS_HISTORY_OPERATION = defineOperation({
  id: 'sal.delivery-status-history',
  module: 'delivery',
  method: 'GET',
  path: '/deliveries/{deliveryId}/status-history',
  summary: 'Read the append-only status history of a delivery, newest first.',
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
    DELIVERY_STATUS_HISTORY_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(Query, rawQuery, 'query');
      return {
        body: await deliveryModule().reads.readStatusHistory(
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
