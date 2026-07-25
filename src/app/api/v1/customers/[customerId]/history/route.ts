/**
 * GET /api/v1/customers/{customerId}/history (Phase 1-16, P1-16-BE-016).
 *
 * The customer's governance history: status transitions, consent decisions,
 * block and unblock actions, and any merge. A **projection** over the four
 * append-only sources rather than a table of its own — copying them into a fifth
 * place would create something that could disagree with the evidence.
 *
 * Bounded and deterministically ordered (`occurred_at DESC, id DESC`), and the
 * ordering is fixed by the server: no client-supplied sort column reaches SQL.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { crmModule } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Query = z.object({ limit: schemas.limit.optional() }).strict();

export const CUSTOMER_HISTORY_OPERATION = defineOperation({
  id: 'crm.customer-history',
  module: 'crm',
  method: 'GET',
  path: '/customers/{customerId}/history',
  summary: 'Read the governance history of a customer.',
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
    CUSTOMER_HISTORY_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const query = parseOrFail(Query, Object.fromEntries(new URL(raw.url).searchParams), 'query');
      return {
        status: 200,
        body: {
          items: await crmModule().customerIdentity.history(
            db,
            params.customerId,
            query.limit ?? 50
          ),
        },
      };
    },
    { params }
  );
}
