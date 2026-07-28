/**
 * /api/v1/stock-reservations/{reservationId}/release — free a reservation
 * (P1-21-BE-005).
 *
 * A subresource, not a colon-action: the operation registry's `PATH_PATTERN`
 * accepts only lower-case literals and `{camelCase}` parameters, so
 * `/stock-reservations/{id}:release` would be rejected at module load. The
 * repository's noun/subresource grammar is the supported equivalent.
 *
 * ## Idempotent by the database's own behaviour
 *
 * `inv.release_reservation` returns without acting when the reservation is already
 * `released`, `consumed`, or `expired` — `inv.guard_stock_reservation_status` makes
 * every non-active status terminal — so a duplicate release is a safe no-op rather
 * than an error, which is what a retrying client needs. The response reports the
 * resulting state and whether this call was the one that changed it, and the audit
 * record and outbox event are written **only** when it was: recording a state
 * change that did not happen would make the trail lie, and would let a retry loop
 * inflate the outbox.
 *
 * ## Releasing after an issue is not a way to un-consume stock
 *
 * A reservation consumed by `inv.part.issued` is terminal. Releasing it does
 * nothing, and in particular does not return the issued units to available — those
 * left through an `out` movement and can only come back through a return.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, inventoryModule } from '@/modules/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ reservationId: schemas.uuid }).strict();

const ReleaseBody = z
  .object({
    reason: z.string().min(1).max(MAX_REASON).optional(),
  })
  .strict();

export const STOCK_RESERVATION_RELEASE_OPERATION = defineOperation({
  id: 'inv.stock-reservation-release',
  module: 'inventory',
  method: 'POST',
  path: '/stock-reservations/{reservationId}/release',
  summary: 'Release an active stock reservation, returning its quantity to available.',
  permissions: ['inv.stock.operate'],
  // The path names a reservation, not a branch, so the pre-handler check has no
  // target and would be scope-blind. The service loads the reservation, which
  // carries its own company and branch, and re-authorizes against those inside the
  // transaction before the release lands (P1-18-A-01).
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'inv.stock.reservation_released',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ reservationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    STOCK_RESERVATION_RELEASE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const { reservationId } = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(ReleaseBody, body ?? {}, 'body');
      const released = await inventoryModule().stock.release(
        db,
        reservationId,
        parsed.reason ?? 'released',
        authorizeScope
      );
      return { body: released, recordVersion: released.recordVersion };
    },
    { params: raw, body }
  );
}
