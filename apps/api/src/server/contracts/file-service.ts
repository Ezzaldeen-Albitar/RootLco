/**
 * File service — contract only (P1-13-BE-018).
 *
 * The interface is frozen here so Phase 1-15 implements it without changing a
 * signature, and so any earlier caller compiles against the final shape. The
 * types are written against the Phase 1-5 document tables (`shared.documents`,
 * `shared.document_versions`, `shared.file_scan_results`) that already exist.
 *
 * The stub rejects every call with the cataloged `ERR-STB-001`. It deliberately
 * does not return an empty success: a "successful" no-op upload registration
 * would let a caller believe a document exists, which is a worse failure than a
 * clear 501.
 *
 * Out of scope in P1-13 by explicit phase boundary: byte transfer, storage
 * provider, signed URLs, virus scanning, retention enforcement.
 */
import { AppFailure } from '../errors/app-failure';
import type { DbHandle } from '../db/transaction';

export interface AuthorizeUploadInput {
  /** Category code from `shared.document_categories`. */
  readonly categoryCode: string;
  /** Entity the document will be linked to. */
  readonly entityType: string;
  readonly entityId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
}

export interface UploadAuthorization {
  /** Opaque token the client presents when registering the version. */
  readonly uploadToken: string;
  /** Storage key reserved for the upload (`docs/database/storage-key-convention.md`). */
  readonly storageKey: string;
  readonly expiresAt: Date;
}

export interface RegisterVersionInput {
  readonly uploadToken: string;
  readonly documentId: string | null;
  readonly checksumSha256: string;
  readonly byteSize: number;
}

export interface RegisteredVersion {
  readonly documentId: string;
  readonly versionId: string;
  readonly versionNumber: number;
}

export interface DownloadRequestInput {
  readonly documentId: string;
  readonly versionId?: string | null;
}

export interface DownloadGrant {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface FileService {
  authorizeUpload(db: DbHandle, input: AuthorizeUploadInput): Promise<UploadAuthorization>;
  registerVersion(db: DbHandle, input: RegisterVersionInput): Promise<RegisteredVersion>;
  requestDownload(db: DbHandle, input: DownloadRequestInput): Promise<DownloadGrant>;
}

function notImplemented(operation: string): never {
  throw new AppFailure('ERR-STB-001', {
    message: `FileService.${operation} is a P1-13 contract stub; implementation lands in Phase 1-15`,
    safeDetails: { contract: 'FileService' },
  });
}

/** Contract-only stub. Every call fails with the cataloged not-implemented code. */
export class NotImplementedFileService implements FileService {
  async authorizeUpload(): Promise<UploadAuthorization> {
    return notImplemented('authorizeUpload');
  }
  async registerVersion(): Promise<RegisteredVersion> {
    return notImplemented('registerVersion');
  }
  async requestDownload(): Promise<DownloadGrant> {
    return notImplemented('requestDownload');
  }
}

let service: FileService = new NotImplementedFileService();

export function fileService(): FileService {
  return service;
}

/** Installed by Phase 1-15 composition. */
export function setFileService(next: FileService): void {
  service = next;
}

export function __resetFileServiceForTests(): void {
  service = new NotImplementedFileService();
}
