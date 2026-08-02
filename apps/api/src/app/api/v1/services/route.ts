/**
 * /api/v1/services — the service catalog (Phase 1-20, P1-20-BE-001…003).
 *
 * `GET` lists it; `POST` creates a service.
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
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import {
  EXTERNAL_CODE,
  MAX_DESCRIPTION,
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
          { cursor: query.cursor, limit: query.limit },
          authorizeScope
        ),
      };
    }
  );
}

/**
 * Create body — a closed allow-list, and `.strict()` is load-bearing twice.
 *
 * It refuses `lifecycleStatus`, so a caller cannot believe it created a service
 * already archived: `ck_services_archived_at` ties `archived` to a non-null
 * `archived_at` that only `svc.guard_service_lifecycle` sets, and a service is
 * created `active` with no parameter offering anything else.
 *
 * It also refuses `id`, so the tenant cannot choose a primary key — `gen_random_uuid()`
 * does — and refuses every price-shaped field, because a service carries no price at
 * all: `svc.price_rules` does, under `svc.price.manage`, in a different module.
 */
const CreateBody = z
  .object({
    serviceCategoryId: schemas.uuid,
    // `ck_services_code_format` — mixed case is permitted for this external-facing
    // code, unlike the lower-snake category code.
    serviceCode: z.string().regex(EXTERNAL_CODE, 'must be an external service code'),
    name: z.string().min(1).max(MAX_NAME),
    description: z.string().min(1).max(MAX_DESCRIPTION).optional(),
  })
  .strict();

export const SERVICE_CREATE_OPERATION = defineOperation({
  id: 'svc.service-create',
  module: 'service-catalog',
  method: 'POST',
  path: '/services',
  summary: 'Create a service in the tenant catalog under an existing category.',
  permissions: ['svc.service.manage'],
  // `tenant`, because `svc.services` HAS no company_id and no branch_id: a service is
  // tenant-wide reference data and creating one is a tenant-wide act. The handler does
  // not stop at the declaration — see the tenant-wide check below.
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'svc.service.updated',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    SERVICE_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      /**
       * Creating a service is a TENANT-WIDE act, so it needs tenant-wide authority.
       *
       * There is no scope target to authorize — the row has no company and no branch —
       * and `requiresScopedEvaluation` returns false on an empty target *whatever* the
       * declared scope, so the pre-handler check degrades to the scope-blind
       * `iam.has_permission` (P1-18-A-01). Without this, an actor granted
       * `svc.service.manage` in one branch could add a service to the catalog of every
       * branch in the tenant — and `service_code` is immutable afterwards, so the code
       * it consumes is consumed for good.
       *
       * The same control `svc.price-list-version-publish` and the wildcard branch of
       * `svc.price-rule-record` use, for the same reason.
       */
      if (!(await callerHoldsPermissionTenantWide(db, 'svc.service.manage'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A service is tenant-wide catalog reference data, so creating one requires ' +
            'svc.service.manage granted tenant-wide.',
        });
      }
      const created = await serviceCatalogModule().catalogWrites.create(db, {
        serviceCategoryId: parsed.serviceCategoryId,
        serviceCode: parsed.serviceCode,
        name: parsed.name,
        description: parsed.description,
      });
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
