/**
 * PUT /api/v1/customers/{customerId}/status (Phase 1-16, P1-16-BE-011).
 *
 * Moves the customer lifecycle state and appends the append-only transition
 * record. A substantive `reason` is mandatory: a customer whose status changed
 * is a person somebody may have to explain the decision to, and
 * `btrim(reason) <> ''` alone would accept a single character.
 *
 * `merged` is not offered. A merge is the outcome of the merge operation, which
 * sets the survivor redirect and the status together under its own permission —
 * it is not a status an operator assigns.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { crmModule, MAX_REASON, MIN_REASON, SETTABLE_LIFECYCLE_STATES } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
export const Body = z
  .object({
    lifecycleStatus: z.enum(SETTABLE_LIFECYCLE_STATES),
    reason: z.string().min(MIN_REASON).max(MAX_REASON),
  })
  .strict();

export const STATUS_SET_OPERATION = defineOperation({
  id: 'crm.customer-status-set',
  module: 'crm',
  method: 'PUT',
  path: '/customers/{customerId}/status',
  summary: 'Change the customer lifecycle status with a recorded reason.',
  permissions: ['crm.customer.governance.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.status_changed',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PUT(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    STATUS_SET_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 200,
      body: await crmModule().customerGovernance.changeLifecycle(
        db,
        params.customerId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
