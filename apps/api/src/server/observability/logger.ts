/**
 * Structured logging (P1-13-BE-009).
 *
 * Pino, emitting one JSON object per line to stdout. No transport, no file, no
 * network sink: the deployment model is "the process writes JSON, the platform
 * collects it" (ADR-012 — only Local exists today), and a log shipper configured
 * here would be configuration for an environment that does not exist.
 *
 * Every record carries the standard field set so a correlation ID is searchable
 * across web and worker without per-call-site discipline:
 *
 *   time · level · env · service · module · operation · correlationId ·
 *   causationId? · tenantRef? · actorRef? · durationMs? · result? · errorCode?
 *
 * **Tenant and actor appear as opaque references, never as identifying values.**
 * `tenantRef`/`actorRef` are the raw UUIDs — which are meaningless without the
 * database and are already the join key used by audit — and never names, emails,
 * phone numbers, or any classified attribute. Anything passed in `context` is
 * redacted and scrubbed first (`redaction.ts`).
 *
 * Note for reviewers: `src/lib/logging/logger.ts` is the retained Phase 1-1
 * bootstrap logger for the health/config path. Backend code must use this
 * module; the module-boundary checker enforces that.
 */
import pino, { type Logger as PinoLogger } from 'pino';
import { redact } from './redaction';
import { APP_NAME, APP_VERSION } from '@/shared/constants/app';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Outcome of the operation being logged. */
export type LogResult = 'success' | 'failure' | 'denied' | 'throttled' | 'skipped';

/** The standard field set. Everything else goes in `context` and is scrubbed. */
export interface LogFields {
  /** Owning module or foundation area, e.g. `meta`, `outbox-worker`. */
  readonly module?: string;
  /** Operation identifier, e.g. `meta.ping`. */
  readonly operation?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  /** Tenant UUID. Opaque reference only. */
  readonly tenantRef?: string;
  /** Actor (user) UUID. Opaque reference only. */
  readonly actorRef?: string;
  readonly durationMs?: number;
  readonly result?: LogResult;
  /** Catalog error code when the record describes a failure. */
  readonly errorCode?: string;
  /** Free-form extras. Redacted and scrubbed before emission. */
  readonly context?: Record<string, unknown>;
}

function resolveLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (
    configured === 'debug' ||
    configured === 'info' ||
    configured === 'warn' ||
    configured === 'error'
  ) {
    return configured;
  }
  // Tests are noisy enough without info-level request logs.
  return process.env.NODE_ENV === 'test' ? 'warn' : 'info';
}

function resolveEnvironment(): string {
  return process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? 'local';
}

let rootLogger: PinoLogger | undefined;

/** The process-wide Pino instance. Created lazily so tests can set env first. */
export function baseLogger(): PinoLogger {
  if (!rootLogger) {
    rootLogger = pino({
      level: resolveLevel(),
      base: {
        service: APP_NAME,
        version: APP_VERSION,
        env: resolveEnvironment(),
      },
      // ISO-8601 rather than epoch millis: logs are read by humans during an
      // incident far more often than they are parsed by a machine.
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ severity: label }),
      },
    });
  }
  return rootLogger;
}

function toRecord(fields: LogFields): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  if (fields.module !== undefined) record['module'] = fields.module;
  if (fields.operation !== undefined) record['operation'] = fields.operation;
  if (fields.correlationId !== undefined) record['correlationId'] = fields.correlationId;
  if (fields.causationId !== undefined) record['causationId'] = fields.causationId;
  if (fields.tenantRef !== undefined) record['tenantRef'] = fields.tenantRef;
  if (fields.actorRef !== undefined) record['actorRef'] = fields.actorRef;
  if (fields.durationMs !== undefined) record['durationMs'] = fields.durationMs;
  if (fields.result !== undefined) record['result'] = fields.result;
  if (fields.errorCode !== undefined) record['errorCode'] = fields.errorCode;
  if (fields.context !== undefined) record['context'] = redact(fields.context);
  return record;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derives a logger with fields pre-bound — used per request and per event. */
  child(fields: LogFields): Logger;
}

function wrap(instance: PinoLogger): Logger {
  const emit = (level: LogLevel, message: string, fields?: LogFields) => {
    // The message itself is scrubbed: it is frequently an upstream error string.
    instance[level](toRecord(fields ?? {}), String(redact(message)));
  };
  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => wrap(instance.child(toRecord(fields))),
  };
}

/** Foundation logger. Prefer a request- or worker-scoped child over this. */
export const log: Logger = {
  debug: (message, fields) => wrap(baseLogger()).debug(message, fields),
  info: (message, fields) => wrap(baseLogger()).info(message, fields),
  warn: (message, fields) => wrap(baseLogger()).warn(message, fields),
  error: (message, fields) => wrap(baseLogger()).error(message, fields),
  child: (fields) => wrap(baseLogger()).child(fields),
};

/** Test seam: rebuilds the root logger against the current env and destination. */
export function __resetLoggerForTests(destination?: pino.DestinationStream): void {
  rootLogger = destination
    ? pino(
        {
          level: 'debug',
          base: { service: APP_NAME, version: APP_VERSION, env: resolveEnvironment() },
          timestamp: pino.stdTimeFunctions.isoTime,
          formatters: { level: (label) => ({ severity: label }) },
        },
        destination
      )
    : undefined;
}
