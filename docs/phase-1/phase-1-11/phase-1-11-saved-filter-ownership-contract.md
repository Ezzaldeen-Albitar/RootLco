# Phase 1-11 — Saved-Filter Ownership Contract

**Requirement:** FR-RPT-004, BR-RPT-001 (export scope ≤ report scope), P1-11-DB-018, §17-9 /
M-rpt-1 / M-rpt-2. Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the
Solo Developer Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

## User-owned, owner-only RLS (M-rpt-1)

`rpt.saved_filters`: `report_configuration_id` (composite FK → `rpt.report_configurations(tenant_
id, id)`), `owner_user_id`, `name` (`uq_..._name (tenant, owner_user_id, config, name)`),
`filter_definition jsonb`, `scope_level`. Its grants are **SELECT, INSERT, UPDATE only — no
DELETE grant**; an owner removes a filter by soft-delete (UPDATE `deleted_at`). After this,
**no P1-11 table grants DELETE** to any application role.

Every command's policy pins `tenant_id = iam.current_tenant_id() AND owner_user_id =
iam.current_user_id()` in **USING and WITH CHECK** (`sel`/`ins`/`upd`). A saved filter is
visible and mutable **only to its owning user** within the tenant; removal is by soft-delete
(UPDATE `deleted_at`) — there is no hard `DELETE`, consistent with the platform-wide "hard
delete is never an application capability" invariant. `owner_user_id` is immutable
(`org.guard_immutable_columns`) — a filter **cannot be re-owned**.

## Scope ceiling (M-rpt-2, BR-RPT-001)

`rpt.guard_saved_filter_scope` (BEFORE INSERT OR UPDATE) enforces `saved_filter.scope_level ≤ the
owning report's scope_level` (coarse `scope_level` ordering `branch < company < tenant`) — a
saved filter's export scope **cannot structurally exceed** the report's scope. The fine-grained
jsonb subset check (that `filter_definition` narrows rather than widens) is documented app-tier
work for P1-23.

## No cross-user leak

Because the owner predicate is on every command including SELECT, a different user in the same
tenant sees none of another user's saved filters; a cross-user read/write test asserts denial.

**Tests:** `rpt-reporting`, `p1-11-isolation`.
