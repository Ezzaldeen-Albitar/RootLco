# Phase 1-14 — Precondition Report

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-22 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).

> **Authority.** Phase scope and sequencing are governed by the canonical documents recorded in
> [canonical-documents.md](../../governance/canonical-documents.md), which live outside this
> repository by owner decision. This report records what was **verified in the repository and
> the database** before Phase 1-14 work began. Where a canonical identifier is cited, it is
> cited as a reference, not reproduced.

---

## 1. What this report establishes

Phase 1-14 (Authentication, Authorization, and Administration Backend) may only start from a
protected baseline that actually contains Phase 1-13. This report records the verification
performed on 2026-07-22, before any Phase 1-14 branch, migration or endpoint was created.

It also records the one finding that changed the phase's shape: a measured, blocking database
capability gap, raised as
[DBCR-P1-14-001](../../database/change-requests/DBCR-P1-14-001-runtime-administration-write-capabilities.md).

## 2. Protected history

| Fact                         | Verified value                                                     |
| ---------------------------- | ------------------------------------------------------------------ |
| `origin/develop`             | `8c8e0fa5a4093781c98ed9c2a40ebee5a7f7a74b`                         |
| `origin/main`                | `8aebbe8f4e304f8c5d7c9b6c9a418160a5e317e0`                         |
| `develop` ahead of `main`    | 0 commits                                                          |
| Root tree, both branches     | `bfe5fb8d9b3d374eeda36baa99df1fe6458967c9` — byte-identical        |
| Working tree at verification | Clean; no merge, rebase, cherry-pick, revert or bisect in progress |

**P1-13 containment.** All eight P1-13 commits are ancestors of both protected branches:
feature `cf85615` + merge `6c3f0de`; remediation `af240f0` + merge `e615a02`; gate `fecb880` +
merge `6b9c904`; hardening `d997407` + merge `8c8e0fa`. The owner promotion merge `8aebbe8` is
contained in `main` only, which is correct — it is the promotion node itself.

**Canonical gate.** `docs/phase-1/phase-1-13/phase-1-13-owner-gate.md` on `origin/develop`
reads, verbatim:

```text
## Decision: Go — P1-13 Backend Foundation Gate Passed
```

## 3. Phase 1-14 had not started

| Check                                | Result                                                 |
| ------------------------------------ | ------------------------------------------------------ |
| Branch matching `*p1-14*` / `*1_14*` | None, local or remote                                  |
| Pull request for P1-14               | None                                                   |
| Migration for P1-14                  | None — 114 migrations, latest `20260725090000` (P1-13) |
| API routes in the tree               | Exactly two: `/api/health`, `/api/v1/meta/ping`        |
| `docs/phase-1/phase-1-14/`           | Did not exist                                          |

Business tables are empty, as the no-fake-data policy requires: `iam.user_accounts` 0,
`iam.roles` 0, `iam.role_grants` 0, `iam.user_sessions` 0, `org.tenants` 0,
`org.legal_companies` 0, `iam.audit_records` 0.

## 4. Authentication provider — no conflicting canonical decision

Every ADR (`ADR-001` … `ADR-018`) and `docs/adr/README.md` were inspected. **No ADR decides the
authentication or session provider.** The decision is tracked as an open item —
`AUTH-PROVIDER` in
[`phase-1-13-open-decisions.md`](../phase-1-13/phase-1-13-open-decisions.md) — whose stated
reason is _"Phase 1-14 owns authentication and its provider decision."_

**Nothing forbids Supabase Auth.** `ADR-003` is the only ADR touching authentication technology
and it is supportive: it names Supabase as _"the platform layer around PostgreSQL, providing
authentication…"_, and explicitly **rejects** both hand-built authentication (_"a
disproportionate risk to carry"_) and a hand-rolled GoTrue container stack.

Two constraints apply and are binding on the P1-14 design:

1. **The claims contract is already frozen.** `src/server/context/principal.ts` fixes
   `PrincipalClaims` to `identityProvider`, `providerSubject`, `tenantId` and nothing else.
   Everything further — internal user id, companies, branches — is resolved from the database.
   The claimed tenant is a lookup key, never trusted.
2. **No credential material may be stored.** `identity-authorization-schema-design.md`:
   _"Credentials remain with the external identity provider; no password, hash, MFA secret, or
   token is stored anywhere."_ The `service_role` key bypasses RLS and must never reach the
   request path or the browser.

The provider decision is therefore recordable as a new ADR under the Standing Technical
Authorization. The next unused number is **ADR-019**.

## 5. Database contract inventory

Read from the live protected schema, not from planning prose.

- **17 `iam` tables**, all `ENABLE` **and** `FORCE ROW LEVEL SECURITY`.
- **43 seeded permission codes**, including every code P1-14 needs: `iam.user.read`,
  `iam.user.manage`, `iam.role.read`, `iam.role.manage`, `iam.grant.manage`,
  `iam.approval.manage`, `iam.audit.view`, `iam.session.view_all`, `iam.login.view_all`,
  `iam.sensitive.view`, `org.settings.manage`.
- **Lifecycle function** `iam.change_user_status(uuid, text, text, uuid)` — SECURITY INVOKER,
  empty `search_path`, validates the transition graph (`invited → active|archived`,
  `active → locked|archived`, `locked → active|archived`, archived terminal), requires a
  non-blank reason and a session actor, and writes the history row in the same statement.
- **Immutability triggers** (`org.guard_immutable_columns`) already freeze the dangerous
  columns: `user_accounts` (tenant, identity_provider, provider_subject), `role_grants`
  (tenant, user, role, granted_by, scope_mode, valid_from), `roles` (tenant, role_code,
  is_system), `role_permissions` (tenant, role, permission), `approval_limits` (amount,
  currency, subject), `user_sessions` (tenant, user, session_ref, issued_at), `org.tenants`
  (tenant_code). Identity re-pointing, grant re-targeting and system-role promotion are
  therefore already impossible.
- **`shared.touch_row_metadata`** increments `record_version` on every UPDATE, so optimistic
  concurrency is already wired.
- **`iam.has_permission`** returns false unless the account is `active` and not deleted — so a
  locked or archived user loses every permission automatically, at the database layer.
- **`iam.stamp_user_status_history`** overwrites `actor_id` with `iam.current_user_id()` and
  rejects a null actor, so history authorship cannot be forged.

## 6. Finding — DBCR-P1-14-001 (BLOCKING)

The phase exposed one genuine missing database capability, measured executably as
`rootlco_test_runtime`: **22 of 24 required writes are refused with SQLSTATE 42501**, and the
thirteen administration tables carry **no write RLS policy at all**. Both the privilege layer
and the policy layer must be addressed.

Full evidence, classification and approved remediation:
[DBCR-P1-14-001](../../database/change-requests/DBCR-P1-14-001-runtime-administration-write-capabilities.md).

Per the phase's database rule, no unapproved migration was implemented silently: the change
request was raised, classified **BLOCKING for Waves 3–8**, and its remediation is delivered as
a **separate pull request** — the governance path already used for DBCR-P1-13-001 (PR #51).
The Phase 1-14 owner gate remains **Pending**.

## 7. Documentation corrections identified for the feature phase

Recorded here so they are not silently carried. None is caused by this remediation; all
predate it, and each is stated as a fact to be corrected, not as work already done.

| Ref  | Finding                                                                                                                                                                                                                                                                                                                                                                                       | Disposition                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| PC-1 | `platform.meta.ping` is required by `/api/v1/meta/ping` and by `docs/api/openapi.v1.json`, but **is not present** in `iam.permissions` or in the permission-catalog reference.                                                                                                                                                                                                                | Open — feature phase                                                         |
| PC-2 | `docs/database/permission-catalog-reference.md` lists 19 codes; `supabase/seeds/04_iam_permission_catalog.sql` contains 43. The reference is stale.                                                                                                                                                                                                                                           | Open — feature phase                                                         |
| PC-3 | No audit-action catalog exists. `auditAction` is a free-form string validated only for presence; the only example anywhere is `iam.role.granted`.                                                                                                                                                                                                                                             | Open — feature phase                                                         |
| PC-4 | The event names `identity.user.invited.v1`, `identity.access-grant.changed.v1`, `identity.session.revoked.v1` are **not registered**, and the `.v1` suffix contradicts the catalog rule that the version is a separate integer, never part of the wire name. `access.grant.changed` (**EVT-IAM-001**, aggregate `iam.role_grant`, owner module `iam`) already reserves the grant-change fact. | Open — feature phase; the registered names and the catalog convention govern |

## 8. Scope boundaries confirmed at phase start

**In scope for the remediation pull request this report accompanies:** DBCR-P1-14-001, its
migration, its tests, its classification, and this report.

**Not started, and not touched by it:** the provider adapter, session authentication, login,
logout, password reset, invitations, activation, failed-login handling, lock, idle timeout,
role/permission/scope/approval-limit administration, user and organization administration,
audit viewing, the API surface, OpenAPI registration, and every P1-14 document other than those
listed above.

**Out of scope for the phase entirely:** frontend work of any kind, P1-15 or later domains,
Zoom, social login, MFA, SSO/SAML/SCIM, subscription billing, production infrastructure,
general ledger, procurement, product-name finalization, and any Benzene-specific
authorization — Benzene remains a configurable tenant, never a code branch.

## 9. Governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The
work was reviewed under the Standing Technical Authorization and Solo Developer Review
policies.
