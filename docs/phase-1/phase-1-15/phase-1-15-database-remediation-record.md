# Phase 1-15 — Database remediation record (DBCR-P1-15-001)

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Scope of this record:** the **database capability remediation only**. It does **not** complete the
P1-15 Shared Services Backend. ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. What this delivers, and what it does not

**Delivers:** the minimum safe database capabilities the P1-15 shared services will need — migration
117, two permission codes, and 51 executable proofs.

**Does not deliver:** any P1-15 application code. The shared-services feature branch
`feature/p1-15-shared-services-backend` remains **parked** at `c83b680`. No provider integration, no
malware scanner, no production deployment, and no P1-16 work exists. The **P1-15 owner gate remains
Pending** and is not touched by this change.

## 2. Protected starting state

| Item                  | Value                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------- |
| `origin/develop`      | `c7edc512657077ab31cc98e7b748b4bf90af06d5`                                             |
| `origin/main`         | `8ca1da257fc89585f2bb45459e435ec124b8a5a7`                                             |
| Remediation branch    | `fix/p1-15-shared-services-runtime-write-capabilities`, branched from `origin/develop` |
| Parked feature branch | `feature/p1-15-shared-services-backend` @ `c83b680` — untouched                        |

## 3. The blocker, proven executably

Run as **`rootlco_test_runtime`** (member of `app_runtime`, `rolsuper=false`, `rolbypassrls=false`).
Nothing was concluded from `postgres`, which carries `BYPASSRLS` and proves nothing about runtime
behaviour. Ten mandatory write targets each failed with **SQLSTATE 42501** before any constraint,
trigger, or policy was reached — and the block was doubled, because RLS is `FORCE`d and no
`INSERT`/`UPDATE`/`DELETE` policy existed for the runtime role on any of them.

## 4. Two corrections to the initial reading

Recorded rather than quietly edited away, because they are the reason the remediation was designed
from a per-table actor decision instead of granting everything the first probe reported as denied.

1. **`shared.error_records` and `shared.processed_events` were never gaps.** The first probe queried
   `app_runtime` only. `app_worker` already holds the correct capability on both, with the
   established cross-tenant `wkr_*_all` policies. **Neither table changes.**
2. **The real inverse gap was `shared.delivery_attempts`**, where `app_worker` held nothing at all, so
   the worker could not record provider delivery evidence. That capability belongs to the worker
   precisely so ordinary request code can never forge a delivery result.

A second gap was also found: the permission catalog contained **no shared-service codes at all**, so a
permission-gated write policy had nothing to reference.

## 5. Finding P1-15-R-001 — High — found, fixed, regression-tested

| Field                | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ID**               | P1-15-R-001                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Severity**         | High (availability / correctness: the primary enqueue path was impossible)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Found by**         | The migration-117 capability suite, during this remediation                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Reproduction**     | As `app_runtime` with tenant context, `INSERT INTO shared.outbound_messages (... template_version_id = <a platform template version> ...)` → `ERROR: template version <id> does not exist` (SQLSTATE `23503`)                                                                                                                                                                                                                                                                                          |
| **Root cause**       | `shared.guard_outbound_message_scope` resolves the referenced template with `SELECT ... FROM shared.template_versions WHERE id = ... FOR SHARE`. Under RLS a **locking** read must additionally satisfy an UPDATE policy. With only the tenant-scoped `upd_template_versions_tenant` present, the lock admitted no row for a platform template (`tenant_id IS NULL`), and none at all for a sender not also holding `org.settings.manage`. This is the same mechanism as Phase 1-14 finding **R-011**. |
| **Failure path**     | Platform templates exist to be usable by every tenant. Without a lockable row, enqueueing against one was impossible for all tenants — the entire reason platform templates exist.                                                                                                                                                                                                                                                                                                                     |
| **Fix**              | Added `lck_template_versions_reference`: `FOR UPDATE TO app_runtime USING (tenant_id IS NULL OR tenant_id = iam.current_tenant_id()) WITH CHECK (false)`. It admits the row for **locking only**. It can never permit a write: permissive policies OR their `WITH CHECK`, this one contributes `false`, and the only other check demands tenant ownership — which a platform row cannot acquire because `tenant_id` is deliberately absent from the UPDATE column grant.                               |
| **Regression tests** | `the lock policy cannot be used to mutate a DRAFT platform version` (isolates the policy layer from the lifecycle guard and proves an explicit `42501` RLS refusal), `a platform template version cannot be re-tenanted into the caller tenant`, `an approved platform version is immutable — the lifecycle guard refuses`, plus the enqueue tests that now pass.                                                                                                                                      |
| **Disposition**      | **Fixed inside the unmerged migration 117.** No migration 118 was required.                                                                                                                                                                                                                                                                                                                                                                                                                            |

## 6. Executable proof totals

`tests/db/p1-15-shared-services-runtime-capabilities.test.ts` — **51 proofs, all green**, executed on
real non-owner login wrappers. The admin pool provisions fixtures only and is never treated as
evidence about runtime behaviour.

| Group                    | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global posture           | migration count 117; ENABLE + FORCE RLS on all 8 affected relations; no application role is superuser, `BYPASSRLS`, or `LOGIN`; application roles own zero relations/schemas/functions; `app_readonly` holds only SELECT; no `TRUNCATE`/`REFERENCES`/`TRIGGER`; 0 `SECURITY DEFINER`; exact whole-schema write-policy inventory; no bare `true` predicate on any request-role write policy; both new permission codes present exactly once; catalog totals 45 |
| Documents                | authorized create succeeds; missing permission, cross-tenant, forged authorship and no-context all denied; no UPDATE privilege at all; DELETE denied                                                                                                                                                                                                                                                                                                          |
| Versions + scan boundary | pre-acceptance version created as `pending`; cross-tenant version denied; **no role may write `file_scan_results`** (runtime, worker and readonly each proven); **acceptance refused because no clean scan exists**; `guard_document_version_transition` still installed; `pending → rejected` permitted                                                                                                                                                      |
| Notifications            | authorized enqueue succeeds as `pending`; missing `shared.notification.send` denied; request runtime cannot forge a delivered status; request runtime cannot write delivery attempts; worker records an attempt and advances the lifecycle; delivery attempts are append-only                                                                                                                                                                                 |
| Templates                | authorized tenant template created; platform template creation, mutation and platform version insert all denied; missing `org.settings.manage` denied; the lock-policy adversarial regressions above; `scope`/`tenant_id` proven non-updatable                                                                                                                                                                                                                |
| Search projection        | worker creates a projection; request runtime cannot insert or update one; identity columns excluded from the worker UPDATE grant                                                                                                                                                                                                                                                                                                                              |
| Withheld relations       | request runtime and worker both refused on `status_history` and `status_evidence`; no application role holds any write privilege on either; worker `error_records`/`processed_events` contracts unchanged; request runtime still refused on both; `app_readonly` refused on all seven shared-services relations                                                                                                                                               |

## 7. Adversarial review

Executed directly as the runtime role with tenant context, each inside a rolled-back transaction.
All refused:

| Probe                                              | Result                                          |
| -------------------------------------------------- | ----------------------------------------------- |
| Grant self a permission (`iam.permissions` INSERT) | `permission denied for table permissions`       |
| CTE write into `search_metadata`                   | `permission denied`                             |
| CTE write into `delivery_attempts`                 | `permission denied`                             |
| Manufacture a `clean` scan verdict via CTE         | `permission denied for table file_scan_results` |
| `SET ROLE app_worker` escape                       | `permission denied to set role "app_worker"`    |
| `status_history` via `INSERT ... SELECT`           | `permission denied`                             |
| Write trigger-owned `updated_by` on a template     | `permission denied for table message_templates` |

The last one is the Phase 1-14 R-007/R-010 lesson working as intended: a column excluded from the
grant makes the statement fail at the privilege layer before any row is touched.

## 8. Validation

| Check                                                                                                              | Result                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `test:db` (full database suite)                                                                                    | **1320 passed / 123 files**, exit 0     |
| `test` (unit + foundation)                                                                                         | **369 passed / 25 files**, exit 0       |
| `test:backend`                                                                                                     | **159 passed / 12 files**, exit 0       |
| `typecheck`, `lint`, `format:check`, `style:check`                                                                 | exit 0                                  |
| `validate:module-boundaries`, `validate:authorization-coverage`, `validate:operation-coverage`, `validate:openapi` | exit 0                                  |
| `security:browser-secrets`, `security:scope-exclusions`, `security:tracked-secrets`, `validate:no-fake-data`       | exit 0                                  |
| `build` (production)                                                                                               | exit 0                                  |
| `docker compose config`                                                                                            | exit 0                                  |
| `validate:seed-state`                                                                                              | exit 0 **on a fresh database** — see §9 |

## 9. Two honestly-recorded local limitations

Neither is caused by migration 117, and neither affects hosted CI.

1. **`validate:seed-state` fails if run _after_ the full database suite.** The failure is
   `Retention classes do not match the five governed values`: an existing suite mutates
   `shared.retention_classes.min_retention_days` and does not restore it. On a fresh
   `supabase db reset` the gate passes with
   _"7 declared files applied twice; five exact retention classes; every business table empty; counts
   idempotent."_ The exact mutating test is `tests/db/shared-retention.test.ts:59`. CI runs the seed
   assertion at `ci.yml` line 242, immediately after `db:apply-migrations` (line 239) and **before**
   `test:db` (line 290), so CI is unaffected. This is **pre-existing test pollution**, recorded here
   rather than hidden, and is not a P1-15 defect.
2. **`validate:canonical-docs` fails locally** because it verifies the canonical Word documents that
   live **outside** the repository by owner decision. It fails identically on the untouched baseline
   and is **not part of the CI pipeline**. Environmental, pre-existing.

## 10. Database-suite intermittency (R-5)

Carried from Phase 1-14: **Low, undiagnosed, not resolved.** The database suite ran green here
(1320/1320) across repeated executions, but a green run does not identify a cause and does not close
the risk. It stays open.

## 11. Findings summary

**Critical: 0 · High: 0 unresolved** (P1-15-R-001 found and fixed with committed regression tests) ·
**Medium: 0.**

Accepted Low / residual:

- **R-5** — database-suite intermittency, Low, undiagnosed, carried open.
- **R-3** — no dependency-vulnerability scanning. Not implemented, not claimed.
- **Local `validate:seed-state` ordering sensitivity** (§9.1) — pre-existing test pollution.
- **Local `validate:canonical-docs`** (§9.2) — external-document dependency, not in CI.
- **Document acceptance is unavailable** — no scanner exists, so no version can reach `accepted`.
  Explicit follow-on, not a defect of this change.
- **Generic shared status history remains unwritable** — P1-15's transition service must compose the
  module-owned, coherence-guarded history tables. Making the generic table safely writable needs an
  `entity_type` allow-list and an aggregate binding, which is a schema change and a separate decision.

## 12. Open decisions carried forward

`P1-OD-027` (NFR-SCL baselines), `AUTH-SESSION-TRANSPORT`, `IAM-SELF-ONBOARDING`,
`IAM-BASELINE-PERMISSION` — all unresolved and untouched by this change.

## 13. Governance

Nothing reached protected `develop` outside the approved pull-request and hosted-CI flow. The work was
reviewed under the Standing Technical Authorization and Solo Developer Review policies. This is
owner-authorized technical self-review and is **never** represented as an independent third-party
audit. No production behaviour, availability, or deployment is claimed.
