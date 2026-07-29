/**
 * /api/v1/deliveries/{deliveryId}/completion — hand the vehicle over (P1-22-BE-017).
 *
 * The point at which the shop's custody ends. `sal.complete_delivery` captures a final
 * odometer reading, flips the record to `'delivered'`, writes
 * `rec.custody_history → 'released'` and appends the status history — all in one
 * transaction, so a caller never sees a half-completed handover.
 *
 * ## What the primitive checks, and the three things it does not
 *
 * It enforces: an authorized receiver exists, every mandatory checklist item has a
 * `passed` or `waived` result, and at least one signature exists.
 *
 * It does **not** check the work-order state, quality control, or the financial balance.
 * Those three are composed by this operation, and the financial one is the reason this
 * route declares `sal.finance.view` in addition to `sal.delivery.complete`: the blocker
 * reads `sal.invoice_open_receivable`, whose inputs sit behind that permission, and a
 * caller without it would be waved through by an RLS-invisible zero — the check would
 * report "nothing outstanding" because it could not see the invoice.
 *
 * ## The override is narrow, authorised, and recorded
 *
 * Exactly ONE blocker is overridable: `financial_balance_outstanding`. It requires a
 * reason, and the authority is `sal.delivery.complete` — this operation's own high-risk
 * permission, so an override is not reachable by a caller who merely holds
 * `sal.delivery.manage`. The reason is written into the audit details.
 *
 * The others are not overridable, and the reason is honesty rather than strictness: two
 * of them (`receiver_not_verified`, `checklist_incomplete`) are enforced INSIDE
 * `sal.complete_delivery`, so an "override" would be accepted here and then fail at the
 * database with a `check_violation`. Advertising an override that cannot work is worse
 * than not offering one.
 *
 * ## Eligibility is recomputed inside the transaction
 *
 * Not read from the `GET .../eligibility` response, and not trusted from the body — there
 * is no `eligible` field to trust. The service locks the delivery row and recomposes the
 * blocker set from the same read service that answers the GET, so what a caller was shown
 * and what is actually enforced are the same code over the same tables.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REASON, ODOMETER_UNITS, deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ deliveryId: schemas.uuid }).strict();

/**
 * `veh.odometer_readings.value` is `numeric`. Carried as an unsigned decimal STRING and
 * cast in SQL, never as a JavaScript number: a reading is a measurement the warranty's
 * absolute odometer limit is computed from, so a float would put a rounding error into a
 * coverage term.
 */
const OdometerValue = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'must be an unsigned decimal string with at most 2 decimals');

const CompleteBody = z
  .object({
    finalOdometerValue: OdometerValue,
    odometerUnit: z.enum(ODOMETER_UNITS).optional(),
    // The ONLY override this operation accepts, and it must say why. There is
    // deliberately no `overrideAll`, no `force`, and no `skipChecks`.
    overrideFinancialBlocker: z
      .object({ reason: z.string().min(1).max(MAX_REASON) })
      .strict()
      .optional(),
  })
  .strict();

export const DELIVERY_COMPLETE_OPERATION = defineOperation({
  id: 'sal.delivery-complete',
  module: 'delivery',
  method: 'POST',
  path: '/deliveries/{deliveryId}/completion',
  summary: 'Complete a delivery, releasing custody and capturing the final odometer.',
  permissions: ['sal.delivery.complete', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'sal.delivery.completed',
  idempotent: true,
  // The delivery row is locked and its status re-read inside the transaction, and
  // `sal.complete_delivery` is itself idempotent on an already-delivered record — but a
  // caller holding a stale view should still be told so rather than having its request
  // silently apply to a record that has moved on.
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ deliveryId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DELIVERY_COMPLETE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(CompleteBody, body, 'body');
      const completion = await deliveryModule().deliveries.completeDelivery(
        db,
        params.deliveryId,
        {
          finalOdometerValue: parsed.finalOdometerValue,
          ...(parsed.odometerUnit === undefined ? {} : { odometerUnit: parsed.odometerUnit }),
          ...(parsed.overrideFinancialBlocker === undefined
            ? {}
            : { overrideFinancialBlocker: parsed.overrideFinancialBlocker }),
        },
        authorizeScope
      );
      return { body: completion, recordVersion: completion.recordVersion };
    },
    { params: raw, body }
  );
}
