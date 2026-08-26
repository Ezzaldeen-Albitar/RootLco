/**
 * The `qms.` request payloads, transcribed by hand (P1-29 preparation; `BR-08c`).
 *
 * | operation                | body type              |
 * | ------------------------ | ---------------------- |
 * | `qms.qc-check-result`    | `QcCheckResultBody`    |
 * | `qms.qc-record-finalize` | `QcRecordFinalizeBody` |
 * | `qms.qc-record-open`     | `QcRecordOpenBody`     |
 * | `qms.reopen-attempt`     | `ReopenAttemptBody`    |
 * | `qms.rework-cost-record` | `ReworkCostRecordBody` |
 * | `qms.rework-create`      | `ReworkCreateBody`     |
 * | `qms.rework-sign-off`    | `ReworkSignOffBody`    |
 *
 * ## Why these are written out by hand
 *
 * `apps/web` may not import `apps/api` source — `check-api-boundary.mjs` refuses
 * it — so the shapes the browser sends have to be restated on this side. A
 * generated restatement would gate nothing, because it would agree with the
 * backend by construction. This one can drift, which is the whole point: the
 * `BR-08c` gate compares it field by field against the zod schemas and fails on
 * a field this module invents, a field it silently drops, and on any
 * required/optional disagreement.
 *
 * ## One type per operation, never one type per shape
 *
 * Nothing here is shared with another operation even where the schemas match,
 * and `qms.` is the domain that shows why: `reason` on `qms.reopen-attempt`
 * accepts 1000 characters, while the two other `{ reason }` bodies in P1-29
 * stop at 500. A single `ReasonBody` would tell a caller a 900-character reason
 * is fine everywhere, and the request would be refused with nothing in
 * TypeScript to have caught it.
 *
 * ## What these interfaces cannot carry
 *
 * `minLength`, `maxLength` and `pattern` have no home in a TS interface, so
 * they are absent rather than approximated — no branded strings, no comments
 * pretending to enforce. Where a limit is genuinely surprising the docblock
 * says so, and that is the only place a limit appears. Every field below is
 * additionally `strict` on the wire: an unknown key is rejected, not ignored.
 */

/**
 * One quality check's outcome.
 *
 * `result` is a closed `ck_` vocabulary, not a catalogue — and it is the
 * PRESENT tense triple, deliberately unlike the record-level verdict below. A
 * single check may be `na` because the check does not apply to this vehicle or
 * job; a finished record has no such escape.
 *
 * `note` is singular here and plural on the record bodies. They are different
 * fields on different aggregates, not one field spelled two ways.
 */
export interface QcCheckResultBody {
  readonly result: 'pass' | 'fail' | 'na';
  readonly note?: string;
}

/**
 * Closing a quality-control record.
 *
 * `overallResult` is the PAST tense pair — `passed` / `failed`, never the
 * check-level `pass` / `fail` / `na`. Sending a check's own vocabulary here is
 * the mistake this docblock exists to prevent.
 */
export interface QcRecordFinalizeBody {
  readonly overallResult: 'passed' | 'failed';
  readonly notes?: string;
}

/**
 * Opening a quality-control record. Every field is optional, so the whole body
 * is `{}` unless the opener has something to say — the record's subject comes
 * from the path, not from the payload.
 */
export interface QcRecordOpenBody {
  readonly notes?: string;
}

/**
 * Reopening a closed attempt.
 *
 * `reason` is mandatory and accepts 1000 characters — double the limit the
 * other P1-29 `{ reason }` bodies impose. See the module docblock.
 */
export interface ReopenAttemptBody {
  readonly reason: string;
}

/**
 * What a rework cost.
 *
 * `reworkCost` is a decimal carried as a STRING, not a number: money crosses
 * this boundary in its exact written form so no IEEE-754 rounding happens
 * between the browser and the ledger. `costCurrency` is an ISO-4217 alpha-3
 * code and is required alongside it — an amount with no currency is not a
 * cost.
 */
export interface ReworkCostRecordBody {
  readonly reworkCost: string;
  readonly costCurrency: string;
}

/**
 * Raising a rework.
 *
 * Only the diagnosis is compulsory: `rootCause` and `correctiveAction` must be
 * present, while ownership (`responsibility`, `leadTechnicianId`) and the
 * safety flag may be settled later. `leadTechnicianId` is a UUID.
 */
export interface ReworkCreateBody {
  readonly rootCause: string;
  readonly correctiveAction: string;
  readonly responsibility?: string;
  readonly leadTechnicianId?: string;
  readonly isSafetyCritical?: boolean;
}

/** Signing a rework off. `signOffBy` is a UUID and is the only field. */
export interface ReworkSignOffBody {
  readonly signOffBy: string;
}
