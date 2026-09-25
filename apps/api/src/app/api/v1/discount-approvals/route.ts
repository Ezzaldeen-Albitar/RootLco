/**
 * GET /api/v1/discount-approvals — one branch's discount requests in one status
 * (P1-32-PRE-OD-DISC-01).
 *
 * A discount at or over the company threshold is recorded as a request when the
 * quotation revision is created, and it waits here for somebody OTHER than the
 * requester to decide it. Only requests on a quotation's CURRENT draft revision are
 * listed. The approvals screen reads this list for the branch the operator is
 * working in; each row says whether the signed-in person asked for it
 * (`requestedByCaller`) and whether they could approve it (`canDecide`, with
 * `cannotDecideReason` when not) — computed by the server, so no approval limit is
 * ever part of the answer.
 *
 * ## Scope
 *
 * `companyId` and `branchId` are both REQUIRED, and `scopeTargetOption` makes the
 * pair the authorization target, so the permission check runs against the branch
 * actually read — never scope-blind (P1-18-A-01). The service authorizes the same
 * pair again before reading, and `sel_discount_approvals_scope` is the third layer.
 *
 * ## Money
 *
 * `discountTotal` and `discountBase` are `numeric(18,4)` decimal STRINGS.
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
import { LISTABLE_DISCOUNT_APPROVAL_STATES, quotationModule } from '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    /**
     * Defaults to `pending` — the requests still waiting for a decision. A
     * `superseded` request belongs to a revision the quotation moved past and is
     * never listed.
     */
    status: z.enum(LISTABLE_DISCOUNT_APPROVAL_STATES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const DISCOUNT_APPROVAL_LIST_OPERATION = defineOperation({
  id: 'quo.discount-approval-list',
  module: 'quotation',
  method: 'GET',
  path: '/discount-approvals',
  summary: "List a branch's discount requests in one status, most recently asked for first.",
  // The quotation READ code: the list shows what was asked for on documents the
  // caller may read. Deciding needs the approval authority, checked on the decision.
  permissions: ['quo.quotation.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    DISCOUNT_APPROVAL_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await quotationModule().discountApprovals.list(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            status: query.status ?? 'pending',
          },
          { cursor: query.cursor, limit: query.limit },
          authorizeScope
        ),
      };
    },
    // The target comes from the RAW query, before validation: a pair that is not two
    // uuids yields no target, which can only make the check stricter (P1-18-A-01).
    scopeTargetOption(raw)
  );
}
