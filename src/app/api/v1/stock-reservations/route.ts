/**
 * /api/v1/stock-reservations — reserve stock (P1-21-BE-004, BE-013).
 *
 * A reservation reduces available quantity without moving anything, so it is the
 * mechanism by which a work order can be sure the part it needs will still be there
 * when a technician reaches for it.
 *
 * ## Concurrency
 *
 * The last-unit race is resolved in the database, not here.
 * `inv.reserve_stock` takes the balance-row `FOR UPDATE` lock, expires stale
 * reservations for the cell, and re-reads `on_hand` and the active-reservation sum
 * **inside** that lock before inserting — so two simultaneous requests for the same
 * final unit produce exactly one winner and one refusal, and the loser sees
 * `ERR-TRN-001` rather than a partially applied reservation. Checking availability
 * in application code first would add a read-then-write race and change nothing.
 *
 * ## Idempotency
 *
 * `idempotent: true` requires an `Idempotency-Key` header, and the reservation
 * additionally carries its own key into `uq_stock_reservations_idempotency`, which
 * spans the reservation's whole lifetime — so a retry after a released or consumed
 * reservation still resolves to the original rather than booking new stock. Reusing
 * a key for a *different* quantity, item, or location is a conflict, not a success.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { QUANTITY_MAX, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Quantity is a decimal STRING, never a number.
 *
 * `numeric(12,3)` cannot survive an IEEE-754 round trip at the third decimal — the
 * exact place inventory counts — and a JSON number would already have lost it
 * before Zod saw it. The regex refuses scientific notation and a leading `+` too,
 * because PostgreSQL would accept `1e3` and store 1000, which is not the number a
 * caller who typed it by accident meant.
 */
const QuantityString = z
  .string()
  .regex(
    /^\d{1,9}(\.\d{1,3})?$/,
    `must be a decimal string of at most 3 places (max ${QUANTITY_MAX})`
  );

const CreateBody = z
  .object({
    itemId: schemas.uuid,
    locationId: schemas.uuid,
    quantity: QuantityString,
    workOrderId: schemas.uuid.optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const STOCK_RESERVATION_CREATE_OPERATION = defineOperation({
  id: 'inv.stock-reservation-create',
  module: 'inventory',
  method: 'POST',
  path: '/stock-reservations',
  summary: 'Reserve stock at a location, optionally against a work order.',
  permissions: ['inv.stock.operate'],
  // `branch`, and the target is concrete: the service resolves the stock location's
  // own company and branch and re-authorizes against them before writing. Without a
  // target `requiresScopedEvaluation` returns false whatever the declared scope, and
  // the check would degrade to the scope-blind `iam.has_permission` (P1-18-A-01).
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock.reserved',
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
    STOCK_RESERVATION_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const created = await inventoryModule().stock.reserve(
        db,
        {
          itemId: parsed.itemId,
          locationId: parsed.locationId,
          quantity: parsed.quantity,
          ...(parsed.workOrderId === undefined ? {} : { workOrderId: parsed.workOrderId }),
          ...(parsed.idempotencyKey === undefined ? {} : { idempotencyKey: parsed.idempotencyKey }),
          ...(parsed.expiresAt === undefined ? {} : { expiresAt: parsed.expiresAt }),
        },
        authorizeScope
      );
      // 200 on a replay, 201 on a fresh booking: a client that retries needs to be
      // able to tell that it did not reserve stock twice.
      return {
        status: created.replayed ? 200 : 201,
        body: created,
        recordVersion: created.recordVersion,
      };
    },
    // No `scopeTargetOption(body)`: the body names an item and a location, not a
    // company and a branch, so there is nothing for the pre-handler check to narrow
    // by. The real scope check is the service's `authorizeScope` against the stock
    // location's own company and branch, which is resolved inside the transaction.
    { body }
  );
}
