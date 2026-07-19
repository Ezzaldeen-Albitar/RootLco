# Phase 1-6 — CRM and Business Partner Database

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-6 — CRM and Business Partner Database ·
**Date:** 2026-07-19 · **Branch:** `feature/p1-06-crm-business-partner-database`
(base `develop` @ `cd475d3`; first phase commit `920a894`) ·
**Author:** Eng. Ezzaldeen Al-Bitar, under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)

This folder is the closeout package for Phase 1-6. This README is its entry
point; every other file is linked from the [document index](#3-document-index)
below.

## 1. What Phase 1-6 delivers

Phase 1-6 builds the CRM and business-partner **database foundation** for
[PRODUCT NAME — Pending Final Approval]: a single party master
(`business_partners`) that anchors individual and company profiles plus
sensitive attributes and external identifiers; temporal roles, customer
segments and segment assignments; lifecycle status history, customer
restrictions and block history; contact points, addresses, communication
preferences and consent history; commercial credit profiles and customer
alerts; duplicate candidates and partner merges; and a communication log with
an append-only timeline — delivered as **21 tables, 296 columns, 12 functions,
44 triggers, 58 policies, and 68 indexes** (plus 51 foreign keys and 73 check
constraints), created across 15 forward-only crm migrations
(`20260719090000`–`20260719104000`) and verified by live schema introspection.
The generated [object inventory](./crm-object-inventory.md) is the authoritative
count table and the [data dictionary](./crm-data-dictionary.md) is the
column-level reference; the [ERD](../../database/erd/phase-1-6-crm.mmd) shows the
relationships.

## 2. What Phase 1-6 deliberately does NOT build

This phase is the database layer only. It intentionally excludes:

- **No application or API layer** — no service code, endpoints, or ORM models;
  the schema is the deliverable and downstream write-path invariants are a later
  concern.
- **No worker / background processing** — no job runner, no async pipelines.
- **No forensic audit trail** — `iam.audit_append` is not granted to any app
  role. The full forensic audit trail is **Phase 1-16**; at this layer the
  attributable record is the append-only history and timeline tables (see the
  [audit and timeline matrix](./crm-audit-and-timeline-matrix.md)).
- **No real or fake business data** — crm ships **zero** business rows and
  **zero** structural-reference rows, consistent with the standing no-fake-data
  policy; the no-fake-data guard scans crm and asserts it is empty.

## 3. Document index

| Document                                                                                      | Purpose                                                                                      |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [README.md](./README.md)                                                                      | This overview and folder entry point.                                                        |
| [crm-data-dictionary.md](./crm-data-dictionary.md)                                            | Column-level data dictionary for all 21 crm tables (296 columns).                            |
| [crm-object-inventory.md](./crm-object-inventory.md)                                          | Generated inventory: tables, functions, triggers, policies, indexes, FKs, check constraints. |
| [crm-rls-policy-matrix.md](./crm-rls-policy-matrix.md)                                        | Per-table, per-command row-level-security policy matrix (58 policies).                       |
| [crm-grant-matrix.md](./crm-grant-matrix.md)                                                  | Table privileges granted to `app_runtime`, `app_readonly`, and `app_worker`.                 |
| [crm-classification-matrix.md](./crm-classification-matrix.md)                                | Personal-data classification of every column; the restricted (7) and searchable (11) sets.   |
| [crm-party-role-taxonomy.md](./crm-party-role-taxonomy.md)                                    | Party master, temporal role, and customer-segment taxonomy.                                  |
| [crm-audit-and-timeline-matrix.md](./crm-audit-and-timeline-matrix.md)                        | Append-only history and timeline coverage; the DB-layer attributable record.                 |
| [crm-shared-services-contract.md](./crm-shared-services-contract.md)                          | How crm consumes shared/iam services (tenant scope, permissions, status-history stamping).   |
| [crm-abuse-case-record.md](./crm-abuse-case-record.md)                                        | Abuse-case / adversarial review findings and dispositions (SEC-004).                         |
| [crm-target-data-model-phase-1-35.md](./crm-target-data-model-phase-1-35.md)                  | Forward-looking target CRM data model spanning later phases (through Phase 1-35).            |
| [p1-07-structural-contract.md](./p1-07-structural-contract.md)                                | Structural contract this phase hands to Phase 1-7.                                           |
| [phase-1-6-migration-classification.md](../../database/phase-1-6-migration-classification.md) | The 15 crm migrations classified by kind (schema / security / function / index).             |
| [phase-1-6-traceability.md](./phase-1-6-traceability.md)                                      | Task → migration → test → commit traceability register.                                      |
| [phase-1-6-test-catalog.md](./phase-1-6-test-catalog.md)                                      | Catalog of the crm test suite (18 crm files of 54 db test files; 158 tests green).           |
| [phase-1-6-evidence-register.md](./phase-1-6-evidence-register.md)                            | Evidence register: introspection, CI, and the security-findings ledger.                      |
| [phase-1-6-completion-report.md](./phase-1-6-completion-report.md)                            | Narrative completion report for the phase.                                                   |
| [phase-1-6-owner-gate.md](./phase-1-6-owner-gate.md)                                          | Owner phase-gate record (status Pending).                                                    |
| [phase-1-6-change-log.md](./phase-1-6-change-log.md)                                          | Chronological change log of the phase.                                                       |
| [phase-1-6-crm.mmd](../../database/erd/phase-1-6-crm.mmd)                                     | Mermaid ERD of the crm schema.                                                               |

## 4. Security model summary

- **FORCE RLS everywhere** — all 21 crm tables are `ENABLE` **and** `FORCE ROW
LEVEL SECURITY`, default-deny, with per-command policies keyed on
  `iam.current_tenant_id()` (see the [RLS policy matrix](./crm-rls-policy-matrix.md)).
- **`NOBYPASSRLS` roles** — the application roles `app_runtime`, `app_readonly`,
  and `app_worker` are non-superuser, `NOBYPASSRLS`, and own zero crm tables
  (see the [grant matrix](./crm-grant-matrix.md)).
- **Sensitive-attribute gate** — restricted data (national-id / registration /
  tax identifiers and date-of-birth) is reachable only where row-level
  `iam.has_permission('iam.sensitive.view')` holds against the row's
  `classification`; there is no column-masking view or function (see the
  [classification matrix](./crm-classification-matrix.md)).
- **Append-only history** — history and timeline tables grant `SELECT` + `INSERT`
  only; `UPDATE`/`DELETE` raise `42501`. Records are server-stamped, a no-op
  guard rejects unchanged transitions, and same-transaction ordering uses a
  monotonic `seq` identity rather than a random tie-break.
- **Zero `SECURITY DEFINER`** — all 12 crm functions are `SECURITY INVOKER` with
  `SET search_path=''` and `REVOKE EXECUTE FROM PUBLIC`; no privilege-escalating
  definer functions exist.

Review is owner-authorized technical and security self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo-Developer Review Policy](../../governance/solo-developer-review-policy.md);
it is not an independent review.

## 5. Status

**Branch** `feature/p1-06-crm-business-partner-database` · **base** `develop` ·
**owner gate Pending** — the feature pull request is not yet open or merged, so
the [owner gate](./phase-1-6-owner-gate.md) is **Pending** (not Go). The full
crm + foundation + no-fake-data database suite runs 158 tests green.
