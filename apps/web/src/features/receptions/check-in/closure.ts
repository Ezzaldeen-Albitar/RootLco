import {
  RECEPTION_STATUSES,
  RECEPTION_TRANSITIONS,
  MAX_CLOSURE_REASON,
  type ReceptionStatus,
} from '../receptions-contract';

/**
 * Closure rules for the reception summary, approval, terminal exits and
 * conversion (P1-28, Waves F/G; `FE-020` and `FE-022`).
 *
 * Pure module: no fetch, no React state. Every rule below is decided here so a
 * component renders a verdict instead of computing one, and so the rules are
 * testable without a DOM.
 *
 * ## The affordances are DERIVED from the transition graph, never listed
 *
 * `RECEPTION_TRANSITIONS` mirrors the frozen `rec.guard_reception_transition`
 * graph. A screen that hard-codes "offer Approve when the visit is opened or
 * inspecting" is a second copy of that graph which nothing keeps in step: add a
 * status to the CHECK constraint and the hand list is silently wrong, offering a
 * command the database will refuse or hiding one it would allow. So every
 * affordance here reads the graph:
 *
 *   - the two terminal exits and the conversion are DIRECT edges — is
 *     `closed_without_work` / `refused` / `converted` among this status's
 *     successors;
 *   - approval is a REACHABILITY question, not an edge, because approve applies
 *     one edge from `inspecting` and TWO from `opened` in a single transaction
 *     (`opened → inspecting → authorized`). `reaches` walks the graph rather
 *     than assuming a depth, so a graph that grew a longer path to `authorized`
 *     would still be answered correctly.
 *
 * `canApprove` in the contract states the same rule as a literal. Keeping both
 * is deliberate: the test asserts the two agree for EVERY member of
 * `RECEPTION_STATUSES`, so the derivation and the literal check each other and a
 * silent drift between the graph and the contract fails a test.
 *
 * ## Approve's answer is the version, and it is not `sent + 1`
 *
 * Approve can walk two edges in one transaction, so the record version it
 * returns can be `sent + 2`. Nothing here computes a version from a version:
 * `nextVersionAfter` exists only to say, in one place, that the RESPONSE is the
 * authority — and the suite drives it with both a one-edge and a two-edge
 * response so a screen that guessed `+1` or `+2` would fail against the other.
 * QA-004 then closes the loop: after any guarded write the screen re-reads, so
 * the next `If-Match` comes from a READ.
 */

/** What a visit in a given status may be asked to do. */
export interface ReceptionAffordances {
  /** `rec.reception-approve` — reachable to `authorized` from here. */
  readonly approve: boolean;
  /** `rec.reception-convert-to-work-order` — a direct edge to `converted`. */
  readonly convert: boolean;
  /** `rec.reception-close-without-work` — a direct edge to `closed_without_work`. */
  readonly closeWithoutWork: boolean;
  /** `rec.reception-refuse` — a direct edge to `refused`. */
  readonly refuse: boolean;
}

/** True when `to` is reachable from `from` in one or more edges of the graph. */
export function reaches(from: ReceptionStatus, to: ReceptionStatus): boolean {
  const seen = new Set<string>();
  const frontier: ReceptionStatus[] = [...(RECEPTION_TRANSITIONS[from] ?? [])];
  while (frontier.length > 0) {
    const next = frontier.shift() as ReceptionStatus;
    if (next === to) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    frontier.push(...(RECEPTION_TRANSITIONS[next] ?? []));
  }
  return false;
}

/** True when `to` is one edge away from `from`. */
export function hasEdge(from: ReceptionStatus, to: ReceptionStatus): boolean {
  return (RECEPTION_TRANSITIONS[from] ?? []).includes(to);
}

/** Every command this status can legally be asked for, read off the graph. */
export function receptionAffordances(status: ReceptionStatus): ReceptionAffordances {
  return {
    approve: reaches(status, 'authorized'),
    convert: hasEdge(status, 'converted'),
    closeWithoutWork: hasEdge(status, 'closed_without_work'),
    refuse: hasEdge(status, 'refused'),
  };
}

/** True when the vocabulary carries a status this module has never been asked about. */
export function unknownStatuses(statuses: readonly string[]): readonly string[] {
  return statuses.filter((status) => !(RECEPTION_STATUSES as readonly string[]).includes(status));
}

/* ------------------------------------------------------------------ *
 * The mandatory closure reason
 * ------------------------------------------------------------------ */

/**
 * The reason both terminal exits demand, refused locally where it can be.
 *
 * `closeSchema` in the adapter trims then bounds it, and the route answers 422
 * for a violation. Deciding the same thing here means the operator is told
 * beside the field rather than after a round trip — and the bound is
 * `MAX_CLOSURE_REASON`, the route's own, never a stricter guess.
 */
export function closureReasonProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return 'receptions.closure.error.reasonRequired';
  if (trimmed.length > MAX_CLOSURE_REASON) return 'receptions.closure.error.reasonTooLong';
  return null;
}

/* ------------------------------------------------------------------ *
 * Conflicts — two 409s that mean opposite things
 * ------------------------------------------------------------------ */

/**
 * Which kind of conflict a guarded command met.
 *
 * The four guarded commands can answer 409 for two unrelated reasons and the
 * cure is opposite:
 *
 *   - `stale` (`ERR-CON-001`) — the version moved under this screen. RE-READING
 *     CURES IT: the operator retries with the version the read returns.
 *   - `blocked` (anything else, `ERR-TRN-001` above all) — the STATE refuses the
 *     command. Re-reading does not cure it, and a screen that invites a retry is
 *     inviting the same refusal. Re-running approve on an authorized visit is
 *     exactly this.
 *
 * The distinction is already carried, honestly, by `failureMessageKey`: it reads
 * `problem.code` and returns `state.conflict.title` only for `ERR-CON-001`. This
 * function names the two so a screen can say which cure applies instead of
 * printing one sentence for both.
 */
export type ConflictKind = 'stale' | 'blocked';

export function conflictKindOf(messageKey: string | undefined): ConflictKind {
  return messageKey === 'state.conflict.title' ? 'stale' : 'blocked';
}

/* ------------------------------------------------------------------ *
 * Versions
 * ------------------------------------------------------------------ */

/**
 * The version to present next, which is the one the RESPONSE carried.
 *
 * Deliberately not arithmetic. Approve applies one edge from `inspecting` and
 * two from `opened`, so `sent + 1` is wrong half the time and `sent + 2` is
 * wrong the other half; the response states the truth in both. The parameter
 * `sent` is taken only so a caller cannot pass nothing and be silently right.
 */
export function nextVersionAfter(sent: number, answered: number): number {
  void sent;
  return answered;
}

/* ------------------------------------------------------------------ *
 * Evidence — a customer's concern is not a technical finding
 * ------------------------------------------------------------------ */

/**
 * The evidence kinds that record what the CUSTOMER said, as opposed to what
 * staff observed.
 *
 * A complaint is the customer's account of a problem. Everything else in the
 * list is an observation made at reception. Neither has been verified by a
 * technician — diagnosis belongs to the work order (P1-29) — so the summary
 * marks both, and marks them differently: rendering a customer's report in the
 * same voice as an inspection finding turns "the customer says it pulls left"
 * into "it pulls left", which is a claim nobody at reception made.
 */
export const CUSTOMER_REPORTED_KINDS: readonly string[] = Object.freeze(['complaint']);

export function isCustomerReported(kind: string): boolean {
  return CUSTOMER_REPORTED_KINDS.includes(kind);
}

/**
 * Whether an evidence row references a media document at all.
 *
 * This answers EXISTENCE and nothing more, because existence is all the row
 * carries. `rec.reception-condition-evidence-list` unions the eight evidence
 * relations and projects each one's `evidence_document_id` directly; it joins
 * no document or version table, so no lifecycle state — `pending`, `scanning`,
 * `accepted` — travels with the reference. A reader that named a state here
 * would be naming one it never read, and it would be wrong precisely when the
 * version had already been accepted.
 *
 * So the callers say only that a file is on record. Reporting the lifecycle
 * would need the READ to publish it, which is a Backend contract change; the
 * capture surfaces that do have a status (`CaptureBindingEntry`,
 * `SignatureEntry`, both carrying `documentVersionStatus`) render it from that
 * field and never from this one.
 *
 * The identifier itself is not rendered: it is an internal reference, and the
 * acknowledgement a customer takes away has no use for one.
 */
export function hasRegisteredMedia(evidenceDocumentId: unknown): boolean {
  return typeof evidenceDocumentId === 'string' && evidenceDocumentId.length > 0;
}
