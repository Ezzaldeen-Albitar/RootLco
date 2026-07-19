# Phase 1-9 — Design Review-Response Ledger

Adversarial self-review of [phase-1-9-design.md](phase-1-9-design.md) under the
Solo Developer Review Policy (owner-authorized technical/security/adversarial
self-review; **not** independent third-party review). Fourteen findings were
raised; the **binding resolutions** below amend the design and are the
authoritative implementation contract. **Gate rule:** zero unresolved
Critical/High before Wave 2. All Critical/High findings are **resolved by design
amendment** below; no unresolved Critical/High remains.

## Critical

### F1 — Tenant-configurable state flags could route around the closure gate — RESOLVED

**Defect:** if a tenant may write `is_terminal`/`is_closed` flags on its own
`scope='tenant'` state rows, it can define a terminal-but-not-closed state and
never trigger the gate.
**Resolution (binding):**

1. `wo.work_order_states` and `wo.job_states` carry `is_terminal`, `is_closed`,
   `is_cancellation` flags. A **CHECK forbids a tenant row from being terminal /
   closed / cancellation**: `CHECK (scope = 'platform' OR (is_terminal = false AND
is_closed = false AND is_cancellation = false))`. Tenants may add intermediate
   **non-terminal** routing states and transitions only; the terminal/closed/
   cancellation set is **platform-governed**.
2. A **CHECK enforces flag coherence** on every state row:
   `CHECK (is_closed = false OR is_terminal = true)` and
   `CHECK (is_cancellation = false OR (is_terminal = true AND is_closed = true))`
   — closed ⇒ terminal; cancellation ⇒ closed+terminal.
3. The closure gate fires on the transition **into any `is_terminal=true` state**;
   a `is_cancellation=true` target bypasses only the work-completeness blockers
   (B1–B6) but still records history and still enforces the reception-origin/no
   forward mutation rules. A `is_closed=true` non-cancellation target runs the
   full gate.
4. A **hard terminal-freeze trigger** blocks any outbound transition from a state
   whose `is_terminal=true`, independent of whether a tenant graph row
   `closed→open` exists (BR-WO-002 backstop). The transition guard ignores graph
   rows that originate from a terminal state.

### (Overall Critical status) — CLEARED.

## High

### F2 — Close-vs-child-insert race defeats B1/B2/B3 — RESOLVED

**Defect:** the closing `UPDATE` row-lock does not conflict with a concurrent
child `INSERT` (`FOR KEY SHARE`), so a job/labor/additional-work row can be
inserted during a close.
**Resolution (binding):** every child-insert guard that the gate depends on —
`wo.jobs` insert, `tech.labor_sessions` start, `wo.additional_work_requests`
insert — performs `PERFORM 1 FROM wo.work_orders WHERE (scope..) AND id =
NEW.work_order_id FOR UPDATE` and rejects if the parent state is
`is_terminal=true`. This serializes child inserts against the closing UPDATE's row
lock: either the insert waits and sees the closed WO (rejects `23514`), or the
close waits and sees the child (rejects). Wave 7 adds an **interleaved**
concurrency test per blocker (close-vs-insert), not only close-vs-close.

### F3 — Freezing a published template version did not freeze its items — RESOLVED

**Defect:** `dia.template_items` are child rows; freezing the parent version row
left items mutable, corrupting historical reports.
**Resolution (binding):** a `dia.guard_template_item_frozen()` trigger on
`dia.template_items` (BEFORE INSERT/UPDATE/soft-delete) looks up the parent
version's status and **raises `23514` if the parent version is `published`**.
Items are mutable only while the version is `draft`. A report may pin **only a
`published`** version. `template_items` are therefore "soft-deletable
configuration" **only while draft**; once published, the whole version + items are
frozen. §12 amended accordingly.

### F4 — BR-QMS-001 "correcting technician" was not deterministic — RESOLVED

**Defect:** deriving the corrector from labor data at sign-off is a moving/empty
target and ambiguous for multi-tech rework.
**Resolution (binding):** `qms.rework_links` stores `lead_technician_id` (the
correcting technician) **explicitly and immutably** at row creation (in the
immutable-columns guard). It is **NOT NULL when `is_safety_critical=true`**. The
independence guard compares `independent_sign_off_by <> lead_technician_id` at
sign-off; a safety-critical rework cannot be signed off by its own lead
technician, and cannot be signed off at all while `lead_technician_id` is unknown.

### F5 — `reopen_attempts` cannot be both recorded and rejected by a raising trigger — RESOLVED

**Defect:** PostgreSQL has no autonomous transactions; a `RAISE` in the enforcing
trigger rolls back the ledger insert, so the audit log of blocked reopens is
always empty.
**Resolution (binding):** two distinct paths.

- **Sanctioned path:** `qms.attempt_reopen(p_work_order, p_reason)` INSERTs a
  `qms.reopen_attempts` row with `outcome='rejected'` and **returns without
  mutating the work order** (it never reopens). The caller commits the recorded,
  rejected attempt. The function raises nothing.
- **Backstop:** the terminal-freeze trigger (F1.4) hard-blocks any **direct**
  `UPDATE` that attempts to leave a terminal state (`23514`, transaction
  rolled back — a bypass attempt, deliberately not ledgered). BR-WO-002 holds on
  both paths; the audit log is only populated by the sanctioned path, which is the
  only path that can persist.

## Medium

### F6 — INSERT directly in a terminal state bypassed the gate — RESOLVED

A `wo.guard_work_order_refs()` BEFORE INSERT guard rejects a new work order whose
state is not a **non-terminal initial** state (`is_terminal=true` at insert →
`23514`). Reception-origin preconditions are also checked at insert.

### F7 — B3 "approved-but-not-executed" was unenforceable without P1-10 — RESOLVED

`wo.additional_work_requests` gains a self-contained `fulfillment_state`
(`unfulfilled`/`fulfilled`/`waived`, default `unfulfilled`; no P1-10 FK). **B3
(binding, enforceable):** closure is blocked if any **required** additional-work
request is `state='pending'` (undecided) **or** (`state='approved'` **and**
`fulfillment_state='unfulfilled'`). The design text is corrected to this exact
predicate; the "executed" concept is modelled by `fulfillment_state` locally.

### F8 — B4 had no per-WO source of truth for a _required_ report — RESOLVED

`wo.jobs` gains `requires_diagnostic boolean NOT NULL DEFAULT false`. **B4
(binding):** for every job with `requires_diagnostic=true`, a `dia.diagnostic_reports`
row in status `completed` must exist; otherwise closure is blocked (`23514`). B4
asserts _existence of a completed required report_, not merely "no incomplete
report."

### F9 — Correction rows collide with the labor overlap EXCLUDE — RESOLVED

`tech.correct_labor_session(p_original, p_new_started_at, p_new_ended_at, ...)`
soft-deletes the original (setting `deleted_at`, which removes it from the partial
EXCLUDE `WHERE deleted_at IS NULL`) **and** inserts the linked correction
(`correction_of_id = p_original`) **in one transaction**. "Immutable" is defined
as **content-immutable** (the original's business columns never change; only
`deleted_at` is set), consistent with §12's `(*)` note. Wave 7 tests a correction
with an overlapping range succeeding only via this path.

### F10 — Finalized QC result was freely mutable, defeating B5 — RESOLVED

`qms.quality_control_records` carries `overall_result`
(`pending`/`passed`/`failed`). Once it reaches a finalized result
(`passed`/`failed`), an immutable guard freezes `overall_result`, `checker_id`,
and `finalized_at` (`23514` on change). Re-QC creates a **new** record; the old
gating fact cannot be edited after finalization.

### F11 — Certification number under-classified; `rework_cost` unclassified on the billing boundary — RESOLVED

- Certificate numbers are **restricted**: stored in a 1:1 gated
  `tech.technician_certification_details` table (RLS gated by
  `iam.has_permission('iam.sensitive.view')`, `classification='restricted'`
  immutable), mirroring `rec.complaint_details`. The operational
  `tech.technician_certifications` (cert type, issue/expiry, status) stays
  `internal` so eligibility/expiry queries work without the sensitive permission.
- `rework_cost` is retained (the instruction requires it) and classified
  **restricted** as a **cost-of-quality metric** (an internal quality KPI, not a
  billing/invoice line — no billing table is created; documented in the
  classification matrix).

## Low

### F12 — Redundant partial-unique on active labor session — RESOLVED

The overlap EXCLUDE already forbids a second active `[started_at, ∞)` range for a
technician. The `≤1 active session` UNIQUE is **dropped**; a plain (non-unique)
partial index remains for active-session lookup. Non-partial btree covering
indexes for the `technician_profile_id`, `job_id`, and branch-scope FKs are added
separately (the gist EXCLUDE does not cover them).

### F13 — Denormalized `vehicle_id` on the work order could drift — RESOLVED

`wo.work_orders.vehicle_id` is added to the immutable-columns guard **and** the
visit-coherence check runs on **INSERT and UPDATE** (the value must equal the
reception visit's `vehicle_id`). It is retained (not dropped) to serve the
"Vehicle work orders" index/query, but it can never diverge from the reception
origin. This is consistent with the reference-not-copy contract: the vehicle is
**resolved through** the visit and merely mirrored under a hard coherence lock.

### F14 — Single forward migration must interleave `tech`/`wo` tables — RESOLVED

Migration order (binding): schemas → catalogs (wo/tech/dia/qms) →
`tech.technician_profiles`/skills/certs/availability → `wo.work_orders` →
`wo.work_order_status_history` → `wo.jobs`/`wo.job_status_history` →
`wo.job_assignments` → `tech.labor_sessions` → wo service/parts/additional-work/
approvals → dia templates/reports/... → qms QC/rework. Documented so tables are
**not** grouped strictly by schema.

## Disposition

All 14 findings resolved by binding design amendment (5 blockers F1–F5 resolved;
9 non-blockers F6–F14 resolved). **Design gate: PASS** — proceed to Wave 2. Every
resolution above has a corresponding negative/positive test requirement carried
into the Wave-by-Wave test plan and the abuse-case ledger.
