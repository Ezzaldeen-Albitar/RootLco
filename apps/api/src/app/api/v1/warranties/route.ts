/**
 * GET /api/v1/warranties (Phase 1-31, prerequisite P-6).
 *
 * The chapter's second declared API, and the second half of finding
 * **VHM-06 / WF-26**: before this route the only way to reach a warranty was to
 * already hold its id, its idempotency key or its delivery's id, so a warranty
 * issued through the product could not be found again once the generation
 * response was gone.
 *
 * ## Not a pure publication, and the repository is why
 *
 * The governing precedent is `sal.work-order-invoice-read`, whose docblock states
 * the rule: "This publishes the existing read; it adds no query and no second
 * mapper." Half of it holds here and half does not, so both halves are stated.
 * There was no branch-wide read of `wty.warranty_records` to publish — every
 * finder in the repository is addressed by an identifier the caller must already
 * possess — so the query is NEW. The mapper is not: rows come back through
 * `toRecord`, and the published row spells every field exactly as
 * `wty.warranty-detail` spells it, so a screen sees one shape and not two.
 *
 * ## Scope
 *
 * `companyId` and `branchId` are REQUIRED and are the `authorizationTarget`.
 * `sel_warranty_records_scope` narrows on `iam.allowed_branch_ids()`, the
 * permission-blind union of every active grant, so an optional pair would mean
 * `wty.warranty.read` held in one branch reads the warranties of every branch the
 * caller has any grant in (P1-18-A-01). The scope is authorized BEFORE any row is
 * read, so a caller with no grant there is refused rather than handed an empty
 * page that would itself report whether the branch issues warranties.
 *
 * Client-asserted scope is never authoritative: the pair names a target, and
 * `authorizeScope` decides. Row-level security stays default-deny underneath and
 * narrows again on the caller's own grants.
 *
 * ## Filters
 *
 * `vehicleId` and nothing else. A0 records under P-6 that the warranty-record
 * table carries a NOT NULL vehicle reference, so the filter needs no new column;
 * `ix_warranty_records_vehicle (tenant_id, vehicle_id)` already covers it. No
 * other filter is offered because the record names none, and a query parameter
 * nobody asked for is a contract that must be kept for ever.
 *
 * `.strict()`: an unknown parameter is `ERR-VAL-001` (422), not a filter silently
 * dropped, and a malformed cursor is `ERR-PAG-001` (400). The two must stay
 * distinguishable — a caller who mistyped `vehicleId` and was shown the whole
 * branch's warranties would read them as that vehicle's.
 *
 * ## Permission
 *
 * `wty.warranty.read`, minted by prerequisite P-7 and declared here and by
 * `wty.warranty-detail`. Reading a warranty is not authority to issue one, and
 * `sel_warranty_records_scope` carries no permission term of its own — it is a
 * tenant/company/branch predicate — so this declaration is the only permission
 * gate on these rows and it has to be the right one.
 *
 * ## No money
 *
 * `wty` has 80 columns and not one is an amount, a currency or a cap in any unit
 * of account, so no response from this route carries money. `odometerAtIssue` and
 * `odometerLimit` are distance readings, published as exact decimal STRINGS and
 * never as floats.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { warrantyModule } from '@/modules/warranty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    vehicleId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const WARRANTY_LIST_OPERATION = defineOperation({
  id: 'wty.warranty-list',
  module: 'warranty',
  method: 'GET',
  path: '/warranties',
  summary: "List a branch's warranty records, newest first.",
  permissions: ['wty.warranty.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    WARRANTY_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await warrantyModule().warranties.listWarranties(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.vehicleId === undefined ? {} : { vehicleId: query.vehicleId }),
          },
          {
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          },
          authorizeScope
        ),
      };
    },
    scopeTargetOption(raw)
  );
}
