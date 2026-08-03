/**
 * Audit types and constants.
 *
 * Separate from `api.ts` because that file is `'use server'`, and a Server
 * Action module may export **only async functions** — a constant or a sync
 * helper beside them is a build error, and the error names the wrong thing
 * ("the module has no exports at all") because the whole module is rejected.
 *
 * ## Every field name here is copied from the API, not chosen
 *
 * An earlier version of this file invented `field`, `value`, `previousValue`
 * and `classification` for a detail row. The API publishes `fieldName`,
 * `oldValueMasked`, `newValueMasked` and `valueClassification`
 * (`apps/api/src/modules/iam/data/audit-repository.ts`), so every detail
 * rendered blank-named and empty — and it rendered that way for a caller holding
 * `iam.sensitive.view` too, which is the reading the screen exists to serve
 * (finding `P1-26-F-017`).
 *
 * A response shape is a contract. Guessing at it produces a screen that renders
 * without erroring and shows nothing, which is the worst available failure.
 */

/** `AuditRecordRow` in `apps/api/src/modules/iam/data/audit-repository.ts`. */
export interface AuditRow {
  readonly id: string;
  readonly seq: string;
  readonly actorId: string | null;
  readonly actorKind: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly correlationId: string | null;
  readonly requestRef: string | null;
  readonly occurredAt: string;
}

/** `AuditDetailRow`, likewise. Masked server-side before it is published. */
export interface AuditDetailEntry {
  readonly fieldName: string;
  readonly oldValueMasked: string | null;
  readonly newValueMasked: string | null;
  readonly valueClassification: string;
}

/**
 * One record with its details.
 *
 * `details` is **absent** — not empty — when the caller does not hold
 * `iam.sensitive.view`. Those are different facts and the screen renders them
 * differently: "withheld" against "this record has no detail rows".
 */
export interface AuditDetail extends AuditRow {
  readonly details?: readonly AuditDetailEntry[];
}

/**
 * The window the audit screen opens on.
 *
 * `GET /api/v1/audit-events` requires a bounded `from`/`to` range, so the screen
 * must open on something. Seven days is a **presentation default** the operator
 * changes freely — not a retention period, and not a business rule. Recorded as
 * `P1-26-OD-007` for Owner ratification.
 *
 * The service refuses a range wider than `MAX_RANGE_DAYS` (92), so the screen
 * cannot ask for more than a quarter and the backend says so if it tries.
 */
export const DEFAULT_WINDOW_DAYS = 7;
export const MAX_WINDOW_DAYS = 92;
