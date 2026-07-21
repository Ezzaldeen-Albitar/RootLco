/**
 * Audit emission (P1-13-SEC-004, FR-AUD-001).
 *
 * Wraps `iam.audit_append`, which maintains a per-tenant SHA-256 hash chain and
 * is the only supported way to write `iam.audit_records` (the table is
 * append-only and has no runtime DELETE grant). The application never builds the
 * canonical form or the hash itself — doing so in TypeScript would create a
 * second implementation of the chain that could disagree with the verifier.
 *
 * Called **inside** the business transaction, so the audit record and the state
 * change it describes commit together (Figure 4.6). An audit record that
 * survives a rolled-back command would be a lie; a command that commits without
 * its audit record would be an integrity hole. One transaction removes both.
 *
 * The `details` payload is passed through `iam.audit_mask` semantics on the
 * database side; callers pass classification-tagged entries, never raw values of
 * restricted fields.
 */
import { AppFailure } from '../errors/app-failure';
import type { DbHandle } from '../db/transaction';
import { requireCapability } from '../db/require-capability';
import type { AuditClass } from '../auth/operation-registry';

/** One detail entry. `classification` drives masking in the database. */
export interface AuditDetail {
  readonly field: string;
  readonly classification: 'public' | 'internal' | 'confidential' | 'restricted';
  readonly value: string | null;
}

export interface AuditInput {
  /** Action code, e.g. `iam.role.granted`. Comes from the operation registry. */
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  /** `user` for a human actor, `system` for a worker or scheduled action. */
  readonly actorKind?: 'user' | 'system';
  readonly companyId?: string | null;
  readonly branchId?: string | null;
  /** Free-form request reference, e.g. the operation id. */
  readonly requestRef?: string | null;
  readonly details?: readonly AuditDetail[];
}

/**
 * Appends one audit record. Returns the new record id.
 *
 * Tenant, actor, and correlation are taken from the request context — never from
 * the caller — so an audit record cannot claim a different actor than the one
 * the request authenticated as.
 */
export async function appendAudit(db: DbHandle, input: AuditInput): Promise<string> {
  await requireCapability(db, 'audit.append');

  const result = await db.query<{ id: string }>(
    `SELECT iam.audit_append(
        p_tenant        => $1,
        p_actor         => $2,
        p_actor_kind    => $3,
        p_action        => $4,
        p_entity_type   => $5,
        p_entity_id     => $6,
        p_company       => $7,
        p_branch        => $8,
        p_correlation   => $9,
        p_request_ref   => $10,
        p_details       => $11::jsonb
     ) AS id`,
    [
      db.context.principal.tenantId,
      db.context.principal.userId,
      input.actorKind ?? 'user',
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.companyId ?? null,
      input.branchId ?? null,
      db.context.correlationId,
      input.requestRef ?? db.context.operation,
      JSON.stringify(input.details ?? []),
    ]
  );

  const id = result.rows[0]?.id;
  if (!id) {
    throw new AppFailure('ERR-SYS-001', { message: 'iam.audit_append returned no record id' });
  }
  return id;
}

/**
 * Emits the audit record an operation's class requires.
 *
 * `none` writes nothing — and that is a *declared* decision made at registration
 * time, not a forgotten call: `defineOperation()` refuses a non-`none` class
 * without an action code, so the two cannot drift apart.
 */
export async function auditForOperation(
  db: DbHandle,
  operation: {
    readonly id: string;
    readonly auditClass: AuditClass;
    readonly auditAction?: string;
  },
  input: Omit<AuditInput, 'action'>
): Promise<string | null> {
  if (operation.auditClass === 'none') return null;
  if (!operation.auditAction) {
    // Unreachable via defineOperation(); retained so a hand-built operation
    // object cannot silently skip the audit record.
    throw new AppFailure('ERR-SYS-001', {
      message: `Operation ${operation.id} is audited but declares no action code`,
    });
  }
  return appendAudit(db, { ...input, action: operation.auditAction });
}
