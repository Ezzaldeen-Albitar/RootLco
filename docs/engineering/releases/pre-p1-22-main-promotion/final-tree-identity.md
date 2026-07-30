# Final tree identity and containment

## The SHAs

| Name                       | Value                                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `MAIN_BEFORE_SHA`          | `491c4e0882763b5d5864737e63b4e31ca708a6b5`                        |
| `PROMOTED_DEVELOP_SHA`     | `d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de`                        |
| `PROMOTED_DEVELOP_TREE`    | `13c1280e73c506b103380f853a130ef29ea13e3d`                        |
| `MAIN_PROMOTION_MERGE_SHA` | `9c2fea162e5a270c740bac8db3546ed695a6f58a`                        |
| `MAIN_PROMOTION_PARENT_1`  | `491c4e0882763b5d5864737e63b4e31ca708a6b5` ✅ previous `main`     |
| `MAIN_PROMOTION_PARENT_2`  | `d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de` ✅ `FINAL_DEVELOP_SHA` |
| `MAIN_AFTER_TREE`          | `13c1280e73c506b103380f853a130ef29ea13e3d`                        |

## §16 — Preferred case, achieved exactly

```
MAIN_AFTER_TREE       = 13c1280e73c506b103380f853a130ef29ea13e3d
PROMOTED_DEVELOP_TREE = 13c1280e73c506b103380f853a130ef29ea13e3d
```

**Byte-identical.** No controlled documentation-only exception was needed — the
promotion carries the reviewed tree and nothing else.

| Diff                                                                                                     | Files |
| -------------------------------------------------------------------------------------------------------- | ----- |
| Full-tree `main` vs `develop`                                                                            | **0** |
| Executable paths (`src`, `tests`, `scripts`, `.github`, `package.json`, `package-lock.json`, `supabase`) | **0** |

**Zero drift.** No file was introduced, altered or lost during promotion.

The outcome was known before the pull request existed:
`git merge-tree --write-tree origin/main origin/develop` returned this exact tree
with exit 0 — conflict-free — while `main` was still `491c4e0`.

## §17 — Literal containment

```
git merge-base --is-ancestor d9a2c1d origin/main   →  exit 0
```

| Approved work                       | Merge     | In `main` |
| ----------------------------------- | --------- | --------- |
| P1-21 inventory feature (#87)       | `28df255` | ✅        |
| P1-21 gate (#88)                    | `0f8268e` | ✅        |
| Comprehensive CI/CD feature (#89)   | `3ec66c9` | ✅        |
| Comprehensive CI/CD gate (#90)      | `44ae31d` | ✅        |
| CodeQL self-introduced alerts (#91) | `4cb0bbb` | ✅        |
| CodeQL remediation (#92)            | `e83c6b6` | ✅        |
| CodeQL dataflow elimination (#93)   | `4683357` | ✅        |
| CodeQL gate record (#94)            | `d9a2c1d` | ✅        |
| P1-14 replay evidence (cherry-pick) | `b32024c` | ✅        |

Every `gate/*` branch head — P1-16, P1-17, P1-18, P1-19, P1-20, P1-21,
CI/CD platform, CodeQL remediation — is contained in `main`.

**No relevant approved SHA remains only on `develop`.**

## §19 — Synchronisation

| Measure                                     | `main` | `develop` | Equal        |
| ------------------------------------------- | ------ | --------- | ------------ |
| Migrations                                  | 119    | 119       | ✅           |
| Migration `120`                             | absent | absent    | ✅           |
| `docs/api/openapi.v1.json`                  | —      | —         | ✅ same blob |
| `package-lock.json`                         | —      | —         | ✅ same blob |
| `.github/ci-baselines/schema-baseline.json` | —      | —         | ✅ same blob |

Schema hash `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`,
unchanged.

`main` and `develop` necessarily carry **different commit SHAs** — a merge commit
on `main` is a new object — and that is the expected steady state. Tree identity
and ancestry are the guarantees, and both hold. No back-merge of `main` into
`develop` was performed to cosmetically equalise SHAs.

## P1-22 exclusion

The branch `feature/p1-22-billing-payment-delivery-warranty-backend` was created
from `d9a2c1d` and carries **0 commits and 0 changed files**; it has no remote
ref. It could not contaminate the promotion, and the promotion could not disturb
it.

Two `p1-22` string hits exist on `main`, both in
`supabase/migrations/20260724090000_salwtyrpt_schemas.sql`, and both are P1-11
schema comments **stating that no P1-22 backend is created**:

```
--   * No P1-22/P1-23 backend, P1-30/P1-31 frontend, or general-ledger table is created.
… Database-only; no backend (P1-22) or frontend (P1-30/1-31).
```

One filename hit,
`docs/phase-1/phase-1-11/phase-1-11-p1-22-backend-contract.md`, is a forward data
contract added by `1554219` — the P1-11 database phase. Forward-contract
documentation is not implementation.

**No P1-22 route, module, service, test or migration exists on `main` or
`develop`.**

## Deployment

None. `deploy-production.yml` and `deploy-staging.yml` are `workflow_dispatch`
only, with no push or tag trigger, and both require an explicit image digest as
input. No tag was created. `DEPLOYMENT_TRIGGERED = false`.
