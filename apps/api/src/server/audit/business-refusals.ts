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
 *
 * ## Permission refusals on the financial approvals (D12 extension)
 *
 * Approved by the Owner on 2026-10-03: a refusal for want of a PERMISSION on one
 * of the four financial approval decisions — approving or rejecting a credit
 * note, approving or rejecting a receipt reversal — is recorded through this same
 * seam, as its own event type (`authorization.denied`), never as a
 * `business-rule.refused`.
 *
 * Before this extension part of such refusals was already persisted, in the
 * other class: since FD2C and FD4, a refusal by the deferred scope check or the
 * database guard for want of the deciding code on approving a credit note, or
 * on approving or rejecting a receipt reversal, was marked `withBusinessRefusal`
 * with `credit_approval_permission_missing`,
 * `receipt_reversal_approve_permission_missing` or
 * `receipt_reversal_reject_permission_missing`. Those rows stay
 * `business-rule.refused`. Only the route-gate refusals, the refusals for want of
 * `sal.finance.view` alone and the permission refusals of a credit-note
 * rejection were log lines; no record exists for such an attempt made before the
 * extension was deployed, and none is claimed.
 *
 * The mark lives in the same `WeakMap`, so one failure carries ONE mark and
 * therefore yields ONE row of ONE class: whichever mark was set last wins. The
 * authorization layer marks every permission refusal it raises
 * (`requirePermissions`); a service marks a refusal the database raised for the
 * same reason. Only the operations in `PERMISSION_REFUSAL_OPERATIONS` are ever
 * written as `authorization.denied` — the four above and, since the refund requests of
 * ADR-023 D2 part 2 (P1-32-PRE-OD-FD2B), the five refund commands, whose decision is
 * the same kind of dual-control financial approval and whose request, withdrawal and
 * payout record are recorded the same way rather than as a business rule. Elsewhere a permission refusal is persisted
 * only where a service marks it as a business rule, exactly as before — the
 * receipt-reversal request (`receipt_reversal_request_permission_missing`), a
 * guard permission token on a receipt-reversal withdrawal, the discount decision
 * (`discount_approval_permission_missing`) and the third-party allocation
 * (`third_party_permission_missing`); every other 403 stays a log line.
 *
 * The detail names the operation, the branch the decision was made against, the
 * missing permission codes and where the refusal came from, and nothing else: no
 * document id, no amount, no name, no request text. The branch is the
 * authorization target the server resolved (from a row the caller's own row-level
 * security admitted), or `none` when the decision had no branch to name.
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

/**
 * The event type of a permission refusal on one of the four financial approval
 * decisions (ADR-023, D12 extension). Distinct from `BUSINESS_REFUSAL_EVENT`.
 */
export const PERMISSION_REFUSAL_EVENT = 'authorization.denied';

/**
 * The ONLY operations whose permission refusals are persisted (ADR-023, D12
 * extension, Owner decision 2026-10-03). An explicit list on purpose: the Owner
 * approved recording these four, not every 403 in the product.
 */
export const PERMISSION_REFUSAL_OPERATIONS: readonly string[] = Object.freeze([
  'sal.credit-note-approve',
  'sal.credit-note-reject',
  'sal.receipt-reversal-approve',
  'sal.receipt-reversal-reject',
  // ADR-023 D2, part 2 (P1-32-PRE-OD-FD2B): every refund command. A refusal for want
  // of `sal.payment.record`, `sal.refund.approve` or `sal.finance.view` in the
  // obligation's company and branch is one `authorization.denied` record.
  'sal.refund-request',
  'sal.refund-approve',
  'sal.refund-reject',
  'sal.refund-withdraw',
  'sal.refund-execute',
]);

/**
 * Where a permission refusal was decided: `route` is the pipeline's gate before
 * the handler ran, `scope` the deferred check against the document's own company
 * and branch, `database` a guard or privilege check inside the command.
 */
export type PermissionRefusalSource = 'route' | 'scope' | 'database';

/** What the authorization layer or a service states about a permission refusal. */
export interface PermissionRefusal {
  readonly source: PermissionRefusalSource;
  /**
   * The permission codes the decision found missing. Empty when the database
   * refused without naming one; the record then says `undetermined`.
   */
  readonly missing: readonly string[];
  /**
   * The branch the decision was made against — the authorization target the
   * server resolved, never the caller's input — or `null` when it had none.
   */
  readonly branchId: string | null;
}

/** A permission refusal with the operation that refused it, as it is written. */
export interface RecordedPermissionRefusal extends PermissionRefusal {
  /** The declared operation id, taken from the registration — never from the caller. */
  readonly operationId: string;
}

type Refusal =
  | { readonly kind: 'business'; readonly refusal: BusinessRefusal }
  | { readonly kind: 'permission'; readonly refusal: PermissionRefusal };

/** One mark per failure: the last one set wins, so an attempt yields one row of one class. */
const REFUSALS = new WeakMap<object, Refusal>();

/** Dotted or hyphenated lower-case identifiers: an operation id, an entity type, a rule code. */
const IDENTIFIER = /^[a-z][a-z0-9_.-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marks a failure as a refusal by business rule, and returns the same failure so
 * it can be thrown in one expression. The failure itself is not changed: what the
 * caller receives is exactly what it would have received without the mark.
 */
export function withBusinessRefusal<E extends object>(failure: E, refusal: BusinessRefusal): E {
  REFUSALS.set(
    failure,
    Object.freeze({ kind: 'business', refusal: Object.freeze({ ...refusal }) })
  );
  return failure;
}

/** The business refusal a thrown value was marked with, or `undefined` for any other failure. */
export function businessRefusalOf(error: unknown): BusinessRefusal | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const mark = REFUSALS.get(error);
  return mark?.kind === 'business' ? mark.refusal : undefined;
}

/**
 * Marks a failure as a refusal for want of a permission (ADR-023, D12 extension),
 * and returns the same failure. Like `withBusinessRefusal` it changes nothing the
 * caller receives, and it REPLACES any earlier mark on the same failure.
 */
export function withPermissionRefusal<E extends object>(failure: E, refusal: PermissionRefusal): E {
  REFUSALS.set(
    failure,
    Object.freeze({
      kind: 'permission',
      refusal: Object.freeze({ ...refusal, missing: Object.freeze([...refusal.missing]) }),
    })
  );
  return failure;
}

/** The permission refusal a thrown value was marked with, or `undefined`. */
export function permissionRefusalOf(error: unknown): PermissionRefusal | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const mark = REFUSALS.get(error);
  return mark?.kind === 'permission' ? mark.refusal : undefined;
}

/** Whether a permission refusal of this operation is persisted. */
export function recordsPermissionRefusals(operationId: string): boolean {
  return PERMISSION_REFUSAL_OPERATIONS.includes(operationId);
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

const SOURCES: ReadonlySet<string> = new Set<PermissionRefusalSource>([
  'route',
  'scope',
  'database',
]);
/** A permission code: dotted lower-case segments, e.g. `sal.credit.approve`. */
const PERMISSION_CODE = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

/**
 * The detail line of a permission refusal, or `null` when any part falls outside
 * its closed shape or the operation is not one of the four.
 *
 * `operation=<id> branch=<uuid|none> missing=<codes|undetermined> source=<route|scope|database> outcome=refused`
 * — five fixed keys. The operation is one of `PERMISSION_REFUSAL_OPERATIONS`, the
 * branch a UUID the server resolved, each missing code a permission code, the
 * source one of three words. There is no position in which a document attribute
 * or caller text could appear.
 */
export function permissionRefusalDetail(refusal: RecordedPermissionRefusal): string | null {
  if (!recordsPermissionRefusals(refusal.operationId)) return null;
  if (!SOURCES.has(refusal.source)) return null;
  if (refusal.branchId !== null && !UUID.test(refusal.branchId)) return null;
  if (refusal.missing.some((code) => !PERMISSION_CODE.test(code))) return null;
  const missing = [...new Set(refusal.missing)];
  return (
    `operation=${refusal.operationId} ` +
    `branch=${refusal.branchId === null ? 'none' : refusal.branchId.toLowerCase()} ` +
    `missing=${missing.length === 0 ? 'undetermined' : missing.join(',')} ` +
    `source=${refusal.source} outcome=refused`
  );
}

/**
 * Writes the ONE security event for a permission refusal (ADR-023, D12 extension).
 *
 * Same contract as `recordBusinessRefusal`: called on a transaction opened AFTER
 * the refused command rolled back, and it can never fail the request or turn the
 * refusal into anything else — `recordSecurityEvent` logs and swallows a failed
 * write. An operation outside the four writes nothing.
 */
export async function recordPermissionRefusal(
  db: DbHandle,
  refusal: RecordedPermissionRefusal
): Promise<SecurityEventOutcome | null> {
  const detail = permissionRefusalDetail(refusal);
  if (detail === null) return null;
  return recordSecurityEvent(db, {
    eventType: PERMISSION_REFUSAL_EVENT,
    severity: 'warning',
    detail,
  });
}
