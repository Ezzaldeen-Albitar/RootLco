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

| #   | Requirement                                                            | Status                                      |
| --- | ---------------------------------------------------------------------- | ------------------------------------------- |
| 1   | Customer search                                                        | Delivered (D4 cursor precision, PR #197)    |
| 2   | Customer search results                                                | Delivered (D4 cursor precision, PR #197)    |
| 3   | Duplicate warning on create                                            | Delivered                                   |
| 4   | Add Individual Customer — prominent action                             | Delivered                                   |
| 5   | Add Company Customer — prominent action                                | Delivered                                   |
| 6   | Structured customer profile                                            | Delivered                                   |
| 7   | Contacts                                                               | Delivered                                   |
| 8   | Addresses                                                              | Delivered                                   |
| 9   | Preferences                                                            | Delivered                                   |
| 10  | Consents                                                               | Delivered                                   |
| 11  | Notes                                                                  | Delivered                                   |
| 12  | Alerts                                                                 | Delivered                                   |
| 13  | Tags                                                                   | Delivered                                   |
| 14  | Restrictions                                                           | Delivered                                   |
| 15  | Customer timeline / history                                            | Delivered, with a stated gap (see note)     |
| 16  | Customer duplicate review                                              | Delivered                                   |
| 17  | Vehicle search                                                         | Delivered                                   |
| 18  | Vehicle creation                                                       | Delivered                                   |
| 19  | Vehicle profile                                                        | Delivered                                   |
| 20  | VIN validation within the approved contract                            | Delivered                                   |
| 21  | Ownership                                                              | Delivered (D1 reachability, 23/27)          |
| 22  | Current plate and plate history                                        | Delivered (D1 reachability, 23/27)          |
| 23  | Odometer history                                                       | Delivered (D1 reachability, 23/27)          |
| 24  | EV / hybrid information                                                | Delivered (D1 reachability, 23/27)          |
| 25  | Customer relationships on the Vehicle                                  | Delivered (D1 + D2 partner naming, PR #213) |
| 26  | Vehicle documents                                                      | Delivered                                   |
| 27  | Vehicle media foundation — decision-neutral, `P1-OD-025` authoritative | Delivered                                   |
| 28  | Vehicle duplicate review                                               | Delivered                                   |
| 29  | Vehicle history / timeline                                             | Delivered (D3 actor naming, PR #212)        |

Every row above is re-verified by the final P1-27 audit before the gate is
written; the Status column is not the evidence, the audit is.

### Shared UX the Owner corrected, and which must stay true

These were raised against P1-27 but are P1-26/P1-27 **shared foundations**. They
are re-verified at every P1-27 acceptance.

| Requirement                                                                                            | Status                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Password show/hide eye **inside** the password field; no separate button below it                      | Delivered                            |
| Sidebar scrolls internally; its scrollbar is subtle, not permanently intrusive                         | Delivered                            |
| Sidebar parent groups (e.g. Administration) carry a visible chevron                                    | Delivered                            |
| Sidebar groups expand and collapse smoothly; active-child behaviour correct                            | Delivered                            |
| Duplicate queues use human-readable names, not entity names                                            | Delivered                            |
| Duplicate reasons explained in ordinary business language                                              | Delivered                            |
| No JSON, no raw `matchBasis`, no raw enum, no UUID as a normal label                                   | Delivered — see the D2/D3 note below |
| No `string` / `boolean` / `payload` / `object` / `enum` / `null` or database vocabulary in ordinary UX | Delivered                            |
| Arabic and English available; RTL and LTR correct                                                      | Delivered                            |
| Language can be changed while authenticated                                                            | Delivered                            |
| Global notifications visible regardless of scroll position                                             | Delivered                            |
| Main document blank overscroll absent                                                                  | Delivered                            |
| Tables bounded and server-driven                                                                       | Delivered                            |
| Customer and Vehicle screens use normal workshop language                                              | Delivered                            |

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

| #   | Requirement                                                                                                             | Status                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Vehicle arrives — appointment or walk-in                                                                                | Planned                                                                                                                 |
| 2   | Search or create the customer                                                                                           | Planned                                                                                                                 |
| 3   | **Show the customer's vehicles**                                                                                        | Delivered — `crm.customer-vehicle-list` (P1-16 remediation) and the P1-27/P1-28 screens; row refreshed 2026-09-06 (H-2) |
| 4   | A customer may have multiple vehicles                                                                                   | Planned                                                                                                                 |
| 5   | Select the correct vehicle **explicitly**                                                                               | Planned                                                                                                                 |
| 6   | Create or link a new vehicle when necessary                                                                             | Planned                                                                                                                 |
| 7   | Start appointment / walk-in / reception                                                                                 | Contracted                                                                                                              |
| 8   | Confirm customer and vehicle                                                                                            | Planned                                                                                                                 |
| 9   | Capture customer-reported concerns                                                                                      | Contracted                                                                                                              |
| 10  | Mark those concerns **"Not yet technically verified"**                                                                  | Planned                                                                                                                 |
| 11  | Capture reception condition                                                                                             | Contracted                                                                                                              |
| 12  | Seven exterior photos: front, rear, front-left, front-right, rear-left, rear-right, approved seventh overall/roof angle | **Blocked** — media upload unsupported (`INT-093`, `INT-094`, `INT-095`)                                                |
| 13  | Dashboard photo showing odometer, SOC for EV/hybrid, fuel where applicable, visible warning lights                      | **Blocked** — same                                                                                                      |
| 14  | VIN / chassis photo on first visit, or when existing evidence is missing or unreadable                                  | **Blocked** — same                                                                                                      |
| 15  | Initial computer diagnostic scan evidence where available                                                               | Planned                                                                                                                 |
| 16  | Conditional road test                                                                                                   | **Blocked** — road test exists nowhere in the platform (`INT-054`)                                                      |
| 17  | Road-test duration may range ~5 minutes to ~1 hour by vehicle condition                                                 | Planned                                                                                                                 |
| 18  | Road-test observations                                                                                                  | Blocked — same as 16                                                                                                    |
| 19  | Unsafe-to-road-test outcome                                                                                             | Blocked — same as 16                                                                                                    |
| 20  | Lift inspection                                                                                                         | Blocked — same as 16                                                                                                    |
| 21  | Lift-inspection observations and evidence                                                                               | Blocked — same as 16                                                                                                    |
| 22  | Damage map                                                                                                              | Contracted                                                                                                              |
| 23  | Vehicle contents                                                                                                        | Contracted                                                                                                              |
| 24  | Party roles                                                                                                             | **Blocked** — no read publishes a visit's party roles (`INT-015`)                                                       |
| 25  | Reception officer final observations                                                                                    | Planned                                                                                                                 |
| 26  | Separate **customer statement**, **technical observation** and **confirmed diagnosis**                                  | Planned                                                                                                                 |
| 27  | Signature                                                                                                               | Contracted                                                                                                              |
| 28  | Refusal workflow                                                                                                        | Contracted                                                                                                              |
| 29  | Reception summary                                                                                                       | Planned                                                                                                                 |
| 30  | Reception document                                                                                                      | Planned                                                                                                                 |
| 31  | Accept vehicle into custody                                                                                             | Contracted                                                                                                              |
| 32  | Convert approved reception into a work order                                                                            | Contracted                                                                                                              |

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

| Requirement                                                                                                                                                                                                                                                        | Status                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The work order becomes the central operational record after reception                                                                                                                                                                                              | Planned                                                                                                                                                                                                                                                            |
| Work order tied to the selected customer and vehicle                                                                                                                                                                                                               | **Blocked** — a work order names no customer (`INT-036`)                                                                                                                                                                                                           |
| Multiple departments may work on one vehicle                                                                                                                                                                                                                       | **Blocked** — departments exist nowhere (`INT-042`)                                                                                                                                                                                                                |
| Configurable departments: mechanical; electrical; air conditioning / cooling; road testing; routine service; software / programming updates; diagnostic equipment; wiring-diagram investigation; cooling-system cleaning; A/C gas service; other tenant-configured | Blocked — same                                                                                                                                                                                                                                                     |
| Assign named employees and technicians                                                                                                                                                                                                                             | Delivered — `tech.technician-*` (BR-03) and P1-29 job assignment (`job-assignment-service.ts`); row refreshed 2026-09-06 (C-3)                                                                                                                                     |
| Notify the assigned employee: "This vehicle has been assigned to you"                                                                                                                                                                                              | Contracted — the work-order module raises `job.assigned` → `prepareNotification` (`job_assigned_notification`, in-app + email), consumed by the worker; silent until a tenant authors the template, none ships; `INT-100` answered; row refreshed 2026-09-06 (A-7) |
| Start / pause / resume / complete a task                                                                                                                                                                                                                           | Partly blocked — no pause or resume (`INT-048`)                                                                                                                                                                                                                    |
| Progressive work logging                                                                                                                                                                                                                                           | **Blocked** — no work-log table or action vocabulary (`INT-049`)                                                                                                                                                                                                   |
| Diagnostic findings                                                                                                                                                                                                                                                | Contracted                                                                                                                                                                                                                                                         |
| Computer scan                                                                                                                                                                                                                                                      | Planned                                                                                                                                                                                                                                                            |
| Technician diagnosis                                                                                                                                                                                                                                               | Contracted                                                                                                                                                                                                                                                         |
| Work evidence                                                                                                                                                                                                                                                      | Blocked — media (`INT-093`…`INT-095`)                                                                                                                                                                                                                              |
| Blockers                                                                                                                                                                                                                                                           | Planned                                                                                                                                                                                                                                                            |
| Additional-work request                                                                                                                                                                                                                                            | Contracted                                                                                                                                                                                                                                                         |
| Submit for QA                                                                                                                                                                                                                                                      | Contracted                                                                                                                                                                                                                                                         |
| Complete work-order history                                                                                                                                                                                                                                        | Partly contracted — sectioned, not unified (`INT-043`)                                                                                                                                                                                                             |

---

## P1-30 — Services, Quotations, Inventory, Billing and Payments

| Requirement                                                             | Status                                                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Service catalogue                                                       | Delivered — A1 (#311) category/version writers, W1 (#314) screen; `INT-055` closed                                                             |
| Labour                                                                  | Contracted                                                                                                                                     |
| Work pricing                                                            | Delivered — A1 (#311) assignment writer, W2 (#315) screen; `INT-057` closed                                                                    |
| Internal inventory parts                                                | Contracted — location list (A2 S-16) and the item/category/location writers (#322); the setup and opening-stock screens are owed (CC-05)       |
| Part issue                                                              | Delivered — W5 (#318) parts screen (issue against reservation or free); row refreshed 2026-09-06 (B)                                           |
| Part return                                                             | Delivered — W5 (#318); the `returnedQty` scale inconsistency is deferred with an owner (CC-07)                                                 |
| Part consumption                                                        | Delivered — W5 (#318): an issue consumes its reservation and posts the out-movement; row refreshed 2026-09-06 (B)                              |
| External part request                                                   | Contracted                                                                                                                                     |
| External supplier                                                       | **Blocked** — no supplier master (`INT-075`)                                                                                                   |
| Expected / approved / final cost                                        | Partly blocked — parts cost readable by nothing (`INT-070`)                                                                                    |
| External part receipt                                                   | **Blocked** — external parts have no read at all (`INT-073`, `INT-074`)                                                                        |
| Quotation                                                               | Delivered — A2 S-07 per-work-order list, W3 (#316) screens; `INT-060` closed                                                                   |
| Customer approval                                                       | Delivered — W3 (#316) decision display and record; `INT-061` closed                                                                            |
| Additional-work approval                                                | **Blocked** — needs a party-role id no operation publishes (`INT-015`)                                                                         |
| Discounts where authorised                                              | Partly blocked — a discounted line works once an approval limit exists (shipped screen); `svc.discount_rules` stays dormant (CC-06, `INT-062`) |
| Decimal-string money, ISO currency codes                                | Delivered — platform-wide invariant, gate-enforced                                                                                             |
| Accounting handoff                                                      | Planned                                                                                                                                        |
| Invoice                                                                 | Partly blocked — W6 (#319) preview/issue/print delivered; no invoice list (`INT-083`) and untaxed until a tax writer exists (CC-06, `INT-090`) |
| Payment state — paid / partially paid / unpaid **only where supported** | Delivered — A2 S-11 receipt list, W7 (#320) form/allocation/receipt/print; `INT-085`, `INT-091` closed                                         |

---

## P1-31 — QA, Delivery, Warranty and Reporting

| Requirement                                                  | Status                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Technician completion does not mean the vehicle is ready** | Planned                                                                                                               |
| Final QA checklist                                           | **Blocked** — `qms.qc_checks` has no operation and no seed (`INT-077`)                                                |
| QA employee                                                  | Delivered — technician identity via `tech.technician_profiles.user_id` (BR-03); row refreshed 2026-09-06 (C-3)        |
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

## Owner requirements recorded 2026-09-06 — nine areas

On 2026-09-06 the Owner stated nine further requirement areas. Each was grounded against the
repository at protected `develop` `6f6236c3` and is recorded line by line — Owner wording,
normalised behaviour, existing evidence with its file and line, remaining gap, owning module,
delivery placement, dependencies and observable acceptance criteria, and whether the line is an
**Owner requirement** or a **proposed implementation policy** — in
`owner-requirements-2026-09-06.md`. Dated identifiers (`OWR-2026-09-06-<area>-<n>`) mark the
genuinely new requirements; where an existing row of this register already covered a line, that
row is named instead and its Status refreshed above. The change-control dispositions are in
`../phase-1/phase-1-30/change-control-2026-09-06.md`.

Statuses below count the lines in each area. **Documented is not implemented.** Each area was
checked by an independent completeness critique on 2026-09-06 (coverage, evidence, placement,
invented numbers); the corrections — re-anchoring to the measured head, citation fixes, status
relabels to this register's vocabulary, and seven added lines — are applied in place in the
companion document, which is committed on the branch that carries #322 and states so per line.

| area | title                                             | lines | Delivered | Contracted | Blocked | Planned | Undecided | where it lands                                                                                                                                                                                                              |
| ---- | ------------------------------------------------- | ----- | --------- | ---------- | ------- | ------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Intelligence and dashboards                       | 21    | 0         | 2          | 5       | 8       | 6         | the approved operational baseline: P1-31 Backend prerequisite lane + P1-31 reporting UI; broader analytics and prediction: explicit follow-on slices; the metric list is an Owner decision first                            |
| B    | Inventory                                         | 26    | 10        | 1          | 5       | 1       | 9         | present-scope gaps on the P1-30 corrective lanes (#322 and CC-05); transfers, in-transit, supplier returns, cross-company movement and cost lineage: named follow-on Backend slices                                         |
| C    | Stocktaking                                       | 15    | 1         | 0          | 9       | 0       | 5         | a Backend prerequisite on the P1-30 Backend lane, then a P1-30 inventory screen; the cutoff/reconciliation method is an Owner decision                                                                                      |
| D    | Duplicate demand and approvals                    | 13    | 1         | 0          | 1       | 1       | 10        | transport replay safety is delivered; demand detection, justified repeats and their approval are a P1-30 corrective Backend slice with a web half                                                                           |
| E    | Changing costs and prices                         | 19    | 2         | 0          | 8       | 2       | 7         | document snapshots and price-version immutability are delivered; acquisition-cost evidence, movement cost and valuation are the follow-on Backend slice "inventory costing", gated on the Owner's valuation-method decision |
| F    | Vehicle and service knowledge (oil specification) | 12    | 0         | 0          | 4       | 3       | 5         | a named follow-on "vehicle knowledge — fluid specification", gated on the vehicle-catalogue provider decision; manual entry stays mandatory                                                                                 |
| G    | RootLco owner administration                      | 30    | 3         | 3          | 1       | 9       | 14        | a named follow-on "Platform Owner Console" (Backend lane first); seat semantics and the delegation rules are Owner decisions; no price or quota is invented                                                                 |
| H    | Reception workflow and camera/OCR                 | 27    | 9         | 1          | 4       | 10      | 3         | register and capture-policy refresh now; camera capture, assisted VIN/odometer extraction and the confirm/correct step as a named P1-28 corrective slice; the road-test record is still absent everywhere                   |
| I    | AI integration and future ERP                     | 22    | 3         | 0          | 0       | 3       | 16        | an Owner-commissioned evaluation first; the integration as a named follow-on behind a provider port; accounting, HR and rewards as explicit follow-on commitments with named owners                                         |

### Follow-on commitments (named 2026-09-06)

The register rule is that anything beyond Phase 1 is an explicit follow-on commitment with a
name and an owner — never an unnamed "later". The grounding named these; each is Blocked or
Undecided until its Owner decision, and none is scheduled:

| follow-on                               | lines                                     | owner lane                                    | gating decision                                      |
| --------------------------------------- | ----------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| inventory costing                       | E-1/E-2/E-4/E-6/E-7/E-10/E-17, B-19, B-21 | Backend inventory (P1-21) on the P1-30 lane   | E-9 valuation method; E-18 names the decision maker  |
| demand rules and over-issue approval    | D-3..D-8, D-10..D-13; F-6/F-10 inherit    | Backend inventory (P1-21) with work-order     | OD-D-a/b/c (CC-11)                                   |
| stock transfers and transit             | B-3, B-6, B-16                            | Backend inventory                             | Owner scope                                          |
| supplier returns                        | B-12, B-20                                | Backend inventory with billing                | Owner scope; the 'External supplier' row             |
| cross-company movement                  | B-13                                      | Integration gate                              | Owner scope                                          |
| stocktaking (if de-scoped from P1-30)   | C-1..C-15                                 | P1-30 by default (register boundary, line 34) | only an explicit Owner de-scoping moves it here      |
| vehicle knowledge — fluid specification | F-1..F-10                                 | Backend vehicle/service-catalogue             | the vehicle-catalogue provider decision (P1-OD-043)  |
| Platform Owner Console                  | G-1..G-30                                 | Backend platform first                        | seat semantics and delegation rules (G)              |
| tenant structure administration         | G-9                                       | org/IAM Backend                               | Owner scope (Administration, P1-26, is closed)       |
| AI-assisted capture (evaluation first)  | AI-2, AI-P4; H-7..H-11 own the capture    | Backend shared-services provider port         | the Owner-commissioned evaluation; a second use case |
| accounting handoff                      | Accounting handoff (I), AI-11..AI-13      | Owner decision through README §5              | the P1-30/P1-31 billing split (README §6)            |
| reporting execution beyond the baseline | A-1..A-19                                 | P1-31 Backend prerequisite lane, then P1-31   | the Owner's metric list (A-10)                       |

Two findings from the grounding that change this register directly:

- **The "32-step workflow" is the P1-28 table above (rows 1–32).** The end-to-end journey document
  holds twenty-nine steps; the two counts describe different registers, not three lost steps.
- **Reception media capture was delivered and Owner-accepted in P1-28** (closure PASS 2026-08-20) —
  seven exterior photographs as the baseline floor, dashboard and VIN evidence, immutable versions,
  per-visit bindings. What the Owner now requires beyond it — in-app camera capture and assisted
  extraction of VIN and odometer values, with the original image and the extracted candidate both
  preserved, validation against the identifier rules and the odometer history, and staff
  confirmation — does not exist anywhere in the repository, and the P1-28 media suite currently
  bans `getUserMedia`. That is new direction, recorded as such; earlier capture exclusions do not
  remove it.

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
