# Phase 1-15 Owner Gate — Shared Services Backend

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date opened:** 2026-07-22 · **Date decided:** 2026-07-23 ·
**Approval owner:** RootLco founders (Product Owner), with technical sign-off by the Architect and
Security lead ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## Decision: **Go — P1-15 Shared Services Backend Gate Passed**

This decision is recorded from the **protected post-merge state** — `origin/develop` at
`026a8da2a9d1efe420078aad3ee56da59b1d46ba`, the merge of Remediation PR #63 — after the complete
feature-plus-remediation chain (PR #60, #61, #62, #63) was merged into protected history by the
repository owner and independently re-verified. No condition below was closed on a feature branch; each
was evidenced on the exact merged SHA.

The gate was **genuinely open** until this evidence existed. This document shipped in the Pending state
with the feature delivery (PR #61) and stayed Pending across two required remediations. Its complete
Pending text is preserved **byte-verbatim** in §8; this decision adds sections and flips the decision
field, and does not rewrite the record it was made against.

## 1. What this gate governs

Phase 1-16 may not begin until the reusable shared-services backend — number allocation, audit
recording, status transitions, attachment authorization and lifecycle, signed URLs, notification
enqueueing, template management and rendering, event registration and transactional publication,
search/phone/VIN normalization, cursor pagination, allow-listed filtering and sorting, export
authorization, and liveness/readiness health — is implemented, evidenced at operation depth, and green
in hosted CI on the exact merged SHA. That condition is now met.

## 2. Protected history

The whole of P1-15 reached protected `develop` through four owner-merged pull requests and nothing
else. `origin/main` was not touched by any of them.

| PR      | Title                                                                  | Reviewed head SHA | Merge commit | Merged (Asia/Amman) | Method       | Tree equivalence (merge tree == reviewed-head tree) | Hosted CI            |
| ------- | ---------------------------------------------------------------------- | ----------------- | ------------ | ------------------- | ------------ | --------------------------------------------------- | -------------------- |
| **#60** | [P1-15] Enable tenant-safe shared-services runtime write capabilities  | `d39f576`         | `e50d501`    | 2026-07-23 08:03    | Merge commit | verified contained                                  | green pre-#61        |
| **#61** | [P1-15] Implement shared services backend                              | `a47b3d2`         | `0b843bf`    | 2026-07-23 16:47    | Merge commit | develop-then == `a47b3d2` tree                      | CI #154 Success      |
| **#62** | [P1-15] Harden the shared number-allocation database contract          | `533ba9e`         | `4d1eff2`    | 2026-07-23 18:23    | Merge commit | develop-then == `533ba9e` tree (byte-identical)     | CI #156 Success      |
| **#63** | [P1-15] Restore the auth-route rate limit this phase removed (PMR-006) | `8246a9e`         | `026a8da`    | 2026-07-23 21:11    | Merge commit | develop-now == `8246a9e` tree (byte-identical)      | CI #157/#158 Success |

Containment on current `origin/develop` (`026a8da`): `e50d501`, `a47b3d2`, `0b843bf`, `533ba9e`,
`4d1eff2`, `8246a9e`, and `d39f576` are all ancestors. `026a8da` has parents `4d1eff2` + `8246a9e`;
its tree (`1c31a02…`) is byte-identical to the reviewed head `8246a9e` (0-file diff). No direct push
entered protected history; every merge is an owner pull-request merge. `origin/main` remains
`8ca1da257fc89585f2bb45459e435ec124b8a5a7`.

### 2.1 Why two remediations followed the feature merge, and in what order

The chronology is recorded plainly because it is the point of the record.

1. **PR #61** merged the feature and made this Pending gate protected.
2. The post-merge gate review reproduced **P1-15-SR-014** on the merged state (a period-resetting
   number sequence could re-issue a number, because the allocator read `now()` — transaction-start
   time). A database function needs a migration, so it was fixed on its own branch as **PR #62**
   (migration 118, DBCR-P1-15-002), which also fixed three further defects the same review found,
   including **PMR-001**, a High this phase had introduced into P1-14's rate-limit surface.
3. The gate re-verification after PR #62 asked what this phase changed about the previous phase's
   controls, and found **PMR-006**: `handleOperation` skipped the pre-authentication throttle for
   every public ip-keyed policy when no client address resolved, which silently removed the
   `auth-adjacent` limit P1-14 had shipped on the four unauthenticated `iam.auth-*` routes. It was
   fixed on its own branch as **PR #63** (one application conjunct, no migration).
4. The gate is converted to Go only now, after all three merges (#61/#62/#63) and a full re-verification
   from the protected `026a8da` state.

## 3. Gate conditions

Every status is filled from executable evidence on the exact merged SHA `026a8da`, not from a feature
branch.

| #   | Condition                                                                                                                                                | Status                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every mandatory P1-15 scope item implemented and composed on the existing P1-5/P1-13/P1-14 contracts, with no competing framework                        | **Met** — 21 operations across number allocation, audit, transitions, attachments, signed URLs, notifications, templates, events, normalization, query primitives, export, health |
| 2   | Every registered public P1-15 operation carries genuine **operation-depth** evidence                                                                     | **Met** — 21/21 operation-depth (`validate:operation-coverage`)                                                                                                                   |
| 3   | Registered operations `pending` = 0, unit-only = 0, unreferenced = 0                                                                                     | **Met** — pending 0, unit-only 0, unreferenced 0, invocation-only 0, metadata-only 0                                                                                              |
| 4   | Every protected operation proves permission denial; tenant-scoped operations prove cross-tenant denial; company/branch operations prove scope isolation  | **Met** — `tests/backend/p1-15-operation-routes.test.ts` (bidirectional cross-tenant proofs)                                                                                      |
| 5   | Every mutation proves audit; critical commands prove idempotency; versioned mutations prove stale-version; event-producing mutations prove atomic outbox | **Met** — route + db suites                                                                                                                                                       |
| 6   | Provider operations prove timeout/failure against deterministic fakes, no production credentials in CI                                                   | **Met** — `tests/backend/p1-15-dispatch-and-health.test.ts`; unconfigured provider default                                                                                        |
| 7   | Number allocation is concurrency-safe, never client-scoped, never auto-provisioning, gapless claim matches the database contract                         | **Met** — `tests/db/p1-15-number-allocation.test.ts` + migration 118 hardening (24 + 16 proofs)                                                                                   |
| 8   | Audit append-only and catalog-controlled; no second audit store                                                                                          | **Met** — `tests/foundation/p1-15-catalogs.test.ts` + audit read-backs                                                                                                            |
| 9   | Status transitions cannot skip policy, cannot be client-defined, and are atomic with history/audit/outbox                                                | **Met** — `tests/db/p1-15-transitions.test.ts`                                                                                                                                    |
| 10  | Attachment access tenant-safe (no IDOR/traversal/key-collision/client-chosen key); signed URLs short-lived, bound, never logged                          | **Met** — storage-key/signed-url suites + IDOR proofs at route depth                                                                                                              |
| 11  | Notifications enqueue-first (no provider call in the business transaction) and replay-safe; templates versioned, schema-validated, no SSTI               | **Met** — template-rendering/notification-policy suites + "provider never called" at route depth                                                                                  |
| 12  | Events use registered semantics and the repository's name/schema-version convention                                                                      | **Met** — catalogs suite + per-operation `event_key` counts                                                                                                                       |
| 13  | Search / phone / VIN normalization deterministic and consistent with the frozen P1-6 / P1-7 contracts                                                    | **Met** — `tests/db/p1-15-normalization-parity.test.ts` (differential parity)                                                                                                     |
| 14  | Pagination, filtering, sorting bounded, allow-listed, injection-safe, with negative fixtures                                                             | **Met** — `tests/foundation/p1-15-query-primitives.test.ts` (76 proofs against emitted SQL)                                                                                       |
| 15  | Export **authorization** permission-, scope-, and sensitive-field-controlled, claims no export generation                                                | **Met** — export-policy + export-authorization suites; R-10 records the unfulfilled file obligation                                                                               |
| 16  | Health endpoints safe, non-leaking, bounded, reconciled with the pre-existing health route                                                               | **Met** — `tests/foundation/p1-15-health.test.ts`; `/api/health` proven unchanged                                                                                                 |
| 17  | Runtime RLS default-deny; no application role gains `BYPASSRLS`, superuser, `LOGIN`, or ownership                                                        | **Met** — clean room: bypassrls 0 / superuser 0 / owned 0 / RLS-not-forced 0; runtime cannot INSERT status_history / file_scan_results / delivery_attempts                        |
| 18  | No provider secret reaches browser code                                                                                                                  | **Met** — `npm run security:browser-secrets` exit 0; `p1-15-observability.test.ts`                                                                                                |
| 19  | Zero unresolved Critical findings                                                                                                                        | **Met** — 0                                                                                                                                                                       |
| 20  | Zero unresolved High findings without an approved exception                                                                                              | **Met** — 0 (SR-002/004/006 and PMR-001 all fixed and regression-locked)                                                                                                          |
| 21  | Migration posture: 1–116 unmodified; any new migration additive, rollback-safe, governed by a change request                                             | **Met** — migrations 1–116 identical to `main`; 117 (DBCR-P1-15-001) and 118 (DBCR-P1-15-002) additive and ROLLBACK-SAFE; PR #63 added no migration                               |
| 22  | Local validation green with recorded exit codes                                                                                                          | **Met** — recorded in [test-catalog.md](test-catalog.md) and §4 below                                                                                                             |
| 23  | Genuine isolated clean-room validation green, limitations recorded accurately                                                                            | **Met** — §4; 71 steps, 69 exit 0, the two non-zero being the recorded R-11/R-12 residuals                                                                                        |
| 24  | All required hosted CI checks green on the exact final SHA                                                                                               | **Met** — CI #157 on `8246a9e` (4/4) and CI #158 on `026a8da`                                                                                                                     |
| 25  | Feature and remediation pull requests merged into `develop` by the repository owner                                                                      | **Met** — PR #60/#61/#62/#63 all owner-merged; the implementer merged nothing                                                                                                     |
| 26  | Gate record committed into protected history with a Go decision                                                                                          | **In progress** — this record, offered as the docs-only gate PR; the owner performs the merge                                                                                     |
| 27  | No P1-16 work started                                                                                                                                    | **Met** — no `p1-16` branch, PR, path, migration, route, or module exists                                                                                                         |

## 4. Validation from the merged protected state

A genuine isolated clean room was run on the exact gate SHA `026a8da` in a fresh short-path worktree,
with its own `npm ci` and a database rebuilt from empty and seeded twice. It ran **alone** — no other
process loaded the machine — so the R-5 database-suite intermittency (which is load-induced) did not
recur, and every `test:db` suite passed.

**71 steps, 69 at exit 0.** The only two non-zero exits are the recorded, accepted residuals:
`validate:seed-state` **after** `test:db` (R-11, a Phase 1-5 suite's fixture) and `validate:canonical-docs`
(R-12, two Word documents held outside the repository). Neither is a hosted-CI job and neither is a
P1-15 defect.

| Evidence                                                | Result on `026a8da`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migrations                                              | **118**; 1–117 identical to `4d1eff2` (0-file diff); 117 + 118 the only additions vs `main`                                                                                                                                                                                                                                                                                                                                                      |
| App-schema catalogue (pristine == final)                | **tables 242 · functions 212 · policies 629 · triggers 541 · permissions 45 · SECURITY DEFINER 0 · indexes 999**                                                                                                                                                                                                                                                                                                                                 |
| Role posture                                            | **bypassrls 0 · superuser 0 · owned relations 0 · owned schemas 0 · owned functions 0 · RLS-not-forced 0**                                                                                                                                                                                                                                                                                                                                       |
| Migration-118 functions                                 | `next_display_number` and `guard_number_sequence_regression` — both SECURITY INVOKER, `search_path=""`, `clock_timestamp()` yes, `now()` no                                                                                                                                                                                                                                                                                                      |
| Runtime write boundary                                  | `app_runtime` cannot INSERT `shared.status_history`, `shared.file_scan_results`, or `shared.delivery_attempts`                                                                                                                                                                                                                                                                                                                                   |
| P1-15 operation coverage                                | **registered 21 · operation-depth 21 · invocation-only 0 · pending 0 · unit-only 0 · unreferenced 0 · metadata-only 0**                                                                                                                                                                                                                                                                                                                          |
| PMR-006 throttle-fallback suite                         | **7 / 7 passed** on the exact gate SHA                                                                                                                                                                                                                                                                                                                                                                                                           |
| Unit / foundation (`npm test`)                          | **733 passed** / 38 files                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Backend (`npm run test:backend`)                        | **364 passed** / 16 files                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Database (`npm run test:db`)                            | **1534 passed** / 131 files                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Total**                                               | **2631 tests across 185 files**                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Business-table residue after the full suite             | all zero (tenants, branches, documents, versions, templates, outbound, outbox, processed, errors, users, audit_records, sequences, vehicles)                                                                                                                                                                                                                                                                                                     |
| Static / security / boundary / OpenAPI / classification | `format:check`, `lint`, `typecheck`, `style:check`, `validate:encoding`, `validate:operation-coverage`, coverage negative fixture, `validate:module-boundaries`, `validate:authorization-coverage`, `validate:openapi`, `validate:schema-inventory`, `validate:structural-review`, all six classification linters, `security:tracked-secrets`, `security:browser-secrets`, `security:scope-exclusions`, `validate:no-fake-data` — **all exit 0** |
| Build / containers                                      | `npm run build`, `docker compose config`, `docker build --target dev`, `docker build --target runner`, production image runs non-root — **all exit 0**                                                                                                                                                                                                                                                                                           |
| Governance                                              | owner-gate decision line present; no `p1-16` branch; no `p1-16` path                                                                                                                                                                                                                                                                                                                                                                             |

Hosted CI is the authority for the tiers a single loaded workstation cannot measure cleanly: **CI #157
on `8246a9e`** (the reviewed head, tree-identical to the merge) was green on all four required jobs —
Lint/types/tests/build, Docker build validation, Database migrations and RLS tests, and Secret and
sensitive-file scan — and **CI #158** ran on the merge commit `026a8da` itself.

## 5. Final security review

Three refute-oriented reviews stand behind this decision, none represented as an independent audit:

- **Feature security review** ([security-review.md](security-review.md)) — resolved SR-002 (idempotency
  path parameters), SR-004 (public health-probe throttle), SR-006 (session-revoke visibility), and six
  further Mediums, each with a regression test.
- **Post-merge security review** ([post-merge-security-review.md](post-merge-security-review.md)) — over
  the merged state; reopened and closed SR-014, and found PMR-001 (High), PMR-002, PMR-004, PMR-005, and
  PMR-006. It also records, in §7.1, that it first mis-dispositioned PMR-006, and why — a review that
  quietly rewrites its own dispositions cannot be audited.
- **Final gate review** — a fresh refute-oriented pass over the protected `026a8da` state across six
  surfaces (throttle fallback, number-sequence timing, attachment/storage, notification/template,
  query/export/health, observability/redaction), each candidate handed to three verifiers instructed to
  refute. **0 candidates survived.** Agent agreement is corroboration, not evidence; the surviving
  conclusions in this record each rest on a committed test, a source path, a runtime-role probe, a live
  database probe, git containment, the clean room, or hosted CI.

Two cross-phase regression sweeps were also run over the P1-15 diff against the P1-14 baseline
(`e50d501`). The first attempt failed on seven agent connection errors and produced **zero** evidence —
recorded as a failure, not a pass. The second completed cleanly: seven lenses, **zero candidates**.

## 6. Findings fixed across the phase

| ID           | Severity | Where fixed                    | Disposition                                                                                                                                              |
| ------------ | -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-15-SR-002 | High     | PR #61                         | Resolved — resolved path params in the idempotency fingerprint (scheme `v3`)                                                                             |
| P1-15-SR-004 | High     | PR #61 (+ #62/#63 corrections) | Resolved — `public-probe` policy for tenant-keyed public ops; see PMR-001/PMR-006 for the two later corrections                                          |
| P1-15-SR-006 | High     | PR #61                         | Resolved — revoking operations declare the read permission; 403 at the gate, not a silent no-op                                                          |
| P1-15-SR-014 | Medium   | PR #62 (migration 118)         | Resolved — allocator reads `clock_timestamp()`; guard refuses any non-clock period key                                                                   |
| PMR-001      | **High** | PR #62                         | Resolved — the SR-004 fix no longer substitutes `public-probe` for a sessionless declared policy; the four `iam.auth-*` routes keep `auth-adjacent`      |
| PMR-002      | Medium   | PR #62                         | Resolved — a public operation with no declared policy resolves to `public-probe`, never to none                                                          |
| PMR-004      | Medium   | PR #62                         | Resolved — the guard compares against the clock, closing NULL and future-period forgery                                                                  |
| PMR-005      | Medium   | PR #62                         | Resolved — notification enqueue resolves one scope for the row, the audit record and the event                                                           |
| PMR-006      | Medium   | PR #63                         | Resolved — the unkeyable-policy throttle skip requires `securityRelevant === false`; the auth routes degrade to a coarse bucket (R-14), never to nothing |

**Unresolved Critical: 0. Unresolved High: 0.** Every Medium is either fixed above or formally accepted
in §10 with evidence, bounded impact, owner, and residual.

## 7. Database change requests — final disposition

- **DBCR-P1-15-001 — RESOLVED.** Migration 117 (`20260728090000_shared_services_runtime_write_capabilities`)
  granted the tenant-safe runtime write capabilities the shared services need, additively and without
  weakening RLS. Merged via PR #60. Runtime-capability suite green in the clean room; runtime holds no
  `BYPASSRLS`, superuser, `LOGIN`, or ownership.
- **DBCR-P1-15-002 — RESOLVED.** Migration 118 (`20260729090000_shared_number_sequence_period_hardening`)
  replaced two function bodies to read `clock_timestamp()` and refuse any invented period key. No table,
  column, constraint, index, trigger attachment, grant, policy, role, or row changed; both functions
  remain SECURITY INVOKER with `search_path=""`. Merged via PR #62. Regression-locked by 16 database and
  6 application proofs, all green in the clean room.

## 8. Historical record — the Pending gate as it stood before this decision

Preserved **byte-verbatim** from the Pending version of this document as it existed on protected
`origin/develop` at `026a8da` — git blob `58bb14a0fef9b0c12c494ee13d4bba1138026ab8`, 17 034 bytes. It is
embedded in a fenced block so its bytes are not reflowed by any formatter. The preservation is
verifiable without trust: extract the fenced block below, append a single trailing newline, and its
SHA-256 is
`cdf155ca7d5b963f783f4c8a2edb3ef9b8e412b2c07150b89d78bec0e52b7e83` — the exact bytes of that blob. This
was confirmed during gate preparation, before and after formatting. This decision does not edit the
text below; it stood open, in this exact form, until the evidence above existed.

```text
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
```

## 9. Open decisions carried forward

None of these is closed by this phase, and none blocks the gate; each is recorded so a reader is not
misled into assuming the opposite.

- **R-5 — database-suite intermittency. Low, undiagnosed, not resolved.** Carried from Phase 1-14. The
  full `test:db` suite ran **1534 / 1534 green** in this clean room, but a green run does not identify a
  root cause, so the disposition is unchanged and the item is **not** closed. During the gate work the
  suite hook-timed-out twice on a **loaded** workstation (two pre-P1-15 suites, `iam-roles` and
  `rec-complaints-contents`); re-run in isolation they passed. That reproduces the intermittency as
  load-induced but does not diagnose it. It closes only when a cause is found, fixed, and
  regression-tested.
- **R-3 / PMR-008 — dependency-vulnerability scanning.** No control is implemented and none is claimed.
  Its absence is stated, not compensated for.
- **R-1 — reversible IP / user-agent pseudonymisation.** Disclosed limitation, unchanged.
- **P1-OD-027 (NFR-SCL).** Unresolved. Every numeric limit in this phase — rate-limit budgets, cache
  sizes, page bounds — is a **proposed validation baseline**, not a measured production target. No
  throughput, latency, capacity, failover, replica, CDN, or load-balancer behaviour is claimed anywhere
  in this record.
- **`AUTH-SESSION-TRANSPORT`, `IAM-SELF-ONBOARDING`, `IAM-BASELINE-PERMISSION`** — carried from Phase
  1-14, unresolved.
- **Provider decisions.** Object storage, signed-URL generation, email/SMS delivery, and template
  rendering are governed by the phase's provider-decision record. Where no production provider is
  approved, this phase ships a provider-neutral port plus a deterministic fake and, where appropriate, a
  local/development adapter only, and claims **no production delivery**. No production object store or
  message provider is provisioned, and no suite contacts one.

## 10. Residual risks

The full register is [risk-register.md](risk-register.md). Every residual there is Low or Medium; none
is Critical or High, and none is claimed to be closed by the phase. The ones the gate directive calls
out by name:

- **R-11 — `validate:seed-state` fails when run after `test:db`. Low, accepted.** A **Phase 1-5** suite,
  `tests/db/shared-retention.test.ts`, overwrites three retention periods for its eligibility tests and
  does not restore them. `.github/workflows/ci.yml` runs the seed assertion (line 242) **before**
  `test:db` (line 290), so hosted CI always measures an untouched database; the clean room's pristine
  seed assertion passed. P1-15 does not fix it — editing another phase's test to make this phase's run
  look cleaner is exactly what the review policy exists to prevent. It belongs to whoever next opens
  Phase 1-5's tests.
- **R-12 — `validate:canonical-docs` can pass in no checkout. Low, accepted.** The check compares
  recorded hashes of two Word documents held at `../` paths **outside** the repository. It is an
  owner-side integrity control over the canonical originals and is **not** a required hosted-CI job. No
  clone, worktree, or CI runner can satisfy it; the clean room records it as unavailable, never green.
  Every **repository-owned** documentation and encoding validator did pass.
- **R-14 — the four unauthenticated auth routes hold only a coarse, shared throttle bucket. Medium,
  accepted.** Since **PMR-006** the pipeline no longer skips the `auth-adjacent` limit for want of a
  client address, so the limit is enforced — but on **one shared bucket**, because no peer address
  resolves in this deployment. Ten requests a minute is then a global budget, so a hostile caller can
  deny logins. That availability exposure is accepted in preference to unbounded credential stuffing on
  an unauthenticated credential endpoint; the authentication provider also enforces its own lockout.
  Closing it properly needs a peer address plumbed from the platform — infrastructure work, not
  application code. Pinned meanwhile by `tests/foundation/p1-15-public-throttle-fallback.test.ts`.
- **R-15 / PMR-007 — a keyset cursor can skip a row inside one millisecond. Medium, accepted.**
  `Cursor.v` carries the last-seen sort value as an ISO string with millisecond precision, while
  `timestamptz` keeps microseconds, so two rows inside the same millisecond can straddle a page edge.
  Every page runs under RLS, so the failure mode is **completeness, never disclosure**. It is a **P1-13
  foundation** contract used by every module, and **no P1-15 public operation ships a paginated list**
  today, so nothing currently exercises it. It stays Medium because the encoding is genuinely lossy;
  fixing it is a cross-module change to the cursor value encoding (application code, no new database
  contract) and belongs to its own review, not to this gate.

## 11. Database baseline relationship

`origin/main` is `8ca1da2` and carries the Release-2 database baseline plus the P1-13/P1-14 promotion —
**116 migrations**. Protected `origin/develop` at `026a8da` carries **118**: the two additions are
migration 117 (DBCR-P1-15-001, PR #60) and migration 118 (DBCR-P1-15-002, PR #62). Migrations 1–116 are
byte-identical between `main` and `develop`. This gate record does **not** promote `develop` to `main`;
that is a separate, owner-controlled decision and no `develop → main` promotion is performed or proposed
here.

## 12. Governance statement

Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
security reviewer, and repository administrator. Nothing reached protected `develop` outside the
approved pull-request and hosted-CI flow. The work was reviewed under the Standing Technical
Authorization and Solo Developer Review policies. **This is not an independent third-party review and is
never represented as one.** No gate condition was waived silently: every residual, open decision, and
stated scope boundary is recorded above with its disposition. Malware scanning, dependency-vulnerability
scanning, production monitoring, and production provider delivery are **not** implemented and are **not**
claimed.

## Status

**GO — P1-15 Shared Services Backend Gate Passed.** Recorded from the protected post-merge state
`026a8da` after PR #60/#61/#62/#63 were owner-merged and the protected state was re-verified. The
Pending record this decision was made against is preserved byte-verbatim in §8. Phase 1-16 may begin
once this record is merged into protected history.
