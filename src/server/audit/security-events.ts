/**
 * Security-event candidates (P1-13-BE-005, P1-13-SEC-003).
 *
 * Authorization denials and abuse-relevant rate-limit breaches are security
 * signals, and `iam.security_events` is where they belong.
 *
 * They are called *candidates* here for an honest reason: the runtime role holds
 * SELECT only on that table (DBCR-P1-13-001), so P1-13 cannot persist them. The
 * behaviour therefore is:
 *
 *  - always emit the structured log record and the metric — those work today and
 *    are searchable by correlation ID;
 *  - attempt the durable write only when the capability is present, so the day
 *    the change request is applied the records start landing with no code change;
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
