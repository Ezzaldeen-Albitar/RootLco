/**
 * Attachment lifecycle — the P1-13 `FileService` implementation (P1-15).
 *
 * The interface is frozen: `authorizeUpload`, `registerVersion`,
 * `requestDownload`, with exactly the P1-13 signatures. Nothing here changes
 * one. The signed **upload URL** is not in the frozen `UploadAuthorization`
 * shape, so it is returned by an *additional* method (`authorizeUploadDetailed`)
 * that the frozen method delegates to and narrows — adding a capability without
 * altering a contract other phases already compile against.
 *
 * ## What this phase can and cannot do, and why
 *
 * `app_runtime` holds INSERT on documents, versions, and links; **UPDATE only on
 * `document_versions.status` (pending → rejected) and `document_links.deleted_at`**;
 * and **no UPDATE at all on `shared.documents`**. So P1-15 delivers creation,
 * upload authorization, version registration, linking, unlinking, rejection, and
 * download authorization — and *not* renaming, re-classification, archival, or
 * acceptance.
 *
 * **Acceptance is unavailable, and that is a scanner problem, not an oversight.**
 * `shared.guard_document_version_transition()` accepts a version only when a
 * `clean` row exists in `shared.file_scan_results`, and **no application role may
 * write that table** (DBCR-P1-15-001 withheld it deliberately). No scanner
 * exists in this phase, none is implemented here, and no code path fabricates a
 * verdict. A download of a non-accepted version is refused with `ERR-DOC-001`.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import { log } from '@/server/observability/logger';
import { metrics, METRICS } from '@/server/observability/metrics';
import { backendConfig } from '@/server/config/backend-config';
import type {
  AuthorizeUploadInput,
  DownloadGrant,
  DownloadRequestInput,
  FileService,
  RegisteredVersion,
  RegisterVersionInput,
  UploadAuthorization,
} from '@/server/contracts/file-service';
import { DocumentRepository } from '../data/document-repository';
import {
  contentTypeAllowed,
  decodeUploadToken,
  DOWNLOADABLE_STATES,
  encodeUploadToken,
  isLinkableEntityType,
  isLinkPurpose,
  SHA256_HEX,
} from '../domain/attachment-policy';
import {
  buildStorageKey,
  keyBelongsToTenant,
  safeContentDispositionFilename,
  safeStoredFileName,
  type StorageEnvironment,
} from '../domain/storage-key';
import {
  storageProvider,
  storageProviderCanRead,
  StorageProviderError,
  type SignedUrl,
} from '../provider/storage-provider';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** `UploadAuthorization` plus the signed URL the frozen shape has no field for. */
export interface DetailedUploadAuthorization extends UploadAuthorization {
  readonly uploadUrl: string;
  readonly method: 'PUT';
  readonly contentType: string;
  readonly maxBytes: number;
  readonly documentId: string;
}

export interface LinkDocumentInput {
  readonly documentId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly linkPurpose: string;
}

export interface RegisterAndScanInput extends RegisterVersionInput {
  readonly capturedAt: Date | null;
}

export interface RegisteredAndScannedVersion extends RegisteredVersion {
  readonly status: 'pending' | 'accepted' | 'quarantined';
  readonly scannerAvailable: boolean;
  readonly scanStatus: 'not_started' | 'clean' | 'infected' | 'error';
}

export interface DocumentCategoryView {
  readonly categoryCode: string;
  readonly allowedContentTypes: readonly string[];
  readonly maxBytes: number;
  readonly retentionClass: string;
  readonly classification: string;
  readonly businessLinkPurpose: string;
  readonly deviceCaptureTimestampRequired: boolean;
}

export interface DocumentVersionView {
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

function newUuid(): string {
  return crypto.randomUUID();
}

const EICAR = Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE', 'ascii');

function containsEicar(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).includes(EICAR);
}

/** Content types this scanner is able to decode. Anything else it cannot clear. */
const DECODABLE_CONTENT_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * The scanner could not reach a verdict, and WHY.
 *
 * Distinguished from a storage failure deliberately. Both end in `error` and
 * therefore in quarantine, but the reason is written into an append-only scan
 * record that is audit evidence: the first draft caught every failure in one
 * block and recorded `provider_read: false` for an image that decoded badly,
 * which is a false fact about the storage layer preserved forever.
 */
class ScanUnavailableError extends Error {
  public override readonly name = 'ScanUnavailableError';
  constructor(public readonly reason: string) {
    super(reason);
  }
}

/**
 * Latest a device capture instant may claim to be, in milliseconds.
 *
 * A capture timestamp is device-supplied, so it is business data, not evidence
 * of anything on its own — but a value the server accepts unchecked is worse
 * than one it refuses: `z.coerce.date()` turns `"0"` into 1970 and accepts any
 * future instant, and a reception photo stamped next year would be recorded as
 * fact on an immutable row nothing can correct. The skew allows for an
 * unsynchronised tablet clock; the floor is the earliest instant a digital
 * capture could plausibly carry.
 */
const CAPTURE_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const CAPTURE_EARLIEST_MS = Date.UTC(2000, 0, 1);

async function validateOperationalImage(bytes: Uint8Array): Promise<{
  contentType: string;
  width: number;
  height: number;
}> {
  const image = sharp(Buffer.from(bytes), {
    failOn: 'warning',
    limitInputPixels: 25_000_000,
    sequentialRead: true,
  });
  const metadata = await image.metadata();
  const contentType =
    metadata.format === 'jpeg'
      ? 'image/jpeg'
      : metadata.format === 'png'
        ? 'image/png'
        : metadata.format === 'webp'
          ? 'image/webp'
          : null;
  if (
    contentType === null ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > 10_000 ||
    metadata.height > 10_000
  ) {
    throw new ScanUnavailableError('unsupported_or_unsafe_image');
  }
  // Metadata parsing alone accepts truncated/polyglot inputs. A full decode is
  // required before a clean verdict, with the same pixel/resource bounds.
  await image.toBuffer();
  return { contentType, width: metadata.width, height: metadata.height };
}

/**
 * `validateOperationalImage` with every failure normalised to one type.
 *
 * `sharp` throws its own errors for a corrupt, truncated or hostile file, and
 * those are exactly the inputs this exists to catch. Left unnormalised they
 * fall into the generic branch and are recorded as a scanner fault, which
 * blames the scanner for a file that was in fact rejected on purpose.
 */
async function decodeOrFail(
  bytes: Uint8Array
): Promise<{ contentType: string; width: number; height: number }> {
  try {
    return await validateOperationalImage(bytes);
  } catch (error) {
    if (error instanceof ScanUnavailableError) throw error;
    throw new ScanUnavailableError('image_decode_failed');
  }
}

/** A document version after rejection. The status is fixed by the operation. */
export interface VersionRejected {
  readonly versionId: string;
  readonly status: 'rejected';
}

/** The link between a document and a business entity, created or withdrawn. */
export interface DocumentLinkRef {
  readonly linkId: string;
}
export class AttachmentService extends ApplicationService implements FileService {
  protected readonly module = 'shared-services';

  constructor(private readonly documents: DocumentRepository) {
    super();
  }

  // -------------------------------------------------------------------------
  // Frozen FileService surface
  // -------------------------------------------------------------------------

  async listCategories(db: DbHandle): Promise<readonly DocumentCategoryView[]> {
    return (await this.documents.listActiveCategories(db)).map((row) => ({
      categoryCode: row.category_code,
      allowedContentTypes: row.allowed_content_types,
      maxBytes: Number(row.max_size_bytes),
      retentionClass: row.default_retention_class,
      classification: row.default_classification,
      businessLinkPurpose: row.business_link_purpose,
      deviceCaptureTimestampRequired: row.device_capture_timestamp_required,
    }));
  }

  async readVersion(db: DbHandle, versionId: string): Promise<DocumentVersionView> {
    const row = await this.documents.findVersion(db, versionId);
    if (!row) {
      throw new AppFailure('ERR-RES-001', { message: 'Version not found in the caller scope' });
    }
    const instant = (value: Date | null): string | null => value?.toISOString() ?? null;
    return {
      versionId: row.id,
      documentId: row.document_id,
      versionNumber: row.version_number,
      contentType: row.content_type,
      byteSize: Number(row.size_bytes),
      checksumSha256: row.sha256_hex,
      status: row.status,
      capturedAt: instant(row.captured_at),
      uploadedAt: row.uploaded_at.toISOString(),
      scanningAt: instant(row.scanning_at),
      acceptedAt: instant(row.accepted_at),
      quarantinedAt: instant(row.quarantined_at),
      rejectedAt: instant(row.rejected_at),
      scanVerdicts: await this.documents.scanVerdicts(db, versionId),
    };
  }

  async authorizeUpload(db: DbHandle, input: AuthorizeUploadInput): Promise<UploadAuthorization> {
    const detailed = await this.authorizeUploadDetailed(db, input);
    return {
      uploadToken: detailed.uploadToken,
      storageKey: detailed.storageKey,
      expiresAt: detailed.expiresAt,
    };
  }

  /**
   * Creates document metadata, reserves a storage key, and signs an upload URL.
   *
   * All of it in one transaction: a document row without a reserved key is an
   * orphan, and a signed URL for a document that was rolled back is a capability
   * pointing at a key nothing will ever reference.
   */
  async authorizeUploadDetailed(
    db: DbHandle,
    input: AuthorizeUploadInput
  ): Promise<DetailedUploadAuthorization> {
    const config = backendConfig();
    const context = this.contextOf(db);

    if (!isLinkableEntityType(input.entityType)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Entity type is not linkable',
        safeDetails: { violations: [{ path: 'body.entityType', rule: 'unknown_entity_type' }] },
      });
    }

    const category = await this.documents.findCategoryByCode(db, input.categoryCode);
    if (!category || category.status !== 'active') {
      throw new AppFailure('ERR-RES-001', { message: 'Document category not found or disabled' });
    }
    if (!contentTypeAllowed(input.contentType, category.allowed_content_types)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Content type is not permitted for this category',
        safeDetails: {
          violations: [{ path: 'body.contentType', rule: 'content_type_not_allowed' }],
        },
      });
    }

    // Two ceilings, both applied. The category is the governed limit; the
    // platform value is a hard cap that a mis-configured category cannot exceed.
    const categoryCeiling = Number(category.max_size_bytes);
    const ceiling = Math.min(categoryCeiling, config.STORAGE_MAX_UPLOAD_BYTES);
    if (!Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > ceiling) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Declared size is outside the permitted range for this category',
        safeDetails: { violations: [{ path: 'body.byteSize', rule: 'size_out_of_range' }] },
      });
    }

    const documentId = newUuid();
    const versionId = newUuid();
    const storageKey = buildStorageKey({
      environment: config.NEXT_PUBLIC_APP_ENV as StorageEnvironment,
      tenantId: context.principal.tenantId,
      documentId,
      versionId,
    });

    const title = safeStoredFileName(input.fileName);
    const created = await this.documents.insertDocument(db, {
      id: documentId,
      categoryId: category.id,
      title,
      classification: category.default_classification,
      retentionClass: category.default_retention_class,
      // Scope comes from the resolved context, never from the request. An empty
      // narrowing means tenant scope, which the columns express as NULL.
      companyId: context.companyIds[0] ?? null,
      branchId: context.companyIds[0] ? (context.branchIds[0] ?? null) : null,
    });
    if (!created) {
      // The INSERT policy refused it: the caller lacks `shared.document.manage`
      // in the resolved scope. Reported as the uniform authorization denial.
      throw new AppFailure('ERR-IAM-001', { message: 'Document creation was refused by policy' });
    }

    const ttl = config.STORAGE_UPLOAD_URL_TTL_SECONDS;
    const signed = await this.sign(() =>
      storageProvider().signUpload({
        storageKey,
        expiresInSeconds: ttl,
        contentType: input.contentType,
        contentLength: input.byteSize,
      })
    );

    await appendAudit(db, {
      action: 'shared.document.upload_authorized',
      entityType: 'shared.document',
      entityId: documentId,
      details: [
        { field: 'category_code', classification: 'public', value: category.category_code },
        { field: 'content_type', classification: 'public', value: input.contentType },
        { field: 'byte_size', classification: 'internal', value: String(input.byteSize) },
        { field: 'entity_type', classification: 'internal', value: input.entityType },
        // The storage key is NOT audited. It is a locator that travels outside
        // RLS in every downstream system, and the audit record is one of them.
        { field: 'storage_key_issued', classification: 'internal', value: 'true' },
      ],
    });

    metrics().increment(METRICS.attachmentAuthorizationCount, {
      purpose: 'upload',
      result: 'success',
    });
    this.logIssuance(db, 'upload', ttl);

    return {
      uploadToken: encodeUploadToken({
        v: 1,
        documentId,
        versionId,
        contentType: input.contentType,
        maxBytes: ceiling,
        exp: Math.floor(signed.expiresAt.getTime() / 1000),
      }),
      storageKey,
      expiresAt: signed.expiresAt,
      uploadUrl: signed.url,
      method: 'PUT',
      contentType: input.contentType,
      maxBytes: ceiling,
      documentId,
    };
  }

  /**
   * Registers the uploaded object as a pending version.
   *
   * Every field of the token is re-derived or re-checked here; see
   * `domain/attachment-policy.ts` for why the token carries no authority.
   */
  async registerVersion(db: DbHandle, input: RegisterVersionInput): Promise<RegisteredVersion> {
    return this.registerPendingVersion(db, input, null);
  }

  private async registerPendingVersion(
    db: DbHandle,
    input: RegisterVersionInput,
    capturedAt: Date | null
  ): Promise<RegisteredVersion> {
    const config = backendConfig();
    const context = this.contextOf(db);
    const token = decodeUploadToken(input.uploadToken);

    if (token.exp * 1000 < Date.now()) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Upload authorization has expired; request a new one',
        safeDetails: { violations: [{ path: 'body.uploadToken', rule: 'expired' }] },
      });
    }
    // The caller may also name the document. When they do, it must agree with
    // the token — disagreement means one of the two is not theirs.
    if (input.documentId !== null && input.documentId !== token.documentId) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Document does not match the upload authorization',
        safeDetails: { violations: [{ path: 'body.documentId', rule: 'token_mismatch' }] },
      });
    }
    if (!SHA256_HEX.test(input.checksumSha256)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Checksum must be 64 lower-case hex characters',
        safeDetails: { violations: [{ path: 'body.checksumSha256', rule: 'invalid_sha256' }] },
      });
    }

    // Loaded under RLS: a forged token naming another tenant's document finds
    // nothing, and the failure is the same "not found" every out-of-scope read
    // produces.
    const document = await this.documents.findDocument(db, token.documentId);
    if (!document) {
      throw new AppFailure('ERR-RES-001', { message: 'Document not found in the caller scope' });
    }

    // The storage key is REBUILT from server-resolved values rather than read
    // from the token, so a forged token cannot name a key.
    const storageKey = buildStorageKey({
      environment: config.NEXT_PUBLIC_APP_ENV as StorageEnvironment,
      tenantId: context.principal.tenantId,
      documentId: token.documentId,
      versionId: token.versionId,
    });
    if (!keyBelongsToTenant(storageKey, context.principal.tenantId)) {
      // Unreachable while buildStorageKey derives the tenant from the context;
      // kept because this is the assertion that would matter if it ever stopped.
      throw new AppFailure('ERR-SYS-001', {
        message: 'Derived storage key left the tenant prefix',
      });
    }

    // -----------------------------------------------------------------------
    // Re-check against the CATEGORY, not only against the token (P1-15-SR-010).
    //
    // The upload token is unsigned by design (R-05), and the whole compensating
    // control is the claim that "every field of the token is re-derived or
    // re-checked here". That claim was not true of `contentType` and `maxBytes`:
    // both were read straight out of the token, so a forged token could set a
    // content type the category forbids and a ceiling larger than the category
    // allows. The category is the governed limit; the token carries convenience,
    // never authority.
    //
    // The category is re-read from the DOCUMENT, which was loaded under RLS
    // above — so this is a server-resolved fact, not another token claim.
    // -----------------------------------------------------------------------
    const category = await this.documents.findCategoryById(db, document.category_id);
    if (!category || category.status !== 'active') {
      throw new AppFailure('ERR-RES-001', { message: 'Document category not found or disabled' });
    }
    // The category policy is enforced HERE, on the server, against the category
    // the document actually resolves to — not by the client that chose to send
    // the field, and not by the request schema, which cannot see the category.
    if (category.device_capture_timestamp_required && capturedAt === null) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A device capture timestamp is required for this evidence category',
        safeDetails: { violations: [{ path: 'body.capturedAt', rule: 'required' }] },
      });
    }
    if (capturedAt !== null) {
      const captureMs = capturedAt.getTime();
      if (
        !Number.isFinite(captureMs) ||
        captureMs < CAPTURE_EARLIEST_MS ||
        captureMs > Date.now() + CAPTURE_FUTURE_SKEW_MS
      ) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'Device capture timestamp is outside the plausible range',
          safeDetails: { violations: [{ path: 'body.capturedAt', rule: 'out_of_range' }] },
        });
      }
    }
    if (!contentTypeAllowed(token.contentType, category.allowed_content_types)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Content type is not permitted for this category',
        safeDetails: {
          violations: [{ path: 'body.uploadToken', rule: 'content_type_not_allowed' }],
        },
      });
    }

    const ceiling = Math.min(
      token.maxBytes,
      Number(category.max_size_bytes),
      config.STORAGE_MAX_UPLOAD_BYTES
    );
    if (!Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > ceiling) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Registered size is outside the authorized range',
        safeDetails: { violations: [{ path: 'body.byteSize', rule: 'size_out_of_range' }] },
      });
    }

    const versionNumber = await this.documents.nextVersionNumber(db, token.documentId);
    let versionId: string | null;
    try {
      versionId = await this.documents.insertVersion(db, {
        id: token.versionId,
        documentId: token.documentId,
        versionNumber,
        storageKey,
        contentType: token.contentType,
        sizeBytes: input.byteSize,
        sha256Hex: input.checksumSha256,
        capturedAt,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        // Same token replayed: the version id is already registered. Reported as
        // a conflict rather than silently returning the existing row, because
        // the caller's checksum may differ from the one already recorded.
        throw new AppFailure('ERR-RES-002', {
          message: 'This upload authorization has already been registered',
        });
      }
      throw error;
    }
    if (!versionId) {
      throw new AppFailure('ERR-IAM-001', {
        message: 'Version registration was refused by policy',
      });
    }

    await appendAudit(db, {
      action: 'shared.document.version_registered',
      entityType: 'shared.document_version',
      entityId: versionId,
      companyId: document.company_id,
      branchId: document.branch_id,
      details: [
        { field: 'document_id', classification: 'internal', value: token.documentId },
        { field: 'version_number', classification: 'public', value: String(versionNumber) },
        { field: 'content_type', classification: 'public', value: token.contentType },
        { field: 'size_bytes', classification: 'internal', value: String(input.byteSize) },
        // The checksum is an integrity value, not a secret, but it is also not
        // useful in an audit trail and would let a reader confirm content they
        // cannot otherwise read. Recorded as a fact, not as a value.
        { field: 'checksum_recorded', classification: 'internal', value: 'true' },
      ],
    });

    await publishEvent(db, {
      eventType: 'document.version.registered',
      aggregateId: token.documentId,
      aggregateVersion: versionNumber,
      producer: 'shared.attachments',
      payload: { versionNumber, contentType: token.contentType, status: 'pending' },
      eventKey: `document.version:${versionId}`,
      companyId: document.company_id,
      branchId: document.branch_id,
    });

    return { documentId: token.documentId, versionId, versionNumber };
  }

  /**
   * Operational registration path. A real readable provider advances the
   * immutable object through pending -> scanning -> accepted/quarantined in the
   * same bounded request; deterministic test-only providers remain pending.
   */
  async registerVersionAndScan(
    db: DbHandle,
    input: RegisterAndScanInput
  ): Promise<RegisteredAndScannedVersion> {
    const registered = await this.registerPendingVersion(db, input, input.capturedAt);
    const provider = storageProvider();
    if (!storageProviderCanRead(provider)) {
      return {
        ...registered,
        status: 'pending',
        scannerAvailable: false,
        scanStatus: 'not_started',
      };
    }
    if (!(await this.documents.beginScan(db, registered.versionId))) {
      throw new AppFailure('ERR-TRN-001', { message: 'Version could not enter scanning' });
    }

    // `error` is the starting value, not a fallback: every path below has to
    // EARN `clean`. A scanner that cannot decide must never leave a version in
    // a state acceptance can reach (P1-OD-025).
    let verdict: 'clean' | 'infected' | 'error' = 'error';
    let threat: string | null = null;
    const details: Record<string, string | number | boolean> = { byte_validation: false };
    try {
      const token = decodeUploadToken(input.uploadToken);
      const storageKey = buildStorageKey({
        environment: backendConfig().NEXT_PUBLIC_APP_ENV as StorageEnvironment,
        tenantId: this.contextOf(db).principal.tenantId,
        documentId: token.documentId,
        versionId: token.versionId,
      });
      const object = await provider.readObject(storageKey, input.byteSize);
      const actualHash = createHash('sha256').update(object.bytes).digest('hex');
      details.byte_validation = true;
      details.size_matches = object.contentLength === input.byteSize;
      details.hash_matches = actualHash === input.checksumSha256;
      details.metadata_content_type_matches = object.contentType === token.contentType;
      if (containsEicar(object.bytes)) {
        verdict = 'infected';
        threat = 'eicar_test_signature';
      } else if (!DECODABLE_CONTENT_TYPES.includes(token.contentType)) {
        // A category may legitimately permit a type this scanner cannot decode.
        // Quarantine is still correct — an unscanned object is not evidence —
        // but it is recorded as a scanner GAP, not as a bad file, because the
        // remedy is a scanner that handles the type.
        details.scan_gap = 'undecodable_content_type';
        details.declared_content_type = token.contentType;
      } else {
        const decoded = await decodeOrFail(object.bytes);
        details.detected_content_type = decoded.contentType;
        details.width = decoded.width;
        details.height = decoded.height;
        if (
          decoded.contentType === token.contentType &&
          object.contentLength === input.byteSize &&
          actualHash === input.checksumSha256 &&
          object.contentType === token.contentType
        ) {
          verdict = 'clean';
        } else {
          details.scan_gap = 'declared_content_does_not_match_stored_bytes';
        }
      }
    } catch (error) {
      // The reason is written into an append-only record, so it has to be true.
      verdict = 'error';
      if (error instanceof StorageProviderError) {
        details.provider_read = false;
        details.provider_failure = error.kind;
      } else if (error instanceof ScanUnavailableError) {
        details.scan_gap = error.reason;
      } else {
        details.scan_gap = 'scanner_fault';
      }
    }
    const status = await this.documents.completeScan(db, registered.versionId, {
      verdict,
      scanner: 'rootlco_image_guard',
      threat,
      details,
    });
    return { ...registered, status, scannerAvailable: true, scanStatus: verdict };
  }

  /**
   * Issues a short-lived download URL for an accepted version.
   *
   * The state check is the whole authorization story for CONTENT, and it says
   * something different since P1-OD-025. It used to be "no path in this phase
   * can accept a version", which was true when nothing could produce a verdict.
   * `registerVersionAndScan` now can, so the sentence would have become a
   * docblock stating a rule the code no longer implements.
   *
   * What is still true, and is what this check rests on: an accepted version
   * passed `scanning` with an exclusively clean verdict, enforced by
   * `shared.guard_document_version_transition` rather than by this method; and
   * a rejected or quarantined version is terminal, so it can never become
   * downloadable later.
   */
  async requestDownload(db: DbHandle, input: DownloadRequestInput): Promise<DownloadGrant> {
    const config = backendConfig();
    const context = this.contextOf(db);

    const version = input.versionId
      ? await this.documents.findVersion(db, input.versionId)
      : await this.documents.findLatestVersion(db, input.documentId);

    if (!version || version.document_id !== input.documentId) {
      throw new AppFailure('ERR-RES-001', { message: 'Version not found in the caller scope' });
    }
    if (!DOWNLOADABLE_STATES.includes(version.status)) {
      metrics().increment(METRICS.attachmentAuthorizationCount, {
        purpose: 'download',
        result: 'refused',
      });
      throw new AppFailure('ERR-DOC-001', {
        message: `Version is "${version.status}"; only an accepted version may be downloaded`,
      });
    }
    if (!keyBelongsToTenant(version.storage_key, context.principal.tenantId)) {
      // The row passed RLS but its key names another tenant: that is a data
      // integrity fault, and signing it would be the cross-tenant read.
      throw new AppFailure('ERR-SYS-001', {
        message: 'Stored key does not belong to the resolved tenant',
      });
    }

    const document = await this.documents.findDocument(db, version.document_id);
    const ttl = config.STORAGE_DOWNLOAD_URL_TTL_SECONDS;
    const signed = await this.sign(() =>
      storageProvider().signDownload({
        storageKey: version.storage_key,
        expiresInSeconds: ttl,
        downloadFileName: safeContentDispositionFilename(document?.title ?? 'attachment'),
      })
    );

    await appendAudit(db, {
      action: 'shared.document.download_authorized',
      entityType: 'shared.document_version',
      entityId: version.id,
      companyId: version.company_id,
      branchId: version.branch_id,
      details: [
        { field: 'document_id', classification: 'internal', value: version.document_id },
        {
          field: 'version_number',
          classification: 'public',
          value: String(version.version_number),
        },
        { field: 'ttl_seconds', classification: 'public', value: String(ttl) },
      ],
    });

    metrics().increment(METRICS.attachmentAuthorizationCount, {
      purpose: 'download',
      result: 'success',
    });
    this.logIssuance(db, 'download', ttl);

    return { url: signed.url, expiresAt: signed.expiresAt };
  }

  // -------------------------------------------------------------------------
  // Additional P1-15 capabilities
  // -------------------------------------------------------------------------

  /** Rejects a pending version. The only version transition the runtime holds. */
  async rejectVersion(db: DbHandle, versionId: string, reason: string): Promise<VersionRejected> {
    const version = await this.documents.findVersion(db, versionId);
    if (!version) {
      throw new AppFailure('ERR-RES-001', { message: 'Version not found in the caller scope' });
    }
    const affected = await this.documents.rejectVersion(db, versionId);
    if (affected === 0) {
      throw new AppFailure('ERR-TRN-001', {
        message: `Version is "${version.status}"; only a pending version may be rejected`,
      });
    }

    await appendAudit(db, {
      action: 'shared.document.version_rejected',
      entityType: 'shared.document_version',
      entityId: versionId,
      companyId: version.company_id,
      branchId: version.branch_id,
      details: [
        { field: 'status', classification: 'public', previousValue: 'pending', value: 'rejected' },
        { field: 'reason', classification: 'internal', value: reason.trim().slice(0, 500) },
      ],
    });

    return { versionId, status: 'rejected' };
  }

  /** Links a document to a business entity, establishing reachability. */
  async link(db: DbHandle, input: LinkDocumentInput): Promise<DocumentLinkRef> {
    if (!isLinkableEntityType(input.entityType)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Entity type is not linkable',
        safeDetails: { violations: [{ path: 'body.entityType', rule: 'unknown_entity_type' }] },
      });
    }
    if (!isLinkPurpose(input.linkPurpose)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Link purpose is not registered',
        safeDetails: { violations: [{ path: 'body.linkPurpose', rule: 'unknown_link_purpose' }] },
      });
    }

    const document = await this.documents.findDocument(db, input.documentId);
    if (!document) {
      throw new AppFailure('ERR-RES-001', { message: 'Document not found in the caller scope' });
    }

    const linkId = await this.documents.insertLink(db, {
      id: newUuid(),
      documentId: input.documentId,
      entityType: input.entityType,
      entityId: input.entityId,
      linkPurpose: input.linkPurpose,
    });
    if (!linkId) {
      throw new AppFailure('ERR-IAM-001', { message: 'Link creation was refused by policy' });
    }

    await appendAudit(db, {
      action: 'shared.document.linked',
      entityType: 'shared.document_link',
      entityId: linkId,
      companyId: document.company_id,
      branchId: document.branch_id,
      details: [
        { field: 'document_id', classification: 'internal', value: input.documentId },
        { field: 'entity_type', classification: 'public', value: input.entityType },
        { field: 'entity_id', classification: 'internal', value: input.entityId },
        { field: 'link_purpose', classification: 'public', value: input.linkPurpose },
      ],
    });

    await publishEvent(db, {
      eventType: 'document.link.changed',
      aggregateId: input.documentId,
      aggregateVersion: document.record_version,
      producer: 'shared.attachments',
      payload: { change: 'linked', entityType: input.entityType },
      eventKey: `document.link:${linkId}:linked`,
      companyId: document.company_id,
      branchId: document.branch_id,
    });

    return { linkId };
  }

  /** Withdraws a link. Reachability through that entity ends. */
  async unlink(db: DbHandle, linkId: string): Promise<DocumentLinkRef> {
    const link = await this.documents.findLink(db, linkId);
    if (!link || link.deleted_at !== null) {
      throw new AppFailure('ERR-RES-001', { message: 'Link not found in the caller scope' });
    }
    const document = await this.documents.findDocument(db, link.document_id);
    if (!document) {
      throw new AppFailure('ERR-RES-001', { message: 'Document not found in the caller scope' });
    }

    const affected = await this.documents.withdrawLink(db, linkId);
    if (affected === 0) {
      throw new AppFailure('ERR-IAM-001', { message: 'Unlink was refused by policy' });
    }

    await appendAudit(db, {
      action: 'shared.document.unlinked',
      entityType: 'shared.document_link',
      entityId: linkId,
      companyId: document.company_id,
      branchId: document.branch_id,
      details: [
        { field: 'document_id', classification: 'internal', value: link.document_id },
        { field: 'entity_type', classification: 'public', value: link.entity_type },
      ],
    });

    await publishEvent(db, {
      eventType: 'document.link.changed',
      aggregateId: link.document_id,
      aggregateVersion: document.record_version,
      producer: 'shared.attachments',
      payload: { change: 'unlinked', entityType: link.entity_type },
      eventKey: `document.link:${linkId}:unlinked`,
      companyId: document.company_id,
      branchId: document.branch_id,
    });

    return { linkId };
  }

  /**
   * Reports what is known about a version's scan state.
   *
   * Deliberately a *report*, not a gate that can be satisfied: it reads
   * `shared.file_scan_results`, which no application role may write, so the only
   * verdicts it can ever return are ones something outside this application
   * recorded. `scannerAvailable` is hard-coded `false` because no scanner is
   * configured and claiming otherwise would be the exact misrepresentation the
   * withholding exists to prevent.
   */
  /**
   * Verifies a document version is usable as immutable evidence for an entity
   * (P1-20-BE-012, P1-20-SEC-002).
   *
   * Added for quotation approval evidence, and it lives here because
   * `shared.document_versions` and `shared.document_links` belong to this module
   * — a consumer reading them itself would be a second definition of what a
   * valid attachment is.
   *
   * It answers the three questions a consumer must not answer for itself:
   *
   *  1. **Does the version exist in the caller's scope?** `findVersion` is
   *     RLS-narrowed, so a version from another tenant simply is not found.
   *  2. **What is the version's own company and branch?** Returned so the caller
   *     can refuse evidence from a different branch than the record it is
   *     evidencing. A `null` here means the version is tenant-wide.
   *  3. **Is it actually linked to that entity?** Without this, any document the
   *     caller can see could be attached as evidence for any record — the
   *     "forged attachment" case. The link must be live and name this exact
   *     `(entityType, entityId)`.
   *
   * A caller passes a `versionId`, never a storage key. Storage keys are not
   * accepted anywhere on this surface, so a client cannot name raw object storage.
   */
  async verifyEvidenceVersion(
    db: DbHandle,
    versionId: string,
    entityType: string,
    entityId: string
  ): Promise<{
    versionId: string;
    documentId: string;
    companyId: string | null;
    branchId: string | null;
    status: string;
    linkedToEntity: boolean;
  }> {
    const version = await this.documents.findVersion(db, versionId);
    if (!version) {
      throw new AppFailure('ERR-RES-001', { message: 'Version not found in the caller scope' });
    }
    const links = await this.documents.liveLinks(db, version.document_id);
    return {
      versionId: version.id,
      documentId: version.document_id,
      companyId: version.company_id,
      branchId: version.branch_id,
      status: version.status,
      linkedToEntity: links.some(
        (link) => link.entity_type === entityType && link.entity_id === entityId
      ),
    };
  }

  async scanState(
    db: DbHandle,
    versionId: string
  ): Promise<{ status: string; verdicts: readonly string[]; scannerAvailable: false }> {
    const version = await this.documents.findVersion(db, versionId);
    if (!version) {
      throw new AppFailure('ERR-RES-001', { message: 'Version not found in the caller scope' });
    }
    return {
      status: version.status,
      verdicts: await this.documents.scanVerdicts(db, versionId),
      scannerAvailable: false,
    };
  }

  // -------------------------------------------------------------------------

  /** Runs a provider call and maps its faults to the catalog. */
  private async sign(call: () => Promise<SignedUrl>): Promise<SignedUrl> {
    const startedAt = performance.now();
    try {
      const signed = await call();
      metrics().observe(
        METRICS.signedUrlDuration,
        Math.max(0, Math.round(performance.now() - startedAt)),
        { provider: signed.provider, result: 'success' }
      );
      metrics().increment(METRICS.signedUrlCount, { provider: signed.provider, result: 'success' });
      return signed;
    } catch (error) {
      if (error instanceof StorageProviderError) {
        metrics().increment(METRICS.signedUrlCount, { provider: 'unknown', result: error.kind });
        if (error.kind === 'timeout' || error.kind === 'outage') {
          // The dependency is never named to the caller.
          throw new AppFailure('ERR-DEP-001', {
            message: `Storage provider ${error.kind}`,
            cause: error,
          });
        }
      }
      throw error;
    }
  }

  /**
   * Records that a URL was issued. The URL itself never appears.
   *
   * `src/server/observability/redaction.ts` matches secret key fragments as
   * case-insensitive substrings, so a field named `storageKey` would be
   * `[REDACTED]` anyway — but a field named `url` would not, and a signed URL is
   * the capability. So the log states the fact and the TTL and stops there.
   */
  private logIssuance(db: DbHandle, purpose: 'upload' | 'download', ttlSeconds: number): void {
    log.info('Signed URL issued', {
      module: this.module,
      operation: db.context.operation,
      correlationId: db.context.correlationId,
      result: 'success',
      context: { purpose, ttlSeconds, provider: storageProvider().name },
    });
  }
}
