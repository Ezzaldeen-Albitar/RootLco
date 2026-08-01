/**
 * Structured logging with secret redaction.
 *
 * P1-01-SEC-005: secrets must never appear in logs. Redaction is applied by key
 * name at every nesting level, so an accidental `logger.error('x', { env })` cannot
 * leak a service-role key.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Key fragments whose values are always replaced. Matched case-insensitively. */
const SECRET_KEY_PATTERNS = [
  'key',
  'secret',
  'token',
  'password',
  'passwd',
  'authorization',
  'auth',
  'cookie',
  'session',
  'credential',
  'connectionstring',
  'database_url',
  'dsn',
];

const REDACTED = '[REDACTED]';

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  // The anon key is public by design, but redacting it costs nothing and avoids
  // training anyone to expect keys in logs.
  return SECRET_KEY_PATTERNS.some((p) => k.includes(p));
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context ? { context: redact(context) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => emit('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => emit('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => emit('error', m, c),
};
