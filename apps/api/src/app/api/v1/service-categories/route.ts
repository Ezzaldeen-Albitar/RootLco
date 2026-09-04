/**
 * /api/v1/service-categories — the tenant service taxonomy (Phase 1-30 A1, seam S-02).
 *
 * `GET` lists it; `POST` creates a category.
 *
 * ## Why this exists at all
 *
 * `svc.service-create` refuses a `serviceCategoryId` it cannot resolve, and until
 * now nothing in the shipped product could write `svc.service_categories`: the
 * A0 preflight measured zero `INSERT INTO` for it across `apps/api`,
 * `supabase/seeds` and `supabase/migrations`. On a tenant provisioned through the
 * product the taxonomy was therefore empty and permanently so, no service could
 * be created, no service could acquire a version, and every quotation line was
 * refused. This route and its writer are the head of that chain.
 *
 * ## Why the collection is top-level and not `/services/categories`
 *
 * A category is addressed independently of any service — `svc.service-create`
 * takes a category id before a service exists — so nesting it under the resource
 * that depends on it would invert the dependency. `/price-lists` is the sibling
 * precedent for a tenant-wide `svc` collection.
 *
 * ## No price, and no money at all
 *
 * `svc.service_categories` has no `numeric` column. `sortOrder` is `integer` and
 * is rendered as a JSON number: the decimal-string rule this codebase applies to
 * money and to `standard_minutes` exists because `numeric` cannot survive
 * IEEE-754, which does not apply to an `integer`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import {
  INTERNAL_CODE,
  MAX_DESCRIPTION,
  MAX_NAME,
  serviceCatalogModule,
} from '@/modules/service-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Query surface — a closed allow-list, pagination only.
 *
 * No filters are offered. The A0 matrix asks for a category LIST and nothing
 * more, and every filter is a branch, a denial test and a coverage obligation.
 * When one is genuinely needed the `listServices` implementation is the pattern
 * to copy, including its `ESCAPE` treatment — a bound `%` is still a wildcard.
 */
const Query = z
  .object({
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const SERVICE_CATEGORY_LIST_OPERATION = defineOperation({
  id: 'svc.service-category-list',
  module: 'service-catalog',
  method: 'GET',
  path: '/service-categories',
  summary: 'List the tenant service-category taxonomy.',
  permissions: ['svc.service.read'],
  // `tenant`, for the reason `svc.service-list` states: the taxonomy has no
  // `company_id` and no `branch_id`, this path names no branch, and a branch
  // declaration would make the operation fail closed on the empty target for
  // every caller including an unrestricted one (P1-18-A-01).
  //
  // The alternative is deliberately NOT spelled as a key/value pair here.
  // `check-operation-test-coverage.mjs` reads this literal with a regex that
  // does not strip comments and takes the FIRST match, so naming it that way
  // made the gate measure this operation as branch-scoped and demand isolation
  // evidence it does not owe. Recorded as a finding; see the A1 pull request.
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(SERVICE_CATEGORY_LIST_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
    return {
      body: await serviceCatalogModule().services.listCategories(db, {
        cursor: query.cursor,
        limit: query.limit,
      }),
    };
  });
}

/**
 * Create body — a closed allow-list.
 *
 * It refuses `id`, so the tenant cannot choose a primary key, and refuses
 * `status`, so a caller cannot create a category that is already `inactive` —
 * one that nothing may be filed under, which `svc.service-create` would then
 * reject with `inactive_category`. The column defaults to `active`.
 *
 * `code` is the LOWER-SNAKE internal code (`ck_service_categories_code_format`),
 * unlike the mixed-case external `service_code`. It is immutable once written
 * (`tg_service_categories_immutable`), so a wrong one is not repairable by edit.
 */
export const CreateBody = z
  .object({
    code: z.string().regex(INTERNAL_CODE, 'must be a lower-snake internal code'),
    name: z.string().min(1).max(MAX_NAME),
    description: z.string().min(1).max(MAX_DESCRIPTION).optional(),
    parentCategoryId: schemas.uuid.optional(),
    // Bounded to what `integer` holds, so an out-of-range value is a 422 naming
    // the field rather than a numeric overflow surfacing as a server fault.
    sortOrder: z.number().int().min(-2147483648).max(2147483647).optional(),
  })
  .strict();

export const SERVICE_CATEGORY_CREATE_OPERATION = defineOperation({
  id: 'svc.service-category-create',
  successStatus: 201,
  module: 'service-catalog',
  method: 'POST',
  path: '/service-categories',
  summary: 'Create a service category in the tenant taxonomy.',
  // `svc.service.manage`, not a catalogue-specific code. `apt`, `rec` and `dia`
  // each use a dedicated `*.catalogue.manage`, but there is NO
  // `svc.catalogue.manage` in the 118-code catalogue and A1 does not mint
  // permissions the A0 least-privilege review did not approve.
  permissions: ['svc.service.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'svc.service_category.updated',
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
    SERVICE_CATEGORY_CREATE_OPERATION,
    request,
    async ({ db }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      /**
       * Creating a category is a TENANT-WIDE act, so it needs tenant-wide authority —
       * the same control `svc.service-create` applies, for the same reason. The row
       * has no company and no branch, so there is no scope target to authorize and
       * the pre-handler check degrades to the scope-blind `iam.has_permission`
       * whatever scope is declared (P1-18-A-01). Without this, an actor granted
       * `svc.service.manage` in one branch could add a category to the taxonomy of
       * every branch in the tenant — and `code` is immutable afterwards, so the code
       * it consumes is consumed for good.
       */
      if (!(await callerHoldsPermissionTenantWide(db, 'svc.service.manage'))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A service category is tenant-wide catalog reference data, so creating one ' +
            'requires svc.service.manage granted tenant-wide.',
        });
      }
      const created = await serviceCatalogModule().catalogWrites.createCategory(db, {
        code: parsed.code,
        name: parsed.name,
        description: parsed.description,
        parentCategoryId: parsed.parentCategoryId,
        sortOrder: parsed.sortOrder,
      });
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
