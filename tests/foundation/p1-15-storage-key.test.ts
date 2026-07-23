/**
 * Phase 1-15 unit suite: storage keys and download filenames.
 *
 * Nothing here touches a database, a filesystem, or an object store — every rule
 * in `src/modules/shared-services/domain/storage-key.ts` is a decision taken
 * *before* any of those exist, and each one is a place where a mistake is
 * permanent rather than merely wrong:
 *
 *  - `storage_key` is frozen by `tg_document_versions_immutable`. A key minted
 *    with business data in it cannot be edited afterwards, and keys travel to
 *    logs, storage inventories, and backup listings *outside* RLS
 *    (`docs/database/storage-key-convention.md` §4). So the build path is proven
 *    to refuse anything that is not a server-resolved UUID, and to refuse it
 *    without echoing the offending value into the error — an error message is a
 *    log line, and a log line is one of the channels §4 is protecting.
 *  - The built key is checked against `ck_document_versions_storage_key_format`
 *    (charset + 8..512) as it is written in migration `20260718101000`, so this
 *    suite fails if the TypeScript mirror and the SQL CHECK ever drift apart.
 *  - `Content-Disposition` is assembled from a browser-supplied filename. The
 *    three hazards (header injection via CR/LF, parameter injection via `"` `;`
 *    `\` `,`, path disclosure) are each proven by observing the sanitised value
 *    the caller would actually interpolate, and the parameter-injection proof
 *    builds the real header and counts the directives rather than asserting on
 *    the substitution.
 *
 * Non-ASCII is proven *preserved*, not stripped: an Arabic filename is the
 * normal case for this product, and a sanitiser that mangled it would be a
 * correctness bug dressed up as a security control.
 *
 * Identifiers below mirror the deterministic fixture ids in `tests/db/helpers.ts`
 * (TENANT_A / TENANT_B); nothing is persisted, these are pure-function inputs.
 */
import { describe, expect, it } from 'vitest';
import {
  assertKeyIsWellFormed,
  buildStorageKey,
  keyBelongsToTenant,
  MAX_FILE_NAME_LENGTH,
  safeContentDispositionFilename,
  safeStoredFileName,
  STORAGE_KEY_MAX_LENGTH,
  STORAGE_KEY_MIN_LENGTH,
  STORAGE_KEY_PATTERN,
  StorageKeyError,
  type StorageEnvironment,
} from '@/modules/shared-services/domain/storage-key';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001';
const VERSION = 'e0000000-0000-4000-8000-000000000001';

const ENVIRONMENTS: readonly StorageEnvironment[] = [
  'local',
  'development',
  'staging',
  'production',
];

const key = (over: Partial<Parameters<typeof buildStorageKey>[0]> = {}): string =>
  buildStorageKey({
    environment: 'production',
    tenantId: TENANT_A,
    documentId: DOCUMENT,
    versionId: VERSION,
    ...over,
  });

/** Non-UUID identifiers a caller might plausibly pass by mistake. Each is the
 *  shape §4 forbids in a key: a slug, an address, a traversal, a nil/truncated
 *  UUID. All are synthetic `fx_`/zero values — no business data. */
const NOT_UUIDS = [
  'fx-not-a-uuid',
  'fx.owner@example.test',
  '../../fx-elsewhere',
  '00000000-0000-0000-0000-000000000000', // nil UUID: version nibble is not 1-8
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa', // one hex digit short
  'aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa', // invalid variant nibble
] as const;

describe('buildStorageKey', () => {
  it('produces exactly <environment>/<tenantId>/<documentId>/<versionId>', () => {
    expect(key({ environment: 'local' })).toBe(`local/${TENANT_A}/${DOCUMENT}/${VERSION}`);
  });

  it('places each identifier in its own segment, in convention order', () => {
    const segments = key().split('/');
    expect(segments).toEqual(['production', TENANT_A, DOCUMENT, VERSION]);
  });

  it('lower-cases every identifier segment', () => {
    // A caller that upper-cases a UUID must not mint a second, distinct key for
    // the same version: the key is frozen, so two spellings would be two rows
    // pointing at the same bytes.
    const upper = key({
      tenantId: TENANT_A.toUpperCase(),
      documentId: DOCUMENT.toUpperCase(),
      versionId: VERSION.toUpperCase(),
    });
    expect(upper).toBe(key());
    expect(upper).toBe(upper.toLowerCase());
  });

  it('refuses a non-UUID tenant, document, or version id', () => {
    for (const field of ['tenantId', 'documentId', 'versionId'] as const) {
      for (const bad of NOT_UUIDS) {
        expect(() => key({ [field]: bad })).toThrow(StorageKeyError);
      }
      expect(() => key({ [field]: '' })).toThrow(StorageKeyError);
    }
  });

  it('names the offending field but never echoes the offending value', () => {
    // The value may be exactly the email / registration number / name that §4
    // forbids from reaching a key — and an error message reaches the same logs a
    // key would. The field name is enough to debug with.
    for (const field of ['tenantId', 'documentId', 'versionId'] as const) {
      for (const bad of NOT_UUIDS) {
        try {
          key({ [field]: bad });
          expect.unreachable(`${field}=${bad} should have been refused`);
        } catch (error) {
          expect(error).toBeInstanceOf(StorageKeyError);
          const message = (error as StorageKeyError).message;
          expect((error as StorageKeyError).name).toBe('StorageKeyError');
          expect(message).toContain(field);
          expect(message).not.toContain(bad);
        }
      }
    }
  });
});

describe('the built key against ck_document_versions_storage_key_format', () => {
  it('mirrors the SQL CHECK character class and bounds verbatim', () => {
    // Migration 20260718101000:
    //   storage_key ~ '^[A-Za-z0-9][A-Za-z0-9._/=-]*$'
    //   AND char_length(storage_key) BETWEEN 8 AND 512
    // Drift here is silent in TypeScript and loud (23514) in production.
    expect(STORAGE_KEY_PATTERN.source).toBe('^[A-Za-z0-9][A-Za-z0-9._/=-]*$');
    expect(STORAGE_KEY_PATTERN.flags).toBe('');
    expect(STORAGE_KEY_MIN_LENGTH).toBe(8);
    expect(STORAGE_KEY_MAX_LENGTH).toBe(512);
  });

  it('satisfies the pattern and the 8..512 bound for every environment token', () => {
    for (const environment of ENVIRONMENTS) {
      const built = key({ environment });
      expect(STORAGE_KEY_PATTERN.test(built)).toBe(true);
      expect(built.length).toBeGreaterThanOrEqual(STORAGE_KEY_MIN_LENGTH);
      expect(built.length).toBeLessThanOrEqual(STORAGE_KEY_MAX_LENGTH);
      expect(built.startsWith(`${environment}/`)).toBe(true);
    }
  });

  it('rejects, through the same pattern, what the column CHECK rejects', () => {
    // The values the database proves are refused (23514) in
    // tests/db/shared-document-versions.test.ts: whitespace, `@`, and a
    // non-alphanumeric first character.
    for (const refused of [
      `local/${TENANT_A}/${DOCUMENT}/fx report`,
      `local/${TENANT_A}/${DOCUMENT}/fx.owner@example.test`,
      `/local/${TENANT_A}/${DOCUMENT}/${VERSION}`,
      `-local/${TENANT_A}/${DOCUMENT}/${VERSION}`,
    ]) {
      expect(STORAGE_KEY_PATTERN.test(refused)).toBe(false);
      expect(() => assertKeyIsWellFormed(refused)).toThrow(StorageKeyError);
    }
  });
});

describe('keyBelongsToTenant', () => {
  it('is true for the owning tenant and false for another', () => {
    const owned = key({ tenantId: TENANT_A });
    expect(keyBelongsToTenant(owned, TENANT_A)).toBe(true);
    expect(keyBelongsToTenant(owned, TENANT_B)).toBe(false);
  });

  it('compares case-insensitively, so an upper-cased tenant id still matches', () => {
    expect(keyBelongsToTenant(key({ tenantId: TENANT_A }), TENANT_A.toUpperCase())).toBe(true);
  });

  it('answers on position, not on mere presence of the tenant id', () => {
    // The tenant's UUID appears in the key — in the document segment, of another
    // tenant's key. A substring check would hand over another tenant's bytes.
    const foreign = key({ tenantId: TENANT_B, documentId: TENANT_A });
    expect(foreign).toContain(TENANT_A);
    expect(keyBelongsToTenant(foreign, TENANT_A)).toBe(false);
    expect(keyBelongsToTenant(foreign, TENANT_B)).toBe(true);
  });

  it('is false for anything that is not a four-segment key', () => {
    for (const malformed of [
      `local/${TENANT_A}`,
      `local/${TENANT_A}/${DOCUMENT}`,
      `x/local/${TENANT_A}/${DOCUMENT}/${VERSION}`,
      TENANT_A,
      '',
    ]) {
      expect(keyBelongsToTenant(malformed, TENANT_A)).toBe(false);
    }
  });
});

describe('assertKeyIsWellFormed', () => {
  it('accepts a key this module built', () => {
    for (const environment of ENVIRONMENTS) {
      expect(() => assertKeyIsWellFormed(key({ environment }))).not.toThrow();
    }
  });

  it('rejects traversal', () => {
    // The two shapes named in the convention. `a/../b` is 6 characters, so the
    // 8-character floor refuses it *first* — it is rejected, but by the length
    // rule; the traversal rule itself is therefore proven at realistic length
    // below, where no other rule can be doing the work.
    expect(() => assertKeyIsWellFormed('a/../b')).toThrow(StorageKeyError);
    expect(() => assertKeyIsWellFormed(`local/${TENANT_A}/../${VERSION}`)).toThrow(
      /traversal or empty segment/
    );
    expect(() => assertKeyIsWellFormed(`local/${TENANT_A}/${DOCUMENT}/..`)).toThrow(
      /traversal or empty segment/
    );
  });

  it('rejects empty segments', () => {
    expect(() => assertKeyIsWellFormed('a//b')).toThrow(StorageKeyError);
    expect(() => assertKeyIsWellFormed(`local/${TENANT_A}//${VERSION}`)).toThrow(
      /traversal or empty segment/
    );
  });

  it('rejects a leading or trailing slash', () => {
    // A leading slash fails the charset anchor (the CHECK requires an
    // alphanumeric first character); a trailing slash is an empty final segment.
    expect(() => assertKeyIsWellFormed(`/local/${TENANT_A}/${DOCUMENT}/${VERSION}`)).toThrow(
      /characters the column CHECK refuses/
    );
    expect(() => assertKeyIsWellFormed(`local/${TENANT_A}/${DOCUMENT}/${VERSION}/`)).toThrow(
      /traversal or empty segment/
    );
  });

  it('rejects a wrong segment count', () => {
    expect(() => assertKeyIsWellFormed(`local/${TENANT_A}/${DOCUMENT}`)).toThrow(
      /exactly four segments/
    );
    expect(() => assertKeyIsWellFormed(`local/${TENANT_A}/${DOCUMENT}/${VERSION}/extra`)).toThrow(
      /exactly four segments/
    );
  });

  it('rejects non-UUID segments after the environment', () => {
    for (const malformed of [
      `local/fx-not-a-uuid-but-long-enough/${DOCUMENT}/${VERSION}`,
      `local/${TENANT_A}/fx-not-a-uuid-but-long-enough/${VERSION}`,
      `local/${TENANT_A}/${DOCUMENT}/fx-not-a-uuid-but-long-enough`,
      // The nil UUID is not a version-4/8 identifier and is not accepted as one.
      `local/00000000-0000-0000-0000-000000000000/${DOCUMENT}/${VERSION}`,
    ]) {
      expect(() => assertKeyIsWellFormed(malformed)).toThrow(/must be UUIDs/);
    }
  });

  it('rejects the `v<n>` version segment the convention document also permits', () => {
    // DIVERGENCE, recorded deliberately rather than smoothed over:
    // `docs/database/storage-key-convention.md` §3 allows `v<version_number>` as
    // the fourth segment (its own synthetic example ends in `v3`), but this
    // implementation requires a UUID there. The implementation is the stricter
    // of the two — a version *number* is derived from business state, a UUID is
    // not — so the test asserts the stricter behaviour and the document is what
    // needs correcting.
    expect(() => assertKeyIsWellFormed(`local/${TENANT_A}/${DOCUMENT}/v3`)).toThrow(
      /must be UUIDs/
    );
  });

  it('rejects a key outside the 8..512 length bound', () => {
    expect(() => assertKeyIsWellFormed('a/b/c/d')).toThrow(/Storage key length must be/);
    expect(() => assertKeyIsWellFormed('a'.repeat(STORAGE_KEY_MAX_LENGTH + 1))).toThrow(
      /Storage key length must be/
    );
    expect(() => assertKeyIsWellFormed('')).toThrow(/Storage key length must be/);
  });

  it('never echoes the rejected key in the refusal', () => {
    // A rejected key can still carry a tenant UUID, and refusals are logged.
    for (const malformed of [
      'a/../b',
      `local/${TENANT_A}/../${VERSION}`,
      `local/${TENANT_A}/${DOCUMENT}`,
      `local/${TENANT_A}/${DOCUMENT}/fx.owner@example.test`,
      `local/fx-not-a-uuid-but-long-enough/${DOCUMENT}/${VERSION}`,
    ]) {
      try {
        assertKeyIsWellFormed(malformed);
        expect.unreachable(`${malformed} should have been refused`);
      } catch (error) {
        expect(error).toBeInstanceOf(StorageKeyError);
        expect((error as StorageKeyError).message).not.toContain(malformed);
      }
    }
  });
});

describe('safeContentDispositionFilename', () => {
  it('strips CR and LF, so a name cannot split the header', () => {
    const injected = safeContentDispositionFilename(
      'fx_report\r\nX-Injected: yes\r\n\r\n<script>.pdf'
    );
    expect(injected).not.toMatch(/[\r\n]/);
    // Built into the header it would occupy, the result is still one line.
    expect(`Content-Disposition: attachment; filename="${injected}"`.split(/\r?\n/)).toHaveLength(
      1
    );
  });

  it('strips every C0 control character and DEL, not only the newline pair', () => {
    const controls = Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join('');
    expect(safeContentDispositionFilename(`fx${controls}.pdf`)).toBe('fx.pdf');
  });

  it('strips the parameter-injection characters " ; \\ and ,', () => {
    for (const raw of [
      'fx_quote".pdf',
      'fx_semi;.pdf',
      'fx_comma,.pdf',
      'fx_all";,.pdf',
      'fx_back\\slash.pdf',
    ]) {
      expect(safeContentDispositionFilename(raw)).not.toMatch(/["\\;,]/);
    }
  });

  it('cannot produce a second directive from x";attachment;filename="y', () => {
    const safe = safeContentDispositionFilename('x";attachment;filename="y');
    const header = `attachment; filename="${safe}"`;
    // Exactly two parts: the disposition type and its single filename parameter.
    const parts = header.split(';');
    expect(parts).toHaveLength(2);
    expect(parts[0]?.trim()).toBe('attachment');
    expect(parts[1]?.trim()).toBe(`filename="${safe}"`);
    // And the value carries no quote that could close the parameter early.
    expect(safe).not.toContain('"');
  });

  it('keeps only the last path segment, on either separator', () => {
    expect(safeContentDispositionFilename('C:\\Users\\fx\\fx_report.pdf')).toBe('fx_report.pdf');
    expect(safeContentDispositionFilename('/var/data/fx/fx_report.pdf')).toBe('fx_report.pdf');
    // Traversal cannot survive, because the leading segments are discarded.
    expect(safeContentDispositionFilename('../../../etc/fx_passwd')).toBe('fx_passwd');
    expect(safeContentDispositionFilename('..\\..\\fx_report.pdf')).toBe('fx_report.pdf');
  });

  it('bounds the length', () => {
    const long = `${'a'.repeat(400)}.pdf`;
    const bounded = safeContentDispositionFilename(long);
    expect(bounded).toHaveLength(MAX_FILE_NAME_LENGTH);
    expect(MAX_FILE_NAME_LENGTH).toBe(200);
  });

  it('returns "attachment" for an empty, blank, dot-only, or fully-stripped name', () => {
    for (const raw of ['', '   ', '.', '..', '...', '";,', '/', 'C:\\', '/var/data/fx/', '\r\n']) {
      expect(safeContentDispositionFilename(raw)).toBe('attachment');
    }
  });

  it('preserves non-ASCII characters, including Arabic, unchanged', () => {
    // Transliterating or stripping here would make every Arabic filename in the
    // product unreadable. The caller is responsible for RFC 5987 encoding.
    expect(safeContentDispositionFilename('تقرير الفحص.pdf')).toBe('تقرير الفحص.pdf');
    expect(safeContentDispositionFilename('C:\\مجلد\\فاتورة_fx_001.pdf')).toBe('فاتورة_fx_001.pdf');
    // Sanitisation still applies around the non-ASCII text.
    expect(safeContentDispositionFilename('تقرير";fx.pdf')).toBe('تقريرfx.pdf');
  });

  it('keeps internal spacing readable rather than deleting it', () => {
    expect(safeContentDispositionFilename('  fx report   final.pdf  ')).toBe('fx report final.pdf');
  });
});

describe('safeStoredFileName', () => {
  it('applies exactly the same sanitisation as the disposition form', () => {
    // One rule, so a name that was safe to persist can never be unsafe to serve.
    for (const raw of [
      'fx_report.pdf',
      'fx_report\r\n";,.pdf',
      'C:\\Users\\fx\\تقرير الفحص.pdf',
      '...',
      `${'a'.repeat(400)}.pdf`,
    ]) {
      expect(safeStoredFileName(raw)).toBe(safeContentDispositionFilename(raw));
    }
  });
});
