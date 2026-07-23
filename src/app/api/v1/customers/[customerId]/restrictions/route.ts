/**
 * POST /api/v1/customers/{customerId}/restrictions (Phase 1-16, P1-16-BE-012).
 *
 * Imposes a commercial or service restriction. The highest-privilege customer
 * operation in the phase, so it carries its own permission rather than sharing
 * the general governance one: raising an advisory alert and refusing to serve
 * somebody are not the same authority.
 *
 * A `no_service` restriction also blocks the customer, in the same transaction,
 * with a lifecycle transition record and a block-history entry. A restriction
 * that says "we will not serve this customer" while the customer stays `active`
 * would be a contradiction the counter staff have to resolve on the spot.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { crmModule, MAX_REASON, MIN_REASON, RESTRICTION_TYPES } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Body = z
  .object({
    restrictionType: z.enum(RESTRICTION_TYPES),
    reason: z.string().min(MIN_REASON).max(MAX_REASON),
    /** Reference to the approval that authorised this, where one was required. */
    approvalRef: z.string().min(1).max(120).nullable().optional(),
  })
  .strict();

export const RESTRICTION_IMPOSE_OPERATION = defineOperation({
  id: 'crm.restriction-impose',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/restrictions',
  summary: 'Impose a commercial or service restriction on a customer.',
  permissions: ['crm.customer.restriction.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.restriction_imposed',
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
    RESTRICTION_IMPOSE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      return {
        status: 201,
        body: await crmModule().customerGovernance.imposeRestriction(db, params.customerId, {
          restrictionType: input.restrictionType,
          reason: input.reason,
          approvalRef: input.approvalRef ?? null,
        }),
      };
    },
    { params, body }
  );
}
