/**
 * Work-order domain rules (Phase 1-19, P1-19-BE-001).
 *
 * Pure: no database access, no I/O.
 *
 * ## The transition graph is NOT restated here, and that is deliberate
 *
 * Every prior module in this repository restated its trigger-enforced graph as a
 * frozen object literal, because those graphs live in `CHECK` constraints and
 * PL/pgSQL `IF` chains — they are code, and code can be mirrored.
 *
 * The work-order graph is different: it is **rows**. `wo.work_order_transitions`
 * and `wo.job_transitions` are tenant-overridable catalog tables carrying
 * `from_state`, `to_state`, `requires_reason` and `is_active`, and
 * `wo.guard_work_order_transition` reads them at write time. A tenant may seed its
 * own edges beside the platform ones. Mirroring the platform rows in TypeScript
 * would therefore be wrong twice over: it would refuse legitimate tenant edges,
 * and it would silently drift the moment an edge is added or deactivated.
 *
 * So this module reads the graph through `WorkOrderCatalogRepository`. What lives
 * here is only what the schema pins with a `CHECK` — the closed vocabularies below
 * — plus the blocker registry, which mirrors a PL/pgSQL function body rather than
 * a table and is reconciled against it by test.
 */
import { AppFailure } from '@/server/errors/app-failure';

/**
 * Frozen `ck_work_orders_kind` vocabulary — exactly two values.
 *
 * There is no `warranty` and no `internal` kind. Warranty is modelled by the `wty`
 * schema against the closed order, not by a work-order kind, and `rework` is the
 * only non-ordinary kind the closure guard's B6 and `qms.rework_links` understand.
 */
export const WORK_ORDER_KINDS = ['ordinary', 'rework'] as const;
export type WorkOrderKind = (typeof WORK_ORDER_KINDS)[number];

/**
 * Frozen `ck_work_orders_parts_forward_state` vocabulary.
 *
 * Note `reserved_elsewhere` — not `reserved`, and there is no `issued`. The column
 * records that parts were reserved in a system this phase does not own; actual
 * reservation and issue are Phase 1-21. See `DEFERRED_CLOSURE_BLOCKERS`.
 */
export const PARTS_FORWARD_STATES = ['none', 'requested', 'reserved_elsewhere'] as const;
export type PartsForwardState = (typeof PARTS_FORWARD_STATES)[number];

// Deliberately NOT here: the quality-control result vocabulary, the diagnostic
// report status vocabulary and the labor-session source vocabulary. Each of those
// belongs to the module that owns its table — `quality`, `diagnostics` and
// `technician` respectively — and an earlier draft of this file carried copies of
// all three. Two definitions of one CHECK constraint is two things to keep in step,
// and the pair only ever diverges silently.

/** Frozen `ck_additional_work_requests_state` vocabulary — `rejected`, not `declined`. */
export const ADDITIONAL_WORK_STATES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type AdditionalWorkState = (typeof ADDITIONAL_WORK_STATES)[number];

/** Frozen `ck_additional_work_requests_fulfillment` vocabulary — `waived`, not `not_required`. */
export const FULFILLMENT_STATES = ['unfulfilled', 'fulfilled', 'waived'] as const;
export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

export const MAX_DISPLAY_NUMBER = 64;
export const MAX_REASON = 500;

/**
 * The closure blockers, mirroring `wo.guard_work_order_closure()` exactly.
 *
 * The trigger is the authority and stays the authority: it runs inside the same
 * statement that changes the state, so nothing can slip between the check and the
 * write. But it `RAISE`s on the FIRST blocker it hits and aborts, which means a
 * caller who clears B1 discovers B2 only on the next attempt, and so on — six
 * round trips to learn six facts.
 *
 * `GET /closure-eligibility` therefore re-evaluates all six independently in a
 * read-only path and reports every one that is unmet. It is a REPORTER, never an
 * enforcer: closure itself is still refused by the trigger, and no code path may
 * close a work order by asserting this registry passed.
 *
 * A test reconciles these codes against the live function body, so an edit to the
 * trigger that this list does not follow fails the build rather than silently
 * making the endpoint lie.
 */
export const CLOSURE_BLOCKERS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'] as const;
export type ClosureBlockerCode = (typeof CLOSURE_BLOCKERS)[number];

export interface ClosureBlockerDefinition {
  readonly code: ClosureBlockerCode;
  /** Safe to return to any caller authorized to read the work order. */
  readonly message: string;
  /** The protected object that actually enforces it. */
  readonly enforcedBy: string;
}

export const CLOSURE_BLOCKER_REGISTRY: readonly ClosureBlockerDefinition[] = Object.freeze([
  Object.freeze({
    code: 'B1',
    message: 'A job on this work order is not in a terminal state.',
    enforcedBy: 'wo.guard_work_order_closure',
  }),
  Object.freeze({
    code: 'B2',
    message: 'A labor session on this work order is still running.',
    enforcedBy: 'wo.guard_work_order_closure',
  }),
  Object.freeze({
    code: 'B3',
    message: 'A required additional-work request is still unresolved.',
    enforcedBy: 'wo.guard_work_order_closure',
  }),
  Object.freeze({
    code: 'B4',
    message: 'A job requiring diagnostics has no completed diagnostic report.',
    enforcedBy: 'wo.guard_work_order_closure',
  }),
  Object.freeze({
    code: 'B5',
    message: 'Required quality control has not passed.',
    enforcedBy: 'wo.guard_work_order_closure',
  }),
  Object.freeze({
    code: 'B6',
    message: 'Safety-critical rework on this work order lacks independent sign-off.',
    enforcedBy: 'wo.guard_work_order_closure',
  }),
]);

/**
 * Deliberately ABSENT: reservation and part-issue blockers.
 *
 * The phase brief lists "no active reservation remains" and "no open part issue
 * remains" as closure conditions. `wo.guard_work_order_closure` contains neither,
 * because stock reservation and issue execution are Phase 1-21 and no table in the
 * protected schema records them yet. Adding a seventh blocker here that always
 * evaluates to "clear" would be worse than omitting it — it would read, in the API
 * response and in every audit snapshot, as a check that ran and passed.
 *
 * `wo.work_orders.parts_forward_state` is the forward hook Phase 1-9 left for this
 * — and its vocabulary proves the point: `none` → `requested` → `reserved_elsewhere`.
 * There is no `issued` value, because issuing stock is not a fact this schema can
 * record. P1-21 owns turning that column into a blocker. Until then the registry
 * has six entries and says so.
 */
export const DEFERRED_CLOSURE_BLOCKERS = Object.freeze({
  owner: 'P1-21',
  reason:
    'Stock reservation and part issue are not represented in the Phase 1-9 schema; ' +
    '`wo.work_orders.parts_forward_state` is the forward hook.',
  conditions: Object.freeze(['active-reservation', 'open-part-issue']),
});

/** Raised for a rule this layer can decide without the database. */
export class WorkOrderRuleError extends Error {
  public override readonly name = 'WorkOrderRuleError';
}

/**
 * Refuses a transition reason that is required but absent, or present but empty.
 *
 * `requires_reason` comes from the transition ROW, never from a constant here —
 * see the header. The caller passes what the catalog said.
 */
export function assertTransitionReason(requiresReason: boolean, reason: string | undefined): void {
  if (!requiresReason) return;
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    throw new AppFailure('ERR-VAL-001', {
      message: 'This transition requires a reason',
      safeDetails: { violations: [{ path: 'body.reason', rule: 'required' }] },
    });
  }
  if (trimmed.length > MAX_REASON) {
    throw new AppFailure('ERR-VAL-001', {
      message: `A transition reason may not exceed ${MAX_REASON} characters`,
      safeDetails: { violations: [{ path: 'body.reason', rule: 'max_length' }] },
    });
  }
}
