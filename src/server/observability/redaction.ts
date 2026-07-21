/**
 * Log redaction and scrubbing (P1-13-BE-009, P1-13-SEC-006).
 *
 * Two independent layers, because either alone fails:
 *
 *  1. **Key-name redaction** replaces the value of any key whose name suggests a
 *     credential or restricted field, at every nesting depth. This catches the
 *     common accident: `log.info('ctx', { row })` where `row` happens to carry a
 *     token column.
 *  2. **Value-shape scrubbing** replaces strings that *look like* a credential
 *     even under an innocent key — JWTs, `Bearer` headers, PostgreSQL URLs with
 *     an inline password, PEM blocks. This catches the accident key-matching
 *     cannot: `log.info('failed', { detail: 'auth failed for Bearer eyJ...' })`.
 *
 * Restricted *business* data (personal identifiers, financial detail, document
 * contents) is not guessed at: the standard is that callers pass identifiers and
 * classifications, never row payloads. The key list below covers the columns the
 * classification registries mark restricted so an accidental spread still fails
 * closed.
 */

export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;
const MAX_STRING = 2048;

/**
 * Key fragments whose values are always replaced (case-insensitive substring).
 * Deliberately broad: a false redaction costs a debugging round-trip, a missed
 * one costs a credential.
 */
const SECRET_KEY_FRAGMENTS = [
  'authorization',
  'auth',
  'cookie',
  'credential',
  'dsn',
  'jwt',
  'key',
  'passwd',
  'password',
  'secret',
  'session',
  'signature',
  'token',
  'connectionstring',
  'database_url',
  // Restricted business classes — never in logs even if a row is spread in.
  'national_id',
  'passport',
  'tax_number',
  'iban',
  'card_number',
  'cvv',
  'bank_account',
  'date_of_birth',
  'birth_date',
  'document_content',
  'file_content',
  'payload_body',
] as const;

/** Value shapes that are credentials regardless of the key they arrived under. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
  /Basic\s+[A-Za-z0-9+/=]{12,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/gi, // URL with an inline password
  /sb_secret_[A-Za-z0-9_-]{8,}/g,
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub token
];

/**
 * Control characters (the C0 range plus DEL) — the log-forging vector. Built
 * from an escaped source string so this file never contains a raw control byte.
 */
const CONTROL_CHARACTERS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

function isSecretKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SECRET_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}

/** Replaces credential-shaped substrings and bounds runaway strings. */
export function scrubString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    // `lastIndex` is per-RegExp state; reset so a module-level /g pattern cannot
    // skip a match because of a previous call.
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  // Neutralise rather than drop: an escaped newline is still readable evidence,
  // but it can no longer forge a second log record.
  CONTROL_CHARACTERS.lastIndex = 0;
  out = out.replace(
    CONTROL_CHARACTERS,
    (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`
  );
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[truncated]` : out;
}

/**
 * Recursively redacts a value for logging. Errors become `{name, message}` —
 * a stack trace belongs in error monitoring, never in a log field that may be
 * shipped to a shared index.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redact(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSecretKey(key) ? REDACTED : redact(nested, depth + 1);
    }
    return out;
  }
  // Functions, symbols: never useful, occasionally leaky.
  return `[${typeof value}]`;
}

/** Exported for the scrubbing test suite and the security review. */
export const __redactionInternals = { SECRET_KEY_FRAGMENTS, SECRET_VALUE_PATTERNS, isSecretKey };
