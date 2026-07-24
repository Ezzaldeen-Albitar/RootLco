/**
 * GET /api/v1/customers — bounded, privacy-safe customer search (Phase 1-16,
 * FR-CRM-001, NFR-PRV-001).
 *
 * Cursor-paginated, tenant-scoped, deterministically ordered by
 * `(created_at DESC, id DESC)`. The searchable surface is a closed allow-list —
 * a normalised name prefix, an exact customer number, and the party-type and
 * lifecycle discriminators — and the projection carries no sensitive identifier.
 * Page size is clamped to the platform `MAX_PAGE_SIZE`, so scraping is bounded by
 * the same limit as every other list.
 *
 * Everything cross-cutting (correlation, rate limit, authentication, context,
 * scoped session, authorization, problem-document errors, OpenAPI) lives in
 * `handleOperation`; the handler parses and calls one application service.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import {
  CUSTOMER_LIFECYCLE_STATUSES,
  CUSTOMER_PARTY_TYPES,
  MAX_NAME_FRAGMENT,
  crmModule,
} from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
    /** Normalised as a prefix; a leading-wildcard scan is never issued. */
    name: z.string().min(1).max(MAX_NAME_FRAGMENT).optional(),
    /** Exact customer display number. */
    customerNumber: z.string().min(1).max(64).optional(),
    partyType: z.enum(CUSTOMER_PARTY_TYPES).optional(),
    lifecycleStatus: z.enum(CUSTOMER_LIFECYCLE_STATUSES).optional(),
  })
  .strict();

export const CUSTOMER_SEARCH_OPERATION = defineOperation({
  id: 'crm.customer-search',
  module: 'crm',
  method: 'GET',
  path: '/customers',
  summary: 'Search customers in the caller tenant by an allow-listed field set.',
  permissions: ['crm.customer.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(CUSTOMER_SEARCH_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
    return {
      body: await crmModule().customerSearch.search(
        db,
        {
          name: query.name,
          customerNumber: query.customerNumber,
          partyType: query.partyType,
          lifecycleStatus: query.lifecycleStatus,
        },
        { cursor: query.cursor, limit: query.limit }
      ),
    };
  });
}
