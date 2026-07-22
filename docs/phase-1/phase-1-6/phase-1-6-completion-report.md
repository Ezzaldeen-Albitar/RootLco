# Phase 1-6 Completion Report

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-6 — CRM and Business Partner Database ·
**Date:** 2026-07-19 · **Branch:** `feature/p1-06-crm-business-partner-database`
(base `develop` at `cd475d3`) ·
**Author:** Eng. Ezzaldeen Al-Bitar, under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)

> This report states facts, not a decision. It does **not** record a Go. The
> owner gate is **Pending** and becomes recordable only after the feature pull
> request's CI is green on its final SHA and the owner merges it into `develop`.

## 1. What Phase 1-6 set out to do

Build the CRM and Business Partner PostgreSQL foundation — the party master and
its profiles, identifiers, roles, segments, lifecycle history, restrictions,
contact points and addresses, communication preferences and consent, alerts and
credit, duplicate detection and merge, and the communication log and activity
timeline — **without** building any application/API layer, worker, provider
integration, forensic audit trail, or any real or fake business data.

## 2. What was delivered

**Seventeen timestamped migrations** (`20260719090000`–`106000`) creating, per
live introspection at the final source SHA:

- **21 tables, 298 columns, 13 functions, 45 triggers, 58 RLS policies,
  79 indexes, 51 foreign keys, 73 check constraints.**

Every table has `ENABLE` + `FORCE ROW LEVEL SECURITY` with default-deny,
per-command policies keyed on `iam.current_tenant_id()`. The three application
roles (`app_runtime`, `app_readonly`, `app_worker`) are `NOBYPASSRLS`,
non-superuser, and own no `crm` table. No function is `SECURITY DEFINER`; all
are `SECURITY INVOKER` with `search_path = ''`. Sensitive columns (7 `restricted`)
are gated only by the row-level `iam.has_permission('iam.sensitive.view')` check
against a `classification` column, and are never projected into search. Four
history/timeline tables are append-only (INSERT+SELECT grants only; UPDATE/DELETE
→ SQLSTATE 42501). The complete object listing is in the
[object inventory](./crm-object-inventory.md); the design is in the
[data dictionary](./crm-data-dictionary.md), [party & role taxonomy](./crm-party-role-taxonomy.md),
and [ERD](../../database/erd/phase-1-6-crm.mmd).

**Testing:** 20 CRM test files, 160 CRM test cases, all passing, plus the shared
`foundation` and `no-fake-data` guards. Includes the QA-006 two-tenant isolation
suite (covers all 21 tables, auto-fails if a new table lacks coverage), the
QA-007 concurrency suite (single-winner races; five-run stability), and the
P1-07 structural-contract test. See the [test catalog](./phase-1-6-test-catalog.md).

**Data governance:** a personal-data [classification registry](../../database/crm-personal-data-classification.json)
(298 columns) enforced in CI by `validate:crm-classification` (DO-001); zero
seed rows and zero business rows (DB-024); the permanent no-fake-data invariant
extended to the `crm` schema.

## 3. Wave-by-wave

- **Wave 1** — architecture and schema design synthesis.
- **Waves 2–4** — the 21 tables and their guards/functions, delivered as ~17
  live-DB-verified increments (DB-001 … DB-019, plus DB-020 display numbers).
- **Wave 5** — search normalization (DB-021), the index/EXPLAIN review (DB-022),
  the RLS/grant/sensitive-access review (DB-023), the classification registry and
  CI lint (SEC-001/DO-001), the RLS matrix and consent-integrity review
  (SEC-002/003), the abuse-case review (SEC-004), the QA-006 isolation suite, and
  the QA-007 concurrency suite. A four-lens adversarial self-review
  (~0.5M subagent tokens) returned zero Critical/High and zero RLS defects, and
  surfaced four Medium findings.
- **Wave 6** — config-only seed confirmation (DB-024), migration/pipeline
  rehearsal (DB-025/QA-008), and this documentation package.
- **Wave 7** — clean-room validation from an empty database (all migrations +
  idempotent seeds; full CRM/foundation/no-fake-data suite green; concurrency
  stable across repeated runs) and a five-lens adversarial review
  (architecture, security, QA, documentation, red-team + integration). It found
  zero Critical, two High, and twelve Medium; both Highs and nine Mediums were
  fixed (mostly via the forward migration `…105000`), the remaining three
  Mediums accepted as Phase-1-16 deferrals. See the
  [review response](./phase-1-6-review-response.md).
- **Wave 8** — the feature pull request and the hosted-CI loop.

## 4. Security self-review and findings

The review model is owner-authorized technical/security self-review under the
standing policy — **not** an independent review. The adversarial pass returned
zero Critical and zero High findings and zero RLS defects. It raised four Medium
findings; three were fixed forward in migration `…104000` and one was accepted
with documented rationale:

1. Partner could be INSERTed already `blocked` with no history row — **Fixed**.
2. Partner could be INSERTed already `merged` — **Fixed**.
3. `jsonb_no_raw_value_keys` was shallow/case-sensitive — **Fixed** (whole-document, case-insensitive).
4. Profile `_ref` FK does not enforce `identifier_type` — **Accepted** (existence + tenant + partner enforced at DB layer; type-correctness is a Phase-1-16 write-path invariant).

Separately, a latent same-transaction ordering nondeterminism (`now()` is
constant within a transaction; the uuid tie-break was random) was fixed by adding
a monotonic `seq` IDENTITY to the block and consent history tables. Full ledger
and controls: [evidence register §3](./phase-1-6-evidence-register.md) and
[abuse-case record](./crm-abuse-case-record.md).

## 5. Known limitations and deferred scope (honest)

- **Application write-path invariants are not in the database layer.**
  Identifier-type correctness for profile `_ref` links, lifecycle-transition
  orchestration beyond the DB guards, and input validation belong to the
  application phase (Phase 1-16). The database enforces existence, tenancy,
  partner-consistency, append-only history, and the sensitive gate; it does not
  enforce type-correctness of a referenced identifier.
- **No forensic audit trail yet.** `iam.audit_append` is not granted to app
  roles; the DB-layer attributable record is the append-only history/timeline
  tables. The forensic trail is Phase 1-16.
  _(Amended 2026-07-21: the grant statement was true at Phase 1-6 closure and is
  kept as written. DBCR-P1-13-001 has since given `app_runtime` tenant-scoped
  EXECUTE on `iam.audit_append` for the Phase 1-13 backend foundation; no `crm`
  write path calls it, so nothing in this report's scope changed.)_
- **No application or API layer, no worker, no provider integration** — out of
  scope for a database phase.
- **Segments, alerts, and all business tables are empty** — they are populated
  only by real tenant activity, never seeded.

## 6. Gate status

**Pending.** _(Historical — accurate when written.)_ This report is complete and
factual. The [owner gate](./phase-1-6-owner-gate.md) records the five conditions
and their status; it is not a Go until CI is green on the final SHA and the owner
merges the pull request into `develop`.

## 7. Formal Closure Update (2026-07-19)

The Pending statement above was accurate when written. It was subsequently
superseded by evidenced facts: **feature PR #29** was merged into `develop` as
merge commit **`4d6d6dd`** (parents `cd475d3` + `90e91c5`) on
2026-07-19T13:12:44+03:00; hosted CI was green on the exact final SHA **`90e91c5`**
(all four required jobs Successful); and **`90e91c5` is contained in
`origin/develop`**. The Phase 1-6 technical gate is therefore recorded as
**Go — Technical Gate Passed** ([owner gate](./phase-1-6-owner-gate.md)). This
change is delivered on the separate `docs/p1-06-record-technical-gate` branch;
its pull request remains pending until the owner merges it, at which point
Phase 1-6 is formally closed.
