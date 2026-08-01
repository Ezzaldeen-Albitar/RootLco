# P1-24 — Promotion Record (develop → main)

**Phase:** P1-24 — Backend Integration and Release Gate
**Route:** ADR-006 §45 and §47 — implementation reaches `main` only by promotion of an
integrated `develop`, and no pull request targets `main` except a deliberate release
promotion. Since `scripts/ci/check-promotion-source.mjs` landed, that rule is enforced
by CI rather than by prose: a probe pull request from a feature branch to `main` was
rejected and closed unmerged (#147).

This file is created **before** the promotion and completed **after** it, the same way
[`phase-1-23/promotion-record.md`](../phase-1-23/promotion-record.md) was. §1–§5 are the
state the promotion is based on; §6 and §7 are recorded only once the merge exists and
the resulting `main` tree has been compared against `develop`.

---

## 1. State before promotion

|                                    |                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| P1-24 phase baseline               | `1c74454debfe0d75f521d2641fba0c20b03cdfe0` (tree `973f32c1d7c2b28541014607186fcc44e3c2d982`) |
| `origin/main`                      | `db54acf1d09a3a8c499b6ee17660871ab8c410f9` (tree `973f32c1d7c2b28541014607186fcc44e3c2d982`) |
| develop/main at the phase baseline | trees **byte-identical** (`973f32c1`), 0 files differ                                        |
| `origin/develop` after the gate    | `0b68b7c9a3d6eebacce88c40dc9951d9d99b5d66` (tree `c6601886eddf36a4a67e4f6e62c78b449698a891`) |
| Promotion source                   | the merge of this documentation-completion pull request — recorded in §6                     |

Because `develop` and `main` were byte-identical when P1-24 began, the promotion carries
exactly P1-24 and the documentation that completes it, and nothing else. The delta is
enumerated in §2 and classified file-by-file in the promotion pull request.

**Why this file cannot name its own merge SHA.** The promotion source is the commit that
merges the pull request containing this file, so that SHA does not exist while the file is
being written. It is recorded in §6 with the promotion result rather than guessed here.

## 2. Chain merged into develop

| PR       | Head                                   | Merge      | Contents                                                |
| -------- | -------------------------------------- | ---------- | ------------------------------------------------------- |
| **#151** | `76632b05` (**19/19** checks green)    | `38d1ec22` | the phase — integration, hardening and its evidence     |
| **#152** | `2bf135e6` (**17** checks, ci-gate ✅) | `0b68b7c9` | the gate record — documentation only                    |
| **#153** | `2f9e43f5`                             | §6         | canonical documentation completion — documentation only |

`#152`'s seventeen checks are **11 success and 6 authorized documentation-only skips**.
A skip is a recorded decision, not an absence: `scripts/ci/classify-changes.mjs` classified
the change set as `docs` only, `ci-gate` re-read that classification **from the uploaded
artifact** rather than from a job output, and `scripts/ci/evaluate-ci-gate.mjs` accepts a
skipped job only where the classification says that job was not required. The clean room is
on the always-required list precisely so a documentation-only gate cannot skip it.

Every merge above is a **merge commit** with two parents. `develop`'s ruleset permits
`merge` only — squash and rebase are disabled repository-wide — and none of these is a
squash.

### Merge shape, verified after each merge

| Merge      | First parent | Second parent | Merge tree | Reviewed tree | Identical |
| ---------- | ------------ | ------------- | ---------- | ------------- | --------- |
| `38d1ec22` | `1c74454d`   | `76632b05`    | `f7b06ecc` | `f7b06ecc`    | **yes**   |
| `0b68b7c9` | `38d1ec22`   | `2bf135e6`    | `c6601886` | `c6601886`    | **yes**   |

Both merge trees are byte-identical to the tree that was reviewed and CI-verified, so no
unreviewed change of any kind entered protected `develop` through either merge. The
gate merge changed **2 files against the feature merge, both under
`docs/phase-1/phase-1-24/`** — 0 executable files, 0 tests, 0 scripts, 0 workflows, 0
manifests, 0 Supabase files, 0 migrations, 0 generated contract.

## 3. develop is green

`origin/develop` at `0b68b7c9`: **17 checks, 17 success, 0 skipped, 0 failed**, including
the `protected-gate` aggregate, `hosted-clean-room`, `database-migration-replay`,
`database-security`, `integration-tests` (which carries the hostile mutation matrix),
`code-security` on both the javascript-typescript and actions legs, `container-security`,
`dependency-security`, `secret-scan` and `static-quality`.

| Workflow                        | Run ID        | Trigger | Conclusion  |
| ------------------------------- | ------------- | ------- | ----------- |
| `CI`                            | `30690845932` | push    | **success** |
| `Protected branch verification` | `30690846041` | push    | **success** |

Measured through `/commits/{sha}/check-runs`, not `/actions/runs` — the latter omits
checks that are not Actions workflows, and this repository has already reported a green
head that a non-Actions check had marked red.

`ci-gate` is the **pull-request** aggregate and is absent on a push by design; the push
aggregate is `protected-gate`, and it is green. That distinction is recorded rather than
reported as a missing check.

## 4. Invariants re-verified on develop

| Invariant                 | Result                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Migrations                | **119**, no `120`, none modified; `supabase/` diff **0 files** across the phase                  |
| Schema hash               | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`, unchanged                    |
| Tests                     | unit **1288** · backend **1752** · database/RLS **1636** · total **4676**, 0 failed, 0 skipped   |
| Operations                | **226** across **19** domains; **226 Covered**, 0 partial, 0 uncovered, 0 invocation-only        |
| OpenAPI                   | **195** paths, **226** operations, regeneration produces no diff                                 |
| Mutation matrix           | **6/6 caught**, 0 survived, 0 stillborn                                                          |
| CodeQL, full tree         | **0 Critical, 0 High**; 1 Medium, pre-existing on `main`, in a CI script, not application source |
| Dependency policy         | **pass** — `npm audit` 0 vulnerabilities, **0** exceptions, **0** licence exceptions             |
| Permission catalog        | 104 codes; audit actions 153; domain events 50 (47 produced, 3 reserved)                         |
| Operations added by P1-24 | **0** — the phase integrates and hardens; it introduces no new business capability               |
| Business data seeded      | none — the no-fake-data policy holds                                                             |
| Open P1-24 blockers       | **0**                                                                                            |

## 5. What promotion does NOT do

No deployment. No release. **No tag.** No customer-data migration. No `docs/phase-1/phase-1-25`,
no P1-25 branch, no P1-25 implementation. No frontend screen was implemented. `main`
receives the integrated `develop` and nothing else.

The resulting `main` tree is predicted with `git merge-tree --write-tree` **before** the
merge is requested, and the prediction is recorded in the promotion pull request so that
§6 can compare against a number that was written down first rather than one produced
afterwards.

## 6. Result — verified after the merge

Recorded here after the promotion merge completes and the resulting `main` tree is
compared against `develop`. The decision follows in §7.
