/**
 * GET /api/v1/price-lists/{priceListId} (Phase 1-30 A2, seam S-13).
 *
 * One price list with its version history.
 *
 * ## What could not be seen before this
 *
 * `svc.price-list-list` shows that a list exists. `svc.price-list-version-create`
 * adds a version to it. `svc.price-rule-record` puts prices on that version.
 * Nothing could read back which versions a list HAS - `findPriceListVersion` takes
 * an id a caller has no way to obtain - so the product could create a pricing
 * history and never display it, and `svc.resolve_price` chose among versions the
 * operator could not enumerate.
 *
 * ## Tenant scope, and why a branch declaration would be wrong
 *
 * `svc.price_lists` has no `company_id` and no `branch_id`. The path names no
 * branch either, so a `scope: 'branch'` declaration would have no target;
 * `requiresScopedEvaluation` returns false on an empty one whatever is declared
 * (P1-18-A-01), which makes the declaration inert rather than protective. Every
 * other operation on this table is `tenant` for the same reason.
 *
 * ## Money
 *
 * The list's `currency` is published; no amount is. Prices live on the rules, at
 * `GET /price-lists/{priceListId}/versions/{versionId}/rules`, and they cross as
 * `numeric(18,4)` decimal strings labelled with this currency.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { pricingModule } from '@/modules/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ priceListId: schemas.uuid });

/**
 * How many versions the detail carries.
 *
 * A bound, not a page. A price list gains a version when a tenant republishes its
 * prices - a handful a year - so the history has a practical ceiling and a cursor
 * over it would be ceremony. `versionsTruncated` reports the bound being reached,
 * because a short list that does not admit it is worse than a long one.
 */
const VERSION_LIMIT = 100;

export const PRICE_LIST_DETAIL_OPERATION = defineOperation({
  id: 'svc.price-list-detail',
  module: 'pricing',
  method: 'GET',
  path: '/price-lists/{priceListId}',
  summary: 'Read one price list with its version history.',
  permissions: ['svc.price.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ priceListId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    PRICE_LIST_DETAIL_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const detail = await pricingModule().priceLists.detail(db, params.priceListId, VERSION_LIMIT);
      // The ETag carries the list's `record_version`, which
      // `POST /price-lists/{id}/versions` requires back in `If-Match`.
      return { body: detail, recordVersion: detail.recordVersion };
    },
    { params: raw }
  );
}
