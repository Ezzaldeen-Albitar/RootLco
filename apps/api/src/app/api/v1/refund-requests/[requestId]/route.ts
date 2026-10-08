/**
 * /api/v1/refund-requests/{requestId} — read one refund request (ADR-023 D2, part 2,
 * P1-32-PRE-OD-FD2B).
 *
 * The request — its amount, method, reason and state, its decision and, once
 * recorded, its payout — with the obligation it pays back (its amount, what has been
 * paid out on it and what is still owed) and the people on it by NAME, each `null`
 * for a caller who may not read users. Its `recordVersion` is the `If-Match` every
 * decision and the payout send.
 *
 * `sal.finance.view` in the request's own company and branch, which the whole-row
 * gate of both refund tables requires anyway. Another tenant's request, and one
 * outside the caller's reach, answer 404.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { billingModule } from '@/modules/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requestId: schemas.uuid }).strict();

export const REFUND_REQUEST_DETAIL_OPERATION = defineOperation({
  id: 'sal.refund-request-detail',
  module: 'billing',
  method: 'GET',
  path: '/refund-requests/{requestId}',
  summary: 'Read one refund request: its amount, its decision, its payout and its obligation.',
  permissions: ['sal.finance.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
  answersNotFound: true,
});

export async function GET(
  request: Request,
  route: { params: Promise<{ requestId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    REFUND_REQUEST_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const detail = await billingModule().refunds.readRefundRequest(
        db,
        params.requestId,
        authorizeScope
      );
      return { body: detail, recordVersion: detail.recordVersion };
    },
    { params: raw }
  );
}
