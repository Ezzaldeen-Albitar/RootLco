/**
 * /api/v1/price-lists/{priceListId}/versions/{versionId}/rules.
 *
 * `GET` lists the rules on one version, in the resolver's own precedence order
 * (Phase 1-30 A2, seam S-13); `POST` records a rule on a draft version.
 * (Phase 1-20, P1-20-BE-004, P1-20-BE-014).
 *
 * Records one price rule on a DRAFT version.
 * `svc.guard_price_rule_parent_frozen` refuses this once the parent is published or
 * archived, which is exactly what makes a published version's prices immutable —
 * so there is no update or delete route for a rule, and none is invented here.
 *
 * ## The amount is a decimal STRING
 *
 * Not a JSON number. `svc.price_rules.amount` is `numeric(18,4)` and IEEE-754
 * cannot represent every value it holds, so a float would lose money for some
 * inputs, silently and unrepeatably. The string is parsed through the exact
 * `Decimal` before it reaches SQL and bound with a `::numeric(18,4)` cast, so the
 * stored figure is precisely what the caller sent.
 *
 * ## Specificity, not a price override
 *
 * `companyId`, `branchId` and `customerClass` are all optional and every one of
 * them is a WILDCARD when omitted — that is the schema's meaning, and
 * `svc.resolve_price` scores specificity as `branch*4 + company*2 + class*1`. A
 * rule is therefore narrowed, never "overridden": there is no override flag in the
 * catalog and none is added here.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { INTERNAL_CODE } from '@/modules/service-catalog';
import { pricingModule } from '@/modules/pricing';
import { callerHoldsPermissionTenantWide } from '@/server/auth/authorization';
import { AppFailure } from '@/server/errors/app-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ priceListId: schemas.uuid, versionId: schemas.uuid });

export const Body = z
  .object({
    serviceId: schemas.uuid,
    // A plain decimal literal only. Exponential notation is rejected by `Decimal`
    // as well; this pattern refuses it at the boundary so the error names the field.
    amount: z
      .string()
      .regex(
        /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/,
        'must be a non-negative decimal with at most 4 decimal places'
      ),
    companyId: schemas.uuid.optional(),
    branchId: schemas.uuid.optional(),
    customerClass: z.string().regex(INTERNAL_CODE, 'must be a lower-snake class code').optional(),
    taxClassId: schemas.uuid.optional(),
    priority: z.coerce.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

/**
 * How many rules one response carries.
 *
 * A bound with one row of headroom, so truncation is REPORTED rather than
 * silently produced. `svc.price_rules` has no natural ceiling - a version may
 * carry a rule per service per company/branch/customer-class combination - so a
 * caller must be able to tell a short list from a complete one.
 */
const RULE_LIMIT = 200;

/**
 * The rules on one version, in the order `svc.resolve_price` considers them.
 *
 * ## Why this needed a new read model
 *
 * `svc.price_rules` could be written (`svc.price-rule-record`) and counted
 * (`countPriceRules`, an internal guard) and read by the resolver, and by nothing
 * else. There was no rule list at any layer. So an operator could publish a price
 * list and never see what was in it, and the question a pricing screen exists to
 * answer - "why did this service resolve to that amount?" - had no data behind it.
 *
 * ## Ordering is the answer, not a presentation choice
 *
 * `svc.resolve_price` picks by `specificity DESC, priority DESC`, where
 * specificity weights branch 4, company 2 and customer class 1. The query
 * reproduces that expression and the response publishes the computed
 * `specificity`, so the order the rows arrive in and the number explaining it
 * come from the same arithmetic. Sorting alphabetically would have hidden the
 * precedence the resolver actually uses.
 *
 * ## The path is checked, not decorative
 *
 * The version must belong to the price list named in the path; a version under a
 * different list is refused exactly as a non-existent one is, so the path cannot
 * be used to probe which version ids are real.
 *
 * ## Money
 *
 * `amount` is `numeric(18,4)` and crosses as a decimal STRING, labelled with the
 * PARENT LIST's currency - `svc.price_rules` stores no currency of its own, and a
 * bare figure would be an unlabelled amount.
 */
export const PRICE_RULE_LIST_OPERATION = defineOperation({
  id: 'svc.price-rule-list',
  module: 'pricing',
  method: 'GET',
  path: '/price-lists/{priceListId}/versions/{versionId}/rules',
  summary: "List one price-list version's rules in resolution order.",
  // The read code, not the `svc.price.manage` the POST below declares.
  permissions: ['svc.price.read'],
  // `tenant`: `svc.price_lists` and `svc.price_list_versions` carry no company or
  // branch, and the path names none, so a branch declaration would have no target
  // and would be inert (P1-18-A-01). The rules themselves carry OPTIONAL
  // company/branch NARROWING columns, which say which scope a rule applies to -
  // they are not the row's own scope and are published, not filtered on.
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ priceListId: string; versionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    PRICE_RULE_LIST_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await pricingModule().priceLists.listRules(
          db,
          params.priceListId,
          params.versionId,
          RULE_LIMIT
        ),
      };
    },
    { params: raw }
  );
}

export const PRICE_RULE_RECORD_OPERATION = defineOperation({
  id: 'svc.price-rule-record',
  successStatus: 201,
  module: 'pricing',
  method: 'POST',
  path: '/price-lists/{priceListId}/versions/{versionId}/rules',
  summary: 'Record a price rule on a draft price-list version.',
  permissions: ['svc.price.manage'],
  /**
   * `branch`, not `tenant`.
   *
   * A price list has no company or branch, but a price RULE does: `company_id` and
   * `branch_id` are the selectors `svc.resolve_price` scores at
   * `branch*4 + company*2 + class*1`, so this row decides one branch's price.
   *
   * Declaring `tenant` here made the pre-handler check scope-blind, and the columns
   * arrive from the request body with no foreign key behind them — so an actor
   * holding `svc.price.manage` scoped only to branch A2 could write a
   * branch-A1-specific rule at maximum priority and set the price charged in a
   * branch they hold nothing in. The handler now authorizes the selector it is
   * given, before the row is written.
   */
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'svc.price_rule.recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ priceListId: string; versionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    PRICE_RULE_RECORD_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      /**
       * Authorize the SELECTOR before it is stored.
       *
       * A rule naming a company or branch narrows the price for that scope, so the
       * caller must hold `svc.price.manage` there. A wildcard rule (both omitted)
       * names no scope to narrow and is left to the pre-handler tenant check —
       * `authorizeScope({})` would fail closed and refuse every wildcard rule.
       *
       * The company/branch coherence check inside `recordRule` runs too, so a branch
       * that does not belong to the named company is refused rather than authorized
       * against whichever half happens to match: `iam.has_permission_in_scope` is
       * disjunctive across scope rows.
       */
      if (parsed.companyId !== undefined || parsed.branchId !== undefined) {
        await authorizeScope({
          ...(parsed.companyId === undefined ? {} : { companyId: parsed.companyId }),
          ...(parsed.branchId === undefined ? {} : { branchId: parsed.branchId }),
        });
      } else if (!(await callerHoldsPermissionTenantWide(db, 'svc.price.manage'))) {
        /**
         * A WILDCARD rule is the broadest selector there is, not the narrowest.
         *
         * With both selectors omitted, `svc.resolve_price` matches the rule for every
         * company and every branch in the tenant — `r.company_id IS NULL OR
         * r.company_id = p_company`. So the case with no scope target is the case with
         * the LARGEST blast radius, and leaving it to the pre-handler tenant check was
         * the escalation this route's scope change was supposed to close, still open
         * through the wider door: `requiresScopedEvaluation` returns false on an empty
         * target whatever the declared scope, so that check is scope-blind, and an actor
         * holding `svc.price.manage` in one branch could price every branch.
         *
         * A tenant-wide row therefore requires tenant-wide authority — an unrestricted
         * grant, which is what an all-NULL target means to
         * `iam.has_permission_in_scope`. A branch-scoped actor keeps the ability to
         * write rules for their own branch, which is what their grant says.
         */
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A price rule with no company or branch applies to the whole tenant, so it ' +
            'requires svc.price.manage granted tenant-wide. Name the company and branch ' +
            'this rule is for, or ask for an unrestricted grant.',
        });
      }
      const rule = await pricingModule().priceLists.recordRule(
        db,
        params.priceListId,
        params.versionId,
        {
          serviceId: parsed.serviceId,
          amount: parsed.amount,
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          customerClass: parsed.customerClass,
          taxClassId: parsed.taxClassId,
          priority: parsed.priority,
        }
      );
      return { status: 201, body: rule, recordVersion: rule.recordVersion };
    },
    { params: raw, body }
  );
}
