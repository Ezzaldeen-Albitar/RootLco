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
  /** Redacted extra context. */
  readonly context?: Record<string, unknown>;
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
      context: { monitored: true, errorName: event.errorName },
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

/** Sanitises and forwards a caught error. The only supported capture path. */
export function captureException(error: unknown, context: CaptureContext): void {
  const isError = error instanceof Error;
  const event: MonitoringEvent = {
    severity: context.severity ?? 'error',
    message: scrubString(isError ? error.message : String(error)),
    errorName: isError ? error.name : typeof error,
    ...(context.errorCode !== undefined ? { errorCode: context.errorCode } : {}),
    correlationId: context.correlationId,
    ...(context.module !== undefined ? { module: context.module } : {}),
    ...(context.operation !== undefined ? { operation: context.operation } : {}),
    ...(context.tenantRef !== undefined ? { tenantRef: context.tenantRef } : {}),
    ...(context.actorRef !== undefined ? { actorRef: context.actorRef } : {}),
    ...(isError && error.stack ? { stack: scrubString(error.stack) } : {}),
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
