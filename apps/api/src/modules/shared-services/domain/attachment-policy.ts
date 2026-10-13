/**
 * Attachment allow-lists and the upload token (P1-15).
 *
 * ## Entity types and link purposes are allow-lists, not free text
 *
 * `ck_document_links_entity_type_format` only constrains the *shape*
 * (`schema.table`), because Phase 1-5 had no cross-domain foreign key to check
 * against. The application therefore carries the list, and every entry names a
 * table that exists in protected schema — asserted against `information_schema`
 * by `tests/db/p1-15-attachments.test.ts`, so an entry cannot drift from the
 * database.
 *
 * Without the list, `entity_type` would accept `zz.anything`, and the
 * link-derived access contract — reachability flows through a live link — would
 * be reachable from an entity nobody models.
 *
 * ## The upload token is deliberately NOT a security boundary
 *
 * It is base64url JSON: opaque to a client, unsigned, and re-validated field by
 * field at registration. That is stated here rather than implied, because the
 * word "token" invites the opposite assumption.
 *
 * It can be forged. Forging it achieves nothing:
 *
 *  - the document is re-loaded **under RLS**, so a forged `documentId` for
 *    another tenant resolves to nothing;
 *  - the storage key is **re-derived** from the environment, the session tenant,
 *    and the token's document/version ids, and must equal the derived value — a
 *    caller cannot name a key;
 *  - the content type is re-checked against the category allow-list and the size
 *    against both the category ceiling and the platform ceiling;
 *  - the expiry is re-checked.
 *
 * So the token carries *convenience* (what the client was told to upload),
 * never *authority*. Signing it would need a key shared across instances, and no
 * key management is provisioned — recorded as an open decision rather than
 * half-built.
 */
import { AppFailure } from '@/server/errors/app-failure';

/** Business entities a document may be linked to. Each names a real table. */
export const LINKABLE_ENTITY_TYPES: readonly string[] = Object.freeze([
  'apt.appointments',
  'crm.business_partners',
  'org.legal_companies',
  'quo.quotations',
  'rec.damage_map_templates',
  'rec.reception_visits',
  'sal.invoices',
  'veh.vehicles',
  'wo.work_orders',
]);

/** Why a document is attached to an entity. Matches `ck_document_links_purpose_format`. */
export const LINK_PURPOSES: readonly string[] = Object.freeze([
  'attachment',
  'evidence',
  'identity_document',
  'inspection_media',
  'issued_document',
  'signature',
  'supporting_report',
]);

export function isLinkableEntityType(value: string): boolean {
  return LINKABLE_ENTITY_TYPES.includes(value);
}

/** A relation an allow-listed entity type names, split for a qualified reference. */
export interface LinkedEntityRelation {
  readonly schema: string;
  readonly table: string;
}

/**
 * Lower-case SQL identifier. Every schema and table in this repository is written
 * this way, and anything else is refused rather than quoted around.
 */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * The relation an entity type names, or `null` when it names none.
 *
 * ## Why this is derived and not a second table
 *
 * Each {@link LINKABLE_ENTITY_TYPES} entry already *is* `schema.table`, and
 * `tests/db/p1-15-attachments.test.ts` asserts against `information_schema` that
 * every entry names a base table that exists. A hand-written map from token to
 * relation would be a second list that could disagree with the first; deriving
 * the relation from the token cannot.
 *
 * ## Why it fails closed
 *
 * The result is used to build a qualified relation reference, so the allow-list
 * membership test is the whole of the safety argument and the identifier shape is
 * re-checked on top of it. A token that is not allow-listed, or whose halves are
 * not plain lower-case identifiers, returns `null`, and a caller that cannot name
 * a relation must treat the entity as unreachable rather than as reachable.
 *
 * `veh.vehicles` is the only token the link write accepts for a vehicle. The
 * vehicle module's own read passes `veh.vehicle` (recorded as `RMC-04`); that
 * token is not in the allow-list, so no link can ever carry it, and this function
 * does not add it. Which tokens a link may be created with is unchanged here.
 */
export function linkedEntityRelation(entityType: string): LinkedEntityRelation | null {
  if (!isLinkableEntityType(entityType)) return null;
  const separator = entityType.indexOf('.');
  if (separator <= 0) return null;
  const schema = entityType.slice(0, separator);
  const table = entityType.slice(separator + 1);
  if (!SAFE_IDENTIFIER.test(schema) || !SAFE_IDENTIFIER.test(table)) return null;
  return { schema, table };
}

export function isLinkPurpose(value: string): boolean {
  return LINK_PURPOSES.includes(value);
}

/** Version states a download may be issued for. Acceptance is the only one. */
export const DOWNLOADABLE_STATES: readonly string[] = Object.freeze(['accepted']);

/**
 * Version states a document may NOT be bound as evidence in.
 *
 * ## Why it lives here
 *
 * The rule is about `shared.document_versions.status`, which is this module's
 * column, so this module is where the sentence belongs. It sat as an identical
 * `Object.freeze(['rejected', 'quarantined'])` literal in BOTH
 * `diagnostics/application/diagnostic-report-service.ts` and
 * `work-order/application/additional-work-service.ts`, and PRE-P1-29-BR-07 would
 * have made a third copy. Two copies of a rule can disagree; three reliably do.
 *
 * ## It is deliberately NOT the complement of DOWNLOADABLE_STATES
 *
 * The two constants sit together so the asymmetry is visible rather than
 * surprising. `DOWNLOADABLE_STATES` is `['accepted']` — download demands a
 * finished, clean scan. Binding refuses only `rejected` and `quarantined`, which
 * means **`pending` may be bound while it may not be downloaded.**
 *
 * That gap is intentional and must not be closed. Capture happens at the moment
 * work is done, and a scan takes as long as it takes; refusing `pending` at bind
 * time would make evidence capture fail intermittently on scan latency, losing
 * the photograph rather than delaying it. The protection is preserved where it
 * matters — the bytes still cannot be fetched until the scan accepts them.
 */
export const EVIDENCE_REFUSED_STATES: readonly string[] = Object.freeze([
  'rejected',
  'quarantined',
]);

export interface UploadTokenPayload {
  /** Token format version, so a later change is detectable rather than silent. */
  readonly v: 1;
  readonly documentId: string;
  readonly versionId: string;
  readonly contentType: string;
  /** Ceiling the client was told; re-checked server-side at registration. */
  readonly maxBytes: number;
  /** Epoch seconds. Re-checked server-side. */
  readonly exp: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_TYPE = /^[a-z0-9]+\/[a-z0-9][a-z0-9.+-]*$/;

export function encodeUploadToken(payload: UploadTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decodes an upload token into a *claim*, never into a decision.
 *
 * Shape errors are reported as validation failures: a malformed token is a
 * client defect, and the caller can fix it by re-requesting authorization.
 */
export function decodeUploadToken(encoded: string): UploadTokenPayload {
  const reject = (rule: string): never => {
    throw new AppFailure('ERR-VAL-001', {
      message: 'Upload token is not decodable',
      safeDetails: { violations: [{ path: 'body.uploadToken', rule }] },
    });
  };

  if (encoded.length === 0 || encoded.length > 1024) reject('invalid_length');

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return reject('malformed');
  }
  if (typeof parsed !== 'object' || parsed === null) return reject('malformed');

  const candidate = parsed as Partial<UploadTokenPayload>;
  if (candidate.v !== 1) return reject('unsupported_version');
  if (typeof candidate.documentId !== 'string' || !UUID.test(candidate.documentId)) {
    return reject('invalid_document');
  }
  if (typeof candidate.versionId !== 'string' || !UUID.test(candidate.versionId)) {
    return reject('invalid_version');
  }
  if (typeof candidate.contentType !== 'string' || !CONTENT_TYPE.test(candidate.contentType)) {
    return reject('invalid_content_type');
  }
  if (
    typeof candidate.maxBytes !== 'number' ||
    !Number.isInteger(candidate.maxBytes) ||
    candidate.maxBytes < 1
  ) {
    return reject('invalid_max_bytes');
  }
  if (typeof candidate.exp !== 'number' || !Number.isFinite(candidate.exp)) {
    return reject('invalid_expiry');
  }

  return {
    v: 1,
    documentId: candidate.documentId.toLowerCase(),
    versionId: candidate.versionId.toLowerCase(),
    contentType: candidate.contentType,
    maxBytes: candidate.maxBytes,
    exp: candidate.exp,
  };
}

/** SHA-256 hex, exactly 64 lower-case hex characters (`ck_document_versions_sha256_len`). */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * True when the declared content type is inside the category's allow-list.
 *
 * The client's declared type is never trusted as a *fact* about the bytes —
 * nothing here reads the bytes, and no byte-level sniffing is claimed. It is
 * trusted only as a *request*, and the allow-list bounds what may be requested.
 * Verifying that the stored object matches its declared type belongs to whatever
 * scans it, which is the same missing component as the malware scanner.
 */
export function contentTypeAllowed(declared: string, allowed: readonly string[]): boolean {
  if (!CONTENT_TYPE.test(declared)) return false;
  return allowed.includes(declared);
}
