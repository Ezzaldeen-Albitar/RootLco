# Phase 1-27 — CRM and Vehicle Frontend — canonical plan

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** normalized against repository truth. This document supersedes any
earlier P1-27 plan text. Where the two disagree, this one is correct.

---

## 0. Why this document exists

The P1-27 plan carried stale and ambiguous statements: a product-name
placeholder, an incomplete dependency list, wording that implied visual work was
still blocked, a claim that P1-24 delivers all Backend capability, ambiguous task
titles, mechanically alternating test references, no recorded task total, no
Frontend-specific Owner-acceptance rule, and two open decisions with no stated
disposition.

Each is corrected below under its own heading, so a reader can check the
correction against the thing it corrected.

---

## 1. Product, company, tenant, scope — correction A

| term        | value                           | note                                                                        |
| ----------- | ------------------------------- | --------------------------------------------------------------------------- |
| **Product** | **CRM**                         | Temporary but decided. No placeholder form is authoritative.                |
| **Company** | **RootLco**                     | Unchanged.                                                                  |
| **Benzene** | a **configurable pilot tenant** | Never hard-coded. `validate:no-fake-data` and the Benzene guard enforce it. |
| **Zoom**    | **outside Phase 1**             | The excluded-scope guard enforces it.                                       |

Every authoritative statement that read `[PRODUCT NAME — Pending Final Approval]`
now reads **CRM**. `validate:product-name` is green and 0 placeholder forms
remain in `docs/**`.

**Immutable historical evidence is preserved.** A closed gate record that
correctly recorded the placeholder status _at the time it was written_ is
evidence about that moment and is not rewritten. Correcting it would be falsifying
the record, which is a worse fault than the staleness it would fix.

---

## 2. Dependencies — correction B

P1-27 depends on **five** phases:

| phase     | what P1-27 consumes from it                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **P1-16** | CRM / customer Backend capability.                                                                                                         |
| **P1-17** | Vehicle Backend capability.                                                                                                                |
| **P1-24** | Access-control and route-depth verification; authorization and scope behaviour.                                                            |
| **P1-25** | Frontend architecture and design system.                                                                                                   |
| **P1-26** | Authentication, Administration, shared shell, language, notification, navigation, scroll, table, and the Owner-accepted Frontend baseline. |

**P1-26 is not omitted.** It is the phase that produced the shell every P1-27
screen renders inside, the notification authority every P1-27 action reports
through, and the scroll ownership contract (ADR-021) every P1-27 scroll container
must satisfy. A plan that lists P1-24/25 and not P1-26 would let a P1-27 screen
be built against foundations it does not actually sit on.

---

## 3. Visual decision — correction C

**OIR-06 is resolved.** Any wording implying visual prototypes are still blocked
is withdrawn.

The rule that replaces it:

- The **P1-25 / P1-26 design foundations are binding**.
- P1-27 **composes approved components**.
- P1-27 **must not create a competing design system**.
- New **feature-specific composition is allowed** — a customer profile layout is
  composition, not a new design system.
- **Brand changes require controlled change**, not a P1-27 commit.

The concrete prohibition list, enforced by `validate:web-boundary`,
`validate:web-brand`, `validate:web-tokens` and
`validate:notification-authority`: no second data-table system, notification
system, i18n system, form system, dialog system, API client, brand authority, or
scroll-ownership model.

---

## 4. Backend ownership — correction D

The claim that **all** Backend capability is delivered by P1-24 is **false** and
is withdrawn.

P1-27 consumes:

- **CRM Backend from P1-16.**
- **Vehicle Backend from P1-17.**
- **Authorization and scope behaviour from P1-24** and the authorization phases.

**No new Backend feature development is allowed inside the P1-27 Frontend
branch.** A real Backend defect goes through separate protected remediation:
assign a stable `P1-27-INT-###` finding, identify the owning Backend phase,
branch, add Backend tests, synchronise OpenAPI, merge through protected change
control, reintegrate `develop`, re-run affected evidence.

### 4.1 Backend remediation already executed under this rule

Contract archaeology found that the Backend read surface P1-27 was scoped to
consume **did not exist**. Four remediations were merged before the feature
branch was created:

| finding         | what was missing                                                                                                                                                                                                     | PR   | owning phase  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------- |
| `P1-27-INT-001` | No customer detail read and no GET on any of eight CRM sub-resources. Nothing in 226 operations returned a customer.                                                                                                 | #192 | P1-16         |
| `P1-27-INT-002` | No vehicle detail read. `vehicles/{vehicleId}` exported PATCH only.                                                                                                                                                  | #193 | P1-17         |
| `P1-27-INT-005` | No read for either duplicate-candidate queue. A review screen could only see candidates by POSTing a scan — a privileged write that emits an audit record.                                                           | #194 | P1-16 / P1-17 |
| `P1-27-INT-006` | Not a missing read — a **broken** one. A keyset cursor minted from a JS `Date` loses a `timestamptz` column's microseconds, so the descending predicate silently skips every row sharing the boundary's millisecond. | #195 | P1-16 / P1-17 |

Registry: **226 → 238 operations**. No new permission code and no migration in
any of the four.

Findings that remain open:

| finding         | subject                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `P1-27-INT-003` | The web API client defaults `Idempotency-Key` on **POST only**, so **nine** non-POST idempotent operations answer 400 `ERR-INT-002` — six PUT and, contrary to the client's own docblock, three PATCH including `PATCH /vehicles/{vehicleId}`. **This one IS the Frontend's** and is P1-27 work. |
| `P1-27-INT-004` | `openapi.v1.json` publishes 200 for routes that return 201 and never publishes 400 or 404. Foundation-wide (the generator), not a CRM or Vehicle defect.                                                                                                                                         |
| `P1-27-INT-006` | Closed at 9 sites by #195; **16 pre-existing sites** in other phases still mint a cursor from a JS `Date`, each listed with file and line in `docs/phase-1/phase-1-27/findings/`.                                                                                                                |

---

## 5. Task register — corrections E and G

**Canonical total: 42.** Frontend 29 · Security 4 · QA 5 · DevOps 2 ·
Documentation 2.

Every title is **domain-qualified**. No two tasks share an ambiguous identical
title — the words _results_, _profile_, _creation_, _contacts_, _addresses_ never
stand alone.

### 5.1 CRM Frontend — 16 tasks

| id             | canonical name               | primary Backend operation(s)                     | test id            |
| -------------- | ---------------------------- | ------------------------------------------------ | ------------------ |
| `P1-27-FE-001` | CRM customer search          | `crm.customer-search`                            | `TC-P1-27-CRM-001` |
| `P1-27-FE-002` | CRM customer search results  | `crm.customer-search`                            | `TC-P1-27-CRM-002` |
| `P1-27-FE-003` | CRM duplicate warning        | `crm.duplicate-list`, `crm.duplicate-scan`       | `TC-P1-27-CRM-003` |
| `P1-27-FE-004` | CRM individual-customer form | `crm.individual-create`                          | `TC-P1-27-CRM-004` |
| `P1-27-FE-005` | CRM company-customer form    | `crm.company-create`                             | `TC-P1-27-CRM-005` |
| `P1-27-FE-006` | CRM customer profile         | `crm.customer-read`                              | `TC-P1-27-CRM-006` |
| `P1-27-FE-007` | CRM customer contacts        | `crm.contact-list`, `crm.contact-add`            | `TC-P1-27-CRM-007` |
| `P1-27-FE-008` | CRM customer addresses       | `crm.address-list`, `crm.address-add`            | `TC-P1-27-CRM-008` |
| `P1-27-FE-009` | CRM customer preferences     | `crm.preference-list`, `crm.preference-set`      | `TC-P1-27-CRM-009` |
| `P1-27-FE-010` | CRM customer consents        | `crm.consent-list`, `crm.consent-record`         | `TC-P1-27-CRM-010` |
| `P1-27-FE-011` | CRM customer notes           | `crm.note-list`, `crm.note-add`                  | `TC-P1-27-CRM-011` |
| `P1-27-FE-012` | CRM customer alerts          | `crm.alert-list`, `crm.alert-raise`              | `TC-P1-27-CRM-012` |
| `P1-27-FE-013` | CRM customer tags            | `crm.tag-list`, `crm.tag-assign`                 | `TC-P1-27-CRM-013` |
| `P1-27-FE-014` | CRM customer restrictions    | `crm.restriction-list`, `crm.restriction-impose` | `TC-P1-27-CRM-014` |
| `P1-27-FE-015` | CRM customer timeline        | `crm.customer-timeline`                          | `TC-P1-27-CRM-015` |
| `P1-27-FE-016` | CRM customer merge review    | `crm.duplicate-list`, `crm.duplicate-review`     | `TC-P1-27-XD-001`  |

### 5.2 Vehicle Frontend — 13 tasks

| id             | canonical name                 | primary Backend operation(s)                                      | test id            |
| -------------- | ------------------------------ | ----------------------------------------------------------------- | ------------------ |
| `P1-27-FE-017` | Vehicle search                 | `veh.vehicle-search`                                              | `TC-P1-27-VEH-001` |
| `P1-27-FE-018` | Vehicle creation               | `veh.vehicle-create`                                              | `TC-P1-27-VEH-002` |
| `P1-27-FE-019` | Vehicle profile                | `veh.vehicle-read`                                                | `TC-P1-27-VEH-003` |
| `P1-27-FE-020` | Vehicle VIN validation         | `veh.vehicle-create` / `veh.vehicle-update` conflict path         | `TC-P1-27-VEH-004` |
| `P1-27-FE-021` | Vehicle ownership              | `veh.vehicle-ownership-history`, `veh.vehicle-ownership-transfer` | `TC-P1-27-VEH-005` |
| `P1-27-FE-022` | Vehicle plate history          | `veh.vehicle-plate-history`, `veh.vehicle-plate-assign`           | `TC-P1-27-VEH-006` |
| `P1-27-FE-023` | Vehicle odometer history       | `veh.vehicle-odometer-history`, `veh.vehicle-odometer-record`     | `TC-P1-27-VEH-007` |
| `P1-27-FE-024` | Vehicle EV/hybrid information  | `veh.vehicle-ev-profile-read`, `veh.vehicle-ev-profile-set`       | `TC-P1-27-VEH-008` |
| `P1-27-FE-025` | Vehicle-customer relationships | `veh.vehicle-relationship-list`, `crm.vehicle-link`               | `TC-P1-27-XD-002`  |
| `P1-27-FE-026` | Vehicle documents              | `veh.vehicle-document-list`                                       | `TC-P1-27-VEH-009` |
| `P1-27-FE-027` | Vehicle media                  | none — see §7                                                     | `TC-P1-27-VEH-010` |
| `P1-27-FE-028` | Vehicle duplicate review       | `veh.vehicle-duplicate-list`, `veh.vehicle-duplicate-review`      | `TC-P1-27-XD-003`  |
| `P1-27-FE-029` | Vehicle timeline               | `veh.vehicle-history` + the five component reads                  | `TC-P1-27-VEH-011` |

### 5.3 Security — 4 · QA — 5 · DevOps — 2 · Documentation — 2

| id              | canonical name                                                   |
| --------------- | ---------------------------------------------------------------- |
| `P1-27-SEC-001` | Permission and resolved-scope enforcement                        |
| `P1-27-SEC-002` | Sensitive-data, export, document, media and file-access controls |
| `P1-27-SEC-003` | Abuse-case and privilege-escalation controls                     |
| `P1-27-SEC-004` | Security audit-event coverage                                    |
| `P1-27-QA-001`  | Unit and component coverage                                      |
| `P1-27-QA-002`  | API contract and error-path coverage                             |
| `P1-27-QA-003`  | Tenant / company / branch isolation                              |
| `P1-27-QA-004`  | Concurrency and idempotency                                      |
| `P1-27-QA-005`  | Regression and immutable evidence packaging                      |
| `P1-27-DO-001`  | Continuous-integration quality gate                              |
| `P1-27-DO-002`  | Structured logging, monitoring and alert routing                 |
| `P1-27-DOC-001` | Contract, catalogue and traceability synchronization             |
| `P1-27-DOC-002` | Operator / developer guidance and change-log update              |

---

## 6. Test references — correction F

The previous plan alternated `TC-CRM-001` and `TC-VEH-001` **mechanically**, so a
vehicle task could carry a CRM test id and the mapping carried no information.

The corrected rule, applied in §5:

- **CRM tasks → the CRM test catalogue** (`TC-P1-27-CRM-###`).
- **Vehicle tasks → the Vehicle test catalogue** (`TC-P1-27-VEH-###`).
- **Cross-domain tasks → explicitly identified cross-domain tests**
  (`TC-P1-27-XD-###`).

Three tasks are genuinely cross-domain and are marked as such rather than
arbitrarily assigned: `FE-016` and `FE-028` (merge review — a merge changes
records other domains reference), and `FE-025` (vehicle-customer relationships —
it is the join between the two domains and touches both modules' operations).

Granular ids were created because two generic catalogue cases cannot carry 29
distinct Frontend obligations. Each id above is **one per task**, and each will
expand into the required path matrix (normal, alternative, validation,
authentication, permission denial, scope denial, empty, error, retry, conflict,
duplicate, stale version, concurrent update, idempotent replay, backend
unavailable, timeout, cancellation, recovery).

---

## 7. Open decisions — correction I

The governing rule: an unresolved decision must **block only the affected task**
or be **implemented as a decision-neutral foundation**. It must not block
unrelated tasks.

### `P1-OD-017` — vehicle duplicate and merge rules · **OPEN**

**Disposition: blocks one capability, not two tasks.**

- The **merge action** is blocked. §13: "No merge action when P1-OD-017 remains
  unresolved."
- The **review screens are not blocked.** `FE-016` and `FE-028` deliver candidate
  comparison, survivor/source identification, field-level comparison from
  `matchBasis`, relationship and document impact, audit consequence, and the
  dismissal decision — all of which have contracts (`crm.duplicate-list`,
  `crm.duplicate-review`, and the vehicle equivalents, merged in #194).
- What ships instead of a merge button: the merge affordance is **absent**, not
  disabled-with-a-tooltip, and the screen states that merge rules are pending a
  decision. A disabled button implies the capability exists and the user lacks
  permission, which is a different and false statement.

### `P1-OD-025` — vehicle document and media file policy · **OPEN**

**Disposition: decision-neutral foundation, per §14.**

§14 states exactly what to build while it is open: "Implement the safe UI
foundation. Keep upload acceptance blocked. Do not invent limits."

- `FE-026` (**documents**) is **not blocked** — `veh.vehicle-document-list` exists and
  lists reachable document ids. It ships as a read.
- `FE-027` (**media**) ships the foundation with **upload acceptance blocked**:
  no approved file types are asserted, no size limit is invented, no object store
  is assumed, no storage credential is exposed, and the object key is never
  treated as authorization. The screen states that the media policy is pending.

### Not an open decision — a capability gap

Three P1-27 obligations have **no Backend contract and no governing decision**.
They are recorded here so nobody mistakes them for decisions awaiting an answer:

| task     | gap                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FE-020` | `veh.vin_verifications` is a table **no code reads or writes**. P1-27 delivers VIN validation as _format validation at the edge plus the server's uniqueness verdict_ (the active-VIN constraint, surfaced as a conflict). A dedicated verification workflow with a check-digit algorithm, an override policy and a permission code is Backend feature work and is **out of P1-27 scope**. |
| `FE-029` | `veh` has **no equivalent of `crm.timeline_events`**. `veh.vehicle-history` is attribute changes only. P1-27 delivers a **sectioned activity view** over the existing independently-paginated reads, and does not fabricate a unified stream. §12 forbids client-side loading of all records, so the sections page independently.                                                          |
| `FE-003` | The duplicate _warning_ during creation uses `crm.duplicate-list`; it does not run a scan on keystroke, because a scan is a privileged write that emits an audit record.                                                                                                                                                                                                                   |

---

## 8. Owner acceptance — correction H

**Permanent Frontend rule, added here and binding on every Frontend phase from
P1-26 onward:**

> No P1-27 formal closure without real installed-Chrome Owner manual acceptance.
> Automated CI is necessary but **not sufficient**.

Silence is not Pass. The only thing that closes this phase is the Product Owner
manually testing the real application and explicitly returning
`OWNER ACCEPTANCE: PASS`.

This rule exists because P1-26 was closed once on five unproven claims and had to
be reopened. Every automated tier was green at the time.

---

## 9. Ownership boundary

Permanent: **`apps/api` is Backend/API only. `apps/web` is Frontend only.**

P1-27 executable work may enter `apps/web/**`, P1-27 Web tests, P1-27
documentation, and approved root CI/tooling required specifically for P1-27.

It must not enter `apps/api/src/**`, `supabase/**`, historical migrations, the
database schema, or Backend route/authorization/OpenAPI implementation.

Required at merge: `APPS_API_EXECUTABLE_DIFF=0`, `SUPABASE_DIFF=0`,
`MIGRATION_DIFF=0`, `UNCLASSIFIED_FILES=0`, `GENERATED_TRACKED_FILES=0`,
`DUPLICATE_FRONTEND_AUTHORITIES=0`, `NESTED_LOCKFILES=0`.

Frontend work lives in `apps/web/src/features/crm/**`,
`apps/web/src/features/vehicles/**` and
`apps/web/src/app/[locale]/(dashboard)/**`.

---

## 10. What every Frontend task owes

Arabic · English · RTL · LTR · desktop · tablet · keyboard · accessibility ·
loading · skeleton where appropriate · empty · error · retry · permission-denied ·
conflict where applicable · correlation ID · server-resolved scope · **real API
integration** · evidence.

Mocks are test fixtures only. **Mocks are not production-integration evidence.**
