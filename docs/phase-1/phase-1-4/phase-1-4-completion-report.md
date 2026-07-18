# Phase 1-4 Completion Report

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-4 — Identity, Authorization, Security, and Audit Database ·
**Date:** 2026-07-18 · **Branch:** `feature/p1-04-identity-access-and-scope-schema`
(base `d41a747`) · **Author:** Eng. Ezzaldeen Al-Bitar, under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)

## 1. What Phase 1-4 set out to do

Build the PostgreSQL foundation for identity, authorization, security, and
audit — accounts, roles/permissions with real deny precedence, scoped grants,
approval and sensitive-data permissions, login/session metadata, an append-only
tamper-evident audit trail, generic status history, the runtime context and
permission-resolution helpers, RLS/grants, and the permission-catalog seed —
**without** storing any credential and **without** any backend, frontend, HR
master, or Phase-1-5 schema.

## 2. What was delivered (all applied and verified on PostgreSQL 17.6)

- **Nine timestamped migrations** (`20260718090000`–`098000`) + one idempotent
  seed, creating **19 tables, 14 functions, 25 triggers, 21 RLS policies**.
- **Credential-free identity:** external identity by reference only; a structural
  guard asserts no credential/token/plaintext-network column anywhere.
- **Authorization by permission, deny precedence persisted;** scoped grants with
  a deferred ≥1-scope constraint and composite FKs that make cross-tenant and
  cross-company scopes FK violations; DB-level self-grant and scope-widening
  denial.
- **Money is NUMERIC(18,4)** with non-overlapping effective intervals.
- **Tamper-evident audit:** a per-tenant SHA-256 chain appended under an advisory
  lock (no fork), masked restricted/secret detail values, and a verifier that
  detects alteration, gaps, **and orphan (unlinked) records**.
- **Runtime context + `has_permission`/`has_permission_in_scope`** — SECURITY
  INVOKER, empty search_path, safe deny on unset/invalid/inactive/expired/
  cross-tenant.
- **Permission catalog + six baseline system roles** seeded idempotently into the
  fictional tenant only (no Benzene, no user, no password).
- **CI** already exercises all of it: the database job applies every migration
  from empty and runs the full `test:db` suite; the secrets job runs
  scope/credential/browser-secret scans.

## 3. Tests

**311 tests in 24 files, all passing on a clean reset** — 194 Phase-1-2/1-3
preserved plus **117 new** Phase-1-4 tests, every isolation assertion as the
non-owner runtime login. Breakdown in the
[evidence register §3](./phase-1-4-evidence-register.md).

## 4. Adversarial review

A focused pass over the §37 checklist found **one minor finding** — the chain
verifier did not detect a forged, unlinked audit record — which was **fixed**
(orphan detection added, test added). All other categories were clean; details
in [evidence register §5](./phase-1-4-evidence-register.md).

## 5. Honest limits and open items

1. **No GitHub Actions run exists for this branch yet** — CI is not called green
   until the PR run reports.
2. **Solo review** throughout; P1-EC-016 (independent security review) open.
3. **Phase-1-14 boundary:** login/session issuance, MFA, IdP integration,
   audit-read access logging, and privileged-grant different-actor approval
   enforcement are backend responsibilities — the DB defines and access-controls
   the shapes, it does not claim those controls exist.
4. A superuser/BYPASSRLS DB role can write audit rows; the chain is the detection
   control, and no application role holds any write grant.

## 6. Scope confirmations

No credential of any kind. No backend/API/frontend. No HR employee master (only
a placeholder `employee_ref`). No CRM/vehicle/Phase-1-5 object. No Benzene role,
user, or authorization logic (baseline roles are in the fictional tenant only).
No secret committed.

## 7. Recommendation

Submit the branch through the pull-request gate. Under the Standing Technical
Authorization Policy the Phase-1-4 gate closes automatically on proven facts —
green mandatory CI plus the merge into `develop` — recorded in
[phase-1-4-owner-gate.md](./phase-1-4-owner-gate.md). This report confers no
approval by itself. **Phase 1-5 has not been started.**
