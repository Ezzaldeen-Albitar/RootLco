# Phase 1-9 — Architecture and Design Gate

**Phase ID:** P1-09 · **Owner module schemas:** `wo` (Work Order), `dia`
(Diagnostics), `tech` (Technician), `qms` (Quality) · **Base:** `origin/develop`
= `8881834` (after Phase 1-8 closure).

**Review model:** Solo Developer Review Policy under the Standing Technical
Authorization Policy — owner-authorized technical, QA, security, and adversarial
self-review; **not** an independent third-party review.

Phase 1-9 is **database-only**: no backend/API (P1-19), no frontend (P1-29), no
quotation/item catalog (P1-10), no billing (P1-11), no full HR/payroll, no real
or fabricated business data. This document is the design gate: **no migration is
written until every decision below is fixed and every Critical/High design
finding is resolved.**

## 1. Physical schema naming — DECISION: four module schemas

**Decision:** create four module schemas — `wo`, `dia`, `tech`, `qms`.

**Canonical source.** ADR-001 (modular monolith) and
[database-architecture.md](../../database/database-architecture.md) §2: _"One
database, one schema per module … a schema is a module boundary, not a
namespace."_ Each schema is created as a controlled schema addition (migration
`0002` reserved only `org/iam/shared/crm/veh`; `apt`/`rec` were added by P1-08 the
same way).

**Why four, not one.** The four domains have **distinct lifecycle owners**:

| Schema | Module      | Distinct lifecycle it owns                                                                                                                    |
| ------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `wo`   | Work Order  | The repair job of record: its configurable state graph, jobs, assignments, service/part lines, additional-work + customer approvals.          |
| `tech` | Technician  | Operational identity of a worker: skills, certifications, availability, labor time — reused by, but not owned by, a work order.               |
| `dia`  | Diagnostics | Inspection/diagnostic templates, versioned reports, findings, measurements, DTCs — attach to a job but are an independent evidentiary record. |
| `qms`  | Quality     | Quality-control records, closure gates, reopen prohibition, rework — an independent control layer over the work order.                        |

P1-08 set the precedent by splitting even the tightly-coupled Appointment and
Reception concerns into two schemas (`apt`, `rec`) on the same rule. Collapsing
these four into one schema would conflate four module boundaries, defeat the
ADR-001 "option to extract a module later" rationale, and would be a
convenience-driven naming choice the instruction forbids.

**Rejected — Option B (a single combined schema, e.g. `ops`).** Rejected: it
violates the one-schema-per-module rule and hides four independent lifecycles
behind one namespace.

**Cross-schema dependency graph (acyclic):**

```
iam.user_accounts ◄── tech.technician_profiles
rec.reception_visits ◄── wo.work_orders            (branch-scoped candidate key)
veh.vehicles (resolved THROUGH rec, never re-copied)
wo.work_orders ◄── wo.jobs ◄── wo.job_assignments ──► tech.technician_profiles
wo.jobs ◄── tech.labor_sessions
wo.jobs ◄── dia.diagnostic_reports ──► dia.template_versions
wo.work_orders ◄── qms.quality_control_records
wo.work_orders ◄── qms.rework_links ──► wo.work_orders (rework target)
shared.document_versions ◄── dia.diagnostic_evidence / wo.customer_approval_evidence
```

Cross-module **reads** (a `wo` closure function reading `qms`/`dia`/`tech` state)
are permitted where grants/RLS allow; cross-module **mutation** of another
module's private tables is prohibited (database-architecture.md §3). Each schema
receives USAGE for `app_runtime`/`app_readonly`/`app_worker`; every table is
`ENABLE`+`FORCE` RLS.

**Downstream implications.** P1-10 references `wo` (work order + service/part
lines + additional-work + the quotation-revision forward field); P1-19 maps one
backend service per schema; P1-29 read-models are per schema. Contracts are
published (Part J), never implemented here.

**Change surface (mechanical).** Every hard-coded schema list
`('apt','org','iam','shared','crm','rec','veh')` gains `'wo','dia','tech','qms'`:
`scripts/db/apply-migrations.mjs`, `tests/db/foundation.test.ts` (all queries),
`tests/db/org-security.test.ts`, `tests/db/no-fake-data.test.ts`, and the new
classification validator (its own list).

## 2. State-graph architecture — configurable routing over fixed safety

**Principle (non-negotiable):** _A state transition is valid only if it exists in
the approved active transition graph._ But configurability must never let a
tenant silently disable a mandatory closure control. So the design separates two
layers:

- **Configurable routing (data):** `wo.work_order_states` /
  `wo.work_order_transitions` and `wo.job_states` / `wo.job_transitions` are
  dual-scope catalogs (platform default OR tenant extension). A tenant may add
  states/transitions, but the transition guard rejects any transition not present
  as an **active** row in the graph.
- **Non-configurable DB safety (code):** the closure gate (§5), the
  no-reopen-of-`closed` invariant (BR-WO-002), append-only ledgers, the
  independent-sign-off rule (BR-QMS-001), and labor-overlap exclusion are enforced
  in triggers/constraints and are **not** data-configurable. A tenant graph can
  route work, but cannot route _around_ a mandatory QC/closure control: the gate
  fires on the transition **into** any state flagged `is_closed`, regardless of
  which configured transition reached it.

State/transition rows carry `scope` + version/active metadata. Terminal and
closed flags live on the state definition, so the gate reads them structurally.

## 3. Work Order state matrix

Platform-default states (a tenant may extend, not weaken). Flags drive the gate.

| State               | terminal | closed | reason req. | jobs run | labor run | add'l work | QC req. | reopenable |
| ------------------- | :------: | :----: | :---------: | :------: | :-------: | :--------: | :-----: | :--------: |
| `draft`             |    no    |   no   |     no      |    no    |    no     |     no     |   no    |     —      |
| `open`              |    no    |   no   |     no      |   yes    |    yes    |    yes     |   no    |     —      |
| `in_progress`       |    no    |   no   |     no      |   yes    |    yes    |    yes     |   no    |     —      |
| `awaiting_parts`    |    no    |   no   |     yes     |   yes    |    no     |    yes     |   no    |     —      |
| `awaiting_customer` |    no    |   no   |     yes     |    no    |    no     |    yes     |   no    |     —      |
| `qc_pending`        |    no    |   no   |     no      |    no    |    no     |     no     |   yes   |     —      |
| `ready_to_close`    |    no    |   no   |     no      |    no    |    no     |     no     |   yes   |     —      |
| `closed`            |   yes    |  yes   |     no      |    no    |    no     |     no     |    —    |   **no**   |
| `cancelled`         |   yes    |  yes   |     yes     |    no    |    no     |     no     |    —    |   **no**   |

Default transitions (platform graph): `draft→open`; `open↔in_progress`;
`in_progress↔awaiting_parts`; `in_progress↔awaiting_customer`;
`in_progress→qc_pending`; `qc_pending→in_progress` (QC fail rework loop);
`qc_pending→ready_to_close`; `ready_to_close→closed`; any non-terminal
`→cancelled`. **`closed` and `cancelled` are terminal and frozen** — no outbound
transition exists (enforced structurally by the terminal flag + the transition
guard + BR-WO-002).

## 4. Job state matrix

| State         | terminal | reason req. | assignment req. | labor allowed |   closure-eligible   |
| ------------- | :------: | :---------: | :-------------: | :-----------: | :------------------: |
| `planned`     |    no    |     no      |       no        |      no       |          no          |
| `assigned`    |    no    |     no      |       yes       |      yes      |          no          |
| `in_progress` |    no    |     no      |       yes       |      yes      |          no          |
| `paused`      |    no    |   **yes**   |       yes       |      no       |          no          |
| `completed`   |   yes    |     no      |        —        |      no       |         yes          |
| `cancelled`   |   yes    |   **yes**   |        —        |      no       | yes (does not block) |

Transitions: `planned→assigned→in_progress`; `in_progress↔paused` (pause requires
a reason); `in_progress→completed`; non-terminal `→cancelled` (requires reason).
`paused→assigned`/`in_progress` allowed (reassignment reason enforced). A job may
not enter `assigned`/`in_progress` without an active assignment (trigger). Labor
may run only in `assigned`/`in_progress`. Every real change emits an append-only
`wo.job_status_history` row.

## 5. Closure-gate architecture

Closing a work order (transition into any `is_closed=true` state that is **not**
`cancelled`) is blocked independently when **any** blocker exists. The gate is a
`wo.guard_work_order_closure()` trigger firing `BEFORE UPDATE OF state` when the
target state's `is_closed` flag is true and it is a _close_ (not a _cancel_).
`cancelled` bypasses work-completeness blockers but still records history.

| #   | Blocker                                                                          | Deterministic error | Independent negative test                            |
| --- | -------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------- |
| B1  | A non-terminal job exists                                                        | `23514` (raise)     | close with an `in_progress` job → rejected           |
| B2  | An active (open-ended) labor session exists                                      | `23514`             | close with an open `tech.labor_session` → rejected   |
| B3  | An additional-work request is `pending`/`approved`-but-not-executed and required | `23514`             | close with a `pending` request → rejected            |
| B4  | A mandatory diagnostic report is not `completed` (missing mandatory answers)     | `23514`             | close with an incomplete mandatory report → rejected |
| B5  | A mandatory QC record is missing or `failed`                                     | `23514`             | close with a failed/missing mandatory QC → rejected  |
| B6  | A safety-critical rework lacks independent sign-off                              | `23514`             | close with unsigned safety rework → rejected         |

Each blocker has an independent negative test and concurrency behaviour (two
concurrent closes → exactly one wins; §Wave 7). **Forward boundary:** stock
reservation is P1-10/P1-11 — the gate does **not** claim reservation enforcement;
work orders carry an explicit `parts_forward_state` text contract field (default
`none`) with a CHECK, never a fake FK. B3 blocks on the additional-work request
state, which is real in this phase.

## 6. Reception-origin contract

Each work order references exactly one P1-08 reception visit via the branch-scoped
candidate key: `FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id)`. Same
tenant/company/branch/Vehicle is FK-enforced; the Vehicle is resolved **through**
the reception visit and re-stored as `vehicle_id` **only** with a coherence guard
asserting it equals the visit's Vehicle (never independently editable). Required
preconditions at insert (guard): the visit's `reception_status` is `authorized`
or `converted`, it has accepted custody (`rec.custody_history` `accepted`), and an
approved `rec.authorizations` row. A partial-unique index blocks a **second
ordinary** work order per reception origin (`WHERE kind='ordinary' AND deleted_at
IS NULL`); a `rework` work order (kind=`rework`) reuses the original reception
visit and is exempt. Reception data (complaints, inspection, custody,
authorization, party roles) is **referenced, never copied** (P1-08 → P1-09
structural contract).

## 7. Technician privacy model

`tech.technician_profiles` references the app identity anchor:
`FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id)`.
It stores **operational** data only: home branch, trade/discipline, active flag,
hire-for-workshop flag. It **must not** duplicate salary, government IDs, personal
contact, medical, or payroll data — none of which exists in the schema and none of
which this phase adds in the clear. Any genuinely restricted technician attribute
(e.g. certification number) lives either as an `internal` operational field or, if
truly sensitive, in a 1:1 restricted table gated by
`iam.has_permission('iam.sensitive.view')` (§restricted pattern). Labor-time and
performance-derivable fields are classified `internal` (not public) and only
visible in scope.

## 8. Labor-session model

`tech.labor_sessions`: `(tenant, company, branch, technician_profile_id, job_id,
started_at, ended_at NULL, source, correction_of_id NULL, actor)`. Invariants:

- **≤ 1 active session per technician:** partial-unique
  `(tenant, technician_profile_id) WHERE ended_at IS NULL AND deleted_at IS NULL`.
- **No overlap:** `EXCLUDE USING gist (technician_profile_id WITH =, tstzrange(
started_at, coalesce(ended_at,'infinity')) WITH &&) WHERE (deleted_at IS NULL)`
  — race-safe single-writer (`23P01`).
- **End after start:** `CHECK (ended_at IS NULL OR ended_at > started_at)`.
- **No backdating beyond contract:** guard rejects `started_at` older than the
  job's creation minus a tolerance; corrections are linked via
  `correction_of_id`, never silent rewrites (the original row is immutable).
- **Same job/technician scope:** composite FKs.
- **Closed work order accepts no new labor:** guard checks the parent WO state is
  not `is_closed`.
- Real parallel race test (§Wave 7): two simultaneous starts → one `23P01`/`23505`.

## 9. Additional-work and approvals

`wo.additional_work_requests` (originating job/finding, state
`pending→approved|rejected|withdrawn`, safe summary) + a 1:1 restricted
`wo.additional_work_request_details` (customer-facing description).
`wo.customer_approvals` (deciding party role via `rec.reception_party_roles`,
channel, decision time, exact presented scope snapshot, **`quotation_revision_ref`
uuid NULL** forward field — no FK, P1-10 does not exist). `wo.customer_approval_evidence`
binds an **exact immutable `shared.document_versions`** row; append-only, no
substitution. Unapproved required additional work is identifiable
(`state='pending'`) and blocks execution/closure (B3). No quotation/item table is
created.

## 10. Diagnostic templates and reports

`dia.inspection_templates` (dual-scope) → `dia.template_versions` (immutable once
referenced by any report; a `published` version is frozen by trigger) →
`dia.template_items` (per-version required items: unit, validation rule, mandatory
flag, `diagnostic_type`). `dia.diagnostic_reports` (FK job, pinned
`template_version_id`, status `draft→in_progress→completed|cancelled`, revision
number). A report retains its **exact** template version; changing the template
makes a new version, never mutating referenced ones. `dia.findings`
(severity/disposition constrained enums), `dia.measurements` (unit **required**,
value + within-range flag), `dia.dtc_records` (code format checked),
`dia.diagnostic_evidence` (binds exact `shared.document_versions`; no
replacement), `dia.recommendations`, `dia.diagnostic_reviews` (reviewer
attribution, server-stamped). Completion gate: a report cannot reach `completed`
while a mandatory `template_item` has neither a result nor a documented
not-applicable reason (guard). `dia.diagnostic_report_status_history` is
append-only. Report revisions preserve prior versions.

## 11. QC and rework architecture

`qms.qc_checks` (dual-scope config; `is_mandatory`, `is_safety_critical`).
`qms.quality_control_records` (FK work order, overall result
`pending/passed/failed`, checker, time). `qms.qc_check_results` (per configured
check: result, note). `qms.reopen_attempts` (append-only rejection log — every
attempt to reopen a `closed` WO is recorded and rejected). `qms.rework_links`
(links a **rework** work order to the original closed WO: root cause, corrective
action, responsibility, rework cost, `independent_sign_off_by`,
`sign_off_at`). **BR-QMS-001:** a safety-critical rework requires independent
sign-off, and the correcting technician (the rework WO's lead/last labor
technician) **must not** be the sole final approver — a guard rejects
`independent_sign_off_by = correcting_technician`. `qms.qc_status_history` is
append-only.

## 12. Append-only / correction matrix (summary)

| Category                                | Tables                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Mutable master                          | work_orders, jobs, diagnostic_reports, technician_profiles, quality_control_records, rework_links                                      |
| Mutable-temporal                        | job_assignments, technician_availability                                                                                               |
| Append-only ledger (SELECT+INSERT only) | work_order_status_history, job_status_history, diagnostic_report_status_history, qc_status_history, reopen_attempts, labor_sessions(*) |
| Correction-linked                       | labor_sessions (via `correction_of_id`; original immutable)                                                                            |
| Immutable after publication             | template_versions (published), all *_evidence, customer_approvals (decided)                                                            |
| Soft-deletable configuration            | all dual-scope catalogs, template_items                                                                                                |

(*) labor_sessions are mutable only to set `ended_at` once and to soft-delete;
`started_at`/scope/technician are immutable; corrections add a new linked row.

## 13. Branch-scope and RLS matrix

Every business table carries `(tenant_id, company_id, branch_id)` with
`UNIQUE (tenant_id, company_id, branch_id, id)` and a composite FK to
`org.branches`. Children carry full scope + composite FK to the parent's scope
candidate key. RLS on every table (`ENABLE`+`FORCE`), branch policy:
`tenant_id = iam.current_tenant_id() AND (allowed_company_ids() IS NULL OR
company_id = ANY(...)) AND (allowed_branch_ids() IS NULL OR branch_id = ANY(...))`.
Dual-scope catalogs use the platform-or-tenant read / tenant-only write policy.
Restricted 1:1 tables add `iam.has_permission('iam.sensitive.view')` on all of
sel/ins/upd. Runtime = SEL/INS/UPD (no DELETE); readonly = SEL; append-only =
SEL/INS. Worker access only where an infrastructure need is proven (none expected
in P1-09; documented if added). No-context (`tenant_id` unset) → default deny.
**Relational scope consistency does not rely on RLS alone** — composite FKs
enforce it structurally.

## 14. Index plan (FK-coverage aware)

Every FK gets a **non-partial** covering index whose leading columns as a set
equal the FK columns (P1-03-DB-017; enforced by the org-security guard). No
duplicate `(table, indkey)` non-partial indexes. Planned beyond FK coverage:
active display-number unique per tenant; open WOs by `(tenant,company,branch,
state)`; reception origin; Vehicle WOs; jobs by `(wo,state)`; active labor session
by technician (partial); labor by `(branch, started_at)`; skills/certs; expiring
certs (`expires_at`); availability (gist); additional-work by state; approvals;
reports by `(job,status)`; findings by report; DTCs; measurements; QC by status;
rework links; every append-only ledger by `(scope, entity, occurred_at DESC, seq
DESC)`.

## 15. Design-review disposition

Adversarial self-review lenses run before Wave 2: data architecture, WO lifecycle,
technician/labor concurrency, diagnostics/versioning, QC/closure gates,
security/privacy, branch isolation, red team. **Gate to proceed:** zero unresolved
Critical, zero unresolved High; schema naming, state graph, closure gate,
reception origin, labor-overlap model, diagnostic-version model, and QC/rework
model all approved above. Findings and their resolutions are recorded in
[phase-1-9-review-response.md](phase-1-9-review-response.md).
