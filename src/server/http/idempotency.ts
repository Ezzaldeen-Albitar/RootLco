/**
 * Idempotency service (P1-13-BE-012, FR-INT-002).
 *
 * Backed by `shared.idempotency_keys` exactly as the frozen schema defines it:
 *
 *   UNIQUE NULLS NOT DISTINCT (tenant_id, operation, idempotency_key)
 *   operation ~ '^[a-z][a-z0-9_]{1,62}$'
 *   char_length(idempotency_key) BETWEEN 8 AND 200
 *   response_document jsonb NOT NULL
 *
 * The three cases, and why each is handled the way it is:
 *
 *  - **Replay, same fingerprint** → return the stored response document without
 *    re-executing. The command already happened; running it again is the bug the
 *    header exists to prevent.
 *  - **Replay, different fingerprint** → `ERR-INT-001`. Same key, different
 *    request means the client reused a key by mistake (or an attacker is trying
 *    to graft a new command onto a trusted key). Executing either version would
 *    be wrong, so neither runs.
 *  - **Concurrent first use** → the unique index decides. Both callers insert;
 *    one wins, the loser catches `23505`, re-reads the winner's row and returns
 *    it. Exactly one execution, no advisory lock, no polling.
 *
 * The reservation row is written **inside the caller's transaction**, so a key
 * is durable if and only if the command it guards committed. Reserving in a
 * separate transaction would leave keys behind for commands that rolled back and
 * permanently block the retry.
 *
 * The fingerprint is a SHA-256 over the canonicalised request, so key reuse is
 * detected by content rather than by byte-identical formatting.
 */
import { createHash } from 'node:crypto';
import { AppFailure } from '../errors/app-failure';
import type { DbHandle } from '../db/transaction';
import { isSqlState, SQLSTATE } from '../db/repository';
import type { RequestContext } from '../context/request-context';
import { log } from '../observability/logger';

/** Header carrying the client's idempotency key. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

const KEY_MIN = 8;
const KEY_MAX = 200;
const OPERATION_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * Validates the inbound key against the database contract *before* the request
 * runs, so a key that could never be stored fails immediately with a clear code
 * rather than as a constraint violation after the work is done.
 */
export function requireIdempotencyKey(headers: Headers): string {
  const raw = headers.get(IDEMPOTENCY_HEADER);
  if (!raw) {
    throw new AppFailure('ERR-INT-002', {
      message: 'Idempotency-Key header is required for this operation',
    });
  }
  const key = raw.trim();
  if (key.length < KEY_MIN || key.length > KEY_MAX) {
    throw new AppFailure('ERR-INT-002', {
      message: `Idempotency-Key must be ${KEY_MIN}–${KEY_MAX} characters`,
    });
  }
  return key;
}

/**
 * Converts a registered operation id (`meta.ping`) into the database's operation
 * format (`meta_ping`). The dotted id is the API vocabulary; the underscored
 * form is what the CHECK constraint accepts.
 */
export function toOperationCode(operationId: string): string {
  const code = operationId.replace(/[.-]/g, '_').toLowerCase();
  if (!OPERATION_PATTERN.test(code)) {
    throw new Error(
      `Operation "${operationId}" does not map to a valid idempotency operation code`
    );
  }
  return code;
}

/** Stable JSON: object keys sorted at every depth, so formatting cannot alter the hash. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Length-prefixed framing, so no combination of component values can produce the
 * same byte sequence as a different combination. Without it, a path ending in a
 * separator and a body beginning with one would hash identically to their
 * neighbours — a fingerprint collision reachable from request data.
 */
function framed(parts: readonly string[]): string {
  return parts.map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('|');
}

/**
 * Identifies the fingerprint scheme. Any change to what is bound must change
 * this string, so keys written under an older scheme can never be mistaken for
 * a match under a newer one.
 */
const FINGERPRINT_SCHEME = 'rootlco.idempotency.v3.principal-and-target-bound';

/**
 * Field names whose VALUES must never be hashed into a persisted fingerprint.
 *
 * Matched against every key at every depth of the canonicalised body and route
 * parameters, case-insensitively. The list is deliberately about names rather
 * than about detected entropy: a value's secrecy is a property of what it means,
 * which only the schema author knows, and a runtime entropy heuristic would
 * approve a weak password that happened to look random.
 */
const SENSITIVE_WORDS = [
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'secret',
  'credential',
  'credentials',
  'otp',
  'totp',
  'pin',
  // NOT bare `mfa`. `iam/invitations` declares `mfaRequired: z.boolean()`, a
  // policy flag carrying no credential, and an early version of this list
  // refused that route outright. A guard that refuses correct code is a guard
  // somebody deletes, so the words below name the CODE, not the feature.
  'mfa code',
  'mfa secret',
  'recovery code',
  'security answer',
  'private key',
  'signing key',
  'client secret',
  'refresh token',
  'access token',
  'session token',
  'bearer token',
  'api key',
  'auth token',
] as const;

/**
 * Normalises a field name to space-separated lower-case words, so one word list
 * covers every spelling a schema might use.
 *
 * `newPassword`, `new_password`, `NEW-PASSWORD` and `newPassword2` all become
 * `new password …`. Without this the word list matched `password` and
 * `client_secret` but **not** `newPassword` or `oldPassword` — the two most
 * likely field names on a password-change endpoint, and the exact gap this
 * function exists to close. The guard's own tests caught it.
 */
function toWords(key: string): string {
  return ` ${key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/(\d+)/g, ' $1 ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/** True when any declared secret word appears as a whole word in the key. */
function isSensitiveKey(key: string): boolean {
  const words = toWords(key);
  return SENSITIVE_WORDS.some((word) => words.includes(` ${word} `));
}

/** Every key at every depth, so a secret nested inside an object is still seen. */
function* everyKey(value: unknown, depth = 0): Generator<string> {
  if (depth > 32 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) yield* everyKey(item, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    yield key;
    yield* everyKey(nested, depth + 1);
  }
}

/**
 * Refuses to fingerprint a request carrying secret material (CWE-916).
 *
 * `request_fingerprint` is a SHA-256 that is **persisted** in
 * `shared.idempotency_keys` and retained for the lifetime of the row. SHA-256 is
 * a fast unkeyed hash, so for any input drawn from a small space — a password, a
 * PIN, a six-digit OTP — a digest sitting in a table is an offline guessing
 * target, and the other framed components (tenant, principal, method, path) are
 * all knowable to anyone holding that table.
 *
 * ## Why this throws instead of redacting
 *
 * Silently dropping the field would keep the request working and destroy the
 * guarantee the fingerprint exists to provide: two requests under one key that
 * differ **only** in the secret would produce the same digest, so the second
 * would be served the first's stored response and the caller would be told an
 * operation succeeded that never ran. That is exactly the defect P1-15-SR-002
 * fixed for parameterised routes, and re-introducing it on the credential path
 * would be worse — a password change reported as done, with the old password
 * still live.
 *
 * So the combination is refused outright. An operation that genuinely needs both
 * idempotency and a secret field needs a dedicated one-time-operation contract,
 * which is a design decision with its own review, not something a fingerprint
 * should improvise at request time.
 *
 * ## Reachability at the time of writing
 *
 * Nothing hits this today, and it is not dead code. `route-handler.ts` computes
 * a fingerprint only when `operation.idempotent === true`; the two password
 * routes are `public: true` and declare no idempotency, and `requestFingerprint`
 * already refuses an unauthenticated principal. The one idempotent operation
 * carrying a token-shaped field, `attachments/versions`, carries an
 * `uploadToken` that is `base64url(JSON.stringify(claim))` — unsigned,
 * unencrypted, and not secret at all, which `attachment-policy.ts` states
 * plainly. The guard exists because none of that is enforced by anything: a
 * single `idempotent: true` added to a future credential route would have made
 * it true, quietly, with no test failing.
 */
export function assertNoSecretMaterial(
  value: unknown,
  where: 'body' | 'params',
  operationId?: string
): void {
  for (const key of everyKey(value)) {
    if (!isSensitiveKey(key)) continue;
    // The offending NAME is safe to report and is what a developer needs. The
    // value is never read, never logged and never placed in the error.
    throw new AppFailure('ERR-INT-003', {
      message:
        `Idempotent operation${operationId ? ` "${operationId}"` : ''} cannot be fingerprinted: ` +
        `${where} field "${key}" is secret material, and the fingerprint is persisted. ` +
        'Use a dedicated one-time-operation contract for this endpoint instead.',
    });
  }
}

/**
 * SHA-256 over the **principal- and target-bound** canonical request (ADV-04).
 *
 * The fingerprint binds tenant, principal, method, path **template**, resolved
 * **route parameters**, and canonicalised body. Binding the principal is what
 * stops one user of a tenant replaying another user's key: the stored
 * fingerprint will not match, so the second caller gets the ordinary
 * `ERR-INT-001` conflict instead of the first caller's response.
 *
 * ## Why the resolved parameters, and not only the path template (P1-15-SR-002)
 *
 * `operation.path` is the registered template — `/attachments/documents/{documentId}/links`.
 * Two requests naming **different documents** produce the same template, so
 * until the resolved parameters were bound, this held for any tenant:
 *
 *     POST /attachments/documents/A/links   Idempotency-Key: K   {body}   → 201
 *     POST /attachments/documents/B/links   Idempotency-Key: K   {body}   → 201
 *
 * and the second request executed nothing at all. It was served the first
 * request's stored response, so the caller was told document **B** had been
 * linked while only **A** ever was. A privileged command reporting success
 * without performing it is worse than an error, because nothing surfaces it.
 *
 * The scheme string changed with the binding, so a key written under v2 can
 * never be mistaken for a match under v3.
 *
 * ## Why the whole context is the parameter
 *
 * The principal is read from `RequestContext`, which `resolve-context.ts` builds
 * from the authenticated session and the database. It is frozen and no field of
 * it ever originates in a request body, query string, or header. Taking the
 * context rather than a `userId: string` is deliberate: a caller cannot pass an
 * attacker-supplied `body.userId` into a parameter that only accepts the
 * server-resolved context object, so principal spoofing is prevented by the
 * shape of the API rather than by reviewer vigilance.
 *
 * Fails closed: an operation reaching here without a resolved principal gets
 * `ERR-IAM-002` rather than an unbound fingerprint that any caller could match.
 */
export function requestFingerprint(
  context: RequestContext,
  input: {
    method: string;
    path: string;
    body: unknown;
    /** Resolved route parameters, already validated by the route's schema. */
    params?: Readonly<Record<string, string>>;
  }
): string {
  const tenantId = context.principal?.tenantId;
  const userId = context.principal?.userId;
  if (!tenantId || !userId) {
    throw new AppFailure('ERR-IAM-002', {
      message: 'Idempotent operations require an authenticated principal',
    });
  }

  // Refuse before hashing, never after: the digest is persisted, and a fast
  // unkeyed hash of low-entropy secret material is an offline guessing target
  // (CWE-916). See `assertNoSecretMaterial` for why this throws rather than
  // redacting the field.
  assertNoSecretMaterial(input.body, 'body');
  assertNoSecretMaterial(input.params ?? {}, 'params');

  return createHash('sha256')
    .update(
      framed([
        FINGERPRINT_SCHEME,
        tenantId,
        userId,
        input.method.toUpperCase(),
        input.path,
        // Canonicalised the same way as the body, so key order cannot change
        // the fingerprint and an absent parameter set hashes as `{}`.
        canonicalize(input.params ?? {}),
        canonicalize(input.body),
      ])
    )
    .digest('hex');
}

export interface IdempotencyOutcome<T> {
  readonly value: T;
  /** True when the stored response was returned instead of executing. */
  readonly replayed: boolean;
}

interface StoredRow {
  request_fingerprint: string;
  response_document: unknown;
  created_by: string;
}

async function readExisting(
  db: DbHandle,
  operationCode: string,
  key: string
): Promise<StoredRow | null> {
  const result = await db.query<StoredRow>(
    `SELECT request_fingerprint, response_document, created_by
       FROM shared.idempotency_keys
      WHERE tenant_id = $1 AND operation = $2 AND idempotency_key = $3`,
    [db.context.principal.tenantId, operationCode, key]
  );
  return result.rows[0] ?? null;
}

/**
 * The single conflict answer for every mismatch (ADV-04).
 *
 * A key reused with a different body and a key belonging to a different
 * principal produce the **same** `ERR-INT-001` with the same message. That is
 * deliberate: a distinct "this key is someone else's" answer would let a caller
 * probe which keys exist and who owns them, turning the conflict response into
 * an enumeration oracle. The distinction is recorded server-side instead.
 *
 * Nothing about the stored row reaches the caller — not the response document,
 * not the fingerprint, not the owner.
 */
function conflict(db: DbHandle, existing: StoredRow, operationCode: string): AppFailure {
  const principalMismatch = existing.created_by !== db.context.principal.userId;

  // Server-side evidence, correlation-scoped. Deliberately omitted: the
  // idempotency key, either fingerprint, the stored response, and the owning
  // principal's identifier — logs are read by more people than the response is.
  log.warn('Idempotency key conflict', {
    correlationId: db.context.correlationId,
    tenantRef: db.context.principal.tenantId,
    actorRef: db.context.principal.userId,
    operation: operationCode,
    errorCode: 'ERR-INT-001',
    result: 'failure',
    context: { reason: principalMismatch ? 'principal-mismatch' : 'payload-mismatch' },
  });

  return new AppFailure('ERR-INT-001', {
    message: 'Idempotency key was already used with a different request',
  });
}

/**
 * Runs `execute` at most once per (tenant, operation, key).
 *
 * `execute` receives the same handle, so its writes and the reservation row
 * commit together.
 */
export async function withIdempotency<T>(
  db: DbHandle,
  input: { operationId: string; key: string; fingerprint: string },
  execute: () => Promise<T>,
  serialize: (value: T) => unknown = (value) => value
): Promise<IdempotencyOutcome<T>> {
  const operationCode = toOperationCode(input.operationId);

  const existing = await readExisting(db, operationCode, input.key);
  if (existing) {
    // The fingerprint carries the principal, so a different user of the same
    // tenant fails this comparison and never reaches the stored response.
    if (existing.request_fingerprint !== input.fingerprint) {
      throw conflict(db, existing, operationCode);
    }
    return { value: existing.response_document as T, replayed: true };
  }

  const value = await execute();

  try {
    await db.query(
      `INSERT INTO shared.idempotency_keys
         (tenant_id, operation, idempotency_key, request_fingerprint, response_document, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        db.context.principal.tenantId,
        operationCode,
        input.key,
        input.fingerprint,
        JSON.stringify(serialize(value) ?? null),
        db.context.principal.userId,
      ]
    );
  } catch (error) {
    if (!isSqlState(error, SQLSTATE.uniqueViolation)) throw error;
    // Concurrent first use: another transaction committed this key while we were
    // executing. The unique index is the arbiter — re-read and return the winner.
    //
    // NOTE: this INSERT failing aborts the current transaction, so the re-read
    // must happen on a *fresh* transaction. The caller (`route-handler.ts`)
    // retries the request once for exactly this case; here we surface the
    // conflict so no partial state can commit.
    throw new IdempotencyRaceError(operationCode, input.key, input.fingerprint);
  }

  return { value, replayed: false };
}

/**
 * Signals that another transaction won the race for this key. The caller must
 * roll back and re-read on a new transaction — the current one is aborted.
 */
export class IdempotencyRaceError extends Error {
  public override readonly name = 'IdempotencyRaceError';
  constructor(
    public readonly operationCode: string,
    public readonly key: string,
    public readonly fingerprint: string
  ) {
    super(`Idempotency key race for ${operationCode}`);
  }
}

/** Re-reads a key after a race, on a fresh transaction. */
export async function resolveRace(
  db: DbHandle,
  race: IdempotencyRaceError
): Promise<{ response: unknown }> {
  const existing = await readExisting(db, race.operationCode, race.key);
  if (!existing) {
    // The winner rolled back after all. Nothing is stored, so nothing is
    // replayable; the caller should surface a retryable fault rather than
    // silently re-executing a command that may or may not have happened.
    throw new AppFailure('ERR-SYS-001', {
      message: 'Idempotency race resolved to no stored response',
    });
  }
  // The race winner may be a different principal. The fingerprint carries the
  // principal, so this comparison rejects that case as an ordinary conflict —
  // the loser never receives the winner's stored response.
  if (existing.request_fingerprint !== race.fingerprint) {
    throw conflict(db, existing, race.operationCode);
  }
  return { response: existing.response_document };
}
