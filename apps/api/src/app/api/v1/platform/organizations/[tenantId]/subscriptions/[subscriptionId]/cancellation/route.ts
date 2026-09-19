/**
 * POST /api/v1/platform/organizations/{tenantId}/subscriptions/{subscriptionId}/cancellation
 * (P1-32-PRE-023).
 *
 * Cancels one subscription assignment at a date, with a reason.
 *
 * The row keeps its period and gains `cancelled`, so what the organisation held
 * for the days it held it stays readable. Only an `active` assignment can be
 * cancelled; any other answers `409 ERR-TRN-001` rather than a success over a row
 * that did not change.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ tenantId: schemas.uuid, subscriptionId: schemas.uuid }).strict();

export const SubscriptionCancelBody = z
  .object({
    effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const SUBSCRIPTION_CANCEL_OPERATION = defineOperation({
  id: 'platform.subscription-cancel',
  module: 'platform',
  method: 'POST',
  path: '/platform/organizations/{tenantId}/subscriptions/{subscriptionId}/cancellation',
  summary: "Cancel an organization's subscription at a date, with a reason.",
  permissions: ['platform.subscription.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.tenant_subscription.changed',
  idempotent: true,
  answersNotFound: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ tenantId: string; subscriptionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    SUBSCRIPTION_CANCEL_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = parseOrFail(SubscriptionCancelBody, body, 'body');
      const cancelled = await platformModule().subscriptions.cancel(db, {
        tenantId: params.tenantId,
        subscriptionId: params.subscriptionId,
        effectiveTo: input.effectiveTo,
        reason: input.reason,
      });
      return { body: cancelled };
    },
    { params: raw, body }
  );
}
