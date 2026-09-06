/**
 * GET /api/v1/quotation-revisions/{revisionId} (Phase 1-30 A2, seam S-08).
 *
 * One quotation revision with its priced lines — current, superseded, rejected
 * or expired.
 *
 * ## Why this is a top-level resource
 *
 * `quotation-revisions` is already a top-level collection in this API:
 * `POST /quotation-revisions/{revisionId}/decisions` records the per-item
 * approval against exactly this addressing. A revision has a stable identity of
 * its own, and nesting the read under `/quotations/{id}/revisions/{revisionId}`
 * would give the same row two addresses — one for reading it and another for
 * deciding on it.
 *
 * ## What was missing
 *
 * Not the query. `findRevision` and `listItems` both existed and both are used
 * here unchanged. What no caller could reach is a revision that is NOT the
 * quotation's current one: `quo.quotation-detail` publishes
 * `current_revision_id` and nothing else. Since an issued revision is frozen —
 * `quo.guard_quotation_item` refuses any item write once it leaves `draft` — the
 * superseded rows are the tenant's only record of what a customer was actually
 * shown, and they were unreadable.
 *
 * ## Money
 *
 * Every amount on the revision and on each line is `numeric(18,4)` and crosses
 * as a decimal STRING. `ck_quotation_revisions_totals` holds
 * `grand = subtotal - discount + tax` in the database, and
 * `ck_quotation_items_tax_amount` holds the per-line arithmetic; nothing here
 * recomputes either. A JSON number would let a client re-derive those identities
 * in IEEE-754 and disagree with the row it was sent.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { quotationModule } from '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ revisionId: schemas.uuid });

export const QUOTATION_REVISION_DETAIL_OPERATION = defineOperation({
  id: 'quo.quotation-revision-detail',
  module: 'quotation',
  method: 'GET',
  path: '/quotation-revisions/{revisionId}',
  summary: 'Read one quotation revision with its priced lines.',
  permissions: ['quo.quotation.read'],
  // The path names no branch, so the scope is re-decided against the revision
  // row's own company and branch once it is read. Without that the declared
  // `scope: 'branch'` is inert — `requiresScopedEvaluation` returns false on an
  // empty target whatever the declaration says (P1-18-A-01).
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ revisionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    QUOTATION_REVISION_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const revision = await quotationModule().quotations.revisionDetail(
        db,
        params.revisionId,
        authorizeScope
      );
      // The ETag carries the revision's `record_version`, which
      // `POST /quotations/{id}/issue` requires back in `If-Match`.
      return { body: revision, recordVersion: revision.recordVersion };
    },
    { params: raw }
  );
}
