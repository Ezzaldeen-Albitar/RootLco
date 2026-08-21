/**
 * GET /api/v1/customers/{customerId}/timeline (Phase 1-16, P1-16-BE-017).
 *
 * A keyset page of `crm.timeline_events`, newest first. The events are written
 * by database triggers as things happen to the customer, so the timeline is a
 * read of what the platform already recorded — this route adds no interpretation
 * of its own.
 *
 * Ordering is `(occurred_at DESC, id DESC)`. The id tie-break is what makes
 * pagination stable when several events share a timestamp, which they routinely
 * do: a single transaction can emit two timeline rows with identical
 * `occurred_at`, and without the tie-break a page boundary landing between them
 * would skip or repeat one.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { crmModule } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Query = z
  .object({ cursor: z.string().min(1).max(500).optional(), limit: schemas.limit.optional() })
  .strict();

export const CUSTOMER_TIMELINE_OPERATION = defineOperation({
  id: 'crm.customer-timeline',
  module: 'crm',
  method: 'GET',
  path: '/customers/{customerId}/timeline',
  summary: 'Read the customer timeline, newest first.',
  permissions: ['crm.customer.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    CUSTOMER_TIMELINE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const query = parseOrFail(Query, Object.fromEntries(new URL(raw.url).searchParams), 'query');
      return {
        status: 200,
        body: await crmModule().customerIdentity.timeline(db, params.customerId, query),
      };
    },
    { params }
  );
}
