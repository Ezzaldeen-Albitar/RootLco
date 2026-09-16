/**
 * GET /api/v1/customers — bounded, privacy-safe customer search (Phase 1-16,
 * FR-CRM-001, NFR-PRV-001).
 *
 * Cursor-paginated, tenant-scoped, deterministically ordered by
 * `(created_at DESC, id DESC)`. The searchable surface is a closed allow-list —
 * a folded name fragment, an exact customer number, a phone number, one free-text
 * box that tries all three, and the party-type and lifecycle discriminators — and
 * the projection carries no sensitive identifier. Page size is clamped to the
 * platform `MAX_PAGE_SIZE`, so scraping is bounded by the same limit as every
 * other list.
 *
 * The projected primary phone is masked to its last four digits unless the caller
 * additionally holds `iam.sensitive.view`. That is a projection rule, not an
 * access rule: a caller without it still receives the page, which is why
 * `iam.sensitive.view` is NOT declared in `permissions` below — declaring it
 * there would refuse the whole search to the receptionist it was widened for.
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
  MAX_PHONE_FRAGMENT,
  MIN_SEARCH_FRAGMENT,
  crmModule,
} from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
    /**
     * Folded, then matched as a CONTAINS over the normalised display name. The
     * work is bounded by the trigram index on that same expression and by the
     * page limit, not by the shape of the fragment. Its one-character minimum is
     * the contract this parameter already had and existing screens rely on; the
     * two-character floor applies to the new free-text box only.
     */
    name: z.string().min(1).max(MAX_NAME_FRAGMENT).optional(),
    /** Exact customer display number. */
    customerNumber: z.string().min(1).max(64).optional(),
    /**
     * Matched against the customer's phone contact points: exactly, or as a tail
     * of at least `MIN_PHONE_SUFFIX` digits. Arabic-Indic digits fold to ASCII
     * before the comparison, so either keyboard finds the same person.
     */
    phone: z.string().min(1).max(MAX_PHONE_FRAGMENT).optional(),
    /** One box: part of the name, the customer number, or a phone number. */
    q: z.string().min(MIN_SEARCH_FRAGMENT).max(MAX_NAME_FRAGMENT).optional(),
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
          phone: query.phone,
          q: query.q,
          partyType: query.partyType,
          lifecycleStatus: query.lifecycleStatus,
        },
        { cursor: query.cursor, limit: query.limit }
      ),
    };
  });
}
