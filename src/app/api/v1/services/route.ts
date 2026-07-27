/**
 * GET /api/v1/services — the service catalog (Phase 1-20, P1-20-BE-001…003).
 *
 * Cursor-paginated, tenant-scoped, ordered by `(service_code, id)` — a total order
 * backed by `uq_services_code`, so a page is stable even when two services share
 * a name.
 *
 * ## What this endpoint deliberately does not return
 *
 * **A price.** `ServiceView` has no amount field and no query here reads
 * `svc.price_rules`. Price resolution depends on company, branch, customer class
 * and date, is authorized by `svc.price.read`, and lives in `@/modules/pricing`.
 * Bolting a price onto the catalog read would leak commercially sensitive data to
 * every holder of `svc.service.read`.
 *
 * ## Why `availableAtBranchId` is authorized before it is used
 *
 * The filter is a scope target, not a search term. A caller may only ask "what is
 * available at branch X" for a branch their grants actually cover — otherwise the
 * difference between an empty and a non-empty page reveals whether a branch
 * exists and stocks a service. `scope: 'branch'` on this operation would be inert
 * without that (P1-18-A-01), because the path names no branch and
 * `requiresScopedEvaluation` returns false on an empty target regardless of the
 * declared scope.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { pageRequest } from '@/server/db/pagination';
import {
  MAX_NAME,
  SERVICE_LIFECYCLE_STATES,
  serviceCatalogModule,
} from '@/modules/service-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Query surface — a closed allow-list.
 *
 * `effectiveOn` is a plain date because `svc.service_versions.effective_from` is a
 * `date` and the gist EXCLUDE ranges over `daterange`. Accepting a timestamp would
 * imply a precision the column does not have.
 */
const Query = z
  .object({
    categoryId: schemas.uuid.optional(),
    lifecycleStatus: z.enum(SERVICE_LIFECYCLE_STATES).optional(),
    availableAtBranchId: schemas.uuid.optional(),
    effectiveOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)')
      .optional(),
    search: z.string().min(1).max(MAX_NAME).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const SERVICE_LIST_OPERATION = defineOperation({
  id: 'svc.service-list',
  module: 'service-catalog',
  method: 'GET',
  path: '/services',
  summary: 'List the service catalog, optionally narrowed to a branch and date.',
  permissions: ['svc.service.read'],
  // `tenant`, because the catalog IS tenant-wide reference data and an unfiltered
  // listing names no branch. That is not a weakening: when the caller DOES name
  // `availableAtBranchId`, the service re-authorizes the permission against that
  // concrete branch, which is strictly stronger than the tenant check.
  //
  // Declaring `scope: 'branch'` here would be worse than useless. `authorizeScope`
  // must then be called with a concrete target on every path, and
  // `requireScopedPermissions` fails closed on an empty one - the P1-19 hardening
  // that closed P1-18-A-01 - so an unfiltered listing would 403 for everyone,
  // including an unrestricted principal.
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    SERVICE_LIST_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => {
      const url = new URL(raw.url);
      // `search` is free text and is bound as a parameter, so `%` and `_` inside it
      // are literal to the ILIKE pattern rather than wildcards. There is nothing
      // further to sanitise and no code format to enforce on it.
      const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
      return {
        body: await serviceCatalogModule().services.list(
          db,
          {
            categoryId: query.categoryId,
            lifecycleStatus: query.lifecycleStatus,
            availableAtBranchId: query.availableAtBranchId,
            effectiveOn: query.effectiveOn,
            search: query.search,
          },
          pageRequest(
            { key: 'service_code', direction: 'asc' },
            { cursor: query.cursor, limit: query.limit }
          ),
          authorizeScope
        ),
      };
    }
  );
}
