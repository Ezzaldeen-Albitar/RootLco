/**
 * Capability gate (DBCR-P1-13-001).
 *
 * The four foundation write capabilities are granted to the `app_runtime`
 * archetype by migration
 * `20260725090000_iam_shared_runtime_write_capabilities.sql`, so on a correctly
 * migrated database this gate is a no-op. It stays because "the grant is there"
 * is an assumption about a *deployment*, not a property of the code:
 *
 *  - a connection opened as the wrong role — `app_readonly`, or a future
 *    archetype that was never granted — must be refused rather than allowed to
 *    discover the problem halfway through a command;
 *  - the check runs **before** the write is attempted, so the failure message
 *    names the missing capability and the change request instead of surfacing as
 *    a bare SQLSTATE 42501 from inside an INSERT;
 *  - it fails **closed**. There is deliberately no "skip the audit record and
 *    continue" branch. A state change without its audit record, or a command
 *    without its event, is worse than a refused command — it is a silent
 *    integrity hole that nobody notices until an investigation needs the record
 *    that was never written.
 */
import { AppFailure } from '../errors/app-failure';
import type { DbHandle } from './transaction';
import { foundationCapabilities, type FoundationCapability } from './capabilities';

const REMEDIATION: Readonly<Record<FoundationCapability, string>> = {
  'audit.append': 'GRANT EXECUTE ON FUNCTION iam.audit_append(...) TO app_runtime',
  'outbox.publish':
    'GRANT INSERT ON shared.event_outbox TO app_runtime + a tenant-scoped INSERT policy',
  'idempotency.store':
    'GRANT SELECT, INSERT ON shared.idempotency_keys TO app_runtime + a tenant-scoped policy',
  'security-event.record':
    'GRANT INSERT ON iam.security_events TO app_runtime + a tenant-scoped INSERT policy',
};

export class MissingDatabaseCapabilityError extends Error {
  public override readonly name = 'MissingDatabaseCapabilityError';
  constructor(
    public readonly capability: FoundationCapability,
    public readonly role: string
  ) {
    super(
      `Database capability "${capability}" is not available to role "${role}". ` +
        `Required grant: ${REMEDIATION[capability]}. ` +
        'Granted to app_runtime by DBCR-P1-13-001 (migration ' +
        '20260725090000_iam_shared_runtime_write_capabilities.sql) — check which ' +
        'role this connection opened as, and that the migration is applied.'
    );
  }
}

/**
 * Throws when the connection cannot perform `capability`.
 *
 * Surfaces as `ERR-SYS-001` at the API boundary — a caller must not be told
 * about the platform's grant configuration, and it is not a fault they can fix.
 */
export async function requireCapability(
  db: DbHandle,
  capability: FoundationCapability
): Promise<void> {
  const preflight = await foundationCapabilities(db);
  if (preflight.missing.includes(capability)) {
    const error = new MissingDatabaseCapabilityError(capability, preflight.currentRole);
    throw new AppFailure('ERR-SYS-001', { message: error.message, cause: error });
  }
}
