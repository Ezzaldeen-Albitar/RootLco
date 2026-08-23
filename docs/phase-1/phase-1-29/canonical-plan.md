# Phase 1-29 — Work Order, Diagnostics and Technicians — derived canonical plan

**Preparation artefact. No implementation authorised by this document.**

## 0. Why this document says "derived"

There is no canonical P1-29 definition in this repository. `docs/phase-1/phase-1-29/`
did not exist before this preparation, and the document that governs Phase 1-1
through Phase 1-39 is a Word file deliberately held outside Git
(`docs/governance/canonical-documents.md:36-44`, `committedToGit: false`). Where
that document and the repository disagree, it wins — so the title, objective,
task register and gate for P1-29 **cannot be read from this repository at all**.

What follows is assembled from five places that were each written for another
purpose. It is a working definition, not an authority, and the Owner's plan
supersedes it wherever the two differ.

### The title is not stated once

Five variants exist:

| Form                                                       | Source                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| Work Order, Diagnostics and Technician Frontend            | `docs/product/owner-workflow-requirements.md:33`           |
| P1-29 — Work Order, Diagnostics and Technicians            | `docs/product/owner-workflow-requirements.md:220`          |
| Work Order, Diagnostics, Technician Frontend               | `docs/phase-1/phase-1-27/finding-phase-disposition.md:204` |
| Phase 1-29 (Work Order, Diagnostics, Technicians Frontend) | `pre-p1-29-…/scope.md:30`                                  |
| P1-29 is the Work Order, Diagnostics and Technicians phase | `pre-p1-29-…/scope.md:254`                                 |

The sibling phases are titled _Phase 1-9 — Work Order, Diagnostics, and
Technician Database_ and _Phase 1-19 — Work Order, Diagnostics, and Technician
Backend_. **The naming series implies the Frontend title, and this preparation
uses it — while recording that P1-29 is not Frontend-only.**

## 1. P1-29 is not a Frontend-only phase

Stated plainly because every title suggests otherwise, and planning on that
assumption would fail immediately.

- `pre-p1-29-…/dependencies.md:433-444` assigns seven named capabilities
  (B1–B7) to **"P1-29 Backend"**, distinguishing them from P1-29 Frontend.
- Seven of the sixteen Owner requirements are **Blocked** on Backend contracts
  that do not exist (`owner-workflow-requirements.md:220-239`).
- Three of the thirty findings assigned to P1-29 are **Critical**, and each
  requires schema or HTTP surface, not a screen
  (`phase-1-27/finding-phase-disposition.md:204-239`).

The consequence for sequencing is in [implementation-slices.md](implementation-slices.md):
**the first slice is Backend, not a data layer.**

## 2. Objective, derived

No declared objective statement exists. The nearest is the first row of the
Owner requirement table:

> The work order becomes the central operational record after reception.

Everything else in the table elaborates that sentence: who works on the vehicle,
what they find, what they do, what evidence they leave, and how the record
closes.

## 3. Scope — the sixteen Owner requirements and their real status

From `docs/product/owner-workflow-requirements.md:220-239`. "Contracted" is
defined at `:19` as _"The Backend contract exists and is proven; no Frontend
consumes it yet"_ — those are the rows a Frontend phase can actually build.

| #   | Requirement                                                  | Owner status                     | Verified against the tree                                                   |
| --- | ------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------- |
| 1   | Work order is the central operational record after reception | Planned                          | Supported — 26 work-order operations exist                                  |
| 2   | Work order tied to the selected customer and vehicle         | **Blocked** `INT-036`            | **Confirmed.** Vehicle yes; customer **no column anywhere** in 44 tables    |
| 3   | Multiple departments may work on one vehicle                 | **Blocked** `INT-042`            | **Confirmed, and narrower than stated** — see below                         |
| 4   | Configurable department list                                 | **Blocked** `INT-042`            | Confirmed — `org.departments` holds 0 rows and has no HTTP surface          |
| 5   | Assign named employees and technicians                       | **Blocked** `INT-045`, `INT-047` | **Confirmed.** Assignment works; the technician has no name                 |
| 6   | Notify the assigned employee                                 | **Blocked** `INT-100`            | Confirmed — `job.assigned` is published and consumed by nobody              |
| 7   | Start / pause / resume / complete a task                     | Partly blocked `INT-048`         | Confirmed — start and complete exist; **no pause, no resume**               |
| 8   | Progressive work logging                                     | **Blocked** `INT-049`            | Confirmed — no work-log table, no note against a job or assignment          |
| 9   | Diagnostic findings                                          | Contracted                       | Available — 13 diagnostics operations                                       |
| 10  | Computer scan                                                | Planned                          | DTC records exist in `dia`; no scan ingestion surface                       |
| 11  | Technician diagnosis                                         | Contracted                       | Available, as a checklist model — see §5                                    |
| 12  | Work evidence                                                | Blocked `INT-093`…`INT-095`      | Confirmed — evidence attaches to a report and an approval, **not to a job** |
| 13  | Blockers                                                     | Planned                          | No blocker/escalation record exists (`VHM-16`)                              |
| 14  | Additional-work request                                      | Contracted                       | Available, with item-granular approval                                      |
| 15  | Submit for QA                                                | Contracted                       | Available — 13 quality operations                                           |
| 16  | Complete work-order history                                  | Partly contracted `INT-043`      | Confirmed — four separate timelines, no unified read                        |

**Requirement 3, corrected.** The finding register says departments "exist
nowhere". **They exist.** `org.departments` is a real table
(`20260717104000_org_operational_structure.sql:109`) with RLS enabled and
forced, three scope policies, grants to `app_runtime`/`app_readonly`, and
`org.department.manage` seeded as a permission.

More than that: **the authorisation layer implements department scope end to
end**, not merely in anticipation. `iam.grant_scopes.scope_type` is
`CHECK (scope_type IN ('company', 'branch', 'department'))`
(`20260718092000:141`); `ck_grant_scopes_shape` requires all three ids when the
type is `department` (`:145`); `fk_grant_scopes_department` is a real composite
FK to `org.departments` (`:138-140`), made possible by a `uq_departments_scope_id`
added at `:57-58` **for exactly that purpose**;
`iam.has_permission_in_scope` takes a **fourth parameter** and resolves
`scope_type = 'department'` (`20260718097000:126-130`, `:194`); the delegation
backstop covers it (`20260727090000:159`, `:182` — _"branch covers its
departments; department covers itself"_); and at least one shipped `rec` RLS
policy already honours it (`20260815093000:168`). The IAM grant routes accept
`scopeType: 'department'` with a `departmentId`.

Three things are missing, and only the third is a schema change: the table holds
**zero rows**; **no route** references departments, so `org.department.manage` is
an orphan code declared by zero operations; and **no `wo`, `dia`, `tech` or
`qms` table carries a `department_id`**. See `BE-7` in
[backend-prerequisite-gate.md](backend-prerequisite-gate.md), whose
administration half belongs to PRE-P1-29 rather than to this phase.

## 4. Declared outputs

The only document in the repository whose subject is P1-29 itself is
`docs/phase-1/phase-1-9/p1-29-frontend-contract.md` — 27 lines written during
the database phase. It names six read-model surfaces P1-29 is expected to
render:

1. Work-order board per branch, from `wo.work_orders`, indexed by
   (tenant, company, branch, state).
2. Job / labour view over `wo.jobs`, `wo.job_assignments`, `tech.labor_sessions`.
3. Technician view — profile, skills, certifications, availability, with the
   certificate number visible only under `iam.sensitive.view`.
4. Diagnostic report view — pinned published template version, item results,
   findings, measurements, DTC records, recommendations, evidence **via the
   linked document, never a raw object id**.
5. Quality / closure view — QC records, per-check results, closure-gate
   blockers B1..B6, rework links, append-only reopen-attempt log.
6. Four append-only timelines, ordered by `seq`.

It closes with _"No frontend is implemented in this phase."_ Those six surfaces
are the best available statement of what P1-29 must render, and this preparation
treats them as the output specification.

## 5. What the Backend actually models, and where that diverges from the Owner's words

Two divergences matter enough to state in the plan rather than bury in the
archaeology.

**"Diagnostics" is an inspection checklist, not a diagnosis.** The `dia` schema
implements a template-instantiated checklist with a fixed four-state report
lifecycle. There is no symptom, complaint, probable-cause, confirmed-cause or
recommended-action column anywhere in it. `findings` (severity + disposition +
free text) and `recommendations` (free text + priority) are the only
judgement-bearing entities. A UI that promises "technician diagnosis" in the
Owner's sense will be writing free text into a findings row.

**The template catalogue is empty and unreachable.** `dia.diagnostic_types`,
`dia.inspection_templates`, `dia.template_versions` and `dia.template_items`
hold zero rows and have **zero API operations**. A diagnostic report is created
by instantiating a published template version. With no templates and no way to
create one, **no workshop can open any inspection** (`INS-09`, Critical). This
is the single most consequential gap in the phase.

## 6. Exclusions — binding

**From P1-28** (`phase-1-28/canonical-plan.md:220-234`), quotable and binding:

> P1-28 owns appointment scheduling, vehicle reception, and the single
> conversion ACTION (`rec.reception-convert-to-work-order`) together with the
> read-only display of its result. No work-order execution, no technician
> boards, no diagnostics authoring — no work-order editing, assignment,
> department routing, progress recording, or diagnostic finding of any kind is
> P1-28 work. Those are P1-29.

And the reason the boundary sits exactly there:

> There is no `POST /work-orders` anywhere in the platform; the conversion
> command is the only way a work order comes to exist.

**P1-29 therefore does not open ordinary work orders.** It receives them. That
quoted boundary is about the ordinary path: the rework route is the second —
and last — path in the platform that inserts a work order, and it is P1-29's.
`POST /work-orders/{id}/rework` (`qms.rework.manage`, A38 in
[permission-matrix.md](permission-matrix.md)) opens a `kind = 'rework'` order
against an original that is **closed and not a cancellation**, item-scoped on
an existing record. There is still no collection create route, and P1-29 must
not invent one.

**Out of scope for P1-29**, from the same boundary and from
`pre-p1-29-…/scope.md`: services and pricing, quotations as a commercial
document, inventory administration, billing, payments, delivery, warranty and
reporting — those are P1-30 and P1-31. P1-29 consumes the parts and approval
contracts; it does not own them.

**No AI or OBD diagnostic capability is in scope.** The canonical requirement
row is "Computer scan", and the Backend models DTC records only. Any AI or
device-integration ambition is a future extension point, noted in
[technician-and-diagnostics-design.md](technician-and-diagnostics-design.md)
and deliberately not designed here.

## 7. Personas

Personas describe the user experience. **They are never the authorisation
mechanism** — every screen and every action is gated on a permission code
evaluated by the Backend, and the persona names below bind to nothing in code.

| Persona                        | What they need P1-29 for                                                           | Primary surfaces                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service advisor / reception    | Hand a received vehicle into the workshop and answer "where is my customer's car?" | Work-order queue, work-order detail (read), timeline                                                                                                                  |
| Workshop manager               | Decide who works on what, unblock, and move the record forward                     | Queue, detail, assignment, transitions, additional work                                                                                                               |
| Technician                     | Execute assigned work and record what was found                                    | Assigned-job queue — reached by supervisor navigation, because a technician cannot reach their own (`INS-04`) — job detail, labour start/complete, findings, evidence |
| Diagnostic technician          | Perform the inspection and report findings                                         | Inspection workspace, findings, measurements, DTC, recommendations                                                                                                    |
| Branch manager / Company Owner | See the branch's load and intervene on exceptions                                  | Queue across branches in scope, privileged transitions, history                                                                                                       |
| QC user                        | Receive the handoff and pass or fail it                                            | QC surface (P1-29 owns the handoff only, not QC administration)                                                                                                       |

The diagnostic technician is **not** a distinct authorisation identity — the
distinction is which permissions the person holds (`dia.diagnostic.record`
versus `wo.job.execute`), which is a capability question, not a role-name one.

## 8. Dependencies

Assembled, because no P1-29 dependency list exists in the P1-29 voice.

| Depends on                | For what                                                          | State                                                                  |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| P1-9 (DB)                 | All 44 tables in `wo`, `dia`, `tech`, `qms`                       | Delivered                                                              |
| P1-19 (Backend)           | 58 operations across work-order, diagnostics, quality, technician | Delivered, with the gaps in [blocker-register.md](blocker-register.md) |
| P1-18 / P1-28 (reception) | Origin of every ordinary work order; rework is created in P1-29   | Delivered                                                              |
| P1-20 (quotation)         | Additional-work approval                                          | Delivered, base-scope approval absent                                  |
| P1-21 (inventory)         | Parts demand and fulfilment                                       | Delivered, demand↔fulfilment link absent                               |
| P1-15 (shared)            | Documents/evidence, notifications, outbox                         | Delivered; the notification consumer is missing                        |
| P1-25 (design system)     | Every component P1-29 renders                                     | Delivered                                                              |
| P1-26/27/28 (Frontend)    | Routing, navigation, auth, table and form conventions             | Delivered                                                              |
| PRE-P1-29                 | Tenant resolution, membership, capability-driven navigation       | Partly delivered — see [permission-matrix.md](permission-matrix.md) §4 |

## 9. Multi-tenant UX rules P1-29 inherits

Non-negotiable, and inherited rather than invented here:

- An employee logs in with email and password. **No workspace UUID, no tenant
  UUID, no tenant picker keyed on an identifier.**
- Tenant and workspace come from the authenticated membership. If one identity
  legitimately belongs to several tenants, the choice is presented with human
  names and logos — never raw UUIDs.
- Every request is independently tenant-authorised by the Backend. **Hiding a
  control in the UI is not authorisation** and is never counted as one.
- No screen displays `tenant_id`, `company_id`, `branch_id`, a role UUID or a
  permission UUID. Users see names; the Backend keeps the identifiers.

## 10. What every P1-29 task will owe

Carried forward from the P1-27 and P1-28 plans, because these are the
obligations those phases learned the hard way:

1. Arabic and English, RTL and LTR, on every screen.
2. A permission-denial path that is designed, not an error page.
3. A cross-tenant and cross-branch negative proof, executed as a restricted
   user rather than asserted.
4. No raw JSON, stack trace, SQLSTATE, UUID, internal enum, permission code or
   database error in any user-facing string.
5. Notifications that do not auto-dismiss, fixed to the viewport top, above page
   content.
6. Evidence that the screen was exercised against a real Backend response, not
   a mock — P1-28 shipped a defect precisely because its DOM tests mocked the
   adapter and never saw the strict schema refuse the payload.
