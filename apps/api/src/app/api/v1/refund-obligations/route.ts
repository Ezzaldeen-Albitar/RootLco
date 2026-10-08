/**
 * /api/v1/refund-obligations — list a branch's refund obligations (ADR-023 D2,
 * P1-32-PRE-OD-FD2A).
 *
 * A refund obligation is money a customer is owed back because an approved credit
 * note exceeded what its invoice still owed. `sal.approve_credit_note` records one
 * for exactly the excess, in the approving transaction; nothing is paid out
 * automatically, and refund requests, their second approver and their execution
 * are a later change (FD2B). This read is how a finance user finds who is owed
 * what. It is an operational record, not an accounting entry.
 *
 * ## Branch-scoped, like the credit-note list and for the same reason
 *
 * `companyId` and `branchId` are required, re-authorized against the caller's
 * grants before a row is fetched, and RLS narrows again underneath. Filters:
 * the customer owed (`partnerId`), the invoice (`invoiceId`) and the state.
 *
 * ## Why `sal.finance.view` is declared
 *
 * `sel_refund_obligations_gated` gates the WHOLE row by `sal.finance.view`, so a
 * caller without it would see an empty page — indistinguishable from "nobody is
 * owed anything", the one thing this list must never say by accident. Declaring
 * it refuses such a caller instead. No new permission code: who may READ the
 * obligations is who may read the money already.
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
import { REFUND_OBLIGATION_STATES, billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `.strict()` so a mistyped filter is refused rather than ignored. */
const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    partnerId: schemas.uuid.optional(),
    invoiceId: schemas.uuid.optional(),
    state: z.enum(REFUND_OBLIGATION_STATES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const REFUND_OBLIGATION_LIST_OPERATION = defineOperation({
  id: 'sal.refund-obligation-list',
  module: 'billing',
  method: 'GET',
  path: '/refund-obligations',
  summary: "List a branch's refund obligations — what customers are owed back — newest first.",
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
    REFUND_OBLIGATION_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await billingModule().reads.listRefundObligations(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.partnerId === undefined ? {} : { partnerId: query.partnerId }),
            ...(query.invoiceId === undefined ? {} : { invoiceId: query.invoiceId }),
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
