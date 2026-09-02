# Phase 1-29 — Work Order, Diagnostics and Technicians — canonical plan

**Status:** ACTIVE · **Base:** protected `develop` `2a0285ec` · **Lane:** Frontend
(`feature/p1-29-` → ownership profile `p1-29-frontend`)

---

## 0. Why this document exists

Before it, the phase's canonical surface on protected `develop` was two documents written by
other phases — a requirement table owned by the product register and a read-model contract
written twenty phases earlier — and one load-bearing rule that was not on `develop` at all.

The governing register, `RootLco_Phase_1_Development_Plan_recovered_v01.docx`, is deliberately
outside Git (`docs/governance/canonical-documents.md`, `"committedToGit": false`), so nothing
in the repository could answer _what closes this phase_ without leaving it.

This document answers four questions and nothing else: what P1-29 owns, what it does not own,
what its work items are, and what completion means. It is a **binding record, not a plan
revision.** Where an authority already exists it is CITED, never copied — a second copy of a
requirement table is a second thing to drift.

**What was recovered, and from where.** The closure condition in §3 was recovered from branch
`planning/p1-29-work-order-diagnostics-technician-preparation` at commit `b5be9f4c`, file
`docs/phase-1/phase-1-29/execution-decision.md` lines 28-30. That branch is **not merged and is
not being merged.** It carries fourteen preparation documents; thirteen of them are preparation
material and are deliberately left where they are. Only the rule below is canonical.

---

## 1. What P1-29 owns

### 1.1 The Owner requirement table — the authority

`docs/product/owner-workflow-requirements.md`, heading `## P1-29 — Work Order, Diagnostics and
Technicians` at line 220, table at lines 222-239.

**That table is the authority. This document does not restate it.** Its shape, so that drift is
detectable: two columns (`Requirement`, `Status`), no id column, **16 data rows** at lines
224-239. Status tally as it stands: `Planned` 3 · `Blocked` 7 · `Partly blocked` 1 ·
`Contracted` 4 · `Partly contracted` 1.

**The Status column predates PRE-P1-29 and is stale.** Every blocker it names has since been
answered by a merged PRE-P1-29 contract, and the reconciliation belongs here rather than in the
Owner's own register:

| Blocker the table names                              | State on `develop` `2a0285ec`                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `INT-036` no customer on a work order                | answered — the work order carries a dated customer/vehicle projection           |
| `INT-042` departments exist nowhere                  | answered — `org.department-create` / `-list` / `-update`, `org.department.read` |
| `INT-045`, `INT-047` no technician profile operation | answered — the `tech.*` surface, including `tech.technician-me-queue`           |
| `INT-048` no pause or resume                         | answered — `tech.labor-session-start` / `-stop` / `-correct`                    |
| `INT-049` no work-log table                          | answered — `wo.job-work-log-record` / `-list`, append-only                      |
| `INT-093`…`INT-095` work evidence                    | answered — `wo.job-evidence-record` / `-list`, `wo.work-order-evidence-list`    |
| `INT-100` no module raises a notification            | answered — `shared.notification-enqueue` and the delivery reads                 |
| `INT-043` history sectioned, not unified             | **NOT answered** — see W6                                                       |

The Owner may wish to restate the Status column. **P1-29 does not edit it**; a Frontend phase
does not rewrite the product register it is measured against.

### 1.2 The read-model contract — the authority

`docs/phase-1/phase-1-9/p1-29-frontend-contract.md`, exactly 27 lines. It names **six** surfaces
and this phase renders all six: work-order board, job/labor view, technician view, diagnostic
report view, quality/closure view, and timelines.

Two of its rules are easy to lose and are repeated here because losing either is a defect:

- evidence is resolved **through the linked document, never by raw object id**;
- restricted narratives — certificate number, additional-work description, rework cost — render
  **only** with `iam.sensitive.view`, while their metadata parents render in scope.

### 1.3 The lane

`apps/web` only. The Backend surface P1-29 consumes was published by P1-15…P1-22 and completed
by PRE-P1-29; this phase adds screens, adapters and the contract mirror that lets them consume
the Backend without importing it.

---

## 2. What P1-29 does not own

### 2.1 The lower boundary, quoted from P1-28

`docs/phase-1/phase-1-28/canonical-plan.md` §6, lines 224-230, binding:

> **P1-28 ends where the work order begins.** P1-28 owns appointment scheduling, vehicle
> reception, and the single conversion ACTION (`rec.reception-convert-to-work-order`) together
> with the read-only display of its result. **No work-order execution, no technician boards, no
> diagnostics authoring** — no work-order editing, assignment, department routing, progress
> recording, or diagnostic finding of any kind is P1-28 work. Those are P1-29.

Read forwards, that sentence is this phase's charter: everything it denies P1-28 is owned here.

### 2.2 Excluded by PRE-P1-29 disposition

- **Tenant tax administration (`org.tax.manage`)** — CANONICAL OUT-OF-SCOPE. Not built, not
  planned, not a P1-29 dependency.
- **Tenant-side subscription mutation (`org.subscription.manage`)** — DEFERRED to platform and
  subscription administration scope.
- **Backend authorship of any kind.** No new operation, permission code, migration, database
  view or authorization framework is P1-29 Frontend work. Where a real runtime proves the
  Backend cannot satisfy a screen, the gap is raised as a Backend item (W5, W6) and travels on
  a Backend branch, never inside a screen.

### 2.3 Not a dependency

`B1-PGNET-BLOCKER` is an external, provider-owned ACL condition on the `net` schema. It remains
**OPEN**. No P1-29 code path touches the `net` schema, and no work item below depends on it.
It is named here only so it is not carried over by association.

---

## 3. Closure condition — the diagnostics experience is mandatory

Recovered verbatim from `planning/p1-29-work-order-diagnostics-technician-preparation`
`b5be9f4c`, `docs/phase-1/phase-1-29/execution-decision.md:28-30`:

> **P1-29 MUST NOT BE DECLARED COMPLETE WITHOUT THE DIAGNOSTICS EXPERIENCE REQUIRED BY ITS
> CANONICAL OWNER REQUIREMENTS.** Closure without it is not a reduced pass; it is not a pass.

This rule is **load-bearing and is not negotiable down**. It is not "optional", not a
"follow-up", not a "future enhancement", and not "a separate later phase". A P1-29 closure
record that does not mechanically prove a working diagnostics experience is invalid, however
green every other gate is.

**An early slice may still ship without diagnostics UI.** The same source says so, and that
permission is about ORDER, not about closure: a slice may land before diagnostics exists;
the PHASE may not close before it does.

**One precondition has changed and the record must say so.** The preparation text blocked the
diagnostics slice on `INS-09` — "there is no HTTP authoring surface and no permission
vocabulary for the diagnostic template lifecycle". That reason is retired: `develop` `2a0285ec`
carries **21 `dia.*` operations**, including the full template lifecycle (`dia.template-create`,
`dia.template-item-create`, `dia.template-version-create`,
`dia.template-version-list-publishable`, `dia.template-version-status-set`) and the execution
and review surface (`dia.diagnostic-create`, `-item-result`, `-finding-record`,
`-measurement-record`, `-dtc-record`, `-recommendation-record`, `-evidence-record`, `-review`,
`-complete`, `-transition`, `-detail`, `-list`, `-history`), gated by `dia.catalogue.manage`,
`dia.diagnostic.read`, `dia.diagnostic.record`, `dia.diagnostic.review` and
`dia.diagnostic.complete`.

**What remains is narrower and precise:** the `dia.diagnostic_types` vocabulary is EMPTY — the
table exists (`supabase/migrations/20260722093000_dia_qms_catalogs.sql`) and no row is seeded,
and no read operation publishes it. That is W5, and it is a real dependency of W7, not a reason
to defer diagnostics.

---

## 4. Execution matrix

Nine items. Each is `MEASURE → CODE → TARGETED PROOF → CONTINUE`. Backend items are marked and
travel on a Backend branch.

| Id     | Item                                                      | Lane     | Adds backend?     |
| ------ | --------------------------------------------------------- | -------- | ----------------- |
| **W1** | Work-order queue and history at `/work-orders`            | Frontend | no                |
| **W2** | This canonical record                                     | Docs     | no                |
| **W3** | Work-order detail: lifecycle, jobs, routing, assignment   | Frontend | no                |
| **W4** | Technician workspace: queue, sessions, work log, evidence | Frontend | no                |
| **W5** | Diagnostic-type vocabulary read operation                 | Backend  | **yes, one read** |
| **W6** | Unified work-order history, and a blocker record          | Backend  | **yes**           |
| **W7** | Diagnostics experience — authoring, execution, review     | Frontend | no                |
| **W8** | Quality and closure view; additional work; submit for QA  | Frontend | no                |
| **W9** | Owner acceptance                                          | Both     | provisioning only |

**W1** — `/work-orders`, consuming `wo.work-order-list` (`wo.work_order.read`, branch scope).
Zero new operations, permissions or migrations. Proves the whole chain — contract mirror →
adapter → gated page → real response — on the smallest surface.

**W3** — `wo.work-order-detail`, `wo.work-order-history`, `wo.work-order-transition`,
`wo.job-list` / `-detail` / `-create` / `-update` / `-transition`, `wo.job-assignment-create` /
`-end` / `-list`, `wo.job-reassignment`. Department routing reads `org.department-list`; it does
not grow a second department picker.

**W4** — `tech.technician-me-queue`, `tech.labor-session-start` / `-stop` / `-correct` /
`-list`, `wo.job-work-log-record` / `-list`, `wo.job-evidence-record` / `-list`.

**W5** — Backend, small: publish a diagnostic-type read operation — PLANNED name
`dia.diagnostic-type-list`, which **does not exist today** — on the existing
`dia.diagnostic.read`. **No new permission code.** Approved vocabulary content is an Owner
input; the operation may ship before content exists, and returns an empty set until it does.

**W6** — Backend: the two Owner requirements with no owning prerequisite. A unified work-order
history read (`INT-043`, requirement row 16) and a blocker record (requirement row 13).

**W7** — the diagnostics experience, on the 21 operations above. **Closure depends on it (§3).**

**W8** — `wo.work-order-closure`, `wo.work-order-closure-eligibility`, QC records and per-check
results, the `B1..B6` closure-gate blocker state, rework links, the append-only reopen-attempt
log, additional-work request and submit-for-QA.

**W9** — Owner acceptance on a production build. **Known executable dependency:** `iam.roles`
holds zero rows, so no human actor carries any domain permission code and every operation
refuses a hand-driven journey. The smallest legitimate provisioning path must be derived from
the existing IAM architecture and executed; a privileged test shortcut is not acceptance.

---

## 5. What completion means

P1-29 is complete when **all** of the following hold. Any one failing means the phase is open.

1. Every one of the **six** read-model surfaces in §1.2 is implemented and reachable.
2. The **diagnostics experience exists and works** (§3), proved mechanically — not asserted.
3. Every screen proves **PC-1 on a real response**: an authorized actor retrieves and sees the
   data; an unauthorized actor is refused; a cross-tenant record is not visible. A route that
   exists, a permission that exists, a hook that exists and a component that renders are **not**
   proof — that combination has shipped operations that answered 500 to every request while
   every structural gate stayed green.
4. No screen renders static fixtures on the production path. Tests may use fixtures; the
   product consumes the real read model.
5. The Frontend/Backend boundary holds: no API source changed by a P1-29 Frontend branch.
6. `scripts/ci/check-p1-29-access.mjs` and `scripts/ci/check-p1-29-payload-parity.mjs` pass **non-vacuously** — with
   route pages actually examined, not zero.
7. Owner acceptance is recorded as an explicit verdict on a production build (W9).

---

## 6. How this document is kept honest

It states no count it does not cite, and copies no authority it can reference. Everything in §1
and §2 resolves against protected `develop` `2a0285ec`; §3's rule resolves against the branch and
commit named there and is otherwise absent from `develop`, which is the reason it was recovered.

The closure condition is discoverable by searching this repository for
`DECLARED COMPLETE WITHOUT THE DIAGNOSTICS EXPERIENCE`.
