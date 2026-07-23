# Phase 1-15 — Protected remediation verification (Waves 1–3)

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. Purpose

This record verifies, from protected evidence, that the database remediation
[DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md)
was merged correctly and that the capability boundary it establishes actually holds on protected
`develop`. The P1-15 feature implementation resumes only on top of this proven boundary.

## 2. Wave 1 — PR #60 protected merge

| Item                   | Verified value                                                                |
| ---------------------- | ----------------------------------------------------------------------------- |
| Merge commit           | **`e50d501398f1ac08aaef2c1d8f7b324f50a4d911`**                                |
| Parents                | `c7edc51` (previous protected develop) + `d39f576` (reviewed remediation tip) |
| Merge method           | Merge commit                                                                  |
| Merge actor            | Ezzaldeen Albitar (committer GitHub)                                          |
| Merge timestamp        | 2026-07-23 08:03:34 +03:00                                                    |
| `origin/develop`       | `e50d501`                                                                     |
| `origin/main`          | `8ca1da2` — untouched by this phase                                           |
| Reviewed SHA contained | `d39f576` **contained** in protected `develop`                                |
| Merged tree            | **`b0d7a68`** — byte-equivalent to the reviewed PR #60 tree                   |
| Post-merge develop CI  | **CI #149 on `e50d501` — completed successfully**                             |

**No protected-branch bypass.** `develop`'s first-parent history remains a chain of reviewed pull-request
merges (#60, #59, #58, #56, #55, #54). Migrations **1–116 are unchanged**; the only migration change
versus the pre-merge baseline is the addition of migration 117, which exists **exactly once**.

## 3. Wave 2 — DBCR-P1-15-001 re-proven on protected `develop`

Executed against a database rebuilt **from empty** through all 117 protected migrations, with seeds
applied twice. Capability assertions run on the real non-owner logins
(`rootlco_test_runtime` / `rootlco_test_worker` / `rootlco_test_readonly`, all `NOBYPASSRLS`,
non-super); the admin connection only provisions fixtures.

| Check                                      | Result                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Empty rebuild through 117 migrations       | exit 0                                                                                                                        |
| Seeds applied twice, idempotency validated | `OK seed state: 7 declared files applied twice; five exact retention classes; every business table empty; counts idempotent.` |
| Migrations                                 | **117**                                                                                                                       |
| Tables / functions / policies / triggers   | **242 / 212 / 629 / 541**                                                                                                     |
| Permission codes                           | **45**, including `shared.document.manage` and `shared.notification.send`                                                     |
| `SECURITY DEFINER`                         | **0**                                                                                                                         |
| Application roles with `BYPASSRLS`         | **0**                                                                                                                         |
| Relations owned by an application role     | **0**                                                                                                                         |
| Dedicated migration-117 capability suite   | **51 / 51 passed**                                                                                                            |
| Full database suite                        | **1320 passed / 123 files**                                                                                                   |

The 51 proofs re-confirm on protected `develop` that: the exact request-runtime and worker grants are
present; cross-tenant writes are denied; **no role can write `shared.file_scan_results`** and therefore
no scan verdict can be fabricated; the generic `shared.status_history` / `shared.status_evidence`
tables remain unwritable by every application role; platform templates cannot be created or mutated by
tenant runtime; request runtime cannot forge a delivery attempt, a delivered status, or a search
projection; and the worker-only `error_records` / `processed_events` contracts are unchanged.

**DBCR-P1-15-001 is therefore Resolved**, on protected executable evidence rather than on the
pre-merge branch.

## 4. Wave 3 — Parked feature branch resumed

`feature/p1-15-shared-services-backend` was still **unpushed and clean**, so it was **rebased** onto
protected `develop` — the safest evidence-preserving option, and it avoids a merge commit on an
unpublished branch.

| Item                            | Value                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------- |
| Pre-rebase head                 | `c83b680` (Wave 0 audit + Pending owner gate)                                 |
| Post-rebase head                | **`4d964c5`**, applied directly onto `e50d501`                                |
| Migrations on the branch        | **117** — migration 117 arrives through protected history, **not duplicated** |
| Diff versus protected `develop` | exactly the two Wave 0 records                                                |
| Owner gate                      | **Pending** — unchanged                                                       |
| P1-16                           | no branch, path, or implementation exists                                     |

The Wave 0 records are preserved intact; no remediation migration, permission change, or test was
copied onto the feature branch.

## 5. Status

Waves 1–3 are complete and verified. The P1-15 feature implementation proceeds from here on a proven
database boundary. **The owner gate remains Pending** and is converted only after the feature pull
request is merged and separately verified from protected `develop`.
