/**
 * GET/PUT /api/v1/customers/{customerId}/preferences (Phase 1-16, P1-16-BE-006;
 * GET added by the P1-16 remediation for `P1-27-INT-001`).
 *
 * GET returns every preference the customer has, as a keyset page, each row
 * carrying its `recordVersion`. That version is what a client puts in `If-Match`
 * on the PUT below, and before this read existed there was no operation that
 * published it — so every preference write was a last-writer-wins race with no
 * way for a client to detect the conflict.
 *
 * It also publishes `quietHoursNote`, which the column carries and this PUT
 * cannot set (`P1-16-A-01`).
 *
 * PUT sets one communication preference. `PUT`, not `POST`, because
 * `(customer, channel, purpose)` is the preference's identity — sending the
 * same body twice must leave one row saying the same thing, not two rows
 * disagreeing about how the customer wants to be contacted.
 *
 * A preference is **not** consent. This route can never grant permission to
 * contact anyone; it records how the customer would prefer to be reached *if*
 * consent allows it.
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
import { crmModule, CONTACT_CHANNELS, COMMUNICATION_PURPOSES } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();
export const Body = z
  .object({
    channel: z.enum(CONTACT_CHANNELS),
    purpose: z.enum(COMMUNICATION_PURPOSES),
    preferred: z.boolean(),
    preferredLocale: z.string().min(2).max(10).nullable().optional(),
  })
  .strict();

export const PREFERENCE_LIST_OPERATION = defineOperation({
  id: 'crm.preference-list',
  module: 'crm',
  method: 'GET',
  path: '/customers/{customerId}/preferences',
  summary: 'List a customer’s communication preferences.',
  permissions: ['crm.customer.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const PREFERENCE_SET_OPERATION = defineOperation({
  id: 'crm.preference-set',
  module: 'crm',
  method: 'PUT',
  path: '/customers/{customerId}/preferences',
  summary: 'Set a customer communication preference for one channel and purpose.',
  permissions: ['crm.customer.profile.write'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.preference_changed',
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
    PREFERENCE_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await crmModule().customerRead.listPreferences(
        db,
        params.customerId,
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    }),
    { params }
  );
}

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
    PREFERENCE_SET_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      return {
        status: 200,
        body: await crmModule().customerProfile.setPreference(db, params.customerId, {
          channel: input.channel,
          purpose: input.purpose,
          preferred: input.preferred,
          preferredLocale: input.preferredLocale ?? null,
        }),
      };
    },
    { params, body }
  );
}
