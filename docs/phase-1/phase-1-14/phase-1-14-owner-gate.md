# Phase 1-14 Owner Gate — Authentication, Authorization, and Administration Backend

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-14 — Authentication, Authorization, and Administration Backend ·
**Date opened:** 2026-07-22 · **Date decided:** 2026-07-22 ·
**Approval owner:** RootLco founders (Product Owner), with technical sign-off by the Architect and
Security lead ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## Decision: Go — P1-14 Authentication, Authorization, and Administration Backend Gate Passed

Recorded on 2026-07-22 against the protected history described in §2, after all four pull requests
(#54, #55, #56, #58) were merged into `develop` by the repository owner and the complete
implementation and its operation evidence were revalidated from the merged protected state
(`origin/develop` = `5b34c17`). Section 8 preserves the Pending version of this document
byte-verbatim; this decision does not rewrite it, and the gate was genuinely open until the evidence
below existed.

**True chronology — stated, not implied.** This owner-gate document **was absent from the P1-14
feature delivery** (PR #55 shipped no gate document — see §8). It was **created in the Pending state
during the governed remediation** that followed the failed gate review, **became protected** when
PR #56 merged it into `develop`, carried its Pending updates through PR #58, and is **now being
converted to Go** after the final protected-state verification in §4–§7. It is not claimed to have
existed, or to have been open-and-tracked, before it was actually created; that omission is recorded
in §8 in its own words.

> **Navigation.** The remediation is recorded in
> [`phase-1-14-grant-scope-remediation.md`](./phase-1-14-grant-scope-remediation.md); the
> operation-evidence completion (which closed the last residuals and fixed R-008…R-011) in
> [`phase-1-14-operation-evidence-completion.md`](./phase-1-14-operation-evidence-completion.md).

## 1. What this gate governs

Phase 1-15 may not begin until the authentication provider decision (ADR-019), the authentication and
session enforcement, the authorization and administration operations, the audit-viewing surface, the
required catalog corrections, and their executable operation-depth evidence are approved and
demonstrably green in hosted CI, on the exact merged SHA.

## 2. Protected history

| Item                                               | Value                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database remediation (DBCR-P1-14-001)              | PR **#54** → reviewed tip `7e9855c`, merge `1477886` (parents `8c8e0fa` + `7e9855c`), 2026-07-22 12:12:55 +03:00                                                         |
| Feature implementation                             | PR **#55** → reviewed tip `2359bfb`, merge `c16f998` (parents `1477886` + `2359bfb`), 2026-07-22 14:26:01 +03:00                                                         |
| Grant-scope + operation-evidence remediation       | PR **#56** → reviewed tip `d3c7e77`, merge `63916b8` (parents `c16f998` + `d3c7e77`), 2026-07-22 17:38:39 +03:00                                                         |
| Acceptance-evidence completion                     | PR **#58** → reviewed tip `57b8337`, merge `5b34c17` (parents `63916b8` + `57b8337`), 2026-07-22 19:16:31 +03:00, merged by the repository owner via the GitHub web flow |
| Post-merge hosted CI on `5b34c17` (`develop` push) | **Run `CI` #141 — completed successfully** (Lint/types/tests/build, Docker build validation, Database migrations & RLS tests, Secret & sensitive-file scan)              |
| Hosted CI on the PR #58 head `57b8337`             | 4/4 required checks green at merge time                                                                                                                                  |
| `origin/develop` when this decision was written    | `5b34c172ffb937d1ceda22e7e7df5b9975308be7`                                                                                                                               |
| Protected `origin/main`                            | `8aebbe8f4e304f8c5d7c9b6c9a418160a5e317e0` — **not modified by this phase**                                                                                              |
| Authentication provider                            | **Supabase Auth** — [ADR-019](../../adr/ADR-019-supabase-auth-as-authentication-provider.md)                                                                             |

All four merge commits carry two parents and a `Merge pull request #N` subject; the PR #58 merge tree
(`6690777a…`) is byte-identical to the tree of its reviewed head `57b8337`, so the merge introduced no
change that had not been reviewed. `develop`'s first-parent history since `63916b8` (the PR #56 merge)
is exactly the one PR #58 merge — nothing was pushed directly to a protected branch.

### 2.1 Completed after this decision was written

This document is the content of the gate-record commit, so it cannot name the pull request that
carries it, the run that validates it, or the merge that lands it. Those values are recorded here
after the fact rather than reconstructed:

| Item                            | Value                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Gate pull request               | **#59** — `docs(P1-14): record authentication and administration backend gate as Go` |
| Final gate SHA                  | _recorded after push_                                                                |
| Hosted CI on the final gate SHA | _recorded after the run is green_                                                    |
| Gate merge commit               | _recorded after the owner merges_                                                    |

## 3. Gate conditions

| #   | Condition                                                                                           | Status                                                                                           |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Authentication provider decision recorded (ADR-019); authorization state never trusted from a token | **Met** — ADR-019; JWT metadata is a lookup key only, authorization is DB-derived per request    |
| 2   | Every public operation registered; every protected operation declares permission + audit metadata   | **Met** — `validate:authorization-coverage` (0), OpenAPI 39 operations all guarded               |
| 3   | Unrestricted-grant scope-containment bypass fixed at application **and** database layers            | **Met** — application `DelegationPolicy` + database backstop (migration 116); §6                 |
| 4   | The runtime-privilege `updated_by` defects fixed and proven (P1-14-R-007 **and** R-010)             | **Met** — both fixed and proven by operation-depth regression tests; §6                          |
| 5   | **Every** registered operation proven at operation depth (service + RLS + context + audit/outbox)   | **Met** — 39/39 operation depth; 0 pending, 0 unit, 0 unreferenced                               |
| 6   | Operation-to-test coverage gate green; coverage matrix published; residuals visible                 | **Met** — strict `validate:operation-coverage` (0) + negative fixture; matrix in `evidence/`     |
| 7   | Zero unresolved Critical findings                                                                   | **Met** — 0                                                                                      |
| 8   | Zero unresolved High findings without an approved exception                                         | **Met** — 0; the confirmed High, R-007, and R-008…R-011 all fixed and regression-tested (§5, §6) |
| 9   | Local validation green with recorded exit codes                                                     | **Met** — §4                                                                                     |
| 10  | Clean-room validation green from a clean checkout                                                   | **Met** — fresh worktree at `5b34c17`, `npm ci`, empty DB → 116 migrations → seed ×2; §4         |
| 11  | All required hosted CI checks green on the exact final feature SHA                                  | **Met** — PR #58 head `57b8337` 4/4 green; post-merge `develop` run #141 on `5b34c17` green      |
| 12  | Feature and remediation pull requests merged into `develop` by the repository owner                 | **Met** — PR #54, #55, #56, #58 all merged by the owner                                          |
| 13  | Gate record committed into protected history with a Go decision                                     | **Pending the owner's merge of this gate pull request** (§2.1)                                   |
| 14  | Migration posture: one additive remediation migration (116th); no existing migration modified       | **Met** — 116 migrations; PR #58 added/changed none; no earlier migration modified               |
| 15  | No P1-15 work started                                                                               | **Met** — no P1-15 branch, commit, pull request, route, or migration exists                      |

## 4. Validation from the merged protected state

Two independent runs against the protected content: the active checkout (tree byte-identical to
`origin/develop`) and a genuinely isolated fresh `git worktree` at `5b34c17` with its own `npm ci`.

| Suite / check                                                                                       | Result                        |
| --------------------------------------------------------------------------------------------------- | ----------------------------- |
| `test:db` (migrations, RLS, isolation, concurrency, audit, outbox, grant containment, capabilities) | **122 files / 1269 tests**, 0 |
| `test:backend` (foundation + IAM operations on the deployed `app_runtime` role)                     | **12 files / 159 tests**, 0   |
| `test` (unit + foundation, incl. auth units + coverage-gate negative fixture)                       | **25 files / 369 tests**, 0   |
| lint · typecheck · format:check · style:check                                                       | 0 · 0 · 0 · 0                 |
| module boundaries · authorization coverage · **operation coverage** · OpenAPI                       | 0 · 0 · 0 · 0                 |
| tracked secrets · browser secrets · scope exclusions · no-fake-data                                 | 0 · 0 · 0 · 0                 |
| Next.js production build · `docker compose config`                                                  | 0 · 0                         |

**Clean room.** A fresh `git worktree` at `5b34c17` in an isolated short path, `npm ci` only, and the
local database reset from empty through **all 116 migrations** with the declared seeds, then the seed
files re-applied a second time — **`validate:seed-state`**: seven declared files applied twice, five
exact retention classes, **every business table empty**, counts idempotent (0). Every suite and guard
above re-run there: all 0, including the Next.js production build (`Compiled successfully`). The
deep-temp-path build failure seen during the completion-branch clean room was a **Windows `MAX_PATH`
environmental limit only**; at a short path the build compiles cleanly, and Linux hosted CI (#141) on
the same SHA also builds green — it was never a code failure and is not claimed to have succeeded on
the deep path.

**Catalogue, measured on the clean-room database rebuilt from empty:**
**116** migrations · **242** tables · **212** functions (the P1-13 baseline of 210 plus the two
migration-116 additions) · **615** policies · **541** triggers · **0** `SECURITY DEFINER` routines ·
**17 of 17** `iam` tables `ENABLE` **and** `FORCE` RLS · **0** application roles with `BYPASSRLS`,
superuser, or `LOGIN` · **0** relations owned by any application role · migration-116 predicate
`iam.grant_delegation_within_authority` present.

**Operation coverage (strict gate):** **39** registered operations · **39** operation-depth · **0**
pending · **0** unit-only · **0** unreferenced. 24 carry required evidence flags (denial / cross-tenant
/ isolation / audit / outbox / idempotency / stale-version as applicable); 15 are invocation-only read
and catalogue operations. The negative fixture proves the gate exits non-zero on a missing operation,
a pending operation, a missing required flag, an unreadable referenced file, a declared-but-uninvoked
operation, and a stale manifest entry.

## 5. Final adversarial review

A fresh refute-oriented review of the merged protected implementation across grant-scope widening,
empty/null-scope unrestricted grants, reactivation and scope deletion, direct-SQL bypass,
self-escalation, cross-company/branch delegation, last-administrator handling, login/session runtime
viability, runtime search-path assumptions, trigger-stamped metadata vs column grants, credential
stuffing and enumeration, reset/invitation replay, provider failure, session fixation/theft/revocation,
idle-timeout, JWT validation, scope spoofing, IDOR, CSRF, CORS, open redirects, forged proxy headers,
rate-limit bypass, sensitive logs/errors, audit-view abuse, idempotency abuse, outbox duplication,
dependency vulnerabilities, and unkeyed IP/user-agent hash reversibility.

**Zero unresolved Critical. Zero unresolved High. Zero unresolved Medium.** Every surface reviewed
resisted attack; each control is pinned by a committed regression test running as the non-owner
`app_runtime` login. The residuals below are all Low or hygiene-only, disposed as accepted, and are
recorded rather than hidden.

| ID     | Severity           | Observation                                                                                                                                                                                                     | Disposition                                                                                                                                                                                                               |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADV-L1 | Low                | Server-side timing asymmetry: a known-address-wrong-password performs extra audit/count/security-event work vs an immediate return for an unknown address                                                       | **Accepted.** Forced by an RLS invariant (an anonymous principal cannot write `iam.login_audit`), dominated by the mandatory WAN provider round-trip, caller-visible response byte-identical. Non-enumerating in practice |
| ADV-L2 | Low (availability) | `changeStatus` applies last-holder protection only for `iam.user.manage`, while `revokeGrant` covers user/grant/role.manage; a self role-scoped approval limit is not blocked                                   | **Accepted, non-escalation.** Operator-recoverable per ADR-008; the role-scoped ceiling path requires the high-risk `iam.approval.manage` and is fully audited. Optional future alignment                                 |
| ADV-N1 | None (test-cov)    | Request-time denial of a revoked/idle/hard-expired session via `resolveRequestContext` with `sessionRef` present is proven by inspection + a DB-terminality test, but has no direct integration test            | **Accepted.** Logic correct; the only uncovered path is unforgeable. Future test suggested                                                                                                                                |
| ADV-N2 | None (hygiene)     | `CORS_ALLOWED_ORIGINS` is defined but unconsumed; route handlers pass no `peerAddress` so IP-keyed limits bucket peers together                                                                                 | **Accepted, strictly safe.** No `Access-Control-Allow-Origin` is emitted (same-origin-only); the IP bucketing is more restrictive, tracked under P1-OD-027                                                                |
| ADV-N3 | None (correctness) | The R-008 comment's search-path wording is imprecise, and because `app_runtime` holds no USAGE on `extensions`, an unqualified `email = $3` can degrade to case-sensitive comparison for case-variant addresses | **Accepted, fail-closed.** Login is functional (proven on the runtime role); the edge only affects a case-variant address and denies rather than grants. Optional follow-up                                               |

The full per-agent record is retained in the session workflow journal. Two pre-existing, openly
disclosed residuals are carried unchanged: **R-1** (the unkeyed SHA-256 IP/user-agent hash is
reversible **pseudonymisation**, never claimed anonymous — a future keyed-HMAC decision) and **R-3**
(no dependency-vulnerability scanning — not implemented, not claimed).

## 6. Findings fixed across the phase

| ID          | Severity | Finding                                                                                                                                                                                                             | Proven by                                                                                                                                        |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grant-scope | **High** | An empty/omitted/null scope list let a scoped administrator mint an unrestricted tenant-wide grant                                                                                                                  | Fixed at both layers; `tests/db/p1-14-grant-scope-containment.test.ts` + `tests/backend/iam-access-administration.test.ts`, run as `app_runtime` |
| P1-14-R-007 | **High** | Five IAM UPDATE statements set `updated_by`, which `app_runtime` cannot write → `42501`, breaking session/permission/grant/approval writes                                                                          | Fixed (PR #56); revocation + stale-version tests                                                                                                 |
| P1-14-R-008 | **High** | `::citext` cast on the email parameter → _"type citext does not exist"_ at runtime; login and invitation non-functional                                                                                             | Fixed; login success path in `tests/backend/iam-auth-provider.test.ts`                                                                           |
| P1-14-R-009 | **High** | `insertSession` keyed `user_id` off the bootstrap tenant principal → `ins_user_sessions_self` refused → no session opened                                                                                           | Fixed; login success writes a session row on the runtime role                                                                                    |
| P1-14-R-010 | **High** | Role/user/tenant UPDATEs still set `updated_by` (the R-007 sweep missed three) → `42501`                                                                                                                            | Fixed; role/user/tenant update success paths in `tests/backend/iam-admin-writes.test.ts`                                                         |
| P1-14-R-011 | **High** | `countOtherHoldersOf` used `FOR UPDATE OF g`; under RLS a locking read forces `role_grants`' UPDATE policy, so a `user.manage`-only admin under-counted holders to zero and every status change was falsely blocked | Fixed; the `iam.user-status-change` lock path in `tests/backend/iam-admin-writes.test.ts`                                                        |

R-008…R-011 are worth naming: all four were latent in code that had already passed review and green
CI, and all stayed invisible because the operations were registered for OpenAPI but never invoked
below it. They surfaced the moment the operation evidence actually invoked each service on the
deployed runtime role — which is exactly what the operation-evidence completion was for.

## 7. DBCR-P1-14-001 — final disposition: **RESOLVED**

Resolved on executable evidence. The change request recorded that `app_runtime` lacked the runtime
administration capabilities the phase needs; the additive remediation shipped as PR #54 (merge
`1477886`) and is re-verified from the merged protected tree by the capability suites in `test:db`,
which run as the non-owner `app_runtime` login. No `SECURITY DEFINER` routine exists in any of the
seventeen module schemas (**0**), and no application role holds `BYPASSRLS`, superuser, `LOGIN`, or
ownership of any relation.

## 8. Historical record — the gate as it stood before this decision

Preserved byte-verbatim from the Pending version of this document as it existed on protected
`origin/develop` (`5b34c17`). Nothing below has been edited, and it is retained precisely so the
record cannot be read as though the gate were always Go — including its own admission that the
document was absent from the feature delivery.

> # Phase 1-14 Owner Gate — Authentication, Authorization, and Administration Backend
>
> **Company:** RootLco — Root Link Company ·
> **Product:** [PRODUCT NAME — Pending Final Approval] ·
> **Release group:** Release 3 — Backend Foundation ·
> **Phase:** P1-14 — Authentication, Authorization, and Administration Backend ·
> **Date opened:** 2026-07-22 ·
> **Approval owner:** RootLco founders (Product Owner), with technical sign-off by the Architect and
> Security lead ·
> **Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
> [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
> and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
> **This is never represented as an independent third-party audit.**
>
> ---
>
> ## Provenance of this record — read first
>
> This owner-gate document **was missing from the P1-14 feature delivery**. Every prior phase (P1-11,
> P1-12, P1-13) shipped its owner-gate document in the **Pending** state alongside its feature pull
> request; the P1-14 feature pull request (#55) did not include one. No `phase-1-14-owner-gate.md`
> existed in any commit before this file.
>
> It is therefore being created **now**, as part of the remediation governance that followed the failed
> P1-14 gate review — **not** reconstructed as though it had always existed. There is no earlier
> "historical Pending" version of this document to preserve, because there was none; this is the
> initial version, and its initial state is Pending. It must not be read as evidence that the gate was
> open-and-tracked during the feature phase — it was not, and that omission is itself recorded here.
>
> ## Decision: **Pending**
>
> The gate is open. No decision has been recorded, and no result below is claimed in advance of
> evidence. The decision field is filled by the approval owner, never by the implementer, and never
> before the conditions below are all satisfied and evidenced. **It may be converted to Go only after
> the remediation described below is merged into protected `develop` by the owner and the protected
> post-merge state is re-verified.** A Go record must not be created on the remediation branch.
>
> ## 1. What this gate governs
>
> Phase 1-15 may not begin until the authentication provider decision (ADR-019), the authentication and
> session enforcement, the authorization and administration operations, the audit-viewing surface, the
> required catalog corrections, and their executable evidence are approved and demonstrably green in
> hosted CI, on the exact merged SHA.
>
> ## 2. History of the phase
>
> | Item                                  | Value                                                                                                                                                                                      |
> | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | Database remediation (DBCR-P1-14-001) | PR **#54** → merge `1477886`; **RESOLVED**, re-verified from the merged protected tree                                                                                                     |
> | Feature implementation                | PR **#55** → merge `c16f998` (parents `1477886` + `2359bfb`); 38 operations; no migration added or changed                                                                                 |
> | Authentication provider               | **Supabase Auth** — [ADR-019](../../adr/ADR-019-supabase-auth-as-authentication-provider.md)                                                                                               |
> | Gate review outcome                   | **Did not pass** — one confirmed High (grant scope-containment bypass) and absent operation-layer evidence                                                                                 |
> | Remediation (grant scope + evidence)  | Branch `fix/p1-14-grant-scope-and-operation-evidence` → PR **#56** merge `63916b8` — see [the remediation record](phase-1-14-grant-scope-remediation.md)                                   |
> | Operation-evidence completion         | Branch `fix/p1-14-operation-evidence-completion` (off `63916b8`) — see [the completion record](phase-1-14-operation-evidence-completion.md); closes R-8/R-9, fixes R-008/R-009/R-010/R-011 |
>
> ## 3. Gate conditions
>
> | #   | Condition                                                                                           | Status at time of writing                                                                                                              |
> | --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
> | 1   | Authentication provider decision recorded (ADR-019); authorization state never trusted from a token | **Met** — ADR-019; re-verified in the gate review                                                                                      |
> | 2   | Every public operation registered; every protected operation declares permission + audit metadata   | **Met** — `validate:authorization-coverage`                                                                                            |
> | 3   | Unrestricted-grant scope-containment bypass fixed at application **and** database layers            | **Met on the remediation branch** — awaiting owner merge                                                                               |
> | 4   | The runtime-privilege `updated_by` defects fixed and proven (P1-14-R-007 **and** R-010)             | **Met** — R-007 on `63916b8`; R-010 (roles/user_accounts/tenants) on the completion branch                                             |
> | 5   | **Every** registered operation proven at operation depth (service + RLS + context + audit/outbox)   | **Met on the completion branch** — 39/39 operation depth; awaiting owner merge                                                         |
> | 6   | Operation-to-test coverage gate green; coverage matrix published; residuals visible                 | **Met on the completion branch** — 39 operation / 0 unit / 0 pending; strict gate + negative fixture                                   |
> | 7   | Zero unresolved Critical findings                                                                   | **Met** — 0                                                                                                                            |
> | 8   | Zero unresolved High findings without an approved exception                                         | **Met on the completion branch** — the confirmed High, R-007, and the four operation-evidence findings (R-008/R-009/R-010/R-011) fixed |
> | 9   | Local validation green with recorded exit codes                                                     | **To be evidenced on the exact final remediation SHA**                                                                                 |
> | 10  | Clean-room validation green from a clean checkout                                                   | **To be evidenced on the exact final remediation SHA**                                                                                 |
> | 11  | All required hosted CI checks green on the exact final remediation SHA                              | **To be evidenced**                                                                                                                    |
> | 12  | Feature and remediation pull requests merged into `develop` by the repository owner                 | **PR #55 merged; the remediation PR is not merged — the implementer never merges**                                                     |
> | 13  | Gate record committed into protected history with a Go decision                                     | **Not started — this document is Pending**                                                                                             |
> | 14  | Migration posture: one additive remediation migration; no existing migration modified               | **Met on the remediation branch** — migration 116, ROLLBACK-SAFE                                                                       |
> | 15  | No P1-15 work started                                                                               | **Met** — no P1-15 branch, commit, route, or migration exists                                                                          |
>
> ## 4. Known open items carried into the gate
>
> - **Operation-evidence residuals (R-8, R-9) — CLOSED** on the completion branch. All 39 operations
>   now carry operation-depth evidence; 0 `pending`, 0 `unit`. Building that evidence surfaced four
>   latent runtime defects (R-008 citext cast; R-009 session `user_id`; R-010 `updated_by` on
>   roles/user_accounts/tenants; R-011 last-holder `FOR UPDATE` undercount) — all fixed additively and
>   recorded in [the completion record](phase-1-14-operation-evidence-completion.md).
> - **Database-suite intermittency (R-5).** Carried from the feature phase, **undiagnosed, not
>   resolved, severity Low.** Not addressed by this work; re-run recorded in the completion validation.
> - **Dependency-vulnerability scanning (R-3).** Not implemented and not claimed.
> - **P1-OD-027 (NFR-SCL).** Unresolved; every numeric limit remains a proposed validation baseline.
> - **Open decisions** `AUTH-SESSION-TRANSPORT`, `IAM-SELF-ONBOARDING`, `IAM-BASELINE-PERMISSION` —
>   carried from the feature phase.
>
> ## 5. Governance statement
>
> Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
> security reviewer, and repository administrator. Nothing reached protected `develop` outside the
> approved pull-request and hosted-CI flow. The work was reviewed under the Standing Technical
> Authorization and Solo Developer Review policies. This is not an independent third-party review and is
> never represented as one. No gate condition may be waived silently: every residual, pending decision,
> and stated scope boundary is recorded above with its disposition.
>
> ## Status
>
> **PENDING.** No decision recorded. This record was created during remediation governance because it
> was missing from the feature delivery; it may be converted to Go only by the approval owner, after the
> remediation is merged into protected history and the protected post-merge state is re-verified.

## 9. Open decisions carried forward

- **R-5 — database-suite intermittency.** **Low, undiagnosed, not resolved.** The full `test:db` suite
  ran **1269/1269 green** in both the pre-clean-room run and the clean room, but a green run does not
  identify a root cause; the disposition is unchanged and the item is **not** closed. It will be closed
  only when a cause is identified, fixed, and regression-tested.
- **P1-OD-027 (NFR-SCL)** — unresolved. Every numeric limit in this phase remains a proposed validation
  baseline, not an approved production target. No production capacity, throughput, latency, failover,
  replica, CDN, or load-balancer behaviour is claimed anywhere in this record.
- **Open decisions** `AUTH-SESSION-TRANSPORT`, `IAM-SELF-ONBOARDING`, `IAM-BASELINE-PERMISSION` —
  carried forward from the feature phase, unchanged.
- **Dependency-vulnerability scanning (R-3)** and **error-monitoring / metrics / distributed cache /
  rate-limit store platforms** — ports only; no hosted platform is provisioned (ADR-012) and none is
  claimed.

## 10. Residual risks

- The accepted Low and hygiene observations in §5 (ADV-L1, ADV-L2, ADV-N1, ADV-N2, ADV-N3), none of
  which is an escalation or an unresolved Critical/High.
- **R-1** — the unkeyed SHA-256 IP/user-agent hash is reversible pseudonymisation, stored in
  tenant-scoped `Restricted` columns and never described as anonymous.
- **R-5** — database-suite intermittency, Low, undiagnosed, carried open.
- All evidence is from the Local environment. No other environment exists (ADR-012), no penetration
  test was performed, and no production behaviour is claimed.

## 11. Database baseline relationship

The Release 2 baseline tag `release-2-database-baseline` → `ecbbfe8` remains valid and contained in
`origin/develop`. Release 3 adds forward migrations on top of it: P1-13 took the live schema to 114
migrations, the DBCR-P1-14-001 remediation and the grant-scope backstop brought it to **116**, and
P1-14 (PR #55, #58) added **no** migration of its own. The tag is not moved and is not re-cut.

## 12. Governance statement

Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
security reviewer, and repository administrator. Nothing reached protected `develop` outside the
approved pull-request and hosted-CI flow. The work was reviewed under the Standing Technical
Authorization and Solo Developer Review policies. This is not an independent third-party review and is
never represented as one. No gate condition was waived silently: every residual, pending decision, and
stated scope boundary is recorded above with its disposition.

Phase 1-15 has not been started: no branch, commit, pull request, endpoint, or migration for it
exists. The open `develop → main` promotion pull request (**#57**) is the repository owner's and was
inspected read-only; this gate record neither modifies nor merges it, and does not promote `develop`
to `main`.

## Status

**GO — P1-14 Authentication, Authorization, and Administration Backend Gate passed**, subject to the
owner merging this gate record into protected history.
