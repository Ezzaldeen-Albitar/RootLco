# Phase 1-13 — Precondition Report (Wave 0)

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-13 — Backend Architecture and Shared Application Foundation ·
**Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical owner; owner-authorized self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) —
never an independent third-party audit).

Every value below was read from the repository and the live database on the date shown. Nothing
is carried forward from a previous summary.

---

## 1. Protected-history verification

| Check                                                        | Result                                                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `origin/develop` at phase start                              | `ecbbfe8a419b8cd4794f66ba24d0a2341d015601` — **unchanged** from the recorded P1-12 closure                                  |
| `origin/main` at phase start                                 | `728920cabfc6662074356a2480180cc8e899ead5` — **moved** since P1-12 closure (was `286d48231368a105c762e63da658bbdc54726d16`) |
| Release 2 baseline contained in `origin/develop`             | **Yes** (`git merge-base --is-ancestor` → 0)                                                                                |
| Release 2 baseline contained in `origin/main`                | **Yes** — see §2                                                                                                            |
| `release-2-database-baseline` resolves to                    | `ecbbfe8a419b8cd4794f66ba24d0a2341d015601` — **matches the recorded closure commit**                                        |
| Existing P1-13 branch, commit, PR, or partial implementation | **None.** `git branch -a --list "*p1-13*"` returned nothing on local and remote                                             |
| Working tree at phase start                                  | Clean (`git status --porcelain` empty) — no user work to preserve                                                           |

## 2. Owner-controlled release promotion after P1-12

An owner-controlled `develop → main` promotion **did occur** after the P1-12 closure:

```text
commit  728920cabfc6662074356a2480180cc8e899ead5
merge   286d482 (previous main) + ecbbfe8 (Release 2 closure)
author  Ezzaldeen Albitar · committer GitHub · 2026-07-21T11:32:00+03:00
subject Merge pull request #48 from Ezzaldeen-Albitar/develop
```

`git diff origin/main origin/develop` is **empty**: `main` and `develop` carry identical content.
This promotion is an owner administrator action outside the P1-13 task; P1-13 neither performed
nor modified it, and does not push to either protected branch.

## 3. Feature branch

`feature/p1-13-backend-architecture-shared-foundation`, created **from the freshly fetched
protected `origin/develop`** (`ecbbfe8`), not from a stale local `develop`.

## 4. Canonical plan synchronization

The canonical P1-13 definition lives in the external
`RootLco_Phase_1_Development_Plan_recovered_v01.docx` (Phase 1-13, fields 1–35), verified intact
against its recorded hash by `npm run validate:canonical-docs` (both canonical documents **OK**).
The binding 35-field structure is preserved in
[`phase-1-13-plan.md`](./phase-1-13-plan.md); the additional approved cross-cutting principles
(observability, scalability, caching, load-balancer and CDN readiness, indexing governance,
sharding, replication, rate limiting, queues, consistency model, consistent hashing) are recorded
there as an explicit synchronization block rather than by silently rewriting the canonical fields.

## 5. Frozen database contract — inspected, not inferred

Read from the live Release 2 baseline (PostgreSQL 17, 113 migrations applied):

| Surface              | Verified fact                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context GUCs         | `app.tenant_id`, `app.user_id`, `app.company_ids`, `app.branch_ids` (comma-separated), read by `iam.current_*` / `iam.allowed_*`                                                   |
| Permission functions | `iam.has_permission(text)`, `iam.has_permission_in_scope(text, uuid, uuid, uuid)` — deny precedence implemented in the function bodies                                             |
| Audit                | `iam.audit_append(uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,text,jsonb) → uuid`                                                                                                 |
| Outbox               | `shared.claim_outbox_events(text,int,interval)` using `FOR UPDATE SKIP LOCKED`; `shared.complete_outbox_event`; `shared.fail_outbox_event` with an attempt ceiling → `dead_letter` |
| Idempotency          | `shared.idempotency_keys`, UNIQUE **NULLS NOT DISTINCT** `(tenant_id, operation, idempotency_key)`, `operation ~ '^[a-z][a-z0-9_]{1,62}$'`, key length 8–200                       |
| Consumer idempotency | `shared.processed_events`, PK `(consumer_code, event_id)`, outcome ∈ {applied, skipped, failed}                                                                                    |
| Entitlement          | `org.resolve_feature_enabled(text, timestamptz)` — override → plan → platform default, raising for an unregistered flag                                                            |
| Roles                | `app_runtime`, `app_readonly`, `app_worker` — none with LOGIN, none with BYPASSRLS                                                                                                 |

## 6. Blocking finding raised in Wave 0

**DBCR-P1-13-001** — the `app_runtime` archetype holds **SELECT only** across `shared` (25
tables) and `iam` (17 tables): no INSERT anywhere, no EXECUTE on `iam.audit_append`, and
`shared.idempotency_keys` has RLS enabled and forced with **no policy at all**. Four foundation
write capabilities are therefore unavailable to the request path. There are **0
`SECURITY DEFINER`** functions, so no granted function performs these writes on the caller's
behalf.

Handling, per the phase scope rules: **no migration was added or modified.** The gap is recorded
with executed evidence and a proposed additive remediation in
[`DBCR-P1-13-001`](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md);
the foundation measures the capability at runtime (`src/server/db/capabilities.ts`) and **fails
closed** rather than degrading silently (`src/server/db/require-capability.ts`).

## 7. Scope boundaries confirmed at phase start

No P1-14+ business endpoint, no frontend work, no Zoom functionality, no file upload/download
behaviour, no notification delivery, no external integration, no production infrastructure, no
general ledger, no procurement, no payment gateway, no subscription billing, and **no database
schema or migration change**.

## 8. Conclusion

All preconditions are satisfied. The recorded P1-12 closure is contained in protected
`origin/develop`, the baseline tag resolves to the recorded commit, no prior P1-13 work exists,
and the frozen database contract has been read from the live schema rather than from prose.
Phase 1-13 proceeded from this state.
