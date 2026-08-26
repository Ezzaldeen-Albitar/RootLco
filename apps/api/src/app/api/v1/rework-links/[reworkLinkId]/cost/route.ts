/**
 * The RESTRICTED cost of quality on a rework case (Phase 1-19, P1-19-BE-019).
 *
 * `PUT` records or replaces it; `GET` reads it.
 *
 * ## The same gate as the additional-work description, for the same reason
 *
 * `qms.rework_link_details` is 1:1 with a rework link, its `classification` is
 * CHECK-fixed to `'restricted'`, and all three of its policies additionally require
 * `iam.has_permission('iam.sensitive.view')`. For a caller without that permission the
 * row does not exist, for reading OR writing — so it is a separate surface with its
 * own operations, each declaring the sensitive permission ALONGSIDE the functional
 * one. `defineOperation` treats a permission list as a conjunction, so that is a real
 * second requirement checked before any row is touched, and the RLS policy is defence
 * in depth behind it.
 *
 * Folding the cost into the rework-link read would have made that read silently return
 * an incomplete case for every ordinary quality controller.
 *
 * ## What this figure is, and what it is not
 *
 * An internal cost-of-quality KPI: what this workshop's own mistake cost the workshop.
 * It is explicitly NOT a billing artifact — nothing here invoices anybody, no customer
 * sees it, and pricing is Phase 1-20. The migration's own comment says the same.
 *
 * `rework_cost` is `numeric(14,4)`, so it crosses as a decimal STRING: IEEE-754 cannot
 * represent every value the column holds, and a money figure that changes when it is
 * read back is worse than none. `cost_currency` matches `^[A-Z]{3}$`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { qualityModule } from '@/modules/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ reworkLinkId: schemas.uuid });

export const Body = z
  .object({
    // Matches `ck_rework_link_details_cost` (>= 0) and the column's scale of 4.
    reworkCost: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,4})?$/, 'must be a non-negative decimal with at most 4 places'),
    costCurrency: z.string().regex(/^[A-Z]{3}$/, 'must be a three-letter ISO currency code'),
  })
  .strict();

export const REWORK_COST_RECORD_OPERATION = defineOperation({
  id: 'qms.rework-cost-record',
  module: 'quality',
  method: 'PUT',
  path: '/rework-links/{reworkLinkId}/cost',
  summary: 'Record the restricted cost of quality for a rework case.',
  permissions: ['qms.rework.manage', 'iam.sensitive.view'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'qms.rework.cost_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PUT(
  request: Request,
  route: { params: Promise<{ reworkLinkId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REWORK_COST_RECORD_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const cost = await qualityModule().rework.writeCost(
        db,
        params.reworkLinkId,
        { reworkCost: parsed.reworkCost, costCurrency: parsed.costCurrency },
        authorizeScope
      );
      return { status: 200, body: cost, recordVersion: cost.recordVersion };
    },
    { params: raw, body }
  );
}

export const REWORK_COST_READ_OPERATION = defineOperation({
  id: 'qms.rework-cost-read',
  module: 'quality',
  method: 'GET',
  path: '/rework-links/{reworkLinkId}/cost',
  summary: 'Read the restricted cost of quality for a rework case.',
  permissions: ['qms.quality_control.read', 'iam.sensitive.view'],
  scope: 'branch',
  // A read of `restricted` data is audited as SECURITY rather than left unrecorded,
  // exactly as the additional-work description read is: who looked at a cost-of-quality
  // figure is itself the fact worth keeping.
  auditClass: 'security',
  auditAction: 'qms.rework.cost_read',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ reworkLinkId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    REWORK_COST_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return { body: await qualityModule().rework.cost(db, params.reworkLinkId, authorizeScope) };
    },
    { params: raw }
  );
}
