# Owner requirement reconciliation — 16/16 accounted for

Source: `docs/product/owner-workflow-requirements.md:220-239`, re-audited against the tree at
`c081a019`. "Contracted" is defined at `:19` as _"The Backend contract exists and is proven; no
Frontend consumes it yet."_

**Accounted for** means each requirement has a current-support statement, a named missing capability
where one exists, a `BR-` owner or an explicit deferral, an expected P1-29 UX, and an acceptance
test. It does **not** mean all sixteen are deliverable today — seven are not.

---

## 1. The matrix

| #      | requirement                                                  | Owner status                     | verified support                                                                                                                                                                   | missing capability                                  | `BR` owner               | acceptance test                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | Work order is the central operational record after reception | Planned                          | **Supported** — 26 work-order operations                                                                                                                                           | none                                                | —                        | the board lists work orders a reception conversion produced, and P1-29 designs **no** duplicate create form                                                                                                                |
| **2**  | Work order tied to the selected customer and vehicle         | **Blocked** `INT-036`            | **Vehicle yes, customer no** — no customer column in any of the 44 tables                                                                                                          | a dated customer projection on the work-order read  | **`BR-05`**              | board and detail show the customer for **both** appointment- and walk-in-originated orders, under `wo.work_order.read` alone; and **P8** — a later ownership change does not alter a closed work order's recorded customer |
| **3**  | Multiple departments may work on one vehicle                 | **Blocked** `INT-042`            | **Confirmed, and narrower than stated** — `org.departments` exists with full authorization-layer support; zero rows, no HTTP surface, no `department_id` on any work-domain record | department rows (Wave C) + `wo.jobs.department_id`  | **`BR-02`** + **Wave C** | one work order, two jobs, two departments, each department's view showing only its own — enforced by the authorization layer, not a client filter                                                                          |
| **4**  | Configurable department list                                 | **Blocked** `INT-042`            | Confirmed — zero rows, no route                                                                                                                                                    | a department administration surface                 | **Wave C** (hard)        | a department is created, renamed and archived through sanctioned operations; archiving frees its code                                                                                                                      |
| **5**  | Assign named employees and technicians                       | **Blocked** `INT-045`, `INT-047` | **Assignment works; the technician has no name**                                                                                                                                   | a roster write surface and a profile read           | **`BR-03`**              | a tenant with zero technicians acquires one through a sanctioned operation, and the assignment screen shows the profile rather than a bare UUID. **Note: the platform holds no personal name** — see §2                    |
| **6**  | Notify the assigned employee                                 | **Blocked** `INT-100`            | Confirmed — `job.assigned` is published and consumed by nobody                                                                                                                     | one outbox consumer                                 | **`BR-09`**              | an assignment produces a notification the assignee can see, and **a failed delivery is visible rather than silent**                                                                                                        |
| **7**  | Start / pause / resume / complete a task                     | Partly blocked `INT-048`         | **Start and complete exist; pause and resume are compositions**                                                                                                                    | not an endpoint — the **data** to compose correctly | **`BR-06`**              | a technician starts, pauses with a reason, resumes and completes; and on a partial failure the UI names the step that failed and offers the completing step, not a blanket retry                                           |
| **8**  | Progressive work logging                                     | **Blocked** `INT-049`            | Confirmed — no work-log table, no note bound to a job or assignment                                                                                                                | `wo.job_work_logs`, append-only                     | **`BR-06`**              | a technician records progress against a job and it appears in the work order's history for a caller who may read it, and is absent for one who may not                                                                     |
| **9**  | Diagnostic findings                                          | Contracted                       | **Available on paper, unreachable in fact** — 13 operations, and no report can be created                                                                                          | template authoring                                  | **`BR-04`**              | a finding is recorded against a real report opened from a real published template version                                                                                                                                  |
| **10** | Computer scan                                                | Planned                          | **DTC records exist; no scan ingestion surface**                                                                                                                                   | ingestion — **out of scope**                        | **DEFERRED**             | DTCs are entered by hand against the format CHECK `^[PBCU][0-9][0-9A-F]{3}$`. **No AI or OBD device integration is in P1-29 scope**; it is a future extension point and deliberately undesigned                            |
| **11** | Technician diagnosis                                         | Contracted                       | **Available as a checklist model**                                                                                                                                                 | template authoring                                  | **`BR-04`**              | a technician answers a published checklist, records measurements and findings, and completes the report. **See §3 — this is not "diagnosis" in the Owner's sense**                                                         |
| **12** | Work evidence                                                | **Blocked** `INT-093`…`095`      | Confirmed — evidence attaches to a report and an approval, **not to a job**                                                                                                        | `wo.job_evidence`                                   | **`BR-07`**              | a technician attaches a photograph to the work they did, through the existing document chain, and it appears on the job and on the work order                                                                              |
| **13** | Blockers                                                     | Planned                          | **No blocker or escalation record exists** (`VHM-16`)                                                                                                                              | new modelling nobody has scoped                     | **DEFERRED**             | none in P1-29. The existing expression is a **supervisor's** work-order transition with a reason, not a technician's note about one job, and the UI must not present it as the latter                                      |
| **14** | Additional-work request                                      | Contracted                       | **Available, with item-granular approval**                                                                                                                                         | none                                                | —                        | a request is raised, the customer's decision is recorded under a **separate** authority, and `ERR-WO-002` prevents starting unapproved required work                                                                       |
| **15** | Submit for QA                                                | Contracted                       | **Available** — 13 quality operations                                                                                                                                              | **a QC check catalogue** — zero rows (`INS-38`)     | **DEFERRED**             | a work order is presented for QC, a record opened and finalized. **The checklist renders empty and the screen says so** — see §4                                                                                           |
| **16** | Complete work-order history                                  | Partly contracted `INT-043`      | Confirmed — four separate timelines, no unified read (`BR-06` makes it five)                                                                                                       | a server-side merge                                 | **DEFERRED**             | history is shown **per source**, each labelled, or merged with the `read-completeness` helpers and **labelled honestly**. A merged stream claimed complete is a defect                                                     |

## 2. Requirement 5 — the part that will surprise

`BR-03` closes the roster and the profile read. It does **not** produce a _name_, and the acceptance
test above says so deliberately.

`tech.technician_profiles` holds `user_id`, `trade`, `is_active` and `employment_ref`, and its own
`COMMENT` states the rule:

> _"NEVER duplicates salary/government-id/contact/medical/payroll data. `employment_ref` is an
> opaque non-PII operational link."_

A display name would have to come from `iam.user_accounts`, which is a different module under a
different authority, and **no directory read exists** (`admin.contractGap.noDirectory`). This is the
same position approval-limits and appointments already ship.

**So requirement 5 is met as _"assign an identified technician"_, not as _"assign a named
person"_.** If the Owner requires a rendered human name, that is a directory contract — a separate
slice in a separate module — and it should be raised now rather than discovered at acceptance.

## 3. Requirement 11 — a divergence worth stating before it is built

The `dia` schema implements a **template-instantiated checklist**. There is no symptom, complaint,
probable-cause, confirmed-cause or recommended-action column anywhere in it. `findings` (severity ×
disposition × free text) and `recommendations` (free text + priority) are the only judgement-bearing
entities.

> A UI that promises "technician diagnosis" in the Owner's sense will be writing free text into a
> findings row.

The system that exists is: _answer the checklist, record what you measured, record what you found,
recommend what to do._ A screen showing "symptom → probable cause → confirmed cause → recommended
action" is describing a system that does not exist.

**Accounted for, and flagged as a wording risk rather than a code gap.**

## 4. Requirement 15 — Contracted, and empty

QC works: a record opens, check results are written, and the record is finalized under a separate
authority. **`qms.qc_checks` holds zero rows and nothing can author one** (`INS-38`).

Unlike diagnostics, opening a QC record does **not** require a catalogue, so QC degrades to an empty
checklist rather than being unreachable — which is why this is a deferral and `INS-09` is a
Critical.

**The screen must say the checklist is empty. It must not invent checks**, and no seed may supply
them: that would be fabricated business data.

If the Owner wants QC checklists, the work is a **`BR-10` shaped exactly like `BR-04`** — a
catalogue authoring surface, one permission code, no schema change. It is named in
[finding-reconciliation.md](finding-reconciliation.md) §4 as the strongest deferral in the plan.

## 5. Counts

|                                             | count       | requirements                                                                                                   |
| ------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| **supported today**                         | 3           | 1, 14, and 15 in its degraded form                                                                             |
| **owned by a `BR` slice**                   | 8           | 2 (`BR-05`), 3 (`BR-02`), 5 (`BR-03`), 6 (`BR-09`), 7 (`BR-06`), 8 (`BR-06`), 9 and 11 (`BR-04`), 12 (`BR-07`) |
| **owned by PRE-P1-29 Wave C**               | 1           | 4                                                                                                              |
| **deferred with an explicit justification** | 4           | 10, 13, 15 (the catalogue half), 16                                                                            |
| **mapped**                                  | **16 / 16** |                                                                                                                |

_(Requirement 3 is counted once, under `BR-02`; its administration half also depends on Wave C.
Requirement 15 appears twice — supported in its degraded form, deferred for its catalogue.)_

## 6. What closure requires

`execution-decision.md` §3 is unchanged by this plan and governs:

1. Every Backend prerequisite a delivered frontend capability depends on is **closed and proved**,
   by the acceptance proof recorded against it.
2. The canonical Owner requirements — **including the Diagnostics experience** — are met, **or are
   explicitly deferred by a recorded Owner decision naming the phase that will own each one.
   Silence is not deferral.**
3. An explicit **`OWNER ACCEPTANCE: PASS`** against a production build. **Silence is not Pass.**

**The four deferrals in §5 are this plan's proposals, not recorded Owner decisions.** Requirements
10, 13, 16 and the QC-catalogue half of 15 need an Owner decision naming a future phase before P1-29
can close with them outstanding. Raising them now is the point of this document; discovering them at
acceptance is what `execution-decision.md` §1.2 exists to prevent:

> **IMPLEMENTATION ORDER MUST CHANGE — PHASE SCOPE MUST NOT SHRINK.**
