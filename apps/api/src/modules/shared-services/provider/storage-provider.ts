/**
 * Object-storage port (P1-15).
 *
 * **No production object store is provisioned.** ADR-012 leaves the storage
 * provider open, and this phase does not close it: what P1-15 delivers is the
 * *port* — the shape every adapter must satisfy — plus a deterministic local
 * adapter that reaches no network. Selecting and provisioning a real provider is
 * an owner decision recorded as open, and nothing here claims otherwise.
 *
 * ## What the port guarantees regardless of adapter
 *
 *  - **The key is server-built.** `signUpload`/`signDownload` take a storage key
 *    the application composed from the tenant and a generated id (see
 *    `domain/storage-key.ts`); no adapter accepts a caller-supplied path, so
 *    `../` cannot appear and two tenants cannot collide.
 *  - **Every URL expires.** `expiresInSeconds` is required and bounded by the
 *    caller against `STORAGE_UPLOAD_URL_TTL_SECONDS` /
 *    `STORAGE_DOWNLOAD_URL_TTL_SECONDS`; there is no way to express "no expiry".
 *  - **The URL is bound to one method**, and — where the adapter supports it —
 *    to the content type and byte length. A download URL cannot be replayed as
 *    an upload.
 *  - **Nothing in the result is a credential.** The adapter returns a URL and an
 *    expiry. Access keys, tokens, and bucket policies never cross this boundary.
 *
 * ## Why the signed URL never appears in a log
 *
 * A signed URL *is* the capability. `src/server/observability/redaction.ts`
 * would redact a field literally named `signature`, but not one named `url`, so
 * the rule cannot be delegated to the redactor: callers log the *fact* of an
 * issuance (`{ purpose, method, ttlSeconds }`) and never the value. That is
 * asserted, not merely intended.
 */
import { AppFailure } from '@/server/errors/app-failure';

export type StorageOperation = 'upload' | 'download';

export interface SignUrlRequest {
  /** Server-built key. Adapters must reject anything they did not receive here. */
  readonly storageKey: string;
  /** Seconds until expiry. Bounded by the caller; adapters re-check the bound. */
  readonly expiresInSeconds: number;
  /** Exact content type the upload must declare. Download adapters may ignore it. */
  readonly contentType?: string;
  /** Exact byte length the upload must declare, when the adapter supports it. */
  readonly contentLength?: number;
  /**
   * Filename offered to the browser on download. Already sanitised by
   * `safeContentDispositionFilename()`; adapters must not accept a raw one.
   */
  readonly downloadFileName?: string;
}

export interface SignedUrl {
  /**
   * The signed URL. Treat as a bearer credential: **never logged, never
   * audited, never returned in an error.**
   *
   * ## Where it IS persisted, and why the earlier "never stored" was wrong
   *
   * It said "never stored" and that was not true (P1-15-SR-005). An idempotent
   * operation's response document is written to `shared.idempotency_keys`
   * so a retried request can be answered with the same result, and for
   * `shared.attachment-upload-authorize` that response contains this URL. A
   * comment claiming otherwise is worse than no comment, so it is corrected
   * rather than quietly softened.
   *
   * The exposure is bounded on three sides and each bound is checkable:
   *
   *  - `shared.idempotency_keys` is tenant-scoped with SELECT and INSERT
   *    policies only — no application role may UPDATE or DELETE a row, and no
   *    role can read another tenant's;
   *  - the URL it holds is valid for at most
   *    `STORAGE_UPLOAD_URL_TTL_SECONDS`, itself capped by
   *    `ABSOLUTE_MAX_URL_TTL_SECONDS` (900 s), so the stored copy is a dead
   *    string for all but the first minutes of the row's life;
   *  - the capability it carries is over one object in the caller's OWN
   *    tenant, at a key that tenant's own request reserved.
   *
   * Removing the URL from the stored document is not the fix: a replay that
   * answers without the capability answers with something the caller cannot
   * use, which converts a retry into a silent failure — exactly the class of
   * defect P1-15-SR-002 was.
   */
  readonly url: string;
  /** HTTP method the URL is valid for. */
  readonly method: 'PUT' | 'GET';
  readonly expiresAt: Date;
  /** Adapter that issued it, for observability. Never a hostname or bucket. */
  readonly provider: string;
}

export interface StorageProvider {
  /** Stable adapter name, e.g. `local_fake`. Low-cardinality; safe to log. */
  readonly name: string;
  signUpload(request: SignUrlRequest): Promise<SignedUrl>;
  signDownload(request: SignUrlRequest): Promise<SignedUrl>;
}

export interface StoredObject {
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
  readonly contentLength: number;
}

/** Implemented only by real server-side adapters; never exposed to the browser. */
export interface ReadableStorageProvider extends StorageProvider {
  readObject(storageKey: string, maxBytes: number): Promise<StoredObject>;
}

export function storageProviderCanRead(
  candidate: StorageProvider
): candidate is ReadableStorageProvider {
  return typeof (candidate as Partial<ReadableStorageProvider>).readObject === 'function';
}

/** Longest signed-URL lifetime any adapter may issue, whatever configuration says. */
export const ABSOLUTE_MAX_URL_TTL_SECONDS = 900;

export class StorageProviderError extends Error {
  public override readonly name = 'StorageProviderError';
  constructor(
    message: string,
    /** `timeout` and `outage` are retryable; `refused` is not. */
    public readonly kind: 'timeout' | 'outage' | 'refused'
  ) {
    super(message);
  }
}

/**
 * The default. Refuses every call rather than pretending an object store exists.
 *
 * Surfaces as `ERR-SYS-001` — a caller cannot fix a platform that has no storage
 * configured, and the message names the setting for the operator, never the
 * caller. The same shape as `UnconfiguredIdentityProvider` in P1-14.
 */
export class UnconfiguredStorageProvider implements StorageProvider {
  public readonly name = 'unconfigured';

  private refuse(): never {
    throw new AppFailure('ERR-SYS-001', {
      message:
        'No object-storage provider is configured. Set STORAGE_PROVIDER; no production ' +
        'provider is provisioned for this platform (ADR-012 remains open).',
      cause: new StorageProviderError('storage provider unconfigured', 'refused'),
    });
  }

  async signUpload(): Promise<SignedUrl> {
    return this.refuse();
  }
  async signDownload(): Promise<SignedUrl> {
    return this.refuse();
  }
}

let provider: StorageProvider = new UnconfiguredStorageProvider();

export function storageProvider(): StorageProvider {
  return provider;
}

/** Installed by module composition, or by a test harness. Never by a handler. */
export function setStorageProvider(next: StorageProvider): void {
  provider = next;
}

export function __resetStorageProviderForTests(): void {
  provider = new UnconfiguredStorageProvider();
}
