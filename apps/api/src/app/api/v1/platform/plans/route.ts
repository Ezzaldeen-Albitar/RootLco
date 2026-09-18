/**
 * GET / POST /api/v1/platform/plans (P1-32-PRE-023).
 *
 * The platform subscription-plan catalogue. Platform reference data with no
 * tenant column, administered by the Platform Owner alone.
 *
 * ## The two documents
 *
 * `capacityLimits` is published as three named, non-negative integer limits —
 * `companies`, `branches`, `users` — which are the three things the console can
 * COUNT. The database validator (`org.validate_plan_documents()`) admits any key
 * with a non-negative number; this boundary admits only the three that mean
 * something, because a limit nothing measures is a number with no effect.
 *
 * `entitlementDocument` is a map of feature-flag code to boolean. Which codes
 * exist is known only to `org.feature_flags`, and the database trigger refuses
 * an unregistered key — so this boundary bounds the SHAPE and leaves the
 * VOCABULARY to the one place that owns it.
 *
 * ## Prices
 *
 * `listPrice` is a decimal STRING, never a JSON number: IEEE-754 cannot carry
 * 0.1 exactly and this is the figure an operator will be asked to justify.
 * Prices are configured through this operation and never seeded.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, searchParamsToObject } from '@/server/http/validation';
import { PLAN_STATUSES, platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    status: z.enum(PLAN_STATUSES).optional(),
    planCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,62}$/)
      .optional(),
  })
  .strict();

/** A non-negative decimal string with at most four fractional digits. */
const PlanPrice = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,4})?$/, 'must be a non-negative decimal string');

/** `YYYY-MM-DD`. */
const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const CapacityLimits = z
  .object({
    companies: z.number().int().min(0).max(1_000_000).optional(),
    branches: z.number().int().min(0).max(1_000_000).optional(),
    users: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

const EntitlementDocument = z.record(z.string().regex(/^[a-z][a-z0-9_]{1,62}$/), z.boolean());

export const PlanCreateBody = z
  .object({
    planCode: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    displayName: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000).optional(),
    listPrice: PlanPrice.optional(),
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    termMonths: z.number().int().min(1).max(120).optional(),
    capacityLimits: CapacityLimits,
    entitlementDocument: EntitlementDocument,
    status: z.enum(PLAN_STATUSES).optional(),
    effectiveFrom: CalendarDate,
    effectiveTo: CalendarDate.optional(),
  })
  .strict();

export const PLAN_LIST_OPERATION = defineOperation({
  id: 'platform.plan-list',
  module: 'platform',
  method: 'GET',
  path: '/platform/plans',
  summary: 'List the platform subscription-plan catalogue.',
  permissions: ['platform.subscription.manage'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export const PLAN_CREATE_OPERATION = defineOperation({
  id: 'platform.plan-create',
  successStatus: 201,
  module: 'platform',
  method: 'POST',
  path: '/platform/plans',
  summary: 'Create a subscription plan version with its entitlements, capacity limits and price.',
  permissions: ['platform.subscription.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.subscription_plan.created',
  idempotent: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(PLAN_LIST_OPERATION, request, async ({ db, request: raw }) => {
    const query = parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query');
    return {
      body: await platformModule().subscriptions.listPlans(db, {
        status: query.status,
        planCode: query.planCode,
      }),
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    PLAN_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, PlanCreateBody);
      const created = await platformModule().subscriptions.createPlan(db, input);
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
