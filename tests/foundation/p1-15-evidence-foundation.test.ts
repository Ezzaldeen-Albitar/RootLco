/**
 * P1-OD-025 — the private, versioned evidence foundation, at the layer that
 * needs no database and no network.
 *
 * Three properties are proved here because here is where they can be proved
 * *deterministically*, and each one had a real defect behind it:
 *
 *  1. **A hostile filename cannot escape `Content-Disposition`.** The S3
 *     adapter interpolated `attachment; filename="${name}"` and relied on a
 *     sentence in the port's docblock saying the caller had already sanitised
 *     it. A sentence is not a control, and the sanitiser it named deliberately
 *     PRESERVES non-ASCII, so even the compliant path produced a raw UTF-8
 *     header value. Both halves are fixed and both halves are asserted.
 *
 *  2. **A credential failure is never reported as an outage.** `refused` is not
 *     retryable and `outage` is, so a 403 misclassified as an outage turns
 *     "rotate the key" into "wait", which never clears.
 *
 *  3. **A raw storage key is not a capability.** The adapter re-checks the key
 *     BEFORE it does anything else, so a caller that hands it a path — its own
 *     tenant's or another's — gets a refusal rather than a signature.
 *
 * The signing here is genuine SigV4 query presigning, which is a local
 * computation: no request leaves the process. The endpoint used for the
 * provisioning contrast is `127.0.0.1:1`, which refuses instantly and is not a
 * network dependency in any environment.
 */
import { describe, expect, it } from 'vitest';
import {
  contentDispositionAttachment,
  safeContentDispositionFilename,
  StorageKeyError,
} from '@/modules/shared-services/domain/storage-key';
import {
  S3StorageProvider,
  classifyStorageFailure,
  readBoundedBody,
} from '@/modules/shared-services/provider/s3-storage-provider';
import { StorageProviderError } from '@/modules/shared-services/provider/storage-provider';

/** A well-formed key of the shape `buildStorageKey` produces. */
const TENANT = '11111111-1111-4111-8111-111111111111';
const DOCUMENT = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const KEY = `local/${TENANT}/${DOCUMENT}/${VERSION}`;

/** Refuses instantly; used only to show which mode touches the store at all. */
const DEAD_ENDPOINT = 'http://127.0.0.1:1';

const provider = (provisioning: 'ensure' | 'assume'): S3StorageProvider =>
  new S3StorageProvider({
    endpoint: DEAD_ENDPOINT,
    region: 'local',
    // Fixed fixture strings, not credentials: they feed an HMAC whose result
    // never leaves the process, and the endpoint they are scoped to refuses
    // every connection. They are literals so the signature is reproducible.
    accessKeyId: 'fx-access-key-id',
    secretAccessKey: 'fx-secret-access-key',
    bucket: 'fx-evidence-bucket',
    forcePathStyle: true,
    provisioning,
  });

describe('a hostile filename cannot break out of Content-Disposition', () => {
  // Each entry is a name that breaks the naive `filename="${name}"` form.
  const hostile = [
    { id: 'closing quote then a second directive', raw: 'a";attachment;filename="b.png' },
    { id: 'CRLF response splitting', raw: 'a.png\r\nSet-Cookie: session=stolen' },
    { id: 'bare LF', raw: 'a.png\nX-Injected: 1' },
    { id: 'backslash escape', raw: 'a\\".png' },
    { id: 'semicolon parameter break', raw: "a.png; filename*=UTF-8''evil" },
    { id: 'comma list break', raw: 'a.png, attachment; filename="evil"' },
    { id: 'NUL and control characters', raw: 'a\u0000\u0007\u001b.png' },
    { id: 'DEL', raw: 'a\u007f.png' },
    { id: 'windows path disclosure', raw: 'C:\\Users\\owner\\secret\\report.png' },
    { id: 'posix path traversal', raw: '../../../etc/passwd' },
    { id: 'dot-only name', raw: '..' },
    { id: 'empty', raw: '' },
  ] as const;

  it.each(hostile)('$id yields one header line with no unescaped structure', ({ raw }) => {
    const header = contentDispositionAttachment(raw);

    // A header VALUE that contains CR or LF is response splitting by definition.
    expect(header).not.toMatch(/[\r\n]/);
    // The value is `attachment; filename="…"; filename*=UTF-8''…` and nothing
    // else: exactly two `;` separators and exactly two `"` characters.
    expect(header.split(';')).toHaveLength(3);
    expect([...header].filter((character) => character === '"')).toHaveLength(2);
    expect(header.startsWith('attachment; filename="')).toBe(true);
    expect(header).toContain(`; filename*=UTF-8''`);

    // The quoted fallback is printable ASCII only, so no byte in it can be
    // re-interpreted by a header parser or a filesystem.
    const quoted = /^attachment; filename="([^"]*)"/.exec(header)?.[1] ?? null;
    expect(quoted).not.toBeNull();
    expect(quoted).toMatch(/^[ -~]+$/);
    expect(quoted).not.toContain('/');
    expect(quoted).not.toContain('\\');

    // The RFC 5987 half is percent-encoded to `attr-char`, so the same is true
    // of it: no quote, no semicolon, no comma, no space, no control character.
    //
    // `lastIndexOf`, not `indexOf`: a name that literally contains the text
    // `filename*=UTF-8''` survives as inert characters inside the quoted
    // fallback, and matching the first occurrence would read the fallback and
    // call it the extended parameter — a test that failed on correct output.
    const extended = header.slice(header.lastIndexOf(`filename*=UTF-8''`) + 17);
    expect(extended).toMatch(/^[A-Za-z0-9!#$&+\-.^_`|~%]*$/);
  });

  it('preserves a non-ASCII name in filename* rather than mangling or emitting it raw', () => {
    // The reason the sanitiser preserves non-ASCII: transliterating an Arabic
    // title would silently corrupt it. The obligation that creates — emit it as
    // RFC 5987, never as a bare `filename=` — is now discharged here.
    const header = contentDispositionAttachment('تقرير الاستلام.png');
    expect(header).toMatch(/^[ -~]+$/); // the header value itself is ASCII-safe
    expect(header).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(header.split("filename*=UTF-8''")[1] ?? '')).toBe(
      'تقرير الاستلام.png'
    );
  });

  it('is idempotent, so passing an already-sanitised name is harmless', () => {
    const once = contentDispositionAttachment('a";b.png');
    const twice = contentDispositionAttachment(safeContentDispositionFilename('a";b.png'));
    expect(twice).toBe(once);
  });

  it('a signed download URL carries the encoded disposition and no raw structure', async () => {
    const url = await provider('assume').signDownload({
      storageKey: KEY,
      expiresInSeconds: 60,
      downloadFileName: 'a";attachment;filename="b.png\r\nX: 1',
    });

    expect(url.method).toBe('GET');
    expect(url.url).not.toMatch(/[\r\n]/);
    const disposition = new URL(url.url).searchParams.get('response-content-disposition');
    expect(disposition).not.toBeNull();
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition?.startsWith('attachment; filename="')).toBe(true);
    // The break-out attempt survives only as inert text inside the quotes.
    expect(disposition?.split(';')).toHaveLength(3);
  });
});

describe('a raw storage key is not a capability', () => {
  // Access is authorized by the business link and the permission. The adapter
  // is the last component that could turn a string into bytes, so it refuses
  // anything that is not a key this platform builds — before it does anything
  // else, including reaching for the store.
  const rejected = [
    { id: 'traversal', key: `local/${TENANT}/${DOCUMENT}/../../other` },
    { id: 'absolute path', key: `/local/${TENANT}/${DOCUMENT}/${VERSION}` },
    { id: 'empty segment', key: `local//${DOCUMENT}/${VERSION}` },
    { id: 'too few segments', key: `local/${TENANT}/${DOCUMENT}` },
    { id: 'too many segments', key: `local/${TENANT}/${DOCUMENT}/${VERSION}/extra` },
    { id: 'non-uuid segment', key: 'local/acme-motors/invoice-2026/scan-1' },
    { id: 'business data in the key', key: `local/${TENANT}/${DOCUMENT}/VF1AAAAA000000001` },
    { id: 'trailing slash', key: `local/${TENANT}/${DOCUMENT}/${VERSION}/` },
    { id: 'too short', key: 'a/b' },
  ] as const;

  it.each(rejected)(
    '$id is refused by signUpload, signDownload and readObject',
    async ({ key }) => {
      // `ensure` is deliberate: the endpoint is dead, so if the key check did NOT
      // come first these would fail with a transport error instead, and the
      // assertion below on the error TYPE is what detects that.
      const subject = provider('ensure');
      await expect(subject.signUpload({ storageKey: key, expiresInSeconds: 60 })).rejects.toThrow(
        StorageKeyError
      );
      await expect(subject.signDownload({ storageKey: key, expiresInSeconds: 60 })).rejects.toThrow(
        StorageKeyError
      );
      await expect(subject.readObject(key, 1024)).rejects.toThrow(StorageKeyError);
    }
  );

  it('refuses an expiry outside the absolute bound, so no capability is unbounded', async () => {
    const subject = provider('assume');
    for (const expiresInSeconds of [
      0,
      -1,
      901,
      86_400,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      await expect(
        subject.signDownload({ storageKey: KEY, expiresInSeconds }),
        String(expiresInSeconds)
      ).rejects.toMatchObject({ name: 'StorageProviderError', kind: 'refused' });
    }
  });

  it('stamps an expiry on every capability it does issue', async () => {
    const before = Date.now();
    const signed = await provider('assume').signUpload({
      storageKey: KEY,
      expiresInSeconds: 120,
      contentType: 'image/png',
      contentLength: 1024,
    });
    expect(signed.method).toBe('PUT');
    expect(signed.provider).toBe('s3_compatible');
    expect(signed.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 120_000);
    // The signature itself carries the expiry, so the returned Date is not the
    // only thing bounding it.
    const query = new URL(signed.url).searchParams;
    expect(query.get('X-Amz-Expires')).toBe('120');
    expect(query.get('X-Amz-Signature')).toBeTruthy();
  });

  it('returns a URL and never a credential', async () => {
    const signed = await provider('assume').signDownload({
      storageKey: KEY,
      expiresInSeconds: 60,
    });
    expect(Object.keys(signed).sort()).toEqual(['expiresAt', 'method', 'provider', 'url']);
    // The signature is derived from the secret; the secret itself never appears.
    expect(signed.url).not.toContain('fx-secret-access-key');
    expect(JSON.stringify(signed)).not.toContain('fx-secret-access-key');
  });
});

describe('a credential failure is never reported as a retryable outage', () => {
  const cases = [
    { id: 'HeadBucket 403 with the generic name', error: { name: 'Forbidden' }, kind: 'denied' },
    {
      id: 'status 403 with an unknown name',
      error: { $metadata: { httpStatusCode: 403 } },
      kind: 'denied',
    },
    { id: 'status 401', error: { $metadata: { httpStatusCode: 401 } }, kind: 'denied' },
    { id: 'AccessDenied', error: { name: 'AccessDenied' }, kind: 'denied' },
    { id: 'InvalidAccessKeyId', error: { name: 'InvalidAccessKeyId' }, kind: 'denied' },
    { id: 'SignatureDoesNotMatch', error: { name: 'SignatureDoesNotMatch' }, kind: 'denied' },
    { id: 'expired credentials', error: { name: 'ExpiredToken' }, kind: 'denied' },
    { id: 'no credential resolved', error: { name: 'CredentialsProviderError' }, kind: 'denied' },
    { id: 'wire-format Code field', error: { Code: 'AccessDenied' }, kind: 'denied' },
    { id: 'HeadBucket 404', error: { name: 'NotFound' }, kind: 'missing' },
    { id: 'NoSuchBucket', error: { name: 'NoSuchBucket' }, kind: 'missing' },
    { id: 'status 404', error: { $metadata: { httpStatusCode: 404 } }, kind: 'missing' },
    {
      id: 'bucket owned already',
      error: { name: 'BucketAlreadyOwnedByYou' },
      kind: 'already-exists',
    },
    {
      id: 'connection refused',
      error: { name: 'Error', code: 'ECONNREFUSED' },
      kind: 'unavailable',
    },
    { id: 'server error', error: { $metadata: { httpStatusCode: 500 } }, kind: 'unavailable' },
    { id: 'not an object at all', error: null, kind: 'unavailable' },
  ] as const;

  it.each(cases)('$id classifies as $kind', ({ error, kind }) => {
    expect(classifyStorageFailure(error)).toBe(kind);
  });

  it('never answers "missing" for a denial, which is what auto-created a bucket', () => {
    for (const denied of [
      { name: 'Forbidden' },
      { name: 'AccessDenied' },
      { $metadata: { httpStatusCode: 403 } },
    ]) {
      expect(classifyStorageFailure(denied)).not.toBe('missing');
    }
  });
});

describe('bucket auto-creation is bound to the environment, not to a failure', () => {
  it('assume mode never touches the store, so production cannot create a bucket', async () => {
    // The endpoint refuses every connection. A signing call that resolves is
    // proof that no HeadBucket and no CreateBucket was attempted, because
    // either one would have had to reach it.
    const signed = await provider('assume').signDownload({
      storageKey: KEY,
      expiresInSeconds: 60,
    });
    expect(signed.url).toContain('X-Amz-Signature');
  });

  it('ensure mode does probe the store, so the two modes are genuinely different', async () => {
    // The contrast matters: without it, the test above would also pass for an
    // implementation that had simply stopped provisioning altogether.
    await expect(
      provider('ensure').signDownload({ storageKey: KEY, expiresInSeconds: 60 })
    ).rejects.toBeInstanceOf(StorageProviderError);
  }, 30_000);
});

describe('a stored object is read under a bound, not measured after the fact', () => {
  const chunk = (size: number): Uint8Array => new Uint8Array(size).fill(7);

  it('returns the bytes when the stream honours its declared length', async () => {
    const body = (async function* () {
      yield chunk(4);
      yield chunk(6);
    })();
    const bytes = await readBoundedBody(body, 10);
    expect(bytes.byteLength).toBe(10);
  });

  it('aborts a stream that exceeds the bound instead of buffering it', async () => {
    let produced = 0;
    const body = (async function* () {
      // A store that lies about ContentLength would otherwise be able to make
      // the process allocate without limit.
      for (let index = 0; index < 1_000; index += 1) {
        produced += 1;
        yield chunk(1_024);
      }
    })();
    await expect(readBoundedBody(body, 2_048)).rejects.toMatchObject({
      name: 'StorageProviderError',
      kind: 'refused',
    });
    // The read stopped early rather than draining the whole stream.
    expect(produced).toBeLessThan(10);
  });

  it('falls back to transformToByteArray and still applies the bound', async () => {
    const oversized = {
      transformToByteArray: async (): Promise<Uint8Array> => chunk(4_096),
    };
    await expect(readBoundedBody(oversized, 1_024)).rejects.toMatchObject({
      name: 'StorageProviderError',
      kind: 'refused',
    });
    const withinBound = {
      transformToByteArray: async (): Promise<Uint8Array> => chunk(512),
    };
    await expect(readBoundedBody(withinBound, 1_024)).resolves.toHaveLength(512);
  });
});
