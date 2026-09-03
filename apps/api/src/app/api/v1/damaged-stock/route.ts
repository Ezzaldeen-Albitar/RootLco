/**
 * /api/v1/damaged-stock — record damaged stock (P1-21-BE-008).
 *
 * ## Damaged stock must stop being available, and the schema does that structurally
 *
 * `inv.record_damage` posts a **paired** movement: `out` of the sellable location
 * and `in` to a quarantine location. Damaged units therefore leave sellable
 * availability by moving to a different balance cell, not by setting a flag that a
 * later query might forget to filter on. The two legs are distinguishable to
 * `uq_stock_movements_source` only by `direction`, which is why damage is the one
 * reference kind that legitimately produces two ledger rows.
 *
 * ## Why the destination is validated even though a constraint exists
 *
 * `ck_damaged_stock_locations` requires only that the two locations differ. That is
 * not enough: moving a "damaged" unit to another *sellable* location would satisfy
 * the constraint and leave the unit available — the exact availability inflation
 * this task must prevent. `assertQuarantineDestination` requires the destination to
 * be `location_type = 'quarantine'` and refuses damaging stock that is already in
 * quarantine.
 *
 * ## Why availability cannot go negative here
 *
 * Reducing `on_hand` at the sellable location could otherwise breach
 * `ck_stock_balances_available` when reservations are outstanding.
 * `inv.record_damage` calls `inv.free_reservations_for_loss` first, releasing active
 * reservations newest-first until the reduction fits — so the invariant holds and
 * the reservations that lose out are recorded as `stock_loss` rather than silently
 * vanishing.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  DAMAGE_DISPOSITIONS,
  MAX_REASON,
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
    itemId: schemas.uuid,
    fromLocationId: schemas.uuid,
    quarantineLocationId: schemas.uuid,
    quantity: QuantityString,
    // `ck_damaged_stock_reason_not_blank` — a damage record with no stated reason is
    // an unexplained stock loss, so the reason is required rather than optional.
    reason: z.string().min(1).max(MAX_REASON),
    disposition: z.enum(DAMAGE_DISPOSITIONS).optional(),
    responsiblePartyRef: schemas.uuid.optional(),
    evidenceRef: schemas.uuid.optional(),
  })
  .strict();

export const DAMAGED_STOCK_CREATE_OPERATION = defineOperation({
  id: 'inv.damaged-stock-create',
  successStatus: 201,
  module: 'inventory',
  method: 'POST',
  path: '/damaged-stock',
  summary: 'Record damaged stock and move it out of sellable availability into quarantine.',
  permissions: ['inv.stock.operate'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock.damaged',
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
    DAMAGED_STOCK_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const damage = await inventoryModule().stock.recordDamage(
        db,
        {
          itemId: parsed.itemId,
          fromLocationId: parsed.fromLocationId,
          quarantineLocationId: parsed.quarantineLocationId,
          quantity: parsed.quantity,
          reason: parsed.reason,
          disposition: parsed.disposition ?? 'quarantined',
          ...(parsed.responsiblePartyRef === undefined
            ? {}
            : { responsiblePartyRef: parsed.responsiblePartyRef }),
          ...(parsed.evidenceRef === undefined ? {} : { evidenceRef: parsed.evidenceRef }),
        },
        authorizeScope
      );
      return { status: 201, body: damage };
    },
    { body }
  );
}
