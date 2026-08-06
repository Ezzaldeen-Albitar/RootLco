# End-to-End Workshop Workflow

**Status:** Planning — not implemented · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Recorded:** 2026-08-06 · **Phase authority:** P1-27 Owner-acceptance remediation

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 0. This document is planning and traceability only

**Nothing described below is implemented by Phase 1-27.** This document maps the
Product Owner's twenty-nine-step workshop journey onto the contracts that exist
in this repository today, and records — by number — every place where the
contract a step needs does not exist.

Read it as three separate statements, never as one:

| statement                     | what it means                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **A Backend contract exists** | A published API operation was read out of a route file in this repository. It can be called. It does **not** mean a screen calls it. |
| **A Frontend screen exists**  | Only true for the small set listed in §2. Everywhere else, no screen exists and none is scheduled by this phase.                     |
| **A step is described here**  | The step is a business intention that has been mapped. Mapping is not building.                                                      |

Phase 1-27 delivered **customer and vehicle search, reading and creation
screens, and the two duplicate-review screens** — nothing else. Every step from
"reception case created" onwards is unimplemented Frontend work belonging to
later phases. No sentence in this document should be read as "the workshop can
do this today".

This document also does not authorise work. It is a map. The obligations it
records become real only when a later phase takes them into its own task
register and gate.

---

## 1. How to read a step

### 1.1 The twelve attributes

Every one of the twenty-nine steps below carries the same twelve attributes, in
the same order, so that two steps can be compared without re-reading the prose.

| attribute                   | what it records                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | The person or system that performs the step. A role description, never a permission code — permissions appear on their own line.              |
| **Trigger**                 | What starts the step. A physical event, a prior step's output, or a decision.                                                                 |
| **Input**                   | What must already be true or already recorded before the step can run.                                                                        |
| **State**                   | Which record's state changes, and from what to what. Named against the real column and the real value.                                        |
| **Action**                  | What is actually done, in business terms.                                                                                                     |
| **Output**                  | What the step produces for the next step.                                                                                                     |
| **Permission**              | The permission code(s) the Backend requires. Multiple codes on one operation are **all** required. Read out of the route file, never guessed. |
| **Audit**                   | The operation's audit class and audit action code, exactly as declared. `none` means the platform writes no audit record for it.              |
| **Exception**               | What goes wrong, and what the system does about it.                                                                                           |
| **Evidence**                | The durable record left behind — rows, documents, signatures — that a later dispute would be settled from.                                    |
| **Owning Backend contract** | The real operation id, method, path and status. `ABSENT` where nothing exists, with a finding number.                                         |
| **Owning Frontend phase**   | The phase that owes the screen. `P1-27` only where P1-27 genuinely delivered it.                                                              |

### 1.2 Backend contract status vocabulary

| status      | meaning                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| **PRESENT** | A published operation covers the step's essential action.                                                             |
| **PARTIAL** | An operation exists but does not cover the whole step — usually a write with no matching read, or a missing sub-case. |
| **ABSENT**  | No published operation covers the step at all. Always carries a finding number.                                       |

### 1.3 How the ground truth in this document was established

Every operation id, method, path, permission code, audit class, table, column
and status value below was read out of this repository on the working branch
`remediation/p1-27-owner-acceptance-ux`. Nothing was recalled or inferred.

| what was counted                                        | how                                                                                                       | result  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------- |
| Published API operations                                | Every `defineOperation({…})` block under `apps/api/src/app/api/v1/**/route.ts`, located by brace matching | **243** |
| Permission codes in the catalogue                       | `supabase/seeds/04_iam_permission_catalog.sql`                                                            | **104** |
| Catalogue codes actually required by at least one route | Route permissions reconciled against the catalogue                                                        | **92**  |
| Catalogue codes required by **no** route                | The remainder                                                                                             | **12**  |
| Route permission codes **not** present in the catalogue | The reverse reconciliation                                                                                | **0**   |

The twelve codes no operation asks for are listed in §7.6. Two of them are still
enforced by the database even so, which is why §7.6 separates "asked for by no
operation" from "does nothing".

**A permission list on an operation is the minimum, not the whole requirement.**
Several restricted tables carry their own permission check in their row rules, so
a person can hold everything an operation declares and still be refused. Every
such case found while mapping this journey is recorded in **WF-27**. The seed
files under `supabase/seeds/` were read as well as the migrations, because one of
them — the work-order and job state graph — changes what a screen may assume.

---

## 2. What Phase 1-27 actually delivers

### 2.1 The whole of it

Phase 1-27 is a **CRM and Vehicle read/create Frontend phase**. It delivers
screens over customer and vehicle records. It delivers no operational workshop
capability of any kind.

The screens that exist in `apps/web/src/features/` are:

| area    | screen                                                                                                        | what it does                                   |
| ------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| CRM     | Customer search and results                                                                                   | Find a customer                                |
| CRM     | Individual-customer and company-customer creation                                                             | Create a customer                              |
| CRM     | Customer profile with contacts, addresses, preferences, consents, notes, alerts, tags, restrictions, timeline | Read and maintain a customer's own sub-records |
| CRM     | Customer duplicate review                                                                                     | Compare duplicate candidates and dismiss       |
| Vehicle | Vehicle search and results                                                                                    | Find a vehicle                                 |
| Vehicle | Vehicle creation, including VIN entry                                                                         | Create a vehicle                               |
| Vehicle | Vehicle profile with plates, ownerships, relationships, odometer, EV profile, documents, attribute history    | Read and maintain a vehicle's own sub-records  |
| Vehicle | Vehicle duplicate review                                                                                      | Compare duplicate candidates and dismiss       |

Everything else the operator sees — sign-in, the application shell, navigation,
language switching, notifications, and the Administration screens — came from
Phase 1-26 and earlier, not from P1-27.

### 2.2 What Phase 1-27 explicitly does not deliver

| journey steps | subject                                                            | owed by                     |
| ------------- | ------------------------------------------------------------------ | --------------------------- |
| 1, 4–11       | Arrival, reception visit, condition and concern capture, approval  | **P1-28**                   |
| 12–16, 21–24  | Work order, jobs, assignment, work logging, completion, QA, rework | **P1-29**                   |
| 17–20         | Parts, external parts, pricing, quotation and customer approval    | **P1-30**                   |
| 25–28         | Invoicing, payment, delivery readiness, handover, warranty         | **P1-30 / P1-31**           |
| 29            | A single cross-domain vehicle and customer service history         | Not established — see WF-19 |

The Frontend phase ownership above is taken from the phase records already in
this repository: `docs/phase-1/phase-1-8/**` names **P1-28**, `phase-1-9/**`
names **P1-29**, `phase-1-10/**` names **P1-30**, and `phase-1-11/**` names
"P1-30/1-31" without splitting them. That split is therefore **not established**
and must not be invented here.

### 2.3 The two open Owner decisions inside P1-27's own scope

Both are named where they bind, and neither is written around.

| decision      | subject                                | effect inside P1-27                                                                                                                                                                                                                                    |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P1-OD-017** | Duplicate and merge rules              | The duplicate **review** screens ship; the **merge action does not**. The merge affordance is absent, not disabled — a disabled control would claim the capability exists and the operator lacks permission, which is a different and false statement. |
| **P1-OD-025** | Vehicle document and media file policy | The document **list** ships as a read. Media **upload acceptance is blocked**: no accepted file types are asserted, no size limit is invented, no storage arrangement is assumed.                                                                      |

---

## 3. The journey is not one status field

### 3.1 Why a single status cannot carry this workflow

A workshop visit is not a queue position. At any moment a vehicle can
simultaneously be: in the workshop's custody, halfway through a diagnostic, with
one job finished and another waiting for a part, with an approved quotation
covering some lines and a pending additional-work request covering others, with
an invoice not yet issued and a delivery that cannot proceed.

A single status field can express exactly one of those facts. It would have to
choose, and every screen built on it would then be asking a question the field
cannot answer — "can this vehicle go home?" is not answered by "in progress".

The platform therefore holds **many independent state carriers**, each owning one
question, each with its own transition rules, each with its own history table.

### 3.2 The state carriers, as they exist in the schema today

Every value below is a real, verified CHECK-constrained vocabulary or a
configurable catalogue.

| entity                     | state column                                    | vocabulary                                                                                                                                                                                                                                                                                                                                           | how it moves                                                                                                                   |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Appointment                | `apt.appointments.lifecycle_status`             | `requested` · `pending_confirmation` · `confirmed` · `checked_in` · `cancelled` · `no_show`                                                                                                                                                                                                                                                          | Frozen graph. `checked_in` has no outgoing edge and is reached **only** by reception creation.                                 |
| Reception visit            | `rec.reception_visits.reception_status`         | `opened` · `inspecting` · `authorized` · `converted` · `closed_without_work` · `refused`                                                                                                                                                                                                                                                             | `opened → inspecting → authorized → converted`; any live state may go to `closed_without_work` or `refused`; terminals frozen. |
| Visual inspection          | `rec.visual_inspections.inspection_status`      | `in_progress` · `completed` · `cancelled`                                                                                                                                                                                                                                                                                                            | Created `in_progress`. **No published operation moves it** — see WF-06.                                                        |
| Work order                 | `wo.work_orders.state`                          | Platform default, seeded in `supabase/seeds/06_wo_job_state_graph.sql`: `draft` · `open` · `in_progress` · `awaiting_parts` · `awaiting_customer` · `qc_pending` · `ready_to_close` · `closed` · `cancelled`. A tenant may add its own non-terminal routing states in `wo.work_order_states`; closed and cancellation states stay platform-governed. | A transition is legal only where an active edge exists in `wo.work_order_transitions`. Terminals frozen.                       |
| Work order (parts)         | `wo.work_orders.parts_forward_state`            | `none` · `requested` · `reserved_elsewhere`                                                                                                                                                                                                                                                                                                          | A forward contract; no stock reservation is enforced by it.                                                                    |
| Work order (kind)          | `wo.work_orders.kind`                           | `ordinary` · `rework`                                                                                                                                                                                                                                                                                                                                | One `ordinary` work order per reception origin; a rework reuses the same visit.                                                |
| Job                        | `wo.jobs.state`                                 | Platform default, seeded in the same file: `planned` · `assigned` · `in_progress` · `paused` · `completed` · `cancelled`. Tenant-extensible on the same terms.                                                                                                                                                                                       | Same mechanism as the work order, through `wo.job_transitions`, and moving independently of it.                                |
| Diagnostic report          | `dia.diagnostic_reports.status`                 | `draft` · `in_progress` · `completed` · `cancelled`                                                                                                                                                                                                                                                                                                  | Its own transition and completion operations.                                                                                  |
| Additional-work request    | `wo.additional_work_requests.state`             | `pending` · `approved` · `rejected` · `withdrawn`                                                                                                                                                                                                                                                                                                    | The customer decision.                                                                                                         |
| Additional-work fulfilment | `wo.additional_work_requests.fulfillment_state` | `unfulfilled` · `fulfilled` · `waived`                                                                                                                                                                                                                                                                                                               | **A second field on the same row**: approval and execution are different facts.                                                |
| Stock reservation          | `inv.stock_reservations.status`                 | `active` · `released` · `consumed` · `expired`                                                                                                                                                                                                                                                                                                       | `active` is a status, never time-derived.                                                                                      |
| Customer-supplied part     | `inv.customer_supplied_parts.custody_state`     | `received` · `in_use` · `returned` · `consumed`                                                                                                                                                                                                                                                                                                      | Custody only; never valued stock, never a stock movement.                                                                      |
| External purchase part     | `inv.external_purchase_parts.status`            | `recorded` · `linked` · `cancelled`                                                                                                                                                                                                                                                                                                                  | A reference, not a purchase order — `is_procurement` is always false.                                                          |
| Quotation                  | `quo.quotations.status`                         | `draft` · `active` · `accepted` · `rejected` · `expired` · `cancelled`                                                                                                                                                                                                                                                                               | Issue and revision operations.                                                                                                 |
| Quality-control record     | `qms.quality_control_records.overall_result`    | `pending` · `passed` · `failed`                                                                                                                                                                                                                                                                                                                      | Finalisation. A finalised record must carry both a checker and a timestamp.                                                    |
| Invoice                    | `sal.invoices.status`                           | `draft` · `issued` · `credited` · `void_before_issue`                                                                                                                                                                                                                                                                                                | A number and an issue timestamp exist **if and only if** the invoice is issued.                                                |
| Receipt                    | `sal.receipts.status`                           | `recorded` · `partially_allocated` · `allocated` · `reversed`                                                                                                                                                                                                                                                                                        | Allocation moves it; amount and method freeze on record.                                                                       |
| Delivery                   | `sal.delivery_records.status`                   | `ready` · `receiver_verified` · `signed` · `delivered` · `exception`                                                                                                                                                                                                                                                                                 | `delivered` exists if and only if a delivered-at time and a final odometer reading do.                                         |
| Warranty                   | `wty.warranty_records.status`                   | `issued` · `active` · `expired` · `voided` · `claimed_against`                                                                                                                                                                                                                                                                                       | Issued at delivery.                                                                                                            |
| Vehicle (lifecycle)        | `veh.vehicles.lifecycle_status`                 | `draft` · `active` · `inactive` · `merged` · `scrapped`                                                                                                                                                                                                                                                                                              | Merge sets `merged` and a redirect together, or neither.                                                                       |
| Vehicle (workshop)         | `veh.vehicles.workshop_status`                  | `none` · `in_workshop` · `awaiting_parts` · `ready_for_delivery`                                                                                                                                                                                                                                                                                     | **A second, independent field.** A merged or scrapped vehicle must be `none`.                                                  |
| Customer (lifecycle)       | `crm.business_partners.lifecycle_status`        | `prospect` · `active` · `inactive` · `blocked` · `merged`, defaulting to `prospect`                                                                                                                                                                                                                                                                  | Governance operations.                                                                                                         |
| Customer (commercial)      | `crm.business_partners.commercial_status`       | **A second field**: `normal` · `watch` · `hold`, defaulting to `normal`                                                                                                                                                                                                                                                                              | Restrictions and blocks.                                                                                                       |

**The vehicle carries two status fields and so does the customer.** That is the
clearest single proof that this workflow is not one status: a vehicle can be
commercially `active` and operationally `awaiting_parts` at the same time, and
neither fact is derivable from the other.

### 3.3 The custody chain is a separate spine again

Custody of the vehicle is not a status — it is a chain of dated events in
`rec.custody_history`, moving `accepted` → `in_workshop` → `released`. The chain
opens when the reception visit is created and is released only when a delivery
completes: the delivery module writes the release row as part of completing the
handover, and a unique index, `uq_custody_history_released`, makes certain it can
happen exactly once. A status field would lose the middle of that chain; the
chain is what a dispute is settled from.

### 3.4 The entities this workflow models

Sixteen distinct things, none of which is a status on another. One of them —
department task — has nowhere to live at all:

| entity                 | where it lives                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reception visit        | `rec.reception_visits` (+ 22 further `rec` tables)                                                                                                                            |
| Inspection activity    | `rec.visual_inspections`, `rec.condition_items`, `rec.damage_maps`, `rec.damage_marks`                                                                                        |
| Work order             | `wo.work_orders`, `wo.work_order_status_history`                                                                                                                              |
| Department task        | **No table.** `org.departments` exists; nothing operational references it — see WF-09.                                                                                        |
| Technician assignment  | `wo.job_assignments`                                                                                                                                                          |
| Work log               | `tech.labor_sessions`                                                                                                                                                         |
| Diagnostic finding     | `dia.findings`, `dia.measurements`, `dia.dtc_records`, `dia.recommendations`, `dia.report_item_results`                                                                       |
| Media / evidence       | `shared.documents`, `shared.document_versions`, `dia.diagnostic_evidence`                                                                                                     |
| Parts consumption      | `inv.stock_reservations`, `inv.part_issues`, `inv.part_returns`, `inv.stock_movements`                                                                                        |
| External part request  | `inv.external_purchase_parts`                                                                                                                                                 |
| Customer-supplied part | `inv.customer_supplied_parts`                                                                                                                                                 |
| Quotation and approval | `quo.quotations`, `quo.quotation_items`, `quo.quotation_revisions`, `quo.approval_decisions`, `wo.customer_approvals`                                                         |
| Quality control        | `qms.quality_control_records`, `qms.qc_check_results`, `qms.rework_links`                                                                                                     |
| Invoice / payment      | `sal.invoices`, `sal.receipts`, `sal.payment_allocations`, `sal.credit_notes`                                                                                                 |
| Delivery event         | `sal.delivery_records`, `sal.delivery_signatures`, `sal.authorized_receivers`                                                                                                 |
| Timeline / history     | `crm.timeline_events`, `veh.vehicle_attribute_history`, `wo.work_order_status_history`, `iam.audit_records` (with `iam.audit_record_details` and `iam.audit_integrity_links`) |

---

## 4. Customer-reported concerns and technically verified findings are different records

### 4.1 The rule

**A customer's complaint is never promoted into a technical finding.** They live
in different tables, are written by different operations, carry different
vocabularies, and are gated by different permissions.

The reason is legal and commercial, not architectural tidiness. "The customer
said it makes a noise" and "the workshop confirmed the near-side wheel bearing is
worn" carry entirely different liability. A system that lets the first quietly
become the second has destroyed the evidence that would settle the argument.

### 4.2 The two records, side by side

| aspect         | Customer-reported concern                                                                           | Technically verified finding                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Table          | `rec.complaints`                                                                                    | `dia.findings`                                                                                                 |
| Hangs off      | `reception_visit_id`                                                                                | `diagnostic_report_id`                                                                                         |
| Attributed to  | `reported_by_partner_id` — the customer                                                             | `created_by` — the technician; the report also pins its template version                                       |
| Classification | `category`: `mechanical` · `electrical` · `body` · `noise` · `performance` · `other`                | `severity`: `info` · `low` · `medium` · `high` · `critical`                                                    |
| Judgement      | `severity`: `low` · `medium` · `high` · `critical` — the **customer's** sense of urgency            | `disposition`: `monitor` · `repair_recommended` · `repair_required` · `no_action` — the **workshop's** verdict |
| Free text      | `complaint_text` on a **separate restricted table**, `rec.complaint_details`, one row per complaint | `description` on the finding row itself, required non-blank                                                    |
| Written by     | `rec.reception-condition-evidence` with `kind: 'complaint'`                                         | `dia.diagnostic-finding-record`                                                                                |
| Permission     | `rec.reception.evidence.manage`, **and `iam.sensitive.view` as well** for the words themselves      | `dia.diagnostic.record`                                                                                        |
| Corrections    | `correction_of` — a superseding row, never an edit                                                  | Report-level revision; the report's items freeze once its version publishes                                    |

There is a third record again distinct from both: `rec.condition_items` — what
staff observed **at reception**, before any diagnosis. The route file states the
rule in its own words: it is "a separate table from a complaint, and never
promoted into one".

### 4.3 The link that does not exist

`dia.findings` carries no column referencing `rec.complaints`, and no operation
associates one with the other. A screen cannot today show "the noise the customer
reported was diagnosed as this". The only association the schema offers anywhere
near this is `wo.additional_work_requests.originating_finding_id`, which the
migration itself describes as "an opaque soft link to a diagnostic finding" — a
soft link with no foreign key, pointing the other way. Recorded as **WF-05**.

---

## 5. The twenty-nine steps

### Step 1 — Vehicle arrival

| attribute                   | value                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Actor**                   | Customer or driver; reception officer receiving them                                                                                                               |
| **Trigger**                 | A vehicle physically arrives at the branch, with or without an appointment                                                                                         |
| **Input**                   | Nothing recorded. For an appointment arrival, an appointment in state `confirmed`                                                                                  |
| **State**                   | **None changes.** No record represents "arrived". The first durable state change is at step 4                                                                      |
| **Action**                  | Greet, establish whether an appointment exists, begin identification                                                                                               |
| **Output**                  | A decision: appointment arrival or walk-in                                                                                                                         |
| **Permission**              | None — no operation is called                                                                                                                                      |
| **Audit**                   | None                                                                                                                                                               |
| **Exception**               | The vehicle already has a live reception visit. `uq_reception_visits_open_vehicle` permits one open visit per vehicle per tenant, so step 4 will refuse the second |
| **Evidence**                | None until step 4. `rec.reception_visits.custody_accepted_at` is the earliest durable arrival time the platform holds                                              |
| **Owning Backend contract** | **ABSENT** — no arrival, queue or check-in record exists independently of the reception visit. **WF-01**                                                           |
| **Owning Frontend phase**   | P1-28                                                                                                                                                              |

**A trap for whoever builds this.** The appointment state `checked_in` is
reachable **only** as a side effect of creating a reception visit, inside the same
transaction, and it is terminal. And the operation that moves an appointment to
`confirmed` — the only state a check-in is legal from — is called
`apt.appointment-reschedule`, not "confirm". A screen that offers "Confirm
appointment" must call the reschedule operation, and `pending_confirmation` is
reachable by no published operation at all. Recorded as **WF-02**.

### Step 2 — Customer identification or creation

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Actor**                   | Reception officer                                                                                                                                                                                                                                                                                                                                            |
| **Trigger**                 | Step 1                                                                                                                                                                                                                                                                                                                                                       |
| **Input**                   | A name, telephone number, identifier or company name offered by the customer                                                                                                                                                                                                                                                                                 |
| **State**                   | On creation, a new `crm.business_partners` row at `lifecycle_status = 'prospect'`, `commercial_status = 'normal'`                                                                                                                                                                                                                                            |
| **Action**                  | Search; if found, open the profile; if not, create an individual or a company                                                                                                                                                                                                                                                                                |
| **Output**                  | A customer id for step 3 and step 4                                                                                                                                                                                                                                                                                                                          |
| **Permission**              | Search and read `crm.customer.read` · create `crm.customer.create`                                                                                                                                                                                                                                                                                           |
| **Audit**                   | Reads: **none**. Creation: class `privileged`, action `crm.customer.created`                                                                                                                                                                                                                                                                                 |
| **Exception**               | A likely duplicate. `crm.duplicate-list` surfaces open candidates; `crm.duplicate-scan` is a **privileged write that emits an audit record**, so it is never run on keystroke. **`P1-OD-017` binds here**: the reception officer may review and dismiss a candidate, but no rule yet says when two records are the same customer, so no merge may be offered |
| **Evidence**                | `crm.business_partners`, `crm.individual_profiles` or `crm.company_profiles`, `crm.partner_status_history`, the creation audit record                                                                                                                                                                                                                        |
| **Owning Backend contract** | **PRESENT** — `crm.customer-search` GET `/customers` · `crm.customer-read` GET `/customers/{customerId}` · `crm.individual-create` POST `/customers/individuals` · `crm.company-create` POST `/customers/companies`                                                                                                                                          |
| **Owning Frontend phase**   | **P1-27 — delivered**                                                                                                                                                                                                                                                                                                                                        |

**A customer's own master fields cannot be corrected after creation.** There is no
`PATCH`, `PUT` or `DELETE` on `/customers/{customerId}`. Only sub-resources —
contacts, addresses, preferences, tags, alerts, restrictions, status — can be
maintained. A typed name is permanent. Recorded as **WF-03**.

### Step 3 — Vehicle identification or creation

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Reception officer                                                                                                                                                                                                                                                                                                                                                |
| **Trigger**                 | Step 2 complete                                                                                                                                                                                                                                                                                                                                                  |
| **Input**                   | Plate, VIN, or make and model; the customer id from step 2                                                                                                                                                                                                                                                                                                       |
| **State**                   | On creation, `veh.vehicles` at `lifecycle_status = 'draft'` or `'active'`, `workshop_status = 'none'`                                                                                                                                                                                                                                                            |
| **Action**                  | Search; if not found, create, choosing make, model, trim, body type and powertrain from the catalogue; then link the vehicle to the customer                                                                                                                                                                                                                     |
| **Output**                  | A vehicle id for step 4                                                                                                                                                                                                                                                                                                                                          |
| **Permission**              | Read `veh.vehicle.read` · create and edit **`veh.vehicle.manage`** · link to a customer `crm.customer.vehicle.manage`                                                                                                                                                                                                                                            |
| **Audit**                   | Reads: **none**. Creation: `privileged` / `veh.vehicle.created`. Link: `privileged` / `crm.customer.vehicle_linked`                                                                                                                                                                                                                                              |
| **Exception**               | A VIN already in use. The platform enforces active-VIN uniqueness and surfaces it as a conflict. `veh.vin_verifications` is a table **no published operation reads or writes** — there is no check-digit workflow and no override policy. **`P1-OD-017` binds here too**: a duplicate vehicle can be reviewed and dismissed, never merged, until the rule is set |
| **Evidence**                | `veh.vehicles`, `veh.vehicle_identifiers`, `veh.plate_history`, `veh.vehicle_relationships`, the creation audit record                                                                                                                                                                                                                                           |
| **Owning Backend contract** | **PRESENT** — `veh.vehicle-search` GET `/vehicles` · `veh.vehicle-read` GET `/vehicles/{vehicleId}` · `veh.vehicle-create` POST `/vehicles` · `veh.vehicle-update` PATCH `/vehicles/{vehicleId}` · five `veh.catalogue-*` reads · `crm.vehicle-link` POST `/customers/{customerId}/vehicles`                                                                     |
| **Owning Frontend phase**   | **P1-27 — delivered**                                                                                                                                                                                                                                                                                                                                            |

**The create and edit permission is `veh.vehicle.manage`.** There is no
`veh.vehicle.create` code and there never has been; the catalogue check refuses
it. The vehicle catalogue itself is **read-only over HTTP** — no operation creates
or edits a make, model, trim, body type or powertrain type, and no
catalogue-management permission is seeded. Recorded as **WF-04**.

### Step 4 — Reception case / service visit creation

| attribute                   | value                                                                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Reception officer                                                                                                                                                                                                                                                                                  |
| **Trigger**                 | Customer and vehicle identified                                                                                                                                                                                                                                                                    |
| **Input**                   | Company, branch, vehicle, receiving employee, service-requester partner, and exactly one origin — an appointment **or** a walk-in. Optionally an odometer reading, a fuel level, an EV charge percentage                                                                                           |
| **State**                   | `rec.reception_visits.reception_status` → **`opened`**. An appointment origin moves the appointment to `checked_in` in the same transaction                                                                                                                                                        |
| **Action**                  | Open the visit and accept custody of the vehicle                                                                                                                                                                                                                                                   |
| **Output**                  | A reception visit id; an open custody chain                                                                                                                                                                                                                                                        |
| **Permission**              | `rec.reception.manage` · **branch** scope                                                                                                                                                                                                                                                          |
| **Audit**                   | Class `privileged`, action `rec.reception.created`                                                                                                                                                                                                                                                 |
| **Exception**               | The vehicle already has a live visit — refused by `uq_reception_visits_open_vehicle`. The appointment is not `confirmed` — refused. The body names a company or branch other than the appointment's — refused, because the authorisation target is read from the body before the transaction opens |
| **Evidence**                | `rec.reception_visits`, the first `rec.custody_history` row (`accepted`), the first `rec.reception_status_history` row, the mandatory service-requester party role — all written by one atomic primitive so there is no window in which a vehicle is held with no custody record                   |
| **Owning Backend contract** | **PARTIAL** — `rec.reception-create` POST `/receptions` exists. **There is no operation that reads a reception visit back.** **WF-06**                                                                                                                                                             |
| **Owning Frontend phase**   | P1-28                                                                                                                                                                                                                                                                                              |

### Step 5 — Vehicle-condition media capture

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Reception officer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Trigger**                 | Visit opened                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Input**                   | Photographs or video of the vehicle; a damage-map template and the exact template version drawn on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **State**                   | Evidence rows appended. The visit itself moves to `inspecting` when the inspection begins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Action**                  | Photograph the vehicle; open a damage map bound to one immutable template version; place marks by fractional coordinate; attach a document to each                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Output**                  | A dated visual record of the vehicle's condition on arrival                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Permission**              | Evidence `rec.reception.evidence.manage` · document handling `shared.document.manage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Audit**                   | Evidence: `privileged` / `rec.reception.evidence_recorded`. Upload authorisation: **`security`** / `shared.document.upload_authorized`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Exception**               | The file is rejected by scanning — `shared.attachment-version-reject`. The document version is not accepted — `shared.document_versions.status` runs `pending → accepted \| quarantined \| rejected`                                                                                                                                                                                                                                                                                                                                                                                         |
| **Evidence**                | `rec.damage_maps`, `rec.damage_marks` (coordinates as fractions, so a mark survives any rendering size), `rec.condition_items`, `shared.documents`, `shared.document_versions`, `shared.file_scan_results`                                                                                                                                                                                                                                                                                                                                                                                   |
| **Owning Backend contract** | **PARTIAL** — `rec.reception-condition-evidence` POST `/receptions/{receptionId}/condition-evidence` · `shared.attachment-upload-authorize` POST `/attachments/upload-authorizations` · `shared.attachment-version-register` POST `/attachments/versions`. **The API never accepts a file body**; it mints an authorisation and the file itself goes elsewhere. The only list of documents anywhere is `veh.vehicle-document-list` GET `/vehicles/{vehicleId}/documents` — **a reception visit's own photographs cannot be listed back**, and there is no search across documents. **WF-07** |
| **Owning Frontend phase**   | P1-28 for capture; the shared document surface has **no established Frontend phase**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**`P1-OD-025` binds this step directly.** Until the media policy is decided, no
accepted file type, no size limit, and no storage arrangement may be asserted
anywhere. Both document reads that exist are gated on `shared.document.manage` —
a **write** code — because no `shared.document.read` code exists.

### Step 6 — Customer concerns recorded

| attribute                   | value                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Reception officer, transcribing the customer                                                                                                                                                                                  |
| **Trigger**                 | The customer describes what is wrong                                                                                                                                                                                          |
| **Input**                   | The customer's own words; a category; optionally who reported it and a supporting document                                                                                                                                    |
| **State**                   | A row appended to `rec.complaints`. The visit's own status does not change                                                                                                                                                    |
| **Action**                  | Record the concern verbatim, categorised, with the **customer's** sense of severity                                                                                                                                           |
| **Output**                  | The concern list that the diagnosis in step 7 will be measured against                                                                                                                                                        |
| **Permission**              | `rec.reception.evidence.manage` **plus `iam.sensitive.view`** — see the warning below. The operation declares only the first                                                                                                  |
| **Audit**                   | Class `privileged`, action `rec.reception.evidence_recorded`                                                                                                                                                                  |
| **Exception**               | A mis-transcription. There is no edit: a superseding row cites `correction_of`, and both remain. A reception officer without `iam.sensitive.view` is refused by the database, after the operation has already authorised them |
| **Evidence**                | `rec.complaints` for the safe fields — category, severity, reporter, correction link — and `rec.complaint_details` for the customer's actual words, which are held **restricted**; optionally a linked `shared.documents` row |
| **Owning Backend contract** | **PARTIAL** — `rec.reception-condition-evidence` POST `/receptions/{receptionId}/condition-evidence` with `kind: 'complaint'`. **No read.** **WF-06**, **WF-27**                                                              |
| **Owning Frontend phase**   | P1-28                                                                                                                                                                                                                         |

**A reception officer needs a second permission that the operation does not ask
for.** The customer's own words are held on a restricted table whose insert rule
ends with a check for `iam.sensitive.view`, and the same is true of the
description of the belongings left in the vehicle. The operation itself requires
only `rec.reception.evidence.manage`, so a reception officer granted exactly what
the operation asks for will pass every check the application makes and then be
refused by the database when the words are written. Whoever takes customers'
complaints must hold `iam.sensitive.view` as well. This is not the only place it
happens — see **WF-27**.

This is one of eight kinds accepted by a single condition-evidence operation:
`complaint`, `inspection`, `condition_item`, `damage_map`, `damage_mark`,
`contents`, `warning_light`, `leak`. Signature and refusal are deliberately **not**
members — they record what a party personally acknowledged or declined, carry
their own permission, and folding them in would make them reachable by a caller
holding only evidence-capture authority.

### Step 7 — Initial computer diagnostic scan

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Reception technician with a scan tool                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Trigger**                 | Vehicle in the reception bay, concerns recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Input**                   | The vehicle's on-board diagnostic port                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **State**                   | Intended: a scan record. **No state exists to change at this point in the journey**                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Action**                  | Read stored fault codes and freeze-frame data before any work is authorised                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Output**                  | Fault codes informing the reception decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Permission**              | Would be `dia.diagnostic.record` — but see below                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Audit**                   | Would be `privileged` / `dia.diagnostic.entry_recorded`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Exception**               | The vehicle predates on-board diagnostics, or the port is unreadable. No contract expresses either                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Evidence**                | Intended: `dia.dtc_records`. At reception the nearest related record is a **dashboard warning-lamp observation** (`rec.warning_light_observations` against the `rec.warning_light_codes` catalogue) — an observation of a lamp, not a scan-tool code. **It cannot in fact be recorded today**: the catalogue ships zero rows, no seed populates it and no route creates one, while the evidence command requires a `warningLightCodeId`. See `RMC-11` in `docs/product/workshop/reception-media-checklist.md` |
| **Owning Backend contract** | **ABSENT at this point in the journey.** Diagnostics hang off a **job**: `dia.diagnostic-create` is POST `/jobs/{jobId}/inspections`, a job requires a work order, and a work order exists only after step 12. A pre-authorisation scan therefore has no contract. **WF-08**                                                                                                                                                                                                                                  |
| **Owning Frontend phase**   | P1-28 for the reception-time capture; P1-29 owns the post-work-order diagnostic screens                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Step 8 — Conditional road test

| attribute                   | value                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Reception technician or road-test driver                                                                                                       |
| **Trigger**                 | A concern that can only be reproduced in motion, and a vehicle that is safe and legal to drive                                                 |
| **Input**                   | The concern list from step 6; a decision that a road test is warranted                                                                         |
| **State**                   | **No state exists.** Nothing records that a road test was considered, declined, or performed                                                   |
| **Action**                  | Drive the vehicle under the conditions the customer described; record what was and was not reproduced                                          |
| **Output**                  | Confirmation or non-reproduction of a reported concern                                                                                         |
| **Permission**              | Not established — no permission code covers a road test                                                                                        |
| **Audit**                   | Not established                                                                                                                                |
| **Exception**               | The vehicle is unroadworthy, uninsured, or the customer refuses. None of these is expressible                                                  |
| **Evidence**                | None. A road test could only be represented as a **tenant-configured diagnostic template item**, and there is no operation to manage templates |
| **Owning Backend contract** | **ABSENT.** No table, no column, no operation and no permission covers a road test. **WF-10**                                                  |
| **Owning Frontend phase**   | P1-28 if placed at reception; P1-29 if placed on a job                                                                                         |

**Do not mistake a test fixture for a contract.** A road-test item appears in this
repository only inside the Phase 1-19 backend test files —
`tests/backend/p1-19-helpers.ts` and `tests/backend/p1-19-diagnostics.test.ts` —
as a fixture used to build a diagnostic template during a test. It is test
scaffolding. It appears in no migration, no seed and no operation, and citing it
as a shipped catalogue entry would be a fabrication.

### Step 9 — Lift inspection

| attribute                   | value                                                                                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Reception technician                                                                                                                                                                                                                                                             |
| **Trigger**                 | The vehicle is raised on a lift during reception                                                                                                                                                                                                                                 |
| **Input**                   | An inspection header, opened with a named inspector                                                                                                                                                                                                                              |
| **State**                   | `rec.visual_inspections.inspection_status` is created **`in_progress`** and **stays there** — no published operation completes or cancels it                                                                                                                                     |
| **Action**                  | Inspect the underside; record each observation as a condition item against a vehicle zone, with a severity and an optional photograph                                                                                                                                            |
| **Output**                  | The staff-observed condition record, distinct from both the customer's concerns and any later diagnosis                                                                                                                                                                          |
| **Permission**              | `rec.reception.evidence.manage`                                                                                                                                                                                                                                                  |
| **Audit**                   | Class `privileged`, action `rec.reception.evidence_recorded`                                                                                                                                                                                                                     |
| **Exception**               | An item recorded against the wrong inspection. A superseding row cites `correction_of`; a finalised inspection refuses modification entirely                                                                                                                                     |
| **Evidence**                | `rec.visual_inspections`, `rec.condition_items` (`scratch` · `dent` · `crack` · `wear` · `missing_part` · `malfunction` · `other`; severity `minor` · `moderate` · `major` · `critical`), `rec.leak_observations`                                                                |
| **Owning Backend contract** | **PARTIAL** — `rec.reception-condition-evidence` with `kind: 'inspection'` and `kind: 'condition_item'`. The inspection **has no kind or type column**, so a lift inspection cannot be distinguished from a walk-around; and **no operation completes it**. **WF-06**, **WF-11** |
| **Owning Frontend phase**   | P1-28                                                                                                                                                                                                                                                                            |

### Step 10 — Reception officer final review

| attribute                   | value                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Reception officer, with the authorising party present                                                                                                                                             |
| **Trigger**                 | Condition capture, concerns and inspection complete                                                                                                                                               |
| **Input**                   | The authorising party's identity and role; their decision; the scope they authorised; optionally a supporting document                                                                            |
| **State**                   | An authorisation row appended. The visit remains `inspecting`                                                                                                                                     |
| **Action**                  | Present the recorded condition and concerns; obtain an explicit approve-or-decline decision; capture the signature or the refusal                                                                 |
| **Output**                  | An approved authorisation — the precondition for step 11                                                                                                                                          |
| **Permission**              | Authorisation `rec.reception.authorization.verify` · signature and refusal `rec.reception.signature.manage`                                                                                       |
| **Audit**                   | Authorisation: **`approval`** / `rec.reception.authorization_recorded`. Signature and refusal: `privileged`                                                                                       |
| **Exception**               | The party present does not hold an authorising role on this visit — refused by the database, which is the authority on that verdict. A **decline is recorded too**, because a decline is evidence |
| **Evidence**                | `rec.authorizations` (insert-and-select only; a decision is superseded by a later row and never edited), `rec.signatures`, `rec.refusals` against `rec.refusal_reasons`                           |
| **Owning Backend contract** | **PARTIAL** — `rec.reception-authorization` POST `/receptions/{receptionId}/authorizations` · `rec.reception-signature` · `rec.reception-refusal`. **No read.** **WF-06**                         |
| **Owning Frontend phase**   | P1-28                                                                                                                                                                                             |

The authorising roles are deliberately the narrower set: driving a vehicle or
paying for it is not authority to approve work on it.

### Step 11 — Vehicle formally accepted

| attribute                   | value                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Actor**                   | Reception officer                                                                                                                                                                    |
| **Trigger**                 | An approved authorisation exists and a service requester is active                                                                                                                   |
| **Input**                   | The visit id and the record version the officer saw. **No body** — a caller who tries to smuggle a status alongside it is refused                                                    |
| **State**                   | `rec.reception_visits.reception_status` → **`authorized`**. Reachable only from `inspecting`, so a visit still `opened` walks both legal edges inside one transaction                |
| **Action**                  | Declare the vehicle accepted for work                                                                                                                                                |
| **Output**                  | The only state a work order may be created from                                                                                                                                      |
| **Permission**              | `rec.reception.approve` · **branch** scope                                                                                                                                           |
| **Audit**                   | Class **`approval`** — not `privileged` — action `rec.reception.approved`. This is the decision that lets work begin on a customer's vehicle                                         |
| **Exception**               | Missing service requester or missing approved authorisation — refused by the database guard, not re-checked in the application. A stale record version — `If-Match` is **mandatory** |
| **Evidence**                | `rec.reception_status_history`, the approval audit record                                                                                                                            |
| **Owning Backend contract** | **PARTIAL** — `rec.reception-approve` POST `/receptions/{receptionId}/approve`. **No read.** **WF-06**                                                                               |
| **Owning Frontend phase**   | P1-28                                                                                                                                                                                |

### Step 12 — Work order created

| attribute                   | value                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Actor**                   | Reception officer or service adviser                                                                                                                                                                                                             |
| **Trigger**                 | The visit is `authorized`                                                                                                                                                                                                                        |
| **Input**                   | The visit id and its record version. Nothing else — the work order inherits its scope, its vehicle and its origin from the visit                                                                                                                 |
| **State**                   | `rec.reception_visits.reception_status` → **`converted`** (terminal). A new `wo.work_orders` row at the tenant-configured initial state, `kind = 'ordinary'`                                                                                     |
| **Action**                  | Convert the authorised visit into exactly one minimal work order. **No job, service line, part or assignment is created**                                                                                                                        |
| **Output**                  | A work order id                                                                                                                                                                                                                                  |
| **Permission**              | **`rec.reception.convert`** — not a `wo.*` code                                                                                                                                                                                                  |
| **Audit**                   | Class `privileged`, action `rec.reception.converted_to_work_order`                                                                                                                                                                               |
| **Exception**               | A replay. Exactly-once is guarded twice: the application locks the visit and returns the work order a previous attempt created rather than making a second, and a partial unique **index** enforces one ordinary work order per reception origin |
| **Evidence**                | `wo.work_orders`, `wo.work_order_status_history`, the conversion audit record                                                                                                                                                                    |
| **Owning Backend contract** | **PRESENT** — `rec.reception-convert-to-work-order` POST `/receptions/{receptionId}/convert-to-work-order`; read back via `wo.work-order-list` GET `/work-orders` and `wo.work-order-detail` GET `/work-orders/{workOrderId}`                    |
| **Owning Frontend phase**   | P1-28 for the conversion action; P1-29 for the work-order screens                                                                                                                                                                                |

**There is no `POST /work-orders`.** A work order can be created only by
converting a reception. The permission `wo.work_order.create` is seeded, is
described as "Convert a reception visit into a work order", and is **required by no
route** — the conversion is gated on `rec.reception.convert` instead. Recorded as
**WF-12**.

### Step 13 — One or more departments assigned

| attribute                   | value                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Actor**                   | Workshop controller or service adviser                                                                                                                                                                                                                                                                                   |
| **Trigger**                 | Work order created                                                                                                                                                                                                                                                                                                       |
| **Input**                   | The work order; the branch's department structure                                                                                                                                                                                                                                                                        |
| **State**                   | **No state exists.** No operational record carries a department                                                                                                                                                                                                                                                          |
| **Action**                  | Route the work to mechanical, electrical, body, valeting, or several                                                                                                                                                                                                                                                     |
| **Output**                  | A department work queue                                                                                                                                                                                                                                                                                                  |
| **Permission**              | `org.department.manage` exists in the catalogue and is **required by no route**                                                                                                                                                                                                                                          |
| **Audit**                   | Not established                                                                                                                                                                                                                                                                                                          |
| **Exception**               | Work spanning several departments; a department at capacity. Neither is expressible                                                                                                                                                                                                                                      |
| **Evidence**                | None. `org.departments` exists as a branch child with a code, a name and an `active`/`inactive` status                                                                                                                                                                                                                   |
| **Owning Backend contract** | **ABSENT.** `org.departments` is referenced by exactly one thing in the whole schema — `iam.grant_scopes.department_id`, which scopes **authorisation**, not work. No work order, job, service line or technician profile carries a `department_id`, and there is no operation to create or read a department. **WF-09** |
| **Owning Frontend phase**   | P1-29, once the Backend contract exists                                                                                                                                                                                                                                                                                  |

**This is the largest single gap between the Owner's journey and the platform.**
Departments exist as an organisational structure and as an authorisation scope.
They do not exist as a work-routing concept. A department queue screen cannot be
built on today's contracts at all — not partially, not with a workaround.

### Step 14 — One or more employees or technicians assigned

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Workshop controller                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Trigger**                 | Work order created; work broken into jobs                                                                                                                                                                                                                                                                                                                                                                                             |
| **Input**                   | The work order; a job; a technician profile; a role of `primary` or `assist`; a validity window                                                                                                                                                                                                                                                                                                                                       |
| **State**                   | A `wo.job_assignments` row opens with `valid_from` and an open `valid_to`. Jobs move through the tenant-configured job state graph                                                                                                                                                                                                                                                                                                    |
| **Action**                  | Create jobs on the work order, then assign technicians to each                                                                                                                                                                                                                                                                                                                                                                        |
| **Output**                  | An assignment each technician can see in their queue                                                                                                                                                                                                                                                                                                                                                                                  |
| **Permission**              | Create a job `wo.job.manage` · assign, reassign and end **`tech.assignment.manage`** · read assignments and queues `tech.technician.read`                                                                                                                                                                                                                                                                                             |
| **Audit**                   | Job creation `privileged` / `wo.job.created`. Assignment and reassignment `privileged` / `wo.job.assigned`. Ending an assignment `privileged` / `wo.job.assignment_ended`                                                                                                                                                                                                                                                             |
| **Exception**               | The wrong technician. Ending an assignment **requires a reason** — the constraint refuses an end date without one, because reassignment is accountable                                                                                                                                                                                                                                                                                |
| **Evidence**                | `wo.jobs`, `wo.job_assignments` with reasons, `wo.job_status_history`                                                                                                                                                                                                                                                                                                                                                                 |
| **Owning Backend contract** | **PARTIAL** — `wo.job-create` POST `/work-orders/{workOrderId}/jobs` · `wo.job-assignment-create` POST `/jobs/{jobId}/assignments` · `wo.job-reassignment` · `wo.job-assignment-end` POST `/assignments/{assignmentId}/end` · `wo.job-assignment-list` GET · `tech.technician-available` GET `/technicians/available` · `tech.technician-queue` GET `/technicians/{technicianProfileId}/queue`. **No `GET /jobs/{jobId}`.** **WF-13** |
| **Owning Frontend phase**   | P1-29                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**No operation creates or maintains a technician.** Of the nine `tech` tables —
profiles, skills, certifications, certification details, availability, labour
sessions, and the three catalogues — only `labor_sessions` is written over HTTP.
A technician profile, a skill, a certification and an availability window can be
read (indirectly, through the availability and queue operations) but can be
created by nothing. The assignment screen therefore has no way to populate the
list it assigns from. Recorded as **WF-14**.

### Step 15 — Assigned staff notified

| attribute                   | value                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | The system, on behalf of the workshop controller                                                                                                                                                                                                                                                                       |
| **Trigger**                 | An assignment is created                                                                                                                                                                                                                                                                                               |
| **Input**                   | A channel and a recipient reference. Only **`email` and `in_app`** can actually be delivered — see below                                                                                                                                                                                                               |
| **State**                   | An outbound message is queued; delivery attempts accumulate against it (`started` · `accepted` · `delivered` · `errored`)                                                                                                                                                                                              |
| **Action**                  | Tell the technician they have been assigned                                                                                                                                                                                                                                                                            |
| **Output**                  | A notification in the technician's own inbox, or an outbound message                                                                                                                                                                                                                                                   |
| **Permission**              | Send `shared.notification.send` · read own inbox `shared.notification.read` · inspect delivery attempts `shared.notification.delivery.read`                                                                                                                                                                            |
| **Audit**                   | Enqueue `privileged` / `shared.notification.enqueued`. Inspecting delivery attempts is **`security`** / `shared.notification.delivery_inspected`. Reading your own inbox is **not audited**                                                                                                                            |
| **Exception**               | Delivery fails. Attempts are recorded per channel; the message is not silently dropped                                                                                                                                                                                                                                 |
| **Evidence**                | `shared.outbound_messages`, `shared.delivery_attempts`, `shared.message_templates` and their versions                                                                                                                                                                                                                  |
| **Owning Backend contract** | **PARTIAL** — `shared.notification-enqueue` POST `/notifications` · `shared.notification-list` GET `/notifications` · `shared.notification-read` · `shared.notification-delivery-list`. **Assignment does not enqueue anything**, and there is no fan-out from a job to its assigned technicians. **WF-15**, **WF-28** |
| **Owning Frontend phase**   | P1-29 for the trigger; the notification shell itself came from P1-26                                                                                                                                                                                                                                                   |

**There is no text message and no WhatsApp.** The request will accept the words
`sms` and `whatsapp`, because the frozen interface type lists four channels, but
the database permits only `email` and `in_app` and the enqueue rules refuse the
other two outright. Only an e-mail and an in-application notice can be sent
today. A screen that offers a text message to a technician would fail every time
it was used, and telling a workshop that the platform can send text messages
would be untrue.

Two further constraints a screen must respect. The recipient is always a
**reference to a person already on the system**, never a typed address or
telephone number — an address cannot pass validation at all, which is what stops
messages being sent to arbitrary destinations. And `GET /notifications` returns
**the signed-in person's own inbox only**; the recipient is never an input, so a
supervisor cannot read a technician's notifications.

Message-template administration reuses **`org.settings.manage`** deliberately —
there is no `shared.template.*` code and one must never be invented. Templates
can be created, revised, approved, activated, previewed and retired, but **none of
the eight template operations is a read**. Recorded as **WF-16**.

### Step 16 — Work logged progressively

| attribute                   | value                                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Assigned technician                                                                                                                                                                                                                                                   |
| **Trigger**                 | Work begins on a job                                                                                                                                                                                                                                                  |
| **Input**                   | The job id                                                                                                                                                                                                                                                            |
| **State**                   | A `tech.labor_sessions` row opens with `started_at` and an open `ended_at`; the job moves through its state graph                                                                                                                                                     |
| **Action**                  | Start work, stop work, and record what was done; move the job forward                                                                                                                                                                                                 |
| **Output**                  | Elapsed labour against the job — the basis of both the closure gate and the labour charge                                                                                                                                                                             |
| **Permission**              | Start and stop `tech.labor.record` · correct **`tech.labor.correct`** (high risk) · move the job `wo.job.transition` · read sessions `tech.technician.read`                                                                                                           |
| **Audit**                   | Start `privileged` / `tech.labor.session_started`. Stop `privileged` / `tech.labor.session_stopped`. Correction `privileged` / `tech.labor.session_corrected`. Job transition `privileged` / `wo.job.state_changed`                                                   |
| **Exception**               | A second session for one technician while another is open — refused by an exclusion constraint, because an open-ended range always overlaps. A mistimed session is **corrected by a linked correction row**, never edited                                             |
| **Evidence**                | `tech.labor_sessions` with `source` of `manual`, `timer` or `correction`; `wo.job_status_history`                                                                                                                                                                     |
| **Owning Backend contract** | **PARTIAL** — `tech.labor-session-start` POST `/jobs/{jobId}/labor-sessions` · `tech.labor-session-stop` POST `/labor-sessions/{sessionId}/stop` · `tech.labor-session-correct` · `tech.labor-session-list` GET · `wo.job-transition` POST `/jobs/{jobId}/transition` |
| **Owning Frontend phase**   | P1-29                                                                                                                                                                                                                                                                 |

**Pausing the clock and pausing the job are two different things, and only one of
them exists.** The permission `tech.labor.record` is described as "Start,
**pause, resume** and stop labor sessions", but only start and stop operations
are published: there is no way to suspend a labour session and resume it, so a
break has to be recorded as a stop and a fresh start. A screen must not offer a
pause control on the timer. The **job** is different — `paused` is a seeded job
state reached through `wo.job-transition`, and a job may legitimately be paused
while its labour session is stopped. There is also no `GET
/labor-sessions/{sessionId}`. Recorded as **WF-17**.

### Step 17 — Parts issued from inventory

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Storekeeper, at the technician's request                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Trigger**                 | A job needs a part                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Input**                   | An item; a quantity; the work order                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **State**                   | `inv.stock_reservations.status` `active → consumed` or `released`. A stock movement is posted and the balance changes                                                                                                                                                                                                                                                                                                                                                                                |
| **Action**                  | Check availability, reserve, issue to the work order; return or write off what is not used                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Output**                  | Parts on the vehicle and a consumption record against the work order                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Permission**              | Read the catalogue `inv.item.read` · read balances and movements `inv.stock.read` · reserve, issue, return, write off `inv.stock.operate` · customer-supplied parts `inv.custody.manage` · approve an opening batch `inv.adjustment.approve` · reconciliation evidence `inv.audit.read`                                                                                                                                                                                                              |
| **Audit**                   | Reservation `privileged` / `inv.stock.reserved`. Issue `privileged` / `inv.part.issued`. Return `privileged` / `inv.part.returned`. Damage `privileged` / `inv.stock.damaged`. **Reading the movement list is itself audited** — `privileged` / `inv.movement_history.read`                                                                                                                                                                                                                          |
| **Exception**               | The last unit is claimed twice. A single-winner race is resolved by locking the balance row; the loser is refused, not silently oversold                                                                                                                                                                                                                                                                                                                                                             |
| **Evidence**                | `inv.stock_movements`, `inv.stock_reservations`, `inv.part_issues`, `inv.part_returns`, `inv.damaged_stock`, `inv.customer_supplied_parts`                                                                                                                                                                                                                                                                                                                                                           |
| **Owning Backend contract** | **PARTIAL** — `inv.item-search` GET `/items` · `inv.stock-availability-read` GET `/stock-availability` · `inv.stock-movement-list` GET `/stock-movements` · `inv.stock-reservation-create` POST `/stock-reservations` · `inv.stock-reservation-release` · `inv.stock-issue-create` POST `/stock-issues` · `inv.stock-return-create` · `inv.damaged-stock-create` · `inv.customer-supplied-part-create`. **No `GET /items/{itemId}` and no list read for reservations, issues or returns.** **WF-18** |
| **Owning Frontend phase**   | P1-30                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Nothing creates an item.** `inv.item.manage` — "Manage item master, categories,
UoM" — is required by no route, so the item catalogue a workshop issues from can
be searched but never populated over the API. Recorded as **WF-18**.

**A part's cost is a separate, separately guarded fact.** No operation asks for
`inv.cost.view`, so no operation returns an item's cost — the item read carries
none. But the code is not idle: `inv.item_cost_details` is guarded by it at the
database, and so is the external-purchase cost at step 18. Cost is therefore
hidden by default and cannot be shown until a read is built for it under that
code. Recorded as **WF-18** and **WF-27**.

A customer-supplied part is **custody-tracked and never valued stock**: it
generates no stock movement and no balance change.

### Step 18 — External parts requested or purchased

| attribute                   | value                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Parts buyer or service adviser                                                                                                                                                                      |
| **Trigger**                 | A required part is not in stock                                                                                                                                                                     |
| **Input**                   | A description; a quantity; a supplier — either a known business partner **or** a supplier name                                                                                                      |
| **State**                   | `inv.external_purchase_parts.status`: `recorded → linked` or `cancelled`                                                                                                                            |
| **Action**                  | Record an ad-hoc external purchase reference against the work order                                                                                                                                 |
| **Output**                  | A traceable reference for a part that never entered stock                                                                                                                                           |
| **Permission**              | `inv.external_purchase.record` — **plus `inv.cost.view`** if a unit cost is recorded, because the cost is written to a separately guarded row. The operation declares only the first. See **WF-27** |
| **Audit**                   | Class **`financial`**, action `inv.external_purchase.recorded`                                                                                                                                      |
| **Exception**               | No supplier named at all — refused; the constraint requires either a partner or a name                                                                                                              |
| **Evidence**                | `inv.external_purchase_parts`, `inv.external_purchase_part_details`                                                                                                                                 |
| **Owning Backend contract** | **PARTIAL** — `inv.external-purchase-part-create` POST `/external-purchase-parts`. **No read of any kind.** **WF-18**, **WF-27**                                                                    |
| **Owning Frontend phase**   | P1-30                                                                                                                                                                                               |

**This is not procurement, and must never be presented as procurement.** The
migration states it plainly: an ad-hoc work-order-linked external purchase
reference **only**, with `is_procurement = false` enforced by a constraint. There
is no purchase order, no purchase requisition, no goods receipt and no bidding
workflow — all deliberately excluded and deferred to a future procurement phase.
A screen that calls this "raise a purchase order" would be describing a capability
the platform does not have.

### Step 19 — Labour and parts pricing prepared

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Actor**                   | Service adviser                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Trigger**                 | The scope of work is known                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Input**                   | The work order; service lines; required parts; a published price-list version                                                                                                                                                                                                                                                                                                                                                                                |
| **State**                   | `quo.quotations.status` opens at `draft`, then `active` on issue                                                                                                                                                                                                                                                                                                                                                                                             |
| **Action**                  | Record service lines and required-part demand; resolve prices; build a quotation                                                                                                                                                                                                                                                                                                                                                                             |
| **Output**                  | A priced quotation to put in front of the customer                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Permission**              | Record lines `wo.work_order.line.manage` · read prices `svc.price.read` · create a quotation **`quo.quotation.manage` + `wo.work_order.read`** (both) · read a quotation `quo.quotation.read`                                                                                                                                                                                                                                                                |
| **Audit**                   | Service and part lines `privileged`. Quotation creation, issue and revision all class **`financial`**                                                                                                                                                                                                                                                                                                                                                        |
| **Exception**               | No published price-list version covers the branch or the date — the resolution fails rather than guessing. A quotation must be revised, not edited: issue and revision are version-guarded                                                                                                                                                                                                                                                                   |
| **Evidence**                | `wo.work_order_service_lines`, `wo.required_parts`, `quo.quotations`, `quo.quotation_items`, `quo.quotation_revisions`, `quo.quotation_status_history`                                                                                                                                                                                                                                                                                                       |
| **Owning Backend contract** | **PARTIAL** — `wo.service-line-record` POST · `wo.required-part-record` POST · `svc.price-resolve` GET `/prices` · `quo.quotation-create` POST `/quotations` · `quo.quotation-detail` GET `/quotations/{quotationId}` · `quo.quotation-issue` · `quo.quotation-revision-create`. **There is no `GET /quotations` list** — a quotation can be opened only if its id is already known, so a customer's or a work order's quotations cannot be found. **WF-20** |
| **Owning Frontend phase**   | P1-30                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Money is a decimal string plus an ISO 4217 currency code, always.** The money
type is a pair, every operation on a pair checks the currency first and fails
deterministically on a mismatch, and there is no conversion path — foreign
exchange is out of scope and conversion is made unexpressible rather than merely
discouraged. A currency **reference list does exist** — `shared.currencies`,
created by `supabase/migrations/20260717100000_org_reference_tables.sql` and
seeded by `supabase/seeds/01_reference_data.sql` — but it carries **no default
and no jurisdiction policy**: a tenant's currency comes from its own price list
(`svc.price_lists.currency_code`), which is immutable once set. Nothing may
present a floating-point amount, and nothing may infer a currency from a country.

_A correction recorded in place._ The money domain file's own header says the
platform "ships no currency table". That header is stale: the table exists and is
seeded. The point the header is making — that a currency is never assumed from a
default — is the one that binds, and it is stated correctly above. The same
correction is carried in `docs/product/workshop/department-task-assignment.md`
§4.1, `docs/product/workshop/pricing-payment-and-delivery.md` §4 and
`docs/product/workshop/vehicle-history-model.md` §7.

### Step 20 — Customer approval where required

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Customer, recorded by the service adviser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Trigger**                 | A quotation is issued, **or** work not covered by the original authorisation is found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Input**                   | The presented scope; the customer's decision; the channel it came through                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **State**                   | Quotation items and revisions carry decisions. An additional-work request moves `pending → approved` or `rejected` or `withdrawn`, with `fulfillment_state` tracked **separately**                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Action**                  | Present, obtain the decision, record it with its evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Output**                  | Authority to proceed with a defined scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Permission**              | Quotation decisions `quo.decision.record` · raise additional work `wo.additional_work.request` · record the customer's decision on it `wo.additional_work.approve` · read or write the **money detail** additionally requires **`iam.sensitive.view`**                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Audit**                   | Quotation decisions class **`approval`**. Additional-work approval class **`approval`** / `wo.customer_approval.recorded`. **Reading the additional-work money detail is itself audited** — class `security` / `wo.additional_work.detail_read`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Exception**               | A decision arrives for a superseded revision — refused by the version guard. A required request left pending blocks work-order closure at blocker **B3**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Evidence**                | `quo.approval_decisions`, `quo.approval_evidence`, `wo.customer_approvals` (channel: `in_person` · `phone` · `email` · `sms` · `portal` · `other`), `wo.customer_approval_evidence`, `wo.additional_work_requests`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Owning Backend contract** | **PRESENT** — `quo.quotation-item-decide` POST `/quotation-items/{quotationItemId}/decisions` · `quo.quotation-revision-decide` · `wo.additional-work-request` POST `/work-orders/{workOrderId}/additional-work` · `wo.additional-work-approval` POST `/additional-work/{requestId}/approval` · `wo.additional-work-detail-read` GET · `wo.additional-work-detail-record` PUT `/additional-work/{requestId}/detail` · `wo.additional-work-fulfillment` POST · `wo.additional-work-withdraw` POST `/additional-work/{requestId}/withdrawal` · `wo.additional-work-list` GET `/work-orders/{workOrderId}/additional-work` · `wo.additional-work-approval-read` GET |
| **Owning Frontend phase**   | P1-29 for additional work; P1-30 for quotation decisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Approval and execution are **two fields on one row**, deliberately: a customer can
approve extra work that is then never carried out, and the record must be able to
say so.

### Step 21 — Repair or service work completed

| attribute                   | value                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Actor**                   | Assigned technicians                                                                                                                                                                             |
| **Trigger**                 | Authorised scope, parts available, technician assigned                                                                                                                                           |
| **Input**                   | Jobs, their service lines and their parts                                                                                                                                                        |
| **State**                   | Each job moves through the tenant's own job state graph; the work order moves through its own                                                                                                    |
| **Action**                  | Carry out the work; move each job to a terminal state                                                                                                                                            |
| **Output**                  | A work order whose jobs are all terminal                                                                                                                                                         |
| **Permission**              | Job transition `wo.job.transition` · work-order transition `wo.work_order.transition`                                                                                                            |
| **Audit**                   | Both `privileged` — `wo.job.state_changed` and `wo.work_order.state_changed`                                                                                                                     |
| **Exception**               | An invalid transition. A move is legal only where an **active edge** exists in the tenant's configured graph; terminal states are frozen                                                         |
| **Evidence**                | `wo.job_status_history`, `wo.work_order_status_history`                                                                                                                                          |
| **Owning Backend contract** | **PRESENT** — `wo.job-transition` POST `/jobs/{jobId}/transition` · `wo.work-order-transition` POST `/work-orders/{workOrderId}/transition` · `wo.job-history` GET · `wo.work-order-history` GET |
| **Owning Frontend phase**   | P1-29                                                                                                                                                                                            |

**A platform default state graph does ship, and it is not the same thing as the
pilot workshop's graph.** `supabase/seeds/06_wo_job_state_graph.sql` seeds nine
work-order states with fifteen transitions, and six job states with ten
transitions, all at platform scope and carrying no tenant identifier. That seed is
structural rather than business data: the transition guards refuse any move for
which no active edge exists, so without it no work order could move at all. It is
what the standing no-fake-data policy allows as a technically mandatory generic
definition, and it is not a demonstration workflow.

What is **not established** is which of those states the pilot workshop will
actually use, what each will be called in English and Arabic on a screen, and
which extra non-terminal routing states it will add for its own departments. A
screen must read the graph from the platform rather than hard-code a name,
because a tenant's graph can legitimately differ from the default. Recorded as
**WF-21**.

### Step 22 — Technician completion recorded

| attribute                   | value                                                                                                                                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Assigned technician                                                                                                                                                                                                                                                  |
| **Trigger**                 | The technician judges their part of the work finished                                                                                                                                                                                                                |
| **Input**                   | The open labour session; the open assignment; the job                                                                                                                                                                                                                |
| **State**                   | The labour session gains an `ended_at`; the assignment gains a `valid_to` and a reason; the job moves to a terminal state                                                                                                                                            |
| **Action**                  | Stop the clock, close the assignment, declare the job done                                                                                                                                                                                                           |
| **Output**                  | A job that no longer blocks closure                                                                                                                                                                                                                                  |
| **Permission**              | Stop the session `tech.labor.record` · end the assignment `tech.assignment.manage` · move the job `wo.job.transition`                                                                                                                                                |
| **Audit**                   | `privileged` — `tech.labor.session_stopped`, `wo.job.assignment_ended`, `wo.job.state_changed`                                                                                                                                                                       |
| **Exception**               | Work declared complete with a labour session still open. Blocker **B2** refuses work-order closure while any open-ended session exists                                                                                                                               |
| **Evidence**                | `tech.labor_sessions`, `wo.job_assignments` with the ending reason, `wo.job_status_history`                                                                                                                                                                          |
| **Owning Backend contract** | **PARTIAL** — the three operations above exist. **There is no distinct technician sign-off record**: completion is inferred from the job state, the closed session and the ended assignment. No operation captures "I, the technician, certify this work". **WF-22** |
| **Owning Frontend phase**   | P1-29                                                                                                                                                                                                                                                                |

### Step 23 — Final quality assurance and quality control

| attribute                   | value                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Actor**                   | Quality checker — a different person from the technician                                                                                                                                                                                                                                                                       |
| **Trigger**                 | All jobs terminal                                                                                                                                                                                                                                                                                                              |
| **Input**                   | The work order; the branch's configured quality-control checks                                                                                                                                                                                                                                                                 |
| **State**                   | `qms.quality_control_records.overall_result`: `pending → passed` or `failed`                                                                                                                                                                                                                                                   |
| **Action**                  | Open a quality-control record, record each check result, finalise                                                                                                                                                                                                                                                              |
| **Output**                  | A pass that permits closure and delivery, or a fail that opens step 24                                                                                                                                                                                                                                                         |
| **Permission**              | Open and record `qms.quality_control.record` · finalise **`qms.quality_control.finalize`** (high risk) · read `qms.quality_control.read`                                                                                                                                                                                       |
| **Audit**                   | Open `privileged` / `qms.quality_control.opened`. Check result `privileged` / `qms.quality_control.check_recorded`. Finalisation class **`approval`** / `qms.quality_control.finalized`                                                                                                                                        |
| **Exception**               | Finalising without a checker or a timestamp — refused: a finalised record must carry **both**, and a pending record must carry **neither**. Closure attempted with a failed record and no passing one — blocker **B5a**. Closure attempted where a mandatory check is configured but no passed record exists — blocker **B5b** |
| **Evidence**                | `qms.quality_control_records`, `qms.qc_check_results` against `qms.qc_checks`, `qms.qc_status_history`                                                                                                                                                                                                                         |
| **Owning Backend contract** | **PRESENT** — `qms.qc-record-open` POST `/work-orders/{workOrderId}/quality-controls` · `qms.qc-record-list` GET · `qms.qc-record-detail` GET `/quality-controls/{recordId}` · `qms.qc-check-result` PUT `/quality-controls/{recordId}/checks/{qcCheckId}` · `qms.qc-record-finalize` POST                                     |
| **Owning Frontend phase**   | P1-29                                                                                                                                                                                                                                                                                                                          |

### Step 24 — Rework where quality assurance fails

| attribute                   | value                                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Workshop controller; a lead technician; an independent approver                                                                                                                                                                                                            |
| **Trigger**                 | A failed quality-control record                                                                                                                                                                                                                                            |
| **Input**                   | The original work order; a root cause; a corrective action; where safety-critical, a named lead technician                                                                                                                                                                 |
| **State**                   | A second work order at `kind = 'rework'`, reusing the original reception visit; a `qms.rework_links` row joining the two                                                                                                                                                   |
| **Action**                  | Raise the rework, carry it out, record its cost, obtain an independent sign-off                                                                                                                                                                                            |
| **Output**                  | Corrected work and an accountable record of why it was needed                                                                                                                                                                                                              |
| **Permission**              | Create and resolve `qms.rework.manage` · sign off **`qms.rework.sign_off`** · read the rework record `qms.quality_control.read` · read the **cost** `qms.quality_control.read` **+ `iam.sensitive.view`** · record the cost `qms.rework.manage` **+ `iam.sensitive.view`** |
| **Audit**                   | Creation `privileged` / `qms.rework.created`. Sign-off class **`approval`** / `qms.rework.signed_off`. **Reading the rework cost is itself audited** — class `security` / `qms.rework.cost_read`                                                                           |
| **Exception**               | The technician who did the work signs their own rework off — refused: the independent approver must be a different person from the lead. Safety-critical rework without a named lead — refused. Unsigned safety rework — blocker **B6**                                    |
| **Evidence**                | `qms.rework_links` with root cause, corrective action and responsibility; `qms.rework_link_details`; `qms.reopen_attempts`                                                                                                                                                 |
| **Owning Backend contract** | **PRESENT** — `qms.rework-create` POST `/work-orders/{workOrderId}/rework` · `qms.rework-list` GET · `qms.rework-detail` GET `/rework-links/{reworkLinkId}` · `qms.rework-cost-read` GET · `qms.rework-cost-record` PUT · `qms.rework-sign-off` POST                       |
| **Owning Frontend phase**   | P1-29                                                                                                                                                                                                                                                                      |

**A closed work order can never be reopened.** `qms.reopen-attempt` exists, but its
outcome column is constrained to the single value `rejected` — the operation
records that somebody tried, and refuses. Its audit class is **`security`** and its
action is `qms.work_order.reopen_refused`, and it is gated on
`wo.work_order.transition`. A screen must never offer a button labelled "Reopen",
because nothing reopens. What the button actually does is put on record that
somebody asked, so it should say so in plain words — for example "Ask for this
job to be reopened" — and the screen must warn, before the request is sent, that
closed work cannot be reopened and that the request itself will be kept on
record. The way to correct closed work is a rework, at step 24.

### Step 25 — Amount routed to accounting

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Service adviser or cashier                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Trigger**                 | Work complete and quality control passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Input**                   | The work order; its service lines, parts and approved additional work                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **State**                   | `sal.invoices.status`: `draft → issued`, or `void_before_issue`, or `credited`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Action**                  | Preview the invoice from the work order, create the draft, issue it — which allocates the invoice number                                                                                                                                                                                                                                                                                                                                                                                                |
| **Output**                  | An issued invoice with a receivable                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Permission**              | Preview and create **`sal.invoice.manage` + `sal.finance.view`** · issue **`sal.invoice.issue` + `sal.finance.view`** · credit note **`sal.credit.manage` + `sal.finance.view`**                                                                                                                                                                                                                                                                                                                        |
| **Audit**                   | Creation, issue, cancellation and credit notes all class **`financial`** — `sal.invoice.created`, `sal.invoice.issued`, `sal.invoice.voided`, `sal.credit_note.requested`. Credit-note approval class **`approval`**                                                                                                                                                                                                                                                                                    |
| **Exception**               | An attempt to issue twice, or to void after issue. A number and an issue timestamp exist **if and only if** the invoice is issued — the constraint makes the other combinations unrepresentable. One live invoice per work order                                                                                                                                                                                                                                                                        |
| **Evidence**                | `sal.invoices`, `sal.invoice_lines`, `sal.invoice_amounts`, `sal.invoice_status_history`, `sal.financial_events`, `sal.credit_notes`                                                                                                                                                                                                                                                                                                                                                                    |
| **Owning Backend contract** | **PARTIAL** — `sal.invoice-preview` GET `/work-orders/{workOrderId}/invoice-preview` · `sal.invoice-create` POST `/invoices` · `sal.invoice-detail` GET `/invoices/{invoiceId}` · `sal.invoice-issue` POST · `sal.invoice-cancel` POST · `sal.invoice-outstanding-read` GET · `sal.credit-note-create` POST · `sal.credit-note-approve` POST. **No invoice list**, and `GET /invoices/{invoiceId}` is gated on **`sal.invoice.manage`** — a write code — because no invoice read code exists. **WF-23** |
| **Owning Frontend phase**   | P1-30 / P1-31                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**There is no general ledger.** The platform records invoices, receipts,
allocations, credit notes and financial events. It does not post journals and does
not maintain accounts. "Routed to accounting" means an issued invoice and a
receivable exist for an accounting system to consume, not that the platform keeps
the books.

### Step 26 — Payment recorded

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Cashier                                                                                                                                                                                                                                                                                                                                                                                       |
| **Trigger**                 | The customer pays                                                                                                                                                                                                                                                                                                                                                                             |
| **Input**                   | An amount as a decimal string; a currency; a payment method; a payer                                                                                                                                                                                                                                                                                                                          |
| **State**                   | `sal.receipts.status`: `recorded → partially_allocated → allocated`, or `reversed`                                                                                                                                                                                                                                                                                                            |
| **Action**                  | Record the receipt, then allocate it against one or more invoices                                                                                                                                                                                                                                                                                                                             |
| **Output**                  | A reduced or cleared outstanding balance                                                                                                                                                                                                                                                                                                                                                      |
| **Permission**              | Record **`sal.payment.record` + `sal.finance.view`** · allocate **`sal.payment.allocate` + `sal.finance.view`** · read a receipt `sal.finance.view`                                                                                                                                                                                                                                           |
| **Audit**                   | Record class **`financial`** / `sal.receipt.recorded`. Allocation class **`financial`** / `sal.payment.allocated`                                                                                                                                                                                                                                                                             |
| **Exception**               | An attempt to change a recorded amount or method — frozen on record. Over-allocation — refused                                                                                                                                                                                                                                                                                                |
| **Evidence**                | `sal.receipts`, `sal.payment_allocations`, `sal.financial_events`. The **whole receipt row** is gated by `sal.finance.view` at the database level                                                                                                                                                                                                                                             |
| **Owning Backend contract** | **PARTIAL** — `sal.payment-record` POST `/payments` · `sal.receipt-detail` GET `/payments/{paymentId}` · `sal.payment-allocate` POST · `sal.payment-method-list` GET `/payment-methods` · `sal.invoice-outstanding-read` GET. **No payment list.** **There is no receipt-reversal operation at all**, although `sal.reversal.approve` is seeded and `sal.receipt_reversals` exists. **WF-24** |
| **Owning Frontend phase**   | P1-30 / P1-31                                                                                                                                                                                                                                                                                                                                                                                 |

`GET /payment-methods` is gated on **`sal.payment.record`** — a write code — and is
the one **tenant**-scoped operation in this group; everything else here is
branch-scoped.

### Step 27 — Delivery readiness verified

| attribute                   | value                                                                                                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actor**                   | Service adviser                                                                                                                                                                                                                                                                        |
| **Trigger**                 | The customer comes to collect the vehicle                                                                                                                                                                                                                                              |
| **Input**                   | The delivery record for the work order                                                                                                                                                                                                                                                 |
| **State**                   | `sal.delivery_records.status` opens at `ready`                                                                                                                                                                                                                                         |
| **Action**                  | Ask the system whether this vehicle may go home, and get back **reasons**, not a boolean                                                                                                                                                                                               |
| **Output**                  | An explicit list of blocker codes, and for each, the fact that established it                                                                                                                                                                                                          |
| **Permission**              | **`sal.delivery.view` + `sal.finance.view`** to read eligibility · `sal.delivery.manage` to create the delivery                                                                                                                                                                        |
| **Audit**                   | Eligibility read: **none**. Delivery creation `privileged` / `sal.delivery.created`                                                                                                                                                                                                    |
| **Exception**               | The eight blockers, as a closed vocabulary: `work_order_not_complete` · `quality_control_not_passed` · `financial_balance_outstanding` · `part_obligation_outstanding` · `checklist_incomplete` · `receiver_not_verified` · `signature_missing` · `delivery_state_invalid`             |
| **Evidence**                | `sal.delivery_records`, `sal.delivery_checklist_results` against the branch's checklist template, `sal.delivery_status_history`                                                                                                                                                        |
| **Owning Backend contract** | **PARTIAL** — `sal.delivery-create` POST `/deliveries` · `sal.delivery-eligibility-read` GET `/deliveries/{deliveryId}/eligibility` · `sal.delivery-checklist-record` POST. **There is no `GET /deliveries/{deliveryId}` and no delivery list** — only the eligibility view. **WF-25** |
| **Owning Frontend phase**   | P1-30 / P1-31                                                                                                                                                                                                                                                                          |

**Only one blocker can be overridden, and only with high-risk authority.**
`financial_balance_outstanding` may be overridden with `sal.delivery.complete`.
The others are not overridable at all: two of them are enforced inside the
database primitive, so an "override" would simply fail there, and advertising an
override that cannot work is worse than not offering one. A screen must not
present a general override.

Eligibility is composed from facts the caller cannot forge. A client can never
assert eligibility, and a client that receives `eligible: false` with no reason
cannot act — which is why the contract returns codes rather than a flag.

### Step 28 — Vehicle delivered

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Actor**                   | Service adviser and the collecting person                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Trigger**                 | Eligibility satisfied, or its one overridable blocker overridden                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Input**                   | The authorised receiver's identity; the checklist results; the signature; a final odometer reading                                                                                                                                                                                                                                                                                                                                                                             |
| **State**                   | `sal.delivery_records.status`: `ready → receiver_verified → signed → delivered`. `veh.vehicles.workshop_status` returns to `none`. The custody chain closes                                                                                                                                                                                                                                                                                                                    |
| **Action**                  | Verify who is collecting, complete the checklist, capture the signature, hand over, issue the warranty                                                                                                                                                                                                                                                                                                                                                                         |
| **Output**                  | A closed custody chain and a warranty record                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Permission**              | Verify receiver **`sal.delivery.manage` + `sal.delivery.view`** · checklist `sal.delivery.manage` · signature **`sal.delivery.manage` + `sal.delivery.view`** · complete **`sal.delivery.complete` + `sal.delivery.view` + `sal.finance.view`** (three) · warranty `wty.warranty.issue`                                                                                                                                                                                        |
| **Audit**                   | Receiver `privileged` / `sal.delivery.receiver_verified`. Signature `privileged` / `sal.delivery.signature_recorded`. Completion `privileged` / `sal.delivery.completed`. Warranty `privileged` / `wty.warranty.issued`                                                                                                                                                                                                                                                        |
| **Exception**               | An unverified receiver or an incomplete mandatory checklist — refused inside the database primitive, not merely in the application. A stale record version — completion is version-guarded. A waived checklist item **requires a waiver reason**                                                                                                                                                                                                                               |
| **Evidence**                | `sal.authorized_receivers`, `sal.delivery_checklist_results`, `sal.delivery_signatures`, `sal.delivery_records` with delivered-at and final odometer, `rec.custody_history` closed, `wty.warranty_records`                                                                                                                                                                                                                                                                     |
| **Owning Backend contract** | **PARTIAL** — `sal.delivery-receiver-verify` POST · `sal.delivery-checklist-record` POST · `sal.delivery-signature-attach` POST · `sal.delivery-complete` POST · `wty.warranty-generate` POST `/deliveries/{deliveryId}/warranties` · `wty.warranty-detail` GET `/warranties/{warrantyId}`. **No warranty list**, and the warranty read is gated on **`wty.warranty.issue`** — a write code. No warranty-policy management exists, so `wty.policy.manage` is unused. **WF-26** |
| **Owning Frontend phase**   | P1-30 / P1-31                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The `delivered` state and the delivered-at time and the final odometer reading
exist **if and only if** each other does — one constraint, so a delivery cannot be
marked complete without the two facts that prove it.

### Step 29 — Complete immutable vehicle and customer history retained

| attribute                   | value                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Actor**                   | Any authorised member of staff; an auditor                                                                                                                                                                                                                                                                                                                                                                                     |
| **Trigger**                 | A question about what happened, at any later date                                                                                                                                                                                                                                                                                                                                                                              |
| **Input**                   | A customer id, or a vehicle id, or a work order id                                                                                                                                                                                                                                                                                                                                                                             |
| **State**                   | None changes — but note that reading the **audit trail** is itself an audited act                                                                                                                                                                                                                                                                                                                                              |
| **Action**                  | Reconstruct what was reported, found, done, charged, paid and handed over                                                                                                                                                                                                                                                                                                                                                      |
| **Output**                  | An evidenced account                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Permission**              | Customer history `crm.customer.read` · vehicle history `veh.vehicle.read` · work-order and job history `wo.work_order.read` · diagnostic history `dia.diagnostic.read` · the audit trail `iam.audit.view`                                                                                                                                                                                                                      |
| **Audit**                   | Domain history reads: **none**. **Reading the audit trail is class `security`** / `iam.audit.viewed` — looking at the log is logged                                                                                                                                                                                                                                                                                            |
| **Exception**               | The history is not in one place, and no operation assembles it. **`P1-OD-017` binds here as well**: until the merge rule is set, two records for the same vehicle or the same customer each hold part of the story and neither is complete                                                                                                                                                                                     |
| **Evidence**                | Append-only tables throughout: status histories, `crm.timeline_events`, `veh.vehicle_attribute_history`, `iam.audit_records` chained by `iam.audit_integrity_links`, and evidence rows bound to **exact immutable document versions**, never to a substitutable document                                                                                                                                                       |
| **Owning Backend contract** | **PARTIAL** — `crm.customer-timeline` GET `/customers/{customerId}/timeline` · `crm.customer-history` GET · `veh.vehicle-history` GET · `wo.work-order-history` GET · `wo.job-history` GET · `dia.diagnostic-history` GET · `iam.audit-event-list` GET `/audit-events` · `iam.audit-event-detail` GET. **No operation returns a vehicle's service history across receptions, work orders, invoices and deliveries.** **WF-19** |
| **Owning Frontend phase**   | Not established for a unified view; each domain's own history belongs to that domain's Frontend phase                                                                                                                                                                                                                                                                                                                          |

Two limits a screen must not paper over. `crm.timeline_events.event_type` accepts
exactly eight values — `lifecycle_changed`, `commercial_changed`,
`consent_changed`, `blocked`, `unblocked`, `alert_raised`, `merged`,
`communication_logged` — **all of them CRM governance events**. No reception, work
order, invoice or delivery appears there. And `veh.vehicle-history` is
**attribute changes only**; it is not a service history. A sectioned view over the
existing independently-paginated reads is what today's contracts support, and a
unified stream must not be fabricated from them.

---

## 6. Integration findings

Each finding is a place where the Owner's journey needs a contract that does not
exist, or exists in a form that cannot carry the step. These are **new findings
raised by this mapping**. They carry a document-local `WF-` prefix and are **not**
entries in the `P1-27-INT-###` register in
`docs/phase-1/phase-1-27/findings.md`; adopting any of them into a phase register
is a decision for the owning phase, not for this document.

| finding   | what is missing                                                                                                                                                                                                                                                                                                                                                                                                                 | owning Backend phase                                                                                                                                                                                                          | owning Frontend phase                                                                                                    | required action                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WF-01** | No record of vehicle arrival independent of the reception visit. Nothing represents a vehicle waiting at the gate                                                                                                                                                                                                                                                                                                               | P1-18                                                                                                                                                                                                                         | P1-28                                                                                                                    | Decide whether arrival is a business record at all. If it is, add a table, an operation and a permission; if not, record the decision so it is not re-asked                                                                                           |
| **WF-02** | No operation confirms an appointment. `confirmed` is set only by `apt.appointment-reschedule`, and `pending_confirmation` is reachable by no route                                                                                                                                                                                                                                                                              | P1-18                                                                                                                                                                                                                         | P1-28                                                                                                                    | Either publish a confirm operation, or record that reschedule **is** confirm and require every screen to label it truthfully                                                                                                                          |
| **WF-03** | No `PATCH`, `PUT` or `DELETE` on `/customers/{customerId}`. A customer's own master fields cannot be corrected after creation                                                                                                                                                                                                                                                                                                   | P1-16                                                                                                                                                                                                                         | P1-27                                                                                                                    | Add a version-guarded customer update operation under `crm.customer.profile.write`, or record that master fields are deliberately immutable                                                                                                           |
| **WF-04** | The vehicle catalogue is read-only over HTTP; no operation creates a make, model, trim, body type or powertrain type, and no catalogue-management permission is seeded                                                                                                                                                                                                                                                          | P1-17                                                                                                                                                                                                                         | P1-27                                                                                                                    | Decide whether the catalogue is platform-managed or tenant-managed. Tenant management requires new operations **and** a new permission code                                                                                                           |
| **WF-05** | No link between a customer-reported concern (`rec.complaints`) and a technically verified finding (`dia.findings`)                                                                                                                                                                                                                                                                                                              | P1-18 / P1-19                                                                                                                                                                                                                 | P1-28 / P1-29                                                                                                            | Add an explicit, auditable association that preserves both records intact. It must never overwrite or promote a complaint                                                                                                                             |
| **WF-06** | **Reception and Appointment have no read surface whatsoever** — 0 GET operations across 12 published operations, and no `rec.*.read` or `apt.*.read` permission code                                                                                                                                                                                                                                                            | P1-18                                                                                                                                                                                                                         | P1-28                                                                                                                    | Add read operations and the read permission codes they need. Nothing can be built on this domain until then                                                                                                                                           |
| **WF-07** | The only document list is vehicle-scoped (`GET /vehicles/{vehicleId}/documents`); a reception visit's own photographs cannot be listed back, and there is no search across documents. Both document reads are gated on the **write** code `shared.document.manage`; upload is authorisation-only and the API accepts no file body                                                                                               | P1-15                                                                                                                                                                                                                         | Not established                                                                                                          | **Blocked on `P1-OD-025`.** Once decided: add a `shared.document.read` code and a reception-scoped document list                                                                                                                                      |
| **WF-08** | A pre-authorisation diagnostic scan has no contract. Diagnostics hang off a job, which requires a work order, which exists only after conversion                                                                                                                                                                                                                                                                                | P1-18 / P1-19                                                                                                                                                                                                                 | P1-28                                                                                                                    | Decide whether reception-time scanning is in scope. If it is, it needs a home in `rec` or a job-free diagnostic contract                                                                                                                              |
| **WF-09** | **No operational record carries a department.** `org.departments` is referenced only by `iam.grant_scopes`; `org.department.manage` is required by no route; there is no department read or write operation                                                                                                                                                                                                                     | **P1-03** (schema — the migration header names Phase 1-3) · **P1-14** (the published `org` HTTP surface, whose route headers name P1-14) · **P1-19** (recording a department against work). Agreed with `DTA-01` and `VHM-14` | P1-29 for a department on a task; an Administration Frontend for the department editor, which no repository record names | Decide whether departments route work. If they do, this is new schema, new operations and new permissions — not a screen change                                                                                                                       |
| **WF-10** | No road-test contract of any kind: no table, no column, no operation, no permission. The only occurrence in the repository is a **test fixture**                                                                                                                                                                                                                                                                                | P1-18 / P1-19                                                                                                                                                                                                                 | P1-28 / P1-29                                                                                                            | Decide where a road test belongs. A tenant-configured diagnostic template item is the nearest fit and is itself unmanageable — see WF-11                                                                                                              |
| **WF-11** | Diagnostic inspection templates (`dia.inspection_templates`, `dia.template_versions`, `dia.template_items`) have **no HTTP surface and no permission code**; and `rec.visual_inspections` has no kind column and no operation completes it                                                                                                                                                                                      | P1-19                                                                                                                                                                                                                         | P1-29                                                                                                                    | Add template management operations and a permission code; add an inspection completion operation; decide whether inspections need a kind                                                                                                              |
| **WF-12** | `wo.work_order.create` is seeded, described as the conversion authority, and required by no route — the conversion is gated on `rec.reception.convert`                                                                                                                                                                                                                                                                          | P1-18 / P1-19                                                                                                                                                                                                                 | P1-28                                                                                                                    | Either retire the unused code or move the conversion gate onto it. Two codes for one act invites the wrong one being granted                                                                                                                          |
| **WF-13** | No `GET /jobs/{jobId}`. A job can be updated and transitioned but not read on its own                                                                                                                                                                                                                                                                                                                                           | P1-19                                                                                                                                                                                                                         | P1-29                                                                                                                    | Add a job detail read under `wo.work_order.read`                                                                                                                                                                                                      |
| **WF-14** | **No operation creates or maintains a technician profile, skill, certification or availability window.** Eight of the nine `tech` tables are written by nothing                                                                                                                                                                                                                                                                 | P1-19                                                                                                                                                                                                                         | P1-29                                                                                                                    | Add technician administration operations and decide their permission codes. Assignment screens cannot be populated until then                                                                                                                         |
| **WF-15** | Assignment does not notify. No fan-out exists from a job to its assigned technicians, and no operation notifies a group                                                                                                                                                                                                                                                                                                         | P1-15 / P1-19                                                                                                                                                                                                                 | P1-29                                                                                                                    | Decide whether notification on assignment is automatic (an event) or manual (a screen action), then build the one that was decided                                                                                                                    |
| **WF-16** | Message templates have **zero read operations** across eight published operations                                                                                                                                                                                                                                                                                                                                               | P1-15                                                                                                                                                                                                                         | Not established                                                                                                          | Add template read operations under the existing `org.settings.manage` authority. Do **not** invent a `shared.template.*` code                                                                                                                         |
| **WF-17** | No pause or resume for a **labour session**, although the permission describes both; no `GET /labor-sessions/{sessionId}`. (The **job** `paused` state does exist and is reachable.)                                                                                                                                                                                                                                            | P1-19                                                                                                                                                                                                                         | P1-29                                                                                                                    | Either publish pause and resume operations or correct the permission description. A screen must not offer a button with no operation behind it                                                                                                        |
| **WF-18** | No `GET /items/{itemId}`; no operation creates an item, category or unit of measure (`inv.item.manage` unused); no list read for reservations, issues, returns, damaged stock, customer-supplied parts, external purchase parts or opening batches; `inv.cost.view` unused so cost is exposed nowhere                                                                                                                           | P1-20 / P1-21                                                                                                                                                                                                                 | P1-30                                                                                                                    | Add item administration and the missing list reads. Decide where item cost may be shown, under `inv.cost.view`                                                                                                                                        |
| **WF-19** | No cross-domain vehicle or customer service history. `crm.timeline_events` carries only eight CRM governance event types; `veh.vehicle-history` is attribute changes only                                                                                                                                                                                                                                                       | Spans P1-16 … P1-23                                                                                                                                                                                                           | Not established                                                                                                          | Decide whether a unified history is a real deliverable. If it is, it needs an owning phase and a read model — it cannot be assembled client-side                                                                                                      |
| **WF-20** | No `GET /quotations` list. A quotation can be opened only if its id is already known                                                                                                                                                                                                                                                                                                                                            | P1-20                                                                                                                                                                                                                         | P1-30                                                                                                                    | Add a keyset-paginated quotation list under `quo.quotation.read`, filterable by work order and customer                                                                                                                                               |
| **WF-21** | A platform default state graph **does** ship (`supabase/seeds/06_wo_job_state_graph.sql`), but the pilot workshop's own graph — which states it uses, their English and Arabic names, any extra routing states — is **not established**                                                                                                                                                                                         | P1-19                                                                                                                                                                                                                         | P1-29                                                                                                                    | Confirm the pilot workshop's state graph against the platform default before any P1-29 screen work begins. Screens must read the graph, never hard-code a state name                                                                                  |
| **WF-22** | No distinct technician sign-off record. Completion is inferred from three separate facts                                                                                                                                                                                                                                                                                                                                        | P1-19                                                                                                                                                                                                                         | P1-29                                                                                                                    | Decide whether an explicit technician certification is required. If it is, it is a new record with its own permission                                                                                                                                 |
| **WF-23** | No invoice list; `GET /invoices/{invoiceId}` is gated on the write code `sal.invoice.manage`; no credit-note list                                                                                                                                                                                                                                                                                                               | P1-22                                                                                                                                                                                                                         | P1-30 / P1-31                                                                                                            | Add list reads and a finance read code, or record why the write code is the correct gate                                                                                                                                                              |
| **WF-24** | No receipt-reversal operation, although `sal.reversal.approve` is seeded and `sal.receipt_reversals` exists                                                                                                                                                                                                                                                                                                                     | P1-22                                                                                                                                                                                                                         | P1-30 / P1-31                                                                                                            | Add the dual-control reversal operation the permission already describes, or retire the permission                                                                                                                                                    |
| **WF-25** | No `GET /deliveries/{deliveryId}` and no delivery list — only the eligibility view                                                                                                                                                                                                                                                                                                                                              | P1-22                                                                                                                                                                                                                         | P1-30 / P1-31                                                                                                            | Add a delivery detail read and a list under `sal.delivery.view`                                                                                                                                                                                       |
| **WF-26** | No warranty list; the warranty read is gated on the issue code `wty.warranty.issue`; no warranty-policy or delivery-checklist-template management, so `wty.policy.manage` is unused                                                                                                                                                                                                                                             | P1-22                                                                                                                                                                                                                         | P1-30 / P1-31                                                                                                            | Add warranty and checklist-template administration, and a warranty read code                                                                                                                                                                          |
| **WF-27** | **Some permissions are required by the database but declared by no operation.** A complaint's text and a vehicle-contents description need `iam.sensitive.view` on top of `rec.reception.evidence.manage`; an external part's unit cost needs `inv.cost.view` on top of `inv.external_purchase.record`. Somebody granted exactly what the operation asks for passes every application check and is then refused by the database | P1-18 / P1-20                                                                                                                                                                                                                 | P1-28 / P1-30                                                                                                            | Publish the full requirement for each affected operation — either by declaring the second code on the operation, or by writing it into the role design — so that a role can be granted correctly. A screen must not show a refusal nobody can explain |
| **WF-28** | Notification channels diverge: the request accepts `email`, `sms`, `whatsapp` and `in_app`, but the database allows only `email` and `in_app` and the enqueue rules refuse the other two. No text message or WhatsApp message can be sent                                                                                                                                                                                       | P1-15                                                                                                                                                                                                                         | P1-29                                                                                                                    | Decide whether text and WhatsApp messaging is in scope. Until it is built, no screen may offer either channel, and no proposal may claim the platform sends them                                                                                      |

### 6.1 Findings that are Owner decisions, not engineering gaps

| finding       | subject                                | why it is not an engineering gap                                                                                                                                                  |
| ------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-OD-017** | Duplicate and merge rules              | The merge operations exist (`crm.customer-merge`, `veh.vehicle-merge`). What is missing is the **rule** for when a merge is correct — an Owner decision, not a contract           |
| **P1-OD-025** | Vehicle document and media file policy | The document contracts exist. What is missing is the **policy** — accepted types, size limits, retention, storage arrangement. Inventing any of these would pre-empt the decision |

---

## 7. Cross-cutting contracts every step obeys

### 7.1 Money

Money is a **decimal string plus an ISO 4217 currency code**, and the two travel
together. There is no conversion path anywhere in the platform. A currency
reference list **does** exist — `shared.currencies`, seeded with ISO 4217 codes,
names, minor units and a status — and it carries **no default and no
jurisdiction policy**. A company names its own
`org.legal_companies.base_currency_code`; a price list names its own
`svc.price_lists.currency_code`, immutable once set. No screen may show a
floating-point amount, infer a currency from a country, or add two amounts in
different currencies.

### 7.2 Large numbers arrive as text

`numeric` and `bigint` values arrive as **strings and stay strings**. Quantities,
balances, amounts and identifiers must be carried and displayed as text.
Converting one to a number to format it is how precision is lost silently.

### 7.3 Pagination

Every list is **keyset/cursor paginated** and returns exactly
`{ items, nextCursor, hasMore }`. **There is no `total`** and none can be
computed — the platform deliberately fetches one extra row to detect `hasMore`
rather than running a second counting query. No screen may display "page 3 of 47",
"1–50 of 812", or a page-number control. Offset pagination is not offered at all.

The default page size is 50 and the maximum is 100. Ordering is always
`(sortValue, id)` — the identifier is the tie-breaker that makes the order total,
without which two rows sharing a timestamp can straddle a page edge and be shown
twice or never.

### 7.4 Repeat-safe commands and stale-record protection

| mechanism              | what it means for a screen                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `idempotent: true`     | The operation **requires** an `Idempotency-Key` header. A retry after a timeout returns the original answer instead of acting twice |
| `versionGuarded: true` | The operation **requires** an `If-Match` record version. A screen must have read the record and must send back the version it saw   |

Both are declared per operation and both are enforced before authorisation. A
screen that omits either receives an error regardless of the operator's
permissions.

### 7.5 Scope

Every operation declares a scope of `tenant`, `company` or `branch`. Scope is
**resolved by the server** from the caller's grants and is never accepted from the
client. Branch-scoped commands re-authorise against the **locked** record's branch,
not against the request — a branch scope without a target is inert, so a caller
who reads in one branch could otherwise act in another.

Broadly: CRM, Vehicle, IAM, Documents and Notifications are tenant-scoped; Work
Order, Diagnostics, Technician, Quality, Quotation, Reception, Appointment,
Billing, Payment and Delivery are branch-scoped. There are deliberate exceptions
— `GET /items` and `GET /price-lists` are tenant-scoped while `GET /prices` and
`GET /services` are branch-scoped — so scope must be read per operation, never
assumed per domain.

### 7.6 Audit

Six audit classes exist: `none`, `privileged`, `approval`, `financial`, `export`,
`security`. Anything other than `none` **must** carry an audit action code, and the
transaction wrapper emits exactly one audit record.

Most reads are class `none`. **Seven read operations are not**, and a screen
should warn the member of staff before they open one:

| read                                                                 | class        | why                          |
| -------------------------------------------------------------------- | ------------ | ---------------------------- |
| `iam.audit-event-list` and `iam.audit-event-detail` (two operations) | `security`   | Looking at the log is logged |
| `wo.additional-work-detail-read`                                     | `security`   | Money detail                 |
| `qms.rework-cost-read`                                               | `security`   | Money detail                 |
| `shared.notification-delivery-list`                                  | `security`   | Delivery inspection          |
| `inv.stock-movement-list`                                            | `privileged` | Movement history             |
| `inv.inventory-reconciliation-read`                                  | `privileged` | Reconciliation evidence      |

**The twelve permission codes no published operation asks for.**
`iam.login.view_all`, `inv.cost.view`, `inv.item.manage`, `org.branch.manage`,
`org.company.manage`, `org.department.manage`, `org.subscription.manage`,
`org.tax.manage`, `rpt.report.configure`, `sal.reversal.approve`,
`wo.work_order.create`, `wty.policy.manage`. None of them may be cited as gating
an operation.

**Two of those twelve are nevertheless enforced, and that distinction matters.**
"Asked for by no operation" means no operation names the code in its own list. It
does not mean the code does nothing. `inv.cost.view` guards the restricted cost
rows `inv.item_cost_details` and `inv.external_purchase_part_details` at the
database, so it is a live requirement on anyone recording or reading a part's
cost; and `iam.login.view_all` guards the login history in the same way. The
other ten are required by nothing at all. See **WF-27**, which records this whole
class of requirement.

**Ten reads are gated on a code that is not a read code**, because no matching
read code exists. Somebody who should only be allowed to look must therefore be
granted the authority to act, which is the wrong shape and should be corrected
rather than designed around:

| read                                             | gated on                                  |
| ------------------------------------------------ | ----------------------------------------- |
| `GET /attachments/documents/{documentId}`        | `shared.document.manage`                  |
| `GET /vehicles/{vehicleId}/documents`            | `shared.document.manage`                  |
| `GET /invoices/{invoiceId}`                      | `sal.invoice.manage`                      |
| `GET /work-orders/{workOrderId}/invoice-preview` | `sal.invoice.manage` + `sal.finance.view` |
| `GET /payment-methods`                           | `sal.payment.record`                      |
| `GET /warranties/{warrantyId}`                   | `wty.warranty.issue`                      |
| `GET /iam/approval-limits`                       | `iam.approval.manage`                     |
| `GET /customer-duplicates`                       | `crm.customer.duplicate.review`           |
| `GET /vehicle-duplicates`                        | `veh.vehicle.duplicate.review`            |
| `GET /exports/resources`                         | `rpt.export`                              |

### 7.7 Sensitive data

`iam.sensitive.view` is an **additive second gate**, not an alternative one. Four
operations **declare** it on top of their domain permission — the additional-work
money detail (read and write) and the rework cost (read and write).

It also binds in places no operation declares, because it is written into the row
rules of the restricted tables themselves — across CRM, Vehicle, Reception,
Technician, Work Order and Quality. The one that bites first in this journey is
reception: a complaint's text (`rec.complaint_details`) and the description of a
vehicle's contents (`rec.vehicle_content_details`) both need
`iam.sensitive.view` in addition to `rec.reception.evidence.manage`, and nothing
in the operation says so. `inv.cost.view` behaves the same way for part cost. See
**WF-27**.

The rule to work from is therefore: **the codes an operation declares are the
minimum, never the whole requirement.** Before a role is designed for a job, the
restricted tables that job writes to must be checked as well.

Certain filterable fields are also marked sensitive, and **filtering on them
requires `iam.sensitive.view`**, because filtering gives an answer without showing
the value: somebody who can narrow a list by an amount can discover that amount
without ever being shown it.

### 7.8 There is no wildcard

There is **no wildcard permission and no `*.admin` code**. Authorisation is by
permission, never by role name. A screen must check the specific code, and must
never infer capability from a job title.

---

## 8. Owner decisions and commercial boundaries

### 8.1 The two open decisions

Named at every step where they bind: **P1-OD-017** at steps 2 and 3, where a
duplicate customer or vehicle is found, and again at step 29, because merging two
records changes what a vehicle's retained history looks like; and **P1-OD-025** at
step 5, where the photographs are taken. Neither is worked around anywhere in this
document, and no screen may assert a rule either decision would set.

### 8.2 Paid data providers are a commercial decision

Several steps would be materially better with third-party data — VIN decoding to
populate make, model, trim and specification at step 3; fault-code dictionaries at
step 7; parts catalogues and standard labour times at step 19. Every one of those
would be a **paid data provider**, and purchasing or contracting one is a
commercial decision reserved to the Product Owner.

What this document recommends is an **evaluation**, never a purchase: for each
candidate, establish coverage for the pilot's vehicle mix, licence terms,
integration cost and the consequences of the provider becoming unavailable. No
vendor is named here and no price is stated, because none is established.

### 8.3 No business data

Business tables ship empty. Nothing in this document licenses seeding a
demonstration customer, vehicle, work order, price or invoice.

The work-order and job state graphs at step 21 are the one place where that line
needs stating carefully. A platform default graph **is** seeded, because the
transition guards would otherwise refuse every move and the module could not run
at all. It carries no tenant, no customer, no vehicle and no money — it is a
generic lifecycle definition, which is what the policy permits. Extending or
renaming it for the pilot workshop is configuration, not seed data, and remains
**not established**.

---

## 9. What is not established

Stated plainly, so that no reader mistakes a silence for a fact.

| question                                                                                                 | status              | what would establish it                                                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| How long each step should take                                                                           | **Not established** | An Owner-set service-level target per step, agreed against real branch throughput                 |
| How many vehicles a branch handles in a day                                                              | **Not established** | Pilot-tenant measurement. No figure exists in this repository and none may be invented            |
| Which of the seeded work-order and job states the pilot workshop uses, and what each is called on screen | **Not established** | The workshop's own confirmation against the seeded platform default, before any P1-29 screen work |
| Which departments a branch has, and what work each takes                                                 | **Not established** | An Owner decision, then WF-09                                                                     |
| Whether a road test is mandatory, conditional, or discretionary                                          | **Not established** | An Owner decision, then WF-10                                                                     |
| Accepted media types, size limits and retention                                                          | **Not established** | **P1-OD-025**                                                                                     |
| When two customer or vehicle records are the same record                                                 | **Not established** | **P1-OD-017**                                                                                     |
| Whether a paid data provider will be used, and which                                                     | **Not established** | An Owner commercial decision, informed by an evaluation                                           |
| Which of P1-30 and P1-31 owns which of billing, payment and delivery                                     | **Not established** | The phase-1-11 records name both without splitting them; the split needs a decision               |
| The Frontend phase owning documents, notifications and reporting                                         | **Not established** | No repository record names one                                                                    |
| Whether a unified vehicle service history is a deliverable                                               | **Not established** | An Owner decision, then WF-19                                                                     |

---

## 10. Reading this document alongside the others

| document                                    | what it is for                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `docs/phase-1/phase-1-27/canonical-plan.md` | What P1-27 itself is scoped to build, and its 42 tasks                                 |
| `docs/phase-1/phase-1-27/findings.md`       | The `P1-27-INT-###` register. The `WF-` findings here are **not** in it                |
| `docs/phase-1/phase-1-1/open-decisions.md`  | The Owner-decision register this document's `P1-OD-` references sit alongside          |
| `docs/adr/ADR-021-…`                        | Scroll ownership and notification authority — binding on every screen any phase builds |

Where this document and any earlier workflow description disagree about a
contract, this one is correct, because every contract in it was read out of the
repository on the date recorded in the header. Where it and the repository
disagree, **the repository is correct** and this document is stale — it records a
moment, and moments pass.
