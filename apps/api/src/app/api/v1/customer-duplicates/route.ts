/**
 * GET /api/v1/customer-duplicates — the duplicate-candidate review queue
 * (P1-16 remediation, `P1-27-INT-005`).
 *
 * There was no read for this at all. `customer-duplicates/{candidateId}/review`
 * accepted a decision and `customers/{customerId}/duplicate-scans` produced
 * candidates, but nothing listed them — so a review screen could only see its
 * own queue by POSTing a scan. That is a privileged write which emits an audit
 * record, so simply *opening* the queue would have written to the audit trail,
 * and re-scanning is not a read.
 *
 * ## Tenant-wide, not nested under a customer
 *
 * A candidate is a pair. Nesting the queue under one of its two members would
 * make the same row reachable by two paths and force a reviewer to already know
 * a customer before they could find out it might be a duplicate. RLS and the
 * explicit `tenant_id` predicate are what scope it.
 *
 * ## The same permission as reviewing
 *
 * `crm.customer.duplicate.review`. Seeing the queue and acting on it are one
 * authority — the seed calls it "Scan for and review duplicate customer
 * candidates" — and a reviewer who could not read the queue could not review.
 * The merge is separate and higher, and this route does not offer it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { crmModule, DUPLICATE_STATUSES } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    status: z.enum(DUPLICATE_STATUSES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const DUPLICATE_LIST_OPERATION = defineOperation({
  id: 'crm.duplicate-list',
  module: 'crm',
  method: 'GET',
  path: '/customer-duplicates',
  summary: 'List duplicate customer candidates, newest detection first.',
  permissions: ['crm.customer.duplicate.review'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(DUPLICATE_LIST_OPERATION, request, async ({ db, request: raw }) => ({
    body: await crmModule().customerIdentity.listCandidates(
      db,
      parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
    ),
  }));
}
