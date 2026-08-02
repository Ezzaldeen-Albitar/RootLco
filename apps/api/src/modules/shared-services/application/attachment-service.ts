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
  StorageProviderError,
  type SignedUrl,
} from '../provider/storage-provider';

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

function newUuid(): string {
  return crypto.randomUUID();
}

export class AttachmentService extends ApplicationService implements FileService {
  protected readonly module = 'shared-services';

  constructor(private readonly documents: DocumentRepository) {
    super();
  }

  // -------------------------------------------------------------------------
  // Frozen FileService surface
  // -------------------------------------------------------------------------

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
   * Issues a short-lived download URL for an accepted version.
   *
   * The state check is the whole authorization story for content: a version that
   * has not been accepted has not passed scanning, and no path in this phase can
   * accept one.
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
  async rejectVersion(
    db: DbHandle,
    versionId: string,
    reason: string
  ): Promise<{ versionId: string; status: 'rejected' }> {
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
  async link(db: DbHandle, input: LinkDocumentInput): Promise<{ linkId: string }> {
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
  async unlink(db: DbHandle, linkId: string): Promise<{ linkId: string }> {
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
