# Owner workshop requirements — the carry-forward register

**Company:** RootLco — Root Link Company · **Classification:** Confidential —
Commercial Product and Pilot Planning · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Established:** 2026-08-08 at `develop` `bd9f7f54bccc61e6ed2497cb3f2fc556850c11eb`

This is the durable canonical record of **every requirement the Product Owner has
stated**, each assigned to the phase that owns it. It exists because the Owner
described the complete workshop journey while Phase 1-27 was still open, and the
programme briefly tried to build all of it under P1-27. That was the wrong
boundary — but not one requirement is dropped by correcting it.

## How to read the Status column

| Status         | Meaning                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| **Delivered**  | Built, merged into protected `develop`, and verified by evidence named in the phase's own records |
| **Contracted** | The Backend contract exists and is proven; no Frontend consumes it yet                            |
| **Blocked**    | The owning phase cannot build it because a named contract does not exist                          |
| **Planned**    | Owned, scoped, not started                                                                        |
| **Undecided**  | Needs a Product Owner commercial or business-rule decision before it can be scoped                |

**Documented is not implemented.** A requirement appearing in this register means
it is _recorded and owned_, never that it is finished. Nothing below is marked
Delivered on the strength of its presence here.

## The phase boundaries this register enforces

| Phase                | Boundary                                                       |
| -------------------- | -------------------------------------------------------------- |
| **P1-27**            | CRM and Vehicle Frontend                                       |
| **P1-28**            | Appointment and Vehicle Reception Frontend                     |
| **P1-29**            | Work Order, Diagnostics and Technician Frontend                |
| **P1-30**            | Services, Quotations, Inventory, Billing and Payments Frontend |
| **P1-31**            | Vehicle Delivery, Warranty and Reporting Frontend              |
| **Integration gate** | Prove the complete end-to-end journey across all of them       |

A requirement is implemented in the phase that owns it. Never earlier because it
was discovered earlier; never later because the phase that owns it is
inconvenient.

---

## P1-27 — CRM and Vehicles

The canonical scope: CRM 16, Vehicles 13, Security 4, QA 5, DevOps 2,
Documentation 2 — **42 tasks**.

> **Correction, 2026-08-08.** The first version of this table marked rows 1, 2,
> 15, 21, 22, 23, 24, 25 and 29 **Delivered**. That was wrong. The final canonical
> audit found four defects across nine of the 42 tasks — writes that are
> registered and permission-covered but have **no call site in `apps/web`**, two
> surfaces rendering a raw UUID under a person-named column, and a customer-search
> cursor that still loses rows. Those rows now read **Blocked (P1-27)** and are
> the phase's own work to close. The detail is in
> [`../phase-1/phase-1-27/finding-phase-disposition.md`](../phase-1/phase-1-27/finding-phase-disposition.md).
>
> The status column was written from the phase's task register, which recorded
> those tasks as shipped. The register was describing merged code; it was not
> evidence that the code is reachable from a screen. That distinction is the whole
> defect, and repeating the register's claim here without checking was the same
> error one level up.

| #   | Requirement                                                            | Status                                           |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Customer search                                                        | Blocked (P1-27) — cursor row loss                |
| 2   | Customer search results                                                | Blocked (P1-27) — cursor row loss                |
| 3   | Duplicate warning on create                                            | Delivered                                        |
| 4   | Add Individual Customer — prominent action                             | Delivered                                        |
| 5   | Add Company Customer — prominent action                                | Delivered                                        |
| 6   | Structured customer profile                                            | Delivered                                        |
| 7   | Contacts                                                               | Delivered                                        |
| 8   | Addresses                                                              | Delivered                                        |
| 9   | Preferences                                                            | Delivered                                        |
| 10  | Consents                                                               | Delivered                                        |
| 11  | Notes                                                                  | Delivered                                        |
| 12  | Alerts                                                                 | Delivered                                        |
| 13  | Tags                                                                   | Delivered                                        |
| 14  | Restrictions                                                           | Delivered                                        |
| 15  | Customer timeline / history                                            | Blocked (P1-27) — actor UUID shown               |
| 16  | Customer duplicate review                                              | Delivered                                        |
| 17  | Vehicle search                                                         | Delivered                                        |
| 18  | Vehicle creation                                                       | Delivered                                        |
| 19  | Vehicle profile                                                        | Delivered                                        |
| 20  | VIN validation within the approved contract                            | Delivered                                        |
| 21  | Ownership                                                              | Blocked (P1-27) — write not called               |
| 22  | Current plate and plate history                                        | Blocked (P1-27) — write not called               |
| 23  | Odometer history                                                       | Blocked (P1-27) — write not called               |
| 24  | EV / hybrid information                                                | Blocked (P1-27) — write not called               |
| 25  | Customer relationships on the Vehicle                                  | Blocked (P1-27) — write not called; partner UUID |
| 26  | Vehicle documents                                                      | Delivered                                        |
| 27  | Vehicle media foundation — decision-neutral, `P1-OD-025` authoritative | Delivered                                        |
| 28  | Vehicle duplicate review                                               | Delivered                                        |
| 29  | Vehicle history / timeline                                             | Blocked (P1-27) — actor UUID shown               |

Every row above is re-verified by the final P1-27 audit before the gate is
written; the Status column is not the evidence, the audit is.

### Shared UX the Owner corrected, and which must stay true

These were raised against P1-27 but are P1-26/P1-27 **shared foundations**. They
are re-verified at every P1-27 acceptance.

| Requirement                                                                                            | Status                                           |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Password show/hide eye **inside** the password field; no separate button below it                      | Delivered                                        |
| Sidebar scrolls internally; its scrollbar is subtle, not permanently intrusive                         | Delivered                                        |
| Sidebar parent groups (e.g. Administration) carry a visible chevron                                    | Delivered                                        |
| Sidebar groups expand and collapse smoothly; active-child behaviour correct                            | Delivered                                        |
| Duplicate queues use human-readable names, not entity names                                            | Delivered                                        |
| Duplicate reasons explained in ordinary business language                                              | Delivered                                        |
| No JSON, no raw `matchBasis`, no raw enum, no UUID as a normal label                                   | Blocked (P1-27) — three surfaces show a raw UUID |
| No `string` / `boolean` / `payload` / `object` / `enum` / `null` or database vocabulary in ordinary UX | Delivered                                        |
| Arabic and English available; RTL and LTR correct                                                      | Delivered                                        |
| Language can be changed while authenticated                                                            | Delivered                                        |
| Global notifications visible regardless of scroll position                                             | Delivered                                        |
| Main document blank overscroll absent                                                                  | Delivered                                        |
| Tables bounded and server-driven                                                                       | Delivered                                        |
| Customer and Vehicle screens use normal workshop language                                              | Delivered                                        |

### The customer–vehicle relationship, at the P1-27 boundary

The Owner's permanent requirement — **one customer may have multiple vehicles** —
is recorded here and consumed by P1-28.

Within P1-27 the Vehicle profile shows its approved customer relationships with
human-readable customer information and the relationship role, and cross-tenant
relationships are impossible.

The **Customer → Vehicles** direction is a different matter. `crm.vehicle-link`
writes the relationship at `POST /customers/{customerId}/vehicles`; that path
publishes no `GET`, and the only relationship read runs from the vehicle side. So
a "this customer's vehicles" section cannot be built without inventing a read in
the Frontend, which is forbidden.

That is recorded as a **P1-28 prerequisite** (`P1-27-INT-012`), owned by P1-16
Backend. It is **not** a P1-27 failure: selecting a customer's vehicle to begin a
reception is P1-28's journey, not P1-27's.

---

## P1-28 — Appointment and Vehicle Reception

The Owner's mandatory intake workflow, in the order the Owner stated it. All
**Planned** unless a stronger status is shown.

| #   | Requirement                                                                                                             | Status                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Vehicle arrives — appointment or walk-in                                                                                | Planned                                                                  |
| 2   | Search or create the customer                                                                                           | Planned                                                                  |
| 3   | **Show the customer's vehicles**                                                                                        | **Blocked** — no read lists them (`INT-012`)                             |
| 4   | A customer may have multiple vehicles                                                                                   | Planned                                                                  |
| 5   | Select the correct vehicle **explicitly**                                                                               | Planned                                                                  |
| 6   | Create or link a new vehicle when necessary                                                                             | Planned                                                                  |
| 7   | Start appointment / walk-in / reception                                                                                 | Contracted                                                               |
| 8   | Confirm customer and vehicle                                                                                            | Planned                                                                  |
| 9   | Capture customer-reported concerns                                                                                      | Contracted                                                               |
| 10  | Mark those concerns **"Not yet technically verified"**                                                                  | Planned                                                                  |
| 11  | Capture reception condition                                                                                             | Contracted                                                               |
| 12  | Seven exterior photos: front, rear, front-left, front-right, rear-left, rear-right, approved seventh overall/roof angle | **Blocked** — media upload unsupported (`INT-093`, `INT-094`, `INT-095`) |
| 13  | Dashboard photo showing odometer, SOC for EV/hybrid, fuel where applicable, visible warning lights                      | **Blocked** — same                                                       |
| 14  | VIN / chassis photo on first visit, or when existing evidence is missing or unreadable                                  | **Blocked** — same                                                       |
| 15  | Initial computer diagnostic scan evidence where available                                                               | Planned                                                                  |
| 16  | Conditional road test                                                                                                   | **Blocked** — road test exists nowhere in the platform (`INT-054`)       |
| 17  | Road-test duration may range ~5 minutes to ~1 hour by vehicle condition                                                 | Planned                                                                  |
| 18  | Road-test observations                                                                                                  | Blocked — same as 16                                                     |
| 19  | Unsafe-to-road-test outcome                                                                                             | Blocked — same as 16                                                     |
| 20  | Lift inspection                                                                                                         | Blocked — same as 16                                                     |
| 21  | Lift-inspection observations and evidence                                                                               | Blocked — same as 16                                                     |
| 22  | Damage map                                                                                                              | Contracted                                                               |
| 23  | Vehicle contents                                                                                                        | Contracted                                                               |
| 24  | Party roles                                                                                                             | **Blocked** — no read publishes a visit's party roles (`INT-015`)        |
| 25  | Reception officer final observations                                                                                    | Planned                                                                  |
| 26  | Separate **customer statement**, **technical observation** and **confirmed diagnosis**                                  | Planned                                                                  |
| 27  | Signature                                                                                                               | Contracted                                                               |
| 28  | Refusal workflow                                                                                                        | Contracted                                                               |
| 29  | Reception summary                                                                                                       | Planned                                                                  |
| 30  | Reception document                                                                                                      | Planned                                                                  |
| 31  | Accept vehicle into custody                                                                                             | Contracted                                                               |
| 32  | Convert approved reception into a work order                                                                            | Contracted                                                               |

### The operational property P1-28 must satisfy

**A reception must be resumable.** It may not depend on one unbroken browser
session, and another authorised employee must be able to continue an existing
reception.

Today it cannot be. Reception publishes twelve operations and every one is a
`POST` — there is no detail read and no list. Two of the writes are
`versionGuarded` with mandatory `If-Match`, and the only source of a visit's
`recordVersion` is the response of a write the caller just performed. Close the
browser and the vehicle is in custody with no path forward.

Closing that is a **P1-28 readiness blocker**, owned by P1-18 Backend, with a
verified implementation plan already committed at
[`../phase-1/phase-1-27/reception-read-surface-plan.md`](../phase-1/phase-1-27/reception-read-surface-plan.md).
It covers `INT-010`, `-011`, `-015`, `-016`, `-017` and `-021`.

### Two data-model questions P1-28 must answer

**A. `receiving_employee_id` has no foreign key.** Verified: the column exists on
`rec.reception_visits`, appears in the immutability trigger's column list and in
`rec.accept_check_in`'s parameters, and carries **no `REFERENCES` clause
anywhere** in `supabase/`. There is no table it is guaranteed to resolve against,
so no employee name can be joined honestly. Normal users must see a name, not a
UUID — so this needs the smallest correct data-model remediation, not an invented
join.

**B. `rec.reception.read` would be holdable by nobody.** No seed maps any `rec.`
permission code to any role. Authorised reception staff must be able to read and
resume a reception; granting it to everyone is not the answer. P1-28 defines the
least-privilege mapping against the real authorisation model and adds an
owner/reception account, a read-only negative control and a cross-tenant negative
control.

P1-28 must not expose UUIDs or technical entity names to workshop users.

---

## P1-29 — Work Order, Diagnostics and Technicians

| Requirement                                                                                                                                                                                                                                                        | Status                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| The work order becomes the central operational record after reception                                                                                                                                                                                              | Planned                                                                     |
| Work order tied to the selected customer and vehicle                                                                                                                                                                                                               | **Blocked** — a work order names no customer (`INT-036`)                    |
| Multiple departments may work on one vehicle                                                                                                                                                                                                                       | **Blocked** — departments exist nowhere (`INT-042`)                         |
| Configurable departments: mechanical; electrical; air conditioning / cooling; road testing; routine service; software / programming updates; diagnostic equipment; wiring-diagram investigation; cooling-system cleaning; A/C gas service; other tenant-configured | Blocked — same                                                              |
| Assign named employees and technicians                                                                                                                                                                                                                             | **Blocked** — no technician profile operation exists (`INT-045`, `INT-047`) |
| Notify the assigned employee: "This vehicle has been assigned to you"                                                                                                                                                                                              | **Blocked** — no module raises a notification (`INT-100`)                   |
| Start / pause / resume / complete a task                                                                                                                                                                                                                           | Partly blocked — no pause or resume (`INT-048`)                             |
| Progressive work logging                                                                                                                                                                                                                                           | **Blocked** — no work-log table or action vocabulary (`INT-049`)            |
| Diagnostic findings                                                                                                                                                                                                                                                | Contracted                                                                  |
| Computer scan                                                                                                                                                                                                                                                      | Planned                                                                     |
| Technician diagnosis                                                                                                                                                                                                                                               | Contracted                                                                  |
| Work evidence                                                                                                                                                                                                                                                      | Blocked — media (`INT-093`…`INT-095`)                                       |
| Blockers                                                                                                                                                                                                                                                           | Planned                                                                     |
| Additional-work request                                                                                                                                                                                                                                            | Contracted                                                                  |
| Submit for QA                                                                                                                                                                                                                                                      | Contracted                                                                  |
| Complete work-order history                                                                                                                                                                                                                                        | Partly contracted — sectioned, not unified (`INT-043`)                      |

---

## P1-30 — Services, Quotations, Inventory, Billing and Payments

| Requirement                                                             | Status                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Service catalogue                                                       | **Blocked** — no service can be created; no category exists (`INT-055`)                 |
| Labour                                                                  | Contracted                                                                              |
| Work pricing                                                            | **Blocked** — no price-list assignment write, so every quotation line fails (`INT-057`) |
| Internal inventory parts                                                | Partly blocked — `locationId` required, no location list (`INT-066`)                    |
| Part issue                                                              | Contracted                                                                              |
| Part return                                                             | Partly blocked — remaining returnable quantity not computable (`INT-067`)               |
| Part consumption                                                        | Contracted                                                                              |
| External part request                                                   | Contracted                                                                              |
| External supplier                                                       | **Blocked** — no supplier master (`INT-075`)                                            |
| Expected / approved / final cost                                        | Partly blocked — parts cost readable by nothing (`INT-070`)                             |
| External part receipt                                                   | **Blocked** — external parts have no read at all (`INT-073`, `INT-074`)                 |
| Quotation                                                               | **Blocked** — no quotation list of any kind (`INT-060`)                                 |
| Customer approval                                                       | Partly blocked — decisions unreadable (`INT-061`)                                       |
| Additional-work approval                                                | **Blocked** — needs a party-role id no operation publishes (`INT-015`)                  |
| Discounts where authorised                                              | Partly blocked — no discount-rule surface (`INT-062`)                                   |
| Decimal-string money, ISO currency codes                                | Delivered — platform-wide invariant, gate-enforced                                      |
| Accounting handoff                                                      | Planned                                                                                 |
| Invoice                                                                 | Partly blocked — no invoice list; untaxed (`INT-083`, `INT-090`)                        |
| Payment state — paid / partially paid / unpaid **only where supported** | Partly blocked — no payment list (`INT-085`, `INT-091`)                                 |

---

## P1-31 — QA, Delivery, Warranty and Reporting

| Requirement                                                  | Status                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Technician completion does not mean the vehicle is ready** | Planned                                                                                                               |
| Final QA checklist                                           | **Blocked** — `qms.qc_checks` has no operation and no seed (`INT-077`)                                                |
| QA employee                                                  | Blocked — no technician identity (`INT-047`)                                                                          |
| QA evidence                                                  | Blocked — media                                                                                                       |
| QA failure                                                   | Contracted                                                                                                            |
| Rework                                                       | Contracted                                                                                                            |
| Reassignment                                                 | Contracted                                                                                                            |
| QA re-check                                                  | Contracted                                                                                                            |
| QA pass                                                      | Contracted                                                                                                            |
| Payment / delivery-policy verification                       | Contracted                                                                                                            |
| Delivery checklist                                           | Partly blocked — checklist not renderable (`INT-088`)                                                                 |
| Final vehicle condition                                      | Planned                                                                                                               |
| Customer handover                                            | Contracted                                                                                                            |
| Delivery timestamp                                           | Contracted                                                                                                            |
| Delivery employee                                            | Blocked — no employee identity                                                                                        |
| Warranty                                                     | Contracted                                                                                                            |
| Reports                                                      | **Blocked until #206** — the two report operations returned 500 to every request (`INT-113`); now fixed and reachable |
| Complete delivery history                                    | Partly blocked — delivery id and version unrecoverable (`INT-084`)                                                    |

---

## Cross-phase — the three histories

A permanent requirement, owned by the integration gate rather than any one phase.

- **Customer history** — aggregates all of that customer's vehicles, visits, work
  orders and permitted commercial and service events.
- **Vehicle history** — all visits, plates, odometer readings, reception evidence,
  diagnostics, work, parts, QA and delivery across time.
- **Work order history** — the transactional history of one repair or service
  order.

**These must not become three independently mutable copies.** They are views over
authoritative records, events and relationships. Today `crm.timeline_events` is
the only real emitting ledger; the vehicle has five separately-ordered sections
and no timeline table (`INT-104`); the work order has its own status ledger and
its children hang off different identifiers (`INT-043`). The only cross-domain
chronological read on the whole surface is the audit log, which audits every read
of itself and is not a timeline.

---

## Cross-phase — the vehicle catalogue

A permanent Product Owner requirement. Vehicle creation must eventually support a
professional selection chain:

**Make → Model year → Model → Generation where available → Trim → Body type →
Powertrain → Engine/motor specification where available**

Target market expectation: **model year 2010 onward.**

Required: search; human-readable make and model; **brand logo only where legally
licensed**; **vehicle image only where legally licensed**; body type (SUV, sedan
and so on); powertrain class (EV, hybrid, PHEV, ICE).

**Manual fallback is mandatory** — for older vehicles, imported vehicles, rare
vehicles, missing catalogue entries, vehicles with no standard VIN, and provider
outage.

**Do not claim every vehicle on Earth is covered** until a licensed provider and
measured coverage prove it.

Provider integration must be **server-side, licensed, cached, source-attributed
and provider-abstracted**. Never scrape websites. Never call a third-party
catalogue API directly from the browser.

**Status: Undecided.** Choosing the commercial provider is a Product Owner
financial decision. Until it is made, vehicle creation uses the delivered
`veh` catalogue with manual entry, which is the decision-neutral position.

---

## What this register is for

Two failure modes, and this document exists against both.

**Forgetting.** The Owner stated the whole journey once. Anything not written
down here would survive only in a conversation.

**Building in the wrong phase.** A requirement discovered during P1-27 belongs to
whichever phase owns it. Recording ownership here is what makes it safe to close
P1-27 without losing the rest — and what stops any of it drifting backwards into
a phase that has already closed.
