/**
 * /api/v1/stock-returns — return an issued part to stock (P1-21-BE-007).
 *
 * ## Why the body names an issue and not a work order
 *
 * A return is addressed by the **issue it reverses**. That makes "returning another
 * work order's issue" unrepresentable rather than merely refused: there is no
 * parameter in which to name a different work order, a different item, or a
 * different location, because all three are read off the issue. The item and
 * location a return credits are the ones the issue debited, so stock cannot be
 * moved sideways under cover of a return.
 *
 * ## The over-return ceiling
 *
 * `Σ returns ≤ issued` is enforced twice in the database and once here. The service
 * pre-checks so the caller gets a readable message; `inv.return_part` re-checks
 * under a row lock on the parent issue so two concurrent returns cannot each see
 * room for the last unit; and `inv.guard_part_return_ceiling` checks again on the
 * `part_returns` insert itself, which is what closes the phantom-stock path a raw
 * insert bypassing the function would otherwise open. The trigger is the trust
 * root — the application check is ergonomics.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, QUANTITY_MAX, inventoryModule } from '@/modules/inventory';

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
    partIssueId: schemas.uuid,
    quantity: QuantityString,
    reason: z.string().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const STOCK_RETURN_CREATE_OPERATION = defineOperation({
  id: 'inv.stock-return-create',
  module: 'inventory',
  method: 'POST',
  path: '/stock-returns',
  summary: 'Return a previously issued part to the stock location it came from.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.part.returned',
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
    STOCK_RETURN_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const returned = await inventoryModule().stock.returnPart(
        db,
        {
          partIssueId: parsed.partIssueId,
          quantity: parsed.quantity,
          ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
        },
        authorizeScope
      );
      return { status: 201, body: returned };
    },
    { body }
  );
}
