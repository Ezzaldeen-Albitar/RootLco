/**
 * GET /api/v1/quotations/{quotationId} (Phase 1-20, P1-20-BE-007).
 *
 * The quotation with its current revision and priced lines.
 *
 * Every money field crosses as a decimal STRING — `numeric(18,4)` holds values
 * IEEE-754 cannot represent, so a JSON number would lose money for some inputs,
 * silently and unrepeatably.
 *
 * The path names no branch, so the scope is re-decided against the row's own
 * company and branch once it is read. Without that deferred check the declared
 * `scope: 'branch'` would be inert and `app.branch_ids` — the permission-blind
 * union of every active grant — would be the only narrowing (P1-18-A-01).
 *
 * The ETag carries the `record_version` an issue or revise command must send back
 * in `If-Match`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { quotationModule } from '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ quotationId: schemas.uuid });

export const QUOTATION_DETAIL_OPERATION = defineOperation({
  id: 'quo.quotation-detail',
  module: 'quotation',
  method: 'GET',
  path: '/quotations/{quotationId}',
  summary: 'Read a quotation with its current revision and priced lines.',
  permissions: ['quo.quotation.read'],
  scope: 'branch',
  auditClass: 'none',
  // 'low-risk-metadata' is the registered read policy for a single-resource
  // lookup; there is no 'standard-read' in RATE_LIMIT_POLICIES and
  // defineOperation rejects an unregistered name at module load.
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ quotationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    QUOTATION_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const detail = await quotationModule().quotations.detail(
        db,
        params.quotationId,
        authorizeScope
      );
      return { body: detail, recordVersion: detail.recordVersion };
    },
    { params: raw }
  );
}
