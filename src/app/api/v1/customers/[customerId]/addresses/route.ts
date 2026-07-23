/**
 * POST /api/v1/customers/{customerId}/addresses (Phase 1-16, P1-16-BE-005).
 *
 * Adds an address to a customer. `countryCode` is validated for *format* only —
 * no country reference table exists while that decision is formally open, so
 * the route refuses a malformed code without pretending to know the real list.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { crmModule, ADDRESS_TYPES, MAX_ADDRESS_LINE } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const line = z.string().min(1).max(MAX_ADDRESS_LINE).nullable().optional();
const Body = z
  .object({
    addressType: z.enum(ADDRESS_TYPES),
    line1: z.string().min(1).max(MAX_ADDRESS_LINE),
    line2: line,
    city: line,
    region: line,
    postalCode: z.string().min(1).max(20).nullable().optional(),
    countryCode: z.string().min(2).max(2).nullable().optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const ADDRESS_ADD_OPERATION = defineOperation({
  id: 'crm.address-add',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/addresses',
  summary: 'Add an address to a customer.',
  permissions: ['crm.customer.profile.write'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.address_added',
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
    ADDRESS_ADD_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await crmModule().customerProfile.addAddress(
        db,
        params.customerId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
