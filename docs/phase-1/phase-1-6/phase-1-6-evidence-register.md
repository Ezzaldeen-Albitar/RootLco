# Phase 1-6 — Evidence Register

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-6 — CRM and Business Partner Database ·
**Branch:** `feature/p1-06-crm-business-partner-database` (base `develop`) ·
**Date:** 2026-07-19

This register records the evidenced facts backing the Phase 1-6 gate. Every
number is taken from live database introspection, the committed files, or CI —
never from intention. Counts are refreshed at the final source SHA; do not reuse
figures from an earlier commit.

## 1. Object counts (live `crm` schema introspection)

| Metric                                    |                          Value |
| ----------------------------------------- | -----------------------------: |
| Tables                                    |                             21 |
| Columns                                   |                            296 |
| Functions                                 |                             12 |
| Triggers                                  |                             44 |
| RLS policies                              |                             58 |
| Indexes                                   |                             68 |
| Foreign keys                              |                             51 |
| Check constraints                         |                             73 |
| CRM migrations                            | 15 (`20260719090000`–`104000`) |
| Migrations in repo (total)                |                             47 |
| CRM test files / cases                    |                       19 / 151 |
| DB test files (total)                     |                             55 |
| Reference/seed rows introduced by CRM     |                              0 |
| Business rows after clean migration       |                              0 |
| `SECURITY DEFINER` functions in `crm`     |                              0 |
| App roles with `BYPASSRLS`                |                              0 |
| Tables lacking `FORCE ROW LEVEL SECURITY` |                              0 |

Source matrices: [object inventory](./crm-object-inventory.md),
[RLS matrix](./crm-rls-policy-matrix.md), [grant matrix](./crm-grant-matrix.md),
[classification matrix](./crm-classification-matrix.md).

## 2. Security posture evidence

- **FORCE RLS everywhere.** All 21 tables report `relrowsecurity = true` **and**
  `relforcerowsecurity = true`. Asserted by `crm-structural-contract.test.ts`
  and `foundation.test.ts`.
- **Default-deny, per-command policies.** 58 policies (`sel_/ins_/upd_/del_…`),
  keyed on `iam.current_tenant_id()`. A command with no matching policy is denied.
- **NOBYPASSRLS roles.** `app_runtime`, `app_readonly`, `app_worker` are all
  `rolbypassrls = false`, `rolsuper = false`, and own no `crm` table. All RLS
  and privilege evidence in the test suite is gathered through `app_runtime`,
  never the provisioning superuser.
- **Sensitive-data gate.** The only sensitive primitive is row-level
  `iam.has_permission('iam.sensitive.view')` against a `classification` column.
  7 columns are `restricted`; none is `searchable` (the classification guard
  fails if any restricted column is marked searchable).
- **No SECURITY DEFINER.** Zero in `crm`; all functions are `SECURITY INVOKER`
  with `search_path = ''`.
- **Append-only history.** `partner_status_history`, `customer_block_history`,
  `consent_history`, `timeline_events` grant INSERT+SELECT only; UPDATE/DELETE →
  SQLSTATE 42501. See the [audit & timeline matrix](./crm-audit-and-timeline-matrix.md).

## 3. Security findings ledger

The Wave 5 adversarial self-review (four lenses; ~0.5M subagent tokens) found
**zero Critical and zero High** findings and **zero RLS defects**. It surfaced
four MEDIUM findings; three were fixed forward and one was accepted with
rationale. (This is an owner-authorized self-review with an adversarial lens, not
an independent third-party review.)

| #   | Finding (Medium)                                                                                              | Disposition                                                                                                                                                        | Evidence                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | A partner could be INSERTed already `blocked` with no attributable block-history row (guard was UPDATE-only)  | **Fixed** — `guard_partner_block_coherence` now fires `BEFORE INSERT OR UPDATE` and forbids an initial `blocked` status                                            | `…104000`; `crm-security-hardening.test.ts`                                                                               |
| 2   | A partner could be INSERTed already `merged` with a redirect (merge guard validated transition, not creation) | **Fixed** — `guard_business_partner_merge` rejects INSERT with a non-null `merged_into_id`                                                                         | `…104000`; `crm-security-hardening.test.ts`                                                                               |
| 3   | `jsonb_no_raw_value_keys` was a shallow, case-sensitive, depth-1 check                                        | **Fixed** — whole-document, case-insensitive raw-value-key scan                                                                                                    | `…104000`; `crm-security-hardening.test.ts`                                                                               |
| 4   | Profile `_ref` FK does not enforce that the referenced identifier is of the matching `identifier_type`        | **Accepted** — existence + same-tenant + same-partner are enforced at the DB layer; type-correctness is an application write-path invariant deferred to Phase 1-16 | [target model](./crm-target-data-model-phase-1-35.md); [completion report §limitations](./phase-1-6-completion-report.md) |

Additionally, a **latent determinism gap** (not a review finding, caught during
re-verification) was fixed: `occurred_at`/`created_at` use `now()`, which is
constant within a transaction, so "latest row" resolution that tie-broke on a
random `uuid` was non-deterministic for same-transaction events. A monotonic
`seq bigint GENERATED ALWAYS AS IDENTITY` was added to `customer_block_history`
and `consent_history`; block coherence and `current_consent` now order by `seq`.
Verified stable; concurrency suite green over five consecutive runs.

## 4. Reconciliations

- **DB-022 (index review).** No hot-path foreign key lacks a supporting index.
  The eight FKs without an exact leading-column index are either composite FKs
  whose `(tenant_id, partner_id)` prefix is already indexed (residual single-row
  filter only) or single-column FKs into low-cardinality reference tables
  (`shared.locales`, currency, `shared.documents`) that are `ON DELETE RESTRICT`
  and rarely mutated. Verdict: no new index required.
- **DB-024 (seeds).** CRM introduces no seed file and no reference rows. The
  `no-fake-data.test.ts` guard discovers every `crm` base table and asserts zero
  rows after cleanup. Satisfied by construction.
- **Audit re-scope.** The forensic audit trail (`iam.audit_append`) is **not**
  granted to app roles in Phase 1-6; the DB-layer attributable record is the
  append-only history/timeline tables. The full forensic trail is Phase 1-16.

## 5. Quality gates (local, at final source SHA)

| Gate                                                 | Result                     |
| ---------------------------------------------------- | -------------------------- |
| `typecheck` (`tsc --noEmit`)                         | clean                      |
| `eslint` on new/changed test files                   | clean                      |
| CRM + foundation + no-fake-data suites               | green                      |
| Concurrency suite (5 consecutive runs)               | green                      |
| Classification guard (`validate:crm-classification`) | OK — 296 columns reconcile |

The authoritative signal is the hosted CI on the feature PR's exact SHA (four
required checks). This register is completed from local evidence and updated with
the CI outcome once the pull request is open.

## 6. Gate status

**Owner gate: PENDING.** The feature pull request is not yet merged. The gate
becomes recordable only after CI is green on the final SHA, the PR is merged into
`develop` by the owner, and the separate gate-record is committed. See the
[owner gate](./phase-1-6-owner-gate.md).
