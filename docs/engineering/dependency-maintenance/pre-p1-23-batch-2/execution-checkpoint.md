# Pre-P1-23 batch 2 — execution checkpoint

## Starting state

|                    |                                                        |
| ------------------ | ------------------------------------------------------ |
| `origin/develop`   | `b5e4f6f966566118607b334e83f15bc9f366b1c3`             |
| `origin/main`      | `7dfd7357317095f1e039d0c005cc2ba71055f4d0`             |
| Both trees         | `5a195cc7f96df7caf64ff19b3b865968607fa5b5` (identical) |
| Open pull requests | 10, all Dependabot, all based on current `develop`     |
| Migrations         | 119, no 120                                            |
| Schema hash        | `a677eb05…`                                            |
| Production audit   | 0                                                      |
| P1-23              | not started                                            |

## Sequence

| Step | Action                                                                                                                                           | Result                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1    | Live inventory of #121–#130 from the API, built from patches                                                                                     | 0 non-Dependabot PRs mixed in; 0 stale bases                 |
| 2    | Mechanical overlap matrix                                                                                                                        | **0 overlapping dependencies**; 5 files collide              |
| 3    | Diagnose #121's four red checks                                                                                                                  | removed rule-context API + waiver fingerprint change         |
| 4    | Primary-source release-note review, 7 majors                                                                                                     | all breaking changes mapped to actual usage                  |
| 5    | Prove #126–#130 executed their new action SHAs                                                                                                   | all five confirmed downloaded and succeeded                  |
| 6    | Detect the #129 split pin                                                                                                                        | 2 SHAs after #129; composite missed                          |
| 7    | Isolated worktree verification of 5 npm candidates                                                                                               | sequential, short paths, raised test timeout                 |
| 8    | Actions integration PR [#131](https://github.com/Ezzaldeen-Albitar/RootLco/pull/131)                                                             | 19/19 → merged `027024d5`                                    |
| 9    | Protected `develop` after #131                                                                                                                   | 22/22 success — **17 of them CI**, 5 Dependabot updater jobs |
| 10   | Tracking issues [#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132), [#133](https://github.com/Ezzaldeen-Albitar/RootLco/issues/133) | created **before** any closure                               |
| 11   | npm + policy + records PR #135                                                                                                                   | this commit                                                  |
| 12   | Dispositions on #121–#130 and #134                                                                                                               | 8 closed here; #122/#124/#125 close with #135                |
| 13   | Promote `develop → main`                                                                                                                         | tree identity pre-proven                                     |

## Isolated verification results

Each on a clean worktree cut from current `develop`, run **sequentially** so
machine load could not be mistaken for a dependency failure, at paths short
enough that Windows `MAX_PATH` could not break `next build`.

| Candidate           | typecheck | lint | build | unit | extra                                                               |
| ------------------- | --------- | ---- | ----- | ---- | ------------------------------------------------------------------- |
| `sass ^1.102.0`     | pass      | pass | pass  | pass | `format:check`, `style:check` pass                                  |
| `@types/node ^26`   | pass      | pass | pass  | pass | **refused on runtime policy**                                       |
| `@types/node ^22`   | pass      | pass | pass  | pass | recommended alternative                                             |
| `pino ^10.3.1`      | pass      | pass | pass  | pass | 899 foundation tests; coverage ratchet **pass**, all 8 floors green |
| `supabase ^2.110.0` | pass      | pass | pass  | pass | CLI reports 2.110.0                                                 |

## Corrections this batch made to earlier records

**The ESLint 10 / `brace-expansion` expectation was wrong.** The standing note
predicted ESLint 10 would remove the waiver entirely, since the exception records
`fixAvailable: {eslint@10.8.0, isSemVerMajor: true}`. #121's own CI disproved it:
ESLint 10 **swaps** one affected node for another —
`node_modules/minimatch/node_modules/brace-expansion` becomes patched, while
`node_modules/eslint-config-next/node_modules/brace-expansion@1.1.18` appears.
Development advisories stay at 9. Corrected in
[`application-dependencies-review.md`](application-dependencies-review.md) and in
issue [#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132) so the next
attempt does not start from the same premise.

**`actions/checkout` is no longer an exception.** The pin registry recorded it as
deliberately held at v4.4.0. It is now v7.0.1 and the exception paragraph is
closed. The registry was corrected in the **same commit** as the workflows and
re-derived mechanically — 12 rows, 12 live actions, 0 mismatches — because that
table is not maintained by Dependabot and was left stale once before.

## Adversarial review

Fifteen independent read-only lenses; every Critical and High reproduced
personally before acceptance. Outcome and any corrections applied are summarised
in [`review-adjudication.md`](review-adjudication.md).

Required at closure: **Critical unresolved 0, High unresolved 0.**

## Final maintenance baseline

The frozen `FINAL_MAINTENANCE_DEVELOP_SHA` is the merge commit of PR #135, which
carries this file. Its measured value, the promotion merge and the post-promotion
tree-identity proof are reported in the closure report rather than committed
here — §25 forbids a documentation-only commit on `develop` after promotion, and
a record cannot contain its own commit hash.
