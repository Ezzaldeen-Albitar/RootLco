/**
 * The web-layer mirror of the shared document contract (`P1-15`, `P1-OD-025`).
 *
 * MOST of what is here is a copy of something the Backend governs, and copies
 * drift. `apps/web/tests/attachments-contract.test.ts` derives those and fails
 * when they move, so a vocabulary that grows a member on the Backend fails there
 * rather than reaching a screen as an unhandled case.
 *
 * This header used to say "every value", and to name `docs/api/openapi.v1.json`
 * and the operation register as the sources. Both halves were wrong. The
 * published contract carries neither these enums nor these bounds — no `enum` in
 * it contains `quarantined` or `infected`, and no `maxLength` of 400 appears —
 * and one value below mirrors no Backend authority at all, so "every value" was
 * a promise this module could not keep and the enumeration that followed it
 * quietly listed one fewer bullet than there are values. Both are corrected
 * here rather than 145 lines down, because a reader trusts the header.
 *
 * What governs each value is:
 *
 *   - the version vocabulary: `ck_document_versions_status`, a DATABASE
 *     constraint, in its latest definition (migration `20260815090000` widened
 *     it from four members to five, so this list has already moved once);
 *   - the terminal subset of that vocabulary: not a second list, but the
 *     members `shared.guard_document_version_transition` admits no transition
 *     out of;
 *   - the scan vocabulary: what `attachment-service.ts` REPORTS, which differs
 *     by one member from what the table stores — `scan_status` admits
 *     `pending` where the service reports `not_started`;
 *   - the file-name bound: the request schema the upload-authorization route
 *     really parses;
 *   - `MAX_CAPTURED_AT`: **nothing on the Backend.** The versions route parses
 *     `capturedAt` as a date, not a string, so there is no bound to mirror. It
 *     is this tree's own ceiling on the TEXT it sends, and its test checks it as
 *     a property — long enough for the instants this application produces —
 *     rather than pretending to derive it. Stated here because a value that is
 *     ours and a value that is theirs fail in different ways.
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

/**
 * The states a version can never leave.
 *
 * `shared.guard_document_version_transition` admits no transition out of either
 * of these, so a screen that offers a retry over one is offering an act that
 * cannot succeed — and, worse, is telling an operator to wait for a verdict that
 * has already been reached against them. The difference matters at exactly one
 * place in this product: a capture that stopped before its binding looks the
 * same whether the scan refused the file or the network dropped the link call,
 * and only one of those two is worth trying again.
 *
 * Derived, not decided here: the guard is the authority, and
 * `attachments-contract.test.ts` reads it.
 */
export const TERMINAL_VERSION_STATUSES: readonly DocumentVersionStatus[] = [
  'quarantined',
  'rejected',
];

/** Has the check concluded AGAINST this version, permanently? */
export function isTerminalVersion(status: string | undefined): boolean {
  return (TERMINAL_VERSION_STATUSES as readonly string[]).includes(status ?? '');
}

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

/**
 * The maximum a caller may send as a captured-at instant.
 *
 * It mirrors NO route, and the sentence here said it did. The versions route
 * parses `capturedAt` as a DATE — `z.coerce.date().nullable().optional()` — so
 * there is no string bound on the server to mirror, and the upload
 * authorization carries no captured-at field at all.
 *
 * What this is: the ceiling this tree puts on the TEXT it sends, chosen so an
 * ISO instant with milliseconds and an offset fits. `attachments-contract.test.ts`
 * checks it as that property rather than pinning it to a figure nothing else
 * states.
 */
export const MAX_CAPTURED_AT = 64;

/**
 * The file-name bound the upload-authorization route really parses.
 *
 * This cited `shared.documents.file_name` as the authority. That column does not
 * exist: a search of the whole `supabase/` tree for `file_name` returns nothing,
 * and `CREATE TABLE shared.documents` has no such field — a document carries a
 * `title`, and the NAME travels with the version.
 *
 * The real authority is the request schema:
 * `fileName: z.string().min(1).max(400)` in
 * `attachments/upload-authorizations/route.ts`, which is what
 * `attachments-contract.test.ts` now reads this value against.
 */
export const MAX_FILE_NAME = 400;
