/**
 * Vehicle documents (`FE-026`) and media (`FE-027`).
 *
 * | operation                    | method | path                          | permission                |
 * | ---------------------------- | ------ | ----------------------------- | ------------------------- |
 * | `veh.vehicle-document-list`  | GET    | `/vehicles/{id}/documents`    | **`shared.document.manage`** |
 *
 * That is the entire vehicle-side document surface. Everything below is what
 * this task cannot do because the contract does not publish it, recorded so
 * nobody mistakes any of it for an open decision.
 *
 * ## The permission is INVERTED relative to every other vehicle sub-resource
 *
 * Ownership, plates, odometer, relationships and the EV profile all read with
 * `veh.vehicle.read`. Documents read with **`shared.document.manage`** — a
 * *manage* capability from a *different* module. So:
 *
 * - an operator who can see a vehicle in full may be unable to see its
 *   documents, and
 * - an operator who can see its documents may be unable to see the vehicle.
 *
 * The tab is therefore gated on its own permission and says which one it needs,
 * rather than appearing empty to somebody who simply lacks a capability they
 * were never told about.
 *
 * ## The response is IDS. There is no metadata and no pagination.
 *
 * `VehicleDocuments` is `{ vehicleId, documentIds: string[] }`. No filename, no
 * size, no content type, no upload date, no uploader — the service's own comment
 * is "no storage key, no bytes". And the operation takes no cursor or limit, so
 * the list is unbounded by construction.
 *
 * Two consequences the screen must honour:
 *
 * - **No pager.** Building one would imply a `hasMore` the operation never
 *   returns.
 * - **No document table.** A row with nothing but a uuid in it is not a
 *   document list; it is a uuid list wearing a table. The screen presents it as
 *   what it is and says the metadata is not published.
 *
 * ## Downloading is one click into a `security`-audited operation
 *
 * `shared.attachment-download-authorize` is `auditClass: 'security'`. Prefetching
 * an authorization to make a link feel fast would write a security audit record
 * for a download nobody performed. Nothing here prefetches, and no download URL
 * is ever constructed speculatively.
 *
 * ## `FE-027` media: a capability gap, and not simulated
 *
 * There is no vehicle media operation at all — no upload, no thumbnail, no
 * gallery. A disabled upload control would advertise a capability the platform
 * does not publish, so `FE-027` ships as an explicit statement of what is
 * missing, with no control at all.
 *
 * The REASON changed and this paragraph did not. It read "`P1-OD-025` is the
 * policy authority … and it is **unresolved**" and called the situation "a
 * capability gap and an open Owner decision" — twenty lines above the
 * tombstone in this same file recording that the decision was RESOLVED.
 * `features/receptions/media/media-decision.ts` holds that record and
 * `MEDIA_DECISION_RESOLVED` is `true`.
 *
 * So: a capability gap, and nothing else. The decision is taken, private
 * versioned evidence ships, and what keeps media off THIS screen is that no
 * vehicle media operation exists to call — not a policy anybody is waiting on.
 */

/** The permission the documents tab actually needs. */
export const DOCUMENT_LIST_PERMISSION = 'shared.document.manage';

/** What `veh.vehicle-document-list` returns. Ids, and nothing else. */
export interface VehicleDocuments {
  readonly vehicleId: string;
  readonly documentIds: readonly string[];
}

/*
 * `MEDIA_STATUS` and `MEDIA_BLOCKING_DECISION` stood here, and are gone.
 *
 * ## What they were, and what went wrong with them
 *
 * They dated from when `P1-OD-025` — the document and media file policy — was
 * an OPEN Owner decision, and they encoded that: the status read
 * `'blocked-on-p1-od-025'` and the reference was documented as "the open
 * decision `FE-027` waits on". The decision has since been RESOLVED, and the
 * record of the four things that closed it is
 * `features/receptions/media/media-decision.ts`.
 *
 * The reference was not merely stale in a comment. `VehicleDocumentsSection`
 * RENDERED it, so every operator opening a vehicle read a bare `P1-OD-025`
 * beneath the media heading — an internal identifier in operator-facing text,
 * meaning nothing to the person reading it and, by then, naming a decision that
 * was no longer open. Two tests read it back off the DOM and off the constant
 * and so pinned it in place rather than catching it.
 *
 * ## Why removal rather than a localized label
 *
 * The paragraph above it already states the true reason in the operator's own
 * language: the platform publishes no vehicle media operation, so there is
 * nothing for a control to call. A decision identifier adds nothing an operator
 * can act on. The traceability it was carrying belongs in source — here, and in
 * the media section's own comment — where it stays checkable without being
 * published to people it does not help.
 *
 * With the render gone both constants had zero production consumers, which is
 * the shape this repository has removed on the record four times rather than
 * keep for symmetry: `crm/customers/identity-api.ts` (`P1-27-QA-002`),
 * `listVisitReasons` and `conditionEvidenceKinds` (`P1-28-F9`), and
 * `readDocumentVersion` beside this wave.
 */
