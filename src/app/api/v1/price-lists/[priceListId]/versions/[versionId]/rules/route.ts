/**
 * POST /api/v1/price-lists/{priceListId}/versions/{versionId}/rules
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ priceListId: schemas.uuid, versionId: schemas.uuid });

const Body = z
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

export const PRICE_RULE_RECORD_OPERATION = defineOperation({
  id: 'svc.price-rule-record',
  module: 'pricing',
  method: 'POST',
  path: '/price-lists/{priceListId}/versions/{versionId}/rules',
  summary: 'Record a price rule on a draft price-list version.',
  permissions: ['svc.price.manage'],
  scope: 'tenant',
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
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
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
