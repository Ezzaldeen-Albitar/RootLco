/**
 * PATCH /api/v1/platform/plans/{planId} (P1-32-PRE-023).
 *
 * Amends one subscription-plan version under optimistic concurrency.
 *
 * `org.subscription_plans` carries `record_version`, advanced by exactly one on
 * every update by `shared.touch_row_metadata()`, so the `If-Match` guard is the
 * table's own and not invented here. The plan code is not in this body and not
 * in `app_platform`'s UPDATE column grant: a plan is never renamed, only amended.
 *
 * Nullable commercial fields accept an explicit `null`, which clears them — the
 * only way to unprice a plan that was priced by mistake. An absent field is left
 * unchanged. The repository distinguishes the two per field rather than using
 * `COALESCE`, which cannot express "set this back to null".
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { PLAN_STATUSES, platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ planId: schemas.uuid }).strict();

const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const PlanUpdateBody = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    listPrice: z
      .string()
      .regex(/^\d{1,14}(\.\d{1,4})?$/, 'must be a non-negative decimal string')
      .nullable()
      .optional(),
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    termMonths: z.number().int().min(1).max(120).nullable().optional(),
    capacityLimits: z
      .object({
        companies: z.number().int().min(0).max(1_000_000).optional(),
        branches: z.number().int().min(0).max(1_000_000).optional(),
        users: z.number().int().min(0).max(1_000_000).optional(),
      })
      .strict()
      .optional(),
    entitlementDocument: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{1,62}$/), z.boolean())
      .optional(),
    status: z.enum(PLAN_STATUSES).optional(),
    effectiveTo: CalendarDate.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be supplied',
  });

export const PLAN_UPDATE_OPERATION = defineOperation({
  id: 'platform.plan-update',
  module: 'platform',
  method: 'PATCH',
  path: '/platform/plans/{planId}',
  summary: 'Amend a subscription plan version under If-Match.',
  permissions: ['platform.subscription.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.subscription_plan.updated',
  idempotent: true,
  versionGuarded: true,
  answersNotFound: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ planId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    PLAN_UPDATE_OPERATION,
    request,
    async ({ db, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = parseOrFail(PlanUpdateBody, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const updated = await platformModule().subscriptions.updatePlan(
        db,
        params.planId,
        expectedVersion,
        input
      );
      return { body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw, body }
  );
}
