/**
 * /api/v1/stock-adjustments.
 *
 * `POST` requests a stock adjustment; `GET` lists a branch's adjustments
 * (P1-32-PRE-046).
 *
 * The tables and the approval function shipped in Phase 1-10 with no operation over
 * them. A request is PENDING and moves nothing. The correction reaches the ledger
 * only when a different person approves it through
 * `POST /stock-adjustments/{adjustmentId}/approval`, and
 * `inv.guard_adjustment_approval` refuses an approver who is the requester.
 *
 * `valueImpact` (with `currencyCode`) is the RESTRICTED money consequence, written
 * to `inv.stock_adjustment_details`, and is accepted only from a caller who holds
 * `inv.cost.view` in the branch. The details table's own INSERT policy requires the
 * same permission, so the application check exists to say so in a sentence.
 *
 * ## Idempotency
 *
 * `inv.stock_adjustments` has no idempotency column, so a replay is resolved by the
 * `Idempotency-Key` header alone: the stored response is returned and no second
 * adjustment is requested. The body therefore carries no `replayed` flag — the
 * header-level replay cannot set one truthfully.
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
import {
  ADJUSTMENT_STATES,
  DIRECTIONS,
  MAX_REASON,
  QUANTITY_MAX,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    status: z.enum(ADJUSTMENT_STATES).optional(),
    itemId: schemas.uuid.optional(),
    locationId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const STOCK_ADJUSTMENT_LIST_OPERATION = defineOperation({
  id: 'inv.stock-adjustment-list',
  module: 'inventory',
  method: 'GET',
  path: '/stock-adjustments',
  summary: "List a branch's stock adjustments, newest first.",
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    STOCK_ADJUSTMENT_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await inventoryModule().adjustments.list(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.status === undefined ? {} : { status: query.status }),
            ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
            ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
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

export const CreateBody = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    itemId: schemas.uuid,
    locationId: schemas.uuid,
    direction: z.enum(DIRECTIONS),
    quantity: z
      .string()
      .regex(
        /^\d{1,9}(\.\d{1,3})?$/,
        `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
      ),
    reason: z.string().trim().min(1).max(MAX_REASON),
    valueImpact: z
      .string()
      .regex(/^-?\d{1,14}(\.\d{1,4})?$/, 'must be a decimal string of at most 4 places')
      .optional(),
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/, 'must be an ISO-4217 alphabetic code')
      .optional(),
  })
  .strict();

export const STOCK_ADJUSTMENT_CREATE_OPERATION = defineOperation({
  id: 'inv.stock-adjustment-create',
  module: 'inventory',
  method: 'POST',
  path: '/stock-adjustments',
  summary: 'Request a stock adjustment, pending approval by a different person.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock_adjustment.requested',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
  successStatus: 201,
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    STOCK_ADJUSTMENT_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const adjustment = await inventoryModule().adjustments.request(
        db,
        {
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          itemId: parsed.itemId,
          locationId: parsed.locationId,
          direction: parsed.direction,
          quantity: parsed.quantity,
          reason: parsed.reason,
          ...(parsed.valueImpact === undefined ? {} : { valueImpact: parsed.valueImpact }),
          ...(parsed.currencyCode === undefined ? {} : { currencyCode: parsed.currencyCode }),
        },
        authorizeScope
      );
      return { status: 201, body: adjustment, recordVersion: adjustment.recordVersion };
    },
    { body, ...scopeTargetOption(body) }
  );
}
