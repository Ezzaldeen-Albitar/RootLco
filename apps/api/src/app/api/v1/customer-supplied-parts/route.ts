/**
 * /api/v1/customer-supplied-parts — take a customer's own part into custody
 * (P1-21-BE-009).
 *
 * ## This endpoint deliberately changes no stock
 *
 * A customer-supplied part is the customer's property held in custody. The schema
 * says so structurally, not by convention:
 *
 *  - `inv.customer_supplied_parts` is documented as "custody-tracked, never valued
 *    stock, generate **NO stock movement and NO balance change**";
 *  - `ck_customer_supplied_parts_owned CHECK (customer_owned)` makes company
 *    ownership unrepresentable — the column cannot be false;
 *  - `inv.item_master`'s own comment states that customer-supplied parts are **not**
 *    `item_master` rows;
 *  - there is no `customer_supplied` value in `ck_stock_movements_reference_kind`, so
 *    a movement citing one could not be inserted even by mistake.
 *
 * So the response states `affectsStock: false` and `customerOwned: true` explicitly.
 * A client that had to infer "this did not become company stock" from the absence of
 * a movement id would eventually infer it wrongly, and the consequence — a customer's
 * alternator appearing in the company's on-hand balance and its valuation — is
 * exactly the ownership error this shape exists to prevent.
 *
 * `itemRef`, when supplied, points at the item **catalog** for identification only.
 * It does not make the part stock and no balance is touched.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  CUSTODY_STATES,
  MAX_DESCRIPTION,
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

export const CreateBody = z
  .object({
    workOrderId: schemas.uuid,
    description: z.string().min(1).max(MAX_DESCRIPTION),
    quantity: QuantityString,
    custodyState: z.enum(CUSTODY_STATES).optional(),
    receptionVisitRef: schemas.uuid.optional(),
    itemRef: schemas.uuid.optional(),
    itemCondition: z.string().min(1).max(MAX_DESCRIPTION).optional(),
    evidenceRef: schemas.uuid.optional(),
  })
  .strict();

export const CUSTOMER_SUPPLIED_PART_CREATE_OPERATION = defineOperation({
  id: 'inv.customer-supplied-part-create',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/customer-supplied-parts',
  summary: 'Record a customer-owned part taken into custody against a work order.',
  // A distinct permission from `inv.stock.operate`, whose stated meaning is "post
  // movements, reserve, issue, return" — none of which this does. Custody of someone
  // else's property is a different authority from operating company stock.
  permissions: ['inv.custody.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.customer_supplied_part.recorded',
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
    CUSTOMER_SUPPLIED_PART_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const created = await inventoryModule().intake.recordCustomerSuppliedPart(
        db,
        {
          workOrderId: parsed.workOrderId,
          description: parsed.description,
          quantity: parsed.quantity,
          custodyState: parsed.custodyState ?? 'received',
          ...(parsed.receptionVisitRef === undefined
            ? {}
            : { receptionVisitRef: parsed.receptionVisitRef }),
          ...(parsed.itemRef === undefined ? {} : { itemRef: parsed.itemRef }),
          ...(parsed.itemCondition === undefined ? {} : { itemCondition: parsed.itemCondition }),
          ...(parsed.evidenceRef === undefined ? {} : { evidenceRef: parsed.evidenceRef }),
        },
        authorizeScope
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { body }
  );
}
