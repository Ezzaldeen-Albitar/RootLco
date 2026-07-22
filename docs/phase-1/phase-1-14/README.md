# Phase 1-14 — Authentication, Authorization, and Administration Backend

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-22 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).

> **Authority.** Phase scope and sequencing are governed by the canonical documents recorded in
> [canonical-documents.md](../../governance/canonical-documents.md), which live outside this
> repository by owner decision.

---

## Status

**The feature implementation was merged (PR #55), the owner-gate review did NOT pass, and a
governed remediation is in progress on `fix/p1-14-grant-scope-and-operation-evidence`.** The gate
found one **confirmed High** (unrestricted-grant scope-containment bypass) and the absence of
application-layer operation evidence; the remediation fixes both at the application and database
layers, fixes a second High surfaced in the process (P1-14-R-007), adds an operation-to-test coverage
gate, and creates the owner-gate record (in **Pending**) that was missing from the feature delivery.
See the [grant-scope remediation record](phase-1-14-grant-scope-remediation.md) and the
[owner gate](phase-1-14-owner-gate.md).

The phase began with a read-only precondition verification, which found one blocking database
capability gap. Per the phase's database rule that gap was raised as a controlled change
request rather than silently remediated, and its migration was delivered in a **separate**
pull request — the governance path already used for DBCR-P1-13-001 (PR #51). That pull request
(**#54**) was merged by the owner into protected `develop` as `1477886`, and the remediation was
re-verified from the merged protected tree before any feature work began.

| Step                                 | State                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| Precondition verification            | **Complete** — P1-13 contained in both protected branches, gate reads Go                |
| DBCR-P1-14-001 raised and classified | **Complete** — BLOCKING for Waves 3–8                                                   |
| Remediation migration + tests        | **Complete and merged** — PR #54 → `1477886`; re-verified on protected `develop`        |
| Authentication provider ADR          | **Complete** — [ADR-019](../../adr/ADR-019-supabase-auth-as-authentication-provider.md) |
| Feature implementation               | **Complete** — 38 operations, no migration added or changed                             |
| Catalog corrections PC-1 … PC-4      | **Complete** — see the architecture record §9                                           |
| Owner gate                           | **Pending** — no gate record exists                                                     |

## Artefacts in this folder

| Document                                                                                                     | Purpose                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Precondition report](phase-1-14-precondition-report.md)                                                     | What was verified before any Phase 1-14 work began: protected history, P1-13 containment, provider-decision review, database contract inventory, the blocking finding, and the scope boundaries.          |
| [Authentication and authorization architecture](phase-1-14-authentication-and-authorization-architecture.md) | How a request is authenticated and authorized, why nothing authorization-bearing is in a token, the two things the protected schema will not express, the catalog corrections, and the operator runbooks. |
| [Threat review and validation evidence](phase-1-14-security-review-and-evidence.md)                          | Findings raised against this implementation with their dispositions, the reviewed attack surface, commands and exit codes, residual risks, and open decisions.                                            |
| [Migration classification](phase-1-14-migration-classification.md)                                           | Class, rollback posture, object inventory and catalogue effect of the one migration this phase adds — delivered and merged in PR #54.                                                                     |
| [Remediation validation](evidence/remediation-validation.md)                                                 | Commands, exit codes and measured counts for the remediation branch.                                                                                                                                      |

## Related records outside this folder

| Document                                                                                                     | Why it matters here                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [DBCR-P1-14-001](../../database/change-requests/DBCR-P1-14-001-runtime-administration-write-capabilities.md) | The blocking finding, its executable evidence, and the approved additive remediation.                                |
| [DBCR-P1-13-001](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)              | The same class of finding at foundation scale; the governance precedent this phase follows.                          |
| [P1-13 owner gate](../phase-1-13/phase-1-13-owner-gate.md)                                                   | The Go decision this phase builds on, and the conditions it set for starting P1-14.                                  |
| [P1-13 open decisions](../phase-1-13/phase-1-13-open-decisions.md)                                           | Carries `AUTH-PROVIDER`, the open authentication-provider decision this phase must close.                            |
| [Backend architecture and shared foundation](../../standards/backend-architecture-and-shared-foundation.md)  | The conventions this phase composes rather than reinvents; §9 names the `SessionAuthenticator` port as Phase 1-14's. |

## Open decisions this phase must close or carry

| Ref                       | Decision                                                                                                                                                                                | State                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `AUTH-PROVIDER`           | Authentication and session provider, and the session-claims format                                                                                                                      | **Closed** by ADR-019 — Supabase Auth, with RootLco IAM as the sole authorization authority              |
| PC-1                      | `platform.meta.ping` is required by the ping route and the OpenAPI document but is absent from `iam.permissions`                                                                        | **Closed** — application-metadata defect; `meta.ping` now declares `org.tenant.read`. No database change |
| PC-2                      | `permission-catalog-reference.md` lists 19 codes; the seed contains 43                                                                                                                  | **Closed** — regenerated from the executable seed                                                        |
| PC-3                      | No audit-action catalog exists                                                                                                                                                          | **Closed** — `src/server/auth/audit-actions.ts`, enforced at registration and in CI                      |
| PC-4                      | The `identity.*.v1` event names are unregistered and their `.v1` suffix contradicts the catalog convention; `access.grant.changed` (EVT-IAM-001) already reserves the grant-change fact | **Closed** — the registered name is implemented; three further IAM events registered through the process |
| `AUTH-SESSION-TRANSPORT`  | Whether a browser client uses a session cookie, and the CSRF machinery that would imply                                                                                                 | **New, open** — bearer tokens today; belongs to the phase that introduces a browser client               |
| `IAM-SELF-ONBOARDING`     | Whether self-service invitation acceptance is wanted                                                                                                                                    | **New, open** — not expressible against the current schema; would need a controlled change request       |
| `IAM-BASELINE-PERMISSION` | Whether every active account should hold a baseline permission so self-directed reads are reachable without an administrative grant                                                     | **New, open** — see finding P1-14-R-004                                                                  |
| `P1-OD-027`               | NFR-SCL scale targets                                                                                                                                                                   | **Unresolved**; every numeric limit in this phase is a proposed validation baseline                      |
