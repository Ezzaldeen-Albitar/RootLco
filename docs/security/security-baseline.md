# Security Baseline

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Adopted by owner instruction (2026-07-17); merged with the Phase 1-2 pull request (#5), which passed its Database Standards Gate on 2026-07-17 ·
**Owner:** Eng. Ezzaldeen Al-Bitar ·
**Review:** [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)

---

## 1. Purpose

This document establishes the **measurable application-security baseline** for the
platform: which external standards are pinned, at which level the product is verified,
what the six verification statuses mean, and the Security Gate every phase must pass.

Before this document, the OWASP API Security Top 10 (2023) and NIST SSDF were referenced
in the canonical Master documentation (which lives outside Git) but **not** in this
repository. This package formalizes them — with exact pinned editions — for engineering
use. If this repository and the canonical documents ever disagree, the canonical
documents win ([canonical-documents.md](../governance/canonical-documents.md)).

## 2. Pinned standards

| Standard                  | Pinned edition | Role                                                                   | Canonical source                                  |
| ------------------------- | -------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| OWASP ASVS                | **v5.0.0**     | Requirement-level verification baseline                                | github.com/OWASP/ASVS, release tag `v5.0.0`       |
| OWASP Top 10              | **2025**       | Risk-awareness mapping                                                 | owasp.org/Top10/2025/                             |
| OWASP API Security Top 10 | **2023**       | API risk-awareness mapping                                             | owasp.org/API-Security/editions/2023/en/0x11-t10/ |
| NIST SSDF                 | **v1.1**       | Secure-development lifecycle reference (SP 800-218; PO/PS/PW/RV)       | doi.org/10.6028/NIST.SP.800-218                   |
| OWASP SAMM                | **v2.0.3**     | **Future** security-maturity measurement model — no assessment yet run | owaspsamm.org                                     |

Pinning means a phase is judged against these exact editions. Moving to a newer edition
is an owner decision, recorded here with a re-judgment of the affected matrices.

## 3. Verification target

- **OWASP ASVS Level 2 is the general baseline** for the whole application.
- **Level 3 requirements are applied selectively** to high-risk workflows: **tenant
  administration, privileged access, financial operations, exports, audit evidence,
  integration credentials, backup/recovery**, and any further workflow the owners
  designate high-risk.
- Selection is recorded per requirement in the
  [ASVS matrix](./owasp-asvs-5-matrix.md) (`Selective L3 — <area>` in the Applicability
  column). A Level 3 requirement that is not selected is recorded as such — never
  silently dropped — and is re-judged at every phase gate.
- ASVS 5.0 has no direct backup/recovery requirements; that high-risk area is governed
  by the operations standards of the later phases and is listed here so it cannot be
  forgotten.

## 4. Explicit non-claim

> **RootLco does not claim OWASP compliance, certification, or attestation of any kind,
> and does not claim that the product "meets ASVS Level 2".** The truthful claim is:
> RootLco **adopts** the pinned editions above as its baseline and **tracks verification
> status per requirement** with named test evidence. This is consistent with — and never
> softens — the non-claims in [SECURITY.md §9](../../SECURITY.md).

## 5. RootLco requirement IDs

| Prefix       | Derivation                                      | Example            |
| ------------ | ----------------------------------------------- | ------------------ |
| `RL-ASVS-`   | `RL-ASVS-<ASVS 5.0.0 requirement ID>`           | `RL-ASVS-8.4.1`    |
| `RL-T10-`    | `RL-T10-<category>-2025`                        | `RL-T10-A01-2025`  |
| `RL-API-`    | `RL-API-<category>-2023`                        | `RL-API-API1-2023` |
| `RL-SEC-DB-` | Phase 1-2 database-security controls (this doc) | `RL-SEC-DB-001`    |

IDs are deterministic — no separate ID register is needed, and a requirement can always
be traced back to its pinned upstream source.

## 6. Status vocabulary

Exactly six statuses exist. No other wording may be used in any security matrix.

| Status                       | Meaning                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Not Applicable`             | Does not apply to this product. **Requires a written justification.**                                             |
| `Planned`                    | Applicable; implementation and verification belong to a named owning phase.                                       |
| `Implemented — not verified` | The control exists but no test evidence proves it yet.                                                            |
| `Verified`                   | The control exists **and** named test evidence proves it.                                                         |
| `Blocked`                    | Progress impossible for a recorded reason outside the phase's control.                                            |
| `Exception Approved`         | An owner-approved, time-bounded deviation exists in the [exceptions register](./security-exceptions-register.md). |

**Binding rules:**

1. **A requirement must never be marked `Verified` without test evidence** — a named
   test ID and an evidence path, as defined in the
   [Security Testing Standard](./security-testing-standard.md).
2. `Not Applicable` without a justification is a defect.
3. `Exception Approved` without a matching register entry is a defect.
4. Statuses are re-validated at every phase exit gate.

## 7. Risk levels

Judged for a multi-tenant automotive CRM/ERP platform holding financial data:

| Level      | Definition                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Critical` | **Any confirmed cross-tenant read or write is Critical by definition.** Also: authentication/authorization bypass, secret or credential exposure, remote code execution. |
| `High`     | Single-tenant data exposure or corruption, privilege escalation within a tenant, forgeable financial records or document numbers.                                        |
| `Medium`   | Weakens a defense layer without direct exposure (missing hardening, information leakage of internals).                                                                   |
| `Low`      | Documentation-level or defense-in-depth refinements with no direct exploitation path.                                                                                    |

## 8. The Security Gate

Binding at **every phase exit gate from Phase 1-2 onward**, in addition to the phase's
own gate criteria:

1. **No unresolved `Critical` findings.** A Critical finding can never be excepted.
2. **No unresolved `High` findings** without a documented, **owner-approved,
   time-bounded** exception in the [exceptions register](./security-exceptions-register.md).
3. **Every applicable control is mapped to a requirement and a test** — via the
   [ASVS matrix](./owasp-asvs-5-matrix.md), the Top-10 matrices, or the `RL-SEC-DB`
   table below.
4. **Every exception records**: owner, reason, compensating control, expiry date, and
   stop condition. An expired exception counts as an unresolved finding
   ([Vulnerability Management Standard](./vulnerability-management-standard.md)).

## 9. Phase 1-2 database-security controls (implemented and verified)

These are the controls Phase 1-2 actually delivered, with their honest statuses. Every
`Verified` row names its test evidence; the full execution record is the
[Phase 1-2 evidence register](../phase-1/phase-1-2/phase-1-2-evidence-register.md).

| ID            | Control                                                                                | Status                                                                                                                  | Test evidence                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RL-SEC-DB-001 | Default-deny RLS                                                                       | `Verified`                                                                                                              | `tests/db/rls.test.ts :: "a session with NO context sees zero tenant-owned rows"` and `"denies even the table owner when no policy exists"`                                               |
| RL-SEC-DB-002 | FORCE ROW LEVEL SECURITY on every module table                                         | `Verified`                                                                                                              | `tests/db/foundation.test.ts :: "every table in a module schema has RLS enabled AND forced"`                                                                                              |
| RL-SEC-DB-003 | Non-owner runtime roles                                                                | `Verified`                                                                                                              | `tests/db/foundation.test.ts :: "runtime roles own no schema and no table"`                                                                                                               |
| RL-SEC-DB-004 | No BYPASSRLS on application roles                                                      | `Verified`                                                                                                              | `tests/db/foundation.test.ts :: "defines app_runtime and app_readonly as constrained archetypes"`                                                                                         |
| RL-SEC-DB-005 | Server-resolved tenant/company/branch context                                          | `Verified` (contract + readers; full resolution in Phase 1-4)                                                           | `tests/db/foundation.test.ts :: "the iam context helpers exist and read transaction-local settings"`; `tests/db/number-sequences.test.ts :: "refuses to allocate without tenant context"` |
| RL-SEC-DB-006 | Cross-tenant negative tests                                                            | `Verified`                                                                                                              | `tests/db/rls.test.ts :: "Tenant A cannot read Tenant B rows even when addressing them directly"` plus UPDATE and WITH CHECK variants                                                     |
| RL-SEC-DB-007 | Composite scope foreign keys                                                           | `Verified` as a tested pattern (production FKs in Phase 1-3)                                                            | `tests/db/constraints.test.ts :: "REJECTS a cross-tenant link (Tenant B child → Tenant A parent)"`                                                                                        |
| RL-SEC-DB-008 | Sensitive-column classification                                                        | `Implemented — not verified` (documentation control, no automated test)                                                 | [retention-and-sensitive-data-standard.md](../database/retention-and-sensitive-data-standard.md) + [data-dictionary.md](../database/data-dictionary.md)                                   |
| RL-SEC-DB-009 | No plaintext secrets in business tables                                                | `Verified` for the current schema surface                                                                               | `tests/db/foundation.test.ts :: "contains NO business-domain tables (Phase 1-2 scope guard)"` + both secret scans clean (evidence register §6)                                            |
| RL-SEC-DB-010 | Append-only protected history                                                          | `Verified` as a tested pattern                                                                                          | `tests/db/patterns.test.ts :: "DENIES UPDATE to the runtime role (history is evidence)"` and `"DENIES DELETE to the runtime role"`                                                        |
| RL-SEC-DB-011 | Migration-role separation                                                              | `Verified`                                                                                                              | `tests/db/rls.test.ts :: "cannot ALTER TABLE ... DISABLE ROW LEVEL SECURITY (not the owner)"`                                                                                             |
| RL-SEC-DB-012 | Secret scanning                                                                        | `Verified` locally; the GitHub-enforced gate aspect is `Implemented — not verified` until the first PR run              | `scripts/check-browser-exposed-secrets.mjs` + the CI secret-scan job; runs recorded in the evidence register §6                                                                           |
| RL-SEC-DB-013 | Migration security gate (immutability, clean-DB replay, defective-migration rehearsal) | `Verified` locally by rehearsal; the GitHub-enforced gate aspect is `Implemented — not verified` until the first PR run | [rehearsal-defective-migration.md](../phase-1/phase-1-2/rehearsal-defective-migration.md) (`RUNNER_EXIT=1`, `GUARD_EXIT=1`)                                                               |
| RL-SEC-DB-014 | Dependency security gates                                                              | `Planned`                                                                                                               | [dependency-and-supply-chain-standard.md](./dependency-and-supply-chain-standard.md) — no SCA is configured yet; stated plainly                                                           |

## 9a. Phase 1-3 organizational-security controls (added 2026-07-17)

Phase 1-3 extended the verified database-control surface from one foundation
table to the 17-table organizational backbone. Statuses follow the same rule:
Verified only with named executable test evidence, run as the non-owner runtime
login. Application-layer ASVS requirements remain honestly Planned — no backend
or frontend exists.

| Control                                                                 | Status   | Evidence (test :: suite)                                                                  |
| ----------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Tenant isolation across the full organizational hierarchy               | Verified | tests/db/org-tenants / org-hierarchy / org-structure / org-settings / org-provisioning    |
| Structural cross-tenant impossibility (composite FKs)                   | Verified | tests/db/org-hierarchy :: cross-tenant FK 23503; org-structure; org-sequences             |
| Object-level authorization foundation (RLS forced everywhere)           | Verified | tests/db/foundation :: forced-everywhere (catalog-wide, binds future tables)              |
| Platform vs tenant administration separation                            | Verified | write denials on tenants/plans/flags/overrides/idempotency (42501, both layers)           |
| Least privilege (no DELETE anywhere, no BYPASSRLS, no ownership)        | Verified | tests/db/org-security :: role posture + DELETE-nowhere                                    |
| Configuration integrity (versioned, immutable settings)                 | Verified | tests/db/org-settings :: immutability vs runtime AND admin                                |
| Audit history (append-only lifecycle evidence)                          | Verified | tests/db/org-tenants / org-hierarchy :: history denials + atomic pairing                  |
| Provisioning integrity (atomic + idempotent)                            | Verified | tests/db/org-provisioning :: 3-step failure injection, replay, conflict                   |
| Input/data validation (typed settings, entitlements, IANA, NUMERIC tax) | Verified | tests/db/org-settings / org-subscriptions :: validation negatives                         |
| Secure defaults (deterministic provisioning state, default deny)        | Verified | tests/db/org-tenants :: deterministic default; no-context = zero rows                     |
| Data classification of every new column                                 | Verified | tests/db/org-security :: dictionary-coverage assertion (fails on any unclassified column) |
| Pilot hard-coding prevention                                            | Verified | zero-trace test + CI scope-exclusion guard (rehearsal R4 exit 1)                          |

Gate requirements at the Phase 1-3 gate: zero unresolved Critical, zero
unresolved High, no exception in the register, no expired exception, no
cross-tenant failure in 190 tests, no runtime BYPASSRLS, no tenant-owned table
without forced RLS — all held on 2026-07-17. The abuse-case register lives in
[phase-1-3-org-rls-policy-matrix.md](./phase-1-3-org-rls-policy-matrix.md).

## 10. Phase ownership map

Authority: the canonical Phase 1 Development Plan (Phases 1-1..1-39); ranges recorded in
[ADR-005](../adr/ADR-005-database-first-delivery-sequence.md). A control is assigned a
single exact phase number only when that phase's instruction is issued.

| Phase(s)                  | Security scope                                                                  |
| ------------------------- | ------------------------------------------------------------------------------- |
| Phase 1-2 (current)       | Database standards, shared foundation, this baseline                            |
| Phase 1-3                 | `org` schema; composite scope FKs applied; first formal threat model            |
| Phase 1-4                 | `iam` schema; server-side context resolution                                    |
| Phases 1-5..1-12          | Business-module database phases (CRM from Phase 1-5 per plan)                   |
| Phases 1-13..1-24         | Backend/API phases: authentication, sessions, API authorization, server logging |
| Phase 1-25 onward         | Frontend phases: browser security, CSP, client-side data protection             |
| Later phases through 1-39 | Integration, migration, pilot, go-live, hypercare: TLS, ops, backup/recovery    |

## 11. Document map

| Document                                                                             | Purpose                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [owasp-asvs-5-matrix.md](./owasp-asvs-5-matrix.md)                                   | All 345 ASVS 5.0.0 requirements, judged per row              |
| [owasp-top-10-2025-matrix.md](./owasp-top-10-2025-matrix.md)                         | OWASP Top 10:2025 category mapping                           |
| [owasp-api-top-10-2023-matrix.md](./owasp-api-top-10-2023-matrix.md)                 | OWASP API Security Top 10:2023 category mapping              |
| [threat-modeling-standard.md](./threat-modeling-standard.md)                         | When and how threat models are produced                      |
| [secure-coding-standard.md](./secure-coding-standard.md)                             | Binding coding rules with ASVS mapping                       |
| [security-testing-standard.md](./security-testing-standard.md)                       | What counts as test evidence; current real coverage          |
| [vulnerability-management-standard.md](./vulnerability-management-standard.md)       | Severity, intake, triage, and the merge-blocking rules       |
| [dependency-and-supply-chain-standard.md](./dependency-and-supply-chain-standard.md) | Current supply-chain controls and stated gaps                |
| [security-exceptions-register.md](./security-exceptions-register.md)                 | The only place a deviation may be recorded (currently empty) |

## 12. Relationship to other documents

- [SECURITY.md](../../SECURITY.md) — the repository security policy; its §9 non-claims
  bound everything here.
- [rls-standard.md](../database/rls-standard.md),
  [role-and-grant-standard.md](../database/role-and-grant-standard.md),
  [migration-standard.md](../database/migration-standard.md) — the database standards the
  `RL-SEC-DB` controls live in.
- [phase-1-2-owner-gate.md](../phase-1/phase-1-2/phase-1-2-owner-gate.md) — the gate this
  baseline first applies to.
- [solo-developer-review-policy.md](../governance/solo-developer-review-policy.md) — the
  review model every verification in this package operates under.

## 13. Honest limits

- Every verification recorded in this package is **owner-authorized self-review**; no
  independent verification exists (P1-EC-016 remains open).
- **CI evidence for the Phase 1-2 pull request is Owner-verified, not read here.** Pull
  request #5 ran and merged on 2026-07-17; the owner inspected its four mandatory checks
  in GitHub and confirms they passed on the final source commit `dae6681`. The build
  environment holds no GitHub credentials and did not query GitHub. The authoritative
  results live in GitHub Actions.
- No penetration test, external audit, or compliance certification exists
  ([SECURITY.md §9](../../SECURITY.md)).
- OWASP SAMM v2.0.3 is pinned as the future maturity model; **no SAMM assessment has
  been performed** and no maturity score is claimed.
- Environments are Local-only; Development/Staging/Production are planned, not
  provisioned — every hosted-environment control is future work by definition.
