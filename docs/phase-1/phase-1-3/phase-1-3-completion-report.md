# Phase 1-3 Completion Report

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-3 — Tenant, Company, Branch, and Organizational Database ·
**Date:** 2026-07-17 · **Branch:** `feature/p1-03-organization-structure-schema`
(base `3d8e7cc` = the merged Phase 1-2 gate record) ·
**Author:** Eng. Ezzaldeen Al-Bitar, under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)

## 1. What Phase 1-3 set out to do

Implement the organizational backbone every business phase depends on —
Platform → Tenant → Legal Company → Branch → Department/Warehouse/Storage
Location/Cost Centre — plus subscriptions, reference data, settings, tax
foundation, feature flags with tenant overrides, organizational number-sequence
configuration, a generic atomic provisioning path with a controlled pilot
package, and two-tenant isolation proof.

## 2. What was delivered (all applied and verified on PostgreSQL 17.6)

- **Seven timestamped migrations** (`20260717100000`–`107000`) creating
  **17 new tables** (3 reference, 14 organizational/platform), 12 functions/
  guards, 31 module triggers, 41 RLS policies — every table with RLS enabled
  **and forced**; every grant explicit; DELETE granted to no application role
  anywhere; all codes immutable by trigger.
- **Structural tenancy:** composite candidate keys and FKs carry the tenant
  through every reference — cross-tenant links are FK violations, not filtered
  rows. The Phase 1-2 sequence-FK debt was paid (`…106000`).
- **Deterministic configuration semantics:** versioned append-only settings
  (immutable even to admin), effective-dated plans/subscriptions/tax
  rates/overrides with overlap EXCLUDEs, and precedence functions
  (`current_subscription_plan_id`, `resolve_feature_enabled`) that are
  single-valued by construction.
- **Atomic provisioning** (`org.provision_organization`) with the promoted
  idempotency-key pattern: injection-tested rollback at three distinct steps,
  byte-identical replay, fingerprint-conflict rejection, and zero
  tenant-specific logic — the pilot exists only as a controlled Class 3 seed
  package, with a fictional second tenant proving the path is generic.
- **190 tests in 13 files** — the 68 Phase 1-2 tests preserved unchanged plus
  122 new ones, every isolation assertion as a non-owner runtime login, plus
  catalog-level assertions that bind FUTURE tables: tenant-column invariant,
  FK-index coverage, no-duplicate-indexes, DELETE-nowhere, dictionary coverage,
  and the Phase 1-4 structural contract by constraint name.
- **CI extended** (existing jobs untouched): the database job now exercises all
  Phase 1-3 migrations and suites; a scope-exclusion guard with exact
  allow-lists blocks pilot hard-coding and excluded-scope objects. Four negative
  rehearsals (defective migration, populated-DB guard, FORCE-RLS removal,
  tracked pilot literal) each failed the pipeline correctly — deliberate defects
  never committed.
- **Documentation:** live-catalog-generated data dictionary (21 tables, coverage
  test-enforced), ERD source, RLS policy matrix + 12 abuse cases, migration
  classification with a genuinely executed rollback rehearsal, provisioning
  runbook (self-validated), schema design record with the code-governance and
  pilot-pending registers, initial audit, this report, traceability, readiness
  checklist, and the gate record.

## 3. Defects this phase's own controls caught (all fixed pre-PR)

Five, recorded in [the evidence register §4](./phase-1-3-evidence-register.md):
four missing FK-support indexes (caught by the new automated assertion),
a transaction-reuse bug in a test, the guard flagging its own CI comment, an
invalid first hard-coding rehearsal (untracked file), and one pipe-masked exit
code. Each fix is itself test-covered or re-rehearsed.

## 4. Honest limits and open items

1. **No GitHub Actions run exists for this branch** — the PR run is the proof;
   CI is not called green until it reports.
2. **Solo review** throughout; P1-EC-016 (independent security review) open.
3. **OIR-04 open** — production currency/tax policy pending; only the
   documented testing subset is seeded; zero tax rows seeded.
4. **Pilot pending facts** — registration numbers, Arabic legal rendering,
   currency/timezone confirmation (provisioning register).
5. **Platform write surfaces** (tenant lifecycle, subscriptions, overrides,
   provisioning) are deliberately admin-only until Phase 1-4/1-14.
6. **FR-ORG-004** (block deactivation with active work) is a Phase 1-14
   obligation — the tables it needs do not exist yet.
7. **Canonical Phase 1 plan DOCX** — synchronization pending, non-blocking.

## 5. Scope confirmations

No user/role/permission/membership object (Phase 1-4); no business-domain
table beyond the authorized organizational set (allow-list enforced); no
backend API, Server Action, or frontend page; no billing/pricing; no
production infrastructure; no real pilot data. Pilot naming confined to the
controlled package + its validation tests (CI-guarded). No excluded-scope
object. No secret (scans clean).

## 6. Recommendation

Submit the branch through the pull-request gate. Under the Standing Technical
Authorization Policy the gate then closes automatically on proven facts —
green mandatory CI plus the merge — recorded in
[phase-1-3-owner-gate.md](./phase-1-3-owner-gate.md). This report confers no
approval by itself.
