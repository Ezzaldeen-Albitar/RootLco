'use server';

import {
  captureDocument,
  createDocumentLink,
  listDocumentCategories,
} from '@/features/attachments/api';
import { ACCEPTED_VERSION_STATUS } from '@/features/attachments/attachments-contract';
import type { ActionState } from '@/lib/forms/action-result';
import { bindEvidence, finalizeEvidenceBinding } from './api';
import {
  CAPTURE_CATEGORY_BY_REQUIREMENT,
  CAPTURE_REQUIREMENTS,
  type CaptureRequirement,
} from './receptions-contract';

/**
 * One capture, from a chosen file to finalized evidence (`P1-28-FE-017`).
 *
 * ## Why this is one action and not five calls from a screen
 *
 * A capture is five operations — authorize, store, register, link, bind — and
 * finalize is a sixth. Driving them from a component would put the ORDER in the
 * browser, and the order is the contract: a binding that names a version the
 * store never received, or a finalization of a version that is not accepted, are
 * both refusals the operator would meet one at a time with no way to tell which
 * step went wrong. Here they are one act with one outcome, and a partial result
 * is reported as what it is.
 *
 * It also means the FILE never round-trips. The browser hands its bytes to this
 * Server Action once; everything after that happens server-side, including the
 * object PUT (`features/attachments/api.ts` carries why the browser cannot make
 * it).
 *
 * ## The category is DERIVED from the requirement, never chosen
 *
 * `rec.guard_reception_evidence_binding()` decides which category may satisfy
 * which requirement, and `CAPTURE_CATEGORY_BY_REQUIREMENT` is this layer's copy
 * of that mapping. An operator photographing a VIN plate does not pick a
 * document category — there is exactly one that can satisfy `vin`, and offering
 * a choice would be offering a way to be refused.
 *
 * The LINK purpose is not derived here at all: it comes from the category the
 * server published, so a purpose this tree invented could never reach the API.
 *
 * ## Finalization is attempted, not assumed
 *
 * A version reaches `accepted` in the same request when a readable store and a
 * clean scan allow it, and stays `pending` when they do not. Only an accepted
 * version may be finalized, so this attempts it exactly when the registration
 * says so and otherwise returns `bound` — which is the truthful state, and the
 * one the screen tells the operator about instead of claiming the requirement is
 * met.
 */
export interface CaptureOutcome extends ActionState {
  /** What the visit now holds, as far as this call got. */
  readonly stage?: 'captured' | 'bound' | 'finalized';
  readonly documentId?: string;
  readonly versionId?: string;
  readonly bindingId?: string;
  /** The version state the API reported. `pending` is not a failure. */
  readonly versionStatus?: string;
  /** False when no store could be read, which is why a version stayed pending. */
  readonly scannerAvailable?: boolean;
}

const FIELD = 'evidenceFile';

function isRequirement(value: string): value is CaptureRequirement {
  return (CAPTURE_REQUIREMENTS as readonly string[]).includes(value);
}

/**
 * Capture one file against one requirement of one visit.
 *
 * `formData` rather than a typed argument because a Server Action is the only
 * way a file crosses from the browser without the browser holding a storage
 * URL, and `FormData` is what that boundary carries. Everything else is read
 * out of it and validated before anything is spent.
 */
export async function captureRequirementEvidence(
  receptionId: string,
  requirementCode: string,
  formData: FormData
): Promise<CaptureOutcome> {
  if (!isRequirement(requirementCode)) {
    return { status: 'invalid', fieldErrors: { requirementCode: 'form.invalid' }, attempt: 1 };
  }

  const file = formData.get(FIELD);
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'invalid', fieldErrors: { [FIELD]: 'attachments.capture.empty' }, attempt: 1 };
  }

  const categoryCode = CAPTURE_CATEGORY_BY_REQUIREMENT[requirementCode];

  /*
   * The category is read, not assumed, for ONE value: `businessLinkPurpose`.
   * The link the API accepts is the one the category declares, and a purpose
   * invented here would be a policy this tree does not own. A category the
   * server does not publish is a real state — a tenant on an older schema — and
   * is reported rather than guessed past.
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
  const category = categories.data.items.find((entry) => entry.categoryCode === categoryCode);
  if (!category) {
    return {
      status: 'error',
      messageKey: 'attachments.capture.categoryMissing',
      correlationId: categories.correlationId ?? null,
      attempt: 1,
    };
  }

  const captured = await captureDocument({
    categoryCode,
    entityType: 'rec.reception_visits',
    entityId: receptionId,
    fileName: file.name,
    contentType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    // What the browser says the file was modified at, offered as the device's
    // claim and never as a fact. The API records it beside its own `uploaded_at`.
    capturedAt: Number.isFinite(file.lastModified)
      ? new Date(file.lastModified).toISOString()
      : null,
  });
  if (captured.status !== 'success' || !captured.registered) return captured;

  const { documentId, versionId, status: versionStatus, scannerAvailable } = captured.registered;

  /*
   * The link is what makes this document reachable from the VISIT rather than
   * from a document id nobody holds. Its failure does not undo the capture — the
   * version exists and is real — so it is reported with the stage reached.
   */
  const linked = await createDocumentLink(documentId, {
    entityType: 'rec.reception_visits',
    entityId: receptionId,
    linkPurpose: category.businessLinkPurpose,
  });
  if (linked.status !== 'success') {
    return { ...linked, stage: 'captured', documentId, versionId, versionStatus, scannerAvailable };
  }

  const bound = await bindEvidence(receptionId, {
    requirementCode,
    documentId,
    documentVersionId: versionId,
    ...(category.deviceCaptureTimestampRequired && Number.isFinite(file.lastModified)
      ? { deviceCapturedAt: new Date(file.lastModified).toISOString() }
      : {}),
  });
  if (bound.status !== 'success' || !bound.recorded) {
    return { ...bound, stage: 'captured', documentId, versionId, versionStatus, scannerAvailable };
  }

  const bindingId = bound.recorded.bindingId;
  if (versionStatus !== ACCEPTED_VERSION_STATUS) {
    // Bound and honest. The requirement is NOT met, and the screen says which of
    // the two reasons applies rather than showing a tick.
    return {
      status: 'success',
      correlationId: bound.correlationId ?? null,
      attempt: 1,
      stage: 'bound',
      documentId,
      versionId,
      bindingId,
      versionStatus,
      scannerAvailable,
    };
  }

  const finalized = await finalizeEvidenceBinding(receptionId, bindingId);
  if (finalized.status !== 'success') {
    return {
      ...finalized,
      stage: 'bound',
      documentId,
      versionId,
      bindingId,
      versionStatus,
      scannerAvailable,
    };
  }

  return {
    status: 'success',
    correlationId: finalized.correlationId ?? null,
    attempt: 1,
    stage: 'finalized',
    documentId,
    versionId,
    bindingId,
    versionStatus,
    scannerAvailable,
  };
}
