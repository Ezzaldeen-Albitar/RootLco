/**
 * The web-layer mirror of the shared document contract (`P1-15`, `P1-OD-025`).
 *
 * Every value here is a copy of something the API publishes, and copies drift.
 * `apps/web/tests/attachments-contract.test.ts` derives each one from
 * `docs/api/openapi.v1.json` and the operation register, so a vocabulary that
 * grows a member on the Backend fails here rather than reaching a screen as an
 * unhandled case.
 *
 * ## The lifecycle, and why only one state is evidence
 *
 * A document accumulates immutable VERSIONS. A version is registered `pending`,
 * enters `scanning`, and reaches `accepted` only with an exclusively clean scan;
 * `quarantined` and `rejected` are terminal and unreachable-from. The rule lives
 * in `shared.guard_document_version_transition`, not here — this module cannot
 * enforce it and does not pretend to. What it does is stop a screen from
 * treating a pending version as evidence, which is the Owner decision every
 * consumer of this contract has to respect.
 */

/**
 * Every state a version can hold. `ck_document_versions_status` admits exactly
 * these, plus `scanning`, which migration 121 added.
 */
export const DOCUMENT_VERSION_STATUSES = [
  'pending',
  'scanning',
  'accepted',
  'quarantined',
  'rejected',
] as const;
export type DocumentVersionStatus = (typeof DOCUMENT_VERSION_STATUSES)[number];

/**
 * The ONE state that is finalized evidence.
 *
 * Named as a constant rather than written as a literal at each call site: the
 * Owner decision is "only an accepted version is finalized evidence", and a rule
 * spelled out four times is a rule that can be relaxed in three of them.
 */
export const ACCEPTED_VERSION_STATUS = 'accepted';

/** What the scanner concluded, as `registerVersionAndScan` reports it. */
export const SCAN_OUTCOMES = ['not_started', 'clean', 'infected', 'error'] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

/** One governed category, exactly as `shared.document-category-list` answers. */
export interface DocumentCategory {
  readonly categoryCode: string;
  /**
   * The content types this category admits — the SERVER's list.
   *
   * Rendered and enforced from this value and never from a constant. A
   * "sensible default" of JPEG and PNG in the browser is a media policy the
   * Owner has not decided, presented to an operator as though it had been, and
   * `no-invented-media-limit` fails the build over it.
   */
  readonly allowedContentTypes: readonly string[];
  /** The size ceiling, likewise the server's. */
  readonly maxBytes: number;
  readonly retentionClass: string;
  readonly classification: string;
  /** The business-link purpose a document in this category may be linked under. */
  readonly businessLinkPurpose: string;
  readonly deviceCaptureTimestampRequired: boolean;
}

/** One immutable version, as `shared.document-version-read` answers. */
export interface DocumentVersion {
  readonly versionId: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly contentType: string;
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly status: string;
  readonly capturedAt: string | null;
  readonly uploadedAt: string;
  readonly scanningAt: string | null;
  readonly acceptedAt: string | null;
  readonly quarantinedAt: string | null;
  readonly rejectedAt: string | null;
  readonly scanVerdicts: readonly string[];
}

/** What `shared.attachment-version-register` answers. */
export interface RegisteredVersion {
  readonly documentId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly status: string;
  /**
   * Whether a scanner could read the object back at all.
   *
   * `false` is not a failure and is not an error state: it is what an
   * unconfigured or unreadable provider honestly produces, and the version stays
   * `pending` for ever. A screen that renders this as "scan pending" would be
   * promising an outcome that is not coming.
   */
  readonly scannerAvailable: boolean;
  readonly scanStatus: string;
}

/**
 * Is this version usable as finalized evidence?
 *
 * The one predicate every consumer shares. `rec.guard_signature_evidence` and
 * `rec.guard_reception_evidence_binding` decide it for real, inside the write;
 * this is what lets a screen decline to OFFER a finalization the database would
 * refuse, which is a better experience and not a substitute for the guard.
 */
export function isFinalizedEvidence(version: { readonly status: string }): boolean {
  return version.status === ACCEPTED_VERSION_STATUS;
}

/**
 * Is the version still on its way somewhere, or has it stopped?
 *
 * `pending` with no scanner available has STOPPED, which is why this takes the
 * whole registration rather than a status string: the two look identical in the
 * status column and mean opposite things to an operator deciding whether to wait.
 */
export function isSettled(registered: {
  readonly status: string;
  readonly scannerAvailable: boolean;
}): boolean {
  if (registered.status === 'pending') return !registered.scannerAvailable;
  return registered.status !== 'scanning';
}

/** The maximum a caller may send as a captured-at instant. Mirrors the route. */
export const MAX_CAPTURED_AT = 64;

/** `shared.documents.file_name`, per `attachments/upload-authorizations`. */
export const MAX_FILE_NAME = 400;
