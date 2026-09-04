/**
 * POST /api/v1/price-list-assignments — assign a price list to a scope context
 * (Phase 1-30 A1, seam S-04).
 *
 * ## Why this exists
 *
 * `svc.resolve_price` will not return an amount until an ACTIVE assignment row
 * covers the context it is asked about, and nothing in the shipped product could
 * write `svc.price_list_assignments`. So `GET /api/v1/prices` answered
 * `ERR-VAL-001` "no price configured" for every input on every tenant created
 * through the product, and the commercial chain terminated there (A0 F-02).
 *
 * ## Why this collection is TOP-LEVEL and not `/price-lists/{id}/assignments`
 *
 * `uq_price_list_assignments_signature` is
 * `(tenant_id, company_id, branch_id, customer_class, priority) NULLS NOT DISTINCT`
 * where the row is active. `price_list_id` is deliberately absent from it —
 * unlike `uq_price_rules_signature`, which keys on the version — because the
 * table exists to guarantee "exactly one price list per context" so
 * `svc.resolve_price` never arbitrates across books.
 *
 * A nested path would therefore misdescribe what it creates: a POST under one
 * price list can be refused by an active row belonging to a DIFFERENT price
 * list, which the caller can neither see nor read, and a conflict naming the
 * path's price list would be actively misleading. The resource is addressed
 * where its invariant actually lives.
 *
 * ## No money
 *
 * An assignment names a book and a context; it carries no amount. The table has
 * no `numeric` column, and `priority` is `integer` and stays a JSON number.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { callerHoldsPermissionTenantWide, type ScopeAuthorizer } from '@/server/auth/authorization';
import { pricingModule } from '@/modules/pricing';
import { INTERNAL_CODE } from '@/modules/service-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const Body = z
  .object({
    priceListId: schemas.uuid,
    companyId: schemas.uuid.optional(),
    branchId: schemas.uuid.optional(),
    customerClass: z.string().regex(INTERNAL_CODE, 'must be a lower-snake class code').optional(),
    // `ck_price_list_assignments_priority` is `>= 0`. Bounded above so an
    // out-of-range value is a 422 naming the field rather than a numeric overflow.
    priority: z.coerce.number().int().min(0).max(1_000_000).optional(),
    effectiveFrom: z.string().regex(ISO_DATE, 'must be an ISO date (YYYY-MM-DD)'),
    effectiveTo: z.string().regex(ISO_DATE, 'must be an ISO date (YYYY-MM-DD)').optional(),
  })
  .strict()
  // `ck_price_list_assignments_range` is the backstop; refusing here names the
  // field. The range is half-open, so an equal pair is an empty interval.
  .refine((v) => v.effectiveTo === undefined || v.effectiveTo > v.effectiveFrom, {
    message: 'effectiveTo must be strictly after effectiveFrom; the range is half-open',
    path: ['effectiveTo'],
  });

export const PRICE_LIST_ASSIGNMENT_CREATE_OPERATION = defineOperation({
  id: 'svc.price-list-assignment-create',
  successStatus: 201,
  module: 'pricing',
  method: 'POST',
  path: '/price-list-assignments',
  summary: 'Assign a price list to a company, branch or customer class.',
  // `svc.price.manage`, not `svc.price.publish`. This is assignment management,
  // not publication: it changes WHICH book applies to a context, while
  // publication fixes the amounts inside a book. Both codes are risk `high`, so
  // the least-privilege rule does not arbitrate between them — but
  // `svc.price.publish` is exercised only tenant-wide and unconditionally today,
  // and this operation would be the first to grant it on a NAMED company or
  // branch, widening what that code means everywhere it is already held.
  permissions: ['svc.price.manage'],
  /**
   * `branch`, for the reason `svc.price-rule-record` states.
   *
   * The row carries `company_id` and `branch_id`, they arrive from the request
   * body with no foreign key behind them, and the assignment decides which price
   * book applies there. Declaring `tenant` would make the pre-handler check
   * scope-blind, so an actor holding `svc.price.manage` in branch A2 could point
   * branch A1 at a book of their choosing.
   */
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'svc.price_list_assignment.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

/**
 * Authorizes the selector the assignment will be stored against.
 *
 * A named company or branch is authorized concretely. A FULL WILDCARD — no
 * company, no branch, no customer class — is the tenant's default price book,
 * and this route demands the permission TENANT-WIDE for it.
 *
 * That is deliberately stronger than `svc.price-rule-record`, which leaves its
 * wildcard to the pre-handler check. A wildcard RULE competes inside one book at
 * a scored priority; a wildcard ASSIGNMENT decides which book every branch that
 * has no more specific assignment resolves against. `authorizeScope({})` cannot
 * express that: it fails closed on an empty target whatever scope is declared
 * (P1-18-A-01), so without this the wildcard case would fall through to the
 * scope-blind `iam.has_permission` and a branch-scoped grant would reach the
 * whole tenant.
 */
async function authorizeSelector(
  db: Parameters<typeof callerHoldsPermissionTenantWide>[0],
  authorizeScope: ScopeAuthorizer,
  selector: {
    companyId?: string | undefined;
    branchId?: string | undefined;
    customerClass?: string | undefined;
  }
): Promise<void> {
  if (selector.companyId !== undefined || selector.branchId !== undefined) {
    await authorizeScope({
      ...(selector.companyId === undefined ? {} : { companyId: selector.companyId }),
      ...(selector.branchId === undefined ? {} : { branchId: selector.branchId }),
    });
    return;
  }
  if (selector.customerClass !== undefined) {
    // A class-only assignment names no company and no branch, so there is no
    // concrete target to authorize — it applies across the tenant for that class.
    // Same authority as the full wildcard.
    if (!(await callerHoldsPermissionTenantWide(db, 'svc.price.manage'))) {
      throw new AppFailure('ERR-IAM-001', {
        message:
          'An assignment that names no company and no branch applies across the tenant, ' +
          'so it requires svc.price.manage granted tenant-wide.',
      });
    }
    return;
  }
  if (!(await callerHoldsPermissionTenantWide(db, 'svc.price.manage'))) {
    throw new AppFailure('ERR-IAM-001', {
      message:
        'A price-list assignment with no company, branch or customer class is the ' +
        'tenant default, so it requires svc.price.manage granted tenant-wide.',
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    PRICE_LIST_ASSIGNMENT_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(Body, body, 'body');
      await authorizeSelector(db, authorizeScope, {
        companyId: parsed.companyId,
        branchId: parsed.branchId,
        customerClass: parsed.customerClass,
      });
      const created = await pricingModule().priceLists.assign(db, {
        priceListId: parsed.priceListId,
        companyId: parsed.companyId,
        branchId: parsed.branchId,
        customerClass: parsed.customerClass,
        priority: parsed.priority,
        effectiveFrom: parsed.effectiveFrom,
        effectiveTo: parsed.effectiveTo,
      });
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
