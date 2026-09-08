/**
 * /api/v1/deliveries/{deliveryId}/authorized-receiver — verify who may collect the
 * vehicle (P1-22-BE-015).
 *
 * Singular, because `uq_authorized_receivers_delivery` permits exactly ONE receiver per
 * delivery. A plural path would advertise a collection the schema cannot hold.
 *
 * ## The authority is checked against the visit, not asserted by the caller
 *
 * `sal.guard_authorized_receiver` (M-dlv-2) requires the receiver to hold a
 * `rec.reception_party_roles` row for this delivery's reception visit, with
 * `deleted_at IS NULL` and `valid_from <= verified_at AND (valid_to IS NULL OR valid_to
 * > verified_at)`. It is **time-aware**: a party role that has expired does not
 * authorise a collection today, and one that starts tomorrow does not authorise one
 * now. So a caller cannot nominate an arbitrary partner, and the refusal is translated
 * into a caller-safe message rather than surfacing a trigger name.
 *
 * ## Identity evidence is a reference, and only a reference
 *
 * `identity_evidence_document_version_id` binds an existing
 * `shared.document_versions` row. This route never reads that document's contents, and
 * nothing on this path writes an identity-document value into an audit detail, an event
 * payload or a log line. The document is verified to belong to the same
 * tenant/company/branch; beyond that it is an opaque id.
 *
 * No biometric claim and no legal-validation claim is made anywhere on this path.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ deliveryId: schemas.uuid }).strict();

export const VerifyBody = z
  .object({
    receiverPartnerId: schemas.uuid,
    identityEvidenceDocumentVersionId: schemas.uuid.optional(),
  })
  .strict();

export const DELIVERY_RECEIVER_VERIFY_OPERATION = defineOperation({
  id: 'sal.delivery-receiver-verify',
  successStatus: 201,
  module: 'delivery',
  method: 'POST',
  path: '/deliveries/{deliveryId}/authorized-receiver',
  summary: 'Verify the single authorized receiver for a delivery against the visit roles.',
  // INSERT needs 'sal.delivery.manage' (ins_authorized_receivers_gated) but the
  // 'exactly one receiver per delivery' pre-check and the read-back that builds the
  // response both SELECT the row, and SELECT is gated by 'sal.delivery.view'. Declaring
  // only the write authority would let the INSERT succeed and then fail to read back what
  // it had just written.
  permissions: ['sal.delivery.manage', 'sal.delivery.view'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'sal.delivery.receiver_verified',
  idempotent: true,
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
    DELIVERY_RECEIVER_VERIFY_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(VerifyBody, body, 'body');
      const receiver = await deliveryModule().deliveries.verifyReceiver(
        db,
        params.deliveryId,
        {
          receiverPartnerId: parsed.receiverPartnerId,
          ...(parsed.identityEvidenceDocumentVersionId === undefined
            ? {}
            : {
                identityEvidenceDocumentVersionId: parsed.identityEvidenceDocumentVersionId,
              }),
        },
        authorizeScope
      );
      return { status: 201, body: receiver };
    },
    { params: raw, body }
  );
}

/**
 * GET — the verified receiver, as a ROW (Phase 1-31, prerequisite P-4).
 *
 * ## A screen could learn *whether*, never *who*
 *
 * `DeliveryRepository.findReceiver` has existed since P1-22 and its only caller was
 * the eligibility composition, which collapses the row into the boolean
 * `receiver_not_verified` blocker. The POST above returns the row it created, and
 * once that response was gone the receiver was unreadable. This publishes the
 * existing read; it adds no query and no second mapper.
 *
 * ## Absence is a 200, not a 404
 *
 * A visible delivery with no verified receiver — the normal state of a fresh
 * delivery — answers `{ deliveryId, receiver: null }`. The DELIVERY's visibility is
 * the not-found decision and `requireDelivery` has already made it, before any scope
 * decision. A 404 here would make "not verified yet" indistinguishable from a scope
 * refusal.
 *
 * ## `deleted_at` is deliberately not filtered
 *
 * `findReceiver` carries no soft-delete predicate, transcribed from
 * `sal.complete_delivery`'s receiver gate, which has none either, and
 * `uq_authorized_receivers_delivery` is a non-partial UNIQUE so there is at most one
 * row per delivery whatever its `deleted_at`. Filtering here would report no receiver
 * for a delivery the primitive would happily complete.
 *
 * ## What crosses, and what does not
 *
 * `identityEvidenceDocumentVersionId` is a `shared.document_versions` REFERENCE.
 * No identity document content is read, summarised, logged or returned — the whole
 * row is gated by `sal.delivery.view` in `sel_authorized_receivers_gated` precisely
 * because the reference is enough to reach identity evidence, and that is the code
 * this operation declares.
 */
export const DELIVERY_RECEIVER_READ_OPERATION = defineOperation({
  id: 'sal.delivery-receiver-read',
  module: 'delivery',
  method: 'GET',
  path: '/deliveries/{deliveryId}/authorized-receiver',
  summary: 'Read the verified authorized receiver of a delivery, if one is recorded.',
  permissions: ['sal.delivery.view'],
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
    DELIVERY_RECEIVER_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await deliveryModule().reads.readReceiver(db, params.deliveryId, authorizeScope),
      };
    },
    { params: raw }
  );
}
