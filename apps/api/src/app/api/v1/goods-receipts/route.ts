/**
 * /api/v1/goods-receipts.
 *
 * `POST` creates a draft goods receipt with its lines (P1-32-PRE-043); `GET` lists
 * a branch's receipts (P1-32-PRE-044).
 *
 * A draft moves nothing. Stock and cost history appear only when the receipt is
 * posted through `POST /goods-receipts/{receiptId}/posting`.
 *
 * ## Unit cost
 *
 * `unitCost` (with `currencyCode`) is optional on every line, and accepted only
 * from a caller who also holds `inv.cost.view` in the receipt's branch. Without it
 * the request is refused with `ERR-VAL-001` naming each priced line — not accepted
 * with the cost silently dropped, which would post a receipt its author believes
 * was priced. The two permissions are not merged into one operation declaration
 * because an unpriced receipt is a legitimate act for someone who may not see cost.
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
  GOODS_RECEIPT_STATES,
  LOCATION_CODE_FORMAT,
  MAX_DESCRIPTION,
  MAX_NAME,
  QUANTITY_MAX,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    status: z.enum(GOODS_RECEIPT_STATES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const GOODS_RECEIPT_LIST_OPERATION = defineOperation({
  id: 'inv.goods-receipt-list',
  module: 'inventory',
  method: 'GET',
  path: '/goods-receipts',
  summary: "List a branch's goods receipts, newest first.",
  permissions: ['inv.stock.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    GOODS_RECEIPT_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const query = parseOrFail(ListQuery, raw, 'query');
      return {
        body: await inventoryModule().receipts.list(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            ...(query.status === undefined ? {} : { status: query.status }),
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

export const CreateLine = z
  .object({
    itemId: schemas.uuid,
    locationId: schemas.uuid,
    quantity: z
      .string()
      .regex(
        /^\d{1,9}(\.\d{1,3})?$/,
        `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
      ),
    // A decimal STRING, never a JSON number: `numeric(18,4)` does not survive an
    // IEEE-754 round trip, and a cost is exactly where the fourth place matters.
    unitCost: z
      .string()
      .regex(/^\d{1,14}(\.\d{1,4})?$/, 'must be a non-negative decimal string of at most 4 places')
      .optional(),
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/, 'must be an ISO-4217 alphabetic code')
      .optional(),
  })
  .strict();

export const CreateBody = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    reference: z
      .string()
      .regex(LOCATION_CODE_FORMAT, 'must be an alphanumeric reference')
      .optional(),
    supplierReference: z.string().trim().min(1).max(MAX_NAME).optional(),
    receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)'),
    notes: z.string().trim().min(1).max(MAX_DESCRIPTION).optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
    lines: z.array(CreateLine).min(1).max(200),
  })
  .strict();

export const GOODS_RECEIPT_CREATE_OPERATION = defineOperation({
  id: 'inv.goods-receipt-create',
  module: 'inventory',
  method: 'POST',
  path: '/goods-receipts',
  summary: 'Create a draft goods receipt with its counted lines.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.goods_receipt.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    GOODS_RECEIPT_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const receipt = await inventoryModule().receipts.create(
        db,
        {
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          ...(parsed.reference === undefined ? {} : { reference: parsed.reference }),
          ...(parsed.supplierReference === undefined
            ? {}
            : { supplierReference: parsed.supplierReference }),
          receivedOn: parsed.receivedOn,
          ...(parsed.notes === undefined ? {} : { notes: parsed.notes }),
          ...(parsed.idempotencyKey === undefined ? {} : { idempotencyKey: parsed.idempotencyKey }),
          lines: parsed.lines.map((line) => ({
            itemId: line.itemId,
            locationId: line.locationId,
            quantity: line.quantity,
            ...(line.unitCost === undefined ? {} : { unitCost: line.unitCost }),
            ...(line.currencyCode === undefined ? {} : { currencyCode: line.currencyCode }),
          })),
        },
        authorizeScope
      );
      return {
        status: receipt.replayed ? 200 : 201,
        body: receipt,
        recordVersion: receipt.recordVersion,
      };
    },
    // The body names the branch the receipt is created in, so the pre-handler check
    // evaluates that concrete branch.
    { body, ...scopeTargetOption(body) }
  );
}
