/**
 * POST /api/v1/discount-approvals/{approvalId}/withdrawal — the requester withdraws
 * their own pending discount request (ADR-023, D3; P1-32-PRE-OD-FD8).
 *
 * Until this operation a pending discount request could only be approved or turned
 * down by somebody else, or replaced by revising the quotation. The person who asked
 * for it may now withdraw it. Withdrawal only reduces exposure — a pending request
 * grants nothing and a withdrawn one never will — so it asks no second person. A
 * withdrawn request is terminal: it is never approved, rejected or superseded, and
 * its revision cannot be issued; revising the quotation asks again or drops the
 * discount.
 *
 * ## The requester, and nobody else
 *
 * The declared permission is `quo.quotation.manage` — the code that wrote the
 * revision and its request — authorized in the request's own company and branch once
 * the row is read (the path names no branch, P1-18-A-01). Holding it is not enough:
 * only the person who asked may withdraw (`discount_withdraw_not_requester`), and the
 * database refuses anyone else again (`quo.guard_discount_approval`). A superseded or
 * decided request is refused by name (`discount_approval_superseded`,
 * `discount_approval_already_decided`). Each refusal by rule is recorded once after
 * the command rolls back (D12).
 *
 * ## Version-guarded and idempotent
 *
 * `If-Match` carries the REQUEST's `recordVersion`, compared with the locked row: a
 * request that changed since it was read is a 409 the screen answers by reading it
 * again. A request already withdrawn by its requester answers `replayed: true` with
 * no second audit record.
 *
 * No body: the requester is the session and the request names everything else.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { AppFailure } from '@/server/errors/app-failure';
import { parseOrFail, schemas } from '@/server/http/validation';
import { quotationModule } from '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ approvalId: schemas.uuid }).strict();

export const DISCOUNT_APPROVAL_WITHDRAW_OPERATION = defineOperation({
  id: 'quo.discount-approval-withdraw',
  module: 'quotation',
  method: 'POST',
  path: '/discount-approvals/{approvalId}/withdrawal',
  summary: 'Withdraw your own pending discount request; it will never be approved.',
  permissions: ['quo.quotation.manage'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'quo.discount_approval.withdrawn',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ approvalId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    DISCOUNT_APPROVAL_WITHDRAW_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const { approvalId } = parseOrFail(Params, raw, 'path');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const withdrawn = await quotationModule().discountApprovals.withdraw(
        db,
        approvalId,
        expectedVersion,
        authorizeScope
      );
      return { body: withdrawn, recordVersion: withdrawn.discountApproval.recordVersion };
    },
    { params: raw }
  );
}
