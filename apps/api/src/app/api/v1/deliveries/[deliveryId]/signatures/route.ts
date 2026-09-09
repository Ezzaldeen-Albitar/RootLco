/**
 * /api/v1/deliveries/{deliveryId}/signatures — bind a signature to a handover
 * (P1-22-BE-016).
 *
 * Plural and append-only, matching the table: `sal.delivery_signatures` has
 * `SELECT, INSERT` and no UPDATE, and three signer roles may each sign
 * (`receiver`, `delivering_employee`, `witness`).
 *
 * ## A reference, never the image
 *
 * The body carries a `shared.document_versions` id and nothing else. No signature bytes,
 * no data URL, no base64 field exists on this path, and none reaches an audit detail, an
 * event payload or a log line. The service verifies the version belongs to the same
 * tenant/company/branch as the delivery and is a real registered version; beyond that it
 * is an opaque id.
 *
 * **No biometric claim and no legal-validation claim is made anywhere.** This platform
 * records that a document was bound to a handover. It does not assert that the mark in
 * that document is a particular person's, nor that it satisfies any signature law.
 *
 * ## Bound, and downloadable only once accepted — P1-22-L-04, corrected here
 *
 * `sal.delivery_signatures` accepts ANY `document_versions` row regardless of status,
 * while `shared.document_versions.status` defaults to `'pending'` and
 * `DOWNLOADABLE_STATES` is `['accepted']`. P1-22 recorded the rest of the rule as "no
 * application path can produce acceptance" — `shared.file_scan_results` granted to no
 * role, the only runtime UPDATE policy pinning `pending → rejected`. **That is no longer
 * the rule the attachment service implements**, and this docblock said so for longer than
 * it was true: `20260815090000_shared_reception_evidence_foundation.sql` adds
 * `ins_file_scan_results_scanner`, `upd_document_versions_lifecycle`, `GRANT INSERT ON
 * shared.file_scan_results` and `GRANT UPDATE(status) ON shared.document_versions`.
 *
 * `AttachmentService.requestDownload` carries today's rule, and it is quoted rather than
 * paraphrased. It records that the state check "used to be 'no path in this phase can
 * accept a version', which was true when nothing could produce a verdict.
 * `registerVersionAndScan` now can", and that what it rests on instead is: "an accepted
 * version passed `scanning` with an exclusively clean verdict, enforced by
 * `shared.guard_document_version_transition` rather than by this method; and a rejected or
 * quarantined version is terminal, so it can never become downloadable later".
 *
 * So a version bound here is refused with `ERR-DOC-001` while it is not `accepted`, and
 * that refusal is a state check rather than an impossibility. This route still ships NO
 * signature-retrieval endpoint of its own — retrieval of a `shared.document_versions` row
 * is the shared attachment path's contract, not this module's — but that is now a scope
 * statement and no longer a claim that retrieval could never work. Corrected by P1-31
 * prerequisite P-14; nothing on this path changed behaviour.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { SIGNER_ROLES, deliveryModule } from '@/modules/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ deliveryId: schemas.uuid }).strict();
const PageQuery = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const SignBody = z
  .object({
    signerRole: z.enum(SIGNER_ROLES),
    // The ONLY signature field. `.strict()` above is what makes that true rather than
    // merely intended: a body carrying `signatureData` is rejected, not ignored.
    signatureDocumentVersionId: schemas.uuid,
  })
  .strict();

export const DELIVERY_SIGNATURE_ATTACH_OPERATION = defineOperation({
  id: 'sal.delivery-signature-attach',
  successStatus: 201,
  module: 'delivery',
  method: 'POST',
  path: '/deliveries/{deliveryId}/signatures',
  summary: 'Bind an existing signature document version to a delivery by reference.',
  // Same asymmetry as the receiver route: 'sal.delivery.manage' grants the INSERT and
  // 'sal.delivery.view' grants the SELECT that reads the row back. sal.delivery_signatures
  // is append-only, so the read-back is the only way the response can name what was bound.
  permissions: ['sal.delivery.manage', 'sal.delivery.view'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'sal.delivery.signature_recorded',
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
    DELIVERY_SIGNATURE_ATTACH_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(SignBody, body, 'body');
      const signature = await deliveryModule().deliveries.attachSignature(
        db,
        params.deliveryId,
        {
          signerRole: parsed.signerRole,
          signatureDocumentVersionId: parsed.signatureDocumentVersionId,
        },
        authorizeScope
      );
      return { status: 201, body: signature };
    },
    { params: raw, body }
  );
}

/**
 * GET — the signatures bound to a delivery (Phase 1-31, prerequisite P-4).
 *
 * ## No signature read existed
 *
 * `findSignature` is a REPLAY PROBE addressed by the exact
 * `(delivery, signerRole, signatureDocumentVersionId)` triple, so a caller must
 * already hold the document-version id to use it — the unrecoverable-identifier
 * problem restated, not a read of the signatures. `hasSignature` is a boolean, and
 * the eligibility read publishes only `signature_missing` from it. Neither answers
 * "which signatures does this delivery carry", which is what the delivery document
 * (FE-007) is composed from and what a handover audit asks.
 *
 * **This is not a pure publication, and that is stated rather than implied**: the set
 * read is a new query. It reuses `toDeliverySignature`, so there is no second mapper
 * and no second wire contract for this row.
 *
 * ## Paged, because the set has no ceiling
 *
 * There is deliberately no unique constraint on `(delivery_record_id, signer_role)` —
 * the table's own comment records that corrections are made by APPENDING a new row —
 * so a delivery may carry any number of signatures and an unbounded SELECT is not
 * available. Keyset, newest first, so a correction appended underneath a reader does
 * not shift the page boundary. The cursor is minted by `cursorTimestamp('signed_at')`
 * at microsecond precision, because `signed_at` defaults to `now()` and several
 * signatures attached in one transaction share it exactly (`P1-27-INT-006`).
 *
 * ## References, never bytes — and no download
 *
 * Each entry carries `signatureDocumentVersionId`, a `shared.document_versions`
 * reference whose sha256 anchors the signature. Raw signature data appears nowhere in
 * this module. No retrieval path is offered here or anywhere else in it: the
 * documented reason is `P1-22-L-04` — `shared.guard_document_version_transition`
 * requires a clean scan record to reach `accepted`, no scanner is provisioned, and
 * `DOWNLOADABLE_STATES` is `['accepted']`, so a download route would be a contract
 * that always fails.
 *
 * ## Permission
 *
 * `sal.delivery.view`, which is the code `sel_delivery_signatures_gated` itself names
 * on SELECT — so the application gate and the row-level gate are the same code rather
 * than two that can drift.
 */
export const DELIVERY_SIGNATURE_LIST_OPERATION = defineOperation({
  id: 'sal.delivery-signature-list',
  module: 'delivery',
  method: 'GET',
  path: '/deliveries/{deliveryId}/signatures',
  summary: 'List the signatures bound to a delivery, newest first.',
  permissions: ['sal.delivery.view'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ deliveryId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const rawQuery = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    DELIVERY_SIGNATURE_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(PageQuery, rawQuery, 'query');
      return {
        body: await deliveryModule().reads.readSignatures(
          db,
          params.deliveryId,
          { cursor: query.cursor, limit: query.limit },
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
