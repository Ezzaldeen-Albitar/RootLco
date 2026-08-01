/**
 * /api/v1/external-purchase-parts — record an ad-hoc external purchase
 * (P1-21-BE-010).
 *
 * ## This is a reference, not procurement
 *
 * `inv.external_purchase_parts` is documented as an "ad-hoc work-order-linked
 * external purchase reference **ONLY** … **NOT** a PO/PR/goods-receipt/bidding
 * workflow", and `ck_external_purchase_parts_not_procurement CHECK
 * (is_procurement = false)` is the schema refusing to become one. So this endpoint
 * creates no purchase order, runs no approval chain, posts no goods receipt, and
 * changes no stock — `affectsStock: false` is in the response for the same reason it
 * is on the customer-supplied one.
 *
 * A part bought this way that physically arrives becomes company stock only through
 * an opening batch or a stock adjustment, both of which require
 * `inv.adjustment.approve` and a second person. Letting a purchase record raise
 * on-hand directly would be an unapproved path to minting stock.
 *
 * ## Cost is restricted, and the restriction is enforced by the database
 *
 * `unitCost` is written to `inv.external_purchase_part_details`, whose every RLS
 * policy — SELECT, INSERT and UPDATE — is gated by
 * `iam.has_permission('inv.cost.view')`. A caller without it gets `ERR-IAM-001`
 * rather than a silently dropped cost, and the value is never echoed back in the
 * response: `costRecorded` is a boolean, not an amount.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  EXTERNAL_PURCHASE_STATES,
  MAX_DESCRIPTION,
  MAX_NAME,
  QUANTITY_MAX,
  inventoryModule,
} from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QuantityString = z
  .string()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
  );

/**
 * Unit cost is `numeric(18,4)` with its own currency.
 *
 * A decimal string for the same reason quantity is one, and the currency is required
 * alongside it because `inv.external_purchase_part_details.currency_code` is a NOT
 * NULL FK to `shared.currencies` — an amount without a currency is not a cost. No
 * foreign exchange is invented: costs in different currencies are stored as given
 * and never summed.
 */
const UnitCost = z
  .object({
    amount: z
      .string()
      .regex(/^\d{1,14}(\.\d{1,4})?$/, 'must be a decimal string of at most 4 places'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-4217 alphabetic code'),
  })
  .strict();

const CreateBody = z
  .object({
    workOrderId: schemas.uuid,
    description: z.string().min(1).max(MAX_DESCRIPTION),
    quantity: QuantityString,
    status: z.enum(EXTERNAL_PURCHASE_STATES).optional(),
    supplierPartnerId: schemas.uuid.optional(),
    supplierName: z.string().min(1).max(MAX_NAME).optional(),
    itemRef: schemas.uuid.optional(),
    evidenceRef: schemas.uuid.optional(),
    unitCost: UnitCost.optional(),
  })
  .strict();

export const EXTERNAL_PURCHASE_PART_CREATE_OPERATION = defineOperation({
  id: 'inv.external-purchase-part-create',
  module: 'inventory',
  method: 'POST',
  path: '/external-purchase-parts',
  summary: 'Record an ad-hoc external purchase reference against a work order.',
  permissions: ['inv.external_purchase.record'],
  scope: 'branch',
  // `financial`, because the unit cost is a figure the tenant will be charged — even
  // though the entry adds no stock and is not procurement.
  auditClass: 'financial',
  auditAction: 'inv.external_purchase.recorded',
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
    EXTERNAL_PURCHASE_PART_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const created = await inventoryModule().intake.recordExternalPurchasePart(
        db,
        {
          workOrderId: parsed.workOrderId,
          description: parsed.description,
          quantity: parsed.quantity,
          status: parsed.status ?? 'recorded',
          ...(parsed.supplierPartnerId === undefined
            ? {}
            : { supplierPartnerId: parsed.supplierPartnerId }),
          ...(parsed.supplierName === undefined ? {} : { supplierName: parsed.supplierName }),
          ...(parsed.itemRef === undefined ? {} : { itemRef: parsed.itemRef }),
          ...(parsed.evidenceRef === undefined ? {} : { evidenceRef: parsed.evidenceRef }),
          ...(parsed.unitCost === undefined ? {} : { unitCost: parsed.unitCost }),
        },
        authorizeScope
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
