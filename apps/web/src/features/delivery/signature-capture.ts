'use server';

import {
  captureDocument,
  createDocumentLink,
  listDocumentCategories,
} from '@/features/attachments/api';
import { attachSignature, type DeliveryWriteState } from './api';
import { SIGNATURE_CATEGORY_CODE, SIGNER_ROLES, type SignerRole } from './delivery-contract';

/**
 * One handover signature, from a chosen image to a bound reference (P1-31,
 * FE-006).
 *
 * ## Why this is its own act
 *
 * `sal.delivery-signature-attach` takes a `signatureDocumentVersionId`: a
 * registered document version and nothing else. That is not a value an operator
 * can produce. It exists only at the end of a sequence — authorize an upload,
 * put the bytes, register the version, link the document, bind the reference —
 * and the ORDER of that sequence is the contract. Driving it from a component
 * would put that order in the browser and hand the operator four separate
 * refusals to interpret. Here it is one act with one outcome.
 *
 * The bytes cross the same origin once, into this Server Action. Every storage
 * decision after that is the server's; the browser never holds a storage URL,
 * an object key or an upload token.
 *
 * ## The category is the reception signature category, deliberately
 *
 * `shared.document_categories` seeds seven platform categories and exactly one
 * of them serves a signature image: `reception_signature`, whose business link
 * purpose IS `signature`. A handover is the closing act of a reception visit —
 * `sal.complete_delivery` writes `rec.custody_history` when it releases the
 * vehicle — so the document is captured against `rec.reception_visits`, which is
 * also the only linkable entity type in this chain's reach:
 * `LINKABLE_ENTITY_TYPES` does not carry `sal.delivery_records`.
 *
 * Neither the accepted content types nor the size ceiling is written here. Both
 * belong to the category the SERVER published and are read from it at capture
 * time.
 *
 * ## What this deliberately does NOT do
 *
 * It makes no biometric claim and no legal-validation claim. What is recorded is
 * that a document was bound to a handover in a stated role; nothing here asserts
 * that the mark in that document is a particular person's, and nothing here
 * fetches the document back.
 *
 * It computes no hash of its own. The integrity digest is taken over the bytes
 * the capture uploaded, inside `captureDocument`, and the API re-reads the object
 * and compares — a second digest computed in this file would be a second
 * authority claiming to say the same thing.
 */

const FIELD = 'signatureFile';

export interface DeliverySignatureCaptureOutcome extends DeliveryWriteState {
  /** How far the chain got. `bound` is a signature on the handover; `captured` is not. */
  readonly stage?: 'captured' | 'bound';
  readonly documentId?: string;
  readonly versionId?: string;
  /** The version state the API reported. Pending is not a failure — see below. */
  readonly versionStatus?: string;
  /** False when no store could be read, which is why a version stayed pending. */
  readonly scannerAvailable?: boolean;
}

function isSignerRole(value: string): value is SignerRole {
  return (SIGNER_ROLES as readonly string[]).includes(value);
}

/**
 * Capture one signature image and bind it to one handover.
 *
 * `FormData` rather than a typed argument, for the reason the reception capture
 * takes one: a Server Action is how a file crosses the boundary without the
 * browser ever holding a storage URL, and `FormData` is what that boundary
 * carries. Everything else is read out of it and validated before any request is
 * spent.
 *
 * The visit identifier is a parameter rather than a form field. It comes from
 * the delivery record the page already read, so it is not something a submitted
 * form gets to assert.
 */
export async function captureDeliverySignature(
  deliveryId: string,
  receptionVisitId: string,
  formData: FormData
): Promise<DeliverySignatureCaptureOutcome> {
  const signerRole = String(formData.get('signerRole') ?? '');
  if (!isSignerRole(signerRole)) {
    return { status: 'invalid', fieldErrors: { signerRole: 'form.required' }, attempt: 1 };
  }

  const file = formData.get(FIELD);
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'invalid', fieldErrors: { [FIELD]: 'attachments.capture.empty' }, attempt: 1 };
  }

  /*
   * The category is read for ONE value — the business link purpose. The link the
   * API accepts is the one the category declares, and a purpose invented here
   * would be a policy this tree does not own. A tenant whose schema predates the
   * seeded categories is a real state and is reported rather than guessed past.
   */
  const categories = await listDocumentCategories();
  if (categories.status !== 'ok') {
    return {
      status: categories.status === 'denied' ? 'denied' : 'error',
      messageKey: 'attachments.capture.categoriesUnavailable',
      correlationId: categories.correlationId,
      attempt: 1,
    };
  }
  const category = categories.data.items.find(
    (entry) => entry.categoryCode === SIGNATURE_CATEGORY_CODE
  );
  if (!category) {
    return {
      status: 'error',
      messageKey: 'attachments.capture.categoryMissing',
      correlationId: categories.correlationId,
      attempt: 1,
    };
  }

  const captured = await captureDocument({
    categoryCode: SIGNATURE_CATEGORY_CODE,
    entityType: 'rec.reception_visits',
    entityId: receptionVisitId,
    fileName: file.name,
    contentType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    capturedAt: Number.isFinite(file.lastModified)
      ? new Date(file.lastModified).toISOString()
      : null,
  });
  if (captured.status !== 'success' || !captured.registered) return captured;

  const { documentId, versionId, status: versionStatus, scannerAvailable } = captured.registered;

  const linked = await createDocumentLink(documentId, {
    entityType: 'rec.reception_visits',
    entityId: receptionVisitId,
    linkPurpose: category.businessLinkPurpose,
  });
  if (linked.status !== 'success') {
    return { ...linked, stage: 'captured', documentId, versionId, versionStatus, scannerAvailable };
  }

  /*
   * The bind. A version that is still `pending` may be bound and may not be
   * downloaded — that asymmetry is the platform's and is deliberate, because a
   * signature is taken at the moment of handover and a scan finishes when it
   * finishes. A `rejected` or `quarantined` version is refused by the delivery
   * service, which is a state check rather than an impossibility, and the
   * refusal is reported as it arrives.
   */
  const bound = await attachSignature(deliveryId, {
    signerRole,
    signatureDocumentVersionId: versionId,
  });
  if (bound.status !== 'success') {
    return { ...bound, stage: 'captured', documentId, versionId, versionStatus, scannerAvailable };
  }

  return {
    ...bound,
    stage: 'bound',
    documentId,
    versionId,
    versionStatus,
    scannerAvailable,
  };
}
