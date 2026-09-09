# P1-31 — the delivery execution screen (FE-002 … FE-006 write paths)

**Status:** in an open pull request, unmerged · **Lane:** `p1-31-frontend` · **Base:** stacked on
`feature/p1-31-delivery-detail-screen` (PR #357), which merges first

This slice turns the read-only handover screen of PR #357 into the working handover flow. It adds
five write paths and the configuration read the checklist needs, and it adds nothing to the backend:
no operation, no route, no permission, no seed row and no migration.

Nothing in this document claims that any environment exists, that any deployment happened, or that
this flow has been exercised against a live server. What it claims is stated in
[§6](#6-what-is-proved-here-and-what-is-not), with the boundary drawn explicitly.

## 1. Each action, its operation, its authority, and what a refusal does

| action on screen                    | operation                       | permissions the operation declares                               | how the control is gated                                                       |
| ----------------------------------- | ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Start the handover** (work order) | `sal.delivery-create`           | `sal.delivery.manage`                                            | the form is rendered only when the caller holds `sal.delivery.manage`          |
| **Confirm the receiver**            | `sal.delivery-receiver-verify`  | `sal.delivery.manage`, `sal.delivery.view`                       | as above, and only while no receiver is confirmed                              |
| **Record a checklist result**       | `sal.delivery-checklist-record` | `sal.delivery.manage`                                            | as above, and only for an item with no result yet                              |
| **Add a signature**                 | `sal.delivery-signature-attach` | `sal.delivery.manage`, `sal.delivery.view`                       | as above                                                                       |
| **Release the vehicle**             | `sal.delivery-complete`         | `sal.delivery.complete`, `sal.delivery.view`, `sal.finance.view` | the whole panel is rendered only when the caller holds `sal.delivery.complete` |

Every gate is `holds(session.permissions, …)` against the code **that operation** declares, not one
screen-wide capability. A caller who may prepare a handover and may not release it sees the four
preparation controls and no release panel; a caller who may release and may not prepare sees the
release panel and no preparation controls. In both cases the missing control is **absent**, never
present-and-refused — a button whose only outcome is a denial teaches an operator to ignore denials.

Every gate is an affordance. The backend decides again, against the actual record, on every request,
and a refusal is rendered as the backend's answer.

### Error handling, by the code the backend published

`problemFor` assembles the problem document from the catalogue entry and the failure's safe details
and reads the service's own sentence **nowhere**, so no service prose crosses the wire. Only codes
that name a cause the interface can act on differently are branched on; everything else keeps the
shared banner.

| code          | where            | what the screen does                                                                                                     |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ERR-INT-001` | checklist result | states that the item already has a result and that a recorded result is final, and asks the operator to refresh          |
| `ERR-CON-001` | release          | the adapter re-reads eligibility and re-sends **once** against the version it republished; a second conflict is reported |
| `ERR-CON-002` | release          | states that the release could not be sent and asks for a refresh — this is a fault in the screen, not in the request     |
| `ERR-IAM-001` | release          | states that the override was refused, and renders the `requiredPermissions` the problem document named                   |
| `ERR-TRN-001` | release          | re-reads the release checks and renders **their** blocker list and unsatisfied item codes — see below                    |

**The blockers are not in the refusal.** The service composes a sentence naming the blockers and the
unsatisfied item codes, and that sentence is a `message`, which never reaches the wire. So on a
blocked release the screen re-reads `sal.delivery-eligibility-read` — which publishes `blockers` and
`checklistGaps` as data — and renders what that read says. Composing a sentence from the code would
be this tier claiming to know something it was not told.

## 2. The version guard: where `If-Match` comes from, and why only from there

`sal.delivery-complete` is the only version-guarded operation of the five. The version it must quote
is the `recordVersion` that **`sal.delivery-eligibility-read`** republishes, in its body and its
ETag.

It is never taken from a checklist-result or signature response. Recording a result and binding a
signature both move the delivery row, so a version carried over from either is stale by
construction, and the completion would be refused for a reason that had nothing to do with a race.

Two consequences are implemented rather than merely stated:

- The eligibility read is lifted out of the panel that displays it and held by the screen, so the
  panel that shows the version and the button that sends it hold the **same** value. Two independent
  reads could hand them different numbers, and the number on screen would not be the number in the
  request.
- The screen counts successful writes and folds that count into the key of everything each panel
  holds. A write therefore makes every stale answer **absent** rather than merely old: the panels
  show their loading state while fresh reads land, instead of showing a decision that has changed.

The one retry is deliberate and bounded. A record-version conflict is re-attempted **once**, against
a version that was read again rather than derived by adding one — the record may have moved more
than once. A second conflict is reported. Retrying a conflict in a loop is how a screen turns
somebody else's concurrent work into a race it keeps losing without saying so.

## 3. The odometer: one decimal, checked in the form

The completion route validates `finalOdometerValue` against a pattern that admits **two** decimals.
`veh.odometer_readings.value` is `numeric(12,1)` and the delivery domain parses the value against
that scale, so a two-decimal value passes the route's own validation and is refused by the domain
with `ERR-VAL-001`, naming a field the operator has already left.

The form therefore holds to the **narrower** of the two rules: at most one digit after the decimal
point, said in the field's own help text, refused before a request is spent. This is not a
substitute for the server rule — it is how the operator finds out in the form rather than from a
refusal that has already consumed an idempotency key.

## 4. The delivering employee, and the Owner decision that stays open

`sal.delivery_records.delivering_employee_id` is `NOT NULL` and the DDL gives it **no foreign key**.
No read in this platform resolves it to a person. Owner requirement **OWR-2026-09-06-G-10** — where
that identity lives — is **Undecided**, and this slice does not decide it.

The control is an explicit, required identifier field with **no default**, whose help text says the
platform holds no name for it. That is the shape the shipped work-order assignment control already
uses for the same situation.

What was considered and rejected, so the reasoning is on the record rather than in a diff:

- **A picker fed from the technician roster.** It would assert that the person handing a vehicle over
  is a technician, which is precisely the question G-10 leaves open, and it would couple opening a
  handover to `tech.technician.read` — a permission `sal.delivery-create` does not declare, so a
  delivery officer without it could not open a handover at all.
- **A picker fed from a user directory.** Same objection, against a different register.

When the Owner decides, the field changes shape. Until then it states what it is.

## 5. The receiver's identity evidence — a named prerequisite, not built

`sal.delivery-receiver-verify` accepts an optional `identityEvidenceDocumentVersionId`. This slice
sends none, and the verification form offers no capture for it.

Capturing a document requires a document **category** that admits it. `shared.document_categories`
seeds seven platform categories; every one of them is a reception category, and the only one whose
business link purpose is an identity document is the **VIN evidence** category. Filing a person's
proof of identity under vehicle-identification evidence would be a data-classification defect
wearing the shape of a feature.

Minting a category is a seed, and a seed is not on this lane — `p1-31-frontend` forbids `dbSeeds`
and `supabase`, and the Owner's own rule routes backend capability to the backend lane. So the field
is omitted rather than mis-filed, and the missing category is recorded here as a prerequisite the
receiver-evidence capability owes:

> **Prerequisite (new):** a delivery identity-evidence document category, seeded on the backend lane,
> before FE-003's optional identity evidence can be captured. Until it exists, a delivery states
> whether evidence is on file — which the read already publishes — and offers no way to add any.

The signature capture has no such gap. `reception_signature` is a seeded category whose purpose is
`signature`, and the document is captured against `rec.reception_visits` — the visit this handover
closes, and the only entity in this chain's reach that `LINKABLE_ENTITY_TYPES` carries.
`sal.delivery_records` is not a linkable entity type.

## 6. What is proved here, and what is not

**Proved by the tests in this change, and by nothing more than them.**

The DOM suite renders the real screen with the adapter module replaced, so what it measures is what
the components do with an answer — not what the server answers. It holds:

- every control is absent without the code its own operation declares, and present with it;
- the start form sends the work order and the employee and neither the vehicle nor the visit;
- the receiver is chosen by name and submitted as an identifier;
- a waiver carries its reason and a pass carries none;
- a second, different outcome for one item is reported as "already recorded";
- an item that has an outcome offers no control at all;
- the release quotes the version the eligibility read published;
- a reading with two decimals is refused before any request;
- the override appears only when the server named that reason as one that may be set aside;
- a blocked release renders the re-read blocker list and the item codes;
- a refused override renders the authority the problem document named;
- every one of these reads in Arabic from the Arabic catalogue.

The adapter suite replaces only the transport, so it measures the requests themselves: the path, the
body field for field, the absence of a version header where no guard exists, the presence of the
right one where a guard does, the single stale-version retry, and the three cases in which no retry
happens.

**NOT proved here, and not claimed anywhere in this change.**

- **No end-to-end verification.** Nothing in this slice has been exercised against a running API, a
  database or a browser. Every request shape above is asserted against a replaced transport.
- **No proof that any of the five operations accepts these bodies at runtime.** The bodies are
  mirrored from the route schemas and held to them by the payload-parity gate, which compares
  declarations. A declaration matching a schema is not a request the server accepted.
- **No proof of the authorization outcome.** The permission gates are affordances measured in the
  browser tier. Whether the backend grants or refuses is the backend's, and is unmeasured here.
- **No proof of the guards.** `sal.guard_authorized_receiver`, the waiver biconditional, the one
  result per item index and the completion's own gates are all asserted by database tests that this
  slice neither ran nor changed.

What that leaves owed is an **authenticated browser proof on a freshly provisioned organisation**,
walking one handover from opening to release: the picker, the receiver, every checklist item, a
signature, the odometer and the release, including one deliberate refusal to see the blocker list
render from a real eligibility read. That proof is not in this change and is not claimed by it.

## 7. What this slice does NOT close

- **FE-001, the ready-for-delivery list.** The Owner settled **D-3** on 2026-09-09: the operational
  queue is the set of work orders satisfying the server's eligibility rules and includes eligible
  work orders with no delivery record, which `GET /api/v1/deliveries` (#358) does not answer. The
  smallest missing contract belongs to the owning prerequisite lane. The `/delivery` navigation entry
  stays `planned`; the screen is reached by address or from the work order.
- **FE-007, the delivery document.** **D-7** — whether the document is composed by the interface or
  stored by the platform — is open, and no delivery-document or print operation exists.
- **The checklist template administration screen.** The eight template operations exist (P-9), and
  this slice READS two of them to assemble the checklist. It writes none. The five template-write
  entries stay marked as owed in the payload-parity gate for the slice that builds that screen.
- **The receiver's identity evidence.** See [§5](#5-the-receivers-identity-evidence--a-named-prerequisite-not-built).
- **P-9b.** The Owner approved the correction narrowly on 2026-09-09; it is a forward migration on a
  backend lane. Nothing here changes which templates bind a completion — this screen renders the
  active ones, and the server decides.

## 8. What changed

| file                                                  | change                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/web/src/lib/contracts/delivery-contract.ts`     | new — the five request-body mirrors and the nested override                                |
| `apps/web/src/features/delivery/delivery-contract.ts` | the checklist template views, the odometer rule, the reason bound, the branched codes      |
| `apps/web/src/features/delivery/api.ts`               | the five write adapters, the assembled checklist read, the single stale-version retry      |
| `apps/web/src/features/delivery/signature-capture.ts` | new — capture, link and bind, in one act                                                   |
| `apps/web/src/features/delivery/components/**`        | the five controls, one shared eligibility read, and a revision counter every panel keys on |
| `apps/web/src/features/work-orders/components/**`     | the work-order section passes the write capability down                                    |
| `apps/web/src/app/[locale]/(dashboard)/**`            | both pages resolve `sal.delivery.manage` and hand it on                                    |
| `apps/web/src/i18n/messages/{en,ar}.json`             | the execution vocabulary, in both languages                                                |
| `scripts/ci/check-p1-30-payload-parity.mjs`           | the delivery mirror is registered; the five delivery entries marked as owed are DELETED    |
| `tests/ci/p1-30-payload-parity.test.ts`               | the frozen mirror list is extended in the same change                                      |
| `apps/web/tests/form-reset-class.test.ts`             | the delivery tree joins the form inventory, because it now owns a form                     |
| `apps/web/tests/delivery{-api,}.*`                    | extended in place; no new test file                                                        |

The payload-parity lifecycle is the point of the ninth row. An entry marked as owed cannot outlive
its reason: the moment a mirror declares the interface, the entry is stale and the gate fails until
it is deleted. Both halves are in this change.
