/**
 * POST /api/v1/customers/{customerId}/alerts (Phase 1-16, P1-16-BE-009).
 *
 * Raises an operational alert that staff will see when this customer next
 * appears. Alerts are advisory — they inform the person at the counter; they do
 * not restrict what the platform will do. Restrictions do that, and they are a
 * separate operation with a separate permission and a mandatory reason.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { crmModule, ALERT_SEVERITIES, ALERT_TYPES, MAX_ALERT_MESSAGE } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Body = z
  .object({
    alertType: z.enum(ALERT_TYPES),
    severity: z.enum(ALERT_SEVERITIES),
    message: z.string().min(1).max(MAX_ALERT_MESSAGE),
  })
  .strict();

export const ALERT_RAISE_OPERATION = defineOperation({
  id: 'crm.alert-raise',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/alerts',
  summary: 'Raise an advisory alert against a customer.',
  permissions: ['crm.customer.governance.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.alert_raised',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ALERT_RAISE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await crmModule().customerGovernance.raiseAlert(
        db,
        params.customerId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
