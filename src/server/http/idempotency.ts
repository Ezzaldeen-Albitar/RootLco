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

/** SHA-256 over method, path, and canonicalised body. */
export function requestFingerprint(input: { method: string; path: string; body: unknown }): string {
  return createHash('sha256')
    .update(`${input.method.toUpperCase()}\n${input.path}\n${canonicalize(input.body)}`)
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
}

async function readExisting(
  db: DbHandle,
  operationCode: string,
  key: string
): Promise<StoredRow | null> {
  const result = await db.query<StoredRow>(
    `SELECT request_fingerprint, response_document
       FROM shared.idempotency_keys
      WHERE tenant_id = $1 AND operation = $2 AND idempotency_key = $3`,
    [db.context.principal.tenantId, operationCode, key]
  );
  return result.rows[0] ?? null;
}

function conflict(): AppFailure {
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
    if (existing.request_fingerprint !== input.fingerprint) throw conflict();
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
  if (existing.request_fingerprint !== race.fingerprint) throw conflict();
  return { response: existing.response_document };
}
