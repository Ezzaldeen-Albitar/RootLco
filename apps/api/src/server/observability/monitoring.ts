/**
 * Error monitoring port (P1-13-BE-010).
 *
 * **What this is:** a capture boundary with sanitised context and a correlation
 * ID, plus a recording transport used by tests and the monitoring rehearsal.
 *
 * **What this is not:** a provisioned production monitoring platform. No DSN, no
 * project, and no environment beyond Local exists (ADR-012), so wiring a real
 * Sentry client here would either need a secret this repository must not hold or
 * would silently no-op. The Sentry (or equivalent) adapter is a small class that
 * implements `ErrorMonitor` and is installed by deployment composition; the
 * contract it must satisfy is exactly the interface below.
 *
 * The sanitisation rule is the part that matters and is enforced here rather
 * than in the adapter: an adapter receives an already-scrubbed event, so a
 * third-party SDK can never be handed a raw error object carrying request
 * bodies, headers, or database rows.
 */
import { redact, scrubString } from './redaction';
import { log } from './logger';

export type MonitorSeverity = 'warning' | 'error' | 'fatal';

/** The only shape an adapter ever receives. Already sanitised. */
export interface MonitoringEvent {
  readonly severity: MonitorSeverity;
  /** Scrubbed error message. Never the raw upstream string. */
  readonly message: string;
  /** Error class name, e.g. `AppFailure`. */
  readonly errorName: string;
  /** Catalog code when the fault was classified. */
  readonly errorCode?: string;
  readonly correlationId: string;
  readonly module?: string;
  readonly operation?: string;
  /** Opaque tenant/actor references only — never names or classified values. */
  readonly tenantRef?: string;
  readonly actorRef?: string;
  /**
   * Stack trace. Retained because it is the entire point of error monitoring,
   * scrubbed for credential shapes, and never returned to an API caller.
   */
  readonly stack?: string;
  /**
   * The code path alone: the raw stack's frame lines (`    at …`), scrubbed and
   * capped. The message line, and any message text that continues onto further
   * lines, is dropped — a driver or RAISE message routinely carries a submitted
   * value, and the stack's first line repeats that message verbatim.
   */
  readonly stackFrames?: readonly string[];
  /**
   * The structured identity of a PostgreSQL fault, copied field by field. Never
   * `detail`, `where`, `hint`, the internal query or the parameters: those are
   * where a driver repeats the value the caller submitted.
   */
  readonly database?: DatabaseFaultFields;
  /** Redacted extra context. */
  readonly context?: Record<string, unknown>;
}

/** What a database fault is logged by. Each field is present only when the driver set it. */
export interface DatabaseFaultFields {
  readonly sqlState: string;
  readonly constraint?: string;
  readonly schema?: string;
  readonly table?: string;
  readonly column?: string;
  readonly routine?: string;
}

export interface ErrorMonitor {
  capture(event: MonitoringEvent): void;
}

/** Context a caller may attach. Everything is redacted before it leaves. */
export interface CaptureContext {
  readonly correlationId: string;
  readonly severity?: MonitorSeverity;
  readonly errorCode?: string;
  readonly module?: string;
  readonly operation?: string;
  readonly tenantRef?: string;
  readonly actorRef?: string;
  readonly context?: Record<string, unknown>;
}

/**
 * Default transport: writes the sanitised event to the structured log at error
 * level and keeps a bounded in-memory ring for the rehearsal and for tests.
 * Honest by construction — it claims nothing about an external platform.
 */
export class RecordingErrorMonitor implements ErrorMonitor {
  private static readonly MAX_RETAINED = 100;
  private readonly events: MonitoringEvent[] = [];

  capture(event: MonitoringEvent): void {
    if (this.events.length >= RecordingErrorMonitor.MAX_RETAINED) this.events.shift();
    this.events.push(event);
    log.error(event.message, {
      ...(event.module !== undefined ? { module: event.module } : {}),
      ...(event.operation !== undefined ? { operation: event.operation } : {}),
      correlationId: event.correlationId,
      ...(event.tenantRef !== undefined ? { tenantRef: event.tenantRef } : {}),
      ...(event.actorRef !== undefined ? { actorRef: event.actorRef } : {}),
      ...(event.errorCode !== undefined ? { errorCode: event.errorCode } : {}),
      result: 'failure',
      // Inside `context` because the logger keeps only its fixed top-level keys
      // and passes `context` through redaction; no key here names a secret.
      context: {
        monitored: true,
        errorName: event.errorName,
        ...(event.database !== undefined ? { database: event.database } : {}),
        ...(event.stackFrames !== undefined ? { stackFrames: event.stackFrames } : {}),
      },
    });
  }

  recorded(): readonly MonitoringEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}

let monitor: ErrorMonitor = new RecordingErrorMonitor();

export function errorMonitor(): ErrorMonitor {
  return monitor;
}

/** Installs a platform adapter. Deployment composition only. */
export function setErrorMonitor(next: ErrorMonitor): void {
  monitor = next;
}

/** The most frame lines a single event carries. */
const MAX_STACK_FRAMES = 20;
const FRAME_LINE = /^\s+at /;
const SQLSTATE_SHAPE = /^[0-9A-Z]{5}$/;

type DriverError = Record<string, unknown> & { readonly code: string };

/**
 * A PostgreSQL driver error, recognised by its shape rather than by importing
 * the database layer (this module is foundation code and must not).
 *
 * A five-character SQLSTATE alone is not enough: Node's own errno codes (EPIPE,
 * EPERM) are five capital letters too. A server-reported error also carries a
 * severity and the server routine or source file that raised it.
 */
function isDriverError(error: unknown): error is DriverError {
  if (typeof error !== 'object' || error === null) return false;
  const fields = error as Record<string, unknown>;
  const code = fields['code'];
  return (
    typeof code === 'string' &&
    SQLSTATE_SHAPE.test(code) &&
    typeof fields['severity'] === 'string' &&
    (typeof fields['routine'] === 'string' || typeof fields['file'] === 'string')
  );
}

/** Copies the structural fields only, each one only when the driver set it as text. */
function databaseFields(error: DriverError): DatabaseFaultFields {
  const text = (name: string): string | undefined => {
    const value = error[name];
    return typeof value === 'string' ? scrubString(value) : undefined;
  };
  const constraint = text('constraint');
  const schema = text('schema');
  const table = text('table');
  const column = text('column');
  const routine = text('routine');
  return {
    sqlState: error.code,
    ...(constraint !== undefined ? { constraint } : {}),
    ...(schema !== undefined ? { schema } : {}),
    ...(table !== undefined ? { table } : {}),
    ...(column !== undefined ? { column } : {}),
    ...(routine !== undefined ? { routine } : {}),
  };
}

/**
 * The frame lines of a RAW stack. Filtered before anything escapes its
 * newlines, so a message that continues onto a second line is a separate line
 * here and is dropped with the first.
 */
function stackFramesOf(stack: string): readonly string[] {
  return stack
    .split('\n')
    .filter((line) => FRAME_LINE.test(line))
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => scrubString(line));
}

/** Sanitises and forwards a caught error. The only supported capture path. */
export function captureException(error: unknown, context: CaptureContext): void {
  const isError = error instanceof Error;
  const database = isDriverError(error) ? databaseFields(error) : undefined;
  const event: MonitoringEvent = {
    severity: context.severity ?? 'error',
    // A database fault is named by its SQLSTATE and nothing the driver wrote:
    // its message can quote the submitted value.
    message:
      database !== undefined
        ? `Database error ${database.sqlState}`
        : scrubString(isError ? error.message : String(error)),
    errorName: isError ? error.name : typeof error,
    ...(context.errorCode !== undefined ? { errorCode: context.errorCode } : {}),
    correlationId: context.correlationId,
    ...(context.module !== undefined ? { module: context.module } : {}),
    ...(context.operation !== undefined ? { operation: context.operation } : {}),
    ...(context.tenantRef !== undefined ? { tenantRef: context.tenantRef } : {}),
    ...(context.actorRef !== undefined ? { actorRef: context.actorRef } : {}),
    ...(isError && error.stack ? { stack: scrubString(error.stack) } : {}),
    ...(isError && error.stack ? { stackFrames: stackFramesOf(error.stack) } : {}),
    ...(database !== undefined ? { database } : {}),
    ...(context.context !== undefined
      ? { context: redact(context.context) as Record<string, unknown> }
      : {}),
  };
  monitor.capture(event);
}

/** Test seam: installs a fresh recording monitor and returns it. */
export function __resetMonitorForTests(): RecordingErrorMonitor {
  const fresh = new RecordingErrorMonitor();
  monitor = fresh;
  return fresh;
}
