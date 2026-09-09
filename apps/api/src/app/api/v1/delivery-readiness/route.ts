/**
 * GET /api/v1/delivery-readiness — the branch's ready-for-delivery queue
 * (Phase 1-31, Owner decision **D-3** of 2026-09-09).
 *
 * ## Why this is not `GET /api/v1/deliveries`
 *
 * That route lists delivery RECORDS. This one lists WORK ORDERS that satisfy the
 * server's delivery-eligibility rules — including the ones with no delivery record
 * yet, which is the population the record list cannot contain by construction and
 * which is exactly what a service advisor needs to see. The two answer different
 * questions and both remain published; neither replaces the other.
 *
 * ## A top-level resource, not a segment under `/deliveries`
 *
 * `/deliveries/readiness` would be a static sibling of the dynamic `{deliveryId}`
 * segment, and the platform avoids that shape — a caller who sent `readiness` as an
 * id would be answered by a different route than the one they addressed.
 * `/damaged-stock` and `/customer-duplicates` are the precedent for a derived
 * question published as its own resource, and this follows them.
 *
 * ## The permission declaration, and why nothing was broadened or dropped
 *
 * `sal.delivery.view`, `wo.work_order.read` and `sal.finance.view`, all three
 * required.
 *
 * The decisive one is `sal.finance.view`, and the reason is stated at length by
 * `/deliveries/{deliveryId}/eligibility`, which declares it for the same composition:
 * the financial blocker is composed from `sal.invoice_open_receivable`, whose amount
 * rows live behind that permission, so a caller without it would be waved through by
 * an RLS-INVISIBLE ZERO. That route's docblock says in terms that the permission is
 * REQUIRED and that failing closed is an addition to it rather than a substitute for
 * it — "Not belt-and-braces". This queue computes the very same fact through the very
 * same reader, so it declares the very same code. Dropping it here would put the
 * weaker of two spellings of one rule on the surface an operator actually works from.
 *
 * `sal.delivery.view` is the module's read code and gates the delivery record each
 * row carries. `wo.work_order.read` is added because every row is a work order and
 * the candidate page is the work-order board's own query: publishing a branch's work
 * orders behind a delivery code alone would be a second, quieter way to read that
 * board. Requiring it is a NARROWING relative to either code on its own, and no
 * permission is minted, no seed changes, and no catalogue row moves.
 *
 * ## What is deliberately absent
 *
 * There is no `ready` filter, and there is no eligibility input of any kind. A caller
 * cannot ask the server to show only the rows the server would call ready, because a
 * client that could express that could also express its opposite, and the verdict
 * would start to look like something a request can influence. Every candidate is
 * returned with its facts and its verdict, and the client renders what it was told.
 *
 * `.strict()` so an unknown parameter is `ERR-VAL-001` rather than a filter silently
 * dropped — a caller who mistyped one and was shown the whole branch would read the
 * result as filtered.
 *
 * ## Page size
 *
 * `limit` is capped at `MAX_READINESS_PAGE_SIZE` HERE, at the boundary, and defaults
 * to `DEFAULT_READINESS_PAGE_SIZE` in the service. Both numbers come from the module
 * so the schema and the service cannot disagree. The platform's `schemas.limit`
 * allows 100 and `resolveLimit` clamps rather than refuses; neither is right for a
 * page that costs about five round trips per row, so this route refuses above the
 * ceiling and says so instead of quietly returning fewer rows than were asked for.
 *
 * ## No money crosses this route
 *
 * The financial fact is published as a BLOCKER CODE and a provenance string. No
 * amount, no balance and no currency appears in the response — the queue reports
 * whether money is owed, never how much, so nothing on this path can turn a
 * `numeric` into a float.
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
import { MAX_READINESS_PAGE_SIZE, deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    cursor: schemas.cursor.optional(),
    limit: z.coerce.number().int().min(1).max(MAX_READINESS_PAGE_SIZE).optional(),
  })
  .strict();

export const DELIVERY_READINESS_LIST_OPERATION = defineOperation({
  id: 'sal.delivery-readiness-list',
  module: 'delivery',
  method: 'GET',
  path: '/delivery-readiness',
  summary: "List a branch's work orders that are ready to be handed over.",
  permissions: ['sal.delivery.view', 'wo.work_order.read', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    DELIVERY_READINESS_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await deliveryModule().readiness.listReadiness(
          db,
          { companyId: query.companyId, branchId: query.branchId },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    // The pre-handler scope check must not be scope-blind and it runs before the
    // schema, so the pair is read out of not-yet-validated input by the platform
    // helper: it yields NO target unless both are well-formed UUIDs, so it can only
    // ever make authorization stricter and a malformed pair falls through to the
    // schema refusal above.
    scopeTargetOption(raw)
  );
}
