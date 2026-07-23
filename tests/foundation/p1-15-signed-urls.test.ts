/**
 * Phase 1-15 unit suite: signed object-storage URLs.
 *
 * A signed URL *is* the capability — whoever holds it can read or write the
 * bytes it names, with no session, no tenant context, and no RLS in the path.
 * So the guarantees the port claims (`provider/storage-provider.ts`) are the
 * only thing standing between a leaked or edited URL and another tenant's
 * documents, and every one of them has to be demonstrated rather than asserted
 * in a comment.
 *
 * What this file proves, using nothing but the adapter and its own verifier —
 * no network, no database, no configuration:
 *
 *  - **Issuance is honest.** Uploads get PUT, downloads get GET, every URL
 *    carries a future expiry, the result contains no credential, and the host is
 *    the RFC 2606 reserved `.invalid` TLD, so a URL that escapes cannot resolve
 *    anywhere in the world.
 *  - **Every field that matters is inside the signature.** Method, storage key
 *    (and therefore tenant), absolute expiry, and the content bindings. Each is
 *    edited in turn and the edited URL is refused. A download URL replayed as an
 *    upload, a URL re-pointed at another tenant, and a URL whose expiry was
 *    extended are all rejected — including the case that matters most, extending
 *    the expiry of an already-expired URL.
 *  - **Refusal happens before a URL exists.** An out-of-range TTL and a
 *    malformed or traversal key are refused at the adapter, not filtered later.
 *  - **The default configuration refuses.** `UnconfiguredStorageProvider` fails
 *    with `ERR-SYS-001` rather than inventing an object store; no production
 *    provider is provisioned (ADR-012 remains open).
 *  - **The signing key is the trust boundary.** Two adapters with different keys
 *    do not honour each other's URLs; two with the same key do.
 *
 * `verify()` is the adapter's own checker, which is exactly why the negative
 * cases are evidence: each tampered URL is handed to the same code path that
 * accepts a genuine one, so a rejection is an observed refusal rather than a
 * claim about a string.
 *
 * Fixture ids are the deterministic ones from `tests/db/helpers.ts` and every
 * other identifier is `fx_`-prefixed. They are repeated as literals instead of
 * imported because that helper opens PostgreSQL pools, and this tier must stay
 * runnable with no database.
 */
import { describe, expect, it } from 'vitest';
import {
  LocalStorageProvider,
  type LocalStorageBehaviour,
} from '@/modules/shared-services/provider/local-storage-provider';
import {
  ABSOLUTE_MAX_URL_TTL_SECONDS,
  StorageProviderError,
  UnconfiguredStorageProvider,
  type SignUrlRequest,
} from '@/modules/shared-services/provider/storage-provider';
import { buildStorageKey, StorageKeyError } from '@/modules/shared-services/domain/storage-key';
import { isAppFailure } from '@/server/errors/app-failure';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DOCUMENT_ID = 'd0c00000-0000-4000-8000-000000000001';
const VERSION_ID = 'e0e00000-0000-4000-8000-000000000001';

const BUCKET = 'fx_p1_15_signed_urls';
const OTHER_BUCKET = 'fx_p1_15_other_bucket';
/** Test-only HMAC material. Never a real key; the adapter generates one per process. */
const SIGNING_KEY = 'fx_signing_key_alpha_local_only';
const OTHER_SIGNING_KEY = 'fx_signing_key_beta_local_only';

/** Fixed instant. Only the "expiry is in the future" test reads the wall clock. */
const NOW_MS = 1_800_000_000_000;
const clock = (offsetMs = 0): Date => new Date(NOW_MS + offsetMs);

const KEY_A = buildStorageKey({
  environment: 'local',
  tenantId: TENANT_A,
  documentId: DOCUMENT_ID,
  versionId: VERSION_ID,
});
const KEY_B = buildStorageKey({
  environment: 'local',
  tenantId: TENANT_B,
  documentId: DOCUMENT_ID,
  versionId: VERSION_ID,
});

interface ProviderOptions {
  readonly bucket?: string;
  readonly signingKey?: string;
  readonly behaviour?: LocalStorageBehaviour;
}

/** Fixed-clock adapter: signatures and expiries are byte-identical across runs. */
function fixedProvider(options: ProviderOptions = {}): LocalStorageProvider {
  return new LocalStorageProvider({
    bucket: options.bucket ?? BUCKET,
    signingKey: options.signingKey ?? SIGNING_KEY,
    behaviour: options.behaviour ?? 'ok',
    now: () => clock(),
  });
}

function request(overrides: Partial<SignUrlRequest> = {}): SignUrlRequest {
  return { storageKey: KEY_A, expiresInSeconds: 300, ...overrides };
}

/** Applies one edit to an issued URL, exactly as an attacker holding it would. */
function edited(rawUrl: string, mutate: (url: URL) => void): string {
  const url = new URL(rawUrl);
  mutate(url);
  return url.toString();
}

function param(rawUrl: string, name: string): string {
  return new URL(rawUrl).searchParams.get(name) ?? '';
}

/** Returns the thrown value, or fails if the call unexpectedly succeeded. */
async function refusalOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error('expected the adapter to refuse, but the call resolved with a URL');
}

function assertProviderError(error: unknown): asserts error is StorageProviderError {
  if (!(error instanceof StorageProviderError)) {
    throw new Error(`expected a StorageProviderError, received: ${String(error)}`);
  }
}

function assertKeyError(error: unknown): asserts error is StorageKeyError {
  if (!(error instanceof StorageKeyError)) {
    throw new Error(`expected a StorageKeyError, received: ${String(error)}`);
  }
}

describe('signed URL issuance', () => {
  it('binds uploads to PUT and downloads to GET, each with an expiry in the real future', async () => {
    // Deliberately the wall clock: "expiresAt is in the future" is a claim about
    // now, and a fixed clock could only prove it about a number we chose.
    const provider = new LocalStorageProvider({ bucket: BUCKET, signingKey: SIGNING_KEY });
    const ttl = 120;

    const before = Date.now();
    const upload = await provider.signUpload(request({ expiresInSeconds: ttl }));
    const download = await provider.signDownload(request({ expiresInSeconds: ttl }));
    const after = Date.now();

    expect(upload.method).toBe('PUT');
    expect(download.method).toBe('GET');
    for (const signed of [upload, download]) {
      expect(signed.expiresAt.getTime()).toBeGreaterThan(after);
      expect(signed.expiresAt.getTime()).toBeLessThanOrEqual(after + ttl * 1000);
      expect(signed.expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttl * 1000);
    }
  });

  it('returns a URL, a method, an expiry and the adapter name — and nothing else', async () => {
    const signed = await fixedProvider().signUpload(request());
    // No access key, no token, no bucket policy crosses this boundary; the port
    // says nothing in the result is a credential, so the shape is pinned.
    expect(Object.keys(signed).sort()).toEqual(['expiresAt', 'method', 'provider', 'url']);
    expect(signed.provider).toBe('local_fake');
  });

  it('issues against the RFC 2606 reserved .invalid host, so the URL can never resolve', async () => {
    const signed = await fixedProvider().signDownload(request());
    const url = new URL(signed.url);

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('object-storage.invalid');
    // The property that matters is the TLD: RFC 2606 reserves `.invalid` and no
    // resolver may ever answer for it, which is what stops this adapter from
    // quietly becoming production.
    expect(url.hostname.endsWith('.invalid')).toBe(true);
    expect(url.pathname).toBe(`/${BUCKET}/${KEY_A}`);
    expect(url.searchParams.get('x-method')).toBe('GET');
  });
});

describe('verification of a URL this adapter issued', () => {
  it('accepts its own upload and download URLs', async () => {
    const provider = fixedProvider();
    const upload = await provider.signUpload(request());
    const download = await provider.signDownload(request());

    expect(provider.verify(upload.url)).toEqual({ valid: true });
    expect(provider.verify(download.url)).toEqual({ valid: true });
  });

  it('accepts a URL carrying content type, byte length and download filename', async () => {
    const provider = fixedProvider();
    const signed = await provider.signUpload(
      request({
        contentType: 'application/pdf',
        contentLength: 4096,
        downloadFileName: 'fx_inspection_report.pdf',
      })
    );

    expect(param(signed.url, 'x-content-type')).toBe('application/pdf');
    expect(param(signed.url, 'x-content-length')).toBe('4096');
    expect(param(signed.url, 'x-filename')).toBe('fx_inspection_report.pdf');
    expect(provider.verify(signed.url)).toEqual({ valid: true });
  });
});

describe('verification refuses an edited URL', () => {
  it('refuses a download URL replayed as an upload', async () => {
    const provider = fixedProvider();
    const download = await provider.signDownload(request());
    expect(provider.verify(download.url).valid).toBe(true);

    const replayed = edited(download.url, (url) => url.searchParams.set('x-method', 'PUT'));

    const result = provider.verify(replayed);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad-signature');
  });

  it('signs the method itself, so a PUT and a GET URL for the same request differ', async () => {
    const provider = fixedProvider();
    const upload = await provider.signUpload(request());
    const download = await provider.signDownload(request());

    // Same key, same clock, same expiry: the only input that differs is the
    // method, so an identical signature would mean the method is not bound.
    expect(param(upload.url, 'x-expires')).toBe(param(download.url, 'x-expires'));
    expect(param(upload.url, 'x-signature')).not.toBe(param(download.url, 'x-signature'));
  });

  it("refuses a URL re-pointed at another tenant's storage key", async () => {
    const provider = fixedProvider();
    const signed = await provider.signDownload(request({ storageKey: KEY_A }));
    expect(provider.verify(signed.url).valid).toBe(true);

    // KEY_B is a structurally valid key for TENANT_B — the edit an application
    // bug or a curious holder would actually attempt.
    const crossTenant = edited(signed.url, (url) => {
      url.pathname = `/${BUCKET}/${KEY_B}`;
    });

    expect(new URL(crossTenant).pathname).toContain(TENANT_B);
    const result = provider.verify(crossTenant);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad-signature');
  });

  it('refuses a URL whose expiry was extended, including after it has expired', async () => {
    const provider = fixedProvider();
    const signed = await provider.signDownload(request({ expiresInSeconds: 60 }));
    const originalExpiry = Number(param(signed.url, 'x-expires'));

    const extended = edited(signed.url, (url) => {
      url.searchParams.set('x-expires', String(originalExpiry + 86_400));
    });

    // Refused while the original URL is still live …
    expect(provider.verify(extended, clock()).valid).toBe(false);
    expect(provider.verify(extended, clock()).reason).toBe('bad-signature');
    // … and refused at the moment the extension was supposed to buy, which is
    // the whole point: the absolute expiry is signed, so it cannot be moved.
    expect(provider.verify(extended, clock(3_600_000)).valid).toBe(false);
  });

  it('refuses an altered signature, and a truncated one without throwing on length', async () => {
    const provider = fixedProvider();
    const signed = await provider.signDownload(request());
    const signature = param(signed.url, 'x-signature');
    expect(signature.length).toBeGreaterThan(0);

    const flipped = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    const altered = edited(signed.url, (url) => url.searchParams.set('x-signature', flipped));
    expect(provider.verify(altered)).toEqual({ valid: false, reason: 'bad-signature' });

    // `timingSafeEqual` throws on a length mismatch; a shortened signature must
    // still produce the ordinary refusal rather than an exception.
    const truncated = edited(signed.url, (url) =>
      url.searchParams.set('x-signature', signature.slice(0, -4))
    );
    expect(() => provider.verify(truncated)).not.toThrow();
    expect(provider.verify(truncated)).toEqual({ valid: false, reason: 'bad-signature' });
  });

  it('refuses a URL whose declared content type was changed', async () => {
    const provider = fixedProvider();
    const signed = await provider.signUpload(
      request({ contentType: 'application/pdf', contentLength: 4096 })
    );

    const swapped = edited(signed.url, (url) =>
      url.searchParams.set('x-content-type', 'text/html')
    );
    expect(provider.verify(swapped)).toEqual({ valid: false, reason: 'bad-signature' });

    const resized = edited(signed.url, (url) =>
      url.searchParams.set('x-content-length', '104857600')
    );
    expect(provider.verify(resized)).toEqual({ valid: false, reason: 'bad-signature' });
  });

  it('refuses a URL verified after its expiry, and accepts it at the expiring second', async () => {
    const provider = fixedProvider();
    const signed = await provider.signDownload(request({ expiresInSeconds: 60 }));

    expect(provider.verify(signed.url, clock(59_000))).toEqual({ valid: true });
    // The boundary is inclusive: expiry is checked as "later than", so the URL
    // is live through its final second and dead in the next one.
    expect(provider.verify(signed.url, clock(60_000))).toEqual({ valid: true });
    expect(provider.verify(signed.url, clock(61_000))).toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('refuses a URL that is unparseable, foreign-hosted, wrong-bucket, or unsigned', async () => {
    const provider = fixedProvider();
    const signed = await provider.signDownload(request());

    expect(provider.verify('not-a-url')).toEqual({ valid: false, reason: 'unparseable' });

    // A resolvable host is refused even though the signature is genuine: the
    // adapter answers only for URLs anchored to its own `.invalid` origin.
    const rehosted = signed.url.replace('https://object-storage.invalid', 'https://example.com');
    expect(provider.verify(rehosted)).toEqual({ valid: false, reason: 'wrong-host' });

    const otherBucket = fixedProvider({ bucket: OTHER_BUCKET });
    expect(otherBucket.verify(signed.url)).toEqual({ valid: false, reason: 'wrong-bucket' });

    const unsigned = edited(signed.url, (url) => url.searchParams.delete('x-signature'));
    expect(provider.verify(unsigned)).toEqual({ valid: false, reason: 'malformed' });
  });
});

describe('refusals that happen before any URL exists', () => {
  it('refuses an expiry above the absolute ceiling', async () => {
    const provider = fixedProvider();

    for (const seconds of [ABSOLUTE_MAX_URL_TTL_SECONDS + 1, ABSOLUTE_MAX_URL_TTL_SECONDS * 10]) {
      const error = await refusalOf(() =>
        provider.signUpload(request({ expiresInSeconds: seconds }))
      );
      assertProviderError(error);
      // `refused` is the non-retryable kind: a caller asking for a longer-lived
      // capability must not be retried into success.
      expect(error.kind).toBe('refused');
      expect(error.message).toContain(String(ABSOLUTE_MAX_URL_TTL_SECONDS));
    }
  });

  it('refuses an expiry below one second, including zero and negatives', async () => {
    const provider = fixedProvider();

    for (const seconds of [0, -1, -ABSOLUTE_MAX_URL_TTL_SECONDS]) {
      const error = await refusalOf(() =>
        provider.signDownload(request({ expiresInSeconds: seconds }))
      );
      assertProviderError(error);
      expect(error.kind).toBe('refused');
    }
  });

  it('refuses a non-integer expiry rather than truncating it', async () => {
    const provider = fixedProvider();

    for (const seconds of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = await refusalOf(() =>
        provider.signUpload(request({ expiresInSeconds: seconds }))
      );
      assertProviderError(error);
      expect(error.kind).toBe('refused');
    }
  });

  it('accepts exactly one second and exactly the ceiling', async () => {
    const provider = fixedProvider();

    // The bound must be inclusive at both ends, or the refusals above would be
    // proving an off-by-one instead of a policy.
    const shortest = await provider.signDownload(request({ expiresInSeconds: 1 }));
    const longest = await provider.signUpload(
      request({ expiresInSeconds: ABSOLUTE_MAX_URL_TTL_SECONDS })
    );

    expect(provider.verify(shortest.url)).toEqual({ valid: true });
    expect(provider.verify(longest.url)).toEqual({ valid: true });
    expect(longest.expiresAt.getTime() - clock().getTime()).toBe(
      ABSOLUTE_MAX_URL_TTL_SECONDS * 1000
    );
  });

  it('refuses a malformed storage key without echoing it back', async () => {
    const provider = fixedProvider();

    for (const storageKey of ['fx_short', 'local/AAA BBB/x/y', '/local/a/b/c', 'local/a/b/c/']) {
      const error = await refusalOf(() => provider.signUpload(request({ storageKey })));
      assertKeyError(error);
      // A key may carry the very data the convention forbids in a key, so the
      // refusal must not repeat it into a log line.
      expect(error.message).not.toContain(storageKey);
    }
  });

  it('refuses a traversal storage key before signing', async () => {
    const provider = fixedProvider();
    const traversal = `local/${TENANT_A}/../${VERSION_ID}`;

    const error = await refusalOf(() => provider.signDownload(request({ storageKey: traversal })));
    assertKeyError(error);
    expect(error.message).toMatch(/traversal/i);

    // Same for a key with an empty segment, which `..` resolution would collapse.
    const doubleSlash = await refusalOf(() =>
      provider.signDownload(request({ storageKey: `local//${DOCUMENT_ID}/${VERSION_ID}` }))
    );
    assertKeyError(doubleSlash);
  });
});

describe('simulated provider faults', () => {
  it('throws a retryable timeout for both operations when the adapter is set to time out', async () => {
    const provider = fixedProvider({ behaviour: 'timeout' });

    for (const call of [
      () => provider.signUpload(request()),
      () => provider.signDownload(request()),
    ]) {
      const error = await refusalOf(call);
      assertProviderError(error);
      expect(error.kind).toBe('timeout');
      expect(error.name).toBe('StorageProviderError');
    }
  });

  it('throws a retryable outage for both operations when the adapter is set to be down', async () => {
    const provider = fixedProvider({ behaviour: 'outage' });

    for (const call of [
      () => provider.signUpload(request()),
      () => provider.signDownload(request()),
    ]) {
      const error = await refusalOf(call);
      assertProviderError(error);
      expect(error.kind).toBe('outage');
    }
  });
});

describe('the unconfigured default provider', () => {
  it('refuses both operations with ERR-SYS-001 instead of pretending storage exists', async () => {
    const provider = new UnconfiguredStorageProvider();
    expect(provider.name).toBe('unconfigured');

    for (const call of [() => provider.signUpload(), () => provider.signDownload()]) {
      const error = await refusalOf(call);
      expect(isAppFailure(error)).toBe(true);
      if (!isAppFailure(error)) throw new Error('unreachable');

      // A caller cannot fix a platform with no storage configured, so this is a
      // system failure, not a request failure.
      expect(error.code).toBe('ERR-SYS-001');
      expect(error.status).toBeGreaterThanOrEqual(500);
      // The operator-facing setting is named in the developer message only …
      expect(error.message).toContain('STORAGE_PROVIDER');
      // … and nothing at all is offered to the caller.
      expect(error.safeDetails).toEqual({});
      const cause: unknown = error.cause;
      assertProviderError(cause);
      expect(cause.kind).toBe('refused');
    }
  });
});

describe('the signing key is the trust boundary', () => {
  it('does not honour a URL issued by an adapter with a different signing key', async () => {
    const alpha = fixedProvider({ signingKey: SIGNING_KEY });
    const beta = fixedProvider({ signingKey: OTHER_SIGNING_KEY });

    const fromAlpha = await alpha.signDownload(request());
    const fromBeta = await beta.signDownload(request());

    // Same bucket, same key, same clock — only the HMAC material differs.
    expect(new URL(fromAlpha.url).pathname).toBe(new URL(fromBeta.url).pathname);
    expect(param(fromAlpha.url, 'x-signature')).not.toBe(param(fromBeta.url, 'x-signature'));

    expect(beta.verify(fromAlpha.url)).toEqual({ valid: false, reason: 'bad-signature' });
    expect(alpha.verify(fromBeta.url)).toEqual({ valid: false, reason: 'bad-signature' });
  });

  it('honours a URL issued by a different instance holding the same signing key', async () => {
    // The control for the test above: rejection there is attributable to the
    // key, not to per-instance state, and a restarted process with the same
    // configuration still verifies URLs it issued before.
    const issuer = fixedProvider();
    const successor = fixedProvider();

    const signed = await issuer.signUpload(request());
    expect(successor.verify(signed.url)).toEqual({ valid: true });
  });
});
