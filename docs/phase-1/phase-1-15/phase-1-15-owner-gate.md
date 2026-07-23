# Phase 1-15 Owner Gate — Shared Services Backend

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date opened:** 2026-07-22 ·
**Approval owner:** RootLco founders (Product Owner), with technical sign-off by the Architect and
Security lead ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## Provenance of this record — read first

This document is created **at the opening of the phase, in the Pending state, and ships with the
feature delivery**. That is deliberate. The Phase 1-14 owner gate was _missing_ from its feature pull
request and had to be created afterwards during remediation governance — a failure that phase
recorded against itself. This record exists from the start so the same omission cannot recur, and so
the gate is visibly open and tracked while the work is being done rather than reconstructed after it.

## Decision: **Pending**

The gate is open. **No decision has been recorded and no result below is claimed in advance of
evidence.** The decision field is filled by the approval owner, never by the implementer, and never
before the conditions below are all satisfied and evidenced on the exact merged SHA.

**It may be converted to Go only after the P1-15 feature is merged into protected `develop` by the
repository owner and the protected post-merge state is independently re-verified.** A Go record must
not be created on the feature branch. No Go gate branch may exist while this phase is in feature
execution.

## 1. What this gate governs

Phase 1-16 may not begin until the reusable shared-services backend — number allocation, audit
recording, status transitions, attachment authorization and lifecycle, signed URLs, notification
enqueueing, template management and rendering, event registration and transactional publication,
search/phone/VIN normalization, cursor pagination, allow-listed filtering and sorting, export
authorization, and liveness/readiness health — is implemented, evidenced at operation depth, and
green in hosted CI on the exact merged SHA.

## 2. Starting state this phase builds on

| Item                                          | Value                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Protected `origin/develop` at branch creation | `c7edc512657077ab31cc98e7b748b4bf90af06d5`                                     |
| Protected `origin/main`                       | `8ca1da257fc89585f2bb45459e435ec124b8a5a7` (P1-14 promoted via owner PR #57)   |
| P1-14 decision                                | **Go** — Authentication, Authorization, and Administration Backend Gate Passed |
| Feature branch                                | `feature/p1-15-shared-services-backend`                                        |
| Database baseline inherited                   | 116 migrations; `shared` schema contracts delivered by Phase 1-5               |
| P1-15 state before this phase                 | **Not started** — no branch, commit, pull request, route, or migration existed |

Contract inventory: [Initial Audit and Contract Inventory](phase-1-15-initial-audit.md).

## 3. Gate conditions

Status values are filled from executable evidence only. "To be evidenced" is the honest state until
the evidence exists on the exact final SHA.

| #   | Condition                                                                                                                                                                                         | Status                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | Every mandatory P1-15 scope item implemented and composed on the existing P1-5/P1-13/P1-14 contracts, with no competing framework                                                                 | To be evidenced                            |
| 2   | Every registered public P1-15 operation carries genuine **operation-depth** evidence (service + repository + runtime context + authorization + RLS + transaction + audit/outbox where applicable) | To be evidenced                            |
| 3   | Registered operations `pending` = 0, unit-only substitutions = 0, unreferenced = 0                                                                                                                | To be evidenced                            |
| 4   | Every protected operation proves permission denial; every tenant-scoped operation proves cross-tenant denial; company/branch operations prove scope isolation                                     | To be evidenced                            |
| 5   | Every mutation proves audit behaviour; critical commands prove idempotency; versioned mutations prove stale-version conflict; event-producing mutations prove atomic outbox                       | To be evidenced                            |
| 6   | Provider operations prove timeout/failure behaviour against deterministic fakes, with **no production provider credentials in CI**                                                                | To be evidenced                            |
| 7   | Number allocation is concurrency-safe, never client-scoped, never auto-provisioning, and its gapless claim matches the database contract exactly                                                  | To be evidenced                            |
| 8   | Audit remains append-only and catalog-controlled; no second audit store exists                                                                                                                    | To be evidenced                            |
| 9   | Status transitions cannot skip policy, cannot be defined by the client, and are atomic with history/audit/outbox                                                                                  | To be evidenced                            |
| 10  | Attachment access is tenant-safe (no IDOR, no traversal, no key collision, no client-chosen key); signed URLs are short-lived, bound, and never logged                                            | To be evidenced                            |
| 11  | Notifications are enqueue-first (no provider call inside the business transaction) and replay-safe; templates are versioned, schema-validated, and safely rendered with no SSTI                   | To be evidenced                            |
| 12  | Events use registered semantics and the repository's existing name/schema-version convention                                                                                                      | To be evidenced                            |
| 13  | Search / phone / VIN normalization is deterministic and does not contradict the frozen P1-6 / P1-7 contracts                                                                                      | To be evidenced                            |
| 14  | Pagination, filtering, and sorting are bounded, allow-listed, and injection-safe, with negative fixtures                                                                                          | To be evidenced                            |
| 15  | Export **authorization** is permission-, scope-, and sensitive-field-controlled, and does not claim export generation                                                                             | To be evidenced                            |
| 16  | Health endpoints are safe, non-leaking, bounded, and reconciled with the pre-existing health route                                                                                                | To be evidenced                            |
| 17  | Runtime RLS remains default-deny; no application role gains `BYPASSRLS`, superuser, `LOGIN`, or ownership                                                                                         | To be evidenced                            |
| 18  | No provider secret reaches browser code                                                                                                                                                           | To be evidenced                            |
| 19  | Zero unresolved Critical findings                                                                                                                                                                 | To be evidenced                            |
| 20  | Zero unresolved High findings without an approved exception                                                                                                                                       | To be evidenced                            |
| 21  | Migration posture: migrations 1–116 unmodified; any new migration additive, rollback-safe, and governed through a controlled database change request                                              | To be evidenced                            |
| 22  | Local validation green with recorded exit codes                                                                                                                                                   | To be evidenced                            |
| 23  | Genuine isolated clean-room validation green, with limitations recorded accurately rather than hidden                                                                                             | To be evidenced                            |
| 24  | All required hosted CI checks green on the exact final SHA                                                                                                                                        | To be evidenced                            |
| 25  | Feature pull request merged into `develop` by the repository owner                                                                                                                                | **The implementer never merges**           |
| 26  | Gate record committed into protected history with a Go decision                                                                                                                                   | **Not started — this document is Pending** |
| 27  | No P1-16 work started                                                                                                                                                                             | To be evidenced                            |

### 3.1 Where the pre-merge evidence for each condition now lives

Every status above is still **"To be evidenced"**, and that is not an oversight. This gate is
evaluated on the **exact merged SHA**, which does not exist while the pull request is open, and the
approval owner fills the column after re-verifying from protected `develop`. Nothing on a feature
branch can close a condition here.

What the table does not do is tell a reader where to look. This does. It is a pointer list, not a
status list, and no row of it may be read as a satisfied condition.

| #     | Pre-merge artefact on `feature/p1-15-shared-services-backend`                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | [`phase-1-15-architecture.md`](phase-1-15-architecture.md), [`phase-1-15-implementation-decisions.md`](phase-1-15-implementation-decisions.md)     |
| 2–5   | [`operation-inventory.md`](operation-inventory.md) — 21 of 21 at operation depth, with the per-operation property proved for each evidence kind    |
| 3     | `npm run validate:operation-coverage` prints the P1-15 breakdown separately from the repository aggregate                                          |
| 6     | `tests/backend/p1-15-dispatch-and-health.test.ts` — timeout, outage, rejection, bounded retry, dead-letter, and the unconfigured provider          |
| 7     | `tests/db/p1-15-number-allocation.test.ts` — 24 tests including two overlapping committed transactions                                             |
| 8     | `tests/foundation/p1-15-catalogs.test.ts` plus the audit read-backs in the route suite                                                             |
| 9     | `tests/db/p1-15-transitions.test.ts` and the route suite's state + history + audit + event assertions                                              |
| 10    | `tests/foundation/p1-15-storage-key.test.ts`, `p1-15-signed-urls.test.ts`, and the bidirectional IDOR proofs in the route suite                    |
| 11    | `tests/foundation/p1-15-template-rendering.test.ts`, `p1-15-notification-policy.test.ts`, and the "provider never called" assertion at route depth |
| 12    | `tests/foundation/p1-15-catalogs.test.ts` and the per-operation `event_key` counts                                                                 |
| 13    | `tests/db/p1-15-normalization-parity.test.ts`                                                                                                      |
| 14    | `tests/foundation/p1-15-query-primitives.test.ts`                                                                                                  |
| 15    | `tests/foundation/p1-15-export-policy.test.ts`, `tests/db/p1-15-export-authorization.test.ts`                                                      |
| 16    | `tests/foundation/p1-15-health.test.ts` and the unauthenticated route proofs                                                                       |
| 17/21 | `tests/db/p1-15-shared-services-runtime-capabilities.test.ts`; **P1-15 adds no migration**                                                         |
| 18    | `npm run security:browser-secrets`; `tests/foundation/p1-15-observability.test.ts` for the label and log-context rules                             |
| 19/20 | [`security-review.md`](security-review.md)                                                                                                         |
| 22/23 | [`test-catalog.md`](test-catalog.md), [`clean-room-validation.md`](clean-room-validation.md)                                                       |
| 24    | The pull request's own check runs on the exact final SHA                                                                                           |
| 27    | No `p1-16` branch and no `p1-16` path exists                                                                                                       |

## 4. Known open items carried into the phase

- **P1-OD-027 (NFR-SCL).** Unresolved. Every numeric limit in this phase is a proposed validation
  baseline, not a measured production target.
- **`AUTH-SESSION-TRANSPORT`**, **`IAM-SELF-ONBOARDING`**, **`IAM-BASELINE-PERMISSION`** — carried
  from Phase 1-14, unresolved.
- **R-3 — dependency-vulnerability scanning.** No control is implemented and none is claimed.
- **R-5 — database-suite intermittency.** Carried from Phase 1-14: **Low, undiagnosed, not
  resolved.** A green run does not close it.
- **R-1 — reversible IP / user-agent pseudonymisation.** Disclosed limitation, unchanged.
- **Provider decisions.** Object storage, signed-URL generation, email/SMS delivery, and template
  rendering are governed by the phase's provider-decision record. Where no production provider is
  approved, this phase delivers a provider-neutral port plus a deterministic fake and, where
  appropriate, a local/development adapter only — and claims no production delivery.

## 5. Governance statement

Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
security reviewer, and repository administrator. Nothing reached protected `develop` outside the
approved pull-request and hosted-CI flow. The work was reviewed under the Standing Technical
Authorization and Solo Developer Review policies. This is not an independent third-party review and
is never represented as one. No gate condition may be waived silently: every residual, pending
decision, and stated scope boundary is recorded with its disposition.

## Status

**PENDING.** No decision recorded. This record was created at the opening of the phase and ships with
the feature delivery; it may be converted to Go only by the approval owner, after the feature is
merged into protected history and the protected post-merge state is re-verified.
