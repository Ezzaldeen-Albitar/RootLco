/**
 * Storage keys and download filenames (P1-15).
 *
 * Pure functions, no database, no configuration lookup — every input is passed
 * in, so the rules can be unit-tested exhaustively without a container.
 *
 * ## The key is built, never accepted
 *
 * `docs/database/storage-key-convention.md` §3 fixes the shape:
 *
 * ```
 * <environment>/<tenant_id>/<document_id>/<version_segment>
 * ```
 *
 * Every segment is a token this function produces from server-resolved values.
 * A caller supplies none of them, which is what makes traversal (`../`),
 * cross-tenant collision, and business data in a key structurally impossible
 * rather than filtered: there is no input to filter. §4 of the convention
 * forbids a key from carrying an email, phone, name, VIN, or registration
 * number — none of those is an input here, and `assertKeyIsOpaque()` re-checks
 * the built key anyway, because a convention that is only enforced at review is
 * enforced until the first hurried change.
 */

/** Mirrors `ck_document_versions_storage_key_format` exactly. */
export const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/=-]*$/;
export const STORAGE_KEY_MIN_LENGTH = 8;
export const STORAGE_KEY_MAX_LENGTH = 512;

/** Environment tokens the storage-key convention recognises. */
export type StorageEnvironment = 'local' | 'development' | 'staging' | 'production';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class StorageKeyError extends Error {
  public override readonly name = 'StorageKeyError';
}

export interface BuildStorageKeyInput {
  readonly environment: StorageEnvironment;
  readonly tenantId: string;
  readonly documentId: string;
  /** Version identity. A UUID is used rather than `v<n>` so the key is stable
   *  before the version number is known — both forms satisfy the convention. */
  readonly versionId: string;
}

/**
 * Builds the storage key for one document version.
 *
 * Throws on a non-UUID identifier rather than interpolating it: the whole point
 * of the shape is that every segment is a known token, and a caller that passes
 * a business value must fail loudly rather than mint a key that leaks it into
 * storage inventories, backups, and replication logs.
 */
export function buildStorageKey(input: BuildStorageKeyInput): string {
  for (const [field, value] of [
    ['tenantId', input.tenantId],
    ['documentId', input.documentId],
    ['versionId', input.versionId],
  ] as const) {
    if (!UUID.test(value)) {
      // Never echoes the value — it may be exactly the business data §4 forbids.
      throw new StorageKeyError(`Storage key segment "${field}" must be a UUID`);
    }
  }

  const key = [
    input.environment,
    input.tenantId.toLowerCase(),
    input.documentId.toLowerCase(),
    input.versionId.toLowerCase(),
  ].join('/');

  assertKeyIsWellFormed(key);
  return key;
}

/**
 * Re-checks a built key against the database CHECK and the opacity rule.
 *
 * Deliberately applied to the *output*, not the input: it is the last line
 * before a value the database will freeze forever.
 */
export function assertKeyIsWellFormed(key: string): void {
  if (key.length < STORAGE_KEY_MIN_LENGTH || key.length > STORAGE_KEY_MAX_LENGTH) {
    throw new StorageKeyError(
      `Storage key length must be ${STORAGE_KEY_MIN_LENGTH}–${STORAGE_KEY_MAX_LENGTH} characters`
    );
  }
  if (!STORAGE_KEY_PATTERN.test(key)) {
    throw new StorageKeyError('Storage key contains characters the column CHECK refuses');
  }
  if (key.includes('..') || key.includes('//') || key.startsWith('/') || key.endsWith('/')) {
    // The charset alone permits `a/../b`; the convention does not.
    throw new StorageKeyError('Storage key contains a traversal or empty segment');
  }
  const segments = key.split('/');
  if (segments.length !== 4) {
    throw new StorageKeyError('Storage key must have exactly four segments');
  }
  for (const segment of segments.slice(1)) {
    if (!UUID.test(segment)) {
      throw new StorageKeyError('Storage key segments after the environment must be UUIDs');
    }
  }
}

/**
 * True when `key` belongs to `tenantId`.
 *
 * Used as a belt-and-braces check before signing: RLS already decided the
 * caller may see the version row, so this only catches an application bug that
 * paired the wrong row with the wrong tenant — but that bug is exactly the one
 * that would hand a caller another tenant's bytes.
 */
export function keyBelongsToTenant(key: string, tenantId: string): boolean {
  const segments = key.split('/');
  return segments.length === 4 && segments[1] === tenantId.toLowerCase();
}

/** Characters that must never reach a `Content-Disposition` header. */
const DISPOSITION_UNSAFE = /[\u0000-\u001F\u007F"\\;,]/gu;

export const MAX_FILE_NAME_LENGTH = 200;

/**
 * Produces a filename safe to place in `Content-Disposition: attachment`.
 *
 * Three separate hazards, and the naive `filename="${name}"` hits all three:
 *
 *  1. **Header injection.** CR/LF in the name splits the header. Every control
 *     character is stripped, not escaped.
 *  2. **Parameter injection.** `"`, `;`, `\` and `,` end or extend the parameter,
 *     which is how `x";attachment;filename="y` becomes two directives.
 *  3. **Path disclosure.** A browser-supplied name can carry a full local path.
 *     Only the last path segment is kept.
 *
 * Non-ASCII is preserved in the return value; the *caller* is responsible for
 * emitting it as RFC 5987 `filename*=UTF-8''…` rather than as a raw `filename=`.
 * Transliterating here would silently mangle Arabic filenames, which is a worse
 * outcome than requiring the caller to encode correctly.
 */
export function safeContentDispositionFilename(rawName: string): string {
  const lastSegment = rawName.split(/[\\/]/).pop() ?? '';
  const stripped = lastSegment.replace(DISPOSITION_UNSAFE, '').trim();
  const collapsed = stripped.replace(/\s+/g, ' ');
  // A name that is only dots would render as `.` or `..` in a file manager.
  const withoutDotOnly = /^\.+$/.test(collapsed) ? '' : collapsed;
  const bounded = withoutDotOnly.slice(0, MAX_FILE_NAME_LENGTH);
  return bounded.length > 0 ? bounded : 'attachment';
}

/** Anything outside printable US-ASCII cannot appear in a bare `filename=`. */
const NOT_PRINTABLE_ASCII = /[^ -~]/gu;

/**
 * Builds a complete, safe `Content-Disposition` value for a download.
 *
 * `safeContentDispositionFilename()` deliberately PRESERVES non-ASCII and says
 * in its own docblock that the caller must emit RFC 5987. That sentence was the
 * whole control, and a sentence is not a control: the S3 adapter interpolated
 * the name straight into `attachment; filename="${name}"`, so an Arabic title
 * produced a raw UTF-8 header value, and any caller that skipped the sanitiser
 * produced parameter injection. This function removes the requirement to
 * remember, because it sanitises again itself:
 *
 *  - `filename=` carries an ASCII-only fallback with every quote, backslash,
 *    semicolon, comma and control character already gone;
 *  - `filename*=UTF-8''…` carries the real name, percent-encoded to RFC 5987
 *    `attr-char` (which is narrower than `encodeURIComponent` — `!`, `*`, `'`,
 *    `(` and `)` are escaped explicitly).
 *
 * Callers pass a RAW name. Sanitising an already-sanitised name is idempotent,
 * so passing a sanitised one is harmless; passing a hostile one is safe.
 */
export function contentDispositionAttachment(rawName: string): string {
  const safe = safeContentDispositionFilename(rawName);
  const ascii = safe.replace(NOT_PRINTABLE_ASCII, '_').trim();
  const encoded = encodeURIComponent(safe).replace(
    /['()!*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii.length > 0 ? ascii : 'attachment'}"; filename*=UTF-8''${encoded}`;
}

/**
 * Normalises an uploaded filename for storage in `shared.documents`.
 *
 * The same sanitisation as the disposition form. The original is *not* kept
 * anywhere: a filename is business-supplied text, and a value that cannot be
 * rendered safely in a header should not be persisted only to be sanitised
 * again by every later reader.
 */
export function safeStoredFileName(rawName: string): string {
  return safeContentDispositionFilename(rawName);
}
