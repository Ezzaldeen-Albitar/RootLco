/**
 * GET /api/v1/prices — resolve the one winning price (Phase 1-20, P1-20-BE-004,
 * P1-20-BE-005).
 *
 * Answers "what does this service cost at this branch, for this customer class, on
 * this date, and what tax applies" — the same question the quotation layer asks per
 * line, exposed so an operator can see the answer without creating a quotation.
 *
 * ## Why `companyId` and `branchId` are REQUIRED
 *
 * They are the operation's scope target. A price depends on them, so a caller must
 * name them — and naming them is what makes `scope: 'branch'` real rather than
 * inert. With an optional branch this endpoint would either 403 for everyone (an
 * empty target fails closed in `requireScopedPermissions`) or, worse, resolve a
 * price using the permission-blind `app.branch_ids` union and disclose one branch's
 * pricing to a caller granted only in another (P1-18-A-01).
 *
 * ## Three answers that are refusals, not defaults
 *
 * A missing price is not zero. A price rule naming a tax class with no effective
 * rate is not an untaxed line. Two rules tied on both specificity and priority are
 * a configuration conflict, not a UUID coin flip. All three come back as errors
 * with distinct messages, because each needs a different fix.
 *
 * ## `asOf` is optional and server-derived when omitted
 *
 * When supplied it is validated as a plain date, because
 * `svc.price_list_versions.effective_from` is a `date` and the gist EXCLUDE ranges
 * over `daterange`. When omitted the server's own `current_date` is used, read in
 * the same transaction, so the date and the resolution agree on one clock.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { INTERNAL_CODE } from '@/modules/service-catalog';
import { pricingModule } from '@/modules/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    serviceId: schemas.uuid,
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    customerClass: z.string().regex(INTERNAL_CODE, 'must be a lower-snake class code').optional(),
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)')
      .optional(),
  })
  .strict();

export const PRICE_RESOLVE_OPERATION = defineOperation({
  id: 'svc.price-resolve',
  module: 'pricing',
  method: 'GET',
  path: '/prices',
  summary: 'Resolve the single applicable price and tax rate for a service.',
  permissions: ['svc.price.read'],
  // A real branch scope: the query REQUIRES a branch and it is passed as the
  // authorization target, so the check is `iam.has_permission_in_scope` and not the
  // scope-blind fallback.
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    PRICE_RESOLVE_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => {
      const url = new URL(raw.url);
      const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');

      /**
       * The pair must be COHERENT before it is authorized.
       *
       * `iam.has_permission_in_scope` is disjunctive across grant-scope rows: a
       * `branch` row satisfies it on its own, and so does a `company` row. Every
       * other branch-scoped operation in this phase derives both halves from one
       * database row and therefore cannot be incoherent — this is the only route
       * where a caller supplies them independently.
       *
       * Without this check, a principal holding `svc.price.read` in branch B1 of
       * company C1 could ask for `companyId=C2&branchId=B1`: the branch scope row
       * satisfies the permission check, and `svc.resolve_price` then selects C2's
       * assignment and company-level rule and `findTaxRate` returns C2's rate —
       * disclosing another company's price, currency and tax rate to a caller with
       * no grant in it.
       */
      const coherent = await pricingModule().prices.branchBelongsToCompany(
        db,
        query.companyId,
        query.branchId
      );
      if (!coherent) {
        throw new AppFailure('ERR-VAL-001', {
          message: `Branch ${query.branchId} does not belong to company ${query.companyId}`,
          safeDetails: {
            violations: [{ path: 'query.branchId', rule: 'branch_company_mismatch' }],
          },
        });
      }

      // Authorize the named scope BEFORE resolving anything with it.
      await authorizeScope({ companyId: query.companyId, branchId: query.branchId });

      // The business date is the database's when the caller does not state one, so
      // the effective-range predicates and this date cannot diverge.
      const asOf = query.asOf ?? (await pricingModule().prices.businessDate(db));

      const resolved = await pricingModule().prices.resolve(db, {
        serviceId: query.serviceId,
        companyId: query.companyId,
        branchId: query.branchId,
        customerClass: query.customerClass ?? null,
        asOf,
      });
      return { body: { asOf, ...resolved } };
    }
  );
}
