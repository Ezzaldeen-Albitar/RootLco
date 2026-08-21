'use server';

import {
  captureDocument,
  createDocumentLink,
  listDocumentCategories,
} from '@/features/attachments/api';
import type { ActionState } from '@/lib/forms/action-result';
import { recordSignature } from './api';
import {
  SIGNATURE_PURPOSES,
  SIGNER_ROLES,
  type SignaturePurpose,
  type SignerRole,
} from './receptions-contract';

/**
 * One signature, from a chosen image to a recorded reference (`P1-28-FE-018`).
 *
 * ## Why this exists as its own act
 *
 * `rec.reception-signature` takes `signatureDocumentId` AND
 * `signatureDocumentVersionId` — both required uuids naming a registered
 * document and the EXACT version that was signed. Neither is a value an operator
 * can produce, so for as long as nothing registered a document this operation
 * was unreachable, and the step said so.
 *
 * `P1-15` built the registration chain and the Owner resolved `P1-OD-025`, so
 * the values exist now — but only at the end of a four-call sequence, and the
 * ORDER of that sequence is the contract. Driving it from a component would put
 * that order in the browser and hand the operator four separate refusals to
 * interpret. Here it is one act with one outcome.
 *
 * The file never round-trips: its bytes cross the same origin once, into this
 * Server Action, and every storage decision after that is the server's
 * (`features/attachments/api.ts` carries why the browser cannot make the PUT).
 *
 * ## The capture method is `uploaded`, and is not offered as a choice
 *
 * `SIGNATURE_CAPTURE_METHODS` admits `drawn`, `typed`, `uploaded` and
 * `biometric`. This surface takes a FILE, so exactly one of those is true of it.
 * Offering the other three in a select would be offering three capabilities the
 * product does not have and recording a claim about how a signature was taken
 * that nothing checked — so the value is fixed here, on the server, where a
 * screen cannot disagree with it. A drawn-signature surface would be a different
 * capture with its own method, and it would set its own.
 *
 * ## What this deliberately does NOT do
 *
 * It does not finalize. A signature binds an exact version, and a version is
 * finalized evidence only once it is ACCEPTED; the Owner decision says a
 * signature may stand as a draft while its evidence is pending and may never be
 * final until it is accepted. Finalizing is therefore a separate, attributable
 * act — `rec.reception-signature-event`, offered by the step only against an
 * accepted version — and not something this call slips in when the scan happens
 * to have completed in time. A capture that auto-finalized would make the
 * difference between "signed" and "signed and verified" a matter of how fast the
 * scanner was.
 *
 * It also computes no hash. `signatureHash` is optional on the input and the
 * integrity digest is the store's, recorded when the object is read back. A
 * digest computed in this tier would be a second authority claiming to say the
 * same thing.
 */

/**
 * The document category that serves a signature image.
 *
 * Seeded platform-wide (`tenant_id` NULL) by
 * `supabase/seeds/05_shared_reference.sql`, so every tenant resolves it. Not a
 * member of `CAPTURE_CATEGORY_BY_REQUIREMENT`: a signature is not a capture
 * REQUIREMENT of the visit — it is evidence of an act by a party — and it binds
 * through `rec.signatures`, never through an evidence binding.
 */
const SIGNATURE_CATEGORY = 'reception_signature';

/** The only method true of a surface that takes a file. */
const FILE_CAPTURE_METHOD = 'uploaded';

const FIELD = 'signatureFile';

export interface SignatureCaptureOutcome extends ActionState {
  /** How far the chain got. `recorded` is a signature; `captured` is not. */
  readonly stage?: 'captured' | 'recorded';
  readonly documentId?: string;
  readonly versionId?: string;
  readonly signatureId?: string;
  /** The version state the API reported. `pending` is not a failure. */
  readonly versionStatus?: string;
  /** False when no store could be read, which is why a version stayed pending. */
  readonly scannerAvailable?: boolean;
}

function isSignerRole(value: string): value is SignerRole {
  return (SIGNER_ROLES as readonly string[]).includes(value);
}

function isPurpose(value: string): value is SignaturePurpose {
  return (SIGNATURE_PURPOSES as readonly string[]).includes(value);
}

/**
 * Capture one signature image against one visit.
 *
 * `FormData` rather than a typed argument for the same reason the evidence
 * capture takes one: a Server Action is how a file crosses the boundary without
 * the browser ever holding a storage URL, and `FormData` is what that boundary
 * carries. Everything else is read out of it and validated before anything is
 * spent.
 */
export async function captureSignatureEvidence(
  receptionId: string,
  formData: FormData
): Promise<SignatureCaptureOutcome> {
  const signerRole = String(formData.get('signerRole') ?? '');
  const purpose = String(formData.get('purpose') ?? '');
  const signerPartnerId = String(formData.get('signerPartnerId') ?? '');

  if (!isSignerRole(signerRole)) {
    return { status: 'invalid', fieldErrors: { signerRole: 'form.required' }, attempt: 1 };
  }
  if (!isPurpose(purpose)) {
    return { status: 'invalid', fieldErrors: { purpose: 'form.required' }, attempt: 1 };
  }

  const file = formData.get(FIELD);
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'invalid', fieldErrors: { [FIELD]: 'attachments.capture.empty' }, attempt: 1 };
  }

  /*
   * The category is read for ONE value — `businessLinkPurpose`. The link the API
   * accepts is the one the category declares, and a purpose invented here would
   * be a policy this tree does not own. A tenant whose schema predates the
   * seeded categories is a real state and is reported rather than guessed past.
   */
  const categories = await listDocumentCategories();
  if (categories.status !== 'ok' || categories.data === null) {
    return {
      status: categories.status === 'denied' ? 'denied' : 'error',
      messageKey: 'attachments.capture.categoriesUnavailable',
      correlationId: categories.correlationId ?? null,
      attempt: 1,
    };
  }
  const category = categories.data.items.find((entry) => entry.categoryCode === SIGNATURE_CATEGORY);
  if (!category) {
    return {
      status: 'error',
      messageKey: 'attachments.capture.categoryMissing',
      correlationId: categories.correlationId ?? null,
      attempt: 1,
    };
  }

  const captured = await captureDocument({
    categoryCode: SIGNATURE_CATEGORY,
    entityType: 'rec.reception_visits',
    entityId: receptionId,
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
    entityId: receptionId,
    linkPurpose: category.businessLinkPurpose,
  });
  if (linked.status !== 'success') {
    return { ...linked, stage: 'captured', documentId, versionId, versionStatus, scannerAvailable };
  }

  const recorded = await recordSignature(receptionId, {
    signerRole,
    purpose,
    captureMethod: FILE_CAPTURE_METHOD,
    signatureDocumentId: documentId,
    signatureDocumentVersionId: versionId,
    ...(signerPartnerId === '' ? {} : { signerPartnerId }),
  });
  if (recorded.status !== 'success' || !recorded.recorded) {
    return {
      ...recorded,
      stage: 'captured',
      documentId,
      versionId,
      versionStatus,
      scannerAvailable,
    };
  }

  /*
   * A signature, recorded. NOT final — see the docblock: finalization is a
   * separate act against an accepted version, and the step offers it only when
   * the version reached that state.
   */
  return {
    status: 'success',
    correlationId: recorded.correlationId ?? null,
    attempt: 1,
    stage: 'recorded',
    documentId,
    versionId,
    signatureId: recorded.recorded.signatureId,
    versionStatus,
    scannerAvailable,
  };
}
