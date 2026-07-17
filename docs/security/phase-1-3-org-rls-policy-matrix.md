# Phase 1-3 — Organizational RLS Policy Matrix and Abuse Cases

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-3 · **Date:** 2026-07-17 · **Tasks:** P1-03-DB-018, P1-03-SEC-001/002/004 ·
**Review:** owner-authorized self-review
([Solo Developer Review Policy](../governance/solo-developer-review-policy.md))

Every claim in the matrix is pinned by an executable test run as the **non-owner
runtime login**; the structural invariants (RLS enabled AND forced everywhere, no
BYPASSRLS, no runtime ownership, DELETE granted nowhere) are asserted by
`tests/db/foundation.test.ts` and `tests/db/org-security.test.ts` for every current
AND future module table.

## 1. Table classification and policy matrix

Legend — R: tenant-scoped SELECT · W: tenant-scoped INSERT/UPDATE ·
I: INSERT-only (append) · «none»: no application-role access at all.
"Narrowing" means the optional `app.company_ids` / `app.branch_ids` context lists
further restrict visibility (NULL = tenant-wide), matching the Phase 1-2 allocator
semantics.

| Table                          | Class                             | app_runtime        | app_readonly  | Policy notes                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------- | ------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.currencies`            | platform reference, read-only     | R (all rows)       | R             | Read policy `USING (true)`; no write policy or grant exists                                                                                                                                                                  |
| `shared.timezones`             | platform reference, read-only     | R (all rows)       | R             | same                                                                                                                                                                                                                         |
| `shared.languages`             | platform reference, read-only     | R (all rows)       | R             | same                                                                                                                                                                                                                         |
| `org.tenants`                  | ROOT (documented exception)       | R (self row only)  | R (self)      | `id = iam.current_tenant_id()` — enumeration structurally impossible                                                                                                                                                         |
| `org.tenant_status_history`    | tenant-owned, append-only         | R (tenant)         | R             | INSERT only via the platform transition function; no app write at all                                                                                                                                                        |
| `org.feature_flags`            | platform-managed, tenant-readable | R (all rows)       | R             | definitions immutable to tenants                                                                                                                                                                                             |
| `org.subscription_plans`       | platform-managed, tenant-readable | R (non-draft only) | R (non-draft) | drafts are administrative data, hidden                                                                                                                                                                                       |
| `org.tenant_subscriptions`     | tenant-owned, platform-written    | R (tenant)         | R             | assignment is a platform operation in this phase                                                                                                                                                                             |
| `org.legal_companies`          | tenant-owned                      | R+W (narrowing)    | R             | soft delete via UPDATE; DELETE granted to nobody                                                                                                                                                                             |
| `org.branches`                 | tenant/company scoped             | R+W (narrowing)    | R             | composite FK carries tenant; live-parent guard on INSERT                                                                                                                                                                     |
| `org.branch_status_history`    | tenant-owned, append-only         | R + I (tenant)     | R             | the pinned Phase 1-2 history pattern; no UPDATE/DELETE                                                                                                                                                                       |
| `org.departments`              | tenant/company/branch scoped      | R+W (narrowing)    | R             |                                                                                                                                                                                                                              |
| `org.warehouses`               | tenant/company/branch scoped      | R+W (narrowing)    | R             | structure only; no stock columns                                                                                                                                                                                             |
| `org.storage_locations`        | + warehouse scoped                | R+W (narrowing)    | R             | full warehouse composite FK                                                                                                                                                                                                  |
| `org.cost_centers`             | tenant/company scoped             | R+W (narrowing)    | R             | effective-dated EXCLUDE                                                                                                                                                                                                      |
| `org.company_settings`         | tenant/company scoped, versioned  | R + I              | R             | versions immutable (UPDATE pinned for everyone incl. admin by the identity trigger); no INSERT-then-edit path; DELETE granted to no application role (a superuser/admin can still hard-delete — platform credential hygiene) |
| `org.branch_settings`          | + branch scoped, versioned        | R + I              | R             | same                                                                                                                                                                                                                         |
| `org.tax_classes`              | tenant/company scoped             | R+W (narrowing)    | R             |                                                                                                                                                                                                                              |
| `org.tax_rates`                | tenant/company scoped             | R+W (narrowing)    | R             | NUMERIC only; overlap EXCLUDE                                                                                                                                                                                                |
| `org.tenant_feature_overrides` | tenant-owned, platform-written    | R (tenant)         | R             | platform-assigned; overlap EXCLUDE                                                                                                                                                                                           |
| `shared.number_sequences`      | tenant-owned (Phase 1-2)          | R + UPDATE(cols)   | R             | unchanged; org FKs added by Phase 1-3                                                                                                                                                                                        |
| `shared.idempotency_keys`      | platform-only                     | «none»             | «none»        | RLS forced with zero policies and zero grants — denied twice                                                                                                                                                                 |

`org.tenants` exposes only the **minimum safe self-tenant projection**: a session
reads its own row (status, defaults) and nothing else. Platform-operator
administration (create/suspend/close tenants, assign subscriptions and overrides,
run provisioning) is deliberately **not** an application-role capability in this
phase; it runs via the admin/migration role until the Phase 1-4/1-14 authorized
surfaces exist. No Phase 1-4 role or membership object was created.

## 2. Abuse cases (P1-03-SEC-004)

For each: the control that exists NOW, what future phases add, and the residual.
Nothing below claims a future control is implemented.

| #   | Abuse case                                    | Database control (now, tested)                                                                                                  | Future control                                                                  | Audit expectation          | Residual risk                                                                       |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Tenant enumeration by a runtime session       | Self-row-only policy on `org.tenants`; no-context = zero rows (`org-tenants` suite)                                             | 1-4 session issuance; 1-14 rate limits                                          | future access logs         | Admin/BYPASSRLS connections see all — platform credential hygiene (SECURITY.md)     |
| 2   | Cross-tenant company/branch linkage           | Composite FKs carry tenant through every reference — FK violation, not a filter (`org-hierarchy`, `org-structure` suites)       | none needed (structural)                                                        | n/a                        | none at DB layer                                                                    |
| 3   | Tenant-suspension bypass                      | Status constrained + queryable; transitions only via the atomic function; runtime cannot UPDATE tenants                         | **1-4 MUST refuse sessions for suspended/closed tenants** (recorded obligation) | history rows               | Until 1-4, enforcement point does not exist — no sessions exist either (no backend) |
| 4   | Rewriting append-only history                 | No UPDATE/DELETE grant or policy on either history table (42501 tested)                                                         | 1-14 surfaces                                                                   | history IS the audit       | Table owner/admin can still ALTER — Phase 1-2 documented owner limit                |
| 5   | Feature-override abuse                        | Overrides platform-written; overlap EXCLUDE; definitions immutable to tenants; deterministic precedence function                | 1-14 override admin with approval flow                                          | override reason mandatory  | admin misuse — platform credential hygiene                                          |
| 6   | Subscription-interval manipulation            | Active-overlap EXCLUDE per tenant; tenant/plan immutable per row; runtime write-denied                                          | 1-14 assignment surface                                                         | assignment rows preserved  | same                                                                                |
| 7   | Settings tampering                            | Versions immutable (no update path for ANY app role; identity trigger pins admin too); typed validation; no secrets rule        | 1-14 settings catalogue                                                         | full version history       | catalogue (allowed keys) not yet enforced — documented 1-14 work                    |
| 8   | Sequence enumeration / cross-tenant scope     | Org FKs now structural; RLS tenant-scoped; allocator context-only (Phase 1-2)                                                   | —                                                                               | —                          | none at DB layer                                                                    |
| 9   | Tax-rate manipulation                         | NUMERIC + range CHECK + overlap EXCLUDE + tenant/company RLS + immutable scope                                                  | 1-14 approval flow                                                              | touch metadata             | in-tenant edits are legitimate config changes; approval flows are future            |
| 10  | Provisioning replay / partial provisioning    | ONE transaction incl. the idempotency row; failure injection proven at 3 steps; replay returns stored response; conflict raises | 1-14 backend provisioning API                                                   | idempotency + history rows | concurrent same-key race resolves via unique key (one wins; retry replays)          |
| 11  | Platform-table modification by tenant runtime | No write grant AND no write policy on flags/plans/idempotency (denied twice; 42501 tested)                                      | —                                                                               | —                          | none at DB layer                                                                    |
| 12  | Pilot-tenant hard-coding creep                | CI scope-exclusion guard (exact allow-list) + zero-trace test over pg_proc/information_schema + generic second tenant           | —                                                                               | guard output in CI         | prose mentions allowed by design                                                    |

## 3. Honest limits

- Every result is owner-authorized self-review; no independent verification exists
  (P1-EC-016 open).
- RLS protects against application-role access, not against the table owner or
  BYPASSRLS platform roles — the Phase 1-2 documented limit, unchanged.
- FR-ORG-004 ("block branch deactivation while active work orders exist") cannot be
  database-enforced before work-order tables exist; it is recorded as a Phase 1-14
  obligation, not pretended here.
