# Phase 1-14 Owner Gate — Authentication, Authorization, and Administration Backend

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-14 — Authentication, Authorization, and Administration Backend ·
**Date opened:** 2026-07-22 ·
**Approval owner:** RootLco founders (Product Owner), with technical sign-off by the Architect and
Security lead ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## Provenance of this record — read first

This owner-gate document **was missing from the P1-14 feature delivery**. Every prior phase (P1-11,
P1-12, P1-13) shipped its owner-gate document in the **Pending** state alongside its feature pull
request; the P1-14 feature pull request (#55) did not include one. No `phase-1-14-owner-gate.md`
existed in any commit before this file.

It is therefore being created **now**, as part of the remediation governance that followed the failed
P1-14 gate review — **not** reconstructed as though it had always existed. There is no earlier
"historical Pending" version of this document to preserve, because there was none; this is the
initial version, and its initial state is Pending. It must not be read as evidence that the gate was
open-and-tracked during the feature phase — it was not, and that omission is itself recorded here.

## Decision: **Pending**

The gate is open. No decision has been recorded, and no result below is claimed in advance of
evidence. The decision field is filled by the approval owner, never by the implementer, and never
before the conditions below are all satisfied and evidenced. **It may be converted to Go only after
the remediation described below is merged into protected `develop` by the owner and the protected
post-merge state is re-verified.** A Go record must not be created on the remediation branch.

## 1. What this gate governs

Phase 1-15 may not begin until the authentication provider decision (ADR-019), the authentication and
session enforcement, the authorization and administration operations, the audit-viewing surface, the
required catalog corrections, and their executable evidence are approved and demonstrably green in
hosted CI, on the exact merged SHA.

## 2. History of the phase

| Item                                  | Value                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database remediation (DBCR-P1-14-001) | PR **#54** → merge `1477886`; **RESOLVED**, re-verified from the merged protected tree                                                                                                     |
| Feature implementation                | PR **#55** → merge `c16f998` (parents `1477886` + `2359bfb`); 38 operations; no migration added or changed                                                                                 |
| Authentication provider               | **Supabase Auth** — [ADR-019](../../adr/ADR-019-supabase-auth-as-authentication-provider.md)                                                                                               |
| Gate review outcome                   | **Did not pass** — one confirmed High (grant scope-containment bypass) and absent operation-layer evidence                                                                                 |
| Remediation (grant scope + evidence)  | Branch `fix/p1-14-grant-scope-and-operation-evidence` → PR **#56** merge `63916b8` — see [the remediation record](phase-1-14-grant-scope-remediation.md)                                   |
| Operation-evidence completion         | Branch `fix/p1-14-operation-evidence-completion` (off `63916b8`) — see [the completion record](phase-1-14-operation-evidence-completion.md); closes R-8/R-9, fixes R-008/R-009/R-010/R-011 |

## 3. Gate conditions

| #   | Condition                                                                                           | Status at time of writing                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Authentication provider decision recorded (ADR-019); authorization state never trusted from a token | **Met** — ADR-019; re-verified in the gate review                                                                                      |
| 2   | Every public operation registered; every protected operation declares permission + audit metadata   | **Met** — `validate:authorization-coverage`                                                                                            |
| 3   | Unrestricted-grant scope-containment bypass fixed at application **and** database layers            | **Met on the remediation branch** — awaiting owner merge                                                                               |
| 4   | The runtime-privilege `updated_by` defects fixed and proven (P1-14-R-007 **and** R-010)             | **Met** — R-007 on `63916b8`; R-010 (roles/user_accounts/tenants) on the completion branch                                             |
| 5   | **Every** registered operation proven at operation depth (service + RLS + context + audit/outbox)   | **Met on the completion branch** — 39/39 operation depth; awaiting owner merge                                                         |
| 6   | Operation-to-test coverage gate green; coverage matrix published; residuals visible                 | **Met on the completion branch** — 39 operation / 0 unit / 0 pending; strict gate + negative fixture                                   |
| 7   | Zero unresolved Critical findings                                                                   | **Met** — 0                                                                                                                            |
| 8   | Zero unresolved High findings without an approved exception                                         | **Met on the completion branch** — the confirmed High, R-007, and the four operation-evidence findings (R-008/R-009/R-010/R-011) fixed |
| 9   | Local validation green with recorded exit codes                                                     | **To be evidenced on the exact final remediation SHA**                                                                                 |
| 10  | Clean-room validation green from a clean checkout                                                   | **To be evidenced on the exact final remediation SHA**                                                                                 |
| 11  | All required hosted CI checks green on the exact final remediation SHA                              | **To be evidenced**                                                                                                                    |
| 12  | Feature and remediation pull requests merged into `develop` by the repository owner                 | **PR #55 merged; the remediation PR is not merged — the implementer never merges**                                                     |
| 13  | Gate record committed into protected history with a Go decision                                     | **Not started — this document is Pending**                                                                                             |
| 14  | Migration posture: one additive remediation migration; no existing migration modified               | **Met on the remediation branch** — migration 116, ROLLBACK-SAFE                                                                       |
| 15  | No P1-15 work started                                                                               | **Met** — no P1-15 branch, commit, route, or migration exists                                                                          |

## 4. Known open items carried into the gate

- **Operation-evidence residuals (R-8, R-9) — CLOSED** on the completion branch. All 39 operations
  now carry operation-depth evidence; 0 `pending`, 0 `unit`. Building that evidence surfaced four
  latent runtime defects (R-008 citext cast; R-009 session `user_id`; R-010 `updated_by` on
  roles/user_accounts/tenants; R-011 last-holder `FOR UPDATE` undercount) — all fixed additively and
  recorded in [the completion record](phase-1-14-operation-evidence-completion.md).
- **Database-suite intermittency (R-5).** Carried from the feature phase, **undiagnosed, not
  resolved, severity Low.** Not addressed by this work; re-run recorded in the completion validation.
- **Dependency-vulnerability scanning (R-3).** Not implemented and not claimed.
- **P1-OD-027 (NFR-SCL).** Unresolved; every numeric limit remains a proposed validation baseline.
- **Open decisions** `AUTH-SESSION-TRANSPORT`, `IAM-SELF-ONBOARDING`, `IAM-BASELINE-PERMISSION` —
  carried from the feature phase.

## 5. Governance statement

Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
security reviewer, and repository administrator. Nothing reached protected `develop` outside the
approved pull-request and hosted-CI flow. The work was reviewed under the Standing Technical
Authorization and Solo Developer Review policies. This is not an independent third-party review and is
never represented as one. No gate condition may be waived silently: every residual, pending decision,
and stated scope boundary is recorded above with its disposition.

## Status

**PENDING.** No decision recorded. This record was created during remediation governance because it
was missing from the feature delivery; it may be converted to Go only by the approval owner, after the
remediation is merged into protected history and the protected post-merge state is re-verified.
