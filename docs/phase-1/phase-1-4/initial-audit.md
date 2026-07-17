# Phase 1-4 Initial Audit — Identity, Authorization, Security, and Audit Database

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-4 — Identity, Authorization, Security, and Audit Database ·
**Date:** 2026-07-18 · **Author:** Eng. Ezzaldeen Al-Bitar, under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
(owner-authorized technical self-review — never independent review)

Every fact below was read directly from the repository and the live database on
the development host; nothing is copied from a plan. Provenance labels follow the
Standing Technical Authorization Policy §2.1.

## 1. Starting point and gate-containment proof (Proven)

- **Base branch/SHA:** `feature/p1-04-identity-access-and-scope-schema`, created
  from `origin/develop` at **`d41a747cbb0714f22faab2596beadbada9dccd38`**.
- **Phase 1-3 is formally closed.** The gate-record commit
  `f748d1c8eae6c8bd5d324799367ca47c19b38a2d` is contained in `origin/develop`
  (`git merge-base --is-ancestor` → exit 0), merged via **PR #17 = merge
  `d41a747`** (2026-07-17T21:57:02+03:00, target `develop`). The implementation
  source `417b532` and the corrections `227be2a` are likewise contained.
- **No Phase 1-4 implementation pre-exists:** the `iam` schema holds only the
  Phase 1-2 context readers; there is no `iam` table. Working tree clean.

## 2. Reusable objects (do NOT duplicate)

| Object                                                                                                    | Source                      | Phase 1-4 use                                                                                   |
| --------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| Schemas `org iam shared crm veh`                                                                          | 0002                        | extend `iam` and `shared`; never touch `crm`/`veh`                                              |
| Roles `app_runtime`, `app_readonly` (NOLOGIN, NOBYPASSRLS)                                                | 0002                        | grant new objects per-object only                                                               |
| `iam.current_tenant_id()`, `iam.current_user_id()`                                                        | 0002                        | **reuse verbatim** in every policy and helper                                                   |
| `iam.allowed_company_ids()`, `iam.allowed_branch_ids()`                                                   | 0002                        | keep; add `current_company_ids()`/`current_branch_ids()` as forward-compatible wrappers (§19.B) |
| `shared.touch_row_metadata()`                                                                             | 0002                        | reuse as the BEFORE UPDATE metadata trigger                                                     |
| `org.guard_immutable_columns()` (TG_ARGV)                                                                 | 20260717101000              | reuse for immutable identity/grant columns                                                      |
| append-only history + server-stamp trigger pattern                                                        | 20260717101000/103000       | reuse for `iam.user_status_history` and audit                                                   |
| `shared.idempotency_keys` (RLS forced, no policies/grants)                                                | 20260717107000              | **reuse** (§19.A) — do not create a second idempotency table                                    |
| Test harness (`rootlco_test_runtime` non-owner login, `setContext`, `withRolledBackTx`, `expectSqlState`) | tests/db/helpers.ts         | all isolation assertions run as the non-owner runtime login                                     |
| Exact allow-list guards (tables/routines/triggers/policies)                                               | tests/db/foundation.test.ts | extend all four lists every increment                                                           |

## 3. Migration numbering (Proven)

14-digit `supabase migration new` timestamps are mandatory from Phase 1-3. The
latest committed timestamp is `20260717107000`. Phase 1-4 continues strictly
after it, starting `20260718090000`; migrations 0001–0003 and all `20260717…`
migrations are merged and immutable — corrections happen only via new forward
migrations.

## 4. Forbidden scope (hard boundaries)

No password, password hash, MFA secret, recovery secret, provider access token,
refresh token, or session token in any table (identity provider stays the
credential authority). No backend API, Server Action, or frontend. No HR
employee master (only a placeholder `employee_ref`). No Phase 1-5 schema, no CRM
or vehicle table. No Benzene-specific user, role assignment, or authorization
logic. No Zoom object.

## 5. Required design reconciliations (§19) — decided before writing migrations

- **A. Idempotency.** `shared.idempotency_keys` already exists with a generic
  `(tenant_id, operation, idempotency_key)` scope, fingerprint match/conflict,
  response snapshot, and expiry. It already satisfies **P1-04-DB-019** for IAM
  operations; Phase 1-4 **reuses it unchanged** and adds no duplicate. Status:
  **already satisfied**.
- **B. Context functions.** The context contract exposes
  `current_tenant_id`/`current_user_id`/`allowed_company_ids`/`allowed_branch_ids`.
  Phase 1-4 adds `iam.current_company_ids()`/`current_branch_ids()` as thin
  wrappers over the existing `allowed_*` readers (no behavioural conflict) and
  the new `iam.has_permission()`/`has_permission_in_scope()`; the two existing
  readers are reused verbatim.
- **C. Deny precedence (BR-IAM-001).** `iam.role_permissions` carries an
  explicit `effect` column (`allow` | `deny`). Resolution is deterministic: a
  matching `deny` from ANY of the user's active in-scope grants overrides every
  `allow`. Deny precedence is therefore a **persisted state**, not an assumption.
- **D. Required grant scopes.** A plain `CHECK` cannot require that a child
  `grant_scopes` row exists. A scope-limited grant is instead modelled with an
  explicit `scope_mode` (`unrestricted` | `scoped`) and a **DEFERRABLE INITIALLY
  DEFERRED constraint trigger** that, at COMMIT, requires ≥1 `grant_scopes` row
  when `scope_mode='scoped'`. No race-prone immediate trigger is used.
- **E. Audit hash chain.** Each tenant has an independent chain. Appends
  serialize per tenant via `pg_advisory_xact_lock(hashtext('iam.audit:'||tenant))`
  so concurrent writers cannot fork a chain. The canonical serialization is the
  ordered JSON of (tenant, seq, prev_hash, actor, action, target, occurred_at,
  correlation, details digest); `record_hash = sha256(prev_hash || canonical)`.
  Genesis `prev_hash` is 32 zero bytes. A verification function walks the chain
  and reports the first broken/missing link. No external anchoring is claimed.
- **F. Auditing audit reads.** Database RLS does **not** append an audit row for
  every SELECT (unsafe). Phase 1-4 stores and access-restricts audit data;
  audit-view **access logging** is explicitly deferred to the Phase 1-14/API
  layer. This limit is stated, not hidden.
- **G. Phase 1-5 consumer.** The helper usage guide is validated with a
  **test-only** synthetic consumer policy on a disposable fixture table — no
  Phase 1-5 business schema is created.

## 6. Expected task → evidence map (targets; marked Complete only on real evidence)

| Task group                      | Increment | Evidence target                                                                   |
| ------------------------------- | --------- | --------------------------------------------------------------------------------- |
| P1-04-DB-001..004               | A         | `iam.user_accounts/user_profiles/user_employee_links/user_status_history` + tests |
| P1-04-DB-005..007               | B         | `iam.roles/permissions/role_permissions` + deny-precedence tests                  |
| P1-04-DB-008..009               | C         | `iam.role_grants/grant_scopes` + deferred-scope + cross-tenant tests              |
| P1-04-DB-010..011               | D         | `iam.approval_limits/sensitive_data_permissions` + overlap/point-in-time tests    |
| P1-04-DB-012..013               | E         | `iam.login_audit/user_sessions` (hashes only) + ownership tests                   |
| P1-04-DB-014..017, 022          | F         | audit tables + `iam.audit_append`/hash/verify + chain/concurrency/tamper tests    |
| P1-04-DB-018..019               | G         | `shared.status_history/status_evidence` + idempotency reuse                       |
| P1-04-DB-020..021               | H         | `iam.has_permission`/`has_permission_in_scope` + context helpers + spoof tests    |
| P1-04-DB-023..024, SEC-001..003 | I         | indexes, permission-gated RLS, runtime grants, escalation-denial tests            |
| P1-04-DB-025                    | J         | permission catalog + baseline-role seeds (idempotent, no real users)              |
| P1-04-SEC/QA/DO/DOC             | K/L       | security notes, QA suites, CI, docs, traceability, adversarial review, clean-room |

## 7. Open items carried

- **P1-EC-016** (independent security review) remains open — all review here is
  owner-authorized self-review.
- **OIR-04** (production currency/tax policy) remains open — not in Phase 1-4 scope.
- Approval-limit currencies reference `shared.currencies` (reference subset only).
