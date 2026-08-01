/**
 * Deterministic local storage adapter (P1-15).
 *
 * This is **not** an object store and does not pretend to be one. It signs URLs
 * the same way a real provider would — canonical string, HMAC-SHA256, bounded
 * expiry, method and content binding — against a host in the RFC 2606 reserved
 * `.invalid` TLD, which by definition can never resolve. So a URL it issues is:
 *
 *  - **verifiable**, which is what lets the security tests prove that a
 *    download URL cannot be replayed as an upload, that a URL for tenant A
 *    cannot be re-signed for tenant B, and that an expired URL is refused;
 *  - **useless**, which is what stops it from silently becoming production.
 *
 * No credential is ever returned: the HMAC key is generated per process (or
 * supplied by a test for reproducibility) and never leaves this object.
 *
 * `behaviour` exists so the notification and attachment suites can exercise the
 * provider-timeout and provider-outage paths without a network. It is a test
 * seam, stated as one, and the default is `'ok'`.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ABSOLUTE_MAX_URL_TTL_SECONDS,
  StorageProviderError,
  type SignedUrl,
  type SignUrlRequest,
  type StorageProvider,
} from './storage-provider';
import { assertKeyIsWellFormed } from '../domain/storage-key';

/** Reserved by RFC 2606; guaranteed never to resolve. */
const HOST = 'https://object-storage.invalid';

export type LocalStorageBehaviour = 'ok' | 'timeout' | 'outage';

export interface LocalStorageProviderOptions {
  readonly bucket: string;
  /** Test seam: fixed key makes signatures reproducible across runs. */
  readonly signingKey?: string;
  /** Test seam: simulate provider faults without a network. */
  readonly behaviour?: LocalStorageBehaviour;
  /** Test seam: fixed clock. Defaults to the real one. */
  readonly now?: () => Date;
}

export class LocalStorageProvider implements StorageProvider {
  public readonly name = 'local_fake';

  private readonly bucket: string;
  private readonly signingKey: Buffer;
  private readonly behaviour: LocalStorageBehaviour;
  private readonly now: () => Date;

  constructor(options: LocalStorageProviderOptions) {
    this.bucket = options.bucket;
    this.signingKey = options.signingKey
      ? Buffer.from(options.signingKey, 'utf8')
      : randomBytes(32);
    this.behaviour = options.behaviour ?? 'ok';
    this.now = options.now ?? (() => new Date());
  }

  async signUpload(request: SignUrlRequest): Promise<SignedUrl> {
    return this.sign('PUT', request);
  }

  async signDownload(request: SignUrlRequest): Promise<SignedUrl> {
    return this.sign('GET', request);
  }

  private async sign(method: 'PUT' | 'GET', request: SignUrlRequest): Promise<SignedUrl> {
    if (this.behaviour === 'timeout') {
      throw new StorageProviderError('local_fake: simulated provider timeout', 'timeout');
    }
    if (this.behaviour === 'outage') {
      throw new StorageProviderError('local_fake: simulated provider outage', 'outage');
    }

    // The adapter re-checks the key rather than trusting its caller: an adapter
    // that signs whatever it is handed is the component that turns an
    // application bug into a cross-tenant read.
    assertKeyIsWellFormed(request.storageKey);

    if (
      !Number.isInteger(request.expiresInSeconds) ||
      request.expiresInSeconds < 1 ||
      request.expiresInSeconds > ABSOLUTE_MAX_URL_TTL_SECONDS
    ) {
      throw new StorageProviderError(
        `local_fake: expiry must be 1–${ABSOLUTE_MAX_URL_TTL_SECONDS} seconds`,
        'refused'
      );
    }

    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + request.expiresInSeconds * 1000);
    const canonical = canonicalString({
      bucket: this.bucket,
      method,
      request,
      expiresAtEpoch: Math.floor(expiresAt.getTime() / 1000),
    });
    const signature = createHmac('sha256', this.signingKey).update(canonical).digest('base64url');

    const url = new URL(`${HOST}/${this.bucket}/${request.storageKey}`);
    url.searchParams.set('x-method', method);
    url.searchParams.set('x-expires', String(Math.floor(expiresAt.getTime() / 1000)));
    if (request.contentType) url.searchParams.set('x-content-type', request.contentType);
    if (request.contentLength !== undefined) {
      url.searchParams.set('x-content-length', String(request.contentLength));
    }
    if (request.downloadFileName) {
      url.searchParams.set('x-filename', request.downloadFileName);
    }
    url.searchParams.set('x-signature', signature);

    return { url: url.toString(), method, expiresAt, provider: this.name };
  }

  /**
   * Verifies a URL this adapter issued.
   *
   * Only the tests use it — a real provider verifies on its own edge — but it
   * has to exist for those tests to be evidence rather than assertion: without
   * it, "a download URL cannot be replayed as an upload" would be a claim about
   * a string, not a checked property of the signature.
   */
  verify(rawUrl: string, at: Date = this.now()): { valid: boolean; reason?: string } {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { valid: false, reason: 'unparseable' };
    }
    if (url.origin !== HOST) return { valid: false, reason: 'wrong-host' };

    const presented = url.searchParams.get('x-signature');
    const method = url.searchParams.get('x-method');
    const expires = Number(url.searchParams.get('x-expires'));
    if (!presented || (method !== 'PUT' && method !== 'GET') || !Number.isFinite(expires)) {
      return { valid: false, reason: 'malformed' };
    }

    const prefix = `/${this.bucket}/`;
    if (!url.pathname.startsWith(prefix)) return { valid: false, reason: 'wrong-bucket' };
    const storageKey = decodeURIComponent(url.pathname.slice(prefix.length));

    const contentType = url.searchParams.get('x-content-type');
    const contentLength = url.searchParams.get('x-content-length');
    const fileName = url.searchParams.get('x-filename');
    const canonical = canonicalString({
      bucket: this.bucket,
      method,
      expiresAtEpoch: expires,
      request: {
        storageKey,
        expiresInSeconds: 0,
        ...(contentType !== null ? { contentType } : {}),
        ...(contentLength !== null ? { contentLength: Number(contentLength) } : {}),
        ...(fileName !== null ? { downloadFileName: fileName } : {}),
      },
    });
    const expected = createHmac('sha256', this.signingKey).update(canonical).digest('base64url');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(presented, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: 'bad-signature' };
    }
    if (Math.floor(at.getTime() / 1000) > expires) return { valid: false, reason: 'expired' };
    return { valid: true };
  }
}

/**
 * The signed string.
 *
 * `expiresInSeconds` is deliberately absent and the absolute expiry is present
 * instead: signing the *duration* would let a caller keep a URL alive by
 * re-deriving it from a later clock. Method is inside the signature, which is
 * what binds a GET URL to GET.
 */
function canonicalString(input: {
  bucket: string;
  method: string;
  expiresAtEpoch: number;
  request: SignUrlRequest;
}): string {
  return [
    'v1',
    input.bucket,
    input.method,
    input.request.storageKey,
    String(input.expiresAtEpoch),
    input.request.contentType ?? '',
    input.request.contentLength === undefined ? '' : String(input.request.contentLength),
    input.request.downloadFileName ?? '',
  ].join('\n');
}
