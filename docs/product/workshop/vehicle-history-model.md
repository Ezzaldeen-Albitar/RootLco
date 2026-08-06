# Vehicle History Model

**Status:** Planning — not implemented · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Recorded:** 2026-08-06 · **Phase authority:** P1-27 Owner-acceptance remediation

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 0. Planning and traceability only

**Nothing in this document is implemented by Phase 1-27.** It is a planning and
traceability record. It describes the history a workshop would want to see for one
vehicle, maps each part of that history onto the operations the platform actually
publishes today, and records — as numbered integration findings — every part that has
no operation behind it.

Three rules govern every sentence below.

| rule | what it means here |
| ---- | ------------------ |
| **No screen is claimed to exist.** | Where this document says "section", it means a section that a future phase would build. P1-27 builds no vehicle history screen. |
| **No contract is guessed.** | Every operation identifier, permission code, table, column and status value below was read out of this repository. Where the contract a section needs does not exist, that is stated in place and recorded in §11. |
| **No number is invented.** | Where a figure is not established by something in the repository, the document says "not established" and says what would establish it. There are no service levels, retention periods, volumes or prices in this document, because none is decided. |

This document also does **not** authorise any purchase. Where an external data source
could enrich vehicle history — a registration authority, a VIN decoder, a recall feed —
the recommendation is an evaluation, never a contract. Purchasing or contracting a paid
data provider is a commercial decision reserved to the Product Owner.

---

## 1. The finding this document is built on

A "vehicle history" is usually imagined as a single dated stream: everything that ever
happened to this car, newest first. **The platform does not have that, and this document
must not pretend otherwise.**

### 1.1 What `veh.vehicle-history` actually returns

`GET /api/v1/vehicles/{vehicleId}/history` (operation `veh.vehicle-history`, permission
`veh.vehicle.read`, scope `tenant`) reads exactly one table:
`veh.vehicle_attribute_history`.

`apps/api/src/modules/vehicle/data/vehicle-history-repository.ts` selects
`id, field_code, old_value, new_value, occurred_at, actor_id` from that table and from
nothing else. The domain contract in
`apps/api/src/modules/vehicle/domain/vehicle-history.ts` describes the result as "a safe
projection of one attribute-change history row", where `fieldCode` is "the master column
that changed".

The migration `supabase/migrations/20260720095000_veh_vehicle_attribute_history.sql`
settles what those columns can be. Rows are written **only** by an `AFTER UPDATE` trigger
on `veh.vehicles`, one row per changed tracked column, and the trigger tracks exactly
eleven columns:

| tracked `field_code` | what changed |
| -------------------- | ------------ |
| `vin_normalized` | the normalised VIN |
| `make_id`, `model_id`, `trim_id` | catalogue references |
| `model_year` | the model year |
| `body_type_id`, `powertrain_type_id` | catalogue references |
| `powertrain_category` | `ice`, `ev`, `hybrid`, `phev`, `other` |
| `color` | the recorded colour |
| `lifecycle_status` | `draft`, `active`, `inactive`, `merged`, `scrapped` |
| `workshop_status` | `none`, `in_workshop`, `awaiting_parts`, `ready_for_delivery` |

That is the whole of it. **This operation is a field-level change ledger for the vehicle
record itself.** It contains no visit, no repair, no part, no invoice, no photograph and
no person other than the actor who made the edit.

### 1.2 There is no vehicle equivalent of `crm.timeline_events`

The customer side of the platform does have a unified stream.
`supabase/migrations/20260719102000_crm_communication_timeline.sql` creates
`crm.timeline_events` — an append-only, customer-facing chronology with `event_type`,
`event_ref_type`, `event_ref_id`, a PII-safe `title`, `occurred_at`, `actor_id` and
`correlation_id` — and installs six `AFTER INSERT` emit triggers that write into it from
status history, consent history, block history, alerts, merges and the communication log.

**The `veh` schema has no such table.** The web-side contract
`apps/web/src/features/vehicles/duplicates-contract.ts` states the same conclusion in the
same words: `veh.vehicle-history` reads `veh.vehicle_attribute_history` — "field-level
changes to the vehicle master and nothing else" — CRM has `crm.timeline_events` populated
by triggers across the domain, and the vehicle schema has "no equivalent table".

### 1.3 The consequence, stated plainly

A vehicle history view must therefore be **sectioned, not unified**. Each section is
backed by one real publishing operation, is labelled with what that operation actually
returns, and is paginated on its own terms.

Aggregating the sections into one merged stream would invent an event ordering the
platform does not have. Different sections order by different columns
(`veh.vehicle_attribute_history.occurred_at`, `veh.plate_history.created_at`,
`veh.odometer_readings.observed_at`, `veh.vehicle_relationships.created_at`), each with
its own cursor contract key, and a merged list would silently disagree with each
section's own list the moment a page boundary fell between them.

**If the platform is ever to have a single vehicle stream, it must be built as a real
emitting ledger, not assembled in the browser.** That is recorded as finding `VHM-01`.

---

## 2. How the chain actually runs

The database does link a vehicle to almost everything a workshop would want to see. It is
the *published read surface* that breaks the chain, and it breaks at two identifiable
points.

### 2.1 The links that exist in the database

| link | evidence |
| ---- | -------- |
| reception visit → vehicle | `rec.reception_visits.vehicle_id`, referenced by `wo.guard_work_order_refs()` |
| work order → vehicle | `wo.work_orders.vehicle_id NOT NULL`, with `ix_work_orders_vehicle ON wo.work_orders (tenant_id, vehicle_id)` |
| work order → reception visit | `wo.work_orders.reception_visit_id NOT NULL`, and the vehicle is coherence-locked against the visit's vehicle by trigger |
| job → work order | `wo.jobs.work_order_id` |
| diagnostic report → work order and job | `dia.diagnostic_reports.work_order_id`, `.job_id` |
| labour session → job | `tech.labor_sessions.job_id` |
| stock movement → work order | `inv.stock_movements.work_order_id` (nullable) |
| quotation → work order | `quo.quotations.work_order_id NOT NULL` |
| invoice → work order | `sal.invoices.work_order_id NOT NULL` |
| delivery → work order | `sal.delivery_records.work_order_id NOT NULL` |
| warranty → work order | `wty.warranty_records.work_order_id NOT NULL` |
| quality control → work order | `qms.quality_control_records.work_order_id` |
| rework link → work orders | `qms.rework_links.original_work_order_id`, `.rework_work_order_id` |
| document → any entity | `shared.document_links (entity_type, entity_id)`, resolved by `shared.document_ids_for_entity(text, uuid)` |

So the data model already says: *this vehicle, that visit, that repair, those parts, that
invoice.*

### 2.2 The two breaks in the read surface

**Break one — a vehicle cannot list its work orders.**
`apps/api/src/app/api/v1/work-orders/route.ts` defines `wo.work-order-list` with a
`.strict()` query schema accepting exactly `companyId`, `branchId`, `state`, `kind`,
`openedFrom`, `openedTo`, `cursor` and `limit`. There is no `vehicleId`. The database
column and its index exist; the operation does not expose them. Recorded as `VHM-03`.

**Break two — reception and appointment publish no read at all.**
All twelve reception and appointment operations are writes. There is no operation that
lists or reads a reception visit, a customer concern, an inspection, a signature or a
refusal, and the permission catalogue `supabase/seeds/04_iam_permission_catalog.sql`
contains no `rec.*.read` and no `apt.*.read` code. Recorded as `VHM-04`.

Everything downstream of a work order id is reachable. Nothing between a vehicle and a
work order id is.

---

## 3. The section register

One row per section a vehicle history view would present. "Reachable from a vehicle id"
means: starting from nothing but the vehicle identifier and the caller's permissions, can
the section be populated by published operations alone?

| # | section | publishing operation(s) | permission(s) | scope | reachable from a vehicle id | finding |
| - | ------- | ----------------------- | ------------- | ----- | --------------------------- | ------- |
| 1 | Vehicle identity header | `veh.vehicle-read` | `veh.vehicle.read` | tenant | Yes | — |
| 2 | Master field changes | `veh.vehicle-history` | `veh.vehicle.read` | tenant | Yes | — |
| 3 | Lifecycle and workshop status | `veh.vehicle-history`, filtered to two field codes | `veh.vehicle.read` | tenant | Partly — the typed ledger is unreadable | `VHM-02` |
| 4 | Number plates | `veh.vehicle-plate-history` | `veh.vehicle.read` | tenant | Yes | — |
| 5 | Ownership | `veh.vehicle-ownership-history` | `veh.vehicle.read` | tenant | Yes | — |
| 6 | Relationships and authorised parties | `veh.vehicle-relationship-list` | `veh.vehicle.read` | tenant | Yes | — |
| 7 | Odometer | `veh.vehicle-odometer-history` | `veh.vehicle.read` | tenant | Yes | — |
| 8 | Electric-vehicle profile | `veh.vehicle-ev-profile-read` | `veh.vehicle.read` | tenant | Yes | — |
| 9 | Documents | `veh.vehicle-document-list` | **`shared.document.manage`** | tenant | Ids only, no titles, no bytes | `VHM-07`, `VHM-08` |
| 10 | Duplicate review and merge | `veh.vehicle-duplicate-list`, `veh.vehicle-duplicate-review` | `veh.vehicle.duplicate.review` | tenant | Yes, tenant-wide queue | `VHM-19` |
| 11 | Reception visits | none | none | — | **No** | `VHM-04` |
| 12 | Customer concerns | none | none | — | **No** | `VHM-04` |
| 13 | Photographs and condition evidence | none for reading | none | — | **No** | `VHM-04`, `VHM-08` |
| 14 | Work orders | `wo.work-order-list`, `wo.work-order-detail` | `wo.work_order.read` | branch | **No — no vehicle filter** | `VHM-03` |
| 15 | Diagnostic scans | `dia.diagnostic-list`, `dia.diagnostic-detail` | `dia.diagnostic.read` | branch | Only via a known job id | `VHM-03`, `VHM-09` |
| 16 | Road tests and lift inspections | none as first-class concepts | — | — | **No** | `VHM-11` |
| 17 | Departments | none | — | — | **No** | `VHM-14` |
| 18 | Employees | `iam.user-detail`, `tech.technician-available` | `iam.user.read`, `tech.technician.read` | tenant / branch | Actor id resolves one at a time | `VHM-12`, `VHM-13` |
| 19 | Work logs | `tech.labor-session-list` | `tech.technician.read` | branch | Only via a known job id | `VHM-03` |
| 20 | Parts | `inv.stock-movement-list` with `workOrderId` | `inv.stock.read` | branch | Only via a known work order id | `VHM-03` |
| 21 | External purchases | none for reading | — | — | **No** | `VHM-18` |
| 22 | Quotations | `quo.quotation-detail` | `quo.quotation.read` | branch | **No — no list** | `VHM-05` |
| 23 | Approvals | `wo.additional-work-approval-read` | `wo.work_order.read` | branch | Only via a known request id | `VHM-03` |
| 24 | Invoices and payments | `sal.invoice-detail`, `sal.receipt-detail` | `sal.invoice.manage`, `sal.finance.view` | branch | **No — no list** | `VHM-06` |
| 25 | Quality control | `qms.qc-record-list`, `qms.qc-record-detail` | `qms.quality_control.read` | branch | Only via a known work order id | `VHM-03` |
| 26 | Rework | `qms.rework-list`, `qms.rework-detail` | `qms.quality_control.read` | branch | Only via a known work order id | `VHM-03` |
| 27 | Delivery | `sal.delivery-eligibility-read` | `sal.delivery.view` + `sal.finance.view` | branch | **No — no list, no delivery detail read** | `VHM-06` |
| 28 | Warranty | `wty.warranty-detail` | **`wty.warranty.issue`** | branch | **No — no list** | `VHM-06` |

Two structural facts a reader should take from this table.

- **Nine of the twenty-eight sections are backed by an operation that takes the vehicle
  id directly.** All nine are in the `veh` module and all are tenant-scoped.
- **The remaining nineteen sit behind a work-order identifier the platform will not give
  out from a vehicle.** Closing `VHM-03` alone would make eleven of them reachable.

---

## 4. Section specifications

Each specification states what the section shows, which operation publishes it, and what
it must not claim.

### 4.1 Vehicle identity header

Published by `veh.vehicle-read` (`GET /vehicles/{vehicleId}`). The detail row published by
`apps/api/src/modules/vehicle/data/vehicle-read-repository.ts` carries the display number,
VIN, make, model, trim, body type and powertrain type as **both** the identifier and the
resolved name, model year, powertrain category, colour, lifecycle status, workshop status,
`mergedIntoId`, `recordVersion`, `createdAt` and `updatedAt`.

Rules for the header:

- **`mergedIntoId` must be shown when it is not null.** Vehicle search returns merged
  vehicles, and every write against one is refused; a header that hides the merge leaves
  the operator to discover it only when a save fails.
- The operation emits `recordVersion` as an `ETag`. Note the open finding
  `P1-27-INT-009`: neither vehicle `PATCH` is registered `versionGuarded`, so the `ETag`
  is published but not enforced. A history view is read-only and is unaffected, but must
  not present the `ETag` as a concurrency guarantee.
- A missing, deleted or cross-tenant vehicle produces the same `ERR-RES-001`. The view
  must not distinguish them.

### 4.2 Master field changes

Published by `veh.vehicle-history`. Newest first, ordered by `occurred_at` descending with
the row id as tie-breaker, under contract key
`veh.vehicle_attribute_history:occurred_desc`.

**Both `oldValue` and `newValue` are nullable.** A creation has no old value; a clearing
has no new one. The web contract already models four reading shapes — `set`, `cleared`,
`changed`, `empty` — rather than one "old → new" template, because three of the four read
as nonsense through that template. Any future view must adopt the same four shapes.

**Section title wording.** The section must be titled for what it is — changes to the
vehicle record — and never "Vehicle timeline" or "Vehicle history" without qualification.

**A note on paging.** Attribute-history rows are written by a trigger inside the
transaction that changed the vehicle, so every row from one update shares `occurred_at` to
the microsecond. A cursor truncated to milliseconds loses every sibling of the row it
stopped on, every time. That defect was closed for the six vehicle reads under
`P1-27-INT-008`; the repository now selects an explicit `occurred_at_cursor`. It is
recorded here because it is the reason this section can be trusted to page correctly and
some other phases' reads still cannot.

### 4.3 Lifecycle and workshop status

Two ledgers are written for one status change, and only one of them is readable.

| ledger | written by | readable over HTTP |
| ------ | ---------- | ------------------ |
| `veh.vehicle_attribute_history` | `veh.emit_vehicle_attribute_history()` — one row per changed column, `field_code` = `lifecycle_status` or `workshop_status` | Yes, through `veh.vehicle-history` |
| `veh.vehicle_status_history` | `veh.emit_vehicle_status_history()` — one typed row per changed axis, with `status_kind` (`lifecycle` or `workshop`), `from_state`, `to_state`, a coherence guard anchoring `to_state` to the live master, and a monotonic `seq` | **No operation reads it** |

So a status section can be assembled from the attribute history by filtering two field
codes. It would show the same transitions, but without the `status_kind` discriminator,
without the coherence guarantee and without `seq`. Recorded as `VHM-02`.

The permitted transitions are fixed in
`apps/api/src/modules/vehicle/domain/vehicle-lifecycle.ts` and are worth stating for the
benefit of anyone reading a status list:

| axis | transitions |
| ---- | ----------- |
| lifecycle | `draft → active, scrapped` · `active → inactive, scrapped` · `inactive → active, scrapped` · `merged` and `scrapped` are terminal |
| workshop | `none → in_workshop` · `in_workshop → awaiting_parts, ready_for_delivery, none` · `awaiting_parts → in_workshop, ready_for_delivery, none` · `ready_for_delivery → in_workshop, none` |

`merged` can never be reached through a status change; it is reached only through
`veh.vehicle-merge`, which carries its own permission and writes its own redirect. A
status section must never offer it.

### 4.4 Number plates

Published by `veh.vehicle-plate-history`, ordered `created_at` descending under contract
key `veh.plate_history:created_at_desc`. A plate is assigned by
`veh.vehicle-plate-assign` under `veh.vehicle.manage`, carrying a 2–3 letter country code
(`^[A-Z]{2,3}$`), a raw plate of 1–32 non-blank characters, and an optional effective date.
The temporal invariant — no two overlapping active plates — is enforced by the frozen
`veh` schema, not by the application.

### 4.5 Ownership

Published by `veh.vehicle-ownership-history`, ordered `created_at` descending under key
`veh.ownership_history:created_at_desc`. A transfer is recorded by
`veh.vehicle-ownership-transfer` under `veh.vehicle.relationship.manage`, carrying the
partner, an ownership kind from `registered_owner`, `beneficial`, `fleet` (default
`registered_owner`), an optional effective date and an optional transfer reason of up to
500 characters.

The domain file records that neither history table has an index leading with `created_at`,
so PostgreSQL sorts the one vehicle's rows itself. That is affordable because a vehicle
accumulates a handful of plates and owners over its life. A history view must not offer
these two sections a page size that assumes an index walk.

### 4.6 Relationships and authorised parties

Published by `veh.vehicle-relationship-list`. `veh.vehicle_relationships` is the single
source of truth for who is associated with a vehicle. Permitted roles, from the frozen
CHECK constraint: `owner`, `user`, `driver`, `fleet_operator`, `payer`,
`authorized_person`, `service_requester`.

An **authorised party** is an `authorized_person` relationship carrying a bounded
authorisation scope. The only actions that scope may grant are:

`approve_quotation` · `approve_additional_work` · `receive_vehicle` · `receive_reports` ·
`receive_invoices` · `communicate_about_service`

Nothing in that list grants ownership. Ownership lives in `veh.ownership_history` and
nowhere else. An authorised party is added by `veh.vehicle-authorized-party-add` and
withdrawn by `veh.vehicle-authorized-party-retire`, both under
`veh.vehicle.relationship.manage`.

Customer-centric linking — attaching a vehicle to a customer — is the CRM operation
`crm.vehicle-link` (`POST /customers/{customerId}/vehicles`, permission
`crm.customer.vehicle.manage`). The same table, a different door.

### 4.7 Odometer

Published by `veh.vehicle-odometer-history`, ordered `observed_at` descending under key
`veh.odometer_readings:observed_desc`. Recorded by `veh.vehicle-odometer-record` under
`veh.vehicle.odometer.record`.

Two modes share one append-only table.

| mode | capture method | may lower the value | anomaly flag |
| ---- | -------------- | ------------------- | ------------ |
| normal reading | `reception`, `delivery` or `manual` | No — the frozen guard refuses a normal reading below the current effective value | false |
| correction | `correction` | Yes | always true, set by the platform and never by the caller |

A correction references the reading it corrects and carries a reason from a closed list:
`lower_than_prior`, `possible_rollover`, `meter_replacement`, `data_entry_correction`,
`unknown`. It never edits or deletes the original.

**The reason names a factual category only.** The domain file is explicit that this makes
no fraud or tampering conclusion, and a history view must not add one. Units are `km` or
`mi`; the stored column is `numeric(12,1)`.

This is one of only two operations on the whole published surface that accepts a
caller-stated time for something that already happened — see §6.

### 4.8 Documents

Published by `veh.vehicle-document-list` (`GET /vehicles/{vehicleId}/documents`). Three
constraints shape this section, and all three are deliberate.

1. **The response is document identifiers only.** No storage key, no title, no bytes. The
   service resolves ids through `shared.document_ids_for_entity('veh.vehicle', id)` and
   returns them; the route docblock states that this phase provides "no production object
   store, no scanner-acceptance workflow, and no byte download".
2. **The read is gated on a write code.** The permission is `shared.document.manage`, not
   a read code, because — in the route's own words — document reachability is
   document-domain information held to the document permission rather than the lower
   vehicle read. **There is no `shared.document.read` code in the catalogue.** A user who
   may see a vehicle cannot necessarily see that it has documents.
3. **Reachability is the boundary.** A document is reachable from a vehicle only through a
   live link in `shared.document_links`. Knowing a document id is not access. Linking is
   the shared operation `POST /attachments/documents/{documentId}/links` with
   `entityType` `veh.vehicle` — note the token is `veh.vehicle`, a convention, not the
   table name `veh.vehicles`. `entity_type` is validated only as a `schema.table`-shaped
   token; no foreign key is possible on a generic link, and the residual risk is recorded
   in the security documentation and mitigated by per-domain validation.

**`P1-OD-025` (media upload policy) binds this section directly and is open.** Until it is
decided, no phase may specify how a photograph is captured, what formats are accepted,
what size is permitted, where bytes rest, how long they are retained or who may download
them. This document therefore specifies the *link* semantics and stops.

### 4.9 Duplicate review and merge

Published by `veh.vehicle-duplicate-list` (`GET /vehicle-duplicates`) and decided by
`veh.vehicle-duplicate-review`, both under `veh.vehicle.duplicate.review`.

| element | contract |
| ------- | -------- |
| candidate status | `open`, `dismissed`, `merged` |
| decisions this endpoint accepts | `dismissed`, and nothing else |
| `matchScore` | `numeric`, arriving as a **string**, never parsed as a number |
| `matchBasis` | `jsonb`, guaranteed free of raw identifier values by `veh.valid_match_basis` |
| review reason | 10–500 characters after trimming |

`merged` is a status a candidate *reaches* through `veh.vehicle-merge`; it is not a
decision this endpoint accepts.

Two refusals apply to any duplicate section and must be carried forward:

- **No merge affordance while `P1-OD-017` is open.** The canonical plan requires the
  affordance to be *absent* rather than disabled, because a disabled control says "this
  exists and you lack permission" — a different and false statement.
- **`veh.vehicle-duplicate-scan` must never fire on view.** It reads like a query and is a
  privileged audited write: it creates candidate rows, emits an audit record and is
  throttled. A section that "refreshed" by scanning would write audit history every time
  somebody looked.

The queue is **tenant-wide, not vehicle-scoped**. `GET /vehicle-duplicates` lists
candidates for the tenant; there is no operation listing the candidates involving one
vehicle. A vehicle-scoped duplicate section would have to filter client-side across pages,
which a keyset-paginated list cannot do honestly. Recorded as `VHM-19`.

### 4.10 Reception visits, customer concerns and condition evidence

**No read operation exists for any of this.** All twelve reception and appointment
operations are writes, and the permission catalogue registers no read code for either.
The catalogue seed records the omission as deliberate — an unused permission is
configuration that cannot be tested — which means the gap is known, not accidental.

What is captured at reception, and would populate this section once a read exists:

| subject | table | closed vocabulary |
| ------- | ----- | ----------------- |
| customer concerns | `rec.complaints`, `rec.complaint_details` | category `mechanical`, `electrical`, `body`, `noise`, `performance`, `other`; severity `low`, `medium`, `high`, `critical` |
| walk-around inspection | `rec.visual_inspections` | status `in_progress`, `completed`, `cancelled`; finalised headers are locked and further findings are linked corrections only |
| condition findings | `rec.condition_items` | category `scratch`, `dent`, `crack`, `wear`, `missing_part`, `malfunction`, `other`; severity `minor`, `moderate`, `major`, `critical` |
| damage maps and marks | `rec.damage_maps`, `rec.damage_marks` | map type `exterior`, `interior`, `undercarriage`, `other`; mark type `scratch`, `dent`, `crack`, `chip`, `rust`, `missing`, `other`; coordinates are fractions between 0 and 1 |
| warning lamps | `rec.warning_light_observations` | state `on`, `flashing`, `intermittent` |
| leaks | `rec.leak_observations` | type `oil`, `coolant`, `fuel`, `brake_fluid`, `transmission`, `water`, `other` |
| vehicle contents | `rec.vehicle_contents`, `rec.vehicle_content_details` | quantity a positive whole number; declared value `numeric(14,2)` |
| signatures | `rec.signatures` | role, capture method `drawn`, `typed`, `uploaded`, `biometric`; purpose `reception_acknowledgement`, `custody_acceptance`, `authorization`, `refusal_witness`, `condition_agreement`, `other` |
| refusals | `rec.refusals` | type `inspection_item`, `signature`, `intake_step`, `authorization`, `other` |

Two boundaries the reception domain sets, which a history view must respect:

- **A complaint is what the customer reported. An inspection finding is what staff
  observed.** They are separate tables for that reason and neither is ever promoted into
  the other.
- **A warning lamp is recorded as observed and nothing is inferred from it.** Which fault
  a lamp indicates is diagnosis, and diagnosis belongs to a technician and a later step.

The domain file is equally clear about what is *not* modelled and must not be displayed:
who caused a damage mark, when it happened, any insurance or liability judgement, and any
repair cost.

### 4.11 Work orders

Published by `wo.work-order-list` and `wo.work-order-detail`, both under
`wo.work_order.read`, scope `branch`. Both publish the vehicle identifier. Neither can be
reached from one.

**There is no `POST /work-orders`.** A work order is created only by
`rec.reception-convert-to-work-order` (`POST /receptions/{receptionId}/convert-to-work-order`,
permission `rec.reception.convert`). The route file explains why: reception's conversion
already inserts the row while holding the visit lock, and a second insert here would race
for the same partial unique index. Consequently the seeded permission
`wo.work_order.create` is used by no route, and a history view must never describe it as
governing anything.

The database refuses a work order unless its reception visit is `authorized` or
`converted`, has an approved authorisation and has accepted custody. So every work order in
a vehicle's history implies an approved, custody-accepted visit — even though that visit
cannot currently be read.

The platform work-order state graph, seeded as structural reference in
`supabase/seeds/06_wo_job_state_graph.sql`:

| state | terminal | closed | reason required | allows jobs | allows labour | allows additional work | requires QC |
| ----- | -------- | ------ | --------------- | ----------- | ------------- | ---------------------- | ----------- |
| `draft` | no | no | no | no | no | no | no |
| `open` | no | no | no | yes | yes | yes | no |
| `in_progress` | no | no | no | yes | yes | yes | no |
| `awaiting_parts` | no | no | **yes** | yes | no | yes | no |
| `awaiting_customer` | no | no | **yes** | no | no | yes | no |
| `qc_pending` | no | no | no | no | no | no | **yes** |
| `ready_to_close` | no | no | no | no | no | no | **yes** |
| `closed` | **yes** | yes | no | no | no | no | no |
| `cancelled` | **yes** | yes | **yes** | no | no | no | no |

A tenant may extend the graph with its own non-terminal routing states; terminal, closed
and cancellation states remain platform-governed. A history view must therefore render the
state code and its name from the catalogue, never from a hard-coded list.

### 4.12 Diagnostic scans

Published by `dia.diagnostic-list` (`GET /jobs/{jobId}/inspections`) and
`dia.diagnostic-detail` (`GET /inspections/{inspectionId}`), both under
`dia.diagnostic.read`. Note the resource is `/inspections`, not `/diagnostics`, and the
list hangs off a **job**, not a vehicle or a work order.

Report status: `draft`, `in_progress`, `completed`, `cancelled`. The transition graph is a
fixed chain — `draft → in_progress | cancelled`, `in_progress → completed | cancelled`,
and both `completed` and `cancelled` are terminal. Entries may be recorded only while the
report is `draft` or `in_progress`.

| entry kind | closed vocabulary |
| ---------- | ----------------- |
| finding severity | `info`, `low`, `medium`, `high`, `critical` |
| finding disposition | `monitor`, `repair_recommended`, `repair_required`, `no_action` |
| fault code status | `active`, `pending`, `stored`, `cleared` |
| fault code format | `^[PBCU][0-9][0-9A-F]{3}$` — upper case, second character decimal, last three hexadecimal |
| recommendation priority | `low`, `medium`, `high` |
| review result | `approved`, `rejected`, `needs_rework` |

`dia.measurements.measured_value` is a bare `numeric` and **crosses the boundary as a
string**, compared in the database and never in floating point.

A completed report is gated: the database refuses a move to `completed` while a mandatory
item of the pinned template version has no result. The application adds the list of which
items are outstanding, because a technician told only "not yet" has been told nothing.

### 4.13 Road tests and lift inspections

**Neither exists as a platform concept.** A repository-wide search finds "road test" only
inside test fixtures, as a template item named `fx_road_test` with response type
`boolean` and label "Road test performed". There is no road-test table, no lift-inspection
table and no operation for either.

The honest model is that a road test and a lift inspection are **inspection template
items** — rows in `dia.template_items` under a published `dia.template_versions` — recorded
through `dia.diagnostic-item-result` (`PUT /inspections/{inspectionId}/items/{templateItemId}`).
Response types available are `numeric`, `text`, `boolean` and `select`.

That model cannot be used today, because **inspection templates have no HTTP surface at
all**: `dia.inspection_templates`, `dia.template_versions` and `dia.template_items` are
written and read by no route, and no permission code covers them. A tenant cannot define
a road-test item, so no report can carry one. Recorded as `VHM-11`.

A caution for anyone searching the route tree: the paths `/template-versions/*` belong to
**message templates** in shared services, not to inspection templates.

### 4.14 Departments and employees

**Departments.** `org.department.manage` is seeded, no route uses it, and there is no
department read of any kind — a search of the whole `v1` route tree returns nothing.
A vehicle history section cannot name the department that did the work. Recorded as
`VHM-14`.

**Employees.** Every history row carries an `actorId` (a `uuid`) and nothing else. Two
operations can turn that into a person: `iam.user-list` and `iam.user-detail`, both under
`iam.user.read`, scope `tenant`. **There is no batch resolution operation**, so a page of
twenty history rows written by twelve different people is twelve additional requests.
Recorded as `VHM-13`.

**Technicians.** `tech.technician-available` and `tech.technician-queue` exist under
`tech.technician.read`, but there is no technician profile list or detail read, and **no
route creates or maintains** technician profiles, skills, certifications or availability.
Of the nine `tech` tables, only `labor_sessions` is written over HTTP. Recorded as
`VHM-12`.

### 4.15 Work logs

Published by `tech.labor-session-list` (`GET /jobs/{jobId}/labor-sessions`) under
`tech.technician.read`. A session carries the technician profile, the job, `startedAt`,
`endedAt`, a source (`manual`, `timer`, `correction`) and a correction reference.

Three invariants a history view must present correctly:

- **At most one open session per technician**, enforced by a GiST exclusion constraint over
  `tstzrange(started_at, COALESCE(ended_at, 'infinity'))`. Two infinite ranges always
  overlap, so "no overlapping sessions" and "at most one open session" are the same
  constraint. A technician double-clocked onto two jobs is a payroll and liability
  problem, not a system error.
- **A correction never rewrites the original.** `tech.correct_labor_session` soft-deletes
  the original and inserts a linked replacement in one transaction, so the corrected hours
  and the hours they replaced both survive. A work-log section must show both, and must
  show which supersedes which.
- **Labour may not start before the job existed**, less a one-day tolerance. This is the
  platform's only structural backdating limit and it matters to §6.

There is no `GET /labor-sessions/{sessionId}`; a session is visible only through its job's
list.

### 4.16 Parts and external purchases

**Parts consumed on a repair are reachable, given a work order id.**
`inv.stock-movement-list` (`GET /stock-movements`, permission `inv.stock.read`, scope
`branch`) accepts a `workOrderId` filter alongside required `companyId` and `branchId`.
This is the one downstream read that already carries the operational link.

Everything else in inventory is write-only from a history point of view: there is no list
read for reservations, issues, returns, damaged stock, customer-supplied parts, external
purchase parts or opening batches. In particular there is **no read of
`inv.external_purchase_parts`**, so the "external purchases" section of a vehicle history
cannot be populated. Recorded as `VHM-18`.

Note also that `inv.cost.view` is seeded and used by no route, so item cost is exposed
nowhere. A parts section can show what was moved, not what it cost.

### 4.17 Quotations and approvals

**Quotations.** `quo.quotation-detail` reads one quotation by id under
`quo.quotation.read`. **There is no `GET /quotations`.** A quotation can be read only if
its identifier is already known, and there is no way to find a vehicle's, a customer's or
a work order's quotations. Recorded as `VHM-05`.

**Additional work and its approval.** Requests are raised by
`wo.additional-work-request` under `wo.additional_work.request`; the customer's decision is
recorded by `wo.additional-work-approval` under the separate, higher permission
`wo.additional_work.approve`. The route explains the separation: the workshop raising extra
work and the customer agreeing to pay for it are different authorities, and one person
holding both is a policy choice a tenant makes by granting them.

Request state is `pending`, `approved`, `rejected` or `withdrawn`; fulfilment state is
`unfulfilled`, `fulfilled` or `waived`. The database refuses `state = 'approved'` unless an
approved `wo.customer_approvals` row already exists for the request.

The approval record carries a decision (`approved` or `rejected`), a channel
(`in_person`, `phone`, `email`, `sms`, `portal`, `other`), the deciding reception party
role, the exact `presentedScope` shown to the customer, and an optional approved quotation
revision reference.

**Four things the caller may not choose**, per the route's own contract: the actor,
`decidedAt`, any storage key, and the deciding party freely. `decidedAt` is server-stamped
and then frozen — "a caller-supplied time could precede the request and could never be
corrected". This is the single most consequential fact for §6.

**The customer-facing description is restricted.** `wo.additional_work_request_details` is
gated at the row-security level on `iam.has_permission('iam.sensitive.view')`, and the two
operations that read or write it require `wo.work_order.read` **plus** `iam.sensitive.view`.
A history section must be built so that a caller without that permission sees the request
and its decision but not the description, rather than seeing an error.

### 4.18 Invoices, payments, delivery and warranty

Every commercial read on this surface is **by identifier only**. There is no list of
invoices, credit notes, payments, deliveries or warranties, so none of these sections can
be populated from a vehicle. Recorded as `VHM-06`.

Three specific traps:

| trap | detail |
| ---- | ------ |
| `GET /invoices/{invoiceId}` is gated on `sal.invoice.manage` | a write code; there is no invoice read code |
| `GET /warranties/{warrantyId}` is gated on `wty.warranty.issue` | an issue code; `wty.policy.manage` is seeded and unused |
| there is no `GET /deliveries/{deliveryId}` | only `/eligibility`, gated on `sal.delivery.view` **and** `sal.finance.view` |

`sal.finance.view` is a separate high-risk permission from the operational codes. A user
may legitimately be allowed to see that a vehicle was invoiced without being allowed to see
the amounts. Any commercial section must be designed to degrade to "an invoice exists"
rather than to fail.

The platform ships **no general ledger**. A vehicle history must never be described as an
accounting record.

### 4.19 Quality control and rework

Both are reachable from a work order id.

| section | operations | permission |
| ------- | ---------- | ---------- |
| quality control records | `qms.qc-record-list`, `qms.qc-record-detail` | `qms.quality_control.read` |
| rework | `qms.rework-list`, `qms.rework-detail` | `qms.quality_control.read` |
| rework cost | `qms.rework-cost-read` | `qms.quality_control.read` **+ `iam.sensitive.view`** |
| reopen attempts | `qms.reopen-attempt-list` | `qms.quality_control.read` |

The check catalogue `qms.qc_checks` carries `is_mandatory` — mandatory checks gate
work-order closure — and `is_safety_critical` — rework on a safety-critical check requires
independent sign-off under `qms.rework.sign_off`. A history view should surface the
safety-critical flag, because it is the difference between a repair one person could close
and one that required a second signature.

Closure itself runs six independent blockers (B1–B6) at the database level on the
transition into a terminal, non-cancellation state: a non-terminal job, active labour,
unresolved required additional work, an incomplete required diagnostic, a missing or failed
mandatory quality check, and unsigned safety rework. Cancellation bypasses the completeness
blockers, and history is still recorded. `wo.work-order-closure-eligibility` publishes the
current position.

---

## 5. Work logging

The requested list of technician actions, mapped onto what the platform actually publishes.
"Expressed as" is the honest translation; nothing in this table is a proposal to add an
operation, and nothing in it exists as a screen.

| requested action | expressed as | operation | permission |
| ---------------- | ------------ | --------- | ---------- |
| start work | open a labour session | `tech.labor-session-start` | `tech.labor.record` |
| pause work | **two facts, two requests**: stop the open session, then move the job to `paused` | `tech.labor-session-stop`, then `wo.job-transition` | `tech.labor.record`, then `wo.job.transition` |
| resume work | move the job back to `in_progress`, then start a new session | `wo.job-transition`, then `tech.labor-session-start` | `wo.job.transition`, then `tech.labor.record` |
| complete work | move the job to `completed` | `wo.job-transition` | `wo.job.transition` |
| add an observation | record a diagnostic finding on an open report | `dia.diagnostic-finding-record` | `dia.diagnostic.record` |
| add a diagnosis | record a finding disposition, a measurement or a fault code | `dia.diagnostic-finding-record`, `-measurement-record`, `-dtc-record` | `dia.diagnostic.record` |
| add a photograph or evidence | attach evidence to a diagnostic report; **or** obtain an upload authorisation and link the resulting document | `dia.diagnostic-evidence-record`; `shared.attachment-upload-authorize` then `shared.attachment-link-create` | `dia.diagnostic.record`; `shared.document.manage` |
| record a tool or device used | **no operation, no table, no permission** | — | — |
| request a part | record required-part demand on the work order | `wo.required-part-record` | `wo.work_order.line.manage` |
| issue a part | post a stock issue | `inv.stock-issue-create` | `inv.stock.operate` |
| return an unused part | post a stock return | `inv.stock-return-create` | `inv.stock.operate` |
| add an external part request | record an external purchase part | `inv.external-purchase-part-create` | `inv.external_purchase.record` |
| add a labour item | record a service line on the work order | `wo.service-line-record` | `wo.work_order.line.manage` |
| raise an additional-work request | raise the request; the customer decision is a separate authority | `wo.additional-work-request` | `wo.additional_work.request` |
| record a blocker | **a state with a mandatory reason, not a blocker record**: move the work order to `awaiting_parts` or `awaiting_customer`, both `reason_required` | `wo.work-order-transition` | `wo.work_order.transition` |
| escalate | **no operation, no table, no permission** | — | — |
| submit for quality assurance | move the work order to `qc_pending` (`requires_qc` is true on that state) | `wo.work-order-transition` | `wo.work_order.transition` |

### 5.1 Four things this table settles

**Pause is not a column.** `tech.labor_sessions` has `started_at` and `ended_at` and
nothing else temporal. The service file states the reasoning: modelling a pause as a column
would have required a migration, and modelling it as a nullable `paused_at` would have made
"how long was this worked" ambiguous. The reason for stopping lives in
`wo.job_status_history`, because the `paused` job state carries `reason_required = true`.

The two halves are separate requests **by design**. They are separate facts — the clock
stopped, and the job is waiting — with different permissions, and a technician may
legitimately stop their clock without changing the job's state at all, for example at the
end of a shift. A future screen may present one button; it must send two requests and
report honestly if the second fails.

**The job state graph is the authority on what is possible.** From the seeded platform
graph:

| job state | terminal | reason required | assignment required | labour allowed | closure eligible |
| --------- | -------- | --------------- | ------------------- | -------------- | ---------------- |
| `planned` | no | no | no | no | no |
| `assigned` | no | no | **yes** | **yes** | no |
| `in_progress` | no | no | **yes** | **yes** | no |
| `paused` | no | **yes** | **yes** | no | no |
| `completed` | **yes** | no | no | no | **yes** |
| `cancelled` | **yes** | **yes** | no | no | **yes** |

Permitted job edges: `planned → assigned`, `assigned → in_progress`,
`in_progress → paused` (reason), `paused → in_progress`, `paused → assigned` (reason),
`in_progress → completed`, and `cancelled` from `planned`, `assigned`, `in_progress` or
`paused` (reason in every case). **There is no edge from `completed` to anything**, and
`assigned → paused` does not exist.

**A blocker is a state, not an entity.** There is no blocker table, no blocker permission
and no blocker operation anywhere in the platform. What a workshop calls "blocked" is
`awaiting_parts` or `awaiting_customer`, each of which requires a reason at the transition.
That reason is carried in `app.status_reason` and enforced by
`wo.guard_work_order_transition()`. Recorded as `VHM-16`.

**Escalation and tool records do not exist at all.** No table, no operation, no permission
code. They must not appear in any specification until a Backend phase owns them. Recorded
as `VHM-16`.

### 5.2 Two logging facts that will surprise a reader

- **A job has no single read.** There is `PATCH /jobs/{jobId}` and `GET /jobs/{jobId}/history`,
  but no `GET /jobs/{jobId}`. A work log is read through the job's sub-resources, never
  through the job itself. Recorded as `VHM-10`.
- **Assignment lives in the work-order module but carries technician permissions.**
  `wo.job-assignment-create` and `wo.job-reassignment` are `work-order` operations gated on
  `tech.assignment.manage`, while `wo.job-assignment-list` is gated on
  `tech.technician.read`. The module a route lives in does not predict its permission
  prefix.

---

## 6. The paper-reconciliation rule

### 6.1 The rule

**Paper is a continuity aid, not a second permanent source of truth.**

A workshop will keep working when a screen is unavailable, a tablet is flat, a bay has no
signal or the network is down. Writing on paper in those moments is correct and expected.
What is never correct is treating that paper as a parallel record that the system later
"catches up with". The system is the record. Paper is what carries the facts from the bay
to the system.

The rule has four parts.

| part | statement |
| ---- | --------- |
| **1. Paper is temporary.** | A paper note has one job: to survive until it is entered. Once reconciled it is evidence of the entry, not an alternative to it. |
| **2. Entry is attributed to the person who typed it.** | Not to the person who wrote the paper. The two may differ, and pretending otherwise falsifies attribution. |
| **3. The reconciliation is itself a recorded fact.** | It carries who entered it, the source paper reference, the time the thing originally happened, and the time it was entered. |
| **4. The gap is visible, never hidden.** | A record entered four hours after the event must read as a record entered four hours after the event. Backdating a record so the gap disappears is falsification. |

### 6.2 The four facts a reconciliation must carry

| fact | why it is required |
| ---- | ------------------ |
| **who entered it** | attribution: the typist is accountable for the transcription, whoever observed the event |
| **the source paper reference** | traceability: a job card number, a bay sheet number, a photograph of the note — something that can be produced if the entry is questioned |
| **the original time** | the time the event actually happened, as stated on the paper |
| **the reconciliation time** | the time the entry was made, so the gap between the two is computable and auditable |

### 6.3 What the platform can and cannot record today

This is the part that must not be softened.

**Every timestamp on the published surface is server-stamped, with two exceptions.** A
search of all published route schemas for a caller-supplied instant returns:

| operation | field | what it is |
| --------- | ----- | ---------- |
| `veh.vehicle-odometer-record` | `observedAt` | a caller-stated time for something that already happened |
| `tech.labor-session-correct` | `startedAt`, `endedAt` | a caller-stated window for work already done |
| `wo.work-order-list` | `openedFrom`, `openedTo` | query filters, not records |
| `apt.appointment-create` | `requestedFrom`, `requestedTo` | a requested future window |
| `wo.job-assignment-create`, `wo.job-reassignment` | `from`, `to` | a planned assignment window |
| `quo.quotation-issue` | `expiresAt` | a future expiry |
| `inv.stock-reservation-create` | `expiresAt` | a future expiry |
| `tech.technician-available` | `from`, `to` | a query window |

So **exactly two operations accept a stated time for a past event**, and everything else —
reception evidence, signatures, diagnostic entries, quality checks, customer approvals,
stock movements, invoices, payments, deliveries — records the moment the request arrived.

Two constraints follow directly.

- **A customer approval taken on the telephone at 09:00 and entered at 13:00 is recorded as
  13:00, and cannot be corrected.** The approval route states that `decidedAt` is
  server-stamped and then frozen by `tg_customer_approvals_immutable`, precisely because a
  caller-supplied time "could precede the request and could never be corrected". The design
  is defensible; the consequence for paper reconciliation is that the original time is lost.
- **Labour has a structural backdating limit.** `tech.guard_labor_session()` refuses a
  session starting more than one day before the job was created. Paper covering a longer
  gap cannot be entered as labour at all; it can only be entered as a correction, which
  carries the higher `tech.labor.correct` permission and a mandatory reason.

**No field anywhere in the platform records a source paper reference.** A repository-wide
search for the concept returns only print stylesheets and unrelated architecture prose.
There is no column, no request field and no permission for it. Recorded as `VHM-15`.

### 6.4 What the platform does provide, and how far it goes

| mechanism | what it gives | what it does not give |
| --------- | ------------- | --------------------- |
| server-stamped `created_at` / `occurred_at` | an unforgeable reconciliation time on every record | the original time |
| `actor_id`, server-stamped by `shared.stamp_status_history()` and refused when the session has no actor | an unforgeable "who entered it" | who observed it |
| the labour correction primitive | an amended window, a mandatory reason, and both the original and the replacement preserved | a paper reference, and only for labour |
| the odometer correction mode | a stated `observedAt`, a reason from a closed list, and the original preserved | a paper reference, and only for the odometer |
| `wo.customer_approvals.channel` | that a decision arrived by `phone`, `in_person`, `sms`, `email`, `portal` or `other` | when it was actually given |
| `shared.status_evidence.evidence_ref` | a placeholder evidence string against a status transition — but `shared.status_history` is **granted `SELECT` only** to the runtime, so no application path writes it | any usable reconciliation record today |
| the append-only ledgers | that nothing entered can later be silently edited | the reconstruction of an event that was never entered |

### 6.5 The interim rule, until `VHM-15` is closed

Until a Backend phase owns a reconciliation record, the operating rule for a workshop is:

1. **Enter from paper as soon as the system is available.** The gap is a real fact and it
   should be small.
2. **Put the original time and the paper reference in the free-text field the operation
   already has**, where one exists — a transition reason, a correction reason, a note, a
   `presentedScope`. This is a workaround and must be recorded as one; it is not
   structured, not queryable and not enforced.
3. **Never present a reconciled record as contemporaneous.** No view may hide the
   difference between `created_at` and a stated original time.
4. **Never invent an original time in a field that means something else.** The odometer
   `observedAt` is the observation time and nothing else; using it to smuggle a paper
   timestamp would corrupt the anomaly-detection guard that compares readings.

---

## 7. Presentation rules

These are contract facts, not preferences, and they bind every section above.

| rule | contract |
| ---- | -------- |
| **Money is a decimal string plus an ISO 4217 currency code.** | `apps/api/src/modules/pricing/domain/money.ts`: a bare decimal is not money, so money is always a pair, and every operation on a pair checks the currency. `Money.of(amount: string, currency: string)`. Never JavaScript floating point, never `parseFloat`. |
| **Currency comes from the tenant's own price list.** | `svc.price_lists.currency_code`, immutable once set. The platform deliberately ships no currency table and no jurisdiction defaults. A history view must render the currency it is given and must not infer one from a country. |
| **`numeric` and `bigint` arrive as strings and stay strings.** | Duplicate `matchScore`, diagnostic `measured_value`, stock quantities, invoice amounts. Formatting must be done on the string; `formatMatchScore` in the vehicle duplicates contract is the pattern — it returns `null` for any shape it does not recognise, so an unexpected value is shown raw rather than rendered as a confident wrong number. |
| **Pagination is keyset, and there is no total.** | `apps/api/src/server/db/pagination.ts` defines `Page<T>` as exactly `{ items, nextCursor, hasMore }`. There is no `total` and there never was. No section may show "page 3 of 12" or a result count. |
| **A cursor is bound to an ordering.** | Each list carries a stable contract key, so a cursor issued by one ordering can never be replayed against another. Sections cannot share a cursor and cannot be merged into one paged stream. |
| **Requested page sizes are clamped, not refused.** | A client asking for 1000 receives the maximum and a `hasMore` flag. |
| **Permission absence must degrade, not fail.** | Several sections are gated on codes a viewer may not hold — `shared.document.manage`, `sal.finance.view`, `iam.sensitive.view`. A section the caller may not read must be absent or explicitly marked as withheld; it must not surface an error where a workshop user expects information. |
| **Scope is per operation.** | The nine vehicle-reachable sections are `tenant`-scoped. Almost every operational section is `branch`-scoped and requires a company and branch to be named. A vehicle is a tenant-level object whose history is largely branch-level; that mismatch is structural and must be designed for, not discovered. |

---

## 8. Owner decisions that bind this model

| decision | status | what it binds here |
| -------- | ------ | ------------------ |
| **`P1-OD-017` — duplicate and merge rules** | **Open** | §4.9 in full. No merge affordance may be specified or built. It also binds `crm.duplicate_candidates`, `crm.partner_merges`, `veh.duplicate_candidates` and `veh.vehicle_merges`, and the permissions `veh.vehicle.duplicate.review`, `veh.vehicle.merge`, `crm.customer.duplicate.review` and `crm.customer.merge`. |
| **`P1-OD-025` — media upload policy** | **Open** | §4.8 and the photograph rows of §4.10 and §5. Until it is decided, no capture flow, format list, size limit, storage location, retention period or download path may be specified. The platform's upload path is authorisation-only and bytes never transit the API. |

Neither decision may be worked around. Where a section depends on one, this document names
it and stops rather than proposing a substitute.

---

## 9. What is not established

| unknown | why it is not established | what would establish it |
| ------- | ------------------------- | ----------------------- |
| how many history entries a typical vehicle accumulates | no tenant holds business data; business tables ship empty by standing policy | measurement against a pilot tenant after a defined period of real operation |
| an acceptable load time for a history view | no performance budget has been set for a vehicle history surface | an Owner-approved performance budget, then measurement in a real browser |
| a retention period for any history section | retention classes and legal holds exist as structures; no period is decided | an Owner decision on retention policy, applied through `shared.retention_classes` |
| whether an external vehicle-data source should enrich this history | no evaluation has been performed and no provider has been assessed | an Owner-commissioned evaluation of candidate sources against coverage, licensing and data-protection criteria. **A recommendation to evaluate is not a recommendation to purchase**; contracting a paid provider is an Owner decision. |
| the volume of paper reconciliations to expect | depends on connectivity and shift patterns at a real site | observation at a pilot site |
| how many sections a workshop actually uses | no user research has been conducted on this surface | Owner-approved observation of real use |

---

## 10. Integration findings

Identifiers below are **document-local** (`VHM-nn`). They are candidates for promotion into
the phase register, whose highest allocated identifier at the time of writing is
`P1-27-INT-009`. Nothing here is fixed by P1-27.

| finding | what is missing | owning Backend phase | owning Frontend phase | required action |
| ------- | --------------- | -------------------- | --------------------- | --------------- |
| `VHM-01` | No unified vehicle event stream. `veh` has no equivalent of `crm.timeline_events`, and no emit trigger writes a vehicle chronology. | P1-17, with emitters owed by P1-18, P1-19, P1-20, P1-21 and P1-22 | a later vehicle Frontend phase | Decide whether a vehicle chronology is wanted. If so, add a `veh.timeline_events`-shaped append-only table with `event_type`, `event_ref_type`, `event_ref_id`, a safe `title`, `occurred_at`, `actor_id` and `correlation_id`; emit from the real source tables in the same transaction; publish one keyset read. Until then, no phase may present a merged stream. |
| `VHM-02` | `veh.vehicle_status_history` — the typed lifecycle and workshop ledger, with `status_kind`, `from_state`, `to_state` and a coherence guard — has no read operation. | P1-17 | — | Publish `GET /vehicles/{vehicleId}/status-history` under `veh.vehicle.read`, keyset-ordered on `(occurred_at, seq)`. Until then a status section must be assembled from two field codes of the attribute history and labelled as such. |
| `VHM-03` | `wo.work-order-list` accepts no `vehicleId`, although `wo.work_orders.vehicle_id` exists and `ix_work_orders_vehicle` indexes it. A vehicle cannot list its repairs. | P1-19 | — | Add an optional `vehicleId` to the strict query schema and the repository predicate, keeping `companyId` and `branchId` required as the authorisation target. This single change makes eleven downstream sections reachable. |
| `VHM-04` | Reception and appointment publish no read operation of any kind (0 of 12), and no `rec.*.read` or `apt.*.read` permission code exists. | P1-18 | — | Decide the read surface, register the permission codes, and publish visit, concern, inspection, evidence, signature and refusal reads. This is the largest single gap in vehicle history. |
| `VHM-05` | No `GET /quotations`. A quotation is readable only by an identifier the platform will not supply. | P1-20 | — | Publish a keyset list filtered by work order, and honour `quo.quotation.read`. |
| `VHM-06` | No list read for invoices, credit notes, payments, deliveries or warranties, and no `GET /deliveries/{deliveryId}`. | P1-21 (billing, payments, delivery), P1-22 (warranty) | — | Publish keyset lists filtered by work order, and separate a read code from the write and issue codes currently used to gate reads. |
| `VHM-07` | No `shared.document.read` permission code. Both document reads are gated on the write code `shared.document.manage`. | P1-15 | — | Register a read code and re-gate `shared.document-read` and `veh.vehicle-document-list`, so a viewer can see a vehicle's documents without holding document-write authority. |
| `VHM-08` | No document list or search, no title in the vehicle document response, and no byte download. Photographs cannot be displayed. | P1-15 | — | **Blocked by `P1-OD-025`.** Once decided: publish document metadata alongside the identifier and specify the retrieval path. No phase may design around the open decision. |
| `VHM-09` | Diagnostic reports are listed only per job (`GET /jobs/{jobId}/inspections`). There is no vehicle or work-order level list. | P1-19 | — | Either publish a work-order-level list, or accept the job-by-job walk and document the cost. Depends on `VHM-03` for any vehicle-level use. |
| `VHM-10` | No `GET /jobs/{jobId}`. A job is readable only through its sub-resources. | P1-19 | — | Publish a single job read under `wo.work_order.read`. |
| `VHM-11` | `dia.inspection_templates`, `dia.template_versions` and `dia.template_items` have no HTTP surface and no permission code. Road tests and lift inspections are template items and therefore cannot be configured. | P1-19 | — | Register a template-management permission and publish authoring plus read operations. Until then, no phase may describe a road test or a lift inspection as a capability. |
| `VHM-12` | No route creates or maintains technician profiles, skills, certifications or availability, and there is no technician list or detail read. Eight of the nine `tech` tables are written by nothing. | P1-19 | — | Publish technician administration and a profile read, so a work log can name the technician rather than an identifier. |
| `VHM-13` | No batch resolution of actor identifiers to names. `iam.user-detail` reads one user per request. | P1-14 | — | Publish a bounded batch read, or include a display name on history projections. A page of history should not cost one request per distinct actor. |
| `VHM-14` | No department read of any kind. `org.department.manage` is seeded and used by no route. | P1-13 | — | Publish department reads if a history view is required to attribute work to a department. Until then, no phase may promise it. |
| `VHM-15` | **No field anywhere records a source paper reference, an original time or a reconciliation time.** Only two published operations accept a caller-stated time for a past event; `wo.customer_approvals.decided_at` is server-stamped and frozen by design. | a foundation phase, because the record must be uniform across modules | — | Design one reconciliation record — actor, source reference, original time, reconciliation time — attachable to the operations a workshop genuinely enters late. Note the deliberate tension with the immutability rules that exist to prevent backdating: the record must sit **beside** the server-stamped time, never replace it. |
| `VHM-16` | No blocker record, no escalation record and no tool or device record: no table, no operation, no permission for any of the three. | P1-19 | — | Decide whether these are wanted. A blocker is currently expressed as `awaiting_parts` or `awaiting_customer` with a mandatory reason, which may be sufficient; escalation and tool records have no expression at all. |
| `VHM-17` | The two vehicle-history ledgers store `correlation_id`, and the read publishes only `id`, `fieldCode`, `oldValue`, `newValue`, `occurredAt` and `actorId`. The natural join key for any future unified stream is stored and not exposed. | P1-17 | — | Publish `correlationId` on the history projection. It is the cheapest available step towards `VHM-01`. |
| `VHM-18` | No read of `inv.external_purchase_parts` or of any other inventory operation record except stock movements and reconciliations. The external-purchases section cannot be populated. | P1-21 | — | Publish a keyset read filtered by work order. |
| `VHM-19` | `GET /vehicle-duplicates` is tenant-wide with no vehicle filter, so a vehicle-scoped duplicate section cannot be built without scanning every page. | P1-17 | — | Add an optional vehicle filter to the duplicate-candidate list. Constrained by the open `P1-OD-017`. |
| `VHM-20` | Ten vehicle tables have no read operation at all: `vehicle_identifiers`, `vin_verifications`, `engine_history`, `transmission_history`, `relationship_evidence`, `vehicle_status_history`, `vehicle_alerts`, `battery_masters`, `battery_readings`, `vehicle_merges`. | P1-17 | — | Triage against real need. Two are already registered as `P1-17-A-01` (the `iam.sensitive.view`-gated identifier read that the domain promises and does not exist) and `P1-17-A-02` (`veh.vehicle_alerts` has no route). `VHM-02` covers `vehicle_status_history`. |

**Twenty findings.** Nine of the twenty are read-surface gaps that a single owning phase
could close; `VHM-03` alone unblocks the largest number of sections; `VHM-01` and `VHM-15`
are design decisions rather than omissions and should be taken by the Owner before any
phase implements around them.

---

## 11. Sources read

Every claim above traces to one of these. Paths are repository-relative.

| area | files |
| ---- | ----- |
| vehicle history contract | `apps/api/src/modules/vehicle/domain/vehicle-history.ts`, `apps/api/src/modules/vehicle/data/vehicle-history-repository.ts`, `apps/api/src/modules/vehicle/application/vehicle-history-service.ts` |
| vehicle domain | `domain/vehicle-search.ts`, `domain/vehicle-lifecycle.ts`, `domain/vehicle-registration.ts`, `domain/vehicle-relations.ts`, `domain/vehicle-odometer.ts`, `application/vehicle-read-service.ts`, `data/vehicle-read-repository.ts` |
| vehicle routes | all fourteen route modules under `apps/api/src/app/api/v1/vehicles/` |
| web-side contract | `apps/web/src/features/vehicles/duplicates-contract.ts` |
| work order | `apps/api/src/app/api/v1/work-orders/route.ts`, `apps/api/src/app/api/v1/additional-work/[requestId]/approval/route.ts`, `apps/api/src/modules/work-order/data/work-order-repository.ts` |
| technician and labour | `apps/api/src/modules/technician/domain/technician.ts`, `apps/api/src/modules/technician/application/labor-session-service.ts` |
| diagnostics | `apps/api/src/modules/diagnostics/domain/diagnostics.ts` |
| reception | `apps/api/src/modules/reception/domain/reception-evidence.ts` |
| documents | `apps/api/src/app/api/v1/attachments/documents/[documentId]/links/route.ts` |
| cross-cutting contracts | `apps/api/src/server/db/pagination.ts`, `apps/api/src/modules/pricing/domain/money.ts` |
| permissions | `supabase/seeds/04_iam_permission_catalog.sql` |
| state graphs | `supabase/seeds/06_wo_job_state_graph.sql` |
| schema | `supabase/migrations/20260720095000_veh_vehicle_attribute_history.sql`, `20260720102000_veh_vehicle_status_history.sql`, `20260719102000_crm_communication_timeline.sql`, `20260718096000_shared_status_history.sql`, `20260718102000_shared_document_links.sql`, `20260721100000_rec_inspections_conditions.sql`, `20260722093000_dia_qms_catalogs.sql`, `20260722095000_wo_work_orders.sql`, `20260722099000_tech_labor_sessions.sql`, `20260722100000_wo_services_parts_approvals.sql`, `20260722101000_dia_templates_versions_items.sql` |
| phase context | `docs/phase-1/phase-1-27/canonical-plan.md`, `docs/phase-1/phase-1-27/findings.md`, `docs/phase-1/phase-1-1/open-decisions.md` |
