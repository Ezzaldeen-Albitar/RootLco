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

const VerifyBody = z
  .object({
    receiverPartnerId: schemas.uuid,
    identityEvidenceDocumentVersionId: schemas.uuid.optional(),
  })
  .strict();

export const DELIVERY_RECEIVER_VERIFY_OPERATION = defineOperation({
  id: 'sal.delivery-receiver-verify',
  module: 'delivery',
  method: 'POST',
  path: '/deliveries/{deliveryId}/authorized-receiver',
  summary: 'Verify the single authorized receiver for a delivery against the visit roles.',
  permissions: ['sal.delivery.manage'],
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
