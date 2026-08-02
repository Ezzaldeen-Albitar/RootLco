/**
 * POST /api/v1/customers/{customerId}/duplicate-scans (Phase 1-16, FR-CRM-003,
 * P1-16-BE-013).
 *
 * Scores this customer against comparable ones and records the candidates.
 * Deterministic and explainable: fixed weighted comparisons over data the tenant
 * already holds, with `match_basis` recording which signals fired. No model, no
 * training set, no hidden state — the same data always produces the same score.
 *
 * A scan decides nothing. It produces candidates for a human to review.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { crmModule } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });

export const DUPLICATE_SCAN_OPERATION = defineOperation({
  id: 'crm.duplicate-scan',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/duplicate-scans',
  summary: 'Score a customer against comparable ones and record duplicate candidates.',
  permissions: ['crm.customer.duplicate.review'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.duplicates_scanned',
  idempotent: true,
  // Comparison work, not a cheap lookup — throttled like the customer search.
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    DUPLICATE_SCAN_OPERATION,
    request,
    async ({ db }) => ({
      status: 200,
      body: await crmModule().customerIdentity.scanForDuplicates(db, params.customerId),
    }),
    { params }
  );
}
