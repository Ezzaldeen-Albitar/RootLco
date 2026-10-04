/**
 * Security-event candidates (P1-13-BE-005, P1-13-SEC-003).
 *
 * Authorization denials and abuse-relevant rate-limit breaches are security
 * signals, and `iam.security_events` is where they belong.
 *
 * They were called *candidates* because, when P1-13 wrote this, the runtime role
 * held SELECT only on that table. DBCR-P1-13-001 and its migration
 * (`20260725090000_iam_shared_runtime_write_capabilities.sql`) have since granted
 * the runtime role a tenant-scoped INSERT, so a call here does persist. What is
 * CALLED is narrower than "every denial": control-plane rate-limit breaches,
 * refusals by business rule (`business-rule.refused`, ADR-023 D12) on any
 * operation, and refusals for want
 * of a permission (`authorization.denied`) on the four financial approval
 * decisions only (D12 extension, Owner decision 2026-10-03 — see
 * `business-refusals.ts`). Every other authorization denial is still a log line
 * and a metric, and is not persisted. The behaviour is:
 *
 *  - always emit the structured log record — searchable by correlation ID;
 *  - attempt the durable write only when the capability is present
 *    (`foundationCapabilities`), so a connection without the grant degrades to
 *    the log line rather than failing;
 *  - **never fail the request** because the security record could not be
 *    persisted. The denial itself is the control; losing its telemetry must not
 *    convert a clean 403 into a 500.
 *
 * That last point is the one asymmetry with `appendAudit()`, which *does* fail
 * closed. The difference is deliberate: an audit record is evidence of a state
 * change that is happening, and losing it corrupts the record; a security event
 * describes an action that was *refused*, and the refusal already happened.
 */
import type { DbHandle } from '../db/transaction';
import { foundationCapabilities } from '../db/capabilities';
import { contextLogFields } from '../context/request-context';
import { log } from '../observability/logger';

export type SecurityEventSeverity = 'info' | 'warning' | 'critical';

export interface SecurityEventInput {
  /** e.g. `authorization.denied`, `rate-limit.breached`. */
  readonly eventType: string;
  readonly severity: SecurityEventSeverity;
  /** Operator-facing detail. Must not contain caller-supplied free text. */
  readonly detail: string;
}

export interface SecurityEventOutcome {
  readonly logged: true;
  /** True when the row reached `iam.security_events`. */
  readonly persisted: boolean;
}

export async function recordSecurityEvent(
  db: DbHandle,
  input: SecurityEventInput
): Promise<SecurityEventOutcome> {
  log.warn(`Security event: ${input.eventType}`, {
    ...contextLogFields(db.context),
    result: 'denied',
    context: { securityEvent: input.eventType, severity: input.severity, detail: input.detail },
  });

  let persisted = false;
  try {
    const capabilities = await foundationCapabilities(db);
    if (!capabilities.missing.includes('security-event.record')) {
      await db.query(
        `INSERT INTO iam.security_events
           (tenant_id, event_type, severity, actor_id, detail, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          db.context.principal.tenantId,
          input.eventType,
          input.severity,
          db.context.principal.userId,
          input.detail,
          db.context.correlationId,
        ]
      );
      persisted = true;
    }
  } catch (error) {
    // Telemetry must never escalate into a request failure.
    log.error('Security event could not be persisted', {
      ...contextLogFields(db.context),
      result: 'failure',
      context: {
        securityEvent: input.eventType,
        reason: error instanceof Error ? error.name : 'unknown',
      },
    });
  }

  return { logged: true, persisted };
}
