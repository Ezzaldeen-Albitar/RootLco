/**
 * /api/v1/stock-issues — issue a part from stock to a work order (P1-21-BE-006).
 *
 * The single point at which company stock leaves inventory and becomes work done
 * on a vehicle, so it is where the most invariants meet.
 *
 * ## Three checks the protected function does not make
 *
 * `inv.issue_part` was found to be wrong in three ways, each reproduced against a
 * live database and recorded in
 * `docs/phase-1/phase-1-21/wave-1-contract-archaeology.md`:
 *
 *  - **`D-01` — ordering.** It posts the `out` movement before consuming the
 *    reservation, so `on_hand` falls while `reserved` is still held and
 *    `ck_stock_balances_available` rejects the write whenever the reservation
 *    covers the stock being issued. The natural reserve-exactly-then-issue flow
 *    therefore fails inside the function. This route's service performs the same
 *    three granted operations in the order the constraints permit.
 *  - **`D-02` — lifecycle.** It selects `wo.work_orders.state` and never reads the
 *    variable, so a `draft` work order accepts an issue. The service locks the work
 *    order and consults the data-driven `wo.work_order_states` flags instead.
 *  - **`D-03` — reservation coherence.** It consumes whatever reservation id it is
 *    handed, including one belonging to a different item, releasing reserved
 *    quantity on an unrelated cell. The service refuses a reservation that does not
 *    match this item, location, and work order, and refuses an issue larger than
 *    the reservation holds.
 *
 * None of this edits a migration: every statement uses an existing `app_runtime`
 * grant, and every database guard still applies underneath.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { QUANTITY_MAX, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QuantityString = z
  .string()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
  );

const CreateBody = z
  .object({
    workOrderId: schemas.uuid,
    itemId: schemas.uuid,
    locationId: schemas.uuid,
    quantity: QuantityString,
    reservationId: schemas.uuid.optional(),
    requiredPartRef: schemas.uuid.optional(),
  })
  .strict();

export const STOCK_ISSUE_CREATE_OPERATION = defineOperation({
  id: 'inv.stock-issue-create',
  module: 'inventory',
  method: 'POST',
  path: '/stock-issues',
  summary: 'Issue a part from stock to a work order, consuming its reservation.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.part.issued',
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
    STOCK_ISSUE_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const issued = await inventoryModule().stock.issue(
        db,
        {
          workOrderId: parsed.workOrderId,
          itemId: parsed.itemId,
          locationId: parsed.locationId,
          quantity: parsed.quantity,
          ...(parsed.reservationId === undefined ? {} : { reservationId: parsed.reservationId }),
          ...(parsed.requiredPartRef === undefined
            ? {}
            : { requiredPartRef: parsed.requiredPartRef }),
        },
        authorizeScope
      );
      return { status: 201, body: issued };
    },
    { body }
  );
}
