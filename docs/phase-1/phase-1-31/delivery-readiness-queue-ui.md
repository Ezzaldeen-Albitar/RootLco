# P1-31 FE-001 — delivery readiness queue

Status: implemented in the preserved `feature/p1-31-delivery-readiness-queue` checkout;
not merged or verified end to end. The base remains `0204f2d1` until the readiness seam
and the preceding delivery UI work land. This record does not replace the 29-task matrix.

The `/delivery` page lets an authorized adviser select a named company and branch, review
completed work orders with the server's readiness verdict and blockers, and open a work
order or existing handover. It creates no delivery, employee, receiver or signature.

The page checks all three readiness permissions before calling either the directory or
queue adapters: `sal.delivery.view`, `wo.work_order.read`, and `sal.finance.view`.
Directory choices use the existing `/org/companies` and `/org/branches` contracts, whose
own `org.company.read` and `org.branch.read` permissions remain required. A directory
refusal or unavailable response is shown explicitly, without a raw identifier fallback.
The server adapter re-reads directory membership and verifies that the selected branch
belongs to the selected company. The backend independently checks the three readiness
permissions in that exact branch. Directory membership does not replace that check.

Readiness comes from `DeliveryReadinessRowView.readyToStartDelivery`, with `workOrder.id`,
the existing work-order summary, the live delivery record, four work-order facts and
blocker codes. A closed work-order state or empty blocker list never makes a row ready.
An unavailable server verdict is shown as unavailable. A fact that could not be established
is distinguished from a known blocker. Receiver, signature and checklist eligibility
remain on the handover record; this queue does not make those decisions.

The response is the existing cursor page: `items`, `nextCursor`, `hasMore`. The screen
preserves the server cursor and does not invent a total or a ready-only filter. It uses the
shared table's default 25 rows, within the endpoint's limit of 50. Requests above that
ceiling are capped visibly. Changing the company clears its selected branch; submitting
a different target starts a new table and discards the old cursor.

English and Arabic copy covers the selectors, readiness, unavailable checks and handover
links. The delivery navigation entry becomes available; the page's complete permission
gate remains authoritative before any read. The existing detail page gains a parent link.

Focused regression cases cover each missing readiness permission, no queue read before
selection, named and paired directory options, directory failure without identifier entry,
tampered targets, server false or absent verdicts, unknown facts, pagination, links and Arabic.
The bounded delivery API, delivery DOM and navigation run passed 100 tests across three
files; `typecheck:web` passed. No database test, hosted check, merge or functional
acceptance result is claimed by this record.
