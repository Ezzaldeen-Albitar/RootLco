'use server';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { authorizedClient } from '@/lib/api/server-client';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';
import { fieldErrorsFrom } from '@/lib/forms/field-errors';
import { readOperation, type ReadState } from '@/lib/api/read-operation';
import {
  MAX_CAPTURED_AT,
  MAX_FILE_NAME,
  type DocumentCategory,
  type DocumentVersion,
  type RegisteredVersion,
} from './attachments-contract';

/**
 * The private evidence chain, from the web layer (`P1-15`, `P1-OD-025`).
 *
 * | operation                            | path                                  | permission              |
 * | ------------------------------------ | ------------------------------------- | ----------------------- |
 * | `shared.document-category-list`      | `/attachments/categories`             | `shared.document.read`  |
 * | `shared.attachment-upload-authorize` | `/attachments/upload-authorizations`  | `shared.document.manage`|
 * | `shared.attachment-version-register` | `/attachments/versions`               | `shared.document.manage`|
 * | `shared.document-version-read`       | `/attachments/versions/{versionId}`   | `shared.document.read`  |
 * | `shared.attachment-link-create`      | `/attachments/documents/{id}/links`   | `shared.document.manage`|
 *
 * ## Where the bytes go, and why the browser never touches storage
 *
 * The obvious reading of a signed upload URL is that the browser PUTs to it.
 * This web tier cannot, and the reason is structural rather than a preference:
 * `contentSecurityPolicy` in `lib/security/csp.ts` is the ONLY place
 * `connect-src` is assembled and it admits `'self'`, the API origin and — if a
 * deployment sets one — a diagnostics sink. There is no parameter for a storage
 * origin, so a browser PUT to an object store is refused by the policy before it
 * is refused by anything else. Admitting a third origin is a change to this
 * product's security posture and is not a Frontend branch's to make.
 *
 * So the file reaches a Server Action — same origin, which the policy already
 * admits — and the SERVER performs the PUT. What that buys, stated as the Owner
 * decision states it:
 *
 *   - **No browser storage credential.** The signed URL is created, used and
 *     discarded inside one server call. It is never serialised into a payload,
 *     never returned to the client, and never logged.
 *   - **No raw object key in the browser.** The key is server-built and travels
 *     only inside the opaque signed URL, which the browser does not see.
 *   - **Server-side permission checks before signing.** Unchanged — the API
 *     authorizes the upload, and this adapter only spends what it was given.
 *
 * ## The one outbound request that is not to the API
 *
 * `PUT`ting to `authorization.uploadUrl` is the only request this application
 * makes to a host it did not configure, and the URL is not user-supplied: it
 * arrives in the body of an authenticated response from our own API, one call
 * earlier in this same function. It is used verbatim and never stored, so there
 * is no window in which a caller could substitute one.
 *
 * NO SECOND STORAGE AUTHORITY. This module signs nothing, builds no key, holds
 * no credential and reads no `STORAGE_*` variable. It moves bytes to a
 * destination the API chose, and every decision about whether that was allowed
 * has already been taken.
 */

const EMPTY_CATEGORIES: readonly DocumentCategory[] = [];

/** The governed category policy (`shared.document-category-list`). */
export async function listDocumentCategories(): Promise<
  ReadState<{ readonly items: readonly DocumentCategory[] }>
> {
  return readOperation<{ readonly items: readonly DocumentCategory[] }>(
    '/api/v1/attachments/categories'
  );
}

/** One immutable version and its scan lifecycle (`shared.document-version-read`). */
export async function readDocumentVersion(versionId: string): Promise<ReadState<DocumentVersion>> {
  return readOperation<DocumentVersion>(
    `/api/v1/attachments/versions/${encodeURIComponent(versionId)}`
  );
}

/**
 * What a capture needs before it can start.
 *
 * `categoryCode`, `entityType` and `entityId` say WHAT is being evidenced;
 * `capturedAt` is what the device claims and is never trusted as a fact — the
 * API records it beside its own `uploaded_at`, which is the one it believes.
 */
export interface CaptureInput {
  readonly categoryCode: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly capturedAt?: string | null | undefined;
}

const captureSchema = z
  .object({
    categoryCode: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
    entityType: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
    entityId: z.string().uuid(),
    fileName: z.string().min(1).max(MAX_FILE_NAME),
    contentType: z.string().regex(/^[a-z0-9]+\/[a-z0-9][a-z0-9.+-]*$/),
    capturedAt: z.string().min(1).max(MAX_CAPTURED_AT).nullable().optional(),
  })
  .strict();

interface UploadAuthorization {
  readonly documentId: string;
  readonly uploadToken: string;
  readonly uploadUrl: string;
  readonly method: string;
  readonly contentType: string;
  readonly maxBytes: number;
  readonly expiresAt: string;
}

export interface CaptureState extends ActionState {
  readonly registered?: RegisteredVersion;
}

/**
 * Authorize, upload and register one piece of evidence.
 *
 * THREE steps in one Server Action, because they are one act and a half-finished
 * one is worse than none: a document row with no version, or an object in the
 * store that nothing references. If the PUT or the registration fails, what
 * survives is a document whose latest version never existed — which the version
 * list shows honestly — rather than an orphan the operator cannot see.
 *
 * The size ceiling is the SERVER's, read from the authorization it just issued.
 * There is no constant here to disagree with the category policy, which is what
 * `no-invented-media-limit` is for.
 */
export async function captureDocument(input: CaptureInput, attempt = 1): Promise<CaptureState> {
  const parsed = captureSchema.safeParse({
    categoryCode: input.categoryCode,
    entityType: input.entityType,
    entityId: input.entityId,
    fileName: input.fileName,
    contentType: input.contentType,
    ...(input.capturedAt === undefined ? {} : { capturedAt: input.capturedAt }),
  });
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const byteSize = input.bytes.byteLength;
  if (byteSize === 0) {
    return invalid({ file: 'attachments.capture.empty' }, attempt);
  }

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const authorized = await client.send<UploadAuthorization>(
    'POST',
    '/api/v1/attachments/upload-authorizations',
    { ...parsed.data, capturedAt: undefined, byteSize }
  );
  if (!authorized.ok) return fromFailure(authorized, attempt);

  // The ceiling the server just published for this category. Checked here so a
  // file that cannot be accepted is refused before its bytes cross a network,
  // and reported against the field the operator can act on.
  if (byteSize > authorized.data.maxBytes) {
    return invalid({ file: 'attachments.capture.tooLarge' }, attempt);
  }

  const stored = await putObject(authorized.data, input.bytes);
  if (!stored.ok) {
    return {
      status: 'error',
      messageKey: 'attachments.capture.storeUnavailable',
      correlationId: authorized.correlationId,
      attempt,
    };
  }

  // Computed over the bytes THIS call uploaded. The API re-reads the object and
  // compares, so a checksum taken from anywhere else would simply fail the scan.
  const checksumSha256 = createHash('sha256').update(input.bytes).digest('hex');

  const registered = await client.send<RegisteredVersion>('POST', '/api/v1/attachments/versions', {
    uploadToken: authorized.data.uploadToken,
    documentId: authorized.data.documentId,
    checksumSha256,
    byteSize,
    capturedAt: parsed.data.capturedAt ?? null,
  });
  if (!registered.ok) return fromFailure(registered, attempt);

  return {
    status: 'success',
    correlationId: registered.correlationId,
    attempt,
    registered: registered.data,
  };
}

/**
 * The single outbound request to a non-API host.
 *
 * Isolated in its own function so the whole of it can be read at once, and so
 * the rule it obeys is checkable: the URL is used exactly as the API returned
 * it, nothing about it is retained, and its failure is a state rather than a
 * throw — a store that is unreachable is a condition an operator is told about,
 * not a stack trace.
 */
async function putObject(
  authorization: UploadAuthorization,
  bytes: Uint8Array
): Promise<{ readonly ok: boolean }> {
  try {
    const response = await fetch(authorization.uploadUrl, {
      method: authorization.method,
      headers: { 'content-type': authorization.contentType },
      body: new Uint8Array(bytes),
      // No credentials of ours belong on a request to somebody else's host.
      cache: 'no-store',
      redirect: 'error',
    });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

const linkSchema = z
  .object({
    entityType: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
    entityId: z.string().uuid(),
    linkPurpose: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  })
  .strict();

export interface DocumentLinkInput {
  readonly entityType: string;
  readonly entityId: string;
  readonly linkPurpose: string;
}

export interface DocumentLinkState extends ActionState {
  readonly linkId?: string;
}

/**
 * Link a document to the business record it evidences
 * (`shared.attachment-link-create`).
 *
 * The link is what makes a document reachable to somebody who holds the
 * business record rather than the document id, so it is a separate act with its
 * own audit entry — and its own failure, which the caller reports rather than
 * folding into the capture's.
 */
export async function createDocumentLink(
  documentId: string,
  input: DocumentLinkInput,
  attempt = 1
): Promise<DocumentLinkState> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return invalid(fieldErrorsFrom(parsed.error), attempt);

  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<{ readonly linkId: string }>(
    'POST',
    `/api/v1/attachments/documents/${encodeURIComponent(documentId)}/links`,
    parsed.data
  );
  if (!result.ok) return fromFailure(result, attempt);

  return {
    status: 'success',
    correlationId: result.correlationId,
    attempt,
    linkId: result.data.linkId,
  };
}

export { EMPTY_CATEGORIES };
