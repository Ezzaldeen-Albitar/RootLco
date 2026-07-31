# P1-23 — Promotion Record (develop → main)

**Phase:** P1-23 — Documents, Notifications, and Reporting Backend
**Route:** ADR-006 §45 and §47 — implementation reaches `main` only by promotion of an
integrated `develop`, and no pull request targets `main` except a deliberate release
promotion.

---

## 1. State before promotion

|                          |                                                               |
| ------------------------ | ------------------------------------------------------------- |
| `origin/develop`         | `efe800d91e331dccc7ca425e18973ccd5a69f6b3`                    |
| `origin/main`            | `5f30902d4a19241eded98e0f675301edb0ee5669`                    |
| Phase baseline           | `9f7ef083ba90be3343aec2be1c721e3826070946` (tree `a921cae3`)  |
| develop/main at baseline | trees **identical** (`a921cae3`), develop an ancestor of main |

Because develop and main were byte-identical before this phase began, the promotion
carries exactly P1-23 and nothing else.

## 2. Chain merged into develop

| PR   | Head                     | Merge      | Contents                                   |
| ---- | ------------------------ | ---------- | ------------------------------------------ |
| #139 | `c2f89d91` (19/19 green) | `12a80c9e` | the phase — seven operations               |
| #140 | `222d363e` (19/19 green) | `efe800d9` | novelty check pinned to the phase baseline |

Both merged with **`merge_method: merge`**. `develop`'s ruleset permits `merge` only.
`main`'s ruleset still permits `squash` and `rebase`, so the promotion passes `merge`
**explicitly** rather than relying on the ruleset to forbid the others.

Every merge commit has two parents; none is a squash.

## 3. develop is green

`origin/develop` at `efe800d9`: **17/17 checks green**, including `protected-gate`,
`hosted-clean-room`, `database-migration-replay`, `integration-tests` (which carries the
hostile mutation matrix) and `static-quality`.

Measured through `/commits/{sha}/check-runs`, not `/actions/runs` — the latter omits
checks that are not Actions workflows.

## 4. Invariants re-verified on develop

| Invariant            | Result                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Migrations           | 119, no `120`, none modified                                                                     |
| Schema hash          | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`, unchanged                    |
| Permission catalog   | 104 (was 100); both pins moved in the same commits as the seed                                   |
| CodeQL, full tree    | **0 Critical, 0 High**; 1 medium, pre-existing on `main`, in a CI script, not application source |
| Operations added     | 7                                                                                                |
| Events published     | 0, enforced by `assertNoPhaseEvents`                                                             |
| Business data seeded | none — the no-fake-data policy holds                                                             |

## 5. What promotion does NOT do

No deployment. No release. **No tag.** P1-24 is not started. No frontend screen was
implemented. `main` receives the integrated `develop` and nothing else.

## 6. Result — verified after the merge

|                              |                                                                             |
| ---------------------------- | --------------------------------------------------------------------------- |
| Promotion merge              | `3e602f61506d0d0a73cb6f7533ca861f25ed689e`                                  |
| Parents                      | `5f30902d` (previous `main`) + `8b401274` (`develop`) — a real merge commit |
| `origin/main` tree           | `f10d97fd1d5ee3d223d1e9380e5886263f3f55dd`                                  |
| `origin/develop` tree        | `f10d97fd1d5ee3d223d1e9380e5886263f3f55dd`                                  |
| Predicted before merging     | `f10d97fd1d5ee3d223d1e9380e5886263f3f55dd` — **matched**                    |
| Trees byte-identical         | **yes**, 0 files differ                                                     |
| `develop` ancestor of `main` | **yes** (`git merge-base --is-ancestor` exit 0)                             |
| Migrations on `main`         | 119, no `120`                                                               |
| Tags                         | 1, `release-2-database-baseline` from P1-12 — **none created**              |
| Open pull requests           | 0                                                                           |
| `main` push CI               | **17/17 green**                                                             |

The tree was predicted with `git merge-tree --write-tree` **before** the merge and matched
after, so the promotion introduced exactly what was measured and nothing else.

## 7. Decision

**Go — P1-23 promoted to `main`.**

`main` now carries the phase, the two post-merge corrections it required, and the gate
record that states both. No deployment was performed, no release was cut, **no tag was
created**, and P1-24 is not started.

The chain, every link a merge commit and none a squash:

```
#139  c2f89d91 → 12a80c9e   the phase — seven read operations
#140  222d363e → efe800d9   novelty check pinned to the phase baseline
#141  d98922d4 → a247c78b   adversarial-review findings; the matrix made real
#142  d133e5fa → 8b401274   the gate record (documentation only)
#143  8b401274 → 3e602f61   promotion of develop into main
```
