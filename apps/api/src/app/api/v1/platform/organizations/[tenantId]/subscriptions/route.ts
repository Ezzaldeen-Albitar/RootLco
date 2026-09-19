/**
 * POST /api/v1/platform/organizations/{tenantId}/subscriptions (P1-32-PRE-023).
 *
 * Assigns, renews, upgrades or downgrades an organisation's subscription.
 *
 * The four are the same two database rows — the live assignment closed the day
 * before, a new one opened — and four different acts to an operator. The act is
 * named in the request because the system cannot infer it: whether a plan is an
 * upgrade is a commercial judgement about two entitlement documents, and reading
 * it off a price comparison would be wrong the first time a cheaper plan carried
 * more capacity. What the system DOES check is what it can know: an upgrade or
 * downgrade onto the plan already in force is refused, and so is a renewal onto a
 * different one (`409 ERR-TRN-001`).
 *
 * `termMonths` defaults to the plan's own term; 24 or 36 is a multi-year
 * contract. The new period's end is computed in SQL (`+ make_interval`), never
 * by hand-rolled month arithmetic.
 *
 * ## The capacity gate (P1-32-PRE-151)
 *
 * A plan whose ceilings sit BELOW what the organisation already holds is refused
 * with `ERR-CAP-003`, naming every kind, what is in use and what the new plan
 * would permit. The numbers come from `org.plan_capacity_shortfall`, which
 * counts with the same function the creation triggers count with, so the
 * refusal and tomorrow's refusals agree. `acceptOverCapacity` with a reason
 * proceeds anyway: nothing is deleted, the organisation keeps what it has, and
 * the triggers go on refusing anything new until usage is back inside the
 * ceiling.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { ASSIGNMENT_KINDS, platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ tenantId: schemas.uuid }).strict();

export const SubscriptionAssignBody = z
  .object({
    planCode: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    termMonths: z.number().int().min(1).max(120).optional(),
    kind: z.enum(ASSIGNMENT_KINDS),
    reason: z.string().trim().min(1).max(500),
    acceptOverCapacity: z.boolean().optional(),
    overCapacityReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine(
    (value) => (value.acceptOverCapacity === true) === (value.overCapacityReason !== undefined),
    {
      message: 'accepting over-capacity needs a reason, and the reason needs the flag',
    }
  );

export const SUBSCRIPTION_ASSIGN_OPERATION = defineOperation({
  id: 'platform.subscription-assign',
  successStatus: 201,
  module: 'platform',
  method: 'POST',
  path: '/platform/organizations/{tenantId}/subscriptions',
  summary: "Assign, renew, upgrade or downgrade an organization's subscription.",
  permissions: ['platform.subscription.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.tenant_subscription.changed',
  idempotent: true,
  answersNotFound: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ tenantId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    SUBSCRIPTION_ASSIGN_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = parseOrFail(SubscriptionAssignBody, body, 'body');
      const changed = await platformModule().subscriptions.assign(db, {
        tenantId: params.tenantId,
        planCode: input.planCode,
        effectiveFrom: input.effectiveFrom,
        termMonths: input.termMonths,
        kind: input.kind,
        reason: input.reason,
        ...(input.acceptOverCapacity === undefined
          ? {}
          : { acceptOverCapacity: input.acceptOverCapacity }),
        ...(input.overCapacityReason === undefined
          ? {}
          : { overCapacityReason: input.overCapacityReason }),
      });
      return { status: 201, body: changed };
    },
    { params: raw, body }
  );
}
