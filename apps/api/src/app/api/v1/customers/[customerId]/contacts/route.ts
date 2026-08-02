/**
 * POST /api/v1/customers/{customerId}/contacts (Phase 1-16, P1-16-BE-004).
 *
 * Adds a contact channel to a customer. The parent is the path segment; the
 * body is `.strict()` and has no `partnerId`, so a contact cannot be re-parented
 * onto a different customer by a request that supplies one.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { crmModule, CONTACT_CHANNELS, MAX_CONTACT_VALUE, MAX_LABEL } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Body = z
  .object({
    channel: z.enum(CONTACT_CHANNELS),
    value: z.string().min(1).max(MAX_CONTACT_VALUE),
    label: z.string().min(1).max(MAX_LABEL).nullable().optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const CONTACT_ADD_OPERATION = defineOperation({
  id: 'crm.contact-add',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/contacts',
  summary: 'Add a contact channel to a customer.',
  permissions: ['crm.customer.profile.write'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.contact_added',
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
    CONTACT_ADD_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await crmModule().customerProfile.addContactPoint(
        db,
        params.customerId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
