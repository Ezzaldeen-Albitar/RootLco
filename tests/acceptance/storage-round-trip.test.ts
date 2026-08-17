import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
/*
 * `storage-env.mjs` is a launcher module, deliberately plain JavaScript. It
 * carried a `@ts-expect-error` here, which the root `tsc` then reported as
 * TS2578 — UNUSED: the root project resolves the `.mjs` and its JSDoc types
 * without complaint, so the suppression was suppressing nothing and its own
 * presence was the error. Removed rather than widened; the import typechecks.
 */
import { resolveStorageEnv } from '../../scripts/dev/storage-env.mjs';
import { S3StorageProvider } from '../../apps/api/src/modules/shared-services/provider/s3-storage-provider';
import { buildStorageKey } from '../../apps/api/src/modules/shared-services/domain/storage-key';

/**
 * Is the acceptance environment's object store OPERATIONAL? (`P1-28-FE-017`)
 *
 * ## The question this exists to stop being answered by inspection
 *
 * `no-storage-provider` was a real blocker on the reception evidence chain, and
 * it was once declared resolved because `S3StorageProvider` had been written.
 * That is a different claim. A class that COULD be configured is not a store
 * that IS, and the difference is the whole chain: without one, a version is
 * registered, no object can be read back, and it stays `pending` for ever.
 *
 * So this proves it by doing it. The repository's OWN provider signs an upload
 * against the live endpoint, real bytes are PUT, the same provider reads them
 * back, and the digests are compared. Nothing is stubbed: a passing run has
 * moved an object.
 *
 * ## Why it SKIPS rather than fails without a store
 *
 * Hosted CI has no Supabase stack, and a red suite there would say the code is
 * broken when what is absent is an environment. The skip is not a soft pass —
 * `describe.skipIf` reports it by name, and the first case asserts that a
 * resolved configuration is COMPLETE, so a half-read one fails loudly instead of
 * quietly skipping.
 *
 * ## What it deliberately does not prove
 *
 * The rest of the chain. Registration, scanning, acceptance, linking and the
 * reception binding belong to the API and are exercised end to end by the
 * authenticated browser suite against the running application. This is the one
 * link that is CONFIGURATION rather than code — and the one that has been
 * asserted wrongly before.
 */

const env = resolveStorageEnv() as Record<string, string> | null;

/** A one-pixel PNG: a real decodable image, so a scanner would accept it. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe.skipIf(env === null)('the acceptance object store moves a real object', () => {
  it('is configured COMPLETELY, or not at all', () => {
    /*
     * A partial fragment is worse than none: `s3_compatible` missing one
     * credential throws at composition and takes the whole API down. The
     * resolver is built to answer `null` rather than a half-configuration, and
     * this is what holds it to that.
     */
    expect(env).not.toBeNull();
    for (const name of [
      'STORAGE_PROVIDER',
      'STORAGE_S3_ENDPOINT',
      'STORAGE_S3_ACCESS_KEY_ID',
      'STORAGE_S3_SECRET_ACCESS_KEY',
      'STORAGE_S3_REGION',
      'STORAGE_BUCKET',
    ]) {
      expect(env?.[name], name).toBeTruthy();
    }
    expect(env?.['STORAGE_PROVIDER']).toBe('s3_compatible');

    // Not one of these may be published to a browser. A `NEXT_PUBLIC_` prefix is
    // inlined into the client bundle at build time, so the prefix IS the leak.
    for (const name of Object.keys(env ?? {})) expect(name.startsWith('NEXT_PUBLIC_')).toBe(false);
  });

  it('signs, stores and reads back the same bytes', async () => {
    const configured = env as Record<string, string>;
    const provider = new S3StorageProvider({
      endpoint: configured['STORAGE_S3_ENDPOINT'] as string,
      region: configured['STORAGE_S3_REGION'] as string,
      accessKeyId: configured['STORAGE_S3_ACCESS_KEY_ID'] as string,
      secretAccessKey: configured['STORAGE_S3_SECRET_ACCESS_KEY'] as string,
      bucket: configured['STORAGE_BUCKET'] as string,
      forcePathStyle: configured['STORAGE_S3_FORCE_PATH_STYLE'] === 'true',
      provisioning: 'ensure',
    });

    // Built through the real builder, so the adapter's own "reject a key I did
    // not issue" check is exercised rather than bypassed by a hand-written path.
    const storageKey = buildStorageKey({
      environment: 'local',
      tenantId: '00000000-0000-4000-8000-000000000001',
      documentId: '11111111-1111-4111-8111-111111111111',
      versionId: `22222222-2222-4222-8222-${String(Date.now()).slice(-12).padStart(12, '0')}`,
    });

    const signed = await provider.signUpload({
      storageKey,
      expiresInSeconds: 300,
      contentType: 'image/png',
      contentLength: PNG.byteLength,
    });
    expect(signed.method).toBe('PUT');
    // Short-lived by construction. A URL that outlives the act is a bearer
    // credential sitting in whatever held it.
    expect(signed.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);

    const put = await fetch(signed.url, {
      method: signed.method,
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array(PNG),
    });
    expect(put.ok, `the store refused the object: ${put.status}`).toBe(true);

    const object = await provider.readObject(storageKey, PNG.byteLength);
    expect(object.contentLength).toBe(PNG.byteLength);
    expect(createHash('sha256').update(object.bytes).digest('hex')).toBe(
      createHash('sha256').update(PNG).digest('hex')
    );
  }, 60_000);

  it('refuses a download URL replayed as an upload', async () => {
    /*
     * The property that makes a signed URL a capability rather than a key: it is
     * bound to ONE method. Proved against the live store rather than against the
     * deterministic fake, because this is the adapter that will actually serve
     * the Owner acceptance environment.
     */
    const configured = env as Record<string, string>;
    const provider = new S3StorageProvider({
      endpoint: configured['STORAGE_S3_ENDPOINT'] as string,
      region: configured['STORAGE_S3_REGION'] as string,
      accessKeyId: configured['STORAGE_S3_ACCESS_KEY_ID'] as string,
      secretAccessKey: configured['STORAGE_S3_SECRET_ACCESS_KEY'] as string,
      bucket: configured['STORAGE_BUCKET'] as string,
      forcePathStyle: configured['STORAGE_S3_FORCE_PATH_STYLE'] === 'true',
      provisioning: 'assume',
    });

    const storageKey = buildStorageKey({
      environment: 'local',
      tenantId: '00000000-0000-4000-8000-000000000001',
      documentId: '11111111-1111-4111-8111-111111111111',
      versionId: `33333333-3333-4333-8333-${String(Date.now()).slice(-12).padStart(12, '0')}`,
    });

    const download = await provider.signDownload({ storageKey, expiresInSeconds: 120 });
    const replayed = await fetch(download.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array(PNG),
    });
    expect(replayed.ok, 'a download URL was accepted as an upload').toBe(false);
  }, 60_000);
});
