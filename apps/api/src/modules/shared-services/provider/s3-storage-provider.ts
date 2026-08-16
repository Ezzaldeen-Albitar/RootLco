/**
 * Private S3-compatible storage adapter (P1-OD-025).
 *
 * The second adapter behind the P1-15 port, and the first one that reaches a
 * network. Everything the port promises still holds here, and three of those
 * promises are re-established rather than inherited, because an adapter that
 * trusts its caller is the component that turns an application bug into a
 * cross-tenant read:
 *
 *  - **the key is re-checked**, not trusted (`assertKeyIsWellFormed`), exactly
 *    as `LocalStorageProvider` does;
 *  - **the download filename is re-sanitised and RFC 5987 encoded**, not
 *    interpolated. The port's docblock said the caller had already sanitised
 *    it; that sentence was the only thing standing between a document title and
 *    `Content-Disposition` parameter injection, and a sentence is not a control;
 *  - **a credential failure is never reported as an outage.** `refused` is not
 *    retryable and `outage` is, so misclassifying a bad access key as an outage
 *    turns "rotate the key" into "wait for it to clear", which it never does.
 *
 * ## Bucket provisioning is a decision, not a side effect
 *
 * The first draft called `HeadBucket` on every signing request and issued
 * `CreateBucket` whenever that call threw — which auto-created buckets in
 * production, and reported a 403 from a wrong access key as a missing bucket.
 *
 * So provisioning is now explicit and environment-bound:
 *
 *  - `'ensure'` (local and development only): probe once, create once if the
 *    probe says *NotFound* specifically. A 403 aborts and says so.
 *  - `'assume'` (staging and production): the bucket is provisioned out of
 *    band, and this adapter never probes it. That removes the auto-creation
 *    hazard AND a real operational one — a production credential is commonly
 *    granted `GetObject`/`PutObject` and NOT `ListBucket`, so a mandatory
 *    `HeadBucket` would fail every request against a perfectly good bucket.
 *
 * A failed probe is never memoised. Caching a rejected promise would make one
 * transient failure permanent for the lifetime of the process.
 */
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertKeyIsWellFormed, contentDispositionAttachment } from '../domain/storage-key';
import {
  ABSOLUTE_MAX_URL_TTL_SECONDS,
  StorageProviderError,
  type ReadableStorageProvider,
  type SignedUrl,
  type SignUrlRequest,
  type StoredObject,
} from './storage-provider';

/**
 * `'ensure'` may probe and create the bucket; `'assume'` never touches it.
 * Composition derives this from the environment — it is not a runtime input.
 */
export type BucketProvisioning = 'ensure' | 'assume';

export interface S3StorageProviderOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
  readonly provisioning: BucketProvisioning;
}

/** How a store's failure should be reported, decided from its own answer. */
type FailureKind = 'missing' | 'denied' | 'already-exists' | 'unavailable';

const DENIED_NAMES = new Set([
  'AccessDenied',
  'AccessDeniedException',
  'AllAccessDisabled',
  'CredentialsProviderError',
  'ExpiredToken',
  'ExpiredTokenException',
  'Forbidden',
  'InvalidAccessKeyId',
  'InvalidClientTokenId',
  'SignatureDoesNotMatch',
  'UnrecognizedClientException',
]);

const MISSING_NAMES = new Set(['NotFound', 'NoSuchBucket', 'NoSuchKey']);
const EXISTS_NAMES = new Set(['BucketAlreadyExists', 'BucketAlreadyOwnedByYou']);

/**
 * Classifies a store error by BOTH its name and its HTTP status.
 *
 * `HeadBucket` is the reason both are needed: it is a HEAD, so it answers with
 * a bare status and no error document, and the SDK surfaces a 403 as the
 * generic name `Forbidden` and a 404 as `NotFound`. Reading only the name would
 * miss a store that returns a status with a name this list has never seen —
 * and treating an unrecognised 403 as "missing" is precisely the mistake that
 * created a bucket because a credential was wrong.
 */
export function classifyStorageFailure(error: unknown): FailureKind {
  const record = (error ?? {}) as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const name = typeof record.name === 'string' ? record.name : '';
  const code = typeof record.Code === 'string' ? record.Code : '';
  const status =
    typeof record.$metadata?.httpStatusCode === 'number' ? record.$metadata.httpStatusCode : 0;

  if (DENIED_NAMES.has(name) || DENIED_NAMES.has(code) || status === 401 || status === 403) {
    return 'denied';
  }
  if (EXISTS_NAMES.has(name) || EXISTS_NAMES.has(code) || status === 409) return 'already-exists';
  if (MISSING_NAMES.has(name) || MISSING_NAMES.has(code) || status === 404) return 'missing';
  return 'unavailable';
}

/** Private S3-compatible adapter. Credentials and raw keys remain server-side. */
export class S3StorageProvider implements ReadableStorageProvider {
  readonly name = 's3_compatible';
  private readonly client: S3Client;
  private bucketReady: Promise<void> | undefined;

  constructor(private readonly options: S3StorageProviderOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  private async ensurePrivateBucket(): Promise<void> {
    if (this.options.provisioning === 'assume') return;
    // A rejected promise must not be memoised: one transient failure would
    // otherwise refuse every request for the life of the process.
    this.bucketReady ??= this.provisionBucket().catch((error: unknown) => {
      this.bucketReady = undefined;
      throw error;
    });
    return this.bucketReady;
  }

  private async provisionBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
      return;
    } catch (error) {
      const kind = classifyStorageFailure(error);
      if (kind === 'denied') {
        // Never `outage`: waiting does not fix a credential.
        throw new StorageProviderError(
          'private storage rejected the configured credential; check ' +
            'STORAGE_S3_ACCESS_KEY_ID / STORAGE_S3_SECRET_ACCESS_KEY and the bucket policy',
          'refused'
        );
      }
      if (kind !== 'missing') {
        throw new StorageProviderError('private storage bucket unreachable', 'outage');
      }
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.options.bucket }));
    } catch (error) {
      const kind = classifyStorageFailure(error);
      // Another process won the race; the bucket exists, which is the goal.
      if (kind === 'already-exists') return;
      if (kind === 'denied') {
        throw new StorageProviderError(
          'private storage bucket is absent and the configured credential may not create it',
          'refused'
        );
      }
      throw new StorageProviderError('private storage bucket could not be created', 'outage');
    }
  }

  private assertRequest(request: SignUrlRequest): void {
    // The adapter re-checks the key rather than trusting its caller.
    assertKeyIsWellFormed(request.storageKey);
    if (
      !Number.isInteger(request.expiresInSeconds) ||
      request.expiresInSeconds < 1 ||
      request.expiresInSeconds > ABSOLUTE_MAX_URL_TTL_SECONDS
    ) {
      throw new StorageProviderError('signed URL expiry refused', 'refused');
    }
  }

  async signUpload(request: SignUrlRequest): Promise<SignedUrl> {
    this.assertRequest(request);
    await this.ensurePrivateBucket();
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: request.storageKey,
      ContentType: request.contentType,
      ContentLength: request.contentLength,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: request.expiresInSeconds });
    return {
      url,
      method: 'PUT',
      expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
      provider: this.name,
    };
  }

  async signDownload(request: SignUrlRequest): Promise<SignedUrl> {
    this.assertRequest(request);
    await this.ensurePrivateBucket();
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: request.storageKey,
        ResponseContentDisposition: request.downloadFileName
          ? contentDispositionAttachment(request.downloadFileName)
          : undefined,
      }),
      { expiresIn: request.expiresInSeconds }
    );
    return {
      url,
      method: 'GET',
      expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
      provider: this.name,
    };
  }

  /**
   * Reads one stored object, bounded on both sides.
   *
   * The declared length is checked BEFORE any byte is buffered, and the stream
   * is then consumed with a running total that aborts the moment it exceeds
   * what was declared. `transformToByteArray()` would buffer the whole body
   * first and check afterwards, which is a length check that has already paid
   * the cost it exists to prevent.
   */
  async readObject(storageKey: string, maxBytes: number): Promise<StoredObject> {
    assertKeyIsWellFormed(storageKey);
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new StorageProviderError('stored object read bound refused', 'refused');
    }
    await this.ensurePrivateBucket();
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: storageKey })
      );
      const declared = response.ContentLength ?? 0;
      if (declared < 1 || declared > maxBytes || !response.Body) {
        throw new StorageProviderError('stored object size refused', 'refused');
      }
      const bytes = await readBoundedBody(response.Body, declared);
      if (bytes.byteLength !== declared) {
        throw new StorageProviderError('stored object length mismatch', 'refused');
      }
      return {
        bytes,
        contentType: response.ContentType ?? null,
        contentLength: bytes.byteLength,
      };
    } catch (error) {
      if (error instanceof StorageProviderError) throw error;
      if (classifyStorageFailure(error) === 'denied') {
        throw new StorageProviderError(
          'private storage rejected the configured credential on read',
          'refused'
        );
      }
      throw new StorageProviderError('stored object unavailable', 'outage');
    }
  }
}

/**
 * Consumes a body without ever holding more than `limit` bytes.
 *
 * Exported because it is the whole of the bound: a test can drive it with a
 * lying stream, which is the only way to prove the limit is enforced during the
 * read rather than checked after it.
 */
export async function readBoundedBody(body: unknown, limit: number): Promise<Uint8Array> {
  const iterable = body as Partial<AsyncIterable<Uint8Array>>;
  if (typeof iterable[Symbol.asyncIterator] !== 'function') {
    // A runtime whose body is not async-iterable. `transformToByteArray` is on
    // every SDK stream; the bound is then re-applied to what it returned.
    const collected = await (body as { transformToByteArray(): Promise<Uint8Array> })
      .transformToByteArray()
      .catch(() => {
        throw new StorageProviderError('stored object could not be read', 'outage');
      });
    if (collected.byteLength > limit) {
      throw new StorageProviderError('stored object exceeded its declared length', 'refused');
    }
    return collected;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of iterable as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > limit) {
      throw new StorageProviderError('stored object exceeded its declared length', 'refused');
    }
    chunks.push(Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}
