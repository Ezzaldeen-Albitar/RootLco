/**
 * /api/v1/deliveries/{deliveryId}/eligibility — may this vehicle be handed over?
 * (P1-22-BE-014)
 *
 * ## The composition is the application's, and the database does not help
 *
 * `sal.complete_delivery` enforces exactly three preconditions: a receiver row exists,
 * every mandatory checklist item has a `passed` or `waived` result, and at least one
 * signature exists. It checks **no work-order state, no quality control, and no
 * financial balance at all.**
 *
 * So the financial blocker — the most consequential gate on a handover — has no
 * database enforcement whatsoever. This endpoint and the completion it precedes are
 * the only place it exists, and `deliveryModule()` deliberately wires the completion
 * command to the SAME read service that answers here, so the blockers a caller is
 * shown and the blockers actually applied cannot drift apart.
 *
 * ## Why this read declares `sal.finance.view`
 *
 * Not belt-and-braces. The financial blocker is composed from
 * `sal.invoice_open_receivable`, whose inputs live behind that permission. A caller
 * without it would be waved through by an RLS-invisible zero: the blocker would read
 * "nothing outstanding" because it could not see the invoice. That is the worst
 * available failure mode for this operation, so the permission is required and the
 * service additionally fails CLOSED on a fact it cannot establish rather than treating
 * invisibility as absence.
 *
 * ## There is no `eligible` input
 *
 * Nothing on this path reads an eligibility claim from a request. The response is
 * server-composed from protected rows and other modules' public ports, and it returns
 * an explicit list of blocker codes rather than a bare boolean — a caller told only
 * "not eligible" cannot act, and that is precisely the pressure that produces an
 * override which should not exist.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ deliveryId: schemas.uuid }).strict();

export const DELIVERY_ELIGIBILITY_OPERATION = defineOperation({
  id: 'sal.delivery-eligibility-read',
  module: 'delivery',
  method: 'GET',
  path: '/deliveries/{deliveryId}/eligibility',
  summary: 'Report whether a delivery may complete, with every blocking reason.',
  // `sal.delivery.view` gates SELECT on `sal.authorized_receivers` and
  // `sal.delivery_signatures`, and two of the eight blockers are composed from exactly
  // those two tables. Without it they are RLS-invisible, so `receiver_not_verified` and
  // `signature_missing` would be reported for a delivery that HAS both — the same
  // invisible-absence confusion as the blind zero, but in the safe direction. Safe is
  // not the same as correct: it would tell an operator the handover is blocked for a
  // reason they have already satisfied, with nothing to act on.
  //
  // `sal.delivery.manage` is deliberately NOT required. This read is the pre-flight
  // check for `sal.delivery-complete`, which requires `sal.delivery.complete` instead —
  // so requiring `manage` here made the answer unreadable by the only principal that
  // acts on it. It also made that operation unreachable outright: `sal.delivery-complete`
  // is `versionGuarded`, this response carries the `record_version` to put in `If-Match`,
  // and a complete-but-not-manage principal could call neither this nor any of the three
  // preparation writes, so it could never obtain a current version at all. The two
  // permissions that remain are the ones that gate the rows the answer is composed from.
  permissions: ['sal.delivery.view', 'sal.finance.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ deliveryId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    DELIVERY_ELIGIBILITY_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const eligibility = await deliveryModule().reads.readEligibility(
        db,
        params.deliveryId,
        authorizeScope
      );
      // Publishing the version as an ETag as well as in the body is what makes the
      // completion guard usable: the caller re-reads here and echoes the value.
      return { body: eligibility, recordVersion: eligibility.recordVersion };
    },
    { params: raw }
  );
}
