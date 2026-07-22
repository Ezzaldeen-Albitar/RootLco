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

**Phase 1-14 is in progress. The owner gate is not open and no gate record exists.**

The phase began with a read-only precondition verification, which found one blocking database
capability gap. Per the phase's database rule that gap was raised as a controlled change
request rather than silently remediated, and its migration is delivered in a **separate**
pull request — the governance path already used for DBCR-P1-13-001 (PR #51).

| Step                                 | State                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Precondition verification            | **Complete** — P1-13 contained in both protected branches, gate reads Go |
| DBCR-P1-14-001 raised and classified | **Complete** — BLOCKING for Waves 3–8                                    |
| Remediation migration + tests        | **Complete** — awaiting owner merge into protected `develop`             |
| Authentication provider ADR          | Not started — planned as ADR-019                                         |
| Feature implementation (Waves 1–15)  | **Not started**                                                          |
| Owner gate                           | **Pending** — no gate record exists                                      |

## Artefacts in this folder

| Document                                                           | Purpose                                                                                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Precondition report](phase-1-14-precondition-report.md)           | What was verified before any Phase 1-14 work began: protected history, P1-13 containment, provider-decision review, database contract inventory, the blocking finding, and the scope boundaries. |
| [Migration classification](phase-1-14-migration-classification.md) | Class, rollback posture, object inventory and catalogue effect of the one migration this phase adds.                                                                                             |
| [Remediation validation](evidence/remediation-validation.md)       | Commands, exit codes and measured counts for the remediation branch.                                                                                                                             |

## Related records outside this folder

| Document                                                                                                     | Why it matters here                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [DBCR-P1-14-001](../../database/change-requests/DBCR-P1-14-001-runtime-administration-write-capabilities.md) | The blocking finding, its executable evidence, and the approved additive remediation.                                |
| [DBCR-P1-13-001](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)              | The same class of finding at foundation scale; the governance precedent this phase follows.                          |
| [P1-13 owner gate](../phase-1-13/phase-1-13-owner-gate.md)                                                   | The Go decision this phase builds on, and the conditions it set for starting P1-14.                                  |
| [P1-13 open decisions](../phase-1-13/phase-1-13-open-decisions.md)                                           | Carries `AUTH-PROVIDER`, the open authentication-provider decision this phase must close.                            |
| [Backend architecture and shared foundation](../../standards/backend-architecture-and-shared-foundation.md)  | The conventions this phase composes rather than reinvents; §9 names the `SessionAuthenticator` port as Phase 1-14's. |

## Open decisions this phase must close or carry

| Ref             | Decision                                                                                                                                                                                | State                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `AUTH-PROVIDER` | Authentication and session provider, and the session-claims format                                                                                                                      | To be recorded as ADR-019; no ADR currently decides it        |
| `P1-OD-027`     | NFR-SCL scale targets                                                                                                                                                                   | Unresolved; unaffected by this phase                          |
| PC-1            | `platform.meta.ping` is required by the ping route and the OpenAPI document but is absent from `iam.permissions`                                                                        | Open — to be corrected in the feature phase                   |
| PC-2            | `permission-catalog-reference.md` lists 19 codes; the seed contains 43                                                                                                                  | Open — to be corrected in the feature phase                   |
| PC-3            | No audit-action catalog exists                                                                                                                                                          | Open — to be created in the feature phase                     |
| PC-4            | The `identity.*.v1` event names are unregistered and their `.v1` suffix contradicts the catalog convention; `access.grant.changed` (EVT-IAM-001) already reserves the grant-change fact | Open — the registered names and the catalog convention govern |
