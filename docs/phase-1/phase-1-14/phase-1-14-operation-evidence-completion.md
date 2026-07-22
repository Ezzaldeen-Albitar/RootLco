# Phase 1-14 — Operation-Evidence Completion

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-22 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).

> This is the owner reviewing the owner's own work. It is **not** an independent third-party audit,
> a penetration test, or a security certification, and nothing here should be read as one.

---

## 1. What this record completes

The prior remediation ([grant-scope + operation evidence](phase-1-14-grant-scope-remediation.md),
merged into protected `develop` as PR #56 → `63916b8`) fixed the confirmed-High scope-containment
bypass and gave the security-critical grant/scope/approval surface genuine operation-depth evidence.
It left two **tracked** residuals open:

- **R-8** — the five `/auth/*` operations and the three invitation operations had unit-depth evidence
  only, not wired-service integration.
- **R-9** — thirteen administrative **write** operations (role/permission/user/settings writes,
  approval-limit end, invitation create/cancel) remained `pending` operation-depth evidence.

This record closes **both**. Every one of the **39** registered operations now has genuine
operation-depth acceptance evidence — the wired application service invoked end to end on the deployed
`app_runtime` identity, through RLS, the transaction wrapper, the request context, the runtime DB
role, and the audit / outbox / idempotency path where applicable. The coverage gate is rewritten to
**FAIL** on anything less, and a negative fixture proves it fails.

This branch composes the P1-13 foundation and the P1-14 feature. It adds **no** migration and changes
**no** existing migration; migration count stays at **116**. All fixes are application-code and test
additions.

## 2. Four latent runtime defects the operation evidence uncovered

Writing evidence that actually invokes each operation on the real runtime role immediately surfaced
defects the merged feature never exercised — which is the entire point of operation-depth evidence.
All four are **application-code** defects on protected `develop`; none requires a schema change.

| ID              | Severity | Operation(s) affected                                                | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | -------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-14-R-008** | High     | `iam.auth-login`, `iam.invitation-create`, all account-by-email      | `findByEmail` / `insertAccount` cast the email parameter to `::citext`, but the `citext` **type name** lives in the `extensions` schema, which is absent from the `app_runtime` `search_path` (no USAGE). At runtime every such statement raised _"type citext does not exist"_ — login and invitation were non-functional.                                                                                                                                                                   | Drop the explicit `::citext` cast; the `citext` **column** already compares case-insensitively against a `text` parameter. `identity-repository.ts`.                                                                                                                                                                                                                                                                               |
| **P1-14-R-009** | High     | `iam.auth-login`                                                     | `insertSession` wrote `user_id = db.context.principal.userId`, but login runs under a bootstrap context whose principal is the **tenant** (no user exists yet); the resolved account id is set on `app.user_id` only afterwards. `ins_user_sessions_self` (`user_id = iam.current_user_id()`) then rejected the row — login could never open a session.                                                                                                                                       | Add an explicit `userId` parameter to `insertSession`; pass `account.id`. `identity-repository.ts`, `authentication-service.ts`.                                                                                                                                                                                                                                                                                                   |
| **P1-14-R-010** | High     | `iam.role-update`, `iam.user-update`, `iam.tenant-settings-update`   | Three UPDATE statements still set `updated_by` explicitly. `app_runtime` holds column UPDATE only on the grantable business columns; `updated_by` is trigger-stamped (`shared.touch_row_metadata`). Naming it raised `42501` before any row was touched. The earlier P1-14-R-007 sweep fixed the session / role-permission / grant / approval-limit methods but **missed these three**.                                                                                                       | Remove the redundant `updated_by` set (the trigger stamps it). `identity-repository.ts`, `authorization-repository.ts`, `organization-repository.ts`.                                                                                                                                                                                                                                                                              |
| **P1-14-R-011** | High     | `iam.user-status-change` (and any last-holder-guarded status change) | `countOtherHoldersOf` used `FOR UPDATE OF g`. Under RLS a locking read must also satisfy the target table's **UPDATE** policy, and `upd_role_grants_admin` requires `iam.grant.manage`. A `user.manage`-only administrator (who does not hold `grant.manage`) therefore had every other holder's grant row silently dropped from the count, the last-holder guard under-counted to zero, and **every** lock/archive was refused with a false _"this would leave the tenant unadministrable"_. | Remove `FOR UPDATE OF g`; the last-holder count is a **read** and must not require update authority over other administrators' grants. The guard is defence-in-depth for an availability invariant (ADR-008 lets an owner/operator restore administrability), so the negligible concurrent-double-revocation window a snapshot read leaves is an acceptable trade for a guard that actually counts. `authorization-repository.ts`. |

Each fix is proven by the operation-depth test that discovered it: R-008/R-009 by the login success
path in `iam-auth-provider.test.ts`; R-010 by the success paths of role/user/tenant update in
`iam-admin-writes.test.ts`; R-011 by the `iam.user-status-change` lock path (which revokes the live
session, audits, and publishes exactly one event) in the same file.

## 3. The evidence added

| Layer                                       | File                                                                                            | Count | What it proves                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider-fake auth + invitation integration | `tests/backend/iam-auth-provider.test.ts`                                                       | 31    | Real `AuthenticationService` + `InvitationService` on a deterministic `FakeIdentityProvider` (ADR-019: CI needs no provider credentials/network). Login success + every generic-failure branch; logout idempotency; session read; password-reset request/silence/allow-list; reset completion + single-use; invite/cancel/activate with audit, outbox, cross-tenant, and address redaction. |
| Administrative write operations             | `tests/backend/iam-admin-writes.test.ts`                                                        | 30    | The R-9 write surface end to end: success + permission-denial (RLS) + cross-tenant + scope isolation + stale-version + audit + atomic outbox + idempotency, per operation as applicable.                                                                                                                                                                                                    |
| Strict coverage gate + negative fixture     | `scripts/check-operation-test-coverage.mjs`, `tests/foundation/operation-coverage-gate.test.ts` | 9     | The gate fails on a missing required flag, a declared-but-uninvoked operation, an unreadable file, an unmapped registered operation, and a stale manifest entry — and passes on the real manifest.                                                                                                                                                                                          |

Grant-scope evidence from the prior remediation is preserved and re-run unchanged
(`tests/db/p1-14-grant-scope-containment.test.ts`, `tests/backend/iam-access-administration.test.ts`).

## 4. The strict operation-coverage gate

`scripts/check-operation-test-coverage.mjs` (`npm run validate:operation-coverage`, wired into CI at
`.github/workflows/ci.yml`) now reconciles **every** registered operation against a manifest that
records, per operation, the test file that invokes it and the **required** evidence kinds. It **fails**
when:

1. a registered operation is absent from the manifest;
2. a manifest entry names a file that does not reference the operation id **outside** its own
   `COVERAGE-EVIDENCE` declaration block (declared-but-never-invoked);
3. an operation declares required evidence (permission-denial, cross-tenant, company/branch isolation,
   audit assertion, idempotency, stale-version, atomic outbox) its test file does not provide;
4. a manifest entry names an operation that is no longer registered;
5. any operation is `pending` — the state no longer exists.

There is no `pending` and no `unit` depth any more. The only passing state is **0 pending, 0
unreferenced, 0 metadata-only**.

Current coverage of the **39** registered operations:

| Category                           | Count | Meaning                                                                                     |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------- |
| Operation-depth, required evidence | 24    | Write / auth / invitation operations, each proving its declared denial/isolation/audit/etc. |
| Operation-depth, invocation-only   | 15    | Read and catalogue operations (list/detail/read), invoked under runtime context + RLS       |
| `pending`                          | **0** | —                                                                                           |
| `unit`-only                        | **0** | —                                                                                           |

The per-operation matrix is written to
[`evidence/operation-test-matrix.json`](evidence/operation-test-matrix.json). The evidence flags are
review-anchored: they sit beside the assertions that back them, the gate confirms the operation is
also invoked, and the negative fixture proves the gate rejects an incomplete claim.

## 5. Residual risks

| ID  | Risk                                                        | Disposition                                                                                                             |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| R-8 | Wired auth/invitation integration                           | **CLOSED** — provider-fake harness (`iam-auth-provider.test.ts`), 8 operations at operation depth.                      |
| R-9 | 13 pending write operations                                 | **CLOSED** — admin-writes harness (`iam-admin-writes.test.ts`) + gate at 0 pending.                                     |
| R-5 | Database-suite intermittency carried from the feature phase | **Unchanged — Low, undiagnosed, not resolved.** Re-run recorded in the validation evidence; not addressed by this work. |
| R-3 | No dependency-vulnerability scanning                        | Unchanged; still not implemented and not claimed.                                                                       |

## 6. Governance

Nothing reached protected `develop` or `main` outside the approved pull-request and hosted-CI flow.
This branch is built off the merged protected `develop` (`63916b8`) and is offered as a **new** pull
request targeting `develop`; the implementer never merges it. The Phase 1-14 owner gate remains
**Pending** — this record does not convert it to Go. The four latent defects in §2 are real and are
fixed here additively; they are recorded rather than quietly folded in.
