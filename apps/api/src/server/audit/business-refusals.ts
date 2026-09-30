/**
 * Business-rule refusals, recorded so they survive the refused command (ADR-023, D12).
 *
 * ## The problem
 *
 * Every audit record is written inside the command's own transaction
 * (`appendAudit`), which is right for a change that is happening: the change and
 * its evidence commit together or not at all. It is wrong for a refusal. A
 * requester approving their own credit note, a discount approver without a limit
 * that counts, an allocation above what is still open — each is refused by
 * throwing, the transaction rolls back, and with it goes anything written inside
 * it. The trail recorded successes only (finance review GAP-18, narrowed by
 * CRITIQUE A5 to refusals by business rule).
 *
 * ## The mechanism, and why it is the existing one
 *
 * `iam.security_events` is already where refused actions are recorded
 * (`recordSecurityEvent`: authorization denials, rate-limit breaches). Its
 * runtime INSERT policy admits the caller's own tenant only, and reading it
 * needs `iam.audit.view` in that tenant, so the record inherits the isolation
 * every other security event has. No second log and no new table.
 *
 * A service does not write the event itself — it could only write it inside the
 * transaction that is about to roll back. It MARKS the failure it throws with
 * `withBusinessRefusal`, and the route pipeline, after the command's transaction
 * has rolled back, writes ONE event per refused attempt in a transaction of its
 * own (`recordBusinessRefusal`, called by `handleOperation`). Never inside the
 * refused transaction, and never instead of the refusal: the caller still gets
 * exactly the failure the service threw.
 *
 * ## What the record carries, and what it never carries
 *
 * Tenant and actor come from the session (`recordSecurityEvent` stamps both).
 * The detail names the operation, the entity type and id, the rule and the
 * outcome, and nothing else: no amount, no name, no e-mail, no token, no request
 * body, no free text. Every part is checked against a closed shape before it is
 * written; a part that does not fit is not written at all rather than written
 * approximately, because a record that could carry caller text is the leak this
 * table's own comment forbids.
 *
 * ## The seam D13 calls
 *
 * Credit-approval limits (D13) refuse by business rule too. Their refusal is
 * recorded by marking the failure exactly as the credit-note and discount
 * refusals below do — `throw withBusinessRefusal(new AppFailure(...), { ... })`
 * — with a rule code of its own. Nothing else is needed.
 */
import type { DbHandle } from '../db/transaction';
import { recordSecurityEvent, type SecurityEventOutcome } from './security-events';

/** The `iam.security_events.event_type` of every business-rule refusal. */
export const BUSINESS_REFUSAL_EVENT = 'business-rule.refused';

/** What a service states about a refusal. The operation is the pipeline's to add. */
export interface BusinessRefusal {
  /** The audited entity type, as `iam.audit_records.entity_type` spells it, e.g. `sal.credit_note`. */
  readonly entityType: string;
  /** The refused entity's id — the stored row's, never the caller's raw input. */
  readonly entityId: string;
  /** The stable rule code the refusal names, e.g. `credit_note_self_approval`. */
  readonly rule: string;
}

/** A refusal with the operation that refused it, as it is written. */
export interface RecordedBusinessRefusal extends BusinessRefusal {
  /** The declared operation id, taken from the registration — never from the caller. */
  readonly operationId: string;
}

const REFUSALS = new WeakMap<object, BusinessRefusal>();

/** Dotted or hyphenated lower-case identifiers: an operation id, an entity type, a rule code. */
const IDENTIFIER = /^[a-z][a-z0-9_.-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marks a failure as a refusal by business rule, and returns the same failure so
 * it can be thrown in one expression. The failure itself is not changed: what the
 * caller receives is exactly what it would have received without the mark.
 */
export function withBusinessRefusal<E extends object>(failure: E, refusal: BusinessRefusal): E {
  REFUSALS.set(failure, Object.freeze({ ...refusal }));
  return failure;
}

/** The refusal a thrown value was marked with, or `undefined` for any other failure. */
export function businessRefusalOf(error: unknown): BusinessRefusal | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  return REFUSALS.get(error);
}

/**
 * The detail line, or `null` when any part falls outside its closed shape.
 *
 * `operation=<id> entity=<type>/<uuid> rule=<code> outcome=refused` — four fixed
 * keys, each value a compile-time identifier of this repository or a UUID read
 * from a stored row. There is no position in which caller text could appear.
 */
export function businessRefusalDetail(refusal: RecordedBusinessRefusal): string | null {
  if (
    !IDENTIFIER.test(refusal.operationId) ||
    !IDENTIFIER.test(refusal.entityType) ||
    !IDENTIFIER.test(refusal.rule) ||
    !UUID.test(refusal.entityId)
  ) {
    return null;
  }
  return (
    `operation=${refusal.operationId} entity=${refusal.entityType}/${refusal.entityId.toLowerCase()} ` +
    `rule=${refusal.rule} outcome=refused`
  );
}

/**
 * Writes the ONE security event for a refused attempt.
 *
 * Called on a transaction opened AFTER the refused command rolled back. Like every
 * security event it never fails the request: `recordSecurityEvent` logs and
 * swallows a failed write, because the refusal already happened and losing its
 * record must not turn a clean 409 into a 500.
 */
export async function recordBusinessRefusal(
  db: DbHandle,
  refusal: RecordedBusinessRefusal
): Promise<SecurityEventOutcome | null> {
  const detail = businessRefusalDetail(refusal);
  if (detail === null) return null;
  return recordSecurityEvent(db, {
    eventType: BUSINESS_REFUSAL_EVENT,
    severity: 'warning',
    detail,
  });
}
