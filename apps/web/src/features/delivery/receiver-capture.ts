'use server';

import {
  captureDocument,
  createDocumentLink,
  listDocumentCategories,
} from '@/features/attachments/api';
import { verifyReceiver, type DeliveryWriteState } from './api';
import { RECEIVER_IDENTITY_CATEGORY_CODE } from './delivery-contract';

/**
 * Verify who may collect a vehicle, with an optional identity document
 * (P1-31, FE-003, the Owner's decision D-18).
 *
 * ## The evidence is optional, and a chosen document is not
 *
 * `sal.delivery-receiver-verify` accepts an optional
 * `identityEvidenceDocumentVersionId`, and nothing here requires one: with no
 * file chosen the verification is sent exactly as it always was. Once a file IS
 * chosen, the document is part of the act. It must be captured and linked
 * before the verification is sent, and a failure at either step ends the act
 * there — the verification is never sent without the document the operator
 * chose, and never retried without it.
 *
 * ## The order is the signature capture's order
 *
 * `signature-capture.ts` is the precedent and this follows it step for step:
 * read the categories, pick the approved one by code, capture the document
 * against the reception visit the delivery closes, link it under the category's
 * OWN business-link purpose, then bind the version. The visit is a parameter
 * taken from the delivery record the page read, never a form field, and the
 * delivery service independently checks that the version is live-linked to this
 * delivery's own work order or visit.
 *
 * ## No other category is substituted
 *
 * A missing or inactive identity category with a file chosen is an explicit
 * error. The category list answers active rows only, so both states arrive as
 * the same absence, and neither is answered by filing the document elsewhere.
 *
 * ## What the outcome says
 *
 * `stage` names the step that stopped the act, so the panel can say what did
 * not happen in plain words; `withEvidence` says whether a document was part of
 * it. Neither the stored document nor its version identifier is returned to the
 * browser.
 */

const FIELD = 'identityEvidenceFile';

/** The step that ended an unsuccessful verification. */
export type ReceiverVerificationStage = 'category' | 'upload' | 'link' | 'verify';

export interface ReceiverVerificationOutcome extends DeliveryWriteState {
  readonly stage?: ReceiverVerificationStage;
  /** True when the operator chose a document, whatever became of it. */
  readonly withEvidence: boolean;
}

/**
 * One verification, with or without an identity document.
 *
 * `FormData` for the file, because a Server Action is how a file crosses the
 * boundary without the browser holding a storage URL. The partner and the visit
 * are parameters: the partner is chosen through the selector by name, and the
 * visit comes from the delivery record the page already read.
 */
export async function verifyReceiverWithEvidence(
  deliveryId: string,
  receptionVisitId: string,
  receiverPartnerId: string,
  formData: FormData
): Promise<ReceiverVerificationOutcome> {
  if (receiverPartnerId.length === 0) {
    return {
      status: 'invalid',
      fieldErrors: { receiverPartnerId: 'delivery.receiver.partnerRequired' },
      attempt: 1,
      withEvidence: false,
    };
  }

  const file = formData.get(FIELD);
  // A browser submits an empty file part when nothing was chosen: no name and
  // no bytes. That, and only that, is "no document".
  const chosen = file instanceof File && (file.name !== '' || file.size > 0);

  if (!chosen) {
    const verified = await verifyReceiver(deliveryId, { receiverPartnerId });
    return verified.status === 'success'
      ? { ...verified, withEvidence: false }
      : { ...verified, stage: 'verify', withEvidence: false };
  }

  if (file.size === 0) {
    return {
      status: 'invalid',
      fieldErrors: { [FIELD]: 'attachments.capture.empty' },
      attempt: 1,
      stage: 'upload',
      withEvidence: true,
    };
  }

  const categories = await listDocumentCategories();
  if (categories.status !== 'ok') {
    return {
      status: categories.status === 'denied' ? 'denied' : 'error',
      messageKey: 'attachments.capture.categoriesUnavailable',
      correlationId: categories.correlationId,
      attempt: 1,
      stage: 'category',
      withEvidence: true,
    };
  }
  const category = categories.data.items.find(
    (entry) => entry.categoryCode === RECEIVER_IDENTITY_CATEGORY_CODE
  );
  if (!category) {
    return {
      status: 'error',
      messageKey: 'delivery.receiver.evidenceCategoryMissing',
      correlationId: categories.correlationId,
      attempt: 1,
      stage: 'category',
      withEvidence: true,
    };
  }

  const captured = await captureDocument({
    categoryCode: RECEIVER_IDENTITY_CATEGORY_CODE,
    entityType: 'rec.reception_visits',
    entityId: receptionVisitId,
    fileName: file.name,
    contentType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    capturedAt: Number.isFinite(file.lastModified)
      ? new Date(file.lastModified).toISOString()
      : null,
  });
  if (captured.status !== 'success' || !captured.registered) {
    return {
      ...captured,
      ...(captured.status === 'success'
        ? { status: 'error', messageKey: 'delivery.receiver.evidenceUploadFailed' }
        : {}),
      stage: 'upload',
      withEvidence: true,
    };
  }

  const { documentId, versionId } = captured.registered;

  const linked = await createDocumentLink(documentId, {
    entityType: 'rec.reception_visits',
    entityId: receptionVisitId,
    linkPurpose: category.businessLinkPurpose,
  });
  if (linked.status !== 'success') {
    return { ...linked, stage: 'link', withEvidence: true };
  }

  /*
   * The bind. A pending or scanning version may be bound: refusing it would
   * lose evidence on scan latency. A rejected or quarantined version, a version
   * of another category, one not linked to this delivery's own work order or
   * visit, and one the caller cannot see are refused by the delivery service,
   * and the refusal is returned as it arrived — never answered by a second
   * verification without the document.
   */
  const verified = await verifyReceiver(deliveryId, {
    receiverPartnerId,
    identityEvidenceDocumentVersionId: versionId,
  });
  return verified.status === 'success'
    ? { ...verified, withEvidence: true }
    : { ...verified, stage: 'verify', withEvidence: true };
}
