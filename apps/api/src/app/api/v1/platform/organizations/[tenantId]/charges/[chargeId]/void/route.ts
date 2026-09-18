/**
 * POST /api/v1/platform/organizations/{tenantId}/charges/{chargeId}/void
 * (P1-32-PRE-024).
 *
 * Voids an OPEN platform subscription charge, with a reason.
 *
 * Voiding is terminal and a settled charge cannot be voided: the money arrived,
 * and erasing the obligation it settled would leave a receipt against nothing.
 * The database enforces the same graph in `org.guard_subscription_charge_status()`;
 * this operation answers `409 ERR-TRN-001` rather than surfacing the raise.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ tenantId: schemas.uuid, chargeId: schemas.uuid }).strict();

export const ChargeVoidBody = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const CHARGE_VOID_OPERATION = defineOperation({
  id: 'platform.charge-void',
  module: 'platform',
  method: 'POST',
  path: '/platform/organizations/{tenantId}/charges/{chargeId}/void',
  summary: 'Void an open platform subscription charge with a reason.',
  permissions: ['platform.billing.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.subscription_charge.voided',
  idempotent: true,
  answersNotFound: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ tenantId: string; chargeId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    CHARGE_VOID_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = parseOrFail(ChargeVoidBody, body, 'body');
      const voided = await platformModule().billing.voidCharge(db, {
        tenantId: params.tenantId,
        chargeId: params.chargeId,
        reason: input.reason,
      });
      return { body: voided };
    },
    { params: raw, body }
  );
}
