/**
 * POST /api/v1/discount-approvals/{approvalId}/decision — approve or turn down a
 * discount somebody else asked for (P1-32-PRE-OD-DISC-01).
 *
 * The person who asked for the discount never decides it: the requester is recorded
 * by the server when the revision is created, and this operation refuses them with
 * `discount_approver_must_differ` — as does `ck_discount_approvals_separation`
 * whatever reaches the database. There is no sole-administrator exception and no
 * setting that turns the rule off.
 *
 * To APPROVE, the approver also needs the permission the policy version names and a
 * discount approval limit — never one they set for themselves — that covers the
 * whole discount: `discount_no_approval_limit` and `discount_over_approval_limit`
 * say which of the two is missing. To TURN DOWN, a reason is required and no limit
 * is needed.
 *
 * The decision is measured against the policy version SNAPSHOTTED when the discount
 * was asked for, so a threshold raised in the meantime neither approves the request
 * nor lets its requester decide it.
 *
 * The path names no branch, so the service authorizes against the approval row's
 * own company and branch once it is read (P1-18-A-01).
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  DISCOUNT_APPROVAL_DECISIONS,
  MAX_DISCOUNT_DECISION_REASON,
  quotationModule,
} from '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ approvalId: schemas.uuid }).strict();

export const DecisionBody = z
  .object({
    decision: z.enum(DISCOUNT_APPROVAL_DECISIONS),
    /** Required to turn a request down. */
    reason: z.string().trim().min(1).max(MAX_DISCOUNT_DECISION_REASON).optional(),
  })
  .strict();

export const DISCOUNT_APPROVAL_DECIDE_OPERATION = defineOperation({
  id: 'quo.discount-approval-decide',
  module: 'quotation',
  method: 'POST',
  path: '/discount-approvals/{approvalId}/decision',
  summary: 'Approve or turn down a discount requested by someone else.',
  // The code a discount approver has always needed. The policy version may name a
  // different one; the service checks that one too, against the row's own scope.
  permissions: ['svc.price.manage'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'quo.discount_approval.approved',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function POST(
  request: Request,
  route: { params: Promise<{ approvalId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DISCOUNT_APPROVAL_DECIDE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { approvalId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(DecisionBody, body, 'body');
      const decided = await quotationModule().discountApprovals.decide(
        db,
        approvalId,
        {
          decision: parsed.decision,
          ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
        },
        authorizeScope
      );
      return { body: decided, recordVersion: decided.recordVersion };
    },
    { params: raw, body }
  );
}
