# Department and Task Assignment

**Status:** Planning — not implemented · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Recorded:** 2026-08-06 · **Phase authority:** P1-27 Owner-acceptance remediation

---

## 0. What this document is, and what it is not

### 0.1 Planning and traceability only

**Nothing described in this document is implemented by Phase 1-27.** This document
is planning and traceability material. It exists so that a future phase can be
scoped honestly, and so that the gap between what the Owner asked for and what the
platform can currently do is written down in one place rather than rediscovered
during a build.

Read every section with these three rules in mind:

| rule                                                                                                                                                 | consequence                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **A sentence in this document never asserts that a capability exists** unless it names the file, table or seed it was read from.                     | Where a capability is described without such a reference, it is a proposal.                                 |
| **P1-27 is a CRM and Vehicle Frontend phase.** It builds no department feature, no task board, no assignment screen and no notification producer.    | Any reader looking for a delivery date will not find one here. Delivery is owned by the phases named in §9. |
| **No Backend feature development happens inside the P1-27 branch.** The canonical plan (`docs/phase-1/phase-1-27/canonical-plan.md`, §4) forbids it. | Every gap in §8 is routed to an owning Backend phase, not absorbed into Frontend work.                      |

### 0.2 Who this is written for

Workshop managers, service advisers, reception staff and the Product Owner. It uses
the words a workshop uses. Where a technical name has to appear — a table, a
permission, an operation — it appears because that name is the contract, and using
a friendlier synonym would make the document impossible to check.

### 0.3 The one thing that has already been proved wrong once

An earlier documentation wave invented a permission code, `veh.vehicle.create`,
that does not exist. The real code is `veh.vehicle.manage`. The permission
catalogue check refused it. Every code, table, column, status value and operation
identifier below was read out of the repository on the branch
`remediation/p1-27-owner-acceptance-ux`. Where something was looked for and not
found, it is recorded as missing rather than guessed.

The same discipline was then turned on this document. An adversarial review of its
first draft refuted several of its own statements against the source, and each is
now corrected in place: the platform _does_ ship a currency table
(`shared.currencies`, §4.1); template wording _can_ be seen, through the preview
operation (§5.3); and `inv.cost.view` is _not_ an unused permission — it is
enforced inside the database's row-level policies rather than declared on a route
(`DTA-17`). A negative claim — "there is no X" — is exactly as capable of being
wrong as a positive one, and is harder to notice.

A later completeness review of the whole documentation set corrected two further
statements in this document, and both corrections are made in place rather than
appended:

| corrected                                                                      | now reads                                                                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| "Seven `tech` tables are populated by no published operation" (§2.4, `DTA-08`) | The `tech` schema holds **nine** tables and **eight** are written by no published operation. Only `tech.labor_sessions` is written over HTTP. |
| "Part cost … is **not** a gap" (`DTA-17`)                                      | The _mechanism_ is not a defect. The _absence of any cost read_ is a real gap and is owned by `PROC-11` in `parts-and-procurement-flow.md`.   |

---

## 1. The requirement, as the Owner stated it

The Owner's requirement has three parts.

| part                  | requirement                                                                                                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Assignment target** | A task is assigned to one or more **configurable departments or work areas**.                                                                                                                                                                                                                                      |
| **Assignment record** | Every assigned task carries: vehicle, work order, department, assigned employee or technician, assigned by, assignment time, priority, instructions, expected work, status, start time, completion time, notes, evidence, parts, labour, QA result.                                                                |
| **Notification**      | The assigned employee is notified through the approved notification system and sees a message to the effect of "This vehicle has been assigned to you", together with the vehicle identity, the assigned work, the priority, the responsible department, the relevant notes and the evidence that is safe to show. |

The Owner also gave examples of departments: road testing, mechanical, electrical,
air conditioning and cooling, routine service, software and programming updates,
diagnostic equipment, wiring-diagram investigation, cooling-system cleaning, the
air-conditioning gas machine and service, and any other configured specialist
department.

### 1.1 The examples are examples

**This list must not be hard-coded as the only possible set of departments.**

The eleven items above are illustrations of the kind of thing a workshop calls a
department. They are not a vocabulary, not an enumeration, not a `CHECK`
constraint, and not a seed. A future build that ships them as fixed values would:

- be wrong for the first tenant whose workshop is organised differently — a
  body-shop, a tyre-and-alignment centre, a fleet depot;
- collide with the platform's no-fake-data policy, under which business tables
  ship empty and only configuration structures ship;
- freeze a business decision into a migration, where changing it costs a schema
  change instead of a settings edit.

Departments and their capabilities are **organisation-configured**. What the
platform must provide is the structure and the editor; what each workshop puts
into it is the workshop's own business.

---

## 2. What exists today for "department"

### 2.1 The table exists

`org.departments` is a real table, created by
`supabase/migrations/20260717104000_org_operational_structure.sql`.

| column                                                                                                                  | type      | note                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                                                    | `uuid`    | Primary key.                                                                                                    |
| `tenant_id`, `company_id`, `branch_id`                                                                                  | `uuid`    | A department belongs to **one branch**, through the composite key `fk_departments_branch`.                      |
| `department_code`                                                                                                       | `text`    | `ck_departments_code_format` — `^[a-z][a-z0-9_]{1,62}$`. Immutable after creation (`tg_departments_immutable`). |
| `name`                                                                                                                  | `text`    | `ck_departments_name_not_blank`. This is the human-readable label a workshop chooses.                           |
| `status`                                                                                                                | `text`    | `ck_departments_status` — exactly `active` or `inactive`. There is no third value.                              |
| `record_version`                                                                                                        | `integer` | Optimistic concurrency.                                                                                         |
| `created_at` / `created_by` / `updated_at` / `updated_by` / `deleted_at` / `deleted_by` / `archived_at` / `archived_by` | mixed     | Standard lifecycle metadata.                                                                                    |

Two facts about the code are worth stating plainly, because they change how the
editor must behave:

- `uq_departments_branch_code_live` makes `department_code` unique **only among
  live rows** — those not deleted and not archived. Archiving a department
  therefore frees its code for reuse. That is a documented decision in the
  migration header, not an accident.
- The code format is machine-shaped (`air_conditioning`), while `name` is the
  free-text label the workshop reads (`Air conditioning and cooling`). Both are
  needed. A screen that shows only the code is unusable by workshop staff.

This structure is the right _shape_ for the Owner's requirement — and shape is all
it is. Nothing in the platform lets a workshop create, name, rename or deactivate
a department; §2.3 records why. Read this section as "the table a future feature
would build on", never as "a workshop can configure its departments".

### 2.2 The Owner's examples, mapped onto that structure

The table below is a **worked illustration of how a workshop might configure
itself**. It is not a seed, not a default, and not a recommendation about which
departments any tenant should have. Nothing in the repository contains these rows.

| Owner's example                  | illustrative `department_code` | illustrative `name`                      |
| -------------------------------- | ------------------------------ | ---------------------------------------- |
| Road testing                     | `road_testing`                 | Road testing                             |
| Mechanical                       | `mechanical`                   | Mechanical                               |
| Electrical                       | `electrical`                   | Electrical                               |
| Air conditioning and cooling     | `air_conditioning`             | Air conditioning and cooling             |
| Routine service                  | `routine_service`              | Routine service                          |
| Software and programming updates | `software_programming`         | Software and programming updates         |
| Diagnostic equipment             | `diagnostic_equipment`         | Diagnostic equipment                     |
| Wiring-diagram investigation     | `wiring_diagrams`              | Wiring-diagram investigation             |
| Cooling-system cleaning          | `cooling_system_cleaning`      | Cooling-system cleaning                  |
| A/C gas machine and service      | `ac_gas_service`               | Air-conditioning gas machine and service |
| Any other specialist department  | (chosen by the workshop)       | (chosen by the workshop)                 |

**How many departments a tenant will configure is not established.** It would be
established by the Owner's configuration of the pilot tenant, or by a written
policy stating a maximum. No number should be assumed in a screen design, a page
size or an index until one of those exists.

### 2.3 What does not exist

This is the part that matters most.

| gap                                                                    | evidence                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No department can be created, listed, read or edited over the API.** | No route file under `apps/api/src/app/api/v1/**` declares an operation touching `org.departments`.                                                                                                                                                                               |
| **The permission for it is seeded but unused.**                        | `org.department.manage` — "Manage departments/structure", risk `medium` — is in `supabase/seeds/04_iam_permission_catalog.sql` and is referenced by no operation.                                                                                                                |
| **No business record anywhere names a department.**                    | Across `supabase/migrations`, `department_id` exists as a column in exactly one table: `iam.grant_scopes`, where it narrows a _permission grant_ rather than a piece of work. (`org.departments` keys itself on `id`.) No `wo`, `tech`, `rec`, `svc` or `inv` table carries one. |
| **A department has no capabilities.**                                  | Nothing links `org.departments` to a skill, a certification, a service or an item. There is no `department_skills` table and no equivalent column.                                                                                                                               |

The consequence is precise and worth stating in plain words: **a department today
is an authorisation boundary and a name. It is not yet something a job, a work
order or an assignment can point at.** The Owner's requirement that a task carry a
department cannot be satisfied by the current schema without a Backend change.

### 2.4 Where the platform does model capability

The platform already has a configurable capability vocabulary — it simply belongs
to the technician rather than to the department. This matters, because a future
department model should reuse it rather than invent a second one.

| table                            | what it configures                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `tech.skills`                    | The tenant's skill catalogue. Status vocabulary `active` / `inactive` (`ck_skills_status`).                                             |
| `tech.skill_levels`              | Named levels with an integer `rank`; higher means more senior.                                                                          |
| `tech.certifications`            | The tenant's certification catalogue.                                                                                                   |
| `tech.technician_skills`         | Which technician holds which skill, at which level.                                                                                     |
| `tech.technician_certifications` | Which technician holds which certification. Status vocabulary `active` / `expired` / `revoked` (`ck_technician_certifications_status`). |
| `tech.technician_availability`   | Availability intervals. Kind vocabulary `available` / `unavailable` (`ck_technician_availability_kind`).                                |
| `svc.standard_labor_times`       | Expected minutes per published service version, with an optional opaque `skill_ref`.                                                    |

A workshop that configures "air conditioning" as a department would naturally also
configure an `air_conditioning` skill and require it on the relevant jobs. The
skill vocabulary is already free-form and tenant-owned; the department-to-skill
link is what is missing.

**None of the seven tables above can be written through any published operation.**
The six `tech` tables listed above are part of finding `DTA-08`.
`svc.standard_labor_times` is `DTA-20`, which records that no route writes it and
no route reads it.

For precision, because a wrong count here has already caused one disagreement
between documents: the `tech` schema holds **nine** tables — `skills`,
`skill_levels`, `certifications`, `technician_profiles`, `technician_skills`,
`technician_certifications`, `technician_certification_details`,
`technician_availability` and `labor_sessions`, created by
`supabase/migrations/20260722092000_tech_catalogs.sql`,
`...20260722094000_tech_profiles_skills_certs.sql` and
`...20260722099000_tech_labor_sessions.sql`. Only `tech.labor_sessions` is
written over HTTP, by `apps/api/src/modules/technician/data/labor-session-repository.ts`,
so **eight of the nine are written by nothing**. The table in §2.4 above lists
six of those eight because it is a table about _capability configuration_, and
`technician_profiles` and `technician_certification_details` are not capability
catalogues. `DTA-08` owns all eight.

---

## 3. What "task assignment" means in the platform today

### 3.1 The chain

The platform does not have an entity called a "task". The nearest thing is a
**job**, and work reaches a technician through a fixed chain:

```
reception visit  →  work order  →  job  →  job assignment  →  labour session
```

| step                | table                  | how it is created                                                                                                                                                     |
| ------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reception visit** | `rec.reception_visits` | `POST /receptions` (`rec.reception-create`, `rec.reception.manage`).                                                                                                  |
| **Work order**      | `wo.work_orders`       | Only by `POST /receptions/{receptionId}/convert-to-work-order` (`rec.reception-convert-to-work-order`, `rec.reception.convert`). **There is no `POST /work-orders`.** |
| **Job**             | `wo.jobs`              | `POST /work-orders/{workOrderId}/jobs` (`wo.job-create`, `wo.job.manage`).                                                                                            |
| **Job assignment**  | `wo.job_assignments`   | `POST /jobs/{jobId}/assignments` (`wo.job-assignment-create`, `tech.assignment.manage`).                                                                              |
| **Labour session**  | `tech.labor_sessions`  | `POST /jobs/{jobId}/labor-sessions` (`tech.labor-session-start`, `tech.labor.record`).                                                                                |

A workshop reader should take one thing from this table: **work cannot be created
out of nothing.** Every job traces back to a vehicle that was actually received,
and the reception record is what proves custody was accepted. That is deliberate,
and any future task feature must sit inside this chain rather than beside it.

### 3.2 Assignment is a period, not a field

There is no "assigned technician" column on a job. An assignment is a row with a
start and an optional end.

| rule                                                                                    | enforced by                                                             |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| An assignment has a role — exactly `primary` or `assist`.                               | `ck_job_assignments_role`                                               |
| At most **one live primary assignment per job**. A job may carry several `assist` rows. | `uq_job_assignments_active_primary`, a partial unique index             |
| Ending an assignment **requires a written reason**.                                     | `ck_job_assignments_end_reason`                                         |
| An assignment cannot end before it starts.                                              | `ck_job_assignments_window`                                             |
| No code path deletes an assignment row. The set of rows for a job **is** its history.   | `apps/api/src/modules/work-order/application/job-assignment-service.ts` |
| The end time is stamped by the server, never chosen by the caller.                      | Same file, `end()`                                                      |

This is a good design for a workshop, and it should be preserved: "who was on this
vehicle in March" stays answerable, and taking somebody off a job always leaves a
recorded reason.

### 3.3 Who may be assigned, and why they may be refused

Before an assignment is written, the technician is checked against the
requirement the assigner supplied. The evaluation lives in
`apps/api/src/modules/technician/application/technician-eligibility-service.ts`;
the closed vocabulary of reasons and the refusal itself live in
`apps/api/src/modules/technician/domain/technician.ts`. **Every** applicable reason
is returned at once rather than the first, so the assigner does not learn one fact
per rejected attempt.

The refusal codes are a fixed, closed list, and the source records that the
reasons are safe to disclose to the caller. They are **machine codes, not
wording**: any screen must show the plain sentence in the right-hand column below,
never the code itself.

| code                       | plain meaning                                            |
| -------------------------- | -------------------------------------------------------- |
| `profile-inactive`         | The technician's profile is switched off.                |
| `profile-out-of-scope`     | The technician belongs to a different company or branch. |
| `skill-missing`            | The technician does not hold a required skill.           |
| `skill-level-insufficient` | They hold the skill, but below the required level.       |
| `certification-missing`    | A required certification is not held.                    |
| `certification-expired`    | A required certification has lapsed.                     |
| `certification-revoked`    | A required certification was withdrawn.                  |
| `availability-missing`     | No availability covers the requested window.             |
| `availability-blocked`     | An `unavailable` interval overlaps the requested window. |

Two boundary rules are already settled and should not be re-litigated by a future
screen:

- A certification that expires **on** the day of the work is still valid that day.
  The contract is inclusive.
- Availability is judged against the **union** of a technician's intervals, so a
  split shift of 08:00–12:00 and 12:00–17:00 covers a 09:00–13:00 window. A
  single-row check would wrongly refuse.

The whole set of reasons is returned as an `ERR-TECH-001` failure.

### 3.4 The requirement is supplied, not stored

This is the most consequential limitation in the whole area, and it is documented
in the source rather than hidden:

> The protected schema has **no** per-job required-skill or required-certification
> storage — no `wo.job_required_skills`, nothing on `wo.jobs`.
> — `apps/api/src/modules/work-order/application/job-assignment-service.ts`

So the skills and certifications a job needs are typed in by the person making the
assignment, checked once, and then forgotten. They cannot be re-checked later,
cannot be reported on, and cannot be defaulted from the kind of work. A department
model would be the natural home for them. See finding `DTA-07`.

### 3.5 The operations that exist today

Every row below was read from a `defineOperation({...})` block. Multiple
permissions on one row are **all** required.

| method | path                                       | operation id                 | permission(s)            | scope  |
| ------ | ------------------------------------------ | ---------------------------- | ------------------------ | ------ |
| POST   | `/work-orders/{workOrderId}/jobs`          | `wo.job-create`              | `wo.job.manage`          | branch |
| PATCH  | `/jobs/{jobId}`                            | `wo.job-update`              | `wo.job.manage`          | branch |
| POST   | `/jobs/{jobId}/transition`                 | `wo.job-transition`          | `wo.job.transition`      | branch |
| GET    | `/jobs/{jobId}/history`                    | `wo.job-history`             | `wo.work_order.read`     | branch |
| GET    | `/jobs/{jobId}/assignments`                | `wo.job-assignment-list`     | `tech.technician.read`   | branch |
| POST   | `/jobs/{jobId}/assignments`                | `wo.job-assignment-create`   | `tech.assignment.manage` | branch |
| POST   | `/jobs/{jobId}/reassignments`              | `wo.job-reassignment`        | `tech.assignment.manage` | branch |
| POST   | `/assignments/{assignmentId}/end`          | `wo.job-assignment-end`      | `tech.assignment.manage` | branch |
| GET    | `/technicians/available`                   | `tech.technician-available`  | `tech.technician.read`   | branch |
| GET    | `/technicians/{technicianProfileId}/queue` | `tech.technician-queue`      | `tech.technician.read`   | branch |
| GET    | `/jobs/{jobId}/labor-sessions`             | `tech.labor-session-list`    | `tech.technician.read`   | branch |
| POST   | `/jobs/{jobId}/labor-sessions`             | `tech.labor-session-start`   | `tech.labor.record`      | branch |
| POST   | `/labor-sessions/{sessionId}/stop`         | `tech.labor-session-stop`    | `tech.labor.record`      | branch |
| POST   | `/labor-sessions/{sessionId}/corrections`  | `tech.labor-session-correct` | `tech.labor.correct`     | branch |

Two deliberate choices in that table deserve a note for anyone designing a screen:

- **Reading an assignment or a labour log needs `tech.technician.read`, not
  `wo.work_order.read`.** The reason is written into the route: an assignment names
  a member of staff, so it is employee-derived data. Being allowed to see the
  work-order board does not entitle somebody to the roster or to timesheets.
- **`GET /technicians/available` requires `companyId` and `branchId` in the
  query.** Without them the branch scope would be inert, and a roster is not
  something a caller may read across branches. The endpoint also reports **every**
  candidate with a verdict, not only the eligible ones, and reports when the
  candidate list was truncated — a silently shortened roster would tell an assigner
  that nobody is free when somebody is.

### 3.6 What a job may contain, exactly

`wo.jobs` carries only these business columns: `work_order_id`, `title`,
`job_type` (nullable free text), `state`, `requires_diagnostic`. The application
bounds `title` at 200 characters and `job_type` at 64 — both are the
application's own limits, since the database only requires them to be non-blank.

`state` is not a fixed vocabulary. `ck_jobs_state_format` constrains only the
_shape_ of the value; the real graph lives in the tenant-overridable catalogue
tables `wo.job_states` and `wo.job_transitions`, and the database guard reads them
at write time. A tenant may add its own states. **Any screen that hard-codes a
list of job statuses will be wrong for a tenant that configures its own**, which
is the same mistake as hard-coding the departments.

A job's state cannot be changed by editing the job. `PATCH /jobs/{jobId}` rejects a
`state` field outright, because accepting it would be a second path that skips the
transition graph and its reason requirement.

---

## 4. The seventeen attributes of an assigned task, field by field

The Owner listed seventeen things every assigned task must carry. The table below
records, for each one, what carries it **today** — and the honest answer is that
several are carried nowhere.

| #   | attribute                        | carried today by                                                                                                                                                          | written by                                          | readable by                                             | verdict                     |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- | --------------------------- |
| 1   | **Vehicle**                      | `wo.work_orders.vehicle_id`, published as `vehicleId` on the work-order projection                                                                                        | reception conversion                                | `wo.work-order-detail`; identity via `veh.vehicle-read` | indirect                    |
| 2   | **Work order**                   | `wo.jobs.work_order_id`; the technician queue publishes `workOrderId` and `displayNumber`                                                                                 | `wo.job-create`                                     | `wo.work-order-detail`, `tech.technician-queue`         | carried                     |
| 3   | **Department**                   | _nothing_                                                                                                                                                                 | —                                                   | —                                                       | **missing**                 |
| 4   | **Assigned employee/technician** | `wo.job_assignments.technician_profile_id`                                                                                                                                | `wo.job-assignment-create`                          | `wo.job-assignment-list`                                | carried as an id            |
| 5   | **Assigned by**                  | `wo.job_assignments.created_by` (stored) and the `wo.job.assigned` audit record                                                                                           | `wo.job-assignment-create`                          | **not published** in `AssignmentView`                   | partial                     |
| 6   | **Assignment time**              | `wo.job_assignments.valid_from`, published as `validFrom`                                                                                                                 | `wo.job-assignment-create`                          | `wo.job-assignment-list`                                | carried                     |
| 7   | **Priority**                     | _nothing on a work order, job or assignment_                                                                                                                              | —                                                   | —                                                       | **missing**                 |
| 8   | **Instructions**                 | _nothing_; `wo.job_assignments.reason` is an **end-of-assignment** reason and is refused on creation                                                                      | —                                                   | —                                                       | **missing**                 |
| 9   | **Expected work**                | `wo.work_order_service_lines` and `wo.required_parts` describe scope; `svc.standard_labor_times.standard_minutes` holds expected minutes but is **unreachable over HTTP** | `wo.service-line-record`, `wo.required-part-record` | `wo.service-line-list`, `wo.required-part-list`         | partial                     |
| 10  | **Status**                       | `wo.jobs.state`, from the tenant-configurable `wo.job_states` graph                                                                                                       | `wo.job-transition`                                 | `wo.work-order-detail`, `wo.job-history`                | carried                     |
| 11  | **Start time**                   | `tech.labor_sessions.started_at` — the server clock, never a caller value                                                                                                 | `tech.labor-session-start`                          | `tech.labor-session-list`                               | carried, as a clock         |
| 12  | **Completion time**              | `tech.labor_sessions.ended_at`; job completion is a transition recorded in `wo.job_status_history`                                                                        | `tech.labor-session-stop`, `wo.job-transition`      | `tech.labor-session-list`, `wo.job-history`             | partial                     |
| 13  | **Notes**                        | `shared.notes` is generic (`entity_type`, `entity_id`) but the **only** note route is the customer one                                                                    | `crm.note-add` only                                 | `crm.note-list` only                                    | **missing for jobs**        |
| 14  | **Evidence**                     | `dia.diagnostic_evidence` binds an exact `shared.document_versions` row — but to an **inspection**, not a job                                                             | `dia.diagnostic-evidence-record`                    | `dia.diagnostic-detail`                                 | **missing for assignments** |
| 15  | **Parts**                        | `wo.required_parts` records demand; issuing is `POST /stock-issues` in inventory                                                                                          | `wo.required-part-record`, `inv.stock-issue-create` | `wo.required-part-list`                                 | partial                     |
| 16  | **Labour**                       | `tech.labor_sessions`                                                                                                                                                     | `tech.labor-session-start` / `-stop` / `-correct`   | `tech.labor-session-list`                               | carried                     |
| 17  | **QA result**                    | `qms.quality_control_records.overall_result` — `pending` \| `passed` \| `failed` — keyed on the **work order**                                                            | `qms.qc-record-finalize`                            | `qms.qc-record-list`, `qms.qc-record-detail`            | partial                     |

### 4.1 Notes on individual attributes

**Vehicle (1).** The work-order projection carries a vehicle _identifier_, not the
vehicle's identity. To show a plate or a chassis number on a task card, a second
read against the Vehicle surface is required, and it needs `veh.vehicle.read`. A
task screen therefore involves two permissions, not one — and a technician who may
see their queue is not automatically entitled to the vehicle record.

**Assigned by (5).** The database stores the actor and the audit trail records the
action `wo.job.assigned` with the job, the technician profile and the role. But the
assignment projection returned to a caller does not include `createdBy`. Showing
"assigned by" on a screen therefore needs either a projection change or an audit
read, and the audit read is gated on `iam.audit.view`.

**Priority (7).** The word "priority" does appear in the schema — in three columns,
in two unrelated senses — and neither sense is this one:

| where                                                             | what it is                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `dia.recommendations.priority`                                    | How urgent a _diagnostic recommendation_ is. `ck_recommendations_priority` — `low`, `medium`, `high`. |
| `svc.price_rules.priority`, `svc.price_list_assignments.priority` | An integer used to break ties when resolving a price. Nothing to do with work.                        |

There is no priority on a work order, a job or an assignment. **The priority
vocabulary a workshop should use is not established.** It would be established by
an Owner decision naming the values and their meaning. The diagnostic
`low`/`medium`/`high` triple is a reasonable precedent, but adopting it is a
decision, not a deduction.

**Instructions (8).** Worth reading carefully, because the absence is deliberate
rather than accidental. The assignment request body is strict and explicitly
refuses a `reason` field on creation. The route explains why: `reason` is the
column a later _ending_ is required to fill, and putting text there at assignment
time would make the ending's own reason ambiguous. The route's closing remark is
the right principle for the whole area:

> Accepting a field and ignoring it is worse than rejecting it: the rejection is
> information, the silence is a lie.

A future instructions field must therefore be a new, separately named column — not
a reuse of `reason`.

**Expected work (9).** `svc.standard_labor_times` holds `standard_minutes` as
`numeric(10,2)` and is frozen once its parent service version is published. The
application already models it correctly as a **decimal string in minutes**, never a
floating-point number. But the only method that returns it, `publishedVersion()`,
is used internally by quotation and pricing and is not reachable through any route:
`GET /services` returns a service without its labour times, and there is no
`GET /services/{serviceId}`. So a task card cannot show an expected duration today.

**Start and completion time (11, 12).** The labour clock is the honest source. A
labour session's start is the server's clock, and the route refuses a caller-chosen
`startedAt` precisely so recorded hours cannot be written after the fact. Pause and
resume are not operations: a pause is "stop the open session, then move the job to a
paused state", and the _reason_ for pausing lives in the job's status history. Note
that the seeded description of `tech.labor.record` says "Start, pause, resume and
stop" — the catalogue text is wider than the routes that exist.

A technician may also have **at most one running labour session at a time**, across
all jobs, enforced by the exclusion constraint `ex_labor_sessions_overlap`. A task
board that lets somebody start a second clock will be refused by the database.

**Parts (15).** `wo.required_parts.quantity` is `numeric(12,3)`. It arrives from the
database as a **string** and must stay a string all the way to the screen. The same
rule applies to every `numeric` and `bigint` value in the platform, and to money:
amounts are decimal strings paired with an ISO-4217 currency code, never a
floating-point number.

The currency codes themselves are platform reference data, and this document
corrects an earlier draft that said otherwise. `shared.currencies` exists
(`supabase/migrations/20260717100000_org_reference_tables.sql`) and is seeded
(`supabase/seeds/01_reference_data.sql`). Its own table comment states that **no
default or application currency exists**: a company names its own
`org.legal_companies.base_currency_code`, and a price book names one in
`svc.price_lists.currency_code`, which `org.guard_immutable_columns` freezes once
set. Which currencies a production tenant may use is the open decision `OIR-04`
and is not settled here.

**QA result (17).** Quality control is recorded against the **work order**, not
against a job or an assignment. A task card that claims to show "the QA result for
this task" would be showing the result for the whole vehicle visit. The vocabulary
is closed at `pending`, `passed`, `failed`, and once finalised the result, the
checker and the time are frozen by `qms.guard_qc_finalize`.

---

## 5. Notification of the assigned employee

### 5.1 There are two notification systems, and they are not the same thing

A reader must not conflate them.

| system                                     | what it is                                                                                                                                                           | authority                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **The outbound message ledger**            | A durable record that a message was requested, rendered from an approved template, and attempted. Rows in `shared.outbound_messages` and `shared.delivery_attempts`. | `apps/api/src/modules/shared-services/application/notification-service.ts`             |
| **The in-application notification region** | The toast area every screen reports through. One store, one host, mounted once, above every route group, outside the application shell.                              | ADR-021, `docs/adr/ADR-021-application-scroll-ownership-and-notification-authority.md` |

ADR-021's region is a **transient, in-session surface**. It is where "saved",
"failed" or "unavailable" appears while somebody is using the product. It is not an
inbox, it does not survive a reload, and it is not where "this vehicle has been
assigned to you" belongs. ADR-021 is explicit that a global toast is for
"saved, sent, failed, unavailable, retried, copied", and that a modal for every
successful save is not on the list.

The durable inbox is the outbound message ledger, read through
`GET /notifications`.

### 5.2 What the outbound ledger can do today

| operation                                        | id                                  | permission                          |
| ------------------------------------------------ | ----------------------------------- | ----------------------------------- |
| `POST /notifications`                            | `shared.notification-enqueue`       | `shared.notification.send`          |
| `GET /notifications`                             | `shared.notification-list`          | `shared.notification.read`          |
| `GET /notifications/{notificationId}`            | `shared.notification-read`          | `shared.notification.read`          |
| `GET /notifications/{notificationId}/deliveries` | `shared.notification-delivery-list` | `shared.notification.delivery.read` |

All four are tenant-scoped. The rules that constrain them:

| rule                                                                                                                                                                                                                       | source                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| The inbox is the **caller's own**. There is deliberately no `recipientUserId` parameter — an optional one would let any caller read any inbox while every isolation test still passed.                                     | `notification-read-service.ts`                             |
| Only two channels are accepted: **`email` and `in_app`**. The frozen type also names `sms` and `whatsapp`; the policy refuses those with the rule `unsupported_channel`, because the database `CHECK` allows only the two. | `notification-policy.ts`, `ck_outbound_messages_channel`   |
| The recipient must be a **UUID**, never an address. An email address cannot pass validation, which removes arbitrary-destination sending from the threat model rather than filtering for it.                               | `assertRecipientReference`                                 |
| Every message must name an **approved, active template version** whose channel and locale match the request. A disabled template stops messages even if its version was approved.                                          | `assertTemplateUsable`                                     |
| A **consent decision** must be supplied, must be granted, and must be **less than five minutes old** in either direction. A stale or future-dated evaluation is refused as `ERR-NTF-001`.                                  | `assertConsent`, `MAX_CONSENT_AGE_MS`                      |
| A **dedupe key** of 8–200 characters, letters and digits plus `. _ : -`, makes a repeated enqueue idempotent.                                                                                                              | `assertDedupeKey`                                          |
| Nothing is delivered inside the business transaction. The durable outcome is one `pending` row; delivery belongs to a worker on a different database role.                                                                 | `notification-service.ts`                                  |
| The **rendered content is never stored.** Only a digest is. A message body cannot be re-read from the ledger.                                                                                                              | `notification-service.ts`, `outbound_messages.body_sha256` |

That last row is a real constraint on the Owner's requirement. The ledger proves a
message was requested and records its lifecycle, but it **cannot show the operator
what the message said**. Anything the assigned employee must be able to re-read
after the fact has to be readable from the job itself, not from the notification.

### 5.3 What the message would need to say

The Owner specified the content: "This vehicle has been assigned to you", the
vehicle identity, the assigned work, the priority, the responsible department, the
relevant notes and the safe evidence.

Mapping that onto the mechanism that exists:

| the Owner's element    | mechanism                                                | state today                                                                                                |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| The sentence itself    | a `shared.message_templates` row and an approved version | Templates can be created and approved; **none exists for assignment**, and none can be listed or read back |
| Vehicle identity       | template variables, supplied at enqueue                  | Requires a Vehicle read at enqueue time                                                                    |
| Assigned work          | template variables                                       | `wo.jobs.title` exists; instructions do not                                                                |
| Priority               | template variables                                       | **No source** — see `DTA-04`                                                                               |
| Responsible department | template variables                                       | **No source** — see `DTA-02`                                                                               |
| Relevant notes         | template variables                                       | **No source for a job** — see `DTA-06`                                                                     |
| Safe evidence          | a link or a reference, never an attachment               | Evidence is a document; downloads are authorisation-only; **`P1-OD-025` binds**                            |

Message templates are administered under `org.settings.manage` — deliberately, and
the seed says so. **Do not invent a `shared.template.*` permission code.** Eight
template operations exist: create, update, version create, activation set, revise,
approve, preview and retire. **Not one of them is a `GET`.** Nothing lists
templates and nothing fetches a template or a version by its identifier.

One of the eight does nonetheless show the wording.
`POST /template-versions/{versionId}/preview` (`shared.template-version-preview`,
`org.settings.manage`) renders a version with sample values supplied by the caller
and sends nothing. So checking the wording of an assignment notification would not
be impossible — but it requires the operator to already hold the version
identifier, because no operation will tell them which templates or versions exist.
That is a discoverability gap rather than a blank wall, and `DTA-11` records it as
such.

### 5.4 What the notification would look like on arrival

The inbox projection publishes: the notification id, channel, purpose, status,
template version id, retry count, a failure classification, company and branch,
record version, and the lifecycle timestamps (`createdAt`, `queuedAt`, `sentAt`,
`deliveredAt`, `failedAt`, `cancelledAt`).

It publishes **no business reference at all** — no vehicle, no work order, no job.
There is also no screen that displays it: no inbox has been built, in this phase or
any earlier one. A caller reading the operation today would receive the fact that a
message exists and the state it is in, and nothing that would let a product take
the reader to the vehicle. A future assignment notification needs a way to carry
that link. See `DTA-14`.

The list is a keyset page: `{ items, nextCursor, hasMore }`. **There is no `total`.**
This is platform-wide and is stated in `apps/api/src/server/db/pagination.ts` — the
extra row is fetched to detect `hasMore` without a second count query. Any screen
design that promises "showing 1–20 of 137" is promising a number the platform does
not compute.

The distinction between `accepted` and `delivered` is preserved and must not be
collapsed on screen: one means the provider took the message, the other means the
provider gave evidence it arrived.

### 5.5 The event that already fires, and the consumer that does not exist

When an assignment is written, the service publishes a domain event inside the same
transaction:

| property       | value                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| catalogue code | `EVT-TEC-001`                                                                                                                |
| event type     | `job.assigned`                                                                                                               |
| aggregate      | `wo.job` — the job, not the assignment row, because a consumer reacts to "this job now has a technician"                     |
| owner module   | `wo` (the assignment row lives in `wo.job_assignments`, so `wo` writes it)                                                   |
| event key      | `job.assigned:{assignmentId}` — keyed by the assignment, because a job is legitimately assigned more than once over its life |
| payload        | `jobId`, `assignmentId`, `assignmentRole` — no personal data                                                                 |
| implemented in | P1-19                                                                                                                        |

**The event is published and nothing consumes it.** The only call site of the
notification service's `queueMessage` in the entire API is the
`POST /notifications` route. No module — not work-order, not technician, not
shared-services — enqueues a message when an assignment happens. The plumbing that
would turn `job.assigned` into "This vehicle has been assigned to you" is the piece
that does not exist. See `DTA-10`.

There is a second, related gap that is structural rather than an omission:
`EVT-NTF-001` (`message.delivery.changed`) is deliberately unimplemented, because
delivery state changes on a worker that has no request context and therefore cannot
publish an event at all. The durable record of a delivery change is the message row
plus its append-only attempt history.

### 5.6 Evidence that is "safe to show"

The Owner asked that the notification show evidence that is safe. The platform's
document handling makes that a genuinely careful question:

- **Upload is authorisation-only.** The API mints an authorisation and the bytes go
  to a storage provider; no route accepts a file body.
- **Both document reads are gated on a write code**, `shared.document.manage` —
  `GET /attachments/documents/{documentId}` declares it. There is no
  `shared.document.read` code. There is no general document list and no document
  search: the only two reads are one document by its identifier, and a
  vehicle-scoped list.
- **`P1-OD-025` (media and document policy) is an open Owner decision** and binds
  directly here. The P1-27 canonical plan's disposition is to build the safe
  foundation, keep upload acceptance blocked, and **not invent limits**. That
  applies to this document too: no file types, no size caps and no retention
  periods are asserted anywhere in it.

The practical consequence for a notification: **it must carry a reference, never a
copy.** The recipient follows the reference and is authorised at that point, under
their own permissions. Embedding an image or a link that bypasses authorisation
would move the access-control decision out of the platform and into an email.

---

## 6. What a department model would have to decide

This section is a set of questions, not a design. Each one is a real fork that a
Backend phase cannot answer for itself.

| question                                                                     | why it cannot be assumed                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does a **job** carry a department, or does an **assignment**?                | If the job carries it, the department is a property of the work. If the assignment carries it, one job can be worked by two departments in sequence — which is exactly what "road test, then mechanical, then road test again" looks like. |
| Can a task be assigned to **more than one department at a time**?            | The Owner's wording says "one or more". `uq_job_assignments_active_primary` already permits one primary and several assists, which is a related but different idea.                                                                        |
| Is a department **branch-scoped** or tenant-wide?                            | `org.departments` is branch-scoped today, through `fk_departments_branch`. A tenant with five branches would configure "mechanical" five times.                                                                                            |
| Does a department have **capabilities**?                                     | If yes, the natural link is to `tech.skills` and `tech.certifications`, and it would give the per-job requirement a home (`DTA-07`).                                                                                                       |
| Does a technician **belong** to a department?                                | `tech.technician_profiles` has a nullable free-text `trade` column and no department link.                                                                                                                                                 |
| What happens to open tasks when a department is **deactivated or archived**? | Archiving frees the department code for reuse (`uq_departments_branch_code_live`), which would silently re-point history unless the reference is by id.                                                                                    |
| Is the department visible to the **customer**?                               | An internal work area and a line on a customer-facing document are different things.                                                                                                                                                       |

**None of these is answered anywhere in the repository.** Each would be answered by
an Owner decision, recorded in the same register that holds `P1-OD-017` and
`P1-OD-025`.

---

## 7. Open Owner decisions that bind this area

| decision        | subject                              | how it binds this document                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`P1-OD-017`** | Duplicate and merge rules — **OPEN** | Binds indirectly but really. A department feature that reports "work done by department" would produce figures that shift when two customer or vehicle records are merged. Until the merge rules are decided, no reporting claim about historical departmental workload can be honoured. The P1-27 disposition is that merge **actions** are blocked while review screens are not. |
| **`P1-OD-025`** | Document and media policy — **OPEN** | Binds §5.6 directly. Evidence in a notification, evidence attached to a task, and any statement about what a technician may photograph and upload all wait on this. The standing instruction is: build the safe foundation, keep upload acceptance blocked, **do not invent limits**.                                                                                              |

Neither decision may be written around. A design that quietly assumes an answer to
either is a design that will have to be undone.

---

## 8. Integration findings

These are the specific things that do not exist. Each is a gap between the Owner's
requirement and the repository as read on this branch.

The identifiers are **local to this document** (`DTA-nn`). They are not entries in
the live `P1-27-INT-###` register and must be promoted into it, with new numbers,
if and when they are accepted as work.

| finding    | what is missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | owning Backend phase                                                                                                                                                                                                                                                                                                       | owning Frontend phase                                                                                                                                                    | required action                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DTA-01** | No HTTP surface for `org.departments`. Nothing creates, lists, reads or edits a department. `org.department.manage` is seeded and used by no route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **P1-14** — an `org` HTTP surface already exists and its route headers name P1-14 (`/org/tenant`, `/org/companies/{companyId}/settings`, `/org/branches/{branchId}/settings`, `/organization/branches/{branchId}/status`). A department read and write belongs beside them, not in a new phase. The schema is P1-03's (§9) | An Administration Frontend. **No repository record names one**, so this is a placement, not a commitment                                                                 | Add create/list/read/update operations bound to `org.department.manage`; keep the read separate from the write code, or record why a write code gates the read.                                                         |
| **DTA-02** | No business record references a department. `department_id` exists only on `org.departments` and `iam.grant_scopes`. A job or an assignment cannot name one.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Work-order Backend (post-P1-19)                                                                                                                                                                                                                                                                                            | Task-board Frontend                                                                                                                                                      | Owner decision first (§6), then a migration adding the reference at the agreed level, with a composite FK carrying the branch scope.                                                                                    |
| **DTA-03** | A department has no capabilities. Nothing links a department to `tech.skills`, `tech.certifications`, `svc.services` or `inv.item_master`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | New Organisation Backend phase                                                                                                                                                                                                                                                                                             | Administration Frontend                                                                                                                                                  | Decide whether departments carry capabilities; if so, link to the existing `tech` vocabularies rather than creating a second one.                                                                                       |
| **DTA-04** | No priority exists on a work order, a job or an assignment. The only `priority` columns in the schema belong to diagnostic recommendations and price rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Work-order Backend                                                                                                                                                                                                                                                                                                         | Task-board Frontend                                                                                                                                                      | Owner decision naming the vocabulary and its meaning; then a `CHECK`-constrained column, or a tenant-configurable catalogue table if the values must be configurable.                                                   |
| **DTA-05** | No instructions and no expected-work statement can be attached to an assignment. The create body is strict and refuses `reason` by design; `wo.job_assignments.reason` is an end-of-assignment reason.                                                                                                                                                                                                                                                                                                                                                                                                                 | Work-order Backend                                                                                                                                                                                                                                                                                                         | Task-board Frontend                                                                                                                                                      | Add separately named columns with their own application length bounds; do not reuse `reason`.                                                                                                                           |
| **DTA-06** | No note can be written against a job, a work order or an assignment. `shared.notes` is generic and capable, but the only note operations are `crm.note-add` and `crm.note-list`.                                                                                                                                                                                                                                                                                                                                                                                                                                       | Work-order Backend                                                                                                                                                                                                                                                                                                         | Task-board Frontend                                                                                                                                                      | Add note operations for `wo.job` / `wo.work_order` entity types, reusing `shared.notes` and its classification and visibility columns.                                                                                  |
| **DTA-07** | Per-job required skills and certifications are not stored. They are supplied by the assigner, checked once, and cannot be re-checked, reported on or defaulted.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Work-order Backend                                                                                                                                                                                                                                                                                                         | Task-board Frontend                                                                                                                                                      | Store the requirement — on the job, or derived from a department under `DTA-03`. Recorded as a reconciliation in the source, not an oversight.                                                                          |
| **DTA-08** | No route writes a technician profile, skill, certification or availability record. **Eight of the nine `tech` tables are populated by no published operation**; only `tech.labor_sessions` is written over HTTP. (Counted in §2.4.)                                                                                                                                                                                                                                                                                                                                                                                    | Technician Backend (post-P1-19)                                                                                                                                                                                                                                                                                            | Administration Frontend                                                                                                                                                  | Add profile and roster management operations. Until then, a new tenant's roster is empty and every eligibility check returns `profile-out-of-scope` or nothing.                                                         |
| **DTA-09** | No single-job read (`GET /jobs/{jobId}`) and no single labour-session read (`GET /labor-sessions/{sessionId}`). A job can be updated and transitioned but not fetched on its own.                                                                                                                                                                                                                                                                                                                                                                                                                                      | Work-order Backend                                                                                                                                                                                                                                                                                                         | Task-board Frontend                                                                                                                                                      | Add the two detail reads under `wo.work_order.read` and `tech.technician.read` respectively.                                                                                                                            |
| **DTA-10** | Nothing enqueues a notification when an assignment happens. `queueMessage` has exactly one call site in the API — the `POST /notifications` route. The `job.assigned` event is published and consumed by nobody.                                                                                                                                                                                                                                                                                                                                                                                                       | P1-15 with P1-19                                                                                                                                                                                                                                                                                                           | **None.** This is a Backend-only change: the notification arrives in an inbox that P1-26 already built the shell for, and no new screen is required. Agreed with `WF-15` | Build a consumer, or an explicit enqueue inside the assignment transaction. Decide which, and record why; an event with no consumer and a direct call have different failure modes.                                     |
| **DTA-11** | Message templates have no `GET` at all. Eight operations exist and none lists templates or fetches one by identifier, so an operator cannot discover which templates or versions exist. Wording can be seen only through `shared.template-version-preview`, which needs a version identifier the API will not supply.                                                                                                                                                                                                                                                                                                  | Shared-services Backend                                                                                                                                                                                                                                                                                                    | Administration Frontend                                                                                                                                                  | Add list and detail reads. Keep them on `org.settings.manage` unless the Owner decides otherwise — do **not** invent a `shared.template.*` code.                                                                        |
| **DTA-12** | `EVT-NTF-001` (`message.delivery.changed`) is unimplemented and structurally so: the worker archetype has no request context and cannot publish. A delivery state change raises no event.                                                                                                                                                                                                                                                                                                                                                                                                                              | P1-15                                                                                                                                                                                                                                                                                                                      | **None.** A delivery-state event has no screen obligation; the inbox already reads the message row and its attempt history                                               | Either build a worker-side publication path or accept the message row plus its attempt history as the record. Do not mark the catalogue entry implemented without a producer.                                           |
| **DTA-13** | A notification enqueue requires a consent decision granted within five minutes. The consent model that exists (`crm.consent_history`) is a **customer** model. There is no staff-consent source for notifying an employee about their own work.                                                                                                                                                                                                                                                                                                                                                                        | P1-15, after an Owner decision                                                                                                                                                                                                                                                                                             | **None.** The answer is a contract decision, not a screen. Whichever way it goes, no Frontend phase owes work until an enqueue path exists (`DTA-10`)                    | Decide whether internal operational notifications require consent at all; if not, the caller-supplied decision needs a defined internal source rather than an invented one.                                             |
| **DTA-14** | The inbox projection carries no business reference — no vehicle, no work order, no job. A recipient can see that a message exists but has nothing to navigate to.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Shared-services Backend                                                                                                                                                                                                                                                                                                    | Notification Frontend                                                                                                                                                    | Add a safe reference (entity type plus id) to the projection, and authorise the follow-through read separately at the destination.                                                                                      |
| **DTA-15** | No task-level start or completion timestamp. `wo.jobs` has neither. Start and end are inferred from labour sessions and job transitions, which are different facts.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Work-order Backend                                                                                                                                                                                                                                                                                                         | Task-board Frontend                                                                                                                                                      | Decide whether a job needs its own timestamps or whether the derived view is sufficient, and state the answer rather than deriving it silently in a screen.                                                             |
| **DTA-16** | No evidence can be attached to a job or an assignment. `dia.diagnostic_evidence` binds an exact immutable document version, but to an inspection; reception evidence belongs to the visit.                                                                                                                                                                                                                                                                                                                                                                                                                             | Work-order Backend                                                                                                                                                                                                                                                                                                         | Task-board Frontend                                                                                                                                                      | Blocked on `P1-OD-025`. When it resolves, follow the diagnostic pattern: bind an exact `shared.document_versions` row, never a substitutable reference.                                                                 |
| **DTA-17** | Issued parts cannot be read back against a job. `wo.required_parts` records demand; `POST /stock-issues` performs the issue; no read joins the two. On cost, two facts must be kept apart. The **mechanism** is not a defect: `inv.cost.view` appears in no operation's declared permissions because it is enforced as a row-security predicate on the restricted cost tables `inv.item_cost_details` and `inv.external_purchase_part_details`. The **absence of any cost read at all** is a separate gap, and it is owned by `PROC-11` in `docs/product/workshop/parts-and-procurement-flow.md`, not by this finding. | P1-21 (Inventory Backend)                                                                                                                                                                                                                                                                                                  | Task-board Frontend                                                                                                                                                      | Add a read of issues by job or work order. Cost is out of scope for this finding — see `PROC-11`. If a cost figure is ever added it must stay behind `inv.cost.view` and be a decimal string with an ISO currency code. |
| **DTA-18** | The QA result is recorded per work order, not per job or per assignment. `qms.quality_control_records` has a `work_order_id` and no job column.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Quality Backend                                                                                                                                                                                                                                                                                                            | Task-board Frontend                                                                                                                                                      | Decide whether QA is per vehicle visit or per task. Until then, no screen may label a work-order QA result as belonging to one task.                                                                                    |
| **DTA-19** | Neither assignment read is paged. `GET /jobs/{jobId}/assignments` returns `{ items }`; `GET /technicians/{technicianProfileId}/queue` returns `{ technicianProfileId, items }`. Neither query carries a `LIMIT`, and neither takes or returns a cursor. The assignment history is append-only and grows without bound.                                                                                                                                                                                                                                                                                                 | Work-order Backend                                                                                                                                                                                                                                                                                                         | Task-board Frontend                                                                                                                                                      | Convert both to the keyset page contract `{ items, nextCursor, hasMore }`. Never introduce a `total`.                                                                                                                   |
| **DTA-20** | Expected labour minutes are unreachable over HTTP in **both** directions. `svc.standard_labor_times.standard_minutes` is returned only by `publishedVersion()`, an internal method used by pricing; `GET /services` omits it and there is no service detail read. No operation writes one either — nothing creates a service version or records a labour time — so the table is populated by no published operation.                                                                                                                                                                                                   | Service-catalogue Backend                                                                                                                                                                                                                                                                                                  | Task-board Frontend                                                                                                                                                      | Add a service detail read that publishes labour times, and a write path for them. Keep `standardMinutes` a decimal string, as the existing projection already does.                                                     |

**Twenty findings are recorded.**

---

## 9. Ownership map

| area                                                         | owning Backend phase | note                                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organisational structure, including departments              | P1-03 (schema)       | The table exists. Its migration header names Phase 1-3. No phase has built a **department** HTTP surface.                                                                                                   |
| The published `org` HTTP surface                             | P1-14                | `/org/tenant`, company and branch settings, and branch status all carry P1-14 in their route headers. A department read and write belongs beside them — see `DTA-01`.                                       |
| Identity, permissions and grant scopes                       | P1-14                | `department` is already a valid grant scope type.                                                                                                                                                           |
| Shared services — notifications, templates, documents        | P1-15, P1-23         | P1-15 built the write half; P1-23 built the inbox read half.                                                                                                                                                |
| Reception and appointments                                   | P1-18                | Write-only: twelve operations — eight `rec`, four `apt` — and **no `GET` among them**. The permission seed registers no read code for either and states the omission is deliberate on the appointment side. |
| Work orders, jobs, assignments, labour, diagnostics, quality | P1-19                | Where every operation in §3.5 comes from.                                                                                                                                                                   |
| Service catalogue, standard labour times, pricing            | P1-20                | Owns `svc.standard_labor_times`.                                                                                                                                                                            |
| Inventory and stock issues                                   | P1-21                | Owns the part-issue path.                                                                                                                                                                                   |
| CRM read contracts                                           | P1-16                | Remediated for P1-27 under `P1-27-INT-001` and `P1-27-INT-005`.                                                                                                                                             |
| Vehicle read contracts                                       | P1-17                | Remediated for P1-27 under `P1-27-INT-002` and `P1-27-INT-005`.                                                                                                                                             |
| CRM and Vehicle Frontend                                     | P1-27                | **Builds none of this.**                                                                                                                                                                                    |

---

## 10. Things this document deliberately does not state

Recorded so that a later reader can tell the difference between an omission and a
decision.

| not stated                                                          | why, and what would establish it                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| How many departments a workshop should have                         | Not established. An Owner configuration of the pilot tenant, or a written policy, would establish it.                                                                                                                                                                                                                          |
| A priority vocabulary                                               | Not established. An Owner decision naming the values would establish it.                                                                                                                                                                                                                                                       |
| A delivery-time target for an assignment notification               | Not established. No service-level target exists anywhere in the repository. An Owner decision would establish it.                                                                                                                                                                                                              |
| A retry count or backoff schedule for a failed notification         | Not established from this document's reading. The attempt history records what happened; the policy that governs it was not read and is not asserted.                                                                                                                                                                          |
| Approved file types, size limits or retention periods for evidence  | Blocked by `P1-OD-025`. The standing instruction is not to invent limits.                                                                                                                                                                                                                                                      |
| Any figure for expected duration of any kind of work                | Not established. `svc.standard_labor_times` is the structure; every value in it is tenant configuration and the platform seeds none.                                                                                                                                                                                           |
| Whether to buy a diagnostic-data, wiring-diagram or parts-data feed | Purchasing or contracting a paid data provider is a **commercial decision reserved to the Product Owner**. This document recommends only that any such feed be _evaluated_, never that one be bought.                                                                                                                          |
| A cost or rate for labour                                           | No labour rate exists in the `tech` schema, and no read operation anywhere in the platform returns a cost amount — cost lives in restricted tables whose RLS policies require `inv.cost.view`. Any money figure a future phase publishes must be a decimal string paired with an ISO-4217 code drawn from `shared.currencies`. |

---

## 11. Glossary

| term                 | meaning in this platform                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch**           | A physical workshop location. Almost all work-related permissions are branch-scoped.                                                                                 |
| **Department**       | A named work area within one branch. Configuration, chosen by the workshop. Today it is a name and an authorisation boundary and nothing more.                       |
| **Reception visit**  | The record that a vehicle was handed over and custody accepted. Every work order originates from one.                                                                |
| **Work order**       | The whole piece of work on one vehicle for one visit.                                                                                                                |
| **Job**              | One unit of work inside a work order. The nearest thing the platform has to a "task".                                                                                |
| **Assignment**       | A dated period during which one technician holds one job, in a `primary` or `assist` role.                                                                           |
| **Labour session**   | A clock. Started and stopped by a technician against a job. At most one may run per technician at a time.                                                            |
| **Keyset page**      | The platform's list format: `{ items, nextCursor, hasMore }`. There is no `total` and no page number.                                                                |
| **Permission code**  | The unit of authorisation, for example `tech.assignment.manage`. There is no wildcard and no administrator code; authorisation is by permission, never by role name. |
| **Template version** | An approved, immutable wording for an outbound message. A message can only be sent from one.                                                                         |
