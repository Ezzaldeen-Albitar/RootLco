/**
 * /api/v1/refund-requests — list a branch's refund requests (ADR-023 D2, part 2,
 * P1-32-PRE-OD-FD2B).
 *
 * Every request to pay back a refund obligation, newest first: waiting for a
 * decision, approved and waiting for its payout, paid out, rejected or withdrawn.
 * This is how a finance user finds what to decide and what to pay out.
 *
 * ## Branch-scoped, like the obligation list and for the same reason
 *
 * `companyId` and `branchId` are required, re-authorized against the caller's
 * grants before a row is fetched, and RLS narrows again underneath. Filters: the
 * customer paid (`partnerId`), the invoice, the obligation, and the state —
 * `pending`, `approved` (not yet paid out), `executed` (paid out), `rejected` or
 * `withdrawn`.
 *
 * ## Why `sal.finance.view` is declared
 *
 * `sel_refund_requests_gated` gates the WHOLE row by `sal.finance.view`, so a
 * caller without it would see an empty page — indistinguishable from "nothing was
 * asked". Declaring it refuses such a caller instead. No new code: who may READ the
 * requests is who may read the money already.
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
import { REFUND_REQUEST_STATES, billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `.strict()` so a mistyped filter is refused rather than ignored. */
const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    partnerId: schemas.uuid.optional(),
    invoiceId: schemas.uuid.optional(),
    obligationId: schemas.uuid.optional(),
    state: z.enum(REFUND_REQUEST_STATES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const REFUND_REQUEST_LIST_OPERATION = defineOperation({
  id: 'sal.refund-request-list',
  module: 'billing',
  method: 'GET',
  path: '/refund-requests',
  summary: "List a branch's refund requests — asked, decided and paid out — newest first.",
  permissions: ['sal.finance.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  queryParameterSchema: z.toJSONSchema(ListQuery),
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    REFUND_REQUEST_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await billingModule().refunds.listRefundRequests(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.partnerId === undefined ? {} : { partnerId: query.partnerId }),
            ...(query.invoiceId === undefined ? {} : { invoiceId: query.invoiceId }),
            ...(query.obligationId === undefined ? {} : { obligationId: query.obligationId }),
            ...(query.state === undefined ? {} : { state: query.state }),
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
