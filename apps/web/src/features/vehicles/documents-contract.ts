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
 * ## `FE-027` media: blocked on `P1-OD-025`, and not simulated
 *
 * There is no vehicle media operation at all — no upload, no thumbnail, no
 * gallery. `P1-OD-025` is the policy authority for accepted types, size limits
 * and storage placement, and it is **unresolved**.
 *
 * A disabled upload control would advertise a capability the product does not
 * have and cannot have until that decision is made. So `FE-027` ships as an
 * explicit statement of what is missing and why, with no control at all. This is
 * a **capability gap and an open Owner decision**, not a defect.
 */

/** The permission the documents tab actually needs. */
export const DOCUMENT_LIST_PERMISSION = 'shared.document.manage';

/** What `veh.vehicle-document-list` returns. Ids, and nothing else. */
export interface VehicleDocuments {
  readonly vehicleId: string;
  readonly documentIds: readonly string[];
}

/**
 * What this build can say about vehicle media.
 *
 * Deliberately a single closed value rather than a feature flag: a flag implies
 * something to turn on, and there is no implementation behind it to enable.
 */
export const MEDIA_STATUS = 'blocked-on-p1-od-025' as const;

/** The open decision `FE-027` waits on, named so it can be tracked. */
export const MEDIA_BLOCKING_DECISION = 'P1-OD-025';
