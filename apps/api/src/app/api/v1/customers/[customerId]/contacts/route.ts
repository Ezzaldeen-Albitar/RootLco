/**
 * GET/POST /api/v1/customers/{customerId}/contacts (Phase 1-16, P1-16-BE-004;
 * GET added by the P1-16 remediation for `P1-27-INT-001`).
 *
 * POST adds a contact channel to a customer. The parent is the path segment; the
 * body is `.strict()` and has no `partnerId`, so a contact cannot be re-parented
 * onto a different customer by a request that supplies one.
 *
 * GET returns the customer's live contact channels as a keyset page, newest
 * first, excluding soft-deleted rows. `isPrimary` is on every row — the ordering
 * is the one a cursor can guarantee, and "primaries first" is the screen's job.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
} from '@/server/http/validation';
import { crmModule, CONTACT_CHANNELS, MAX_CONTACT_VALUE, MAX_LABEL } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();
export const Body = z
  .object({
    channel: z.enum(CONTACT_CHANNELS),
    value: z.string().min(1).max(MAX_CONTACT_VALUE),
    label: z.string().min(1).max(MAX_LABEL).nullable().optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const CONTACT_LIST_OPERATION = defineOperation({
  id: 'crm.contact-list',
  module: 'crm',
  method: 'GET',
  path: '/customers/{customerId}/contacts',
  summary: 'List a customer’s contact channels.',
  permissions: ['crm.customer.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const CONTACT_ADD_OPERATION = defineOperation({
  id: 'crm.contact-add',
  successStatus: 201,
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

export async function GET(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    CONTACT_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await crmModule().customerRead.listContacts(
        db,
        params.customerId,
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    }),
    { params }
  );
}

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
