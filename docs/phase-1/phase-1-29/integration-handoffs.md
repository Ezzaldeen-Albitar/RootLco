# P1-29 — integration handoffs

Three boundaries: **parts** (inventory), **quotation and approval** (the
commercial track), and **reception** (upstream). Each has a complete Backend
owned by another phase. P1-29's job at each boundary is to _consume the existing
contract_, and the purpose of this document is to make rebuilding one of them
impossible to do by accident.

---

## 1. Parts — inventory owns the lifecycle, the work order owns only the demand

### 1.1 What the work-order side has

`wo.required_parts` — `{work_order_id, job_id (nullable), description,
quantity numeric(12,3) > 0, unit, item_ref}`.

**It has no status column, no fulfilled flag, no reservation reference and no
issue reference.** It is a _demand line_ and nothing else. `item_ref` is a real
composite FK to `inv.item_master` (MATCH SIMPLE, nullable) and points at the
item **catalogue**, never at stock.

Operations: `POST` / `GET /work-orders/{workOrderId}/required-parts`
(`wo.work_order.line.manage` to write, `wo.work_order.read` to read; the body's
`quantity` is a decimal **string**).

**There is no parts-request workflow.** No submit → acknowledge → pick states
exist, in any table, at any layer.

### 1.2 `parts_forward_state` is dead

`wo.work_orders.parts_forward_state` has
`CHECK ('none','requested','reserved_elsewhere')` and defaults to `'none'`. A
grep across `apps/api/src`, `apps/web/src` and every migration finds only the
column definition, its `COMMENT`, and read-side projections. **Nothing ever
writes it.**

So it is always `'none'`. A UI that renders it as a parts status would display a
constant and call it information. Do not surface it. `INS-16`.

### 1.3 What inventory owns

| capability                                            | operation                               | notes                                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| availability                                          | `GET /stock-availability`               | `{companyId*, branchId*, itemId?, locationId?, includeQuarantine?, cursor, limit}`; `onHand`/`reserved`/`available` are exact decimal **strings**              |
| reserve                                               | `POST /stock-reservations`              | `inv.reserve_stock(...)` takes the balance row lock; `status ∈ active \| released \| consumed \| expired`; `work_order_id` is a nullable composite FK, indexed |
| release                                               | `POST /stock-reservations/{id}/release` | idempotent — a non-active reservation returns silently                                                                                                         |
| issue                                                 | `POST /stock-issues`                    | body accepts `requiredPartRef`; writes `inv.part_issues` with `work_order_id` **NOT NULL**                                                                     |
| consume                                               | _(none)_                                | not an operation — `inv.consume_reservation` runs automatically inside `inv.issue_part` when a reservation id is supplied                                      |
| return                                                | `POST /stock-returns`                   | keyed on the **issue**, not the work order; a ceiling trigger caps the returned quantity                                                                       |
| customer-supplied / damaged / external-purchase parts | three create operations                 | **create-only — no read operation exists for any of them**                                                                                                     |

### 1.4 The two reads P1-29 will want, and what it actually gets

**"What parts has this work order consumed?"** — no direct read exists. Two
indirect ones:

1. `GET /stock-movements?workOrderId=…` — the filter is resolved by
   EXISTS-joining `inv.part_issues` and `inv.part_returns`, so it returns
   movements, not a parts list.
2. Reconstruct from the demand lines plus movements, which requires the
   demand↔issue link — see below.

**"What is reserved for this work order?"** — **there is no `GET` on
`/stock-reservations` at all.** The full inventory operation set is
item-search, stock-availability-read, stock-movement-list, stock-issue-create,
stock-return-create, stock-reservation-create/release, and the three
create-only part surfaces. A work order's reservations cannot be listed.
`INS-17`.

### 1.5 The demand↔issue link is unconstrained

`inv.part_issues.required_part_ref` is the only column that could tie an issue
back to the demand line that asked for it, and **it has no foreign key** — the
cross-schema FK query returns nothing for it. So the link is written by whoever
calls the issue operation and verified by nobody.

Practical consequence for the UI: **a "requested vs issued" reconciliation on
the work-order screen is not reliably computable.** It can be _estimated_ by
joining on `required_part_ref` where present, and P1-29 must label such a view
as indicative, or not build it.

### 1.6 The lifecycle gate on parts lives in the API, not the schema

`assertWorkOrderAcceptsParts` refuses an issue when the work-order state is
closed, terminal, or has `allows_jobs = false`. **Enforced in the API layer
only** — the protected schema does not carry it. That is another instance of the
single-enforcement-point pattern from
[permission-matrix.md](permission-matrix.md) section 1, and it means the UI
should pre-empt the refusal from the state flags it already has rather than
letting the user discover it.

### 1.7 Closure does not prove parts are settled

`DEFERRED_CLOSURE_BLOCKERS` names owner `P1-21` and conditions
`active-reservation` and `open-part-issue` as **deliberately absent** from the
closure gate. A work order can close with stock still reserved. P1-29's closure
screen must not imply otherwise.

### 1.8 P1-29's honest parts scope

**Build:** record a required part; list required parts; link out to inventory.
**Do not build:** a parts request workflow, a fulfilment tracker, a reservation
panel, or a "parts ready" indicator. None of them has a contract behind it.

---

## 2. Quotation and approval — the commercial track

### 2.1 Three orthogonal facts on one additional-work row

`wo.additional_work_requests` carries them separately, and conflating any two is
a product error:

| column                                                   | meaning                 | mutability                                                                                                                |
| -------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `is_required`                                            | **technical necessity** | **immutable after insert**                                                                                                |
| `state` (`pending \| approved \| rejected \| withdrawn`) | **commercial decision** | only `pending` has outbound edges                                                                                         |
| `fulfillment_state`                                      | **execution**           | written only by the fulfilment operation, which refuses unless `state = 'approved'`; `waived` requires a non-empty reason |

### 2.2 Approval is forgery-resistant by construction

`wo.guard_additional_work_state` is `BEFORE UPDATE OF state` and **refuses
`state = 'approved'` unless a row with `decision = 'approved'` already exists in
`wo.customer_approvals` for that request.** The two writes are forced into one
transaction; the state cannot be advanced by a caller who did not record a
customer decision.

`wo.customer_approvals` is the immutable decision record:
`decision ∈ {approved, rejected}` — **there is no `partial` and no `revised`** —
`channel ∈ {in_person, phone, email, sms, portal, other}`, plus
`presented_scope`, `decidingPartyRoleId`, and optional evidence.

`POST /additional-work/{requestId}/approval` — mandatory `If-Match`, body
`{decision, channel, decidingPartyRoleId, presentedScope, evidence[]?,
quotationRevisionRef?}`, audit class **APPROVAL**, permission
`wo.additional_work.approve`.

### 2.3 Linking an approval to a quotation revision — six gates

`assertLinkableQuotationRevision` refuses unless **all** of:

1. the revision is visible;
2. it is in the **same company and branch** as the request;
3. the caller holds `quo.quotation.read` **in that scope**;
4. it belongs to the **same work order**;
5. it is the **current** revision;
6. (the sixth condition in `assertLinkableQuotationRevision`).

The sanctioned read across the boundary is the `commercialApproval` port:
`commercialApprovalReader().standingOf(db, revisionId, {lock: true})` →
`{revisionId, quotationId, workOrderId, companyId, branchId, currency,
grandTotal, revisionStatus, …}`. **P1-29 must not reach into `quo` any other
way.**

### 2.4 Partial approval is storable, and not readable

`quo.approval_decisions` is append-only and bound to the exact
`(revision, item)` pair by composite FK, one decision per line — so the storage
supports line-granular partial approval **exactly**.

The read does not. `rollUpDecisions` returns `'rejected'` if **any** item is
rejected, and `'accepted'` only if **every** item is approved. The fold is
deliberate and **lossy**, and no operation exposes the per-item decisions.

So a UI cannot show "3 of 5 lines approved" even though the database knows it.
`INS-18`.

### 2.5 Quotations cannot carry part lines through the API

`quo.quotation_items` supports `item_kind ∈ {service, part}` with an
`item_ref` FK to `inv.item_master` and a `source_required_part_ref`. **Both
write routes accept only a `{serviceId, …}` line shape.** Parts on a quotation
are representable in the schema and unreachable through the API.

Related: `quo.quotation_items.source_service_line_ref` has **no foreign key**;
the service stores whatever the caller sends. Provenance from a work-order
service line to a quotation line is unvalidated.

### 2.6 There is no path from a finding to a quotation

`POST /quotations` takes `{workOrderId, lines:[{serviceId, …}]}` and has no
`findingId`, `recommendationId` or `additionalWorkRequestId` field.
`quo.quotations` has no such column either. The diagnostic → commercial link is
`wo.additional_work_requests.originating_finding_id` — the unconstrained soft
link (`INS-07`) — and nothing else.

The API compensates partially: `additional-work-service` verifies that the
finding belongs to a report on the same work order. That is a check, not a
foreign key, and it does not make the link reverse-queryable.

### 2.7 A work order's quotations cannot be listed

The quotation read surface is `quo.quotation-detail`
(`GET /quotations/{quotationId}`) **only**. There is no `GET /quotations` and no
`workOrderId` filter anywhere. Given a work order, its quotations are not
discoverable. `INS-19`.

### 2.8 What "authorised for execution" means, per line — it does not

Three coarse authorities exist and **none is per-line**:

1. **Work-order level**: `rec.authorizations.decision = 'approved'` is a hard
   INSERT precondition of the work order itself (`wo.guard_work_order_refs`).
2. **Additional-work level**: `wo.customer_approvals.decision`, per request.
3. **Quotation level**: `quo.approval_decisions`, per line — but folded lossily
   on read (2.4) and not linked to a work-order line (2.5).

So: **"is this specific job authorised?" has no answer.** A UI that renders a
per-job authorisation badge is inventing one. The three authorities can be shown
as what they are, at the levels they exist. `INS-20`.

### 2.9 P1-29's honest commercial scope

**Build:** raise additional work; show `is_required` / `state` /
`fulfillment_state` as three separate facts; record the customer decision with
its channel and presented scope; attach approval evidence; show the linked
quotation revision when one exists.
**Do not build:** a partial-approval view, a quotation list for a work order, a
per-line authorisation indicator, or a finding→quotation flow.

---

## 3. Reception — upstream, and the only door in

### 3.1 The conversion

`POST /receptions/{receptionId}/convert-to-work-order`
(`rec.reception-convert-to-work-order`) is **the** sanctioned path. It locks the
visit `FOR UPDATE`, re-authorizes against the _locked visit's own branch_, and
answers a replay by returning the work order it already created.

`wo.work_orders.reception_visit_id` is **NOT NULL**, a branch-scoped composite
FK. `vehicle_id` is resolved **through** the visit and coherence-locked — the
guard refuses any mismatch on INSERT and on UPDATE.

Preconditions enforced by `wo.guard_work_order_refs` on INSERT:

- the visit is `authorized` or `converted`;
- an approved `rec.authorizations` row exists;
- custody has been accepted;
- the initial state is non-terminal;
- (and the vehicle coherence rule above).

`POST /work-orders` is deliberately absent and documented as such in the route
file: a second insert would not hold the reception-visit lock, so two concurrent
callers on two paths would race
`uq_work_orders_ordinary_origin` and one would receive a raw `23505`.

### 3.2 The two non-conversion exits

`rec.reception-close-without-work` and `rec.reception-refuse`
(`reception_status` includes `closed_without_work` and `refused`). **P1-29 must
not present conversion as the only outcome of a reception** — a work-order board
that implies every visit becomes a work order misdescribes the process.

### 3.3 The reverse lookup does not exist

No read answers "which work order came from this visit / appointment".
`rec.reception-detail` returns no work-order id, and `GET /work-orders` accepts
only `{companyId*, branchId*, state?, kind?, openedFrom?, openedTo?, cursor,
limit}` — no `receptionVisitId` filter. `INS-21`.

### 3.4 Work order → customer: three joins, zero reads

`WorkOrderDetail.workOrder` is
`{id, companyId, branchId, receptionVisitId, vehicleId, kind, state,
partsForwardState, displayNumber, openedAt, recordVersion}`. **No customer.**

The chain that exists in the database is
`wo.work_orders → rec.reception_visits → rec.reception_party_roles →
crm.business_partners`, and none of it is exposed from the work-order side.

There is a client-side path — `GET /receptions/{receptionId}` returns the visit
(with `origin`, `appointmentId`, `walkInId`, `vehicleId` and display numbers),
and `GET /appointments/{appointmentId}` returns `requesterPartnerId` plus the
requester's display name joined from `crm.business_partners`. But:

- it is **two or three extra round trips per work order**, so it cannot feed a
  board column;
- it requires `rec.reception.read` and `apt.appointment.read` **in addition to**
  `wo.work_order.read`, so it fails for a caller who legitimately holds only the
  work-order code;
- the appointment path does not exist for walk-ins
  (`appointment_id` XOR `walk_in_id`, enforced by
  `ck_reception_visits_one_origin`).

**Recommendation: do not chain.** Show the customer on the work-order _detail_
only, only when the caller holds the extra permissions, and label its absence
honestly otherwise. Record the Backend request — a customer projection on the
work-order read — as the fix. `INS-10`.

### 3.5 The P1-28 precedent to extend, not duplicate

P1-28 already built the conversion step and a deliberately minimal work-order
read:

- `apps/web/src/features/receptions/work-order-contract.ts` —
  `ConvertedWorkOrder`, `WORK_ORDER_READ_PERMISSION`
- `apps/web/src/features/receptions/work-order-api.ts` —
  `readConvertedWorkOrder(workOrderId)` → `ReadState<ConvertedWorkOrder>`, a
  **thin subset** of the detail projection (`{id, displayNumber, state, kind,
…}`)

P1-29 will need the full projection. The right move is a new
`features/work-orders` adapter with the complete contract, and then a decision
about whether the reception feature keeps its thin one or imports the new one —
noting that "a feature may never import another feature" is a convention
enforced by nothing (`INS-14`). Duplicating the contract in two places, with two
sets of field names for the same payload, is the outcome to avoid.

---

## 4. Downstream — the money boundary

`sal.invoice-preview` is the one downstream operation in P1-29's field of view.
A closed work order becomes an invoice through the sales module, which P1-29
does not own and does not render. The work-order screen's relationship to it is
a link, at most.

Note that closure does **not** verify parts settlement (section 1.7), so a
"ready to invoice" claim on the work-order screen would be unfounded. Show
closure as closure.

---

## 5. Boundary summary

| boundary       | P1-29 consumes                                                              | P1-29 must not build                                                             |
| -------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **parts**      | required-part record + list; a link out to inventory                        | request workflow, fulfilment tracker, reservation panel, parts-ready indicator   |
| **commercial** | additional work, customer decision, evidence, the `commercialApproval` port | partial-approval view, quotation list, per-line authorisation, finding→quotation |
| **reception**  | the conversion (P1-28 owns the screen), the work order it produced          | a second creation path, a reverse lookup, a chained customer column on the board |
| **sales**      | a link                                                                      | anything                                                                         |
